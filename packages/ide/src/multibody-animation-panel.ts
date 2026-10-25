// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";
import { BaseWebviewPanel } from "./webview/base-panel.js";

export class MultiBodyAnimationPanel extends BaseWebviewPanel {
  public static currentPanel: MultiBodyAnimationPanel | undefined;
  public static readonly viewType = "modelscript.multibodyAnimation";

  private readonly _client: LanguageClient;
  public sourceUri?: string | undefined;

  public static async createOrShow(
    extensionUri: vscode.Uri,
    client: LanguageClient,
    simulationData: { t: number[]; y: number[][]; states: string[] },
    sourceUri: string,
  ) {
    const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;

    if (MultiBodyAnimationPanel.currentPanel) {
      MultiBodyAnimationPanel.currentPanel.sourceUri = sourceUri;
      MultiBodyAnimationPanel.currentPanel._panel.reveal(column);
      await MultiBodyAnimationPanel.currentPanel.loadData(simulationData);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      MultiBodyAnimationPanel.viewType,
      "3D Multi-Body Animation",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
      },
    );

    MultiBodyAnimationPanel.currentPanel = new MultiBodyAnimationPanel(panel, extensionUri, client, sourceUri);
    await MultiBodyAnimationPanel.currentPanel.loadData(simulationData);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, client: LanguageClient, sourceUri: string) {
    super(panel, extensionUri);
    this._client = client;
    this.sourceUri = sourceUri;

    this._panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.type) {
          case "ready":
            break;
        }
      },
      null,
      this._disposables,
    );

    this._panel.webview.html = this.getHtmlShell({
      title: "3D Multi-Body Animation",
      scriptName: "multibody-animation-webview.js",
    });
  }

  public async loadData(simulationData: { t: number[]; y: number[][]; states: string[] }) {
    if (!this.sourceUri) return;

    // 1. Fetch CAD Components to get the bindings
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cadComponents = await this._client.sendRequest<any[]>("modelscript/getCadComponents", {
      uri: this.sourceUri,
    });

    // 2. Fetch STEP meshes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stepMeshes = await this._client.sendRequest<any[]>("modelscript/getStepMeshes", { uri: this.sourceUri });

    this._panel.webview.postMessage({
      type: "init",
      data: {
        stepMeshes,
        cadComponents,
        simulationData,
      },
    });
  }

  /**
   * Push live cosimulation variable values to the webview for real-time animation.
   */
  public sendLiveValues(values: Record<string, number>, time: number): void {
    this._panel.webview.postMessage({
      type: "liveValues",
      data: { values, time },
    });
  }

  public focusPart(partName: string): void {
    this._panel.webview.postMessage({
      type: "focusPart",
      partName,
    });
  }

  public reveal(column?: vscode.ViewColumn): void {
    this._panel.reveal(column);
  }

  public override dispose(): void {
    MultiBodyAnimationPanel.currentPanel = undefined;
    super.dispose();
  }
}
