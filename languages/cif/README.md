<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/cif`

Caltech Intermediate Form 2.0 (CIF, 1979) IC Mask Layout language package for ModelScript (**Beta** tier).

## Features

- **WASM GLR Parser (`@modelscript/dsl`)**: Declarative grammar (`cifLanguage`) compiled to `dist/parser.wasm` + `src-gen/bindings.{js,d.ts}` supporting all CIF 2.0 commands (`DS`, `DF`, `DD`, `C` with `T`/`MX`/`MY`/`R` transforms, `L`, `B`, `P`, `R`, `W`, `0`–`9` user extensions, `E`, and nested `( ... )` comments).
- **Lints & DRC (`CIF1001`–`CIF5006`)**: Structural validation, call-graph cycle detection, missing layer checks, non-positive geometry checks, and MOSIS SCMOS / Mead-Conway lambda minimum-width DRC.
- **CAD & Geometry Lowering**: Hierarchical symbol flattening with exact `a/b` rational scaling and 2D affine transforms (`T`, `MX`, `MY`, `R`) into flat polygons, bounding boxes, per-layer areas, and 3D `@modelscript/cad` layer-stack assemblies.
- **Parasitic RC DAE Lowering**: Lowers mask layer areas and perimeters into `@modelscript/runtime` `DAEBuilder` parasitic capacitance, resistance, and Elmore RC dynamics.
- **Projections**: Exports CIF layouts to GDSII GDT (Graphical Data Text) and color-coded MOSIS SCMOS SVG schematics.
- **Cleanroom Standard Library**: Built-in `@modelscript/cif-std-lib` with MOSIS SCMOS layers (`CAA`, `CPG`, `CCA`, `CMF`, `CVA`, `CMS`, `CWN`) and Mead-Conway lambda design rules compiled with an AssemblyScript WASM kernel.
- **Indexing & LSP**: UnifiedWorkspace indexing (`cifIndexing`), diagnostics, document symbols, hover tooltips, and domain actions.

## Development

```bash
npm run build
npm run typecheck
npm run lint
npm test
```
