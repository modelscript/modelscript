// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Real-Time Multi-User Collaborative Co-Editing & Presence Service.
 *
 * Provides Lamport-clocked operational transformation (OT) for text splicing,
 * live peer cursor/selection presence tracking, and symbol-granularity
 * (`SymbolIndex` byte range) concurrent edit collision warnings.
 */

export interface PeerPresence {
  peerId: string;
  displayName: string;
  color: string;
  cursorOffset: number;
  selectionEndOffset: number;
  line?: number | undefined;
  column?: number | undefined;
  activeSymbolName?: string | undefined;
  lastUpdated: number;
}

export interface TextEditOperation {
  id: string;
  peerId: string;
  baseVersion: number;
  startOffset: number;
  endOffset: number;
  insertText: string;
  timestamp?: number | undefined;
}

export interface AppliedTextOperation extends TextEditOperation {
  transformedStartOffset: number;
  transformedEndOffset: number;
  resultingVersion: number;
  affectedSymbol?: string | undefined;
}

export interface SymbolSpan {
  name: string;
  kind: string;
  startByte: number;
  endByte: number;
}

export interface SymbolEditCollision {
  symbolName: string;
  symbolKind: string;
  startByte: number;
  endByte: number;
  peers: {
    peerId: string;
    displayName: string;
    color: string;
  }[];
  message: string;
}

export interface ApplyOperationResult {
  version: number;
  content: string;
  appliedOp: AppliedTextOperation;
  collisions: SymbolEditCollision[];
}

const PEER_PALETTE = [
  "#38bdf8", // Sky Blue
  "#f472b6", // Pink
  "#34d399", // Emerald
  "#fbbf24", // Amber
  "#a78bfa", // Violet
  "#fb7185", // Rose
  "#2dd4bf", // Teal
  "#f97316", // Orange
];

const MAX_OP_LOG_SIZE = 256;
const COLLISION_ACTIVE_WINDOW_MS = 30_000;

export class CollaborationDocumentSession {
  readonly documentUri: string;
  #content: string;
  #version: number = 0;
  #peers = new Map<string, PeerPresence>();
  #opLog: AppliedTextOperation[] = [];
  #symbolSpans: SymbolSpan[] = [];
  #recentSymbolEditors = new Map<string, Map<string, number>>(); // symbolName -> (peerId -> timestamp)

  constructor(documentUri: string, initialContent = "", initialVersion = 0) {
    this.documentUri = documentUri;
    this.#content = initialContent;
    this.#version = initialVersion;
  }

  get content(): string {
    return this.#content;
  }

  get version(): number {
    return this.#version;
  }

  getPeers(): PeerPresence[] {
    return Array.from(this.#peers.values());
  }

  getPeer(peerId: string): PeerPresence | undefined {
    return this.#peers.get(peerId);
  }

  getSymbolSpans(): SymbolSpan[] {
    return [...this.#symbolSpans];
  }

  /**
   * Registers symbol byte spans for semantic collision detection.
   */
  setSymbolSpans(spans: SymbolSpan[]): void {
    this.#symbolSpans = [...spans].sort((a, b) => a.startByte - b.startByte);
    for (const peer of this.#peers.values()) {
      peer.activeSymbolName = this.findContainingSymbol(peer.cursorOffset)?.name;
    }
  }

  /**
   * Extracts symbol byte spans from a ModelScript `SymbolIndex`-like structure.
   */
  updateSymbolSpansFromIndex(symbolIndex: {
    symbols: Map<number, { name: string; kind: string; startByte: number; endByte: number }>;
  }): void {
    const spans: SymbolSpan[] = [];
    for (const sym of symbolIndex.symbols.values()) {
      if (sym.name && typeof sym.startByte === "number" && typeof sym.endByte === "number") {
        spans.push({
          name: sym.name,
          kind: sym.kind,
          startByte: sym.startByte,
          endByte: sym.endByte,
        });
      }
    }
    this.setSymbolSpans(spans);
  }

  /**
   * Finds the most specific (smallest) symbol span containing the given byte/character offset.
   */
  findContainingSymbol(offset: number): SymbolSpan | undefined {
    let best: SymbolSpan | undefined;
    for (const span of this.#symbolSpans) {
      if (offset >= span.startByte && offset <= span.endByte) {
        if (!best || span.endByte - span.startByte <= best.endByte - best.startByte) {
          best = span;
        }
      }
    }
    return best;
  }

  /**
   * Joins or updates a peer in the document collaboration session.
   */
  joinPeer(params: {
    peerId: string;
    displayName: string;
    color?: string | undefined;
    cursorOffset?: number | undefined;
    selectionEndOffset?: number | undefined;
    line?: number | undefined;
    column?: number | undefined;
  }): PeerPresence {
    const existing = this.#peers.get(params.peerId);
    const colorIndex = this.#peers.size % PEER_PALETTE.length;
    const assignedColor = params.color || existing?.color || PEER_PALETTE[colorIndex]!;
    const cursorOffset = Math.max(
      0,
      Math.min(params.cursorOffset ?? existing?.cursorOffset ?? 0, this.#content.length),
    );
    const selectionEndOffset = Math.max(
      0,
      Math.min(params.selectionEndOffset ?? existing?.selectionEndOffset ?? cursorOffset, this.#content.length),
    );
    const activeSymbol = this.findContainingSymbol(cursorOffset);

    const presence: PeerPresence = {
      peerId: params.peerId,
      displayName: params.displayName,
      color: assignedColor,
      cursorOffset,
      selectionEndOffset,
      line: params.line ?? existing?.line,
      column: params.column ?? existing?.column,
      activeSymbolName: activeSymbol?.name,
      lastUpdated: Date.now(),
    };

    this.#peers.set(params.peerId, presence);
    return presence;
  }

  /**
   * Removes a peer from the session.
   */
  leavePeer(peerId: string): boolean {
    const existed = this.#peers.delete(peerId);
    for (const editors of this.#recentSymbolEditors.values()) {
      editors.delete(peerId);
    }
    return existed;
  }

  /**
   * Updates a peer's live cursor/selection presence and returns any active symbol collisions.
   */
  updatePresence(
    peerId: string,
    update: {
      cursorOffset: number;
      selectionEndOffset?: number | undefined;
      line?: number | undefined;
      column?: number | undefined;
    },
  ): { presence: PeerPresence; collisions: SymbolEditCollision[] } {
    let peer = this.#peers.get(peerId);
    if (!peer) {
      peer = this.joinPeer({
        peerId,
        displayName: peerId,
        cursorOffset: update.cursorOffset,
        selectionEndOffset: update.selectionEndOffset,
        line: update.line,
        column: update.column,
      });
    } else {
      peer.cursorOffset = Math.max(0, Math.min(update.cursorOffset, this.#content.length));
      peer.selectionEndOffset = Math.max(
        0,
        Math.min(update.selectionEndOffset ?? peer.cursorOffset, this.#content.length),
      );
      if (update.line !== undefined) peer.line = update.line;
      if (update.column !== undefined) peer.column = update.column;
      peer.activeSymbolName = this.findContainingSymbol(peer.cursorOffset)?.name;
      peer.lastUpdated = Date.now();
    }

    return {
      presence: { ...peer },
      collisions: this.detectSymbolCollisions(),
    };
  }

  /**
   * Transforms and applies a concurrent text edit operation against the document buffer.
   */
  applyOperation(op: TextEditOperation): ApplyOperationResult {
    let start = op.startOffset;
    let end = op.endOffset;

    // Operational Transformation against operations applied since op.baseVersion
    if (op.baseVersion < this.#version) {
      for (const prior of this.#opLog) {
        if (prior.resultingVersion <= op.baseVersion) continue;
        if (prior.id === op.id) continue;

        const pStart = prior.transformedStartOffset;
        const pEnd = prior.transformedEndOffset;
        const pLen = prior.insertText.length;
        const pDelta = pLen - (pEnd - pStart);

        if (end < pStart || (end === pStart && start < pStart)) {
          // Strictly before prior edit: no shift needed
          continue;
        } else if (start > pEnd || (start === pEnd && (pStart < pEnd || op.peerId >= prior.peerId))) {
          // At or after prior edit: shift by delta
          start += pDelta;
          end += pDelta;
        } else if (start === pStart && end === pEnd && pStart === pEnd) {
          // Concurrent point insertions at the exact same offset: deterministic tie-break by peerId
          if (op.peerId >= prior.peerId) {
            start += pLen;
            end += pLen;
          }
        } else {
          // Overlapping replacement ranges: clamp to post-edit boundaries
          const newPriorEnd = pStart + pLen;
          if (start >= pStart && start <= pEnd) {
            start = newPriorEnd;
          } else if (start > pEnd) {
            start += pDelta;
          }
          if (end >= pStart && end <= pEnd) {
            end = newPriorEnd;
          } else if (end > pEnd) {
            end += pDelta;
          }
          if (end < start) end = start;
        }
      }
    }

    start = Math.max(0, Math.min(start, this.#content.length));
    end = Math.max(start, Math.min(end, this.#content.length));

    const delta = op.insertText.length - (end - start);
    this.#content = this.#content.slice(0, start) + op.insertText + this.#content.slice(end);
    this.#version += 1;

    // Shift symbol spans
    for (const span of this.#symbolSpans) {
      if (start <= span.startByte) {
        span.startByte = Math.max(0, span.startByte + delta);
        span.endByte = Math.max(span.startByte, span.endByte + delta);
      } else if (start <= span.endByte) {
        span.endByte = Math.max(span.startByte, span.endByte + delta);
      }
    }

    // Shift peer cursors
    for (const peer of this.#peers.values()) {
      if (peer.peerId === op.peerId) {
        peer.cursorOffset = start + op.insertText.length;
        peer.selectionEndOffset = peer.cursorOffset;
        peer.lastUpdated = Date.now();
      } else {
        if (peer.cursorOffset >= end) {
          peer.cursorOffset = Math.max(0, peer.cursorOffset + delta);
        } else if (peer.cursorOffset > start) {
          peer.cursorOffset = start + op.insertText.length;
        }
        if (peer.selectionEndOffset >= end) {
          peer.selectionEndOffset = Math.max(0, peer.selectionEndOffset + delta);
        } else if (peer.selectionEndOffset > start) {
          peer.selectionEndOffset = start + op.insertText.length;
        }
      }
      peer.activeSymbolName = this.findContainingSymbol(peer.cursorOffset)?.name;
    }

    const containingSymbol = this.findContainingSymbol(start);
    const now = op.timestamp ?? Date.now();
    if (containingSymbol) {
      let editors = this.#recentSymbolEditors.get(containingSymbol.name);
      if (!editors) {
        editors = new Map();
        this.#recentSymbolEditors.set(containingSymbol.name, editors);
      }
      editors.set(op.peerId, now);
    }

    const appliedOp: AppliedTextOperation = {
      ...op,
      transformedStartOffset: start,
      transformedEndOffset: end,
      resultingVersion: this.#version,
      affectedSymbol: containingSymbol?.name,
    };

    this.#opLog.push(appliedOp);
    if (this.#opLog.length > MAX_OP_LOG_SIZE) {
      this.#opLog.splice(0, this.#opLog.length - MAX_OP_LOG_SIZE);
    }

    return {
      version: this.#version,
      content: this.#content,
      appliedOp,
      collisions: this.detectSymbolCollisions(now),
    };
  }

  /**
   * Detects symbols currently being edited or focused by 2 or more peers concurrently.
   */
  detectSymbolCollisions(now = Date.now()): SymbolEditCollision[] {
    const collisions: SymbolEditCollision[] = [];

    for (const span of this.#symbolSpans) {
      const involvedPeerIds = new Set<string>();

      // 1. Peers with active cursors inside this symbol span
      for (const peer of this.#peers.values()) {
        if (now - peer.lastUpdated <= COLLISION_ACTIVE_WINDOW_MS) {
          if (peer.activeSymbolName === span.name) {
            involvedPeerIds.add(peer.peerId);
          }
        }
      }

      // 2. Peers who recently edited this symbol span within the active window
      const recentEditors = this.#recentSymbolEditors.get(span.name);
      if (recentEditors) {
        for (const [pId, ts] of recentEditors.entries()) {
          if (now - ts <= COLLISION_ACTIVE_WINDOW_MS && this.#peers.has(pId)) {
            involvedPeerIds.add(pId);
          }
        }
      }

      if (involvedPeerIds.size >= 2) {
        const peers = Array.from(involvedPeerIds).map((pId) => {
          const p = this.#peers.get(pId);
          return {
            peerId: pId,
            displayName: p?.displayName || pId,
            color: p?.color || PEER_PALETTE[0]!,
          };
        });
        const names = peers.map((p) => p.displayName).join(", ");
        collisions.push({
          symbolName: span.name,
          symbolKind: span.kind,
          startByte: span.startByte,
          endByte: span.endByte,
          peers,
          message: `Concurrent editing on ${span.kind} '${span.name}' by ${names}.`,
        });
      }
    }

    return collisions;
  }
}

export class CollaborationSessionManager {
  #sessions = new Map<string, CollaborationDocumentSession>();

  getOrCreateSession(documentUri: string, initialContent = "", initialVersion = 0): CollaborationDocumentSession {
    let session = this.#sessions.get(documentUri);
    if (!session) {
      session = new CollaborationDocumentSession(documentUri, initialContent, initialVersion);
      this.#sessions.set(documentUri, session);
    }
    return session;
  }

  getSession(documentUri: string): CollaborationDocumentSession | undefined {
    return this.#sessions.get(documentUri);
  }

  deleteSession(documentUri: string): boolean {
    return this.#sessions.delete(documentUri);
  }

  listSessions(): CollaborationDocumentSession[] {
    return Array.from(this.#sessions.values());
  }
}
