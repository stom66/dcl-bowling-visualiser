/**
 * Host entry point for the bowling physics pipeline: roll simulation + keyframe optimization.
 * Copy `physics/` together with `types/` (shared + `types/physics/`) and `data/`.
 */
import { CannonBowlingPhysicsSimulator } from './physics.cannon-bowling-physics'
import { compressSimulationResult } from './physics.keyframe-optimization'
import { PIN_LANE_LOCAL_POSITIONS } from './physics.cannon-sim'
import {
	DefaultOptimizationSettings,
	GameSettings,
	type OptimizationSettings,
	type SimulationSettings,
} from './physics.settings'
import type {
	BowlingPhysicsSimulator,
	SimulationComparison,
	SimulationInput,
	SimulationResult,
} from '../types'

export const DEFAULT_SIMULATION_INPUT: SimulationInput = {
	position : { x: 0, y: 0.12, z: 0.8 },
	direction: { x: 0, y: 0, z: 1 },
	strength : 0.85,
	duration : GameSettings.simDuration,
	pinStates: Array(PIN_LANE_LOCAL_POSITIONS.length).fill(true),
}

function uncompressedCopyFromOriginal(source: SimulationResult): SimulationResult {
	// Raw sim with no compression: deep clone + zero compression time on the “compressed” branch.
	const c = structuredClone(source)
	c.computeTimeMs = 0
	return c
}

/**
 * @param input Roll parameters.
 * @param simulationOverrides Merged on top of {@link GameSettings}.
 * @param optimizationOverrides Merged on top of {@link DefaultOptimizationSettings}. Set `keyframeOptimizationEnabled`
 *   to `false` in overrides to return identical original/compressed keyframes (compression skipped).
 * @param physics Optional backend; a new {@link CannonBowlingPhysicsSimulator} is used on each call when omitted.
 */
export function getSimulationResults(
	input                 : SimulationInput,
	simulationOverrides?  : Partial<SimulationSettings>,
	optimizationOverrides?: Partial<OptimizationSettings>,
	physics: BowlingPhysicsSimulator     = new CannonBowlingPhysicsSimulator(),
): SimulationComparison {
	const simSettings  = resolveSimulationSettings(simulationOverrides ?? {})
	const optSettings  = resolveOptimizationSettings(optimizationOverrides ?? {})
	const original     = physics.simulateRoll(input, simSettings, optSettings)
	const compressed   = optSettings.keyframeOptimizationEnabled
		? compressSimulationResult(original, optSettings)
		: uncompressedCopyFromOriginal(original)

	return {
		original         : original,
		compressed       : compressed,
		finalPinStates   : [...compressed.finalPinStates],
		startingPinStates: Array.from(
			{ length: PIN_LANE_LOCAL_POSITIONS.length },
			(_, index) => input.pinStates[index] ?? true,
		),
	}
}

export function resolveSimulationSettings(overrides: Partial<SimulationSettings> = {}): SimulationSettings {
	return {
		...GameSettings,
		...overrides,
	}
}

export function resolveOptimizationSettings(overrides: Partial<OptimizationSettings> = {}): OptimizationSettings {
	return {
		...DefaultOptimizationSettings,
		...overrides,
	}
}
