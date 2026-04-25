export type SimulationSettings = {
  decimalPlaces                   : number
  simKeyframeReductionEpsilon     : number
  simFrameRate                    : number
  simSubSteps                     : number
  simDuration                     : number
  simFramesWithNoVelocityThreshold: number
  ballMass                        : number
  ballRadius                      : number
  bowlSpeedMin                    : number
  bowlSpeedMax                    : number
}

export const GameSettings: SimulationSettings = {
  decimalPlaces                   : 3,
  simKeyframeReductionEpsilon     : 0.002,
  simFrameRate                    : 20,
  simSubSteps                     : 4,
  simDuration                     : 6,
  simFramesWithNoVelocityThreshold: 10,
  ballMass                        : 15,
  ballRadius                      : 0.1,
  bowlSpeedMin                    : 5,
  bowlSpeedMax                    : 20,
}
