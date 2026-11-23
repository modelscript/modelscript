// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createEmptyCanvasDocument,
  type CanvasCommentReply,
  type CanvasCommentThread,
  type CanvasDocument,
  type CanvasFrame,
  type CanvasTile,
  type CanvasWire,
  type WorldBounds,
  type WorldPoint,
} from "../schema/canvas-document.js";

/** Lamport timestamp with deterministic peerId tie-breaker for total ordering. */
export interface CrdtStamp {
  clock: number;
  peerId: string;
}

export interface CrdtRegister<T> {
  value: T | null; // null represents a tombstone deletion
  stamp: CrdtStamp;
}

export interface CanvasCrdtDelta {
  originPeerId: string;
  tiles?: Record<string, CrdtRegister<CanvasTile>> | undefined;
  frames?: Record<string, CrdtRegister<CanvasFrame>> | undefined;
  wires?: Record<string, CrdtRegister<CanvasWire>> | undefined;
  comments?: Record<string, CrdtRegister<CanvasCommentThread>> | undefined;
}

export interface CanvasPeerPresence {
  peerId: string;
  userName: string;
  color: string;
  cursor?: WorldPoint | undefined;
  viewport?: WorldBounds | undefined;
  selection?: string[] | undefined;
  activeTool?: string | undefined;
  lastActiveMs: number;
}

export interface CrdtUndoEntry {
  kind: "tile" | "wire" | "frame" | "comment";
  id: string;
  before: unknown;
  after: unknown;
}

export function compareStamps(a: CrdtStamp, b: CrdtStamp): number {
  if (a.clock !== b.clock) return a.clock - b.clock;
  if (a.peerId === b.peerId) return 0;
  return a.peerId < b.peerId ? -1 : 1;
}

/**
 * Merges two concurrent versions of a comment thread without losing replies:
 * takes the newer LWW register for text/resolved/position, and performs a
 * deterministic set-union over `replies` ordered by `(createdAt, id)`.
 */
function mergeCommentThreadValues(
  local: CanvasCommentThread,
  incoming: CanvasCommentThread,
  incomingWins: boolean,
): CanvasCommentThread {
  const winner = incomingWins ? incoming : local;
  const replyMap = new Map<string, CanvasCommentReply>();
  for (const r of local.replies) replyMap.set(r.id, structuredClone(r));
  for (const r of incoming.replies) {
    if (!replyMap.has(r.id) || incomingWins) {
      replyMap.set(r.id, structuredClone(r));
    }
  }
  const mergedReplies = Array.from(replyMap.values()).sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return {
    ...structuredClone(winner),
    replies: mergedReplies,
  };
}

/**
 * Conflict-free LWW-Element-Map CRDT store with causal comment reply union and
 * per-user Yjs-style `undo()`/`redo()` isolation for multiplayer Polyglot Spatial Canvases.
 * Guarantees strong eventual consistency (commutative, associative, idempotent merges)
 * across concurrent tile drags, FMI wiring, replies, deletions, and offline reconnects.
 */
export class CanvasCrdtStore {
  public readonly peerId: string;
  private clock = 0;
  private readonly docId: string;
  private readonly docName: string;
  private readonly createdAt: string;

  private readonly tiles = new Map<string, CrdtRegister<CanvasTile>>();
  private readonly frames = new Map<string, CrdtRegister<CanvasFrame>>();
  private readonly wires = new Map<string, CrdtRegister<CanvasWire>>();
  private readonly comments = new Map<string, CrdtRegister<CanvasCommentThread>>();
  private readonly peers = new Map<string, CanvasPeerPresence>();

  // Per-user undo/redo transaction stacks (isolated strictly to this peer's local mutations)
  private readonly undoStack: CrdtUndoEntry[][] = [];
  private readonly redoStack: CrdtUndoEntry[][] = [];
  private isApplyingUndoRedo = false;

  private readonly deltaListeners = new Set<(delta: CanvasCrdtDelta) => void>();
  private readonly changeListeners = new Set<() => void>();

  constructor(peerId: string, initialDoc?: CanvasDocument) {
    this.peerId = peerId;
    const base = initialDoc ?? createEmptyCanvasDocument("untitled-board", "Untitled Board");
    this.docId = base.id;
    this.docName = base.name;
    this.createdAt = base.metadata.createdAt;

    const initStamp: CrdtStamp = { clock: 0, peerId: "" };
    for (const [id, tile] of Object.entries(base.tiles)) {
      this.tiles.set(id, { value: structuredClone(tile), stamp: initStamp });
    }
    for (const [id, frame] of Object.entries(base.frames)) {
      this.frames.set(id, { value: structuredClone(frame), stamp: initStamp });
    }
    for (const [id, wire] of Object.entries(base.wires)) {
      this.wires.set(id, { value: structuredClone(wire), stamp: initStamp });
    }
    for (const [id, comment] of Object.entries(base.comments)) {
      this.comments.set(id, { value: structuredClone(comment), stamp: initStamp });
    }
  }

  public onLocalDelta(listener: (delta: CanvasCrdtDelta) => void): () => void {
    this.deltaListeners.add(listener);
    return () => {
      this.deltaListeners.delete(listener);
    };
  }

  public onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  private nextStamp(): CrdtStamp {
    this.clock += 1;
    return { clock: this.clock, peerId: this.peerId };
  }

  private recordUndoTransaction(entries: CrdtUndoEntry[]): void {
    if (this.isApplyingUndoRedo || entries.length === 0) return;
    this.undoStack.push(entries);
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * Per-user CRDT undo: reverts ONLY this peer's most recent local mutation by
   * issuing a fresh higher-Lamport-clock CRDT delta, leaving concurrent remote peer edits intact.
   */
  public undo(): CanvasCrdtDelta | null {
    const tx = this.undoStack.pop();
    if (!tx || tx.length === 0) return null;
    this.isApplyingUndoRedo = true;
    try {
      const delta = this.applyUndoEntries(tx, "before");
      this.redoStack.push(tx);
      this.emitDelta(delta);
      return delta;
    } finally {
      this.isApplyingUndoRedo = false;
    }
  }

  /** Per-user CRDT redo: re-applies this peer's most recently undone mutation with a fresh Lamport clock. */
  public redo(): CanvasCrdtDelta | null {
    const tx = this.redoStack.pop();
    if (!tx || tx.length === 0) return null;
    this.isApplyingUndoRedo = true;
    try {
      const delta = this.applyUndoEntries(tx, "after");
      this.undoStack.push(tx);
      this.emitDelta(delta);
      return delta;
    } finally {
      this.isApplyingUndoRedo = false;
    }
  }

  private applyUndoEntries(entries: CrdtUndoEntry[], side: "before" | "after"): CanvasCrdtDelta {
    const tiles: Record<string, CrdtRegister<CanvasTile>> = {};
    const wires: Record<string, CrdtRegister<CanvasWire>> = {};
    const frames: Record<string, CrdtRegister<CanvasFrame>> = {};
    const comments: Record<string, CrdtRegister<CanvasCommentThread>> = {};

    const ordered = side === "before" ? [...entries].reverse() : entries;
    for (const entry of ordered) {
      const val = side === "before" ? entry.before : entry.after;
      const cloned = val === null || val === undefined ? null : structuredClone(val);
      const stamp = this.nextStamp();
      if (entry.kind === "tile") {
        const reg: CrdtRegister<CanvasTile> = { value: cloned as CanvasTile | null, stamp };
        this.tiles.set(entry.id, reg);
        tiles[entry.id] = reg;
      } else if (entry.kind === "wire") {
        const reg: CrdtRegister<CanvasWire> = { value: cloned as CanvasWire | null, stamp };
        this.wires.set(entry.id, reg);
        wires[entry.id] = reg;
      } else if (entry.kind === "frame") {
        const reg: CrdtRegister<CanvasFrame> = { value: cloned as CanvasFrame | null, stamp };
        this.frames.set(entry.id, reg);
        frames[entry.id] = reg;
      } else {
        const reg: CrdtRegister<CanvasCommentThread> = { value: cloned as CanvasCommentThread | null, stamp };
        this.comments.set(entry.id, reg);
        comments[entry.id] = reg;
      }
    }

    return {
      originPeerId: this.peerId,
      tiles: Object.keys(tiles).length > 0 ? tiles : undefined,
      wires: Object.keys(wires).length > 0 ? wires : undefined,
      frames: Object.keys(frames).length > 0 ? frames : undefined,
      comments: Object.keys(comments).length > 0 ? comments : undefined,
    };
  }

  // ── Local CRDT Mutations ──

  public upsertTile(tile: CanvasTile): CanvasCrdtDelta {
    const prev = this.tiles.get(tile.id)?.value ?? null;
    const next = structuredClone(tile);
    const reg: CrdtRegister<CanvasTile> = { value: next, stamp: this.nextStamp() };
    this.tiles.set(tile.id, reg);
    this.recordUndoTransaction([
      { kind: "tile", id: tile.id, before: prev ? structuredClone(prev) : null, after: structuredClone(next) },
    ]);
    const delta: CanvasCrdtDelta = { originPeerId: this.peerId, tiles: { [tile.id]: reg } };
    this.emitDelta(delta);
    return delta;
  }

  public moveTile(tileId: string, x: number, y: number): CanvasCrdtDelta | null {
    const existing = this.tiles.get(tileId)?.value;
    if (!existing || existing.locked) return null;
    return this.upsertTile({
      ...existing,
      bounds: { ...existing.bounds, x, y },
    });
  }

  public resizeTile(tileId: string, width: number, height: number): CanvasCrdtDelta | null {
    const existing = this.tiles.get(tileId)?.value;
    if (!existing || existing.locked) return null;
    return this.upsertTile({
      ...existing,
      bounds: {
        ...existing.bounds,
        width: Math.max(180, width),
        height: Math.max(120, height),
      },
    });
  }

  /** Applies an updated CanvasDocument snapshot (e.g. from reactive parameter propagation) as a single CRDT delta. */
  public applyDocumentSnapshot(nextDoc: CanvasDocument): CanvasCrdtDelta {
    const tileDeltas: Record<string, CrdtRegister<CanvasTile>> = {};
    const wireDeltas: Record<string, CrdtRegister<CanvasWire>> = {};
    const txEntries: CrdtUndoEntry[] = [];
    for (const [id, tile] of Object.entries(nextDoc.tiles)) {
      const prev = this.tiles.get(id)?.value ?? null;
      const next = structuredClone(tile);
      const reg: CrdtRegister<CanvasTile> = { value: next, stamp: this.nextStamp() };
      this.tiles.set(id, reg);
      tileDeltas[id] = reg;
      txEntries.push({ kind: "tile", id, before: prev ? structuredClone(prev) : null, after: structuredClone(next) });
    }
    for (const [id, wire] of Object.entries(nextDoc.wires)) {
      const prev = this.wires.get(id)?.value ?? null;
      const next = structuredClone(wire);
      const reg: CrdtRegister<CanvasWire> = { value: next, stamp: this.nextStamp() };
      this.wires.set(id, reg);
      wireDeltas[id] = reg;
      txEntries.push({ kind: "wire", id, before: prev ? structuredClone(prev) : null, after: structuredClone(next) });
    }
    this.recordUndoTransaction(txEntries);
    const delta: CanvasCrdtDelta = {
      originPeerId: this.peerId,
      tiles: tileDeltas,
      wires: wireDeltas,
    };
    this.emitDelta(delta);
    return delta;
  }

  public deleteTile(tileId: string): CanvasCrdtDelta {
    const prevTile = this.tiles.get(tileId)?.value ?? null;
    const txEntries: CrdtUndoEntry[] = [
      { kind: "tile", id: tileId, before: prevTile ? structuredClone(prevTile) : null, after: null },
    ];
    const stamp = this.nextStamp();
    const tileReg: CrdtRegister<CanvasTile> = { value: null, stamp };
    this.tiles.set(tileId, tileReg);

    const wireDeltas: Record<string, CrdtRegister<CanvasWire>> = {};
    for (const [wireId, reg] of this.wires.entries()) {
      if (reg.value && (reg.value.source.tileId === tileId || reg.value.target.tileId === tileId)) {
        txEntries.push({ kind: "wire", id: wireId, before: structuredClone(reg.value), after: null });
        const wReg: CrdtRegister<CanvasWire> = { value: null, stamp: this.nextStamp() };
        this.wires.set(wireId, wReg);
        wireDeltas[wireId] = wReg;
      }
    }
    this.recordUndoTransaction(txEntries);

    const delta: CanvasCrdtDelta = {
      originPeerId: this.peerId,
      tiles: { [tileId]: tileReg },
      wires: Object.keys(wireDeltas).length > 0 ? wireDeltas : undefined,
    };
    this.emitDelta(delta);
    return delta;
  }

  public upsertWire(wire: CanvasWire): CanvasCrdtDelta {
    const prev = this.wires.get(wire.id)?.value ?? null;
    const next = structuredClone(wire);
    const reg: CrdtRegister<CanvasWire> = { value: next, stamp: this.nextStamp() };
    this.wires.set(wire.id, reg);
    this.recordUndoTransaction([
      { kind: "wire", id: wire.id, before: prev ? structuredClone(prev) : null, after: structuredClone(next) },
    ]);
    const delta: CanvasCrdtDelta = { originPeerId: this.peerId, wires: { [wire.id]: reg } };
    this.emitDelta(delta);
    return delta;
  }

  public deleteWire(wireId: string): CanvasCrdtDelta {
    const prev = this.wires.get(wireId)?.value ?? null;
    const reg: CrdtRegister<CanvasWire> = { value: null, stamp: this.nextStamp() };
    this.wires.set(wireId, reg);
    this.recordUndoTransaction([
      { kind: "wire", id: wireId, before: prev ? structuredClone(prev) : null, after: null },
    ]);
    const delta: CanvasCrdtDelta = { originPeerId: this.peerId, wires: { [wireId]: reg } };
    this.emitDelta(delta);
    return delta;
  }

  public upsertFrame(frame: CanvasFrame): CanvasCrdtDelta {
    const prev = this.frames.get(frame.id)?.value ?? null;
    const next = structuredClone(frame);
    const reg: CrdtRegister<CanvasFrame> = { value: next, stamp: this.nextStamp() };
    this.frames.set(frame.id, reg);
    this.recordUndoTransaction([
      { kind: "frame", id: frame.id, before: prev ? structuredClone(prev) : null, after: structuredClone(next) },
    ]);
    const delta: CanvasCrdtDelta = { originPeerId: this.peerId, frames: { [frame.id]: reg } };
    this.emitDelta(delta);
    return delta;
  }

  public upsertComment(comment: CanvasCommentThread): CanvasCrdtDelta {
    const prev = this.comments.get(comment.id)?.value ?? null;
    const next = prev ? mergeCommentThreadValues(prev, comment, true) : structuredClone(comment);
    const reg: CrdtRegister<CanvasCommentThread> = {
      value: next,
      stamp: this.nextStamp(),
    };
    this.comments.set(comment.id, reg);
    this.recordUndoTransaction([
      { kind: "comment", id: comment.id, before: prev ? structuredClone(prev) : null, after: structuredClone(next) },
    ]);
    const delta: CanvasCrdtDelta = { originPeerId: this.peerId, comments: { [comment.id]: reg } };
    this.emitDelta(delta);
    return delta;
  }

  /** Appends a reply to an existing comment thread using conflict-free reply union semantics. */
  public appendCommentReply(threadId: string, reply: CanvasCommentReply): CanvasCrdtDelta | null {
    const existing = this.comments.get(threadId)?.value;
    if (!existing) return null;
    return this.upsertComment({
      ...existing,
      replies: [...existing.replies.filter((r) => r.id !== reply.id), structuredClone(reply)],
    });
  }

  /** Marks a comment thread resolved or reopened. */
  public resolveCommentThread(threadId: string, resolved: boolean): CanvasCrdtDelta | null {
    const existing = this.comments.get(threadId)?.value;
    if (!existing) return null;
    return this.upsertComment({
      ...existing,
      resolved,
    });
  }

  // ── Remote CRDT Merge (Commutative, Associative, Idempotent) ──

  public mergeDelta(delta: CanvasCrdtDelta): boolean {
    let changed = false;
    if (delta.tiles) changed = this.mergeMap(this.tiles, delta.tiles) || changed;
    if (delta.frames) changed = this.mergeMap(this.frames, delta.frames) || changed;
    if (delta.wires) changed = this.mergeMap(this.wires, delta.wires) || changed;
    if (delta.comments) changed = this.mergeCommentsMap(delta.comments) || changed;
    if (changed) {
      for (const listener of this.changeListeners) {
        listener();
      }
    }
    return changed;
  }

  /** Exports the full CRDT state as a single delta for late-joining peers. */
  public exportFullDelta(): CanvasCrdtDelta {
    return {
      originPeerId: this.peerId,
      tiles: Object.fromEntries(this.tiles.entries()),
      frames: Object.fromEntries(this.frames.entries()),
      wires: Object.fromEntries(this.wires.entries()),
      comments: Object.fromEntries(this.comments.entries()),
    };
  }

  /** Materializes the current CRDT registers into a clean CanvasDocument snapshot. */
  public toDocument(): CanvasDocument {
    const doc = createEmptyCanvasDocument(this.docId, this.docName, this.createdAt);
    for (const [id, reg] of this.frames.entries()) {
      if (reg.value) doc.frames[id] = structuredClone(reg.value);
    }
    for (const [id, reg] of this.tiles.entries()) {
      if (reg.value) doc.tiles[id] = structuredClone(reg.value);
    }
    for (const [id, reg] of this.wires.entries()) {
      if (reg.value && doc.tiles[reg.value.source.tileId] && doc.tiles[reg.value.target.tileId]) {
        doc.wires[id] = structuredClone(reg.value);
      }
    }
    for (const [id, reg] of this.comments.entries()) {
      if (reg.value) doc.comments[id] = structuredClone(reg.value);
    }
    return doc;
  }

  // ── Ephemeral Multiplayer Presence & Soft Locks ──

  public updatePeerPresence(presence: CanvasPeerPresence): void {
    if (presence.peerId === this.peerId) return;
    this.peers.set(presence.peerId, { ...presence });
    for (const listener of this.changeListeners) {
      listener();
    }
  }

  public removePeer(peerId: string): void {
    if (this.peers.delete(peerId)) {
      for (const listener of this.changeListeners) {
        listener();
      }
    }
  }

  public getActivePeers(nowMs = Date.now(), timeoutMs = 15000): CanvasPeerPresence[] {
    const active: CanvasPeerPresence[] = [];
    for (const peer of this.peers.values()) {
      if (nowMs - peer.lastActiveMs <= timeoutMs) {
        active.push(peer);
      }
    }
    return active;
  }

  /** Returns the peer currently holding a soft selection lock on a tile, if any. */
  public getTileLockOwner(tileId: string, nowMs = Date.now()): CanvasPeerPresence | undefined {
    for (const peer of this.getActivePeers(nowMs)) {
      if (peer.selection?.includes(tileId)) {
        return peer;
      }
    }
    return undefined;
  }

  private mergeCommentsMap(incoming: Record<string, CrdtRegister<CanvasCommentThread>>): boolean {
    let changed = false;
    for (const [id, incReg] of Object.entries(incoming)) {
      if (incReg.stamp.clock > this.clock) {
        this.clock = incReg.stamp.clock;
      }
      const localReg = this.comments.get(id);
      if (!localReg) {
        this.comments.set(id, structuredClone(incReg));
        changed = true;
        continue;
      }
      const cmp = compareStamps(incReg.stamp, localReg.stamp);
      if (localReg.value && incReg.value) {
        const merged = mergeCommentThreadValues(localReg.value, incReg.value, cmp > 0);
        const winningStamp = cmp > 0 ? incReg.stamp : localReg.stamp;
        const replyCountChanged = merged.replies.length !== localReg.value.replies.length;
        if (cmp > 0 || replyCountChanged) {
          this.comments.set(id, { value: merged, stamp: winningStamp });
          changed = true;
        }
      } else if (cmp > 0) {
        this.comments.set(id, structuredClone(incReg));
        changed = true;
      }
    }
    return changed;
  }

  private mergeMap<T>(target: Map<string, CrdtRegister<T>>, incoming: Record<string, CrdtRegister<T>>): boolean {
    let changed = false;
    for (const [id, incReg] of Object.entries(incoming)) {
      if (incReg.stamp.clock > this.clock) {
        this.clock = incReg.stamp.clock;
      }
      const localReg = target.get(id);
      if (!localReg || compareStamps(incReg.stamp, localReg.stamp) > 0) {
        target.set(id, structuredClone(incReg));
        changed = true;
      }
    }
    return changed;
  }

  private emitDelta(delta: CanvasCrdtDelta): void {
    for (const listener of this.deltaListeners) {
      listener(delta);
    }
    for (const listener of this.changeListeners) {
      listener();
    }
  }
}
