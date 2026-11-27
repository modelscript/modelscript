// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CstTextDelta, CstTextEdit } from "@modelscript/dsl/unparser";
import type { DiagramAction, PscadForeignDropInfo } from "@modelscript/pscad";
import {
  CstEditWorkerCore,
  isCstEditWorkerSupported,
  type CstEditWorkerRequest,
  type CstEditWorkerResponse,
} from "./cst-edit-worker-core";

export { isCstEditWorkerSupported };

export interface CstEditApplyResult {
  handled: boolean;
  version: number;
  edits: CstTextEdit[];
  renderHint: "none" | "immediate" | "debounced";
}

let worker: Worker | null = null;
let fallbackCore: CstEditWorkerCore | null = null;
let nextRequestId = 1;
const pending = new Map<number, { resolve: (res: CstEditApplyResult) => void; reject: (err: unknown) => void }>();

function ensureTransport(): { kind: "worker"; worker: Worker } | { kind: "core"; core: CstEditWorkerCore } {
  if (worker) return { kind: "worker", worker };
  if (fallbackCore) return { kind: "core", core: fallbackCore };

  if (typeof Worker !== "undefined") {
    try {
      const w = new Worker(new URL("./cst-edit.worker.js", import.meta.url), { type: "module" });
      w.onmessage = (event: MessageEvent<CstEditWorkerResponse>) => {
        const res = event.data;
        if (!res || res.type !== "applyActionsResult") return;
        const entry = pending.get(res.id);
        if (entry) {
          pending.delete(res.id);
          entry.resolve({
            handled: res.handled,
            version: res.version,
            edits: res.edits,
            renderHint: res.renderHint,
          });
        }
      };
      w.onerror = () => {
        // Degrade gracefully to in-process CstEditWorkerCore if worker fails to boot
        worker = null;
        fallbackCore = new CstEditWorkerCore();
        for (const [id, entry] of pending.entries()) {
          pending.delete(id);
          entry.resolve({ handled: false, version: 0, edits: [], renderHint: "none" });
        }
      };
      worker = w;
      return { kind: "worker", worker: w };
    } catch {
      // Fall back to in-process core in non-browser/test environments
    }
  }

  fallbackCore = new CstEditWorkerCore();
  return { kind: "core", core: fallbackCore };
}

function postOneWay(msg: CstEditWorkerRequest): void {
  const t = ensureTransport();
  if (t.kind === "worker") {
    t.worker.postMessage(msg);
  } else {
    t.core.handleMessage(msg);
  }
}

/** Notifies the Dedicated CST Edit Worker that a document was opened or reset. */
export function notifyCstWorkerOpen(uri: string, langId: string, text: string, version: number): void {
  if (!isCstEditWorkerSupported(langId)) return;
  postOneWay({ type: "open", uri, langId, text, version });
}

/** Streams O(1) incremental Monaco content deltas directly into the Edit Worker's live CST session. */
export function notifyCstWorkerDeltas(uri: string, langId: string, deltas: CstTextDelta[], version: number): void {
  if (!isCstEditWorkerSupported(langId) || deltas.length === 0) return;
  postOneWay({ type: "delta", uri, langId, deltas, version });
}

/** Syncs full text to the Edit Worker (computes minimal incremental diff inside the worker). */
export function notifyCstWorkerSyncText(uri: string, langId: string, text: string, version: number): void {
  if (!isCstEditWorkerSupported(langId)) return;
  postOneWay({ type: "syncText", uri, langId, text, version });
}

/** Disposes the document's CST session in the Edit Worker. */
export function notifyCstWorkerClose(uri: string): void {
  if (!worker && !fallbackCore) return;
  postOneWay({ type: "close", uri });
}

/** Pushes lightweight foreign-symbol metadata to the Edit Worker so cross-language drops need zero LSP lookup. */
export function publishCstWorkerForeignSymbols(symbols: Record<string, PscadForeignDropInfo>): void {
  if (!worker && !fallbackCore) return;
  postOneWay({ type: "setForeignSymbols", symbols });
}

/**
 * Sends a diagram action batch to the Dedicated CST Edit Worker (~1–3 ms off main thread).
 * Callers must compare `result.version` against `monacoModel.getVersionId()` before applying edits.
 */
export function applyDiagramActionsViaCstWorker(params: {
  uri: string;
  langId: string;
  actions: DiagramAction[];
  version: number;
  fallbackText?: string | undefined;
  className?: string | undefined;
}): Promise<CstEditApplyResult> {
  if (!isCstEditWorkerSupported(params.langId)) {
    return Promise.resolve({ handled: false, version: params.version, edits: [], renderHint: "none" });
  }
  const id = nextRequestId++;
  const msg: CstEditWorkerRequest = {
    type: "applyActions",
    id,
    uri: params.uri,
    langId: params.langId,
    actions: params.actions,
    version: params.version,
    fallbackText: params.fallbackText,
    className: params.className,
  };
  const t = ensureTransport();
  if (t.kind === "core") {
    const res = t.core.handleMessage(msg);
    return Promise.resolve(
      res
        ? { handled: res.handled, version: res.version, edits: res.edits, renderHint: res.renderHint }
        : { handled: false, version: params.version, edits: [], renderHint: "none" },
    );
  }
  return new Promise<CstEditApplyResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    t.worker.postMessage(msg);
  });
}

/** Terminates the Dedicated CST Edit Worker, rejects pending requests, and resets singleton state. */
export function disposeCstEditWorker(): void {
  if (worker) {
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
    worker = null;
  }
  if (fallbackCore) {
    fallbackCore.dispose();
    fallbackCore = null;
  }
  if (pending.size > 0) {
    const err = new Error("CST edit worker disposed");
    for (const [id, entry] of pending.entries()) {
      pending.delete(id);
      entry.reject(err);
    }
  }
}
