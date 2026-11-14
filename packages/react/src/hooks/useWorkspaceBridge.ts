// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from "react";
import { useModelScript } from "../context.js";

export interface WorkspaceBridgeOptions {
  /** Expected parent/host origin for cross-origin iframe communication. */
  allowedOrigin?: string | undefined;
}

export interface WorkspaceBridgeState {
  environment: "web" | "tauri" | "vscode";
  activeFile: { name: string; content: string } | null;
  sendMessage: (type: string, payload: unknown) => void;
}

function resolveVerifiedOrigin(configuredOrigin?: string): string {
  if (configuredOrigin && configuredOrigin !== "*") {
    try {
      const parsed = new URL(configuredOrigin);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.origin;
      }
    } catch {
      return "";
    }
  }
  if (typeof window !== "undefined" && window.location?.origin && window.location.origin !== "null") {
    return window.location.origin;
  }
  return "";
}

/**
 * Universal bridge hook connecting a React app to its host environment:
 * - VS Code: listens to active editor document changes and posts messages to extension host
 * - Tauri: connects to Tauri native IPC
 * - Web: operates in browser sandbox
 */
export function useWorkspaceBridge(options?: WorkspaceBridgeOptions): WorkspaceBridgeState {
  const { environment } = useModelScript();
  const [activeFile, setActiveFile] = useState<{ name: string; content: string } | null>(null);
  const verifiedOrigin = resolveVerifiedOrigin(options?.allowedOrigin);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const fromSameWindow = event.source === window;
      const fromExpectedOrigin = verifiedOrigin !== "" && event.origin === verifiedOrigin;
      if (!fromSameWindow && !fromExpectedOrigin) {
        return;
      }
      if (!fromSameWindow && window.parent !== window && event.source !== window.parent) {
        return;
      }
      const data = event.data as { type?: unknown; payload?: { name?: string; content?: string } } | null;
      if (!data || typeof data !== "object") return;

      if (data.type === "ACTIVE_FILE_CHANGED" && data.payload) {
        setActiveFile({
          name: data.payload.name || "untitled",
          content: data.payload.content || "",
        });
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [verifiedOrigin]);

  const sendMessage = (type: string, payload: unknown) => {
    const tauri = (
      window as unknown as {
        __TAURI__?: { event?: { emit: (t: string, p: unknown) => void } };
      }
    ).__TAURI__;
    if (environment === "vscode" && window.parent !== window) {
      if (!verifiedOrigin) {
        console.warn("[WorkspaceBridge] Blocked postMessage because target origin could not be verified.");
        return;
      }
      window.parent.postMessage({ type, payload }, verifiedOrigin);
    } else if (environment === "tauri" && tauri?.event) {
      tauri.event.emit(type, payload);
    } else {
      console.log(`[WorkspaceBridge: ${environment}]`, type, payload);
    }
  };

  return {
    environment,
    activeFile,
    sendMessage,
  };
}
