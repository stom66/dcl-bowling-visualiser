# Reintegrating the bowling sim into another project

This repo splits into a **portable physics + keyframe stack** and an **optional visualizer** (Vue, Three, ECharts). Use the steps below to drop the stack into a Decentraland or other TypeScript project.

## 1. What to copy (minimal: simulation + compression)

Copy this folder tree and keep **relative paths** between these pieces (or update imports to match your layout):

| Path in this repo | Role |
|-------------------|------|
| `src/bowling/physics/` | Cannon sim, RDP / keyframe optimization, `getSimulationResults` entry |
| `src/bowling/types/` | `bowling-sim` types, re-exports of `Quaternion` / vector types from `@dcl/sdk` and `@dcl/ecs` |
| `src/bowling/data/lane-colliders.json` | Lane collision mesh data |
| `src/bowling/data/pin-colliders.json` | Pin collision + placement data |

`physics.client.ts` is the main API: `getSimulationResults`, `resolveSimulationSettings`, `resolveOptimizationSettings`, `DEFAULT_SIMULATION_INPUT`.

## 2. Optional: charts, playback helpers, UI

- `src/bowling/visualizer/` — playback sampling, ECharts model, size estimates for wire formats, etc. Imports `../physics` and `../types` the same way.
- `src/components/BowlingSimVisualizer.vue`, `BowlingThreeViewport.vue` — full debug UI; pull in if you use Vue 3 + Three + ECharts the same way.

If you only need **numbers + keyframes** for your own renderer, you can skip the `visualizer/` and Vue files.

## 3. npm dependencies

Your host project needs (versions can be aligned with this repo’s `package.json`):

- **`cannon-es`** — physics
- **`@dcl/sdk`** — used by the sim for `Vector3` / `Quaternion` (`physics.cannon-sim.ts`, `types/index.ts`)

If you use the wire-size / message-bus modules under `visualizer/`, you also need the same **`@dcl/sdk`** (ECS / serialization) as in this project.

**Three.js / Vue / ECharts** are only required for the included 3D and chart UIs, not for `getSimulationResults` itself.

## 4. TypeScript / bundler

- Enable **`"resolveJsonModule": true`** (or equivalent) so the `*.json` collider imports work.
- If your bundler does not resolve the `@dcl/*` packages the same way, adjust or shim `src/bowling/types/index.ts` to match how your DCL (or other) app exposes `Quaternion` and `Vector3` types.

## 5. Usage sketch

```ts
import {
  getSimulationResults,
  DEFAULT_SIMULATION_INPUT,
} from './bowling/physics/physics.client'

// Optional overrides; defaults come from `physics.settings.ts` / `DefaultOptimizationSettings`.
// Set `keyframeOptimizationEnabled: false` in the third arg to skip keyframe reduction (compressed === raw sim copy).
const { original, compressed } = getSimulationResults(
  { ...DEFAULT_SIMULATION_INPUT, strength: 0.9 },
  { simFrameRate: 60, simSubSteps: 3 /* … */ },
  { keyframeRdpMaxPositionErrorM: 0.01 /* … */ },
  // new MyPhysicsSimulator() // optional 4th arg; defaults to Cannon
)
// `compressed` is ready to serialize: ball + per-pin `SimObjectKeyframes`.
```

`SimulationResult` and settings types live in `src/bowling/types/bowling-sim.ts` (re-exported via `src/bowling/types/index.ts`).

## 6. After you move files

- Search for `@/../bowling` (or this repo’s `src/bowling`) and point imports to your new location.
- Run your project’s `tsc` / build: fix any path or JSON resolution errors first, then DCL- or three-specific types if you split `types/index.ts` from the SDK re-exports.

This keeps a single source of truth: **`physics.cannon-sim` + collider JSON + keyframe optimizer** — the same pipeline this visualiser uses for the compressed playback tracks.
