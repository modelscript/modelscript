---
title: "Esterel (.strl)"
description: "Synchronous imperative reactive systems & constructive semantics"
---

# Esterel (`.strl`)

**Package:** `@modelscript/esterel` · **Maturity:** `Beta` · **Extensions:** `.strl`

ModelScript **Beta**-tier implementation of **Esterel** (Gérard Berry, 1984) — the synchronous imperative reactive language for deterministic real-time control systems.

## Features

- **Declarative WASM GLR Parser (`src/language.ts`, `src/parser/`)**: Supports Esterel v5 modules, signal interfaces (`input`, `output`, `inputoutput`, `sensor`, `relation` with `#` exclusion and `=>` implication), local `signal ... in ... end`, `emit`, `sustain`, `present ... then ... else ... end`, `await` / `await immediate`, `pause`, `nothing`, `halt`, `loop ... end`, `loop ... each ...`, `every ... do ... end`, strong & `weak abort ... when ... end`, `suspend ... when ... end`, `trap ... in ... end` / `exit`, `run`, `||` parallel composition, `;` sequential composition, and `%` comments.
- **Constructive Semantics & Causality Checker (`src/lints/`, `src/errors.ts`)**: Diagnostics `EST1001`–`EST5006` covering syntax errors, duplicate declarations, undeclared signals/traps, relation conflicts, instantaneous infinite loops (`loop` without `pause`/`await`), and constructive causality cycles (`present S else emit S`).
- **Berry's Constructive Reactive Simulator (`src/solver/`)**: 3-valued constructive fixpoint instant-by-instant execution engine supporting instantaneous broadcast across `||`, strong vs. weak preemption (`abort` / `weak abort`), suspension (`suspend`), hierarchical `trap`/`exit` priority, and `loop ... each`.
- **Mealy FSM / DAE Lowering (`src/dae/`)**: Direct linear-memory lowering of Esterel reactive state registers and signal status equations into `@modelscript/runtime`'s `DAEBuilder`.
- **Polyglot Projections (`src/projections/`)**: Translates Esterel modules to Modelica 3.3+ clocked synchronous state machines and Lustre v6 synchronous dataflow nodes.
- **Cleanroom Standard Library (`src/catalog/`, `assets/esterel-std-lib/`)**: Zero-I/O standard library bundle with AssemblyScript WASM runtime and SVG block icons for canonical Esterel reactive patterns (`ABRO`, `Watchdog`, `Debouncer`, `Arbiter`, `Timeout`, `Stopwatch`).
- **Workspace Indexing & LSP (`src/indexing.ts`, `src/lsp.ts`)**: Unified workspace symbol indexing, diagnostics, document symbols, hover documentation, and completions.

## Usage

```ts
import {
  parseEsterel,
  lintEsterel,
  simulateEsterelTrace,
  esterelToDae,
  esterelToModelica,
  esterelToLustre,
} from "@modelscript/esterel";

const abro = `
module ABRO:
input A, B, R;
output O;
loop
  [ await A || await B ];
  emit O
each R
end module
`;

const program = parseEsterel(abro);
const diagnostics = lintEsterel(program);
const trace = simulateEsterelTrace(program, [[], ["A"], ["B"], ["R"], ["A", "B"]]);
```

---

## CLI & Toolchain Integration

```bash
# Validate and lint Esterel models
msx lint model.strl

# Run package test suite (8 suites, Beta maturity)
pnpm --filter @modelscript/esterel test
```
