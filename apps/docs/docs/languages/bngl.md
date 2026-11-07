---
title: BioNetGen (BNGL) (.bngl)
description: Compiler reference for BioNetGen rule-based biochemical networks, site-graph isomorphism, automated ODE network expansion, DAEBuilder lowering, and SBML/Modelica projections.
---

# BioNetGen Rule-Based Biochemical Networks (`.bngl`)

`@modelscript/bngl` (`languages/bngl`) provides native WebAssembly GLR parsing, rule-based site-specific biochemical network expansion, observable pattern aggregation, 4th-order Runge-Kutta ODE integration, `DAEBuilder` lowering, and SBML / Modelica projections for **BioNetGen Language (BNGL)** multiprotein signaling, receptor oligomerization, and post-translational modification models.

---

## Supported Extensions & Standards

| Extension | Format          | Description                                                                                                                                        |
| :-------- | :-------------- | :------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.bngl`   | BioNetGen Model | Block-structured rule-based biochemical specification (`parameters`, `molecule types`, `seed species`, `observables`, `reaction rules`, `actions`) |

---

## Governing Mathematical Formulation

### 1. Site-Graph Rewriting & Combinatorial Network Generation

A receptor or scaffold protein with $M$ independent phosphorylation/binding sites generates $2^M$ or more distinct chemical micro-states. Instead of enumerating all micro-species manually, a BNGL reaction rule $R_r: \mathcal{P}_{\text{react}} \xrightarrow{k_r} \mathcal{P}_{\text{prod}}$ is a **typed site-graph rewrite rule** matching subgraph embeddings $\phi: \mathcal{P}_{\text{react}} \hookrightarrow G_s$ into reachable chemical species graphs $G_s \in \mathcal{S}$:

- **Internal State Transition**: `EGFR(Y1068~U) -> EGFR(Y1068~P) k_phos`
- **Reversible Site Binding (`!n`)**: `L(r) + EGFR(l) <-> L(r!1).EGFR(l!1) kp1, km1`
- **Wildcard Bonds**: `!+` (bound to any partner), `!?` (bound or unbound), and empty site (explicitly unbound).

### 2. Mass-Action ODE System & Observable Pattern Aggregation

Once iterative rule application reaches fixed-point closure (or `max_iter`) over $\mathcal{S} = \{S_1, \dots, S_N\}$ and elementary reactions $\mathcal{R} = \{1, \dots, R\}$, the concentration vector $\mathbf{x}(t) \in \mathbb{R}_{\ge 0}^N$ evolves according to stoichiometric mass-action kinetics with statistical symmetry multiplicities $\sigma_r$:

$$
\frac{dx_i}{dt} = \sum_{r=1}^R \nu_{ir}\, \sigma_r k_r \prod_{j=1}^N x_j^{\nu_{jr}^-}, \qquad \nu_{ir} = \nu_{ir}^+ - \nu_{ir}^-
$$

Each declared `Molecules` or `Species` observable $O_q(t)$ computes a weighted linear combination over all generated species $S_i$ matching pattern $\Pi_q$ with subgraph match multiplicity $w_{qi} = |\text{Emb}(\Pi_q, S_i)|$:

$$
O_q(t) = \sum_{i=1}^N w_{qi}\, x_i(t)
$$

---

## `DAEBuilder` Arena Lowering & Cross-Language Projections

- **Direct `DAEBuilder` Lowering (`lowerBnglToDae`)**: Kinetic rate parameters, expanded species state variables (`Variability.Continuous`), elementary reaction flux expressions, mass-balance ODEs (`der(x_i)`), and pattern observable equations (`O_q`) are emitted directly into `DAEBuilder`.
- **SBML Level 3 Export (`bnglToSbml`)**: Serializes the expanded species and reaction network into standards-compliant [SBML](./sbml.md) XML for downstream pathway tools.
- **Modelica 3.x Projection (`bnglToModelica`)**: Generates acausal Modelica biochemical models ready for multi-scale coupling with physiological [CellML](./cellml.md) or pharmacokinetic [NONMEM](./nmtran.md) models.

---

## Pre-Flight Diagnostics

<LintRules lang="bngl" />

---

## CLI Usage

```bash
# Validate molecule site states, bond indices, and reaction rate constants
msx lint EgfrSignaling.bngl

# Parse and inspect BioNetGen blocks
msx parse EgfrSignaling.bngl

# Run domain-specific BNGL inspection and simulation
msx domain bngl inspect EgfrSignaling.bngl
```

---

## Programmatic TypeScript SDK

```typescript
import { bnglToModelica, bnglToSbml, lintBngl, lowerBnglToDae, parseBngl, solveBngl } from "@modelscript/bngl";

const model = parseBngl(bnglText);
const diagnostics = lintBngl(model);
const sim = solveBngl(model, { tEnd: 100, dt: 0.5 });
const dae = lowerBnglToDae(model);
const sbmlXml = bnglToSbml(model);
const moCode = bnglToModelica(model);
```
