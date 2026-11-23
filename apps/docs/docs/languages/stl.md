---
title: "3D Systems STL (.stl)"
description: "ASCII/Binary STL meshes, mass/inertia, manifold lints & 3D shaded viewer"
---

# 3D Systems STL (`.stl`)

**Package:** `@modelscript/stl` · **Maturity:** `Beta` · **Extensions:** `.stl`

**Maturity:** Beta · **Extensions:** `.stl` · **Docs:** [modelscript.org/languages/stl](https://modelscript.org/languages/stl)

Native **3D Systems STL (Stereolithography ASCII & Binary Mesh Format, 1987)** compiler, manifold analyzer, mass-property solver, CAD/DAE lowering engine, polyglot projector, and interactive 3D orthographic/isometric SVG mesh viewer for ModelScript.

---

## Core Capabilities

- **WASM GLR ASCII Parser & Binary STL Codec (`parseStl`, `parseAsciiStl`, `parseBinaryStl`, `encodeBinaryStl`, `formatAsciiStl`)**:
  - Formal `@modelscript/dsl` grammar (`stlLanguage`) compiled to `dist/parser.wasm` + `src-gen/bindings.{js,d.ts}`.
  - Full ASCII STL (`solid` / `facet normal` / `outer loop` / `vertex` / `endloop` / `endfacet` / `endsolid`) and IEEE-754 little-endian Binary STL (80-byte header + `uint32` facet count + 50-byte facet records) support.
- **Manifold & Geometry Diagnostics (`lintStl`, `StlErrorCode`)**:
  - Comprehensive diagnostics (`STL1001`–`STL5006`) detecting syntax/truncation errors, mismatched `solid`/`endsolid` names, NaN/Inf coordinates, degenerate zero-area triangles, right-hand-rule normal inversions, non-manifold edges (>2 incident faces), open boundary edges (non-watertight shells), and negative signed volume.
- **Exact Mass-Property & Topology Solver (`computeStlMassProperties`, `analyzeStlTopology`)**:
  - Exact signed tetrahedral volume $V = \frac{1}{6}\sum v_0 \cdot (v_1 \times v_2)$, surface area, volume-weighted centroid, exact 3×3 inertia tensor (origin and centroidal frames), bounding box, Euler characteristic $\chi = V - E + F$, and watertightness verification.
- **CAD Solid & DAE Rigid-Body Lowering (`stlToCadSolid`, `stlToDae`, `lowerStlToDae`)**:
  - Lowers welded triangle meshes into `@modelscript/cad` `PolyhedronSolid` nodes and lowers 6-DOF rigid-body mass/inertia dynamics directly into `@modelscript/runtime` `DAEBuilder`.
- **Polyglot Projections & Interactive 3D Viewer (`stlToObj`, `stlToStep`, `renderStlMeshSvg`, `StlPanel`)**:
  - Projects STL meshes to Wavefront OBJ, ISO 10303-21 STEP, and painter's-algorithm Lambertian-shaded isometric/orthographic SVG (`iso`, `xy`, `xz`, `yz`, wireframe toggle), paired with an interactive React `StlPanel`.
- **Cleanroom Standard Library (`@modelscript/stl-std-lib`)**:
  - Analytical watertight STL primitives (Unit Cube, Unit Tetrahedron, Regular Octahedron, Cylinder, Icosphere) with AssemblyScript `runtime.wasm` mass-property kernels and SVG block icons.

---

## Package Structure

| Path                             | Description                                                                      |
| :------------------------------- | :------------------------------------------------------------------------------- |
| `src/index.ts`                   | Public package exports                                                           |
| `src/language.ts`                | `stlLanguage` `@modelscript/dsl` grammar, file extensions (`.stl`), and UI panel |
| `src/types.ts`                   | Core TypeScript interfaces (`StlMeshDocument`, `StlSolid`, `StlFacet`, etc.)     |
| `src/errors.ts`                  | `StlErrorCode` (`STL1001`–`STL5006`) diagnostic catalog                          |
| `src/parser/index.ts`            | Unified ASCII & Binary STL parser and encoder                                    |
| `src/lints/index.ts`             | Manifold, watertightness, normal-consistency, and geometry linter                |
| `src/solver/index.ts`            | Exact tetrahedral volume, area, centroid, 3×3 inertia tensor, and Euler topology |
| `src/cad/index.ts`               | `@modelscript/cad` `PolyhedronSolid` lowering                                    |
| `src/dae/index.ts`               | Rigid-body mass/inertia lowering to `@modelscript/runtime` `DAEBuilder`          |
| `src/projections/index.ts`       | Projections to Wavefront OBJ, ISO 10303-21 STEP, and SVG                         |
| `src/diagram/index.ts`           | Painter's-algorithm isometric/orthographic shaded 3D SVG mesh renderer           |
| `src/ui/StlPanel.tsx`            | Interactive React 3D STL viewer, mass-property inspector, and diagnostic panel   |
| `src/catalog/stl-std-schemas.ts` | Cleanroom standard library schemas and analytical STL primitive generators       |
| `src/indexing.ts`                | Declarative `UnifiedWorkspace` symbol indexing                                   |
| `src/lsp.ts`                     | LSP diagnostics, document symbols, hover, and completions                        |

---

## CLI & Toolchain Integration

```bash
# Validate and lint 3D Systems STL files
msx lint sample.stl

# Run package test suite (8 suites, Beta maturity)
pnpm --filter @modelscript/stl test
```
