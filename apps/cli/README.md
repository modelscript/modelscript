<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/cli

Unified command-line interface (`modelscript`, alias `msx`) for ModelScript. Provides **89 commands** across compilation, DAE flattening, numerical simulation, optimal control, formal verification, enterprise digital thread coexistence, 3D CAD/CAE extraction, package management, and domain-specific engineering solvers across all **44 supported languages and simulation formats**.

---

## Installation & Usage

After building the monorepo, the CLI is available locally or via `npx` under `modelscript` or the primary shorthand `msx`:

```bash
# Check version and global options
npx msx --help
# or
npx modelscript --help

# Run with background compiler daemon for instant response
npx msx --daemon <command>
```

---

## Command Reference (89 Commands)

### 1. Core Modeling, Flattening, Simulation & Optimization

| Command                             | Description                                                                                    |
| :---------------------------------- | :--------------------------------------------------------------------------------------------- |
| `msx compile <name> <paths...>`     | Flatten a Modelica or ModelScript model into a flat DAE arena (alias: `msx flatten`)           |
| `msx simulate <name> <paths...>`    | Numerically simulate a model and output CSV or JSON trajectories                               |
| `msx simulate-cloud <name> <paths>` | Offload large-scale simulation or parameter sweeps to the ModelScript Cloud HPC cluster        |
| `msx sim-c-codegen <name> <paths>`  | Generate standalone, zero-dependency ANSI C99 simulation code from a flattened DAE arena       |
| `msx instantiate <name> <paths...>` | Instantiate and query the hierarchical AST structure of a Modelica model                       |
| `msx fmu <name> <paths...>`         | Export a model as a standalone FMI 2.0/3.0 FMU archive in C99, WASM, or JS (`export-fmu`)      |
| `msx import-fmu <fmu>`              | Import an external FMU archive and synthesize a strongly typed Modelica wrapper (`fmu-import`) |
| `msx cosim`                         | Manage multi-FMU co-simulation sessions, HIL participants, and signal replay                   |
| `msx optimize <name> <paths...>`    | Solve optimal control problems via direct collocation with state/control boundary constraints  |
| `msx grad <name> <paths...>`        | Compute exact parameter sensitivities through simulation using hybrid continuous adjoints      |
| `msx mc <name> <paths...>`          | Run Monte Carlo & Sobol sensitivity simulations for parametric uncertainty quantification      |
| `msx surrogate <name> [paths...]`   | Train or import an AI surrogate Reduced Order Model (ROM) and emit ONNX, C99, or Modelica code |
| `msx csg <name> <paths...>`         | Evaluate Constructive Solid Geometry (CSG) topologies to STEP B-Rep or 3D meshes               |

### 2. Domain-Specific Engineering Solvers & Toolkits (35 Domain Commands)

#### Power Systems, RF & Electronics

| Command                              | Description                                                                                            |
| :----------------------------------- | :----------------------------------------------------------------------------------------------------- |
| `msx pscad <action> [files...]`      | Inspect, lint (`M6001`–`M6017`), simulate EMT, verify IEEE 2800-2022, and export PSCAD (`.pscx`)       |
| `msx psse <action> [files...]`       | Inspect, lint (`P1001`–`P4001`), solve AC power flow, and render SLDs for Siemens PTI PSS/E (`.raw`)   |
| `msx opendss <action> [files...]`    | Parse, lint (`M8401`–`M8408`), solve unbalanced multi-phase power flow, and project OpenDSS (`.dss`)   |
| `msx spice <action> [files...]`      | Parse, lint (`M7101`–`M7106`), lower MNA equations, and project Berkeley/LTspice netlists (`.cir`)     |
| `msx verilog-a <action> [files...]`  | Parse, lint (`M7601`–`M7607`), lower analog behavioral modules, and project Verilog-A (`.va`/`.vams`)  |
| `msx ibis <action> [files...]`       | Parse, lint (`8303`–`8322`), evaluate I/V buffer curves, and lower ANSI/EIA-656-B IBIS models (`.ibs`) |
| `msx touchstone <action> [files...]` | Parse N-port S-parameters (`.s*p`/`.ts2`), verify passivity, run Vector Fitting, and lower to DAE      |

#### Fluid, Process, Subsurface, Civil Water & Nuclear Thermal-Hydraulics

| Command                              | Description                                                                                             |
| :----------------------------------- | :------------------------------------------------------------------------------------------------------ |
| `msx olga <action> [files...]`       | Parse, lint (`M7001`–`M7013`), simulate 1D multiphase drift-flux, tune, and verify OLGA (`.opi`)        |
| `msx lps <action> [files...]`        | Solve steady-state hydraulics and dynamic gas/liquid Euler surge transients for PipelineStudio (`.lps`) |
| `msx aspen <action> [files...]`      | Parse flowsheets, run Rachford-Rice VLE flash, lint (`M8101`–`M8115`), and project Aspen Plus (`.inp`)  |
| `msx eclipse <action> [files...]`    | Parse black-oil reservoir decks (`.data`), lint (`M8701`–`M8710`), and solve Darcy/Peaceman depletion   |
| `msx epanet <action> [files...]`     | Parse water networks (`.inp`), lint (`M8101`–`M8108`), and solve Todini GGM pressurized hydraulics      |
| `msx swmm <action> [files...]`       | Parse urban drainage models (`.inp`), lint (`M8201`–`M8213`), and route Manning open-channel flows      |
| `msx relap5 <action> [files...]`     | Parse nuclear thermal-hydraulics decks (`.i`/`.r5`), lint (`M8601`–`M8610`), and solve point kinetics   |
| `msx energyplus <action> [files...]` | Parse building energy models (`.idf`/`.epjson`), lint (`M7901`–`M7908`), and lower RC thermal networks  |

#### Multibody, Automotive, Robotics, Marine & Rail

| Command                                | Description                                                                                                 |
| :------------------------------------- | :---------------------------------------------------------------------------------------------------------- |
| `msx adams <action> [files...]`        | Parse `.adm`/`.cmd` multibody decks, analyze Grübler-Kutzbach mobility, lint (`M7301`–`M7310`), and lower   |
| `msx simpack <action> [files...]`      | Parse `.spck`/`.sim`/`.fbi`, run WASM spatial kinematics & mobility (`K7001`–`K7006`), and project          |
| `msx gensys <action> [files...]`       | Parse `.calc`/`.run`, run WASM FASTSIM/Polach creep, verify EN 14363 homologation, and render diagrams      |
| `msx gtsuite <action> [files...]`      | Parse, lint, and simulate GT-SUITE 1D powertrain and engine combustion models (`.gtm`, `.gtx`)              |
| `msx sima <action> [files...]`         | Inspect, solve catenary mooring lines, and verify DNV-OS-E301 safety factors for SIMA (`.sima`)             |
| `msx urdf <action> [files...]`         | Parse ROS 2 URDF / Gazebo SDF (`.urdf`/`.sdf`), validate inertia tensors (`M7501`–`M7508`), and project     |
| `msx opendrive <action> [files...]`    | Parse ASAM OpenDRIVE road networks (`.xodr`), verify $C^1$ clothoid continuity (`M7701`–`M7706`), and lower |
| `msx openscenario <action> [files...]` | Parse ASAM OpenSCENARIO (`.xosc`/`.osc`), lint (`M8501`–`M8510`), and verify TTC / IEEE 2846 RSS safety     |
| `msx autosar <action> [files...]`      | Parse AUTOSAR `.arxml`, validate SWC ports, runnable WCET & PDU bit-packing (`M7401`–`M7410`), and export   |

#### Aerospace, Flight Dynamics, Continuum CAE, Biology & Scientific Code

| Command                            | Description                                                                                             |
| :--------------------------------- | :------------------------------------------------------------------------------------------------------ |
| `msx simulink <action> [files...]` | Parse MATLAB Simulink `.slx`/`.mdl`, lint control loops (`M7201`–`M7210`), and project to Modelica      |
| `msx easy5 <action> [files...]`    | Parse Boeing/MSC EASY5 (`.ez5`), extract state-space Jacobians ($A,B,C,D$), and analyze Bode response   |
| `msx jsbsim <action> [files...]`   | Parse JSBSim 6-DOF flight dynamics XML, lint (`M8901`–`M8910`), simulate trajectories, and project      |
| `msx rocets <action> [files...]`   | Parse NASA ROCETS decks (`.roc`), balance turbomachinery power cycles, and simulate propulsion          |
| `msx ccsds <action> [files...]`    | Parse CCSDS OEM/OPM/OMM & XTCE telemetry, propagate 6-DOF $J_2$ orbits, and lint (`M8201`–`M8208`)      |
| `msx plcopen <action> [files...]`  | Parse IEC 61131-3 `.st` / `.plcxml`, lint scan-cycle logic (`M7801`–`M7806`), and lower clocked DAEs    |
| `msx fea <action> [files...]`      | Parse CalculiX/Nastran `.inp`/`.bdf`/`.fea`, lint mesh/BCs (`M7401`–`M7408`), and run 3D Tet4/Tet10 FEA |
| `msx cfd <action> [files...]`      | Parse SU2/OpenFOAM `.cfg`/`.su2`/`.foam`, lint CFL/$y^+$ (`M7301`–`M7308`), and run aerodynamic solvers |
| `msx sbml <action> [files...]`     | Parse Systems Biology Markup Language (`.sbml`), lint stoichiometry (`M8801`–`M8810`), and solve ODEs   |
| `msx c <action> [files...]`        | Parse ISO C99 control code (`.c`/`.h`), build SSA CFGs, lint safety rules, and lower to DAE arena       |

### 3. Formal Verification & Automated Testing

| Command                           | Description                                                                                                  |
| :-------------------------------- | :----------------------------------------------------------------------------------------------------------- |
| `msx verify [target] [paths...]`  | Unified formal verification and simulation validation across SysML v2, Modelica, and CAD                     |
| `msx falsify`                     | Run adversarial multi-domain requirement falsification across SysML v2, Modelica, and CAD                    |
| `msx verify-decisions <paths...>` | Formally verify SysML v2 decision tables, decide nodes, and state guards for exhaustiveness and disjointness |
| `msx decompose <paths...>`        | Perform symbolic state-space region decomposition over SysML v2 decision conditions                          |
| `msx generate-tests <paths...>`   | Synthesize formal boundary-condition and 100% MC/DC test suites from SysML v2 models                         |
| `msx export-formal <paths...>`    | Export SysML v2 models to standard formal verification formats (SMT-LIB2, nuXmv, OCRA)                       |

### 4. Linting, Formatting, Diffing, Merging & Rendering

| Command                            | Description                                                                          |
| :--------------------------------- | :----------------------------------------------------------------------------------- |
| `msx lint <path> [paths...]`       | Lint polyglot models and libraries using `QueryEngine` and linear CST analysis rules |
| `msx format <files...>`            | Format source files using their language DSL formatter or surgical CST unparser      |
| `msx unparse <file>`               | Unparse and re-synthesize clean, canonical source code from the language CST         |
| `msx diff <file1> <file2>`         | Compute an AST-aware semantic diff between two model files (any registered DSL)      |
| `msx merge <base> <ours> <theirs>` | Perform 3-way semantic AST merge across polyglot engineering models                  |
| `msx pr-diff [file]`               | Compute visual and semantic pull request diff across Git revisions (SysML, Modelica) |
| `msx render <name> <paths...>`     | Render a Modelica or polyglot class diagram or icon to standalone SVG                |
| `msx i18n <paths...>`              | Extract internationalization (`.pot`) translation templates from Modelica models     |

### 5. Digital Thread, Enterprise Coexistence & Compliance

| Command                       | Description                                                                                          |
| :---------------------------- | :--------------------------------------------------------------------------------------------------- |
| `msx polyglot <action>`       | Multi-domain Triple Graph Grammar (TGG) projection, formal verification, and digital thread tracking |
| `msx align <source> <target>` | Fuzzy-align and correlate brownfield engineering assets (STEP CAD, Modelica, SysML v2, ReqIF)        |
| `msx sysml <action>`          | OMG SysML v2 engineering toolkit: standard interchange (`.sysmlx`), validation, and container export |
| `msx oslc <action>`           | OSLC Core 3.0 enterprise coexistence gateway for Teamcenter, Windchill, and DOORS                    |
| `msx reqif <action>`          | Lossless OMG ReqIF 1.2 requirements interchange with DOORS, Polarion, and Teamcenter                 |
| `msx ddp <action>`            | Digital Data Package (prostep ivip PSI 21 / OMG CASCaRA) packaging, inspection, and AASX bridging    |
| `msx dhf <action> [paths...]` | Design History File (FDA 21 CFR 820.30 / ISO 14971 / IEC 62304) regulatory compliance exporter       |

### 6. Language Engineering & DSL Workbench

| Command                              | Description                                                                           |
| :----------------------------------- | :------------------------------------------------------------------------------------ |
| `msx daemon <action>`                | Manage the background compiler daemon for instant compilation                         |
| `msx build [entry]`                  | Compile generated parser AssemblyScript into WASM and native platform binaries        |
| `msx generate [target] [entries...]` | Generate parser tables or a full VS Code extension from DSL language specifications   |
| `msx parse <file>`                   | Parse a file using its language DSL parser (supports any of the 44 languages)         |
| `msx language <action> [target]`     | Manage registered language DSLs (`list`, `register`, `unregister`; alias: `msx lang`) |
| `msx lsp`                            | Start the ModelScript polyglot Language Server over stdio for editor integration      |
| `msx playground`                     | Launch the interactive dual-editor DSL grammar workbench                              |
| `msx sandbox [entries...]`           | Start a VS Code Web sandbox with an on-the-fly compiled multi-language extension      |

### 7. Cloud HPC, Registry, Hub & Database Operations

| Command                          | Description                                                                            |
| :------------------------------- | :------------------------------------------------------------------------------------- |
| `msx cloud <action> [target]`    | Manage cloud HPC jobs, compute profiles, credit wallet, and live telemetry             |
| `msx init [path]`                | Initialize a `package.json` manifest for a ModelScript, Modelica, or SysML project     |
| `msx login` / `msx logout`       | Authenticate with or log out from the ModelScript Registry                             |
| `msx token <action>`             | Create, list, and revoke scoped personal/CI authentication tokens                      |
| `msx whoami`                     | Display information about the currently authenticated registry user                    |
| `msx install [package]`          | Install a package from the ModelScript Registry into the local workspace               |
| `msx publish <path>`             | Publish a library directory or model file to the ModelScript Registry                  |
| `msx pack [path]`                | Create an offline distribution `.zip` archive from a package                           |
| `msx unpublish [path]`           | Remove a published library version from the ModelScript Registry                       |
| `msx hub <command>`              | Manage, configure, and inspect federated ModelScript hub nodes                         |
| `msx db <action>`                | Database schema migration, health verification, and pre-flight snapshot management     |
| `msx archive [action] [users..]` | GDPR Art. 20 / CCPA data archive export with async worker queue and concurrency limits |

---

## Examples

```bash
# 1. Verify cross-domain requirements on the drone-reachability workspace
npx msx verify packages/examples/drone-reachability/modelica/DroneSimulation.mo \
  --sysml packages/examples/drone-reachability/sysml/drone_specs.sysml

# 2. Flatten and simulate a Modelica model with JSON output
npx msx compile DroneSimulation packages/examples/drone-reachability/modelica/DroneSimulation.mo
npx msx simulate DroneSimulation packages/examples/drone-reachability/modelica/DroneSimulation.mo \
  --format json --start-time 0 --stop-time 10

# 3. Export as an FMI 3.0 FMU
npx msx fmu DroneSimulation packages/examples/drone-reachability/modelica/DroneSimulation.mo \
  --fmi-version 3 --output DroneSimulation.fmu

# 4. Lint, simulate, and verify IEEE 2800-2022 grid compliance on a PSCAD microgrid
npx msx pscad lint packages/examples/pscad-microgrid/Microgrid_IBR.pscx
npx msx pscad sim packages/examples/pscad-microgrid/Microgrid_IBR.pscx --step=20us --tstop=0.25
npx msx pscad verify-ieee2800 packages/examples/pscad-microgrid/Microgrid_IBR.pscx

# 5. Render a model diagram to SVG
npx msx render DroneSimulation packages/examples/drone-reachability/modelica/DroneSimulation.mo > diagram.svg
```
