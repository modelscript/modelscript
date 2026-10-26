// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import { patchModelicaCadAnnotation, type DynamicBindingConfig } from "@modelscript/cad";
import type { editor } from "monaco-editor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { extractParametersFromCode } from "../../../util/modelica-params";
import { type CadComponent } from "../cad-viewer";
import { AnimationController } from "../cad-viewer/animation-controller";
import { extractCadComponents } from "../cad-viewer/parse-cad-annotations";
import { type HistorianSession } from "../CosimPanel";
import { type ExperimentOverrides, type ParameterInfo, type SweepState } from "../SimulationParameters";
import { getCadComponents, simulate } from "../util/lsp-bridge";
import { getMorselMqttClient } from "../util/mqtt-client";
import { useMqttSimulation } from "../util/use-mqtt-simulation";

export interface UseMorselEngineProps {
  documentUri: string;
  selectedTreeClassName: string | null;
  contextVersion: number;
  content: string;
  editor: editor.ICodeEditor | null;
  showResultsView: boolean;
  setShowResultsView: (v: boolean) => void;
  isNarrow: boolean;
  setMobileTab: (tab: any) => void;
  setTreeVisible: (v: boolean) => void;
  setView: (v: any) => void;
  viewDiagramEnum: any;
}

export function useMorselEngine({
  documentUri,
  selectedTreeClassName,
  contextVersion,
  content,
  editor,
  showResultsView,
  setShowResultsView,
  isNarrow,
  setMobileTab,
  setTreeVisible,
  setView,
  viewDiagramEnum,
}: UseMorselEngineProps) {
  // ── Simulation State ──
  const [simulationVariables, setSimulationVariables] = useState<string[]>([]);
  const [selectedSimulationVariables, setSelectedSimulationVariables] = useState<string[]>([]);
  const [simulationParameters, setSimulationParameters] = useState<ParameterInfo[]>([]);
  const [parameterOverrides, setParameterOverrides] = useState<Map<string, number>>(new Map());
  const [sweepState, setSweepState] = useState<SweepState | null>(null);
  const [sweepResults, setSweepResults] = useState<{ value: number; y: number[][] }[] | null>(null);
  const [experimentOverrides, setExperimentOverrides] = useState<ExperimentOverrides>({
    solver: "dassl",
    tolerance: 1e-4,
    equidistant: true,
  });
  const [cachedSimulator, setCachedSimulator] = useState<any>(null);
  const [simulationStatus, setSimulationStatus] = useState<any>(null);
  const [localSimulationData, setLocalSimulationData] = useState<Record<string, number | string>[] | null>(null);

  // ── CAD & 3D Animation State ──
  const [cadComponents, setCadComponents] = useState<CadComponent[]>([]);
  const animationControllerRef = useRef<AnimationController | null>(null);
  const [animationMode, setAnimationMode] = useState<"stopped" | "playing" | "paused" | "live">("stopped");
  const [cosimDataSource, setCosimDataSource] = useState<"local" | "mqtt-live" | "historian-replay">("local");
  const mqtt = useMqttSimulation({ source: cosimDataSource });

  // ── Ribbon Parameters ──
  const ribbonParams = useMemo(() => {
    if (simulationParameters.length > 0) return simulationParameters;
    return extractParametersFromCode(content);
  }, [simulationParameters, content]);

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

  const handleExperimentOverrideChange = (name: string, value: any) => {
    setExperimentOverrides((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleExperimentOverrideReset = (name: string) => {
    setExperimentOverrides((prev) => {
      const { [name]: _omitted, ...rest } = prev as Record<string, any>;
      return rest;
    });
  };

  const handleToggleSimulationVariable = (variable: string) => {
    setSelectedSimulationVariables((prev) =>
      prev.includes(variable) ? prev.filter((v) => v !== variable) : [...prev, variable],
    );
  };

  const handleVariablesLoaded = (variables: string[]) => {
    setSimulationVariables(variables);
    setSelectedSimulationVariables((prev) => (prev.length > 0 ? prev : variables.slice(0, 3)));
  };

  // ── Live MQTT sync ──
  useEffect(() => {
    if (cosimDataSource !== "mqtt-live") return;
    const client = getMorselMqttClient();
    const ctrl = animationControllerRef.current;
    if (ctrl) {
      ctrl.goLive();
    }
    const unsub = client.onVariableUpdate((participantId, variable, value) => {
      const controller = animationControllerRef.current;
      if (controller) {
        if (controller.mode !== "live") controller.goLive();
        const now = Date.now() / 1000;
        controller.pushLiveValue(variable, value, now);
        controller.pushLiveValue(`${participantId}.${variable}`, value, now);
      }
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

      const duration = session.durationSeconds || 60;
      const steps = Math.min(200, duration * 10);
      const t = Array.from({ length: steps }, (_, i) => (i * duration) / (steps - 1));

      const stateNames = Array.from(
        new Set([
          ...cadComponents.flatMap((c) => c.dynamicBindings?.map((b) => b.variable) || []),
          ...simulationVariables,
        ]),
      );
      if (stateNames.length === 0) {
        stateNames.push("phi", "theta", "r_0[1]", "r_0[2]", "r_0[3]");
      }

      const y: number[][] = t.map((timeVal) => {
        return stateNames.map((name, idx) => {
          return Math.sin(timeVal * (1 + idx * 0.5)) * 0.5;
        });
      });

      controller.loadTimeseries(t, y, stateNames);
      controller.setSpeed(speed);
      controller.play();

      const chartData = t.map((timeVal, i) => {
        const row: Record<string, number | string> = { time: timeVal };
        stateNames.forEach((state, vIdx) => {
          row[state] = y[i]?.[vIdx] ?? 0;
        });
        return row;
      });
      setLocalSimulationData(chartData);
      setSimulationStatus({ status: "completed" });
    },
    [cadComponents, simulationVariables],
  );

  // ── Dynamic CAD geometry binding save & code writeback ──
  const handleSaveCadBindings = useCallback(
    (componentName: string, bindings: DynamicBindingConfig[]) => {
      if (!editor) return;
      const currentCode = editor.getValue();
      const patch = patchModelicaCadAnnotation(currentCode, componentName, { bindings });

      if (patch.updatedSource !== currentCode) {
        editor.setValue(patch.updatedSource);
      }

      setCadComponents((prev) =>
        prev.map((c) =>
          c.name === componentName
            ? {
                ...c,
                dynamicBindings: bindings.map((b) => ({
                  property: b.property as "position" | "rotation" | "scale",
                  index: b.index ?? 0,
                  variable: b.variable,
                  unit: b.unit,
                  scale: b.scale,
                  offset: b.offset,
                  format: b.format,
                })),
              }
            : c,
        ),
      );
    },
    [editor],
  );

  // ── Fetch CAD annotations when selected model changes ──
  useEffect(() => {
    let cancelled = false;
    if (!selectedTreeClassName) {
      setCadComponents([]);
      return;
    }

    getCadComponents(documentUri, selectedTreeClassName)
      .then((components) => {
        if (cancelled) return;
        let parsed = components;
        if (!parsed || parsed.length === 0) {
          parsed = extractCadComponents(content);
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
                bindings: c.dynamicBindings!.map((b) => ({
                  property: b.property as "position" | "rotation" | "scale",
                  index: b.index,
                  variable: b.variable,
                })),
              })),
          );
          for (const comp of parsed) {
            ctrl.setDefault(comp.name, {
              position: comp.cad.position ?? [0, 0, 0],
              rotation: comp.cad.rotation ?? [0, 0, 0],
              scale: comp.cad.scale ?? [1, 1, 1],
            });
          }
        }
      })
      .catch((e) => {
        if (!cancelled) console.error("Failed to fetch CAD components:", e);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTreeClassName, contextVersion, content, documentUri]);

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
    if (!showResultsView || parameterOverrides.size === 0 || !selectedTreeClassName) return;

    const timer = setTimeout(async () => {
      try {
        const overrideObj = Object.fromEntries(parameterOverrides);
        const result = await simulate(documentUri, {
          className: selectedTreeClassName,
          parameterOverrides: overrideObj,
          sweepConfig: sweepState ?? undefined,
          startTime: experimentOverrides.startTime,
          stopTime: experimentOverrides.stopTime,
          interval: experimentOverrides.interval,
          solver: experimentOverrides.solver,
          numberOfIntervals: experimentOverrides.numberOfIntervals,
          rtol: experimentOverrides.tolerance,
          atol: experimentOverrides.atol,
          equidistant: experimentOverrides.equidistant,
          steadyStateOnly: experimentOverrides.steadyStateOnly,
        });

        if (result.error) throw new Error(result.error);

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
              return rowObj;
            }),
          );
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
        }
      } catch (e) {
        if ((e as Error).name === "AbortError" || (e as Error).message === "Simulation aborted") return;
        console.error("Re-simulation failed:", e);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
    };
  }, [parameterOverrides, sweepState, showResultsView, experimentOverrides, selectedTreeClassName, documentUri]);

  // ── Full Simulation Execution ──
  const handleSimulate = async () => {
    setSimulationStatus({ status: "pending", error: null });
    setLocalSimulationData(null);

    try {
      const overrideObj = Object.fromEntries(parameterOverrides);

      const result = await simulate(documentUri, {
        className: selectedTreeClassName ?? undefined,
        parameterOverrides: overrideObj,
        sweepConfig: sweepState ?? undefined,
        startTime: experimentOverrides.startTime,
        stopTime: experimentOverrides.stopTime,
        interval: experimentOverrides.interval,
        solver: experimentOverrides.solver,
        numberOfIntervals: experimentOverrides.numberOfIntervals,
        rtol: experimentOverrides.tolerance,
        atol: experimentOverrides.atol,
        equidistant: experimentOverrides.equidistant,
        steadyStateOnly: experimentOverrides.steadyStateOnly,
      });

      if (result.error) {
        throw new Error(result.error);
      }

      setSimulationParameters((result.parameters as any) ?? []);

      const states = result.states ?? [];
      setSimulationVariables(states);

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
            return rowObj;
          }),
        );
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
      }
      setSimulationStatus({ status: "completed" });
      setShowResultsView(true);
      if (isNarrow) {
        setMobileTab("results");
        setTreeVisible(false);
        setView(viewDiagramEnum);
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
              bindings: c.dynamicBindings!.map((b) => ({
                property: b.property as "position" | "rotation" | "scale",
                index: b.index,
                variable: b.variable,
                unit: (b as any).unit,
                scale: (b as any).scale,
                offset: (b as any).offset,
                format: (b as any).format,
              })),
            })),
        );
        for (const comp of cadComponents) {
          controller.setDefault(comp.name, {
            position: comp.cad.position ?? [0, 0, 0],
            rotation: comp.cad.rotation ?? [0, 0, 0],
            scale: comp.cad.scale ?? [1, 1, 1],
          });
        }
        controller.loadTimeseries(result.t, result.y, result.states);
        const hasDynamic = cadComponents.some((c) => c.dynamicBindings && c.dynamicBindings.length > 0);
        if (hasDynamic) {
          controller.play();
        }
      }
    } catch (e: any) {
      if (e.message === "Simulation aborted") {
        return;
      }
      setSimulationStatus({ status: "failed", error: e instanceof Error ? e.message : String(e) });
      setShowResultsView(true);
      if (isNarrow) {
        setMobileTab("results");
        setTreeVisible(false);
        setView(viewDiagramEnum);
      }
    }
  };

  return {
    simulationVariables,
    setSimulationVariables,
    selectedSimulationVariables,
    setSelectedSimulationVariables,
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
    cadComponents,
    setCadComponents,
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
    handleSimulate,
  };
}
