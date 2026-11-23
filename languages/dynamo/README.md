<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/dynamo`

ModelScript Beta-tier language package for **DYNAMO** (MIT System Dynamics Language, 1959–1960s).

## Features

- Native WebAssembly GLR parser (`@modelscript/dsl` → `dist/parser.wasm`) supporting `L`/`R`/`A`/`N`/`C`/`T`/`S` equations, `.K`/`.J`/`.JK`/`.KL` time subscripts, `SPEC`, and `TABLE` definitions.
- Diagnostics (`DYN1001`–`DYN5006`) for missing initial equations, invalid time subscripts, simultaneous auxiliary cycles, and `SPEC` bounds.
- Direct `DAEBuilder` lowering, Euler/RK2 system-dynamics solver, and Modelica projection.
- Cleanroom standard library (`@modelscript/dynamo-std-lib`) with `SMOOTH`, `DLINF1/3`, `DELAY1/3`, `TABLE`, `TABHL`, `CLIP`, `SWITCH`, `STEP`, `PULSE`, and `RAMP`.
- Full LSP service (document symbols, hover, completion, diagnostics).
