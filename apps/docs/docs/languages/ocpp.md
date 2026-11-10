---
title: "OCPP EV Smart Charging (.ocpp, .json)"
description: "@modelscript/ocpp (languages/ocpp) provides native parsing, urgency-weighted smart charging scheduling, transformer loading DAE lowering, and compliance verification for Open Charge Point Protocol 2.0.1 and 1.6J networks."
---

# OCPP EV Smart Charging (`.ocpp`, `.json`)

`@modelscript/ocpp` (`languages/ocpp`) provides native parsing, priority load allocation, transformer headroom constraint checking, and linear DAE lowering for **Open Charge Point Protocol (OCPP 2.0.1 / 1.6J)** electric vehicle supply equipment (EVSE) networks and fleet depots.

---

## Supported Extensions & Standards

| Extension | Format | Description |
| :--- | :--- | :--- |
| `.ocpp` | OCPP Network Manifest | Station hierarchy, EVSE connector ratings, and charging session states |
| `.json` | OCPP 2.0.1 JSON Payload | JSON schema conforming EV charging schedules and composite profiles |

---

## Key Capabilities

### 1. Urgency-Weighted Smart Charging Allocation

- Dynamically schedules active vehicle sessions under a shared transformer or feeder capacity limit $P_{\text{grid}}^{\max}$:
  $$\sum_{i=1}^{N_{\text{active}}} P_i(t) \le P_{\text{grid}}^{\max}$$
- Evaluates individual vehicle urgency metrics based on required energy $E_{\text{req},i} = (SoC_{\text{target},i} - SoC_{\text{current},i}) \cdot C_{\text{battery},i}$ and departure deadline $t_{\text{dep},i}$:
  $$U_i = \frac{E_{\text{req},i}}{\max(0.1, t_{\text{dep},i} - t)}$$
- Enforces hardware connector physical maximums: $P_i(t) \le P_{\text{conn},i}^{\max}$.

### 2. Multi-Tier Profile Priority Hierarchy

- Implements the standard OCPP charging profile stack:
  1. `ChargePointMaxProfile` (overall site ceiling)
  2. `TxDefaultProfile` (station default tariff/limit schedule)
  3. `TxProfile` (session-specific dynamically injected profile)
- Integrates with power distribution models (`@modelscript/opendss`) and transit fleet schedules (`@modelscript/gtfs`).

### 3. DAE Formulation for Transformer Overload Protection

- Lowers aggregated EVSE power and state-of-charge dynamics into `DAEBuilder`:
  $$\frac{d(SoC_i)}{dt} = \frac{\eta_{\text{chg}} \cdot P_i(t)}{C_{\text{battery},i}}$$
  $$P_{\text{total}}(t) = \sum_{i=1}^{N} P_i(t)$$
- Emits soft-slack penalty equations for transformer thermal capacity overloads.

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
