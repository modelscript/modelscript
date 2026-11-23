<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/mps

IBM **MPS (Mathematical Programming System)** language package for ModelScript (**Beta** tier).

Supports classic 80-column fixed-format punch-card MPS (1960s–1970s IBM MPSX/370) and modern Free MPS for Linear Programming (LP), Mixed-Integer Linear Programming (MILP), and Quadratic Programming (QP / MIQP).

## Features

- **Native WebAssembly GLR Parser** (`mpsLanguage` → `dist/parser.wasm` + `src-gen/bindings.js`) compiled via `@modelscript/dsl`.
- **Fixed & Free MPS Parser / Writer** (`parseMps`, `writeMps`):
  - `NAME`, `OBJSENSE` (`MIN`/`MAX`), `ROWS` (`N`, `L`, `G`, `E`), `COLUMNS` (including `'MARKER'` `'INTORG'`/`'INTEND'`), `RHS`, `RANGES`, `BOUNDS` (`LO`, `UP`, `FX`, `FR`, `MI`, `PL`, `BV`, `LI`, `UI`), `QUADOBJ`, `QMATRIX`, `ENDATA`, and `*` comments.
- **Static Analysis & Linter** (`lintMps`, `MPS1001`–`MPS5006`): structural card checks, duplicate rows, undefined row/column references, invalid bound/row types, contradictory bounds (`LO > UP`), unmatched integer markers, missing objective rows.
- **Direct Linear-Memory DAE Lowering** (`lowerMpsToDae`, `mpsToDae`) into `@modelscript/runtime`'s `DAEBuilder`.
- **Presolver & Solvers** (`presolveMps`, `solveMpsLp`, `solveMpsMip`, `solveMps`):
  - Algebraic LP/MILP presolver (fixed variable substitution, empty row/column elimination, singleton row bound tightening).
  - Two-Phase Revised Simplex LP solver with LU partial-pivoting basis solves and Dantzig/Bland anti-cycling.
  - Branch-and-Bound MILP solver with best-bound node selection.
- **Polyglot Projections** (`mpsToCplexLp`, `mpsToModelica`, `mpsToAmpl`).
- **Workspace Indexing & LSP** (`mpsIndexing`, `validateMps`, `getMpsDocumentSymbols`, `getMpsHover`).

## Usage

```ts
import { lintMps, mpsToCplexLp, mpsToDae, parseMps, solveMps, writeMps } from "@modelscript/mps";

const mps = `
NAME          PRODMIX
OBJSENSE
  MAX
ROWS
 N  PROFIT
 L  LABOR
 L  MATERIAL
COLUMNS
    X1        PROFIT    40       LABOR     1
    X1        MATERIAL  2
    X2        PROFIT    30       LABOR     1
    X2        MATERIAL  1
RHS
    RHS1      LABOR     100      MATERIAL  140
ENDATA
`;

const model = parseMps(mps);
const diagnostics = lintMps(model);
const solution = solveMps(model); // optimal: X1=40, X2=60, objective=3400
const dae = mpsToDae(model);
const lpText = mpsToCplexLp(model);
const fixedMps = writeMps(model, { fixedFormat: true });
```
