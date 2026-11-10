---
title: "gPROMS / PML-Compatible Dynamic Process Modeling (.gproms, .pml)"
description: "Native WebAssembly GLR parsing, Method-of-Lines (MOL) spatial finite-difference discretization for distributed-parameter PDAEs, dynamic simulation, DAEBuilder lowering, and Modelica 3.x projection for gPROMS / PML-compatible models."
---

# gPROMS / PML-Compatible Dynamic Process Modeling (`.gproms`, `.pml`)

`@modelscript/gproms` (`languages/gproms`) provides native WebAssembly GLR parsing, Method-of-Lines (MOL) spatial finite-difference discretization for distributed-parameter partial differential-algebraic equations (PDAEs), 4th-order Runge-Kutta dynamic simulation, `DAEBuilder` lowering, and Modelica 3.x projection for **gPROMS / PML-compatible** chemical, pharmaceutical, and crystallization process models.

---

## Supported Extensions & Standards

| Extension | Format                    | Description                                                                                                                 |
| :-------- | :------------------------ | :-------------------------------------------------------------------------------------------------------------------------- |
| `.gproms` | gPROMS Model File         | Equation-oriented process model defining `PARAMETER`, `DISTRIBUTION_DOMAIN`, `VARIABLE`, `EQUATION`, and `PROCESS` entities |
| `.pml`    | Process Modeling Language | Modular PML entity and flowsheet specification                                                                              |

---

## Key Capabilities

### 1. Equation-Oriented & Distributed-Parameter Modeling (`PDAE`)

`@modelscript/gproms` parses hierarchical `VARIABLE_TYPE`, `MODEL`, and `PROCESS` entities:

- **`DISTRIBUTION_DOMAIN`**: Axial, radial, or crystal-size spatial domains (e.g., `Axial AS [0 : L]`) for tubular plug-flow reactors (PFR), pressure-swing adsorption (PSA) beds, and population-balance crystallizers.
- **`PARTIAL(u, z)` & `INTEGRAL`**: First- and second-order spatial derivatives $\frac{\partial u}{\partial z}$ and $\frac{\partial^2 u}{\partial z^2}$ alongside time derivatives `$u` ($\frac{\partial u}{\partial t}$):
  $$\frac{\partial C_i}{\partial t} = -v_z \frac{\partial C_i}{\partial z} + D_{\text{ax}} \frac{\partial^2 C_i}{\partial z^2} + \sum_r \nu_{i,r} R_r(\mathbf{C}, T)$$
- **`BOUNDARY` & `EQUATION`**: Danckwerts inlet/outlet boundary conditions ($v_z C_{i,\text{in}} = v_z C_i(0^+) - D_{\text{ax}} \frac{\partial C_i}{\partial z}\big|_{0^+}$) and coupled algebraic thermodynamic equilibrium relations.
- **`ASSIGN`, `INITIAL`, & `SCHEDULE`**: Structural degrees-of-freedom specifications, differential initial conditions, and sequential operating procedures (`CONTINUE FOR`, `SWITCH`, `RESET`, `PARALLEL`).

### 2. Method-of-Lines (MOL) Discretization & Dynamic Solver

For every distributed variable $u(z, t)$ defined over a `DISTRIBUTION_DOMAIN` $[z_0, z_N]$ with $N$ uniform grid intervals $\Delta z = (z_N - z_0)/N$, `@modelscript/gproms` discretizes spatial operators into node-indexed ODE/DAE equations:

$$\left.\frac{\partial u}{\partial z}\right|_{z_k} \approx \frac{u_k - u_{k-1}}{\Delta z} \quad (\text{1st-order upwind}), \qquad \left.\frac{\partial^2 u}{\partial z^2}\right|_{z_k} \approx \frac{u_{k+1} - 2u_k + u_{k-1}}{\Delta z^2} \quad (\text{2nd-order central})$$

This transforms the PDAE system into a semi-discrete index-1 DAE system over node variables $u_0(t), \dots, u_N(t)$, which is integrated in time and lowered directly into `@modelscript/runtime`'s `DAEBuilder` linear memory arena.

### 3. Bidirectional Modelica 3.x Projection

- Projects gPROMS `MODEL` and `PROCESS` definitions into equation-based **Modelica 3.x** models (`gpromsToModelica`) with explicit `der(...)` equations, discretized array variables, and `initial equation` blocks.

---

## Pre-Flight Diagnostics

<LintRules lang="gproms" />

---

## CLI Usage

```bash
# Run pre-flight linting on a gPROMS / PML model (structural DOF, boundaries, domains)
msx lint TubularReactor.gproms

# Parse and inspect the CST / symbol table
msx parse TubularReactor.gproms

# Dispatch domain inspection or Method-of-Lines simulation via the polyglot router
msx domain gproms inspect TubularReactor.gproms
```

---

## Programmatic TypeScript SDK

```typescript
import { parseGpromsModel, simulateGpromsProcess, lowerGpromsToDae, gpromsToModelica } from "@modelscript/gproms";
import { DAEBuilder } from "@modelscript/runtime";

const model = parseGpromsModel(gpromsSource);
const sim = simulateGpromsProcess(model, { steps: 200 });

const builder = new DAEBuilder();
lowerGpromsToDae(model, builder);
const modelicaCode = gpromsToModelica(model);
```

---

## Trademarks & Disclaimers

gPROMS is a registered trademark of Process Systems Enterprise Limited (Siemens Process Systems Enterprise). Reference to gPROMS and PML is strictly for nominative identification of model file format compatibility. ModelScript is an independent open-core project not affiliated with or endorsed by Siemens Process Systems Enterprise.
