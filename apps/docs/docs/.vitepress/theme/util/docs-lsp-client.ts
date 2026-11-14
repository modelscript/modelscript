// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Lightweight lazy-loaded JSON-RPC 2.0 Web Worker client for `@modelscript/lsp`
 * (`browserServerMain.js`) in the VitePress landing-page Polyglot Sandbox.
 *
 * Features:
 * - Zero SSR or initial-load worker cost (boots on first interaction)
 * - Subpath-aware URL resolution via Vite `BASE_URL`
 * - Content deduplication (skips unchanged `didChange` syncs across inactive tabs)
 * - Per-request timeout & channel superseding to drop stale `verifyAll` responses
 */

export interface LspDiagnostic {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  severity?: number;
  code?: string | number;
  source?: string;
  message: string;
  data?: any;
}

export interface LspWorkerStatus {
  state: "idle" | "booting" | "ready" | "error";
  message?: string;
}

type DiagnosticsListener = (uri: string, diagnostics: LspDiagnostic[]) => void;
type StatusListener = (status: LspWorkerStatus) => void;

let worker: Worker | null = null;
let initPromise: Promise<void> | null = null;
let nextId = 1;
const pending = new Map<
  number,
  {
    resolve: (val: any) => void;
    reject: (err: Error) => void;
    superseded?: boolean;
    timer?: ReturnType<typeof setTimeout>;
  }
>();
const latestByChannel = new Map<string, number>();
const diagListeners = new Set<DiagnosticsListener>();
const statusListeners = new Set<StatusListener>();
const openedVersions = new Map<string, number>();
const lastSyncedText = new Map<string, string>();
let currentStatus: LspWorkerStatus = { state: "idle" };

function emitStatus(status: LspWorkerStatus): void {
  currentStatus = status;
  for (const listener of statusListeners) {
    listener(status);
  }
}

export function onLspDiagnostics(listener: DiagnosticsListener): () => void {
  diagListeners.add(listener);
  return () => {
    diagListeners.delete(listener);
  };
}

export function onLspStatus(listener: StatusListener): () => void {
  statusListeners.add(listener);
  listener(currentStatus);
  return () => {
    statusListeners.delete(listener);
  };
}

function getBasePrefix(): string {
  const raw = (import.meta as any).env?.BASE_URL ?? "/";
  const trimmed = raw.endsWith("/") ? raw.slice(0, -1) : raw;
  return trimmed === "/" ? "" : trimmed;
}

function sendNotification(method: string, params: unknown): void {
  if (!worker) return;
  worker.postMessage({ jsonrpc: "2.0", method, params });
}

function sendRequest<T = any>(
  method: string,
  params: unknown,
  options: { timeoutMs?: number; channel?: string } = {},
): Promise<T> {
  if (!worker) return Promise.reject(new Error("LSP worker not initialized"));

  if (options.channel) {
    const prevId = latestByChannel.get(options.channel);
    if (prevId !== undefined) {
      const prevEntry = pending.get(prevId);
      if (prevEntry) prevEntry.superseded = true;
    }
  }

  const id = nextId++;
  if (options.channel) {
    latestByChannel.set(options.channel, id);
  }

  const timeoutMs = options.timeoutMs ?? 25_000;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const entry = pending.get(id);
      if (entry) {
        pending.delete(id);
        entry.reject(new Error(`LSP request '${method}' timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    try {
      worker!.postMessage({ jsonrpc: "2.0", id, method, params });
    } catch (err) {
      clearTimeout(timer);
      pending.delete(id);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

export async function ensureDocsLspReady(initialLanguageId = "modelica"): Promise<void> {
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    throw new Error("Web Workers are unavailable in this environment");
  }
  if (initPromise) return initPromise;

  emitStatus({ state: "booting", message: "Starting WebAssembly LSP worker…" });
  initPromise = (async () => {
    const origin = window.location.origin;
    const basePrefix = getBasePrefix();
    const lspRoot = `${basePrefix}/lsp`;
    const workerUrl = new URL(`${lspRoot}/server/dist/browserServerMain.js`, origin).href;
    const w = new Worker(workerUrl, { name: "modelscript-docs-lsp" });
    worker = w;

    w.addEventListener("message", (ev: MessageEvent<any>) => {
      const msg = ev.data;
      if (!msg || typeof msg !== "object") return;
      if (msg.id !== undefined && pending.has(msg.id)) {
        const entry = pending.get(msg.id)!;
        pending.delete(msg.id);
        if (entry.timer) clearTimeout(entry.timer);
        if (entry.superseded) {
          entry.reject(new Error("SUPERSEDED"));
          return;
        }
        if (msg.error) {
          entry.reject(new Error(msg.error.message || "LSP request failed"));
        } else {
          entry.resolve(msg.result);
        }
        return;
      }
      if (msg.method === "textDocument/publishDiagnostics" && msg.params?.uri) {
        const diags: LspDiagnostic[] = Array.isArray(msg.params.diagnostics) ? msg.params.diagnostics : [];
        for (const listener of diagListeners) {
          listener(msg.params.uri, diags);
        }
      } else if (msg.method === "modelscript/status" && msg.params?.state) {
        const st = String(msg.params.state).toLowerCase();
        if (st === "ready" || st === "idle") {
          emitStatus({ state: "ready", message: msg.params.message });
        } else if (st === "error") {
          emitStatus({ state: "error", message: msg.params.message });
        }
      }
    });

    w.addEventListener("error", (err) => {
      for (const entry of pending.values()) {
        if (entry.timer) clearTimeout(entry.timer);
        entry.reject(new Error(err.message || "LSP worker error"));
      }
      pending.clear();
      worker = null;
      initPromise = null;
      openedVersions.clear();
      lastSyncedText.clear();
      emitStatus({ state: "error", message: err.message || "LSP worker crashed" });
    });

    await sendRequest(
      "initialize",
      {
        processId: null,
        rootUri: "file:///sandbox",
        capabilities: {
          textDocument: {
            publishDiagnostics: { relatedInformation: true },
            codeAction: {},
            hover: { contentFormat: ["markdown", "plaintext"] },
          },
        },
        initializationOptions: {
          extensionUri: `${origin}${lspRoot}`,
          registryUrl: origin,
          useLocalMsl: false,
          lazyLoadParsers: true,
          initialLanguageId,
          projectDependencies: [],
        },
      },
      { timeoutMs: 25_000 },
    );
    sendNotification("initialized", {});
    emitStatus({ state: "ready" });
  })();

  try {
    await initPromise;
  } catch (err: any) {
    initPromise = null;
    worker = null;
    emitStatus({ state: "error", message: err?.message || String(err) });
    throw err;
  }
}

export async function syncDocsLspBuffer(uri: string, languageId: string, text: string): Promise<boolean> {
  await ensureDocsLspReady(languageId);
  if (lastSyncedText.get(uri) === text && openedVersions.has(uri)) {
    return false;
  }
  const prevVersion = openedVersions.get(uri);
  lastSyncedText.set(uri, text);
  if (prevVersion === undefined) {
    openedVersions.set(uri, 1);
    sendNotification("textDocument/didOpen", {
      textDocument: { uri, languageId, version: 1, text },
    });
  } else {
    const nextVersion = prevVersion + 1;
    openedVersions.set(uri, nextVersion);
    sendNotification("textDocument/didChange", {
      textDocument: { uri, version: nextVersion },
      contentChanges: [{ text }],
    });
  }
  return true;
}

export async function closeDocsLspBuffer(uri: string): Promise<void> {
  lastSyncedText.delete(uri);
  if (!worker || !openedVersions.has(uri)) return;
  openedVersions.delete(uri);
  sendNotification("textDocument/didClose", { textDocument: { uri } });
}

export async function verifyAllDocsLsp(uri?: string): Promise<any> {
  await ensureDocsLspReady();
  return sendRequest("modelscript/verifyAll", { uri, all: true }, { timeoutMs: 25_000, channel: "verifyAll" });
}

export async function getCodeActionsDocsLsp(
  uri: string,
  range: { start: { line: number; character: number }; end: { line: number; character: number } },
  diagnostics: LspDiagnostic[],
): Promise<any[]> {
  await ensureDocsLspReady();
  return sendRequest(
    "textDocument/codeAction",
    {
      textDocument: { uri },
      range,
      context: { diagnostics },
    },
    { timeoutMs: 8_000, channel: `codeAction:${uri}` },
  );
}
