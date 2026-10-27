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

### 2. Complete Reference of All 52 Core MCP Tools

The canonical MCP server (`packages/mcp/src/tools.ts`) registers **52 specialized engineering tools** grouped across nine functional domains:

#### Domain 1: Modelica Compilation, Simulation, Linearization & Sensitivity (11 Tools)

| Tool Name              | Required Arguments                                                                          | Optional Arguments                                                                                                                                                                                                                                          | Description                                                                                                                                                           |
| :--------------------- | :------------------------------------------------------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `modelica_load`        | `path: string`                                                                              | —                                                                                                                                                                                                                                                           | Load a `.mo` file or package directory from disk into the stateful MCP workspace session and return all discovered class FQNs.                                        |
| `modelica_parse`       | —                                                                                           | `code?: string`, `path?: string`                                                                                                                                                                                                                            | Parse Modelica source text or a file using the native WASM GLR parser and return CST syntax diagnostics and top-level class names.                                    |
| `modelica_flatten`     | `className?: string`                                                                        | `name?: string`, `code?: string`, `path?: string`, `includeMetrics?: boolean`                                                                                                                                                                               | Flatten a hierarchical Modelica class into a canonical DAE (`ArenaDAEPrinter` output) and return structural BLT/Pantelides metrics and flattened source text.         |
| `modelica_lint`        | —                                                                                           | `code?: string`, `path?: string`                                                                                                                                                                                                                            | Execute all `M1xxx`–`M6xxx` static lint rules and Salsa semantic queries, returning structured diagnostics with line/column spans.                                    |
| `modelica_simulate`    | `className: string`                                                                         | `code?: string`, `path?: string`, `tStart?: number` (`0`), `tEnd?: number` (`1`), `dt?: number` (`0.01`), `tolerance?: number` (`1e-6`), `method?: "euler" \| "rk4" \| "dopri5" \| "bdf" \| "radau5" \| "cvode" \| "ida"` (`"rk4"`), `variables?: string[]` | Flatten, index-reduce (Pantelides + BLT tearing), and numerically simulate a Modelica model, returning downsampled time-series trajectories and solver statistics.    |
| `hybrid_simulate`      | `className: string`                                                                         | `code?: string`, `path?: string`, `tStart?: number` (`0`), `tEnd?: number` (`10`), `dt?: number` (`0.01`), `maxEvents?: number` (`500`)                                                                                                                     | Run hybrid continuous/discrete event-driven simulation with zero-crossing root finding (`when` clauses, `reinit()`, state machines, and synchronous clocks).          |
| `modelica_doe`         | `className: string`, `parameters: Record<string, number[]>`                                 | `code?: string`, `path?: string`, `tEnd?: number` (`1`), `dt?: number` (`0.01`), `metrics?: string[]`                                                                                                                                                       | Execute a Cartesian/factorial Design of Experiments (DoE) sweep across parameter combinations and return terminal/summary metrics for each run.                       |
| `modelica_sensitivity` | `className: string`, `parameters: string[]`, `outputs: string[]`                            | `code?: string`, `path?: string`, `tEnd?: number` (`1`), `dt?: number` (`0.01`), `perturbation?: number` (`0.01`)                                                                                                                                           | Compute normalized local sensitivity Jacobians ($\frac{\partial y_i}{\partial p_j} \cdot \frac{p_j}{y_i}$) via central finite differences or forward AD.              |
| `modelica_query`       | `queryType: "list_classes" \| "class_info" \| "components" \| "equations" \| "connections"` | `className?: string`                                                                                                                                                                                                                                        | Query the active Salsa `SymbolIndex` for class specializations, typed component declarations, equations, or `connect()` topology edges.                               |
| `modelica_linearize`   | `className: string`                                                                         | `code?: string`, `operatingPoint?: Record<string, number>`, `inputs?: string[]`, `outputs?: string[]`                                                                                                                                                       | Linearize a Modelica DAE around an equilibrium point to extract explicit LTI State-Space matrices ($A, B, C, D$), eigenvalues, damping ratios, and stability margins. |
| `modelica_tune_pid`    | `className: string`                                                                         | `code?: string`, `controllerType?: "P" \| "PI" \| "PID"`, `targetBandwidthRadPerSec?: number`, `maxSensitivityMs?: number`                                                                                                                                  | Synthesize $K_p, K_i, K_d, N$ controller gains for a linearized Modelica plant using Skogestad IMC (SIMC) and sensitivity-constrained loop shaping.                   |

#### Domain 2: Cross-Domain Consistency & Ontology Reasoning (5 Tools)

| Tool Name                     | Required Arguments                                                                                 | Optional Arguments                                                                                                               | Description                                                                                                                                                     |
| :---------------------------- | :------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validate_system_consistency` | —                                                                                                  | `sysmlCode?: string`, `modelicaCode?: string`, `sysmlPath?: string`, `modelicaPath?: string`, `mapping?: Record<string, string>` | Cross-check a SysML v2 architecture definition against a Modelica physics implementation for port mismatches, unit conflicts, and shared parameter divergences. |
| `query_ontology_sparql`       | `ontologyText: string`, `sparqlQuery: string`                                                      | `enableReasoning?: boolean` (`true`)                                                                                             | Parse an OWL 2 Functional Syntax or Turtle ontology, optionally run OWL 2 RL forward-chaining inference, and execute a SPARQL 1.1 `SELECT`/`ASK` query.         |
| `query_ontology_bgp`          | `ontologyText: string`, `patterns: Array<{subject?: string, predicate?: string, object?: string}>` | `enableReasoning?: boolean` (`true`)                                                                                             | Match Basic Graph Patterns (BGP) against the inferred RDF triple store and return variable bindings.                                                            |
| `trace_fault_propagation`     | `ontologyText: string`, `faultSourceIri: string`                                                   | `propagationPropertyIri?: string`, `maxDepth?: number` (`10`)                                                                    | Traverse transitive causal/containment relationships across the ontological knowledge graph to compute downstream failure blast radius and FMEA impact chains.  |
| `explain_inference`           | `ontologyText: string`, `subject: string`, `predicate: string`, `object: string`                   | —                                                                                                                                | Construct a formal proof derivation tree explaining which OWL 2 RL rules and asserted axioms entailed a specific inferred triple $(s, p, o)$.                   |

#### Domain 3: Triple Graph Grammar (TGG) Digital Thread Synchronization (3 Tools)

| Tool Name               | Required Arguments                          | Optional Arguments                                                                                                                                                                                                                                    | Description                                                                                                                                                     |
| :---------------------- | :------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tgg_query_thread`      | `sysmlCode: string`, `modelicaCode: string` | `spiceCode?: string`                                                                                                                                                                                                                                  | Build the multi-domain Triple Graph Grammar correspondence graph across SysML v2, Modelica, and SPICE, returning synchronized element triples and orphan nodes. |
| `tgg_diagnose_conflict` | `sysmlCode: string`, `modelicaCode: string` | `baseSysmlCode?: string`, `baseModelicaCode?: string`                                                                                                                                                                                                 | Run Critical Pair Analysis (CPA) over concurrent modifications in SysML v2 and Modelica to detect conflicting edits on shared parameters or ports.              |
| `tgg_reconcile_slot`    | —                                           | `conflictId?: string`, `slotId?: string`, `correspondenceId?: string`, `strategy?: string`, `authority?: "sysml" \| "modelica"`, `customValue?: number`, `sysmlCode?: string`, `modelicaCode?: string`, `sysmlPath?: string`, `modelicaPath?: string` | Resolve a parameter or structural divergence on a TGG slot by propagating the authoritative or physics-constrained value across SysML v2 and Modelica.          |

#### Domain 4: Requirements Traceability Matrix (RTM) Intelligence (3 Tools)

| Tool Name              | Required Arguments                                                       | Optional Arguments            | Description                                                                                                                                                                  |
| :--------------------- | :----------------------------------------------------------------------- | :---------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rtm_query_matrix`     | `files: Record<string, string>`                                          | —                             | Extract all requirements, architectural elements, physics models, and verification cases across a polyglot file map and compute coverage percentages and orphan counts.      |
| `rtm_suggest_links`    | `files: Record<string, string>`                                          | `threshold?: number` (`0.35`) | Analyze identifier lexical similarity, shared physical quantities/units, and structural proximity to recommend missing `@satisfies` and `@verifies` traceability links.      |
| `rtm_diagnose_suspect` | `baseFiles: Record<string, string>`, `headFiles: Record<string, string>` | —                             | Compare two workspace snapshots via semantic AST fingerprinting to flag downstream `@satisfies`/`@verifies` links as `SUSPECT` when upstream requirement expressions change. |

#### Domain 5: Autonomous Closed-Loop Synthesis, Calibration & Workspace Editing (5 Tools)

| Tool Name                            | Required Arguments                                                                                                                        | Optional Arguments                                                                                                                                                                                                                                                  | Description                                                                                                                                                                            |
| :----------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `modelscript_closed_loop_synthesize` | `code: string`, `language: "sysml2" \| "modelica"`                                                                                        | `targetModelName?: string`, `filePath?: string`, `simulateAndTune?: boolean`, `tEnd?: number`, `tunableParameters?: string[]`, `requirements?: Array<{variable: string, condition: "lt" \| "gt" \| "eq" \| "between", threshold: number, upperThreshold?: number}>` | Execute an autonomous 5-gate compile $\to$ QUDV $\to$ SMT $\to$ DAE balance $\to$ dynamic simulation, STL robustness ($\rho$), and parameter tuning loop.                              |
| `modelscript_patch_code`             | `filePath: string`, `search: string`, `replace: string`                                                                                   | `validateBeforeWrite?: boolean` (`true`)                                                                                                                                                                                                                            | Apply a surgical search-and-replace edit to a workspace file, automatically running the WASM GLR parser and linter before committing the write to disk.                                |
| `modelscript_read_file`              | `filePath: string`                                                                                                                        | `startLine?: number`, `endLine?: number`                                                                                                                                                                                                                            | Read source lines from a workspace file within the sandboxed root directory.                                                                                                           |
| `modelscript_list_workspace_files`   | —                                                                                                                                         | `directory?: string`, `extensions?: string[]`                                                                                                                                                                                                                       | Recursively list engineering source files (`.mo`, `.sysml`, `.msx`, `.pscx`, `.scad`, `.stp`, `.owl`, `.ssp`, `.csv`) in the active workspace.                                         |
| `modelica_diff_calibrate`            | `className: string`, `modelicaCode: string`, `parameters: string[]`, `referenceData: {time: number[], signals: Record<string, number[]>}` | `learningRate?: number` (`0.05`), `maxEpochs?: number` (`50`), `parameterBounds?: Record<string, [number, number]>`                                                                                                                                                 | Calibrate unknown physical parameters against experimental CSV/reference trajectories using differentiable simulation and gradient descent (Adam / L-BFGS) to minimize trajectory MSE. |

#### Domain 6: PSCAD Power Systems & IEEE 2800 Grid Compliance (4 Tools)

| Tool Name               | Required Arguments                                                 | Optional Arguments                                                                                                                                                   | Description                                                                                                                                                   |
| :---------------------- | :----------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pscad_lint`            | —                                                                  | `path?: string`, `fileName?: string`, `code?: string`, `xmlContent?: string`                                                                                         | Run all 11 electrical EMT lint rules (`M6001`–`M6011`) on a `.pscx`, `.pslx`, or `.pswx` XML payload.                                                         |
| `pscad_simulate`        | `xmlContent: string`                                               | `tStop?: number` (`1.0`), `stepUs?: number` (`20.0`)                                                                                                                 | Execute a fixed-step nodal admittance EMT simulation on a `.pscx` case and return three-phase bus voltage, branch current, and CSMF control signal waveforms. |
| `pscad_verify_ieee2800` | —                                                                  | `path?: string`, `fileName?: string`, `code?: string`, `xmlContent?: string`, `tStop?: number`, `stepUs?: number`, `faultBus?: string`, `retainedVoltagePu?: number` | Run automated **IEEE Std 2800-2022** LVRT/HVRT voltage ride-through, frequency ride-through, and reactive current injection compliance verification.          |
| `pscad_export`          | `xmlContent: string`, `targetFormat: "modelica" \| "ssp" \| "svg"` | —                                                                                                                                                                    | Convert a PSCAD `.pscx` schematic into an executable Modelica `.mo` model, an SSP 1.0 `.ssd` descriptor, or a rendered Single-Line Diagram SVG.               |

#### Domain 7: Social Engineering Network & Bot Collaboration (2 Tools)

| Tool Name            | Required Arguments                     | Optional Arguments        | Description                                                                                                                            |
| :------------------- | :------------------------------------- | :------------------------ | :------------------------------------------------------------------------------------------------------------------------------------- |
| `social_read_thread` | `postId: number`                       | —                         | Read a social discussion thread with its full conversation tree, parent posts, child replies, and attached engineering artifact views. |
| `social_post_reply`  | `replyToId: number`, `content: string` | `artifactViewId?: number` | Post an engineering response or simulation synthesis back into a discussion thread on behalf of an authorized bot or automated agent.  |

#### Domain 8: Multibody Rail Dynamics & Multiphase Flow Assurance (14 Tools)

| Tool Name               | Required Arguments                                                   | Optional Arguments                                                                                                    | Description                                                                                                                                                          |
| :---------------------- | :------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `olga_simulate`         | —                                                                    | `path?: string`, `code?: string`, `tEnd?: number`, `dt?: number`                                                      | Simulate transient multiphase flow, liquid accumulation, pressure drops, slugging, and pigging for an OLGA model (`.opi`, `.key`, `.genkey`).                        |
| `olga_lint`             | —                                                                    | `path?: string`, `code?: string`                                                                                      | Run pre-flight multiphase flow assurance diagnostics (`M7001`–`M7007`: CFL stability, steep risers, severe slugging dips, pig stuck hazard) on an OLGA model.        |
| `olga_verify`           | —                                                                    | `path?: string`, `code?: string`, `maxPressureBar?: number`, `minHydrateMarginC?: number`, `maxSlugVolumeM3?: number` | Formally verify multiphase simulation against flow assurance limits (MAOP, hydrate subcooling margin, and slug catcher capacity).                                    |
| `olga_diagram`          | —                                                                    | `path?: string`, `code?: string`, `view?: "pid" \| "profile"`                                                         | Generate standalone SVG diagrams for an OLGA flowline: topological P&ID schematic or pipeline elevation bathymetry $Z(X)$ with holdup heatmaps.                      |
| `olga_parse_tpl`        | —                                                                    | `path?: string`, `content?: string`                                                                                   | Parse an OLGA simulation trend plot (`.tpl`) file or payload into a structured time-series dataset with variable catalog, units, and channel statistics.             |
| `olga_parse_ppl`        | —                                                                    | `path?: string`, `content?: string`                                                                                   | Parse an OLGA spatial profile plot (`.ppl`) file or payload into structured spatial snapshots along pipeline coordinate $X$ with flow regimes and extrema.           |
| `olga_tune`             | —                                                                    | `path?: string`, `code?: string`, `telemetryCsv?: string`, `parameters?: string[]`                                    | Calibrate OLGA flowline model parameters (roughness, choke $C_d$, heat transfer, well PI) using Nelder-Mead simplex history matching against telemetry observations. |
| `olga_gate`             | —                                                                    | `path?: string`, `code?: string`                                                                                      | Evaluate an automated Flow Assurance CI/CD Safety Gate check on an OLGA model for pull requests and operational envelope verification.                               |
| `olga_survey`           | `csvText: string`                                                    | `maxSegments?: number`, `roughnessMm?: number`, `diameterM?: number`                                                  | Ingest 3D seabed bathymetry survey coordinates (CSV with Easting/Northing/Depth or KP/Elevation) and discretize into curvature-aware OLGA pipe segments.             |
| `gensys_lint`           | —                                                                    | `path?: string`, `code?: string`                                                                                      | Perform pre-flight semantic and physical validation on GENSYS railway vehicle models (`.calc`, `.run`, `.sub`).                                                      |
| `gensys_verify_en14363` | —                                                                    | `path?: string`, `code?: string`, `speedKmh?: number`, `cantDeficiencyMm?: number`                                    | Verify Nadal derailment quotient ($Y/Q \le 0.8$) and Prud'homme lateral track shifting force limits according to EN 14363 / UIC 518.                                 |
| `gensys_fastsim`        | `normalForceN: number`, `semiAxisAMm: number`, `semiAxisBMm: number` | `creepX?: number`, `creepY?: number`, `spinRadPerM?: number`, `frictionCoeff?: number`                                | Compute tangential longitudinal/lateral creep forces and spin moment using Kalker's FASTSIM wheel-rail contact algorithm.                                            |
| `simpack_lint`          | —                                                                    | `path?: string`, `code?: string`                                                                                      | Perform structural and reference diagnostics on SIMPACK XML (`.spck`) or classic deck (`.sim`, `.mbs`) multibody models.                                             |
| `simpack_mobility`      | —                                                                    | `path?: string`, `code?: string`                                                                                      | Calculate spatial system degrees of freedom and detect overconstrained mechanisms using the Grübler-Kutzbach mobility criterion.                                     |

#### Domain 9: Cross-Domain CAD/FEA Sizing, B2B Migration, Co-Sim Stability, Formal Safety & Digital Twin (5 Tools)

| Tool Name                         | Required Arguments                               | Optional Arguments                                                                                                                                                                                                            | Description                                                                                                                                                             |
| :-------------------------------- | :----------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cad_fea_closed_loop_size`        | —                                                | `scadCode?: string`, `stepPath?: string`, `material?: string`, `yieldStrengthMPa?: number`, `minSafetyFactor?: number`, `appliedLoadN?: number`, `tunableDimensions?: Record<string, number>`, `clearanceEnvelopeMm?: number` | Run closed-loop 3D CAD/OpenSCAD/STEP parametric sizing coupled with tetrahedral FEA von Mises stress analysis and 3D BVH collision clearance verification.              |
| `polyglot_migrate_and_verify_b2b` | `sourceFormat: "simulink" \| "spice" \| "adams"` | `sourceCode?: string`, `sourcePath?: string`, `targetModelName?: string`, `generateSysmlWrapper?: boolean`, `verifyC99Codegen?: boolean`, `toleranceRmse?: number`, `tEnd?: number`                                           | Migrate legacy Simulink (`.slx`), SPICE (`.cir`), or MSC Adams (`.adm`) models to Modelica & SysML v2 and certify ISO 26262 Back-to-Back (B2B) trajectory & C99 parity. |
| `ssp_diagnose_cosim_stability`    | —                                                | `ssdXml?: string`, `sspPath?: string`, `macroStepSizeSec?: number`, `couplingMethod?: "jacobi" \| "gauss-seidel" \| "tlm" \| "ijcsa"`                                                                                         | Analyze an FMI 2.0/3.0 & SSP multi-FMU co-simulation topology for algebraic feedthrough loops and ZOH spectral radius ($\rho(J_{\text{ZOH}})$) instability.             |
| `formal_verify_safety_and_mcdc`   | `code: string`                                   | `className?: string`, `safetyProperty?: string`, `engine?: "ic3-pdr" \| "k-induction" \| "sos-barrier"`, `maxDepth?: number`, `generateMcdcVectors?: boolean`                                                                 | Prove unbounded safety invariants via IC3/PDR and Sum-of-Squares (SOS) barrier certificates, and generate DO-178C / ISO 26262 MC/DC independence-pair test vectors.     |
| `twin_discover_sindy_and_rom`     | —                                                | `className?: string`, `modelicaCode?: string`, `telemetryData?: {time: number[], states: Record<string, number[]>}`, `sparsityThreshold?: number`, `romRank?: number`                                                         | Discover sparse nonlinear governing differential equations (SINDy STLSQ) from hardware telemetry residuals and calibrate a Reduced-Order Model (ROM) digital twin.      |

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

A single unified Language Server Protocol instance provides incremental language intelligence across the registered languages (`.mo`, `.sysml`, `.kerml`, `.msx`, `.pscx`, `.pswx`, `.scad`, `.stp`, `.step`, `.owl`, `.ssp`, `.ssd`, `.ssv`, `.csv`, `.su2`, `.cfg`, `.inp`, `.gbr`):

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

---

## Part III: Social AI Agents & Autonomous Bots

ModelScript features native autonomous bot support across the social engineering network (`apps/api` and `apps/web`), allowing automated agents to participate in engineering discussions, verify physical equations, run continuous DAE simulations, and attach interactive artifact views.

### 1. Bot Registration & Scopes

Users can register autonomous bots in **Settings $\to$ Autonomous Bots** or programmatically via `POST /api/v1/users/me/bots`:

- **Dedicated Bot Identity**: Bots receive a unique handle (e.g. `@dynamics_bot`), custom display name, bio, avatar, and system persona prompt.
- **`ms_bot_*` Bearer Tokens**: Authenticate bot calls against social endpoints, the git repository engine, and the MCP SSE gateway.
- **Granular Capability Scopes**:
  - `social:read`: Read public engineering threads, parent contexts, and mentions.
  - `social:write`: Post responses, explanations, and quotes into social threads.
  - `social:simulate`: Execute DAE solvers (SUNDIALS CVODE/IDA) and synthesize interactive trajectory plots.
  - `modelica:validate`: Compile and check Modelica CST syntax and static semantics.

### 2. Bring-Your-Own-Key (BYOK) Inference

Bots can run on instance-default models or configure private credentials:

- **BYOK Cloud API Keys**: Supports Gemini, OpenAI, and Anthropic API keys directly configured on the bot.
- **Custom Inference Endpoints**: Point to local `Ollama` (`http://localhost:11434/v1`), `vLLM`, or private enterprise LLM gateways.
- **Inference Models**: Select from specialized models including `gemini-1.5-flash`, `gemini-1.5-pro`, `gpt-4o-mini`, `gpt-4o`, `deepseek-r1`, or `qwen-2.5-coder`.

### 3. Mention Processing & Live WebSocket Indicators

When an engineering post or comment mentions an automated bot (`@dynamics_bot`):

1. **Background Queue**: The API enqueues the job into `bot_mention_queue` with anti-loop recursion safeguards (bot mentions cannot trigger nested bot replies).
2. **Real-Time WebSocket Indicators**: The backend streams live status updates over `/api/v1/collab/stream`:
   - `thinking`: The bot is parsing prompt equations and generating physical models.
   - `simulating`: The bot is running numerical integrators and preparing trajectory data.
   - `done`: The reply is posted and the UI automatically appends the completed card.
3. **Interactive Artifact Synthesis**:
   - `morsel`: Inline interactive Modelica code view with syntax highlighting and verification badges.
   - `vega-plot`: Interactive Vega-Lite timeseries charts with state variable selection and trajectory zoom.
