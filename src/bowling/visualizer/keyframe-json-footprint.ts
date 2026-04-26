/**
 * Rough **JSON text** footprint for keyframes (UTF-8 length of `JSON.stringify` per keyframe).
 * Used by the visualizer chart metrics only — not part of portable compression logic.
 *
 * For **on-wire** byte size matching the authoritative server roll playback message, use
 * `estimateRollPlaybackWireSizes` / `getRollPlaybackMessagePayloadSizeBytes` in
 * `./message-bus-roll-playback-size.ts` (SDK `Schemas` + `ReadWriteByteBuffer`).
 */
import type { SimulationResult, SimObjectKeyframe, SimObjectKeyframes } from '../types'

export function estimateKeyframeBytes(keyframe: SimObjectKeyframe): number {
	return new TextEncoder().encode(JSON.stringify(keyframe)).length
}

export function estimateTrackBytes(track: SimObjectKeyframes): number {
	return track.keyframes.reduce((sum, keyframe) => sum + estimateKeyframeBytes(keyframe), 0)
}

export function estimateSimulationBytes(result: SimulationResult): number {
	return (
		estimateTrackBytes(result.ballKeyframes) +
		result.pinsKeyframes.reduce((sum, track) => sum + estimateTrackBytes(track), 0)
	)
}
