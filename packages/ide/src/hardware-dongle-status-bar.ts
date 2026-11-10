// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Hardware Security Dongle Status Bar & QuickPick Controller for ModelScript Web IDE.
 *
 * Displays physical USB dongle status (Wibu CodeMeter, Thales Sentinel HASP)
 * and allows one-click WebUSB/WebHID device pairing and workstation daemon scanning.
 */

import { BrowserDongleManager, type DrmDongleInfo } from "@modelscript/exchange";
import * as vscode from "vscode";

export class HardwareDongleStatusBar implements vscode.Disposable {
  private readonly statusBarItem: vscode.StatusBarItem;
  private readonly dongleManager: BrowserDongleManager;
  private timer: ReturnType<typeof setInterval> | null = null;
  private disposables: vscode.Disposable[] = [];

  constructor(dongleManager?: BrowserDongleManager) {
    this.dongleManager = dongleManager ?? new BrowserDongleManager();
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 85);
    this.statusBarItem.command = "modelscript.openDongleMenu";
    this.statusBarItem.tooltip = "Hardware Security Dongle — Click to manage physical USB keys & licenses";
    this.updateStatus([]);

    this.statusBarItem.show();
    this.refreshDongles();

    // Poll for hardware/daemon connectivity changes every 15 seconds
    this.timer = setInterval(() => this.refreshDongles(), 15000);

    // Register quick pick menu command
    this.disposables.push(
      vscode.commands.registerCommand("modelscript.openDongleMenu", () => this.showDongleQuickPick()),
      vscode.commands.registerCommand("modelscript.dongle.connectWebUsb", () => this.pairHardwareDongle()),
      vscode.commands.registerCommand("modelscript.dongle.scanDaemons", () => this.refreshDongles(true)),
    );
  }

  public getDongleManager(): BrowserDongleManager {
    return this.dongleManager;
  }

  public updateStatus(dongles: DrmDongleInfo[]): void {
    const activeSessions = this.dongleManager.getActiveSessions();

    if (dongles.length === 0) {
      this.statusBarItem.text = `$(plug) Dongle: None`;
      this.statusBarItem.tooltip =
        "Hardware Security: No physical dongle detected.\nClick to pair USB key via WebUSB or probe workstation service.";
      return;
    }

    const first = dongles[0]!;
    const typeLabel = first.type === "codemeter" ? "CodeMeter" : "Sentinel";
    const sessionBadge = activeSessions.length > 0 ? ` (${activeSessions.length} active)` : "";

    this.statusBarItem.text = `$(key) ${typeLabel}${sessionBadge}`;

    const md = new vscode.MarkdownString();
    md.appendMarkdown(`### Hardware Security Dongle Connected\n\n`);
    for (const d of dongles) {
      md.appendMarkdown(`- **Device:** ${d.name}\n`);
      md.appendMarkdown(`  - **Transport:** \`${d.transport}\`\n`);
      if (d.firmCode) md.appendMarkdown(`  - **Firm Code:** \`${d.firmCode}\`\n`);
      md.appendMarkdown(`  - **Product Codes:** ${d.productCodes.join(", ") || "None"}\n`);
      if (d.serialNumber) md.appendMarkdown(`  - **Serial:** \`${d.serialNumber}\`\n`);
    }
    if (activeSessions.length > 0) {
      md.appendMarkdown(`\n**Active License Leases:** ${activeSessions.length}\n`);
    }
    this.statusBarItem.tooltip = md;
  }

  public async refreshDongles(notify = false): Promise<void> {
    try {
      const dongles = await this.dongleManager.scanAllDongles();
      this.updateStatus(dongles);
      if (notify) {
        if (dongles.length > 0) {
          vscode.window.showInformationMessage(
            `ModelScript Hardware Security: ${dongles.length} dongle(s) detected (${dongles.map((d) => d.name).join(", ")}).`,
          );
        } else {
          vscode.window.showWarningMessage(
            "ModelScript Hardware Security: No physical USB dongles or local daemons found on 127.0.0.1.",
          );
        }
      }
    } catch {
      this.updateStatus([]);
    }
  }

  public async pairHardwareDongle(): Promise<void> {
    try {
      const dongle = await this.dongleManager.requestHardwarePairing();
      if (dongle) {
        vscode.window.showInformationMessage(
          `Successfully paired physical USB security dongle: ${dongle.name} (${dongle.type.toUpperCase()}).`,
        );
        this.updateStatus(this.dongleManager.getConnectedDongles());
      } else {
        vscode.window.showInformationMessage(
          "Hardware dongle pairing cancelled or unsupported in this browser environment.",
        );
      }
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to pair physical USB dongle: ${(err as Error).message}`);
    }
  }

  public async showDongleQuickPick(): Promise<void> {
    const dongles = this.dongleManager.getConnectedDongles();
    const sessions = this.dongleManager.getActiveSessions();

    const items: vscode.QuickPickItem[] = [
      {
        label: "$(plug) Pair Physical USB Dongle (WebUSB / WebHID)",
        description: "Connect physical CodeMeter CmStick or Sentinel HASP HL key via browser USB permissions",
      },
      {
        label: "$(sync) Scan Workstation Daemons",
        description: "Probe local CodeMeter (127.0.0.1:22350) and Sentinel LDK (127.0.0.1:1947) services",
      },
      {
        label: "$(info) View Active Hardware Licenses & Diagnostics",
        description: `${dongles.length} dongle(s) connected, ${sessions.length} active license lease(s)`,
      },
    ];

    const pick = await vscode.window.showQuickPick(items, {
      title: "ModelScript Hardware Security & Dongle Management",
      placeHolder: "Select a dongle action or inspect license status",
    });

    if (!pick) return;

    if (pick.label.includes("Pair Physical USB")) {
      await this.pairHardwareDongle();
    } else if (pick.label.includes("Scan Workstation")) {
      await this.refreshDongles(true);
    } else if (pick.label.includes("View Active")) {
      const details = dongles.map((d) => `• ${d.name} [${d.transport}] (Firm: ${d.firmCode ?? "N/A"})`).join("\n");
      const msg =
        dongles.length > 0
          ? `Connected Hardware Security Keys:\n${details}\n\nActive OEM License Sessions: ${sessions.length}`
          : "No hardware security dongles currently connected.";
      vscode.window.showInformationMessage(msg);
    }
  }

  public dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.statusBarItem.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
