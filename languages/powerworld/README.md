<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/powerworld

**Maturity:** Alpha · **Extensions:** `.aux`, `.cdf` · **Docs:** [modelscript.org/languages/powerworld](https://modelscript.org/languages/powerworld)

PowerWorld Simulator Auxiliary (`.aux`) and IEEE Common Data Format (`.cdf`) transmission power flow, contingency, and script compiler, semantic linter, PSS/E `.raw` projector, clean-room catalog, and linear-memory `DAEBuilder` lowering for ModelScript.

## Features

- **Native WASM GLR Grammar (`@modelscript/dsl`)**: Declarative `.aux` grammar supporting `DATA (ObjectType, [Fields]) { ... }` and `SCRIPT { ... }` blocks.
- **Parser & Typed Network Extraction**: Parses PowerWorld `.aux` and IEEE `.cdf` cases, extracting `Bus`, `Gen`, `Load`, `Branch`, `Shunt`, `Area`, `Zone`, and `Contingency` records with exact source spans.
- **Semantic Linter**: Checks bus uniqueness, unresolved `BusNum` / `BusNumFrom` / `BusNumTo` references, nominal voltage validity, zero-impedance branches, generator MW limits, thermal ratings, and slack bus presence.
- **Linear-Memory DAE Lowering**: Compiles transmission buses, branches, generators, loads, and shunts directly into `DAEBuilder`.
- **PSS/E `.raw` Projection**: Exports PowerWorld `.aux` cases to standard PSS/E v33 `.raw` format (`src/projections/aux-to-psse.ts`).
- **Clean-Room Catalog & FMU Linker**: Built-in PowerWorld equipment schemas, WASM catalog loader, and FMI co-simulation linker (`src/catalog/`).

## Package Structure

| File                                | Responsibility                                                   |
| ----------------------------------- | ---------------------------------------------------------------- |
| `src/language.ts`                   | `@modelscript/dsl` language registration (`.aux`, `.cdf`)        |
| `src/grammar/powerworld-grammar.ts` | Declarative `.aux` grammar for WASM GLR parser generation        |
| `src/parser/powerworld-parser.ts`   | PowerWorld `.aux` `DATA` / `SCRIPT` block parser                 |
| `src/parser/ieee-cdf-parser.ts`     | IEEE Common Data Format (`.cdf`) parser                          |
| `src/lints/index.ts`                | Transmission network semantic linter                             |
| `src/dae/powerworld-to-dae.ts`      | Direct linear-memory `DAEBuilder` lowering                       |
| `src/projections/aux-to-psse.ts`    | PowerWorld `.aux` to PSS/E v33 `.raw` projector                  |
| `src/catalog/index.ts`              | Clean-room standard library schemas, WASM loader, and FMU linker |
| `src/tgg/powerworld-rules.ts`       | Triple Graph Grammar (TGG) bidirectional synchronization rules   |
| `src/lsp.ts`                        | Language Server Protocol symbols, hover, and diagnostics         |
| `src/indexing.ts`                   | Workspace symbol indexer for `.aux` and `.cdf` files             |
| `src/types.ts`                      | Core PowerWorld network and contingency types                    |
| `src/index.ts`                      | Public package entry point and barrel exports                    |

## Scripts

```bash
pnpm --filter @modelscript/powerworld build
pnpm --filter @modelscript/powerworld test
pnpm --filter @modelscript/powerworld lint
pnpm --filter @modelscript/powerworld typecheck
```
