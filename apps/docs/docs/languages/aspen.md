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
- Emits continuous DAE systems with algebraic stream constraints for joint dynamic simulation with pipeline networks ([`@modelscript/lps`](file:///home/omar/git3/modelscript/languages/lps)) and multiphase transient pipelines ([`@modelscript/olga`](file:///home/omar/git3/modelscript/languages/olga)).

### 4. Bidirectional Modelica 3.x Projection

- Translates unit operations into standardized `Modelica.Fluid` or OpenIPSL thermal-fluid models with acausal fluid ports (`m_flow`, `p`, `h`, `Xi`).

---

## Pre-Flight Diagnostics (`M8101`–`M8120`)

The Aspen analyzer inspects flowsheet connectivity, phase equilibria, and thermodynamic consistency:

| Code    | Severity  | Rule Identifier                   | Condition Checked                                                                |
| :------ | :-------- | :-------------------------------- | :------------------------------------------------------------------------------- |
| `M8101` | `error`   | `unconnected-stream`              | Stream references non-existent unit operation block or unconnected port.         |
| `M8102` | `warning` | `circular-flowsheet-recycle`      | Closed recycle loop detected without an explicit tear stream declaration.        |
| `M8103` | `error`   | `duplicate-block-id`              | Unit operation block identifier declared multiple times in flowsheet.            |
| `M8104` | `error`   | `negative-component-fraction`     | Component mole/mass fraction $z_i < 0$.                                          |
| `M8108` | `error`   | `component-fractions-sum-invalid` | Component fractions in feed stream do not sum to unity ($\sum z_i \ne 1.0$).     |
| `M8109` | `error`   | `radfrac-stage-out-of-bounds`     | Feed or sidestream stage outside column range ($1 \le s \le N_{\text{stages}}$). |
| `M8112` | `error`   | `negative-absolute-temperature`   | Stream temperature is below absolute zero ($T < 0\text{ K}$).                    |
| `M8113` | `error`   | `non-positive-pressure`           | Stream pressure is non-positive ($P \le 0\text{ bar}$).                          |

---

## CLI Usage

```bash
# Inspect flowsheet components, blocks, and stream properties
msx aspen inspect MethanolWaterPlant.inp

# Run pre-flight semantic diagnostics
msx aspen lint MethanolWaterPlant.inp

# Solve isothermal flash VLE for feed streams
msx aspen solve-flash MethanolWaterPlant.inp --temp=350 --pres=1.013

# Lower flowsheet to ModelScript linear DAE arena
msx aspen to-dae MethanolWaterPlant.inp

# Project into Modelica 3.x acausal fluid stream model
msx aspen to-modelica MethanolWaterPlant.inp -o MethanolPlant.mo
```
