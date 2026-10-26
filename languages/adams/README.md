# `@modelscript/adams`

MSC Adams Multibody Dynamics (MBD) and Kinematics Domain Module for ModelScript.

Provides zero-regex, high-performance AST parsing, pre-flight kinematic linter diagnostics (`M7301`–`M7320`), Grübler-Kutzbach mobility analysis, direct linear-memory WebAssembly `DAEBuilder` descriptor lowering with Baumgarte stabilization, cross-format bidirectional projections (SIMPACK `.spck`, Modelica `MultiBody`, STEP CAD), multi-file workspace indexing, and Language Server Protocol (LSP) services.

## Supported Formats

- `.adm`: MSC Adams Dataset (Card / Statement syntax: `PART`, `MARKER`, `JOINT`, `GCON`, `SFORCE`, `VFORCE`, `GFORCE`, `MOTION`, `REQUEST`)
- `.cmd`: MSC Adams View Command script (`model create`, `part create`, `marker create`, `constraint create joint`)
- `.acf`: MSC Adams Analysis Control File (`SIMULATE/DYNAMIC`, `EQUILIBRIUM`, `LINEAR/EIGEN`)

## Diagnostic Error Codes (`M7301`–`M7320`)

| Code    | Rule                          | Severity  | Description                                                                                                       |
| :------ | :---------------------------- | :-------- | :---------------------------------------------------------------------------------------------------------------- |
| `M7301` | `overconstrained-mobility`    | `warning` | Grübler-Kutzbach criterion computes $DOF \le 0$ with redundant joint constraints.                                 |
| `M7302` | `gimbal-lock-orientation`     | `warning` | Euler angle sequence near pitch singularity ($\theta \approx \pm 90^\circ$).                                      |
| `M7303` | `dangling-marker-reference`   | `error`   | Joint, force, or CM references marker ID not assigned to an active part.                                          |
| `M7304` | `non-physical-inertia-tensor` | `error`   | Inertia tensor eigenvalues non-positive or violates triangle inequalities.                                        |
| `M7305` | `massless-part-floating`      | `error`   | Part with zero mass and inertia is not ground and not fixed to ground.                                            |
| `M7306` | `duplicate-element-id`        | `error`   | Identical identifier assigned to multiple parts, markers, or joints.                                              |
| `M7307` | `coincident-joint-markers`    | `warning` | Joint I and J markers are located at significantly different initial coordinates when joint requires coincidence. |
| `M7308` | `negative-spring-damping`     | `error`   | Spring stiffness $K < 0$ or damping coefficient $C < 0$.                                                          |
| `M7309` | `missing-ground-part`         | `error`   | Dataset does not define a ground reference body or marker.                                                        |
| `M7310` | `unconstrained-floating-part` | `warning` | Moving part has zero joints or constraints attached to it.                                                        |

## Quick Start

```typescript
import {
  parseAdams,
  lintAdamsModel,
  analyzeAdamsMobility,
  lowerAdamsToDae,
  adamsToSimpack,
  adamsToModelica,
} from "@modelscript/adams";

const dataset = parseAdams(adamsDeck);
const diagnostics = lintAdamsModel(dataset);
const mobility = analyzeAdamsMobility(dataset);
console.log(`Degrees of freedom: ${mobility.calculatedMobility}`);

const dae = lowerAdamsToDae(dataset);
const simpackModel = adamsToSimpack(dataset);
const modelicaCode = adamsToModelica(dataset);
```
