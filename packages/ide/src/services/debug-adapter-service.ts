// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser.js";
import { ModelScriptDebugSession, setLspDebugCallbacks } from "../debug-adapter.js";

export class InlineDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
  createDebugAdapterDescriptor(session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
    void session;
    return new vscode.DebugAdapterInlineImplementation(new ModelScriptDebugSession());
  }
}

export class DebugAdapterService implements vscode.Disposable {
  private _disposables: vscode.Disposable[] = [];

  constructor(
    _context: vscode.ExtensionContext,
    private readonly getClient: () => LanguageClient | undefined,
  ) {
    this.register();
  }

  private register(): void {
    try {
      this._disposables.push(
        vscode.debug.registerDebugAdapterDescriptorFactory("modelscript", new InlineDebugAdapterFactory()),
      );
    } catch (e) {
      console.warn("Failed to register debug adapter factory:", e);
    }

    setLspDebugCallbacks(
      async (program: string) => {
        let uri = program;
        try {
          const doc = vscode.workspace.textDocuments.find((d) => d.uri.path === program || d.fileName === program);
          if (doc) uri = doc.uri.toString();
          else uri = vscode.Uri.file(program).toString();
        } catch {
          /* ignore */
        }
        const client = this.getClient();
        if (client) {
          const result = await client.sendRequest<{ error?: string | undefined }>("modelscript/simulateDebug", { uri });
          if (result && result.error) {
            vscode.window.showErrorMessage(`Debugger failed to start: ${result.error}`);
          }
          return result;
        }
        return { error: "LSP Client not active" };
      },
      async () => {
        const client = this.getClient();
        if (client) await client.sendRequest("modelscript/debuggerContinue");
      },
      async () => {
        const client = this.getClient();
        if (client) return client.sendRequest("modelscript/debuggerVariables");
        return [];
      },
      async (program: string, bps: { line: number; column?: number | undefined }[]) => {
        let uri = program;
        try {
          const doc = vscode.workspace.textDocuments.find((d) => d.uri.path === program || d.fileName === program);
          if (doc) uri = doc.uri.toString();
          else uri = vscode.Uri.file(program).toString();
        } catch {
          /* ignore */
        }
        const client = this.getClient();
        if (client) await client.sendNotification("modelscript/setBreakpoints", { uri, breakpoints: bps });
      },
      async () => {
        const client = this.getClient();
        if (client) await client.sendRequest("modelscript/debuggerContinue", { step: true });
      },
    );
  }

  public dispose(): void {
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) d.dispose();
    }
  }
}
