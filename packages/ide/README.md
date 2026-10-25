# `@modelscript/ide-client`

ModelScript VS Code Desktop & Web Extension Client (`@modelscript/ide-client`) — polyglot Language Server Protocol (`vscode-languageclient`) integration, Debug Adapter Protocol (**DAP**) equation-level simulation debugger, 3-Tier AI Engineering Copilot (WebGPU `Qwen3-0.6B`, local Ollama, hosted MCP SSE), interactive `.monb` engineering notebooks, virtual filesystems (`memfs://`, `modelica://`), 9 custom editors, and 20+ specialized engineering webview panels.

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
- **Tier 3 — Hosted MCP SSE Gateway**: Streams multi-step agentic tool calls over `/api/v1/mcp/sse`, invoking all 29 ModelScript MCP tools (`modelscript_closed_loop_synthesize`, `modelica_diff_calibrate`, `tgg_reconcile_slot`, etc.).

### 4. Interactive `.monb` Engineering Notebooks (`src/notebook-serializer.ts`, `src/notebook-controller.ts`)

- **`ModelicaNotebookSerializer` & `ModelicaNotebookController`**: Native VS Code Notebook integration for `.monb` files interleaving GitHub-Flavored Markdown + KaTeX equations (`src/markdown-it-plugin.ts`) with executable polyglot code cells (`modelica`, `sysml2`, `modelscript`, `scad`, `sparql`), rendering inline time-series plots, Bode diagrams, 3D CAD meshes, and SVG schematics.

### 5. 9 Custom Editors

1. **Bi-Directional Diagram & Schematic Editor (`src/diagram-editor-provider.ts`)**: Interactive graphical editor for `.mo`, `.sysml`, and `.pscx` files with drag-and-drop palette placement, Manhattan A\* wire routing, and real-time CST writeback.
2. **Interactive `.monb` Notebook Editor (`src/notebook-serializer.ts`)**: Literate multi-domain simulation notebooks.
3. **FMU Archive Inspector (`src/fmu-document-provider.ts`)**: Inspects FMI 2.0/3.0 `modelDescription.xml`, causal port matrices, and executes interactive FMU test runs.
4. **SSP System Topology Editor (`src/ssp-document-provider.ts`, `src/ssp-parser.ts`)**: Visual block-diagram editor for `.ssp`, `.ssd`, and `.ssv` multi-FMU architectures.
5. **Requirements & ReqIF Table Editor (`src/requirements-editor-provider.ts`)**: Interactive Requirements Traceability Matrix (RTM) and `.reqif` specification editor with suspect-link diagnostics.
6. **STEP 3D B-Rep Viewer (`src/step-editor-provider.ts`)**: Interactive 3D CAD assembly viewer for `.step`/`.stp` files.
7. **CalculiX / Abaqus FEA Deck Editor (`src/inp-editor-provider.ts`)**: Visual mesh, boundary condition, and material inspector for `.inp` structural decks.
8. **SU2 CFD Configuration Editor (`src/cfg-editor-provider.ts`)**: Interactive aerodynamic regime, boundary marker, and solver convergence editor for `.cfg` files.
9. **G-Code CNC Toolpath Viewer (`src/gcode-editor-provider.ts`)**: 3D layer-by-layer toolpath visualizer for `.gcode`/`.nc` manufacturing files.

### 6. 20+ Specialized Engineering Webview Panels & Tree Views

- **Simulation & Reachability Flowpipe Studio (`src/simulation-panel.ts`, `src/physics-setup-editor-provider.ts`)**: Multi-axis time-series oscilloscope, FFT spectrum analyzer, phase portraits, and zonotope/interval flowpipe envelope ribbons.
- **3D CAD & Multibody Animation Viewport (`src/cad-viewer-panel.ts`, `src/multibody-animation-panel.ts`, `src/vr-visualization-panel.ts`)**: Hardware-accelerated Three.js / WebXR viewport with section planes, kinematic playback, and FEA/CFD field overlays.
- **Formal Verification & Counterexample Replay (`src/verification-panel.ts`, `src/trace-replay-panel.ts`, `src/contract-hierarchy-panel.ts`)**: BMC/$k$-induction/IC3 proof dashboard, assume-guarantee contract hierarchy viewer, and step-by-step counterexample trace replay.
- **Digital Thread, Polyglot Visualizer & Trade Studies (`src/thread-explorer-panel.ts`, `src/polyglot-visualizer-panel.ts`, `src/candidate-trade-study-panel.ts`)**: Cross-domain hypergraph explorer, TGG alignment inspector, and Pareto trade-study explorer.
- **Co-Simulation & MQTT Live Studio (`src/cosim-panel.ts`, `src/mqtt-tree-provider.ts`, `src/fmu-browser-participant.ts`)**: Real-time multi-FMU and HIL co-simulation dashboard.
- **Optimization, Calibration, Surrogates & UQ (`src/optimization-panel.ts`, `src/calibration-panel.ts`, `src/surrogate-panel.ts`, `src/uncertainty-panel.ts`, `src/analysis-panel.ts`)**: Interactive parameter calibration, ROM training, Monte Carlo / Sobol sensitivity charts, and linearized state-space ($A, B, C, D$) Bode/Nyquist/Root-Locus analysis.
- **Domain Panels & Trees**: `OWL2DiagramPanel` (`src/owl2-diagram-panel.ts`), `PacemakerProgrammerPanel` (`src/pacemaker-programmer-panel.ts`), `CloudJobPanel` (`src/cloud-job-panel.ts`), `ElementTableProvider` (`src/element-table-provider.ts`), `LibraryTreeProvider` (`src/library-tree-provider.ts`), `RegistryTreeProvider` (`src/registry-tree-provider.ts`), `ExperimentsTreeProvider` (`src/experiments-tree.ts`), `ScmTreeView` & `SemanticDiffComments` (`src/scm-tree-view.ts`, `src/semantic-diff-comments.ts`), and interactive REPL (`src/repl-terminal.ts`).

---

## Scripts

```bash
# Run unit tests
npm run test --workspace=@modelscript/ide-client

# Typecheck and lint
npm run typecheck --workspace=@modelscript/ide-client
npm run lint --workspace=@modelscript/ide-client
```
