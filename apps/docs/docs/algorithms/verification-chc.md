# Constrained Horn Clauses (Spacer), IC3/PDR & Certified Verification

**Implementation**:

- Spacer CHC & IC3/PDR: [`packages/runtime/src/formal/chc/`](https://github.com/modelscript/modelscript/tree/main/packages/runtime/src/formal/chc/) and [`packages/runtime/src/formal/ic3_engine.ts`](https://github.com/modelscript/modelscript/tree/main/packages/runtime/src/formal/ic3_engine.ts)
- Stochastic Martingale Barrier Certificates: `StochasticBarrierSynthesizer` in [`packages/runtime/src/analysis/wasm_stochastic_barrier.ts`](https://github.com/modelscript/modelscript/tree/main/packages/runtime/src/analysis/wasm_stochastic_barrier.ts)
- WebGPU Datalog / OWL 2 RL Saturation Reasoner: `WebGPUOntologyReasoner` & `BitsetGraph` in [`packages/runtime/src/gpu/webgpu_reasoner.ts`](https://github.com/modelscript/modelscript/tree/main/packages/runtime/src/gpu/webgpu_reasoner.ts)
- ISO 26262 / DO-178C Back-to-Back Equivalence Verification: `B2BEquivalenceVerifier` in [`packages/runtime/src/simulation/b2b_verifier.ts`](https://github.com/modelscript/modelscript/tree/main/packages/runtime/src/simulation/b2b_verifier.ts) and `UnifiedVerifier` in [`packages/runtime/src/simulation/unified_verifier.ts`](https://github.com/modelscript/modelscript/tree/main/packages/runtime/src/simulation/unified_verifier.ts)

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

## 3. Stochastic Barrier Certificates (`wasm_stochastic_barrier.ts`)

### Academic Citations

- **Prajna, S., Jadbabaie, A., & Pappas, G. J. (2007)**. _"A framework for worst-case and stochastic safety verification using barrier certificates."_  
  **IEEE Transactions on Automatic Control**, 52(8), pp. 1415–1428.  
  DOI: [10.1109/TAC.2007.902736](https://doi.org/10.1109/TAC.2007.902736)
- **Kushner, H. J. (1967)**. _Stochastic Stability and Control._  
  **Academic Press**.

### ModelScript Rationale & Modifications

For continuous-time stochastic differential equations (Itô diffusions) driven by standard Wiener processes $W_t$:
$$dx(t) = f(x) \, dt + \sigma(x) \, dW_t$$
deterministic trajectories do not exist, and safety verification requires bounding the tail probability that $x(t)$ ever enters an unsafe region $\mathcal{X}_u = \{ x \mid \|x\|_2 \ge r_u \}$.

`StochasticBarrierSynthesizer` (`packages/runtime/src/analysis/wasm_stochastic_barrier.ts`) synthesizes non-negative supermartingale barrier candidates $B(x) = x^T P x \ge 0$ using the **infinitesimal generator** $\mathcal{L}$ of the Itô process:
$$\mathcal{L} B(x) = \nabla B(x) \cdot f(x) + \frac{1}{2} \text{tr}\!\left(\sigma(x) \sigma(x)^T \nabla^2 B(x)\right) \le -c$$

- **Doob's Maximal Supermartingale Inequality**: Bounds the infinite-horizon and finite-horizon probability of unsafe set entry via:
  $$\mathbb{P}\!\left(\sup_{t \ge 0} \|x(t)\|_2 \ge r_u\right) \le \frac{B(x_0) + \frac{\text{tr}(\Sigma P)}{2 \alpha}}{\lambda_{\min}(P) r_u^2} \le \delta_{\text{risk}}$$
  where $\Sigma = \sigma(0)\sigma(0)^T$ is the diffusion noise covariance and $\alpha$ is the linearized drift decay rate.
- **Soundness & Rigor Reporting**: Emits structured `VerificationVerdict` diagnostics distinguishing fast linearized quadratic risk estimates from Sum-of-Squares (SOS) / LP certified supermartingales.

---

## 4. WebGPU Datalog / OWL 2 RL Saturation Reasoner (`webgpu_reasoner.ts`)

### Academic Citations

- **Motik, B., Patel-Schneider, P. F., & Parsia, B. (2012)**. _"OWL 2 Web Ontology Language: Profiles (Second Edition) — OWL 2 RL."_  
  **W3C Recommendation**. [https://www.w3.org/TR/owl2-profiles/](https://www.w3.org/TR/owl2-profiles/)
- **Warshall, S. (1962)**. _"A theorem on Boolean matrices."_  
  **Journal of the ACM**, 9(1), pp. 11–12. DOI: [10.1145/321105.321107](https://doi.org/10.1145/321105.321107)

### ModelScript Rationale & Modifications

Large-scale systems engineering ontologies (`languages/owl2/` and SysML v2 KerML specialization hierarchies) contain $10^5$ to $10^7$ ABox/TBox assertions. Evaluating transitive role closures (`subClassOf`, `partOf`, `satisfies`) and SHACL numeric property constraints sequentially on the CPU becomes a bottleneck during workspace-wide verification.

`WebGPUOntologyReasoner` (`packages/runtime/src/gpu/webgpu_reasoner.ts`) implements a massively parallel GPU relational join and saturation co-processor with a CPU SIMD bitset fallback:

- **Bit-Packed Adjacency Matrix (`BitsetGraph`)**: Encodes an $N \times N$ directed graph as a flat `Uint32Array` where each node row $u$ occupies $\lceil N / 32 \rceil$ 32-bit words, achieving $32\times$ memory compression and single-instruction bitwise row unions.
- **Parallel Logarithmic Doubling in WGSL (`TRANSITIVE_CLOSURE_WGSL`)**: Dispatches compute workgroups (`workgroups = ceil(N / 64)`) over ping-pong storage buffers (`bufIn`, `bufOut`) for $\lceil \log_2 N \rceil + 1$ doubling rounds, computing the full reflexive-transitive closure $R^*$ in $\mathcal{O}(\log N)$ GPU passes.
- **Parallel SHACL Constraint Kernel (`SHACL_VALIDATION_WGSL`)**: Validates `SHACLNumericConstraint` bounds (`minInclusive`, `maxInclusive`, `expectedClassId`) across strided `Float32Array` instance attribute tables and writes compact violation bitsets.

---

## 5. ISO 26262 / DO-178C Back-to-Back Equivalence Verification (`b2b_verifier.ts`, `v_cycle_verifier.ts`)

### Academic Citations

- **ISO 26262-6:2018 & ISO 26262-8:2018**. _Road vehicles — Functional safety — Part 6: Product development at the software level (Table 7: Back-to-back comparison test between model and code) & Part 8: Supporting processes (Clause 11: Confidence in the use of software tools, TCL1)._
- **RTCA DO-178C /DO-331 (2011)**. _Software Considerations in Airborne Systems and Equipment Certification — Model-Based Development and Verification Supplement._

### ModelScript Rationale & Modifications

Safety-critical automotive (ISO 26262 ASIL-D) and avionics (DO-178C DAL-A) standards require proving that generated embedded production code (zero-allocation C99 or standalone WASM FMU artifacts) is numerically and behaviorally equivalent to the high-level specification model (SysML v2 / Modelica).

`B2BEquivalenceVerifier` (`packages/runtime/src/simulation/b2b_verifier.ts`, orchestrated by `UnifiedVerifier` in `packages/runtime/src/simulation/unified_verifier.ts`) automates end-to-end **Model-in-the-Loop (MiL) vs. Software-in-the-Loop (SiL)** back-to-back verification:

1. **MiL Reference Trajectory Execution**: Simulates the high-level DAE arena (`simulateArenaAsync`) over $[t_{\text{start}}, t_{\text{stop}}]$ to obtain reference trajectories $y^{\text{MiL}}_j(t)$.
2. **Standalone C99 Code Generation & Cryptographic Hashing**: Invokes `generateStandaloneCSources` (`@modelscript/exchange/fmu`) to emit self-contained, zero-allocation C99 sources (`<Model>_standalone.h`, `<Model>_standalone.c`), computing a SHA-256 artifact digest (`cSourceHash`) for V-cycle traceability.
3. **Automated Test Harness & Native Compilation**: Synthesizes a deterministic C99 fixed-step RK4 test harness (`<Model>_b2b_harness.c`), compiles the binary via `gcc -O2 -Wall -Wextra -std=c99 -lm`, and streams CSV output trajectories $y^{\text{SiL}}_j(t_k)$.
4. **Bisimulation & Signal-Tolerance Equivalence Checking**: Aligns SiL samples against binary-searched linearly interpolated MiL trajectories and verifies the combined absolute/relative tolerance envelope across all $K$ time steps and $M$ output signals:
   $$\forall j \in \{1, \dots, M\}, \; \forall k \in \{1, \dots, K\}: \quad \left| y^{\text{MiL}}_j(t_k) - y^{\text{SiL}}_j(t_k) \right| \le \epsilon_{\text{abs}} + \epsilon_{\text{rel}} \left| y^{\text{MiL}}_j(t_k) \right|$$

---

## Upstream & Downstream Pipeline Connections

- **Upstream Inputs**:
  - State machine models and safety requirements from [`SysML v2`](../languages/sysml2.md).
  - Mode switching, discrete `when` / `if` clauses, and continuous/stochastic DAE arenas lowered from [`Modelica`](../languages/modelica.md).
  - OWL 2 TBox/ABox ontological triples from [`OWL2`](../languages/owl2.md).
- **Downstream Consumers**:
  - Verifies architectural safety contracts, stochastic risk bounds, and ISO 26262 MiL/SiL equivalence in `msx verify`.
  - Feeds theory lemmas and transitive subsumption closures into [`Nelson-Oppen Coordinator`](./theory-coordinator.md).
