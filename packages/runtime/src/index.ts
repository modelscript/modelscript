// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime
 * High-performance WebAssembly data-oriented DAE arena, memoized Salsa queries,
 * structural analysis, numerical integrators, and symbolic solvers.
 */

export * from "./brownfield_alignment.js";
export * from "./config_client.js";
export * from "./ctrf_reporter.js";
export * from "./diff.js";
export * from "./indexeddb_snapshot.js";
export * from "./msl_ffi.js";
export * from "./oslc_gateway.js";
export * from "./parallel_reasoner.js";
export * from "./pipeline.js";
export * from "./polyglot-transformer.js";
export * from "./provenance.js";
export * from "./reqif.js";
export * from "./runtime.js";
export * from "./solvers_bridge.js";
export * from "./thread_hypergraph.js";
export * from "./thread_serializer.js";
export * from "./type_registry.js";
export * from "./vcycle_verifier.js";
export * from "./wasm_bdf.js";
export * from "./wasm_blt.js";
export * from "./wasm_cache_store.js";
export * from "./wasm_container.js";
export * from "./wasm_cosim.js";
export * from "./wasm_dae.js";
export * from "./wasm_dae_printer.js";
export * from "./wasm_doe.js";
export * from "./wasm_dopri5.js";
export * from "./wasm_egraph_simplifier.js";
export * from "./wasm_evaluator.js";
export * from "./wasm_fmu_subsystem.js";
export * from "./wasm_fold.js";
export * from "./wasm_fuml_engine.js";
export * from "./wasm_fused_kernel.js";
export * from "./wasm_gaussian.js";
export * from "./wasm_gpu_buffers.js";
export * from "./wasm_groebner.js";
export * from "./wasm_init.js";
export * from "./wasm_interval.js";
export * from "./wasm_isolation.js";
export * from "./wasm_memory_planner.js";
export * from "./wasm_minlp.js";
export * from "./wasm_monte_carlo.js";
export * from "./wasm_ontology.js";
export * from "./wasm_pantelides.js";
export * from "./wasm_query_engine.js";
export * from "./wasm_rtc_statemachine.js";
export * from "./wasm_sparse_jacobian.js";
export * from "./wasm_statement_executor.js";
export * from "./wasm_string_pool.js";
export * from "./wasm_tape.js";
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
} from "./wasm_verifier.js";
export * from "./wasm_workspace.js";
export {
  LanguageWorkspaceIndex,
  LanguageWorkspaceIndex as WasmWorkspaceIndex,
  LanguageWorkspaceIndex as WorkspaceIndex,
} from "./wasm_workspace.js";
export type CSTNode = any;
