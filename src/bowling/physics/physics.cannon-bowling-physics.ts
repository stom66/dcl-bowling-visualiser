import { CannonSim } from './physics.cannon-sim'
import type { OptimizationSettings, SimulationSettings } from './physics.settings'
import type { BowlingPhysicsSimulator, SimulationInput, SimulationResult } from '../types'

/** Cannon-es implementation of {@link BowlingPhysicsSimulator}. */
export class CannonBowlingPhysicsSimulator implements BowlingPhysicsSimulator {
	simulateRoll(
		input: SimulationInput,
		simulationSettings: SimulationSettings,
		_optimizationSettings: OptimizationSettings,
	): SimulationResult {
		const sim = new CannonSim(
			input.position,
			input.direction,
			input.strength,
			input.pinStates,
			simulationSettings,
		)
		return sim.simulate(input.duration)
	}
}
