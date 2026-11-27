// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import type { HostBridgeService } from "../services/host-bridge-service.js";

const VALID_PACKAGE_NAME_RE = /^(?:@[a-zA-Z0-9._-]+\/)?[a-zA-Z0-9._-]+$/;
const VALID_PACKAGE_VERSION_RE = /^[a-zA-Z0-9.+_-]+$/;

export function isValidPackageInstallSpec(pkg: string, version: string): boolean {
  return (
    VALID_PACKAGE_NAME_RE.test(pkg) &&
    !pkg.includes("..") &&
    VALID_PACKAGE_VERSION_RE.test(version) &&
    !version.includes("..")
  );
}

export function registerAlmAndUriCommands(
  hostBridgeService: Pick<HostBridgeService, "publishSimulationResult">,
  memfsRootUri: vscode.Uri | undefined,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(
      "modelscript.publishSimulationResult",
      (options: {
        fileName: string;
        title: string;
        vtuXml: string;
        summaryMarkdown?: string;
        sourceUri?: vscode.Uri;
      }) => hostBridgeService.publishSimulationResult(options),
    ),

    vscode.commands.registerCommand("modelscript.alm.openExternal", async (webUrl?: string, itemId?: string) => {
      if (!webUrl || !/^https?:\/\//i.test(webUrl)) {
        vscode.window.showWarningMessage(`No valid external ALM URL available for '${itemId ?? "item"}'.`);
        return;
      }
      await vscode.env.openExternal(vscode.Uri.parse(webUrl));
    }),

    vscode.commands.registerCommand("modelscript.alm.syncPull", async (_docUri?: string, itemId?: string) => {
      const apiBase = vscode.workspace.getConfiguration("modelscript").get<string>("apiUrl", "").replace(/\/+$/, "");
      const sourceUri = await vscode.window.showInputBox({
        prompt: `Enter protocol-prefixed ALM remote URI to sync${itemId ? ` (for ${itemId})` : ""}`,
        placeHolder: "oslc+https://elm.corp.com/rm/modules/MOD-42",
      });
      if (!sourceUri) return;
      const token = await vscode.window.showInputBox({
        prompt: "Enter ALM API Token / PAT (leave blank if using proxy session auth)",
        password: true,
      });

      const endpoint = `${apiBase}/api/v1/alm/pull`;
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { "x-alm-token": token } : {}),
          },
          body: JSON.stringify({ spec: sourceUri }),
        });
        if (!res.ok) {
          const errText = await res.text();
          vscode.window.showErrorMessage(`ALM sync failed (${res.status}): ${errText.slice(0, 200)}`);
          return;
        }
        const data = (await res.json()) as {
          files?: Array<{ filename: string; content: string }>;
          snapshotVersion?: string;
        };
        const rootUri = memfsRootUri ?? vscode.workspace.workspaceFolders?.[0]?.uri;
        if (!rootUri) {
          vscode.window.showErrorMessage("No workspace folder open to write synced ALM files.");
          return;
        }
        const files = data.files ?? [];
        const encoder = new TextEncoder();
        for (const f of files) {
          const destUri = vscode.Uri.joinPath(rootUri, ".modelscript", "packages", "alm-sync", f.filename);
          await vscode.workspace.fs.writeFile(destUri, encoder.encode(f.content));
        }
        vscode.window.showInformationMessage(
          `Synced ${files.length} ALM projection file(s) (${data.snapshotVersion ?? "latest"}).`,
        );
      } catch (err) {
        vscode.window.showErrorMessage(`ALM sync error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),

    // Register URI handler for vscode://modelscript.modelscript/install?package=xyz
    vscode.window.registerUriHandler({
      async handleUri(uri: vscode.Uri) {
        if (uri.path === "/install" || uri.path === "install") {
          if (!vscode.workspace.isTrusted) {
            vscode.window.showErrorMessage("Cannot install packages via URI in an untrusted workspace.");
            return;
          }
          const query = new URLSearchParams(uri.query);
          const pkg = query.get("package")?.trim();
          const version = (query.get("version") || "latest").trim();
          if (!pkg) return;

          if (!isValidPackageInstallSpec(pkg, version)) {
            vscode.window.showErrorMessage(`Blocked invalid package install URI request: '${pkg}@${version}'.`);
            return;
          }

          const choice = await vscode.window.showWarningMessage(
            `Install ModelScript package '${pkg}@${version}' from external link?`,
            { modal: true },
            "Install",
          );
          if (choice === "Install") {
            await vscode.commands.executeCommand("modelscript.registry.install", pkg, version);
          }
        }
      },
    }),
  ];
}
