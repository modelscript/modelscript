// SPDX-License-Identifier: AGPL-3.0-or-later

import { getBfoIofCoreAxioms } from "@modelscript/runtime";
import { OntologyBuilder, TableauReasoner } from "@modelscript/runtime/wasm_ontology.js";
import { Connection } from "vscode-languageserver/browser.js";
import { WorkspaceManager } from "./workspace-manager.js";

export class ReasonerService {
  public reasoner: TableauReasoner;
  public ontologyBuilder: OntologyBuilder;

  private connection: Connection;
  private workspaceManager: WorkspaceManager;

  constructor(connection: Connection, workspaceManager: WorkspaceManager) {
    this.connection = connection;
    this.workspaceManager = workspaceManager;

    this.reasoner = new TableauReasoner();
    this.ontologyBuilder = new OntologyBuilder(
      this.reasoner,
      this.workspaceManager?.unifiedWorkspace?.owl2Store ?? (new Map() as any),
    );

    this.initialize();
  }

  public async initialize() {
    this.connection.console.info("[reasoner] Initializing TableauReasoner...");
    await this.ontologyBuilder.initialize();
    try {
      const bfoAxioms = getBfoIofCoreAxioms();
      const store = this.workspaceManager?.unifiedWorkspace?.owl2Store;
      if (store && typeof store.setAxioms === "function") {
        store.setAxioms("bfo-core", bfoAxioms);
      }
      this.reasoner.loadOntology(store?.axioms?.length ? store.axioms : bfoAxioms);
    } catch (e: any) {
      this.connection.console.warn(`[reasoner] Failed to load BFO baseline axioms: ${e?.message || e}`);
    }
    this.connection.console.info(`[reasoner] Initialized with ${this.reasoner.getTaxonomy().length} taxonomy nodes.`);
  }

  /**
   * Called incrementally (e.g. after validation) to ingest new axioms
   * and update the taxonomy natively without parsing full OWL2 strings.
   */
  public updateAndReason(workspaceVersions: Map<string, number>, directDelta?: any) {
    if (this.reasoner.status === "idle") {
      this.reasoner.init();
    }
    const store = this.workspaceManager?.unifiedWorkspace?.owl2Store;
    if (store && this.reasoner.axiomCount === 0 && store.axioms.length > 0) {
      this.reasoner.loadOntology(store.axioms);
    }

    // 1. Determine delta: directDelta from setAxioms, or store.update, or store.lastDelta
    let delta = directDelta;
    if (!delta && store && typeof store.update === "function") {
      delta = store.update(workspaceVersions);
    }
    if (
      !delta &&
      store &&
      (store as any).lastDelta &&
      ((store as any).lastDelta.assertions.length > 0 || (store as any).lastDelta.retractions.length > 0)
    ) {
      delta = (store as any).lastDelta;
    }

    if (delta && (delta.assertions.length > 0 || delta.retractions.length > 0)) {
      const startTime = performance.now();

      // 2. Apply delta to the reasoner and re-classify
      this.reasoner.applyDelta(delta);
      this.ontologyBuilder.applyDelta(delta);
      this.reasoner.classify();

      const endTime = performance.now();

      // 3. Log or surface consistency results
      const consistency = this.reasoner.checkConsistency();
      this.connection.console.info(
        `[reasoner] Updated in ${(endTime - startTime).toFixed(2)}ms. Delta: +${delta.assertions.length} -${delta.retractions.length}. Consistent: ${consistency.isConsistent}`,
      );

      if (!consistency.isConsistent) {
        if (consistency.explanation) {
          this.connection.console.warn(`[reasoner] Contradiction: ${consistency.explanation}`);
        }
        if (consistency.minimalConflictCore && consistency.minimalConflictCore.length > 0) {
          const coreSummary = consistency.minimalConflictCore.map((ax) => JSON.stringify(ax)).join(", ");
          this.connection.console.warn(
            `[reasoner] QuickXplain Minimal Conflict Core (${consistency.minimalConflictCore.length} axioms): ${coreSummary}`,
          );
        }
      }
      return consistency;
    }

    return this.reasoner.checkConsistency();
  }
}
