// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import {
  escapeHtml,
  fetchAnsatzRegistryComponents,
  notifyActivePackageHubInstalledChanged,
  openAnsatzPackageHub,
  recordActiveModelUri,
  renderPackageHubHtml,
  sanitizeHubSvg,
} from "./package-hub-webview.js";
import {
  type AnsatzPackageSummary,
  type AnsatzStreamComponentsParams,
  type AnsatzStreamComponentsResult,
  type AnsatzStreamedComponentItem,
  CURATED_LIBRARIES,
  ensureParentLibraryInstalled,
  extractPackageNameFromArg,
  getEffectiveInstalledDependencies,
  getWorkspaceDependencies,
  importLibraryFromUrl,
  importLibraryFromZip,
  installRegistryPackage,
  type LspClientLike,
  registerSessionRegistryDependencies,
  type RegistryPackument,
  searchAnsatzPackages,
  switchLibraryVersion,
  toggleStandardPackProfile,
  uninstallRegistryPackage,
} from "./package-installer-service.js";
import { getRegistryUrl } from "./utils/config.js";

export {
  CURATED_LIBRARIES,
  ensureParentLibraryInstalled,
  escapeHtml,
  fetchAnsatzRegistryComponents,
  getEffectiveInstalledDependencies,
  getWorkspaceDependencies,
  openAnsatzPackageHub,
  registerSessionRegistryDependencies,
  renderPackageHubHtml,
  sanitizeHubSvg,
  searchAnsatzPackages,
  type AnsatzPackageSummary,
  type AnsatzStreamComponentsParams,
  type AnsatzStreamComponentsResult,
  type AnsatzStreamedComponentItem,
  type LspClientLike,
  type RegistryPackument,
};

interface PackageQuickPickItem extends vscode.QuickPickItem {
  pkg?: AnsatzPackageSummary | undefined;
  actionCommand?: string | undefined;
}

const PINNED_QUICK_ACTIONS: PackageQuickPickItem[] = [
  {
    label: "$(circuit-board) Open Model Gallery...",
    description: "Visual schematic diagrams",
    detail: "Browse and open runnable models with schematic diagrams from examples, Ansatz libraries, or files",
    alwaysShow: true,
    actionCommand: "modelscript.openModelGallery",
  },
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
    "Search Ansatz packages by name, domain, or keyword (e.g., Modelica, SysML, Buildings, PlanarMechanics)...";
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

export function registerRegistryView(context: vscode.ExtensionContext, lspClient?: LspClientLike): void {
  recordActiveModelUri(vscode.window.activeTextEditor?.document?.uri?.toString());
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      recordActiveModelUri(editor?.document?.uri?.toString());
    }),
  );

  const openPicker = async () => {
    await showAnsatzPackagePicker();
  };

  const openHub = (initialPackageName?: string) => {
    openAnsatzPackageHub(context, lspClient, initialPackageName);
  };

  const notifyHub = () => notifyActivePackageHubInstalledChanged(lspClient);

  // Register unified Libraries '+' button to open visual Component & Library Hub directly
  context.subscriptions.push(
    vscode.commands.registerCommand("modelscript.libraryView.addPackage", () => openHub()),
    vscode.commands.registerCommand("modelscript.openPackageHub", (pkg?: string) => openHub(pkg)),
    vscode.commands.registerCommand("modelscript.openRegistry", () => openHub()),
    vscode.commands.registerCommand("modelscript.registry.search", openPicker),
    vscode.commands.registerCommand("modelscript.registry.quickPick", openPicker),
  );

  // Install package from Ansatz into Libraries & workspace package.json
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "modelscript.registry.install",
      async (packageName?: string, packageVersion = "latest"): Promise<boolean> => {
        if (!packageName || typeof packageName !== "string") {
          await showAnsatzPackagePicker();
          return false;
        }
        return installRegistryPackage(packageName, packageVersion, lspClient, notifyHub);
      },
    ),
  );

  // Switch version command for any mounted library (standard or custom)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "modelscript.libraryView.switchVersion",
      async (arg?: string | { info?: { name?: string; id?: string; description?: string } }) => {
        await switchLibraryVersion(arg, lspClient);
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
    await uninstallRegistryPackage(arg, lspClient, notifyHub);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("modelscript.registry.uninstall", uninstallHandler),
    vscode.commands.registerCommand("modelscript.libraryView.removePackage", uninstallHandler),
  );

  // Open package details / README in Ansatz Package Hub & standard pack toggle
  context.subscriptions.push(
    vscode.commands.registerCommand("modelscript.registry.openPackage", async (name: string, _version?: string) => {
      openAnsatzPackageHub(context, lspClient, name);
    }),
    vscode.commands.registerCommand(
      "modelscript.libraryView.toggleStandardProfile",
      async (arg?: string | { info?: { name?: string; id?: string; description?: string } }) => {
        await toggleStandardPackProfile(arg, lspClient);
      },
    ),
  );

  // Import library from a local .zip archive
  context.subscriptions.push(
    vscode.commands.registerCommand("modelscript.libraryView.importZip", async () => {
      await importLibraryFromZip(lspClient, notifyHub);
    }),
  );

  // Import library from an HTTP/HTTPS URL
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "modelscript.libraryView.importUrl",
      async (passedUrl?: string, skipModalConfirm = false) => {
        await importLibraryFromUrl(lspClient, passedUrl, skipModalConfirm, notifyHub);
      },
    ),
  );
}
