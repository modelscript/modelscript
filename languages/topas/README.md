<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/topas

Monte Carlo particle transport and proton/carbon-ion hadrontherapy DSL for TOPAS (`.topas`) and GATE (`.mac`) in ModelScript.

---

## Core Capabilities

- **TOPAS & GATE Dual-Dialect Parser**: Parses typed TOPAS parameter files (`d:`, `i:`, `b:`, `s:`, `u:`, `dv:`, `iv:`, `sv:`) and Geant4/GATE macro scripts (`.mac`).
- **Hadrontherapy Semantic Linter (`M9601`–`M9610`)**: Validates type prefixes, parent-child volume containment, positive geometry dimensions, Geant4/NIST material names, beam energies, include chains, scorer bindings, vector lengths, and duplicate assignments.
- **Analytical Bragg Peak Physics Engine**: Computes Bethe-Bloch / Bortfeld proton and carbon-ion depth-dose profiles ($R_0 = \alpha E_0^p$), range straggling $\sigma_R$, $R_{80}$, FWHM, and Linear Energy Transfer ($\text{LET}_d$).
- **Linear-Memory DAE Lowering & Polyglot Projections**: Lowers geometry volumes, beam energetics, and dosimetry metrics into `DAEBuilder`, and projects treatment nozzles and phantoms to OpenSCAD (`.scad`) and Modelica 3.x (`.mo`).
- **LSP & Workspace Index Integration**: Provides hover cards with Bragg peak depth-dose telemetry, symbol navigation, completions, and diagnostics.

---

## Package Structure

| Path                     | Description                                                             |
| ------------------------ | ----------------------------------------------------------------------- |
| `src/index.ts`           | Primary package entry point and public API re-exports                   |
| `src/language.ts`        | TOPAS / GATE language definition and actions                            |
| `src/types.ts`           | Domain types for TOPAS parameters, geometries, sources, and scorers     |
| `src/parser/`            | TOPAS (`.topas`) and GATE (`.mac`) parser                               |
| `src/lints/`             | Monte Carlo geometry, physics, and parameter linters (`M9601`–`M9610`)  |
| `src/physics/`           | Bortfeld analytical Bragg peak depth-dose solver and `DAEBuilder` arena |
| `src/projections/`       | Projections to OpenSCAD (`.scad`) and Modelica 3.x (`.mo`)              |
| `src/workspace-index.ts` | Multi-file workspace symbol indexer (`TopasWorkspaceIndex`)             |
| `src/lsp.ts`             | Language Server Protocol diagnostics, symbols, hover, and completions   |
