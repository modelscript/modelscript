# Verilog-A & Verilog-AMS Compact Modeling (`.va`, `.vams`)

`@modelscript/verilog-a` (`languages/verilog-a`) provides compiler, analog behavioral simulation, continuous DAE lowering, and SPICE netlist export for the **IEEE 1857 Verilog-A** and **Verilog-AMS** analog compact modeling language.

---

## Supported Extensions & Standards

| Extension | Standard / Format             | Description                                                     |
| :-------- | :---------------------------- | :-------------------------------------------------------------- |
| `.va`     | **IEEE 1857 / OVI Verilog-A** | Continuous-time analog behavioral hardware description language |
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

- Full evaluation of continuous-time analog contribution operators (`<+`):
  $$I(p, n) <+ I_{\text{sat}} \left( \exp\left(\frac{V(p, n)}{n V_t}\right) - 1 \right) + \frac{d}{dt}\left( C_j V(p, n) \right)$$
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
