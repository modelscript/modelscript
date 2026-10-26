# @modelscript/simulink

Native MATLAB Simulink (`.slx`, `.mdl`) Compiler, Linter, DAE Arena Lowering, and Modelica Projections for ModelScript.

## Capabilities

- **Zero-Regex Parsers**:
  - `.slx`: OPC ZIP archive streaming and `@modelscript/dsl/xml` AST parser (`simulink/blockdiagram.xml`).
  - `.mdl`: Zero-regex character scanner for ASCII structured block diagrams (`Block { ... }`, `Line { ... }`).
- **Pre-Flight Control Linters (`M7201`–`M7210`)**:
  - `M7201`: Unconnected input ports.
  - `M7202`: Direct-feedthrough algebraic loops.
  - `M7203`: Unresolved subsystem references.
  - `M7204`: Port index discrepancies.
  - `M7205`: Multi-rate sample time mismatches.
  - `M7206`: Invalid parameter values.
  - `M7207`: Invalid bus element selectors.
- **Direct Linear-Memory DAE Arena Lowering**:
  - Continuous ODE state-space integration for `Integrator`, `TransferFcn`, `StateSpace`.
  - Algebraic equations for `Gain`, `Sum`, `Product`, `Math`.
  - Discrete clocked equations for `UnitDelay`.
  - Tarjan strongly-connected-components (SCC) block scheduling.
- **Projections**:
  - Bidirectional projection to `Modelica.Blocks`.
- **LSP & CLI Support**:
  - Multi-file workspace indexing via `IWorkspaceIndex`.
  - LSP endpoints (`validateSimulink`, `getSimulinkDocumentSymbols`, `getSimulinkHover`).
  - Command-line tooling via `msx simulink <action> [files...]`.
