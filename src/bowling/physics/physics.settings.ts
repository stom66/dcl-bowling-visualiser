import type { OptimizationSettings, SimulationSettings } from './types'

export const GameSettings: SimulationSettings = {
	ballMass           : 15,
	ballFriction       : 0.05,
	ballRestitution    : 0.05,
	ballRadius         : 0.12,
	maxAngularVelocity : 10,   // rad/s
	bowlSpeedMax       : 20,
	bowlSpeedMin       : 4,
	decimalPlaces      : 2,    // decimal places to use for the simulation result
	idleFrameCap       : 10,   // stop the roll sampler after this many consecutive frames with no significant velocity
	pinMass            : 1.58,
	pinFriction        : 0.2,
	pinRestitution     : 0,
	laneBumpersEnabled : false,
	simDuration        : 10,
	simFrameRate       : 30,   // max frame rate of the returned simulation
	simSubSteps        : 5,    // extra frames used during the simulation to improve the accuracy
	velocityRestEpsilon: 0.01, // velocity rest epsilon
}

export const DefaultOptimizationSettings: OptimizationSettings = {
	keyframeOptimizationEnabled      : true,
	keyframeReductionEpsilon         : 0.01,
	keyframeRdpMaxPositionErrorM     : 0.008,
	keyframeRdpMaxRotationErrorDeg   : 5,    // Slerp comparison only; if too tight, every frame stays (union with position RDP then dense).
	keyframePrecontactMotionMinPosM  : 0.10, // Precontact: XZ delta vs t=0 (pins); first sample past this is “motion.”
	keyframePrecontactMotionMinRotDeg: 3,    // Precontact: ignore solver quat noise (tight values fire early and break the anchor).
}
