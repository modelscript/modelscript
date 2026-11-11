// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as vscode from "vscode";
import { HUB_DOMAIN_FILTERS, HUB_GALLERY_COMPONENTS } from "../src/component-hub-catalog.js";
import {
  CURATED_LIBRARIES,
  getEffectiveInstalledDependencies,
  openAnsatzPackageHub,
  registerRegistryView,
  renderPackageHubHtml,
} from "../src/registry-tree-provider.js";

describe("VS Code Component & Library Hub", () => {
  it("renders CSP-safe Component & Library Hub HTML with schematic SVGs and zero inline event attributes", () => {
    const html = renderPackageHubHtml(CURATED_LIBRARIES, HUB_GALLERY_COMPONENTS, { Modelica: "4.1.0" });

    assert.ok(html.includes("Component &amp; Library Hub"), "Should render unified hub title");
    assert.ok(html.includes('data-mode="components"'), "Should include Components segmented tab");
    assert.ok(html.includes('data-mode="libraries"'), "Should include Libraries segmented tab");
    assert.ok(html.includes('data-mode="import"'), "Should include Import segmented tab");
    assert.ok(html.includes("Modelica.Electrical.Analog.Basic.Resistor"), "Should serialize Resistor component");
    assert.ok(html.includes("PlanarMechanics.Joints.Revolute"), "Should serialize Revolute component");
    assert.equal(HUB_DOMAIN_FILTERS.length, 8, "Should define 8 crisp monochrome domain filters");
    assert.ok(HUB_GALLERY_COMPONENTS.length >= 28, "Should include 28+ curated schematic components");

    // Must not contain CSP-violating inline HTML event attributes
    assert.equal(/\bon(?:click|input|change)\s*=/i.test(html), false, "HTML must not contain inline on* handlers");
  });

  it("merges mounted LSP libraries into getEffectiveInstalledDependencies even without package.json", async () => {
    const deps = await getEffectiveInstalledDependencies({
      sendNotification: () => {},
      sendRequest: async <R>(method: string): Promise<R> => {
        if (method === "modelscript/getMountedLibraries") {
          return {
            mounted: [
              { name: "Modelica", version: "4.1.0", explicitlyInstalled: false },
              { name: "SPICE-Standard", version: "1.0.0", explicitlyInstalled: true },
            ],
            loading: [],
          } as unknown as R;
        }
        return undefined as unknown as R;
      },
    });

    assert.equal(deps["Modelica"], "4.1.0");
    assert.equal(deps["SPICE-Standard"], "1.0.0");
  });

  it("awaits modelscript/installPackage, auto-mounts peer dependencies, and places components with auto-install", async () => {
    const registeredCommands = new Map<string, (...args: any[]) => any>();
    const origRegister = vscode.commands.registerCommand;
    const origExecute = vscode.commands.executeCommand;
    const origCreatePanel = vscode.window.createWebviewPanel;
    const origActiveEditor = vscode.window.activeTextEditor;
    const origApplyEdit = vscode.workspace.applyEdit;

    const mountedMap = new Map<string, string>();
    const installCalls: Array<{ name: string; version: string }> = [];
    const diagramApplyCalls: any[] = [];
    const appliedEdits: any[] = [];
    let libraryRefreshCount = 0;
    let messageHandler: ((msg: Record<string, unknown>) => Promise<void>) | undefined;
    const postedMessages: any[] = [];

    try {
      (vscode.commands as any).registerCommand = (id: string, handler: (...args: any[]) => any) => {
        registeredCommands.set(id, handler);
        return new vscode.Disposable(() => registeredCommands.delete(id));
      };
      (vscode.commands as any).executeCommand = async (id: string, ...args: any[]) => {
        if (id === "modelscript.libraryView.refresh") {
          libraryRefreshCount++;
          return undefined;
        }
        const fn = registeredCommands.get(id);
        return fn ? await fn(...args) : undefined;
      };
      (vscode.window as any).activeTextEditor = {
        document: {
          uri: vscode.Uri.parse("file:///workspace/TestCircuit.mo"),
          getText: () => "model TestCircuit\nequation\nend TestCircuit;\n",
        },
        selection: { active: new vscode.Position(1, 0) },
      };
      (vscode.workspace as any).applyEdit = async (edit: any) => {
        appliedEdits.push(edit);
        return true;
      };
      (vscode.window as any).createWebviewPanel = () => ({
        webview: {
          html: "",
          asWebviewUri: (u: any) => u,
          postMessage: async (msg: any) => {
            postedMessages.push(msg);
            return true;
          },
          onDidReceiveMessage: (cb: (msg: Record<string, unknown>) => Promise<void>) => {
            messageHandler = cb;
            return new vscode.Disposable(() => {});
          },
        },
        reveal: () => {},
        onDidDispose: () => new vscode.Disposable(() => {}),
        dispose: () => {},
      });

      const mockLsp = {
        sendNotification: () => {},
        sendRequest: async <R>(method: string, params?: any): Promise<R> => {
          if (method === "modelscript/getMountedLibraries") {
            return {
              mounted: Array.from(mountedMap.entries()).map(([name, version]) => ({
                name,
                version,
                explicitlyInstalled: true,
              })),
              loading: [],
            } as unknown as R;
          }
          if (method === "modelscript/installPackage") {
            installCalls.push({ name: params.name, version: params.version });
            mountedMap.set(params.name, params.version);
            return { ok: true, name: params.name, version: params.version } as unknown as R;
          }
          if (method === "modelscript/diagram.applyEdits") {
            diagramApplyCalls.push(params);
            return {
              edits: [
                {
                  range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } },
                  newText: "  PlanarMechanics.Joints.Revolute rev1;\n",
                },
              ],
            } as unknown as R;
          }
          return undefined as unknown as R;
        },
      };

      const fakeContext: any = { subscriptions: [] };
      registerRegistryView(fakeContext, mockLsp);

      const panel = openAnsatzPackageHub(fakeContext, mockLsp);
      assert.ok(panel.webview.html.includes("Component &amp; Library Hub"));
      assert.ok(messageHandler, "Webview message listener should be attached");

      // Placing a component from PlanarMechanics when neither Modelica nor PlanarMechanics is mounted
      // should auto-mount peer dependency Modelica >= 4.0.0 AND PlanarMechanics, then apply diagram edit!
      await messageHandler!({
        command: "placeComponent",
        requestId: "req-1",
        fqn: "PlanarMechanics.Joints.Revolute",
        shortName: "Revolute Joint",
        kind: "model",
        declarationSnippet: "PlanarMechanics.Joints.Revolute rev1;",
        packageName: "PlanarMechanics",
        packageVersion: "1.6.1",
      });

      assert.equal(
        installCalls.some((c) => c.name === "Modelica"),
        true,
        "Peer dependency Modelica should be auto-mounted",
      );
      assert.equal(
        installCalls.some((c) => c.name === "PlanarMechanics" && c.version === "1.6.1"),
        true,
        "Parent library PlanarMechanics@1.6.1 should be auto-mounted on component placement",
      );
      assert.equal(diagramApplyCalls.length, 1, "Should invoke modelscript/diagram.applyEdits for .mo model");
      assert.equal(appliedEdits.length, 1, "Should apply WorkspaceEdit to target document");
      assert.ok(libraryRefreshCount >= 1, "Should refresh Libraries tree view after mounting");
      assert.ok(
        postedMessages.some((m) => m.command === "actionComplete" && m.requestId === "req-1" && m.ok === true),
        "Should notify webview of action completion",
      );
    } finally {
      (vscode.commands as any).registerCommand = origRegister;
      (vscode.commands as any).executeCommand = origExecute;
      (vscode.window as any).createWebviewPanel = origCreatePanel;
      (vscode.window as any).activeTextEditor = origActiveEditor;
      (vscode.workspace as any).applyEdit = origApplyEdit;
    }
  });
});
