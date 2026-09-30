# Abstract Interpretation & Polyhedral Domains

**Implementation**: [`packages/runtime/src/formal/abstract_interpretation/`](https://github.com/modelscript/modelscript/tree/main/packages/runtime/src/formal/abstract_interpretation/)

---

## 1. Bourdoncle Weak Topological Ordering (WTO) Fixpoint Solver

### Academic Citations

- **Bourdoncle, F. (1993)**. _"Efficient chaotic iteration strategies with widenings."_  
  **Formal Methods in Programming and Their Applications**, LNCS 735, pp. 128–141. DOI: [10.1007/BFb0039704](https://doi.org/10.1007/BFb0039704)
- **Cousot, P., & Cousot, R. (1977)**. _"Abstract interpretation: A unified lattice model for static analysis of programs by construction or approximation of fixpoints."_  
  **ACM POPL'77**, pp. 238–252. DOI: [10.1145/512950.512973](https://doi.org/10.1145/512950.512973)

### ModelScript Rationale & Modifications

Computes sound abstract over-approximations of state variables across complex nested loops and recursion without simulating unbounded trajectories.

- **Modifications**: Implements Bourdoncle's recursive hierarchical WTO decomposition to identify minimal loop heads; accelerates convergence using delayed widening ($\nabla$) followed by monotonic narrowing ($\Delta$).

---

## 2. Two Variables Per Inequality (TVPI) Polyhedral Domain

### Academic Citations

- **Simon, A., King, A., & Howe, J. M. (2002)**. _"Two Variables per Inequality as an Abstract Domain."_  
  **LOPSTR 2002**, LNCS 2664, pp. 71–89. DOI: [10.1007/3-540-36388-2_7](https://doi.org/10.1007/3-540-36388-2_7)
- **Nelson, G. (1978)**. _"An $n^{O(\log n)}$ algorithm for the two-variable-per-inequality integer programming problem."_  
  **Technical Report**, Stanford University.

### ModelScript Rationale & Modifications

Captures planar relational linear invariants of the form:
$$a x_i + b x_j \le c \quad (a, b, c \in \mathbb{Q})$$
Much more expressive than simple intervals or octagons, allowing ModelScript to prove physical conservation laws (e.g. $p_1 + p_2 = \text{const}$) without the exponential vertex-facet explosion of general convex polyhedra.

- **Modifications**: Planar Graham-scan convex hull algorithms in WebAssembly typed memory; relational projection routines optimized for physical parameter spaces.

---

## 3. Octagon Difference Bound Matrices (DBM) Domain

### Academic Citations

- **Miné, A. (2006)**. _"The octagon abstract domain."_  
  **Higher-Order and Symbolic Computation**, 19(1), pp. 31–100.  
  DOI: [10.1007/s10990-006-8609-1](https://doi.org/10.1007/s10990-006-8609-1)

### ModelScript Rationale & Modifications

Restricts linear relationships to constraints of the form:
$$\pm x_i \pm x_j \le c$$
Achieves cubic time complexity $\mathcal{O}(n^3)$ via Floyd-Warshall shortest path algorithms over $2n \times 2n$ potential graphs.

- **Modifications**: Direct integration into the `@modelscript/dsl` type inference system and `AbstractDomainOracle` in the Nelson-Oppen coordinator.

---

## 4. Array Segment Partitioning

### Academic Citations

- **Cousot, P., Cousot, R., & Logozzo, F. (2011)**. _"A Parametric Segmentation Functor for Fully Automatic and Scalable Array Content Analysis."_  
  **ACM POPL'11**, pp. 505–518. DOI: [10.1145/1926385.1926444](https://doi.org/10.1145/1926385.1926444)

### ModelScript Rationale & Modifications

Verifies large array equations and indexed multi-dimensional components in Modelica without unrolling every array index into separate scalar variables. Partitions index sets into contiguous segments whose bounds and elements share uniform properties.

---

## Upstream & Downstream Pipeline Connections

- **Upstream Inputs**:
  - Control-flow graphs and equation sets from `ModelicaFlattener`.
- **Downstream Consumers**:
  - Feeds numeric intervals into [`HC4 Contractor`](./theory-coordinator.md) and [`Nelson-Oppen Coordinator`](./theory-coordinator.md).
  - Eliminates out-of-bounds array access and division-by-zero compiler warnings at compile time.
