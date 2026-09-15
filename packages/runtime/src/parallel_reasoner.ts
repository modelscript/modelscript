// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  WasmOntologyReasoner,
  type ConsistencyResult,
  type OWL2Axiom,
  type OWL2ClassDeclaration,
  type TaxonomyNode,
} from "./wasm_ontology.js";

/**
 * A decoupled ontology partition or modular component (e.g. subsystem, physical domain, or file).
 */
export interface OntologyModule {
  readonly name: string;
  readonly axioms: readonly OWL2Axiom[];
}

/**
 * Result of classifying an individual ontology module.
 */
export interface ModuleClassificationResult {
  readonly moduleName: string;
  readonly consistency: ConsistencyResult;
  readonly taxonomy: readonly TaxonomyNode[];
  readonly axiomCount: number;
  readonly executionTimeMs: number;
}

/**
 * High-performance parallel reasoner coordinator.
 * Partitions and executes reasoning workloads concurrently across decoupled modules
 * or sub-assemblies to maximize throughput on modern multi-core systems.
 */
export class ParallelOntologyReasoner {
  private concurrency: number;

  constructor(options?: { concurrency?: number }) {
    this.concurrency = options?.concurrency ?? 4;
  }

  /**
   * Classify a single ontology module asynchronously.
   */
  async classifyModule(module: OntologyModule): Promise<ModuleClassificationResult> {
    const start = performance.now();
    const reasoner = new WasmOntologyReasoner();
    await reasoner.init();
    reasoner.loadOntology(module.axioms);
    reasoner.classify();

    const consistency = reasoner.checkConsistency();
    const taxonomy = reasoner.getTaxonomy();

    return {
      moduleName: module.name,
      consistency,
      taxonomy,
      axiomCount: module.axioms.length,
      executionTimeMs: performance.now() - start,
    };
  }

  /**
   * Concurrently classify an array of independent ontology modules with bounded concurrency.
   */
  async classifyAll(modules: readonly OntologyModule[]): Promise<Map<string, ModuleClassificationResult>> {
    const results = new Map<string, ModuleClassificationResult>();

    for (let i = 0; i < modules.length; i += this.concurrency) {
      const batch = modules.slice(i, i + this.concurrency);
      const batchResults = await Promise.all(batch.map((m) => this.classifyModule(m)));
      for (const res of batchResults) {
        results.set(res.moduleName, res);
      }
    }

    return results;
  }

  /**
   * Aggregate individual module classification outcomes into a unified consistency report.
   */
  mergeResults(results: Map<string, ModuleClassificationResult>): {
    isConsistent: boolean;
    totalAxioms: number;
    totalTaxonomyNodes: number;
    inconsistentModules: string[];
  } {
    let isConsistent = true;
    let totalAxioms = 0;
    let totalTaxonomyNodes = 0;
    const inconsistentModules: string[] = [];

    for (const [name, res] of results) {
      totalAxioms += res.axiomCount;
      totalTaxonomyNodes += res.taxonomy.length;
      if (!res.consistency.isConsistent) {
        isConsistent = false;
        inconsistentModules.push(name);
      }
    }

    return {
      isConsistent,
      totalAxioms,
      totalTaxonomyNodes,
      inconsistentModules,
    };
  }

  /**
   * Automatically partition a monolithic ontology into decoupled modules using syntactic bot-locality.
   */
  static partitionByLocality(axioms: readonly OWL2Axiom[], targetPartitions = 3): OntologyModule[] {
    const reasoner = new WasmOntologyReasoner();
    reasoner.loadOntology(axioms);

    const declaredClasses = axioms
      .filter((a): a is OWL2ClassDeclaration => a.type === "ClassDeclaration")
      .map((a) => a.iri);

    if (declaredClasses.length === 0) {
      return [{ name: "Partition_1", axioms }];
    }

    const partitionCount = Math.min(targetPartitions, declaredClasses.length);
    const seedsPerPartition = Math.ceil(declaredClasses.length / partitionCount);
    const modules: OntologyModule[] = [];

    for (let p = 0; p < partitionCount; p++) {
      const seedSubset = new Set<string>(declaredClasses.slice(p * seedsPerPartition, (p + 1) * seedsPerPartition));
      if (seedSubset.size === 0) continue;
      const moduleAxioms = reasoner.extractBotLocalityModule(seedSubset);
      modules.push({
        name: `LocalityModule_${p + 1}`,
        axioms: moduleAxioms,
      });
    }

    return modules;
  }
}
