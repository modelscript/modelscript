// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Provides the AI Chat as a WebviewViewProvider (secondary sidebar).
// The webview runs WebLLM (Qwen3) directly via WebGPU.
// The extension host bridges tool calls to the LSP server.

import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";

export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "modelscript.chat";

  private view?: vscode.WebviewView;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly client: LanguageClient,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, "dist"),
        vscode.Uri.joinPath(this.extensionUri, "images"),
      ],
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    // Handle messages from webview (tool calls bridged to LSP)
    webviewView.webview.onDidReceiveMessage(
      async (msg) => {
        switch (msg.type) {
          case "toolCall":
            await this.handleToolCall(msg);
            break;
          case "getActiveFileContext":
            this.sendActiveFileContext();
            break;
          case "listClasses":
            await this.handleListClasses(msg);
            break;
        }
      },
      null,
      this.disposables,
    );

    // Auto-send active file context when view opens
    this.sendActiveFileContext();

    // Re-send active file context when user switches editors
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.sendActiveFileContext();
      }),
    );

    webviewView.onDidDispose(() => {
      while (this.disposables.length) {
        const x = this.disposables.pop();
        if (x) x.dispose();
      }
    });
  }

  private async handleToolCall(msg: { id: string; tool: string; input: Record<string, unknown> }) {
    if (!this.view) return;
    try {
      let result: unknown;
      switch (msg.tool) {
        case "modelscript_flatten":
          result = await this.client.sendRequest("modelscript/flatten", { name: msg.input.name });
          break;
        case "modelscript_simulate":
          result = await this.client.sendRequest("modelscript/simulate", msg.input);
          break;
        case "modelscript_query":
          result = await this.client.sendRequest("modelscript/query", { name: msg.input.name });
          break;
        case "modelscript_parse":
          result = await this.client.sendRequest("modelscript/parse", { code: msg.input.code });
          break;
        default:
          result = { error: `Unknown tool: ${msg.tool}` };
      }
      this.view.webview.postMessage({ type: "toolResult", id: msg.id, result });
    } catch (e) {
      this.view.webview.postMessage({
        type: "toolResult",
        id: msg.id,
        result: { error: e instanceof Error ? e.message : String(e) },
      });
    }
  }

  private async handleListClasses(msg: { id: string }) {
    if (!this.view) return;
    try {
      const result = (await this.client.sendRequest("modelscript/listClasses")) as {
        classes: { name: string; kind: string; uri: string }[];
      };
      this.view.webview.postMessage({ type: "classListResult", id: msg.id, result });
    } catch (e) {
      this.view.webview.postMessage({
        type: "classListResult",
        id: msg.id,
        result: { classes: [], error: e instanceof Error ? e.message : String(e) },
      });
    }
  }

  private sendActiveFileContext() {
    if (!this.view) return;
    let editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "modelica") {
      editor = vscode.window.visibleTextEditors.find((e) => e.document.languageId === "modelica");
    }
    if (editor && editor.document.languageId === "modelica") {
      this.view.webview.postMessage({
        type: "activeFileContext",
        fileName: editor.document.fileName.split("/").pop(),
        content: editor.document.getText(),
        uri: editor.document.uri.toString(),
      });
    } else {
      this.view.webview.postMessage({
        type: "activeFileContext",
        fileName: null,
        content: null,
        uri: null,
      });
    }
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "chatWebview.js"));
    const nonce = getNonce();

    const iconUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "images", "icon.png"));

    const serverOrigin = new URL(scriptUri.toString()).origin;
    const modelBaseUrl = `${serverOrigin}/api/models`;

    const csp = [
      "default-src 'none'",
      `style-src 'unsafe-inline'`,
      `script-src 'nonce-${nonce}' 'wasm-unsafe-eval'`,
      `img-src ${webview.cspSource}`,
      `connect-src http: https:`,
    ].join(";");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta http-equiv="Cross-Origin-Embedder-Policy" content="unsafe-none">
  <title>ModelScript Chat</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      height: 100vh;
      display: flex;
      flex-direction: column;
      background: var(--vscode-editor-background, #1e1e1e);
      color: var(--vscode-foreground, #ccc);
      font-family: var(--vscode-font-family, system-ui, sans-serif);
      font-size: 13px;
    }

    /* Header */
    #header {
      padding: 8px 12px;
      display: flex;
      align-items: center;
      gap: 8px;
      border-bottom: 1px solid var(--vscode-panel-border, #333);
      font-weight: 600;
      font-size: 12px;
    }
    #header .status {
      margin-left: auto;
      font-weight: 400;
      opacity: 0.7;
      font-size: 11px;
    }

    /* Progress bar */
    #progress-container {
      display: none;
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-panel-border, #333);
    }
    #progress-bar {
      height: 3px;
      background: var(--vscode-progressBar-background, #0078d4);
      border-radius: 2px;
      width: 0%;
      transition: width 0.3s ease;
    }
    #progress-text {
      font-size: 11px;
      opacity: 0.7;
      margin-top: 4px;
    }

    /* Messages */
    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .msg {
      max-width: 90%;
      padding: 8px 12px;
      border-radius: 8px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .msg.user {
      align-self: flex-end;
      background: var(--vscode-button-background, #0078d4);
      color: var(--vscode-button-foreground, #fff);
      border-bottom-right-radius: 2px;
    }
    .msg.assistant {
      align-self: flex-start;
      background: var(--vscode-editorWidget-background, #252526);
      border: 1px solid var(--vscode-editorWidget-border, #454545);
      border-bottom-left-radius: 2px;
    }
    .msg.tool {
      align-self: flex-start;
      background: var(--vscode-textBlockQuote-background, #2a2a2a);
      border-left: 3px solid var(--vscode-textLink-foreground, #3794ff);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      opacity: 0.85;
    }
    .msg code, .msg pre {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
    }
    .msg pre {
      background: var(--vscode-textCodeBlock-background, #1a1a1a);
      padding: 8px;
      border-radius: 4px;
      overflow-x: auto;
      margin: 4px 0;
    }

    /* Typing indicator */
    .typing {
      display: inline-flex;
      gap: 4px;
      padding: 8px 12px;
    }
    .typing span {
      width: 6px;
      height: 6px;
      background: var(--vscode-foreground, #ccc);
      border-radius: 50%;
      opacity: 0.4;
      animation: blink 1.4s infinite both;
    }
    .typing span:nth-child(2) { animation-delay: 0.2s; }
    .typing span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes blink {
      0%, 80%, 100% { opacity: 0.4; }
      40% { opacity: 1; }
    }

    /* Math rendering */
    .math-inline {
      font-family: 'Cambria Math', 'Latin Modern Math', 'STIX Two Math', serif;
      font-style: italic;
      padding: 0 2px;
      color: var(--vscode-editor-foreground, #d4d4d4);
    }
    .math-block {
      font-family: 'Cambria Math', 'Latin Modern Math', 'STIX Two Math', serif;
      font-style: italic;
      display: block;
      text-align: center;
      padding: 6px 8px;
      margin: 4px 0;
      background: var(--vscode-textCodeBlock-background, #1a1a1a);
      border-radius: 4px;
      color: var(--vscode-editor-foreground, #d4d4d4);
    }

    /* Input area */
    #input-area {
      display: flex;
      gap: 4px;
      padding: 8px 12px;
      border-top: 1px solid var(--vscode-panel-border, #333);
      background: var(--vscode-sideBar-background, #1e1e1e);
    }
    #input {
      flex: 1;
      resize: none;
      background: var(--vscode-input-background, #3c3c3c);
      color: var(--vscode-input-foreground, #ccc);
      border: 1px solid var(--vscode-input-border, #3c3c3c);
      border-radius: 4px;
      padding: 8px 10px;
      font-family: var(--vscode-font-family, system-ui, sans-serif);
      font-size: 13px;
      line-height: 1.4;
      min-height: 36px;
      max-height: 120px;
      outline: none;
    }
    #input:focus {
      border-color: var(--vscode-focusBorder, #0078d4);
    }
    #send-btn {
      align-self: center;
      background: var(--vscode-button-background, #0078d4);
      color: var(--vscode-button-foreground, #fff);
      border: none;
      border-radius: 4px;
      padding: 8px 12px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
    }
    #send-btn:hover {
      background: var(--vscode-button-hoverBackground, #026ec1);
    }
    #send-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* Empty state: center input vertically, stack send button below */
    body.empty #messages { display: none; }
    body.empty {
      justify-content: center;
    }
    body.empty #input-area {
      flex-direction: column;
      border-top: none;
      padding: 16px 24px;
    }
    body.empty #input {
      min-height: 60px;
    }
    body.empty #send-btn {
      align-self: stretch;
      padding: 10px;
    }
  </style>
</head>
<body class="empty">
  <div id="header">
    <span><img src="${iconUri}" width="16" height="16" style="vertical-align: middle; margin-right: 4px;">ModelScript AI</span>
    <span class="status" id="model-status">Ready</span>
  </div>
  <div id="progress-container">
    <div style="background: var(--vscode-editorWidget-background, #333); border-radius: 2px; overflow: hidden;">
      <div id="progress-bar"></div>
    </div>
    <div id="progress-text"></div>
  </div>
  <div id="messages"></div>
  <div id="input-area">
    <textarea id="input" rows="1" placeholder="Ask about Modelica..." disabled></textarea>
    <button id="send-btn" disabled>Send</button>
  </div>
  <script nonce="${nonce}">var MODEL_BASE_URL = "${modelBaseUrl}";</script>
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
