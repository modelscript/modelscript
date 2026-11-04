# OpenSim Musculoskeletal Biomechanics (`.osim`)

`@modelscript/opensim` (`languages/opensim`) provides native WebAssembly parsing, musculoskeletal kinematic tree and mass/inertia validation, **Hill-type muscle-tendon activation and contraction dynamics** (`Thelen2003Muscle`, `Millard2012EquilibriumMuscle`), `DAEBuilder` lowering, and Modelica 3.x / ROS URDF projections for **OpenSim** biomechanical and orthopedic surgical planning models.

---

## Supported Extensions & Standards

| Extension | Format           | Description                                                                                                                              |
| :-------- | :--------------- | :--------------------------------------------------------------------------------------------------------------------------------------- |
| `.osim`   | OpenSim Document | XML specification of `BodySet`, `JointSet`, `ForceSet` (Hill muscles, ligaments, coordinate actuators), `MarkerSet`, and `WrapObjectSet` |

---

## Key Capabilities

### 1. Multibody Skeletal Kinematics & Wrapping Surfaces

- Parses `OpenSimDocument` (versions 3.x & 4.x) including rigid segments (`Body`), anatomical joints (`PinJoint`, `SliderJoint`, `CustomJoint`, `WeldJoint`, `FreeJoint`), generalized coordinates (`Coordinate` with range-of-motion bounds), motion-capture fiducial markers (`MarkerSet`), and cylindrical/ellipsoidal muscle wrapping surfaces (`WrapCylinder`, `WrapSphere`, `WrapEllipsoid`).

### 2. Hill-Type Muscle-Tendon Activation & Contraction Solver

- Integrates first-order neural excitation-to-activation dynamics ($u(t) \to a(t)$) coupled with active force-length $f_L(\tilde{l}^M)$, force-velocity $f_V(\tilde{v}^M)$, passive parallel elastic $f_{PE}(\tilde{l}^M)$, and pennation angle $\alpha$ tendon equilibrium:
  $$\frac{da}{dt} = \frac{u - a}{\tau(a, u)}, \qquad F^T = F_0^M \left(a \, f_L(\tilde{l}^M) f_V(\tilde{v}^M) + f_{PE}(\tilde{l}^M)\right)\cos\alpha$$

### 3. DAE Lowering & Modelica / URDF Projection

- Lowers skeletal equations of motion and muscle-tendon ODEs into `@modelscript/runtime`'s `DAEBuilder` arena and projects models to **Modelica.Mechanics.MultiBody** (`openSimToModelica`) and **ROS 2 URDF** (`openSimToUrdf`).

---

## Pre-Flight Diagnostics

<LintRules lang="opensim" />

---

## CLI Usage

```bash
# Inspect bodies, joints, muscles, and markers in an OpenSim model
msx opensim inspect Arm26.osim

# Validate mass/inertia positivity, kinematic cycles, and Hill muscle parameters
msx opensim validate Arm26.osim

# Simulate Hill-type muscle activation and joint trajectories
msx opensim simulate Arm26.osim

# Project OpenSim model to Modelica 3.x or ROS URDF
msx opensim to-modelica Arm26.osim > Arm26.mo
msx opensim to-urdf Arm26.osim > Arm26.urdf
```
