// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useState } from "react";
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { executeLspAction } from "../../util/lsp-bridge";
import type { AmplGeomInfo } from "./AmplConstraints2D";

export const AmplParetoFront: React.FC<{
  geometry: AmplGeomInfo;
  documentUri: string;
  documentText: string;
}> = ({ geometry, documentUri, documentText }) => {
  const hasMultiObj = geometry.objectives.length >= 2;
  const [obj1Name, setObj1Name] = useState(geometry.objectives[0]?.name ?? "");
  const [obj2Name, setObj2Name] = useState(geometry.objectives[1]?.name ?? "");
  const [constraintName, setConstraintName] = useState(
    geometry.constraints.find((c) => c.ub !== null || c.lb !== null)?.name ?? "",
  );
  const [steps, setSteps] = useState(21);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  interface ParetoPoint {
    index: number;
    epsilon: number | null;
    feasible: boolean;
    obj1: number | null;
    obj2: number | null;
    isPareto: boolean;
    variables: Record<string, number>;
  }
  interface ParetoResultData {
    obj1Name: string;
    obj2Name: string;
    obj1Direction?: string;
    obj2Direction?: string;
    constraintName?: string | null;
    points: ParetoPoint[];
  }
  const [paretoResult, setParetoResult] = useState<ParetoResultData | null>(null);
  const [selectedPt, setSelectedPt] = useState<ParetoPoint | null>(null);

  const borderCol = "var(--color-border-default, var(--ms-border, rgba(148, 163, 184, 0.18)))";
  const cardBg = "var(--bgColor-muted, var(--ms-bg-elv))";
  const textPrimary = "var(--ms-text-1, var(--color-fg-default))";
  const textMuted = "var(--ms-text-2, var(--color-fg-muted))";

  const computePareto = async () => {
    setBusy(true);
    setError(null);
    setSelectedPt(null);
    try {
      const res = (await executeLspAction("ampl_pareto", "ampl", documentUri, {
        documentText,
        obj1Name: obj1Name || undefined,
        obj2Name: obj2Name || undefined,
        constraintName: constraintName || undefined,
        steps,
      })) as ParetoResultData | null;
      setParetoResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const allPts = paretoResult?.points ?? [];
  const paretoPts = allPts.filter((p) => p.isPareto);
  const dominatedPts = allPts.filter((p) => !p.isPareto);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          alignItems: "center",
          padding: 12,
          borderRadius: 8,
          border: `1px solid ${borderCol}`,
          backgroundColor: cardBg,
          fontSize: 12,
        }}
      >
        {hasMultiObj ? (
          <>
            <span style={{ color: textMuted }}>Bi-Objective Mode:</span>
            <select
              value={obj1Name}
              onChange={(e) => setObj1Name(e.target.value)}
              style={{
                padding: "4px 8px",
                borderRadius: 6,
                border: `1px solid ${borderCol}`,
                backgroundColor: "var(--color-bg-primary)",
                color: textPrimary,
              }}
            >
              {geometry.objectives.map((o) => (
                <option key={o.name} value={o.name}>
                  {o.direction} {o.name}
                </option>
              ))}
            </select>
            <span style={{ color: textMuted }}>vs</span>
            <select
              value={obj2Name}
              onChange={(e) => setObj2Name(e.target.value)}
              style={{
                padding: "4px 8px",
                borderRadius: 6,
                border: `1px solid ${borderCol}`,
                backgroundColor: "var(--color-bg-primary)",
                color: textPrimary,
              }}
            >
              {geometry.objectives.map((o) => (
                <option key={o.name} value={o.name}>
                  {o.direction} {o.name}
                </option>
              ))}
            </select>
          </>
        ) : (
          <>
            <span style={{ color: textMuted }}>Trade-off (ε-Constraint):</span>
            <span style={{ fontWeight: 600 }}>{geometry.objectives[0]?.name ?? "Objective"}</span>
            <span style={{ color: textMuted }}>vs Resource</span>
            <select
              value={constraintName}
              onChange={(e) => setConstraintName(e.target.value)}
              style={{
                padding: "4px 8px",
                borderRadius: 6,
                border: `1px solid ${borderCol}`,
                backgroundColor: "var(--color-bg-primary)",
                color: textPrimary,
              }}
            >
              {geometry.constraints
                .filter((c) => c.ub !== null || c.lb !== null)
                .map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
            </select>
          </>
        )}

        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ color: textMuted }}>Points:</span>
          <input
            type="number"
            min={5}
            max={41}
            value={steps}
            onChange={(e) => setSteps(Number(e.target.value))}
            style={{
              width: 54,
              padding: "4px 6px",
              borderRadius: 6,
              border: `1px solid ${borderCol}`,
              backgroundColor: "var(--color-bg-primary)",
              color: textPrimary,
            }}
          />
        </label>

        <button
          type="button"
          onClick={() => void computePareto()}
          disabled={busy}
          style={{
            padding: "5px 14px",
            borderRadius: 6,
            border: "none",
            backgroundColor: "#0d9488",
            color: "#ffffff",
            fontWeight: 600,
            cursor: busy ? "wait" : "pointer",
            marginLeft: "auto",
          }}
        >
          {busy ? "Computing…" : "Compute Pareto Front"}
        </button>
      </div>

      {error && (
        <div
          style={{
            padding: 10,
            borderRadius: 6,
            border: "1px solid rgba(239,68,68,0.45)",
            color: "#f87171",
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}

      {!paretoResult && !busy && (
        <div
          style={{
            padding: 28,
            textAlign: "center",
            color: textMuted,
            border: `1px dashed ${borderCol}`,
            borderRadius: 8,
          }}
        >
          Click <strong>Compute Pareto Front</strong> to trace the non-dominated trade-off frontier.
          {!hasMultiObj && " (Add a second minimize/maximize objective for multi-objective weighted-sum Pareto.)"}
        </div>
      )}

      {paretoResult && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
          <div
            style={{
              flex: "1 1 480px",
              height: 350,
              border: `1px solid ${borderCol}`,
              borderRadius: 8,
              backgroundColor: cardBg,
              padding: 12,
            }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.16)" />
                <XAxis type="number" dataKey="obj1Val" name={paretoResult.obj1.name} stroke="#94a3b8" fontSize={11} />
                <YAxis type="number" dataKey="obj2Val" name={paretoResult.obj2.name} stroke="#94a3b8" fontSize={11} />
                <ZAxis range={[60, 60]} />
                <Tooltip
                  cursor={{ strokeDasharray: "3 3" }}
                  contentStyle={{
                    backgroundColor: "#0f172a",
                    border: "1px solid #334155",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                />
                {dominatedPts.length > 0 && (
                  <Scatter name="Dominated" data={dominatedPts} fill="#64748b" onClick={(pt) => setSelectedPt(pt)} />
                )}
                <Scatter
                  name="Pareto Optimal"
                  data={paretoPts}
                  fill="#22c55e"
                  line={{ stroke: "#22c55e", strokeWidth: 2 }}
                  onClick={(pt) => setSelectedPt(pt)}
                />
              </ScatterChart>
            </ResponsiveContainer>
          </div>

          <div
            style={{
              minWidth: 220,
              maxWidth: 280,
              border: `1px solid ${borderCol}`,
              borderRadius: 8,
              backgroundColor: cardBg,
              padding: 12,
              fontSize: 12,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ fontWeight: 700 }}>Frontier Summary</div>
            <div style={{ color: textMuted }}>
              X: <strong>{paretoResult.obj1.name}</strong> ({paretoResult.obj1.direction})
            </div>
            <div style={{ color: textMuted }}>
              Y: <strong>{paretoResult.obj2.name}</strong> ({paretoResult.obj2.direction})
            </div>
            <div style={{ color: "#22c55e", fontWeight: 600 }}>
              {paretoPts.length} Pareto-optimal · {dominatedPts.length} dominated
            </div>
            {selectedPt ? (
              <div style={{ marginTop: 6, paddingTop: 8, borderTop: `1px solid ${borderCol}` }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Selected Solution</div>
                <div style={{ fontFamily: "monospace", fontSize: 11 }}>
                  {paretoResult.obj1.name}: {Number(selectedPt.obj1Val).toFixed(3)}
                  <br />
                  {paretoResult.obj2.name}: {Number(selectedPt.obj2Val).toFixed(3)}
                </div>
                <div style={{ marginTop: 6, fontFamily: "monospace", fontSize: 11, color: textMuted }}>
                  {Object.entries(selectedPt.variables ?? {}).map(([k, v]) => (
                    <div key={k}>
                      {k} = {Number(v).toFixed(3)}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ color: textMuted, fontSize: 11, marginTop: 4 }}>
                Click any point on the scatter plot to inspect its decision variables.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
