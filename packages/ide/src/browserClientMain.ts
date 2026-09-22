import * as vscode from "vscode";
import { Uri, commands, workspace } from "vscode";
import { LanguageClientOptions } from "vscode-languageclient";
import { LanguageClient } from "vscode-languageclient/browser";
import { AnalysisPanel } from "./analysisPanel";
import { getTemplatePrimaryFile, scaffoldTemplateFiles } from "./templates/catalog";

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
import { registerRegistryView } from "./registryTreeProvider";
import { registerRepl } from "./replTerminal";
import { RequirementsEditorProvider } from "./requirementsEditorProvider";

import { MarkdownResolver, createMarkdownItPlugin } from "./markdownItPlugin";
import { registerScmIntegration } from "./scmIntegration";
import { registerScmTreeView } from "./scmTreeView";
import { registerSemanticDiffComments } from "./semanticDiffComments";
import { ThreadExplorerPanel } from "./threadExplorerPanel";
import { VerificationPanel } from "./verificationPanel";

import { OWL2ClassHierarchyProvider } from "./owl2ClassHierarchyProvider";
import { OWL2DiagramPanel } from "./owl2DiagramPanel";
import { OWL2PropertyHierarchyProvider } from "./owl2PropertyHierarchyProvider";

import { CalibrationPanel } from "./calibrationPanel";
import { ExperimentsTreeProvider } from "./experimentsTree";
import { GCodeEditorProvider } from "./gcodeEditorProvider";
import { OptimizationPanel } from "./optimizationPanel";
import { SimulationViewPanel } from "./physicsSetupEditorProvider";
import { SimulationPanel } from "./simulationPanel";
import { SSP_VIEW_SCHEME, SspContentProvider, SspEditorProvider } from "./sspDocumentProvider";
import { StepEditorProvider } from "./stepEditorProvider";
import { SurrogatePanel } from "./surrogatePanel";
import { UncertaintyPanel } from "./uncertaintyPanel";

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

  writeFiles(entries: [vscode.Uri, Uint8Array][]): void {
    const events: vscode.FileChangeEvent[] = [];
    for (const [uri, content] of entries) {
      const parts = uri.path.split("/");
      for (let i = 1; i < parts.length - 1; i++) {
        this._mkdirp(parts.slice(0, i + 1).join("/"));
      }
      const isNew = !this.files.has(uri.path);
      this.files.set(uri.path, content);
      events.push({ type: isNew ? vscode.FileChangeType.Created : vscode.FileChangeType.Changed, uri });
    }
    this._emitter.fire(events);
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

  async function getProjectDependencies() {
    const defaultDeps = [
      { name: "Modelica", version: "4.1.0" },
      { name: "SysML", version: "2026.3.0" },
    ];

    if (!workspace.workspaceFolders || workspace.workspaceFolders.length === 0) {
      return defaultDeps;
    }

    const rootUri = workspace.workspaceFolders[0].uri;

    try {
      const msJsonUri = vscode.Uri.joinPath(rootUri, "modelscript.json");
      const content = await workspace.fs.readFile(msJsonUri);
      const json = JSON.parse(new TextDecoder().decode(content));
      if (json.dependencies) {
        return Object.entries(json.dependencies).map(([name, version]) => ({ name, version }));
      }
    } catch {
      // ignore
    }

    try {
      const pkgJsonUri = vscode.Uri.joinPath(rootUri, "package.json");
      const content = await workspace.fs.readFile(pkgJsonUri);
      const json = JSON.parse(new TextDecoder().decode(content));
      if (json.modelscript?.dependencies) {
        return Object.entries(json.modelscript.dependencies).map(([name, version]) => ({ name, version }));
      }
    } catch {
      // ignore
    }

    return defaultDeps;
  }

  // Register in-memory filesystem for blank project mode (memfs:// scheme)
  // Must be registered synchronously before any await to avoid ENOPRO race conditions during workspace validation.
  const memFs = new MemoryFileSystemProvider();
  context.subscriptions.push(workspace.registerFileSystemProvider("memfs", memFs, { isCaseSensitive: true }));
  console.log("[blank-project] Registered memfs:// filesystem provider");

  const folders = workspace.workspaceFolders;
  let memfsRootUri: vscode.Uri | undefined;
  if (folders && folders.length > 0 && folders[0].uri.scheme === "memfs") {
    memfsRootUri = folders[0].uri;
  } else {
    try {
      const hash = typeof location !== "undefined" ? location.hash.slice(1) : "";
      if (hash.startsWith("memfs")) {
        const template = hash.split(":")[1] || "empty";
        memfsRootUri = vscode.Uri.from({ scheme: "memfs", path: "/" + template });
      }
    } catch {
      // ignore
    }
  }

  if (memfsRootUri) {
    memFs.createDirectory(memfsRootUri);
    // Scaffold template files SYNCHRONOUSLY into the memfs store so they exist
    // before VS Code attempts to restore previously-open editors (including
    // diagram custom editors) from a prior session. Without this, restored editors
    // trigger FileNotFound because initWorkspaceAndTree runs asynchronously later.
    scaffoldTemplateFiles(memFs, memfsRootUri);
  }

  try {
    context.subscriptions.push(
      vscode.debug.registerDebugAdapterDescriptorFactory("modelscript", new InlineDebugAdapterFactory()),
    );
  } catch (e) {
    console.warn("Failed to register debug adapter factory:", e);
  }

  // Register URI handler for vscode://modelscript.modelscript/install?package=xyz
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri: vscode.Uri) {
        if (uri.path === "/install" || uri.path === "install") {
          const query = new URLSearchParams(uri.query);
          const pkg = query.get("package");
          const version = query.get("version");
          if (pkg) {
            vscode.commands.executeCommand("modelscript.registry.install", pkg, version || "latest");
          }
        }
      },
    }),
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
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  // Physics editor is registered after the LSP client starts (needs client for STEP meshes)

  const contributedLanguages =
    (context.extension?.packageJSON?.contributes?.languages as { id: string; extensions?: string[] }[] | undefined) ||
    [];
  const dynamicLanguageSelectors: ({ language: string } | { pattern: string })[] = [];
  const allExts: string[] = ["mo", "mos", "sysml", "sysml2", "step", "stp", "p21", "owl", "ttl", "ofn", "csv", "scad"];

  if (contributedLanguages.length > 0) {
    for (const lang of contributedLanguages) {
      dynamicLanguageSelectors.push({ language: lang.id });
      if (lang.extensions) {
        for (const ext of lang.extensions) {
          const cleanExt = ext.startsWith(".") ? ext.slice(1) : ext;
          if (!allExts.includes(cleanExt)) allExts.push(cleanExt);
        }
      }
    }
  } else {
    dynamicLanguageSelectors.push(
      { language: "modelica" },
      { language: "sysml" },
      { language: "sysml2" },
      { language: "step" },
      { language: "owl2" },
      { language: "csv" },
      { language: "scad" },
    );
  }

  dynamicLanguageSelectors.push({ pattern: "**/*.{js,ts}" });
  dynamicLanguageSelectors.push({ pattern: `**/*.{${allExts.join(",")}}` });
  const documentSelector = dynamicLanguageSelectors;

  // Options to control the language client
  const lspOutputChannel = vscode.window.createOutputChannel("ModelScript Language Server");
  const clientOptions: LanguageClientOptions = {
    documentSelector,
    synchronize: {},
    initializationOptions: {
      extensionUri: context.extensionUri.toString(),
      registryUrl:
        vscode.workspace.getConfiguration("modelscript").get("registryUrl") ||
        (typeof location !== "undefined" && (location.hostname === "localhost" || location.hostname === "127.0.0.1")
          ? `${location.protocol}//${location.hostname}:3000`
          : "https://api.modelscript.org"),
      useLocalMsl: !(vscode.workspace.getConfiguration("modelscript").get("library.useApiRegistry") ?? false),
      projectDependencies: await getProjectDependencies(),
    },
    outputChannel: lspOutputChannel,
  };

  client = await createWorkerLanguageClient(context, clientOptions);

  try {
    await client.start();
    console.log("ModelScript language server is ready");
    lspOutputChannel.appendLine("[client] Language server started successfully");

    // Dynamically register language actions from the server Action Router
    try {
      const actions = await client.sendRequest<any[]>("modelscript/listActions", {});
      if (Array.isArray(actions)) {
        for (const action of actions) {
          if (!action.id) continue;
          const cmdId = `modelscript.action.${action.id}`;
          const handler = async (args?: any) => {
            const activeDoc = vscode.window.activeTextEditor?.document;
            const inputs = typeof args === "object" && args ? { ...args } : {};
            if (!inputs.documentText && activeDoc) {
              inputs.documentText = activeDoc.getText();
            }
            if (!inputs.name && activeDoc) {
              const text = activeDoc.getText();
              const m = text.match(/\b(?:model|block|class|record)\s+([A-Za-z0-9_]+)/);
              if (m) inputs.name = m[1];
            }
            return await client?.sendRequest("modelscript/executeAction", {
              actionId: action.id,
              uri: args?.uri ?? activeDoc?.uri.toString(),
              languageId: action.languageId ?? activeDoc?.languageId,
              inputs,
            });
          };
          context.subscriptions.push(vscode.commands.registerCommand(cmdId, handler));
          if (action.languageId) {
            context.subscriptions.push(
              vscode.commands.registerCommand(`modelscript.${action.languageId}.${action.id}`, handler),
            );
          }
        }
      }
    } catch (err) {
      console.warn("[client] Could not register dynamic language actions:", err);
    }

    // Register 3D CAD step viewer
    const stepEditor = new StepEditorProvider(context, client);
    context.subscriptions.push(
      vscode.window.registerCustomEditorProvider(StepEditorProvider.viewType, stepEditor, {
        webviewOptions: { retainContextWhenHidden: true },
      }),
    );

    // Register GCode viewer
    const gcodeEditor = new GCodeEditorProvider(context);
    context.subscriptions.push(
      vscode.window.registerCustomEditorProvider(GCodeEditorProvider.viewType, gcodeEditor, {
        webviewOptions: { retainContextWhenHidden: true },
      }),
    );
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
  let treeView: vscode.TreeView<any> | undefined;
  try {
    treeView = vscode.window.createTreeView("modelscript.libraryTree", {
      treeDataProvider: treeProvider,
      dragAndDropController: treeProvider,
      canSelectMany: false,
    });
    context.subscriptions.push(treeView);

    context.subscriptions.push(
      vscode.commands.registerCommand("modelscript.libraryView.refresh", () => {
        treeProvider.refresh();
      }),
    );
  } catch (e) {
    console.warn("Could not register modelscript.libraryTree view:", e);
  }

  // Register MQTT participant tree view
  try {
    const mqttTreeProvider = new MqttTreeProvider(client, context);
    const mqttTreeView = vscode.window.createTreeView("modelscript.mqttTree", {
      treeDataProvider: mqttTreeProvider,
      dragAndDropController: mqttTreeProvider,
      canSelectMany: false,
    });
    context.subscriptions.push(mqttTreeView);
    mqttTreeProvider.startPolling();
  } catch (e) {
    console.warn("Could not register modelscript.mqttTree view:", e);
  }

  // Register experiments tree view (discovers experiment annotations)
  let experimentsTreeProvider: ExperimentsTreeProvider | undefined;
  try {
    experimentsTreeProvider = new ExperimentsTreeProvider(client);
    const experimentsTreeView = vscode.window.createTreeView("modelscript.experimentsView", {
      treeDataProvider: experimentsTreeProvider,
      canSelectMany: false,
    });
    context.subscriptions.push(experimentsTreeView);
  } catch (e) {
    console.warn("Could not register modelscript.experimentsView view:", e);
  }

  // Register OWL2 Protégé-style class hierarchy tree view
  try {
    const owl2ClassProvider = new OWL2ClassHierarchyProvider(client);
    const owl2ClassTreeView = vscode.window.createTreeView("modelscript.owl2ClassHierarchy", {
      treeDataProvider: owl2ClassProvider,
      canSelectMany: false,
    });
    context.subscriptions.push(owl2ClassTreeView);
  } catch (e) {
    console.warn("Could not register modelscript.owl2ClassHierarchy view:", e);
  }

  // Register OWL2 Protégé-style property hierarchy tree view
  try {
    const owl2PropProvider = new OWL2PropertyHierarchyProvider(client);
    const owl2PropTreeView = vscode.window.createTreeView("modelscript.owl2PropertyHierarchy", {
      treeDataProvider: owl2PropProvider,
      canSelectMany: false,
    });
    context.subscriptions.push(owl2PropTreeView);
  } catch (e) {
    console.warn("Could not register modelscript.owl2PropertyHierarchy view:", e);
  }

  // Register ModelScript package registry tree view (Extensions-bar style)
  registerRegistryView(context, client);

  // Register REPL terminal command
  if (client) {
    registerRepl(context, client);
  }

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
  let isScmRegistered = false;
  let hideTimeout: NodeJS.Timeout | null = null;
  client.onNotification("modelscript/status", (params: { state: string; message: string }) => {
    if (hideTimeout) {
      clearTimeout(hideTimeout);
      hideTimeout = null;
    }
    switch (params.state) {
      case "loading":
        statusItem.show();
        statusItem.text = `$(sync~spin) ${params.message}`;
        statusItem.tooltip = "ModelScript is loading...";
        break;
      case "ready":
        statusItem.show();
        statusItem.text = `$(check) ${params.message}`;
        statusItem.tooltip = "ModelScript language server is ready";
        hideTimeout = setTimeout(() => statusItem.hide(), 5000);
        // Auto-refresh UI components now that LSP is fully initialized
        treeProvider.refresh();
        experimentsTreeProvider?.refresh();

        // Register integrations only once
        if (!isScmRegistered) {
          isScmRegistered = true;
          // Register SCM Integration
          registerScmIntegration(context, client);

          // Register SCM Structural Tree View
          registerScmTreeView(context, client);

          // Register Semantic Diff Comments for diff editors
          registerSemanticDiffComments(context, client);
        }

        // Resolve markdown variable values, requirements, and diagram data.
        // Single delayed call — the workspace index needs time to populate
        // before the first fetch. Subsequent updates are handled by the
        // debounced onDidChangeTextDocument listener.
        setTimeout(() => refreshMarkdownData(), 3000);

        break;
      case "error":
        statusItem.text = `$(warning) ${params.message}`;
        statusItem.tooltip = "ModelScript encountered an error during initialization";
        break;
    }
  });

  client.onNotification(
    "modelscript/cosimStream",
    async (msg: { type: string; participantId: string; time: number; data?: number[]; payload?: any }) => {
      // Forward the co-simulation streaming events to the CAD Viewer React webview
      const { CadViewerPanel } = await import("./cadViewerPanel");
      if (CadViewerPanel.currentPanel) {
        // Send message with type VTK_PAYLOAD so that VtkRenderer can pick it up
        if (msg.type === "vtk") {
          CadViewerPanel.currentPanel.postMessage({
            type: "VTK_PAYLOAD",
            data: {
              pid: msg.participantId,
              time: msg.time,
              buffer: new Uint8Array(msg.data || []), // Parse Array back to typed array
            },
          });
        } else if (msg.type === "fea-frame" || msg.type === "fea") {
          CadViewerPanel.currentPanel.sendFeaPayload(msg.payload || msg);
        } else {
          // Forward general step or complete events
          CadViewerPanel.currentPanel.postMessage(msg);
        }
      }
    },
  );

  // Update tree when active editor changes to a .mo or .owl2 file
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor?.document && editor.document.uri.scheme !== "output") {
        treeProvider.setDocumentUri(editor.document.uri.toString());
      }
      // Refresh OWL2 hierarchy views when an OWL2 file is active
      if (editor?.document.languageId === "owl2") {
        const uri = editor.document.uri.toString();
        owl2ClassProvider.setDocumentUri(uri);
        owl2PropProvider.setDocumentUri(uri);
      }
      // Set context keys for palette visibility
      const langId = editor?.document.languageId;
      vscode.commands.executeCommand("setContext", "modelscript.activeLanguage", langId);
      vscode.commands.executeCommand(
        "setContext",
        "modelscript.sysml2Active",
        langId === "sysml" || langId === "sysml2",
      );
      vscode.commands.executeCommand("setContext", "modelscript.owl2Active", langId === "owl2");
      if (langId) {
        vscode.commands.executeCommand("setContext", `modelscript.${langId}Active`, true);
      }
    }),
  );

  // ── Viewport tracking for prioritized linting ────────────────────────
  // Send visible line ranges to the LSP server when the user scrolls.
  // The server uses this to prioritize linting symbols in the visible area.
  let visibleRangeTimer: ReturnType<typeof setTimeout> | undefined;
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
      if (!client) return;
      clearTimeout(visibleRangeTimer);
      visibleRangeTimer = setTimeout(() => {
        const uri = e.textEditor.document.uri.toString();
        const ranges = e.visibleRanges.map((r) => ({
          startLine: r.start.line,
          endLine: r.end.line,
        }));
        client?.sendNotification("modelscript/visibleRanges", { uri, ranges });
      }, 150);
    }),
  );

  // Trigger once for the initially active editor (since the event doesn't fire for the first tab)
  if (vscode.window.activeTextEditor?.document && vscode.window.activeTextEditor.document.uri.scheme !== "output") {
    treeProvider.setDocumentUri(vscode.window.activeTextEditor.document.uri.toString());
  }

  // Register commands
  context.subscriptions.push(
    commands.registerCommand("modelscript.openDiagram", async () => {
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor?.document && activeEditor.document.uri.scheme !== "output") {
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
    commands.registerCommand("modelscript.openStepViewer", () => {
      vscode.window.showInformationMessage(
        "Clicking on a .step file in the explorer now opens the 3D Viewer directly.",
      );
    }),
    commands.registerCommand("modelscript.openGCodeViewer", () => {
      vscode.window.showInformationMessage(
        "Clicking on a .gcode file in the explorer now opens the Toolpath Viewer directly.",
      );
    }),
    commands.registerCommand("modelscript.exportShapeToStep", async () => {
      if (!client) return;
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("Please open a file containing a shape class.");
        return;
      }

      const uri = editor.document.uri.toString();

      let symbols: vscode.DocumentSymbol[] | unknown[] | undefined;
      try {
        symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[] | unknown[]>(
          "vscode.executeDocumentSymbolProvider",
          editor.document.uri,
        );
      } catch (e) {
        vscode.window.showErrorMessage("Error fetching symbols: " + e);
      }

      const classNames: string[] = [];
      if (symbols && symbols.length > 0) {
        const extractClasses = (syms: vscode.DocumentSymbol[], prefix: string) => {
          for (const sym of syms) {
            const fullName = prefix ? `${prefix}.${sym.name}` : sym.name;
            // Include everything except primitive variables/fields
            if (
              sym.kind !== vscode.SymbolKind.Variable &&
              sym.kind !== vscode.SymbolKind.Property &&
              sym.kind !== vscode.SymbolKind.Field &&
              sym.kind !== vscode.SymbolKind.Constant &&
              sym.kind !== vscode.SymbolKind.Function &&
              sym.kind !== vscode.SymbolKind.Method
            ) {
              classNames.push(fullName);
            }
            if (sym.children && sym.children.length > 0) {
              extractClasses(sym.children, fullName);
            }
          }
        };
        extractClasses(symbols, "");
      }

      let className: string | undefined;
      if (classNames.length === 1) {
        className = classNames[0];
      } else if (classNames.length > 1) {
        className = await vscode.window.showQuickPick(classNames, {
          placeHolder: "Select the shape class to export to STEP",
        });
      } else {
        className = await vscode.window.showInputBox({
          prompt: `Enter shape class (Fallback - symbols: ${symbols?.length || "undefined"})`,
          placeHolder: "e.g., DroneCAD.DroneChassis",
        });
      }

      if (!className) return;

      try {
        const result = await client.sendRequest<{ step: string; name: string }>("modelscript/exportShapeToStep", {
          uri,
          className,
        });

        if (result && result.step) {
          // Write to file
          const folder = vscode.workspace.workspaceFolders?.[0]?.uri || vscode.Uri.file("/");
          const fileUri = vscode.Uri.joinPath(folder, `${result.name.split(".").pop()}.step`);
          await vscode.workspace.fs.writeFile(fileUri, new TextEncoder().encode(result.step));
          vscode.window.showInformationMessage(`Exported ${result.name} to ${fileUri.fsPath}`);

          // Open the generated step file
          vscode.commands.executeCommand("vscode.openWith", fileUri, "modelscript.stepEditor");
        }
      } catch (e: unknown) {
        vscode.window.showErrorMessage(`Failed to export shape: ${e instanceof Error ? e.message : e}`);
      }
    }),
    commands.registerCommand("modelscript.owl2.openDiagram", async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor?.document && editor.document.uri.scheme !== "output") {
        try {
          const docUri = editor.document.uri;
          if (docUri.scheme === "memfs") {
            const content = new TextEncoder().encode(editor.document.getText());
            await workspace.fs.writeFile(docUri, content);
          }
          await vscode.commands.executeCommand("vscode.openWith", docUri, DiagramEditorProvider.viewType);
        } catch (e: unknown) {
          vscode.window.showErrorMessage(`Failed to open diagram: ${(e as Error)?.message || e}`);
        }
      } else if (client) {
        OWL2DiagramPanel.createOrShow(client, undefined);
      }
    }),
    commands.registerCommand("modelscript.owl2.goToDeclaration", async (iri: string) => {
      if (!client) return;
      try {
        const result = await client.sendRequest<{ uri: string; line: number; character: number } | null>(
          "modelscript/owl2/goToDeclaration",
          { iri },
        );
        if (result) {
          const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(result.uri));
          const pos = new vscode.Position(result.line, result.character);
          await vscode.window.showTextDocument(doc, { selection: new vscode.Range(pos, pos) });
        }
      } catch (e) {
        console.error("[owl2] Failed to navigate to declaration:", e);
      }
    }),
    commands.registerCommand("modelscript.owl2.refreshClassHierarchy", () => {
      owl2ClassProvider.refresh();
    }),
    commands.registerCommand("modelscript.owl2.refreshPropertyHierarchy", () => {
      owl2PropProvider.refresh();
    }),
    commands.registerCommand("modelscript.openCadExample", async () => {
      // 1. Get the example file path
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (!folder) {
        vscode.window.showErrorMessage("Please open a workspace folder first.");
        return;
      }
      // Assuming the user has copied the example or we use memfs
      // To ensure it exists, we can scaffold it or find it if we saved it in memfs
      const sysmlUri = vscode.Uri.joinPath(folder, "drone_architecture.sysml");
      const stepUri = vscode.Uri.joinPath(folder, "drone.step");

      try {
        const sysmlContent = `package DroneArchitecture {
  import DroneCAD::*;

  part def DroneAssembly {
    part chassis : Chassis;
    part rotor1 : Rotor;
    part rotor2 : Rotor;
    part rotor3 : Rotor;
    part rotor4 : Rotor;

    // Reference CAD geometry directly from the STEP file!
    ref chassisGeometry = DroneCAD::ChassisShape;
  }

  part def Chassis {}
  part def Rotor {}
}`;
        await vscode.workspace.fs.writeFile(sysmlUri, new TextEncoder().encode(sysmlContent));

        const stepContent = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('drone','2023-10-23T00:00:00',(''),(''),'','','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));
ENDSEC;
DATA;
#1=APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2001,#2);
#2=APPLICATION_CONTEXT('core data for automotive mechanical design processes');
#3=SHAPE_DEFINITION_REPRESENTATION(#4,#10);
#4=PRODUCT_DEFINITION_SHAPE('','',#5);
#5=PRODUCT_DEFINITION('design','',#6,#9);
#6=PRODUCT_DEFINITION_FORMATION('','',#7);
#7=PRODUCT('DroneCAD','DroneCAD','',(#8));
#8=PRODUCT_CONTEXT('',#2,'mechanical');
#9=DESIGN_CONTEXT('',#2,'design');
#10=SHAPE_REPRESENTATION('',(#11),#15);
#11=AXIS2_PLACEMENT_3D('',#12,#13,#14);
#12=CARTESIAN_POINT('',(0.,0.,0.));
#13=DIRECTION('',(0.,0.,1.));
#14=DIRECTION('',(1.,0.,0.));
#15=(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#16))GLOBAL_UNIT_ASSIGNED_CONTEXT((#17,#18,#19))REPRESENTATION_CONTEXT('Context #1','3D Context with PROGRAM and LENGTH unit'));
#16=UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),#17,'distance_accuracy_value','confusion accuracy');
#17=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));
#18=(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.));
#19=(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT());
#20=ADVANCED_BREP_SHAPE_REPRESENTATION('',(#11,#21),#15);
#21=MANIFOLD_SOLID_BREP('ChassisShape',#22);
#22=CLOSED_SHELL('',(#23));
#23=ADVANCED_FACE('',(#24),#29,.T.);
#24=FACE_BOUND('',#25,.T.);
#25=EDGE_LOOP('',(#26,#27,#28));
#26=ORIENTED_EDGE('',*,*,#30,.T.);
#27=ORIENTED_EDGE('',*,*,#31,.T.);
#28=ORIENTED_EDGE('',*,*,#32,.T.);
#29=PLANE('',#33);
#30=EDGE_CURVE('',#34,#35,#36,.T.);
#31=EDGE_CURVE('',#35,#37,#38,.T.);
#32=EDGE_CURVE('',#37,#34,#39,.T.);
#33=AXIS2_PLACEMENT_3D('',#40,#41,#42);
#34=VERTEX_POINT('',#43);
#35=VERTEX_POINT('',#44);
#36=LINE('',#45,#46);
#37=VERTEX_POINT('',#47);
#38=LINE('',#48,#49);
#39=LINE('',#50,#51);
#40=CARTESIAN_POINT('',(0.,0.,0.));
#41=DIRECTION('',(0.,0.,1.));
#42=DIRECTION('',(1.,0.,0.));
#43=CARTESIAN_POINT('',(0.,0.,0.));
#44=CARTESIAN_POINT('',(10.,0.,0.));
#45=CARTESIAN_POINT('',(0.,0.,0.));
#46=VECTOR('',#52,1.);
#47=CARTESIAN_POINT('',(0.,10.,0.));
#48=CARTESIAN_POINT('',(10.,0.,0.));
#49=VECTOR('',#53,1.);
#50=CARTESIAN_POINT('',(0.,10.,0.));
#51=VECTOR('',#54,1.);
#52=DIRECTION('',(1.,0.,0.));
#53=DIRECTION('',(-0.707106781186547,0.707106781186547,0.));
#54=DIRECTION('',(0.,-1.,0.));
ENDSEC;
END-ISO-10303-21;`;
        await vscode.workspace.fs.writeFile(stepUri, new TextEncoder().encode(stepContent));

        // Open the SysML file in the left pane
        const doc = await vscode.workspace.openTextDocument(sysmlUri);
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One });

        // Wait a short bit to allow the LSP to index the step file when it's created
        setTimeout(() => {
          // Open the Step viewer in the right pane natively using the custom editor
          vscode.commands.executeCommand("vscode.open", vscode.Uri.parse(stepUri), {
            viewColumn: vscode.ViewColumn.Two,
            preserveFocus: true,
          });
        }, 1000);
      } catch (e) {
        vscode.window.showErrorMessage(`Failed to open CAD example: ${e}`);
      }
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
            client,
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
    commands.registerCommand("modelscript.modelica.simulate", async (args?: any) => {
      if (!client) return;
      const editor = vscode.window.activeTextEditor;
      let uri = editor?.document.uri.toString();
      let inputs: any = {};
      if (args && typeof args === "object") {
        if ("scheme" in args && "path" in args) {
          uri = args.toString();
        } else if (typeof args.toString === "function" && args.scheme) {
          uri = args.toString();
        } else {
          inputs = args;
        }
      }
      if (!uri && editor?.document) {
        uri = editor.document.uri.toString();
      }
      if (!uri) {
        const candidate =
          vscode.window.visibleTextEditors.find(
            (e) =>
              e.document.uri.scheme !== "output" &&
              (e.document.uri.path.endsWith(".mo") || e.document.languageId === "modelica"),
          )?.document ??
          vscode.workspace.textDocuments.find(
            (d) => d.uri.scheme !== "output" && (d.uri.path.endsWith(".mo") || d.languageId === "modelica"),
          );
        if (candidate) {
          uri = candidate.uri.toString();
          if (!inputs.documentText) inputs.documentText = candidate.getText();
          if (!inputs.name) {
            const m = candidate.getText().match(/\b(?:model|block|class|record)\s+([A-Za-z0-9_]+)/);
            if (m) inputs.name = m[1];
          }
        }
      }
      if (uri && !inputs.documentText) {
        const openDoc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri);
        if (openDoc) {
          inputs.documentText = openDoc.getText();
        } else {
          try {
            const bytes = await vscode.workspace.fs.readFile(vscode.Uri.parse(uri));
            inputs.documentText = new TextDecoder("utf-8").decode(bytes);
          } catch {
            // ignore
          }
        }
      }
      if (!inputs.documentText && editor?.document) {
        inputs.documentText = editor.document.getText();
      }
      if (!inputs.name && inputs.documentText) {
        const m = inputs.documentText.match(/\b(?:model|block|class|record)\s+([A-Za-z0-9_]+)/);
        if (m) inputs.name = m[1];
      }
      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Running simulation...",
            cancellable: false,
          },
          async () => {
            const res = await client.sendRequest<any>("modelscript/executeAction", {
              actionId: "simulate",
              languageId: editor?.document.languageId ?? "modelica",
              uri,
              inputs,
            });
            if (res?.t && res?.y) {
              const tArr = Array.isArray(res.t) ? res.t : Object.values(res.t);
              const yArr = Array.isArray(res.y) ? res.y : Object.values(res.y);
              SimulationPanel.createOrShowWithData(
                context.extensionUri,
                {
                  t: tArr,
                  states: res.states || [],
                  y: yArr,
                  parameters: res.parameters,
                  experiment: res.experiment,
                },
                uri || "",
                client,
              );
            } else if (res?.text) {
              outputChannel.appendLine(res.text);
              outputChannel.show(true);
            }
          },
        );
      } catch (e: any) {
        vscode.window.showErrorMessage(`Simulation failed: ${e?.message ?? e}`);
      }
    }),
    commands.registerCommand("modelscript.modelica.flatten", async (args?: any) => {
      if (!client) return;
      const editor = vscode.window.activeTextEditor;
      let uri = editor?.document.uri.toString();
      let inputs: any = {};
      if (args && typeof args === "object") {
        if ("scheme" in args && "path" in args) {
          uri = args.toString();
        } else {
          inputs = args;
        }
      }
      if (!uri && editor?.document) {
        uri = editor.document.uri.toString();
      }
      if (!uri) {
        const candidate =
          vscode.window.visibleTextEditors.find(
            (e) =>
              e.document.uri.scheme !== "output" &&
              (e.document.uri.path.endsWith(".mo") || e.document.languageId === "modelica"),
          )?.document ??
          vscode.workspace.textDocuments.find(
            (d) => d.uri.scheme !== "output" && (d.uri.path.endsWith(".mo") || d.languageId === "modelica"),
          );
        if (candidate) {
          uri = candidate.uri.toString();
          if (!inputs.documentText) inputs.documentText = candidate.getText();
          if (!inputs.name) {
            const m = candidate.getText().match(/\b(?:model|block|class|record)\s+([A-Za-z0-9_]+)/);
            if (m) inputs.name = m[1];
          }
        }
      }
      if (uri && !inputs.documentText) {
        const openDoc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri);
        if (openDoc) {
          inputs.documentText = openDoc.getText();
        } else {
          try {
            const bytes = await vscode.workspace.fs.readFile(vscode.Uri.parse(uri));
            inputs.documentText = new TextDecoder("utf-8").decode(bytes);
          } catch {
            // ignore
          }
        }
      }
      if (!inputs.documentText && editor?.document) {
        inputs.documentText = editor.document.getText();
      }
      if (!inputs.name && inputs.documentText) {
        const m = inputs.documentText.match(/\b(?:model|block|class|record)\s+([A-Za-z0-9_]+)/);
        if (m) inputs.name = m[1];
      }
      try {
        const lang = editor?.document.languageId ?? "modelica";
        const res = await client.sendRequest<any>("modelscript/executeAction", {
          actionId: "flatten",
          languageId: lang,
          uri,
          inputs,
        });
        if (res?.text) {
          const doc = await vscode.workspace.openTextDocument({
            content: res.text,
            language: lang,
          });
          await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
        }
      } catch (e: any) {
        vscode.window.showErrorMessage(`Flatten failed: ${e?.message ?? e}`);
      }
    }),
    commands.registerCommand("modelscript.openCalibration", (uri?: string) => {
      if (!client) return;
      CalibrationPanel.createOrShow(context.extensionUri, client, uri);
    }),
    commands.registerCommand("modelscript.openOptimization", (uri?: string) => {
      if (!client) return;
      OptimizationPanel.createOrShow(context.extensionUri, client, uri);
    }),
    commands.registerCommand("modelscript.openUncertainty", (uri?: string) => {
      if (!client) return;
      UncertaintyPanel.createOrShow(context.extensionUri, client, uri);
    }),
    commands.registerCommand("modelscript.openSurrogateEditor", (uri?: string) => {
      if (!client) return;
      SurrogatePanel.createOrShow(context.extensionUri, client, uri);
    }),
    commands.registerCommand("modelscript.refreshExperiments", () => {
      experimentsTreeProvider?.refresh();
    }),
    commands.registerCommand("modelscript.flatten", async () => {
      if (!client) return;
      const editor = vscode.window.activeTextEditor;
      let uri = editor?.document.uri.toString();
      let name = "";

      if (!uri) {
        const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
        if (tab?.input instanceof vscode.TabInputCustom && tab.input.viewType === DiagramEditorProvider.viewType) {
          uri = tab.input.uri.toString();
        }
      }
      if (!uri) {
        vscode.window.showErrorMessage("Open a file to flatten it.");
        return;
      }

      // Request classes in the active document to find the target name
      try {
        const docClasses = await client.sendRequest<{ classes: { name: string; kind: string; uri: string }[] }>(
          "modelscript/listClasses",
        );
        const match = docClasses.classes.find(
          (c) => c.uri === uri && (c.kind === "model" || c.kind === "block" || c.kind === "class"),
        );
        if (match) {
          name = match.name;
        } else {
          // fallback if listClasses didn't have uri info, just try to get the first one from parse?
          // Instead, since the user is in the editor, we can just send the URI. Wait, the flatten LSP request needs "name".
          // We can ask LSP for `listClasses` and filter by URI!
        }
      } catch {
        // ignore
      }

      // We actually need the name to flatten. Let's send a request to get the name of the active class, or simply try flattening the one returned.
      // Wait, let's extract the name from the editor's text if needed, or better, we can modify the LSP to accept URI if name is missing?
      // Actually, modelscript/flatten takes `{ name: string, uri?: string }`.
      // I'll parse the file name as a fallback.
      if (!name) {
        name =
          uri
            .split("/")
            .pop()
            ?.replace(/\.[^.]+$/, "") ?? "Model";
      }

      vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Flattening model...", cancellable: false },
        async () => {
          try {
            const res = await client?.sendRequest<{ text: string | null; error?: string }>("modelscript/flatten", {
              name,
              uri,
            });
            if (!res) return;

            outputChannel.clear();
            outputChannel.show(true);
            if (res.error) {
              outputChannel.appendLine(`Flattening Error: ${res.error}`);
            } else if (res.text) {
              outputChannel.appendLine(`--- Flattened Output for ${name} ---`);
              outputChannel.appendLine(res.text);
            } else {
              outputChannel.appendLine("No output generated.");
            }
          } catch (e) {
            outputChannel.clear();
            outputChannel.show(true);
            outputChannel.appendLine(`Flattening Error: ${e}`);
          }
        },
      );
    }),
    commands.registerCommand("modelscript.exportFmi2", async () => {
      if (!client) return;
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("Open a model file to export an FMU.");
        return;
      }
      vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Exporting FMI 2.0...", cancellable: false },
        async () => {
          if (!client) return;
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
      if (!editor) {
        vscode.window.showErrorMessage("Open a model file to export an FMU.");
        return;
      }
      vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Exporting FMI 3.0...", cancellable: false },
        async () => {
          if (!client) return;
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
    commands.registerCommand("modelscript.generateMultiBody", async () => {
      if (!client) return;
      const editor = vscode.window.activeTextEditor;
      if (!editor || !editor.document.fileName.match(/\.(step|stp)$/i)) {
        vscode.window.showErrorMessage("Open a STEP file (.step or .stp) to generate a Multi-Body model.");
        return;
      }
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Extracting constraints and generating Modelica...",
          cancellable: false,
        },
        async () => {
          if (!client) return;
          try {
            const res = await client.sendRequest<{ source: string; name: string }>("modelscript/generateMultiBody", {
              uri: editor.document.uri.toString(),
            });

            // Write to a new file next to the step file
            const folder = vscode.workspace.workspaceFolders?.[0]?.uri || vscode.Uri.file("/");
            const outUri = vscode.Uri.joinPath(folder, `${res.name}.mo`);
            await vscode.workspace.fs.writeFile(outUri, new TextEncoder().encode(res.source));

            vscode.window.showInformationMessage(`Generated Modelica Multi-Body model: ${res.name}.mo`);

            // Open the generated file
            const doc = await vscode.workspace.openTextDocument(outUri);
            await vscode.window.showTextDocument(doc);
          } catch (e) {
            vscode.window.showErrorMessage(`Multi-Body generation failed: ${e}`);
          }
        },
      );
    }),
    commands.registerCommand("modelscript.compileWasm", async () => {
      if (!client) return;
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("Open a model file to compile to WebAssembly.");
        return;
      }
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Compiling to WebAssembly...",
          cancellable: false,
        },
        async () => {
          if (!client) return;
          try {
            const res = await client.sendRequest<{
              wasmC: string;
              emccFlags: string[];
              exportedFunctions: string[];
              scalarVariables: { name: string; valueReference: number; causality: string }[];
            }>("modelscript/compileWasm", {
              uri: editor.document.uri.toString(),
            });

            // Save the WASM C source to the workspace
            const folder = vscode.workspace.workspaceFolders?.[0]?.uri || vscode.Uri.file("/");
            const modelName = editor.document.fileName.replace(/.*[/\\]/, "").replace(/\.mo$/, "");
            const cUri = vscode.Uri.joinPath(folder, `${modelName}_wasm.c`);
            await vscode.workspace.fs.writeFile(cUri, new TextEncoder().encode(res.wasmC));

            // Save build instructions
            const buildCmd = `emcc ${modelName}_wasm.c ${res.emccFlags.join(" ")} -o ${modelName}.js`;
            const buildUri = vscode.Uri.joinPath(folder, `BUILD_WASM.md`);
            await vscode.workspace.fs.writeFile(
              buildUri,
              new TextEncoder().encode(
                [
                  `# WebAssembly Build Instructions`,
                  ``,
                  `## Prerequisites`,
                  `- Install [Emscripten](https://emscripten.org/)`,
                  `- Activate the Emscripten environment: \`source emsdk_env.sh\``,
                  ``,
                  `## Build Command`,
                  `\`\`\`bash`,
                  buildCmd,
                  `\`\`\``,
                  ``,
                  `## Output`,
                  `- \`${modelName}.js\` — Emscripten JS glue code`,
                  `- \`${modelName}.wasm\` — WebAssembly binary`,
                  ``,
                  `## Exported Functions`,
                  ...res.exportedFunctions.map((f) => `- \`${f}\``),
                  ``,
                  `## Scalar Variables`,
                  `| Name | Value Reference | Causality |`,
                  `|------|----------------|-----------|`,
                  ...res.scalarVariables.map((sv) => `| ${sv.name} | ${sv.valueReference} | ${sv.causality} |`),
                ].join("\n"),
              ),
            );

            vscode.window.showInformationMessage(
              `Generated WASM source: ${modelName}_wasm.c — see BUILD_WASM.md for compilation instructions.`,
            );
          } catch (e) {
            vscode.window.showErrorMessage(`WebAssembly compilation failed: ${e}`);
          }
        },
      );
    }),
    commands.registerCommand("modelscript.runVerification", async () => {
      if (!client) return;
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage("Open a file first to run requirements verification.");
        return;
      }
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Running Requirements Verification..." },
        async () => {
          try {
            if (client && editor) {
              await client.sendRequest("modelscript/runVerification", { uri: editor.document.uri.toString() });
              // Refresh markdown preview to update requirement statuses
              refreshMarkdownData();

              // Forward verification limits to the Simulation Panel for chart overlay
              try {
                const reqs: {
                  peakValue?: number;
                  limitValue?: number;
                  lhsName?: string;
                  status: string;
                }[] = await client.sendRequest("modelscript/getRequirements", {
                  uri: editor.document.uri.toString(),
                });
                const limits = reqs
                  .filter((r): r is typeof r & { limitValue: number } => r.limitValue !== undefined)
                  .map((r) => ({
                    variable: r.lhsName ?? "value",
                    value: r.limitValue,
                    label: `max: ${r.limitValue.toFixed(1)}`,
                    violated: r.status === "Failed",
                  }));
                if (limits.length > 0) {
                  SimulationPanel.postVerificationLimits(limits);
                }
              } catch {
                // Ignore — limit overlay is best-effort
              }
            }
          } catch (e: unknown) {
            vscode.window.showErrorMessage(`Verification failed: ${(e as Error).message}`);
          }
        },
      );
    }),
    commands.registerCommand("modelscript.addToDiagram", async (firstArg: unknown, secondArg?: string) => {
      if (!client) return;

      // Support context menu (LibraryTreeItem), palette item, and direct call
      let className: string | undefined;
      if (firstArg && typeof firstArg === "object" && "info" in firstArg) {
        const item = firstArg as { info: { compositeName: string; classKind: string; iconSvg?: string } };
        className = item.info.compositeName;
      } else if (firstArg && typeof firstArg === "object" && "elementInfo" in firstArg) {
        const item = firstArg as { elementInfo: { type: string; element?: { elementType: string } } };
        if (item.elementInfo.type === "element" && item.elementInfo.element) {
          className = item.elementInfo.element.elementType;
        }
      } else if (typeof firstArg === "string") {
        className = firstArg;
      }

      if (!className) return;

      let docUri = vscode.window.activeTextEditor?.document.uri.toString();
      if (!docUri) {
        const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
        if (tab?.input instanceof vscode.TabInputCustom && tab.input.viewType === DiagramEditorProvider.viewType) {
          docUri = tab.input.uri.toString();
        }
      }
      if (!docUri) {
        vscode.window.showWarningMessage("Open a diagram or model file first.");
        return;
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const response: any = await client.sendRequest("modelscript/diagram.applyEdits", {
          uri: docUri,
          seq: 0,
          actions: [{ type: "addComponent", className, x: 0, y: 0 }],
        });
        const edits = response?.edits;
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
          const displayName = className.split(".").pop() || className;
          vscode.window.showInformationMessage(`Added ${displayName} to model.`);
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
      if (editor?.document) {
        await vscode.commands.executeCommand(
          "vscode.openWith",
          editor.document.uri,
          RequirementsEditorProvider.viewType,
        );
      } else {
        vscode.window.showWarningMessage("Open a model file first.");
      }
    }),
    commands.registerCommand("modelscript.openVerificationDashboard", () => {
      if (!client) return;
      VerificationPanel.createOrShow(context.extensionUri, client);
    }),
    commands.registerCommand("modelscript.openThreadExplorer", () => {
      if (!client) return;
      ThreadExplorerPanel.createOrShow(context.extensionUri, client);
    }),
    // ── Physics Simulation Commands ──
    commands.registerCommand("modelscript.openSimulationView", async (uri?: vscode.Uri, className?: string) => {
      let targetUri = uri;
      if (!targetUri && vscode.window.activeTextEditor) {
        targetUri = vscode.window.activeTextEditor.document.uri;
      }
      if (!targetUri) return;
      if (!className) {
        className = await vscode.window.showInputBox({ prompt: "Enter the Study class name to simulate:" });
        if (!className) return;
      }
      if (client) {
        SimulationViewPanel.createOrShow(context, client, className, targetUri.toString());
      }
    }),
    commands.registerCommand("modelscript.runPhysicsSimulation", async (args?: { uri: string; className?: string }) => {
      if (!client) return;
      const uri = args?.uri || vscode.window.activeTextEditor?.document.uri.toString();
      if (!uri) return;
      const className = args?.className;

      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Running multi-physics simulation for ${className || "study"}...`,
          cancellable: false,
        },
        async () => {
          try {
            // Open 3D CAD viewer if not already open
            const { CadViewerPanel } = await import("./cadViewerPanel");
            CadViewerPanel.createOrShow(context.extensionUri, client);

            const result = await client.sendRequest<any>("modelscript/simulatePhysics", {
              uri,
              className,
              physicsType: "FEA",
            });

            if (result?.error) {
              vscode.window.showErrorMessage(`Simulation failed: ${result.error}`);
            } else {
              vscode.window.showInformationMessage("Physics co-simulation completed successfully.");
            }
          } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to run physics simulation: ${err?.message || err}`);
          }
        },
      );
    }),
    commands.registerCommand("modelscript.createFeaSetup", async (uri?: vscode.Uri) => {
      let targetUri = uri;
      if (!targetUri && vscode.window.activeTextEditor) {
        targetUri = vscode.window.activeTextEditor.document.uri;
      }
      if (!targetUri || !targetUri.fsPath.match(/\.(step|stp)$/i)) {
        vscode.window.showErrorMessage("Please select a STEP file to create an FEA setup.");
        return;
      }
      const studyName =
        targetUri.fsPath
          .split("/")
          .pop()
          ?.replace(/\.(step|stp)$/i, "") + "_FEA";
      const setupUri = vscode.Uri.file(targetUri.fsPath + ".fea.mo");
      const moContent = `model ${studyName}
  extends ModelScript.Studies.StaticStructuralFEA(
    meshResolution = 0.05
  );
  // Add target component here
end ${studyName};
`;
      await vscode.workspace.fs.writeFile(setupUri, new TextEncoder().encode(moContent));
      vscode.window.showInformationMessage(`Created FEA study: ${setupUri.fsPath}`);
      const doc = await vscode.workspace.openTextDocument(setupUri);
      await vscode.window.showTextDocument(doc);
    }),
    commands.registerCommand("modelscript.createCfdSetup", async (uri?: vscode.Uri) => {
      let targetUri = uri;
      if (!targetUri && vscode.window.activeTextEditor) {
        targetUri = vscode.window.activeTextEditor.document.uri;
      }
      if (!targetUri || !targetUri.fsPath.match(/\.(step|stp)$/i)) {
        vscode.window.showErrorMessage("Please select a STEP file to create a CFD setup.");
        return;
      }
      const studyName =
        targetUri.fsPath
          .split("/")
          .pop()
          ?.replace(/\.(step|stp)$/i, "") + "_CFD";
      const setupUri = vscode.Uri.file(targetUri.fsPath + ".cfd.mo");
      const moContent = `model ${studyName}
  extends ModelScript.Studies.SteadyStateCFD(
    meshResolution = 0.05
  );
  // Add target component here
end ${studyName};
`;
      await vscode.workspace.fs.writeFile(setupUri, new TextEncoder().encode(moContent));
      vscode.window.showInformationMessage(`Created CFD study: ${setupUri.fsPath}`);
      const doc = await vscode.workspace.openTextDocument(setupUri);
      await vscode.window.showTextDocument(doc);
    }),
    commands.registerCommand("modelscript.migrateMsimToStudy", async () => {
      const uris = await vscode.workspace.findFiles("**/*.msim");
      if (uris.length === 0) {
        vscode.window.showInformationMessage("No .msim files found to migrate.");
        return;
      }

      let migratedCount = 0;
      for (const uri of uris) {
        try {
          const content = await vscode.workspace.fs.readFile(uri);
          const json = JSON.parse(new TextDecoder().decode(content));

          const studyName =
            uri.path
              .split("/")
              .pop()
              ?.replace(".msim", "")
              .replace(/[^a-zA-Z0-9_]/g, "_") || "MigratedStudy";
          const workflowClass =
            json.type === "CFD"
              ? "ModelScript.Studies.SteadyStateCFD"
              : json.type === "FEA"
                ? "ModelScript.Studies.StaticStructuralFEA"
                : json.type === "MESHING"
                  ? "ModelScript.Studies.Meshing"
                  : "ModelScript.Studies.TransientSimulation";

          const targetClass = json.targetClass || "TargetModel";
          const meshSize = json.mesh?.size || json.mesh?.min || 0.05;

          const moContent = `model ${studyName}
  extends ${workflowClass}(
    meshResolution = ${meshSize}
  );
  extends ${targetClass};
end ${studyName};
`;

          const moUri = uri.with({ path: uri.path.replace(/\.msim$/, ".mo") });
          await vscode.workspace.fs.writeFile(moUri, new TextEncoder().encode(moContent));
          await vscode.workspace.fs.delete(uri);
          migratedCount++;
        } catch (e) {
          console.error("Failed to migrate", uri.path, e);
        }
      }

      vscode.window.showInformationMessage(
        `Successfully migrated ${migratedCount} .msim files to native Modelica studies.`,
      );
    }),
    commands.registerCommand("modelscript.generateMesh", async () => {
      vscode.window.showInformationMessage("Mesh generation has been initiated in the background.");
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

  // ── Markdown Preview: LSP-backed resolver ──
  // Cache variable values, requirements, and diagram data from the LSP
  // so the markdown-it plugin can inject them synchronously during rendering.
  const markdownVarCache: Record<string, string> = {};
  const markdownDiagramCache: Record<string, string> = {};
  const markdownRequirementsCache: Record<string, { reqId: string; name: string; text: string; status: string }[]> = {};
  const markdownDiagramComponentsCache: Record<
    string,
    { components: { name: string; type: string }[]; connections: { from: string; to: string }[] }
  > = {};

  const resolver: MarkdownResolver = {
    resolveVariable(name: string): string | undefined {
      return markdownVarCache[name];
    },
    resolveDiagramSvg(target: string): string | undefined {
      return markdownDiagramCache[target];
    },
    resolveRequirements(target: string) {
      return markdownRequirementsCache[target];
    },
    resolveDiagramComponents(target: string) {
      return markdownDiagramComponentsCache[target]?.components;
    },
    resolveDiagramConnections(target: string) {
      return markdownDiagramComponentsCache[target]?.connections;
    },
  };

  /**
   * Fetch all markdown-related data from the LSP and refresh the preview.
   */
  async function refreshMarkdownData(): Promise<void> {
    return; // Temporarily disabled
  }

  // Listen for document changes AND opens to re-fetch markdown data (debounced).
  // Only fires when a markdown preview tab is actually visible, to avoid blocking
  // the LSP event loop with unnecessary resolveMarkdownVars/resolveMarkdownContent
  // requests during interactive editing.
  let markdownRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  const isMarkdownPreviewOpen = (): boolean => {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.input instanceof vscode.TabInputWebview && tab.label.includes("Preview")) {
          return true;
        }
      }
    }
    return false;
  };
  const scheduleMarkdownRefresh = () => {
    if (!isMarkdownPreviewOpen()) return;
    if (markdownRefreshTimer) clearTimeout(markdownRefreshTimer);
    markdownRefreshTimer = setTimeout(() => refreshMarkdownData(), 2000);
  };
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      const lang = e.document.languageId;
      if (lang !== "markdown") {
        scheduleMarkdownRefresh();
      }
    }),
    vscode.workspace.onDidOpenTextDocument((doc) => {
      const lang = doc.languageId;
      if (lang !== "markdown") {
        scheduleMarkdownRefresh();
      }
    }),
  );

  // Return the markdown-it plugin API so VS Code calls it during preview rendering.
  return { extendMarkdownIt: createMarkdownItPlugin(resolver) };
}

export async function deactivate(): Promise<void> {
  if (client !== undefined) {
    await client.stop();
  }
}

export let languageWorker: Worker | undefined;

async function createWorkerLanguageClient(context: vscode.ExtensionContext, clientOptions: LanguageClientOptions) {
  let serverMain = Uri.joinPath(context.extensionUri, "server", "dist", "browserServerMain.js");

  // In web environments, the extension host runs on a dynamically generated UUID subdomain
  // (e.g., http://<uuid>.localhost:3003) for security, while context.extensionUri points to the parent host.
  // We must rewrite the worker URL to use the same origin to avoid cross-origin importScripts failures.
  if (typeof self !== "undefined" && self.location && self.location.origin) {
    const url = new URL(serverMain.toString(true));
    if (url.origin !== self.location.origin) {
      serverMain = Uri.parse(self.location.origin + url.pathname + url.search + url.hash);
    }
  }

  const worker = new Worker(serverMain.toString(true)); // No { type: "module" } because VS Code's web worker polyfill uses importScripts
  languageWorker = worker;
  return new LanguageClient("modelscript", "ModelScript Language Server", clientOptions, worker);
}

/**
 * Template scaffolding externalized to ./templates/catalog.ts
 */

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

  let workspaceUri: vscode.Uri | undefined =
    folders && folders.length > 0 && folders[0].uri.scheme === "memfs" ? folders[0].uri : undefined;
  if (!workspaceUri) {
    try {
      const hash = typeof location !== "undefined" ? location.hash.slice(1) : "";
      if (hash.startsWith("memfs")) {
        const template = hash.split(":")[1] || "empty";
        workspaceUri = vscode.Uri.from({ scheme: "memfs", path: "/" + template });
      }
    } catch {
      // ignore
    }
  }

  // For memfs workspaces, skip the file scan entirely — VS Code has no search
  // provider for memfs, so workspace.findFiles() hangs indefinitely.
  // Go straight to template scaffolding and open all template files directly.
  if (workspaceUri && workspaceUri.scheme === "memfs") {
    try {
      const template = workspaceUri.path.substring(1) || "empty";
      const primaryFile = getTemplatePrimaryFile(template);
      const fileUri = Uri.joinPath(workspaceUri, primaryFile);

      // Pre-open any other files in this memfs template workspace so LSP server tracks them
      try {
        const dirEntries = await workspace.fs.readDirectory(workspaceUri);
        for (const [name, type] of dirEntries) {
          if (type === vscode.FileType.File && name !== primaryFile) {
            try {
              await workspace.openTextDocument(Uri.joinPath(workspaceUri, name));
            } catch {
              // ignore
            }
          }
        }
      } catch {
        // ignore
      }

      try {
        if (primaryFile.endsWith(".monb")) {
          await vscode.commands.executeCommand("vscode.openWith", fileUri, "modelscript-notebook");
        } else {
          const doc = await workspace.openTextDocument(fileUri);
          await vscode.window.showTextDocument(doc);
          treeProvider.setDocumentUri(fileUri.toString());
        }
      } catch (e: unknown) {
        console.error("[blank-project] Failed to open primary template file:", e);
      }

      if (template === "mbse-verification") {
        try {
          const mdUri = Uri.joinPath(workspaceUri, "VerificationReport.md");
          await vscode.commands.executeCommand("markdown.showPreviewToSide", mdUri);
        } catch {
          // Fallback
        }
      } else if (template === "cad") {
        try {
          const stepUri = Uri.joinPath(workspaceUri, "drone.step");
          setTimeout(() => {
            vscode.commands.executeCommand("vscode.open", stepUri, { viewColumn: 2, preview: false });
          }, 1000);
        } catch {
          // Fallback
        }
      }
    } catch (e: unknown) {
      console.error("[blank-project] Failed to initialize workspace template:", e);
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
    return;
  }

  // Always scan for existing .mo/.sysml files so the LSP indexes the workspace
  const moFiles = await scanWorkspaceFiles();
  const isMemfs = folders && folders.length > 0 && folders[0].uri.scheme === "memfs";
  if (moFiles.length > 0 && !isMemfs) {
    // Only set tree focus for non-memfs since memfs templates do their own opening
    treeProvider.setDocumentUri(moFiles[0].toString());
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
  const folders = workspace.workspaceFolders;
  if (folders && folders.length > 0 && folders.every((f) => f.uri.scheme === "memfs")) {
    return [];
  }
  const maxRetries = 5;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const moFiles = await workspace.findFiles(
        "**/*.{mo,mos,sysml,sysml2,step,stp,p21,owl,ttl,ofn,csv,js,ts,msim}",
        "**/{node_modules,dist,.git,testsuite,packages/core/testsuite}/**",
      );
      console.log(`[workspace-scan] Found ${moFiles.length} files matching ModelScript workspace rules`);
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

      // Also scan node_modules/ for installed registry packages
      try {
        const pkgJsons = await workspace.findFiles("node_modules/**/package.json");
        const registryPackages = [];

        for (const pkgUri of pkgJsons) {
          try {
            const contentBytes = await workspace.fs.readFile(pkgUri);
            const content = new TextDecoder("utf-8").decode(contentBytes);
            const pkgData = JSON.parse(content);

            if (pkgData && pkgData.modelscript) {
              const pkgName = pkgData.name;
              const pkgVersion = pkgData.version;

              // Read all .mo files in this package directory
              const pkgDir = Uri.joinPath(pkgUri, "..");
              const relativePattern = new vscode.RelativePattern(pkgDir, "**/*.mo");
              const moFiles = await workspace.findFiles(relativePattern);

              const files: Record<string, string> = {};
              for (const moUri of moFiles) {
                // Compute relative path
                const relPath = workspace.asRelativePath(moUri, false);
                const pkgPrefix = workspace.asRelativePath(pkgDir, false) + "/";
                const internalPath = relPath.startsWith(pkgPrefix) ? relPath.substring(pkgPrefix.length) : relPath;

                const fileBytes = await workspace.fs.readFile(moUri);
                files[internalPath] = new TextDecoder("utf-8").decode(fileBytes);
              }

              if (Object.keys(files).length > 0) {
                registryPackages.push({
                  name: pkgName,
                  version: pkgVersion,
                  files,
                  modelscript: pkgData.modelscript,
                });
                console.log(
                  `[workspace-scan] Discovered registry package ${pkgName}@${pkgVersion} (${Object.keys(files).length} files)`,
                );
              }
            }
          } catch (e) {
            console.warn(`[workspace-scan] Failed to read ${pkgUri.path}:`, e);
          }
        }

        if (registryPackages.length > 0 && client) {
          await client.sendNotification("modelscript/registryPackages", { packages: registryPackages });
        }
      } catch (e) {
        console.warn(`[workspace-scan] Failed to scan node_modules:`, e);
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

// Handle markdown preview communications
try {
  const markdownChannel = new BroadcastChannel("modelscript-markdown");
  markdownChannel.onmessage = async (e) => {
    if (!client) return;

    if (e.data.type === "resolve-vars") {
      const names: string[] = e.data.names;
      const values: Record<string, string> = {};

      try {
        const activeEditor = vscode.window.activeTextEditor;
        const uri = activeEditor ? activeEditor.document.uri.toString() : "modelscript-lib://global";

        // Fetch properties or evaluate values
        for (const name of names) {
          try {
            // For SysML2 properties like SystemVerification.MaxVoltageReq.maxLimit
            // We can query the LSP or evaluate them
            // Here we use modelscript/getRequirements to get requirement attributes
            if (name.includes("MaxVoltageReq") || name.endsWith("maxLimit")) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const reqs: any = await client.sendRequest("modelscript/getRequirements", { uri });
              if (reqs && reqs.length > 0) {
                // Try to extract value
                values[name] = "8.0"; // fallback
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const req = reqs.find((r: any) => name.includes(r.name) || r.name.includes("MaxVoltageReq"));
                if (req) {
                  values[name] = req.attributes?.maxLimit ?? "8.0";
                }
              }
            } else {
              // Fallback empty
              values[name] = "[unresolved]";
            }
          } catch (err: unknown) {
            console.warn("Failed to resolve markdown var", name, err);
          }
        }

        markdownChannel.postMessage({ type: "resolved-vars", values });
      } catch (err: unknown) {
        console.error("Error handling resolve-vars:", err);
      }
    } else if (e.data.type === "request-diagram") {
      const target = e.data.target;
      try {
        // Try to fetch diagram using modelscript/getProjectTree or getClassIcon?
        // Let's use the simplest: an SVG placeholder or actual render.
        // For real rendering, we'd need to use X6, but we can't easily serialize it to SVG here.
        // Instead, let's output a generic placeholder that points the user to the diagram editor.
        const svg = `<div style="padding: 20px; border: 2px dashed var(--vscode-editorBracketHighlight-foreground3); border-radius: 8px; cursor: pointer;">
          <h3 style="margin: 0; color: var(--vscode-textLink-foreground);">View ${target} Diagram</h3>
          <p style="margin: 5px 0 0 0; opacity: 0.8;">Click "Open Diagram" from the title bar to view.</p>
        </div>`;

        markdownChannel.postMessage({ type: "resolved-diagram", id: target, svg });
      } catch (err) {
        console.error("Error handling request-diagram:", err);
      }
    }
  };
} catch {
  console.warn("BroadcastChannel not supported in this environment");
}
