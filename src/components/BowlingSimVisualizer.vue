<script setup lang="ts">
import { computed, provide, reactive, ref } from 'vue'
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
} from '../bowling/chart-model'
import { GameSettings } from '../bowling/settings'
import { DEFAULT_SIMULATION_INPUT, runSimulationComparison } from '../bowling/run-simulation'
import type { ChannelKey } from '../bowling/keyframes'
import type { SimulationInput } from '../bowling/types'

use([
  CanvasRenderer,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  AxisPointerComponent,
  LineChart,
  ScatterChart,
])

function channelLabel(channel: ChannelKey): string {
  return CHANNEL_OPTIONS.find((option) => option.value === channel)?.label ?? channel
}

const chartTheme = 'dark'

const form = reactive({
  position: { ...DEFAULT_SIMULATION_INPUT.position },
  direction: { ...DEFAULT_SIMULATION_INPUT.direction },
  strength: DEFAULT_SIMULATION_INPUT.strength,
  duration: DEFAULT_SIMULATION_INPUT.duration,
})

const tuning = reactive({
  simFrameRate: GameSettings.simFrameRate,
  simKeyframeReductionEpsilon: GameSettings.simKeyframeReductionEpsilon,
  simFramesWithNoVelocityThreshold: GameSettings.simFramesWithNoVelocityThreshold,
})

const visibility = reactive({
  ballOriginal: true,
  ballCompressed: true,
  pinsOriginal: true,
  pinsCompressed: true,
  enabledPins: DEFAULT_SIMULATION_INPUT.pinStates.map(() => true),
})

/** Global: which scalar channels to plot (each gets its own horizontal strip, same time axis). */
const axisToggles = reactive({
  positionX: true,
  positionY: true,
  positionZ: true,
  rotationX: false,
  rotationY: false,
  rotationZ: false,
  rotationW: false,
})

const AXIS_CHANNEL_ORDER: ChannelKey[] = [
  'position.x',
  'position.y',
  'position.z',
  'rotation.x',
  'rotation.y',
  'rotation.z',
  'rotation.w',
]

const CHANNEL_TO_AXIS_TOGGLE: Record<ChannelKey, keyof typeof axisToggles> = {
  'position.x': 'positionX',
  'position.y': 'positionY',
  'position.z': 'positionZ',
  'rotation.x': 'rotationX',
  'rotation.y': 'rotationY',
  'rotation.z': 'rotationZ',
  'rotation.w': 'rotationW',
}

const activeChannels = computed((): ChannelKey[] =>
  AXIS_CHANNEL_ORDER.filter((ch) => axisToggles[CHANNEL_TO_AXIS_TOGGLE[ch]]),
)

const chartHeightPx = computed(() => {
  const n = activeChannels.value.length
  if (n === 0) {
    return 220
  }
  return Math.min(960, Math.max(260, 150 * n))
})

const activeChannelsTitle = computed(() => {
  const ch = activeChannels.value
  if (ch.length === 0) {
    return 'No axes selected'
  }
  return ch.map((c) => channelLabel(c)).join(' · ')
})
const comparison = ref(
  runSimulationComparison(DEFAULT_SIMULATION_INPUT, {
    simFrameRate: tuning.simFrameRate,
    simKeyframeReductionEpsilon: tuning.simKeyframeReductionEpsilon,
    simFramesWithNoVelocityThreshold: tuning.simFramesWithNoVelocityThreshold,
  }),
)

const chartModel = computed(() => buildSimulationChartModel(comparison.value))

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
  const bottomPad = 10
  const usable = 100 - topStart - bottomPad
  const slot = usable / channels.length
  const rowGap = 0.8

  const grids = channels.map((_, i) => ({
    left: 52,
    right: 28,
    top: `${topStart + i * slot}%`,
    height: `${slot - rowGap}%`,
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
      for (const piece of toEchartsSeries(s)) {
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

function runSimulation(): void {
  comparison.value = runSimulationComparison(currentInput(), {
    simFrameRate: tuning.simFrameRate,
    simKeyframeReductionEpsilon: tuning.simKeyframeReductionEpsilon,
    simFramesWithNoVelocityThreshold: tuning.simFramesWithNoVelocityThreshold,
  })
}

function currentInput(): SimulationInput {
  return {
    position: { ...form.position },
    direction: { ...form.direction },
    strength: form.strength,
    duration: form.duration,
    pinStates: visibility.enabledPins.map(Boolean),
  }
}

function resetDefaults(): void {
  Object.assign(form.position, DEFAULT_SIMULATION_INPUT.position)
  Object.assign(form.direction, DEFAULT_SIMULATION_INPUT.direction)
  form.strength = DEFAULT_SIMULATION_INPUT.strength
  form.duration = DEFAULT_SIMULATION_INPUT.duration
  tuning.simFrameRate = GameSettings.simFrameRate
  tuning.simKeyframeReductionEpsilon = GameSettings.simKeyframeReductionEpsilon
  tuning.simFramesWithNoVelocityThreshold = GameSettings.simFramesWithNoVelocityThreshold
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
  axisToggles.rotationW = false
  runSimulation()
}

const KEYFRAME_MARKER_SIZE = 7

function toEchartsSeries(series: ChartSeries) {
  const color = seriesColor(series.entityKind, series.entityIndex, series.dataset)

  return [
    {
      id: series.id,
      name: series.name,
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
      name: series.name,
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

function seriesColor(entityKind: EntityKind, entityIndex: number, dataset: DatasetKey): string {
  if (entityKind === 'ball') {
    return dataset === 'original' ? '#60a5fa' : '#22d3ee'
  }

  const hue = (entityIndex * 31) % 360
  return dataset === 'original'
    ? `hsla(${hue}, 72%, 68%, 0.8)`
    : `hsla(${hue}, 88%, 62%, 1)`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  return `${(bytes / 1024).toFixed(2)} KB`
}

provide(THEME_KEY, chartTheme)
</script>

<template>
  <div class="page">
    <header class="hero">
      <div>
        <p class="eyebrow">Local simulation dashboard</p>
        <h1>Bowling Sim Visualizer</h1>
        <p class="lede">
          Run the physics sim in-browser, compare original and compressed keyframes, and inspect
          channel-by-channel savings for the ball and all 10 pins.
        </p>
      </div>

      <div class="hero-actions">
        <button class="primary" type="button" @click="runSimulation">Run Simulation</button>
        <button class="secondary" type="button" @click="resetDefaults">Reset Defaults</button>
      </div>
    </header>

    <section class="dashboard">
      <aside class="controls">
        <div class="panel">
          <h2>Simulation Inputs</h2>

          <div class="field-grid">
            <label>
              <span>Position X</span>
              <input v-model.number="form.position.x" type="number" step="0.01" />
            </label>
            <label>
              <span>Position Y</span>
              <input v-model.number="form.position.y" type="number" step="0.01" />
            </label>
            <label>
              <span>Position Z</span>
              <input v-model.number="form.position.z" type="number" step="0.01" />
            </label>
            <label>
              <span>Direction X</span>
              <input v-model.number="form.direction.x" type="number" step="0.01" />
            </label>
            <label>
              <span>Direction Y</span>
              <input v-model.number="form.direction.y" type="number" step="0.01" />
            </label>
            <label>
              <span>Direction Z</span>
              <input v-model.number="form.direction.z" type="number" step="0.01" />
            </label>
            <label>
              <span>Strength</span>
              <input v-model.number="form.strength" type="number" min="0" max="1" step="0.01" />
            </label>
            <label>
              <span>Duration (s)</span>
              <input v-model.number="form.duration" type="number" min="0.5" step="0.25" />
            </label>
            <label>
              <span>Frame Rate</span>
              <input v-model.number="tuning.simFrameRate" type="number" min="1" step="1" />
            </label>
            <label>
              <span>Reduction Epsilon</span>
              <input
                v-model.number="tuning.simKeyframeReductionEpsilon"
                type="number"
                min="0"
                step="0.001"
              />
            </label>
            <label>
              <span>No-Velocity Threshold</span>
              <input
                v-model.number="tuning.simFramesWithNoVelocityThreshold"
                type="number"
                min="1"
                step="1"
              />
            </label>
          </div>
        </div>

        <div class="panel">
          <h2>Chart axes</h2>
          <p class="axes-help">
            Each enabled axis gets its own row: every visible ball and pin series for that component (e.g. all
            <strong>Z</strong> traces together).
          </p>
          <div class="axis-toggle-rows">
            <div class="axis-row">
              <span class="axis-row-label">Position</span>
              <label><input v-model="axisToggles.positionX" type="checkbox" /> X</label>
              <label><input v-model="axisToggles.positionY" type="checkbox" /> Y</label>
              <label><input v-model="axisToggles.positionZ" type="checkbox" /> Z</label>
            </div>
            <div class="axis-row">
              <span class="axis-row-label">Rotation</span>
              <label><input v-model="axisToggles.rotationX" type="checkbox" /> X</label>
              <label><input v-model="axisToggles.rotationY" type="checkbox" /> Y</label>
              <label><input v-model="axisToggles.rotationZ" type="checkbox" /> Z</label>
              <label><input v-model="axisToggles.rotationW" type="checkbox" /> W</label>
            </div>
          </div>
        </div>

        <div class="panel">
          <h2>Visibility</h2>

          <div class="toggle-group">
            <label><input v-model="visibility.ballOriginal" type="checkbox" /> Ball original</label>
            <label>
              <input v-model="visibility.ballCompressed" type="checkbox" />
              Ball compressed
            </label>
            <label><input v-model="visibility.pinsOriginal" type="checkbox" /> Pins original</label>
            <label>
              <input v-model="visibility.pinsCompressed" type="checkbox" />
              Pins compressed
            </label>
          </div>

          <div class="pins-grid">
            <label v-for="(_, index) in visibility.enabledPins" :key="index">
              <input v-model="visibility.enabledPins[index]" type="checkbox" />
              Pin {{ index + 1 }}
            </label>
          </div>
        </div>
      </aside>

      <main class="content">
        <div class="panel chart-panel">
          <div class="panel-heading">
            <div>
              <h2>{{ activeChannelsTitle }}</h2>
              <p>
                One row per enabled axis (shared time axis, linked crosshair). Original vs compressed differ by color;
                lines are 1px solid; markers match for both.
              </p>
            </div>
          </div>

          <v-chart class="chart" :style="{ height: `${chartHeightPx}px` }" :option="chartOption" autoresize />
        </div>

        <div class="stats-grid">
          <div class="panel metric-card">
            <span class="metric-label">Original keyframes</span>
            <strong>{{ chartModel.overall.originalKeyframes }}</strong>
          </div>
          <div class="panel metric-card">
            <span class="metric-label">Compressed keyframes</span>
            <strong>{{ chartModel.overall.compressedKeyframes }}</strong>
          </div>
          <div class="panel metric-card">
            <span class="metric-label">Reduction</span>
            <strong>{{ chartModel.overall.reductionPercent.toFixed(1) }}%</strong>
          </div>
          <div class="panel metric-card">
            <span class="metric-label">Estimated size saved</span>
            <strong>{{ formatBytes(chartModel.overall.bytesSaved) }}</strong>
          </div>
          <div class="panel metric-card">
            <span class="metric-label">Pins standing</span>
            <strong>{{ chartModel.overall.standingPins }}</strong>
          </div>
        </div>

        <div class="panel">
          <div class="panel-heading">
            <h2>Overall Channel Stats</h2>
            <p>Channel counts include the ball plus every enabled pin track from the run.</p>
          </div>

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

        <div class="panel">
          <div class="panel-heading">
            <h2>Entity Totals</h2>
            <p>Use this table to compare keyframe reduction and payload savings per object.</p>
          </div>

          <table class="stats-table">
            <thead>
              <tr>
                <th>Entity</th>
                <th>Original</th>
                <th>Compressed</th>
                <th>Saved</th>
                <th>Reduction</th>
                <th>Bytes Saved</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="entity in chartModel.entities" :key="entity.key">
                <td>{{ entity.label }}</td>
                <td>{{ entity.originalKeyframes }}</td>
                <td>{{ entity.compressedKeyframes }}</td>
                <td>{{ entity.savedKeyframes }}</td>
                <td>{{ entity.reductionPercent.toFixed(1) }}%</td>
                <td>{{ formatBytes(entity.bytesSaved) }}</td>
              </tr>
            </tbody>
          </table>
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

.hero,
.panel {
  background: rgba(15, 23, 42, 0.76);
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 18px;
  box-shadow: 0 20px 48px rgba(2, 6, 23, 0.32);
}

.hero {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  padding: 28px;
  align-items: center;
}

.eyebrow {
  margin: 0 0 10px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-size: 0.8rem;
  color: #38bdf8;
}

.hero h1,
.panel h2 {
  margin: 0;
  color: #f8fafc;
}

.lede,
.panel p,
.metric-label {
  color: #a7b1c2;
}

.hero-actions {
  display: flex;
  gap: 12px;
  align-items: center;
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
  grid-template-columns: minmax(320px, 360px) minmax(0, 1fr);
}

.controls,
.content {
  display: grid;
  gap: 24px;
}

.panel {
  padding: 20px;
}

.field-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-top: 16px;
}

.field-grid label,
.toggle-group,
.pins-grid {
  color: #dbe7f3;
}

.field-grid label {
  display: grid;
  gap: 8px;
  font-size: 0.92rem;
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

.toggle-group,
.pins-grid {
  display: grid;
  gap: 10px;
  margin-top: 16px;
}

.pins-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.toggle-group label,
.pins-grid label {
  display: flex;
  gap: 10px;
  align-items: center;
}

.toggle-group input,
.pins-grid input {
  width: auto;
}

.axes-help {
  margin: 0 0 12px;
  font-size: 0.92rem;
  color: #a7b1c2;
}

.axis-toggle-rows {
  display: grid;
  gap: 12px;
}

.axis-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 18px;
  align-items: center;
  color: #dbe7f3;
}

.axis-row-label {
  min-width: 5.5rem;
  font-weight: 600;
  color: #94a3b8;
}

.axis-row label {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  cursor: pointer;
}

.chart-panel {
  min-height: 0;
}

.chart {
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

.stats-grid {
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(5, minmax(0, 1fr));
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

  .stats-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .hero {
    flex-direction: column;
    align-items: flex-start;
  }

  .hero-actions {
    width: 100%;
    flex-direction: column;
  }

  .hero-actions button {
    width: 100%;
  }

  .field-grid,
  .pins-grid,
  .stats-grid {
    grid-template-columns: 1fr;
  }
}
</style>
