// SPDX-License-Identifier: AGPL-3.0-or-later

import type { EditorCapabilities, EditorHostAdapter } from "@modelscript/editor/host";
import { EditorHostProvider } from "@modelscript/editor/host";
import type { EditorLspTransport } from "@modelscript/editor/transport";
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

export interface VsCodeWebviewApi {
  postMessage(message: unknown): void;
  getState?<T = unknown>(): T | undefined;
  setState?<T = unknown>(state: T): void;
}

export interface VsCodeMessageEventLike {
  data: unknown;
}

export interface VsCodeMessageTarget {
  addEventListener(type: "message", listener: (ev: VsCodeMessageEventLike) => void): void;
  removeEventListener(type: "message", listener: (ev: VsCodeMessageEventLike) => void): void;
}

declare function acquireVsCodeApi(): VsCodeWebviewApi;

let cachedVsCodeApi: VsCodeWebviewApi | null = null;

/**
 * Safely acquires and caches the singleton VS Code webview API handle.
 * Falls back to a no-op stub when rendered outside a VS Code webview (e.g. unit tests).
 */
export function getVsCodeWebviewApi(): VsCodeWebviewApi {
  if (cachedVsCodeApi) return cachedVsCodeApi;
  if (typeof acquireVsCodeApi === "function") {
    cachedVsCodeApi = acquireVsCodeApi();
  } else {
    cachedVsCodeApi = { postMessage: () => undefined };
  }
  return cachedVsCodeApi;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer?: ReturnType<typeof setTimeout> | undefined;
}

export interface VsCodeLspTransportOptions {
  /** Message event target (defaults to `window`). */
  messageTarget?: VsCodeMessageTarget | undefined;
  /** Per-request timeout in ms (default: 60_000). */
  timeoutMs?: number | undefined;
}

/**
 * Creates an `EditorLspTransport` backed by VS Code webview `postMessage` RPC
 * (`requestLsp` / `notifyLsp` / `lspResponse` / `lspNotification`), allowing any
 * `@modelscript/editor` component to talk to `@modelscript/lsp` inside VS Code.
 */
export function createVsCodeLspTransport(
  vscodeApi: VsCodeWebviewApi = getVsCodeWebviewApi(),
  options?: VsCodeLspTransportOptions,
): EditorLspTransport {
  const target: VsCodeMessageTarget | undefined =
    options?.messageTarget ?? (typeof window !== "undefined" ? (window as unknown as VsCodeMessageTarget) : undefined);
  const timeoutMs = options?.timeoutMs ?? 60_000;

  let nextId = 1;
  let disposed = false;
  const pending = new Map<string, PendingRequest>();
  const notificationListeners = new Map<string, Set<(params: unknown) => void>>();

  const handleMessage = (ev: VsCodeMessageEventLike) => {
    const msg = ev?.data as
      | {
          type?: string;
          requestId?: string;
          result?: unknown;
          error?: string;
          method?: string;
          params?: unknown;
        }
      | undefined;
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "lspResponse" && typeof msg.requestId === "string") {
      const entry = pending.get(msg.requestId);
      if (!entry) return;
      pending.delete(msg.requestId);
      if (entry.timer !== undefined) clearTimeout(entry.timer);
      if (typeof msg.error === "string" && msg.error.length > 0) {
        entry.reject(new Error(msg.error));
      } else {
        entry.resolve(msg.result);
      }
      return;
    }

    if (msg.type === "lspNotification" && typeof msg.method === "string") {
      const listeners = notificationListeners.get(msg.method);
      if (!listeners) return;
      for (const listener of listeners) {
        try {
          listener(msg.params);
        } catch {
          // isolate subscriber errors
        }
      }
    }
  };

  target?.addEventListener("message", handleMessage);

  return {
    sendRequest<R = unknown>(method: string, params?: unknown): Promise<R> {
      if (disposed) {
        return Promise.reject(new Error(`VS Code LSP transport is disposed (request '${method}').`));
      }
      const requestId = `vsc-lsp-${nextId++}`;
      return new Promise<R>((resolve, reject) => {
        const timer =
          timeoutMs > 0
            ? setTimeout(() => {
                if (!pending.has(requestId)) return;
                pending.delete(requestId);
                reject(new Error(`VS Code LSP request '${method}' timed out after ${timeoutMs}ms.`));
              }, timeoutMs)
            : undefined;
        pending.set(requestId, {
          resolve: resolve as (value: unknown) => void,
          reject,
          timer,
        });
        vscodeApi.postMessage({
          type: "requestLsp",
          requestId,
          method,
          params,
        });
      });
    },

    sendNotification(method: string, params?: unknown): void {
      if (disposed) return;
      vscodeApi.postMessage({
        type: "notifyLsp",
        method,
        params,
      });
    },

    onNotification(method: string, handler: (params: unknown) => void) {
      let set = notificationListeners.get(method);
      if (!set) {
        set = new Set();
        notificationListeners.set(method, set);
      }
      set.add(handler);
      return {
        dispose() {
          set?.delete(handler);
          if (set && set.size === 0) {
            notificationListeners.delete(method);
          }
        },
      };
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      target?.removeEventListener("message", handleMessage);
      for (const [, entry] of pending) {
        if (entry.timer !== undefined) clearTimeout(entry.timer);
        entry.reject(new Error("VS Code LSP transport disposed."));
      }
      pending.clear();
      notificationListeners.clear();
    },
  };
}

export interface PickedWorkspaceFile {
  path: string;
  name: string;
  content: string;
}

export interface WorkspaceFileListing {
  name: string;
  relativePath: string;
  isDirectory: boolean;
}

export interface VsCodeHostActions {
  /** Replaces the active document text in VS Code. */
  applyEdit(code: string): void;
  /** Opens/focuses the active document at the given 1-based line number. */
  revealLine(line: number, identifier?: string): void;
  /** Writes a sibling file relative to the active document's parent folder. */
  updateProjectFile(relativePath: string, content: string): void;
  /** Reads a workspace file relative to the active document's parent folder. */
  readWorkspaceFile(relativePath: string): Promise<string | null>;
  /** Lists files in a directory relative to the active document's parent folder. */
  listWorkspaceFiles(relativeDir?: string): Promise<WorkspaceFileListing[]>;
  /** Opens a VS Code file picker dialog and returns the selected file's UTF-8 text. */
  pickFile(options?: { openLabel?: string; filters?: Record<string, string[]> }): Promise<PickedWorkspaceFile | null>;
  /** Opens a Save dialog to export text or base64-encoded binary data. */
  exportFile(filename: string, content: string, options?: { encoding?: "utf8" | "base64"; mimeType?: string }): void;
  /** Opens an external URL via VS Code. */
  openExternal(url: string): void;
  /** Hands off the current document/scene to an external WebXR browser session. */
  openInVr(payload?: Record<string, unknown>): void;
  /** Active VS Code UI locale (e.g. `"en"`, `"de"`, `"ja"`). */
  locale: string;
}

const NOOP_ACTIONS: VsCodeHostActions = {
  applyEdit: () => undefined,
  revealLine: () => undefined,
  updateProjectFile: () => undefined,
  readWorkspaceFile: async () => null,
  listWorkspaceFiles: async () => [],
  pickFile: async () => null,
  exportFile: () => undefined,
  openExternal: () => undefined,
  openInVr: () => undefined,
  locale: "en",
};

const VsCodeHostActionsContext = createContext<VsCodeHostActions>(NOOP_ACTIONS);

export function useVsCodeHostActions(): VsCodeHostActions {
  return useContext(VsCodeHostActionsContext);
}

function detectBodyTheme(): "dark" | "light" {
  if (typeof document === "undefined" || !document.body) return "dark";
  if (
    document.body.classList.contains("vscode-light") ||
    document.body.classList.contains("vscode-high-contrast-light")
  ) {
    return "light";
  }
  return "dark";
}

export interface VsCodeEditorHostProviderProps {
  vscodeApi?: VsCodeWebviewApi | undefined;
  initialTheme?: "dark" | "light" | undefined;
  capabilities?: Partial<EditorCapabilities> | undefined;
  singleLanguageId?: string | undefined;
  children: React.ReactNode;
}

/**
 * Mounts `@modelscript/editor`'s `EditorHostProvider` inside a VS Code webview,
 * wiring `createVsCodeLspTransport`, live VS Code theme syncing, feature flags,
 * notifications, and file/workspace actions.
 */
export const VsCodeEditorHostProvider: React.FC<VsCodeEditorHostProviderProps> = ({
  vscodeApi,
  initialTheme,
  capabilities,
  singleLanguageId,
  children,
}) => {
  const api = useMemo(() => vscodeApi ?? getVsCodeWebviewApi(), [vscodeApi]);
  const [theme, setTheme] = useState<"dark" | "light">(() => initialTheme ?? detectBodyTheme());
  const [featureFlags, setFeatureFlags] = useState<Record<string, boolean>>({});
  const [locale, setLocale] = useState<string>("en");

  const pendingBridgeRequests = useRef(new Map<string, PendingRequest>());
  const nextBridgeId = useRef(1);

  const lspTransport = useMemo(() => createVsCodeLspTransport(api), [api]);

  useEffect(() => {
    return () => {
      lspTransport.dispose?.();
    };
  }, [lspTransport]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleMessage = (ev: MessageEvent) => {
      const msg = ev.data as
        | {
            type?: string;
            colorMode?: "dark" | "light";
            featureFlags?: Record<string, boolean>;
            locale?: string;
            requestId?: string;
            result?: unknown;
            error?: string;
          }
        | undefined;
      if (!msg || typeof msg !== "object") return;

      if (msg.type === "syncTheme" || msg.type === "syncDocument" || msg.type === "hostConfig") {
        if (msg.colorMode === "light" || msg.colorMode === "dark") {
          setTheme(msg.colorMode);
        }
        if (msg.featureFlags && typeof msg.featureFlags === "object") {
          setFeatureFlags(msg.featureFlags);
        }
        if (typeof msg.locale === "string" && msg.locale.length > 0) {
          setLocale(msg.locale);
        }
      }

      if (msg.type === "bridgeResponse" && typeof msg.requestId === "string") {
        const entry = pendingBridgeRequests.current.get(msg.requestId);
        if (!entry) return;
        pendingBridgeRequests.current.delete(msg.requestId);
        if (entry.timer !== undefined) clearTimeout(entry.timer);
        if (typeof msg.error === "string" && msg.error.length > 0) {
          entry.reject(new Error(msg.error));
        } else {
          entry.resolve(msg.result);
        }
      }
    };

    window.addEventListener("message", handleMessage);
    api.postMessage({ type: "getHostConfig" });

    let observer: MutationObserver | null = null;
    if (typeof MutationObserver !== "undefined" && typeof document !== "undefined" && document.body) {
      observer = new MutationObserver(() => {
        setTheme(detectBodyTheme());
      });
      observer.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    }

    return () => {
      window.removeEventListener("message", handleMessage);
      observer?.disconnect();
      for (const [, entry] of pendingBridgeRequests.current) {
        if (entry.timer !== undefined) clearTimeout(entry.timer);
        entry.reject(new Error("VS Code host provider unmounted."));
      }
      pendingBridgeRequests.current.clear();
    };
  }, [api]);

  const sendBridgeRequest = useMemo(() => {
    return <T,>(type: string, payload?: Record<string, unknown>): Promise<T> => {
      const requestId = `vsc-bridge-${nextBridgeId.current++}`;
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (!pendingBridgeRequests.current.has(requestId)) return;
          pendingBridgeRequests.current.delete(requestId);
          reject(new Error(`VS Code host bridge request '${type}' timed out.`));
        }, 30_000);
        pendingBridgeRequests.current.set(requestId, {
          resolve: resolve as (value: unknown) => void,
          reject,
          timer,
        });
        api.postMessage({ type, requestId, ...payload });
      });
    };
  }, [api]);

  const actions = useMemo<VsCodeHostActions>(
    () => ({
      applyEdit: (code: string) => api.postMessage({ type: "applyEdit", code }),
      revealLine: (line: number, identifier?: string) => api.postMessage({ type: "revealLine", line, identifier }),
      updateProjectFile: (relativePath: string, content: string) =>
        api.postMessage({ type: "updateProjectFile", relativePath, content }),
      readWorkspaceFile: (relativePath: string) =>
        sendBridgeRequest<string | null>("readWorkspaceFile", { relativePath }),
      listWorkspaceFiles: (relativeDir?: string) =>
        sendBridgeRequest<WorkspaceFileListing[]>("listWorkspaceFiles", { relativeDir }),
      pickFile: (options) => sendBridgeRequest<PickedWorkspaceFile | null>("pickFile", { options }),
      exportFile: (filename, content, options) =>
        api.postMessage({
          type: "exportFile",
          filename,
          content,
          encoding: options?.encoding ?? "utf8",
          mimeType: options?.mimeType,
        }),
      openExternal: (url: string) => api.postMessage({ type: "openExternal", url }),
      openInVr: (payload) => api.postMessage({ type: "openInVr", ...payload }),
      locale,
    }),
    [api, sendBridgeRequest, locale],
  );

  const host = useMemo<EditorHostAdapter>(() => {
    const mergedCaps: EditorCapabilities = {
      localSimulation: true,
      cloudSimulation: Boolean(featureFlags["cloudCompute"]),
      aiAssistant: featureFlags["aiChat"] ?? true,
      collaboration: Boolean(featureFlags["collaboration"]),
      fmuExport: true,
      cadViewer: true,
      ...capabilities,
    };

    const isFeatureEnabled = (flag: string | readonly string[]): boolean => {
      const keys = Array.isArray(flag) ? flag : [flag];
      return keys.every((k) => featureFlags[k] ?? true);
    };

    return {
      theme,
      featureFlags,
      isFeatureEnabled,
      capabilities: mergedCaps,
      lspTransport,
      singleLanguageId,
      notify: (message: string, level: "info" | "success" | "warning" | "error" = "info") => {
        api.postMessage({
          type: "notify",
          level: level === "success" ? "info" : level,
          message,
        });
      },
    };
  }, [api, capabilities, featureFlags, lspTransport, singleLanguageId, theme]);

  return (
    <EditorHostProvider host={host}>
      <VsCodeHostActionsContext.Provider value={actions}>{children}</VsCodeHostActionsContext.Provider>
    </EditorHostProvider>
  );
};
