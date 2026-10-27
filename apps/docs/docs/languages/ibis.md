# IBIS Semiconductor Buffer Modeling (`.ibs`)

`@modelscript/ibis` (`languages/ibis`) provides zero-regex parsing, non-linear driver I/V interpolation, dynamic VT ramp synthesis, package parasitics RLC lowering, and Modelica 3.x projection for **ANSI/EIA-656 IBIS 3.2–7.1** input/output buffer information specifications.

---

## Supported Extensions & Standards

| Extension | Format                    | Description                                                                         |
| :-------- | :------------------------ | :---------------------------------------------------------------------------------- |
| `.ibs`    | IBIS Device Specification | Behavioral non-linear I/V tables, switching ramps, package parasitics, pin mappings |

---

## Key Capabilities

### 1. Behavioral Non-Linear Driver & Receiver Formulation

- Replaces proprietary transistor-level SPICE netlists with behavioral table lookups that preserve intellectual property while accelerating high-speed digital signal integrity analysis:
  $$I_{\text{out}}(t) = k_u(t) \cdot I_{\text{pullup}}(V_{dd} - V_{\text{out}}) + k_d(t) \cdot I_{\text{pulldown}}(V_{\text{out}}) + I_{\text{gndclamp}}(V_{\text{out}}) + I_{\text{pwrclamp}}(V_{\text{out}} - V_{dd})$$
  where $k_u(t)$ and $k_d(t) \in [0, 1]$ are time-varying switching coefficients derived from the `[Ramp]` and `[Rising/Falling Waveform]` tables:
  $$\frac{dV}{dt} = \frac{V_{\text{swing}}}{t_r}, \quad \frac{dV}{dt} = \frac{V_{\text{swing}}}{t_f}$$
- Implements piecewise-linear monotonic cubic spline interpolation across Min/Typ/Max process, voltage, and temperature (PVT) operating corners.

### 2. Multi-Pin Package Parasitics

- Models chip-to-board interconnect parasitics via lumped RLC matrices and per-pin package values:
  $$V_{\text{pin}} - V_{\text{die}} = R_{\text{pkg}} I_{\text{pin}} + L_{\text{pkg}} \frac{dI_{\text{pin}}}{dt}$$
  $$I_{\text{die}} = I_{\text{pin}} - C_{\text{comp}} \frac{dV_{\text{die}}}{dt} - C_{\text{pkg}} \frac{dV_{\text{pin}}}{dt}$$
  where $C_{\text{comp}}$ is the silicon die capacitance.

### 3. Direct DAE Lowering

- Emits combined package RLC and non-linear buffer DAE equations into `@modelscript/runtime`'s `DAEBuilder` linear memory arena.
- Enables co-simulation with multi-port S-parameter channel macromodels ([`@modelscript/touchstone`](./touchstone.md)) to assess eye diagrams, timing jitter, and simultaneous switching noise (SSN).

### 4. Bidirectional Modelica 3.x Projection

- Projects IBIS buffers into `Modelica.Electrical.Analog` non-linear controlled current sources and package RLC networks.

---

## Pre-Flight Diagnostics

The IBIS validator enforces monotonic I/V behavior and physical bounds:

<LintRules lang="ibis" />

---

## CLI Usage

```bash
# Inspect pins, models, and package parasitics in an IBIS file
msx ibis inspect Ddr4Driver.ibs

# Run pre-flight linting and table monotonicity checks
msx ibis lint Ddr4Driver.ibs

# Evaluate driver dynamic currents and output resistance
msx ibis eval Ddr4Driver.ibs

# Lower buffer and package equations to ModelScript linear DAE arena
msx ibis to-dae Ddr4Driver.ibs

# Project into Modelica 3.x electrical analog component
msx ibis to-modelica Ddr4Driver.ibs -o Ddr4Buffer.mo
```
