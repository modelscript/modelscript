import * as vscode from "vscode";

export class GCodeEditorProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = "modelscript.gcodeViewer";

  constructor(private readonly context: vscode.ExtensionContext) {}

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

    const loadGCode = async () => {
      if (disposed) return;
      try {
        const text = document.getText();
        if (!disposed) {
          webviewPanel.webview.postMessage({ type: "gcodeData", data: text });
        }
      } catch (e) {
        console.warn("[GCode Editor] Failed to get GCode:", e);
      }
    };

    webviewPanel.webview.onDidReceiveMessage((message) => {
      switch (message.type) {
        case "ready":
          loadGCode();
          break;
      }
    });

    const changeSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        loadGCode();
      }
    });

    webviewPanel.onDidDispose(() => {
      disposed = true;
      changeSubscription.dispose();
    });
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "dist", "gcodeWebview.js"));
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GCode Viewer</title>
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
