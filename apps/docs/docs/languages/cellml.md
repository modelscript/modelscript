# CellML Cellular Electrophysiology & Physiome Modeling (`.cellml`)

`@modelscript/cellml` (`languages/cellml`) provides native WebAssembly parsing, 7-base SI dimensional unit consistency and component port directionality verification, Hodgkin-Huxley / cardiac action-potential and 0D microvascular Windkessel ODE integration, `DAEBuilder` lowering, and Modelica 3.x / SBML projections for **IUPS Physiome Project CellML (1.0 / 1.1 / 2.0)** physiological models.

---

## Supported Extensions & Standards

| Extension         | Format                 | Description                                                                                                          |
| :---------------- | :--------------------- | :------------------------------------------------------------------------------------------------------------------- |
| `.cellml`, `.xml` | CellML 1.0 / 1.1 / 2.0 | Modular XML specification of `units`, `component`, `variable`, MathML `math` ODEs, `connection`, and `encapsulation` |

---

## Key Capabilities

### 1. Modular Components, Encapsulation & 7-Base SI Units

- Parses `<units>` definitions (`prefix`, `multiplier`, `exponent` over SI base units `ampere`, `candela`, `kelvin`, `kilogram`, `metre`, `mole`, `second`) and verifies dimensional homogeneity across `<map_variables>` component connections.
- Enforces `public_interface` and `private_interface` (`in` / `out` / `none`) encapsulation rules.

### 2. Cardiac Action Potential & Microvascular Hemodynamics Solver

- Integrates membrane voltage $V_m$ and ionic gating variables ($m, h, n, d, f, x_r$) across Hodgkin-Huxley, Noble, Luo-Rudy, and ten Tusscher cardiac electrophysiology models alongside 0D Windkessel arterial/venous perfusion loops:
  $$C_m \frac{dV_m}{dt} = -\left(I_{\text{Na}} + I_{\text{K}} + I_{\text{CaL}} + I_{\text{leak}} - I_{\text{stim}}(t)\right), \qquad \frac{dy}{dt} = \alpha_y(V_m)(1 - y) - \beta_y(V_m)y$$

### 3. DAE Arena Lowering & Modelica / SBML Projection

- Lowers modular CellML equations into `@modelscript/runtime`'s `DAEBuilder` arena and projects models into **Modelica 3.x** (`cellmlToModelica`) and **SBML** (`cellmlToSbml`).

---

## Pre-Flight Diagnostics

<LintRules lang="cellml" />

---

## CLI Usage

```bash
# Inspect CellML components, variables, units, and connections
msx cellml inspect HodgkinHuxley.cellml

# Validate SI dimensional unit compatibility and interface directions
msx cellml validate HodgkinHuxley.cellml

# Integrate cellular electrophysiology ODE trajectories
msx cellml simulate HodgkinHuxley.cellml

# Project CellML model to Modelica 3.x or SBML
msx cellml to-modelica HodgkinHuxley.cellml > HodgkinHuxley.mo
msx cellml to-sbml HodgkinHuxley.cellml > HodgkinHuxley.sbml
```
