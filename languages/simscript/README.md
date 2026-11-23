<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/simscript`

ModelScript Beta-tier language package for **SIMSCRIPT II.5** (RAND Discrete-Event Simulation Language, 1962–1968).

## Features

- Native WebAssembly GLR parser (`@modelscript/dsl` → `dist/parser.wasm`) supporting `PREAMBLE`, `TEMPORARY`/`PERMANENT ENTITIES`, `PROCESSES`, `RESOURCES`, `EVENT NOTICES`, `TALLY`/`ACCUMULATE`, `ACTIVATE`, `WORK`, `WAIT`, `REQUEST`/`RELINQUISH`, and `FILE`/`REMOVE`.
- Diagnostics (`SIMS1001`–`SIMS5006`) for duplicate/undefined entities, resources, sets, mismatched `REQUEST`/`RELINQUISH`, and missing `START SIMULATION`.
- Direct `DAEBuilder` balance lowering, seeded process-oriented DES engine with Erlang-C / Little's Law parity, and Modelica projection.
- Cleanroom standard library (`@modelscript/simscript-std-lib`) with distributions (`EXPONENTIAL.F`, `NORMAL.F`, `UNIFORM.F`, `POISSON.F`, `ERLANG.F`) and set/resource primitives.
- Full LSP service (document symbols, hover, completion, diagnostics).
