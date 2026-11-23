---
title: "USACE HEC-1 (.hc1)"
description: "Flood hydrograph SCS CN, unit hydrograph & Muskingum routing"
---

# USACE HEC-1 (`.hc1`)

**Package:** `@modelscript/hec1` · **Maturity:** `Beta` · **Extensions:** `.hc1`

USACE **HEC-1** (Flood Hydrograph Package, 1968) card-deck language implementation for ModelScript at **Beta** tier.

## Features

- **Native WASM GLR Parser (`hec1Language`)**: Declarative `@modelscript/dsl` grammar compiled to `dist/parser.wasm` supporting all standard 2-character HEC-1 card codes (`ID`, `IT`, `IN`, `IO`, `KK`, `KM`, `KO`, `BA`, `PB`, `PI`, `PC`, `LU`, `LS`, `LE`, `UC`, `UD`, `US`, `BF`, `RM`, `RS`, `RD`, `HC`, `ZW`, `ZZ`, and `*` comment cards).
- **Fixed- & Free-Format Card Deck Parser**: Parses classic 8-column Fortran fixed-field card decks as well as comma- and whitespace-delimited free-format HEC-1 decks.
- **Static Linting & Validation (`HEC11001`–`HEC15006`)**: Validates time-interval and end cards, duplicate station IDs, positive drainage area, SCS Curve Number bounds, Muskingum weighting and stability ($\Delta t / (2K) \ge X$), precipitation presence, and `HC` combine topology.
- **Hydrologic Runoff & Routing Solver**:
  - SCS Curve Number rainfall-excess ($Q = (P - I_a)^2 / (P - I_a + S)$) with impervious area handling.
  - SCS Dimensionless (`UD`), Clark (`UC`), and Snyder (`US`) unit hydrograph convolution with exact volume conservation.
  - Multi-subreach Muskingum channel routing (`RM`) with exact mass conservation ($\int Q_{\text{out}}\,dt = \int Q_{\text{in}}\,dt$).
- **Linear-Memory DAE Arena Lowering**: Lowers watershed linear-reservoir storage ODEs, Muskingum channel routing ODEs, and hydrograph combine balances directly into `@modelscript/runtime`'s `DAEBuilder`.
- **Polyglot Projections**: Converts HEC-1 card decks into USACE HEC-HMS `.basin`/`.met` files and executable Modelica `.mo` models.
- **Cleanroom Standard Library (`@modelscript/hec1-std-lib`)**: TR-55 SCS Curve Number tables (Hydrologic Soil Groups A–D), Clark/Snyder/SCS UH archetypes, and Muskingum routing blocks with AssemblyScript WASM runtime and SVG block icons.
- **Workspace Indexing & LSP**: UnifiedWorkspace indexing, document symbols, diagnostics, hover docs, and card-code completions.

---

## CLI & Toolchain Integration

```bash
# Validate and lint USACE HEC-1 models
msx lint model.hc1

# Run package test suite (8 suites, Beta maturity)
pnpm --filter @modelscript/hec1 test
```

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="hec1" />
