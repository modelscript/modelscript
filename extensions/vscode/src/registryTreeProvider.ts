/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import * as vscode from "vscode";

export class RegistryWebviewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private registryUrl: string;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.registryUrl = vscode.workspace
      .getConfiguration("modelscript")
      .get("registryUrl", "http://127.0.0.1:3000/api/v1");
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    webviewView.webview.html = this.getHtmlForWebview();

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case "search": {
          await this.searchPackages(data.query);
          break;
        }
        case "install": {
          vscode.commands.executeCommand("modelscript.registry.install", data.packageName, data.packageVersion);
          break;
        }
        case "open": {
          vscode.commands.executeCommand("modelscript.registry.openPackage", data.packageName, data.packageVersion);
          break;
        }
      }
    });

    // Initial load
    this.searchPackages("");
  }

  private async searchPackages(query: string) {
    if (!this._view) return;
    try {
      const url = query
        ? `${this.registryUrl}/libraries?q=${encodeURIComponent(query)}`
        : `${this.registryUrl}/libraries`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error("Fetch failed");
      const data = (await resp.json()) as any;

      const packages = data.packages.slice(0, query ? undefined : 25).map((p: any) => ({
        name: p.name,
        version: p.latestVersion,
        description: p.description || `Version ${p.latestVersion}`,
      }));

      this._view.webview.postMessage({ type: "results", packages });
    } catch (err: any) {
      this._view.webview.postMessage({
        type: "error",
        message: `Failed to fetch packages: ${err.message || String(err)}`,
      });
    }
  }

  private getHtmlForWebview() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' var(--vscode-style-src); script-src 'unsafe-inline'; connect-src *;">
  <title>Packages</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background-color: var(--vscode-sideBar-background);
      padding: 0;
      margin: 0;
    }
    .search-container {
      padding: 10px;
      position: sticky;
      top: 0;
      background-color: var(--vscode-sideBar-background);
      border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
      z-index: 10;
      display: flex;
      align-items: center;
      position: relative;
    }
    input {
      width: 100%;
      box-sizing: border-box;
      padding: 6px 30px 6px 8px; /* padding-right for the icon */
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 2px;
      outline: none;
    }
    input:focus {
      border-color: var(--vscode-focusBorder);
    }
    .search-icon {
      position: absolute;
      right: 18px;
      top: 50%;
      transform: translateY(-50%);
      pointer-events: none;
    }
    .search-icon svg {
      width: 14px;
      height: 14px;
      fill: var(--vscode-button-background); /* Blue magnifying glass */
    }
    .package-list {
      display: flex;
      flex-direction: column;
    }
    .package-item {
      display: flex;
      padding: 10px;
      border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border);
      cursor: pointer;
    }
    .package-item:hover {
      background-color: var(--vscode-list-hoverBackground);
    }
    .icon {
      width: 32px;
      height: 32px;
      flex-shrink: 0;
      margin-right: 10px;
      background-color: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      border-radius: 4px;
    }
    .content {
      flex: 1;
      min-width: 0;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 4px;
    }
    .title {
      font-weight: 600;
      font-size: 13px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .version {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-left: 8px;
    }
    .description {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .actions {
      display: none;
      margin-top: 6px;
    }
    .package-item:hover .actions {
      display: flex;
      gap: 6px;
    }
    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: 1px solid var(--vscode-button-border, transparent);
      padding: 4px 8px;
      border-radius: 2px;
      cursor: pointer;
      font-size: 11px;
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .loading {
      padding: 20px;
      text-align: center;
      color: var(--vscode-descriptionForeground);
    }
  </style>
</head>
<body>
  <div class="search-container">
    <input type="text" id="searchInput" placeholder="Search packages..." autocomplete="off">
    <div class="search-icon">
      <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><path d="M15.7 14.3l-3.1-3.1c.9-1.2 1.4-2.6 1.4-4.2 0-3.9-3.1-7-7-7s-7 3.1-7 7 3.1 7 7 7c1.5 0 3-.5 4.2-1.4l3.1 3.1c.2.2.5.2.7 0l.7-.7c.2-.2.2-.5 0-.7zM2 7c0-2.8 2.2-5 5-5s5 2.2 5 5-2.2 5-5 5-5-2.2-5-5z"/></svg>
    </div>
  </div>
  <div id="packageList" class="package-list">
    <div class="loading">Loading packages...</div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const searchInput = document.getElementById('searchInput');
    const packageList = document.getElementById('packageList');
    
    let debounceTimer;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        packageList.innerHTML = '<div class="loading">Searching...</div>';
        vscode.postMessage({ type: 'search', query: e.target.value });
      }, 300);
    });

    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'results') {
        renderPackages(message.packages);
      } else if (message.type === 'error') {
        packageList.innerHTML = '<div class="loading">' + message.message + '</div>';
      }
    });

    function renderPackages(packages) {
      if (packages.length === 0) {
        packageList.innerHTML = '<div class="loading">No packages found</div>';
        return;
      }
      
      packageList.innerHTML = '';
      packages.forEach(pkg => {
        const item = document.createElement('div');
        item.className = 'package-item';
        
        const firstLetter = pkg.name.charAt(0).toUpperCase();
        
        item.innerHTML = \`
          <div class="icon">\${firstLetter}</div>
          <div class="content">
            <div class="header">
              <span class="title" title="\${pkg.name}">\${pkg.name}</span>
              <span class="version">\${pkg.version}</span>
            </div>
            <div class="description" title="\${pkg.description || ''}">\${pkg.description || ''}</div>
            <div class="actions">
              <button class="install-btn">Install</button>
            </div>
          </div>
        \`;
        
        item.addEventListener('click', (e) => {
          if (e.target.className === 'install-btn') {
            e.stopPropagation();
            vscode.postMessage({ type: 'install', packageName: pkg.name, packageVersion: pkg.version });
          } else {
            vscode.postMessage({ type: 'open', packageName: pkg.name, packageVersion: pkg.version });
          }
        });
        
        packageList.appendChild(item);
      });
    }
  </script>
</body>
</html>`;
  }
}

export function registerRegistryView(
  context: vscode.ExtensionContext,
  lspClient?: { sendNotification: (method: string, params: unknown) => void },
) {
  const provider = new RegistryWebviewProvider(context);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider("modelscript.registryView", provider));

  const registryUrl = vscode.workspace
    .getConfiguration("modelscript")
    .get("registryUrl", "http://127.0.0.1:3000/api/v1");

  // Open Registry command
  context.subscriptions.push(
    vscode.commands.registerCommand("modelscript.openRegistry", () => {
      vscode.commands.executeCommand("modelscript.registryView.focus");
    }),
  );

  // Install command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "modelscript.registry.install",
      async (packageName: string, packageVersion = "latest") => {
        if (!packageName || typeof packageName !== "string") {
          const input = await vscode.window.showInputBox({ prompt: "Package name to install (from ModelScript Hub)" });
          if (!input) return;
          packageName = input;
        }

        const folders = vscode.workspace.workspaceFolders;
        let targetFolder = folders ? folders[0] : undefined;

        if (folders && folders.length > 1) {
          const picks = folders.map((f) => ({ label: f.name, description: f.uri.fsPath, folder: f }));
          const picked = await vscode.window.showQuickPick(picks, {
            placeHolder: `Select workspace to install ${packageName}`,
          });
          if (!picked) return;
          targetFolder = picked.folder;
        }

        if (!targetFolder) {
          vscode.window.showErrorMessage("No workspace folder open. Cannot install package.");
          return;
        }

        vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Installing ${packageName}...`,
            cancellable: false,
          },
          async () => {
            const isWeb = vscode.env.uiKind === vscode.UIKind.Web;

            if (!isWeb) {
              // Desktop: use npm terminal install
              try {
                const terminal = vscode.window.createTerminal({
                  name: "ModelScript Install",
                  cwd: targetFolder?.uri,
                  hideFromUser: true,
                });

                terminal.sendText(
                  `npm install @modelscript/${packageName.toLowerCase()}@${packageVersion} --registry=${registryUrl}`,
                );
                terminal.sendText("exit");

                return new Promise<void>((resolve) => {
                  const disp = vscode.window.onDidCloseTerminal((t) => {
                    if (t === terminal) {
                      disp.dispose();
                      vscode.commands.executeCommand("modelscript.registryView.focus");
                      resolve();
                    }
                  });
                });
              } catch (err) {
                // Fall through to web fallback
              }
            }

            // Web IDE fallback: update package.json and notify LSP to load from registry
            try {
              if (!targetFolder) throw new Error("No target folder");
              const packageJsonUri = vscode.Uri.joinPath(targetFolder.uri, "package.json");
              let packageJsonObj: any = {};
              try {
                const data = await vscode.workspace.fs.readFile(packageJsonUri);
                packageJsonObj = JSON.parse(new TextDecoder().decode(data));
              } catch (e) {
                // Ignore read errors
              }
              packageJsonObj.dependencies = packageJsonObj.dependencies || {};
              packageJsonObj.dependencies[`@modelscript/${packageName.toLowerCase()}`] = packageVersion;

              const encoded = new TextEncoder().encode(JSON.stringify(packageJsonObj, null, 2));
              await vscode.workspace.fs.writeFile(packageJsonUri, encoded);

              vscode.window.showInformationMessage(`Loading ${packageName}@${packageVersion}...`);
              vscode.commands.executeCommand("modelscript.registryView.focus");
              // Notify the LSP to actually load the library files from the registry
              if (lspClient) {
                lspClient.sendNotification("modelscript/installDependency", {
                  name: packageName,
                  version: packageVersion,
                });
                setTimeout(() => {
                  vscode.commands.executeCommand("modelscript.libraryView.refresh");
                }, 500); // Give the LSP a moment to process before refreshing the view
              }
            } catch (fallbackErr) {
              vscode.window.showErrorMessage(`Failed to install package: ${fallbackErr}`);
            }
          },
        );
      },
    ),
  );

  // Uninstall command
  context.subscriptions.push(
    vscode.commands.registerCommand("modelscript.registry.uninstall", async (packageName: string) => {
      if (!packageName || typeof packageName !== "string") {
        const input = await vscode.window.showInputBox({ prompt: "Package name to uninstall" });
        if (!input) return;
        packageName = input;
      }

      const folders = vscode.workspace.workspaceFolders;
      let targetFolder = folders ? folders[0] : undefined;

      if (folders && folders.length > 1) {
        const picks = folders.map((f) => ({ label: f.name, description: f.uri.fsPath, folder: f }));
        const picked = await vscode.window.showQuickPick(picks, {
          placeHolder: `Select workspace to uninstall ${packageName}`,
        });
        if (!picked) return;
        targetFolder = picked.folder;
      }

      if (!targetFolder) {
        vscode.window.showErrorMessage("No workspace folder open. Cannot uninstall package.");
        return;
      }

      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Uninstalling ${packageName}...`,
          cancellable: false,
        },
        async () => {
          const isWeb = vscode.env.uiKind === vscode.UIKind.Web;

          if (!isWeb) {
            try {
              const terminal = vscode.window.createTerminal({
                name: "ModelScript Uninstall",
                cwd: targetFolder?.uri,
                hideFromUser: true,
              });

              terminal.sendText(`npm uninstall @modelscript/${packageName.toLowerCase()}`);
              terminal.sendText("exit");

              return new Promise<void>((resolve) => {
                const disp = vscode.window.onDidCloseTerminal((t) => {
                  if (t === terminal) {
                    disp.dispose();
                    vscode.commands.executeCommand("modelscript.registryView.focus");
                    resolve();
                  }
                });
              });
            } catch (err) {
              // Fall through to web fallback
            }
          }

          // Web IDE fallback
          try {
            if (!targetFolder) throw new Error("No target folder");
            const packageJsonUri = vscode.Uri.joinPath(targetFolder.uri, "package.json");
            try {
              const data = await vscode.workspace.fs.readFile(packageJsonUri);
              const packageJsonObj = JSON.parse(new TextDecoder().decode(data));
              if (packageJsonObj.dependencies) {
                // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                delete packageJsonObj.dependencies[`@modelscript/${packageName.toLowerCase()}`];
                const encoded = new TextEncoder().encode(JSON.stringify(packageJsonObj, null, 2));
                await vscode.workspace.fs.writeFile(packageJsonUri, encoded);
                vscode.window.showInformationMessage(`Removed ${packageName} from package.json.`);
              }
            } catch (e) {
              // Ignore
            }
            vscode.commands.executeCommand("modelscript.registryView.focus");
            if (lspClient) {
              lspClient.sendNotification("modelscript/uninstallDependency", { name: packageName });
              setTimeout(() => {
                vscode.commands.executeCommand("modelscript.libraryView.refresh");
              }, 500);
            }
          } catch (fallbackErr) {
            vscode.window.showErrorMessage(`Failed to uninstall package: ${fallbackErr}`);
          }
        },
      );
    }),
  );

  // Open package README
  context.subscriptions.push(
    vscode.commands.registerCommand("modelscript.registry.openPackage", async (name: string, version: string) => {
      const panel = vscode.window.createWebviewPanel(
        "modelscript.packageDetail",
        `${name}@${version}`,
        vscode.ViewColumn.One,
        { enableScripts: true },
      );

      panel.webview.onDidReceiveMessage((message) => {
        if (message.command === "install") {
          vscode.commands.executeCommand("modelscript.registry.install", name, version);
        }
      });

      try {
        const resp = await fetch(`${registryUrl}/libraries/${encodeURIComponent(name)}/${encodeURIComponent(version)}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const packument = (await resp.json()) as any;
        const readme = packument.description || "No description available.";
        panel.webview.html = `<!DOCTYPE html><html><head><style>
          body { font-family: var(--vscode-font-family); padding: 24px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
          h1 { font-size: 24px; margin-bottom: 4px; display: flex; align-items: center; justify-content: space-between; }
          .meta { color: var(--vscode-descriptionForeground); font-size: 13px; margin-bottom: 24px; }
          .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; margin-right: 8px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
          .install-box { background: var(--vscode-textBlockQuote-background); border: 1px solid var(--vscode-textBlockQuote-border); border-radius: 6px; padding: 12px 16px; font-family: monospace; font-size: 13px; margin-bottom: 24px; cursor: text; user-select: all; display: flex; justify-content: space-between; align-items: center; }
          .install-btn { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 600; outline: none; }
          .install-btn:hover { background: var(--vscode-button-hoverBackground); }
          .readme { line-height: 1.7; }
        </style></head><body>
          <h1>${escapeHtml(packument.name)} <button class="install-btn" onclick="acquireVsCodeApi().postMessage({command: 'install'})">Install Package</button></h1>
          <div class="meta">
            <span class="badge">${escapeHtml(packument.version)}</span>
            ${packument.modelicaVersion ? `<span class="badge">Modelica ${escapeHtml(packument.modelicaVersion)}</span>` : ""}
            <span>${packument.size ? Math.round(packument.size / 1024) : 0} KB</span>
          </div>
          <div class="install-box">
            <span>npm install @modelscript/${escapeHtml(packument.name.toLowerCase())}@${escapeHtml(packument.version)}</span>
          </div>
          <div class="readme">${escapeHtml(readme)}</div>
        </body></html>`;
      } catch (e) {
        panel.webview.html = `<html><body><p>Failed to load package details: ${e}</p></body></html>`;
      }
    }),
  );

  return provider;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
