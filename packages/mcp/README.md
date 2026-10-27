<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/mcp

Model Context Protocol (`@modelscript/mcp`) server, tools, and resources for ModelScript — exposing **47 specialized engineering tools** across multi-physics compilation, arena simulation, LTI linearization & SIMC PID tuning, OWL 2 ontology reasoning, Triple Graph Grammar (TGG) digital thread synchronization, Requirements Traceability Matrix (RTM) intelligence, autonomous closed-loop model synthesis, PSCAD IEEE 2800 grid compliance, OLGA multiphase flow assurance, GENSYS railway EN 14363 homologation, SIMPACK multibody kinematics, and federated social engineering threads to AI coding agents.

---

## Transports & Deployment Modes

1. **`modelscript-mcp` Stdio Binary (`src/main.ts`)**: Standard MCP `StdioServerTransport` binary for local desktop AI assistants (Claude Desktop, Cursor, VS Code Copilot, Windsurf, Zed, Antigravity).
2. **`PolyglotMcpHost` In-WASM AOT Dispatch (`src/polyglot-server.ts`)**: Dynamically mounts declarative MCP manifests (`defineLanguage({ mcp })`) and dispatches tool calls directly into compiled WebAssembly linear memory (`mcpDispatchTool`) with zero JS object marshaling overhead, plus real-time `DigitalThreadHypergraph` conflict tracking.
3. **HTTP / SSE Cloud Transport**: Integrates with the ModelScript API server (`/api/v1/mcp/sse` and `/api/v1/mcp/messages`) with built-in compute quota pre-flight checks (`ctx.checkQuota`).

---

## All 47 Registered MCP Tools (Across 10 Categories)

The MCP server (`src/tools.ts` + `src/polyglot-server.ts`) provides **47 specialized engineering tools** organized across 10 categories:

### 1. Modelica Compilation, Inspection & Control Linearization (6 Tools)

| Tool                 | Description                                                                                                                                     |
| :------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------- |
| `modelica_load`      | Load Modelica libraries or `.mo` files from filesystem paths into the active `Context`.                                                         |
| `modelica_parse`     | Parse inline Modelica source code via the native WASM GLR parser and return classes, components, equations, and syntax errors.                  |
| `modelica_flatten`   | Flatten a Modelica class FQN to its canonical Differential Algebraic Equation (DAE) system.                                                     |
| `modelica_query`     | Introspect a loaded Modelica class—returning its kind, description, components, `extends` hierarchy, and equations.                             |
| `modelica_linearize` | Linearize a Modelica DAE model around an operating point or equilibrium to extract LTI State-Space matrices ($A, B, C, D$), poles, and margins. |
| `modelica_tune_pid`  | Automatically tune a P, PI, or PID controller for a linearized Modelica plant using Skogestad IMC (SIMC) and sensitivity loop shaping.          |

### 2. Multi-Physics Simulation, DoE & Sensitivity (5 Tools)

| Tool                   | Description                                                                                                                                      |
| :--------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------- |
| `modelica_lint`        | Run static compiler diagnostics and semantic lint queries over loaded libraries.                                                                 |
| `modelica_simulate`    | Flatten and numerically simulate a Modelica model (`rk4`, `dopri5`, `bdf`, `auto`) using the arena simulation pipeline (`CSV` or `JSON` output). |
| `hybrid_simulate`      | Flatten and simulate a hybrid SysML v2 / Modelica cyber-physical system with discrete events and state transitions.                              |
| `modelica_doe`         | Execute a Design of Experiments (DoE) parameter sweep (`runArenaDoE`) for response surface analysis or ROM training.                             |
| `modelica_sensitivity` | Run One-At-a-Time (OAT) sensitivity analysis (`runSensitivityAnalysisArena`) and report normalized sensitivity coefficients.                     |

### 3. OWL 2 Ontology Reasoning & Fault Propagation (5 Tools)

| Tool                          | Description                                                                                                              |
| :---------------------------- | :----------------------------------------------------------------------------------------------------------------------- |
| `validate_system_consistency` | Validate cross-domain logical consistency of the unified polyglot model using the OWL 2 `TableauReasoner`.               |
| `query_ontology_sparql`       | Evaluate a SPARQL-DL or Property Path query against the unified polyglot ontology (`executeQueryString`).                |
| `query_ontology_bgp`          | Evaluate a multi-pattern Basic Graph Pattern (BGP) query using worst-case optimal Leapfrog Triejoin (`executeBgpQuery`). |
| `trace_fault_propagation`     | Trace failure blast radius across transitive `isConnectedTo` relationships from a starting component IRI.                |
| `explain_inference`           | Compute the formal axiom justification chain explaining why an inferred `SubClassOf` relationship holds.                 |

### 4. Triple Graph Grammar (TGG) Digital Thread Synchronization (3 Tools)

| Tool                    | Description                                                                                             |
| :---------------------- | :------------------------------------------------------------------------------------------------------ |
| `tgg_query_thread`      | Query multi-way digital thread alignments linking SysML v2, Modelica, CAD, and Requirements.            |
| `tgg_diagnose_conflict` | Diagnose active multi-master concurrent edit conflicts with SMT bounds and physical feasibility checks. |
| `tgg_reconcile_slot`    | Reconcile a multi-master conflict slot using a physics-constrained or domain-authority strategy.        |

### 5. Requirements Traceability Matrix (RTM) Intelligence (3 Tools)

| Tool                   | Description                                                                                                       |
| :--------------------- | :---------------------------------------------------------------------------------------------------------------- |
| `rtm_query_matrix`     | Query Digital Thread RTM health, verification coverage percentages, and orphan requirements (`RtmIndexEngine`).   |
| `rtm_suggest_links`    | Recommend candidate architectural or physics components to `@satisfy` or `@verify` an orphan requirement.         |
| `rtm_diagnose_suspect` | Diagnose why a traceability link was flagged as `SUSPECT` after an upstream edit and suggest remediation actions. |

### 6. Autonomous Closed-Loop Synthesis, Calibration & Workspace I/O (5 Tools)

| Tool                                 | Description                                                                                                                                                             |
| :----------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `modelscript_closed_loop_synthesize` | Synthesize and certify a SysML v2 or Modelica model through closed-loop compiler verification gates (Syntax, QUDV Dimensions, SMT Feasibility, DAE Structural Balance). |
| `modelica_diff_calibrate`            | Calibrate Modelica parameters against experimental measurement curves using continuous DAE adjoint sensitivity and L-BFGS-B optimization (`ModelicaCalibrator`).        |
| `modelscript_patch_code`             | Surgically patch a workspace model file by replacing `searchBlock` with `replaceBlock`.                                                                                 |
| `modelscript_read_file`              | Read full contents or a 1-indexed line range from a workspace file.                                                                                                     |
| `modelscript_list_workspace_files`   | List engineering model files in the workspace (`.mo`, `.sysml`, `.step`, `.scad`, `.csv`, etc.).                                                                        |

### 7. PSCAD Power Systems & IEEE 2800 Compliance (4 Tools)

| Tool                    | Description                                                                                                                                                                                                        |
| :---------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pscad_lint`            | Lint a PSCAD project (`.pscx`, `.pslx`) or workspace (`.pswx`) for electrical topology, floating terminals, and weak grid (SCR) issues (`M6001`–`M6017`).                                                          |
| `pscad_simulate`        | Simulate a PSCAD electromagnetic transient (EMT) circuit using the WebAssembly Dommel companion-circuit solver (Bergeron lines, CDA switch damping, IBR FMUs).                                                     |
| `pscad_verify_ieee2800` | Automate **IEEE Std 2800-2022** grid code compliance testing for Inverter-Based Resources (momentary cessation, reactive current injection $T_{90} \le 50\,\text{ms}$, overvoltage ceiling $\le 1.20\,\text{pu}$). |
| `pscad_export`          | Export a PSCAD project (`.pscx`, `.pslx`) to Modelica (`OpenIPSL`) or FMI/SSP (`SystemStructure.ssd`).                                                                                                             |

### 8. OLGA Multiphase Flow Assurance (9 Tools)

| Tool             | Description                                                                                                                                                     |
| :--------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `olga_simulate`  | Simulate transient multiphase flow, liquid holdup, pressure drops, terrain slugging, and pigging for an OLGA model (`.opi`, `.key`, `.genkey`).                 |
| `olga_lint`      | Run pre-flight multiphase flow assurance diagnostics (`M7001`–`M7013`: CFL stability, steep risers, severe slugging dips, pig stuck, sour service, asphaltene). |
| `olga_verify`    | Formally verify multiphase simulation against flow assurance limits (MAOP, hydrate subcooling margin, and slug catcher capacity).                               |
| `olga_diagram`   | Generate standalone SVG diagrams for an OLGA flowline: topological P&ID schematic or pipeline elevation bathymetry $Z(X)$ with holdup heatmaps.                 |
| `olga_parse_tpl` | Parse an OLGA simulation trend plot (`.tpl`) into a structured time-series dataset with variable catalog, units, and channel statistics.                        |
| `olga_parse_ppl` | Parse an OLGA spatial profile plot (`.ppl`) into spatial snapshots along pipeline coordinate $X$ with flow regimes and critical extrema.                        |
| `olga_tune`      | Calibrate OLGA flowline parameters (roughness, choke $C_d$, heat transfer, well PI) via Nelder-Mead simplex history matching against telemetry CSV data.        |
| `olga_gate`      | Evaluate an automated Flow Assurance CI/CD Safety Gate check on an OLGA model for pull requests and operational envelope verification.                          |
| `olga_survey`    | Ingest 3D seabed bathymetry survey coordinates (CSV) and discretize into adaptive curvature-aware OLGA pipe segments.                                           |

### 9. GENSYS Railway Dynamics & SIMPACK Multibody Kinematics (5 Tools)

| Tool                    | Description                                                                                                                              |
| :---------------------- | :--------------------------------------------------------------------------------------------------------------------------------------- |
| `gensys_lint`           | Perform pre-flight semantic and physical validation (`G1001`–`G1006`) on GENSYS railway vehicle models (`.calc`, `.run`, `.sub`).        |
| `gensys_verify_en14363` | Verify Nadal derailment quotient ($Y/Q \le 0.8$) and Prud'homme lateral track shifting force limits according to **EN 14363 / UIC 518**. |
| `gensys_fastsim`        | Compute tangential longitudinal/lateral creep forces and spin moment using Kalker's **FASTSIM** algorithm in WebAssembly.                |
| `simpack_lint`          | Perform structural and reference diagnostics (`K7001`–`K7006`) on SIMPACK XML (`.spck`) or classic deck (`.sim`, `.mbs`) files.          |
| `simpack_mobility`      | Calculate spatial degrees of freedom and overconstrained mechanisms using the Grübler-Kutzbach criterion.                                |

### 10. Federated Engineering Social Threads (2 Tools)

| Tool                 | Description                                                                                                                    |
| :------------------- | :----------------------------------------------------------------------------------------------------------------------------- |
| `social_read_thread` | Read the conversation thread history, parent post, and engineering artifact attachments for a given social post ID.            |
| `social_post_reply`  | Post an engineering verification result or simulation response to a social discussion thread on behalf of an authorized agent. |

---

## MCP Resources (`src/resources.ts`)

`@modelscript/mcp` registers **3 core `modelica://` resources** for read-only inspection of loaded workspace state:

| Resource URI                | MIME Type          | Description                                                                                                                  |
| :-------------------------- | :----------------- | :--------------------------------------------------------------------------------------------------------------------------- |
| `modelica://libraries`      | `application/json` | Lists all loaded Modelica libraries and their filesystem paths.                                                              |
| `modelica://classes`        | `application/json` | Lists all indexed classes across loaded libraries and inline contexts (`name`, `kind`, `library`).                           |
| `modelica://classes/{name}` | `application/json` | Resource template returning detailed class introspection (`kind`, `description`, `components`, `childClasses`) for `{name}`. |

_(When running `PolyglotMcpHost`, declarative language resources such as `modelica://workspace/{className}/ast`, `modelica://workspace/{className}/dae`, and `sysml2://workspace/{partName}/topology` are also mounted automatically.)_

---

## Client Configuration (Claude Desktop / Cursor / VS Code)

### Claude Desktop (`claude_desktop_config.json`) & Cursor (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "modelscript": {
      "command": "npx",
      "args": ["-y", "@modelscript/mcp"],
      "env": {
        "MODELICAPATH": "/path/to/libraries"
      }
    }
  }
}
```

### VS Code (`.vscode/mcp.json`)

```json
{
  "servers": {
    "modelscript": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/packages/mcp/dist/main.js"]
    }
  }
}
```

---

## Programmatic Usage

```typescript
import { createServer, PolyglotMcpHost } from "@modelscript/mcp";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const { server, context } = createServer();
const transport = new StdioServerTransport();
await server.connect(transport);
```

---

## Scripts

```bash
# Build TypeScript package
npm run build --workspace=@modelscript/mcp

# Run MCP tool and resource test suite
npm run test --workspace=@modelscript/mcp

# Typecheck and lint
npm run typecheck --workspace=@modelscript/mcp
npm run lint --workspace=@modelscript/mcp
```
