# RELAP5 Nuclear Reactor Thermal-Hydraulics (`.i`, `.inp`, `.r5`)

`@modelscript/relap5` (`languages/relap5`) provides high-fidelity 80-column card deck parsing, non-equilibrium two-phase hydrodynamic modeling, 6-group delayed neutron point kinetics solving, DAE lowering, and Modelica 3.x projection for **INL RELAP5-3D** nuclear reactor systems, thermal-hydraulic loops, and safety margin evaluations.

---

## Supported Extensions & Standards

| Extension     | Format                 | Description                                                                                             |
| :------------ | :--------------------- | :------------------------------------------------------------------------------------------------------ |
| `.i` / `.inp` | RELAP5 Input Card Deck | Fixed-column card deck specifying hydrodynamic volumes, junctions, heat structures, trips, and kinetics |
| `.r5`         | RELAP5-3D System Deck  | Multi-loop PWR/BWR coolant systems, steam generators, emergency core cooling systems (ECCS)             |

---

## Key Capabilities

### 1. Two-Phase Non-Equilibrium Hydrodynamics

- Employs a full **6-equation two-fluid formulation** with separate mass, momentum, and energy conservation equations for liquid and vapor phases:
  - **Phase Mass Conservation**:
    $$\frac{\partial}{\partial t} (\alpha_k \rho_k) + \frac{1}{A} \frac{\partial}{\partial x} (\alpha_k \rho_k v_k A) = \Gamma_k \quad (k \in \{l, v\})$$
  - **Phase Momentum Conservation**:
    $$\alpha_k \rho_k \frac{\partial v_k}{\partial t} + \alpha_k \rho_k v_k \frac{\partial v_k}{\partial x} = -\alpha_k \frac{\partial P}{\partial x} + \alpha_k \rho_k g \cos \theta - F_{\text{wall},k} - F_{\text{inter},k} + \Gamma_k (v_{ki} - v_k)$$
  - **Phase Energy Conservation**:
    $$\frac{\partial}{\partial t} (\alpha_k \rho_k u_k) + \frac{1}{A} \frac{\partial}{\partial x} (\alpha_k \rho_k u_k v_k A) = -P \left[ \frac{\partial \alpha_k}{\partial t} + \frac{1}{A} \frac{\partial}{\partial x} (\alpha_k v_k A) \right] + Q_{\text{wall},k} + Q_{\text{inter},k} + \Gamma_k h_{ki}$$
- Tracks interphase friction, bubbly/slug/annular flow regime transitions, and subcooled boiling.

### 2. 6-Group Delayed Neutron Point Kinetics & Reactivity Feedback

- Solves the stiff differential equations of reactor core power during transients and reactor SCRAM:
  $$\frac{dP}{dt} = \frac{\rho(t) - \beta}{\Lambda} P(t) + \sum_{i=1}^{6} \lambda_i C_i(t)$$
  $$\frac{dC_i}{dt} = \frac{\beta_i}{\Lambda} P(t) - \lambda_i C_i(t) \quad (i = 1, \dots, 6)$$
  where $P$ is normalized thermal power, $\Lambda$ is prompt neutron generation time, and $\beta = \sum \beta_i$ is delayed neutron fraction.
- Incorporates dynamic physical reactivity feedback:
  $$\rho(t) = \rho_{\text{control}}(t) + \alpha_{\text{Doppler}} \left( \sqrt{T_{\text{fuel}}} - \sqrt{T_{\text{fuel},0}} \right) + \alpha_{\text{density}} (\rho_{\text{mod}} - \rho_{\text{mod},0})$$
  ensuring negative Doppler fuel temperature feedback stabilizes reactor transients.

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
