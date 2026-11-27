// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Spawns the LSP WebWorker and provides a typed protocol connection.
 *
 * Uses raw `vscode-languageserver-protocol/browser` — no `monaco-languageclient`
 * dependency. The connection is a standard JSON-RPC2 link over `postMessage`.
 */

import type { ProtocolConnection } from "vscode-languageserver-protocol/browser";
import type { EditorLspTransport } from "../../transport.js";
import { getCustomLspTransport } from "./lsp-transport";

export interface LspConnectionLike {
  sendRequest<R = unknown>(method: string, params?: unknown): Promise<R>;
  sendNotification(method: string, params?: unknown): void;
  onNotification<P = unknown>(method: string, handler: (params: P) => void): { dispose(): void };
  onRequest?<P = unknown, R = unknown>(method: string, handler: (params: P) => R): { dispose(): void };
  dispose?(): void;
}

function adaptTransportToConnection(transport: EditorLspTransport): LspConnectionLike {
  return {
    sendRequest: <R = unknown>(method: string, params?: unknown) => transport.sendRequest<R>(method, params),
    sendNotification: (method: string, params?: unknown) => transport.sendNotification(method, params),
    onNotification: <P = unknown>(method: string, handler: (params: P) => void) => {
      const sub = transport.onNotification?.(method, (params: unknown) => handler(params as P));
      if (typeof sub === "function") return { dispose: sub };
      return sub ?? { dispose: () => {} };
    },
    dispose: () => transport.dispose?.(),
  };
}

let connection: ProtocolConnection | null = null;
let worker: Worker | null = null;
let initPromise: Promise<ProtocolConnection> | null = null;
let hasEverConnected = false;
const reconnectListeners = new Set<(conn: ProtocolConnection) => void>();

/**
 * Subscribe to LSP worker reconnections after a crash or connection drop so callers
 * (such as `lsp-bridge.ts`) can replay open documents into the freshly spawned worker.
 */
export function onLspReconnect(listener: (conn: ProtocolConnection) => void): () => void {
  reconnectListeners.add(listener);
  return () => {
    reconnectListeners.delete(listener);
  };
}

function isDebugLsp(): boolean {
  return (
    typeof window !== "undefined" &&
    (("__DEBUG_LSP__" in window && Boolean(window.__DEBUG_LSP__)) ||
      window.localStorage?.getItem("DEBUG_LSP") === "true")
  );
}

/**
 * Start the LSP WebWorker and send `initialize` + `initialized`.
 * Resolves once the server has acknowledged `initialize`.
 *
 * If the worker is already running (or a custom `AnsatzLspTransport` is active),
 * the existing connection is returned.
 */
export async function startLsp(initialLanguageId?: string): Promise<LspConnectionLike> {
  const custom = getCustomLspTransport();
  if (custom) return adaptTransportToConnection(custom);
  if (connection) return connection;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const { BrowserMessageReader, BrowserMessageWriter, createProtocolConnection } =
      await import("vscode-languageserver-protocol/browser");

    const origin =
      (typeof globalThis.location !== "undefined" &&
        globalThis.location.origin &&
        globalThis.location.origin !== "null" &&
        globalThis.location.origin) ||
      (typeof globalThis.location !== "undefined" && globalThis.location.href) ||
      "http://localhost";

    const trySpawn = async (basePath: string, useEsm = true): Promise<ProtocolConnection> => {
      const workerPath = useEsm
        ? `${basePath}/server/dist/esm/browserServerMain.js`
        : `${basePath}/server/dist/browserServerMain.js`;
      const candidateWorker = new Worker(new URL(workerPath, origin), {
        name: "modelscript-lsp",
        ...(useEsm ? { type: "module" as const } : {}),
      });
      worker = candidateWorker;

      let rejectStartup: ((reason: Error) => void) | null = null;
      const startupErrorPromise = new Promise<never>((_resolve, reject) => {
        rejectStartup = reject;
      });

      candidateWorker.onerror = (err) => {
        if (rejectStartup) {
          const msg = err.message || `Failed to load LSP worker from ${basePath}`;
          rejectStartup(new Error(msg));
          return;
        }
        console.error("[lsp-worker] Worker onerror:", err.message, err.filename, err.lineno, err);
        connection = null;
        initPromise = null;
        worker = null;
      };
      candidateWorker.onmessageerror = (err) => {
        console.error("[lsp-worker] Worker onmessageerror:", err);
      };

      const reader = new BrowserMessageReader(candidateWorker);
      const writer = new BrowserMessageWriter(candidateWorker);
      const conn = createProtocolConnection(reader, writer);
      conn.onClose(() => {
        console.warn("[lsp-worker] Connection closed. Resetting connection handle.");
        connection = null;
        initPromise = null;
        worker = null;
      });
      conn.listen();

      conn.onRequest("window/workDoneProgress/create", () => null);
      conn.onNotification("$/progress", (params: unknown) => {
        if (isDebugLsp()) {
          console.debug("[LSP-progress]", params);
        }
      });
      conn.onNotification("window/showMessage", (params: { type?: number; message?: string } | null) => {
        if (!params) return;
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("modelscript:lsp-message", { detail: params }));
        }
        if (params.type === 1) {
          console.error(`[LSP-message] ${params.message}`);
        } else if (params.type === 2) {
          console.warn(`[LSP-message] ${params.message}`);
        } else if (isDebugLsp()) {
          console.debug(`[LSP-message] [type=${params.type}] ${params.message}`);
        }
      });
      conn.onNotification("window/logMessage", (params: { type?: number; message?: string }) => {
        if (params.type === 1) {
          console.error(`[LSP-server] ${params.message}`);
        } else if (params.type === 2) {
          console.warn(`[LSP-server] ${params.message}`);
        } else if (isDebugLsp()) {
          console.debug(`[LSP-server] [type=${params.type}] ${params.message}`);
        }
      });
      conn.onNotification("modelscript/status", (params: { state?: string; message?: string }) => {
        if (isDebugLsp()) {
          console.debug(`[LSP-status] state=${params.state} message=${params.message}`);
        }
      });

      if (isDebugLsp()) {
        console.debug("[lsp-worker] Connection listening. Sending initialize request...");
      }

      try {
        let initTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
        const initTimeoutPromise = new Promise<never>((_resolve, reject) => {
          initTimeoutHandle = setTimeout(() => {
            reject(new Error(`LSP worker initialize timed out after 25s (${workerPath})`));
          }, 25_000);
        });
        const initResponse = await Promise.race([
          conn.sendRequest("initialize", {
            processId: null,
            rootUri: null,
            capabilities: {
              textDocument: {
                publishDiagnostics: { relatedInformation: true },
                completion: {
                  completionItem: {
                    snippetSupport: true,
                    documentationFormat: ["markdown", "plaintext"],
                  },
                },
                hover: {
                  contentFormat: ["markdown", "plaintext"],
                },
                semanticTokens: {
                  requests: { full: true },
                  tokenTypes: [],
                  tokenModifiers: [],
                  formats: ["relative"],
                },
                formatting: {},
                rangeFormatting: {},
                colorProvider: {},
                signatureHelp: {
                  signatureInformation: {
                    documentationFormat: ["markdown", "plaintext"],
                    parameterInformation: { labelOffsetSupport: true },
                  },
                },
                documentSymbol: { hierarchicalDocumentSymbolSupport: true },
                codeLens: {},
                documentHighlight: {},
                codeAction: {},
                definition: {},
                typeDefinition: {},
                references: {},
                rename: { prepareSupport: true },
                inlayHint: {},
                foldingRange: {},
                selectionRange: {},
              },
              workspace: {
                symbol: {},
                configuration: true,
              },
              window: {
                workDoneProgress: true,
              },
            },
            initializationOptions: {
              extensionUri: origin.replace(/\/$/, "") + basePath,
              registryUrl: origin.replace(/\/$/, ""),
              useLocalMsl: true,
              lazyLoadParsers: true,
              initialLanguageId: initialLanguageId ?? "modelica",
              projectDependencies: (() => {
                const norm = (initialLanguageId || "modelica").toLowerCase();
                if (norm === "sysml" || norm === "sysml2") {
                  return [{ name: "SysML", version: "2026.3.0" }];
                }
                if (norm === "modelica" || norm === "modelscript") {
                  return [{ name: "Modelica", version: "4.1.0" }];
                }
                return [];
              })(),
            },
          }),
          startupErrorPromise,
          initTimeoutPromise,
        ]).finally(() => {
          if (initTimeoutHandle !== null) clearTimeout(initTimeoutHandle);
        });
        rejectStartup = null;
        if (isDebugLsp()) {
          console.debug("[lsp-worker] Initialize response received:", initResponse);
        }

        conn.sendNotification("initialized", {});
        connection = conn;
        if (hasEverConnected) {
          for (const listener of reconnectListeners) {
            try {
              listener(conn);
            } catch {
              // Ignore listener errors during reconnect replay
            }
          }
        }
        hasEverConnected = true;
        return conn;
      } catch (err) {
        rejectStartup = null;
        try {
          conn.dispose();
        } catch {
          // ignore
        }
        try {
          candidateWorker.terminate();
        } catch {
          // ignore
        }
        if (worker === candidateWorker) {
          worker = null;
        }
        throw err;
      }
    };

    try {
      return await trySpawn("/lsp", true);
    } catch {
      try {
        return await trySpawn("/lsp", false);
      } catch {
        return await trySpawn("/static/devextensions", false);
      }
    }
  })();

  try {
    return await initPromise;
  } catch (err) {
    initPromise = null;
    throw err;
  }
}

/** Returns the active connection, or null if not started. */
export function getLsp(): LspConnectionLike | null {
  const custom = getCustomLspTransport();
  if (custom) return adaptTransportToConnection(custom);
  return connection;
}

/**
 * Passes an OffscreenCanvas directly to the LSP worker via the side-channel.
 * This is used for Zero-Copy WebGPU visualization where the worker simulates and renders.
 */
export function passCanvasToLsp(canvas: HTMLCanvasElement | OffscreenCanvas, uri: string, className: string): void {
  if (!worker) {
    console.error("LSP Worker not running. Cannot pass canvas.");
    return;
  }
  const offscreen =
    typeof (canvas as HTMLCanvasElement).transferControlToOffscreen === "function"
      ? (canvas as HTMLCanvasElement).transferControlToOffscreen()
      : (canvas as OffscreenCanvas);
  worker.postMessage({ type: "START_ZERO_COPY", canvas: offscreen, uri, className }, [offscreen]);
}

/** Shut down the LSP worker gracefully. */
export async function stopLsp(): Promise<void> {
  if (connection) {
    try {
      await connection.sendRequest("shutdown");
      connection.sendNotification("exit");
    } catch {
      // ignore — worker may already be dead
    }
    connection.dispose();
    connection = null;
  }
  if (worker) {
    worker.terminate();
    worker = null;
  }
  initPromise = null;
}

if (typeof window !== "undefined") {
  window.addEventListener("START_ZERO_COPY_LSP", (e: Event) => {
    const detail = (e as CustomEvent<{ canvas?: OffscreenCanvas; uri?: string; className?: string }>).detail;
    if (detail && detail.canvas) {
      passCanvasToLsp(detail.canvas, detail.uri ?? "", detail.className ?? "");
    }
  });
}
