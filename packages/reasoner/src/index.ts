// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/reasoner — OWL2 Description Logic Reasoner
 *
 * Provides subsumption, consistency, classification, transitive property
 * queries, and SPARQL-DL evaluation for ModelScript engineering ontologies.
 *
 * ## Quick Start
 *
 * ```typescript
 * import { TableauReasoner, OntologyBuilder } from "@modelscript/reasoner";
 * import { OWL2OntologyStore } from "@modelscript/compiler";
 *
 * const reasoner = new TableauReasoner();
 * const builder = new OntologyBuilder(reasoner, store);
 * await builder.initialize();
 *
 * // After workspace changes:
 * const delta = store.update(workspaceVersions);
 * if (delta) builder.applyDelta(delta);
 *
 * // Query:
 * const result = reasoner.isSubClassOf("mo:Motor", "mo:ElectricalDevice");
 * const taxonomy = reasoner.getTaxonomy();
 * ```
 */

// Reasoner interface & types
export type {
  ClassificationResult,
  ConsistencyResult,
  DLQuery,
  DLQueryResult,
  IOWLReasoner,
  PropertyChainResult,
  ReasonerStatus,
  SubsumptionResult,
  TaxonomyNode,
} from "./reasoner.js";

// Built-in tableau reasoner
export { TableauReasoner } from "./tableau-reasoner.js";

// Ontology builder (bridge between store and reasoner)
export { OntologyBuilder } from "./ontology-builder.js";
export type { OntologyEvent, OntologyEventListener } from "./ontology-builder.js";

// SPARQL-DL query engine
export {
  executeBatchQueries,
  executeDLQuery,
  executeQueryString,
  formatQueryResult,
  parseDLQuery,
} from "./sparql-engine.js";
