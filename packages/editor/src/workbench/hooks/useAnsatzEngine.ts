// SPDX-License-Identifier: AGPL-3.0-or-later

import { type AmplSolveResultData } from "@modelscript/ampl/ui/AmplOptimizationResults";
import { type CadDynamicProperty, type GdtOverlayPayload } from "@modelscript/cad";
import { type CadComponent } from "@modelscript/cad-viewer";
import { AnimationController } from "@modelscript/cad-viewer/animation-controller";
import { extractCadComponents, parseSourceCadVariables } from "@modelscript/cad-viewer/parse-cad-annotations";
import { extractThreeMfCadComponents } from "@modelscript/three-mf/cad";
import { extractUsdCadComponents } from "@modelscript/usd/cad";
import type { editor } from "monaco-editor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditorModelingPreferences as useModelingPreferences } from "../../host";
import { extractParametersFromCode } from "../../internal/modelica-params";
import { type HistorianSession } from "../CosimPanel";
import type { MobileTab } from "../panels/AnsatzMobileTabBar";
import type { AnsatzView } from "../panels/types";
import { type ExperimentOverrides, type ParameterInfo, type SweepState } from "../SimulationParameters";
import { getInitialSnapshot } from "../util/initial-snapshot-store";
import {
  compileStepFromSourcesInAnsatz,
  executeLspAction,
  extractPrimaryModelicaClassName,
  getCadComponents,
  getStepMeshesInAnsatz,
  onSimulationProgress,
  simulate,
} from "../util/lsp-bridge";
import { getAnsatzMqttClient } from "../util/mqtt-client";
import {
  buildAnsatzEffectiveFileMap,
  compileAnsatzOptionAAssembly,
  type CachedAnsatzStepCompilation,
} from "../util/step-pairing";
import { useMqttSimulation } from "../util/use-mqtt-simulation";
import {
  attachScadKinematicController,
  extractExperimentFromCode,
  hasModelicaClassDeclaration,
} from "./engine-helpers";
import {
  buildBinaryStlBuffer,
  buildGlbDataUri,
  buildVtkXmlBuffer,
  extractStepFilename,
  isStepSource,
  tessellateStepSource,
} from "./step-tessellation";
import { useCadWriteback } from "./useCadWriteback";

export {
  buildBinaryStlBuffer,
  buildGlbDataUri,
  buildVtkXmlBuffer,
  extractExperimentFromCode,
  extractStepFilename,
  isStepSource,
  tessellateStepSource,
};

export interface SimulationStatusState {
  status: "pending" | "processing" | "completed" | "failed" | "running" | "error" | "idle";
  error?: string | null | undefined;
  progress?: number | undefined;
  message?: string | undefined;
  jobId?: string | undefined;
}

export interface ExperimentMetaState {
  StartTime: number;
  StopTime: number;
  Tolerance: number;
  Interval: number;
  startTime: number;
  stopTime: number;
  tolerance: number;
  interval: number;
  numberOfIntervals: number;
  solver: string;
  flattenerBackend: string;
  diagramAutoLayout: boolean;
  enableExperimentalFeatures: boolean;
}

export interface CachedSimulatorState {
  experiment: ExperimentMetaState;
  dae: {
    experiment: ExperimentMetaState;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface UseAnsatzEngineProps {
  dialect?: string | undefined;
  documentUri: string;
  selectedTreeClassName: string | null;
  contextVersion: number;
  content: string;
  editor: editor.ICodeEditor | null;
  showResultsView: boolean;
  setShowResultsView: (v: boolean) => void;
  showCadView?: boolean | undefined;
  isNarrow: boolean;
  setMobileTab: (tab: MobileTab) => void;
  setTreeVisible: (v: boolean) => void;
  setView: (v: AnsatzView) => void;
  viewDiagramEnum: AnsatzView;
  initialSimulationVariables?: string[] | undefined;
  initialStartTime?: number | undefined;
  initialStopTime?: number | undefined;
  projectFiles?: Record<string, string> | undefined;
  activeFileName?: string | undefined;
  onUpdateProjectFile?: ((fileName: string, content: string) => void) | undefined;
  /** Optional non-destructive OpenSCAD source with feature-tree modifiers (`*`, `!`, `#`) applied. */
  scadOverrideCode?: string | undefined;
}

export function useAnsatzEngine({
  dialect = "modelica",
  documentUri,
  selectedTreeClassName,
  contextVersion,
  content,
  editor,
  showResultsView,
  setShowResultsView,
  showCadView = false,
  isNarrow,
  setMobileTab,
  setTreeVisible,
  setView,
  viewDiagramEnum,
  initialSimulationVariables,
  initialStartTime,
  initialStopTime,
  projectFiles,
  activeFileName,
  onUpdateProjectFile,
  scadOverrideCode,
}: UseAnsatzEngineProps) {
  const { preferences: modelingPrefs } = useModelingPreferences();
  const prefStopTime = typeof modelingPrefs.defaultStopTime === "number" ? modelingPrefs.defaultStopTime : 10;
  const prefIntervals =
    typeof modelingPrefs.defaultNumberOfIntervals === "number" ? modelingPrefs.defaultNumberOfIntervals : 500;
  const prefTolerance =
    typeof modelingPrefs.solverTolerance === "number"
      ? modelingPrefs.solverTolerance
      : typeof modelingPrefs.defaultRelativeTolerance === "number"
        ? modelingPrefs.defaultRelativeTolerance
        : 1e-4;
  const prefSolver = typeof modelingPrefs.defaultSolver === "string" ? modelingPrefs.defaultSolver : "cvode";
  const rawFlattenerBackend = modelingPrefs.flattenerBackend;
  const prefFlattenerBackend: "wasm" | "hybrid" | "ts" | "diff" =
    rawFlattenerBackend === "wasm" ||
    rawFlattenerBackend === "hybrid" ||
    rawFlattenerBackend === "ts" ||
    rawFlattenerBackend === "diff"
      ? rawFlattenerBackend
      : "hybrid";
  const prefDiagramAutoLayout =
    typeof modelingPrefs.diagramAutoLayout === "boolean" ? modelingPrefs.diagramAutoLayout : true;
  const prefExperimentalFeatures =
    typeof modelingPrefs.enableExperimentalFeatures === "boolean" ? modelingPrefs.enableExperimentalFeatures : false;

  // ── Live Editor Value Tracking ──
  const [editorValue, setEditorValue] = useState<string>(content);
  const [amplSolveResult, setAmplSolveResult] = useState<AmplSolveResultData | null>(null);
  useEffect(() => {
    setAmplSolveResult(null);
  }, [dialect, documentUri]);
  useEffect(() => {
    setEditorValue(content || editor?.getValue() || "");
  }, [content, editor, contextVersion]);

  useEffect(() => {
    if (!editor) return;
    setEditorValue(editor.getValue());
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const disposable = editor.onDidChangeModelContent(() => {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        setEditorValue(editor.getValue());
      }, 250);
    });
    return () => {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      disposable.dispose();
    };
  }, [editor]);

  const buildExperimentMeta = useCallback(
    (rawExp?: Record<string, unknown> | null): ExperimentMetaState => {
      const parsedFromSource = extractExperimentFromCode(editorValue);
      const startTime = Number(
        rawExp?.startTime ??
          rawExp?.StartTime ??
          (rawExp ? undefined : initialStartTime) ??
          parsedFromSource?.startTime ??
          0,
      );
      const stopTime = Number(
        rawExp?.stopTime ??
          rawExp?.StopTime ??
          (rawExp ? undefined : initialStopTime) ??
          parsedFromSource?.stopTime ??
          prefStopTime,
      );
      const numberOfIntervals = Number(
        rawExp?.numberOfIntervals ?? rawExp?.NumberOfIntervals ?? parsedFromSource?.numberOfIntervals ?? prefIntervals,
      );
      const interval = Number(
        rawExp?.interval ??
          rawExp?.Interval ??
          parsedFromSource?.interval ??
          (stopTime - startTime) / Math.max(1, numberOfIntervals),
      );
      const tolerance = Number(rawExp?.tolerance ?? rawExp?.Tolerance ?? parsedFromSource?.tolerance ?? prefTolerance);
      const solver = String(rawExp?.solver ?? rawExp?.Solver ?? parsedFromSource?.solver ?? prefSolver);
      return {
        StartTime: startTime,
        StopTime: stopTime,
        Tolerance: tolerance,
        Interval: interval,
        startTime,
        stopTime,
        tolerance,
        interval,
        numberOfIntervals,
        solver,
        flattenerBackend: prefFlattenerBackend,
        diagramAutoLayout: prefDiagramAutoLayout,
        enableExperimentalFeatures: prefExperimentalFeatures,
      };
    },
    [
      editorValue,
      initialStartTime,
      initialStopTime,
      prefStopTime,
      prefIntervals,
      prefTolerance,
      prefSolver,
      prefFlattenerBackend,
      prefDiagramAutoLayout,
      prefExperimentalFeatures,
    ],
  );

  // ── Simulation State ──
  const userSelectionMadeRef = useRef<boolean>(false);
  const [simulationVariables, setSimulationVariables] = useState<string[]>([]);
  const [selectedSimulationVariables, setSelectedSimulationVariables] = useState<string[]>(
    () => initialSimulationVariables ?? [],
  );

  useEffect(() => {
    if (!userSelectionMadeRef.current && initialSimulationVariables && initialSimulationVariables.length > 0) {
      setSelectedSimulationVariables(initialSimulationVariables);
    }
  }, [initialSimulationVariables]);

  const [simulationParameters, setSimulationParameters] = useState<ParameterInfo[]>([]);
  const [parameterOverrides, setParameterOverrides] = useState<Map<string, number>>(new Map());
  const [sweepState, setSweepState] = useState<SweepState | null>(null);
  const [sweepResults, setSweepResults] = useState<{ value: number; y: number[][] }[] | null>(null);
  const [simExperiment, setSimExperiment] = useState(() => buildExperimentMeta(null));
  const [experimentOverrides, setExperimentOverrides] = useState<ExperimentOverrides>(() => ({
    equidistant: true,
    ...(initialStartTime !== undefined ? { startTime: initialStartTime } : {}),
    ...(initialStopTime !== undefined ? { stopTime: initialStopTime } : {}),
  }));

  useEffect(() => {
    if (initialStartTime !== undefined || initialStopTime !== undefined) {
      setExperimentOverrides((prev) => ({
        ...prev,
        ...(initialStartTime !== undefined ? { startTime: initialStartTime } : {}),
        ...(initialStopTime !== undefined ? { stopTime: initialStopTime } : {}),
      }));
    }
  }, [initialStartTime, initialStopTime]);

  const [cachedSimulator, setCachedSimulator] = useState<CachedSimulatorState>(() => {
    const initialExp = buildExperimentMeta(null);
    return { experiment: initialExp, dae: { experiment: initialExp } };
  });
  const [simulationStatus, setSimulationStatus] = useState<SimulationStatusState | null>(null);
  const [localSimulationData, setLocalSimulationData] = useState<Record<string, number | string>[] | null>(null);
  const [pscadComplianceReport, setPscadComplianceReport] = useState<unknown>(null);
  const [pscadExports, setPscadExports] = useState<Awaited<ReturnType<typeof simulate>>["pscadExports"] | null>(null);

  // Keep simExperiment & cachedSimulator synced with source @experiment(...) annotations and user preferences
  useEffect(() => {
    const nextExp = buildExperimentMeta(null);
    const sameExperiment = (a: typeof nextExp | null | undefined, b: typeof nextExp) =>
      Boolean(a) &&
      a?.startTime === b.startTime &&
      a?.stopTime === b.stopTime &&
      a?.numberOfIntervals === b.numberOfIntervals &&
      a?.interval === b.interval &&
      a?.tolerance === b.tolerance &&
      a?.solver === b.solver;
    setSimExperiment((prev) => (sameExperiment(prev, nextExp) ? prev : nextExp));
    setCachedSimulator((prev) => {
      if (sameExperiment(prev?.experiment, nextExp)) {
        return prev;
      }
      return {
        ...(prev ?? {}),
        experiment: nextExp,
        dae: {
          ...(prev?.dae ?? {}),
          experiment: nextExp,
        },
      };
    });
  }, [buildExperimentMeta]);

  // ── CAD & 3D Animation State ──
  const [cadComponents, setCadComponents] = useState<CadComponent[]>(() => {
    if (!content) return [];
    if (dialect === "usd") return extractUsdCadComponents(content) as CadComponent[];
    if (dialect === "three-mf") return extractThreeMfCadComponents(content) as CadComponent[];
    return extractCadComponents(parseSourceCadVariables(content));
  });
  const [gdtOverlay, setGdtOverlay] = useState<GdtOverlayPayload | null>(null);
  const lastCompiledStepRef = useRef<CachedAnsatzStepCompilation | null>(null);
  const lastScadCadSigRef = useRef<string | null>(null);
  const lastNonScadCadSigRef = useRef<string | null>(null);
  const [vtkBuffer, setVtkBuffer] = useState<Uint8Array | null>(null);
  const animationControllerRef = useRef<AnimationController | null>(null);
  const lastSimTrajectoryRef = useRef<{ t: number[]; y: number[][]; states: string[] } | null>(null);
  const [animationMode, setAnimationMode] = useState<"stopped" | "playing" | "paused" | "live">("stopped");
  const [cosimDataSource, setCosimDataSource] = useState<"local" | "mqtt-live" | "historian-replay">("local");
  const mqttSessionId = selectedTreeClassName ? `live-${dialect}-${selectedTreeClassName}` : `live-${dialect}-default`;
  const mqtt = useMqttSimulation({ source: cosimDataSource, sessionId: mqttSessionId });

  // ── Ribbon Parameters ──
  const ribbonParams = useMemo(() => {
    if (simulationParameters.length > 0) return simulationParameters;
    return extractParametersFromCode(editorValue);
  }, [simulationParameters, editorValue]);

  const handleRibbonParamChange = useCallback((name: string, value: number) => {
    setParameterOverrides((prev) => {
      const next = new Map(prev);
      next.set(name, value);
      return next;
    });
  }, []);

  const handleRibbonParamReset = useCallback((name: string) => {
    setParameterOverrides((prev) => {
      const next = new Map(prev);
      next.delete(name);
      return next;
    });
  }, []);

  const handleParameterChange = (name: string, value: number) => {
    setParameterOverrides((prev) => {
      const next = new Map(prev);
      next.set(name, value);
      return next;
    });
  };

  const handleParameterReset = (name: string) => {
    setParameterOverrides((prev) => {
      const next = new Map(prev);
      next.delete(name);
      return next;
    });
  };

  const handleExperimentOverrideChange = <K extends keyof ExperimentOverrides>(
    name: K,
    value: ExperimentOverrides[K],
  ) => {
    setExperimentOverrides((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleExperimentOverrideReset = (name: keyof ExperimentOverrides) => {
    setExperimentOverrides((prev) => {
      const { [name]: _omitted, ...rest } = prev;
      return rest;
    });
  };

  const setUserSelectedSimulationVariables = useCallback((action: React.SetStateAction<string[]>) => {
    userSelectionMadeRef.current = true;
    setSelectedSimulationVariables(action);
  }, []);

  const handleToggleSimulationVariable = useCallback((variable: string) => {
    userSelectionMadeRef.current = true;
    setSelectedSimulationVariables((prev) =>
      prev.includes(variable) ? prev.filter((v) => v !== variable) : [...prev, variable],
    );
  }, []);

  const handleVariablesLoaded = useCallback((variables: string[]) => {
    setSimulationVariables((prev) =>
      prev.length === variables.length && prev.every((v, i) => v === variables[i]) ? prev : variables,
    );
    setSelectedSimulationVariables((prev) => {
      if (prev.length > 0 || userSelectionMadeRef.current || variables.length === 0) return prev;
      return variables.slice(0, 3);
    });
  }, []);

  // Listen for variable selection events from CosimPanel in AnsatzVisualizerPane
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onCosimVariableToggle = (e: Event) => {
      const detail = (e as CustomEvent<{ participantId?: string; variable?: string }>).detail;
      const variable = detail?.variable;
      if (!variable) return;
      userSelectionMadeRef.current = true;
      setSimulationVariables((prev) => (prev.includes(variable) ? prev : [...prev, variable]));
      setSelectedSimulationVariables((prev) =>
        prev.includes(variable) ? prev.filter((v) => v !== variable) : [...prev, variable],
      );
      setShowResultsView(true);
    };
    window.addEventListener("ansatz:toggle-simulation-variable", onCosimVariableToggle);
    return () => window.removeEventListener("ansatz:toggle-simulation-variable", onCosimVariableToggle);
  }, [setShowResultsView]);

  // ── Live MQTT sync ──
  useEffect(() => {
    if (cosimDataSource !== "mqtt-live") return;
    const client = getAnsatzMqttClient();
    const ctrl = animationControllerRef.current;
    if (ctrl) {
      ctrl.goLive();
    }
    const unsub = client.onVariableUpdate((participantId, variable, value) => {
      const now = Date.now() / 1000;
      const controller = animationControllerRef.current;
      if (controller) {
        if (controller.mode !== "live") controller.goLive();
        controller.pushLiveValue(variable, value, now);
        controller.pushLiveValue(`${participantId}.${variable}`, value, now);
      }
      setLocalSimulationData((prev) => {
        const last = prev && prev.length > 0 ? prev[prev.length - 1] : {};
        const row: Record<string, number | string> = {
          ...last,
          time: now,
          [variable]: value,
          [`${participantId}.${variable}`]: value,
        };
        const next = prev ? [...prev, row] : [row];
        return next.length > 1500 ? next.slice(next.length - 1500) : next;
      });
    });
    return () => unsub();
  }, [cosimDataSource]);

  // ── Historian Session Replay ──
  const handleReplaySession = useCallback(
    (session: HistorianSession, speed: number) => {
      let controller = animationControllerRef.current;
      if (!controller) {
        controller = new AnimationController();
        controller.onStateChange((s) => setAnimationMode(s.mode));
        animationControllerRef.current = controller;
      }

      const sessionExt = session as HistorianSession & {
        chartData?: Record<string, number>[];
        rows?: Record<string, number>[];
      };
      const rawRows: Record<string, number>[] =
        sessionExt.chartData ?? sessionExt.rows ?? (localSimulationData as Record<string, number>[] | null) ?? [];

      if (!rawRows || rawRows.length === 0) {
        return;
      }

      const t = rawRows.map((r, i) => (typeof r["time"] === "number" ? r["time"] : Number(r["time"]) || i * 0.1));
      const stateNames = Object.keys(rawRows[0] ?? {}).filter((k) => k !== "time");
      if (stateNames.length === 0) return;

      const y: number[][] = rawRows.map((row) => stateNames.map((name) => Number(row[name]) || 0));

      controller.loadTimeseries(t, y, stateNames);
      controller.setSpeed(speed);
      controller.play();

      setLocalSimulationData(rawRows);
      setSimulationStatus({ status: "completed", error: null });
    },
    [localSimulationData],
  );

  const {
    handleSaveCadBindings,
    handleCommitCadGizmoDelta,
    handleCommitCadDimensionDelta,
    handleCommitCadFaceTag,
    handleCommitCadAssemblyJoint,
  } = useCadWriteback({
    editor,
    editorValue,
    documentUri,
    dialect,
    setCadComponents,
  });

  // ── Fetch CAD annotations or tessellate direct STEP / OpenSCAD 3D geometry ──
  useEffect(() => {
    if (!showCadView && dialect !== "step" && dialect !== "scad" && dialect !== "qif" && dialect !== "three-mf") return;
    let cancelled = false;

    const runClassicCad = () => {
      const stepFileDirective = extractStepFilename(editorValue);
      if (stepFileDirective && !selectedTreeClassName) {
        const { components: stepComps } = tessellateStepSource(editorValue);
        setVtkBuffer(null);
        setCadComponents(stepComps);
        return;
      }

      setVtkBuffer(null);

      if (!selectedTreeClassName) {
        const fallback = extractCadComponents(parseSourceCadVariables(editorValue));
        setCadComponents(fallback);
        return;
      }

      getCadComponents(documentUri, selectedTreeClassName)
        .then((components) => {
          if (cancelled) return;
          let parsed: CadComponent[] =
            Array.isArray(components) && components.length > 0
              ? extractCadComponents(components as unknown as Parameters<typeof extractCadComponents>[0])
              : [];
          if (!parsed || parsed.length === 0) {
            const sourceVars = parseSourceCadVariables(editorValue);
            parsed = extractCadComponents(sourceVars);
          }
          if ((!parsed || parsed.length === 0) && stepFileDirective) {
            const { components: stepComps } = tessellateStepSource(editorValue);
            setVtkBuffer(null);
            parsed = stepComps;
          }
          setCadComponents(parsed);

          let ctrl = animationControllerRef.current;
          if (!ctrl && parsed.length > 0) {
            ctrl = new AnimationController();
            ctrl.onStateChange((s) => setAnimationMode(s.mode));
            animationControllerRef.current = ctrl;
          }

          if (ctrl && parsed.length > 0) {
            ctrl.setBindings(
              parsed
                .filter((c) => c.dynamicBindings && c.dynamicBindings.length > 0)
                .map((c) => ({
                  componentName: c.name,
                  bindings: c.dynamicBindings!.map((b) => {
                    const ext = b as {
                      property: string;
                      index?: number;
                      variable: string;
                      unit?: string;
                      scaleFactor?: number;
                      scale?: number;
                    };
                    return {
                      property: ext.property as CadDynamicProperty,
                      index: ext.index,
                      variable: ext.variable,
                      unit: ext.unit,
                      scaleFactor: ext.scaleFactor ?? ext.scale,
                    };
                  }),
                })),
            );
            for (const comp of parsed) {
              const cadObj: {
                position?: [number, number, number];
                rotation?: [number, number, number];
                scale?: [number, number, number];
              } = typeof comp.cad === "object" && comp.cad ? comp.cad : {};
              ctrl.setDefault(comp.name, {
                position: cadObj.position ?? [0, 0, 0],
                rotation: cadObj.rotation ?? [0, 0, 0],
                scale: cadObj.scale ?? [1, 1, 1],
                ...(comp.defaults ?? {}),
              });
            }
            if (lastSimTrajectoryRef.current && !ctrl.hasData) {
              ctrl.loadTimeseries(
                lastSimTrajectoryRef.current.t,
                lastSimTrajectoryRef.current.y,
                lastSimTrajectoryRef.current.states,
              );
              if (parsed.some((c) => c.dynamicBindings && c.dynamicBindings.length > 0)) {
                ctrl.play();
              }
            }
          }
        })
        .catch((e: unknown) => {
          if (!cancelled) console.error("Failed to fetch CAD components:", e);
        });
    };

    const isStepText = isStepSource(editorValue, dialect);
    const { files: effectiveFiles, activePath } = buildAnsatzEffectiveFileMap(
      projectFiles,
      activeFileName,
      documentUri,
      dialect,
      editorValue,
    );

    const runScadLspFallback = (clearOnEmpty = false, onSettled?: () => void, sourceOverride?: string) => {
      const targetSource = sourceOverride ?? editorValue;
      getCadComponents(documentUri, undefined, targetSource)
        .then((components) => {
          if (cancelled) return;
          if (!Array.isArray(components) || components.length === 0) {
            if (clearOnEmpty) {
              setVtkBuffer(null);
              setCadComponents([]);
            }
            onSettled?.();
            return;
          }
          const mapped: CadComponent[] = components.map((c, idx: number) => {
            const cadObj =
              typeof c.cad === "object" && c.cad
                ? c.cad
                : { uri: typeof c.cad === "string" ? c.cad : `scad://part_${idx}` };
            return {
              name: c.name || `part_${idx + 1}`,
              cad: cadObj,
              proceduralMesh: c.proceduralMesh,
              ports: Array.isArray(c.ports) ? (c.ports as CadComponent["ports"]) : [],
              dynamicBindings: Array.isArray(c.dynamicBindings) ? c.dynamicBindings : [],
              defaults: c.defaults,
              shapeType: c.shapeType,
              sourceMetadata: c.sourceMetadata as CadComponent["sourceMetadata"],
            };
          });
          setVtkBuffer(null);
          setCadComponents(
            attachScadKinematicController(targetSource, mapped, animationControllerRef, setAnimationMode),
          );
          onSettled?.();
        })
        .catch(() => {
          if (cancelled) return;
          onSettled?.();
        });
    };

    if (dialect === "scad") {
      lastNonScadCadSigRef.current = null;
      if (!editorValue.trim()) {
        lastScadCadSigRef.current = null;
        return;
      }
      const pairedNonScadPaths = Object.keys(effectiveFiles)
        .filter((p) => p !== activePath && /\.(qif|step|stp|p21|mo)$/i.test(p))
        .sort();
      const hasPairedNonScadArtifacts = pairedNonScadPaths.length > 0;
      const pairedSig = pairedNonScadPaths
        .map((p) => {
          const val = effectiveFiles[p] ?? "";
          // Ignore writebacks of our own compiled STEP artifact to avoid re-triggering compilation
          if (/\.(step|stp|p21)$/i.test(p) && lastCompiledStepRef.current?.result.stepText === val) {
            return `${p}:<compiled>`;
          }
          return `${p}:${val.length}:${val.slice(0, 64)}`;
        })
        .join("\0");
      const effectiveScadCode = scadOverrideCode ?? editorValue;
      const hasFeatureOverride = Boolean(scadOverrideCode && scadOverrideCode !== editorValue);
      const scadSig = `${documentUri}\0${effectiveScadCode}\0${pairedSig}\0${hasFeatureOverride ? "ov" : "base"}`;
      if (lastScadCadSigRef.current === scadSig) {
        return;
      }
      const wasFeatureOverride = Boolean(lastScadCadSigRef.current?.endsWith("\0ov"));
      const markScadSettled = () => {
        if (!cancelled) {
          lastScadCadSigRef.current = scadSig;
        }
      };

      if (hasFeatureOverride) {
        setGdtOverlay(null);
        runScadLspFallback(true, markScadSettled, effectiveScadCode);
        return;
      }

      const isInitialScadRender = lastScadCadSigRef.current === null || wasFeatureOverride;
      const debounceMs = isInitialScadRender ? 0 : 450;

      const timerId = setTimeout(() => {
        if (cancelled) return;

        if (!hasPairedNonScadArtifacts) {
          setGdtOverlay(null);
          runScadLspFallback(false, markScadSettled, editorValue);
          return;
        }

        void compileAnsatzOptionAAssembly({
          files: effectiveFiles,
          activePath,
          dialect,
          documentUri,
          isStepText: false,
          cachedCompilation: lastCompiledStepRef.current,
          compileStepFromSources: compileStepFromSourcesInAnsatz,
          getStepMeshes: getStepMeshesInAnsatz,
        })
          .then((outcome) => {
            if (cancelled) return;
            if (outcome) {
              if (outcome.cachedCompilation) {
                lastCompiledStepRef.current = outcome.cachedCompilation;
              }
              setGdtOverlay(outcome.gdtOverlay);
              if (outcome.updatedStepArtifact && outcome.stepPath && outcome.stepText !== undefined) {
                onUpdateProjectFile?.(outcome.stepPath, outcome.stepText);
              }
              if (outcome.components.length > 0) {
                const scadCode =
                  (outcome.pairing?.scadPath ? effectiveFiles[outcome.pairing.scadPath] : undefined) ?? editorValue;
                setVtkBuffer(null);
                setCadComponents(
                  attachScadKinematicController(
                    scadCode,
                    outcome.components,
                    animationControllerRef,
                    setAnimationMode,
                    outcome.spools,
                    outcome.telemetry,
                  ),
                );
                markScadSettled();
                return;
              }
            } else {
              setGdtOverlay(null);
            }
            runScadLspFallback(true, markScadSettled);
          })
          .catch(() => {
            if (cancelled) return;
            setGdtOverlay(null);
            runScadLspFallback(true, markScadSettled);
          });
      }, debounceMs);

      return () => {
        cancelled = true;
        clearTimeout(timerId);
      };
    }

    lastScadCadSigRef.current = null;

    const pairedCadPaths = Object.keys(effectiveFiles)
      .filter((p) => p !== activePath && /\.(scad|qif|step|stp|p21|mo)$/i.test(p))
      .sort();
    const pairedNonScadSig = pairedCadPaths
      .map((p) => {
        const val = effectiveFiles[p] ?? "";
        if (/\.(step|stp|p21)$/i.test(p) && lastCompiledStepRef.current?.result.stepText === val) {
          return `${p}:<compiled>`;
        }
        return `${p}:${val.length}:${val.slice(0, 64)}`;
      })
      .join("\0");
    const nonScadSig = `${documentUri}\0${dialect}\0${selectedTreeClassName ?? ""}\0${activePath}\0${editorValue}\0${pairedNonScadSig}`;
    if (lastNonScadCadSigRef.current === nonScadSig) {
      return;
    }
    lastNonScadCadSigRef.current = nonScadSig;

    if (isStepText) {
      const { components: stepComps } = tessellateStepSource(editorValue);
      setVtkBuffer(null);
      setCadComponents(stepComps);
    } else if (dialect === "usd") {
      const usdComps = extractUsdCadComponents(editorValue) as CadComponent[];
      setGdtOverlay(null);
      setVtkBuffer(null);
      setCadComponents(usdComps);
      return;
    } else if (dialect === "three-mf") {
      const threeMfComps = extractThreeMfCadComponents(editorValue) as CadComponent[];
      setGdtOverlay(null);
      setVtkBuffer(null);
      setCadComponents(threeMfComps);
      return;
    }

    const hasPairedCadArtifacts = Object.keys(effectiveFiles).some((p) => /\.(scad|qif|step|stp|p21)$/i.test(p));
    const shouldTryOptionA = dialect === "qif" || isStepText || hasPairedCadArtifacts;

    if (!shouldTryOptionA) {
      setGdtOverlay(null);
      runClassicCad();
    } else {
      void compileAnsatzOptionAAssembly({
        files: effectiveFiles,
        activePath,
        dialect,
        documentUri,
        isStepText,
        cachedCompilation: lastCompiledStepRef.current,
        compileStepFromSources: compileStepFromSourcesInAnsatz,
        getStepMeshes: getStepMeshesInAnsatz,
      })
        .then((outcome) => {
          if (cancelled) return;
          if (outcome) {
            if (outcome.cachedCompilation) {
              lastCompiledStepRef.current = outcome.cachedCompilation;
            }
            setGdtOverlay(outcome.gdtOverlay);
            if (outcome.updatedStepArtifact && outcome.stepPath && outcome.stepText !== undefined) {
              onUpdateProjectFile?.(outcome.stepPath, outcome.stepText);
            }
            if (outcome.components.length > 0) {
              const scadCode = (outcome.pairing?.scadPath ? effectiveFiles[outcome.pairing.scadPath] : undefined) ?? "";
              setVtkBuffer(null);
              setCadComponents(
                attachScadKinematicController(
                  scadCode,
                  outcome.components,
                  animationControllerRef,
                  setAnimationMode,
                  outcome.spools,
                  outcome.telemetry,
                ),
              );
              return;
            }
            if (isStepText || dialect === "qif") {
              return;
            }
          } else {
            setGdtOverlay(null);
          }

          if (!isStepText && dialect !== "qif") {
            runClassicCad();
          }
        })
        .catch(() => {
          if (cancelled) return;
          setGdtOverlay(null);
          if (!isStepText && dialect !== "qif") {
            runClassicCad();
          }
        });
    }

    return () => {
      cancelled = true;
    };
  }, [
    selectedTreeClassName,
    contextVersion,
    editorValue,
    dialect,
    documentUri,
    projectFiles,
    activeFileName,
    onUpdateProjectFile,
    showCadView,
    scadOverrideCode,
  ]);

  // ── Live MQTT data bridge ──
  useEffect(() => {
    const ctrl = animationControllerRef.current;
    if (!ctrl || cosimDataSource !== "mqtt-live") {
      if (ctrl && ctrl.mode === "live") {
        ctrl.stop();
      }
      return;
    }

    if (ctrl.mode !== "live") {
      ctrl.goLive();
    }

    if (mqtt.latestValues.size > 0) {
      ctrl.pushLiveBatch(mqtt.latestValues, Date.now() / 1000);
    }
  }, [mqtt.latestValues, cosimDataSource]);

  // ── Lightweight re-simulate when parameter overrides change ──
  useEffect(() => {
    const targetClass = selectedTreeClassName || extractPrimaryModelicaClassName(editorValue || content) || undefined;
    if ((!showResultsView && !showCadView) || parameterOverrides.size === 0 || !targetClass) return;

    const timer = setTimeout(async () => {
      try {
        const overrideObj = Object.fromEntries(parameterOverrides);
        const loadedSnap = getInitialSnapshot();
        const result = await simulate(documentUri, {
          className: targetClass,
          parameterOverrides: overrideObj,
          sweepConfig: sweepState ?? undefined,
          startTime: experimentOverrides.startTime ?? simExperiment.startTime,
          stopTime: experimentOverrides.stopTime ?? simExperiment.stopTime,
          interval: experimentOverrides.interval ?? simExperiment.interval,
          solver: experimentOverrides.solver ?? simExperiment.solver ?? prefSolver,
          numberOfIntervals: experimentOverrides.numberOfIntervals ?? simExperiment.numberOfIntervals ?? prefIntervals,
          rtol: experimentOverrides.tolerance ?? simExperiment.tolerance ?? prefTolerance,
          atol: experimentOverrides.atol,
          equidistant: experimentOverrides.equidistant,
          steadyStateOnly: experimentOverrides.steadyStateOnly,
          flattenerBackend: prefFlattenerBackend,
          ...(loadedSnap ? { initialSnapshot: loadedSnap } : {}),
        });

        if (!result) return;
        if (result.error) throw new Error(result.error);

        if (result.experiment) {
          const updatedExp = buildExperimentMeta(result.experiment as Record<string, unknown>);
          setSimExperiment(updatedExp);
          setCachedSimulator((prev) => ({
            ...(prev ?? {}),
            experiment: updatedExp,
            dae: {
              ...(prev?.dae ?? {}),
              experiment: updatedExp,
            },
          }));
        }

        const states = result.states ?? [];
        if (result.sweepResults) {
          setSweepResults(result.sweepResults);
          setLocalSimulationData(
            result.t.map((t: number, i: number) => {
              const rowObj: Record<string, number | string> = { time: t };
              result.sweepResults!.forEach((sweep) => {
                states.forEach((state: string, vIndex: number) => {
                  rowObj[`${state} (${sweep.value})`] = sweep.y[i]?.[vIndex] ?? 0;
                });
              });
              states.forEach((state: string, vIndex: number) => {
                rowObj[state] = result.sweepResults![0]?.y[i]?.[vIndex] ?? 0;
              });
              return rowObj;
            }),
          );
          lastSimTrajectoryRef.current = {
            t: result.t,
            y: result.sweepResults[0]?.y ?? result.y ?? [],
            states,
          };
          if (animationControllerRef.current && cadComponents.length > 0) {
            animationControllerRef.current.loadTimeseries(
              result.t,
              result.sweepResults[0]?.y ?? result.y ?? [],
              states,
            );
          }
        } else {
          setSweepResults(null);
          const chartData = result.t.map((t: number, i: number) => {
            const row: Record<string, number | string> = { time: t };
            states.forEach((state: string, vIndex: number) => {
              row[state] = result.y[i]?.[vIndex] ?? 0;
            });
            return row;
          });
          setLocalSimulationData(chartData);
          lastSimTrajectoryRef.current = { t: result.t, y: result.y, states };
          if (animationControllerRef.current && cadComponents.length > 0) {
            animationControllerRef.current.loadTimeseries(result.t, result.y, states);
          }
        }
        setSimulationStatus({ status: "completed", error: null });
      } catch (e) {
        if ((e as Error).name === "AbortError" || (e as Error).message === "Simulation aborted") return;
        const errMsg = e instanceof Error ? e.message : String(e);
        setSimulationStatus({ status: "failed", error: errMsg });
      }
    }, 300);
    return () => {
      clearTimeout(timer);
    };
  }, [
    parameterOverrides,
    sweepState,
    showResultsView,
    showCadView,
    cadComponents.length,
    experimentOverrides,
    simExperiment,
    prefSolver,
    prefIntervals,
    prefTolerance,
    prefFlattenerBackend,
    buildExperimentMeta,
    selectedTreeClassName,
    documentUri,
    editorValue,
    content,
  ]);

  // ── Full Simulation Execution ──
  const handleSimulateImpl = async () => {
    setSimulationStatus({ status: "pending", error: null });
    setLocalSimulationData(null);
    setSimulationVariables([]);
    setSelectedSimulationVariables([]);
    setPscadComplianceReport(null);
    setPscadExports(null);

    try {
      if (dialect === "ampl") {
        const liveText = editor?.getValue() ?? editorValue ?? content;
        const effectiveFiles: Record<string, string> = {
          ...(projectFiles ?? {}),
          ...(activeFileName ? { [activeFileName]: liveText } : {}),
        };
        const companionDatText = Object.entries(effectiveFiles)
          .filter(([name]) => name.toLowerCase().endsWith(".dat"))
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([, txt]) => txt.trim())
          .filter(Boolean)
          .join("\n\n");
        const solveRes = await executeLspAction<AmplSolveResultData & { error?: string }>(
          "ampl_solve",
          "ampl",
          documentUri,
          {
            documentText: liveText,
            ...(companionDatText ? { dataText: companionDatText } : {}),
            ...(Object.keys(effectiveFiles).length > 0
              ? { projectFiles: effectiveFiles, virtualFiles: effectiveFiles }
              : {}),
            options: {
              solver: experimentOverrides.solver ?? "auto",
              tolerance: experimentOverrides.tolerance,
              maxIterations: experimentOverrides.maxIterations,
              presolve: experimentOverrides.presolve,
            },
          },
        );
        if (!solveRes) {
          throw new Error("AMPL solver returned no result.");
        }
        if (solveRes.error) {
          throw new Error(String(solveRes.error));
        }
        setAmplSolveResult(solveRes);
        setSimulationStatus({ status: "completed" });
        if (!showCadView) {
          setShowResultsView(true);
          if (isNarrow) {
            setMobileTab("results");
            setTreeVisible(false);
            setView(viewDiagramEnum);
          }
        }
        return;
      }

      const overrideObj = Object.fromEntries(parameterOverrides);
      const liveCode = editor?.getValue() ?? editorValue ?? content;
      const extractedPrimary = extractPrimaryModelicaClassName(liveCode);
      const hasSelectedInCode =
        selectedTreeClassName &&
        (selectedTreeClassName.includes(".") || hasModelicaClassDeclaration(liveCode, selectedTreeClassName));
      const targetClass = (hasSelectedInCode ? selectedTreeClassName : extractedPrimary) || undefined;

      let progressSub: { dispose: () => void } | null = null;
      if (dialect === "pscad") {
        progressSub = await onSimulationProgress((frame) => {
          if (frame.uri !== documentUri) return;
          setLocalSimulationData((prev) => {
            const row: Record<string, number | string> = { time: frame.timeSec, ...frame.voltages };
            const next = prev ? [...prev, row] : [row];
            return next.length > 2000 ? next.slice(next.length - 2000) : next;
          });
          if (!showCadView) setShowResultsView(true);
        });
      }

      const loadedSnap = getInitialSnapshot();
      let result: Awaited<ReturnType<typeof simulate>>;
      try {
        result = await simulate(documentUri, {
          className: targetClass,
          parameterOverrides: overrideObj,
          sweepConfig: sweepState ?? undefined,
          startTime: experimentOverrides.startTime ?? simExperiment.startTime,
          stopTime: experimentOverrides.stopTime ?? simExperiment.stopTime,
          interval: experimentOverrides.interval ?? simExperiment.interval,
          solver: experimentOverrides.solver ?? simExperiment.solver ?? prefSolver,
          numberOfIntervals: experimentOverrides.numberOfIntervals ?? simExperiment.numberOfIntervals ?? prefIntervals,
          rtol: experimentOverrides.tolerance ?? simExperiment.tolerance ?? prefTolerance,
          atol: experimentOverrides.atol,
          equidistant: experimentOverrides.equidistant,
          steadyStateOnly: experimentOverrides.steadyStateOnly,
          flattenerBackend: prefFlattenerBackend,
          ...(loadedSnap ? { initialSnapshot: loadedSnap } : {}),
        } as Parameters<typeof simulate>[1]);
      } finally {
        progressSub?.dispose();
      }

      if (!result) {
        throw new Error("Simulation returned no result (handler not available for this language).");
      }
      if (result.error) {
        throw new Error(result.error);
      }

      if (result.experiment) {
        const updatedExp = buildExperimentMeta(result.experiment as Record<string, unknown>);
        setSimExperiment(updatedExp);
        setCachedSimulator((prev) => ({
          ...(prev ?? {}),
          experiment: updatedExp,
          dae: {
            ...(prev?.dae ?? {}),
            experiment: updatedExp,
          },
        }));
      }

      setSimulationParameters((result.parameters as ParameterInfo[] | undefined) ?? []);

      const states = result.states ?? [];
      setSimulationVariables(states);
      setSelectedSimulationVariables((prev) => {
        // 1. If user already has active selections that exist in the newly simulated states, preserve them!
        if (prev.length > 0) {
          const matchedPrev = prev.filter((v) => states.includes(v));
          if (matchedPrev.length > 0) return matchedPrev;
        }
        // 2. If user explicitly cleared selection, preserve empty selection
        if (userSelectionMadeRef.current && prev.length === 0) {
          return prev;
        }
        // 3. Prioritize GraphFrame curves if declared in the PSCAD schematic
        const frameCurves = (result.pscadExports?.graphFrames ?? [])
          .flatMap((gf) => gf.curves)
          .filter((v, idx, arr) => states.includes(v) && arr.indexOf(v) === idx);
        if (!userSelectionMadeRef.current && frameCurves.length > 0) {
          return frameCurves;
        }
        // 4. Fall back to initialSimulationVariables if valid and user hasn't made a custom selection
        if (!userSelectionMadeRef.current && initialSimulationVariables && initialSimulationVariables.length > 0) {
          const matchedInitial = initialSimulationVariables.filter((v) => states.includes(v));
          if (matchedInitial.length > 0) return matchedInitial;
        }
        // 5. Default: first 3 non-derivative states
        const candidates = states.filter((v) => !v.startsWith("der(") && v !== "time");
        return candidates.length > 0 ? candidates.slice(0, 3) : states.slice(0, 3);
      });

      if (result.sweepResults) {
        setSweepResults(result.sweepResults);
        setLocalSimulationData(
          result.t.map((t: number, i: number) => {
            const rowObj: Record<string, number | string> = { time: t };
            result.sweepResults!.forEach((sweep) => {
              states.forEach((state: string, vIndex: number) => {
                rowObj[`${state} (${sweep.value})`] = sweep.y[i]?.[vIndex] ?? 0;
              });
            });
            states.forEach((state: string, vIndex: number) => {
              rowObj[state] = result.sweepResults![0]?.y[i]?.[vIndex] ?? 0;
            });
            return rowObj;
          }),
        );
        lastSimTrajectoryRef.current = {
          t: result.t,
          y: result.sweepResults[0]?.y ?? result.y ?? [],
          states,
        };
        if (animationControllerRef.current && cadComponents.length > 0) {
          animationControllerRef.current.loadTimeseries(result.t, result.sweepResults[0]?.y ?? result.y ?? [], states);
        }
      } else {
        setSweepResults(null);
        const chartData = result.t.map((t: number, i: number) => {
          const row: Record<string, number | string> = { time: t };
          states.forEach((state: string, vIndex: number) => {
            row[state] = result.y[i]?.[vIndex] ?? 0;
          });
          return row;
        });
        setLocalSimulationData(chartData);
        lastSimTrajectoryRef.current = { t: result.t, y: result.y, states };
      }
      setPscadComplianceReport(result.complianceReport ?? null);
      setPscadExports(result.pscadExports ?? null);
      setSimulationStatus({ status: "completed" });
      if (!showCadView) {
        setShowResultsView(true);
        if (isNarrow) {
          setMobileTab("results");
          setTreeVisible(false);
          setView(viewDiagramEnum);
        }
      }

      // ── Animation setup ──
      if (cadComponents.length > 0) {
        let controller = animationControllerRef.current;
        if (!controller) {
          controller = new AnimationController();
          controller.onStateChange((s) => setAnimationMode(s.mode));
          animationControllerRef.current = controller;
        }
        controller.setBindings(
          cadComponents
            .filter((c) => c.dynamicBindings && c.dynamicBindings.length > 0)
            .map((c) => ({
              componentName: c.name,
              bindings: c.dynamicBindings!.map((b) => {
                const ext = b as {
                  property: string;
                  index?: number;
                  variable: string;
                  unit?: string;
                  scaleFactor?: number;
                  scale?: number;
                  offset?: number;
                  format?: string;
                };
                return {
                  property: ext.property as CadDynamicProperty,
                  index: ext.index,
                  variable: ext.variable,
                  unit: ext.unit,
                  scaleFactor: ext.scaleFactor ?? ext.scale,
                  offset: ext.offset,
                  format: ext.format,
                };
              }),
            })),
        );
        for (const comp of cadComponents) {
          controller.setDefault(comp.name, {
            position: comp.cad.position ?? [0, 0, 0],
            rotation: comp.cad.rotation ?? [0, 0, 0],
            scale: comp.cad.scale ?? [1, 1, 1],
            ...(comp.defaults ?? {}),
          });
        }
        controller.loadTimeseries(result.t, result.y, result.states);
        const hasDynamic = cadComponents.some((c) => c.dynamicBindings && c.dynamicBindings.length > 0);
        if (hasDynamic) {
          controller.play();
        }
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.message === "Simulation aborted") {
        return;
      }
      setSimulationStatus({ status: "failed", error: e instanceof Error ? e.message : String(e) });
      if (!showCadView) {
        setShowResultsView(true);
        if (isNarrow) {
          setMobileTab("results");
          setTreeVisible(false);
          setView(viewDiagramEnum);
        }
      }
    }
  };

  const handleSimulateImplRef = useRef(handleSimulateImpl);
  handleSimulateImplRef.current = handleSimulateImpl;
  const handleSimulate = useCallback(() => handleSimulateImplRef.current(), []);

  return {
    simulationVariables,
    setSimulationVariables,
    selectedSimulationVariables,
    setSelectedSimulationVariables: setUserSelectedSimulationVariables,
    handleToggleSimulationVariable,
    handleVariablesLoaded,
    simulationParameters,
    setSimulationParameters,
    parameterOverrides,
    setParameterOverrides,
    handleParameterChange,
    handleParameterReset,
    sweepState,
    setSweepState,
    sweepResults,
    setSweepResults,
    simExperiment,
    setSimExperiment,
    experimentOverrides,
    setExperimentOverrides,
    handleExperimentOverrideChange,
    handleExperimentOverrideReset,
    cachedSimulator,
    setCachedSimulator,
    simulationStatus,
    setSimulationStatus,
    localSimulationData,
    setLocalSimulationData,
    pscadComplianceReport,
    pscadExports,
    cadComponents,
    setCadComponents,
    gdtOverlay,
    setGdtOverlay,
    vtkBuffer,
    setVtkBuffer,
    editorValue,
    animationControllerRef,
    animationMode,
    setAnimationMode,
    cosimDataSource,
    setCosimDataSource,
    ribbonParams,
    handleRibbonParamChange,
    handleRibbonParamReset,
    handleReplaySession,
    handleSaveCadBindings,
    handleCommitCadGizmoDelta,
    handleCommitCadDimensionDelta,
    handleCommitCadFaceTag,
    handleCommitCadAssemblyJoint,
    handleSimulate,
    amplSolveResult,
  };
}
