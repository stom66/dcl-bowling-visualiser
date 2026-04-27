import { Quaternion } from '@dcl/sdk/math'

import type { QuaternionType, Vector3Type } from '../types'

/**
 * `SimObjectKeyframe.rotation` wire format: **Euler angle degrees** in **(x, y, z)**, i.e. the value returned
 * from `Quaternion.toEulerAngles` and accepted by `Quaternion.fromEulerDegrees` in `@dcl/ecs-math` (same
 * as DCL / `@dcl/ecs-math` runtime). Three floats on the wire instead of a quaternion.
 */
/**
 * `Quaternion.toEulerAngles(Identity)` — default forward-filled rotation when a track has no `rotation` key.
 */
export const DEFAULT_STORED_ROTATION: Vector3Type = (() => {
	const e = Quaternion.toEulerAngles(Quaternion.Identity())
	return { x: e.x, y: e.y, z: e.z }
})()

/**
 * Storable Euler (degrees) → engine quaternion, for simulation / RDP / playback.
 */
export function storedRotationToQuaternion(rotation: Vector3Type): QuaternionType {
	return Quaternion.fromEulerDegrees(rotation.x, rotation.y, rotation.z)
}

/**
 * Engine quaternion (e.g. Cannon) → storable Euler (degrees).
 */
export function quaternionToStoredRotation(quaternion: QuaternionType): Vector3Type {
	const n = Quaternion.normalize(quaternion)
	const e = Quaternion.toEulerAngles(n)
	return { x: e.x, y: e.y, z: e.z }
}
