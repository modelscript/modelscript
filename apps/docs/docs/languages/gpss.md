---
title: "GPSS (.gps)"
description: "IBM General Purpose Simulation System transaction-flow DES"
---

# GPSS (`.gps`)

**Package:** `@modelscript/gpss` · **Maturity:** `Beta` · **Extensions:** `.gps`

ModelScript Beta-tier language package for **GPSS** (General Purpose Simulation System, 1961).

## Features

- Native WebAssembly GLR parser (`@modelscript/dsl` → `dist/parser.wasm`) supporting GPSS transaction-flow blocks (`GENERATE`, `SEIZE`, `RELEASE`, `ADVANCE`, `QUEUE`, `DEPART`, `ENTER`, `LEAVE`, `TRANSFER`, `SPLIT`, `ASSEMBLE`, `TERMINATE`, `STORAGE`, `TABLE`, `START`).
- Diagnostics (`GPSS1001`–`GPSS5006`) for unmatched `SEIZE`/`RELEASE`, `QUEUE`/`DEPART`, `ENTER`/`LEAVE`, undefined targets, and invalid capacities.
- Direct `DAEBuilder` fluid/balance lowering, deterministic seeded discrete-event simulator with Erlang-C / Little's Law parity, and Modelica projection.
- Cleanroom standard library (`@modelscript/gpss-std-lib`) with 25 GPSS block archetypes and Standard Numerical Attributes (`Q$`, `F$`, `S$`, `R$`, `FR$`, `SR$`).
- Full LSP service (document symbols, hover, completion, diagnostics).

---

## CLI & Toolchain Integration

```bash
# Validate and lint GPSS models
msx lint model.gps

# Run package test suite (8 suites, Beta maturity)
pnpm --filter @modelscript/gpss test
```

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="gpss" />
