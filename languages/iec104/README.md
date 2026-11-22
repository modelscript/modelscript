<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/iec104

**Maturity:** Alpha · **Extensions:** `.iec104`, `.104` · **Docs:** [modelscript.org/languages/iec104](https://modelscript.org/languages/iec104)

IEC 60870-5-104 SCADA telecontrol device profile compiler, APCI/ASDU validator, LSP services, and linear-memory `DAEBuilder` lowering for international substation automation and grid digital twins.

## Features

- **IEC 60870-5-104 Profile Parser (`parseIec104`)**: Parses `.iec104` and `.104` SCADA telecontrol profiles including APCI timing parameters (`t0`–`t3`, `k`, `w`), common addresses, and Information Object Addresses (IOAs).
- **APCI/ASDU Static Linter (`lintIec104Profile`)**: Validates protocol timing bounds, duplicate IOAs, ASDU type IDs, and telecontrol configuration rules (`IEC104_1001`–`IEC104_3002`).
- **Linear-Memory DAE Lowering (`lowerIec104ToDae`)**: Lowers SCADA measurement and control points into ModelScript's linear-memory `DAEBuilder` for closed-loop substation digital twin simulation.
- **LSP, TGG & Workspace Indexing (`getIec104Diagnostics`, `indexIec104Document`, `createIec104TggTransformer`)**: Document symbols, diagnostics, workspace indexing, and bidirectional TGG synchronization.

## Package Structure

| File                          | Responsibility                                                            |
| ----------------------------- | ------------------------------------------------------------------------- |
| `src/language.ts`             | `@modelscript/dsl` language registration (`.iec104`, `.104`)              |
| `src/parser/iec104-parser.ts` | `parseIec104` IEC 60870-5-104 telecontrol profile parser                  |
| `src/lints/index.ts`          | `lintIec104Profile` APCI/ASDU static linter (`IEC104_1001`–`IEC104_3002`) |
| `src/dae/iec104-to-dae.ts`    | `lowerIec104ToDae` linear-memory `DAEBuilder` lowering                    |
| `src/tgg/index.ts`            | `createIec104TggTransformer` bidirectional TGG transformer                |
| `src/lsp.ts`                  | `getIec104DocumentSymbols` and `getIec104Diagnostics` LSP services        |
| `src/indexing.ts`             | `indexIec104Document` workspace symbol indexer                            |
| `src/types.ts`                | Core IEC 104 profile and ASDU types                                       |
| `src/index.ts`                | Public package entry point and barrel exports                             |

## Programmatic Usage

```typescript
import { parseIec104, lintIec104Profile, lowerIec104ToDae } from "@modelscript/iec104";

const profile = parseIec104(sourceText);
const diagnostics = lintIec104Profile(profile);
const dae = lowerIec104ToDae(profile);
```

## Scripts

```bash
pnpm --filter @modelscript/iec104 build
pnpm --filter @modelscript/iec104 test
pnpm --filter @modelscript/iec104 lint
pnpm --filter @modelscript/iec104 typecheck
```
