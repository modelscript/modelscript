---
title: "AutoCAD DXF (.dxf)"
description: "Drawing Exchange Format 2D/3D CAD entities & INSERT blocks"
---

# AutoCAD DXF (`.dxf`)

**Package:** `@modelscript/dxf` · **Maturity:** `Beta` · **Extensions:** `.dxf`

**AutoCAD DXF (Drawing Exchange Format, 1982)** compiler, linter, CAD/geometry lowering engine, SVG/STEP projector, cleanroom standard library, and LSP integration for ModelScript (**Beta** tier).

## Capabilities

- **Native WASM GLR Parser (`@modelscript/dsl`)**: Formal grammar (`dxfLanguage`) for ASCII DXF group-code/value pairs covering `HEADER`, `TABLES` (`LAYER`), `BLOCKS` (`BLOCK`/`ENDBLK`), `ENTITIES`, `OBJECTS`, and `EOF`.
- **Full Entity Coverage**: `LINE`, `ARC`, `CIRCLE`, `LWPOLYLINE` (including bulge arcs), `POLYLINE`/`VERTEX`/`SEQEND`, `SPLINE`, `ELLIPSE`, `3DFACE`, `POINT`, `TEXT`/`MTEXT`, and hierarchical `INSERT` block references.
- **Static Linting (`DXF1001`–`DXF5006`)**: Validates syntax/group codes, unclosed `SECTION`/`BLOCK`/`POLYLINE`, missing `EOF`, undefined layers/blocks, cyclic `INSERT` chains, zero-radius `CIRCLE`/`ARC`, degenerate `LWPOLYLINE`/`3DFACE`/`ELLIPSE`, and invalid `$INSUNITS`.
- **CAD & Geometry Lowering**: Flattens hierarchical `INSERT` transforms (base point, scale, rotation, translation), computes analytical path lengths, exact bulge arc geometry, enclosed polygon areas, 3D bounding boxes, `3DFACE` triangle meshes, and `@modelscript/cad` extruded/polyhedral `Assembly` solids.
- **Projections**: Standalone SVG (`dxfToSvg`) with AutoCAD Color Index (ACI) styling and ISO 10303-21 STEP (`dxfToStep`) via `@modelscript/cad`.
- **Cleanroom Standard Library**: Entity schemas (`LINE`, `ARC`, `CIRCLE`, `LWPOLYLINE`, `SPLINE`, `ELLIPSE`, `3DFACE`, `INSERT`), ACI color/layer presets, SVG block icons, and AssemblyScript `runtime.wasm` geometry kernel.
- **UnifiedWorkspace Indexing & LSP**: Document symbols, hover cards, completions, and diagnostic ranges.

## Quick Usage

```ts
import { parseDxf, lintDxf, analyzeDxfGeometry, lowerDxfToCad, dxfToSvg, dxfToStep } from "@modelscript/dxf";

const doc = parseDxf(dxfSource);
const diagnostics = lintDxf(doc);
const metrics = analyzeDxfGeometry(doc);
const svg = dxfToSvg(doc);
const step = dxfToStep(doc, { extrusionHeight: 10 });
```

---

## CLI & Toolchain Integration

```bash
# Validate and lint AutoCAD DXF models
msx lint model.dxf

# Run package test suite (8 suites, Beta maturity)
pnpm --filter @modelscript/dxf test
```
