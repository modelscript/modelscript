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
- **Robotics Linters (`M7501`–`M7508`):**
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

| Action            | Description                                                                   | Key Options                                        |
| :---------------- | :---------------------------------------------------------------------------- | :------------------------------------------------- |
| **`lint`**        | Runs kinematic tree validation, joint limit checks, and inertia verification. | —                                                  |
| **`rnea`**        | Evaluates inverse dynamics (RNEA) at test joint coordinates.                  | `--gravity`                                        |
| **`simulate`**    | Solves articulated robot forward dynamics into time-series trajectories.      | `--stop-time`, `--step-size`, `--format=csv\|json` |
| **`to-modelica`** | Generates standard `Modelica.Mechanics.MultiBody` robot system.               | `--out=<file.mo>`                                  |
| **`to-adams`**    | Projects robot mechanism into MSC Adams `.adm` solver dataset.                | `--out=<file.adm>`                                 |
| **`to-simpack`**  | Projects robot mechanism into SIMPACK XML `.spck` model.                      | `--out=<file.spck>`                                |
| **`to-usd`**      | Projects robot into OpenUSD / UsdPhysics scene or 64-byte aligned package.    | `--usdz`, `--out=<file.usda\|file.usdz>`           |
| **`to-dae`**      | Lowers kinematic state equations directly into `DAEBuilder` arena.            | —                                                  |

### Examples

```bash
# Simulate forward dynamics under gravity to CSV/JSON trajectory
msx simulate KukaIiwa14.urdf --stop-time=2.0 --step-size=0.01 -o trajectory.csv

# Evaluate inverse dynamics (RNEA) static hold torques
msx urdf rnea KukaIiwa14.urdf

# Check for inverted joint limits or dangling parent links
msx urdf lint MobileManipulator.urdf

# Convert robot description into standard Modelica 3.x
msx urdf to-modelica PandaArm.urdf --out=PandaArm.mo

# Export to OpenUSD / UsdPhysics digital twin scene
msx urdf to-usd PandaArm.urdf --out=PandaArm.usda

# Export to 64-byte aligned USDZ package for Apple Vision Pro & NVIDIA Omniverse
msx urdf to-usd PandaArm.urdf --usdz --out=PandaArm.usdz

# Export to MSC Adams for vehicle-mounted robot simulation
msx urdf to-adams RoverArm.urdf --out=RoverArm.adm
```

---

## Interactive Ansatz Web Platform (`UrdfViewer`)

On [Ansatz](https://ansatz.social), `.urdf`, `.sdf`, and `.xacro` artifacts render directly in the interactive **Robotics Mechanism Studio**:

- **Kinematic Tree View**: High-resolution vector schematic visualizing parent/child links and joint types with pan-and-zoom controls.
- **3D Pose View**: Real-time WebGPU/Three.js multibody viewport with forward kinematics joint angle sliders ($q_i \in [q_{\text{min}}, q_{\text{max}}]$).
- **Dynamics & Linter**: Pre-flight verification results (`M7501`–`M7508`) paired with an **RNEA Gravity Hold Torques** calculator reporting static equilibrium torques ($\tau_i \text{ [N}\cdot\text{m]}$).
- **Polyglot Projections**: One-click translation to Modelica 3.x or SIMPACK JSON, with direct export to the Ansatz Morsel visual simulator.

---

## Robotics Linters & Diagnostic Rules

<LintRules lang="urdf" />
