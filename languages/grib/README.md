<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/grib

**Maturity:** Beta · **Extensions:** `.grb`, `.grib`, `.grib1` · **Docs:** [modelscript.org/languages/grib](https://modelscript.org/languages/grib)

Native **WMO GRIB Edition 1 (FM 92-VIII Ext. GRIB, 1985)** Gridded Binary Meteorological Format package for ModelScript. Features a native WebAssembly GLR parser for textual GRIB1 descriptor dumps, a full binary GRIB Edition 1 stream encoder/decoder (Section 0 Indicator, Section 1 PDS, Section 2 Lat/Lon GDS, Section 3 BMS bitmap, Section 4 BDS with IBM System/360 32-bit floating-point reference value and arbitrary-width bit-packing, and Section 5 `7777` trailer), meteorological diagnostics (geostrophic wind, hypsometric barometric thickness, area-weighted global mean), direct `DAEBuilder` atmospheric primitive-equation lowering, NetCDF CDL & CSV projections, WMO Table 2/3 cleanroom standard library, LSP services, and an interactive React + SVG geographic heatmap/isobar/wind-barb viewer (`GribPanel`).

---

## Core Capabilities

- **WASM GLR Textual Parser & Binary GRIB1 Codec (`parseGribDescriptor`, `decodeGrib1Binary`, `encodeGrib1Binary`)**:
  - Parses textual GRIB1 descriptor dumps (`GRIB`, `IS`, `PDS`, `GDS`, `BMS`, `BDS`, `7777`) via a native WebAssembly GLR grammar (`dist/parser.wasm`) and structured AST parser.
  - Encodes and decodes WMO FM 92-VIII binary GRIB1 byte streams including IBM System/360 32-bit base-16 floating-point reference values $R$, sign-magnitude scale factors $E$ and $D$, MSB-first bit-packing/unpacking, and BMS missing-data bitmaps.
- **GRIB1 Packing & Atmospheric Physics Solver (`unpackGrib1Values`, `packGrib1Values`, `computeHypsometricThickness`, `computeGeostrophicWind`, `computeAreaWeightedGlobalMean`)**:
  - Exact WMO GRIB1 unpacking relation $Y = (R + X \cdot 2^E) \cdot 10^{-D}$.
  - Hypsometric thickness $\Delta Z = \frac{R_d \bar{T}_v}{g_0} \ln(p_1 / p_2)$ and barometric height relations.
  - Mid-latitude geostrophic wind $(u_g, v_g) = \left(-\frac{g_0}{f}\frac{\partial Z}{\partial y}, \frac{g_0}{f}\frac{\partial Z}{\partial x}\right)$ and cosine-latitude area-weighted global mean.
- **Direct Linear-Memory DAE Lowering (`lowerGribToDae`)**:
  - Lowers hydrostatic balance, geostrophic balance, inertial momentum equations, and GRIB1 physical value scaling directly into `@modelscript/runtime`'s `DAEBuilder` (`varCount === eqCount`).
- **Domain Linter (`lintGribDocument`, `GribErrorCode`)**:
  - 16 diagnostic rules (`GRIB1001`–`GRIB5006`) validating magic headers, `7777` trailers, edition conformance, PDS date/time & WMO Table 2 parameter codes, GDS/BMS/BDS grid dimension parity, latitude/longitude bounds, and bit-width limits.
- **Projections & Interactive Geographic Visualization (`gribToNetCdfCdl`, `gribToCsv`, `renderGribMapSvg`, `GribPanel`)**:
  - Projects gridded fields to NetCDF CDL and flat lat/lon CSV.
  - Renders pure SVG geographic scalar heatmaps with marching-squares isobar contours and wind barbs/vectors, integrated into `GribPanel` via `@modelscript/design-tokens/panel`.

---

## Package Structure

| Path                                | Description                                                                                           |
| :---------------------------------- | :---------------------------------------------------------------------------------------------------- |
| `src/index.ts`                      | Public package exports                                                                                |
| `src/language.ts`                   | `gribLanguage` WASM GLR grammar, UI panel registration, and language actions                          |
| `src/types.ts`                      | Core GRIB Edition 1 TypeScript interfaces (`GribDocument`, `GribMessage`, `PDS`, `GDS`, `BMS`, `BDS`) |
| `src/errors.ts`                     | `GribErrorCode` diagnostic definitions (`GRIB1001`–`GRIB5006`)                                        |
| `src/parser/text-parser.ts`         | Textual GRIB1 descriptor dump parser and formatter                                                    |
| `src/parser/binary-codec.ts`        | Binary GRIB1 stream encoder/decoder with IBM 32-bit float and bit-packing                             |
| `src/lints/index.ts`                | `lintGribDocument` domain validator (`GRIB1001`–`GRIB5006`)                                           |
| `src/solver/packing.ts`             | GRIB1 bit-packing/unpacking and field statistics                                                      |
| `src/solver/meteorology.ts`         | Hypsometric thickness, geostrophic wind, and area-weighted global mean                                |
| `src/dae/grib-to-dae.ts`            | `lowerGribToDae` atmospheric primitive-equation balance DAE arena lowering                            |
| `src/projections/grib-to-cdl.ts`    | `gribToNetCdfCdl` NetCDF CDL projection                                                               |
| `src/projections/grib-to-csv.ts`    | `gribToCsv` lat/lon CSV projection                                                                    |
| `src/diagram/grib-map.ts`           | `renderGribMapSvg` pure SVG geographic heatmap + isobar/wind-barb renderer                            |
| `src/ui/GribPanel.tsx`              | Interactive React + SVG viewer/editor panel (`@modelscript/design-tokens/panel`)                      |
| `src/catalog/grib-std-schemas.ts`   | Cleanroom WMO Table 2 parameters & Table 3 level schemas                                              |
| `assets/grib-std-lib/src/models.ts` | AssemblyScript WASM runtime kernel for GRIB1 unpacking & meteorology                                  |
| `src/indexing.ts`                   | Multi-file `UnifiedWorkspace` symbol indexer                                                          |
| `src/lsp.ts`                        | LSP diagnostics, document symbols, hover, and completions                                             |

---

## Diagnostic Rules (`GRIB1001`–`GRIB5006`)

| Code       | Rule                         | Severity  | Description                                                                        |
| :--------- | :--------------------------- | :-------- | :--------------------------------------------------------------------------------- |
| `GRIB1001` | `invalid-magic`              | `error`   | Missing or invalid `GRIB` Indicator Section magic header or syntax error.          |
| `GRIB1002` | `missing-trailer`            | `error`   | Missing mandatory `7777` End Section trailer.                                      |
| `GRIB1003` | `unsupported-edition`        | `error`   | Unsupported GRIB edition number (only Edition 1 is supported).                     |
| `GRIB2001` | `invalid-pds-date`           | `error`   | Invalid PDS reference date/time field (month, day, hour, or minute out of range).  |
| `GRIB2002` | `invalid-parameter-code`     | `error`   | Parameter indicator outside valid WMO Table 2 range (`1..254`).                    |
| `GRIB2003` | `invalid-level-type`         | `warning` | Unrecognized WMO Table 3 level/layer type indicator.                               |
| `GRIB3001` | `gds-bds-dimension-mismatch` | `error`   | GDS grid dimensions (`ni * nj` or BMS active points) do not match BDS value count. |
| `GRIB3002` | `invalid-lat-lon-bounds`     | `error`   | Geographic latitude outside `[-90, 90]` or longitude outside `[-180, 360]`.        |
| `GRIB3003` | `bms-length-mismatch`        | `error`   | BMS bitmap length does not match GDS grid point count `ni * nj`.                   |
| `GRIB4001` | `invalid-bit-width`          | `error`   | BDS bit-width per value is negative or exceeds 32 bits.                            |
| `GRIB4002` | `invalid-scale-factor`       | `warning` | Extreme binary (`                                                                  | E   | > 64`) or decimal (` | D   | > 16`) scale factor. |
| `GRIB5001` | `missing-pds`                | `error`   | GRIB message is missing the mandatory Product Definition Section (PDS).            |
| `GRIB5002` | `missing-bds`                | `error`   | GRIB message is missing the mandatory Binary Data Section (BDS).                   |
| `GRIB5003` | `non-finite-data`            | `error`   | BDS data array contains non-finite (`NaN` or `Infinity`) values.                   |
| `GRIB5004` | `truncated-binary-message`   | `error`   | Binary GRIB1 message is truncated before its declared total length.                |
| `GRIB5005` | `invalid-grid-increment`     | `warning` | Non-positive grid increment (`di <= 0` or `dj <= 0`) on a regular lat/lon grid.    |
| `GRIB5006` | `physical-range-warning`     | `warning` | Unpacked values fall outside expected meteorological physical bounds.              |
