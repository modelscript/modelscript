# ASAM OpenSCENARIO Autonomous Driving (`.xosc`, `.osc`)

`@modelscript/openscenario` (`languages/openscenario`) provides zero-regex XML and domain DSL parsing, dynamic scenario orchestration, Time-To-Collision (TTC) monitoring, Mobileye Responsibility-Sensitive Safety (RSS) margin verification, linear DAE lowering, and Modelica 3.x projection for **ASAM OpenSCENARIO 1.x & 2.0** autonomous vehicle validation scenarios.

---

## Supported Extensions & Standards

| Extension | Format                    | Description                                                                          |
| :-------- | :------------------------ | :----------------------------------------------------------------------------------- |
| `.xosc`   | ASAM OpenSCENARIO 1.x XML | XML-based scenario description (storyboards, entities, maneuvers, triggers, actions) |
| `.osc`    | ASAM OpenSCENARIO 2.0 DSL | Domain-specific declarative and imperative scenario language for AV test generation  |

---

## Key Capabilities

### 1. Dynamic Scenario Orchestrator

- Executes storyboard acts, maneuver groups, and event-condition-action triggers across moving entities (ego vehicle, NPC traffic vehicles, pedestrians, cyclists):
  - **Triggers**: Simulation time, relative longitudinal distance, headway time, velocity thresholds, reach position.
  - **Actions**: Longitudinal speed change ($a(t)$), lane change ($\dot{y}(t)$), lateral offset, waypoint trajectory following.
- Couples directly with analytical clothoid road geometry imported from **ASAM OpenDRIVE** ([`@modelscript/opendrive`](./opendrive.md)).

### 2. Time-To-Collision (TTC) & Mobileye RSS Safety Verification

- Continuously evaluates kinematic safety margins between the autonomous vehicle ($E$) and surrounding traffic ($T$):
  - **Time-To-Collision (TTC)**:
    $$\text{TTC} = \frac{x_{\text{lead}} - x_{\text{ego}}}{v_{\text{ego}} - v_{\text{lead}}} \quad (\text{for } v_{\text{ego}} > v_{\text{lead}})$$
  - **Mobileye RSS Longitudinal Safe Distance**:
    $$d_{\text{min,long}} = \left[ v_r \cdot \rho + \frac{1}{2} a_{\text{max,acc}} \rho^2 + \frac{(v_r + \rho a_{\text{max,acc}})^2}{2 a_{\text{min,brake}}} - \frac{v_f^2}{2 a_{\text{max,brake}}} \right]_+$$
    where $\rho$ is sensor reaction time, $a_{\text{max,acc}}$ is maximum acceleration, and $a_{\text{min,brake}}$ is minimum emergency braking deceleration.

### 3. Direct DAE Lowering

- Lowers entity kinematics (position, heading $\psi$, velocity $v$, acceleration $a$) into `@modelscript/runtime`'s `DAEBuilder` linear memory arena.
- Enables co-simulation with vehicle multibody dynamics ([`@modelscript/simpack`](./simpack.md), [`@modelscript/adams`](./adams.md)) and powertrain control loops ([`@modelscript/simulink`](./simulink.md)).

### 4. Bidirectional Modelica 3.x Projection

- Projects scenario storyboards into Modelica vehicle tracking and path-following controllers.

---

## Pre-Flight Diagnostics

The OpenSCENARIO analyzer validates actor references, trigger reachability, and safety margins:

<LintRules lang="openscenario" />

---

## CLI Usage

```bash
# Inspect entities, maneuvers, and triggers in an OpenSCENARIO file
msx openscenario inspect HighwayCutIn.xosc

# Run pre-flight linting and trigger feasibility checks
msx openscenario lint HighwayCutIn.xosc

# Simulate scenario execution and evaluate TTC / RSS safety margins
msx openscenario simulate HighwayCutIn.xosc --duration=10.0

# Lower scenario kinematic equations to ModelScript linear DAE arena
msx openscenario to-dae HighwayCutIn.xosc

# Project into Modelica 3.x vehicle kinematics model
msx openscenario to-modelica HighwayCutIn.xosc -o ScenarioSimulation.mo
```
