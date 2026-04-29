import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";

export function registerScmIntegration(context: vscode.ExtensionContext, client: LanguageClient | undefined) {
  context.subscriptions.push(
    vscode.commands.registerCommand("modelscript.scm.generateCommitMessage", async () => {
      if (!client) {
        vscode.window.showErrorMessage("Language server is not running.");
        return;
      }

      // 1. Get VS Code Git extension API
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gitExtension = vscode.extensions.getExtension<any>("vscode.git")?.exports;
      if (!gitExtension) {
        vscode.window.showErrorMessage("Git extension is not available.");
        return;
      }

      const git = gitExtension.getAPI(1);
      if (!git || git.repositories.length === 0) {
        vscode.window.showErrorMessage("No Git repository found in the current workspace.");
        return;
      }

      const repository = git.repositories[0];

      // 2. Get staged changes
      // This is dependent on git extension API. Let's try to get working tree or index changes
      const changes = repository.state.indexChanges;
      if (!changes || changes.length === 0) {
        vscode.window.showInformationMessage("No staged changes to generate a commit message for.");
        return;
      }

      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.SourceControl,
          title: "Generating Semantic Commit Message...",
        },
        async () => {
          try {
            const stagedDiffs = [];
            for (const change of changes) {
              const uri = change.uri;
              if (uri.fsPath.endsWith(".mo") || uri.fsPath.endsWith(".sysml")) {
                try {
                  // Use git show to get HEAD version
                  const oldText = await repository.show("HEAD", uri.fsPath);

                  // Read the current file on disk (or from document if open)
                  const newTextBytes = await vscode.workspace.fs.readFile(uri);
                  const newText = new TextDecoder().decode(newTextBytes);

                  stagedDiffs.push({
                    uri: uri.toString(),
                    oldText,
                    newText,
                  });
                } catch (e) {
                  console.error("Failed to get diff for", uri.fsPath, e);
                }
              }
            }

            if (stagedDiffs.length === 0) {
              vscode.window.showInformationMessage("No supported staged files for semantic diff.");
              return;
            }

            // 3. Request semantic commit message from the language server
            const result = await client.sendRequest<{ commitMessage: string }>("modelscript/generateCommitMessage", {
              changes: stagedDiffs,
            });

            if (result && result.commitMessage) {
              repository.inputBox.value = result.commitMessage;
            } else {
              vscode.window.showErrorMessage("Failed to generate a commit message.");
            }
          } catch (e) {
            vscode.window.showErrorMessage(`Error generating commit message: ${e}`);
          }
        },
      );
    }),
  );
}
