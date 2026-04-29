import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";
import { FlatSemanticEdit } from "./semanticDiffComments"; // actually, we should define it locally or import from where it is shared

// We'll define the interface locally to avoid circular dependencies if any
interface SemanticEditNode {
  action: "insert" | "delete" | "update" | "none";
  description: string;
  kind?: string;
  uri: vscode.Uri;
}

class SemanticDiffTreeItem extends vscode.TreeItem {
  constructor(public readonly edit: SemanticEditNode) {
    super(edit.description, vscode.TreeItemCollapsibleState.None);

    this.tooltip = edit.description;

    // Set icon based on action
    if (edit.action === "insert") {
      this.iconPath = new vscode.ThemeIcon("add", new vscode.ThemeColor("gitDecoration.addedResourceForeground"));
    } else if (edit.action === "delete") {
      this.iconPath = new vscode.ThemeIcon("trash", new vscode.ThemeColor("gitDecoration.deletedResourceForeground"));
    } else if (edit.action === "update") {
      this.iconPath = new vscode.ThemeIcon("edit", new vscode.ThemeColor("gitDecoration.modifiedResourceForeground"));
    } else {
      this.iconPath = new vscode.ThemeIcon("info");
    }

    // Add file context
    const filename = edit.uri.path.split("/").pop();
    this.description = filename;
  }
}

class SemanticDiffTreeProvider implements vscode.TreeDataProvider<SemanticDiffTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<SemanticDiffTreeItem | undefined> = new vscode.EventEmitter<
    SemanticDiffTreeItem | undefined
  >();
  readonly onDidChangeTreeData: vscode.Event<SemanticDiffTreeItem | undefined> = this._onDidChangeTreeData.event;

  private items: SemanticDiffTreeItem[] = [];

  constructor(private client: LanguageClient | undefined) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SemanticDiffTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: SemanticDiffTreeItem): Promise<SemanticDiffTreeItem[]> {
    if (element) {
      return []; // We're keeping it flat for now, grouping by file could be next
    }

    if (!this.client) return [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gitExtension = vscode.extensions.getExtension<any>("vscode.git")?.exports;
    if (!gitExtension) return [];

    const git = gitExtension.getAPI(1);
    if (!git || git.repositories.length === 0) return [];

    const repository = git.repositories[0];
    const changes = repository.state.indexChanges;

    if (!changes || changes.length === 0) return [];

    const resultItems: SemanticDiffTreeItem[] = [];

    for (const change of changes) {
      const uri = change.uri;
      if (!(uri.fsPath.endsWith(".mo") || uri.fsPath.endsWith(".sysml"))) {
        continue;
      }

      try {
        const oldText = await repository.show("HEAD", uri.fsPath);
        const newTextBytes = await vscode.workspace.fs.readFile(uri);
        const newText = new TextDecoder().decode(newTextBytes);

        if (!oldText || !newText || oldText === newText) continue;

        const result = await this.client.sendRequest<{ diffs: FlatSemanticEdit[] }>("modelscript/getSemanticDiff", {
          uri: uri.toString(),
          oldText,
          newText,
        });

        if (result && result.diffs) {
          for (const diff of result.diffs) {
            if (diff.action !== "none" && diff.description) {
              resultItems.push(
                new SemanticDiffTreeItem({
                  action: diff.action,
                  description: diff.description,
                  kind: diff.kind,
                  uri: uri,
                }),
              );
            }
          }
        }
      } catch (e) {
        console.error("Failed to get semantic diff for", uri.fsPath, e);
      }
    }

    this.items = resultItems;
    return this.items;
  }
}

export function registerScmTreeView(context: vscode.ExtensionContext, client: LanguageClient | undefined) {
  const treeProvider = new SemanticDiffTreeProvider(client);

  context.subscriptions.push(vscode.window.registerTreeDataProvider("modelscript.scmTreeView", treeProvider));

  // Refresh when git state changes
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gitExtension = vscode.extensions.getExtension<any>("vscode.git")?.exports;
  if (gitExtension) {
    const git = gitExtension.getAPI(1);
    if (git && git.repositories.length > 0) {
      const repo = git.repositories[0];
      context.subscriptions.push(
        repo.state.onDidChange(() => {
          treeProvider.refresh();
        }),
      );
    }
  }
}
