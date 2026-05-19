// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Ontology Builder
 *
 * Bridges the `OWL2OntologyStore` (from @modelscript/compiler) to the
 * `IOWLReasoner` interface. Handles:
 *
 * - Initial ontology loading from the store into the reasoner
 * - Incremental delta streaming with debouncing
 * - Automatic re-classification after axiom changes
 * - Event emission for IDE consumers (status changes, diagnostics)
 */

import type { OWL2AxiomDelta, OWL2OntologyStore } from "@modelscript/compiler";

import type { ConsistencyResult, IOWLReasoner, ReasonerStatus, TaxonomyNode } from "./reasoner.js";

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type OntologyEvent =
  | { type: "status-changed"; status: ReasonerStatus }
  | { type: "classified"; axiomCount: number; timeMs: number }
  | { type: "consistency-result"; result: ConsistencyResult }
  | { type: "delta-applied"; delta: OWL2AxiomDelta }
  | { type: "error"; error: Error };

export type OntologyEventListener = (event: OntologyEvent) => void;

// ---------------------------------------------------------------------------
// Ontology Builder
// ---------------------------------------------------------------------------

export class OntologyBuilder {
  private reasoner: IOWLReasoner;
  private store: OWL2OntologyStore;
  private listeners: OntologyEventListener[] = [];

  /** Debounce timer for coalescing rapid delta applications. */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingDelta: OWL2AxiomDelta | null = null;

  /** Debounce interval in milliseconds. */
  private debounceMs: number;

  /** Whether to auto-classify after applying deltas. */
  private autoClassify: boolean;

  constructor(
    reasoner: IOWLReasoner,
    store: OWL2OntologyStore,
    options?: {
      debounceMs?: number;
      autoClassify?: boolean;
    },
  ) {
    this.reasoner = reasoner;
    this.store = store;
    this.debounceMs = options?.debounceMs ?? 300;
    this.autoClassify = options?.autoClassify ?? true;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** The underlying reasoner instance. */
  get backend(): IOWLReasoner {
    return this.reasoner;
  }

  /**
   * Initialize the reasoner and load the current ontology from the store.
   * Call this once during workspace startup.
   */
  async initialize(): Promise<void> {
    await this.reasoner.init();
    this.emit({ type: "status-changed", status: this.reasoner.status });

    // Load current axioms from the store
    if (this.store.size > 0) {
      this.loadFromStore();
    }
  }

  /**
   * Load (or reload) the full ontology from the store into the reasoner.
   */
  loadFromStore(): void {
    const axioms = this.store.axioms;
    this.reasoner.loadOntology(axioms);
    this.emit({ type: "status-changed", status: this.reasoner.status });

    if (this.autoClassify && axioms.length > 0) {
      this.classifyAndEmit();
    }
  }

  /**
   * Apply an incremental delta from the ontology store.
   * Debounced: rapid successive calls are coalesced.
   *
   * @param delta - The axiom delta to apply.
   */
  applyDelta(delta: OWL2AxiomDelta): void {
    if (delta.retractions.length === 0 && delta.assertions.length === 0) return;

    if (this.debounceMs <= 0) {
      // No debouncing — apply immediately
      this.applyDeltaImmediate(delta);
      return;
    }

    // Coalesce with pending delta
    if (this.pendingDelta) {
      this.pendingDelta = {
        retractions: [...this.pendingDelta.retractions, ...delta.retractions],
        assertions: [...this.pendingDelta.assertions, ...delta.assertions],
      };
    } else {
      this.pendingDelta = delta;
    }

    // Reset debounce timer
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.flushPendingDelta();
    }, this.debounceMs);
  }

  /**
   * Force-flush any pending debounced delta and classify immediately.
   */
  flush(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.flushPendingDelta();
  }

  /**
   * Trigger classification and check consistency.
   */
  classifyAndCheck(): ConsistencyResult {
    this.classifyAndEmit();
    const result = this.reasoner.checkConsistency();
    this.emit({ type: "consistency-result", result });
    return result;
  }

  /**
   * Get the current inferred taxonomy.
   */
  getTaxonomy(): TaxonomyNode[] {
    return this.reasoner.getTaxonomy();
  }

  /**
   * Register an event listener.
   */
  on(listener: OntologyEventListener): void {
    this.listeners.push(listener);
  }

  /**
   * Remove an event listener.
   */
  off(listener: OntologyEventListener): void {
    const idx = this.listeners.indexOf(listener);
    if (idx !== -1) this.listeners.splice(idx, 1);
  }

  /**
   * Dispose the builder and underlying reasoner.
   */
  dispose(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingDelta = null;
    this.reasoner.dispose();
    this.listeners = [];
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private applyDeltaImmediate(delta: OWL2AxiomDelta): void {
    try {
      this.reasoner.applyDelta(delta);
      this.emit({ type: "delta-applied", delta });

      if (this.autoClassify) {
        this.classifyAndEmit();
      }
    } catch (e) {
      this.emit({ type: "error", error: e instanceof Error ? e : new Error(String(e)) });
    }
  }

  private flushPendingDelta(): void {
    if (this.pendingDelta) {
      const delta = this.pendingDelta;
      this.pendingDelta = null;
      this.applyDeltaImmediate(delta);
    }
  }

  private classifyAndEmit(): void {
    const start = performance.now();
    this.reasoner.classify();
    const timeMs = performance.now() - start;
    this.emit({
      type: "classified",
      axiomCount: this.reasoner.axiomCount,
      timeMs,
    });
    this.emit({ type: "status-changed", status: this.reasoner.status });
  }

  private emit(event: OntologyEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Don't let listener errors crash the builder
      }
    }
  }
}
