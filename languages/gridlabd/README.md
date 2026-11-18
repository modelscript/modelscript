<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/gridlabd

GridLAB-D (`.glm`) distribution & DER simulation DSL compiler, semantic linter, LSP services, and linear-memory `DAEBuilder` lowering for ModelScript.

## Features

- **Native WASM GLR Grammar (`@modelscript/dsl`)**: Declarative `.glm` grammar supporting `#set`/`#define`/`#include`, `clock`, `module`, `class`, `schedule`, and nested `object` blocks.
- **Parser & Physical Unit Helpers**: Parses `.glm` models with exact source spans, complex power/impedance values (`a+bj`), and unit conversions (`kV`, `kVA`, `MW`, `ft`, `mile`, `km`).
- **Semantic Linter**: Checks clock/module declarations, duplicate object names, unresolved `from`/`to`/`parent`/`configuration` references, phase compatibility, nominal voltages, and `SWING` bus presence.
- **Linear-Memory DAE Lowering**: Compiles distribution nodes, lines, transformers, switches/fuses/reclosers, loads, and DERs (`solar`, `inverter`, `battery`, `diesel_dg`, `windturb_dg`) directly into `DAEBuilder`.
- **LSP & Workspace Indexing**: Document symbols, diagnostics, completions, hover, and `WorkspaceIndex` integration.

## Usage

```bash
npm run build --workspace=@modelscript/gridlabd
npm test --workspace=@modelscript/gridlabd
```
