# SIMPACK Multibody Dynamics (`.spck`, `.sim`, `.mbs`)

ModelScript integrates native support for **SIMPACK** (Dassault Systèmes), the premier high-frequency vibration, kinematic, and spatial multibody dynamics (MBD) simulation system.

---

## Capabilities

- **Modern & Classic Ingestion**:
  - Ingests modern SIMPACK XML models (`.spck`) containing `<body/>`, `<marker/>`, and `<joint/>` tags.
  - Ingests classic ASCII keyword decks (`.sim`, `.mbs`) with `$BODY`, `$MARKER`, and `$JOINT` cards.
- **Grübler-Kutzbach Mobility Analysis**:
  - Calculates mechanism degrees of freedom ($M = 6n - \sum c_i$) in 3D spatial mechanisms.
  - Automatically identifies overconstrained kinematic loops ($M < 0$).
- **WebAssembly Kinematics Kernel**:
  - Zero-allocation AssemblyScript linear memory kernel (`kinematics.wasm`) evaluating 3D Euler/Cardan rotation matrices, Rodrigues rotation, and spatial joint constraint equations (revolute, spherical, prismatic, cylindrical, planar, universal).
  - High-throughput batched transformations and residual evaluations.
- **Closed Kinematic Chains**:
  - Evaluates cut-joint loop closure residual vectors for spatial mechanisms.
- **Direct DAE Lowering**:
  - Lowers 3D translational and rotational kinematic relations directly into `DAEBuilder` in linear WebAssembly memory.
- **FMI 2.0 / 3.0 Co-Simulation FMU Export**:
  - Packages complete multibody assemblies into standalone `.fmu` archives with `modelDescription.xml`, C co-simulation wrappers, and kinematic state telemetry.
- **Interactive 3D Viewport**:
  - WebGL/Three.js 3D visualization rendering rigid bodies, joint couplings, coordinate markers, and spring elements with orbit navigation.
- **Modelica Projection**:
  - Automatically translates SIMPACK mechanisms into standard `Modelica.Mechanics.MultiBody` components.

---

## CLI Usage

```bash
# Check structural references and joints
msx simpack lint mechanism.spck

# Analyze degrees of freedom and overconstrained loops
msx simpack mobility mechanism.spck

# Direct DAE simulation in WebAssembly arena with CSV trajectory export
msx simpack simulate suspension.spck --stop-time=5.0 --step=0.005 --out=results.csv

# Export mechanism as an FMI 2.0/3.0 Co-Simulation FMU
msx simpack to-fmu suspension.spck --out=Suspension.fmu

# Export mechanism to standard Modelica MultiBody
msx simpack to-modelica suspension.sim --out=Suspension.mo
```

---

## Benchmarks

- **Automotive Double-Wishbone Suspension** (`languages/simpack/testsuite/DoubleWishbone.spck`):
  - 5 moving bodies (lower control arm, upper control arm, wheel hub, tie rod, chassis mount), 12 markers, 5 spatial joints, and coilover spring-damper strut.
  - Mobility analysis verifies $M = 9$ spatial DOFs (6 free chassis DOFs, 1 vertical jounce DOF, 1 steering DOF, 1 wheel spin DOF).

---

## MCP Tools

AI agents interacting via the ModelScript MCP server have access to:

- `simpack_lint`: Checks marker references, parent bodies, and joint validity.
- `simpack_mobility`: Evaluates Grübler-Kutzbach spatial degrees of freedom and overconstraint status.

## Diagnostic Rules

<LintRules lang="simpack" />
