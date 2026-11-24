// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser.js";
import { handleOpenInVrWebviewMessage } from "./vr-handoff.js";
import { BaseCustomEditorProvider } from "./webview/base-custom-editor-provider.js";

export interface DslUiManifestPanel {
  languageId: string;
  id: string;
  viewType: string;
  title: string;
  retainContextWhenHidden?: boolean | undefined;
  supportsMultipleEditorsPerDocument?: boolean | undefined;
  webviewScriptName: string;
  openCommandId?: string | undefined;
}

export interface DslUiManifest {
  panels: DslUiManifestPanel[];
}

interface IncomingWebviewMessage {
  type?: string;
  code?: string;
  line?: number;
  identifier?: string;
  relativePath?: string;
  content?: string;
  requestId?: string;
  method?: string;
  params?: unknown;
  filename?: string;
  mimeType?: string;
  level?: "info" | "warning" | "error";
  message?: string;
  url?: string;
}

function getCurrentColorMode(): "dark" | "light" {
  const kind = vscode.window.activeColorTheme?.kind;
  return kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight ? "light" : "dark";
}

/**
 * Generic VS Code CustomTextEditorProvider for any language UI panel declared
 * via `language({ ui: { panels: [...] } })` in `@modelscript/dsl`.
 *
 * Bridges VS Code's document/webview/LSP APIs to the host-agnostic
 * `LanguagePanelHost` protocol consumed by `languages/<lang>/src/ui/*`.
 */
export class DslCustomEditorProvider extends BaseCustomEditorProvider {
  private readonly panelMeta: DslUiManifestPanel;
  private readonly client?: LanguageClient | undefined;

  constructor(context: vscode.ExtensionContext, panelMeta: DslUiManifestPanel, client?: LanguageClient) {
    super(context);
    this.panelMeta = panelMeta;
    this.client = client;
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    this.configureWebview(webviewPanel, [vscode.Uri.joinPath(this.extensionUri, "dist", "webviews")]);

    const cssName = this.panelMeta.webviewScriptName.replace(/\.js$/, ".css");
    let hasCss = false;
    try {
      await vscode.workspace.fs.stat(vscode.Uri.joinPath(this.extensionUri, "dist", cssName));
      hasCss = true;
    } catch {
      hasCss = false;
    }

    webviewPanel.webview.html = this.getHtmlShell(webviewPanel.webview, {
      title: this.panelMeta.title,
      scriptName: this.panelMeta.webviewScriptName,
      ...(hasCss ? { styleName: cssName } : {}),
    });

    let disposed = false;

    const pushDocumentState = () => {
      if (disposed) return;
      void webviewPanel.webview.postMessage({
        type: "syncDocument",
        code: document.getText(),
        dialect: this.panelMeta.languageId,
        colorMode: getCurrentColorMode(),
        documentUri: document.uri.toString(),
      });
    };

    const docSub = this.subscribeDocumentChanges(document, pushDocumentState, 150);
    const themeSub =
      typeof vscode.window.onDidChangeActiveColorTheme === "function"
        ? vscode.window.onDidChangeActiveColorTheme(() => pushDocumentState())
        : { dispose: () => {} };

    const msgSub = webviewPanel.webview.onDidReceiveMessage(async (msg: IncomingWebviewMessage) => {
      if (!msg || typeof msg !== "object") return;
      switch (msg.type) {
        case "ready": {
          pushDocumentState();
          break;
        }
        case "applyEdit": {
          if (typeof msg.code !== "string") return;
          const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
          const edit = new vscode.WorkspaceEdit();
          edit.replace(document.uri, fullRange, msg.code);
          await vscode.workspace.applyEdit(edit);
          break;
        }
        case "revealLine": {
          if (typeof msg.line !== "number" || msg.line < 1) return;
          const lineIdx = Math.min(Math.max(0, Math.floor(msg.line) - 1), Math.max(0, document.lineCount - 1));
          const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
          const lineRange = document.lineAt(lineIdx).range;
          editor.selection = new vscode.Selection(lineRange.start, lineRange.end);
          editor.revealRange(lineRange, vscode.TextEditorRevealType.InCenter);
          break;
        }
        case "updateProjectFile": {
          if (typeof msg.relativePath !== "string" || typeof msg.content !== "string") return;
          const parentUri = vscode.Uri.joinPath(document.uri, "..");
          const targetUri = vscode.Uri.joinPath(parentUri, msg.relativePath);
          await vscode.workspace.fs.writeFile(targetUri, new TextEncoder().encode(msg.content));
          break;
        }
        case "requestLsp": {
          if (typeof msg.requestId !== "string" || typeof msg.method !== "string") return;
          if (!this.client) {
            void webviewPanel.webview.postMessage({
              type: "lspResponse",
              requestId: msg.requestId,
              error: "Language client is not initialized.",
            });
            return;
          }
          try {
            const result = await this.client.sendRequest(msg.method, msg.params);
            void webviewPanel.webview.postMessage({
              type: "lspResponse",
              requestId: msg.requestId,
              result,
            });
          } catch (err) {
            void webviewPanel.webview.postMessage({
              type: "lspResponse",
              requestId: msg.requestId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
          break;
        }
        case "exportFile": {
          if (typeof msg.filename !== "string" || typeof msg.content !== "string") return;
          const defaultUri = vscode.Uri.joinPath(document.uri, "..", msg.filename);
          const saveUri = await vscode.window.showSaveDialog({ defaultUri });
          if (saveUri) {
            await vscode.workspace.fs.writeFile(saveUri, new TextEncoder().encode(msg.content));
            vscode.window.showInformationMessage(`Exported ${msg.filename}`);
          }
          break;
        }
        case "notify": {
          if (typeof msg.message !== "string") return;
          if (msg.level === "error") vscode.window.showErrorMessage(msg.message);
          else if (msg.level === "warning") vscode.window.showWarningMessage(msg.message);
          else vscode.window.showInformationMessage(msg.message);
          break;
        }
        case "openExternal": {
          if (typeof msg.url === "string") {
            await vscode.env.openExternal(vscode.Uri.parse(msg.url));
          }
          break;
        }
        case "openInVr": {
          await handleOpenInVrWebviewMessage(msg, {
            artifactUri: document.uri.toString(),
            title: this.panelMeta.title || document.uri.path.split("/").pop(),
            kind: this.panelMeta.languageId,
            fileContent: () => (typeof document.getText === "function" ? document.getText() : undefined),
            languageId: document.languageId || this.panelMeta.languageId,
          });
          break;
        }
      }
    });

    webviewPanel.onDidDispose(() => {
      disposed = true;
      docSub.dispose();
      themeSub.dispose();
      msgSub.dispose();
    });
  }
}

/**
 * Loads `dist/ui-manifest.json` generated by `buildIdeExtension()` and registers
 * a generic `DslCustomEditorProvider` + optional openCommand for each declared panel.
 */
export async function registerDslUiPanels(
  context: vscode.ExtensionContext,
  client?: LanguageClient,
  skipViewTypes?: Set<string>,
): Promise<string[]> {
  const registeredViewTypes: string[] = [];
  const manifestUri = vscode.Uri.joinPath(context.extensionUri, "dist", "ui-manifest.json");
  let manifest: DslUiManifest | null = null;
  try {
    const raw = await vscode.workspace.fs.readFile(manifestUri);
    manifest = JSON.parse(new TextDecoder().decode(raw)) as DslUiManifest;
  } catch {
    return registeredViewTypes;
  }

  if (!manifest || !Array.isArray(manifest.panels)) return registeredViewTypes;

  for (const panel of manifest.panels) {
    if (!panel.viewType || skipViewTypes?.has(panel.viewType)) continue;
    const provider = new DslCustomEditorProvider(context, panel, client);
    context.subscriptions.push(
      vscode.window.registerCustomEditorProvider(panel.viewType, provider, {
        webviewOptions: { retainContextWhenHidden: panel.retainContextWhenHidden ?? true },
        supportsMultipleEditorsPerDocument: panel.supportsMultipleEditorsPerDocument ?? true,
      }),
    );
    registeredViewTypes.push(panel.viewType);

    if (panel.openCommandId) {
      context.subscriptions.push(
        vscode.commands.registerCommand(panel.openCommandId, async (uriArg?: string | vscode.Uri) => {
          const targetUri =
            typeof uriArg === "string"
              ? vscode.Uri.parse(uriArg)
              : uriArg instanceof vscode.Uri
                ? uriArg
                : vscode.window.activeTextEditor?.document.uri;
          if (!targetUri) {
            vscode.window.showWarningMessage(`No active document found to open in ${panel.title}.`);
            return;
          }
          await vscode.commands.executeCommand("vscode.openWith", targetUri, panel.viewType, vscode.ViewColumn.Beside);
        }),
      );
    }
  }

  return registeredViewTypes;
}
