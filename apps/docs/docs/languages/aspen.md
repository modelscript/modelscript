# Aspen Plus & HYSYS Chemical Process (`.in`, `.inp`, `.bkp`)

`@modelscript/aspen` (`languages/aspen`) provides zero-regex parsing, vapor-liquid equilibrium (VLE) flash computation, distillation column MESH equations, DAE lowering, and Modelica 3.x projection for **Aspen Plus** and **Aspen HYSYS** chemical flowsheet input decks.

---

## Supported Extensions & Standards

| Extension      | Format                | Description                                                                          |
| :------------- | :-------------------- | :----------------------------------------------------------------------------------- |
| `.in` / `.inp` | Aspen Plus Input File | Keyword-sectioned chemical process flowsheet, unit operations, stream thermodynamics |
| `.bkp`         | Aspen Backup Deck     | Serialized ASCII Aspen model topology and stream definitions                         |

---

## Key Capabilities

### 1. Rachford-Rice Vapor-Liquid Equilibrium (VLE) Flash Solver

- Solves isothermal ($T$-$P$) and adiabatic ($P$-$H$) flash equilibrium via the **Rachford-Rice equation**:
  $$f(\psi) = \sum_{i=1}^{C} \frac{z_i (K_i - 1)}{1 + \psi (K_i - 1)} = 0$$
  where $\psi = V/F$ is the vapor fraction, $z_i$ is the feed mole fraction, and $K_i(T, P)$ is the equilibrium ratio:
  $$K_i = \frac{y_i}{x_i} = \frac{\gamma_i P_i^{\text{sat}}(T)}{\phi_i P}$$
- Uses modified **Antoine vapor pressure** equations:
  $$\ln P_i^{\text{sat}} = A_i - \frac{B_i}{T + C_i}$$
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
