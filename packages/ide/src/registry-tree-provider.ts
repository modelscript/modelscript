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
  pkg?: AnsatzPackageSummary | undefined;
  actionCommand?: string | undefined;
}

const PINNED_QUICK_ACTIONS: PackageQuickPickItem[] = [
  {
    label: "$(file-zip) Import Library from .zip Archive...",
    description: "Local file",
    detail: "Mount a local .zip library archive directly into the workspace Libraries panel",
    alwaysShow: true,
    actionCommand: "modelscript.libraryView.importZip",
  },
  {
    label: "$(cloud-download) Import Library from URL...",
    description: "GitHub / HTTP .zip",
    detail: "Download and mount a .zip library archive from any URL",
    alwaysShow: true,
    actionCommand: "modelscript.libraryView.importUrl",
  },
];

const CURATED_LIBRARIES: AnsatzPackageSummary[] = [
  {
    name: "Modelica",
    latestVersion: "4.1.0",
    versions: ["4.1.0", "4.0.0", "3.2.3"],
    description:
      "Modelica Standard Library — multi-domain physical modeling (Electrical, Mechanical, Fluid, Thermal, Blocks)",
    license: "BSD-3-Clause",
    domains: ["Modelica", "Physical Modeling"],
  },
  {
    name: "SysML",
    latestVersion: "2026.3.0",
    versions: ["2026.3.0"],
    description: "OMG Systems Modeling Language (SysML v2) & KerML Standard Library",
    license: "OMG",
    domains: ["SysML v2", "Systems Engineering"],
  },
  {
    name: "IEEE-Transmission-Benchmarks",
    latestVersion: "1.0.0",
    versions: ["1.0.0"],
    description: "Standard IEEE 14, 30, 57, 118 & 300-bus transmission test networks with coordinates",
    license: "CC0-1.0",
    domains: ["Power & Energy", "PSS/E", "Transmission"],
  },
  {
    name: "PSSE-Standard-Dynamics",
    latestVersion: "1.0.0",
    versions: ["1.0.0"],
    description: "Standard IEEE & WECC generator, exciter, governor, and stabilizer dynamic models",
    license: "Apache-2.0",
    domains: ["Power & Energy", "PSS/E", "Dynamics"],
  },
  {
    name: "IEEE-Test-Feeders",
    latestVersion: "1.0.0",
    versions: ["1.0.0"],
    description: "IEEE 13-Bus, 34-Bus, 123-Bus & 8500-Node OpenDSS distribution test feeders",
    license: "Apache-2.0",
    domains: ["Power & Energy", "OpenDSS", "Distribution"],
  },
];

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
    detail: pkg.description || `Install ${pkg.name}@${version} from Ansatz into Libraries`,
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
 * directly into the workspace and Libraries tree view.
 */
export async function showAnsatzPackagePicker(): Promise<void> {
  const quickPick = vscode.window.createQuickPick<PackageQuickPickItem>();
  quickPick.title = "Add Library to Workspace";
  quickPick.placeholder =
    "Search Ansatz packages by name, domain, or keyword (e.g., Modelica, SysML, Thermal, PlanarMechanics)...";
  quickPick.matchOnDescription = true;
  quickPick.matchOnDetail = true;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let activeAbort: AbortController | null = null;

  const filterCurated = (q: string): AnsatzPackageSummary[] => {
    const trimmed = q.trim().toLowerCase();
    if (!trimmed) return CURATED_LIBRARIES;
    return CURATED_LIBRARIES.filter(
      (c) =>
        c.name.toLowerCase().includes(trimmed) ||
        (c.description && c.description.toLowerCase().includes(trimmed)) ||
        c.domains?.some((d) => d.toLowerCase().includes(trimmed)),
    );
  };

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

      const seen = new Set(results.map((r) => r.name.toLowerCase()));
      const extraCurated = filterCurated(query).filter((c) => !seen.has(c.name.toLowerCase()));
      const merged = [...results.slice(0, 50), ...extraCurated];

      if (merged.length === 0 && query.trim().length > 0) {
        // Allow direct install of typed package spec (e.g., "MyPackage" or "MyPackage@1.0.0")
        const [rawName, rawVer] = query.trim().split("@");
        const directPkg: AnsatzPackageSummary = {
          name: rawName || query.trim(),
          latestVersion: rawVer || "latest",
          description: `Install '${query.trim()}' directly from Ansatz registry`,
        };
        quickPick.items = [toQuickPickItem(directPkg), ...PINNED_QUICK_ACTIONS];
      } else {
        quickPick.items = [...merged.map(toQuickPickItem), ...PINNED_QUICK_ACTIONS];
      }
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      const raw = query.trim();
      const curated = filterCurated(raw).map(toQuickPickItem);
      if (raw.length > 0) {
        const [rawName, rawVer] = raw.split("@");
        quickPick.items = [
          toQuickPickItem({
            name: rawName || raw,
            latestVersion: rawVer || "latest",
            description: `Install '${raw}' from Ansatz (${getRegistryUrl()})`,
          }),
          ...curated,
          ...PINNED_QUICK_ACTIONS,
        ];
      } else {
        quickPick.items = [...curated, ...PINNED_QUICK_ACTIONS];
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
    if (!pkg) return;
    const version = pkg.latestVersion || pkg.versions?.[0] || "latest";
    quickPick.hide();
    void vscode.commands.executeCommand("modelscript.registry.openPackage", pkg.name, version);
  });

  quickPick.onDidAccept(async () => {
    const selected = quickPick.selectedItems[0];
    if (!selected) return;
    quickPick.hide();

    if (selected.actionCommand) {
      await vscode.commands.executeCommand(selected.actionCommand);
      return;
    }

    const { pkg } = selected;
    if (!pkg) return;
    let targetVersion = pkg.latestVersion || pkg.versions?.[0] || "latest";

    if (pkg.versions && pkg.versions.length > 1) {
      const versionItems: (vscode.QuickPickItem & { version: string })[] = pkg.versions.map((v, idx) =>
        idx === 0 ? { label: v, description: "(latest)", version: v } : { label: v, version: v },
      );
      const pickedVer = await vscode.window.showQuickPick(versionItems, {
        title: `Select Version for ${pkg.name}`,
        placeHolder: `Choose version of ${pkg.name} to add to Libraries`,
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
  const curated = CURATED_LIBRARIES.find((c) => c.name.toLowerCase() === packageName.toLowerCase());
  if (curated?.latestVersion) return curated.latestVersion;
  return requestedVersion || "latest";
}

function extractPackageNameFromArg(arg?: string | { info?: { name?: string; id?: string; description?: string } }): {
  name?: string | undefined;
  currentVersion?: string | undefined;
} {
  if (typeof arg === "string") {
    return { name: arg };
  }
  const name =
    typeof arg?.info?.name === "string"
      ? arg.info.name
      : typeof arg?.info?.id === "string"
        ? arg.info.id.replace(/^__LIB__:/, "")
        : undefined;
  const rawDesc = typeof arg?.info?.description === "string" ? arg.info.description : undefined;
  const currentVersion = rawDesc?.startsWith("v") ? rawDesc.slice(1).split(" ")[0] : undefined;
  return { name, currentVersion };
}

export function registerRegistryView(
  context: vscode.ExtensionContext,
  lspClient?: { sendNotification: (method: string, params: unknown) => void },
): void {
  const openPicker = async () => {
    await showAnsatzPackagePicker();
  };

  // Register unified Libraries '+' button and command palette aliases
  context.subscriptions.push(
    vscode.commands.registerCommand("modelscript.libraryView.addPackage", openPicker),
    vscode.commands.registerCommand("modelscript.registry.search", openPicker),
    vscode.commands.registerCommand("modelscript.openRegistry", openPicker),
  );

  // Install package from Ansatz into Libraries & workspace package.json
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
            title: `Adding ${packageName}@${resolvedVersion} to Libraries...`,
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

  // Switch version command for any mounted library (standard or custom)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "modelscript.libraryView.switchVersion",
      async (arg?: string | { info?: { name?: string; id?: string; description?: string } }) => {
        const { name: extractedName, currentVersion } = extractPackageNameFromArg(arg);
        const packageName =
          extractedName ||
          (
            await vscode.window.showInputBox({
              prompt: "Enter library name to switch version",
            })
          )?.trim();
        if (!packageName) return;

        let versions: string[] = [];
        const baseUrl = getRegistryUrl().replace(/\/+$/, "");
        for (const prefix of ["packages", "libraries"]) {
          try {
            const resp = await fetch(`${baseUrl}/${prefix}/${encodeURIComponent(packageName)}`);
            if (resp.ok) {
              const data = (await resp.json()) as { versions?: string[]; latestVersion?: string };
              if (Array.isArray(data.versions) && data.versions.length > 0) {
                versions = data.versions;
                break;
              } else if (data.latestVersion) {
                versions = [data.latestVersion];
                break;
              }
            }
          } catch {
            // Fall through
          }
        }

        if (versions.length === 0) {
          const curated = CURATED_LIBRARIES.find((c) => c.name.toLowerCase() === packageName.toLowerCase());
          if (curated?.versions) {
            versions = curated.versions;
          } else if (currentVersion) {
            versions = [currentVersion];
          }
        }

        const items: (vscode.QuickPickItem & { version: string })[] = versions.map((v, idx) => ({
          label: `v${v}`,
          description: v === currentVersion ? "(currently mounted)" : idx === 0 ? "(latest)" : "",
          version: v,
        }));

        items.push({
          label: "$(edit) Enter custom version...",
          description: "Type a specific semver tag",
          version: "__CUSTOM__",
        });

        const picked = await vscode.window.showQuickPick(items, {
          title: `Switch Version for ${packageName}`,
          placeHolder: currentVersion
            ? `Currently mounted: v${currentVersion}. Select target version:`
            : `Select version of ${packageName} to mount:`,
        });
        if (!picked) return;

        let targetVersion = picked.version;
        if (targetVersion === "__CUSTOM__") {
          const customInput = await vscode.window.showInputBox({
            prompt: `Enter version for ${packageName}`,
            value: currentVersion || "latest",
          });
          if (!customInput) return;
          targetVersion = customInput.trim();
        }

        if (lspClient) {
          lspClient.sendNotification("modelscript/uninstallDependency", { name: packageName });
        }
        await vscode.commands.executeCommand("modelscript.registry.install", packageName, targetVersion);
      },
    ),
  );

  // Open package details from tree item context menu
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "modelscript.libraryView.openPackageDetails",
      async (arg?: string | { info?: { name?: string; id?: string; description?: string } }) => {
        const { name, currentVersion } = extractPackageNameFromArg(arg);
        if (!name) return;
        await vscode.commands.executeCommand("modelscript.registry.openPackage", name, currentVersion || "latest");
      },
    ),
  );

  // Uninstall / remove package command
  const uninstallHandler = async (arg?: string | { info?: { name?: string; id?: string } }) => {
    let packageName = extractPackageNameFromArg(arg).name;

    if (!packageName) {
      const input = await vscode.window.showInputBox({ prompt: "Library name to remove from workspace" });
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
                modelscript?: { dependencies?: Record<string, string> | undefined } | undefined;
              };
              let modified = false;
              if (packageJsonObj.dependencies) {
                Reflect.deleteProperty(packageJsonObj.dependencies, packageName);
                Reflect.deleteProperty(packageJsonObj.dependencies, `@modelscript/${packageName.toLowerCase()}`);
                modified = true;
              }
              if (packageJsonObj.modelscript?.dependencies) {
                Reflect.deleteProperty(packageJsonObj.modelscript.dependencies, packageName);
                Reflect.deleteProperty(
                  packageJsonObj.modelscript.dependencies,
                  `@modelscript/${packageName.toLowerCase()}`,
                );
                modified = true;
              }
              if (modified) {
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
          vscode.window.showInformationMessage(`Removed ${packageName} from workspace.`);
        } catch (err) {
          vscode.window.showErrorMessage(`Failed to remove library '${packageName}': ${err}`);
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
        let packument: RegistryPackument;
        if (resp.ok) {
          packument = (await resp.json()) as RegistryPackument;
        } else {
          const curated = CURATED_LIBRARIES.find((c) => c.name.toLowerCase() === name.toLowerCase());
          if (!curated) throw new Error(`HTTP ${resp.status}`);
          packument = {
            name: curated.name,
            version: resolvedVersion,
            description: curated.description,
            license: curated.license,
          };
        }
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
          <h1>${escapeHtml(packument.name || name)} <button class="install-btn" onclick="acquireVsCodeApi().postMessage({command: 'install'})">Add to Libraries</button></h1>
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

  // Import library from a local .zip archive
  context.subscriptions.push(
    vscode.commands.registerCommand("modelscript.libraryView.importZip", async () => {
      try {
        const picked = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          filters: { "Library Archive (.zip)": ["zip"] },
          openLabel: "Mount Library (.zip)",
        });
        const uri = picked?.[0];
        if (!uri) return;
        const bytes = await vscode.workspace.fs.readFile(uri);
        const fileName = uri.path.split("/").pop() || "Library.zip";
        const defaultName = fileName.replace(/\.zip$/i, "").split(/[-_ ]/)[0] || "CustomLibrary";
        let binary = "";
        const chunkSize = 8192;
        for (let i = 0; i < bytes.byteLength; i += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }
        const zipBase64 = btoa(binary);
        if (lspClient) {
          lspClient.sendNotification("modelscript/importLibraryZip", {
            name: defaultName,
            version: "1.0.0",
            zipBase64,
          });
          setTimeout(() => {
            void vscode.commands.executeCommand("modelscript.libraryView.refresh");
          }, 500);
        }
        vscode.window.showInformationMessage(`Mounted library archive '${fileName}' into Libraries.`);
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to import .zip library: ${err}`);
      }
    }),
  );

  // Import library from an HTTP/HTTPS URL
  context.subscriptions.push(
    vscode.commands.registerCommand("modelscript.libraryView.importUrl", async (passedUrl?: string) => {
      const url =
        typeof passedUrl === "string" && passedUrl.trim()
          ? passedUrl.trim()
          : (
              await vscode.window.showInputBox({
                title: "Import Library from URL",
                prompt: "Enter the URL of a .zip library archive (e.g., GitHub release or raw archive URL)",
                placeHolder: "https://example.com/MyLibrary-1.0.0.zip",
              })
            )?.trim();
      if (!url) return;

      const fileName = url.split("/").pop()?.split("?")[0] || "Library.zip";
      const defaultName = fileName.replace(/\.zip$/i, "").split(/[-_ ]/)[0] || "CustomLibrary";
      if (lspClient) {
        lspClient.sendNotification("modelscript/importLibraryZip", {
          name: defaultName,
          version: "1.0.0",
          url,
        });
        setTimeout(() => {
          void vscode.commands.executeCommand("modelscript.libraryView.refresh");
        }, 700);
      }
      vscode.window.showInformationMessage(`Importing library from ${url}...`);
    }),
  );
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
