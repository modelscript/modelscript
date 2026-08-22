import { OntologyBuilder, TableauReasoner } from "@modelscript/language";
import { Connection } from "vscode-languageserver/browser";
import { WorkspaceManager } from "./WorkspaceManager";

export class ReasonerService {
  public reasoner: TableauReasoner;
  public ontologyBuilder: OntologyBuilder;

  private connection: Connection;
  private workspaceManager: WorkspaceManager;

  constructor(connection: Connection, workspaceManager: WorkspaceManager) {
    this.connection = connection;
    this.workspaceManager = workspaceManager;

    this.reasoner = new TableauReasoner();
    this.ontologyBuilder = new OntologyBuilder(this.reasoner, this.workspaceManager.unifiedWorkspace.owl2Store);

    this.initialize();
  }

  public async initialize() {
    this.connection.console.info("[reasoner] Initializing TableauReasoner...");
    await this.ontologyBuilder.initialize();
    this.connection.console.info(`[reasoner] Initialized with ${this.reasoner.getTaxonomy().length} taxonomy nodes.`);
  }

  /**
   * Called incrementally (e.g. after validation) to ingest new axioms
   * and update the taxonomy natively without parsing full OWL2 strings.
   */
  public updateAndReason(workspaceVersions: Map<string, number>) {
    // 1. Ask the store to compute the delta (if any) based on workspace versions
    const delta = this.workspaceManager.unifiedWorkspace.owl2Store.update(workspaceVersions);

    if (delta && (delta.assertions.length > 0 || delta.retractions.length > 0)) {
      const startTime = performance.now();

      // 2. Apply delta to the reasoner and re-classify
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
    }
  }
}
