---
title: "RELAP5-3D-Compatible Nuclear Reactor Thermal-Hydraulics (.i, .inp, .r5)"
description: "@modelscript/relap5 (languages/relap5) provides high-fidelity 80-column card deck parsing, non-equilibrium two-phase hydrodynamic modeling, 6-group delayed neutron point kinetics solving, DAE lower..."
---

# RELAP5-3D-Compatible Nuclear Reactor Thermal-Hydraulics (`.i`, `.inp`, `.r5`)

`@modelscript/relap5` (`languages/relap5`) provides high-fidelity 80-column card deck parsing, non-equilibrium two-phase hydrodynamic modeling, 6-group delayed neutron point kinetics solving, DAE lowering, and Modelica 3.x projection for **RELAP5-3D-compatible** nuclear reactor systems, thermal-hydraulic loops, and safety margin evaluations.

---

## Supported Extensions & Standards

| Extension     | Format                 | Description                                                                                             |
| :------------ | :--------------------- | :------------------------------------------------------------------------------------------------------ |
| `.i` / `.inp` | RELAP5 Input Card Deck | Fixed-column card deck specifying hydrodynamic volumes, junctions, heat structures, trips, and kinetics |
| `.r5`         | RELAP5-3D System Deck  | Multi-loop PWR/BWR coolant systems, steam generators, emergency core cooling systems (ECCS)             |

---

## Key Capabilities

### 1. Two-Phase Non-Equilibrium Hydrodynamics

- Employs a full **6-equation two-fluid formulation** with separate mass, momentum, and energy conservation equations for liquid ($l$) and vapor ($v$) phases:
  - **Phase Mass Conservation** (balances phasic mass accumulation and axial advection against interfacial mass transfer):
    $$\frac{\partial}{\partial t} (\alpha_k \rho_k) + \frac{1}{A} \frac{\partial}{\partial x} (\alpha_k \rho_k v_k A) = \Gamma_k \quad (k \in \{l, v\})$$
  - **Phase Momentum Conservation** (balances phasic inertia against pressure gradients, gravity, wall/interfacial drag, and momentum exchange from phase change):
    $$\alpha_k \rho_k \frac{\partial v_k}{\partial t} + \alpha_k \rho_k v_k \frac{\partial v_k}{\partial x} = -\alpha_k \frac{\partial P}{\partial x} + \alpha_k \rho_k g \cos \theta - F_{\text{wall},k} - F_{\text{inter},k} + \Gamma_k (v_{ki} - v_k)$$
  - **Phase Energy Conservation** (balances phasic internal energy accumulation and advection against pressure-volume work, wall/interfacial heat transfer, and latent enthalpy transport):
    $$\frac{\partial}{\partial t} (\alpha_k \rho_k u_k) + \frac{1}{A} \frac{\partial}{\partial x} (\alpha_k \rho_k u_k v_k A) = -P \left[ \frac{\partial \alpha_k}{\partial t} + \frac{1}{A} \frac{\partial}{\partial x} (\alpha_k v_k A) \right] + Q_{\text{wall},k} + Q_{\text{inter},k} + \Gamma_k h_{ki}$$

  | Symbol                                  | Meaning                                                              | Units / Domain                               |
  | :-------------------------------------- | :------------------------------------------------------------------- | :------------------------------------------- |
  | $k$                                     | Phase index ($l$ for liquid, $v$ for vapor)                          | $\{l, v\}$                                   |
  | $t, x$                                  | Time and axial spatial coordinate                                    | $\text{s}$, $\text{m}$                       |
  | $\alpha_k$                              | Volume fraction (void fraction for $k=v$) of phase $k$               | dimensionless, $[0, 1]$                      |
  | $\rho_k, v_k, u_k$                      | Density, axial velocity, and specific internal energy of phase $k$   | $\text{kg/m}^3$, $\text{m/s}$, $\text{J/kg}$ |
  | $A$                                     | Pipe or channel cross-sectional flow area                            | $\text{m}^2$, $> 0$                          |
  | $\Gamma_k$                              | Volumetric interfacial mass generation rate into phase $k$           | $\text{kg/(m}^3\cdot\text{s)}$               |
  | $P$                                     | Local thermodynamic fluid pressure                                   | $\text{Pa}$, $> 0$                           |
  | $g, \theta$                             | Gravitational acceleration and channel inclination from vertical     | $\text{m/s}^2$, $\text{rad}$                 |
  | $F_{\text{wall},k}, F_{\text{inter},k}$ | Wall and interfacial drag forces per unit volume                     | $\text{N/m}^3$                               |
  | $v_{ki}, h_{ki}$                        | Interfacial velocity and specific enthalpy associated with phase $k$ | $\text{m/s}$, $\text{J/kg}$                  |
  | $Q_{\text{wall},k}, Q_{\text{inter},k}$ | Wall and interfacial volumetric heat transfer rates to phase $k$     | $\text{W/m}^3$                               |

- Tracks interphase friction, bubbly/slug/annular flow regime transitions, and subcooled boiling.

### 2. 6-Group Delayed Neutron Point Kinetics & Reactivity Feedback

- Solves the stiff coupled ODEs governing reactor core thermal power and delayed neutron precursor concentrations during transients and reactor SCRAM:
  $$\frac{dP}{dt} = \frac{\rho(t) - \beta}{\Lambda} P(t) + \sum_{i=1}^{6} \lambda_i C_i(t)$$
  $$\frac{dC_i}{dt} = \frac{\beta_i}{\Lambda} P(t) - \lambda_i C_i(t) \quad (i = 1, \dots, 6)$$
- Incorporates dynamic physical reactivity feedback from control rods, fuel Doppler broadening, and moderator density changes, ensuring negative Doppler fuel temperature feedback stabilizes reactor transients:
  $$\rho(t) = \rho_{\text{control}}(t) + \alpha_{\text{Doppler}} \left( \sqrt{T_{\text{fuel}}} - \sqrt{T_{\text{fuel},0}} \right) + \alpha_{\text{density}} (\rho_{\text{mod}} - \rho_{\text{mod},0})$$

  | Symbol                                   | Meaning                                                                           | Units / Domain                         |
  | :--------------------------------------- | :-------------------------------------------------------------------------------- | :------------------------------------- |
  | $P(t)$                                   | Normalized reactor thermal power                                                  | dimensionless (or $\text{W}$), $\ge 0$ |
  | $C_i(t)$                                 | Delayed neutron precursor concentration for group $i$                             | normalized power units, $\ge 0$        |
  | $\rho(t), \rho_{\text{control}}(t)$      | Total and control-rod reactivity ($\Delta k / k$)                                 | dimensionless ($\mathbb{R}$)           |
  | $\beta_i, \beta$                         | Delayed neutron fraction for group $i$ and total ($\beta = \sum_{i=1}^6 \beta_i$) | dimensionless, $> 0$                   |
  | $\Lambda$                                | Prompt neutron generation time                                                    | $\text{s}$, $> 0$                      |
  | $\lambda_i$                              | Decay constant of delayed neutron precursor group $i$                             | $\text{s}^{-1}$, $> 0$                 |
  | $\alpha_{\text{Doppler}}$                | Fuel Doppler reactivity coefficient                                               | $\text{K}^{-1/2}$                      |
  | $T_{\text{fuel}}, T_{\text{fuel},0}$     | Instantaneous and reference fuel temperatures                                     | $\text{K}$, $> 0$                      |
  | $\alpha_{\text{density}}$                | Moderator density reactivity coefficient                                          | $\text{m}^3/\text{kg}$                 |
  | $\rho_{\text{mod}}, \rho_{\text{mod},0}$ | Instantaneous and reference moderator densities                                   | $\text{kg/m}^3$, $> 0$                 |

### 3. Direct DAE Lowering

- Compiles hydrodynamic volumes, inter-volume junctions, and heat structures into `@modelscript/runtime`'s `DAEBuilder` linear memory arena.
- Enables co-simulation between nuclear primary coolant loops, secondary steam turbine power plants, and electrical generator controls ([`@modelscript/psse`](./psse.md)).

### 4. Bidirectional Modelica 3.x Projection

- Projects RELAP5 primary loops and core volumes into `Modelica.Fluid` two-phase thermal hydraulic circuits and nuclear reactor models.

---

## Pre-Flight Diagnostics

The RELAP5 parser and validator enforce card syntax, hydrodynamic connectivity, and trip cutset safety:

<LintRules lang="relap5" />

---

## CLI Usage

```bash
# Inspect hydrodynamic volumes, junctions, and core kinetics cards
msx relap5 inspect PwrPrimaryLoop.i

# Run pre-flight card validation and trip logic cutset analysis
msx relap5 lint PwrPrimaryLoop.i

# Simulate 6-group delayed neutron point kinetics during rod drop / SCRAM
msx relap5 kinetics PwrPrimaryLoop.i --duration=10.0

# Lower two-phase volumes and kinetics into ModelScript linear DAE arena
msx relap5 to-dae PwrPrimaryLoop.i

# Project into Modelica 3.x two-phase nuclear thermal-hydraulics model
msx relap5 to-modelica PwrPrimaryLoop.i -o NuclearLoop.mo
```

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="relap5" />
