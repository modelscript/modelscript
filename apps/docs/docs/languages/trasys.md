---
title: "TRASYS (.tra)"
description: "NASA radiative view-factor & orbital solar/albedo/IR flux"
---

# TRASYS (`.tra`)

**Package:** `@modelscript/trasys` · **Maturity:** `Beta` · **Extensions:** `.tra`

Cleanroom **TRASYS** (NASA Thermal Radiation Analyzer System) language package for ModelScript (**Beta** tier).

## Capabilities

- **WASM GLR Parser (`@modelscript/dsl`)**: Parses `HEADER OPTIONS DATA`, `HEADER SURFACE DATA` (`RECTANGLE`, `DISK`, `CYLINDER`, `CONE`, `SPHERE`, `PARABOLOID`, `POLYGON`, `NODE`, `PROP`, `ACTIVE`, `SHADE`, `TX`/`TY`/`TZ`, `ROTX`/`ROTY`/`ROTZ`), `HEADER ORBIT DATA` (`PLANET`, `ALTITUDE`, `BETA`, `SOLAR`, `ALBEDO`, `PLANETIR`), `HEADER OPERATIONS DATA` (`FFCAL`, `RKCAL`, `QCAL`), `END OF DATA`, and `C` / `$` comments.
- **Static Analysis & Lints (`TRA1001`–`TRA5006`)**: Validates syntax, duplicate surface/node IDs, optical bounds ($\alpha_s, \varepsilon_{IR} \in [0, 1]$), positive dimensions, orbit parameters, thermal node mapping, and deck termination.
- **CAD & Radiative Solver**:
  - `@modelscript/cad` assembly lowering for all 7 geometric surface primitives.
  - Analytical Hottel view factors + Monte Carlo ray-tracing view factors ($F_{ij}$), Gebhart/radiosity exchange ($B_{ij}$) & `RADK` conductors, and orbital solar/albedo/planet-IR heating flux & radiative equilibrium solver.
- **DAE Lowering & Projections**: Lowers radiative thermal networks into `@modelscript/runtime` `DAEBuilder` arenas and projects to SINDA conductor decks and Modelica models.
- **Cleanroom Standard Library (`@modelscript/trasys-std-lib`)**: Surface primitives and spacecraft thermal coatings (White Paint Z-93, Silver Teflon, Gold Kapton, Solar Cell, Black Paint, Optical Solar Reflector) with AssemblyScript WASM runtime.
- **Indexing & LSP**: UnifiedWorkspace indexing, diagnostics, document symbols, hover, and domain actions.

## Usage

```bash
npm run build --workspace=@modelscript/trasys
npm run typecheck --workspace=@modelscript/trasys
npm run lint --workspace=@modelscript/trasys
npm test --workspace=@modelscript/trasys
```

---

## CLI & Toolchain Integration

```bash
# Validate and lint TRASYS models
msx lint model.tra

# Run package test suite (8 suites, Beta maturity)
pnpm --filter @modelscript/trasys test
```

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="trasys" />
