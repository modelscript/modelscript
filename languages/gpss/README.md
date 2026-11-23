<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/gpss`

ModelScript Beta-tier language package for **GPSS** (General Purpose Simulation System, 1961).

## Features

- Native WebAssembly GLR parser (`@modelscript/dsl` → `dist/parser.wasm`) supporting GPSS transaction-flow blocks (`GENERATE`, `SEIZE`, `RELEASE`, `ADVANCE`, `QUEUE`, `DEPART`, `ENTER`, `LEAVE`, `TRANSFER`, `SPLIT`, `ASSEMBLE`, `TERMINATE`, `STORAGE`, `TABLE`, `START`).
- Diagnostics (`GPSS1001`–`GPSS5006`) for unmatched `SEIZE`/`RELEASE`, `QUEUE`/`DEPART`, `ENTER`/`LEAVE`, undefined targets, and invalid capacities.
- Direct `DAEBuilder` fluid/balance lowering, deterministic seeded discrete-event simulator with Erlang-C / Little's Law parity, and Modelica projection.
- Cleanroom standard library (`@modelscript/gpss-std-lib`) with 25 GPSS block archetypes and Standard Numerical Attributes (`Q$`, `F$`, `S$`, `R$`, `FR$`, `SR$`).
- Full LSP service (document symbols, hover, completion, diagnostics).
