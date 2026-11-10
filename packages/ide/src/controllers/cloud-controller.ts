// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser";
import { CloudJobPanel } from "../cloud-job-panel.js";
import type { ExperimentsTreeProvider } from "../experiments-tree.js";
import { isFeatureEnabled } from "../utils/config.js";

export function registerCloudCommands(
  context: vscode.ExtensionContext,
  client?: LanguageClient,
  experimentsTreeProvider?: ExperimentsTreeProvider,
): vscode.Disposable[] {
  CloudJobPanel.setSecretStorage(context.secrets);
  return [
    vscode.commands.registerCommand("modelscript.openCloudPanel", (uri?: string) => {
      if (!isFeatureEnabled("cloudCompute")) {
        vscode.window.showInformationMessage(
          "ModelScript Cloud HPC features are currently disabled. Set 'modelscript.features.cloudCompute': true in settings to enable.",
        );
        return;
      }
      CloudJobPanel.createOrShow(context.extensionUri, client, uri);
    }),
    vscode.commands.registerCommand("modelscript.runOnCloud", (uri?: string) => {
      if (!isFeatureEnabled("cloudCompute")) {
        vscode.window.showInformationMessage(
          "ModelScript Cloud HPC features are currently disabled. Set 'modelscript.features.cloudCompute': true in settings to enable.",
        );
        return;
      }
      CloudJobPanel.createOrShow(context.extensionUri, client, uri);
    }),
    vscode.commands.registerCommand("modelscript.openCloudMenu", async () => {
      if (!isFeatureEnabled("cloudCompute")) {
        vscode.window.showInformationMessage(
          "ModelScript Cloud HPC features are currently disabled. Set 'modelscript.features.cloudCompute': true in settings to enable.",
        );
        return;
      }
      const items = [
        { label: "$(rocket) Run Active Model on Cloud...", id: "dispatch" },
        { label: "$(server-process) View Cloud Compute Profiles", id: "profiles" },
        { label: "$(credit-card) Check Credit Wallet Balance", id: "balance" },
        { label: "$(history) View Cloud Jobs", id: "jobs" },
      ];
      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: "Select a ModelScript Cloud action",
      });
      if (!selected) return;
      CloudJobPanel.createOrShow(context.extensionUri, client);
    }),
    vscode.commands.registerCommand("modelscript.refreshExperiments", () => {
      experimentsTreeProvider?.refresh();
    }),
  ];
}
