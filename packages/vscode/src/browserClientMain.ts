import * as vscode from "vscode";
import { Uri, commands, workspace } from "vscode";
import { LanguageClientOptions } from "vscode-languageclient";
import { LanguageClient } from "vscode-languageclient/browser";
import { ChatViewProvider } from "./chatPanel";
import { CosimViewProvider } from "./cosimPanel";
import { DiagramEditorProvider } from "./diagramEditorProvider";
import { LibraryTreeProvider } from "./libraryTreeProvider";
import { registerLLMProvider } from "./llmProvider";
import { registerMCPTools } from "./mcpBridge";
import { MqttTreeProvider } from "./mqttTreeProvider";
import { ModelicaNotebookController } from "./notebookController";
import { ModelicaNotebookSerializer } from "./notebookSerializer";
import { ProjectTreeProvider } from "./projectTreeProvider";
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
  const mqttTreeProvider = new MqttTreeProvider(client);
  const mqttTreeView = vscode.window.createTreeView("modelscript.mqttTree", {
    treeDataProvider: mqttTreeProvider,
    dragAndDropController: mqttTreeProvider,
    canSelectMany: false,
  });
  context.subscriptions.push(mqttTreeView);
  mqttTreeProvider.startPolling();

  // Register co-simulation panel (sidebar webview)
  const cosimProvider = new CosimViewProvider(context.extensionUri, client);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CosimViewProvider.viewType, cosimProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  // Register project tree view
  const projectTreeProvider = new ProjectTreeProvider(client);
  const projectTreeView = vscode.window.createTreeView("modelscript.projectTree", {
    treeDataProvider: projectTreeProvider,
    canSelectMany: false,
  });
  context.subscriptions.push(projectTreeView);

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
        projectTreeProvider.refresh();
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
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor && activeEditor.document.languageId === "modelica") {
        vscode.commands.executeCommand("vscode.openWith", activeEditor.document.uri, DiagramEditorProvider.viewType);
      }
    }),
    commands.registerCommand("modelscript.openDiagramSource", () => {
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
      if (tab?.input instanceof vscode.TabInputCustom && tab.input.viewType === DiagramEditorProvider.viewType) {
        vscode.commands.executeCommand("vscode.openWith", tab.input.uri, "default");
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
      } else {
        SimulationPanel.createOrShow(context.extensionUri, client);
      }
    }),
    commands.registerCommand("modelscript.addToDiagram", async (firstArg: unknown, secondArg?: string) => {
      if (!client) return;

      // Support both context menu (LibraryTreeItem) and direct call (className, classKind, iconSvg)
      let className: string;
      let classKind: string;
      if (firstArg && typeof firstArg === "object" && "info" in firstArg) {
        // Called from tree item context menu
        const item = firstArg as { info: { compositeName: string; classKind: string; iconSvg?: string } };
        className = item.info.compositeName;
        classKind = item.info.classKind;
      } else {
        className = firstArg as string;
        classKind = secondArg ?? "";
      }

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
    commands.registerCommand("modelscript.openProjectFile", async (uri: string, line?: number) => {
      try {
        const docUri = vscode.Uri.parse(uri);
        const doc = await workspace.openTextDocument(docUri);
        const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
        if (line !== undefined) {
          const position = new vscode.Position(line, 0);
          editor.selection = new vscode.Selection(position, position);
          editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
        }
      } catch (e) {
        console.error("[project-tree] Error opening file:", e);
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
  );

  // Listen for project tree updates from the LSP server
  client.onNotification("modelscript/projectTreeChanged", () => {
    projectTreeProvider.refresh();
  });

  // Watch for .mo file changes to refresh the project tree
  const moWatcher = vscode.workspace.createFileSystemWatcher("**/*.mo");
  moWatcher.onDidCreate(() => projectTreeProvider.refresh());
  moWatcher.onDidDelete(() => projectTreeProvider.refresh());
  context.subscriptions.push(moWatcher);

  // Register the custom editor provider for modelica diagrams
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(DiagramEditorProvider.viewType, diagramProvider, {
      webviewOptions: { retainContextWhenHidden: true },
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
          // Co-simulation example: Controller (Modelica) + Plant (FMU)
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

          const plantXml = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            "<fmiModelDescription",
            '  fmiVersion="2.0"',
            '  modelName="Plant"',
            '  guid="{plant-example-001}"',
            '  description="First-order plant: dx/dt = -a*x + b*u, y = x"',
            '  generationTool="ModelScript">',
            '  <CoSimulation modelIdentifier="Plant" />',
            '  <DefaultExperiment startTime="0" stopTime="10" stepSize="0.01" />',
            "  <ModelVariables>",
            '    <ScalarVariable name="u" valueReference="0" causality="input" variability="continuous" description="Control input">',
            '      <Real start="0.0" />',
            "    </ScalarVariable>",
            '    <ScalarVariable name="y" valueReference="1" causality="output" variability="continuous" description="Plant output">',
            '      <Real start="0.5" />',
            "    </ScalarVariable>",
            '    <ScalarVariable name="x" valueReference="2" causality="local" variability="continuous" description="State">',
            '      <Real start="0.5" />',
            "    </ScalarVariable>",
            "  </ModelVariables>",
            "  <ModelStructure>",
            '    <Outputs><Unknown index="2" /></Outputs>',
            "  </ModelStructure>",
            "</fmiModelDescription>",
            "",
          ].join("\n");

          const readmeMd = [
            "# Co-Simulation Example",
            "",
            "This workspace demonstrates co-simulation between a **Modelica model** and an **FMU 2.0 participant**.",
            "",
            "## Files",
            "",
            "| File | Type | Description |",
            "|------|------|-------------|",
            "| `Controller.mo` | Modelica | PI controller with setpoint tracking |",
            "| `Plant.xml` | FMU 2.0 | First-order plant model description |",
            "",
            "## Running the Co-Simulation",
            "",
            "1. Open the **Co-Simulation** panel in the sidebar",
            '2. Click **"Browser-Local"** to enable local mode',
            "3. Create a new session (start=0, stop=10, step=0.01)",
            "4. Open `Controller.mo` and click **Publish Model**",
            "5. Click **Publish FMU** and select `Plant.xml`",
            "6. Add couplings:",
            "   - Controller.y → Plant.u (control signal)",
            "   - Plant.y → Controller.u (measurement feedback)",
            "7. Click **Start** to run the coupled simulation",
            "8. Open **Live Plot** to see real-time results",
            "",
          ].join("\n");

          // Write all files
          const controllerUri = Uri.joinPath(workspaceUri, "Controller.mo");
          const plantUri = Uri.joinPath(workspaceUri, "Plant.xml");
          const readmeUri = Uri.joinPath(workspaceUri, "README.md");

          const cosimSetupMo = [
            'model CosimSetup "Co-simulation wiring diagram"',
            "  Controller controller;",
            "  Plant plant;",
            "equation",
            "  connect(controller.y, plant.u);",
            "  connect(plant.y, controller.u);",
            "end CosimSetup;",
            "",
          ].join("\n");

          const cosimSetupUri = Uri.joinPath(workspaceUri, "CosimSetup.mo");

          await workspace.fs.writeFile(controllerUri, encoder.encode(controllerMo));
          await workspace.fs.writeFile(plantUri, encoder.encode(plantXml));
          await workspace.fs.writeFile(cosimSetupUri, encoder.encode(cosimSetupMo));
          await workspace.fs.writeFile(readmeUri, encoder.encode(readmeMd));

          // Open the co-sim setup model as the primary file
          filename = "CosimSetup.mo";
          content = cosimSetupMo;

          // Also open the controller
          const controllerDoc = await workspace.openTextDocument(controllerUri);
          await vscode.window.showTextDocument(controllerDoc, { preview: false });
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
      }
    } catch (e) {
      console.warn("[blank-project] Failed to create template model:", e);
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
