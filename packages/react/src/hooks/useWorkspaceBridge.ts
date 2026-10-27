// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from "react";
import { useModelScript } from "../context.js";

export interface WorkspaceBridgeState {
  environment: "web" | "tauri" | "vscode";
  activeFile: { name: string; content: string } | null;
  sendMessage: (type: string, payload: unknown) => void;
}

/**
 * Universal bridge hook connecting a React app to its host environment:
 * - VS Code: listens to active editor document changes and posts messages to extension host
 * - Tauri: connects to Tauri native IPC
 * - Web: operates in browser sandbox
 */
export function useWorkspaceBridge(): WorkspaceBridgeState {
  const { environment } = useModelScript();
  const [activeFile, setActiveFile] = useState<{ name: string; content: string } | null>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
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
  }, []);

  const sendMessage = (type: string, payload: unknown) => {
    const tauri = (
      window as unknown as {
        __TAURI__?: { event?: { emit: (t: string, p: unknown) => void } };
      }
    ).__TAURI__;
    if (environment === "vscode" && window.parent !== window) {
      window.parent.postMessage({ type, payload }, "*");
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
