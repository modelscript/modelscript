---
title: "SIMSCRIPT II.5 (.sim)"
description: "RAND process/entity/resource discrete-event simulation"
---

# SIMSCRIPT II.5 (`.sim`)

**Package:** `@modelscript/simscript` · **Maturity:** `Beta` · **Extensions:** `.sim`

ModelScript Beta-tier language package for **SIMSCRIPT II.5** (RAND Discrete-Event Simulation Language, 1962–1968).

## Features

- Native WebAssembly GLR parser (`@modelscript/dsl` → `dist/parser.wasm`) supporting `PREAMBLE`, `TEMPORARY`/`PERMANENT ENTITIES`, `PROCESSES`, `RESOURCES`, `EVENT NOTICES`, `TALLY`/`ACCUMULATE`, `ACTIVATE`, `WORK`, `WAIT`, `REQUEST`/`RELINQUISH`, and `FILE`/`REMOVE`.
- Diagnostics (`SIMS1001`–`SIMS5006`) for duplicate/undefined entities, resources, sets, mismatched `REQUEST`/`RELINQUISH`, and missing `START SIMULATION`.
- Direct `DAEBuilder` balance lowering, seeded process-oriented DES engine with Erlang-C / Little's Law parity, and Modelica projection.
- Cleanroom standard library (`@modelscript/simscript-std-lib`) with distributions (`EXPONENTIAL.F`, `NORMAL.F`, `UNIFORM.F`, `POISSON.F`, `ERLANG.F`) and set/resource primitives.
- Full LSP service (document symbols, hover, completion, diagnostics).

---

## CLI & Toolchain Integration

```bash
# Validate and lint SIMSCRIPT II.5 models
msx lint model.sim

# Run package test suite (8 suites, Beta maturity)
pnpm --filter @modelscript/simscript test
```

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="simscript" />
