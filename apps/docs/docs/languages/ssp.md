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

## Semantic Linter & Diagnostic Codes

`lintSsd` and `lintSsv` (`languages/ssp/src/linter.ts`) validate structural, causal, and type soundness across `.ssd` and `.ssv` files with 20 diagnostic codes (13 `SSP_*` + 7 `SSV_*`):

### `.ssd` System Structure Diagnostics (`lintSsd`)

<LintRules lang="ssp" />

---

## Command Line Interface (`msx fmu` & `msx cosim`)

ModelScript CLI provides turnkey subcommands for packaging, validating, and co-simulating SSP archives:

```bash
# Validate an FMU or SSP container
msx fmu validate VehicleChassis.fmu

# Simulate an FMU archive directly via SU2, CVODE, or BDF solvers
msx fmu simulate Powertrain.fmu --stop-time=10.0 --step-size=0.001 --format=csv -o output.csv

# Optimize SSP parameter values using differential evolution (CMA-ES, DE, PSO)
msx cosim optimize PlantModel.ssp --params="kp:0.1:10.0,kd:0.01:1.0" --objective="tracking_error"
```

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
