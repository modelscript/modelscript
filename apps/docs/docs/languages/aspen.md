---
title: "Aspen-Compatible Chemical Process Modeling (.in, .inp, .bkp)"
description: "@modelscript/aspen (languages/aspen) provides zero-regex parsing, vapor-liquid equilibrium (VLE) flash computation, distillation column MESH equations, DAE lowering, and Modelica 3.x projection for..."
---

# Aspen-Compatible Chemical Process Modeling (`.in`, `.inp`, `.bkp`)

`@modelscript/aspen` (`languages/aspen`) provides zero-regex parsing, vapor-liquid equilibrium (VLE) flash computation, distillation column MESH equations, DAE lowering, and Modelica 3.x projection for **Aspen Plus- and Aspen HYSYS-compatible** chemical flowsheet input decks.

---

## Supported Extensions & Standards

| Extension      | Format                | Description                                                                          |
| :------------- | :-------------------- | :----------------------------------------------------------------------------------- |
| `.in` / `.inp` | Aspen Plus Input File | Keyword-sectioned chemical process flowsheet, unit operations, stream thermodynamics |
| `.bkp`         | Aspen Backup Deck     | Serialized ASCII Aspen model topology and stream definitions                         |

---

## Key Capabilities

### 1. Rachford-Rice Vapor-Liquid Equilibrium (VLE) Flash Solver

- Solves isothermal ($T$-$P$) and adiabatic ($P$-$H$) flash equilibrium via the **Rachford-Rice equation**, which enforces that the sum of vapor and liquid mole fractions equals unity at phase equilibrium:
  $$f(\psi) = \sum_{i=1}^{C} \frac{z_i (K_i - 1)}{1 + \psi (K_i - 1)} = 0$$
  and computes the vapor-liquid equilibrium ratio $K_i$ relating vapor and liquid compositions from component non-ideality and saturation pressure:
  $$K_i = \frac{y_i}{x_i} = \frac{\gamma_i P_i^{\text{sat}}(T)}{\phi_i P}$$

  | Symbol                | Meaning                                                     | Units / Domain                                  |
  | :-------------------- | :---------------------------------------------------------- | :---------------------------------------------- |
  | $\psi$                | Molar vapor fraction ($V/F$)                                | Dimensionless, $\psi \in [0, 1]$                |
  | $C$                   | Number of chemical components in the mixture                | Positive integer                                |
  | $z_i$                 | Overall feed mole fraction of component $i$                 | Dimensionless, $z_i \in [0, 1]$, $\sum z_i = 1$ |
  | $K_i$                 | Vapor-liquid equilibrium $K$-value for component $i$        | Dimensionless ($K_i > 0$)                       |
  | $y_i, x_i$            | Vapor and liquid phase mole fractions of component $i$      | Dimensionless, $[0, 1]$                         |
  | $\gamma_i$            | Liquid-phase activity coefficient of component $i$          | Dimensionless ($\gamma_i > 0$)                  |
  | $\phi_i$              | Vapor-phase fugacity coefficient of component $i$           | Dimensionless ($\phi_i > 0$)                    |
  | $P_i^{\text{sat}}(T)$ | Pure-component saturation vapor pressure at temperature $T$ | $\text{Pa}$ or $\text{bar}$                     |
  | $P$                   | System pressure                                             | $\text{Pa}$ or $\text{bar}$                     |

- Uses modified **Antoine vapor pressure** equations to correlate each component's saturation pressure as a function of temperature:
  $$\ln P_i^{\text{sat}} = A_i - \frac{B_i}{T + C_i}$$
  where $T$ is system temperature ($\text{K}$ or $^\circ\text{C}$), and $A_i, B_i, C_i$ are empirical Antoine constants specific to component $i$ (matching the pressure and temperature units).
- Implements subcooled liquid ($\sum z_i K_i < 1$) and superheated vapor ($\sum z_i / K_i < 1$) state identification with monotonic Newton-Raphson bracket solving.

### 2. Unit Operations & Distillation Columns

- **Mixers & Splitters**: Rigorous material balance ($\sum F_{\text{in}} = \sum F_{\text{out}}$) and energy conservation ($\sum \dot{H}_{\text{in}} = \sum \dot{H}_{\text{out}}$).
- **Heaters & Coolers**: Specified duty ($Q$) or target outlet temperature/vapor fraction.
- **Flash Separators**: Multi-component 2-phase and 3-phase phase separation vessels.
- **RadFrac Equilibrium Distillation Columns**: Rigorous stage-by-stage **MESH equations** (Material balance, Equilibrium, Summation, Heat/enthalpy balance).

### 3. Direct Linear-Memory DAE Lowering

- Compiles flowsheet topology, stream molar balances, and component enthalpies directly into `@modelscript/runtime`'s `DAEBuilder` struct-of-arrays linear memory arena without intermediary AST allocations.
- Emits continuous DAE systems with algebraic stream constraints for joint dynamic simulation with pipeline networks ([`@modelscript/lps`](./lps.md)) and multiphase transient pipelines ([`@modelscript/olga`](./olga.md)).

### 4. Bidirectional Modelica 3.x Projection

- Translates unit operations into standardized `Modelica.Fluid` or OpenIPSL thermal-fluid models with acausal fluid ports (`m_flow`, `p`, `h`, `Xi`).

---

## Pre-Flight Diagnostics

The Aspen analyzer inspects flowsheet connectivity, phase equilibria, and thermodynamic consistency:

<LintRules lang="aspen" />

---

## CLI Usage

```bash
# Inspect flowsheet components, blocks, and stream properties
msx aspen inspect MethanolWaterPlant.inp

# Run pre-flight semantic diagnostics
msx aspen lint MethanolWaterPlant.inp

# Solve isothermal flash VLE for a feed stream
msx aspen solve-flash MethanolWaterPlant.inp --stream FEED

# Lower flowsheet to ModelScript linear DAE arena
msx aspen to-dae MethanolWaterPlant.inp

# Project into Modelica 3.x acausal fluid stream model
msx aspen to-modelica MethanolWaterPlant.inp -o MethanolPlant.mo
```

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="aspen" />
