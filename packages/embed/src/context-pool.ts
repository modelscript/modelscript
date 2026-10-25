// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * CanvasContextPool
 *
 * Manages active WebGL/WebGPU contexts across the application to prevent
 * exceeding browser limits (typically 8–16 per browser tab, causing CONTEXT_LOST_WEBGL).
 *
 * Implements an LRU eviction strategy: when a new 3D/WebGPU context is requested
 * and the active limit is reached, the oldest inactive context is put to sleep.
 * Before sleeping, the context can capture a lightweight image snapshot so the user
 * perceives a frozen, high-fidelity preview with a "Click to re-activate" overlay.
 */

export interface ContextSubscriber {
  id: string;
  onSleep: (snapshotUrl?: string) => void;
  onWake?: () => void;
  captureSnapshot?: () => string | null;
}

export class CanvasContextPool {
  private maxActiveContexts: number;
  private activeContexts: string[] = [];
  private subscribers: Map<string, ContextSubscriber> = new Map();
  private snapshots: Map<string, string> = new Map();

  constructor(maxActive?: number) {
    if (maxActive !== undefined && maxActive > 0) {
      this.maxActiveContexts = maxActive;
    } else {
      // Determine safe default based on environment
      this.maxActiveContexts = CanvasContextPool.detectSafeLimit();
    }
  }

  /**
   * Safe limit detection based on user agent heuristics.
   * Mobile browsers and Safari enforce a hard limit of 8 contexts.
   * Desktop Chromium and Firefox support 16 contexts.
   */
  public static detectSafeLimit(): number {
    if (typeof navigator === "undefined") return 6;
    const ua = navigator.userAgent.toLowerCase();
    const isMobile = /mobile|iphone|ipad|android/.test(ua);
    const isSafari = /safari/.test(ua) && !/chrome|chromium|edg/.test(ua);
    if (isMobile || isSafari) {
      return 6; // Stay safely below 8
    }
    return 8; // Stay safely below 16
  }

  public setMaxActiveContexts(limit: number): void {
    if (limit > 0) {
      this.maxActiveContexts = limit;
      this.enforceBudget();
    }
  }

  public getMaxActiveContexts(): number {
    return this.maxActiveContexts;
  }

  public getActiveCount(): number {
    return this.activeContexts.length;
  }

  public isActive(id: string): boolean {
    return this.activeContexts.includes(id);
  }

  public getSnapshot(id: string): string | undefined {
    return this.snapshots.get(id);
  }

  public setSnapshot(id: string, snapshotUrl: string): void {
    this.snapshots.set(id, snapshotUrl);
  }

  /**
   * Request activation for a WebGL context.
   * If budget is exceeded, puts LRU context to sleep.
   */
  public requestActive(subscriber: ContextSubscriber): boolean {
    const { id } = subscriber;
    this.subscribers.set(id, subscriber);

    const existingIdx = this.activeContexts.indexOf(id);
    if (existingIdx !== -1) {
      // Move to end (most recently used)
      this.activeContexts.splice(existingIdx, 1);
      this.activeContexts.push(id);
      return true;
    }

    // Need to activate a new one: enforce budget first
    while (this.activeContexts.length >= this.maxActiveContexts) {
      const oldestId = this.activeContexts.shift();
      if (oldestId) {
        this.putToSleep(oldestId);
      }
    }

    this.activeContexts.push(id);
    subscriber.onWake?.();
    return true;
  }

  /**
   * Voluntary release of an active context (e.g. scrolled offscreen or unmounted).
   */
  public release(id: string): void {
    const idx = this.activeContexts.indexOf(id);
    if (idx !== -1) {
      this.activeContexts.splice(idx, 1);
    }
  }

  /**
   * Unregister subscriber completely.
   */
  public unregister(id: string): void {
    this.release(id);
    this.subscribers.delete(id);
    this.snapshots.delete(id);
  }

  private putToSleep(id: string): void {
    const sub = this.subscribers.get(id);
    if (!sub) return;

    let snapshotUrl: string | undefined;
    if (sub.captureSnapshot) {
      try {
        const snap = sub.captureSnapshot();
        if (snap) {
          snapshotUrl = snap;
          this.snapshots.set(id, snap);
        }
      } catch {
        // Fallback to existing snapshot if available
        snapshotUrl = this.snapshots.get(id);
      }
    } else {
      snapshotUrl = this.snapshots.get(id);
    }

    try {
      sub.onSleep(snapshotUrl);
    } catch (err) {
      console.warn(`[CanvasContextPool] Error putting context ${id} to sleep:`, err);
    }
  }

  private enforceBudget(): void {
    while (this.activeContexts.length > this.maxActiveContexts) {
      const oldestId = this.activeContexts.shift();
      if (oldestId) {
        this.putToSleep(oldestId);
      }
    }
  }
}

/** Global singleton instance */
export const globalContextPool = new CanvasContextPool();
