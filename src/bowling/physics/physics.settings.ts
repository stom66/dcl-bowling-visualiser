import type { OptimizationSettings, SimulationSettings } from '../types/bowling-sim'
export type { OptimizationSettings, SimulationSettings } from '../types/bowling-sim'

export const GameSettings: SimulationSettings = {
	ballMass           : 15,
	ballFriction       : 0.1,
	ballRestitution    : 0.05,
	ballRadius         : 0.12,
	bowlSpeedMax       : 20,
	bowlSpeedMin       : 5,
	decimalPlaces      : 2,
	idleFrameCap       : 10,
	pinMass            : 1.58,
	pinFriction        : 0.5,
	pinRestitution     : 0,
	simDuration        : 6,
	simFrameRate       : 60,
	simSubSteps        : 4,
	velocityRestEpsilon: 0.02,
}

export const DefaultOptimizationSettings: OptimizationSettings = {
	keyframeOptimizationEnabled      : true,
	keyframeReductionEpsilon         : 0.02,
	keyframeRdpMaxPositionErrorM     : 0.025,
	keyframeRdpMaxRotationErrorDeg   : 30,    // Slerp comparison only; if too tight, every frame stays (union with position RDP then dense).
	keyframePrecontactMotionMinPosM  : 0.02, // Precontact: ignore sub-mm drift; first sample past this vs t=0 is “motion.”
	keyframePrecontactMotionMinRotDeg: 0.3,   // Precontact: ignore sub-degree quat wobble before real hit.
}
