// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DynamicBindingConfig } from "@modelscript/cad";
import {
  FlowchartIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  PulseIcon,
  SidebarCollapseIcon,
  SidebarExpandIcon,
  StackIcon,
  TableIcon,
  WorkflowIcon,
  XIcon,
} from "@primer/octicons-react";
import { Button, IconButton, SegmentedControl } from "@primer/react";
import type { editor } from "monaco-editor";
import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useCapabilities } from "../../../CapabilitiesContext";
import { useFeatureFlag } from "../../../FeatureFlagContext";
import { HERO_EXAMPLES } from "../../../pages/playground/constants";
import Spinner from "../../Spinner";
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
        {
          label: "3D Shape",
          className: "Modelica.Mechanics.MultiBody.Visualizers.FixedShape",
          snippet:
            '  Modelica.Mechanics.MultiBody.Visualizers.FixedShape shape_new(shapeType="box", length=1.0, width=0.2, height=0.2, color={0, 128, 255});\n',
        },
        {
          label: "3D Arrow",
          className: "Modelica.Mechanics.MultiBody.Visualizers.SignalArrow",
          snippet:
            "  Modelica.Mechanics.MultiBody.Visualizers.SignalArrow arrow_new(diameter=0.04, color={255, 80, 0});\n",
        },
        {
          label: "3D Torus",
          className: "Modelica.Mechanics.MultiBody.Visualizers.Torus",
          snippet: "  Modelica.Mechanics.MultiBody.Visualizers.Torus torus_new(ri=0.5, ro=0.1, color={0, 180, 120});\n",
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
      return [
        {
          label: "Component",
          snippet:
            '        <User id="9001" name="master:resistor" x="180" y="180" w="44" h="28">\n          <paramlist><param name="R" value="10.0"/></paramlist>\n        </User>\n',
        },
        {
          label: "Wire",
          snippet: '        <Wire id="9002" x="180" y="180"><vertex x="0" y="0"/><vertex x="72" y="0"/></Wire>\n',
        },
      ];
    case "psse":
      return [
        { label: "Bus Record", snippet: "   99, 'BUS_NEW     ', 138.0000,1,   1,   1,   1,1.00000,   0.0000\n" },
        {
          label: "Load Record",
          snippet:
            "   99,'1 ',1,   1,   1,    50.000,    15.000,     0.000,     0.000,     0.000,     0.000,   1,1,0\n",
        },
      ];
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
    case "simpack":
      return [
        {
          label: "Body ($B)",
          snippet:
            "body.id            = '$B_NewBody'\nbody.mass          = 1200.0\nbody.inertia       = [450.0, 1800.0, 1850.0]\n",
        },
        {
          label: "Force Element ($F)",
          snippet:
            "force.id           = '$F_PrimarySpring'\nforce.type         = 43\nforce.stiffness    = 1.2e6\nforce.damping      = 1.5e4\n",
        },
      ];
    case "gensys":
      return [
        {
          label: "Mass (mass)",
          snippet: "mass m_body_new  0.0 0.0 -1.2   m=15000  Jx=22000 Jy=450000 Jz=450000\n",
        },
        {
          label: "Spring/Damper (coupl)",
          snippet: "coupl k_susp_new  body_1 body_2  0.0 1.0 -0.5  0.0 1.0 -0.8  k=350e3 c=18e3\n",
        },
      ];
    case "adams":
      return [
        { label: "Part", snippet: "PART/99, MASS = 12.5, CM = 9901, IP = 1.2, 1.2, 0.8\n" },
        { label: "Joint", snippet: "JOINT/99, REVOLUTE, I = 101, J = 201\n" },
      ];
    case "urdf":
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
  handleSelectComponent: (name: string | null, cachedProps?: any[], isLoading?: boolean) => void;
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
  onToggleSimulationVariable?: ((variable: string) => void) | undefined;
  cosimDataSource: "local" | "mqtt-live" | "historian-replay";
  setCosimDataSource: (ds: "local" | "mqtt-live" | "historian-replay") => void;
  handleReplaySession: (session: HistorianSession, speed: number) => void;
  localSimulationData: Record<string, number | string>[] | null;
  sweepResults: { value: number; y: number[][] }[] | null;
  simulationStatus: any;
  handleVariablesLoaded: (vars: string[]) => void;
  treeVisible?: boolean | undefined;
  setTreeVisible?: React.Dispatch<React.SetStateAction<boolean>> | undefined;
  setView?: ((v: MorselView) => void) | undefined;
  onAutoLayout?: (() => void) | undefined;
  onSimulate?: (() => void) | undefined;
  onOpenCloudModal?: (() => void) | undefined;
  onFlatten?: (() => void) | undefined;
  hideCenterFloatingToolbar?: boolean | undefined;
  showAnalysisView?: boolean | undefined;
  setShowAnalysisView?: ((v: boolean) => void) | undefined;
  loadingProgress?: number | undefined;
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
  onToggleSimulationVariable,
  cosimDataSource,
  setCosimDataSource,
  handleReplaySession,
  localSimulationData,
  sweepResults,
  simulationStatus,
  handleVariablesLoaded,
  treeVisible,
  setTreeVisible,
  setView: _setView,
  onAutoLayout,
  onSimulate,
  onOpenCloudModal: _onOpenCloudModal,
  onFlatten: _onFlatten,
  hideCenterFloatingToolbar = false,
  showAnalysisView: controlledShowAnalysisView,
  setShowAnalysisView: controlledSetShowAnalysisView,
  loadingProgress,
}) => {
  const { hasCapability } = useCapabilities();
  const _isCaeComputeEnabled = useFeatureFlag("cae_cloud_solver");
  const isCosimMqttEnabled = hasCapability("cosimMqtt");
  const isTimescaleEnabled = hasCapability("timescaleHistorian");
  const showCosimSection = isCosimMqttEnabled || isTimescaleEnabled;
  const isDraggingProperties = useRef(false);
  const [isPropResizerHovered, setIsPropResizerHovered] = useState(false);
  const [isPropResizerDragging, setIsPropResizerDragging] = useState(false);
  const [isEmptyStateDismissed, setIsEmptyStateDismissed] = useState(false);

  useEffect(() => {
    setIsEmptyStateDismissed(false);
  }, [dialect]);

  const [internalShowAnalysisView, setInternalShowAnalysisView] = useState(false);
  const showAnalysisView = controlledShowAnalysisView ?? internalShowAnalysisView;
  const setShowAnalysisView = controlledSetShowAnalysisView ?? setInternalShowAnalysisView;
  const [showPalette, setShowPalette] = useState(false);
  const activeLangInfo = getLanguageInfo(dialect);
  const stencils = useMemo(() => getStencilsForDialect(dialect), [dialect]);
  const isPlaygroundRoute =
    typeof window !== "undefined" &&
    (window.location.pathname.startsWith("/playground") || window.location.pathname.startsWith("/sketch"));

  const supports3dView = activeLangInfo.supports3d || cadComponents.length > 0 || Boolean(vtkBuffer);
  const centerViewTabs = useMemo(() => {
    const tabs: Array<{ id: "diagram" | "simulation" | "3d" | "inspector"; label: string; icon: any }> = [];
    if (activeLangInfo.supportsDiagram) {
      tabs.push({ id: "diagram", label: translations.diagram, icon: WorkflowIcon });
    }
    if (activeLangInfo.supportsSimulation) {
      tabs.push({ id: "simulation", label: translations.simulation, icon: PulseIcon });
    }
    if (supports3dView) {
      tabs.push({
        id: "3d",
        label: cadComponents.length > 0 || vtkBuffer ? `3D (${cadComponents.length || 1})` : "3D",
        icon: StackIcon,
      });
    }
    tabs.push({
      id: "inspector",
      label:
        activeLangInfo.id === "owl2"
          ? "Reasoner & Axioms"
          : activeLangInfo.id === "sysml2"
            ? "Requirements"
            : "Inspector",
      icon: TableIcon,
    });
    return tabs;
  }, [
    activeLangInfo.id,
    activeLangInfo.supportsDiagram,
    activeLangInfo.supportsSimulation,
    supports3dView,
    cadComponents.length,
    vtkBuffer,
    translations.diagram,
    translations.simulation,
  ]);

  const effectiveDiagramType = useMemo(() => {
    const opts = activeLangInfo.diagramTypes;
    if (!opts || opts.length === 0) return diagramType;
    if (opts.some((d) => d.id === diagramType)) return diagramType;
    return opts[0]!.id;
  }, [activeLangInfo.diagramTypes, diagramType]);

  useEffect(() => {
    if (!activeLangInfo.supportsSimulation && showResultsView) {
      setShowResultsView(false);
    }
    if (!supports3dView && showCadView) {
      setShowCadView(false);
    }
  }, [
    activeLangInfo.supportsSimulation,
    supports3dView,
    showResultsView,
    showCadView,
    setShowResultsView,
    setShowCadView,
  ]);

  const showEmptyState =
    !isEmptyStateDismissed &&
    (loadingProgress === undefined || loadingProgress >= 100) &&
    (!diagramData?.nodes || diagramData.nodes.length === 0) &&
    !isDiagramLoading &&
    !showResultsView &&
    !showCadView &&
    !showAnalysisView;

  const starterExamples = useMemo(() => {
    const matches = HERO_EXAMPLES.filter((ex) => ex.lang === dialect);
    return matches.length > 0 ? matches.slice(0, 3) : HERO_EXAMPLES.slice(0, 3);
  }, [dialect]);

  useEffect(() => {
    if (!showEmptyState) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsEmptyStateDismissed(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showEmptyState]);

  const [backendHistorianSessions, setBackendHistorianSessions] = useState<HistorianSession[]>([]);

  useEffect(() => {
    if (cosimDataSource !== "historian-replay") return;
    let cancelled = false;
    fetch("/api/v1/historian/sessions")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const list = Array.isArray(data.sessions) ? data.sessions : Array.isArray(data) ? data : [];
        if (list.length > 0) {
          setBackendHistorianSessions(list);
        }
      })
      .catch(() => {
        // Fallback to local simulation buffer when backend historian is unavailable
      });
    return () => {
      cancelled = true;
    };
  }, [cosimDataSource]);

  const recordedSessions = useMemo<HistorianSession[]>(() => {
    if (backendHistorianSessions.length > 0) {
      return backendHistorianSessions;
    }
    if (!localSimulationData || localSimulationData.length === 0) return [];
    const lastRow = localSimulationData[localSimulationData.length - 1];
    const durationSec = typeof lastRow?.time === "number" ? lastRow.time : localSimulationData.length * 0.01;
    const nowStr = new Date().toISOString().replace("T", " ").slice(0, 19);
    return [
      {
        id: `sim-${selectedTreeClassName || dialect}-latest`,
        name: `Local Simulation Buffer: ${selectedTreeClassName || activeLangInfo.label} (${localSimulationData.length} pts)`,
        recordedAt: nowStr,
        durationSeconds: Number(durationSec),
        participantCount: 1,
        signalCount: simulationVariables.length,
      },
    ];
  }, [
    backendHistorianSessions,
    localSimulationData,
    selectedTreeClassName,
    dialect,
    activeLangInfo.label,
    simulationVariables,
  ]);

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

      {/* Floating View Switcher & Actions (Only in standalone embedded mode without top workbench navbar) */}
      {!hideCenterFloatingToolbar &&
        !isPlaygroundRoute &&
        (!isNarrow ||
          (!showResultsView && !showCadView && !showAnalysisView) ||
          cadComponents.length > 0 ||
          (showCadView && Boolean(animationControllerRef.current?.hasData))) && (
          <div
            style={{
              position: "absolute",
              top: nestedModels.length > 1 ? "48px" : "12px",
              left: "50%",
              transform: "translateX(-50%)",
              width: "max-content",
              maxWidth: "calc(100% - 24px)",
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
                flexWrap: "wrap",
                justifyContent: "center",
                alignItems: "center",
                gap: 6,
                maxWidth: "100%",
                boxSizing: "border-box",
                padding: isNarrow ? "4px 8px" : "6px 10px",
                borderRadius: 12,
                backgroundColor: colorMode === "dark" ? "rgba(15, 22, 38, 0.9)" : "rgba(255, 255, 255, 0.9)",
                backdropFilter: "blur(12px)",
                boxShadow:
                  colorMode === "dark"
                    ? "0 4px 24px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(148, 163, 184, 0.16)"
                    : "0 4px 24px rgba(15, 23, 42, 0.12), 0 0 0 1px rgba(15, 23, 42, 0.08)",
              }}
            >
              {isPlaygroundRoute && !isNarrow && setTreeVisible && (
                <>
                  <IconButton
                    icon={treeVisible ? SidebarExpandIcon : SidebarCollapseIcon}
                    size="small"
                    variant="invisible"
                    aria-label={translations.toggleTree}
                    title={translations.toggleTree}
                    onClick={() => setTreeVisible((prev) => !prev)}
                    style={
                      treeVisible
                        ? {
                            backgroundColor: colorMode === "dark" ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.06)",
                            borderRadius: 6,
                          }
                        : {}
                    }
                  />
                  <div
                    style={{ width: 1, height: 18, backgroundColor: colorMode === "dark" ? "#30363d" : "#d0d7de" }}
                  />
                </>
              )}

              {!isNarrow && (
                <SegmentedControl
                  aria-label="Center Pane View"
                  size="small"
                  variant="default"
                  onChange={(i) => {
                    const targetTab = centerViewTabs[i];
                    if (!targetTab) return;
                    if (targetTab.id === "diagram") {
                      setShowResultsView(false);
                      setShowCadView(false);
                      setShowAnalysisView(false);
                    } else if (targetTab.id === "simulation") {
                      setShowResultsView(true);
                      setShowCadView(false);
                      setShowAnalysisView(false);
                    } else if (targetTab.id === "3d") {
                      setShowResultsView(false);
                      setShowCadView(true);
                      setShowAnalysisView(false);
                    } else if (targetTab.id === "inspector") {
                      setShowResultsView(false);
                      setShowCadView(false);
                      setShowAnalysisView(true);
                    }
                  }}
                >
                  {centerViewTabs.map((tab) => {
                    const isSelected =
                      tab.id === "diagram"
                        ? !showResultsView && !showCadView && !showAnalysisView
                        : tab.id === "simulation"
                          ? showResultsView && !showAnalysisView
                          : tab.id === "3d"
                            ? showCadView && !showAnalysisView
                            : showAnalysisView;
                    return (
                      <SegmentedControl.Button key={tab.id} selected={isSelected} leadingVisual={tab.icon}>
                        {tab.label}
                      </SegmentedControl.Button>
                    );
                  })}
                </SegmentedControl>
              )}

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
                      const isSelected = effectiveDiagramType === dt.id;
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
                    borderRadius: 999,
                    border: "1px solid color-mix(in srgb, var(--ms-brand, #0891b2) 40%, transparent)",
                    background: showPalette ? "var(--ms-brand-soft, rgba(8, 145, 178, 0.14))" : "transparent",
                    color: colorMode === "dark" ? "var(--ms-link, #22d3ee)" : "var(--ms-brand, #0e7490)",
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

              {isPlaygroundRoute && !isNarrow && onAutoLayout && activeLangInfo.supportsDiagram && (
                <>
                  <div
                    style={{ width: 1, height: 18, backgroundColor: colorMode === "dark" ? "#30363d" : "#d0d7de" }}
                  />
                  <IconButton
                    icon={FlowchartIcon}
                    size="small"
                    variant="invisible"
                    aria-label={translations.autoLayout}
                    title={translations.autoLayout}
                    onClick={onAutoLayout}
                  />
                </>
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
        )}

      {/* Compact corner Diagram/Icon switcher when center floating HUD is hidden (e.g. inline artifact card) */}
      {hideCenterFloatingToolbar &&
        !isPlaygroundRoute &&
        !showResultsView &&
        !showCadView &&
        !showAnalysisView &&
        activeLangInfo.diagramTypes &&
        activeLangInfo.diagramTypes.length > 1 &&
        setDiagramType && (
          <div
            style={{
              position: "absolute",
              top: nestedModels.length > 1 ? 44 : 10,
              right: 10,
              zIndex: 90,
              display: "flex",
              alignItems: "center",
              gap: 2,
              padding: 2,
              borderRadius: 8,
              backgroundColor: colorMode === "dark" ? "rgba(13, 17, 23, 0.85)" : "rgba(255, 255, 255, 0.88)",
              backdropFilter: "blur(8px)",
              border: colorMode === "dark" ? "1px solid rgba(148, 163, 184, 0.18)" : "1px solid rgba(15, 23, 42, 0.1)",
              boxShadow: "0 2px 10px rgba(0, 0, 0, 0.25)",
            }}
          >
            {activeLangInfo.diagramTypes.map((dt) => {
              const isSelected = effectiveDiagramType === dt.id;
              return (
                <button
                  key={dt.id}
                  type="button"
                  onClick={() => setDiagramType(dt.id)}
                  style={{
                    border: "none",
                    borderRadius: 6,
                    padding: "2px 8px",
                    fontSize: 11,
                    fontWeight: isSelected ? 600 : 400,
                    cursor: "pointer",
                    backgroundColor: isSelected
                      ? colorMode === "dark"
                        ? "rgba(6, 182, 212, 0.2)"
                        : "#ffffff"
                      : "transparent",
                    color: isSelected
                      ? colorMode === "dark"
                        ? "#22d3ee"
                        : "#0e7490"
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
          {/* Hierarchical Drill-Down Breadcrumbs Bar (only when floating toolbar is active) */}
          {!hideCenterFloatingToolbar && !isPlaygroundRoute && drillDownPath && drillDownPath.length > 0 && (
            <div
              style={{
                position: "absolute",
                top: hideCenterFloatingToolbar ? 10 : showPalette ? 96 : 56,
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

          <div
            className="flex-1 overflow-hidden"
            style={{
              minWidth: 0,
              position: "relative",
              display: "flex",
              flexDirection: "column",
              height: "100%",
            }}
          >
            {/* Docked Canvas Sub-Header Bar */}
            {(hideCenterFloatingToolbar || isPlaygroundRoute) && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "4px 12px",
                  minHeight: 36,
                  borderBottom:
                    colorMode === "dark" ? "1px solid rgba(255, 255, 255, 0.08)" : "1px solid rgba(0, 0, 0, 0.06)",
                  backgroundColor: colorMode === "dark" ? "rgba(13, 17, 23, 0.65)" : "rgba(246, 248, 250, 0.75)",
                  backdropFilter: "blur(8px)",
                  gap: 8,
                  flexShrink: 0,
                  zIndex: 10,
                }}
              >
                {/* Left: Sidebar Expand & Breadcrumbs */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, overflow: "hidden" }}>
                  {!treeVisible && setTreeVisible && (
                    <IconButton
                      icon={SidebarExpandIcon}
                      size="small"
                      variant="invisible"
                      aria-label={translations.toggleTree || "Expand Libraries"}
                      title={translations.toggleTree || "Expand Libraries"}
                      onClick={() => {
                        setTreeVisible(true);
                        if (typeof window !== "undefined") {
                          window.dispatchEvent(new CustomEvent("morsel:sidebar-changed", { detail: { open: true } }));
                        }
                      }}
                    />
                  )}
                  {drillDownPath && drillDownPath.length > 0 ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
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
                  ) : (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: colorMode === "dark" ? "#8b949e" : "#656d76",
                        letterSpacing: "0.02em",
                        textTransform: "uppercase",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {selectedTreeClassName || activeLangInfo.label}
                    </span>
                  )}
                </div>

                {/* Right: Diagram Type Selector, Add Element, Auto-Layout */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  {activeLangInfo.diagramTypes && activeLangInfo.diagramTypes.length > 1 && setDiagramType && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 2,
                        padding: 2,
                        borderRadius: 6,
                        backgroundColor: colorMode === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
                      }}
                    >
                      {activeLangInfo.diagramTypes.map((dt) => {
                        const isSelected = effectiveDiagramType === dt.id;
                        return (
                          <button
                            key={dt.id}
                            type="button"
                            onClick={() => setDiagramType(dt.id)}
                            style={{
                              border: "none",
                              borderRadius: 4,
                              padding: "2px 8px",
                              fontSize: 11,
                              fontWeight: isSelected ? 600 : 400,
                              cursor: "pointer",
                              backgroundColor: isSelected
                                ? colorMode === "dark"
                                  ? "rgba(6, 182, 212, 0.2)"
                                  : "#ffffff"
                                : "transparent",
                              color: isSelected
                                ? colorMode === "dark"
                                  ? "#22d3ee"
                                  : "#0e7490"
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

                  <button
                    type="button"
                    onClick={() => setShowPalette((v) => !v)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "3px 8px",
                      fontSize: 11,
                      fontWeight: 600,
                      borderRadius: 999,
                      border: "1px solid color-mix(in srgb, var(--ms-brand, #0891b2) 40%, transparent)",
                      background: showPalette ? "var(--ms-brand-soft, rgba(8, 145, 178, 0.14))" : "transparent",
                      color: colorMode === "dark" ? "var(--ms-link, #22d3ee)" : "var(--ms-brand, #0e7490)",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                    title="Open interactive element & stencil palette"
                  >
                    <PlusIcon size={12} />
                    <span>Add Element</span>
                  </button>

                  {onAutoLayout && activeLangInfo.supportsDiagram && (
                    <IconButton
                      icon={FlowchartIcon}
                      size="small"
                      variant="invisible"
                      aria-label={translations.autoLayout || "Auto-layout diagram"}
                      title={translations.autoLayout || "Auto-layout diagram"}
                      onClick={onAutoLayout}
                    />
                  )}
                </div>
              </div>
            )}

            {/* Collapsible Stencil Palette Bar */}
            {(hideCenterFloatingToolbar || isPlaygroundRoute) && showPalette && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 6,
                  padding: "6px 12px",
                  borderBottom:
                    colorMode === "dark" ? "1px solid rgba(255, 255, 255, 0.08)" : "1px solid rgba(0, 0, 0, 0.06)",
                  backgroundColor: colorMode === "dark" ? "rgba(22, 27, 34, 0.95)" : "rgba(255, 255, 255, 0.95)",
                  backdropFilter: "blur(12px)",
                  flexShrink: 0,
                  zIndex: 9,
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
                      padding: "2px 8px",
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

            <div
              style={{ flex: 1, position: "relative", overflow: "hidden", minHeight: 0 }}
              onClick={() => {
                if (showEmptyState) {
                  setIsEmptyStateDismissed(true);
                }
              }}
            >
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
                  onSelect={(name, cachedProps, isLoading) => {
                    if (showEmptyState) {
                      setIsEmptyStateDismissed(true);
                    }
                    handleSelectComponent(name, cachedProps, isLoading);
                  }}
                  onShowProperties={handleSelectComponent}
                  onNodeDoubleClick={onNodeDoubleClick}
                  onDrop={async (className, x, y) => {
                    setIsEmptyStateDismissed(true);
                    enqueueDiagramAction({ type: "addComponent", className, x, y });
                  }}
                  onConnect={async (source, target, points) => {
                    enqueueDiagramAction({ type: "connect", source, target, points });
                  }}
                  onMove={async (items) => {
                    enqueueDiagramAction({ type: "move", items });
                  }}
                  onResize={async (name, x, y, width, height, rotation, edges) => {
                    enqueueDiagramAction({
                      type: "resize",
                      item: { name, x, y, width, height, rotation, edges },
                    });
                  }}
                  onEdgeMove={async (edges) => {
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

              {showEmptyState && (
                <div
                  role="dialog"
                  aria-label="Design your physical system"
                  style={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -50%)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    textAlign: "center",
                    maxWidth: "460px",
                    width: "calc(100% - 48px)",
                    padding: "28px 24px 22px 24px",
                    borderRadius: "16px",
                    background: colorMode === "dark" ? "rgba(13, 17, 23, 0.94)" : "rgba(255, 255, 255, 0.95)",
                    border:
                      colorMode === "dark" ? "1px solid rgba(48, 54, 61, 0.85)" : "1px solid rgba(208, 215, 222, 0.9)",
                    backdropFilter: "blur(20px)",
                    boxShadow:
                      colorMode === "dark"
                        ? "0 20px 48px -12px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.05)"
                        : "0 20px 48px -12px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.05)",
                    pointerEvents: "auto",
                    zIndex: 10,
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  {/* Close Button */}
                  <button
                    type="button"
                    aria-label="Close"
                    title="Close (Esc)"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsEmptyStateDismissed(true);
                    }}
                    style={{
                      position: "absolute",
                      top: 14,
                      right: 14,
                      width: 28,
                      height: 28,
                      borderRadius: "6px",
                      border: "none",
                      background: "transparent",
                      color: "var(--color-fg-muted, #8b949e)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      padding: 0,
                      transition: "background 0.15s ease, color 0.15s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background =
                        colorMode === "dark" ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.06)";
                      e.currentTarget.style.color = "var(--color-fg-default, #c9d1d9)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.color = "var(--color-fg-muted, #8b949e)";
                    }}
                  >
                    <XIcon size={16} />
                  </button>

                  {/* Icon Badge */}
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: "12px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      marginBottom: 14,
                      background:
                        colorMode === "dark"
                          ? "linear-gradient(135deg, rgba(6, 182, 212, 0.2) 0%, rgba(59, 130, 246, 0.15) 100%)"
                          : "linear-gradient(135deg, rgba(6, 182, 212, 0.15) 0%, rgba(59, 130, 246, 0.1) 100%)",
                      border:
                        colorMode === "dark" ? "1px solid rgba(6, 182, 212, 0.3)" : "1px solid rgba(6, 182, 212, 0.25)",
                      boxShadow: "0 4px 16px rgba(6, 182, 212, 0.15)",
                      color: "var(--color-accent-cyan, #06b6d4)",
                    }}
                  >
                    <WorkflowIcon size={24} />
                  </div>

                  {/* Title */}
                  <div
                    style={{
                      fontSize: "17px",
                      fontWeight: 700,
                      color: "var(--color-fg-default)",
                      letterSpacing: "-0.01em",
                      marginBottom: 8,
                    }}
                  >
                    Design your physical system
                  </div>

                  {/* Subtitle */}
                  <div
                    style={{
                      fontSize: "13px",
                      color: "var(--color-fg-muted)",
                      lineHeight: 1.5,
                      marginBottom: 20,
                      maxWidth: "380px",
                    }}
                  >
                    Drag components from the library on the left, or kickstart with a curated multi-physics model:
                  </div>

                  {/* Curated Starters */}
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%", marginBottom: 16 }}
                  >
                    {starterExamples.map((ex) => (
                      <button
                        key={ex.id}
                        type="button"
                        onClick={() => {
                          setIsEmptyStateDismissed(true);
                          if (editorRef.current) {
                            editorRef.current.setValue(ex.code);
                          }
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "10px 14px",
                          borderRadius: "10px",
                          border:
                            colorMode === "dark"
                              ? "1px solid rgba(48, 54, 61, 0.8)"
                              : "1px solid rgba(208, 215, 222, 0.9)",
                          background: colorMode === "dark" ? "rgba(22, 27, 34, 0.6)" : "rgba(246, 248, 250, 0.8)",
                          color: "var(--color-fg-default)",
                          cursor: "pointer",
                          textAlign: "left",
                          transition: "all 0.15s ease",
                          width: "100%",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = "var(--color-accent-fg, #0969da)";
                          e.currentTarget.style.background =
                            colorMode === "dark" ? "rgba(33, 38, 45, 0.9)" : "rgba(255, 255, 255, 1)";
                          e.currentTarget.style.transform = "translateY(-1px)";
                          e.currentTarget.style.boxShadow =
                            colorMode === "dark" ? "0 4px 12px rgba(0, 0, 0, 0.3)" : "0 4px 12px rgba(0, 0, 0, 0.06)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor =
                            colorMode === "dark" ? "rgba(48, 54, 61, 0.8)" : "rgba(208, 215, 222, 0.9)";
                          e.currentTarget.style.background =
                            colorMode === "dark" ? "rgba(22, 27, 34, 0.6)" : "rgba(246, 248, 250, 0.8)";
                          e.currentTarget.style.transform = "none";
                          e.currentTarget.style.boxShadow = "none";
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <span style={{ fontSize: "16px", lineHeight: 1 }}>
                            {ex.category === "Electrical"
                              ? "⚡"
                              : ex.category === "Mechanics"
                                ? "⚙️"
                                : ex.category === "Nonlinear Dynamics"
                                  ? "🌀"
                                  : ex.category === "SysML v2"
                                    ? "📐"
                                    : "🚀"}
                          </span>
                          <span style={{ fontSize: "13px", fontWeight: 600 }}>{ex.title}</span>
                        </div>
                        <span
                          style={{
                            fontSize: "10px",
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.04em",
                            padding: "2px 8px",
                            borderRadius: "12px",
                            background: colorMode === "dark" ? "rgba(56, 189, 248, 0.12)" : "rgba(9, 105, 218, 0.08)",
                            color: colorMode === "dark" ? "#38bdf8" : "#0969da",
                          }}
                        >
                          {ex.category}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* Footer Helper */}
                  <div
                    style={{
                      fontSize: "11px",
                      color: "var(--color-fg-muted)",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      opacity: 0.85,
                    }}
                  >
                    <span>
                      Click canvas or press{" "}
                      <kbd
                        style={{
                          padding: "1px 5px",
                          fontSize: "10px",
                          borderRadius: "4px",
                          background: colorMode === "dark" ? "#21262d" : "#e1e4e8",
                          border: colorMode === "dark" ? "1px solid #30363d" : "1px solid #d0d7de",
                          fontFamily: "ui-monospace, SFMono-Regular, SF Mono, Menlo, monospace",
                        }}
                      >
                        Esc
                      </kbd>{" "}
                      to start with a blank canvas
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {selectedComponent && (
            <>
              <div
                role="separator"
                aria-orientation="vertical"
                aria-valuenow={propertiesWidth}
                aria-valuemin={200}
                aria-valuemax={800}
                aria-label="Resize properties panel"
                tabIndex={0}
                style={{
                  width: 10,
                  marginLeft: -5,
                  marginRight: -5,
                  cursor: "col-resize",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  display: "flex",
                  position: "relative",
                  zIndex: 10,
                  backgroundColor: "transparent",
                  outline: "none",
                  userSelect: "none",
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowLeft") {
                    e.preventDefault();
                    setPropertiesWidth(Math.max(200, Math.min(800, propertiesWidth + 10)));
                  } else if (e.key === "ArrowRight") {
                    e.preventDefault();
                    setPropertiesWidth(Math.max(200, Math.min(800, propertiesWidth - 10)));
                  } else if (e.key === "Home") {
                    e.preventDefault();
                    setPropertiesWidth(800);
                  } else if (e.key === "End") {
                    e.preventDefault();
                    setPropertiesWidth(200);
                  }
                }}
                onDoubleClick={() => {
                  setPropertiesWidth(300);
                }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  isDraggingProperties.current = true;
                  setIsPropResizerDragging(true);
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
                    setIsPropResizerDragging(false);
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
                onTouchStart={(e) => {
                  const touch = e.touches[0];
                  if (!touch) return;
                  isDraggingProperties.current = true;
                  setIsPropResizerDragging(true);
                  const startX = touch.clientX;
                  const startWidth = propertiesWidth;

                  const onTouchMove = (ev: TouchEvent) => {
                    if (!isDraggingProperties.current) return;
                    const t = ev.touches[0];
                    if (!t) return;
                    const deltaX = startX - t.clientX;
                    const newWidth = Math.max(200, Math.min(800, startWidth + deltaX));
                    setPropertiesWidth(newWidth);
                  };

                  const onTouchEnd = () => {
                    isDraggingProperties.current = false;
                    setIsPropResizerDragging(false);
                    document.removeEventListener("touchmove", onTouchMove);
                    document.removeEventListener("touchend", onTouchEnd);
                    document.body.style.userSelect = "auto";
                  };

                  document.addEventListener("touchmove", onTouchMove, { passive: true });
                  document.addEventListener("touchend", onTouchEnd);
                  document.body.style.userSelect = "none";
                }}
                onMouseEnter={() => setIsPropResizerHovered(true)}
                onMouseLeave={() => setIsPropResizerHovered(false)}
              >
                {/* Active highlight line centered on the border */}
                <div
                  style={{
                    width: 2,
                    height: "100%",
                    backgroundColor:
                      isPropResizerHovered || isPropResizerDragging ? "var(--ms-brand, #0891b2)" : "transparent",
                    transition: "background-color 0.15s ease",
                  }}
                />
                {/* Subtle grab pill in the vertical center */}
                <div
                  style={{
                    position: "absolute",
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: 4,
                    height: 28,
                    borderRadius: 999,
                    backgroundColor:
                      isPropResizerHovered || isPropResizerDragging ? "var(--ms-brand, #0891b2)" : "transparent",
                    boxShadow:
                      isPropResizerHovered || isPropResizerDragging
                        ? "0 0 6px color-mix(in srgb, var(--ms-brand, #0891b2) 50%, transparent)"
                        : "none",
                    opacity: isPropResizerHovered || isPropResizerDragging ? 1 : 0,
                    transition: "opacity 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease",
                    pointerEvents: "none",
                  }}
                />
              </div>
              <PropertiesWidget
                properties={selectedComponentProperties}
                isLoading={isPropertiesLoading}
                width={propertiesWidth}
                translations={translations}
                onClose={() => handleSelectComponent(null)}
                onNameChange={async (newName) => {
                  if (!selectedComponent) return;
                  const oldName = selectedComponent;
                  if (expectedComponentNameRef) expectedComponentNameRef.current = newName;
                  setSelectedComponent(newName);
                  enqueueDiagramAction({ type: "updateName", oldName, newName });
                }}
                onDescriptionChange={async (newDescription) => {
                  if (!selectedComponent) return;
                  enqueueDiagramAction({
                    type: "updateDescription",
                    name: selectedComponent,
                    description: newDescription,
                  });
                }}
                onParameterChange={async (name, value) => {
                  if (!selectedComponent) return;
                  let effectiveValue = value;
                  const declaredType = (selectedComponentProperties as any)?.declaredType;
                  if (declaredType && Array.isArray(declaredType.elements)) {
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
        {showCadView && !showAnalysisView && (
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
        )}

        {/* Simulation Results and Cosimulation Pane */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            paddingTop: hideCenterFloatingToolbar ? 0 : 56,
            display: showResultsView && !showAnalysisView ? "flex" : "none",
            flexDirection: "column",
            overflow: "hidden",
            minHeight: 0,
            zIndex: showResultsView && !showAnalysisView ? 2 : 0,
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
                    new CustomEvent("morsel:toggle-simulation-variable", {
                      detail: { participantId, variable: candidate },
                    }),
                  );
                }
                setShowResultsView(true);
                setShowCadView(false);
                setShowAnalysisView(false);
              }}
              sessions={recordedSessions}
              sessionId={selectedTreeClassName ? `live-${dialect}-${selectedTreeClassName}` : `live-${dialect}-default`}
            />
          )}
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
            paddingTop: hideCenterFloatingToolbar ? 0 : nestedModels.length > 1 ? 96 : 64,
            display: showAnalysisView ? "flex" : "none",
            flexDirection: "column",
            overflow: "hidden",
            minHeight: 0,
            zIndex: showAnalysisView ? 2 : 0,
            backgroundColor: "var(--color-canvas-default)",
          }}
        >
          <PolyglotDomainPanel
            dialect={dialect}
            code={editorValue}
            colorMode={colorMode}
            onRevealLine={onRevealLine}
            onCodeChange={(nextCode) => {
              const targetEditor = editorRef.current ?? editor;
              if (targetEditor && targetEditor.getValue() !== nextCode) {
                targetEditor.setValue(nextCode);
              }
            }}
          />
        </div>
      </div>
    </div>
  );
};
