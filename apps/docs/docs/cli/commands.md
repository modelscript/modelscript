# CLI Commands Reference

This reference documents every command, subcommand, and flag registered in `@modelscript/cli` (`apps/cli/src/main.ts` and `apps/cli/src/commands/`). All commands can be invoked via `modelscript` or its shorthand alias `msx`, and any command can be accelerated with the global `--daemon` flag.

---

## Compilation, Simulation & Optimization

### `compile` / `flatten`

Compiles and flattens a hierarchical Modelica class into a canonical Differential-Algebraic Equation (DAE) representation in linear WebAssembly memory (`DAEBuilder`). `flatten` is an exact alias for `compile`.

```bash
msx compile <name> <paths...> [options]
msx flatten <name> <paths...> [options]
```

| Option                         | Type                           | Default                    | Description                                                                                                                                      |
| :----------------------------- | :----------------------------- | :------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------- |
| `-L, --modelica-path <string>` | `string`                       | `process.env.MODELICAPATH` | Colon- or semicolon-separated search paths for resolving external Modelica libraries (such as MSL).                                              |
| `-F, --flattener <backend>`    | `ts \| wasm \| hybrid \| diff` | `"hybrid"`                 | Flattener execution backend (`hybrid` pairs the Salsa query engine with the AssemblyScript WASM kernel; `diff` cross-checks TS vs. WASM parity). |
| `--timing`                     | `boolean`                      | `false`                    | Print per-stage compilation timing breakdowns (parsing, indexing, Salsa instantiation, DAE lowering).                                            |
| `--memory-profile`             | `boolean`                      | `false`                    | Print WebAssembly linear memory arena utilization and V8 heap statistics.                                                                        |

```bash
# Flatten a model using the hybrid WASM kernel with timing breakdowns
msx flatten Modelica.Electrical.Analog.Examples.ChuaCircuit -L ./libraries --timing
```

---

### `instantiate`

Instantiates a Modelica class via the Salsa `QueryEngine` and prints the resolved component hierarchy, inherited modifications, and bindings prior to DAE index reduction.

```bash
msx instantiate <name> <paths...> [options]
```

| Option                         | Type                           | Default                    | Description                                             |
| :----------------------------- | :----------------------------- | :------------------------- | :------------------------------------------------------ |
| `-L, --modelica-path <string>` | `string`                       | `process.env.MODELICAPATH` | Library search paths for resolving package imports.     |
| `-F, --flattener <backend>`    | `ts \| wasm \| hybrid \| diff` | `"hybrid"`                 | Flattener backend used to resolve class specialization. |
| `--timing`                     | `boolean`                      | `false`                    | Print instantiation query timing.                       |

---

### `simulate`

Compiles a model, performs Block Lower Triangular (BLT) Pantelides index reduction and tearing, and executes a numerical time-domain or steady-state simulation locally or on a remote Slurm HPC cluster.

```bash
msx simulate <name> <paths..> [options]
```

| Option                      | Type                                                                                     | Default                | Description                                                                                                                                                        |
| :-------------------------- | :--------------------------------------------------------------------------------------- | :--------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--start-time <number>`     | `number`                                                                                 | `0.0` (or annotation)  | Simulation start time $t_0$ in seconds.                                                                                                                            |
| `--stop-time <number>`      | `number`                                                                                 | `1.0` (or annotation)  | Simulation stop time $t_f$ in seconds.                                                                                                                             |
| `--tolerance <number>`      | `number`                                                                                 | `1e-6`                 | Relative/absolute local error tolerance for adaptive step-size control.                                                                                            |
| `--interval <number>`       | `number`                                                                                 | `(stop - start) / 500` | Output communication interval $\Delta t_{\text{out}}$ in seconds.                                                                                                  |
| `--format <fmt>`            | `csv \| json \| none`                                                                    | `"csv"`                | Trajectory output format (`none` suppresses trajectory serialization for benchmarking).                                                                            |
| `--solver <solver>`         | `euler \| rk4 \| dopri5 \| tsit5 \| trbdf2 \| rodas4p \| bdf \| auto \| cvode \| webgpu` | `"dopri5"`             | Numerical integration method (`bdf`, `trbdf2`, `rodas4p`, and SUNDIALS `cvode` handle stiff DAEs; `webgpu` executes batched GPU kernels).                          |
| `--realtime <number>`       | `number`                                                                                 | Unset                  | Pace simulation execution to a real-time clock multiplier (e.g., `1.0` for 1x wall-clock HIL pacing).                                                              |
| `--engine <engine>`         | `js \| arena \| wasm \| c \| jit`                                                        | `"js"`                 | Residual evaluation runtime (`arena` evaluates directly on `DAEBuilder` linear memory; `wasm` and `c` compile native kernels; `jit` uses dynamic JS/WASM codegen). |
| `--jit`                     | `boolean`                                                                                | `false`                | Shorthand flag to enable JIT compilation of residual and Jacobian evaluators.                                                                                      |
| `--jacobian <mode>`         | `dense \| sparse \| fd`                                                                  | `"sparse"`             | Jacobian evaluation strategy (symbolic CSC `sparse`, `dense`, or finite-difference `fd`).                                                                          |
| `-F, --flattener <backend>` | `ts \| wasm \| hybrid \| diff`                                                           | `"hybrid"`             | Flattener backend used during compilation.                                                                                                                         |
| `--steady-state`            | `boolean`                                                                                | `false`                | Solve for the equilibrium point $\dot{\mathbf{x}} = \mathbf{0}$ using Newton-Raphson with homotopy continuation instead of time-stepping.                          |
| `--timing`                  | `boolean`                                                                                | `false`                | Report per-phase compilation, BLT, and solver wall-clock time.                                                                                                     |
| `--memory-profile`          | `boolean`                                                                                | `false`                | Report peak memory usage across the linear DAE arena and integrator buffers.                                                                                       |
| `--cloud`                   | `boolean`                                                                                | `false`                | Offload simulation execution to a remote ModelScript Cloud / Slurm HPC cluster.                                                                                    |
| `--profile <string>`        | `string`                                                                                 | `"standard"`           | Cloud compute hardware profile (`standard`, `high-cpu`, `gpu-a100`, etc.) when `--cloud` is enabled.                                                               |
| `--async`                   | `boolean`                                                                                | `false`                | Submit the `--cloud` job and return the job ID immediately without blocking for completion.                                                                        |
| `--poll-interval <number>`  | `number`                                                                                 | `1500`                 | Polling interval in milliseconds when waiting on a synchronous `--cloud` job.                                                                                      |
| `--output-dir <string>`     | `string`                                                                                 | `"./results"`          | Local directory where downloaded `--cloud` simulation artifacts are saved.                                                                                         |
| `--api-url <string>`        | `string`                                                                                 | `MODELSCRIPT_API_URL`  | Override the ModelScript Cloud API base URL.                                                                                                                       |

```bash
# Run a stiff DAE simulation using the 4th-order Rosenbrock solver and sparse symbolic Jacobians
msx simulate RLC_Circuit circuit.mo --stop-time 10.0 --solver rodas4p --engine arena --jacobian sparse --format csv > trajectory.csv

# Dispatch a heavy multi-domain simulation to the Cloud HPC cluster
msx simulate ThermalGrid plant.mo --cloud --profile high-cpu --stop-time 3600 --output-dir ./runs/thermal
```

---

### `optimize`

Formulates and solves a nonlinear Dynamic Optimization / Optimal Control Problem (OCP) over a flattened DAE using direct collocation and sequential quadratic programming (SQP).

```bash
msx optimize <name> <paths..> [options]
```

| Option                      | Type          | Default      | Description                                                                                     |
| :-------------------------- | :------------ | :----------- | :---------------------------------------------------------------------------------------------- |
| `--objective <string>`      | `string`      | **Required** | Mayer or Lagrange objective variable/expression to minimize at `--stop-time`.                   |
| `--controls <string>`       | `string`      | **Required** | Comma-separated list of free control input variables $u_i(t)$.                                  |
| `--control-bounds <string>` | `string`      | Unset        | Bounds specification formatted as `u1:min:max,u2:min:max` (e.g., `throttle:0:1,brake:-5000:0`). |
| `--start-time <number>`     | `number`      | `0.0`        | Horizon start time $t_0$.                                                                       |
| `--stop-time <number>`      | `number`      | `1.0`        | Horizon terminal time $t_f$.                                                                    |
| `--num-intervals <number>`  | `number`      | `50`         | Number of collocation finite elements across $[t_0, t_f]$.                                      |
| `--tolerance <number>`      | `number`      | `1e-6`       | KKT optimality convergence tolerance.                                                           |
| `--max-iterations <number>` | `number`      | `200`        | Maximum NLP solver iterations.                                                                  |
| `--format <fmt>`            | `csv \| json` | `"csv"`      | Output format for optimal state and control trajectories.                                       |

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

```bash
msx grad <name> <paths..> [options]
```

| Option                  | Type                   | Default      | Description                                                                        |
| :---------------------- | :--------------------- | :----------- | :--------------------------------------------------------------------------------- |
| `--params <string>`     | `string`               | **Required** | Comma-separated list of model parameters $p_i$ to differentiate with respect to.   |
| `--objectives <string>` | `string`               | **Required** | Comma-separated list of state or output variables evaluated at `--stop-time`.      |
| `--start-time <number>` | `number`               | `0.0`        | Integration start time.                                                            |
| `--stop-time <number>`  | `number`               | `1.0`        | Integration stop time.                                                             |
| `--tolerance <number>`  | `number`               | `1e-6`       | Integrator tolerance.                                                              |
| `--step-size <number>`  | `number`               | `1e-4`       | Relative perturbation step $\epsilon$ when validating against finite differences.  |
| `--format <fmt>`        | `json \| table \| csv` | `"table"`    | Output format for the Jacobian matrix $\partial \mathbf{J} / \partial \mathbf{p}$. |

---

### `surrogate`

Executes a Design of Experiments (DoE) campaign over a physics model, trains a Reduced-Order Model (ROM) surrogate, attaches convex-hull/bounding-box extrapolation guardrails, and exports standalone C, ONNX, or Modelica `.mo` blocks.

```bash
msx surrogate <name> [paths..] [options]
```

| Option                         | Type                                                              | Default                         | Description                                                                                                                        |
| :----------------------------- | :---------------------------------------------------------------- | :------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------- |
| `--inputs <string>`            | `string`                                                          | Required (unless `--from-onnx`) | Comma-separated list of input parameter/variable names.                                                                            |
| `--input-bounds <string>`      | `string`                                                          | Required (unless `--from-onnx`) | Parameter sampling bounds formatted as `p1:min:max,p2:min:max`.                                                                    |
| `--outputs <string>`           | `string`                                                          | Required (unless `--from-onnx`) | Comma-separated list of target output variables to approximate.                                                                    |
| `--strategy <strategy>`        | `full-factorial \| latin-hypercube \| sobol \| central-composite` | `"latin-hypercube"`             | Space-filling experimental design sampler.                                                                                         |
| `--num-samples <number>`       | `number`                                                          | `50`                            | Number of full-order physics simulations to execute.                                                                               |
| `--architecture <arch>`        | `mlp \| polynomial \| rbf`                                        | `"mlp"`                         | Surrogate model architecture (Multi-Layer Perceptron, multivariate polynomial response surface, or Radial Basis Function network). |
| `--start-time <number>`        | `number`                                                          | `0.0`                           | Simulation start time per DoE sample.                                                                                              |
| `--stop-time <number>`         | `number`                                                          | `1.0`                           | Simulation stop time per DoE sample.                                                                                               |
| `--format <fmt>`               | `c \| onnx \| mo \| all`                                          | `"c"`                           | Target artifact format (`mo` synthesizes a drop-in pure Modelica `block` with embedded weights).                                   |
| `--from-onnx <string>`         | `string`                                                          | Unset                           | Bypass DoE training and import an existing pre-trained `.onnx` neural network directly into Modelica/C.                            |
| `--extrapolation-guardrails`   | `boolean`                                                         | `true`                          | Emit runtime domain-validity checks (`assert()` statements in `.mo` / bounds checks in C) when queried outside training bounds.    |
| `--extrapolation-level <lvl>`  | `warning \| error`                                                | `"warning"`                     | Severity passed to generated Modelica `AssertionLevel.warning` or `AssertionLevel.error`.                                          |
| `--extrapolation-flag`         | `boolean`                                                         | `true`                          | Emit a boolean output port `isExtrapolating` on the generated surrogate block.                                                     |
| `--out-file <string>`          | `string`                                                          | Auto-derived                    | Output file path for the generated surrogate artifact.                                                                             |
| `--replace-component <string>` | `string`                                                          | Unset                           | Automatically substitute the specified component instance inside the parent model with the trained surrogate block.                |
| `--replace-out <string>`       | `string`                                                          | Unset                           | File path to write the rewritten parent model when `--replace-component` is used.                                                  |
| `--report <string>`            | `string`                                                          | `"report.json"`                 | Output path for validation metrics ($R^2$, RMSE, max error, and training loss history).                                            |

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

```bash
msx mc <name> <paths..> [options]
```

| Option               | Type          | Default      | Description                                                                                                                                                                                                        |
| :------------------- | :------------ | :----------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--params <string>`  | `string`      | **Required** | Comma-separated stochastic distribution specs: `name:dist:arg1:arg2` where `dist` is `gaussian` ($\mu,\sigma$), `uniform` ($a,b$), `lognormal` ($\mu,\sigma$), `beta` ($\alpha,\beta$), or `triangular` ($a,b,c$). |
| `--runs <number>`    | `number`      | `1000`       | Total number of Monte Carlo realizations.                                                                                                                                                                          |
| `--threads <number>` | `number`      | `1`          | Number of parallel worker threads.                                                                                                                                                                                 |
| `--seed <number>`    | `number`      | Random       | Deterministic PRNG seed for reproducible ensembles.                                                                                                                                                                |
| `--lhs`              | `boolean`     | `false`      | Use stratified Latin Hypercube Sampling (LHS) instead of pseudo-random sampling.                                                                                                                                   |
| `--engine <engine>`  | `wasm \| js`  | `"wasm"`     | Simulation kernel (`wasm` uses the zero-allocation WebAssembly arena solver).                                                                                                                                      |
| `--format <fmt>`     | `csv \| json` | `"json"`     | Output format for ensemble quantiles (mean, std, P5, P50, P95) and trajectories.                                                                                                                                   |
| `--output <string>`  | `string`      | `stdout`     | File path to write the ensemble results.                                                                                                                                                                           |

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

```bash
msx csg <name> <paths...>
```

---

## Linting, Formatting, Diffing & Compiler Inspection

### `lint`

Executes the static analysis pipeline (WASM GLR parse validation, CST lint rules, Salsa semantic queries, unit checking, and control-flow analysis) across one or more files or directories.

```bash
msx lint <path> [paths...] [options]
```

| Option                    | Type               | Default                    | Description                                                                                                                      |
| :------------------------ | :----------------- | :------------------------- | :------------------------------------------------------------------------------------------------------------------------------- |
| `-l, --language <string>` | `string`           | Auto-detected by extension | Force a specific language linter (`modelica`, `sysml2`, `modelscript`, `pscad`, `scad`, `ssp`, `csv`).                           |
| `-f, --format <fmt>`      | `terminal \| json` | `"terminal"`               | Diagnostic output format (`terminal` renders source snippets with ANSI underlines; `json` outputs structured diagnostic arrays). |

```bash
# Lint an entire polyglot workspace and emit JSON for CI processing
msx lint ./models ./requirements --format json
```

---

### `parse`

Parses a file using its registered native WebAssembly GLR parser (`parser.wasm`) and prints the concrete syntax tree (CST), node byte offsets, or parse errors.

```bash
msx parse <file> [options]
```

| Option                    | Type      | Default       | Description                                                                 |
| :------------------------ | :-------- | :------------ | :-------------------------------------------------------------------------- |
| `-l, --language <string>` | `string`  | Auto-detected | Language ID override.                                                       |
| `--json`                  | `boolean` | `false`       | Emit the CST as a structured JSON tree instead of an indented S-expression. |
| `--cst`                   | `boolean` | `false`       | Include trivia tokens (whitespace and comments) from the linear CST buffer. |

---

### `format`

Formats source files canonically using the grammar's CST-preserving pretty-printer while preserving comments and annotations.

```bash
msx format <files...> [options]
```

| Option                    | Type      | Default       | Description                                                                 |
| :------------------------ | :-------- | :------------ | :-------------------------------------------------------------------------- |
| `-w, --write`             | `boolean` | `false`       | Overwrite files in-place with formatted output.                             |
| `-c, --check`             | `boolean` | `false`       | Exit with code `1` if any file is not canonically formatted (ideal for CI). |
| `-l, --language <string>` | `string`  | Auto-detected | Override language grammar.                                                  |

---

### `unparse`

Parses a source file into linear CST memory and unparses it back into text to verify lossless round-trip grammar rules.

```bash
msx unparse <file> [options]
```

| Option                    | Type     | Default       | Description                      |
| :------------------------ | :------- | :------------ | :------------------------------- |
| `-l, --language <string>` | `string` | Auto-detected | Override language grammar.       |
| `-o, --output <string>`   | `string` | `stdout`      | Write unparsed source to a file. |

---

### `diff`

Computes a structural CST/AST and semantic DAE comparison between two files (`oldFile` and `newFile`), identifying added/removed components, modified parameter bindings, and altered equations regardless of whitespace formatting.

```bash
msx diff <oldFile> <newFile> [options]
```

| Option               | Type                           | Default      | Description                                                    |
| :------------------- | :----------------------------- | :----------- | :------------------------------------------------------------- |
| `-f, --format <fmt>` | `terminal \| json \| markdown` | `"terminal"` | Output format for structural change hunks.                     |
| `--semantic`         | `boolean`                      | `true`       | Include flattened DAE variable and equation parity comparison. |

---

### `pr-diff`

Generates visual schematic/architectural diffs (highlighting added components in green, modified in amber, and deleted in red) and PR review summaries between two Git revisions.

```bash
msx pr-diff [file] [options]
```

| Option                | Type                                                          | Default               | Description                                                                                          |
| :-------------------- | :------------------------------------------------------------ | :-------------------- | :--------------------------------------------------------------------------------------------------- |
| `-b, --base <ref>`    | `string`                                                      | `"HEAD~1"`            | Base Git revision, branch, or commit SHA.                                                            |
| `-h, --head <ref>`    | `string`                                                      | Working tree / `HEAD` | Target head Git revision.                                                                            |
| `-f, --format <fmt>`  | `visual-html \| visual-svg \| pr-comment \| json \| terminal` | `"visual-html"`       | Diff output format (`pr-comment` generates GitHub/GitLab Markdown with embedded Mermaid/SVG tables). |
| `-v, --view <view>`   | `All \| BDD \| IBD \| StateMachine`                           | `"All"`               | Architectural diagram view to diff.                                                                  |
| `-o, --output <path>` | `string`                                                      | `stdout`              | Output file path.                                                                                    |
| `--breaking-only`     | `boolean`                                                     | `false`               | Filter report to breaking interface, port, or contract changes only.                                 |
| `--open`              | `boolean`                                                     | `false`               | Automatically open the generated HTML report in the default browser.                                 |

---

### `i18n`

Extracts translatable descriptions, documentation strings, and identifier aliases from models (`extract`), compiles translation catalogs (`compile`), or translates a model into a target locale (`translate`).

```bash
msx i18n <extract|compile|translate> <files...> [options]
```

| Option                  | Type     | Default  | Description                                                       |
| :---------------------- | :------- | :------- | :---------------------------------------------------------------- |
| `--locale <string>`     | `string` | `"en"`   | Target ISO locale code (e.g., `de`, `fr`, `ja`, `zh-CN`).         |
| `-o, --output <string>` | `string` | `stdout` | Output catalog or translated source file path.                    |
| `--catalog <string>`    | `string` | Unset    | Path to the JSON/PO translation catalog when running `translate`. |

---

## Formal Verification, Safety & Test Synthesis

### `verify`

Verifies formal contracts, `assert()` invariants, and SysML v2 requirement constraints using Bounded Model Checking (BMC), $k$-induction, IC3/Property-Directed Reachability (PDR), and Z3 SMT solving. Also emits standardized CI/CD and regulatory compliance reports.

```bash
msx verify <paths...> [options]
```

| Option                  | Type                                                | Default         | Description                                                                                                                   |
| :---------------------- | :-------------------------------------------------- | :-------------- | :---------------------------------------------------------------------------------------------------------------------------- |
| `-m, --model <name>`    | `string`                                            | Top-level model | Target model or requirement definition FQN to verify.                                                                         |
| `-e, --engine <engine>` | `bmc \| kind \| ic3 \| smt \| all`                  | `"all"`         | Verification engine (`bmc` bounded unrolling, `kind` $k$-induction, `ic3` PDR invariant synthesis, `smt` inductive Z3 check). |
| `-k, --bound <number>`  | `number`                                            | `20`            | Maximum discrete step bound $k$ for BMC and $k$-induction.                                                                    |
| `--dt <number>`         | `number`                                            | `0.01`          | Discretization time step $\Delta t$ for continuous DAE unrolling.                                                             |
| `-f, --format <fmt>`    | `terminal \| json \| sarif \| junit \| ctrf \| dhf` | `"terminal"`    | Output format (`sarif` v2.1.0 for GitHub Code Scanning, `junit` XML, `ctrf` JSON, or `dhf` Markdown compliance dossier).      |
| `-r, --report <path>`   | `string`                                            | `stdout`        | File path to write the formatted verification report.                                                                         |
| `--witness`             | `boolean`                                           | `true`          | Emit concrete counterexample state traces when a property is falsified.                                                       |

```bash
# Run k-induction and emit a GitHub Code Scanning SARIF report
msx verify BrakingController brake.mo --engine kind --bound 50 --format sarif --report results.sarif
```

---

### `falsify`

Performs optimization-guided falsification of Signal Temporal Logic (STL) safety properties ($\square_{[a,b]} \phi$, $\lozenge_{[a,b]} \phi$, $\phi_1 \mathcal{U}_{[a,b]} \phi_2$) by searching disturbance and parameter spaces to minimize quantitative robustness $\rho(\phi, \mathbf{x}, t) < 0$.

```bash
msx falsify <name> <paths...> [options]
```

| Option                 | Type     | Default      | Description                                                                                                |
| :--------------------- | :------- | :----------- | :--------------------------------------------------------------------------------------------------------- |
| `--stl <formula>`      | `string` | **Required** | Signal Temporal Logic formula (e.g., `"G[0,10](speed < 35.0 and temp < 120.0)"`).                          |
| `--params <string>`    | `string` | **Required** | Search bounds for uncertain parameters/inputs (`p1:min:max,p2:min:max`).                                   |
| `--budget <number>`    | `number` | `200`        | Maximum number of simulation rollouts for the CMA-ES / simulated annealing optimizer.                      |
| `--stop-time <number>` | `number` | `10.0`       | Simulation horizon $t_f$.                                                                                  |
| `--seed <number>`      | `number` | Random       | PRNG seed for reproducible falsification search.                                                           |
| `-o, --output <path>`  | `string` | `stdout`     | Output JSON file containing minimum robustness $\rho_{\min}$ and the falsifying counterexample trajectory. |

---

### `export-formal`

Translates a flattened Modelica DAE or state machine into external formal verification and theorem-proving languages.

```bash
msx export-formal <name> <paths...> [options]
```

| Option                | Type                                         | Default  | Description                                                                                                                                                             |
| :-------------------- | :------------------------------------------- | :------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-f, --format <fmt>`  | `smt2 \| lustre \| nusmv \| tla \| keymaera` | `"smt2"` | Target formal specification language: SMT-LIB v2 (`.smt2`), Lustre v6 (`.lus`), NuSMV/nuXmv (`.smv`), TLA+ (`.tla`), or KeYmaera X differential dynamic logic (`.kyx`). |
| `--dt <number>`       | `number`                                     | `0.01`   | Discretization step size $\Delta t$ when encoding continuous ODEs as transition systems (`smt2`, `lustre`, `nusmv`, `tla`).                                             |
| `-o, --output <path>` | `string`                                     | `stdout` | Output file path.                                                                                                                                                       |

```bash
# Export a hybrid cyber-physical controller to KeYmaera X dL format
msx export-formal ACC_Controller acc.mo --format keymaera -o proofs/acc_safety.kyx
```

---

### `verify-decisions`

Evaluates Architectural Decision Records (ADRs) and SysML v2 trade-study constraints against flattened simulation parameters and formal bounds.

```bash
msx verify-decisions <paths...> [options]
```

| Option               | Type                           | Default      | Description                                                                                   |
| :------------------- | :----------------------------- | :----------- | :-------------------------------------------------------------------------------------------- |
| `-f, --format <fmt>` | `terminal \| json \| markdown` | `"terminal"` | Output format for decision verification status.                                               |
| `--strict`           | `boolean`                      | `false`      | Fail with exit code `1` if any architectural decision lacks a linked verification constraint. |

---

### `decompose`

Performs structural subsystem partitioning and Assume-Guarantee ($A/G$) contract decomposition across large system models, checking whether top-level system guarantees follow compositionally from subsystem contracts ($\bigwedge_i (A_i \Rightarrow G_i) \vdash G_{\text{sys}}$).

```bash
msx decompose <name> <paths...> [options]
```

| Option                | Type                           | Default       | Description                                                                                                               |
| :-------------------- | :----------------------------- | :------------ | :------------------------------------------------------------------------------------------------------------------------ |
| `--strategy <mode>`   | `scc \| spectral \| contracts` | `"contracts"` | Decomposition algorithm (strongly connected components, spectral graph min-cut, or assume-guarantee contract boundaries). |
| `-f, --format <fmt>`  | `terminal \| json \| dot`      | `"terminal"`  | Output format (`dot` emits Graphviz subsystem dependency graphs).                                                         |
| `-o, --output <path>` | `string`                       | `stdout`      | Output file path.                                                                                                         |

---

### `generate-tests`

Synthesizes deterministic test vectors and stimulus harnesses from model guard conditions and assertions to achieve Modified Condition/Decision Coverage (MC/DC) and boundary-value coverage.

```bash
msx generate-tests <name> <paths...> [options]
```

| Option                   | Type                                | Default  | Description                                                                                                                                               |
| :----------------------- | :---------------------------------- | :------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--coverage <criterion>` | `branch \| mcdc \| boundary`        | `"mcdc"` | Coverage criterion solved via SMT constraint generation.                                                                                                  |
| `-f, --format <fmt>`     | `json \| csv \| modelica \| vitest` | `"json"` | Output format (`modelica` generates a standalone verification `model` with `CombiTimeTable` stimuli; `vitest` emits an executable TypeScript test suite). |
| `-o, --output <path>`    | `string`                            | `stdout` | Output file path.                                                                                                                                         |

---

## Polyglot Digital Thread, Co-Simulation & Standards Interop

### `render`

Renders headless, publication-grade SVG diagrams for Modelica component icons/schematics, SysML v2 architectural views, and PSCAD Single-Line Diagrams (SLDs) using `@modelscript/diagram`.

```bash
msx render <name> [paths..] [options]
```

| Option                | Type                                                                             | Default       | Description                                                                                              |
| :-------------------- | :------------------------------------------------------------------------------- | :------------ | :------------------------------------------------------------------------------------------------------- |
| `-i, --icon`          | `boolean`                                                                        | `false`       | Render the Modelica `Icon(...)` coordinate graphics layer instead of the `Diagram(...)` schematic layer. |
| `-v, --view <view>`   | `All \| BDD \| IBD \| StateMachine \| Activity \| SLD \| Taxonomy \| Properties` | Auto-selected | Diagram view kind for SysML v2, OWL2 ontologies, or PSCAD power networks.                                |
| `-t, --theme <theme>` | `light \| dark \| blueprint`                                                     | `"light"`     | Color palette and automatic dark-mode contrast inversion preset.                                         |
| `-o, --output <path>` | `string`                                                                         | `stdout`      | Output `.svg` file path.                                                                                 |

```bash
# Render a SysML v2 Internal Block Diagram in blueprint theme
msx render SpacecraftPower spacecraft.sysml --view IBD --theme blueprint -o docs/ibd.svg
```

---

### `fmu`

Exports a Modelica class as a Functional Mock-up Unit (`.fmu` ZIP archive) compliant with **FMI 2.0** and/or **FMI 3.0** for Model Exchange (`me`) and Co-Simulation (`cs`), or imports/inspects an existing `.fmu` via `msx fmu import <file.fmu>`. `export-fmu` is an alias for `fmu`.

```bash
msx fmu <name> <paths..> [options]
msx export-fmu <name> <paths..> [options]
msx fmu import <path.fmu> [options]
```

| Option                      | Type                           | Default           | Description                                                                                                                                                           |
| :-------------------------- | :----------------------------- | :---------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-o, --output <path>`       | `string`                       | `<name>.fmu`      | Output `.fmu` file path (or output `.mo` wrapper path when running `fmu import`).                                                                                     |
| `--fmi-version <ver>`       | `2 \| 3 \| both`               | `"both"`          | FMI standard version (`2` emits FMI 2.0 `modelDescription.xml`; `3` emits FMI 3.0 with multidimensional arrays and clocks; `both` bundles multi-version descriptors). |
| `--type <kind>`             | `me \| cs \| both`             | `"both"`          | FMU interface kind: Model Exchange (`me`), Co-Simulation (`cs`), or `both`.                                                                                           |
| `--target <runtime>`        | `wasm \| c \| js \| all`       | `"all"`           | Compiled binary/source payloads packaged inside `binaries/` and `sources/`.                                                                                           |
| `--source`                  | `boolean`                      | `true`            | Include standalone ANSI C99 source code (`sources/*.c`) inside the FMU archive.                                                                                       |
| `--compile`                 | `boolean`                      | `false`           | Invoke the host C compiler (`cc`/`clang`/`gcc`) to build native shared libraries (`.so`/`.dylib`/`.dll`) inside `binaries/`.                                          |
| `--wasm`                    | `boolean`                      | `false`           | Compile and bundle a self-contained WebAssembly module (`binaries/wasm32-wasi/<name>.wasm`).                                                                          |
| `--xml-only`                | `boolean`                      | `false`           | Emit only the `modelDescription.xml` manifest without packaging a `.fmu` archive.                                                                                     |
| `--description <string>`    | `string`                       | Model description | Override the `description` attribute in `modelDescription.xml`.                                                                                                       |
| `--start-time <number>`     | `number`                       | `0.0`             | Default experiment `startTime` in `modelDescription.xml`.                                                                                                             |
| `--stop-time <number>`      | `number`                       | `1.0`             | Default experiment `stopTime` in `modelDescription.xml`.                                                                                                              |
| `--step-size <number>`      | `number`                       | `0.001`           | Default Co-Simulation communication `stepSize` in `modelDescription.xml`.                                                                                             |
| `-F, --flattener <backend>` | `ts \| wasm \| hybrid \| diff` | `"hybrid"`        | Flattener backend used during compilation.                                                                                                                            |
| `--timing`                  | `boolean`                      | `false`           | Print FMU codegen and packaging timing.                                                                                                                               |

```bash
# Export an FMI 3.0 Co-Simulation FMU with embedded C sources and WebAssembly binary
msx fmu DC_Motor motor.mo --fmi-version 3 --type cs --wasm --output build/DC_Motor.fmu
```

---

### `import-fmu`

Unpacks an external FMI 2.0 or FMI 3.0 `.fmu` archive, parses its `modelDescription.xml`, and generates a strongly typed Modelica wrapper `block` (and optional SSP system binding) so the FMU can be connected and simulated inside ModelScript. `fmu-import` is an alias for `import-fmu`.

```bash
msx import-fmu <fmuPath> [options]
msx fmu-import <fmuPath> [options]
```

| Option                 | Type     | Default               | Description                                               |
| :--------------------- | :------- | :-------------------- | :-------------------------------------------------------- |
| `-o, --output <path>`  | `string` | `<modelName>.mo`      | Output path for the generated Modelica wrapper file.      |
| `--extract-dir <path>` | `string` | `./.fmu_cache/<name>` | Directory where FMU binaries and resources are extracted. |

---

### `cosim`

Manages distributed FMI/SSP Co-Simulation master orchestration sessions, participant FMUs, recorded trajectory histories, and adaptive communication step-size optimization against the ModelScript Hub / Co-Simulation service.

```bash
msx cosim <subcommand> [args...] [options]
```

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

```bash
msx pscad <action> [files...] [options]
```

| Action            | Description                                                                                                                                                                                                      |
| :---------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lint`            | Validate `.pscx`/`.pswx` schematics against electrical EMT rules (`M6001`–`M6011`, including floating nodes, transformer winding ratios, CSMF unconnected inputs, and traveling-wave line $\Delta t$ underflow). |
| `diagram`         | Render a publication-quality SVG Single-Line Diagram (SLD) from a `.pscx` project.                                                                                                                               |
| `diff`            | Compute a topological and parameter diff between two `.pscx` revisions.                                                                                                                                          |
| `sim`             | Execute a fixed-step nodal admittance ($\mathbf{G}\mathbf{v}(t) = \mathbf{i}_{\text{hist}}(t - \Delta t)$) EMT simulation.                                                                                       |
| `verify-ieee2800` | Run automated **IEEE Std 2800-2022** Inverter-Based Resource (IBR) compliance checks (Low/High Voltage Ride-Through LVRT/HVRT, frequency ride-through, and reactive current injection step response).            |
| `export-modelica` | Translate a `.pscx` schematic into an equivalent Modelica `.mo` model using `Modelica.Electrical`.                                                                                                               |
| `export-ssp`      | Package a `.pswx` multi-project workspace into an SSP 1.0 `.ssp` architecture container.                                                                                                                         |

| Option             | Type     | Default  | Description                                                                                      |
| :----------------- | :------- | :------- | :----------------------------------------------------------------------------------------------- |
| `-o, --out <path>` | `string` | `stdout` | Output file path for diagrams, trajectories, compliance reports, or exported `.mo`/`.ssp` files. |
| `--tstop <number>` | `number` | `1.0`    | EMT simulation stop time in seconds (for `sim` and `verify-ieee2800`).                           |
| `--step <string>`  | `string` | `"20us"` | EMT integration step size (e.g., `"10us"`, `"50us"`).                                            |

```bash
# Verify IEEE 2800-2022 LVRT/HVRT compliance on a solar plant PSCAD case
msx pscad verify-ieee2800 SolarPlant_250MW.pscx --tstop 3.0 --step 20us -o ieee2800_report.json
```

---

### `polyglot`

Queries the unified multi-language `WorkspaceIndex`, verifies cross-domain traceability links (`@satisfies`, `@verifies`, `@allocates`), inspects digital threads, and monitors operational digital twin drift across all 12 supported languages.

```bash
msx polyglot <subcommand> [path] [options]
```

| Subcommand          | Description                                                                                                                                                                                 |
| :------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `project [dir]`     | Summarize all indexed languages, files, symbols, and cross-language bindings in a workspace.                                                                                                |
| `verify [dir]`      | Verify cross-language dimensional consistency, port types, requirement satisfaction, and digital thread integrity.                                                                          |
| `thread <symbol>`   | Trace the upstream/downstream polyglot digital thread for a symbol (from OWL2 ontology $\to$ SysML v2 requirement $\to$ Modelica equation $\to$ STEP CAD geometry $\to$ ReqIF/DHF dossier). |
| `query <expr>`      | Execute a cross-language symbol or FLWOR query against the unified `WorkspaceIndex`.                                                                                                        |
| `check-twins [dir]` | Compare live telemetry streams or CSV logs against nominal model predictions to detect parameter drift and anomalies.                                                                       |
| `index [dir]`       | Build and serialize the workspace-wide polyglot symbol and dependency index (`polyglot-index.json`).                                                                                        |

| Option                | Type                                 | Default      | Description                                               |
| :-------------------- | :----------------------------------- | :----------- | :-------------------------------------------------------- |
| `-f, --format <fmt>`  | `terminal \| json \| dot \| mermaid` | `"terminal"` | Output format for thread graphs and verification reports. |
| `-o, --output <path>` | `string`                             | `stdout`     | Output file path.                                         |

---

### `align`

Executes the Triple Graph Grammar (TGG) and Critical Pair Analysis (CPA) bidirectional synchronization engine across paired architectural, physical, and geometric models.

```bash
msx align <sourceFile> <targetFile> [options]
```

| Option                | Type                                                            | Default              | Description                                                                                                                                                                          |
| :-------------------- | :-------------------------------------------------------------- | :------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--corr <path>`       | `string`                                                        | Auto-derived         | Path to the `.corr.json` correspondence graph file tracking persistent element links.                                                                                                |
| `--direction <dir>`   | `forward \| backward \| sync \| check`                          | `"check"`            | TGG execution mode (`check` reports drift/conflicts; `forward` propagates source $\to$ target; `backward` propagates target $\to$ source; `sync` reconciles non-conflicting deltas). |
| `--strategy <mode>`   | `source-wins \| target-wins \| interactive \| fail-on-conflict` | `"fail-on-conflict"` | Conflict resolution policy when Critical Pair Analysis detects overlapping edits.                                                                                                    |
| `-o, --output <path>` | `string`                                                        | In-place / `stdout`  | Output path for the synchronized target model or diagnostic report.                                                                                                                  |

---

### `sysml`

Provides dedicated interoperability workflows between **OMG SysML v2** (`.sysml`) and **Modelica** (`.mo`) models.

```bash
msx sysml <export|import|check|info|sync> <files...> [options]
```

| Subcommand                    | Description                                                                                                                      |
| :---------------------------- | :------------------------------------------------------------------------------------------------------------------------------- |
| `export <file.mo>`            | Project a Modelica class hierarchy into a SysML v2 `.sysml` `part def` / `port def` / `connection` architecture model.           |
| `import <file.sysml>`         | Synthesize executable Modelica `.mo` skeleton classes, connectors, and `connect()` equations from a SysML v2 file.               |
| `check <files...>`            | Validate SysML v2 $\leftrightarrow$ Modelica port compatibility, KerML quantity units, and `@satisfies` requirement constraints. |
| `info <file.sysml>`           | Print package metrics (part definitions, ports, state machines, requirements, and constraint blocks).                            |
| `sync <file.sysml> <file.mo>` | Synchronize structural changes and parameter values bi-directionally between `.sysml` and `.mo` files.                           |

| Option                | Type               | Default      | Description                                         |
| :-------------------- | :----------------- | :----------- | :-------------------------------------------------- |
| `-o, --output <path>` | `string`           | `stdout`     | Output file path for `export`, `import`, or `sync`. |
| `-f, --format <fmt>`  | `terminal \| json` | `"terminal"` | Output format for `check` and `info`.               |

---

### `oslc`

Exposes workspace models and requirements as **OASIS OSLC 3.0** Linked Data resources (Requirements Management `oslc_rm` and Architecture Management `oslc_am`) with **TRS 3.0** (Tracked Resource Set) changelog feeds for IBM DOORS Next, Polarion, and Jira integration.

```bash
msx oslc <export|serve> [path] [options]
```

| Subcommand      | Description                                                                                                    |
| :-------------- | :------------------------------------------------------------------------------------------------------------- |
| `export [path]` | Serialize workspace symbols, requirements, and traceability links as static OSLC 3.0 RDF documents.            |
| `serve [path]`  | Start an HTTP OSLC 3.0 Service Provider catalog, delegated UI preview server, and TRS 3.0 change log endpoint. |

| Option                | Type                         | Default                        | Description                                                                                |
| :-------------------- | :--------------------------- | :----------------------------- | :----------------------------------------------------------------------------------------- |
| `-f, --format <fmt>`  | `turtle \| jsonld \| rdfxml` | `"turtle"`                     | RDF serialization format (`text/turtle`, `application/ld+json`, or `application/rdf+xml`). |
| `-p, --port <number>` | `number`                     | `3080`                         | Listening TCP port when running `msx oslc serve`.                                          |
| `--base-uri <uri>`    | `string`                     | `"http://localhost:3080/oslc"` | Base URI prefix minted for OSLC resource IRIs.                                             |
| `-o, --output <path>` | `string`                     | `stdout`                       | Output file path when running `msx oslc export`.                                           |

---

### `reqif`

Imports and exports **OMG ReqIF 1.2** (Requirements Interchange Format `.reqif` XML and `.reqifz` archives), translating specification hierarchies and attributes directly to and from SysML v2 `requirement def` blocks.

```bash
msx reqif <import|export> <file> [options]
```

| Option                | Type      | Default  | Description                                                                            |
| :-------------------- | :-------- | :------- | :------------------------------------------------------------------------------------- |
| `-o, --output <path>` | `string`  | `stdout` | Target `.sysml` file path (on `import`) or `.reqif`/`.reqifz` path (on `export`).      |
| `--archive`           | `boolean` | `false`  | Package exported ReqIF XML and embedded SVG diagrams as a compressed `.reqifz` bundle. |

---

### `ddp`

Inspects, packs, and converts **ISO/PAS 81346** Digital Data Packages (`.ddp`) and **IDTA Asset Administration Shell (AAS v3.0)** packages (`.aasx`) for industrial digital twin handover.

```bash
msx ddp <inspect|pack|to-aasx> <target> [options]
```

| Subcommand           | Description                                                                                                                                          |
| :------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inspect <file.ddp>` | Validate and list reference designations (`=`, `+`, `-` aspect trees), models, and documents inside a `.ddp` archive.                                |
| `pack <dir>`         | Bundle a workspace directory into a signed ISO/PAS 81346 `.ddp` archive.                                                                             |
| `to-aasx <file.ddp>` | Convert a `.ddp` package or workspace manifest into an IDTA AAS v3.0 `.aasx` Digital Twin package with TechnicalData and SimulationModels submodels. |

| Option                | Type     | Default                      | Description          |
| :-------------------- | :------- | :--------------------------- | :------------------- |
| `-o, --output <path>` | `string` | `<name>.ddp` / `<name>.aasx` | Output archive path. |

---

### `dhf`

Generates, inspects, and cryptographically audits **Design History File (DHF)** compliance dossiers structured for **FDA 21 CFR Part 820.30**, **ISO 13485**, **ISO 26262**, and **DO-178C** regulatory submissions.

```bash
msx dhf <export|status|audit> [path] [options]
```

| Subcommand      | Description                                                                                                                                         |
| :-------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------- |
| `export [path]` | Compile requirements traceability matrices (RTM), formal verification proofs, simulation summaries, and SHA-256 artifact hashes into a DHF dossier. |
| `status [path]` | Report requirement verification coverage, unverified hazards, and suspect links across the workspace.                                               |
| `audit [file]`  | Verify the cryptographic SHA-256 hash chain and Ed25519 signatures of an exported DHF bundle.                                                       |

---

### `simulink`

Inspects, lints, compiles into linear DAEs, and projects MATLAB Simulink control block diagrams (`.slx` zip packages and `.mdl` structured text).

```bash
msx simulink <action> [files...] [options]
```

| Action        | Description                                                                                                        |
| :------------ | :----------------------------------------------------------------------------------------------------------------- |
| `inspect`     | Dump subsystem block tree, parameters, solver settings, and line routing.                                          |
| `lint`        | Run pre-flight static analysis (algebraic loops `M7202`, unconnected ports `M7201`, divide-by-zero risks `M7209`). |
| `to-modelica` | Translate block diagram into standard acausal `Modelica.Blocks` models.                                            |
| `to-dae`      | Lower continuous states and transfer functions directly into the WebAssembly DAE arena.                            |

| Option         | Type     | Default  | Description                                   |
| :------------- | :------- | :------- | :-------------------------------------------- |
| `--out <path>` | `string` | `stdout` | Target file path for generated Modelica code. |

```bash
msx simulink inspect CruiseControl.slx
msx simulink lint EngineGovernor.mdl
msx simulink to-modelica Suspension.slx --out=Suspension.mo
```

---

### `autosar`

Inspects, lints, projects, and simulates AUTOSAR Classic and Adaptive (`.arxml`) software component architectures and Virtual Run-Time Environment (RTE) runnables.

```bash
msx autosar <action> [files...] [options]
```

| Action         | Description                                                                                                                           |
| :------------- | :------------------------------------------------------------------------------------------------------------------------------------ |
| `inspect`      | Inspect software component types, port prototypes, runnables, timing events, and network PDUs.                                        |
| `lint`         | Detect unconnected R-ports (`M7401`), interface mismatches (`M7402`), WCET budget overflows (`M7405`), and PDU bit overlap (`M7406`). |
| `to-modelica`  | Generate Modelica standard interface blocks for SIL plant co-simulation.                                                              |
| `to-sysml`     | Project software architecture into OMG SysML v2 `part def` hierarchies.                                                               |
| `to-dae`       | Lower software states and calibrated parameters into ModelScript linear-memory DAE arena.                                             |
| `simulate-rte` | Execute the discrete event Virtual RTE scheduler and route signals across assembly connectors.                                        |

| Option             | Type     | Default  | Description                                                |
| :----------------- | :------- | :------- | :--------------------------------------------------------- |
| `--duration <sec>` | `number` | `0.05`   | Simulation time window for Virtual RTE execution.          |
| `--step <sec>`     | `number` | `0.01`   | Communication macro-step size for RTE runnable scheduling. |
| `--out <path>`     | `string` | `stdout` | Target file path for generated code or execution logs.     |

```bash
msx autosar inspect Powertrain.arxml
msx autosar lint BrakeController.arxml
msx autosar to-sysml Steering.arxml --out=Steering.sysml
msx autosar simulate-rte PowertrainSystem.arxml --duration=0.5 --step=0.01 --out=rte_trace.json
```

---

### `olga`

Provides complete command-line tooling for Schlumberger **OLGA** transient multiphase flow models (`.opi`, `.key`, `.genkey`, `.tab`, `.tpl`, `.ppl`), including drift-flux hydrodynamic simulation, severe slugging analysis, PVT flash, autonomous history matching, and flow assurance verification.

```bash
msx olga <action> [files...] [options]
```

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

| Option                    | Type      | Default  | Description                                                          |
| :------------------------ | :-------- | :------- | :------------------------------------------------------------------- |
| `--duration <sec>`        | `number`  | `60.0`   | Transient simulation duration.                                       |
| `--dt <sec>`              | `number`  | `1.0`    | Numerical integration time step.                                     |
| `--out <path>`            | `string`  | `stdout` | Output file for trajectory CSV, diagrams, reports, or models.        |
| `--checkpoint-out <path>` | `string`  | —        | Save simulation state snapshot for zero-discontinuity warm restart.  |
| `--restart <path>`        | `string`  | —        | Resume transient simulation from checkpoint file.                    |
| `--anti-slug`             | `boolean` | `false`  | Enable active topside choke feedback controller for slug mitigation. |

```bash
msx olga simulate subsea_tieback.opi --duration=3600 --out=traj.csv
msx olga lint deepwater_riser.genkey
msx olga diagram tieback.opi --view=profile --out=profile.svg
msx olga flash --comp="C1:0.75,C2:0.10,C3:0.08,nC4:0.04,C7:0.03" --p=50 --t=295.15 --envelope
```

---

### `simpack`

Tooling for Dassault Systèmes **SIMPACK** multibody dynamics (`.spck` XML and `.sim` ASCII decks), including Grübler mobility analysis, 3D kinematic joint evaluation, Berg elastomeric bushings, and Craig-Bampton flexible body lowering.

```bash
msx simpack <action> [files...] [options]
```

| Action        | Description                                                                                      |
| :------------ | :----------------------------------------------------------------------------------------------- |
| `inspect`     | Dump rigid bodies, joint markers, degrees of freedom, and force elements.                        |
| `lint`        | Check for dangling marker references, kinematic loops, and parameter inconsistencies.            |
| `mobility`    | Calculate mechanism spatial degrees of freedom ($M = 6n - \sum c_i$) and detect overconstraints. |
| `to-modelica` | Project mechanism into standard `Modelica.Mechanics.MultiBody` components.                       |
| `to-fmu`      | Package complete multibody assembly as an FMI 2.0/3.0 Co-Simulation FMU.                         |
| `to-dae`      | Lower 3D kinematics with Baumgarte / GGL index reduction into `DAEBuilder` arena.                |

```bash
msx simpack inspect DoubleWishbone.spck
msx simpack mobility Suspension.spck
msx simpack to-modelica Mechanism.sim --out=Mechanism.mo
```

---

### `gensys`

Tooling for **GENSYS** railway vehicle dynamics (`.calc`, `.geom`, `.track`), including FASTSIM wheel-rail contact mechanics, Polach non-linear creep, ERRI B176 track irregularities, Sperling ride comfort, and **EN 14363 / UIC 518** running safety homologation.

```bash
msx gensys <action> [files...] [options]
```

| Action           | Description                                                                                           |
| :--------------- | :---------------------------------------------------------------------------------------------------- |
| `inspect`        | Inspect vehicle masses, suspension spring-dampers, and wheelset configurations.                       |
| `lint`           | Validate vehicle inertial and geometric parameters against railway engineering rules.                 |
| `fastsim`        | Evaluate high-throughput Hertzian/FASTSIM wheel-rail tangential contact creep forces.                 |
| `verify-en14363` | Run 2.0 m sliding window wheel climb derailment ($Y/Q \le 0.80$) and Prud'homme lateral limit checks. |
| `comfort`        | Compute ISO 2631-1 frequency-weighted comfort ($W_k, W_d$) and Sperling index ($W_z$).                |
| `to-dae`         | Lower vehicle multibody suspension and contact dynamics into `DAEBuilder` arena.                      |

```bash
msx gensys inspect ManchesterBenchmark.calc
msx gensys verify-en14363 ManchesterBenchmark.calc --out=homologation.html
msx gensys comfort HighSpeedTrain.calc --speed=250 --track=ERRI_HighQuality
```

---

### `spice`

Analog circuit simulation and netlist analysis for **SPICE** (`.cir`, `.sp`, `.net`, `.lib`), including DC operating point (`.OP`), transient analysis (`.TRAN`), AC frequency sweeps (`.AC`), and ECAD graph generation.

```bash
msx spice <action> [files...] [options]
```

| Action        | Description                                                                                                      |
| :------------ | :--------------------------------------------------------------------------------------------------------------- |
| `inspect`     | List circuit components, nodes, subcircuits, and simulation directives.                                          |
| `lint`        | Check for floating electrical nodes (`M7101`), ideal voltage source loops (`M7102`), and current source cutsets. |
| `op`          | Calculate DC operating point node voltages and branch currents.                                                  |
| `tran`        | Execute time-domain transient simulation with numerical companion circuits.                                      |
| `ac`          | Run small-signal frequency domain analysis and compute bode plots.                                               |
| `to-modelica` | Project netlist into standard `Modelica.Electrical.Analog` components.                                           |
| `to-dae`      | Lower circuit equations into ModelScript linear-memory DAE arena.                                                |

| Option           | Type     | Default  | Description                                               |
| :--------------- | :------- | :------- | :-------------------------------------------------------- |
| `--stop <sec>`   | `number` | `0.01`   | Transient simulation duration.                            |
| `--step <sec>`   | `number` | `1e-5`   | Transient simulation time step.                           |
| `--fstart <hz>`  | `number` | `10.0`   | AC sweep start frequency.                                 |
| `--fstop <hz>`   | `number` | `1e6`    | AC sweep stop frequency.                                  |
| `--points <num>` | `number` | `50`     | AC sweep evaluation points per decade/interval.           |
| `--out <path>`   | `string` | `stdout` | Output file path for CSV trajectories or exported models. |

```bash
msx spice op LowPassFilter.cir
msx spice tran PowerSupply.cir --stop=0.02 --step=1e-6 --out=transient.csv
msx spice ac AudioAmplifier.sp --fstart=10 --fstop=1e5 --points=100 --out=bode.csv
```

---

### `adams`

Tooling for **MSC Adams** mechanism datasets (`.adm`) and command files (`.cmd`), including 3D Euler/Cardan kinematics, Grübler spatial mobility analysis, and cross-domain SIMPACK / Modelica projections.

```bash
msx adams <action> [files...] [options]
```

| Action        | Description                                                                                             |
| :------------ | :------------------------------------------------------------------------------------------------------ |
| `inspect`     | Inspect parts, markers, joints, forces, and initial conditions.                                         |
| `lint`        | Validate inertia tensors (`M7303`), check for dangling markers (`M7302`), and verify ground references. |
| `mobility`    | Calculate mechanism spatial degrees of freedom and overconstrained loops.                               |
| `to-simpack`  | Convert Adams mechanism dataset into SIMPACK `.spck` XML.                                               |
| `to-modelica` | Project mechanism into `Modelica.Mechanics.MultiBody` components.                                       |
| `to-dae`      | Lower kinematic momentum equations directly into `DAEBuilder` arena.                                    |

```bash
msx adams mobility FourBarLinkage.adm
msx adams lint LandingGear.adm
msx adams to-simpack RobotArm.adm --out=RobotArm.spck
```

---

### `urdf`

Robotics compiler tooling for **ROS URDF** (`.urdf`) and **Xacro** (`.xacro`) descriptions, featuring Featherstone recursive dynamics (ABA forward dynamics, RNEA inverse dynamics), joint limit verification, and 3D CAD projections.

```bash
msx urdf <action> [files...] [options]
```

| Action        | Description                                                                                          |
| :------------ | :--------------------------------------------------------------------------------------------------- |
| `inspect`     | Dump robot kinematic link tree, joint limits, total mass budget, and degrees of freedom.             |
| `lint`        | Validate kinematic tree acyclicity (`M7504`), joint limits (`M7508`), and inertia tensors (`M7506`). |
| `dynamics`    | Evaluate forward (ABA) or inverse (RNEA) dynamics at test joint coordinates.                         |
| `to-modelica` | Generate `Modelica.Mechanics.MultiBody` robotic system.                                              |
| `to-adams`    | Project robot description into MSC Adams `.adm` solver dataset.                                      |
| `to-simpack`  | Project robot description into SIMPACK `.spck` XML.                                                  |
| `to-dae`      | Lower kinematic state equations directly into `DAEBuilder` arena.                                    |

```bash
msx urdf inspect KukaIiwa14.urdf
msx urdf lint Manipulator.xacro
msx urdf to-modelica PandaArm.urdf --out=PandaArm.mo
```

---

### `easy5`

Tooling for Boeing / MSC **EASY5** dynamic models (`.ez5`, `.ezm`, `.ezd`), including linear state-space analysis, User General (UG) Fortran routines, tabular map interpolation, and Modelica/SSP projections.

```bash
msx easy5 <action> [files...] [options]
```

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

```bash
msx gtsuite <action> [files...] [options]
```

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

```bash
msx sima <action> [files...] [options]
```

| Action        | Description                                                                                  |
| :------------ | :------------------------------------------------------------------------------------------- |
| `inspect`     | Inspect marine vessels, mooring lines, catenary segments, and environmental loads.           |
| `lint`        | Check negative metacentric height (`M7001`), line underflow (`M7002`), and attachment nodes. |
| `simulate`    | Execute 6-DOF time-domain Cummins floater motion with retardation impulse response.          |
| `verify-dnv`  | Verify DNV-OS-E301 line tension safety factors and watch-circle offset limits.               |
| `to-modelica` | Project marine system into acausal Modelica physical components.                             |
| `to-dae`      | Lower hydrodynamics and mooring tension equations into `DAEBuilder` arena.                   |

---

### `rocets`

Tooling for NASA **ROCETS** liquid rocket engine transient decks (`.roc`, `.deck`, `.map`), including turbopump flow balance, CEA equilibrium combustion, supersonic nozzle expansion, and Bartz throat heat transfer.

```bash
msx rocets <action> [files...] [options]
```

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

```bash
msx psse <action> [files...] [options]
```

| Action        | Description                                                                                                            |
| :------------ | :--------------------------------------------------------------------------------------------------------------------- |
| `inspect`     | Dump bus count, generators, transmission lines, transformers, and load summary.                                        |
| `lint`        | Validate bus voltage bounds, check for isolated buses, and verify generator $P/Q$ limits.                              |
| `powerflow`   | Solve steady-state AC power flow using Full-Newton iteration on the nodal admittance matrix $\mathbf{Y}_{\text{bus}}$. |
| `to-modelica` | Project power grid into acausal Modelica transmission lines and generators.                                            |
| `to-pscad`    | Project PSS/E power network into PSCAD / EMT companion-circuit netlists.                                               |
| `to-dae`      | Lower bus injection equations and generator swing dynamics into `DAEBuilder` arena.                                    |

---

### `lps`

Tooling for Energy Solutions **PipelineStudio** gas and liquid pipeline networks (`.lps`, `.tgx`, `.tlx`, `.psg`), including AGA-8 / GERG-2008 natural gas compressibility, hydrogen blending ($H_2 \le 20\%$), open-channel slack line flow, water hammer liquid surge, and transient line pack accounting.

```bash
msx lps <action> [files...] [options]
```

| Action        | Description                                                                                        |
| :------------ | :------------------------------------------------------------------------------------------------- |
| `inspect`     | Dump pipeline pipes, compressors, pumps, delivery regulators, and receipt nodes.                   |
| `lint`        | Check for MAOP overpressure (`M8001`), compressor surge (`M8002`), and high hydrogen blend ratios. |
| `simulate`    | Run transient fluid network pressure propagation and inventory line pack calculations.             |
| `to-sysml`    | Project pipeline topology and control station hierarchies into OMG SysML v2.                       |
| `to-modelica` | Project pipe network into `Modelica.Fluid` gas/liquid transmission models.                         |
| `to-dae`      | Lower Euler gas/liquid equations directly into `DAEBuilder` arena.                                 |

---

## Language Workbench, Daemon & IDE Tooling

### `daemon`

Controls the lifecycle of the persistent background ModelScript compiler daemon (`~/.modelscript/daemon.sock`).

```bash
msx daemon <start|stop|status|restart>
```

| Subcommand | Description                                                                        |
| :--------- | :--------------------------------------------------------------------------------- |
| `start`    | Spawn the background compiler daemon if not already running.                       |
| `stop`     | Gracefully shut down the running daemon and remove its socket file.                |
| `status`   | Report whether the daemon is running, its PID, uptime, and cached workspace count. |
| `restart`  | Stop any active daemon instance and immediately start a fresh one.                 |

---

### `build`

Compiles a `@modelscript/dsl` grammar definition into a zero-dependency native WebAssembly GLR parser (`parser.wasm`) along with strongly typed TypeScript CST node definitions.

```bash
msx build [grammarFile] [options]
```

| Option                | Type      | Default    | Description                                                        |
| :-------------------- | :-------- | :--------- | :----------------------------------------------------------------- |
| `-o, --out-dir <dir>` | `string`  | `"./dist"` | Output directory for `parser.wasm` and generated `.d.ts` bindings. |
| `--optimize`          | `boolean` | `true`     | Run LR state table compaction and WASM binary size optimization.   |

---

### `generate`

Scaffolds a new WebAssembly GLR parser (`parser`) or a complete standalone VS Code language extension (`extension` including TextMate grammars, LSP wiring, and `package.json` contributions) from a `@modelscript/dsl` language definition.

```bash
msx generate <parser|extension> <grammarFile> [options]
```

| Option                | Type     | Default         | Description                                    |
| :-------------------- | :------- | :-------------- | :--------------------------------------------- |
| `-o, --out-dir <dir>` | `string` | `"./generated"` | Destination directory for generated artifacts. |

---

### `language`

Manages the dynamic polyglot language registry (`lang` is an alias for `language`).

```bash
msx language <list|register|unregister> [target]
msx lang <list|register|unregister> [target]
```

| Subcommand        | Description                                                                                                                                                               |
| :---------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `list`            | List all registered languages (`.mo`, `.sysml`, `.msx`, `.pscx`, `.scad`, `.stp`, `.owl`, `.ssp`, `.csv`, `.su2`, `.inp`, `.gbr`) and their loaded `.wasm` parser states. |
| `register <path>` | Dynamically register a custom language plugin module into `~/.modelscript/languages.json`.                                                                                |
| `unregister <id>` | Remove a dynamically registered language plugin by language ID.                                                                                                           |

---

### `lsp`

Starts the multi-language ModelScript Language Server Protocol (`@modelscript/lsp`) server.

```bash
msx lsp [options]
```

| Option            | Type      | Default | Description                                                                          |
| :---------------- | :-------- | :------ | :----------------------------------------------------------------------------------- |
| `--stdio`         | `boolean` | `true`  | Communicate over standard input/output streams.                                      |
| `--socket <port>` | `number`  | Unset   | Communicate over a local TCP socket on the specified port.                           |
| `--node-ipc`      | `boolean` | `false` | Communicate using Node.js IPC channels (used by the VS Code desktop extension host). |

---

### `playground`

Launches a local interactive web playground server for live grammar authoring, GLR parse tree visualization, Salsa query inspection, and DAE simulation.

```bash
msx playground [options]
```

| Option                | Type      | Default | Description                                                   |
| :-------------------- | :-------- | :------ | :------------------------------------------------------------ |
| `-p, --port <number>` | `number`  | `4173`  | Local HTTP port for the playground web UI.                    |
| `--open`              | `boolean` | `true`  | Automatically open the playground URL in the default browser. |

---

### `sandbox`

Executes untrusted `.msx` scripts or `.mo` simulations inside a memory-capped, capability-isolated WebAssembly sandbox with no host filesystem or network access.

```bash
msx sandbox <file> [options]
```

| Option              | Type     | Default | Description                                             |
| :------------------ | :------- | :------ | :------------------------------------------------------ |
| `--timeout <ms>`    | `number` | `5000`  | Maximum execution wall-clock timeout in milliseconds.   |
| `--max-memory <mb>` | `number` | `128`   | Maximum WebAssembly linear memory ceiling in megabytes. |

---

## Package Registry, Cloud HPC & Hub Administration

### `init`

Initializes a new `modelscript.json` package manifest in the current directory.

```bash
msx init [options]
```

| Option          | Type      | Default | Description                                                                                                  |
| :-------------- | :-------- | :------ | :----------------------------------------------------------------------------------------------------------- |
| `-y, --yes`     | `boolean` | `false` | Populate default manifest fields (`name`, `version: "0.1.0"`, `license: "MIT"`) without interactive prompts. |
| `--scope <org>` | `string`  | Unset   | Prefix package name with an organization scope (e.g., `@aerospace/flight-dynamics`).                         |

---

### `login`, `logout`, `whoami`

Manages authentication sessions against a ModelScript Registry or self-hosted Enterprise Hub. Credentials and Ed25519 signing keys are stored in `~/.modelscriptrc`.

```bash
msx login [--registry <url>] [--token <token>]
msx logout
msx whoami
```

| Option             | Type     | Default               | Description                                                                               |
| :----------------- | :------- | :-------------------- | :---------------------------------------------------------------------------------------- |
| `--registry <url>` | `string` | `MODELSCRIPT_API_URL` | Target ModelScript Hub / Registry URL.                                                    |
| `--token <token>`  | `string` | Interactive prompt    | Authenticate non-interactively using a personal access token or `ms_bot_*` service token. |

---

### `install`

Resolves semantic version constraints, verifies SHA-256 content-addressable digests and Ed25519 publisher signatures, and installs Modelica/SysML/ModelScript packages into `modelica_modules/` while updating `modelscript.lock`. Aliases: `i`, `add`.

```bash
msx install [packages...] [options]
msx i [packages...] [options]
msx add <packages...> [options]
```

| Option                | Type      | Default               | Description                                                                                                   |
| :-------------------- | :-------- | :-------------------- | :------------------------------------------------------------------------------------------------------------ |
| `--frozen-lockfile`   | `boolean` | `false`               | Fail with exit code `1` if `modelscript.lock` does not exactly match `modelscript.json` (recommended for CI). |
| `--registry <url>`    | `string`  | `MODELSCRIPT_API_URL` | Override registry URL.                                                                                        |
| `--verify-signatures` | `boolean` | `true`                | Enforce Ed25519 cryptographic signature verification on downloaded tarballs.                                  |

---

### `pack`, `publish`, `unpublish`

Packages, cryptographically signs, and publishes libraries to the ModelScript Registry.

```bash
msx pack [options]
msx publish [tarballOrDir] [options]
msx unpublish <pkg>@<version> [options]
```

| Option              | Type                   | Default                     | Description                                                                                       |
| :------------------ | :--------------------- | :-------------------------- | :------------------------------------------------------------------------------------------------ |
| `--tag <tag>`       | `string`               | `"latest"`                  | Distribution tag assigned on `publish` (e.g., `latest`, `next`, `rc`).                            |
| `--access <level>`  | `public \| restricted` | `"public"`                  | Visibility level for scoped `@org/pkg` packages.                                                  |
| `--sign-key <path>` | `string`               | `~/.modelscript/id_ed25519` | Path to the Ed25519 private key used to sign the package SHA-256 digest.                          |
| `--dry-run`         | `boolean`              | `false`                     | Validate manifest, run lint checks, and compute tarball digest without uploading to the registry. |

---

### `cloud`

Manages remote high-performance computing (HPC) simulation sweeps, Slurm batch jobs, and organization compute credit wallets on ModelScript Cloud.

```bash
msx cloud <subcommand> [args...] [options]
```

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

```bash
# Initialize Hub configuration or query cluster service health
msx hub <init|status> [--api-url <url>]

# Inspect PostgreSQL migration state, apply schema upgrades, or verify the SHA-256 audit ledger chain
msx db <status|upgrade|verify> [--connection-string <postgres://...>]

# Request, poll, or download long-term regulatory cold-storage archives
msx archive <request|status|download> <targetId> [-o <path>]
```
