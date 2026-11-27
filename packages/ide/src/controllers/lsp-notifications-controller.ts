// SPDX-License-Identifier: AGPL-3.0-or-later

import { StoppedEvent } from "@vscode/debugadapter";
import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser";
import { activeDebugSession } from "../debug-adapter.js";
import { registerScmIntegration } from "../scm-integration.js";
import { registerSemanticDiffComments } from "../semantic-diff-comments.js";
import { registerAutoFoldService } from "../services/auto-fold-service.js";
import type { VerificationStatusPayload } from "../services/verification-status-decorator.js";

export interface LspNotificationHost {
  readonly client?: LanguageClient | undefined;
  onBindNotifications(cb: (client: LanguageClient) => void): void;
}

export interface NotificationTreeHost {
  readonly libraryTreeProvider: { refresh(): void };
  readonly experimentsTreeProvider?: { refresh(): void } | undefined;
}

export interface NotificationMarkdownHost {
  refreshMarkdownData(): void;
}

export async function registerLspNotificationHandlers(
  context: vscode.ExtensionContext,
  lspManager: LspNotificationHost,
  treeController: NotificationTreeHost,
  markdownService: NotificationMarkdownHost,
): Promise<vscode.Disposable[]> {
  const [{ VerificationStatusDecorator }, { VerificationGatesTreeProvider }] = await Promise.all([
    import("../services/verification-status-decorator.js"),
    import("../verification-gates-tree-provider.js"),
  ]);

  const verificationStatusDecorator = new VerificationStatusDecorator();
  const verificationGatesTreeProvider = new VerificationGatesTreeProvider();

  const simProgressStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  let simProgressHideTimer: ReturnType<typeof setTimeout> | undefined;
  let markdownRefreshTimer: ReturnType<typeof setTimeout> | undefined;

  let isScmRegistered = false;
  lspManager.onBindNotifications((targetClient) => {
    targetClient.onNotification(
      "modelscript/debuggerStopped",
      (params: { uri?: string | undefined; line?: number | undefined; column?: number | undefined }) => {
        if (activeDebugSession) {
          activeDebugSession.lastStoppedUri = params.uri;
          activeDebugSession.lastStoppedLine = params.line;
          activeDebugSession.lastStoppedColumn = params.column;
          activeDebugSession.sendEvent(new StoppedEvent("step", 1));
        }
      },
    );

    targetClient.onNotification("modelscript/status", (params: { state: string; message: string }) => {
      if (params.state === "ready") {
        treeController.libraryTreeProvider.refresh();
        treeController.experimentsTreeProvider?.refresh();

        if (!isScmRegistered && lspManager.client) {
          isScmRegistered = true;
          registerScmIntegration(context, lspManager.client);
          registerSemanticDiffComments(context, lspManager.client);
          registerAutoFoldService(context, lspManager.client);
        }

        if (markdownRefreshTimer !== undefined) {
          clearTimeout(markdownRefreshTimer);
        }
        markdownRefreshTimer = setTimeout(() => {
          markdownRefreshTimer = undefined;
          markdownService.refreshMarkdownData();
        }, 3000);
      }
    });

    targetClient.onNotification("modelscript/warning", (params: { message: string }) => {
      vscode.window.showWarningMessage(params.message);
    });

    targetClient.onNotification(
      "modelscript/simulationProgress",
      (params: {
        uri?: string | undefined;
        timeSec?: number | undefined;
        stepIndex?: number | undefined;
        voltages?: Record<string, number> | undefined;
      }) => {
        const timeText = typeof params.timeSec === "number" ? `t=${params.timeSec.toFixed(4)}s` : "";
        const stepText = typeof params.stepIndex === "number" ? `step ${params.stepIndex}` : "";
        const detail = [timeText, stepText].filter(Boolean).join(" · ");
        simProgressStatusBar.text = detail ? `$(sync~spin) Simulating (${detail})` : "$(sync~spin) Simulating...";
        simProgressStatusBar.tooltip = params.uri ? `Simulation progress for ${params.uri}` : "Simulation progress";
        simProgressStatusBar.show();
        if (simProgressHideTimer !== undefined) {
          clearTimeout(simProgressHideTimer);
        }
        simProgressHideTimer = setTimeout(() => {
          simProgressStatusBar.hide();
          simProgressHideTimer = undefined;
        }, 5000);
      },
    );

    targetClient.onNotification("modelscript/verificationStatus", (payload: VerificationStatusPayload) => {
      verificationStatusDecorator.updateStatus(payload);
      verificationGatesTreeProvider.updateVerificationStatus(payload);
    });

    targetClient.onNotification(
      "modelscript/cosimStream",
      async (msg: {
        type: string;
        participantId: string;
        time: number;
        data?: number[] | undefined;
        payload?: unknown;
      }) => {
        const { CadViewerPanel } = await import("../cad-viewer-panel.js");
        if (CadViewerPanel.currentPanel) {
          if (msg.type === "vtk") {
            CadViewerPanel.currentPanel.postMessage({
              type: "VTK_PAYLOAD",
              data: {
                pid: msg.participantId,
                time: msg.time,
                buffer: new Uint8Array(msg.data || []),
              },
            });
          } else if (msg.type === "fea-frame" || msg.type === "fea") {
            CadViewerPanel.currentPanel.sendFeaPayload(msg.payload || msg);
          } else {
            CadViewerPanel.currentPanel.postMessage(msg);
          }
        }
      },
    );
  });

  return [
    verificationStatusDecorator,
    verificationGatesTreeProvider,
    vscode.window.registerTreeDataProvider("modelscript.verificationGatesView", verificationGatesTreeProvider),
    simProgressStatusBar,
    new vscode.Disposable(() => {
      if (simProgressHideTimer !== undefined) {
        clearTimeout(simProgressHideTimer);
        simProgressHideTimer = undefined;
      }
      if (markdownRefreshTimer !== undefined) {
        clearTimeout(markdownRefreshTimer);
        markdownRefreshTimer = undefined;
      }
    }),
  ];
}
