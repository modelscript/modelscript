---
title: "NASA CDF (.skt)"
description: "Space-physics binary/skeleton telemetry, ISTP EPOCH & strip-chart viewer"
---

# NASA CDF (`.skt`)

**Package:** `@modelscript/nasa-cdf` · **Maturity:** `Beta` · **Extensions:** `.skt`

**Maturity:** Beta · **Extensions:** `.skt`, `.cdf` · **Docs:** [modelscript.org/languages/nasa-cdf](https://modelscript.org/languages/nasa-cdf)

Native **NASA Common Data Format (CDF v2/v3 & Skeleton Table `.skt`, 1985)** space-physics telemetry parser, binary record codec, ISTP/SPDF metadata linter, `CDF_EPOCH`/`CDF_TIME_TT2000` time-conversion & vector-field solver, linear-memory `DAEBuilder` lowering, polyglot CSV/FITS/CCSDS projections, and interactive multi-channel SVG strip-chart React panel for ModelScript.

---

## Core Capabilities

- **WASM GLR Skeleton Table Grammar & Parser (`nasaCdfLanguage`, `parseCdfSkeleton`, `formatCdfSkeleton`)**: Native WebAssembly GLR parser (`dist/parser.wasm`) for NASA CDF Skeleton Tables (`.skt`) covering `#header`, `#GLOBALattributes`, `#VARIABLEattributes`, `#variables`/`#zVariables`, `#end`, `CDF_REAL4`/`CDF_REAL8`/`CDF_INT4`/`CDF_EPOCH`/`CDF_TIME_TT2000`, `ROW_MAJOR`/`COLUMN_MAJOR`, and `!` comments.
- **Binary CDF v2/v3 Record Codec (`encodeCdfBinary`, `decodeCdfBinary`)**: Encodes and decodes binary CDF streams with v3 (`0xCDF30001`) and v2 (`0xCDF26002`) magic headers, CDR, GDR, ADR, AgrEDR, zVDR, AzEDR, VXR, and VVR records in big-endian network byte order.
- **ISTP/SPDF Linter (`lintNasaCdf`, `NasaCdfErrorCode`)**: 19 domain diagnostics (`NCDF1001`–`NCDF5006`) checking syntax/magic errors, missing `#header`/`#end`, duplicate variables and attributes, invalid CDF data types, ISTP `DEPEND_0`/`UNITS`/`VALIDMIN`/`VALIDMAX` compliance, valid-bound range checks, and non-monotonic `EPOCH`/`TT2000` timestamps.
- **Space-Physics Time & Field Solver (`isoToCdfEpoch`, `cdfEpochToJ2000Seconds`, `cdfEpochToTt2000`, `computeMagneticFieldMagnitude`, `analyzeNasaCdfTelemetry`)**: High-precision `CDF_EPOCH` and `CDF_TIME_TT2000` conversions, per-channel telemetry statistics (min, max, mean, RMS, stdDev), magnetic field magnitude $|B| = \sqrt{B_x^2 + B_y^2 + B_z^2}$, plasma $\beta$, and Alfvén speed.
- **Direct Continuous DAE Arena Lowering (`lowerNasaCdfToDae`)**: Lowers magnetometer and plasma telemetry balance equations directly into `@modelscript/runtime`'s `DAEBuilder` (`varCount === eqCount`).
- **Polyglot Projections (`nasaCdfToCsv`, `nasaCdfToFits`, `nasaCdfToCcsds`)**: Exports CDF telemetry to RFC-4180 CSV, FITS 4.0 80-character headers, and CCSDS KVN tracking metadata.
- **Interactive Strip-Chart Viewer & React Panel (`renderNasaCdfStripChartSvg`, `NasaCdfPanel`)**: Pure SVG multi-channel time-series strip-chart renderer integrated into a React `@modelscript/design-tokens/panel` inspector with channel filtering, variable statistics, attribute tables, and lint diagnostics.

---

## Package Structure

| Path                                    | Description                                                                      |
| :-------------------------------------- | :------------------------------------------------------------------------------- |
| `src/index.ts`                          | Public package exports                                                           |
| `src/language.ts`                       | `nasaCdfLanguage` WASM GLR grammar, UI panel registration, and language actions  |
| `src/types.ts`                          | Core TypeScript types (`CdfDocument`, `CdfHeader`, `CdfVariable`, `CdfDataType`) |
| `src/errors.ts`                         | `NasaCdfErrorCode` diagnostic definitions (`NCDF1001`–`NCDF5006`)                |
| `src/parser/skt-parser.ts`              | `.skt` Skeleton Table ASCII parser and formatter                                 |
| `src/parser/binary-codec.ts`            | Binary CDF v2/v3 magic & CDR/GDR/ADR/VDR/VXR/VVR record encoder and decoder      |
| `src/lints/index.ts`                    | `lintNasaCdf` ISTP/SPDF and structural validator                                 |
| `src/solver/epoch.ts`                   | `CDF_EPOCH` / J2000 / `CDF_TIME_TT2000` time conversion utilities                |
| `src/solver/statistics.ts`              | Channel statistics, $                                                            | B   | $ vector norm, plasma $\beta$, and Alfvén speed |
| `src/dae/cdf-to-dae.ts`                 | `lowerNasaCdfToDae` continuous space-physics DAE arena lowering                  |
| `src/projections/`                      | `nasaCdfToCsv`, `nasaCdfToFits`, and `nasaCdfToCcsds` exporters                  |
| `src/catalog/nasa-cdf-std-schemas.ts`   | Cleanroom ISTP/SPDF standard attributes & magnetometer/plasma telemetry schemas  |
| `assets/nasa-cdf-std-lib/src/models.ts` | Zero-GC AssemblyScript WASM runtime kernel for `@modelscript/nasa-cdf-std-lib`   |
| `src/diagram/strip-chart.ts`            | `renderNasaCdfStripChartSvg` pure SVG multi-channel strip-chart generator        |
| `src/ui/NasaCdfPanel.tsx`               | Interactive React viewer/editor panel using `@modelscript/design-tokens/panel`   |
| `src/indexing.ts`                       | `nasaCdfIndexing` workspace symbol indexer                                       |
| `src/lsp.ts`                            | `validateNasaCdf`, `getNasaCdfDocumentSymbols`, `getNasaCdfHover`, completions   |

---

## Diagnostic Codes (`NCDF1001`–`NCDF5006`)

| Code       | Rule                             | Severity  | Description                                                              |
| :--------- | :------------------------------- | :-------- | :----------------------------------------------------------------------- |
| `NCDF1001` | `syntax-error`                   | `error`   | Syntax error or malformed skeleton table statement                       |
| `NCDF1002` | `invalid-magic-number`           | `error`   | Invalid binary CDF magic header (expected v3 `0xCDF30001` or v2)         |
| `NCDF1003` | `corrupt-record-structure`       | `error`   | Corrupt binary CDF CDR/GDR/VDR/VXR/VVR record length or offset           |
| `NCDF2001` | `missing-header-section`         | `error`   | Skeleton table is missing the mandatory `#header` section                |
| `NCDF2002` | `missing-end-section`            | `error`   | Skeleton table is missing the mandatory `#end` terminator                |
| `NCDF2003` | `duplicate-variable`             | `error`   | Duplicate variable name declared in `#variables`                         |
| `NCDF2004` | `duplicate-attribute`            | `error`   | Duplicate global or variable attribute name                              |
| `NCDF3001` | `invalid-cdf-data-type`          | `error`   | Unrecognized or unsupported CDF data type                                |
| `NCDF3002` | `dimension-mismatch`             | `error`   | Variable `numDims` disagrees with `dimSizes` or `dimVariances`           |
| `NCDF4001` | `istp-missing-depend-0`          | `warning` | ISTP data variable is missing `DEPEND_0` referencing a time variable     |
| `NCDF4002` | `istp-missing-units`             | `warning` | ISTP data variable is missing `UNITS` attribute                          |
| `NCDF4003` | `istp-missing-valid-bounds`      | `warning` | ISTP data variable is missing `VALIDMIN` or `VALIDMAX`                   |
| `NCDF4004` | `istp-invalid-depend-0-target`   | `error`   | `DEPEND_0` references an undefined or non-time variable                  |
| `NCDF5001` | `invalid-valid-bounds`           | `error`   | `VALIDMIN` is strictly greater than `VALIDMAX`                           |
| `NCDF5002` | `value-out-of-valid-range`       | `warning` | Sample value falls outside `[VALIDMIN, VALIDMAX]`                        |
| `NCDF5003` | `non-monotonic-epoch`            | `error`   | `CDF_EPOCH` or `CDF_TIME_TT2000` timestamps are not strictly monotonic   |
| `NCDF5004` | `missing-istp-global-attributes` | `info`    | Missing recommended ISTP global attributes (`Project`, `Source_name`...) |
| `NCDF5005` | `fillval-mismatch`               | `warning` | `FILLVAL` lies inside `[VALIDMIN, VALIDMAX]`                             |
| `NCDF5006` | `empty-data-records`             | `info`    | Record-varying variable contains zero data records                       |

---

## Programmatic Usage

```typescript
import {
  analyzeNasaCdfTelemetry,
  decodeCdfBinary,
  encodeCdfBinary,
  lintNasaCdf,
  lowerNasaCdfToDae,
  nasaCdfToCsv,
  parseCdfSkeleton,
  renderNasaCdfStripChartSvg,
} from "@modelscript/nasa-cdf";

const doc = parseCdfSkeleton(sktSource);
const diagnostics = lintNasaCdf(doc);
const summary = analyzeNasaCdfTelemetry(doc);
const binary = encodeCdfBinary(doc);
const roundTripped = decodeCdfBinary(binary);
const dae = lowerNasaCdfToDae(doc);
const csv = nasaCdfToCsv(doc);
const svg = renderNasaCdfStripChartSvg(doc);
```

---

## Scripts

| Command             | Description                                                     |
| :------------------ | :-------------------------------------------------------------- |
| `npm run build`     | Build WASM GLR parser, cleanroom stdlib, and TypeScript (`tsc`) |
| `npm run clean`     | Remove `dist/` build artifacts (`rimraf dist`)                  |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                           |
| `npm test`          | Run unit and integration test suite via `test-runner.js`        |
| `npm run typecheck` | Run TypeScript type checking without emitting (`tsc --noEmit`)  |

---

## CLI & Toolchain Integration

```bash
# Validate and lint NASA CDF files
msx lint sample.skt

# Run package test suite (8 suites, Beta maturity)
pnpm --filter @modelscript/nasa-cdf test
```

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="nasa-cdf" />
