// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createHttpLspTransport,
  getCustomEditorLspTransport,
  setActiveEditorLspTransport,
  type EditorLspTransport,
} from "../src/transport.js";

describe("@modelscript/editor LSP transport", () => {
  it("registers and clears the active custom LSP transport", () => {
    const prev = getCustomEditorLspTransport();
    const stub: EditorLspTransport = {
      async sendRequest<R>() {
        return null as R;
      },
      sendNotification() {
        // no-op
      },
    };
    try {
      setActiveEditorLspTransport(stub);
      assert.strictEqual(getCustomEditorLspTransport(), stub);
      setActiveEditorLspTransport(null);
      assert.strictEqual(getCustomEditorLspTransport(), null);
    } finally {
      setActiveEditorLspTransport(prev);
    }
  });

  it("createHttpLspTransport exposes sendRequest, sendNotification, and disposable listeners", () => {
    const transport = createHttpLspTransport("/__test/lsp");
    assert.equal(typeof transport.sendRequest, "function");
    assert.equal(typeof transport.sendNotification, "function");
    assert.equal(typeof transport.onNotification, "function");
    const sub = transport.onNotification?.("textDocument/publishDiagnostics", () => {});
    assert.ok(sub);
    if (typeof sub === "function") {
      sub();
    } else {
      sub.dispose();
    }
    transport.dispose?.();
  });
});
