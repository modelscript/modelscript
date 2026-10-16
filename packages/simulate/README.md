# `@modelscript/simulate`

ModelScript Numerical Simulation, Continuum Physics, Surrogate Modeling & Operational Digital Twin Engine — explicit and stiff implicit ODE/DAE integrators, SUNDIALS (`cvode`/`ida`) WASM solvers, WebGPU batched WGSL compute execution, hybrid adjoint sensitivity with saltation matrices, 3D continuum FEA & Lattice Boltzmann CFD solvers, reduced-order surrogate modeling, Monte Carlo / Sobol uncertainty quantification, and real-time state estimation.

---

## Architecture & Capabilities

### 1. Explicit & Implicit ODE / DAE Numerical Solvers (`@modelscript/simulate/solvers`, `src/core/`)

Operates directly on `@modelscript/runtime` linear-memory `DAEBuilder` arenas (`simulateArena`, `simulateArenaAsync`, `WasmSimulationRunner`):

- **Explicit Runge-Kutta Integrators**:
  - `euler`: Fixed-step forward Euler stepper.
  - `rk4`: Classical 4th-order Runge-Kutta integrator.
  - `dopri5`: Dormand-Prince 5(4) adaptive step-size integrator with dense 4th-order Hermite interpolation and zero-crossing event location.
  - `tsit5` (`src/solvers/tsit5.ts`): Tsitouras 5(4) adaptive Runge-Kutta method optimized for non-stiff continuous dynamics.
- **Stiff Implicit & Rosenbrock ODE / DAE Integrators**:
  - `trbdf2` (`src/solvers/trbdf2.ts`): L-stable Trapezoidal Rule / 2nd-Order Backward Differentiation Formula composite method with adaptive step control.
  - `rodas4p` (`src/solvers/rodas4p.ts`): 4th-order stiffly accurate Rosenbrock-Wanner method for stiff ODEs and index-1 DAEs without nonlinear Newton iteration.
  - `bdf`: Variable-order (1–5), variable-step Backward Differentiation Formula solver with sparse KLU/CSR Jacobian factorization (`src/solvers/sparse-solver-bridge.ts`).
  - **SUNDIALS WASM (`cvode` & `ida`, `src/solvers/sundials-wasm.ts`)**: WebAssembly-compiled Lawrence Livermore **SUNDIALS CVODE** (Adams-Moulton / BDF) and **IDA** (implicit differential-algebraic solver) with exact rootfinding.
- **Specialized Solvers (`src/solvers/`)**: Delay Differential Equations (`dde-solver.ts`), Stochastic Differential Equations (`sde-solver.ts`, Euler-Maruyama / Milstein), Two-Point Boundary Value Problems (`bvp-solver.ts`, collocation/shooting), and Nodal Admittance Power Systems EMT (`src/solvers/emt/`).

### 2. WebGPU Batched WGSL Compute Engine (`@modelscript/simulate/webgpu`)

- **Automated DAE-to-WGSL Compilation (`src/core/wgsl-codegen.ts`, `src/core/wgsl-cache.ts`)**: Compiles flattened arena equations directly into WebGPU Shading Language (`@compute @workgroup_size(64)`) shaders.
- **Massive Parallel Parameter Sweeps (`src/core/webgpu-simulation-runner.ts`, `src/core/vmap-arena.ts`)**: Executes tens of thousands of parameter trajectories concurrently on the GPU (`gpu-buffers.ts`, `webgpu-reduction.ts`) with automatic fallback to multi-threaded WASM SIMD workers.

### 3. Hybrid Adjoint Sensitivity & Differentiable Simulation (`src/core/`, `@modelscript/simulate/optimizer`)

- **Continuous & Hybrid Adjoint Solvers (`src/core/adjoint-integrator.ts`, `src/core/dae-adjoint-solver.ts`, `src/core/hybrid-adjoint.ts`)**:
  - Computes exact gradients $\nabla_{\theta} \mathcal{L}$ of trajectory loss functions with $O(1)$ memory cost scaling with respect to parameter count using cubic Hermite forward checkpointing (`dense-checkpoint-tape.ts`).
  - **Discontinuity Jump Conditions**: Evaluates exact **saltation matrices** across state-dependent `when` zero-crossings and hybrid mode switches so gradients remain mathematically exact across impacts and switching events.
  - **GPU & Autograd Bridges**: `webgpu-adjoint-runner.ts` for batched GPU adjoints and `torch-autograd-bridge.ts` for PyTorch integration.
- **Signal Temporal Logic (STL) Falsification (`src/core/stl_monitor.ts`, `src/core/falsification-runner.ts`)**: Quantitative STL robustness semantics ($\rho(\varphi, \mathbf{x}, t)$) coupled with L-BFGS-B / CMA-ES optimization (`src/optimizer/`) for automated counterexample falsification.

### 4. PDE Method-of-Lines & 3D Continuum Physics (`src/fea/`, `src/cfd/`, `@modelscript/simulate/meshing`)

- **3D Finite Element Analysis (`src/fea/`)**:
  - `FeaSolver` (`src/fea/fea-solver.ts`): Linear and thermo-elastic static/modal 3D FEA solver supporting 4-node linear (`Tet4Element`) and 10-node quadratic (`Tet10Element`) tetrahedral elements, CalculiX `.inp` loading (`inp-loader.ts`), and von Mises stress recovery.
- **3D WebGPU Lattice Boltzmann CFD (`src/cfd/`)**:
  - `WebGPULbmRunner` (`src/cfd/webgpu-lbm-runner.ts`) & `LBM_D3Q19_WGSL` (`src/cfd/shaders/lbm-d3q19.wgsl.ts`): Hardware-accelerated 3D **D3Q19** BGK/MRT Lattice Boltzmann fluid solver with `LbmVoxelizer` (`lbm-voxelizer.ts`), bounce-back obstacle boundaries, and aerodynamic drag/lift force integration.
- **STEP B-Rep Mesher & Boundary Layer Extruder (`src/meshing/`)**:
  - `step-mesher.ts`, `tet4-mesher.ts`, `boundary-layer-extruder.ts`, `patch-classifier.ts`, and `mesh-quality-analyzer.ts` (dihedral angle, aspect ratio, Jacobian quality metrics).
- **Multi-Physics FSI Coupling (`src/core/multiphysics-port-coupler.ts`, `src/core/fsi-relaxation.ts`, `src/core/continuum-participant.ts`)**: Couples 1D Modelica acausal ports with 3D FEA/CFD boundary patches.

### 5. Surrogate Modeling & Reduced-Order Models (`src/surrogates/`)

- **Training Architectures (`src/surrogates/rom-trainer.ts`, `src/surrogates/cfd-pod-surrogate.ts`, `src/surrogates/buckingham-pi.ts`)**:
  - Multi-Layer Perceptrons (**MLP**), **Polynomial Chaos Expansion (PCE)** / multivariate polynomials, **Radial Basis Functions (RBF)**, Proper Orthogonal Decomposition (**POD**) field surrogates, and dimensional **Buckingham $\Pi$** group synthesis.
  - **Out-of-Distribution Guardrails (`src/surrogates/multivariate-bounds.ts`)**: Convex-hull / Mahalanobis distance validity monitors.
- **Multi-Format Export & Import (`src/surrogates/modelica-surrogate-emitter.ts`, `src/surrogates/onnx-importer.ts`)**: Exports trained surrogates to **ONNX (`.onnx`)**, zero-dependency **ANSI C99**, and pure **Modelica `block` (`.mo`)** code; imports external `.onnx` graphs.

### 6. Uncertainty Quantification (`@modelscript/simulate/uq`) & Operational Digital Twin (`@modelscript/simulate/twin`, `src/calibration/`)

- **Monte Carlo & Sobol Sensitivity (`src/uq/monte-carlo.ts`, `src/uq/doe.ts`)**: Latin Hypercube Sampling (LHS), Sobol quasi-random sequences, Saltelli first-order ($S_i$) and total-effect ($S_{Ti}$) variance-based sensitivity indices, and ensemble quantile envelopes.
- **Operational Digital Twin Estimators (`src/twin/`, `src/calibration/`)**:
  - **Moving Horizon Estimator (`ArenaMHE`, `src/twin/arena-mhe.ts`)**: Constrained sliding-window state and parameter trajectory estimation over live telemetry buffers (`telemetry-buffer.js`).
  - **Unscented Kalman Filter (`UnscentedKalmanFilter`, `src/calibration/unscented_kalman_filter.ts`) & Virtual Sensor Fusion (`virtual_sensor_fusion.ts`)**: Nonlinear sigma-point state and unmeasured virtual sensor estimation.
  - **Bayesian MCMC Calibration (`BayesianCalibrator`, `src/calibration/bayesian_calibrator.ts`)**: Affine-invariant ensemble / Metropolis-Hastings posterior parameter inference.
  - **Drift Detection & RUL Prognostics (`src/twin/drift-detector.ts`, `src/twin/prognostics.ts`)**: Page-Hinkley / CUSUM parameter drift alarms and Remaining Useful Life (RUL) degradation horizon forecasting.

---

## Subpath Exports

| Subpath                           | Description                                                                                                       |
| :-------------------------------- | :---------------------------------------------------------------------------------------------------------------- |
| `@modelscript/simulate`           | Root barrel exporting all solvers, core runners, FEA, CFD, meshing, surrogates, UQ, calibration, and twin modules |
| `@modelscript/simulate/core`      | `simulateArena`, `WasmSimulationRunner`, hybrid adjoints, STL monitors, and FSI couplers                          |
| `@modelscript/simulate/solvers`   | `tsit5`, `trbdf2`, `rodas4p`, SUNDIALS `cvode`/`ida`, DDE, SDE, BVP, and EMT solvers                              |
| `@modelscript/simulate/webgpu`    | `WebGPUSimulationRunner` and batched WGSL compute shaders                                                         |
| `@modelscript/simulate/meshing`   | STEP B-Rep mesher, prism boundary layer extruder, and mesh quality analyzer                                       |
| `@modelscript/simulate/optimizer` | L-BFGS-B, Nelder-Mead, CMA-ES, NSGA-II multi-objective optimizer, and parameter sweepers                          |
| `@modelscript/simulate/uq`        | Monte Carlo runner, Sobol indices, and Design of Experiments (DoE)                                                |
| `@modelscript/simulate/twin`      | `ArenaMHE`, drift detector, RUL prognostics, and streaming telemetry ring buffers                                 |
| `@modelscript/simulate/jit`       | WebAssembly and JS JIT equation evaluator compilers                                                               |

---

## Scripts

```bash
# Build TypeScript package
npm run build --workspace=@modelscript/simulate

# Run numerical solver, adjoint, FEA/CFD, surrogate, UQ, and digital twin tests
npm run test --workspace=@modelscript/simulate

# Typecheck and lint
npm run typecheck --workspace=@modelscript/simulate
npm run lint --workspace=@modelscript/simulate
```
