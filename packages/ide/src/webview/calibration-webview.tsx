// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEditorTheme } from "@modelscript/editor/host";
import { AnsatzCalibrationPanel } from "@modelscript/editor/workbench/panels/AnsatzCalibrationPanel.js";
import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { getVsCodeWebviewApi, useVsCodeHostActions, VsCodeEditorHostProvider } from "./shared/vscode-editor-host.js";

interface CalibrationDocSync {
  documentUri: string;
  activeFileName: string;
  activeCode: string;
  projectFiles?: Record<string, string> | undefined;
}

const vscodeApi = getVsCodeWebviewApi();

const CalibrationWebviewInner: React.FC = () => {
  const { theme } = useEditorTheme();
  const actions = useVsCodeHostActions();

  const [docState, setDocState] = useState<CalibrationDocSync>({
    documentUri: "",
    activeFileName: "Main.mo",
    activeCode: "",
    projectFiles: {},
  });

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const msg = ev.data as { type?: string; data?: CalibrationDocSync } | undefined;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "syncCalibrationDocument" && msg.data) {
        setDocState((prev) => ({
          documentUri: msg.data?.documentUri ?? prev.documentUri,
          activeFileName: msg.data?.activeFileName ?? prev.activeFileName,
          activeCode: msg.data?.activeCode ?? prev.activeCode,
          projectFiles: {
            ...(prev.projectFiles ?? {}),
            ...(msg.data?.projectFiles ?? {}),
          },
        }));
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
        projectFiles: { ...(prev.projectFiles ?? {}), [fileName]: content },
      }));
      actions.updateProjectFile(fileName, content);
    },
    [actions],
  );

  const handleCodeChange = useCallback(
    (nextCode: string) => {
      setDocState((prev) => ({ ...prev, activeCode: nextCode }));
      actions.applyEdit(nextCode);
    },
    [actions],
  );

  const handlePickDataset = useCallback(async () => {
    const picked = await actions.pickFile({
      openLabel: "Select Measurement Data (CSV / COMTRADE)",
      filters: {
        "Measurement Data": ["csv", "txt", "cfg", "cff"],
        CSV: ["csv", "txt"],
        COMTRADE: ["cfg", "cff"],
      },
    });
    if (picked) {
      setDocState((prev) => ({
        ...prev,
        projectFiles: { ...(prev.projectFiles ?? {}), [picked.name]: picked.content },
      }));
    }
  }, [actions]);

  if (!docState.documentUri) {
    return (
      <div
        style={{
          padding: "24px",
          fontFamily: "var(--vscode-font-family, system-ui, sans-serif)",
          color: "var(--vscode-descriptionForeground, #8b949e)",
          fontSize: "13px",
        }}
      >
        Open a Modelica or ModelScript file to calibrate parameters against CSV or COMTRADE measurement data…
      </div>
    );
  }

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
        <span style={{ opacity: 0.85 }}>
          Model: <strong>{docState.activeFileName}</strong>
        </span>
        <button
          type="button"
          onClick={() => void handlePickDataset()}
          style={{
            background: "var(--vscode-button-background, #0e639c)",
            color: "var(--vscode-button-foreground, #ffffff)",
            border: "none",
            borderRadius: "4px",
            padding: "4px 10px",
            cursor: "pointer",
            fontSize: "11px",
          }}
        >
          Browse CSV / COMTRADE…
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <AnsatzCalibrationPanel
          documentUri={docState.documentUri}
          activeFileName={docState.activeFileName}
          activeCode={docState.activeCode}
          projectFiles={docState.projectFiles}
          colorMode={theme}
          onUpdateProjectFile={handleUpdateProjectFile}
          onCodeChange={handleCodeChange}
        />
      </div>
    </div>
  );
};

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <VsCodeEditorHostProvider vscodeApi={vscodeApi}>
      <CalibrationWebviewInner />
    </VsCodeEditorHostProvider>,
  );
}
