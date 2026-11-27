// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CanvasDocument } from "@modelscript/canvas";
import type { ComponentPropertyData, DiagramEditAction, DiagramPalette } from "@modelscript/diagram/protocol";
import { diagramPaletteToGalleryCatalog } from "@modelscript/rotunda/spatial-diagram-state.js";
import type { EngineeringRotundaProps, RotundaEnvironmentId } from "@modelscript/rotunda/types.js";
import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { getVsCodeWebviewApi, useVsCodeHostActions, VsCodeEditorHostProvider } from "./shared/vscode-editor-host.js";

const LazyEngineeringRotunda = React.lazy(async () => {
  const mod = (await import("@modelscript/rotunda/EngineeringRotunda.js")) as {
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
  diagramType?: string | undefined;
  sourceCode: string;
  documentUri: string;
  diagramData?:
    | {
        nodes?: unknown[];
        edges?: unknown[];
        availableViews?: { id: string; label: string }[];
      }
    | undefined;
  diagnostics?: { severity: "error" | "warning" | "info"; line: number; message: string }[] | undefined;
}

const vscodeApi = getVsCodeWebviewApi();

const SpatialDiagramWebviewInner: React.FC = () => {
  const actions = useVsCodeHostActions();
  const [payload, setPayload] = useState<SpatialDiagramPayload | null>(null);
  const [palette, setPalette] = useState<DiagramPalette | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedProps, setSelectedProps] = useState<ComponentPropertyData | null>(null);
  const [simulationTime, setSimulationTime] = useState(0);

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const msg = ev.data as
        | {
            type?: string;
            data?: SpatialDiagramPayload;
            palette?: DiagramPalette;
            componentName?: string;
            properties?: ComponentPropertyData | null;
          }
        | undefined;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "spatialDiagramData" && msg.data) {
        setPayload(msg.data);
      } else if (msg.type === "spatialPalette" && msg.palette) {
        setPalette(msg.palette);
      } else if (msg.type === "spatialComponentProperties") {
        setSelectedProps(msg.properties ?? null);
      }
    };
    window.addEventListener("message", onMessage);
    vscodeApi.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const libraryCatalog = useMemo(
    () => (palette ? diagramPaletteToGalleryCatalog(palette, payload?.languageId || "modelica") : undefined),
    [palette, payload?.languageId],
  );

  const handleSelectNode = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId);
    if (nodeId) {
      vscodeApi.postMessage({ type: "getProperties", componentName: nodeId });
    } else {
      setSelectedProps(null);
    }
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
          diagramType={payload.diagramType}
          sourceCode={payload.sourceCode}
          title={payload.title}
          simulationTime={simulationTime}
          onSimulationTimeChange={setSimulationTime}
          libraryCatalog={libraryCatalog}
          selectedNodeId={selectedNodeId}
          onSelectNode={handleSelectNode}
          onUndo={() => vscodeApi.postMessage({ type: "undo" })}
          onRedo={() => vscodeApi.postMessage({ type: "redo" })}
          onDrillDown={(nodeId) => vscodeApi.postMessage({ type: "drillDown", nodeId })}
          onRevealSource={(nodeId) => vscodeApi.postMessage({ type: "revealSource", nodeId })}
          availableDiagramViews={payload.diagramData?.availableViews}
          onSelectDiagramType={(diagramType) => vscodeApi.postMessage({ type: "changeDiagramType", diagramType })}
          inspectorData={{
            selectedComponent: selectedNodeId,
            parameters: selectedProps?.parameters?.map((p) => ({
              name: p.name,
              value: String(p.value || p.defaultValue || ""),
              unit: p.unit,
              isBoolean: p.isBoolean,
            })),
            diagnostics: payload.diagnostics,
            onModifyParameter: selectedNodeId
              ? (parameter, value) =>
                  handleDiagramEdit([{ type: "updateParameter", name: selectedNodeId, parameter, value }])
              : undefined,
            onRenameComponent: (oldName, newName) => handleDiagramEdit([{ type: "updateName", oldName, newName }]),
          }}
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
