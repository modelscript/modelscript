---
title: SPICE Electronics & Circuit Simulation
description: Native compiler, linter, operating point (.OP), transient (.TRAN), AC small-signal (.AC) solvers, and Modelica/ECAD projections for SPICE netlists in ModelScript.
---

# SPICE Electronics & Analog Circuit Simulation

ModelScript features high-performance native support for **SPICE** (`.cir`, `.sp`, `.net`, `.lib`) netlists and analog circuit analysis. Engineers can validate electrical schematics, detect topological faults (floating nodes, voltage source loops), execute pure in-WASM circuit simulations, and export to Modelica or ECAD netlist graphs.

---

## Capabilities & Supported Formats

| Format                  | Extension             | Description                                                                                                                                                                     |
| :---------------------- | :-------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **SPICE Netlist**       | `.cir`, `.sp`, `.net` | Circuit description specifying passive components (R, L, C), active semiconductors (diode, BJT, MOSFET), independent/dependent sources, subcircuits, and simulation directives. |
| **SPICE Model Library** | `.lib`, `.mod`        | Device physics parameters for transistors, diodes, op-amps, and macro-models.                                                                                                   |

### Key Architectural Features

- **Engineering Unit Netlist Parser:**
  - Robust lexer parsing metric prefixes (`f`, `p`, `n`, `u`, `m`, `k`, `meg`, `g`, `t`), curly brace math expressions `{R1 * 2}`, line continuations (`+`), and subcircuit definitions (`.SUBCKT` / `.ENDS`).
  - Lossless round-trip serializer (`serializeSpice()`).
- **Native Numerical Solvers:**
  - **DC Operating Point (`.OP`):** Assembles Modified Nodal Analysis (MNA) matrix $\mathbf{G} \mathbf{v} = \mathbf{i}$ with Newton-Raphson iteration for non-linear PN junctions.
  - **Transient Simulation (`.TRAN`):** Numerical companion-circuit integration supporting Trapezoidal rule with damping for reactive elements ($L, C$).
  - **AC Small-Signal Frequency Sweep (`.AC`):** Complex admittance matrix $\mathbf{Y}(j\omega)$ solving decade/octave/linear frequency sweeps and bode response.
- **Circuit Linter Rules (`M7101`–`M7109`):**
  - Identifies single-connection floating nodes, parallel ideal voltage sources, cutsets of ideal current sources, non-positive passives, and subcircuit pin mismatches.
- **Bilateral Modelica & ECAD Projections:**
  - Translates SPICE netlists to standard `Modelica.Electrical.Analog` components.
  - Projects to generic `NetlistGraph` data structures for PCB layout, schematic capture, and Design Rule Checking (DRC).

---

## Command Line Interface (`msx spice`)

```bash
msx spice <action> [files...] [options]
```

| Action            | Description                                                                       | Key Options                                                                                   |
| :---------------- | :-------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------- |
| **`inspect`**     | Dumps circuit netlist statistics, components, nodes, subcircuits, and directives. | —                                                                                             |
| **`lint`**        | Runs pre-flight electrical topology checks and floating node analysis.            | —                                                                                             |
| **`op`**          | Computes DC operating point node voltages and branch currents.                    | —                                                                                             |
| **`tran`**        | Runs time-domain transient analysis.                                              | `--stop=<sec>`, `--step=<sec>`, `--out=<file.csv>`                                            |
| **`ac`**          | Runs small-signal AC frequency sweep.                                             | `--fstart=<hz>`, `--fstop=<hz>`, `--points=<num>`, `--type=dec\|oct\|lin`, `--out=<file.csv>` |
| **`to-modelica`** | Projects SPICE netlist to standard `Modelica.Electrical.Analog`.                  | `--out=<file.mo>`                                                                             |
| **`to-dae`**      | Lowers netlist directly into `DAEBuilder` SoA linear memory arena.                | —                                                                                             |

### Examples

```bash
# Calculate DC bias voltages on all circuit nodes
msx spice op LowPassFilter.cir

# Simulate transient step response and export trajectory
msx spice tran PowerSupply.cir --stop=0.01 --step=1e-6 --out=transient.csv

# Run AC frequency response analysis from 10 Hz to 1 MHz
msx spice ac AudioAmplifier.sp --fstart=10 --fstop=1e6 --points=100 --out=bode.csv

# Lint netlist for floating electrical nodes and ground connectivity
msx spice lint SensorFrontEnd.net
```

---

## Electrical Linters & Diagnostic Rules

| Code        | Identifier                      | Severity | Description                                                                           |
| :---------- | :------------------------------ | :------- | :------------------------------------------------------------------------------------ |
| **`M7101`** | `floating-node`                 | Error    | Electrical node has only one connected pin; floating circuit hazard.                  |
| **`M7102`** | `parallel-voltage-sources`      | Error    | Loop of ideal voltage sources with zero series impedance violates KVL.                |
| **`M7103`** | `series-current-sources`        | Error    | Cutset of ideal current sources with unequal branch currents violates KCL.            |
| **`M7104`** | `unresolved-subcircuit`         | Error    | Subcircuit invocation (`X...`) references a `.SUBCKT` name absent from netlist.       |
| **`M7105`** | `invalid-passive-value`         | Error    | Resistance, capacitance, or inductance is non-positive or non-finite.                 |
| **`M7106`** | `transient-step-violation`      | Warning  | Transient maximum step size `TSTEP` is larger than total simulation duration `TSTOP`. |
| **`M7107`** | `duplicate-component-name`      | Warning  | Multiple circuit components share an identical reference designator.                  |
| **`M7108`** | `missing-model-definition`      | Error    | Semiconductor device references a `.MODEL` card that is not defined.                  |
| **`M7109`** | `subcircuit-pin-count-mismatch` | Error    | Number of pins on subcircuit instance does not match `.SUBCKT` header declaration.    |
