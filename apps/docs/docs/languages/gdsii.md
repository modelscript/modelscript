---
title: "GDSII (.gds)"
description: "Calma GDSII binary stream & GDT IC mask layout & DRC"
---

# GDSII (`.gds`)

**Package:** `@modelscript/gdsii` · **Maturity:** `Beta` · **Extensions:** `.gds`

ModelScript **Beta** language package for **GDSII** (Calma Graphic Design System II IC Layout Stream Format, 1978).

## Capabilities

- **WASM GLR Parser & GDT/ASCII Stream Parser**: Declarative `@modelscript/dsl` grammar (`gdsiiLanguage`) compiled to `dist/parser.wasm` plus structured GDT/ASCII parser supporting `HEADER`, `BGNLIB`, `LIBNAME`, `UNITS`, `BGNSTR`, `STRNAME`, `BOUNDARY`, `PATH`, `SREF`, `AREF`, `TEXT`, `LAYER`, `DATATYPE`, `WIDTH`, `XY`, `SNAME`, `STRANS`, `MAG`, `ANGLE`, `COLROW`, `ENDEL`, `ENDSTR`, `ENDLIB`.
- **Binary GDSII Stream Codec**: Full binary `.gds` / `.gds2` record encoder and decoder including IBM System/360 8-byte floating-point (`Real64`) conversion.
- **Lints & DRC Engine**: `GDS1001`–`GDS5006` diagnostics covering stream syntax, unclosed `BOUNDARY` polygons, unresolved `SREF`/`AREF` references, cyclic cell hierarchies, invalid layer/datatype bounds, zero-area degenerate polygons, and geometric DRC minimum-width and minimum-spacing checks.
- **CAD/Geometry Lowering & 3D Layer Stack**: Flattens hierarchical `SREF`/`AREF` structures into 2D polygons with area and bounding-box computation, and extrudes CMOS layer stacks to `@modelscript/cad` 3D solids.
- **Parasitic RC DAE Lowering**: Extracts interconnect sheet resistance, area/fringe capacitance, Elmore delay, and node ODEs directly into `@modelscript/runtime`'s `DAEBuilder`.
- **Projections**: Exports GDSII libraries to Caltech Intermediate Form (CIF) and layered SVG.
- **Cleanroom CMOS Standard Library**: Built-in foundry layer-map presets (`NWELL`, `ACTIVE`, `POLY`, `CONTACT`, `METAL1`, `VIA1`, `METAL2`) and standard cells (`INV`, `NAND2`) with AssemblyScript WASM kernels.
- **UnifiedWorkspace Indexing & LSP**: Document symbols, hover cards, completions, and live DRC diagnostics.

---

## CLI & Toolchain Integration

```bash
# Validate and lint GDSII models
msx lint model.gds

# Run package test suite (8 suites, Beta maturity)
pnpm --filter @modelscript/gdsii test
```
