// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import * as vscode from "vscode";
import { PolyglotLiveSyncManager, TARGET_DOMAIN_OPTIONS, registerPolyglotActions } from "../src/polyglot-actions.js";
import { PolyglotVisualizerPanel } from "../src/polyglot-visualizer-panel.js";

describe("Polyglot Live Model Sync & 3D Visualizer IDE Integration", () => {
  it("exposes all target engineering domains in quick-pick options", () => {
    const targetLangs = TARGET_DOMAIN_OPTIONS.map((opt) => opt.targetLang);
    assert.deepStrictEqual(targetLangs, ["sysml2", "modelica", "owl2", "step", "csv", "scad"]);
  });

  it("manages side-by-side model pairs in PolyglotLiveSyncManager", () => {
    const syncManager = PolyglotLiveSyncManager.getInstance();
    syncManager.clearPairs();

    syncManager.registerPair("file:///workspace/drone.mo", "untitled:doc_sysml_1", "modelica", "sysml2");

    const activePairs = syncManager.getActivePairs();
    assert.strictEqual(activePairs.length, 1);
    assert.strictEqual(activePairs[0]!.sourceUri, "file:///workspace/drone.mo");
    assert.strictEqual(activePairs[0]!.targetUri, "untitled:doc_sysml_1");
    assert.strictEqual(activePairs[0]!.sourceLang, "modelica");
    assert.strictEqual(activePairs[0]!.targetLang, "sysml2");

    // Toggle live sync
    assert.strictEqual(syncManager.isSyncEnabled(), true);
    syncManager.toggleSync(false);
    assert.strictEqual(syncManager.isSyncEnabled(), false);
    syncManager.toggleSync(true);
    assert.strictEqual(syncManager.isSyncEnabled(), true);

    // Unregister pair
    syncManager.unregisterPair("file:///workspace/drone.mo");
    assert.strictEqual(syncManager.getActivePairs().length, 0);
  });

  it("performs live forward transformation between paired documents", async () => {
    const syncManager = PolyglotLiveSyncManager.getInstance();
    syncManager.clearPairs();

    const sourceUri = "file:///workspace/quadcopter.mo";
    const targetUri = "untitled:quadcopter_sysml";

    const sourceDoc = {
      uri: vscode.Uri.parse(sourceUri),
      fileName: "/workspace/quadcopter.mo",
      getText: () => `model Quadcopter\n  parameter Real mass = 1.5;\nend Quadcopter;`,
      positionAt: (offset: number) => new vscode.Position(0, offset),
    };

    let targetContent = "";
    const targetDoc = {
      uri: vscode.Uri.parse(targetUri),
      fileName: "/workspace/quadcopter.sysml",
      getText: () => targetContent,
      positionAt: (offset: number) => new vscode.Position(0, offset),
    };

    // Override target doc text setter
    (targetDoc as any).getText = () => targetContent;

    // Register in mock vscode workspace
    (vscode.workspace.textDocuments as any) = [sourceDoc, targetDoc];

    // Intercept applyEdit to update targetDoc content
    const origApplyEdit = vscode.workspace.applyEdit;
    (vscode.workspace as any).applyEdit = async (edit: any) => {
      for (const entry of edit.entries) {
        if (entry.uri.toString() === targetUri) {
          targetContent = entry.newText;
        }
      }
      return true;
    };

    try {
      syncManager.registerPair(sourceUri, targetUri, "modelica", "sysml2");
      await syncManager.performSync(sourceUri, targetUri, "sysml2");

      assert.ok(targetContent.length > 0, "Target document should receive projected content");
      assert.ok(
        targetContent.includes("quadcopter") || targetContent.includes("part def"),
        "Target SysML v2 source should contain projected part def",
      );
    } finally {
      (vscode.workspace as any).applyEdit = origApplyEdit;
      syncManager.clearPairs();
    }
  });

  it("creates and initializes PolyglotVisualizerPanel with 3D CSG solids", async () => {
    const sourceUri = "file:///workspace/robot_arm.scad";
    const sourceDoc = {
      uri: vscode.Uri.parse(sourceUri),
      fileName: "/workspace/robot_arm.scad",
      getText: () => `
        cube([10, 20, 30]);
        cylinder(h=40, r=5);
        sphere(r=15);
      `,
      positionAt: (offset: number) => new vscode.Position(0, offset),
    };

    (vscode.workspace.textDocuments as any) = [sourceDoc];

    let postedState: any = null;
    const fakeWebview = {
      html: "",
      onDidReceiveMessage: () => new vscode.Disposable(() => {}),
      postMessage: async (msg: any) => {
        if (msg.type === "stateUpdate") {
          postedState = msg.state;
        }
        return true;
      },
    };

    const origCreateWebviewPanel = vscode.window.createWebviewPanel;
    (vscode.window as any).createWebviewPanel = () => ({
      webview: fakeWebview,
      reveal: () => {},
      dispose: () => {},
      onDidDispose: () => new vscode.Disposable(() => {}),
    });

    try {
      PolyglotVisualizerPanel.createOrShow(vscode.Uri.file("/mock/extension"), undefined, sourceUri);

      assert.ok(PolyglotVisualizerPanel.currentPanel, "Current panel must be instantiated");
      assert.strictEqual(PolyglotVisualizerPanel.currentPanel.sourceUri, sourceUri);

      await PolyglotVisualizerPanel.currentPanel.refresh();

      assert.ok(postedState, "Webview must receive stateUpdate message");
      assert.strictEqual(postedState.sourceLang, "scad");
      assert.strictEqual(postedState.confluent, true);
      assert.ok(postedState.elements.shapes.length >= 3, "Should detect 3 CSG shapes");

      const shapeTypes = postedState.elements.shapes.map((s: any) => s.type);
      assert.ok(shapeTypes.includes("cube"), "Should detect cube solid");
      assert.ok(shapeTypes.includes("cylinder"), "Should detect cylinder solid");
      assert.ok(shapeTypes.includes("sphere"), "Should detect sphere solid");
    } finally {
      (vscode.window as any).createWebviewPanel = origCreateWebviewPanel;
      if (PolyglotVisualizerPanel.currentPanel) {
        PolyglotVisualizerPanel.currentPanel.dispose();
      }
    }
  });

  it("registers polyglot commands into the IDE context", () => {
    const registeredCommands: string[] = [];
    const origRegisterCommand = vscode.commands.registerCommand;
    (vscode.commands as any).registerCommand = (id: string, handler: any) => {
      registeredCommands.push(id);
      return origRegisterCommand(id, handler);
    };

    try {
      const mockContext: any = {
        extensionUri: vscode.Uri.file("/mock/ext"),
        subscriptions: [],
      };

      const disposable = registerPolyglotActions(mockContext);
      assert.ok(registeredCommands.includes("modelscript.projectModel"));
      assert.ok(registeredCommands.includes("modelscript.openPolyglotVisualizer"));
      assert.ok(registeredCommands.includes("modelscript.togglePolyglotSync"));

      disposable.dispose();
    } finally {
      (vscode.commands as any).registerCommand = origRegisterCommand;
    }
  });

  it("applies 3D gizmo delta writeback from PolyglotVisualizerPanel to source document", async () => {
    const sourceUri = "file:///workspace/drone.scad";
    const scadSource = `translate([5, 10, 15]) {\n  cube([10, 10, 10]);\n}\n`;

    let appliedEdit: any = null;
    const origApplyEdit = vscode.workspace.applyEdit;
    (vscode.workspace as any).applyEdit = async (edit: any) => {
      appliedEdit = edit;
      return true;
    };

    const sourceDoc = {
      uri: vscode.Uri.parse(sourceUri),
      fileName: "/workspace/drone.scad",
      getText: () => scadSource,
      positionAt: (offset: number) => new vscode.Position(0, offset),
    };

    (vscode.workspace.textDocuments as any) = [sourceDoc];

    const fakeWebview = {
      html: "",
      onDidReceiveMessage: () => new vscode.Disposable(() => {}),
      postMessage: async () => true,
    };

    const origCreateWebviewPanel = vscode.window.createWebviewPanel;
    (vscode.window as any).createWebviewPanel = () => ({
      webview: fakeWebview,
      reveal: () => {},
      dispose: () => {},
      onDidDispose: () => new vscode.Disposable(() => {}),
    });

    try {
      PolyglotVisualizerPanel.createOrShow(vscode.Uri.file("/mock/extension"), undefined, sourceUri);

      const panel = PolyglotVisualizerPanel.currentPanel!;
      assert.ok(panel, "Current panel must be instantiated");

      await panel.handleGizmoCommit({
        shapeName: "cube1",
        delta: [10, 0, 0],
        newPosition: [15, 10, 15],
        sourceMetadata: {
          transformMethod: "translate",
          argIndex: 0,
        },
      });

      assert.ok(appliedEdit, "WorkspaceEdit must be applied");
      const edits = (appliedEdit as any)._edits ?? (appliedEdit as any).entries ?? [];
      assert.ok(edits.length > 0, "Should have edit replacement");
      assert.strictEqual(edits[0].newText, "[15, 10, 15]");
    } finally {
      (vscode.workspace as any).applyEdit = origApplyEdit;
      (vscode.window as any).createWebviewPanel = origCreateWebviewPanel;
      if (PolyglotVisualizerPanel.currentPanel) {
        PolyglotVisualizerPanel.currentPanel.dispose();
      }
    }
  });
});
