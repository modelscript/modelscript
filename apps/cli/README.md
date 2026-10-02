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

### 1. Modeling, Flattening & Simulation

| Command                             | Description                                                                     |
| :---------------------------------- | :------------------------------------------------------------------------------ |
| `msx compile <name> <paths...>`     | Flatten a Modelica model into a flat DAE arena (alias: `msx flatten`)           |
| `msx simulate <name> <paths...>`    | Numerically simulate a Modelica model (outputs CSV or JSON trajectories)        |
| `msx instantiate <name> <paths...>` | Instantiate and query the hierarchical AST and component structure              |
| `msx fmu <name> <paths...>`         | Export a model as a standalone FMI 2.0/3.0 FMU archive (alias: `export-fmu`)    |
| `msx cosim`                         | Manage multi-FMU co-simulation sessions, participants, and signal replay        |
| `msx optimize <name> <paths...>`    | Solve optimal control problems via direct collocation with boundary constraints |
| `msx grad <name> <paths...>`        | Compute exact parameter sensitivities via simulation continuous adjoints        |
| `msx mc <name> <paths...>`          | Run Monte Carlo simulations for parametric uncertainty quantification           |
| `msx surrogate <name> <paths...>`   | Train Reduced Order Models (ROM) and synthesize C/WASM evaluation kernels       |
| `msx csg <name> <paths...>`         | Evaluate Constructive Solid Geometry topologies and export 3D meshes            |

### 2. Formal Verification & Testing

| Command                           | Description                                                                 |
| :-------------------------------- | :-------------------------------------------------------------------------- |
| `msx verify [target] [paths...]`  | Polyglot requirements verification across SysML v2, Modelica, and CAD       |
| `msx falsify`                     | Run adversarial multi-domain requirement falsification                      |
| `msx verify-decisions <paths...>` | Formally check SysML v2 decision tables and state guards for exhaustiveness |
| `msx decompose <paths...>`        | Symbolic state-space region decomposition over decision conditions          |
| `msx generate-tests <paths...>`   | Synthesize formal boundary conditions and 100% MC/DC test suites            |
| `msx export-formal <paths...>`    | Export models to formal verification formats (SMT-LIB2, nuXmv, OCRA)        |

### 3. Verification, Linting & Diffing

| Command                        | Description                                                          |
| :----------------------------- | :------------------------------------------------------------------- |
| `msx lint <paths...>`          | Lint polyglot models using QueryEngine and linear CST analysis rules |
| `msx format <files...>`        | Format source files using their language DSL formatter or unparser   |
| `msx unparse <file>`           | Re-synthesize clean, canonical source code from the language AST     |
| `msx diff <file1> <file2>`     | Compute AST-aware semantic diffs between two model revisions         |
| `msx pr-diff [file]`           | Visual and semantic pull request diff across Git revisions           |
| `msx render <name> <paths...>` | Render Modelica model diagram or class icon to standalone SVG        |
| `msx i18n <paths...>`          | Extract internationalization (`.pot`) templates from models          |

### 4. Digital Thread & Enterprise Coexistence

| Command                    | Description                                                             |
| :------------------------- | :---------------------------------------------------------------------- |
| `msx align <src> <target>` | Fuzzy-align brownfield assets (STEP CAD, Modelica, SysML v2, ReqIF)     |
| `msx oslc <action>`        | OSLC Core 3.0 enterprise gateway (Teamcenter, Windchill, DOORS)         |
| `msx reqif <action>`       | Lossless OMG ReqIF 1.2 requirements import and export                   |
| `msx ddp <action>`         | Digital Data Package (prostep ivip PSI 21 / CASCaRA / AASX) packaging   |
| `msx dhf <action>`         | Design History File (FDA 21 CFR 820.30 / ISO 14971) compliance exporter |

### 5. Language Engineering & Package Registry

| Command                    | Description                                                          |
| :------------------------- | :------------------------------------------------------------------- |
| `msx daemon <action>`      | Manage the background compiler daemon for instant compilation        |
| `msx lsp`                  | Start the polyglot Language Server over stdio for editor integration |
| `msx sandbox [entries...]` | Launch a VS Code Web sandbox with on-the-fly compiled extensions     |
| `msx init [path]`          | Initialize a `package.json` manifest for a Modelica or SysML project |
| `msx publish <path>`       | Publish a library to the ModelScript Registry                        |
| `msx unpublish <path>`     | Remove a published library version from the registry                 |
| `msx login` / `logout`     | Authenticate with the ModelScript Registry                           |

---

## Examples

```bash
# Flatten a Modelica model to DAE
msx compile BouncingBall model.mo
msx flatten Modelica.Electrical.Analog.Examples.CauerLowPassAnalog path/to/MSL

# Simulate with JSON output and custom time horizons
msx simulate BouncingBall model.mo --format json --start-time 0 --stop-time 10

# Export as an FMI 3.0 FMU
msx fmu export MyModel model.mo --version 3.0 --output MyModel.fmu

# Run multi-domain requirements verification
msx verify SystemRequirement model.mo --sysml architecture.sysml

# Solve an optimal control problem
msx optimize MyModel model.mo \
  --objective "u^2" --controls "u" --control-bounds "u:-1:1" --stop-time 10

# Render a model diagram to SVG
msx render MyModel model.mo > diagram.svg

# Lint polyglot source code
msx lint model.mo architecture.sysml
```
