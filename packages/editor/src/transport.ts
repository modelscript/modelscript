// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Host-agnostic LSP transport abstraction for `@modelscript/editor`.
 *
 * Allows visual & code editor workbenches to run identically over:
 *   1. Production WebWorker LSP connections (`browserServerMain.js`)
 *   2. Single-language dev playground HTTP transport (`/__playground/lsp` -> `@modelscript/lsp/core`)
 *   3. In-memory transports for deterministic unit & browser tests
 */

export interface EditorLspTransport {
  sendRequest<R = unknown>(method: string, params?: unknown): Promise<R>;
  sendNotification(method: string, params?: unknown): void;
  onNotification?(method: string, handler: (params: unknown) => void): { dispose(): void } | (() => void);
  dispose?(): void;
}

const ACTIVE_TRANSPORT_SYMBOL = Symbol.for("@modelscript/editor/activeTransport");

/**
 * Installs a custom LSP transport for editor bridges.
 * Pass `null` to restore the default host transport.
 */
export function setActiveEditorLspTransport(transport: EditorLspTransport | null): void {
  (globalThis as Record<symbol, EditorLspTransport | null>)[ACTIVE_TRANSPORT_SYMBOL] = transport;
}

/**
 * Returns the currently injected custom transport, or `null` if using the default host transport.
 */
export function getCustomEditorLspTransport(): EditorLspTransport | null {
  return (globalThis as Record<symbol, EditorLspTransport | null | undefined>)[ACTIVE_TRANSPORT_SYMBOL] ?? null;
}

/**
 * Creates an `EditorLspTransport` backed by a single-language HTTP endpoint
 * such as `scripts/language-playground.ts` (`/__playground/lsp` -> `@modelscript/lsp/core`).
 */
export function createHttpLspTransport(endpoint = "/__playground/lsp"): EditorLspTransport {
  const listeners = new Map<string, Set<(params: unknown) => void>>();
  const lastDiagnosticsByUri = new Map<string, unknown>();

  const emitNotification = (method: string, params: unknown) => {
    const handlers = listeners.get(method);
    if (!handlers) return;
    for (const h of handlers) {
      try {
        h(params);
      } catch {
        // isolate subscriber errors
      }
    }
  };

  const post = async (method: string, params?: unknown): Promise<unknown> => {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, params }),
    });
    if (!resp.ok) {
      throw new Error(`HTTP LSP request '${method}' failed (${resp.status})`);
    }
    const payload = (await resp.json()) as { handled?: boolean; result?: unknown; error?: string };
    if (payload.error) {
      throw new Error(payload.error);
    }
    return payload.result ?? null;
  };

  return {
    sendRequest<R = unknown>(method: string, params?: unknown): Promise<R> {
      return post(method, params) as Promise<R>;
    },
    sendNotification(method: string, params?: unknown): void {
      void post(method, params).then(() => {
        if (method === "textDocument/didOpen" || method === "textDocument/didChange") {
          const td = (params as { textDocument?: { uri?: string } } | undefined)?.textDocument;
          const docUri = td?.uri;
          if (docUri) {
            void post("textDocument/diagnostic", { textDocument: { uri: docUri } }).then((diags) => {
              if (Array.isArray(diags)) {
                const payload = { uri: docUri, diagnostics: diags };
                lastDiagnosticsByUri.set(docUri, payload);
                emitNotification("textDocument/publishDiagnostics", payload);
              }
            });
          }
        } else if (method === "textDocument/didClose") {
          const td = (params as { textDocument?: { uri?: string } } | undefined)?.textDocument;
          if (td?.uri) lastDiagnosticsByUri.delete(td.uri);
        }
      });
    },
    onNotification(method: string, handler: (params: unknown) => void) {
      let set = listeners.get(method);
      if (!set) {
        set = new Set();
        listeners.set(method, set);
      }
      set.add(handler);
      if (method === "textDocument/publishDiagnostics" && lastDiagnosticsByUri.size > 0) {
        queueMicrotask(() => {
          for (const payload of lastDiagnosticsByUri.values()) {
            try {
              handler(payload);
            } catch {
              // isolate subscriber errors
            }
          }
        });
      }
      return {
        dispose() {
          set?.delete(handler);
        },
      };
    },
    dispose() {
      listeners.clear();
      lastDiagnosticsByUri.clear();
    },
  };
}
