import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";

export class ModelScriptPty implements vscode.Pseudoterminal {
  private writeEmitter = new vscode.EventEmitter<string>();
  private closeEmitter = new vscode.EventEmitter<void>();
  onDidWrite = this.writeEmitter.event;
  onDidClose = this.closeEmitter.event;

  private currentLine = "";
  private commandBuffer = "";
  private history: string[] = [];
  private historyIndex = -1;
  private client: LanguageClient;

  constructor(client: LanguageClient) {
    this.client = client;

    // Listen for outputs from the LSP REPL evaluation
    this.client.onNotification("modelscript/repl/output", (params: { text: string }) => {
      // Normalize line endings for terminal rendering (CRLF)
      const text = params.text.replace(/\r?\n/g, "\r\n");
      this.writeEmitter.fire(text);
      this.prompt();
    });
  }

  open(): void {
    this.writeEmitter.fire("\r\n\x1b[1;36mModelScript REPL\x1b[0m\r\nType 'help' for more information.\r\n\r\n");
    this.prompt();
  }

  close(): void {
    this.closeEmitter.fire();
  }

  handleInput(data: string): void {
    switch (data) {
      case "\r": // Enter
        this.writeEmitter.fire("\r\n");
        if (this.currentLine.trim()) {
          this.history.push(this.currentLine);
        }
        this.historyIndex = this.history.length;
        this.evaluateLine(this.currentLine);
        this.currentLine = "";
        break;
      case "\x7f": // Backspace
        if (this.currentLine.length > 0) {
          this.currentLine = this.currentLine.slice(0, -1);
          // Move cursor back, erase to end of line
          this.writeEmitter.fire("\x1b[D\x1b[K");
        }
        break;
      case "\x03": // Ctrl+C
        this.writeEmitter.fire("^C\r\n");
        this.currentLine = "";
        this.commandBuffer = "";
        this.prompt();
        break;
      case "\x1b[A": // Up arrow
        if (this.history.length > 0 && this.historyIndex > 0) {
          this.historyIndex--;
          this.replaceCurrentLine(this.history[this.historyIndex]);
        }
        break;
      case "\x1b[B": // Down arrow
        if (this.historyIndex < this.history.length - 1) {
          this.historyIndex++;
          this.replaceCurrentLine(this.history[this.historyIndex]);
        } else if (this.historyIndex === this.history.length - 1) {
          this.historyIndex++;
          this.replaceCurrentLine("");
        }
        break;
      case "\t": // Tab completion
        this.handleTabCompletion();
        break;
      default:
        // Accept printable characters
        if (data.length === 1 && data.charCodeAt(0) >= 32 && data.charCodeAt(0) <= 126) {
          this.currentLine += data;
          this.writeEmitter.fire(data);
        }
        break;
    }
  }

  private prompt(isContinuation = false): void {
    if (isContinuation) {
      this.writeEmitter.fire("\x1b[1;33m... \x1b[0m");
    } else {
      this.writeEmitter.fire("\x1b[1;32mmodelscript>\x1b[0m ");
    }
  }

  private replaceCurrentLine(newLine: string): void {
    // Clear current line
    const eraseStr = "\x1b[D\x1b[K".repeat(this.currentLine.length);
    if (eraseStr) {
      this.writeEmitter.fire(eraseStr);
    }
    this.currentLine = newLine;
    this.writeEmitter.fire(this.currentLine);
  }

  private handleTabCompletion(): void {
    // Basic completion by matching the last word typed
    const match = this.currentLine.match(/[\w.]+$/);
    const prefix = match ? match[0] : "";
    if (!prefix) return;

    this.client
      .sendRequest<{ completions: string[] }>("modelscript/repl/completion", { prefix })
      .then((res) => {
        const comps = res.completions || [];
        if (comps.length === 1) {
          // Auto-complete the rest of the word
          const remainder = comps[0].slice(prefix.length);
          this.currentLine += remainder;
          this.writeEmitter.fire(remainder);
        } else if (comps.length > 1) {
          // Show options
          this.writeEmitter.fire("\r\n" + comps.join("  ") + "\r\n");
          this.prompt();
          this.writeEmitter.fire(this.currentLine);
        }
      })
      .catch(() => {
        /* ignore */
      });
  }

  private evaluateLine(line: string): void {
    if (!line.trim() && !this.commandBuffer.trim()) {
      this.prompt();
      return;
    }

    // If user presses enter on an empty line while buffering, cancel the buffer
    if (!line.trim() && this.commandBuffer.trim()) {
      this.writeEmitter.fire(`\x1b[1;31mCancelled input.\x1b[0m\r\n`);
      this.commandBuffer = "";
      this.prompt();
      return;
    }

    this.commandBuffer += line + "\n";

    // Send to LSP for evaluation
    this.client
      .sendRequest<{ status: string; result?: string; error?: string }>("modelscript/repl/evaluate", {
        input: this.commandBuffer,
      })
      .then((res) => {
        if (res.status === "incomplete") {
          this.prompt(true);
        } else {
          this.commandBuffer = "";
          if (res.status === "error") {
            this.writeEmitter.fire(`\x1b[1;31mError:\x1b[0m ${res.error}\r\n`);
          } else if (res.result) {
            const resultText = res.result.replace(/\r?\n/g, "\r\n");
            this.writeEmitter.fire(`${resultText}\r\n`);
          }
          this.prompt();
        }
      })
      .catch((err) => {
        this.commandBuffer = "";
        this.writeEmitter.fire(`\x1b[1;31mRPC Error:\x1b[0m ${err.message}\r\n`);
        this.prompt();
      });
  }
}

export function registerRepl(context: vscode.ExtensionContext, client: LanguageClient) {
  context.subscriptions.push(
    vscode.commands.registerCommand("modelscript.startRepl", () => {
      const pty = new ModelScriptPty(client);
      const terminal = vscode.window.createTerminal({
        name: "ModelScript REPL",
        pty,
      });
      terminal.show();
    }),
  );
}
