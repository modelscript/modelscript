// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEditorHost, useEditorTheme } from "@modelscript/editor/host";
import { AnsatzAiPanel } from "@modelscript/editor/workbench/panels/AnsatzAiPanel.js";
import type { ComputeDialPreset } from "@modelscript/editor/workbench/panels/AnsatzTrainingStudioPanel.js";
import type { AnsatzDiagnosticSummary, AnsatzToolHost } from "@modelscript/editor/workbench/util/ansatz-tool-bridge.js";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { getVsCodeWebviewApi, useVsCodeHostActions, VsCodeEditorHostProvider } from "./shared/vscode-editor-host.js";

interface CopilotContextSync {
  documentUri: string;
  fileName: string;
  dialect: string;
  code: string;
  diagnostics: AnsatzDiagnosticSummary[];
}

const vscodeApi = getVsCodeWebviewApi();

const AiCopilotWebviewInner: React.FC = () => {
  const { theme } = useEditorTheme();
  const host = useEditorHost();
  const actions = useVsCodeHostActions();

  const [ctx, setCtx] = useState<CopilotContextSync>({
    documentUri: "",
    fileName: "Untitled.mo",
    dialect: "modelica",
    code: "",
    diagnostics: [],
  });
  const [computeDial, setComputeDial] = useState<ComputeDialPreset>("auto-escalate");

  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const msg = ev.data as { type?: string; data?: CopilotContextSync } | undefined;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "syncCopilotContext" && msg.data) {
        setCtx(msg.data);
      }
    };
    window.addEventListener("message", onMessage);
    vscodeApi.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const toolHost = useMemo<AnsatzToolHost>(
    () => ({
      getFileName: () => ctxRef.current.fileName,
      getDialect: () => ctxRef.current.dialect,
      getCode: () => ctxRef.current.code,
      getDiagnostics: () => ctxRef.current.diagnostics,
      getSelectedComponent: () => undefined,
      applyCodeEdit: (nextCode: string) => {
        setCtx((prev) => ({ ...prev, code: nextCode }));
        actions.applyEdit(nextCode);
        return true;
      },
      runFlatten: async () => {
        if (!host.lspTransport || !ctxRef.current.documentUri) {
          return { ok: false, output: "No active model document to flatten." };
        }
        try {
          const res = await host.lspTransport.sendRequest<unknown>("modelscript/flatten", {
            uri: ctxRef.current.documentUri,
          });
          return {
            ok: true,
            output: typeof res === "string" ? res : JSON.stringify(res, null, 2),
          };
        } catch (err) {
          return { ok: false, output: err instanceof Error ? err.message : String(err) };
        }
      },
      runSimulate: async () => {
        if (!host.lspTransport || !ctxRef.current.documentUri) {
          return { ok: false, output: "No active model document to simulate." };
        }
        try {
          const res = await host.lspTransport.sendRequest<unknown>("modelscript/simulate", {
            uri: ctxRef.current.documentUri,
          });
          return {
            ok: true,
            output: typeof res === "string" ? res : JSON.stringify(res, null, 2).slice(0, 4000),
          };
        } catch (err) {
          return { ok: false, output: err instanceof Error ? err.message : String(err) };
        }
      },
      switchView: (view) => {
        vscodeApi.postMessage({ type: "switchView", view });
      },
    }),
    [actions, host.lspTransport],
  );

  return (
    <div style={{ width: "100%", height: "100vh", overflow: "hidden", position: "relative" }}>
      <AnsatzAiPanel
        isOpen={true}
        onClose={() => vscodeApi.postMessage({ type: "closeCopilot" })}
        colorMode={theme}
        toolHost={toolHost}
        fileName={ctx.fileName}
        dialect={ctx.dialect}
        diagnostics={ctx.diagnostics}
        floating={false}
        computeDial={computeDial}
        onChangeComputeDial={setComputeDial}
      />
    </div>
  );
};

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <VsCodeEditorHostProvider vscodeApi={vscodeApi}>
      <AiCopilotWebviewInner />
    </VsCodeEditorHostProvider>,
  );
}
