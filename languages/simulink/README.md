<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/simulink

Native MATLAB **Simulink** (`.slx`, `.mdl`) compiler, pre-flight control system linter (`M7201`–`M7210`), Tarjan SCC algebraic loop detector, direct linear-memory WebAssembly `DAEBuilder` lowering, and bidirectional `Modelica.Blocks` / FMI projections for ModelScript.

---

## Core Capabilities

- **Zero-Regex `.slx` & `.mdl` Parsers (`parseSimulink`, `parseSlx`, `parseMdl`)**:
  - `.slx`: OPC ZIP archive extraction and `@modelscript/dsl/xml` parsing (`simulink/blockdiagram.xml` and nested subsystem XML parts)
  - `.mdl`: Zero-regex character scanner for hierarchical ASCII block diagrams (`Model`, `System`, `Block`, `Line`, `Branch`, `Port`).
- **Pre-Flight Control System Linter (`lintSimulinkModel`, `SimulinkErrorCode`, `analyzeSimulinkSchedule`)**: 10 static control-theoretic rules (`M7201`–`M7210`) including Tarjan Strongly Connected Components (SCC) direct-feedthrough algebraic loop detection, unconnected input port checks, bus schema verification, and 1-click LSP quick-fixes.
- **Direct Linear-Memory DAE Arena Lowering (`lowerSimulinkToDae`)**:
  - Continuous ODE state-space lowering for `Integrator`, `TransferFcn` (controllable canonical form), `StateSpace`, and `PIDController`
  - Algebraic equation lowering for `Gain`, `Sum`, `Product`, `Math`, `Saturation`, `DeadZone`, `Switch`, `Mux`, `Demux`, `BusCreator`, and `BusSelector`
  - Discrete clocked equation lowering for `UnitDelay` and `ZeroOrderHold`.
- **Polyglot Projections & Bidirectional TGG Sync (`simulinkToModelica`, `fmuToSimulink`, `synchronizeModelicaToSimulink`)**: Translates Simulink models to `Modelica.Blocks`, synthesizes Simulink S-Function wrappers from FMU descriptors, and reconciles Modelica changes back into `.mdl` via Triple Graph Grammar (TGG) rules.
- **Schematic Diagramming & Workspace Indexing (`buildSimulinkDiagram`, `renderSimulinkSvg`, `SimulinkWorkspaceIndex`)**: AntV X6 / headless SVG block diagram rendering and multi-file `IWorkspaceIndex` support.

---

## Package Structure

| Path                                 | Description                                                                                     |
| :----------------------------------- | :---------------------------------------------------------------------------------------------- |
| `src/index.ts`                       | Public package exports                                                                          |
| `src/language.ts`                    | `simulinkLanguage` grammar, LSP actions, and polyglot TGG configuration                         |
| `src/types.ts`                       | Core TypeScript interfaces (`SimulinkModel`, `SimulinkSystem`, `SimulinkBlock`, `SimulinkLine`) |
| `src/parser/slx-parser.ts`           | `parseSlx` OPC ZIP and XML parser for Simulink `.slx` archives                                  |
| `src/parser/mdl-parser.ts`           | `parseMdl` zero-regex character scanner for ASCII `.mdl` files                                  |
| `src/parser/index.ts`                | `parseSimulink` universal auto-detecting `.slx` / `.mdl` parser                                 |
| `src/lints/rules.ts`                 | `SimulinkErrorCode` (`M7201`–`M7210`) and `analyzeSimulinkSchedule` Tarjan SCC scheduler        |
| `src/lints/simulink-linters.ts`      | `lintSimulinkModel` comprehensive control-system diagnostic engine                              |
| `src/lints/index.ts`                 | Linter module re-exports                                                                        |
| `src/dae/simulink-to-dae.ts`         | `lowerSimulinkToDae` direct lowering of continuous/discrete blocks to `DAEBuilder`              |
| `src/dae/index.ts`                   | DAE module re-exports                                                                           |
| `src/projections/modelica.ts`        | `simulinkToModelica` translator to `Modelica.Blocks`                                            |
| `src/projections/fmu-to-simulink.ts` | `fmuToSimulink` generator synthesizing Simulink `.mdl` and C MEX S-Functions from FMUs          |
| `src/projections/index.ts`           | Projections module re-exports                                                                   |
| `src/tgg/simulink-rules.ts`          | Declarative TGG rules linking Simulink blocks and `Modelica.Blocks`                             |
| `src/tgg/simulink-sync.ts`           | `synchronizeModelicaToSimulink` bidirectional model synchronizer                                |
| `src/tgg/modelica-parser.ts`         | Lightweight Modelica block parser for TGG synchronization                                       |
| `src/tgg/types.ts`                   | TGG synchronization types                                                                       |
| `src/tgg/index.ts`                   | TGG module re-exports                                                                           |
| `src/diagram/simulink-diagram.ts`    | `buildSimulinkDiagram` and `renderSimulinkSvg` block diagram renderer                           |
| `src/diagram/index.ts`               | Diagram module re-exports                                                                       |
| `src/workspace-index.ts`             | `SimulinkWorkspaceIndex` implementing `IWorkspaceIndex`                                         |
| `src/lsp.ts`                         | LSP diagnostics, document symbols, and hover providers                                          |

---

## Semantic / Pre-Flight Lint Rules

| Code    | Rule                                   | Severity  | Description                                                                                                               |
| :------ | :------------------------------------- | :-------- | :------------------------------------------------------------------------------------------------------------------------ |
| `M7201` | `unconnected-input-port`               | `error`   | Input port on block is unconnected; all input ports must be driven or terminated with a `Ground` block.                   |
| `M7202` | `direct-feedthrough-algebraic-loop`    | `error`   | Direct-feedthrough algebraic loop detected across blocks without a state delay (`Integrator` or `UnitDelay`).             |
| `M7203` | `unresolved-subsystem-link`            | `error`   | `SubSystem` block has no defined sub-diagram or has an unresolved library reference.                                      |
| `M7204` | `port-index-out-of-bounds`             | `error`   | Block or signal line specifies an invalid port index ($\le 0$) or references a non-existent block.                        |
| `M7205` | `multirate-sample-time-conflict`       | `warning` | Block specifies an invalid `SampleTime` (must be $\ge 0$ for discrete or $-1$ for inherited).                             |
| `M7206` | `non-numeric-parameter`                | `error`   | Block parameter contains a non-finite, `NaN`, or invalid polynomial value (e.g., zero leading `TransferFcn` denominator). |
| `M7207` | `invalid-bus-selector`                 | `error`   | `BusSelector` block references a signal absent from the incoming `BusCreator` schema or connects to a non-bus block.      |
| `M7208` | `duplicate-block-name`                 | `error`   | Duplicate block name declared within the same subsystem scope.                                                            |
| `M7209` | `divide-by-zero-risk`                  | `warning` | `Product`/`Divide` block performs division (`Inputs` contains `/`) without division-by-zero protection.                   |
| `M7210` | `missing-integrator-initial-condition` | `info`    | `Integrator` block does not specify an explicit `InitialCondition` (defaulting to `0.0`).                                 |

---

## CLI & Programmatic Usage

### Command-Line Interface

```bash
# Lint a Simulink .slx or .mdl model (M7201–M7210)
npx msx simulink lint flight_autopilot.slx

# Lower Simulink block diagram to the ModelScript DAE arena
npx msx simulink flatten flight_autopilot.mdl

# Project Simulink block diagram to Modelica.Blocks
npx msx simulink to-modelica flight_autopilot.slx
```

### Programmatic API

```typescript
import {
  analyzeSimulinkSchedule,
  lintSimulinkModel,
  lowerSimulinkToDae,
  parseSimulink,
  simulinkToModelica,
} from "@modelscript/simulink";

// 1. Parse .slx (ZIP buffer) or .mdl (ASCII text)
const model = parseSimulink(mdlOrSlxInput);

// 2. Run pre-flight control system linter (M7201–M7210)
const diagnostics = lintSimulinkModel(model);

// 3. Compute causal execution schedule & detect algebraic loops via Tarjan SCC
const schedule = analyzeSimulinkSchedule(model);
console.log("Execution order:", schedule.executionOrder);

// 4. Lower to WebAssembly DAEBuilder and project to Modelica 3.x
const dae = lowerSimulinkToDae(model);
const modelicaCode = simulinkToModelica(model);
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
