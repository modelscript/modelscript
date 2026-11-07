<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/automationml

IEC 62714 AutomationML (`.aml`) industrial plant engineering, CAEX 2.15 / 3.0 topology, COLLADA 6-DOF kinematics, and PLCopen Virtual Commissioning package for ModelScript. Features an AutomationML CAEX XML & JSON parser (`parseAutomationML`), multi-file workspace indexing (`AmlWorkspaceIndex`), a discrete/continuous Virtual Commissioning co-simulation engine (`runAmlVirtualCommissioning`), direct linear-memory `DAEBuilder` lowering (`lowerAutomationMLToDae`), 7 IEC 62714 semantic lint rules (`M8301`–`M8307`, `lintAutomationML`, `AmlErrorCode`), SSP 1.0 `.ssd`, SysML v2, and Modelica 3.x projections (`amlToSsp`, `amlToSysML2`, `amlToModelica`), and Language Server Protocol (LSP) services.

---

## Core Capabilities

- **IEC 62714 CAEX 2.15 / 3.0 Parser (`parseAutomationML`)**: Parses all four AutomationML pillars with exact source spans:
  - **`InstanceHierarchy`**: Nested `InternalElement` plant topologies, 6-DOF `Frame` transforms (`x, y, z, rx, ry, rz`), `ExternalInterface` ports, `InternalLink` signal/power/material connections, and `RoleRequirements`.
  - **`SystemUnitClassLib` & `RoleClassLib`**: Reusable mechatronic equipment classes, `RefBaseClassPath` inheritance hierarchies, and standard AML role libraries (`AutomationMLBaseRoleClassLib`).
  - **`InterfaceClassLib`**: `ExternalDataConnector` (`COLLADAInterface`, `PLCopenXMLInterface`, `FMUInterface`), `SignalInterface`, `PowerInterface`, and `MaterialFlowInterface` definitions.
- **Virtual Commissioning Co-Simulation Engine (`runAmlVirtualCommissioning`)**: Executes closed-loop plant + PLC virtual commissioning across linked `InternalElement` dynamics, `PLCopenXMLInterface` logic rules, and `InternalLink` I/O routing, computing cycle times, interlock violations, and actuator trajectories.
- **Direct Linear-Memory `DAEBuilder` Lowering (`lowerAutomationMLToDae`)**: Lowers `InternalElement` physical plant dynamics and `InternalLink` connection equations directly into ModelScript's WebAssembly `DAEBuilder` arena.
- **7 IEC 62714 Semantic Lint Rules (`M8301`–`M8307`, `lintAutomationML`)**: Static verification of base class paths, inheritance cycles, `InternalLink` endpoint resolution, port direction/category compatibility, `RoleRequirements` conformance, external `refURI` links, and 6-DOF `Frame` bounds.
- **SSP 1.0, SysML v2 & Modelica 3.x Projections (`amlToSsp`, `amlToSysML2`, `amlToModelica`)**: Projects AutomationML hierarchies into System Structure and Parameterization (`.ssd`) co-simulation topologies, SysML v2 `part def` architectures, and Modelica 3.x models.
- **Multi-File Workspace Indexing & LSP (`AmlWorkspaceIndex`, `validateAutomationML`, `getAmlHover`, `getAmlCompletions`, `getAmlDefinition`)**: Full `IWorkspaceIndex` implementation across `.aml` files with hover cards, completions, and go-to-definition.

---

## Package Structure

| Path                       | Description                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/index.ts`             | Public package exports                                                                               |
| `src/language.ts`          | `automationMLLanguage` definition, compiler actions, and MCP tool (`aml_run_virtual_commissioning`)  |
| `src/types.ts`             | `AmlDocument`, `AmlInternalElement`, `AmlSystemUnitClass`, `AmlRoleClass`, `AmlInterfaceClass` types |
| `src/parser/index.ts`      | `parseAutomationML` CAEX 2.15 / 3.0 XML and JSON parser                                              |
| `src/lints/rules.ts`       | `AmlErrorCode` and `lintAutomationML` IEC 62714 diagnostic engine (`M8301`–`M8307`)                  |
| `src/lints/index.ts`       | Linter barrel exports                                                                                |
| `src/vc/index.ts`          | `runAmlVirtualCommissioning` closed-loop PLC + mechatronic plant virtual commissioning simulator     |
| `src/dae/index.ts`         | `lowerAutomationMLToDae` direct lowering into `DAEBuilder` linear memory                             |
| `src/projections/index.ts` | `amlToSsp`, `amlToSysML2`, and `amlToModelica` cross-language translators                            |
| `src/workspace-index.ts`   | `AmlWorkspaceIndex` implementing `IWorkspaceIndex` across `.aml` files                               |
| `src/lsp.ts`               | LSP validation, document symbols, hover, completion, and definition providers                        |

---

## Pre-Flight Semantic Lint Rules (`M8301`–`M8307`)

| Code    | Rule                               | Severity  | Description                                                                                                               |
| ------- | ---------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------- |
| `M8301` | `aml-unresolved-base-class`        | `error`   | `RefBaseClassPath` or `RefBaseSystemUnitPath` does not resolve to a declared or standard AutomationML class.              |
| `M8302` | `aml-inheritance-cycle`            | `error`   | Circular inheritance chain detected in `SystemUnitClassLib`, `RoleClassLib`, or `InterfaceClassLib`.                      |
| `M8303` | `aml-invalid-internal-link`        | `error`   | `InternalLink` `RefPartnerSideA` or `RefPartnerSideB` does not resolve to a valid `InternalElement:Interface`.            |
| `M8304` | `aml-port-direction-conflict`      | `error`   | `InternalLink` connects incompatible ports (`In`–`In`, `Out`–`Out`, or mismatched interface categories).                  |
| `M8305` | `aml-unsatisfied-role-requirement` | `error`   | `InternalElement` is missing required interfaces or attributes mandated by its `RoleRequirements`.                        |
| `M8306` | `aml-broken-external-ref-uri`      | `warning` | External reference `refURI` on `COLLADAInterface`, `PLCopenXMLInterface`, or `FMUInterface` is empty or unresolved.       |
| `M8307` | `aml-invalid-frame-transform`      | `error`   | `Frame` attribute on `InternalElement` contains non-finite coordinates or Euler angles outside $[-360^\circ, 360^\circ]$. |

---

## CLI & Programmatic Usage

### Command-Line Interface (`msx aml`)

```bash
# Lint an AutomationML (.aml) plant file (M8301-M8307)
npx msx aml lint assembly_cell.aml

# Run closed-loop Virtual Commissioning simulation
npx msx aml vc assembly_cell.aml --duration 10 --dt 0.01

# Lower to DAE or project to SSP 1.0 (.ssd), SysML v2 (.sysml), or Modelica (.mo)
npx msx aml to-dae assembly_cell.aml
npx msx aml to-ssp assembly_cell.aml
npx msx aml to-sysml2 assembly_cell.aml
npx msx aml to-modelica assembly_cell.aml
```

### Programmatic API

```typescript
import {
  amlToModelica,
  amlToSsp,
  amlToSysML2,
  lintAutomationML,
  lowerAutomationMLToDae,
  parseAutomationML,
  runAmlVirtualCommissioning,
} from "@modelscript/automationml";

// 1. Parse CAEX 2.15 / 3.0 .aml file and run IEC 62714 lint rules (M8301-M8307)
const doc = parseAutomationML(amlXml, "assembly_cell.aml");
const diagnostics = lintAutomationML(doc);

// 2. Run Virtual Commissioning simulation across mechatronic units and PLCopen I/O links
const vcResult = runAmlVirtualCommissioning(doc, { duration: 10.0, dt: 0.02 });
console.log("Virtual commissioning passed:", vcResult.passed, "Cycles:", vcResult.completedCycles);

// 3. Lower to DAEBuilder or project to SSP 1.0, SysML v2, and Modelica 3.x
const dae = lowerAutomationMLToDae(doc);
const ssdXml = amlToSsp(doc);
const sysmlCode = amlToSysML2(doc);
const modelicaCode = amlToModelica(doc);
```

---

## Scripts

| Command             | Description                                                                       |
| ------------------- | --------------------------------------------------------------------------------- |
| `npm run build`     | Compile TypeScript to `dist/`                                                     |
| `npm test`          | Run AutomationML parser, linter, virtual commissioning, DAE, and projection tests |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                                             |
| `npm run typecheck` | Run `tsc --noEmit` type verification                                              |
| `npm run clean`     | Remove `dist/` build artifacts                                                    |

---

## License

`AGPL-3.0-or-later`
