<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/mcp

Model Context Protocol (`@modelscript/mcp`) server, tools, and resources for ModelScript — exposing **92 specialized engineering tools** across **81 engineering languages**, covering multi-physics compilation, arena simulation, LTI linearization & SIMC PID tuning, nonlinear bifurcation & stochastic jump dynamics, OWL 2 ontology reasoning, Triple Graph Grammar (TGG) digital thread synchronization, Requirements Traceability Matrix (RTM) intelligence, autonomous closed-loop model synthesis, PSCAD IEEE 2800 & OpenDSS grid analysis, EPANET & SWMM municipal water/stormwater compliance, Optical DWDM / 3GPP RAN / Fiber OSP telecommunications, ECAD DFM & BOM supply-chain auditing, OLGA multiphase flow assurance, GENSYS railway EN 14363 homologation, SIMPACK multibody kinematics, 3D CAD/FEA sizing, ISO 26262 legacy migration, formal IC3/SOS verification, ISO 23952 QIF metrology, NIST OSCAL cybersecurity compliance, IEC 62714 AutomationML virtual commissioning, and radiology/biomechanics/surgical CAS verification to AI coding agents.

---

## Transports & Deployment Modes

1. **`modelscript-mcp` Stdio Binary (`src/main.ts`)**: Standard MCP `StdioServerTransport` binary for local desktop AI assistants (Claude Desktop, Claude Code, Cursor, VS Code Copilot, Windsurf, Zed, Antigravity).
2. **`PolyglotMcpHost` In-WASM AOT Dispatch (`src/polyglot-server.ts`)**: Dynamically mounts declarative MCP manifests (`language({ mcp })`) and dispatches tool calls directly into compiled WebAssembly linear memory (`mcpDispatchTool`) with zero JS object marshaling overhead, plus real-time `DigitalThreadHypergraph` conflict tracking.
3. **HTTP / SSE Cloud Transport**: Integrates with the ModelScript API server (`/api/v1/mcp/sse` and `/api/v1/mcp/messages`) with built-in compute quota pre-flight checks (`ctx.checkQuota`).

---

## All 92 Registered MCP Tools (Across 15 Categories)

The MCP server (`src/tools.ts` + `src/polyglot-server.ts`) provides **92 specialized engineering tools** organized across 15 categories:

### 1. Modelica Compilation, Inspection & Control Linearization (6 Tools)

| Tool                 | Description                                                                                                                                     |
| :------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------- |
| `modelica_load`      | Load Modelica libraries or `.mo` files from filesystem paths into the active `Context`.                                                         |
| `modelica_parse`     | Parse inline Modelica source code via the native WASM GLR parser and return classes, components, equations, and syntax errors.                  |
| `modelica_flatten`   | Flatten a Modelica class FQN to its canonical Differential Algebraic Equation (DAE) system.                                                     |
| `modelica_query`     | Introspect a loaded Modelica class—returning its kind, description, components, `extends` hierarchy, and equations.                             |
| `modelica_linearize` | Linearize a Modelica DAE model around an operating point or equilibrium to extract LTI State-Space matrices ($A, B, C, D$), poles, and margins. |
| `modelica_tune_pid`  | Automatically tune a P, PI, or PID controller for a linearized Modelica plant using Skogestad IMC (SIMC) and sensitivity loop shaping.          |

### 2. Multi-Physics Simulation, DoE, Sensitivity, Bifurcation & Stochastic Jumps (7 Tools)

| Tool                                   | Description                                                                                                                                      |
| :------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------- |
| `modelica_lint`                        | Run static compiler diagnostics and semantic lint queries over loaded libraries.                                                                 |
| `modelica_simulate`                    | Flatten and numerically simulate a Modelica model (`rk4`, `dopri5`, `bdf`, `auto`) using the arena simulation pipeline (`CSV` or `JSON` output). |
| `hybrid_simulate`                      | Flatten and simulate a hybrid SysML v2 / Modelica cyber-physical system with discrete events and state transitions.                              |
| `modelica_doe`                         | Execute a Design of Experiments (DoE) parameter sweep (`runArenaDoE`) for response surface analysis or ROM training.                             |
| `modelica_sensitivity`                 | Run One-At-a-Time (OAT) sensitivity analysis (`runSensitivityAnalysisArena`) and report normalized sensitivity coefficients.                     |
| `modelscript_bifurcation_continuation` | Trace nonlinear steady-state equilibrium curves $F(x, p) = 0$ via Pseudo-Arclength Continuation (PALC) and detect Fold (LP), Hopf (HB), and Branch (BP) bifurcations. |
| `modelscript_stochastic_jump`          | Execute discrete-state stochastic chemical/epidemiological jump simulations using Gillespie Direct SSA, First-Reaction SSA, or Adaptive Tau-Leaping. |

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

### 11. 3D CAD/FEA Sizing, Legacy Migration, Co-Sim Stability, Formal Safety & Digital Twin Discovery (5 Tools)

| Tool                              | Description                                                                                                                                                             |
| :-------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cad_fea_closed_loop_size`        | Run closed-loop 3D CAD/OpenSCAD/STEP parametric sizing coupled with tetrahedral FEA von Mises stress analysis and 3D BVH collision clearance verification.              |
| `polyglot_migrate_and_verify_b2b` | Migrate legacy Simulink (`.slx`), SPICE (`.cir`), or MSC Adams (`.adm`) models to Modelica & SysML v2 and certify ISO 26262 Back-to-Back (B2B) trajectory & C99 parity. |
| `ssp_diagnose_cosim_stability`    | Analyze an FMI 2.0/3.0 & SSP multi-FMU co-simulation topology for algebraic feedthrough loops and ZOH spectral radius ($\rho(J_{\text{ZOH}})$) instability.             |
| `formal_verify_safety_and_mcdc`   | Prove unbounded safety invariants via IC3/PDR and Sum-of-Squares (SOS) barrier certificates, and generate DO-178C / ISO 26262 MC/DC independence-pair test vectors.     |
| `twin_discover_sindy_and_rom`     | Discover sparse nonlinear governing differential equations (SINDy STLSQ) from hardware telemetry residuals and calibrate a Reduced-Order Model (ROM) digital twin.      |

### 12. Digital Metrology, Cybersecurity, AutomationML & Radiology / Surgical CAS (8 Tools)

| Tool                            | Description                                                                                                                                                                 |
| :------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `qif_inspect_and_spc`           | Evaluate an ISO 23952 Quality Information Framework (QIF) document, run NIST QIF & ASME Y14.5 GD&T checks (`M8101`–`M8108`), and compute SPC capability ($C_p/C_{pk}$).     |
| `oscal_audit_cps_compliance`    | Audit a NIST OSCAL document against NIST SP 800-53 Rev 5 and SP 800-82 Rev 3 OT/ICS overlays (`M8201`–`M8208`) and verify cyber-physical architectural component coverage.  |
| `aml_run_virtual_commissioning` | Parse an IEC 62714 AutomationML / CAEX workcell topology (`M8301`–`M8308`) and execute closed-loop virtual commissioning coupling `VirtualPlc` logic and plant dynamics.    |
| `opensim_analyze`               | Parse an OpenSim (`.osim`) musculoskeletal biomechanics model (`M9101`–`M9110`) and simulate Hill-type muscle activation and contraction dynamics.                          |
| `dicom_rt_verify_dvh`           | Evaluate a DICOM-RT treatment plan (`RTPLAN`, `RTSTRUCT`, `RTDOSE`), verify QUANTEC OAR dose constraints (`M9201`–`M9210`), and compute DVH, CI, HI, BED, and EQD2 metrics. |
| `cellml_simulate`               | Parse a CellML 1.0/1.1/2.0 electrophysiology or microvascular model, verify SI dimensional consistency (`M9301`–`M9310`), and integrate action potential ODEs.              |
| `igtl_verify_calibration`       | Parse an OpenIGTLink / PLUS surgical navigation configuration (`M9801`–`M9810`) and solve stylus pivot calibration and Fitzpatrick Target Registration Error (TRE).         |
| `three_mf_verify_guide`         | Verify an ISO/ASTM 52915 3MF Medical patient-specific surgical guide mesh for 2-manifold watertightness, wall thickness, osteotomy normals, and biocompatibility (`M9701`). |

### 13. OpenDSS Unbalanced Distribution Grids & DER Hosting Capacity (7 Tools)

| Tool                         | Description                                                                                                                                                                         |
| :--------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `opendss_solve_powerflow`    | Solve multi-phase unbalanced distribution AC power flow using a sparse $\mathbf{Y}_{\text{bus}}$ nodal admittance matrix with `RegControl` tap changers and `CapControl` banks.    |
| `opendss_solve_faults`       | Compute short-circuit fault currents (3-phase symmetrical, single line-to-ground SLG, line-to-line LL) and Thévenin equivalent impedances.                                          |
| `opendss_evaluate_harmonics` | Compute frequency-dependent harmonic voltage propagation and Total Harmonic Distortion ($\text{THD}\%$) across a user-specified harmonic spectrum.                                  |
| `opendss_analyze_reliability`| Evaluate predictive distribution feeder reliability indices (IEEE 1366: SAIFI, SAIDI, CAIDI, ASAI, EEN) and identify critical risk branches.                                        |
| `opendss_solve_gic`          | Analyze geomagnetically induced currents (GIC) from space weather events across substation earth grounds and identify transformer half-cycle saturation risks.                      |
| `opendss_hosting_capacity`   | Calculate distribution feeder maximum DER hosting capacity limited by ANSI C84.1 voltage rise and line thermal capacity, with optional IEEE 1547 smart inverter Volt-VAR mitigation. |
| `opendss_simulate_flisr`     | Simulate automated Fault Location, Isolation, and Service Restoration (FLISR) distribution grid self-healing and calculate customer interruption hours saved.                        |

### 14. Municipal Water Distribution (`EPANET`), Stormwater (`SWMM`) & ECAD/BOM (14 Tools)

| Tool                                 | Description                                                                                                                                                                |
| :----------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `epanet_solve_hydraulics`            | Solve steady-state or extended-period hydraulics for a US EPA EPANET water distribution network (`.inp`).                                                                  |
| `epanet_fire_flow_analysis`          | Perform fire-flow capacity analysis at a municipal hydrant node, evaluating available GPM at $20\text{ psi}$ residual pressure.                                            |
| `epanet_outage_contingency`          | Simulate N-1 pipe break isolation and unsupplied customer demand under Pressure-Dependent Demand (PDD).                                                                    |
| `epanet_water_hammer_surge`          | Simulate acoustic pressure wave propagation, Joukowsky surge spikes, and cavitation risk via the Method of Characteristics (MOC).                                          |
| `water_audit_awwa_m36`               | Perform standard AWWA M36 Water Audit calculating CARL, UARL, Infrastructure Leakage Index (ILI), and non-revenue water financial losses.                                  |
| `epanet_optimize_cip`                | Optimize multi-year Capital Improvement Planning (CIP) pipe replacement and upsizing to maximize hydraulic performance under budget constraints.                           |
| `epanet_calibrate_scada`             | Calibrate EPANET pipe Hazen-Williams roughness $C$-factors against SCADA telemetry pressure observations.                                                                  |
| `epanet_gis_to_model`                | Ingest municipal GIS pipe centerlines, junction assets, and DEM rasters from GeoJSON / ASCII grids into a ready-to-solve EPANET network (`.inp`).                          |
| `swmm_flood_routing`                 | Simulate 1D Saint-Venant dynamic wave routing in an urban stormwater or combined sewer network (`.inp`), reporting peak flows and node flooding.                           |
| `swmm_simulate_rtc`                  | Simulate Real-Time Control (RTC) gate/weir/pump modulation for urban Combined Sewer Overflow (CSO) mitigation.                                                             |
| `swmm_gis_to_model`                  | Ingest municipal GIS stormwater/wastewater conduits, manholes, catchment polygons, and DEM rasters from GeoJSON / ASCII grids into a complete SWMM network (`.inp`).       |
| `ecad_dfm_audit`                     | Run Design for Manufacturing, Assembly, and Test (DFM/DFA/DFT) design rule checks on PCB layout data.                                                                      |
| `ecad_generate_manufacturing_bundle` | Generate verified PCB manufacturing bundles (IPC-2581C, ODB++ v8.1, RS-274X Gerbers, and Centroid PnP) from PCB layout.                                                    |
| `supply_chain_scrub_bom`             | Scrub a Bill of Materials across multi-tier distributors (Nexar, Digi-Key, Mouser) to evaluate pricing, stock availability, lead times, and obsolescence risks.            |

### 15. Telecommunications, Optical DWDM, 3GPP RAN & Fiber Outside Plant (9 Tools)

| Tool                           | Description                                                                                                                                                                                  |
| :----------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `optical_inspect_otdr`         | Inspect a Telcordia GR-196/SR-4731 `.sor` Optical Time-Domain Reflectometer (OTDR) binary file to extract fiber span attenuation, event loss, reflectance, and splice integrity.             |
| `optical_solve_transmission`   | Solve multi-span optical DWDM transmission performance using the Enhanced Gaussian Noise (EGN) nonlinear model, computing GSNR, ASE noise, NLI power, and chromatic dispersion accumulation. |
| `ran_solve_microwave_budget`   | Solve line-of-sight microwave link budget, Free Space Path Loss (FSPL), ITU-R P.530 rain fade, Fresnel clearance, and annual availability percentage ("five-nines" verification).            |
| `fiber_locate_otdr_fault`      | Pinpoint the exact physical GIS GPS latitude/longitude of an optical fiber break measured by OTDR, correcting for cable helix excess length and vault slack loops.                           |
| `ran_evaluate_mpe_safety`      | Evaluate FCC OET-65, Health Canada Safety Code 6, ICNIRP 2020, EU CENELEC, Swiss NISV, and Italian CEI 211 RF Maximum Permissible Exposure (MPE) exclusion zones and TER ($\le 1.0$).        |
| `ran_evaluate_faa_obstruction` | Evaluate FAA 14 CFR Part 77, ICAO Annex 14 Volume I, and Transport Canada CAR 601.23 airspace obstruction notice criteria and runway slope penetrations for telecom towers.                  |
| `fiber_evaluate_pole_loading`  | Evaluate utility pole structural loading pursuant to US NESC Rule 250/260, Canadian CSA C22.3 No. 1, or Eurocode EN 50341 / EN 1991-1-4 (bending moment & ice/wind capacity utilization).    |
| `fiber_generate_bdc_fabric`    | Generate FCC Broadband Data Collection (BDC) and NTIA BEAD compliant spatial datasets discretized into Uber H3 Resolution 8 or 9 hexagonal bins.                                             |
| `telecom_evaluate_nors_outage` | Evaluate whether a telecom network outage meets mandatory FCC Part 4 (`47 CFR § 4.9`) NORS reporting thresholds ($900\text{k}$ user-minutes or 911/PSAP impact) and generate filing dossiers. |

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

## Client Configuration (VS Code / Claude Code / Cursor / Claude Desktop)

### VS Code (`.vscode/mcp.json` & CLI)

```json
{
  "servers": {
    "modelscript": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelscript/mcp"]
    }
  }
}
```

Or add via the VS Code CLI:

```bash
code --add-mcp '{"name":"modelscript","command":"npx","args":["-y","@modelscript/mcp"]}'
```

### Claude Code (`stdio`)

```bash
claude mcp add modelscript -- npx -y @modelscript/mcp
```

### Claude Desktop (`claude_desktop_config.json`), Cursor (`.cursor/mcp.json`) & Windsurf

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

---

## Programmatic Usage

```typescript
import { createModelScriptMcpServer, PolyglotMcpHost, type ServerContext } from "@modelscript/mcp";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const ctx: ServerContext = { current: null };
const server = createModelScriptMcpServer(ctx, { name: "modelscript", version: "0.1.0" });
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
