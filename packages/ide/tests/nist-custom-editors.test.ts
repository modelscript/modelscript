// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as vscode from "vscode";
import { DslCustomEditorProvider, type DslUiManifestPanel } from "../src/dsl-custom-editor-provider.js";

describe("NIST Top 3 Declarative DSL Custom Editors (QIF, OSCAL, AutomationML)", () => {
  const panels: DslUiManifestPanel[] = [
    {
      languageId: "qif",
      id: "qifEditor",
      viewType: "modelscript.qifEditor",
      title: "QIF 3.0 Dimensional Metrology & SPC Studio",
      webviewScriptName: "webviews/qif-qifEditor.js",
    },
    {
      languageId: "oscal",
      id: "oscalEditor",
      viewType: "modelscript.oscalEditor",
      title: "NIST OSCAL Security & cATO Studio",
      webviewScriptName: "webviews/oscal-oscalEditor.js",
    },
    {
      languageId: "automationml",
      id: "amlEditor",
      viewType: "modelscript.amlEditor",
      title: "AutomationML Workcell & Virtual Commissioning Studio",
      webviewScriptName: "webviews/automationml-amlEditor.js",
    },
  ];

  for (const panel of panels) {
    it(`resolves DslCustomEditorProvider for ${panel.viewType} and boots webview host bridge`, async () => {
      const mockContext = { extensionUri: vscode.Uri.parse("file:///workspace"), subscriptions: [] };
      const provider = new DslCustomEditorProvider(mockContext as unknown as vscode.ExtensionContext, panel);
      const posted: Array<{ type: string; code?: string; dialect?: string }> = [];
      let onMessage: ((msg: unknown) => Promise<void> | void) | undefined;
      const mockWebview = {
        options: {},
        html: "",
        cspSource: "vscode-webview:",
        asWebviewUri: (uri: vscode.Uri) => uri,
        postMessage: (m: { type: string; code?: string; dialect?: string }) => posted.push(m),
        onDidReceiveMessage: (cb: (msg: unknown) => Promise<void> | void) => {
          onMessage = cb;
          return { dispose: () => {} };
        },
      };
      const mockPanel = { webview: mockWebview, onDidDispose: () => ({ dispose: () => {} }) };
      const mockDoc = {
        uri: { toString: () => `file:///workspace/sample.${panel.languageId}` },
        getText: () => `<sample lang="${panel.languageId}"/>`,
      };

      await provider.resolveCustomTextEditor(
        mockDoc as unknown as vscode.TextDocument,
        mockPanel as unknown as vscode.WebviewPanel,
        {} as vscode.CancellationToken,
      );

      assert.ok(mockWebview.html.includes(panel.webviewScriptName), `HTML must load ${panel.webviewScriptName}`);
      assert.ok(mockWebview.html.includes('id="root"'), "HTML must include #root mount node");
      await onMessage?.({ type: "ready" });
      const syncMsg = posted.find((m) => m.type === "syncDocument");
      assert.ok(syncMsg, `Must post syncDocument payload for ${panel.viewType}`);
      assert.equal(syncMsg.dialect, panel.languageId);
    });
  }
});
