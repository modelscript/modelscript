---
title: URDF & Xacro Robot Kinematics & Featherstone Dynamics
description: Native compiler support for ROS URDF (.urdf) and Xacro (.xacro) robot models, spatial kinematics, Featherstone recursive dynamics (ABA, RNEA), and 3D CAD/Modelica projections in ModelScript.
---

# URDF & Xacro Robot Kinematics

ModelScript provides first-class support for **URDF** (`.urdf`) and **Xacro** (`.xacro`), the robotics industry and ROS (Robot Operating System) standard for describing kinematic trees, inertial properties, visual geometry, and joint limits of robotic manipulators, humanoids, and autonomous vehicles.

---

## Capabilities & Supported Formats

| Format                               | Extension       | Description                                                                                                                                                       |
| :----------------------------------- | :-------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Unified Robot Description Format** | `.urdf`, `.xml` | XML schema defining kinematic links, joints (revolute, continuous, prismatic, fixed, floating, planar), inertial parameters, collision bounds, and visual meshes. |
| **Xacro Macro Template**             | `.xacro`        | Parametric XML preprocessor adding variables (`<xacro:property>`), mathematical expressions, and reusable macros (`<xacro:macro>`).                               |

### Key Architectural Features

- **Xacro Expansion & Parser:**
  - Robust XML reader with automatic in-memory macro expansion (`<xacro:macro>`) and mathematical expression evaluation before parsing.
  - Generates strongly typed robot AST representation via `parseUrdf()`.
- **Topological Kinematic Tree & Featherstone Algorithms:**
  - Traverses joint-link connectivity starting from the root base link.
  - Implements **Recursive Newton-Euler Algorithm (RNEA)** for inverse dynamics: calculates required joint torques $\boldsymbol{\tau}$ given joint positions $\mathbf{q}$, velocities $\dot{\mathbf{q}}$, and accelerations $\ddot{\mathbf{q}}$.
  - Implements **Articulated-Body Algorithm (ABA)** for forward dynamics: evaluates forward acceleration $\ddot{\mathbf{q}} = \mathbf{M}(\mathbf{q})^{-1} (\boldsymbol{\tau} - \mathbf{C}(\mathbf{q}, \dot{\mathbf{q}}) - \mathbf{g}(\mathbf{q}))$ in $O(N)$ operations.
- **Robotics Linters (`M7501`–`M7510`):**
  - Detects dangling parent/child link references, disconnected kinematic sub-trees, inverted joint limits (`lower > upper`), zero joint axis vectors, missing inertia tags, and non-physical inertia tensors.
- **Multi-Target Projections:**
  - **Modelica MultiBody:** Synthesizes `Modelica.Mechanics.MultiBody` robotic arms with joint friction and actuator controllers.
  - **MSC Adams:** Exports Adams `.adm` solver datasets.
  - **SIMPACK:** Generates SIMPACK `.spck` mechanisms.
  - **3D CAD:** Projects robot geometry into CSG primitives and STEP visual meshes.

---

## Command Line Interface (`msx urdf`)

```bash
msx urdf <action> [files...] [options]
```

| Action            | Description                                                                   | Key Options                                             |
| :---------------- | :---------------------------------------------------------------------------- | :------------------------------------------------------ |
| **`inspect`**     | Dumps robot name, root link, joint tree, mass budget, and degrees of freedom. | —                                                       |
| **`lint`**        | Runs kinematic tree validation, joint limit checks, and inertia verification. | —                                                       |
| **`dynamics`**    | Evaluates forward (ABA) or inverse (RNEA) dynamics at test joint coordinates. | `--q=<csv>`, `--qd=<csv>`, `--qdd=<csv>`, `--tau=<csv>` |
| **`to-modelica`** | Generates standard `Modelica.Mechanics.MultiBody` robot system.               | `--out=<file.mo>`                                       |
| **`to-adams`**    | Projects robot mechanism into MSC Adams `.adm` solver dataset.                | `--out=<file.adm>`                                      |
| **`to-simpack`**  | Projects robot mechanism into SIMPACK XML `.spck` model.                      | `--out=<file.spck>`                                     |
| **`to-dae`**      | Lowers kinematic state equations directly into `DAEBuilder` arena.            | —                                                       |

### Examples

```bash
# Inspect robot kinematic hierarchy and total mass
msx urdf inspect KukaIiwa14.urdf

# Check for inverted joint limits or dangling parent links
msx urdf lint MobileManipulator.urdf

# Convert robot description into standard Modelica 3.x
msx urdf to-modelica PandaArm.urdf --out=PandaArm.mo

# Export to MSC Adams for vehicle-mounted robot simulation
msx urdf to-adams RoverArm.urdf --out=RoverArm.adm
```

---

## Robotics Linters & Diagnostic Rules

| Code        | Identifier                    | Severity | Description                                                                       |
| :---------- | :---------------------------- | :------- | :-------------------------------------------------------------------------------- |
| **`M7501`** | `dangling-parent-link`        | Error    | Joint references a parent link name that does not exist in the robot description. |
| **`M7502`** | `dangling-child-link`         | Error    | Joint references a child link name that does not exist in the robot description.  |
| **`M7503`** | `disconnected-kinematic-tree` | Error    | One or more links cannot be reached via kinematic joints from the root link.      |
| **`M7504`** | `cyclic-kinematic-chain`      | Error    | Joint hierarchy contains a cycle; URDF requires a strictly acyclic tree topology. |
| **`M7505`** | `missing-inertial-tag`        | Warning  | Non-fixed moving link omits `<inertial>` mass and inertia tensor definition.      |
| **`M7506`** | `non-physical-inertia`        | Error    | Link inertia tensor violates positive-definiteness or triangle inequality.        |
| **`M7507`** | `zero-joint-axis`             | Error    | Revolute or prismatic joint specifies a zero axis vector (`xyz="0 0 0"`).         |
| **`M7508`** | `inverted-joint-limits`       | Error    | Joint lower limit exceeds the upper limit (`limit lower > upper`).                |
| **`M7509`** | `zero-effort-limit`           | Warning  | Active non-fixed joint specifies maximum effort limit of zero.                    |
| **`M7510`** | `missing-visual-or-collision` | Info     | Link does not declare any visual or collision geometry.                           |
