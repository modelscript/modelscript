import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";

export class CadViewerPanel {
  public static currentPanel: CadViewerPanel | undefined;
  public static readonly viewType = "modelscript.cadViewer";

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _client: LanguageClient;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri, client: LanguageClient) {
    const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;

    if (CadViewerPanel.currentPanel) {
      CadViewerPanel.currentPanel._panel.reveal(column);
      CadViewerPanel.currentPanel.update();
      return;
    }

    const panel = vscode.window.createWebviewPanel(CadViewerPanel.viewType, "3D CAD Viewer", column, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
    });

    CadViewerPanel.currentPanel = new CadViewerPanel(panel, extensionUri, client);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, client: LanguageClient) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._client = client;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.type) {
          case "ready":
            this.update();
            break;
          case "select":
            break;
        }
      },
      null,
      this._disposables,
    );

    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

    // Watch for active editor changes to auto-update CAD viewer
    vscode.window.onDidChangeActiveTextEditor(
      () => {
        if (vscode.window.activeTextEditor?.document.languageId === "modelica") {
          this.update();
        }
      },
      null,
      this._disposables,
    );

    vscode.workspace.onDidChangeTextDocument(
      (e) => {
        if (e.document === vscode.window.activeTextEditor?.document) {
          this.update();
        }
      },
      null,
      this._disposables,
    );

    // Listen for LSP compilation complete so we update when the AST is ready
    this._client.onNotification("modelscript/projectTreeChanged", () => {
      this.update();
    });
  }

  public async update() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "modelica") {
      return;
    }

    const uri = editor.document.uri.toString();
    try {
      // Send a custom request to the language server to get the cad components
      // This endpoint needs to be implemented in the LSP
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cadComponents = await this._client.sendRequest<any[]>("modelscript/getCadComponents", { uri });

      const documentUri = vscode.Uri.parse(uri);
      for (const comp of cadComponents) {
        if (typeof comp.cad === "string") {
          const match = comp.cad.match(/uri\s*=\s*"([^"]+)"/);
          if (match) {
            const cadUri = match[1];
            if (!cadUri.includes("://") && !cadUri.startsWith("data:")) {
              const fileUri = vscode.Uri.joinPath(documentUri, "..", cadUri);
              try {
                const data = await vscode.workspace.fs.readFile(fileUri);
                const bytes = new Uint8Array(data);
                let binary = "";
                for (let i = 0; i < bytes.byteLength; i++) {
                  binary += String.fromCharCode(bytes[i]);
                }
                const b64 = btoa(binary);
                const dataUri = `data:model/gltf-binary;base64,${b64}`;
                comp.cad = comp.cad.replace(cadUri, dataUri);
              } catch (e) {
                console.warn("[CAD Viewer] Could not read local CAD file:", fileUri.toString(), e);
              }
            }
          }
        }
      }

      this._panel.webview.postMessage({ type: "cadComponents", data: cadComponents });
    } catch (e) {
      console.warn("[CAD Viewer] Failed to get CAD components:", e);
    }
  }

  public dispose() {
    CadViewerPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "dist", "cadWebview.js"));
    const cadBaseUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "images", "cad")).toString();
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>3D CAD Viewer</title>
</head>
<body class="vscode-dark">
    <div id="root"></div>
    <script nonce="${nonce}">
      window.__CAD_ASSET_BASE_URL__ = "${cadBaseUri}";
    </script>
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
