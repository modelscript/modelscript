// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Framework-agnostic diagram action queue, coalescer, and serialized
 * edit dispatcher shared across VS Code extension webviews and the Morsel web IDE.
 */

export interface DiagramActionLike {
  type: string;
  [key: string]: unknown;
}

export const SPATIAL_DIAGRAM_ACTION_TYPES = new Set<string>(["move", "resize", "rotate", "toggleDisable", "moveEdge"]);

export const OPTIMISTIC_DIAGRAM_ACTION_TYPES = new Set<string>([
  ...SPATIAL_DIAGRAM_ACTION_TYPES,
  "updateParameter",
  "updateProperty",
]);

/** Returns true if an action modifies only layout/spatial presentation or disable flags. */
export function isSpatialDiagramAction(action: Pick<DiagramActionLike, "type">): boolean {
  return SPATIAL_DIAGRAM_ACTION_TYPES.has(action.type);
}

/** Returns true if every action in a batch can be applied optimistically without a full spinner/rebuild. */
export function isOptimisticDiagramActionBatch(actions: ReadonlyArray<Pick<DiagramActionLike, "type">>): boolean {
  return actions.length > 0 && actions.every((a) => OPTIMISTIC_DIAGRAM_ACTION_TYPES.has(a.type));
}

function getMoveEdgeKey(edge: Record<string, unknown>): string {
  const id = edge["id"];
  if (typeof id === "string" && id.length > 0) return `id:${id}`;
  return `${String(edge["source"] ?? "")}=>${String(edge["target"] ?? "")}`;
}

function mergeByNameArray(
  prevItems: Array<Record<string, unknown>>,
  nextItems: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const merged = prevItems.map((item) => ({ ...item }));
  const indexByName = new Map<string, number>();
  for (let i = 0; i < merged.length; i++) {
    const name = merged[i]?.["name"];
    if (typeof name === "string") indexByName.set(name, i);
  }
  for (const item of nextItems) {
    const name = item["name"];
    if (typeof name === "string" && indexByName.has(name)) {
      const idx = indexByName.get(name)!;
      merged[idx] = { ...merged[idx], ...item };
    } else {
      if (typeof name === "string") indexByName.set(name, merged.length);
      merged.push({ ...item });
    }
  }
  return merged;
}

function getSingleTargetKey(action: DiagramActionLike): string | null {
  const item = action["item"] as Record<string, unknown> | undefined;
  if (item && typeof item["name"] === "string") return item["name"];
  if (typeof action["name"] === "string") return action["name"];
  return null;
}

/**
 * Coalesces adjacent redundant diagram edit actions within a queued batch without
 * reordering across structural barriers (e.g. `addComponent`, `connect`, `deleteComponents`).
 */
export function coalesceDiagramActions<T extends DiagramActionLike>(actions: ReadonlyArray<T>): T[] {
  if (actions.length <= 1) return actions.map((a) => ({ ...a }));

  const result: T[] = [];

  for (const raw of actions) {
    const next = { ...raw } as T;
    const nextRec = next as Record<string, unknown>;
    const prev = result.length > 0 ? result[result.length - 1] : undefined;
    const prevRec = prev as Record<string, unknown> | undefined;

    if (!prev || !prevRec || prev.type !== next.type) {
      result.push(next);
      continue;
    }

    if (next.type === "move" && Array.isArray(prevRec["items"]) && Array.isArray(nextRec["items"])) {
      prevRec["items"] = mergeByNameArray(
        prevRec["items"] as Array<Record<string, unknown>>,
        nextRec["items"] as Array<Record<string, unknown>>,
      );
      continue;
    }

    if (next.type === "moveEdge" && Array.isArray(prevRec["edges"]) && Array.isArray(nextRec["edges"])) {
      const mergedEdges = (prevRec["edges"] as Array<Record<string, unknown>>).map((e) => ({ ...e }));
      const idxMap = new Map<string, number>();
      for (let i = 0; i < mergedEdges.length; i++) {
        idxMap.set(getMoveEdgeKey(mergedEdges[i]!), i);
      }
      for (const edge of nextRec["edges"] as Array<Record<string, unknown>>) {
        const key = getMoveEdgeKey(edge);
        const existingIdx = idxMap.get(key);
        if (existingIdx !== undefined) {
          mergedEdges[existingIdx] = { ...mergedEdges[existingIdx], ...edge };
        } else {
          idxMap.set(key, mergedEdges.length);
          mergedEdges.push({ ...edge });
        }
      }
      prevRec["edges"] = mergedEdges;
      continue;
    }

    if (next.type === "resize" || next.type === "rotate" || next.type === "toggleDisable") {
      const prevKey = getSingleTargetKey(prev);
      const nextKey = getSingleTargetKey(next);
      if (prevKey && nextKey && prevKey === nextKey) {
        result[result.length - 1] = { ...prev, ...next };
        continue;
      }
    }

    if (next.type === "updateParameter" || next.type === "updateProperty") {
      const prevParam = prev.type === "updateParameter" ? prevRec["parameter"] : prevRec["key"];
      const nextParam = next.type === "updateParameter" ? nextRec["parameter"] : nextRec["key"];
      if (
        typeof prevRec["name"] === "string" &&
        prevRec["name"] === nextRec["name"] &&
        typeof prevParam === "string" &&
        prevParam === nextParam
      ) {
        const preservedOldValue = prevRec["oldValue"] !== undefined ? prevRec["oldValue"] : nextRec["oldValue"];
        const preservedPreviousValue =
          prevRec["previousValue"] !== undefined ? prevRec["previousValue"] : nextRec["previousValue"];
        const merged: Record<string, unknown> = { ...prev, ...next };
        if (preservedOldValue !== undefined) merged["oldValue"] = preservedOldValue;
        if (preservedPreviousValue !== undefined) merged["previousValue"] = preservedPreviousValue;
        result[result.length - 1] = merged as T;
        continue;
      }
    }

    result.push(next);
  }

  return result;
}

export interface DiagramActionQueueOptions<T extends DiagramActionLike = DiagramActionLike> {
  /** Batch debounce window in milliseconds for spatial edits (default: 10). */
  spatialDelayMs?: number | undefined;
  /** Maximum time in milliseconds a continuous stream of spatial edits can defer flushing (default: 120). */
  maxWaitMs?: number | undefined;
  /** Batch debounce window in milliseconds for structural edits (default: 0). */
  structuralDelayMs?: number | undefined;
  /** Whether to coalesce adjacent redundant actions when flushing (default: true). */
  coalesce?: boolean | undefined;
  /** Invoked when a batch of queued actions flushes. */
  onFlush: (actions: T[]) => void;
  /** Optional bypass for immediate transient actions such as `interactiveWrite`. */
  onImmediateAction?: ((action: T) => void) | undefined;
  /** Action types that bypass queuing and call `onImmediateAction` immediately (default: `["interactiveWrite"]` when `onImmediateAction` is provided). */
  immediateActionTypes?: ReadonlyArray<string> | undefined;
}

/**
 * Shared micro-batch queue that debounces spatial vs structural diagram edits,
 * coalesces consecutive updates, and emits normalized action batches.
 */
export class DiagramActionQueue<T extends DiagramActionLike = DiagramActionLike> {
  private pending: T[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private firstPendingAt: number | null = null;
  private readonly spatialDelayMs: number;
  private readonly maxWaitMs: number;
  private readonly structuralDelayMs: number;
  private readonly coalesce: boolean;
  private readonly immediateTypes: Set<string>;
  private readonly onFlush: (actions: T[]) => void;
  private readonly onImmediateAction: ((action: T) => void) | undefined;

  constructor(options: DiagramActionQueueOptions<T>) {
    this.spatialDelayMs = options.spatialDelayMs ?? 10;
    this.maxWaitMs = options.maxWaitMs ?? 120;
    this.structuralDelayMs = options.structuralDelayMs ?? 0;
    this.coalesce = options.coalesce ?? true;
    this.onFlush = options.onFlush;
    this.onImmediateAction = options.onImmediateAction;
    this.immediateTypes = new Set(
      options.immediateActionTypes ?? (options.onImmediateAction ? ["interactiveWrite"] : []),
    );
  }

  public enqueue(action: T): void {
    if (this.onImmediateAction && this.immediateTypes.has(action.type)) {
      this.onImmediateAction(action);
      return;
    }

    const now = Date.now();
    if (this.firstPendingAt === null) {
      this.firstPendingAt = now;
    }
    this.pending.push(action);

    if (this.maxWaitMs > 0 && now - this.firstPendingAt >= this.maxWaitMs) {
      this.flush();
      return;
    }

    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const delay = isSpatialDiagramAction(action) ? this.spatialDelayMs : this.structuralDelayMs;
    this.timer = setTimeout(() => {
      this.flush();
    }, delay);
  }

  public flush(): T[] {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.firstPendingAt = null;
    if (this.pending.length === 0) return [];

    const raw = this.pending;
    this.pending = [];
    const batch = this.coalesce ? coalesceDiagramActions(raw) : raw;
    if (batch.length > 0) {
      this.onFlush(batch);
    }
    return batch;
  }

  public clear(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.firstPendingAt = null;
    this.pending = [];
  }

  public dispose(): void {
    this.clear();
  }

  public getPendingCount(): number {
    return this.pending.length;
  }
}

/**
 * Serializes asynchronous LSP diagram edit roundtrips and assigns monotonically
 * increasing sequence numbers so edits never race or reorder out of flight.
 */
export class SerializedDiagramEditRunner {
  private seq = 1;
  private queue: Promise<void> = Promise.resolve();

  public nextSeq(): number {
    return this.seq++;
  }

  public getCurrentSeq(): number {
    return this.seq;
  }

  public enqueue<T>(task: (seq: number) => Promise<T>, onError?: (err: unknown) => void): Promise<T | undefined> {
    const run = this.queue.then(() => {
      const seq = this.nextSeq();
      return task(seq);
    });
    const handled = run.then(
      (res) => res,
      (err) => {
        if (onError) {
          onError(err);
          return undefined;
        }
        throw err;
      },
    );
    this.queue = handled.then(
      () => undefined,
      () => undefined,
    );
    return handled;
  }
}
