<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/cli

Unified command-line interface (`modelscript`, alias `msx`) for ModelScript. Provides a high-performance polyglot toolchain for compilation, simulation, optimization, formal verification, enterprise digital thread coexistence, CAD extraction, and package management across Modelica, SysML v2, STEP, and related engineering domains.

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

## Command Reference

### 1. Modeling, Flattening, Simulation & Power Systems

| Command                             | Description                                                                                      |
| :---------------------------------- | :----------------------------------------------------------------------------------------------- |
| `msx compile <name> <paths...>`     | Flatten a Modelica model into a flat DAE arena (alias: `msx flatten`)                            |
| `msx simulate <name> <paths...>`    | Numerically simulate a Modelica model and output CSV or JSON trajectories                        |
| `msx instantiate <name> <paths...>` | Instantiate and query the hierarchical AST structure of a Modelica model                         |
| `msx fmu <name> <paths...>`         | Export a Modelica model as a standalone FMI 2.0/3.0 FMU archive (alias: `export-fmu`)            |
| `msx import-fmu <fmu>`              | Import an external FMU archive and generate an acausal or causal Modelica wrapper (`fmu-import`) |
| `msx cosim`                         | Manage multi-FMU co-simulation sessions, participants, FMUs, and signal replay                   |
| `msx optimize <name> <paths...>`    | Solve optimal control problems via direct collocation with state/control boundary constraints    |
| `msx grad <name> <paths...>`        | Compute exact parameter sensitivities through simulation using continuous adjoints               |
| `msx mc <name> <paths...>`          | Run Monte Carlo simulations for parametric uncertainty quantification                            |
| `msx surrogate <name> [paths...]`   | Train or import an AI surrogate model (ROM) and generate C, ONNX, or Modelica code               |
| `msx csg <name> <paths...>`         | Compile and extract Constructive Solid Geometry (CSG) topologies to 3D meshes                    |
| `msx pscad <action> [files...]`     | Inspect, lint, diff, and simulate PSCAD power system projects (`.pscx`, `.pslx`) and COMTRADE    |

### 2. Formal Verification & Automated Testing

| Command                           | Description                                                                                                  |
| :-------------------------------- | :----------------------------------------------------------------------------------------------------------- |
| `msx verify [target] [paths...]`  | Unified formal verification and simulation validation across SysML v2, Modelica, and CAD                     |
| `msx falsify`                     | Run adversarial multi-domain requirement falsification across SysML v2, Modelica, and CAD                    |
| `msx verify-decisions <paths...>` | Formally verify SysML v2 decision tables, decide nodes, and state guards for exhaustiveness and disjointness |
| `msx decompose <paths...>`        | Perform symbolic state-space region decomposition over SysML v2 decision conditions                          |
| `msx generate-tests <paths...>`   | Synthesize formal boundary-condition and 100% MC/DC test suites from SysML v2 models                         |
| `msx export-formal <paths...>`    | Export SysML v2 models to standard formal verification formats (SMT-LIB2, nuXmv, OCRA)                       |

### 3. Linting, Formatting, Diffing & Rendering

| Command                        | Description                                                                          |
| :----------------------------- | :----------------------------------------------------------------------------------- |
| `msx lint <path> [paths...]`   | Lint polyglot models and libraries using `QueryEngine` and linear CST analysis rules |
| `msx format <files...>`        | Format source files using their language DSL formatter or unparser                   |
| `msx unparse <file>`           | Unparse and re-synthesize clean, canonical source code from the language AST         |
| `msx diff <file1> <file2>`     | Compute an AST-aware semantic diff between two model files (any registered DSL)      |
| `msx pr-diff [file]`           | Compute visual and semantic pull request diff across Git revisions (SysML, Modelica) |
| `msx render <name> <paths...>` | Render a Modelica class diagram or icon to standalone SVG                            |
| `msx i18n <paths...>`          | Extract internationalization (`.pot`) translation templates from Modelica models     |

### 4. Digital Thread, Enterprise Coexistence & Compliance

| Command                       | Description                                                                                          |
| :---------------------------- | :--------------------------------------------------------------------------------------------------- |
| `msx polyglot <action>`       | Multi-domain Triple Graph Grammar (TGG) projection, formal verification, and digital thread tracking |
| `msx align <source> <target>` | Fuzzy-align and correlate brownfield engineering assets (STEP CAD, Modelica, SysML v2, ReqIF)        |
| `msx sysml <action>`          | OMG SysML v2 engineering toolkit: standard interchange (`.sysmlx`), validation, and container export |
| `msx oslc <action>`           | OSLC Core 3.0 enterprise coexistence gateway for Teamcenter, Windchill, and DOORS                    |
| `msx reqif <action>`          | Lossless OMG ReqIF 1.2 requirements interchange with DOORS, Polarion, and Teamcenter                 |
| `msx ddp <action>`            | Digital Data Package (prostep ivip PSI 21 / OMG CASCaRA) packaging, inspection, and AASX bridging    |
| `msx dhf <action> [paths...]` | Design History File (FDA 21 CFR 820.30 / ISO 14971 / IEC 62304) regulatory compliance exporter       |

### 5. Language Engineering & DSL Workbench

| Command                              | Description                                                                           |
| :----------------------------------- | :------------------------------------------------------------------------------------ |
| `msx daemon <action>`                | Manage the background compiler daemon for instant compilation                         |
| `msx build [entry]`                  | Compile generated parser AssemblyScript into WASM and native platform binaries        |
| `msx generate [target] [entries...]` | Generate parser tables or a full VS Code extension from DSL language specifications   |
| `msx parse <file>`                   | Parse a file using its language DSL parser (supports any registered language)         |
| `msx language <action> [target]`     | Manage registered language DSLs (`list`, `register`, `unregister`; alias: `msx lang`) |
| `msx lsp`                            | Start the ModelScript polyglot Language Server over stdio for editor integration      |
| `msx playground`                     | Launch the interactive dual-editor DSL grammar workbench                              |
| `msx sandbox [entries...]`           | Start a VS Code Web sandbox with an on-the-fly compiled multi-language extension      |

### 6. Cloud HPC, Registry, Hub & Database Operations

| Command                          | Description                                                                            |
| :------------------------------- | :------------------------------------------------------------------------------------- |
| `msx cloud <action> [target]`    | Manage cloud HPC jobs, compute profiles, credit wallet, and live telemetry             |
| `msx init [path]`                | Initialize a `package.json` manifest for a Modelica or SysML project                   |
| `msx login`                      | Log in to the ModelScript Registry                                                     |
| `msx logout`                     | Log out from the ModelScript Registry                                                  |
| `msx whoami`                     | Display information about the currently authenticated registry user                    |
| `msx install [package]`          | Install a package from the ModelScript Registry into the local workspace               |
| `msx publish <path>`             | Publish a library directory or single Modelica file to the ModelScript Registry        |
| `msx pack [path]`                | Create an offline distribution `.zip` archive from a package                           |
| `msx unpublish [path]`           | Remove a published library version from the ModelScript Registry                       |
| `msx hub <command>`              | Manage, configure, and inspect federated ModelScript hub nodes                         |
| `msx db <action>`                | Database schema migration, health verification, and pre-flight snapshot management     |
| `msx archive [action] [users..]` | GDPR Art. 20 / CCPA data archive export with async worker queue and concurrency limits |

---

## Examples

```bash
# Flatten a Modelica model to DAE
msx compile BouncingBall model.mo
msx flatten Modelica.Electrical.Analog.Examples.CauerLowPassAnalog path/to/MSL

# Simulate with JSON output and custom time horizons
msx simulate BouncingBall model.mo --format json --start-time 0 --stop-time 10

# Export as an FMI 3.0 FMU
msx fmu MyModel model.mo --fmi-version 3 --output MyModel.fmu

# Run multi-domain requirements verification
msx verify SystemRequirement model.mo architecture.sysml

# Solve an optimal control problem
msx optimize MyModel model.mo \
  --objective "u^2" --controls "u" --control-bounds "u:-1:1" --stop-time 10

# Train a parametric surrogate Reduced Order Model
msx surrogate MyPlant model.mo --inputs "R,C" --input-bounds "R:1:100,C:0.001:0.1" --outputs "v" --num-samples 100 --out-file surrogate.onnx

# Render a model diagram to SVG
msx render MyModel model.mo > diagram.svg

# Lint polyglot source code
msx lint model.mo architecture.sysml
```
