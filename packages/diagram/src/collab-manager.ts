// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  CollabMessage,
  DiagramComment,
  PeerPresence,
  PlacementItem,
  SelectionLock,
  SpatialDelta,
} from "./protocol.js";

export interface CollabManagerOptions {
  peerId: string;
  userName: string;
  userColor?: string;
  heartbeatTimeoutMs?: number;
  onBroadcast?: (message: CollabMessage) => void;
  onStateChange?: () => void;
}

const DEFAULT_COLORS = ["#4ec9b0", "#007acc", "#ba68c8", "#ff9800", "#f14c4c", "#4fc1ff", "#ce9178", "#9cdcfe"];

/**
 * Manages peer presence, real-time spatial deltas, selection locks, and comments
 * for collaborative multi-user diagramming.
 */
export class CollabManager {
  public readonly peerId: string;
  public readonly userName: string;
  public readonly userColor: string;

  private peers = new Map<string, PeerPresence>();
  private locks = new Map<string, SelectionLock>(); // componentName -> lock
  private comments = new Map<string, DiagramComment>(); // commentId -> comment
  private componentOverrides = new Map<string, { item: PlacementItem; timestamp: number }>();

  private heartbeatTimeoutMs: number;
  private onBroadcast?: (message: CollabMessage) => void;
  private onStateChange?: () => void;
  private cleanupInterval?: ReturnType<typeof setInterval>;

  constructor(options: CollabManagerOptions) {
    this.peerId = options.peerId;
    this.userName = options.userName;
    this.userColor = options.userColor ?? DEFAULT_COLORS[Math.floor(Math.random() * DEFAULT_COLORS.length)]!;
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 10000;
    this.onBroadcast = options.onBroadcast;
    this.onStateChange = options.onStateChange;

    // Periodic cleanup of disconnected peers
    this.cleanupInterval = setInterval(() => {
      this.purgeStalePeers();
    }, 2000);
  }

  public dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    this.broadcast({ type: "peerLeave", peerId: this.peerId });
  }

  // ── Local User Actions ──

  /** Update local cursor position and viewport, then broadcast presence */
  public updateLocalPresence(params: {
    cursor?: { x: number; y: number };
    selection?: string[];
    viewport?: { x: number; y: number; zoom: number };
  }): void {
    const presence: PeerPresence = {
      peerId: this.peerId,
      name: this.userName,
      color: this.userColor,
      cursor: params.cursor,
      selection: params.selection,
      viewport: params.viewport,
      lastActive: Date.now(),
    };

    // If selection changed, update local selection locks
    if (params.selection) {
      this.setLocalSelection(params.selection);
    }

    this.broadcast({ type: "presence", presence });
  }

  /** Broadcast real-time spatial dragging deltas (60fps stream before commit) */
  public broadcastSpatialDelta(items: PlacementItem[]): void {
    const delta: SpatialDelta = {
      peerId: this.peerId,
      items,
      timestamp: Date.now(),
    };

    // Apply locally
    for (const item of items) {
      this.componentOverrides.set(item.name, { item, timestamp: delta.timestamp });
    }

    this.broadcast({ type: "spatialDelta", delta });
  }

  /** Add or update a visual sticky note comment */
  public addComment(text: string, x: number, y: number): DiagramComment {
    const comment: DiagramComment = {
      id: `comment_${this.peerId}_${Date.now()}`,
      peerId: this.peerId,
      authorName: this.userName,
      x,
      y,
      text,
      timestamp: Date.now(),
      resolved: false,
    };
    this.comments.set(comment.id, comment);
    this.broadcast({ type: "comment", comment });
    this.notifyStateChange();
    return comment;
  }

  /** Resolve or delete a sticky comment */
  public resolveComment(commentId: string): void {
    const existing = this.comments.get(commentId);
    if (existing) {
      existing.resolved = true;
      this.broadcast({ type: "comment", comment: existing });
      this.notifyStateChange();
    }
  }

  // ── Inbound Message Handling (from Live Share or WebSocket) ──

  public handleInboundMessage(message: CollabMessage): void {
    if ("peerId" in message && message.peerId === this.peerId) return;

    switch (message.type) {
      case "presence": {
        const p = message.presence;
        if (p.peerId !== this.peerId) {
          p.lastActive = Date.now();
          this.peers.set(p.peerId, p);
          this.notifyStateChange();
        }
        break;
      }

      case "spatialDelta": {
        const d = message.delta;
        if (d.peerId !== this.peerId) {
          for (const item of d.items) {
            const existing = this.componentOverrides.get(item.name);
            // Last-Write-Wins (LWW) conflict resolution
            if (!existing || d.timestamp >= existing.timestamp) {
              this.componentOverrides.set(item.name, { item, timestamp: d.timestamp });
            }
          }
          this.notifyStateChange();
        }
        break;
      }

      case "selectionLock": {
        const l = message.lock;
        if (l.peerId !== this.peerId) {
          // Release prior locks held by this peer
          for (const [comp, currentLock] of this.locks.entries()) {
            if (currentLock.peerId === l.peerId) {
              this.locks.delete(comp);
            }
          }
          // Set new locks
          for (const comp of l.componentNames) {
            this.locks.set(comp, l);
          }
          this.notifyStateChange();
        }
        break;
      }

      case "comment": {
        this.comments.set(message.comment.id, message.comment);
        this.notifyStateChange();
        break;
      }

      case "peerLeave": {
        this.removePeer(message.peerId);
        break;
      }
    }
  }

  // ── Queries & State Inspection ──

  public getActivePeers(): PeerPresence[] {
    return Array.from(this.peers.values());
  }

  public getComponentLock(componentName: string): SelectionLock | undefined {
    return this.locks.get(componentName);
  }

  public getComponentOverride(componentName: string): PlacementItem | undefined {
    return this.componentOverrides.get(componentName)?.item;
  }

  public getAllComments(): DiagramComment[] {
    return Array.from(this.comments.values()).filter((c) => !c.resolved);
  }

  // ── Internal Helpers ──

  private setLocalSelection(selectedNames: string[]): void {
    const lock: SelectionLock = {
      peerId: this.peerId,
      peerName: this.userName,
      color: this.userColor,
      componentNames: selectedNames,
      timestamp: Date.now(),
    };

    // Remove local prior locks
    for (const [comp, currentLock] of this.locks.entries()) {
      if (currentLock.peerId === this.peerId) {
        this.locks.delete(comp);
      }
    }
    for (const comp of selectedNames) {
      this.locks.set(comp, lock);
    }

    this.broadcast({ type: "selectionLock", lock });
  }

  private purgeStalePeers(): void {
    const now = Date.now();
    let changed = false;

    for (const [id, peer] of this.peers.entries()) {
      if (now - peer.lastActive > this.heartbeatTimeoutMs) {
        this.removePeer(id);
        changed = true;
      }
    }

    if (changed) {
      this.notifyStateChange();
    }
  }

  private removePeer(peerId: string): void {
    this.peers.delete(peerId);
    for (const [comp, lock] of this.locks.entries()) {
      if (lock.peerId === peerId) {
        this.locks.delete(comp);
      }
    }
    this.notifyStateChange();
  }

  private broadcast(message: CollabMessage): void {
    this.onBroadcast?.(message);
  }

  private notifyStateChange(): void {
    this.onStateChange?.();
  }
}
