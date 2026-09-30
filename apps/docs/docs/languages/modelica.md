# Modelica Language Support

ModelScript provides full-featured compiler, linter, and simulation capabilities for **Modelica 3.x** under `languages/modelica/`.

The implementation includes complete equation-based modeling, connector semantics, inheritance hierarchies, and rigorous conformance testing against the OpenModelica testsuite.

---

## Flattening Pipeline (`ModelicaFlattener`)

The compiler lowers hierarchical Modelica classes into a flat system of differential-algebraic equations (DAE).

### Backend Execution Modes

The flattener (`languages/modelica/src/flattener.ts`) supports four execution backends:

- `"hybrid"` _(default)_: High-performance mode coordinating the in-WASM AssemblyScript flattening kernel (`assembly/flattener.ts`) with the TypeScript Salsa query bridge.
- `"wasm"`: Fully in-WASM kernel execution operating exclusively within linear memory buffers.
- `"ts"`: Pure TypeScript fallback backend for debugging and detailed AST introspection.
- `"diff"`: Conformance verification mode that runs both the WASM kernel and TS reference flattener side-by-side to detect drift.

---

## Connector Balancing & Stream Semantics

ModelScript implements strict Modelica connection semantics:

- **Potential Variables** (non-flow): Equality equations generated across all connected pins:
  $$v_1 = v_2 = \cdots = v_n$$
- **Flow Variables** (e.g. current, flow rate): Conservation equations summing to zero:
  $$\sum_{i=1}^n i_k = 0$$
- **Stream Variables**: Upstream operator evaluation and mixing equations for fluid dynamics.

---

## Example Modelica Model

```modelica
model DC_Motor "Permanent magnet DC motor with mechanical inertia"
  // Parameters
  parameter Real R = 1.5 "Armature resistance (Ohm)";
  parameter Real L = 0.05 "Armature inductance (H)";
  parameter Real k = 0.02 "Torque and back-EMF constant";
  parameter Real J = 0.001 "Rotor inertia (kg.m^2)";
  parameter Real b = 0.0001 "Viscous friction coefficient";

  // State variables
  Real i(start = 0, fixed = true) "Armature current (A)";
  Real w(start = 0, fixed = true) "Angular velocity (rad/s)";
  Real phi(start = 0, fixed = true) "Rotor angle (rad)";

  // Inputs
  input Real u "Applied voltage (V)";
equation
  // Electrical equation
  L * der(i) + R * i = u - k * w;

  // Mechanical equation
  J * der(w) + b * w = k * i;

  // Kinematic relation
  der(phi) = w;
end DC_Motor;
```

---

## CLI Compilation & Flattening

Compile and flatten a Modelica class using `msc`:

```bash
# Flatten to canonical DAE equations
npx msc flatten DC_Motor motor.mo

# Simulate for 10 seconds and output CSV trajectory
npx msc simulate DC_Motor motor.mo --stop-time 10 --output trajectory.csv
```
