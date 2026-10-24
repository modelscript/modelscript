<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/olga

High-fidelity transient multiphase dynamic flow assurance package (`.opi`) for ModelScript. Features zero-GC in-WASM 1D Drift-Flux DAE lowering to `DAEBuilder`, XML ingestion via `@modelscript/dsl/xml`, formal SysML v2 requirements & operational state machine verification, and pre-flight multiphase stability linting (`M7001`–`M7005`).

---

## Core Capabilities

- **OLGA XML GUI Project Parser (`parseOpi`)**: High-performance XML parser built on `@modelscript/dsl/xml`, extracting subsea pipeline flowpaths, elevation bathymetry, wall thermal insulation layers, valves, chokes, wells, and boundary nodes.
- **In-WASM 1D Drift-Flux Staggered-Grid DAE Solver (`lowerFlowpathToDae`, `simulateDriftFlux`)**: Lowers multiphase flowlines directly into `DAEBuilder` in linear memory:
  - Gas & liquid mass conservation with upwind donor-cell fluxes
  - Mixture momentum with Churchill two-phase friction and pipe inclination gravity head
  - Zuber-Findlay drift-flux slip law ($C_0, u_{gj}$)
  - Overall pipe wall heat transfer and thermal cooldown transients
  - Real-time simulation of transient pressure drops, cooling, liquid holdup accumulation, and arrival surge volume.
- **OLGA ◄► SysML v2 Formal Projections (`olgaToSysml2`)**: Translates `.opi` flowline networks into idiomatic SysML v2 textual models:
  - Structural topology mapped to `part def FlowlineRiserSystem` and `port def MultiphaseFluidPort`
  - Flow assurance safety requirements (`HydrateAvoidanceRequirement`, `TopsideSlugCapacityRequirement`, `PipelineMaopRequirement`, `MinimumTurndownVelocityRequirement`)
  - Operational state machines (`SubseaFlowlineOperatingProcedure`: SteadyProduction, LowTurndown, EmergencyShutIn, ControlledBlowdown, ChemicalInhibitionFlushing, WarmUpRestart).
- **Flow Assurance & State Machine Verifier (`verifyFlowAssuranceTrajectory`, `verifyOperatingProcedureStateTransitions`)**:
  - Evaluates continuous multiphase simulation trajectories against hydrate equilibrium curves and slug catcher capacity
  - Uses `@modelscript/sysml2`'s `StateMachineVerifier` to prove transition determinism and completeness for emergency shut-in and blowdown procedures.
- **Pre-Flight Multiphase Linter (`lintOlgaModel`, `M7001`–`M7005`)**: Pre-simulation validation of Courant-Friedrichs-Lewy (CFL) numerical stability, pipe dimensions, steep inclination riser traps, and boundary condition completeness.

---

## Pre-Flight Multiphase Lint Rules (`M7001`–`M7005`)

| Code    | Rule                         | Severity  | Description                                                                                  |
| :------ | :--------------------------- | :-------- | :------------------------------------------------------------------------------------------- |
| `M7001` | `cfl-condition-violation`    | `warning` | Configured `maxDt` exceeds convective/acoustic CFL stability limit ($\Delta x / (u_m + c)$). |
| `M7002` | `invalid-pipe-dimensions`    | `error`   | Pipe diameter $\le 0$, length $\le 0$, or roughness $< 0$.                                   |
| `M7003` | `missing-boundary-condition` | `error`   | Flowpath is missing an inlet mass source or outlet pressure/separator boundary.              |
| `M7004` | `steep-elevation-warning`    | `info`    | Pipe inclination $> 80^\circ$; monitor for severe riser slugging and liquid fallback.        |
| `M7005` | `fully-closed-choke-hazard`  | `warning` | Choke valve is fully closed ($0.0$), creating shut-in overpressure risk.                     |

---

## Package Structure

| Path                                          | Description                                                                 |
| :-------------------------------------------- | :-------------------------------------------------------------------------- |
| `src/index.ts`                                | Public package exports                                                      |
| `src/language.ts`                             | `olgaLanguage` definition, LSP actions, and polyglot TGG rules              |
| `src/types.ts`                                | Core TypeScript interfaces (`OlgaModel`, `OlgaFlowpath`, `OlgaPipe`, etc.)  |
| `src/parser/opi-parser.ts`                    | XML `.opi` project parser using `@modelscript/dsl/xml`                      |
| `src/solver/zuber-findlay.ts`                 | Zuber-Findlay drift-flux closure, Churchill friction, and hydrate curve     |
| `src/solver/drift-flux-dae.ts`                | Linear-memory DAE lowerer (`DAEBuilder`) and 1D Drift-Flux transient solver |
| `src/projections/olga-to-sysml2.ts`           | SysML v2 polyglot projection generator                                      |
| `src/verification/flow-assurance-verifier.ts` | Verification engine for hydrate margins, slug surge, and state machines     |
| `src/lints/index.ts`                          | Pre-flight multiphase diagnostic linter (`M7001`–`M7005`)                   |

---

## Programmatic Usage

```typescript
import {
  parseOpi,
  simulateDriftFlux,
  olgaToSysml2,
  verifyFlowAssuranceTrajectory,
  lintOlgaModel,
} from "@modelscript/olga";

// 1. Ingest OLGA .opi XML project
const model = parseOpi(xmlSourceText);

// 2. Lint model for CFL stability & missing boundaries
const diagnostics = lintOlgaModel(model);

// 3. Run in-WASM 1D Drift-Flux transient simulation
const trajectory = simulateDriftFlux(model, {
  durationSeconds: 3600,
  timeStepSeconds: 1.0,
});

// 4. Verify formal flow assurance requirements
const verification = verifyFlowAssuranceTrajectory(trajectory, {
  maop: 220e5, // 220 bar
  hydrateMarginKelvin: 3.0, // 3 K margin
  slugCatcherLiquidCapacity: 150.0, // 150 m^3
  minGasVelocity: 2.5, // 2.5 m/s
});

console.log("Flow assurance verified:", verification.passed);

// 5. Generate SysML v2 formal specification & state machine
const sysmlCode = olgaToSysml2(model);
```
