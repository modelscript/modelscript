---
title: "OCPP EV Smart Charging (.ocpp, .json)"
description: "@modelscript/ocpp (languages/ocpp) provides native parsing, urgency-weighted smart charging scheduling, transformer loading DAE lowering, and compliance verification for Open Charge Point Protocol 2.0.1 and 1.6J networks."
---

# OCPP EV Smart Charging (`.ocpp`, `.json`)

`@modelscript/ocpp` (`languages/ocpp`) provides native parsing, priority load allocation, transformer headroom constraint checking, and linear DAE lowering for **Open Charge Point Protocol (OCPP 2.0.1 / 1.6J)** electric vehicle supply equipment (EVSE) networks and fleet depots.

---

## Supported Extensions & Standards

| Extension | Format                  | Description                                                            |
| :-------- | :---------------------- | :--------------------------------------------------------------------- |
| `.ocpp`   | OCPP Network Manifest   | Station hierarchy, EVSE connector ratings, and charging session states |
| `.json`   | OCPP 2.0.1 JSON Payload | JSON schema conforming EV charging schedules and composite profiles    |

---

## Key Capabilities

### 1. Urgency-Weighted Smart Charging Allocation

- Dynamically schedules active vehicle sessions under a shared transformer or feeder capacity limit $P_{\text{grid}}^{\max}$, prioritizing sessions by energy urgency relative to remaining dwell time:
  $$\sum_{i=1}^{N_{\text{active}}} P_i(t) \le P_{\text{grid}}^{\max}$$
  $$U_i = \frac{E_{\text{req},i}}{\max(0.1, t_{\text{dep},i} - t)}$$
  where $E_{\text{req},i} = (SoC_{\text{target},i} - SoC_{\text{current},i}) \cdot C_{\text{battery},i}$ is the remaining energy required and $P_i(t) \le P_{\text{conn},i}^{\max}$ enforces hardware connector physical maximums.

  | Symbol                   | Meaning                                                  | Units / Domain                                             |
  | :----------------------- | :------------------------------------------------------- | :--------------------------------------------------------- |
  | $i, N_{\text{active}}$   | Session index and number of active charging sessions     | $\text{dimensionless}$ ($i = 1, \dots, N_{\text{active}}$) |
  | $P_i(t)$                 | Charging power allocated to session $i$ at time $t$      | $\text{kW}$ ($P_i \ge 0$)                                  |
  | $P_{\text{grid}}^{\max}$ | Maximum aggregate site/feeder power limit                | $\text{kW}$                                                |
  | $U_i$                    | Charging urgency score for session $i$                   | $\text{kW}$                                                |
  | $E_{\text{req},i}$       | Remaining energy needed to reach target state of charge  | $\text{kWh}$                                               |
  | $t_{\text{dep},i}, t$    | Scheduled departure time of vehicle $i$ and current time | $\text{h}$                                                 |

### 2. Multi-Tier Profile Priority Hierarchy

- Implements the standard OCPP charging profile stack:
  1. `ChargePointMaxProfile` (overall site ceiling)
  2. `TxDefaultProfile` (station default tariff/limit schedule)
  3. `TxProfile` (session-specific dynamically injected profile)
- Integrates with power distribution models (`@modelscript/opendss`) and transit fleet schedules (`@modelscript/gtfs`).

### 3. DAE Formulation for Transformer Overload Protection

- Lowers aggregated EVSE power and battery state-of-charge dynamics into `DAEBuilder`, integrating charging power into battery state of charge and summing site demand:
  $$\frac{d(SoC_i)}{dt} = \frac{\eta_{\text{chg}} \cdot P_i(t)}{C_{\text{battery},i}}$$
  $$P_{\text{total}}(t) = \sum_{i=1}^{N} P_i(t)$$

  | Symbol                 | Meaning                                       | Units / Domain                                         |
  | :--------------------- | :-------------------------------------------- | :----------------------------------------------------- |
  | $SoC_i$                | State of charge of vehicle battery $i$        | $\text{dimensionless}$ ($0 \le SoC_i \le 1$)           |
  | $t$                    | Simulation time                               | $\text{h}$                                             |
  | $\eta_{\text{chg}}$    | Charger-to-battery conversion efficiency      | $\text{dimensionless}$ ($0 < \eta_{\text{chg}} \le 1$) |
  | $P_i(t)$               | Charging power delivered to vehicle $i$       | $\text{kW}$                                            |
  | $C_{\text{battery},i}$ | Usable battery energy capacity of vehicle $i$ | $\text{kWh}$                                           |
  | $P_{\text{total}}(t)$  | Total aggregate power drawn by all $N$ EVSEs  | $\text{kW}$                                            |
  | $N$                    | Total number of EVSE connectors at the site   | $\text{dimensionless}$                                 |

- Emits soft-slack penalty equations for transformer thermal capacity overloads.

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="ocpp" />

---

## Static Analysis & Pre-Flight Linter Rules

<LintRules lang="ocpp" />

---

## CLI Usage

```bash
# Lint an EVSE charging network configuration for capacity mismatches or invalid limits
msx ocpp lint FleetDepot.ocpp

# Solve optimal priority charging schedule across all active EVSEs
msx ocpp schedule FleetDepot.ocpp --min-power=7.2

# Lower charging network and battery states to linear DAE arena
msx ocpp to-dae FleetDepot.ocpp --out=depot_charging.dae
```
