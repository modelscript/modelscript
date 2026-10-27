<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/plcopen

IEC 61131-3 **PLCopen TC6 XML** and **Structured Text (ST)** (`.xml`, `.plcopen`, `.st`) industrial automation and digital twin language package for ModelScript. Features dual-mode XML and Structured Text parsing, 10 pre-flight IEC 61131-3 safety & control lint rules (`M7701`–`M7710`), deterministic Virtual PLC scan-cycle simulation (`VirtualPlc`), direct lowering to `DAEBuilder`, Modelica 3.x and SysML v2 projections, and multi-file workspace indexing.

---

## Core Capabilities

- **Dual-Mode PLCopen XML & Structured Text Parser (`parsePlcopen`, `parsePlcopenXml`, `parseStructuredText`)**: Zero-regex ingestion of PLCopen TC6 XML projects (`.xml`, `.plcopen`) and standalone IEC 61131-3 Structured Text files (`.st`), extracting Program Organization Units (`PROGRAM`, `FUNCTION_BLOCK`, `FUNCTION`), typed variables (`VAR_INPUT`, `VAR_OUTPUT`, `VAR_IN_OUT`, `VAR`), hardware I/O addresses (`%I*`, `%Q*`, `%M*`), configurations, resources, and periodic tasks.
- **Pre-Flight IEC 61131-3 Linter (`lintPlcProject`, `PlcErrorCode`)**: 10 static semantic and safety rules (`M7701`–`M7710`) detecting unassigned local variable reads, cyclic task overruns, prohibited recursive POU calls, hardware I/O address collisions, type mismatches, negative timer presets, unbounded loops, unknown FB types, unreachable dead code, and invalid task intervals.
- **Deterministic Virtual PLC Scan Engine (`VirtualPlc`)**: Executes discrete scan cycles with built-in IEC 61131-3 standard function blocks (`TON`, `TOF`, `TP` timers; `CTU`, `CTD`, `CTUD` counters; `R_TRIG`, `F_TRIG` edge detectors; `SR`, `RS` bistable latches; and `PID`).
- **Direct Linear-Memory DAE Arena Lowering (`lowerPlcopenToDae`)**: Lowers discrete/continuous PLC variables and equations directly into `@modelscript/runtime`'s `DAEBuilder` struct-of-arrays arena.
- **Polyglot Projections (`plcopenToModelica`, `plcopenToSysML`)**: Translates PLCopen POUs and state machines into Modelica 3.x blocks and SysML v2 `action def` / `state def` architectures.
- **Multi-File Workspace Indexer & LSP (`PlcopenWorkspaceIndex`, `validatePlcopen`, `getPlcopenDocumentSymbols`, `getPlcopenHover`)**: Implements `IWorkspaceIndex` for cross-file POU resolution and IDE language services.

---

## Package Structure

| Path                                     | Description                                                                                   |
| :--------------------------------------- | :-------------------------------------------------------------------------------------------- |
| `src/index.ts`                           | Public package exports                                                                        |
| `src/language.ts`                        | `plcopenLanguage` definition and LSP actions (`plcopen_lint`, `plcopen_run_scan`, etc.)       |
| `src/types.ts`                           | Core TypeScript interfaces (`PlcProject`, `PlcPou`, `PlcVariable`, `PlcStatement`, `PlcExpr`) |
| `src/parser/plcopen-xml-parser.ts`       | `parsePlcopenXml` zero-regex XML parser for PLCopen TC6 XML                                   |
| `src/parser/st-parser.ts`                | `parseStructuredText` parser for IEC 61131-3 Structured Text (`.st`)                          |
| `src/parser/index.ts`                    | `parsePlcopen` unified parser auto-detecting XML vs Structured Text                           |
| `src/lints/rules.ts`                     | `lintPlcProject` and `PlcErrorCode` (`M7701`–`M7710`) pre-flight IEC 61131-3 linter           |
| `src/lints/index.ts`                     | Linter module re-exports                                                                      |
| `src/solver/virtual-plc.ts`              | `VirtualPlc` deterministic scan-cycle execution engine (`TON`, `TOF`, `TP`, `CTU`, `CTD`)     |
| `src/solver/index.ts`                    | Solver module re-exports                                                                      |
| `src/dae/plcopen-to-dae.ts`              | `lowerPlcopenToDae` direct lowering to `DAEBuilder`                                           |
| `src/dae/index.ts`                       | DAE module re-exports                                                                         |
| `src/projections/plcopen-to-modelica.ts` | `plcopenToModelica` translator to Modelica 3.x control blocks                                 |
| `src/projections/plcopen-to-sysml.ts`    | `plcopenToSysML` translator to SysML v2 `action def` and `part def`                           |
| `src/projections/index.ts`               | Projections module re-exports                                                                 |
| `src/workspace-index.ts`                 | `PlcopenWorkspaceIndex` implementing `IWorkspaceIndex`                                        |
| `src/lsp.ts`                             | LSP diagnostics, document symbols, and hover providers                                        |

---

## Semantic / Pre-Flight Lint Rules

| Code    | Rule                       | Severity  | Description                                                                                  |
| :------ | :------------------------- | :-------- | :------------------------------------------------------------------------------------------- |
| `M7701` | `unassigned-variable-read` | `error`   | Local variable is read before being assigned or initialized in POU.                          |
| `M7702` | `cyclic-task-overrun`      | `warning` | Computational complexity (statement count) in task may exceed its periodic cycle interval.   |
| `M7703` | `recursive-pou-call`       | `error`   | Recursive invocation of POU detected (recursion is prohibited in IEC 61131-3).               |
| `M7704` | `io-mapping-collision`     | `error`   | Hardware I/O output address collision (`%Q*`): multiple variables mapped to the same output. |
| `M7705` | `type-mismatch-assignment` | `error`   | Type mismatch in variable assignment without explicit type conversion.                       |
| `M7706` | `timer-preset-negative`    | `error`   | Timer (`TON`, `TOF`, `TP`) preset time `PT` is negative (`T#-...`).                          |
| `M7707` | `unbounded-loop-detected`  | `warning` | `WHILE` loop in POU does not have a deterministic bounded termination condition.             |
| `M7708` | `unknown-pou-type`         | `error`   | Unknown or unresolvable POU or function block type instantiated in task or resource.         |
| `M7709` | `unreachable-code`         | `warning` | Unreachable code detected after `RETURN` or `EXIT` statement in POU.                         |
| `M7710` | `invalid-task-interval`    | `error`   | Task specifies an invalid or non-positive periodic cycle interval ($\le 0\text{ ms}$).       |

---

## CLI & Programmatic Usage

### Command-Line Interface

```bash
# Lint a PLCopen XML or Structured Text (.st) project (M7701–M7710)
npx msx plcopen lint conveyor_plc.st

# Run deterministic Virtual PLC scan cycles
npx msx plcopen simulate conveyor_plc.st

# Project PLCopen POUs to Modelica 3.x or SysML v2
npx msx plcopen to-modelica conveyor_plc.st
npx msx plcopen to-sysml conveyor_plc.st
```

### Programmatic API

```typescript
import {
  lintPlcProject,
  lowerPlcopenToDae,
  parsePlcopen,
  plcopenToModelica,
  plcopenToSysML,
  VirtualPlc,
} from "@modelscript/plcopen";

// 1. Parse PLCopen TC6 XML or IEC 61131-3 Structured Text
const project = parsePlcopen(stOrXmlSource);

// 2. Run pre-flight IEC 61131-3 linter (M7701–M7710)
const diagnostics = lintPlcProject(project);

// 3. Execute deterministic Virtual PLC scan cycles (20 cycles at 10 ms)
const plc = new VirtualPlc(project);
const history = plc.runCycles(20, 10);

// 4. Lower to WebAssembly DAEBuilder and project to Modelica / SysML v2
const dae = lowerPlcopenToDae(project);
const modelicaCode = plcopenToModelica(project);
const sysmlCode = plcopenToSysML(project);
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
