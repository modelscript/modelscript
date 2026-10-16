# SSP (System Structure and Parameterization)

`@modelscript/ssp` (`languages/ssp`) implements the Modelica Association **SSP 1.0 / 2.0** standard for packaging and coupling Functional Mock-up Units (FMUs) into multi-domain Co-Simulation architectures.

---

## Supported Extensions & Container Architecture

| Extension | Standard Artifact                       | Role                                                                                               |
| :-------- | :-------------------------------------- | :------------------------------------------------------------------------------------------------- |
| `.ssp`    | System Structure Package (ZIP archive)  | Container bundling `SystemStructure.ssd`, `resources/*.fmu`, and `*.ssv` parameter sets            |
| `.ssd`    | System Structure Description (XML)      | Hierarchical `System`, `Components`, `Connectors`, `Connections`, and `DefaultExperiment` topology |
| `.ssv`    | System Structure Parameter Values (XML) | Typed parameter bindings (`Real`, `Integer`, `Boolean`, `String`, `Enumeration`)                   |

### Virtual File System (VFS) Archive Extraction

When a `.ssp` ZIP archive is loaded into the workspace, `sspLanguage.container` (`languages/ssp/src/language.ts`) automatically unpacks and indexes its internal artifacts:

- `*.ssd` and `*.ssv` entries are dispatched via `parse_as_language` into the `@modelscript/ssp` CST & Salsa index.
- `resources/*.fmu` archives are recursively extracted (`extract_nested`) so their internal `modelDescription.xml` ports and parameters are cross-checked against `.ssd` connectors.
- Auxiliary tables and binaries under `resources/*` are mounted into the in-memory VFS (`mount_vfs`).

---

## Interactive 2D Diagram Builder & Bidirectional XML Writeback

`languages/ssp/src/diagram.ts` provides a two-way schematic editor for `.ssd` topologies:

- **2D Schematic Extraction (`buildSspDiagramData`)**: Parses `<ssd:System>`, `<ssd:Component>`, `<ssd:Connector>`, `<ssd:Connection>`, and `<ssd:ElementGeometry>` / `<ssd:ConnectionGeometry>` annotations into positioned block nodes, typed causal ports, and orthogonal routing waypoints.
- **Surgical XML Writeback (`applySspDiagramEdits` / `sspLanguage.writeback`)**: Moving components, adding/removing FMU blocks, drawing `<ssd:Connection>` wires, or editing `<ssv:Parameter>` values updates the underlying `.ssd` or `.ssv` XML document in place while preserving namespace prefixes and custom vendor annotations.

---

## Modelica Architecture Projection (`sspToModelicaBlock`)

`sspToModelicaBlock(ssdDoc)` (`languages/ssp/src/index.ts`) projects any `.ssd` system topology into an equivalent composite Modelica `model`, translating `<ssd:Connector>` definitions into `Modelica.Blocks.Interfaces.RealInput` / `RealOutput` (or `Integer`/`Boolean` causal interfaces), `<ssd:Component>` blocks into typed sub-models with `<ssv:Parameter>` modifications, and `<ssd:Connection>` edges into `connect(...)` equations.

---

## Semantic Linter & 20 Diagnostic Codes

`lintSsd` and `lintSsv` (`languages/ssp/src/linter.ts`) validate structural, causal, and type soundness across `.ssd` and `.ssv` files with 20 diagnostic codes (13 `SSP_*` + 7 `SSV_*`):

### `.ssd` System Structure Diagnostics (`lintSsd`)

| Code                               | Severity  | Condition Checked                                                                                                       |
| :--------------------------------- | :-------- | :---------------------------------------------------------------------------------------------------------------------- |
| `SSP_EMPTY_CONNECTOR_NAME`         | `error`   | A `<Connector>` on a system or component has an empty `name` attribute                                                  |
| `SSP_DUPLICATE_CONNECTOR`          | `error`   | Duplicate connector `name` declared on the same system or component                                                     |
| `SSP_INVALID_CONNECTOR_KIND`       | `error`   | Connector `kind` is not one of `input`, `output`, `parameter`, `calculatedParameter`, `local`, `inout`                  |
| `SSP_EMPTY_COMPONENT_NAME`         | `error`   | A `<Component>` element has an empty `name` attribute                                                                   |
| `SSP_DUPLICATE_COMPONENT`          | `error`   | Two `<Component>` elements in the same `<System>` share the same `name`                                                 |
| `SSP_MISSING_COMPONENT_SOURCE`     | `warning` | A `<Component>` has an empty `source` URI (no FMU or nested `.ssp` referenced)                                          |
| `SSP_UNRESOLVED_ELEMENT`           | `error`   | A `<Connection>` references a `startElement` or `endElement` component that does not exist                              |
| `SSP_UNRESOLVED_CONNECTOR`         | `error`   | A `<Connection>` references a `startConnector` or `endConnector` that does not exist on the target element              |
| `SSP_SELF_CONNECTION`              | `error`   | A `<Connection>` connects an element's connector back to the exact same element and connector                           |
| `SSP_CONNECTOR_TYPE_MISMATCH`      | `error`   | Connected `startConnector` and `endConnector` have incompatible data types (e.g., `Real` connected to `Boolean`)        |
| `SSP_CONNECTOR_CAUSALITY_CONFLICT` | `warning` | Invalid causal connection (e.g., component `output` to component `output`, or `input` to `input`)                       |
| `SSP_UNRESOLVED_BINDING_PREFIX`    | `warning` | `<Parameter>` `name="prefix.param"` in an inline `<ParameterValues>` block references a non-existent component `prefix` |
| `SSP_INVALID_EXPERIMENT_BOUNDS`    | `error`   | `<DefaultExperiment>` has `stopTime <= startTime`                                                                       |

### `.ssv` Parameter Value Diagnostics (`lintSsv`)

| Code                          | Severity  | Condition Checked                                                                                                       |
| :---------------------------- | :-------- | :---------------------------------------------------------------------------------------------------------------------- |
| `SSV_EMPTY_PARAMETER_NAME`    | `error`   | A `<ssv:Parameter>` element has an empty `name` attribute                                                               |
| `SSV_DUPLICATE_PARAMETER`     | `warning` | The same parameter `name` is defined more than once in the `<ssv:Parameters>` set                                       |
| `SSV_MISSING_PARAMETER_TYPE`  | `error`   | A `<ssv:Parameter>` is missing its child type element (`<Real>`, `<Integer>`, `<Boolean>`, `<String>`, `<Enumeration>`) |
| `SSV_MISSING_PARAMETER_VALUE` | `error`   | The typed child element of `<ssv:Parameter>` is missing its `value` attribute                                           |
| `SSV_INVALID_REAL_VALUE`      | `error`   | `<ssv:Real value="..."/>` is not a valid finite floating-point number                                                   |
| `SSV_INVALID_INTEGER_VALUE`   | `error`   | `<ssv:Integer value="..."/>` is not a valid base-10 integer                                                             |
| `SSV_INVALID_BOOLEAN_VALUE`   | `error`   | `<ssv:Boolean value="..."/>` is not `"true"`, `"false"`, `"1"`, or `"0"`                                                |

---

## Polyglot TGG Rules

`@modelscript/ssp` registers 8 bidirectional Triple Graph Grammar (TGG) rules in `languages/ssp/src/language.ts`:

| Rule Name                         | Source (`ssp`)  | Target Language | Target Construct                               |
| :-------------------------------- | :-------------- | :-------------- | :--------------------------------------------- |
| `SspSystemToModelicaModel`        | `SsdSystem`     | `modelica`      | `ClassDefinition` (`model`)                    |
| `SspComponentToModelicaComponent` | `SsdComponent`  | `modelica`      | `ComponentClause`                              |
| `SspConnectorToModelicaConnector` | `SsdConnector`  | `modelica`      | `ComponentClause` (`RealInput` / `RealOutput`) |
| `SspConnectionToModelicaConnect`  | `SsdConnection` | `modelica`      | `ConnectClause`                                |
| `SspSystemToSysmlPackage`         | `SsdSystem`     | `sysml2`        | `PartDef`                                      |
| `SspComponentToSysmlPart`         | `SsdComponent`  | `sysml2`        | `PartUsage`                                    |
| `SspConnectorToSysmlPort`         | `SsdConnector`  | `sysml2`        | `PortUsage`                                    |
| `SspConnectionToSysmlConnection`  | `SsdConnection` | `sysml2`        | `ConnectionUsage`                              |
