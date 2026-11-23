---
title: "Wavefront OBJ / MTL (.obj)"
description: "3D polygon meshes, MTL materials, CAD lowering & 3D shaded mesh viewer"
---

# Wavefront OBJ / MTL (`.obj`)

**Package:** `@modelscript/obj` · **Maturity:** `Beta` · **Extensions:** `.obj`

**Maturity:** Beta · **Extensions:** `.obj`, `.mtl` · **Docs:** [modelscript.org/languages/obj](https://modelscript.org/languages/obj)

Native **Wavefront OBJ & MTL** (1980s Wavefront Technologies Advanced Visualizer 3D geometry & material library format) compiler, mesh analyzer, CAD/DAE lowering engine, polyglot exporter, and interactive SVG 3D viewer for ModelScript.

---

## Core Capabilities

- **WASM GLR Grammar & Full Wavefront OBJ/MTL Parsers (`objLanguage`, `parseObj`, `parseMtl`, `parseObjWithMtl`)**:
  - Ingests vertices (`v`), texture coordinates (`vt`), vertex normals (`vn`), parameter-space vertices (`vp`), polygonal faces (`f` with `v`, `v/vt`, `v//vn`, `v/vt/vn`, supporting both 1-based positive and relative negative indices), polylines (`l`), point clouds (`p`), objects (`o`), groups (`g`), smoothing groups (`s`), material libraries (`mtllib`), and material bindings (`usemtl`).
  - Parses companion Wavefront MTL libraries (`newmtl`, `Ka`, `Kd`, `Ks`, `Ke`, `Ns`, `d`, `Tr`, `Ni`, `illum`, texture maps).
- **Mesh Topology & Geometry Solver (`triangulateObjMesh`, `computeSmoothVertexNormals`, `computeBoundingBox`, `computeMeshMetrics`)**:
  - Fan triangulation of arbitrary $n$-gons into indexed triangles.
  - Area-weighted smooth vertex normal calculation, axis-aligned bounding box, exact surface area $A$, signed volume $V$, centroid, rigid-body inertia tensor, watertightness check, and Euler characteristic $\chi = V - E + F$.
- **CAD & Linear-Memory DAE Lowering (`lowerObjToCad`, `lowerObjToDae`, `objToDae`)**:
  - Lowers OBJ meshes directly into `@modelscript/cad` `PolyhedronSolid` and `Assembly` structures with MTL diffuse color metadata.
  - Lowers rigid-body mass, centroid, diagonal inertia tensor, and 6-DOF translational/rotational dynamics directly into `@modelscript/runtime`'s `DAEBuilder`.
- **Polyglot Projections (`objToAsciiStl`, `objToBinaryStl`, `objToStep`, `objToUsd`)**:
  - Exports meshes to ASCII STL, IEEE 754 Binary STL, ISO 10303-21 STEP, and OpenUSD `.usda`.
- **Domain Linter (`lintObj`, `lintMtl`, `ObjErrorCode`)**:
  - 10 diagnostic rules (`OBJ1001`–`OBJ5006`) detecting syntax errors, 0-based index misuse, out-of-range vertex/texcoord/normal references, faces with $<3$ vertices, degenerate zero-area faces, undefined material bindings, out-of-range MTL color components, and non-manifold edges.
- **Cleanroom Standard Library (`@modelscript/obj-std-lib`)**:
  - Built-in Wavefront OBJ geometric primitives and engineering MTL materials (`Aluminum`, `Steel`, `Copper`, `Glass`, `MatteWhite`) backed by an AssemblyScript WASM geometry/shading kernel.
- **Interactive 3D SVG Viewer & React Panel (`renderObjMeshSvg`, `ObjPanel`)**:
  - Pure SVG isometric/orthographic shaded 3D mesh renderer with painter's algorithm depth sorting, Lambertian/Blinn-Phong MTL shading, wireframe overlay, and material swatch legend.

---

## Package Structure

| Path                               | Description                                                                 |
| :--------------------------------- | :-------------------------------------------------------------------------- |
| `src/index.ts`                     | Public package exports                                                      |
| `src/language.ts`                  | `objLanguage` WASM GLR grammar, file extensions (`.obj`, `.mtl`), UI panel  |
| `src/types.ts`                     | Core TypeScript interfaces (`ObjDocument`, `MtlDocument`, `ObjFace`, etc.)  |
| `src/errors.ts`                    | `ObjErrorCode` (`OBJ1001`–`OBJ5006`) diagnostic definitions                 |
| `src/parser/`                      | `parseObj`, `parseMtl`, `parseObjWithMtl` parsers                           |
| `src/lints/index.ts`               | `lintObj`, `lintMtl` mesh topology & material linter                        |
| `src/solver/index.ts`              | Fan triangulation, smooth normals, bounding box, area, signed volume, Euler |
| `src/cad/index.ts`                 | `lowerObjToCad` to `@modelscript/cad` `PolyhedronSolid` & `Assembly`        |
| `src/dae/index.ts`                 | `lowerObjToDae`, `objToDae` rigid-body inertia lowering to `DAEBuilder`     |
| `src/projections/index.ts`         | `objToAsciiStl`, `objToBinaryStl`, `objToStep`, `objToUsd`                  |
| `src/catalog/obj-std-schemas.ts`   | Cleanroom OBJ primitive & MTL material schemas                              |
| `assets/obj-std-lib/src/models.ts` | AssemblyScript WASM geometry & shading kernel                               |
| `src/diagram/index.ts`             | `renderObjMeshSvg` pure SVG shaded 3D mesh renderer                         |
| `src/ui/ObjPanel.tsx`              | Interactive React + SVG 3D mesh & material viewer/editor panel              |
| `src/indexing.ts`                  | `objIndexing` UnifiedWorkspace indexer                                      |
| `src/lsp.ts`                       | `validateObj`, `getObjDocumentSymbols`, `getObjHover`, `getObjCompletions`  |

---

## Lint Rules

| Code    | Rule                          | Severity | Description                                                       |
| :------ | :---------------------------- | :------- | :---------------------------------------------------------------- |
| OBJ1001 | `syntax-error`                | error    | Malformed Wavefront OBJ or MTL directive                          |
| OBJ2001 | `zero-index`                  | error    | Zero index used in face/line/point (Wavefront OBJ is 1-based)     |
| OBJ2002 | `vertex-index-out-of-range`   | error    | Vertex index `v` in `f` references a non-existent vertex          |
| OBJ2003 | `texcoord-index-out-of-range` | error    | Texture coordinate index `vt` in `f` references a non-existent UV |
| OBJ2004 | `normal-index-out-of-range`   | error    | Vertex normal index `vn` in `f` references a non-existent normal  |
| OBJ3001 | `face-too-few-vertices`       | error    | Face directive `f` has fewer than 3 vertices                      |
| OBJ3002 | `degenerate-face`             | warning  | Degenerate face with zero surface area                            |
| OBJ4001 | `undefined-material`          | warning  | `usemtl` references a material not defined in the provided MTL    |
| OBJ4002 | `mtl-color-out-of-range`      | warning  | MTL color component (`Ka`, `Kd`, `Ks`, `Ke`) outside `[0, 1]`     |
| OBJ5006 | `non-manifold-edge`           | warning  | Edge shared by more than 2 faces (non-manifold mesh topology)     |

---

## CLI & Toolchain Integration

```bash
# Validate and lint Wavefront OBJ / MTL files
msx lint sample.obj

# Run package test suite (8 suites, Beta maturity)
pnpm --filter @modelscript/obj test
```

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="obj" />
