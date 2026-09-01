// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Tree view provider for discovering Modelica experiments across the workspace.
// Queries the LSP for classes annotated with experiment() and displays them in a hierarchy.

import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";

interface ExperimentInfo {
  /** Fully qualified class name. */
  name: string;
  /** Source file URI. */
  uri: string;
  /** "simulation" or "calibration". */
  type: "simulation" | "calibration";
  /** Experiment annotation fields. */
  startTime?: number;
  stopTime?: number;
  interval?: number;
  tolerance?: number;
}

class ExperimentItem extends vscode.TreeItem {
  constructor(
    public readonly info: ExperimentInfo,
    public readonly children: ExperimentItem[] = [],
  ) {
    super(
      info.name.split(".").pop() ?? info.name,
      children.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
    );

    this.tooltip = info.name;
    this.description = info.type === "calibration" ? "calibration" : undefined;
    this.iconPath = new vscode.ThemeIcon(info.type === "calibration" ? "beaker" : "play-circle");

    this.command = {
      title: info.type === "calibration" ? "Open Calibration" : "Run Simulation",
      command: info.type === "calibration" ? "modelscript.openCalibration" : "modelscript.runSimulation",
      arguments: [info.uri],
    };

    this.contextValue = info.type;
  }
}

export class ExperimentsTreeProvider implements vscode.TreeDataProvider<ExperimentItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ExperimentItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private experiments: ExperimentInfo[] = [];

  constructor(private readonly client: LanguageClient) {}

  refresh(): void {
    this.fetchExperiments().then(
      () => this._onDidChangeTreeData.fire(undefined),
      () => {
        /* ignore fetch errors */
      },
    );
  }

  getTreeItem(element: ExperimentItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ExperimentItem): ExperimentItem[] {
    if (element) return element.children;

    // Build hierarchical tree from flat experiment list
    const roots: ExperimentItem[] = [];
    const packageMap = new Map<string, ExperimentItem[]>();

    for (const exp of this.experiments) {
      const parts = exp.name.split(".");
      if (parts.length > 1) {
        const pkg = parts.slice(0, -1).join(".");
        if (!packageMap.has(pkg)) {
          packageMap.set(pkg, []);
        }
        const items = packageMap.get(pkg);
        if (items) {
          items.push(new ExperimentItem(exp));
        }
      } else {
        roots.push(new ExperimentItem(exp));
      }
    }

    // Create package group nodes
    for (const [pkgName, children] of packageMap) {
      const groupInfo: ExperimentInfo = {
        name: pkgName,
        uri: children[0]?.info.uri ?? "",
        type: "simulation",
      };
      roots.push(new ExperimentItem(groupInfo, children));
    }

    return roots;
  }

  private async fetchExperiments(): Promise<void> {
    try {
      const result = await this.client.sendRequest<{ experiments: ExperimentInfo[] }>("modelscript/getExperiments");
      this.experiments = result.experiments;
    } catch {
      this.experiments = [];
    }
  }
}
