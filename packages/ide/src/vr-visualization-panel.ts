// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import { BaseWebviewPanel } from "./webview/base-panel.js";

export class VrVisualizationPanel extends BaseWebviewPanel {
  public static currentPanel: VrVisualizationPanel | undefined;
  public static readonly viewType = "modelscript.vrVisualization";

  public static createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

    if (VrVisualizationPanel.currentPanel) {
      VrVisualizationPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      VrVisualizationPanel.viewType,
      "VR Factory Visualization",
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
      },
    );

    VrVisualizationPanel.currentPanel = new VrVisualizationPanel(panel, extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    super(panel, extensionUri);

    this._panel.title = "VR Factory Visualization";
    this._panel.webview.html = this.getHtmlShell({
      title: "VR Factory Visualization",
      scriptName: "vr-visualization-webview.js",
      rootId: "container",
    });

    const mqttWsUrl =
      vscode.workspace.getConfiguration("modelscript").get<string>("mqtt.brokerUrl") || "ws://localhost:1892";
    this._panel.webview.postMessage({ command: "config", mqttWsUrl });

    this._panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.command) {
          case "ready":
            this._panel.webview.postMessage({ command: "config", mqttWsUrl });
            return;
          case "alert":
            vscode.window.showErrorMessage(message.text);
            return;
        }
      },
      null,
      this._disposables,
    );
  }

  public override dispose(): void {
    VrVisualizationPanel.currentPanel = undefined;
    super.dispose();
  }

  /**
   * Pushes a new VTK payload (from the orchestrator) to the WebXR view.
   */
  public updateVtkData(participantId: string, time: number, vtkData: Uint8Array) {
    this._panel.webview.postMessage({
      command: "vtkData",
      participantId,
      time,
      vtkData: Array.from(vtkData),
    });
  }
}
