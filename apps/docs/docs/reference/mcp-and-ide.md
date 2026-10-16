# MCP Server & IDE Workbench Reference

ModelScript provides first-class AI agent integration via the **Model Context Protocol (`@modelscript/mcp`)** alongside a comprehensive polyglot **VS Code Extension & Web IDE (`@modelscript/ide-client`, `@modelscript/lsp`)**. Both surfaces share the same zero-allocation WebAssembly GLR parsers, Salsa `QueryEngine`, and linear-memory `DAEBuilder`.

---

## Part I: Model Context Protocol (MCP) Server

The `@modelscript/mcp` package exposes ModelScript's compilation, simulation, formal verification, ontology reasoning, Triple Graph Grammar (TGG) synchronization, and requirements traceability engines to MCP-compatible AI coding assistants (Claude Desktop, Cursor, Windsurf, Antigravity, Zed, and custom LLM orchestrators).

### 1. Deployment Modes & Transports

ModelScript supports three MCP execution architectures:

#### A. Local `stdio` Server (`modelscript-mcp`)

For local desktop AI agents, run the `modelscript-mcp` binary over standard input/output (`StdioServerTransport`):

```json
{
  "mcpServers": {
    "modelscript": {
      "command": "npx",
      "args": ["-y", "@modelscript/mcp"],
      "env": {
        "MODELICAPATH": "/path/to/ModelicaStandardLibrary"
      }
    }
  }
}
```

#### B. Hosted Enterprise SSE Gateway (`/api/v1/mcp`)

The ModelScript Enterprise Hub (`apps/api/src/routes/mcp.ts`) exposes a multi-tenant HTTP Server-Sent Events (SSE) MCP gateway with built-in compute credit metering:

- **`GET /api/v1/mcp/sse`**: Establishes a persistent SSE stream (`text/event-stream`), authenticates the caller via `Authorization: Bearer <JWT | ms_bot_*>`, and returns a session-scoped `endpoint` event (`/api/v1/mcp/messages?sessionId=<uuid>`).
- **`POST /api/v1/mcp/messages?sessionId=<uuid>`**: Receives JSON-RPC 2.0 `tools/call` and `resources/read` requests, checks organization compute credit balances via `BillingService` (1 credit per lightweight query, 5 credits for `modelica_simulate` / `hybrid_simulate` / `modelica_doe` / `modelscript_closed_loop_synthesize`), and streams results over the SSE channel.

#### C. In-WASM AOT Polyglot Dispatch (`PolyglotMcpHost`)

In browser workers and edge sandboxes (`packages/mcp/src/polyglot-server.ts`), `PolyglotMcpHost` dynamically synthesizes MCP tool schemas from every registered `LanguageDefinition` (`defineLanguage({ mcp: { tools, resources } })`). When a tool declares an `aotExport` symbol, `PolyglotMcpHost` writes the arguments directly into WebAssembly linear memory (`__newString`), invokes the compiled AssemblyScript kernel (`mcpDispatchTool(toolId, targetPtr, paramsJsonPtr)`), and reads back the JSON result with zero JS object marshaling overhead.

---

### 2. Complete Reference of All 29 Core MCP Tools

The canonical MCP server (`packages/mcp/src/tools.ts`) registers **29 specialized engineering tools** grouped across six functional domains:

#### Domain 1: Modelica Compilation, Simulation & Sensitivity (9 Tools)

| Tool Name              | Required Arguments                                                                          | Optional Arguments                                                                                                                                                                                                                                          | Description                                                                                                                                                        |
| :--------------------- | :------------------------------------------------------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `modelica_load`        | `path: string`                                                                              | —                                                                                                                                                                                                                                                           | Load a `.mo` file or package directory from disk into the stateful MCP workspace session and return all discovered class FQNs.                                     |
| `modelica_parse`       | —                                                                                           | `code?: string`, `path?: string`                                                                                                                                                                                                                            | Parse Modelica source text or a file using the native WASM GLR parser and return CST syntax diagnostics and top-level class names.                                 |
| `modelica_flatten`     | `className: string`                                                                         | `code?: string`, `path?: string`                                                                                                                                                                                                                            | Flatten a hierarchical Modelica class into a canonical DAE (`ArenaDAEPrinter` output) and return variable/equation counts and flattened source text.               |
| `modelica_lint`        | —                                                                                           | `code?: string`, `path?: string`                                                                                                                                                                                                                            | Execute all `M1xxx`–`M6xxx` static lint rules and Salsa semantic queries, returning structured diagnostics with line/column spans.                                 |
| `modelica_simulate`    | `className: string`                                                                         | `code?: string`, `path?: string`, `tStart?: number` (`0`), `tEnd?: number` (`1`), `dt?: number` (`0.01`), `tolerance?: number` (`1e-6`), `method?: "euler" \| "rk4" \| "dopri5" \| "bdf" \| "radau5" \| "cvode" \| "ida"` (`"rk4"`), `variables?: string[]` | Flatten, index-reduce (Pantelides + BLT tearing), and numerically simulate a Modelica model, returning downsampled time-series trajectories and solver statistics. |
| `hybrid_simulate`      | `className: string`                                                                         | `code?: string`, `path?: string`, `tStart?: number` (`0`), `tEnd?: number` (`10`), `dt?: number` (`0.01`), `maxEvents?: number` (`500`)                                                                                                                     | Run hybrid continuous/discrete event-driven simulation with zero-crossing root finding (`when` clauses, `reinit()`, state machines, and synchronous clocks).       |
| `modelica_doe`         | `className: string`, `parameters: Record<string, number[]>`                                 | `code?: string`, `path?: string`, `tEnd?: number` (`1`), `dt?: number` (`0.01`), `metrics?: string[]`                                                                                                                                                       | Execute a Cartesian/factorial Design of Experiments (DoE) sweep across parameter combinations and return terminal/summary metrics for each run.                    |
| `modelica_sensitivity` | `className: string`, `parameters: string[]`, `outputs: string[]`                            | `code?: string`, `path?: string`, `tEnd?: number` (`1`), `dt?: number` (`0.01`), `perturbation?: number` (`0.01`)                                                                                                                                           | Compute normalized local sensitivity Jacobians ($\frac{\partial y_i}{\partial p_j} \cdot \frac{p_j}{y_i}$) via central finite differences or forward AD.           |
| `modelica_query`       | `queryType: "list_classes" \| "class_info" \| "components" \| "equations" \| "connections"` | `className?: string`                                                                                                                                                                                                                                        | Query the active Salsa `SymbolIndex` for class specializations, typed component declarations, equations, or `connect()` topology edges.                            |

#### Domain 2: Cross-Domain Consistency & Ontology Reasoning (5 Tools)

| Tool Name                     | Required Arguments                                                                                 | Optional Arguments                                            | Description                                                                                                                                                            |
| :---------------------------- | :------------------------------------------------------------------------------------------------- | :------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validate_system_consistency` | `sysmlCode: string`, `modelicaCode: string`                                                        | `mapping?: Record<string, string>`                            | Cross-check a SysML v2 architecture definition against a Modelica physics implementation for port mismatches, unit conflicts, and unsatisfied requirement constraints. |
| `query_ontology_sparql`       | `ontologyText: string`, `sparqlQuery: string`                                                      | `enableReasoning?: boolean` (`true`)                          | Parse an OWL 2 Functional Syntax or Turtle ontology, optionally run OWL 2 RL forward-chaining inference, and execute a SPARQL 1.1 `SELECT`/`ASK` query.                |
| `query_ontology_bgp`          | `ontologyText: string`, `patterns: Array<{subject?: string, predicate?: string, object?: string}>` | `enableReasoning?: boolean` (`true`)                          | Match Basic Graph Patterns (BGP) against the inferred RDF triple store and return variable bindings.                                                                   |
| `trace_fault_propagation`     | `ontologyText: string`, `faultSourceIri: string`                                                   | `propagationPropertyIri?: string`, `maxDepth?: number` (`10`) | Traverse transitive causal/containment relationships across the ontological knowledge graph to compute downstream failure blast radius and FMEA impact chains.         |
| `explain_inference`           | `ontologyText: string`, `subject: string`, `predicate: string`, `object: string`                   | —                                                             | Construct a formal proof derivation tree explaining which OWL 2 RL rules and asserted axioms entailed a specific inferred triple $(s, p, o)$.                          |

#### Domain 3: Triple Graph Grammar (TGG) Digital Thread Synchronization (3 Tools)

| Tool Name               | Required Arguments                                                                                | Optional Arguments                                    | Description                                                                                                                                                            |
| :---------------------- | :------------------------------------------------------------------------------------------------ | :---------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tgg_query_thread`      | `sysmlCode: string`, `modelicaCode: string`                                                       | `spiceCode?: string`                                  | Build the multi-domain Triple Graph Grammar correspondence graph across SysML v2, Modelica, and SPICE, returning synchronized element triples and orphan nodes.        |
| `tgg_diagnose_conflict` | `sysmlCode: string`, `modelicaCode: string`                                                       | `baseSysmlCode?: string`, `baseModelicaCode?: string` | Run Critical Pair Analysis (CPA) over concurrent modifications in SysML v2 and Modelica to detect conflicting edits on shared parameters or ports.                     |
| `tgg_reconcile_slot`    | `sysmlCode: string`, `modelicaCode: string`, `slotId: string`, `authority: "sysml" \| "modelica"` | —                                                     | Resolve a parameter or structural divergence on `slotId` by propagating the authoritative domain's value across the TGG rule engine and returning updated source code. |

#### Domain 4: Requirements Traceability Matrix (RTM) Intelligence (3 Tools)

| Tool Name              | Required Arguments                                                       | Optional Arguments            | Description                                                                                                                                                                  |
| :--------------------- | :----------------------------------------------------------------------- | :---------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rtm_query_matrix`     | `files: Record<string, string>`                                          | —                             | Extract all requirements, architectural elements, physics models, and verification cases across a polyglot file map and compute coverage percentages and orphan counts.      |
| `rtm_suggest_links`    | `files: Record<string, string>`                                          | `threshold?: number` (`0.35`) | Analyze identifier lexical similarity, shared physical quantities/units, and structural proximity to recommend missing `@satisfies` and `@verifies` traceability links.      |
| `rtm_diagnose_suspect` | `baseFiles: Record<string, string>`, `headFiles: Record<string, string>` | —                             | Compare two workspace snapshots via semantic AST fingerprinting to flag downstream `@satisfies`/`@verifies` links as `SUSPECT` when upstream requirement expressions change. |

#### Domain 5: Autonomous Closed-Loop Synthesis, Calibration & Workspace Editing (5 Tools)

| Tool Name                            | Required Arguments                                                                                                                                                               | Optional Arguments                                                                                                  | Description                                                                                                                                                                            |
| :----------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `modelscript_closed_loop_synthesize` | `className: string`, `modelicaCode: string`, `requirements: Array<{variable: string, condition: "lt" \| "gt" \| "eq" \| "between", threshold: number, upperThreshold?: number}>` | `tunableParameters?: string[]`, `maxIterations?: number` (`10`), `tEnd?: number` (`5.0`)                            | Execute an autonomous compile $\to$ lint $\to$ simulate $\to$ STL robustness evaluation $\to$ sensitivity-guided parameter tuning loop until all formal requirements pass.             |
| `modelscript_patch_code`             | `filePath: string`, `search: string`, `replace: string`                                                                                                                          | `validateBeforeWrite?: boolean` (`true`)                                                                            | Apply a surgical search-and-replace edit to a workspace file, automatically running the WASM GLR parser and linter before committing the write to disk.                                |
| `modelscript_read_file`              | `filePath: string`                                                                                                                                                               | `startLine?: number`, `endLine?: number`                                                                            | Read source lines from a workspace file within the sandboxed root directory.                                                                                                           |
| `modelscript_list_workspace_files`   | —                                                                                                                                                                                | `directory?: string`, `extensions?: string[]`                                                                       | Recursively list engineering source files (`.mo`, `.sysml`, `.msx`, `.pscx`, `.scad`, `.stp`, `.owl`, `.ssp`, `.csv`) in the active workspace.                                         |
| `modelica_diff_calibrate`            | `className: string`, `modelicaCode: string`, `parameters: string[]`, `referenceData: {time: number[], signals: Record<string, number[]>}`                                        | `learningRate?: number` (`0.05`), `maxEpochs?: number` (`50`), `parameterBounds?: Record<string, [number, number]>` | Calibrate unknown physical parameters against experimental CSV/reference trajectories using differentiable simulation and gradient descent (Adam / L-BFGS) to minimize trajectory MSE. |

#### Domain 6: PSCAD Power Systems & IEEE 2800 Grid Compliance (4 Tools)

| Tool Name               | Required Arguments                                                 | Optional Arguments                                   | Description                                                                                                                                                   |
| :---------------------- | :----------------------------------------------------------------- | :--------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pscad_lint`            | `xmlContent: string`                                               | `fileName?: string`                                  | Run all 11 electrical EMT lint rules (`M6001`–`M6011`) on a `.pscx` or `.pswx` XML payload.                                                                   |
| `pscad_simulate`        | `xmlContent: string`                                               | `tStop?: number` (`1.0`), `stepUs?: number` (`20.0`) | Execute a fixed-step nodal admittance EMT simulation on a `.pscx` case and return three-phase bus voltage, branch current, and CSMF control signal waveforms. |
| `pscad_verify_ieee2800` | `xmlContent: string`                                               | `tStop?: number` (`3.0`), `stepUs?: number` (`20.0`) | Run automated **IEEE Std 2800-2022** LVRT/HVRT voltage ride-through, frequency ride-through, and reactive current injection compliance verification.          |
| `pscad_export`          | `xmlContent: string`, `targetFormat: "modelica" \| "ssp" \| "svg"` | —                                                    | Convert a PSCAD `.pscx` schematic into an executable Modelica `.mo` model, an SSP 1.0 `.ssd` descriptor, or a rendered Single-Line Diagram SVG.               |

#### Declarative Polyglot Language Tools (`PolyglotMcpHost`)

When using `PolyglotMcpHost` (`packages/mcp/src/polyglot-server.ts`), additional language-declared tools from `languages/*/src/language.ts` are automatically mounted:

- `sysml2_extract_topology`: Extracts hierarchical part definitions, ports, and item flow connections from a `.sysml` workspace symbol (`aotExport: "mcp_sysml2_extract_topology"`).
- `sysml2_verify_requirements`: Evaluates SysML v2 `requirement def` constraint satisfaction across the workspace (`aotExport: "mcp_sysml2_verify_requirements"`).

---

### 3. MCP Resources (`resources/list` & `resources/read`)

The MCP server exposes live workspace state as URI-addressable resources (`packages/mcp/src/resources.ts` and `languages/*/src/language.ts`):

| Resource URI / Template                  | MIME Type          | Description                                                                                                                        |
| :--------------------------------------- | :----------------- | :--------------------------------------------------------------------------------------------------------------------------------- |
| `modelica://libraries`                   | `application/json` | Lists all loaded Modelica package roots and top-level libraries in the current session.                                            |
| `modelica://classes`                     | `application/json` | Lists every indexed class FQN, specialized kind (`model`, `block`, `connector`, `record`, `function`, `package`), and description. |
| `modelica://classes/{name}`              | `application/json` | Returns full class metadata for `{name}`, including source text, components, equations, and `connect()` clauses.                   |
| `modelica://workspace/{className}/ast`   | `application/json` | (`PolyglotMcpHost`) Serializes the linear CST/AST structure of `{className}`.                                                      |
| `modelica://workspace/{className}/dae`   | `application/json` | (`PolyglotMcpHost`) Returns the lowered DAE variables, parameters, and equations for `{className}`.                                |
| `sysml2://workspace/{partName}/topology` | `application/json` | (`PolyglotMcpHost`) Returns the resolved port and connection graph for a SysML v2 part.                                            |

---

## Part II: VS Code Extension & Web IDE Workbench

The official ModelScript extension (`modelscript.modelscript`, source in `apps/ide/` and `packages/lsp/`) runs both in **VS Code Desktop** (Node.js extension host) and **VS Code for the Web / `ide.modelscript.org`** (100% browser WebWorker host).

### 1. Polyglot Language Server (`@modelscript/lsp`)

A single unified Language Server Protocol instance provides sub-millisecond incremental intelligence across all 12 registered languages (`.mo`, `.sysml`, `.kerml`, `.msx`, `.pscx`, `.pswx`, `.scad`, `.stp`, `.step`, `.owl`, `.ssp`, `.ssd`, `.ssv`, `.csv`, `.su2`, `.cfg`, `.inp`, `.gbr`):

- **Real-Time Diagnostics**: Incremental GLR parsing + Salsa `lint__*` queries + cross-file unit/type checking.
- **Navigation & Refactoring**: Go-to-Definition, Find All References (across `.sysml` $\leftrightarrow$ `.mo` $\leftrightarrow$ `.msx` boundaries), Workspace Symbol Search, Rename Symbol, and Document Outline.
- **Code Lenses & Inlay Hints**: Inline equation/variable balance badges (`[Balanced: 14 vars / 14 eqs]`), inferred SI unit inlay hints, and one-click `▶ Simulate`, `⚡ Verify`, and `📐 Render Diagram` CodeLenses above every `model`, `part def`, and `verification def`.

### 2. Debug Adapter Protocol (DAP) Simulation Debugger

ModelScript registers a full **Debug Adapter Protocol** implementation (`"type": "modelscript"`) that lets engineers step through continuous-time DAE integrations, state-machine transitions, and zero-crossing events exactly like stepping through imperative code:

- **Time & Condition Breakpoints**: Set breakpoints on equation lines, `when` clauses, state transitions, or conditional simulation expressions (e.g., `time >= 2.5` or `der(omega) < 0`).
- **Execution Controls**: `Continue`, `Step Over` (advance one solver step $\Delta t$), `Step Into` (step into Newton-Raphson / event-iteration micro-steps), `Step Back` (reverse-time trajectory scrubbing), and `Restart`.
- **Live Inspection Scopes**: Inspect `States (x)`, `Derivatives (der(x))`, `Algebraic Variables (y)`, `Parameters (p)`, `Discrete / Clocked`, and `Solver Telemetry (h, localError, jacobianCond)` in the VS Code Variables and Watch panes.

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "modelscript",
      "request": "launch",
      "name": "Debug Modelica Simulation",
      "model": "Modelica.Mechanics.Rotational.Examples.First",
      "program": "${file}",
      "stopTime": 5.0,
      "solver": "rodas4p",
      "breakOnZeroCrossing": true
    }
  ]
}
```

### 3. Virtual Filesystems & Interactive Notebooks (`.monb`)

- **Virtual FileSystem Providers**:
  - `modelica://`: Read-only browsable virtual filesystem mounting the bundled Modelica Standard Library (MSL) and installed registry packages (`modelica_modules/`).
  - `memfs://`: Ephemeral in-memory workspace used in the browser IDE (`ide.modelscript.org`).
  - `github://`: Zero-clone direct browsing and editing of remote GitHub repositories.
- **ModelScript Interactive Notebooks (`modelscript.monbNotebook`)**:
  - Native VS Code `NotebookSerializer` and `NotebookController` for `.monb` files.
  - Supports polyglot code cells (`modelica`, `sysml2`, `modelscript`, `scad`, `sparql`) that share a reactive kernel session, rendering interactive Bode plots, time-series charts, 3D CAD viewports, and SVG schematics directly below each cell.

### 4. Custom Document Editors & Engineering Workbench Panels

The extension contributes **9 custom visual editors** and **over 20 specialized engineering webview panels**:

| Custom Editor / View ID                         | Bound File Types / Trigger               | Capabilities                                                                                                                                                        |
| :---------------------------------------------- | :--------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `modelscript.diagramEditor`                     | `.mo`, `.sysml`, `.pscx`                 | Bi-directional graphical schematic & SysML v2 (BDD/IBD/State/Activity) editor; dragging components or routing wires updates the underlying source CST in real time. |
| `modelscript.monbNotebook`                      | `.monb`                                  | Literate engineering notebook combining Markdown/LaTeX narratives with live simulation and verification cells.                                                      |
| `modelscript.fmuViewer`                         | `.fmu`                                   | Inspects FMI 2.0/3.0 `modelDescription.xml`, causal ports, dependency sparsity matrices, and runs interactive test simulations on `.fmu` files.                     |
| `modelscript.sspEditor`                         | `.ssp`, `.ssd`, `.ssv`                   | Visual block-diagram editor for wiring multi-FMU co-simulation topologies and editing `.ssv` parameter tables.                                                      |
| `modelscript.reqifEditor`                       | `.reqif`, `.reqifz`                      | Tabular requirements specification editor with suspect-link indicators and one-click SysML v2 synchronization.                                                      |
| `modelscript.cadViewer`                         | `.stp`, `.step`, `.scad`, `.stl`, `.glb` | Hardware-accelerated Three.js / WebGL 3D CAD viewport with section planes, B-Rep face selection, and kinematic animation playback.                                  |
| `modelscript.gerberViewer`                      | `.gbr`, `.drl`                           | Multi-layer 2D/3D PCB copper, solder mask, silkscreen, and drill stackup inspector.                                                                                 |
| `modelscript.cfdViewer`                         | `.su2`, `.vtk`, `.cfg`                   | Unstructured CFD mesh wireframe, boundary marker inspector, and pressure/velocity contour viewer.                                                                   |
| `modelscript.feaViewer`                         | `.inp`, `.frd`                           | Finite-element mesh inspector with deformed shape magnification and von Mises stress colormaps.                                                                     |
| **Simulation & Bode Plot Studio**               | `modelscript.simulate`                   | Interactive multi-axis oscilloscope, FFT spectrum analyzer, phase portrait plotter, and linearized State-Space ($A,B,C,D$) Bode/Nyquist root-locus analyzer.        |
| **BLT & Tearing Matrix Inspector**              | `modelscript.inspectBlt`                 | Visualizes the Tarjan Block Lower Triangular incidence matrix, Pantelides differentiated equations, and Cellier-Elmqvist tearing variables.                         |
| **Formal Verification & Counterexample Center** | `modelscript.verify`                     | Interactive dashboard for running BMC/$k$-induction/IC3/STL falsification and replaying falsifying counterexample traces step-by-step on the schematic.             |
| **Digital Thread & RTM Explorer**               | `modelscript.digitalThread`              | Interactive graph explorer showing end-to-end traceability across OWL2 $\to$ SysML v2 $\to$ Modelica $\to$ CAD $\to$ Verification DHF.                              |

### 5. Three-Tier AI Engineering Copilot

The IDE integrates an engineering-aware AI assistant (`modelscript.aiChatView`) that operates across three configurable inference tiers:

1. **Tier 1 — Zero-Cloud Browser WebGPU (`Qwen3-0.6B` / WebLLM)**: Runs 100% locally inside the browser or desktop GPU using quantized WebGPU weights for air-gapped syntax completion, equation explanation, and unit conversion with zero data egress.
2. **Tier 2 — Local Workstation Inference (`Ollama` / `vLLM` OpenAI-compatible)**: Connects to a local model server (`http://localhost:11434`) with automatic tool-calling bound to the in-process `@modelscript/mcp` tools.
3. **Tier 3 — Hosted Frontier Models + MCP Gateway**: Connects frontier reasoning models to the workspace's live `@modelscript/mcp` server (or `/api/v1/mcp/sse`), enabling autonomous closed-loop synthesis (`modelscript_closed_loop_synthesize`), differential calibration (`modelica_diff_calibrate`), and multi-domain TGG reconciliation (`tgg_reconcile_slot`).
