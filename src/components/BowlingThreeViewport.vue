<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import * as THREE from 'three'

import { PIN_LANE_LOCAL_POSITIONS } from '../bowling/physics/physics.cannon-sim'
import laneCollidersJson from '../bowling/data/lane-colliders.json'
import pinCollidersJson from '../bowling/data/pin-colliders.json'
import { GameSettings } from '../bowling/physics/physics.settings'
import { maxPlaybackTime, samplePlaybackAtTime } from '../bowling/visualizer/playback-sample'
import type { SimulationComparison } from '../bowling/types'

const props = withDefaults(
	defineProps<{
		comparison: SimulationComparison
		enabledPins: boolean[]
		/** Per index: pin was included in the simulated rack (false = no body, hide mesh). */
		startingPinStates: boolean[]
		/** When true, omit the title + intro paragraph (parent supplies section chrome). */
		hideIntroHeading?: boolean
	}>(),
	{ hideIntroHeading: false },
)

const canvasWrapRef = ref<HTMLDivElement | null>(null)
const threeHostRef = ref<HTMLDivElement | null>(null)

const playbackSource = ref<'original' | 'compressed'>('original')
const isPlaying = ref(false)
const playbackTime = ref(0)
const playbackSpeed = ref(1)
const loopPlayback = ref(false)
/** Lane BOX colliders + pin cylinders + ball sphere (same shapes as `physics.cannon-sim`; not passive CYLINDER entries in lane JSON). */
const showColliderWireframes = ref(false)

const activeResult = computed(() =>
	playbackSource.value === 'original' ? props.comparison.original : props.comparison.compressed,
)

const durationMax = computed(() => maxPlaybackTime(activeResult.value))

const ballRadius = GameSettings.ballRadius

/** Same cylinder as physics (`data/pin-colliders.json`); Three `CylinderGeometry` is (radiusTop, radiusBottom, height, …). */
const pinCylinder = pinCollidersJson.cylinder as {
	radiusTop: number
	radiusBottom: number
	height: number
	numSegments: number
}
const pinRadialSegments = Math.max(3, Math.floor(pinCylinder.numSegments))

/** Centroid of rack rest positions — orbit / side / top cameras frame this point. */
function pinDeckCenter(): THREE.Vector3 {
	let sx = 0
	let sy = 0
	let sz = 0
	const n = PIN_LANE_LOCAL_POSITIONS.length
	for (const row of PIN_LANE_LOCAL_POSITIONS) {
		sx += row[0] ?? 0
		sy += row[1] ?? 0
		sz += row[2] ?? 0
	}
	return new THREE.Vector3(sx / n, sy / n, sz / n)
}

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let sideCamera: THREE.PerspectiveCamera | null = null
let topCamera: THREE.OrthographicCamera | null = null
let orbitCamera: THREE.PerspectiveCamera | null = null

/** Orbit wheel zoom limits (min lowered slightly for ~1–2 extra zoom-in steps). */
const ORBIT_RADIUS_MIN = 3
const ORBIT_RADIUS_MAX = 40
/**
 * Top-down orthographic **frustum** half-size in world space (all four of `left` / `right` / `top` / `bottom`, with
 * `left`–`right` also multiplied by viewport aspect). This is the only control that “zooms” the top view.
 *
 * For an `OrthographicCamera`, the distance from the lane on **+Y** ({@link TOP_CAMERA_ELEVATION}) does *not* change
 * the scale of the image — that was why the old “height” constant looked ineffective.
 */
const TOP_ORTHO_HALF_SPAN = 1.5
/**
 * World +Y of the top camera, above the pin-deck `lookAt` target. Clipping / which side of thin geometry; does not
 * act like a perspective “zoom”.
 */
const TOP_CAMERA_ELEVATION = 4

const ballMesh = shallowRef<THREE.Mesh | null>(null)
const pinMeshes = shallowRef<THREE.Mesh[]>([])

const orbitTarget = new THREE.Vector3()
let orbitRadius = 9.5
let orbitTheta = 0.9
let orbitPhi = 1.08
let orbitDragging = false
let orbitLastX = 0
let orbitLastY = 0

let rafId = 0
let lastFrameMs = 0

function pinHueHex(index: number): number {
	const hue = ((index * 31) % 360) / 360
	return new THREE.Color().setHSL(hue, 0.72, 0.62).getHex()
}

function syncOrbitCamera(): void {
	if (!orbitCamera) {
		return
	}
	const sinPhi = Math.sin(orbitPhi)
	const x = orbitTarget.x + orbitRadius * sinPhi * Math.cos(orbitTheta)
	const y = orbitTarget.y + orbitRadius * Math.cos(orbitPhi)
	const z = orbitTarget.z + orbitRadius * sinPhi * Math.sin(orbitTheta)
	orbitCamera.position.set(x, y, z)
	orbitCamera.lookAt(orbitTarget)
}

function applySampleToMeshes(): void {
	const sample = samplePlaybackAtTime(activeResult.value, playbackTime.value)
	const ball = ballMesh.value
	if (ball) {
		const p = sample.ball.position
		ball.position.set(p.x, p.y, p.z)
		ball.quaternion.set(
			sample.ball.rotation.x,
			sample.ball.rotation.y,
			sample.ball.rotation.z,
			sample.ball.rotation.w,
		)
	}

	const pins = pinMeshes.value
	for (let i = 0; i < pins.length; i += 1) {
		const mesh = pins[i]
		if (!mesh) {
			continue
		}

		if (!props.startingPinStates[i]) {
			mesh.visible = false
			continue
		}

		if (!props.enabledPins[i]) {
			mesh.visible = false
			continue
		}

		const pose = sample.pins[i]
		if (!pose) {
			const rest = PIN_LANE_LOCAL_POSITIONS[i]
			if (rest) {
				mesh.visible = true
				mesh.position.set(rest[0] ?? 0, rest[1] ?? 0, rest[2] ?? 0)
				mesh.quaternion.identity()
				const mat = mesh.material as THREE.MeshBasicMaterial
				mat.opacity = 0.35
				mat.transparent = true
			} else {
				mesh.visible = false
			}
			continue
		}

		mesh.visible = true
		const mat = mesh.material as THREE.MeshBasicMaterial
		mat.opacity = 1
		mat.transparent = false
		mesh.position.set(pose.position.x, pose.position.y, pose.position.z)
		mesh.quaternion.set(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w)
	}

	syncColliderWireframes()
}

function layoutCameras(width: number, height: number): void {
	const aspectThird = (width / 3) / Math.max(height, 1)
	if (sideCamera) {
		sideCamera.aspect = aspectThird
		sideCamera.updateProjectionMatrix()
	}
	if (topCamera) {
		const halfW = TOP_ORTHO_HALF_SPAN * aspectThird
		topCamera.left = -halfW
		topCamera.right = halfW
		topCamera.top = TOP_ORTHO_HALF_SPAN
		topCamera.bottom = -TOP_ORTHO_HALF_SPAN
		topCamera.updateProjectionMatrix()
	}
	if (orbitCamera) {
		orbitCamera.aspect = aspectThird
		orbitCamera.updateProjectionMatrix()
	}
}

function renderFrame(): void {
	if (!renderer || !scene || !sideCamera || !topCamera || !orbitCamera) {
		return
	}

	const canvas = renderer.domElement
	const w = canvas.clientWidth
	const h = canvas.clientHeight
	const third = w / 3

	renderer.setScissorTest(true)

	renderer.setViewport(0, 0, third, h)
	renderer.setScissor(0, 0, third, h)
	renderer.render(scene, sideCamera)

	renderer.setViewport(third, 0, third, h)
	renderer.setScissor(third, 0, third, h)
	renderer.render(scene, topCamera)

	renderer.setViewport(third * 2, 0, third, h)
	renderer.setScissor(third * 2, 0, third, h)
	syncOrbitCamera()
	renderer.render(scene, orbitCamera)

	renderer.setScissorTest(false)
}

function animate(now: number): void {
	rafId = requestAnimationFrame(animate)

	if (isPlaying.value && durationMax.value > 0) {
		const dt = lastFrameMs > 0 ? (now - lastFrameMs) / 1000 : 0
		lastFrameMs = now
		playbackTime.value = Math.min(
			durationMax.value,
			playbackTime.value + dt * playbackSpeed.value,
		)
		if (playbackTime.value >= durationMax.value) {
			if (loopPlayback.value) {
				playbackTime.value = 0
			} else {
				isPlaying.value = false
			}
		}
	} else {
		lastFrameMs = now
	}

	applySampleToMeshes()
	renderFrame()
}

function onPointerDown(ev: PointerEvent): void {
	if (!renderer) {
		return
	}
	const rect = renderer.domElement.getBoundingClientRect()
	const x = ev.clientX - rect.left
	if (x < (rect.width * 2) / 3) {
		return
	}
	orbitDragging = true
	orbitLastX = ev.clientX
	orbitLastY = ev.clientY
	renderer.domElement.setPointerCapture(ev.pointerId)
}

function onPointerMove(ev: PointerEvent): void {
	if (!orbitDragging) {
		return
	}
	const dx = ev.clientX - orbitLastX
	const dy = ev.clientY - orbitLastY
	orbitLastX = ev.clientX
	orbitLastY = ev.clientY
	orbitTheta -= dx * 0.006
	orbitPhi = Math.max(0.12, Math.min(Math.PI - 0.12, orbitPhi + dy * 0.006))
}

function onPointerUp(ev: PointerEvent): void {
	if (!orbitDragging || !renderer) {
		return
	}
	orbitDragging = false
	try {
		renderer.domElement.releasePointerCapture(ev.pointerId)
	} catch {
		/* ignore */
	}
}

function onWheel(ev: WheelEvent): void {
	if (!renderer) {
		return
	}
	const rect = renderer.domElement.getBoundingClientRect()
	const x = ev.clientX - rect.left
	if (x < (rect.width * 2) / 3) {
		return
	}
	ev.preventDefault()
	orbitRadius = Math.max(ORBIT_RADIUS_MIN, Math.min(ORBIT_RADIUS_MAX, orbitRadius + ev.deltaY * 0.02))
}

let resizeObserver: ResizeObserver | null = null
let ballGeometry: THREE.BufferGeometry | null = null
let pinSharedGeometry: THREE.BufferGeometry | null = null

let colliderDebugRoot: THREE.Group | null = null
let ballColliderWire: THREE.LineSegments | null = null
const pinColliderWires: THREE.LineSegments[] = []
let pinCylinderEdgesGeom: THREE.EdgesGeometry | null = null
let ballSphereEdgesGeom: THREE.EdgesGeometry | null = null
const colliderOutlineMaterials: THREE.LineBasicMaterial[] = []
const laneColliderDebugGeoms: THREE.BufferGeometry[] = []

/** Ever-so-slightly different blues (HSL) so collider wireframes are easier to tell apart. */
function takeColliderOutlineMaterial(serial: number): THREE.LineBasicMaterial {
	const hue = 0.532 + (serial % 20) * 0.0036
	const sat = 0.68 + (serial % 4) * 0.055
	const light = 0.48 + (serial % 7) * 0.024
	const mat = new THREE.LineBasicMaterial({
		color: new THREE.Color().setHSL(hue, Math.min(0.92, sat), Math.min(0.66, light)),
	})
	colliderOutlineMaterials.push(mat)
	return mat
}

function syncColliderWireframes(): void {
	if (!colliderDebugRoot || !ballColliderWire) {
		return
	}
	const ball = ballMesh.value
	if (ball) {
		ballColliderWire.position.copy(ball.position)
		ballColliderWire.quaternion.copy(ball.quaternion)
	}
	const pins = pinMeshes.value
	for (let i = 0; i < pinColliderWires.length; i += 1) {
		const wire = pinColliderWires[i]
		const mesh = pins[i]
		if (!wire || !mesh) {
			continue
		}
		wire.visible = mesh.visible
		wire.position.copy(mesh.position)
		wire.quaternion.copy(mesh.quaternion)
	}
}

onMounted(() => {
	const wrap = canvasWrapRef.value
	if (!wrap) {
		return
	}

	scene = new THREE.Scene()
	scene.background = new THREE.Color(0x0b1220)

	const hemi = new THREE.HemisphereLight(0x9fb8ff, 0x1a1f2e, 0.9)
	scene.add(hemi)

	const deck = pinDeckCenter()
	orbitTarget.copy(deck)

	const grid = new THREE.GridHelper(24, 24, 0x334155, 0x1e293b)
	grid.position.set(deck.x, 0.001, deck.z)
	scene.add(grid)

	ballGeometry = new THREE.SphereGeometry(ballRadius, 24, 24)
	const ballMat = new THREE.MeshBasicMaterial({ color: 0x60a5fa })
	const ball = new THREE.Mesh(ballGeometry, ballMat)
	scene.add(ball)
	ballMesh.value = ball

	pinSharedGeometry = new THREE.CylinderGeometry(
		pinCylinder.radiusTop,
		pinCylinder.radiusBottom,
		pinCylinder.height,
		pinRadialSegments,
	)
	const meshes: THREE.Mesh[] = []
	for (let i = 0; i < PIN_LANE_LOCAL_POSITIONS.length; i += 1) {
		const mat = new THREE.MeshBasicMaterial({ color: pinHueHex(i) })
		const mesh = new THREE.Mesh(pinSharedGeometry, mat)
		scene.add(mesh)
		meshes.push(mesh)
	}
	pinMeshes.value = meshes

	colliderDebugRoot = new THREE.Group()
	colliderDebugRoot.name = 'ColliderWireframes'
	colliderDebugRoot.visible = showColliderWireframes.value
	scene.add(colliderDebugRoot)

	let outlineSerial = 0
	type LaneJsonEntry = {
		shape: string
		position?: number[]
		dimensions?: number[]
		rotation?: number[]
	}
	for (const entry of laneCollidersJson as LaneJsonEntry[]) {
		if (entry.shape !== 'BOX' || !entry.dimensions || !entry.position || !entry.rotation) {
			continue
		}
		const [dx, dy, dz] = entry.dimensions
		const [px, py, pz] = entry.position
		const [qx, qy, qz, qw] = entry.rotation
		const boxGeo = new THREE.BoxGeometry(dx, dy, dz)
		const edges = new THREE.EdgesGeometry(boxGeo)
		boxGeo.dispose()
		laneColliderDebugGeoms.push(edges)
		const line = new THREE.LineSegments(edges, takeColliderOutlineMaterial(outlineSerial))
		outlineSerial += 1
		line.position.set(px, py, pz)
		line.quaternion.set(qx, qy, qz, qw)
		colliderDebugRoot.add(line)
	}

	pinCylinderEdgesGeom = new THREE.EdgesGeometry(pinSharedGeometry)
	for (let i = 0; i < PIN_LANE_LOCAL_POSITIONS.length; i += 1) {
		const line = new THREE.LineSegments(pinCylinderEdgesGeom, takeColliderOutlineMaterial(outlineSerial))
		outlineSerial += 1
		colliderDebugRoot.add(line)
		pinColliderWires.push(line)
	}

	const ballWireSphere = new THREE.SphereGeometry(ballRadius, 16, 12)
	ballSphereEdgesGeom = new THREE.EdgesGeometry(ballWireSphere)
	ballWireSphere.dispose()
	ballColliderWire = new THREE.LineSegments(ballSphereEdgesGeom, takeColliderOutlineMaterial(outlineSerial))
	colliderDebugRoot.add(ballColliderWire)

	const aspect = (wrap.clientWidth / 3) / Math.max(wrap.clientHeight, 1)

	// Side: lateral offset along +X, slightly above pin mid-height; look at deck.
	sideCamera = new THREE.PerspectiveCamera(40, aspect, 0.05, 120)
	sideCamera.position.set(deck.x + 4.8, deck.y + 1.5, deck.z)
	sideCamera.lookAt(deck)

	// Top: orthographic plan view (−Y look direction); world +Z is “up” on screen.
	const topHalfW = TOP_ORTHO_HALF_SPAN * aspect
	topCamera = new THREE.OrthographicCamera(-topHalfW, topHalfW, TOP_ORTHO_HALF_SPAN, -TOP_ORTHO_HALF_SPAN, 0.05, 200)
	topCamera.position.set(deck.x, deck.y + TOP_CAMERA_ELEVATION, deck.z)
	topCamera.up.set(0, 0, 1)
	topCamera.lookAt(deck)

	orbitCamera = new THREE.PerspectiveCamera(46, aspect, 0.05, 120)
	syncOrbitCamera()

	renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
	renderer.domElement.classList.add('three-canvas')
	renderer.domElement.addEventListener('pointerdown', onPointerDown)
	renderer.domElement.addEventListener('pointermove', onPointerMove)
	renderer.domElement.addEventListener('pointerup', onPointerUp)
	renderer.domElement.addEventListener('pointercancel', onPointerUp)
	renderer.domElement.addEventListener('wheel', onWheel, { passive: false })

	threeHostRef.value?.appendChild(renderer.domElement)

	const resize = (): void => {
		if (!renderer || !canvasWrapRef.value) {
			return
		}
		const w = canvasWrapRef.value.clientWidth
		const h = canvasWrapRef.value.clientHeight
		renderer.setSize(w, h, false)
		layoutCameras(w, h)
		renderFrame()
	}

	resizeObserver = new ResizeObserver(() => resize())
	resizeObserver.observe(wrap)
	resize()

	applySampleToMeshes()
	rafId = requestAnimationFrame(animate)
})

onUnmounted(() => {
	cancelAnimationFrame(rafId)
	resizeObserver?.disconnect()
	resizeObserver = null

	if (renderer) {
		renderer.domElement.removeEventListener('pointerdown', onPointerDown)
		renderer.domElement.removeEventListener('pointermove', onPointerMove)
		renderer.domElement.removeEventListener('pointerup', onPointerUp)
		renderer.domElement.removeEventListener('pointercancel', onPointerUp)
		renderer.domElement.removeEventListener('wheel', onWheel)
		renderer.dispose()
		renderer.domElement.remove()
		renderer = null
	}

	for (const g of laneColliderDebugGeoms) {
		g.dispose()
	}
	laneColliderDebugGeoms.length = 0
	pinCylinderEdgesGeom?.dispose()
	pinCylinderEdgesGeom = null
	ballSphereEdgesGeom?.dispose()
	ballSphereEdgesGeom = null
	for (const m of colliderOutlineMaterials) {
		m.dispose()
	}
	colliderOutlineMaterials.length = 0
	colliderDebugRoot = null
	ballColliderWire = null
	pinColliderWires.length = 0

	if (scene) {
		scene.clear()
	}
	ballGeometry?.dispose()
	ballGeometry = null
	pinSharedGeometry?.dispose()
	pinSharedGeometry = null
	for (const m of pinMeshes.value) {
		;(m.material as THREE.Material).dispose()
	}
	if (ballMesh.value) {
		;(ballMesh.value.material as THREE.Material).dispose()
	}
	scene = null
	sideCamera = null
	topCamera = null
	orbitCamera = null
	ballMesh.value = null
	pinMeshes.value = []
})

watch(
	() => props.comparison,
	() => {
		playbackTime.value = Math.min(playbackTime.value, durationMax.value)
		if (durationMax.value <= 0) {
			isPlaying.value = false
			playbackTime.value = 0
		}
	},
	{ deep: true },
)

watch(durationMax, (max) => {
	if (playbackTime.value > max) {
		playbackTime.value = max
	}
})

watch(playbackSource, () => {
	playbackTime.value = Math.min(playbackTime.value, durationMax.value)
})

watch(
	() => [...props.enabledPins],
	() => {
		applySampleToMeshes()
	},
)

watch(
	() => [...props.startingPinStates],
	() => {
		applySampleToMeshes()
	},
)

watch(showColliderWireframes, (on) => {
	if (colliderDebugRoot) {
		colliderDebugRoot.visible = on
	}
})

function togglePlay(): void {
	if (durationMax.value <= 0) {
		return
	}
	if (playbackTime.value >= durationMax.value) {
		playbackTime.value = 0
	}
	isPlaying.value = !isPlaying.value
}

function toggleLoopPlayback(): void {
	loopPlayback.value = !loopPlayback.value
}

function onScrubInput(ev: Event): void {
	isPlaying.value = false
	const el = ev.target as HTMLInputElement
	playbackTime.value = Number(el.value)
}

function toggleColliderWireframes(): void {
	showColliderWireframes.value = !showColliderWireframes.value
}
</script>

<template>
	<div class="three-viewport">
		<div v-if="!hideIntroHeading" class="panel-heading three-heading">
			<div>
				<h2>3D playback</h2>
				<p>
					Side, top, and orbit (drag in the right third; wheel zooms). Meshes use basic materials; ball and each pin
					match chart hues. Switch source to compare original keyframes vs compressed interpolation.
				</p>
			</div>
		</div>

		<div ref="canvasWrapRef" class="three-canvas-wrap">
			<div class="view-labels" aria-hidden="true">
				<span>Side</span>
				<span>Top</span>
				<span>Orbit</span>
			</div>
			<div ref="threeHostRef" class="three-host" />
		</div>

		<div class="three-controls-bar">
			<div class="source-toggle" role="radiogroup" aria-label="Keyframe source">
				<button
					type="button"
					class="axis-toggle-btn"
					:class="{ 'axis-toggle-btn--on': playbackSource === 'original' }"
					role="radio"
					:aria-checked="playbackSource === 'original'"
					@click="playbackSource = 'original'"
				>
					Original
				</button>
				<button
					type="button"
					class="axis-toggle-btn"
					:class="{ 'axis-toggle-btn--on': playbackSource === 'compressed' }"
					role="radio"
					:aria-checked="playbackSource === 'compressed'"
					@click="playbackSource = 'compressed'"
				>
					Compressed
				</button>
			</div>

			<div class="transport">
				<button class="play-btn" type="button" :disabled="durationMax <= 0" @click="togglePlay">
					{{ isPlaying ? 'Pause' : 'Play' }}
				</button>
				<button
					type="button"
					class="loop-toggle"
					:class="{ 'loop-toggle--on': loopPlayback }"
					:aria-pressed="loopPlayback"
					aria-label="Loop playback"
					title="Loop playback when timeline reaches the end"
					@click="toggleLoopPlayback"
				>
					<i class="fa-solid fa-repeat" aria-hidden="true" />
					<span class="loop-toggle-label">Loop</span>
				</button>
				<label class="speed">
					<span>Speed</span>
					<input v-model.number="playbackSpeed" type="number" min="0.25" max="4" step="0.25" />
				</label>

				<button
					type="button"
					class="loop-toggle"
					:class="{ 'loop-toggle--on': showColliderWireframes }"
					:aria-pressed="showColliderWireframes"
					aria-label="Toggle collider wireframe outlines"
					title="Cannon collider wireframes: lane, pins, ball"
					@click="toggleColliderWireframes"
				>
					<i class="fa-solid fa-vector-square" aria-hidden="true" />
					<span class="loop-toggle-label">Outlines</span>
				</button>
			</div>
		</div>

		<div class="three-scrub-bar" role="group" aria-label="Playback timeline">
			<div class="scrub">
				<span class="scrub-time">{{ playbackTime.toFixed(2) }}s</span>
				<input
					type="range"
					:min="0"
					:max="durationMax"
					:step="0.01"
					:value="playbackTime"
					@input="onScrubInput"
				/>
				<span class="scrub-end">{{ durationMax.toFixed(2) }}s</span>
			</div>
		</div>
	</div>
</template>

<style scoped>
.three-viewport {
	display: grid;
	gap: 12px;
}

.three-heading {
	margin-bottom: 0;
}

.three-heading p {
	margin: 6px 0 0;
}

.three-controls-bar {
	display: flex;
	flex-wrap: wrap;
	gap: 14px 20px;
	align-items: center;
	width: 100%;
	color: #dbe7f3;
	font-size: 0.92rem;
}

.three-scrub-bar {
	width: 100%;
	display: block;
}

.source-toggle {
	display: inline-flex;
	flex-wrap: nowrap;
	gap: 8px;
	align-items: center;
}

.axis-toggle-btn {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	border: 1px solid rgba(148, 163, 184, 0.28);
	border-radius: 10px;
	padding: 8px 10px;
	cursor: pointer;
	font: inherit;
	font-size: 0.88rem;
	font-weight: 600;
	color: #cbd5e1;
	background: rgba(15, 23, 42, 0.65);
	white-space: nowrap;
	min-width: 2.5rem;
	transition:
		background 0.15s ease,
		border-color 0.15s ease,
		color 0.15s ease;
}

.axis-toggle-btn:hover {
	border-color: rgba(56, 189, 248, 0.45);
	color: #e2e8f0;
}

.axis-toggle-btn--on {
	border-color: rgba(56, 189, 248, 0.65);
	background: rgba(14, 165, 233, 0.18);
	color: #7dd3fc;
}

.axis-toggle-btn:focus-visible {
	outline: 2px solid rgba(56, 189, 248, 0.55);
	outline-offset: 2px;
}

.transport {
	display: flex;
	gap: 12px;
	align-items: center;
}

.play-btn {
	border: 0;
	border-radius: 10px;
	padding: 8px 16px;
	cursor: pointer;
	background: linear-gradient(135deg, #0ea5e9, #2563eb);
	color: #fff;
	font: inherit;
}

.play-btn:disabled {
	opacity: 0.45;
	cursor: not-allowed;
}

.loop-toggle {
	display: inline-flex;
	gap: 8px;
	align-items: center;
	border: 1px solid rgba(148, 163, 184, 0.28);
	border-radius: 10px;
	padding: 8px 12px;
	cursor: pointer;
	font: inherit;
	color: #cbd5e1;
	background: rgba(15, 23, 42, 0.65);
	transition:
		background 0.15s ease,
		border-color 0.15s ease,
		color 0.15s ease;
}

.loop-toggle:hover {
	border-color: rgba(56, 189, 248, 0.45);
	color: #e2e8f0;
}

.loop-toggle--on {
	border-color: rgba(56, 189, 248, 0.65);
	background: rgba(14, 165, 233, 0.18);
	color: #7dd3fc;
}

.loop-toggle-label {
	font-size: 0.88rem;
}

.speed {
	display: inline-flex;
	gap: 8px;
	align-items: center;
}

.speed span {
	color: #94a3b8;
}

.speed input {
	width: 4.5rem;
	padding: 6px 8px;
	border-radius: 8px;
	border: 1px solid rgba(148, 163, 184, 0.2);
	background: rgba(15, 23, 42, 0.7);
	color: #f8fafc;
	font: inherit;
}

.scrub {
	display: flex;
	width: 100%;
	gap: 12px;
	align-items: center;
	min-width: 0;
	box-sizing: border-box;
}

.scrub input[type='range'] {
	flex: 1;
	min-width: 0;
}

.scrub-time,
.scrub-end {
	color: #94a3b8;
	font-variant-numeric: tabular-nums;
	white-space: nowrap;
}

.three-canvas-wrap {
	position: relative;
	border-radius: 12px;
	overflow: hidden;
	border: 1px solid rgba(148, 163, 184, 0.14);
	background: #050a12;
	min-height: 300px;
	height: min(36vh, 420px);
}

.three-host :deep(.three-canvas) {
	display: block;
	width: 100%;
	height: 100%;
}

.view-labels {
	position: absolute;
	inset: 0;
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	pointer-events: none;
	z-index: 1;
}

.view-labels span {
	padding: 8px 10px;
	font-size: 0.75rem;
	text-transform: uppercase;
	letter-spacing: 0.08em;
	color: rgba(226, 232, 240, 0.65);
	align-self: start;
	justify-self: start;
}
</style>
