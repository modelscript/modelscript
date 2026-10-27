<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/lsp

ModelScript Multi-Language Server Protocol (`@modelscript/lsp`) engine — unified polyglot language intelligence across **all 44 ModelScript languages and simulation formats**, incremental Salsa `WorkspaceIndex`, background WebWorker / Worker Thread pool, full standard LSP 3.18 providers, and custom `modelica/*` & `modelscript/*` JSON-RPC endpoints for flattening, simulation, diagram synthesis, 3D CAD/FEA/CFD evaluation, and Triple Graph Grammar (TGG) writeback.

---

## Architecture & Capabilities

### 1. Unified Polyglot Language Support (All 44 Languages)

A single `@modelscript/lsp` server instance indexes and cross-references symbols across all **44 ModelScript engineering languages and formats** in a shared workspace:

- **Native & Systems Engineering (7)**: ModelScript (`.msx`), Modelica 3.x (`.mo`), SysML v2 & KerML (`.sysml`, `.kerml`), SSP 1.0 (`.ssp`, `.ssd`, `.ssv`, `.ssm`), ReqIF 1.2 (`.reqif`, `.reqifz`), OWL 2 Ontologies (`.owl`, `.ofn`), CSV Telemetry (`.csv`).
- **Power Grids, RF & Electronics (7)**: PSCAD EMT (`.pscx`, `.pslx`, `.pswx`, `.psout`), Siemens PTI PSS/E (`.raw`), EPRI OpenDSS (`.dss`), SPICE (`.cir`, `.sp`, `.spice`), Verilog-A (`.va`, `.vams`), IBIS (`.ibs`), Touchstone (`.s1p`–`.s32p`, `.ts2`).
- **Fluid, Process, Subsurface, Civil Water & Nuclear (8)**: OLGA (`.opi`, `.olga`, `.key`), PipelineStudio (`.lps`, `.tgx`, `.tlx`), Aspen Plus (`.in`, `.inp`, `.bkp`), ECLIPSE 100/300 (`.data`, `.inc`), EPANET (`.inp`), SWMM 5 (`.inp`), RELAP5-3D (`.i`, `.r5`), EnergyPlus (`.idf`, `.epjson`).
- **Multibody, Automotive, Robotics, Marine & Rail (9)**: MSC ADAMS (`.adm`, `.cmd`, `.acf`), SIMPACK (`.spck`, `.sim`, `.fbi`), GENSYS (`.calc`, `.run`, `.trax`), GT-SUITE (`.gtm`, `.gtx`), SIMA (`.sima`, `.sys`), URDF/SDF (`.urdf`, `.sdf`), ASAM OpenDRIVE (`.xodr`), ASAM OpenSCENARIO (`.xosc`, `.osc`), AUTOSAR (`.arxml`).
- **Aerospace, Flight Dynamics, Astrodynamics & Controls (6)**: Simulink (`.slx`, `.mdl`), Boeing/MSC EASY5 (`.ez5`, `.ezm`), JSBSim (`.xml`), NASA ROCETS (`.roc`), CCSDS / XTCE (`.oem`, `.opm`, `.omm`, `.xtce`), PLCopen IEC 61131-3 (`.st`, `.iec`, `.plcxml`).
- **3D CAD & Continuum Physics (4)**: ISO 10303-21 STEP (`.step`, `.stp`), OpenSCAD CSG (`.scad`), CalculiX/Nastran FEA (`.fea`, `.inp`, `.bdf`), SU2/OpenFOAM CFD (`.cfd`, `.cfg`, `.su2`, `.foam`).
- **Systems Biology & Scientific / Embedded Code (3)**: SBML (`.sbml`, `.xml`), Fortran 77/90/95 (`.f`, `.for`, `.f90`), ISO C99 (`.c`, `.h`).

Supports both Node.js IPC/stdio (`src/nodeServerMain.ts`, `@modelscript/lsp/node`) and browser WebWorker (`src/browserServerMain.ts`, `@modelscript/lsp/server`) transports.

### 2. Incremental Salsa `WorkspaceIndex` & Background Worker Pool

- **Multi-File Salsa Memoization (`src/lsp-context.ts`, `src/services/`)**: Wraps `@modelscript/runtime`'s `WorkspaceIndex` and `QueryEngine` (`fetch → deep_verify → execute → backdate`), incrementally re-evaluating only the affected symbol scopes and cross-language digital thread links when a document changes.
- **Background Worker Pool (`src/workers/worker-pool.ts`)**: Offloads CPU-intensive flattening, simulation, tetrahedral meshing, and SMT/reachability verification to background worker threads so edit-time LSP responsiveness remains sub-millisecond.
- **Virtual FileSystem (`src/vfs/`)**: Hosts virtual `modelica://` standard library packages and in-memory workspace buffers.

### 3. Standard LSP Providers (`src/providers/`)

- **Diagnostics (`src/providers/documentFeaturesProvider.ts`, `src/providers/threadDiagnosticsProvider.ts`)**: Real-time syntax errors (`M1xxx`), scope/type checking (`M2xxx`–`M5xxx`), synchronous clock & EMT checks (`M6xxx`), and cross-language Digital Thread consistency diagnostics (unit mismatches, breached requirement bounds, suspect RTM links).
- **Completion (`src/providers/completionProvider.ts`)**: Scope-aware class, component, port, modifier, keyword, and standard library FQN auto-completion.
- **Hover (`src/providers/hoverProvider.ts`)**: Rich Markdown hovers displaying resolved types, SI units, evaluated constant/parameter values, variability/causality prefixes, class documentation HTML, and inline SVG icon previews.
- **Go-to-Definition & Find References (`src/providers/definitionProvider.ts`)**: Navigates across inheritance chains (`extends`), component types, `connect()` endpoints, and cross-domain `@satisfies` / `@verifies` / `bind` links.
- **Rename & Workspace Symbols (`src/providers/workspaceFeaturesProvider.ts`)**: Safe multi-file symbol renaming and fuzzy workspace symbol search.
- **Formatting (`src/providers/formattingProvider.ts`)**: Format-preserving CST pretty-printing via `@modelscript/dsl/unparser`.
- **Code Actions & Quick Fixes**: Automated unit conversion insertions, missing parameter binding scaffolding, and TGG conflict reconciliation quick fixes.
- **Code Lenses (`src/providers/codeLensProvider.ts`)**: Inline equation/variable balance badges (`[Balanced: N vars / N eqs]`) and one-click `▶ Simulate`, `⚡ Verify`, and `📐 Diagram` triggers.
- **Semantic Tokens, Inlay Hints, Signature Help & Color Provider**: Full syntax highlighting (`src/providers/semanticTokensProvider.ts`), inferred unit/value inlay hints (`src/providers/inlayHintProvider.ts`), function argument signature help (`src/providers/signatureHelpProvider.ts`), and graphical annotation RGB color pickers (`src/providers/colorProvider.ts`).

### 4. Custom `modelica/*` & `modelscript/*` JSON-RPC Endpoints (`src/handlers/`)

- **Flattening & Class Queries (`src/handlers/classqueryEndpoints.ts`)**:
  - `modelica/flatten`, `modelica/getClasses`, `modelica/getClassInfo`, `modelica/getComponentProperties`, `modelica/getLibraryTree`: Inspects flattened DAE arenas, BLT partitions, and library hierarchies.
- **Simulation & Analysis (`src/handlers/simulationEndpoints.ts`, `src/handlers/analysisEndpoints.ts`)**:
  - `modelica/simulate`, `modelscript/simulate`, `modelscript/linearize`, `modelscript/verify`, `modelscript/calibrate`, `modelscript/runMonteCarlo`, `modelscript/trainSurrogate`: Executes ODE/DAE simulation, state-space linearization, formal verification, and UQ sweeps.
- **Diagram Preview & Bidirectional CST Writeback (`src/handlers/diagramHandler.ts`, `src/diagramEdits.ts`)**:
  - `modelica/getDiagram`, `modelscript/getDiagram`, `modelica/applyDiagramEdit`: Renders polyglot AntV X6 / SVG diagrams and applies graphical move, resize, rotate, connect, and parameter edit actions back to the source CST.
- **3D CAD, FEA, CFD & Polyglot Digital Thread (`src/handlers/polyglotEndpoints.ts`, `src/handlers/rtmEndpoints.ts`, `src/handlers/owl2Endpoints.ts`, `src/handlers/interopEndpoints.ts`)**:
  - Evaluates parametric CSG/STEP geometry, runs Tet4/Tet10 FEA and LBM CFD solvers, queries the Requirements Traceability Matrix (`RtmIndexEngine`), executes OWL 2 reasoning / SPARQL queries, and performs bidirectional TGG synchronization (`runSelfHealingPipeline`).

---

## Subpath Exports

| Subpath                     | Description                                                                                       |
| :-------------------------- | :------------------------------------------------------------------------------------------------ |
| `@modelscript/lsp`          | Root barrel exporting server entry points, `LspContext`, providers, handlers, RTM engine, and VFS |
| `@modelscript/lsp/node`     | Node.js language server entry point (`startNodeServer`)                                           |
| `@modelscript/lsp/server`   | Browser WebWorker language server entry point (`browserServerMain`)                               |
| `@modelscript/lsp/context`  | Multi-language `LspContext` and Salsa workspace coordinator                                       |
| `@modelscript/lsp/services` | Core language service implementations                                                             |
| `@modelscript/lsp/handlers` | Custom JSON-RPC request handlers (`simulation`, `analysis`, `diagram`, `polyglot`, `rtm`, `owl2`) |
| `@modelscript/lsp/bridge`   | In-memory client/server bridge for headless testing and webviews                                  |

---

## Scripts

```bash
# Compile TypeScript and bundle browser worker (dist/browserServerMain.js)
npm run build --workspace=@modelscript/lsp

# Run LSP unit and integration tests
npm run test --workspace=@modelscript/lsp

# Typecheck and lint
npm run typecheck --workspace=@modelscript/lsp
npm run lint --workspace=@modelscript/lsp
```
