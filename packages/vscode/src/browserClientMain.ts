import * as vscode from "vscode";
import { Uri, commands, workspace } from "vscode";
import { LanguageClientOptions } from "vscode-languageclient";
import { LanguageClient } from "vscode-languageclient/browser";
import { DiagramPanel } from "./diagramPanel";
import { LibraryTreeProvider } from "./libraryTreeProvider";
import { SimulationPanel } from "./simulationPanel";

let client: LanguageClient | undefined;

/**
 * Simple in-memory filesystem provider for the `tmp` scheme.
 * Used by blank project mode to store files in memory.
 */
class MemoryFileSystemProvider implements vscode.FileSystemProvider {
  private files = new Map<string, Uint8Array>();
  private directories = new Set<string>(["/"]); // Root always exists
  private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this._emitter.event;

  watch(): vscode.Disposable {
    // No-op: we don't need to watch for external changes
    return new vscode.Disposable(() => undefined);
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    const path = uri.path;
    // Check directories FIRST — a path registered as a directory must not be treated as a file
    if (this.directories.has(path) || path === "/" || path === "") {
      return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
    }
    if (this.files.has(path)) {
      return { type: vscode.FileType.File, ctime: 0, mtime: Date.now(), size: this.files.get(path)?.length ?? 0 };
    }
    throw vscode.FileSystemError.FileNotFound(uri);
  }

  readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
    const prefix = uri.path === "/" ? "/" : uri.path + "/";
    const result: [string, vscode.FileType][] = [];
    const seen = new Set<string>();
    for (const [path] of this.files) {
      if (path.startsWith(prefix)) {
        const rest = path.slice(prefix.length);
        const name = rest.split("/")[0];
        if (!seen.has(name)) {
          seen.add(name);
          result.push([name, rest.includes("/") ? vscode.FileType.Directory : vscode.FileType.File]);
        }
      }
    }
    for (const dir of this.directories) {
      if (dir.startsWith(prefix)) {
        const rest = dir.slice(prefix.length);
        if (!rest.includes("/") && !seen.has(rest)) {
          seen.add(rest);
          result.push([rest, vscode.FileType.Directory]);
        }
      }
    }
    return result;
  }

  createDirectory(uri: vscode.Uri): void {
    this._mkdirp(uri.path);
  }

  readFile(uri: vscode.Uri): Uint8Array {
    const data = this.files.get(uri.path);
    if (data) return data;
    throw vscode.FileSystemError.FileNotFound(uri);
  }

  writeFile(uri: vscode.Uri, content: Uint8Array): void {
    // Auto-create parent directories
    const parts = uri.path.split("/");
    for (let i = 1; i < parts.length - 1; i++) {
      this._mkdirp(parts.slice(0, i + 1).join("/"));
    }
    const isNew = !this.files.has(uri.path);
    this.files.set(uri.path, content);
    this._emitter.fire([{ type: isNew ? vscode.FileChangeType.Created : vscode.FileChangeType.Changed, uri }]);
  }

  delete(uri: vscode.Uri): void {
    this.files.delete(uri.path);
    this.directories.delete(uri.path);
    this._emitter.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
  }

  rename(oldUri: vscode.Uri, newUri: vscode.Uri): void {
    const data = this.files.get(oldUri.path);
    if (data) {
      this.files.delete(oldUri.path);
      this.files.set(newUri.path, data);
    }
  }

  private _mkdirp(path: string): void {
    this.directories.add(path);
  }
}

export async function activate(context: vscode.ExtensionContext) {
  console.log("ModelScript extension activated");

  // Register in-memory filesystem for blank project mode (tmp:// scheme)
  const folders = workspace.workspaceFolders;
  if (folders && folders.length > 0 && folders[0].uri.scheme === "tmp") {
    const memFs = new MemoryFileSystemProvider();
    context.subscriptions.push(workspace.registerFileSystemProvider("tmp", memFs, { isCaseSensitive: true }));
    console.log("[blank-project] Registered tmp:// filesystem provider");
  }

  const documentSelector = [{ language: "modelica" }];

  // Options to control the language client
  const clientOptions: LanguageClientOptions = {
    documentSelector,
    synchronize: {},
    initializationOptions: {
      extensionUri: context.extensionUri.toString(),
    },
  };

  client = createWorkerLanguageClient(context, clientOptions);

  await client.start();
  console.log("ModelScript language server is ready");

  // Register library tree view (before status handler so we can refresh on ready)
  const treeProvider = new LibraryTreeProvider(client);
  const treeView = vscode.window.createTreeView("modelscript.libraryTree", {
    treeDataProvider: treeProvider,
    canSelectMany: false,
  });
  context.subscriptions.push(treeView);

  // Status bar item to show loading progress
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -100);
  statusItem.text = "$(sync~spin) ModelScript: Loading...";
  statusItem.tooltip = "ModelScript language server is initializing";
  statusItem.show();
  context.subscriptions.push(statusItem);

  // Listen for status notifications from the LSP server
  client.onNotification("modelscript/status", (params: { state: string; message: string }) => {
    switch (params.state) {
      case "loading":
        statusItem.text = `$(sync~spin) ${params.message}`;
        statusItem.tooltip = "ModelScript is loading...";
        break;
      case "ready":
        statusItem.text = "$(check) ModelScript";
        statusItem.tooltip = "ModelScript language server is ready";
        setTimeout(() => statusItem.hide(), 5000);
        // Refresh the library tree now that MSL is loaded
        {
          const activeUri = vscode.window.activeTextEditor?.document.uri.toString();
          if (activeUri) {
            treeProvider.setDocumentUri(activeUri);
          }
        }
        break;
      case "error":
        statusItem.text = `$(warning) ${params.message}`;
        statusItem.tooltip = "ModelScript encountered an error during initialization";
        break;
    }
  });

  // Update tree when active editor changes to a .mo file
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor?.document.languageId === "modelica") {
        treeProvider.setDocumentUri(editor.document.uri.toString());
      }
    }),
  );

  // Register commands
  context.subscriptions.push(
    commands.registerCommand("modelscript.openDiagram", () => {
      if (client) {
        DiagramPanel.createOrShow(context.extensionUri, client);
      }
    }),
    commands.registerCommand("modelscript.openDiagramSource", async () => {
      const uri = DiagramPanel.currentPanel?.sourceUri;
      if (uri) {
        const doc = await workspace.openTextDocument(vscode.Uri.parse(uri));
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
      }
    }),
    commands.registerCommand("modelscript.runSimulation", () => {
      if (client) {
        SimulationPanel.createOrShow(context.extensionUri, client);
      }
    }),
    commands.registerCommand("modelscript.addToDiagram", async (firstArg: unknown, secondArg?: string) => {
      if (!client) return;

      // Support both context menu (LibraryTreeItem) and direct call (className, classKind)
      let className: string;
      let classKind: string;
      if (firstArg && typeof firstArg === "object" && "info" in firstArg) {
        // Called from tree item context menu
        const item = firstArg as { info: { compositeName: string; classKind: string } };
        className = item.info.compositeName;
        classKind = item.info.classKind;
      } else {
        className = firstArg as string;
        classKind = secondArg ?? "";
      }

      // Only allow models, blocks, and connectors
      if (classKind !== "model" && classKind !== "block" && classKind !== "connector") return;

      // Find the active .mo document
      const docUri = DiagramPanel.currentPanel?.sourceUri ?? vscode.window.activeTextEditor?.document.uri.toString();
      if (!docUri) {
        vscode.window.showWarningMessage("Open a Modelica file first.");
        return;
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const edits: any[] = await client.sendRequest("modelscript/addComponent", {
          uri: docUri,
          className,
          x: 0,
          y: 0,
        });
        if (edits && edits.length > 0) {
          const workspaceEdit = new vscode.WorkspaceEdit();
          const uri = vscode.Uri.parse(docUri);
          for (const edit of edits) {
            const range = new vscode.Range(
              edit.range.start.line,
              edit.range.start.character,
              edit.range.end.line,
              edit.range.end.character,
            );
            workspaceEdit.replace(uri, range, edit.newText);
          }
          await vscode.workspace.applyEdit(workspaceEdit);
          vscode.window.showInformationMessage(`Added ${className.split(".").pop()} to model.`);
        }
      } catch (e) {
        console.error("[addToDiagram] Error:", e);
        vscode.window.showErrorMessage(`Failed to add component: ${e}`);
      }
    }),
  );

  // Pre-open all .mo files in the workspace so the LSP server can track them.
  // This is fire-and-forget: don't crash the extension if the filesystem isn't ready.
  initWorkspaceAndTree(treeProvider, treeView).catch((e) => {
    console.warn("[workspace-init] Non-fatal initialization error:", e);
  });
}

export async function deactivate(): Promise<void> {
  if (client !== undefined) {
    await client.stop();
  }
}

function createWorkerLanguageClient(context: vscode.ExtensionContext, clientOptions: LanguageClientOptions) {
  // The server bundle is built into server/dist/ by webpack
  const serverMain = Uri.joinPath(context.extensionUri, "server", "dist", "browserServerMain.js");
  const worker = new Worker(serverMain.toString(true));

  return new LanguageClient("modelscript", "ModelScript Language Server", clientOptions, worker);
}

/**
 * Initialize the workspace: scan for .mo files or create a blank project,
 * then set up the library tree. Retries if the filesystem provider isn't
 * registered yet (e.g. GitHub FS extension still activating).
 */
async function initWorkspaceAndTree(
  treeProvider: LibraryTreeProvider,
  treeView: vscode.TreeView<vscode.TreeItem>,
): Promise<void> {
  const moFiles = await scanWorkspaceFiles();
  if (moFiles.length > 0) {
    treeProvider.setDocumentUri(moFiles[0].toString());
  } else {
    // Blank project: create a default model if the workspace uses the tmp scheme
    const folders = workspace.workspaceFolders;
    if (folders && folders.length > 0 && folders[0].uri.scheme === "tmp") {
      const defaultModel = `model HelloWorld "A simple Modelica model"
  Real x(start = 1);
  parameter Real a = -1;
equation
  der(x) = a * x;
end HelloWorld;
`;
      const fileUri = vscode.Uri.joinPath(folders[0].uri, "HelloWorld.mo");
      try {
        await workspace.fs.writeFile(fileUri, new TextEncoder().encode(defaultModel));
        const doc = await workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(doc);
        treeProvider.setDocumentUri(fileUri.toString());
      } catch (e) {
        console.warn("[blank-project] Failed to create default model:", e);
      }
    }
  }

  // Auto-expand root items after tree data loads
  setTimeout(async () => {
    try {
      const rootItems = await treeProvider.getChildren();
      for (const item of rootItems) {
        await treeView.reveal(item, { expand: true, select: false, focus: false });
      }
    } catch {
      // ignore — tree may not be ready yet
    }
  }, 3000);
}

/**
 * Scan the workspace for all .mo files and open them as text documents.
 * Retries up to 5 times with a 2-second delay if the filesystem provider
 * isn't available yet (e.g. GitHub FS extension still activating).
 */
async function scanWorkspaceFiles(): Promise<vscode.Uri[]> {
  const maxRetries = 5;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const moFiles = await workspace.findFiles("**/*.mo");
      console.log(`[workspace-scan] Found ${moFiles.length} .mo files in workspace`);
      for (const uri of moFiles) {
        try {
          await workspace.openTextDocument(uri);
          console.log(`[workspace-scan] Opened ${uri.path.split("/").pop()}`);
        } catch (e) {
          console.warn(`[workspace-scan] Failed to open ${uri.path}:`, e);
        }
      }
      return moFiles;
    } catch (e) {
      const msg = String(e);
      if (msg.includes("ENOPRO") && attempt < maxRetries - 1) {
        console.log(`[workspace-scan] Filesystem not ready, retrying in 2s (attempt ${attempt + 1}/${maxRetries})...`);
        await new Promise((r) => setTimeout(r, 2000));
      } else {
        console.error("[workspace-scan] Workspace scan failed:", e);
        return [];
      }
    }
  }
  return [];
}
