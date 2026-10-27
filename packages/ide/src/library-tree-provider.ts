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
  icon?: string | undefined;
  hasChildren: boolean;
  iconSvg?: string | undefined;
  iconUri?: vscode.Uri | undefined;
  uri?: string | undefined;
  language?: string | undefined;
  description?: string | undefined;
  /** True when the icon is being lazily fetched — show a spinner placeholder. */
  pendingIcon?: boolean | undefined;
}

const KIND_TO_ICON_MAP: Record<string, string> = {
  model: "symbol-class",
  block: "circuit-board",
  component: "circuit-board",
  connector: "symbol-interface",
  record: "symbol-struct",
  type: "symbol-type-parameter",
  function: "symbol-function",
  package: "package",
  operator: "symbol-operator",
  class: "symbol-class",
  "part def": "symbol-class",
  "attribute def": "symbol-property",
  "port def": "symbol-interface",
  "item def": "symbol-misc",
  "occurrence def": "symbol-event",
  "connection def": "git-compare",
  "interface def": "symbol-interface",
  "allocation def": "arrow-both",
  "flow def": "arrow-right",
  "action def": "run-all",
  "state def": "circle-large-outline",
  "calc def": "symbol-function",
  "constraint def": "warning",
  "requirement def": "shield",
  "concern def": "bell",
  "use case def": "account",
  "case def": "folder",
  "analysis case def": "graph",
  "verification def": "verified",
  "view def": "preview",
  "viewpoint def": "target",
  "rendering def": "paintcan",
  "metadata def": "tag",
  enumeration: "symbol-enum",
};

// Map classKind to codicon (fallback when no SVG icon is available)
function classKindToIcon(kind: string): vscode.ThemeIcon {
  if (kind) {
    const mapped = KIND_TO_ICON_MAP[kind.toLowerCase()];
    if (mapped) {
      return new vscode.ThemeIcon(mapped);
    }
    if (kind.startsWith("symbol-") || kind === "circuit-board" || kind === "package") {
      try {
        return new vscode.ThemeIcon(kind);
      } catch {}
    }
  }
  return new vscode.ThemeIcon("circuit-board");
}

// Convert raw SVG string to a data URI that VS Code can use as an icon
function svgToIconUri(svg: string): vscode.Uri {
  const bytes = new TextEncoder().encode(svg);
  let binary = "";
  const len = bytes.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  const base64 = btoa(binary);
  return vscode.Uri.parse(`data:image/svg+xml;base64,${base64}`);
}

export class LibraryTreeItem extends vscode.TreeItem {
  constructor(
    public readonly info: TreeNodeInfo,
    public override readonly collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    super(info.name, collapsibleState);
    this.id = info.id;
    this.tooltip = info.compositeName;
    this.description = info.description ?? info.classKind;
    this.contextValue = info.classKind;

    // Use OWL2 themed icons for ontology items
    if (info.language === "owl2") {
      if (info.classKind === "owl2-defined-class") {
        this.iconPath = new vscode.ThemeIcon("symbol-class", new vscode.ThemeColor("charts.yellow"));
      } else if (info.classKind === "owl2-class") {
        this.iconPath = new vscode.ThemeIcon("symbol-class", new vscode.ThemeColor("charts.orange"));
      } else if (info.classKind === "owl2-object-property") {
        this.iconPath = new vscode.ThemeIcon("symbol-property", new vscode.ThemeColor("charts.blue"));
      } else if (info.classKind === "owl2-data-property") {
        this.iconPath = new vscode.ThemeIcon("symbol-field", new vscode.ThemeColor("charts.green"));
      } else if (info.classKind === "owl2-individual") {
        this.iconPath = new vscode.ThemeIcon("symbol-misc", new vscode.ThemeColor("charts.purple"));
      } else if (info.classKind === "ontology") {
        this.iconPath = new vscode.ThemeIcon("symbol-namespace", new vscode.ThemeColor("charts.cyan"));
      } else if (info.icon) {
        const iconName = info.icon === "class" ? "symbol-class" : info.icon;
        this.iconPath = new vscode.ThemeIcon(iconName);
      } else {
        this.iconPath = classKindToIcon(info.classKind);
      }
    } else if (info.iconUri && info.iconUri.scheme !== "vscode-userdata") {
      this.iconPath = info.iconUri;
    } else if (info.iconSvg) {
      if (info.iconSvg.includes("currentColor")) {
        const lightSvg = info.iconSvg.replace(/currentColor/g, "#0f172a");
        const darkSvg = info.iconSvg.replace(/currentColor/g, "#f8fafc");
        this.iconPath = {
          light: svgToIconUri(lightSvg),
          dark: svgToIconUri(darkSvg),
        };
      } else {
        const iconUri = svgToIconUri(info.iconSvg);
        this.iconPath = iconUri;
      }
    } else if (info.icon) {
      const iconName = info.icon === "class" ? "symbol-class" : info.icon;
      try {
        this.iconPath = new vscode.ThemeIcon(iconName);
      } catch {
        this.iconPath = classKindToIcon(info.classKind);
      }
    } else if (info.pendingIcon) {
      // Show a spinner while the icon is being fetched in the background
      this.iconPath = new vscode.ThemeIcon("loading~spin");
    } else {
      this.iconPath = classKindToIcon(info.classKind);
    }

    // For OWL 2 items (classes, properties, individuals), clicking navigates to declaration
    if (
      info.language === "owl2" &&
      (info.id.startsWith("__OWL_CLASS__:") ||
        info.id.startsWith("__OWL_OBJ_PROP__:") ||
        info.id.startsWith("__OWL_DATA_PROP__:") ||
        info.id.startsWith("__OWL_INDIVIDUAL__:"))
    ) {
      this.command = {
        command: "modelscript.owl2.goToDeclaration",
        title: "Go to Declaration",
        arguments: [info.compositeName],
      };
    } else {
      // Models, blocks, and component definitions: double-click / click opens in editor
      const nonOpenableKinds = new Set(["package", "import", "comment", "file", "folder", "ontology"]);
      const kind = (info.classKind || "").toLowerCase();
      const isOpenable = !nonOpenableKinds.has(kind);
      if (isOpenable && !info.id.startsWith("__LIB__:") && !info.id.startsWith("__ONTOLOGY__:")) {
        this.command = {
          command: "modelscript.openModel",
          title: "Open Model in Editor",
          arguments: [{ className: info.compositeName || info.name, uri: info.uri }],
        };
      }
    }
  }
}

export class LibraryTreeProvider
  implements vscode.TreeDataProvider<LibraryTreeItem>, vscode.TreeDragAndDropController<LibraryTreeItem>
{
  public readonly dragMimeTypes = [
    "application/vnd.code.tree.modelscript.libraryTree",
    "application/vnd.modelscript.classname",
    "application/vnd.modelscript.iconsvg",
    "application/json",
    "text/plain",
  ];
  public readonly dropMimeTypes = [];
  private _onDidChangeTreeData = new vscode.EventEmitter<LibraryTreeItem | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private documentUri: string | undefined;

  /** Cache of already-fetched SVG icons, keyed by compositeName. */
  public iconCache = new Map<string, string>();

  /** Cache of saved icon file Uris, keyed by compositeName. */
  public iconUriCache = new Map<string, vscode.Uri>();

  /** Set of compositeNames currently being fetched (to avoid duplicate requests). */
  private iconFetchPending = new Set<string>();

  /** Map of child ID -> parent TreeItem */
  private parentMap = new Map<string, LibraryTreeItem>();
  /** Map of item ID or compositeName -> TreeItem */
  private itemMap = new Map<string, LibraryTreeItem>();
  /** Elements pending refresh */
  private pendingRefreshElements = new Set<LibraryTreeItem | undefined>();

  private refreshTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly client: LanguageClient,
    private readonly context?: vscode.ExtensionContext,
  ) {
    const sub = this.client.onNotification("modelscript/projectTreeChanged", () => {
      this.refresh();
    });
    if (this.context) {
      this.context.subscriptions.push(sub);
    }
  }

  refresh(uri?: string): void {
    if (uri) this.documentUri = uri;
    this.parentMap.clear();
    this.itemMap.clear();
    this._onDidChangeTreeData.fire(undefined);
  }

  setDocumentUri(uri: string): void {
    if (this.documentUri !== uri) {
      this.documentUri = uri;
      this.parentMap.clear();
      this.itemMap.clear();
      this._onDidChangeTreeData.fire(undefined);
    }
  }

  getTreeItem(element: LibraryTreeItem): vscode.TreeItem {
    const name = element.info.compositeName;
    if (this.iconUriCache.has(name)) {
      const iconUri = this.iconUriCache.get(name);
      if (iconUri) element.iconPath = iconUri;
      element.info.pendingIcon = false;
    } else if (this.iconCache.has(name)) {
      const svg = this.iconCache.get(name);
      if (svg) {
        element.iconPath = svgToIconUri(svg);
      } else {
        element.iconPath = classKindToIcon(element.info.classKind);
      }
      element.info.pendingIcon = false;
    } else if (element.info.iconSvg) {
      element.iconPath = svgToIconUri(element.info.iconSvg);
      element.info.pendingIcon = false;
    }
    return element;
  }

  getItem(idOrName: string): LibraryTreeItem | undefined {
    return this.itemMap.get(idOrName);
  }

  getParent(element: LibraryTreeItem): vscode.ProviderResult<LibraryTreeItem> {
    const fromMap = this.parentMap.get(element.info.id);
    if (fromMap) return fromMap;

    const id = element.info.id;
    if (id.startsWith("__LIB__:") || id.startsWith("__ONTOLOGY__:") || !element.info.compositeName) {
      return undefined;
    }
    const lastDot = element.info.compositeName.lastIndexOf(".");
    if (lastDot > 0) {
      const parentName = element.info.compositeName.substring(0, lastDot);
      return this.itemMap.get(parentName);
    }
    if (element.info.language === "modelica") {
      return this.itemMap.get("__LIB__:Modelica Standard Library");
    }
    return undefined;
  }

  public onDragStart?:
    | ((data: { className: string; classKind: string; iconSvg?: string | undefined; isDrag?: boolean }) => void)
    | undefined;

  public onDragEnd?: (() => void) | undefined;

  public async handleDrag(
    source: readonly LibraryTreeItem[],
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const item = source[0];
    if (!item) return;

    const kind = (item.info.classKind || "").toLowerCase();
    const nonAddableKinds = new Set(["package", "import", "comment", "file", "folder", "ontology"]);
    const isAddable =
      !nonAddableKinds.has(kind) && !item.info.id.startsWith("__LIB__:") && !item.info.id.startsWith("__ONTOLOGY__:");
    if (!isAddable) return;

    const className = item.info.compositeName || item.info.name;
    if (!className) return;

    const iconSvg = item.info.iconSvg ?? this.iconCache.get(className);
    const dragData = {
      className,
      classKind: item.info.classKind || "class",
      iconSvg,
      isDrag: true,
    };

    const payload = JSON.stringify(dragData);
    dataTransfer.set("application/json", new vscode.DataTransferItem(payload));
    dataTransfer.set("text/plain", new vscode.DataTransferItem(payload));
    dataTransfer.set("application/vnd.modelscript.classname", new vscode.DataTransferItem(className));
    if (iconSvg) {
      dataTransfer.set("application/vnd.modelscript.iconsvg", new vscode.DataTransferItem(iconSvg));
    }
    dataTransfer.set("application/vnd.code.tree.modelscript.libraryTree", new vscode.DataTransferItem(item));

    // Notify diagram webviews to enter placement mode
    this.onDragStart?.(dragData);

    token.onCancellationRequested(() => {
      this.onDragEnd?.();
    });
  }

  async getChildren(element?: LibraryTreeItem): Promise<LibraryTreeItem[]> {
    try {
      console.log(
        `[library-tree-provider] getChildren called for element: ${element?.info?.name} (id: ${element?.info?.id})`,
      );
      const nodes: TreeNodeInfo[] = await this.client.sendRequest<TreeNodeInfo[]>("modelscript/getLibraryTree", {
        uri: this.documentUri ?? "file:///",
        parentId: element?.info.id,
      });
      console.log(
        `[library-tree-provider] getChildren got ${nodes.length} nodes for ${element?.info?.id}:`,
        nodes.map((n) => n.name),
      );

      const nonIconKinds = new Set(["folder", "file", "import", "comment", "ontology"]);

      // Apply cached icons to nodes that have them
      for (const node of nodes) {
        if (node.iconSvg && !this.iconCache.has(node.compositeName)) {
          this.iconCache.set(node.compositeName, node.iconSvg);
        }
        if (this.iconCache.has(node.compositeName)) {
          const cached = this.iconCache.get(node.compositeName);
          if (cached) node.iconSvg = cached;
        }
        if (this.iconUriCache.has(node.compositeName)) {
          node.iconUri = this.iconUriCache.get(node.compositeName);
        }
      }

      const items = nodes.map(
        (node) =>
          new LibraryTreeItem(
            node,
            node.hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
          ),
      );

      for (const item of items) {
        this.itemMap.set(item.info.id, item);
        if (item.info.compositeName) {
          this.itemMap.set(item.info.compositeName, item);
        }
        if (element) {
          this.parentMap.set(item.info.id, element);
        }
      }

      // Lazily fetch icons for nodes needing them.
      // Exclude virtual library root containers and non-icon structural elements.
      const nodesNeedingIcons: TreeNodeInfo[] = [];
      const itemsNeedingIcons: LibraryTreeItem[] = [];
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i]!;
        if (
          !n.id.startsWith("__LIB__:") &&
          !n.id.startsWith("__ONTOLOGY__:") &&
          !n.id.startsWith("__OWL_") &&
          n.language !== "owl2" &&
          n.compositeName &&
          !nonIconKinds.has((n.classKind || "").toLowerCase()) &&
          !n.iconSvg &&
          !this.iconCache.has(n.compositeName) &&
          !this.iconFetchPending.has(n.compositeName)
        ) {
          nodesNeedingIcons.push(n);
          itemsNeedingIcons.push(items[i]!);
        }
      }

      if (nodesNeedingIcons.length > 0) {
        this.fetchIconsInBackground(nodesNeedingIcons, itemsNeedingIcons);
      }

      return items;
    } catch (e) {
      console.error("[library-tree] Error fetching children:", e);
      return [];
    }
  }

  private scheduleRefresh(items?: LibraryTreeItem[]): void {
    if (items) {
      for (const item of items) {
        if (item) this.pendingRefreshElements.add(item);
      }
    }
    if (this.refreshTimeout) clearTimeout(this.refreshTimeout);
    this.refreshTimeout = setTimeout(() => {
      this.refreshTimeout = null;
      const elements = Array.from(this.pendingRefreshElements);
      this.pendingRefreshElements.clear();

      const parentsToRefresh = new Set<LibraryTreeItem | undefined>();
      for (const el of elements) {
        if (el) {
          if (!el.info.hasChildren) {
            // Leaf items: fire on the item directly so VS Code updates its icon in-place
            // without rebuilding the parent list or re-triggering getChildren.
            this._onDidChangeTreeData.fire(el);
          } else {
            // Container items: refresh the parent to update the container's row icon.
            const parent = this.parentMap.get(el.info.id) ?? (this.getParent(el) as LibraryTreeItem | undefined);
            parentsToRefresh.add(parent);
          }
        }
      }
      if (parentsToRefresh.has(undefined)) {
        this._onDidChangeTreeData.fire(undefined);
      } else {
        for (const parent of parentsToRefresh) {
          if (parent) this._onDidChangeTreeData.fire(parent);
        }
      }
    }, 80);
  }

  private async saveSvgIcon(className: string, svg: string): Promise<vscode.Uri | undefined> {
    if (!svg) return undefined;
    if (this.context?.globalStorageUri && this.context.globalStorageUri.scheme === "file") {
      try {
        const iconsDir = vscode.Uri.joinPath(this.context.globalStorageUri, "icons");
        await vscode.workspace.fs.createDirectory(iconsDir);
        const safeName = className.replace(/[^a-zA-Z0-9_.-]/g, "_");
        const fileUri = vscode.Uri.joinPath(iconsDir, `${safeName}.svg`);
        await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(svg));
        return fileUri;
      } catch (e) {
        console.warn(`[library-tree-provider] Failed to write icon for ${className} to globalStorage:`, e);
      }
    }
    return svgToIconUri(svg);
  }

  /**
   * Fetch SVG icons for a batch of nodes in the background.
   * When icons arrive, cache them and refresh only those specific tree items.
   */
  private async fetchIconsInBackground(nodes: TreeNodeInfo[], items: LibraryTreeItem[]): Promise<void> {
    const toFetch = nodes.map((n) => n.compositeName);
    for (const name of toFetch) this.iconFetchPending.add(name);

    const concurrency = 2;

    for (let i = 0; i < toFetch.length; i += concurrency) {
      const batch = toFetch.slice(i, i + concurrency);
      const batchItems = items.slice(i, i + concurrency);
      await Promise.all(
        batch.map(async (className, idx) => {
          try {
            const svg = await this.client
              .sendRequest<string | null>("modelscript/getClassIcon", {
                className,
                uri: this.documentUri,
              })
              .catch((err) => {
                console.error(`[library-tree-provider] getClassIcon error for ${className}:`, err);
                return null;
              });

            this.iconCache.set(className, svg || "");
            if (svg) {
              const uri = await this.saveSvgIcon(className, svg);
              if (uri) {
                this.iconUriCache.set(className, uri);
              }
              const item = batchItems[idx];
              if (item) {
                item.info.iconSvg = svg;
                item.iconPath = uri ?? svgToIconUri(svg);
                item.info.pendingIcon = false;
              }
            }
          } finally {
            this.iconFetchPending.delete(className);
          }
        }),
      );
      this.scheduleRefresh(batchItems);
      // Yield to event loop between batches so user interactions are never blocked
      await new Promise((r) => setTimeout(r, 20));
    }
  }
}
