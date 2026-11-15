---
title: Cantera Chemical Kinetics & Thermochemistry (.yaml, .cti)
description: Native WebAssembly parsing, NASA-7 polynomial thermodynamic evaluation, modified Arrhenius and Troe falloff kinetics, non-isothermal reactor ODE integration, DAEBuilder lowering, and SBML / Modelica projections for Cantera mechanisms.
---

# Cantera Chemical Kinetics & Thermochemistry (`.yaml`, `.cti`)

`@modelscript/cantera` (`languages/cantera`) provides native WebAssembly parsing, NASA-7 polynomial thermodynamic evaluation ($C_p^\circ(T)$, $H^\circ(T)$, $S^\circ(T)$, $G^\circ(T)$), modified Arrhenius and Troe falloff reaction rate calculation, non-isothermal batch reactor ODE integration, `DAEBuilder` lowering, and SBML / Modelica projections for **Cantera** gas-phase combustion, catalysis, and chemical kinetics mechanisms.

---

## Supported Extensions & Standards

| Extension | Format             | Description                                                                                         |
| :-------- | :----------------- | :-------------------------------------------------------------------------------------------------- |
| `.yaml`   | Cantera YAML       | Modern Cantera 2.5+ / 3.x YAML mechanism format (`phases`, `species`, `reactions`, `thermo: NASA7`) |
| `.cti`    | Legacy Cantera CTI | Classic Cantera `ideal_gas`, `species`, and `reaction` mechanism definitions                        |

---

## Key Capabilities

### 1. NASA-7 Thermochemical Polynomials

Evaluates two-range (low-$T$ $[T_{\min}, T_{\text{mid}}]$ and high-$T$ $[T_{\text{mid}}, T_{\max}]$) 7-coefficient NASA polynomials $(a_0, \dots, a_6)$ for every species $k$. These dimensionless polynomial fits express a species' molar heat capacity, enthalpy, and entropy as smooth functions of temperature:

$$\frac{C_{p,k}^\circ(T)}{R} = a_0 + a_1 T + a_2 T^2 + a_3 T^3 + a_4 T^4$$
$$\frac{H_k^\circ(T)}{RT} = a_0 + \frac{a_1}{2}T + \frac{a_2}{3}T^2 + \frac{a_3}{4}T^3 + \frac{a_4}{5}T^4 + \frac{a_5}{T}$$
$$\frac{S_k^\circ(T)}{R} = a_0 \ln T + a_1 T + \frac{a_2}{2}T^2 + \frac{a_3}{3}T^3 + \frac{a_4}{4}T^4 + a_6$$

| Symbol             | Meaning                                                                 | Units / Domain                                                            |
| :----------------- | :---------------------------------------------------------------------- | :------------------------------------------------------------------------ |
| $C_{p,k}^\circ(T)$ | Standard-state molar heat capacity at constant pressure for species $k$ | $\text{J}/(\text{mol}\cdot\text{K})$                                      |
| $H_k^\circ(T)$     | Standard-state molar enthalpy for species $k$                           | $\text{J}/\text{mol}$                                                     |
| $S_k^\circ(T)$     | Standard-state molar entropy for species $k$                            | $\text{J}/(\text{mol}\cdot\text{K})$                                      |
| $T$                | Absolute gas temperature                                                | $\text{K}$ ($[T_{\min}, T_{\text{mid}}]$ or $[T_{\text{mid}}, T_{\max}]$) |
| $R$                | Universal gas constant                                                  | $8.31446\ \text{J}/(\text{mol}\cdot\text{K})$                             |
| $a_0, \dots, a_4$  | Polynomial coefficients for heat capacity                               | $\text{K}^0, \text{K}^{-1}, \text{K}^{-2}, \text{K}^{-3}, \text{K}^{-4}$  |
| $a_5, a_6$         | Integration constants for enthalpy of formation and reference entropy   | $\text{K}$ ($a_5$), dimensionless ($a_6$)                                 |

- Verifies continuity of $C_{p,k}^\circ$, $H_k^\circ$, and $S_k^\circ$ across the midpoint splitting temperature $T_{\text{mid}}$ and checks atomic elemental conservation across all elementary reactions.

### 2. Elementary, Three-Body & Troe Falloff Kinetics

Computes the forward rate constant via the 3-parameter modified Arrhenius expression—capturing collision frequency, temperature scaling, and the activation energy barrier—and derives the reverse rate constant from microscopic reversibility using the pressure-based equilibrium constant:

$$k_{f,j}(T) = A_j \, T^{\beta_j} \exp\!\left(-\frac{E_{a,j}}{RT}\right), \qquad k_{r,j}(T) = \frac{k_{f,j}(T)}{K_{p,j}(T)} \left(\frac{P^\circ}{RT}\right)^{\sum_k \nu_{k,j}}$$

| Symbol                   | Meaning                                                                                    | Units / Domain                                       |
| :----------------------- | :----------------------------------------------------------------------------------------- | :--------------------------------------------------- |
| $k_{f,j}(T), k_{r,j}(T)$ | Forward and reverse rate constants for reaction $j$                                        | $(\text{mol}/\text{m}^3)^{1-n}/\text{s}$ (order $n$) |
| $A_j$                    | Pre-exponential frequency factor for reaction $j$                                          | Matches $k_{f,j}$ units                              |
| $\beta_j$                | Temperature exponent for reaction $j$                                                      | Dimensionless                                        |
| $E_{a,j}$                | Activation energy for reaction $j$                                                         | $\text{J}/\text{mol}$                                |
| $R, T$                   | Universal gas constant and absolute temperature                                            | $\text{J}/(\text{mol}\cdot\text{K})$, $\text{K}$     |
| $K_{p,j}(T)$             | Pressure-based thermodynamic equilibrium constant for reaction $j$                         | Dimensionless                                        |
| $P^\circ$                | Standard-state reference pressure                                                          | $10^5\ \text{Pa}$ ($1\ \text{bar}$)                  |
| $\nu_{k,j}$              | Net stoichiometric coefficient of species $k$ in reaction $j$ ($\nu_{k,j}'' - \nu_{k,j}'$) | Dimensionless                                        |

- Supports third-body collision efficiencies $[M]_j = \sum_k \alpha_{j,k} [X_k]$ (`+ M`) and pressure-dependent **Lindemann / Troe falloff** blending between low-pressure ($k_0$) and high-pressure ($k_\infty$) limits via the reduced pressure $P_r = k_0 [M] / k_\infty$ and broadening factor $\log_{10} F_{\text{cent}}(T)$.

### 3. Non-Isothermal Reactor ODE Solver & DAE Lowering

Integrates coupled species molar production rates $\dot{\omega}_k = \sum_j (\nu_{k,j}'' - \nu_{k,j}') q_j$ together with the adiabatic energy balance, which governs how the mixture temperature rises or falls as chemical reactions release or absorb enthalpy:

$$\rho \bar{c}_p \frac{dT}{dt} = -\sum_{k=1}^{N_s} H_k^\circ(T) \, \dot{\omega}_k$$

| Symbol           | Meaning                                                           | Units / Domain                         |
| :--------------- | :---------------------------------------------------------------- | :------------------------------------- |
| $\rho$           | Gas mixture mass density                                          | $\text{kg}/\text{m}^3$                 |
| $\bar{c}_p$      | Mixture mass-averaged specific heat capacity at constant pressure | $\text{J}/(\text{kg}\cdot\text{K})$    |
| $T, t$           | Absolute gas temperature and simulation time                      | $\text{K}$, $\text{s}$                 |
| $N_s$            | Total number of chemical species in the mechanism                 | Integer ($\ge 1$)                      |
| $H_k^\circ(T)$   | Standard-state molar enthalpy of species $k$                      | $\text{J}/\text{mol}$                  |
| $\dot{\omega}_k$ | Net molar production rate of species $k$ per unit volume          | $\text{mol}/(\text{m}^3\cdot\text{s})$ |

- Lowers the full chemical kinetics and thermochemical network into `@modelscript/runtime`'s `DAEBuilder` arena and projects mechanisms into **Modelica 3.x** (`canteraToModelica`) and **SBML** (`canteraToSbml`).

---

## Pre-Flight Diagnostics

<LintRules lang="cantera" />

---

## CLI Usage

```bash
# Validate elemental balance, NASA-7 continuity, and Arrhenius parameters
msx lint H2Combustion.yaml

# Parse and inspect the Cantera mechanism structure
msx parse H2Combustion.yaml

# Evaluate NASA-7 thermodynamics and simulate adiabatic ignition delay
msx domain cantera inspect H2Combustion.yaml
```

---

## Programmatic TypeScript SDK

```typescript
import {
  parseCanteraModel,
  evaluateSpeciesThermo,
  simulateCanteraReactor,
  lowerCanteraToDae,
  canteraToModelica,
} from "@modelscript/cantera";
import { DAEBuilder } from "@modelscript/runtime";

const mech = parseCanteraModel(yamlSource);
const h2Thermo = evaluateSpeciesThermo(mech.species[0], 1200.0);

// Integrate adiabatic batch reactor ignition
const sim = simulateCanteraReactor(mech, { temperatureK: 1100, pressurePa: 101325, endTime: 1e-3 });

const builder = new DAEBuilder();
lowerCanteraToDae(mech, builder);
const modelicaSource = canteraToModelica(mech);
```

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="cantera" />
