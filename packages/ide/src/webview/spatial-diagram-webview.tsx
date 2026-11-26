// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CanvasDocument } from "@modelscript/canvas";
import type { DiagramEditAction } from "@modelscript/diagram/protocol";
import type { EngineeringRotundaProps, RotundaEnvironmentId } from "@modelscript/editor/workbench/vr-rotunda/types.js";
import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { getVsCodeWebviewApi, useVsCodeHostActions, VsCodeEditorHostProvider } from "./shared/vscode-editor-host.js";

const LazyEngineeringRotunda = React.lazy(async () => {
  const mod = (await import("@modelscript/editor/workbench/vr-rotunda/EngineeringRotunda.js")) as {
    default?: React.ComponentType<EngineeringRotundaProps>;
    EngineeringRotunda?: React.ComponentType<EngineeringRotundaProps>;
  };
  const Loaded = mod.EngineeringRotunda ?? mod.default;
  if (!Loaded) {
    throw new Error("EngineeringRotunda export not found.");
  }
  return { default: Loaded };
});

interface SpatialDiagramPayload {
  title: string;
  languageId: string;
  sourceCode: string;
  documentUri: string;
  diagramData?: { nodes?: unknown[]; edges?: unknown[] } | undefined;
}

const vscodeApi = getVsCodeWebviewApi();

const SpatialDiagramWebviewInner: React.FC = () => {
  const actions = useVsCodeHostActions();
  const [payload, setPayload] = useState<SpatialDiagramPayload | null>(null);
  const [simulationTime, setSimulationTime] = useState(0);

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const msg = ev.data as { type?: string; data?: SpatialDiagramPayload } | undefined;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "spatialDiagramData" && msg.data) {
        setPayload(msg.data);
      }
    };
    window.addEventListener("message", onMessage);
    vscodeApi.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const canvasDoc = useMemo<CanvasDocument | undefined>(() => {
    if (!payload) return undefined;
    return {
      version: "1.0",
      name: payload.title,
      tiles: [
        {
          id: "active-model-tile",
          kind: "diagram",
          title: payload.title,
          language: payload.languageId,
          sourceUri: payload.documentUri,
          x: 0,
          y: 0,
          width: 960,
          height: 600,
          viewState: {
            diagramData: payload.diagramData ?? { nodes: [], edges: [] },
          },
        },
      ],
      wires: [],
    } as unknown as CanvasDocument;
  }, [payload]);

  const handleDiagramEdit = useCallback((editActions: DiagramEditAction[]) => {
    if (!editActions || editActions.length === 0) return;
    vscodeApi.postMessage({
      type: "applyDiagramActions",
      actions: editActions,
    });
  }, []);

  const handleOpenExternalVr = useCallback(
    (opts: { environment: RotundaEnvironmentId; activeModelIndex: number }) => {
      actions.openInVr({
        environment: opts.environment,
        activeModelIndex: opts.activeModelIndex,
      });
    },
    [actions],
  );

  if (!payload || !canvasDoc) {
    return (
      <div
        style={{
          width: "100vw",
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#050914",
          color: "#cbd5e1",
          fontFamily: "system-ui, -apple-system, sans-serif",
          fontSize: "13px",
        }}
      >
        Initializing 3D Spatial Diagram Stage…
      </div>
    );
  }

  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", position: "relative" }}>
      <Suspense
        fallback={
          <div
            style={{
              width: "100vw",
              height: "100vh",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#050914",
              color: "#cbd5e1",
              fontFamily: "system-ui, -apple-system, sans-serif",
              fontSize: "14px",
            }}
          >
            Loading 3D Engineering Rotunda & Spatial Diagram Stage…
          </div>
        }
      >
        <LazyEngineeringRotunda
          document={canvasDoc}
          mode="spatial-3d"
          initialEnvironment="atrium"
          initialDiagramEditorEnabled={true}
          initialActiveView="diagram"
          initialPodiumVisible={false}
          languageId={payload.languageId}
          sourceCode={payload.sourceCode}
          title={payload.title}
          simulationTime={simulationTime}
          onSimulationTimeChange={setSimulationTime}
          onDiagramEdit={handleDiagramEdit}
          onOpenExternalVr={handleOpenExternalVr}
          exitTo2DLabel="Close 3D Stage"
          onExitTo2D={() => vscodeApi.postMessage({ type: "closeSpatialStage" })}
        />
      </Suspense>
    </div>
  );
};

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <VsCodeEditorHostProvider vscodeApi={vscodeApi}>
      <SpatialDiagramWebviewInner />
    </VsCodeEditorHostProvider>,
  );
}
