# @modelscript/autosar

Native AUTOSAR Classic (R4.0–R22-11) and Adaptive ARXML parser, pre-flight automotive linter (M7401–M7410), virtual RTE execution scheduler, and direct WebAssembly DAE arena lowering for ModelScript.

## Capabilities

- **Zero-Regex Streaming XML Parser**: High-performance XML parser (`@modelscript/dsl/xml`) handling SWC types, port prototypes, sender-receiver & client-server interfaces, internal behaviors, runnable entities, timing/data events, connectors, PDUs, and CAN/LIN frames.
- **Pre-Flight Automotive Linter**: Diagnoses unconnected R-ports (`M7401`), interface signature mismatches (`M7402`), data element type mismatches (`M7403`), duplicate short-names (`M7404`), WCET budget overflows (`M7405`), overlapping PDU bit allocations (`M7406`), PDU frame length overflows (`M7407`), cyclic runnable dependencies (`M7408`), missing internal behaviors (`M7409`), and untriggered runnables (`M7410`).
- **Virtual RTE Simulation**: Cycle-accurate discrete execution engine supporting periodic timing events, data-received events, and implicit/explicit communication buffering.
- **Direct DAE Arena Lowering**: Direct lowering of SWC control algorithms into WebAssembly `DAEBuilder` linear memory, coupled with 1D vehicle plant models.
- **Projections**: Export to Modelica blocks (`Modelica.Blocks`) and SysML v2 `part def` architectures.
- **Workspace Index**: Multi-file indexer implementing `IWorkspaceIndex` for enterprise distributed ARXML workspaces.
- **LSP Services**: Document symbols, hover tips, validation diagnostics, and refactoring actions.
