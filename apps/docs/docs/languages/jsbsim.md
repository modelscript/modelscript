# JSBSim Aerospace 6-DOF Flight Dynamics (`.xml`)

`@modelscript/jsbsim` (`languages/jsbsim`) provides zero-regex XML parsing, non-linear 6-DOF rigid-body flight dynamics integration, cruise trim stabilization, linear DAE lowering, and Modelica 3.x projection for **JSBSim Flight Dynamics Model (FDM)** fixed-wing and rotorcraft aircraft configurations.

---

## Supported Extensions & Standards

| Extension | Format         | Description                                                                                                    |
| :-------- | :------------- | :------------------------------------------------------------------------------------------------------------- |
| `.xml`    | JSBSim FDM XML | Aircraft configuration schema encoding metrics, mass balance, propulsion, landing gear, and aerodynamic tables |

---

## Key Capabilities

### 1. Six-Degree-of-Freedom (6-DOF) Non-Linear Equations of Motion

- Integrates the full non-linear Newtonian equations of motion for a rigid aircraft in atmospheric flight:
  - **Translational Accelerations in Body Frame**:
    $$\dot{u} = \frac{F_x}{m} - q w + r v$$
    $$\dot{v} = \frac{F_y}{m} - r u + p w$$
    $$\dot{w} = \frac{F_z}{m} - p v + q u$$
  - **Rotational Accelerations in Principal Axes**:
    $$\dot{p} = \frac{M_x}{I_{xx}} + \frac{I_{yy} - I_{zz}}{I_{xx}} q r$$
    $$\dot{q} = \frac{M_y}{I_{yy}} + \frac{I_{zz} - I_{xx}}{I_{yy}} p r$$
    $$\dot{r} = \frac{M_z}{I_{zz}} + \frac{I_{xx} - I_{yy}}{I_{zz}} p q$$
  - **Euler Angle Kinematics**:
    $$\dot{\phi} = p + (q \sin \phi + r \cos \phi) \tan \theta$$
    $$\dot{\theta} = q \cos \phi - r \sin \phi$$
    $$\dot{\psi} = \frac{q \sin \phi + r \cos \phi}{\cos \theta}$$
  - **Geodetic Altitude Rate of Climb**:
    $$\dot{h} = u \sin \theta - v \sin \phi \cos \theta - w \cos \phi \cos \theta$$

### 2. Aerodynamics & Steady Cruise Trim

- Models lift ($C_L$), drag ($C_D$), side force ($C_Y$), and moments ($C_l, C_m, C_n$) as functions of dynamic pressure $\bar{q} = \frac{1}{2} \rho V^2$, angle of attack $\alpha = \arctan(w / u)$, and sideslip $\beta = \arcsin(v / V)$:
  $$C_L = C_{L0} + C_{L\alpha} \cdot \alpha$$
  $$C_D = C_{D0} + k C_L^2$$
  $$C_m = C_{m\alpha} (\alpha - \alpha_{\text{trim}}) + C_{mq} \left( \frac{q \bar{c}}{2 V} \right)$$
- Computes automatic cruise trim equilibrium where aerodynamic lift cancels aircraft gross weight ($L = mg$):
  $$\alpha_{\text{trim}} = \frac{mg - \bar{q} S C_{L0}}{\bar{q} S C_{L\alpha}}$$
  ensuring stable horizontal flight without pitch oscillation or kinetic energy loss.

### 3. Direct DAE Lowering

- Lowers state variables ($u, v, w, p, q, r, \phi, \theta, \psi, h$) and aero force equations into `@modelscript/runtime`'s `DAEBuilder` linear memory arena.
- Enables co-simulation between aerodynamic airframes, onboard flight control computers ([`@modelscript/simulink`](file:///home/omar/git3/modelscript/languages/simulink)), and satellite navigation systems ([`@modelscript/ccsds`](file:///home/omar/git3/modelscript/languages/ccsds)).

### 4. Bidirectional Modelica 3.x Projection

- Projects JSBSim aircraft into `Modelica.Mechanics.MultiBody` 6-DOF airframes with aerodynamic force elements.

---

## Pre-Flight Diagnostics (`M8901`–`M8910`)

The JSBSim linter validates aircraft geometry, mass distributions, and inertia tensors:

| Code    | Severity  | Rule Identifier             | Condition Checked                                                                       |
| :------ | :-------- | :-------------------------- | :-------------------------------------------------------------------------------------- |
| `M8901` | `error`   | `missing-aircraft-name`     | Aircraft configuration does not declare a valid aircraft name.                          |
| `M8902` | `error`   | `non-positive-wing-area`    | Wing reference area is non-positive ($S_{\text{ref}} \le 0\text{ ft}^2$).               |
| `M8903` | `error`   | `non-positive-wingspan`     | Wingspan or aerodynamic chord is non-positive ($b \le 0$ or $\bar{c} \le 0$).           |
| `M8904` | `error`   | `negative-empty-weight`     | Aircraft empty weight $W_{\text{empty}} \le 0\text{ lbs}$.                              |
| `M8905` | `error`   | `invalid-inertia-tensor`    | Moments of inertia violate rigid-body triangle inequality ($I_{xx} + I_{yy} < I_{zz}$). |
| `M8908` | `warning` | `missing-aerodynamics-axis` | Aerodynamics definition lacks standard lift, drag, or pitch moment axes.                |

---

## CLI Usage

```bash
# Inspect aircraft metrics, mass balance, engines, and aero coefficients
msx jsbsim inspect Cessna172Skyhawk.xml

# Run pre-flight linting and inertia tensor validation
msx jsbsim lint Cessna172Skyhawk.xml

# Simulate 6-DOF flight dynamics with automatic cruise trim
msx jsbsim simulate Cessna172Skyhawk.xml --duration=15.0 --speed=180.0 --altitude=5000.0

# Lower 6-DOF flight dynamics equations to ModelScript linear DAE arena
msx jsbsim to-dae Cessna172Skyhawk.xml

# Project into Modelica 3.x 6-DOF flight mechanics model
msx jsbsim to-modelica Cessna172Skyhawk.xml -o FlightMechanics.mo
```
