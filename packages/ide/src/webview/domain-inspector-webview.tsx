// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEditorTheme } from "@modelscript/editor/host";
import {
  PolyglotDomainPanel,
  type PolyglotDocumentSymbol,
} from "@modelscript/editor/workbench/panels/PolyglotDomainPanel.js";
import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { getVsCodeWebviewApi, useVsCodeHostActions, VsCodeEditorHostProvider } from "./shared/vscode-editor-host.js";

interface DomainInspectorDocSync {
  documentUri: string;
  activeFileName: string;
  dialect: string;
  code: string;
  projectFiles?: Record<string, string> | undefined;
  documentSymbols?: PolyglotDocumentSymbol[] | undefined;
}

const vscodeApi = getVsCodeWebviewApi();

const DomainInspectorWebviewInner: React.FC = () => {
  const { theme } = useEditorTheme();
  const actions = useVsCodeHostActions();

  const [docState, setDocState] = useState<DomainInspectorDocSync>({
    documentUri: "",
    activeFileName: "",
    dialect: "modelica",
    code: "",
    projectFiles: {},
  });

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const msg = ev.data as { type?: string; data?: DomainInspectorDocSync } | undefined;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "syncDomainInspector" && msg.data) {
        setDocState(msg.data);
      }
    };
    window.addEventListener("message", onMessage);
    vscodeApi.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const handleCodeChange = useCallback(
    (newCode: string) => {
      setDocState((prev) => ({ ...prev, code: newCode }));
      actions.applyEdit(newCode);
    },
    [actions],
  );

  const handleUpdateProjectFile = useCallback(
    (relativePath: string, content: string) => {
      setDocState((prev) => ({
        ...prev,
        projectFiles: { ...(prev.projectFiles ?? {}), [relativePath]: content },
      }));
      actions.updateProjectFile(relativePath, content);
    },
    [actions],
  );

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
        Open any engineering file (Modelica, PSS/E, PSCAD, SysML v2, URDF, FEA/CFD, SBML, OLGA, HEC-RAS, PLCopen, GTFS,
        CSV, etc.) to launch the Ansatz Polyglot Domain Inspector…
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100vh", overflow: "auto", boxSizing: "border-box" }}>
      <PolyglotDomainPanel
        dialect={docState.dialect}
        code={docState.code}
        colorMode={theme}
        isVisible={true}
        documentUri={docState.documentUri}
        activeFileName={docState.activeFileName}
        projectFiles={docState.projectFiles}
        documentSymbols={docState.documentSymbols}
        onCodeChange={handleCodeChange}
        onUpdateProjectFile={handleUpdateProjectFile}
        onRevealLine={(line, identifier) => actions.revealLine(line, identifier)}
      />
    </div>
  );
};

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <VsCodeEditorHostProvider vscodeApi={vscodeApi}>
      <DomainInspectorWebviewInner />
    </VsCodeEditorHostProvider>,
  );
}
