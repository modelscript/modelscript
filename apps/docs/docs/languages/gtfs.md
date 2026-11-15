---
title: "GTFS Public Transit Fleet Electrification (.gtfs, .zip)"
description: "@modelscript/gtfs (languages/gtfs) provides native parsing, longitudinal vehicle kinematics, bus traction power evaluation, battery state-of-charge integration, and depot charging DAE lowering for General Transit Feed Specification (GTFS) schedules."
---

# GTFS Public Transit Fleet Electrification (`.gtfs`, `.zip`)

`@modelscript/gtfs` (`languages/gtfs`) provides native multi-table parsing, longitudinal kinematic traction power evaluation, battery state-of-charge (SOC) integration, and overnight depot charging DAE lowering for **General Transit Feed Specification (GTFS)** municipal transit feeds.

---

## Supported Extensions & Standards

| Extension       | Format            | Description                                                                                          |
| :-------------- | :---------------- | :--------------------------------------------------------------------------------------------------- |
| `.gtfs`, `.zip` | GTFS Transit Feed | Standard multi-table archive containing `routes.txt`, `stops.txt`, `trips.txt`, and `stop_times.txt` |
| `.txt`, `.csv`  | GTFS Section Text | Concatenated or standalone schedule tables                                                           |

---

## Key Capabilities

### 1. Longitudinal Vehicle Kinematic Traction Physics

- Evaluates real-time resistive forces for heavy-duty battery electric buses (BEB), summing inertial acceleration, aerodynamic drag, rolling resistance, and road grade forces:
  $$F_{\text{total}}(t) = F_{\text{inertial}} + F_{\text{aero}} + F_{\text{roll}} + F_{\text{grade}}$$
  $$F_{\text{total}}(t) = m_{\text{veh}} a(t) + \frac{1}{2} \rho_{\text{air}} C_d A_f v(t)^2 + \mu_{rr} m_{\text{veh}} g \cos\theta + m_{\text{veh}} g \sin\theta$$
- Wheel mechanical traction power equals total tractive force multiplied by instantaneous vehicle speed:
  $$P_{\text{mech}}(t) = F_{\text{total}}(t) \cdot v(t)$$

  | Symbol                                                                    | Meaning                                                                             | Units / Domain                                                       |
  | :------------------------------------------------------------------------ | :---------------------------------------------------------------------------------- | :------------------------------------------------------------------- |
  | $F_{\text{total}}(t)$                                                     | Total longitudinal tractive force at time $t$                                       | $\text{N}$                                                           |
  | $F_{\text{inertial}}, F_{\text{aero}}, F_{\text{roll}}, F_{\text{grade}}$ | Inertial, aerodynamic drag, rolling resistance, and grade force components          | $\text{N}$                                                           |
  | $m_{\text{veh}}$                                                          | Gross vehicle mass (curb + passenger load)                                          | $\text{kg}$ ($> 0$)                                                  |
  | $a(t), v(t)$                                                              | Longitudinal acceleration and velocity at time $t$                                  | $\text{m}\cdot\text{s}^{-2}$, $\text{m}\cdot\text{s}^{-1}$ ($\ge 0$) |
  | $\rho_{\text{air}}$                                                       | Ambient air mass density                                                            | $\text{kg}\cdot\text{m}^{-3}$ ($> 0$)                                |
  | $C_d, A_f$                                                                | Aerodynamic drag coefficient and vehicle frontal area                               | Dimensionless ($> 0$), $\text{m}^2$ ($> 0$)                          |
  | $\mu_{rr}$                                                                | Tire-road rolling resistance coefficient                                            | Dimensionless ($> 0$)                                                |
  | $g, \theta$                                                               | Gravitational acceleration ($9.81\text{ m}\cdot\text{s}^{-2}$) and road slope angle | $\text{m}\cdot\text{s}^{-2}$, $\text{rad}$                           |
  | $P_{\text{mech}}(t)$                                                      | Mechanical power demanded at the wheels                                             | $\text{W}$                                                           |

- Captures regenerative braking during deceleration phases ($a < 0$) with efficiency $\eta_{\text{regen}} \approx 65\%$.

### 2. Fleet Battery State-of-Charge & Route Feasibility

- Tracks electrochemical battery draw across complex multi-stop transit routes, where State of Charge ($SoC$) decreases at a rate equal to total electrical power draw (drivetrain + auxiliary) divided by usable battery energy capacity:
  $$\frac{d(SoC)}{dt} = -\frac{P_{\text{mech}}(t) / \eta_{\text{drivetrain}} + P_{\text{aux}}}{C_{\text{battery}}}$$

  | Symbol                     | Meaning                                                               | Units / Domain                        |
  | :------------------------- | :-------------------------------------------------------------------- | :------------------------------------ |
  | $SoC$                      | Battery State of Charge                                               | Dimensionless, $\in [0, 1]$           |
  | $t$                        | Simulation time                                                       | $\text{s}$ (or $\text{h}$), $t \ge 0$ |
  | $\eta_{\text{drivetrain}}$ | Electric motor and inverter drivetrain efficiency                     | Dimensionless, $\in (0, 1]$           |
  | $P_{\text{aux}}$           | Auxiliary power draw (HVAC, lighting, electronics; typically 8–15 kW) | $\text{W}$ ($\ge 0$)                  |
  | $C_{\text{battery}}$       | Usable onboard battery energy capacity                                | $\text{J}$ (or $\text{Wh}$), $> 0$    |

- Highlights critical low-SOC trips unable to complete scheduled service without midday opportunity charging.

### 3. Depot Charging & Substation Headroom DAE Lowering

- Aggregates multi-bus return charging schedules at central depot facilities, enforcing that total simultaneous charging power does not exceed the substation transformer rating:
  $$P_{\text{depot}}(t) = \sum_{b=1}^{N_{\text{fleet}}} P_{\text{charge}, b}(t) \le P_{\text{transformer}}^{\max}$$
  where $P_{\text{depot}}(t)$ is total depot power demand ($\text{W}$ or $\text{kW}$), $N_{\text{fleet}}$ is the number of buses in the fleet (positive integer), $P_{\text{charge}, b}(t)$ is the charging power drawn by bus $b$ at time $t$ ($\text{W}$ or $\text{kW}$, $\ge 0$), and $P_{\text{transformer}}^{\max}$ is the maximum continuous depot transformer capacity ($\text{W}$ or $\text{kW}$, $> 0$).
- Co-simulates depot electrical peak demands with distribution feeder models (`@modelscript/opendss`) and automated smart charging schedulers (`@modelscript/ocpp`).

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="gtfs" />

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
