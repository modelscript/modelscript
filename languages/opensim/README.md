<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/opensim

OpenSim (`.osim`) Musculoskeletal Biomechanics, Hill-Type Muscle-Tendon Dynamics (`Millard2012EquilibriumMuscle`, `Thelen2003Muscle`), and Orthopaedic Surgical Planning language package for ModelScript. Features an OpenSim 3.x / 4.x XML parser (`parseOpenSim`), multi-file workspace indexing (`OpenSimWorkspaceIndex`), a Hill-type muscle-tendon activation & contraction ODE simulator (`simulateMuscleDynamics`, `computeActivationDerivative`), direct linear-memory `DAEBuilder` lowering (`lowerOpenSimToDae`), 10 biomechanical & anatomical lint rules (`M9101`–`M9110`, `lintOpenSimDocument`, `OpenSimErrorCode`), Modelica 3.x and ROS 2 URDF projections (`openSimToModelica`, `openSimToUrdf`), and Language Server Protocol (LSP) services.

---

## Core Capabilities

- **OpenSim 3.x / 4.x `.osim` XML Parser (`parseOpenSim`)**: Parses `<OpenSimDocument>` hierarchies including `<BodySet>` (mass, center of mass, 6-component inertia tensor, `<WrapObjectSet>`), `<JointSet>` (`PinJoint`, `SliderJoint`, `UniversalJoint`, `BallJoint`, `WeldJoint`, `CustomJoint`, `FreeJoint`, `<CoordinateSet>` ranges), `<ForceSet>` (`Millard2012EquilibriumMuscle`, `Thelen2003Muscle`, `Schutte1993Muscle`, `CoordinateActuator`, `<GeometryPath>` `<PathPointSet>`), and `<MarkerSet>`.
- **Hill-Type Muscle-Tendon & Multibody Simulator (`simulateMuscleDynamics`, `computeActivationDerivative`)**: Integrates muscle activation dynamics $\dot{a} = (u - a) / \tau(u, a)$, Hill-type active force-length-velocity and passive parallel elastic element equilibrium ($F^M \cos\alpha = F^T$), moment arms across `<GeometryPath>` via points, and multibody joint coordinate equations of motion.
- **Direct Linear-Memory `DAEBuilder` Lowering (`lowerOpenSimToDae`)**: Lowers generalized joint coordinates ($q, \dot{q}$), muscle activation states ($a$), normalized fiber lengths ($\tilde{l}^M$), and multibody torque balance equations directly into ModelScript's WebAssembly `DAEBuilder` arena.
- **10 Biomechanical & Anatomical Lint Rules (`M9101`–`M9110`, `lintOpenSimDocument`)**: Static verification of body frame references, strictly positive body mass and principal inertia, acyclic kinematic joint trees, coordinate range limits, Hill-type muscle parameters ($F_0^M, l_0^M, l_s^T > 0$), pennation angles ($[0, \pi/2)\text{ rad}$), multi-body muscle path points, wrap object references, activation/deactivation time constants ($\tau_{\text{act}} \le \tau_{\text{deact}}$), and duplicate component names.
- **Modelica 3.x & ROS 2 URDF Projections (`openSimToModelica`, `openSimToUrdf`)**: Translates OpenSim musculoskeletal models into Modelica 3.x biomechanics models and ROS 2 URDF (`@modelscript/urdf`) robot/exoskeleton descriptions.

---

## Package Structure

| Path                       | Description                                                                                              |
| -------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/index.ts`             | Public package exports                                                                                   |
| `src/language.ts`          | `openSimLanguage` definition, compiler actions, and MCP tool (`opensim_analyze`)                         |
| `src/types.ts`             | `OpenSimDocument`, `OpenSimBody`, `OpenSimJoint`, `OpenSimCoordinate`, `OpenSimMuscle` types             |
| `src/parser/index.ts`      | `parseOpenSim` OpenSim 3.x / 4.x `.osim` XML parser                                                      |
| `src/lints/rules.ts`       | `OpenSimErrorCode` and `lintOpenSimDocument` biomechanical linter (`M9101`–`M9110`)                      |
| `src/lints/index.ts`       | Linter barrel exports                                                                                    |
| `src/solvers/index.ts`     | `simulateMuscleDynamics` and `computeActivationDerivative` Hill-type muscle-tendon ODE solver            |
| `src/dae/index.ts`         | `lowerOpenSimToDae` direct lowering of coordinates and Hill-type muscles into `DAEBuilder` linear memory |
| `src/projections/index.ts` | `openSimToModelica` and `openSimToUrdf` cross-language translators                                       |
| `src/workspace-index.ts`   | `OpenSimWorkspaceIndex` implementing `IWorkspaceIndex` across `.osim` files                              |
| `src/lsp.ts`               | LSP validation, document symbols, hover, completion, and definition providers                            |

---

## Pre-Flight Semantic Lint Rules (`M9101`–`M9110`)

| Code    | Rule                                      | Severity  | Description                                                                                                                    |
| ------- | ----------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `M9101` | `opensim-unresolved-body-frame`           | `error`   | Joint, marker, wrap object, or muscle `<PathPoint>` references an undeclared body frame.                                       |
| `M9102` | `opensim-non-positive-body-mass`          | `error`   | Non-ground `<Body>` specifies `mass <= 0` or non-positive principal inertia ($I_{xx}, I_{yy}, I_{zz} \le 0$).                  |
| `M9103` | `opensim-kinematic-tree-cycle`            | `error`   | Kinematic joint graph contains a closed loop or multiple parent joints targeting the same child body.                          |
| `M9104` | `opensim-invalid-coordinate-range`        | `error`   | `<Coordinate>` specifies `rangeMin >= rangeMax` or `defaultValue` outside `[rangeMin, rangeMax]`.                              |
| `M9105` | `opensim-invalid-muscle-parameters`       | `error`   | Muscle specifies `maxIsometricForce <= 0`, `optimalFiberLength <= 0`, or `tendonSlackLength <= 0`.                             |
| `M9106` | `opensim-excessive-pennation-angle`       | `error`   | Muscle `pennationAngleAtOptimal` is outside the physiological domain $[0, \pi/2)\text{ rad}$ ($\ge 90^\circ$).                 |
| `M9107` | `opensim-insufficient-muscle-path-points` | `error`   | Muscle `<GeometryPath>` has fewer than $2$ path points or does not span at least $2$ distinct body frames.                     |
| `M9108` | `opensim-unresolved-wrap-object`          | `error`   | Muscle references an undeclared `<WrapObject>` name.                                                                           |
| `M9109` | `opensim-invalid-time-constants`          | `warning` | Muscle specifies `activationTimeConstant <= 0`, `deactivationTimeConstant <= 0`, or $\tau_{\text{act}} > \tau_{\text{deact}}$. |
| `M9110` | `opensim-duplicate-component-name`        | `error`   | Duplicate body, joint, coordinate, or muscle name declared within the `.osim` model.                                           |

---

## CLI & Programmatic Usage

### Command-Line Interface (`msx opensim`)

```bash
# Lint an OpenSim musculoskeletal model (M9101-M9110)
npx msx opensim lint arm26.osim

# Simulate Hill-type muscle-tendon contraction and joint kinematics
npx msx opensim simulate arm26.osim --duration 1.0 --dt 0.005

# Lower to DAE or project to Modelica 3.x (.mo) and ROS 2 URDF (.urdf)
npx msx opensim to-dae arm26.osim
npx msx opensim to-modelica arm26.osim
npx msx opensim to-urdf arm26.osim
```

### Programmatic API

```typescript
import {
  lintOpenSimDocument,
  lowerOpenSimToDae,
  openSimToModelica,
  openSimToUrdf,
  parseOpenSim,
  simulateMuscleDynamics,
} from "@modelscript/opensim";

// 1. Parse OpenSim .osim XML and run biomechanical lint rules (M9101-M9110)
const doc = parseOpenSim(osimXml, "arm26.osim");
const diagnostics = lintOpenSimDocument(doc);

// 2. Simulate Hill-type muscle activation and joint coordinate dynamics
const sim = simulateMuscleDynamics(doc, { duration: 1.0, dt: 0.005, defaultExcitation: 0.6 });
console.log("Peak muscle forces (N):", sim.peakMuscleForces);

// 3. Lower to WebAssembly DAEBuilder or project to Modelica 3.x and ROS 2 URDF
const dae = lowerOpenSimToDae(doc);
const modelicaCode = openSimToModelica(doc);
const urdfXml = openSimToUrdf(doc);
```

---

## Scripts

| Command             | Description                                                                        |
| ------------------- | ---------------------------------------------------------------------------------- |
| `npm run build`     | Compile TypeScript to `dist/`                                                      |
| `npm test`          | Run OpenSim `.osim` parser, biomechanical linter, Hill-type muscle, and URDF tests |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                                              |
| `npm run typecheck` | Run `tsc --noEmit` type verification                                               |
| `npm run clean`     | Remove `dist/` build artifacts                                                     |

---

## License

`AGPL-3.0-or-later`
