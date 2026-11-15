---
title: "USGS MODFLOW 6 Groundwater Aquifers (.dis, .dis6, .npf, .wel)"
description: "@modelscript/modflow (languages/modflow) provides native block-based parsing, 3D Darcy conductance evaluation, water table drawdown calculation, and DAE lowering for USGS MODFLOW 6 groundwater models."
---

# USGS MODFLOW 6 Groundwater Aquifers (`.dis`, `.dis6`, `.npf`, `.wel`)

`@modelscript/modflow` (`languages/modflow`) provides native structured block parsing, 3D Darcy cell conductance evaluation, aquifer mass balance solution, and DAE lowering for **US Geological Survey (USGS) MODFLOW 6** regional groundwater flow models.

---

## Supported Extensions & Standards

| Extension       | Format                         | Description                                                                            |
| :-------------- | :----------------------------- | :------------------------------------------------------------------------------------- |
| `.dis`, `.dis6` | MODFLOW Discretization Package | 3D layered regular grid dimensions ($\Delta r, \Delta c$, top, bottom elevations)      |
| `.npf`          | Node Property Flow Package     | Horizontal/vertical hydraulic conductivities ($K_{xx}, K_{33}$) and storage properties |
| `.wel`          | Well Package                   | Extraction and injection well pumping rates per grid cell                              |
| `.riv`          | River Package                  | Surface water-groundwater hydraulic exchange conductance and river stage               |
| `.chd`          | Constant-Head Package          | Fixed piezometric head boundary conditions                                             |

---

## Key Capabilities

### 1. 3D Darcy Inter-Cell Hydraulic Conductance

- Calculates harmonic-mean directional hydraulic conductances between adjacent grid cells $(i, j)$ and enforces steady-state groundwater mass conservation at each cell:
  $$C_{ij} = \frac{2 K_i K_j}{K_i \Delta x_j + K_j \Delta x_i} \cdot A_{ij}$$
  $$\sum_{j \in \text{neighbors}(i)} C_{ij} (h_j - h_i) + Q_{\text{wel}, i} + Q_{\text{riv}, i} + Q_{\text{chd}, i} = 0$$

  | Symbol                                                    | Meaning                                                                                    | Units / Domain        |
  | :-------------------------------------------------------- | :----------------------------------------------------------------------------------------- | :-------------------- |
  | $C_{ij}$                                                  | Inter-cell hydraulic conductance between cells $i$ and $j$                                 | $\text{m}^2/\text{d}$ |
  | $K_i, K_j$                                                | Directional hydraulic conductivities of cells $i$ and $j$                                  | $\text{m/d}$          |
  | $\Delta x_i, \Delta x_j$                                  | Cell dimensions along the flow direction                                                   | $\text{m}$            |
  | $A_{ij}$                                                  | Shared cross-sectional interface area between cells $i$ and $j$                            | $\text{m}^2$          |
  | $h_i, h_j$                                                | Hydraulic (piezometric) heads in cells $i$ and $j$                                         | $\text{m}$            |
  | $Q_{\text{wel}, i}, Q_{\text{riv}, i}, Q_{\text{chd}, i}$ | Volumetric source/sink fluxes at cell $i$ from wells, rivers, and constant-head boundaries | $\text{m}^3/\text{d}$ |

### 2. Riverbed Seepage & Groundwater Interaction

- Simulates bidirectional surface-groundwater exchange flux driven by the head difference between the river stage and either the aquifer cell head (connected) or the riverbed bottom elevation (perched/disconnected):
  $$Q_{\text{riv}} = \begin{cases} C_{\text{riv}} (h_{\text{stage}} - h_{\text{cell}}), & h_{\text{cell}} > z_{\text{rbot}} \\ C_{\text{riv}} (h_{\text{stage}} - z_{\text{rbot}}), & h_{\text{cell}} \le z_{\text{rbot}} \end{cases}$$

  | Symbol             | Meaning                                                                     | Units / Domain        |
  | :----------------- | :-------------------------------------------------------------------------- | :-------------------- |
  | $Q_{\text{riv}}$   | Volumetric seepage flux from river into aquifer cell ($>0$ gaining aquifer) | $\text{m}^3/\text{d}$ |
  | $C_{\text{riv}}$   | Riverbed hydraulic conductance                                              | $\text{m}^2/\text{d}$ |
  | $h_{\text{stage}}$ | River water surface elevation (stage)                                       | $\text{m}$            |
  | $h_{\text{cell}}$  | Groundwater head in the underlying aquifer cell                             | $\text{m}$            |
  | $z_{\text{rbot}}$  | Elevation of the bottom of the riverbed sediment layer                      | $\text{m}$            |

- Coupled directly to river hydraulics (`@modelscript/hec-ras`) and urban stormwater runoff (`@modelscript/swmm`).

### 3. DAE Formulation for Aquifer Storage Dynamics

- Lowers unconfined/confined transient head equations into `@modelscript/runtime`'s `DAEBuilder`, equating elastic storage change to net cell inflow:
  $$S_s \Delta V \frac{dh}{dt} = \sum Q_{\text{flux}}$$

  | Symbol                 | Meaning                                                                | Units / Domain         |
  | :--------------------- | :--------------------------------------------------------------------- | :--------------------- |
  | $S_s$                  | Specific storage of the porous medium                                  | $\text{m}^{-1}$        |
  | $\Delta V$             | Cell bulk volume                                                       | $\text{m}^3$           |
  | $h, t$                 | Hydraulic head and time                                                | $\text{m}$, $\text{d}$ |
  | $\sum Q_{\text{flux}}$ | Net sum of all inter-cell and boundary volumetric fluxes into the cell | $\text{m}^3/\text{d}$  |

- Allows municipal water planners to evaluate sustained well yield against drinking water demand profiles (`@modelscript/epanet`).

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="modflow" />

---

## Static Analysis & Pre-Flight Linter Rules

<LintRules lang="modflow" />

---

## CLI Usage

```bash
# Inspect and summarize MODFLOW 6 grid discretization, conductivity, and boundary packages
msx modflow inspect CentralValley.dis6
msx modflow summary CentralValley.dis6

# Lint MODFLOW package files for negative thicknesses or invalid conductivity
msx modflow lint CentralValley.dis6

# Compute 3D cell mass balance, hydraulic heads, and water table drawdown
msx modflow balance CentralValley.dis6
msx modflow heads CentralValley.dis6
msx modflow solve CentralValley.dis6

# Lower aquifer cell conductance matrix to ModelScript linear DAE arena
msx modflow to-dae CentralValley.dis6 --out=aquifer.dae
```
