<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/adams

MSC Adams Multibody Dynamics (MBD) and Kinematics Domain Module (`.adm`, `.cmd`, `.acf`) for ModelScript. Features zero-regex AST parsing, pre-flight kinematic linter diagnostics (`M7301`–`M7310`), Grübler-Kutzbach spatial mobility analysis, direct linear-memory WebAssembly `DAEBuilder` lowering with Baumgarte constraint stabilization, cross-format bidirectional projections (SIMPACK `.spck`, Modelica `MultiBody`), multi-file workspace indexing, and Language Server Protocol (LSP) services.

---

## Core Capabilities

- **MSC Adams Dataset & Command Parser (`parseAdams`)**: Zero-regex character-level parser supporting `.adm` dataset statements (`PART`, `MARKER`, `JOINT`, `GCON`, `SPRINGDAMPER`, `SFORCE`, `VFORCE`, `GFORCE`, `BUSHING`, `MOTION`, `REQUEST`), `.cmd` Adams View scripts (`model create`, `part create`, `marker create`, `constraint create joint`), and `.acf` analysis control decks (`SIMULATE/DYNAMIC`, `EQUILIBRIUM`, `LINEAR/EIGEN`).
- **Grübler-Kutzbach Spatial Mobility & Kinematic Solver (`analyzeAdamsMobility`, `solveAdamsKinematics`)**: Computes spatial mechanism degrees of freedom ($M = 6(N - 1) - \sum (6 - f_i)$), detects overconstrained topologies, and evaluates spatial orientation transformations and joint frames.
- **Direct Linear-Memory DAE Arena Lowering (`lowerAdamsToDae`)**: Lowers rigid body Newton-Euler equations of motion and holonomic joint constraints directly into `@modelscript/runtime`'s `DAEBuilder` with Baumgarte constraint stabilization ($\ddot{\Phi} + 2\alpha\dot{\Phi} + \beta^2\Phi = 0$).
- **Pre-Flight Multibody Linter (`lintAdamsModel`, `AdamsErrorCode`)**: Static structural, inertial, and kinematic validation (`M7301`–`M7310`) with 1-click LSP quick-fix code actions.
- **Polyglot MBD Projections (`adamsToModelica`, `adamsToSimpack`)**: Translates MSC Adams parts, markers, joints, and force elements into `Modelica.Mechanics.MultiBody` models and SIMPACK `.spck` multibody decks.
- **Schematic & Kinematic Topology Diagrams (`buildAdamsDiagram`, `renderAdamsDiagramSvg`)**: Generates interactive multibody topology graphs and headless SVG schematics.
- **Multi-File Workspace Indexing & LSP (`AdamsWorkspaceIndex`, `validateAdams`, `getAdamsDocumentSymbols`, `getAdamsHover`)**: Full `IWorkspaceIndex` implementation and language server endpoints for `.adm`, `.cmd`, and `.acf` workspaces.

---

## Package Structure

| Path                                 | Description                                                                                 |
| :----------------------------------- | :------------------------------------------------------------------------------------------ |
| `src/index.ts`                       | Public package exports                                                                      |
| `src/language.ts`                    | `adamsLanguage` grammar and file extension registration (`.adm`, `.cmd`, `.acf`)            |
| `src/types.ts`                       | Core TypeScript interfaces (`AdamsDataset`, `AdamsPart`, `AdamsMarker`, `AdamsJoint`, etc.) |
| `src/errors.ts`                      | `AdamsErrorCode` standard diagnostic catalog (`M7301`–`M7310`)                              |
| `src/parser/adams-parser.ts`         | `parseAdams` parser for `.adm` datasets, `.cmd` scripts, and `.acf` control files           |
| `src/parser/index.ts`                | Parser module re-exports                                                                    |
| `src/kinematics/adams-kinematics.ts` | Spatial orientation math, Euler rotation matrices, and forward kinematic assembly           |
| `src/kinematics/index.ts`            | Kinematics module re-exports                                                                |
| `src/lints/rules.ts`                 | `lintAdamsModel` and `analyzeAdamsMobility` pre-flight multibody verification engine        |
| `src/lints/index.ts`                 | Linter module re-exports                                                                    |
| `src/dae/adams-to-dae.ts`            | `lowerAdamsToDae` direct WebAssembly `DAEBuilder` lowering with Baumgarte stabilization     |
| `src/dae/index.ts`                   | DAE lowering module re-exports                                                              |
| `src/projections/modelica.ts`        | `adamsToModelica` translator to `Modelica.Mechanics.MultiBody`                              |
| `src/projections/simpack.ts`         | `adamsToSimpack` translator to `@modelscript/simpack` models                                |
| `src/projections/index.ts`           | Projections module re-exports                                                               |
| `src/diagram/adams-diagram.ts`       | Kinematic topology diagram builder and SVG renderer                                         |
| `src/diagram/index.ts`               | Diagram module re-exports                                                                   |
| `src/workspace-index.ts`             | `AdamsWorkspaceIndex` implementing `IWorkspaceIndex` for multi-file MBD repositories        |
| `src/lsp.ts`                         | LSP diagnostics, document symbols, and hover providers                                      |

---

## Semantic / Pre-Flight Lint Rules

| Code    | Rule                          | Severity  | Description                                                                                                        |
| :------ | :---------------------------- | :-------- | :----------------------------------------------------------------------------------------------------------------- |
| `M7301` | `overconstrained-mobility`    | `error`   | Mechanism is overconstrained according to Grübler-Kutzbach criterion ($\text{Mobility} < 0$).                      |
| `M7302` | `gimbal-lock-orientation`     | `warning` | Euler orientation angles for marker indicate near-gimbal-lock singularity.                                         |
| `M7303` | `dangling-marker-reference`   | `error`   | Part, joint, or force element references a non-existent marker or part ID.                                         |
| `M7304` | `non-physical-inertia-tensor` | `error`   | Part has non-physical inertia tensor (non-positive principal moments or rigid-body triangle inequality violation). |
| `M7305` | `massless-part-floating`      | `error`   | Moving part has zero or negative mass without kinematic grounding.                                                 |
| `M7307` | `coincident-joint-markers`    | `warning` | Joint uses identical I and J markers (`AdamsErrorCode`) or connects non-coincident markers on concentric joints.   |
| `M7308` | `negative-spring-damping`     | `error`   | Spring-damper force element defines non-physical negative stiffness ($K < 0$) or damping ($C < 0$).                |
| `M7309` | `missing-ground-part`         | `error`   | Dataset does not define a ground reference body (`PART/... GROUND`).                                               |
| `M7310` | `unconstrained-part`          | `warning` | Moving part is completely disconnected from joints or force elements (floating rigid body).                        |

---

## CLI & Programmatic Usage

### Command-Line Interface

```bash
# Lint an MSC Adams dataset or command script
npx msx adams lint mechanism.adm

# Compute Grübler-Kutzbach mobility and lower to DAE arena
npx msx adams flatten mechanism.adm

# Project MSC Adams dataset to Modelica MultiBody or SIMPACK
npx msx adams to-modelica mechanism.adm
npx msx adams to-simpack mechanism.adm
```

### Programmatic API

```typescript
import {
  adamsToModelica,
  adamsToSimpack,
  analyzeAdamsMobility,
  lintAdamsModel,
  lowerAdamsToDae,
  parseAdams,
} from "@modelscript/adams";

// 1. Parse MSC Adams .adm / .cmd deck
const dataset = parseAdams(adamsDeck);

// 2. Run pre-flight multibody linter (M7301–M7310)
const diagnostics = lintAdamsModel(dataset);

// 3. Analyze Grübler-Kutzbach spatial mobility
const mobility = analyzeAdamsMobility(dataset);
console.log(`Degrees of freedom: ${mobility.calculatedMobility}`);

// 4. Lower directly to linear-memory WebAssembly DAEBuilder
const dae = lowerAdamsToDae(dataset);

// 5. Project to SIMPACK and Modelica MultiBody
const simpackModel = adamsToSimpack(dataset);
const modelicaCode = adamsToModelica(dataset);
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
