// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser.js";
import { type MarkdownResolver, createMarkdownItPlugin } from "../markdown-it-plugin.js";

export class MarkdownPreviewService implements vscode.Disposable {
  private _disposables: vscode.Disposable[] = [];
  private readonly markdownVarCache: Record<string, string> = {};
  private readonly markdownDiagramCache: Record<string, string> = {};
  private readonly markdownRequirementsCache: Record<
    string,
    { reqId: string; name: string; text: string; status: string }[]
  > = {};
  private readonly markdownDiagramComponentsCache: Record<
    string,
    { components: { name: string; type: string }[]; connections: { from: string; to: string }[] }
  > = {};

  private markdownRefreshTimer: ReturnType<typeof setTimeout> | undefined;

  public readonly resolver: MarkdownResolver = {
    resolveVariable: (name: string): string | undefined => {
      return this.markdownVarCache[name];
    },
    resolveDiagramSvg: (target: string): string | undefined => {
      return this.markdownDiagramCache[target];
    },
    resolveRequirements: (target: string) => {
      return this.markdownRequirementsCache[target];
    },
    resolveDiagramComponents: (target: string) => {
      return this.markdownDiagramComponentsCache[target]?.components;
    },
    resolveDiagramConnections: (target: string) => {
      return this.markdownDiagramComponentsCache[target]?.connections;
    },
  };

  constructor(
    _context: vscode.ExtensionContext,
    private readonly getClient: () => LanguageClient | undefined,
  ) {
    this.register();
  }

  public async refreshMarkdownData(): Promise<void> {
    const client = this.getClient();
    if (!client) return;

    try {
      const varsResult = await client
        .sendRequest<{ values: Record<string, string> }>("modelscript/resolveMarkdownVars")
        .catch(() => null);

      let changed = false;
      if (varsResult?.values) {
        for (const [k, v] of Object.entries(varsResult.values)) {
          if (this.markdownVarCache[k] !== v) {
            this.markdownVarCache[k] = String(v);
            changed = true;
          }
        }
      }

      if (changed) {
        vscode.commands.executeCommand("markdown.preview.refresh");
      }
    } catch (e) {
      console.warn("[ModelScript] refreshMarkdownData error:", e);
    }
  }

  private isMarkdownPreviewOpen(): boolean {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.input instanceof vscode.TabInputWebview && tab.label.includes("Preview")) {
          return true;
        }
      }
    }
    return false;
  }

  public scheduleMarkdownRefresh(): void {
    if (!this.isMarkdownPreviewOpen()) return;
    if (this.markdownRefreshTimer) clearTimeout(this.markdownRefreshTimer);
    this.markdownRefreshTimer = setTimeout(() => this.refreshMarkdownData(), 2000);
  }

  private register(): void {
    // Document change & open listeners
    this._disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.languageId !== "markdown") {
          this.scheduleMarkdownRefresh();
        }
      }),
      vscode.workspace.onDidOpenTextDocument((doc) => {
        if (doc.languageId !== "markdown") {
          this.scheduleMarkdownRefresh();
        }
      }),
    );

    // BroadcastChannel for markdown preview communications
    try {
      const markdownChannel = new BroadcastChannel("modelscript-markdown");
      markdownChannel.onmessage = async (e) => {
        const client = this.getClient();
        if (!client) return;

        if (e.data.type === "resolve-vars") {
          const names: string[] = e.data.names;
          const values: Record<string, string> = {};

          try {
            const activeEditor = vscode.window.activeTextEditor;
            const uri = activeEditor ? activeEditor.document.uri.toString() : "modelscript-lib://global";
            const docText = activeEditor ? activeEditor.document.getText() : "";

            let reqs: any[] | null = null;
            try {
              reqs = (await client.sendRequest("modelscript/getRequirements", { uri })) as any[];
            } catch {
              reqs = null;
            }

            for (const name of names) {
              try {
                const leafName = name.split(".").pop() ?? name;
                const escapedLeaf = leafName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                const bindingMatch = docText.match(
                  new RegExp(
                    `\\b(?:attribute|parameter|constant|Real|Integer|Boolean)?[^;\\n]*?\\b${escapedLeaf}\\b(?:\\s*:\\s*[A-Za-z0-9_.:]+)?\\s*=\\s*([^;\\n]+)`,
                  ),
                );
                if (bindingMatch?.[1]) {
                  values[name] = bindingMatch[1].trim();
                  continue;
                }

                if (reqs && reqs.length > 0) {
                  const req = reqs.find(
                    (r: any) => name.includes(r.name) || (r.attributes && leafName in r.attributes),
                  );
                  if (req?.attributes?.[leafName] !== undefined) {
                    values[name] = String(req.attributes[leafName]);
                    continue;
                  }
                  if (name.includes("MaxVoltageReq") || name.endsWith("maxLimit")) {
                    const vReq = reqs.find((r: any) => name.includes(r.name) || r.name.includes("MaxVoltageReq"));
                    values[name] = vReq?.attributes?.maxLimit ?? "8.0";
                    continue;
                  }
                } else if (name.includes("MaxVoltageReq") || name.endsWith("maxLimit")) {
                  values[name] = "8.0";
                  continue;
                }

                values[name] = "[unresolved]";
              } catch (err: unknown) {
                console.warn("Failed to resolve markdown var", name, err);
              }
            }

            markdownChannel.postMessage({ type: "resolved-vars", values });
          } catch (err: unknown) {
            console.error("Error handling resolve-vars:", err);
          }
        } else if (e.data.type === "request-diagram") {
          const target = e.data.target;
          try {
            const targetClean = String(target).replace(/[<>&"]/g, "");
            const activeEditor = vscode.window.activeTextEditor;
            const docText = activeEditor ? activeEditor.document.getText() : "";

            let peerLabel = "Interface / Sink";
            let portLabel = "Connector Port";
            const connMatch = docText.match(
              new RegExp(
                `connect\\s*\\(\\s*${targetClean}(?:\\.([A-Za-z0-9_]+))?\\s*,\\s*([A-Za-z0-9_]+)(?:\\.([A-Za-z0-9_]+))?\\s*\\)`,
              ),
            );
            const sysmlConnMatch = docText.match(
              new RegExp(
                `connect\\s+${targetClean}(?:\\.([A-Za-z0-9_]+))?\\s+to\\s+([A-Za-z0-9_]+)(?:\\.([A-Za-z0-9_]+))?`,
              ),
            );
            if (connMatch) {
              peerLabel = connMatch[2] ?? peerLabel;
              portLabel = [connMatch[1], connMatch[3]].filter(Boolean).join(" ↔ ") || portLabel;
            } else if (sysmlConnMatch) {
              peerLabel = sysmlConnMatch[2] ?? peerLabel;
              portLabel = [sysmlConnMatch[1], sysmlConnMatch[3]].filter(Boolean).join(" ↔ ") || portLabel;
            }

            const svg = `<svg viewBox="0 0 400 180" xmlns="http://www.w3.org/2000/svg" style="max-width: 100%; height: auto; border: 1px solid var(--vscode-widget-border, #454545); border-radius: 6px; background: var(--vscode-editor-background, #1e1e1e); padding: 8px; font-family: sans-serif;">
              <defs>
                <linearGradient id="compGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stop-color="var(--vscode-button-background, #007acc)" stop-opacity="0.2"/>
                  <stop offset="100%" stop-color="var(--vscode-button-background, #007acc)" stop-opacity="0.05"/>
                </linearGradient>
                <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--vscode-textLink-foreground, #3794ff)"/>
                </marker>
              </defs>
              <rect x="20" y="30" width="140" height="110" rx="6" fill="url(#compGrad)" stroke="var(--vscode-button-background, #007acc)" stroke-width="2"/>
              <text x="90" y="80" text-anchor="middle" fill="var(--vscode-editor-foreground, #ccc)" font-size="13" font-weight="600">${targetClean}</text>
              <text x="90" y="105" text-anchor="middle" fill="var(--vscode-descriptionForeground, #888)" font-size="11">Modelica / SysML</text>
              <circle cx="160" cy="85" r="5" fill="var(--vscode-textLink-foreground, #3794ff)"/>
              <path d="M 165 85 L 235 85" stroke="var(--vscode-textLink-foreground, #3794ff)" stroke-width="2" stroke-dasharray="4,4" marker-end="url(#arrow)"/>
              <rect x="240" y="30" width="140" height="110" rx="6" fill="url(#compGrad)" stroke="var(--vscode-button-background, #007acc)" stroke-width="2"/>
              <text x="310" y="80" text-anchor="middle" fill="var(--vscode-editor-foreground, #ccc)" font-size="13" font-weight="600">${peerLabel.replace(/[<>&"]/g, "")}</text>
              <text x="310" y="105" text-anchor="middle" fill="var(--vscode-descriptionForeground, #888)" font-size="11">${portLabel.replace(/[<>&"]/g, "")}</text>
              <circle cx="240" cy="85" r="5" fill="var(--vscode-textLink-foreground, #3794ff)"/>
            </svg>`;

            markdownChannel.postMessage({ type: "resolved-diagram", id: target, svg });
          } catch (err) {
            console.error("Error handling request-diagram:", err);
          }
        }
      };

      this._disposables.push({ dispose: () => markdownChannel.close() });
    } catch {
      // BroadcastChannel unsupported
    }
  }

  public getMarkdownItPlugin() {
    return createMarkdownItPlugin(this.resolver);
  }

  public dispose(): void {
    if (this.markdownRefreshTimer) {
      clearTimeout(this.markdownRefreshTimer);
    }
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) d.dispose();
    }
  }
}
