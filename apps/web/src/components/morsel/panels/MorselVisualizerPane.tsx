// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { DynamicBindingConfig } from "@modelscript/cad";
import { PauseIcon, PlayIcon, PlusIcon, PulseIcon, StackIcon, TableIcon, WorkflowIcon } from "@primer/octicons-react";
import { Button, SegmentedControl, Spinner } from "@primer/react";
import type { editor } from "monaco-editor";
import React, { Suspense, useMemo, useRef, useState } from "react";
import type { CadComponent } from "../cad-viewer";
import type { AnimationController } from "../cad-viewer/animation-controller";
import { getLanguageInfo } from "../constants";
import { CosimPanel, type HistorianSession } from "../CosimPanel";
import type { DiagramEditorHandle } from "../Diagram";
import PropertiesWidget from "../Properties";
import type { MobileTab } from "./MorselMobileTabBar";
import { PolyglotDomainPanel } from "./PolyglotDomainPanel";
import { MorselView } from "./types";

const DiagramEditor = React.lazy(() => import("../Diagram"));
const CadViewerPanel = React.lazy(() => import("../cad-viewer").then((m) => ({ default: m.CadViewer })));
const SimulationResults = React.lazy(() =>
  import("../SimulationResults").then((m) => ({ default: m.SimulationResults })),
);

interface StencilItem {
  label: string;
  snippet: string;
  className?: string;
}

function getStencilsForDialect(dialect: string): StencilItem[] {
  switch (dialect) {
    case "modelica":
    case "modelscript":
      return [
        {
          label: "Resistor",
          className: "Modelica.Electrical.Analog.Basic.Resistor",
          snippet: "  Modelica.Electrical.Analog.Basic.Resistor R_new(R=100);\n",
        },
        {
          label: "Capacitor",
          className: "Modelica.Electrical.Analog.Basic.Capacitor",
          snippet: "  Modelica.Electrical.Analog.Basic.Capacitor C_new(C=1e-3);\n",
        },
        {
          label: "Inductor",
          className: "Modelica.Electrical.Analog.Basic.Inductor",
          snippet: "  Modelica.Electrical.Analog.Basic.Inductor L_new(L=0.1);\n",
        },
        {
          label: "Ground",
          className: "Modelica.Electrical.Analog.Basic.Ground",
          snippet: "  Modelica.Electrical.Analog.Basic.Ground G_new;\n",
        },
        {
          label: "Constant",
          className: "Modelica.Blocks.Sources.Constant",
          snippet: "  Modelica.Blocks.Sources.Constant const_new(k=1.0);\n",
        },
        {
          label: "Integrator",
          className: "Modelica.Blocks.Continuous.Integrator",
          snippet: "  Modelica.Blocks.Continuous.Integrator integ_new(k=1.0);\n",
        },
      ];
    case "sysml2":
      return [
        {
          label: "Part Def",
          snippet: "\npart def SubSystem {\n  attribute mass : Real = 10.0;\n}\n",
        },
        {
          label: "Port Def",
          snippet: "\nport def SignalPort {\n  in item cmd : Real;\n  out item status : Real;\n}\n",
        },
        {
          label: "Requirement",
          snippet:
            "\nrequirement def <'REQ-NEW'> PerformanceReq {\n  doc /* System shall satisfy target response time */\n}\n",
        },
        {
          label: "Action Def",
          snippet: "\naction def ExecuteControl {\n  in item sensorIn;\n  out item actuatorOut;\n}\n",
        },
        {
          label: "State Def",
          snippet: "\nstate def OperatingState {\n  entry; then Nominal;\n  state Nominal;\n}\n",
        },
      ];
    case "owl2":
      return [
        { label: "Class", snippet: "Declaration(Class(:NewConcept))\n" },
        { label: "ObjectProperty", snippet: "Declaration(ObjectProperty(:connectedTo))\n" },
        { label: "SubClassOf", snippet: "SubClassOf(:NewConcept :SystemComponent)\n" },
        {
          label: "Individual",
          snippet: "Declaration(NamedIndividual(:instance_1))\nClassAssertion(:NewConcept :instance_1)\n",
        },
      ];
    case "spice":
    case "verilog-a":
      return [
        { label: "Resistor", snippet: "R_new n1 n2 1k\n" },
        { label: "Capacitor", snippet: "C_new n2 0 10n\n" },
        { label: "Inductor", snippet: "L_new n1 n2 1m\n" },
        { label: "Voltage Source", snippet: "V_new in 0 DC 5.0\n" },
      ];
    case "pscad":
    case "psse":
    case "opendss":
      return [
        { label: "Bus", snippet: "New Circuit.Bus_New basekv=13.8 pu=1.0\n" },
        { label: "Line", snippet: "New Line.Line_New Bus1=SourceBus Bus2=LoadBus R1=0.05 X1=0.15\n" },
        {
          label: "Transformer",
          snippet: "New Transformer.TR_New Buses=[SourceBus LoadBus] kVs=[13.8 0.48] kVAs=[1000 1000]\n",
        },
        { label: "Load", snippet: "New Load.Load_New Bus1=LoadBus kV=0.48 kW=250 kvar=100\n" },
      ];
    case "simulink":
    case "easy5":
    case "xcos":
      return [
        { label: "Gain", snippet: 'Block { BlockType Gain Name "Gain_New" Gain "2.0" }\n' },
        { label: "Integrator", snippet: 'Block { BlockType Integrator Name "Integ_New" InitialCondition "0" }\n' },
        { label: "Sum", snippet: 'Block { BlockType Sum Name "Sum_New" Inputs "+-" }\n' },
        { label: "Step", snippet: 'Block { BlockType Step Name "Step_New" After "1.0" }\n' },
      ];
    case "plcopen":
      return [
        { label: "Contact / Coil", snippet: "IF Start_Cmd AND NOT Fault_Bit THEN\n  Drive_Enable := TRUE;\nEND_IF;\n" },
        { label: "TON Timer", snippet: "TON_Delay(IN := Start_Cmd, PT := T#500ms, Q => Delay_Done);\n" },
        { label: "CTU Counter", snippet: "CTU_Parts(CU := Part_Sensor, R := Reset_Cmd, PV := 25, Q => Batch_Full);\n" },
      ];
    case "urdf":
    case "simpack":
    case "gensys":
    case "adams":
      return [
        {
          label: "Rigid Body / Link",
          snippet:
            '  <link name="link_new">\n    <inertial><mass value="1.5"/><inertia ixx="0.02" ixy="0" ixz="0" iyy="0.02" iyz="0" izz="0.02"/></inertial>\n  </link>\n',
        },
        {
          label: "Revolute Joint",
          snippet:
            '  <joint name="joint_new" type="revolute">\n    <parent link="base_link"/>\n    <child link="link_new"/>\n    <axis xyz="0 0 1"/>\n  </joint>\n',
        },
      ];
    case "fea":
      return [
        { label: "Material", snippet: "*MATERIAL, NAME=ALUMINUM_6061\n*ELASTIC\n68900.0, 0.33\n*DENSITY\n2.7e-9\n" },
        { label: "Boundary", snippet: "*BOUNDARY\n1, 1, 3, 0.0\n" },
        { label: "Concentrated Load", snippet: "*CLOAD\n4, 2, -500.0\n" },
      ];
    case "cfd":
      return [
        { label: "Farfield", snippet: "MARKER_FAR= ( farfield )\n" },
        { label: "Euler Wall", snippet: "MARKER_EULER= ( wall_surface )\n" },
        { label: "Pressure Outlet", snippet: "MARKER_OUTLET= ( outlet, 101325.0 )\n" },
      ];
    default:
      return [
        { label: "Parameter", snippet: "parameter Real k_new = 1.0;\n" },
        { label: "Component", snippet: "// Added element\n" },
      ];
  }
}

export interface MorselVisualizerPaneProps {
  dialect?: string | undefined;
  diagramType?: string | undefined;
  setDiagramType?: ((type: string) => void) | undefined;
  vtkBuffer?: Uint8Array | null | undefined;
  editorValue?: string | undefined;
  drillDownPath?: string[] | undefined;
  onDrillUp?: ((index: number) => void) | undefined;
  onDrillRoot?: (() => void) | undefined;
  onNodeDoubleClick?: ((nodeId: string, nodeData?: any) => void) | undefined;
  onRevealLine?: ((line: number, identifier?: string) => void) | undefined;
  onInsertStencilSnippet?: ((snippet: string, className?: string) => void) | undefined;
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
  dialect = "modelica",
  diagramType = "diagram",
  setDiagramType,
  vtkBuffer,
  editorValue = "",
  drillDownPath = [],
  onDrillUp,
  onDrillRoot,
  onNodeDoubleClick,
  onRevealLine,
  onInsertStencilSnippet,
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
  const [showAnalysisView, setShowAnalysisView] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const activeLangInfo = getLanguageInfo(dialect);
  const stencils = useMemo(() => getStencilsForDialect(dialect), [dialect]);

  const recordedSessions = useMemo<HistorianSession[]>(() => {
    if (!localSimulationData || localSimulationData.length === 0) return [];
    const lastRow = localSimulationData[localSimulationData.length - 1];
    const durationSec = typeof lastRow?.time === "number" ? lastRow.time : localSimulationData.length * 0.01;
    const nowStr = new Date().toISOString().replace("T", " ").slice(0, 19);
    return [
      {
        id: `sim-${selectedTreeClassName || dialect}-latest`,
        name: `${selectedTreeClassName || activeLangInfo.label} (${localSimulationData.length} pts)`,
        recordedAt: nowStr,
        durationSeconds: Number(durationSec),
        participantCount: 1,
        signalCount: simulationVariables.length,
      },
    ];
  }, [localSimulationData, selectedTreeClassName, dialect, activeLangInfo.label, simulationVariables]);

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
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
          zIndex: 100,
        }}
      >
        <div
          style={{
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
          }}
        >
          <SegmentedControl
            aria-label="Center Pane View"
            onChange={(i) => {
              if (i === 0) {
                setShowResultsView(false);
                setShowCadView(false);
                setShowAnalysisView(false);
              } else if (i === 1) {
                setShowResultsView(true);
                setShowCadView(false);
                setShowAnalysisView(false);
              } else if (i === 2) {
                setShowResultsView(false);
                setShowCadView(true);
                setShowAnalysisView(false);
              } else if (i === 3) {
                setShowResultsView(false);
                setShowCadView(false);
                setShowAnalysisView(true);
              }
            }}
          >
            <SegmentedControl.Button
              selected={!showResultsView && !showCadView && !showAnalysisView}
              leadingVisual={WorkflowIcon}
            >
              {translations.diagram}
            </SegmentedControl.Button>
            <SegmentedControl.Button selected={showResultsView && !showAnalysisView} leadingVisual={PulseIcon}>
              {translations.simulation}
            </SegmentedControl.Button>
            <SegmentedControl.Button selected={showCadView && !showAnalysisView} leadingVisual={StackIcon}>
              {cadComponents.length > 0 || vtkBuffer ? `3D (${cadComponents.length || 1})` : "3D"}
            </SegmentedControl.Button>
            <SegmentedControl.Button selected={showAnalysisView} leadingVisual={TableIcon}>
              Inspector
            </SegmentedControl.Button>
          </SegmentedControl>

          {!showResultsView &&
            !showCadView &&
            !showAnalysisView &&
            activeLangInfo.diagramTypes &&
            activeLangInfo.diagramTypes.length > 1 &&
            setDiagramType && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 2,
                  padding: 2,
                  borderRadius: 8,
                  backgroundColor: colorMode === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
                }}
              >
                {activeLangInfo.diagramTypes.map((dt) => {
                  const isSelected = diagramType === dt.id;
                  return (
                    <button
                      key={dt.id}
                      type="button"
                      onClick={() => setDiagramType(dt.id)}
                      style={{
                        border: "none",
                        borderRadius: 6,
                        padding: "3px 8px",
                        fontSize: 11,
                        fontWeight: isSelected ? 600 : 400,
                        cursor: "pointer",
                        backgroundColor: isSelected
                          ? colorMode === "dark"
                            ? "rgba(255,255,255,0.14)"
                            : "#ffffff"
                          : "transparent",
                        color: isSelected
                          ? colorMode === "dark"
                            ? "#e6edf3"
                            : "#1f2328"
                          : colorMode === "dark"
                            ? "#8b949e"
                            : "#656d76",
                      }}
                    >
                      {dt.label}
                    </button>
                  );
                })}
              </div>
            )}

          {!showResultsView && !showCadView && !showAnalysisView && (
            <button
              type="button"
              onClick={() => setShowPalette((v) => !v)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 10px",
                fontSize: 11,
                fontWeight: 600,
                borderRadius: 8,
                border:
                  colorMode === "dark" ? "1px solid rgba(88, 166, 255, 0.35)" : "1px solid rgba(9, 105, 218, 0.35)",
                background: showPalette
                  ? colorMode === "dark"
                    ? "rgba(88, 166, 255, 0.2)"
                    : "rgba(9, 105, 218, 0.12)"
                  : "transparent",
                color: colorMode === "dark" ? "#58a6ff" : "#0969da",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
              title="Open interactive element & stencil palette"
            >
              <PlusIcon size={12} />
              <span>Add Element</span>
            </button>
          )}

          {cadComponents.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setShowResultsView(false);
                setShowAnalysisView(false);
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

        {/* Collapsible Stencil Palette Bar */}
        {showPalette && !showResultsView && !showCadView && !showAnalysisView && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 6,
              padding: "6px 12px",
              borderRadius: 10,
              backgroundColor: colorMode === "dark" ? "rgba(22, 27, 34, 0.95)" : "rgba(255, 255, 255, 0.95)",
              backdropFilter: "blur(12px)",
              boxShadow:
                colorMode === "dark"
                  ? "0 4px 16px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.08)"
                  : "0 4px 16px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(0, 0, 0, 0.06)",
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: colorMode === "dark" ? "#8b949e" : "#656d76",
                marginRight: 4,
              }}
            >
              {activeLangInfo.label} Palette:
            </span>
            {stencils.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  onInsertStencilSnippet?.(item.snippet, item.className);
                }}
                style={{
                  border:
                    colorMode === "dark" ? "1px solid rgba(255, 255, 255, 0.12)" : "1px solid rgba(0, 0, 0, 0.12)",
                  borderRadius: 6,
                  padding: "3px 8px",
                  fontSize: 11,
                  fontWeight: 500,
                  cursor: "pointer",
                  backgroundColor: colorMode === "dark" ? "rgba(255, 255, 255, 0.04)" : "rgba(0, 0, 0, 0.03)",
                  color: colorMode === "dark" ? "#e6edf3" : "#1f2328",
                }}
                title={`Insert ${item.label} into ${activeLangInfo.label} document`}
              >
                + {item.label}
              </button>
            ))}
          </div>
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
            visibility: !showResultsView && !showCadView && !showAnalysisView ? "visible" : "hidden",
            opacity: !showResultsView && !showCadView && !showAnalysisView ? 1 : 0,
            pointerEvents: !showResultsView && !showCadView && !showAnalysisView ? "auto" : "none",
            zIndex: !showResultsView && !showCadView && !showAnalysisView ? 1 : 0,
          }}
        >
          {/* Hierarchical Drill-Down Breadcrumbs Bar */}
          {drillDownPath && drillDownPath.length > 0 && (
            <div
              style={{
                position: "absolute",
                top: 12,
                left: 12,
                zIndex: 90,
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 10px",
                borderRadius: 8,
                backgroundColor: colorMode === "dark" ? "rgba(22, 27, 34, 0.9)" : "rgba(255, 255, 255, 0.92)",
                border: colorMode === "dark" ? "1px solid rgba(255, 255, 255, 0.1)" : "1px solid rgba(0, 0, 0, 0.1)",
                fontSize: 12,
              }}
            >
              <button
                type="button"
                onClick={() => onDrillRoot?.()}
                style={{
                  border: "none",
                  background: "transparent",
                  color: colorMode === "dark" ? "#58a6ff" : "#0969da",
                  fontWeight: 600,
                  cursor: "pointer",
                  padding: "0 2px",
                  fontSize: 12,
                }}
              >
                Root
              </button>
              {drillDownPath.map((seg, idx) => (
                <React.Fragment key={`${seg}-${idx}`}>
                  <span style={{ color: colorMode === "dark" ? "#8b949e" : "#656d76" }}>›</span>
                  <button
                    type="button"
                    onClick={() => onDrillUp?.(idx)}
                    style={{
                      border: "none",
                      background: "transparent",
                      color:
                        idx === drillDownPath.length - 1
                          ? colorMode === "dark"
                            ? "#e6edf3"
                            : "#1f2328"
                          : colorMode === "dark"
                            ? "#58a6ff"
                            : "#0969da",
                      fontWeight: idx === drillDownPath.length - 1 ? 600 : 500,
                      cursor: "pointer",
                      padding: "0 2px",
                      fontSize: 12,
                    }}
                  >
                    {seg}
                  </button>
                </React.Fragment>
              ))}
            </div>
          )}

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
                onNodeDoubleClick={onNodeDoubleClick}
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
            display: showCadView && !showAnalysisView ? "flex" : "none",
            flexDirection: "column",
            overflow: "hidden",
            minHeight: 0,
            zIndex: showCadView && !showAnalysisView ? 2 : 0,
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
              vtkBuffer={vtkBuffer ?? undefined}
            />
          </Suspense>
        </div>

        {/* Simulation Results and Cosimulation Pane */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: showResultsView && !showAnalysisView ? "flex" : "none",
            flexDirection: "column",
            overflow: "hidden",
            minHeight: 0,
            zIndex: showResultsView && !showAnalysisView ? 2 : 0,
            backgroundColor: "var(--color-canvas-default)",
          }}
        >
          <CosimPanel
            dataSource={cosimDataSource}
            onDataSourceChange={setCosimDataSource}
            colorMode={colorMode}
            onReplaySession={handleReplaySession}
            sessions={recordedSessions}
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

        {/* Secondary Domain Analytical Inspector Pane */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            paddingTop: nestedModels.length > 1 ? 96 : 64,
            display: showAnalysisView ? "flex" : "none",
            flexDirection: "column",
            overflow: "hidden",
            minHeight: 0,
            zIndex: showAnalysisView ? 2 : 0,
            backgroundColor: "var(--color-canvas-default)",
          }}
        >
          <PolyglotDomainPanel dialect={dialect} code={editorValue} colorMode={colorMode} onRevealLine={onRevealLine} />
        </div>
      </div>
    </div>
  );
};
