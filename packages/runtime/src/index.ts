// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime
 * High-performance WebAssembly data-oriented DAE arena, memoized Salsa queries,
 * structural analysis, numerical integrators, and symbolic solvers.
 */

export * from "./analysis/parametric_verifier.js";
export * from "./analysis/wasm_blt.js";
export * from "./analysis/wasm_egraph_simplifier.js";
export * from "./analysis/wasm_hybrid_flowpipe.js";
export * from "./analysis/wasm_interval.js";
export * from "./analysis/wasm_pantelides.js";
export * from "./analysis/wasm_taylor_model.js";
export * from "./autodiff/wasm_fused_kernel.js";
export * from "./autodiff/wasm_isolation.js";
export * from "./autodiff/wasm_tape.js";
export * from "./config/config_client.js";
export * from "./config/indexeddb_snapshot.js";
export * from "./dae/wasm_dae.js";
export * from "./dae/wasm_dae_printer.js";
export * from "./dae/wasm_evaluator.js";
export * from "./dae/wasm_fold.js";
export * from "./dae/wasm_init.js";
export * from "./dae/wasm_statement_executor.js";
export * from "./gpu/wasm_gpu_buffers.js";
export * from "./gpu/wasm_memory_planner.js";
export * from "./interop/brownfield_alignment.js";
export * from "./interop/oslc_gateway.js";
export * from "./interop/polyglot-transformer.js";
export * from "./interop/provenance.js";
export * from "./interop/reqif.js";
export * from "./interop/thread_hypergraph.js";
export * from "./interop/thread_serializer.js";
export * from "./interop/vcycle_verifier.js";
export * from "./ontology/parallel_reasoner.js";
export * from "./ontology/wasm_ontology.js";
export * from "./pipeline.js";
export * from "./runtime.js";
export * from "./simulation/wasm_cosim.js";
export * from "./simulation/wasm_doe.js";
export * from "./simulation/wasm_fmu_subsystem.js";
export * from "./simulation/wasm_monte_carlo.js";
export {
  VerificationRunner,
  VerifyOp,
  computeIntegral,
  computeOvershoot,
  computeSettlingTime,
  computeSteadyState,
  parseComparisonOp,
  verifyTrajectoryDirect,
  type ComparisonOp,
  type TrajectoryConstraint,
  type VerificationResult,
  type SimulationResult as VerifierSimulationResult,
} from "./simulation/wasm_verifier.js";
export * from "./solvers/solvers_bridge.js";
export * from "./solvers/wasm_bdf.js";
export * from "./solvers/wasm_dopri5.js";
export * from "./solvers/wasm_gaussian.js";
export * from "./solvers/wasm_groebner.js";
export * from "./solvers/wasm_minlp.js";
export * from "./solvers/wasm_qr.js";
export * from "./solvers/wasm_sparse_jacobian.js";
export * from "./statemachine/wasm_bmc_engine.js";
export * from "./statemachine/wasm_fuml_engine.js";
export * from "./statemachine/wasm_rtc_statemachine.js";
export * from "./util/ctrf_reporter.js";
export * from "./util/diff.js";
export * from "./util/msl_ffi.js";
export * from "./util/type_registry.js";
export * from "./workspace/wasm_cache_store.js";
export * from "./workspace/wasm_container.js";
export * from "./workspace/wasm_query_engine.js";
export * from "./workspace/wasm_string_pool.js";
export * from "./workspace/wasm_workspace.js";
export {
  LanguageWorkspaceIndex,
  LanguageWorkspaceIndex as WasmWorkspaceIndex,
  LanguageWorkspaceIndex as WorkspaceIndex,
} from "./workspace/wasm_workspace.js";
export type CSTNode = any;
