import * as vscode from "vscode";

export class VrVisualizationPanel {
  public static currentPanel: VrVisualizationPanel | undefined;
  public static readonly viewType = "modelscript.vrVisualization";

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

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
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
      },
    );

    VrVisualizationPanel.currentPanel = new VrVisualizationPanel(panel, extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this._update();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.command) {
          case "alert":
            vscode.window.showErrorMessage(message.text);
            return;
        }
      },
      null,
      this._disposables,
    );
  }

  public dispose() {
    VrVisualizationPanel.currentPanel = undefined;
    this._panel.dispose();

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  /**
   * Pushes a new VTK payload (from the orchestrator) to the WebXR view.
   */
  public updateVtkData(participantId: string, time: number, vtkData: Uint8Array) {
    // Send raw binary to webview
    this._panel.webview.postMessage({
      command: "vtkData",
      participantId,
      time,
      vtkData: Array.from(vtkData), // converting to array for postMessage serialization
    });
  }

  private _update() {
    const webview = this._panel.webview;
    this._panel.title = "VR Factory Visualization";
    this._panel.webview.html = this._getHtmlForWebview(webview);
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "dist", "vrVisualizationWebview.js"),
    );

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>VR Factory Visualization</title>
        <style>
          body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #000; }
          #container { width: 100%; height: 100%; }
        </style>
      </head>
      <body>
        <div id="container"></div>
        <script src="${scriptUri}"></script>
      </body>
      </html>`;
  }
}
