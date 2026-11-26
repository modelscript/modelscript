// SPDX-License-Identifier: AGPL-3.0-or-later

import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/browser.js";
import { handleOpenInVrWebviewMessage } from "../../vr-handoff.js";

export interface ExtensionWebviewBridgeMessage {
  type?: string;
  requestId?: string;
  method?: string;
  params?: unknown;
  code?: string;
  line?: number;
  identifier?: string;
  relativePath?: string;
  relativeDir?: string;
  content?: string;
  filename?: string;
  encoding?: "utf8" | "base64";
  mimeType?: string;
  level?: "info" | "warning" | "error";
  message?: string;
  url?: string;
  options?: {
    openLabel?: string;
    filters?: Record<string, string[]>;
  };
  [key: string]: unknown;
}

export interface AttachExtensionWebviewBridgeOptions {
  /** Active LSP language client for forwarding `requestLsp` / `notifyLsp`. */
  client?: LanguageClient | undefined;
  /** Optional associated text document (or getter) for edits, line reveals, and relative file I/O. */
  getDocument?: (() => vscode.TextDocument | undefined) | undefined;
  /** Optional fallback title & language ID for VR handoff. */
  title?: string | undefined;
  languageId?: string | undefined;
  /** Optional custom handler invoked for messages not handled by the standard bridge. */
  onUnhandledMessage?: ((msg: ExtensionWebviewBridgeMessage) => Promise<void> | void) | undefined;
}

export function getActiveVsCodeColorMode(): "dark" | "light" {
  const kind = vscode.window.activeColorTheme?.kind;
  return kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight ? "light" : "dark";
}

function readFeatureFlags(): Record<string, boolean> {
  try {
    const cfg = vscode.workspace.getConfiguration("modelscript.features");
    const keys = [
      "cloudCompute",
      "aiChat",
      "coSimulation",
      "collaboration",
      "formalVerification",
      "trainingStudio",
      "vrRotunda",
    ];
    const flags: Record<string, boolean> = {};
    for (const key of keys) {
      const val = cfg?.get<boolean>(key);
      if (typeof val === "boolean") {
        flags[key] = val;
      }
    }
    return flags;
  } catch {
    return {};
  }
}

function decodeBase64ToUint8Array(base64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function resolveBaseUri(document?: vscode.TextDocument): vscode.Uri | undefined {
  if (document?.uri) {
    return vscode.Uri.joinPath(document.uri, "..");
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

/**
 * Attaches the standard ModelScript extension-host RPC bridge to any VS Code webview.
 *
 * Handles:
 * - `requestLsp` / `notifyLsp` (backing `createVsCodeLspTransport`)
 * - `getHostConfig` + live theme updates (`syncTheme`)
 * - `applyEdit`, `revealLine`, `updateProjectFile`
 * - `readWorkspaceFile`, `listWorkspaceFiles`, `pickFile`
 * - `exportFile` (UTF-8 text or base64 binary)
 * - `notify`, `openExternal`, `openInVr`
 */
export function attachExtensionWebviewBridge(
  webview: vscode.Webview,
  options: AttachExtensionWebviewBridgeOptions = {},
): vscode.Disposable {
  const pushHostConfig = () => {
    void webview.postMessage({
      type: "hostConfig",
      colorMode: getActiveVsCodeColorMode(),
      featureFlags: readFeatureFlags(),
      locale: typeof vscode.env?.language === "string" ? vscode.env.language : "en",
    });
  };

  const themeSub =
    typeof vscode.window.onDidChangeActiveColorTheme === "function"
      ? vscode.window.onDidChangeActiveColorTheme(() => {
          void webview.postMessage({
            type: "syncTheme",
            colorMode: getActiveVsCodeColorMode(),
          });
        })
      : { dispose: () => {} };

  const msgSub = webview.onDidReceiveMessage(async (msg: ExtensionWebviewBridgeMessage) => {
    if (!msg || typeof msg !== "object") return;
    const document = options.getDocument?.();

    switch (msg.type) {
      case "getHostConfig": {
        pushHostConfig();
        return;
      }

      case "requestLsp": {
        if (typeof msg.requestId !== "string" || typeof msg.method !== "string") return;
        if (!options.client) {
          void webview.postMessage({
            type: "lspResponse",
            requestId: msg.requestId,
            error: "Language client is not initialized.",
          });
          return;
        }
        try {
          const result = await options.client.sendRequest(msg.method, msg.params);
          void webview.postMessage({
            type: "lspResponse",
            requestId: msg.requestId,
            result,
          });
        } catch (err) {
          void webview.postMessage({
            type: "lspResponse",
            requestId: msg.requestId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      case "notifyLsp": {
        if (typeof msg.method !== "string" || !options.client) return;
        try {
          await options.client.sendNotification(msg.method, msg.params);
        } catch {
          // ignore notification failures on shutdown
        }
        return;
      }

      case "applyEdit": {
        if (typeof msg.code !== "string" || !document) return;
        const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, fullRange, msg.code);
        await vscode.workspace.applyEdit(edit);
        return;
      }

      case "revealLine": {
        if (typeof msg.line !== "number" || msg.line < 1 || !document) return;
        const lineIdx = Math.min(Math.max(0, Math.floor(msg.line) - 1), Math.max(0, document.lineCount - 1));
        const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);
        const lineRange = document.lineAt(lineIdx).range;
        editor.selection = new vscode.Selection(lineRange.start, lineRange.end);
        editor.revealRange(lineRange, vscode.TextEditorRevealType.InCenter);
        return;
      }

      case "updateProjectFile": {
        if (typeof msg.relativePath !== "string" || typeof msg.content !== "string") return;
        const baseUri = resolveBaseUri(document);
        if (!baseUri) return;
        const targetUri = vscode.Uri.joinPath(baseUri, msg.relativePath);
        await vscode.workspace.fs.writeFile(targetUri, new TextEncoder().encode(msg.content));
        return;
      }

      case "readWorkspaceFile": {
        if (typeof msg.requestId !== "string") return;
        try {
          const baseUri = resolveBaseUri(document);
          if (!baseUri || typeof msg.relativePath !== "string") {
            void webview.postMessage({ type: "bridgeResponse", requestId: msg.requestId, result: null });
            return;
          }
          const targetUri = vscode.Uri.joinPath(baseUri, msg.relativePath);
          const raw = await vscode.workspace.fs.readFile(targetUri);
          void webview.postMessage({
            type: "bridgeResponse",
            requestId: msg.requestId,
            result: new TextDecoder().decode(raw),
          });
        } catch {
          void webview.postMessage({ type: "bridgeResponse", requestId: msg.requestId, result: null });
        }
        return;
      }

      case "listWorkspaceFiles": {
        if (typeof msg.requestId !== "string") return;
        try {
          const baseUri = resolveBaseUri(document);
          if (!baseUri) {
            void webview.postMessage({ type: "bridgeResponse", requestId: msg.requestId, result: [] });
            return;
          }
          const dirUri =
            typeof msg.relativeDir === "string" && msg.relativeDir.length > 0
              ? vscode.Uri.joinPath(baseUri, msg.relativeDir)
              : baseUri;
          const entries = await vscode.workspace.fs.readDirectory(dirUri);
          const prefix =
            typeof msg.relativeDir === "string" && msg.relativeDir.length > 0
              ? `${msg.relativeDir.replace(/\/+$/, "")}/`
              : "";
          const result = entries.map(([name, fileType]) => ({
            name,
            relativePath: `${prefix}${name}`,
            isDirectory: fileType === vscode.FileType.Directory,
          }));
          void webview.postMessage({ type: "bridgeResponse", requestId: msg.requestId, result });
        } catch {
          void webview.postMessage({ type: "bridgeResponse", requestId: msg.requestId, result: [] });
        }
        return;
      }

      case "pickFile": {
        if (typeof msg.requestId !== "string") return;
        try {
          const selected = await vscode.window.showOpenDialog({
            canSelectMany: false,
            openLabel: msg.options?.openLabel ?? "Select File",
            ...(msg.options?.filters ? { filters: msg.options.filters } : {}),
          });
          if (!selected || selected.length === 0) {
            void webview.postMessage({ type: "bridgeResponse", requestId: msg.requestId, result: null });
            return;
          }
          const fileUri = selected[0]!;
          const raw = await vscode.workspace.fs.readFile(fileUri);
          const name = fileUri.path.split("/").pop() ?? fileUri.fsPath;
          void webview.postMessage({
            type: "bridgeResponse",
            requestId: msg.requestId,
            result: {
              path: fileUri.fsPath ?? fileUri.path,
              name,
              content: new TextDecoder().decode(raw),
            },
          });
        } catch (err) {
          void webview.postMessage({
            type: "bridgeResponse",
            requestId: msg.requestId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      case "exportFile": {
        if (typeof msg.filename !== "string" || typeof msg.content !== "string") return;
        const baseUri = resolveBaseUri(document);
        const defaultUri = baseUri ? vscode.Uri.joinPath(baseUri, msg.filename) : undefined;
        const saveUri = await vscode.window.showSaveDialog(defaultUri ? { defaultUri } : undefined);
        if (saveUri) {
          const bytes =
            msg.encoding === "base64" ? decodeBase64ToUint8Array(msg.content) : new TextEncoder().encode(msg.content);
          await vscode.workspace.fs.writeFile(saveUri, bytes);
          vscode.window.showInformationMessage(`Exported ${msg.filename}`);
        }
        return;
      }

      case "notify": {
        if (typeof msg.message !== "string") return;
        if (msg.level === "error") vscode.window.showErrorMessage(msg.message);
        else if (msg.level === "warning") vscode.window.showWarningMessage(msg.message);
        else vscode.window.showInformationMessage(msg.message);
        return;
      }

      case "openExternal": {
        if (typeof msg.url === "string") {
          await vscode.env.openExternal(vscode.Uri.parse(msg.url));
        }
        return;
      }

      case "openInVr": {
        await handleOpenInVrWebviewMessage(msg, {
          artifactUri: document?.uri.toString(),
          title: options.title || document?.uri.path.split("/").pop(),
          kind: options.languageId || document?.languageId,
          fileContent: () => (document && typeof document.getText === "function" ? document.getText() : undefined),
          languageId: document?.languageId || options.languageId,
        });
        return;
      }

      default: {
        await options.onUnhandledMessage?.(msg);
      }
    }
  });

  return {
    dispose() {
      themeSub.dispose();
      msgSub.dispose();
    },
  };
}
