// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser.js";
import type { DiagramEditorProvider } from "../diagram-editor-provider.js";
import { ExperimentsTreeProvider } from "../experiments-tree.js";
import { LibraryTreeProvider } from "../library-tree-provider.js";
import { MqttTreeProvider } from "../mqtt-tree-provider.js";
import { OWL2ClassHierarchyProvider } from "../owl2-class-hierarchy-provider.js";
import { OWL2PropertyHierarchyProvider } from "../owl2-property-hierarchy-provider.js";
import { registerRegistryView } from "../registry-tree-provider.js";
import { registerScmTreeView } from "../scm-tree-view.js";

export class TreeViewController implements vscode.Disposable {
  private _disposables: vscode.Disposable[] = [];
  public readonly libraryTreeProvider: LibraryTreeProvider;
  public libraryTreeView?: vscode.TreeView<any> | undefined;
  public mqttTreeProvider?: MqttTreeProvider | undefined;
  public experimentsTreeProvider?: ExperimentsTreeProvider | undefined;

  constructor(
    context: vscode.ExtensionContext,
    private readonly getClient: () => LanguageClient | undefined,
    private readonly diagramProvider?: DiagramEditorProvider | undefined,
  ) {
    const client = this.getClient() as LanguageClient;

    // 1. Library Tree View
    this.libraryTreeProvider = new LibraryTreeProvider(client, context);
    if (this.diagramProvider) {
      this.libraryTreeProvider.onDragStart = (data) => {
        this.diagramProvider!.postToActiveWebviews({ type: "startPlacement", isDrag: true, ...data });
      };
      this.libraryTreeProvider.onDragEnd = () => {
        this.diagramProvider!.postToActiveWebviews({ type: "dragEnd" });
      };
      this.diagramProvider.onDidOpenDocument = (uri) => {
        this.libraryTreeProvider.setDocumentUri(uri);
      };
    }

    try {
      this.libraryTreeView = vscode.window.createTreeView("modelscript.libraryTree", {
        treeDataProvider: this.libraryTreeProvider,
        dragAndDropController: this.libraryTreeProvider,
        canSelectMany: false,
      });
      this._disposables.push(this.libraryTreeView);

      this._disposables.push(
        vscode.commands.registerCommand("modelscript.libraryView.refresh", () => {
          this.libraryTreeProvider.refresh();
        }),
      );
    } catch (e) {
      console.warn("Could not register modelscript.libraryTree view:", e);
    }

    // 2. MQTT Tree View
    try {
      this.mqttTreeProvider = new MqttTreeProvider(client, context);
      const mqttTreeView = vscode.window.createTreeView("modelscript.mqttTree", {
        treeDataProvider: this.mqttTreeProvider,
        dragAndDropController: this.mqttTreeProvider,
        canSelectMany: false,
      });
      this._disposables.push(mqttTreeView, this.mqttTreeProvider);
      if (mqttTreeView.visible) {
        this.mqttTreeProvider.startPolling();
      }
      if (typeof mqttTreeView.onDidChangeVisibility === "function") {
        this._disposables.push(
          mqttTreeView.onDidChangeVisibility((e) => {
            if (e.visible) {
              this.mqttTreeProvider?.startPolling();
            } else {
              this.mqttTreeProvider?.stopPolling();
            }
          }),
        );
      }
    } catch (e) {
      console.warn("Could not register modelscript.mqttTree view:", e);
    }

    // 3. Experiments Tree View
    try {
      this.experimentsTreeProvider = new ExperimentsTreeProvider(client);
      const experimentsTreeView = vscode.window.createTreeView("modelscript.experimentsView", {
        treeDataProvider: this.experimentsTreeProvider,
        canSelectMany: false,
      });
      this._disposables.push(experimentsTreeView);
    } catch (e) {
      console.warn("Could not register modelscript.experimentsView view:", e);
    }

    // 4. Registry and SCM Views
    registerRegistryView(context, client);
    registerScmTreeView(context, client);

    // 5. OWL2 Hierarchy Views
    if (client) {
      try {
        const owlClassProvider = new OWL2ClassHierarchyProvider(client);
        const owlPropertyProvider = new OWL2PropertyHierarchyProvider(client);
        this._disposables.push(
          vscode.window.createTreeView("modelscript.owl2ClassHierarchy", {
            treeDataProvider: owlClassProvider,
            canSelectMany: false,
          }),
          vscode.window.createTreeView("modelscript.owl2PropertyHierarchy", {
            treeDataProvider: owlPropertyProvider,
            canSelectMany: false,
          }),
        );
        this._disposables.push(
          vscode.window.onDidChangeActiveTextEditor((editor) => {
            const docUri = editor?.document.uri.toString();
            if (docUri && /\.(?:fss|owl|ttl)$/i.test(docUri)) {
              owlClassProvider.setDocumentUri(docUri);
              owlPropertyProvider.setDocumentUri(docUri);
            }
          }),
        );
      } catch (e) {
        console.warn("Could not register OWL2 hierarchy views:", e);
      }
    }
  }

  public dispose(): void {
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) d.dispose();
    }
  }
}
