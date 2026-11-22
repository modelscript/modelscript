<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/ide-client

ModelScript VS Code Desktop & Web Extension Client (`@modelscript/ide-client`) — polyglot Language Server Protocol (`vscode-languageclient`) integration across all 106 languages, Debug Adapter Protocol (**DAP**) equation-level simulation debugger, 3-Tier AI Engineering Copilot (WebGPU `Qwen3-0.6B`, local Ollama, hosted MCP SSE), interactive `.monb` engineering notebooks, virtual filesystems (`memfs://`, `modelica://`), and **54 registered viewTypes/panels** covering custom editors and specialized engineering webviews.

---

## Architecture & Capabilities

### 1. VS Code Desktop & Browser Web Extension (`src/browser-client-main.ts`)

- **Universal Extension Host**: Runs natively in both VS Code Desktop (Node.js extension host) and zero-install browser environments (`ide.modelscript.org` / VS Code for the Web) via WebWorker LSP channels (`vscode-languageclient/browser`).
- **Virtual FileSystem Providers**:
  - `memfs://` / `tmp://` (`MemoryFileSystemProvider`): In-memory read/write workspace filesystem for browser sandboxes and instant template scaffolding (`src/templates/catalog.ts`).
  - `modelica://` (`ModelicaFileSystemProvider`): Read-only virtual filesystem mounting the bundled Modelica Standard Library (MSL) and registry packages via `modelscript/getVirtualFile`.
  - `fmu-view://` & `ssp-view://`: On-the-fly ZIP virtual document providers for inspecting internal XML and C sources inside `.fmu` and `.ssp` archives.

### 2. Debug Adapter Protocol (DAP) Simulation Debugger (`src/debug-adapter.ts`)

- **`ModelScriptDebugSession` (`"type": "modelscript"`)**: Lets engineers debug continuous-time DAE integrations, hybrid `when` events, and state machines using standard VS Code debugging controls:
  - **Breakpoints**: Equation-line breakpoints, zero-crossing event traps (`breakOnZeroCrossing`), and conditional simulation time/expression triggers (e.g., `time >= 2.5` or `der(omega) < 0`).
  - **Execution Controls**: `Continue`, `Step Over` (advance one integrator step $\Delta t$), `Step Into` (advance single statement/micro-step iteration), and `Restart` (`Step Back` reverse-time trajectory scrubbing is reserved for future adjoint solvers).
  - **Live Variable Scopes**: Inspect `States (x)`, `Derivatives (der(x))`, `Algebraic Variables (y)`, `Parameters (p)`, `Discrete / Clocked`, and solver health metrics (`h`, local error, Jacobian condition number).

### 3. 3-Tier AI Engineering Assistant (`src/chat-panel.ts`, `src/chat-participant.ts`, `src/llm-provider.ts`, `src/mcp-bridge.ts`)

- **Tier 1 — In-Browser WebGPU (`@mlc-ai/web-llm`, `Qwen3-0.6B`)**: 100% local, zero-egress GPU inference inside the browser or desktop webview for air-gapped syntax assistance, equation explanation, and unit checks.
- **Tier 2 — Local Workstation Inference (`Ollama` / `vLLM`)**: Connects to local OpenAI-compatible endpoints (`http://localhost:11434`) with tool-calling bound to the in-process `@modelscript/mcp` bridge (`registerMCPTools`).
- **Tier 3 — Hosted MCP SSE Gateway**: Streams multi-step agentic tool calls over `/api/v1/mcp/sse`, invoking all **121 ModelScript MCP tools** (`modelscript_closed_loop_synthesize`, `modelica_diff_calibrate`, `tgg_reconcile_slot`, `pscad_verify_ieee2800`, `opendss_solve_powerflow`, `epanet_solve_hydraulics`, `optical_solve_transmission`, `ran_evaluate_mpe_safety`, `cad_fea_closed_loop_size`, `polyglot_migrate_and_verify_b2b`, `formal_verify_safety_and_mcdc`, `olga_verify`, `gensys_verify_en14363`, `qif_inspect_and_spc`, `oscal_audit_cps_compliance`, `aml_run_virtual_commissioning`, `opensim_analyze`, `dicom_rt_verify_dvh`, `cellml_simulate`, `igtl_verify_calibration`, `three_mf_verify_guide`, `magicdraw_inspect`, `alm_trace_coverage`, `run_uq`, etc.).

### 4. Interactive `.monb` Engineering Notebooks (`src/notebook-serializer.ts`, `src/notebook-controller.ts`)

- **`ModelicaNotebookSerializer` & `ModelicaNotebookController`**: Native VS Code Notebook integration for `.monb` files interleaving GitHub-Flavored Markdown + KaTeX equations (`src/markdown-it-plugin.ts`) with executable polyglot code cells (`modelica`, `sysml2`, `modelscript`, `scad`, `sparql`), rendering inline time-series plots, Bode diagrams, 3D CAD meshes, and SVG schematics.

### 5. Custom Editors (54 Registered ViewTypes & Panels)

Dedicated custom editor providers:

1. **Bi-Directional Diagram & Schematic Editor (`src/diagram-editor-provider.ts`)**: Interactive graphical editor for `.mo`, `.sysml`, `.pscx`, and polyglot schematics.
2. **Interactive `.monb` Notebook Editor (`src/notebook-serializer.ts`)**: Literate multi-domain simulation notebooks.
3. **FMU Archive Inspector (`src/fmu-document-provider.ts`)**: Inspects FMI 2.0/3.0 `modelDescription.xml`, causal port matrices, and executes interactive FMU test runs.
4. **SSP System Topology Editor (`src/ssp-document-provider.ts`, `src/ssp-parser.ts`)**: Visual block-diagram editor for `.ssp`, `.ssd`, and `.ssv` multi-FMU architectures.
5. **Requirements & ReqIF Table Editor (`src/requirements-editor-provider.ts`)**: Interactive Requirements Traceability Matrix (RTM) and `.reqif` specification editor with suspect-link diagnostics.
6. **STEP 3D B-Rep Viewer (`src/step-editor-provider.ts`)**: Interactive 3D CAD assembly viewer for `.step`/`.stp` files.
7. **G-Code CNC Toolpath Viewer (`src/gcode-editor-provider.ts`)**: 3D layer-by-layer toolpath visualizer for `.gcode`/`.nc` manufacturing files.
8. **Element Table Editor (`src/element-table-provider.ts`)**: Spreadsheet-style editor for bulk parameter inspection and writeback.
9. **PSCAD Binary Waveform Viewer (`src/psout-editor-provider.ts`)**: High-performance multi-trace waveform visualizer for `.psout` files.
10. **Tabular Plot Editor (`src/tabular-plot-editor-provider.ts`)**: Interactive tabular dataset and multi-series waveform viewer for CSV and telemetry files.
11. **Unified DSL Custom Editor Provider (`src/dsl-custom-editor-provider.ts`)**: Consolidates domain-specific custom editors into a single declarative provider covering CalculiX/Abaqus FEA (`.inp`), SU2 CFD (`.cfg`), PSS/E (`.raw`), OLGA (`.opi`/`.olga`), GT-SUITE (`.gtm`/`.gtx`), SIMA (`.sima`/`.sys`), EASY5 (`.ez5`), ROCETS (`.roc`), PipelineStudio (`.lps`/`.tgx`), QIF (`.qif`), NIST OSCAL (`.oscal.json`/`.oscal.xml`), AutomationML (`.aml`), OpenSim (`.osim`), DICOM-RT (`.rtplan`/`.rtstruct`/`.rtdose`), OpenIGTLink/PLUS (`.igtl`/`.plus.xml`), and additional engineering formats.

### 6. Specialized Engineering Webview Panels & Tree Views

- **Simulation & Reachability Flowpipe Studio (`src/simulation-panel.ts`)**: Multi-axis time-series oscilloscope, FFT spectrum analyzer, phase portraits, and zonotope/interval flowpipe envelope ribbons.
- **3D CAD, Verification Overlays & Multibody Animation Viewport (`src/cad-viewer-panel.ts`, `src/multibody-animation-panel.ts`, `src/webview/cad-viewer/`)**: Hardware-accelerated Three.js viewport with section planes, kinematic playback, FEA/CFD field overlays, and formal safety scene overlays.
- **Formal Verification & Counterexample Replay (`src/verification-panel.ts`, `src/verification-gates-tree-provider.ts`, `src/trace-replay-panel.ts`, `src/contract-hierarchy-panel.ts`)**: BMC/$k$-induction/IC3 proof dashboard, verification gates tree, assume-guarantee contract hierarchy viewer, and step-by-step counterexample trace replay.
- **Digital Thread & Polyglot Visualizer (`src/thread-explorer-panel.ts`, `src/polyglot-visualizer-panel.ts`)**: Cross-domain hypergraph explorer and TGG alignment inspector.
- **Co-Simulation & MQTT Live Studio (`src/cosim-panel.ts`, `src/mqtt-tree-provider.ts`, `src/fmu-browser-participant.ts`)**: Real-time multi-FMU and HIL co-simulation dashboard.
- **Optimization, Calibration, Surrogates & UQ (`src/optimization-panel.ts`, `src/calibration-panel.ts`, `src/surrogate-panel.ts`, `src/uncertainty-panel.ts`, `src/analysis-panel.ts`)**: Interactive parameter calibration, ROM training, Monte Carlo / Sobol sensitivity charts, and linearized state-space ($A, B, C, D$) Bode/Nyquist/Root-Locus analysis.
- **Scientific & Domain Visualization Panels**:
  - `src/molstar-panel.ts` (Mol\* 3D macromolecular structure viewer), `src/quantum-chemistry-panel.ts`, `src/reaction-coordinate-panel.ts`, `src/crystallography-panel.ts`
  - `src/electrophysiology-panel.ts`, `src/neural-spike-panel.ts`
  - `src/seismic-viewer-panel.ts`, `src/climate-raster-panel.ts`, `src/water-diff-panel.ts`
  - `src/optical-bench-panel.ts`, `src/tokamak-equilibrium-panel.ts`, `src/fits-image-panel.ts`, `src/hep-event-panel.ts`, `src/accelerator-lattice-panel.ts`
  - `src/alm-remotes-panel.ts` (ALM remote synchronization & traceability panel)
- **Domain Trees, Collaboration & Workspace Utilities**: `OWL2ClassHierarchyProvider` (`src/owl2-class-hierarchy-provider.ts`), `OWL2PropertyHierarchyProvider` (`src/owl2-property-hierarchy-provider.ts`), `LineGeometryPanel` (`src/line-geometry-panel.ts`), `CloudJobPanel` (`src/cloud-job-panel.ts`), `CollabPresence` (`src/collab-presence.ts`), `LibraryTreeProvider` (`src/library-tree-provider.ts`), `RegistryTreeProvider` (`src/registry-tree-provider.ts`), `ExperimentsTreeProvider` (`src/experiments-tree.ts`), `ScmTreeView` & `SemanticDiffComments` (`src/scm-tree-view.ts`, `src/semantic-diff-comments.ts`), and interactive REPL (`src/repl-terminal.ts`).

---

## Scripts

```bash
# Run unit tests
pnpm --filter @modelscript/ide-client run test

# Typecheck, lint, and clean
pnpm --filter @modelscript/ide-client run typecheck
pnpm --filter @modelscript/ide-client run lint
pnpm --filter @modelscript/ide-client run clean
```
