<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/rtds

**Maturity:** Alpha · **Extensions:** `.dft`, `.rtds` · **Docs:** [modelscript.org/languages/rtds](https://modelscript.org/languages/rtds)

RTDS RSCAD Draft (`.dft`, `.rtds`) real-time digital simulator & Hardware-in-the-Loop (HIL) netlist compiler, EMT time-step validator, ATP-EMTP projector, clean-room EMT catalog, LSP services, and linear-memory `DAEBuilder` lowering for ModelScript.

## Features

- **RSCAD Draft Netlist Parser (`parseRtdsDraft`)**: Parses `.dft` and `.rtds` real-time EMT draft circuits including rack/subsystem assignments, small-time-step VSC bridges, transmission lines, transformers, sources, and control blocks.
- **Real-Time EMT Static Linter (`lintRtdsDraft`)**: Validates EMT time-step constraints, rack/subsystem partitioning, Bergeron line travel times, and component connectivity (`RTDS1001`–`RTDS4001`).
- **ATP-EMTP Projection (`projectRtdsToAtp`)**: Translates RSCAD Draft circuits into ATP-EMTP `.atp` cards.
- **Linear-Memory DAE Lowering (`lowerRtdsToDae`)**: Compiles EMT subsystems and catalog parameter defaults directly into ModelScript's linear-memory `DAEBuilder`.
- **Clean-Room EMT Catalog & FMU Linker (`src/catalog/`)**: Built-in RTDS block schemas, SVG icons, WASM catalog loader, and CBuilder/FMI co-simulation linker.
- **LSP, TGG & Workspace Indexing (`getRtdsDiagnostics`, `indexRtdsDocument`, `createRtdsTggTransformer`)**: Document symbols, diagnostics, workspace indexing, and bidirectional TGG rules.

## Package Structure

| File                             | Responsibility                                                      |
| -------------------------------- | ------------------------------------------------------------------- |
| `src/language.ts`                | `@modelscript/dsl` language registration (`.dft`, `.rtds`)          |
| `src/parser/rtds-parser.ts`      | `parseRtdsDraft` RSCAD Draft netlist parser                         |
| `src/lints/index.ts`             | `lintRtdsDraft` real-time EMT static linter (`RTDS1001`–`RTDS4001`) |
| `src/projections/rtds-to-atp.ts` | `projectRtdsToAtp` ATP-EMTP `.atp` projector                        |
| `src/dae/rtds-to-dae.ts`         | `lowerRtdsToDae` linear-memory `DAEBuilder` lowering                |
| `src/catalog/index.ts`           | Clean-room EMT library, WASM loader, and FMU/CBuilder linker        |
| `src/tgg/index.ts`               | `createRtdsTggTransformer` bidirectional TGG transformer            |
| `src/lsp.ts`                     | `getRtdsDocumentSymbols` and `getRtdsDiagnostics` LSP services      |
| `src/indexing.ts`                | `indexRtdsDocument` workspace symbol indexer                        |
| `src/types.ts`                   | Core RTDS draft and subsystem types                                 |
| `src/index.ts`                   | Public package entry point and barrel exports                       |

## Programmatic Usage

```typescript
import { parseRtdsDraft, lintRtdsDraft, projectRtdsToAtp, lowerRtdsToDae } from "@modelscript/rtds";

const draft = parseRtdsDraft(sourceText);
const diagnostics = lintRtdsDraft(draft);
const atpDeck = projectRtdsToAtp(draft);
const dae = lowerRtdsToDae(draft);
```

## Scripts

```bash
pnpm --filter @modelscript/rtds build
pnpm --filter @modelscript/rtds test
pnpm --filter @modelscript/rtds lint
pnpm --filter @modelscript/rtds typecheck
```
