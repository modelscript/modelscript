// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  PanelButton,
  PanelKpiStrip,
  PanelShell,
  PanelTabBar,
  PanelToolbar,
  type LanguagePanelProps,
  type PanelKpiItem,
} from "@modelscript/design-tokens/panel";
import React, { useCallback, useMemo, useState } from "react";
import { parseAmplModelWithDiagnostics } from "../parser/ampl-mod-parser.js";

type AmplTabId = "variables" | "objectives" | "constraints" | "sets" | "solve" | "diagnostics";
type AmplVizSubTab = "summary" | "constraints2d" | "sweep" | "pareto";

interface AmplSolveResult {
  status?: string;
  problemName?: string;
  problemClass?: string;
  objectiveName?: string;
  objectiveDirection?: string;
  objectiveValue?: number | null;
  solverUsed?: string;
  solveTimeMs?: number;
  iterations?: number;
  message?: string;
  variables?: Record<string, number>;
  variableSuffixes?: Record<string, Record<string, unknown>>;
  constraintSuffixes?: Record<string, Record<string, unknown>>;
}

interface AmplGeomConstraint {
  name: string;
  lb: number | null;
  ub: number | null;
  linear?: { constant: number; coeffs: Record<string, number> };
}

interface AmplGeomInfo {
  variables: Array<{ id: number; name: string; type: string; lb: number | null; ub: number | null }>;
  objectives: Array<{ name: string; direction: "minimize" | "maximize" }>;
  constraints: AmplGeomConstraint[];
}

interface AmplSweepPoint {
  paramValue: number;
  objectiveValue: number | null;
  status: string;
}

interface AmplParetoPoint {
  obj1: number;
  obj2: number;
  status: string;
}

function formatNum(val: unknown): string {
  if (val === null || val === undefined) return "—";
  const n = Number(val);
  if (!Number.isFinite(n)) return String(val);
  if (Math.abs(n) < 1e-12) return "0";
  if (Number.isInteger(n)) return String(n);
  return Number(n.toPrecision(6)).toString();
}

const AmplConstraints2DSvg: React.FC<{
  geometry: AmplGeomInfo;
  solution?: Record<string, number> | undefined;
}> = ({ geometry, solution }) => {
  const [xVar, setXVar] = useState(geometry.variables[0]?.name ?? "");
  const [yVar, setYVar] = useState(geometry.variables[1]?.name ?? geometry.variables[0]?.name ?? "");

  const width = 460;
  const height = 260;
  const pad = 38;
  const plotW = width - pad * 2;
  const plotH = height - pad * 2;

  const { xMin, xMax, yMin, yMax, lines, optPt } = useMemo(() => {
    const xv = geometry.variables.find((v) => v.name === xVar);
    const yv = geometry.variables.find((v) => v.name === yVar);
    const solX = solution?.[xVar];
    const solY = solution?.[yVar];

    const xLo = xv?.lb !== null && xv?.lb !== undefined ? xv.lb : Math.min(0, (solX ?? 0) - 5);
    const xHi = xv?.ub !== null && xv?.ub !== undefined ? xv.ub : Math.max(10, (solX ?? 5) * 1.6 + 2);
    const yLo = yv?.lb !== null && yv?.lb !== undefined ? yv.lb : Math.min(0, (solY ?? 0) - 5);
    const yHi = yv?.ub !== null && yv?.ub !== undefined ? yv.ub : Math.max(10, (solY ?? 5) * 1.6 + 2);

    const palette = ["#3b82f6", "#f59e0b", "#ec4899", "#8b5cf6", "#06b6d4", "#10b981"];
    const computedLines: Array<{ name: string; color: string; x1: number; y1: number; x2: number; y2: number }> = [];

    geometry.constraints.forEach((con, idx) => {
      if (!con.linear) return;
      const a = con.linear.coeffs[xVar] ?? 0;
      const b = con.linear.coeffs[yVar] ?? 0;
      if (Math.abs(a) < 1e-12 && Math.abs(b) < 1e-12) return;
      let other = con.linear.constant;
      for (const [k, c] of Object.entries(con.linear.coeffs)) {
        if (k !== xVar && k !== yVar) other += c * (solution?.[k] ?? 0);
      }
      const rhs = con.ub !== null ? con.ub - other : con.lb !== null ? con.lb - other : null;
      if (rhs === null) return;
      const color = palette[idx % palette.length]!;
      if (Math.abs(b) > 1e-9) {
        computedLines.push({
          name: con.name,
          color,
          x1: xLo,
          y1: (rhs - a * xLo) / b,
          x2: xHi,
          y2: (rhs - a * xHi) / b,
        });
      } else if (Math.abs(a) > 1e-9) {
        const vx = rhs / a;
        computedLines.push({ name: con.name, color, x1: vx, y1: yLo, x2: vx, y2: yHi });
      }
    });

    return {
      xMin: xLo,
      xMax: Math.max(xHi, xLo + 1e-6),
      yMin: yLo,
      yMax: Math.max(yHi, yLo + 1e-6),
      lines: computedLines,
      optPt: typeof solX === "number" && typeof solY === "number" ? { x: solX, y: solY } : null,
    };
  }, [geometry, solution, xVar, yVar]);

  const toX = (x: number) => pad + ((x - xMin) / (xMax - xMin)) * plotW;
  const toY = (y: number) => pad + plotH - ((y - yMin) / (yMax - yMin)) * plotH;

  if (geometry.variables.length < 2) {
    return <div style={{ color: "var(--ms-text-2)", fontSize: "12px" }}>Need at least 2 variables for 2D plot.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <div style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "11px" }}>
        <label>
          X:{" "}
          <select value={xVar} onChange={(e) => setXVar(e.target.value)}>
            {geometry.variables.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Y:{" "}
          <select value={yVar} onChange={(e) => setYVar(e.target.value)}>
            {geometry.variables.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{
          width: "100%",
          maxWidth: `${width}px`,
          background: "var(--ms-bg-alt)",
          border: "1px solid var(--ms-border)",
          borderRadius: "6px",
        }}
      >
        <defs>
          <clipPath id="ampl-2d-clip">
            <rect x={pad} y={pad} width={plotW} height={plotH} />
          </clipPath>
        </defs>
        <rect x={pad} y={pad} width={plotW} height={plotH} fill="none" stroke="var(--ms-border)" />
        <g clipPath="url(#ampl-2d-clip)">
          {lines.map((ln) => (
            <line
              key={ln.name}
              x1={toX(ln.x1)}
              y1={toY(ln.y1)}
              x2={toX(ln.x2)}
              y2={toY(ln.y2)}
              stroke={ln.color}
              strokeWidth={1.75}
            >
              <title>{ln.name}</title>
            </line>
          ))}
          {optPt && (
            <circle cx={toX(optPt.x)} cy={toY(optPt.y)} r={5} fill="#10b981" stroke="#ffffff" strokeWidth={1.5}>
              <title>{`Optimal (${formatNum(optPt.x)}, ${formatNum(optPt.y)})`}</title>
            </circle>
          )}
        </g>
        <text x={pad + plotW / 2} y={height - 8} textAnchor="middle" fill="var(--ms-text-2)" fontSize={10}>
          {xVar} [{formatNum(xMin)}, {formatNum(xMax)}]
        </text>
        <text
          x={12}
          y={pad + plotH / 2}
          textAnchor="middle"
          fill="var(--ms-text-2)"
          fontSize={10}
          transform={`rotate(-90, 12, ${pad + plotH / 2})`}
        >
          {yVar}
        </text>
      </svg>
    </div>
  );
};

export const AmplPanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  viewConfig,
  documentUri,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<AmplTabId>("variables");
  const [vizTab, setVizTab] = useState<AmplVizSubTab>("summary");
  const [solveResult, setSolveResult] = useState<AmplSolveResult | null>(null);
  const [geometry, setGeometry] = useState<AmplGeomInfo | null>(null);
  const [sweepPoints, setSweepPoints] = useState<AmplSweepPoint[]>([]);
  const [paretoPoints, setParetoPoints] = useState<AmplParetoPoint[]>([]);
  const [isSolving, setIsSolving] = useState(false);
  const [solveError, setSolveError] = useState<string | null>(null);

  const parsed = useMemo(() => {
    if (!code.trim())
      return {
        model: null,
        diagnostics: [] as { message: string; line?: number }[],
        error: undefined as string | undefined,
      };
    try {
      const res = parseAmplModelWithDiagnostics(code);
      const diags: { message: string; line?: number }[] = (res.errors ?? []).map((d) => ({
        message: d.message,
        ...(d.range?.start?.line !== undefined ? { line: d.range.start.line } : {}),
      }));
      return { model: res.model, diagnostics: diags, error: undefined };
    } catch (err) {
      return {
        model: null,
        diagnostics: [] as { message: string; line?: number }[],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [code]);

  const executeAmplAction = useCallback(
    async <R,>(actionId: string, extraParams: Record<string, unknown> = {}): Promise<R | null> => {
      if (!host.requestLsp) return null;
      return host.requestLsp<R>("modelscript/executeAction", {
        actionId,
        languageId: "ampl",
        uri: documentUri ?? "file:///document.ampl",
        documentText: code,
        ...extraParams,
      });
    },
    [code, documentUri, host],
  );

  const handleSolve = useCallback(async () => {
    setIsSolving(true);
    setSolveError(null);
    setActiveTab("solve");
    try {
      const res = await executeAmplAction<AmplSolveResult>("ampl_solve");
      if (res) setSolveResult(res);
      const geo = await executeAmplAction<AmplGeomInfo>("ampl_inspect_geometry");
      if (geo) setGeometry(geo);
    } catch (err) {
      setSolveError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSolving(false);
    }
  }, [executeAmplAction]);

  const handleRunSweep = useCallback(async () => {
    if (!geometry || geometry.constraints.length === 0) return;
    setIsSolving(true);
    setSolveError(null);
    try {
      const target = geometry.constraints[0]!;
      const base = target.ub ?? target.lb ?? 10;
      const res = await executeAmplAction<{ points?: AmplSweepPoint[] }>("ampl_sweep", {
        targetType: target.ub !== null ? "constraint_ub" : "constraint_lb",
        targetName: target.name,
        minVal: base * 0.5,
        maxVal: base * 1.5,
        steps: 15,
      });
      setSweepPoints(res?.points ?? []);
    } catch (err) {
      setSolveError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSolving(false);
    }
  }, [executeAmplAction, geometry]);

  const handleRunPareto = useCallback(async () => {
    if (!geometry || geometry.objectives.length < 2) return;
    setIsSolving(true);
    setSolveError(null);
    try {
      const res = await executeAmplAction<{ points?: AmplParetoPoint[] }>("ampl_pareto", {
        obj1: geometry.objectives[0]!.name,
        obj2: geometry.objectives[1]!.name,
        steps: 12,
      });
      setParetoPoints(res?.points ?? []);
    } catch (err) {
      setSolveError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSolving(false);
    }
  }, [executeAmplAction, geometry]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) || "AMPL Mathematical Optimization Model";

  const sets = useMemo(() => Array.from(parsed.model?.sets?.values() ?? []), [parsed.model]);
  const params = useMemo(() => Array.from(parsed.model?.params?.values() ?? []), [parsed.model]);
  const vars = useMemo(() => Array.from(parsed.model?.vars?.values() ?? []), [parsed.model]);
  const objectives = useMemo(() => Array.from(parsed.model?.objectives?.values() ?? []), [parsed.model]);
  const constraints = useMemo(() => Array.from(parsed.model?.constraints?.values() ?? []), [parsed.model]);

  const kpis = useMemo<PanelKpiItem[]>(
    () => [
      { label: "Sets", value: sets.length },
      { label: "Params", value: params.length },
      { label: "Variables", value: vars.length, tone: "info" },
      { label: "Objectives", value: objectives.length, tone: "success" },
      { label: "Constraints", value: constraints.length },
      ...(solveResult?.objectiveValue !== undefined && solveResult?.objectiveValue !== null
        ? [{ label: "Optimum", value: formatNum(solveResult.objectiveValue), tone: "success" as const }]
        : []),
    ],
    [sets.length, params.length, vars.length, objectives.length, constraints.length, solveResult?.objectiveValue],
  );

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="AMPL Optimization Inspector"
        badge={parsed.error ? { label: "Parse Error", tone: "danger" } : { label: "AMPL", tone: "info" }}
        actions={
          <div style={{ display: "flex", gap: "6px" }}>
            {host.requestLsp && (
              <PanelButton variant="primary" onClick={() => void handleSolve()} disabled={isSolving}>
                {isSolving ? "Solving…" : "Solve"}
              </PanelButton>
            )}
            {mode === "artifact" && host.openInAnsatzEditor && code && (
              <PanelButton onClick={() => host.openInAnsatzEditor?.(code, dialect || "ampl", title)}>
                Open in Ansatz Editor
              </PanelButton>
            )}
          </div>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<AmplTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "variables", label: "Variables", count: vars.length },
          { id: "objectives", label: "Objectives", count: objectives.length },
          { id: "constraints", label: "Constraints", count: constraints.length },
          { id: "sets", label: "Sets & Params", count: sets.length + params.length },
          { id: "solve", label: "Solve & Viz" },
          { id: "diagnostics", label: "Diagnostics", count: parsed.diagnostics.length },
        ]}
      />

      {activeTab === "variables" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>Variable</th>
                <th style={{ padding: "5px 6px" }}>Domain</th>
                <th style={{ padding: "5px 6px" }}>Type</th>
              </tr>
            </thead>
            <tbody>
              {vars.map((v, idx) => (
                <tr
                  key={`${v.name}-${idx}`}
                  style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                >
                  <td style={{ padding: "4px 6px", fontWeight: 600 }}>{v.name}</td>
                  <td style={{ padding: "4px 6px", color: "var(--ms-text-2)" }}>{v.indexing ? "indexed" : "scalar"}</td>
                  <td style={{ padding: "4px 6px" }}>{v.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "objectives" && (
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
          }}
        >
          {objectives.map((obj, idx) => (
            <div
              key={`${obj.name}-${idx}`}
              style={{
                padding: "8px 10px",
                borderRadius: "6px",
                background: "var(--ms-bg-alt)",
                border: "1px solid var(--ms-border)",
              }}
            >
              <span
                style={{ fontWeight: 700, textTransform: "uppercase", color: "var(--ms-brand)", marginRight: "8px" }}
              >
                {obj.direction}
              </span>
              <span style={{ fontFamily: "var(--ms-font-mono)", fontWeight: 600 }}>{obj.name}</span>
            </div>
          ))}
        </div>
      )}

      {activeTab === "constraints" && (
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
          }}
        >
          {constraints.map((con, idx) => (
            <div
              key={`${con.name}-${idx}`}
              style={{
                padding: "7px 10px",
                borderRadius: "6px",
                background: "var(--ms-bg-alt)",
                border: "1px solid var(--ms-border)",
                fontFamily: "var(--ms-font-mono)",
              }}
            >
              <span style={{ fontWeight: 600 }}>{con.name}</span>
            </div>
          ))}
        </div>
      )}

      {activeTab === "sets" && (
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
          }}
        >
          {sets.map((s, idx) => (
            <div
              key={`set-${s.name}-${idx}`}
              style={{
                padding: "6px 10px",
                borderRadius: "6px",
                background: "var(--ms-bg-alt)",
                border: "1px solid var(--ms-border)",
                fontFamily: "var(--ms-font-mono)",
              }}
            >
              set <strong>{s.name}</strong>
            </div>
          ))}
          {params.map((p, idx) => (
            <div
              key={`param-${p.name}-${idx}`}
              style={{
                padding: "6px 10px",
                borderRadius: "6px",
                background: "var(--ms-bg-alt)",
                border: "1px solid var(--ms-border)",
                fontFamily: "var(--ms-font-mono)",
              }}
            >
              param <strong>{p.name}</strong>
            </div>
          ))}
        </div>
      )}

      {activeTab === "solve" && (
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          {solveError && (
            <div
              style={{
                padding: "8px 10px",
                borderRadius: "6px",
                border: "1px solid #ef4444",
                color: "#ef4444",
                fontSize: "12px",
              }}
            >
              {solveError}
            </div>
          )}

          {!solveResult ? (
            <div style={{ color: "var(--ms-text-2)", fontSize: "12px" }}>
              Click <strong>Solve</strong> to run the COIN-OR / HiGHS / IPOPT solver and unlock 2D constraint,
              sensitivity sweep, and Pareto front visualizations.
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {(["summary", "constraints2d", "sweep", "pareto"] as AmplVizSubTab[]).map((t) => (
                  <PanelButton key={t} variant={vizTab === t ? "primary" : "default"} onClick={() => setVizTab(t)}>
                    {t === "summary"
                      ? "Solution"
                      : t === "constraints2d"
                        ? "2D Constraints"
                        : t === "sweep"
                          ? "Sensitivity Sweep"
                          : "Pareto Front"}
                  </PanelButton>
                ))}
              </div>

              {vizTab === "summary" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div style={{ fontSize: "12px", color: "var(--ms-text-2)" }}>
                    Status: <strong>{solveResult.status ?? "unknown"}</strong>
                    {solveResult.solverUsed ? ` • Solver: ${solveResult.solverUsed}` : ""}
                    {solveResult.solveTimeMs !== undefined ? ` • ${solveResult.solveTimeMs.toFixed(1)} ms` : ""}
                  </div>
                  {solveResult.variables && (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
                      <thead>
                        <tr
                          style={{
                            textAlign: "left",
                            borderBottom: "1px solid var(--ms-border)",
                            color: "var(--ms-text-2)",
                          }}
                        >
                          <th style={{ padding: "4px 6px" }}>Variable</th>
                          <th style={{ padding: "4px 6px" }}>Value</th>
                          <th style={{ padding: "4px 6px" }}>Reduced Cost (.rc)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(solveResult.variables).map(([name, val]) => (
                          <tr
                            key={name}
                            style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                          >
                            <td style={{ padding: "4px 6px", fontWeight: 600 }}>{name}</td>
                            <td style={{ padding: "4px 6px" }}>{formatNum(val)}</td>
                            <td style={{ padding: "4px 6px", color: "var(--ms-text-2)" }}>
                              {formatNum(solveResult.variableSuffixes?.[name]?.["rc"])}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {vizTab === "constraints2d" && geometry && (
                <AmplConstraints2DSvg geometry={geometry} solution={solveResult.variables} />
              )}

              {vizTab === "sweep" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div>
                    <PanelButton onClick={() => void handleRunSweep()} disabled={isSolving || !geometry}>
                      Run 1D Constraint Sweep
                    </PanelButton>
                  </div>
                  {sweepPoints.length > 0 && (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
                      <thead>
                        <tr
                          style={{
                            textAlign: "left",
                            borderBottom: "1px solid var(--ms-border)",
                            color: "var(--ms-text-2)",
                          }}
                        >
                          <th style={{ padding: "4px 6px" }}>Parameter Value</th>
                          <th style={{ padding: "4px 6px" }}>Objective</th>
                          <th style={{ padding: "4px 6px" }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sweepPoints.map((pt, i) => (
                          <tr
                            key={i}
                            style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                          >
                            <td style={{ padding: "4px 6px" }}>{formatNum(pt.paramValue)}</td>
                            <td style={{ padding: "4px 6px" }}>{formatNum(pt.objectiveValue)}</td>
                            <td style={{ padding: "4px 6px" }}>{pt.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {vizTab === "pareto" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div>
                    <PanelButton
                      onClick={() => void handleRunPareto()}
                      disabled={isSolving || !geometry || geometry.objectives.length < 2}
                    >
                      Compute Pareto Front
                    </PanelButton>
                  </div>
                  {geometry && geometry.objectives.length < 2 && (
                    <div style={{ color: "var(--ms-text-2)", fontSize: "12px" }}>
                      Model requires at least 2 objectives for Pareto front analysis.
                    </div>
                  )}
                  {paretoPoints.length > 0 && (
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
                      <thead>
                        <tr
                          style={{
                            textAlign: "left",
                            borderBottom: "1px solid var(--ms-border)",
                            color: "var(--ms-text-2)",
                          }}
                        >
                          <th style={{ padding: "4px 6px" }}>Objective 1</th>
                          <th style={{ padding: "4px 6px" }}>Objective 2</th>
                          <th style={{ padding: "4px 6px" }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paretoPoints.map((pt, i) => (
                          <tr
                            key={i}
                            style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                          >
                            <td style={{ padding: "4px 6px" }}>{formatNum(pt.obj1)}</td>
                            <td style={{ padding: "4px 6px" }}>{formatNum(pt.obj2)}</td>
                            <td style={{ padding: "4px 6px" }}>{pt.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === "diagnostics" && (
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
          }}
        >
          {parsed.diagnostics.length === 0 ? (
            <div style={{ color: "var(--ms-text-2)" }}>No AMPL parse diagnostics.</div>
          ) : (
            parsed.diagnostics.map((d, idx) => (
              <div
                key={idx}
                onClick={() => d.line && host.onRevealLine?.(d.line)}
                style={{
                  padding: "7px 10px",
                  borderRadius: "6px",
                  background: "var(--ms-bg-alt)",
                  border: "1px solid var(--ms-border)",
                  cursor: d.line ? "pointer" : "default",
                }}
              >
                {d.message}
              </div>
            ))
          )}
        </div>
      )}
    </PanelShell>
  );
};

export default AmplPanel;
