<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/autosar

Native AUTOSAR Classic (R4.0–R22-11) and Adaptive ARXML (`.arxml`) compiler, pre-flight automotive architecture linter (`M7401`–`M7410`), cycle-accurate Virtual RTE execution scheduler, and direct WebAssembly `DAEBuilder` lowering for ModelScript.

---

## Core Capabilities

- **Zero-Regex Streaming ARXML Parser (`parseArxml`)**: Built on `@modelscript/dsl/xml` with exact 1-indexed line/column coordinates, extracting `AR-PACKAGE` hierarchies, `APPLICATION-SW-COMPONENT-TYPE`, `COMPOSITION-SW-COMPONENT-TYPE`, `P-PORT-PROTOTYPE`, `R-PORT-PROTOTYPE`, `SENDER-RECEIVER-INTERFACE`, `CLIENT-SERVER-INTERFACE`, `SWC-INTERNAL-BEHAVIOR`, `RUNNABLE-ENTITY`, `TIMING-EVENT`, `DATA-RECEIVED-EVENT`, `ASSEMBLY-SW-CONNECTOR`, `I-SIGNAL-I-PDU`, and `CAN-FRAME`.
- **Pre-Flight Automotive Linter (`lintAutosarModel`, `AutosarErrorCode`)**: Static verification of software component compositions, port interfaces, runnable WCET timing budgets, cyclic runnable dependencies, and CAN/PDU bit-packing rules (`M7401`–`M7410`).
- **Cycle-Accurate Virtual RTE Simulator (`VirtualRte`)**: Deterministic discrete-event execution scheduler simulating `INIT-EVENT`, periodic `TIMING-EVENT`, and `DATA-RECEIVED-EVENT` triggers with implicit/explicit inter-runnable communication buffers.
- **Direct Linear-Memory DAE Arena Lowering (`lowerAutosarToDae`)**: Lowers atomic and composition SWC port topologies and control laws directly into `@modelscript/runtime`'s `DAEBuilder` arena with optional 1D vehicle plant coupling.
- **Polyglot Projections (`autosarToModelica`, `autosarToSysml`, `fmuToAutosar`)**: Bidirectional translation between AUTOSAR `.arxml`, `Modelica.Blocks`, SysML v2 `part def` architectures, and FMI 2.0/3.0 Functional Mock-up Units.
- **Multi-File Workspace Indexer & LSP (`AutosarWorkspaceIndex`, `validateAutosar`, `getAutosarDocumentSymbols`, `getAutosarHover`)**: Implements `IWorkspaceIndex` for distributed multi-file `.arxml` repositories.

---

## Package Structure

| Path                                | Description                                                                            |
| :---------------------------------- | :------------------------------------------------------------------------------------- |
| `src/index.ts`                      | Public package exports                                                                 |
| `src/language.ts`                   | `autosarLanguage` grammar and `.arxml` file extension registration                     |
| `src/types.ts`                      | Core TypeScript interfaces (`AutosarModel`, `AutosarSwComponent`, `AutosarPdu`, etc.)  |
| `src/errors.ts`                     | `AutosarErrorCode` standard error catalog (`M7401`–`M7408`)                            |
| `src/parser/arxml-parser.ts`        | `parseArxml` zero-regex XML parser for AUTOSAR Classic & Adaptive `.arxml`             |
| `src/parser/index.ts`               | Parser module re-exports                                                               |
| `src/lints/rules.ts`                | `lintAutosarModel` pre-flight automotive verification engine (`M7401`–`M7410`)         |
| `src/lints/index.ts`                | Linter module re-exports                                                               |
| `src/rte/virtual-rte.ts`            | `VirtualRte` cycle-accurate discrete RTE scheduler and communication buffer engine     |
| `src/rte/index.ts`                  | Virtual RTE module re-exports                                                          |
| `src/dae/autosar-to-dae.ts`         | `lowerAutosarToDae` direct WebAssembly `DAEBuilder` lowering                           |
| `src/dae/index.ts`                  | DAE lowering module re-exports                                                         |
| `src/projections/modelica.ts`       | `autosarToModelica` projection to `Modelica.Blocks`                                    |
| `src/projections/sysml.ts`          | `autosarToSysml` projection to SysML v2 `part def` and port connectors                 |
| `src/projections/fmu-to-autosar.ts` | `fmuToAutosar` synthesizer generating ARXML SWCs and RTE glue from FMU descriptors     |
| `src/projections/index.ts`          | Projections module re-exports                                                          |
| `src/workspace-index.ts`            | `AutosarWorkspaceIndex` implementing `IWorkspaceIndex` for multi-file ARXML workspaces |
| `src/lsp.ts`                        | LSP diagnostics, document symbols, and hover providers                                 |

---

## Semantic / Pre-Flight Lint Rules

### Active Linter Rules (`src/lints/rules.ts` — `lintAutosarModel`)

| Code    | Rule                          | Severity  | Description                                                                                                    |
| :------ | :---------------------------- | :-------- | :------------------------------------------------------------------------------------------------------------- |
| `M7401` | `unconnected-mandatory-port`  | `error`   | Required port (`R-PORT-PROTOTYPE`) on a component prototype is unconnected in a composition.                   |
| `M7402` | `interface-mismatch`          | `error`   | Assembly connector links a provider port (`P-PORT`) and requirer port (`R-PORT`) with incompatible interfaces. |
| `M7403` | `missing-data-element-type`   | `warning` | Data element in a port interface has no `TYPE-TREF` data type reference.                                       |
| `M7404` | `duplicate-short-name`        | `error`   | Duplicate `SHORT-NAME` identifier detected within the same `AR-PACKAGE`.                                       |
| `M7405` | `wcet-budget-overflow`        | `error`   | Runnable entity worst-case execution time (`WCET`) exceeds its triggering `TIMING-EVENT` period.               |
| `M7406` | `overlapping-pdu-signal-bits` | `error`   | Multiple signals in an `I-SIGNAL-I-PDU` overlap at the same bit index.                                         |
| `M7407` | `pdu-frame-length-overflow`   | `error`   | `I-SIGNAL-I-PDU` byte length exceeds the payload capacity of its mapped `CAN-FRAME`.                           |
| `M7408` | `cyclic-runnable-dependency`  | `error`   | Cyclic data read/write dependency detected between runnable entities within an internal behavior.              |
| `M7409` | `missing-internal-behavior`   | `warning` | Atomic software component defines ports but lacks an `SWC-INTERNAL-BEHAVIOR` definition.                       |
| `M7410` | `untriggered-runnable-entity` | `info`    | Runnable entity in an SWC internal behavior has no associated RTE trigger event.                               |

### Standard Error Code Definitions (`src/errors.ts` — `AutosarErrorCode`)

| Code    | Rule                                    | Severity  | Description                                                                               |
| :------ | :-------------------------------------- | :-------- | :---------------------------------------------------------------------------------------- |
| `M7401` | `unconnected-mandatory-port`            | `warning` | Required port on component prototype is not connected by any assembly connector.          |
| `M7402` | `interface-mismatch`                    | `error`   | Connector interface mismatch between provider port interface and requirer port interface. |
| `M7403` | `invalid-runnable-period`               | `error`   | Timing event for runnable defines a non-positive period ($\le 0\text{ s}$).               |
| `M7404` | `duplicate-short-name`                  | `error`   | Duplicate `SHORT-NAME` detected in package.                                               |
| `M7405` | `invalid-data-type-mapping`             | `error`   | Invalid data type mapping for application/implementation data type.                       |
| `M7406` | `circular-composition-dependency`       | `error`   | Circular software component composition dependency detected.                              |
| `M7407` | `missing-software-address-method`       | `warning` | Variable data prototype lacks a declared `SwAddrMethod` memory section mapping.           |
| `M7408` | `incompatible-port-interface-direction` | `error`   | Port interface direction violation.                                                       |

---

## CLI & Programmatic Usage

### Command-Line Interface

```bash
# Lint an AUTOSAR ARXML architecture file
npx msx autosar lint powertrain_swc.arxml

# Simulate periodic RTE events and lower to DAE arena
npx msx autosar simulate powertrain_swc.arxml

# Project AUTOSAR composition to Modelica 3.x or SysML v2
npx msx autosar to-modelica powertrain_swc.arxml
npx msx autosar to-sysml powertrain_swc.arxml
```

### Programmatic API

```typescript
import {
  autosarToModelica,
  autosarToSysml,
  lintAutosarModel,
  lowerAutosarToDae,
  parseArxml,
  VirtualRte,
} from "@modelscript/autosar";

// 1. Parse AUTOSAR Classic / Adaptive ARXML
const model = parseArxml(arxmlContent);

// 2. Run pre-flight automotive linter (M7401–M7410)
const diagnostics = lintAutosarModel(model);

// 3. Execute cycle-accurate Virtual RTE simulation
const rte = new VirtualRte(model);
rte.runUntil(0.1, 0.001); // 100 ms duration, 1 ms resolution

// 4. Lower SWC architecture to WebAssembly DAEBuilder arena
const dae = lowerAutosarToDae(model, { includePlantModel: true });

// 5. Project to Modelica 3.x and SysML v2
const modelicaCode = autosarToModelica(model);
const sysmlCode = autosarToSysml(model);
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
