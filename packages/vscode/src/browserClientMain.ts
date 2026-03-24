import * as vscode from "vscode";
import { Uri, commands, workspace } from "vscode";
import { LanguageClientOptions } from "vscode-languageclient";
import { LanguageClient } from "vscode-languageclient/browser";
import { DiagramPanel } from "./diagramPanel";
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
  );

  // Pre-open all .mo files in the workspace so the LSP server can track them
  // for cross-file reference resolution
  scanWorkspaceFiles();
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
 * Scan the workspace for all .mo files and open them as text documents.
 * This triggers textDocument/didOpen notifications to the LSP server,
 * enabling cross-file reference resolution.
 */
async function scanWorkspaceFiles(): Promise<void> {
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
  } catch (e) {
    console.error("[workspace-scan] Workspace scan failed:", e);
  }
}
