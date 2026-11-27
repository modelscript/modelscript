// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DynamicBindingConfig, GdtOverlayPayload } from "@modelscript/cad";
import type {
  CadComponent,
  CommitAssemblyJointPayload,
  CommitDimensionPayload,
  CommitFaceTagPayload,
  GizmoCommitPayload,
} from "@modelscript/cad-viewer";
import type { AnimationController } from "@modelscript/cad-viewer/animation-controller";
import type { ComponentPropertyData } from "@modelscript/diagram";
import type { RotundaActiveView, RotundaModelEntry } from "@modelscript/rotunda/types";
import type { editor } from "monaco-editor";
import React, { Suspense } from "react";
import Spinner from "../../../internal/Spinner";
import type { DiagramDataProp } from "../../Diagram";
import type { AnsatzRelationalHypergraphRecord } from "../../util/lsp-bridge";
import type {
  LinearConstraintSpec,
  ZonotopePendingOverride,
  ZonotopeWorkbenchState,
} from "../../util/zonotope-workbench-state";
import { AnsatzView } from "../types";

const CadViewerPanel = React.lazy(() => import("@modelscript/cad-viewer").then((m) => ({ default: m.CadViewer })));
const EngineeringRotundaPanel = React.lazy(() => import("@modelscript/rotunda/EngineeringRotunda"));

const isSplitView = (v: AnsatzView) => v === AnsatzView.SPLIT_COLUMNS || v === AnsatzView.SPLIT_ROWS;

export interface Cad3DVisualizerSectionProps {
  dialect: string;
  diagramType?: string | undefined;
  setDiagramType?: ((type: string) => void) | undefined;
  view: AnsatzView;
  showCadView: boolean;
  setShowCadView: (v: boolean) => void;
  showResultsView: boolean;
  setShowResultsView: (v: boolean) => void;
  showAnalysisView: boolean;
  setShowAnalysisView: (v: boolean) => void;
  showVrRotunda: boolean;
  setShowVrRotunda: (v: boolean) => void;
  openVrRotunda: () => void;
  cadComponents: CadComponent[];
  companionCadComponents: CadComponent[];
  setCompanionCadComponents: React.Dispatch<React.SetStateAction<CadComponent[]>>;
  hasActiveCaeFile: boolean;
  createdCaeStudySource: string | null;
  setCreatedCaeStudySource: React.Dispatch<React.SetStateAction<string | null>>;
  selectedComponent: string | null;
  setSelectedComponent: (comp: string | null) => void;
  handleSelectComponent: (name: string | null, cachedProps?: unknown, isLoading?: boolean) => void;
  selectedComponentProperties: ComponentPropertyData | null;
  colorMode: "dark" | "light";
  animationControllerRef: React.RefObject<AnimationController | null>;
  simulationVariables: string[];
  selectedSimulationVariables: string[];
  onToggleSimulationVariable?: ((variable: string) => void) | undefined;
  localSimulationData: Record<string, number | string>[] | null;
  simulationStatus: {
    status: "pending" | "processing" | "completed" | "failed" | "running" | "error" | "idle";
    error?: string | null | undefined;
    progress?: number | undefined;
    message?: string | undefined;
    jobId?: string | undefined;
  } | null;
  handleSaveCadBindings: (componentName: string, bindings: DynamicBindingConfig[]) => void;
  handleCommitCadGizmoDelta?: ((payload: GizmoCommitPayload) => void) | undefined;
  handleCommitCadDimensionDelta?: ((payload: CommitDimensionPayload) => void) | undefined;
  handleCommitCadFaceTag?: ((payload: CommitFaceTagPayload) => void) | undefined;
  handleCommitCadAssemblyJoint?: ((payload: CommitAssemblyJointPayload) => void) | undefined;
  editorValue: string;
  editor: editor.ICodeEditor | null;
  editorRef: React.RefObject<editor.ICodeEditor | null>;
  activeFileName?: string | undefined;
  projectFiles?: Record<string, string> | undefined;
  onSelectProjectFile?: ((fileName: string) => void) | undefined;
  onUpdateProjectFile?: ((fileName: string, content: string) => void) | undefined;
  vtkBuffer?: Uint8Array | null | undefined;
  gdtOverlay?: GdtOverlayPayload | null | undefined;
  onOpenCloudModal?: (() => void) | undefined;
  onRevealLine?: ((line: number, identifier?: string) => void) | undefined;
  hideCenterFloatingToolbar?: boolean | undefined;
  isAnsatzEditorRoute: boolean;
  isFloatingLayout: boolean;
  cadFitInsets: React.ComponentProps<typeof CadViewerPanel>["fitInsets"];
  cadPartOverrides?:
    Record<string, { visible?: boolean; ghost?: boolean; color?: string; material?: string }> | undefined;
  onCadPartOverridesChange?:
    | React.Dispatch<
        React.SetStateAction<Record<string, { visible?: boolean; ghost?: boolean; color?: string; material?: string }>>
      >
    | undefined;
  cameraSyncGroup?: string | undefined;
  showHypergraphOverlay?: boolean | undefined;
  zonotopeWorkbenchState?: ZonotopeWorkbenchState | undefined;
  hypergraphRecord?: AnsatzRelationalHypergraphRecord | null | undefined;
  onSelectZonotopeGroup?: ((groupId: number | null) => void) | undefined;
  onAddZonotopeOverride?: ((override: ZonotopePendingOverride) => void) | undefined;
  onAddZonotopeConstraint?: ((constraint: LinearConstraintSpec) => void) | undefined;
  zonotopeViolatingComponents?: string[] | undefined;
  onChangeCadToleranceFraction?: ((fraction: number) => void) | undefined;
  activeLangInfo: {
    supportsDiagram?: boolean | undefined;
    supports3d?: boolean | undefined;
    supportsSimulation?: boolean | undefined;
  };
  isSplitActive?: boolean | undefined;
  onSelectView?: ((target: "diagram" | "3d" | "simulation" | "inspector" | "studio" | "code") => void) | undefined;
  onToggleSplit?: (() => void) | undefined;
  vrQuickEditOpen?: boolean | undefined;
  onToggleVrQuickEdit?: (() => void) | undefined;
  rotundaDocument: React.ComponentProps<typeof EngineeringRotundaPanel>["document"];
  rotundaModels: RotundaModelEntry[];
  rotundaTitle: string;
  rotundaParameters?: Array<{ name: string; value: string | number; unit?: string }> | undefined;
  handleModifyRotundaParameter: (name: string, value: string) => void;
  rotundaLibraryCatalog: React.ComponentProps<typeof EngineeringRotundaPanel>["libraryCatalog"];
  rotundaLibraryProvider?: React.ComponentProps<typeof EngineeringRotundaPanel>["libraryProvider"];
  diagnostics?:
    | readonly {
        readonly severity: "error" | "warning" | "info";
        readonly line: number;
        readonly message: string;
      }[]
    | undefined;
  enqueueDiagramAction: (action: Record<string, unknown>) => void;
  handleUndo: () => void;
  handleRedo: () => void;
  onNodeDoubleClick?: ((nodeId: string, nodeData?: unknown) => void) | undefined;
  diagramData: DiagramDataProp;
  onAutoLayout?: (() => void) | undefined;
  onSimulate?: (() => void) | undefined;
}

export const Cad3DVisualizerSection: React.FC<Cad3DVisualizerSectionProps> = ({
  dialect,
  diagramType,
  setDiagramType,
  view,
  showCadView,
  setShowCadView,
  showResultsView,
  setShowResultsView,
  showAnalysisView,
  setShowAnalysisView,
  showVrRotunda,
  setShowVrRotunda,
  openVrRotunda,
  cadComponents,
  companionCadComponents,
  setCompanionCadComponents,
  hasActiveCaeFile,
  createdCaeStudySource,
  setCreatedCaeStudySource,
  selectedComponent,
  setSelectedComponent,
  handleSelectComponent,
  selectedComponentProperties,
  colorMode,
  animationControllerRef,
  simulationVariables,
  selectedSimulationVariables,
  onToggleSimulationVariable,
  localSimulationData,
  simulationStatus,
  handleSaveCadBindings,
  handleCommitCadGizmoDelta,
  handleCommitCadDimensionDelta,
  handleCommitCadFaceTag,
  handleCommitCadAssemblyJoint,
  editorValue,
  editor,
  editorRef,
  activeFileName,
  projectFiles,
  onSelectProjectFile,
  onUpdateProjectFile,
  vtkBuffer,
  gdtOverlay,
  onOpenCloudModal,
  onRevealLine,
  hideCenterFloatingToolbar,
  isAnsatzEditorRoute,
  isFloatingLayout,
  cadFitInsets,
  cadPartOverrides,
  onCadPartOverridesChange,
  cameraSyncGroup,
  showHypergraphOverlay,
  zonotopeWorkbenchState,
  hypergraphRecord,
  onSelectZonotopeGroup,
  onAddZonotopeOverride,
  onAddZonotopeConstraint,
  zonotopeViolatingComponents,
  onChangeCadToleranceFraction,
  activeLangInfo,
  isSplitActive,
  onSelectView,
  onToggleSplit,
  vrQuickEditOpen,
  onToggleVrQuickEdit,
  rotundaDocument,
  rotundaModels,
  rotundaTitle,
  rotundaParameters,
  handleModifyRotundaParameter,
  rotundaLibraryCatalog,
  rotundaLibraryProvider,
  diagnostics,
  enqueueDiagramAction,
  handleUndo,
  handleRedo,
  onNodeDoubleClick,
  diagramData,
  onAutoLayout,
  onSimulate,
}) => {
  return (
    <>
      {/* 3D CAD Viewer pane */}
      {showCadView && !showAnalysisView && !showVrRotunda && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            minHeight: 0,
            zIndex: 2,
            backgroundColor: "var(--color-canvas-default)",
          }}
        >
          <Suspense fallback={null}>
            <CadViewerPanel
              components={
                cadComponents.length > 0 ? cadComponents : hasActiveCaeFile ? companionCadComponents : cadComponents
              }
              selectedName={selectedComponent}
              onSelect={(name) => {
                setSelectedComponent(name || null);
              }}
              dark={colorMode === "dark"}
              animationController={animationControllerRef.current}
              availableVariables={simulationVariables}
              onSaveBindings={handleSaveCadBindings}
              onCommitGizmoDelta={handleCommitCadGizmoDelta}
              onCommitDimensionDelta={handleCommitCadDimensionDelta}
              onCommitFaceTag={handleCommitCadFaceTag}
              onCommitAssemblyJoint={handleCommitCadAssemblyJoint}
              sourceCode={editorValue}
              activeFileName={activeFileName}
              vtkBuffer={vtkBuffer ?? undefined}
              gdtOverlay={gdtOverlay}
              caeSourceCode={
                /\.(inp|bdf|dat|fem|su2|cfg|foam)$/i.test(activeFileName || "") || vtkBuffer
                  ? editorValue
                  : (createdCaeStudySource ?? undefined)
              }
              onCreateCaeStudy={(study) => {
                if (cadComponents.length > 0) {
                  setCompanionCadComponents(cadComponents);
                }
                setCreatedCaeStudySource(study.content);
                if (onUpdateProjectFile) {
                  onUpdateProjectFile(study.fileName, study.content);
                  onSelectProjectFile?.(study.fileName);
                } else {
                  const targetEditor = editorRef.current ?? editor;
                  if (targetEditor) {
                    targetEditor.setValue(study.content);
                  }
                }
              }}
              onTriggerHpcRun={onOpenCloudModal}
              onRevealLine={onRevealLine}
              onInsertCaeSnippet={(snippet) => {
                const targetEditor = editorRef.current ?? editor;
                if (targetEditor) {
                  const nextCode = `${targetEditor.getValue().trimEnd()}\n${snippet.trimStart()}`;
                  targetEditor.setValue(nextCode);
                }
              }}
              onOpenVrRotunda={hideCenterFloatingToolbar || isAnsatzEditorRoute ? undefined : openVrRotunda}
              fitInsets={cadFitInsets}
              partOverrides={cadPartOverrides}
              onPartOverridesChange={onCadPartOverridesChange}
              cameraSyncGroup={cameraSyncGroup}
              showZonotopeOverlay={showHypergraphOverlay}
              zonotopeWorkbenchState={zonotopeWorkbenchState}
              hypergraphRecord={hypergraphRecord}
              onSelectZonotopeGroup={onSelectZonotopeGroup}
              onAddZonotopeOverride={onAddZonotopeOverride}
              onAddZonotopeConstraint={onAddZonotopeConstraint}
              zonotopeViolatingComponents={zonotopeViolatingComponents}
              onChangeCadToleranceFraction={onChangeCadToleranceFraction}
            />
          </Suspense>
        </div>
      )}

      {/* Engineering VR Rotunda Workstation Pane */}
      {showVrRotunda &&
        (() => {
          const isHostedWorkbench = Boolean(hideCenterFloatingToolbar || isAnsatzEditorRoute);
          const activeVrView: RotundaActiveView =
            view === AnsatzView.CODE
              ? "code"
              : showResultsView
                ? "simulation"
                : showCadView
                  ? "3d"
                  : showAnalysisView
                    ? "inspector"
                    : "diagram";
          const vrAvailableViews: RotundaActiveView[] = [
            ...(activeLangInfo.supportsDiagram !== false ? (["diagram"] as const) : []),
            ...(activeLangInfo.supports3d ? (["3d"] as const) : []),
            ...(activeLangInfo.supportsSimulation !== false ? (["simulation"] as const) : []),
            "inspector",
            "code",
          ];
          const isVrSplitOpen = Boolean((isSplitActive ?? isSplitView(view)) && activeVrView !== "code");
          return (
            <div
              data-testid="ansatz-vr-rotunda-pane"
              style={
                isAnsatzEditorRoute || isFloatingLayout
                  ? {
                      position: "fixed",
                      inset: 0,
                      display: "flex",
                      flexDirection: "column",
                      overflow: "hidden",
                      minHeight: 0,
                      zIndex: 38,
                      backgroundColor: "#050914",
                    }
                  : {
                      position: "absolute",
                      inset: 0,
                      paddingTop: hideCenterFloatingToolbar ? 0 : 56,
                      boxSizing: "border-box",
                      display: "flex",
                      flexDirection: "column",
                      overflow: "hidden",
                      minHeight: 0,
                      zIndex: 35,
                      backgroundColor: "#050914",
                    }
              }
            >
              <Suspense
                fallback={
                  <div
                    style={{
                      flex: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: "#050914",
                    }}
                  >
                    <Spinner />
                  </div>
                }
              >
                <EngineeringRotundaPanel
                  document={rotundaDocument}
                  models={rotundaModels}
                  mode="spatial-3d"
                  title={rotundaTitle}
                  languageId={dialect || "modelica"}
                  diagramType={diagramType}
                  sourceCode={editorValue}
                  initialActiveView={activeVrView}
                  activeView={activeVrView}
                  onActiveViewChange={(nextView) => {
                    if (onSelectView) {
                      onSelectView(nextView);
                    } else if (nextView === "diagram") {
                      setShowResultsView(false);
                      setShowCadView(false);
                      setShowAnalysisView(false);
                    } else if (nextView === "3d") {
                      setShowResultsView(false);
                      setShowCadView(true);
                      setShowAnalysisView(false);
                    } else if (nextView === "simulation") {
                      setShowResultsView(true);
                      setShowCadView(false);
                      setShowAnalysisView(false);
                    } else if (nextView === "inspector") {
                      setShowResultsView(false);
                      setShowCadView(false);
                      setShowAnalysisView(true);
                    }
                  }}
                  initialCodeOverlayOpen={isVrSplitOpen || activeVrView === "code"}
                  splitCodeOpen={isVrSplitOpen}
                  onSplitCodeChange={(open) => {
                    if (open !== isVrSplitOpen) {
                      onToggleSplit?.();
                    }
                  }}
                  hostedInWorkbench={isHostedWorkbench}
                  vrQuickEditOpen={vrQuickEditOpen}
                  onToggleVrQuickEdit={onToggleVrQuickEdit}
                  availableViews={vrAvailableViews}
                  initialPodiumVisible={!isHostedWorkbench}
                  workspaceFiles={Object.keys(projectFiles ?? {})
                    .filter((p) => !p.endsWith(".layout"))
                    .map((p) => {
                      const lower = p.toLowerCase();
                      const lang = lower.endsWith(".sysml")
                        ? "sysml2"
                        : lower.endsWith(".cir") || lower.endsWith(".sp") || lower.endsWith(".spice")
                          ? "spice"
                          : lower.endsWith(".scad")
                            ? "scad"
                            : lower.endsWith(".urdf")
                              ? "urdf"
                              : lower.endsWith(".pscx")
                                ? "pscad"
                                : lower.endsWith(".raw")
                                  ? "psse"
                                  : lower.endsWith(".mod")
                                    ? "ampl"
                                    : lower.endsWith(".mo")
                                      ? "modelica"
                                      : dialect || "modelica";
                      const name = p.split("/").pop() ?? p;
                      return { path: p, name, languageId: lang };
                    })}
                  activeFilePath={activeFileName}
                  onSelectWorkspaceFile={onSelectProjectFile}
                  inspectorData={{
                    selectedComponent,
                    parameters: rotundaParameters?.map((p) => {
                      const rawParam = selectedComponentProperties?.parameters?.find((sp) => sp?.name === p.name);
                      return {
                        name: p.name,
                        value: String(p.value),
                        unit: p.unit,
                        isBoolean: rawParam?.isBoolean,
                      };
                    }),
                    diagnostics,
                    onModifyParameter: handleModifyRotundaParameter,
                    onRenameComponent: (oldName, newName) => {
                      enqueueDiagramAction({ type: "updateName", oldName, newName });
                    },
                    onUpdateProperty: (key, value) => {
                      if (!selectedComponent) return;
                      enqueueDiagramAction({ type: "updateProperty", name: selectedComponent, key, value });
                    },
                  }}
                  libraryCatalog={rotundaLibraryCatalog}
                  libraryProvider={rotundaLibraryProvider}
                  selectedNodeId={selectedComponent}
                  onSelectNode={(nodeId) => handleSelectComponent(nodeId)}
                  onUndo={handleUndo}
                  onRedo={handleRedo}
                  onDrillDown={onNodeDoubleClick}
                  onRevealSource={(nodeId) => {
                    const ed = editorRef?.current ?? editor;
                    const model = ed?.getModel?.();
                    if (!ed || !model) return;
                    const matches = model.findMatches?.(nodeId, false, false, true, null, false);
                    const first = matches?.[0];
                    if (first?.range) {
                      ed.revealRangeInCenter(first.range);
                      ed.setSelection(first.range);
                    }
                  }}
                  availableDiagramViews={diagramData?.availableViews}
                  onSelectDiagramType={setDiagramType}
                  onAutoLayout={onAutoLayout}
                  simulationData={{
                    onRunSimulation: onSimulate,
                    status: simulationStatus,
                    variables: simulationVariables,
                    selectedVariables: selectedSimulationVariables,
                    onToggleVariable: onToggleSimulationVariable,
                    rows: localSimulationData,
                  }}
                  onDiagramEdit={(actions) => {
                    for (const action of actions) {
                      enqueueDiagramAction(action as unknown as Record<string, unknown>);
                    }
                  }}
                  animationController={animationControllerRef.current}
                  topOverlayInset={isAnsatzEditorRoute || isFloatingLayout ? 72 : 12}
                  onExitTo2D={() => setShowVrRotunda(false)}
                />
              </Suspense>
            </div>
          );
        })()}
    </>
  );
};
