---
title: USGS PHREEQC Aqueous Geochemistry (.pqi, .dat)
description: Compiler reference for USGS PHREEQC hydrogeochemical input decks (.pqi) and thermodynamic databases (.dat), Debye-Hückel/Davies speciation, mineral saturation indices, and DAE/Modelica projections.
---

# USGS PHREEQC Aqueous Geochemistry & Speciation (`.pqi`, `.dat`)

`@modelscript/phreeqc` (`languages/phreeqc`) provides native WebAssembly GLR parsing, ionic strength and Davies / Extended Debye-Hückel activity coefficient calculation, aqueous carbonate/redox speciation, mineral Saturation Index ($\text{SI}$) evaluation, `DAEBuilder` lowering, and Modelica 3.x projection for **USGS PHREEQC** hydrogeochemical, brine scaling, carbon mineralization, and water treatment models.

---

## Supported Extensions & Standards

| Extension | Format                 | Description                                                                                                              |
| :-------- | :--------------------- | :----------------------------------------------------------------------------------------------------------------------- |
| `.pqi`    | PHREEQC Input Deck     | Keyword data blocks (`TITLE`, `SOLUTION`, `EQUILIBRIUM_PHASES`, `REACTION`, `KINETICS`, `MIX`, `SELECTED_OUTPUT`, `END`) |
| `.dat`    | Thermodynamic Database | Aqueous species (`SOLUTION_SPECIES`) and mineral solubility (`PHASES`) database definitions                              |

---

## Governing Mathematical Formulation

### 1. Ionic Strength, Electrical Charge Balance & Activity Coefficients

For an aqueous solution containing $N_s$ dissolved ionic species, the molal ionic strength $I$ quantifies total electrostatic concentration and the electrical Charge Balance Error ($\text{CBE}$) checks solution electroneutrality:

$$
I = \frac{1}{2} \sum_{i=1}^{N_s} m_i z_i^2, \qquad
\text{CBE (\%)} = 100 \times \frac{\sum_{i=1}^{N_s} m_i z_i}{\sum_{i=1}^{N_s} m_i |z_i|}
$$

Single-ion activity coefficients $\gamma_i$ ($a_i = \gamma_i m_i$) account for non-ideal electrostatic interactions using the **WATEQ Extended Debye-Hückel** equation (when ion-size parameters $\mathring{a}_i, b_i$ are specified in `.dat`) or the **Davies** equation ($I \lesssim 0.5\text{ mol/kgw}$):

$$
\log_{10} \gamma_i = \begin{cases}
  -\dfrac{A(T)\, z_i^2 \sqrt{I}}{1 + B(T)\,\mathring{a}_i \sqrt{I}} + b_i I & \text{(Extended Debye-Hückel)}, \\[10pt]
  -A(T)\, z_i^2 \left(\dfrac{\sqrt{I}}{1 + \sqrt{I}} - 0.3\, I\right) & \text{(Davies)}.
\end{cases}
$$

| Symbol                | Meaning                                                        | Units / Domain                                                |
| :-------------------- | :------------------------------------------------------------- | :------------------------------------------------------------ |
| $I$                   | Molal ionic strength                                           | $\text{mol/kgw}$, $\ge 0$                                     |
| $N_s$                 | Number of dissolved aqueous species                            | dimensionless, $\mathbb{Z}_{>0}$                              |
| $m_i, z_i$            | Molality and formal ionic charge of species $i$                | $\text{mol/kgw}$, $\mathbb{Z}$                                |
| $\text{CBE (\%)}$     | Electrical charge balance error percentage                     | $\%$, $[-100, 100]$                                           |
| $\gamma_i, a_i$       | Activity coefficient and thermodynamic activity of species $i$ | dimensionless, $> 0$                                          |
| $A(T), B(T)$          | Temperature-dependent Debye-Hückel solvent parameters          | $(\text{kgw/mol})^{1/2}$, $(\text{kgw/mol})^{1/2}/\text{\AA}$ |
| $\mathring{a}_i, b_i$ | WATEQ ion-size parameter and salting-out coefficient           | $\text{\AA}$, $\text{kgw/mol}$                                |

### 2. Mineral Saturation Indices ($\text{SI}$) & Transition-State Theory (TST) Kinetics

For a mineral dissolution reaction $M \rightleftharpoons \sum_i \nu_{im} S_i$ with temperature-corrected solubility product $K_{\text{sp},m}(T)$ (Van 't Hoff $\Delta H_r^\circ$ or 6-term analytical $\log_{10} K(T)$ polynomial), the **Ion Activity Product ($\text{IAP}_m$)**, **Saturation Index ($\text{SI}_m$)**, and saturation ratio $\Omega_m$ indicate whether the solution is undersaturated ($\text{SI}_m < 0$, dissolving) or supersaturated ($\text{SI}_m > 0$, precipitating):

$$
\text{IAP}_m = \prod_{i=1}^{N_s} a_i^{\nu_{im}}, \qquad
\text{SI}_m = \log_{10}\!\left(\frac{\text{IAP}_m}{K_{\text{sp},m}(T)}\right), \qquad
\Omega_m = 10^{\text{SI}_m}
$$

In `KINETICS` blocks, Palandri-Kharaka / Lasaga Transition-State Theory (TST) mineral dissolution/precipitation rates $R_m$ sum parallel acid, neutral, and base-catalyzed pathways scaled by reactive surface area and thermodynamic affinity:

$$
R_m = A_m \left(k_{\text{acid}} a_{\text{H}^+}^{n_{\text{H}}} + k_{\text{neutral}} + k_{\text{base}} a_{\text{OH}^-}^{n_{\text{OH}}}\right) \left(1 - \Omega_m^{p_m}\right)^{q_m}
$$

| Symbol                                                 | Meaning                                                                  | Units / Domain                      |
| :----------------------------------------------------- | :----------------------------------------------------------------------- | :---------------------------------- |
| $\text{IAP}_m, K_{\text{sp},m}(T)$                     | Ion activity product and solubility product of mineral $m$               | dimensionless, $> 0$                |
| $\nu_{im}$                                             | Stoichiometric coefficient of species $i$ in mineral $m$                 | dimensionless, $\mathbb{R}$         |
| $\text{SI}_m, \Omega_m$                                | Saturation index and saturation ratio ($\text{IAP}_m / K_{\text{sp},m}$) | dimensionless ($\mathbb{R}$, $> 0$) |
| $R_m$                                                  | Net mineral dissolution/precipitation rate                               | $\text{mol/(kgw}\cdot\text{s)}$     |
| $A_m$                                                  | Reactive mineral surface area per kg water                               | $\text{m}^2/\text{kgw}$, $\ge 0$    |
| $k_{\text{acid}}, k_{\text{neutral}}, k_{\text{base}}$ | Acid, neutral, and base rate constants                                   | $\text{mol/(m}^2\cdot\text{s)}$     |
| $a_{\text{H}^+}, a_{\text{OH}^-}$                      | Thermodynamic activities of $\text{H}^+$ and $\text{OH}^-$               | dimensionless, $> 0$                |
| $n_{\text{H}}, n_{\text{OH}}$                          | Empirical reaction orders for $\text{H}^+$ and $\text{OH}^-$             | dimensionless, $\mathbb{R}$         |
| $p_m, q_m$                                             | Empirical Temkin / affinity exponents                                    | dimensionless, $> 0$                |

---

## `DAEBuilder` Arena Lowering & Cross-Language Projections

- **Direct `DAEBuilder` Lowering (`lowerPhreeqcToDae`)**: Lowers aqueous mass-action equilibria, electroneutrality algebraic constraints ($\sum m_i z_i = 0$), and kinetic mineral dissolution ODEs ($dm_m/dt = -R_m$) into `@modelscript/runtime`'s `DAEBuilder` arena.
- **Modelica 3.x Projection (`phreeqcToModelica`)**: Generates acausal hydrochemical speciation and scaling blocks compatible with [EPANET](./epanet.md) water distribution and [OLGA](./olga.md) / [ECLIPSE](./eclipse.md) oilfield brine flowassurance workflows.

---

## Pre-Flight Diagnostics

<LintRules lang="phreeqc" />

---

## CLI Usage

```bash
# Validate electrical charge balance, pH/pe bounds, and phase blocks
msx lint GeothermalBrine.pqi

# Parse and inspect PHREEQC keyword blocks
msx parse GeothermalBrine.pqi

# Run aqueous speciation and mineral saturation index calculations
msx domain phreeqc inspect GeothermalBrine.pqi
```

---

## Programmatic TypeScript SDK

```typescript
import {
  lintPhreeqc,
  lowerPhreeqcToDae,
  parsePhreeqc,
  phreeqcToModelica,
  solvePhreeqcSpeciation,
} from "@modelscript/phreeqc";

const deck = parsePhreeqc(pqiText);
const diagnostics = lintPhreeqc(deck);
const speciation = solvePhreeqcSpeciation(deck);
const dae = lowerPhreeqcToDae(deck);
const moCode = phreeqcToModelica(deck);
```

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="phreeqc" />
