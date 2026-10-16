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

| Variable              | Default                 | Description                                                                                                                                                                    |
| :-------------------- | :---------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NO_COLOR`            | Unset                   | When set to any non-empty value, disables ANSI color sequences in terminal diagnostics, tables, and diff output.                                                               |
| `MODELSCRIPT_API_URL` | `http://localhost:3000` | Base URL for the ModelScript Hub, Package Registry, and Cloud HPC dispatch API (`~/.modelscriptrc` fallback).                                                                  |
| `MODELSCRIPT_TOKEN`   | Unset                   | Bearer token (`JWT` or `ms_bot_*` service token) used for non-interactive authentication against the Registry, Cloud HPC, and Hub APIs (also accepts `MODELSCRIPT_API_TOKEN`). |

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

The `msx` CLI registers **41 commands** (plus ergonomic aliases) organized into six functional domains. See [CLI Commands](./commands.md) for exhaustive flag tables and examples for every command.

### 1. Compilation, Simulation & Optimization

| Command                                    | Aliases   | Summary                                                                                                            |
| :----------------------------------------- | :-------- | :----------------------------------------------------------------------------------------------------------------- |
| [`compile`](./commands.md#compile-flatten) | `flatten` | Flatten a Modelica class hierarchy into a canonical Differential-Algebraic Equation (DAE) system.                  |
| [`instantiate`](./commands.md#instantiate) | —         | Instantiate a Modelica class and print its resolved component and equation structure.                              |
| [`simulate`](./commands.md#simulate)       | —         | Execute numerical DAE/ODE time-domain or steady-state simulations (JS, Arena, WASM, C, JIT, WebGPU, or Cloud HPC). |
| [`optimize`](./commands.md#optimize)       | —         | Solve nonlinear Dynamic Optimization and Optimal Control Problems (OCP) via direct collocation.                    |
| [`grad`](./commands.md#grad)               | —         | Compute forward/adjoint parameter sensitivities ($\partial J / \partial p$) and finite-difference gradients.       |
| [`surrogate`](./commands.md#surrogate)     | —         | Run Design of Experiments (DoE), train Neural/Polynomial/RBF surrogates, and export ONNX/C/Modelica ROMs.          |
| [`mc`](./commands.md#mc)                   | —         | Execute multi-threaded Monte Carlo uncertainty quantification and reliability sweeps.                              |
| [`csg`](./commands.md#csg)                 | —         | Extract Constructive Solid Geometry (CSG) primitives from Modelica models into 3D CAD meshes.                      |

### 2. Linting, Formatting, Diffing & Localization

| Command                            | Aliases | Summary                                                                                                  |
| :--------------------------------- | :------ | :------------------------------------------------------------------------------------------------------- |
| [`lint`](./commands.md#lint)       | —       | Run static syntax, type, structural, and control-flow diagnostics across polyglot workspace files.       |
| [`parse`](./commands.md#parse)     | —       | Parse source files with the native WebAssembly GLR parser and inspect the concrete syntax tree (CST).    |
| [`format`](./commands.md#format)   | —       | Format source files canonically using CST-preserving pretty-printing.                                    |
| [`unparse`](./commands.md#unparse) | —       | Round-trip a parsed CST back into source text to verify lossless grammar unparsing.                      |
| [`diff`](./commands.md#diff)       | —       | Compute structural AST/CST and semantic DAE diffs between two files or Git revisions.                    |
| [`pr-diff`](./commands.md#pr-diff) | —       | Generate visual SVG/HTML architectural diffs and Markdown PR review comments against a base Git ref.     |
| [`i18n`](./commands.md#i18n)       | —       | Extract translatable strings, compile locale catalogs, and translate model identifiers across languages. |

### 3. Formal Verification, Safety & Test Synthesis

| Command                                              | Aliases | Summary                                                                                                        |
| :--------------------------------------------------- | :------ | :------------------------------------------------------------------------------------------------------------- |
| [`verify`](./commands.md#verify)                     | —       | Verify contracts, requirements, and physical invariants using BMC, $k$-induction, IC3/PDR, and Z3 SMT solving. |
| [`falsify`](./commands.md#falsify)                   | —       | Search for Signal Temporal Logic (STL) counterexamples by minimizing robustness $\rho(\phi, \mathbf{x}, t)$.   |
| [`export-formal`](./commands.md#export-formal)       | —       | Export flattened DAE systems to formal verification formats (`smt2`, `lustre`, `nusmv`, `tla`, `keymaera`).    |
| [`verify-decisions`](./commands.md#verify-decisions) | —       | Verify architectural decision records (ADRs) and parameter trade-space bounds against formal system models.    |
| [`decompose`](./commands.md#decompose)               | —       | Perform assume-guarantee contract decomposition and structural subsystem partitioning.                         |
| [`generate-tests`](./commands.md#generate-tests)     | —       | Synthesize MC/DC-complete unit test vectors and stimulus harnesses from formal model constraints.              |

### 4. Polyglot Digital Thread, Co-Simulation & Standards Interop

| Command                                  | Aliases      | Summary                                                                                                               |
| :--------------------------------------- | :----------- | :-------------------------------------------------------------------------------------------------------------------- |
| [`render`](./commands.md#render)         | —            | Render headless SVG diagrams for Modelica icons/schematics, SysML v2 (BDD/IBD/State/Activity), and PSCAD SLDs.        |
| [`fmu`](./commands.md#fmu)               | `export-fmu` | Package models into FMI 2.0/3.0 Functional Mock-up Units (`.fmu`) or inspect/import existing FMUs.                    |
| [`import-fmu`](./commands.md#import-fmu) | `fmu-import` | Unpack an external `.fmu` archive and generate typed Modelica wrapper blocks and SSP bindings.                        |
| [`cosim`](./commands.md#cosim)           | —            | Orchestrate and inspect distributed FMI/SSP Co-Simulation sessions, participants, and adaptive step optimizers.       |
| [`pscad`](./commands.md#pscad)           | —            | Lint, render SLDs, diff, simulate EMT transients, verify IEEE 2800 ride-through, and export `.pscx`/`.pswx` projects. |
| [`polyglot`](./commands.md#polyglot)     | —            | Query cross-language symbol indices, verify digital thread links, and check operational digital twin drift.           |
| [`align`](./commands.md#align)           | —            | Reconcile Triple Graph Grammar (TGG) correspondences across SysML v2, Modelica, Spice, and STEP artifacts.            |
| [`sysml`](./commands.md#sysml)           | —            | Export, import, check, inspect, and bi-directionally synchronize SysML v2 `.sysml` and Modelica `.mo` models.         |
| [`oslc`](./commands.md#oslc)             | —            | Export OSLC 3.0 RDF/Turtle/JSON-LD catalogs or launch a live OSLC Tracked Resource Set (TRS 3.0) server.              |
| [`reqif`](./commands.md#reqif)           | —            | Import and export OMG ReqIF 1.2 (`.reqif` / `.reqifz`) requirements exchange archives.                                |
| [`ddp`](./commands.md#ddp)               | —            | Inspect, pack, and convert ISO/PAS 81346 Digital Data Packages (`.ddp`) and Asset Administration Shells (`.aasx`).    |
| [`dhf`](./commands.md#dhf)               | —            | Generate, audit, and inspect FDA 21 CFR Part 820 / ISO 13485 Design History File (DHF) compliance dossiers.           |

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

| Command                                             | Aliases    | Summary                                                                                                     |
| :-------------------------------------------------- | :--------- | :---------------------------------------------------------------------------------------------------------- |
| [`init`](./commands.md#init)                        | —          | Initialize a new `modelscript.json` package manifest in the current directory.                              |
| [`login`](./commands.md#login-logout-whoami)        | —          | Authenticate with a ModelScript Registry / Hub server and store credentials in `~/.modelscriptrc`.          |
| [`logout`](./commands.md#login-logout-whoami)       | —          | Remove stored authentication tokens from `~/.modelscriptrc`.                                                |
| [`whoami`](./commands.md#login-logout-whoami)       | —          | Display the currently authenticated user, organization roles, and active registry endpoint.                 |
| [`install`](./commands.md#install)                  | `i`, `add` | Resolve, verify, and install versioned dependencies from the ModelScript Registry into `modelica_modules/`. |
| [`pack`](./commands.md#pack-publish-unpublish)      | —          | Create a deterministic, SHA-256 content-addressed `.tgz` package tarball from the workspace.                |
| [`publish`](./commands.md#pack-publish-unpublish)   | —          | Sign (Ed25519) and publish a package tarball to the ModelScript Registry.                                   |
| [`unpublish`](./commands.md#pack-publish-unpublish) | —          | Retract or deprecate a published package version from the registry.                                         |
| [`cloud`](./commands.md#cloud)                      | —          | Dispatch containerized simulation and CAE jobs to remote Slurm HPC clusters and manage compute credits.     |
| [`hub`](./commands.md#hub-db-archive)               | —          | Initialize or check the health status of a self-hosted ModelScript Hub instance.                            |
| [`db`](./commands.md#hub-db-archive)                | —          | Inspect, migrate, and cryptographically verify the Hub PostgreSQL database schema and audit chains.         |
| [`archive`](./commands.md#hub-db-archive)           | —          | Request, monitor, and download cold-storage compliance archives from the Hub.                               |

## Return Codes & CI/CD Integration

All `msx` commands return POSIX-compliant exit codes suitable for gating GitHub Actions, GitLab CI, or Jenkins pipelines:

| Exit Code | Meaning                                                                                                             |
| :-------- | :------------------------------------------------------------------------------------------------------------------ |
| `0`       | Command succeeded with zero errors (or all verification obligations proved `SAFE`).                                 |
| `1`       | Compilation error, static lint error (`severity: "error"`), counterexample falsification found, or runtime failure. |
| `2`       | Invalid CLI arguments, missing required flags, or unreadable input paths.                                           |
