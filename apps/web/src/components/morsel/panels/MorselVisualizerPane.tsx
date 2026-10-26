// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { DynamicBindingConfig } from "@modelscript/cad";
import { PauseIcon, PlayIcon, PulseIcon, StackIcon, WorkflowIcon } from "@primer/octicons-react";
import { Button, SegmentedControl, Spinner } from "@primer/react";
import type { editor } from "monaco-editor";
import React, { Suspense, useRef } from "react";
import type { CadComponent } from "../cad-viewer";
import type { AnimationController } from "../cad-viewer/animation-controller";
import { CosimPanel, type HistorianSession } from "../CosimPanel";
import type { DiagramEditorHandle } from "../Diagram";
import PropertiesWidget from "../Properties";
import type { MobileTab } from "./MorselMobileTabBar";
import { MorselView } from "./types";

const DiagramEditor = React.lazy(() => import("../Diagram"));
const CadViewerPanel = React.lazy(() => import("../cad-viewer").then((m) => ({ default: m.CadViewer })));
const SimulationResults = React.lazy(() =>
  import("../SimulationResults").then((m) => ({ default: m.SimulationResults })),
);

export interface MorselVisualizerPaneProps {
  view: MorselView;
  isNarrow: boolean;
  mobileTab: MobileTab;
  splitRatio: number;
  nestedModels: any[];
  selectedModelIndex: number;
  setSelectedModelIndex: (i: number) => void;
  setSelectedTreeClassName: (name: string | null) => void;
  colorMode: "dark" | "light";
  translations: any;
  showResultsView: boolean;
  setShowResultsView: (v: boolean) => void;
  showCadView: boolean;
  setShowCadView: (v: boolean) => void;
  cadComponents: CadComponent[];
  animationMode: "stopped" | "playing" | "paused" | "live";
  animationControllerRef: React.RefObject<AnimationController | null>;
  diagramEditorRef: React.RefObject<DiagramEditorHandle | null>;
  diagramData: any;
  selectedTreeClassName: string | null;
  selectedComponent: string | null;
  setSelectedComponent: (comp: string | null) => void;
  isDiagramLoading: boolean;
  setIsDiagramLoading: (loading: boolean) => void;
  handleSelectComponent: (name: string | null) => void;
  enqueueDiagramAction: (action: any) => void;
  editor: editor.ICodeEditor | null;
  editorRef: React.RefObject<editor.ICodeEditor | null>;
  isSpatialEditPending: React.MutableRefObject<boolean>;
  propertiesWidth: number;
  setPropertiesWidth: (w: number) => void;
  selectedComponentProperties: any;
  isPropertiesLoading: boolean;
  expectedComponentNameRef: React.MutableRefObject<string | null>;
  handleSaveCadBindings: (componentName: string, bindings: DynamicBindingConfig[]) => void;
  simulationVariables: string[];
  selectedSimulationVariables: string[];
  cosimDataSource: "local" | "mqtt-live" | "historian-replay";
  setCosimDataSource: (ds: "local" | "mqtt-live" | "historian-replay") => void;
  handleReplaySession: (session: HistorianSession, speed: number) => void;
  localSimulationData: Record<string, number | string>[] | null;
  sweepResults: { value: number; y: number[][] }[] | null;
  simulationStatus: any;
  handleVariablesLoaded: (vars: string[]) => void;
}

const isSplit = (v: MorselView) => v === MorselView.SPLIT_COLUMNS || v === MorselView.SPLIT_ROWS;

export const MorselVisualizerPane: React.FC<MorselVisualizerPaneProps> = ({
  view,
  isNarrow,
  mobileTab,
  splitRatio,
  nestedModels,
  selectedModelIndex,
  setSelectedModelIndex,
  setSelectedTreeClassName,
  colorMode,
  translations,
  showResultsView,
  setShowResultsView,
  showCadView,
  setShowCadView,
  cadComponents,
  animationMode,
  animationControllerRef,
  diagramEditorRef,
  diagramData,
  selectedTreeClassName,
  selectedComponent,
  setSelectedComponent,
  isDiagramLoading,
  setIsDiagramLoading,
  handleSelectComponent,
  enqueueDiagramAction,
  editor,
  editorRef,
  isSpatialEditPending,
  propertiesWidth,
  setPropertiesWidth,
  selectedComponentProperties,
  isPropertiesLoading,
  expectedComponentNameRef,
  handleSaveCadBindings,
  simulationVariables,
  selectedSimulationVariables,
  cosimDataSource,
  setCosimDataSource,
  handleReplaySession,
  localSimulationData,
  sweepResults,
  simulationStatus,
  handleVariablesLoaded,
}) => {
  const isDraggingProperties = useRef(false);

  if (!((view === MorselView.DIAGRAM || isSplit(view)) && (!isNarrow || mobileTab !== "code"))) {
    return null;
  }

  return (
    <div
      style={{
        display: "flex",
        flex: isNarrow ? 1 : isSplit(view) ? "none" : 1,
        width: isNarrow
          ? "100%"
          : isSplit(view) && view === MorselView.SPLIT_COLUMNS
            ? `${splitRatio * 100}%`
            : isSplit(view)
              ? undefined
              : "100%",
        height: isNarrow ? "100%" : isSplit(view) && view === MorselView.SPLIT_ROWS ? `${splitRatio * 100}%` : "100%",
        flexDirection: "column",
        minWidth: 0,
        minHeight: 0,
        position: "relative",
        backgroundColor: "var(--color-canvas-default)",
      }}
    >
      {nestedModels.length > 1 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            width: "100%",
            gap: 0,
            padding: "0 0",
            overflowX: "auto",
            flexShrink: 0,
            borderBottom:
              colorMode === "dark" ? "1px solid rgba(255, 255, 255, 0.08)" : "1px solid rgba(0, 0, 0, 0.08)",
            backgroundColor: colorMode === "dark" ? "rgba(22, 27, 34, 0.6)" : "rgba(246, 248, 250, 0.8)",
          }}
        >
          {nestedModels.map((model, index) => (
            <button
              key={(model as any).name ?? index}
              onClick={() => {
                setSelectedModelIndex(index);
                setSelectedTreeClassName(model.name);
              }}
              style={{
                padding: "6px 16px",
                fontSize: 13,
                fontWeight: selectedModelIndex === index ? 600 : 400,
                border: "none",
                borderBottom:
                  selectedModelIndex === index
                    ? colorMode === "dark"
                      ? "2px solid #58a6ff"
                      : "2px solid #0969da"
                    : "2px solid transparent",
                cursor: "pointer",
                whiteSpace: "nowrap",
                backgroundColor: "transparent",
                color:
                  selectedModelIndex === index
                    ? colorMode === "dark"
                      ? "#e6edf3"
                      : "#1f2328"
                    : colorMode === "dark"
                      ? "#8b949e"
                      : "#656d76",
                transition: "all 0.15s ease",
                display: "inline-grid",
                justifyItems: "center",
              }}
              onMouseEnter={(e) => {
                if (selectedModelIndex !== index) {
                  (e.currentTarget as HTMLElement).style.backgroundColor =
                    colorMode === "dark" ? "rgba(255, 255, 255, 0.04)" : "rgba(0, 0, 0, 0.03)";
                }
              }}
              onMouseLeave={(e) => {
                if (selectedModelIndex !== index) {
                  (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
                }
              }}
            >
              <span style={{ gridArea: "1 / 1", visibility: "hidden", fontWeight: 600 }} aria-hidden="true">
                {(model as any).name ?? `Model ${index + 1}`}
              </span>
              <span style={{ gridArea: "1 / 1" }}>{(model as any).name ?? `Model ${index + 1}`}</span>
            </button>
          ))}
        </div>
      )}

      {/* Floating View Switcher & Actions */}
      <div
        style={{
          position: "absolute",
          top: nestedModels.length > 1 ? "48px" : "16px",
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 16px",
          borderRadius: 12,
          backgroundColor: colorMode === "dark" ? "rgba(22, 27, 34, 0.9)" : "rgba(255, 255, 255, 0.9)",
          backdropFilter: "blur(12px)",
          boxShadow:
            colorMode === "dark"
              ? "0 4px 24px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.08)"
              : "0 4px 24px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.06)",
          zIndex: 100,
        }}
      >
        <SegmentedControl
          aria-label="Center Pane View"
          onChange={(i) => {
            if (i === 0) {
              setShowResultsView(false);
              setShowCadView(false);
            } else if (i === 1) {
              setShowResultsView(true);
              setShowCadView(false);
            } else if (i === 2) {
              setShowResultsView(false);
              setShowCadView(true);
            }
          }}
        >
          <SegmentedControl.Button selected={!showResultsView && !showCadView} leadingVisual={WorkflowIcon}>
            {translations.diagram}
          </SegmentedControl.Button>
          <SegmentedControl.Button selected={showResultsView} leadingVisual={PulseIcon}>
            {translations.simulation}
          </SegmentedControl.Button>
          <SegmentedControl.Button selected={showCadView} leadingVisual={StackIcon}>
            {cadComponents.length > 0 ? `3D (${cadComponents.length})` : "3D"}
          </SegmentedControl.Button>
        </SegmentedControl>

        {cadComponents.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setShowResultsView(false);
              setShowCadView(true);
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "3px 10px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 20,
              border: "1px solid rgba(6, 182, 212, 0.4)",
              background: showCadView ? "rgba(6, 182, 212, 0.2)" : "rgba(6, 182, 212, 0.08)",
              color: "#06b6d4",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
            title="Digital Thread CAD binding active. Click to view 3D assembly"
          >
            <span style={{ fontSize: 13 }}>🧵</span>
            <span>{cadComponents.length} CAD Twins</span>
          </button>
        )}

        {showCadView && animationControllerRef.current?.hasData && (
          <Button
            variant="primary"
            size="small"
            leadingVisual={animationMode === "playing" ? PauseIcon : PlayIcon}
            onClick={() => {
              const ctrl = animationControllerRef.current;
              if (!ctrl) return;
              if (ctrl.mode === "playing") {
                ctrl.pause();
              } else {
                ctrl.play();
              }
            }}
            style={{
              marginLeft: 8,
              borderRadius: 8,
              fontWeight: 600,
              fontSize: 12,
            }}
          >
            {animationMode === "playing" ? "Pause" : "Animate"}
          </Button>
        )}
      </div>

      <div style={{ position: "relative", flex: 1, flexDirection: "row", overflow: "hidden" }}>
        {/* Diagram Editor with Properties Drawer */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "row",
            visibility: !showResultsView && !showCadView ? "visible" : "hidden",
            opacity: !showResultsView && !showCadView ? 1 : 0,
            pointerEvents: !showResultsView && !showCadView ? "auto" : "none",
            zIndex: !showResultsView && !showCadView ? 1 : 0,
          }}
        >
          <div className="flex-1 overflow-hidden" style={{ minWidth: 0 }}>
            <Suspense fallback={null}>
              <DiagramEditor
                ref={diagramEditorRef}
                diagramData={diagramData}
                diagramClassName={selectedTreeClassName}
                selectedName={selectedComponent}
                theme={colorMode === "dark" ? "vs-dark" : "light"}
                isLoading={isDiagramLoading}
                onRenderComplete={(data) => {
                  if (!data?.isLoading) {
                    setIsDiagramLoading(false);
                  }
                }}
                onSelect={handleSelectComponent}
                onShowProperties={handleSelectComponent}
                onDrop={async (className, x, y) => {
                  if (!editor) return;
                  enqueueDiagramAction({ type: "addComponent", className, x, y });
                }}
                onConnect={async (source, target, points) => {
                  if (!editor) return;
                  enqueueDiagramAction({ type: "connect", source, target, points });
                }}
                onMove={async (items) => {
                  if (!editor) return;
                  enqueueDiagramAction({ type: "move", items });
                }}
                onResize={async (name, x, y, width, height, rotation, edges) => {
                  if (!editor) return;
                  enqueueDiagramAction({
                    type: "resize",
                    item: { name, x, y, width, height, rotation, edges },
                  });
                }}
                onEdgeMove={async (edges) => {
                  if (!editor) return;
                  enqueueDiagramAction({ type: "moveEdge", edges });
                }}
                onEdgeDelete={async (source, target) => {
                  enqueueDiagramAction({ type: "disconnect", source, target });
                }}
                onComponentDelete={async (name) => {
                  enqueueDiagramAction({ type: "deleteComponents", names: [name] });
                }}
                onComponentsDelete={async (names) => {
                  enqueueDiagramAction({ type: "deleteComponents", names });
                }}
                onUndo={() => {
                  if (isSpatialEditPending) isSpatialEditPending.current = false;
                  editorRef.current?.focus();
                  const prev = editorRef.current?.getValue();
                  editorRef.current?.trigger("diagram", "undo", null);
                  if (prev !== editorRef.current?.getValue()) {
                    setIsDiagramLoading(true);
                  }
                }}
                onRedo={() => {
                  if (isSpatialEditPending) isSpatialEditPending.current = false;
                  editorRef.current?.focus();
                  const prev = editorRef.current?.getValue();
                  editorRef.current?.trigger("diagram", "redo", null);
                  if (prev !== editorRef.current?.getValue()) {
                    setIsDiagramLoading(true);
                  }
                }}
              />
            </Suspense>
          </div>

          {selectedComponent && (
            <>
              <div
                style={{
                  width: 6,
                  cursor: "col-resize",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  backgroundColor: "transparent",
                  display: "flex",
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  isDraggingProperties.current = true;
                  const startX = e.clientX;
                  const startWidth = propertiesWidth;
                  const onMouseMove = (ev: MouseEvent) => {
                    if (!isDraggingProperties.current) return;
                    const deltaX = startX - ev.clientX;
                    const newWidth = Math.max(200, Math.min(800, startWidth + deltaX));
                    setPropertiesWidth(newWidth);
                  };
                  const onMouseUp = () => {
                    isDraggingProperties.current = false;
                    document.removeEventListener("mousemove", onMouseMove);
                    document.removeEventListener("mouseup", onMouseUp);
                    document.body.style.cursor = "auto";
                    document.body.style.userSelect = "auto";
                  };
                  document.addEventListener("mousemove", onMouseMove);
                  document.addEventListener("mouseup", onMouseUp);
                  document.body.style.cursor = "col-resize";
                  document.body.style.userSelect = "none";
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.backgroundColor =
                    colorMode === "dark" ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.backgroundColor = "transparent";
                }}
              />
              <PropertiesWidget
                key={selectedComponent || "none"}
                properties={selectedComponentProperties}
                isLoading={isPropertiesLoading}
                width={propertiesWidth}
                translations={translations}
                onNameChange={async (newName) => {
                  if (!selectedComponent || !editor) return;
                  if (expectedComponentNameRef) expectedComponentNameRef.current = newName;
                  enqueueDiagramAction({ type: "updateName", oldName: selectedComponent, newName });
                }}
                onDescriptionChange={async (newDescription) => {
                  if (!selectedComponent || !editor) return;
                  enqueueDiagramAction({
                    type: "updateDescription",
                    name: selectedComponent,
                    description: newDescription,
                  });
                }}
                onParameterChange={async (name, value) => {
                  if (!selectedComponent || !editor) return;
                  let effectiveValue = value;
                  const declaredType = (selectedComponent as any)?.declaredType;
                  if (declaredType) {
                    for (const el of declaredType.elements) {
                      if (el && (el as any).name === name) {
                        const defaultExpr = (el.modification?.expression as any)?.toJSON?.toString();
                        if (defaultExpr !== undefined && defaultExpr === value) {
                          effectiveValue = "";
                        }
                        break;
                      }
                    }
                  }
                  enqueueDiagramAction({
                    type: "updateParameter",
                    name: selectedComponent,
                    parameter: name,
                    value: effectiveValue,
                  });
                }}
              />
            </>
          )}
        </div>

        {/* 3D CAD Viewer pane */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: showCadView ? "flex" : "none",
            flexDirection: "column",
            overflow: "hidden",
            minHeight: 0,
            zIndex: showCadView ? 2 : 0,
            backgroundColor: "var(--color-canvas-default)",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 12,
              left: 12,
              zIndex: 10,
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 12px",
              borderRadius: 20,
              background: colorMode === "dark" ? "rgba(22, 27, 34, 0.85)" : "rgba(255, 255, 255, 0.9)",
              backdropFilter: "blur(12px)",
              border: "1px solid rgba(6, 182, 212, 0.4)",
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.2)",
              fontSize: 12,
              color: "var(--color-fg-default)",
              pointerEvents: "none",
            }}
          >
            <span style={{ fontSize: 14 }}>🧵</span>
            <span style={{ fontWeight: 600 }}>Digital Thread CAD Twin</span>
            <span style={{ color: "#3fb950", fontSize: 11, fontWeight: 600 }}>✔ Unit Parity Active</span>
          </div>

          <Suspense fallback={null}>
            <CadViewerPanel
              components={cadComponents}
              selectedName={selectedComponent}
              onSelect={(name) => {
                setSelectedComponent(name || null);
              }}
              dark={colorMode === "dark"}
              animationController={animationControllerRef.current}
              availableVariables={simulationVariables}
              onSaveBindings={handleSaveCadBindings}
            />
          </Suspense>
        </div>

        {/* Simulation Results and Cosimulation Pane */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: showResultsView ? "flex" : "none",
            flexDirection: "column",
            overflow: "hidden",
            minHeight: 0,
            zIndex: showResultsView ? 2 : 0,
            backgroundColor: "var(--color-canvas-default)",
          }}
        >
          <CosimPanel
            dataSource={cosimDataSource}
            onDataSourceChange={setCosimDataSource}
            colorMode={colorMode}
            onReplaySession={handleReplaySession}
          />
          {localSimulationData || simulationStatus?.status === "failed" ? (
            <Suspense fallback={null}>
              <SimulationResults
                localData={localSimulationData}
                sweepResults={sweepResults}
                simulationVariables={simulationVariables}
                selectedVariables={selectedSimulationVariables}
                onVariablesLoaded={handleVariablesLoaded}
                error={simulationStatus?.status === "failed" ? simulationStatus.error : null}
                colorMode={colorMode === "dark" ? "dark" : "light"}
              />
            </Suspense>
          ) : (
            <div
              style={{
                padding: "32px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                color: "var(--color-fg-muted)",
              }}
            >
              {simulationStatus?.status === "pending" || simulationStatus?.status === "processing" ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
                  <Spinner size="large" />
                  <div>Simulation in progress... please wait.</div>
                </div>
              ) : (
                "No simulation results available. Click 'Simulate' to generate results."
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
