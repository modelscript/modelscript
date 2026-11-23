---
title: "CHEMKIN (.ck)"
description: "Sandia gas-phase chemical kinetics & NASA-7 combustion solver"
---

# CHEMKIN (`.ck`)

**Package:** `@modelscript/chemkin` · **Maturity:** `Beta` · **Extensions:** `.ck`

ModelScript **Beta**-tier language package for **CHEMKIN** (Sandia National Laboratories Gas-Phase & Surface Chemical Kinetics Deck format, `.inp`, `.ck`, `.therm`).

## Capabilities

- **Native WebAssembly GLR Parser** (`src/language.ts`, `dist/parser.wasm`): Declarative `@modelscript/dsl` grammar supporting `ELEMENTS`/`ELEM`, `SPECIES`/`SPEC`, `THERMO` (NASA-7 14-coefficient 4-line records), `REACTIONS`/`REAC` (energy & quantity unit headers, `<=>`/`=`/`=>`, third-body `(+M)`/`+M`, `DUPLICATE`/`DUP`, `LOW`, `TROE`, `SRI`, `REV`, `PLOG`, enhanced efficiencies), `END`, and `!` comments.
- **Static Analysis & Linting** (`src/errors.ts`, `src/lints/`): `CK1001`–`CK5006` diagnostics for syntax errors, duplicate elements/species, undeclared species/elements, stoichiometric element balance violations, undeclared duplicate reactions, missing thermo records, invalid NASA-7 temperature ranges ($T_{\text{low}} < T_{\text{mid}} < T_{\text{high}}$), and negative Arrhenius pre-exponential factors.
- **Linear-Memory DAE Lowering** (`src/dae/`): Compiles Arrhenius, Lindemann, Troe, and reversible mass-action kinetics ($dY_k/dt = \dot{\omega}_k W_k / \rho$) and adiabatic energy balance directly into `@modelscript/runtime`'s `DAEBuilder`.
- **0D Adiabatic Batch Reactor Solver** (`src/solver/`): Constant-volume (isochoric) and constant-pressure (isobaric) stiff Rosenbrock23 ODE integrator with NASA-7 thermodynamic evaluation and equilibrium reverse rate consistency ($K_c = k_f / k_r$).
- **Cleanroom Standard Library** (`src/catalog/`, `assets/chemkin-std-lib/`): Zero-I/O registered IUPAC element atomic weights and cleanroom H2/O2/CH4 NASA-7 thermodynamic database (`H2`, `O2`, `H2O`, `OH`, `H`, `O`, `HO2`, `H2O2`, `CH4`, `CO`, `CO2`, `N2`) with AssemblyScript WASM runtime.
- **Projections** (`src/projections/`): Lossless translation to **Cantera YAML** and **Modelica**.
- **Workspace Indexing & LSP** (`src/indexing.ts`, `src/lsp.ts`): Document symbols, hover cards with NASA-7 properties, completions, and real-time diagnostics.

## Scripts

```bash
npm run build       # Build stdlib WASM + GLR parser WASM + TypeScript
npm run typecheck   # Type-check with tsc --noEmit
npm run lint        # Run ESLint over src/ and tests/
npm test            # Run full unit & analytical/combustion benchmark suite
```

---

## CLI & Toolchain Integration

```bash
# Validate and lint CHEMKIN models
msx lint model.ck

# Run package test suite (8 suites, Beta maturity)
pnpm --filter @modelscript/chemkin test
```
