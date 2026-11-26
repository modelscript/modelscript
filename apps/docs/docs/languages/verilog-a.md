---
title: "Verilog-A & Verilog-AMS Compact Modeling (.va, .vams)"
description: "@modelscript/verilog-a provides native compilation, analog behavioral simulation, continuous DAE lowering, and SPICE netlist export for Accellera Verilog-A."
---

# Verilog-A & Verilog-AMS Compact Modeling (`.va`, `.vams`)

`@modelscript/verilog-a` (`languages/verilog-a`) provides compiler, analog behavioral simulation, continuous DAE lowering, and SPICE netlist export for **Accellera Verilog-A** and **Verilog-AMS** compact device modeling.

---

## Supported Extensions & Standards

| Extension | Standard / Format             | Description                                                     |
| :-------- | :---------------------------- | :-------------------------------------------------------------- |
| `.va`     | **OVI / Accellera Verilog-A** | Continuous-time analog behavioral hardware description language |
| `.vams`   | **Accellera Verilog-AMS**     | Mixed-signal analog/digital compact device modeling             |

---

## Key Capabilities

### 1. Analog Behavioral Disciplines & Natures

- Native support for physical disciplines and cross-domain nature definitions:
  - **Electrical**: Potential `Voltage` ($V$), Flow `Current` ($I$).
  - **Thermal**: Potential `Temperature` ($T$), Flow `Power` ($P$).
  - **Rotational / Mechanical**: Potential `Angle` ($\theta$), Flow `Torque` ($\tau$).
- Supports branch formulation, reference nodes (`ground`), and conservative multi-port Kirchhoff networks.

### 2. Analog Contribution Statements & Dynamic Operators

- Full evaluation of continuous-time analog contribution operators (`<+`), shown here for a p-n junction diode combining Shockley exponential conduction with dynamic junction capacitance charging current:
  $$I(p, n) <+ I_{\text{sat}} \left( \exp\left(\frac{V(p, n)}{n V_t}\right) - 1 \right) + \frac{d}{dt}\left( C_j V(p, n) \right)$$

  | Symbol             | Meaning                                                                 | Units / Domain          |
  | :----------------- | :---------------------------------------------------------------------- | :---------------------- |
  | $I(p, n), V(p, n)$ | Branch current from node $p$ to $n$ and branch voltage ($V_p - V_n$)    | $\text{A}$, $\text{V}$  |
  | $<+$               | Verilog-A analog contribution operator (accumulates onto branch)        | —                       |
  | $I_{\text{sat}}$   | Reverse saturation current                                              | $\text{A}$, $> 0$       |
  | $n$                | Diode emission (ideality) factor                                        | dimensionless, $[1, 2]$ |
  | $V_t$              | Thermal voltage ($k_B T / q \approx 25.85\text{ mV}$ at $300\text{ K}$) | $\text{V}$, $> 0$       |
  | $C_j$              | Junction depletion/diffusion capacitance                                | $\text{F}$, $\ge 0$     |
  | $t$                | Simulation time                                                         | $\text{s}$, $\ge 0$     |

- **Dynamic Operators**: Time derivative `ddt(x)`, time integration `idt(x)`, transport delay `absdelay(x, td)`, and transition filters.
- **Transistor Compact Models**: Enables high-speed simulation of BSIM, EKV, diode, and custom micro-electro-mechanical (MEMS) behavioral models.

### 3. Direct DAE Lowering

- Lowers continuous behavioral equations, branch relations, and small-signal Jacobians directly into `@modelscript/runtime`'s `DAEBuilder` linear memory arena.
- Eliminates intermediate C-code generation or proprietary simulator compiling steps.

### 4. Polyglot Projections

- **Modelica (`verilogAToModelica`)**: Translates Verilog-A modules into acausal `Modelica.Electrical.Analog` component classes.
- **SPICE (`verilogAToSpice`)**: Generates equivalent SPICE subcircuit netlists (`.subckt`) with nonlinear behavioral voltage/current sources (`B`-sources).

---

## Static Analysis & Device Modeling Linter Rules

The Verilog-A linter detects compact modeling bugs and numerical convergence pitfalls:

<LintRules lang="verilog-a" />

---

## CLI Usage

```bash
# Lint a Verilog-A semiconductor device model
msx verilog-a lint MOS_Transistor.va

# Lower analog behavioral equations to ModelScript linear DAE arena
msx verilog-a to-dae MOS_Transistor.va --out=transistor.dae.json

# Project into standard Modelica 3.x acausal analog component
msx verilog-a to-modelica MOS_Transistor.va -o MOS_Transistor.mo

# Export to SPICE subcircuit with nonlinear behavioral sources
msx verilog-a to-spice MOS_Transistor.va -o MOS_Transistor.sub
```

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="verilog-a" />
