<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/plscadd

**Maturity:** Alpha · **Extensions:** `.pol`, `.loa`, `.plscadd` · **Docs:** [modelscript.org/languages/plscadd](https://modelscript.org/languages/plscadd)

Bentley PLS-CADD (`.pol`, `.loa`, `.plscadd`) overhead transmission line mechanical sag-tension, ground clearance, and electrical `R/X` impedance compiler, semantic linter, clean-room structure/conductor catalog, LSP services, and linear-memory `DAEBuilder` lowering for ModelScript.

## Features

- **PLS-CADD Line & Structure Parser (`parsePlsCadd`)**: Parses `.pol`, `.loa`, and `.plscadd` transmission line files, computing span lengths (`computeSpanLengthM`), parabolic sag (`computeParabolicSagM`), and electrical span impedances (`computeSpanImpedanceOhms`).
- **Mechanical & Clearance Static Linter (`lintPlsCadd`)**: Validates structure geometry, conductor tension limits, ground clearance margins, and load cases (`PLSCADD1001`–`PLSCADD4002`).
- **Linear-Memory DAE Lowering (`lowerPlsCaddToDae`)**: Lowers overhead line electrical `R/X` parameters and coupled thermal-mechanical sag dynamics directly into `DAEBuilder`.
- **Clean-Room Catalog & FMU Linker (`src/catalog/`)**: Built-in transmission conductor/structure schemas, SVG diagrams, WASM catalog loader, and FMI co-simulation linker.
- **LSP, TGG & Workspace Indexing (`getPlsCaddDiagnostics`, `indexPlsCaddDocument`, `createPlsCaddTggTransformer`)**: Document symbols, diagnostics, workspace indexing, and bidirectional TGG rules.

## Package Structure

| File                           | Responsibility                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------- |
| `src/language.ts`              | `@modelscript/dsl` language registration (`.pol`, `.loa`, `.plscadd`)              |
| `src/parser/plscadd-parser.ts` | `parsePlsCadd` parser and sag-tension / span impedance helpers                     |
| `src/lints/index.ts`           | `lintPlsCadd` mechanical and clearance static linter (`PLSCADD1001`–`PLSCADD4002`) |
| `src/dae/plscadd-to-dae.ts`    | `lowerPlsCaddToDae` linear-memory `DAEBuilder` lowering                            |
| `src/catalog/index.ts`         | Clean-room conductor/structure catalog, WASM loader, and FMU linker                |
| `src/tgg/index.ts`             | `createPlsCaddTggTransformer` bidirectional TGG transformer                        |
| `src/lsp.ts`                   | `getPlsCaddDocumentSymbols` and `getPlsCaddDiagnostics` LSP services               |
| `src/indexing.ts`              | `indexPlsCaddDocument` workspace symbol indexer                                    |
| `src/types.ts`                 | Core PLS-CADD structure, span, and load-case types                                 |
| `src/index.ts`                 | Public package entry point and barrel exports                                      |

## Programmatic Usage

```typescript
import { parsePlsCadd, lintPlsCadd, lowerPlsCaddToDae } from "@modelscript/plscadd";

const model = parsePlsCadd(sourceText);
const diagnostics = lintPlsCadd(model);
const dae = lowerPlsCaddToDae(model);
```

## Scripts

```bash
pnpm --filter @modelscript/plscadd build
pnpm --filter @modelscript/plscadd test
pnpm --filter @modelscript/plscadd lint
pnpm --filter @modelscript/plscadd typecheck
```
