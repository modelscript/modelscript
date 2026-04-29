// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Library tree provider for the sidebar panel.
// Communicates with the LSP server to get tree data and icons.
// - Double-click on a leaf item (model, block, connector) triggers "Add to Diagram"
// - Right-click context menu also offers "Add to Diagram"
// - Icons: SVG data URIs from the LSP when available, codicon fallback otherwise
// - Icons are loaded LAZILY after tree items are displayed, to keep expansion instant

import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";

interface TreeNodeInfo {
  id: string;
  name: string;
  compositeName: string;
  classKind: string;
  hasChildren: boolean;
  iconSvg?: string;
  language?: string;
}

// Map classKind to codicon (fallback when no SVG icon is available)
function classKindToIcon(kind: string): vscode.ThemeIcon {
  switch (kind) {
    // Modelica
    case "model":
      return new vscode.ThemeIcon("symbol-class");
    case "block":
      return new vscode.ThemeIcon("symbol-event");
    case "connector":
      return new vscode.ThemeIcon("symbol-interface");
    case "record":
      return new vscode.ThemeIcon("symbol-struct");
    case "type":
      return new vscode.ThemeIcon("symbol-type-parameter");
    case "function":
      return new vscode.ThemeIcon("symbol-function");
    case "package":
      return new vscode.ThemeIcon("package");
    case "operator":
      return new vscode.ThemeIcon("symbol-operator");
    case "class":
      return new vscode.ThemeIcon("symbol-class");
    // SysML2 definitions
    case "part def":
      return new vscode.ThemeIcon("symbol-class");
    case "attribute def":
      return new vscode.ThemeIcon("symbol-property");
    case "port def":
      return new vscode.ThemeIcon("symbol-interface");
    case "item def":
      return new vscode.ThemeIcon("symbol-misc");
    case "occurrence def":
      return new vscode.ThemeIcon("symbol-event");
    case "connection def":
      return new vscode.ThemeIcon("git-compare");
    case "interface def":
      return new vscode.ThemeIcon("symbol-interface");
    case "allocation def":
      return new vscode.ThemeIcon("arrow-both");
    case "flow def":
      return new vscode.ThemeIcon("arrow-right");
    case "action def":
      return new vscode.ThemeIcon("run-all");
    case "state def":
      return new vscode.ThemeIcon("circle-large-outline");
    case "calc def":
      return new vscode.ThemeIcon("symbol-function");
    case "constraint def":
      return new vscode.ThemeIcon("warning");
    case "requirement def":
      return new vscode.ThemeIcon("shield");
    case "concern def":
      return new vscode.ThemeIcon("bell");
    case "use case def":
      return new vscode.ThemeIcon("account");
    case "case def":
      return new vscode.ThemeIcon("folder");
    case "analysis case def":
      return new vscode.ThemeIcon("graph");
    case "verification def":
      return new vscode.ThemeIcon("verified");
    case "view def":
      return new vscode.ThemeIcon("preview");
    case "viewpoint def":
      return new vscode.ThemeIcon("target");
    case "rendering def":
      return new vscode.ThemeIcon("paintcan");
    case "metadata def":
      return new vscode.ThemeIcon("tag");
    case "enumeration":
      return new vscode.ThemeIcon("symbol-enum");
    default:
      return new vscode.ThemeIcon("symbol-misc");
  }
}

// Convert raw SVG string to a data URI that VS Code can use as an icon
function svgToIconUri(svg: string): vscode.Uri {
  const bytes = new TextEncoder().encode(svg);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const base64 = btoa(binary);
  return vscode.Uri.parse(`data:image/svg+xml;base64,${base64}`);
}

export class LibraryTreeItem extends vscode.TreeItem {
  constructor(
    public readonly info: TreeNodeInfo,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    super(info.name, collapsibleState);
    this.tooltip = info.compositeName;
    this.description = info.classKind;
    this.contextValue = info.classKind;

    // Use SVG icon from LSP if available, otherwise fall back to codicons
    if (info.iconSvg) {
      const iconUri = svgToIconUri(info.iconSvg);
      this.iconPath = iconUri;
    } else {
      this.iconPath = classKindToIcon(info.classKind);
    }

    // For leaf items that can be added to a diagram, double-click triggers addToDiagram.
    const modelicaAddable = info.classKind === "model" || info.classKind === "block" || info.classKind === "connector";
    const sysml2Addable = info.language === "sysml2" && info.classKind.endsWith(" def");
    const isAddable = modelicaAddable || sysml2Addable;
    if (isAddable && !info.hasChildren) {
      this.command = {
        command: "modelscript.addToDiagram",
        title: "Add to Diagram",
        arguments: [info.compositeName, info.classKind, info.iconSvg],
      };
    }
  }
}

export class LibraryTreeProvider
  implements vscode.TreeDataProvider<LibraryTreeItem>, vscode.TreeDragAndDropController<LibraryTreeItem>
{
  public readonly dragMimeTypes = ["application/json", "text/plain"];
  public readonly dropMimeTypes = [];
  private _onDidChangeTreeData = new vscode.EventEmitter<LibraryTreeItem | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private documentUri: string | undefined;

  /** Cache of already-fetched SVG icons, keyed by compositeName. */
  private iconCache = new Map<string, string>();

  /** Set of compositeNames currently being fetched (to avoid duplicate requests). */
  private iconFetchPending = new Set<string>();

  constructor(private readonly client: LanguageClient) {}

  refresh(uri?: string): void {
    if (uri) this.documentUri = uri;
    this._onDidChangeTreeData.fire(undefined);
  }

  setDocumentUri(uri: string): void {
    if (this.documentUri !== uri) {
      this.documentUri = uri;
      this._onDidChangeTreeData.fire(undefined);
    }
  }

  getTreeItem(element: LibraryTreeItem): vscode.TreeItem {
    return element;
  }

  public onDragStart?: (data: { className: string; classKind: string; iconSvg?: string }) => void;

  public async handleDrag(
    source: readonly LibraryTreeItem[],
    dataTransfer: vscode.DataTransfer,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const item = source[0];
    if (!item) return;

    const modelicaAddable =
      item.info.classKind === "model" || item.info.classKind === "block" || item.info.classKind === "connector";
    const sysml2Addable = item.info.language === "sysml2" && item.info.classKind.endsWith(" def");
    const isAddable = modelicaAddable || sysml2Addable;
    if (!isAddable) return;

    const dragData = {
      className: item.info.compositeName,
      classKind: item.info.classKind,
      iconSvg: item.info.iconSvg ?? this.iconCache.get(item.info.compositeName),
    };

    const payload = JSON.stringify(dragData);
    dataTransfer.set("application/json", new vscode.DataTransferItem(payload));
    dataTransfer.set("text/plain", new vscode.DataTransferItem(payload));

    // Notify diagram webviews to enter placement mode
    this.onDragStart?.(dragData);
  }

  async getChildren(element?: LibraryTreeItem): Promise<LibraryTreeItem[]> {
    if (!this.documentUri) return [];

    try {
      const nodes: TreeNodeInfo[] = await this.client.sendRequest("modelscript/getLibraryTree", {
        uri: this.documentUri,
        parentId: element?.info.id,
      });

      // Apply cached icons to nodes that have them
      for (const node of nodes) {
        if (this.iconCache.has(node.compositeName)) {
          const cached = this.iconCache.get(node.compositeName);
          if (cached) node.iconSvg = cached;
        }
      }

      const items = nodes.map(
        (node) =>
          new LibraryTreeItem(
            node,
            node.hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
          ),
      );

      // Lazily fetch icons for nodes that don't have them yet.
      const nodesNeedingIcons = nodes.filter(
        (n) => !this.iconCache.has(n.compositeName) && !this.iconFetchPending.has(n.compositeName),
      );

      if (nodesNeedingIcons.length > 0) {
        this.fetchIconsInBackground(nodesNeedingIcons);
      }

      return items;
    } catch (e) {
      console.error("[library-tree] Error fetching children:", e);
      return [];
    }
  }

  /**
   * Fetch SVG icons for a batch of nodes in the background.
   * When icons arrive, cache them and refresh the tree to display them.
   */
  private async fetchIconsInBackground(nodes: TreeNodeInfo[]): Promise<void> {
    const toFetch = nodes.map((n) => n.compositeName);
    for (const name of toFetch) this.iconFetchPending.add(name);

    let anyFetched = false;

    for (const className of toFetch) {
      try {
        const svg = await this.client
          .sendRequest<string | null>("modelscript/getClassIcon", {
            className,
            uri: this.documentUri,
          })
          .catch(() => null);

        this.iconCache.set(className, svg || "");
        if (svg) {
          anyFetched = true;
        }
      } finally {
        this.iconFetchPending.delete(className);
      }
    }

    // Refresh the tree to show the newly fetched icons
    if (anyFetched) {
      this._onDidChangeTreeData.fire(undefined);
    }
  }
}
