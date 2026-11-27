// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { executeLspAction } from "../../util/lsp-bridge";
import type { AmplGeomInfo } from "./AmplConstraints2D";

interface SweepOption {
  id: string;
  label: string;
  targetType: "param" | "constraint_ub" | "constraint_lb" | "var_ub" | "var_lb";
  targetName: string;
  defaultVal: number;
}

export const AmplFitnessLandscape: React.FC<{
  geometry: AmplGeomInfo;
  documentUri: string;
  documentText: string;
}> = ({ geometry, documentUri, documentText }) => {
  const options = useMemo<SweepOption[]>(() => {
    const out: SweepOption[] = [];
    for (const p of geometry.parameters) {
      out.push({
        id: `param:${p.name}`,
        label: `param ${p.name} (=${p.value})`,
        targetType: "param",
        targetName: p.name,
        defaultVal: p.value,
      });
    }
    for (const c of geometry.constraints) {
      if (c.ub !== null) {
        out.push({
          id: `cub:${c.name}`,
          label: `${c.name} <= RHS (=${c.ub})`,
          targetType: "constraint_ub",
          targetName: c.name,
          defaultVal: c.ub,
        });
      }
      if (c.lb !== null) {
        out.push({
          id: `clb:${c.name}`,
          label: `${c.name} >= LHS (=${c.lb})`,
          targetType: "constraint_lb",
          targetName: c.name,
          defaultVal: c.lb,
        });
      }
    }
    for (const v of geometry.variables) {
      if (v.ub !== null) {
        out.push({
          id: `vub:${v.name}`,
          label: `${v.name} ub (=${v.ub})`,
          targetType: "var_ub",
          targetName: v.name,
          defaultVal: v.ub,
        });
      }
    }
    return out;
  }, [geometry]);

  const [mode, setMode] = useState<"1d" | "2d">("1d");
  const [target1Id, setTarget1Id] = useState<string>(() => options[0]?.id ?? "");
  const [target2Id, setTarget2Id] = useState<string>(() => options[1]?.id ?? options[0]?.id ?? "");
  const [steps, setSteps] = useState<number>(21);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  interface SweepPoint {
    p1: number;
    p2?: number | undefined;
    status: string;
    feasible: boolean;
    objectiveValue: number | null;
    variables: Record<string, number>;
  }
  interface SweepPoint2D extends SweepPoint {
    p2: number;
  }
  interface SweepResultData {
    mode: "1d" | "2d";
    target1: { targetName: string; targetType: string; min: number; max: number; steps: number };
    target2?: { targetName: string; targetType: string; min: number; max: number; steps: number } | undefined;
    objectiveName?: string;
    points: SweepPoint[];
  }
  const [sweepResult, setSweepResult] = useState<SweepResultData | null>(null);
  const [hoveredCell, setHoveredCell] = useState<SweepPoint2D | null>(null);

  const t1 = options.find((o) => o.id === target1Id) ?? options[0];
  const t2 = options.find((o) => o.id === target2Id) ?? options[1] ?? options[0];

  const [min1, setMin1] = useState<number>(() => (t1 ? Math.max(0, t1.defaultVal * 0.25) : 0));
  const [max1, setMax1] = useState<number>(() => (t1 ? Math.max(t1.defaultVal * 1.75, t1.defaultVal + 5) : 10));
  const [min2, setMin2] = useState<number>(() => (t2 ? Math.max(0, t2.defaultVal * 0.25) : 0));
  const [max2, setMax2] = useState<number>(() => (t2 ? Math.max(t2.defaultVal * 1.75, t2.defaultVal + 5) : 10));

  const borderCol = "var(--color-border-default, var(--ms-border, rgba(148, 163, 184, 0.18)))";
  const cardBg = "var(--bgColor-muted, var(--ms-bg-elv))";
  const textPrimary = "var(--ms-text-1, var(--color-fg-default))";
  const textMuted = "var(--ms-text-2, var(--color-fg-muted))";

  const handleSelect1 = (id: string) => {
    setTarget1Id(id);
    const opt = options.find((o) => o.id === id);
    if (opt) {
      setMin1(Math.max(0, Number((opt.defaultVal * 0.25).toFixed(2))));
      setMax1(Number(Math.max(opt.defaultVal * 1.75, opt.defaultVal + 5).toFixed(2)));
    }
  };

  const handleSelect2 = (id: string) => {
    setTarget2Id(id);
    const opt = options.find((o) => o.id === id);
    if (opt) {
      setMin2(Math.max(0, Number((opt.defaultVal * 0.25).toFixed(2))));
      setMax2(Number(Math.max(opt.defaultVal * 1.75, opt.defaultVal + 5).toFixed(2)));
    }
  };

  const runSweep = async () => {
    if (!t1) return;
    setBusy(true);
    setError(null);
    try {
      const target1Payload = {
        targetType: t1.targetType,
        targetName: t1.targetName,
        min: min1,
        max: max1,
        steps: mode === "2d" ? Math.min(steps, 16) : steps,
      };
      const payload: {
        documentText: string;
        target1: typeof target1Payload;
        target2?: typeof target1Payload;
      } = {
        documentText,
        target1: target1Payload,
      };
      if (mode === "2d" && t2) {
        payload.target2 = {
          targetType: t2.targetType,
          targetName: t2.targetName,
          min: min2,
          max: max2,
          steps: Math.min(steps, 16),
        };
      }
      const res = (await executeLspAction("ampl_sweep", "ampl", documentUri, payload)) as SweepResultData | null;
      setSweepResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const heatmapStats = useMemo(() => {
    if (!sweepResult || sweepResult.mode !== "2d") return null;
    const pts = (sweepResult.points ?? []).filter((p): p is SweepPoint2D => p.p2 !== undefined);
    const vals = pts.filter((p) => p.feasible && p.objectiveValue !== null).map((p) => p.objectiveValue!);
    const zMin = vals.length ? Math.min(...vals) : 0;
    const zMax = vals.length ? Math.max(...vals) : 1;
    const u1 = Array.from(new Set(pts.map((p) => p.p1))).sort((a, b) => a - b);
    const u2 = Array.from(new Set(pts.map((p) => p.p2))).sort((a, b) => a - b);
    return { pts, zMin, zMax, u1, u2 };
  }, [sweepResult]);

  if (options.length === 0) {
    return (
      <div style={{ padding: 24, color: textMuted, fontSize: 13 }}>
        No sweepable parameters, constraint bounds, or variable bounds found in this model.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Sweep Controls */}
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
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as "1d" | "2d")}
          style={{
            padding: "4px 8px",
            borderRadius: 6,
            border: `1px solid ${borderCol}`,
            backgroundColor: "var(--color-bg-primary)",
            color: textPrimary,
          }}
        >
          <option value="1d">1D Parameter Sweep</option>
          {options.length >= 2 && <option value="2d">2D Fitness Landscape</option>}
        </select>

        <select
          value={t1?.id ?? ""}
          onChange={(e) => handleSelect1(e.target.value)}
          style={{
            padding: "4px 8px",
            borderRadius: 6,
            border: `1px solid ${borderCol}`,
            backgroundColor: "var(--color-bg-primary)",
            color: textPrimary,
          }}
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>

        <input
          type="number"
          value={min1}
          onChange={(e) => setMin1(Number(e.target.value))}
          style={{
            width: 70,
            padding: "4px 6px",
            borderRadius: 6,
            border: `1px solid ${borderCol}`,
            backgroundColor: "var(--color-bg-primary)",
            color: textPrimary,
          }}
          title="Min 1"
        />
        <span style={{ color: textMuted }}>to</span>
        <input
          type="number"
          value={max1}
          onChange={(e) => setMax1(Number(e.target.value))}
          style={{
            width: 70,
            padding: "4px 6px",
            borderRadius: 6,
            border: `1px solid ${borderCol}`,
            backgroundColor: "var(--color-bg-primary)",
            color: textPrimary,
          }}
          title="Max 1"
        />

        {mode === "2d" && (
          <>
            <span style={{ color: textMuted, marginLeft: 4 }}>×</span>
            <select
              value={t2?.id ?? ""}
              onChange={(e) => handleSelect2(e.target.value)}
              style={{
                padding: "4px 8px",
                borderRadius: 6,
                border: `1px solid ${borderCol}`,
                backgroundColor: "var(--color-bg-primary)",
                color: textPrimary,
              }}
            >
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              type="number"
              value={min2}
              onChange={(e) => setMin2(Number(e.target.value))}
              style={{
                width: 70,
                padding: "4px 6px",
                borderRadius: 6,
                border: `1px solid ${borderCol}`,
                backgroundColor: "var(--color-bg-primary)",
                color: textPrimary,
              }}
              title="Min 2"
            />
            <span style={{ color: textMuted }}>to</span>
            <input
              type="number"
              value={max2}
              onChange={(e) => setMax2(Number(e.target.value))}
              style={{
                width: 70,
                padding: "4px 6px",
                borderRadius: 6,
                border: `1px solid ${borderCol}`,
                backgroundColor: "var(--color-bg-primary)",
                color: textPrimary,
              }}
              title="Max 2"
            />
          </>
        )}

        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ color: textMuted }}>Steps:</span>
          <input
            type="number"
            min={5}
            max={50}
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
          onClick={() => void runSweep()}
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
          {busy ? "Sweeping…" : "Run Sweep"}
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

      {!sweepResult && !busy && (
        <div
          style={{
            padding: 28,
            textAlign: "center",
            color: textMuted,
            border: `1px dashed ${borderCol}`,
            borderRadius: 8,
          }}
        >
          Configure parameter bounds above and click <strong>Run Sweep</strong> to compute the objective fitness
          landscape.
        </div>
      )}

      {sweepResult?.mode === "1d" && (
        <div
          style={{
            height: 340,
            border: `1px solid ${borderCol}`,
            borderRadius: 8,
            backgroundColor: cardBg,
            padding: 12,
          }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sweepResult.points.map((p) => ({ x: Number(p.p1.toFixed(3)), obj: p.objectiveValue }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.16)" />
              <XAxis dataKey="x" stroke="#94a3b8" fontSize={11} />
              <YAxis stroke="#94a3b8" fontSize={11} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#0f172a",
                  border: "1px solid #334155",
                  borderRadius: 6,
                  fontSize: 12,
                }}
              />
              <Area
                type="monotone"
                dataKey="obj"
                name="Objective"
                stroke="#0d9488"
                fill="rgba(13, 148, 136, 0.25)"
                strokeWidth={2}
                connectNulls={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {sweepResult?.mode === "2d" && sweepResult.target2 && heatmapStats && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: textMuted }}>
            <span>
              X: <strong>{sweepResult.target1.targetName}</strong> · Y:{" "}
              <strong>{sweepResult.target2.targetName}</strong>
            </span>
            <span>
              {hoveredCell
                ? `(${hoveredCell.p1.toFixed(2)}, ${hoveredCell.p2.toFixed(2)}) → ${
                    hoveredCell.feasible ? `Obj = ${hoveredCell.objectiveValue?.toFixed(3)}` : hoveredCell.status
                  }`
                : `Range: [${heatmapStats.zMin.toFixed(2)}, ${heatmapStats.zMax.toFixed(2)}]`}
            </span>
          </div>
          <div
            style={{
              border: `1px solid ${borderCol}`,
              borderRadius: 8,
              backgroundColor: cardBg,
              padding: 12,
              overflowX: "auto",
            }}
          >
            <svg
              viewBox="0 0 560 360"
              style={{ width: "100%", maxWidth: 640, height: "auto", display: "block", margin: "0 auto" }}
            >
              {heatmapStats.pts.map((pt, idx) => {
                const ix = heatmapStats.u1.indexOf(pt.p1);
                const iy = heatmapStats.u2.indexOf(pt.p2);
                const nx = heatmapStats.u1.length || 1;
                const ny = heatmapStats.u2.length || 1;
                const cw = 480 / nx;
                const ch = 300 / ny;
                const x = 50 + ix * cw;
                const y = 16 + (ny - 1 - iy) * ch;
                let fill = "rgba(239, 68, 68, 0.35)";
                if (pt.feasible && pt.objectiveValue !== null) {
                  const t = (pt.objectiveValue - heatmapStats.zMin) / (heatmapStats.zMax - heatmapStats.zMin || 1);
                  const r = Math.round(15 + 20 * (1 - t));
                  const g = Math.round(100 + 130 * t);
                  const b = Math.round(140 - 40 * t);
                  fill = `rgb(${r}, ${g}, ${b})`;
                }
                return (
                  <rect
                    key={idx}
                    x={x}
                    y={y}
                    width={cw + 0.5}
                    height={ch + 0.5}
                    fill={fill}
                    onMouseEnter={() => setHoveredCell(pt)}
                    onMouseLeave={() => setHoveredCell(null)}
                  />
                );
              })}
              <text x={290} y={345} textAnchor="middle" fontSize="11" fill="currentColor">
                {sweepResult.target1.targetName} [{min1}, {max1}]
              </text>
              <text x={16} y={166} textAnchor="middle" fontSize="11" fill="currentColor" transform="rotate(-90 16 166)">
                {sweepResult.target2.targetName} [{min2}, {max2}]
              </text>
            </svg>
          </div>
        </div>
      )}
    </div>
  );
};
