// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEditorTheme } from "@modelscript/editor/host";
import {
  AnsatzTrainingStudioPanel,
  type ComputeDialPreset,
} from "@modelscript/editor/workbench/panels/AnsatzTrainingStudioPanel.js";
import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { getVsCodeWebviewApi, useVsCodeHostActions, VsCodeEditorHostProvider } from "./shared/vscode-editor-host.js";

interface StudioDocSync {
  documentUri: string;
  dialect: string;
  sourceCode: string;
  groupIdOverlayEnabled?: boolean | undefined;
  computeDialM?: number | undefined;
  apiBaseUrl?: string | undefined;
}

const vscodeApi = getVsCodeWebviewApi();

function mToPreset(m: number | undefined): ComputeDialPreset {
  if (typeof m !== "number") return "auto-escalate";
  if (m <= 0) return "fast-m0";
  if (m >= 24) return "certified-m32";
  return "auto-escalate";
}

function presetToM(preset: ComputeDialPreset): number {
  if (preset === "fast-m0") return 0;
  if (preset === "certified-m32") return 32;
  return 16;
}

const TrainingStudioWebviewInner: React.FC = () => {
  const { theme } = useEditorTheme();
  const actions = useVsCodeHostActions();

  const [docState, setDocState] = useState<StudioDocSync>({
    documentUri: "",
    dialect: "modelica",
    sourceCode: "",
  });
  const [showOverlay, setShowOverlay] = useState(false);
  const [computeDial, setComputeDial] = useState<ComputeDialPreset>("auto-escalate");

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const msg = ev.data as
        | { type?: string; data?: StudioDocSync; state?: { groupIdOverlayEnabled?: boolean; computeDialM?: number } }
        | undefined;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "studioDocumentSync" && msg.data) {
        setDocState(msg.data);
        if (typeof msg.data.groupIdOverlayEnabled === "boolean") {
          setShowOverlay(msg.data.groupIdOverlayEnabled);
        }
        if (typeof msg.data.computeDialM === "number") {
          setComputeDial(mToPreset(msg.data.computeDialM));
        }
      } else if (msg.type === "state" && msg.state) {
        if (typeof msg.state.groupIdOverlayEnabled === "boolean") {
          setShowOverlay(msg.state.groupIdOverlayEnabled);
        }
        if (typeof msg.state.computeDialM === "number") {
          setComputeDial(mToPreset(msg.state.computeDialM));
        }
      }
    };
    window.addEventListener("message", onMessage);
    vscodeApi.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const handleToggleOverlay = useCallback((enabled: boolean) => {
    setShowOverlay(enabled);
    vscodeApi.postMessage({ type: "toggleGroupIdOverlay", enabled });
  }, []);

  const handleChangeComputeDial = useCallback((preset: ComputeDialPreset) => {
    setComputeDial(preset);
    vscodeApi.postMessage({ type: "setComputeDialM", value: presetToM(preset) });
  }, []);

  const handleLoadExampleSource = useCallback(
    (source: string) => {
      actions.applyEdit(source);
    },
    [actions],
  );

  return (
    <div style={{ width: "100%", height: "100vh", overflow: "auto", boxSizing: "border-box" }}>
      <AnsatzTrainingStudioPanel
        documentUri={docState.documentUri || "memfs:/Main.mo"}
        dialect={docState.dialect || "modelica"}
        sourceCode={docState.sourceCode}
        colorMode={theme}
        showHypergraphOverlay={showOverlay}
        onToggleHypergraphOverlay={handleToggleOverlay}
        computeDial={computeDial}
        onChangeComputeDial={handleChangeComputeDial}
        onLoadExampleSource={handleLoadExampleSource}
        apiBaseUrl={docState.apiBaseUrl}
      />
    </div>
  );
};

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <VsCodeEditorHostProvider vscodeApi={vscodeApi}>
      <TrainingStudioWebviewInner />
    </VsCodeEditorHostProvider>,
  );
}
