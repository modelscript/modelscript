---
title: "NCSA HDF4 (.hdf)"
description: "Hierarchical Data Format v4 Vgroup/SDS binary codec & heatmap viewer"
---

# NCSA HDF4 (`.hdf`)

**Package:** `@modelscript/hdf4` · **Maturity:** `Beta` · **Extensions:** `.hdf`

**Maturity:** Beta · **Extensions:** `.hdf`, `.h4`, `.hdf4`, `.eos` · **Docs:** [modelscript.org/languages/hdf4](https://modelscript.org/languages/hdf4)

Native **NCSA HDF4 (Hierarchical Data Format v4, 1987)** scientific data container, DDL schema language, binary DDH/DD codec, NASA EOS-HDF swath/grid standard library, and interactive SVG/React visualization package for ModelScript. Features full big-endian HDF4 binary encoding/decoding (4-byte magic `0x0e031301`, DDH/DD tag-ref-offset-length descriptor blocks, `DFTAG_NDG`/`DFTAG_SD`/`DFTAG_VG`/`DFTAG_VH`/`DFTAG_VS`), WASM GLR parser for HDF4 DDL/SDS textual schemas, Vgroup hierarchy traversal, N-D SDS slicing & statistics, direct linear-memory `DAEBuilder` lowering, 17 domain lint rules (`HDF1001`–`HDF5006`), NetCDF CDL & CSV projections, and an interactive React + SVG viewer/editor panel (`Hdf4Panel`).

---

## Core Capabilities

- **WASM GLR Parser & Dual Textual/Binary Codec (`parseHdf4Ddl`, `encodeHdf4Binary`, `decodeHdf4Binary`)**:
  - Textual HDF4 DDL grammar (`HDF4`, `SDS`, `VGROUP`, `VDATA`, `RASTER8`, `PALETTE`, `DIM`, `ATTR`, `DATA`, `MEMBER`, `END`, `#` comments) compiled to native `dist/parser.wasm`.
  - Binary NCSA HDF4 stream encoder/decoder supporting magic `0x0e031301`, chained DDH/DD blocks, and standard tags (`DFTAG_NDG`, `DFTAG_SDD`, `DFTAG_SD`, `DFTAG_NT`, `DFTAG_VG`, `DFTAG_VH`, `DFTAG_VS`, `DFTAG_ID8`, `DFTAG_RI8`, `DFTAG_IP8`).
- **Solver & Scientific Array Analytics (`traverseVgroupHierarchy`, `sliceSds`, `computeSdsStatistics`, `analyzeHdf4Document`)**:
  - Cycle-safe Vgroup hierarchy traversal, N-dimensional SDS hyperslab slicing, and exact min/max/mean/variance/std/RMSE statistics.
- **Direct Continuous DAE Arena Lowering (`hdf4ToDae`, `lowerHdf4ToDae`)**:
  - Lowers scientific dataset statistics and conservation/balance equations directly into `@modelscript/runtime`'s `DAEBuilder`.
- **Domain Linter (`lintHdf4`, `Hdf4ErrorCode`)**:
  - 17 diagnostics (`HDF1001`–`HDF5006`) covering syntax/magic validation, duplicate tag/ref or SDS names, undefined Vgroup members, cyclic Vgroup hierarchies, SDS data count mismatches, invalid `DFNT_*` type codes, and non-positive dimension sizes.
- **Projections (`hdf4ToNetcdfCdl`, `hdf4ToCsv`)**:
  - Projects HDF4 hierarchies and SDS datasets to NetCDF CDL and RFC-4180 CSV.
- **Cleanroom Standard Library (`@modelscript/hdf4-std-lib`)**:
  - Core HDF4 object tag schemas (`SDS`, `Vgroup`, `Vdata`, `Raster8`, `Palette`, `NDG`) and NASA EOS-HDF swath/grid archetypes (`EOS_SWATH`, `EOS_GRID`, `EOS_POINT`, `MODIS_L1B`, `AIRS_L2`, `LANDSAT_TM`) with deterministic SVG block icons and AssemblyScript WASM runtime.
- **Interactive SVG Diagram & React Panel (`renderHdf4DiagramSvg`, `Hdf4Panel`)**:
  - Pure SVG Vgroup/SDS hierarchy diagram + 2D SDS dataset heatmap with color bar, wrapped in an interactive React panel built on `@modelscript/design-tokens/panel`.

---

## Package Structure

| Path                              | Description                                                                            |
| :-------------------------------- | :------------------------------------------------------------------------------------- |
| `src/index.ts`                    | Public package exports                                                                 |
| `src/language.ts`                 | `hdf4Language` WASM GLR grammar, extension registration, and `Hdf4Panel` UI descriptor |
| `src/types.ts`                    | Core HDF4 tag/datatype constants and TypeScript interfaces                             |
| `src/errors.ts`                   | `Hdf4ErrorCode` (`HDF1001`–`HDF5006`) diagnostic definitions                           |
| `src/parser/ddl-parser.ts`        | Textual HDF4 DDL parser and formatter                                                  |
| `src/parser/binary-codec.ts`      | Big-endian HDF4 binary DDH/DD stream encoder & decoder                                 |
| `src/lints/index.ts`              | Semantic and binary structural linter (`lintHdf4`, `lintHdf4Binary`)                   |
| `src/solver/index.ts`             | Vgroup traversal, N-D SDS slicing, and array statistics                                |
| `src/dae/index.ts`                | `DAEBuilder` scientific dataset balance lowering                                       |
| `src/projections/index.ts`        | NetCDF CDL and CSV projections                                                         |
| `src/catalog/hdf4-std-schemas.ts` | Cleanroom HDF4 object & NASA EOS-HDF archetype schemas                                 |
| `src/diagram/index.ts`            | Pure SVG Vgroup/SDS hierarchy & 2D SDS heatmap renderer                                |
| `src/ui/Hdf4Panel.tsx`            | Interactive React + SVG viewer/editor panel                                            |
| `src/indexing.ts`                 | UnifiedWorkspace symbol indexing                                                       |
| `src/lsp.ts`                      | LSP validation, document symbols, hover, and completions                               |

---

## CLI & Toolchain Integration

```bash
# Validate and lint NCSA HDF4 files
msx lint sample.hdf

# Run package test suite (8 suites, Beta maturity)
pnpm --filter @modelscript/hdf4 test
```
