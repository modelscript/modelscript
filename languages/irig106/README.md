<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/irig106

**Maturity:** Beta · **Extensions:** `.tmats`, `.tmt`, `.tma` · **Docs:** [modelscript.org/languages/irig106](https://modelscript.org/languages/irig106)

Native **IRIG 106 Chapter 9 TMATS (Telemetry Attributes Transfer Standard)** compiler, PCM major/minor frame commutator solver, polynomial engineering-unit calibration engine, DAE lowering pipeline, CCSDS XTCE / CSV projections, and interactive React + SVG commutator viewer/editor for ModelScript.

---

## Core Capabilities

- **WASM GLR Parser & TMATS Parser (`irig106Language`, `parseIrig106`, `serializeIrig106`)**: Parses IRIG 106 Chapter 9 `CODE:VALUE;` attributes across all core groups (`G\` General, `T-x\` Transmission, `M-x\` Multiplex/Modulation, `P-x\` PCM Format, `D-x\` PCM Measurement Description, `C-x\` Data Conversion, `COMMENT`).
- **PCM Frame Commutator Solver (`buildCommutatorGrid`, `evaluatePolynomialCalibration`, `evaluateConversion`, `decodeBinaryWord`)**:
  - Exact minor/major frame bit-rate, frame-rate, and word-rate computation
  - Supercommutated (`WP`, `WI`) and subcommutated (`FP`, `FI`) 2D major/minor frame slot grid scheduling
  - Per-parameter sample rate ($f_s$) and Nyquist bandwidth ($f_s / 2$) calculation
  - Horner-form polynomial engineering-unit calibration $y = \sum_{k=0}^{n} c_k x^k$, pair-set interpolation (`PRS`), and derived equations (`DER`).
- **Direct Continuous DAE Arena Lowering (`lowerIrig106ToDae`, `irig106ToDae`)**: Lowers PCM frame timing parameters, per-channel calibration equations, and Nyquist bandwidth relations directly into `@modelscript/runtime`'s `DAEBuilder` linear memory arena.
- **TMATS Linter (`lintIrig106`, `Irig106ErrorCode`)**: Comprehensive diagnostics (`IRIG1001`–`IRIG5006`) covering missing `;` terminators, duplicate attribute codes, out-of-bounds word positions, overlapping PCM word/bit allocations, undefined `C-x` conversion references, bit-rate / minor-frame-rate mismatches, missing sync patterns (`MF4`), and invalid word lengths (`F1`).
- **Cleanroom Standard Library (`@modelscript/irig106-std-lib`)**: Declarative schemas for TMATS groups (`G`, `T`, `M`, `P`, `D`, `C`) and IRIG-106 standard optimal frame sync patterns (16-bit `EB90`, 24-bit `FAF320`, 32-bit `FE6B2840`) with an AssemblyScript WASM runtime.
- **Projections (`irig106ToXtce`, `irig106ToCsv`)**: Exports TMATS telemetry definitions to CCSDS 660.1-G-1 XTCE XML and tabular CSV commutator schedules.
- **Interactive Visualization & LSP (`renderIrig106CommutatorSvg`, `Irig106Panel`, `validateIrig106`, `getIrig106DocumentSymbols`, `getIrig106Hover`, `getIrig106Completions`)**: Pure SVG PCM major/minor frame commutator visualizer and React panel built on `@modelscript/design-tokens/panel`.

---

## Package Structure

| Path                                 | Description                                                                                                               |
| :----------------------------------- | :------------------------------------------------------------------------------------------------------------------------ |
| `src/index.ts`                       | Public package exports                                                                                                    |
| `src/language.ts`                    | `irig106Language` WASM GLR grammar & UI panel registration (`.tmats`, `.tmt`, `.tma`)                                     |
| `src/types.ts`                       | TMATS Chapter 9 domain model interfaces (`TmatsModel`, `TmatsPcmFormatGroup`, `TmatsMeasurement`, `TmatsConversionGroup`) |
| `src/errors.ts`                      | `Irig106ErrorCode` (`IRIG1001`–`IRIG5006`) diagnostic definitions                                                         |
| `src/parser/tmats-parser.ts`         | `parseIrig106` and `serializeIrig106` Chapter 9 attribute parser/serializer                                               |
| `src/lints/index.ts`                 | `lintIrig106` static semantic & frame-integrity validator                                                                 |
| `src/solver/commutator.ts`           | PCM major/minor frame commutator grid builder, sample-rate/bandwidth solver, polynomial EU calibration                    |
| `src/dae/lowering.ts`                | `lowerIrig106ToDae` linear-memory `DAEBuilder` lowering                                                                   |
| `src/projections/irig106ToXtce.ts`   | CCSDS XTCE XML projection                                                                                                 |
| `src/projections/irig106ToCsv.ts`    | CSV commutator & calibration table projection                                                                             |
| `src/catalog/irig106-std-schemas.ts` | Cleanroom TMATS group & IRIG-106 standard sync word schemas                                                               |
| `src/diagram/commutator-svg.ts`      | `renderIrig106CommutatorSvg` pure SVG PCM commutator visualizer                                                           |
| `src/ui/Irig106Panel.tsx`            | Interactive React viewer/editor panel (`@modelscript/design-tokens/panel`)                                                |
| `src/indexing.ts`                    | `irig106Indexing` UnifiedWorkspace symbol indexing                                                                        |
| `src/lsp.ts`                         | LSP validation, document symbols, hover, and completions                                                                  |

---

## Lint Rules (`IRIG1001`–`IRIG5006`)

| Code       | Rule                              | Severity  | Description                                                                                             |
| :--------- | :-------------------------------- | :-------- | :------------------------------------------------------------------------------------------------------ |
| `IRIG1001` | `syntax-error`                    | `error`   | Syntax error or missing `;` terminator on a TMATS attribute line.                                       |
| `IRIG2001` | `duplicate-attribute-code`        | `error`   | Duplicate TMATS attribute code declared multiple times in the file.                                     |
| `IRIG3001` | `word-position-out-of-bounds`     | `error`   | PCM measurement word position (`WP`) is outside minor frame bounds `[1, MF1]`.                          |
| `IRIG3002` | `overlapping-pcm-allocation`      | `error`   | Two PCM measurements overlap in the same minor frame, word position, and bit range.                     |
| `IRIG4001` | `undefined-conversion-ref`        | `error`   | `D-x` measurement references an undefined `C-x` data conversion (`DCN`).                                |
| `IRIG5001` | `bit-rate-frame-mismatch`         | `error`   | PCM bit rate (`D1`), minor frame bits (`MF2`), or word budget (`MF1 * F1 + syncBits`) are inconsistent. |
| `IRIG5002` | `missing-sync-pattern`            | `error`   | PCM format group is missing minor frame synchronization pattern (`P-x\MF4`).                            |
| `IRIG5003` | `invalid-word-length`             | `error`   | PCM common word length (`P-x\F1`) is outside the valid IRIG 106 range (`4`–`64` bits).                  |
| `IRIG5004` | `invalid-frame-position`          | `error`   | Measurement subcommutation frame position (`FP`) exceeds major frame depth (`MF\N`).                    |
| `IRIG5005` | `missing-polynomial-coefficients` | `warning` | `C-x` conversion of type `COE` has no polynomial coefficients (`CO-n`) defined.                         |
| `IRIG5006` | `sync-pattern-length-mismatch`    | `warning` | Sync pattern bit length does not match standard IRIG-106 widths or minor frame sync bit budget.         |

---

## Programmatic Usage

```typescript
import {
  parseIrig106,
  lintIrig106,
  buildCommutatorGrid,
  evaluatePolynomialCalibration,
  irig106ToDae,
  irig106ToXtce,
  renderIrig106CommutatorSvg,
} from "@modelscript/irig106";

const tmats = `
G\\PN:FLIGHT_TEST_01;
P-1\\DLN:PCM_LINK_1;
P-1\\D1:128000;
P-1\\F1:16;
P-1\\MF\\N:4;
P-1\\MF1:6;
P-1\\MF2:128;
P-1\\MF4:FE6B2840;
D-1\\DLN:PCM_LINK_1;
D-1\\MN-1-1:PITCH_RATE;
D-1\\WP-1-1:1;
D-1\\WI-1-1:2;
C-1\\DCN:PITCH_RATE;
C-1\\MN3:DEG/S;
C-1\\DCT:COE;
C-1\\CO-0:-100.0;
C-1\\CO-1:0.0030517578125;
`;

const model = parseIrig106(tmats);
const diagnostics = lintIrig106(model);
const grid = buildCommutatorGrid(model);
const dae = irig106ToDae(model);
const xtceXml = irig106ToXtce(model);
const svg = renderIrig106CommutatorSvg(model);
```
