---
title: "LS-DYNA / DYNA3D (.k)"
description: "Explicit dynamics finite-element keyword deck & CFL solver"
---

# LS-DYNA / DYNA3D (`.k`)

**Package:** `@modelscript/lsdyna` · **Maturity:** `Beta` · **Extensions:** `.k`

LS-DYNA / DYNA3D (`.k`, `.key`, `.dyn`) Explicit Dynamics Keyword Deck language package for ModelScript (**Beta** tier).

## Capabilities

- **Native WASM GLR Parser (`src/language.ts`)**: Declarative `@modelscript/dsl` grammar compiled to `dist/parser.wasm` + `src-gen/bindings.{js,d.ts}` covering `*KEYWORD`, `*TITLE`, `*NODE`, `*ELEMENT_SOLID`, `*ELEMENT_SHELL`, `*ELEMENT_BEAM`, `*PART`, `*SECTION_*`, `*MAT_*`, `*BOUNDARY_SPC_*`, `*INITIAL_VELOCITY`, `*LOAD_NODE_POINT`, `*DEFINE_CURVE`, `*SET_NODE_LIST`, `*CONTROL_TERMINATION`, `*CONTROL_TIMESTEP`, `*DATABASE_GLSTAT`, `*END`, and `$` comments.
- **Fixed-Column & Free-Format Deck Parser (`src/parser/`)**: Parses both traditional 10-character fixed-width cards and comma-delimited free-format LS-DYNA keyword decks.
- **Static Analysis & Linting (`src/errors.ts`, `src/lints/`)**: `LSD1001`–`LSD5006` diagnostics for syntax, missing `*KEYWORD`/`*END`, duplicate IDs, dangling node/part/section/material references, physical material bounds ($E > 0$, $\rho > 0$, $-1 < \nu < 0.5$), missing `*CONTROL_TERMINATION`, and CFL critical timestep checks.
- **Explicit Central-Difference Solver (`src/solver/`)**: Lumped-mass explicit finite-element solver for 1D axial bars, spring-mass systems, and 3D truss/beam/solid structures with CFL timestep calculation ($\Delta t_{cr} = L_e / c$) and kinetic/internal/total energy tracking.
- **Linear-Memory DAE Lowering (`src/dae/`)**: Lowers structural dynamics equations ($M\ddot{u} + Ku = F$) directly into ModelScript's zero-GC `DAEBuilder`.
- **Cross-Language Projections (`src/projections/`)**: Projects LS-DYNA decks to Abaqus `.inp` and Modelica `.mo`.
- **Cleanroom Standard Library (`src/catalog/`, `assets/lsdyna-std-lib/`)**: `@modelscript/lsdyna-std-lib` with cleanroom SVG icons and AssemblyScript WASM constitutive/section runtime (`MAT_001`, `MAT_003`, `MAT_020`, `MAT_024`, `SECTION_SOLID`, `SECTION_SHELL`, `SECTION_BEAM`).
- **Workspace Indexing & LSP (`src/indexing.ts`, `src/lsp.ts`)**: Unified workspace symbol indexing, diagnostics, document symbols, hover, and keyword completions.

## Commands

```bash
npm run build
npm run typecheck
npm run lint
npm test
```

---

## CLI & Toolchain Integration

```bash
# Validate and lint LS-DYNA / DYNA3D models
msx lint model.k

# Run package test suite (8 suites, Beta maturity)
pnpm --filter @modelscript/lsdyna test
```

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="lsdyna" />
