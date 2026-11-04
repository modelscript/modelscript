# gPROMS / PML Dynamic Process Modeling (`.gproms`, `.pml`)

`@modelscript/gproms` (`languages/gproms`) provides native WebAssembly GLR parsing, Method-of-Lines (MOL) spatial finite-difference discretization for distributed-parameter partial differential-algebraic equations (PDAEs), 4th-order Runge-Kutta dynamic simulation, `DAEBuilder` lowering, and Modelica 3.x projection for **gPROMS Process Modeling Language (PML)** chemical, pharmaceutical, and crystallization process models.

---

## Supported Extensions & Standards

| Extension | Format                    | Description                                                                                                                 |
| :-------- | :------------------------ | :-------------------------------------------------------------------------------------------------------------------------- |
| `.gproms` | gPROMS Model File         | Equation-oriented process model defining `PARAMETER`, `DISTRIBUTION_DOMAIN`, `VARIABLE`, `EQUATION`, and `PROCESS` entities |
| `.pml`    | Process Modeling Language | Modular PML entity and flowsheet specification                                                                              |

---

## Key Capabilities

### 1. Equation-Oriented & Distributed-Parameter Modeling (`PDAE`)

- Parses `MODEL` and `PROCESS` blocks including:
  - **`DISTRIBUTION_DOMAIN`**: Axial, radial, or particle-size spatial domains (e.g., `Axial AS [0 : L]`) for tubular reactors, packed adsorption columns, and crystallizers.
  - **`PARTIAL(u, z)` & `INTEGRAL`**: First- and second-order spatial derivatives $\frac{\partial C}{\partial z}$ and $\frac{\partial^2 C}{\partial z^2}$ alongside time derivatives `$C` ($\frac{dC}{dt}$).
  - **`BOUNDARY` & `EQUATION`**: Danckwerts inlet/outlet boundary conditions and non-linear reaction/mass-transfer equations.
  - **`ASSIGN`, `INITIAL`, & `SCHEDULE`**: Degrees-of-freedom specifications, initial conditions, and sequential operating procedures (`CONTINUE FOR`, `SWITCH`, `RESET`).

### 2. Method-of-Lines (MOL) Discretization & Dynamic Solver

- Automatically discretizes `DISTRIBUTION_DOMAIN` spatial grids into coupled ODE/DAE node equations using upwind and central finite-difference stencils.
- Integrates transient startup, changeover, and reaction trajectories and lowers the resulting equation system into `@modelscript/runtime`'s `DAEBuilder` linear memory arena.

### 3. Bidirectional Modelica 3.x Projection

- Projects gPROMS `MODEL` and `PROCESS` definitions into equation-based Modelica 3.x models (`gpromsToModelica`) with explicit `der(...)` equations and parameter bindings.

---

## Pre-Flight Diagnostics

<LintRules lang="gproms" />

---

## CLI Usage

```bash
# Run pre-flight linting on a gPROMS / PML model
msx lint TubularReactor.gproms

# Parse and inspect the CST / symbol table
msx parse TubularReactor.gproms

# Dispatch domain inspection or simulation via the polyglot router
msx domain gproms inspect TubularReactor.gproms
```
