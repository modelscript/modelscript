<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/gtsuite

Gamma Technologies **GT-SUITE / GT-POWER** 1D powertrain, internal combustion engine, turbocharging, and thermo-fluid dynamic simulation package (`.gtm`, `.gtd`, `.gtx`, `.gt`, `.dat`, `.gdx`) for ModelScript. Features XML and ASCII engine deck parsing, crank-angle resolved 0D/1D cylinder combustion & Woschni heat-transfer simulation, Mean-Value Engine Model (MVEM) lowering to `DAEBuilder`, 15 pre-flight powertrain lint rules (`M9001`–`M9015`), GT-POST `.gdx` trajectory verification gates, and SysML v2 / Modelica / SSP projections.

---

## Core Capabilities

- **GT-SUITE Model & Performance Map Parsers (`parseGtmModel`, `parseGtTableMap`, `parseGdxTrajectory`)**: Ingests GT-SUITE XML project files and ASCII engine decks (`.gtm`, `.gtd`, `.gtx`, `.gt`), turbocharger performance maps, and GT-POST `.gdx` trajectories.
- **Crank-Angle Resolved 0D/1D Cylinder Thermodynamics (`simulateGtSuiteTransient`)**:
  - Crank-slider kinematics ($V(\theta)$, $dV/d\theta$, instantaneous piston speed)
  - Single & Double Wiebe heat-release laws ($x_b(\theta)$) and imposed mass-fraction-burned (MFB) profiles
  - Woschni and Annand convective wall heat transfer ($h_c$)
  - Temperature-dependent real-gas properties ($\gamma(T)$, $c_p(T)$) for gasoline, diesel, natural gas, hydrogen, and ethanol
  - Extended Zeldovich thermal $\text{NO}_x$ kinetics and Livengood-Wu autoignition knock integral.
- **Direct Continuous DAE Arena Lowering (`gtsuiteToDae`, `lowerGtSuiteToDae`)**: Lowers Mean-Value Engine Models (MVEM) and crank-angle cylinder dynamics directly into `@modelscript/runtime`'s `IDaeBuilder` for MiL/SiL/HiL co-simulation.
- **Pre-Flight Powertrain Linter (`lintGtModel`, `GtSuiteErrorCode`)**: 15 domain-specific diagnostics (`M9001`–`M9015`) checking acoustic CFL stability, compressor surge/choke margins, valve lash overlap, compression ratio bounds, knock hazards, and air-fuel flammability limits.
- **Polyglot Projections (`gtsuiteToSysml2`, `gtsuiteToModelica`, `gtsuiteToSsp`)**: Translates engine topologies into SysML v2 architectures (`part def EnginePowertrainSystem` + BSFC/boost/$\text{NO}_x$ requirements), Modelica 3.x models, and FMI `SystemStructure.ssd` containers.
- **Schematic Visualization & Native Orchestration (`buildGtSuiteDiagramData`, `renderGtSuiteSchematicSvg`, `runGtSuiteSimulation`, `verifyEngineGates`)**: AntV X6 / headless SVG engine schematics and batch `gtise` runner with automatic in-WASM fallback.

---

## Package Structure

| Path                                     | Description                                                                               |
| :--------------------------------------- | :---------------------------------------------------------------------------------------- |
| `src/index.ts`                           | Public package exports                                                                    |
| `src/language.ts`                        | `gtsuiteLanguage` grammar and file extension registration (`.gtm`, `.gtd`, `.gtx`, `.gt`) |
| `src/types.ts`                           | Core TypeScript interfaces (`GtModel`, `GtCylinderComponent`, `GtSimulationResult`, etc.) |
| `src/parser/gtm-parser.ts`               | `parseGtmModel` parser for XML and ASCII GT-SUITE engine models                           |
| `src/parser/map-parser.ts`               | `parseGtTableMap` and `interpolateMap1D` performance map readers                          |
| `src/parser/gdx-reader.ts`               | `parseGdxTrajectory` GT-POST `.gdx` trajectory reader                                     |
| `src/parser/index.ts`                    | Parser module re-exports                                                                  |
| `src/thermo/fluids.ts`                   | `STANDARD_FUELS`, `getFuelProperties`, and `calculateGasProperties`                       |
| `src/thermo/combustion.ts`               | `calculateCrankSliderKinematics` and `evaluateBurnRate` (Wiebe & MFB)                     |
| `src/thermo/heat-transfer.ts`            | `calculateWoschniHeatTransfer` in-cylinder convective heat transfer                       |
| `src/thermo/kinetics.ts`                 | `calculateZeldovichNoxRate` and `evaluateLivengoodWuKnock`                                |
| `src/thermo/index.ts`                    | Thermodynamics module re-exports                                                          |
| `src/lints/index.ts`                     | `lintGtModel` and `GtSuiteErrorCode` (`M9001`–`M9015`) pre-flight powertrain linter       |
| `src/dae/cylinder-dae.ts`                | Crank-angle resolved cylinder thermodynamics and transient simulator                      |
| `src/dae/mvem-dae.ts`                    | Mean-Value Engine Model (MVEM) equations for `IDaeBuilder`                                |
| `src/dae/gtsuite-to-dae.ts`              | `gtsuiteToDae`, `lowerGtSuiteToDae`, and `simulateGtSuiteTransient`                       |
| `src/dae/index.ts`                       | DAE module re-exports                                                                     |
| `src/projections/gtsuite-to-modelica.ts` | `gtsuiteToModelica` projection to Modelica 3.x                                            |
| `src/projections/gtsuite-to-sysml2.ts`   | `gtsuiteToSysml2` projection to SysML v2 architecture and requirements                    |
| `src/projections/gtsuite-to-ssp.ts`      | `gtsuiteToSsp` projection to FMI `SystemStructure.ssd`                                    |
| `src/projections/index.ts`               | Projections module re-exports                                                             |
| `src/diagram/gtsuite-diagram-builder.ts` | `buildGtSuiteDiagramData` and `renderGtSuiteSchematicSvg`                                 |
| `src/diagram/index.ts`                   | Diagram module re-exports                                                                 |
| `src/engine/gtsuite-orchestrator.ts`     | `runGtSuiteSimulation` and `isGtSuiteEngineAvailable` native/WASM orchestrator            |
| `src/engine/engine-gate.ts`              | `verifyEngineGates` formal BSFC, peak pressure, knock, and $\text{NO}_x$ gate verifier    |
| `src/engine/index.ts`                    | Engine orchestration module re-exports                                                    |
| `src/workspace-index.ts`                 | `GtSuiteWorkspaceIndex` multi-file workspace indexer                                      |
| `src/lsp.ts`                             | LSP validation, document symbols, hover, and action handlers                              |

---

## Semantic / Pre-Flight Lint Rules

| Code    | Rule                                  | Severity  | Description                                                                                                          |
| :------ | :------------------------------------ | :-------- | :------------------------------------------------------------------------------------------------------------------- |
| `M9001` | `cfl-acoustic-violation`              | `warning` | Pipe discretization cell length violates acoustic Courant-Friedrichs-Lewy ($\text{CFL}$) stability limit.            |
| `M9002` | `compressor-surge-hazard`             | `warning` | Turbocharger compressor operating point (high pressure ratio, low mass flow) falls into aerodynamic surge.           |
| `M9003` | `compressor-choke-limit`              | `warning` | Turbocharger compressor mass flow exceeds maximum choke/stonewall sonic flow capacity.                               |
| `M9004` | `valve-profile-overlap-error`         | `error`   | Valve kinematic profile defect (e.g., negative valve lash clearance).                                                |
| `M9005` | `compression-ratio-invalid`           | `error`   | Cylinder compression ratio is outside physical reciprocating engine bounds ($6.0 \le r_c \le 26.0$).                 |
| `M9006` | `unconnected-plenum-node`             | `error`   | Flow split or plenum has no connected flow paths or boundary conditions.                                             |
| `M9007` | `discharge-coefficient-out-of-bounds` | `warning` | Valve or orifice discharge coefficient $C_d$ is non-physical (must satisfy $0.0 < C_d \le 1.0$).                     |
| `M9008` | `knock-margin-deficit`                | `warning` | Cylinder operates in severe autoignition/knock hazard (high compression ratio with overly advanced spark timing).    |
| `M9009` | `missing-boundary-pressure`           | `error`   | Environment boundary node has invalid or uninitialized static pressure ($\le 0\text{ Pa}$).                          |
| `M9010` | `turbine-expansion-ratio-excess`      | `warning` | Turbine expansion ratio exceeds single-stage choked limit ($> 4.5$).                                                 |
| `M9011` | `intercooler-effectiveness-invalid`   | `warning` | Intercooler thermal effectiveness violates 2nd Law of Thermodynamics (must satisfy $0.0 < \varepsilon \le 1.0$).     |
| `M9012` | `air-fuel-equivalence-out-of-bounds`  | `error`   | Air-fuel equivalence ratio $\lambda$ is outside combustible flammability limits ($0.50 \le \lambda \le 2.50$).       |
| `M9013` | `negative-pipe-dimensions`            | `error`   | Pipe or runner has non-positive diameter or length ($\le 0\text{ m}$).                                               |
| `M9014` | `injector-timing-conflict`            | `error`   | Injector start of injection ($\text{SOI}$) falls outside valid 4-stroke cycle window ($-360^\circ$ to $+720^\circ$). |
| `M9015` | `isolated-shaft-inertia`              | `warning` | Turbocharger shaft has no linked compressor or turbine rotating components.                                          |

---

## CLI & Programmatic Usage

### Command-Line Interface

```bash
# Lint a GT-SUITE engine model (M9001–M9015)
npx msx gtsuite lint turbo_gdi.gtm

# Run 0D/1D crank-angle resolved transient simulation
npx msx gtsuite simulate turbo_gdi.gtm

# Project GT-SUITE model to SysML v2, Modelica 3.x, or FMI SSP
npx msx gtsuite to-sysml turbo_gdi.gtm
npx msx gtsuite to-modelica turbo_gdi.gtm
npx msx gtsuite to-ssp turbo_gdi.gtm
```

### Programmatic API

```typescript
import {
  gtsuiteToModelica,
  gtsuiteToSysml2,
  lintGtModel,
  lowerGtSuiteToDae,
  parseGtmModel,
  simulateGtSuiteTransient,
  verifyEngineGates,
} from "@modelscript/gtsuite";

// 1. Parse GT-SUITE .gtm model
const model = parseGtmModel(gtmSource);

// 2. Run pre-flight powertrain linter (M9001–M9015)
const diagnostics = lintGtModel(model);

// 3. Run in-WASM crank-angle resolved cylinder & turbo simulation
const simResult = simulateGtSuiteTransient(model, { numCycles: 5 });
const gateReport = verifyEngineGates(simResult, {
  maxPeakPressureBar: 120,
  maxBsfcGKwh: 240,
});

// 4. Lower MVEM to DAE arena and project to SysML v2 / Modelica
const dae = lowerGtSuiteToDae(model);
const sysmlCode = gtsuiteToSysml2(model);
const modelicaCode = gtsuiteToModelica(model);
```

---

## Scripts

| Command             | Description                                                    |
| :------------------ | :------------------------------------------------------------- |
| `npm run build`     | Compile TypeScript sources to `dist/` (`tsc`)                  |
| `npm run clean`     | Remove `dist/` build artifacts (`rimraf dist`)                 |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                          |
| `npm test`          | Run unit and integration test suite via `test-runner.js`       |
| `npm run typecheck` | Run TypeScript type checking without emitting (`tsc --noEmit`) |
