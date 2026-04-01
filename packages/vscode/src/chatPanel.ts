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
        case "modelscript_add_component": {
          const editorBefore = vscode.window.activeTextEditor;
          const fileName = editorBefore ? editorBefore.document.fileName.split(/[/\\]/).pop() : "unknown.mo";
          const linesBefore = editorBefore ? editorBefore.document.lineCount : 0;

          // Gracefully unwrap if the frontend accidentally sends an extra input layer
          const actualInput =
            msg.input && typeof msg.input.input === "object" ? (msg.input.input as Record<string, unknown>) : msg.input;

          await vscode.commands.executeCommand(
            "modelscript.addToDiagram",
            actualInput.className,
            actualInput.classKind || "model",
          );

          // Wait a tick for VS Code's text editor to physically apply the component edit
          await new Promise((r) => setTimeout(r, 200));

          const editorAfter = vscode.window.activeTextEditor;
          const linesAfter = editorAfter ? editorAfter.document.lineCount : 0;
          const added = Math.max(1, linesAfter - linesBefore);

          result = {
            success: true,
            message: `Added ${msg.input.className} to diagram.`,
            action: "Edited",
            file: fileName,
            added,
            deleted: 0,
          };
          break;
        }
        case "modelscript_simulate_and_plot":
          await vscode.commands.executeCommand("modelscript.runSimulation");
          result = { success: true, message: "Simulation triggered and panel opened." };
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
      gap: 6px;
    }
    .msg {
      line-height: 1.5;
      font-size: 13px;
      word-wrap: break-word;
      padding: 0;
      width: 100%;
    }
    .msg.user {
      align-self: flex-end;
      background: var(--vscode-button-background, #0078d4);
      color: var(--vscode-button-foreground, #fff);
      padding: 8px 12px;
      border-radius: 12px 12px 0 12px;
      max-width: 85%;
      width: auto;
    }
    .msg.assistant {
      align-self: stretch;
      background: transparent;
      border: none;
      padding: 0;
      width: 100%;
    }
    .response-block {
      background: var(--vscode-textBlockQuote-background, rgba(128,128,128,0.1));
      padding: 8px 12px;
      border-radius: 0 12px 12px 12px;
      display: inline-block;
      max-width: 95%;
      box-sizing: border-box;
      margin-top: 4px;
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

    /* Thoughts */
    .think-block {
      margin: 8px 0;
      font-size: 13px;
      color: var(--vscode-foreground, #ccc);
    }
    .think-block summary {
      cursor: pointer;
      user-select: none;
    }
    .think-content {
      margin-top: 4px;
      white-space: pre-wrap;
      opacity: 0.6;
    }
    
    .animated-ellipsis::after {
      content: "";
      animation: ellipsis 1.5s infinite steps(4, end);
    }
    @keyframes ellipsis {
      0% { content: ""; }
      25% { content: "."; }
      50% { content: ".."; }
      75% { content: "..."; }
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
      padding: 12px 16px;
      background: transparent;
      border-top: none;
    }
    .input-wrapper {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      background: var(--vscode-input-background, #3c3c3c);
      border: 1px solid var(--vscode-input-border, #3c3c3c);
      border-radius: 20px;
      padding: 6px 6px 6px 16px;
      transition: border-color 0.2s ease;
    }
    .input-wrapper:focus-within {
      border-color: var(--vscode-focusBorder, #0078d4);
    }
    #input {
      flex: 1;
      resize: none;
      background: transparent;
      color: var(--vscode-input-foreground, #ccc);
      border: none;
      padding: 5px 0;
      font-family: var(--vscode-font-family, system-ui, sans-serif);
      font-size: 13px;
      line-height: 18px;
      min-height: 28px;
      max-height: 120px;
      outline: none;
    }
    #send-btn {
      align-self: flex-end;
      background: var(--vscode-button-background, #0078d4);
      color: var(--vscode-button-foreground, #fff);
      border: none;
      border-radius: 50%;
      min-width: 28px;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      margin-bottom: 3px;
      transition: background 0.2s ease, transform 0.1s ease;
    }
    #send-btn svg {
      width: 14px;
      height: 14px;
      fill: currentColor;
    }
    #send-btn:hover:not(:disabled) {
      background: var(--vscode-button-hoverBackground, #026ec1);
      transform: scale(1.05);
    }
    #send-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
      background: var(--vscode-editorWidget-background, #252526);
      color: var(--vscode-input-foreground, #888);
    }

    /* Empty state */
    body.empty #messages { display: none; }
    body.empty {
      justify-content: center;
    }
    body.empty #input-area {
      padding: 16px 24px;
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
    <div class="input-wrapper">
      <textarea id="input" rows="1" placeholder="Ask about Modelica..." disabled></textarea>
      <button id="send-btn" disabled title="Send">
        <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
          <path d="M8.6 1L15 7.4L15 8.1L8.6 14.5L7.9 13.8L13.3 8.5H1V7.5H13.3L7.9 2.1L8.6 1Z"/>
        </svg>
      </button>
    </div>
  </div>
  <script nonce="${nonce}">var MODEL_BASE_URL = "${modelBaseUrl}";</script>
  <script nonce="${nonce}" src="${scriptUri}?t=${Date.now()}"></script>
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
