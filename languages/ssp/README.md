<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/ssp

Modelica Association System Structure and Parameterization (SSP 1.0) language package (`.ssp`, `.ssd`, `.ssv`, `.ssm`) for ModelScript. Provides high-speed XML parsing (`parseSsd`, `parseSsv`), virtual filesystem (`.ssp`) container extraction, 20 semantic lint rules (`SSP_*` and `SSV_*`), interactive 2D system architecture diagram generation & bidirectional XML writeback (`buildSspDiagramData`, `applySspDiagramEdits`), `sspToModelicaBlock` code generation, and 8 polyglot TGG rules.

---

## Core Capabilities

- **SSP 1.0 XML Parser (`parseSsd`, `parseSsv`)**: Zero-DOM parser for `SystemStructureDescription` (`.ssd`) and `SystemStructureParameterValues` (`.ssv`) XML files, extracting system boundary connectors, FMU component blocks (`<ssd:Component>`), typed connectors (`Real`, `Integer`, `Boolean`, `String`, `Enumeration`), signal connections (`<ssd:Connection>`), inline & external parameter bindings (`<ssd:ParameterBinding>`), `<ssd:DefaultExperiment>` bounds, and 2D layout geometries (`<ssd:ElementGeometry>`, `<ssd:ConnectorGeometry>`, `<ssd:ConnectionGeometry>`).
- **VFS `.ssp` Archive Extractor (`sspLanguage.container`)**: Automatically unpacks ZIP-based `.ssp` containers into the virtual filesystem, parsing `SystemStructure.ssd` as the root manifest, mounting `.ssv` parameter sets, and recursively extracting nested `.fmu` archives for multi-FMU co-simulation orchestration.
- **20 `SSP_*` & `SSV_*` Semantic Lint Rules (`lintSsd`, `lintSsv`)**: Pinpoints exact byte and 1-indexed line/column attribute value ranges across `.ssd` and `.ssv` XML documents for connector type mismatches, causal flow conflicts, unresolved endpoints, invalid parameter literals, and malformed experiment time bounds.
- **Interactive 2D Architecture Diagram Builder & XML Writeback (`buildSspDiagramData`, `applySspDiagramEdits`, `applySspTextEdits`)**:
  - Converts `SspSystem` models into AntV X6 `DiagramData` with color-coded causal ports (`Real`, `Integer`, `Boolean`, `String`, `Enumeration`), system boundary port nodes, orthogonal Manhattan edge routing, and bound parameter badges.
  - Translates interactive diagram manipulation actions (`moveNode`, `addComponent`, `deleteNode`, `addConnection`, `deleteConnection`, `renameNode`, `updateParameter`, `updateProperty`) into line-accurate `SspTextEdit` patches on `SystemStructure.ssd`.
- **`sspToModelicaBlock` Code Generation (`projection.ts`)**: Projects multi-FMU SSP architectures into composite Modelica `model` blocks with typed sub-component declarations, parameter modifications, and `connect(...)` equations.
- **8 Bidirectional Polyglot TGG Rules**: Synchronizes SSP systems, FMU components, connectors, and connections with both Modelica models and SysML v2 system architecture packages.

---

## Package Structure

| Path                | Description                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`      | Public package exports (`sspLanguage`, `parseSsd`, `parseSsv`, `lintSsd`, `lintSsv`, `buildSspDiagramData`, `sspToModelicaBlock`) |
| `src/language.ts`   | `sspLanguage` definition, VFS `.ssp` ZIP container extractor, LSP actions, and 8 polyglot TGG rules                               |
| `src/ssd-parser.ts` | `parseSsd` and `parseSsv` XML parsers with source line tracking and geometry extraction                                           |
| `src/linter.ts`     | `lintSsd` and `lintSsv` implementing all 20 `SSP_*` and `SSV_*` semantic validation rules                                         |
| `src/diagram.ts`    | `buildSspDiagramData`, `applySspDiagramEdits`, `applySspTextEdits`, and `getSspPaletteCategories`                                 |
| `src/projection.ts` | `sspToModelicaBlock` code generator translating `SspSystem` graphs into Modelica source code                                      |
| `src/types.ts`      | TypeScript interfaces (`SspSystem`, `SspComponent`, `SspConnector`, `SspConnection`, `SspParameterBinding`, etc.)                 |

---

## Semantic Lint Rules (20 `SSP_*` & `SSV_*` Rules)

### System Structure Description (`SSP_*` — 13 Rules)

| Code                               | Severity            | Description                                                                                                          |
| ---------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `SSP_EMPTY_CONNECTOR_NAME`         | `error`             | `<ssd:Connector>` has an empty or missing `name` attribute                                                           |
| `SSP_DUPLICATE_CONNECTOR`          | `error`             | Duplicate connector name declared on the same component or system boundary                                           |
| `SSP_INVALID_CONNECTOR_KIND`       | `error`             | Invalid connector `kind` (expected `input`, `output`, `inout`, `parameter`, or `calculatedParameter`)                |
| `SSP_EMPTY_COMPONENT_NAME`         | `error`             | `<ssd:Component>` declaration is missing a valid `name` attribute                                                    |
| `SSP_DUPLICATE_COMPONENT`          | `error`             | Duplicate component `name` declared within `<ssd:Elements>`                                                          |
| `SSP_MISSING_COMPONENT_SOURCE`     | `warning`           | `<ssd:Component>` has no FMU `source` URI specified                                                                  |
| `SSP_UNRESOLVED_ELEMENT`           | `error`             | `<ssd:Connection>` `startElement` or `endElement` references an unknown component                                    |
| `SSP_UNRESOLVED_CONNECTOR`         | `error`             | `<ssd:Connection>` `startConnector` or `endConnector` does not exist on the target component/boundary                |
| `SSP_SELF_CONNECTION`              | `error`             | `<ssd:Connection>` connects a connector directly to itself                                                           |
| `SSP_CONNECTOR_TYPE_MISMATCH`      | `error`             | Connected endpoints have incompatible data types (e.g., `Real` connected to `Boolean`)                               |
| `SSP_CONNECTOR_CAUSALITY_CONFLICT` | `error` / `warning` | Invalid `input`-to-`input` / `output`-to-`output` connection (`error`) or reversed `input`→`output` flow (`warning`) |
| `SSP_UNRESOLVED_BINDING_PREFIX`    | `error`             | `<ssd:ParameterBinding>` `prefix` references a component that does not exist in `<ssd:Elements>`                     |
| `SSP_INVALID_EXPERIMENT_BOUNDS`    | `error`             | Non-numeric `startTime`/`stopTime` or `startTime >= stopTime` in `<ssd:DefaultExperiment>`                           |

### System Structure Parameter Values (`SSV_*` — 7 Rules)

| Code                          | Severity | Description                                                                                          |
| ----------------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `SSV_EMPTY_PARAMETER_NAME`    | `error`  | `<ssv:Parameter>` declaration has an empty or missing `name` attribute                               |
| `SSV_DUPLICATE_PARAMETER`     | `error`  | Duplicate parameter `name` within the same `<ssv:ParameterSet>`                                      |
| `SSV_MISSING_PARAMETER_TYPE`  | `error`  | `<ssv:Parameter>` is missing a child type tag (`<ssv:Real>`, `<ssv:Integer>`, `<ssv:Boolean>`, etc.) |
| `SSV_MISSING_PARAMETER_VALUE` | `error`  | Parameter type element is missing a `value` attribute                                                |
| `SSV_INVALID_REAL_VALUE`      | `error`  | `<ssv:Real>` `value` is not a valid finite floating-point number                                     |
| `SSV_INVALID_INTEGER_VALUE`   | `error`  | `<ssv:Integer>` `value` is not a valid base-10 integer                                               |
| `SSV_INVALID_BOOLEAN_VALUE`   | `error`  | `<ssv:Boolean>` `value` is not one of `'true'`, `'false'`, `'1'`, or `'0'`                           |

---

## Polyglot Triple Graph Grammar (TGG) Rules

`@modelscript/ssp` defines 8 bidirectional TGG rules in `sspLanguage.polyglot.rules`:

| Rule Name                         | Source (`ssp`)                                       | Target (`modelica` / `sysml2`)                                           |
| --------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------ |
| `SspSystemToModelicaModel`        | `System(name: sysName)`                              | `modelica`: `ClassDefinition(name: sysName, classKind: "model")`         |
| `SspComponentToModelicaComponent` | `Component(name: compName, source: sourceFile)`      | `modelica`: `ComponentClause(name: compName, typeSpecifier: sourceFile)` |
| `SspConnectorToModelicaConnector` | `Connector(name: connName, type: typeName)`          | `modelica`: `ComponentClause(name: connName, typeSpecifier: typeName)`   |
| `SspConnectionToModelicaConnect`  | `Connection(startElement: fromEl, endElement: toEl)` | `modelica`: `ConnectClause(connector1: fromEl, connector2: toEl)`        |
| `SspSystemToSysmlPackage`         | `System(name: sysName)`                              | `sysml2`: `PackageDefinition(declaredName: sysName)`                     |
| `SspComponentToSysmlPart`         | `Component(name: compName, source: sourceFile)`      | `sysml2`: `PartUsage(declaredName: compName, declaredType: sourceFile)`  |
| `SspConnectorToSysmlPort`         | `Connector(name: connName, type: typeName)`          | `sysml2`: `PortUsage(declaredName: connName, declaredType: typeName)`    |
| `SspConnectionToSysmlConnection`  | `Connection(startElement: fromEl, endElement: toEl)` | `sysml2`: `ConnectionUsage(declaredName: fromEl)`                        |

---

## Scripts

| Command             | Description                                               |
| ------------------- | --------------------------------------------------------- |
| `npm run build`     | Compile TypeScript to `dist/`                             |
| `npm test`          | Run SSD/SSV parser, linter, diagram, and projection tests |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                     |
| `npm run typecheck` | Run `tsc --noEmit` type verification                      |
| `npm run clean`     | Remove `dist/` build artifacts                            |

---

## Programmatic Usage

```typescript
import {
  applySspDiagramEdits,
  applySspTextEdits,
  buildSspDiagramData,
  lintSsd,
  parseSsd,
  sspToModelicaBlock,
} from "@modelscript/ssp";

// 1. Parse and validate SystemStructure.ssd
const system = parseSsd(ssdXml);
const diagnostics = lintSsd(ssdXml);

// 2. Build interactive 2D diagram data and apply bidirectional diagram edits
const diagram = buildSspDiagramData(system);
const textEdits = applySspDiagramEdits(ssdXml, [
  { type: "moveNode", id: "Controller", x: 240, y: 120 },
  { type: "updateParameter", name: "Plant", parameter: "mass", value: 14.5 },
]);
const updatedXml = applySspTextEdits(ssdXml, textEdits);

// 3. Project SSP system architecture to a native Modelica block model
const modelicaCode = sspToModelicaBlock(system);
```
