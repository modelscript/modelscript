# Numerical ODE, DAE & Co-Simulation Solvers

**Implementation**: [`packages/simulate/src/solvers/`](https://github.com/modelscript/modelscript/tree/main/packages/simulate/src/solvers/) and [`packages/runtime/src/solvers/`](https://github.com/modelscript/modelscript/tree/main/packages/runtime/src/solvers/)

---

## 1. Tsitouras 5(4) Adaptive Runge-Kutta (Tsit5)

### Academic Citations

- **Tsitouras, Ch. (2011)**. _"Runge-Kutta pairs of order 5 (4) satisfying only the first column simplifying assumption."_  
  **Computers & Mathematics with Applications**, 62(2), pp. 770–775.  
  DOI: [10.1016/j.camwa.2011.06.002](https://doi.org/10.1016/j.camwa.2011.06.002)
- **Rackauckas, C., & Nie, Q. (2017)**. _"DifferentialEquations.jl – A Performant and Feature-Rich Ecosystem for Solving Differential Equations in Julia."_  
  **Journal of Open Research Software**, 5(1), 15. DOI: [10.5334/jors.151](https://doi.org/10.5334/jors.151)

### ModelScript Rationale & Modifications

For non-stiff systems (e.g. mechanical multi-body dynamics, kinematics, flight control), high-order adaptive explicit Runge-Kutta pairs offer peak throughput without Newton-Raphson linear algebra costs. Tsit5 demonstrates significantly lower error coefficients and wider stability regions than classical Dormand-Prince (DOPRI5).

- **Modifications**: Employs the First-Same-As-Last (FSAL) optimization eliminating stage 1 evaluation in successive steps; embeds a 5th-order continuous dense output polynomial for sub-interval event zero-crossing localization.

---

## 2. TR-BDF2 Composite Stiff Solver

### Academic Citations

- **Bank, R. E., Coughran, W. M., et al. (1985)**. _"Transient simulation of silicon devices and circuits."_  
  **IEEE Transactions on CAD of Integrated Circuits**, 4(4), pp. 436–446.  
  DOI: [10.1109/TCAD.1985.1270142](https://doi.org/10.1109/TCAD.1985.1270142)
- **Hosea, M. E., & Shampine, L. F. (1996)**. _"Analysis and implementation of TR-BDF2."_  
  **Applied Numerical Mathematics**, 20(1-2), pp. 21–37.  
  DOI: [10.1016/0168-9274(95)00115-8](<https://doi.org/10.1016/0168-9274(95)00115-8>)

### ModelScript Rationale & Modifications

Cyber-physical models featuring frequent hybrid discrete events (switches, impacts, hysteresis) severely penalize multistep BDF solvers (which must drop to order 1 after every event). TR-BDF2 is an L-stable one-step composite method pairing a trapezoidal half-step with a BDF2 completion step:

- **Modifications**: Shares the diagonal Jacobian coefficient $d = 1 - 1/\sqrt{2}$ across both internal stages, requiring only **one** sparse LU factorization per time step; connects directly with ModelScript's in-WASM sparse matrix kernel (`sparse_lu.ts`).

---

## 3. RODAS-4P Linearly Implicit Rosenbrock Solver

### Academic Citations

- **Steinebach, G. (1995)**. _"Order-reduction of ROW-methods for DAEs and method of lines applications."_  
  **TH Darmstadt Preprint 1742**.
- **Hairer, E., & Wanner, G. (1996)**. _Solving Ordinary Differential Equations II: Stiff and Differential-Algebraic Problems_.  
  **Springer-Verlag**. Section IV.8.

### ModelScript Rationale & Modifications

Solves stiff index-1 DAEs and method-of-lines continuum discretizations without iterative non-linear Newton solves. It solves only a sequence of linear systems sharing the same system matrix $I - \gamma h J$.

- **Modifications**: Optimized for in-WASM sparse Jacobian caching; utilizes automatic differentiation coloring (`coloring.ts`) for fast Jacobian updates.

---

## 4. Itô Stochastic Differential Equations (SDE) Solver

### Academic Citations

- **Rößler, A. (2010)**. _"Runge-Kutta methods for Itô stochastic differential equations with additive noise."_  
  **SIAM Journal on Numerical Analysis**, 48(3), pp. 922–952. DOI: [10.1137/09076636X](https://doi.org/10.1137/09076636X)
- **Kloeden, P. E., & Platen, E. (1992)**. _Numerical Solution of Stochastic Differential Equations_.  
  **Springer**. DOI: [10.1007/978-3-662-12616-5](https://doi.org/10.1007/978-3-662-12616-5)

### ModelScript Rationale & Modifications

Physical systems operate under thermal noise, turbulence, and sensor fluctuations:
$$dx = f(t, x) \, dt + g(t, x) \, dW_t$$

- **Modifications**: Employs an in-WASM `Xoshiro256pp` PRNG with Box-Muller transformation; provides both fixed-step Euler-Maruyama (strong order 0.5) and adaptive Rößler SRIW1 (strong order 1.5) integrators for Monte Carlo uncertainty rollouts.

---

## 5. Co-Simulation Master Orchestrator

### Academic Citations

- **Bastian, J., et al. (2011)**. _"Master for Co-Simulation Using FMI."_  
  **Proceedings of the 8th International Modelica Conference**, pp. 115–120. DOI: [10.3384/ecp11063115](https://doi.org/10.3384/ecp11063115)
- **Kübler, R., & Schiehlen, W. (2000)**. _"Two methods of simulator coupling."_  
  **Mathematical and Computer Modelling of Dynamical Systems**, 6(2), pp. 93–113. DOI: [10.1076/1387-3954(200006)6:2;1-M;FT093](<https://doi.org/10.1076/1387-3954(200006)6:2;1-M;FT093>)

### ModelScript Rationale & Modifications

Coordinates multi-rate, multi-vendor FMI Functional Mock-up Units (FMUs) and SSP topologies. Implements Richardson extrapolation error estimation to dynamically adapt the inter-simulator communication step size $H_{\text{comm}}$, preventing divergence while maximizing simulation speed.

---

## Upstream & Downstream Pipeline Connections

- **Upstream Inputs**:
  - DAE blocks partitioned and torn by [`BltEngine`](./blt.md) and [`TornBlock`](./tearing.md).
  - Sparse Jacobians computed via [`Dual Numbers & Graph Coloring`](./surrogates-linear-algebra.md).
- **Downstream Consumers**:
  - Powers `msc simulate`, `msc optimize`, and the Web IDE charting canvas.
  - Feeds state trajectories into [`Signal Temporal Logic (STL) Monitor`](./theory-coordinator.md) and formal verification oracles.
