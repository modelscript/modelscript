---
title: "MELCOR (.mel)"
description: "Sandia severe accident thermal-hydraulics & core degradation"
---

# MELCOR (`.mel`)

**Package:** `@modelscript/melcor` · **Maturity:** `Beta` · **Extensions:** `.mel`

**MELCOR** (Sandia National Laboratories Nuclear Severe Accident Analysis Deck, 1982) language frontend, WebAssembly GLR parser, static linter, linear-memory DAE lowering, severe-accident thermal-hydraulic/core-heatup/oxidation solver, cleanroom standard library, and Modelica/RELAP5 projections for ModelScript.

## Maturity Tier

- **Tier:** `beta`
- **Category:** `language`
- **File Extensions:** `.mel`, `.melcor`, `.mci`, `.inp`

## Supported MELCOR Packages

- `MELGEN_INPUT` / `MELCOR_INPUT` / `END` deck wrappers and `TITLE`
- `EXEC_INPUT` — execution time bounds (`EXEC_TEND`, `EXEC_DTMAX`, `EXEC_DTMIN`, `EXEC_DT`)
- `CVH_INPUT` — control volume hydrodynamics (`CV_ID`, `CV_THR`, `CV_PAS`, `CV_TY`, `CV_VAT`)
- `FL_INPUT` — flow paths (`FL_ID`, `FL_FT`, `FL_GEO`, `FL_USL`)
- `HS_INPUT` — heat structures (`HS_ID`, `HS_GD`, `HS_LB`, `HS_RB`, `HS_TEMP`)
- `COR_INPUT` — core degradation, decay heat & Zircaloy-steam oxidation (`COR_RP`, `COR_ZDF`, `COR_PWR`, `COR_OX`)
- `RN1_INPUT` — radionuclide / fission product release & aerosol classes
- `CF_INPUT` — control functions (`CF_ID`, `CF_ARG`, `CF_SAI`)
- `TF_INPUT` — tabular functions (`TF_ID`, `TF_TAB`)
- `MP_INPUT` & `NCG_INPUT` — material properties and non-condensable gases

## Architecture

- **WASM GLR Parser (`src/language.ts`, `src/parser/`):** Declarative `@modelscript/dsl` grammar compiled to `dist/parser.wasm` + `src-gen/bindings.{js,d.ts}`.
- **Lints (`src/errors.ts`, `src/lints/`):** Pre-flight diagnostics `MEL1001`–`MEL5006` covering syntax, duplicate IDs, dangling CV references, non-positive geometry/thermodynamics, cyclic control functions, and missing execution time bounds.
- **DAE Lowering (`src/dae/`):** Direct linear-memory lowering of CVH mass/energy balances, FL momentum, HS thermal nodes, and COR decay-heat ODEs into `DAEBuilder`.
- **Transient Solver (`src/solver/`):** Coupled compressible blowdown, adiabatic/convective core decay-heat heatup, and Urbanic-Heidrick / Cathcart-Pawel parabolic Zircaloy-steam oxidation & $\text{H}_2$ generation kinetics.
- **Cleanroom Standard Library (`src/catalog/`, `assets/melcor-std-lib/`):** Schemas, SVG block icons, and AssemblyScript WASM runtime for MELCOR packages and PWR/BWR severe-accident materials (`UO2`, `Zircaloy-4`, `SS304`, `H2`, `N2`, `H2O`).
- **Projections (`src/projections/`):** Cross-language export to Modelica 3.x and US NRC RELAP5-3D card decks.
- **LSP & Indexing (`src/indexing.ts`, `src/lsp.ts`):** UnifiedWorkspace symbol indexing, diagnostics, document symbols, hover, and completions.

## Usage

```bash
npm run build --workspace=@modelscript/melcor
npm run typecheck --workspace=@modelscript/melcor
npm run lint --workspace=@modelscript/melcor
npm test --workspace=@modelscript/melcor
```

---

## CLI & Toolchain Integration

```bash
# Validate and lint MELCOR models
msx lint model.mel

# Run package test suite (8 suites, Beta maturity)
pnpm --filter @modelscript/melcor test
```

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="melcor" />
