<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/docs

Unified `modelscript.org` documentation portal and automated **ModelScript Reference Manual** PDF generator, powered by VitePress, KaTeX, Mermaid, Three.js, and headless Chromium.

---

## Architecture & Structure

### 1. VitePress Documentation Portal (`docs/`)

The documentation portal (`docs/`) is organized into eight comprehensive sections covering the entire polyglot ModelScript and Ansatz platform:

- **Guides (`docs/guide/`)**: Platform introduction, installation & system requirements, first polyglot workspace walkthrough, and enterprise hub administration.
- **Ansatz Platform (`docs/platform/`)**: Federated scientific & engineering network (`ansatz.social`), package registry, Morsels, scholarly citations, Git vault, and Cloud HPC compute profiles.
- **Compiler & Pipeline Architecture (`docs/architecture/`)**: End-to-end compilation pipeline, native WebAssembly GLR parser, Salsa `QueryEngine` memoization, linear-memory `DAEBuilder` arena, Triple Graph Grammars (TGG), 13-oracle Nelson-Oppen Theory Coordinator, numerical ODE/DAE solvers, and SIL / real-time HIL WebAssembly runtime.
- **Comprehensive Algorithms Catalog (`docs/algorithms/`)**: Mathematical derivations and complexity bounds for Pantelides index reduction, Tarjan BLT partitioning, Cellier-Elmqvist tearing, acausal connector balancing, automatic differentiation & saltation matrices, ODE/DAE solvers, optimization, SMT/Nelson-Oppen, CHC/IC3 verification, abstract interpretation (intervals, octagons, zonotopes), E-graphs, linear-memory arenas, surrogates, SDP/BVP/CSG, and Sugiyama/Manhattan A\* diagram layout.
- **90 Polyglot Languages & Formats (`docs/languages/`)**: Deep-dive language references across all **90 supported engineering languages and simulation formats** spanning 8 domain clusters — Systems Engineering (`modelscript`, `modelica`, `ampl`, `sysml2`, `ssp`, `reqif`, `oscal`, `owl2`, `csv`), Power, RF, Telecom & Electronics (`pscad`, `psse`, `powerfactory`, `pslf`, `cgmes`, `opendss`, `spice`, `verilog-a`, `ibis`, `touchstone`, `ocpp`, `openadr`, `optical`, `ran`, `fiber`), Fluid/Process, Subsurface, Water & Nuclear (`olga`, `lps`, `aspen`, `eclipse`, `epanet`, `swmm`, `hec-ras`, `relap5`, `energyplus`, `tough`, `modflow`, `landgem`), Multibody/Automotive/Robotics/Marine/Rail/Transit (`adams`, `simpack`, `gensys`, `gtsuite`, `sima`, `urdf`, `opendrive`, `openscenario`, `autosar`, `gtfs`), Aerospace & Controls (`simulink`, `easy5`, `jsbsim`, `rocets`, `ccsds`, `plcopen`, `automationml`), 3D CAD/CAE & Metrology (`step`, `qif`, `scad`, `usd`, `fea`, `cfd`), Chemistry/Biology & Scientific Code (`sbml`, `antimony`, `cantera`, `smiles`, `nmtran`, `sbol`, `bngl`, `sedml`, `pdb`, `genbank`, `gproms`, `phreeqc`, `fortran`, `c`), and Radiology/Oncology & Surgical CAS (`opensim`, `dicom-rt`, `cellml`, `febio`, `nifti`, `topas`, `three-mf`, `igtl`).
- **12 Industries (`docs/industries/`)**: Vertical engineering solutions across Aerospace & Defense, Electric Power & Utilities, Oil/Gas & Process, Automotive & EV, Railway & Rolling Stock, Robotics & Autonomous Systems, Semiconductors & RF, Nuclear Energy, Civil Water & Infrastructure, Smart Buildings & HVAC, Pharmaceuticals & Synthetic Biology, and Medical Devices, Radiology & Surgical Robotics.
- **Command-Line Interface (`docs/cli/`)**: Complete flag and subcommand reference for all 157 commands in the `msx` (`modelscript`) CLI.
- **Reference & Diagnostics (`docs/reference/`)**: Compiler linter rules (`M1xxx`–`M9xxx`, `S1xxx`–`S5xxx`), standards & export formats, and MCP server (`@modelscript/mcp`, 92 tools) + VS Code IDE (`@modelscript/ide-client`, 24 custom editors) reference.

### 2. Automated PDF Reference Manual Generator (`scripts/generate-pdf.ts`)

The `npm run build:pdf` script (`scripts/generate-pdf.ts`) compiles the markdown documentation into a single typeset, publication-grade PDF manual (`docs/public/modelscript-reference-manual.pdf`):

- **Server-Side KaTeX Math Rendering**: Compiles all inline (`$...$`) and display (`$$...$$`) LaTeX differential equations, matrices, and formal inference rules via `katex.renderToString`.
- **Single-Bundle HTML Assembly**: Concatenates all chapters in `DOCUMENT_STRUCTURE` order with cover page, hierarchical Table of Contents, internal cross-document anchor rewriting, syntax-highlighted code blocks, and print-optimized `@page` CSS pagination rules.
- **Headless Chromium Print-to-PDF**: Invokes headless Chromium / Google Chrome (`--headless --print-to-pdf`) to emit `docs/public/modelscript-reference-manual.pdf` for offline distribution and download from the documentation navbar.

---

## Commands & Scripts

| Script                 | Command                                   | Description                                                                                    |
| :--------------------- | :---------------------------------------- | :--------------------------------------------------------------------------------------------- |
| `npm run dev`          | `vitepress dev docs`                      | Start local VitePress development server with hot module replacement (HMR)                     |
| `npm run build`        | `tsx scripts/check-docs.ts && vitepress…` | Verify doc links/Integrity and build production static site into `docs/.vitepress/dist`        |
| `npm run build:pdf`    | `tsx scripts/generate-pdf.ts`             | Generate the complete PDF Reference Manual (`docs/public/modelscript-reference-manual.pdf`)    |
| `npm run preview`      | `vitepress preview docs`                  | Preview the built production site locally                                                      |
| `npm run check`        | `tsx scripts/gen-*.ts --check && ...`     | Verify that all generated CLI, lint, language, example, MCP, and `llms.txt` tables are in sync |
| `npm run gen`          | `npm run gen:cli && ...`                  | Regenerate all data tables (`cli`, `lint`, `lang`, `examples`, `mcp`, `llms`, and OpenGraph)   |
| `npm run gen:cli`      | `tsx scripts/gen-cli-data.ts`             | Generate CLI command reference tables from `@modelscript/cli`                                  |
| `npm run gen:lint`     | `tsx scripts/gen-lint-rules.ts`           | Generate compiler and domain linter diagnostic tables across all language packages             |
| `npm run gen:lang`     | `tsx scripts/gen-language-data.ts`        | Generate 90-language catalog metadata and maturity tier tables                                 |
| `npm run gen:examples` | `tsx scripts/gen-language-examples.ts`    | Extract and synchronize canonical code examples for all 90 languages                           |
| `npm run gen:mcp`      | `tsx scripts/gen-mcp-data.ts`             | Generate MCP server tool and resource reference data from `@modelscript/mcp`                   |
| `npm run gen:llms`     | `tsx scripts/gen-llms-txt.ts`             | Generate `llms.txt` and `llms-full.txt` context bundles for AI coding assistants               |
| `npm run gen:og`       | `tsx scripts/gen-og.ts`                   | Generate OpenGraph social preview cards for documentation pages                                |
| `npm run typecheck`    | `tsc --noEmit`                            | Run TypeScript typechecking across docs and scripts                                            |
| `npm run lint`         | `eslint docs scripts --no-warn-ignored`   | Lint markdown docs and TypeScript scripts                                                      |
| `npm run clean`        | `rimraf docs/.vitepress/dist`             | Clean built VitePress output directory                                                         |
