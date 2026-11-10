---
title: "EPANET Water Distribution Networks (.inp)"
description: "@modelscript/epanet (languages/epanet) provides native parsing, hydraulic simulation, DAE lowering, and formal verification for US EPA EPANET pressurized drinking water distribution networks and mu..."
---

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

### 3. Extended-Period, Pressure-Driven, MOC Water Hammer, Quality & AWWA M36

- **Extended Period Simulation (`eps`) & Optimal Pump Scheduling (`ops`)**: Simulates 24–168 hour diurnal demand patterns and tank storage cycles while optimizing pump energy against time-of-use electricity tariffs.
- **Wagner Pressure-Driven Demand (`pdd`) & Fire Flow**: Evaluates pressure-deficient delivery ($Q_i = D_i \sqrt{(P_i - P_{\min}) / (P_{\text{req}} - P_{\min})}$) and ISO hydrant residual pressure limits ($\ge 20\text{ psi}$).
- **Method of Characteristics (MOC) Water Hammer (`surge`)**: Solves 1D elastic Joukowsky wave propagation ($\Delta H = \pm \frac{a}{g} \Delta V$) for rapid valve closure and pump trip transients.
- **Advective Water Quality (`quality`), AWWA M36 Water Audit (`audit`), GIS Ingestion (`from-gis`) & EPA LCRR**: Models chlorine decay and water age, computes Infrastructure Leakage Index (ILI), ingests GeoJSON pipe/node layers, and exports US EPA Lead and Copper Rule Revisions (LCRR) inventories.

### 4. Direct DAE Lowering & Modelica Projection

- Compiles the entire municipal pipe and tank network into `@modelscript/runtime`'s `DAEBuilder` SoA linear memory arena.
- Projects EPANET networks into standard `Modelica.Fluid` pipes, reservoirs, and centrifugal pumps for joint thermo-fluid studies.

---

## Static Analysis & Pre-Flight Linter Rules

<LintRules lang="epanet" />

---

## CLI Usage

```bash
# Inspect and lint an EPANET municipal water network
msx epanet inspect MunicipalWaterNetwork.inp
msx epanet lint MunicipalWaterNetwork.inp

# Solve steady-state network hydraulics (Todini GGM), EPS, PDD, and MOC water hammer
msx epanet solve MunicipalWaterNetwork.inp
msx epanet eps MunicipalWaterNetwork.inp
msx epanet pdd MunicipalWaterNetwork.inp
msx epanet surge MunicipalWaterNetwork.inp

# Run AWWA M36 IWA water audit, optimal pump scheduling, water quality, and topological diff
msx epanet audit MunicipalWaterNetwork.inp
msx epanet ops MunicipalWaterNetwork.inp
msx epanet quality MunicipalWaterNetwork.inp
msx epanet diff Baseline.inp Proposed.inp

# Ingest GeoJSON GIS pipe and node layers into an EPANET .inp deck
msx epanet from-gis pipes.geojson --nodes=junctions.geojson --out=MunicipalWaterNetwork.inp

# Lower network dynamics into ModelScript linear DAE arena or Modelica.Fluid
msx epanet to-dae MunicipalWaterNetwork.inp --out=network.dae.json
msx epanet to-modelica MunicipalWaterNetwork.inp -o MunicipalPipes.mo
```

