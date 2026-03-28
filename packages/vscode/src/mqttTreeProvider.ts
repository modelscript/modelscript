// SPDX-License-Identifier: AGPL-3.0-or-later
//
// MQTT participant tree provider for the sidebar panel.
// Fetches participant data from the ModelScript API and displays it as a
// draggable tree alongside the Modelica library tree.
// - Double-click on a participant triggers "Add to Diagram"
// - Right-click context menu also offers "Add to Diagram"
// - Icons: SVG data URIs from participant metadata when available, codicon fallback

import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";

interface ParticipantVariable {
  name: string;
  causality: "input" | "output" | "parameter" | "local";
  type: string;
  unit?: string;
  start?: number;
  description?: string;
}

interface ParticipantInfo {
  participantId: string;
  modelName: string;
  type: string;
  classKind: string;
  description?: string;
  variables: ParticipantVariable[];
  iconSvg?: string;
  timestamp: string;
}

function participantTypeToIcon(type: string): vscode.ThemeIcon {
  switch (type) {
    case "js-simulator":
      return new vscode.ThemeIcon("symbol-class");
    case "fmu-js":
      return new vscode.ThemeIcon("package");
    case "fmu-native":
      return new vscode.ThemeIcon("server-process");
    case "external":
      return new vscode.ThemeIcon("radio-tower");
    default:
      return new vscode.ThemeIcon("symbol-misc");
  }
}

function causalityToIcon(causality: string): vscode.ThemeIcon {
  switch (causality) {
    case "input":
      return new vscode.ThemeIcon("arrow-right", new vscode.ThemeColor("charts.blue"));
    case "output":
      return new vscode.ThemeIcon("arrow-left", new vscode.ThemeColor("charts.green"));
    case "parameter":
      return new vscode.ThemeIcon("settings-gear", new vscode.ThemeColor("charts.purple"));
    default:
      return new vscode.ThemeIcon("circle-outline");
  }
}

function svgToIconUri(svg: string): vscode.Uri {
  const encoded = encodeURIComponent(svg);
  return vscode.Uri.parse(`data:image/svg+xml;utf8,${encoded}`);
}

type MqttTreeItem = MqttParticipantItem | MqttVariableItem;

export class MqttParticipantItem extends vscode.TreeItem {
  constructor(public readonly info: ParticipantInfo) {
    super(info.modelName, vscode.TreeItemCollapsibleState.Collapsed);
    this.tooltip = `${info.modelName} (${info.type})\n${info.description ?? ""}`;
    this.description = info.type;
    this.contextValue = "mqttParticipant";

    if (info.iconSvg) {
      const iconUri = svgToIconUri(info.iconSvg);
      this.iconPath = { light: iconUri, dark: iconUri };
    } else {
      this.iconPath = participantTypeToIcon(info.type);
    }

    // Double-click triggers addToDiagram
    this.command = {
      command: "modelscript.addToDiagram",
      title: "Add to Diagram",
      arguments: [`mqtt://${info.participantId}`, info.classKind, info.iconSvg],
    };
  }
}

export class MqttVariableItem extends vscode.TreeItem {
  constructor(
    public readonly variable: ParticipantVariable,
    public readonly participantId: string,
  ) {
    super(variable.name, vscode.TreeItemCollapsibleState.None);

    const unitStr = variable.unit ? ` [${variable.unit}]` : "";
    const startStr = variable.start !== undefined ? ` = ${variable.start}` : "";
    this.description = `${variable.causality}${unitStr}${startStr}`;
    this.tooltip = variable.description ?? `${variable.name}: ${variable.type}${unitStr}`;
    this.contextValue = `mqttVariable.${variable.causality}`;
    this.iconPath = causalityToIcon(variable.causality);
  }
}

export class MqttTreeProvider
  implements vscode.TreeDataProvider<MqttTreeItem>, vscode.TreeDragAndDropController<MqttTreeItem>
{
  public readonly dragMimeTypes = ["application/json", "text/plain"];
  public readonly dropMimeTypes: string[] = [];
  private _onDidChangeTreeData = new vscode.EventEmitter<MqttTreeItem | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private participants: ParticipantInfo[] = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private apiUrl: string | null = null;

  constructor(
    private readonly client: LanguageClient,
    private readonly pollIntervalMs = 5000,
  ) {
    // Read API URL from settings
    this.apiUrl = vscode.workspace.getConfiguration("modelscript.cosim").get<string>("apiUrl") ?? null;
  }

  /** Update the API URL for direct REST fetching. */
  setApiUrl(url: string | null): void {
    this.apiUrl = url;
  }

  /** Start polling for participants. */
  startPolling(): void {
    void this.fetchParticipants();
    this.pollTimer = setInterval(() => void this.fetchParticipants(), this.pollIntervalMs);
  }

  /** Stop polling. */
  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** Manually refresh the tree. */
  refresh(): void {
    void this.fetchParticipants();
  }

  private async fetchParticipants(): Promise<void> {
    // Try API-based fetching first (if configured)
    if (this.apiUrl) {
      try {
        const resp = await fetch(`${this.apiUrl}/api/v1/mqtt/participants`);
        if (resp.ok) {
          const data = (await resp.json()) as { participants: ParticipantInfo[] };
          this.participants = data.participants;
          this._onDidChangeTreeData.fire(undefined);
          return;
        }
      } catch {
        // Fall through to LSP
      }
    }

    // Fall back to LSP server
    try {
      const data: { participants: ParticipantInfo[] } = await this.client.sendRequest(
        "modelscript/getMqttParticipants",
      );
      this.participants = data.participants;
    } catch {
      // LSP might not support this yet — that's fine
      this.participants = [];
    }
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: MqttTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: MqttTreeItem): Promise<MqttTreeItem[]> {
    if (!element) {
      // Root: return all participants
      return this.participants.map((p) => new MqttParticipantItem(p));
    }

    if (element instanceof MqttParticipantItem) {
      // Children: return variables
      return element.info.variables.map((v) => new MqttVariableItem(v, element.info.participantId));
    }

    return [];
  }

  public async handleDrag(
    source: readonly MqttTreeItem[],
    dataTransfer: vscode.DataTransfer,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const item = source[0];
    if (!item || !(item instanceof MqttParticipantItem)) return;

    const dragData = {
      className: `mqtt://${item.info.participantId}`,
      classKind: item.info.classKind,
      iconSvg: item.info.iconSvg,
      mqttParticipant: true,
      participantId: item.info.participantId,
      variables: item.info.variables,
    };

    const payload = JSON.stringify(dragData);
    dataTransfer.set("application/json", new vscode.DataTransferItem(payload));
    dataTransfer.set("text/plain", new vscode.DataTransferItem(payload));
  }
}
