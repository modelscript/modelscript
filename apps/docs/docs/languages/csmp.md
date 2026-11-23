---
title: "CSMP / CSSL-67 (.csmp)"
description: "IBM System/360 continuous ODE modeling & topological sorting"
---

# CSMP / CSSL-67 (`.csmp`)

**Package:** `@modelscript/csmp` · **Maturity:** `Beta` · **Extensions:** `.csmp`

ModelScript Beta-tier language package for **CSMP/360 & CSSL-67** (IBM Continuous System Modeling Program, 1967).

## Features

- Native WebAssembly GLR parser (`@modelscript/dsl` → `dist/parser.wasm`) supporting `INITIAL`/`DYNAMIC`/`TERMINAL`, `SORT`/`NOSORT`, `MACRO`/`ENDMAC`, `PROCEDURE`/`ENDPRO`, `FUNCTION` tables, and `INTGRL`.
- Diagnostics (`CSMP1001`–`CSMP5006`) including topological `SORT` algebraic-loop detection, `TIMER`, and `METHOD` validation.
- Direct `DAEBuilder` lowering, RK4/Milne/Adams/Trapezoidal integrators, and Modelica 3.x projection.
- Cleanroom standard library (`@modelscript/csmp-std-lib`) with 12 CSMP/360 functional blocks and AssemblyScript WASM runtime.
- Full LSP service (document symbols, hover, completion, diagnostics).

---

## CLI & Toolchain Integration

```bash
# Validate and lint CSMP / CSSL-67 models
msx lint model.csmp

# Run package test suite (8 suites, Beta maturity)
pnpm --filter @modelscript/csmp test
```
