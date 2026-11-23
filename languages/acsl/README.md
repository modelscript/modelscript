<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/acsl`

ModelScript Beta-tier language package for **ACSL** (Advanced Continuous Simulation Language, 1975).

## Features

- Native WebAssembly GLR parser (`@modelscript/dsl` → `dist/parser.wasm`) with linear-memory CST access.
- Comprehensive diagnostics (`ACSL1001`–`ACSL5006`) for section placement, integrator initialization, algebraic loops, and `SCHEDULE` targets.
- Direct `DAEBuilder` linear-memory lowering, RK4/Dormand-Prince hybrid ODE/event solver, and Modelica 3.x projection.
- Cleanroom standard library (`@modelscript/acsl-std-lib`) with 14 classic ACSL operators (`INTEG`, `REALPL`, `CMPXPL`, `LEDLAG`, `DELAY`, `PULSE`, `RAMP`, `STEP`, `BOUND`, `DEAD`, `QUANT`, `SW`, `ZHOLD`, `LIMINT`).
- Full LSP service (document symbols, hover, completion, diagnostics).
