// SPDX-License-Identifier: AGPL-3.0-or-later

import { StoppedEvent } from "@vscode/debugadapter";
import * as vscode from "vscode";
import { commands, workspace } from "vscode";
import { CfgEditorProvider } from "./cfg-editor-provider.js";
import { ChatViewProvider } from "./chat-panel.js";
import { registerChatParticipant } from "./chat-participant.js";
import { CloudStatusBar } from "./cloud-status-bar.js";
import { registerCollaborationPresence, type IdePeerPresence, type IdeSymbolCollision } from "./collab-presence.js";
import { registerDynamicActions } from "./controllers/action-router-controller.js";
import { registerAnalyticalCommands } from "./controllers/analytical-controller.js";
import { registerCadAndMeshingCommands } from "./controllers/cad-meshing-controller.js";
import { registerCloudCommands } from "./controllers/cloud-controller.js";
import { registerCosimCommands } from "./controllers/cosim-controller.js";
import { registerCustomEditors } from "./controllers/custom-editors-controller.js";
import { registerSimulationCommands } from "./controllers/simulation-controller.js";
import { TreeViewController } from "./controllers/tree-view-controller.js";
import { CosimViewProvider } from "./cosim-panel.js";
import { activeDebugSession } from "./debug-adapter.js";
import { DiagramEditorProvider } from "./diagram-editor-provider.js";
import { InpEditorProvider } from "./inp-editor-provider.js";
import { registerLLMProvider } from "./llm-provider.js";
import { registerMCPTools } from "./mcp-bridge.js";
import { registerMultiDomainScaffolding } from "./multi-domain-scaffolding.js";
import { ModelicaNotebookController } from "./notebook-controller.js";
import { ModelicaNotebookSerializer } from "./notebook-serializer.js";
import { registerPolyglotActions } from "./polyglot-actions.js";
import { PsoutEditorProvider } from "./psout-editor-provider.js";
import { registerRepl } from "./repl-terminal.js";
import { RequirementsEditorProvider } from "./requirements-editor-provider.js";
import { registerScmIntegration } from "./scm-integration.js";
import { registerSemanticDiffComments } from "./semantic-diff-comments.js";
import { DebugAdapterService } from "./services/debug-adapter-service.js";
import { HostBridgeService } from "./services/host-bridge-service.js";
import { LspClientManager } from "./services/lsp-client-manager.js";
import { MarkdownPreviewService } from "./services/markdown-preview-service.js";
import { initWorkspaceAndTree, registerVirtualFileSystems } from "./services/virtual-fs-service.js";
import { SimulationViewPanel } from "./simulation-view-panel.js";
import { StepEditorProvider } from "./step-editor-provider.js";
import {
  getLanguageMaturity,
  getLanguageMaturityBadge,
  getStatusBarConfig,
  isLanguageEnabled,
} from "./utils/config.js";
import { VrVisualizationPanel } from "./vr-visualization-panel.js";

let lspManager: LspClientManager | undefined;
export let languageWorker: Worker | undefined;

export async function activate(context: vscode.ExtensionContext) {
  console.log("ModelScript extension activated");

  const registeredCommandIds = new Set<string>();

  function safeRegisterCommand(
    commandId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callback: (...args: any[]) => any,
  ): vscode.Disposable {
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

  // 2. Virtual File Systems (memfs:// and modelica://)
  const { memFs, memfsRootUri } = registerVirtualFileSystems(context, () => lspManager?.client);

  // 3. Custom Editors & Documents (Diagram, FMU, SSP, STEP, GCode, INP, CFG, RAW, OLGA, Requirements, ElementTable)
  const { fmuContentProvider, diagramProvider } = registerCustomEditors(context, lspManager.client);

  // 4. Tree View Controller (Library, Experiments, MQTT, Registry, SCM, OWL2)
  const treeController = new TreeViewController(context, () => lspManager!.client, diagramProvider);
  context.subscriptions.push(treeController);

  // 5. Host Bridge Service (BroadcastChannel & mount handoff)
  const hostBridgeService = new HostBridgeService(
    context,
    memFs,
    memfsRootUri,
    () => treeController.libraryTreeProvider,
  );
  context.subscriptions.push(hostBridgeService);

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

  // 6. Notebook Controller & Serializer
  context.subscriptions.push(
    vscode.workspace.registerNotebookSerializer("modelscript-notebook", new ModelicaNotebookSerializer()),
  );
  const notebookController = new ModelicaNotebookController();
  notebookController.client = lspManager.client;
  context.subscriptions.push(notebookController);

  // 7. AI & Chat Integration
  try {
    registerLLMProvider(context);
  } catch {
    /* proposed API not available */
  }
  try {
    registerMCPTools(context, lspManager.client);
  } catch {
    /* proposed API not available */
  }
  try {
    registerChatParticipant(context);
  } catch {
    /* ignore */
  }

  const chatProvider = new ChatViewProvider(context.extensionUri, lspManager.client);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  // 8. Co-Simulation Sidebar View Provider
  const cosimProvider = new CosimViewProvider(context.extensionUri, lspManager.client);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CosimViewProvider.viewType, cosimProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

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

  // 10. Status Bar Items
  const cloudStatusBar = new CloudStatusBar();
  context.subscriptions.push(cloudStatusBar);

  const shareStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  shareStatusBar.text = "$(sparkle) Share to Feed";
  shareStatusBar.tooltip = "Share active model snippet or results to ModelScript social feed";
  shareStatusBar.command = "modelscript.shareToFeed";
  const updateShareStatusBarVisibility = () => {
    const { visibility, showSocialFeed } = getStatusBarConfig();
    if (showSocialFeed && visibility !== "never") {
      shareStatusBar.show();
    } else {
      shareStatusBar.hide();
    }
  };
  updateShareStatusBarVisibility();
  context.subscriptions.push(shareStatusBar);

  safeRegisterCommand("modelscript.shareToFeed", () => hostBridgeService.sendShareToFeed());
  safeRegisterCommand("modelscript.collectWorkspaceSnapshot", () => hostBridgeService.collectWorkspaceSnapshot());

  // 11. Start Language Server Client & Notification Handlers
  let isScmRegistered = false;
  lspManager.onBindNotifications((targetClient) => {
    targetClient.onNotification(
      "modelscript/debuggerStopped",
      (params: { uri?: string | undefined; line?: number | undefined; column?: number | undefined }) => {
        if (activeDebugSession) {
          activeDebugSession.lastStoppedUri = params.uri;
          activeDebugSession.lastStoppedLine = params.line;
          activeDebugSession.lastStoppedColumn = params.column;
          activeDebugSession.sendEvent(new StoppedEvent("step", 1));
        }
      },
    );

    targetClient.onNotification("modelscript/status", (params: { state: string; message: string }) => {
      if (params.state === "ready") {
        treeController.libraryTreeProvider.refresh();
        treeController.experimentsTreeProvider?.refresh();

        if (!isScmRegistered && lspManager?.client) {
          isScmRegistered = true;
          registerScmIntegration(context, lspManager.client);
          registerSemanticDiffComments(context, lspManager.client);
        }

        setTimeout(() => markdownService.refreshMarkdownData(), 3000);
      }
    });

    targetClient.onNotification("modelscript/warning", (params: { message: string }) => {
      vscode.window.showWarningMessage(params.message);
    });

    targetClient.onNotification(
      "modelscript/cosimStream",
      async (msg: {
        type: string;
        participantId: string;
        time: number;
        data?: number[] | undefined;
        payload?: any;
      }) => {
        const { CadViewerPanel } = await import("./cad-viewer-panel.js");
        if (CadViewerPanel.currentPanel) {
          if (msg.type === "vtk") {
            CadViewerPanel.currentPanel.postMessage({
              type: "VTK_PAYLOAD",
              data: {
                pid: msg.participantId,
                time: msg.time,
                buffer: new Uint8Array(msg.data || []),
              },
            });
          } else if (msg.type === "fea-frame" || msg.type === "fea") {
            CadViewerPanel.currentPanel.sendFeaPayload(msg.payload || msg);
          } else {
            CadViewerPanel.currentPanel.postMessage(msg);
          }
        }
      },
    );
  });

  try {
    await lspManager.start();
    languageWorker = lspManager.languageWorker;
    console.log("ModelScript language server is ready");
  } catch (e) {
    console.error("ModelScript language server failed to start:", e);
  }

  safeRegisterCommand("modelscript.restartLsp", async () => {
    if (!lspManager) return;
    try {
      await lspManager.restart();
      languageWorker = lspManager.languageWorker;
      notebookController.client = lspManager.client;
      treeController.libraryTreeProvider.refresh();
      treeController.experimentsTreeProvider?.refresh();
      vscode.window.showInformationMessage("ModelScript language server restarted successfully.");
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to restart language server: ${err?.message || err}`);
    }
  });

  // 12. Register Dynamic Actions and Modular Command Controllers
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
    ...registerCadAndMeshingCommands(context, lspManager.client),
    registerPolyglotActions(context, lspManager.client),
    registerMultiDomainScaffolding(context),
  );

  // 13. UI Navigation & Diagram Commands
  context.subscriptions.push(
    safeRegisterCommand("modelscript.openDiagram", async () => {
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor?.document && activeEditor.document.uri.scheme !== "output") {
        try {
          const docUri = activeEditor.document.uri;
          if (docUri.scheme === "memfs") {
            const content = new TextEncoder().encode(activeEditor.document.getText());
            await workspace.fs.writeFile(docUri, content);
          }
          const filePath = docUri.path.toLowerCase();
          const targetViewType =
            filePath.endsWith(".step") || filePath.endsWith(".stp")
              ? StepEditorProvider.viewType
              : filePath.endsWith(".inp") || filePath.endsWith(".inpt")
                ? InpEditorProvider.viewType
                : filePath.endsWith(".cfg") || filePath.endsWith(".cfgt")
                  ? CfgEditorProvider.viewType
                  : filePath.endsWith(".sysml") || filePath.endsWith(".sysml2")
                    ? "sysml2.diagramEditor"
                    : filePath.endsWith(".mo")
                      ? "modelica.diagramEditor"
                      : filePath.endsWith(".pscx") ||
                          filePath.endsWith(".pslx") ||
                          filePath.endsWith(".pswx") ||
                          filePath.endsWith(".psmx")
                        ? "pscad.diagramEditor"
                        : filePath.endsWith(".psout")
                          ? PsoutEditorProvider.viewType
                          : DiagramEditorProvider.viewType;
          try {
            await vscode.commands.executeCommand("vscode.openWith", docUri, targetViewType);
          } catch {
            await vscode.commands.executeCommand("vscode.openWith", docUri, DiagramEditorProvider.viewType);
          }
        } catch (e: unknown) {
          vscode.window.showErrorMessage(`Failed to open diagram: ${(e as Error)?.message || e}`);
        }
      }
    }),

    safeRegisterCommand("modelscript.openDiagramSource", () => {
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
      if (
        tab?.input instanceof vscode.TabInputCustom &&
        (tab.input.viewType === DiagramEditorProvider.viewType || tab.input.viewType.endsWith(".diagramEditor"))
      ) {
        vscode.window.showTextDocument(tab.input.uri, { viewColumn: vscode.ViewColumn.One });
      }
    }),

    safeRegisterCommand("modelscript.addToDiagram", async (firstArg: unknown) => {
      if (!lspManager?.client) return;

      let className: string | undefined;
      if (firstArg && typeof firstArg === "object" && "info" in firstArg) {
        const item = firstArg as { info: { compositeName: string } };
        className = item.info.compositeName;
      } else if (firstArg && typeof firstArg === "object" && "elementInfo" in firstArg) {
        const item = firstArg as { elementInfo: { type: string; element?: { elementType: string } | undefined } };
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
        if (
          tab?.input instanceof vscode.TabInputCustom &&
          (tab.input.viewType === DiagramEditorProvider.viewType || tab.input.viewType.endsWith(".diagramEditor"))
        ) {
          docUri = tab.input.uri.toString();
        }
      }
      if (!docUri) {
        vscode.window.showWarningMessage("Open a diagram or model file first.");
        return;
      }

      try {
        const response: any = await lspManager.client.sendRequest("modelscript/diagram.applyEdits", {
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
        vscode.window.showErrorMessage(`Failed to add component: ${e}`);
      }
    }),

    safeRegisterCommand("modelscript.openRequirements", async () => {
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

    safeRegisterCommand("modelscript.openVrVisualization", () => {
      VrVisualizationPanel.createOrShow(context.extensionUri);
    }),

    safeRegisterCommand("modelscript.owl2.goToDeclaration", async (iri: string) => {
      if (!iri) return;
      const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
        "vscode.executeWorkspaceSymbolProvider",
        iri,
      );
      const match = symbols?.find((s) => s.name === iri || s.containerName === iri) ?? symbols?.[0];
      if (match?.location) {
        const doc = await vscode.workspace.openTextDocument(match.location.uri);
        const editor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One });
        editor.selection = new vscode.Selection(match.location.range.start, match.location.range.end);
        editor.revealRange(match.location.range, vscode.TextEditorRevealType.InCenter);
      } else {
        vscode.window.showInformationMessage(`Navigating to OWL2 IRI: ${iri}`);
      }
    }),

    safeRegisterCommand("modelscript.decomposeRegions", async (uri?: string, actionName?: string) => {
      if (!lspManager?.client) return;
      const targetUri = uri || vscode.window.activeTextEditor?.document.uri.toString();
      if (!targetUri) return;
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Computing symbolic region decomposition for ${actionName || "action"}...`,
          cancellable: false,
        },
        async () => {
          try {
            const res = await lspManager!.client.sendRequest<any>("modelscript/decomposeRegions", {
              uri: targetUri,
            });
            if (res?.success) {
              vscode.window.showInformationMessage(
                `Decomposed ${res.result?.regions?.length ?? 0} non-overlapping invariant regions with Octagon difference bounds.`,
              );
            }
          } catch (e: any) {
            vscode.window.showErrorMessage(`Region decomposition failed: ${e?.message || e}`);
          }
        },
      );
    }),

    safeRegisterCommand("modelscript.openSimulationView", async (uri?: vscode.Uri, className?: string) => {
      let targetUri = uri;
      if (!targetUri && vscode.window.activeTextEditor) {
        targetUri = vscode.window.activeTextEditor.document.uri;
      }
      if (!targetUri) return;
      if (!className) {
        className = await vscode.window.showInputBox({ prompt: "Enter the Study class name to simulate:" });
        if (!className) return;
      }
      if (lspManager?.client) {
        SimulationViewPanel.createOrShow(context, lspManager.client, className, targetUri.toString());
      }
    }),

    safeRegisterCommand(
      "modelscript.runPhysicsSimulation",
      async (args?: { uri: string; className?: string | undefined }) => {
        if (!lspManager?.client) return;
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
              const { CadViewerPanel } = await import("./cad-viewer-panel.js");
              CadViewerPanel.createOrShow(context.extensionUri, lspManager!.client);

              const result = await lspManager!.client.sendRequest<any>("modelscript/simulatePhysics", {
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
      },
    ),

    safeRegisterCommand("modelscript.openChat", () => {
      vscode.commands.executeCommand("modelscript.chat.focus");
    }),

    safeRegisterCommand("modelscript.openMultibodyAnimation", async (args?: { uri?: string | undefined }) => {
      if (!lspManager?.client) return;
      const uri = args?.uri || vscode.window.activeTextEditor?.document.uri.toString();
      if (!uri) return;

      const docText = vscode.window.activeTextEditor?.document.getText();
      const { MultiBodyAnimationPanel } = await import("./multibody-animation-panel.js");
      MultiBodyAnimationPanel.createOrShow(
        context.extensionUri,
        lspManager.client,
        { t: [0], y: [[0]], states: ["time"] },
        uri,
        docText,
      );
    }),

    safeRegisterCommand("modelscript.configureLanguages", async () => {
      const contributedLanguages =
        (context.extension?.packageJSON?.contributes?.languages as
          | { id: string; aliases?: string[] | undefined; extensions?: string[] | undefined }[]
          | undefined) || [];
      if (contributedLanguages.length === 0) {
        vscode.commands.executeCommand("workbench.action.openSettings", "modelscript.languages");
        return;
      }

      type LangPickItem = vscode.QuickPickItem & { langId?: string };
      const items: LangPickItem[] = [];
      const tiers: ("stable" | "beta" | "experimental")[] = ["stable", "beta", "experimental"];
      const tierHeaders: Record<"stable" | "beta" | "experimental", string> = {
        stable: "🟢 Stable Languages (Production-ready)",
        beta: "🟡 Beta Languages (Active domain toolchains)",
        experimental: "🧪 Experimental Languages (Preview / Grammar & AST)",
      };

      for (const tier of tiers) {
        const group = contributedLanguages.filter((l) => getLanguageMaturity(l.id) === tier);
        if (group.length === 0) continue;
        items.push({
          label: tierHeaders[tier],
          kind: vscode.QuickPickItemKind.Separator,
        });
        for (const lang of group) {
          const displayName = lang.aliases?.[0] ?? lang.id;
          const badge = getLanguageMaturityBadge(lang.id);
          const exts = (lang.extensions ?? []).join(", ");
          items.push({
            label: displayName,
            description: `[${badge}]  ${exts}`,
            picked: isLanguageEnabled(lang.id),
            langId: lang.id,
          });
        }
      }

      const selected = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        title: "ModelScript: Configure Enabled Languages & Maturity Tiers",
        placeHolder: "Select which engineering languages to enable in this workspace",
      });
      if (!selected) return;

      const selectedIds = new Set(selected.map((s) => s.langId).filter((id): id is string => Boolean(id)));
      const cfg = vscode.workspace.getConfiguration("modelscript");
      for (const lang of contributedLanguages) {
        const shouldEnable = selectedIds.has(lang.id);
        if (isLanguageEnabled(lang.id) !== shouldEnable) {
          await cfg.update(`languages.${lang.id}.enabled`, shouldEnable, vscode.ConfigurationTarget.Global);
        }
      }
      lspManager?.updateActiveEditorStatusBar(vscode.window.activeTextEditor?.document.languageId);
      lspManager?.syncSettingsToServer();
      vscode.window.showInformationMessage(
        `Updated ModelScript enabled languages (${selectedIds.size} of ${contributedLanguages.length} enabled).`,
      );
    }),
  );

  // 14. Editor Active State, Configuration Sync, and Viewport Tracking
  lspManager.updateActiveEditorStatusBar(vscode.window.activeTextEditor?.document.languageId);
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor?.document && editor.document.uri.scheme !== "output") {
        treeController.libraryTreeProvider.setDocumentUri(editor.document.uri.toString());
      }
      const langId = editor?.document.languageId;
      lspManager?.updateActiveEditorStatusBar(langId);
      vscode.commands.executeCommand("setContext", "modelscript.activeLanguage", langId);
      vscode.commands.executeCommand(
        "setContext",
        "modelscript.sysml2Active",
        langId === "sysml" || langId === "sysml2",
      );
      vscode.commands.executeCommand("setContext", "modelscript.owl2Active", langId === "owl2");
      if (langId) {
        vscode.commands.executeCommand("setContext", `modelscript.${langId}Active`, isLanguageEnabled(langId));
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("modelscript.ui.statusBar") || e.affectsConfiguration("modelscript.languages")) {
        updateShareStatusBarVisibility();
        lspManager?.updateActiveEditorStatusBar(vscode.window.activeTextEditor?.document.languageId);
      }
      if (e.affectsConfiguration("modelscript")) {
        lspManager?.syncSettingsToServer();
      }
    }),
  );

  let visibleRangeTimer: ReturnType<typeof setTimeout> | undefined;
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
      if (!lspManager?.client) return;
      clearTimeout(visibleRangeTimer);
      visibleRangeTimer = setTimeout(() => {
        const uri = e.textEditor.document.uri.toString();
        const ranges = e.visibleRanges.map((r) => ({
          startLine: r.start.line,
          endLine: r.end.line,
        }));
        lspManager?.client?.sendNotification("modelscript/visibleRanges", { uri, ranges });
      }, 150);
    }),
  );

  // 15. Workspace and File Pre-Discovery
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
