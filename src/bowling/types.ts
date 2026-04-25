export type Vec3 = {
  x: number
  y: number
  z: number
}

export type Quat = {
  x: number
  y: number
  z: number
  w: number
}

export type SimObjectKeyframe = {
  time: number
  position?: Vec3
  rotation?: Quat
}

export type SimObjectKeyframes = {
  index: number
  label: string
  keyframes: SimObjectKeyframe[]
}

export type SimulationInput = {
  position: Vec3
  direction: Vec3
  strength: number
  duration: number
  pinStates: boolean[]
}

export type RawSimulationResult = {
  ballKeyframes: SimObjectKeyframes
  pinsKeyframes: SimObjectKeyframes[]
  finalPinStates: boolean[]
}

export type SimulationComparison = {
  original: RawSimulationResult
  compressed: RawSimulationResult
  finalPinStates: boolean[]
}
