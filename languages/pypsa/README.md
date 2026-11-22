<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/pypsa

**Maturity:** Alpha · **Extensions:** `.pypsa`, `.pypsa.json` · **Docs:** [modelscript.org/languages/pypsa](https://modelscript.org/languages/pypsa)

PyPSA / GenX capacity expansion, sector-coupled energy system, and nodal DC-OPF network compiler, semantic linter, AMPL optimizer projector, diagram builder, LSP services, and linear-memory `DAEBuilder` lowering for ModelScript.

## Features

- **PyPSA Network Parser (`parsePypsa`)**: Parses `.pypsa` and `.pypsa.json` energy system models including buses, generators, lines, links, loads, stores, storage units, and snapshots.
- **Energy System Static Linter (`lintPypsaNetwork`)**: Validates bus references, carrier definitions, thermal/capacity limits, and network connectivity (`PYPSA1001`–`PYPSA3004`).
- **AMPL Optimization Projection (`projectPypsaToAmpl`)**: Projects nodal DC-OPF and capacity expansion networks into `@modelscript/ampl` `.mod`/`.dat` optimization problems.
- **Linear-Memory DAE Lowering & Diagram Input (`lowerPypsaToDae`, `buildPypsaDiagramInput`)**: Compiles network power-balance equations into `DAEBuilder` and generates interactive schematic diagram inputs.
- **LSP, TGG & Workspace Indexing (`getPypsaDiagnostics`, `indexPypsaDocument`, `createPypsaTggTransformer`)**: Document symbols, diagnostics, workspace indexing, and bidirectional TGG rules.

## Package Structure

| File                               | Responsibility                                                        |
| ---------------------------------- | --------------------------------------------------------------------- |
| `src/language.ts`                  | `@modelscript/dsl` language registration (`.pypsa`, `.pypsa.json`)    |
| `src/parser/pypsa-parser.ts`       | `parsePypsa` PyPSA network and snapshot parser                        |
| `src/lints/index.ts`               | `lintPypsaNetwork` static linter (`PYPSA1001`–`PYPSA3004`)            |
| `src/projections/pypsa-to-ampl.ts` | `projectPypsaToAmpl` nodal DC-OPF / capacity expansion AMPL projector |
| `src/dae/pypsa-to-dae.ts`          | `lowerPypsaToDae` linear-memory `DAEBuilder` lowering                 |
| `src/tgg/index.ts`                 | `createPypsaTggTransformer` bidirectional TGG transformer             |
| `src/lsp.ts`                       | `getPypsaDocumentSymbols` and `getPypsaDiagnostics` LSP services      |
| `src/indexing.ts`                  | `indexPypsaDocument` workspace symbol indexer                         |
| `src/types.ts`                     | Core PyPSA network component types                                    |
| `src/index.ts`                     | Public entry point, barrel exports, and `buildPypsaDiagramInput`      |

## Programmatic Usage

```typescript
import { parsePypsa, lintPypsaNetwork, projectPypsaToAmpl, lowerPypsaToDae } from "@modelscript/pypsa";

const network = parsePypsa(sourceText);
const diagnostics = lintPypsaNetwork(network);
const amplModel = projectPypsaToAmpl(network);
const dae = lowerPypsaToDae(network);
```

## Scripts

```bash
pnpm --filter @modelscript/pypsa build
pnpm --filter @modelscript/pypsa test
pnpm --filter @modelscript/pypsa lint
pnpm --filter @modelscript/pypsa typecheck
```
