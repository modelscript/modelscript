// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEditorTheme } from "@modelscript/editor/host";
import { AnsatzDigitalThreadPanel } from "@modelscript/editor/workbench/panels/AnsatzDigitalThreadPanel.js";
import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { getVsCodeWebviewApi, useVsCodeHostActions, VsCodeEditorHostProvider } from "./shared/vscode-editor-host.js";

interface ThreadDocSync {
  documentUri: string;
  activeFileName: string;
  projectFiles: Record<string, string>;
}

const vscodeApi = getVsCodeWebviewApi();

export function ThreadExplorerApp(): React.ReactElement {
  const { theme } = useEditorTheme();
  const actions = useVsCodeHostActions();

  const [docState, setDocState] = useState<ThreadDocSync>({
    documentUri: "",
    activeFileName: "",
    projectFiles: {},
  });

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const msg = ev.data as { type?: string; data?: ThreadDocSync } | undefined;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "syncThreadDocument" && msg.data) {
        setDocState(msg.data);
      }
    };
    window.addEventListener("message", onMessage);
    vscodeApi.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const handleUpdateProjectFile = useCallback(
    (fileName: string, content: string) => {
      setDocState((prev) => ({
        ...prev,
        projectFiles: { ...prev.projectFiles, [fileName]: content },
      }));
      actions.updateProjectFile(fileName, content);
    },
    [actions],
  );

  return (
    <div style={{ width: "100%", height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 12px",
          borderBottom: "1px solid var(--vscode-panel-border, #30363d)",
          fontSize: "12px",
        }}
      >
        <span style={{ fontWeight: 600 }}>Digital Thread Explorer</span>
        <button
          type="button"
          onClick={() => vscodeApi.postMessage({ type: "exportProvenance" })}
          style={{
            background: "var(--vscode-button-secondaryBackground, #21262d)",
            color: "var(--vscode-button-secondaryForeground, #c9d1d9)",
            border: "1px solid var(--vscode-panel-border, #30363d)",
            borderRadius: "4px",
            padding: "4px 10px",
            cursor: "pointer",
            fontSize: "11px",
          }}
        >
          Export W3C PROV-O Bundle
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <AnsatzDigitalThreadPanel
          documentUri={docState.documentUri || undefined}
          activeFileName={docState.activeFileName || undefined}
          projectFiles={docState.projectFiles}
          colorMode={theme}
          onUpdateProjectFile={handleUpdateProjectFile}
          onRevealLine={(line, identifier) => actions.revealLine(line, identifier)}
        />
      </div>
    </div>
  );
}

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <VsCodeEditorHostProvider vscodeApi={vscodeApi}>
      <ThreadExplorerApp />
    </VsCodeEditorHostProvider>,
  );
}
