<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/ide-client

ModelScript VS Code Desktop & Web Extension Client (`@modelscript/ide-client`) — polyglot Language Server Protocol (`vscode-languageclient`) integration across all 90 languages, Debug Adapter Protocol (**DAP**) equation-level simulation debugger, 3-Tier AI Engineering Copilot (WebGPU `Qwen3-0.6B`, local Ollama, hosted MCP SSE), interactive `.monb` engineering notebooks, virtual filesystems (`memfs://`, `modelica://`), 24 custom editors, and 20+ specialized engineering webview panels.

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
- **Tier 3 — Hosted MCP SSE Gateway**: Streams multi-step agentic tool calls over `/api/v1/mcp/sse`, invoking all **92 ModelScript MCP tools** (`modelscript_closed_loop_synthesize`, `modelica_diff_calibrate`, `tgg_reconcile_slot`, `pscad_verify_ieee2800`, `opendss_solve_powerflow`, `epanet_solve_hydraulics`, `optical_solve_transmission`, `ran_evaluate_mpe_safety`, `cad_fea_closed_loop_size`, `polyglot_migrate_and_verify_b2b`, `formal_verify_safety_and_mcdc`, `olga_verify`, `gensys_verify_en14363`, `qif_inspect_and_spc`, `oscal_audit_cps_compliance`, `aml_run_virtual_commissioning`, `opensim_analyze`, `dicom_rt_verify_dvh`, `cellml_simulate`, `igtl_verify_calibration`, `three_mf_verify_guide`, etc.).

### 4. Interactive `.monb` Engineering Notebooks (`src/notebook-serializer.ts`, `src/notebook-controller.ts`)

- **`ModelicaNotebookSerializer` & `ModelicaNotebookController`**: Native VS Code Notebook integration for `.monb` files interleaving GitHub-Flavored Markdown + KaTeX equations (`src/markdown-it-plugin.ts`) with executable polyglot code cells (`modelica`, `sysml2`, `modelscript`, `scad`, `sparql`), rendering inline time-series plots, Bode diagrams, 3D CAD meshes, and SVG schematics.

### 5. 24 Custom Editors

1. **Bi-Directional Diagram & Schematic Editor (`DiagramEditorProvider`, `src/diagram-editor-provider.ts`)**: Interactive graphical editor for `.mo`, `.sysml`, `.pscx`, and polyglot schematics.
2. **Interactive `.monb` Notebook Editor (`ModelicaNotebookSerializer`, `src/notebook-serializer.ts`)**: Literate multi-domain simulation notebooks.
3. **FMU Archive Inspector (`FmuEditorProvider`, `src/fmu-document-provider.ts`)**: Inspects FMI 2.0/3.0 `modelDescription.xml`, causal port matrices, and executes interactive FMU test runs.
4. **SSP System Topology Editor (`SspEditorProvider`, `src/ssp-document-provider.ts`, `src/ssp-parser.ts`)**: Visual block-diagram editor for `.ssp`, `.ssd`, and `.ssv` multi-FMU architectures.
5. **Requirements & ReqIF Table Editor (`RequirementsEditorProvider`, `src/requirements-editor-provider.ts`)**: Interactive Requirements Traceability Matrix (RTM) and `.reqif` specification editor with suspect-link diagnostics.
6. **STEP 3D B-Rep Viewer (`StepEditorProvider`, `src/step-editor-provider.ts`)**: Interactive 3D CAD assembly viewer for `.step`/`.stp` files.
7. **CalculiX / Abaqus FEA Deck Editor (`InpEditorProvider`, `src/inp-editor-provider.ts`)**: Visual mesh, boundary condition, and material inspector for `.inp` structural decks.
8. **SU2 CFD Configuration Editor (`CfgEditorProvider`, `src/cfg-editor-provider.ts`)**: Interactive aerodynamic regime, boundary marker, and solver convergence editor for `.cfg` files.
9. **G-Code CNC Toolpath Viewer (`GCodeEditorProvider`, `src/gcode-editor-provider.ts`)**: 3D layer-by-layer toolpath visualizer for `.gcode`/`.nc` manufacturing files.
10. **Element Table Editor (`ElementTableProvider`, `src/element-table-provider.ts`)**: Spreadsheet-style editor for bulk parameter inspection and writeback.
11. **PSCAD Binary Waveform Viewer (`PsoutEditorProvider`, `src/psout-editor-provider.ts`)**: High-performance multi-trace waveform visualizer for `.psout` files.
12. **PSS/E Power Flow Editor (`RawEditorProvider`, `src/raw-editor-provider.ts`)**: Transmission network and AC power flow inspector for `.raw` base cases.
13. **OLGA Multiphase Flowline Editor (`OlgaEditorProvider`, `src/olga-editor-provider.ts`)**: Pipeline flowpath, elevation profile, and valve editor for `.opi` / `.olga` models.
14. **GT-SUITE Powertrain Editor (`GtSuiteEditorProvider`, `src/gtsuite-editor-provider.ts`)**: 1D powertrain, cylinder kinematics, and runner schematic editor for `.gtm` / `.gtx` models.
15. **SIMA Marine Operations Editor (`SimaEditorProvider`, `src/sima-editor-provider.ts`)**: Offshore floater, mooring catenary, and RAO transfer function inspector for `.sima` / `.sys` files.
16. **EASY5 Systems Editor (`Easy5EditorProvider`, `src/easy5-editor-provider.ts`)**: Continuous block diagram and transfer function editor for Boeing / MSC `.ez5` models.
17. **ROCETS Propulsion Editor (`RocetsEditorProvider`, `src/rocets-editor-provider.ts`)**: Rocket turbomachinery power cycle balance and thrust chamber schematic for NASA `.roc` decks.
18. **PipelineStudio Editor (`LpsEditorProvider`, `src/lps-editor-provider.ts`)**: Continental gas/liquid pipeline network topology and line pack editor for `.lps` / `.tgx` files.
19. **QIF Dimensional Metrology & SPC Editor (`QifEditorProvider`, `src/qif-editor-provider.ts`)**: ISO 23952 QIF 3.0 3D MBD callouts, ASME Y14.5 GD&T feature control frames, and Statistical Process Control ($C_p, C_{pk}$) capability studio for `.qif` files.
20. **NIST OSCAL Security & cATO Editor (`OscalEditorProvider`, `src/oscal-editor-provider.ts`)**: NIST OSCAL 1.1.x authorization boundary, SP 800-53 Rev 5 / SP 800-82 CPS control matrix, and profile resolution workbench for `.oscal.json`/`.oscal.xml` files.
21. **AutomationML Workcell & Virtual Commissioning Editor (`AmlEditorProvider`, `src/aml-editor-provider.ts`)**: IEC 62714 CAEX PPR plant topology schematic, 3D workcell frame viewer, and closed-loop virtual commissioning runner for `.aml` files.
22. **OpenSim Musculoskeletal Biomechanics Editor (`OpenSimEditorProvider`, `src/medical-editor-provider.ts`)**: Musculoskeletal kinematic tree, Hill-type muscle force-length/force-velocity curves, and RK4 muscle activation simulator for `.osim` files.
23. **DICOM-RT Radiation Oncology Editor (`DicomRtEditorProvider`, `src/medical-editor-provider.ts`)**: Cumulative Dose-Volume Histogram (DVH), QUANTEC OAR constraints, BED/EQD2 studio, and Beam's Eye View MLC aperture visualizer for `.rtplan`/`.rtstruct`/`.rtdose` files.
24. **OpenIGTLink & PLUS Surgical Navigation Editor (`IgtlEditorProvider`, `src/medical-editor-provider.ts`)**: $SE(3)$ coordinate frame topology & orthogonality auditor, stylus pivot calibration, and Fitzpatrick Target Registration Error (TRE) analyzer for `.igtl`/`.plus.xml` files.

### 6. 20+ Specialized Engineering Webview Panels & Tree Views

- **Simulation & Reachability Flowpipe Studio (`src/simulation-panel.ts`)**: Multi-axis time-series oscilloscope, FFT spectrum analyzer, phase portraits, and zonotope/interval flowpipe envelope ribbons.
- **3D CAD, Verification Overlays & Multibody Animation Viewport (`src/cad-viewer-panel.ts`, `src/multibody-animation-panel.ts`, `src/webview/cad-viewer/`)**: Hardware-accelerated Three.js viewport with section planes, kinematic playback, FEA/CFD field overlays, and formal safety scene overlays (`reachability-tube-overlay.tsx`, `barrier-shell-overlay.tsx`, `dynamic-clearance-vector.tsx`, `requirement-verdict-card.tsx`).
- **Formal Verification & Counterexample Replay (`src/verification-panel.ts`, `src/trace-replay-panel.ts`, `src/contract-hierarchy-panel.ts`)**: BMC/$k$-induction/IC3 proof dashboard, assume-guarantee contract hierarchy viewer, and step-by-step counterexample trace replay.
- **Digital Thread & Polyglot Visualizer (`src/thread-explorer-panel.ts`, `src/polyglot-visualizer-panel.ts`)**: Cross-domain hypergraph explorer and TGG alignment inspector.
- **Co-Simulation & MQTT Live Studio (`src/cosim-panel.ts`, `src/mqtt-tree-provider.ts`, `src/fmu-browser-participant.ts`)**: Real-time multi-FMU and HIL co-simulation dashboard.
- **Optimization, Calibration, Surrogates & UQ (`src/optimization-panel.ts`, `src/calibration-panel.ts`, `src/surrogate-panel.ts`, `src/uncertainty-panel.ts`, `src/analysis-panel.ts`)**: Interactive parameter calibration, ROM training, Monte Carlo / Sobol sensitivity charts, and linearized state-space ($A, B, C, D$) Bode/Nyquist/Root-Locus analysis.
- **Domain Panels & Trees**: `OWL2DiagramPanel` (`src/owl2-diagram-panel.ts`), `OWL2ClassHierarchyProvider` (`src/owl2-class-hierarchy-provider.ts`), `OWL2PropertyHierarchyProvider` (`src/owl2-property-hierarchy-provider.ts`), `LineGeometryPanel` (`src/line-geometry-panel.ts`), `CloudJobPanel` (`src/cloud-job-panel.ts`), `ElementTableProvider` (`src/element-table-provider.ts`), `LibraryTreeProvider` (`src/library-tree-provider.ts`), `RegistryTreeProvider` (`src/registry-tree-provider.ts`), `ExperimentsTreeProvider` (`src/experiments-tree.ts`), `ScmTreeView` & `SemanticDiffComments` (`src/scm-tree-view.ts`, `src/semantic-diff-comments.ts`), and interactive REPL (`src/repl-terminal.ts`).

---

## Scripts

```bash
# Run unit tests
npm run test --workspace=@modelscript/ide-client

# Typecheck and lint
npm run typecheck --workspace=@modelscript/ide-client
npm run lint --workspace=@modelscript/ide-client
```
