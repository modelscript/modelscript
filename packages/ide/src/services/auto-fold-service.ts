// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import type { BaseLanguageClient } from "vscode-languageclient";

/**
 * Automatically collapses grammar-designated default-folded regions (such as
 * Modelica `annotation(...)` clauses, SysML v2 `doc` / metadata blocks, and
 * XML comments) once when a document is first opened in an editor.
 */
export function registerAutoFoldService(
  context: vscode.ExtensionContext,
  client: BaseLanguageClient,
): vscode.Disposable {
  const foldedUris = new Set<string>();

  const tryAutoFold = async (editor: vscode.TextEditor | undefined) => {
    if (!editor) return;
    const enabled = vscode.workspace.getConfiguration("modelscript.editor").get<boolean>("autoFoldAnnotations", true);
    if (!enabled) return;

    const uri = editor.document.uri.toString();
    if (foldedUris.has(uri)) return;
    if (editor.document.uri.scheme === "output" || editor.document.uri.scheme === "vscode-notebook-cell") {
      return;
    }

    foldedUris.add(uri);
    try {
      const resp = await client.sendRequest<{ lines?: number[] }>("modelscript/getDefaultFoldLines", {
        textDocument: { uri },
      });
      const lines = resp?.lines;
      if (!Array.isArray(lines) || lines.length === 0) return;

      // Only fold if the same editor is still active
      if (vscode.window.activeTextEditor?.document.uri.toString() !== uri) return;
      await vscode.commands.executeCommand("editor.fold", { selectionLines: lines });
    } catch {
      // Non-fatal: server may not be ready or document may not support folding
      foldedUris.delete(uri);
    }
  };

  const d1 = vscode.window.onDidChangeActiveTextEditor((editor) => {
    void tryAutoFold(editor);
  });

  const d2 = vscode.workspace.onDidCloseTextDocument((doc) => {
    foldedUris.delete(doc.uri.toString());
  });

  // Fold the currently active editor if one is already open when the server becomes ready
  if (vscode.window.activeTextEditor) {
    void tryAutoFold(vscode.window.activeTextEditor);
  }

  const disposable = vscode.Disposable.from(d1, d2);
  context.subscriptions.push(disposable);
  return disposable;
}
