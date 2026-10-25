# `@modelscript/docs`

Unified `modelscript.org` documentation portal and automated **ModelScript Reference Manual** PDF generator, powered by VitePress, KaTeX, Mermaid, Three.js, and headless Chromium.

---

## Architecture & Structure

### 1. VitePress Documentation Portal (`docs/`)

The documentation portal (`docs/`) is organized into six comprehensive parts covering the entire polyglot ModelScript platform:

- **Part I — Getting Started & User Guide (`docs/guide/`)**: Platform introduction, installation & system requirements, first polyglot workspace walkthrough, and enterprise hub administration.
- **Part II — Compiler & Pipeline Architecture (`docs/architecture/`)**: End-to-end compilation pipeline, native WebAssembly GLR parser, Salsa `QueryEngine` memoization, linear-memory `DAEBuilder` arena, Triple Graph Grammars (TGG), Nelson-Oppen Theory Coordinator, numerical ODE/DAE solvers, and SIL / real-time HIL WebAssembly runtime.
- **Part III — Polyglot Languages & Formats (`docs/languages/`)**: Deep-dive language references for `.msx` (ModelScript), `.mo` (Modelica 3.x), `.sysml` (SysML v2 & KerML), `.pscx` (PSCAD EMT), `.raw` (PSS/E), `.opi` (OLGA), `.gtm` (GT-SUITE), `.sima` (SIMA), `.ez5` (EASY5), `.roc` (ROCETS), `.lps` (PipelineStudio), `.step` (ISO 10303 CAD), `.owl` (OWL 2 ontologies), `.csv` (telemetry), `.cfg`/`.su2` (CFD), `.inp` (FEA), `.scad` (OpenSCAD CSG), and `.ssp`/`.ssd` (SSP 1.0).
- **Part IV — Comprehensive Algorithms Catalog (`docs/algorithms/`)**: Mathematical derivations and complexity bounds for Pantelides index reduction, Tarjan BLT partitioning, Cellier-Elmqvist tearing, acausal connector balancing, automatic differentiation & saltation matrices, ODE/DAE solvers, optimization, SMT/Nelson-Oppen, CHC/IC3 verification, abstract interpretation (intervals, octagons, zonotopes), E-graphs, linear-memory arenas, surrogates, SDP/BVP/CSG, and Sugiyama/Manhattan A\* diagram layout.
- **Part V — Command-Line Interface (`docs/cli/`)**: Complete flag and subcommand reference for the `msx` (`modelscript`) CLI.
- **Part VI — Reference & Diagnostics (`docs/reference/`)**: Compiler linter rules (`M1xxx`–`M6xxx`, `S1xxx`–`S5xxx`), standards & export formats, and MCP server (`@modelscript/mcp`) + VS Code IDE (`@modelscript/ide-client`) reference.

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
