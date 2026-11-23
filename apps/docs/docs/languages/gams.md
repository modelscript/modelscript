---
title: "GAMS (.gms)"
description: "General Algebraic Modeling System LP/MILP/NLP optimization"
---

# GAMS (`.gms`)

**Package:** `@modelscript/gams` · **Maturity:** `Beta` · **Extensions:** `.gms`

General Algebraic Modeling System (**GAMS**, 1978–1987) language package for ModelScript (**Beta** tier).

## Features

- **Native WASM GLR Parser (`src/language.ts`) & Recursive-Descent Parser (`src/parser/`)**:
  - `Sets` / `Set` (including range expansion `i1*i5` and hyphenated labels) and `Alias`
  - `Parameters` / `Parameter`, `Scalars` / `Scalar`, and column-aligned 2D `Tables` / `Table`
  - `Variables` (`Free`, `Positive`, `Negative`, `Binary`, `Integer`) and `.lo` / `.up` / `.fx` / `.l` suffix assignments
  - `Equations` / `Equation` declarations and `..` definitions (`=e=`, `=l=`, `=g=`, `=n=`)
  - Indexed operators (`sum`, `prod`, `smin`, `smax`), ordered-set intrinsics (`ord`, `card`, `sameas`), and `$`-conditionals
  - `Model`, `Solve ... using lp|mip|nlp minimizing|maximizing ...`, `Display`
  - Column-1 `*` line comments, `$ontext`/`$offtext` block comments, and `$title` / `$eolcom` directives
- **Static Linter (`src/lints/`, `src/errors.ts`)**: `GAMS1001`–`GAMS5006` diagnostics for syntax errors, duplicate declarations, undefined sets/parameters/variables, domain index arity mismatches, undeclared equations in `Model`, missing objective variables, invalid solver types, and conflicting bounds.
- **Relational Set Instantiator & DAE Lowering (`src/dae/`)**: Evaluates sets, tables, computed assignments, and `$`-conditionals, and lowers flat LP/MILP/NLP problems directly into `@modelscript/runtime`'s `DAEBuilder` linear-memory arena.
- **Built-in LP / MILP Solver (`src/solver/`)**: Two-Phase Simplex LP solver with Bland's anti-cycling rule + Branch-and-Bound MILP solver for binary/integer variables.
- **Cross-Language Projections (`src/projections/`)**: Export GAMS models to standard **MPS**, **AMPL** (`.mod` + `.dat`), and **Modelica** (`.mo`).
- **Cleanroom Standard Library (`@modelscript/gams-std-lib`)**: Zero-I/O registered schemas, SVG icons, and AssemblyScript `runtime.wasm` kernels for GAMS intrinsic operators (`sum`, `prod`, `smin`, `smax`, `ord`, `card`, `sameas`) and classic GAMSlib archetypes (`trnsport`, `diet`, `blend`).
- **UnifiedWorkspace Indexing & LSP (`src/indexing.ts`, `src/lsp.ts`)**: Diagnostics, document symbols, hover docs, completions, and go-to-definition.

## Usage

```ts
import { solveGams, lowerGamsToDae, lintGamsSource, gamsToMps } from "@modelscript/gams";

const source = `
Sets
  i canning plants / seattle, san-diego /
  j markets        / new-york, chicago, topeka / ;
Parameters
  a(i) capacity / seattle 350, san-diego 600 /
  b(j) demand   / new-york 325, chicago 300, topeka 275 / ;
Table d(i,j) distance in thousands of miles
              new-york  chicago  topeka
  seattle          2.5      1.7     1.8
  san-diego        2.5      1.8     1.4 ;
Scalar f freight / 90 / ;
Parameter c(i,j) ;
c(i,j) = f * d(i,j) / 1000 ;
Variables x(i,j), z ;
Positive Variable x ;
Equations cost, supply(i), demand(j) ;
cost..      z =e= sum((i,j), c(i,j)*x(i,j)) ;
supply(i).. sum(j, x(i,j)) =l= a(i) ;
demand(j).. sum(i, x(i,j)) =g= b(j) ;
Model transport / all / ;
Solve transport using lp minimizing z ;
`;

const result = solveGams(source);
console.log(result.status, result.objectiveValue); // "optimal", 153.675

const dae = lowerGamsToDae(source);
const mps = gamsToMps(source);
const diagnostics = lintGamsSource(source);
```

---

## CLI & Toolchain Integration

```bash
# Validate and lint GAMS models
msx lint model.gms

# Run package test suite (8 suites, Beta maturity)
pnpm --filter @modelscript/gams test
```
