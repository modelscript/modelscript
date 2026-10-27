// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Spawns the LSP WebWorker and provides a typed protocol connection.
 *
 * Uses raw `vscode-languageserver-protocol/browser` — no `monaco-languageclient`
 * dependency. The connection is a standard JSON-RPC2 link over `postMessage`.
 */

import {
  BrowserMessageReader,
  BrowserMessageWriter,
  createProtocolConnection,
  type ProtocolConnection,
} from "vscode-languageserver-protocol/browser";

let connection: ProtocolConnection | null = null;
let worker: Worker | null = null;
let initPromise: Promise<ProtocolConnection> | null = null;

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
    // The LSP bundle is copied to /lsp/server/dist/browserServerMain.js
    // by viteStaticCopy. We create a plain Worker pointing at that URL.
    const origin =
      (typeof globalThis.location !== "undefined" &&
        globalThis.location.origin &&
        globalThis.location.origin !== "null" &&
        globalThis.location.origin) ||
      (typeof globalThis.location !== "undefined" && globalThis.location.href) ||
      "http://localhost";
    worker = new Worker(new URL("/lsp/server/dist/browserServerMain.js", origin), {
      name: "modelscript-lsp",
    });

    worker.onerror = (err) => {
      console.error("[lsp-worker] Worker onerror:", err.message, err.filename, err.lineno, err);
      connection = null;
      initPromise = null;
      worker = null;
    };
    worker.onmessageerror = (err) => {
      console.error("[lsp-worker] Worker onmessageerror:", err);
    };

    const reader = new BrowserMessageReader(worker);
    const writer = new BrowserMessageWriter(worker);
    const conn = createProtocolConnection(reader, writer);
    conn.onClose(() => {
      console.warn("[lsp-worker] Connection closed. Resetting connection handle.");
      connection = null;
      initPromise = null;
      worker = null;
    });
    conn.listen();

    conn.onNotification("window/logMessage", (params: any) => {
      console.log(`[LSP-server] [type=${params.type}] ${params.message}`);
    });
    conn.onNotification("modelscript/status", (params: any) => {
      console.log(`[LSP-status] state=${params.state} message=${params.message}`);
    });

    console.log("[lsp-worker] Connection listening. Sending initialize request...");

    // Send initialize — the extensionUri tells the server where to find
    // WASM files and standard library zips (relative to the server/dist path).
    const initResponse = await conn.sendRequest("initialize", {
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
        extensionUri:
          ((typeof globalThis.location !== "undefined" &&
            globalThis.location.origin &&
            globalThis.location.origin !== "null" &&
            globalThis.location.origin) ||
            (typeof globalThis.location !== "undefined" && globalThis.location.href) ||
            "http://localhost") + "/lsp",
        useLocalMsl: true,
        lazyLoadParsers: true,
        initialLanguageId: initialLanguageId ?? "modelica",
      },
    });
    console.log("[lsp-worker] Initialize response received:", initResponse);

    conn.sendNotification("initialized", {});
    connection = conn;
    return conn;
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
