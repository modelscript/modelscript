import * as vscode from "vscode";

export class PhysicsSetupEditorProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = "modelscript.physicsSetupEditor";

  constructor(private readonly context: vscode.ExtensionContext) {}

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _token: vscode.CancellationToken,
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
    };

    const updateWebview = () => {
      webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview, document.getText());
    };

    updateWebview();

    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        updateWebview();
      }
    });

    webviewPanel.onDidDispose(() => {
      changeDocumentSubscription.dispose();
    });

    webviewPanel.webview.onDidReceiveMessage((e) => {
      switch (e.type) {
        case "update":
          this.updateDocument(document, e.text);
          return;
        case "generateMesh":
          vscode.commands.executeCommand("modelscript.generateMesh");
          return;
      }
    });
  }

  private updateDocument(document: vscode.TextDocument, text: string) {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), text);
    return vscode.workspace.applyEdit(edit);
  }

  private getHtmlForWebview(webview: vscode.Webview, text: string): string {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { type: "Unknown", stepFile: "", mesh: { min: 0.02, max: 0.08 } };
    }

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Physics Simulation Setup</title>
        <style>
          body { font-family: var(--vscode-font-family); padding: 20px; color: var(--vscode-editor-foreground); }
          .container { display: flex; flex-direction: column; gap: 20px; max-width: 600px; margin: 0 auto; }
          .card { background: var(--vscode-editorWidget-background); padding: 20px; border-radius: 8px; border: 1px solid var(--vscode-widget-border); }
          h2 { margin-top: 0; }
          .form-group { margin-bottom: 15px; }
          label { display: block; margin-bottom: 5px; font-weight: bold; }
          input, select { width: 100%; padding: 8px; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); }
          button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 10px 15px; cursor: pointer; font-weight: bold; width: 100%; margin-top: 10px; border-radius: 4px; }
          button:hover { background: var(--vscode-button-hoverBackground); }
          .mesh-preview { height: 300px; background: #1e1e1e; display: flex; align-items: center; justify-content: center; border-radius: 4px; margin-top: 10px; border: 1px solid #444; color: #888; text-align: center;}
        </style>
      </head>
      <body>
        <div class="container">
          <h1>${data.type} Simulation Setup</h1>
          
          <div class="card">
            <h2>Geometry</h2>
            <div class="form-group">
              <label>Target File</label>
              <input type="text" value="${data.stepFile}" readonly />
            </div>
            <div class="mesh-preview">
              <div>
                [ Interactive 3D WebGL / VTK.js Preview ]<br/><br/>
                File: ${data.stepFile ? data.stepFile.split("/").pop() : "None"}
              </div>
            </div>
          </div>

          <div class="card">
            <h2>Meshing (Gmsh)</h2>
            <div class="form-group">
              <label>Mesh Size Min</label>
              <input type="number" step="0.01" id="meshMin" value="${data.mesh?.min || 0.02}" />
            </div>
            <div class="form-group">
              <label>Mesh Size Max</label>
              <input type="number" step="0.01" id="meshMax" value="${data.mesh?.max || 0.08}" />
            </div>
            <button onclick="generateMesh()">Generate Preview Mesh</button>
          </div>

          ${
            data.type === "FEA"
              ? `
          <div class="card">
            <h2>Boundary Conditions</h2>
            <div class="form-group">
              <label>Fixed Supports</label>
              <button>Select Faces in 3D View</button>
            </div>
            <div class="form-group">
              <label>Applied Forces</label>
              <button>Add Force Vector</button>
            </div>
            <div class="form-group">
              <label>Material</label>
              <select>
                <option>Aluminum 6061-T6</option>
                <option>Carbon Fiber (Isotropic Proxy)</option>
                <option>Steel AISI 1020</option>
              </select>
            </div>
          </div>
          `
              : `
          <div class="card">
            <h2>Boundary Conditions</h2>
            <div class="form-group">
              <label>Inlet Velocity (m/s)</label>
              <input type="text" value="-15.0, 0, 0" />
            </div>
            <div class="form-group">
              <label>Bounding Box (Domain)</label>
              <input type="text" value="Auto-fit + 500%" />
            </div>
            <div class="form-group">
              <label>Fluid Properties</label>
              <select>
                <option>Air (Incompressible)</option>
                <option>Water</option>
              </select>
            </div>
          </div>
          `
          }
        </div>
        <script>
          const vscode = acquireVsCodeApi();
          function generateMesh() {
            vscode.postMessage({ type: 'generateMesh' });
          }
        </script>
      </body>
      </html>
    `;
  }
}
