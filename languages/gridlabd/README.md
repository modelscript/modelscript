<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/gridlabd

**Maturity:** Alpha · **Extensions:** `.glm` · **Docs:** [modelscript.org/languages/gridlabd](https://modelscript.org/languages/gridlabd)

GridLAB-D (`.glm`) distribution & DER simulation DSL compiler, semantic linter, OpenDSS projector, LSP services, and linear-memory `DAEBuilder` lowering for ModelScript.

## Features

- **Native WASM GLR Grammar (`@modelscript/dsl`)**: Declarative `.glm` grammar supporting `#set`/`#define`/`#include`, `clock`, `module`, `class`, `schedule`, and nested `object` blocks.
- **Parser & Physical Unit Helpers**: Parses `.glm` models with exact source spans, complex power/impedance values (`a+bj`), and unit conversions (`kV`, `kVA`, `MW`, `ft`, `mile`, `km`).
- **Semantic Linter**: Checks clock/module declarations, duplicate object names, unresolved `from`/`to`/`parent`/`configuration` references, phase compatibility, nominal voltages, and `SWING` bus presence.
- **Linear-Memory DAE Lowering**: Compiles distribution nodes, lines, transformers, switches/fuses/reclosers, loads, and DERs (`solar`, `inverter`, `battery`, `diesel_dg`, `windturb_dg`) directly into `DAEBuilder`.
- **OpenDSS Projection**: Translates `.glm` distribution models to OpenDSS `.dss` circuits (`src/projections/gridlabd-to-opendss.ts`).
- **LSP & Workspace Indexing**: Document symbols, diagnostics, completions, hover, and workspace symbol indexing.

## Package Structure

| File                                     | Responsibility                                                        |
| ---------------------------------------- | --------------------------------------------------------------------- |
| `src/language.ts`                        | `@modelscript/dsl` language registration (`.glm`)                     |
| `src/grammar/gridlabd-grammar.ts`        | Declarative `.glm` grammar for WASM GLR parser generation             |
| `src/parser/gridlabd-parser.ts`          | `.glm` parser with complex impedance and physical unit helpers        |
| `src/lints/index.ts`                     | Distribution & DER semantic linter                                    |
| `src/dae/gridlabd-to-dae.ts`             | Direct linear-memory `DAEBuilder` lowering                            |
| `src/projections/gridlabd-to-opendss.ts` | GridLAB-D to OpenDSS `.dss` projection                                |
| `src/tgg/gridlabd-rules.ts`              | Triple Graph Grammar (TGG) bidirectional synchronization rules        |
| `src/lsp.ts`                             | Language Server Protocol symbols, hover, completions, and diagnostics |
| `src/indexing.ts`                        | Workspace symbol indexer for `.glm` files                             |
| `src/types.ts`                           | Core GridLAB-D AST and distribution component types                   |
| `src/index.ts`                           | Public package entry point and barrel exports                         |

## Scripts

```bash
pnpm --filter @modelscript/gridlabd build
pnpm --filter @modelscript/gridlabd test
pnpm --filter @modelscript/gridlabd lint
pnpm --filter @modelscript/gridlabd typecheck
```
