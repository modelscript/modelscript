// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { ClassDetail } from "../../../api";
import { didClose, didOpen, simulate, type SimulateResult } from "../../../components/morsel/util/lsp-bridge";
import { extractParametersFromCode, type ParameterRibbonItem } from "../../../util/modelica-params";

export interface ExperimentConfig {
  startTime: number;
  stopTime: number;
  numberOfIntervals: number;
  tolerance: number;
  solver: "dopri5" | "rk4" | "euler" | "cvode";
}

export interface SimulationParamItem extends ParameterRibbonItem {
  currentValue: number;
  description?: string | undefined;
}

export function extractExperimentAnnotation(code: string): Partial<ExperimentConfig> {
  const result: Partial<ExperimentConfig> = {};
  if (!code) return result;
  const match = code.match(/experiment\s*\(([^)]+)\)/i);
  if (match && match[1]) {
    const body = match[1];
    const startM = body.match(/StartTime\s*=\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/i);
    const stopM = body.match(/StopTime\s*=\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/i);
    const intervalM = body.match(/Interval\s*=\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/i);
    const tolM = body.match(/Tolerance\s*=\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/i);
    if (startM && startM[1]) result.startTime = Number(startM[1]);
    if (stopM && stopM[1]) result.stopTime = Number(stopM[1]);
    if (intervalM && intervalM[1] && Number(intervalM[1]) > 0 && result.stopTime !== undefined) {
      const intVal = Number(intervalM[1]);
      const span = result.stopTime - (result.startTime ?? 0);
      result.numberOfIntervals = Math.max(50, Math.min(2500, Math.round(span / intVal)));
    }
    if (tolM && tolM[1]) result.tolerance = Number(tolM[1]);
  }
  return result;
}

export function synthesizeModelSource(cls: ClassDetail, className: string): string {
  if (cls.sourceCode && cls.sourceCode.trim().length > 0) {
    return cls.sourceCode;
  }
  const shortName = className ? className.split(".").pop() || "Model" : "Model";
  const compLines = (cls.components || []).map((comp) => {
    const prefix = [comp.variability, comp.causality, comp.type_name, comp.component_name].filter(Boolean).join(" ");
    return `  ${prefix};`;
  });
  const eqLines = (cls.equations || []).map((eq) => `  ${eq.endsWith(";") ? eq : `${eq};`}`);
  return `model ${shortName}\n${compLines.join("\n")}\nequation\n${eqLines.join("\n")}\nend ${shortName};\n`;
}

export interface UseClassSimulationOptions {
  libraryName: string;
  version: string;
  className: string;
  cls: ClassDetail;
  active: boolean;
}

let docCounter = 1;

export function useClassSimulation({ libraryName, version, className, cls, active }: UseClassSimulationOptions) {
  const [searchParams, setSearchParams] = useSearchParams();

  // 1. Resolve executable Modelica source
  const sourceCode = useMemo(() => synthesizeModelSource(cls, className), [cls, className]);

  // 2. Unique document URI for the LSP WebWorker
  const documentUri = useMemo(() => {
    const safePkg = libraryName.replace(/[^a-zA-Z0-9_-]/g, "_");
    const safeVer = version.replace(/[^a-zA-Z0-9._-]/g, "_");
    const safeCls = className.replace(/[^a-zA-Z0-9._-]/g, "_");
    return `file:///pkg_${safePkg}_${safeVer}_${safeCls}_${docCounter++}.mo`;
  }, [libraryName, version, className]);

  // 3. Initial Experiment Configuration
  const defaultExperiment = useMemo<ExperimentConfig>(() => {
    const parsed = extractExperimentAnnotation(sourceCode);
    return {
      startTime: parsed.startTime ?? 0.0,
      stopTime: parsed.stopTime ?? 1.0,
      numberOfIntervals: parsed.numberOfIntervals ?? 500,
      tolerance: parsed.tolerance ?? 1e-4,
      solver: "dopri5",
    };
  }, [sourceCode]);

  const [experimentConfig, setExperimentConfig] = useState<ExperimentConfig>(defaultExperiment);

  // Keep experimentConfig synced when class changes
  useEffect(() => {
    setExperimentConfig(defaultExperiment);
  }, [defaultExperiment]);

  // 4. Initial Parameters
  const initialParameters = useMemo<SimulationParamItem[]>(() => {
    // A. Parse from source code
    const fromCode = extractParametersFromCode(sourceCode);
    const paramMap = new Map<string, SimulationParamItem>();

    for (const p of fromCode) {
      paramMap.set(p.name, {
        ...p,
        currentValue: p.defaultValue,
      });
    }

    // B. Augment from cls.components where variability === 'parameter'
    for (const c of cls.components || []) {
      if (c.variability === "parameter" || (!c.variability && c.default_value && !c.causality)) {
        const numVal = c.default_value ? Number(c.default_value) : NaN;
        if (!isNaN(numVal) && !paramMap.has(c.component_name)) {
          paramMap.set(c.component_name, {
            name: c.component_name,
            type: c.type_name || "Real",
            defaultValue: numVal,
            currentValue: numVal,
            unit: c.unit,
            description: c.description,
          });
        }
      }
    }

    return Array.from(paramMap.values());
  }, [sourceCode, cls.components]);

  // 5. Parameter Overrides
  // Check URL params for p_<paramName>=<val>
  const [parameterOverrides, setParameterOverrides] = useState<Map<string, number>>(() => {
    const overrides = new Map<string, number>();
    for (const [key, val] of searchParams.entries()) {
      if (key.startsWith("p_")) {
        const paramName = key.slice(2);
        const num = Number(val);
        if (!isNaN(num)) {
          overrides.set(paramName, num);
        }
      }
    }
    return overrides;
  });

  // Effective Parameters with Overrides applied
  const parameters = useMemo<SimulationParamItem[]>(() => {
    return initialParameters.map((p) => ({
      ...p,
      currentValue: parameterOverrides.has(p.name) ? parameterOverrides.get(p.name)! : p.defaultValue,
    }));
  }, [initialParameters, parameterOverrides]);

  // 6. Simulation State
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulationError, setSimulationError] = useState<string | null>(null);
  const [lastSolveDurationMs, setLastSolveDurationMs] = useState<number | null>(null);
  const [chartData, setChartData] = useState<Record<string, number | string>[] | null>(null);
  const [availableStates, setAvailableStates] = useState<string[]>([]);
  const [hasRunOnce, setHasRunOnce] = useState(false);
  const [autoRunOnScrub, setAutoRunOnScrub] = useState(true);

  // Baseline Comparison
  const [baselineData, setBaselineData] = useState<Record<string, number | string>[] | null>(null);

  // Document registration in LSP Worker
  const isDocOpenRef = useRef(false);
  useEffect(() => {
    if (!active) return;
    didOpen(documentUri, sourceCode, "modelica").then(() => {
      isDocOpenRef.current = true;
    });

    return () => {
      if (isDocOpenRef.current) {
        didClose(documentUri);
        isDocOpenRef.current = false;
      }
    };
  }, [documentUri, sourceCode, active]);

  // 7. Core Simulation Runner
  const runSimulation = useCallback(
    async (customOverrides?: Map<string, number>, customExp?: ExperimentConfig) => {
      if (isSimulating) return;
      setIsSimulating(true);
      setSimulationError(null);

      const tStart = performance.now();
      try {
        // Ensure doc is open
        if (!isDocOpenRef.current) {
          await didOpen(documentUri, sourceCode, "modelica");
          isDocOpenRef.current = true;
        }

        const effectiveOverrides = customOverrides ?? parameterOverrides;
        const effectiveExp = customExp ?? experimentConfig;
        const overridesObj = Object.fromEntries(effectiveOverrides);

        const shortName = className.split(".").pop() || className;
        const targetClass = sourceCode.includes(`model ${shortName}`) ? shortName : className;

        const res: SimulateResult = await simulate(documentUri, {
          className: targetClass,
          parameterOverrides: overridesObj,
          startTime: effectiveExp.startTime,
          stopTime: effectiveExp.stopTime,
          numberOfIntervals: effectiveExp.numberOfIntervals,
          rtol: effectiveExp.tolerance,
          solver: effectiveExp.solver,
          flattenerBackend: "hybrid",
        });

        const duration = Math.round(performance.now() - tStart);
        setLastSolveDurationMs(duration);

        if (res.error) {
          setSimulationError(res.error);
          setChartData(null);
        } else if (res.t && res.y && res.states) {
          const states = res.states;
          setAvailableStates(states);

          const formatted: Record<string, number | string>[] = res.t.map((tVal, i) => {
            const row: Record<string, number | string> = { time: tVal };
            states.forEach((sName, sIdx) => {
              row[sName] = res.y[i]?.[sIdx] ?? 0;
            });
            return row;
          });

          setChartData(formatted);
          setSimulationError(null);
          setHasRunOnce(true);
        } else {
          setSimulationError("No trajectory returned from simulation solver.");
        }
      } catch (err: unknown) {
        setSimulationError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsSimulating(false);
      }
    },
    [isSimulating, documentUri, sourceCode, className, parameterOverrides, experimentConfig],
  );

  // Auto-run once when tab becomes active
  useEffect(() => {
    if (active && !hasRunOnce && !isSimulating) {
      const timer = setTimeout(() => {
        void runSimulation();
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [active, hasRunOnce, isSimulating, runSimulation]);

  // Debounced auto-re-simulate when parameter overrides change (if autoRunOnScrub is enabled)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleParameterChange = useCallback(
    (name: string, value: number) => {
      setParameterOverrides((prev) => {
        const next = new Map(prev);
        next.set(name, value);
        return next;
      });

      // Update URL query parameters silently
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set(`p_${name}`, String(value));
          return next;
        },
        { replace: true },
      );

      if (autoRunOnScrub && hasRunOnce) {
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(() => {
          void runSimulation();
        }, 150);
      }
    },
    [autoRunOnScrub, hasRunOnce, runSimulation, setSearchParams],
  );

  const handleResetParameter = useCallback(
    (name: string) => {
      setParameterOverrides((prev) => {
        const next = new Map(prev);
        next.delete(name);
        return next;
      });

      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete(`p_${name}`);
          return next;
        },
        { replace: true },
      );

      if (autoRunOnScrub && hasRunOnce) {
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(() => {
          void runSimulation();
        }, 120);
      }
    },
    [autoRunOnScrub, hasRunOnce, runSimulation, setSearchParams],
  );

  const handleResetAllParameters = useCallback(() => {
    setParameterOverrides(new Map());
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const key of Array.from(next.keys())) {
          if (key.startsWith("p_")) next.delete(key);
        }
        return next;
      },
      { replace: true },
    );
    void runSimulation(new Map());
  }, [runSimulation, setSearchParams]);

  // Baseline Comparison Handlers
  const handlePinBaseline = useCallback(() => {
    if (chartData && chartData.length > 0) {
      setBaselineData([...chartData]);
    }
  }, [chartData]);

  const handleClearBaseline = useCallback(() => {
    setBaselineData(null);
  }, []);

  return {
    sourceCode,
    documentUri,
    experimentConfig,
    setExperimentConfig,
    parameters,
    parameterOverrides,
    isSimulating,
    simulationError,
    lastSolveDurationMs,
    chartData,
    availableStates,
    hasRunOnce,
    autoRunOnScrub,
    setAutoRunOnScrub,
    baselineData,
    runSimulation,
    handleParameterChange,
    handleResetParameter,
    handleResetAllParameters,
    handlePinBaseline,
    handleClearBaseline,
  };
}
