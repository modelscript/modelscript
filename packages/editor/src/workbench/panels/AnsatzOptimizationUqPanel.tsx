// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useCallback, useMemo, useState } from "react";
import {
  analyzeBltInAnsatz,
  optimizeModelInAnsatz,
  runMonteCarloInAnsatz,
  trainSurrogateInAnsatz,
  type AnsatzBltAnalysisResult,
  type AnsatzMonteCarloResult,
  type AnsatzOptimizeModelResult,
  type AnsatzTrainSurrogateResult,
} from "../util/lsp-bridge";

export interface AnsatzOptimizationUqPanelProps {
  documentUri: string;
  dialect: string;
  selectedClassName?: string | undefined;
  colorMode: "light" | "dark";
}

type PanelTab = "blt" | "optimization" | "montecarlo" | "surrogate";

interface ThemeTokens {
  bg: string;
  bgSubtle: string;
  bgCard: string;
  fg: string;
  fgMuted: string;
  border: string;
  accent: string;
  accentFg: string;
  accentSubtle: string;
  dangerBg: string;
  dangerBorder: string;
  dangerFg: string;
  successBg: string;
  successBorder: string;
  successFg: string;
  inputBg: string;
  codeBg: string;
}

function getThemeTokens(isDark: boolean): ThemeTokens {
  return {
    bg: `var(--bgColor-default, ${isDark ? "#0d1117" : "#ffffff"})`,
    bgSubtle: `var(--bgColor-muted, ${isDark ? "#161b22" : "#f6f8fa"})`,
    bgCard: `var(--bgColor-default, ${isDark ? "#0d1117" : "#ffffff"})`,
    fg: `var(--fgColor-default, ${isDark ? "#e6edf3" : "#1f2328"})`,
    fgMuted: `var(--fgColor-muted, ${isDark ? "#8b949e" : "#656d76"})`,
    border: `var(--borderColor-default, ${isDark ? "#30363d" : "#d0d7de"})`,
    accent: `var(--bgColor-accent-emphasis, ${isDark ? "#1f6feb" : "#0969da"})`,
    accentFg: `var(--fgColor-onEmphasis, #ffffff)`,
    accentSubtle: `var(--bgColor-accent-muted, ${isDark ? "rgba(56,139,253,0.15)" : "rgba(9,105,218,0.08)"})`,
    dangerBg: `var(--bgColor-danger-muted, ${isDark ? "rgba(248,81,73,0.12)" : "#ffebe9"})`,
    dangerBorder: `var(--borderColor-danger-emphasis, ${isDark ? "rgba(248,81,73,0.45)" : "rgba(207,34,46,0.35)"})`,
    dangerFg: `var(--fgColor-danger, ${isDark ? "#ff7b72" : "#cf222e"})`,
    successBg: `var(--bgColor-success-muted, ${isDark ? "rgba(46,160,67,0.14)" : "#dafbe1"})`,
    successBorder: `var(--borderColor-success-emphasis, ${isDark ? "rgba(63,185,80,0.45)" : "rgba(26,127,55,0.35)"})`,
    successFg: `var(--fgColor-success, ${isDark ? "#3fb950" : "#1a7f37"})`,
    inputBg: `var(--bgColor-inset, ${isDark ? "#010409" : "#ffffff"})`,
    codeBg: `var(--bgColor-muted, ${isDark ? "#161b22" : "#f6f8fa"})`,
  };
}

function formatNumber(val: unknown, digits = 4): string {
  if (typeof val !== "number" || !Number.isFinite(val)) return "—";
  if (val === 0) return "0";
  const abs = Math.abs(val);
  if (abs >= 1e5 || abs < 1e-3) {
    return val.toExponential(3);
  }
  return Number(val.toFixed(digits)).toString();
}

function lastFinite(arr: unknown): number | undefined {
  if (typeof arr === "number" && Number.isFinite(arr)) return arr;
  if (!Array.isArray(arr) || arr.length === 0) return undefined;
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

function asNumber(val: unknown): number | undefined {
  return typeof val === "number" && Number.isFinite(val) ? val : undefined;
}

const Spinner: React.FC<{ size?: number; color?: string }> = ({ size = 13, color = "currentColor" }) => (
  <span
    aria-hidden="true"
    style={{
      display: "inline-block",
      width: size,
      height: size,
      border: `2px solid ${color}`,
      borderTopColor: "transparent",
      borderRadius: "50%",
      animation: "ansatz-optuq-spin 0.7s linear infinite",
      flexShrink: 0,
    }}
  />
);

const ErrorBanner: React.FC<{ message: string; tokens: ThemeTokens }> = ({ message, tokens }) => (
  <div
    role="alert"
    style={{
      padding: "8px 10px",
      borderRadius: 6,
      backgroundColor: tokens.dangerBg,
      border: `1px solid ${tokens.dangerBorder}`,
      color: tokens.dangerFg,
      fontSize: 12,
      lineHeight: 1.45,
      wordBreak: "break-word",
    }}
  >
    <strong>Error:</strong> {message}
  </div>
);

const MetricTile: React.FC<{ label: string; value: string; tokens: ThemeTokens }> = ({ label, value, tokens }) => (
  <div
    style={{
      padding: "8px 10px",
      borderRadius: 6,
      backgroundColor: tokens.bgSubtle,
      border: `1px solid ${tokens.border}`,
      display: "flex",
      flexDirection: "column",
      gap: 2,
      minWidth: 0,
    }}
  >
    <span
      style={{
        fontSize: 11,
        color: tokens.fgMuted,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {label}
    </span>
    <span
      style={{
        fontSize: 15,
        fontWeight: 600,
        color: tokens.fg,
        fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {value}
    </span>
  </div>
);

const JsonDisclosure: React.FC<{ data: unknown; tokens: ThemeTokens; defaultOpen?: boolean }> = ({
  data,
  tokens,
  defaultOpen = false,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const formatted = useMemo(() => {
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  }, [data]);

  return (
    <div style={{ border: `1px solid ${tokens.border}`, borderRadius: 6, overflow: "hidden" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          padding: "6px 10px",
          backgroundColor: tokens.bgSubtle,
          color: tokens.fgMuted,
          border: "none",
          borderBottom: open ? `1px solid ${tokens.border}` : "none",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 11,
          fontWeight: 600,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span>Raw JSON Result</span>
        <span>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <pre
          style={{
            margin: 0,
            padding: 10,
            backgroundColor: tokens.codeBg,
            color: tokens.fg,
            fontSize: 11,
            lineHeight: 1.45,
            fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
            maxHeight: 240,
            overflow: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {formatted}
        </pre>
      )}
    </div>
  );
};

export const AnsatzOptimizationUqPanel: React.FC<AnsatzOptimizationUqPanelProps> = ({
  documentUri,
  dialect,
  selectedClassName,
  colorMode,
}) => {
  const isDark = colorMode === "dark";
  const tokens = useMemo(() => getThemeTokens(isDark), [isDark]);

  const [activeTab, setActiveTab] = useState<PanelTab>("blt");

  // 1. BLT Analysis state
  const [bltLoading, setBltLoading] = useState(false);
  const [bltError, setBltError] = useState<string | null>(null);
  const [bltResult, setBltResult] = useState<AnsatzBltAnalysisResult | null>(null);

  // 2. Optimization state
  const [objective, setObjective] = useState("");
  const [maxIterations, setMaxIterations] = useState(100);
  const [optLoading, setOptLoading] = useState(false);
  const [optError, setOptError] = useState<string | null>(null);
  const [optResult, setOptResult] = useState<AnsatzOptimizeModelResult | null>(null);

  // 3. Monte Carlo UQ state
  const [mcSamples, setMcSamples] = useState(50);
  const [mcDistribution, setMcDistribution] = useState<"normal" | "uniform">("normal");
  const [mcRelStdPct, setMcRelStdPct] = useState(10);
  const [mcLoading, setMcLoading] = useState(false);
  const [mcError, setMcError] = useState<string | null>(null);
  const [mcResult, setMcResult] = useState<AnsatzMonteCarloResult | null>(null);

  // 4. Surrogate Model state
  const [surrogateSamples, setSurrogateSamples] = useState(40);
  const [surrogateLoading, setSurrogateLoading] = useState(false);
  const [surrogateError, setSurrogateError] = useState<string | null>(null);
  const [surrogateResult, setSurrogateResult] = useState<AnsatzTrainSurrogateResult | null>(null);

  const handleRunBlt = useCallback(async () => {
    setBltLoading(true);
    setBltError(null);
    try {
      const res = await analyzeBltInAnsatz(documentUri, selectedClassName);
      if (!res) {
        setBltResult(null);
        setBltError("No BLT analysis result returned for the active model.");
      } else if (res.error) {
        setBltResult(res);
        setBltError(res.error);
      } else {
        setBltResult(res);
      }
    } catch (err) {
      setBltError(err instanceof Error ? err.message : String(err));
    } finally {
      setBltLoading(false);
    }
  }, [documentUri, selectedClassName]);

  const handleRunOptimization = useCallback(async () => {
    setOptLoading(true);
    setOptError(null);
    try {
      const safeMaxIter = Number.isFinite(maxIterations) && maxIterations > 0 ? Math.floor(maxIterations) : 100;
      const res = await optimizeModelInAnsatz({
        uri: documentUri,
        className: selectedClassName,
        objective: objective.trim() || undefined,
        maxIterations: safeMaxIter,
      });
      setOptResult(res);
      if (res?.error) {
        setOptError(res.error);
      } else if (res?.success === false) {
        setOptError(res.messages || res.status || "Optimization did not succeed.");
      }
    } catch (err) {
      setOptError(err instanceof Error ? err.message : String(err));
    } finally {
      setOptLoading(false);
    }
  }, [documentUri, selectedClassName, objective, maxIterations]);

  const handleRunMonteCarlo = useCallback(async () => {
    setMcLoading(true);
    setMcError(null);
    try {
      const numSamples = Number.isFinite(mcSamples) && mcSamples > 0 ? Math.floor(mcSamples) : 50;
      // Discover model parameters so Monte Carlo genuinely perturbs uncertain parameters rather than running identical deterministic trials
      const relFrac = Math.max(0.001, Math.min(1, (Number.isFinite(mcRelStdPct) ? mcRelStdPct : 10) / 100));
      let uncertainParams: Array<{
        name: string;
        distribution: string;
        mean: number;
        stdDev: number;
        min?: number;
        max?: number;
      }> = [];
      if (documentUri) {
        try {
          const { getModelParameters } = await import("../util/lsp-bridge");
          const modelInfo = await getModelParameters(documentUri);
          const rawParams = Array.isArray(modelInfo?.parameters) ? modelInfo.parameters : [];
          uncertainParams = rawParams
            .filter((p) => typeof p.name === "string" && Number.isFinite(Number(p.value)))
            .slice(0, 6)
            .map((p) => {
              const mean = Number(p.value);
              const spread = Math.abs(mean) > 1e-9 ? Math.abs(mean) * relFrac : relFrac;
              return mcDistribution === "uniform"
                ? {
                    name: p.name,
                    distribution: "uniform",
                    mean,
                    stdDev: spread,
                    min: mean - spread,
                    max: mean + spread,
                  }
                : { name: p.name, distribution: "normal", mean, stdDev: spread };
            });
        } catch {
          uncertainParams = [];
        }
      }
      if (uncertainParams.length === 0) {
        setMcResult(null);
        setMcError(
          "No numeric parameters found on the active model for Monte Carlo perturbation. Declare at least one `parameter Real` to run UQ.",
        );
        return;
      }
      const res = await runMonteCarloInAnsatz({
        uri: documentUri,
        className: selectedClassName,
        numSamples,
        parameters: uncertainParams,
      });
      setMcResult(res);
      if (res?.error) {
        setMcError(res.error);
      } else if (res?.success === false) {
        setMcError("Monte Carlo UQ simulation failed.");
      }
    } catch (err) {
      setMcError(err instanceof Error ? err.message : String(err));
    } finally {
      setMcLoading(false);
    }
  }, [documentUri, selectedClassName, mcSamples, mcDistribution, mcRelStdPct]);

  const handleTrainSurrogate = useCallback(async () => {
    setSurrogateLoading(true);
    setSurrogateError(null);
    try {
      const numSamples = Number.isFinite(surrogateSamples) && surrogateSamples > 0 ? Math.floor(surrogateSamples) : 40;
      const res = await trainSurrogateInAnsatz({
        uri: documentUri,
        className: selectedClassName,
        numSamples,
      });
      setSurrogateResult(res);
      if (res?.error) {
        setSurrogateError(res.error);
      } else if (res?.success === false) {
        setSurrogateError("Surrogate model training failed.");
      }
    } catch (err) {
      setSurrogateError(err instanceof Error ? err.message : String(err));
    } finally {
      setSurrogateLoading(false);
    }
  }, [documentUri, selectedClassName, surrogateSamples]);

  // Derived BLT summary values (handles both direct payload and { supported, data } wrapper)
  const bltSummary = useMemo(() => {
    if (!bltResult) return null;
    const rawRec = bltResult as Record<string, unknown>;
    const payload =
      rawRec.data && typeof rawRec.data === "object" && !Array.isArray(rawRec.data)
        ? (rawRec.data as Record<string, unknown>)
        : rawRec;
    const eqCount =
      asNumber(payload.equationCount) ?? (Array.isArray(payload.equations) ? payload.equations.length : 0);
    const varCount =
      asNumber(payload.unknownCount) ?? (Array.isArray(payload.variables) ? payload.variables.length : 0);
    const algebraicLoops = Array.isArray(payload.algebraicLoops) ? payload.algebraicLoops : [];
    const blocks = Array.isArray(payload.blocks) ? payload.blocks : [];
    const blockCount = asNumber(payload.blockCount) ?? (blocks.length > 0 ? blocks.length : eqCount);
    const rawIndex = asNumber(payload.index) ?? asNumber(payload.daeIndex) ?? asNumber(payload.structuralIndex);
    const indexLabel = rawIndex !== undefined ? String(rawIndex) : algebraicLoops.length > 0 ? "≥1" : "0";
    const classLabel = typeof payload.className === "string" ? payload.className : selectedClassName || "Model";
    return { eqCount, varCount, blockCount, indexLabel, classLabel, algebraicLoops };
  }, [bltResult, selectedClassName]);

  // Derived Monte Carlo summary rows
  const mcStatRows = useMemo(() => {
    if (!mcResult?.statistics || typeof mcResult.statistics !== "object") return [];
    return Object.entries(mcResult.statistics).map(([name, raw]) => {
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        const stat = raw as Record<string, unknown>;
        return {
          name,
          mean: lastFinite(stat.mean),
          stddev: lastFinite(stat.stddev ?? stat.std),
          ciLo: lastFinite(stat.ciLo ?? stat.min),
          ciHi: lastFinite(stat.ciHi ?? stat.max),
        };
      }
      return {
        name,
        mean: asNumber(raw),
        stddev: undefined,
        ciLo: undefined,
        ciHi: undefined,
      };
    });
  }, [mcResult]);

  // Derived Surrogate metrics
  const surrogateMetrics = useMemo(() => {
    if (!surrogateResult) return null;
    const m = surrogateResult.metrics as Record<string, unknown> | undefined;
    const r2 = asNumber(m?.r2 ?? surrogateResult.r2);
    const valMSE = asNumber(m?.valMSE);
    const trainMSE = asNumber(m?.trainMSE);
    const explicitRmse = asNumber(m?.rmse ?? surrogateResult.rmse);
    const valRMSE = explicitRmse ?? (valMSE !== undefined && valMSE >= 0 ? Math.sqrt(valMSE) : undefined);
    const trainRMSE = trainMSE !== undefined && trainMSE >= 0 ? Math.sqrt(trainMSE) : undefined;
    return { r2, valRMSE, trainRMSE, valMSE, trainMSE };
  }, [surrogateResult]);

  const inputStyle: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    padding: "6px 8px",
    fontSize: 12,
    borderRadius: 6,
    border: `1px solid ${tokens.border}`,
    backgroundColor: tokens.inputBg,
    color: tokens.fg,
    outline: "none",
  };

  const primaryButtonStyle = (disabled: boolean): React.CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 6,
    border: "1px solid transparent",
    backgroundColor: tokens.accent,
    color: tokens.accentFg,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.65 : 1,
    whiteSpace: "nowrap",
  });

  const tabs: { id: PanelTab; label: string }[] = [
    { id: "blt", label: "BLT Analysis" },
    { id: "optimization", label: "Optimization" },
    { id: "montecarlo", label: "Monte Carlo UQ" },
    { id: "surrogate", label: "Surrogate Model" },
  ];

  const targetLabel = selectedClassName || documentUri.split("/").pop() || documentUri;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        backgroundColor: tokens.bg,
        color: tokens.fg,
        fontFamily: "var(--font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif)",
        fontSize: 12,
        overflow: "hidden",
      }}
    >
      <style>{`@keyframes ansatz-optuq-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* Header */}
      <div
        style={{
          padding: "8px 12px",
          borderBottom: `1px solid ${tokens.border}`,
          backgroundColor: tokens.bgSubtle,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ fontWeight: 600, fontSize: 13, whiteSpace: "nowrap" }}>Optimization &amp; UQ</span>
          <span
            title={targetLabel}
            style={{
              fontSize: 11,
              color: tokens.fgMuted,
              fontFamily: "var(--font-mono, monospace)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {targetLabel}
          </span>
        </div>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            padding: "2px 6px",
            borderRadius: 10,
            backgroundColor: tokens.accentSubtle,
            color: tokens.fg,
            border: `1px solid ${tokens.border}`,
            flexShrink: 0,
          }}
        >
          {dialect}
        </span>
      </div>

      {/* Tab Bar */}
      <div
        role="tablist"
        aria-label="Analysis Modes"
        style={{
          display: "flex",
          gap: 4,
          padding: "6px 10px",
          borderBottom: `1px solid ${tokens.border}`,
          backgroundColor: tokens.bgSubtle,
          overflowX: "auto",
          flexShrink: 0,
        }}
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: "5px 10px",
                fontSize: 12,
                fontWeight: isActive ? 600 : 500,
                borderRadius: 6,
                border: `1px solid ${isActive ? tokens.accent : "transparent"}`,
                backgroundColor: isActive ? tokens.accentSubtle : "transparent",
                color: isActive ? tokens.fg : tokens.fgMuted,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Active Card Content */}
      <div style={{ flex: 1, overflow: "auto", padding: 12 }}>
        {/* 1. BLT Analysis Card */}
        {activeTab === "blt" && (
          <section
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              padding: 12,
              borderRadius: 8,
              border: `1px solid ${tokens.border}`,
              backgroundColor: tokens.bgCard,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>Block Lower Triangular (BLT) Analysis</div>
                <div style={{ fontSize: 11, color: tokens.fgMuted }}>
                  Inspect structural equation/variable incidence, strongly connected blocks, and DAE index.
                </div>
              </div>
              <button type="button" disabled={bltLoading} onClick={handleRunBlt} style={primaryButtonStyle(bltLoading)}>
                {bltLoading && <Spinner color={tokens.accentFg} />}
                {bltLoading ? "Analyzing..." : "Run BLT"}
              </button>
            </div>

            {bltError && <ErrorBanner message={bltError} tokens={tokens} />}

            {bltSummary && bltResult && (
              <>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
                    gap: 8,
                  }}
                >
                  <MetricTile label="Equations" value={String(bltSummary.eqCount)} tokens={tokens} />
                  <MetricTile label="Variables" value={String(bltSummary.varCount)} tokens={tokens} />
                  <MetricTile label="Blocks" value={String(bltSummary.blockCount)} tokens={tokens} />
                  <MetricTile label="DAE Index" value={bltSummary.indexLabel} tokens={tokens} />
                </div>

                <div
                  style={{
                    padding: "8px 10px",
                    borderRadius: 6,
                    backgroundColor: tokens.bgSubtle,
                    border: `1px solid ${tokens.border}`,
                    fontSize: 11,
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <div>
                    <span style={{ color: tokens.fgMuted }}>Class: </span>
                    <strong style={{ fontFamily: "var(--font-mono, monospace)" }}>{bltSummary.classLabel}</strong>
                  </div>
                  <div>
                    <span style={{ color: tokens.fgMuted }}>Structural balance: </span>
                    <strong
                      style={{
                        color: bltSummary.eqCount === bltSummary.varCount ? tokens.successFg : tokens.dangerFg,
                      }}
                    >
                      {bltSummary.eqCount === bltSummary.varCount
                        ? "Balanced"
                        : `${bltSummary.eqCount} eqs vs ${bltSummary.varCount} vars`}
                    </strong>
                  </div>
                  {bltSummary.algebraicLoops.length > 0 && (
                    <div>
                      <span style={{ color: tokens.fgMuted }}>Coupled algebraic loops: </span>
                      <strong>{bltSummary.algebraicLoops.length}</strong>
                    </div>
                  )}
                </div>

                <JsonDisclosure data={bltResult} tokens={tokens} />
              </>
            )}
          </section>
        )}

        {/* 2. Optimization Card */}
        {activeTab === "optimization" && (
          <section
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              padding: 12,
              borderRadius: 8,
              border: `1px solid ${tokens.border}`,
              backgroundColor: tokens.bgCard,
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Model Optimization</div>
              <div style={{ fontSize: 11, color: tokens.fgMuted }}>
                Run numerical parameter optimization against an objective expression.
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 120px auto", gap: 8, alignItems: "end" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: tokens.fgMuted }}>
                Objective
                <input
                  type="text"
                  value={objective}
                  onChange={(e) => setObjective(e.target.value)}
                  placeholder="e.g. minimize(cost)"
                  style={inputStyle}
                />
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: tokens.fgMuted }}>
                Max Iterations
                <input
                  type="number"
                  min={1}
                  max={100000}
                  value={maxIterations}
                  onChange={(e) => setMaxIterations(Math.max(1, Number.parseInt(e.target.value, 10) || 1))}
                  style={inputStyle}
                />
              </label>

              <button
                type="button"
                disabled={optLoading}
                onClick={handleRunOptimization}
                style={primaryButtonStyle(optLoading)}
              >
                {optLoading && <Spinner color={tokens.accentFg} />}
                {optLoading ? "Running..." : "Run"}
              </button>
            </div>

            {optError && <ErrorBanner message={optError} tokens={tokens} />}

            {optResult &&
              (() => {
                const optRec = optResult as Record<string, unknown>;
                const objectiveCost = asNumber(optRec.cost) ?? asNumber(optRec.objectiveValue);
                const rawParams: Record<string, number> = {};
                const paramSource =
                  (optRec.parameters && typeof optRec.parameters === "object"
                    ? (optRec.parameters as Record<string, unknown>)
                    : null) ??
                  (optRec.controls && typeof optRec.controls === "object"
                    ? (optRec.controls as Record<string, unknown>)
                    : null) ??
                  (optRec.states && typeof optRec.states === "object"
                    ? (optRec.states as Record<string, unknown>)
                    : null);
                if (paramSource) {
                  for (const [k, v] of Object.entries(paramSource)) {
                    const num = lastFinite(v);
                    if (num !== undefined) rawParams[k] = num;
                  }
                }
                const paramEntries = Object.entries(rawParams);
                return (
                  <>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                        gap: 8,
                      }}
                    >
                      <MetricTile
                        label="Status"
                        value={optResult.status ?? (optResult.success ? "Converged" : "Finished")}
                        tokens={tokens}
                      />
                      <MetricTile label="Objective Cost" value={formatNumber(objectiveCost)} tokens={tokens} />
                      <MetricTile label="Variables / Controls" value={String(paramEntries.length)} tokens={tokens} />
                    </div>

                    {optResult.messages && (
                      <div
                        style={{
                          padding: "6px 10px",
                          borderRadius: 6,
                          backgroundColor: tokens.bgSubtle,
                          border: `1px solid ${tokens.border}`,
                          fontSize: 11,
                          color: tokens.fgMuted,
                        }}
                      >
                        {optResult.messages}
                      </div>
                    )}

                    {paramEntries.length > 0 && (
                      <div style={{ border: `1px solid ${tokens.border}`, borderRadius: 6, overflow: "hidden" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                          <thead>
                            <tr style={{ backgroundColor: tokens.bgSubtle, textAlign: "left" }}>
                              <th
                                style={{
                                  padding: "6px 10px",
                                  borderBottom: `1px solid ${tokens.border}`,
                                  fontWeight: 600,
                                }}
                              >
                                Variable / Control
                              </th>
                              <th
                                style={{
                                  padding: "6px 10px",
                                  borderBottom: `1px solid ${tokens.border}`,
                                  fontWeight: 600,
                                  textAlign: "right",
                                }}
                              >
                                Optimal Final Value
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {paramEntries.map(([paramName, paramVal]) => (
                              <tr key={paramName}>
                                <td
                                  style={{
                                    padding: "5px 10px",
                                    borderBottom: `1px solid ${tokens.border}`,
                                    fontFamily: "var(--font-mono, monospace)",
                                  }}
                                >
                                  {paramName}
                                </td>
                                <td
                                  style={{
                                    padding: "5px 10px",
                                    borderBottom: `1px solid ${tokens.border}`,
                                    fontFamily: "var(--font-mono, monospace)",
                                    textAlign: "right",
                                  }}
                                >
                                  {formatNumber(paramVal)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <JsonDisclosure data={optResult} tokens={tokens} />
                  </>
                );
              })()}
          </section>
        )}

        {/* 3. Monte Carlo UQ Card */}
        {activeTab === "montecarlo" && (
          <section
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              padding: 12,
              borderRadius: 8,
              border: `1px solid ${tokens.border}`,
              backgroundColor: tokens.bgCard,
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Monte Carlo Uncertainty Quantification</div>
              <div style={{ fontSize: 11, color: tokens.fgMuted }}>
                Propagate parameter uncertainty through ensemble simulations and inspect output statistics.
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
              <label
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  fontSize: 11,
                  color: tokens.fgMuted,
                  width: 120,
                }}
              >
                Sample Count
                <input
                  type="number"
                  min={1}
                  max={100000}
                  value={mcSamples}
                  onChange={(e) => setMcSamples(Math.max(1, Number.parseInt(e.target.value, 10) || 1))}
                  style={inputStyle}
                />
              </label>

              <label
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  fontSize: 11,
                  color: tokens.fgMuted,
                  width: 120,
                }}
              >
                Distribution
                <select
                  value={mcDistribution}
                  onChange={(e) => setMcDistribution(e.target.value === "uniform" ? "uniform" : "normal")}
                  style={inputStyle}
                >
                  <option value="normal">Normal (Gaussian)</option>
                  <option value="uniform">Uniform (±%)</option>
                </select>
              </label>

              <label
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  fontSize: 11,
                  color: tokens.fgMuted,
                  width: 110,
                }}
              >
                Rel. Spread (%)
                <input
                  type="number"
                  min={0.5}
                  max={100}
                  step={0.5}
                  value={mcRelStdPct}
                  onChange={(e) => setMcRelStdPct(Math.max(0.5, Number.parseFloat(e.target.value) || 10))}
                  style={inputStyle}
                />
              </label>

              <button
                type="button"
                disabled={mcLoading}
                onClick={handleRunMonteCarlo}
                style={primaryButtonStyle(mcLoading)}
              >
                {mcLoading && <Spinner color={tokens.accentFg} />}
                {mcLoading ? "Sampling..." : "Run"}
              </button>
            </div>

            {mcError && <ErrorBanner message={mcError} tokens={tokens} />}

            {mcResult && (
              <>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                    gap: 8,
                  }}
                >
                  <MetricTile
                    label="Samples"
                    value={String(
                      mcResult.numSamples ?? (Array.isArray(mcResult.samples) ? mcResult.samples.length : mcSamples),
                    )}
                    tokens={tokens}
                  />
                  <MetricTile label="Tracked Outputs" value={String(mcStatRows.length)} tokens={tokens} />
                  {typeof mcResult.convergence === "object" && mcResult.convergence !== null && (
                    <MetricTile
                      label="Eff. Sample Size"
                      value={formatNumber((mcResult.convergence as Record<string, unknown>).effectiveSampleSize, 1)}
                      tokens={tokens}
                    />
                  )}
                </div>

                {mcStatRows.length > 0 && (
                  <div style={{ border: `1px solid ${tokens.border}`, borderRadius: 6, overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ backgroundColor: tokens.bgSubtle, textAlign: "left" }}>
                          <th
                            style={{ padding: "6px 10px", borderBottom: `1px solid ${tokens.border}`, fontWeight: 600 }}
                          >
                            Variable
                          </th>
                          <th
                            style={{
                              padding: "6px 10px",
                              borderBottom: `1px solid ${tokens.border}`,
                              fontWeight: 600,
                              textAlign: "right",
                            }}
                          >
                            Mean
                          </th>
                          <th
                            style={{
                              padding: "6px 10px",
                              borderBottom: `1px solid ${tokens.border}`,
                              fontWeight: 600,
                              textAlign: "right",
                            }}
                          >
                            Std Dev
                          </th>
                          <th
                            style={{
                              padding: "6px 10px",
                              borderBottom: `1px solid ${tokens.border}`,
                              fontWeight: 600,
                              textAlign: "right",
                            }}
                          >
                            CI Low
                          </th>
                          <th
                            style={{
                              padding: "6px 10px",
                              borderBottom: `1px solid ${tokens.border}`,
                              fontWeight: 600,
                              textAlign: "right",
                            }}
                          >
                            CI High
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {mcStatRows.map((row) => (
                          <tr key={row.name}>
                            <td
                              style={{
                                padding: "5px 10px",
                                borderBottom: `1px solid ${tokens.border}`,
                                fontFamily: "var(--font-mono, monospace)",
                              }}
                            >
                              {row.name}
                            </td>
                            <td
                              style={{
                                padding: "5px 10px",
                                borderBottom: `1px solid ${tokens.border}`,
                                fontFamily: "var(--font-mono, monospace)",
                                textAlign: "right",
                              }}
                            >
                              {formatNumber(row.mean)}
                            </td>
                            <td
                              style={{
                                padding: "5px 10px",
                                borderBottom: `1px solid ${tokens.border}`,
                                fontFamily: "var(--font-mono, monospace)",
                                textAlign: "right",
                              }}
                            >
                              {formatNumber(row.stddev)}
                            </td>
                            <td
                              style={{
                                padding: "5px 10px",
                                borderBottom: `1px solid ${tokens.border}`,
                                fontFamily: "var(--font-mono, monospace)",
                                textAlign: "right",
                              }}
                            >
                              {formatNumber(row.ciLo)}
                            </td>
                            <td
                              style={{
                                padding: "5px 10px",
                                borderBottom: `1px solid ${tokens.border}`,
                                fontFamily: "var(--font-mono, monospace)",
                                textAlign: "right",
                              }}
                            >
                              {formatNumber(row.ciHi)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <JsonDisclosure data={mcResult} tokens={tokens} />
              </>
            )}
          </section>
        )}

        {/* 4. Surrogate Model Card */}
        {activeTab === "surrogate" && (
          <section
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              padding: 12,
              borderRadius: 8,
              border: `1px solid ${tokens.border}`,
              backgroundColor: tokens.bgCard,
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Surrogate Model Training</div>
              <div style={{ fontSize: 11, color: tokens.fgMuted }}>
                Sample the DAE response surface and fit a fast surrogate model with R² and RMSE validation metrics.
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
              <label
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  fontSize: 11,
                  color: tokens.fgMuted,
                  width: 140,
                }}
              >
                Sample Count
                <input
                  type="number"
                  min={1}
                  max={100000}
                  value={surrogateSamples}
                  onChange={(e) => setSurrogateSamples(Math.max(1, Number.parseInt(e.target.value, 10) || 1))}
                  style={inputStyle}
                />
              </label>

              <button
                type="button"
                disabled={surrogateLoading}
                onClick={handleTrainSurrogate}
                style={primaryButtonStyle(surrogateLoading)}
              >
                {surrogateLoading && <Spinner color={tokens.accentFg} />}
                {surrogateLoading ? "Training..." : "Train"}
              </button>
            </div>

            {surrogateError && <ErrorBanner message={surrogateError} tokens={tokens} />}

            {surrogateResult && surrogateMetrics && (
              <>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
                    gap: 8,
                  }}
                >
                  <MetricTile label="R²" value={formatNumber(surrogateMetrics.r2)} tokens={tokens} />
                  <MetricTile label="Val RMSE" value={formatNumber(surrogateMetrics.valRMSE)} tokens={tokens} />
                  <MetricTile label="Train RMSE" value={formatNumber(surrogateMetrics.trainRMSE)} tokens={tokens} />
                  <MetricTile label="Val MSE" value={formatNumber(surrogateMetrics.valMSE)} tokens={tokens} />
                </div>

                {(surrogateResult.architecture ||
                  (surrogateResult.inputNames && surrogateResult.inputNames.length > 0) ||
                  (surrogateResult.outputNames && surrogateResult.outputNames.length > 0)) && (
                  <div
                    style={{
                      padding: "8px 10px",
                      borderRadius: 6,
                      backgroundColor: tokens.bgSubtle,
                      border: `1px solid ${tokens.border}`,
                      fontSize: 11,
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    {surrogateResult.architecture && (
                      <div>
                        <span style={{ color: tokens.fgMuted }}>Architecture: </span>
                        <strong>{surrogateResult.architecture}</strong>
                      </div>
                    )}
                    {surrogateResult.inputNames && surrogateResult.inputNames.length > 0 && (
                      <div>
                        <span style={{ color: tokens.fgMuted }}>Inputs: </span>
                        <span style={{ fontFamily: "var(--font-mono, monospace)" }}>
                          {surrogateResult.inputNames.join(", ")}
                        </span>
                      </div>
                    )}
                    {surrogateResult.outputNames && surrogateResult.outputNames.length > 0 && (
                      <div>
                        <span style={{ color: tokens.fgMuted }}>Outputs: </span>
                        <span style={{ fontFamily: "var(--font-mono, monospace)" }}>
                          {surrogateResult.outputNames.join(", ")}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                <JsonDisclosure data={surrogateResult} tokens={tokens} />
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
};

export default AnsatzOptimizationUqPanel;
