# Cantera Chemical Kinetics & Thermochemistry (`.yaml`, `.cti`)

`@modelscript/cantera` (`languages/cantera`) provides native WebAssembly parsing, NASA-7 polynomial thermodynamic evaluation ($C_p^\circ(T)$, $H^\circ(T)$, $S^\circ(T)$, $G^\circ(T)$), modified Arrhenius and Troe falloff reaction rate calculation, non-isothermal batch reactor ODE integration, `DAEBuilder` lowering, and SBML / Modelica projections for **Cantera** gas-phase combustion, catalysis, and chemical kinetics mechanisms.

---

## Supported Extensions & Standards

| Extension | Format             | Description                                                                                         |
| :-------- | :----------------- | :-------------------------------------------------------------------------------------------------- |
| `.yaml`   | Cantera YAML       | Modern Cantera 2.5+ / 3.x YAML mechanism format (`phases`, `species`, `reactions`, `thermo: NASA7`) |
| `.cti`    | Legacy Cantera CTI | Classic Cantera `ideal_gas`, `species`, and `reaction` mechanism definitions                        |

---

## Key Capabilities

### 1. NASA-7 Thermochemical Polynomials

- Evaluates two-range (low-$T$ / high-$T$) 7-coefficient NASA polynomials for every species:
  $$\frac{C_p^\circ(T)}{R} = a_0 + a_1 T + a_2 T^2 + a_3 T^3 + a_4 T^4$$
  $$\frac{H^\circ(T)}{RT} = a_0 + \frac{a_1}{2}T + \frac{a_2}{3}T^2 + \frac{a_3}{4}T^3 + \frac{a_4}{5}T^4 + \frac{a_5}{T}$$
  $$\frac{S^\circ(T)}{R} = a_0 \ln T + a_1 T + \frac{a_2}{2}T^2 + \frac{a_3}{3}T^3 + \frac{a_4}{4}T^4 + a_6$$
- Verifies continuity of $C_p^\circ$, $H^\circ$, and $S^\circ$ across the midpoint splitting temperature $T_{\text{mid}}$.

### 2. Elementary, Three-Body & Troe Falloff Kinetics

- Computes forward and reverse rate constants via modified Arrhenius expressions and thermodynamic equilibrium constants $K_c(T) = \exp(-\Delta G^\circ / RT)$:
  $$k_f(T) = A \, T^\beta \exp\!\left(-\frac{E_a}{RT}\right)$$
- Supports third-body collision efficiencies (`+ M`) and pressure-dependent Lindemann / Troe falloff formulations.

### 3. Batch Reactor ODE Solver & DAE Lowering

- Integrates constant-volume or constant-pressure gas-phase reactor species and temperature evolution and lowers the kinetic network into `@modelscript/runtime`'s `DAEBuilder` arena, Modelica 3.x, or SBML.

---

## Pre-Flight Diagnostics

<LintRules lang="cantera" />

---

## CLI Usage

```bash
# Validate elemental balance, NASA-7 continuity, and Arrhenius parameters
msx lint H2Combustion.yaml

# Parse and inspect the Cantera mechanism structure
msx parse H2Combustion.yaml
```
