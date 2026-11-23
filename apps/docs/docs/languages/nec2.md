---
title: "NEC-2 (.nec)"
description: "LLNL thin-wire Method-of-Moments antenna impedance & gain"
---

# NEC-2 (`.nec`)

**Package:** `@modelscript/nec2` · **Maturity:** `Beta` · **Extensions:** `.nec`

LLNL **NEC-2** (Numerical Electromagnetics Code, 1977–1981) Wire Antenna Deck language package for ModelScript (**Beta** tier).

## Features

- **WASM GLR Parser**: Declarative `@modelscript/dsl` grammar (`nec2Language`) supporting NEC-2 comment (`CM`/`CE`), symbolic (`SY`), geometry (`GW`, `GA`, `GH`, `GM`, `GR`, `GS`, `SP`, `SM`, `GE`), and control/excitation (`FR`, `EX`, `LD`, `GN`, `NT`, `TL`, `RP`, `XQ`, `EN`) cards.
- **Static Analysis & Linter (`NEC1001`–`NEC5006`)**: Validates deck termination, zero-length wires, thin-wire $\Delta / a$ ratio, segment density ($\Delta \le \lambda / 10$), undefined wire tags, out-of-range segments, ground-plane consistency, and excitation presence.
- **Method-of-Moments (MoM) Thin-Wire Solver**: 1D RWG triangular-basis Electric Field Integral Equation (EFIE) solver computing complex impedance matrix $Z I = V$, feedpoint impedance $Z_{in} = R + jX$, reflection coefficient $\Gamma$, VSWR, return loss, far-field radiation pattern, and directivity/gain (dBi) with PEC image theory support.
- **DAE Arena Lowering**: Direct lowering of antenna equivalent resonant RLC circuits into `@modelscript/runtime`'s `IDaeBuilder` linear memory arena.
- **Projections**: Export frequency sweeps to Touchstone 1.1 (`.s1p`) and equivalent circuits to Modelica (`.mo`).
- **Cleanroom Standard Library (`@modelscript/nec2-std-lib`)**: Parametric schemas, SVG block icons, and AssemblyScript WASM runtime for Half-Wave Dipole, Quarter-Wave Monopole, Folded Dipole, 3-Element Yagi-Uda, Circular Loop, and Ground Plane antennas.
- **Indexing & LSP**: UnifiedWorkspace symbol indexing, diagnostics, hover docs, document symbols, and completions for `.nec`, `.nec2`, and `.ant` decks.

---

## CLI & Toolchain Integration

```bash
# Validate and lint NEC-2 models
msx lint model.nec

# Run package test suite (8 suites, Beta maturity)
pnpm --filter @modelscript/nec2 test
```
