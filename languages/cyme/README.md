<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/cyme

**Maturity:** Alpha · **Extensions:** `.sxst`, `.cyme` · **Docs:** [modelscript.org/languages/cyme](https://modelscript.org/languages/cyme)

Eaton CYME (`CYMDIST` `.sxst` XML & `.cyme` ASCII) distribution feeder compiler, semantic linter, OpenDSS `.dss` projector, clean-room equipment catalog, LSP services, and linear-memory `DAEBuilder` lowering for ModelScript.

## Features

- **CYME Feeder Parser (`parseCyme`)**: Parses `.sxst` XML and `.cyme` ASCII distribution feeder models including nodes, sections, overhead/underground conductors, transformers, regulators, shunts, and distributed energy resources.
- **Distribution Semantic Linter (`lintCymeNetwork`)**: Pre-flight distribution feeder validation (`CYME1001`–`CYME4001`) checking topology connectivity, impedance bounds, phasing, and source definitions.
- **Linear-Memory DAE Lowering (`lowerCymeToDae`)**: Lowers distribution feeders and clean-room catalog schema defaults directly into ModelScript's linear-memory `DAEBuilder`.
- **OpenDSS Projection (`projectCymeToOpenDss`)**: Translates CYME distribution feeders into OpenDSS `.dss` circuits.
- **Clean-Room Standard Library & FMU Linker (`src/catalog/`)**: Built-in CYME equipment schemas, SVG block symbols, WASM catalog loader, and FMI co-simulation linker.
- **LSP, TGG & Workspace Indexing (`getCymeDiagnostics`, `indexCymeDocument`, `createCymeTggTransformer`)**: Document symbols, diagnostics, workspace indexing, and cross-domain TGG rules.

## Package Structure

| File                                 | Responsibility                                                              |
| ------------------------------------ | --------------------------------------------------------------------------- |
| `src/language.ts`                    | `@modelscript/dsl` language registration (`.sxst`, `.cyme`)                 |
| `src/parser/cyme-parser.ts`          | `parseCyme` CYMDIST `.sxst` XML and `.cyme` ASCII parser                    |
| `src/lints/index.ts`                 | `lintCymeNetwork` distribution feeder static linter (`CYME1001`–`CYME4001`) |
| `src/dae/cyme-to-dae.ts`             | `lowerCymeToDae` linear-memory `DAEBuilder` lowering                        |
| `src/projections/cyme-to-opendss.ts` | `projectCymeToOpenDss` OpenDSS `.dss` feeder projector                      |
| `src/catalog/index.ts`               | Clean-room CYME equipment library, WASM loader, and FMU linker              |
| `src/tgg/index.ts`                   | `createCymeTggTransformer` bidirectional TGG transformer                    |
| `src/lsp.ts`                         | `getCymeDocumentSymbols` and `getCymeDiagnostics` LSP services              |
| `src/indexing.ts`                    | `indexCymeDocument` workspace symbol indexer                                |
| `src/types.ts`                       | Core CYME feeder network types                                              |
| `src/index.ts`                       | Public package entry point and barrel exports                               |

## Programmatic Usage

```typescript
import { parseCyme, lintCymeNetwork, projectCymeToOpenDss, lowerCymeToDae } from "@modelscript/cyme";

const network = parseCyme(sxstSource);
const diagnostics = lintCymeNetwork(network);
const dssScript = projectCymeToOpenDss(network);
const dae = lowerCymeToDae(network);
```

## Scripts

```bash
pnpm --filter @modelscript/cyme build
pnpm --filter @modelscript/cyme test
pnpm --filter @modelscript/cyme lint
pnpm --filter @modelscript/cyme typecheck
```
