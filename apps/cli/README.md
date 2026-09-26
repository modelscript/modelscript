<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/cli

Unified command-line interface (`msc`) for ModelScript. Provides a high-performance polyglot toolchain for compilation, simulation, optimization, formal verification, enterprise digital thread coexistence, CAD extraction, and package management across Modelica, SysML v2, STEP, and related engineering domains.

---

## Installation & Usage

After building the monorepo, `msc` is available locally or via `npx`:

```bash
# Check version and global options
npx msc --help

# Run with background compiler daemon for instant response
npx msc --daemon <command>
```

---

## Command Reference

### 1. Modeling, Flattening & Simulation

| Command                             | Description                                                                     |
| :---------------------------------- | :------------------------------------------------------------------------------ |
| `msc compile <name> <paths...>`     | Flatten a Modelica model into a flat DAE arena (alias: `msc flatten`)           |
| `msc simulate <name> <paths...>`    | Numerically simulate a Modelica model (outputs CSV or JSON trajectories)        |
| `msc instantiate <name> <paths...>` | Instantiate and query the hierarchical AST and component structure              |
| `msc fmu <name> <paths...>`         | Export a model as a standalone FMI 2.0/3.0 FMU archive (alias: `export-fmu`)    |
| `msc cosim`                         | Manage multi-FMU co-simulation sessions, participants, and signal replay        |
| `msc optimize <name> <paths...>`    | Solve optimal control problems via direct collocation with boundary constraints |
| `msc grad <name> <paths...>`        | Compute exact parameter sensitivities via simulation continuous adjoints        |
| `msc mc <name> <paths...>`          | Run Monte Carlo simulations for parametric uncertainty quantification           |
| `msc surrogate <name> <paths...>`   | Train Reduced Order Models (ROM) and synthesize C/WASM evaluation kernels       |
| `msc csg <name> <paths...>`         | Evaluate Constructive Solid Geometry topologies and export 3D meshes            |

### 2. Formal Verification & Testing

| Command                           | Description                                                                 |
| :-------------------------------- | :-------------------------------------------------------------------------- |
| `msc verify [target] [paths...]`  | Polyglot requirements verification across SysML v2, Modelica, and CAD       |
| `msc falsify`                     | Run adversarial multi-domain requirement falsification                      |
| `msc verify-decisions <paths...>` | Formally check SysML v2 decision tables and state guards for exhaustiveness |
| `msc decompose <paths...>`        | Symbolic state-space region decomposition over decision conditions          |
| `msc generate-tests <paths...>`   | Synthesize formal boundary conditions and 100% MC/DC test suites            |
| `msc export-formal <paths...>`    | Export models to formal verification formats (SMT-LIB2, nuXmv, OCRA)        |

### 3. Verification, Linting & Diffing

| Command                        | Description                                                          |
| :----------------------------- | :------------------------------------------------------------------- |
| `msc lint <paths...>`          | Lint polyglot models using QueryEngine and linear CST analysis rules |
| `msc format <files...>`        | Format source files using their language DSL formatter or unparser   |
| `msc unparse <file>`           | Re-synthesize clean, canonical source code from the language AST     |
| `msc diff <file1> <file2>`     | Compute AST-aware semantic diffs between two model revisions         |
| `msc pr-diff [file]`           | Visual and semantic pull request diff across Git revisions           |
| `msc render <name> <paths...>` | Render Modelica model diagram or class icon to standalone SVG        |
| `msc i18n <paths...>`          | Extract internationalization (`.pot`) templates from models          |

### 4. Digital Thread & Enterprise Coexistence

| Command                    | Description                                                             |
| :------------------------- | :---------------------------------------------------------------------- |
| `msc align <src> <target>` | Fuzzy-align brownfield assets (STEP CAD, Modelica, SysML v2, ReqIF)     |
| `msc oslc <action>`        | OSLC Core 3.0 enterprise gateway (Teamcenter, Windchill, DOORS)         |
| `msc reqif <action>`       | Lossless OMG ReqIF 1.2 requirements import and export                   |
| `msc ddp <action>`         | Digital Data Package (prostep ivip PSI 21 / CASCaRA / AASX) packaging   |
| `msc dhf <action>`         | Design History File (FDA 21 CFR 820.30 / ISO 14971) compliance exporter |

### 5. Language Engineering & Package Registry

| Command                    | Description                                                          |
| :------------------------- | :------------------------------------------------------------------- |
| `msc daemon <action>`      | Manage the background compiler daemon for instant compilation        |
| `msc lsp`                  | Start the polyglot Language Server over stdio for editor integration |
| `msc sandbox [entries...]` | Launch a VS Code Web sandbox with on-the-fly compiled extensions     |
| `msc init [path]`          | Initialize a `package.json` manifest for a Modelica or SysML project |
| `msc publish <path>`       | Publish a library to the ModelScript Registry                        |
| `msc unpublish <path>`     | Remove a published library version from the registry                 |
| `msc login` / `logout`     | Authenticate with the ModelScript Registry                           |

---

## Examples

```bash
# Flatten a Modelica model to DAE
msc compile BouncingBall model.mo
msc flatten Modelica.Electrical.Analog.Examples.CauerLowPassAnalog path/to/MSL

# Simulate with JSON output and custom time horizons
msc simulate BouncingBall model.mo --format json --start-time 0 --stop-time 10

# Export as an FMI 3.0 FMU
msc fmu export MyModel model.mo --version 3.0 --output MyModel.fmu

# Run multi-domain requirements verification
msc verify SystemRequirement model.mo --sysml architecture.sysml

# Solve an optimal control problem
msc optimize MyModel model.mo \
  --objective "u^2" --controls "u" --control-bounds "u:-1:1" --stop-time 10

# Render a model diagram to SVG
msc render MyModel model.mo > diagram.svg

# Lint polyglot source code
msc lint model.mo architecture.sysml
```
