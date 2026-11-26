---
title: "OpenDSS Distribution Grids & DERs (.dss)"
description: "@modelscript/opendss provides zero-regex parsing, unbalanced multi-phase power flow, DER hosting analysis, DAE lowering, and Modelica projection for OpenDSS."
---

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

- Solves unbalanced radial and weakly meshed 3-phase/4-wire distribution networks via the **nodal admittance matrix ($Y\_{\text{bus}}$)** formulation and **Forward-Backward Sweep (FBS)**, relating bus current injections to bus voltages and computing constant-power load currents:
  $$I_{\text{inj}}(V) = Y_{\text{bus}} V$$
  $$I_i(V_i) = \left( \frac{P_i + j Q_i}{V_i} \right)^*$$

  | Symbol              | Meaning                                                       | Units / Domain                            |
  | :------------------ | :------------------------------------------------------------ | :---------------------------------------- |
  | $I_{\text{inj}}(V)$ | Vector of complex nodal current injections                    | $\text{A}$ (or $\text{p.u.}$)             |
  | $Y_{\text{bus}}$    | Complex nodal admittance matrix                               | $\text{S}$ (or $\text{p.u.}$)             |
  | $V, V_i$            | Vector of complex bus voltages and voltage phasor at node $i$ | $\text{V}$ (or $\text{p.u.}$)             |
  | $I_i(V_i)$          | Complex load current drawn at node $i$                        | $\text{A}$ (or $\text{p.u.}$)             |
  | $P_i, Q_i$          | Active and reactive power demand at node $i$                  | $\text{W}, \text{VAr}$ (or $\text{p.u.}$) |
  | $j, (\cdot)^*$      | Imaginary unit ($\sqrt{-1}$) and complex conjugate operator   | $\text{dimensionless}$                    |

- Accurately tracks mutual coupling across multi-conductor overhead lines and underground concentric neutral cables using Carson's equations for earth return path impedance.

### 2. DER Hosting Capacity & Reverse Power Flow

- Models distributed solar photovoltaic (PVSystem) generators, battery energy storage systems (Storage), and wind generators.
- Analyzes thermal line loading limits and voltage regulation limits (ANSI C84.1 Range A: $0.95 \le |V| \le 1.05\text{ p.u.}$), estimating the steady-state feeder voltage rise induced by distributed energy resource (DER) active and reactive injection:
  $$\Delta V \approx \frac{R P_{\text{DER}} + X Q_{\text{DER}}}{V_0}$$

  | Symbol                           | Meaning                                                            | Units / Domain                            |
  | :------------------------------- | :----------------------------------------------------------------- | :---------------------------------------- |
  | $\Delta V$                       | Approximate voltage magnitude rise at the point of interconnection | $\text{V}$ (or $\text{p.u.}$)             |
  | $R, X$                           | Equivalent upstream feeder resistance and reactance                | $\Omega$ (or $\text{p.u.}$)               |
  | $P_{\text{DER}}, Q_{\text{DER}}$ | Net active and reactive power injected by the DER                  | $\text{W}, \text{VAr}$ (or $\text{p.u.}$) |
  | $V_0$                            | Nominal (no-load) feeder voltage magnitude                         | $\text{V}$ (or $\text{p.u.}$)             |

- Identifies reverse power flow hazards where generation exceeds local demand, pushing power back through substation transformers into the transmission bulk grid ([`@modelscript/psse`](./psse.md)).

### 3. Direct DAE Lowering

- Compiles lines, transformers, and voltage-dependent loads into `@modelscript/runtime`'s `DAEBuilder` linear memory arena.
- Enables co-simulation between distribution feeders, electromagnetic transients in inverter controllers ([`@modelscript/pscad`](./pscad.md)), and building thermal energy consumption ([`@modelscript/energyplus`](./energyplus.md)).

### 4. Faults, Harmonics, Protection, IEEE 1366 Reliability, GIC & FLISR

- **Distribution OPF (`opf`), Short-Circuit (`fault`), and Harmonics (`harmonics`)**: Evaluates DER Volt-Var/curtailment dispatch, unbalanced phase-to-ground and 3-phase fault currents, and harmonic distortion profiles.
- **Protection Coordination (`protection`), IEEE 1366 Reliability (`reliability`), GIC (`gic`) & FLISR (`flisr`)**: Audits fuse-recloser coordination, computes SAIDI/SAIFI/CAIDI indices, evaluates geomagnetic induced currents, and identifies optimal tie-switch sectionalizing for Fault Location, Isolation, and Service Restoration.

### 5. Bidirectional Modelica 3.x Projection

- Projects OpenDSS circuits into standard multi-phase Modelica or OpenIPSL electrical network models with acausal electrical pins (`v`, `i`).

---

## Pre-Flight Diagnostics

The OpenDSS linter verifies electrical connectivity and DER operating envelopes:

<LintRules lang="opendss" />

---

## CLI Usage

```bash
# Inspect distribution buses, lines, transformers, and DER units
msx opendss inspect IEEE13NodeFeeder.dss
msx opendss summary IEEE13NodeFeeder.dss

# Run pre-flight linting and connectivity verification
msx opendss lint IEEE13NodeFeeder.dss

# Solve multi-phase AC power flow (FBS or sparse Ybus) and distribution OPF
msx opendss powerflow IEEE13NodeFeeder.dss
msx opendss ybus IEEE13NodeFeeder.dss
msx opendss opf IEEE13NodeFeeder.dss

# Run fault study, harmonics, protection, IEEE 1366 reliability, GIC, hosting capacity, and FLISR
msx opendss fault IEEE13NodeFeeder.dss --bus=671
msx opendss harmonics IEEE13NodeFeeder.dss
msx opendss protection IEEE13NodeFeeder.dss
msx opendss reliability IEEE13NodeFeeder.dss
msx opendss gic IEEE13NodeFeeder.dss
msx opendss hosting-capacity IEEE13NodeFeeder.dss --bus=671
msx opendss flisr IEEE13NodeFeeder.dss --bus=671

# Lower circuit into ModelScript linear DAE arena or Modelica 3.x
msx opendss to-dae IEEE13NodeFeeder.dss
msx opendss to-modelica IEEE13NodeFeeder.dss -o DistributionFeeder.mo
```

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="opendss" />
