---
title: Antimony Systems Biology (.ant)
description: Compiler reference for Antimony modular systems biology models (.ant), submodel port aliasing, stoichiometric kinetics, hybrid events, DAEBuilder lowering, and SBML/Modelica projections.
---

# Antimony Modular Systems Biology (`.ant`)

`@modelscript/antimony` (`languages/antimony`) provides native WebAssembly GLR parsing, hierarchical submodel composition and port aliasing (`is`), rate and assignment rule evaluation, state-triggered event handling, 4th-order Runge-Kutta ODE integration, `DAEBuilder` lowering, and bidirectional SBML Level 3 / Modelica 3.x projection for **Antimony** human-readable systems biology models.

---

## Supported Extensions & Standards

| Extension | Format         | Description                                                                                                            |
| :-------- | :------------- | :--------------------------------------------------------------------------------------------------------------------- |
| `.ant`    | Antimony Model | Modular text language (`model ... end`) for biochemical reactions, compartments, species, events, and submodel imports |

---

## Governing Mathematical Formulation

### 1. Multi-Compartment Stoichiometric Balance & Boundary Species

Given $M$ dynamic floating species $\mathbf{S} = (S_1, \dots, S_M)^\top$ residing in compartments of volume $V_{\text{comp}(i)}$, $B$ fixed boundary species (`$S_b`, where $dS_b/dt = 0$), and $R$ biochemical reactions $J_r$ with net stoichiometry matrix $\mathbf{N} \in \mathbb{R}^{M \times R}$ ($\nu_{ir} = \nu_{ir}^+ - \nu_{ir}^-$) and kinetic rate laws $\mathbf{v}(\mathbf{S}, \mathbf{p}, t) \in \mathbb{R}^R$:

$$
\frac{d[S_i]}{dt} = \frac{1}{V_{\text{comp}(i)}} \sum_{r=1}^R \nu_{ir}\, v_r\bigl([\mathbf{S}], \mathbf{p}, t\bigr)
$$

Explicit rate rules (`x' = f(x, S, p)`), algebraic assignment rules (`y := g(x, S, p)`), and Hill / Michaelis-Menten regulatory kinetics combine with reaction fluxes into a coupled semi-explicit DAE system:

$$
\dot{\mathbf{x}} = \mathbf{f}(\mathbf{x}, \mathbf{y}, \mathbf{p}, t), \qquad \mathbf{y} = \mathbf{g}(\mathbf{x}, \mathbf{p}, t)
$$

### 2. Hybrid State-Event Zero-Crossing Semantics (`at (...)`)

An Antimony event `E_k: at (phi(x, t) > 0): x_i = h_i(x^-), p_j = c_j;` defines a zero-crossing guard predicate $\phi_k(\mathbf{x}, t)$ monitored during numerical integration. At the root time $t^*$ where $\phi_k(\mathbf{x}(t^{*-}), t^{*-}) = 0$ and $\dot{\phi}_k > 0$, discrete state and parameter reinitializations $\mathbf{x}(t^{*+}) = \mathbf{h}_k(\mathbf{x}(t^{*-}))$ are applied atomically.

---

## `DAEBuilder` Arena Lowering & Cross-Language Projections

- **Hierarchical Submodel Flattening & `is` Aliasing**: Submodel instances (`A: SubModel();`) and shared port/species alias declarations (`A.S1 is Cytosol_S1;`) are resolved into equivalence classes prior to emitting variables into `@modelscript/runtime`'s `DAEBuilder` arena (`lowerAntimonyToDae`).
- **Bidirectional SBML Level 3 Core Interop (`antimonyToSbml`)**: Translates compartments, species, reactions, rate/assignment rules, and events directly into [SBML](./sbml.md) Level 3 XML.
- **Modelica 3.x Projection (`antimonyToModelica`)**: Emits Modelica `model` blocks with `der(...)` equations and `when ... then reinit(...)` clauses.

---

## Pre-Flight Diagnostics

<LintRules lang="antimony" />

---

## CLI Usage

```bash
# Run pre-flight linting on an Antimony model
msx lint Repressilator.ant

# Parse and inspect Antimony model declarations
msx parse Repressilator.ant

# Inspect compartments, species, reactions, and submodels via msx domain
msx domain antimony inspect Repressilator.ant
```

---

## Programmatic TypeScript SDK

```typescript
import {
  antimonyToModelica,
  antimonyToSbml,
  lintAntimony,
  lowerAntimonyToDae,
  parseAntimony,
  solveAntimony,
} from "@modelscript/antimony";

const doc = parseAntimony(antimonySource);
const diagnostics = lintAntimony(doc);
const trajectory = solveAntimony(doc, { tEnd: 50, steps: 500 });
const dae = lowerAntimonyToDae(doc);
const sbmlXml = antimonyToSbml(doc);
const moCode = antimonyToModelica(doc);
```
