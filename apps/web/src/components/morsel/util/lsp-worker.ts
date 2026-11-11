// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Spawns the LSP WebWorker and provides a typed protocol connection.
 *
 * Uses raw `vscode-languageserver-protocol/browser` — no `monaco-languageclient`
 * dependency. The connection is a standard JSON-RPC2 link over `postMessage`.
 */

import type { ProtocolConnection } from "vscode-languageserver-protocol/browser";

let connection: ProtocolConnection | null = null;
let worker: Worker | null = null;
let initPromise: Promise<ProtocolConnection> | null = null;

function isDebugLsp(): boolean {
  return (
    typeof window !== "undefined" &&
    (Boolean((window as any).__DEBUG_LSP__) || window.localStorage?.getItem("DEBUG_LSP") === "true")
  );
}

/**
 * Start the LSP WebWorker and send `initialize` + `initialized`.
 * Resolves once the server has acknowledged `initialize`.
 *
 * If the worker is already running the existing connection is returned.
 */
export async function startLsp(initialLanguageId?: string): Promise<ProtocolConnection> {
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

    const trySpawn = async (basePath: string): Promise<ProtocolConnection> => {
      const candidateWorker = new Worker(
        new URL(`${basePath}/server/dist/browserServerMain.js?v=${Date.now()}`, origin),
        {
          name: "modelscript-lsp",
        },
      );
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

      conn.onNotification("window/logMessage", (params: any) => {
        if (params.type === 1) {
          console.error(`[LSP-server] ${params.message}`);
        } else if (params.type === 2) {
          console.warn(`[LSP-server] ${params.message}`);
        } else if (isDebugLsp()) {
          console.debug(`[LSP-server] [type=${params.type}] ${params.message}`);
        }
      });
      conn.onNotification("modelscript/status", (params: any) => {
        if (isDebugLsp()) {
          console.debug(`[LSP-status] state=${params.state} message=${params.message}`);
        }
      });

      if (isDebugLsp()) {
        console.debug("[lsp-worker] Connection listening. Sending initialize request...");
      }

      try {
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
        ]);
        rejectStartup = null;
        if (isDebugLsp()) {
          console.debug("[lsp-worker] Initialize response received:", initResponse);
        }

        conn.sendNotification("initialized", {});
        connection = conn;
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
      return await trySpawn("/lsp");
    } catch {
      return await trySpawn("/static/devextensions");
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
export function getLsp(): ProtocolConnection | null {
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
  window.addEventListener("START_ZERO_COPY_LSP", (e: any) => {
    if (e.detail && e.detail.canvas) {
      passCanvasToLsp(e.detail.canvas, e.detail.uri, e.detail.className);
    }
  });
}
