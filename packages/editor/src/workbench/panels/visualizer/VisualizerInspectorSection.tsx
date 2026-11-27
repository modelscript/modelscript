// SPDX-License-Identifier: AGPL-3.0-or-later

import { AmplOptimizationResults, type AmplGeomInfo } from "@modelscript/ampl/ui/AmplOptimizationResults";
import type { AnimationController } from "@modelscript/cad-viewer/animation-controller";
import { SegmentedControl } from "@primer/react";
import type { editor } from "monaco-editor";
import React, { Suspense } from "react";
import Spinner from "../../../internal/Spinner";
import { CosimPanel, type HistorianSession } from "../../CosimPanel";
import type { SimulationResultsProps } from "../../simulation-results/types";
import type { AnsatzXRayTokenHeat } from "../../util/hypergraph-overlay";
import { executeLspAction, type AnsatzRelationalHypergraphRecord } from "../../util/lsp-bridge";
import type {
  ModalityPerturbationBudgets,
  ZonotopePendingOverride,
  ZonotopeWorkbenchState,
} from "../../util/zonotope-workbench-state";
import { AmplConstraints2D } from "../ampl-viz/AmplConstraints2D";
import { AmplFitnessLandscape } from "../ampl-viz/AmplFitnessLandscape";
import { AmplParetoFront } from "../ampl-viz/AmplParetoFront";
import { AnsatzCalibrationPanel } from "../AnsatzCalibrationPanel";
import { AnsatzDigitalThreadPanel } from "../AnsatzDigitalThreadPanel";
import type { TrainingStudioContextInfo } from "../AnsatzLifecycleStudioSections";
import type { ComputeDialPreset } from "../AnsatzTrainingStudioPanel";
import type { InspectorSubtabId } from "../inspector-capabilities";
import { InspectorErrorBoundary, InspectorLoadingSkeleton } from "../InspectorErrorBoundary";
import { PolyglotDomainPanel } from "../PolyglotDomainPanel";
import { AnsatzView } from "../types";

const AmplConstraints3D = React.lazy(() =>
  import("../ampl-viz/AmplConstraints3D").then((m) => ({ default: m.AmplConstraints3D })),
);
const SimulationResults = React.lazy(() =>
  import("../../SimulationResults").then((m) => ({ default: m.SimulationResults })),
);
const AnsatzRtmContractsPanel = React.lazy(() =>
  import("../AnsatzRtmContractsPanel").then((m) => ({ default: m.AnsatzRtmContractsPanel })),
);
const AnsatzOptimizationUqPanel = React.lazy(() =>
  import("../AnsatzOptimizationUqPanel").then((m) => ({ default: m.AnsatzOptimizationUqPanel })),
);
const AnsatzReplPanel = React.lazy(() => import("../AnsatzReplPanel").then((m) => ({ default: m.AnsatzReplPanel })));
const AnsatzTrainingStudioPanel = React.lazy(() =>
  import("../AnsatzTrainingStudioPanel").then((m) => ({ default: m.AnsatzTrainingStudioPanel })),
);

const inspectAmplGeometry = async (params: {
  documentUri: string;
  documentText: string;
  dataText?: string;
  projectFiles?: Record<string, string>;
}): Promise<AmplGeomInfo | null> => {
  const geo = await executeLspAction("ampl_inspect_geometry", "ampl", params.documentUri, {
    documentText: params.documentText,
    ...(params.dataText ? { dataText: params.dataText } : {}),
    ...(params.projectFiles ? { projectFiles: params.projectFiles } : {}),
  });
  return (geo as unknown as AmplGeomInfo | null | undefined) ?? null;
};

export interface VisualizerInspectorSectionProps {
  dialect: string;
  view: AnsatzView;
  splitRatio: number;
  isFloatingLayout: boolean;
  isFullScreenSplitCanvas: boolean;
  floatingLeftOffset: number;
  diagnosticsBottomOffset: number;
  hideCenterFloatingToolbar?: boolean | undefined;
  showResultsView: boolean;
  setShowResultsView: (v: boolean) => void;
  showCadView: boolean;
  setShowCadView: (v: boolean) => void;
  showAnalysisView: boolean;
  setShowAnalysisView: (v: boolean) => void;
  showVrRotunda: boolean;
  setShowVrRotunda: (v: boolean) => void;
  showCosimSection: boolean;
  cosimDataSource: "local" | "mqtt-live" | "historian-replay";
  setCosimDataSource: (ds: "local" | "mqtt-live" | "historian-replay") => void;
  handleReplaySession: (session: HistorianSession, speed: number) => void;
  animationControllerRef: React.RefObject<AnimationController | null>;
  simulationVariables: string[];
  selectedSimulationVariables: string[];
  handleVariablesLoaded: (vars: string[]) => void;
  onToggleSimulationVariable?: ((variable: string) => void) | undefined;
  recordedSessions: HistorianSession[];
  selectedTreeClassName: string | null;
  nestedModels: Array<{ name: string; kind?: string }>;
  selectedModelIndex: number;
  colorMode: "dark" | "light";
  amplSolveResult?: React.ComponentProps<typeof AmplOptimizationResults>["result"];
  simulationStatus: {
    status: "pending" | "processing" | "completed" | "failed" | "running" | "error" | "idle";
    error?: string | null | undefined;
    progress?: number | undefined;
    message?: string | undefined;
    jobId?: string | undefined;
  } | null;
  documentUri?: string | undefined;
  editorValue: string;
  editor: editor.ICodeEditor | null;
  editorRef: React.RefObject<editor.ICodeEditor | null>;
  projectFiles?: Record<string, string> | undefined;
  activeFileName?: string | undefined;
  onSelectProjectFile?: ((fileName: string) => void) | undefined;
  onUpdateProjectFile?: ((fileName: string, content: string) => void) | undefined;
  onSimulate?: (() => void) | undefined;
  localSimulationData: Record<string, number | string>[] | null;
  pscadComplianceReport?: unknown;
  pscadExports?: Record<string, unknown> | null | undefined;
  sweepResults: { value: number; y: number[][] }[] | null;
  availableInspectorSubtabs: Array<{ id: InspectorSubtabId; label: string }>;
  inspectorSubtab: InspectorSubtabId;
  setInspectorSubtab: (tab: InspectorSubtabId) => void;
  hasMultiFileProject: boolean;
  onRevealLine?: ((line: number, identifier?: string) => void) | undefined;
  showHypergraphOverlay?: boolean | undefined;
  onToggleHypergraphOverlay?: ((enabled: boolean) => void) | undefined;
  computeDial?: ComputeDialPreset | undefined;
  onChangeComputeDial?: ((dial: ComputeDialPreset) => void) | undefined;
  onXRayTokenHeatChange?: ((heat: AnsatzXRayTokenHeat[] | null) => void) | undefined;
  onLoadExampleSource?: ((source: string, dialect: string, uri?: string) => void) | undefined;
  zonotopeWorkbenchState?: ZonotopeWorkbenchState | undefined;
  hypergraphRecord?: AnsatzRelationalHypergraphRecord | null | undefined;
  onUpdateZonotopeBudgets?: ((patch: Partial<ModalityPerturbationBudgets>) => void) | undefined;
  onAddZonotopeOverride?: ((override: ZonotopePendingOverride) => void) | undefined;
  onSelectZonotopeGroup?: ((groupId: number | null) => void) | undefined;
  onClearPendingOverrides?: (() => void) | undefined;
  onWorstCaseXiChange?: ((xiMap: Record<number, number>) => void) | undefined;
  trainingStudioContext?: TrainingStudioContextInfo | undefined;
}

export const VisualizerInspectorSection: React.FC<VisualizerInspectorSectionProps> = ({
  dialect,
  view,
  splitRatio,
  isFloatingLayout,
  isFullScreenSplitCanvas,
  floatingLeftOffset,
  diagnosticsBottomOffset,
  hideCenterFloatingToolbar,
  showResultsView,
  setShowResultsView,
  setShowCadView,
  showAnalysisView,
  setShowAnalysisView,
  showVrRotunda,
  setShowVrRotunda,
  showCosimSection,
  cosimDataSource,
  setCosimDataSource,
  handleReplaySession,
  animationControllerRef,
  simulationVariables,
  selectedSimulationVariables,
  handleVariablesLoaded,
  onToggleSimulationVariable,
  recordedSessions,
  selectedTreeClassName,
  nestedModels,
  selectedModelIndex,
  colorMode,
  amplSolveResult,
  simulationStatus,
  documentUri,
  editorValue,
  editor,
  editorRef,
  projectFiles,
  activeFileName,
  onSelectProjectFile,
  onUpdateProjectFile,
  onSimulate,
  localSimulationData,
  pscadComplianceReport,
  pscadExports,
  sweepResults,
  availableInspectorSubtabs,
  inspectorSubtab,
  setInspectorSubtab,
  hasMultiFileProject,
  onRevealLine,
  showHypergraphOverlay,
  onToggleHypergraphOverlay,
  computeDial,
  onChangeComputeDial,
  onXRayTokenHeatChange,
  onLoadExampleSource,
  zonotopeWorkbenchState,
  hypergraphRecord,
  onUpdateZonotopeBudgets,
  onAddZonotopeOverride,
  onSelectZonotopeGroup,
  onClearPendingOverrides,
  onWorstCaseXiChange,
  trainingStudioContext,
}) => {
  return (
    <>
      {/* Simulation Results and Cosimulation Pane */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          paddingTop: isFloatingLayout ? 70 : hideCenterFloatingToolbar ? 0 : 56,
          paddingLeft: isFloatingLayout ? floatingLeftOffset : 0,
          paddingRight:
            isFullScreenSplitCanvas && view === AnsatzView.SPLIT_COLUMNS
              ? `calc(${(1 - splitRatio) * 100}% + 12px)`
              : isFloatingLayout
                ? 12
                : 0,
          paddingBottom:
            isFullScreenSplitCanvas && view === AnsatzView.SPLIT_ROWS
              ? `calc(${(1 - splitRatio) * 100}% + 12px)`
              : isFloatingLayout
                ? Math.max(12, diagnosticsBottomOffset)
                : 0,
          boxSizing: "border-box",
          display: showResultsView && !showAnalysisView && !showVrRotunda ? "flex" : "none",
          flexDirection: "column",
          overflow: "hidden",
          minHeight: 0,
          zIndex: showResultsView && !showAnalysisView && !showVrRotunda ? 2 : 0,
          backgroundColor: "var(--color-canvas-default)",
        }}
      >
        {!hideCenterFloatingToolbar && showCosimSection && (
          <CosimPanel
            dataSource={cosimDataSource}
            onDataSourceChange={setCosimDataSource}
            colorMode={colorMode}
            onReplaySession={handleReplaySession}
            onPauseReplay={() => animationControllerRef.current?.pause()}
            onVariableSelected={(participantId, variable) => {
              const candidate = simulationVariables.includes(variable)
                ? variable
                : simulationVariables.includes(`${participantId}.${variable}`)
                  ? `${participantId}.${variable}`
                  : variable;
              if (!simulationVariables.includes(candidate)) {
                handleVariablesLoaded([...simulationVariables, candidate]);
              }
              onToggleSimulationVariable?.(candidate);
              if (typeof window !== "undefined") {
                window.dispatchEvent(
                  new CustomEvent("ansatz:toggle-simulation-variable", {
                    detail: { participantId, variable: candidate },
                  }),
                );
              }
              setShowVrRotunda(false);
              setShowResultsView(true);
              setShowCadView(false);
              setShowAnalysisView(false);
            }}
            sessions={recordedSessions}
            sessionId={selectedTreeClassName ? `live-${dialect}-${selectedTreeClassName}` : `live-${dialect}-default`}
          />
        )}
        {dialect.toLowerCase() === "ampl" ? (
          <AmplOptimizationResults
            result={amplSolveResult ?? null}
            status={simulationStatus}
            documentUri={documentUri}
            documentText={editorValue}
            projectFiles={projectFiles}
            activeFileName={activeFileName}
            onSolve={() => onSimulate?.()}
            onBackToInspector={() => setShowResultsView(false)}
            inspectGeometry={inspectAmplGeometry}
            Constraints2DComponent={AmplConstraints2D}
            Constraints3DComponent={AmplConstraints3D}
            FitnessLandscapeComponent={AmplFitnessLandscape}
            ParetoFrontComponent={AmplParetoFront}
          />
        ) : localSimulationData || simulationStatus?.status === "failed" ? (
          <Suspense fallback={null}>
            <SimulationResults
              localData={localSimulationData}
              complianceReport={pscadComplianceReport}
              pscadExports={(pscadExports ?? undefined) as unknown as SimulationResultsProps["pscadExports"]}
              sweepResults={sweepResults}
              simulationVariables={simulationVariables}
              selectedVariables={selectedSimulationVariables}
              onVariablesLoaded={handleVariablesLoaded}
              error={simulationStatus?.status === "failed" ? simulationStatus.error : null}
              colorMode={colorMode === "dark" ? "dark" : "light"}
              onRetry={onSimulate}
            />
          </Suspense>
        ) : (
          <div
            style={{
              padding: "32px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "var(--color-fg-muted)",
              gap: "12px",
            }}
          >
            {simulationStatus?.status === "pending" || simulationStatus?.status === "processing" ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
                <Spinner size="large" />
                <div>Simulation in progress... please wait.</div>
              </div>
            ) : (
              <>
                <div>Ready to simulate transient response.</div>
                {onSimulate && (
                  <button
                    type="button"
                    onClick={onSimulate}
                    style={{
                      background: "var(--ms-brand, #0e7490)",
                      color: "#ffffff",
                      border: "1px solid var(--ms-brand, #0e7490)",
                      borderRadius: "6px",
                      padding: "6px 14px",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    ▶ Run Simulation
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Secondary Domain Analytical Inspector Pane */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          paddingTop: isFloatingLayout ? 70 : hideCenterFloatingToolbar ? 0 : nestedModels.length > 1 ? 96 : 64,
          paddingLeft: isFloatingLayout ? floatingLeftOffset : 0,
          paddingRight:
            isFullScreenSplitCanvas && view === AnsatzView.SPLIT_COLUMNS
              ? `calc(${(1 - splitRatio) * 100}% + 12px)`
              : isFloatingLayout
                ? 12
                : 0,
          paddingBottom:
            isFullScreenSplitCanvas && view === AnsatzView.SPLIT_ROWS
              ? `calc(${(1 - splitRatio) * 100}% + 12px)`
              : isFloatingLayout
                ? Math.max(12, diagnosticsBottomOffset)
                : 0,
          boxSizing: "border-box",
          display: showAnalysisView && !showVrRotunda ? "flex" : "none",
          flexDirection: "column",
          overflow: "hidden",
          minHeight: 0,
          zIndex: showAnalysisView && !showVrRotunda ? 2 : 0,
          backgroundColor: "var(--color-canvas-default)",
        }}
      >
        {availableInspectorSubtabs.length > 1 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              borderBottom: "1px solid var(--ms-divider, rgba(15,23,42,0.08))",
              background: "var(--ms-bg-alt, var(--color-canvas-subtle, transparent))",
              overflowX: "auto",
              scrollbarWidth: "none",
              flexShrink: 0,
            }}
          >
            <SegmentedControl
              aria-label="Inspector Mode"
              size="small"
              onChange={(idx) => {
                const chosen = availableInspectorSubtabs[idx];
                if (chosen) setInspectorSubtab(chosen.id);
              }}
            >
              {availableInspectorSubtabs.map((tab) => (
                <SegmentedControl.Button key={tab.id} selected={inspectorSubtab === tab.id}>
                  {tab.label}
                </SegmentedControl.Button>
              ))}
            </SegmentedControl>
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {showAnalysisView && !showVrRotunda ? (
            <InspectorErrorBoundary
              panelName={availableInspectorSubtabs.find((t) => t.id === inspectorSubtab)?.label ?? "Inspector"}
              resetKey={`${dialect}:${documentUri ?? ""}:${inspectorSubtab}`}
            >
              {hasMultiFileProject && inspectorSubtab === "thread" ? (
                <AnsatzDigitalThreadPanel
                  projectFiles={projectFiles}
                  activeFileName={activeFileName}
                  documentUri={documentUri}
                  colorMode={colorMode}
                  onSelectProjectFile={onSelectProjectFile}
                  onUpdateProjectFile={onUpdateProjectFile}
                  onRevealLine={onRevealLine}
                />
              ) : inspectorSubtab === "calibrate" ? (
                <AnsatzCalibrationPanel
                  projectFiles={projectFiles}
                  activeFileName={activeFileName}
                  activeCode={editorValue}
                  documentUri={documentUri}
                  colorMode={colorMode}
                  onUpdateProjectFile={onUpdateProjectFile}
                  onCodeChange={(nextCode) => {
                    const targetEditor = editorRef.current ?? editor;
                    const model = targetEditor?.getModel?.();
                    if (targetEditor && model && targetEditor.getValue() !== nextCode) {
                      targetEditor.pushUndoStop();
                      targetEditor.executeEdits("calibration-apply", [
                        { range: model.getFullModelRange(), text: nextCode, forceMoveMarkers: true },
                      ]);
                      targetEditor.pushUndoStop();
                    }
                  }}
                />
              ) : inspectorSubtab === "rtm" ? (
                <Suspense fallback={<InspectorLoadingSkeleton label="Loading RTM & Contracts…" />}>
                  <AnsatzRtmContractsPanel
                    documentUri={documentUri ?? "file:///document.mo"}
                    colorMode={colorMode}
                    onRevealLine={onRevealLine}
                  />
                </Suspense>
              ) : inspectorSubtab === "uq" ? (
                <Suspense fallback={<InspectorLoadingSkeleton label="Loading Optimization & UQ…" />}>
                  <AnsatzOptimizationUqPanel
                    documentUri={documentUri ?? "file:///document.mo"}
                    dialect={dialect}
                    selectedClassName={selectedTreeClassName ?? nestedModels[selectedModelIndex]?.name ?? undefined}
                    colorMode={colorMode}
                  />
                </Suspense>
              ) : inspectorSubtab === "repl" ? (
                <Suspense fallback={<InspectorLoadingSkeleton label="Loading REPL…" />}>
                  <AnsatzReplPanel
                    documentUri={documentUri ?? "file:///document.mo"}
                    dialect={dialect}
                    colorMode={colorMode}
                  />
                </Suspense>
              ) : inspectorSubtab === "studio" ? (
                <Suspense fallback={<InspectorLoadingSkeleton label="Loading RLVR & Zonotope Studio…" />}>
                  <AnsatzTrainingStudioPanel
                    documentUri={documentUri ?? "file:///document.mo"}
                    dialect={dialect}
                    sourceCode={editorValue}
                    colorMode={colorMode}
                    showHypergraphOverlay={showHypergraphOverlay}
                    onToggleHypergraphOverlay={onToggleHypergraphOverlay}
                    computeDial={computeDial}
                    onChangeComputeDial={onChangeComputeDial}
                    onXRayTokenHeatChange={onXRayTokenHeatChange}
                    onLoadExampleSource={onLoadExampleSource}
                    zonotopeState={zonotopeWorkbenchState}
                    hypergraphRecord={hypergraphRecord}
                    onUpdateZonotopeBudgets={onUpdateZonotopeBudgets}
                    onAddZonotopeOverride={onAddZonotopeOverride}
                    onSelectZonotopeGroup={onSelectZonotopeGroup}
                    onClearPendingOverrides={onClearPendingOverrides}
                    onWorstCaseXiChange={onWorstCaseXiChange}
                    trainingStudioContext={trainingStudioContext}
                  />
                </Suspense>
              ) : (
                <PolyglotDomainPanel
                  dialect={dialect}
                  code={editorValue}
                  colorMode={colorMode}
                  isVisible={showAnalysisView && !showVrRotunda && inspectorSubtab === "domain"}
                  documentUri={documentUri}
                  activeClassName={selectedTreeClassName ?? nestedModels[selectedModelIndex]?.name ?? undefined}
                  projectFiles={projectFiles}
                  activeFileName={activeFileName}
                  onUpdateProjectFile={onUpdateProjectFile}
                  onRevealLine={onRevealLine}
                  onCodeChange={(nextCode) => {
                    const targetEditor = editorRef.current ?? editor;
                    const model = targetEditor?.getModel?.();
                    if (targetEditor && model && targetEditor.getValue() !== nextCode) {
                      targetEditor.pushUndoStop();
                      targetEditor.executeEdits("pscad-authoring", [
                        { range: model.getFullModelRange(), text: nextCode, forceMoveMarkers: true },
                      ]);
                      targetEditor.pushUndoStop();
                    } else if (activeFileName && onUpdateProjectFile) {
                      onUpdateProjectFile(activeFileName, nextCode);
                    }
                  }}
                />
              )}
            </InspectorErrorBoundary>
          ) : null}
        </div>
      </div>
    </>
  );
};
