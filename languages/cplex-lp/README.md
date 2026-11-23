<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/cplex-lp`

CPLEX LP & LINDO algebraic optimization format language package for ModelScript (Beta tier).

## Overview

Supports the algebraic linear, mixed-integer, and quadratic programming formats originating with LINDO (1979) and standardized by CPLEX LP (`.lp`, `.ltx`, `.lindo`):

- **Objective sections**: `Minimize` / `Maximize` / `Minimum` / `Maximum` / `MIN` / `MAX` with optional objective name, linear terms, constant offset, and quadratic blocks `[ c1 x1^2 + c2 x1 * x2 ] / 2`.
- **Constraint sections**: `Subject To` / `Such That` / `ST` / `S.T.` with named or unnamed constraints using `<=`, `>=`, `=`, and LINDO `<`, `>` operators.
- **Bounds & variable domains**: `Bounds` (`lb <= x <= ub`, `x >= lb`, `x <= ub`, `x = val`, `x free`, `+/-inf`, `+/-infinity`), `Generals` / `General` / `Gen`, `Binaries` / `Binary` / `Bin`, `Semi-Continuous` / `Semis`, and `SOS` (`S1::`, `S2::`).
- **LINDO dialect directives**: `!` line comments (in addition to CPLEX `\` comments), `TITLE`, `FREE`, `SLB`, `SUB`, `GIN`, `INT`, and `END`.

## Architecture

- **WASM GLR Parser (`src/language.ts`, `src/parser/`)**: Declarative `@modelscript/dsl` grammar compiled to `dist/parser.wasm` + `src-gen/bindings.{js,d.ts}` alongside a structured LP/LINDO parser with full source location tracking.
- **Static Analysis (`src/errors.ts`, `src/lints/`)**: Diagnostic rules `LP1001`–`LP5006` covering syntax errors, missing objective, missing `End`, duplicate constraint names, contradictory variable bounds, binary+free conflicts, empty constraints, and invalid SOS weights.
- **DAE Lowering (`src/dae/`)**: Direct lowering of LP/MILP/QP decision variables, linear/quadratic objectives, and equality/slack-augmented constraints into `@modelscript/runtime` `DAEBuilder`.
- **Solver (`src/solver/`)**: Built-in two-phase simplex LP solver (with Bland's anti-cycling rule, variable shifting/splitting for arbitrary bounds and free variables) and branch-and-bound MILP solver for binary and general integer programs.
- **Projections (`src/projections/`)**: Lossless export to standard **MPS** (`cplexLpToMps`) and **Modelica** (`cplexLpToModelica`).
- **Indexing & LSP (`src/indexing.ts`, `src/lsp.ts`)**: `UnifiedWorkspace` symbol indexing, diagnostics, document symbols, and hover documentation.

## Usage

```ts
import {
  parseCplexLp,
  lintCplexLp,
  cplexLpToDae,
  solveCplexLp,
  cplexLpToMps,
  cplexLpToModelica,
} from "@modelscript/cplex-lp";

const source = `
\\ Classic production-mix LP
Maximize
  profit: 3 x1 + 5 x2
Subject To
  plant1: x1 <= 4
  plant2: 2 x2 <= 12
  plant3: 3 x1 + 2 x2 <= 18
End
`;

const model = parseCplexLp(source);
const diagnostics = lintCplexLp(model);
const solution = solveCplexLp(model);
const dae = cplexLpToDae(model);
const mps = cplexLpToMps(model);
const mo = cplexLpToModelica(model);
```
