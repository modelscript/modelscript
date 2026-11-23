---
title: "DYNAMO (.dyn)"
description: "MIT System Dynamics stock-flow & feedback modeling"
---

# DYNAMO (`.dyn`)

**Package:** `@modelscript/dynamo` · **Maturity:** `Beta` · **Extensions:** `.dyn`

ModelScript Beta-tier language package for **DYNAMO** (MIT System Dynamics Language, 1959–1960s).

## Features

- Native WebAssembly GLR parser (`@modelscript/dsl` → `dist/parser.wasm`) supporting `L`/`R`/`A`/`N`/`C`/`T`/`S` equations, `.K`/`.J`/`.JK`/`.KL` time subscripts, `SPEC`, and `TABLE` definitions.
- Diagnostics (`DYN1001`–`DYN5006`) for missing initial equations, invalid time subscripts, simultaneous auxiliary cycles, and `SPEC` bounds.
- Direct `DAEBuilder` lowering, Euler/RK2 system-dynamics solver, and Modelica projection.
- Cleanroom standard library (`@modelscript/dynamo-std-lib`) with `SMOOTH`, `DLINF1/3`, `DELAY1/3`, `TABLE`, `TABHL`, `CLIP`, `SWITCH`, `STEP`, `PULSE`, and `RAMP`.
- Full LSP service (document symbols, hover, completion, diagnostics).

---

## CLI & Toolchain Integration

```bash
# Validate and lint DYNAMO models
msx lint model.dyn

# Run package test suite (8 suites, Beta maturity)
pnpm --filter @modelscript/dynamo test
```
