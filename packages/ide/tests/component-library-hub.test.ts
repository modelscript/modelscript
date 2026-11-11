// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as vscode from "vscode";
import { HUB_DOMAIN_FILTERS, HUB_GALLERY_COMPONENTS } from "../src/component-hub-catalog.js";
import {
  CURATED_LIBRARIES,
  fetchAnsatzRegistryComponents,
  getEffectiveInstalledDependencies,
  openAnsatzPackageHub,
  registerRegistryView,
  renderPackageHubHtml,
  sanitizeHubSvg,
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
          if (method === "modelscript/getComponentCatalog") {
            return {
              components: [
                {
                  fqn: "Modelica.Electrical.Analog.Semiconductors.Thyristor",
                  name: "Thyristor",
                  kind: "model",
                  packageName: "Modelica",
                  hasLiveIcon: true,
                },
              ],
            } as unknown as R;
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
      assert.ok(panel.webview.html.includes('id="subpkg-bar"'), "Should include subpackage filter bar");
      assert.ok(panel.webview.html.includes("const PAGE_SIZE = 72;"), "Should paginate component cards progressively");
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
        postedMessages.some((m) => m.command === "setCatalogComponents" && Array.isArray(m.components)),
        "Should hydrate full component catalog into webview via setCatalogComponents",
      );
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

  it("streams Ansatz registry components, sanitizes inline iconSvg, and degrades cleanly when offline", async () => {
    const origFetch = globalThis.fetch;
    try {
      const sanitized = sanitizeHubSvg(
        '<svg viewBox="0 0 60 60" onload="alert(1)"><script>evil()</script><foreignObject><div>x</div></foreignObject><a xlink:href="javascript:bad()"><rect width="30" height="30"/></a></svg>',
      );
      assert.ok(sanitized?.includes("<rect"), "Should preserve vector geometry");
      assert.equal(sanitized?.includes("<script"), false, "Should strip script tags");
      assert.equal(sanitized?.includes("foreignObject"), false, "Should strip foreignObject tags");
      assert.equal(sanitized?.includes("onload"), false, "Should strip inline event handlers");
      assert.equal(sanitized?.includes("javascript:"), false, "Should strip javascript: links");

      let requestedUrl = "";
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        requestedUrl = String(input);
        return new Response(
          JSON.stringify({
            total: 95,
            offset: 0,
            limit: 72,
            hasMore: true,
            components: [
              {
                fqn: "AcmePower.Grid.InverterPLL",
                name: "InverterPLL",
                kind: "block",
                domain: "power-grids",
                subpackage: "Grid",
                packageName: "AcmePower",
                packageVersion: "3.1.0",
                iconSvg: '<svg viewBox="0 0 80 80" onclick="bad()"><circle cx="40" cy="40" r="24"/></svg>',
              },
            ],
            availablePackages: [{ name: "AcmePower", version: "3.1.0", count: 95 }],
            availableSubpackages: [{ id: "Grid", label: "Grid", count: 22 }],
            packageDependencies: { AcmePower: { Modelica: ">=4.1.0" } },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as typeof fetch;

      const res = await fetchAnsatzRegistryComponents({
        q: "pll",
        domain: "power-grids",
        subpackage: "Grid",
        limit: 72,
        offset: 0,
      });
      assert.equal(res.fromRegistry, true);
      assert.equal(res.total, 95);
      assert.equal(res.hasMore, true);
      assert.equal(res.items.length, 1);
      assert.ok(requestedUrl.includes("/components?"));
      assert.ok(requestedUrl.includes("includeSvg=1"));
      assert.ok(res.items[0]!.iconSvg?.includes("<circle"));
      assert.equal(res.items[0]!.iconSvg?.includes("onclick"), false);

      // Verify offline fallback
      globalThis.fetch = (async () => {
        throw new Error("ECONNREFUSED");
      }) as typeof fetch;
      const offline = await fetchAnsatzRegistryComponents({ q: "pll" });
      assert.equal(offline.fromRegistry, false);
      assert.deepEqual(offline.items, []);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
