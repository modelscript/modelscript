# Graph Rewriting, Pattern Matching & Metaprogramming

**Implementation**: [`packages/dsl/src/codegen/rewriting/`](https://github.com/modelscript/modelscript/tree/main/packages/dsl/src/codegen/rewriting/) and [`packages/dsl/src/codegen/runtime/`](https://github.com/modelscript/modelscript/tree/main/packages/dsl/src/codegen/runtime/)

---

## 1. Triple Graph Grammars (TGG) & Algebraic DPO Rewriting

### Academic Citations

- **Schürr, A. (1994)**. _"Specification of graph translators with triple graph grammars."_  
  **Graph-Theoretic Concepts in Computer Science (WG '94)**, LNCS 903, pp. 151–163.  
  DOI: [10.1007/3-540-59071-4_45](https://doi.org/10.1007/3-540-59071-4_45)
- **Greenyer, J., & Kindler, E. (2010)**. _"Comparing operational execution strategies for triple graph grammars."_  
  **Software & Systems Modeling**, 9(4), pp. 441–469.  
  DOI: [10.1007/s10270-009-0140-2](https://doi.org/10.1007/s10270-009-0140-2)

### ModelScript Rationale & Modifications

Synchronizes multi-domain engineering languages (e.g. Modelica 1D physics, SysML v2 requirements, STEP CAD geometry) declaratively without fragile point-to-point imperatively paired translators.

- **Modifications**: AOT-compiles declarative TGG rule sets into an in-WASM AssemblyScript dispatch kernel (`tgg_forward_dispatch`, `tgg_backward_dispatch`); tracks bidirectional correspondences in linear CST memory; achieves $\mathcal{O}(\Delta N)$ incremental propagation driven by Salsa invalidations.

---

## 2. Critical Pair Analysis (CPA)

### Academic Citations

- **Knuth, D. E., & Bendix, P. B. (1970)**. _"Simple word problems in universal algebras."_  
  **Computational Problems in Abstract Algebra**, pp. 263–297. Pergamon Press.
- **Ehrig, H., Ehrig, K., de Lara, J., Taentzer, G., Varró, D., & Varró, G. (2005)**. _"Termination and confluence of graph transformation systems."_  
  **Formal Methods in Software and Systems Modeling**, LNCS 3440, pp. 180–195. DOI: [10.1007/978-3-540-31847-7_11](https://doi.org/10.1007/978-3-540-31847-7_11)
- **Heckel, R., & Taentzer, G. (2020)**. _Graph Transformation for Software Engineers: Formal Foundation and Industrial Applications_.  
  **Springer**. DOI: [10.1007/978-3-030-43969-9](https://doi.org/10.1007/978-3-030-43969-9)

### ModelScript Rationale & Modifications

In polyglot workflows, multiple rules may compete to transform the same AST elements. CPA statically detects all critical pairs (conflicting rule overlaps, target collisions, and circular translation loops) at compile time.

- **Modifications**: Tailored for heterogeneous polyglot metamodels; emits structured diagnostics with source ranges and rule conflict identifiers directly to the LSP and CLI.

---

## 3. Worst-Case Optimal Joins (WCOJ / Leapfrog Triejoin)

### Academic Citations

- **Ngo, H. Q., Porat, E., Ré, C., & Rudra, A. (2012)**. _"Worst-case optimal join algorithms."_  
  **ACM PODS '12**, pp. 37–48. DOI: [10.1145/2213556.2213565](https://doi.org/10.1145/2213556.2213565)
- **Veldhuizen, T. L. (2014)**. _"Leapfrog Triejoin: A simple, worst-case optimal join algorithm."_  
  **ICDT '14**, pp. 96–106. DOI: [10.4230/LIPIcs.ICDT.2014.96](https://doi.org/10.4230/LIPIcs.ICDT.2014.96)
- **Atserias, A., Grohe, M., & Marx, D. (2008)**. _"Size bounds and query plans for relational joins."_  
  **IEEE FOCS '08**, pp. 739–748. (The AGM Bound)

### ModelScript Rationale & Modifications

Traditional binary relational joins suffer from exponential intermediate result explosions on cyclic subgraphs (e.g. triangle topologies between ports, connectors, and component definitions). WCOJ guarantees runtime strictly bounded by the Atserias-Grohe-Marx (AGM) bound, achieving $\mathcal{O}(N^{3/2})$ for triangle queries rather than $\mathcal{O}(N^2)$.

- **Modifications**: Formulates Leapfrog Triejoin iteration orders using descending vertex degree heuristics; emits execution plans directly into the AOT WebAssembly compilation engine.

---

## 4. Zero-GC E-Graphs & Equality Saturation

### Academic Citations

- **Nelson, G., & Oppen, D. C. (1980)**. _"Fast decision procedures based on congruence closure."_  
  **Journal of the ACM**, 27(2), pp. 356–364. DOI: [10.1145/322186.322198](https://doi.org/10.1145/322186.322198)
- **Tate, R., Stepp, M., Tatlock, Z., & Lerner, S. (2009)**. _"Equality saturation: A new approach to optimization."_  
  **ACM POPL '09**, pp. 264–276. DOI: [10.1145/1480881.1480915](https://doi.org/10.1145/1480881.1480915)
- **Willsey, M., et al. (2021)**. _"egg: Fast and extensible equality saturation."_  
  **ACM POPL '21**, pp. 1–29. DOI: [10.1145/3434304](https://doi.org/10.1145/3434304)

### ModelScript Rationale & Modifications

Avoids destructive phase-ordering in symbolic equation simplification. An E-Graph maintains exponential equivalence classes of mathematically equal expressions simultaneously, extracting the globally minimal expression before numerical simulation.

- **Modifications**: WebAssembly linear memory allocation with zero GC; 32-bit Union-Find with two-pass path compression; fixed power-of-two open-addressing hash table (`HASH_MASK = 65535`) for $\mathcal{O}(1)$ deduplication.

---

## 5. Graph-Structured Stack (GSS) GLR Parsing

### Academic Citations

- **Tomita, M. (1985)**. _Efficient Parsing for Natural Language: A Fast Generalized LR Algorithm_.  
  **Kluwer Academic Publishers**. DOI: [10.1007/978-1-4613-2621-2](https://doi.org/10.1007/978-1-4613-2621-2)
- **Scott, E., & Johnstone, A. (2006)**. _"Right Numerate Generalized LR Parsers."_  
  **ACM TOPLAS**, 28(4), pp. 577–618. DOI: [10.1145/1176894.1176896](https://doi.org/10.1145/1176894.1176896)
- **McPeak, S., & Necula, G. C. (2004)**. _"Elkhound: A fast, practical GLR parser generator."_  
  **Compiler Construction (CC 2004)**, LNCS 2985, pp. 73–88. DOI: [10.1007/978-3-540-24723-4_6](https://doi.org/10.1007/978-3-540-24723-4_6)

### ModelScript Rationale & Modifications

Handles ambiguous and non-deterministic engineering grammars (such as expression vs. component declaration ambiguities in Modelica and SysML v2) by splitting and merging parse paths via the GSS without backtracking.

- **Modifications**: Active stack heads reside in contiguous unmanaged buffers (`t_activeHeads`) with power-of-two hash probing for $\mathcal{O}(1)$ stack head merging in WebAssembly.

---

## Upstream & Downstream Pipeline Connections

- **Upstream Inputs**:
  - Raw source code parsed by the [`WASM GLR Parser`](../architecture/glr-parser.md).
  - Polyglot synchronization rules authored in `@modelscript/dsl`.
- **Downstream Consumers**:
  - Rewritten expressions feed directly into [`DAEBuilder`](../architecture/dae-arena.md).
  - TGG synchronizations feed bidirectional updates between SysML v2 and Modelica.
