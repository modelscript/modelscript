// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WebSocket Co-Editing & Presence Synchronization Hub (`/api/v1/collab/stream`).
 *
 * Coordinates real-time multi-user document editing rooms, Lamport-clocked
 * operational text splicing, live peer cursor/selection presence, and
 * symbol-granularity concurrent edit collision notifications.
 */

import type { IncomingMessage, Server } from "node:http";
import { WebSocketServer, type WebSocket as WsWebSocket } from "ws";
import { checkCollabSessionEntitlement } from "../ee-loader.js";

export interface CollabPeerState {
  peerId: string;
  displayName: string;
  color: string;
  documentUri: string;
  cursorOffset: number;
  selectionEndOffset: number;
  line?: number | undefined;
  column?: number | undefined;
  activeSymbolName?: string | undefined;
  lastUpdated: number;
}

export interface CollabSymbolSpan {
  name: string;
  kind: string;
  startOffset: number;
  endOffset: number;
}

export interface CollabTextOperation {
  id: string;
  peerId: string;
  baseVersion: number;
  startOffset: number;
  endOffset: number;
  insertText: string;
  transformedStartOffset: number;
  transformedEndOffset: number;
  resultingVersion: number;
}

interface CollabRoom {
  documentUri: string;
  content: string;
  version: number;
  peers: Map<string, CollabPeerState>;
  sockets: Map<string, WsWebSocket>;
  opLog: CollabTextOperation[];
  symbolSpans: CollabSymbolSpan[];
}

const PEER_COLORS = ["#38bdf8", "#f472b6", "#34d399", "#fbbf24", "#a78bfa", "#fb7185", "#2dd4bf", "#f97316"];

function findSymbolAtOffset(spans: CollabSymbolSpan[], offset: number): CollabSymbolSpan | undefined {
  let best: CollabSymbolSpan | undefined;
  for (const s of spans) {
    if (offset >= s.startOffset && offset <= s.endOffset) {
      if (!best || s.endOffset - s.startOffset <= best.endOffset - best.startOffset) {
        best = s;
      }
    }
  }
  return best;
}

function computeCollisions(room: CollabRoom) {
  const collisions: {
    symbolName: string;
    symbolKind: string;
    startOffset: number;
    endOffset: number;
    peers: { peerId: string; displayName: string; color: string }[];
    message: string;
  }[] = [];

  for (const span of room.symbolSpans) {
    const activePeers: { peerId: string; displayName: string; color: string }[] = [];
    for (const peer of room.peers.values()) {
      if (peer.activeSymbolName === span.name) {
        activePeers.push({
          peerId: peer.peerId,
          displayName: peer.displayName,
          color: peer.color,
        });
      }
    }
    if (activePeers.length >= 2) {
      collisions.push({
        symbolName: span.name,
        symbolKind: span.kind,
        startOffset: span.startOffset,
        endOffset: span.endOffset,
        peers: activePeers,
        message: `Concurrent editing on ${span.kind} '${span.name}' by ${activePeers.map((p) => p.displayName).join(", ")}.`,
      });
    }
  }
  return collisions;
}

function sendJson(ws: WsWebSocket, payload: unknown): void {
  if (ws.readyState !== 1) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    // Ignore errors on closing sockets
  }
}

function broadcastToRoom(room: CollabRoom, payload: unknown, excludePeerId?: string): void {
  for (const [peerId, sock] of room.sockets.entries()) {
    if (excludePeerId && peerId === excludePeerId) continue;
    sendJson(sock, payload);
  }
}

const MAX_ROOMS = 200;
const MAX_PEERS_PER_ROOM = 50;
const MAX_DOC_BYTES = 2 * 1024 * 1024;
const MAX_SYMBOL_SPANS = 2000;

export function attachCollabWebSocket(server: Server, path = "/api/v1/collab/stream"): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  const rooms = new Map<string, CollabRoom>();

  function getOrCreateRoom(documentUri: string, initialContent = ""): CollabRoom | null {
    let room = rooms.get(documentUri);
    if (!room) {
      if (rooms.size >= MAX_ROOMS) {
        return null;
      }
      room = {
        documentUri,
        content: initialContent.slice(0, MAX_DOC_BYTES),
        version: 0,
        peers: new Map(),
        sockets: new Map(),
        opLog: [],
        symbolSpans: [],
      };
      rooms.set(documentUri, room);
    }
    return room;
  }

  wss.on("connection", (ws: WsWebSocket, _req: IncomingMessage) => {
    let joinedRoomUri: string | null = null;
    let joinedPeerId: string | null = null;

    ws.on("message", (raw: Buffer | string) => {
      let msg: {
        type?: string | undefined;
        documentUri?: string | undefined;
        peerId?: string | undefined;
        displayName?: string | undefined;
        initialContent?: string | undefined;
        symbolSpans?: CollabSymbolSpan[] | undefined;
        color?: string | undefined;
        cursorOffset?: number | undefined;
        selectionEndOffset?: number | undefined;
        line?: number | undefined;
        column?: number | undefined;
        baseVersion?: number | undefined;
        startOffset?: number | undefined;
        endOffset?: number | undefined;
        insertText?: string | undefined;
        id?: string | undefined;
      };
      try {
        msg = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf-8"));
      } catch {
        sendJson(ws, { type: "error", message: "Invalid JSON payload" });
        return;
      }

      if (msg.type === "join") {
        const documentUri = String(msg.documentUri || "untitled:model.mo").slice(0, 512);
        const peerId = String(msg.peerId || `peer-${Math.random().toString(36).slice(2, 8)}`).slice(0, 128);
        const displayName = String(msg.displayName || peerId).slice(0, 128);
        const room = getOrCreateRoom(documentUri, typeof msg.initialContent === "string" ? msg.initialContent : "");
        if (!room) {
          sendJson(ws, { type: "error", message: "Maximum active collaboration rooms reached" });
          return;
        }
        if (!room.peers.has(peerId) && room.peers.size >= MAX_PEERS_PER_ROOM) {
          sendJson(ws, { type: "error", message: "Maximum peers per room reached" });
          return;
        }

        if (Array.isArray(msg.symbolSpans)) {
          room.symbolSpans = msg.symbolSpans.slice(0, MAX_SYMBOL_SPANS);
        }

        const color = String(msg.color || PEER_COLORS[room.peers.size % PEER_COLORS.length]);
        const cursorOffset = typeof msg.cursorOffset === "number" ? msg.cursorOffset : 0;
        const activeSymbol = findSymbolAtOffset(room.symbolSpans, cursorOffset);

        const peerState: CollabPeerState = {
          peerId,
          displayName,
          color,
          documentUri,
          cursorOffset,
          selectionEndOffset: typeof msg.selectionEndOffset === "number" ? msg.selectionEndOffset : cursorOffset,
          line: typeof msg.line === "number" ? msg.line : undefined,
          column: typeof msg.column === "number" ? msg.column : undefined,
          activeSymbolName: activeSymbol?.name,
          lastUpdated: Date.now(),
        };

        joinedRoomUri = documentUri;
        joinedPeerId = peerId;
        room.peers.set(peerId, peerState);
        room.sockets.set(peerId, ws);

        const collisions = computeCollisions(room);

        sendJson(ws, {
          type: "sync_state",
          documentUri,
          version: room.version,
          content: room.content,
          self: peerState,
          peers: Array.from(room.peers.values()),
          collisions,
        });

        broadcastToRoom(
          room,
          {
            type: "peer_joined",
            documentUri,
            peer: peerState,
            peers: Array.from(room.peers.values()),
            collisions,
          },
          peerId,
        );
        return;
      }

      if (!joinedRoomUri || !joinedPeerId) {
        sendJson(ws, { type: "error", message: "Must send 'join' message before collaborating" });
        return;
      }

      const room = rooms.get(joinedRoomUri);
      if (!room) return;

      if (msg.type === "symbol_spans" && Array.isArray(msg.symbolSpans)) {
        room.symbolSpans = msg.symbolSpans.slice(0, MAX_SYMBOL_SPANS);
        for (const p of room.peers.values()) {
          p.activeSymbolName = findSymbolAtOffset(room.symbolSpans, p.cursorOffset)?.name;
        }
        const collisions = computeCollisions(room);
        broadcastToRoom(room, {
          type: "symbol_collision",
          documentUri: room.documentUri,
          collisions,
        });
        return;
      }

      if (msg.type === "presence_update") {
        const peer = room.peers.get(joinedPeerId);
        if (!peer) return;

        peer.cursorOffset = Math.max(0, Math.min(Number(msg.cursorOffset ?? peer.cursorOffset), room.content.length));
        peer.selectionEndOffset = Math.max(
          0,
          Math.min(Number(msg.selectionEndOffset ?? peer.cursorOffset), room.content.length),
        );
        if (typeof msg.line === "number") peer.line = msg.line;
        if (typeof msg.column === "number") peer.column = msg.column;
        peer.activeSymbolName = findSymbolAtOffset(room.symbolSpans, peer.cursorOffset)?.name;
        peer.lastUpdated = Date.now();

        const collisions = computeCollisions(room);
        broadcastToRoom(
          room,
          {
            type: "presence_broadcast",
            documentUri: room.documentUri,
            peer,
            collisions,
          },
          joinedPeerId,
        );
        if (collisions.length > 0) {
          sendJson(ws, {
            type: "symbol_collision",
            documentUri: room.documentUri,
            collisions,
          });
        }
        return;
      }

      if (msg.type === "text_operation") {
        const baseVersion = typeof msg.baseVersion === "number" ? msg.baseVersion : room.version;
        let start = Number(msg.startOffset ?? 0);
        let end = Number(msg.endOffset ?? start);
        const insertText = String(msg.insertText ?? "");
        const opId = String(msg.id || `${joinedPeerId}-${room.version + 1}`);

        if (baseVersion < room.version) {
          for (const prior of room.opLog) {
            if (prior.resultingVersion <= baseVersion) continue;
            if (prior.id === opId) continue;
            const pStart = prior.transformedStartOffset;
            const pEnd = prior.transformedEndOffset;
            const pLen = prior.insertText.length;
            const pDelta = pLen - (pEnd - pStart);

            if (end < pStart || (end === pStart && start < pStart)) {
              continue;
            } else if (start > pEnd || (start === pEnd && (pStart < pEnd || joinedPeerId >= prior.peerId))) {
              start += pDelta;
              end += pDelta;
            } else if (start === pStart && end === pEnd && pStart === pEnd) {
              if (joinedPeerId >= prior.peerId) {
                start += pLen;
                end += pLen;
              }
            } else {
              const newPriorEnd = pStart + pLen;
              if (start >= pStart && start <= pEnd) start = newPriorEnd;
              else if (start > pEnd) start += pDelta;
              if (end >= pStart && end <= pEnd) end = newPriorEnd;
              else if (end > pEnd) end += pDelta;
              if (end < start) end = start;
            }
          }
        }

        start = Math.max(0, Math.min(start, room.content.length));
        end = Math.max(start, Math.min(end, room.content.length));
        const delta = insertText.length - (end - start);

        room.content = room.content.slice(0, start) + insertText + room.content.slice(end);
        room.version += 1;

        for (const span of room.symbolSpans) {
          if (start <= span.startOffset) {
            span.startOffset = Math.max(0, span.startOffset + delta);
            span.endOffset = Math.max(span.startOffset, span.endOffset + delta);
          } else if (start <= span.endOffset) {
            span.endOffset = Math.max(span.startOffset, span.endOffset + delta);
          }
        }

        for (const p of room.peers.values()) {
          if (p.peerId === joinedPeerId) {
            p.cursorOffset = start + insertText.length;
            p.selectionEndOffset = p.cursorOffset;
            p.lastUpdated = Date.now();
          } else {
            if (p.cursorOffset >= end) p.cursorOffset = Math.max(0, p.cursorOffset + delta);
            else if (p.cursorOffset > start) p.cursorOffset = start + insertText.length;
          }
          p.activeSymbolName = findSymbolAtOffset(room.symbolSpans, p.cursorOffset)?.name;
        }

        const appliedOp: CollabTextOperation = {
          id: opId,
          peerId: joinedPeerId,
          baseVersion,
          startOffset: Number(msg.startOffset ?? 0),
          endOffset: Number(msg.endOffset ?? start),
          insertText,
          transformedStartOffset: start,
          transformedEndOffset: end,
          resultingVersion: room.version,
        };

        room.opLog.push(appliedOp);
        if (room.opLog.length > 256) {
          room.opLog.splice(0, room.opLog.length - 256);
        }

        const collisions = computeCollisions(room);

        broadcastToRoom(room, {
          type: "operation_broadcast",
          documentUri: room.documentUri,
          version: room.version,
          operation: appliedOp,
          collisions,
        });
      }
    });

    const handleDisconnect = () => {
      if (joinedRoomUri && joinedPeerId) {
        const room = rooms.get(joinedRoomUri);
        if (room) {
          room.peers.delete(joinedPeerId);
          room.sockets.delete(joinedPeerId);
          broadcastToRoom(room, {
            type: "peer_left",
            documentUri: room.documentUri,
            peerId: joinedPeerId,
            peers: Array.from(room.peers.values()),
            collisions: computeCollisions(room),
          });
          if (room.peers.size === 0) {
            rooms.delete(joinedRoomUri);
          }
        }
      }
    };

    ws.on("close", handleDisconnect);
    ws.on("error", handleDisconnect);
  });

  server.on("upgrade", (req, socket, head) => {
    if (req.url?.startsWith(path)) {
      const entitlement = checkCollabSessionEntitlement();
      if (!entitlement.allowed) {
        const statusLine =
          entitlement.statusCode === 501
            ? "HTTP/1.1 501 Not Implemented"
            : entitlement.statusCode === 402
              ? "HTTP/1.1 402 Payment Required"
              : "HTTP/1.1 403 Forbidden";
        socket.write(
          `${statusLine}\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n${entitlement.reason ?? "Enterprise Edition Required"}\r\n`,
        );
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    }
  });

  activeWss = wss;
}

let activeWss: WebSocketServer | null = null;

export function broadcastBotTyping(event: {
  botId: number;
  botUsername: string;
  postId: number;
  status: "thinking" | "simulating" | "done" | "failed";
}): void {
  if (!activeWss) return;
  const message = JSON.stringify({
    type: "bot_typing",
    ...event,
    timestamp: new Date().toISOString(),
  });
  for (const client of activeWss.clients) {
    if (client.readyState === 1) {
      try {
        client.send(message);
      } catch {
        // Ignore dead socket
      }
    }
  }
}
