---
title: "Gerber RS-274-D/X (.gbr)"
description: "PCB photoplotter aperture/arc/region geometry & IPC-2221 DFM"
---

# Gerber RS-274-D/X (`.gbr`)

**Package:** `@modelscript/gerber` · **Maturity:** `Beta` · **Extensions:** `.gbr`

Gerber **RS-274-D** & **RS-274X** (Extended Gerber) PCB photoplotter language support for ModelScript (1960s–1970s legacy and modern extended Gerber X2).

## Capabilities

- **Native WASM GLR Parser (`src/language.ts`, `dist/parser.wasm`)**: Declarative `@modelscript/dsl` grammar covering RS-274-D and RS-274X commands (`G01`/`G02`/`G03`, `G04`, `G36`/`G37`, `G70`/`G71`, `G74`/`G75`, `G90`/`G91`, `D01`/`D02`/`D03`, `D10+`, `M02`, and extended parameters `%FS`, `%MO`, `%AD`, `%AM`, `%LP`, `%SR`, `%TF`, `%TA`, `%TD`).
- **DFM & Semantic Linting (`src/errors.ts`, `src/lints/`)**: Diagnostics `GRB1001`–`GRB5006` for syntax errors, missing `%FS`/`%MO`, undefined apertures, draw/flash before aperture selection, unclosed `G36`/`G37` regions, missing `M02`, and IPC-2221 minimum trace width / annular ring violations.
- **Exact 2D CAD Geometry & 3D Extrusion (`src/cad/`)**: Lowers strokes, single/multi-quadrant circular arcs, flashed pads (`C`, `R`, `O`, `P`, holes), `%LP` polarity, `%SR` step-and-repeat arrays, and `G36`/`G37` filled regions to exact 2D geometry (bounding box, copper area, trace length, pad count) and `@modelscript/cad` 3D copper solids.
- **DAE Electrical Lowering (`src/dae/`)**: Lowers copper trace resistance (IPC-2221 temperature-dependent annealed copper resistivity) and trace-to-plane capacitance directly into `@modelscript/runtime`'s linear-memory `DAEBuilder`.
- **SVG & DXF Projections (`src/projections/`)**: Exports Gerber layers to standalone SVG and ASCII AutoCAD DXF.
- **Cleanroom Standard Library (`src/catalog/`, `assets/gerber-std-lib/`)**: Standard aperture primitives (`C`, `R`, `O`, `P`, thermal relief, moire) and IPC-2221 trace/via/copper/substrate presets with AssemblyScript WASM runtime.
- **Workspace Indexing & LSP (`src/indexing.ts`, `src/lsp.ts`)**: UnifiedWorkspace symbol indexing, diagnostics, document symbols, hover documentation, and completions.

---

## CLI & Toolchain Integration

```bash
# Validate and lint Gerber RS-274-D/X models
msx lint model.gbr

# Run package test suite (8 suites, Beta maturity)
pnpm --filter @modelscript/gerber test
```

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="gerber" />
