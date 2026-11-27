// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createHttpLspTransport, setActiveEditorLspTransport, type EditorLspTransport } from "../src/transport.js";
import {
  didChange,
  didClose,
  didOpen,
  didSave,
  extractPrimaryModelicaClassName,
  getClassIcon,
  getClassIcons,
  getDiagramPreviewSvgs,
  getLibraryTree,
  globalClassIconCache,
  setActiveLspTransport,
  type AnsatzLspTransport,
} from "../src/workbench/util/lsp-bridge.js";
import { applyLspTextEditsToString } from "../src/workbench/util/text-edits.js";

interface RecordedCall {
  kind: "request" | "notification";
  method: string;
  params: unknown;
}

function createMockTransport(requestHandler?: (method: string, params: unknown) => Promise<unknown> | unknown): {
  transport: AnsatzLspTransport;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const transport: AnsatzLspTransport = {
    async sendRequest<R = unknown>(method: string, params?: unknown): Promise<R> {
      calls.push({ kind: "request", method, params });
      if (requestHandler) {
        return (await requestHandler(method, params)) as R;
      }
      return null as R;
    },
    sendNotification(method: string, params?: unknown): void {
      calls.push({ kind: "notification", method, params });
    },
  };
  return { transport, calls };
}

afterEach(() => {
  setActiveLspTransport(null);
  setActiveEditorLspTransport(null);
  globalClassIconCache.clear();
});

describe("extractPrimaryModelicaClassName", () => {
  it("extracts the primary class name from valid Modelica source", () => {
    assert.equal(
      extractPrimaryModelicaClassName("model BouncingBall\n  Real h(start=1);\nend BouncingBall;"),
      "BouncingBall",
    );
    assert.equal(
      extractPrimaryModelicaClassName("block PIDController\n  parameter Real k = 1;\nend PIDController;"),
      "PIDController",
    );
  });

  it("returns null for empty source or the generic placeholder Model name", () => {
    assert.equal(extractPrimaryModelicaClassName(""), null);
    assert.equal(extractPrimaryModelicaClassName("   \n  "), null);
    assert.equal(extractPrimaryModelicaClassName("model Model\nend Model;"), null);
  });
});

describe("lsp-bridge document lifecycle & request helpers", () => {
  it("deduplicates identical didOpen calls, re-opens on languageId change, and increments versions", async () => {
    const { transport, calls } = createMockTransport();
    setActiveLspTransport(transport);
    const uri = "file:///test-lifecycle.mo";

    await didOpen(uri, "model A end A;", "modelica");
    // Identical open is deduplicated
    await didOpen(uri, "model A end A;", "modelica");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.method, "textDocument/didOpen");
    assert.deepEqual((calls[0]?.params as { textDocument: { version: number; languageId: string } }).textDocument, {
      uri,
      languageId: "modelica",
      version: 1,
      text: "model A end A;",
    });

    // didChange increments version
    await didChange(uri, "model A Real x; end A;");
    assert.equal(calls.length, 2);
    assert.equal(calls[1]?.method, "textDocument/didChange");
    assert.equal((calls[1]?.params as { textDocument: { version: number } }).textDocument.version, 2);

    // didSave forwards text when provided
    await didSave(uri, "model A Real x; end A;");
    assert.equal(calls.length, 3);
    assert.equal(calls[2]?.method, "textDocument/didSave");
    assert.equal((calls[2]?.params as { text?: string }).text, "model A Real x; end A;");

    // Re-opening with a different languageId closes then opens
    await didOpen(uri, "model A Real x; end A;", "modelscript");
    assert.equal(calls.length, 5);
    assert.equal(calls[3]?.method, "textDocument/didClose");
    assert.equal(calls[4]?.method, "textDocument/didOpen");
    assert.equal((calls[4]?.params as { textDocument: { languageId: string } }).textDocument.languageId, "modelscript");

    // didClose resets version counter
    didClose(uri);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(calls[5]?.method, "textDocument/didClose");

    await didOpen(uri, "model A end A;", "modelica");
    assert.equal((calls[6]?.params as { textDocument: { version: number } }).textDocument.version, 1);
    didClose(uri);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("caches and deduplicates getClassIcon requests and strips __LIB__: prefix", async () => {
    let iconCalls = 0;
    const { transport } = createMockTransport(async (method, params) => {
      if (method === "modelscript/getClassIcon") {
        iconCalls += 1;
        const p = params as { className: string };
        return `<svg data-cls="${p.className}"></svg>`;
      }
      if (method === "modelscript/getClassIcons") {
        const p = params as { classNames: string[] };
        const result: Record<string, string | null> = {};
        for (const cls of p.classNames) {
          result[cls] = cls === "NoIcon" ? null : `<svg data-batch="${cls}"></svg>`;
        }
        return result;
      }
      return null;
    });
    setActiveLspTransport(transport);

    assert.equal(await getClassIcon(""), null);

    // Concurrent calls for the same class share a single in-flight request
    const [a, b] = await Promise.all([
      getClassIcon("__LIB__:Modelica.Blocks.Sources.Step"),
      getClassIcon("Modelica.Blocks.Sources.Step"),
    ]);
    assert.equal(iconCalls, 1);
    assert.equal(a, '<svg data-cls="Modelica.Blocks.Sources.Step"></svg>');
    assert.equal(b, a);

    // Subsequent call hits cache
    const c = await getClassIcon("Modelica.Blocks.Sources.Step");
    assert.equal(iconCalls, 1);
    assert.equal(c, a);

    // getClassIcons skips already-cached classes and filters out null results
    const batch = await getClassIcons(["Modelica.Blocks.Sources.Step", "Custom.Valve", "NoIcon"]);
    assert.deepEqual(batch, {
      "Modelica.Blocks.Sources.Step": '<svg data-cls="Modelica.Blocks.Sources.Step"></svg>',
      "Custom.Valve": '<svg data-batch="Custom.Valve"></svg>',
    });
  });

  it("deduplicates concurrent getLibraryTree requests and normalizes null to []", async () => {
    let treeCalls = 0;
    const { transport } = createMockTransport(async (method) => {
      if (method === "modelscript/getLibraryTree") {
        treeCalls += 1;
        return null;
      }
      return null;
    });
    setActiveLspTransport(transport);

    const [r1, r2] = await Promise.all([
      getLibraryTree("file:///a.mo", "root"),
      getLibraryTree("file:///a.mo", "root"),
    ]);
    assert.equal(treeCalls, 1);
    assert.deepEqual(r1, []);
    assert.deepEqual(r2, []);
  });

  it("short-circuits getDiagramPreviewSvgs on empty input and returns {} on transport error", async () => {
    let previewCalls = 0;
    const { transport } = createMockTransport(async () => {
      previewCalls += 1;
      throw new Error("worker unavailable");
    });
    setActiveLspTransport(transport);

    assert.deepEqual(await getDiagramPreviewSvgs([]), {});
    assert.equal(previewCalls, 0);

    assert.deepEqual(await getDiagramPreviewSvgs([{ id: "m1", className: "M1" }]), {});
    assert.equal(previewCalls, 1);
  });
});

describe("applyLspTextEditsToString", () => {
  it("returns original text when edits list is empty", () => {
    assert.equal(applyLspTextEditsToString("line0\nline1", []), "line0\nline1");
  });

  it("applies multiple non-overlapping edits regardless of order", () => {
    const src = "model Foo\n  parameter Real R = 10;\n  parameter Real C = 5;\nend Foo;";
    const updated = applyLspTextEditsToString(src, [
      {
        range: { start: { line: 1, character: 21 }, end: { line: 1, character: 23 } },
        newText: "100",
      },
      {
        range: { start: { line: 2, character: 21 }, end: { line: 2, character: 22 } },
        newText: "25",
      },
    ]);
    assert.equal(updated, "model Foo\n  parameter Real R = 100;\n  parameter Real C = 25;\nend Foo;");
  });

  it("clamps out-of-bounds line and character positions safely", () => {
    const updated = applyLspTextEditsToString("abc", [
      {
        range: { start: { line: -2, character: -5 }, end: { line: 99, character: 99 } },
        newText: "xyz",
      },
    ]);
    assert.equal(updated, "xyz");
  });
});

describe("createHttpLspTransport", () => {
  it("forwards sendRequest, surfaces HTTP/RPC errors, and publishes diagnostics on didOpen", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; body: { method: string; params: unknown } }> = [];

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const body = JSON.parse(String(init?.body ?? "{}")) as { method: string; params: unknown };
      requests.push({ url, body });

      if (body.method === "test/httpError") {
        return new Response("Internal Server Error", { status: 500 });
      }
      if (body.method === "test/rpcError") {
        return new Response(JSON.stringify({ error: "boom" }), { status: 200 });
      }
      if (body.method === "textDocument/diagnostic") {
        return new Response(JSON.stringify({ result: [{ message: "unused var", severity: 2 }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ result: { ok: true } }), { status: 200 });
    }) as typeof globalThis.fetch;

    try {
      const transport: EditorLspTransport = createHttpLspTransport("/__mock/lsp");
      const ok = await transport.sendRequest<{ ok: boolean }>("test/ping", { a: 1 });
      assert.deepEqual(ok, { ok: true });
      assert.equal(requests[0]?.url, "/__mock/lsp");

      await assert.rejects(() => transport.sendRequest("test/httpError"), /failed \(500\)/);
      await assert.rejects(() => transport.sendRequest("test/rpcError"), /boom/);

      const published: unknown[] = [];
      const sub = transport.onNotification?.("textDocument/publishDiagnostics", (payload) => {
        published.push(payload);
      });

      transport.sendNotification("textDocument/didOpen", {
        textDocument: { uri: "file:///d.mo", languageId: "modelica", version: 1, text: "model D end D;" },
      });

      // Allow the chained fetch promises to resolve
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(published.length, 1);
      assert.deepEqual(published[0], {
        uri: "file:///d.mo",
        diagnostics: [{ message: "unused var", severity: 2 }],
      });

      // Late subscriber receives replayed diagnostics via microtask
      const replayed: unknown[] = [];
      transport.onNotification?.("textDocument/publishDiagnostics", (payload) => {
        replayed.push(payload);
      });
      await Promise.resolve();
      assert.equal(replayed.length, 1);

      if (typeof sub === "function") {
        sub();
      } else {
        sub?.dispose();
      }
      transport.dispose?.();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
