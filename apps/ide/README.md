<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/ide

Browser-based VS Code Web engineering environment for polyglot systems modeling, physical simulation, formal verification, and 3D CAD/CAE. Hosts VS Code Web with the ModelScript language services extension (`@modelscript/ide-client`), integrated WebAssembly solvers, interactive 3D CAD/diagram editors, a DAP simulation debugger, `.monb` interactive notebooks, and a 3-tier AI engineering assistant.

---

## Features

- **Full VS Code Web Workbench**: Complete browser-based editor experience with incremental WASM GLR parsing, semantic diagnostics, auto-completions, and AST-aware structural Git diffs.
- **Polyglot Engineering Support (All 44 Languages)**: Native editing, visualization, and verification across all 44 ModelScript languages and industrial formats — including ModelScript (`.msx`), Modelica (`.mo`), SysML v2 (`.sysml`), STEP CAD (`.step`/`.stp`), OpenSCAD (`.scad`), OWL 2 (`.owl`/`.ofn`), ReqIF (`.reqif`), CSV (`.csv`), CFD (`.cfg`/`.su2`/`.foam`), FEA (`.inp`/`.bdf`), SSP (`.ssp`), PSCAD (`.pscx`/`.pslx`), PSS/E (`.raw`), OpenDSS (`.dss`), SPICE (`.cir`), Verilog-A (`.va`), IBIS (`.ibs`), Touchstone (`.s*p`/`.ts2`), OLGA (`.opi`), PipelineStudio (`.lps`), Aspen Plus (`.inp`), ECLIPSE (`.data`), EPANET (`.inp`), SWMM (`.inp`), RELAP5 (`.r5`), EnergyPlus (`.idf`), ADAMS (`.adm`/`.cmd`), SIMPACK (`.spck`/`.sim`), GENSYS (`.calc`/`.run`), GT-SUITE (`.gtm`), SIMA (`.sima`), URDF (`.urdf`), OpenDRIVE (`.xodr`), OpenSCENARIO (`.xosc`), AUTOSAR (`.arxml`), Simulink (`.slx`), EASY5 (`.ez5`), JSBSim (`.xml`), ROCETS (`.roc`), CCSDS (`.oem`/`.xtce`), PLCopen (`.st`/`.plcxml`), SBML (`.sbml`), Fortran (`.f90`), and C (`.c`).
- **DAP Simulation Debugger**: Built-in Debug Adapter Protocol (`ModelScriptDebugSession`) supporting breakpoints on equations and algorithm statements, single-stepping across solver time steps, and live inspection of state, derivative, and algebraic variables.
- **3-Tier AI Assistant**:
  1. **Browser-Local WebGPU**: Privacy-preserving `Qwen3-0.6B` powered by WebLLM running directly on client WebGPU with zero external network calls.
  2. **Local Ollama**: Connects to a local workstation Ollama instance (`localhost:11434`) for larger local foundation models.
  3. **Hosted MCP SSE**: Connects to the ModelScript Cloud MCP SSE gateway (`/api/v1/mcp`) with full tool-calling access to all 47 MCP tools (flattening, simulation, verification, ontology queries, TGG reconciliation, and live editor code patching).
- **Interactive `.monb` Notebooks**: Native notebook serializer (`ModelicaNotebookSerializer`) and execution controller (`ModelicaNotebookController`) for literate engineering documents mixing Markdown, executable Modelica/SysML cells, and interactive plots.
- **`github://` Virtual Filesystem**: Direct repository exploration via the GitHub REST API (`github://` scheme), alongside `memfs://` for in-browser workspaces and `modelica://` for the read-only Modelica Standard Library (MSL) virtual filesystem.
- **Zero-Backend Static Deployment**: Can be compiled into a fully static distribution (`npm run build-static`) hosted on GitHub Pages or any static CDN.

---

## 18 Custom Editors

| Custom Editor              | View Type                        | Supported Formats & Capabilities                                                                                   |
| -------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Polyglot Diagram**       | `modelscript.diagram`            | Interactive schematic & block diagram editor for `.mo`, `.sysml`, `.pscx`, `.pslx`, `.owl`, `.step`, `.scad`, etc. |
| **Interactive Notebook**   | `modelscript.notebook`           | Literate multi-domain `.monb` engineering notebooks with Markdown, KaTeX, and executable simulation cells          |
| **FMU Inspector**          | `modelscript.fmuViewer`          | Inspect `modelDescription.xml`, causal ports, and run in-browser simulations of `.fmu` (FMI 2.0/3.0) archives      |
| **SSP Topology Editor**    | `modelscript.sspViewer`          | Visual architecture and signal wiring editor for `.ssp` System Structure & Parameterization containers             |
| **3D STEP CAD Viewer**     | `modelscript.stepEditor`         | Interactive 3D B-Rep solid, assembly tree, cross-section, and GD&T viewer for `.step` / `.stp` files               |
| **G-Code Toolpath**        | `modelscript.gcodeViewer`        | 3D additive/subtractive manufacturing toolpath and layer-by-layer visualizer for `.gcode` files                    |
| **3D FEA Deck Editor**     | `modelscript.inpEditor`          | 3D finite element mesh, node set, and boundary condition inspector for CalculiX/Abaqus `.inp` / `.inpt` decks      |
| **3D CFD Config Editor**   | `modelscript.cfgEditor`          | 3D flow domain, boundary patch, and solver configuration editor for SU2 `.cfg` / `.cfgt` files                     |
| **Requirements Matrix**    | `modelscript.requirementsEditor` | Interactive SysML v2 / ReqIF requirements verification table and satisfaction traceability matrix                  |
| **Element Table**          | `modelscript.elementTable`       | Spreadsheet-style editor for bulk inspection and writeback of model parameters, ports, and attributes              |
| **PSCAD Waveform Viewer**  | `modelscript.psoutViewer`        | High-performance waveform visualizer for PSCAD V5+ binary `.psout` simulation runs                                 |
| **PSS/E Power Flow**       | `modelscript.rawEditor`          | Transmission network and AC power flow inspector for Siemens PTI PSS/E `.raw` base cases                           |
| **OLGA Flowline Editor**   | `modelscript.olgaEditor`         | Multiphase pipeline flowpath, elevation profile, and valve editor for `.opi` / `.olga` models                      |
| **GT-SUITE Powertrain**    | `modelscript.gtsuiteEditor`      | 1D powertrain, cylinder kinematics, and runner schematic editor for `.gtm` / `.gtx` models                         |
| **SIMA Marine Operations** | `modelscript.simaEditor`         | Offshore floater, mooring catenary, and RAO transfer function inspector for `.sima` / `.sys` archives              |
| **EASY5 Systems Editor**   | `modelscript.easy5Editor`        | Continuous block diagram and transfer function editor for Boeing / MSC `.ez5` models                               |
| **ROCETS Propulsion**      | `modelscript.rocetsEditor`       | Rocket turbomachinery power cycle balance and thrust chamber schematic for NASA `.roc` decks                       |
| **PipelineStudio Editor**  | `modelscript.lpsEditor`          | Continental gas/liquid pipeline network topology and line pack editor for `.lps` / `.tgx` files                    |

---

## 20+ Specialized Engineering Panels & Views

- **Simulation & Plotting Panel (`SimulationPanel`)**: Multi-trace time-series plotting, interactive parameter sweep sliders, requirement limit overlays, and reachability flowpipe envelopes (Interval, Taylor Model, Zonotope).
- **Formal Verification Dashboard (`VerificationPanel`)**: Unified multi-domain verification runner orchestrating the 12 Nelson-Oppen theory oracles, decision table checks, 100% MC/DC test synthesis, and ISO 26262 Back-to-Back (MiL vs. SiL C99) equivalence proofs.
- **Structural Analysis Panel (`AnalysisPanel`)**: Tarjan Block Lower Triangular (BLT) causalization matrix, Pantelides index reduction diagnostics, class inheritance hierarchy, and instantiated component tree.
- **Multi-Physics 3D CAD & CAE Viewer (`CadViewerPanel`)**: Unified 3D viewport streaming live VTK CFD velocity/pressure fields and FEA von Mises stress/displacement contours over CAD assemblies.
- **Physics Study Setup Panel (`SimulationViewPanel`)**: Continuum FEA and CFD study configuration, automated CAD-to-mesh discretization, and solver execution.
- **Parameter Calibration Panel (`CalibrationPanel`)**: Ingest CSV sensor telemetry and calibrate model parameters via nonlinear least-squares optimization.
- **Optimal Control Panel (`OptimizationPanel`)**: Direct collocation trajectory optimization setup with state/control bounds and custom Bolza cost functions.
- **Uncertainty Quantification Panel (`UncertaintyPanel`)**: Monte Carlo and Polynomial Chaos Expansion (PCE) stochastic simulation, distribution fitting, and Sobol sensitivity analysis.
- **Surrogate ROM Trainer (`SurrogatePanel`)**: Design of Experiments (Latin Hypercube, Sobol, Full Factorial) sampler and AI Reduced Order Model (MLP, Polynomial, RBF) synthesizer exporting to ONNX, C, or Modelica.
- **Candidate Trade Study Panel (`CandidateTradeStudyPanel`)**: Multi-objective Pareto front visualization and architectural variant scoring across cost, mass, and performance budgets.
- **Digital Thread Explorer (`ThreadExplorerPanel`)**: Cross-domain hypergraph visualizer, change blast-radius analyzer, parameter synchronizer, and cryptographic hash-chain auditor.
- **Contract Hierarchy Explorer (`ContractHierarchyPanel`)**: Assume-Guarantee contract decomposition and refinement tree inspector.
- **Counterexample Trace Replay (`TraceReplayPanel`)**: Interactive step-by-step replay of SMT/CHC counterexamples and fUML/RTC state-machine execution traces.
- **OWL 2 Ontology Diagram (`OWL2DiagramPanel`)**: Interactive Description Logic taxonomy graph, axiom inspector, and concept subsumption explorer.
- **Multi-Body 3D Animation (`MultiBodyAnimationPanel`)**: Real-time 3D rigid-body kinematic animation driven by Modelica MultiBody simulation trajectories.
- **Pacemaker Programmer Workbench (`PacemakerProgrammerPanel`)**: Domain-specific medical device timing cycle, intracardiac electrogram (EGM), and state-guard verification panel.
- **Cloud HPC Job Manager (`CloudJobPanel` & `CloudStatusBar`)**: Dispatch heavy CAE/Monte Carlo sweeps to Slurm HPC clusters, stream live job telemetry, and manage compute wallet credits.
- **Co-Simulation Orchestrator (`CosimViewProvider` & `MqttTreeProvider`)**: Manage distributed FMI/MQTT co-simulation sessions, discover Unified Namespace (UNS) participants, and stream live plots.
- **Workspace & Registry Sidebar Trees**:
  - **Library Tree (`LibraryTreeProvider`)**: Browse workspace classes and the Modelica Standard Library with drag-and-drop component placement onto diagrams.
  - **Experiments Tree (`ExperimentsTreeProvider`)**: Auto-discovers `@experiment` annotations for one-click simulation runs.
  - **Package Registry (`RegistryView`)**: Search and install versioned ModelScript libraries directly into the workspace.
  - **Semantic SCM Tree (`ScmTreeView`)**: Structural AST diff tree and inline semantic review annotations for modified models.
  - **Interactive REPL (`registerRepl`)**: Built-in terminal REPL for interactive expression evaluation and workspace queries.

---

## Scripts

| Command                   | Description                                                            |
| ------------------------- | ---------------------------------------------------------------------- |
| `npm run build`           | Download VS Code Web assets and build the ModelScript & GitHub FS exts |
| `npm run build-static`    | Generate a fully static web deployment (`dist/static/`)                |
| `npm run download-vscode` | Fetch upstream VS Code Web distribution                                |
| `npm run download-model`  | Download Qwen3-0.6B WebLLM model weights (~350 MB) for AI assistant    |
| `npm run lint`            | Run ESLint across `src/` and `scripts/`                                |

---

## Running Locally

In the unified development stack (`npm run dev` from the repository root), the IDE workbench (`/ide` and `/vscode/workbench`) is served automatically through `@modelscript/web` (`http://localhost:3001/ide`) and `@modelscript/api` (`http://localhost:3000/vscode/workbench`).

To build the VS Code Web bundle and extension assets or run the standalone IDE preview server:

```bash
# 1. Download VS Code Web and build the ModelScript extension bundle
npm run download-vscode --workspace=@modelscript/ide
npm run build-extension --workspace=@modelscript/ide

# 2. (Optional) Download browser-local AI model weights
npm run download-model --workspace=@modelscript/ide
```

From the IDE workbench (`http://localhost:3001/ide`):

- Paste any public GitHub repository URL (`github://` virtual filesystem via the GitHub REST API) to load it into the workspace.
- Choose a quick-start template (`Blank Project`, `Polyglot Drone Reachability`, `Bouncing Ball`).
- Open the **ModelScript AI** assistant panel in the secondary sidebar to switch between WebGPU `Qwen3-0.6B`, local Ollama, or hosted MCP SSE.

---

## Docker

In Docker deployments (`docker compose --profile standalone up -d` or `--profile appliance up -d`), the IDE workbench, extension bundles, and WebLLM model weights are bundled directly into the unified `api` (`:3000`), `web` (`:3001`), and `appliance` (`:8080`) containers.
