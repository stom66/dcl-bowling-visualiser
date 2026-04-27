import type { SimObjectKeyframe } from 'src/bowling/physics/types'


/** Per-axis channel id for charting / UI; not part of the portable keyframe payload shape. */
export type ChannelKey =
	| 'position.x'
	| 'position.y'
	| 'position.z'
	| 'rotation.x'
	| 'rotation.y'
	| 'rotation.z'


// MARK: listKeyframeChannels
/**
 * Lists which scalar channels are present (from position and/or rotation) on `keyframe`.
 */
export function listKeyframeChannels(keyframe: SimObjectKeyframe): ChannelKey[] {
	const channels: ChannelKey[] = []

	if (keyframe.position) {
		channels.push('position.x', 'position.y', 'position.z')
	}

	if (keyframe.rotation) {
		channels.push('rotation.x', 'rotation.y', 'rotation.z')
	}

	return channels
}
