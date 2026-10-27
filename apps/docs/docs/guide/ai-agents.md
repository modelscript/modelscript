---
title: AI Agents & MCP Workflows
description: Connect Claude Code, Cursor, Windsurf, and custom LLM agents to ModelScript's 52 deterministic compiler, simulation, CAD, TGG, and formal verification MCP tools.
---

# AI Agents & MCP Workflows

Large language models excel at generating structure and exploring design spaces, but when asked to write differential equations, power-grid topologies, or safety-critical requirements in free text, they frequently hallucinate mismatched units, structurally singular DAEs, or violated physical conservation laws.

ModelScript closes this loop through **`@modelscript/mcp`** — a deterministic **Model Context Protocol (MCP)** server exposing **52 polyglot compilation, simulation, CAD, TGG, and formal verification tools** (plus **70+ domain-specific tool extensions**). Instead of guessing physics, an AI agent iteratively compiles, simulates, verifies, and calibrates models against mathematical solvers until every requirement proof passes.

---

## 1. Connecting Your AI Agent

`@modelscript/mcp` supports three transport topologies: local `stdio`, remote HTTP Server-Sent Events (`SSE`), and in-browser WebAssembly (`PolyglotMcpHost`).

### Claude Code (`stdio`)

Register the MCP server directly in your project or user scope:

```bash
claude mcp add modelscript -- npx -y @modelscript/mcp
```

### Cursor, Windsurf, Claude Desktop & VS Code (`stdio`)

Add `@modelscript/mcp` to `.cursor/mcp.json`, `.vscode/mcp.json`, or `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "modelscript": {
      "command": "npx",
      "args": ["-y", "@modelscript/mcp"],
      "env": {
        "MODELSCRIPT_API_URL": "http://localhost:3000"
      }
    }
  }
}
```

### Hosted Enterprise Hub (`SSE`)

For cloud agents, CI review bots, and multi-tenant teams, connect to the ModelScript Hub's authenticated SSE gateway (`/api/v1/mcp/sse`) using a user JWT or scoped `ms_bot_*` service token:

```json
{
  "mcpServers": {
    "modelscript-cloud": {
      "url": "https://hub.example.com/api/v1/mcp/sse",
      "headers": {
        "Authorization": "Bearer ms_bot_live_9f8e7d6c5b4a..."
      }
    }
  }
}
```

### Grounding Context Windows with `/llms.txt`

When prompting an LLM outside of MCP (or seeding system prompts for custom agents), point the model at **`https://modelscript.org/llms.txt`**. It is generated directly from the compiler's CLI definitions, language registry, and linter catalogs during every documentation build.

---

## 2. Core Agentic Engineering Workflows

```mermaid
sequenceDiagram
    participant Agent as AI Agent (Claude / Cursor)
    participant MCP as @modelscript/mcp (52 Tools)
    participant Core as WASM GLR + Salsa + DAE Arena
    participant Verify as 13 Theory Oracles & Solvers

    Agent->>MCP: 1. modelica_lint / sysml2_check_constraints
    MCP->>Core: Parse CST & evaluate 790 static lint rules
    Core-->>Agent: Structured diagnostics (line, col, rule, fix)
    Agent->>MCP: 2. modelscript_closed_loop_synthesize
    MCP->>Verify: Flatten DAE -> Integrate -> Check STL robustness
    Verify-->>MCP: Counterexample trace (overshoot = 8.4% at t = 0.42s)
    MCP-->>Agent: Actionable gradient & counterexample feedback
    Agent->>MCP: 3. modelica_diff_calibrate (L-BFGS / Adam)
    MCP->>Verify: Optimize parameters & re-verify contracts
    Verify-->>Agent: Certified SAFE + SHA-256 Proof Manifest
```

### Workflow A: Autonomous Closed-Loop Physical Synthesis

Rather than writing a Modelica controller in one shot and hoping it stabilizes the plant, instruct the agent to call **`modelscript_closed_loop_synthesize`**. This single tool orchestrates a five-stage compiler/solver loop:

1. **GLR Parse & Semantic Lint** (`modelica_lint` across 307 Modelica rules)
2. **Arena DAE Flattening & Pantelides Index Reduction** (`modelica_flatten`)
3. **Time-Domain Integration** (`modelica_simulate` via SUNDIALS CVODE/IDA or Radau IIA)
4. **Signal Temporal Logic (STL) Verification** (`sysml2_falsify_requirements`)
5. **Counterexample & Sensitivity Tuning**: Evaluates STL robustness $\rho$ and tunes designated control gains (`tunableParameters`) via IMC-PID and sensitivity refinement until all five verification gates pass.

**Example MCP Tool Call:**

```json
{
  "name": "modelscript_closed_loop_synthesize",
  "arguments": {
    "modelName": "ActiveSuspension",
    "modelicaSource": "model ActiveSuspension\n  parameter Real k_s = 18000;\n  parameter Real c_d = 1450;\n  ...\nend ActiveSuspension;",
    "sysmlSource": "requirement def <'REQ-RIDE-01'> PeakAccelerationBound {\n  require constraint { maxVerticalAccel <= 1.8 }\n}",
    "tunableParameters": ["Kp", "Ki", "Kd"],
    "stopTime": 5.0,
    "maxRepairIterations": 5
  }
}
```

---

### Workflow B: Differentiable Parameter Calibration Against Test Data

When you have experimental bench data or field telemetry in CSV format, the agent can call **`modelica_diff_calibrate`** to fit unknown physical parameters (such as friction coefficients, thermal resistances, or battery internal impedances) using forward-mode Automatic Differentiation (`DualNumber`) paired with **L-BFGS** or **Adam**:

```json
{
  "name": "modelica_diff_calibrate",
  "arguments": {
    "modelName": "LithiumIonCell",
    "sourceCode": "model LithiumIonCell ... end LithiumIonCell;",
    "targetCsv": "time,v_terminal\n0.0,4.18\n10.0,4.09\n20.0,4.02\n...",
    "parameters": [
      { "name": "R_internal", "initial": 0.05, "min": 0.005, "max": 0.25 },
      { "name": "C_dl", "initial": 1200.0, "min": 100.0, "max": 5000.0 }
    ],
    "optimizer": "lbfgs",
    "maxIterations": 60,
    "tolerance": 1e-5
  }
}
```

After calibration converges, ask the agent to invoke **`modelica_sensitivity`** to inspect local identifiability and confidence intervals around the calibrated operating point.

---

### Workflow C: Bidirectional SysML v2 $\leftrightarrow$ Modelica TGG Synchronization

When a systems engineer adds a port or updates a mass budget in `.sysml` while a controls engineer edits equations in `.mo`, the digital thread can diverge. AI agents resolve cross-domain drift deterministically using three TGG & Theory Coordinator tools:

1. **`validate_system_consistency`**: Cross-checks `.sysml` and `.mo` models (or runs the 13 Nelson-Oppen Domain Theory Oracles) to detect port topology mismatches, unit conflicts, and divergent shared parameter slots.
2. **`tgg_diagnose_conflict`**: Runs static Critical Pair Analysis (CPA) and inspects concurrent edits on Triple Graph Grammar correspondence nodes.
3. **`tgg_reconcile_slot`**: Applies a formal resolution policy (`source-wins`, `target-wins`, `physics-simplex`, or `interval_intersection`) and rewrites both ASTs losslessly.

```json
{
  "name": "tgg_reconcile_slot",
  "arguments": {
    "correspondenceId": "corr_ThermalCoolantLoop_maxPressure",
    "strategy": "interval_intersection",
    "sysmlPath": "architecture/ThermalSystem.sysml",
    "modelicaPath": "models/ThermalCoolantLoop.mo"
  }
}
```

---

### Workflow D: Requirements Traceability Matrix (RTM) & Suspect Link Auditing

Before cutting a release or generating an FDA / ISO 26262 Design History File (`msx dhf export`), an AI agent can audit the workspace's Requirements Traceability Matrix:

1. **`rtm_query_matrix`**: Queries all requirements, satisfying architecture/physics elements, verification test cases, coverage percentages, and suspect links (where a downstream `.mo` equation or `.step` CAD solid changed after the requirement was last verified).
2. **`rtm_diagnose_suspect`**: Computes the structural CST/DAE delta across the suspect link and recommends whether to re-run verification (`sysml2_verify`) or update the requirement bound.
3. **`rtm_export_reqif`**: Exports the synchronized traceability matrix to OMG ReqIF 1.2 (`.reqif`) for enterprise ALM import.

---

### Workflow E: Cross-Domain CAD/FEA Sizing, Legacy B2B Certification & Formal Safety

Beyond 1D system dynamics, `@modelscript/mcp` provides five cross-domain certification tools:

- **`cad_fea_closed_loop_size`**: Couples parametric 3D OpenSCAD/STEP geometry with tetrahedral FEA von Mises stress analysis and 3D BVH collision clearance checks, iteratively sizing ribs, walls, and fillets until structural safety factors hold.
- **`polyglot_migrate_and_verify_b2b`**: Transpiles legacy Simulink (`.slx`), SPICE (`.cir`), or Adams (`.adm`) models into balanced Modelica and SysML v2, then executes an ISO 26262 Part 6 Back-to-Back (B2B) trajectory equivalence proof with C99 SHA-256 codegen parity.
- **`ssp_diagnose_cosim_stability`**: Detects direct-feedthrough algebraic loops across multi-FMU SSP topologies, computes the Zero-Order Hold (ZOH) spectral radius $\rho(J_{\mathrm{ZOH}})$, and synthesizes FMI directional-derivative Newton relaxation schedules.
- **`formal_verify_safety_and_mcdc`**: Proves unbounded safety invariants via IC3/PDR and Sum-of-Squares (SOS) barrier certificates, and synthesizes DO-178C / ISO 26262 MC/DC independence-pair test vectors.
- **`twin_discover_sindy_and_rom`**: Runs Sparse Identification of Nonlinear Dynamics (SINDy STLSQ) over hardware telemetry residuals to discover unmodeled physics terms and calibrate a real-time Reduced-Order Model (ROM).

---

## 3. Recommended Prompt Patterns for Engineers

Use these prompt templates with Claude Code or Cursor when working in a ModelScript workspace:

> ** Synthesis & Verification Prompt:**
> _"Create a Modelica model `DC_BuckConverter.mo` and a companion `BuckConverterReq.sysml` specifying a $12\text{ V} \to 5\text{ V}$ step-down converter with output voltage ripple $\le 50\text{ mV}$ and settling time $\le 4\text{ ms}$. Run `modelica_lint`, simulate with `modelica_simulate`, and iterate using `modelscript_closed_loop_synthesize` until `sysml2_verify` proves both requirements SAFE."_

> ** Legacy Migration Prompt:**
> _"Import `legacy/PitchActuator.slx` into `models/PitchActuator.mo` using `polyglot_migrate_and_verify_b2b`, run `modelica_lint` to resolve any diagnostic warnings, and verify that the step response matches the Simulink reference trajectory within $10^{-4}$ relative error."_

> ** Grid Compliance Prompt:**
> _"Run `pscad_lint` and `pscad_verify_ieee2800` on `grid/WindFarm_300MW.pscx`. If Low-Voltage Ride-Through (LVRT) reactive current response time $T_{\text{resp}}$ exceeds $30\text{ ms}$, adjust the inverter inner current loop gains and re-run `pscad_verify_ieee2800` until all IEEE Std 2800-2022 clauses pass."\_

---

## Next Steps

- **[MCP Server & IDE Workbench Reference](../reference/mcp-and-ide.md)** — Full schema reference for all 52 core MCP tools, IDE copilot tiers, and autonomous social bots.
- **[CI/CD & GitHub Actions](./ci-cd.md)** — Automate headless linting, SARIF verification, visual PR diffs, and DHF compliance dossiers on every commit.
