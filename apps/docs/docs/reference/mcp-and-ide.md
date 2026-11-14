---
title: MCP Server & IDE Workbench Reference
description: Complete reference for all 105 Model Context Protocol (@modelscript/mcp) engineering tools, MCP resources, and the 15 custom visual editors in the VS Code & Studio workbench.
---

# MCP Server & IDE Workbench Reference

ModelScript provides first-class AI agent integration via the **Model Context Protocol (`@modelscript/mcp`)** alongside a comprehensive polyglot **VS Code Extension & Studio Workbench (`@modelscript/ide-client`, `@modelscript/lsp`)**. Both surfaces share the same zero-allocation WebAssembly GLR parsers, Salsa `QueryEngine`, and linear-memory `DAEBuilder`.

---

## Part I: Model Context Protocol (MCP) Server

The `@modelscript/mcp` package exposes ModelScript's compilation, simulation, formal verification, ontology reasoning, Triple Graph Grammar (TGG) synchronization, and requirements traceability engines to MCP-compatible AI coding assistants (Claude Desktop, Cursor, Windsurf, Antigravity, Zed, and custom LLM orchestrators).

### 1. Deployment Modes & Transports

ModelScript supports three MCP execution architectures:

#### A. Local `stdio` Server (`@modelscript/mcp`)

For local desktop AI agents, run `@modelscript/mcp` over standard input/output (`StdioServerTransport`):

**VS Code (`.vscode/mcp.json`):**

```json
{
  "servers": {
    "modelscript": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelscript/mcp"],
      "env": {
        "MODELICAPATH": "/path/to/ModelicaStandardLibrary"
      }
    }
  }
}
```

**VS Code CLI & Claude Code CLI:**

```bash
# VS Code (adds to user/workspace MCP configuration)
code --add-mcp '{"name":"modelscript","command":"npx","args":["-y","@modelscript/mcp"]}'

# Claude Code
claude mcp add modelscript -- npx -y @modelscript/mcp
```

**Cursor (`.cursor/mcp.json`), Windsurf & Claude Desktop (`claude_desktop_config.json`):**

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

### 2. Complete Reference of All 105 Core MCP Tools

The canonical MCP server (`packages/mcp/src/tools.ts`) registers **105 specialized engineering tools** grouped across fifteen functional domains:

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

#### Domain 10: Digital Metrology, Cyber-Physical Security, AutomationML & Radiology / Surgical Navigation (8 Tools)

| Tool Name                       | Required Arguments | Optional Arguments                                                                      | Description                                                                                                                                                                                                                                                  |
| :------------------------------ | :----------------- | :-------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `qif_inspect_and_spc`           | —                  | `qifXml?: string`, `qifPath?: string`, `stepPath?: string`                              | Evaluates an ISO 23952 Quality Information Framework (QIF) document, runs NIST QIF & ASME Y14.5 GD&T lint checks (`Q1001`–`Q1010`), computes SPC capability ($C_p$, $C_{pk}$, TUR, MMC/LMC bonus tolerances), and optionally reconciles STEP AP242 entities. |
| `oscal_audit_cps_compliance`    | —                  | `oscalContent?: string`, `oscalPath?: string`, `overlay?: "800-53" \| "800-82"`         | Audits a NIST OSCAL document (Catalog, Profile, Component Definition, SSP, SAR, or POA&M) against NIST SP 800-53 Rev 5 and SP 800-82 Rev 3 OT/ICS overlays, resolves profile baselines, and verifies cyber-physical architectural component coverage.        |
| `aml_run_virtual_commissioning` | —                  | `amlXml?: string`, `amlPath?: string`, `cycles?: number` (`20`), `dtMs?: number` (`10`) | Parses an IEC 62714 AutomationML / CAEX workcell topology, runs semantic port & PPR role verification (`A1001`–`A1010`), and executes closed-loop virtual commissioning coupling `VirtualPlc` logic and mechatronic plant dynamics.                          |
| `opensim_analyze`               | —                  | `osimXml?: string`, `osimPath?: string`, `tEnd?: number` (`1.0`)                        | Parses an OpenSim (`.osim`) musculoskeletal biomechanics model, runs pre-flight kinematic and Hill-type muscle diagnostics (`M9101`–`M9110`), and simulates muscle activation/contraction dynamics.                                                          |
| `dicom_rt_verify_dvh`           | —                  | `planContent?: string`, `planPath?: string`                                             | Evaluates a DICOM-RT treatment plan (`RTPLAN`, `RTSTRUCT`, `RTDOSE`), verifies QUANTEC OAR dose constraints, MLC leaf kinematics, and gantry/couch collision clearance (`M9201`–`M9210`), and computes DVH, CI, HI, BED, and $\text{EQD}_2$ metrics.         |
| `cellml_simulate`               | —                  | `cellmlXml?: string`, `cellmlPath?: string`, `tEnd?: number` (`500`)                    | Parses a CellML 1.0/1.1/2.0 electrophysiology or microvascular perfusion model, verifies SI dimensional consistency and component interfaces (`M9301`–`M9310`), and integrates action potential / gating ODEs.                                               |
| `igtl_verify_calibration`       | —                  | `configXml?: string`, `configPath?: string`                                             | Parses an OpenIGTLink / PLUS surgical navigation configuration, verifies $SE(3)$ rotation orthogonality and coordinate frame connectivity (`M9801`–`M9810`), and solves stylus pivot calibration and Fitzpatrick Target Registration Error (TRE).            |
| `three_mf_verify_guide`         | —                  | `threeMfXml?: string`, `threeMfPath?: string`                                           | Verifies an ISO/ASTM 52915 3MF Medical patient-specific surgical cutting guide or implant mesh for 2-manifold watertightness, outward normal volume, wall thickness, osteotomy plane normals, and biocompatibility (`M9701`–`M9710`).                        |

#### Domain 11: Distribution Power Grids (`OpenDSS` — 8 Tools)

| Tool Name                  | Required Arguments | Optional Arguments                                                                      | Description                                                                                                                                                                                    |
| :------------------------- | :----------------- | :-------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `opendss_solve_powerflow`  | —                  | `dssCode?: string`, `dssPath?: string`, `tolerance?: number`, `maxIter?: number`        | Solves unbalanced 3-phase multi-wire distribution power flow on an OpenDSS (`.dss`) circuit and returns per-bus ANSI C84.1 Range A/B voltage compliance, line loadings, and system losses.     |
| `opendss_hosting_capacity` | —                  | `dssCode?: string`, `dssPath?: string`, `maxKw?: number`, `stepKw?: number`             | Computes IEEE 1547 distributed energy resource (DER / PV / EV) hosting capacity across distribution feeder nodes subject to ANSI C84.1 overvoltage and thermal ampacity limits.                |
| `opendss_volt_var_sim`     | —                  | `dssCode?: string`, `dssPath?: string`, `category?: "A" \| "B"`, `reactiveMax?: number` | Simulates IEEE 1547-2018 Category A/B autonomous smart-inverter Volt-VAR and Volt-Watt droop curves to mitigate feeder voltage rise.                                                           |
| `opendss_short_circuit`    | —                  | `dssCode?: string`, `dssPath?: string`, `faultBus?: string`                             | Executes symmetrical and asymmetrical (`3PH`, `SLG`, `LL`, `LLG`) distribution fault analysis and returns fault currents and sequence impedances across feeder buses.                          |
| `opendss_harmonics`        | —                  | `dssCode?: string`, `dssPath?: string`, `orders?: number[]`                             | Runs multi-order harmonic frequency scan (`h = 3, 5, 7, 11, 13...`) for non-linear inverter/rectifier loads and evaluates IEEE 519-2022 voltage and current THD/TDD limits.                    |
| `opendss_protection_tcc`   | —                  | `dssCode?: string`, `dssPath?: string`, `faultAmps?: number`                            | Evaluates IEEE C37.112 / IEC 60255 inverse-time overcurrent relay, recloser, and fuse Time-Current Characteristic (TCC) curves and checks primary-to-backup Coordination Time Intervals (CTI). |
| `opendss_flisr`            | —                  | `dssCode?: string`, `dssPath?: string`, `faultedLine?: string`                          | Computes Fault Location, Isolation, and Service Restoration (FLISR) tie-switch reconfiguration plans to restore unfaulted feeder sections without violating radiality or thermal limits.       |
| `opendss_qsts_24h`         | —                  | `dssCode?: string`, `dssPath?: string`, `steps?: number`, `dtHours?: number`            | Executes a 24-hour Quasi-Static Time-Series (QSTS) distribution simulation with solar irradiance and load profiles, tracking regulator tap operations and energy losses.                       |

#### Domain 12: Municipal Water Distribution & Urban Stormwater (`EPANET` & `SWMM` — 10 Tools)

| Tool Name                  | Required Arguments                                                                   | Optional Arguments                                                                                                                                  | Description                                                                                                                                                                     |
| :------------------------- | :----------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `epanet_solve_hydraulics`  | —                                                                                    | `inpContent?: string`, `inpPath?: string`, `tolerance?: number`                                                                                     | Solves pressurized pipe network hydraulics using the Todini-Pilati Global Gradient Algorithm (GGA) with Hazen-Williams, Darcy-Weisbach, or Chezy-Manning headloss formulas.     |
| `epanet_water_quality`     | —                                                                                    | `inpContent?: string`, `inpPath?: string`, `kbBulkPerDay?: number`, `kwWallMPerDay?: number`                                                        | Simulates disinfectant (chlorine/chloramine) bulk + wall reaction decay, THM DBP formation, and water age transport across distribution junctions and storage tanks.            |
| `epanet_fire_flow`         | —                                                                                    | `inpContent?: string`, `inpPath?: string`, `minResidualPsi?: number` (`20`)                                                                         | Evaluates AWWA M31 / NFPA 291 available fire flow at each hydrant junction while maintaining a minimum $20\text{ psi}$ residual pressure across the distribution zone.          |
| `epanet_pump_energy`       | —                                                                                    | `inpContent?: string`, `inpPath?: string`, `tariffPerKwh?: number`                                                                                  | Audits pumping station wire-to-water efficiency, specific energy ($\text{kWh/MG}$ or $\text{kWh/m}^3$), peak demand charges, and time-of-use tariff optimization opportunities. |
| `epanet_contaminant_trace` | —                                                                                    | `inpContent?: string`, `inpPath?: string`, `sourceNode?: string`                                                                                    | Performs source-to-junction water provenance tracing and contaminant propagation envelope analysis, identifying critical isolation valves (`N-1` segment analysis).             |
| `water_audit_m36`          | `systemInputVolumeM3: number`, `billedAuthorizedM3: number`                          | `unbilledAuthorizedM3?: number`, `apparentLossesM3?: number`, `mainsLengthKm?: number`, `serviceConnections?: number`, `avgPressureMeters?: number` | Computes an AWWA M36 / IWA Water Balance Audit, Unavoidable Annual Real Losses ($\text{UARL}$), and Infrastructure Leakage Index ($\text{ILI} = \text{CARL} / \text{UARL}$).    |
| `epanet_localize_leak`     | —                                                                                    | `inpContent?: string`, `inpPath?: string`, `observedPressures?: Record<string, number>`                                                             | Solves inverse hydraulic sensitivity residual analysis to localize probable pipe burst/leak candidates from SCADA pressure transducer discrepancies.                            |
| `epanet_sensor_placement`  | —                                                                                    | `inpContent?: string`, `inpPath?: string`, `sensorCount?: number` (`3`)                                                                             | Optimizes water quality and pressure sensor placement using submodular greedy detection-coverage maximization (`TEVA-SPOT` methodology).                                        |
| `swmm_route_stormwater`    | —                                                                                    | `inpContent?: string`, `inpPath?: string`, `stormDepthMm?: number`, `durationHours?: number`                                                        | Executes EPA SWMM 5 dynamic-wave Saint-Venant conduit routing, Green-Ampt / Horton / SCS Curve Number catchment runoff, and Combined Sewer Overflow (CSO) surcharge analysis.   |
| `swmm_size_detention_pond` | `inflowPeakCms: number`, `allowableOutflowCms: number`, `stormDurationHours: number` | `sideSlope?: number`, `maxDepthMeters?: number`, `orificeCd?: number`                                                                               | Sizes a stormwater detention basin and multi-stage outlet structure (low-flow orifice + emergency weir) using Modified Puls level-pool routing ($dS/dt = I(t) - O(h)$).         |

#### Domain 13: ECAD, High-Speed PCB Signal Integrity & Supply-Chain BOM (6 Tools)

| Tool Name                     | Required Arguments                                                                                 | Optional Arguments                                                                                   | Description                                                                                                                                                                             |
| :---------------------------- | :------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ecad_check_dfm`              | —                                                                                                  | `pcbJson?: string`, `pcbPath?: string`, `ipcClass?: 1 \| 2 \| 3`                                     | Runs IPC-2221 / IPC-6012 Design for Manufacturing (DFM) and Design Rule Checks (DRC) on a PCB layout, checking trace clearances, annular rings, aspect ratios, and solder mask slivers. |
| `ecad_extract_netlist`        | —                                                                                                  | `gerberContent?: string`, `pcbJson?: string`                                                         | Extracts connectivity netlists, pad stacks, and parasitic trace lengths from RS-274X Gerber layers or structured PCB layouts for SPICE / IBIS signal-integrity verification.            |
| `ecad_impedance_calc`         | `traceWidthMm: number`, `dielectricHeightMm: number`, `er: number`                                 | `copperThicknessMm?: number`, `diffSpacingMm?: number`, `mode?: "microstrip" \| "stripline"`         | Computes IPC-2141 / Waddell single-ended ($Z_0$) and differential ($Z_{\text{diff}}$) controlled-impedance transmission line parameters and propagation delay ($\text{ps/mm}$).         |
| `ecad_thermal_via`            | `powerWatts: number`, `boardThicknessMm: number`                                                   | `viaCount?: number`, `holeDiameterMm?: number`, `platingThicknessUm?: number`, `deltaTMaxC?: number` | Calculates IPC-2152 thermal via array resistance ($R_{\theta,\text{via}}$ in $^{\circ}\text{C/W}$), current-carrying capacity, and recommended via stitch count for power dissipation.  |
| `supply_chain_bom_cost`       | `components: Array<{ mpn: string; qty: number; unitPriceUsd?: number }>`                           | `volumeSuites?: number[]`, `scrapRatePct?: number`                                                   | Evaluates multi-tier Bill of Materials (BOM) volume cost rollups (`1`, `100`, `1,000`, `10,000` units), MOQ excess inventory penalties, and Pareto cost drivers.                        |
| `supply_chain_lifecycle_risk` | `components: Array<{ mpn: string; lifecycle?: string; sources?: number; leadTimeWeeks?: number }>` | —                                                                                                    | Audits BOM components for obsolescence (`NRND`, `EOL`, `Obsolete`), single-source bottlenecks, geopolitical concentration, and RoHS/REACH compliance risk scores.                       |

#### Domain 14: Telecom, DWDM Optical Transport, 5G NR RAN & Outside-Plant Fiber (8 Tools)

| Tool Name              | Required Arguments    | Optional Arguments                                                                                                             | Description                                                                                                                                                                                              |
| :--------------------- | :-------------------- | :----------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `optical_osnr_budget`  | —                     | `code?: string`, `path?: string`, `spanCount?: number`, `spanLengthKm?: number`, `launchPowerDbm?: number`                     | Computes ITU-T G.694.1 DWDM optical link power budget, multi-span EDFA ASE noise accumulation, Gaussian Noise (GN) Kerr nonlinearity ($\text{SNR}_{\text{NL}}$), OSNR, and CD/PMD margins.               |
| `optical_otdr_analyze` | —                     | `code?: string`, `path?: string`, `events?: Array<{ distanceKm: number; lossDb: number; reflectanceDb: number }>`              | Analyzes ITU-T G.650.3 / Telcordia SR-4731 OTDR trace events to classify fusion splices, reflective connectors, macro-bends, and fiber breaks with Two-Point and LSA attenuation slopes.                 |
| `ran_link_budget`      | —                     | `code?: string`, `path?: string`, `freqGhz?: number`, `distanceKm?: number`, `scenario?: "UMa" \| "UMi" \| "RMa"`              | Evaluates 3GPP TR 38.901 5G NR Sub-6 GHz and FR2 mmWave link budgets, computing path loss, shadow fading, SINR, Shannon/3GPP MCS spectral efficiency, and ITU-R P.838 rain attenuation.                  |
| `ran_coverage_grid`    | —                     | `code?: string`, `path?: string`, `gridRadiusKm?: number`, `resolutionMeters?: number`                                         | Computes 2D spatial RSRP, SINR, and throughput coverage heatmaps across multi-sector 5G NR gNodeB cell sites with 3D directional antenna pattern beamforming and PCI mod-3/mod-30 checks.                |
| `ran_antenna_parse`    | `msiContent: string`  | —                                                                                                                              | Parses an `.msi` / `.pln` / Planet 3D base-station antenna radiation pattern file, extracting horizontal/vertical gain envelopes, half-power beamwidth (HPBW), front-to-back ratio, and electrical tilt. |
| `fiber_color_code`     | `fiberNumber: number` | `tubesPerCable?: number` (`12`), `fibersPerTube?: number` (`12`)                                                               | Resolves TIA-598-D 12-color identification codes (Blue, Orange, Green, Brown, Slate, White, Red, Black, Yellow, Violet, Rose, Aqua + tracer stripes) for any fiber index ($1\dots 3,456$).               |
| `fiber_splice_loss`    | —                     | `code?: string`, `path?: string`, `modeFieldDiameter1Um?: number`, `modeFieldDiameter2Um?: number`, `lateralOffsetUm?: number` | Calculates Marcuse Gaussian-beam fusion splice insertion loss from mode-field diameter (MFD) mismatch, lateral core offset, and angular tilt alongside PON OLT-to-ONT split budgets.                     |
| `telecom_srlg_audit`   | —                     | `code?: string`, `path?: string`                                                                                               | Audits Shared Risk Link Groups (SRLG) across optical and fiber topologies to verify physical conduit/duct diversity between primary and backup paths and detect single points of failure.                |

#### Domain 15: Extended Power, Water, Telecom, ECAD & Polyglot Tools (42 Tools)

| Tool Name                              | Category                                            | Description                                                                                       |
| :------------------------------------- | :-------------------------------------------------- | :------------------------------------------------------------------------------------------------ |
| `opendss_solve_faults`                 | Power Systems, EMT & Distribution                   | Evaluates symmetrical/unsymmetrical short-circuit faults on OpenDSS feeders.                      |
| `opendss_evaluate_harmonics`           | Power Systems, EMT & Distribution                   | Computes harmonic voltage/current distortion and THD spectra on OpenDSS feeders.                  |
| `opendss_analyze_reliability`          | Power Systems, EMT & Distribution                   | Evaluates distribution reliability indices (SAIFI, SAIDI, CAIDI, ENS) on OpenDSS feeders.         |
| `opendss_solve_gic`                    | Power Systems, EMT & Distribution                   | Computes geomagnetically induced currents (GIC) across neutral-grounded transformers.             |
| `opendss_simulate_flisr`               | Power Systems, EMT & Distribution                   | Simulates Fault Location, Isolation, and Service Restoration (FLISR) switching sequences.         |
| `epanet_fire_flow_analysis`            | Municipal Water, Stormwater & Leak Localization     | Evaluates residual hydrant pressures under fire-flow demand conditions in EPANET networks.        |
| `epanet_outage_contingency`            | Municipal Water, Stormwater & Leak Localization     | Evaluates pipe/pump outage contingencies and isolated demand deficits in EPANET networks.         |
| `epanet_screen_contingencies_webgpu`   | Municipal Water, Stormwater & Leak Localization     | Runs batched hydraulic contingency screening using WebGPU compute acceleration.                   |
| `epanet_water_hammer_surge`            | Municipal Water, Stormwater & Leak Localization     | Evaluates transient water-hammer pressure surges from valve closure or pump trip.                 |
| `water_audit_awwa_m36`                 | Municipal Water, Stormwater & Leak Localization     | Computes AWWA M36 water balance, non-revenue water, and Infrastructure Leakage Index (ILI).       |
| `epanet_optimize_cip`                  | Municipal Water, Stormwater & Leak Localization     | Optimizes capital improvement (CIP) pipe rehabilitation and sizing plans.                         |
| `epanet_calibrate_scada`               | Municipal Water, Stormwater & Leak Localization     | Calibrates Hazen-Williams roughness and demands against SCADA pressure/flow telemetry.            |
| `epanet_gis_to_model`                  | Municipal Water, Stormwater & Leak Localization     | Converts GIS GeoJSON/shapefile water mains, junctions, and DEMs into an EPANET `.inp` model.      |
| `swmm_flood_routing`                   | Municipal Water, Stormwater & Leak Localization     | Runs 1D Saint-Venant dynamic-wave stormwater and sewer flood routing.                             |
| `swmm_simulate_rtc`                    | Municipal Water, Stormwater & Leak Localization     | Simulates real-time control (RTC) gates, orifices, and pump rules in SWMM.                        |
| `swmm_gis_to_model`                    | Municipal Water, Stormwater & Leak Localization     | Ingests municipal GIS stormwater conduits, manholes, catchments, and DEMs into SWMM `.inp`.       |
| `epanet_convert_watergems`             | Municipal Water, Stormwater & Leak Localization     | Converts Bentley WaterGEMS / HAMMER (`.wtg.sqlite`) or InfoWater models to EPANET `.inp`.         |
| `swmm_convert_infoworks`               | Municipal Water, Stormwater & Leak Localization     | Converts Autodesk / Innovyze InfoWorks ICM collection models to SWMM `.inp`.                      |
| `swmm_inundation_2d`                   | Municipal Water, Stormwater & Leak Localization     | Simulates 2D shallow-water overland street flooding coupled to 1D SWMM manholes.                  |
| `ecad_dfm_audit`                       | ECAD, PCB Signal Integrity & Supply-Chain BOM       | Runs Design for Manufacturing, Assembly, and Test (DFM/DFA/DFT) rules on PCB layouts.             |
| `ecad_generate_manufacturing_bundle`   | ECAD, PCB Signal Integrity & Supply-Chain BOM       | Generates IPC-2581C, ODB++ v8.1, Gerbers, and Centroid PnP manufacturing outputs.                 |
| `supply_chain_scrub_bom`               | ECAD, PCB Signal Integrity & Supply-Chain BOM       | Scrubs a BOM across multi-tier distributors for pricing, stock, lead times, and obsolescence.     |
| `optical_inspect_otdr`                 | Telecom, DWDM Optical, 5G RAN & Outside-Plant Fiber | Inspects Telcordia GR-196/SR-4731 `.sor` OTDR traces for attenuation, reflectance, and splices.   |
| `optical_solve_transmission`           | Telecom, DWDM Optical, 5G RAN & Outside-Plant Fiber | Solves multi-span DWDM transmission via the Enhanced Gaussian Noise (EGN) model (GSNR, ASE, NLI). |
| `ran_solve_microwave_budget`           | Telecom, DWDM Optical, 5G RAN & Outside-Plant Fiber | Solves LOS microwave link budgets, FSPL, ITU-R P.530 rain fade, and Fresnel clearance.            |
| `fiber_locate_otdr_fault`              | Telecom, DWDM Optical, 5G RAN & Outside-Plant Fiber | Pinpoints GPS coordinates of OTDR fiber breaks, correcting for helix twist and slack loops.       |
| `ran_evaluate_mpe_safety`              | Telecom, DWDM Optical, 5G RAN & Outside-Plant Fiber | Evaluates FCC OET-65 / ICNIRP 2020 / Safety Code 6 RF MPE exclusion boundaries and TER.           |
| `ran_evaluate_faa_obstruction`         | Telecom, DWDM Optical, 5G RAN & Outside-Plant Fiber | Evaluates FAA 14 CFR Part 77 / ICAO Annex 14 / CAR 601.23 tower airspace obstruction criteria.    |
| `fiber_evaluate_pole_loading`          | Telecom, DWDM Optical, 5G RAN & Outside-Plant Fiber | Evaluates utility pole structural loading per NESC Rule 250/260, CSA C22.3, or Eurocode EN 50341. |
| `fiber_generate_bdc_fabric`            | Telecom, DWDM Optical, 5G RAN & Outside-Plant Fiber | Generates FCC BDC / NTIA BEAD spatial datasets discretized into Uber H3 Res 8/9 hexagons.         |
| `telecom_evaluate_nors_outage`         | Telecom, DWDM Optical, 5G RAN & Outside-Plant Fiber | Evaluates FCC Part 4 (47 CFR § 4.9) NORS outage reporting thresholds and filing dossiers.         |
| `modelscript_bifurcation_continuation` | Closed-Loop Synthesis & Workspace                   | Traces steady-state equilibrium curves via PALC and detects Fold, Hopf, and Branch bifurcations.  |
| `modelscript_stochastic_jump`          | Closed-Loop Synthesis & Workspace                   | Executes discrete-state stochastic jump simulations via Gillespie SSA and Adaptive Tau-Leaping.   |
| `comtrade_extract_phasor`              | Power Protection, Hydro & Polyglot Diagnostics      | Extracts DFT RMS phasors from IEEE C37.111 COMTRADE fault recordings.                             |
| `scl_validate_goose`                   | Power Protection, Hydro & Polyglot Diagnostics      | Validates IEC 61850 GOOSE and Sampled Values publisher/subscriber latency and dataflow.           |
| `waterml_fit_rating_curve`             | Power Protection, Hydro & Polyglot Diagnostics      | Fits non-linear stage-discharge rating curves $Q = a(h - h_0)^b$ from WaterML timeseries.         |
| `atp_simulate_transient`               | Power Protection, Hydro & Polyglot Diagnostics      | Simulates electromagnetic transient trapezoidal companion-matrix response from ATP-EMTP decks.    |
| `dnp3_process_telemetry`               | Power Protection, Hydro & Polyglot Diagnostics      | Filters telemetry analog streams using IEEE 1815 / DNP3 deadband thresholding.                    |
| `oneliner_calculate_fault`             | Power Protection, Hydro & Polyglot Diagnostics      | Calculates symmetrical-component 3-phase and SLG fault currents from ASPEN OneLiner cases.        |
| `sel_evaluate_protection`              | Power Protection, Hydro & Polyglot Diagnostics      | Evaluates SEL relay trip logic, 50P instantaneous, and 51P time-overcurrent curves.               |
| `hec_hms_simulate_runoff`              | Power Protection, Hydro & Polyglot Diagnostics      | Simulates SCS Curve Number excess precipitation and unit hydrograph runoff from HEC-HMS basins.   |
| `asm_evaluate_biokinetics`             | Power Protection, Hydro & Polyglot Diagnostics      | Evaluates IWA Activated Sludge Model (ASM1) biological process and substrate conversion rates.    |

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

## Part II: VS Code Extension & Studio Workbench

The official ModelScript extension (`modelscript.modelscript`, source in `apps/ide/` and `packages/lsp/`) runs both in **VS Code Desktop** (Node.js extension host) and **VS Code for the Web / Studio (`https://ansatz.social/studio`)** (100% browser WebWorker host).

### 1. Polyglot Language Server (`@modelscript/lsp`)

A single unified Language Server Protocol instance provides incremental language intelligence across all 92 registered languages (`.mo`, `.sysml`, `.kerml`, `.msx`, `.mod`, `.pscx`, `.pswx`, `.raw`, `.dyr`, `.dsl`, `.dgs`, `.epc`, `.dyd`, `.dss`, `.ocpp`, `.oadr`, `.opt`, `.ran`, `.fbr`, `.inp`, `.ras`, `.tough`, `.nam`, `.lgm`, `.gtfs`, `.scad`, `.stp`, `.step`, `.usda`, `.owl`, `.ssp`, `.ssd`, `.ssv`, `.csv`, `.su2`, `.cfg`, `.gbr`, `.qif`, `.oscal.json`, `.aml`, `.osim`, `.rtplan`, `.cellml`, `.mlxtran`, `.3mf`, `.igtl`, and more):

- **Real-Time Diagnostics**: Incremental GLR parsing + Salsa `lint__*` queries + cross-file unit/type checking across 1,160 static diagnostic rules.
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
  - `memfs://`: Ephemeral in-memory workspace used in the browser Studio (`ansatz.social/studio`).
  - `github://`: Zero-clone direct browsing and editing of remote GitHub repositories.
- **ModelScript Interactive Notebooks (`modelscript.monbNotebook`)**:
  - Native VS Code `NotebookSerializer` and `NotebookController` for `.monb` files.
  - Supports polyglot code cells (`modelica`, `sysml2`, `modelscript`, `scad`, `sparql`) that share a reactive kernel session, rendering interactive Bode plots, time-series charts, 3D CAD viewports, and SVG schematics directly below each cell.

### 4. Custom Document Editors & Engineering Workbench Panels

The extension contributes **15 custom visual editors** and **over 20 specialized engineering webview panels**:

| Custom Editor / View ID                                | Bound File Types / Trigger                | Capabilities                                                                                                                                                                                                                                              |
| :----------------------------------------------------- | :---------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `modelscript.diagramEditor`                            | `.mo`, `.sysml`, `.pscx`, `.dsl`, `.dss`  | Bi-directional graphical schematic, power SLD/TCC/P-Q/R-X, & SysML v2 (BDD/IBD/State/Activity) editor; dragging components or routing wires updates source CST.                                                                                           |
| `modelscript.monbNotebook`                             | `.monb`                                   | Literate engineering notebook combining Markdown/LaTeX narratives with live simulation and verification cells.                                                                                                                                            |
| `modelscript.fmuViewer`                                | `.fmu`                                    | Inspects FMI 2.0/3.0 `modelDescription.xml`, causal ports, dependency sparsity matrices, and runs interactive test simulations on `.fmu` files.                                                                                                           |
| `modelscript.sspEditor`                                | `.ssp`, `.ssd`, `.ssv`                    | Visual block-diagram editor for wiring multi-FMU co-simulation topologies and editing `.ssv` parameter tables.                                                                                                                                            |
| `modelscript.reqifEditor`                              | `.reqif`, `.reqifz`                       | Tabular requirements specification editor with suspect-link indicators and one-click SysML v2 synchronization.                                                                                                                                            |
| `modelscript.cadViewer`                                | `.stp`, `.step`, `.scad`, `.usda`, `.glb` | Hardware-accelerated Three.js / WebGL 3D CAD viewport with section planes, B-Rep face selection, kinematic playback, and formal verification overlays (`verification-overlay.ts`: reachability tubes, SOS barrier shells, and dynamic clearance vectors). |
| `modelscript.gerberViewer`                             | `.gbr`, `.drl`                            | Multi-layer 2D/3D PCB copper, solder mask, silkscreen, and drill stackup inspector.                                                                                                                                                                       |
| `modelscript.cfdViewer`                                | `.su2`, `.vtk`, `.cfg`                    | Unstructured CFD mesh wireframe, boundary marker inspector, and pressure/velocity contour viewer.                                                                                                                                                         |
| `modelscript.feaViewer`                                | `.inp`, `.frd`                            | Finite-element mesh inspector with deformed shape magnification and von Mises stress colormaps.                                                                                                                                                           |
| `modelscript.qifEditor` (**QIF Metrology**)            | `.qif`                                    | ISO 23952 GD&T datum/characteristic inspector with live Statistical Process Control ($C_p/C_{pk}$, TUR, MMC/LMC bonus tolerance) control charts.                                                                                                          |
| `modelscript.oscalEditor` (**OSCAL Compliance**)       | `.oscal.json`, `.oscal.yaml`, `.oscal`    | NIST SP 800-53 / SP 800-82 Rev 3 OT/ICS control matrix inspector, profile baseline resolver, and POA&M audit dashboard.                                                                                                                                   |
| `modelscript.amlEditor` (**AutomationML Topology**)    | `.aml`, `.caex`, `.amlx`                  | IEC 62714 CAEX SystemUnitClass / RoleClass / InternalElement hierarchy explorer and Virtual PLC commissioning panel.                                                                                                                                      |
| `modelscript.opensimViewer` (**OpenSim Biomechanics**) | `.osim`                                   | 3D musculoskeletal kinematic chain viewer with Hill-type muscle activation-contraction curves and moment-arm plots.                                                                                                                                       |
| `modelscript.dicomRtViewer` (**DICOM-RT Dosimetry**)   | `.rtplan`, `.rtstruct`, `.rtdose`         | Cumulative Dose-Volume Histogram (DVH) plotter, QUANTEC OAR constraint scorecard, BED/$\text{EQD}_2$ calculator, and Beams-Eye-View MLC aperture inspector.                                                                                               |
| `modelscript.igtlViewer` (**OpenIGTLink Navigation**)  | `.igtl`, `.plus.xml`                      | $SE(3)$ surgical navigation coordinate-frame tree inspector, stylus pivot calibration solver, and Fitzpatrick Target Registration Error (TRE) analyzer.                                                                                                   |
| **Simulation & Bode Plot Studio**                      | `modelscript.simulate`                    | Interactive multi-axis oscilloscope, FFT spectrum analyzer, phase portrait plotter, and linearized State-Space ($A,B,C,D$) Bode/Nyquist root-locus analyzer.                                                                                              |
| **BLT & Tearing Matrix Inspector**                     | `modelscript.inspectBlt`                  | Visualizes the Tarjan Block Lower Triangular incidence matrix, Pantelides differentiated equations, and Cellier-Elmqvist tearing variables.                                                                                                               |
| **Formal Verification & Counterexample Center**        | `modelscript.verify`                      | Interactive dashboard for running BMC/$k$-induction/IC3/STL falsification and replaying falsifying counterexample traces step-by-step on the schematic.                                                                                                   |
| **Digital Thread & RTM Explorer**                      | `modelscript.digitalThread`               | Interactive graph explorer showing end-to-end traceability across OWL2 $\to$ SysML v2 $\to$ Modelica $\to$ CAD $\to$ Verification DHF.                                                                                                                    |

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
