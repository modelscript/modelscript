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
  DOI: [10.1217856.1217859](https://doi.org/10.1217856.1217859)

### ModelScript Rationale & Modifications

Proves cross-domain assertions spanning discrete architectural modes, differential equations, interval constraints, and 3D CAD collisions.

- **Modifications**: Extended beyond traditional software theories (uninterpreted functions, bit-vectors) to **12 engineering domains** including OWL2 Description Logic, CAD B-Rep spatial physics, and DAE continuous trajectories; combines learned conflict clause propagation with Salsa query invalidation.

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
where $\text{vars}(I) \subseteq \text{vars}(A) \cap \text{vars}(B)$.

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
Computes real-valued **quantitative robustness** indicating how far a trajectory is from violating safety boundaries.

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
  - Powers `msc verify`, generates compliance certificates, and exports mathematical proofs in [`LaTeX format`](../reference/export-formats.md).
