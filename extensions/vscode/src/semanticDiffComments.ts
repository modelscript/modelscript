import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";

export interface FlatSemanticEdit {
  action: "insert" | "delete" | "update" | "none";
  description: string;
  oldRange?: { startLine: number; startCharacter: number; endLine: number; endCharacter: number };
  newRange?: { startLine: number; startCharacter: number; endLine: number; endCharacter: number };
  kind?: string;
}

class SemanticDiffComment implements vscode.Comment {
  id: number;
  label: string | undefined;
  body: string | vscode.MarkdownString;
  mode: vscode.CommentMode;
  author: vscode.CommentAuthorInformation;

  constructor(body: string, label?: string) {
    this.id = Math.random();
    this.label = label;
    const md = new vscode.MarkdownString(body);
    md.isTrusted = true;
    md.supportThemeIcons = true;
    this.body = md;
    this.mode = vscode.CommentMode.Preview;
    this.author = {
      name: "ModelScript Semantic Diff",
    };
  }
}

export function registerSemanticDiffComments(context: vscode.ExtensionContext, client: LanguageClient | undefined) {
  const commentController = vscode.comments.createCommentController(
    "modelscript.semanticDiff",
    "ModelScript Semantic Diff",
  );
  context.subscriptions.push(commentController);

  // Keep track of active comment threads so we can dispose them if the editor changes
  let activeThreads: vscode.CommentThread[] = [];

  const updateComments = async (editor: vscode.TextEditor | undefined) => {
    // Clean up old threads
    for (const thread of activeThreads) {
      thread.dispose();
    }
    activeThreads = [];

    if (!editor || !client) return;

    // Check if it's a diff editor and the file is supported
    const uri = editor.document.uri;
    if (!(uri.fsPath.endsWith(".mo") || uri.fsPath.endsWith(".sysml"))) {
      return;
    }

    // In VS Code's diff view, there's a left and right document. We only process when we're focusing a diff editor.
    // However, `activeTextEditor` gives us the document currently focused in the diff view.
    // To get the corresponding original and modified text, we can use the `vscode.commands` or SCM APIs,
    // or just assume we're looking at a Git diff.
    // Wait, an easier way is to get the diff directly if we know it's a diff view.
    // But VS Code's API doesn't expose the other side of the diff easily via `TextEditor`.
    // Instead, we can use the Git extension API to fetch the HEAD version of this file, just like in scmIntegration.

    // Check if the scheme is 'git' or 'file'. Usually right side is 'file' and left side is 'git'.
    if (uri.scheme !== "file") {
      return; // Only annotate the working tree version
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gitExtension = vscode.extensions.getExtension<any>("vscode.git")?.exports;
    if (!gitExtension) return;

    const git = gitExtension.getAPI(1);
    if (!git || git.repositories.length === 0) return;

    const repository = git.repositories[0];

    try {
      // Get the HEAD version of the file
      const oldText = await repository.show("HEAD", uri.fsPath);
      const newText = editor.document.getText();

      if (!oldText || !newText || oldText === newText) return;

      const result = await client.sendRequest<{ diffs: FlatSemanticEdit[] }>("modelscript/getSemanticDiff", {
        uri: uri.toString(),
        oldText,
        newText,
      });

      if (!result || !result.diffs || result.diffs.length === 0) return;

      for (const edit of result.diffs) {
        if (edit.action === "none" || !edit.description) continue;

        let icon = "$(info)";
        if (edit.action === "insert") icon = "$(add)";
        if (edit.action === "delete") icon = "$(trash)";
        if (edit.action === "update") icon = "$(edit)";

        const msg = `${icon} **${edit.action.toUpperCase()}**: ${edit.description}`;

        // We attach comments to the newRange in the working tree file (the right side of the diff editor)
        // If it's a delete, newRange might not exist, so we map it to line 0 or the closest context.
        if (edit.newRange) {
          const range = new vscode.Range(
            edit.newRange.startLine,
            edit.newRange.startCharacter,
            edit.newRange.endLine,
            edit.newRange.endCharacter,
          );

          const thread = commentController.createCommentThread(uri, range, [new SemanticDiffComment(msg, edit.kind)]);
          thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
          activeThreads.push(thread);
        } else if (edit.action === "delete" && edit.oldRange) {
          // For deletions, attach to the first line so it shows up in the file
          const range = new vscode.Range(0, 0, 0, 0);
          const thread = commentController.createCommentThread(uri, range, [new SemanticDiffComment(msg, edit.kind)]);
          thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
          activeThreads.push(thread);
        }
      }
    } catch (e) {
      console.error("Failed to generate semantic diff comments", e);
    }
  };

  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateComments));

  // Run on initial load
  updateComments(vscode.window.activeTextEditor);
}
