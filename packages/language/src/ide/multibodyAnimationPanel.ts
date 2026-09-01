import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";

export class MultiBodyAnimationPanel {
  public static currentPanel: MultiBodyAnimationPanel | undefined;
  public static readonly viewType = "modelscript.multibodyAnimation";

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _client: LanguageClient;
  private _disposables: vscode.Disposable[] = [];

  public sourceUri?: string;

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
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._client = client;
    this.sourceUri = sourceUri;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

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

    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
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

  public dispose() {
    MultiBodyAnimationPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "dist", "multibodyAnimationWebview.js"),
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>3D Multi-Body Animation</title>
</head>
<body class="vscode-dark">
    <div id="root"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce() {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
