// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";
import { BaseWebviewPanel } from "./webview/base-panel.js";

/**
 * Visual simulation study configuration and 3D preview panel.
 * Subclasses BaseWebviewPanel for standard lifecycle management, CSP, and theme support.
 */
export class SimulationViewPanel extends BaseWebviewPanel {
  public static currentPanel: SimulationViewPanel | undefined;
  public static readonly viewType = "modelscript.simulationView";

  private readonly _client: LanguageClient;

  private _className: string;
  private _documentUri: string;

  public static async createOrShow(
    context: vscode.ExtensionContext,
    client: LanguageClient,
    className: string,
    documentUri: string,
  ): Promise<void> {
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
    super(panel, context.extensionUri);
    this._client = client;
    this._className = className;
    this._documentUri = documentUri;

    this._update();

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

              // Scoped replacement for parameter modifiers within the active study class.
              let modifiedText = text;
              let hasChanges = false;

              if (newConfig.parameters && typeof newConfig.parameters === "object") {
                let searchTarget = text;
                let classPrefix = "";
                let classSuffix = "";
                if (this._className) {
                  const classRegex = new RegExp(
                    `(?:(?:model|class|block|record)\\s+${this._className}\\b[\\s\\S]*?\\bend\\s+${this._className}\\s*;)`,
                    "m",
                  );
                  const classMatch = classRegex.exec(text);
                  if (classMatch && typeof classMatch.index === "number") {
                    classPrefix = text.slice(0, classMatch.index);
                    searchTarget = classMatch[0];
                    classSuffix = text.slice(classMatch.index + classMatch[0].length);
                  }
                }

                let classBody = searchTarget;
                for (const [key, value] of Object.entries(newConfig.parameters)) {
                  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                  const regex = new RegExp(`(\\b${escapedKey}\\s*=\\s*)[^,);\\n]+`, "g");
                  if (regex.test(classBody)) {
                    classBody = classBody.replace(regex, `$1${value}`);
                    hasChanges = true;
                  }
                }

                if (hasChanges) {
                  modifiedText = classPrefix ? classPrefix + classBody + classSuffix : classBody;
                }
              }

              if (modifiedText !== text) {
                const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(text.length));
                edit.replace(uri, fullRange, modifiedText);
                await vscode.workspace.applyEdit(edit);
              }
            } catch (e) {
              console.error("[SimulationView] Error saving parameter update:", e);
            }
            break;
          case "run":
            vscode.commands.executeCommand("modelscript.runSimulation");
            break;
        }
      },
      null,
      this._disposables,
    );
  }

  public setStudyContext(className: string, documentUri: string): void {
    this._className = className;
    this._documentUri = documentUri;
    this._loadStudyFromLSP();
  }

  private async _loadStudyFromLSP(): Promise<void> {
    if (!this._client || !this._className) return;

    try {
      this._panel.webview.postMessage({ type: "setLoading", data: true });

      const response = await this._client.sendRequest<any>("modelscript/getStudyParameters", {
        className: this._className,
        documentUri: this._documentUri,
      });

      if (response) {
        this._panel.webview.postMessage({
          type: "studyData",
          data: response,
          className: this._className,
        });
      }

      // Query any STEP mesh geometry registered in the workspace for preview
      const stepFiles = await vscode.workspace.findFiles("**/*.step", "**/node_modules/**", 5);
      if (stepFiles.length > 0) {
        const stepMeshes: { name: string; uri: string }[] = [];
        for (const file of stepFiles) {
          const fileName = file.path.split("/").pop() || "geometry.step";
          stepMeshes.push({
            name: fileName,
            uri: file.toString(),
          });
        }
        this._panel.webview.postMessage({ type: "stepMeshes", data: stepMeshes });
      }
    } catch (e) {
      console.warn("[SimulationView] Failed to load study:", e);
      vscode.window.showErrorMessage("Failed to load study parameters via LSP.");
    } finally {
      this._panel.webview.postMessage({ type: "setLoading", data: false });
    }
  }

  public override dispose(): void {
    SimulationViewPanel.currentPanel = undefined;
    super.dispose();
  }

  private _update(): void {
    this._panel.webview.html = this.getHtmlShell({
      scriptName: "physics-setup-webview.js",
      title: "Simulation View",
    });
  }
}
