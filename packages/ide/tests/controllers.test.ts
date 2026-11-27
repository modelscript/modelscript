// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser";
import { isValidPackageInstallSpec, registerAlmAndUriCommands } from "../src/controllers/alm-and-uri-controller.js";
import { registerCloudCommands } from "../src/controllers/cloud-controller.js";
import { registerCosimCommands } from "../src/controllers/cosim-controller.js";
import {
  registerDiagramNavigationCommands,
  resolveTargetDiagramViewType,
  type SafeRegisterCommand,
} from "../src/controllers/diagram-navigation-controller.js";
import { registerLspNotificationHandlers } from "../src/controllers/lsp-notifications-controller.js";
import { registerWorkspaceConfigController } from "../src/controllers/workspace-config-controller.js";
import type { CosimViewProvider } from "../src/cosim-panel.js";
import { DiagramEditorProvider } from "../src/diagram-editor-provider.js";
import type { ExperimentsTreeProvider } from "../src/experiments-tree.js";
import type { MqttTreeProvider } from "../src/mqtt-tree-provider.js";
import { PsoutEditorProvider } from "../src/psout-editor-provider.js";
import { RequirementsEditorProvider } from "../src/requirements-editor-provider.js";
import type { HostBridgeService } from "../src/services/host-bridge-service.js";
import { StepEditorProvider } from "../src/step-editor-provider.js";
import { TabularPlotEditorProvider } from "../src/tabular-plot-editor-provider.js";

type CommandHandler = (...args: unknown[]) => unknown;

function patchProp<T extends object, K extends keyof T>(obj: T, key: K, value: unknown): () => void {
  const prev = obj[key];
  (obj as Record<keyof T, unknown>)[key] = value;
  return () => {
    (obj as Record<keyof T, unknown>)[key] = prev;
  };
}

function createMockExtensionContext(): vscode.ExtensionContext {
  return {
    extensionUri: vscode.Uri.file("/ext"),
    subscriptions: [],
    secrets: {
      get: async () => undefined,
      store: async () => {},
      delete: async () => {},
      onDidChange: () => new vscode.Disposable(() => {}),
    },
    extension: {
      packageJSON: {
        contributes: {
          languages: [
            { id: "modelica", aliases: ["Modelica"], extensions: [".mo"] },
            { id: "sysml2", aliases: ["SysML v2"], extensions: [".sysml"] },
          ],
        },
      },
    },
  } as unknown as vscode.ExtensionContext;
}

function captureRegisteredCommands(): {
  handlers: Map<string, CommandHandler>;
  disposedIds: string[];
  safeRegister: SafeRegisterCommand;
  restore: () => void;
} {
  const handlers = new Map<string, CommandHandler>();
  const disposedIds: string[] = [];
  const restore = patchProp(vscode.commands, "registerCommand", (id: string, cb: CommandHandler) => {
    handlers.set(id, cb);
    return new vscode.Disposable(() => {
      disposedIds.push(id);
      handlers.delete(id);
    });
  });

  const safeRegister: SafeRegisterCommand = (commandId, callback) => {
    return vscode.commands.registerCommand(commandId, callback as CommandHandler);
  };

  return { handlers, disposedIds, safeRegister, restore };
}

describe("IDE Controllers — ALM & URI Controller", () => {
  it("validates package install specs against traversal and injection", () => {
    assert.equal(isValidPackageInstallSpec("Modelica", "4.1.0"), true);
    assert.equal(isValidPackageInstallSpec("@org/my-pkg_1", "1.2.3-beta+build.4"), true);
    assert.equal(isValidPackageInstallSpec("../escape", "1.0.0"), false);
    assert.equal(isValidPackageInstallSpec("pkg..name", "1.0.0"), false);
    assert.equal(isValidPackageInstallSpec("pkg", "1.0..0"), false);
    assert.equal(isValidPackageInstallSpec("pkg;rm -rf /", "latest"), false);
    assert.equal(isValidPackageInstallSpec("", "latest"), false);
  });

  it("registers commands and URI handler, handles ALM openExternal, syncPull, and URI install security", async () => {
    const cap = captureRegisteredCommands();
    let capturedUriHandler: vscode.UriHandler | undefined;
    const warnings: string[] = [];
    const errors: string[] = [];
    const infos: string[] = [];
    const openedExternal: string[] = [];
    const executedCommands: Array<{ id: string; args: unknown[] }> = [];
    const writtenFiles: Array<{ path: string; text: string }> = [];
    const publishedPayloads: unknown[] = [];
    let inputCall = 0;

    const restorers: Array<() => void> = [
      cap.restore,
      patchProp(vscode.window, "registerUriHandler", (handler: vscode.UriHandler) => {
        capturedUriHandler = handler;
        return new vscode.Disposable(() => {
          capturedUriHandler = undefined;
        });
      }),
      patchProp(vscode.window, "showWarningMessage", async (msg: string) => {
        warnings.push(msg);
        return "Install";
      }),
      patchProp(vscode.window, "showErrorMessage", async (msg: string) => {
        errors.push(msg);
        return undefined;
      }),
      patchProp(vscode.window, "showInformationMessage", async (msg: string) => {
        infos.push(msg);
        return undefined;
      }),
      patchProp(vscode.window, "showInputBox", async () => {
        inputCall++;
        return inputCall % 2 === 1 ? "oslc+https://elm.corp.com/rm/MOD-1" : "secret-tok";
      }),
      patchProp(vscode.env, "openExternal", async (uri: vscode.Uri) => {
        openedExternal.push(uri.toString());
        return true;
      }),
      patchProp(vscode.commands, "executeCommand", async (id: string, ...args: unknown[]) => {
        executedCommands.push({ id, args });
        return undefined;
      }),
      patchProp(vscode.workspace.fs, "writeFile", async (uri: vscode.Uri, content: Uint8Array) => {
        writtenFiles.push({ path: uri.path, text: new TextDecoder().decode(content) });
      }),
      patchProp(vscode.workspace, "isTrusted", true),
    ];
    const origFetch = globalThis.fetch;

    try {
      const rootUri = vscode.Uri.from({ scheme: "memfs", path: "/workspace" });
      const mockHostBridge: Pick<HostBridgeService, "publishSimulationResult"> = {
        publishSimulationResult: async (opts) => {
          publishedPayloads.push(opts);
          return {} as Awaited<ReturnType<HostBridgeService["publishSimulationResult"]>>;
        },
      };
      const disposables = registerAlmAndUriCommands(mockHostBridge, rootUri);

      assert.equal(disposables.length, 4);
      assert.ok(cap.handlers.has("modelscript.publishSimulationResult"));
      assert.ok(cap.handlers.has("modelscript.alm.openExternal"));
      assert.ok(cap.handlers.has("modelscript.alm.syncPull"));
      assert.ok(capturedUriHandler);

      // publishSimulationResult delegates to hostBridgeService
      await cap.handlers.get("modelscript.publishSimulationResult")!({
        fileName: "out.vtu",
        title: "Thermal",
        vtuXml: "<VTKFile/>",
      });
      assert.equal(publishedPayloads.length, 1);

      // alm.openExternal rejects non-http(s) URLs and opens valid https URLs
      await cap.handlers.get("modelscript.alm.openExternal")!("javascript:alert(1)", "REQ-1");
      assert.equal(openedExternal.length, 0);
      assert.ok(warnings.some((w) => w.includes("REQ-1")));

      await cap.handlers.get("modelscript.alm.openExternal")!("https://elm.example.com/req/1", "REQ-1");
      assert.equal(openedExternal.length, 1);

      // alm.syncPull handles HTTP error and successful file write
      globalThis.fetch = (async () => new Response("Unauthorized", { status: 401 })) as typeof fetch;
      await cap.handlers.get("modelscript.alm.syncPull")!();
      assert.ok(errors.some((e) => e.includes("401")));

      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            snapshotVersion: "v2",
            files: [{ filename: "req.sysml", content: "requirement R1;" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        )) as typeof fetch;
      await cap.handlers.get("modelscript.alm.syncPull")!();
      assert.equal(writtenFiles.length, 1);
      assert.ok(writtenFiles[0]?.path.endsWith("/.modelscript/packages/alm-sync/req.sysml"));
      assert.ok(infos.some((m) => m.includes("Synced 1 ALM projection file(s) (v2)")));

      // URI handler: untrusted workspace blocks install
      patchProp(vscode.workspace, "isTrusted", false);
      await capturedUriHandler!.handleUri(vscode.Uri.parse("vscode://modelscript.modelscript/install?package=Demo"));
      assert.ok(errors.some((e) => e.includes("untrusted workspace")));
      assert.equal(executedCommands.length, 0);

      // URI handler: trusted workspace blocks path traversal
      patchProp(vscode.workspace, "isTrusted", true);
      await capturedUriHandler!.handleUri(
        vscode.Uri.parse("vscode://modelscript.modelscript/install?package=../evil&version=1.0.0"),
      );
      assert.ok(errors.some((e) => e.includes("Blocked invalid package install URI request")));
      assert.equal(executedCommands.length, 0);

      // URI handler: valid request installs after confirmation
      await capturedUriHandler!.handleUri(
        vscode.Uri.parse("vscode://modelscript.modelscript/install?package=ThermalLib&version=2.0.0"),
      );
      assert.deepEqual(executedCommands[0], {
        id: "modelscript.registry.install",
        args: ["ThermalLib", "2.0.0"],
      });

      for (const d of disposables) d.dispose();
      assert.equal(cap.handlers.size, 0);
      assert.equal(capturedUriHandler, undefined);
    } finally {
      globalThis.fetch = origFetch;
      for (const r of restorers.reverse()) r();
    }
  });
});

describe("IDE Controllers — Diagram Navigation Controller", () => {
  it("resolves target diagram view types by file extension and languageId", () => {
    assert.equal(resolveTargetDiagramViewType("/a/part.step"), StepEditorProvider.viewType);
    assert.equal(resolveTargetDiagramViewType("/a/part.STP"), StepEditorProvider.viewType);
    assert.equal(resolveTargetDiagramViewType("/a/mesh.inp", "fea"), "modelscript.inpEditor");
    assert.equal(resolveTargetDiagramViewType("/a/drainage.swmm.inp", "fea"), DiagramEditorProvider.viewType);
    assert.equal(resolveTargetDiagramViewType("/a/solver.cfg"), "modelscript.cfgEditor");
    assert.equal(resolveTargetDiagramViewType("/a/arch.sysml"), "sysml2.diagramEditor");
    assert.equal(resolveTargetDiagramViewType("/a/motor.mo"), "modelica.diagramEditor");
    assert.equal(resolveTargetDiagramViewType("/a/grid.pscx"), "pscad.diagramEditor");
    assert.equal(resolveTargetDiagramViewType("/a/out.psout"), PsoutEditorProvider.viewType);
    assert.equal(resolveTargetDiagramViewType("/a/well.las"), TabularPlotEditorProvider.viewType);
    assert.equal(resolveTargetDiagramViewType("/a/data.csv"), TabularPlotEditorProvider.viewType);
    assert.equal(resolveTargetDiagramViewType("/a/unknown.txt"), DiagramEditorProvider.viewType);
  });

  it("registers all 10 navigation commands and handles openDiagram fallback, addToDiagram, and decomposeRegions", async () => {
    const cap = captureRegisteredCommands();
    const executedCommands: Array<{ id: string; args: unknown[] }> = [];
    const errors: string[] = [];
    const infos: string[] = [];
    const warnings: string[] = [];
    const appliedEdits: vscode.WorkspaceEdit[] = [];

    let failFirstOpenWith = true;
    const restorers: Array<() => void> = [
      cap.restore,
      patchProp(vscode.commands, "executeCommand", async (id: string, ...args: unknown[]) => {
        executedCommands.push({ id, args });
        if (id === "vscode.openWith" && failFirstOpenWith) {
          failFirstOpenWith = false;
          throw new Error("Editor not found");
        }
        return undefined;
      }),
      patchProp(vscode.window, "showErrorMessage", async (msg: string) => {
        errors.push(msg);
        return undefined;
      }),
      patchProp(vscode.window, "showInformationMessage", async (msg: string) => {
        infos.push(msg);
        return undefined;
      }),
      patchProp(vscode.window, "showWarningMessage", async (msg: string) => {
        warnings.push(msg);
        return undefined;
      }),
      patchProp(vscode.window, "activeTextEditor", undefined),
      patchProp(vscode.workspace, "applyEdit", async (edit: vscode.WorkspaceEdit) => {
        appliedEdits.push(edit);
        return true;
      }),
    ];

    const requests: Array<{ method: string; params: unknown }> = [];
    const mockClient = {
      sendRequest: async (method: string, params: unknown) => {
        requests.push({ method, params });
        if (method === "modelscript/diagram.applyEdits") {
          return {
            edits: [
              {
                range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } },
                newText: "  Modelica.Electrical.Analog.Basic.Resistor r1;\n",
              },
            ],
          };
        }
        if (method === "modelscript/decomposeRegions") {
          return { success: true, result: { regions: [{ id: 1 }, { id: 2 }] } };
        }
        return {};
      },
    } as unknown as LanguageClient;

    try {
      const ctx = createMockExtensionContext();
      const disposables = registerDiagramNavigationCommands(ctx, () => mockClient, cap.safeRegister);
      assert.equal(disposables.length, 10);

      // openDiagram falls back to DiagramEditorProvider.viewType when specialized openWith fails
      await cap.handlers.get("modelscript.openDiagram")!("file:///workspace/circuit.mo");
      assert.equal(executedCommands.length, 2);
      assert.equal(executedCommands[0]?.args[1], "modelica.diagramEditor");
      assert.equal(executedCommands[1]?.args[1], DiagramEditorProvider.viewType);

      // openRequirements warns when no active editor
      await cap.handlers.get("modelscript.openRequirements")!();
      assert.ok(warnings.some((w) => w.includes("Open a model file first")));

      // openRequirements opens requirements view when active editor exists
      const docUri = vscode.Uri.file("/workspace/sys.sysml");
      patchProp(vscode.window, "activeTextEditor", {
        document: { uri: docUri, languageId: "sysml2", getText: () => "" },
      });
      await cap.handlers.get("modelscript.openRequirements")!();
      assert.equal(executedCommands[executedCommands.length - 1]?.args[1], RequirementsEditorProvider.viewType);

      // addToDiagram sends LSP request and applies WorkspaceEdit
      await cap.handlers.get("modelscript.addToDiagram")!({ info: { compositeName: "Modelica.Basic.Resistor" } });
      assert.equal(requests[0]?.method, "modelscript/diagram.applyEdits");
      assert.equal(appliedEdits.length, 1);
      assert.ok(infos.some((m) => m.includes("Added Resistor to model.")));

      // decomposeRegions invokes LSP and reports region count
      await cap.handlers.get("modelscript.decomposeRegions")!(docUri.toString(), "stepAction");
      assert.ok(infos.some((m) => m.includes("Decomposed 2 non-overlapping invariant regions")));

      // openSimulationView and openChat delegate cleanly
      await cap.handlers.get("modelscript.openSimulationView")!(docUri, "Circuit");
      assert.equal(executedCommands[executedCommands.length - 1]?.id, "modelscript.runSimulation");

      await cap.handlers.get("modelscript.openChat")!();
      assert.equal(executedCommands[executedCommands.length - 1]?.id, "modelscript.chat.focus");

      assert.equal(errors.length, 0);

      for (const d of disposables) d.dispose();
      assert.equal(cap.handlers.size, 0);
    } finally {
      for (const r of restorers.reverse()) r();
    }
  });
});

describe("IDE Controllers — Workspace Config Controller", () => {
  it("tracks active editor context, syncs configuration changes, and cancels viewport timer on dispose", () => {
    const cap = captureRegisteredCommands();
    let editorChangeCb: ((editor: vscode.TextEditor | undefined) => void) | undefined;
    let configChangeCb: ((e: vscode.ConfigurationChangeEvent) => void) | undefined;
    let visibleRangesCb: ((e: vscode.TextEditorVisibleRangesChangeEvent) => void) | undefined;
    const contextCalls: Array<{ key: string; value: unknown }> = [];
    const notifications: Array<{ method: string; params: unknown }> = [];
    const statusBarLangs: Array<string | undefined> = [];
    let syncCount = 0;
    const docUris: string[] = [];

    const restorers: Array<() => void> = [
      cap.restore,
      patchProp(vscode.window, "onDidChangeActiveTextEditor", (cb: (editor: vscode.TextEditor | undefined) => void) => {
        editorChangeCb = cb;
        return new vscode.Disposable(() => {
          editorChangeCb = undefined;
        });
      }),
      patchProp(vscode.workspace, "onDidChangeConfiguration", (cb: (e: vscode.ConfigurationChangeEvent) => void) => {
        configChangeCb = cb;
        return new vscode.Disposable(() => {
          configChangeCb = undefined;
        });
      }),
      patchProp(
        vscode.window,
        "onDidChangeTextEditorVisibleRanges",
        (cb: (e: vscode.TextEditorVisibleRangesChangeEvent) => void) => {
          visibleRangesCb = cb;
          return new vscode.Disposable(() => {
            visibleRangesCb = undefined;
          });
        },
      ),
      patchProp(vscode.commands, "executeCommand", async (id: string, key?: unknown, value?: unknown) => {
        if (id === "setContext" && typeof key === "string") {
          contextCalls.push({ key, value });
        }
        return undefined;
      }),
    ];

    const mockLspHost = {
      client: {
        sendNotification: (method: string, params: unknown) => {
          notifications.push({ method, params });
        },
      } as unknown as LanguageClient,
      updateActiveEditorStatusBar: (langId: string | undefined) => {
        statusBarLangs.push(langId);
      },
      syncSettingsToServer: () => {
        syncCount++;
      },
    };

    try {
      const disposables = registerWorkspaceConfigController(
        createMockExtensionContext(),
        () => mockLspHost,
        { libraryTreeProvider: { setDocumentUri: (uri: string) => docUris.push(uri) } },
        cap.safeRegister,
      );

      assert.ok(cap.handlers.has("modelscript.configureFeatures"));
      assert.ok(cap.handlers.has("modelscript.configureLanguages"));
      assert.ok(editorChangeCb);
      assert.ok(configChangeCb);
      assert.ok(visibleRangesCb);

      editorChangeCb!({
        document: { uri: vscode.Uri.file("/ws/model.sysml"), languageId: "sysml2" },
      } as unknown as vscode.TextEditor);
      assert.equal(docUris.length, 1);
      assert.equal(statusBarLangs[statusBarLangs.length - 1], "sysml2");
      assert.ok(contextCalls.some((c) => c.key === "modelscript.sysml2Active" && c.value === true));
      assert.ok(contextCalls.some((c) => c.key === "modelscript.owl2Active" && c.value === false));

      configChangeCb!({
        affectsConfiguration: (section: string) => section === "modelscript" || section === "modelscript.languages",
      });
      assert.equal(syncCount, 1);

      visibleRangesCb!({
        textEditor: { document: { uri: vscode.Uri.file("/ws/model.sysml") } },
        visibleRanges: [new vscode.Range(0, 0, 20, 0)],
      } as unknown as vscode.TextEditorVisibleRangesChangeEvent);

      for (const d of disposables) d.dispose();
      assert.equal(notifications.length, 0);
      assert.equal(cap.handlers.size, 0);
    } finally {
      for (const r of restorers.reverse()) r();
    }
  });
});

describe("IDE Controllers — LSP Notification Handlers", () => {
  it("binds warning and simulationProgress notifications and clears timers on dispose", async () => {
    const warnings: string[] = [];
    const notificationHandlers = new Map<string, (params: unknown) => void>();
    let shownText = "";

    const restorers: Array<() => void> = [
      patchProp(vscode.window, "showWarningMessage", async (msg: string) => {
        warnings.push(msg);
        return undefined;
      }),
      patchProp(vscode.window, "createStatusBarItem", () => ({
        text: "",
        tooltip: "",
        command: undefined,
        show() {
          shownText = this.text;
        },
        hide() {},
        dispose() {},
      })),
    ];

    const fakeClient = {
      onNotification: (method: string, handler: (params: unknown) => void) => {
        notificationHandlers.set(method, handler);
      },
    } as unknown as LanguageClient;

    try {
      const disposables = await registerLspNotificationHandlers(
        createMockExtensionContext(),
        {
          client: fakeClient,
          onBindNotifications: (cb) => cb(fakeClient),
        },
        { libraryTreeProvider: { refresh: () => {} }, experimentsTreeProvider: { refresh: () => {} } },
        { refreshMarkdownData: () => {} },
      );

      assert.equal(disposables.length, 5);
      assert.ok(notificationHandlers.has("modelscript/warning"));
      assert.ok(notificationHandlers.has("modelscript/simulationProgress"));
      assert.ok(notificationHandlers.has("modelscript/status"));

      notificationHandlers.get("modelscript/warning")!({ message: "Solver step reduced" });
      assert.deepEqual(warnings, ["Solver step reduced"]);

      notificationHandlers.get("modelscript/simulationProgress")!({
        uri: "memfs:/circuit.mo",
        timeSec: 0.25,
        stepIndex: 12,
      });
      assert.ok(shownText.includes("t=0.2500s"));
      assert.ok(shownText.includes("step 12"));

      for (const d of disposables) d.dispose();
    } finally {
      for (const r of restorers.reverse()) r();
    }
  });
});

describe("IDE Controllers — Existing Cloud & Co-Simulation Controllers", () => {
  it("registerCloudCommands gates cloud HPC commands behind feature flag and refreshes experiments", async () => {
    const cap = captureRegisteredCommands();
    const infos: string[] = [];
    let refreshed = 0;

    const restorers: Array<() => void> = [
      cap.restore,
      patchProp(vscode.window, "showInformationMessage", async (msg: string) => {
        infos.push(msg);
        return undefined;
      }),
    ];

    try {
      const ctx = createMockExtensionContext();
      const disposables = registerCloudCommands(ctx, undefined, {
        refresh: () => {
          refreshed++;
        },
      } as unknown as ExperimentsTreeProvider);

      assert.equal(disposables.length, 5);
      assert.ok(cap.handlers.has("modelscript.openCloudPanel"));
      assert.ok(cap.handlers.has("modelscript.runOnCloud"));
      assert.ok(cap.handlers.has("modelscript.openCloudMenu"));
      assert.ok(cap.handlers.has("modelscript.refreshExperiments"));
      assert.ok(cap.handlers.has("modelscript.openAlmRemotes"));

      await cap.handlers.get("modelscript.openCloudPanel")!();
      assert.ok(infos.some((m) => m.includes("Cloud HPC features are currently disabled")));

      cap.handlers.get("modelscript.refreshExperiments")!();
      assert.equal(refreshed, 1);

      for (const d of disposables) d.dispose();
      assert.equal(cap.handlers.size, 0);
    } finally {
      for (const r of restorers.reverse()) r();
    }
  });

  it("registerCosimCommands refreshes providers and copies docker command when terminal API is absent", async () => {
    const cap = captureRegisteredCommands();
    const infos: string[] = [];
    const copied: string[] = [];
    let cosimRefreshes = 0;
    let mqttRefreshes = 0;

    const restorers: Array<() => void> = [
      cap.restore,
      patchProp(vscode.window, "showInformationMessage", async (msg: string) => {
        infos.push(msg);
        return undefined;
      }),
      patchProp(vscode.env.clipboard, "writeText", async (text: string) => {
        copied.push(text);
      }),
    ];

    try {
      const ctx = createMockExtensionContext();
      const disposables = registerCosimCommands(
        ctx,
        {
          isLocalMode: true,
          refresh: () => {
            cosimRefreshes++;
          },
        } as unknown as CosimViewProvider,
        {
          refresh: () => {
            mqttRefreshes++;
          },
        } as unknown as MqttTreeProvider,
      );

      assert.equal(disposables.length, 7);

      cap.handlers.get("modelscript.cosimConnect")!();
      assert.equal(cosimRefreshes, 1);
      assert.equal(mqttRefreshes, 1);

      cap.handlers.get("modelscript.cosimRefresh")!();
      assert.equal(cosimRefreshes, 2);
      assert.equal(mqttRefreshes, 2);

      await cap.handlers.get("modelscript.cosimStartInfra")!();
      assert.equal(copied[0], "docker compose up -d mqtt timescaledb api");
      assert.ok(infos.some((m) => m.includes("Command copied to clipboard")));

      for (const d of disposables) d.dispose();
      assert.equal(cap.handlers.size, 0);
    } finally {
      for (const r of restorers.reverse()) r();
    }
  });
});
