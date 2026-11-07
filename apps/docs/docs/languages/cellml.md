---
title: CellML Cellular Electrophysiology & Physiome Modeling (.cellml)
description: Native WebAssembly parsing, 7-base SI dimensional unit consistency and component port directionality verification, Hodgkin-Huxley cardiac electrophysiology and Windkessel ODE integration, DAEBuilder lowering, and Modelica 3.x / SBML projections for CellML.
---

# CellML Cellular Electrophysiology & Physiome Modeling (`.cellml`)

`@modelscript/cellml` (`languages/cellml`) provides native WebAssembly parsing, 7-base SI dimensional unit consistency and component port directionality verification, Hodgkin-Huxley / cardiac action-potential and 0D microvascular Windkessel ODE integration, `DAEBuilder` lowering, and Modelica 3.x / SBML projections for **IUPS Physiome Project CellML (1.0 / 1.1 / 2.0)** physiological models.

---

## Supported Extensions & Standards

| Extension         | Format                 | Description                                                                                                          |
| :---------------- | :--------------------- | :------------------------------------------------------------------------------------------------------------------- |
| `.cellml`, `.xml` | CellML 1.0 / 1.1 / 2.0 | Modular XML specification of `units`, `component`, `variable`, MathML `math` ODEs, `connection`, and `encapsulation` |

---

## Key Capabilities

### 1. Modular Components, Encapsulation & 7-Base SI Dimensional Vector Algebra

- Parses `<units>` definitions (`prefix`, `multiplier`, `exponent`, `offset`) and reduces every custom physiological unit (e.g., $\text{mV}$, $\mu\text{A}/\text{cm}^2$, $\text{mS}/\text{cm}^2$, $\text{mmHg}$, $\text{mM}$) to its canonical 7-base SI dimensional exponent vector $\mathbf{d} \in \mathbb{Q}^7$ and scalar scale factor $s$:
  $$\mathbf{d}(u) = \begin{bmatrix} d_{\text{m}} & d_{\text{kg}} & d_{\text{s}} & d_{\text{A}} & d_{\text{K}} & d_{\text{mol}} & d_{\text{cd}} \end{bmatrix}^\top$$
- Verifies dimensional homogeneity ($\mathbf{d}(v_1) = \mathbf{d}(v_2)$) across all `<map_variables>` connections and enforces `public_interface` / `private_interface` (`in` / `out` / `none`) encapsulation hierarchy rules so no variable is driven by multiple `in` ports simultaneously.

### 2. Cardiac Action Potential & Microvascular Hemodynamics Solver

- Integrates membrane transmembrane potential $V_m(t)$ and voltage-dependent Hodgkin-Huxley / Noble / ten Tusscher ionic channel gating states $y_i(t) \in \{m, h, j, n, d, f, x_{r1}, x_{r2}, x_s\}$:
  $$C_m \frac{dV_m}{dt} = -\left(I_{\text{Na}} + I_{\text{K1}} + I_{\text{Kr}} + I_{\text{Ks}} + I_{\text{CaL}} + I_{\text{leak}} - I_{\text{stim}}(t)\right)$$
  $$I_{\text{Na}} = \bar{g}_{\text{Na}} m^3 h j (V_m - E_{\text{Na}}), \qquad \frac{dy_i}{dt} = \alpha_{y_i}(V_m)(1 - y_i) - \beta_{y_i}(V_m)y_i = \frac{y_{i,\infty}(V_m) - y_i}{\tau_{y_i}(V_m)}$$
- Supports coupled 0D 3-element Windkessel arterial/venous hemodynamic compliance loops ($C_{\text{art}} \frac{dP_{\text{art}}}{dt} = Q_{\text{in}}(t) - \frac{P_{\text{art}} - P_{\text{ven}}}{R_{\text{periph}}}$).

### 3. DAE Arena Lowering & Modelica / SBML Projection

- Lowers modular CellML component networks and MathML differential/algebraic equations into `@modelscript/runtime`'s `DAEBuilder` arena (`lowerCellmlToDae`) and projects models into **Modelica 3.x** (`cellmlToModelica`) and **SBML Level 3** (`cellmlToSbml`).

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

# Project CellML model to Modelica 3.x, SBML, or DAE arena
msx cellml to-modelica HodgkinHuxley.cellml > HodgkinHuxley.mo
msx cellml to-sbml HodgkinHuxley.cellml > HodgkinHuxley.sbml
msx cellml to-dae HodgkinHuxley.cellml
```

---

## Programmatic TypeScript SDK

```typescript
import {
  parseCellmlModel,
  simulateCellmlElectrophysiology,
  lowerCellmlToDae,
  cellmlToModelica,
  cellmlToSbml,
} from "@modelscript/cellml";
import { DAEBuilder } from "@modelscript/runtime";

const model = parseCellmlModel(cellmlXmlSource);
const trajectory = simulateCellmlElectrophysiology(model, 50.0, 0.02);

const builder = new DAEBuilder();
lowerCellmlToDae(model, builder);
const modelicaCode = cellmlToModelica(model);
const sbmlXml = cellmlToSbml(model);
```
