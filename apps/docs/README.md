<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/docs

Unified `modelscript.org` documentation portal and automated **ModelScript Reference Manual** PDF generator, powered by VitePress, KaTeX, Mermaid, Three.js, and headless Chromium.

---

## Architecture & Structure

### 1. VitePress Documentation Portal (`docs/`)

The documentation portal (`docs/`) is organized into eight comprehensive sections covering the entire polyglot ModelScript and Ansatz platform:

- **Guides (`docs/guide/`)**: Platform introduction, installation & system requirements, first polyglot workspace walkthrough, and enterprise hub administration.
- **Ansatz Platform (`docs/ansatz/`)**: Federated scientific & engineering network (`ansatz.social`), package registry, Morsels, scholarly citations, Git vault, and Cloud HPC compute profiles.
- **Compiler & Pipeline Architecture (`docs/architecture/`)**: End-to-end compilation pipeline, native WebAssembly GLR parser, Salsa `QueryEngine` memoization, linear-memory `DAEBuilder` arena, Triple Graph Grammars (TGG), 19-oracle Nelson-Oppen Theory Coordinator, numerical ODE/DAE solvers, and SIL / real-time HIL WebAssembly runtime.
- **Comprehensive Algorithms Catalog (`docs/algorithms/`)**: Mathematical derivations and complexity bounds for Pantelides index reduction, Tarjan BLT partitioning, Cellier-Elmqvist tearing, acausal connector balancing, automatic differentiation & saltation matrices, ODE/DAE solvers, optimization, SMT/Nelson-Oppen, CHC/IC3 verification, abstract interpretation (intervals, octagons, zonotopes), E-graphs, linear-memory arenas, surrogates, SDP/BVP/CSG, and Sugiyama/Manhattan A\* diagram layout.
- **Polyglot Languages & Formats (`docs/languages/`)**: Deep-dive language references covering **105 documented languages** across **106 total language packages** spanning 8 domain clusters — Systems Engineering (`modelscript`, `modelica`, `ampl`, `sysml2`, `ssp`, `reqif`, `magicdraw`, `oscal`, `owl2`, `sparql`, `csv`), Power, RF, Telecom & Electronics (`pscad`, `atp`, `rtds`, `psse`, `powerfactory`, `pslf`, `cgmes`, `opendss`, `gridlabd`, `cyme`, `powerworld`, `plscadd`, `matpower`, `pypsa`, `oneliner`, `sel`, `comtrade`, `scl`, `dnp3`, `iec104`, `c37118`, `spice`, `kicad`, `atopile`, `verilog-a`, `ibis`, `touchstone`, `ocpp`, `openadr`, `optical`, `ran`, `fiber`), Fluid/Process, Subsurface, Water & Nuclear (`olga`, `lps`, `aspen`, `asm`, `waterml`, `eclipse`, `epanet`, `swmm`, `hec-hms`, `hec-ras`, `relap5`, `energyplus`, `tough`, `modflow`, `landgem`, `las`), Multibody/Automotive/Robotics/Marine/Rail/Transit (`adams`, `simpack`, `gensys`, `gtsuite`, `sima`, `urdf`, `opendrive`, `openscenario`, `autosar`, `gtfs`), Aerospace & Controls (`simulink`, `easy5`, `jsbsim`, `rocets`, `ccsds`, `plcopen`, `automationml`), 3D CAD/CAE & Metrology (`step`, `qif`, `scad`, `usd`, `fea`, `cfd`), Chemistry/Biology & Scientific Code (`sbml`, `antimony`, `cantera`, `smiles`, `mlxtran`, `nmodl`, `nmtran`, `sbol`, `bngl`, `sedml`, `pdb`, `genbank`, `gproms`, `phreeqc`, `fortran`, `c`), and Radiology/Oncology & Surgical CAS (`opensim`, `dicom-rt`, `cellml`, `febio`, `nifti`, `topas`, `three-mf`, `igtl`).
- **12 Industries (`docs/industries/`)**: Vertical engineering solutions across Aerospace & Defense, Electric Power & Utilities, Oil/Gas & Process, Automotive & EV, Railway & Rolling Stock, Robotics & Autonomous Systems, Semiconductors & RF, Nuclear Energy, Civil Water & Infrastructure, Smart Buildings & HVAC, Pharmaceuticals & Synthetic Biology, and Medical Devices, Radiology & Surgical Robotics.
- **Command-Line Interface (`docs/cli/`)**: Complete flag and subcommand reference for all 146 commands in the `msx` (`modelscript`) CLI.
- **Reference & Diagnostics (`docs/reference/`)**: Compiler linter rules (`M1xxx`–`M9xxx`, `S1xxx`–`S5xxx`), standards & export formats, and MCP server (`@modelscript/mcp`, 121 tools) + VS Code IDE (`@modelscript/ide-client`, 54 registered viewTypes/panels) reference.

### 2. Automated PDF Reference Manual Generator (`scripts/generate-pdf.ts`)

The `pnpm run build:pdf` script (`scripts/generate-pdf.ts`) compiles the markdown documentation into a single typeset, publication-grade PDF manual (`docs/public/modelscript-reference-manual.pdf`):

- **Server-Side KaTeX Math Rendering**: Compiles all inline (`$...$`) and display (`$$...$$`) LaTeX differential equations, matrices, and formal inference rules via `katex.renderToString`.
- **Single-Bundle HTML Assembly**: Concatenates all chapters in `DOCUMENT_STRUCTURE` order with cover page, hierarchical Table of Contents, internal cross-document anchor rewriting, syntax-highlighted code blocks, and print-optimized `@page` CSS pagination rules.
- **Headless Chromium Print-to-PDF**: Invokes headless Chromium / Google Chrome (`--headless --print-to-pdf`) to emit `docs/public/modelscript-reference-manual.pdf` for offline distribution and download from the documentation navbar.

---

## Commands & Scripts

| Script                    | Command                                         | Description                                                                                                |
| :------------------------ | :---------------------------------------------- | :--------------------------------------------------------------------------------------------------------- |
| `pnpm run dev`            | `tsx scripts/stage-lsp-assets.ts && vitepress…` | Stage LSP assets and start local VitePress development server with hot module replacement (HMR)            |
| `pnpm run build`          | `tsx scripts/check-docs.ts && … && vitepress…`  | Verify doc links/integrity, stage LSP assets, and build production static site into `docs/.vitepress/dist` |
| `pnpm run build:pdf`      | `tsx scripts/generate-pdf.ts`                   | Generate the complete PDF Reference Manual (`docs/public/modelscript-reference-manual.pdf`)                |
| `pnpm run preview`        | `vitepress preview docs`                        | Preview the built production site locally                                                                  |
| `pnpm run check`          | `tsx scripts/gen-*.ts --check && ...`           | Verify that all generated CLI, lint, language, example, benchmark, MCP, and `llms.txt` tables are in sync  |
| `pnpm run gen`            | `npm run gen:cli && ...`                        | Regenerate all data tables (`cli`, `lint`, `lang`, `examples`, `benchmarks`, `mcp`, `llms`, OpenGraph)     |
| `pnpm run gen:cli`        | `tsx scripts/gen-cli-data.ts`                   | Generate CLI command reference tables from `@modelscript/cli` (146 commands)                               |
| `pnpm run gen:lint`       | `tsx scripts/gen-lint-rules.ts`                 | Generate compiler and domain linter diagnostic tables across all language packages                         |
| `pnpm run gen:lang`       | `tsx scripts/gen-language-data.ts`              | Generate 106-language catalog metadata and maturity tier tables                                            |
| `pnpm run gen:examples`   | `tsx scripts/gen-language-examples.ts`          | Extract and synchronize canonical code examples across language packages                                   |
| `pnpm run gen:benchmarks` | `tsx scripts/gen-benchmark-data.ts`             | Generate industrial benchmark and performance comparison tables                                            |
| `pnpm run gen:mcp`        | `tsx scripts/gen-mcp-data.ts`                   | Generate MCP server tool and resource reference data from `@modelscript/mcp` (121 tools)                   |
| `pnpm run gen:llms`       | `tsx scripts/gen-llms-txt.ts`                   | Generate `llms.txt` and `llms-full.txt` context bundles for AI coding assistants                           |
| `pnpm run gen:og`         | `tsx scripts/gen-og.ts`                         | Generate OpenGraph social preview cards for documentation pages                                            |
| `pnpm run test`           | `node ../../scripts/ci/test-runner.js`          | Run documentation data-generator and link verification tests                                               |
| `pnpm run typecheck`      | `tsc --noEmit`                                  | Run TypeScript typechecking across docs and scripts                                                        |
| `pnpm run lint`           | `eslint docs scripts --no-warn-ignored`         | Lint markdown docs and TypeScript scripts                                                                  |
| `pnpm run clean`          | `rimraf docs/.vitepress/dist`                   | Clean built VitePress output directory                                                                     |
