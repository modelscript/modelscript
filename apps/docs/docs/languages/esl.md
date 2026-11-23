---
title: "ESL (.esl)"
description: "European Space Agency hybrid continuous/discrete simulation"
---

# ESL (`.esl`)

**Package:** `@modelscript/esl` · **Maturity:** `Beta` · **Extensions:** `.esl`

ModelScript Beta-tier language package for **ESL** (European Space Agency Simulation Language, 1980s).

## Features

- Native WebAssembly GLR parser (`@modelscript/dsl` → `dist/parser.wasm`) supporting `STUDY`, `MODEL`, `SUBMODEL`, `SEGMENT`, `PACKAGE`, `INITIAL`/`DYNAMIC`/`STEP`/`TERMINAL`, prime derivatives `x'`, and `WHEN` discontinuities.
- Diagnostics (`ESL1001`–`ESL5006`) for duplicate/undefined symbols, derivative targets, block mismatches, `WHEN` predicates, and submodel arity.
- Direct `DAEBuilder` lowering, hybrid RK4 + bisection zero-crossing event solver, and Modelica projection.
- Cleanroom standard library (`@modelscript/esl-std-lib`) with ESA aerospace & control blocks (`TRANSFER`, `DELAY`, `LIMIT`, `DEADZONE`, `QUATERNION`, `ORBIT_J2`, `TAB1`, `TAB2`).
- Full LSP service (document symbols, hover, completion, diagnostics).

---

## CLI & Toolchain Integration

```bash
# Validate and lint ESL models
msx lint model.esl

# Run package test suite (8 suites, Beta maturity)
pnpm --filter @modelscript/esl test
```
