<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/endf6

**Maturity:** Beta · **Extensions:** `.endf`, `.endf6`, `.enf`, `.pendf`, `.gendf`, `.tape` · **Docs:** [modelscript.org/languages/endf6](https://modelscript.org/languages/endf6)

Native **ENDF-6 (Evaluated Nuclear Data File Format, BNL/NNDC 1968–1980s+)** evaluated nuclear cross-section tape parser, resonance evaluator, multigroup collapse solver, linear-memory `DAEBuilder` lowering, and interactive log-log cross-section viewer/editor for ModelScript.

---

## Core Capabilities

- **WASM GLR Grammar & 80-Column ENDF-6 Card Parser (`endf6Language`, `parseEndf6Tape`, `parseEndfFloat`)**:
  - Exact 11-character Fortran exponent-omitted floating-point parsing (e.g., ` 9.223500+4`, `-1.234567-5`, ` 2.530000-2`) and canonical formatting.
  - Full `HEAD`, `CONT`, `TAB1`, and `LIST` record decoding with `MAT` (cols 67–70), `MF` (cols 71–72), `MT` (cols 73–75), and `NS` (cols 76–80) sequence identifiers.
  - Structured decoding for `MF=1` (`MT=451` descriptive data & directory), `MF=2` (`MT=151` single-level Breit-Wigner resonance parameters), `MF=3` (pointwise cross-sections `MT=1, 2, 18, 102`), `MF=8` (`MT=457` radioactive decay data), and `SEND`/`FEND`/`MEND`/`TEND` tape terminators.
- **Nuclear Data Validation & Linting (`lintEndf6Tape`, `Endf6ErrorCode`)**:
  - 18 domain diagnostics (`ENDF1001`–`ENDF5006`) covering card formatting, missing `SEND`/`FEND`/`MEND`/`TEND` terminators, invalid `MAT`/`MF`/`MT` codes, non-monotonic energy grids, negative cross-sections $\sigma(E) < 0$, invalid interpolation schemes (`INT` $\notin \{1..5\}$), `MT=1` total vs. partial cross-section sum consistency, and invalid `ZA` or `AWR <= 0`.
- **Cross-Section Interpolation, Resonance & Multigroup Solver (`evaluateTab1`, `evaluateSlbwRange`, `collapseMultigroup`)**:
  - Exact ENDF-6 `INT=1..5` interpolation (histogram, lin-lin, lin-log, log-lin, log-log).
  - Single-Level Breit-Wigner (SLBW) s-wave resonance cross-section evaluator (elastic, capture, fission, total) with exact $1/v$ thermal tail and resonance peak behavior.
  - Flux-weighted multigroup cross-section collapse over Maxwellian thermal + $1/E$ epithermal neutron spectra.
- **Direct Continuous DAE Arena Lowering (`lowerEndf6ToDae`)**:
  - Lowers collapsed multigroup neutron balance ODEs, reaction-rate equations (`R_total`, `R_capture`, `R_fission`), and `MF=8` radioactive decay ODEs directly into `@modelscript/runtime`'s `DAEBuilder`.
- **Polyglot Projections & Interactive Log-Log Viewer (`endf6ToMcnpMaterial`, `endf6ToScaleComposition`, `endf6ToCsv`, `renderEndf6CrossSectionSvg`, `Endf6Panel`)**:
  - Projects ENDF-6 nuclides to MCNP material cards, SCALE standard compositions, and CSV tables.
  - Pure SVG log-log $\sigma(E)$ vs. $E$ cross-section plotter and interactive React panel (`Endf6Panel`).

---

## Package Structure

| Path                    | Description                                                                                           |
| :---------------------- | :---------------------------------------------------------------------------------------------------- |
| `src/index.ts`          | Public package exports                                                                                |
| `src/language.ts`       | `endf6Language` WASM GLR grammar and UI panel registration                                            |
| `src/types.ts`          | Core TypeScript interfaces (`Endf6Tape`, `Endf6Material`, `Endf6Tab1Record`, etc.)                    |
| `src/parser/`           | 11-char ENDF float parser/formatter and 80-column `HEAD`/`CONT`/`TAB1`/`LIST` tape parser             |
| `src/errors.ts`         | `Endf6ErrorCode` (`ENDF1001`–`ENDF5006`) diagnostic catalog                                           |
| `src/lints/index.ts`    | ENDF-6 structural, monotonicity, positivity, and consistency linter                                   |
| `src/solver/`           | `INT=1..5` interpolation, SLBW resonance evaluator, and multigroup collapse                           |
| `src/dae/`              | Direct `DAEBuilder` lowering for multigroup neutron balance & reaction rates                          |
| `src/projections/`      | MCNP material card, SCALE composition, and CSV projections                                            |
| `src/catalog/`          | Cleanroom ENDF-6 `MF`/`MT` schemas and reference nuclides (`H-1`, `B-10`, `U-235`, `U-238`, `Pu-239`) |
| `src/diagram/`          | Pure SVG log-log neutron cross-section plotter (`renderEndf6CrossSectionSvg`)                         |
| `src/ui/Endf6Panel.tsx` | Interactive React cross-section viewer/editor panel                                                   |
| `src/indexing.ts`       | UnifiedWorkspace symbol indexing                                                                      |
| `src/lsp.ts`            | LSP diagnostics, document symbols, hover, and completions                                             |
