# `@modelscript/urdf`

ROS URDF, SDFormat (SDF), and Xacro Robotics Modeling and Articulated Dynamics Engine for ModelScript.

Provides native streaming XML parsing (`@modelscript/dsl/xml`), Xacro macro expansion, pre-flight robotics diagnostic linter rules (`M7501`–`M7520`), Featherstone's $O(N)$ Articulated Body Algorithm (ABA) and Recursive Newton-Euler Algorithm (RNEA) lowered directly into ModelScript's linear-memory WebAssembly `DAEBuilder` arena, cross-format bidirectional projections (Modelica `MultiBody`, SIMPACK, MSC Adams, STEP CAD), multi-file workspace indexing, and Language Server Protocol (LSP) services.

## Supported Formats

- `.urdf`: Unified Robot Description Format (ROS 1 & ROS 2 standard)
- `.sdf`: Simulation Description Format (OSRF SDFormat 1.7+)
- `.xacro`: XML Macro language for parameterized modular robot models

## Diagnostic Error Codes (`M7501`–`M7520`)

| Code    | Rule                          | Severity  | Description                                                                                       |
| :------ | :---------------------------- | :-------- | :------------------------------------------------------------------------------------------------ |
| `M7501` | `disconnected-kinematic-tree` | `error`   | Link has no joint parent or robot tree contains disconnected components.                          |
| `M7502` | `closed-kinematic-loop-urdf`  | `warning` | URDF tree contains directed closed cycle (recommend converting to SDF closed loops).              |
| `M7503` | `invalid-mass-properties`     | `error`   | Link mass $m \le 0$ or inertia tensor is not positive-definite or violates triangle inequalities. |
| `M7504` | `missing-joint-limits`        | `error`   | Revolute or prismatic joint missing mandatory `effort` or `velocity` limit.                       |
| `M7505` | `missing-mesh-resource`       | `warning` | Visual or collision mesh file reference cannot be resolved.                                       |
| `M7506` | `duplicate-element-name`      | `error`   | Multiple links or joints share the same identifier name.                                          |
| `M7507` | `zero-length-joint-axis`      | `error`   | Joint axis vector $\| \mathbf{a} \| = 0$.                                                         |
| `M7508` | `inverted-joint-limits`       | `error`   | Joint lower limit exceeds upper limit ($q_{min} > q_{max}$).                                      |

## Quick Start

```typescript
import {
  parseUrdf,
  expandXacro,
  lintUrdfRobot,
  computeForwardDynamicsAba,
  computeInverseDynamicsRnea,
  lowerUrdfToDae,
  urdfToModelica,
  urdfToSimpack,
  urdfToAdams,
} from "@modelscript/urdf";

const robot = parseUrdf(urdfXml);
const diagnostics = lintUrdfRobot(robot);
const dae = lowerUrdfToDae(robot);
```
