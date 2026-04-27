# Bowling physics module

Portable roll simulation (Cannon-es today), keyframe optimization, and shared settings. Copy **`physics/` as a unit** — it contains `types/` (`bowling-sim` contracts + DCL re-exports), `colliders/*.json`, and these modules — into another project if you reuse the pipeline.

The diagrams below describe how the **wrapper** (`BowlingPhysicsSimulator`), **adapter** (`CannonBowlingPhysicsSimulator`), and **engine** (`CannonSim`) relate.

---

## File cheat sheet

| File | Role |
|------|------|
| `physics.client.ts` | Host API: `getSimulationResults`, defaults, merge helpers. |
| `physics.settings.ts` | Default values `GameSettings`, `DefaultOptimizationSettings` (types imported from `./types`). |
| `types/` | Simulation contracts (`bowling-sim.ts`), `index.ts` re-exporting `@dcl/ecs` / `@dcl/sdk/math` primitives. |
| `physics.cannon-bowling-physics.ts` | **Adapter**: `BowlingPhysicsSimulator` → `CannonSim`. |
| `physics.cannon-sim.ts` | **Engine**: Cannon world, colliders from `colliders/*.json`, sampling. |
| `physics.utils.ts` | Engine-agnostic math / keyframe rotation helpers. |
| `physics.keyframe-optimization.ts` | Reduces keyframes after simulation (optional). |
| `colliders/*.json` | Lane / pin / bumper collision data consumed by `CannonSim`. |

`simulateRoll` receives `optimizationSettings` so the **call shape** stays the same for every backend; Cannon ignores it during integration, and the client applies compression **after** simulation.

---

## Module dependency (data flow)

```mermaid
flowchart TB
 subgraph types["physics/types"]
  IFACE["BowlingPhysicsSimulator\n(interface)"]
  SI["SimulationInput / SimulationResult / …"]
 end

 subgraph client["physics.client.ts"]
  GSR["getSimulationResults()"]
  RS["resolveSimulationSettings()"]
  RO["resolveOptimizationSettings()"]
 end

 subgraph settings["physics.settings.ts"]
  GS["GameSettings"]
  DO["DefaultOptimizationSettings"]
 end

 subgraph adapter["physics.cannon-bowling-physics.ts"]
  CBP["CannonBowlingPhysicsSimulator"]
 end

 subgraph engine["physics.cannon-sim.ts"]
  CS["CannonSim"]
  CANNON["cannon-es World / bodies"]
 end

 subgraph opt["physics.keyframe-optimization.ts"]
  COMP["compressSimulationResult()"]
 end

 subgraph utils["physics.utils.ts"]
  U["lengthSquared, roundVec3,\nrotation wire helpers, …"]
 end

 IFACE -.-> CBP
 CBP --> CS
 CS --> CANNON
 GSR --> RS
 GSR --> RO
 GSR --> CBP
 GSR --> COMP
 RS --> GS
 RO --> DO
 CS --> U
 COMP --> U
 SI --> GSR
```

---

## Class / interface roles

```mermaid
classDiagram
 direction TB

 class BowlingPhysicsSimulator {
  <<interface>>
  +simulateRoll(input, simulationSettings, optimizationSettings) SimulationResult
 }

 class CannonBowlingPhysicsSimulator {
  +simulateRoll(input, simulationSettings, optimizationSettings) SimulationResult
 }

 class CannonSim {
  +constructor(position, direction, strength, spin, pinStates, settings)
  +advance(dt) CannonSimAdvanceResult
  +simulate(duration) SimulationResult
  -getBodyTransform(body) CannonSimObjectState
  -fireBall(direction, strength, spin)
 }

 BowlingPhysicsSimulator <|.. CannonBowlingPhysicsSimulator : implements
 CannonBowlingPhysicsSimulator ..> CannonSim : constructs and calls simulate()
 note for BowlingPhysicsSimulator "Stable API for any engine\n(e.g. future Rapier backend)."
 note for CannonBowlingPhysicsSimulator "Thin adapter: map pipeline types\nto CannonSim ctor + simulate(duration)."
 note for CannonSim "Cannon-es only:\nworld, colliders, ball, pins,\nstepping, keyframe recording."
```

---

## One `getSimulationResults()` call (sequence)

Mermaid is picky about dots in participant IDs and about `alt` nesting; this version uses plain IDs (see labels below).

```mermaid
sequenceDiagram
    participant Caller
    participant Host
    participant R as "Merged settings"
    participant I as BowlingPhysicsSimulator
    participant A as CannonBowlingPhysicsSimulator
    participant E as CannonSim
    participant K as "Keyframe optimizer"

    Caller->>Host: getSimulationResults
    Host->>R: resolveSimulationSettings, resolveOptimizationSettings
    R-->>Host: simSettings, optSettings
    Host->>I: simulateRoll
    note right of I: default instance is Cannon adapter
    I->>A: delegate
    A->>E: new CannonSim, simulate duration
    E-->>A: SimulationResult
    A-->>Host: SimulationResult original
    alt optimization enabled
        Host->>K: compressSimulationResult
        K-->>Host: compressed
    else
        Host->>Host: compressed tracks same as original
    end
    Host-->>Caller: SimulationComparison
```

| ID in diagram | Code |
|---------------|------|
| Host | `physics.client.ts` (`getSimulationResults`) |
| R | `resolveSimulationSettings` + `resolveOptimizationSettings` |
| I | Interface `BowlingPhysicsSimulator` (parameter or default) |
| A | `CannonBowlingPhysicsSimulator` |
| E | `CannonSim` |
| K | `compressSimulationResult` in `physics.keyframe-optimization.ts` |

---
