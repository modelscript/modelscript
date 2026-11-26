// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate
 * Continuous & discrete ODE/DAE simulation, SUNDIALS/CVODE integrators,
 * WebGPU acceleration, and numerical optimization engines for ModelScript.
 */

export * from "./analysis/bifurcation-palc.js";
export * from "./calibration/index.js";
export * from "./cfd/index.js";
export * from "./charts/index.js";
export * from "./control/cbf-clf-qp.js";
export * from "./control/direct-collocation.js";
export * from "./control/index.js";
export * from "./control/trajectory-opt.js";
export * from "./core/index.js";
export * from "./dsp/index.js";
export * from "./fea/index.js";
export * from "./fea/shaders/simp-fdtd-dose.wgsl.js";
export * from "./fea/topology-opt.js";
export * from "./fea/webgpu-advanced-runners.js";
export * from "./gpu/compute-backend.js";
export * from "./interop/domain-bridges.js";
export * from "./jit/index.js";
export * from "./meshing/index.js";
export * from "./optimizer/index.js";
export * from "./optimizer/solvers/game-equilibria.js";
export * from "./solvers/bio/bio-advanced.js";
export * from "./solvers/bio/systems-biology.js";
export * from "./solvers/des-engine.js";
export * from "./solvers/em/electromagnetics.js";
export * from "./solvers/index.js";
export * from "./solvers/medical/dose-transport.js";
export * from "./solvers/register-advanced-solvers.js";
export * from "./surrogates/index.js";
export * from "./surrogates/irka-mor.js";
export * from "./surrogates/system-mor.js";
export * from "./sysid/index.js";
export * from "./sysml2/index.js";
export * from "./twin/index.js";
export * from "./uq/advi-nuts.js";
export * from "./uq/hmc-smc.js";
export * from "./uq/index.js";
export * from "./utils/index.js";
export * from "./verification/index.js";
export * from "./wasm/simulate-wasm.js";
