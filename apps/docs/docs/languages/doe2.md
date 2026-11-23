---
title: "DOE-2 BDL (.bdl)"
description: "LBNL Building Description Language envelope & HVAC load solver"
---

# DOE-2 BDL (`.bdl`)

**Package:** `@modelscript/doe2` · **Maturity:** `Beta` · **Extensions:** `.bdl`

DOE-2.1E / DOE-2.2 Building Description Language (BDL — LBNL, 1979) compiler, thermal envelope DAE lowering, ASHRAE heat-balance load solver, cleanroom standard library, and polyglot projections for ModelScript.

## Capabilities

- **Native WASM GLR Parser (`src/language.ts`, `src/parser/`)**: Parses DOE-2.1E/2.2 BDL decks (`INPUT LOADS`/`SYSTEMS`/`PLANT`/`ECONOMICS`, `TITLE`, `RUN-PERIOD`, `BUILDING-LOCATION`, `MATERIAL`, `LAYERS`, `CONSTRUCTION`, `GLASS-TYPE`, `DAY-SCHEDULE`, `WEEK-SCHEDULE`, `SCHEDULE`, `SPACE`, `EXTERIOR-WALL`, `ROOF`, `UNDERGROUND-WALL`, `WINDOW`, `DOOR`, `ZONE`, `SYSTEM`, `PLANT-EQUIPMENT`, `COMPUTE`, `STOP`, `..` terminators, `$` comments).
- **Linter & Diagnostics (`src/errors.ts`, `src/lints/`)**: Validates syntax, missing `..` terminators, duplicate object names, undefined `LAYERS`/`MATERIAL`/`CONSTRUCTION`/`GLASS-TYPE`/`SPACE` references, non-positive physical properties, schedule bounds, and missing `STOP` (`DOE1001`–`DOE5006`).
- **Linear-Memory DAE Lowering (`src/dae/`)**: Lowers multi-layer wall U-values, 3R2C envelope thermal capacitance, infiltration, solar gains, internal loads, and zone HVAC control directly into `DAEBuilder` (`@modelscript/runtime`).
- **ASHRAE Heat-Balance Load & HVAC Solver (`src/solver/`)**: Computes composite wall R/U-values, steady-state heating/cooling loads ($Q = (UA + \dot{m}c_p)\Delta T$), and transient 24-hour zone temperature and HVAC energy responses.
- **Cleanroom Standard Library (`src/catalog/`, `assets/doe2-std-lib/`)**: ASHRAE/DOE-2 materials (`MAT-CONCRETE`, `MAT-INSUL-R19`, `MAT-GYPSUM`, `MAT-BRICK`), glazing (`GLZ-DOUBLE-LOWE`), and HVAC systems (`PSZ`, `VAVS`, `PIU`, `FC`, `PTAC`) compiled with AssemblyScript WASM runtime and SVG block icons.
- **Projections (`src/projections/`)**: Exports DOE-2 BDL models to EnergyPlus IDF and Modelica `Modelica.Thermal.HeatTransfer` networks.
- **Workspace Indexing & LSP (`src/indexing.ts`, `src/lsp.ts`)**: Diagnostics, document symbols, hover tooltips, and code actions.

---

## CLI & Toolchain Integration

```bash
# Validate and lint DOE-2 BDL models
msx lint model.bdl

# Run package test suite (8 suites, Beta maturity)
pnpm --filter @modelscript/doe2 test
```

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="doe2" />
