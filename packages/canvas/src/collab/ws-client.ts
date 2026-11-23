// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CanvasCrdtDelta, CanvasCrdtStore, CanvasPeerPresence } from "./crdt-store.js";

export type CanvasWsMessage =
  | { type: "join"; boardId: string; peerId: string; userName: string; color?: string | undefined }
  | { type: "full_sync"; boardId: string; delta: CanvasCrdtDelta; peers: CanvasPeerPresence[] }
  | { type: "delta"; boardId: string; delta: CanvasCrdtDelta }
  | { type: "presence"; boardId: string; presence: CanvasPeerPresence }
  | { type: "peer_leave"; boardId: string; peerId: string };

export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: "open" | "close" | "error", listener: () => void): void;
  addEventListener(type: "message", listener: (ev: { data: string | ArrayBuffer | Blob }) => void): void;
}

export interface CanvasWsClientOptions {
  url: string;
  boardId: string;
  userName: string;
  color?: string | undefined;
  store: CanvasCrdtStore;
  createSocket?: ((url: string) => WebSocketLike) | undefined;
  onConnectionChange?: ((connected: boolean) => void) | undefined;
}

/**
 * Reconnecting WebSocket client binding a local `CanvasCrdtStore` to the
 * `/api/v1/canvas/stream` multiplayer room gateway. Queues local CRDT deltas
 * while offline and flushes them deterministically upon reconnect.
 */
export class CanvasWebSocketClient {
  private readonly url: string;
  private readonly boardId: string;
  private readonly userName: string;
  private readonly color: string;
  private readonly store: CanvasCrdtStore;
  private readonly createSocket: (url: string) => WebSocketLike;
  private readonly onConnectionChange?: ((connected: boolean) => void) | undefined;

  private socket: WebSocketLike | null = null;
  private connected = false;
  private disposed = false;
  private pendingDeltas: CanvasCrdtDelta[] = [];
  private unsubLocalDelta: (() => void) | null = null;

  constructor(options: CanvasWsClientOptions) {
    this.url = options.url;
    this.boardId = options.boardId;
    this.userName = options.userName;
    this.color = options.color ?? "#38bdf8";
    this.store = options.store;
    this.onConnectionChange = options.onConnectionChange;
    this.createSocket = options.createSocket ?? ((targetUrl) => new WebSocket(targetUrl) as unknown as WebSocketLike);

    this.unsubLocalDelta = this.store.onLocalDelta((delta) => {
      this.sendOrQueueDelta(delta);
    });
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public getPendingDeltaCount(): number {
    return this.pendingDeltas.length;
  }

  public connect(): void {
    if (this.disposed) return;
    const ws = this.createSocket(this.url);
    this.socket = ws;

    ws.addEventListener("open", () => {
      if (this.disposed) return;
      this.connected = true;
      this.onConnectionChange?.(true);

      this.rawSend({
        type: "join",
        boardId: this.boardId,
        peerId: this.store.peerId,
        userName: this.userName,
        color: this.color,
      });

      // Flush offline CRDT deltas
      const queued = this.pendingDeltas.splice(0, this.pendingDeltas.length);
      for (const delta of queued) {
        this.rawSend({ type: "delta", boardId: this.boardId, delta });
      }
    });

    ws.addEventListener("message", (ev) => {
      if (typeof ev.data !== "string") return;
      try {
        const msg = JSON.parse(ev.data) as CanvasWsMessage;
        this.handleMessage(msg);
      } catch {
        // Ignore malformed frames
      }
    });

    ws.addEventListener("close", () => {
      this.connected = false;
      this.onConnectionChange?.(false);
    });

    ws.addEventListener("error", () => {
      this.connected = false;
      this.onConnectionChange?.(false);
    });
  }

  public broadcastPresence(partial: Omit<CanvasPeerPresence, "peerId" | "userName" | "color" | "lastActiveMs">): void {
    if (!this.connected) return;
    const presence: CanvasPeerPresence = {
      peerId: this.store.peerId,
      userName: this.userName,
      color: this.color,
      ...partial,
      lastActiveMs: Date.now(),
    };
    this.rawSend({ type: "presence", boardId: this.boardId, presence });
  }

  public dispose(): void {
    this.disposed = true;
    this.unsubLocalDelta?.();
    this.unsubLocalDelta = null;
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.connected = false;
  }

  private sendOrQueueDelta(delta: CanvasCrdtDelta): void {
    if (this.connected && this.socket && this.socket.readyState === 1) {
      this.rawSend({ type: "delta", boardId: this.boardId, delta });
    } else {
      this.pendingDeltas.push(delta);
    }
  }

  private rawSend(msg: CanvasWsMessage): void {
    if (this.socket && this.socket.readyState === 1) {
      this.socket.send(JSON.stringify(msg));
    }
  }

  private handleMessage(msg: CanvasWsMessage): void {
    if (msg.boardId !== this.boardId) return;
    switch (msg.type) {
      case "full_sync": {
        this.store.mergeDelta(msg.delta);
        for (const peer of msg.peers) {
          this.store.updatePeerPresence(peer);
        }
        break;
      }
      case "delta": {
        if (msg.delta.originPeerId !== this.store.peerId) {
          this.store.mergeDelta(msg.delta);
        }
        break;
      }
      case "presence": {
        this.store.updatePeerPresence(msg.presence);
        break;
      }
      case "peer_leave": {
        this.store.removePeer(msg.peerId);
        break;
      }
      case "join":
        break;
    }
  }
}
