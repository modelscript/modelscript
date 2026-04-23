// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Registry tree provider for the "ModelScript Packages" sidebar view.
//
// Provides a VS Code Extensions-bar-style experience for browsing,
// searching, installing, and managing ModelScript registry packages.
//
// The tree view has three top-level categories:
//   - INSTALLED: Packages found in the workspace's node_modules/@modelscript/
//   - SEARCH RESULTS: Packages matching the current search query
//   - RECENTLY UPDATED: Latest packages from the registry
//
// Clicking a package opens its README in a webview panel (similar to the
// VS Code Extensions detail pane).
//
// The "Install" command runs `npm install <package> --registry=<url>` in a
// VS Code terminal.

import * as vscode from "vscode";

/** A package from the registry search API. */
interface RegistryPackage {
  name: string;
  version: string;
  description: string | null;
  date?: string;
}

/** Section header item. */
class RegistrySectionItem extends vscode.TreeItem {
  readonly packages: RegistryPackageItem[];

  constructor(label: string, packages: RegistryPackageItem[]) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.packages = packages;
    this.contextValue = "section";
    this.iconPath = new vscode.ThemeIcon("folder");
  }
}

/** A single package in the tree. */
class RegistryPackageItem extends vscode.TreeItem {
  readonly packageName: string;
  readonly packageVersion: string;
  readonly installed: boolean;

  constructor(info: RegistryPackage, installed: boolean) {
    super(info.name, vscode.TreeItemCollapsibleState.None);
    this.packageName = info.name;
    this.packageVersion = info.version;
    this.installed = installed;
    this.description = info.version;
    this.tooltip = info.description ?? info.name;
    this.contextValue = installed ? "installed-package" : "registry-package";
    this.iconPath = new vscode.ThemeIcon(installed ? "check" : "package");

    // Click to open the package README
    this.command = {
      command: "modelscript.registry.openPackage",
      title: "View Package",
      arguments: [info.name, info.version],
    };
  }
}

type RegistryTreeNode = RegistrySectionItem | RegistryPackageItem;

export class RegistryTreeProvider implements vscode.TreeDataProvider<RegistryTreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<RegistryTreeNode | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private registryUrl: string;
  private searchQuery = "";
  private searchResults: RegistryPackage[] = [];
  private installedPackages: RegistryPackage[] = [];
  private recentPackages: RegistryPackage[] = [];

  constructor(registryUrl?: string) {
    this.registryUrl =
      registryUrl ?? vscode.workspace.getConfiguration("modelscript").get("registryUrl", "https://api.modelscript.org");
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  setSearchQuery(query: string): void {
    this.searchQuery = query;
    this.refreshSearch();
  }

  getTreeItem(element: RegistryTreeNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: RegistryTreeNode): Promise<RegistryTreeNode[]> {
    if (!element) {
      // Root level — show sections
      await this.loadData();
      const sections: RegistrySectionItem[] = [];

      if (this.installedPackages.length > 0) {
        sections.push(
          new RegistrySectionItem(
            "INSTALLED",
            this.installedPackages.map((p) => new RegistryPackageItem(p, true)),
          ),
        );
      }

      if (this.searchQuery && this.searchResults.length > 0) {
        sections.push(
          new RegistrySectionItem(
            `RESULTS FOR "${this.searchQuery}"`,
            this.searchResults.map((p) => new RegistryPackageItem(p, false)),
          ),
        );
      }

      if (this.recentPackages.length > 0) {
        sections.push(
          new RegistrySectionItem(
            "RECENTLY UPDATED",
            this.recentPackages.map((p) => new RegistryPackageItem(p, false)),
          ),
        );
      }

      if (sections.length === 0) {
        // Empty state
        const empty = new vscode.TreeItem("No packages found");
        empty.iconPath = new vscode.ThemeIcon("info");
        return [empty as RegistryTreeNode];
      }

      return sections;
    }

    // Children of a section
    if (element instanceof RegistrySectionItem) {
      return element.packages;
    }

    return [];
  }

  private async loadData(): Promise<void> {
    await Promise.all([this.loadInstalled(), this.loadRecent()]);
  }

  private async loadInstalled(): Promise<void> {
    this.installedPackages = [];

    // Scan workspace for node_modules/@modelscript/*/package.json
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;

    for (const folder of workspaceFolders) {
      const pattern = new vscode.RelativePattern(folder, "node_modules/@modelscript/*/package.json");
      const files = await vscode.workspace.findFiles(pattern, undefined, 50);

      for (const file of files) {
        try {
          const content = await vscode.workspace.fs.readFile(file);
          const manifest = JSON.parse(new TextDecoder().decode(content)) as {
            name: string;
            version: string;
            description?: string;
          };
          this.installedPackages.push({
            name: manifest.name,
            version: manifest.version,
            description: manifest.description ?? null,
          });
        } catch {
          // skip malformed package.json
        }
      }
    }
  }

  private async loadRecent(): Promise<void> {
    try {
      const resp = await fetch(`${this.registryUrl}/-/v1/search?text=&size=10`);
      if (!resp.ok) {
        this.recentPackages = [];
        return;
      }
      const data = (await resp.json()) as { objects: { package: RegistryPackage }[] };
      this.recentPackages = data.objects.map((o) => o.package);
    } catch {
      this.recentPackages = [];
    }
  }

  private async refreshSearch(): Promise<void> {
    if (!this.searchQuery) {
      this.searchResults = [];
      this.refresh();
      return;
    }

    try {
      const resp = await fetch(`${this.registryUrl}/-/v1/search?text=${encodeURIComponent(this.searchQuery)}&size=20`);
      if (!resp.ok) {
        this.searchResults = [];
        this.refresh();
        return;
      }
      const data = (await resp.json()) as { objects: { package: RegistryPackage }[] };
      this.searchResults = data.objects.map((o) => o.package);
    } catch {
      this.searchResults = [];
    }

    this.refresh();
  }
}

/**
 * Register the registry tree view and its commands.
 */
export function registerRegistryView(context: vscode.ExtensionContext): RegistryTreeProvider {
  const treeProvider = new RegistryTreeProvider();
  const registryUrl = vscode.workspace
    .getConfiguration("modelscript")
    .get("registryUrl", "https://api.modelscript.org");

  const treeView = vscode.window.createTreeView("modelscript.registryView", {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  // Search command
  context.subscriptions.push(
    vscode.commands.registerCommand("modelscript.registry.search", async () => {
      const query = await vscode.window.showInputBox({
        prompt: "Search ModelScript packages",
        placeHolder: "e.g. motor, msl, thermal...",
      });
      if (query !== undefined) {
        treeProvider.setSearchQuery(query);
      }
    }),
  );

  // Refresh command
  context.subscriptions.push(
    vscode.commands.registerCommand("modelscript.registry.refresh", () => {
      treeProvider.refresh();
    }),
  );

  // Install command
  context.subscriptions.push(
    vscode.commands.registerCommand("modelscript.registry.install", (item: RegistryPackageItem) => {
      const terminal = vscode.window.createTerminal("ModelScript Install");
      terminal.show();
      terminal.sendText(`npm install ${item.packageName}@${item.packageVersion} --registry=${registryUrl}`);
    }),
  );

  // Uninstall command
  context.subscriptions.push(
    vscode.commands.registerCommand("modelscript.registry.uninstall", (item: RegistryPackageItem) => {
      const terminal = vscode.window.createTerminal("ModelScript Uninstall");
      terminal.show();
      terminal.sendText(`npm uninstall ${item.packageName}`);
    }),
  );

  // Open package README in a webview
  context.subscriptions.push(
    vscode.commands.registerCommand("modelscript.registry.openPackage", async (name: string, version: string) => {
      const panel = vscode.window.createWebviewPanel(
        "modelscript.packageDetail",
        `${name}@${version}`,
        vscode.ViewColumn.One,
        { enableScripts: false },
      );

      try {
        const resp = await fetch(`${registryUrl}/${encodeURIComponent(name)}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const packument = (await resp.json()) as {
          readme?: string;
          description?: string;
          license?: string;
          versions: Record<string, { description?: string }>;
        };

        const readme = packument.readme || packument.description || "No documentation available.";
        const versionCount = Object.keys(packument.versions).length;

        panel.webview.html = `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
    h1 { font-size: 24px; margin-bottom: 4px; }
    .meta { color: var(--vscode-descriptionForeground); font-size: 13px; margin-bottom: 24px; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; margin-right: 8px;
             background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
    .install-box { background: var(--vscode-textBlockQuote-background); border: 1px solid var(--vscode-textBlockQuote-border);
                   border-radius: 6px; padding: 12px 16px; font-family: monospace; font-size: 13px; margin-bottom: 24px; }
    .readme { line-height: 1.7; }
    .readme h1, .readme h2, .readme h3 { margin-top: 24px; }
    .readme code { background: var(--vscode-textBlockQuote-background); padding: 2px 6px; border-radius: 3px; }
    .readme pre { background: var(--vscode-textBlockQuote-background); padding: 16px; border-radius: 6px; overflow-x: auto; }
  </style>
</head>
<body>
  <h1>${escapeHtml(name)}</h1>
  <div class="meta">
    <span class="badge">${escapeHtml(version)}</span>
    ${packument.license ? `<span class="badge">${escapeHtml(packument.license)}</span>` : ""}
    <span>${versionCount} version${versionCount !== 1 ? "s" : ""}</span>
  </div>
  <div class="install-box">npm install ${escapeHtml(name)}</div>
  <div class="readme">${readme}</div>
</body>
</html>`;
      } catch (e) {
        panel.webview.html = `<html><body><p>Failed to load package details: ${e}</p></body></html>`;
      }
    }),
  );

  context.subscriptions.push(treeView);

  return treeProvider;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
