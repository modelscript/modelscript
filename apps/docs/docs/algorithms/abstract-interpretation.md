---
title: "Abstract Interpretation, Polyhedral Domains & Continuous Reachability"
description: "Implementation:"
---

# Abstract Interpretation, Polyhedral Domains & Continuous Reachability

**Implementation**:

- Abstract Interpretation Domains: [`packages/runtime/src/formal/abstract_interpretation/`](https://github.com/modelscript/modelscript/tree/main/packages/runtime/src/formal/abstract_interpretation/)
- DDE Method-of-Steps Flowpipes: `DdeFlowpipeSolver` in [`packages/runtime/src/analysis/wasm_dde_flowpipe.ts`](https://github.com/modelscript/modelscript/tree/main/packages/runtime/src/analysis/wasm_dde_flowpipe.ts)
- Hamilton-Jacobi-Isaacs (HJI) Level-Set Solver: `HjiLevelSetSolver` in [`packages/runtime/src/analysis/wasm_hji_solver.ts`](https://github.com/modelscript/modelscript/tree/main/packages/runtime/src/analysis/wasm_hji_solver.ts)

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

Captures planar relational linear invariants between pairs of program variables:
$$a x_i + b x_j \le c \quad (a, b, c \in \mathbb{Q})$$
where:

- $x_i, x_j \in \mathbb{R}$ are scalar state or model variables,
- $a, b, c \in \mathbb{Q}$ are rational linear coefficients and the upper-bound constant.

This relational invariant is much more expressive than simple intervals or octagons, allowing ModelScript to prove physical conservation laws (e.g. $p_1 + p_2 = \text{const}$) without the exponential vertex-facet explosion of general convex polyhedra.

- **Modifications**: Planar Graham-scan convex hull algorithms in WebAssembly typed memory; relational projection routines optimized for physical parameter spaces.

---

## 3. Octagon Difference Bound Matrices (DBM) Domain

### Academic Citations

- **Miné, A. (2006)**. _"The octagon abstract domain."_  
  **Higher-Order and Symbolic Computation**, 19(1), pp. 31–100.  
  DOI: [10.1007/s10990-006-8609-1](https://doi.org/10.1007/s10990-006-8609-1)

### ModelScript Rationale & Modifications

Restricts linear relationships to difference-bound and sum-bound constraints between pairs of variables:
$$\pm x_i \pm x_j \le c$$
where $x_i, x_j \in \mathbb{R}$ are scalar program variables and $c \in \mathbb{R} \cup \{+\infty\}$ is a scalar upper bound.

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

## 5. Delay Differential Equation (DDE) Method-of-Steps Flowpipes (`wasm_dde_flowpipe.ts`)

### Academic Citations

- **Bellman, R., & Cooke, K. L. (1963)**. _Differential-Difference Equations._  
  **Academic Press**.
- **Zou, L., Fränzle, M., Xue, B., & Zhan, N. (2015)**. _"orda: An Ode and Dde Reachability Analysis Tool."_  
  **SETTA 2015**, LNCS 9409, pp. 109–123. DOI: [10.1007/978-3-319-25942-0_8](https://doi.org/10.1007/978-3-319-25942-0_8)

### ModelScript Rationale & Modifications

Physical transport delays, networked control loops, and Modelica `delay(x, tau)` operators yield infinite-dimensional Delay Differential Equations (DDEs), where the state rate of change depends on both the current state and a delayed state:
$$\dot{x}(t) = f\big(t, x(t), x(t - \tau)\big), \qquad x(t) \in \Phi(t) \text{ for } t \in [-\tau, 0]$$

| Symbol             | Meaning                                                 | Units / Domain                           |
| :----------------- | :------------------------------------------------------ | :--------------------------------------- |
| $t$                | Simulation time                                         | $\text{s}$                               |
| $x(t), \dot{x}(t)$ | System state vector and its time derivative at time $t$ | $\mathbb{R}^n, \; \mathbb{R}^n/\text{s}$ |
| $f(\cdot)$         | Continuous DAE/ODE vector field                         | $\mathbb{R}^n/\text{s}$                  |
| $\tau$             | Transport or communication time delay                   | $\text{s}$ ($\tau > 0$)                  |
| $\Phi(t)$          | Initial functional history enclosure on $[-\tau, 0]$    | Interval/zonotope in $\mathbb{R}^n$      |

`DdeFlowpipeSolver` (`packages/runtime/src/analysis/wasm_dde_flowpipe.ts`) implements **Method-of-Steps** reachability propagation across consecutive delay horizons $[0, \tau], [\tau, 2\tau], \dots$:

- **History Interval Buffering**: Maintains a timestamped ring buffer `historyMap` storing both nominal trajectories $\bar{x}(t)$ and interval/zonotope tube enclosures $\mathcal{X}(t) = [\underline{x}(t), \overline{x}(t)]$. For $t - \tau \le t_0$, queries evaluate the initial functional history enclosure $\Phi(t - \tau)$; for $t - \tau > t_0$, historical enclosures are interpolated from stored flowpipe steps.
- **Interval Picard Enclosure Step**: Advances the state tube across $[t_k, t_k + \Delta t]$ by combining current state bounds $\mathcal{X}(t_k)$ and delayed history bounds $\mathcal{X}(t_k - \tau)$ using interval arithmetic:
  $$\mathcal{X}(t_{k+1}) = \mathcal{X}(t_k) + \Delta t \cdot \square f\big(t_k, \mathcal{X}(t_k), \mathcal{X}(t_k - \tau)\big)$$

  | Symbol             | Meaning                                                  | Units / Domain                             |
  | :----------------- | :------------------------------------------------------- | :----------------------------------------- |
  | $\mathcal{X}(t_k)$ | Interval/zonotope state enclosure at discrete step $t_k$ | Subset of $\mathbb{R}^n$                   |
  | $\Delta t$         | Integration time step size                               | $\text{s}$ ($\Delta t > 0$)                |
  | $\square f$        | Natural interval extension of vector field $f$           | Interval vector in $\mathbb{R}^n/\text{s}$ |

- **Epistemic Soundness Tagging**: Explicitly tags the resulting `VerificationVerdict` with rigor metadata (`heuristic` vs. `certified`) so downstream safety monitors distinguish fast corner-sampled delay tube estimates from fully Taylor-enclosed flowpipes.

---

## 6. Hamilton-Jacobi-Isaacs (HJI) PDE Level-Set Reachability (`wasm_hji_solver.ts`)

### Academic Citations

- **Mitchell, I. M., Bayen, A. M., & Tomlin, C. J. (2005)**. _"A time-dependent Hamilton-Jacobi formulation of reachable sets for continuous dynamic games."_  
  **IEEE Transactions on Automatic Control**, 50(7), pp. 947–957.  
  DOI: [10.1109/TAC.2005.851439](https://doi.org/10.1109/TAC.2005.851439)
- **Jiang, G. S., & Shu, C. W. (2000)**. _"Weighted ENO schemes for Hamilton-Jacobi equations."_  
  **SIAM Journal on Scientific Computing**, 21(6), pp. 2126–2143.  
  DOI: [10.1137/S106482759732455X](https://doi.org/10.1137/S106482759732455X)

### ModelScript Rationale & Modifications

When verifying safety of nonlinear control systems under worst-case adversarial disturbances $d \in \mathcal{D}$ and control authority $u \in \mathcal{U}$, convex set-propagation (zonotopes) can suffer from wrapping effects. `HjiLevelSetSolver` (`packages/runtime/src/analysis/wasm_hji_solver.ts`) computes the exact **Backward Reachable Tube (BRT)** by solving the zero-sum differential game **Hamilton-Jacobi-Isaacs (HJI) PDE** viscosity solution on an Eulerian level-set grid:
$$\frac{\partial V}{\partial t} + \min \left\{ 0, \; \min_{u \in \mathcal{U}} \max_{d \in \mathcal{D}} \nabla V(x, t) \cdot f(x, u, d) \right\} = 0, \qquad V(x, 0) = \ell(x)$$

| Symbol           | Meaning                                                               | Units / Domain                         |
| :--------------- | :-------------------------------------------------------------------- | :------------------------------------- |
| $V(x, t)$        | Value function whose sub-zero set encodes the backward reachable tube | $\mathbb{R}$                           |
| $x, t$           | State vector and backward-time horizon variable                       | $\mathbb{R}^n, \; \text{s}$            |
| $u, \mathcal{U}$ | Safety control input and its admissible compact set                   | $\mathcal{U} \subset \mathbb{R}^{m_u}$ |
| $d, \mathcal{D}$ | Adversarial disturbance input and its admissible compact set          | $\mathcal{D} \subset \mathbb{R}^{m_d}$ |
| $\nabla V(x, t)$ | Spatial gradient of the value function with respect to $x$            | $\mathbb{R}^n$                         |
| $f(x, u, d)$     | Controlled system dynamics under disturbance                          | $\mathbb{R}^n/\text{s}$                |
| $\ell(x)$        | Terminal signed-distance target function ($\ell(x) \le 0$ is unsafe)  | $\mathbb{R}$                           |

The sub-zero level set $\mathcal{K}_{\text{unsafe}} = \{ x \mid \ell(x) \le 0 \}$ defines the target failure region and $\{ x \mid V(x, T) \le 0 \}$ captures all initial states from which the adversary $d$ can force the trajectory into $\mathcal{K}_{\text{unsafe}}$ within horizon $T$ despite optimal safety control $u$.

- **5th-Order WENO Upwind Spatial Reconstruction (`weno5Derivatives`)**: Approximates left and right spatial derivatives $(p^-, p^+)$ along each state axis using 3-stencil smoothness indicators ($s_1, s_2, s_3$) and nonlinear weights $a_k = \frac{\gamma_k}{(\epsilon + s_k)^2}$, eliminating spurious oscillations near non-smooth value-function kinks.
- **Lax-Friedrichs Numerical Hamiltonian**: Evaluates the saddle-point Hamiltonian $H(x, p) = \min_{u \in \mathcal{U}} \max_{d \in \mathcal{D}} p \cdot f(x, u, d)$ at central gradients $p = \frac{1}{2}(p^- + p^+)$ augmented by artificial viscosity dissipation to ensure numerical monotonicity:
  $$\hat{H}(x, p^-, p^+) = H\left(x, \frac{p^- + p^+}{2}\right) - \frac{1}{2} \sum_{i} \alpha_i (p_i^+ - p_i^-), \qquad \alpha_i = \max_{u, d} |f_i(x, u, d)|$$

  | Symbol                 | Meaning                                                                | Units / Domain               |
  | :--------------------- | :--------------------------------------------------------------------- | :--------------------------- |
  | $\hat{H}(x, p^-, p^+)$ | Monotone Lax-Friedrichs numerical Hamiltonian                          | $\mathbb{R}$                 |
  | $H(x, p)$              | Exact Isaacs saddle-point Hamiltonian $\min_u \max_d p \cdot f(x,u,d)$ | $\mathbb{R}$                 |
  | $p^-, p^+$             | Left- and right-biased WENO5 spatial derivative approximations         | $\mathbb{R}^n$               |
  | $\alpha_i$             | Local artificial dissipation coefficient along state axis $i$          | $\text{units}(x_i)/\text{s}$ |
  | $f_i(x, u, d)$         | $i$-th component of the system vector field                            | $\text{units}(x_i)/\text{s}$ |

- **Monotone BRT Accumulation**: Steps the level-set array backward in time with `nextV[idx] = Math.min(V[idx], V[idx] - dt * dVdt)` and reports the exact unsafe volume fraction across the state space.

---

## Upstream & Downstream Pipeline Connections

- **Upstream Inputs**:
  - Control-flow graphs, `delay(x, tau)` equations, and continuous vector fields from `ModelicaFlattener`.
  - Adversarial disturbance bounds $\mathcal{D}$ and safety level-set specifications $\ell(x) \le 0$ from SysML v2 verification cases.
- **Downstream Consumers**:
  - Feeds numeric intervals into [`HC4 Contractor`](./theory-coordinator.md) and [`Nelson-Oppen Coordinator`](./theory-coordinator.md).
  - Certifies backward reachable tubes and delay flowpipes in `UnifiedVerifier` (`msx verify`).
  - Eliminates out-of-bounds array access and division-by-zero compiler warnings at compile time.
