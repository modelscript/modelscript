---
title: "MCNP (.mcnp)"
description: "Los Alamos Monte Carlo N-Particle CSG & k_eff transport"
---

# MCNP (`.mcnp`)

**Package:** `@modelscript/mcnp` · **Maturity:** `Beta` · **Extensions:** `.mcnp`

ModelScript **Beta**-tier language frontend, CSG geometry engine, cleanroom Monte Carlo neutron transport solver, DAE lowering pipeline, and LSP services for **MCNP** (Los Alamos Monte Carlo N-Particle Transport Deck).

## Features

- **Native WASM GLR Parser (`@modelscript/dsl`)**: Declarative grammar for MCNP 3-block card decks (title card, Cell cards with Boolean CSG `:`, space intersection, `#` complement, `IMP:N`/`IMP:P`, `VOL`, `U`/`FILL`; Surface cards `P`/`PX`/`PY`/`PZ`/`SO`/`S`/`SX`/`SY`/`SZ`/`C/X`/`C/Y`/`C/Z`/`CX`/`CY`/`CZ`/`K/Z`/`GQ`/`RPP`/`RCC`/`SPH`; Data cards `MODE`, `M<n>`, `MT<n>`, `SDEF`, `KCODE`, `KSRC`, `F1`/`F2`/`F4`/`F5`/`F6`/`F8`, `NPS`, `PHYS`; `C ` and `$` comments).
- **Static Linter (`MCNP1001`–`MCNP5006`)**: Validates syntax, duplicate IDs, undefined surfaces/materials/tally targets, graveyard cell importance (`IMP:N=0`), ZAID formatting, mixed atom/weight fraction signs, and source cards.
- **3D CSG Geometry & CAD (`src/cad/`)**: Analytic ray-surface intersection, point-in-cell Boolean CSG evaluator, exact & Monte Carlo volume calculation, and `@modelscript/cad` solid assembly builder.
- **Cleanroom Monte Carlo Solver (`src/solver/`)**: Seeded 1-group and 2-group 3D Monte Carlo $k_{\text{eff}}$ criticality (`KCODE`/`KSRC`) and fixed-source (`SDEF`/`NPS`) shielding attenuation solver.
- **Linear-Memory DAE Lowering (`src/dae/`)**: Lowers point-kinetics (6-group delayed neutron precursors) and cell flux-balance equations directly into `DAEBuilder`.
- **Cleanroom Standard Library (`@modelscript/mcnp-std-lib`)**: ENDF-like isotopic cross-sections (`1001` H-1, `5010` B-10, `6012` C-12, `8016` O-16, `26056` Fe-56, `92235` U-235, `92238` U-238, `94239` Pu-239), surface/tally archetypes, and AssemblyScript WASM runtime.
- **Projections & LSP (`src/projections/`, `src/lsp.ts`, `src/indexing.ts`)**: Modelica and OpenSCAD code generation, workspace indexing, diagnostics, document symbols, and hover documentation.

---

## CLI & Toolchain Integration

```bash
# Validate and lint MCNP models
msx lint model.mcnp

# Run package test suite (8 suites, Beta maturity)
pnpm --filter @modelscript/mcnp test
```
