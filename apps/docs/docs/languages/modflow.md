---
title: "USGS MODFLOW 6 Groundwater Aquifers (.dis, .dis6, .npf, .wel)"
description: "@modelscript/modflow (languages/modflow) provides native block-based parsing, 3D Darcy conductance evaluation, water table drawdown calculation, and DAE lowering for USGS MODFLOW 6 groundwater models."
---

# USGS MODFLOW 6 Groundwater Aquifers (`.dis`, `.dis6`, `.npf`, `.wel`)

`@modelscript/modflow` (`languages/modflow`) provides native structured block parsing, 3D Darcy cell conductance evaluation, aquifer mass balance solution, and DAE lowering for **US Geological Survey (USGS) MODFLOW 6** regional groundwater flow models.

---

## Supported Extensions & Standards

| Extension | Format | Description |
| :--- | :--- | :--- |
| `.dis`, `.dis6` | MODFLOW Discretization Package | 3D layered regular grid dimensions ($\Delta r, \Delta c$, top, bottom elevations) |
| `.npf` | Node Property Flow Package | Horizontal/vertical hydraulic conductivities ($K_{xx}, K_{33}$) and storage properties |
| `.wel` | Well Package | Extraction and injection well pumping rates per grid cell |
| `.riv` | River Package | Surface water-groundwater hydraulic exchange conductance and river stage |
| `.chd` | Constant-Head Package | Fixed piezometric head boundary conditions |

---

## Key Capabilities

### 1. 3D Darcy Inter-Cell Hydraulic Conductance

- Calculates harmonic-mean directional conductances between adjacent cells $(i, j)$:
  $$C_{ij} = \frac{2 K_i K_j}{K_i \Delta x_j + K_j \Delta x_i} \cdot A_{ij}$$
- Steady-state mass conservation at each cell:
  $$\sum_{j \in \text{neighbors}(i)} C_{ij} (h_j - h_i) + Q_{\text{wel}, i} + Q_{\text{riv}, i} + Q_{\text{chd}, i} = 0$$

### 2. Riverbed Seepage & Groundwater Interaction

- Simulates bidirectional surface-groundwater flux coupled to river stage:
  $$Q_{\text{riv}} = \begin{cases} C_{\text{riv}} (h_{\text{stage}} - h_{\text{cell}}), & h_{\text{cell}} > z_{\text{rbot}} \\ C_{\text{riv}} (h_{\text{stage}} - z_{\text{rbot}}), & h_{\text{cell}} \le z_{\text{rbot}} \end{cases}$$
- Coupled directly to river hydraulics (`@modelscript/hec-ras`) and urban stormwater runoff (`@modelscript/swmm`).

### 3. DAE Formulation for Aquifer Storage Dynamics

- Lowers unconfined/confined transient head equations into `@modelscript/runtime`'s `DAEBuilder`:
  $$S_s \Delta V \frac{dh}{dt} = \sum Q_{\text{flux}}$$
- Allows municipal water planners to evaluate sustained well yield against drinking water demand profiles (`@modelscript/epanet`).

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

