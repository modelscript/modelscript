---
title: CLI Overview
description: Overview of the modelscript (msx) command-line interface, global options, environment variables, persistent compiler daemon, and 169 engineering commands.
---

# CLI Overview

The `@modelscript/cli` package provides two identical binary executables: `modelscript` and its shorthand alias `msx`. The command-line interface serves as the primary headless automation driver for compiling, simulating, verifying, linting, rendering, and orchestrating polyglot engineering systems across local workspaces, CI/CD pipelines, and cloud HPC clusters.

## Installation

You can run the CLI directly from the monorepo workspace using `npx`, or install it globally for system-wide access:

```bash
# Run directly via npx
npx msx --help

# Install globally
npm install -g @modelscript/cli
msx --version
```

## Global Options & Environment Variables

The CLI parser (`apps/cli/src/main.ts`) intercepts global execution flags prior to command dispatch and respects standard environment variables for headless CI/CD and enterprise hub integration:

### Global Flags

| Flag        | Type      | Description                                                                                                                                                                    |
| :---------- | :-------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--daemon`  | `boolean` | Route command execution through the persistent background compiler daemon (`~/.modelscript/daemon.sock`) to bypass cold-start WASM initialization and reuse warm Salsa caches. |
| `--help`    | `boolean` | Display usage information and command-specific options.                                                                                                                        |
| `--version` | `boolean` | Print the installed `@modelscript/cli` semantic version.                                                                                                                       |

### Environment Variables

| Variable                                     | Default                  | Description                                                                                                                                                                                    |
| :------------------------------------------- | :----------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NO_COLOR`                                   | Unset                    | When set to any non-empty value, disables ANSI color sequences in terminal diagnostics, tables, and diff output.                                                                               |
| `ANSATZ_API_URL` / `MODELSCRIPT_API_URL`     | `http://localhost:3000`  | Base URL for the Ansatz Platform, Package Registry, and Cloud HPC dispatch API (`~/.ansatzrc` / `~/.modelscriptrc` fallback).                                                                  |
| `ANSATZ_API_TOKEN` / `MODELSCRIPT_API_TOKEN` | Unset                    | Bearer token (`JWT` or `ms_bot_*` service token) used for non-interactive authentication against the Registry, Cloud HPC, and Hub APIs (also accepts `ANSATZ_TOKEN` or `MODELSCRIPT_TOKEN`).   |
| `MSX_EDITION`                                | `ee`                     | Runtime edition selector (`ee` for Enterprise Edition, `ce` for pure `AGPL-3.0-or-later` Community Edition). Setting `MSX_EDITION=ce` disables all `@modelscript/ee` commands and subsystems.  |
| `MSX_LICENSE_KEY`                            | Unset                    | Offline Ed25519-signed Enterprise license token (`msx_lic_<payload>.<sig>`) unlocking Enterprise CLI commands (`cloud`, `hil`, `attest`, `digital-twin`, `compliance`, `oslc`, `sysmlv2-api`). |
| `MSX_LICENSE_ENFORCE`                        | `false` (`true` in prod) | When `true`, strictly requires a valid `MSX_LICENSE_KEY` before executing Enterprise CLI commands (otherwise runs in 30-day local evaluation mode).                                            |

## Persistent Compiler Daemon (`--daemon`)

Standard CLI invocations spin up an isolated Node.js process, compile or load `.wasm` parser binaries, and index workspace dependencies from disk. When iterating rapidly or running hundreds of checks in a pre-commit hook, pass `--daemon` to any command:

```bash
# Start or auto-spawn the background daemon and run lint with warm Salsa caches
msx lint model.mo --daemon

# Explicitly manage the daemon lifecycle
msx daemon status
msx daemon restart
msx daemon stop
```

When `--daemon` is passed, `msx` connects to the local Unix domain socket (`~/.modelscript/daemon.sock` on Linux/macOS or named pipe `\\.\pipe\modelscript-daemon` on Windows). If no daemon is running, the CLI automatically spawns one in the background, waits for readiness, and streams the command's `stdout`, `stderr`, and exit code back to the terminal.

## Complete Command Reference by Category

The `msx` CLI registers **169 commands** (138 primary commands + 31 aliases) organized across **92 supported languages** and six functional domains. See [CLI Commands](./commands.md) for exhaustive flag tables and examples for every command.

### 1. Compilation, Simulation & Optimization

| Command                                    | Aliases   | Summary                                                                                                            |
| :----------------------------------------- | :-------- | :----------------------------------------------------------------------------------------------------------------- |
| [`compile`](./commands.md#compile-flatten) | `flatten` | Flatten a Modelica class hierarchy into a canonical Differential-Algebraic Equation (DAE) system.                  |
| [`instantiate`](./commands.md#instantiate) | —         | Instantiate a Modelica class and print its resolved component and equation structure.                              |
| [`simulate`](./commands.md#simulate)       | —         | Execute numerical DAE/ODE time-domain or steady-state simulations (JS, Arena, WASM, C, JIT, WebGPU, or Cloud HPC). |
| [`optimize`](./commands.md#optimize)       | —         | Solve nonlinear Dynamic Optimization and Optimal Control Problems (OCP) via direct collocation.                    |
| [`bifurcation`](./commands.md#bifurcation) | —         | Trace steady-state equilibrium curves and detect saddle-node (fold) and Hopf bifurcations via PALC continuation.   |
| [`frac`](./commands.md#frac)               | —         | Run hydraulic fracturing digital twin simulation (PKN/KGD geometry, proppant transport, Nolte-Smith screen-out).   |
| [`grad`](./commands.md#grad)               | —         | Compute forward/adjoint parameter sensitivities ($\partial J / \partial p$) and finite-difference gradients.       |
| [`surrogate`](./commands.md#surrogate)     | —         | Run Design of Experiments (DoE), train Neural/Polynomial/RBF surrogates, and export ONNX/C/Modelica ROMs.          |
| [`mc`](./commands.md#mc)                   | —         | Execute multi-threaded Monte Carlo uncertainty quantification and reliability sweeps.                              |
| [`csg`](./commands.md#csg)                 | —         | Extract Constructive Solid Geometry (CSG) primitives from Modelica models into 3D CAD meshes.                      |
| [`benchmark`](./commands.md#benchmark)     | —         | Run industrial SOTA verification and scalability benchmarks for PSS/E and PSCAD.                                   |

### 2. Linting, Formatting, Diffing & Localization

| Command                            | Aliases | Summary                                                                                                  |
| :--------------------------------- | :------ | :------------------------------------------------------------------------------------------------------- |
| [`lint`](./commands.md#lint)       | —       | Run static syntax, type, structural, and control-flow diagnostics across polyglot workspace files.       |
| [`parse`](./commands.md#parse)     | —       | Parse source files with the native WebAssembly GLR parser and inspect the concrete syntax tree (CST).    |
| [`format`](./commands.md#format)   | —       | Format source files canonically using CST-preserving pretty-printing.                                    |
| [`unparse`](./commands.md#unparse) | —       | Round-trip a parsed CST back into source text to verify lossless grammar unparsing.                      |
| [`diff`](./commands.md#diff)       | —       | Compute structural AST/CST and semantic DAE diffs between two files or Git revisions.                    |
| [`merge`](./commands.md#merge)     | —       | Perform 3-way semantic CST/AST merge across Modelica, SysML v2, and polyglot engineering files.          |
| [`pr-diff`](./commands.md#pr-diff) | —       | Generate visual SVG/HTML architectural diffs and Markdown PR review comments against a base Git ref.     |
| [`i18n`](./commands.md#i18n)       | —       | Extract translatable strings, compile locale catalogs, and translate model identifiers across languages. |

### 3. Formal Verification, Safety & Test Synthesis

| Command                                              | Aliases | Summary                                                                                                      |
| :--------------------------------------------------- | :------ | :----------------------------------------------------------------------------------------------------------- |
| [`verify`](./commands.md#verify)                     | —       | Verify decision tables, assume-guarantee contracts, and state machines; emit SARIF/JUnit/HTML reports.       |
| [`falsify`](./commands.md#falsify)                   | —       | Search for Signal Temporal Logic (STL) counterexamples by minimizing robustness $\rho(\phi, \mathbf{x}, t)$. |
| [`export-formal`](./commands.md#export-formal)       | —       | Export SysML v2 models to formal verification formats (`smt2`, `nuxmv`, `ocra`).                             |
| [`verify-decisions`](./commands.md#verify-decisions) | —       | Verify architectural decision records (ADRs) and parameter trade-space bounds against formal system models.  |
| [`decompose`](./commands.md#decompose)               | —       | Perform assume-guarantee contract decomposition and structural subsystem partitioning.                       |
| [`generate-tests`](./commands.md#generate-tests)     | —       | Synthesize MC/DC-complete unit test vectors and stimulus harnesses from formal model constraints.            |
| [`dossier`](./commands.md#dossier)                   | —       | Generate regulatory compliance dossiers across NERC PRC-024/029, IEEE 2800, ENTSO-E RfG, and AWWA M36.       |
| [`gatekeeper`](./commands.md#gatekeeper)             | —       | Execute CI/CD grid and multi-physics compliance gatekeeper checks with SARIF 2.1.0 and Markdown reporting.   |

### 4. Polyglot Digital Thread, Co-Simulation & Domain Solvers

| Command                                      | Aliases                | Summary                                                                                                                         |
| :------------------------------------------- | :--------------------- | :------------------------------------------------------------------------------------------------------------------------------ |
| [`domain`](./commands.md#domain)             | `tool`                 | Invoke domain-specific engineering actions and solvers for any registered language.                                             |
| [`inspect`](./commands.md#inspect)           | `info`, `summary`      | Inspect and summarize engineering models across any supported language.                                                         |
| [`render`](./commands.md#render)             | —                      | Render headless SVG diagrams for Modelica icons/schematics, SysML v2 (BDD/IBD/State/Activity), and PSCAD SLDs.                  |
| [`fmu`](./commands.md#fmu)                   | `export-fmu`           | Package models into FMI 2.0/3.0 Functional Mock-up Units (`.fmu`) or inspect/import existing FMUs.                              |
| [`import-fmu`](./commands.md#import-fmu)     | `fmu-import`           | Unpack an external `.fmu` archive and generate typed Modelica wrapper blocks and SSP bindings.                                  |
| [`cosim`](./commands.md#cosim)               | —                      | Orchestrate and inspect distributed FMI/SSP Co-Simulation sessions, participants, and adaptive step optimizers.                 |
| [`polyglot`](./commands.md#polyglot)         | —                      | Query cross-language symbol indices, verify digital thread links, and check operational digital twin drift across 92 languages. |
| [`align`](./commands.md#align)               | —                      | Reconcile Triple Graph Grammar (TGG) correspondences across SysML v2, Modelica, Spice, and STEP artifacts.                      |
| [`sysml`](./commands.md#sysml)               | —                      | Export, import, check, inspect, and bi-directionally synchronize SysML v2 `.sysml` and Modelica `.mo` models.                   |
| [`oslc`](./commands.md#oslc)                 | —                      | Export OSLC 3.0 RDF/Turtle/JSON-LD catalogs or launch a live OSLC Tracked Resource Set (TRS 3.0) server.                        |
| [`reqif`](./commands.md#reqif)               | —                      | Import and export OMG ReqIF 1.2 (`.reqif` / `.reqifz`) requirements exchange archives.                                          |
| [`ddp`](./commands.md#ddp)                   | —                      | Inspect, pack, and convert ISO/PAS 81346 Digital Data Packages (`.ddp`) and Asset Administration Shells (`.aasx`).              |
| [`dhf`](./commands.md#dhf)                   | —                      | Generate, audit, and inspect FDA 21 CFR Part 820 / ISO 13485 Design History File (DHF) compliance dossiers.                     |
| [`ampl`](./commands.md#ampl)                 | —                      | Parse, lint (`M9801`–`M9810`), solve LP/MILP/NLP via COIN-OR CLP/CBC, export ASL `.nl`, and lower AMPL (`.mod`, `.dat`) models. |
| [`pscad`](./commands.md#pscad)               | —                      | Lint, render SLDs, diff, simulate EMT transients, verify IEEE 2800 ride-through, and export `.pscx`/`.pswx` projects.           |
| [`psse`](./commands.md#psse)                 | —                      | Inspect, lint, solve AC power flow ($\mathbf{Y}_{\text{bus}}$), short-circuit, and project Siemens PSS/E (`.raw`, `.dyr`).      |
| [`matpower`](./commands.md#matpower)         | —                      | Inspect, lint (`MP2001`–`MP4001`), solve OPF, and project MATPOWER (`.m`) transmission cases to PSS/E and DAE arenas.           |
| [`opf`](./opf.md)                            | —                      | Solve DC/AC Optimal Power Flow, export to AMPL or PNNL ExaGO, solve Unit Commitment, and evaluate N-1 contingency redispatch.   |
| [`powerfactory`](./commands.md#powerfactory) | `pf`, `digsilent`      | Parse, lint (`PF1001`–`PF1008`), compile DSL blocks, solve DGS power flow, and project DIgSILENT PowerFactory (`.dsl`, `.dgs`). |
| [`pslf`](./commands.md#pslf)                 | —                      | Parse, lint (`PSLF-E001`–`PSLF-W003`), solve power flow, and project GE PSLF (`.epc`, `.dyd`) transmission decks.               |
| [`cgmes`](./commands.md#cgmes)               | —                      | Inspect, lint (`C1001`–`C1010`), solve AC/DC OPF, and convert ENTSO-E CIM / CGMES (`.xml`, `.rdf`) grid profiles.               |
| [`opendss`](./commands.md#opendss)           | —                      | Solve unbalanced 3-phase power flow, harmonics, QSTS, IEEE 1547 hosting capacity, and FLISR on OpenDSS (`.dss`) feeders.        |
| [`atp`](./commands.md#atp)                   | —                      | Inspect, lint, simulate, and convert ATP-EMTP transient card decks (`.atp`, `.dat`).                                            |
| [`comtrade`](./commands.md#comtrade)         | —                      | Inspect, lint, analyze, and convert IEEE C37.111 COMTRADE fault recordings (`.cfg`, `.dat`, `.cff`).                            |
| [`scl`](./commands.md#scl)                   | —                      | Inspect, lint, audit, and convert IEC 61850 Substation Configuration files (`.scd`, `.cid`, `.ssd`).                            |
| [`dnp3`](./commands.md#dnp3)                 | —                      | Inspect, lint, process telemetry, and convert IEEE 1815 / DNP3 device profiles (`.dnp3`, `.xml`, `.json`).                      |
| [`oneliner`](./commands.md#oneliner)         | —                      | Inspect, lint, solve short-circuit faults, and convert ASPEN OneLiner / CAPE cases (`.olx`, `.dxt`).                            |
| [`sel`](./commands.md#sel)                   | —                      | Inspect, lint, evaluate protection, and convert SEL relay settings (`.rcf`, `.rdb`, `.sel`, `.txt`).                            |
| [`ocpp`](./commands.md#ocpp)                 | —                      | Validate, simulate smart-charging sessions, and lower OCPP 1.6J / 2.0.1 (`.ocpp`) EV charging transcripts.                      |
| [`openadr`](./commands.md#openadr)           | —                      | Validate, simulate demand-response curtailment events, and lower OpenADR 2.0b / 3.0 (`.openadr`) payloads.                      |
| [`optical`](./commands.md#optical)           | —                      | Compute ITU-T G.694.1 DWDM OSNR/GSNR link budgets and analyze Telcordia SR-4731 OTDR (`.sor`) traces.                           |
| [`ran`](./commands.md#ran)                   | —                      | Compute 3GPP TR 38.901 5G NR / LTE RF link budgets, SINR coverage grids, and parse NSMA (`.adf`, `.msi`) antennas.              |
| [`fiber`](./commands.md#fiber)               | —                      | Resolve TIA-598-D fiber color codes, trace splice enclosures, and audit SRLG diversity on `.fiber` outside-plant cables.        |
| [`spice`](./commands.md#spice)               | —                      | Simulate DC operating point, transient, and AC frequency sweeps on SPICE (`.cir`, `.sp`, `.net`) netlists.                      |
| [`verilog-a`](./commands.md#verilog-a)       | —                      | Inspect, validate, lower to DAE, and project Verilog-A / Verilog-AMS compact models (`.va`, `.vams`).                           |
| [`ibis`](./commands.md#ibis)                 | —                      | Inspect, lint, evaluate, and lower ANSI/EIA-656-B IBIS buffer models (`.ibs`).                                                  |
| [`touchstone`](./commands.md#touchstone)     | —                      | Inspect, lint, verify passivity, and lower Touchstone N-Port models (`.s1p` ... `.sNp`, `.ts`).                                 |
| [`olga`](./commands.md#olga)                 | —                      | Simulate 1D drift-flux multiphase flow, severe slugging, PVT flash, and verify flow assurance on OLGA (`.opi`, `.key`) decks.   |
| [`lps`](./commands.md#lps)                   | —                      | Simulate transient gas/liquid networks, line pack, and hydrogen blends in PipelineStudio (`.lps`, `.tgx`, `.tlx`) models.       |
| [`eclipse`](./commands.md#eclipse)           | —                      | Inspect, lint, solve reservoir depletion, and lower ECLIPSE-format reservoir decks (`.data`, `.dat`, `.inc`).                   |
| [`aspen`](./commands.md#aspen)               | —                      | Inspect, lint, solve, and lower Aspen-compatible chemical process flowsheets (`.in`, `.inp`, `.bkp`).                           |
| [`relap5`](./commands.md#relap5)             | —                      | Inspect, lint, solve kinetics, and lower RELAP5-3D thermal-hydraulic reactor decks (`.i`, `.inp`, `.r5`).                       |
| [`energyplus`](./commands.md#energyplus)     | —                      | Inspect, validate, lower to DAE, and project US DOE EnergyPlus building models (`.idf`, `.epJSON`).                             |
| [`epanet`](./commands.md#epanet)             | —                      | Solve Global Gradient hydraulics, WQ chlorine decay, fire-flow, pump energy, and AWWA M36 audits on EPANET (`.inp`) networks.   |
| [`swmm`](./commands.md#swmm)                 | —                      | Solve 1D Saint-Venant dynamic wave stormwater routing, detention pond sizing, and LID controls on EPA SWMM (`.inp`) models.     |
| [`hec-ras`](./commands.md#hec-ras)           | `hecras`               | Solve 1D standard-step steady water surface profiles and floodplains on USACE HEC-RAS (`.prj`, `.g01`) river geometries.        |
| [`hec-hms`](./commands.md#hec-hms)           | —                      | Inspect, lint, simulate runoff, and convert HEC-HMS hydrologic basin models (`.basin`, `.hms`).                                 |
| [`waterml`](./commands.md#waterml)           | —                      | Inspect, lint, fit rating curves, and convert OGC WaterML timeseries (`.waterml`, `.wml2`, `.xml`, `.json`).                    |
| [`asm`](./commands.md#asm)                   | —                      | Inspect, lint, simulate biokinetics, and convert IWA Activated Sludge Models (`.asm`, `.bsm`, `.wrrf`).                         |
| [`tough`](./commands.md#tough)               | `tough2`               | Parse, lint, and simulate non-isothermal multiphase subsurface & geothermal reservoirs on TOUGH2/TOUGH3 (`.tough`) decks.       |
| [`modflow`](./commands.md#modflow)           | `mf6`                  | Solve 3D Darcy finite-difference groundwater head and pumping drawdowns on USGS MODFLOW 6 (`.nam`, `.dis`) models.              |
| [`landgem`](./commands.md#landgem)           | —                      | Compute first-order landfill methane generation kinetics and biogas CHP energy yield on US EPA LandGEM (`.landgem`) decks.      |
| [`gtfs`](./commands.md#gtfs)                 | —                      | Validate transit feeds, headways, and lower electric bus/rail fleet schedules to DAE on GTFS (`.gtfs`) datasets.                |
| [`simulink`](./commands.md#simulink)         | —                      | Inspect, lint, lower to DAE, and project MATLAB Simulink (`.slx`, `.mdl`) control block diagrams to Modelica.                   |
| [`autosar`](./commands.md#autosar)           | —                      | Inspect, lint, simulate the discrete Virtual RTE scheduler, and project AUTOSAR (`.arxml`) architectures.                       |
| [`opendrive`](./commands.md#opendrive)       | —                      | Inspect, validate, sample clothoids, lower to DAE, and project OpenDRIVE road networks (`.xodr`, `.xml`).                       |
| [`openscenario`](./commands.md#openscenario) | —                      | Inspect, lint, simulate, and lower ASAM OpenSCENARIO scenario files (`.xosc`, `.osc`).                                          |
| [`plcopen`](./commands.md#plcopen)           | —                      | Inspect, validate, simulate, and project IEC 61131-3 PLCopen XML & Structured Text models (`.xml`, `.plcopen`, `.st`).          |
| [`urdf`](./commands.md#urdf)                 | —                      | Validate kinematic trees, evaluate Featherstone RNEA inverse dynamics, and project ROS URDF/Xacro (`.urdf`, `.xacro`) robots.   |
| [`simpack`](./commands.md#simpack)           | —                      | Analyze Grübler spatial mobility, lint markers/joints, and simulate SIMPACK (`.spck`, `.sim`) multibody systems.                |
| [`gensys`](./commands.md#gensys)             | —                      | Verify EN 14363 derailment safety ($Y/Q \le 0.80$), FASTSIM contact, and simulate GENSYS (`.calc`) rail vehicles.               |
| [`adams`](./commands.md#adams)               | —                      | Analyze spatial mobility, lint markers, and project MSC Adams (`.adm`, `.cmd`) multibody mechanisms.                            |
| [`jsbsim`](./commands.md#jsbsim)             | —                      | Inspect, lint, simulate 6-DOF flight dynamics, and lower JSBSim models (`.xml`).                                                |
| [`ccsds`](./commands.md#ccsds)               | —                      | Inspect, validate, propagate, lower to DAE, and project CCSDS and XTCE spacecraft data (`.oem`, `.opm`, `.omm`, `.xtce`).       |
| [`easy5`](./commands.md#easy5)               | —                      | Inspect, lint, linearize, and project EASY5 (`.ez5`, `.ezm`) aerospace and fluid-thermal schematics.                            |
| [`gtsuite`](./commands.md#gtsuite)           | —                      | Inspect, lint compressor surge/CFL bounds, and simulate GT-SUITE (`.gtm`, `.gtd`) engine and powertrain models.                 |
| [`sima`](./commands.md#sima)                 | —                      | Verify DNV-OS-E301 mooring tension safety factors and vessel offsets on SIMA (`.sima`, `.inp`) offshore models.                 |
| [`rocets`](./commands.md#rocets)             | —                      | Balance turbopump flows, check chamber mixture ratios, and simulate NASA ROCETS (`.roc`, `.deck`) propulsion decks.             |
| [`cfd`](./commands.md#cfd)                   | —                      | Inspect, lint, solve, and project CFD aerodynamic models (`.cfg`, `.foam`, `.su2`).                                             |
| [`fea`](./commands.md#fea)                   | —                      | Inspect, lint, solve, and project FEA structural models (`.inp`, `.bdf`, `.dat`).                                               |
| [`c`](./commands.md#c)                       | —                      | Inspect, lint, and bridge C99/ANSI C files and headers (`.c`, `.h`).                                                            |
| [`qif`](./commands.md#qif)                   | —                      | Validate ASME Y14.5 GD&T rules, compute SPC capability ($C_p, C_{pk}$, TUR), and reconcile STEP AP242 with ISO 23952 `.qif`.    |
| [`oscal`](./commands.md#oscal)               | —                      | Resolve control baselines, audit NIST SP 800-53 / SP 800-82 CPS compliance, and project NIST OSCAL security models.             |
| [`aml`](./commands.md#aml)                   | `automationml`, `caex` | Validate IEC 62714 CAEX hierarchies, run closed-loop Virtual PLC commissioning, and project `.aml` workcells.                   |
| [`sbml`](./commands.md#sbml)                 | —                      | Inspect, lint, simulate biochemical networks, and lower SBML models (`.sbml`, `.xml`).                                          |
| [`opensim`](./commands.md#opensim)           | —                      | Validate musculoskeletal kinematics & Hill-type muscles (`M9101`–`M9110`), simulate activation, and project `.osim` models.     |
| [`dicom-rt`](./commands.md#dicom-rt)         | —                      | Verify QUANTEC OAR dose limits & MLC kinematics (`M9201`–`M9210`), compute DVH/BED/$\text{EQD}_2$, and project `.rtplan`.       |
| [`cellml`](./commands.md#cellml)             | —                      | Validate SI dimensional consistency (`M9301`–`M9310`), integrate electrophysiology ODEs, and project `.cellml` models.          |
| [`febio`](./commands.md#febio)               | `sofa`                 | Validate hyperelastic/biphasic tissue mechanics (`M9401`–`M9410`), solve strain energy, and project `.feb`/`.scn` scenes.       |
| [`nifti`](./commands.md#nifti)               | `nrrd`                 | Validate `qform`/`sform` RAS affine transforms (`M9501`–`M9510`), extract iso-surface meshes, and project `.nii`/`.nrrd`.       |
| [`topas`](./commands.md#topas)               | `gate`                 | Validate hadrontherapy beamlines (`M9601`–`M9610`), compute analytical Bragg peak depth-dose curves, and project `.topas`.      |
| [`three-mf`](./commands.md#three-mf)         | `3mf`                  | Verify 2-manifold watertightness, wall thickness & osteotomy guides (`M9701`–`M9710`), and project `.3mf` surgical guides.      |
| [`igtl`](./commands.md#igtl)                 | `openigtlink`          | Validate $SE(3)$ transforms (`M9801`–`M9810`), solve stylus pivot calibration & TRE, and project `.igtl`/`.plus.xml`.           |

### 5. Language Workbench, Daemon & IDE Tooling

| Command                                  | Aliases | Summary                                                                                                      |
| :--------------------------------------- | :------ | :----------------------------------------------------------------------------------------------------------- |
| [`daemon`](./commands.md#daemon)         | —       | Manage the persistent background compiler daemon (`start`, `stop`, `status`, `restart`).                     |
| [`build`](./commands.md#build)           | —       | Compile a grammar DSL definition into a native WebAssembly GLR parser (`parser.wasm`) and TypeScript types.  |
| [`generate`](./commands.md#generate)     | —       | Scaffold new WASM GLR parsers or standalone VS Code language extensions from a grammar module.               |
| [`language`](./commands.md#language)     | `lang`  | List, dynamically register, or unregister custom language plugins in the workspace registry.                 |
| [`lsp`](./commands.md#lsp)               | —       | Launch the multi-language ModelScript Language Server Protocol (LSP) server over `stdio` or TCP/IPC sockets. |
| [`playground`](./commands.md#playground) | —       | Start a local interactive web playground server for testing grammars, CSTs, and DAE compilation.             |
| [`sandbox`](./commands.md#sandbox)       | —       | Execute untrusted scripts or models inside a resource-capped, capability-isolated WebAssembly sandbox.       |

### 6. Package Registry, Cloud HPC & Hub Administration

| Command                                             | Aliases          | Summary                                                                                                        |
| :-------------------------------------------------- | :--------------- | :------------------------------------------------------------------------------------------------------------- |
| [`init`](./commands.md#init)                        | —                | Initialize a new `modelscript.json` package manifest in the current directory.                                 |
| [`login`](./commands.md#login-logout-whoami)        | —                | Authenticate with the Ansatz Package Registry / Platform and store credentials in `~/.ansatzrc`.               |
| [`logout`](./commands.md#login-logout-whoami)       | —                | Remove stored authentication tokens from `~/.ansatzrc` / `~/.modelscriptrc`.                                   |
| [`whoami`](./commands.md#login-logout-whoami)       | —                | Display the currently authenticated user, organization roles, and active registry endpoint.                    |
| [`token`](./commands.md#token)                      | —                | Manage granular personal access tokens (`create`, `list`, `revoke`).                                           |
| [`install`](./commands.md#install)                  | `i`, `add`       | Resolve, verify, and install versioned dependencies from the Ansatz Package Registry into `modelica_modules/`. |
| [`stdlib`](./commands.md#stdlib)                    | —                | Browse, search, and bootstrap official standard libraries across all 92 engineering languages.                 |
| [`pack`](./commands.md#pack-publish-unpublish)      | —                | Create a deterministic, SHA-256 content-addressed `.zip` package archive from the workspace.                   |
| [`publish`](./commands.md#pack-publish-unpublish)   | —                | Sign (Ed25519) and publish a package archive to the Ansatz Package Registry.                                   |
| [`unpublish`](./commands.md#pack-publish-unpublish) | —                | Retract or deprecate a published package version from the Ansatz Package Registry.                             |
| [`deprecate`](./commands.md#deprecate-yank)         | —                | Mark a published package version or range as deprecated in the Ansatz Package Registry.                        |
| [`yank`](./commands.md#deprecate-yank)              | —                | Yank a compromised or broken package version from new dependency resolutions while preserving lockfile builds. |
| [`vendor`](./commands.md#vendor-mirror)             | —                | Vendor all transitive dependencies into a self-contained offline directory with SHA-256 integrity manifests.   |
| [`mirror`](./commands.md#vendor-mirror)             | —                | Synchronize registry packages into an air-gapped enterprise mirror bundle.                                     |
| [`cloud`](./commands.md#cloud)                      | —                | Dispatch containerized simulation and CAE jobs to remote Slurm HPC clusters and manage compute credits.        |
| [`hub`](./commands.md#hub-db-archive)               | `ansatz`, `node` | Initialize or check the health status of a self-hosted Ansatz / ModelScript node.                              |
| [`db`](./commands.md#hub-db-archive)                | —                | Inspect, migrate, and cryptographically verify the Hub SQLite/PostgreSQL database schema and audit chains.     |
| [`archive`](./commands.md#hub-db-archive)           | —                | Request, monitor, and download cold-storage compliance archives from the Hub.                                  |
| [`keys`](./commands.md#keys)                        | `key`            | Manage Ed25519 cryptographic signing keys (`list`, `generate`, `register`, `revoke`, `policy`).                |
| [`sign`](./commands.md#sign)                        | —                | Cryptographically sign Markdown posts and artifacts or verify W3C Data Integrity (`eddsa-jcs-2022`) proofs.    |

## Return Codes & CI/CD Integration

All `msx` commands return POSIX-compliant exit codes suitable for gating GitHub Actions, GitLab CI, or Jenkins pipelines:

| Exit Code | Meaning                                                                                                             |
| :-------- | :------------------------------------------------------------------------------------------------------------------ |
| `0`       | Command succeeded with zero errors (or all verification obligations proved `SAFE`).                                 |
| `1`       | Compilation error, static lint error (`severity: "error"`), counterexample falsification found, or runtime failure. |
| `2`       | Invalid CLI arguments, missing required flags, or unreadable input paths.                                           |
