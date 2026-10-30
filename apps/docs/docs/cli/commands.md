# CLI Commands Reference

This reference documents every command, subcommand, and flag registered in `@modelscript/cli` (`apps/cli/src/main.ts` and `apps/cli/src/commands/`). All commands can be invoked via `modelscript` or its shorthand alias `msx`, and any command can be accelerated with the global `--daemon` flag.

---

## Compilation, Simulation & Optimization

### `compile` / `flatten`

Compiles and flattens a hierarchical Modelica class into a canonical Differential-Algebraic Equation (DAE) representation in linear WebAssembly memory (`DAEBuilder`). `flatten` is an exact alias for `compile`.

<CliCommand name="compile" />

```bash
# Flatten a model using the hybrid WASM kernel with timing breakdowns
msx flatten Modelica.Electrical.Analog.Examples.ChuaCircuit -L ./libraries --timing
```

---

### `instantiate`

Instantiates a Modelica class via the Salsa `QueryEngine` and prints the resolved component hierarchy, inherited modifications, and bindings prior to DAE index reduction.

<CliCommand name="instantiate" />

---

### `simulate`

Compiles a model, performs Block Lower Triangular (BLT) Pantelides index reduction and tearing, and executes a numerical time-domain or steady-state simulation locally or on a remote Slurm HPC cluster.

<CliCommand name="simulate" />

```bash
# Run a stiff DAE simulation using the 4th-order Rosenbrock solver and sparse symbolic Jacobians
msx simulate RLC_Circuit circuit.mo --stop-time 10.0 --solver rodas4p --engine arena --jacobian sparse --format csv > trajectory.csv

# Dispatch a heavy multi-domain simulation to the Cloud HPC cluster
msx simulate ThermalGrid plant.mo --cloud --profile high-cpu --stop-time 3600 --output-dir ./runs/thermal
```

---

### `optimize`

Formulates and solves a nonlinear Dynamic Optimization / Optimal Control Problem (OCP) over a flattened DAE using direct collocation and sequential quadratic programming (SQP).

<CliCommand name="optimize" />

```bash
msx optimize EV_BatteryPack vehicle.mo \
  --objective energyLoss \
  --controls currentCommand \
  --control-bounds "currentCommand:-200:200" \
  --stop-time 600 \
  --num-intervals 100 \
  --format json > optimal_profile.json
```

---

### `grad`

Computes forward, adjoint, or central finite-difference parameter sensitivities ($\nabla_{\mathbf{p}} J$) of scalar objective metrics with respect to model parameters.

<CliCommand name="grad" />

---

### `surrogate`

Executes a Design of Experiments (DoE) campaign over a physics model, trains a Reduced-Order Model (ROM) surrogate, attaches convex-hull/bounding-box extrapolation guardrails, and exports standalone C, ONNX, or Modelica `.mo` blocks.

<CliCommand name="surrogate" />

```bash
msx surrogate HeatExchanger thermal.mo \
  --inputs "massFlow,inletTemp" \
  --input-bounds "massFlow:0.1:5.0,inletTemp:280:380" \
  --outputs "outletTemp,pressureDrop" \
  --strategy sobol \
  --num-samples 128 \
  --architecture mlp \
  --format all \
  --out-file build/hx_rom
```

---

### `mc`

Runs high-throughput Monte Carlo uncertainty propagation across stochastic parameter distributions using worker threads and the linear-memory WASM evaluator.

<CliCommand name="mc" />

```bash
msx mc RLC_Filter filter.mo \
  --params "R:gaussian:100:5,C:uniform:1e-6:1.2e-6" \
  --runs 5000 \
  --lhs \
  --threads 8 \
  --seed 42 \
  --output mc_summary.json
```

---

### `csg`

Extracts Constructive Solid Geometry (CSG) primitives and kinematic frame transformations from a Modelica class, writes `build/csg/execution_graph.json`, and invokes the OpenCASCADE (`@modelscript/cad`) worker to generate 3D CAD meshes.

<CliCommand name="csg" />

---

## Linting, Formatting, Diffing & Compiler Inspection

### `lint`

Executes the static analysis pipeline (WASM GLR parse validation, CST lint rules, Salsa semantic queries, unit checking, and control-flow analysis) across one or more files or directories.

<CliCommand name="lint" />

```bash
# Lint an entire polyglot workspace and emit JSON for CI processing
msx lint ./models ./requirements --format json
```

---

### `parse`

Parses a file using its registered native WebAssembly GLR parser (`parser.wasm`) and prints the concrete syntax tree (CST), node byte offsets, or parse errors.

<CliCommand name="parse" />

---

### `format`

Formats source files canonically using the grammar's CST-preserving pretty-printer while preserving comments and annotations.

<CliCommand name="format" />

---

### `unparse`

Parses a source file into linear CST memory and unparses it back into text to verify lossless round-trip grammar rules.

<CliCommand name="unparse" />

---

### `diff`

Computes a structural CST/AST and semantic DAE comparison between two files (`oldFile` and `newFile`), identifying added/removed components, modified parameter bindings, and altered equations regardless of whitespace formatting.

<CliCommand name="diff" />

---

### `pr-diff`

Generates visual schematic/architectural diffs (highlighting added components in green, modified in amber, and deleted in red) and PR review summaries between two Git revisions.

<CliCommand name="pr-diff" />

---

### `i18n`

Extracts translatable descriptions, documentation strings, and identifier aliases from models (`extract`), compiles translation catalogs (`compile`), or translates a model into a target locale (`translate`).

<CliCommand name="i18n" />

---

## Formal Verification, Safety & Test Synthesis

### `verify`

Unified formal verification and simulation validation for SysML v2 and Modelica: decision tables, assume-guarantee contracts, state machines, and optional flowpipe reachability. Results can be emitted as terminal output or as JSON, CTRF, JUnit, SARIF, HTML, or DHF reports for CI/CD and compliance workflows.

<CliCommand name="verify" />

```bash
# Verify a controller and emit a GitHub Code Scanning SARIF report
msx verify BrakingController brake.mo --format sarif --report results.sarif
```

---

### `falsify`

Performs optimization-guided falsification of Signal Temporal Logic (STL) safety properties ($\square_{[a,b]} \phi$, $\lozenge_{[a,b]} \phi$, $\phi_1 \mathcal{U}_{[a,b]} \phi_2$) by searching disturbance and parameter spaces to minimize quantitative robustness $\rho(\phi, \mathbf{x}, t) < 0$.

<CliCommand name="falsify" />

---

### `export-formal`

Translates SysML v2 models into external formal verification formats: SMT-LIB2, nuXmv, and OCRA contract specifications.

<CliCommand name="export-formal" />

```bash
# Export a SysML v2 controller to a nuXmv model
msx export-formal acc.sysml --format nuxmv -o acc.smv
```

---

### `verify-decisions`

Evaluates Architectural Decision Records (ADRs) and SysML v2 trade-study constraints against flattened simulation parameters and formal bounds.

<CliCommand name="verify-decisions" />

---

### `decompose`

Performs structural subsystem partitioning and Assume-Guarantee ($A/G$) contract decomposition across large system models, checking whether top-level system guarantees follow compositionally from subsystem contracts ($\bigwedge_i (A_i \Rightarrow G_i) \vdash G_{\text{sys}}$).

<CliCommand name="decompose" />

---

### `generate-tests`

Synthesizes deterministic test vectors and stimulus harnesses from model guard conditions and assertions to achieve Modified Condition/Decision Coverage (MC/DC) and boundary-value coverage.

<CliCommand name="generate-tests" />

---

## Polyglot Digital Thread, Co-Simulation & Standards Interop

### `render`

Renders headless, publication-grade SVG diagrams for Modelica component icons/schematics, SysML v2 architectural views, and PSCAD Single-Line Diagrams (SLDs) using `@modelscript/diagram`.

<CliCommand name="render" />

```bash
# Render a SysML v2 Internal Block Diagram in blueprint theme
msx render SpacecraftPower spacecraft.sysml --view IBD --theme blueprint -o docs/ibd.svg
```

---

### `fmu`

Exports a Modelica class as a Functional Mock-up Unit (`.fmu` ZIP archive) compliant with **FMI 2.0** and/or **FMI 3.0** for Model Exchange (`me`) and Co-Simulation (`cs`), or imports/inspects an existing `.fmu` via `msx fmu import <file.fmu>`. `export-fmu` is an alias for `fmu`.

<CliCommand name="fmu" />

```bash
# Export an FMI 3.0 Co-Simulation FMU with embedded C sources and WebAssembly binary
msx fmu DC_Motor motor.mo --fmi-version 3 --type cs --wasm --output build/DC_Motor.fmu
```

---

### `import-fmu`

Unpacks an external FMI 2.0 or FMI 3.0 `.fmu` archive, parses its `modelDescription.xml`, and generates a strongly typed Modelica wrapper `block` (and optional SSP system binding) so the FMU can be connected and simulated inside ModelScript. `fmu-import` is an alias for `import-fmu`.

<CliCommand name="import-fmu" />

---

### `cosim`

Manages distributed FMI/SSP Co-Simulation master orchestration sessions, participant FMUs, recorded trajectory histories, and adaptive communication step-size optimization against the ModelScript Hub / Co-Simulation service.

<CliCommand name="cosim" :show-actions="false" />

| Subcommand     | Arguments     | Description                                                                                                         |
| :------------- | :------------ | :------------------------------------------------------------------------------------------------------------------ |
| `status`       | —             | Display health and active worker metrics of the Co-Simulation master orchestrator.                                  |
| `sessions`     | —             | List active and completed distributed Co-Simulation sessions.                                                       |
| `participants` | `<sessionId>` | List connected FMU/simulator participants, port couplings, and current simulation time $t$ in a session.            |
| `fmus`         | —             | List registered FMU artifacts available in the Co-Simulation repository.                                            |
| `upload`       | `<path.fmu>`  | Upload a local `.fmu` archive to the Co-Simulation registry.                                                        |
| `replay`       | `<sessionId>` | Deterministically replay a recorded Co-Simulation session from its saved input/coupling log.                        |
| `history`      | `<sessionId>` | Fetch step-by-step coupling residuals, rollbacks, and trajectory history for a session.                             |
| `optimize`     | `<sessionId>` | Run post-mortem Richardson extrapolation analysis on a session to recommend optimal communication step sizes $H_i$. |

---

### `pscad`

Provides full lifecycle tooling for Manitoba Hydro **PSCAD** electromagnetic transient (EMT) workspaces (`.pscx` cases and `.pswx` workspaces), including domain-specific electrical linting, Single-Line Diagram (SLD) generation, EMT simulation, **IEEE Std 2800-2022** grid interconnection verification, and conversion to Modelica/SSP.

<CliCommand name="pscad" :show-actions="false" />

| Action            | Description                                                                                                                                                                                                      |
| :---------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lint`            | Validate `.pscx`/`.pswx` schematics against electrical EMT rules (`M6001`–`M6011`, including floating nodes, transformer winding ratios, CSMF unconnected inputs, and traveling-wave line $\Delta t$ underflow). |
| `diagram`         | Render a publication-quality SVG Single-Line Diagram (SLD) from a `.pscx` project.                                                                                                                               |
| `diff`            | Compute a topological and parameter diff between two `.pscx` revisions.                                                                                                                                          |
| `sim`             | Execute a fixed-step nodal admittance ($\mathbf{G}\mathbf{v}(t) = \mathbf{i}_{\text{hist}}(t - \Delta t)$) EMT simulation.                                                                                       |
| `verify-ieee2800` | Run automated **IEEE Std 2800-2022** Inverter-Based Resource (IBR) compliance checks (Low/High Voltage Ride-Through LVRT/HVRT, frequency ride-through, and reactive current injection step response).            |
| `export-modelica` | Translate a `.pscx` schematic into an equivalent Modelica `.mo` model using `Modelica.Electrical`.                                                                                                               |
| `export-ssp`      | Package a `.pswx` multi-project workspace into an SSP 1.0 `.ssp` architecture container.                                                                                                                         |

```bash
# Verify IEEE 2800-2022 LVRT/HVRT compliance on a solar plant PSCAD case
msx pscad verify-ieee2800 SolarPlant_250MW.pscx --tstop 3.0 --step 20us -o ieee2800_report.json
```

---

### `polyglot`

Queries the unified multi-language `WorkspaceIndex`, verifies cross-domain traceability links (`@satisfies`, `@verifies`, `@allocates`), inspects digital threads, and monitors operational digital twin drift across all 12 supported languages.

<CliCommand name="polyglot" :show-actions="false" />

| Subcommand          | Description                                                                                                                                                                                 |
| :------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `project [dir]`     | Summarize all indexed languages, files, symbols, and cross-language bindings in a workspace.                                                                                                |
| `verify [dir]`      | Verify cross-language dimensional consistency, port types, requirement satisfaction, and digital thread integrity.                                                                          |
| `thread <symbol>`   | Trace the upstream/downstream polyglot digital thread for a symbol (from OWL2 ontology $\to$ SysML v2 requirement $\to$ Modelica equation $\to$ STEP CAD geometry $\to$ ReqIF/DHF dossier). |
| `query <expr>`      | Execute a cross-language symbol or FLWOR query against the unified `WorkspaceIndex`.                                                                                                        |
| `check-twins [dir]` | Compare live telemetry streams or CSV logs against nominal model predictions to detect parameter drift and anomalies.                                                                       |
| `index [dir]`       | Build and serialize the workspace-wide polyglot symbol and dependency index (`polyglot-index.json`).                                                                                        |

---

### `align`

Executes the Triple Graph Grammar (TGG) and Critical Pair Analysis (CPA) bidirectional synchronization engine across paired architectural, physical, and geometric models.

<CliCommand name="align" />

---

### `sysml`

Provides dedicated interoperability workflows between **OMG SysML v2** (`.sysml`) and **Modelica** (`.mo`) models.

<CliCommand name="sysml" :show-actions="false" />

| Subcommand                    | Description                                                                                                                      |
| :---------------------------- | :------------------------------------------------------------------------------------------------------------------------------- |
| `export <file.mo>`            | Project a Modelica class hierarchy into a SysML v2 `.sysml` `part def` / `port def` / `connection` architecture model.           |
| `import <file.sysml>`         | Synthesize executable Modelica `.mo` skeleton classes, connectors, and `connect()` equations from a SysML v2 file.               |
| `check <files...>`            | Validate SysML v2 $\leftrightarrow$ Modelica port compatibility, KerML quantity units, and `@satisfies` requirement constraints. |
| `info <file.sysml>`           | Print package metrics (part definitions, ports, state machines, requirements, and constraint blocks).                            |
| `sync <file.sysml> <file.mo>` | Synchronize structural changes and parameter values bi-directionally between `.sysml` and `.mo` files.                           |

---

### `oslc`

Exposes workspace models and requirements as **OASIS OSLC 3.0** Linked Data resources (Requirements Management `oslc_rm` and Architecture Management `oslc_am`) with **TRS 3.0** (Tracked Resource Set) changelog feeds for IBM DOORS Next, Polarion, and Jira integration.

<CliCommand name="oslc" :show-actions="false" />

| Subcommand      | Description                                                                                                    |
| :-------------- | :------------------------------------------------------------------------------------------------------------- |
| `export [path]` | Serialize workspace symbols, requirements, and traceability links as static OSLC 3.0 RDF documents.            |
| `serve [path]`  | Start an HTTP OSLC 3.0 Service Provider catalog, delegated UI preview server, and TRS 3.0 change log endpoint. |

---

### `reqif`

Imports and exports **OMG ReqIF 1.2** (Requirements Interchange Format `.reqif` XML and `.reqifz` archives), translating specification hierarchies and attributes directly to and from SysML v2 `requirement def` blocks.

<CliCommand name="reqif" />

---

### `ddp`

Inspects, packs, and converts **ISO/PAS 81346** Digital Data Packages (`.ddp`) and **IDTA Asset Administration Shell (AAS v3.0)** packages (`.aasx`) for industrial digital twin handover.

<CliCommand name="ddp" :show-actions="false" />

| Subcommand           | Description                                                                                                                                          |
| :------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inspect <file.ddp>` | Validate and list reference designations (`=`, `+`, `-` aspect trees), models, and documents inside a `.ddp` archive.                                |
| `pack <dir>`         | Bundle a workspace directory into a signed ISO/PAS 81346 `.ddp` archive.                                                                             |
| `to-aasx <file.ddp>` | Convert a `.ddp` package or workspace manifest into an IDTA AAS v3.0 `.aasx` Digital Twin package with TechnicalData and SimulationModels submodels. |

---

### `dhf`

Generates, inspects, and cryptographically audits **Design History File (DHF)** compliance dossiers structured for **FDA 21 CFR Part 820.30**, **ISO 13485**, **ISO 26262**, and **DO-178C** regulatory submissions.

<CliCommand name="dhf" :show-actions="false" />

| Subcommand      | Description                                                                                                                                         |
| :-------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------- |
| `export [path]` | Compile requirements traceability matrices (RTM), formal verification proofs, simulation summaries, and SHA-256 artifact hashes into a DHF dossier. |
| `status [path]` | Report requirement verification coverage, unverified hazards, and suspect links across the workspace.                                               |
| `audit [file]`  | Verify the cryptographic SHA-256 hash chain and Ed25519 signatures of an exported DHF bundle.                                                       |

---

### `simulink`

Inspects, lints, compiles into linear DAEs, and projects MATLAB Simulink control block diagrams (`.slx` zip packages and `.mdl` structured text).

<CliCommand name="simulink" :show-actions="false" />

| Action        | Description                                                                                                        |
| :------------ | :----------------------------------------------------------------------------------------------------------------- |
| `inspect`     | Dump subsystem block tree, parameters, solver settings, and line routing.                                          |
| `lint`        | Run pre-flight static analysis (algebraic loops `M7202`, unconnected ports `M7201`, divide-by-zero risks `M7209`). |
| `to-modelica` | Translate block diagram into standard acausal `Modelica.Blocks` models.                                            |
| `to-dae`      | Lower continuous states and transfer functions directly into the WebAssembly DAE arena.                            |

```bash
msx simulink inspect CruiseControl.slx
msx simulink lint EngineGovernor.mdl
msx simulink to-modelica Suspension.slx --out=Suspension.mo
```

---

### `autosar`

Inspects, lints, projects, and simulates AUTOSAR Classic and Adaptive (`.arxml`) software component architectures and Virtual Run-Time Environment (RTE) runnables.

<CliCommand name="autosar" :show-actions="false" />

| Action         | Description                                                                                                                           |
| :------------- | :------------------------------------------------------------------------------------------------------------------------------------ |
| `inspect`      | Inspect software component types, port prototypes, runnables, timing events, and network PDUs.                                        |
| `lint`         | Detect unconnected R-ports (`M7401`), interface mismatches (`M7402`), WCET budget overflows (`M7405`), and PDU bit overlap (`M7406`). |
| `to-modelica`  | Generate Modelica standard interface blocks for SIL plant co-simulation.                                                              |
| `to-sysml`     | Project software architecture into OMG SysML v2 `part def` hierarchies.                                                               |
| `to-dae`       | Lower software states and calibrated parameters into ModelScript linear-memory DAE arena.                                             |
| `simulate-rte` | Execute the discrete event Virtual RTE scheduler and route signals across assembly connectors.                                        |

```bash
msx autosar inspect Powertrain.arxml
msx autosar lint BrakeController.arxml
msx autosar to-sysml Steering.arxml --out=Steering.sysml
msx autosar simulate-rte PowertrainSystem.arxml --duration=0.5 --step=0.01 --out=rte_trace.json
```

---

### `olga`

Provides complete command-line tooling for Schlumberger **OLGA** transient multiphase flow models (`.opi`, `.key`, `.genkey`, `.tab`, `.tpl`, `.ppl`), including drift-flux hydrodynamic simulation, severe slugging analysis, PVT flash, autonomous history matching, and flow assurance verification.

<CliCommand name="olga" :show-actions="false" />

| Action        | Description                                                                                                                               |
| :------------ | :---------------------------------------------------------------------------------------------------------------------------------------- |
| `inspect`     | Dump flowpath pipe discretization, valve configurations, sources, and boundary conditions.                                                |
| `lint`        | Run pre-flight flow assurance checks (`M7001`–`M7013`: CFL violations, severe slugging, pig stuck hazards, wax/asphaltene precipitation). |
| `simulate`    | Execute transient 1D drift-flux simulation with Lagrangian slug tracking and scraper pig dynamics.                                        |
| `verify`      | Check formal regulatory limits (MAOP, hydrate subcooling margin, slug surge volume, erosion limits).                                      |
| `diagram`     | Render SVG schematics, seabed bathymetry elevation profiles, PVT envelopes, or slug statistics.                                           |
| `tune`        | Run automated history matching against field measurement CSV telemetry.                                                                   |
| `flash`       | Compute Peng-Robinson (PR) or Soave-Redlich-Kwong (SRK) thermodynamic vapor-liquid equilibrium (VLE) flash.                               |
| `network`     | Solve coupled gathering network transients across multiple branches and subsea manifolds.                                                 |
| `cosim`       | Run multi-rate SSP co-simulation coupling flowlines with topside process facilities.                                                      |
| `to-dae`      | Lower flowline equations into ModelScript DAE arena.                                                                                      |
| `to-modelica` | Translate pipe and boundary networks into `Modelica.Fluid` models.                                                                        |

```bash
msx olga simulate subsea_tieback.opi --duration=3600 --out=traj.csv
msx olga lint deepwater_riser.genkey
msx olga diagram tieback.opi --view=profile --out=profile.svg
msx olga flash --comp="C1:0.75,C2:0.10,C3:0.08,nC4:0.04,C7:0.03" --p=50 --t=295.15 --envelope
```

---

### `simpack`

Tooling for Dassault Systèmes **SIMPACK** multibody dynamics (`.spck` XML and `.sim` ASCII decks), including Grübler mobility analysis, 3D kinematic joint evaluation, Berg elastomeric bushings, and Craig-Bampton flexible body lowering.

<CliCommand name="simpack" :show-actions="false" />

| Action        | Description                                                                                      |
| :------------ | :----------------------------------------------------------------------------------------------- |
| `lint`        | Check for dangling marker references, kinematic loops, and parameter inconsistencies.            |
| `mobility`    | Calculate mechanism spatial degrees of freedom ($M = 6n - \sum c_i$) and detect overconstraints. |
| `to-modelica` | Project the mechanism into standard `Modelica.Mechanics.MultiBody` components.                   |
| `simulate`    | Lower the multibody model to a DAE and integrate it in time.                                     |
| `to-fmu`      | Package the multibody assembly as an FMI 2.0 Co-Simulation FMU.                                  |
| `report`      | Generate a homologation-style report for the model.                                              |

```bash
msx simpack lint DoubleWishbone.spck
msx simpack mobility Suspension.spck
msx simpack to-modelica Mechanism.sim --out=Mechanism.mo
```

---

### `gensys`

Tooling for **GENSYS** railway vehicle dynamics (`.calc`, `.geom`, `.track`), including FASTSIM wheel-rail contact mechanics, Polach non-linear creep, ERRI B176 track irregularities, Sperling ride comfort, and **EN 14363 / UIC 518** running safety homologation.

<CliCommand name="gensys" :show-actions="false" />

| Action        | Description                                                                                                                       |
| :------------ | :-------------------------------------------------------------------------------------------------------------------------------- |
| `lint`        | Validate vehicle inertial and geometric parameters against railway engineering rules.                                             |
| `to-modelica` | Project the vehicle model into Modelica.                                                                                          |
| `verify`      | Evaluate EN 14363 derailment quotient ($Y/Q \le 0.80$) and Prud'homme lateral limit from `--y-force`, `--q-force`, `--axle-load`. |
| `simulate`    | Lower the vehicle model to a DAE and integrate it in time.                                                                        |
| `to-fmu`      | Package the vehicle model as an FMI Co-Simulation FMU.                                                                            |
| `report`      | Write an EN 14363 homologation report (`--format html \| sarif \| junit \| ctrf`).                                                |

```bash
msx gensys lint ManchesterBenchmark.calc
msx gensys verify --y-force 40 --q-force 80 --axle-load 160
msx gensys report ManchesterBenchmark.calc --format html --out homologation.html
```

---

### `spice`

Analog circuit simulation and netlist analysis for **SPICE** (`.cir`, `.sp`, `.net`, `.lib`), including DC operating point, transient, and AC analyses (AC sweep parameters come from the netlist `.AC` directive), and ECAD graph generation.

<CliCommand name="spice" />

```bash
msx spice simulate LowPassFilter.cir --analysis op
msx spice simulate PowerSupply.cir --analysis tran --tstep 1e-6 --tstop 0.02 --out transient.csv
msx spice simulate AudioAmplifier.sp --analysis ac --format csv --out bode.csv
```

---

### `adams`

Tooling for **MSC Adams** mechanism datasets (`.adm`) and command files (`.cmd`), including 3D Euler/Cardan kinematics, Grübler spatial mobility analysis, and cross-domain SIMPACK / Modelica projections.

<CliCommand name="adams" :show-actions="false" />

| Action        | Description                                                                                           |
| :------------ | :---------------------------------------------------------------------------------------------------- |
| `lint`        | Check the dataset for dangling references and parameter inconsistencies.                              |
| `mobility`    | Calculate mechanism degrees of freedom and detect overconstraints.                                    |
| `to-modelica` | Project the mechanism into `Modelica.Mechanics.MultiBody` components.                                 |
| `to-simpack`  | Convert the Adams dataset into SIMPACK `.spck` XML.                                                   |
| `simulate`    | Lower to a DAE (Baumgarte or algebraic stabilization via `--stabilization`) and integrate it in time. |

```bash
msx adams mobility FourBarLinkage.adm
msx adams lint LandingGear.adm
msx adams to-simpack RobotArm.adm --out=RobotArm.spck
```

---

### `urdf`

Robotics compiler tooling for **ROS URDF** (`.urdf`) and **Xacro** (`.xacro`) descriptions, featuring Featherstone recursive dynamics (ABA forward dynamics, RNEA inverse dynamics), joint limit verification, and 3D CAD projections.

<CliCommand name="urdf" :show-actions="false" />

| Action        | Description                                                                                          |
| :------------ | :--------------------------------------------------------------------------------------------------- |
| `lint`        | Validate kinematic tree acyclicity (`M7504`), joint limits (`M7508`), and inertia tensors (`M7506`). |
| `rnea`        | Evaluate inverse dynamics (RNEA) at test joint coordinates.                                          |
| `to-modelica` | Generate a `Modelica.Mechanics.MultiBody` robotic system.                                            |
| `to-simpack`  | Project the robot description into SIMPACK `.spck` XML.                                              |
| `to-adams`    | Project the robot description into an MSC Adams `.adm` dataset.                                      |
| `to-dae`      | Lower kinematic state equations directly into the `DAEBuilder` arena.                                |

```bash
msx urdf rnea KukaIiwa14.urdf
msx urdf lint Manipulator.xacro
msx urdf to-modelica PandaArm.urdf --out=PandaArm.mo
```

---

### `easy5`

Tooling for Boeing / MSC **EASY5** dynamic models (`.ez5`, `.ezm`, `.ezd`), including linear state-space analysis, User General (UG) Fortran routines, tabular map interpolation, and Modelica/SSP projections.

<CliCommand name="easy5" :show-actions="false" />

| Action        | Description                                                           |
| :------------ | :-------------------------------------------------------------------- |
| `inspect`     | Dump component blocks, connection topology, and parameter tables.     |
| `lint`        | Check for dangling connections, missing table files, and rate limits. |
| `to-modelica` | Project continuous block diagram to Modelica 3.x.                     |
| `to-ssp`      | Package model as an FMI SystemStructure.ssd container.                |
| `to-dae`      | Lower continuous and discrete equations into `DAEBuilder` arena.      |

---

### `gtsuite`

Tooling for Gamma Technologies **GT-SUITE** powertrain and engine models (`.gtm`, `.gtd`), including crank-slider kinematics, Wiebe combustion, Woschni heat transfer, Zeldovich NOx emissions, and DAE lowering.

<CliCommand name="gtsuite" :show-actions="false" />

| Action        | Description                                                                                      |
| :------------ | :----------------------------------------------------------------------------------------------- |
| `inspect`     | Inspect engine cylinders, intake/exhaust manifolds, valves, and turbochargers.                   |
| `lint`        | Detect compressor surge (`M9002`), invalid compression ratio (`M9005`), and acoustic CFL limits. |
| `simulate`    | Execute in-WASM Mean-Value Engine Model (MVEM) transient simulation.                             |
| `to-modelica` | Project 1D powertrain architecture to Modelica standard blocks.                                  |
| `to-dae`      | Lower engine thermodynamics and flow dynamics into `DAEBuilder` arena.                           |

---

### `sima`

Tooling for DNV / SINTEF **SIMA** marine systems (`.inp`, `.sima`, `.sys`, `.hyd`), including Cummins equation 6-DOF floater dynamics, catenary mooring solvers, and DNV-OS-E301 station-keeping verification.

<CliCommand name="sima" :show-actions="false" />

| Action        | Description                                                                                  |
| :------------ | :------------------------------------------------------------------------------------------- |
| `inspect`     | Inspect marine vessels, mooring lines, catenary segments, and environmental loads.           |
| `lint`        | Check negative metacentric height (`M7001`), line underflow (`M7002`), and attachment nodes. |
| `summary`     | Print a model summary: vessels, lines, and environment.                                      |
| `verify`      | Verify DNV-OS-E301 / DNV-ST-0119 line tension safety factors.                                |
| `offset`      | Report vessel watch-circle and offset limits.                                                |
| `to-modelica` | Project marine system into acausal Modelica physical components.                             |
| `to-ssp`      | Export an SSP `SystemStructure.ssd`.                                                         |
| `to-sysml2`   | Export a SysML v2 model.                                                                     |
| `to-dae`      | Lower hydrodynamics and mooring tension equations into `DAEBuilder` arena.                   |

---

### `rocets`

Tooling for NASA **ROCETS** liquid rocket engine transient decks (`.roc`, `.deck`, `.map`), including turbopump flow balance, CEA equilibrium combustion, supersonic nozzle expansion, and Bartz throat heat transfer.

<CliCommand name="rocets" :show-actions="false" />

| Action        | Description                                                                                          |
| :------------ | :--------------------------------------------------------------------------------------------------- |
| `inspect`     | Inspect turbopumps, combustion chambers, regenerative cooling channels, and valves.                  |
| `lint`        | Detect extreme mixture ratios (`M8011`), turbine overspeed (`M8013`), and negative chamber pressure. |
| `simulate`    | Solve steady-state flow balance or transient rocket engine ignition start sequence.                  |
| `to-modelica` | Project cryogenic fluid networks and turbomachinery into Modelica 3.x.                               |
| `to-dae`      | Lower propulsion governing equations into `DAEBuilder` arena.                                        |

---

### `psse`

Tooling for Siemens **PSS/E** power transmission cases (`.raw`, `.dyr`, `.sav`), including bus/branch netlist extraction, Full-Newton AC power flow solving, and Modelica / PSCAD EMT projections.

<CliCommand name="psse" :show-actions="false" />

| Action        | Description                                                                                |
| :------------ | :----------------------------------------------------------------------------------------- |
| `inspect`     | Dump bus count, generators, transmission lines, transformers, and load summary.            |
| `lint`        | Validate bus voltage bounds, check for isolated buses, and verify generator $P/Q$ limits.  |
| `solve`       | Solve steady-state AC power flow on the nodal admittance matrix $\mathbf{Y}_{\text{bus}}$. |
| `summary`     | Print a base-case summary.                                                                 |
| `diagram`     | Export a single-line diagram as SVG.                                                       |
| `netlist`     | Extract the bus/branch netlist.                                                            |
| `to-modelica` | Project power grid into acausal Modelica transmission lines and generators.                |
| `to-dae`      | Lower bus injection equations and generator swing dynamics into `DAEBuilder` arena.        |

---

### `lps`

Tooling for Energy Solutions **PipelineStudio** gas and liquid pipeline networks (`.lps`, `.tgx`, `.tlx`, `.psg`), including AGA-8 / GERG-2008 natural gas compressibility, hydrogen blending ($H_2 \le 20\%$), open-channel slack line flow, water hammer liquid surge, and transient line pack accounting.

<CliCommand name="lps" :show-actions="false" />

| Action        | Description                                                                                        |
| :------------ | :------------------------------------------------------------------------------------------------- |
| `inspect`     | Dump pipeline pipes, compressors, pumps, delivery regulators, and receipt nodes.                   |
| `lint`        | Check for MAOP overpressure (`M8001`), compressor surge (`M8002`), and high hydrogen blend ratios. |
| `simulate`    | Run transient fluid network pressure propagation and inventory line pack calculations.             |
| `solve`       | Solve the steady-state network.                                                                    |
| `linepack`    | Compute pipeline inventory (line pack).                                                            |
| `sysml`       | Project pipeline topology and control station hierarchies into OMG SysML v2.                       |
| `verify`      | Run design and safety verification on the steady-state solution.                                   |
| `to-modelica` | Project pipe network into `Modelica.Fluid` gas/liquid transmission models.                         |
| `to-dae`      | Lower Euler gas/liquid equations directly into `DAEBuilder` arena.                                 |

---

## Language Workbench, Daemon & IDE Tooling

### `daemon`

Controls the lifecycle of the persistent background ModelScript compiler daemon (`~/.modelscript/daemon.sock`).

<CliCommand name="daemon" :show-actions="false" />

| Subcommand | Description                                                                        |
| :--------- | :--------------------------------------------------------------------------------- |
| `start`    | Spawn the background compiler daemon if not already running.                       |
| `stop`     | Gracefully shut down the running daemon and remove its socket file.                |
| `status`   | Report whether the daemon is running, its PID, uptime, and cached workspace count. |
| `restart`  | Stop any active daemon instance and immediately start a fresh one.                 |

---

### `build`

Compiles a `@modelscript/dsl` grammar definition into a zero-dependency native WebAssembly GLR parser (`parser.wasm`) along with strongly typed TypeScript CST node definitions.

<CliCommand name="build" />

---

### `generate`

Scaffolds a new WebAssembly GLR parser (`parser`) or a complete standalone VS Code language extension (`extension` including TextMate grammars, LSP wiring, and `package.json` contributions) from a `@modelscript/dsl` language definition.

<CliCommand name="generate" />

---

### `language`

Manages the dynamic polyglot language registry (`lang` is an alias for `language`).

<CliCommand name="language" :show-actions="false" />

| Subcommand        | Description                                                                                                                                                               |
| :---------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `list`            | List all registered languages (`.mo`, `.sysml`, `.msx`, `.pscx`, `.scad`, `.stp`, `.owl`, `.ssp`, `.csv`, `.su2`, `.inp`, `.gbr`) and their loaded `.wasm` parser states. |
| `register <path>` | Dynamically register a custom language plugin module into `~/.modelscript/languages.json`.                                                                                |
| `unregister <id>` | Remove a dynamically registered language plugin by language ID.                                                                                                           |

---

### `lsp`

Starts the multi-language ModelScript Language Server Protocol (`@modelscript/lsp`) server.

<CliCommand name="lsp" />

---

### `playground`

Launches a local interactive web playground server for live grammar authoring, GLR parse tree visualization, Salsa query inspection, and DAE simulation.

<CliCommand name="playground" />

---

### `sandbox`

Executes untrusted `.msx` scripts or `.mo` simulations inside a memory-capped, capability-isolated WebAssembly sandbox with no host filesystem or network access.

<CliCommand name="sandbox" />

---

## Package Registry, Cloud HPC & Hub Administration

### `init`

Initializes a new `modelscript.json` package manifest in the current directory.

<CliCommand name="init" />

---

### `login`, `logout`, `whoami`

Manages authentication sessions against the Ansatz Package Registry or self-hosted Ansatz / ModelScript hub node. Credentials and signing keys are stored in `~/.ansatzrc` (or `~/.modelscriptrc`).

<CliCommand name="login" />

<CliCommand name="logout" />

<CliCommand name="whoami" />

---

### `install`

Resolves semantic version constraints, verifies SHA-256 content-addressable digests and Ed25519 publisher signatures, and installs Modelica/SysML/ModelScript packages into `modelica_modules/` while updating `msx.lock`.

<CliCommand name="install" />

---

### `pack`, `publish`, `unpublish`

Packages, cryptographically signs, and publishes libraries to the Ansatz Package Registry.

<CliCommand name="pack" />

<CliCommand name="publish" />

<CliCommand name="unpublish" />

---

### `cloud`

Manages remote high-performance computing (HPC) simulation sweeps, Slurm batch jobs, and organization compute credit wallets on Ansatz Cloud HPC.

<CliCommand name="cloud" :show-actions="false" />

| Subcommand           | Arguments           | Description                                                                                                                 |
| :------------------- | :------------------ | :-------------------------------------------------------------------------------------------------------------------------- |
| `profiles`           | —                   | List available CPU/GPU hardware execution profiles (`standard`, `high-cpu`, `gpu-a100`, `slurm-mpi`) and credit burn rates. |
| `balance` / `wallet` | —                   | Display current organization compute credit balance, active reservations, and ledger history.                               |
| `jobs` / `list`      | —                   | List recent and running cloud simulation jobs.                                                                              |
| `status`             | `<jobId>`           | Query real-time queue state (`QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`) and progress percentage for a job.                 |
| `logs`               | `<jobId>`           | Stream stdout/stderr compiler and solver logs from a cloud worker.                                                          |
| `cancel`             | `<jobId>`           | Terminate a queued or running cloud job and refund unused reserved credits.                                                 |
| `download`           | `<jobId> [outDir]`  | Download completed trajectory CSV/Parquet artifacts and diagnostic reports.                                                 |
| `dispatch`           | `<name> <paths...>` | Directly submit a containerized simulation or DoE sweep job to the cloud queue.                                             |

---

### `hub`, `db`, `archive`

Administrative CLI commands for operators managing a self-hosted **ModelScript Enterprise Hub** instance (see [Platform Administration Guide](../guide/administration.md)).

<CliCommand name="hub" />

<CliCommand name="db" />

<CliCommand name="archive" />

```bash
# Initialize Hub configuration or query cluster service health
msx hub <init|status> [--api-url <url>]

# Inspect database migration state, plan schema upgrades, or verify relational and physical integrity (online or offline air-gapped)
msx db <status|upgrade|rollback|plan|verify> [--db <file.sqlite>] [--dry-run] [--skip-backup]

# Request, poll, or download long-term regulatory cold-storage archives
msx archive <request|status|download> <targetId> [-o <path>]
```
