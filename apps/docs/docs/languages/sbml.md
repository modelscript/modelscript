# SBML Systems Biology & Biochemical Kinetics (`.sbml`, `.xml`)

`@modelscript/sbml` (`languages/sbml`) provides zero-regex streaming XML parsing, biochemical reaction network kinetics solving, 4th-order Runge-Kutta ODE simulation, linear DAE lowering, and Modelica 3.x projection for **Systems Biology Markup Language (SBML Level 2 & 3 Core)** cellular, metabolic, and signaling network models.

---

## Supported Extensions & Standards

| Extension | Format            | Description                                                                               |
| :-------- | :---------------- | :---------------------------------------------------------------------------------------- |
| `.sbml`   | SBML Model File   | Standard biochemical XML schema encoding compartments, species, parameters, and reactions |
| `.xml`    | SBML XML Document | General XML format containing standard SBML Level 2/3 definitions                         |

---

## Key Capabilities

### 1. Biochemical Reaction Networks & Stoichiometry

- Parses hierarchical multi-compartment biochemical reaction networks:
  - **Compartments**: Cellular volumes (cytosol, mitochondria, extracellular space) with spatial dimensions (0D, 2D membrane, 3D volume).
  - **Species**: Chemical and protein concentrations or particle amounts ($[S_i] \ge 0$).
  - **Parameters**: Kinetic rate constants ($k_{\text{fwd}}, k_{\text{rev}}$), Michaelis constants ($K_m$), and Hill coefficients ($n$).
  - **Reactions**: Reversible and irreversible reaction fluxes ($v_j$) with stoichiometric coefficient matrices $N = [\nu_{ij}]$:
    $$\sum_{i} s_{ij} S_i \xrightarrow{v_j} \sum_{k} p_{kj} P_k$$

### 2. Kinetic Law Formulations & ODE Solver

- Evaluates dynamic reaction velocities across standard enzyme kinetics:
  - **Mass-Action Kinetics**:
    $$v = k_{\text{fwd}} \prod [R_i]^{s_i} - k_{\text{rev}} \prod [P_j]^{p_j}$$
  - **Michaelis-Menten Enzymatic Saturation**:
    $$v = \frac{V_{\text{max}} [S]}{K_m + [S]}$$
  - **Hill Cooperativity**:
    $$v = \frac{V_{\text{max}} [S]^n}{K_{0.5}^n + [S]^n}$$
- Solves the resulting non-linear **ordinary differential equations (ODEs)**:
  $$\frac{d[S_i]}{dt} = \frac{1}{V_{\text{comp}}} \sum_{j=1}^{R} \nu_{ij} \cdot v_j([S], p)$$
  using embedded 4th-order Runge-Kutta (RK4) integration or stiff SUNDIALS CVODE solvers.

### 3. Direct DAE Lowering

- Lowers reaction stoichiometric matrices and flux equations into `@modelscript/runtime`'s `DAEBuilder` linear memory arena.
- Enables co-simulation between cellular metabolic networks and pharmacokinetics / drug delivery fluid pipelines ([`@modelscript/aspen`](./aspen.md)).

### 4. Bidirectional Modelica 3.x Projection

- Projects SBML reaction systems into Modelica biochemical components and acausal substance substance-flow models.

---

## Pre-Flight Diagnostics

The SBML analyzer validates stoichiometric consistency, undefined references, and physical rate bounds:

<LintRules lang="sbml" />

---

## CLI Usage

```bash
# Inspect compartments, species, parameters, and reactions
msx sbml inspect GlycolyticPathway.sbml

# Run pre-flight linting and stoichiometric validation
msx sbml lint GlycolyticPathway.sbml

# Simulate biochemical reaction kinetics ODEs with RK4
msx sbml simulate GlycolyticPathway.sbml --duration=20.0

# Lower biochemical reaction network to ModelScript linear DAE arena
msx sbml to-dae GlycolyticPathway.sbml

# Project into Modelica 3.x biochemical network model
msx sbml to-modelica GlycolyticPathway.sbml -o GlycolysisModel.mo
```
