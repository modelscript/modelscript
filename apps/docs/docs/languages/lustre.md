---
title: "Lustre (.lus)"
description: "Synchronous dataflow, clock calculus & formal observers"
---

# Lustre (`.lus`)

**Package:** `@modelscript/lustre` · **Maturity:** `Beta` · **Extensions:** `.lus`

Lustre (Synchronous Dataflow Language, Caspi, Pilaud, Halbwachs & Plaice, 1984) compiler, clock calculus analyzer, clocked DAE lowering, cycle-accurate synchronous stepper, Modelica 3.3+ synchronous clock projection, cleanroom temporal operator standard library, and LSP support for ModelScript.

## Maturity Tier

**Beta** (`modelscript.tier = "beta"`, `fileExtensions: [".lus", ".ec"]`).

## Features

- **Native WASM GLR Parser (`src/language.ts`, `src/parser/`)**: Declarative `@modelscript/dsl` grammar compiled to WebAssembly (`dist/parser.wasm`) plus fast semantic parser supporting `const`, `type`, `node`/`function`, `returns`, `var`, `let ... tel`, `->`, `pre`, `when`, `current`, `merge`, `if ... then ... else`, `assert`, boolean/arithmetic/relational operators (`and`, `or`, `not`, `xor`, `div`, `mod`, `=>`), and `--` / `/* */` comments.
- **Static Analysis & Clock Calculus (`src/errors.ts`, `src/lints/`)**: Diagnostics `LUST1001`–`LUST5006` covering syntax errors, duplicate declarations, undefined identifiers/nodes, instantaneous algebraic causality cycles without `pre`, uninitialized `pre` without `->`, clock mismatches in binary expressions/assignments, `bool`/`int`/`real` type checking, and missing output equations.
- **Clocked DAE Lowering (`src/dae/`)**: Direct lowering of Lustre streams (`pre`, `->`, `when`, `current`, `merge`) into `@modelscript/runtime` `DAEBuilder` linear memory (`VarType.Clock`, `ExprKind.Pre`, `EqKind.When`, `EqKind.InitialSimple`).
- **Synchronous Stepper & Observer Checker (`src/solver/`)**: Cycle-accurate topological execution of Lustre nodes with sub-clocked `when`/`current` streams, nested node instantiation, `assert` verification, and safety-property observer checking.
- **Modelica 3.3+ Synchronous Projection (`src/projections/`)**: Translates Lustre nodes to Modelica 3.3+ synchronous clocked models (`Clock`, `previous`, `sample`, `hold`, `firstTick`).
- **Cleanroom Standard Library (`src/catalog/`, `assets/lustre-std-lib/`)**: 9 standard Lustre/SCADE temporal operators (`Edge`, `RisingEdge`, `FallingEdge`, `Counter`, `Timer`, `IntegratorEuler`, `PIDDiscrete`, `Latch`, `OnceSince`) compiled to AssemblyScript `runtime.wasm` with cleanroom SVG icons.
- **Unified Indexing & LSP (`src/indexing.ts`, `src/lsp.ts`)**: Workspace symbol indexing, diagnostics, document symbols, hover documentation, and completions.

## Build & Test

```bash
npm run build --workspace=@modelscript/lustre
npm run typecheck --workspace=@modelscript/lustre
npm run lint --workspace=@modelscript/lustre
npm test --workspace=@modelscript/lustre
```

---

## CLI & Toolchain Integration

```bash
# Validate and lint Lustre models
msx lint model.lus

# Run package test suite (8 suites, Beta maturity)
pnpm --filter @modelscript/lustre test
```

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="lustre" />
