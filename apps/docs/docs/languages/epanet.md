# EPANET Water Distribution Networks (`.inp`)

`@modelscript/epanet` (`languages/epanet`) provides native parsing, hydraulic simulation, DAE lowering, and formal verification for **US EPA EPANET** pressurized drinking water distribution networks and municipal water infrastructure.

---

## Supported Extensions & Standards

| Extension | Format            | Description                                                                       |
| :-------- | :---------------- | :-------------------------------------------------------------------------------- |
| `.inp`    | EPANET Input File | Industry-standard network topology, pipes, pumps, valves, and water quality decks |

---

## Key Capabilities

### 1. Todini Global Gradient Method (GGM) Hydraulic Solver

- Implements the Todini Global Gradient Algorithm (`todini-ggm.ts`) for quadratic/nonlinear pipe network equilibrium:
  - **Conservation of Mass at Junctions**:
    $$\sum_{k \in \text{in}(i)} Q_k - \sum_{k \in \text{out}(i)} Q_k = D_i$$
  - **Conservation of Energy across Pipe Loops**:
    $$h_i - h_j = h_{L,ij} = r Q_{ij} |Q_{ij}|^{\alpha - 1}$$
- Supports **Hazen-Williams**, **Darcy-Weisbach**, and **Chezy-Manning** head loss friction models.

### 2. Multi-Component Hydraulic Elements

- **Pumps**: Head gain curves modeled via 3-point polynomial and power-law relationships ($h_p = h_0 - a Q^b$).
- **Tanks & Reservoirs**: Dynamic elevated storage tanks with hydrostatic pressure differential equations:
  $$A_{\text{tank}} \frac{dh}{dt} = \sum Q_{\text{in}} - \sum Q_{\text{out}}$$
- **Control Valves**: Pressure Reducing Valves (PRV), Pressure Sustaining Valves (PSV), and Flow Control Valves (FCV).

### 3. Direct DAE Lowering & Modelica Projection

- Compiles the entire municipal pipe and tank network into `@modelscript/runtime`'s `DAEBuilder` SoA linear memory arena.
- Projects EPANET networks into standard `Modelica.Fluid` pipes, reservoirs, and centrifugal pumps for joint thermo-fluid studies.

---

## Static Analysis & Pre-Flight Linter Rules

The EPANET linter inspects topological connectivity and hydraulic constraints:

| Rule Identifier             | Severity  | Condition Checked                                                                           |
| :-------------------------- | :-------- | :------------------------------------------------------------------------------------------ |
| `isolated-junction-node`    | `error`   | Junction node has no connected pipes or is completely detached from a pressure supply.      |
| `invalid-pipe-geometry`     | `error`   | Pipe length $\le 0$, diameter $\le 0$, or roughness coefficient $\le 0$.                    |
| `non-monotonic-pump-curve`  | `warning` | Pump head curve does not decrease monotonically with increasing volumetric flow.            |
| `negative-pressure-warning` | `warning` | Hydraulic solver predicts negative pressures (cavitation risk) under nominal design demand. |

---

## CLI Usage

```bash
# Lint an EPANET municipal water network
msx epanet lint MunicipalWaterNetwork.inp

# Solve steady-state network hydraulics (Todini GGM) and print pressures
msx epanet solve MunicipalWaterNetwork.inp

# Lower network dynamics into ModelScript linear DAE arena
msx epanet to-dae MunicipalWaterNetwork.inp --out=network.dae.json

# Project into standard Modelica.Fluid components
msx epanet to-modelica MunicipalWaterNetwork.inp -o MunicipalPipes.mo
```
