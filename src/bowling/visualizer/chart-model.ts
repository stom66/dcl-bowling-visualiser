import { countSimulationKeyframes } from 'src/bowling/physics/physics.keyframe-optimization'
import type { ChannelKey } from 'src/bowling/visualizer/keyframe-channels'
import type { SimulationComparison, SimObjectKeyframe, SimObjectKeyframes } from 'src/bowling/physics/types'

export type DatasetKey = 'original' | 'compressed'
export type EntityKind = 'ball' | 'pin'

export type ChartSeries = {
	id: string
	name: string
	dataset: DatasetKey
	entityKind: EntityKind
	entityIndex: number
	points: Array<[number, number]>
}

export type ChannelStats = {
	channel: ChannelKey
	originalKeyframes: number
	compressedKeyframes: number
	savedKeyframes: number
	reductionPercent: number
}

export type EntityStats = {
	key: string
	label: string
	entityKind: EntityKind
	entityIndex: number
	originalKeyframes: number
	compressedKeyframes: number
	savedKeyframes: number
	reductionPercent: number
	channelStats: ChannelStats[]
}

export type OverallStats = {
	originalKeyframes: number
	compressedKeyframes: number
	savedKeyframes: number
	reductionPercent: number
	standingPins: number
	knockedPins: number
	channelStats: ChannelStats[]
}

export type SimulationChartModel = {
	seriesByChannel: Record<ChannelKey, ChartSeries[]>
	entities: EntityStats[]
	overall: OverallStats
}

export const CHANNEL_OPTIONS: Array<{ value: ChannelKey; label: string }> = [
	{ value: 'position.x', label: 'Position X' },
	{ value: 'position.y', label: 'Position Y' },
	{ value: 'position.z', label: 'Position Z' },
	{ value: 'rotation.x', label: 'Rotation X (°)' },
	{ value: 'rotation.y', label: 'Rotation Y (°)' },
	{ value: 'rotation.z', label: 'Rotation Z (°)' },
]


// MARK: buildSimulationChartModel
/**
 * Builds per-channel ECharts series, per-entity stats, and aggregate stats from a simulation comparison payload.
 */
export function buildSimulationChartModel(comparison: SimulationComparison): SimulationChartModel {
	const trackPairs = [
		{
			key: 'ball',
			label: comparison.original.ballKeyframes.label,
			entityKind: 'ball' as const,
			entityIndex: comparison.original.ballKeyframes.index,
			original: comparison.original.ballKeyframes,
			compressed: comparison.compressed.ballKeyframes,
		},
		...comparison.original.pinsKeyframes.map((track, index) => ({
			key: `pin-${track.index}`,
			label: track.label,
			entityKind: 'pin' as const,
			entityIndex: track.index,
			original: track,
			compressed: comparison.compressed.pinsKeyframes[index]!,
		})),
	]

	const entities = trackPairs.map((pair) => buildEntityStats(pair))
	const seriesByChannel = Object.fromEntries(
		CHANNEL_OPTIONS.map(({ value }) => [value, buildSeriesForChannel(trackPairs, value)]),
	) as Record<ChannelKey, ChartSeries[]>

	const originalKeyframes = countSimulationKeyframes(comparison.original)
	const compressedKeyframes = countSimulationKeyframes(comparison.compressed)

	return {
		seriesByChannel,
		entities,
		overall: {
			originalKeyframes,
			compressedKeyframes,
			savedKeyframes: originalKeyframes - compressedKeyframes,
			reductionPercent: percentage(originalKeyframes - compressedKeyframes, originalKeyframes),
			standingPins: comparison.finalPinStates.filter(Boolean).length,
			knockedPins: comparison.finalPinStates.filter((state) => !state).length,
			channelStats: CHANNEL_OPTIONS.map(({ value }) => buildAggregateChannelStats(trackPairs, value)),
		},
	}
}


// MARK: buildSeriesForChannel
function buildSeriesForChannel(
	tracks: Array<{
		key: string
		label: string
		entityKind: EntityKind
		entityIndex: number
		original: SimObjectKeyframes
		compressed: SimObjectKeyframes
	}>,
	channel: ChannelKey,
): ChartSeries[] {
	return tracks.flatMap((track) => [
		{
			id: `${track.key}-${channel}-original`,
			name: `${track.label} original`,
			dataset: 'original' as const,
			entityKind: track.entityKind,
			entityIndex: track.entityIndex,
			points: toSeriesPoints(track.original.keyframes, channel),
		},
		{
			id: `${track.key}-${channel}-compressed`,
			name: `${track.label} compressed`,
			dataset: 'compressed' as const,
			entityKind: track.entityKind,
			entityIndex: track.entityIndex,
			points: toSeriesPoints(track.compressed.keyframes, channel),
		},
	])
}


// MARK: buildEntityStats
function buildEntityStats(track: {
	key: string
	label: string
	entityKind: EntityKind
	entityIndex: number
	original: SimObjectKeyframes
	compressed: SimObjectKeyframes
}): EntityStats {
	const originalKeyframes = track.original.keyframes.length
	const compressedKeyframes = track.compressed.keyframes.length

	return {
		key: track.key,
		label: track.label,
		entityKind: track.entityKind,
		entityIndex: track.entityIndex,
		originalKeyframes,
		compressedKeyframes,
		savedKeyframes: originalKeyframes - compressedKeyframes,
		reductionPercent: percentage(originalKeyframes - compressedKeyframes, originalKeyframes),
		channelStats: CHANNEL_OPTIONS.map(({ value }) => ({
			channel: value,
			originalKeyframes: countChannelKeyframes(track.original.keyframes, value),
			compressedKeyframes: countChannelKeyframes(track.compressed.keyframes, value),
			savedKeyframes:
				countChannelKeyframes(track.original.keyframes, value) -
				countChannelKeyframes(track.compressed.keyframes, value),
			reductionPercent: percentage(
				countChannelKeyframes(track.original.keyframes, value) -
					countChannelKeyframes(track.compressed.keyframes, value),
				countChannelKeyframes(track.original.keyframes, value),
			),
		})),
	}
}


// MARK: buildAggregateChannelStats
function buildAggregateChannelStats(
	tracks: Array<{
		original: SimObjectKeyframes
		compressed: SimObjectKeyframes
	}>,
	channel: ChannelKey,
): ChannelStats {
	const originalKeyframes = tracks.reduce(
		(sum, track) => sum + countChannelKeyframes(track.original.keyframes, channel),
		0,
	)
	const compressedKeyframes = tracks.reduce(
		(sum, track) => sum + countChannelKeyframes(track.compressed.keyframes, channel),
		0,
	)

	return {
		channel,
		originalKeyframes,
		compressedKeyframes,
		savedKeyframes: originalKeyframes - compressedKeyframes,
		reductionPercent: percentage(originalKeyframes - compressedKeyframes, originalKeyframes),
	}
}


// MARK: toSeriesPoints
function toSeriesPoints(
	keyframes: SimObjectKeyframe[],
	channel  : ChannelKey,
): Array<[number, number]> {
	return keyframes.flatMap((keyframe) => {
		const value = getChannelValue(keyframe, channel)
		return value === undefined ? [] : [[keyframe.time, value] as [number, number]]
	})
}


// MARK: countChannelKeyframes
function countChannelKeyframes(
	keyframes: SimObjectKeyframe[],
	channel  : ChannelKey,
): number {
	return keyframes.filter((keyframe) => getChannelValue(keyframe, channel) !== undefined).length
}


// MARK: getChannelValue
function getChannelValue(
	keyframe: SimObjectKeyframe,
	channel : ChannelKey,
): number | undefined {
	switch (channel) {
		case 'position.x':
			return keyframe.position?.x
		case 'position.y':
			return keyframe.position?.y
		case 'position.z':
			return keyframe.position?.z
		case 'rotation.x':
			return keyframe.rotation?.x
		case 'rotation.y':
			return keyframe.rotation?.y
		case 'rotation.z':
			return keyframe.rotation?.z
	}
}


// MARK: percentage
function percentage(
	saved: number,
	total: number,
): number {
	if (total <= 0) {
		return 0
	}

	return (saved / total) * 100
}
