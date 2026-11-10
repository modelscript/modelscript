---
title: "GTFS Public Transit Fleet Electrification (.gtfs, .zip)"
description: "@modelscript/gtfs (languages/gtfs) provides native parsing, longitudinal vehicle kinematics, bus traction power evaluation, battery state-of-charge integration, and depot charging DAE lowering for General Transit Feed Specification (GTFS) schedules."
---

# GTFS Public Transit Fleet Electrification (`.gtfs`, `.zip`)

`@modelscript/gtfs` (`languages/gtfs`) provides native multi-table parsing, longitudinal kinematic traction power evaluation, battery state-of-charge (SOC) integration, and overnight depot charging DAE lowering for **General Transit Feed Specification (GTFS)** municipal transit feeds.

---

## Supported Extensions & Standards

| Extension | Format | Description |
| :--- | :--- | :--- |
| `.gtfs`, `.zip` | GTFS Transit Feed | Standard multi-table archive containing `routes.txt`, `stops.txt`, `trips.txt`, and `stop_times.txt` |
| `.txt`, `.csv` | GTFS Section Text | Concatenated or standalone schedule tables |

---

## Key Capabilities

### 1. Longitudinal Vehicle Kinematic Traction Physics

- Evaluates real-time resistive forces for heavy-duty battery electric buses (BEB):
  $$F_{\text{total}}(t) = F_{\text{inertial}} + F_{\text{aero}} + F_{\text{roll}} + F_{\text{grade}}$$
  $$F_{\text{total}}(t) = m_{\text{veh}} a(t) + \frac{1}{2} \rho_{\text{air}} C_d A_f v(t)^2 + \mu_{rr} m_{\text{veh}} g \cos\theta + m_{\text{veh}} g \sin\theta$$
- Wheel mechanical traction power:
  $$P_{\text{mech}}(t) = F_{\text{total}}(t) \cdot v(t)$$
- Captures regenerative braking during deceleration phases ($a < 0$) with efficiency $\eta_{\text{regen}} \approx 65\%$.

### 2. Fleet Battery State-of-Charge & Route Feasibility

- Tracks electrochemical battery draw across complex multi-stop transit routes:
  $$\frac{d(SoC)}{dt} = -\frac{P_{\text{mech}}(t) / \eta_{\text{drivetrain}} + P_{\text{aux}}}{C_{\text{battery}}}$$
  where $P_{\text{aux}}$ represents climate control (HVAC) and auxiliary power draws (typically 8–15 kW).
- Highlights critical low-SOC trips unable to complete scheduled service without midday opportunity charging.

### 3. Depot Charging & Substation Headroom DAE Lowering

- Aggregates multi-bus return charging schedules at central depot facilities:
  $$P_{\text{depot}}(t) = \sum_{b=1}^{N_{\text{fleet}}} P_{\text{charge}, b}(t) \le P_{\text{transformer}}^{\max}$$
- Co-simulates depot electrical peak demands with distribution feeder models (`@modelscript/opendss`) and automated smart charging schedulers (`@modelscript/ocpp`).

---

## Static Analysis & Pre-Flight Linter Rules

<LintRules lang="gtfs" />

---

## CLI Usage

```bash
# Validate GTFS feed route topology, stop sequences, and speed limits
msx gtfs lint SFMTA_Feed.gtfs

# Compute trip-by-trip kinematic traction energy and ending battery SOC
msx gtfs traction SFMTA_Feed.gtfs

# Evaluate 24-hour depot charging load curve and transformer headroom
msx gtfs depot SFMTA_Feed.gtfs --depot-limit=2000

# Lower transit electrification dynamics into ModelScript DAE arena
msx gtfs to-dae SFMTA_Feed.gtfs --out=transit_fleet.dae
```
