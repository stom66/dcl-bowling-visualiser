<script setup lang="ts">
import { computed, provide, reactive, ref, watch } from 'vue'
import VChart, { THEME_KEY } from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { AxisPointerComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { LineChart, ScatterChart } from 'echarts/charts'

import {
	CHANNEL_OPTIONS,
	buildSimulationChartModel,
	type ChartSeries,
	type DatasetKey,
	type EntityKind,
} from '../bowling/visualizer/chart-model'
import { PIN_LANE_LOCAL_POSITIONS } from '../bowling/physics/physics.pin-layout'
import { DEFAULT_SIMULATION_INPUT, getSimulationResults } from '../bowling/physics/physics.client'
import { DefaultOptimizationSettings, GameSettings } from '../bowling/physics/physics.settings'
import type { ChannelKey } from '../bowling/visualizer/keyframe-channels'
import type { OptimizationSettings, SimulationInput, SimulationSettings } from '../bowling/physics/types'
import { estimateRollPlaybackWireSizes } from '../bowling/visualizer/message-bus-roll-playback-size'
import BowlingThreeViewport from './BowlingThreeViewport.vue'

use([CanvasRenderer,GridComponent,LegendComponent,TooltipComponent,AxisPointerComponent,LineChart,ScatterChart])

function channelLabel(channel: ChannelKey): string {
	return CHANNEL_OPTIONS.find((option) => option.value === channel)?.label ?? channel
}

const chartTheme = 'dark'

/** Back row (high Z) → head pin; indices match `PIN_LANE_LOCAL_POSITIONS` / pin 1…N labels. */
function buildPinRackRows(): number[][] {
	const byZ = new Map<number, number[]>()
	for (let i = 0; i < PIN_LANE_LOCAL_POSITIONS.length; i += 1) {
		const z = Number(PIN_LANE_LOCAL_POSITIONS[i]?.[2] ?? 0)
		const key = Math.round(z * 1000) / 1000
		let row = byZ.get(key)
		if (!row) {
			row = []
			byZ.set(key, row)
		}
		row.push(i)
	}
	const zs = [...byZ.keys()].sort((a, b) => b - a)
	return zs.map((zKey) => {
		const indices = byZ.get(zKey)!
		return indices.slice().sort((a, b) => {
			const xa = Number(PIN_LANE_LOCAL_POSITIONS[a]?.[0] ?? 0)
			const xb = Number(PIN_LANE_LOCAL_POSITIONS[b]?.[0] ?? 0)
			return xa - xb
		})
	})
}

const PIN_RACK_ROWS = buildPinRackRows()

const form = reactive({
	position : { ...DEFAULT_SIMULATION_INPUT.position },
	direction: { ...DEFAULT_SIMULATION_INPUT.direction },
	strength : DEFAULT_SIMULATION_INPUT.strength,
	spin     : DEFAULT_SIMULATION_INPUT.spin,
	duration : DEFAULT_SIMULATION_INPUT.duration,
	pinStates: [...DEFAULT_SIMULATION_INPUT.pinStates],
})

/**
 * Aim yaw in degrees, right-hand about +Y: 0° = (0, 0, 1) straight +Z; +90° = (1, 0, 0) +X; +45° ≈ (0.707, 0, 0.707) normalized.
 * The slider and top-down SVG use the same θ as `form.direction` in the XZ plane.
 */
const DIRECTION_YAW_MIN = -15
const DIRECTION_YAW_MAX = 15

function yawDegFromDirectionXz(d: { x: number; z: number }): number {
	return (Math.atan2(d.x, d.z) * 180) / Math.PI
}

function clampDirectionYaw(deg: number): number {
	return Math.min(DIRECTION_YAW_MAX, Math.max(DIRECTION_YAW_MIN, deg))
}

function applyYawDegToForm(deg: number): void {
	const clamped = clampDirectionYaw(deg)
	const rad = (clamped * Math.PI) / 180
	form.direction.x = Math.sin(rad)
	form.direction.y = 0
	form.direction.z = Math.cos(rad)
}

const directionYawDeg = ref(
	clampDirectionYaw(yawDegFromDirectionXz(DEFAULT_SIMULATION_INPUT.direction)),
)

watch(
	directionYawDeg,
	(deg) => {
		const n = Number(deg)
		const clamped = clampDirectionYaw(Number.isFinite(n) ? n : 0)
		if (clamped !== deg) {
			directionYawDeg.value = clamped
			return
		}
		applyYawDegToForm(clamped)
	},
	{ immediate: true },
)

const showAimCompass = ref(false)

function toggleAimCompass(): void {
	showAimCompass.value = !showAimCompass.value
}

/** When true, show full X, Y, Z numeric fields (default: compact X range slider only). */
const showPositionAxes = ref(false)

function togglePositionAxes(): void {
	showPositionAxes.value = !showPositionAxes.value
}

function toggleLaneBumpers(): void {
	tuning.laneBumpersEnabled = !tuning.laneBumpersEnabled
	runSimulation()
}

const directionSvgRef = ref<SVGSVGElement | null>(null)
let directionPointerActive = false

const directionArrowTip = computed(() => {
	const rad = (directionYawDeg.value * Math.PI) / 180
	// Match top-down XZ: +Z is “up” on the SVG (−y), +X is to the right — same sense as the slider.
	return { x2: 50 + 36 * Math.sin(rad), y2: 50 - 36 * Math.cos(rad) }
})

function applyPointerToYaw(e: PointerEvent): void {
	const svg = directionSvgRef.value
	if (!svg) {
		return
	}
	const p = svg.createSVGPoint()
	p.x = e.clientX
	p.y = e.clientY
	const ctm = svg.getScreenCTM()
	if (!ctm) {
		return
	}
	const t = p.matrixTransform(ctm.inverse())
	const dx = t.x - 50
	const dz = -(t.y - 50)
	directionYawDeg.value = clampDirectionYaw((Math.atan2(dx, dz) * 180) / Math.PI)
}

function onDirectionPointerDown(e: PointerEvent): void {
	const svg = directionSvgRef.value
	if (!svg) {
		return
	}
	directionPointerActive = true
	svg.setPointerCapture(e.pointerId)
	applyPointerToYaw(e)
}

function onDirectionPointerMove(e: PointerEvent): void {
	if (!directionPointerActive) {
		return
	}
	applyPointerToYaw(e)
}

function onDirectionPointerUp(e: PointerEvent): void {
	if (!directionPointerActive) {
		return
	}
	directionPointerActive = false
	try {
		directionSvgRef.value?.releasePointerCapture(e.pointerId)
	} catch {
		/* ignore */
	}
}

function nudgeDirectionYaw(delta: number): void {
	directionYawDeg.value = clampDirectionYaw(directionYawDeg.value + delta)
}

function setDirectionYawToZero(): void {
	directionYawDeg.value = 0
}

const tuning = reactive({
	simFrameRate: GameSettings.simFrameRate,
	simSubSteps: GameSettings.simSubSteps,
	velocityRestEpsilon: GameSettings.velocityRestEpsilon,
	idleFrameCap: GameSettings.idleFrameCap,
	ballMass: GameSettings.ballMass,
	ballFriction: GameSettings.ballFriction,
	ballRestitution: GameSettings.ballRestitution,
	maxAngularVelocity: GameSettings.maxAngularVelocity,
	pinMass: GameSettings.pinMass,
	pinFriction: GameSettings.pinFriction,
	pinRestitution: GameSettings.pinRestitution,
	laneBumpersEnabled: GameSettings.laneBumpersEnabled,
	keyframeReductionEpsilon: DefaultOptimizationSettings.keyframeReductionEpsilon,
	keyframeRdpMaxPositionErrorM: DefaultOptimizationSettings.keyframeRdpMaxPositionErrorM,
	keyframeRdpMaxRotationErrorDeg: DefaultOptimizationSettings.keyframeRdpMaxRotationErrorDeg,
	keyframePrecontactMotionMinPosM: DefaultOptimizationSettings.keyframePrecontactMotionMinPosM,
	keyframePrecontactMotionMinRotDeg: DefaultOptimizationSettings.keyframePrecontactMotionMinRotDeg,
})

function tuningSimulationOverrides(): Partial<SimulationSettings> {
	return {
		simFrameRate: tuning.simFrameRate,
		simSubSteps: tuning.simSubSteps,
		velocityRestEpsilon: tuning.velocityRestEpsilon,
		idleFrameCap: tuning.idleFrameCap,
		ballMass: tuning.ballMass,
		ballFriction: tuning.ballFriction,
		ballRestitution: tuning.ballRestitution,
		maxAngularVelocity: tuning.maxAngularVelocity,
		pinMass: tuning.pinMass,
		pinFriction: tuning.pinFriction,
		pinRestitution: tuning.pinRestitution,
		laneBumpersEnabled: tuning.laneBumpersEnabled,
	}
}

function optimizationOverridesFromTuning(): Partial<OptimizationSettings> {
	return {
		keyframeReductionEpsilon: tuning.keyframeReductionEpsilon,
		keyframeRdpMaxPositionErrorM: tuning.keyframeRdpMaxPositionErrorM,
		keyframeRdpMaxRotationErrorDeg: tuning.keyframeRdpMaxRotationErrorDeg,
		keyframePrecontactMotionMinPosM: tuning.keyframePrecontactMotionMinPosM,
		keyframePrecontactMotionMinRotDeg: tuning.keyframePrecontactMotionMinRotDeg,
	}
}

const visibility = reactive({
	ballOriginal: true,
	ballCompressed: true,
	pinsOriginal: true,
	pinsCompressed: true,
	enabledPins: DEFAULT_SIMULATION_INPUT.pinStates.map(() => true),
})

function setAllPinTraceVisibility(visible: boolean) {
	for (let i = 0; i < visibility.enabledPins.length; i += 1) {
		visibility.enabledPins[i] = visible
	}
}

/** Global: which scalar channels to plot (each gets its own horizontal strip, same time axis). */
const axisToggles = reactive({
	positionX: true,
	positionY: true,
	positionZ: true,
	rotationX: false,
	rotationY: false,
	rotationZ: false,
})

const AXIS_CHANNEL_ORDER: ChannelKey[] = [
	'position.x',
	'position.y',
	'position.z',
	'rotation.x',
	'rotation.y',
	'rotation.z',
]

const CHANNEL_TO_AXIS_TOGGLE: Record<ChannelKey, keyof typeof axisToggles> = {
	'position.x': 'positionX',
	'position.y': 'positionY',
	'position.z': 'positionZ',
	'rotation.x': 'rotationX',
	'rotation.y': 'rotationY',
	'rotation.z': 'rotationZ',
}

const activeChannels = computed((): ChannelKey[] =>
	AXIS_CHANNEL_ORDER.filter((ch) => axisToggles[CHANNEL_TO_AXIS_TOGGLE[ch]]),
)

/** Legend + padding inside the chart (px); grids use % of remaining height below this. */
const CHART_TOP_RESERVE_PX = 52
/** Minimum readable height per axis row (px). Canvas height = reserve + n × row. */
const CHART_PX_PER_AXIS_ROW = 220
/** Safety cap so one page does not allocate absurd height if many axes are on. */
const CHART_MAX_HEIGHT_PX = 3600

const chartHeightPx = computed(() => {
	const n = activeChannels.value.length
	if (n === 0) {
		return 200
	}
	return Math.min(CHART_MAX_HEIGHT_PX, CHART_TOP_RESERVE_PX + n * CHART_PX_PER_AXIS_ROW)
})

const activeChannelsTitle = computed(() => {
	const ch = activeChannels.value
	if (ch.length === 0) {
		return 'No axes selected'
	}
	return ch.map((c) => channelLabel(c)).join(' · ')
})
const simulationResult = ref(
	getSimulationResults(
		DEFAULT_SIMULATION_INPUT,
		tuningSimulationOverrides(),
		optimizationOverridesFromTuning(),
	),
)

const chartModel = computed(() => buildSimulationChartModel(simulationResult.value))

/** One `notifyPlayerRollPlayback` message: envelope + binary body + wrapper byte (authoritative server layout). */
const messageBusRollPlayback = computed(() => estimateRollPlaybackWireSizes(simulationResult.value))

function filterVisibleChartSeries(seriesList: ChartSeries[]): ChartSeries[] {
	return seriesList.filter((series) => {
		if (series.entityKind === 'ball') {
			return series.dataset === 'original' ? visibility.ballOriginal : visibility.ballCompressed
		}

		const pinEnabled = visibility.enabledPins[series.entityIndex] ?? false
		if (!pinEnabled) {
			return false
		}

		return series.dataset === 'original' ? visibility.pinsOriginal : visibility.pinsCompressed
	})
}

const chartOption = computed(() => {
	const channels = activeChannels.value
	const model = chartModel.value

	if (channels.length === 0) {
		return {
			animation: false,
			grid: [],
			xAxis: [],
			yAxis: [],
			series: [],
			legend: { show: false },
			graphic: {
				type: 'text',
				left: 'center',
				top: 'middle',
				style: {
					text: 'Turn on at least one axis below (e.g. Position Z).',
					fill: '#94a3b8',
					fontSize: 15,
				},
			},
		}
	}

	const topStart = 13
	const bottomPad = 12
	const usable = 100 - topStart - bottomPad
	const nCh = channels.length
	/** Vertical gap between subplot rows (% of full chart height). */
	const interRowGapPct = nCh > 1 ? 2.2 : 0
	const slotHeight = (usable - (nCh - 1) * interRowGapPct) / nCh

	const grids = channels.map((_, i) => ({
		left: 52,
		right: 28,
		top: `${topStart + i * (slotHeight + interRowGapPct)}%`,
		height: `${slotHeight}%`,
	}))

	const xAxisIndices = channels.map((_, i) => i)

	const xAxes = channels.map((_, i) => ({
		type: 'value' as const,
		gridIndex: i,
		name: i === channels.length - 1 ? 'Time (s)' : '',
		nameLocation: 'middle' as const,
		nameGap: 30,
		axisLabel: { color: '#a7b1c2' },
		nameTextStyle: { color: '#a7b1c2' },
		splitLine: { lineStyle: { color: 'rgba(167, 177, 194, 0.1)' } },
	}))

	const yAxes = channels.map((ch, gridIndex) => ({
		type: 'value' as const,
		gridIndex,
		name: channelLabel(ch),
		axisLabel: { color: '#a7b1c2' },
		nameTextStyle: { color: '#a7b1c2' },
		splitLine: { lineStyle: { color: 'rgba(167, 177, 194, 0.1)' } },
	}))

	const legendNames = new Set<string>()
	const seriesPieces: Record<string, unknown>[] = []

	channels.forEach((ch, gridIndex) => {
		const list = filterVisibleChartSeries(model.seriesByChannel[ch])
		for (const s of list) {
			for (const piece of toEchartsSeries(s, ch)) {
				const name = String((piece as { name?: string }).name ?? '')
				if (name) {
					legendNames.add(name)
				}
				seriesPieces.push({
					...piece,
					gridIndex,
					xAxisIndex: gridIndex,
					yAxisIndex: gridIndex,
				})
			}
		}
	})

	return {
		animation: false,
		axisPointer: {
			link: [{ xAxisIndex: xAxisIndices }],
		},
		legend: {
			top: 4,
			type: 'scroll',
			data: [...legendNames],
			textStyle: { color: '#d9e0ee' },
		},
		tooltip: {
			trigger: 'axis',
			valueFormatter: (value: number) => Number(value).toFixed(3),
		},
		grid: grids,
		xAxis: xAxes,
		yAxis: yAxes,
		series: seriesPieces,
	}
})

/**
 * ECharts can retain stale series / grids after `setOption` even with `notMerge` when only visibility changes.
 * Remounting the chart instance clears internal caches so pin traces disappear immediately.
 */
const chartEchartsRemountKey = computed(() => {
	const o = chartModel.value.overall
	return [
		activeChannels.value.join(','),
		visibility.ballOriginal ? '1' : '0',
		visibility.ballCompressed ? '1' : '0',
		visibility.pinsOriginal ? '1' : '0',
		visibility.pinsCompressed ? '1' : '0',
		visibility.enabledPins.map((on) => (on ? '1' : '0')).join(''),
		o.originalKeyframes,
		o.compressedKeyframes,
	].join('|')
})

function runSimulation(): void {
	simulationResult.value = getSimulationResults(
		currentInput(),
		tuningSimulationOverrides(),
		optimizationOverridesFromTuning(),
	)
}

function currentInput(): SimulationInput {
	return {
		position: { ...form.position },
		direction: { ...form.direction },
		strength: form.strength,
		spin: form.spin,
		duration: form.duration,
		pinStates: Array.from({ length: PIN_LANE_LOCAL_POSITIONS.length }, (_, i) => Boolean(form.pinStates[i])),
	}
}

function resetDefaults(): void {
	Object.assign(form.position, DEFAULT_SIMULATION_INPUT.position)
	Object.assign(form.direction, DEFAULT_SIMULATION_INPUT.direction)
	directionYawDeg.value = clampDirectionYaw(yawDegFromDirectionXz(form.direction))
	form.strength = DEFAULT_SIMULATION_INPUT.strength
	form.spin = DEFAULT_SIMULATION_INPUT.spin
	form.duration = DEFAULT_SIMULATION_INPUT.duration
	for (let i = 0; i < DEFAULT_SIMULATION_INPUT.pinStates.length; i += 1) {
		form.pinStates[i] = DEFAULT_SIMULATION_INPUT.pinStates[i] ?? true
	}
	tuning.simFrameRate = GameSettings.simFrameRate
	tuning.simSubSteps = GameSettings.simSubSteps
	tuning.velocityRestEpsilon = GameSettings.velocityRestEpsilon
	tuning.idleFrameCap = GameSettings.idleFrameCap
	tuning.ballMass = GameSettings.ballMass
	tuning.ballFriction = GameSettings.ballFriction
	tuning.ballRestitution = GameSettings.ballRestitution
	tuning.maxAngularVelocity = GameSettings.maxAngularVelocity
	tuning.pinMass = GameSettings.pinMass
	tuning.pinFriction = GameSettings.pinFriction
	tuning.pinRestitution = GameSettings.pinRestitution
	tuning.laneBumpersEnabled = GameSettings.laneBumpersEnabled
	tuning.keyframeReductionEpsilon = DefaultOptimizationSettings.keyframeReductionEpsilon
	tuning.keyframeRdpMaxPositionErrorM = DefaultOptimizationSettings.keyframeRdpMaxPositionErrorM
	tuning.keyframeRdpMaxRotationErrorDeg = DefaultOptimizationSettings.keyframeRdpMaxRotationErrorDeg
	tuning.keyframePrecontactMotionMinPosM = DefaultOptimizationSettings.keyframePrecontactMotionMinPosM
	tuning.keyframePrecontactMotionMinRotDeg = DefaultOptimizationSettings.keyframePrecontactMotionMinRotDeg
	visibility.ballOriginal = true
	visibility.ballCompressed = true
	visibility.pinsOriginal = true
	visibility.pinsCompressed = true
	visibility.enabledPins = DEFAULT_SIMULATION_INPUT.pinStates.map(() => true)
	axisToggles.positionX = true
	axisToggles.positionY = true
	axisToggles.positionZ = true
	axisToggles.rotationX = false
	axisToggles.rotationY = false
	axisToggles.rotationZ = false
	runSimulation()
}

const KEYFRAME_MARKER_SIZE = 7

/** Full `setOption` replace: avoids stale series/grids when axes or visibility change shape. */
const CHART_SET_OPTION_OPTS = { notMerge: true as const }


// MARK: toEchartsSeries
/** Maps a chart series to the ECharts line + scatter series pair for one axis channel. */
function toEchartsSeries(
	series  : ChartSeries,
	channel : ChannelKey,
) {
	const color = seriesColorForChannel(channel, series.entityKind, series.entityIndex, series.dataset)
	const legendName = `${series.name} · ${channelLabel(channel)}`

	return [
		{
			id: series.id,
			name: legendName,
			type: 'line',
			smooth: false,
			showSymbol: false,
			data: series.points,
			lineStyle: {
				color,
				width: 1,
				type: 'solid',
				opacity: series.entityKind === 'ball' ? 1 : 0.72,
			},
			itemStyle: {
				color,
			},
		},
		{
			id: `${series.id}-markers`,
			name: legendName,
			type: 'scatter',
			data: series.points,
			symbol: 'circle',
			symbolSize: KEYFRAME_MARKER_SIZE,
			itemStyle: {
				color,
				opacity: 0.92,
				borderWidth: 0,
			},
			tooltip: {
				valueFormatter: (value: number) => Number(value).toFixed(3),
			},
			emphasis: {
				scale: 1.12,
			},
		},
	]
}


// MARK: channelHueBase
/** Central hue (°) for axis channel: X → red, Y → green, Z → blue; W uses violet. */
function channelHueBase(channel: ChannelKey): number {
	switch (channel) {
		case 'position.x':
		case 'rotation.x':
			return 2
		case 'position.y':
		case 'rotation.y':
			return 128
		case 'position.z':
		case 'rotation.z':
			return 218
		default:
			return 200
	}
}


// MARK: seriesColorForChannel
/**
 * Color by which axis row you are in (RGB for x/y/z), with lightness/saturation shifts so ball vs pins and
 * original vs compressed stay distinguishable within the same subplot.
 */
function seriesColorForChannel(
	channel: ChannelKey,
	entityKind: EntityKind,
	entityIndex: number,
	dataset: DatasetKey,
): string {
	const base = channelHueBase(channel)
	const pinSpread = entityKind === 'pin' ? ((entityIndex * 13) % 24) - 12 : 0
	const datasetShift = dataset === 'compressed' ? 10 : 0
	const hue = (base + pinSpread + datasetShift + 360) % 360

	const sat =
		entityKind === 'ball'
			? dataset === 'compressed'
				? 76
				: 70
			: 62 - (entityIndex % 3) * 4

	const light =
		entityKind === 'ball'
			? dataset === 'compressed'
				? 54
				: 60
			: 48 + (entityIndex % 6) * 2.5 + (dataset === 'compressed' ? -5 : 0)

	const alpha = entityKind === 'ball' ? 1 : 0.88
	return `hsla(${hue}, ${Math.max(48, sat)}%, ${Math.min(68, Math.max(40, light))}%, ${alpha})`
}


// MARK: formatBytes
/** Human-readable byte size for the message-bus wire estimate strip. */
function formatBytes(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`
	}

	return `${(bytes / 1024).toFixed(2)} KB`
}

provide(THEME_KEY, chartTheme)

/** Expand/collapse for main dashboard panels (defaults expanded). */
const sectionOpen = reactive({
	simInputs: true,
	chartAxes: true,
	visibilityPanel: true,
	threePlayback: true,
	chart: true,
	metricsStrip: true,
	channelStats: true,
	entityTotals: true,
})
</script>

<template>
	<div class="page">
		<section class="dashboard">
			<aside class="controls">
				<div class="panel sim-inputs-panel">
					<div class="panel-heading panel-heading--section">
						<h2>Simulation Inputs</h2>
						<button
							type="button"
							class="panel-collapse-btn"
							:aria-expanded="sectionOpen.simInputs"
							:aria-controls="'panel-sim-inputs'"
							@click="sectionOpen.simInputs = !sectionOpen.simInputs"
						>
							{{ sectionOpen.simInputs ? 'Collapse' : 'Expand' }}
						</button>
					</div>

					<div
						v-show="sectionOpen.simInputs"
						id="panel-sim-inputs"
						class="panel-collapsible"
					>
					<div class="sim-actions-row">
						<button class="secondary" type="button" @click="resetDefaults">Reset Defaults</button>
						<button class="primary" type="button" @click="runSimulation">Run Simulation</button>
					</div>

					<div class="field-grid">
						<div class="field-span-2 position-field">
							<span class="position-field-heading">Position</span>
							<div class="position-x-control-row">
								<div class="position-slider-row">
									<input
										v-model.number="form.position.x"
										type="range"
										min="-1"
										max="1"
										step="0.01"
										aria-label="Ball X position, −1 to 1"
										title="Horizontal (X) position, −1 to 1"
									/>
								</div>
								<input
									v-model.number="form.position.x"
									class="position-x-num"
									type="number"
									min="-1"
									max="1"
									step="0.01"
									aria-label="X position (current value)"
									title="Current X, −1 to 1"
								/>
								<button
									type="button"
									class="axis-toggle-btn position-axes-toggle"
									:class="{ 'axis-toggle-btn--on': showPositionAxes }"
									:aria-pressed="showPositionAxes"
									:aria-label="showPositionAxes ? 'Hide X, Y, Z position' : 'Show X, Y, Z position'"
									:title="showPositionAxes ? 'Hide X, Y, Z' : 'Show X, Y, Z'"
									@click="togglePositionAxes"
								>
									<i class="fa-solid fa-sliders" aria-hidden="true" />
								</button>
							</div>
							<div v-show="showPositionAxes" class="position-axes-inputs">
								<label>
									<span>X</span>
									<input v-model.number="form.position.x" type="number" step="0.01" />
								</label>
								<label>
									<span>Y</span>
									<input v-model.number="form.position.y" type="number" step="0.01" />
								</label>
								<label>
									<span>Z</span>
									<input v-model.number="form.position.z" type="number" step="0.01" />
								</label>
							</div>
						</div>
						<label class="field-span-2 strength-field">
							<span>Strength</span>
							<div class="strength-inline">
								<input v-model.number="form.strength" type="range" min="0" max="1" step="0.01" />
								<input
									v-model.number="form.strength"
									class="strength-num"
									type="number"
									min="0"
									max="1"
									step="0.01"
								/>
							</div>
						</label>
						<label class="field-span-2 spin-field">
							<span>Spin (Y)</span>
							<div class="spin-inline">
								<input
									v-model.number="form.spin"
									type="range"
									min="-1"
									max="1"
									step="0.01"
									aria-label="Spin about Y, −1 to 1"
									title="Initial angular velocity about +Y, scaled by max angular velocity in Materials"
								/>
								<input
									v-model.number="form.spin"
									class="spin-num"
									type="number"
									min="-1"
									max="1"
									step="0.01"
									aria-label="Spin (current value)"
									title="Spin −1…+1 (× max angular velocity, rad/s at ±1)"
								/>
							</div>
						</label>

						<div class="field-span-2 initial-rack-field">
							<div class="initial-rack-heading-row">
								<h2>Initial pin rack</h2>
								<button
									type="button"
									class="loop-toggle sim-panel-toggle"
									:class="{ 'loop-toggle--on': tuning.laneBumpersEnabled }"
									:aria-pressed="tuning.laneBumpersEnabled"
									aria-label="Lane bumpers: include gutter bumper colliders in Cannon physics"
									title="Enables bumper colliders in the sim; orange Outlines in 3D playback when Outlines is on"
									@click="toggleLaneBumpers"
								>
									<i
										class="fa-solid"
										:class="tuning.laneBumpersEnabled ? 'fa-check' : 'fa-xmark'"
										aria-hidden="true"
									/>
									<span class="loop-toggle-label">Lane bumpers</span>
								</button>
							</div>
							<div class="pin-rack-triangle" role="group" aria-label="Pins present at start of simulation">
								<div v-for="(row, rowIndex) in PIN_RACK_ROWS" :key="rowIndex" class="pin-rack-row">
									<label v-for="pinIndex in row" :key="pinIndex" class="pin-rack-cell">
										<input
											v-model="form.pinStates[pinIndex]"
											class="pin-rack-input"
											type="checkbox"
											:aria-label="`Pin ${pinIndex + 1} in rack`"
										/>
										<span class="pin-rack-button" aria-hidden="true">
											<span class="pin-rack-num">{{ pinIndex + 1 }}</span>
										</span>
									</label>
								</div>
							</div>
						</div>

						<div class="field-span-2 direction-field">
							<h3>Aim yaw</h3>
							<div class="direction-slider-row">
								<input
									v-model.number="directionYawDeg"
									type="range"
									:min="DIRECTION_YAW_MIN"
									:max="DIRECTION_YAW_MAX"
									step="0.1"
								/>
								<input
									v-model.number="directionYawDeg"
									class="direction-yaw-num"
									type="number"
									:min="DIRECTION_YAW_MIN"
									:max="DIRECTION_YAW_MAX"
									step="0.1"
									title="Yaw about +Y: 0° = +Z, +° → +X. Range ±15° for a typical throw."
								/>
							</div>
							<div class="direction-nudges" role="group" aria-label="Adjust aim by degrees">
								<button type="button" class="nudge-btn" @click="nudgeDirectionYaw(-5)">−5°</button>
								<button type="button" class="nudge-btn" @click="nudgeDirectionYaw(-1)">−1°</button>
								<button type="button" class="nudge-btn" @click="nudgeDirectionYaw(-0.1)">−0.1°</button>
								<button type="button" class="nudge-btn" @click="setDirectionYawToZero">0°</button>
								<button type="button" class="nudge-btn" @click="nudgeDirectionYaw(0.1)">+0.1°</button>
								<button type="button" class="nudge-btn" @click="nudgeDirectionYaw(1)">+1°</button>
								<button type="button" class="nudge-btn" @click="nudgeDirectionYaw(5)">+5°</button>
							</div>
							<button
								type="button"
								class="axis-toggle-btn direction-compass-btn"
								:class="{ 'axis-toggle-btn--on': showAimCompass }"
								:aria-pressed="showAimCompass"
								@click="toggleAimCompass"
							>
								<i class="fa-solid fa-compass" aria-hidden="true" />
								<span>Aim compass</span>
							</button>
							<svg
								v-if="showAimCompass"
								ref="directionSvgRef"
								class="direction-arrow-svg"
								viewBox="0 0 100 100"
								role="img"
								aria-label="Top-down aim; drag the arrow to set yaw"
								@pointerdown="onDirectionPointerDown"
								@pointermove="onDirectionPointerMove"
								@pointerup="onDirectionPointerUp"
								@pointercancel="onDirectionPointerUp"
							>
								<defs>
									<marker
										id="direction-arrow-head"
										markerWidth="7"
										markerHeight="7"
										refX="6"
										refY="3.5"
										orient="auto"
									>
										<polygon class="direction-svg-marker" points="0 0, 7 3.5, 0 7" />
									</marker>
								</defs>
								<rect class="direction-svg-bg" x="0" y="0" width="100" height="100" rx="10" />
								<text class="direction-svg-axis" x="50" y="14" text-anchor="middle">+Z forward</text>
								<text class="direction-svg-axis" x="92" y="52" text-anchor="middle" dominant-baseline="middle">
									+X
								</text>
								<line class="direction-svg-grid" x1="50" y1="12" x2="50" y2="88" />
								<line class="direction-svg-grid" x1="12" y1="50" x2="88" y2="50" />
								<circle class="direction-svg-ring" cx="50" cy="50" r="36" />
								<line
									class="direction-svg-arrow"
									x1="50"
									y1="50"
									:x2="directionArrowTip.x2"
									:y2="directionArrowTip.y2"
									marker-end="url(#direction-arrow-head)"
								/>
							</svg>
						</div>
						<h3 id="sim-section-time" class="field-grid-section-heading">Time</h3>
						<label>
							<span>Duration (s)</span>
							<input v-model.number="form.duration" type="number" min="0.5" step="0.25" />
						</label>
						<h3 id="sim-section-loop" class="field-grid-section-heading">Simulation</h3>
						<label>
							<span>Frame rate</span>
							<input v-model.number="tuning.simFrameRate" type="number" min="1" step="1" />
						</label>
						<label>
							<span>Sub-steps</span>
							<input
								v-model.number="tuning.simSubSteps"
								type="number"
								min="1"
								max="64"
								step="1"
								title="Cannon-es iterations per frame; higher reduces ball–pin tunneling (slower)."
							/>
						</label>
						<label>
							<span>Velocity rest ε (early-stop, speed²)</span>
							<input
								v-model.number="tuning.velocityRestEpsilon"
								type="number"
								min="0"
								step="0.001"
								title="Stop sampling when all bodies have squared speed below this for N frames."
							/>
						</label>
						<label>
							<span>Idle frame cap</span>
							<input
								v-model.number="tuning.idleFrameCap"
								type="number"
								min="1"
								step="1"
								title="Stop the roll sampler after this many consecutive frames with no significant velocity."
							/>
						</label>
						<h3 id="sim-section-materials" class="field-grid-section-heading">Materials</h3>
						<div
							class="materials-two-col field-span-2"
							role="group"
							aria-labelledby="sim-section-materials"
						>
							<div class="materials-col" role="group" aria-label="Ball">
								<label>
									<span>Ball mass</span>
									<input
										v-model.number="tuning.ballMass"
										type="number"
										min="0.01"
										step="0.1"
										title="Spherical ball rigid-body mass in the Cannon sim (affects speed–momentum and impulse from throw)."
									/>
								</label>
								<label>
									<span>Ball friction</span>
									<input
										v-model.number="tuning.ballFriction"
										type="number"
										min="0"
										max="1"
										step="0.01"
										title="Cannon material friction on the ball (contacts with lane / pins)."
									/>
								</label>
								<label>
									<span>Ball restitution</span>
									<input
										v-model.number="tuning.ballRestitution"
										type="number"
										min="0"
										max="1"
										step="0.01"
										title="Cannon material restitution (bounce) on the ball."
									/>
								</label>
								<label>
									<span>Max angular velocity (Y, rad/s)</span>
									<input
										v-model.number="tuning.maxAngularVelocity"
										type="number"
										min="0"
										step="0.5"
										title="Scales the Spin slider: at ±1, initial ωy = ± this value. 0 disables spin effect."
									/>
								</label>
							</div>
							<div class="materials-col" role="group" aria-label="Pins">
								<label>
									<span>Pin mass</span>
									<input
										v-model.number="tuning.pinMass"
										type="number"
										min="0.01"
										step="0.05"
										title="Pin body mass; overrides physics/colliders/pin-colliders.json cylinder mass in the Cannon sim."
									/>
								</label>
								<label>
									<span>Pin friction</span>
									<input
										v-model.number="tuning.pinFriction"
										type="number"
										min="0"
										max="1"
										step="0.01"
										title="Pin material friction; overrides physics/colliders/pin-colliders.json in the Cannon sim."
									/>
								</label>
								<label>
									<span>Pin restitution</span>
									<input
										v-model.number="tuning.pinRestitution"
										type="number"
										min="0"
										max="1"
										step="0.01"
										title="Pin material restitution; overrides physics/colliders/pin-colliders.json in the Cannon sim."
									/>
								</label>
							</div>
						</div>
						<h3 id="sim-section-keyframes" class="field-grid-section-heading">Keyframe &amp; optimization</h3>
						<label>
							<span>Keyframe flat ε (m)</span>
							<input
								v-model.number="tuning.keyframeReductionEpsilon"
								type="number"
								min="0"
								step="0.001"
								title="Per-axis position equality (m) after RDP; rotation (Euler°) is compared as quaternion after fromEulerDegrees using the same internal scale."
								@change="runSimulation"
							/>
						</label>
						<label>
							<span>RDP position err (m)</span>
							<input
								v-model.number="tuning.keyframeRdpMaxPositionErrorM"
								type="number"
								min="-1"
								step="0.001"
								title="Independent of rotation: −1 = position RDP off. Set rotation to −1 to test position-only simplification; union with rotation otherwise."
								@change="runSimulation"
							/>
						</label>
						<label>
							<span>RDP rotation err (°)</span>
							<input
								v-model.number="tuning.keyframeRdpMaxRotationErrorDeg"
								type="number"
								min="-1"
								step="0.1"
								title="R–D–P vs slerp; −1 = rotation RDP off. With both on, kept keyframes = union of position and rotation RDP (raise ° or set −1 to thin pre-strike ball)."
								@change="runSimulation"
							/>
						</label>
						<label>
							<span>Precontact motion min (m)</span>
							<input
								v-model.number="tuning.keyframePrecontactMotionMinPosM"
								type="number"
								min="-1"
								step="0.0001"
								title="Precontact rest anchor: how far a pin must move vs the t=0 sample before we count it as “motion” (inserts a full key the frame before). −1 = ignore position (use rotation only). If both this and the next field are −1, the anchor pass is off."
								@change="runSimulation"
							/>
						</label>
						<label>
							<span>Precontact motion min (°)</span>
							<input
								v-model.number="tuning.keyframePrecontactMotionMinRotDeg"
								type="number"
								min="-1"
								step="0.05"
								title="Precontact: min geodesic rotation (°) vs t=0 (slerp path, same as RDP). −1 = ignore rotation (position only). If both this and the previous field are −1, the anchor pass is off."
								@change="runSimulation"
							/>
						</label>
					</div>

					<div class="sim-actions-row sim-actions-row--bottom">
						<button class="secondary" type="button" @click="resetDefaults">Reset Defaults</button>
						<button class="primary" type="button" @click="runSimulation">Run Simulation</button>
					</div>
					</div>
				</div>

				<div class="panel axes-panel">
					<div class="panel-heading panel-heading--section">
						<h2>Chart axes</h2>
						<button
							type="button"
							class="panel-collapse-btn"
							:aria-expanded="sectionOpen.chartAxes"
							:aria-controls="'panel-chart-axes'"
							@click="sectionOpen.chartAxes = !sectionOpen.chartAxes"
						>
							{{ sectionOpen.chartAxes ? 'Collapse' : 'Expand' }}
						</button>
					</div>
					<div v-show="sectionOpen.chartAxes" id="panel-chart-axes" class="panel-collapsible">
					<div class="axis-toggle-rows">
						<div class="axis-row" role="group" aria-label="Position channels">
							<span class="axis-row-label">Position</span>
							<button
								type="button"
								class="axis-toggle-btn"
								:class="{ 'axis-toggle-btn--on': axisToggles.positionX }"
								:aria-pressed="axisToggles.positionX"
								@click="axisToggles.positionX = !axisToggles.positionX"
							>
								X
							</button>
							<button
								type="button"
								class="axis-toggle-btn"
								:class="{ 'axis-toggle-btn--on': axisToggles.positionY }"
								:aria-pressed="axisToggles.positionY"
								@click="axisToggles.positionY = !axisToggles.positionY"
							>
								Y
							</button>
							<button
								type="button"
								class="axis-toggle-btn"
								:class="{ 'axis-toggle-btn--on': axisToggles.positionZ }"
								:aria-pressed="axisToggles.positionZ"
								@click="axisToggles.positionZ = !axisToggles.positionZ"
							>
								Z
							</button>
						</div>
						<div class="axis-row" role="group" aria-label="Rotation channels">
							<span class="axis-row-label">Rotation</span>
							<button
								type="button"
								class="axis-toggle-btn"
								:class="{ 'axis-toggle-btn--on': axisToggles.rotationX }"
								:aria-pressed="axisToggles.rotationX"
								@click="axisToggles.rotationX = !axisToggles.rotationX"
							>
								X
							</button>
							<button
								type="button"
								class="axis-toggle-btn"
								:class="{ 'axis-toggle-btn--on': axisToggles.rotationY }"
								:aria-pressed="axisToggles.rotationY"
								@click="axisToggles.rotationY = !axisToggles.rotationY"
							>
								Y
							</button>
							<button
								type="button"
								class="axis-toggle-btn"
								:class="{ 'axis-toggle-btn--on': axisToggles.rotationZ }"
								:aria-pressed="axisToggles.rotationZ"
								@click="axisToggles.rotationZ = !axisToggles.rotationZ"
							>
								Z
							</button>
						</div>
					</div>
					</div>
				</div>

				<div class="panel">
					<div class="panel-heading panel-heading--section">
						<h2>Visibility</h2>
						<button
							type="button"
							class="panel-collapse-btn"
							:aria-expanded="sectionOpen.visibilityPanel"
							:aria-controls="'panel-visibility'"
							@click="sectionOpen.visibilityPanel = !sectionOpen.visibilityPanel"
						>
							{{ sectionOpen.visibilityPanel ? 'Collapse' : 'Expand' }}
						</button>
					</div>
					<div v-show="sectionOpen.visibilityPanel" id="panel-visibility" class="panel-collapsible">

					<div class="visibility-layout">
						<div class="visibility-btn-row" role="group" aria-label="Ball trace visibility">
							<button
								type="button"
								class="axis-toggle-btn visibility-trace-tog"
								:class="{ 'axis-toggle-btn--on': visibility.ballOriginal }"
								:aria-pressed="visibility.ballOriginal"
								@click="visibility.ballOriginal = !visibility.ballOriginal"
							>
								<i
									class="fa-solid visibility-trace-ic"
									:class="visibility.ballOriginal ? 'fa-check' : 'fa-xmark'"
									aria-hidden="true"
								/>
								<span>Ball original</span>
							</button>
							<button
								type="button"
								class="axis-toggle-btn visibility-trace-tog"
								:class="{ 'axis-toggle-btn--on': visibility.ballCompressed }"
								:aria-pressed="visibility.ballCompressed"
								@click="visibility.ballCompressed = !visibility.ballCompressed"
							>
								<i
									class="fa-solid visibility-trace-ic"
									:class="visibility.ballCompressed ? 'fa-check' : 'fa-xmark'"
									aria-hidden="true"
								/>
								<span>Ball compressed</span>
							</button>
						</div>
						<div class="visibility-btn-row" role="group" aria-label="Pins trace visibility">
							<button
								type="button"
								class="axis-toggle-btn visibility-trace-tog"
								:class="{ 'axis-toggle-btn--on': visibility.pinsOriginal }"
								:aria-pressed="visibility.pinsOriginal"
								@click="visibility.pinsOriginal = !visibility.pinsOriginal"
							>
								<i
									class="fa-solid visibility-trace-ic"
									:class="visibility.pinsOriginal ? 'fa-check' : 'fa-xmark'"
									aria-hidden="true"
								/>
								<span>Pins original</span>
							</button>
							<button
								type="button"
								class="axis-toggle-btn visibility-trace-tog"
								:class="{ 'axis-toggle-btn--on': visibility.pinsCompressed }"
								:aria-pressed="visibility.pinsCompressed"
								@click="visibility.pinsCompressed = !visibility.pinsCompressed"
							>
								<i
									class="fa-solid visibility-trace-ic"
									:class="visibility.pinsCompressed ? 'fa-check' : 'fa-xmark'"
									aria-hidden="true"
								/>
								<span>Pins compressed</span>
							</button>
						</div>

						<div
							class="pin-rack-triangle visibility-pin-rack"
							role="group"
							aria-label="Per-pin chart and 3D visibility"
						>
							<div v-for="(row, rowIndex) in PIN_RACK_ROWS" :key="'vis-' + rowIndex" class="pin-rack-row">
								<label v-for="pinIndex in row" :key="'vis-pin-' + pinIndex" class="pin-rack-cell">
									<input
										v-model="visibility.enabledPins[pinIndex]"
										class="pin-rack-input"
										type="checkbox"
										:aria-label="`Pin ${pinIndex + 1} trace visibility`"
									/>
									<span class="pin-rack-button" aria-hidden="true">
										<span class="pin-rack-num">{{ pinIndex + 1 }}</span>
									</span>
								</label>
							</div>
							<div
								class="visibility-btn-row pin-visibility-bulk"
								role="group"
								aria-label="Set all per-pin trace visibility"
							>
								<button
									type="button"
									class="axis-toggle-btn visibility-trace-tog"
									@click="setAllPinTraceVisibility(true)"
								>
									<span>Show all pins</span>
								</button>
								<button
									type="button"
									class="axis-toggle-btn visibility-trace-tog"
									@click="setAllPinTraceVisibility(false)"
								>
									<span>Hide all pins</span>
								</button>
							</div>
						</div>
					</div>
					</div>
				</div>
			</aside>

			<main class="content">
				<div class="panel three-panel">
					<div class="panel-heading panel-heading--section">
						<h2>3D playback</h2>
						<button
							type="button"
							class="panel-collapse-btn"
							:aria-expanded="sectionOpen.threePlayback"
							:aria-controls="'panel-three-playback'"
							@click="sectionOpen.threePlayback = !sectionOpen.threePlayback"
						>
							{{ sectionOpen.threePlayback ? 'Collapse' : 'Expand' }}
						</button>
					</div>
					<div v-show="sectionOpen.threePlayback" id="panel-three-playback" class="panel-collapsible">
						<BowlingThreeViewport
							hide-intro-heading
							:simulation-result="simulationResult"
							:enabled-pins="visibility.enabledPins"
							:lane-bumpers-enabled="tuning.laneBumpersEnabled"
							:starting-pin-states="simulationResult.startingPinStates"
						/>
					</div>
				</div>

				<div class="panel chart-panel">
					<div class="panel-heading panel-heading--section">
						<h2>{{ activeChannelsTitle }}</h2>
						<button
							type="button"
							class="panel-collapse-btn"
							:aria-expanded="sectionOpen.chart"
							:aria-controls="'panel-chart'"
							@click="sectionOpen.chart = !sectionOpen.chart"
						>
							{{ sectionOpen.chart ? 'Collapse' : 'Expand' }}
						</button>
					</div>

					<div v-show="sectionOpen.chart" id="panel-chart" class="panel-collapsible">
					<v-chart
						:key="chartEchartsRemountKey"
						class="chart"
						:style="{ height: `${chartHeightPx}px` }"
						:option="chartOption"
						:update-options="CHART_SET_OPTION_OPTS"
						autoresize
					/>
					</div>
				</div>

				<div class="panel">
					<div class="panel-heading panel-heading--section">
						<h2>Summary</h2>
						<button
							type="button"
							class="panel-collapse-btn"
							:aria-expanded="sectionOpen.metricsStrip"
							:aria-controls="'panel-summary'"
							@click="sectionOpen.metricsStrip = !sectionOpen.metricsStrip"
						>
							{{ sectionOpen.metricsStrip ? 'Collapse' : 'Expand' }}
						</button>
					</div>
					<div v-show="sectionOpen.metricsStrip" id="panel-summary" class="panel-collapsible">
						<h3 class="summary-subheading">Keyframes</h3>
						<div class="stats-grid stats-grid--keyframe">
							<div class="panel metric-card">
								<span class="metric-label">Original</span>
								<strong>{{ chartModel.overall.originalKeyframes }}</strong>
							</div>
							<div class="panel metric-card">
								<span class="metric-label">Compressed</span>
								<strong>{{ chartModel.overall.compressedKeyframes }}</strong>
							</div>
							<div class="panel metric-card">
								<span class="metric-label">Keyframe reduction</span>
								<strong>{{ chartModel.overall.reductionPercent.toFixed(1) }}%</strong>
							</div>
							<div class="panel metric-card">
								<span class="metric-label">Pins standing</span>
								<strong>{{ chartModel.overall.standingPins }}</strong>
							</div>
							<div class="panel metric-card">
								<span class="metric-label">Physics compute</span>
								<strong>{{ simulationResult.original.computeTimeMs.toFixed(1) }} ms</strong>
							</div>
						</div>
						<h3 class="summary-subheading summary-subheading--bus">Payload (binary wire)</h3>
						<div class="stats-grid summary-bus-grid">
							<div class="panel metric-card">
								<span class="metric-label">Original</span>
								<strong>{{ formatBytes(messageBusRollPlayback.originalBytes) }}</strong>
							</div>
							<div class="panel metric-card">
								<span class="metric-label">Compressed</span>
								<strong>{{ formatBytes(messageBusRollPlayback.compressedBytes) }}</strong>
							</div>
							<div class="panel metric-card">
								<span class="metric-label">Savings (wire)</span>
								<strong>{{ messageBusRollPlayback.savingsPercent.toFixed(1) }}%</strong>
							</div>
							<div class="panel metric-card">
								<span class="metric-label">Keyframe compress</span>
								<strong>{{ simulationResult.compressed.computeTimeMs.toFixed(2) }} ms</strong>
							</div>
						</div>
					</div>
				</div>

				<div class="panel">
					<div class="panel-heading">
						<h2>Channel stats</h2>
						<button
							type="button"
							class="panel-collapse-btn"
							:aria-expanded="sectionOpen.channelStats"
							:aria-controls="'panel-channel-stats'"
							@click="sectionOpen.channelStats = !sectionOpen.channelStats"
						>
							{{ sectionOpen.channelStats ? 'Collapse' : 'Expand' }}
						</button>
					</div>

					<div v-show="sectionOpen.channelStats" id="panel-channel-stats" class="panel-collapsible">
						<table class="stats-table">
							<thead>
								<tr>
									<th>Channel</th>
									<th>Original</th>
									<th>Compressed</th>
									<th>Saved</th>
									<th>Reduction</th>
								</tr>
							</thead>
							<tbody>
								<tr v-for="stat in chartModel.overall.channelStats" :key="stat.channel">
									<td>{{ channelLabel(stat.channel) }}</td>
									<td>{{ stat.originalKeyframes }}</td>
									<td>{{ stat.compressedKeyframes }}</td>
									<td>{{ stat.savedKeyframes }}</td>
									<td>{{ stat.reductionPercent.toFixed(1) }}%</td>
								</tr>
							</tbody>
						</table>
					</div>
				</div>

				<div class="panel">
					<div class="panel-heading">
						<h2>Per-entity keyframes</h2>
						<button
							type="button"
							class="panel-collapse-btn"
							:aria-expanded="sectionOpen.entityTotals"
							:aria-controls="'panel-entity-totals'"
							@click="sectionOpen.entityTotals = !sectionOpen.entityTotals"
						>
							{{ sectionOpen.entityTotals ? 'Collapse' : 'Expand' }}
						</button>
					</div>

					<div v-show="sectionOpen.entityTotals" id="panel-entity-totals" class="panel-collapsible">
						<table class="stats-table">
							<thead>
								<tr>
									<th>Entity</th>
									<th>Original</th>
									<th>Compressed</th>
									<th>Saved</th>
									<th>Reduction</th>
								</tr>
							</thead>
							<tbody>
								<tr v-for="entity in chartModel.entities" :key="entity.key">
									<td>{{ entity.label }}</td>
									<td>{{ entity.originalKeyframes }}</td>
									<td>{{ entity.compressedKeyframes }}</td>
									<td>{{ entity.savedKeyframes }}</td>
									<td>{{ entity.reductionPercent.toFixed(1) }}%</td>
								</tr>
							</tbody>
						</table>
					</div>
				</div>
			</main>
		</section>
	</div>
</template>

<style scoped>
.page {
	display: grid;
	gap: 24px;
}

.panel {
	background: rgba(15, 23, 42, 0.76);
	border: 1px solid rgba(148, 163, 184, 0.16);
	border-radius: 18px;
	box-shadow: 0 20px 48px rgba(2, 6, 23, 0.32);
}

.panel h2 {
	margin: 0;
	color: #f8fafc;
}

.panel p,
.metric-label {
	color: #a7b1c2;
}

.sim-inputs-panel .sim-actions-row {
	display: flex;
	flex-wrap: wrap;
	gap: 12px;
	align-items: center;
	justify-content: flex-end;
}

.sim-inputs-panel .sim-actions-row:not(.sim-actions-row--bottom) {
	margin-bottom: 10px;
}

.sim-inputs-panel .sim-actions-row--bottom {
	margin-top: 12px;
}

button,
input,
select {
	font: inherit;
}

button {
	border: 0;
	border-radius: 12px;
	padding: 12px 18px;
	cursor: pointer;
}

.primary {
	background: linear-gradient(135deg, #0ea5e9, #2563eb);
	color: white;
}

.secondary {
	background: rgba(148, 163, 184, 0.12);
	color: #e2e8f0;
}

.dashboard {
	display: grid;
	gap: 24px;
	grid-template-columns: minmax(320px, min(440px, 32vw)) minmax(0, 1fr);
}

.controls {
	align-self: start;
	align-content: start;
}

.controls,
.content {
	display: grid;
	gap: 24px;
}

.panel {
	padding: 20px;
}

.controls .panel {
	padding: 14px 16px;
}

.field-grid {
	display: grid;
	gap: 10px;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	margin-top: 12px;
}

.field-grid label,
.visibility-layout {
	color: #dbe7f3;
}

.field-grid label {
	display: grid;
	gap: 5px;
	font-size: 0.92rem;
}

.field-span-2 {
	grid-column: 1 / -1;
}

.field-grid-section-heading {
	grid-column: 1 / -1;
	margin: 0;
	margin-top: 0.65rem;
	padding-top: 0.8rem;
	border-top: 1px solid rgba(148, 163, 184, 0.2);
	font-size: 0.76rem;
	font-weight: 600;
	letter-spacing: 0.055em;
	text-transform: uppercase;
	color: #8b9caf;
}

/* First block after aim: align with field-grid gap */
.direction-field + .field-grid-section-heading {
	margin-top: 0.1rem;
}

.materials-two-col {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 10px 20px;
	align-items: start;
}

.materials-col {
	display: flex;
	flex-direction: column;
	gap: 10px;
	min-width: 0;
}

.position-field {
	display: flex;
	flex-direction: column;
	gap: 8px;
	min-width: 0;
}

.position-field-heading {
	display: block;
	color: #a7b1c2;
	font-size: 0.92rem;
	white-space: nowrap;
}

.position-x-control-row {
	display: flex;
	flex-wrap: nowrap;
	align-items: center;
	gap: 10px;
	width: 100%;
	min-width: 0;
}

.position-slider-row {
	flex: 1;
	min-width: 0;
}

.position-slider-row input[type='range'] {
	width: 100%;
}

.position-x-num {
	width: 4.75rem;
	flex-shrink: 0;
}

.position-axes-toggle {
	flex-shrink: 0;
}

.position-axes-inputs {
	display: flex;
	flex-wrap: wrap;
	gap: 10px;
	padding: 4px 0 2px;
	border-top: 1px solid rgba(148, 163, 184, 0.12);
}

.position-axes-inputs label {
	display: grid;
	gap: 6px;
	flex: 1;
	min-width: 5.5rem;
	font-size: 0.92rem;
}

.position-axes-inputs label span {
	color: #a7b1c2;
}

.strength-field .strength-inline,
.spin-field .spin-inline {
	display: flex;
	gap: 12px;
	align-items: center;
}

.strength-field .strength-inline input[type='range'],
.spin-field .spin-inline input[type='range'] {
	flex: 1;
	min-width: 0;
}

.strength-num,
.spin-num {
	width: 4.25rem;
	flex-shrink: 0;
}

.initial-rack-field {
	display: grid;
	gap: 10px;
	margin-top: 0;
}

.initial-rack-heading-row {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: space-between;
	gap: 10px 16px;
}

.initial-rack-heading-row h2 {
	margin: 0;
}

.sim-panel-toggle {
	flex-shrink: 0;
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

.initial-rack-label {
	color: #a7b1c2;
	font-size: 0.92rem;
}

.initial-rack-hint {
	margin: 0;
	font-size: 0.8rem;
	line-height: 1.4;
	color: #64748b;
}

.pin-rack-triangle {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 8px;
	padding: 12px 8px 14px;
	border-radius: 12px;
	background: rgba(15, 23, 42, 0.55);
	border: 1px solid rgba(148, 163, 184, 0.14);
}

.pin-rack-row {
	display: flex;
	justify-content: center;
	gap: 10px;
	flex-wrap: wrap;
}

.pin-rack-cell {
	position: relative;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	cursor: pointer;
	user-select: none;
	padding: 2px;
}

.pin-rack-button {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 3rem;
	height: 3rem;
	min-width: 3rem;
	min-height: 3rem;
	border-radius: 50%;
	box-sizing: border-box;
	border: 2px solid rgba(148, 163, 184, 0.45);
	background: rgba(30, 41, 59, 0.65);
	box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
	transition:
		border-color 0.15s ease,
		background 0.15s ease,
		box-shadow 0.15s ease;
}

.pin-rack-cell:hover .pin-rack-button {
	border-color: rgba(56, 189, 248, 0.55);
	background: rgba(30, 41, 59, 0.9);
}

.pin-rack-cell:focus-within .pin-rack-button {
	outline: none;
	box-shadow:
		inset 0 1px 0 rgba(255, 255, 255, 0.06),
		0 0 0 2px rgba(15, 23, 42, 1),
		0 0 0 4px rgba(56, 189, 248, 0.55);
}

.pin-rack-input:checked + .pin-rack-button {
	border-color: rgba(56, 189, 248, 0.85);
	background: rgba(14, 165, 233, 0.22);
	box-shadow:
		inset 0 0 0 1px rgba(56, 189, 248, 0.35),
		inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.pin-rack-input:checked + .pin-rack-button .pin-rack-num {
	color: #e0f2fe;
	font-weight: 600;
}

.pin-rack-num {
	font-variant-numeric: tabular-nums;
	color: #94a3b8;
	font-size: 0.88rem;
	line-height: 1;
	pointer-events: none;
}

.direction-field {
	display: grid;
	gap: 8px;
	margin-top: 0;
	width: 100%;
	min-width: 0;
}

.direction-compass-btn {
	margin-top: 2px;
	align-self: start;
	display: inline-flex;
	align-items: center;
	gap: 6px;
}

.direction-slider-row {
	display: grid;
	grid-template-columns: 1fr auto;
	gap: 10px;
	align-items: center;
	width: 100%;
	min-width: 0;
}

.direction-slider-row input[type='range'] {
	width: 100%;
	min-width: 0;
}

.direction-yaw-num {
	width: 4.75rem;
	flex-shrink: 0;
}

.direction-nudges {
	display: flex;
	flex-wrap: nowrap;
	gap: 6px;
	overflow-x: auto;
	padding-bottom: 2px;
	scrollbar-width: thin;
	width: 100%;
	min-width: 0;
}

.nudge-btn {
	padding: 6px 10px;
	border-radius: 8px;
	font-size: 0.82rem;
	cursor: pointer;
	background: rgba(148, 163, 184, 0.14);
	color: #e2e8f0;
}

.nudge-btn:hover {
	background: rgba(148, 163, 184, 0.24);
}

.direction-arrow-svg {
	display: block;
	width: 100%;
	max-width: 100%;
	height: auto;
	aspect-ratio: 1;
	margin: 0;
	touch-action: none;
	cursor: grab;
	user-select: none;
}

.direction-arrow-svg:active {
	cursor: grabbing;
}

.direction-svg-bg {
	fill: rgba(15, 23, 42, 0.85);
	stroke: rgba(148, 163, 184, 0.2);
	stroke-width: 1;
}

.direction-svg-axis {
	fill: #64748b;
	font-size: 8px;
	font-family: ui-monospace, monospace;
}

.direction-svg-grid {
	stroke: rgba(100, 116, 139, 0.35);
	stroke-width: 0.6;
	stroke-dasharray: 3 3;
}

.direction-svg-ring {
	fill: none;
	stroke: rgba(56, 189, 248, 0.2);
	stroke-width: 0.75;
}

.direction-svg-arrow {
	stroke: #38bdf8;
	stroke-width: 2.5;
	stroke-linecap: round;
}

polygon.direction-svg-marker {
	fill: #38bdf8;
}

.field-grid span {
	color: #a7b1c2;
}

input,
select {
	width: 100%;
	box-sizing: border-box;
	padding: 10px 12px;
	border-radius: 10px;
	border: 1px solid rgba(148, 163, 184, 0.2);
	background: rgba(15, 23, 42, 0.7);
	color: #f8fafc;
}

.pin-rack-cell .pin-rack-input {
	position: absolute;
	width: 1px;
	height: 1px;
	margin: -1px;
	padding: 0;
	overflow: hidden;
	clip: rect(0, 0, 0, 0);
	white-space: nowrap;
	border: 0;
	border-radius: 0;
	background: transparent;
	box-shadow: none;
}

.visibility-layout {
	display: flex;
	flex-direction: column;
	gap: 12px;
	margin-top: 14px;
}

.visibility-btn-row {
	display: flex;
	gap: 10px;
}

.visibility-trace-tog {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 6px;
	white-space: normal;
}

.visibility-trace-ic {
	flex-shrink: 0;
	font-size: 0.8rem;
	opacity: 0.9;
}

.axis-toggle-btn--on .visibility-trace-ic {
	opacity: 1;
}

.visibility-pin-rack {
	margin-top: 2px;
}

.pin-visibility-bulk {
	align-self: stretch;
	width: 100%;
}

.visibility-help {
	margin: 0 0 8px;
	font-size: 0.88rem;
	line-height: 1.35;
	color: #a7b1c2;
}

.axis-toggle-rows {
	display: grid;
	gap: 8px;
}

.axis-row {
	display: flex;
	flex-wrap: nowrap;
	align-items: center;
	gap: 8px;
	overflow-x: auto;
	padding-bottom: 4px;
	scrollbar-width: thin;
	color: #dbe7f3;
}

.axis-row-label {
	flex: 0 0 auto;
	min-width: 4.75rem;
	font-weight: 600;
	font-size: 0.88rem;
	color: #94a3b8;
}

.axis-toggle-btn {
	flex: 0 0 auto;
	min-width: 2.5rem;
	padding: 8px 10px;
	border-radius: 10px;
	border: 1px solid rgba(148, 163, 184, 0.28);
	background: rgba(15, 23, 42, 0.65);
	color: #cbd5e1;
	font: inherit;
	font-size: 0.88rem;
	font-weight: 600;
	cursor: pointer;
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

.visibility-btn-row .axis-toggle-btn.visibility-trace-tog {
	flex: 1 1 0;
	min-width: 0;
}

.three-panel {
	overflow: hidden;
	align-self: start;
}

.chart-panel {
	overflow: visible;
	align-self: start;
}

.chart {
	display: block;
	width: 100%;
	min-height: 200px;
	margin-top: 10px;
}

.panel-heading {
	display: flex;
	justify-content: space-between;
	gap: 16px;
	align-items: flex-start;
}

.panel-heading h2 {
	margin: 0;
}

.panel-heading--section {
	align-items: center;
	margin-bottom: 10px;
}

.panel-heading--section h2 {
	font-size: 1.1rem;
}

.panel-collapse-btn {
	flex-shrink: 0;
	padding: 6px 12px;
	border-radius: 8px;
	font-size: 0.82rem;
	font-weight: 500;
	background: rgba(148, 163, 184, 0.12);
	color: #e2e8f0;
	border: 1px solid rgba(148, 163, 184, 0.28);
	cursor: pointer;
	white-space: nowrap;
}

.panel-collapse-btn:hover {
	background: rgba(148, 163, 184, 0.22);
	border-color: rgba(148, 163, 184, 0.4);
}

.panel-collapsible {
	display: block;
}

.stats-grid {
	display: grid;
	gap: 16px;
	grid-template-columns: repeat(5, minmax(0, 1fr));
}

.stats-grid--keyframe {
	grid-template-columns: repeat(5, minmax(0, 1fr));
}

.summary-subheading {
	margin: 0 0 8px;
	font-size: 0.8rem;
	font-weight: 600;
	color: #94a3b8;
	letter-spacing: 0.03em;
	text-transform: uppercase;
}

.summary-subheading--bus {
	margin-top: 18px;
}

.sim-inputs-panel {
	padding-top: 12px;
	padding-bottom: 8px;
}

.axes-panel {
	padding-top: 12px;
	padding-bottom: 8px;
}

.summary-bus-grid {
	margin-top: 0;
	grid-template-columns: repeat(4, minmax(0, 1fr));
}

.metric-card {
	display: grid;
	gap: 8px;
}

.metric-card strong {
	font-size: 1.8rem;
	color: #f8fafc;
}

.stats-table {
	width: 100%;
	border-collapse: collapse;
	margin-top: 16px;
}

.stats-table th,
.stats-table td {
	text-align: left;
	padding: 12px 10px;
	border-bottom: 1px solid rgba(148, 163, 184, 0.14);
}

.stats-table th {
	color: #cbd5e1;
	font-weight: 600;
}

.stats-table td {
	color: #e2e8f0;
}

@media (max-width: 1200px) {
	.dashboard {
		grid-template-columns: 1fr;
	}

	.stats-grid:not(.stats-grid--keyframe):not(.summary-bus-grid) {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.stats-grid--keyframe,
	.summary-bus-grid {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
}

@media (max-width: 720px) {
	.sim-inputs-panel .sim-actions-row {
		width: 100%;
		flex-direction: column;
	}

	.sim-inputs-panel .sim-actions-row button {
		width: 100%;
	}

	.field-grid,
	.stats-grid {
		grid-template-columns: 1fr;
	}

	.sim-inputs-panel .materials-two-col {
		grid-template-columns: 1fr;
	}

	.visibility-btn-row {
		flex-direction: column;
	}
}
</style>
