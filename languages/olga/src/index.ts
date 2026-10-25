// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — High-Fidelity Multiphase Dynamic Flow Simulator Package for ModelScript.
 *
 * Provides:
 * - XML parser for OLGA GUI project files (.opi)
 * - In-WASM 1D Drift-Flux Staggered-Grid DAE solver lowering directly to DAEBuilder
 * - Formal SysML v2 projections for flowline topology, requirements, and operational state machines
 * - Flow assurance limits verification (hydrates, slug surge, MAOP, turndown)
 * - Pre-flight multiphase linting (M7001–M7005)
 */

export * from "./engine/index.js";
export * from "./language.js";
export { default as olgaLanguage } from "./language.js";
export * from "./lints/index.js";
export * from "./parser/index.js";
export * from "./projections/olga-to-sysml2.js";
export * from "./solver/anti-slug-controller.js";
export * from "./solver/asphaltene.js";
export * from "./solver/corrosion.js";
export * from "./solver/cubic-eos.js";
export * from "./solver/drift-flux-dae.js";
export * from "./solver/droplet-mechanics.js";
export * from "./solver/emulsion-rheology.js";
export * from "./solver/flow-regimes.js";
export * from "./solver/fluid-properties.js";
export * from "./solver/hydrate-inhibition.js";
export * from "./solver/hydrate-kinetics.js";
export * from "./solver/machinery.js";
export * from "./solver/network-solver.js";
export * from "./solver/network-transient-solver.js";
export * from "./solver/pig-tracker.js";
export * from "./solver/slug-tracker.js";
export * from "./solver/sour-corrosion.js";
export * from "./solver/thermal-cooldown.js";
export * from "./solver/three-fluid-dae.js";
export * from "./solver/wax-and-sand.js";
export * from "./solver/wellbore-ipr.js";
export * from "./solver/zuber-findlay.js";
export * from "./survey/survey-importer.js";
export * from "./tuning/index.js";
export * from "./types.js";
export * from "./verification/flow-assurance-gate.js";
export * from "./verification/flow-assurance-verifier.js";
export * from "./workspace-index.js";
