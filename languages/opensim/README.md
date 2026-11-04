<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/opensim

OpenSim 3.x / 4.x (`.osim`) biomechanical musculoskeletal modeling, Hill-type muscle-tendon contraction dynamics, linear-memory DAE lowering, and Modelica / URDF cross-domain projection language package for ModelScript.

---

## Core Capabilities

- **OpenSim 3.x & 4.x `.osim` XML Parser**: High-precision parser for `<OpenSimDocument>`, `<BodySet>`, `<JointSet>`, `<ForceSet>` (`Thelen2003Muscle`, `Millard2012EquilibriumMuscle`, `Schutte1993Muscle`), `<MarkerSet>`, `<WrapObjectSet>`, and `<ConstraintSet>` with exact 1-indexed line, column, and byte offset source ranges.
- **Biomechanical Semantic Linter (`M9101`–`M9110`)**: Validates body frame resolution, positive mass and principal moments of inertia ($I_{xx}, I_{yy}, I_{zz} > 0$), kinematic tree acyclicity, coordinate clamping ranges, Hill-type muscle physiological bounds, pennation angles, and wrap object references.
- **Hill-Type Muscle & Multibody RK4 Solver**: Integrates neural excitation-contraction activation dynamics ($\dot{a}$), Gaussian active/passive force-length and force-velocity curves, tendon equilibrium, and generalized coordinate accelerations ($\ddot{q}$).
- **Direct Linear-Memory DAE Lowering**: Compiles generalized coordinates ($q_i$), generalized speeds ($u_i$), muscle activations ($a_m$), fiber lengths ($l^M_m$), and Hill force balances directly into `DAEBuilder`.
- **Cross-Domain Projections**: Exports OpenSim musculoskeletal models to Modelica 3.x multibody packages and ROS / Gazebo URDF `<robot>` descriptions.
- **LSP & Workspace Index Integration**: Provides `OpenSimWorkspaceIndex` (`IWorkspaceIndex`), document symbols, hover cards, completions, go-to-definition, and executable engineering actions.

---

## Package Structure

| Path                     | Description                                                                   |
| ------------------------ | ----------------------------------------------------------------------------- |
| `src/index.ts`           | Primary package entry point and public API re-exports                         |
| `src/language.ts`        | OpenSim language registration and executable engineering actions              |
| `src/types.ts`           | Strongly-typed AST and diagnostic interfaces for OpenSim `.osim` documents    |
| `src/parser/index.ts`    | OpenSim 3.x and 4.x XML parser with source range tracking                     |
| `src/lints/`             | Biomechanical and musculoskeletal semantic linter (`M9101`–`M9110`)           |
| `src/solvers/index.ts`   | Hill-type muscle activation and coordinate dynamics RK4 solver                |
| `src/dae/index.ts`       | Direct lowering to linear-memory `DAEBuilder`                                 |
| `src/projections/`       | Projections to Modelica 3.x musculoskeletal packages and URDF `<robot>` XML   |
| `src/workspace-index.ts` | Multi-file workspace symbol indexer implementing `IWorkspaceIndex`            |
| `src/lsp.ts`             | Language Server Protocol validation, symbols, hover, completion, & definition |
