// SPDX-License-Identifier: AGPL-3.0-or-later

import { computeMeshVolumeAndArea, computeProjectedFrontalArea, ManifoldWorker } from "@modelscript/cad";
import { ScadEvaluator } from "@modelscript/scad";
import type { Connection } from "vscode-languageserver";

/**
 * Watertight manifold mesh metrics evaluated from an OpenSCAD constructive solid geometry tree.
 */
export interface CadCsgMetrics {
  /** Projected frontal area in square meters along the z-axis (e.g. for drag force estimation). */
  frontalAreaM2: number;
  /** Watertight manifold volume in cubic millimeters. */
  volumeMm3: number;
  /** Estimated solid mass in kilograms based on evaluated volume and material density. */
  massKg: number;
  /** Formatted CodeLens header title for direct presentation. */
  title: string;
  /** FNV-1a content hash of the source code when this metric was evaluated. */
  hash: string;
  /** Timestamp when evaluation completed. */
  evaluatedAt: number;
}

/**
 * Background / Off-Thread 3D CSG Metric Evaluation Service for OpenSCAD documents.
 *
 * Decouples heavy constructive solid geometry boolean evaluation (ManifoldWorker / BSP meshing)
 * from the synchronous LSP request loop. Provides:
 * - O(1) content-hash memoized cache to eliminate redundant meshing during cursor moves & scrolls
 * - Stale-while-revalidate pattern so editor lenses do not vanish or flicker during edits
 * - Debounced background worker execution that yields to the event loop
 * - Automatic CodeLens refresh notification (`workspace/codeLens/refresh`) upon completion
 */
export class CadMetricsService {
  private cache = new Map<string, CadCsgMetrics>();
  private pendingDebounce = new Map<string, NodeJS.Timeout>();
  private inFlightEvaluations = new Set<string>();

  /**
   * Fast 32-bit FNV-1a hash to fingerprint document content.
   */
  public hashContent(text: string): string {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16) + `:${text.length}`;
  }

  /**
   * Retrieves cached metrics if available and current; otherwise schedules
   * a debounced background evaluation and returns the best-available metric.
   *
   * @param uri - Document URI
   * @param text - Current document text
   * @param rootNode - CST root node of the parsed OpenSCAD document
   * @param connection - Optional LSP connection to notify when background evaluation finishes
   * @param threadFallback - Optional pre-indexed digital thread metadata metrics
   * @param options - Execution options (e.g. syncFallback for synchronous test callers)
   */
  public getOrSchedule(
    uri: string,
    text: string,
    rootNode: any,
    connection?: Connection | { sendRequest?: (method: string) => Promise<any> },
    threadFallback?: { frontalArea?: number; mass?: number },
    options?: { syncFallback?: boolean },
  ): string | undefined {
    const hash = this.hashContent(text);
    const cached = this.cache.get(uri);

    // 1. Exact cache hit: return immediately (0ms, zero CSG meshing overhead)
    if (cached && cached.hash === hash) {
      return cached.title;
    }

    // 2. Schedule off-thread / background evaluation for this revision
    this.scheduleBackgroundEvaluation(uri, text, hash, rootNode, connection);

    // 3. Stale-while-revalidate: return previous cached title while new one evaluates in background
    if (cached) {
      return cached.title;
    }

    // 4. Thread metadata fallback if available from digital thread hypergraph
    if (threadFallback?.frontalArea !== undefined && threadFallback?.mass !== undefined) {
      return `📐 Frontal Area: A = ${Number(threadFallback.frontalArea).toFixed(3)} m² | Estimated Mass: ${Number(threadFallback.mass).toFixed(2)} kg`;
    }

    // 5. If syncFallback allowed (default true for initial cold evaluation),
    // compute immediately so synchronous test runners and first renders receive valid metrics
    if (options?.syncFallback !== false && rootNode) {
      const computed = this.computeSynchronously(uri, text, hash, rootNode);
      if (computed) {
        return computed.title;
      }
    }

    return undefined;
  }

  /**
   * Schedules a debounced background CSG evaluation to avoid freezing the editor thread.
   */
  public scheduleBackgroundEvaluation(
    uri: string,
    text: string,
    hash: string,
    rootNode: any,
    connection?: Connection | { sendRequest?: (method: string) => Promise<any> },
    debounceMs = 200,
  ): void {
    const existing = this.pendingDebounce.get(uri);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(async () => {
      this.pendingDebounce.delete(uri);
      if (this.inFlightEvaluations.has(uri)) return;

      this.inFlightEvaluations.add(uri);
      try {
        await this.evaluateAsync(uri, text, hash, rootNode);
        if (connection && typeof connection.sendRequest === "function") {
          connection.sendRequest("workspace/codeLens/refresh").catch(() => {});
        }
      } catch {
        // Silently swallow background CAD meshing failures
      } finally {
        this.inFlightEvaluations.delete(uri);
      }
    }, debounceMs);

    this.pendingDebounce.set(uri, timer);
  }

  /**
   * Asynchronously evaluates the solid CSG tree on a microtask/background tick,
   * yielding execution to the event loop so LSP request handlers remain responsive.
   */
  public async evaluateAsync(
    uri: string,
    text: string,
    hash: string,
    rootNode: any,
  ): Promise<CadCsgMetrics | null> {
    if (!rootNode) return null;

    // Yield to the event loop before performing CPU-bound CSG meshing
    await new Promise<void>((resolve) => {
      if (typeof setImmediate === "function") {
        setImmediate(resolve);
      } else {
        setTimeout(resolve, 0);
      }
    });

    return this.computeSynchronously(uri, text, hash, rootNode);
  }

  /**
   * Evaluates the solid CST node into a manifold mesh and extracts volume, frontal area, and mass.
   */
  public computeSynchronously(
    uri: string,
    text: string,
    hash: string,
    rootNode: any,
  ): CadCsgMetrics | null {
    if (!rootNode) return null;

    try {
      const evaluator = new ScadEvaluator();
      const solid = evaluator.evaluate(rootNode);
      if (!solid) return null;

      const mesh = ManifoldWorker.evaluateSolid(solid);
      const { volume } = computeMeshVolumeAndArea(mesh);
      const frontalAreaMm2 = computeProjectedFrontalArea(mesh, [0, 0, 1]);
      const frontalAreaM2 = frontalAreaMm2 * 1e-6;

      const densityMatch = /\/\/\s*@density\s*:\s*([0-9.eE+-]+)/i.exec(text);
      const densityKgM3 = densityMatch ? parseFloat(densityMatch[1]!) : 2700;
      const massKg = volume * 1e-9 * densityKgM3;

      const title = `📐 Frontal Area: A = ${frontalAreaM2.toFixed(4)} m² | Volume: ${volume.toFixed(1)} mm³ | Estimated Mass: ${massKg.toFixed(3)} kg`;

      const result: CadCsgMetrics = {
        frontalAreaM2,
        volumeMm3: volume,
        massKg,
        title,
        hash,
        evaluatedAt: Date.now(),
      };

      this.cache.set(uri, result);
      return result;
    } catch {
      return null;
    }
  }

  /**
   * Cleans up resources when a document is closed.
   */
  public disposeDocument(uri: string): void {
    const timer = this.pendingDebounce.get(uri);
    if (timer) {
      clearTimeout(timer);
      this.pendingDebounce.delete(uri);
    }
    this.inFlightEvaluations.delete(uri);
    this.cache.delete(uri);
  }

  /**
   * Clears all cached CAD metrics.
   */
  public clear(): void {
    for (const timer of this.pendingDebounce.values()) {
      clearTimeout(timer);
    }
    this.pendingDebounce.clear();
    this.inFlightEvaluations.clear();
    this.cache.clear();
  }
}
