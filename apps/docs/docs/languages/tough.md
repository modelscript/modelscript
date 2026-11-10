---
title: "LBNL TOUGH Geothermal Reservoir (.tgh, .dat, .tough)"
description: "@modelscript/tough (languages/tough) provides native card-based parsing, geothermal wellbore flashing thermodynamics, and multiphase Darcy flux DAE lowering for Lawrence Berkeley National Laboratory TOUGH2/3 geothermal reservoir simulation decks."
---

# LBNL TOUGH Geothermal Reservoir (`.tgh`, `.dat`, `.tough`)

`@modelscript/tough` (`languages/tough`) provides native fixed-format card parsing, geothermal production well flashing thermodynamics, and multiphase non-isothermal DAE lowering for **Lawrence Berkeley National Laboratory (LBNL) TOUGH2/3** geothermal reservoir decks.

---

## Supported Extensions & Standards

| Extension | Format | Description |
| :--- | :--- | :--- |
| `.tgh`, `.tough` | TOUGH Input Deck | Standard LBNL fixed-width ASCII block deck for reservoir modeling |
| `.dat` | TOUGH / MULKOM Data File | Classic geothermal reservoir simulation deck |

---

## Key Capabilities

### 1. Card-Based Block Parsing Engine

- Parses canonical TOUGH2/TOUGH3 simulation blocks:
  - `ROCKS`: Formation density $\rho_r$, porosity $\phi$, anisotropic permeability tensor $(k_x, k_y, k_z)$, thermal conductivity $\lambda_r$, and rock heat capacity $c_r$.
  - `ELEME` & `CONNE`: 3D Voronoi unstructured or cartesian discretization cells, interface areas $A_{ij}$, nodal distances $d_1, d_2$, and gravity cosines.
  - `GENER`: Production and injection mass and heat sources ($q_m$, $h_{\text{inj}}$).
  - `INCON`: Initial cell pore pressures $P$ and temperatures $T$.

### 2. Geothermal Wellbore Flashing Thermodynamics

- Solves steady-state isenthalpic flashing for high-enthalpy production wells:
  $$h_{\text{mixture}} = (1 - x) h_f(P) + x \, h_g(P)$$
  $$x = \frac{h_{\text{mixture}} - h_f(P)}{h_{fg}(P)}$$
  where $x$ represents the flash steam quality fraction.
- Evaluates total net thermal electrical capacity:
  $$\dot{W}_{\text{th}} = \dot{m} \cdot (h_{\text{mixture}} - h_{\text{condensate}})$$

### 3. Non-Isothermal Multiphase Darcy DAE Lowering

- Lowers mass and energy conservation laws into `@modelscript/runtime`'s `DAEBuilder`:
  $$\frac{d M_\kappa}{dt} = \sum_{j} F_{\kappa, ij} + q_\kappa$$
  $$\frac{d E}{dt} = \sum_{j} F_{h, ij} + q_h$$
  where phase advection follows multiphase Darcy's law:
  $$\mathbf{F}_\beta = -k \frac{k_{r\beta}}{\mu_\beta} \rho_\beta (\nabla P_\beta - \rho_\beta \mathbf{g})$$
- Directly connects geothermal district heating outputs into building heating loops (`@modelscript/energyplus`) and regional electrical grids (`@modelscript/opendss`).

---

## Static Analysis & Pre-Flight Linter Rules

<LintRules lang="tough" />

---

## CLI Usage

```bash
# Lint TOUGH input deck for permeability bounds and isolated grid cells
msx tough lint GeysersReservoir.tgh

# Solve wellbore flashing thermodynamics and available thermal power
msx tough flash GeysersReservoir.tgh

# Lower multiphase reservoir energy balances into ModelScript DAE arena
msx tough to-dae GeysersReservoir.tgh --out=geothermal.dae
```
