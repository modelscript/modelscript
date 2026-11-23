---
title: "ANSYS APDL (.apdl)"
description: "Parametric Design Language macro expander & static/modal FEA"
---

# ANSYS APDL (`.apdl`)

**Package:** `@modelscript/apdl` · **Maturity:** `Beta` · **Extensions:** `.apdl`

ANSYS APDL (ANSYS Parametric Design Language, 1970) frontend, parametric macro expander, direct-stiffness finite element solver, DAE lowering, cleanroom standard library, and LSP services for ModelScript.

## Features

- **WASM GLR Parser (`@modelscript/dsl`)**: Declarative grammar for APDL processors (`/PREP7`, `/SOLU`, `/POST1`, `/TITLE`, `/UNITS`, `FINISH`), element/material/section/geometry/mesh/BC commands (`ET`, `MP`, `R`, `SECTYPE`, `SECDATA`, `K`, `L`, `A`, `V`, `N`, `E`, `TYPE`, `MAT`, `REAL`, `ESIZE`, `LMESH`, `D`, `F`, `SF`, `ANTYPE`, `SOLVE`), parametric macros (`*SET`, `*DIM`, `*DO`/`*ENDDO`, `*IF`/`*ELSE`/`*ENDIF`, `*GET`, `param = expr`), and `!` comments.
- **Lints & Diagnostics (`APDL1001`–`APDL5006`)**: Syntax validation, unmatched `*DO`/`*IF` control blocks, undefined parameter references, invalid element node/ET/MAT references, non-positive `EX` or out-of-bounds `PRXY`, rigid-body motion (`SOLVE` without `D` constraints), and processor-context checks (`/PREP7` vs `/SOLU`).
- **Parametric Macro Expander & Direct-Stiffness FEA Solver**: Evaluates `*SET`, `*DO` loops, `*IF` branches, expressions, and `K`/`L`/`ESIZE`/`LMESH` line meshing; solves 2D/3D Euler-Bernoulli beam (`BEAM188`) and truss (`LINK180`) static equilibrium ($K u = F$) and modal eigenvalue ($\det(K - \omega^2 M) = 0$) problems.
- **DAE Lowering & Projections**: Lowers structural equilibrium and dynamic equations into `@modelscript/runtime` `DAEBuilder`, and projects APDL models to NASTRAN `.bdf` and Modelica.
- **Cleanroom Standard Library**: AssemblyScript WASM runtime and SVG block catalog for `LINK180`, `BEAM188`, `PLANE182`, `SHELL181`, `SOLID185`, `MASS21`, and `COMBIN14`.
- **Workspace Indexing & LSP**: Document symbols, diagnostics, hover documentation, and completions for `.apdl`, `.mac`, `.ans`, and `.cdb` files.

## Scripts

```bash
npm run build
npm run typecheck
npm run lint
npm test
```

---

## CLI & Toolchain Integration

```bash
# Validate and lint ANSYS APDL models
msx lint model.apdl

# Run package test suite (8 suites, Beta maturity)
pnpm --filter @modelscript/apdl test
```

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="apdl" />
