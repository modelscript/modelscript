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

| Action            | Description                                                                        | Key Options                                                                           |
| :---------------- | :--------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------ |
| **`simulate`**    | Runs DC operating point, transient, or AC analysis (AC sweep from the `.AC` card). | `--analysis op\|tran\|ac`, `--tstep`, `--tstop`, `--format table\|json\|csv`, `--out` |
| **`lint`**        | Runs pre-flight structural and electrical rule checks.                             | `--format`                                                                            |
| **`inspect`**     | Dumps topology, component breakdown, nodes, models, subcircuits, and directives.   | `--format`, `--out`                                                                   |
| **`to-modelica`** | Translates the netlist to Modelica 3.x electrical components and connections.      | `--out`                                                                               |
| **`to-ecad`**     | Projects the netlist to an ECAD netlist graph for PCB routing and DRC.             | `--out`                                                                               |
| **`to-dae`**      | Lowers the netlist directly into the linear-memory DAE arena.                      | `--format`, `--out`                                                                   |
| **`diagram`**     | Renders the circuit schematic to SVG or a JSON graph.                              | `--format`, `--out`                                                                   |
| **`sync`**        | Synchronizes tuned parameters and topology from Modelica back into the netlist.    | `--from-modelica`, `--strategy`, `--out`                                              |

### Examples

```bash
# Calculate DC bias voltages on all circuit nodes
msx spice simulate LowPassFilter.cir --analysis op

# Simulate transient step response and export trajectory
msx spice simulate PowerSupply.cir --analysis tran --tstep 1e-6 --tstop 0.01 --out transient.csv

# Run the AC frequency response defined by the netlist's .AC directive
msx spice simulate AudioAmplifier.sp --analysis ac --format csv --out bode.csv

# Lint netlist for floating electrical nodes and ground connectivity
msx spice lint SensorFrontEnd.net
```

---

## Electrical Linters & Diagnostic Rules

<LintRules lang="spice" />
