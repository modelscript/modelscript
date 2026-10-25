// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import type { CosimViewProvider } from "../cosim-panel.js";
import type { MqttTreeProvider } from "../mqtt-tree-provider.js";
import { SimulationPanel } from "../simulation-panel.js";

export function registerCosimCommands(
  context: vscode.ExtensionContext,
  cosimProvider: CosimViewProvider,
  mqttTreeProvider?: MqttTreeProvider,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("modelscript.cosimConnect", () => {
      cosimProvider.refresh();
      mqttTreeProvider?.refresh();
      vscode.window.showInformationMessage("Refreshing co-simulation connections…");
    }),
    vscode.commands.registerCommand("modelscript.cosimDisconnect", () => {
      cosimProvider.refresh();
      vscode.window.showInformationMessage("Co-simulation session disconnected.");
    }),
    vscode.commands.registerCommand("modelscript.cosimStartInfra", async () => {
      const cmd = "docker compose up -d mqtt timescaledb api";
      if (typeof vscode.window.createTerminal === "function") {
        const choice = await vscode.window.showInformationMessage(
          `Start Co-Simulation infrastructure services (${cmd})?`,
          "Run in Terminal",
          "Copy Command",
        );
        if (choice === "Run in Terminal") {
          const terminal = vscode.window.createTerminal({ name: "ModelScript Co-Simulation Infra" });
          terminal.show();
          terminal.sendText(cmd);
          return;
        } else if (choice === "Copy Command") {
          await vscode.env.clipboard.writeText(cmd);
          vscode.window.showInformationMessage(`Copied to clipboard: ${cmd}`);
          return;
        }
      } else {
        await vscode.env.clipboard.writeText(cmd);
        vscode.window.showInformationMessage(
          `Local Docker orchestration requires a host terminal. Command copied to clipboard: ${cmd}`,
        );
      }
    }),
    vscode.commands.registerCommand("modelscript.cosimCreateSession", () => {
      vscode.commands.executeCommand("workbench.view.extension.modelscript-cosim");
    }),
    vscode.commands.registerCommand("modelscript.cosimPublishModel", async () => {
      const activeEditor = vscode.window.activeTextEditor;
      await vscode.commands.executeCommand("workbench.view.extension.modelscript-cosim");
      if (activeEditor) {
        vscode.window.showInformationMessage(
          `Model '${activeEditor.document.uri.path.split("/").pop()}' selected for Co-Simulation publishing.`,
        );
      } else {
        vscode.window.showInformationMessage(
          "Co-Simulation view opened. Select a model to publish to the active session.",
        );
      }
    }),
    vscode.commands.registerCommand("modelscript.cosimOpenLivePlot", (sessionId?: string, participantId?: string) => {
      if (cosimProvider.isLocalMode) {
        SimulationPanel.createOrShowLiveLocal(context.extensionUri, sessionId);
      } else {
        SimulationPanel.createOrShowLive(context.extensionUri, sessionId, participantId);
      }
    }),
    vscode.commands.registerCommand("modelscript.cosimRefresh", () => {
      cosimProvider.refresh();
      mqttTreeProvider?.refresh();
    }),
  ];
}
