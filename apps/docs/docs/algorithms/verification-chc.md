# Constrained Horn Clauses (Spacer) & IC3/PDR

**Implementation**: [`packages/runtime/src/formal/chc/`](https://github.com/modelscript/modelscript/tree/main/packages/runtime/src/formal/chc/) and [`packages/runtime/src/formal/ic3_engine.ts`](https://github.com/modelscript/modelscript/tree/main/packages/runtime/src/formal/ic3_engine.ts)

---

## 1. Spacer CHC Engine (Generalized PDR)

### Academic Citations

- **Komuravelli, A., Gurfinkel, A., & Chaki, S. (2014)**. _"SMT-Based Model Checking for Recursive Programs."_  
  **Computer Aided Verification (CAV 2014)**, LNCS 8559, pp. 17–34.  
  DOI: [10.1007/978-3-319-08867-9_2](https://doi.org/10.1007/978-3-319-08867-9_2)
- **Hoder, K., & Bjørner, N. (2012)**. _"Generalized Property Directed Reachability."_  
  **Theory and Applications of Satisfiability Testing (SAT 2012)**, LNCS 7317, pp. 157–171.  
  DOI: [10.1007/978-3-642-31612-8_13](https://doi.org/10.1007/978-3-642-31612-8_13)

### ModelScript Rationale & Modifications

Constrained Horn Clauses (CHCs) represent systems of logical relations of the form:
$$\forall X. \; \phi(X) \land P_1(X) \land \dots \land P_k(X) \implies H(X)$$
Spacer solves CHCs by combining inductive generalization, Craig interpolation, and under-approximated reachability trees without bounding the unrolling depth. In ModelScript, Spacer verifies infinite-state state machine transitions and recursive cyber-physical control architectures.

- **Modifications**: Directly integrates with ModelScript's in-WASM CDCL SAT core and Craig interpolator; implements specialized heuristics for linear real arithmetic over cyber-physical invariants.

---

## 2. IC3 / Property Directed Reachability (PDR)

### Academic Citations

- **Bradley, A. R. (2011)**. _"SAT-based model checking without unrolling."_  
  **VMCAI 2011**, LNCS 6538, pp. 70–87.  
  DOI: [10.1007/978-3-642-18275-4_7](https://doi.org/10.1007/978-3-642-18275-4_7)
- **Een, N., Mishchenko, A., & Brayton, R. (2011)**. _"Efficient implementation of property directed reachability."_  
  **Formal Methods in Computer-Aided Design (FMCAD 2011)**, pp. 125–134.

### ModelScript Rationale & Modifications

Proves whether safety property $P$ holds across all reachable states of a discrete or hybrid transition system without unrolling the transition relation $T(s, s')$ to a fixed horizon $k$.

- **Modifications**: Maintains inductive clause frames $F_0, F_1, \dots, F_k$ where $F_i$ over-approximates states reachable in up to $i$ steps; uses counterexample-guided abstraction refinement (CEGAR) to block Proof Obligations (POBs); propagates clauses forward to find an inductive invariant ($F_i \equiv F_{i+1}$) proving unbounded safety.

---

## Upstream & Downstream Pipeline Connections

- **Upstream Inputs**:
  - State machine models from [`SysML v2`](../languages/sysml2.md).
  - Mode switching and discrete `when` / `if` clauses lowered from [`Modelica`](../languages/modelica.md).
- **Downstream Consumers**:
  - Verifies architectural safety contracts in `msx verify`.
  - Feeds lemmas into [`Nelson-Oppen Coordinator`](./theory-coordinator.md).
