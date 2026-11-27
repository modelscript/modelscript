// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import { commands } from "vscode";
import { ChatViewProvider } from "./chat-panel.js";
import { registerChatParticipant } from "./chat-participant.js";
import { CloudStatusBar } from "./cloud-status-bar.js";
import { type IdePeerPresence, type IdeSymbolCollision, registerCollaborationPresence } from "./collab-presence.js";
import { registerDynamicActions } from "./controllers/action-router-controller.js";
import { registerAlmAndUriCommands } from "./controllers/alm-and-uri-controller.js";
import { registerAnalyticalCommands } from "./controllers/analytical-controller.js";
import { registerCadAndMeshingCommands } from "./controllers/cad-meshing-controller.js";
import { registerCloudCommands } from "./controllers/cloud-controller.js";
import { registerCosimCommands } from "./controllers/cosim-controller.js";
import { registerCustomEditors } from "./controllers/custom-editors-controller.js";
import { registerDiagramNavigationCommands } from "./controllers/diagram-navigation-controller.js";
import { registerLspNotificationHandlers } from "./controllers/lsp-notifications-controller.js";
import { registerSimulationCommands } from "./controllers/simulation-controller.js";
import { registerSysmlRunnerCommands } from "./controllers/sysml-runner-controller.js";
import { TreeViewController } from "./controllers/tree-view-controller.js";
import { registerWorkspaceConfigController } from "./controllers/workspace-config-controller.js";
import { CosimViewProvider } from "./cosim-panel.js";
import { HardwareDongleStatusBar } from "./hardware-dongle-status-bar.js";
import { registerLLMProvider } from "./llm-provider.js";
import { registerMCPTools } from "./mcp-bridge.js";
import { registerMultiDomainScaffolding } from "./multi-domain-scaffolding.js";
import { ModelicaNotebookController } from "./notebook-controller.js";
import { ModelicaNotebookSerializer } from "./notebook-serializer.js";
import { registerPolyglotActions } from "./polyglot-actions.js";
import { registerRepl } from "./repl-terminal.js";
import { DebugAdapterService } from "./services/debug-adapter-service.js";
import { HostBridgeService } from "./services/host-bridge-service.js";
import { LspClientManager } from "./services/lsp-client-manager.js";
import { MarkdownPreviewService } from "./services/markdown-preview-service.js";
import { StepCompilationService } from "./services/step-compilation-service.js";
import { initWorkspaceAndTree, registerVirtualFileSystems } from "./services/virtual-fs-service.js";
import { TrainingStudioPanelProvider } from "./webview/training-studio-panel.js";

let lspManager: LspClientManager | undefined;
export let languageWorker: Worker | undefined;

export async function activate(context: vscode.ExtensionContext) {
  console.log("ModelScript extension activated");

  const registeredCommandIds = new Set<string>();

  function safeRegisterCommand(commandId: string, callback: (...args: never[]) => unknown): vscode.Disposable {
    if (registeredCommandIds.has(commandId)) {
      return { dispose: () => {} };
    }
    try {
      const disp = commands.registerCommand(commandId, callback);
      registeredCommandIds.add(commandId);
      return disp;
    } catch (err) {
      console.warn(`[client] Command '${commandId}' already registered or could not be registered:`, err);
      return { dispose: () => {} };
    }
  }

  // 1. LSP Client Manager & Services
  lspManager = new LspClientManager(context);
  context.subscriptions.push(lspManager);

  const debugAdapterService = new DebugAdapterService(context, () => lspManager?.client);
  context.subscriptions.push(debugAdapterService);

  const markdownService = new MarkdownPreviewService(context, () => lspManager?.client);
  context.subscriptions.push(markdownService);

  const stepCompilationService = new StepCompilationService(() => lspManager?.client);
  context.subscriptions.push(stepCompilationService);

  // 2. Virtual File Systems (memfs:// and modelica://)
  const { memFs, memfsRootUri } = registerVirtualFileSystems(context, () => lspManager?.client);

  // 3. Custom Editors & Documents (Diagram, FMU, SSP, STEP, GCode, INP, CFG, RAW, OLGA, Requirements, ElementTable)
  const { fmuContentProvider, diagramProvider } = registerCustomEditors(
    context,
    lspManager.client,
    stepCompilationService,
  );

  // 4. Tree View Controller (Library, Experiments, MQTT, Registry, SCM, OWL2)
  const treeController = new TreeViewController(context, () => lspManager!.client, diagramProvider);
  context.subscriptions.push(treeController);

  // 5. Host Bridge Service, ALM Commands & URI Handler
  const hostBridgeService = new HostBridgeService(
    context,
    memFs,
    memfsRootUri,
    () => treeController.libraryTreeProvider,
  );
  context.subscriptions.push(hostBridgeService, ...registerAlmAndUriCommands(hostBridgeService, memfsRootUri));

  // 6. Notebook Controller & Serializer
  context.subscriptions.push(
    vscode.workspace.registerNotebookSerializer("modelscript-notebook", new ModelicaNotebookSerializer()),
  );
  const notebookController = new ModelicaNotebookController();
  notebookController.client = lspManager.client;
  context.subscriptions.push(notebookController);

  // 7. AI & Chat Integration
  try {
    if (
      typeof (vscode.lm as unknown as { registerChatModelProvider?: unknown })?.registerChatModelProvider === "function"
    ) {
      registerLLMProvider(context);
    }
  } catch {
    /* proposed API not available */
  }
  try {
    if (typeof vscode.lm?.registerTool === "function") {
      registerMCPTools(context, lspManager.client);
    }
  } catch {
    /* proposed API not available */
  }
  try {
    if (typeof vscode.chat?.createChatParticipant === "function") {
      registerChatParticipant(context);
    }
  } catch {
    /* ignore */
  }

  const chatProvider = new ChatViewProvider(context.extensionUri, lspManager.client, context.secrets);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  // 8. Co-Simulation & Dynamic-m Training Studio Sidebar View Providers
  const cosimProvider = new CosimViewProvider(context.extensionUri, lspManager.client);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CosimViewProvider.viewType, cosimProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );
  TrainingStudioPanelProvider.register(context, lspManager.client);

  // 9. Collaboration Presence
  try {
    const collabController = registerCollaborationPresence(context);
    lspManager.onBindNotifications((targetClient) => {
      targetClient.onNotification(
        "modelscript/peerPresenceChanged",
        (params: { documentUri: string; peers: IdePeerPresence[]; collisions?: IdeSymbolCollision[] }) => {
          if (params?.documentUri && Array.isArray(params.peers)) {
            collabController.updateDocumentState(params.documentUri, params.peers, params.collisions ?? []);
          }
        },
      );
    });
  } catch (e) {
    console.warn("Could not register collaboration presence:", e);
  }

  // 10. Status Bar Items & Host Bridge Share Commands
  context.subscriptions.push(
    new CloudStatusBar(),
    new HardwareDongleStatusBar(),
    safeRegisterCommand("modelscript.shareToFeed", () => hostBridgeService.sendShareToFeed()),
    safeRegisterCommand("modelscript.collectWorkspaceSnapshot", () => hostBridgeService.collectWorkspaceSnapshot()),
  );

  // 11. LSP Notification Handlers & Language Server Startup
  context.subscriptions.push(
    ...(await registerLspNotificationHandlers(context, lspManager, treeController, markdownService)),
  );

  try {
    await lspManager.start();
    languageWorker = lspManager.languageWorker;
  } catch (e) {
    console.error("ModelScript language server failed to start:", e);
  }

  context.subscriptions.push(
    safeRegisterCommand("modelscript.restartLsp", async () => {
      if (!lspManager) return;
      try {
        await lspManager.restart();
        languageWorker = lspManager.languageWorker;
        notebookController.client = lspManager.client;
        treeController.libraryTreeProvider.refresh();
        treeController.experimentsTreeProvider?.refresh();
        vscode.window.showInformationMessage("ModelScript language server restarted successfully.");
      } catch (err: unknown) {
        vscode.window.showErrorMessage(
          `Failed to restart language server: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }),
  );

  // 12. Dynamic Actions, REPL & Modular Command Controllers
  if (lspManager.client) {
    await registerDynamicActions(context, lspManager.client, safeRegisterCommand);
    registerRepl(context, lspManager.client);
  }

  context.subscriptions.push(
    ...registerSimulationCommands(context, lspManager.client, lspManager.outputChannel, fmuContentProvider, () =>
      markdownService.refreshMarkdownData(),
    ),
    ...registerCloudCommands(context, lspManager.client, treeController.experimentsTreeProvider),
    ...registerCosimCommands(context, cosimProvider, treeController.mqttTreeProvider),
    ...registerAnalyticalCommands(context, lspManager.client, markdownService.markdownVarCache, () =>
      markdownService.scheduleMarkdownRefresh(),
    ),
    ...registerCadAndMeshingCommands(context, lspManager.client, stepCompilationService),
    ...registerSysmlRunnerCommands(context, lspManager.client),
    ...registerDiagramNavigationCommands(context, () => lspManager?.client, safeRegisterCommand),
    ...registerWorkspaceConfigController(context, () => lspManager, treeController, safeRegisterCommand),
    registerPolyglotActions(context, lspManager.client),
    registerMultiDomainScaffolding(context),
  );

  // 13. Workspace and File Pre-Discovery
  initWorkspaceAndTree(treeController.libraryTreeProvider, treeController.libraryTreeView, memFs).catch((e) => {
    console.warn("[workspace-init] Non-fatal initialization error:", e);
  });

  return { extendMarkdownIt: markdownService.getMarkdownItPlugin() };
}

export async function deactivate(): Promise<void> {
  if (lspManager) {
    try {
      await lspManager.stop();
    } catch {
      // ignore stop errors
    }
    lspManager = undefined;
  }
}
