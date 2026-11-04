<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/igtl

OpenIGTLink surgical navigation messages (`.igtl`) and PLUS Toolkit real-time optical/EM tracking & ultrasound calibration configurations (`.plus.xml`) language package for ModelScript.

---

## Core Capabilities

- **PLUS Toolkit & OpenIGTLink Parser**: Parses `<PlusConfiguration>` XML files (devices, output channels, `<CoordinateDefinitions>` $4 \times 4$ homogeneous transforms, `<PlusOpenIGTLinkServer>`, pivot calibration poses, fiducial arrays) and `.igtl` message streams.
- **Surgical Navigation & $SE(3)$ Linter (`M9801`–`M9810`)**: Validates $SO(3)$ rotation matrix orthogonality ($\lVert \mathbf{R}^\top \mathbf{R} - \mathbf{I} \rVert_F \le 10^{-3}, \det(\mathbf{R}) > 0$), homogeneous bottom row $[0,0,0,1]$, coordinate frame graph connectivity, acyclic transform chains, registration RMS error thresholds ($\le 2.0\text{ mm}$), tracker acquisition rates, channel bindings, and TCP port ranges.
- **$SE(3)$ Kinematic Chain, Stylus Pivot Calibration & Fitzpatrick TRE Engine**: Solves shortest-path $SE(3)$ transform composition, overdetermined least-squares stylus pivot calibration ($\mathbf{R}_i \mathbf{p}_{\text{tip}} - \mathbf{p}_{\text{pivot}} = -\mathbf{t}_i$), and Fitzpatrick (1998) Target Registration Error ($\text{TRE}$).
- **DAE Lowering & Polyglot Projections**: Lowers navigation transforms and calibration telemetry into `DAEBuilder`, and projects coordinate trees to ROS URDF (`igtlToUrdf`) and Modelica 3.x (`igtlToModelica`).
- **LSP & Workspace Index Integration**: Provides $SE(3)$ matrix and TRE hover cards, symbol indexing, completions, and diagnostics.

---

## Package Structure

| Path                     | Description                                                                  |
| ------------------------ | ---------------------------------------------------------------------------- |
| `src/index.ts`           | Primary package entry point and public API re-exports                        |
| `src/language.ts`        | OpenIGTLink / PLUS language definition and actions                           |
| `src/types.ts`           | Domain types for tracking devices, $SE(3)$ transforms, and IGTL servers      |
| `src/parser/`            | PLUS Toolkit (`.plus.xml`) and OpenIGTLink (`.igtl`) parser                  |
| `src/lints/`             | $SE(3)$ transform and surgical navigation safety linters (`M9801`–`M9810`)   |
| `src/kinematics/`        | $SE(3)$ chain solver, least-squares pivot calibration, Fitzpatrick TRE & DAE |
| `src/projections/`       | Projections to ROS URDF (`igtlToUrdf`) and Modelica 3.x (`igtlToModelica`)   |
| `src/workspace-index.ts` | Multi-file workspace symbol indexer (`IgtlWorkspaceIndex`)                   |
| `src/lsp.ts`             | Language Server Protocol diagnostics, symbols, hover, and completions        |
