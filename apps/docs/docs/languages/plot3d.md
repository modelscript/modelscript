---
title: "NASA PLOT3D (.xyz)"
description: "Multi-block structured CFD grid & conservative solution format"
---

# NASA PLOT3D (`.xyz`)

**Package:** `@modelscript/plot3d` · **Maturity:** `Beta` · **Extensions:** `.xyz`

NASA Ames **PLOT3D** Multi-Block Structured CFD Grid & Solution Format (1982) language package for ModelScript (**Beta** tier).

## Capabilities

- **DSL WASM GLR Parser (`src/language.ts`)**: Declarative `@modelscript/dsl` grammar compiled to `dist/parser.wasm` + `src-gen/bindings.{js,d.ts}` for ASCII formatted `.xyz`/`.g` grids, `.q` conservative solutions (`FSMACH`, `ALPHA`, `RE`, `TIME`, $\rho, \rho u, \rho v, \rho w, e$), `.f` function files, and `.nam` variable-name metadata.
- **ASCII & Fortran Unformatted Binary Codecs (`src/parser/`)**: Full read/write support for single-block and multi-block 2D/3D grids and solutions in ASCII formatted text and Fortran unformatted binary (32-bit record markers, little/big endian, float32/float64).
- **Lints & Diagnostics (`src/errors.ts`, `src/lints/`)**: `P3D1001`–`P3D5006` covering syntax/EOF, binary record markers, non-positive `NI`/`NJ`/`NK`, coordinate/field count mismatches, negative Jacobian / inverted hexahedral cell volumes, $\rho \le 0$, $p \le 0$, grid/solution block mismatches, and invalid `FSMACH`/`RE`/`ALPHA`.
- **CFD Field Diagnostics & Nozzle Verifier (`src/solver/`)**: Structured-grid hexahedral cell volume & metric Jacobian evaluator, conservative-to-primitive converter ($p, T, M, C_p, p_0, T_0, \Delta s$), surface mass-flux integration ($\iint \rho \vec{u}\cdot d\vec{A}$), and quasi-1D isentropic nozzle solver/verifier.
- **DAE Lowering & Polyglot Projections (`src/dae/`, `src/projections/`)**: Finite-volume Euler conservation equations lowered directly into `@modelscript/runtime` `DAEBuilder`, plus projections to VTK Legacy ASCII (`STRUCTURED_GRID`), OpenFOAM `blockMeshDict`, and Modelica.
- **Cleanroom Standard Library (`src/catalog/`, `assets/plot3d-std-lib/`)**: Zero-I/O standard library schemas (`Grid3D`, `SolutionQ`, `FunctionF`, `IsentropicNozzle`, `FlatPlateMesh`) with cleanroom SVG icons and AssemblyScript WASM runtime.
- **UnifiedWorkspace Indexing & LSP (`src/indexing.ts`, `src/lsp.ts`)**: Document symbols, diagnostics, hover cards, and completions.

---

## CLI & Toolchain Integration

```bash
# Validate and lint NASA PLOT3D models
msx lint model.xyz

# Run package test suite (8 suites, Beta maturity)
pnpm --filter @modelscript/plot3d test
```
