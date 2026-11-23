---
title: "SCALE / KENO / ORIGEN (.scale)"
description: "ORNL Bateman isotope depletion & KENO criticality geometry"
---

# SCALE / KENO / ORIGEN (`.scale`)

**Package:** `@modelscript/scale` · **Maturity:** `Beta` · **Extensions:** `.scale`

ModelScript **Beta**-tier language implementation for **ORNL SCALE / KENO V.a–VI / ORIGEN** nuclear criticality safety and isotope depletion decks (1960s–1980s heritage).

## Capabilities

- **Native WASM GLR Parser (`@modelscript/dsl`)**: Formal grammar supporting SCALE sequences (`=csas6`, `=csas5`, `=origen`, `=t-depl`, `=triton`), `read comp`, `read celldata`, `read param`, `read geom` (KENO `unit`, `global unit`, `cylinder`, `sphere`, `cuboid`, `hexprism`, `media`, `array`, `hole`, `boundary`), `read bounds`, ORIGEN `case`/`lib`/`mat`/`time`/`power`/`flux`/`save` blocks, and `'` line comments.
- **Static Linting (`SCL1001`–`SCL5006`)**: Validates syntax, known sequences, duplicate mixture/unit/array IDs, undefined mixture/unit references, missing `global unit`, physical parameter bounds (density, temperature, enrichment), unclosed `read ... end` blocks, and ORIGEN irradiation step validity.
- **Bateman Depletion DAE Lowering & Solver**: Lowers ORIGEN Bateman nuclide transmutation/decay ODEs directly into `@modelscript/runtime`'s linear-memory `DAEBuilder`, paired with a Padé matrix-exponential and RK4 Bateman inventory & decay-heat solver.
- **KENO CSG Geometry Builder (`@modelscript/cad`)**: Compiles KENO units, concentric `media` regions, `hole` placements, and `array` lattices into `@modelscript/cad` assemblies with exact analytical volume breakdown by mixture.
- **Cross-Language Projections**: Exports SCALE decks to Modelica 3.x Bateman ODE models and MCNP criticality input decks.
- **Cleanroom Standard Library (`@modelscript/scale-std-lib`)**: Pre-compiled zero-I/O library of standard SCALE compositions (`UO2`, `H2O`, `SS304`, `ZIRC4`, `B4C`, `MOX`) and actinide/fission-product nuclide decay chains (`U-235`, `U-238`, `Pu-239`, `Xe-135`, `I-135`, `Cs-137`, `Sr-90`).
- **Workspace Indexing & LSP**: Diagnostics, document symbols, hover tooltips, and language actions.

## Usage

```bash
npm run build --workspace=@modelscript/scale
npm run test --workspace=@modelscript/scale
```

---

## CLI & Toolchain Integration

```bash
# Validate and lint SCALE / KENO / ORIGEN models
msx lint model.scale

# Run package test suite (8 suites, Beta maturity)
pnpm --filter @modelscript/scale test
```

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="scale" />
