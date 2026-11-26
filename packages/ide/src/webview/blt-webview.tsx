// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEditorHost, useEditorTheme } from "@modelscript/editor/host";
import { analyzeModelBlt } from "@modelscript/editor/workbench/panels/blt-analysis.js";
import { BltVisualizer } from "@modelscript/editor/workbench/panels/BltVisualizer.js";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { getVsCodeWebviewApi, useVsCodeHostActions, VsCodeEditorHostProvider } from "./shared/vscode-editor-host.js";

interface BltInitPayload {
  sourceCode: string;
  flattenedCode?: string | undefined;
  className?: string | undefined;
  documentUri?: string | undefined;
}

const vscodeApi = getVsCodeWebviewApi();

const BltWebviewInner: React.FC = () => {
  const { theme } = useEditorTheme();
  const host = useEditorHost();
  const actions = useVsCodeHostActions();

  const [payload, setPayload] = useState<BltInitPayload | null>(null);
  const [sourceMode, setSourceMode] = useState<"flattened" | "source">("source");
  const [flattenedCode, setFlattenedCode] = useState<string | undefined>(undefined);
  const [isFlattening, setIsFlattening] = useState(false);

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const msg = ev.data as { type?: string; data?: BltInitPayload } | undefined;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "bltModelData" && msg.data) {
        setPayload(msg.data);
        if (typeof msg.data.flattenedCode === "string" && msg.data.flattenedCode.length > 0) {
          setFlattenedCode(msg.data.flattenedCode);
          setSourceMode("flattened");
        } else {
          setFlattenedCode(undefined);
          setSourceMode("source");
        }
      }
    };
    window.addEventListener("message", onMessage);
    vscodeApi.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const handleSourceModeChange = useCallback(
    async (nextMode: "flattened" | "source") => {
      setSourceMode(nextMode);
      if (nextMode === "flattened" && !flattenedCode && payload?.documentUri && host.lspTransport) {
        setIsFlattening(true);
        try {
          const res = await host.lspTransport.sendRequest<{ flattened?: string; code?: string } | string>(
            "modelscript/flatten",
            { uri: payload.documentUri },
          );
          const flatText =
            typeof res === "string"
              ? res
              : typeof res?.flattened === "string"
                ? res.flattened
                : typeof res?.code === "string"
                  ? res.code
                  : undefined;
          if (flatText && flatText.trim().length > 0) {
            setFlattenedCode(flatText);
          } else {
            host.notify?.("Flattened DAE output was empty; showing source equations.", "warning");
            setSourceMode("source");
          }
        } catch (err) {
          host.notify?.(`Failed to flatten model: ${err instanceof Error ? err.message : String(err)}`, "error");
          setSourceMode("source");
        } finally {
          setIsFlattening(false);
        }
      }
    },
    [flattenedCode, host, payload?.documentUri],
  );

  const analysis = useMemo(() => {
    if (!payload) return null;
    const activeCode = sourceMode === "flattened" && flattenedCode ? flattenedCode : payload.sourceCode;
    const lines = activeCode.split(/\r?\n/);
    return analyzeModelBlt(activeCode, lines, payload.className, {
      sourceKind: sourceMode === "flattened" && flattenedCode ? "flattened" : "source",
    });
  }, [flattenedCode, payload, sourceMode]);

  if (!analysis) {
    return (
      <div
        style={{
          padding: "24px",
          fontFamily: "var(--vscode-font-family, system-ui, sans-serif)",
          color: "var(--vscode-descriptionForeground, #8b949e)",
          fontSize: "13px",
        }}
      >
        Analyzing Block Lower Triangular (BLT) equation system…
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100vh", overflow: "auto", padding: "12px", boxSizing: "border-box" }}>
      <BltVisualizer
        analysis={analysis}
        colorMode={theme}
        onRevealLine={(line, identifier) => actions.revealLine(line, identifier)}
        sourceMode={sourceMode}
        hasFlattenedDae={Boolean(flattenedCode || payload?.documentUri)}
        isFlattening={isFlattening}
        onSourceModeChange={(m) => {
          void handleSourceModeChange(m);
        }}
      />
    </div>
  );
};

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <VsCodeEditorHostProvider vscodeApi={vscodeApi}>
      <BltWebviewInner />
    </VsCodeEditorHostProvider>,
  );
}
