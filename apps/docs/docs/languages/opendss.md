# OpenDSS Distribution Grids & DERs (`.dss`)

`@modelscript/opendss` (`languages/opendss`) provides zero-regex parsing, unbalanced multi-phase power flow solving, distributed energy resource (DER) hosting capacity analysis, linear DAE lowering, and Modelica 3.x projection for **EPRI OpenDSS** radial and meshed electrical distribution networks.

---

## Supported Extensions & Standards

| Extension | Format               | Description                                                                                     |
| :-------- | :------------------- | :---------------------------------------------------------------------------------------------- |
| `.dss`    | OpenDSS Command Deck | Distribution grid feeders, multi-phase line codes, transformers, distributed PV/wind, and loads |

---

## Key Capabilities

### 1. Multi-Phase Unbalanced AC Power Flow

- Solves unbalanced radial and weakly meshed 3-phase/4-wire distribution networks via the **nodal admittance matrix ($Y_{\text{bus}}$)** formulation and **Forward-Backward Sweep (FBS)**:
  $$I_{\text{inj}}(V) = Y_{\text{bus}} V$$
- Models constant power ($PQ$), constant current ($I$), and constant impedance ($Z$) loads:
  $$I_i(V_i) = \left( \frac{P_i + j Q_i}{V_i} \right)^*$$
- Accurately tracks mutual coupling across multi-conductor overhead lines and underground concentric neutral cables using Carson's equations for earth return path impedance.

### 2. DER Hosting Capacity & Reverse Power Flow

- Models distributed solar photovoltaic (PVSystem) generators, battery energy storage systems (Storage), and wind generators.
- Analyzes thermal line loading limits and voltage regulation limits (ANSI C84.1 Range A: $0.95 \le |V| \le 1.05\text{ p.u.}$):
  $$\Delta V \approx \frac{R P_{\text{DER}} + X Q_{\text{DER}}}{V_0}$$
- Identifies reverse power flow hazards where generation exceeds local demand, pushing power back through substation transformers into the transmission bulk grid ([`@modelscript/psse`](file:///home/omar/git3/modelscript/languages/psse)).

### 3. Direct DAE Lowering

- Compiles lines, transformers, and voltage-dependent loads into `@modelscript/runtime`'s `DAEBuilder` linear memory arena.
- Enables co-simulation between distribution feeders, electromagnetic transients in inverter controllers ([`@modelscript/pscad`](file:///home/omar/git3/modelscript/languages/pscad)), and building thermal energy consumption ([`@modelscript/energyplus`](file:///home/omar/git3/modelscript/languages/energyplus)).

### 4. Bidirectional Modelica 3.x Projection

- Projects OpenDSS circuits into standard multi-phase Modelica or OpenIPSL electrical network models with acausal electrical pins (`v`, `i`).

---

## Pre-Flight Diagnostics (`M8401`–`M8408`)

The OpenDSS linter verifies electrical connectivity and DER operating envelopes:

| Code    | Severity  | Rule Identifier        | Condition Checked                                                                                 |
| :------ | :-------- | :--------------------- | :------------------------------------------------------------------------------------------------ |
| `M8401` | `error`   | `unconnected-bus`      | Element terminal references a bus that is detached from the voltage source substation.            |
| `M8404` | `warning` | `reverse-power-risk`   | Distributed generation capacity exceeds local feeder demand ($P_{\text{gen}} > P_{\text{load}}$). |
| `M8406` | `error`   | `negative-load-power`  | Load active power $P_k < 0\text{ kW}$ declared without generator semantics.                       |
| `M8407` | `error`   | `negative-line-length` | Line physical length $L \le 0\text{ km}$ / $\text{kft}$.                                          |
| `M8408` | `error`   | `missing-line-code`    | Line references an undefined `LineCode` geometry specification.                                   |

---

## CLI Usage

```bash
# Inspect distribution buses, lines, transformers, and DER units
msx opendss inspect IEEE13NodeFeeder.dss

# Run pre-flight linting and connectivity verification
msx opendss lint IEEE13NodeFeeder.dss

# Solve multi-phase AC power flow and print bus voltages
msx opendss powerflow IEEE13NodeFeeder.dss

# Lower circuit into ModelScript linear DAE arena
msx opendss to-dae IEEE13NodeFeeder.dss

# Project into Modelica 3.x electrical power model
msx opendss to-modelica IEEE13NodeFeeder.dss -o DistributionFeeder.mo
```
