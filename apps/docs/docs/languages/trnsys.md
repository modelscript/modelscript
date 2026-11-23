---
title: "TRNSYS (.dck)"
description: "Transient solar, thermal storage & building component decks"
---

# TRNSYS (`.dck`)

**Package:** `@modelscript/trnsys` · **Maturity:** `Beta` · **Extensions:** `.dck`

ModelScript **Beta**-tier language package for **TRNSYS** (Transient System Simulation Tool `.dck` Deck, 1975).

## Features

- **Native WASM GLR Parser (`src/language.ts`, `src/parser/`)**: Declarative `@modelscript/dsl` grammar compiled to `dist/parser.wasm` + `src-gen/bindings.{js,d.ts}` supporting TRNSYS `.dck` control cards (`VERSION`, `CONSTANTS`, `EQUATIONS`, `SIMULATION`, `TOLERANCES`, `LIMITS`, `DFQ`, `WIDTH`, `LIST`/`NOLIST`, `MAP`, `UNIT n TYPE m`, `PARAMETERS`, `INPUTS` with `unit,output` connections, `DERIVATIVES`, `ASSIGN`, `END`, and `*`/`!` comments).
- **Semantic Diagnostics (`src/errors.ts`, `src/lints/`)**: `TRN1001`–`TRN5006` covering syntax errors, duplicate `UNIT` numbers, undefined `UNIT` or out-of-range output references in `INPUTS`, `PARAMETERS`/`INPUTS` count mismatches, missing `SIMULATION`/`END` cards, invalid timesteps/time ranges, undefined variables in `EQUATIONS`, and algebraic loop detection.
- **Direct DAE Arena Lowering (`src/dae/`)**: Lowers solar collector (Hottel-Whillier-Bliss), stratified storage tank energy balance, controller/pump, forcing/weather, and building thermal zone ODEs directly into `@modelscript/runtime`'s `DAEBuilder`.
- **Transient Solver (`src/solver/`)**: Successive-substitution transient solver for coupled TRNSYS unit networks (`Type 1`, `Type 2`, `Type 3`, `Type 4`, `Type 14`, `Type 15`, `Type 25`, `Type 56`).
- **Cleanroom Standard Library (`src/catalog/`, `assets/trnsys-std-lib/`)**: `modelscript.yaml` package with schemas, parametric SVG icons, and AssemblyScript `runtime.wasm` for classic TRNSYS Types.
- **Projections (`src/projections/`)**: Modelica and EnergyPlus IDF code generation from parsed TRNSYS decks.
- **Unified Indexing & LSP (`src/indexing.ts`, `src/lsp.ts`)**: Workspace symbol indexing, diagnostics, document symbols, hover, and completions.

---

## CLI & Toolchain Integration

```bash
# Validate and lint TRNSYS models
msx lint model.dck

# Run package test suite (8 suites, Beta maturity)
pnpm --filter @modelscript/trnsys test
```
