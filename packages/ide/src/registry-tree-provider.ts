// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import { getRegistryUrl } from "./utils/config.js";

export interface AnsatzPackageSummary {
  name: string;
  versions?: string[] | undefined;
  latestVersion?: string | null | undefined;
  description?: string | undefined;
  license?: string | undefined;
  author?: string | undefined;
  scope?: string | undefined;
  totalDownloads?: number | undefined;
  downloads30d?: number | undefined;
  domains?: string[] | undefined;
  isDeprecated?: boolean | undefined;
}

interface RegistryPackument {
  name: string;
  version: string;
  description?: string | undefined;
  modelicaVersion?: string | undefined;
  license?: string | undefined;
  size?: number | undefined;
}

interface PackageQuickPickItem extends vscode.QuickPickItem {
  pkg: AnsatzPackageSummary;
}

/**
 * Fetches matching packages from the Ansatz registry (`/api/v1/packages` with fallback to `/api/v1/libraries`).
 */
export async function searchAnsatzPackages(query: string, signal?: AbortSignal): Promise<AnsatzPackageSummary[]> {
  const baseUrl = getRegistryUrl().replace(/\/+$/, "");
  const encodedQuery = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
  const endpoints = [`${baseUrl}/packages${encodedQuery}`, `${baseUrl}/libraries${encodedQuery}`];

  let lastError: unknown;
  for (const url of endpoints) {
    try {
      const resp = await fetch(url, signal ? { signal } : undefined);
      if (!resp.ok) {
        lastError = new Error(`HTTP ${resp.status}`);
        continue;
      }
      const data = (await resp.json()) as { packages?: AnsatzPackageSummary[] | undefined };
      if (Array.isArray(data.packages)) {
        return data.packages;
      }
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") {
        throw err;
      }
      lastError = err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "Failed to reach Ansatz registry"));
}

function toQuickPickItem(pkg: AnsatzPackageSummary): PackageQuickPickItem {
  const version = pkg.latestVersion || pkg.versions?.[0] || "latest";
  const domainBadges = pkg.domains && pkg.domains.length > 0 ? ` · [${pkg.domains.join(", ")}]` : "";
  const downloads =
    typeof pkg.totalDownloads === "number" && pkg.totalDownloads > 0
      ? ` · $(cloud-download) ${pkg.totalDownloads}`
      : "";
  const deprecated = pkg.isDeprecated ? " $(warning) [Deprecated]" : "";

  return {
    label: `$(package) ${pkg.name}`,
    description: `v${version}${domainBadges}${downloads}${deprecated}`,
    detail: pkg.description || `Install ${pkg.name}@${version} from Ansatz into Standard Libraries`,
    alwaysShow: true,
    buttons: [
      {
        iconPath: new vscode.ThemeIcon("info"),
        tooltip: "View Package Details",
      },
    ],
    pkg,
  };
}

/**
 * Opens an interactive VS Code QuickPick that searches Ansatz live and installs the chosen package
 * directly into the workspace and Standard Libraries tree view.
 */
export async function showAnsatzPackagePicker(): Promise<void> {
  const quickPick = vscode.window.createQuickPick<PackageQuickPickItem>();
  quickPick.title = "Add Package from Ansatz Registry";
  quickPick.placeholder =
    "Search Ansatz packages by name, domain, or keyword (e.g., Modelica, Thermal, PlanarMechanics)...";
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let activeAbort: AbortController | null = null;

  const runSearch = async (query: string) => {
    if (activeAbort) {
      activeAbort.abort();
    }
    const controller = new AbortController();
    activeAbort = controller;
    quickPick.busy = true;

    try {
      const results = await searchAnsatzPackages(query, controller.signal);
      if (controller.signal.aborted) return;

      if (results.length === 0 && query.trim().length > 0) {
        // Allow direct install of typed package spec (e.g., "MyPackage" or "MyPackage@1.0.0")
        const [rawName, rawVer] = query.trim().split("@");
        const directPkg: AnsatzPackageSummary = {
          name: rawName || query.trim(),
          latestVersion: rawVer || "latest",
          description: `Install '${query.trim()}' directly from Ansatz registry`,
        };
        quickPick.items = [toQuickPickItem(directPkg)];
      } else {
        quickPick.items = results.slice(0, 50).map(toQuickPickItem);
      }
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      const raw = query.trim();
      if (raw.length > 0) {
        const [rawName, rawVer] = raw.split("@");
        quickPick.items = [
          toQuickPickItem({
            name: rawName || raw,
            latestVersion: rawVer || "latest",
            description: `Install '${raw}' from Ansatz (${getRegistryUrl()})`,
          }),
        ];
      } else {
        quickPick.items = [];
      }
    } finally {
      if (activeAbort === controller) {
        quickPick.busy = false;
      }
    }
  };

  quickPick.onDidChangeValue((value) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      void runSearch(value);
    }, 220);
  });

  quickPick.onDidTriggerItemButton((event) => {
    const { pkg } = event.item;
    const version = pkg.latestVersion || pkg.versions?.[0] || "latest";
    quickPick.hide();
    void vscode.commands.executeCommand("modelscript.registry.openPackage", pkg.name, version);
  });

  quickPick.onDidAccept(async () => {
    const selected = quickPick.selectedItems[0];
    if (!selected) return;
    quickPick.hide();

    const { pkg } = selected;
    let targetVersion = pkg.latestVersion || pkg.versions?.[0] || "latest";

    if (pkg.versions && pkg.versions.length > 1) {
      const versionItems: (vscode.QuickPickItem & { version: string })[] = pkg.versions.map((v, idx) =>
        idx === 0 ? { label: v, description: "(latest)", version: v } : { label: v, version: v },
      );
      const pickedVer = await vscode.window.showQuickPick(versionItems, {
        title: `Select Version for ${pkg.name}`,
        placeHolder: `Choose version of ${pkg.name} to add to Standard Libraries`,
      });
      if (!pickedVer) return;
      targetVersion = pickedVer.version;
    }

    await vscode.commands.executeCommand("modelscript.registry.install", pkg.name, targetVersion);
  });

  quickPick.onDidHide(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (activeAbort) activeAbort.abort();
    quickPick.dispose();
  });

  quickPick.show();
  void runSearch("");
}

/**
 * Resolves `"latest"` version against Ansatz if needed so the LSP loader receives a concrete semver when available.
 */
async function resolveConcreteVersion(packageName: string, requestedVersion: string): Promise<string> {
  if (requestedVersion && requestedVersion !== "latest") {
    return requestedVersion;
  }
  const baseUrl = getRegistryUrl().replace(/\/+$/, "");
  for (const prefix of ["packages", "libraries"]) {
    try {
      const resp = await fetch(`${baseUrl}/${prefix}/${encodeURIComponent(packageName)}`);
      if (resp.ok) {
        const data = (await resp.json()) as { latestVersion?: string; versions?: string[] };
        if (data.latestVersion) return data.latestVersion;
        if (Array.isArray(data.versions) && data.versions.length > 0 && data.versions[0]) {
          return data.versions[0];
        }
      }
    } catch {
      // Fall through
    }
  }
  return requestedVersion || "latest";
}

export function registerRegistryView(
  context: vscode.ExtensionContext,
  lspClient?: { sendNotification: (method: string, params: unknown) => void },
): void {
  const openPicker = async () => {
    await showAnsatzPackagePicker();
  };

  // Register unified Standard Libraries '+' button and command palette aliases
  context.subscriptions.push(
    vscode.commands.registerCommand("modelscript.libraryView.addPackage", openPicker),
    vscode.commands.registerCommand("modelscript.registry.search", openPicker),
    vscode.commands.registerCommand("modelscript.openRegistry", openPicker),
  );

  // Install package from Ansatz into Standard Libraries & workspace package.json
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "modelscript.registry.install",
      async (packageName?: string, packageVersion = "latest") => {
        if (!packageName || typeof packageName !== "string") {
          await showAnsatzPackagePicker();
          return;
        }

        const resolvedVersion = await resolveConcreteVersion(packageName, packageVersion);

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Adding ${packageName}@${resolvedVersion} from Ansatz...`,
            cancellable: false,
          },
          async () => {
            try {
              // 1. Update workspace package.json if a workspace folder is open
              const folders = vscode.workspace.workspaceFolders;
              const targetFolder = folders?.[0];
              if (targetFolder) {
                try {
                  const packageJsonUri = vscode.Uri.joinPath(targetFolder.uri, "package.json");
                  let packageJsonObj: { dependencies?: Record<string, string> | undefined } = {};
                  try {
                    const data = await vscode.workspace.fs.readFile(packageJsonUri);
                    packageJsonObj = JSON.parse(new TextDecoder().decode(data)) as {
                      dependencies?: Record<string, string> | undefined;
                    };
                  } catch {
                    // Create or ignore if package.json does not exist yet
                  }
                  packageJsonObj.dependencies = packageJsonObj.dependencies || {};
                  packageJsonObj.dependencies[packageName] = resolvedVersion;

                  const encoded = new TextEncoder().encode(JSON.stringify(packageJsonObj, null, 2));
                  await vscode.workspace.fs.writeFile(packageJsonUri, encoded);
                } catch {
                  // Non-fatal if workspace is read-only or virtual without package.json
                }
              }

              // 2. Notify the LSP to fetch the pre-computed bundle / files from Ansatz and index into VFS
              if (lspClient) {
                lspClient.sendNotification("modelscript/installDependency", {
                  name: packageName,
                  version: resolvedVersion,
                });
                setTimeout(() => {
                  void vscode.commands.executeCommand("modelscript.libraryView.refresh");
                }, 600);
              }
            } catch (err) {
              vscode.window.showErrorMessage(`Failed to add package '${packageName}': ${err}`);
            }
          },
        );
      },
    ),
  );

  // Uninstall / remove package command
  const uninstallHandler = async (arg?: string | { info?: { name?: string; id?: string } }) => {
    let packageName =
      typeof arg === "string"
        ? arg
        : typeof arg?.info?.name === "string"
          ? arg.info.name
          : typeof arg?.info?.id === "string"
            ? arg.info.id.replace(/^__LIB__:/, "")
            : undefined;

    if (!packageName) {
      const input = await vscode.window.showInputBox({ prompt: "Package name to remove from workspace" });
      if (!input) return;
      packageName = input.trim();
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Removing ${packageName}...`,
        cancellable: false,
      },
      async () => {
        try {
          const folders = vscode.workspace.workspaceFolders;
          const targetFolder = folders?.[0];
          if (targetFolder) {
            try {
              const packageJsonUri = vscode.Uri.joinPath(targetFolder.uri, "package.json");
              const data = await vscode.workspace.fs.readFile(packageJsonUri);
              const packageJsonObj = JSON.parse(new TextDecoder().decode(data)) as {
                dependencies?: Record<string, string> | undefined;
              };
              if (packageJsonObj.dependencies) {
                Reflect.deleteProperty(packageJsonObj.dependencies, packageName);
                Reflect.deleteProperty(packageJsonObj.dependencies, `@modelscript/${packageName.toLowerCase()}`);
                const encoded = new TextEncoder().encode(JSON.stringify(packageJsonObj, null, 2));
                await vscode.workspace.fs.writeFile(packageJsonUri, encoded);
              }
            } catch {
              // Ignore if no package.json
            }
          }

          if (lspClient) {
            lspClient.sendNotification("modelscript/uninstallDependency", { name: packageName });
            setTimeout(() => {
              void vscode.commands.executeCommand("modelscript.libraryView.refresh");
            }, 500);
          }
          vscode.window.showInformationMessage(`Removed ${packageName}.`);
        } catch (err) {
          vscode.window.showErrorMessage(`Failed to remove package '${packageName}': ${err}`);
        }
      },
    );
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("modelscript.registry.uninstall", uninstallHandler),
    vscode.commands.registerCommand("modelscript.libraryView.removePackage", uninstallHandler),
  );

  // Open package details / README
  context.subscriptions.push(
    vscode.commands.registerCommand("modelscript.registry.openPackage", async (name: string, version: string) => {
      const resolvedVersion = await resolveConcreteVersion(name, version);
      const panel = vscode.window.createWebviewPanel(
        "modelscript.packageDetail",
        `${name}@${resolvedVersion}`,
        vscode.ViewColumn.One,
        { enableScripts: true },
      );

      panel.webview.onDidReceiveMessage((message) => {
        if (message.command === "install") {
          void vscode.commands.executeCommand("modelscript.registry.install", name, resolvedVersion);
        }
      });

      try {
        const registryUrl = getRegistryUrl().replace(/\/+$/, "");
        let resp = await fetch(
          `${registryUrl}/packages/${encodeURIComponent(name)}/${encodeURIComponent(resolvedVersion)}`,
        );
        if (!resp.ok) {
          resp = await fetch(
            `${registryUrl}/libraries/${encodeURIComponent(name)}/${encodeURIComponent(resolvedVersion)}`,
          );
        }
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const packument = (await resp.json()) as RegistryPackument;
        const readme = packument.description || "No description available.";
        panel.webview.html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';"><style>
          body { font-family: var(--vscode-font-family); padding: 24px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
          h1 { font-size: 24px; margin-bottom: 4px; display: flex; align-items: center; justify-content: space-between; }
          .meta { color: var(--vscode-descriptionForeground); font-size: 13px; margin-bottom: 24px; }
          .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; margin-right: 8px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
          .install-btn { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 14px; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 600; outline: none; }
          .install-btn:hover { background: var(--vscode-button-hoverBackground); }
          .readme { line-height: 1.7; }
        </style></head><body>
          <h1>${escapeHtml(packument.name || name)} <button class="install-btn" onclick="acquireVsCodeApi().postMessage({command: 'install'})">Add to Standard Libraries</button></h1>
          <div class="meta">
            <span class="badge">v${escapeHtml(packument.version || resolvedVersion)}</span>
            ${packument.license ? `<span class="badge">${escapeHtml(packument.license)}</span>` : ""}
            ${packument.modelicaVersion ? `<span class="badge">Modelica ${escapeHtml(packument.modelicaVersion)}</span>` : ""}
            ${packument.size ? `<span>${Math.round(packument.size / 1024)} KB</span>` : ""}
          </div>
          <div class="readme">${escapeHtml(readme)}</div>
        </body></html>`;
      } catch (e) {
        panel.webview.html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none';"></head><body><p>Failed to load package details: ${escapeHtml(String(e))}</p></body></html>`;
      }
    }),
  );
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
