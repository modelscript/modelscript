---
title: "JSBSim Aerospace 6-DOF Flight Dynamics (.xml)"
description: "@modelscript/jsbsim (languages/jsbsim) provides zero-regex XML parsing, non-linear 6-DOF rigid-body flight dynamics integration, cruise trim stabilization, linear DAE lowering, and Modelica 3.x pro..."
---

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

Integrates the full non-linear Newtonian equations of motion for a rigid aircraft in atmospheric flight. The translational and rotational equations balance external aerodynamic, propulsive, and gravitational forces/moments against inertial and Coriolis coupling terms in the rotating body frame, while the kinematic equations map body angular rates into Euler attitude rates and geodetic climb rate:

- **Translational Accelerations in Body Frame** (Newton's second law in a rotating body-fixed frame):
  $$\dot{u} = \frac{F_x}{m} - q w + r v$$
  $$\dot{v} = \frac{F_y}{m} - r u + p w$$
  $$\dot{w} = \frac{F_z}{m} - p v + q u$$
- **Rotational Accelerations in Principal Axes** (Euler's rigid-body rotational equations):
  $$\dot{p} = \frac{M_x}{I_{xx}} + \frac{I_{yy} - I_{zz}}{I_{xx}} q r$$
  $$\dot{q} = \frac{M_y}{I_{yy}} + \frac{I_{zz} - I_{xx}}{I_{yy}} p r$$
  $$\dot{r} = \frac{M_z}{I_{zz}} + \frac{I_{xx} - I_{yy}}{I_{zz}} p q$$
- **Euler Angle Kinematics** (transforming body angular rates to Earth-relative roll, pitch, and yaw rates):
  $$\dot{\phi} = p + (q \sin \phi + r \cos \phi) \tan \theta$$
  $$\dot{\theta} = q \cos \phi - r \sin \phi$$
  $$\dot{\psi} = \frac{q \sin \phi + r \cos \phi}{\cos \theta}$$
- **Geodetic Altitude Rate of Climb** (vertical projection of body-frame velocity):
  $$\dot{h} = u \sin \theta - v \sin \phi \cos \theta - w \cos \phi \cos \theta$$

| Symbol                                 | Meaning                                                             | Units / Domain                     |
| :------------------------------------- | :------------------------------------------------------------------ | :--------------------------------- |
| $u, v, w$                              | Body-frame translational velocity components (forward, right, down) | $\text{m/s}$                       |
| $\dot{u}, \dot{v}, \dot{w}$            | Body-frame translational accelerations                              | $\text{m/s}^2$                     |
| $p, q, r$                              | Body-frame angular velocity components (roll, pitch, yaw rates)     | $\text{rad/s}$                     |
| $\dot{p}, \dot{q}, \dot{r}$            | Body-frame angular accelerations                                    | $\text{rad/s}^2$                   |
| $\phi, \theta, \psi$                   | Euler attitude angles (roll, pitch, yaw)                            | $\text{rad}$                       |
| $\dot{\phi}, \dot{\theta}, \dot{\psi}$ | Euler attitude angle rates                                          | $\text{rad/s}$                     |
| $h, \dot{h}$                           | Geodetic altitude above mean sea level and climb rate               | $\text{m}$, $\text{m/s}$           |
| $F_x, F_y, F_z$                        | Total external forces (aero, propulsion, gravity) in body axes      | $\text{N}$                         |
| $M_x, M_y, M_z$                        | Total external moments about body roll, pitch, and yaw axes         | $\text{N}\cdot\text{m}$            |
| $m$                                    | Aircraft total mass                                                 | $\text{kg}$ ($> 0$)                |
| $I_{xx}, I_{yy}, I_{zz}$               | Principal moments of inertia about body axes                        | $\text{kg}\cdot\text{m}^2$ ($> 0$) |

### 2. Aerodynamics & Steady Cruise Trim

Models lift ($C_L$), drag ($C_D$), side force ($C_Y$), and moments ($C_l, C_m, C_n$) as functions of dynamic pressure $\bar{q} = \frac{1}{2} \rho V^2$, angle of attack $\alpha = \arctan(w / u)$, and sideslip $\beta = \arcsin(v / V)$. The linear lift curve, parabolic drag polar, and damped pitching moment determine the aerodynamic loads:

$$C_L = C_{L0} + C_{L\alpha} \cdot \alpha$$
$$C_D = C_{D0} + k C_L^2$$
$$C_m = C_{m\alpha} (\alpha - \alpha_{\text{trim}}) + C_{mq} \left( \frac{q \bar{c}}{2 V} \right)$$

Computes automatic cruise trim equilibrium where aerodynamic lift cancels aircraft gross weight ($L = mg$), yielding the trim angle of attack needed for steady level flight without pitch oscillation or kinetic energy loss:

$$\alpha_{\text{trim}} = \frac{mg - \bar{q} S C_{L0}}{\bar{q} S C_{L\alpha}}$$

| Symbol                         | Meaning                                                              | Units / Domain              |
| :----------------------------- | :------------------------------------------------------------------- | :-------------------------- |
| $C_L, C_D, C_m$                | Non-dimensional lift, drag, and pitching moment coefficients         | Dimensionless               |
| $C_{L0}, C_{D0}$               | Zero-alpha lift coefficient and zero-lift parasitic drag coefficient | Dimensionless               |
| $C_{L\alpha}, C_{m\alpha}$     | Lift-curve slope and pitching-moment static stability derivative     | $\text{rad}^{-1}$           |
| $k$                            | Induced-drag factor ($1 / (\pi e \text{AR})$)                        | Dimensionless               |
| $C_{mq}$                       | Pitch-damping derivative with respect to normalized pitch rate       | Dimensionless               |
| $\alpha, \alpha_{\text{trim}}$ | Angle of attack and steady-cruise trim angle of attack               | $\text{rad}$                |
| $q$                            | Body-axis pitch rate                                                 | $\text{rad/s}$              |
| $\bar{c}$                      | Wing mean aerodynamic chord                                          | $\text{m}$                  |
| $V$                            | True airspeed                                                        | $\text{m/s}$ ($> 0$)        |
| $\bar{q}$                      | Dynamic pressure ($\frac{1}{2}\rho V^2$)                             | $\text{Pa}$                 |
| $S$                            | Wing reference planform area                                         | $\text{m}^2$ ($> 0$)        |
| $m, g$                         | Aircraft total mass and gravitational acceleration                   | $\text{kg}$, $\text{m/s}^2$ |

### 3. Direct DAE Lowering

- Lowers state variables ($u, v, w, p, q, r, \phi, \theta, \psi, h$) and aero force equations into `@modelscript/runtime`'s `DAEBuilder` linear memory arena.
- Enables co-simulation between aerodynamic airframes, onboard flight control computers ([`@modelscript/simulink`](./simulink.md)), and satellite navigation systems ([`@modelscript/ccsds`](./ccsds.md)).

### 4. Bidirectional Modelica 3.x Projection

- Projects JSBSim aircraft into `Modelica.Mechanics.MultiBody` 6-DOF airframes with aerodynamic force elements.

---

## Pre-Flight Diagnostics

The JSBSim linter validates aircraft geometry, mass distributions, and inertia tensors:

<LintRules lang="jsbsim" />

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

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="jsbsim" />
