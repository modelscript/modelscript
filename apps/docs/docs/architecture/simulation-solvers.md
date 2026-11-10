---
title: "Simulation Solvers & Numerical Integrators"
description: "ModelScript embeds a multi-tier suite of numerical solvers in @modelscript/simulate to support both desktop simulations and massive batched cloud/WebGPU parameter sweeps."
---

# Simulation Solvers & Numerical Integrators

ModelScript embeds a multi-tier suite of numerical solvers in `@modelscript/simulate` to support both desktop simulations and massive batched cloud/WebGPU parameter sweeps.

---

## Supported Solvers

```mermaid
flowchart TD
    DAE["Flat DAE Representation"] --> ROUTE{"Problem Type"}

    ROUTE -->|Stiff / Non-Stiff ODE| SUNDIALS_CVODE["SUNDIALS CVODE (BDF & Adams-Moulton)"]
    ROUTE -->|Index-1 DAE| SUNDIALS_IDA["SUNDIALS IDA (Variable-order BDF)"]
    ROUTE -->|Stiff Rosenbrock / ESDIRK| STIFF_WASM["Rodas4P (4th-Order Rosenbrock) & TR-BDF2"]
    ROUTE -->|Browser / Lightweight| WASM_SOLVER["WASM Integrators (Tsit5, DOPRI5 & RK4)"]
    ROUTE -->|Batched / N-1 Grid Screening| WEBGPU["WebGPU Batched SIMD & Contingency Screener"]
    ROUTE -->|Equilibria & Fold/Hopf| BIFURCATION["PALC Continuation & Bifurcation"]
    ROUTE -->|Optimal Control| COLLOCATION["Direct Collocation (Interior Point)"]
    ROUTE -->|Real-Time ROM| SURROGATE["Surrogate Models (FNO / Neural ODE / GP)"]
```

---

## 1. SUNDIALS CVODE, IDA, Rodas4P, TR-BDF2 & Tsit5 Integrators

For high-precision industrial models, ModelScript integrates Lawrence Livermore National Laboratory's **SUNDIALS** suite compiled to WebAssembly alongside native stiff and non-stiff integrators:

- **CVODE**: Solves Initial Value Problems (IVPs) for stiff and non-stiff systems of ordinary differential equations (ODEs). Uses Variable-Order Variable-Step-size Adams-Moulton methods for non-stiff systems and Backward Differentiation Formulas (BDF) for stiff systems.
- **IDA**: Solves Initial Value Problems for systems of differential-algebraic equations (DAEs) of index up to 1:
  $$F(t, y, y') = 0$$
  Includes dense and sparse linear solvers with adaptive step-size control.
- **Rodas4P & TR-BDF2**: L-stable 4th-order Rosenbrock-Wanner (`rodas4p.ts`) and 2nd-order Trapezoidal-BDF2 (`trbdf2.ts`) integrators for stiff power-electronic, chemical kinetics, and thermal-hydraulic transients without nonlinear Newton convergence failures.
- **Tsit5 & DOPRI5**: 5th-order explicit Runge-Kutta pairs (`tsit5.ts`, `dopri5.ts`) with FSAL (First Same As Last) and dense cubic Hermite interpolation for fast non-stiff simulation.
- **PALC Bifurcation & Continuation (`msx bifurcation`)**: Pseudo-Arclength Continuation (`bifurcation.ts`) for tracing steady-state equilibrium curves and automatically detecting saddle-node (fold) and Hopf bifurcations (e.g., power grid voltage nose curves and nonlinear oscillators).

---

## 2. WebGPU Batched Parallel Solvers & N-1 Contingency Screener

When performing Monte Carlo uncertainty analysis, hyperparameter sweeps, or bulk power grid $N-1$ contingency screening, sequential simulation is a bottleneck.

ModelScript compiles linearized DAE blocks into WebGPU compute shaders (`@modelscript/simulate/gpu`):

- Runs thousands of parameter combinations and $N-1$ transmission outage contingencies (`contingency-screener.ts`) in parallel on GPU hardware.
- Scales efficiently across client GPUs in browsers and headless datacenter instances.
- Returns statistical distributions, mean trajectories, voltage/thermal violation severity indices, and variance envelopes directly.

---

## 3. Direct Collocation Optimal Control

ModelScript formulates dynamic optimization and optimal control problems directly from Modelica models:

$$\min_{u(t)} \int_0^T L(x(t), u(t), t) \, dt$$
$$\text{subject to } F(t, x, \dot{x}, u) = 0, \quad u_{\min} \le u(t) \le u_{\max}$$

- **Transcription**: Transcribes the continuous system into non-linear programming (NLP) problems using Radau or Lobatto collocation points.
- **Solvers**: Solves the resulting sparse NLP using interior-point optimization techniques.

---

## 4. Surrogate Reduced Order Models (ROM)

High-fidelity 3D simulations (such as CFD or FEA) are often too computationally expensive for real-time control loops or web deployment.

ModelScript's surrogate modeling pipeline (`msx surrogate`):

1. **Sampling**: Generates experimental design samples (Latin Hypercube, Sobol sequences).
2. **Execution**: Evaluates high-fidelity runs across parameter spaces.
3. **Training**: Trains compact surrogate models using:
   - Polynomial Chaos Expansion (PCE)
   - Gaussian Process Regression (Kriging)
   - Neural Ordinary Differential Equations (Neural ODEs)
4. **Embedding**: Exports the trained surrogate as a standardized FMI Functional Mock-up Unit (FMU) or standalone WebAssembly module.
