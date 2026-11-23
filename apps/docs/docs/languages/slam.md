---
title: "SLAM II (.slam)"
description: "Combined discrete-event network & continuous ODE simulation"
---

# SLAM II (`.slam`)

**Package:** `@modelscript/slam` · **Maturity:** `Beta` · **Extensions:** `.slam`

ModelScript Beta-tier language package for **SLAM II** (Simulation Language for Alternative Modeling, 1979).

## Features

- Native WebAssembly GLR parser (`@modelscript/dsl` → `dist/parser.wasm`) supporting `GEN`, `LIMITS`, `CONTINUOUS`, `INTLC`, `NETWORK`/`ENDNETWORK`, `CREATE`, `QUEUE`, `ACTIVITY`, `AWAIT`, `FREE`, `DETECT`, `COLCT`, `TERMINATE`, and `DD(i)`/`SS(i)` equations.
- Diagnostics (`SLAM1001`–`SLAM5006`) for undefined resources/gates/labels, `CONTINUOUS` bounds, `DETECT` crossings, and unmatched blocks.
- Combined discrete-continuous `DAEBuilder` lowering, hybrid RK4 + DES event-queue + `DETECT` threshold-crossing solver, and Modelica projection.
- Cleanroom standard library (`@modelscript/slam-std-lib`) with 14 SLAM II network and continuous-state block archetypes.
- Full LSP service (document symbols, hover, completion, diagnostics).

---

## CLI & Toolchain Integration

```bash
# Validate and lint SLAM II models
msx lint model.slam

# Run package test suite (8 suites, Beta maturity)
pnpm --filter @modelscript/slam test
```
