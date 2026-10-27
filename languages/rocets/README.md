<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/rocets

Native **NASA ROCETS (Rocket Engine Transient Simulator)** liquid propulsion system modeling, steady-state power balance, and transient startup/shutdown simulation package (`.roc`, `.rct`, `.inp`) for ModelScript. Features cryogenic propellant thermodynamics ($\text{LOX}$, $\text{LH}_2$, $\text{LCH}_4$, RP-1), NASA CEA combustion equilibrium & Bartz nozzle heat-transfer correlations, Newton-Raphson engine power-balance solving, direct linear-memory `DAEBuilder` lowering, 14 pre-flight propulsion lint rules (`M8001`–`M8014`), P&ID schematic generation, and Modelica/SSP projections.

---

## Core Capabilities

- **ROCETS Deck & Turbomachinery Map Parsers (`parseRocetsDeck`, `parseRocetsMap`)**: Ingests classical and modern ROCETS input decks (`.roc`, `.rct`, `.inp`) and turbopump/turbine performance maps.
- **Cryogenic Propellant & Combustion Thermodynamics (`getFluidProperties`, `evaluateCombustionCEA`, `evaluateNozzlePerformance`, `calculateBartzHeatTransfer`)**:
  - Cryogenic and storable propellant properties for $\text{LOX}$, $\text{LH}_2$, $\text{LCH}_4$, RP-1, $\text{GH}_2$, $\text{GOX}$, $\text{He}$, and $\text{N}_2$
  - Chemical Equilibrium with Applications (CEA) correlations for characteristic velocity $c^*$, specific heat ratio $\gamma$, adiabatic flame temperature $T_c$, and specific impulse $I_{sp}$
  - Isentropic compressible nozzle expansion and Bartz convective throat heat-transfer coefficient ($h_g$).
- **Steady-State Balance & Transient Startup/Shutdown Solvers (`solveRocetsBalance`, `simulateRocetsTransient`)**: Newton-Raphson steady-state solver enforcing turbopump-turbine shaft power equilibrium and propellant mass conservation, plus time-domain transient simulation of valve ramps, line inductances, and rotor inertia.
- **Direct Continuous DAE Arena Lowering (`rocetsToDae`, `lowerRocetsToDae`)**: Lowers turbopump shaft dynamics ($\dot{\omega} = (\tau_{\text{turb}} - \tau_{\text{pump}}) / J$), manifold volumes, and chamber pressure dynamics directly into `@modelscript/runtime`'s `IDaeBuilder`.
- **Pre-Flight Rocket Propulsion Linter (`lintRocets`, `RocetsErrorCode`)**: 14 domain diagnostics (`M8001`–`M8014`) checking propellant stream compatibility, NPSH cavitation margins, throat thermal limits, nozzle choking, turbine overspeed, and blocked pump discharge circuits.
- **Polyglot Projections & P&ID Diagrams (`rocetsToModelica`, `rocetsToSsp`, `buildRocetsDiagramData`, `renderRocetsPidSvg`)**: Projects rocket engine cycles to Modelica 3.x and FMI `SystemStructure.ssd`, and renders vector Piping & Instrumentation Diagrams (P&ID).

---

## Package Structure

| Path                                  | Description                                                                                 |
| :------------------------------------ | :------------------------------------------------------------------------------------------ |
| `src/index.ts`                        | Public package exports                                                                      |
| `src/language.ts`                     | `rocetsLanguage` grammar and file extension registration (`.roc`, `.rct`, `.inp`)           |
| `src/types.ts`                        | Core TypeScript interfaces (`RocetsEngineModel`, `RocetsComponent`, `RocetsPerformanceMap`) |
| `src/grammar/rocets-grammar.ts`       | ROCETS grammar combinators                                                                  |
| `src/grammar/index.ts`                | Grammar module re-exports                                                                   |
| `src/parser/deck-parser.ts`           | `parseRocetsDeck` parser for `.roc`, `.rct`, and `.inp` decks                               |
| `src/parser/map-parser.ts`            | `parseRocetsMap` turbomachinery map parser                                                  |
| `src/catalog/modules.ts`              | `ROCETS_MODULE_DESCRIPTORS` propulsion component catalog                                    |
| `src/catalog/default-maps.ts`         | `DEFAULT_PUMP_MAP`, `DEFAULT_TURBINE_MAP`, and `interpolatePerformanceMap`                  |
| `src/thermo/fluids.ts`                | `getFluidProperties` cryogenic propellant state properties                                  |
| `src/thermo/combustion.ts`            | `evaluateCombustionCEA` chamber flame temperature and $c^*$ correlations                    |
| `src/thermo/gas-dynamics.ts`          | `evaluateNozzlePerformance` and `calculateBartzHeatTransfer`                                |
| `src/thermo/index.ts`                 | Thermodynamics module re-exports                                                            |
| `src/script/user-routines.ts`         | Embedded Fortran user routine validation, step compilation, and DAE lowering                |
| `src/lints/index.ts`                  | `lintRocets` and `RocetsErrorCode` (`M8001`–`M8014`) pre-flight propulsion linter           |
| `src/dae/lowering.ts`                 | `lowerRocetsToDae` continuous state lowering to `IDaeBuilder`                               |
| `src/dae/rocets-to-dae.ts`            | `rocetsToDae` high-level DAE arena builder wrapper                                          |
| `src/dae/index.ts`                    | DAE module re-exports                                                                       |
| `src/solver/balance.ts`               | `solveRocetsBalance` Newton-Raphson steady-state engine power-balance solver                |
| `src/solver/transient.ts`             | `simulateRocetsTransient` startup/shutdown and throttling transient solver                  |
| `src/solver/index.ts`                 | Solver module re-exports                                                                    |
| `src/projections/rocetsToModelica.ts` | `rocetsToModelica` projection to Modelica 3.x                                               |
| `src/projections/rocetsToSsp.ts`      | `rocetsToSsp` projection to FMI `SystemStructure.ssd`                                       |
| `src/projections/index.ts`            | Projections module re-exports                                                               |
| `src/diagram/pid-diagram.ts`          | `buildRocetsDiagramData` and `renderRocetsPidSvg` P&ID schematic generator                  |
| `src/diagram/index.ts`                | Diagram module re-exports                                                                   |
| `src/workspace-index.ts`              | `RocetsWorkspaceIndex` multi-file workspace indexer                                         |
| `src/lsp.ts`                          | LSP validation, document symbols, hover, and action handlers                                |

---

## Semantic / Pre-Flight Lint Rules

| Code    | Rule                           | Severity  | Description                                                                                                   |
| :------ | :----------------------------- | :-------- | :------------------------------------------------------------------------------------------------------------ |
| `M8001` | `unconnected-fluid-port`       | `error`   | Fluid port `comp.port` is not connected in the propellant flow circuit.                                       |
| `M8002` | `fluid-type-mismatch`          | `error`   | Incompatible fluid stream connection mixing distinct propellants (e.g., `LOX` and `LH2`) outside a combustor. |
| `M8003` | `shaft-power-imbalance`        | `error`   | Turbopump shaft exhibits steady-state turbine/pump power imbalance or missing mechanical coupling.            |
| `M8004` | `unbalanced-flow-split`        | `error`   | Mass conservation failure at flow junction: inlet and outlet mass flow mismatch exceeds tolerance.            |
| `M8005` | `pump-cavitation-risk`         | `warning` | Turbopump inlet suction pressure falls below required Net Positive Suction Head ($\text{NPSH}$) margin.       |
| `M8006` | `negative-chamber-pressure`    | `error`   | Non-physical negative or zero chamber pressure ($P_c \le 0\text{ Pa}$) specified or computed.                 |
| `M8007` | `combustion-temperature-limit` | `warning` | Combustor or preburner gas temperature exceeds structural throat thermal limit ($3800\text{ K}$).             |
| `M8008` | `invalid-valve-schedule`       | `error`   | Valve actuation position or schedule falls outside the allowable $[0.0, 1.0]$ stroke range.                   |
| `M8009` | `choked-flow-inconsistency`    | `warning` | Supersonic nozzle expansion is not choked (chamber-to-ambient pressure ratio $P_c / P_a < 1.89$).             |
| `M8010` | `user-fortran-routine-error`   | `error`   | Embedded Fortran user routine in component contains a syntax or semantic error.                               |
| `M8011` | `extreme-mixture-ratio`        | `warning` | Engine oxidizer-to-fuel mixture ratio ($\text{O/F}$) is outside stable combustion limits ($[0.3, 15.0]$).     |
| `M8012` | `missing-fluid-table`          | `error`   | Referenced propellant fluid property table is not loaded in the session.                                      |
| `M8013` | `turbine-overspeed-hazard`     | `warning` | Turbopump shaft rotational speed ($\text{RPM}$) exceeds maximum burst rating (`MAX_RPM`).                     |
| `M8014` | `closed-flow-circuit`          | `error`   | Pump discharge is completely blocked with no open downstream valve or recirculation path.                     |

---

## CLI & Programmatic Usage

### Command-Line Interface

```bash
# Lint a NASA ROCETS propulsion deck (M8001–M8014)
npx msx rocets lint ssme_cycle.roc

# Solve steady-state engine balance and simulate startup transient
npx msx rocets simulate ssme_cycle.roc

# Project ROCETS deck to Modelica 3.x or FMI SSP
npx msx rocets to-modelica ssme_cycle.roc
npx msx rocets to-ssp ssme_cycle.roc
```

### Programmatic API

```typescript
import {
  lintRocets,
  lowerRocetsToDae,
  parseRocetsDeck,
  renderRocetsPidSvg,
  rocetsToModelica,
  simulateRocetsTransient,
  solveRocetsBalance,
} from "@modelscript/rocets";

// 1. Parse NASA ROCETS .roc input deck
const model = parseRocetsDeck(rocDeckSource);

// 2. Run pre-flight propulsion linter (M8001–M8014)
const diagnostics = lintRocets(model);

// 3. Solve steady-state shaft power balance and run transient startup
const balance = solveRocetsBalance(model);
const transient = simulateRocetsTransient(model, { durationSec: 5.0, dtSec: 0.01 });

// 4. Lower to DAE arena, project to Modelica, and render P&ID SVG
const dae = lowerRocetsToDae(model);
const modelicaCode = rocetsToModelica(model);
const pidSvg = renderRocetsPidSvg(model);
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
