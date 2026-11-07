---
title: OpenSim Musculoskeletal Biomechanics (.osim)
description: Native WebAssembly parsing, musculoskeletal kinematic tree and inertia validation, Hill-type muscle-tendon activation and contraction dynamics, DAEBuilder lowering, and Modelica 3.x / ROS URDF projections for OpenSim models.
---

# OpenSim Musculoskeletal Biomechanics (`.osim`)

`@modelscript/opensim` (`languages/opensim`) provides native WebAssembly parsing, musculoskeletal kinematic tree and mass/inertia validation, **Hill-type muscle-tendon activation and contraction dynamics** (`Thelen2003Muscle`, `Millard2012EquilibriumMuscle`), `DAEBuilder` lowering, and Modelica 3.x / ROS URDF projections for **OpenSim** biomechanical and orthopedic surgical planning models.

---

## Supported Extensions & Standards

| Extension | Format           | Description                                                                                                                              |
| :-------- | :--------------- | :--------------------------------------------------------------------------------------------------------------------------------------- |
| `.osim`   | OpenSim Document | XML specification of `BodySet`, `JointSet`, `ForceSet` (Hill muscles, ligaments, coordinate actuators), `MarkerSet`, and `WrapObjectSet` |

---

## Key Capabilities

### 1. Multibody Skeletal Kinematics, Inertia & Wrapping Surfaces

- Parses `OpenSimDocument` (versions 3.x & 4.x) including rigid body segments (`Body` with mass $m_b > 0$ and 6-component inertia tensor $\mathbf{I}_b \succ 0$ satisfying triangle inequalities $I_{xx} + I_{yy} \ge I_{zz}$), anatomical joints (`PinJoint`, `SliderJoint`, `CustomJoint`, `WeldJoint`, `FreeJoint`, `BallJoint`, `UniversalJoint`), generalized coordinates (`Coordinate` with range-of-motion bounds $[q_{\min}, q_{\max}]$), motion-capture fiducial markers (`MarkerSet`), and muscle wrapping surfaces (`WrapCylinder`, `WrapSphere`, `WrapEllipsoid`).
- Formulates the articulated skeletal equations of motion driven by muscle-tendon forces $\mathbf{F}^T$ mapped through the moment-arm matrix $\mathbf{R}(\mathbf{q})$:
  $$\mathbf{M}(\mathbf{q})\ddot{\mathbf{q}} + \mathbf{C}(\mathbf{q}, \dot{\mathbf{q}})\dot{\mathbf{q}} + \mathbf{G}(\mathbf{q}) = \mathbf{R}(\mathbf{q}) \, \mathbf{F}^T + \boldsymbol{\tau}_{\text{ext}}$$

### 2. Hill-Type Muscle-Tendon Activation & Contraction Solver

For every `Thelen2003Muscle` or `Millard2012EquilibriumMuscle` actuator, `@modelscript/opensim` integrates first-order neural excitation-to-activation dynamics ($u(t) \in [0, 1] \to a(t) \in [a_{\min}, 1]$) with asymmetric activation/deactivation time constants ($\tau_{\text{act}} \approx 10\text{ ms}$, $\tau_{\text{deact}} \approx 40\text{ ms}$):

$$\frac{da}{dt} = \frac{u - a}{\tau(a, u)}, \qquad \tau(a, u) = \begin{cases} \tau_{\text{act}}(0.5 + 1.5a) & u > a \\ \dfrac{\tau_{\text{deact}}}{0.5 + 1.5a} & u \le a \end{cases}$$

coupled with active force-length $f_L(\tilde{l}^M)$, concentric/eccentric force-velocity $f_V(\tilde{v}^M)$, passive parallel elastic $f_{PE}(\tilde{l}^M)$, and pennation angle $\alpha(\tilde{l}^M)$ tendon force equilibrium over total muscle-tendon path length $l^{MT} = l^M \cos\alpha + l^T$:

$$F^T = F_0^M \left(a \, f_L(\tilde{l}^M) f_V(\tilde{v}^M) + f_{PE}(\tilde{l}^M)\right)\cos\alpha = F_0^M \, f_{SE}(\tilde{l}^T)$$

### 3. DAE Lowering & Modelica / URDF Projection

- **`DAEBuilder` Linear Memory Lowering**: Emits generalized coordinates $(q_i, \omega_i)$, muscle activation states $a_m(t)$, normalized fiber lengths $\tilde{l}_m^M(t)$, and Hill-type force balance equations directly into `@modelscript/runtime`'s `DAEBuilder` arena (`lowerOpenSimToDae`).
- **Modelica 3.x & ROS 2 URDF Export**: Projects musculoskeletal models into **Modelica** (`openSimToModelica`) and **ROS 2 URDF** (`openSimToUrdf`) for prosthetic/exoskeleton co-simulation.

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

# Project OpenSim model to Modelica 3.x, ROS URDF, or DAE arena
msx opensim to-modelica Arm26.osim > Arm26.mo
msx opensim to-urdf Arm26.osim > Arm26.urdf
msx opensim to-dae Arm26.osim
```

---

## Programmatic TypeScript SDK

```typescript
import {
  parseOpenSimModel,
  simulateHillMuscleDynamics,
  lowerOpenSimToDae,
  openSimToModelica,
  openSimToUrdf,
} from "@modelscript/opensim";
import { DAEBuilder } from "@modelscript/runtime";

const model = parseOpenSimModel(osimXmlSource);
const sim = simulateHillMuscleDynamics(model, 1.0, 0.005);

const builder = new DAEBuilder();
lowerOpenSimToDae(model, builder);
const modelicaCode = openSimToModelica(model);
const urdfXml = openSimToUrdf(model);
```
