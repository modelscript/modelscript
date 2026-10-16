<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/runtime

Core runtime engine, linear-memory WebAssembly DAE arena, Salsa incremental query engine, structural analysis kernels, 12-oracle Nelson-Oppen theory coordinator, and formal verification framework for ModelScript.

---

## 1. `DAEBuilder` & Linear-Memory SoA Arena

The ModelScript compiler and simulation runtime operate on a zero-allocation **Struct-of-Arrays (SoA)** data-oriented architecture in WebAssembly linear memory (`src/dae/wasm_dae.ts`, `assembly/`):

- **Direct CST-to-Arena Lowering**: Equations, expressions, and algorithm statements are lowered directly from linear parser CST pointers into `DAEBuilder` integer handles (`VarId`, `ExprId`, `EqId`, `StmtId`) with zero intermediate TypeScript AST wrapper allocations.
- **SoA Tables**:
  - `varData`: Variable metadata (name string pool ID, type, variability, causality, start value, alias/eliminated flags).
  - `exprData`: Contiguous expression arena (`kind`, `data1`, `left`, `right`) supporting SIMD/WASM traversal.
  - `eqData`: Equation arena (`kind`, `lhs`, `rhs`, `flags`) for continuous, initial, `when`, and `connect` equations.
- **Evaluation, Printing & Autodiff**:
  - `ArenaDAEPrinter` (`wasm_dae_printer.ts`): Reconstructs canonical flattened Modelica output directly from arena tables.
  - `wasm_evaluator.ts`, `wasm_init.ts`, `wasm_statement_executor.ts`: In-arena expression evaluation, DAE initialization, and imperative algorithm execution.
  - `wasm_tape.ts`, `wasm_isolation.ts`, `wasm_fused_kernel.ts`: Reverse/forward automatic differentiation tape and fused SIMD residual/Jacobian kernels.

---

## 2. Salsa `QueryEngine` & `WorkspaceIndex`

Located under `src/workspace/`, incremental compilation and multi-file semantic resolution are powered by a demand-driven Salsa query engine:

- **`WorkspaceIndex` (`wasm_workspace.ts`)**: Aggregates per-file `SymbolIndex` tables across multi-file workspaces, resolving cross-file `within` hierarchies, `package.mo` / `package.order`, and polyglot imports.
- **`QueryEngine` (`wasm_query_engine.ts`, `wasm_cache_store.ts`)**: Implements the Salsa `fetch → deep_verify → execute → backdate` memoization algorithm. Semantic queries (`instantiate`, `classInstance`, `resolveSimpleName`, `variability`, `causality`, `effectiveModification`) are cached with fine-grained dependency tracking and invalidated only when upstream symbols change.
- **`WasmStringPool` & `WasmContainer` (`wasm_string_pool.ts`, `wasm_container.ts`)**: Interned string pooling and linear-memory hash tables for zero-copy symbol lookups.

---

## 3. Structural Analysis & Symbolic Simplification

Located under `src/analysis/` and `src/dae/`:

- **Constant Folding & Alias Elimination (`wasm_fold.ts`)**: `foldArenaConstants` and `eliminateArenaAliases` simplify trivial equalities ($x = y$, $x = -y$, $x = c$) before structural partitioning.
- **Pantelides Index Reduction (`wasm_pantelides.ts`)**: Detects high-index DAEs (index > 1) via bipartite matching and symbolically differentiates constraint equations to reduce the system to index-1 ODE/DAE form.
- **Tarjan Block Lower Triangular (BLT) & Tearing (`wasm_blt.ts`)**: Computes maximum transversal variable-equation assignments, partitions equations into causal topological blocks using Tarjan's strongly connected components (SCC) algorithm, and applies tearing to minimize nonlinear algebraic loop dimensions.
- **E-Graph Equality Saturation (`wasm_egraph_simplifier.ts`)**: Algebraic term rewriting and canonical expression simplification.

---

## 4. 12-Oracle Nelson-Oppen `SemanticTheoryCoordinator`

Located at `src/formal/theory_coordinator.ts` and `src/formal/oracles/`, cross-domain verification is orchestrated by a generalized **Nelson-Oppen multi-solver** that exchanges shared variable equalities (`SharedEquality`), tightened numeric intervals, congruence closures, and learned conflict clauses (`ConflictClause`) across **12 domain theory oracles**:

| Oracle                                              | Domain               | Responsibility                                                                                                                        |
| --------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `OntologyTheoryOracle`                              | `ontology`           | Tableau Description Logic (DL) reasoner, OWL 2 bundle closure, concept subsumption, and scoped disjointness                           |
| `ConstraintTheoryOracle`                            | `constraint`         | Non-linear interval contraction via HC4 contractor, DPLL(T) arithmetic solver, and bound propagation                                  |
| `AbstractDomainOracle`                              | `abstract_domain`    | Octagon Difference Bound Matrices (DBM), 4D spatio-temporal intervals, and relational numerical bounds                                |
| `ContinuousSafetyOracle` / `SafetyTheoryOracle`     | `continuous_safety`  | Reachability flowpipes, SOS barrier certificates, Fault Tree Analysis (FTA), Minimal Cut Sets (MCS), and ISO 26262 PMHF/SPFM metrics  |
| `DynamicSimulationOracle`                           | `dynamic_simulation` | DAE numerical trajectory integration, Signal Temporal Logic (STL) quantitative robustness, and tolerance monitoring                   |
| `SpatialPhysicsOracle`                              | `spatial_physics`    | Watertight B-Rep CAD solid queries, collision/clearance verification, mass properties, and 3D FEA/CFD field coupling                  |
| `CaeContractOracle`                                 | `spatial_physics`    | FEA von Mises stress/deflection and CFD aerodynamic ($C_d$, $L/D$) contract verification synced with the Digital Thread hypergraph    |
| `CausalizationOracle` (`CausalizationTheoryOracle`) | `constraint`         | Pantelides Index-1 structural non-singularity, algebraic loop solvability, and Nyquist-Shannon sampling stability                     |
| `DimensionalOracle` (`DimensionalTheoryOracle`)     | `constraint`         | ISO 80000 7-element rational exponent vector (`[L, M, T, I, Θ, N, J]`) dimensional homogeneity checking                               |
| `EntailmentOracle` (`EntailmentTheoryOracle`)       | `constraint`         | V-Model requirements decomposition completeness proving ($\bigwedge R_{\text{child},i} \models R_{\text{parent}}$) with signed proofs |
| `FlowAlgebraOracle` (`FlowAlgebraTheoryOracle`)     | `constraint`         | SysML v2 / KerML conjugated port involution (`~Port`), Kirchhoff conservative flow balance, and 1D–3D CFD boundary flux integrals     |
| `ToleranceStackOracle` & `UqOracle`                 | `spatial_physics`    | STEP AP242 GD&T 1D/3D tolerance stack-up (Worst-Case, RSS, Six-Sigma $C_{pk}$) and stochastic Uncertainty Quantification (CDF / MC)   |

---

## 5. Formal Verification & Reachability Engines

`@modelscript/runtime` provides a comprehensive suite of symbolic, reachability, and compliance verification engines under `src/formal/`, `src/analysis/`, `src/statemachine/`, and `src/simulation/`:

- **SAT, SMT & Constrained Horn Clauses (CHC)**:
  - **CDCL & DPLL(T) (`cdcl_sat.ts`, `dpll_t_solver.ts`, `nlsat_solver.ts`, `hc4_contractor.ts`)**: Conflict-Driven Clause Learning SAT solver, lazy SMT theory integration, non-linear cylindrical algebraic cell projection, and HC4 revise/contract propagation.
  - **CHC, IC3/PDR & Interpolation (`chc/`, `ic3_engine.ts`, `wasm_pdr_engine.ts`, `wasm_bmc_engine.ts`, `inductive_prover.ts`, `craig_interpolator.ts`)**: Property-Directed Reachability (IC3/PDR), Bounded Model Checking (BMC), $k$-induction, and Craig interpolation for invariant synthesis.
  - **Decision Region Decomposition (`region_decomposer.ts`)**: Symbolic state-space partitioning and 100% MC/DC boundary test generation.
- **Continuous, Hybrid & Delay Reachability**:
  - **Taylor Models (`wasm_taylor_model.ts`, `taylor_domain.ts`)**: High-order polynomial Taylor model arithmetic with interval remainder integration for non-linear ODEs/DAEs.
  - **Zonotopes & Constrained Zonotopes (`wasm_zonotope.ts`, `wasm_zonotope_reach.ts`, `wasm_constrained_zonotope.ts`)**: Girard generator reduction and hyperplane-constrained zonotope reachability sets.
  - **Star Sets (`wasm_star_set.ts`)**: Symbolic star sets for neural-network-in-the-loop and piecewise-affine controller verification.
  - **Hamilton-Jacobi-Isaacs (HJI) PDE Solver (`wasm_hji_solver.ts`)**: Upwind level-set viscosity solution of HJI PDEs for adversarial zero-sum differential games and backward reachable tubes.
  - **DAE, Hybrid & DDE Flowpipes (`wasm_dae_flowpipe.ts`, `wasm_hybrid_flowpipe.ts`, `wasm_dde_flowpipe.ts`)**: Index-1 DAE flowpipe propagation, guard intersection for hybrid automata, and Method-of-Steps Delay Differential Equation (DDE) flowpipes.
  - **Barrier Certificates & Abstract Interpretation (`wasm_sos_barrier.ts`, `wasm_stochastic_barrier.ts`, `octagon_dbm.ts`, `tvpi_domain.ts`)**: Sum-of-Squares (SOS) and supermartingale stochastic barrier synthesis, Octagon DBM, and Two-Variables-Per-Inequality (TVPI) abstract domains.
- **State Machine Execution & Verification**:
  - **fUML & Run-to-Completion Engines (`wasm_fuml_engine.ts`, `wasm_rtc_statemachine.ts`)**: Foundational UML (fUML) token activity execution and deterministic Run-to-Completion (RTC) hierarchical state-machine semantics.
- **Safety Certification, Equivalence & Proof Auditing**:
  - **`B2BVerifier` (`b2b_verifier.ts`)**: ISO 26262 Part 6 / DO-178C Back-to-Back (MiL DAE vs. SiL generated C99) numerical equivalence verifier with SHA-256 source fingerprinting.
  - **`ProofManifestGenerator` (`proof_manifest.ts`)**: Emits cryptographically signed `DigitalThreadProofManifest` certificates, CTRF (`ctrf_reporter.ts`), and SARIF (`sarif_reporter.ts`) compliance artifacts.

---

## Scripts

| Command             | Description                                                       |
| ------------------- | ----------------------------------------------------------------- |
| `npm run build`     | Compile AssemblyScript kernels (`npm run asbuild`) and TypeScript |
| `npm run asbuild`   | Build WebAssembly kernels via `scripts/build-as.js`               |
| `npm run test`      | Run unit and formal verification test suites                      |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                             |
| `npm run typecheck` | Run TypeScript type checking (`tsc --noEmit`)                     |
| `npm run clean`     | Remove `dist/` and `build/` artifacts                             |

---

## Naming Conventions

Internal WebAssembly modules, numerical solver bindings, and linear-memory data structures use `snake_case` (e.g., `wasm_dae.ts`, `wasm_qr.ts`, `wasm_blt.ts`, `octagon_dbm.ts`, `sparse_cholesky.ts`) to:

1. Mirror native low-level AssemblyScript, C, Rust, and WebAssembly memory layout conventions.
2. Maintain stable, backwards-compatible public npm subpath exports specified in `package.json` (such as `@modelscript/runtime/wasm_dae.js`, `@modelscript/runtime/wasm_blt.js`, etc.).

All other services, utilities, and components across ModelScript follow standard repository `kebab-case.ts` and `PascalCase.tsx`.
