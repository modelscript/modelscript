import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";

export class StepViewerPanel {
  public static currentPanel: StepViewerPanel | undefined;
  public static readonly viewType = "modelscript.stepViewer";

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _client: LanguageClient;
  private _disposables: vscode.Disposable[] = [];
  /** Track the last opened STEP file URI so we can load meshes even when
   *  the active editor switches to a non-STEP file (e.g. SysML). */
  private _lastStepUri: string | undefined;

  public static createOrShow(extensionUri: vscode.Uri, client: LanguageClient) {
    const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;

    if (StepViewerPanel.currentPanel) {
      StepViewerPanel.currentPanel._panel.reveal(column);
      StepViewerPanel.currentPanel.update();
      return;
    }

    const panel = vscode.window.createWebviewPanel(StepViewerPanel.viewType, "3D CAD Viewer (STEP)", column, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
    });

    StepViewerPanel.currentPanel = new StepViewerPanel(panel, extensionUri, client);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, client: LanguageClient) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._client = client;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.command) {
          case "cadFeatureSelected":
            vscode.window.showInformationMessage(`Selected CAD Feature ID: ${message.id}`);
            // In the future, this will send an executeCommand to the LSP
            break;
          case "ready":
            // The STEP file may not be fully indexed by the LSP yet when
            // the webview is ready. Retry a few times with increasing delay.
            this.updateWithRetry(3, 500);
            break;
        }
      },
      null,
      this._disposables,
    );

    this._client.onNotification("modelscript/projectTreeChanged", () => {
      this.update();
    });

    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

    vscode.window.onDidChangeActiveTextEditor(
      () => {
        this.update();
      },
      null,
      this._disposables,
    );

    vscode.workspace.onDidChangeTextDocument(
      (e) => {
        if (/\.(step|stp|p21)$/i.test(e.document.uri.toString())) {
          this.update();
        }
      },
      null,
      this._disposables,
    );
  }

  private async updateWithRetry(retries: number, delayMs: number) {
    const meshes = await this.update();
    if ((!meshes || meshes.length === 0) && retries > 0) {
      setTimeout(() => this.updateWithRetry(retries - 1, delayMs * 2), delayMs);
    }
  }

  public async update(): Promise<unknown[] | undefined> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return undefined;
    }

    const activeUri = editor.document.uri.toString();

    // If the active file is a STEP file, remember it
    if (/\.(step|stp|p21)$/i.test(activeUri)) {
      this._lastStepUri = activeUri;
    }

    // Use the last known STEP URI (falls back to active if it's a STEP file)
    const uri = this._lastStepUri || activeUri;

    // We allow non-STEP URIs to pass through, as the LSP server will
    // automatically find the first referenced STEP file if the current
    // URI is a SysML file referencing STEP geometry.
    try {
      this._panel.webview.postMessage({ type: "setLoading", data: true });
      const stepMeshes = await this._client.sendRequest<unknown[]>("modelscript/getStepMeshes", { uri });
      this._panel.webview.postMessage({ type: "stepMeshes", data: stepMeshes });
      this._panel.webview.postMessage({ type: "setLoading", data: false });
      return stepMeshes;
    } catch (e) {
      console.warn("[STEP Viewer] Failed to get STEP meshes:", e);
      this._panel.webview.postMessage({ type: "setLoading", data: false });
    }
  }

  public dispose() {
    StepViewerPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "dist", "stepWebview.js"));
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>3D CAD Viewer (STEP)</title>
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
