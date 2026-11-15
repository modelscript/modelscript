---
title: "ECLIPSE-Compatible Reservoir Engineering (.data, .dat, .inc)"
description: "@modelscript/eclipse (languages/eclipse) provides zero-regex parsing, multiphase Darcy material balance solving, Peaceman well inflow modeling, linear DAE lowering, and Modelica 3.x projection for..."
---

# ECLIPSE-Compatible Reservoir Engineering (`.data`, `.dat`, `.inc`)

`@modelscript/eclipse` (`languages/eclipse`) provides zero-regex parsing, multiphase Darcy material balance solving, Peaceman well inflow modeling, linear DAE lowering, and Modelica 3.x projection for **ECLIPSE-compatible 100 (Black Oil) & 300 (Compositional)** reservoir simulation decks.

---

## Supported Extensions & Standards

| Extension       | Format               | Description                                                                                     |
| :-------------- | :------------------- | :---------------------------------------------------------------------------------------------- |
| `.data`         | ECLIPSE Master Deck  | Structured keyword deck defining grid geometry, rock/fluid properties, and well schedules       |
| `.dat` / `.inc` | ECLIPSE Include File | Modular sub-decks for PVT tables (`PROPS`), well completions (`SCHEDULE`), or permeability maps |

---

## Key Capabilities

### 1. Sectioned Deck Architecture & Table Records

- Parses all standard ECLIPSE keyword sections:
  - **`RUNSPEC`**: Phases (OIL, WATER, GAS, DISGAS), grid dimensions ($N_x \times N_y \times N_z$), unit systems (FIELD, METRIC, LAB).
  - **`GRID`**: Block dimensions (`DX`, `DY`, `DZ`), top depths (`TOPS`), porosity (`PORO`), and directional permeabilities (`PERMX`, `PERMY`, `PERMZ`).
  - **`PROPS`**: Multi-phase relative permeability curves (`SWOF`, `SGOF`) and PVT tables (`PVDO`, `PVTW`, `PVDG`).
  - **`REGIONS`**: Fluid and equilibrium region partitions.
  - **`SOLUTION`**: Initial equilibrium pressure and saturation distributions (`PRESSURE`, `SWAT`, `SOIL`).
  - **`SCHEDULE`**: Well specifications (`WELSPECS`), completion intervals (`COMPDAT`), production controls (`WCONPROD`), and water/gas injection controls (`WCONINJE`).

### 2. Multiphase Darcy Flow & Material Balance Solver

- Computes original hydrocarbons in place by summing pore volume occupied by oil or gas across all grid cells $k$ and converting to surface standard conditions:
  - **Stock Tank Oil Initially In Place (STOIIP)**:
    $$\text{STOIIP} = \sum_{k} \frac{V_{b,k} \cdot \phi_k \cdot S_{o,k}}{B_{oi}}$$
  - **Gas Initially In Place (GIIP)** (summing free gas and solution gas dissolved in oil):
    $$\text{GIIP} = \sum_{k} \frac{V_{b,k} \cdot \phi_k \cdot (S_{g,k} + S_{o,k} R_{si})}{B_{gi}}$$
- Evaluates dynamic reservoir depletion using the generalized **Havlena-Odeh material balance equation**, which equates total underground fluid withdrawal (oil, gas, and water) to expansion of the oil zone, gas cap, connate water/rock pore space, and water injection:
  $$N_p \left[ B_o + (R_p - R_s) B_g \right] + W_p B_w = N \left[ (B_o - B_{oi}) + (R_{si} - R_s) B_g \right] + m N B_{oi} \left( \frac{B_g}{B_{gi}} - 1 \right) + (1 + m) N B_{oi} \frac{c_w S_{wi} + c_f}{1 - S_{wi}} \Delta P + W_{\text{inj}} B_w$$
- Evaluates well deliverability via the **Peaceman well model**, relating volumetric production rate to pressure drawdown between the grid block and wellbore via a radial productivity index:
  $$q_p = PI \cdot (P_{\text{block}} - P_{\text{bh}}), \quad PI = \frac{2 \pi k h}{\mu B \left( \ln \frac{r_o}{r_w} + s \right)}$$
  where $r_o = 0.28 \frac{\sqrt{(k_y / k_x)^{1/2} \Delta x^2 + (k_x / k_y)^{1/2} \Delta y^2}}{(k_y / k_x)^{1/4} + (k_x / k_y)^{1/4}}$ is Peaceman's equivalent block radius.

  | Symbol                            | Meaning                                                                | Units / Domain                                                                    |
  | :-------------------------------- | :--------------------------------------------------------------------- | :-------------------------------------------------------------------------------- |
  | $V_{b,k}, \phi_k$                 | Bulk volume and porosity of grid block $k$                             | $\text{m}^3$ (or $\text{ft}^3$), dimensionless $\in [0, 1]$                       |
  | $S_{o,k}, S_{g,k}$                | Initial oil and gas saturations in block $k$                           | Dimensionless, $\in [0, 1]$                                                       |
  | $B_o, B_{oi}, B_g, B_{gi}, B_w$   | Oil, gas, and water formation volume factors (current / initial)       | Reservoir vol. / standard vol. ($> 0$)                                            |
  | $R_s, R_{si}, R_p$                | Solution gas-oil ratio (current / initial) and cumulative produced GOR | $\text{std m}^3/\text{std m}^3$ (or $\text{scf}/\text{stb}$)                      |
  | $N, N_p$                          | Initial oil in place (STOIIP) and cumulative oil produced              | $\text{std m}^3$ (or $\text{stb}$)                                                |
  | $W_p, W_{\text{inj}}$             | Cumulative water produced and cumulative water injected                | $\text{std m}^3$ (or $\text{stb}$)                                                |
  | $m$                               | Ratio of initial gas-cap volume to initial oil-zone volume             | Dimensionless ($\ge 0$)                                                           |
  | $c_w, c_f$                        | Connate water and formation (rock) compressibilities                   | $\text{Pa}^{-1}$ (or $\text{psi}^{-1}$)                                           |
  | $S_{wi}$                          | Initial (connate) water saturation                                     | Dimensionless, $\in [0, 1)$                                                       |
  | $\Delta P$                        | Average reservoir pressure drop ($P_i - P$)                            | $\text{Pa}$ (or $\text{psi}$)                                                     |
  | $q_p, PI$                         | Phase volumetric flow rate and well productivity index                 | $\text{m}^3\cdot\text{s}^{-1}$, $\text{m}^3\cdot\text{s}^{-1}\cdot\text{Pa}^{-1}$ |
  | $P_{\text{block}}, P_{\text{bh}}$ | Grid block pressure and bottomhole flowing pressure                    | $\text{Pa}$ (or $\text{psi}$)                                                     |
  | $k, k_x, k_y$                     | Effective and directional ($x, y$) rock permeabilities                 | $\text{m}^2$ (or $\text{mD}$)                                                     |
  | $h, \mu, B$                       | Net pay thickness, fluid viscosity, and formation volume factor        | $\text{m}$, $\text{Pa}\cdot\text{s}$, $\text{res vol}/\text{std vol}$             |
  | $r_o, r_w, s$                     | Peaceman equivalent radius, wellbore radius, and skin factor           | $\text{m}$, $\text{m}$, dimensionless                                             |
  | $\Delta x, \Delta y$              | Grid block dimensions in $x$ and $y$ directions                        | $\text{m}$ (or $\text{ft}$)                                                       |

### 3. Direct DAE Lowering

- Lowers reservoir grid pore volumes, multi-phase flow equations, and well drawdown constraints into `@modelscript/runtime`'s `DAEBuilder` linear memory arena.
- Enables co-simulation between subterranean porous media flow and surface transient multiphase gathering pipelines ([`@modelscript/olga`](./olga.md)) and process facilities ([`@modelscript/aspen`](./aspen.md)).

### 4. Bidirectional Modelica 3.x Projection

- Projects reservoir blocks and production wells into `Modelica.Fluid` porous media volumes and source boundaries.

---

## Pre-Flight Diagnostics

The ECLIPSE validator inspects grid bounds, PVT table monotonicity, and well completions:

<LintRules lang="eclipse" />

---

## CLI Usage

```bash
# Inspect grid dimensions, fluid phases, and well completions
msx eclipse inspect NorthSeaReservoir.data

# Run pre-flight linting and PVT table monotonicity checks
msx eclipse lint NorthSeaReservoir.data

# Solve reservoir depletion trajectory and compute STOIIP / GIIP
msx eclipse solve NorthSeaReservoir.data --days 365

# Lower reservoir material balance to ModelScript linear DAE arena
msx eclipse to-dae NorthSeaReservoir.data

# Project into Modelica 3.x porous medium flow model
msx eclipse to-modelica NorthSeaReservoir.data -o ReservoirModel.mo
```

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="eclipse" />
