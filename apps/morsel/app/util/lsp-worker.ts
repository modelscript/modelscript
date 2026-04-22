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

/**
 * Start the LSP WebWorker and send `initialize` + `initialized`.
 * Resolves once the server has acknowledged `initialize`.
 *
 * If the worker is already running the existing connection is returned.
 */
export async function startLsp(): Promise<ProtocolConnection> {
  if (connection) return connection;

  // The LSP bundle is copied to /lsp/server/dist/browserServerMain.js
  // by viteStaticCopy. We create a plain Worker pointing at that URL.
  worker = new Worker(new URL("/lsp/server/dist/browserServerMain.js", globalThis.location.origin), {
    type: "classic",
    name: "modelscript-lsp",
  });

  const reader = new BrowserMessageReader(worker);
  const writer = new BrowserMessageWriter(worker);
  connection = createProtocolConnection(reader, writer);
  connection.listen();

  // Send initialize — the extensionUri tells the server where to find
  // WASM files and standard library zips (relative to the server/dist path).
  await connection.sendRequest("initialize", {
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
      },
    },
    initializationOptions: {
      // This URI is used by the LSP to construct paths like
      // ${extensionUri}/server/dist/tree-sitter-modelica.wasm
      extensionUri: globalThis.location.origin + "/lsp",
    },
  });

  connection.sendNotification("initialized", {});

  return connection;
}

/** Returns the active connection, or null if not started. */
export function getLsp(): ProtocolConnection | null {
  return connection;
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
}
