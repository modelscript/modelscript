import * as vscode from "vscode";
import { Uri, commands, workspace } from "vscode";
import { LanguageClientOptions } from "vscode-languageclient";
import { LanguageClient } from "vscode-languageclient/browser";
import { AnalysisPanel } from "./analysisPanel";
import { boxTexturedBase64, foxBase64 } from "./cadModels";
import { CadViewerPanel } from "./cadViewerPanel";
import { ChatViewProvider } from "./chatPanel";
import { CosimViewProvider } from "./cosimPanel";
import { ModelScriptDebugSession } from "./debugAdapter";
import { DiagramEditorProvider } from "./diagramEditorProvider";
import { FMU_VIEW_SCHEME, FmuContentProvider, FmuEditorProvider, extractFromZip } from "./fmuDocumentProvider";
import { LibraryTreeProvider } from "./libraryTreeProvider";
import { registerLLMProvider } from "./llmProvider";
import { registerMCPTools } from "./mcpBridge";
import { MqttTreeProvider } from "./mqttTreeProvider";
import { ModelicaNotebookController } from "./notebookController";
import { ModelicaNotebookSerializer } from "./notebookSerializer";
import { RequirementsEditorProvider } from "./requirementsEditorProvider";
import { SysML2PaletteProvider } from "./sysml2PaletteProvider";
import { VerificationPanel } from "./verificationPanel";

import { SimulationPanel } from "./simulationPanel";
import { SINE_WAVE_FMU_BASE64 } from "./sineWaveFmu";
import { SSP_VIEW_SCHEME, SspContentProvider, SspEditorProvider } from "./sspDocumentProvider";

function decodeBase64ToArray(base64: string): Uint8Array {
  // Extract only base64 characters
  const b64 = base64.replace(/[^A-Za-z0-9+/=]/g, "");

  // Calculate unpadded length
  let padding = 0;
  if (b64.endsWith("==")) padding = 2;
  else if (b64.endsWith("=")) padding = 1;
  const bufferLength = b64.length * 0.75 - padding;

  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) {
    lookup[chars.charCodeAt(i)] = i;
  }

  const bytes = new Uint8Array(bufferLength);
  let p = 0;
  for (let i = 0; i < b64.length; i += 4) {
    const encoded1 = lookup[b64.charCodeAt(i)];
    const encoded2 = lookup[b64.charCodeAt(i + 1)];
    const encoded3 = lookup[b64.charCodeAt(i + 2)];
    const encoded4 = lookup[b64.charCodeAt(i + 3)];

    bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
    if (p < bufferLength) bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
    if (p < bufferLength) bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
  }
  return bytes;
}

let client: LanguageClient | undefined;
let fmuContentProvider: FmuContentProvider | undefined;
let sspContentProvider: SspContentProvider | undefined;

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
    // Fall back to open text documents — files created through the VS Code UI may
    // exist only in the text model layer, not yet persisted to our in-memory store.
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.scheme === uri.scheme && d.uri.path === path);
    if (doc) {
      const content = new TextEncoder().encode(doc.getText());
      return { type: vscode.FileType.File, ctime: 0, mtime: Date.now(), size: content.length };
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
    // Fall back to open text documents (see stat() comment above)
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.scheme === uri.scheme && d.uri.path === uri.path);
    if (doc) {
      const content = new TextEncoder().encode(doc.getText());
      // Persist into our store so subsequent reads don't need the fallback
      this.files.set(uri.path, content);
      return content;
    }
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

import { StoppedEvent } from "@vscode/debugadapter";
import { activeDebugSession, setLspDebugCallbacks } from "./debugAdapter";

class InlineDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
  createDebugAdapterDescriptor(session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
    // Keep session around to satisfy TS, though we do not use it
    void session;
    return new vscode.DebugAdapterInlineImplementation(new ModelScriptDebugSession());
  }
}

export async function activate(context: vscode.ExtensionContext) {
  console.log("ModelScript extension activated");

  context.subscriptions.push(
    vscode.debug.registerDebugAdapterDescriptorFactory("modelscript", new InlineDebugAdapterFactory()),
  );

  setLspDebugCallbacks(
    async (program: string) => {
      let uri = program;
      try {
        const doc = vscode.workspace.textDocuments.find((d) => d.uri.path === program || d.fileName === program);
        if (doc) uri = doc.uri.toString();
        else uri = vscode.Uri.file(program).toString();
      } catch {
        /* ignore */
      }
      if (client) {
        const result = await client.sendRequest<{ error?: string }>("modelscript/simulateDebug", { uri });
        if (result && result.error) {
          vscode.window.showErrorMessage(`Debugger failed to start: ${result.error}`);
        }
        return result;
      }
      return { error: "LSP Client not active" };
    },
    async () => {
      if (client) await client.sendRequest("modelscript/debuggerContinue");
    },
    async () => {
      if (client) return client.sendRequest("modelscript/debuggerVariables");
      return [];
    },
    async (program: string, bps: { line: number; column?: number }[]) => {
      let uri = program;
      try {
        const doc = vscode.workspace.textDocuments.find((d) => d.uri.path === program || d.fileName === program);
        if (doc) uri = doc.uri.toString();
        else uri = vscode.Uri.file(program).toString();
      } catch {
        /* ignore */
      }
      if (client) await client.sendNotification("modelscript/setBreakpoints", { uri, breakpoints: bps });
    },
    async () => {
      if (client) await client.sendRequest("modelscript/debuggerContinue", { step: true });
    },
  );

  context.subscriptions
    .push
    // We can't push 'client.onNotification' to subscriptions directly, but we can set it up after client init.
    // In browserClientMain.ts, the client is initialized later, so we'll just wait for it.
    ();

  // Clean up any stale Modelica color overrides persisted by a previous version.
  // VS Code's built-in themes (Dark Modern, Light Modern) already color the LSP's
  // standard semantic token types correctly, matching Morsel's colors.
  const config = workspace.getConfiguration();
  if (config.get("editor.semanticTokenColorCustomizations")) {
    await config.update("editor.semanticTokenColorCustomizations", undefined, vscode.ConfigurationTarget.Global);
  }
  if (config.get("editor.tokenColorCustomizations")) {
    await config.update("editor.tokenColorCustomizations", undefined, vscode.ConfigurationTarget.Global);
  }

  // Register in-memory filesystem for blank project mode (memfs:// scheme)
  const folders = workspace.workspaceFolders;
  if (folders && folders.length > 0 && folders[0].uri.scheme === "memfs") {
    const memFs = new MemoryFileSystemProvider();
    memFs.createDirectory(folders[0].uri);
    context.subscriptions.push(workspace.registerFileSystemProvider("memfs", memFs, { isCaseSensitive: true }));
    console.log("[blank-project] Registered memfs:// filesystem provider");

    // Scaffold template files SYNCHRONOUSLY into the memfs store so they exist
    // before VS Code attempts to restore previously-open editors (including
    // diagram custom editors) from a prior session. Without this, restored editors
    // trigger FileNotFound because initWorkspaceAndTree runs asynchronously later.
    scaffoldTemplateFiles(memFs, folders[0].uri);
  }

  // Register virtual document provider and custom editor for FMU files
  fmuContentProvider = new FmuContentProvider();
  context.subscriptions.push(workspace.registerTextDocumentContentProvider(FMU_VIEW_SCHEME, fmuContentProvider));
  const fmuEditor = new FmuEditorProvider(fmuContentProvider);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(FmuEditorProvider.viewType, fmuEditor, {
      supportsMultipleEditorsPerDocument: false,
      webviewOptions: { retainContextWhenHidden: false },
    }),
  );

  // Register virtual document provider and custom editor for SSP files
  sspContentProvider = new SspContentProvider();
  context.subscriptions.push(workspace.registerTextDocumentContentProvider(SSP_VIEW_SCHEME, sspContentProvider));
  const sspEditor = new SspEditorProvider(sspContentProvider);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(SspEditorProvider.viewType, sspEditor, {
      supportsMultipleEditorsPerDocument: false,
      webviewOptions: { retainContextWhenHidden: false },
    }),
  );

  const documentSelector = [{ language: "modelica" }, { language: "sysml" }, { pattern: "**/*.{js,ts}" }];

  // Options to control the language client
  const lspOutputChannel = vscode.window.createOutputChannel("ModelScript Language Server");
  const clientOptions: LanguageClientOptions = {
    documentSelector,
    synchronize: {},
    initializationOptions: {
      extensionUri: context.extensionUri.toString(),
    },
    outputChannel: lspOutputChannel,
  };

  client = createWorkerLanguageClient(context, clientOptions);

  try {
    await client.start();
    console.log("ModelScript language server is ready");
    lspOutputChannel.appendLine("[client] Language server started successfully");
  } catch (e) {
    console.error("ModelScript language server failed to start:", e);
    lspOutputChannel.appendLine(`[client] Language server FAILED to start: ${e}`);
  }

  client.onNotification("modelscript/debuggerStopped", (params: { uri?: string; line?: number; column?: number }) => {
    if (activeDebugSession) {
      activeDebugSession.lastStoppedUri = params.uri;
      activeDebugSession.lastStoppedLine = params.line;
      activeDebugSession.lastStoppedColumn = params.column;
      activeDebugSession.sendEvent(new StoppedEvent("step", 1));
    }
  });

  // Register AI integration components (proposed APIs — may not be available in web builds)
  try {
    registerLLMProvider(context);
  } catch {
    /* proposed API not available */
  }
  // Note: registerChatParticipant requires a chatParticipants manifest entry — use the custom ChatPanel instead
  try {
    registerMCPTools(context, client);
  } catch {
    /* proposed API not available */
  }

  // Register chat view provider (secondary sidebar)
  if (client) {
    const chatProvider = new ChatViewProvider(context.extensionUri, client);
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatProvider, {
        webviewOptions: { retainContextWhenHidden: true },
      }),
    );
  }

  // Custom chat panel (works without VS Code Chat API / Copilot)
  context.subscriptions.push(
    vscode.commands.registerCommand("modelscript.openChat", () => {
      vscode.commands.executeCommand("modelscript.chat.focus");
    }),
  );

  // Output channel for script execution
  const outputChannel = vscode.window.createOutputChannel("ModelScript Output");
  context.subscriptions.push(outputChannel);

  // Register notebook serializer and controller
  context.subscriptions.push(
    vscode.workspace.registerNotebookSerializer("modelscript-notebook", new ModelicaNotebookSerializer()),
  );
  const notebookController = new ModelicaNotebookController();
  notebookController.client = client;
  context.subscriptions.push(notebookController);

  // Create diagram editor provider (needed before tree registration for drag callback)
  const diagramProvider = new DiagramEditorProvider(context, client);

  // Register library tree view (before status handler so we can refresh on ready)
  const treeProvider = new LibraryTreeProvider(client);
  treeProvider.onDragStart = (data) => {
    diagramProvider.postToActiveWebviews({ type: "startPlacement", ...data });
  };
  const treeView = vscode.window.createTreeView("modelscript.libraryTree", {
    treeDataProvider: treeProvider,
    dragAndDropController: treeProvider,
    canSelectMany: false,
  });
  context.subscriptions.push(treeView);

  // Register MQTT participant tree view
  const mqttTreeProvider = new MqttTreeProvider(client, context);
  const mqttTreeView = vscode.window.createTreeView("modelscript.mqttTree", {
    treeDataProvider: mqttTreeProvider,
    dragAndDropController: mqttTreeProvider,
    canSelectMany: false,
  });
  context.subscriptions.push(mqttTreeView);
  mqttTreeProvider.startPolling();

  // Register SysML2 element palette tree view
  const sysml2PaletteProvider = new SysML2PaletteProvider();
  sysml2PaletteProvider.onDragStart = (data) => {
    diagramProvider.postToActiveWebviews({ type: "startPlacement", ...data });
  };
  const sysml2PaletteView = vscode.window.createTreeView("modelscript.sysml2Palette", {
    treeDataProvider: sysml2PaletteProvider,
    dragAndDropController: sysml2PaletteProvider,
    canSelectMany: false,
  });
  context.subscriptions.push(sysml2PaletteView);

  // Register co-simulation panel (sidebar webview)
  const cosimProvider = new CosimViewProvider(context.extensionUri, client);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CosimViewProvider.viewType, cosimProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

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
        // Auto-refresh UI components now that LSP is fully initialized
        treeProvider.refresh();

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
      // Set context key for SysML2 palette visibility
      vscode.commands.executeCommand("setContext", "modelscript.sysml2Active", editor?.document.languageId === "sysml");
    }),
  );

  // Trigger once for the initially active editor (since the event doesn't fire for the first tab)
  if (vscode.window.activeTextEditor?.document.languageId === "modelica") {
    treeProvider.setDocumentUri(vscode.window.activeTextEditor.document.uri.toString());
  }

  // Register commands
  context.subscriptions.push(
    commands.registerCommand("modelscript.openDiagram", async () => {
      const activeEditor = vscode.window.activeTextEditor;
      if (
        activeEditor &&
        (activeEditor.document.languageId === "modelica" || activeEditor.document.languageId === "sysml")
      ) {
        try {
          // Ensure the file exists on the filesystem before opening the custom editor.
          // In memfs workspaces, files created in the text editor buffer may not be persisted
          // to the MemoryFileSystemProvider yet, causing CustomTextEditorProvider to fail.
          const docUri = activeEditor.document.uri;
          if (docUri.scheme === "memfs") {
            const content = new TextEncoder().encode(activeEditor.document.getText());
            await workspace.fs.writeFile(docUri, content);
          }
          await vscode.commands.executeCommand("vscode.openWith", docUri, DiagramEditorProvider.viewType);
        } catch (e: unknown) {
          vscode.window.showErrorMessage(`Failed to open diagram: ${(e as Error)?.message || e}`);
        }
      }
    }),
    commands.registerCommand("modelscript.openDiagramSource", () => {
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
      if (tab?.input instanceof vscode.TabInputCustom && tab.input.viewType === DiagramEditorProvider.viewType) {
        vscode.commands.executeCommand("vscode.openWith", tab.input.uri, "default");
      }
    }),
    commands.registerCommand("modelscript.openCadViewer", () => {
      if (!client) return;
      CadViewerPanel.createOrShow(context.extensionUri, client);
    }),
    commands.registerCommand("modelscript.runSimulation", async () => {
      if (!client) return;
      const editor = vscode.window.activeTextEditor;
      if (editor?.document.fileName.endsWith(".mos")) {
        outputChannel.clear();
        outputChannel.show(true);
        try {
          const result = await client.sendRequest<{ output: string }>("modelscript/runScript", {
            uri: editor.document.uri.toString(),
          });
          outputChannel.appendLine(result.output || "(no output)");
        } catch (e) {
          outputChannel.appendLine(`Error: ${e}`);
        }
      } else if (editor?.document.uri.scheme === "fmu-view") {
        outputChannel.clear();
        outputChannel.show(true);
        try {
          const name = editor.document.uri.path.replace(/^\//, "");
          const fmuBytes = fmuContentProvider?.getFmuBytes(name);
          if (!fmuBytes) {
            vscode.window.showErrorMessage("FMU data not found in cache.");
            return;
          }
          const jsBytes = extractFromZip(fmuBytes, "resources/model.js");
          if (!jsBytes) {
            vscode.window.showErrorMessage("No resources/model.js found in FMU. Please re-export the FMU.");
            return;
          }

          const jsCode = new TextDecoder().decode(jsBytes);

          // Evaluate the JS inside a safe function
          const FmuModelConstructor = new Function(
            jsCode + "\\nreturn typeof FmuModel !== 'undefined' ? FmuModel : FmuModel;",
          )();
          const inst = new FmuModelConstructor();

          let t = 0.0;
          const dt = 0.01;
          const tStop = 10.0;

          // Collect series data
          const result: { time: number[]; series: Record<string, number[]> } = { time: [], series: {} };
          for (let i = 0; i < inst.vars.length; i++) {
            result.series[`var_${i}`] = [];
          }

          inst.doStep(0, 0); // initial eval
          while (t <= tStop) {
            result.time.push(t);
            for (let i = 0; i < inst.vars.length; i++) {
              result.series[`var_${i}`].push(inst.vars[i]);
            }
            inst.doStep(t, dt);
            t += dt;
          }

          // Remap vars names from scalarVariables via modelDescription inside the text
          // Currently, the model is generated with specific variables, we can just send the raw vars array
          // or parse the text of the editor which contains the Modelica variables.
          // For now, let's parse the virtual document text which has the variables!
          const text = editor.document.getText();
          const varLines = text.split("\\n").filter((line) => line.includes("/* VR="));

          const states: string[] = [];
          const y: number[][] = [];
          for (const line of varLines) {
            const match = line.match(/Real (.*?); \/\* VR=(\d+) \*\//);
            if (match) {
              const name = match[1].trim();
              const vr = parseInt(match[2]);
              states.push(name);
              y.push(result.series[`var_${vr}`] || []);
            }
          }

          // Show Plot
          SimulationPanel.createOrShowWithData(
            context.extensionUri,
            {
              t: result.time,
              states,
              y,
            },
            editor.document.uri.toString(),
          );
          outputChannel.appendLine("FMU (JS) Simulation complete.");
        } catch (e) {
          vscode.window.showErrorMessage(`FMU JavaScript Evaluation Error: ${e}`);
          outputChannel.appendLine(`Error executing JS FMU: ${e}`);
        }
      } else {
        SimulationPanel.createOrShow(context.extensionUri, client);
      }
    }),
    commands.registerCommand("modelscript.exportFmi2", async () => {
      if (!client) return;
      const editor = vscode.window.activeTextEditor;
      if (!editor || !editor.document.fileName.endsWith(".mo")) {
        vscode.window.showErrorMessage("Open a Modelica (.mo) file to export an FMU.");
        return;
      }
      vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Exporting FMI 2.0...", cancellable: false },
        async () => {
          try {
            const res = await client.sendRequest<{ fmuName: string; base64: string }>("modelscript/exportFmu", {
              uri: editor.document.uri.toString(),
              fmiVersion: "2.0",
            });
            const folder = vscode.workspace.workspaceFolders?.[0]?.uri || vscode.Uri.file("/");
            const uri = vscode.Uri.joinPath(folder, res.fmuName + ".fmu");
            await vscode.workspace.fs.writeFile(uri, decodeBase64ToArray(res.base64));
            vscode.window.showInformationMessage(`Exported FMI 2.0 to ${res.fmuName}.fmu`);
          } catch (e) {
            vscode.window.showErrorMessage(`FMI 2.0 Export failed: ${e}`);
          }
        },
      );
    }),
    commands.registerCommand("modelscript.exportFmi3", async () => {
      if (!client) return;
      const editor = vscode.window.activeTextEditor;
      if (!editor || !editor.document.fileName.endsWith(".mo")) {
        vscode.window.showErrorMessage("Open a Modelica (.mo) file to export an FMU.");
        return;
      }
      vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Exporting FMI 3.0...", cancellable: false },
        async () => {
          try {
            const res = await client.sendRequest<{ fmuName: string; base64: string }>("modelscript/exportFmu", {
              uri: editor.document.uri.toString(),
              fmiVersion: "3.0",
            });
            const folder = vscode.workspace.workspaceFolders?.[0]?.uri || vscode.Uri.file("/");
            const uri = vscode.Uri.joinPath(folder, res.fmuName + ".fmu");
            await vscode.workspace.fs.writeFile(uri, decodeBase64ToArray(res.base64));
            vscode.window.showInformationMessage(`Exported FMI 3.0 to ${res.fmuName}.fmu`);
          } catch (e) {
            vscode.window.showErrorMessage(`FMI 3.0 Export failed: ${e}`);
          }
        },
      );
    }),
    commands.registerCommand("modelscript.runVerification", async () => {
      if (!client) return;
      const editor = vscode.window.activeTextEditor;
      if (editor?.document.languageId === "sysml") {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: "Running SysML Requirements Verification..." },
          async () => {
            try {
              if (client && editor)
                await client.sendRequest("modelscript/runVerification", { uri: editor.document.uri.toString() });
            } catch (e: unknown) {
              vscode.window.showErrorMessage(`Verification failed: ${(e as Error).message}`);
            }
          },
        );
      }
    }),
    commands.registerCommand("modelscript.addToDiagram", async (firstArg: unknown, secondArg?: string) => {
      if (!client) return;

      // Support both context menu (LibraryTreeItem / SysML2PaletteItem) and direct call
      let className: string;
      let classKind: string;
      if (firstArg && typeof firstArg === "object" && "info" in firstArg) {
        // Called from Modelica tree item context menu
        const item = firstArg as { info: { compositeName: string; classKind: string; iconSvg?: string } };
        className = item.info.compositeName;
        classKind = item.info.classKind;
      } else if (firstArg && typeof firstArg === "object" && "elementInfo" in firstArg) {
        // Called from SysML2 palette item context menu
        const item = firstArg as { elementInfo: { type: string; element?: { elementType: string } } };
        if (item.elementInfo.type === "element" && item.elementInfo.element) {
          className = item.elementInfo.element.elementType;
          classKind = "sysml2";
        } else {
          return;
        }
      } else {
        className = firstArg as string;
        classKind = secondArg ?? "";
      }

      // SysML2 element handling
      if (classKind === "sysml2") {
        let docUri = vscode.window.activeTextEditor?.document.uri.toString();
        if (!docUri) {
          const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
          if (tab?.input instanceof vscode.TabInputCustom && tab.input.viewType === DiagramEditorProvider.viewType) {
            docUri = tab.input.uri.toString();
          }
        }
        if (!docUri || !docUri.endsWith(".sysml")) {
          vscode.window.showWarningMessage("Open a SysML2 file first.");
          return;
        }

        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const edits: any[] = await client.sendRequest("modelscript/addComponent", {
            uri: docUri,
            className, // This is the elementType (e.g., "PartDefinition")
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
            // Format the type name for display
            const displayName = className.replace(/([A-Z])/g, " $1").trim();
            vscode.window.showInformationMessage(`Added ${displayName} to model.`);
            setTimeout(() => {
              vscode.commands.executeCommand("modelscript.autoLayout");
            }, 600);
          }
        } catch (e) {
          console.error("[addToDiagram] SysML2 Error:", e);
          vscode.window.showErrorMessage(`Failed to add element: ${e}`);
        }
        return;
      }

      // Modelica element handling
      // Only allow models, blocks, and connectors
      if (classKind !== "model" && classKind !== "block" && classKind !== "connector") return;

      // Find the active .mo document
      let docUri = vscode.window.activeTextEditor?.document.uri.toString();
      if (!docUri) {
        const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
        if (tab?.input instanceof vscode.TabInputCustom && tab.input.viewType === DiagramEditorProvider.viewType) {
          docUri = tab.input.uri.toString();
        }
      }
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
          setTimeout(() => {
            vscode.commands.executeCommand("modelscript.autoLayout");
          }, 600);
        }
      } catch (e) {
        console.error("[addToDiagram] Error:", e);
        vscode.window.showErrorMessage(`Failed to add component: ${e}`);
      }
    }),

    // ── Co-Simulation commands ──
    commands.registerCommand("modelscript.cosimConnect", () => {
      cosimProvider.refresh();
      mqttTreeProvider.refresh();
      vscode.window.showInformationMessage("Refreshing co-simulation connections…");
    }),
    commands.registerCommand("modelscript.cosimDisconnect", () => {
      vscode.window.showInformationMessage("MQTT connection managed via the Co-Simulation panel.");
    }),
    commands.registerCommand("modelscript.cosimStartInfra", async () => {
      const cmd = "docker compose up -d mqtt timescaledb api";
      try {
        await vscode.env.clipboard.writeText(cmd);
        vscode.window.showInformationMessage(`Copied to clipboard: ${cmd}`);
      } catch {
        vscode.window.showInformationMessage(`Run in your terminal: ${cmd}`);
      }
    }),
    commands.registerCommand("modelscript.cosimCreateSession", () => {
      vscode.commands.executeCommand("workbench.view.extension.modelscript-cosim");
    }),
    commands.registerCommand("modelscript.cosimPublishModel", () => {
      vscode.window.showInformationMessage("Use the Co-Simulation panel to publish a model to a session.");
    }),
    commands.registerCommand("modelscript.cosimOpenLivePlot", (sessionId?: string, participantId?: string) => {
      if (cosimProvider.isLocalMode) {
        SimulationPanel.createOrShowLiveLocal(context.extensionUri, sessionId);
      } else {
        SimulationPanel.createOrShowLive(context.extensionUri, sessionId, participantId);
      }
    }),
    commands.registerCommand("modelscript.cosimRefresh", () => {
      cosimProvider.refresh();
      mqttTreeProvider.refresh();
    }),
    // ── Analytical commands ──
    commands.registerCommand("modelscript.showClassHierarchy", () => {
      if (!client) return;
      AnalysisPanel.createOrShowHierarchy(context.extensionUri, client);
    }),
    commands.registerCommand("modelscript.analyzeBlt", () => {
      if (!client) return;
      AnalysisPanel.createOrShowBlt(context.extensionUri, client);
    }),
    commands.registerCommand("modelscript.showComponentTree", () => {
      if (!client) return;
      AnalysisPanel.createOrShowComponentTree(context.extensionUri, client);
    }),
    // ── MBSE views: Requirements & V&V ──
    commands.registerCommand("modelscript.openRequirements", async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor?.document.languageId === "sysml") {
        await vscode.commands.executeCommand(
          "vscode.openWith",
          editor.document.uri,
          RequirementsEditorProvider.viewType,
        );
      } else {
        vscode.window.showWarningMessage("Open a SysML file first.");
      }
    }),
    commands.registerCommand("modelscript.openVerificationDashboard", () => {
      if (!client) return;
      VerificationPanel.createOrShow(context.extensionUri, client);
    }),
  );

  // Register the custom editor provider for modelica diagrams
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(DiagramEditorProvider.viewType, diagramProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  // Register the requirements editor for SysML documents
  if (client) {
    const requirementsProvider = new RequirementsEditorProvider(context.extensionUri, client);
    context.subscriptions.push(
      vscode.window.registerCustomEditorProvider(RequirementsEditorProvider.viewType, requirementsProvider, {
        supportsMultipleEditorsPerDocument: true,
        webviewOptions: { retainContextWhenHidden: false },
      }),
    );
  }

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
 * Scaffold template files synchronously into the MemoryFileSystemProvider.
 * Called immediately after registering the memfs provider, before any async
 * operations, so that VS Code's editor restoration can find the files.
 */
function scaffoldTemplateFiles(memFs: MemoryFileSystemProvider, workspaceUri: vscode.Uri): void {
  const encoder = new TextEncoder();
  const template = workspaceUri.path.substring(1) || "empty";
  const templates: Record<string, Record<string, string>> = {
    empty: {
      "HelloWorld.mo": `model HelloWorld "A simple Modelica model"\n  Real x(start = 1);\n  parameter Real a = -1;\nequation\n  der(x) = a * x;\nend HelloWorld;\n`,
    },
    blank: {
      "HelloWorld.mo": `model HelloWorld "A simple Modelica model"\n  Real x(start = 1);\n  parameter Real a = -1;\nequation\n  der(x) = a * x;\nend HelloWorld;\n`,
    },
    "bouncing-ball": {
      "BouncingBall.mo": `model BouncingBall "A bouncing ball"\n  parameter Real e = 0.8 "Coefficient of restitution";\n  parameter Real g = 9.81 "Gravity";\n  Real h(start = 1) "Height";\n  Real v "Velocity";\nequation\n  der(h) = v;\n  der(v) = -g;\n  when h < 0 then\n    reinit(v, -e * pre(v));\n  end when;\nend BouncingBall;\n`,
    },
    rlc: {
      "RLC.mo": [
        'model RLC "RLC circuit with MSL components"',
        "  Modelica.Electrical.Analog.Sources.SineVoltage Vb(V = 10, f = 50)",
        "    annotation(Placement(transformation(origin = {-70, 0}, extent = {{-10, -10}, {10, 10}}, rotation = 270)));",
        "  Modelica.Electrical.Analog.Basic.Inductor L(L = 0.5)",
        "    annotation(Placement(transformation(origin = {0, 40}, extent = {{-10, -10}, {10, 10}})));",
        "  Modelica.Electrical.Analog.Basic.Capacitor C(C = 1e-4)",
        "    annotation(Placement(transformation(origin = {20, 0}, extent = {{-10, -10}, {10, 10}}, rotation = 270)));",
        "  Modelica.Electrical.Analog.Basic.Resistor R(R = 100)",
        "    annotation(Placement(transformation(origin = {60, 0}, extent = {{-10, -10}, {10, 10}}, rotation = 270)));",
        "  Modelica.Electrical.Analog.Basic.Ground ground",
        "    annotation(Placement(transformation(origin = {-70, -40}, extent = {{-10, -10}, {10, 10}})));",
        "equation",
        "  connect(Vb.p, L.p)",
        "    annotation(Line(points = {{-70, 10}, {-70, 40}, {-10, 40}}, color = {0, 0, 255}));",
        "  connect(L.n, C.p)",
        "    annotation(Line(points = {{10, 40}, {20, 40}, {20, 10}}, color = {0, 0, 255}));",
        "  connect(L.n, R.p)",
        "    annotation(Line(points = {{10, 40}, {60, 40}, {60, 10}}, color = {0, 0, 255}));",
        "  connect(R.n, Vb.n)",
        "    annotation(Line(points = {{60, -10}, {60, -30}, {-70, -30}, {-70, -10}}, color = {0, 0, 255}));",
        "  connect(C.n, Vb.n)",
        "    annotation(Line(points = {{20, -10}, {20, -30}, {-70, -30}, {-70, -10}}, color = {0, 0, 255}));",
        "  connect(Vb.n, ground.p)",
        "    annotation(Line(points = {{-70, -10}, {-70, -30}}, color = {0, 0, 255}));",
        "end RLC;",
        "",
      ].join("\n"),
    },
    "cad-assembly": {
      "RobotAssembly.mo": [
        'model RobotAssembly "3D CAD Robot Assembly"',
        "  // Base of the robot",
        '  Real base_angle = 0 "Base rotation angle";',
        '  Real base annotation(CAD(uri="Fox.glb", position={0, 0, 0}, scale={0.02, 0.02, 0.02}));',
        "",
        "  // A payload block",
        '  Real payload annotation(CAD(uri="BoxTextured.glb", position={2, 0, 2}, scale={0.5, 0.5, 0.5}));',
        "",
        "  // An interactive port attachment point",
        '  Real target annotation(CADPort(feature="TargetArea", offsetPosition={2, 1, 2}));',
        "equation",
        "  base = 0;",
        "  payload = 1;",
        "  target = 2;",
        "end RobotAssembly;",
        "",
      ].join("\n"),
    },
    sysml2: {
      "VehicleSystem.sysml": [
        "package VehicleSystem {",
        "",
        "  // ── Port Definitions ──",
        "  port def TorquePort {",
        "    attribute torqueValue : Real;",
        "  }",
        "",
        "  port def ElectricalPort {",
        "    attribute voltage : Real;",
        "    attribute current : Real;",
        "  }",
        "",
        "  port def FuelPort {",
        "    attribute flowRate : Real;",
        "  }",
        "",
        "  // ── Part Definitions ──",
        "  part def Engine {",
        "    attribute horsePower : Real;",
        "    attribute displacement : Real;",
        "",
        "    port torqueOut : TorquePort;",
        "    port fuelIn : FuelPort;",
        "  }",
        "",
        "  part def Transmission {",
        "    attribute gearRatio : Real;",
        "    attribute numberOfGears : Integer;",
        "",
        "    port torqueIn : TorquePort;",
        "    port torqueOut : TorquePort;",
        "  }",
        "",
        "  part def Battery {",
        "    attribute capacity : Real;",
        "    attribute voltage : Real;",
        "",
        "    port electricalOut : ElectricalPort;",
        "  }",
        "",
        "  part def BrakeSystem {",
        "    attribute maxBrakingForce : Real;",
        "    attribute absEnabled : Boolean;",
        "  }",
        "",
        "  part def Wheel {",
        "    attribute diameter : Real;",
        "    attribute tirePressure : Real;",
        "  }",
        "",
        "  part def FuelTank {",
        "    attribute capacity : Real;",
        "",
        "    port fuelOut : FuelPort;",
        "  }",
        "",
        "  // ── Top-Level Vehicle ──",
        "  part def Vehicle {",
        "    attribute mass : Real;",
        "    attribute topSpeed : Real;",
        "",
        "    part engine : Engine;",
        "    part transmission : Transmission;",
        "    part battery : Battery;",
        "    part brakes : BrakeSystem;",
        "    part frontLeft : Wheel;",
        "    part fuelTank : FuelTank;",
        "",
        "    connect engine.torqueOut to transmission.torqueIn;",
        "    connect fuelTank.fuelOut to engine.fuelIn;",
        "  }",
        "",
        "  // ── Actors & Use Cases ──",
        "",
        "  part def Driver { doc /* Primary operator. */ }",
        "  part def Mechanic { doc /* Service technician. */ }",
        "  part def FleetManager { doc /* Oversees fleet. */ }",
        "  part def Passenger { doc /* Rides vehicle. */ }",
        "  part def ChargingStation { doc /* Recharges battery. */ }",
        "  part def Pedestrian { doc /* External actor. */ }",
        "",
        "  use case def DriveVehicle {",
        "    subject vehicle : Vehicle;",
        "    actor driver : Driver;",
        "    include use case startUp : StartVehicle;",
        "    include use case navigate : NavigateRoute;",
        "  }",
        "",
        "  use case def StartVehicle {",
        "    subject vehicle : Vehicle;",
        "    actor driver : Driver;",
        "  }",
        "",
        "  use case def NavigateRoute {",
        "    subject vehicle : Vehicle;",
        "    actor driver : Driver;",
        "  }",
        "",
        "  use case def PerformMaintenance {",
        "    subject vehicle : Vehicle;",
        "    actor mechanic : Mechanic;",
        "  }",
        "",
        "  use case def MonitorFleet {",
        "    actor manager : FleetManager;",
        "  }",
        "",
        "  use case def ChargeVehicle {",
        "    subject vehicle : Vehicle;",
        "    actor driver : Driver;",
        "    actor station : ChargingStation;",
        "  }",
        "",
        "  use case def UpdateSoftware {",
        "    subject vehicle : Vehicle;",
        "    actor mechanic : Mechanic;",
        "  }",
        "",
        "  use case def AdjustClimateControl {",
        "    subject vehicle : Vehicle;",
        "    actor passenger : Passenger;",
        "  }",
        "",
        "  use case def DetectObstacle {",
        "    subject vehicle : Vehicle;",
        "    actor pedestrian : Pedestrian;",
        "    actor driver : Driver;",
        "  }",
        "}",
        "",
        "// ── Behavior ──",
        "package VehicleBehavior {",
        "",
        "  action def StartEngine {",
        "    in ignitionSignal : Boolean;",
        "    out engineRunning : Boolean;",
        "  }",
        "",
        "  action def Accelerate {",
        "    in throttlePosition : Real;",
        "    out newSpeed : Real;",
        "  }",
        "",
        "  action def Brake {",
        "    in brakeForce : Real;",
        "    out newSpeed : Real;",
        "  }",
        "",
        "  state def VehicleStates {",
        "    state off;",
        "    state idle;",
        "    state driving;",
        "",
        "    transition off_to_idle",
        "      first off",
        "      then idle;",
        "",
        "    transition idle_to_driving",
        "      first idle",
        "      then driving;",
        "  }",
        "",
        "}",
        "",
        "// ── Requirements ──",
        "package VehicleRequirements {",
        "",
        "  requirement def MassRequirement {",
        "    doc /* Total mass shall not exceed 2000 kg. */",
        "    attribute maxMass : Real;",
        "  }",
        "",
        "  requirement def SafetyRequirement {",
        "    doc /* Vehicle shall pass NCAP 5-star rating. */",
        "    attribute minRating : Integer;",
        "  }",
        "",
        "  requirement def PerformanceRequirement {",
        "    doc /* 0-100 km/h in under 6 seconds. */",
        "    attribute targetTime : Real;",
        "  }",
        "",
        "}",
        "",
        "// ── Analysis ──",
        "package VehicleAnalysis {",
        "",
        "  calc def TotalMass {",
        "    in bodyMass : Real;",
        "    in drivetrainMass : Real;",
        "    return : Real;",
        "    bodyMass + drivetrainMass",
        "  }",
        "",
        "  constraint def MaxMassConstraint {",
        "    1500 + 200 <= 2000",
        "  }",
        "",
        "}",
        "",

        "// ── Integration ──",
        "package VehicleIntegration {",
        "  part vehicle : VehicleSystem::Vehicle;",
        "  satisfy VehicleRequirements::MassRequirement by vehicle;",
        "  satisfy VehicleRequirements::SafetyRequirement by vehicle;",
        "}",
        "",
      ].join("\n"),
    },
    fmi2: {
      "System.mo":
        [
          "model System",
          "  Real x(start=1.0);",
          "  Real v(start=0.0);",
          "equation",
          "  der(x) = v;",
          "  der(v) = -x;",
          "end System;",
        ].join("\n") + "\n",
    },
    fmi3: {
      "System.mo":
        [
          "model System",
          "  Real x(start=1.0);",
          "  Real v(start=0.0);",
          "equation",
          "  der(x) = v;",
          "  der(v) = -x;",
          "end System;",
        ].join("\n") + "\n",
    },
    script: {
      "simulate.mos": `// A simple Modelica script\nloadString("\nmodel HelloWorld\n  Real x(start=1);\nequation\n  der(x) = -x;\nend HelloWorld;\n");\n\nsimulate(HelloWorld, stopTime=5);\n`,
    },
    "mbse-verification": {
      "SystemVerification.sysml": [
        "package SystemVerification {",
        "  requirement def MaxVoltageReq {",
        "    doc /* Maximum voltage across the capacitor shall not exceed 8.0 V */",
        "    attribute maxLimit : Real = 8.0;",
        "  }",
        "",
        "  part def RCCircuitSys {",
        "    // This part is allocated to the Modelica class 'Circuit'",
        "  }",
        "",
        "  // The actual constraint that is verified against the simulation results",
        "  analysis def VerifyVoltage {",
        "    subject circuit : RCCircuitSys;",
        "    objective req : MaxVoltageReq;",
        "    ",
        "    constraint max_v {",
        "      circuit.C.v <= req.maxLimit",
        "    }",
        "  }",
        "}",
        "",
      ].join("\n"),
      "Circuit.mo": [
        'model Circuit "RC Circuit implementation"',
        '  annotation(SysML(implements="SystemVerification::RCCircuitSys"));',
        "  ",
        "  Modelica.Electrical.Analog.Sources.StepVoltage source(V=10, startTime=0.1);",
        "  Modelica.Electrical.Analog.Basic.Resistor R(R=10);",
        "  Modelica.Electrical.Analog.Basic.Capacitor C(C=0.1);",
        "  Modelica.Electrical.Analog.Basic.Ground ground;",
        "equation",
        "  connect(source.p, R.p);",
        "  connect(R.n, C.p);",
        "  connect(C.n, source.n);",
        "  connect(source.n, ground.p);",
        "end Circuit;",
        "",
      ].join("\n"),
      "VerificationReport.md": [
        "# RC Circuit Verification",
        "",
        "This is an automated verification report for the RC Circuit.",
        "",
        "## System Requirements",
        '::requirements{target="SystemVerification"}',
        "",
        "## System Architecture",
        '::diagram{target="Circuit"}',
        "",
        "The current maximum limit for the capacitor voltage is: {{ SystemVerification.MaxVoltageReq.maxLimit }} V.",
        "",
      ].join("\n"),
    },
  };

  const files = templates[template];
  if (files) {
    for (const [name, content] of Object.entries(files)) {
      const fileUri = Uri.joinPath(workspaceUri, name);
      memFs.writeFile(fileUri, encoder.encode(content));
    }
    console.log(`[blank-project] Scaffolded ${Object.keys(files).length} template file(s) for '${template}'`);
  }
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
  const folders = workspace.workspaceFolders;

  // For memfs workspaces, skip the file scan entirely — VS Code has no search
  // provider for memfs, so workspace.findFiles() hangs indefinitely.
  // Go straight to template scaffolding.
  if (folders && folders.length > 0 && folders[0].uri.scheme === "memfs") {
    const workspaceUri = folders[0].uri;
    try {
      const template = workspaceUri.path.substring(1) || "empty";

      let filename = "";
      let content = "";

      switch (template) {
        case "empty":
        case "blank":
          filename = "HelloWorld.mo";
          content = `model HelloWorld "A simple Modelica model"\n  Real x(start = 1);\n  parameter Real a = -1;\nequation\n  der(x) = a * x;\nend HelloWorld;\n`;
          break;
        case "bouncing-ball":
          filename = "BouncingBall.mo";
          content = `model BouncingBall "A bouncing ball"\n  parameter Real e = 0.8 "Coefficient of restitution";\n  parameter Real g = 9.81 "Gravity";\n  Real h(start = 1) "Height";\n  Real v "Velocity";\nequation\n  der(h) = v;\n  der(v) = -g;\n  when h < 0 then\n    reinit(v, -e * pre(v));\n  end when;\nend BouncingBall;\n`;
          break;
        case "rlc":
          filename = "RLC.mo";
          content = [
            'model RLC "RLC circuit with MSL components"',
            "  Modelica.Electrical.Analog.Sources.SineVoltage Vb(V = 10, f = 50)",
            "    annotation(Placement(transformation(origin = {-70, 0}, extent = {{-10, -10}, {10, 10}}, rotation = 270)));",
            "  Modelica.Electrical.Analog.Basic.Inductor L(L = 0.5)",
            "    annotation(Placement(transformation(origin = {0, 40}, extent = {{-10, -10}, {10, 10}})));",
            "  Modelica.Electrical.Analog.Basic.Capacitor C(C = 1e-4)",
            "    annotation(Placement(transformation(origin = {20, 0}, extent = {{-10, -10}, {10, 10}}, rotation = 270)));",
            "  Modelica.Electrical.Analog.Basic.Resistor R(R = 100)",
            "    annotation(Placement(transformation(origin = {60, 0}, extent = {{-10, -10}, {10, 10}}, rotation = 270)));",
            "  Modelica.Electrical.Analog.Basic.Ground ground",
            "    annotation(Placement(transformation(origin = {-70, -40}, extent = {{-10, -10}, {10, 10}})));",
            "equation",
            "  connect(Vb.p, L.p)",
            "    annotation(Line(points = {{-70, 10}, {-70, 40}, {-10, 40}}, color = {0, 0, 255}));",
            "  connect(L.n, C.p)",
            "    annotation(Line(points = {{10, 40}, {20, 40}, {20, 10}}, color = {0, 0, 255}));",
            "  connect(L.n, R.p)",
            "    annotation(Line(points = {{10, 40}, {60, 40}, {60, 10}}, color = {0, 0, 255}));",
            "  connect(R.n, Vb.n)",
            "    annotation(Line(points = {{60, -10}, {60, -30}, {-70, -30}, {-70, -10}}, color = {0, 0, 255}));",
            "  connect(C.n, Vb.n)",
            "    annotation(Line(points = {{20, -10}, {20, -30}, {-70, -30}, {-70, -10}}, color = {0, 0, 255}));",
            "  connect(Vb.n, ground.p)",
            "    annotation(Line(points = {{-70, -10}, {-70, -30}}, color = {0, 0, 255}));",
            "end RLC;",
            "",
          ].join("\n");
          break;
        case "cad-assembly":
          filename = "RobotAssembly.mo";
          content = [
            'model RobotAssembly "3D CAD Robot Assembly"',
            "  // Base of the robot",
            '  Real base_angle = 0 "Base rotation angle";',
            '  Real base annotation(CAD(uri="Fox.glb", position={0, 0, 0}, scale={0.02, 0.02, 0.02}));',
            "",
            "  // A payload block",
            '  Real payload annotation(CAD(uri="BoxTextured.glb", position={2, 0, 2}, scale={0.5, 0.5, 0.5}));',
            "",
            "  // An interactive port attachment point",
            '  Real target annotation(CADPort(feature="TargetArea", offsetPosition={2, 1, 2}));',
            "equation",
            "  base = 0;",
            "  payload = 1;",
            "  target = 2;",
            "end RobotAssembly;",
            "",
          ].join("\n");

          await workspace.fs.writeFile(Uri.joinPath(workspaceUri, "Fox.glb"), decodeBase64ToArray(foxBase64));
          await workspace.fs.writeFile(
            Uri.joinPath(workspaceUri, "BoxTextured.glb"),
            decodeBase64ToArray(boxTexturedBase64),
          );
          break;
        case "sysml2":
          filename = "VehicleSystem.sysml";
          content = [
            "package VehicleSystem {",
            "",
            "  // ── Port Definitions ──",
            "  port def TorquePort {",
            "    attribute torqueValue : Real;",
            "  }",
            "",
            "  port def ElectricalPort {",
            "    attribute voltage : Real;",
            "    attribute current : Real;",
            "  }",
            "",
            "  port def FuelPort {",
            "    attribute flowRate : Real;",
            "  }",
            "",
            "  // ── Part Definitions ──",
            "  part def Engine {",
            "    attribute horsePower : Real;",
            "    attribute displacement : Real;",
            "",
            "    port torqueOut : TorquePort;",
            "    port fuelIn : FuelPort;",
            "  }",
            "",
            "  part def Transmission {",
            "    attribute gearRatio : Real;",
            "    attribute numberOfGears : Integer;",
            "",
            "    port torqueIn : TorquePort;",
            "    port torqueOut : TorquePort;",
            "  }",
            "",
            "  part def Battery {",
            "    attribute capacity : Real;",
            "    attribute voltage : Real;",
            "",
            "    port electricalOut : ElectricalPort;",
            "  }",
            "",
            "  part def BrakeSystem {",
            "    attribute maxBrakingForce : Real;",
            "    attribute absEnabled : Boolean;",
            "  }",
            "",
            "  part def Wheel {",
            "    attribute diameter : Real;",
            "    attribute tirePressure : Real;",
            "  }",
            "",
            "  part def FuelTank {",
            "    attribute capacity : Real;",
            "",
            "    port fuelOut : FuelPort;",
            "  }",
            "",
            "  // ── Top-Level Vehicle ──",
            "  part def Vehicle {",
            "    attribute mass : Real;",
            "    attribute topSpeed : Real;",
            "",
            "    part engine : Engine;",
            "    part transmission : Transmission;",
            "    part battery : Battery;",
            "    part brakes : BrakeSystem;",
            "    part frontLeft : Wheel;",
            "    part fuelTank : FuelTank;",
            "",
            "    connect engine.torqueOut to transmission.torqueIn;",
            "    connect fuelTank.fuelOut to engine.fuelIn;",
            "  }",
            "",
            "  // ── Actors & Use Cases ──",
            "",
            "  part def Driver { doc /* Primary operator. */ }",
            "  part def Mechanic { doc /* Service technician. */ }",
            "  part def FleetManager { doc /* Oversees fleet. */ }",
            "  part def Passenger { doc /* Rides vehicle. */ }",
            "  part def ChargingStation { doc /* Recharges battery. */ }",
            "  part def Pedestrian { doc /* External actor. */ }",
            "",
            "  use case def DriveVehicle {",
            "    subject vehicle : Vehicle;",
            "    actor driver : Driver;",
            "    include use case startUp : StartVehicle;",
            "    include use case navigate : NavigateRoute;",
            "  }",
            "",
            "  use case def StartVehicle {",
            "    subject vehicle : Vehicle;",
            "    actor driver : Driver;",
            "  }",
            "",
            "  use case def NavigateRoute {",
            "    subject vehicle : Vehicle;",
            "    actor driver : Driver;",
            "  }",
            "",
            "  use case def PerformMaintenance {",
            "    subject vehicle : Vehicle;",
            "    actor mechanic : Mechanic;",
            "  }",
            "",
            "  use case def MonitorFleet {",
            "    actor manager : FleetManager;",
            "  }",
            "",
            "  use case def ChargeVehicle {",
            "    subject vehicle : Vehicle;",
            "    actor driver : Driver;",
            "    actor station : ChargingStation;",
            "  }",
            "",
            "  use case def UpdateSoftware {",
            "    subject vehicle : Vehicle;",
            "    actor mechanic : Mechanic;",
            "  }",
            "",
            "  use case def AdjustClimateControl {",
            "    subject vehicle : Vehicle;",
            "    actor passenger : Passenger;",
            "  }",
            "",
            "  use case def DetectObstacle {",
            "    subject vehicle : Vehicle;",
            "    actor pedestrian : Pedestrian;",
            "    actor driver : Driver;",
            "  }",
            "}",
            "",
            "// ── Behavior ──",
            "package VehicleBehavior {",
            "",
            "  action def StartEngine {",
            "    in ignitionSignal : Boolean;",
            "    out engineRunning : Boolean;",
            "  }",
            "",
            "  action def Accelerate {",
            "    in throttlePosition : Real;",
            "    out newSpeed : Real;",
            "  }",
            "",
            "  action def Brake {",
            "    in brakeForce : Real;",
            "    out newSpeed : Real;",
            "  }",
            "",
            "  state def VehicleStates {",
            "    state off;",
            "    state idle;",
            "    state driving;",
            "",
            "    transition off_to_idle",
            "      first off",
            "      then idle;",
            "",
            "    transition idle_to_driving",
            "      first idle",
            "      then driving;",
            "  }",
            "",
            "}",
            "",
            "// ── Requirements ──",
            "package VehicleRequirements {",
            "",
            "  requirement def MassRequirement {",
            "    doc /* Total mass shall not exceed 2000 kg. */",
            "    attribute maxMass : Real;",
            "  }",
            "",
            "  requirement def SafetyRequirement {",
            "    doc /* Vehicle shall pass NCAP 5-star rating. */",
            "    attribute minRating : Integer;",
            "  }",
            "",
            "  requirement def PerformanceRequirement {",
            "    doc /* 0-100 km/h in under 6 seconds. */",
            "    attribute targetTime : Real;",
            "  }",
            "",
            "}",
            "",
            "// ── Analysis ──",
            "package VehicleAnalysis {",
            "",
            "  calc def TotalMass {",
            "    in bodyMass : Real;",
            "    in drivetrainMass : Real;",
            "    return : Real;",
            "    bodyMass + drivetrainMass",
            "  }",
            "",
            "  constraint def MaxMassConstraint {",
            "    1500 + 200 <= 2000",
            "  }",
            "",
            "}",
            "",

            "// ── Integration ──",
            "package VehicleIntegration {",
            "  part vehicle : VehicleSystem::Vehicle;",
            "  satisfy VehicleRequirements::MassRequirement by vehicle;",
            "  satisfy VehicleRequirements::SafetyRequirement by vehicle;",
            "}",
            "",
          ].join("\n");
          break;
        case "mbse-verification":
          filename = "SystemVerification.sysml";
          content = [
            "package SystemVerification {",
            "  requirement def MaxVoltageReq {",
            "    doc /* Maximum voltage across the capacitor shall not exceed 8.0 V */",
            "    attribute maxLimit : Real = 8.0;",
            "  }",
            "",
            "  // The actual constraint that is verified against the simulation results",
            "  analysis def VerifyVoltage {",
            "    subject circuit : Circuit;",
            "    objective req : MaxVoltageReq;",
            "    ",
            "    constraint max_v {",
            "      circuit.v <= req.maxLimit",
            "    }",
            "  }",
            "}",
            "",
          ].join("\n");
          // Write the second file directly here
          await workspace.fs.writeFile(
            Uri.joinPath(workspaceUri, "Circuit.mo"),
            new TextEncoder().encode(
              [
                'model Circuit "RC Circuit implementation"',
                "  ",
                "  Real v(start=0);",
                "  parameter Real R = 10;",
                "  parameter Real C = 0.1;",
                "  parameter Real V_source = 10;",
                "equation",
                "  der(v) = (V_source - v) / (R * C);",
                "end Circuit;",
                "",
              ].join("\n"),
            ),
          );
          await workspace.fs.writeFile(
            Uri.joinPath(workspaceUri, "VerificationReport.md"),
            new TextEncoder().encode(
              [
                "# RC Circuit Verification",
                "",
                "This is an automated verification report for the RC Circuit.",
                "",
                "## System Requirements",
                '::requirements{target="SystemVerification"}',
                "",
                "## System Architecture",
                '::diagram{target="Circuit"}',
                "",
                "The current maximum limit for the capacitor voltage is: {{ SystemVerification.MaxVoltageReq.maxLimit }} V.",
                "",
              ].join("\n"),
            ),
          );
          break;
        case "script":
          filename = "simulate.mos";
          content = `// A simple Modelica script\nloadString("\nmodel HelloWorld\n  Real x(start=1);\nequation\n  der(x) = -x;\nend HelloWorld;\n");\n\nsimulate(HelloWorld, stopTime=5);\n`;
          break;
        case "notebook":
          filename = "demo.monb";
          content = JSON.stringify(
            {
              cells: [
                {
                  cell_type: "markdown",
                  source: [
                    "# Modelica Notebooks",
                    "",
                    "Welcome to ModelScript Notebooks! Create models and simulate them directly.",
                  ],
                },
                {
                  cell_type: "code",
                  source: ["model Simple", "  Real x(start = 1);", "equation", "  der(x) = -x;", "end Simple;"],
                },
              ],
            },
            null,
            2,
          );
          break;
        case "cosim": {
          // Co-simulation example: Controller (Modelica) + SineWave (WASM FMU)
          const encoder = new TextEncoder();

          const controllerMo = [
            'model Controller "Simple PI controller"',
            '  Modelica.Blocks.Interfaces.RealInput u "Measurement input";',
            '  Modelica.Blocks.Interfaces.RealOutput y "Control output";',
            '  parameter Real Kp = 2.0 "Proportional gain";',
            '  parameter Real Ki = 0.5 "Integral gain";',
            '  parameter Real setpoint = 1.0 "Reference setpoint";',
            '  Real error "Tracking error";',
            '  Real integral(start = 0) "Integral of error";',
            "equation",
            "  error = setpoint - u;",
            "  der(integral) = error;",
            "  y = Kp * error + Ki * integral;",
            "end Controller;",
            "",
          ].join("\n");

          const readmeMd = [
            "# Co-Simulation Example",
            "",
            "This workspace demonstrates co-simulation between a **Modelica model** and a **WASM FMU**.",
            "",
            "## Files",
            "",
            "| File | Type | Description |",
            "|------|------|-------------|",
            "| `Controller.mo` | Modelica | PI controller with setpoint tracking |",
            "| `SineWave.fmu` | FMU 2.0 (WASM) | Sine wave generator compiled to WebAssembly |",
            "| `CosimSetup.mo` | Modelica | Wiring diagram connecting Controller ↔ SineWave |",
            "",
            "## Running the Co-Simulation",
            "",
            "1. Open the **Co-Simulation** panel in the sidebar",
            '2. Click **"Browser-Local"** to enable local mode',
            "3. Create a new session (start=0, stop=10, step=0.01)",
            "4. Open `Controller.mo` and click **Publish Model**",
            "5. Click **Publish FMU** and select `SineWave.fmu`",
            "6. Add couplings:",
            "   - Controller.y → SineWave.phase (control signal)",
            "   - SineWave.y → Controller.u (measurement feedback)",
            "7. Click **Start** to run the coupled simulation",
            "8. Open **Live Plot** to see real-time results",
            "",
            "## SineWave WASM FMU",
            "",
            "The `SineWave.fmu` is a real WebAssembly FMU containing compiled C code.",
            "It demonstrates native WASM execution in the browser via the FMI 2.0 API.",
            "",
            "Model: `y(t) = amplitude * sin(2π * frequency * t + phase)`",
            "",
            "| Variable | Causality | Default |",
            "|----------|-----------|---------|",
            "| amplitude | parameter | 1.0 |",
            "| frequency | parameter | 1.0 Hz |",
            "| phase | input | 0.0 rad |",
            "| y | output | — |",
            "",
          ].join("\n");

          // Decode the embedded SineWave WASM FMU from base64
          const sineWaveFmuBytes = Uint8Array.from(atob(SINE_WAVE_FMU_BASE64), (c) => c.charCodeAt(0));

          // Write all files
          const controllerUri = Uri.joinPath(workspaceUri, "Controller.mo");
          const sineWaveFmuUri = Uri.joinPath(workspaceUri, "SineWave.fmu");
          const readmeUri = Uri.joinPath(workspaceUri, "README.md");

          const cosimSetupMo = [
            'model CosimSetup "Co-simulation wiring diagram"',
            "  Controller controller;",
            "  SineWave sineWave;",
            "equation",
            "  connect(controller.y, sineWave.phase);",
            "  connect(sineWave.y, controller.u);",
            "end CosimSetup;",
            "",
          ].join("\n");

          const cosimSetupUri = Uri.joinPath(workspaceUri, "CosimSetup.mo");

          await workspace.fs.writeFile(controllerUri, encoder.encode(controllerMo));
          await workspace.fs.writeFile(sineWaveFmuUri, sineWaveFmuBytes);
          await workspace.fs.writeFile(cosimSetupUri, encoder.encode(cosimSetupMo));
          await workspace.fs.writeFile(readmeUri, encoder.encode(readmeMd));

          // Register the SineWave FMU with the virtual document provider
          fmuContentProvider?.registerFmu("SineWave", sineWaveFmuBytes);

          // Register the SineWave FMU with the LSP after client is ready
          // (deferred to allow LSP to finish initializing)
          setTimeout(async () => {
            if (client) {
              try {
                await client.sendRequest("modelscript/registerFmu", {
                  name: "SineWave",
                  data: SINE_WAVE_FMU_BASE64,
                });
                console.log("[cosim-template] Registered SineWave FMU with LSP");
              } catch (e) {
                console.warn("[cosim-template] Failed to register FMU:", e);
              }
            }
          }, 2000);

          // Open the co-sim setup model as the primary file
          filename = "CosimSetup.mo";
          content = cosimSetupMo;

          // Also open the controller
          const controllerDoc = await workspace.openTextDocument(controllerUri);
          await vscode.window.showTextDocument(controllerDoc, { preview: false });
          break;
        }
        case "uns-mqtt": {
          const encoder = new TextEncoder();
          filename = "DigitalTwin.mo";
          content = [
            'model DigitalTwin "Real-Time Digital Twin with UNS/MQTT"',
            '  // 1. Open the Co-Simulation panel and check "Browser-Local" mode.',
            '  // 2. Click "Custom..." and create a session with a huge Stop Time (e.g., 86400).',
            '  // 3. Click "+ Add Participant", then "From Open .mo File".',
            "  // 4. Connect the Vite/React HMI to ws://localhost:9001 or use the provided HTML HMI.",
            "",
            '  parameter Real target_speed = 10.0 "Override via: .../cmd/DigitalTwin/target_speed";',
            '  Real speed(start=0) "Telemetry published to: .../data/DigitalTwin/speed";',
            "equation",
            "  der(speed) = (target_speed - speed) * 1.5;",
            "end DigitalTwin;\n",
          ].join("\n");

          const hmiHtml = [
            "<!DOCTYPE html>",
            "<html><head><title>HMI</title>",
            '<script src="https://unpkg.com/mqtt/dist/mqtt.min.js"></script>',
            "<style>body{font-family:sans-serif;text-align:center;padding-top:50px;} h1{font-size:3rem;}</style>",
            "</head><body>",
            "<h2>Conveyor Speed</h2>",
            '<h1 id="speed">0.00</h1>',
            "<p>Live telemetry via MQTT Unified Namespace</p>",
            "<script>",
            "  // Connect to embedded ModelScript MQTT broker",
            '  const client = mqtt.connect("ws://localhost:9001");',
            '  client.on("connect", () => {',
            '    console.log("Connected to broker");',
            '    client.subscribe("modelscript/site/default/area/default/line/session1/cell/DigitalTwin/data/speed");',
            "  });",
            '  client.on("message", (t, m) => {',
            '    document.getElementById("speed").innerText = parseFloat(m.toString()).toFixed(2);',
            "  });",
            "</script>",
            "</body></html>",
          ].join("\n");

          const readmeMd = [
            "# UNS / Real-Time MQTT Example",
            "",
            "This workspace demonstrates how to stream live telemetry from a Modelica simulation directly to an external HMI web app.",
            "",
            "## Running the Co-Simulation",
            "",
            "1. Open the **Co-Simulation** panel in the sidebar",
            '2. Click **"Browser-Local"** to enable local mode (starts the embedded broker)',
            "3. Click **Custom...** to create a new session:",
            "   - Set **Stop Time** to `86400` (1 day) so it runs continuously",
            "   - Click **Create**",
            "4. With `DigitalTwin.mo` open in the editor, click **+ Add Participant** -> **From Open .mo File**",
            "5. Click **Start**",
            "",
            "## Viewing the HMI",
            "",
            "Open `hmi.html` in your browser or run a live server. It connects directly to the embedded MQTT broker in the IDE and subscribes to the unified namespace.",
          ].join("\n");

          const hmiUri = Uri.joinPath(workspaceUri, "hmi.html");
          const readmeUri = Uri.joinPath(workspaceUri, "README.md");
          await workspace.fs.writeFile(hmiUri, encoder.encode(hmiHtml));
          await workspace.fs.writeFile(readmeUri, encoder.encode(readmeMd));
          break;
        }
      }

      if (filename && content) {
        const fileUri = Uri.joinPath(workspaceUri, filename);
        await workspace.fs.writeFile(fileUri, new TextEncoder().encode(content));
        if (filename.endsWith(".monb")) {
          await vscode.commands.executeCommand("vscode.openWith", fileUri, "modelscript-notebook");
        } else {
          const doc = await workspace.openTextDocument(fileUri);
          await vscode.window.showTextDocument(doc);
          if (filename.endsWith(".mo")) {
            treeProvider.setDocumentUri(fileUri.toString());
          }
        }

        if (template === "mbse-verification") {
          try {
            const mdUri = Uri.joinPath(workspaceUri, "VerificationReport.md");
            const mdDoc = await workspace.openTextDocument(mdUri);
            await vscode.window.showTextDocument(mdDoc, { viewColumn: 2, preview: false });
          } catch {
            console.warn("Could not open VerificationReport.md side-by-side");
          }
        }
      }
    } catch (e: unknown) {
      console.error("[blank-project] Failed to create template model:", e);
      vscode.window.showErrorMessage(
        "Workspace Init Error: " + (e instanceof Error ? e.stack || e.message : String(e)),
      );
    }
  } else {
    // For non-memfs workspaces (e.g. GitHub repos), scan for existing .mo files
    const moFiles = await scanWorkspaceFiles();
    if (moFiles.length > 0) {
      treeProvider.setDocumentUri(moFiles[0].toString());
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
      const moFiles = await workspace.findFiles("**/*.{mo,js,ts}");
      console.log(`[workspace-scan] Found ${moFiles.length} files matching .mo/.js/.ts rules`);
      for (const uri of moFiles) {
        try {
          await workspace.openTextDocument(uri);
          console.log(`[workspace-scan] Opened ${uri.path.split("/").pop()}`);
        } catch (e) {
          console.warn(`[workspace-scan] Failed to open ${uri.path}:`, e);
        }
      }
      // Also scan for FMU archive files and register them with the LSP
      const fmuFiles = await workspace.findFiles("**/*.fmu");
      for (const uri of fmuFiles) {
        try {
          const fmuBytes = await workspace.fs.readFile(uri);
          const name =
            uri.path
              .split("/")
              .pop()
              ?.replace(/\.fmu$/, "") ?? "FMU";
          // Convert to base64
          const b64 = btoa(Array.from(fmuBytes, (b) => String.fromCharCode(b)).join(""));
          if (client) {
            await client.sendRequest("modelscript/registerFmu", { name, data: b64 });
            console.log(`[workspace-scan] Registered FMU ${name}`);
          }
        } catch (e) {
          console.warn(`[workspace-scan] Failed to register FMU ${uri.path}:`, e);
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
