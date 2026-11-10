---
title: "USACE HEC-RAS River Hydraulics (.g01, .g02, .rasgeo)"
description: "@modelscript/hec-ras (languages/hec-ras) provides native parsing, 1D steady backwater profile solution, Saint-Venant DAE lowering, and formal verification for US Army Corps of Engineers HEC-RAS river hydraulic geometries."
---

# USACE HEC-RAS River Hydraulics (`.g01`, `.g02`, `.rasgeo`)

`@modelscript/hec-ras` (`languages/hec-ras`) provides native parsing, 1D steady backwater profile solution, dynamic wave Saint-Venant DAE lowering, and cross-section validation for **US Army Corps of Engineers (USACE) HEC-RAS** river geometries and steady/unsteady flow decks.

---

## Supported Extensions & Standards

| Extension | Format | Description |
| :--- | :--- | :--- |
| `.g01`, `.g02`, `.g03` | HEC-RAS Geometry File | River reach coordinates, cross-section station-elevations, Manning's $n$, and weir structures |
| `.rasgeo`, `.geo` | Modern HEC-RAS ASCII Geometry | Unified multi-reach geometry exchange format |
| `.f01`, `.f02` | HEC-RAS Steady Flow File | Boundary conditions (known WS, critical depth, normal depth, rating curves) |

---

## Key Capabilities

### 1. Standard Step Method 1D Backwater Solver

- Solves the energy conservation equation between adjacent cross-sections:
  $$WSE_2 + \alpha_2 \frac{V_2^2}{2g} = WSE_1 + \alpha_1 \frac{V_1^2}{2g} + h_e$$
  where the head loss $h_e$ incorporates friction loss and expansion/contraction eddy losses:
  $$h_e = L \bar{S}_f + C \left| \alpha_2 \frac{V_2^2}{2g} - \alpha_1 \frac{V_1^2}{2g} \right|$$
- Friction slope evaluated via Manning's formula:
  $$\bar{S}_f = \left( \frac{Q}{\sum K_i} \right)^2, \quad K_i = \frac{1}{n_i} A_i R_i^{2/3}$$
- Supports subcritical, supercritical, and mixed flow regimes with hydraulic jump detection.

### 2. Multi-Zone Cross-Section Hydrodynamics

- Segmented cross-sections with distinct left overbank (LOB), main channel, and right overbank (ROB) roughness coefficients.
- Automated wetted perimeter $P(y)$, flow area $A(y)$, and hydraulic radius $R_h(y)$ quadrature across irregular surveyed station-elevation slices.
- Inline structures: broad-crested and ogee weirs with standard discharge coefficient formulations ($Q = C_d L H^{3/2}$).

### 3. Zero-GC Saint-Venant DAE Lowering

- Lowers 1D shallow water equations into `@modelscript/runtime`'s `DAEBuilder` linear memory arena:
  $$\frac{\partial A}{\partial t} + \frac{\partial Q}{\partial x} = q_L$$
  $$\frac{\partial Q}{\partial t} + \frac{\partial}{\partial x}\left(\frac{\beta Q^2}{A}\right) + g A \frac{\partial h}{\partial x} + g A (S_f - S_0) = 0$$
- Enables direct co-simulation with urban drainage (`@modelscript/swmm`), drinking water networks (`@modelscript/epanet`), and regional aquifers (`@modelscript/modflow`).

---

## Static Analysis & Pre-Flight Linter Rules

<LintRules lang="hec-ras" />

---

## CLI Usage

```bash
# Lint an existing HEC-RAS geometry file for non-monotonic bank stations or invalid roughness
msx hec-ras lint ColumbiaRiver.g01

# Solve 1D backwater surface profile and print water surface elevations (WSE) and Froude numbers
msx hec-ras profile ColumbiaRiver.g01 --discharge=250.0 --slope=0.0015

# Lower river geometry and reach dynamics into ModelScript linear DAE arena
msx hec-ras to-dae ColumbiaRiver.g01 --out=river.dae
```
