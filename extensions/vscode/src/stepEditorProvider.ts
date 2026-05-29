import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";

export class StepEditorProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = "modelscript.stepEditor";

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly _client: LanguageClient,
  ) {}

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _token: vscode.CancellationToken,
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "dist")],
    };

    let disposed = false;
    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

    const loadMeshes = async (retries = 3, delayMs = 500) => {
      if (disposed) return;
      try {
        webviewPanel.webview.postMessage({ type: "setLoading", data: true });
        const stepMeshes = await this._client.sendRequest<unknown[]>("modelscript/getStepMeshes", {
          uri: document.uri.toString(),
        });

        if (!disposed) {
          webviewPanel.webview.postMessage({ type: "stepMeshes", data: stepMeshes });
          webviewPanel.webview.postMessage({ type: "setLoading", data: false });
        }

        // If no meshes loaded and we have retries left, wait and try again
        // (LSP may still be parsing the STEP file)
        if ((!stepMeshes || (stepMeshes as unknown[]).length === 0) && retries > 0 && !disposed) {
          setTimeout(() => loadMeshes(retries - 1, delayMs * 2), delayMs);
        }
      } catch (e) {
        console.warn("[STEP Editor] Failed to get STEP meshes:", e);
        if (!disposed) {
          webviewPanel.webview.postMessage({ type: "setLoading", data: false });
        }
        if (retries > 0 && !disposed) {
          setTimeout(() => loadMeshes(retries - 1, delayMs * 2), delayMs);
        }
      }
    };

    webviewPanel.webview.onDidReceiveMessage((message) => {
      switch (message.type || message.command) {
        case "ready":
          loadMeshes();
          break;
        case "cadFeatureSelected":
          vscode.window.showInformationMessage(`Selected CAD Feature ID: ${message.id}`);
          break;
        case "generateMultiBody":
          vscode.commands.executeCommand("modelscript.generateMultiBody");
          break;
      }
    });

    // When the LSP finishes indexing anything, reload meshes in case our STEP file was just processed
    const treeSubscription = this._client.onNotification("modelscript/projectTreeChanged", () => {
      loadMeshes(1, 0); // No retries needed here, it's already an update
    });

    const changeSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        loadMeshes(1, 0);
      }
    });

    webviewPanel.onDidDispose(() => {
      disposed = true;
      treeSubscription.dispose();
      changeSubscription.dispose();
    });
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "dist", "stepWebview.js"));
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>3D CAD Viewer (STEP)</title>
    <style>
      html, body, #root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
    </style>
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
