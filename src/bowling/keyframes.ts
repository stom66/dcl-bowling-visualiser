import type { Quat, RawSimulationResult, SimObjectKeyframe, SimObjectKeyframes, Vec3 } from './types'

export type ChannelKey =
	| 'position.x'
	| 'position.y'
	| 'position.z'
	| 'rotation.x'
	| 'rotation.y'
	| 'rotation.z'
	| 'rotation.w'

// MARK: compressKeyframeTrack
export function compressKeyframeTrack(
	keyframes: SimObjectKeyframe[],
	epsilon  : number,
): SimObjectKeyframe[] {
	const reducedKeyframes: SimObjectKeyframe[] = []

	for (const [index, keyframe] of keyframes.entries()) {
		const nextKeyframe     = keyframes[index + 1]
		const previousKeyframe = keyframes[index - 1]
		const reducedKeyframe  : SimObjectKeyframe = { time: keyframe.time }

		if (
			!previousKeyframe?.position ||
			!nextKeyframe?.position ||
			!keyframe.position ||
			!areVec3Equal(previousKeyframe.position, keyframe.position, epsilon) ||
			!areVec3Equal(keyframe.position, nextKeyframe.position, epsilon)
		) {
			reducedKeyframe.position = keyframe.position
		}

		if (
			!previousKeyframe?.rotation ||
			!nextKeyframe?.rotation ||
			!keyframe.rotation ||
			!areQuatEqual(previousKeyframe.rotation, keyframe.rotation, epsilon) ||
			!areQuatEqual(keyframe.rotation, nextKeyframe.rotation, epsilon)
		) {
			reducedKeyframe.rotation = keyframe.rotation
		}

		if (reducedKeyframe.position || reducedKeyframe.rotation) {
			reducedKeyframes.push(reducedKeyframe)
		}
	}

	return reducedKeyframes
}

// MARK: compressSimulationResult
export function compressSimulationResult(
	result : RawSimulationResult,
	epsilon: number,
): RawSimulationResult {
	return {
		ballKeyframes : compressTrack(result.ballKeyframes, epsilon),
		pinsKeyframes : result.pinsKeyframes.map((track) => compressTrack(track, epsilon)),
		finalPinStates: [...result.finalPinStates],
	}
}

// MARK: compressTrack
export function compressTrack(
	track  : SimObjectKeyframes,
	epsilon: number,
): SimObjectKeyframes {
	return {
		index    : track.index,
		label    : track.label,
		keyframes: compressKeyframeTrack(track.keyframes, epsilon),
	}
}

// MARK: countTrackKeyframes
export function countTrackKeyframes(track: SimObjectKeyframes): number {
	return track.keyframes.length
}

// MARK: countSimulationKeyframes
export function countSimulationKeyframes(result: RawSimulationResult): number {
	return (
		countTrackKeyframes(result.ballKeyframes) +
		result.pinsKeyframes.reduce((sum, track) => sum + countTrackKeyframes(track), 0)
	)
}

// MARK: estimateTrackBytes
export function estimateTrackBytes(track: SimObjectKeyframes): number {
	return track.keyframes.reduce((sum, keyframe) => sum + estimateKeyframeBytes(keyframe), 0)
}

// MARK: estimateSimulationBytes
export function estimateSimulationBytes(result: RawSimulationResult): number {
	return (
		estimateTrackBytes(result.ballKeyframes) +
		result.pinsKeyframes.reduce((sum, track) => sum + estimateTrackBytes(track), 0)
	)
}

// MARK: estimateKeyframeBytes
export function estimateKeyframeBytes(keyframe: SimObjectKeyframe): number {
	return new TextEncoder().encode(JSON.stringify(keyframe)).length
}

// MARK: listKeyframeChannels
export function listKeyframeChannels(keyframe: SimObjectKeyframe): ChannelKey[] {
	const channels: ChannelKey[] = []

	if (keyframe.position) {
		channels.push('position.x', 'position.y', 'position.z')
	}

	if (keyframe.rotation) {
		channels.push('rotation.x', 'rotation.y', 'rotation.z', 'rotation.w')
	}

	return channels
}

// MARK: Utils

function areVec3Equal(
	left    : Vec3,
	right   : Vec3,
	epsilon : number,
): boolean {
	return (
		Math.abs(left.x - right.x) <= epsilon &&
		Math.abs(left.y - right.y) <= epsilon &&
		Math.abs(left.z - right.z) <= epsilon
	)
}

function areQuatEqual(
	left    : Quat,
	right   : Quat,
	epsilon : number,
): boolean {
	const dot = left.x * right.x + left.y * right.y + left.z * right.z + left.w * right.w
	return 1 - Math.abs(dot) < epsilon
}
