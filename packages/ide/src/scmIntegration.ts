import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";
import { isSupportedModelFile } from "./utils/fileUtils";

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
              if (isSupportedModelFile(uri.fsPath)) {
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
    vscode.commands.registerCommand("modelscript.scm.openVisualDiff", async (resourceUri?: vscode.Uri) => {
      let uri = resourceUri;
      if (!uri) {
        uri = vscode.window.activeTextEditor?.document.uri;
      }
      if (!uri || !isSupportedModelFile(uri.fsPath)) {
        vscode.window.showErrorMessage(
          "Please open or select a supported ModelScript file (.sysml, .mo) to diff visually.",
        );
        return;
      }

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

      try {
        const oldText = await repository.show("HEAD", uri.fsPath);
        const newTextBytes = await vscode.workspace.fs.readFile(uri);
        const newText = new TextDecoder().decode(newTextBytes);

        if (!oldText || !newText) {
          vscode.window.showInformationMessage("No revisions found to diff.");
          return;
        }

        const panel = vscode.window.createWebviewPanel(
          "modelscript.visualDiff",
          `Visual Diff: ${uri.path.split("/").pop()}`,
          vscode.ViewColumn.Beside,
          {
            enableScripts: true,
            retainContextWhenHidden: true,
          },
        );

        if (!client) {
          panel.webview.html = "<h3>Language client not running.</h3>";
          return;
        }

        vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Computing Visual Model Diff...",
          },
          async () => {
            try {
              const res = await client.sendRequest<{ html: string }>("modelscript/diagram.getVisualDiff", {
                uri: uri.toString(),
                oldText,
                newText,
              });

              if (res && res.html) {
                panel.webview.html = res.html;
              } else {
                panel.webview.html = "<h3>Could not generate visual diff for this model revision.</h3>";
              }
            } catch (err) {
              panel.webview.html = `<h3>Error computing visual diff: ${err}</h3>`;
            }
          },
        );
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to open visual diff: ${err}`);
      }
    }),
  );
}
