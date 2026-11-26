// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEditorTheme } from "@modelscript/editor/host";
import { AnsatzOptimizationUqPanel } from "@modelscript/editor/workbench/panels/AnsatzOptimizationUqPanel.js";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { getVsCodeWebviewApi, VsCodeEditorHostProvider } from "./shared/vscode-editor-host.js";

interface OptimizationDocSync {
  documentUri: string;
  dialect: string;
  selectedClassName?: string | undefined;
}

const vscodeApi = getVsCodeWebviewApi();

const OptimizationWebviewInner: React.FC = () => {
  const { theme } = useEditorTheme();
  const [docState, setDocState] = useState<OptimizationDocSync>({
    documentUri: "",
    dialect: "modelica",
  });

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const msg = ev.data as { type?: string; data?: OptimizationDocSync } | undefined;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "syncOptimizationDocument" && msg.data) {
        setDocState(msg.data);
      }
    };
    window.addEventListener("message", onMessage);
    vscodeApi.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

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
        Open a Modelica or ModelScript file to run Optimization, Monte Carlo UQ, Surrogate Training, or BLT analysis…
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100vh", overflow: "auto", boxSizing: "border-box" }}>
      <AnsatzOptimizationUqPanel
        documentUri={docState.documentUri}
        dialect={docState.dialect}
        selectedClassName={docState.selectedClassName}
        colorMode={theme}
      />
    </div>
  );
};

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <VsCodeEditorHostProvider vscodeApi={vscodeApi}>
      <OptimizationWebviewInner />
    </VsCodeEditorHostProvider>,
  );
}
