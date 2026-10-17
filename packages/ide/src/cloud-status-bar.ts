// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";

export class CloudStatusBar implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private timer: any = null;
  private apiBaseUrl: string;
  private authToken: string | undefined;

  constructor(apiBaseUrl = "http://localhost:3000/api/v1", authToken?: string) {
    this.apiBaseUrl = apiBaseUrl.replace(/\/+$/, "");
    this.authToken = authToken;
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
    this.statusBarItem.command = "modelscript.openCloudMenu";
    this.statusBarItem.tooltip = "ModelScript Cloud HPC Orchestration — Click for profiles & balance";
    this.updateStatus(null);
    this.statusBarItem.show();

    this.refreshBalance();
    this.timer = setInterval(() => this.refreshBalance(), 30000);
  }

  private getConfig(): { baseUrl: string; headers: Record<string, string> } {
    const cfg = vscode.workspace.getConfiguration("modelscript.cloud");
    const baseUrl = (cfg.get<string>("apiBaseUrl") || this.apiBaseUrl).replace(/\/+$/, "");
    const token = cfg.get<string>("authToken") || this.authToken;
    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    return { baseUrl, headers };
  }

  public updateStatus(balance: number | null, activeJobs = 0): void {
    if (balance === null) {
      this.statusBarItem.text = `$(cloud) Cloud: Ready`;
    } else {
      const jobBadge = activeJobs > 0 ? ` (${activeJobs} running)` : "";
      this.statusBarItem.text = `$(cloud) ${balance.toFixed(0)} Credits${jobBadge}`;
    }
  }

  public async refreshBalance(): Promise<void> {
    try {
      const { baseUrl, headers } = this.getConfig();
      const res = await fetch(`${baseUrl}/cloud/balance`, { headers });
      if (res.ok) {
        const data = (await res.json()) as { balance: number };
        const jobsRes = await fetch(`${baseUrl}/cloud/jobs`, { headers });
        let activeCount = 0;
        if (jobsRes.ok) {
          const jobsData = (await jobsRes.json()) as { jobs: { status: string }[] };
          activeCount = jobsData.jobs.filter((j) => j.status === "running" || j.status === "queued").length;
        }
        this.updateStatus(data.balance, activeCount);
      } else {
        this.updateStatus(null);
      }
    } catch {
      this.updateStatus(null);
    }
  }

  public dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.statusBarItem.dispose();
  }
}
