<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/c37118

**Maturity:** Alpha · **Extensions:** `.c37118`, `.pmu` · **Docs:** [modelscript.org/languages/c37118](https://modelscript.org/languages/c37118)

IEEE C37.118.2 synchrophasor (PMU / PDC) configuration and phasor data compiler, WAMPAC validator, LSP services, and linear-memory `DAEBuilder` lowering for ModelScript.

## Features

- **Synchrophasor Configuration & Frame Parser (`parseC37118`)**: Parses IEEE C37.118.2 PMU/PDC configuration and phasor stream definitions (`.c37118`, `.pmu`) into typed stations, phasor channels, analog/digital channels, and nominal reporting rates.
- **WAMPAC Static Linter (`lintC37118Config`)**: Validates PMU/PDC configuration integrity (`C37_1001`–`C37_3002`), station IDs, nominal frequency and frame-rate compatibility, and channel definitions.
- **Linear-Memory DAE Lowering (`lowerC37118ToDae`)**: Lowers synchrophasor telemetry channels and wide-area monitoring signals directly into ModelScript's linear-memory `DAEBuilder`.
- **TGG Bidirectional Sync & LSP (`createC37118TggTransformer`, `getC37118DocumentSymbols`, `getC37118Diagnostics`)**: Document symbols, real-time diagnostics, workspace symbol indexing (`indexC37118Document`), and cross-domain TGG rules.

## Package Structure

| File                          | Responsibility                                                     |
| ----------------------------- | ------------------------------------------------------------------ |
| `src/language.ts`             | `@modelscript/dsl` language registration (`.c37118`, `.pmu`)       |
| `src/parser/c37118-parser.ts` | `parseC37118` IEEE C37.118.2 PMU/PDC configuration parser          |
| `src/lints/index.ts`          | `lintC37118Config` WAMPAC static linter (`C37_1001`–`C37_3002`)    |
| `src/dae/c37118-to-dae.ts`    | `lowerC37118ToDae` linear-memory `DAEBuilder` lowering             |
| `src/tgg/index.ts`            | `createC37118TggTransformer` bidirectional TGG transformer         |
| `src/lsp.ts`                  | `getC37118DocumentSymbols` and `getC37118Diagnostics` LSP services |
| `src/indexing.ts`             | `indexC37118Document` workspace symbol indexer                     |
| `src/types.ts`                | Core synchrophasor AST and configuration types                     |
| `src/index.ts`                | Public package entry point and barrel exports                      |

## Programmatic Usage

```typescript
import { parseC37118, lintC37118Config, lowerC37118ToDae } from "@modelscript/c37118";

const config = parseC37118(sourceText);
const diagnostics = lintC37118Config(config);
const dae = lowerC37118ToDae(config);
```

## Scripts

```bash
pnpm --filter @modelscript/c37118 build
pnpm --filter @modelscript/c37118 test
pnpm --filter @modelscript/c37118 lint
pnpm --filter @modelscript/c37118 typecheck
```
