import * as vscode from "vscode";
import { Uri, commands, workspace } from "vscode";
import { LanguageClientOptions } from "vscode-languageclient";
import { LanguageClient } from "vscode-languageclient/browser";
import { DiagramPanel } from "./diagramPanel";
import { LibraryTreeProvider } from "./libraryTreeProvider";
import { SimulationPanel } from "./simulationPanel";

let client: LanguageClient | undefined;

export async function activate(context: vscode.ExtensionContext) {
  console.log("ModelScript extension activated");

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

  // Register library tree view
  const treeProvider = new LibraryTreeProvider(client);
  const treeView = vscode.window.createTreeView("modelscript.libraryTree", {
    treeDataProvider: treeProvider,
    canSelectMany: false,
  });
  context.subscriptions.push(treeView);

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
