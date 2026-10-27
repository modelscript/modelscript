<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/docs

Unified `modelscript.org` documentation portal and automated **ModelScript Reference Manual** PDF generator, powered by VitePress, KaTeX, Mermaid, Three.js, and headless Chromium.

---

## Architecture & Structure

### 1. VitePress Documentation Portal (`docs/`)

The documentation portal (`docs/`) is organized into six comprehensive parts covering the entire polyglot ModelScript platform:

- **Part I — Getting Started & User Guide (`docs/guide/`)**: Platform introduction, installation & system requirements, first polyglot workspace walkthrough, and enterprise hub administration.
- **Part II — Compiler & Pipeline Architecture (`docs/architecture/`)**: End-to-end compilation pipeline, native WebAssembly GLR parser, Salsa `QueryEngine` memoization, linear-memory `DAEBuilder` arena, Triple Graph Grammars (TGG), Nelson-Oppen Theory Coordinator, numerical ODE/DAE solvers, and SIL / real-time HIL WebAssembly runtime.
- **Part III — Polyglot Languages & Formats (`docs/languages/`)**: Deep-dive language references across all **44 supported engineering languages and simulation formats** — including `.msx` (ModelScript), `.mo` (Modelica 3.x), `.sysml` (SysML v2 & KerML), `.ssp`/`.ssd` (SSP 1.0), `.reqif` (ReqIF 1.2), `.owl` (OWL 2), `.csv` (telemetry), `.pscx` (PSCAD EMT), `.raw` (PSS/E), `.dss` (OpenDSS), `.cir` (SPICE), `.va` (Verilog-A), `.ibs` (IBIS), `.s*p`/`.ts2` (Touchstone), `.opi` (OLGA), `.lps` (PipelineStudio), `.inp` (Aspen Plus, EPANET, SWMM, CalculiX FEA), `.data` (ECLIPSE), `.r5` (RELAP5), `.idf` (EnergyPlus), `.adm` (ADAMS), `.spck` (SIMPACK), `.calc` (GENSYS), `.gtm` (GT-SUITE), `.sima` (SIMA), `.urdf` (URDF/SDF), `.xodr` (OpenDRIVE), `.xosc` (OpenSCENARIO), `.arxml` (AUTOSAR), `.slx` (Simulink), `.ez5` (EASY5), `.xml` (JSBSim), `.roc` (ROCETS), `.oem`/`.xtce` (CCSDS), `.st`/`.plcxml` (PLCopen), `.step` (ISO 10303 CAD), `.scad` (OpenSCAD CSG), `.cfg`/`.su2` (CFD), `.sbml` (SBML), `.f90` (Fortran), and `.c` (ISO C99).
- **Part IV — Comprehensive Algorithms Catalog (`docs/algorithms/`)**: Mathematical derivations and complexity bounds for Pantelides index reduction, Tarjan BLT partitioning, Cellier-Elmqvist tearing, acausal connector balancing, automatic differentiation & saltation matrices, ODE/DAE solvers, optimization, SMT/Nelson-Oppen, CHC/IC3 verification, abstract interpretation (intervals, octagons, zonotopes), E-graphs, linear-memory arenas, surrogates, SDP/BVP/CSG, and Sugiyama/Manhattan A\* diagram layout.
- **Part V — Command-Line Interface (`docs/cli/`)**: Complete flag and subcommand reference for the `msx` (`modelscript`) CLI.
- **Part VI — Reference & Diagnostics (`docs/reference/`)**: Compiler linter rules (`M1xxx`–`M8xxx`, `S1xxx`–`S5xxx`), standards & export formats, and MCP server (`@modelscript/mcp`) + VS Code IDE (`@modelscript/ide-client`) reference.

### 2. Automated PDF Reference Manual Generator (`scripts/generate-pdf.ts`)

The `npm run build:pdf` script (`scripts/generate-pdf.ts`) compiles all six parts of the markdown documentation into a single typeset, publication-grade PDF manual (`docs/public/modelscript-reference-manual.pdf`):

- **Server-Side KaTeX Math Rendering**: Compiles all inline (`$...$`) and display (`$$...$$`) LaTeX differential equations, matrices, and formal inference rules via `katex.renderToString`.
- **Single-Bundle HTML Assembly**: Concatenates all 46+ chapters in `DOCUMENT_STRUCTURE` order with cover page, hierarchical Table of Contents, internal cross-document anchor rewriting, syntax-highlighted code blocks, and print-optimized `@page` CSS pagination rules.
- **Headless Chromium Print-to-PDF**: Invokes headless Chromium / Google Chrome (`--headless --print-to-pdf`) to emit `docs/public/modelscript-reference-manual.pdf` for offline distribution and download from the documentation navbar.

---

## Commands & Scripts

Run these commands from the repository root (using `--workspace=@modelscript/docs`) or directly inside `apps/docs/`:

```bash
# Start local VitePress development server with hot module replacement (HMR)
npm run dev --workspace=@modelscript/docs

# Build production static site into docs/.vitepress/dist
npm run build --workspace=@modelscript/docs

# Preview the built production site locally
npm run preview --workspace=@modelscript/docs

# Generate the complete PDF Reference Manual (docs/public/modelscript-reference-manual.pdf)
npm run build:pdf --workspace=@modelscript/docs

# Run TypeScript typechecking across docs and scripts
npm run typecheck --workspace=@modelscript/docs

# Lint markdown docs and TypeScript scripts
npm run lint --workspace=@modelscript/docs
```
