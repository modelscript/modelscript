<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/igtl

OpenIGTLink / PLUS Toolkit (`.igtl`, `.plus.xml`) Surgical Navigation, Optical / EM Tracking (`NDI Polaris`, `NDI Aurora`), $\mathrm{SE}(3)$ Coordinate Frame Transform Chains, and Pivot / Fiducial Registration language package for ModelScript. Features a unified PLUS Toolkit `<PlusConfiguration>` XML and OpenIGTLink message stream parser (`parseIgtl`), multi-file workspace indexing (`IgtlWorkspaceIndex`), a BFS $\mathrm{SE}(3)$ homogeneous transform chain & least-squares stylus pivot solver (`solveTransformChainAndPivot`, `computeOrthogonalityError`, `computeRotationDeterminant`), direct linear-memory `DAEBuilder` lowering (`lowerIgtlToDae`), 10 $\mathrm{SO}(3)$ orthogonality & clinical registration lint rules (`M9801`–`M9810`, `lintIgtlDocument`, `IgtlErrorCode`), ROS 2 URDF and Modelica 3.x projections (`igtlToUrdf`, `igtlToModelica`), and Language Server Protocol (LSP) services.

---

## Core Capabilities

- **PLUS Toolkit `<PlusConfiguration>` XML & OpenIGTLink Parser (`parseIgtl`)**: Parses `<DataCollection>` hardware devices (`PolarisTracker`, `AuroraTracker`, `OpticalMarkerTracker`, `UltrasoundSonixVideo`, `VirtualMixer`), `<CoordinateDefinitions>` $4 \times 4$ homogeneous `<Transform>` matrices (`From`, `To`, `Matrix`, `Error`), `<PivotCalibration>` stylus samples, `<FiducialRegistration>` homologous landmarks, `<PlusOpenIGTLinkServer>` endpoints, and `IGTL_TRANSFORM` / `IGTL_TRACKING_DATA` messages.
- **$\mathrm{SE}(3)$ Transform Chain & Stylus Pivot Calibration Solver (`solveTransformChainAndPivot`, `computeOrthogonalityError`, `computeRotationDeterminant`)**: Searches the coordinate frame graph via Breadth-First Search (BFS), composes and inverts $\mathrm{SE}(3)$ matrices $\mathbf{T}_{A \leftarrow B}^{-1} = \begin{bmatrix} \mathbf{R}^\top & -\mathbf{R}^\top \mathbf{t} \\ \mathbf{0}^\top & 1 \end{bmatrix}$ along any path (e.g., $\text{StylusTip} \to \text{Stylus} \to \text{Tracker} \to \text{Reference} \to \text{Image}$), and solves the overdetermined least-squares pivot system $\mathbf{R}_i \mathbf{p}_{\text{tip}} - \mathbf{p}_{\text{pivot}} = -\mathbf{t}_i$ to compute tip offset and RMS pivot error ($\text{mm}$).
- **Direct Linear-Memory `DAEBuilder` Lowering (`lowerIgtlToDae`)**: Lowers surgical tool 6-DOF Kalman tracking filters and robotic needle-insertion visual-servoing control loops directly into ModelScript's WebAssembly `DAEBuilder` arena.
- **10 $\mathrm{SO}(3)$ Orthogonality & Clinical Registration Lint Rules (`M9801`–`M9810`, `lintIgtlDocument`)**: Static verification of $\mathrm{SO}(3)$ rotation matrix orthogonality ($\lVert \mathbf{R}^\top \mathbf{R} - \mathbf{I} \rVert_F \le 10^{-3}$, $\det(\mathbf{R}) \approx +1$), homogeneous bottom row $[0, 0, 0, 1]$, connected coordinate frame graphs, acyclic transform chains, clinical registration/pivot RMS error thresholds ($\le 2.0\text{ mm}$), positive device `AcquisitionRate`, valid device/channel bindings, identity self-transforms, TCP server ports ($[1024, 65535]$), and duplicate transform edges.
- **ROS 2 URDF & Modelica 3.x Projections (`igtlToUrdf`, `igtlToModelica`)**: Translates PLUS/OpenIGTLink surgical coordinate trees into ROS 2 URDF (`@modelscript/urdf`) `<link>` / `<joint>` kinematic trees (with Roll-Pitch-Yaw extraction) and Modelica 3.x visual-servoing models.

---

## Package Structure

| Path                       | Description                                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`             | Public package exports                                                                                           |
| `src/language.ts`          | `igtlLanguage` definition, compiler actions, and MCP tool (`igtl_verify_calibration`)                            |
| `src/types.ts`             | `IgtlDocument`, `IgtlDevice`, `IgtlTransform`, `IgtlPivotCalibration`, `IgtlKinematicsResult`                    |
| `src/parser/index.ts`      | `parseIgtl` PLUS Toolkit `<PlusConfiguration>` XML and OpenIGTLink message parser                                |
| `src/lints/rules.ts`       | `IgtlErrorCode`, `lintIgtlDocument` (`M9801`–`M9810`), `computeOrthogonalityError`, `computeRotationDeterminant` |
| `src/lints/index.ts`       | Linter barrel exports                                                                                            |
| `src/solvers/index.ts`     | `solveTransformChainAndPivot` $\mathrm{SE}(3)$ BFS chain composer and least-squares pivot solver                 |
| `src/dae/index.ts`         | `lowerIgtlToDae` surgical tracker filter and visual-servoing ODE lowering into `DAEBuilder`                      |
| `src/projections/index.ts` | `igtlToUrdf` and `igtlToModelica` translators to ROS 2 URDF and Modelica 3.x                                     |
| `src/workspace-index.ts`   | `IgtlWorkspaceIndex` implementing `IWorkspaceIndex` across `.igtl` and `.plus.xml` files                         |
| `src/lsp.ts`               | LSP validation, document symbols, $\mathrm{SE}(3)$ matrix hover cards, completion, and definitions               |

---

## Pre-Flight Semantic Lint Rules (`M9801`–`M9810`)

| Code    | Rule                                    | Severity  | Description                                                                                                                                                       |
| ------- | --------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `M9801` | `igtl-non-orthogonal-rotation`          | `error`   | $3 \times 3$ rotation block violates $\mathrm{SO}(3)$ orthogonality ($\lVert\mathbf{R}^\top\mathbf{R}-\mathbf{I}\rVert_F > 10^{-3}$) or $\det(\mathbf{R}) \le 0$. |
| `M9802` | `igtl-invalid-homogeneous-bottom-row`   | `error`   | $4 \times 4$ homogeneous transform matrix bottom row is not $[0, 0, 0, 1]$.                                                                                       |
| `M9803` | `igtl-disconnected-coordinate-frame`    | `error`   | Coordinate frame graph is disconnected (contains isolated transform islands).                                                                                     |
| `M9804` | `igtl-cyclic-transform-chain`           | `error`   | Directed cycle detected in `<CoordinateDefinitions>` transform hierarchy.                                                                                         |
| `M9805` | `igtl-excessive-registration-error`     | `warning` | Transform, pivot calibration, or fiducial registration RMS error (`TRE` / `FRE`) exceeds $2.0\text{ mm}$ clinical limit.                                          |
| `M9806` | `igtl-invalid-acquisition-rate`         | `error`   | Tracker or imaging `<Device>` specifies `AcquisitionRate <= 0 Hz`.                                                                                                |
| `M9807` | `igtl-unresolved-device-or-channel`     | `error`   | `VirtualMixer` or `PlusOpenIGTLinkServer` references an undeclared device or `OutputChannel` ID.                                                                  |
| `M9808` | `igtl-self-transform-identity-mismatch` | `error`   | Self-transform (`From === To`) is not equal to the $4 \times 4$ identity matrix $\mathbf{I}_4$.                                                                   |
| `M9809` | `igtl-invalid-server-port`              | `error`   | `PlusOpenIGTLinkServer` `ListeningPort` is outside the valid unprivileged TCP port range $[1024, 65535]$.                                                         |
| `M9810` | `igtl-duplicate-transform-edge`         | `error`   | Duplicate `<Transform>` declared for the same `(From, To)` coordinate frame pair.                                                                                 |

---

## CLI & Programmatic Usage

### Command-Line Interface (`msx igtl`)

```bash
# Lint a PLUS Toolkit / OpenIGTLink surgical navigation config (M9801-M9810)
npx msx igtl lint cranial_navigation.plus.xml

# Solve SE(3) coordinate frame chain (StylusTip -> Image) and stylus pivot calibration
npx msx igtl solve-kinematics cranial_navigation.plus.xml --from StylusTip --to Image

# Lower tracker/servoing ODEs to DAE or project to ROS 2 URDF (.urdf) and Modelica (.mo)
npx msx igtl to-dae cranial_navigation.plus.xml
npx msx igtl to-urdf cranial_navigation.plus.xml
npx msx igtl to-modelica cranial_navigation.plus.xml
```

### Programmatic API

```typescript
import {
  igtlToModelica,
  igtlToUrdf,
  lintIgtlDocument,
  lowerIgtlToDae,
  parseIgtl,
  solveTransformChainAndPivot,
} from "@modelscript/igtl";

// 1. Parse PLUS Toolkit / OpenIGTLink XML and run SO(3) & clinical registration lints (M9801-M9810)
const doc = parseIgtl(plusXml, "cranial_navigation.plus.xml");
const diagnostics = lintIgtlDocument(doc);

// 2. Solve SE(3) homogeneous transform chain (StylusTip -> Image) and stylus pivot calibration
const kinematics = solveTransformChainAndPivot(doc, "StylusTip", "Image");
console.log("StylusTip in Image frame (mm):", kinematics.tipPositionInTargetMm);

// 3. Lower to WebAssembly DAEBuilder or project to ROS 2 URDF (.urdf) and Modelica 3.x (.mo)
const dae = lowerIgtlToDae(doc);
const urdfXml = igtlToUrdf(doc);
const modelicaCode = igtlToModelica(doc);
```

---

## Scripts

| Command             | Description                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `npm run build`     | Compile TypeScript to `dist/`                                                                |
| `npm test`          | Run OpenIGTLink/PLUS parser, $\mathrm{SO}(3)$ linter, $\mathrm{SE}(3)$ pivot, and URDF tests |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                                                        |
| `npm run typecheck` | Run `tsc --noEmit` type verification                                                         |
| `npm run clean`     | Remove `dist/` build artifacts                                                               |

---

## License

`AGPL-3.0-or-later`
