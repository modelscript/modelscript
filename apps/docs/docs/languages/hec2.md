---
title: "USACE HEC-2 (.hc2)"
description: "1D Standard Step open-channel water surface profile solver"
---

# USACE HEC-2 (`.hc2`)

**Package:** `@modelscript/hec2` · **Maturity:** `Beta` · **Extensions:** `.hc2`

US Army Corps of Engineers **HEC-2** (_Water Surface Profiles_, Hydrologic Engineering Center, 1960s–1970s) open-channel hydraulics card-deck language package for ModelScript (**Beta** tier).

## Capabilities

- **DSL & Native WASM GLR Parser (`src/language.ts`, `src/parser/`)**: Declarative `@modelscript/dsl` grammar compiled to `dist/parser.wasm` plus dual fixed-format (classic 8-column Fortran punch-card layout) and free-format (comma/whitespace-delimited) HEC-2 deck parser supporting `T1`–`T3`, `J1`–`J6`, `NC`, `NH`, `NV`, `QT`, `X1`–`X5`, `GR`, `SB`, `BT`, `CI`, `EJ`, `ER`, and `C ` comment cards.
- **Hydraulic Lints (`src/errors.ts`, `src/lints/`)**: Diagnostic rules `HEC21001`–`HEC25006` covering syntax errors, missing `J1`/`EJ`/`ER` cards, non-positive Manning's $n$, `GR`/`X1` `NUMST` point count mismatches, non-monotonic station coordinates, out-of-bounds bank stations `STCHL`/`STCHR`, negative reach lengths, and non-positive discharge.
- **1D Standard Step Solver (`src/solver/`)**: Subdivided Manning conveyance ($K = \frac{\phi}{n} A R^{2/3}$), velocity weighting $\alpha$, Froude number, critical depth $y_c$, normal depth $y_n$, and 1D Standard Step Energy Equation ($WSE_2 + \alpha_2 V_2^2/2g = WSE_1 + \alpha_1 V_1^2/2g + h_e$) gradually-varied flow profile solver for both US Customary ($\phi = 1.486$, $g = 32.174\text{ ft/s}^2$) and SI ($\phi = 1.0$, $g = 9.80665\text{ m/s}^2$) units.
- **DAE Arena Lowering (`src/dae/`)**: Direct lowering of steady 1D Saint-Venant energy and continuity equations into `@modelscript/runtime` `DAEBuilder` linear memory.
- **Projections (`src/projections/`)**: Export HEC-2 card decks to modern HEC-RAS `.g01`/`.f01` files and Modelica steady hydraulics models.
- **Cleanroom Standard Library (`src/catalog/`, `assets/hec2-std-lib/`)**: Chow (1959) / USACE Manning's $n$ roughness schemas and bridge/culvert contraction & expansion loss schemas with cleanroom SVG icons and AssemblyScript `runtime.wasm`.
- **Workspace Indexing & LSP (`src/indexing.ts`, `src/lsp.ts`)**: Document symbols, diagnostics, hover documentation, card-code completions, and `UnifiedWorkspace` integration.

## Usage

```bash
npm run build --workspace=@modelscript/hec2
npm test --workspace=@modelscript/hec2
```

---

## CLI & Toolchain Integration

```bash
# Validate and lint USACE HEC-2 models
msx lint model.hc2

# Run package test suite (8 suites, Beta maturity)
pnpm --filter @modelscript/hec2 test
```
