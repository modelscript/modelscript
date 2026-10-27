<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/urdf

ROS **URDF**, **SDFormat (SDF)**, and **Xacro** (`.urdf`, `.sdf`, `.xacro`) robotics modeling and articulated multibody dynamics engine for ModelScript. Features streaming XML parsing (`@modelscript/dsl/xml`), parameterized Xacro macro expansion, pre-flight robotics linter diagnostics (`M7501`–`M7508`), Featherstone's $O(N)$ Articulated Body Algorithm (ABA) and Recursive Newton-Euler Algorithm (RNEA), direct lowering to WebAssembly `DAEBuilder`, and cross-domain projections (`Modelica.Mechanics.MultiBody`, SIMPACK, MSC Adams, and `@modelscript/cad` CSG/STEP).

---

## Core Capabilities

- **URDF, SDFormat & Xacro Parsers (`parseUrdf`, `expandXacro`)**: Zero-regex streaming XML parser supporting ROS 1/2 `<robot>` URDF trees, OSRF `<sdf>` models, and parameterized `<xacro:macro>` / `${...}` expression evaluation.
- **Featherstone $O(N)$ Articulated Dynamics (`computeForwardKinematics`, `computeInverseDynamicsRnea`, `computeForwardDynamicsAba`)**:
  - 6D spatial vector algebra ($\text{Plücker}$ transforms, spatial cross products, spatial inertia tensors)
  - Forward kinematics computing world-frame link poses and spatial velocities
  - Recursive Newton-Euler Algorithm (RNEA) for inverse dynamics ($\tau = \text{ID}(q, \dot{q}, \ddot{q})$)
  - Articulated Body Algorithm (ABA) for $O(N)$ forward dynamics ($\ddot{q} = \text{FD}(q, \dot{q}, \tau)$).
- **Direct Linear-Memory DAE Arena Lowering (`lowerUrdfToDae`)**: Lowers joint generalized coordinates ($q_i, \dot{q}_i$), actuator torques, damping, and articulated equations of motion directly into `@modelscript/runtime`'s `DAEBuilder`.
- **Pre-Flight Robotics Linter (`lintUrdfRobot`, `UrdfErrorCode`)**: 8 static structural, inertial, and kinematic rules (`M7501`–`M7508`) checking parent/child link resolution, kinematic loops, physical inertia tensor triangle inequalities, joint limits, and axis norms.
- **Polyglot MBD & CAD Projections (`urdfToModelica`, `urdfToSimpack`, `urdfToAdams`, `urdfToCadAssembly`)**: Translates URDF robots into `Modelica.Mechanics.MultiBody`, SIMPACK `.spck`, MSC Adams `.adm`, and 3D CSG/STEP CAD assemblies.
- **Kinematic Tree Diagrams & Workspace Indexing (`buildUrdfDiagram`, `renderUrdfDiagramSvg`, `UrdfWorkspaceIndex`)**: Interactive kinematic graph generation, headless SVG rendering, and `IWorkspaceIndex` multi-file symbol indexing.

---

## Package Structure

| Path                             | Description                                                                               |
| :------------------------------- | :---------------------------------------------------------------------------------------- |
| `src/index.ts`                   | Public package exports                                                                    |
| `src/language.ts`                | `urdfLanguage` grammar and file extension registration (`.urdf`, `.sdf`, `.xacro`)        |
| `src/types.ts`                   | Core TypeScript interfaces (`UrdfRobot`, `UrdfLink`, `UrdfJoint`, `UrdfInertial`, etc.)   |
| `src/errors.ts`                  | `UrdfErrorCode` standard diagnostic catalog (`M7501`–`M7508`)                             |
| `src/parser/urdf-parser.ts`      | `parseUrdf` streaming XML parser for `.urdf` and `.sdf` models                            |
| `src/parser/xacro.ts`            | `expandXacro` macro and property evaluator for `.xacro` files                             |
| `src/parser/index.ts`            | Parser module re-exports                                                                  |
| `src/kinematics/featherstone.ts` | `computeForwardKinematics`, `computeInverseDynamicsRnea`, and `computeForwardDynamicsAba` |
| `src/kinematics/index.ts`        | Kinematics module re-exports                                                              |
| `src/lints/rules.ts`             | `lintUrdfRobot` pre-flight robotics verification engine (`M7501`–`M7508`)                 |
| `src/lints/index.ts`             | Linter module re-exports                                                                  |
| `src/dae/urdf-to-dae.ts`         | `lowerUrdfToDae` direct lowering of articulated robot dynamics to `DAEBuilder`            |
| `src/dae/index.ts`               | DAE module re-exports                                                                     |
| `src/projections/modelica.ts`    | `urdfToModelica` translator to `Modelica.Mechanics.MultiBody`                             |
| `src/projections/simpack.ts`     | `urdfToSimpack` translator to `@modelscript/simpack`                                      |
| `src/projections/adams.ts`       | `urdfToAdams` translator to `@modelscript/adams`                                          |
| `src/projections/cad.ts`         | `urdfToCadAssembly` translator to `@modelscript/cad` CSG primitives                       |
| `src/projections/index.ts`       | Projections module re-exports                                                             |
| `src/diagram/urdf-diagram.ts`    | `buildUrdfDiagram` and `renderUrdfDiagramSvg` kinematic tree visualizer                   |
| `src/diagram/index.ts`           | Diagram module re-exports                                                                 |
| `src/workspace-index.ts`         | `UrdfWorkspaceIndex` implementing `IWorkspaceIndex`                                       |
| `src/lsp.ts`                     | LSP diagnostics, document symbols, and hover providers                                    |

---

## Semantic / Pre-Flight Lint Rules

| Code    | Rule                           | Severity  | Description                                                                                                         |
| :------ | :----------------------------- | :-------- | :------------------------------------------------------------------------------------------------------------------ |
| `M7501` | `unresolved-parent-link`       | `error`   | Joint references a non-existent parent (or child) link, or robot contains disconnected tree roots.                  |
| `M7502` | `kinematic-loop`               | `error`   | Closed kinematic chain or duplicate parent joint detected at link (URDF requires an open tree).                     |
| `M7503` | `invalid-inertia-tensor`       | `error`   | Link defines a non-physical inertia tensor (non-positive mass/principal inertia or triangle inequality violation).  |
| `M7504` | `invalid-joint-limits`         | `error`   | Joint defines invalid limits ($\text{lower} \ge \text{upper}$, non-positive effort/velocity, or missing `<limit>`). |
| `M7505` | `missing-mesh-resource`        | `warning` | Visual or collision mesh URI on link is missing a `filename` attribute or may not resolve at runtime.               |
| `M7506` | `massless-link`                | `warning` | Link has zero mass and no inertial specification.                                                                   |
| `M7507` | `zero-norm-joint-axis`         | `error`   | Joint defines a zero-norm rotation/translation axis `[0, 0, 0]`.                                                    |
| `M7508` | `continuous-joint-with-limits` | `warning` | Joint is declared `continuous` but specifies upper/lower limits (or has inverted limits in `lintUrdfRobot`).        |

---

## CLI & Programmatic Usage

### Command-Line Interface

```bash
# Expand Xacro macros and lint a URDF robot model (M7501–M7508)
npx msx urdf lint panda_arm.urdf

# Lower articulated robot dynamics to the ModelScript DAE arena
npx msx urdf flatten panda_arm.urdf

# Project URDF robot to Modelica MultiBody, SIMPACK, MSC Adams, or STEP CAD
npx msx urdf to-modelica panda_arm.urdf
npx msx urdf to-simpack panda_arm.urdf
npx msx urdf to-adams panda_arm.urdf
```

### Programmatic API

```typescript
import {
  computeForwardDynamicsAba,
  computeInverseDynamicsRnea,
  expandXacro,
  lintUrdfRobot,
  lowerUrdfToDae,
  parseUrdf,
  urdfToAdams,
  urdfToModelica,
  urdfToSimpack,
} from "@modelscript/urdf";

// 1. Expand Xacro macros (if applicable) and parse URDF XML
const expandedXml = expandXacro(xacroOrUrdfXml);
const robot = parseUrdf(expandedXml);

// 2. Run pre-flight robotics linter (M7501–M7508)
const diagnostics = lintUrdfRobot(robot);

// 3. Evaluate Featherstone O(N) RNEA inverse dynamics & ABA forward dynamics
const q = new Float64Array(robot.joints.size);
const qd = new Float64Array(robot.joints.size);
const tau = computeInverseDynamicsRnea(robot, q, qd, new Float64Array(robot.joints.size));
const qdd = computeForwardDynamicsAba(robot, q, qd, tau);

// 4. Lower to WebAssembly DAEBuilder and project to Modelica / SIMPACK / Adams
const dae = lowerUrdfToDae(robot);
const modelicaCode = urdfToModelica(robot);
const simpackModel = urdfToSimpack(robot);
const adamsDeck = urdfToAdams(robot);
```

---

## Scripts

| Command             | Description                                                    |
| :------------------ | :------------------------------------------------------------- |
| `npm run build`     | Compile TypeScript sources to `dist/` (`tsc`)                  |
| `npm run clean`     | Remove `dist/` build artifacts (`rimraf dist`)                 |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                          |
| `npm test`          | Run unit and integration test suite via `test-runner.js`       |
| `npm run typecheck` | Run TypeScript type checking without emitting (`tsc --noEmit`) |
