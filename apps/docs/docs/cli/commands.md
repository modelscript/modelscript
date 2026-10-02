# CLI Command Reference

Comprehensive syntax, arguments, options, and usage examples for all primary `msx` subcommands.

---

## `msx flatten`

Flattens a hierarchical Modelica model into a flat Differential Algebraic Equation (DAE) system.

```bash
msx flatten <model> [paths...] [options]
```

### Options

- `--flattener <hybrid|wasm|ts|diff>`: Flattener backend (default: `hybrid`).
- `--no-fold`: Disable constant folding optimizations.
- `--no-alias`: Disable alias elimination.
- `--format <text|json>`: Output format (default: `text`).

### Example

```bash
msx flatten Modelica.Electrical.Analog.Examples.ChuaCircuit path/to/MSL
```

---

## `msx simulate`

Runs a time-domain numerical simulation of a Modelica model.

```bash
msx simulate <model> [paths...] [options]
```

### Options

- `--start-time <t>`: Initial simulation time (default: `0.0`).
- `--stop-time <t>`: Final simulation time (default: `1.0`).
- `--step-size <h>`: Fixed or initial integrator step size.
- `--solver <cvode|ida|dopri5|rk4>`: Numerical integrator (default: `cvode`).
- `--tolerance <tol>`: Relative integration tolerance (default: `1e-6`).
- `--format <csv|json|parquet>`: Trajectory output format (default: `csv`).
- `--output <file>`: Destination file for simulation results.

### Example

```bash
msx simulate BouncingBall model.mo --stop-time 10 --solver cvode --output trajectory.csv
```

---

## `msx optimize`

Solves dynamic optimal control problems via direct collocation.

```bash
msx optimize <model> [paths...] [options]
```

### Options

- `--objective <expr>`: Objective function to minimize (e.g. `"u^2"`).
- `--controls <vars>`: Comma-separated list of control variables.
- `--control-bounds <var:min:max>`: Bound limits on control inputs.
- `--stop-time <t>`: Optimization horizon.

### Example

```bash
msx optimize InvertedPendulum model.mo \
  --objective "theta^2 + 0.1*u^2" \
  --controls "u" \
  --control-bounds "u:-10:10" \
  --stop-time 5
```

---

## `msx lint`

Runs static analysis and linter rules across Modelica and polyglot source files.

```bash
msx lint [paths...] [options]
```

### Options

- `--format <text|sarif|ctrf>`: Diagnostic output format.
- `--max-warnings <n>`: Maximum warning threshold before exiting with non-zero code.

### Example

```bash
# Output SARIF format for GitHub Code Scanning
msx lint models/ --format sarif > results.sarif
```

---

## `msx render`

Renders Modelica annotations into interactive SVG diagrams.

```bash
msx render <model> [paths...] [options]
```

### Options

- `--view <diagram|icon>`: Render schematic diagram or component icon (default: `diagram`).
- `--theme <light|dark|auto>`: Color theme (default: `auto`).

### Example

```bash
msx render ChuaCircuit model.mo --view diagram > diagram.svg
```

---

## `msx fmu export`

Exports a Modelica model as a standardized Functional Mock-up Unit (FMU).

```bash
msx fmu export <model> [paths...] [options]
```

### Options

- `--version <2.0|3.0>`: FMI standard version (default: `3.0`).
- `--type <me|cs>`: Model Exchange (`me`) or Co-Simulation (`cs`).
- `--output <file.fmu>`: Destination archive path.

### Example

```bash
msx fmu export DC_Motor motor.mo --version 3.0 --type cs --output DC_Motor.fmu
```

---

## `msx csg evaluate`

Evaluates OpenSCAD scripts or STEP CAD solids.

```bash
msx csg evaluate <file.scad> [options]
```

### Options

- `--output <file>`: Output format deduced from extension (`.step`, `.stl`, `.svg`).
- `--mass-properties`: Compute volume, mass center, and inertia tensor.

### Example

```bash
msx csg evaluate bracket.scad --output bracket.step --mass-properties
```

---

## `msx surrogate`

Trains or evaluates parametric reduced-order surrogate models.

```bash
msx surrogate <train|eval> [options]
```

### Options

- `--model <fmu|mo>`: Input model or plant FMU.
- `--samples <n>`: Number of Latin Hypercube design samples (default: `500`).
- `--method <pce|gp|node>`: Polynomial Chaos, Gaussian Process, or Neural ODE.
- `--output <file.json>`: Serialized surrogate weights and hyper-parameters.

### Example

```bash
msx surrogate train plant.fmu --samples 1000 --method gp --output surrogate.json
```

---

## `msx mc`

Runs high-throughput Monte Carlo simulations under parameter uncertainty.

```bash
msx mc <model> [paths...] [options]
```

### Options

- `--runs <n>`: Number of Monte Carlo trajectories (default: `1000`).
- `--gpu`: Enable WebGPU acceleration for parallel execution.
- `--distribution <param:dist:args>`: Parameter uncertainty distributions.

### Example

```bash
msx mc Circuit model.mo --runs 5000 --gpu --distribution "R:normal:100:5"
```

---

## `msx pr-diff`

Computes semantic AST diffs between Git branches or revisions.

```bash
msx pr-diff <source-ref> <target-ref> [options]
```

### Example

```bash
msx pr-diff main HEAD --models
```
