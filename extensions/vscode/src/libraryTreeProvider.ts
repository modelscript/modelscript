// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Library tree provider for the sidebar panel.
// Communicates with the LSP server to get tree data and icons.
// - Double-click on a leaf item (model, block, connector) triggers "Add to Diagram"
// - Right-click context menu also offers "Add to Diagram"
// - Icons: SVG data URIs from the LSP when available, codicon fallback otherwise

import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";

interface TreeNodeInfo {
  id: string;
  name: string;
  compositeName: string;
  classKind: string;
  hasChildren: boolean;
  iconSvg?: string;
}

// Map classKind to codicon (fallback when no SVG icon is available)
function classKindToIcon(kind: string): vscode.ThemeIcon {
  switch (kind) {
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
    default:
      return new vscode.ThemeIcon("symbol-misc");
  }
}

// Convert raw SVG string to a data URI that VS Code can use as an icon
function svgToIconUri(svg: string): vscode.Uri {
  const encoded = encodeURIComponent(svg);
  return vscode.Uri.parse(`data:image/svg+xml;utf8,${encoded}`);
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
      this.iconPath = { light: iconUri, dark: iconUri };
    } else {
      this.iconPath = classKindToIcon(info.classKind);
    }

    // For leaf items that can be added to a diagram (model, block, connector),
    // double-click triggers addToDiagram. Expandable items use default behavior.
    const isAddable = info.classKind === "model" || info.classKind === "block" || info.classKind === "connector";
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

    const isAddable =
      item.info.classKind === "model" || item.info.classKind === "block" || item.info.classKind === "connector";
    if (!isAddable) return;

    const dragData = {
      className: item.info.compositeName,
      classKind: item.info.classKind,
      iconSvg: item.info.iconSvg,
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

      return nodes.map(
        (node) =>
          new LibraryTreeItem(
            node,
            node.hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
          ),
      );
    } catch (e) {
      console.error("[library-tree] Error fetching children:", e);
      return [];
    }
  }
}
