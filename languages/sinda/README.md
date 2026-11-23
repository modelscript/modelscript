<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/sinda`

ModelScript **Beta** language support for **SINDA / SINDA-FLUINT** (NASA Systems Improved Numerical Differencing Analyzer — Lumped-Parameter Thermal Network Analyzer).

## Features

- **Native WASM GLR Parser (`sindaLanguage`)**: Declarative `@modelscript/dsl` grammar compiled to WebAssembly (`dist/parser.wasm`) supporting `HEADER OPTIONS DATA`, `HEADER NODE DATA`, `HEADER CONDUCTOR DATA`, `HEADER CONSTANTS DATA`, `HEADER ARRAY DATA`, `HEADER SOURCE DATA`, `HEADER EXECUTION`, `HEADER VARIABLES 1`, `HEADER VARIABLES 2`, `HEADER OUTPUT CALLS`, `END OF DATA`, and `C` / `$` comments.
- **Static Thermal Network Linter (`SIN1001`–`SIN5006`)**: Validates syntax, duplicate node/conductor IDs, undefined node references, self-loop conductors, negative capacitances/conductances, floating/disconnected thermal subnetworks without boundary nodes, invalid radiation temperatures ($\le 0\,\mathrm{K}$), and missing `END OF DATA`.
- **Linear-Memory DAE Lowering**: Directly lowers lumped-parameter thermal RC and Stefan-Boltzmann radiation networks ($\sigma G_{ij}(T_i^4 - T_j^4)$) into `@modelscript/runtime`'s `DAEBuilder`.
- **Steady-State & Transient Thermal Solvers**:
  - `STDSTL`: Analytical-Jacobian Newton-Raphson steady-state solver for linear and nonlinear radiative thermal networks.
  - `CRANKN` / `FWDBCK`: Implicit Crank-Nicolson transient integrator with per-step Newton-Raphson for stiff and radiative networks.
  - `RK4`: 4th-order Runge-Kutta explicit transient integrator.
- **Modelica Projection**: Translates SINDA thermal networks to `Modelica.Thermal.HeatTransfer` (`HeatCapacitor`, `FixedTemperature`, `ThermalConductor`, `BodyRadiation`, `FixedHeatFlow`).
- **Cleanroom Standard Library (`@modelscript/sinda-std-lib`)**: Zero-I/O registered schemas, SVG icons, and AssemblyScript `runtime.wasm` for SINDA solver routines (`STDSTL`, `FWDBCK`, `CRANKN`, `SNFR`) and spacecraft thermal materials (`AL_6061`, `TI_6AL_4V`, `MLI`, `KAPTON`, `BLACK_ANODIZE`, `OSR`).
- **Unified Indexing & LSP**: Document symbols, diagnostics, hover documentation, and completions.
