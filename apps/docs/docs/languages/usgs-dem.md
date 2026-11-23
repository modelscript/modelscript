---
title: "USGS DEM (.dem)"
description: "Digital Elevation Model slope/aspect, D8 flow & topographic map viewer"
---

# USGS DEM (`.dem`)

**Package:** `@modelscript/usgs-dem` · **Maturity:** `Beta` · **Extensions:** `.dem`

**Maturity:** Beta · **Extensions:** `.dem`, `.usgs-dem` · **Docs:** [modelscript.org/languages/usgs-dem](https://modelscript.org/languages/usgs-dem)

Native **USGS Digital Elevation Model (DEM)** ASCII Terrain Format (1970s–1980s, USGS Data Users Guide 5) parser, WASM GLR grammar, geomorphometric solver, `@modelscript/cad` solid terrain lowerer, Manning kinematic-wave overland runoff DAE lowerer, and interactive React + SVG elevation map viewer for ModelScript.

---

## Core Capabilities

- **WASM GLR Grammar & Dual-Format Parser (`usgsDemLanguage`, `parseUsgsDem`, `serializeUsgsDem`)**: Parses both 1024-byte fixed-column USGS DEM tape records (with Fortran `D` exponents) and free-format `TYPE_A` / `TYPE_B` / `TYPE_C` ASCII decks.
- **Semantic & Structural Linter (`lintUsgsDem`, `UsgsDemErrorCode`)**: Validates `DEM1001`–`DEM5006` (syntax errors, ground reference system codes, planimetric/elevation units, positive `dx/dy/dz` resolution, missing or mismatched Type B profiles, elevation bounds, UTM zone, and Type C RMSE).
- **CAD Terrain Mesh & Solid Lowering (`buildTerrainMesh`, `lowerUsgsDemToCadSolid`)**: Triangulates regular DEM grids into surface meshes with exact surface area, planar area, and prism volume above datum, and lowers to watertight `@modelscript/cad` `PolyhedronSolid`.
- **Topographic & Geomorphometric Solver (`interpolateElevation`, `computeHornSlopeAspect`, `computeTerrainGridMetrics`, `computeD8Flow`, `computeHypsometricIntegral`, `extractElevationProfile`)**:
  - Bilinear elevation interpolation
  - Horn (1981) 3×3 finite-difference slope & compass aspect gradients
  - D8 steepest-descent flow direction & topological flow accumulation
  - Strahler hypsometric integral & cross-section transect extraction
- **DAE Lowering (`lowerUsgsDemToDae`, `usgsDemToDae`)**: Lowers watershed overland runoff Manning kinematic-wave continuity and discharge equations directly into `@modelscript/runtime`'s `DAEBuilder`.
- **Polyglot Projections (`usgsDemToStl`, `usgsDemToObj`, `usgsDemToHec1`)**: Exports watertight ASCII STL, Wavefront OBJ, and USACE HEC-1 subbasin summary decks.
- **Cleanroom Standard Library (`@modelscript/usgs-dem-std-lib`)**: Zero-I/O datum/projection schemas (UTM NAD27/NAD83, Geographic arc-seconds, State Plane, Albers), canonical synthetic terrain benchmarks (`generateGaussianHillDem`, `generateInclinedPlaneDem`, `generateVValleyDem`), and AssemblyScript WASM runtime.
- **Interactive Visualization (`renderUsgsDemMapSvg`, `UsgsDemPanel`)**: Pure SVG hypsometric-tint elevation map with marching-squares contour lines, interactive N–S cross-section profile, and React panel built on `@modelscript/design-tokens/panel`.

---

## Package Structure

| Path                                  | Description                                                                    |
| :------------------------------------ | :----------------------------------------------------------------------------- |
| `src/index.ts`                        | Public package exports                                                         |
| `src/language.ts`                     | `usgsDemLanguage` WASM GLR grammar and UI panel registration                   |
| `src/types.ts`                        | Core TypeScript interfaces (`UsgsDemModel`, `UsgsDemHeader`, `UsgsDemGrid`)    |
| `src/errors.ts`                       | `UsgsDemErrorCode` (`DEM1001`–`DEM5006`)                                       |
| `src/parser/dem-parser.ts`            | `parseUsgsDem` and `serializeUsgsDem` (fixed 1024-byte & free-format)          |
| `src/lints/index.ts`                  | `lintUsgsDem` structural and semantic validator                                |
| `src/cad/terrain-mesh.ts`             | `buildTerrainMesh` and `lowerUsgsDemToCadSolid` (`@modelscript/cad`)           |
| `src/solver/topography.ts`            | Bilinear interpolation, Horn slope/aspect, D8 flow, hypsometric integral       |
| `src/dae/lowering.ts`                 | `lowerUsgsDemToDae` and `usgsDemToDae` (Manning kinematic-wave runoff)         |
| `src/projections/index.ts`            | `usgsDemToStl`, `usgsDemToObj`, and `usgsDemToHec1`                            |
| `src/catalog/usgs-dem-std-schemas.ts` | Cleanroom datum, projection, and synthetic terrain benchmark schemas           |
| `src/diagram/elevation-map.ts`        | `renderUsgsDemMapSvg` hypsometric map, contour lines, and transect profile     |
| `src/ui/UsgsDemPanel.tsx`             | Interactive React + SVG elevation map viewer & inspector panel                 |
| `src/indexing.ts`                     | `usgsDemIndexing` UnifiedWorkspace indexer                                     |
| `src/lsp.ts`                          | `validateUsgsDem`, `getUsgsDemDocumentSymbols`, `getUsgsDemHover`, completions |

---

## CLI & Toolchain Integration

```bash
# Validate and lint USGS DEM files
msx lint sample.dem

# Run package test suite (8 suites, Beta maturity)
pnpm --filter @modelscript/usgs-dem test
```
