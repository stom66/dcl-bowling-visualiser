import { CannonSim, PIN_LANE_LOCAL_POSITIONS } from './cannon-sim'
import { compressSimulationResult } from './keyframes'
import { GameSettings, type SimulationSettings } from './settings'
import type { SimulationComparison, SimulationInput } from './types'

export const DEFAULT_SIMULATION_INPUT: SimulationInput = {
  position: { x: 0, y: 0.12, z: 0.8 },
  direction: { x: 0, y: 0, z: 1 },
  strength: 0.85,
  duration: GameSettings.simDuration,
  pinStates: Array(PIN_LANE_LOCAL_POSITIONS.length).fill(true),
}

export function runSimulationComparison(
  input: SimulationInput,
  settingsOverrides: Partial<SimulationSettings> = {},
): SimulationComparison {
  const settings = resolveSettings(settingsOverrides)
  const sim = new CannonSim(input.position, input.direction, input.strength, input.pinStates, settings)
  const original = sim.simulate(input.duration)
  const compressed = compressSimulationResult(original, settings.simKeyframeReductionEpsilon)

  return {
    original,
    compressed,
    finalPinStates: [...compressed.finalPinStates],
  }
}

export function resolveSettings(overrides: Partial<SimulationSettings> = {}): SimulationSettings {
  return {
    ...GameSettings,
    ...overrides,
  }
}
