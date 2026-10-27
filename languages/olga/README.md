<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/olga

High-fidelity transient multiphase dynamic flow assurance package (`.opi`, `.olga`, `.key`, `.genkey`, `.inp`) for ModelScript. Features zero-GC in-WASM 1D Drift-Flux and 3-Fluid 9-equation DAE lowering to `DAEBuilder`, XML ingestion via `@modelscript/dsl/xml`, legacy keyword deck parsing & serialization, formal SysML v2 requirements & operational state machine verification, and 13 pre-flight multiphase stability & integrity lint rules (`M7001`–`M7013`).

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
- **Complete Keyword Parser & Serializer Parity (`parseKeyDeck`, `serializeKeyDeck`)**: Full round-trip fidelity for legacy OLGA `.key` and `.genkey` decks, supporting `CASE`, `INTEGRATION`, `DTCONTROL`, `BRANCH`, `PIPE`, `VALVE`, `CHOKE`, `SOURCE`, `NODE`, `PUMP`, `COMPRESSOR`, `WELL`/`IPR`, `WAX`, `SAND`, `METALLURGY`, `RESTART`, and `OUTPUT`.
- **State Checkpointing & Zero-Discontinuity Warm Restart (`saveCheckpoint`, `loadCheckpoint`)**: Complete hydrodynamic state serialization to `.rst` / JSON format (pressure, temperature, phase holdups, velocities, active slugs, pigs, and controllers) enabling instantaneous warm restarts from arbitrary time points.
- **Autonomous Field History Matching & Parameter Tuning (`calibrateOlgaModel`)**: Non-linear bounded Nelder-Mead simplex calibration of pipe roughness, overall heat transfer coefficient ($U$), choke flow coefficient ($C_d$), and well productivity against SCADA field telemetry.

---

## Pre-Flight Multiphase Lint Rules (`M7001`–`M7013`)

| Code    | Rule                                | Severity            | Description                                                                                                        |
| :------ | :---------------------------------- | :------------------ | :----------------------------------------------------------------------------------------------------------------- |
| `M7001` | `cfl-condition-violation`           | `warning`           | Configured `maxDt` exceeds convective/acoustic CFL stability limit ($\Delta x / (u_m + c)$).                       |
| `M7002` | `invalid-pipe-dimensions`           | `error`             | Pipe diameter $\le 0$, length $\le 0$, or roughness $< 0$.                                                         |
| `M7003` | `missing-boundary-condition`        | `error`             | Flowpath is missing an inlet mass source or outlet pressure/separator boundary.                                    |
| `M7004` | `steep-elevation-warning`           | `info`              | Pipe inclination $> 80^\circ$; monitor for severe riser slugging and liquid fallback.                              |
| `M7005` | `fully-closed-choke-hazard`         | `warning`           | Choke valve is fully closed ($0.0$), creating shut-in overpressure risk.                                           |
| `M7006` | `severe-slugging-hazard`            | `warning`           | Deep seabed dip followed by steep riser without active choke or slug controller.                                   |
| `M7007` | `pig-stuck-hazard`                  | `error`             | Pipeline scraper pig friction force exceeds maximum flowline drive capability.                                     |
| `M7008` | `pvt-table-missing-or-invalid`      | `warning`           | Fluid table has invalid extension or boundary operating states deviate from grid bounds.                           |
| `M7009` | `wax-deposition-risk`               | `warning`           | Operating fluid temperature drops below Wax Appearance Temperature without insulation.                             |
| `M7010` | `sand-erosion-or-dropout-hazard`    | `warning`           | Mixture velocity below sand settling threshold or exceeds API RP 14E erosion limit.                                |
| `M7011` | `sour-service-metallurgy-violation` | `error`             | Flowpath operates in NACE MR0175 / ISO 15156 sour region without compliant CRA metallurgical cladding.             |
| `M7012` | `asphaltene-precipitation-hazard`   | `error` / `warning` | Flowpath operates inside the Asphaltene Onset Pressure (AOP) precipitation envelope with unstable CII index.       |
| `M7013` | `heatexchanger-parameter-violation` | `error`             | Heat exchanger position lies outside pipeline length, or duty / target temperature / overall $UA$ is non-physical. |

---

## Package Structure

| Path                                          | Description                                                                  |
| :-------------------------------------------- | :--------------------------------------------------------------------------- |
| `src/index.ts`                                | Public package exports                                                       |
| `src/language.ts`                             | `olgaLanguage` definition, LSP actions, and polyglot TGG rules               |
| `src/types.ts`                                | Core TypeScript interfaces (`OlgaModel`, `OlgaCheckpointState`, etc.)        |
| `src/parser/opi-parser.ts`                    | XML `.opi` project parser using `@modelscript/dsl/xml`                       |
| `src/parser/key-parser.ts`                    | Legacy keyword input deck parser & serializer (`.key` / `.genkey`)           |
| `src/parser/pvt-table-parser.ts`              | Industrial 2D fluid property table parser (`.tab` / `.pvt`, SI/Metric/Field) |
| `src/solver/wellbore-ipr.ts`                  | Reservoir inflow performance models (Vogel, Fetkovich, Linear PI)            |
| `src/solver/machinery.ts`                     | Multiphase booster pumps (GVF degradation) and gas compressors               |
| `src/solver/network-solver.ts`                | Branched gathering network solver with manifold junction coupling            |
| `src/solver/drift-flux-dae.ts`                | 1D Drift-Flux transient solver with checkpoint seeding and snapshotting      |
| `src/solver/three-fluid-dae.ts`               | 3-Fluid 9-equation mechanistic hydrodynamic solver with droplet dynamics     |
| `src/solver/fluid-properties.ts`              | Local cell PVT interpolation, 3-phase blending, and derivatives              |
| `src/solver/wax-and-sand.ts`                  | Molecular diffusion wax growth & Wicks/Salama sand deposition screening      |
| `src/solver/asphaltene.ts`                    | SARA fraction Colloidal Instability Index (CII) & AOP precipitation modeling |
| `src/solver/sour-corrosion.ts`                | NACE MR0175 / ISO 15156 sour corrosion and metallurgy compliance evaluator   |
| `src/solver/slug-tracker.ts`                  | Lagrangian slug tracking module                                              |
| `src/solver/pig-tracker.ts`                   | Dynamic pipeline scraper pigging tracker                                     |
| `src/engine/checkpoint.ts`                    | State snapshot serialization and deserialization engine (`.rst` / JSON)      |
| `src/tuning/history-matcher.ts`               | Nelder-Mead simplex field history matching & parameter calibration engine    |
| `src/projections/olga-to-sysml2.ts`           | SysML v2 polyglot projection generator                                       |
| `src/verification/flow-assurance-verifier.ts` | Verification engine for hydrate/wax margins, slug surge, and state machines  |
| `src/verification/flow-assurance-gate.ts`     | CI/CD safety gate evaluator with automatic markdown summary generation       |
| `src/lints/index.ts`                          | Pre-flight multiphase diagnostic linter (`M7001`–`M7013`)                    |
| `src/engine/olga-orchestrator.ts`             | Batch orchestrator for Schlumberger OLGA (`olga.exe`) with WASM fallback     |

---

## Scripts

| Command             | Description                                                                |
| :------------------ | :------------------------------------------------------------------------- |
| `npm run build`     | Compile TypeScript to `dist/`                                              |
| `npm test`          | Run parser, drift-flux/3-fluid solver, linter, and verification test suite |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                                      |
| `npm run typecheck` | Run `tsc --noEmit` type verification                                       |
| `npm run clean`     | Remove `dist/` build artifacts                                             |

---

## CLI Usage (`msx olga`)

```bash
# Inspect flowpath topology, bathymetry, and boundary nodes
msx olga inspect SubseaTieback.opi

# Run pre-flight multiphase lint checks (M7001–M7013)
msx olga lint SubseaTieback.opi

# Simulate 1D transient multiphase flow and export trajectory CSV
msx olga simulate SubseaTieback.opi --duration=3600 --out=trajectory.csv

# Verify hydrate subcooling, MAOP, and slug catcher surge capacity
msx olga verify SubseaTieback.opi --maop=220 --capacity=150

# Render elevation profile, schematic, or PVT phase envelope SVG diagram
msx olga diagram SubseaTieback.opi --view=profile --out=profile.svg

# Convert between .opi XML, .genkey keyword decks, Modelica, and SysML v2
msx olga convert SubseaTieback.opi --to=sysml2 --out=SubseaTieback.sysml
msx olga to-modelica SubseaTieback.opi --out=SubseaTieback.mo
```

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

// 2. Lint model for CFL stability & missing boundaries (M7001-M7013)
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
