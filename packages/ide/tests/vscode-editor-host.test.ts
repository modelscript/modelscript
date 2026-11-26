// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createVsCodeLspTransport,
  type VsCodeMessageEventLike,
  type VsCodeMessageTarget,
} from "../src/webview/shared/vscode-editor-host.js";

function createFakeMessageTarget(): VsCodeMessageTarget & { emit(data: unknown): void } {
  const listeners = new Set<(ev: VsCodeMessageEventLike) => void>();
  return {
    addEventListener(_type, listener) {
      listeners.add(listener);
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener);
    },
    emit(data: unknown) {
      for (const listener of [...listeners]) {
        listener({ data });
      }
    },
  };
}

describe("VS Code EditorHost & LSP Transport Bridge", () => {
  it("correlates requestLsp and lspResponse messages cleanly", async () => {
    const target = createFakeMessageTarget();
    const posted: Array<Record<string, unknown>> = [];
    const transport = createVsCodeLspTransport(
      {
        postMessage(msg: unknown) {
          posted.push(msg as Record<string, unknown>);
        },
      },
      { messageTarget: target, timeoutMs: 2_000 },
    );

    const reqPromise = transport.sendRequest<{ equations: number }>("modelscript/analyzeBlt", {
      uri: "memfs:/Main.mo",
    });

    assert.equal(posted.length, 1);
    assert.equal(posted[0]?.["type"], "requestLsp");
    assert.equal(posted[0]?.["method"], "modelscript/analyzeBlt");
    const requestId = posted[0]?.["requestId"] as string;
    assert.ok(typeof requestId === "string" && requestId.length > 0);

    target.emit({
      type: "lspResponse",
      requestId,
      result: { equations: 42 },
    });

    const result = await reqPromise;
    assert.deepEqual(result, { equations: 42 });
    transport.dispose?.();
  });

  it("propagates lspResponse errors as rejected promises", async () => {
    const target = createFakeMessageTarget();
    const posted: Array<Record<string, unknown>> = [];
    const transport = createVsCodeLspTransport(
      {
        postMessage(msg: unknown) {
          posted.push(msg as Record<string, unknown>);
        },
      },
      { messageTarget: target, timeoutMs: 2_000 },
    );

    const reqPromise = transport.sendRequest("modelscript/flatten", { uri: "memfs:/Bad.mo" });
    const requestId = posted[0]?.["requestId"] as string;

    target.emit({
      type: "lspResponse",
      requestId,
      error: "Syntax error at line 3",
    });

    await assert.rejects(reqPromise, /Syntax error at line 3/);
    transport.dispose?.();
  });

  it("delivers lspNotification payloads to registered subscribers and respects disposal", () => {
    const target = createFakeMessageTarget();
    const posted: Array<Record<string, unknown>> = [];
    const transport = createVsCodeLspTransport(
      {
        postMessage(msg: unknown) {
          posted.push(msg as Record<string, unknown>);
        },
      },
      { messageTarget: target },
    );

    const received: unknown[] = [];
    const sub = transport.onNotification?.("modelscript/simulationProgress", (params) => {
      received.push(params);
    });

    transport.sendNotification("textDocument/didChange", { uri: "memfs:/Main.mo" });
    assert.equal(posted.length, 1);
    assert.equal(posted[0]?.["type"], "notifyLsp");
    assert.equal(posted[0]?.["method"], "textDocument/didChange");

    target.emit({
      type: "lspNotification",
      method: "modelscript/simulationProgress",
      params: { progress: 0.5 },
    });
    assert.deepEqual(received, [{ progress: 0.5 }]);

    if (sub && typeof sub === "object" && "dispose" in sub) {
      sub.dispose();
    }
    target.emit({
      type: "lspNotification",
      method: "modelscript/simulationProgress",
      params: { progress: 1.0 },
    });
    assert.equal(received.length, 1);

    transport.dispose?.();
  });

  it("rejects in-flight requests when disposed", async () => {
    const target = createFakeMessageTarget();
    const transport = createVsCodeLspTransport(
      { postMessage: () => undefined },
      { messageTarget: target, timeoutMs: 10_000 },
    );

    const pending = transport.sendRequest("modelscript/listActions");
    transport.dispose?.();

    await assert.rejects(pending, /disposed/i);
    await assert.rejects(transport.sendRequest("modelscript/listActions"), /disposed/i);
  });
});
