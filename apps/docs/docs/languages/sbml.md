---
title: "SBML Systems Biology & Biochemical Kinetics (.sbml, .xml)"
description: "@modelscript/sbml provides streaming XML parsing, biochemical kinetics solving, RK4 ODE simulation, DAE lowering, and Modelica projection for SBML Level 2/3."
---

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
  - **Reactions**: Reversible and irreversible reaction fluxes ($v_j$) with stoichiometric coefficient matrices $N = [\nu_{ij}]$, representing the conversion of reactant species into products at rate $v_j$:
    $$\sum_{i} s_{ij} S_i \xrightarrow{v_j} \sum_{k} p_{kj} P_k$$

| Symbol           | Meaning                                                          | Units / Domain                                 |
| :--------------- | :--------------------------------------------------------------- | :--------------------------------------------- |
| $S_i, P_k$       | Reactant species $i$ and product species $k$                     | Species identifiers                            |
| $s_{ij}, p_{kj}$ | Reactant and product stoichiometric coefficients in reaction $j$ | Dimensionless ($\ge 0$)                        |
| $v_j$            | Reaction flux (rate) for reaction $j$                            | $\text{mol}/\text{s}$ (or $\text{M}/\text{s}$) |

### 2. Kinetic Law Formulations & ODE Solver

Evaluates dynamic reaction velocities across three standard biochemical rate laws:

- **Mass-Action Kinetics** models elementary reactions where the net rate equals the forward rate (proportional to reactant concentrations raised to their stoichiometric orders) minus the reverse rate:
  $$v = k_{\text{fwd}} \prod [R_i]^{s_i} - k_{\text{rev}} \prod [P_j]^{p_j}$$
- **Michaelis-Menten Enzymatic Saturation** models enzyme-catalyzed conversion that rises linearly at low substrate $[S]$ and saturates at $V_{\text{max}}$ when $[S] \gg K_m$:
  $$v = \frac{V_{\text{max}} [S]}{K_m + [S]}$$
- **Hill Cooperativity** generalizes Michaelis-Menten kinetics with a cooperativity exponent $n$ to capture sigmoidal switch-like binding responses:
  $$v = \frac{V_{\text{max}} [S]^n}{K_{0.5}^n + [S]^n}$$

Solves the resulting non-linear **ordinary differential equations (ODEs)**, which compute the rate of change of each species concentration by summing all net stoichiometric fluxes normalized by the enclosing compartment volume, using embedded 4th-order Runge-Kutta (RK4) integration or stiff SUNDIALS CVODE solvers:

$$\frac{d[S_i]}{dt} = \frac{1}{V_{\text{comp}}} \sum_{j=1}^{R} \nu_{ij} \cdot v_j([S], p)$$

| Symbol                           | Meaning                                                                           | Units / Domain                                                       |
| :------------------------------- | :-------------------------------------------------------------------------------- | :------------------------------------------------------------------- |
| $v, v_j([S], p)$                 | Reaction velocity (flux) as a function of concentrations $[S]$ and parameters $p$ | $\text{mol}/\text{s}$ (or $\text{M}/\text{s}$)                       |
| $k_{\text{fwd}}, k_{\text{rev}}$ | Forward and reverse mass-action rate constants                                    | Order-dependent ($\text{s}^{-1}, \text{M}^{-1}\text{s}^{-1}, \dots$) |
| $[R_i], [P_j], [S], [S_i]$       | Molar concentrations of reactants, products, substrate, and species $i$           | $\text{mol}/\text{L}$ ($\text{M}$, $\ge 0$)                          |
| $s_i, p_j$                       | Reactant and product reaction orders                                              | Dimensionless ($\ge 0$)                                              |
| $V_{\text{max}}$                 | Maximum enzymatic reaction velocity at saturation                                 | Matches $v$ units                                                    |
| $K_m, K_{0.5}$                   | Michaelis constant and half-maximal saturation concentration                      | $\text{mol}/\text{L}$ ($\text{M}$, $> 0$)                            |
| $n$                              | Hill cooperativity coefficient ($n > 1$ positive, $n < 1$ negative)               | Dimensionless                                                        |
| $t$                              | Simulation time                                                                   | $\text{s}$                                                           |
| $V_{\text{comp}}$                | Enclosing cellular compartment volume                                             | $\text{L}$ (or $\text{m}^3$, $> 0$)                                  |
| $R$                              | Total number of reactions in the network                                          | Integer ($\ge 1$)                                                    |
| $\nu_{ij}$                       | Net stoichiometric coefficient of species $i$ in reaction $j$ ($p_{ij} - s_{ij}$) | Dimensionless                                                        |

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

---

## Verification, Maturity & Benchmarks

<LanguageBenchmarks lang="sbml" />
