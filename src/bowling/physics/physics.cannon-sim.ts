import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { Body, Box, Cylinder, Material, Quaternion as CannonQuaternion, Sphere, Vec3 as CannonVec3, World } from 'cannon-es'

import bumperCollidersData from './colliders/bumper-colliders.json'
import laneCollidersData from './colliders/lane-colliders.json'
import pinCollidersData from './colliders/pin-colliders.json'
import { GameSettings } from './physics.settings'
import type { SimulationSettings } from './types'
import {quaternionToStoredRotation,	storedRotationToQuaternion } from './physics.utils'
import type { QuaternionType, SimulationRunResult, SimObjectKeyframe, Vector3Type } from './types'
import { TimeLogger } from 'src/shared/utils/timeLogging'

export type CannonSimObjectState = {
	id      : number
	position: Vector3Type
	rotation: QuaternionType
	velocity: Vector3Type
}

export type CannonSimAdvanceResult = {
	ball: CannonSimObjectState
	pins: CannonSimObjectState[]
}

interface BoxColliderEntry {
	obj_name   : string
	position   : [number, number, number]
	type       : string
	shape      : string
	friction   : number
	restitution: number
	mass       : number
	dimensions : [number, number, number]
	rotation   : [number, number, number, number]
}

interface PinColliderFile {
	_comment? : string
	cylinder  : {
		radiusTop   : number
		radiusBottom: number
		height      : number
		numSegments : number
		friction    : number
		restitution : number
		mass        : number
	}
	positions : number[][]
}

const bumperColliders = bumperCollidersData as BoxColliderEntry[]
const laneColliders   = laneCollidersData as BoxColliderEntry[]
const pinConfig       = pinCollidersData as PinColliderFile


// MARK: addStaticBoxCollidersToWorld
function addStaticBoxCollidersToWorld(
	world     : World,
	colliders : BoxColliderEntry[],
): void {
	for (const collider of colliders) {
		if (collider.shape !== 'BOX') {
			continue
		}

		const material = new Material({
			friction   : collider.friction,
			restitution: collider.restitution,
		})
		const body = new Body({
			type      : Body.STATIC,
			material  : material,
			position  : new CannonVec3(
				collider.position[0],
				collider.position[1],
				collider.position[2],
			),
			quaternion: new CannonQuaternion(
				collider.rotation[0],
				collider.rotation[1],
				collider.rotation[2],
				collider.rotation[3],
			),
		})

		body.addShape(
			new Box(
				new CannonVec3(
					collider.dimensions[0] * 0.5,
					collider.dimensions[1] * 0.5,
					collider.dimensions[2] * 0.5,
				),
			),
		)
		world.addBody(body)
	}
}


/** Rack rest positions (lane-local); same source as pin cylinder config in `colliders/pin-colliders.json`. */
export const PIN_LANE_LOCAL_POSITIONS: ReadonlyArray<ReadonlyArray<number>> = pinConfig.positions

/** Cannon cylinder is Y-up at identity; `lookRotation(forward, up)` per @dcl/ecs-math (forward first). */
const UPRIGHT_PIN_QUATERNION = Quaternion.lookRotation(Vector3.Forward(), Vector3.Up())

/** Bodies at or below this Y are treated as fallen through the lane; stop integrating them. */
const UNDERGROUND_SLEEP_Y = -0.4

/** Bodies at or above this Z are treated as fallen off the end of the lane; stop integrating them. */
const LANE_END_Z_SLEEP = 22

/** When the ball is this far along the lane, wake up the pins. */
const PIN_WAKUP_WHEN_BALL_Z = 17.5


/**
 * Cannon-es world for a single roll (lane, pins, ball).
 */
export class CannonSim {
	private readonly settings        : SimulationSettings
	private readonly world           : World
	private readonly ballBody        : Body
	private readonly pinBodies       : Body[]
	private readonly initialPinStates: boolean[]

	private currentStep: number     = 0
	private logger     : TimeLogger = new TimeLogger()

	// Caches
	private _ballCache: CannonSimObjectState = {
		id: 0,
		position: { x: 0, y: 0, z: 0 },
		rotation: { x: 0, y: 0, z: 0, w: 1 },
		velocity: { x: 0, y: 0, z: 0 },
	}
	private _pinCache: CannonSimObjectState[] = []

	private pinsHaveBeenWokenUp: boolean = false

	// MARK: constructor
	/**
	 * Builds the simulation world: lane (and optional bumper) colliders, pin cylinders, ball sphere, then applies
	 * the initial impulse and spin.
	 */
	constructor(
		position : Vector3Type,
		direction: Vector3Type,
		strength : number,
		spin     : number,
		pinStates: boolean[] = Array(PIN_LANE_LOCAL_POSITIONS.length).fill(true),
		settings : SimulationSettings = GameSettings,
	) {

		this.settings        = settings

		this.world = new World({
			gravity: new CannonVec3(0, -9.82, 0)
		})

		// Add the world colliders
		addStaticBoxCollidersToWorld( this.world, laneColliders)
		if (this.settings.laneBumpersEnabled) {
			addStaticBoxCollidersToWorld(this.world, bumperColliders)
		}
		this.logger.log('world+collider setup')

		// Configure the pins
		this.initialPinStates = Array.from(
			{ length: PIN_LANE_LOCAL_POSITIONS.length },
			(_, index) => pinStates[index] ?? true,
		)

		const pinMaterial = new Material({
			friction   : this.settings.pinFriction,
			restitution: this.settings.pinRestitution,
		})

		this.pinBodies = []
		const bodyCylinder = new Cylinder(
			pinConfig.cylinder.radiusTop,
			pinConfig.cylinder.radiusBottom,
			pinConfig.cylinder.height,
			pinConfig.cylinder.numSegments,
		)
		for (let index = 0; index < PIN_LANE_LOCAL_POSITIONS.length; index += 1) {
			if (!this.initialPinStates[index]) continue

			const lanePosition = PIN_LANE_LOCAL_POSITIONS[index]
			if (!lanePosition) continue

			const pinBody = new Body({
				mass          : this.settings.pinMass,
				position      : new CannonVec3(lanePosition[0], lanePosition[1], lanePosition[2]),
				quaternion    : new CannonQuaternion(0, 0, 0, 1),
				linearDamping : this.settings.pinLinearDamping,
				angularDamping: this.settings.pinAngularDamping
			})

			pinBody.id = index
			pinBody.addShape(bodyCylinder)
			pinBody.shapes[0]!.material = pinMaterial
			pinBody.sleep()

			this.world.addBody(pinBody)
			this.pinBodies.push(pinBody)
		}

		this.logger.log('pin setup')

		this.ballBody = new Body({
			mass          : this.settings.ballMass,
			position      : new CannonVec3(position.x, position.y, position.z),
			linearDamping : this.settings.ballLinearDamping,
			angularDamping: this.settings.ballAngularDamping,
			material      : new Material({
				friction   : this.settings.ballFriction,
				restitution: this.settings.ballRestitution,
			}),
		})
		this.ballBody.id = 0
		this.ballBody.addShape(new Sphere(this.settings.ballRadius))
		this.world.addBody(this.ballBody)

		this.fireBall(direction, strength, spin)
	}


	// MARK: advance
	/**
	 * Integrates the world forward by `dt` seconds, using `simSubSteps` substeps from settings.
	 * Massively over-optimnised here, aiming for zero-allocations
	 * Probably overkill, but eh, it's only sacrificing readability and who needs that?!
	 */
	advance(dt: number): CannonSimAdvanceResult {
		this.currentStep++

		const subSteps = this.settings.simSubSteps | 0
		const subDt = dt / subSteps

		// localise refs
		const ball  = this.ballBody
		const pins  = this.pinBodies

		// Do pins need to wake up?
		if (!this.pinsHaveBeenWokenUp) {
			if (ball.position.z > PIN_WAKUP_WHEN_BALL_Z) {
				this.pinsHaveBeenWokenUp = true
				for (const pin of pins) {
					pin.wakeUp()
				}
			}
		}

		// step physics
		for (let i = 0; i < subSteps; i++) this.world.step(subDt, undefined)

		if (ball.position.y < UNDERGROUND_SLEEP_Y || ball.position.z > LANE_END_Z_SLEEP) {
			ball.velocity.set(0, 0, 0)
			ball.angularVelocity.set(0, 0, 0)
			ball.sleep()
		}
		for (let i = 0; i < pins.length; i++) {
			const pinBody = pins[i]!
			if (pinBody.position.y < UNDERGROUND_SLEEP_Y || pinBody.position.z > LANE_END_Z_SLEEP) {
				pinBody.velocity.set(0, 0, 0)
				pinBody.angularVelocity.set(0, 0, 0)
				pinBody.sleep()
			}
		}

		// BALL - write to cache - directly, instead of creating a new object and copying it
		const bp = ball.position
		const bq = ball.quaternion
		const bv = ball.velocity
		const bCache = this._ballCache
		bCache.id = ball.id
		bCache.position.x = bp.x
		bCache.position.y = bp.y
		bCache.position.z = bp.z
		bCache.rotation.x = bq.x
		bCache.rotation.y = bq.y
		bCache.rotation.z = bq.z
		bCache.rotation.w = bq.w
		bCache.velocity.x = bv.x
		bCache.velocity.y = bv.y
		bCache.velocity.z = bv.z


		// PINS - write to cache, again directly
		const pCache = this._pinCache
		const pCount = pins.length

		// Clear and rebuild the pin cache
		if (pCache.length !== pCount) {
			pCache.length = pCount
			for (let i = 0; i < pCount; i++) {
				pCache[i] = {
					id: 0,
					position: { x: 0, y: 0, z: 0 },
					rotation: { x: 0, y: 0, z: 0, w: 1 },
					velocity: { x: 0, y: 0, z: 0 },
				}
			}
		}

		for (let i = 0; i < pCount; i++) {
			const body = pins[i]
			const out = pCache[i]

			const p = body.position
			const q = body.quaternion
			const v = body.velocity
			out.id = body.id
			out.position.x = p.x
			out.position.y = p.y
			out.position.z = p.z
			out.rotation.x = q.x
			out.rotation.y = q.y
			out.rotation.z = q.z
			out.rotation.w = q.w
			out.velocity.x = v.x
			out.velocity.y = v.y
			out.velocity.z = v.z
		}
		
		return {
			ball: bCache,
			pins: pCache,
		}
	}


	// MARK: simulate
	/**
	 * Samples the roll into keyframes until idle or for the given `duration` (capped by settings and idle detection).
	 */
	simulate(duration: number = this.settings.simDuration): SimulationRunResult {
		const stepTime            = 1 / this.settings.simFrameRate
		const totalSteps          = Math.floor(duration / stepTime)
		const computeStartedAt    = Date.now()
		let framesWithoutVelocity = 0

		const result: SimulationRunResult = {
			ballKeyframes: {
				index    : 0,
				label    : 'Ball',
				keyframes: [],
			},
			pinsKeyframes: Array.from({ length: PIN_LANE_LOCAL_POSITIONS.length }, (_, index) => ({
				index    : index,
				label    : `Pin ${index + 1}`,
				keyframes: [],
			})),
			finalPinStates: [...this.initialPinStates],
			computeTimeMs  : 0,
		}

		
		for (let stepIndex = 0; stepIndex < totalSteps; stepIndex += 1) {
			let hasVelocity = false
			const step      = this.advance(stepTime)

			if (this.currentStep % 100 == 0) this.logger.log(`step ${this.currentStep} - advanced`)

			result.ballKeyframes.keyframes.push({
				time    : this.world.time,
				position: {x: step.ball.position.x, y: step.ball.position.y, z: step.ball.position.z},
				rotation: quaternionToStoredRotation(step.ball.rotation)
			})
			//if (this.currentStep % 100 == 0) this.logger.log(`step ${this.currentStep} - ball keyframes`)

			// Check ball velocity
			const vB = this.ballBody.velocity
			const vB2 = vB.x * vB.x + vB.y * vB.y + vB.z * vB.z
			if (vB2 > this.settings.velocityRestEpsilon) {
				hasVelocity = true
			}
			// Checks angular velocity when looking for velocity, overkill, disabled
			/* if (!hasVelocity) {
				const av     = this.ballBody.angularVelocity
				const omega2 = av.x * av.x + av.y * av.y + av.z * av.z
				if (omega2 > this.settings.velocityRestEpsilon) {
					hasVelocity = true
				}
			} */
			
			//if (this.currentStep % 100 == 0) this.logger.log(`step ${this.currentStep} - velocity check`)

			for (const pin of step.pins) {
				const pinTrack = result.pinsKeyframes[pin.id]
				if (!pinTrack) continue

				const keyframe: SimObjectKeyframe = {
					time    : this.world.time,
					position: {x: pin.position.x, y: pin.position.y, z: pin.position.z},
					rotation: quaternionToStoredRotation(pin.rotation)
				}
				pinTrack.keyframes.push(keyframe)
				//if (this.currentStep % 100 == 0) this.logger.log(`step ${this.currentStep} - pin ${pin.id} keyframes`)

				if (!hasVelocity) {
					const v = this.pinBodies[pin.id].velocity
					const v2 = v.x * v.x + v.y * v.y + v.z * v.z
					if (v2 > this.settings.velocityRestEpsilon) hasVelocity = true
				}
				//if (this.currentStep % 100 == 0) this.logger.log(`step ${this.currentStep} - pin ${pin.id} velocity check`)
			}

			framesWithoutVelocity = hasVelocity ? 0 : framesWithoutVelocity + 1
			if (framesWithoutVelocity > this.settings.idleFrameCap) break
			
			if (this.currentStep % 100 == 0) this.logger.log(`step ${this.currentStep} - frames without velocity check`)
		}
		
		this.logger.log(`step ${this.currentStep} - simulate complete`)

		for (const track of result.pinsKeyframes) {
			const kfs          = track.keyframes
			const lastKeyframe = kfs.length > 0 ? kfs[kfs.length - 1] : undefined
			const lastQuat =
				lastKeyframe?.rotation !== undefined
					? storedRotationToQuaternion(lastKeyframe.rotation)
					: undefined
			result.finalPinStates[track.index] = Boolean(
				lastKeyframe?.position && 
				lastKeyframe.position.y >= 0.2 &&

				lastQuat &&
				Math.abs(Quaternion.dot(lastQuat, UPRIGHT_PIN_QUATERNION)) > 0.95
			)
		}
		
		this.logger.log(`step ${this.currentStep} - final pin states computed`)

		result.computeTimeMs = Date.now() - computeStartedAt

		// DEBUG: log timings
		this.logger.print()
		return result
	}


	// MARK: fireBall
	private fireBall(
		direction: Vector3Type,
		strength : number,
		spin     : number,
	): void {
		const magnitude = Math.sqrt(direction.x ** 2 + direction.y ** 2 + direction.z ** 2)
		if (magnitude <= 1e-6) {
			return
		}

		const clampedStrength = Math.max(0, Math.min(1, strength))
		const speed           =
			this.settings.bowlSpeedMin +
			clampedStrength * (this.settings.bowlSpeedMax - this.settings.bowlSpeedMin)
		const impulseScale    = (this.settings.ballMass * speed) / magnitude

		this.ballBody.applyImpulse(
			new CannonVec3(
				direction.x * impulseScale,
				direction.y * impulseScale,
				direction.z * impulseScale,
			),
		)

		const clampedSpin = Math.max(-1, Math.min(1, spin))
		this.ballBody.angularVelocity.set(
			0,
			clampedSpin * this.settings.ballMaxAngularVelocity,
			0,
		)
	}
}
