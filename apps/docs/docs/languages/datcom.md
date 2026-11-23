---
title: "USAF Digital DATCOM (.dcm)"
description: "Semi-empirical aircraft stability & control derivatives"
---

# USAF Digital DATCOM (`.dcm`)

**Package:** `@modelscript/datcom` · **Maturity:** `Beta` · **Extensions:** `.dcm`

USAF Stability and Control Digital DATCOM (1970s) language package for ModelScript (**Beta** tier).

## Capabilities

- **WASM GLR Parser (`src/language.ts`, `src/parser/`)**: Declarative `@modelscript/dsl` grammar and deck parser supporting Fortran NAMELIST blocks (`$FLTCON`, `$OPTINS`, `$SYNTHS`, `$BODY`, `$WGPLNF`, `$HTPLNF`, `$VTPLNF`, `$VFPLNF`, `$SYMFLP`, `$ASYFLP`, `$WGSCHR`, `$` terminators) and control cards (`CASEID`, `DIM FT/IN/M/CM`, `DERIV DEG/RAD`, `NACA-W/H/V-4/5/6-xxxx`, `DAMP`, `BUILD`, `PLOT`, `NEXT CASE`, `SAVE`).
- **Diagnostics & Lints (`src/errors.ts`, `src/lints/`)**: Validation rules `DAT1001`–`DAT5006` covering syntax, unknown NAMELIST groups, missing `$FLTCON`/`$WGPLNF`, NACA designation validation, `NMACH`/`NALPHA`/`NALT` array length consistency, reference geometry checks, taper/sweep bounds, and static longitudinal instability (`XCG > XNP`).
- **Semi-Empirical Aerodynamic Solver (`src/solver/`)**: Helmbold/Polhamus finite-wing $C_{L_\alpha}$, Prandtl-Glauert compressibility scaling, induced and parasitic drag polar $C_D = C_{D_0} + C_L^2 / (\pi e AR)$, pitching moment $C_m$, longitudinal static margin, dynamic damping derivatives ($C_{m_q}, C_{l_p}, C_{n_r}$), and linearized longitudinal/lateral modal analysis.
- **DAE Lowering (`src/dae/`)**: Direct lowering of 6-DOF linearized longitudinal (`u, w, q, theta`) and lateral (`v, p, r, phi`) flight dynamics state-space equations to `@modelscript/runtime` `DAEBuilder`.
- **Projections (`src/projections/`)**: Export DATCOM cases and aerodynamic tables to JSBSim XML (`<fdm_config>`) and Modelica models.
- **Cleanroom Standard Library (`src/catalog/`, `assets/datcom-std-lib/`)**: NACA 4/5/6-digit airfoil catalog (`0012`, `2412`, `4412`, `23012`, `64A010`) and standard aircraft configuration templates (Cessna-172 class, Citation-class, Supersonic Delta) with AssemblyScript WASM runtime.
- **Indexing & LSP (`src/indexing.ts`, `src/lsp.ts`)**: Workspace indexing, diagnostics, document symbols, hover documentation, and completions.

---

## CLI & Toolchain Integration

```bash
# Validate and lint USAF Digital DATCOM models
msx lint model.dcm

# Run package test suite (8 suites, Beta maturity)
pnpm --filter @modelscript/datcom test
```
