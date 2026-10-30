// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import { Uri, workspace } from "vscode";
import { LanguageClient, type LanguageClientOptions } from "vscode-languageclient/browser";
import {
  buildLspSettingsPayload,
  getFeatureChannelSetting,
  getLanguageMaturityBadge,
  getStatusBarConfig,
  isLanguageEnabled,
  shouldShowMaturityBadges,
} from "../utils/config.js";

export async function getProjectDependencies(
  workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined = workspace.workspaceFolders,
): Promise<{ name: string; version: string }[]> {
  const defaultDeps = [
    { name: "Modelica", version: "4.1.0" },
    { name: "SysML", version: "2026.3.0" },
  ];

  if (!workspaceFolders || workspaceFolders.length === 0) {
    return defaultDeps;
  }

  const rootUri = workspaceFolders[0]!.uri;

  try {
    const msJsonUri = vscode.Uri.joinPath(rootUri, "modelscript.json");
    const content = await workspace.fs.readFile(msJsonUri);
    const json = JSON.parse(new TextDecoder().decode(content));
    if (json.dependencies) {
      return Object.entries(json.dependencies).map(([name, version]) => ({ name, version: String(version) }));
    }
  } catch {
    // ignore
  }

  try {
    const pkgJsonUri = vscode.Uri.joinPath(rootUri, "package.json");
    const content = await workspace.fs.readFile(pkgJsonUri);
    const json = JSON.parse(new TextDecoder().decode(content));
    if (json.modelscript?.dependencies) {
      return Object.entries(json.modelscript.dependencies).map(([name, version]) => ({
        name,
        version: String(version),
      }));
    }
  } catch {
    // ignore
  }

  return defaultDeps;
}

export function buildDynamicDocumentSelector(
  context: vscode.ExtensionContext,
): ({ language: string } | { pattern: string })[] {
  const contributedLanguages =
    (context.extension?.packageJSON?.contributes?.languages as
      | { id: string; extensions?: string[] | undefined }[]
      | undefined) || [];
  const dynamicLanguageSelectors: ({ language: string } | { pattern: string })[] = [];
  const allExts: string[] = [
    "mo",
    "mos",
    "sysml",
    "sysml2",
    "step",
    "stp",
    "p21",
    "owl",
    "ttl",
    "ofn",
    "csv",
    "scad",
    "cfg",
    "cfd",
    "cfgt",
    "su2",
    "inp",
    "fea",
    "inpt",
    "bdf",
    "calc",
    "run",
    "sub",
    "geom",
    "trax",
    "wheel",
    "spck",
    "sim",
    "mbs",
    "c",
    "h",
  ];

  if (contributedLanguages.length > 0) {
    for (const lang of contributedLanguages) {
      if (!isLanguageEnabled(lang.id)) continue;
      dynamicLanguageSelectors.push({ language: lang.id });
      if (lang.extensions) {
        for (const ext of lang.extensions) {
          const cleanExt = ext.startsWith(".") ? ext.slice(1) : ext;
          if (cleanExt.toLowerCase() === "ts") continue;
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
      { language: "cfd" },
      { language: "fea" },
      { language: "c" },
    );
  }

  dynamicLanguageSelectors.push({ pattern: `**/*.{${allExts.join(",")}}` });
  return dynamicLanguageSelectors;
}

type MessageTypeArg = string | { method?: string | undefined };

interface RawLanguageClientRpc {
  onNotification: (type: unknown, handler: (...args: unknown[]) => void) => vscode.Disposable;
  onRequest: (type: unknown, handler: (...args: unknown[]) => unknown) => vscode.Disposable;
  sendRequest: (type: unknown, ...args: unknown[]) => Promise<unknown>;
  sendNotification: (type: unknown, ...args: unknown[]) => Promise<void>;
}

export class LspClientManager implements vscode.Disposable {
  private _activeClient: LanguageClient | undefined;
  private _languageWorker: Worker | undefined;
  private _statusItem: vscode.StatusBarItem;
  private _clientProxy: LanguageClient;
  private _clientOptions: LanguageClientOptions | undefined;
  private _notificationListeners: ((client: LanguageClient) => void)[] = [];
  private _hideTimeout: NodeJS.Timeout | null = null;
  private _outputChannel: vscode.OutputChannel;
  private _notificationHandlers: Map<string, Set<(...args: unknown[]) => void>> = new Map();
  private _requestHandlers: Map<string, (...args: unknown[]) => unknown> = new Map();
  private _clientDisposables: vscode.Disposable[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {
    this._outputChannel = vscode.window.createOutputChannel("ModelScript Language Server");
    this.context.subscriptions.push(this._outputChannel);

    this._statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.context.subscriptions.push(this._statusItem);

    // Dynamic proxy so callers can hold a reference that buffers early registrations
    // and always delegates to the active language client instance.
    this._clientProxy = new Proxy({} as LanguageClient, {
      get: (_target, prop, receiver) => {
        if (prop === "onNotification") {
          return (type: MessageTypeArg, handler: (...args: unknown[]) => void): vscode.Disposable => {
            const key = typeof type === "string" ? type : (type?.method ?? String(type));
            if (!this._notificationHandlers.has(key)) {
              this._notificationHandlers.set(key, new Set());
            }
            this._notificationHandlers.get(key)!.add(handler);

            let liveDisposable: vscode.Disposable | undefined;
            const activeRpc = this._activeClient as unknown as Partial<RawLanguageClientRpc> | undefined;
            if (activeRpc && typeof activeRpc.onNotification === "function") {
              try {
                liveDisposable = activeRpc.onNotification(type, handler);
              } catch (e) {
                console.warn(`[lsp-client-proxy] Failed to bind immediate notification for '${key}':`, e);
              }
            }

            return {
              dispose: () => {
                this._notificationHandlers.get(key)?.delete(handler);
                liveDisposable?.dispose();
              },
            };
          };
        }

        if (prop === "onRequest") {
          return (type: MessageTypeArg, handler: (...args: unknown[]) => unknown): vscode.Disposable => {
            const key = typeof type === "string" ? type : (type?.method ?? String(type));
            this._requestHandlers.set(key, handler);

            let liveDisposable: vscode.Disposable | undefined;
            const activeRpc = this._activeClient as unknown as Partial<RawLanguageClientRpc> | undefined;
            if (activeRpc && typeof activeRpc.onRequest === "function") {
              try {
                liveDisposable = activeRpc.onRequest(type, handler);
              } catch (e) {
                console.warn(`[lsp-client-proxy] Failed to bind immediate request for '${key}':`, e);
              }
            }

            return {
              dispose: () => {
                this._requestHandlers.delete(key);
                liveDisposable?.dispose();
              },
            };
          };
        }

        if (prop === "sendRequest") {
          return async (type: unknown, ...args: unknown[]): Promise<unknown> => {
            const activeRpc = this._activeClient as unknown as Partial<RawLanguageClientRpc> | undefined;
            if (activeRpc && typeof activeRpc.sendRequest === "function") {
              return activeRpc.sendRequest(type, ...args);
            }
            const client = await this.waitForActiveClient();
            return (client as unknown as RawLanguageClientRpc).sendRequest(type, ...args);
          };
        }

        if (prop === "sendNotification") {
          return async (type: unknown, ...args: unknown[]): Promise<void> => {
            const activeRpc = this._activeClient as unknown as Partial<RawLanguageClientRpc> | undefined;
            if (activeRpc && typeof activeRpc.sendNotification === "function") {
              await activeRpc.sendNotification(type, ...args);
              return;
            }
            const client = await this.waitForActiveClient();
            await (client as unknown as RawLanguageClientRpc).sendNotification(type, ...args);
          };
        }

        if (!this._activeClient) return undefined;
        const val = Reflect.get(this._activeClient as object, prop, receiver);
        return typeof val === "function" ? val.bind(this._activeClient) : val;
      },
      set: (_target, prop, value, receiver) => {
        if (!this._activeClient) return false;
        return Reflect.set(this._activeClient as object, prop, value, receiver);
      },
    });
  }

  public async waitForActiveClient(timeoutMs = 15000): Promise<LanguageClient> {
    if (this._activeClient) return this._activeClient;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Timeout waiting for ModelScript LanguageClient to activate"));
      }, timeoutMs);
      const disp = this.onBindNotifications((client) => {
        clearTimeout(timer);
        disp.dispose();
        resolve(client);
      });
    });
  }

  private _attachRegisteredHandlers(client: LanguageClient): void {
    for (const d of this._clientDisposables) {
      try {
        d.dispose();
      } catch {
        // ignore
      }
    }
    this._clientDisposables = [];

    const rpcClient = client as unknown as RawLanguageClientRpc;
    for (const [type, handlers] of this._notificationHandlers.entries()) {
      for (const handler of handlers) {
        try {
          const d = rpcClient.onNotification(type, handler);
          if (d && typeof d.dispose === "function") {
            this._clientDisposables.push(d);
          }
        } catch (e) {
          console.warn(`[lsp-client-manager] Failed to attach notification handler for '${type}':`, e);
        }
      }
    }

    for (const [type, handler] of this._requestHandlers.entries()) {
      try {
        const d = rpcClient.onRequest(type, handler);
        if (d && typeof d.dispose === "function") {
          this._clientDisposables.push(d);
        }
      } catch (e) {
        console.warn(`[lsp-client-manager] Failed to attach request handler for '${type}':`, e);
      }
    }
  }

  get client(): LanguageClient {
    return this._clientProxy;
  }

  get activeClient(): LanguageClient | undefined {
    return this._activeClient;
  }

  get languageWorker(): Worker | undefined {
    return this._languageWorker;
  }

  get statusItem(): vscode.StatusBarItem {
    return this._statusItem;
  }

  get outputChannel(): vscode.OutputChannel {
    return this._outputChannel;
  }

  public updateActiveEditorStatusBar(languageId?: string): void {
    const { visibility } = getStatusBarConfig();
    if (visibility === "never") {
      this._statusItem.hide();
      return;
    }

    const contributedLanguages =
      (this.context.extension?.packageJSON?.contributes?.languages as
        | { id: string; aliases?: string[] | undefined }[]
        | undefined) || [];
    const matchedLang = languageId
      ? contributedLanguages.find((l) => l.id.toLowerCase() === languageId.toLowerCase())
      : undefined;

    if (!matchedLang && visibility === "whenActive") {
      this._statusItem.hide();
      return;
    }

    const channel = getFeatureChannelSetting();
    const channelLabel =
      channel === "stable"
        ? "🟢 Stable"
        : channel === "preview"
          ? "🟡 Preview"
          : channel === "experimental"
            ? "🧪 Experimental"
            : "🔬 Dev";

    if (matchedLang) {
      const displayName = matchedLang.aliases?.[0] ?? matchedLang.id;
      const badge = shouldShowMaturityBadges() ? ` (${getLanguageMaturityBadge(matchedLang.id)})` : "";
      this._statusItem.text = `$(symbol-namespace) ${displayName}${badge}`;
      this._statusItem.tooltip = `ModelScript Language: ${displayName}${badge} | Channel: ${channelLabel} — Click to configure features & languages`;
      this._statusItem.command = "modelscript.configureFeatures";
      this._statusItem.show();
    } else if (visibility === "always") {
      this._statusItem.text = `$(check) ModelScript (${channelLabel})`;
      this._statusItem.tooltip = `ModelScript Polyglot Compiler & Simulation Engine (Channel: ${channelLabel}) — Click to configure features & languages`;
      this._statusItem.command = "modelscript.configureFeatures";
      this._statusItem.show();
    }
  }

  onBindNotifications(listener: (client: LanguageClient) => void): vscode.Disposable {
    this._notificationListeners.push(listener);
    if (this._activeClient) {
      listener(this._activeClient);
    }
    return {
      dispose: () => {
        const idx = this._notificationListeners.indexOf(listener);
        if (idx !== -1) this._notificationListeners.splice(idx, 1);
      },
    };
  }

  broadcastStatus(status: "ready" | "loading" | "error" | "offline", message?: string): void {
    try {
      const payload = { type: "MODELSCRIPT_LSP_STATUS", status, message };
      if (typeof window !== "undefined" && window.parent && window.parent !== window) {
        window.parent.postMessage(payload, window.location.origin);
      }
      const channel = new BroadcastChannel("modelscript:host-bridge");
      channel.postMessage(payload);
      channel.close();
    } catch {
      // ignore
    }
  }

  private async createWorkerClient(): Promise<LanguageClient> {
    let serverMain = Uri.joinPath(this.context.extensionUri, "server", "dist", "browserServerMain.js");

    if (typeof self !== "undefined" && self.location && self.location.origin && self.location.origin !== "null") {
      try {
        const url = new URL(serverMain.toString(true));
        if (url.origin !== self.location.origin) {
          serverMain = Uri.parse(self.location.origin + url.pathname + url.search + url.hash);
        }
      } catch {
        // ignore url parsing failures for custom schemes
      }
    }

    const worker = new Worker(serverMain.toString(true));
    this._languageWorker = worker;

    if (!this._clientOptions) {
      const documentSelector = buildDynamicDocumentSelector(this.context);
      this._clientOptions = {
        documentSelector,
        synchronize: {},
        initializationOptions: {
          extensionUri: this.context.extensionUri.toString(),
          registryUrl:
            vscode.workspace.getConfiguration("modelscript").get("registryUrl") ||
            (typeof location !== "undefined" && (location.hostname === "localhost" || location.hostname === "127.0.0.1")
              ? `${location.protocol}//${location.hostname}:3000`
              : "https://api.modelscript.org"),
          useLocalMsl: !(vscode.workspace.getConfiguration("modelscript").get("library.useApiRegistry") ?? false),
          projectDependencies: await getProjectDependencies(),
        },
        outputChannel: this._outputChannel,
      };
    }

    return new LanguageClient("modelscript", "ModelScript Language Server", this._clientOptions, worker);
  }

  public syncSettingsToServer(): void {
    if (!this._activeClient) return;
    try {
      const contributedLanguages =
        (this.context.extension?.packageJSON?.contributes?.languages as { id: string }[] | undefined) || [];
      const langIds = contributedLanguages.map((l) => l.id);
      const payload = buildLspSettingsPayload(langIds.length > 0 ? langIds : undefined);
      void (this._activeClient as unknown as RawLanguageClientRpc).sendNotification(
        "modelscript/updateSettings",
        payload,
      );
    } catch (e) {
      console.warn("[lsp-client-manager] Failed to sync settings to LSP server:", e);
    }
  }

  async start(): Promise<void> {
    this._activeClient = await this.createWorkerClient();
    await this._activeClient.start();
    console.log("ModelScript language server is ready");
    this._outputChannel.appendLine("[client] Language server started successfully");

    this._attachRegisteredHandlers(this._activeClient);
    this.syncSettingsToServer();

    for (const listener of this._notificationListeners) {
      listener(this._activeClient);
    }
  }

  async restart(): Promise<void> {
    this._statusItem.show();
    this._statusItem.text = "$(sync~spin) Restarting LSP…";
    this.broadcastStatus("loading", "Restarting language server…");

    try {
      const oldWorker = this._languageWorker;
      if (this._activeClient) {
        try {
          await this._activeClient.stop();
        } catch (e) {
          console.warn("[lsp-restart] Clean stop error:", e);
        }
      }
      if (oldWorker) {
        try {
          oldWorker.terminate();
        } catch {
          // ignore
        }
      }

      this._activeClient = await this.createWorkerClient();
      await this._activeClient.start();

      this._attachRegisteredHandlers(this._activeClient);
      this.syncSettingsToServer();

      for (const listener of this._notificationListeners) {
        listener(this._activeClient);
      }

      this._statusItem.text = "$(check) LSP Ready";
      this._statusItem.command = undefined;
      this.broadcastStatus("ready", "Language server restarted");
      setTimeout(() => this._statusItem.hide(), 4000);
      vscode.window.showInformationMessage("ModelScript language server restarted successfully.");
    } catch (err: unknown) {
      this._statusItem.text = "$(error) LSP Restart Failed";
      this.broadcastStatus("error", "Language server restart failed");
      const errMsg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Failed to restart ModelScript language server: ${errMsg}`);
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (this._activeClient !== undefined) {
      try {
        await this._activeClient.stop();
      } catch {
        // ignore
      }
      this._activeClient = undefined;
    }
    if (this._languageWorker !== undefined) {
      try {
        this._languageWorker.terminate();
      } catch {
        // ignore
      }
      this._languageWorker = undefined;
    }
  }

  dispose(): void {
    for (const d of this._clientDisposables) {
      try {
        d.dispose();
      } catch {
        // ignore
      }
    }
    this._clientDisposables = [];
    this._notificationHandlers.clear();
    this._requestHandlers.clear();

    if (this._hideTimeout) {
      clearTimeout(this._hideTimeout);
      this._hideTimeout = null;
    }
    this.stop().catch(() => {});
  }
}
