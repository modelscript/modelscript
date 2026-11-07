---
title: OpenUSD & UsdPhysics Digital Twins & Robotics Simulation
description: Native compiler support for Alliance for OpenUSD (.usd, .usda, .usdz), UsdPhysics schemas, 64-byte aligned package archiver, semantic linter, and linear WebAssembly DAE lowering in ModelScript.
---

# OpenUSD & UsdPhysics Digital Twins

ModelScript provides first-class support for **OpenUSD** (`.usd`, `.usda`, `.usdz`), the universal 3D scene description standard governed by the Alliance for OpenUSD (AOUSD). In ModelScript, OpenUSD serves as the high-fidelity 3D bridge connecting 1D/multibody physical simulation (Modelica, URDF, SIMPACK, Adams) and procedural 3D CAD (STEP, OpenSCAD) with photorealistic digital twins (NVIDIA Omniverse / Isaac Sim, Apple Vision Pro, Unreal Engine).

---

## Capabilities & Supported Formats

| Format                     | Extension | Description                                                                                                                                  |
| :------------------------- | :-------- | :------------------------------------------------------------------------------------------------------------------------------------------- |
| **ASCII OpenUSD Stage**    | `.usda`   | Human-readable UTF-8 scene description defining prim hierarchies, time-sampled attribute curves, and `UsdPhysics` schemas.                   |
| **OpenUSD Zip Package**    | `.usdz`   | Zero-dependency, uncompressed ZIP archive with **strict 64-byte payload data alignment** for direct `mmap` streaming on iOS / visionOS / AR. |
| **Binary / Mixed OpenUSD** | `.usd`    | Generic USD container format routed automatically to ModelScript's streaming parser and 3D viewers.                                          |

---

## Key Architectural Features

### 1. `UsdPhysics` Simulation Ingestion (`lowerUsdToDae`)

ModelScript can parse OpenUSD stages authored in external digital twin tools (NVIDIA Isaac Sim, Blender, Omniverse) and extract physics properties:

- **Rigid Bodies (`PhysicsRigidBodyAPI`, `PhysicsMassAPI`):** Extracts scalar mass, center-of-mass offsets, and diagonal principal inertia tensors.
- **Kinematic Constraints:** Resolves parent/child body targets (`physics:body0`, `physics:body1`), axis tokens, and limits for `PhysicsRevoluteJoint`, `PhysicsPrismaticJoint`, and `PhysicsFixedJoint`.
- **Linear DAE Lowering:** Lowers generalized joint coordinates $(q, \dot{q}, \tau)$ directly into ModelScript's WebAssembly Struct-of-Arrays `DAEBuilder` arena for simulation via CVODE/IDA or batched WebGPU integrators.

### 2. Time-Sampled Trajectory Animation

When forward dynamics are solved in ModelScript (from ROS URDF or Modelica MultiBody models), joint state trajectories are converted via forward kinematics into time-sampled USD animation curves:

```c
double3 xformOp:translate.timeSamples = {
    0.0: (0.0, 0.0, 0.5),
    0.5: (0.1, 0.0, 0.7),
    1.0: (0.2, 0.0, 0.8),
}
quatf xformOp:orient.timeSamples = {
    0.0: (1.0, 0.0, 0.0, 0.0),
    0.5: (0.923, 0.382, 0.0, 0.0),
    1.0: (0.707, 0.707, 0.0, 0.0),
}
uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:orient"]
```

These files can be immediately opened in Apple Vision Pro, Quick Look, or NVIDIA Omniverse for dynamic simulation playback.

### 3. Procedural CAD & CSG Export

Watertight 2-manifold triangular meshes synthesized by `@modelscript/cad` (`ManifoldSurfaceMesh`) and OpenSCAD (`@modelscript/scad`) map directly to `UsdGeomMesh`:

- Exact vertex points (`point3f[] points`)
- Outward unit surface normals (`normal3f[] normals`)
- Triangulated index buffers (`int[] faceVertexIndices`)
- Diffuse material colors (`color3f[] primvars:displayColor`)
- Part assembly transformations (`matrix4d xformOp:transform`)

---

## Command Line Interface (`msx`)

```bash
# Export URDF robot to human-readable ASCII OpenUSD with UsdPhysics schemas
msx urdf to-usd robot.urdf -o robot.usda

# Export to 64-byte aligned USDZ package for Apple Vision Pro & AR Quick Look
msx urdf to-usd robot.urdf --usdz -o robot.usdz

# Simulate robot forward dynamics and output trajectory
msx urdf simulate robot.urdf --stop-time=2.0 -o sim.json
```

---

## Semantic Linter Rules (`USD1001`–`USD1007`)

<LintRules lang="usd" />
