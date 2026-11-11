// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as vscode from "vscode";
import { HUB_CURATED_OPEN_MODELS } from "../src/open-model-catalog.js";
import { openModelHub, openModelTarget, registerOpenModelHub, renderOpenModelHubHtml } from "../src/open-model-hub.js";
import type { LspClientLike } from "../src/registry-tree-provider.js";

describe("VS Code Visual Open Model Hub & modelscript.openModel Wiring", () => {
  it("renders strict CSP-compliant HTML with zero inline event handlers and connected schematic SVGs", () => {
    const html = renderOpenModelHubHtml({
      nonce: "testnonce987",
      cspSource: "vscode-webview://unit-test",
      initialMode: "gallery",
    });

    assert.ok(html.includes("script-src 'nonce-testnonce987'"), "Expected strict nonce CSP policy");
    const htmlWithoutScripts = html.replace(/<script\b[\s\S]*?<\/script>/gi, "");
    assert.ok(
      !/<[^>]+?\son[a-z]+\s*=/i.test(htmlWithoutScripts),
      "Webview HTML markup must not contain inline on*= event attributes",
    );
    assert.ok(
      html.includes("Examples &amp; Libraries") || html.includes("Examples & Libraries"),
      "Expected Examples & Libraries tab",
    );
    assert.ok(html.includes("Workspace Files"), "Expected Workspace Files tab");
    assert.ok(html.includes("Local File / Archive"), "Expected Local File / Archive tab");
    assert.ok(html.includes("Chua&#39;s Chaotic Circuit") || html.includes("Chua's Chaotic Circuit"));
    assert.ok(HUB_CURATED_OPEN_MODELS.length >= 13, "Expected at least 13 curated multi-domain models");
    for (const model of HUB_CURATED_OPEN_MODELS) {
      assert.ok(model.diagramSvg.includes("<svg"), `Expected inline SVG schematic for ${model.id}`);
      assert.ok(model.nodeCount > 0, `Expected positive nodeCount for ${model.id}`);
      assert.ok(model.fallbackCode.trim().length > 20, `Expected runnable fallback source for ${model.id}`);
    }
  });

  it("registers modelscript.openModel to launch the visual hub with no args and materialize models with LibraryTreeItem args", async () => {
    const registeredCommands = new Map<string, (...args: any[]) => any>();
    const executedCommands: Array<{ id: string; args: any[] }> = [];
    const writtenFiles: Array<{ uri: string; text: string }> = [];
    const createdPanels: Array<{ dispose: () => void }> = [];

    const origRegister = vscode.commands.registerCommand;
    const origExecute = vscode.commands.executeCommand;
    const origCreatePanel = vscode.window.createWebviewPanel;
    const origWriteFile = vscode.workspace.fs.writeFile;

    vscode.commands.registerCommand = (id: string, handler: any) => {
      registeredCommands.set(id, handler);
      return new vscode.Disposable(() => {});
    };
    (vscode.commands as any).executeCommand = async (id: string, ...args: any[]) => {
      executedCommands.push({ id, args });
      return undefined;
    };
    vscode.window.createWebviewPanel = (viewType: string, title: string) => {
      assert.equal(viewType, "modelscript.openModelHub");
      assert.equal(title, "Open Model");
      let disposeListener: (() => void) | undefined;
      const panelObj = {
        webview: {
          cspSource: "vscode-webview://test",
          asWebviewUri: (u: any) => u,
          postMessage: async () => true,
          onDidReceiveMessage: () => new vscode.Disposable(() => {}),
          html: "",
        },
        onDidDispose: (cb: () => void) => {
          disposeListener = cb;
          return new vscode.Disposable(() => {});
        },
        reveal: () => {},
        dispose: () => {
          disposeListener?.();
        },
      };
      createdPanels.push(panelObj);
      return panelObj as any;
    };
    vscode.workspace.fs.writeFile = async (uri: any, content: Uint8Array) => {
      writtenFiles.push({ uri: uri.toString(), text: new TextDecoder().decode(content) });
    };

    try {
      const mockContext: any = { subscriptions: [] };
      const mockClient: LspClientLike = {
        sendNotification: () => {},
        sendRequest: async <T = unknown>(method: string, params?: any): Promise<T> => {
          if (
            method === "modelscript/getClassSource" &&
            params?.className === "Buildings.Examples.HydronicHeatingLoop"
          ) {
            return {
              uri: "modelica:/packages/Buildings/Buildings/package.mo",
              content: "model HydronicHeatingLoop\n  Real T = 293.15;\nequation\nend HydronicHeatingLoop;\n",
            } as T;
          }
          if (method === "modelscript/getMountedLibraries") {
            return { mounted: [{ name: "Modelica", version: "4.1.0" }], loading: [] } as T;
          }
          return {} as T;
        },
      };

      registerOpenModelHub(mockContext, () => mockClient);
      assert.ok(registeredCommands.has("modelscript.openModel"), "Expected modelscript.openModel command");
      assert.ok(
        registeredCommands.has("modelscript.openModelGallery"),
        "Expected modelscript.openModelGallery command",
      );

      // 1. Zero-argument invocation opens the visual Open Model Hub
      const openCmd = registeredCommands.get("modelscript.openModel")!;
      await openCmd();
      assert.equal(createdPanels.length, 1, "Zero-arg modelscript.openModel should open the visual Open Model Hub");

      // 2. LibraryTreeItem-style invocation materializes source and opens diagram
      const opened = await openModelTarget(
        mockContext,
        {
          className: "Buildings.Examples.HydronicHeatingLoop",
          uri: "modelica:/packages/Buildings/Buildings/package.mo",
        },
        mockClient,
        "split",
      );
      assert.equal(opened, true);
      assert.equal(writtenFiles.length, 1);
      assert.ok(writtenFiles[0]!.uri.endsWith("HydronicHeatingLoop.mo"));
      assert.ok(writtenFiles[0]!.text.includes("model HydronicHeatingLoop"));
      assert.ok(
        executedCommands.some((c) => c.id === "modelscript.openDiagram"),
        "Expected modelscript.openDiagram to be triggered in split view",
      );
    } finally {
      for (const p of createdPanels) p.dispose();
      vscode.commands.registerCommand = origRegister;
      vscode.commands.executeCommand = origExecute;
      vscode.window.createWebviewPanel = origCreatePanel;
      vscode.workspace.fs.writeFile = origWriteFile;
    }
  });

  it("auto-installs unmounted Ansatz packages on openCuratedModel and previews local staged files via LSP", async () => {
    const postedMessages: any[] = [];
    const executedCommands: Array<{ id: string; args: any[] }> = [];
    let receiveMessageHandler: ((msg: any) => Promise<void>) | undefined;
    let disposeListener: (() => void) | undefined;

    const origCreatePanel = vscode.window.createWebviewPanel;
    const origExecute = vscode.commands.executeCommand;
    const origWriteFile = vscode.workspace.fs.writeFile;

    vscode.window.createWebviewPanel = () =>
      ({
        webview: {
          cspSource: "vscode-webview://test",
          asWebviewUri: (u: any) => u,
          postMessage: async (msg: any) => {
            postedMessages.push(msg);
            return true;
          },
          onDidReceiveMessage: (listener: any) => {
            receiveMessageHandler = listener;
            return new vscode.Disposable(() => {});
          },
          html: "",
        },
        onDidDispose: (listener: () => void) => {
          disposeListener = listener;
          return new vscode.Disposable(() => {});
        },
        reveal: () => {},
        dispose: () => {
          disposeListener?.();
        },
      }) as any;
    (vscode.commands as any).executeCommand = async (id: string, ...args: any[]) => {
      executedCommands.push({ id, args });
      return undefined;
    };
    vscode.workspace.fs.writeFile = async () => {};

    try {
      const mockContext: any = { subscriptions: [] };
      const mockClient: LspClientLike = {
        sendNotification: () => {},
        sendRequest: async <T = unknown>(method: string, params?: any): Promise<T> => {
          if (method === "modelscript/getMountedLibraries") {
            return { mounted: [{ name: "Modelica", version: "4.1.0" }], loading: [] } as T;
          }
          if (method === "modelscript/getDiagramPreviewSvgs") {
            const firstId = params?.items?.[0]?.id ?? "staged";
            return {
              previews: {
                [firstId]: {
                  svg: '<svg viewBox="0 0 200 120" width="100%" height="100%"><rect width="40" height="24"/></svg>',
                  nodeCount: 3,
                  edgeCount: 2,
                },
              },
            } as T;
          }
          if (method === "modelscript/getClassSource") {
            return { content: "model HydronicHeatingLoop end HydronicHeatingLoop;" } as T;
          }
          return {} as T;
        },
      };

      const panel = openModelHub(mockContext, mockClient, "gallery");
      assert.ok(receiveMessageHandler, "Expected webview message listener to be registered");

      // 1. Opening Buildings hydronic loop when Buildings is unmounted triggers auto-install first
      await receiveMessageHandler!({
        command: "openCuratedModel",
        id: "buildings-hydronic-loop",
        viewMode: "diagram",
      });

      const installCall = executedCommands.find((c) => c.id === "modelscript.registry.install");
      assert.ok(installCall, "Expected modelscript.registry.install to auto-mount unmounted Buildings library");
      assert.deepEqual(installCall.args, ["Buildings", "11.0.0"]);
      assert.ok(executedCommands.some((c) => c.id === "modelscript.openDiagram"));

      // 2. Previewing a local file renders live schematic SVG through modelscript/getDiagramPreviewSvgs
      await receiveMessageHandler!({
        command: "previewStagedText",
        filename: "DroppedCircuit.mo",
        code: "model DroppedCircuit end DroppedCircuit;",
      });

      const stagedMsg = postedMessages.find((m) => m.command === "setStagedFile");
      assert.ok(stagedMsg, "Expected setStagedFile message with rendered schematic preview");
      assert.equal(stagedMsg.staged.filename, "DroppedCircuit.mo");
      assert.equal(stagedMsg.staged.nodeCount, 3);
      assert.equal(stagedMsg.staged.edgeCount, 2);
      assert.ok(stagedMsg.staged.previewSvg.includes("<svg"));

      panel.dispose();
    } finally {
      vscode.window.createWebviewPanel = origCreatePanel;
      vscode.commands.executeCommand = origExecute;
      vscode.workspace.fs.writeFile = origWriteFile;
    }
  });
});
