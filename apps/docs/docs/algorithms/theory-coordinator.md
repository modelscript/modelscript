---
title: Nelson-Oppen Theory Combination & SMT Solvers
description: Academic foundations and ModelScript modifications for Nelson-Oppen DPLL(T) theory combination across 19 engineering and SMT oracles, CDCL SAT, Craig interpolation, HC4 contractors, STL robustness, and constrained zonotopes.
---

# Nelson-Oppen Theory Combination & SMT Solvers

**Implementation**: [`packages/runtime/src/formal/`](https://github.com/modelscript/modelscript/tree/main/packages/runtime/src/formal/)

---

## 1. Nelson-Oppen Cooperation & DPLL(T)

### Academic Citations

- **Nelson, G., & Oppen, D. C. (1979)**. _"Simplification by cooperating decision procedures."_  
  **ACM Transactions on Programming Languages and Systems (TOPLAS)**, 1(2), pp. 245–257.  
  DOI: [10.1145/357073.357079](https://doi.org/10.1145/357073.357079)
- **Nieuwenhuis, R., Oliveras, A., & Tinelli, C. (2006)**. _"Solving SAT and SAT Modulo Theories: From an abstract Davis--Putnam--Logemann--Loveland procedure to DPLL(T)."_  
  **Journal of the ACM**, 53(6), pp. 937–977.  
  DOI: [10.1145/1217856.1217859](https://doi.org/10.1145/1217856.1217859)

### ModelScript Rationale & Modifications

Proves cross-domain assertions spanning discrete architectural modes, differential equations, interval constraints, 3D CAD collisions, classical SMT theories (arrays, bit-vectors, strings), and industrial safety envelopes.

- **Modifications**: Combines classical SMT theories with specialized engineering domains across **19 domain theory oracles** (matching [Multi-Domain Theory Coordinator](../architecture/theory-coordinator.md)) over the canonical `TheoryDomain` union (`"ontology" | "constraint" | "abstract_domain" | "continuous_safety" | "dynamic_simulation" | "spatial_physics" | "algebraic" | "custom"`); integrates learned conflict clause propagation with Salsa query invalidation:

| #   | Theory Oracle               | `TheoryDomain`       | Primary Decision / Propagation Procedure                                                                                                           |
| :-- | :-------------------------- | :------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `OntologyTheoryOracle`      | `ontology`           | $\mathcal{SROIQ}(\mathcal{D})$ Tableau reasoning over OWL 2 axioms, class disjointness, and property domains                                       |
| 2   | `ConstraintTheoryOracle`    | `constraint`         | HC4 interval arithmetic and relational constraint propagation over SysML v2 requirements                                                           |
| 3   | `AbstractDomainOracle`      | `abstract_domain`    | Floyd-Warshall Difference Bound Matrix (DBM) closure over Zone ($x_i - x_j \le c$) and Octagon ($\pm x_i \pm x_j \le c$) domains                   |
| 4   | `SafetyTheoryOracle`        | `continuous_safety`  | Control Barrier Function (CBF) Lie-derivative positivity and Taylor-model flowpipe reachability                                                    |
| 5   | `SpatialPhysicsOracle`      | `spatial_physics`    | 3D CAD B-Rep minimum clearance distance, mass budget, and BVH interference checks                                                                  |
| 6   | `CaeContractOracle`         | `spatial_physics`    | FEA structural safety factor ($\sigma_{\text{vM}} \le \sigma_{\text{yield}} / \text{SF}$) and CFD aerodynamic/thermal envelope bounds              |
| 7   | `CausalizationTheoryOracle` | `constraint`         | Hopcroft-Karp maximum bipartite matching ($O(E\sqrt{V})$), Tarjan BLT decomposition, and Pantelides index reduction                                |
| 8   | `DimensionalTheoryOracle`   | `constraint`         | Gaussian elimination over the 7-base SI unit exponent matrix $[\text{m}, \text{kg}, \text{s}, \text{A}, \text{K}, \text{mol}, \text{cd}]$          |
| 9   | `EntailmentTheoryOracle`    | `constraint`         | Assume-Guarantee contract compatibility ($\bigwedge A_i \neq \bot$) and compositional refinement ($A_P \Rightarrow A_C \land G_C \Rightarrow G_P$) |
| 10  | `FlowAlgebraOracle`         | `constraint`         | Acausal connection graph conservation ($\sum i_k = 0$ for flow variables, $v_1 = \dots = v_n$ for potential variables)                             |
| 11  | `ToleranceStackOracle`      | `spatial_physics`    | STEP AP242 / ISO 23952 QIF GD&T 1D/3D tolerance chain stack-up via Worst-Case and Root-Sum-Square (RSS)                                            |
| 12  | `UqTheoryOracle`            | `dynamic_simulation` | Latin Hypercube Sampling (LHS), Polynomial Chaos Expansion (PCE) Sobol indices, and distribution-free conformal prediction bounds                  |
| 13  | `ArrayTheoryOracle`         | `custom`             | McCarthy extensional theory of arrays ($T_A$) with read-over-write (`ROW1`/`ROW2`), congruence closure, and UndoTrail backtracking                 |
| 14  | `BitVectorTheoryOracle`     | `custom`             | Arbitrary-width fixed-width bit-vector theory ($T_{BV}$) with exact `BigInt` intervals, known-bit masks, modular arithmetic, and bitwise ops       |
| 15  | `StringTheoryOracle`        | `custom`             | Theory of strings and word equations ($T_S$) with concatenation propagation, prefix/suffix/contains predicates, and length-interval coupling       |
| 16  | `PowerGridTheoryOracle`     | `constraint`         | AC power-flow bus voltage bounds, generator reactive limits, branch MVA loading, and IEEE 2800 / NERC PRC-029 LVRT/HVRT ride-through contracts     |
| 17  | `MarineMooringTheoryOracle` | `spatial_physics`    | DNV-OS-E301 and DNV-ST-0119 intact/damaged mooring line safety factors, tension limits, and drag-embedment anchor uplift criteria                  |
| 18  | `PressureVesselOracle`      | `spatial_physics`    | ASME BPVC Section VIII Div 1 cylindrical shell (UG-27), formed head (UG-32), and hydrostatic test (UG-99) mechanical integrity compliance          |
| 19  | `TelecomTheoryOracle`       | `constraint`         | Optical WDM GSNR, chromatic dispersion, Kerr non-linear launch power limits, and ITU-T G.8275.1 / 3GPP 5G TDD PTP/SyncE timing budgets             |

---

## 2. CDCL SAT Solver with VSIDS

### Academic Citations

- **Silva, J. P. M., & Sakallah, K. A. (1999)**. _"GRASP: A search algorithm for propositional satisfiability."_  
  **IEEE Transactions on Computers**, 48(5), pp. 506–521. DOI: [10.1109/12.769433](https://doi.org/10.1109/12.769433)
- **Moskewicz, M. W., et al. (2001)**. _"Chaff: Accelerating SAT design verification."_  
  **ACM/IEEE Design Automation Conference (DAC)**, pp. 530–535. DOI: [10.1145/378239.379017](https://doi.org/10.1145/378239.379017)

### ModelScript Rationale & Modifications

Solves propositional satisfiability for discrete mode selection, architectural state machines, and CDCL(T) theory case splitting.

- **Modifications**: Two-watched-literals data structure with contiguous integer arrays; Variable State Independent Decaying Sum (VSIDS) decision heuristic; 1-UIP (First Unique Implication Point) conflict analysis; Luby-sequence restart schedule.

---

## 3. Craig Interpolation

### Academic Citations

- **Craig, W. (1957)**. _"Linear reasoning. A new form of the Herbrand-Gentzen theorem."_  
  **Journal of Symbolic Logic**, 22(3), pp. 250–268. DOI: [10.2307/2963593](https://doi.org/10.2307/2963593)
- **McMillan, K. L. (2003)**. _"Interpolation and SAT-based model checking."_  
  **Computer Aided Verification (CAV 2003)**, LNCS 2725, pp. 1–13. DOI: [10.1007/978-3-540-45069-6_1](https://doi.org/10.1007/978-3-540-45069-6_1)
- **Pudlák, P. (1997)**. _"Lower bounds for resolution and cutting planes proofs and monotone computations."_  
  **Journal of Symbolic Logic**, 62(3), pp. 981–998. DOI: [10.2307/2275583](https://doi.org/10.2307/2275583)

### ModelScript Rationale & Modifications

Given unsatisfiable mutually contradictory formulas $A \land B \models \bot$, Craig interpolation synthesizes an interpolant $I$ such that:
$$A \implies I \quad \text{and} \quad I \land B \models \bot$$
where $\text{vars}(I) \subseteq \text{vars}(A) \cap \text{vars}(B)$. In plain terms, $I$ serves as a compact interface summary that is implied by $A$ yet remains contradictory with $B$, using only variables shared by both subsystems so proprietary internal equations stay hidden.

| Symbol | Meaning                                                                                                  | Units / Domain         |
| :----- | :------------------------------------------------------------------------------------------------------- | :--------------------- |
| $A, B$ | Mutually unsatisfiable logical formulas ($A \land B \models \bot$)                                       | Boolean / SMT formulas |
| $I$    | Craig interpolant over shared vocabulary ($\text{vars}(I) \subseteq \text{vars}(A) \cap \text{vars}(B)$) | Boolean / SMT formula  |
| $\bot$ | Logical falsehood (unsatisfiability / contradiction)                                                     | Boolean constant       |

- **Modifications**: Employs Pudlák-McMillan resolution graph traversal to generate certified interpolants explaining cross-domain requirement violations without revealing proprietary subsystem equations.

---

## 4. HC4 Constraint Contractor

### Academic Citations

- **Benhamou, F., Goualard, F., Granvilliers, L., & Puget, J. F. (1999)**. _"Revising Hull and Box Consistency."_  
  **International Conference on Logic Programming (ICLP'99)**, pp. 230–244.

### ModelScript Rationale & Modifications

Evaluates non-linear algebraic constraints over interval domains without discretization grids:

- **Modifications**: Two-phase HC4Revise operator: bottom-up forward evaluation of interval bounds followed by top-down backward narrowing; eliminates physically impossible state regions before numerical simulation.

---

## 5. Signal Temporal Logic (STL) Quantitative Monitor

### Academic Citations

- **Maler, O., & Nickovic, D. (2004)**. _"Monitoring Temporal Properties of Continuous Signals."_  
  **FORMATS/FTRTFT 2004**, LNCS 3253, pp. 152–166. DOI: [10.1007/978-3-540-30206-3_12](https://doi.org/10.1007/978-3-540-30206-3_12)
- **Donzé, A., & Maler, O. (2010)**. _"Robust Satisfaction of Temporal Logic over Real-Valued Signals."_  
  **FORMATS 2010**, LNCS 6246, pp. 92–106. DOI: [10.1007/978-3-642-15297-9_9](https://doi.org/10.1007/978-3-642-15297-9_9)

### ModelScript Rationale & Modifications

Monitors simulation trajectories against temporal specifications (e.g. "overshoot must remain below 5% for at least 2 seconds after step input"):
$$\rho(\varphi, s, t) \in \mathbb{R}$$
Computes real-valued **quantitative robustness** indicating how far a trajectory is from violating safety boundaries: positive values ($\rho > 0$) certify satisfaction with safety margin $|\rho|$, negative values ($\rho < 0$) quantify violation severity, and $\rho = 0$ marks the exact satisfaction threshold.

| Symbol                | Meaning                                                               | Units / Domain                          |
| :-------------------- | :-------------------------------------------------------------------- | :-------------------------------------- |
| $\rho(\varphi, s, t)$ | Quantitative robustness degree of $\varphi$ on signal $s$ at time $t$ | $\mathbb{R}$ (signal units)             |
| $\varphi$             | Signal Temporal Logic (STL) specification formula                     | STL formula                             |
| $s$                   | Continuous-time simulation trajectory (signal)                        | $\mathbb{R}_{\ge 0} \to \mathbb{R}^n$   |
| $t$                   | Evaluation timestamp along the trajectory                             | $\text{s}$ (time, $\mathbb{R}_{\ge 0}$) |

---

## 6. Constrained Zonotopes

### Academic Citations

- **Scott, J. K., Raimondo, D. M., et al. (2016)**. _"Constrained zonotopes: A new tool for set-based estimation and fault detection."_  
  **Automatica**, 69, pp. 126–136. DOI: [10.1016/j.automatica.2016.02.036](https://doi.org/10.1016/j.automatica.2016.02.036)

### ModelScript Rationale & Modifications

Set-based reachability analysis under bounded initial states and parameter uncertainty. Closed under linear transformations, Minkowski addition, and hyperplanar intersection without facet explosion.

- **Modifications**: Implemented as in-WASM linear algebraic routines utilizing singular value decomposition (SVD) for order reduction.

---

## Upstream & Downstream Pipeline Connections

- **Upstream Inputs**:
  - Requirements ingested from [`SysML v2`](../languages/sysml2.md).
  - Trajectories simulated by [`Numerical Solvers`](./solvers-ode-dae.md).
  - Spatial boundaries provided by [`STEP CAD`](../languages/step.md).
- **Downstream Consumers**:
  - Powers `msx verify`, generates compliance certificates, and exports mathematical proofs in [`LaTeX format`](../reference/export-formats.md).
