<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/csmp`

ModelScript Beta-tier language package for **CSMP/360 & CSSL-67** (IBM Continuous System Modeling Program, 1967).

## Features

- Native WebAssembly GLR parser (`@modelscript/dsl` → `dist/parser.wasm`) supporting `INITIAL`/`DYNAMIC`/`TERMINAL`, `SORT`/`NOSORT`, `MACRO`/`ENDMAC`, `PROCEDURE`/`ENDPRO`, `FUNCTION` tables, and `INTGRL`.
- Diagnostics (`CSMP1001`–`CSMP5006`) including topological `SORT` algebraic-loop detection, `TIMER`, and `METHOD` validation.
- Direct `DAEBuilder` lowering, RK4/Milne/Adams/Trapezoidal integrators, and Modelica 3.x projection.
- Cleanroom standard library (`@modelscript/csmp-std-lib`) with 12 CSMP/360 functional blocks and AssemblyScript WASM runtime.
- Full LSP service (document symbols, hover, completion, diagnostics).
