import {
	Body,
	Box,
	Cylinder,
	Material,
	Quaternion as CannonQuaternion,
	Sphere,
	Vec3 as CannonVec3,
	World,
} from 'cannon-es'

import laneCollidersData from './lane-colliders.json'
import pinCollidersData from './pin-colliders.json'
import { GameSettings, type SimulationSettings } from './settings'
import type { Quat, RawSimulationResult, SimObjectKeyframe, Vec3 } from './types'

export type CannonSimObjectState = {
	id      : number
	position: Vec3
	rotation: Quat
	velocity: Vec3
}

export type CannonSimAdvanceResult = {
	ball: CannonSimObjectState
	pins: CannonSimObjectState[]
}

interface LaneColliderEntry {
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
	positions: number[][]
}

const laneColliders = laneCollidersData as LaneColliderEntry[]
const pinConfig     = pinCollidersData as PinColliderFile

export const PIN_LANE_LOCAL_POSITIONS: ReadonlyArray<ReadonlyArray<number>> = pinConfig.positions

export class CannonSim {
	private readonly settings        : SimulationSettings
	private readonly world           : World
	private readonly ballBody        : Body
	private readonly pinBodies       : Body[]
	private readonly initialPinStates: boolean[]

	constructor(
		position : Vec3,
		direction: Vec3,
		strength : number,
		pinStates: boolean[] = Array(PIN_LANE_LOCAL_POSITIONS.length).fill(true),
		settings : SimulationSettings = GameSettings,
	) {
		this.settings        = settings
		this.initialPinStates = Array.from(
			{ length: PIN_LANE_LOCAL_POSITIONS.length },
			(_, index) => pinStates[index] ?? true,
		)
		this.world = new World({
			gravity: new CannonVec3(0, -9.82, 0),
		})

		for (const collider of laneColliders) {
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
				position  : new CannonVec3(collider.position[0], collider.position[1], collider.position[2]),
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
			this.world.addBody(body)
		}

		const pinMaterial = new Material({
			friction   : pinConfig.cylinder.friction,
			restitution: pinConfig.cylinder.restitution,
		})

		this.pinBodies = []
		for (let index = 0; index < PIN_LANE_LOCAL_POSITIONS.length; index += 1) {
			if (!this.initialPinStates[index]) {
				continue
			}

			const lanePosition = PIN_LANE_LOCAL_POSITIONS[index]
			if (!lanePosition) {
				continue
			}

			const pinBody = new Body({
				mass          : pinConfig.cylinder.mass,
				position      : new CannonVec3(lanePosition[0], lanePosition[1], lanePosition[2]),
				quaternion    : new CannonQuaternion(0, 0, 0, 1),
				linearDamping : 0.05,
				angularDamping: 0.2,
			})

			pinBody.id = index
			pinBody.addShape(
				new Cylinder(
					pinConfig.cylinder.radiusTop,
					pinConfig.cylinder.radiusBottom,
					pinConfig.cylinder.height,
					pinConfig.cylinder.numSegments,
				),
			)
			pinBody.shapes[0]!.material = pinMaterial

			this.world.addBody(pinBody)
			this.pinBodies.push(pinBody)
		}

		this.ballBody = new Body({
			mass          : this.settings.ballMass,
			position      : new CannonVec3(position.x, position.y, position.z),
			linearDamping : 0.01,
			angularDamping: 0.02,
			material      : new Material({ friction: 0.2, restitution: 0.05 }),
		})
		this.ballBody.id = 0
		this.ballBody.addShape(new Sphere(this.settings.ballRadius))
		this.world.addBody(this.ballBody)

		this.fireBall(direction, strength)
	}

	// MARK: advance
	advance(dt: number): CannonSimAdvanceResult {
		this.world.step(dt, dt, this.settings.simSubSteps)

		return {
			ball: this.getBodyTransform(this.ballBody),
			pins: this.pinBodies.map((body) => this.getBodyTransform(body)),
		}
	}

	// MARK: simulate
	simulate(duration: number = this.settings.simDuration): RawSimulationResult {
		const stepTime             = 1 / this.settings.simFrameRate
		const totalSteps           = Math.floor(duration / stepTime)
		let   framesWithoutVelocity = 0

		const result: RawSimulationResult = {
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
		}

		for (let stepIndex = 0; stepIndex < totalSteps; stepIndex += 1) {
			let hasVelocity = false
			const step      = this.advance(stepTime)

			result.ballKeyframes.keyframes.push({
				time    : this.world.time,
				position: roundVec3(step.ball.position, this.settings.decimalPlaces),
				rotation: roundQuat(step.ball.rotation, this.settings.decimalPlaces),
			})

			if (lengthSquared(step.ball.velocity) > this.settings.simKeyframeReductionEpsilon) {
				hasVelocity = true
			}

			for (const pin of step.pins) {
				const track = result.pinsKeyframes[pin.id]
				if (!track) {
					continue
				}

				const keyframe: SimObjectKeyframe = {
					time    : this.world.time,
					position: roundVec3(pin.position, this.settings.decimalPlaces),
					rotation: roundQuat(pin.rotation, this.settings.decimalPlaces),
				}
				track.keyframes.push(keyframe)

				if (!hasVelocity && lengthSquared(pin.velocity) > this.settings.simKeyframeReductionEpsilon) {
					hasVelocity = true
				}
			}

			framesWithoutVelocity = hasVelocity ? 0 : framesWithoutVelocity + 1
			if (framesWithoutVelocity > this.settings.simFramesWithNoVelocityThreshold) {
				break
			}
		}

		for (const track of result.pinsKeyframes) {
			const lastKeyframe = track.keyframes.at(-1)
			result.finalPinStates[track.index] = Boolean(
				lastKeyframe?.position && lastKeyframe.position.y >= 0.2,
			)
		}

		return result
	}

	// MARK: fireBall
	private fireBall(
		direction: Vec3,
		strength : number,
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
	}

	// MARK: getBodyTransform
	private getBodyTransform(body: Body): CannonSimObjectState {
		return {
			id      : body.id,
			position: {
				x: body.position.x,
				y: body.position.y,
				z: body.position.z,
			},
			rotation: {
				x: body.quaternion.x,
				y: body.quaternion.y,
				z: body.quaternion.z,
				w: body.quaternion.w,
			},
			velocity: {
				x: body.velocity.x,
				y: body.velocity.y,
				z: body.velocity.z,
			},
		}
	}
}

// MARK: Utils

function lengthSquared(vector: Vec3): number {
	return vector.x ** 2 + vector.y ** 2 + vector.z ** 2
}

function roundVec3(
	vector        : Vec3,
	decimalPlaces : number,
): Vec3 {
	const factor = 10 ** decimalPlaces
	return {
		x: Math.round(vector.x * factor) / factor,
		y: Math.round(vector.y * factor) / factor,
		z: Math.round(vector.z * factor) / factor,
	}
}

function roundQuat(
	quaternion    : Quat,
	decimalPlaces : number,
): Quat {
	const factor = 10 ** decimalPlaces
	return {
		x: Math.round(quaternion.x * factor) / factor,
		y: Math.round(quaternion.y * factor) / factor,
		z: Math.round(quaternion.z * factor) / factor,
		w: Math.round(quaternion.w * factor) / factor,
	}
}
