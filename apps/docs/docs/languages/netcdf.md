---
title: "NetCDF Classic / CDL (.cdl)"
description: "Unidata self-describing scientific arrays, CF linting & heatmap viewer"
---

# NetCDF Classic / CDL (`.cdl`)

**Package:** `@modelscript/netcdf` · **Maturity:** `Beta` · **Extensions:** `.cdl`

**Maturity:** Beta · **Extensions:** `.cdl`, `.nc`, `.cdf` · **Docs:** [modelscript.org/languages/netcdf](https://modelscript.org/languages/netcdf)

Native **Unidata NetCDF Classic v1/v2 (CDF1 / CDF2) & CDL (Common Data form Language, 1988)** multidimensional array dataset compiler, binary codec, CF-1.x validator, field statistics & bilinear interpolation engine, direct `DAEBuilder` lowering, and interactive React + SVG 2D heatmap/contour viewer panel for ModelScript.

---

## Core Capabilities

- **CDL ASCII & Binary NetCDF Classic v1/v2 Codec (`parseCdl`, `formatCdl`, `decodeNetcdfBinary`, `encodeNetcdfBinary`)**:
  - Full Common Data form Language (`.cdl`) parsing for `dimensions:`, `variables:`, `data:`, `UNLIMITED` record dimensions, all Classic types (`byte`, `char`, `short`, `int`, `long`, `float`, `double`), global & variable attributes, and `//` comments.
  - Native big-endian IEEE-754 binary encoding and decoding for NetCDF Classic v1 (`CDF\x01`, 32-bit offsets) and v2 (`CDF\x02`, 64-bit offsets), including fixed and interleaved record-variable slabs.
  - Native WebAssembly GLR parser (`dist/parser.wasm`) compiled from `@modelscript/dsl` combinators.
- **CF-1.x & Structural Linter (`lintNetcdf`, `NetcdfErrorCode`)**:
  - 18 domain diagnostics (`NC1001`–`NC5006`) covering syntax/magic errors, duplicate dimensions/variables/attributes, undefined dimensions, non-positive dimension sizes, `UNLIMITED` placement rules, data count vs. shape mismatches, missing CF-1.x `units`/`long_name` metadata, and NaN/Inf `_FillValue` mismatches.
- **Multidimensional Field Solver (`sliceVariable`, `computeFieldStats`, `computeFieldRmse`, `bilinearInterpolate2D`, `unpackVariableValues`)**:
  - Arbitrary-axis array slicing, min/max/mean/variance/std/RMS/RMSE statistics with fill-value masking, CF `scale_factor`/`add_offset` unpacking, and exact 2D rectilinear bilinear interpolation.
- **Direct Continuous DAE Arena Lowering (`lowerNetcdfToDae`, `netcdfToDae`)**:
  - Lowers multidimensional field variables and conservation/relaxation dynamics directly into `@modelscript/runtime`'s `IDaeBuilder` linear memory arena.
- **Polyglot Projections (`netcdfToCsv`, `netcdfToPlot3d`, `netcdfToModelica`)**:
  - Projects NetCDF datasets to tidy CSV tables, NASA PLOT3D grid/solution blocks, and Modelica 3.x models.
- **Cleanroom CF-1.x Standard Library (`@modelscript/netcdf-std-lib`)**:
  - Declarative cleanroom schemas, deterministic SVG block icons, and AssemblyScript WASM runtime kernels for CF-1.x standard variables (`temperature`, `pressure`, `u_wind`, `v_wind`, `salinity`, `elevation`) and NetCDF Classic data types.
- **Interactive Visualization (`renderNetcdfHeatmapSvg`, `NetcdfPanel`)**:
  - Pure SVG 2D heatmap & contour isoline slice visualizer with Viridis perceptual colormap and colorbar legend, integrated into an interactive React panel (`@modelscript/design-tokens/panel`) with variable selector, slice scrubber, dimensions/variables/attributes inspector, and lints tab.

---

## Package Structure

| Path                                | Description                                                                       |
| :---------------------------------- | :-------------------------------------------------------------------------------- |
| `src/index.ts`                      | Public package exports                                                            |
| `src/language.ts`                   | `netcdfLanguage` DSL grammar, file extensions, and UI panel registration          |
| `src/types.ts`                      | Core TypeScript interfaces (`NetcdfDataset`, `NetcdfVariable`, `NetcdfDimension`) |
| `src/errors.ts`                     | Diagnostic error codes (`NC1001`–`NC5006`)                                        |
| `src/parser/cdl-parser.ts`          | CDL ASCII parser (`parseCdl`) and serializer (`formatCdl`)                        |
| `src/parser/binary-codec.ts`        | NetCDF Classic CDF1/CDF2 big-endian binary codec                                  |
| `src/lints/index.ts`                | `lintNetcdf` structural and CF-1.x validator                                      |
| `src/solver/field-ops.ts`           | Array slicing, field statistics, RMSE, and 2D bilinear interpolation              |
| `src/dae/lowering.ts`               | `lowerNetcdfToDae` linear-memory `IDaeBuilder` lowering                           |
| `src/projections/`                  | Projections to CSV, NASA PLOT3D, and Modelica 3.x                                 |
| `src/catalog/netcdf-std-schemas.ts` | Cleanroom CF-1.x & NetCDF Classic data type schemas                               |
| `src/diagram/heatmap-svg.ts`        | Pure SVG 2D heatmap & contour slice visualizer (`renderNetcdfHeatmapSvg`)         |
| `src/ui/NetcdfPanel.tsx`            | Interactive React viewer/editor panel for VS Code, Ansatz, and Artifacts          |
| `src/indexing.ts`                   | Declarative `UnifiedWorkspace` symbol indexing                                    |
| `src/lsp.ts`                        | LSP diagnostics, document symbols, hover, and completions                         |

---

## CLI & Toolchain Integration

```bash
# Validate and lint NetCDF Classic / CDL files
msx lint sample.cdl

# Run package test suite (8 suites, Beta maturity)
pnpm --filter @modelscript/netcdf test
```

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="netcdf" />
