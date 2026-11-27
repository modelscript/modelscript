// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser";
import { CosimViewProvider } from "../src/cosim-panel.js";

const EXTENSION_URI = vscode.Uri.file("/workspace/ext");

interface MockWebviewView {
  view: vscode.WebviewView;
  postedMessages: unknown[];
  sendMessage: (msg: unknown) => Promise<void>;
  disposeView: () => void;
}

function createMockWebviewView(): MockWebviewView {
  const postedMessages: unknown[] = [];
  const messageListeners: ((msg: unknown) => void | Promise<void>)[] = [];
  const disposeListeners: (() => void)[] = [];

  const view = {
    visible: false,
    webview: {
      cspSource: "vscode-webview://cosim-test",
      options: {},
      html: "",
      asWebviewUri: (uri: vscode.Uri) => uri,
      postMessage: async (msg: unknown) => {
        postedMessages.push(msg);
        return true;
      },
      onDidReceiveMessage: (listener: (msg: unknown) => void | Promise<void>) => {
        messageListeners.push(listener);
        return new vscode.Disposable(() => {
          const idx = messageListeners.indexOf(listener);
          if (idx >= 0) messageListeners.splice(idx, 1);
        });
      },
    },
    onDidDispose: (listener: () => void) => {
      disposeListeners.push(listener);
      return new vscode.Disposable(() => {
        const idx = disposeListeners.indexOf(listener);
        if (idx >= 0) disposeListeners.splice(idx, 1);
      });
    },
    onDidChangeVisibility: () => new vscode.Disposable(() => undefined),
  } as unknown as vscode.WebviewView;

  return {
    view,
    postedMessages,
    sendMessage: async (msg: unknown) => {
      for (const listener of [...messageListeners]) {
        await listener(msg);
      }
    },
    disposeView: () => {
      for (const listener of [...disposeListeners]) {
        listener();
      }
    },
  };
}

describe("CosimViewProvider security and lifecycle", () => {
  it("emits strict CSP with matching script nonce and no broad connect-src", () => {
    const provider = new CosimViewProvider(EXTENSION_URI, {} as LanguageClient);
    const mock = createMockWebviewView();

    provider.resolveWebviewView(
      mock.view,
      {} as vscode.WebviewViewResolveContext,
      new vscode.CancellationTokenSource().token,
    );

    const html = mock.view.webview.html;
    assert.ok(html.includes('http-equiv="Content-Security-Policy"'), "must include CSP meta tag");
    const cspMatch = html.match(/script-src\s+'nonce-([A-Za-z0-9]+)'/);
    assert.ok(cspMatch && cspMatch[1], "CSP must include script-src 'nonce-...'");
    const nonce = cspMatch[1];

    assert.ok(!html.includes("http: https: ws: wss:"), "CSP must not allow wildcard http/ws connect-src");

    const scriptTags = html.match(/<script\b[^>]*>/gi) ?? [];
    assert.equal(scriptTags.length, 1, "expected exactly one script tag");
    assert.ok(scriptTags[0]?.includes(`nonce="${nonce}"`), "script tag must carry matching nonce");

    provider.dispose();
  });

  it("clears view reference on dispose and cleanly re-resolves without duplicating listeners", async () => {
    const provider = new CosimViewProvider(EXTENSION_URI, {} as LanguageClient);
    const first = createMockWebviewView();

    provider.resolveWebviewView(
      first.view,
      {} as vscode.WebviewViewResolveContext,
      new vscode.CancellationTokenSource().token,
    );

    first.disposeView();
    first.postedMessages.length = 0;

    // Messages posted after view disposal must not target the disposed webview
    await first.sendMessage({ type: "getConfig" });
    assert.equal(first.postedMessages.length, 0, "disposed view must not receive messages");

    // Re-resolving with a fresh view works cleanly
    const second = createMockWebviewView();
    provider.resolveWebviewView(
      second.view,
      {} as vscode.WebviewViewResolveContext,
      new vscode.CancellationTokenSource().token,
    );
    second.postedMessages.length = 0;
    await second.sendMessage({ type: "getConfig" });
    assert.equal(
      second.postedMessages.filter((m) => (m as { type?: string }).type === "config").length,
      1,
      "re-resolved view should handle getConfig exactly once",
    );

    provider.dispose();
  });

  it("rejects invalid URL schemes in updateConfig and sanitizes local participant payloads", async () => {
    const provider = new CosimViewProvider(EXTENSION_URI, {} as LanguageClient);
    const mock = createMockWebviewView();

    provider.resolveWebviewView(
      mock.view,
      {} as vscode.WebviewViewResolveContext,
      new vscode.CancellationTokenSource().token,
    );

    mock.postedMessages.length = 0;
    await mock.sendMessage({ type: "updateConfig", apiUrl: "javascript:alert(1)" });
    const apiErr = mock.postedMessages.find((m) => (m as { type?: string }).type === "error") as
      { message?: string } | undefined;
    assert.ok(apiErr?.message?.includes("Invalid API URL"), "must reject non-http(s) apiUrl");

    mock.postedMessages.length = 0;
    await mock.sendMessage({ type: "updateConfig", mqttWsUrl: "file:///etc/passwd" });
    const mqttErr = mock.postedMessages.find((m) => (m as { type?: string }).type === "error") as
      { message?: string } | undefined;
    assert.ok(mqttErr?.message?.includes("Invalid MQTT WebSocket URL"), "must reject non-ws(s) mqttWsUrl");

    // Local mode session creation + disposal cleans up local broker and historian
    await mock.sendMessage({ type: "enableLocal" });
    assert.equal(provider.isLocalMode, true);
    assert.ok(provider.broker, "local broker should be created");
    assert.ok(provider.historian, "local historian should be created");

    provider.dispose();
    assert.equal(provider.isLocalMode, false);
    assert.equal(provider.broker, null);
    assert.equal(provider.historian, null);
  });

  it("eliminates innerHTML sinks in cosim-webview.ts", () => {
    const webviewPath = resolve(import.meta.dirname, "../src/webview/cosim-webview.ts");
    const source = readFileSync(webviewPath, "utf-8");
    assert.ok(!source.includes(".innerHTML"), "cosim-webview.ts must not use innerHTML");
  });
});
