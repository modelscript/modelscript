# @modelscript/easy5

Boeing / MSC Software EASY5 multidisciplinary systems dynamic modeling, simulation, and linear control systems engineering package (`.ez5`, `.ezm`, `.ezd`, `.eas`, `.tab`) for ModelScript.

## Capabilities

- **EASY5 Parsing & AST (`parseEasy5`, `parseEasy5Table`)**: Full support for components, parameter lists (`XP`), initial state vectors (`S0`), custom port declarations, and inter-component connections.
- **Standard Component Library (`GP_BLOCK_DESCRIPTORS`)**: Mathematical and physical implementations of `GA` (Gain), `SJ` (Summing Junction), `IN` (Integrator), `TF` (Transfer Function), `LA` (Lead-Lag Filter), `LM` (Limiter), `DZ` (Deadband), `HY` (Hysteresis), `TD` (Time Delay), `SW` (Switch), and `FN` (Table Lookup).
- **User General Fortran Blocks (`UG`/`UX`)**: Embedded Fortran procedural derivative calculations (`SD(i) = ...`, `S(i)`, `XP(i)`) integrated with `@modelscript/fortran`.
- **Direct Continuous DAE Arena Lowering (`lowerEasy5ToDae`)**: Zero-allocation lowering of continuous state derivatives and algebraic equations directly into `@modelscript/runtime`'s `IDaeBuilder`.
- **Pre-Flight Static Linter (`lintEasy5`, `M7001`–`M7012`)**: Algebraic loop detection via Tarjan's algorithm, unconnected input port warnings, improper transfer functions, parameter bounds, state index checks, and Fortran syntax verification.
- **Linear Control Systems Analysis**:
  - `trimEasy5`: Non-linear equilibrium operating point solver ($\dot{x} = 0$).
  - `linearizeEasy5`: Central finite-difference Jacobian linearization extracting $(A, B, C, D)$ continuous state-space matrices.
  - `computeEigenvalues`: Open-loop poles, damping ratios ($\zeta$), natural frequencies ($\omega_n$), and RHP stability checks.
  - `computeBodePlot`: Frequency response sweeps generating Bode magnitude/phase and Nyquist loci.
- **Polyglot Projections**:
  - `easy5ToModelica`: Clean Modelica 3.x continuous block model projection (`Modelica.Blocks.*`).
  - `easy5ToSsp`: FMI System Structure and Parameterization XML generation (`SystemStructure.ssd`).
- **Diagram Visualization (`renderEasy5SchematicSvg`, `buildEasy5DiagramData`)**: AntV X6 graph structures and headless SVG schematic drawings.
- **Multi-File Workspace Indexing (`Easy5WorkspaceIndex`)**: Global indexing for cross-file model resolution and VS Code Library tree navigation.
