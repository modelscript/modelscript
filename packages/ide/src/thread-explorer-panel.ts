// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser.js";
import { BaseWebviewPanel } from "./webview/base-panel.js";

interface ThreadDomainNode {
  domain: string;
  nodeId: string;
  name?: string | undefined;
  status?: string | undefined;
  uri?: string | undefined;
  line?: number | undefined;
  column?: number | undefined;
  properties?: Record<string, unknown> | undefined;
}

interface ThreadAlignmentItem {
  slot?: string | number | undefined;
  status?: string | undefined;
  nodes?: ThreadDomainNode[] | undefined;
}

interface ThreadGraphData {
  threadItems?: ThreadAlignmentItem[] | undefined;
  syncedCount?: number | undefined;
  conflictCount?: number | undefined;
  staleCount?: number | undefined;
}

export class ThreadExplorerPanel extends BaseWebviewPanel {
  public static currentPanel: ThreadExplorerPanel | undefined;
  public static readonly viewType = "modelscript.threadExplorer";

  private readonly _client: LanguageClient;

  public static createOrShow(extensionUri: vscode.Uri, client: LanguageClient): void {
    const column = vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.One;

    if (ThreadExplorerPanel.currentPanel) {
      ThreadExplorerPanel.currentPanel._panel.reveal(column);
      ThreadExplorerPanel.currentPanel.refresh();
      return;
    }

    const panel = vscode.window.createWebviewPanel(ThreadExplorerPanel.viewType, "Digital Thread Explorer", column, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
    });

    ThreadExplorerPanel.currentPanel = new ThreadExplorerPanel(panel, extensionUri, client);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, client: LanguageClient) {
    super(panel, extensionUri);
    this._client = client;

    // Listen to real-time digital thread status updates from the language server
    const notifDisposable = this._client.onNotification("modelscript/threadStatusChanged", (event) => {
      this._panel.webview.postMessage({ type: "threadStatusChanged", event });
      this.refresh();
    });
    this._disposables.push(notifDisposable);

    this._panel.webview.onDidReceiveMessage(
      async (msg) => {
        switch (msg.type) {
          case "ready":
          case "refresh":
            await this.refresh();
            break;

          case "getBlastRadius": {
            try {
              const radius = await this._client.sendRequest("modelscript/getBlastRadius", {
                domain: msg.domain,
                nodeId: msg.nodeId,
              });
              this._panel.webview.postMessage({ type: "blastRadiusData", radius });
            } catch (e) {
              vscode.window.showErrorMessage(`Failed to compute blast radius: ${e}`);
            }
            break;
          }

          case "goToSource": {
            if (msg.uri) {
              const docUri = vscode.Uri.parse(msg.uri);
              const doc = await vscode.workspace.openTextDocument(docUri);
              const line = Math.max(0, (msg.line || 1) - 1);
              const col = Math.max(0, (msg.column || 1) - 1);
              const pos = new vscode.Position(line, col);
              vscode.window.showTextDocument(doc, {
                selection: new vscode.Range(pos, pos),
                viewColumn: vscode.ViewColumn.One,
              });
            } else {
              vscode.window.showInformationMessage(`Navigating to ${msg.name}`);
            }
            break;
          }

          case "openCadViewer":
            vscode.commands.executeCommand("modelscript.openStepViewer");
            break;

          case "runVerification": {
            vscode.window.showInformationMessage("Running Digital Thread V-Cycle Verification...");
            this._panel.webview.postMessage({ type: "verificationStarted" });
            try {
              // Trigger verification through LSP
              await this._client.sendRequest("modelscript/runVerification", { uri: "" });
              await this.refresh();
              vscode.window.showInformationMessage("Digital Thread Verification completed successfully.");
            } catch {
              // Refresh state
              await this.refresh();
            }
            break;
          }

          case "exportProvenance": {
            try {
              const graphData = await this._client.sendRequest<ThreadGraphData>("modelscript/getThreadGraph", {});
              const provJsonLd = this._serializeToProvO(graphData);
              const saveOptions: vscode.SaveDialogOptions = {
                filters: { "JSON-LD": ["jsonld", "json"] },
                saveLabel: "Export PROV-O Audit Bundle",
              };
              if (vscode.workspace.workspaceFolders?.[0]) {
                saveOptions.defaultUri = vscode.Uri.joinPath(
                  vscode.workspace.workspaceFolders[0].uri,
                  "digital-thread-prov.jsonld",
                );
              }
              const saveUri = await vscode.window.showSaveDialog(saveOptions);
              if (saveUri) {
                await vscode.workspace.fs.writeFile(saveUri, new TextEncoder().encode(provJsonLd));
                vscode.window.showInformationMessage(
                  `Exported W3C PROV-O digital thread audit bundle to ${saveUri.fsPath || saveUri.path}`,
                );
              } else {
                const doc = await vscode.workspace.openTextDocument({
                  content: provJsonLd,
                  language: "json",
                });
                await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
                vscode.window.showInformationMessage(
                  "Opened W3C PROV-O digital thread audit bundle in preview editor.",
                );
              }
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : String(err);
              vscode.window.showErrorMessage(`Failed to export W3C PROV-O audit bundle: ${message}`);
            }
            break;
          }
        }
      },
      null,
      this._disposables,
    );

    this._panel.webview.html = this.getHtmlShell({
      scriptName: "thread-explorer-webview.js",
      title: "Digital Thread Explorer",
    });
  }

  public async refresh(): Promise<void> {
    try {
      const graphData = await this._client.sendRequest("modelscript/getThreadGraph", {});
      this._panel.webview.postMessage({ type: "graphData", data: graphData });
    } catch (e) {
      console.error("Failed to load thread graph", e);
    }
  }

  private _serializeToProvO(graphData: ThreadGraphData | undefined): string {
    const threadItems = Array.isArray(graphData?.threadItems) ? graphData.threadItems : [];
    const entities: Record<string, unknown>[] = [];
    const activities: Record<string, unknown>[] = [];

    entities.push({
      "@id": "urn:modelscript:digital-thread",
      "@type": "prov:Bundle",
      "prov:generatedAtTime": new Date().toISOString(),
      syncedCount: graphData?.syncedCount ?? 0,
      conflictCount: graphData?.conflictCount ?? 0,
      staleCount: graphData?.staleCount ?? 0,
    });

    threadItems.forEach((item: ThreadAlignmentItem, slotIdx: number) => {
      const activityId = `urn:modelscript:alignment:slot:${item.slot ?? slotIdx}`;
      activities.push({
        "@id": activityId,
        "@type": "prov:Activity",
        "prov:label": `Slot ${item.slot ?? slotIdx} Multi-Domain Alignment`,
        "prov:status": item.status,
      });

      if (Array.isArray(item.nodes)) {
        item.nodes.forEach((node: ThreadDomainNode) => {
          const entityId = `urn:modelscript:domain:${node.domain}:node:${node.nodeId}`;
          entities.push({
            "@id": entityId,
            "@type": "prov:Entity",
            "prov:label": node.name,
            domain: node.domain,
            status: node.status,
            ...(node.uri ? { "prov:atLocation": node.uri } : {}),
            ...(node.line ? { line: node.line } : {}),
            ...(node.column ? { column: node.column } : {}),
            ...(node.properties ? { properties: node.properties } : {}),
            "prov:wasGeneratedBy": activityId,
          });
        });
      }
    });

    const doc = {
      "@context": {
        prov: "http://www.w3.org/ns/prov#",
        dc: "http://purl.org/dc/elements/1.1/",
        xsd: "http://www.w3.org/2001/XMLSchema#",
      },
      "@graph": [...entities, ...activities],
    };

    return JSON.stringify(doc, null, 2);
  }

  public override dispose(): void {
    ThreadExplorerPanel.currentPanel = undefined;
    super.dispose();
  }
}
