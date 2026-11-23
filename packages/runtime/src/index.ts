// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime
 * High-performance WebAssembly data-oriented DAE arena, memoized Salsa queries,
 * structural analysis, numerical integrators, and symbolic solvers.
 */

export * from "./analysis/identifiability.js";
export * from "./analysis/lgg09_and_nn_reach.js";
export * from "./analysis/linear_tearing_and_dummy_der.js";
export * from "./analysis/monomial_basis.js";
export * from "./analysis/octagon_dbm.js";
export * from "./analysis/outward_rounding.js";
export * from "./analysis/parametric_verifier.js";
export * from "./analysis/polynomial_zonotope.js";
export * from "./analysis/register-runtime-solvers.js";
export * from "./analysis/static-domain-lints.js";
export * from "./analysis/stl_robustness.js";
export * from "./analysis/wasm_blt.js";
export * from "./analysis/wasm_constrained_zonotope.js";
export * from "./analysis/wasm_dae_flowpipe.js";
export * from "./analysis/wasm_dde_flowpipe.js";
export * from "./analysis/wasm_decomposed_reach.js";
export * from "./analysis/wasm_egraph_simplifier.js";
export * from "./analysis/wasm_hji_solver.js";
export * from "./analysis/wasm_hybrid_flowpipe.js";
export * from "./analysis/wasm_interval.js";
export * from "./analysis/wasm_kernels_bridge.js";
export * from "./analysis/wasm_pantelides.js";
export * from "./analysis/wasm_pbox.js";
export * from "./analysis/wasm_polynomial_abstraction.js";
export * from "./analysis/wasm_sbg.js";
export * from "./analysis/wasm_sos_barrier.js";
export * from "./analysis/wasm_star_set.js";
export * from "./analysis/wasm_stochastic_barrier.js";
export * from "./analysis/wasm_taylor_model.js";
export * from "./analysis/wasm_zonotope.js";
export * from "./analysis/wasm_zonotope_reach.js";
export * from "./autodiff/sparse_hessian_coloring.js";
export * from "./autodiff/wasm-adjoint-synthesizer.js";
export * from "./autodiff/wasm-cfg.js";
export * from "./autodiff/wasm_event_relaxer.js";
export * from "./autodiff/wasm_fused_kernel.js";
export * from "./autodiff/wasm_isolation.js";
export * from "./autodiff/wasm_tape.js";
export * from "./config/config_client.js";
export * from "./config/indexeddb_snapshot.js";
export * from "./dae/arena_runtime_state.js";
export * from "./dae/facets/index.js";
export * from "./dae/fluent/index.js";
export * from "./dae/polyglot_inliner.js";
export * from "./dae/problem_types.js";
export * from "./dae/wasm_dae.js";
export * from "./dae/wasm_dae_printer.js";
export * from "./dae/wasm_evaluator.js";
export * from "./dae/wasm_fold.js";
export * from "./dae/wasm_init.js";
export * from "./dae/wasm_neural_block.js";
export * from "./dae/wasm_statement_executor.js";
export * from "./dae/wasm_table.js";
export * from "./formal/abstract_interpretation/array_segment_domain.js";
export * from "./formal/abstract_interpretation/interval_domain.js";
export * from "./formal/abstract_interpretation/reduced_product.js";
export * from "./formal/abstract_interpretation/tvpi_domain.js";
export * from "./formal/candidate_filter.js";
export * from "./formal/causal/factor_graph.js";
export * from "./formal/causal/scm_engine.js";
export * from "./formal/cdcl_sat.js";
export * from "./formal/chc/index.js";
export * from "./formal/craig_interpolator.js";
export * from "./formal/dae/hybrid_mode_verifier.js";
export * from "./formal/dae/pbox_arena.js";
export * from "./formal/dpll_t_solver.js";
export * from "./formal/event_grammar.js";
export * from "./formal/hc4_contractor.js";
export * from "./formal/ic3_engine.js";
export * from "./formal/inductive_prover.js";
export * from "./formal/multidomain_coordinator.js";
export * from "./formal/nlsat_solver.js";
export * from "./formal/oracles/index.js";
export * from "./formal/polyglot_drift_checker.js";
export * from "./formal/proof_manifest.js";
export * from "./formal/region_decomposer.js";
export * from "./formal/relational_verifier.js";
export * from "./formal/reliability/bdd_fault_tree.js";
export * from "./formal/reliability/ctmc_pmc.js";
export * from "./formal/requirement_binder.js";
export * from "./formal/simplification_waterfall.js";
export * from "./formal/stl_monitor.js";
export * from "./formal/synthesis/cegis.js";
export * from "./formal/synthesis/gr1_codegen.js";
export * from "./formal/synthesis/gr1_synthesizer.js";
export * from "./formal/theory_coordinator.js";
export * from "./formal/trace_record.js";
export * from "./formal/verdict.js";
export * from "./gpu/wasm_gpu_buffers.js";
export * from "./gpu/wasm_memory_planner.js";
export * from "./gpu/webgpu_reasoner.js";
export * from "./interop/blast_radius_runner.js";
export * from "./interop/bom_sync.js";
export * from "./interop/brownfield_alignment.js";
export * from "./interop/cst-polyglot-adapters.js";
export * from "./interop/gdt_schema.js";
export * from "./interop/oslc_gateway.js";
export * from "./interop/polyglot-transformer.js";
export * from "./interop/polyglot_diagnostics.js";
export * from "./interop/provenance.js";
export * from "./interop/reqif.js";
export * from "./interop/semantic_coordinator_pipeline.js";
export * from "./interop/shape_refit.js";
export * from "./interop/simplex_reconciler.js";
export * from "./interop/symbol_interop.js";
export * from "./interop/tgg-correspondence-indexer.js";
export * from "./interop/tgg-pattern-interpreter.js";
export * from "./interop/tgg_pic_dispatch.js";
export * from "./interop/thread_hypergraph.js";
export * from "./interop/thread_serializer.js";
export * from "./interop/trade_study.js";
export * from "./interop/vcycle_verifier.js";
export * from "./interop/wasm-polyglot-bridge.js";
export * from "./math/csr_graph.js";
export * from "./math/csr_graph_advanced.js";
export * from "./math/dense_linalg.js";
export * from "./ontology/bfo_vocabulary.js";
export * from "./ontology/parallel_reasoner.js";
export * from "./ontology/semantic_projector.js";
export * from "./ontology/wasm_ontology.js";
export * from "./passes/index.js";
export * from "./rewriting/index.js";
export * from "./solvers/cp_sat.js";
export * from "./solvers/multibody_featherstone.js";
export * from "./storage/paged_store.js";

export * from "./pipeline.js";
export * from "./runtime.js";
export * from "./simulation/wasm_cosim.js";
export * from "./simulation/wasm_fmu_subsystem.js";
export {
  computeIntegral,
  computeOvershoot,
  computeSettlingTime,
  computeSteadyState,
  parseComparisonOp,
  VerificationRunner,
  VerifyOp,
  verifyTrajectoryDirect,
  type ComparisonOp,
  type TrajectoryConstraint,
  type VerificationResult,
  type SimulationResult as VerifierSimulationResult,
} from "./simulation/wasm_verifier.js";
export * from "./solvers/krylov.js";
export * from "./solvers/nonlinear_polyalgorithm.js";
export * from "./solvers/solvers_bridge.js";
export * from "./solvers/sparse_lu.js";
export * from "./solvers/wasm_bdf.js";
export * from "./solvers/wasm_cad_diagram.js";
export * from "./solvers/wasm_dopri5.js";
export * from "./solvers/wasm_gaussian.js";
export * from "./solvers/wasm_groebner.js";
export * from "./solvers/wasm_minlp.js";
export * from "./solvers/wasm_qr.js";
export * from "./solvers/wasm_sdp_solver.js";
export * from "./solvers/wasm_sparse_jacobian.js";
export * from "./statemachine/wasm_bmc_engine.js";
export * from "./statemachine/wasm_fuml_engine.js";
export * from "./statemachine/wasm_pdr_engine.js";
export * from "./statemachine/wasm_rtc_statemachine.js";
export * from "./util/ctrf_reporter.js";
export * from "./util/diff.js";
export * from "./util/html_reporter.js";
export * from "./util/msl_ffi.js";
export * from "./util/port_signature.js";
export * from "./util/sarif_reporter.js";
export * from "./util/symbol_roles.js";
export * from "./util/type_registry.js";
export * from "./workspace/library-manifest.js";
export * from "./workspace/polyglot_engine.js";
export * from "./workspace/wasm-kernel-host.js";
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
export * from "./workspace/workspace_linter.js";
export type { SyntaxNode };
import type { SyntaxNode } from "@modelscript/dsl/utils";
export type CSTNode = SyntaxNode;

export * from "./formal/abstract_interpretation/array_segment_domain.js";
export * from "./formal/abstract_interpretation/cfg.js";
export * from "./formal/abstract_interpretation/domain.js";
export * from "./formal/abstract_interpretation/fixpoint_solver.js";
export {
  IntervalDomain,
  IntervalEnvironment,
  NumericalInterval,
} from "./formal/abstract_interpretation/interval_domain.js";
export * from "./formal/abstract_interpretation/reduced_product.js";

// Semantic Theory Coordinator & Theory Oracles
export * from "./benchmark.js";
export * from "./formal/candidate_filter.js";
export * from "./formal/dae/affine_domain.js";
export * from "./formal/dae/arena_dae_compiler.js";
export * from "./formal/dae/arena_eval.js";
export * from "./formal/dae/arena_fingerprint.js";
export * from "./formal/dae/dae_blt_reachability.js";
export * from "./formal/dae/dae_flowpipe_bridge.js";
export * from "./formal/dae/dae_interval_evaluator.js";
export * from "./formal/dae/hybrid_mode_verifier.js";
export * from "./formal/dae/taylor_domain.js";
export * from "./formal/multidomain_coordinator.js";
export * from "./formal/oracles/index.js";
export * from "./formal/theory_coordinator.js";
export * from "./interop/alm/index.js";
export * from "./interop/envelope_compliance.js";
export * from "./lsp_types.js";
export * from "./math/double64.js";
export * from "./solvers/distributed-krylov.js";
export * from "./solvers/sparse_arnoldi.js";
export * from "./util/snowflake.js";
export * from "./workspace/manifest-projection.js";
export * from "./workspace/manifest.js";
export * from "./workspace/package_index.js";
