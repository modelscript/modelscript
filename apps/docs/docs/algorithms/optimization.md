# Mathematical Optimization & Calibration Solvers

**Implementation**: [`packages/simulate/src/optimizer/solvers/`](https://github.com/modelscript/modelscript/tree/main/packages/simulate/src/optimizer/solvers/)

---

## 1. Limited-Memory BFGS with Bounds (L-BFGS-B)

### Academic Citations

- **Byrd, R. H., Lu, P., Nocedal, J., & Zhu, C. (1995)**. _"A limited memory algorithm for bound constrained optimization."_  
  **SIAM Journal on Scientific Computing**, 16(5), pp. 1190–1208. DOI: [10.1137/0916069](https://doi.org/10.1137/0916069)
- **Zhu, C., Byrd, R. H., Lu, P., & Nocedal, J. (1997)**. _"Algorithm 778: L-BFGS-B: Fortran subroutines for large-scale bound-constrained optimization."_  
  **ACM Transactions on Mathematical Software**, 23(4), pp. 550–560. DOI: [10.1145/279232.279236](https://doi.org/10.1145/279232.279236)

### ModelScript Rationale & Modifications

Solves large-scale bound-constrained non-linear minimization:
$$\min_{x \in \mathbb{R}^n} f(x) \quad \text{subject to } l \le x \le u$$
Crucial for parameter identification and direct collocation optimal control where thousands of discretized states and control bounds must be optimized.

- **Modifications**: Employs compact representation of the inverse Hessian approximation $H_k$ using history buffers $m \in [5, 20]$ in typed arrays; Cauchy point computation with piecewise linear path search; exact line search with strong Wolfe conditions.

---

## 2. Covariance Matrix Adaptation Evolution Strategy (CMA-ES)

### Academic Citations

- **Hansen, N., & Ostermeier, A. (2001)**. _"Completely derandomized self-adaptation in evolution strategies."_  
  **Evolutionary Computation**, 9(2), pp. 159–195. DOI: [10.1162/106365601750190398](https://doi.org/10.1162/106365601750190398)
- **Hansen, N. (2016)**. _"The CMA Evolution Strategy: A Tutorial."_  
  **arXiv preprint**: [arXiv:1604.00772](https://arxiv.org/abs/1604.00772).

### ModelScript Rationale & Modifications

Derivative-free black-box optimization on rugged, non-convex, non-separable objective functions (e.g. tuning PID controller gains over simulations with discontinuous switching events).

- **Modifications**: Tracks full covariance matrix $C \in \mathbb{R}^{n \times n}$ updates with rank-$\mu$ and rank-one update mechanisms; vectorized population sampling using WebAssembly-accelerated Cholesky decomposition; step-size control using cumulative path lengths (CSA).

---

## 3. Differential Evolution (DE)

### Academic Citations

- **Storn, R., & Price, K. (1997)**. _"Differential Evolution – A Simple and Efficient Heuristic for global Optimization over Continuous Spaces."_  
  **Journal of Global Optimization**, 11(4), pp. 341–359. DOI: [10.1023/A:1008202821328](https://doi.org/10.1023/A:1008202821328)

### ModelScript Rationale & Modifications

Stochastic population-based global search algorithm utilizing vector differences for directional perturbations. Highly effective for parameter estimation against experimental CSV test bench data.

- **Modifications**: Supports `rand/1/bin`, `best/1/bin`, and `current-to-best/1` mutation strategies with adaptive crossover probability ($CR$) and scaling factor ($F$).

---

## 4. Particle Swarm Optimization (PSO)

### Academic Citations

- **Kennedy, J., & Eberhart, R. (1995)**. _"Particle swarm optimization."_  
  **Proceedings of IEEE ICNN'95**, Vol. 4, pp. 1942–1948. DOI: [10.1109/ICNN.1995.488968](https://doi.org/10.1109/ICNN.1995.488968)
- **Shi, Y., & Eberhart, R. C. (1998)**. _"A modified particle swarm optimizer."_  
  **IEEE Congress on Evolutionary Computation**, pp. 69–73.

### ModelScript Rationale & Modifications

Simulates social swarm dynamics for continuous global search:
$$v_i(t+1) = w v_i(t) + c_1 r_1 (p_i - x_i) + c_2 r_2 (g - x_i)$$

- **Modifications**: Implements constriction factors and dynamically declining inertia weights $w(t)$ to transition smoothly from global exploration to local exploitation.

---

## 5. Non-Dominated Sorting Genetic Algorithm II (NSGA-II)

### Academic Citations

- **Deb, K., Pratap, A., Agarwal, S., & Meyarivan, T. (2002)**. _"A fast and elitist multiobjective genetic algorithm: NSGA-II."_  
  **IEEE Transactions on Evolutionary Computation**, 6(2), pp. 182–197. DOI: [10.1109/4235.996017](https://doi.org/10.1109/4235.996017)

### ModelScript Rationale & Modifications

Solves multi-objective engineering trade-offs (e.g. simultaneously minimizing electric vehicle energy consumption while maximizing battery longevity and top speed).

- **Modifications**: Fast non-dominated sorting ($\mathcal{O}(M N^2)$ complexity) paired with crowding-distance assignment in continuous parameter spaces; outputs full Pareto fronts directly.

---

## Upstream & Downstream Pipeline Connections

- **Upstream Inputs**:
  - Trajectory residuals evaluated by [`Simulation Solvers`](./solvers-ode-dae.md) against [`CSV Datasets`](../languages/csv.md).
  - Collocation constraint formulations from `msx optimize`.
- **Downstream Consumers**:
  - Powers `msx falsify` adversarial requirement falsification across SysML v2 / Modelica / CAD.
  - Powers `msx cosim optimize` for black-box multi-FMU tuning across SSP boundaries.
  - Powers `ModelicaCalibrator` with `hybrid-cmaes-lm` (CMA-ES global exploration + Levenberg-Marquardt quadratic polishing).
  - Powers `TradeStudyEngine.evolve` for generative multi-objective Pareto design trade studies.

---

## Programmatic TypeScript API

```typescript
import { cmaesSolve, deSolve, psoSolve, nsga2Solve, type BlackBoxProblem } from "@modelscript/simulate/optimizer";

// 1. Single-Objective Black-Box Optimization (CMA-ES, DE, PSO)
const problem: BlackBoxProblem = {
  dimension: 2,
  bounds: {
    min: new Float64Array([-5, -5]),
    max: new Float64Array([5, 5]),
  },
  fitness: (x) => Math.pow(1 - x[0]!, 2) + 100 * Math.pow(x[1]! - x[0]! * x[0]!, 2),
};

const result = await cmaesSolve(problem, { maxGenerations: 100 });
console.log("Optimum:", result.bestSolution, "Cost:", result.bestFitness);

// 2. Hybrid Global-Local Model Calibration
import { ModelicaCalibrator } from "@modelscript/simulate/optimizer";

const calibrator = new ModelicaCalibrator(arena, sim, {
  parameters: ["k", "c"],
  parameterBounds: new Map([
    ["k", { min: 1, max: 30 }],
    ["c", { min: 0.1, max: 10 }],
  ]),
  measurements,
  method: "hybrid-cmaes-lm", // Global CMA-ES basin exploration + Levenberg-Marquardt refinement
});
const calResult = calibrator.calibrate();
```

---

## CLI Command Examples

```bash
# 1. Adversarial requirement falsification with CMA-ES
msx falsify --formula "always[0,10] (stress <= 180)" --algorithm cma-es --population 20

# 2. Black-box co-simulation parameter tuning with Differential Evolution
msx cosim optimize ssp-archive.ssp --params "kp:0.1:10.0,kd:0.01:1.0" --objective "error_integral" --algorithm de
```
