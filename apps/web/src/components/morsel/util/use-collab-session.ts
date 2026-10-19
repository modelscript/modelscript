// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * React hook for real-time multi-user collaborative co-editing and presence synchronization.
 *
 * Connects to `/api/v1/collab/stream`, synchronizes Lamport-clocked text operations,
 * broadcasts live cursor/selection presence, and surfaces symbol-level edit collisions.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface CollabPeer {
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

export interface CollabSymbolCollision {
  symbolName: string;
  symbolKind: string;
  startOffset: number;
  endOffset: number;
  peers: { peerId: string; displayName: string; color: string }[];
  message: string;
}

export interface CollabRemoteOperation {
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

export interface UseCollabSessionOptions {
  documentUri: string;
  peerId?: string | undefined;
  displayName?: string | undefined;
  initialContent?: string | undefined;
  wsUrl?: string | undefined;
  enabled?: boolean | undefined;
  onRemoteOperation?: ((op: CollabRemoteOperation, resultingVersion: number) => void) | undefined;
  onInitialSync?: ((content: string, version: number) => void) | undefined;
}

export interface CollabSessionState {
  connected: boolean;
  version: number;
  selfPeer: CollabPeer | null;
  peers: CollabPeer[];
  collisions: CollabSymbolCollision[];
  updatePresence: (cursorOffset: number, selectionEndOffset?: number, line?: number, column?: number) => void;
  sendOperation: (startOffset: number, endOffset: number, insertText: string) => void;
  updateSymbolSpans: (spans: { name: string; kind: string; startOffset: number; endOffset: number }[]) => void;
}

export function useCollabSession(options: UseCollabSessionOptions): CollabSessionState {
  const [fallbackPeerId] = useState(() => `web-${Math.random().toString(36).slice(2, 8)}`);
  const {
    documentUri,
    peerId = fallbackPeerId,
    displayName = "Engineer",
    initialContent = "",
    wsUrl,
    enabled = true,
  } = options;

  const [connected, setConnected] = useState(false);
  const [version, setVersion] = useState(0);
  const [selfPeer, setSelfPeer] = useState<CollabPeer | null>(null);
  const [peers, setPeers] = useState<CollabPeer[]>([]);
  const [collisions, setCollisions] = useState<CollabSymbolCollision[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const versionRef = useRef(0);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof WebSocket === "undefined") {
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const endpoint = wsUrl || `${protocol}//${window.location.host}/api/v1/collab/stream`;
    const ws = new WebSocket(endpoint);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      ws.send(
        JSON.stringify({
          type: "join",
          documentUri,
          peerId,
          displayName,
          initialContent: optionsRef.current.initialContent ?? initialContent,
        }),
      );
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data));
        if (msg.type === "sync_state") {
          versionRef.current = msg.version;
          setVersion(msg.version);
          setSelfPeer(msg.self ?? null);
          setPeers(Array.isArray(msg.peers) ? msg.peers : []);
          setCollisions(Array.isArray(msg.collisions) ? msg.collisions : []);
          optionsRef.current.onInitialSync?.(msg.content, msg.version);
        } else if (msg.type === "peer_joined" || msg.type === "peer_left") {
          if (Array.isArray(msg.peers)) setPeers(msg.peers);
          if (Array.isArray(msg.collisions)) setCollisions(msg.collisions);
        } else if (msg.type === "presence_broadcast") {
          if (msg.peer) {
            setPeers((prev) => {
              const filtered = prev.filter((p) => p.peerId !== msg.peer.peerId);
              return [...filtered, msg.peer];
            });
          }
          if (Array.isArray(msg.collisions)) setCollisions(msg.collisions);
        } else if (msg.type === "symbol_collision") {
          if (Array.isArray(msg.collisions)) setCollisions(msg.collisions);
        } else if (msg.type === "operation_broadcast" && msg.operation) {
          versionRef.current = msg.version;
          setVersion(msg.version);
          if (Array.isArray(msg.collisions)) setCollisions(msg.collisions);
          if (msg.operation.peerId !== peerId) {
            optionsRef.current.onRemoteOperation?.(msg.operation, msg.version);
          }
        }
      } catch {
        // Ignore malformed WebSocket frames
      }
    };

    ws.onclose = () => {
      setConnected(false);
    };

    ws.onerror = () => {
      setConnected(false);
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [documentUri, peerId, displayName, wsUrl, enabled]);

  const updatePresence = useCallback(
    (cursorOffset: number, selectionEndOffset?: number, line?: number, column?: number) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(
        JSON.stringify({
          type: "presence_update",
          cursorOffset,
          selectionEndOffset: selectionEndOffset ?? cursorOffset,
          line,
          column,
        }),
      );
    },
    [],
  );

  const sendOperation = useCallback(
    (startOffset: number, endOffset: number, insertText: string) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(
        JSON.stringify({
          type: "text_operation",
          id: `${peerId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          baseVersion: versionRef.current,
          startOffset,
          endOffset,
          insertText,
        }),
      );
    },
    [peerId],
  );

  const updateSymbolSpans = useCallback(
    (spans: { name: string; kind: string; startOffset: number; endOffset: number }[]) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(
        JSON.stringify({
          type: "symbol_spans",
          symbolSpans: spans,
        }),
      );
    },
    [],
  );

  return {
    connected,
    version,
    selfPeer,
    peers,
    collisions,
    updatePresence,
    sendOperation,
    updateSymbolSpans,
  };
}
