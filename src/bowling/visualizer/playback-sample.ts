import type {
	QuaternionType,
	SimulationResult,
	SimObjectKeyframe,
	SimObjectKeyframes,
	Vector3Type,
} from '../types'

const IDENTITY_QUAT: QuaternionType = { x: 0, y: 0, z: 0, w: 1 }

type PosAnchor = { time: number; p: Vector3Type }
type RotAnchor = { time: number; q: QuaternionType }

/**
 * Fills a dense pose at each key time. Keys may omit `position` or `rotation` (RDP can store them on different
 * time samples); this interpolates in time from the sparse anchors, using forward / backward / linear segments.
 */
function materializeKeyframes(
	keyframes: SimObjectKeyframe[],
): Array<{ time: number; position: Vector3Type; rotation: QuaternionType }> {
	if (keyframes.length === 0) {
		return []
	}
	const posAnchors: PosAnchor[] = []
	const rotAnchors: RotAnchor[] = []
	for (const kf of keyframes) {
		if (kf.position) {
			posAnchors.push({ time: kf.time, p: kf.position })
		}
		if (kf.rotation) {
			rotAnchors.push({ time: kf.time, q: kf.rotation })
		}
	}
	const defP = posAnchors[0]?.p ?? { x: 0, y: 0, z: 0 }
	const defQ = rotAnchors[0]?.q ?? { ...IDENTITY_QUAT }

	return keyframes.map((kf) => ({
		time: kf.time,
		position: lerp3FromTimeAnchors(posAnchors, kf.time, defP),
		rotation: slerpFromTimeAnchors(rotAnchors, kf.time, defQ),
	}))
}

function lerpVec3(a: Vector3Type, b: Vector3Type, t: number): Vector3Type {
	return {
		x: a.x + (b.x - a.x) * t,
		y: a.y + (b.y - a.y) * t,
		z: a.z + (b.z - a.z) * t,
	}
}

function lerp3FromTimeAnchors(
	anchors: Array<{ time: number; p: Vector3Type }>,
	t: number,
	defaultP: Vector3Type,
): Vector3Type {
	if (anchors.length === 0) {
		return { ...defaultP }
	}
	if (t <= anchors[0]!.time) {
		return { ...anchors[0]!.p }
	}
	const lastA = anchors[anchors.length - 1]!
	if (t >= lastA.time) {
		return { ...lastA.p }
	}
	let i = 0
	for (let j = 0; j < anchors.length - 1; j += 1) {
		if (anchors[j + 1]!.time >= t) {
			i = j
			break
		}
	}
	const a = anchors[i]!
	const b = anchors[i + 1]!
	const span = b.time - a.time
	const u = span > 1e-12 ? (t - a.time) / span : 0
	return lerpVec3(a.p, b.p, u)
}

function slerpFromTimeAnchors(
	anchors: Array<{ time: number; q: QuaternionType }>,
	t: number,
	defaultQ: QuaternionType,
): QuaternionType {
	if (anchors.length === 0) {
		return { ...defaultQ }
	}
	if (t <= anchors[0]!.time) {
		return { ...anchors[0]!.q }
	}
	const lastA = anchors[anchors.length - 1]!
	if (t >= lastA.time) {
		return { ...lastA.q }
	}
	let i = 0
	for (let j = 0; j < anchors.length - 1; j += 1) {
		if (anchors[j + 1]!.time >= t) {
			i = j
			break
		}
	}
	const a = anchors[i]!
	const b = anchors[i + 1]!
	const span = b.time - a.time
	const u = span > 1e-12 ? (t - a.time) / span : 0
	return slerpQuat(a.q, b.q, u)
}

function slerpQuat(a: QuaternionType, b: QuaternionType, t: number): QuaternionType {
	let cosHalfTheta = a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z
	if (cosHalfTheta < 0) {
		cosHalfTheta = -cosHalfTheta
		b = { x: -b.x, y: -b.y, z: -b.z, w: -b.w }
	}

	if (Math.abs(cosHalfTheta) >= 1 - 1e-6) {
		return { ...a }
	}

	const sqrSinHalfTheta = 1 - cosHalfTheta * cosHalfTheta
	if (sqrSinHalfTheta <= 1e-12) {
		return {
			x: a.x * 0.5 + b.x * 0.5,
			y: a.y * 0.5 + b.y * 0.5,
			z: a.z * 0.5 + b.z * 0.5,
			w: a.w * 0.5 + b.w * 0.5,
		}
	}

	const sinHalfTheta = Math.sqrt(sqrSinHalfTheta)
	const halfTheta = Math.atan2(sinHalfTheta, cosHalfTheta)
	const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta
	const ratioB = Math.sin(t * halfTheta) / sinHalfTheta

	return {
		x: a.x * ratioA + b.x * ratioB,
		y: a.y * ratioA + b.y * ratioB,
		z: a.z * ratioA + b.z * ratioB,
		w: a.w * ratioA + b.w * ratioB,
	}
}

function sampleMaterialized(
	materialized: Array<{ time: number; position: Vector3Type; rotation: QuaternionType }>,
	time: number,
): { position: Vector3Type; rotation: QuaternionType } {
	if (materialized.length === 0) {
		return { position: { x: 0, y: 0, z: 0 }, rotation: { ...IDENTITY_QUAT } }
	}

	if (time <= materialized[0]!.time) {
		const first = materialized[0]!
		return { position: { ...first.position }, rotation: { ...first.rotation } }
	}

	const last = materialized[materialized.length - 1]!
	if (time >= last.time) {
		return { position: { ...last.position }, rotation: { ...last.rotation } }
	}

	if (materialized.length === 1) {
		const only = materialized[0]!
		return { position: { ...only.position }, rotation: { ...only.rotation } }
	}

	let i = 0
	for (let j = 0; j < materialized.length - 1; j += 1) {
		if (materialized[j + 1]!.time >= time) {
			i = j
			break
		}
	}

	const a = materialized[i]!
	const b = materialized[i + 1]!
	const span = b.time - a.time
	const u = span > 1e-12 ? (time - a.time) / span : 0

	return {
		position: lerpVec3(a.position, b.position, u),
		rotation: slerpQuat(a.rotation, b.rotation, u),
	}
}

export function sampleTrackAtTime(
	track: SimObjectKeyframes,
	time: number,
): { position: Vector3Type; rotation: QuaternionType } | null {
	if (track.keyframes.length === 0) {
		return null
	}
	const materialized = materializeKeyframes(track.keyframes)
	return sampleMaterialized(materialized, time)
}

export function maxTrackTime(track: SimObjectKeyframes): number {
	const last = track.keyframes.at(-1)
	return last?.time ?? 0
}

export function maxPlaybackTime(result: SimulationResult): number {
	let maxT = maxTrackTime(result.ballKeyframes)
	for (const pinTrack of result.pinsKeyframes) {
		maxT = Math.max(maxT, maxTrackTime(pinTrack))
	}
	return maxT
}

export type PlaybackBodyPose = {
	position: Vector3Type
	rotation: QuaternionType
}

export type PlaybackSample = {
	ball: PlaybackBodyPose
	pins: Array<PlaybackBodyPose | null>
}

export function samplePlaybackAtTime(result: SimulationResult, time: number): PlaybackSample {
	const ballSample = sampleTrackAtTime(result.ballKeyframes, time)
	const ball: PlaybackBodyPose = ballSample ?? {
		position: { x: 0, y: 0, z: 0 },
		rotation: { ...IDENTITY_QUAT },
	}

	const pins: Array<PlaybackBodyPose | null> = result.pinsKeyframes.map((track) => {
		const s = sampleTrackAtTime(track, time)
		return s ? { position: s.position, rotation: s.rotation } : null
	})

	return { ball, pins }
}
