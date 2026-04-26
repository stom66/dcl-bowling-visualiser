/**
 * Byte length for one authoritative-server roll playback message, matching the
 * pattern in dcl-bowling `room.ts`: envelope + `NOTIFY_PLAYER_ROLL_PLAYBACK`
 * body serialized with `@dcl/sdk` Schemas + `ReadWriteByteBuffer`, plus the
 * custom-event wrapper byte.
 *
 * Chart “JSON bytes” (UTF-8 length of `JSON.stringify` per keyframe) live in
 * `./keyframe-json-footprint.ts` — a different metric from this wire serialization.
 *
 * **Versions:** wire layout follows whatever `@dcl/sdk` / `@dcl/ecs` your auth
 * server uses. Pin `@dcl/sdk` in this app to the same release (or add an explicit
 * `@dcl/ecs` that matches that SDK’s dependency) so these bytes stay comparable
 * to `getMessagePayloadSizeBytes` in your `room.ts`. If the server schema changes,
 * update `rollReplayPayloadSchema` here to stay in sync.
 */
import { ReadWriteByteBuffer } from '@dcl/ecs/dist/serialization/ByteBuffer'
import { Schemas } from '@dcl/sdk/ecs'

import type { SimulationComparison, SimulationResult, SimObjectKeyframe } from '../types'

/** Same event string as `MessageType.NOTIFY_PLAYER_ROLL_PLAYBACK` in authoritative bowling. */
export const NOTIFY_PLAYER_ROLL_PLAYBACK = 'notifyPlayerRollPlayback'

/** Same as `room.ts` CUSTOM_EVENT_WRAPPER_BYTES. */
export const CUSTOM_EVENT_WRAPPER_BYTES = 1

const eventEnvelopeSchema = Schemas.Map({
	eventType: Schemas.String,
	timestamp: Schemas.Int64,
})

/** Mirrors `rollReplaySchema` in `dcl/src/shared/room.ts` (authoritative server). */
const rollReplayPayloadSchema = Schemas.Map({
	frameIndex: Schemas.Number,
	rollIndex: Schemas.Int,
	startingPinStates: Schemas.Array(Schemas.Boolean),
	finalPinStates: Schemas.Array(Schemas.Boolean),
	ballKeyframes: Schemas.Map({
		index: Schemas.Int,
		keyframes: Schemas.Array(
			Schemas.Map({
				time: Schemas.Number,
				position: Schemas.Optional(Schemas.Vector3),
				rotation: Schemas.Optional(Schemas.Quaternion),
			}),
		),
	}),
	pinsKeyframes: Schemas.Array(
		Schemas.Map({
			index: Schemas.Int,
			keyframes: Schemas.Array(
				Schemas.Map({
					time: Schemas.Number,
					position: Schemas.Optional(Schemas.Vector3),
					rotation: Schemas.Optional(Schemas.Quaternion),
				}),
			),
		}),
	),
	score: Schemas.Number,
	sentAt: Schemas.Int64,
	userId: Schemas.String,
})

export type RollPlaybackWireMeta = {
	frameIndex: number
	rollIndex: number
	score: number
	/** Serialized as UTF-8; use the same string when comparing original vs compressed. */
	userId: string
}

/** Default meta for dashboard estimates (fixed-length user id keeps comparisons apples-to-apples). */
export const DEFAULT_ROLL_PLAYBACK_WIRE_META: RollPlaybackWireMeta = {
	frameIndex: 0,
	rollIndex: 0,
	score: 0,
	userId: '0x0123456789abcdef0123456789abcdef01234567',
}

function keyframeToWire(kf: SimObjectKeyframe): {
	time: number
	position?: { x: number; y: number; z: number }
	rotation?: { x: number; y: number; z: number; w: number }
} {
	const out: {
		time: number
		position?: { x: number; y: number; z: number }
		rotation?: { x: number; y: number; z: number; w: number }
	} = { time: kf.time }
	if (kf.position !== undefined) {
		out.position = { x: kf.position.x, y: kf.position.y, z: kf.position.z }
	}
	if (kf.rotation !== undefined) {
		out.rotation = {
			x: kf.rotation.x,
			y: kf.rotation.y,
			z: kf.rotation.z,
			w: kf.rotation.w,
		}
	}
	return out
}

export function buildRollPlaybackPayload(
	result: SimulationResult,
	startingPinStates: boolean[],
	meta: RollPlaybackWireMeta,
) {
	return {
		frameIndex: meta.frameIndex,
		rollIndex: meta.rollIndex,
		startingPinStates: [...startingPinStates],
		finalPinStates: [...result.finalPinStates],
		ballKeyframes: {
			index: result.ballKeyframes.index,
			keyframes: result.ballKeyframes.keyframes.map(keyframeToWire),
		},
		pinsKeyframes: result.pinsKeyframes.map((track) => ({
			index: track.index,
			keyframes: track.keyframes.map(keyframeToWire),
		})),
		score: meta.score,
		sentAt: Date.now(),
		userId: meta.userId,
	}
}

/**
 * Same measurement as `getMessagePayloadSizeBytes(NOTIFY_PLAYER_ROLL_PLAYBACK, data)` in `room.ts`.
 */
export function getRollPlaybackMessagePayloadSizeBytes(
	data: ReturnType<typeof buildRollPlaybackPayload>,
	timestampMs: number,
): number {
	const buffer = new ReadWriteByteBuffer()
	eventEnvelopeSchema.serialize(
		{
			eventType: NOTIFY_PLAYER_ROLL_PLAYBACK,
			timestamp: timestampMs,
		},
		buffer,
	)
	rollReplayPayloadSchema.serialize(data as never, buffer)
	return buffer.toBinary().byteLength + CUSTOM_EVENT_WRAPPER_BYTES
}

export type RollPlaybackWireSizeEstimate = {
	originalBytes: number
	compressedBytes: number
	savedBytes: number
	savingsPercent: number
}

/**
 * Serialized sizes for original vs compressed tracks inside one roll playback message.
 * Uses a fixed `timestampMs` so two payloads differ only by keyframe data (fair diff).
 */
export function estimateRollPlaybackWireSizes(
	comparison: SimulationComparison,
	meta: RollPlaybackWireMeta = DEFAULT_ROLL_PLAYBACK_WIRE_META,
	timestampMs: number = 1_700_000_000_000,
): RollPlaybackWireSizeEstimate {
	const originalPayload = buildRollPlaybackPayload(
		comparison.original,
		comparison.startingPinStates,
		meta,
	)
	const compressedPayload = buildRollPlaybackPayload(
		comparison.compressed,
		comparison.startingPinStates,
		meta,
	)

	const originalBytes = getRollPlaybackMessagePayloadSizeBytes(originalPayload, timestampMs)
	const compressedBytes = getRollPlaybackMessagePayloadSizeBytes(compressedPayload, timestampMs)
	const savedBytes = originalBytes - compressedBytes
	const savingsPercent = originalBytes > 0 ? (100 * savedBytes) / originalBytes : 0

	return {
		originalBytes,
		compressedBytes,
		savedBytes,
		savingsPercent,
	}
}
