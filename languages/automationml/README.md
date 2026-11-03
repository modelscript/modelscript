<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/automationml

IEC 62714 AutomationML (CAEX 2.15 / 3.0) mechatronic plant engineering and virtual commissioning language package for ModelScript.

---

## Core Capabilities

- **CAEX 2.15 / 3.0 Parser**: High-performance XML parser supporting CAEX `InstanceHierarchy`, `InternalElement`, `SystemUnitClassLib`, `InterfaceClassLib`, and `RoleClassLib`.
- **Mechatronic Virtual Commissioning**: Bidirectional mapping between AutomationML topologies and multi-body DAE / PLCopen control loops.
- **Co-Simulation Bridge**: Co-simulation orchestration bridging AutomationML plant layouts with FMI/SSP containers.
- **Static Semantic Linter**: Pre-flight validation for orphan references, unbound interface connectors, circular role hierarchies, and duplicate element GUIDs.
- **LSP Integration**: Language Server Protocol support with diagnostics, definitions, hover documentation, and structural navigation.

---

## Package Structure

| Path                     | Description                                                       |
| ------------------------ | ----------------------------------------------------------------- |
| `src/index.ts`           | Primary package entry point and public API re-exports             |
| `src/language.ts`        | AutomationML grammar definition and polyglot language integration |
| `src/parser/`            | CAEX XML parser and AST deserializer                              |
| `src/lints/`             | Semantic rules and structural topology linters                    |
| `src/cosim/`             | Co-simulation topology bridge and FMI orchestration               |
| `src/projections/`       | Projections to Modelica, PLCopen, and SSP                         |
| `src/workspace-index.ts` | Multi-file CAEX class library indexing and resolution             |
| `src/lsp.ts`             | Language Server Protocol document symbol and diagnostics provider |
