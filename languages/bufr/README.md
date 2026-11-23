<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/bufr

**Maturity:** Beta · **Extensions:** `.bufr`, `.bfr`, `.bufr.txt` · **Docs:** [modelscript.org/languages/bufr](https://modelscript.org/languages/bufr)

Native **WMO FM 94 BUFR (Binary Universal Form for the Representation of Meteorological Data, 1988)** parser, binary Edition 3/4 bit-stream codec, descriptor tree expander, atmospheric thermodynamic & ISA hypsometric QA solver, linear-memory `DAEBuilder` lowering, meteorological linter (`BUFR1001`–`BUFR5006`), CSV/EPW projections, and interactive SVG/React upper-air sounding & WMO station-plot viewer for ModelScript.

---

## Core Capabilities

- **WASM GLR Parser & Textual BUFR Grammar (`bufrLanguage`, `parseBufrText`)**: Parses structured BUFR messages (`BUFR`, `SECTION 0..5`, `TABLE_B`, `TABLE_D`, `F-X-Y` descriptors such as `0-01-001`, `1-02-003`, `2-01-130`, `3-01-001`, `3-09-052`, `SUBSET`, `7777`, `#` comments).
- **WMO BUFR Edition 3 & 4 Binary Bit-Stream Codec (`encodeBufrBinary`, `decodeBufrBinary`, `BitWriter`, `BitReader`)**: Bit-accurate packing and unpacking of Sections 0, 1, 3, 4, and 5 (`BUFR`..`7777`) with Table B `scale`, `referenceValue`, `bitWidth`, CCITT IA5 strings, missing-value all-1s encoding, delayed replication (`1-XX-000` + `0-31-001`/`0-31-002`), and Table C operators (`2-01-YYY`, `2-02-YYY`).
- **Descriptor Tree Expander & Meteorological QA Solver (`expandBufrDescriptors`, `solveBufrMeteorology`)**: Expands Table D sequences (including radiosonde `3-09-052` and SYNOP `3-07-080`), evaluates Magnus-Tetens saturation vapor pressure, dewpoint, and relative humidity, and verifies International Standard Atmosphere (ISA) pressure-altitude and hypsometric thickness.
- **Direct Continuous DAE Arena Lowering (`lowerBufrToDae`, `bufrToDae`)**: Lowers ideal gas density, potential temperature $\theta = T (P_0 / P)^\kappa$, hydrostatic balance $dP/dt = -\rho g_0 w_{\text{ascent}}$, and wind $(u, v)$ components directly into `@modelscript/runtime`'s `IDaeBuilder`.
- **Meteorological & Structural Linter (`lintBufr`, `BufrErrorCode`)**: 14 diagnostics (`BUFR1001`–`BUFR5006`) covering magic header, missing `7777` sentinel, invalid `F/X/Y` bounds, unknown Table B/D descriptors, subset count mismatches, delayed replication errors, and physical meteorological range violations.
- **Projections (`bufrToCsv`, `bufrToEpw`)**: Exports decoded station summaries or sounding profiles to RFC-4180 CSV and EnergyPlus EPW weather snippets.
- **Interactive Sounding & Station Viewer (`renderBufrSoundingSvg`, `BufrPanel`)**: Pure SVG log-P vertical temperature/dewpoint profile with wind barbs and WMO station-plot model, embedded in a React panel built with `@modelscript/design-tokens/panel`.

---

## Package Structure

| Path                                     | Description                                                                             |
| :--------------------------------------- | :-------------------------------------------------------------------------------------- |
| `src/index.ts`                           | Public package exports                                                                  |
| `src/language.ts`                        | `bufrLanguage` WASM GLR grammar, extensions, and `BufrPanel` UI registration            |
| `src/types.ts`                           | Core WMO BUFR TypeScript interfaces                                                     |
| `src/errors.ts`                          | `BufrErrorCode` (`BUFR1001`–`BUFR5006`)                                                 |
| `src/parser/text-parser.ts`              | `parseBufrText` textual BUFR message parser                                             |
| `src/parser/binary-codec.ts`             | `encodeBufrBinary`, `decodeBufrBinary`, `BitWriter`, `BitReader` (Ed. 3 & 4)            |
| `src/catalog/wmo-tables.ts`              | Built-in WMO Master Table 0 Table B & Table D descriptors                               |
| `src/catalog/bufr-std-schemas.ts`        | Cleanroom `@modelscript/bufr-std-lib` schemas and SVG block icons                       |
| `src/catalog/library-package-adapter.ts` | Zero-I/O `globalLibraryRegistry` registration for `@modelscript/bufr-std-lib`           |
| `src/solver/descriptor-tree.ts`          | `expandBufrDescriptors` Table B/D/C & replication expander                              |
| `src/solver/meteo-qa.ts`                 | Magnus-Tetens thermodynamics, ISA altitude, hypsometric sounding QA                     |
| `src/dae/lowering.ts`                    | `lowerBufrToDae` and `bufrToDae` linear-memory DAE arena lowering                       |
| `src/projections/bufrToCsv.ts`           | `bufrToCsv` RFC-4180 CSV projection                                                     |
| `src/projections/bufrToEpw.ts`           | `bufrToEpw` EnergyPlus EPW weather projection                                           |
| `src/diagram/sounding-diagram.ts`        | `renderBufrSoundingSvg` and `buildBufrSoundingData`                                     |
| `src/ui/BufrPanel.tsx`                   | Interactive React viewer panel (`@modelscript/design-tokens/panel`)                     |
| `src/indexing.ts`                        | `bufrIndexing` UnifiedWorkspace indexer                                                 |
| `src/lsp.ts`                             | `validateBufr`, `getBufrDocumentSymbols`, `getBufrHover`, `getBufrCompletions`          |
| `assets/bufr-std-lib/src/models.ts`      | Cleanroom AssemblyScript meteorological WASM runtime                                    |
| `scripts/build-stdlib.js`                | Cleanroom stdlib builder (`cleanroomSchemasToLibraryPayloads` + `buildCleanroomStdLib`) |
