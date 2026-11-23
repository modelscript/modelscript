<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/cea`

NASA **CEA** (_Chemical Equilibrium with Applications_, Gordon & McBride / NASA RP-1311) language frontend, WebAssembly GLR parser, Gibbs free-energy minimization solver, 1D isentropic rocket nozzle & CJ detonation analyzer, linear-memory DAE lowering, cleanroom NASA-7/NASA-9 standard library, and polyglot projections for ModelScript.

## Features

- **WASM GLR Parser (`@modelscript/dsl`)**: Declarative grammar for NASA CEA problem decks (`problem`, `reactants`, `only`, `omit`, `insert`, `output`, `end`, `#`/`!` comments).
- **Pre-flight Lints (`CEA1001`–`CEA5006`)**: Validates problem types, reactant species, positive pressure/temperature/expansion ratios, non-negative `o/f` and `phi`, fuel/oxidizer weight percentage totals, and `only`/`omit` conflicts.
- **Gibbs Equilibrium & Propulsion Solver**:
  - Newton-Raphson Lagrange-multiplier Gibbs free-energy minimization (`tp`, `hp`, `sp`, `uv`, `tv`, `sv`).
  - 1D isentropic rocket nozzle expansion (`equilibrium` & `frozen`) computing $T_c$, $\gamma$, $M_w$, $c^*$, $C_F$, $I_{sp,\text{vac}}$, and $I_{sp,\text{sl}}$.
  - Chapman-Jouguet (`deton`) detonation velocity and post-shock state solver.
- **Cleanroom Standard Library (`@modelscript/cea-std-lib`)**: 17 NASA-7/NASA-9 thermodynamic species (`H2`, `O2`, `H2O`, `OH`, `H`, `O`, `CH4`, `CO`, `CO2`, `N2`, `NO`, `RP-1`, `N2O4`, `MMH`, `UDMH`, `He`, `Ar`) with cleanroom SVG icons and AssemblyScript WASM thermodynamic evaluator.
- **Linear-Memory DAE Lowering**: Compiles equilibrium element balances, enthalpy/entropy constraints, and rocket nozzle equations directly into `DAEBuilder`.
- **Polyglot Projections**: Exports CEA decks and solutions to Cantera YAML, Modelica, and NASA ROCETS decks.
- **UnifiedWorkspace Indexing & LSP**: Document symbols, hover cards, completions, and diagnostics.

## Usage

```bash
npm run build
npm run typecheck
npm run lint
npm test
```
