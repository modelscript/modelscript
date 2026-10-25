# @modelscript/rocets

Native support for **NASA ROCETS (Rocket Engine Transient Simulator)** in ModelScript.

## Capabilities

- **Syntax & Input Decks**: Parses classical and modern ROCETS model decks (`.roc`, `.rct`, `.inp`).
- **Propulsion Component Catalog**: Thrust chambers, turbopumps, turbines, gas generators/preburners, regenerative cooling channels, ducts/lines, valves, and flow junctions.
- **Thermodynamics & Combustion**: Fluid state equations for $LOX$, $LH_2$, $LCH_4$, RP-1, combustion equilibrium properties ($c^*$, $\gamma$, $T_c$, $I_{sp}$).
- **Continuous DAE Arena Lowering**: Direct lowering to linear-memory `IDaeBuilder` continuous states (shaft dynamics, compressible lines, heat flux).
- **Pre-Flight Propulsion Linter**: Diagnostic rules `M8001`–`M8014` enforcing fluid continuity, pressure loop closure, NPSH cavitation margins, and power balances.
- **Engine Balance Solver**: Newton-Raphson steady-state solver for turbopump shaft power equilibrium and pressure closures.
- **Turnkey Projections**: Instant translation to Modelica 3.x and FMI 2.0/3.0 SSP XML containers.
- **P&ID Diagrams**: Automatic vector Piping & Instrumentation Diagram generation (AntV X6 & SVG).
