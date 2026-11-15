---
title: "LBNL TOUGH Geothermal Reservoir (.tgh, .dat, .tough)"
description: "@modelscript/tough (languages/tough) provides native card-based parsing, geothermal wellbore flashing thermodynamics, and multiphase Darcy flux DAE lowering for Lawrence Berkeley National Laboratory TOUGH2/3 geothermal reservoir simulation decks."
---

# LBNL TOUGH Geothermal Reservoir (`.tgh`, `.dat`, `.tough`)

`@modelscript/tough` (`languages/tough`) provides native fixed-format card parsing, geothermal production well flashing thermodynamics, and multiphase non-isothermal DAE lowering for **Lawrence Berkeley National Laboratory (LBNL) TOUGH2/3** geothermal reservoir decks.

---

## Supported Extensions & Standards

| Extension        | Format                   | Description                                                       |
| :--------------- | :----------------------- | :---------------------------------------------------------------- |
| `.tgh`, `.tough` | TOUGH Input Deck         | Standard LBNL fixed-width ASCII block deck for reservoir modeling |
| `.dat`           | TOUGH / MULKOM Data File | Classic geothermal reservoir simulation deck                      |

---

## Key Capabilities

### 1. Card-Based Block Parsing Engine

- Parses canonical TOUGH2/TOUGH3 simulation blocks:
  - `ROCKS`: Formation density $\rho_r$, porosity $\phi$, anisotropic permeability tensor $(k_x, k_y, k_z)$, thermal conductivity $\lambda_r$, and rock heat capacity $c_r$.
  - `ELEME` & `CONNE`: 3D Voronoi unstructured or cartesian discretization cells, interface areas $A_{ij}$, nodal distances $d_1, d_2$, and gravity cosines.
  - `GENER`: Production and injection mass and heat sources ($q_m$, $h_{\text{inj}}$).
  - `INCON`: Initial cell pore pressures $P$ and temperatures $T$.

### 2. Geothermal Wellbore Flashing Thermodynamics

- Solves steady-state isenthalpic flashing for high-enthalpy production wells, partitioning total fluid enthalpy between saturated liquid and vapor phases to determine steam quality $x$:
  $$h_{\text{mixture}} = (1 - x) h_f(P) + x \, h_g(P)$$
  $$x = \frac{h_{\text{mixture}} - h_f(P)}{h_{fg}(P)}$$
- Evaluates total available thermal power from the wellhead mass flow rate and enthalpy drop to the condenser:
  $$\dot{W}_{\text{th}} = \dot{m} \cdot (h_{\text{mixture}} - h_{\text{condensate}})$$

  | Symbol                  | Meaning                                                                  | Units / Domain          |
  | :---------------------- | :----------------------------------------------------------------------- | :---------------------- |
  | $h_{\text{mixture}}$    | Specific enthalpy of the two-phase wellhead mixture                      | $\text{J/kg}$           |
  | $x$                     | Flash steam mass quality fraction                                        | dimensionless, $[0, 1]$ |
  | $h_f(P), h_g(P)$        | Saturated liquid and saturated vapor specific enthalpies at pressure $P$ | $\text{J/kg}$           |
  | $h_{fg}(P)$             | Latent heat of vaporization ($h_g(P) - h_f(P)$)                          | $\text{J/kg}$, $> 0$    |
  | $P$                     | Separator or wellhead pressure                                           | $\text{Pa}$, $> 0$      |
  | $\dot{W}_{\text{th}}$   | Net thermal power output                                                 | $\text{W}$              |
  | $\dot{m}$               | Total produced wellhead mass flow rate                                   | $\text{kg/s}$, $\ge 0$  |
  | $h_{\text{condensate}}$ | Specific enthalpy of cooled reinjection condensate                       | $\text{J/kg}$           |

### 3. Non-Isothermal Multiphase Darcy DAE Lowering

- Lowers finite-volume mass and internal energy conservation laws for each grid block $i$ into `@modelscript/runtime`'s `DAEBuilder`, balancing accumulation against inter-cell fluxes and source/sink terms:
  $$\frac{d M_\kappa}{dt} = \sum_{j} F_{\kappa, ij} + q_\kappa$$
  $$\frac{d E}{dt} = \sum_{j} F_{h, ij} + q_h$$
  where phase mass advection between connected cells is governed by multiphase Darcy's law:
  $$\mathbf{F}_\beta = -k \frac{k_{r\beta}}{\mu_\beta} \rho_\beta (\nabla P_\beta - \rho_\beta \mathbf{g})$$

  | Symbol                           | Meaning                                                                      | Units / Domain                                         |
  | :------------------------------- | :--------------------------------------------------------------------------- | :----------------------------------------------------- |
  | $M_\kappa, E$                    | Accumulated mass of component $\kappa$ and total internal energy in cell $i$ | $\text{kg}$, $\text{J}$                                |
  | $t$                              | Simulation time                                                              | $\text{s}$, $\ge 0$                                    |
  | $F_{\kappa, ij}, F_{h, ij}$      | Mass flux of component $\kappa$ and heat flux from neighbor cell $j$ to $i$  | $\text{kg/s}$, $\text{W}$                              |
  | $q_\kappa, q_h$                  | External mass and heat source/sink rates (`GENER`)                           | $\text{kg/s}$, $\text{W}$                              |
  | $\mathbf{F}_\beta$               | Advective mass flux vector of fluid phase $\beta$ (liquid, gas, NAPL)        | $\text{kg/(m}^2\cdot\text{s)}$                         |
  | $k, k_{r\beta}$                  | Absolute rock permeability and relative permeability of phase $\beta$        | $\text{m}^2$, dimensionless ($[0, 1]$)                 |
  | $\mu_\beta, \rho_\beta, P_\beta$ | Dynamic viscosity, density, and pore pressure of phase $\beta$               | $\text{Pa}\cdot\text{s}$, $\text{kg/m}^3$, $\text{Pa}$ |
  | $\mathbf{g}$                     | Gravitational acceleration vector                                            | $\text{m/s}^2$, $\mathbb{R}^3$                         |

- Directly connects geothermal district heating outputs into building heating loops (`@modelscript/energyplus`) and regional electrical grids (`@modelscript/opendss`).

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="tough" />

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
