// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Project tree provider for the sidebar panel.
// Shows workspace .mo files organized by their package structure.
// - Directories with package.mo are shown as package nodes
// - Individual .mo files are shown under their parent package/directory
// - Classes defined in each file are shown as expandable children
// - Click a file node to open it in the editor
// - Click a class node to navigate to its definition

import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/browser";

interface ProjectTreeNodeInfo {
  id: string;
  name: string;
  uri?: string;
  compositeName?: string;
  classKind?: string;
  hasChildren: boolean;
  isFile: boolean;
  iconSvg?: string;
  line?: number;
}

// Map classKind to codicon (same as libraryTreeProvider)
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

/** Node types in the project tree */
type ProjectNodeKind = "package" | "file" | "class" | "fmu";

interface ProjectNodeInfo {
  kind: ProjectNodeKind;
  /** Display name */
  name: string;
  /** For file/package nodes: the URI of the .mo file or package.mo */
  uri?: string;
  /** For package nodes: the directory URI */
  dirUri?: string;
  /** For class nodes: class metadata from LSP */
  compositeName?: string;
  classKind?: string;
  iconSvg?: string;
  line?: number;
  hasChildren: boolean;
}

export class ProjectTreeItem extends vscode.TreeItem {
  constructor(
    public readonly info: ProjectNodeInfo,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    super(info.name, collapsibleState);

    switch (info.kind) {
      case "package":
        this.tooltip = info.name;
        this.iconPath = new vscode.ThemeIcon("package");
        this.contextValue = "package";
        // Click opens the package.mo file
        if (info.uri) {
          this.command = {
            command: "modelscript.openProjectFile",
            title: "Open Package",
            arguments: [info.uri],
          };
        }
        break;

      case "file":
        this.tooltip = info.uri;
        this.iconPath = vscode.ThemeIcon.File;
        this.contextValue = "file";
        if (info.uri) {
          this.command = {
            command: "modelscript.openProjectFile",
            title: "Open File",
            arguments: [info.uri],
          };
        }
        break;

      case "fmu":
        this.tooltip = info.name;
        this.description = "FMU";
        this.iconPath = new vscode.ThemeIcon("circuit-board");
        this.contextValue = "fmu";
        if (info.uri) {
          this.command = {
            command: "modelscript.openProjectFile",
            title: "Open FMU",
            arguments: [info.uri],
          };
        }
        break;

      case "class":
        this.tooltip = info.compositeName;
        this.description = info.classKind;
        this.contextValue = info.classKind;
        if (info.iconSvg) {
          const iconUri = svgToIconUri(info.iconSvg);
          this.iconPath = { light: iconUri, dark: iconUri };
        } else if (info.classKind) {
          this.iconPath = classKindToIcon(info.classKind);
        }
        if (info.uri && info.line !== undefined) {
          this.command = {
            command: "modelscript.openProjectFile",
            title: "Go to Definition",
            arguments: [info.uri, info.line],
          };
        }
        break;
    }
  }
}

/**
 * Represents a directory node in the workspace tree.
 * Directories with a package.mo are treated as Modelica packages.
 */
interface DirNode {
  name: string;
  uri: vscode.Uri;
  isPackage: boolean;
  /** URI of the package.mo file (if isPackage) */
  packageUri?: vscode.Uri;
  /** Direct child .mo files (excluding package.mo and package.order) */
  files: vscode.Uri[];
  /** Direct child FMU XML files */
  fmuFiles: vscode.Uri[];
  /** Direct child directories that contain .mo files */
  subdirs: DirNode[];
}

export class ProjectTreeProvider
  implements vscode.TreeDataProvider<ProjectTreeItem>, vscode.TreeDragAndDropController<ProjectTreeItem>
{
  public readonly dragMimeTypes = ["application/json", "text/plain"];
  public readonly dropMimeTypes: string[] = [];
  private _onDidChangeTreeData = new vscode.EventEmitter<ProjectTreeItem | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /** Cached workspace tree, rebuilt on refresh */
  private cachedRoots: DirNode[] | null = null;

  constructor(private readonly client: LanguageClient) {}

  /** Callback invoked when a drag starts — set by extension host to forward to diagram webviews. */
  public onDragStart?: (data: { className: string; classKind: string; iconSvg?: string }) => void;

  public async handleDrag(
    source: readonly ProjectTreeItem[],
    dataTransfer: vscode.DataTransfer,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const item = source[0];
    if (!item) return;

    // Only FMU nodes and diagram-compatible class nodes are draggable
    if (item.info.kind === "fmu") {
      const fmuName = item.info.name;
      const dragData = {
        className: fmuName,
        classKind: "model" as const,
      };
      const payload = JSON.stringify(dragData);
      dataTransfer.set("application/json", new vscode.DataTransferItem(payload));
      dataTransfer.set("text/plain", new vscode.DataTransferItem(payload));
      this.onDragStart?.(dragData);
    } else if (item.info.kind === "class") {
      const isAddable =
        item.info.classKind === "model" || item.info.classKind === "block" || item.info.classKind === "connector";
      if (!isAddable) return;
      const dragData = {
        className: item.info.compositeName ?? item.info.name,
        classKind: item.info.classKind ?? "model",
        iconSvg: item.info.iconSvg,
      };
      const payload = JSON.stringify(dragData);
      dataTransfer.set("application/json", new vscode.DataTransferItem(payload));
      dataTransfer.set("text/plain", new vscode.DataTransferItem(payload));
      this.onDragStart?.(dragData);
    }
  }

  refresh(): void {
    this.cachedRoots = null;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: ProjectTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ProjectTreeItem): Promise<ProjectTreeItem[]> {
    if (!element) {
      // Root level: scan the workspace and build directory tree
      const roots = await this.getWorkspaceTree();
      return this.dirNodesToItems(roots);
    }

    const info = element.info;

    if (info.kind === "fmu") {
      // FMU nodes are leaf nodes — no children
      return [];
    }

    if (info.kind === "package" && info.dirUri) {
      // Package node: show sub-packages, child .mo files, and classes from package.mo
      const roots = await this.getWorkspaceTree();
      const dirNode = this.findDirNode(roots, info.dirUri);
      if (!dirNode) return [];

      const items: ProjectTreeItem[] = [];

      // Sub-packages and sub-directories first
      items.push(...this.dirNodesToItems(dirNode.subdirs));

      // Child .mo files
      for (const fileUri of dirNode.files) {
        const fileName = fileUri.path.split("/").pop() ?? "";
        items.push(
          new ProjectTreeItem(
            {
              kind: "file",
              name: fileName,
              uri: fileUri.toString(),
              hasChildren: true, // files always expandable to show classes
            },
            vscode.TreeItemCollapsibleState.Collapsed,
          ),
        );
      }

      // Classes from package.mo itself
      if (dirNode.packageUri) {
        const classItems = await this.getClassChildren(dirNode.packageUri.toString());
        items.push(...classItems);
      }

      // FMU XML files
      for (const fmuUri of dirNode.fmuFiles) {
        const fmuName =
          fmuUri.path
            .split("/")
            .pop()
            ?.replace(/\.xml$/, "") ?? "";
        items.push(
          new ProjectTreeItem(
            {
              kind: "fmu",
              name: fmuName,
              uri: fmuUri.toString(),
              hasChildren: false,
            },
            vscode.TreeItemCollapsibleState.None,
          ),
        );
      }

      return items;
    }

    if (info.kind === "file" && info.uri) {
      // File node: show classes defined in this file
      return this.getClassChildren(info.uri);
    }

    if (info.kind === "class") {
      // Class node: show child classes via LSP
      return this.getClassChildrenById(element);
    }

    return [];
  }

  /** Build the workspace directory tree from all .mo files */
  private async getWorkspaceTree(): Promise<DirNode[]> {
    if (this.cachedRoots) return this.cachedRoots;

    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      this.cachedRoots = [];
      return [];
    }

    const moFiles = await vscode.workspace.findFiles("**/*.mo");
    if (moFiles.length === 0) {
      this.cachedRoots = [];
      return [];
    }

    const workspaceRoot = folders[0].uri;
    const rootNode: DirNode = {
      name: "",
      uri: workspaceRoot,
      isPackage: false,
      files: [],
      fmuFiles: [],
      subdirs: [],
    };

    // Build a map of directory path -> DirNode
    const dirMap = new Map<string, DirNode>();
    dirMap.set(workspaceRoot.path, rootNode);

    // Sort files so we process them in order
    moFiles.sort((a, b) => a.path.localeCompare(b.path));

    for (const fileUri of moFiles) {
      const fileName = fileUri.path.split("/").pop() ?? "";
      const dirPath = fileUri.path.substring(0, fileUri.path.length - fileName.length - 1);

      // Ensure the directory node exists
      const dirNode = this.ensureDirNode(dirMap, workspaceRoot, dirPath);

      if (fileName === "package.mo") {
        dirNode.isPackage = true;
        dirNode.packageUri = fileUri;
      } else if (fileName === "package.order") {
        // Skip package.order files
      } else {
        dirNode.files.push(fileUri);
      }
    }

    // The roots are workspaceRoot's direct children that have content
    // If the workspace root itself is a package, return it as the root
    if (rootNode.isPackage) {
      this.cachedRoots = [rootNode];
    } else if (rootNode.subdirs.length > 0 || rootNode.files.length > 0) {
      // Flatten: if root only has files (no packages), show files directly
      // If root has subdirs, show them as roots
      this.cachedRoots = rootNode.subdirs.length > 0 ? rootNode.subdirs : [rootNode];
      // Also include root-level files alongside subdirs
      if (rootNode.subdirs.length > 0 && rootNode.files.length > 0) {
        this.cachedRoots = [rootNode];
      }
    } else {
      this.cachedRoots = [];
    }

    // Scan for FMU XML files
    const xmlFiles = await vscode.workspace.findFiles("**/*.xml");
    for (const xmlUri of xmlFiles) {
      try {
        const content = await vscode.workspace.fs.readFile(xmlUri);
        const text = new TextDecoder().decode(content.slice(0, 500)); // peek header
        if (!text.includes("fmiModelDescription")) continue;
        const xmlName = xmlUri.path.split("/").pop() ?? "";
        const xmlDirPath = xmlUri.path.substring(0, xmlUri.path.length - xmlName.length - 1);
        const dirNode = this.ensureDirNode(dirMap, workspaceRoot, xmlDirPath);
        dirNode.fmuFiles.push(xmlUri);
      } catch {
        // Skip unreadable XML files
      }
    }

    return this.cachedRoots;
  }

  /** Ensure all directories in the path have DirNode entries */
  private ensureDirNode(dirMap: Map<string, DirNode>, workspaceRoot: vscode.Uri, dirPath: string): DirNode {
    const existing = dirMap.get(dirPath);
    if (existing) return existing;

    const parts = dirPath.substring(workspaceRoot.path.length).split("/").filter(Boolean);
    let currentPath = workspaceRoot.path;
    let currentNode = dirMap.get(currentPath);
    if (!currentNode) return currentNode as never;

    for (const part of parts) {
      currentPath = currentPath + "/" + part;
      if (!dirMap.has(currentPath)) {
        const newNode: DirNode = {
          name: part,
          uri: workspaceRoot.with({ path: currentPath }),
          isPackage: false,
          files: [],
          fmuFiles: [],
          subdirs: [],
        };
        currentNode.subdirs.push(newNode);
        dirMap.set(currentPath, newNode);
      }
      currentNode = dirMap.get(currentPath) ?? currentNode;
    }

    return currentNode;
  }

  /** Convert DirNode array to ProjectTreeItems */
  private dirNodesToItems(nodes: DirNode[]): ProjectTreeItem[] {
    const items: ProjectTreeItem[] = [];

    for (const node of nodes) {
      if (node.isPackage) {
        // Package directory
        items.push(
          new ProjectTreeItem(
            {
              kind: "package",
              name: node.name,
              uri: node.packageUri?.toString(),
              dirUri: node.uri.toString(),
              hasChildren: true,
            },
            vscode.TreeItemCollapsibleState.Collapsed,
          ),
        );
      } else if (node.files.length === 1 && node.subdirs.length === 0 && node.name === "") {
        // Single file at root — show file directly
        const fileUri = node.files[0];
        const fileName = fileUri.path.split("/").pop() ?? "";
        items.push(
          new ProjectTreeItem(
            {
              kind: "file",
              name: fileName,
              uri: fileUri.toString(),
              hasChildren: true,
            },
            vscode.TreeItemCollapsibleState.Collapsed,
          ),
        );
      } else if (node.files.length > 0 || node.subdirs.length > 0 || node.fmuFiles.length > 0) {
        // Non-package directory with .mo or FMU files — show individual files
        if (node.name === "") {
          // Root workspace: show files and subdirs directly
          for (const sub of node.subdirs) {
            items.push(...this.dirNodesToItems([sub]));
          }
          for (const fileUri of node.files) {
            const fileName = fileUri.path.split("/").pop() ?? "";
            items.push(
              new ProjectTreeItem(
                {
                  kind: "file",
                  name: fileName,
                  uri: fileUri.toString(),
                  hasChildren: true,
                },
                vscode.TreeItemCollapsibleState.Collapsed,
              ),
            );
          }
          // FMU XML files at root
          for (const fmuUri of node.fmuFiles) {
            const fmuName =
              fmuUri.path
                .split("/")
                .pop()
                ?.replace(/\.xml$/, "") ?? "";
            items.push(
              new ProjectTreeItem(
                {
                  kind: "fmu",
                  name: fmuName,
                  uri: fmuUri.toString(),
                  hasChildren: false,
                },
                vscode.TreeItemCollapsibleState.None,
              ),
            );
          }
        } else {
          // Named non-package directory: show as a folder
          items.push(
            new ProjectTreeItem(
              {
                kind: "package",
                name: node.name,
                dirUri: node.uri.toString(),
                hasChildren: true,
              },
              vscode.TreeItemCollapsibleState.Collapsed,
            ),
          );
        }
      }
    }

    // Sort: packages first, then files, alphabetically within each group
    items.sort((a, b) => {
      if (a.info.kind !== b.info.kind) {
        if (a.info.kind === "package") return -1;
        if (b.info.kind === "package") return 1;
      }
      return a.info.name.localeCompare(b.info.name);
    });

    return items;
  }

  /** Find a DirNode by its URI string */
  private findDirNode(roots: DirNode[], dirUri: string): DirNode | null {
    for (const root of roots) {
      if (root.uri.toString() === dirUri) return root;
      const found = this.findDirNode(root.subdirs, dirUri);
      if (found) return found;
    }
    return null;
  }

  /** Get class children for a file URI from the LSP */
  private async getClassChildren(fileUri: string): Promise<ProjectTreeItem[]> {
    try {
      const nodes: ProjectTreeNodeInfo[] = await this.client.sendRequest("modelscript/getProjectTree", {
        parentId: fileUri,
      });

      return nodes.map(
        (node) =>
          new ProjectTreeItem(
            {
              kind: "class",
              name: node.name,
              uri: node.uri,
              compositeName: node.compositeName,
              classKind: node.classKind,
              iconSvg: node.iconSvg,
              line: node.line,
              hasChildren: node.hasChildren,
            },
            node.hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
          ),
      );
    } catch (e) {
      console.error("[project-tree] Error fetching class children:", e);
      return [];
    }
  }

  /** Get child classes of a class node via LSP */
  private async getClassChildrenById(element: ProjectTreeItem): Promise<ProjectTreeItem[]> {
    const info = element.info;
    if (!info.uri || !info.compositeName) return [];

    try {
      const parentId = `${info.uri}::${info.compositeName}`;
      const nodes: ProjectTreeNodeInfo[] = await this.client.sendRequest("modelscript/getProjectTree", {
        parentId,
      });

      return nodes.map(
        (node) =>
          new ProjectTreeItem(
            {
              kind: "class",
              name: node.name,
              uri: node.uri,
              compositeName: node.compositeName,
              classKind: node.classKind,
              iconSvg: node.iconSvg,
              line: node.line,
              hasChildren: node.hasChildren,
            },
            node.hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
          ),
      );
    } catch (e) {
      console.error("[project-tree] Error fetching class children:", e);
      return [];
    }
  }
}
