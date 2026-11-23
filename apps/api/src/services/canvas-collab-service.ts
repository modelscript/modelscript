// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CanvasCrdtStore,
  createCanonicalPolyglotDemoBoard,
  createEmptyCanvasDocument,
  deserializeCanvasDocument,
  exportCanvasToSspXml,
  serializeCanvasDocument,
  validateCanvasDocument,
  type CanvasDocument,
  type CanvasPeerPresence,
  type CanvasWsMessage,
} from "@modelscript/canvas";
import fs from "node:fs";
import type { IncomingMessage, Server } from "node:http";
import path from "node:path";
import { WebSocketServer, type WebSocket as WsWebSocket } from "ws";

export interface CanvasBoardSummary {
  id: string;
  name: string;
  tileCount: number;
  wireCount: number;
  activePeerCount: number;
  updatedAt: string;
}

interface CanvasRoom {
  boardId: string;
  store: CanvasCrdtStore;
  sockets: Map<string, WsWebSocket>;
}

/**
 * Manages live multiplayer Polyglot Infinite Spatial Canvas rooms backed by
 * `CanvasCrdtStore`, with optional durable `.mscanvas` directory persistence.
 */
export class CanvasRoomManager {
  private readonly rooms = new Map<string, CanvasRoom>();
  private readonly storageDir: string | null;

  constructor(options: { storageDir?: string | undefined } = {}) {
    if (options.storageDir) {
      this.storageDir = options.storageDir;
      fs.mkdirSync(this.storageDir, { recursive: true });
      for (const entry of fs.readdirSync(this.storageDir)) {
        if (!entry.endsWith(".mscanvas")) continue;
        try {
          const raw = fs.readFileSync(path.join(this.storageDir, entry), "utf8");
          const doc = deserializeCanvasDocument(raw);
          this.rooms.set(doc.id, {
            boardId: doc.id,
            store: new CanvasCrdtStore("server", doc),
            sockets: new Map(),
          });
        } catch {
          // Skip corrupt board files
        }
      }
    } else {
      this.storageDir = null;
    }

    // Seed the canonical 6-artifact polyglot demo board if not already persisted
    const demo = createCanonicalPolyglotDemoBoard();
    if (!this.rooms.has(demo.id)) {
      this.rooms.set(demo.id, {
        boardId: demo.id,
        store: new CanvasCrdtStore("server", demo),
        sockets: new Map(),
      });
      this.persistBoard(demo);
    }
  }

  public close(): void {
    // No open handles to close for atomic file persistence
  }

  private persistBoard(doc: CanvasDocument): void {
    if (!this.storageDir) return;
    const safeId = doc.id.replace(/[^a-zA-Z0-9._-]/g, "_");
    const targetPath = path.join(this.storageDir, `${safeId}.mscanvas`);
    const tmpPath = `${targetPath}.tmp`;
    fs.writeFileSync(tmpPath, serializeCanvasDocument(doc), "utf8");
    fs.renameSync(tmpPath, targetPath);
  }

  public listBoards(): CanvasBoardSummary[] {
    const list: CanvasBoardSummary[] = [];
    for (const room of this.rooms.values()) {
      const doc = room.store.toDocument();
      list.push({
        id: doc.id,
        name: doc.name,
        tileCount: Object.keys(doc.tiles).length,
        wireCount: Object.keys(doc.wires).length,
        activePeerCount: room.sockets.size,
        updatedAt: doc.metadata.updatedAt,
      });
    }
    return list;
  }

  public getOrCreateRoom(boardId: string, name?: string): CanvasRoom {
    let room = this.rooms.get(boardId);
    if (!room) {
      const doc = createEmptyCanvasDocument(boardId, name ?? boardId);
      room = {
        boardId,
        store: new CanvasCrdtStore("server", doc),
        sockets: new Map(),
      };
      this.rooms.set(boardId, room);
      this.persistBoard(doc);
    }
    return room;
  }

  public getBoard(boardId: string): CanvasDocument | null {
    const room = this.rooms.get(boardId);
    return room ? room.store.toDocument() : null;
  }

  public createBoard(params: { id: string; name: string; template?: "empty" | "demo" | undefined }): CanvasDocument {
    const doc =
      params.template === "demo"
        ? { ...createCanonicalPolyglotDemoBoard(), id: params.id, name: params.name }
        : createEmptyCanvasDocument(params.id, params.name);
    this.rooms.set(params.id, {
      boardId: params.id,
      store: new CanvasCrdtStore("server", doc),
      sockets: new Map(),
    });
    this.persistBoard(doc);
    return doc;
  }

  public replaceBoard(
    boardId: string,
    rawDoc: unknown,
  ): { ok: true; doc: CanvasDocument } | { ok: false; errors: string[] } {
    const issues = validateCanvasDocument(rawDoc);
    if (issues.length > 0) {
      return { ok: false, errors: issues.map((i) => `${i.path}: ${i.message}`) };
    }
    const doc = { ...(rawDoc as CanvasDocument), id: boardId };
    const existing = this.rooms.get(boardId);
    const store = new CanvasCrdtStore("server", doc);
    if (existing) {
      existing.store = store;
      const syncMsg: CanvasWsMessage = {
        type: "full_sync",
        boardId,
        delta: store.exportFullDelta(),
        peers: store.getActivePeers(),
      };
      this.broadcast(existing, syncMsg);
    } else {
      this.rooms.set(boardId, { boardId, store, sockets: new Map() });
    }
    this.persistBoard(doc);
    return { ok: true, doc };
  }

  public exportBoardSsp(boardId: string): string | null {
    const doc = this.getBoard(boardId);
    return doc ? exportCanvasToSspXml(doc) : null;
  }

  public handleSocketConnection(ws: WsWebSocket): void {
    let joinedBoardId: string | null = null;
    let joinedPeerId: string | null = null;

    ws.on("message", (raw: Buffer | string) => {
      try {
        const text = typeof raw === "string" ? raw : raw.toString("utf8");
        const msg = JSON.parse(text) as CanvasWsMessage;
        if (!msg || typeof msg.type !== "string" || typeof msg.boardId !== "string") return;

        const room = this.getOrCreateRoom(msg.boardId);

        switch (msg.type) {
          case "join": {
            joinedBoardId = msg.boardId;
            joinedPeerId = msg.peerId;
            room.sockets.set(msg.peerId, ws);

            const peerPresence: CanvasPeerPresence = {
              peerId: msg.peerId,
              userName: msg.userName,
              color: msg.color ?? "#38bdf8",
              lastActiveMs: Date.now(),
            };
            room.store.updatePeerPresence(peerPresence);

            // Send full CRDT state to the joining peer
            const syncMsg: CanvasWsMessage = {
              type: "full_sync",
              boardId: msg.boardId,
              delta: room.store.exportFullDelta(),
              peers: room.store.getActivePeers(),
            };
            if (ws.readyState === 1) {
              ws.send(JSON.stringify(syncMsg));
            }
            // Announce join to other peers
            this.broadcast(room, { type: "presence", boardId: msg.boardId, presence: peerPresence }, msg.peerId);
            break;
          }

          case "delta": {
            room.store.mergeDelta(msg.delta);
            this.persistBoard(room.store.toDocument());
            this.broadcast(room, msg, msg.delta.originPeerId);
            break;
          }

          case "presence": {
            room.store.updatePeerPresence(msg.presence);
            this.broadcast(room, msg, msg.presence.peerId);
            break;
          }

          case "peer_leave": {
            room.sockets.delete(msg.peerId);
            room.store.removePeer(msg.peerId);
            this.broadcast(room, msg, msg.peerId);
            break;
          }

          case "full_sync":
            break;
        }
      } catch {
        // Ignore malformed client frames
      }
    });

    ws.on("close", () => {
      if (joinedBoardId && joinedPeerId) {
        const room = this.rooms.get(joinedBoardId);
        if (room) {
          room.sockets.delete(joinedPeerId);
          room.store.removePeer(joinedPeerId);
          this.broadcast(room, {
            type: "peer_leave",
            boardId: joinedBoardId,
            peerId: joinedPeerId,
          });
        }
      }
    });
  }

  private broadcast(room: CanvasRoom, msg: CanvasWsMessage, excludePeerId?: string): void {
    const payload = JSON.stringify(msg);
    for (const [peerId, sock] of room.sockets.entries()) {
      if (excludePeerId && peerId === excludePeerId) continue;
      if (sock.readyState === 1) {
        try {
          sock.send(payload);
        } catch {
          // Ignore dead socket
        }
      }
    }
  }
}

const defaultStorageDir =
  process.env["CANVAS_STORAGE_DIR"] ??
  (process.env["NODE_ENV"] === "test" ? undefined : path.join(process.cwd(), "data", "canvas-boards"));

export const defaultCanvasRoomManager = new CanvasRoomManager({ storageDir: defaultStorageDir });

/**
 * Attaches the Polyglot Spatial Canvas multiplayer WebSocket gateway at `/api/v1/canvas/stream`.
 */
export function attachCanvasWebSocket(
  server: Server,
  manager: CanvasRoomManager = defaultCanvasRoomManager,
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws: WsWebSocket) => {
    manager.handleSocketConnection(ws);
  });

  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    const pathname = (req.url ?? "").split("?")[0];
    if (pathname === "/api/v1/canvas/stream") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    }
  });

  return wss;
}
