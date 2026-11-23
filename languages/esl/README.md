<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/esl`

ModelScript Beta-tier language package for **ESL** (European Space Agency Simulation Language, 1980s).

## Features

- Native WebAssembly GLR parser (`@modelscript/dsl` → `dist/parser.wasm`) supporting `STUDY`, `MODEL`, `SUBMODEL`, `SEGMENT`, `PACKAGE`, `INITIAL`/`DYNAMIC`/`STEP`/`TERMINAL`, prime derivatives `x'`, and `WHEN` discontinuities.
- Diagnostics (`ESL1001`–`ESL5006`) for duplicate/undefined symbols, derivative targets, block mismatches, `WHEN` predicates, and submodel arity.
- Direct `DAEBuilder` lowering, hybrid RK4 + bisection zero-crossing event solver, and Modelica projection.
- Cleanroom standard library (`@modelscript/esl-std-lib`) with ESA aerospace & control blocks (`TRANSFER`, `DELAY`, `LIMIT`, `DEADZONE`, `QUATERNION`, `ORBIT_J2`, `TAB1`, `TAB2`).
- Full LSP service (document symbols, hover, completion, diagnostics).
