// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEditorTheme } from "@modelscript/editor/host";
import { AnsatzRtmContractsPanel } from "@modelscript/editor/workbench/panels/AnsatzRtmContractsPanel.js";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { getVsCodeWebviewApi, useVsCodeHostActions, VsCodeEditorHostProvider } from "./shared/vscode-editor-host.js";

const vscodeApi = getVsCodeWebviewApi();

const RtmContractsWebviewInner: React.FC = () => {
  const { theme } = useEditorTheme();
  const actions = useVsCodeHostActions();
  const [documentUri, setDocumentUri] = useState<string>("");

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const msg = ev.data as { type?: string; documentUri?: string } | undefined;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "syncDocument" && typeof msg.documentUri === "string") {
        setDocumentUri(msg.documentUri);
      }
    };
    window.addEventListener("message", onMessage);
    vscodeApi.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (!documentUri) {
    return (
      <div
        style={{
          padding: "24px",
          fontFamily: "var(--vscode-font-family, system-ui, sans-serif)",
          color: "var(--vscode-descriptionForeground, #8b949e)",
          fontSize: "13px",
        }}
      >
        Open a SysML v2, Modelica, or ReqIF file to inspect Requirements, RTM, and Assume/Guarantee Contracts…
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100vh", overflow: "auto", boxSizing: "border-box" }}>
      <AnsatzRtmContractsPanel
        documentUri={documentUri}
        colorMode={theme}
        onRevealLine={(line) => actions.revealLine(line)}
      />
    </div>
  );
};

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <VsCodeEditorHostProvider vscodeApi={vscodeApi}>
      <RtmContractsWebviewInner />
    </VsCodeEditorHostProvider>,
  );
}
