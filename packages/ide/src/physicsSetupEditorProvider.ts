import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";

export class SimulationViewPanel {
  public static currentPanel: SimulationViewPanel | undefined;
  public static readonly viewType = "modelscript.simulationView";

  private readonly _panel: vscode.WebviewPanel;
  private readonly _context: vscode.ExtensionContext;
  private readonly _client: LanguageClient;
  private _disposables: vscode.Disposable[] = [];

  private _className: string;
  private _documentUri: string;

  public static async createOrShow(
    context: vscode.ExtensionContext,
    client: LanguageClient,
    className: string,
    documentUri: string,
  ) {
    const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

    if (SimulationViewPanel.currentPanel) {
      SimulationViewPanel.currentPanel._panel.reveal(column);
      SimulationViewPanel.currentPanel.setStudyContext(className, documentUri);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      SimulationViewPanel.viewType,
      "Simulation View",
      column || vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
      },
    );

    SimulationViewPanel.currentPanel = new SimulationViewPanel(panel, context, client, className, documentUri);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    client: LanguageClient,
    className: string,
    documentUri: string,
  ) {
    this._panel = panel;
    this._context = context;
    this._client = client;
    this._className = className;
    this._documentUri = documentUri;

    this._update();

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.type) {
          case "ready":
            this._loadStudyFromLSP();
            break;
          case "update":
            try {
              const newConfig = JSON.parse(message.text);
              const uri = vscode.Uri.parse(this._documentUri);
              const doc = await vscode.workspace.openTextDocument(uri);
              const text = doc.getText();
              const edit = new vscode.WorkspaceEdit();

              // Simple regex-based replacement for parameter modifiers within the study class.
              // Finds `key = value` patterns and updates them safely.
              let modifiedText = text;
              let hasChanges = false;

              if (newConfig.parameters) {
                for (const [key, value] of Object.entries(newConfig.parameters)) {
                  // Only replace if it looks like an assignment in a modifier or equation
                  const regex = new RegExp(`(${key}\\s*=\\s*)[^,)\\n]+`, "g");
                  if (regex.test(modifiedText)) {
                    modifiedText = modifiedText.replace(regex, `$1${value}`);
                    hasChanges = true;
                  }
                }
              }

              if (hasChanges && modifiedText !== text) {
                const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(text.length));
                edit.replace(uri, fullRange, modifiedText);
                await vscode.workspace.applyEdit(edit);
              }
            } catch (err) {
              console.error("Failed to save parameters", err);
              vscode.window.showErrorMessage("Failed to save parameters to the Modelica file.");
            }
            break;
          case "runSimulation":
            vscode.commands.executeCommand("modelscript.runPhysicsSimulation", {
              uri: this._documentUri,
              className: this._className,
            });
            break;
          case "selectFaces":
            vscode.window.showInformationMessage(
              `Face selection for ${message.target}: click faces in the 3D view (coming soon)`,
            );
            break;
          case "generateMesh":
            vscode.commands.executeCommand("modelscript.generateMesh");
            break;
        }
      },
      null,
      this._disposables,
    );
  }

  public setStudyContext(className: string, documentUri: string) {
    this._className = className;
    this._documentUri = documentUri;
    this._panel.title = `Simulation: ${className.split(".").pop()}`;
    this._loadStudyFromLSP();
  }

  private async _loadStudyFromLSP() {
    try {
      this._panel.webview.postMessage({ type: "setLoading", data: true });

      // Call the flattenStudy endpoint!
      const config = await this._client.sendRequest<Record<string, unknown>>("modelscript/flattenStudy", {
        uri: this._documentUri,
        className: this._className,
      });

      if (config) {
        // Send study config to webview
        this._panel.webview.postMessage({ type: "configData", data: config });

        // Also fetch step meshes
        const stepFile = config.parameters?.stepFile || config.stepFile || "";
        let stepUri = this._documentUri;
        if (stepFile) {
          const docDir = this._documentUri.replace(/[^/]+$/, "");
          stepUri = docDir + stepFile;
        } else {
          stepUri = this._documentUri.replace(/[^/]+$/, "geometry.step");
        }

        const stepMeshes = await this._client.sendRequest<unknown[]>("modelscript/getStepMeshes", { uri: stepUri });
        this._panel.webview.postMessage({ type: "stepMeshes", data: stepMeshes });
      }
    } catch (e) {
      console.warn("[SimulationView] Failed to load study:", e);
      vscode.window.showErrorMessage("Failed to load study parameters via LSP.");
    } finally {
      this._panel.webview.postMessage({ type: "setLoading", data: false });
    }
  }

  public dispose() {
    SimulationViewPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) x.dispose();
    }
  }

  private _update() {
    this._panel.webview.html = this._getHtmlForWebview();
  }

  private _getHtmlForWebview(): string {
    const scriptUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, "dist", "physicsSetupWebview.js"),
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Physics Setup</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, #root { width: 100%; height: 100%; overflow: hidden; }

    .root {
      position: relative;
      width: 100%;
      height: 100%;
    }

    /* ── 3D viewer fills entire view ── */
    .viewer-bg {
      position: absolute;
      inset: 0;
      z-index: 0;
    }

    /* ── Floating config panel ── */
    .floating-panel {
      position: absolute;
      top: 12px;
      left: 12px;
      bottom: 12px;
      width: 280px;
      z-index: 10;
      display: flex;
      flex-direction: column;
      background: var(--vscode-sideBar-background, rgba(30, 30, 30, 0.92));
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid var(--vscode-sideBar-border, rgba(255,255,255,0.08));
      border-radius: 10px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.35);
      font-family: var(--vscode-font-family, 'Segoe UI', system-ui, sans-serif);
      font-size: 12px;
      color: var(--vscode-foreground, #ccc);
      overflow: hidden;
      transition: width 0.2s ease;
    }
    .floating-panel.collapsed {
      width: 42px;
      bottom: auto;
    }

    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 12px;
      border-bottom: 1px solid var(--vscode-sideBar-border, rgba(255,255,255,0.08));
      flex-shrink: 0;
    }
    .panel-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 600;
      font-size: 13px;
      white-space: nowrap;
      overflow: hidden;
    }
    .collapsed .panel-title { display: none; }
    .panel-icon { font-size: 16px; }
    .collapse-btn {
      background: none;
      border: none;
      color: var(--vscode-foreground, #ccc);
      cursor: pointer;
      padding: 2px 4px;
      font-size: 10px;
      opacity: 0.6;
      flex-shrink: 0;
    }
    .collapse-btn:hover { opacity: 1; }

    .panel-body {
      flex: 1;
      overflow-y: auto;
      padding: 8px 0;
    }
    .panel-body::-webkit-scrollbar { width: 4px; }
    .panel-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 2px; }

    /* ── sections ── */
    .section { border-bottom: 1px solid var(--vscode-sideBar-border, rgba(255,255,255,0.06)); }
    .section:last-child { border-bottom: none; }
    .section-header {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      padding: 8px 12px;
      background: none;
      border: none;
      color: var(--vscode-foreground, #ccc);
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      cursor: pointer;
      text-align: left;
    }
    .section-header:hover { background: rgba(255,255,255,0.04); }
    .chevron { font-size: 10px; opacity: 0.5; width: 12px; }
    .section-body { padding: 4px 12px 10px; }

    /* ── fields ── */
    .field { margin-bottom: 8px; }
    .field label {
      display: block;
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #999);
      margin-bottom: 3px;
    }
    .field input, .field select {
      width: 100%;
      padding: 5px 8px;
      background: var(--vscode-input-background, #2a2a2a);
      color: var(--vscode-input-foreground, #eee);
      border: 1px solid var(--vscode-input-border, rgba(255,255,255,0.1));
      border-radius: 4px;
      font-size: 12px;
      outline: none;
    }
    .field input:focus, .field select:focus {
      border-color: var(--vscode-focusBorder, #007acc);
    }

    .file-badge {
      padding: 4px 8px;
      background: rgba(0,122,204,0.12);
      border: 1px solid rgba(0,122,204,0.25);
      border-radius: 4px;
      font-size: 11px;
      color: var(--vscode-textLink-foreground, #4daafc);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .action-btn {
      width: 100%;
      padding: 6px 10px;
      margin-bottom: 6px;
      background: var(--vscode-button-secondaryBackground, #333);
      color: var(--vscode-button-secondaryForeground, #ccc);
      border: 1px solid var(--vscode-button-border, rgba(255,255,255,0.08));
      border-radius: 4px;
      cursor: pointer;
      font-size: 11px;
      text-align: left;
    }
    .action-btn:hover { background: var(--vscode-button-secondaryHoverBackground, #444); }

    .bc-tag {
      padding: 4px 8px;
      margin-bottom: 4px;
      background: rgba(255,255,255,0.04);
      border-radius: 4px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #aaa);
    }

    .run-section { padding: 10px 12px; }
    .run-btn {
      width: 100%;
      padding: 8px 14px;
      background: var(--vscode-button-background, #007acc);
      color: var(--vscode-button-foreground, #fff);
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      transition: background 0.15s;
    }
    .run-btn:hover { background: var(--vscode-button-hoverBackground, #1a8ad4); }
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
