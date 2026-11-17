// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useMemo, useState } from "react";

export interface AmplGeomVar {
  id: number;
  name: string;
  type: string;
  lb: number | null;
  ub: number | null;
}

export interface AmplGeomObjective {
  name: string;
  direction: "minimize" | "maximize";
  constant: number;
  linearCoeffs: Record<string, number>;
  isLinear: boolean;
}

export interface AmplGeomConstraint {
  name: string;
  lb: number | null;
  ub: number | null;
  constant: number;
  linearCoeffs: Record<string, number>;
  isLinear: boolean;
}

export interface AmplGeomInfo {
  problemName: string;
  problemClass: string;
  variables: AmplGeomVar[];
  objectives: AmplGeomObjective[];
  constraints: AmplGeomConstraint[];
  parameters: Array<{ name: string; value: number }>;
}

interface Pt {
  x: number;
  y: number;
}

const LINE_COLORS = ["#3b82f6", "#f59e0b", "#ec4899", "#8b5cf6", "#06b6d4", "#ef4444", "#84cc16"];

/** Clips a convex polygon against half-plane a*x + b*y <= rhs. */
function clipHalfPlane(poly: Pt[], a: number, b: number, rhs: number): Pt[] {
  if (poly.length === 0) return [];
  const eps = 1e-9;
  const out: Pt[] = [];
  const inside = (p: Pt) => a * p.x + b * p.y <= rhs + eps;
  const intersect = (p1: Pt, p2: Pt): Pt => {
    const d1 = a * p1.x + b * p1.y - rhs;
    const d2 = a * p2.x + b * p2.y - rhs;
    const denom = d1 - d2;
    if (Math.abs(denom) < 1e-12) return p1;
    const t = d1 / denom;
    return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
  };

  for (let i = 0; i < poly.length; i++) {
    const curr = poly[i]!;
    const prev = poly[(i + poly.length - 1) % poly.length]!;
    const currIn = inside(curr);
    const prevIn = inside(prev);
    if (currIn) {
      if (!prevIn) out.push(intersect(prev, curr));
      out.push(curr);
    } else if (prevIn) {
      out.push(intersect(prev, curr));
    }
  }
  return out;
}

/** Clips line a*x + b*y = rhs to box [xMin, xMax] x [yMin, yMax]. */
function clipLineToBox(
  a: number,
  b: number,
  rhs: number,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
): [Pt, Pt] | null {
  const pts: Pt[] = [];
  const eps = 1e-9;
  if (Math.abs(b) > eps) {
    const yAtMin = (rhs - a * xMin) / b;
    if (yAtMin >= yMin - eps && yAtMin <= yMax + eps) pts.push({ x: xMin, y: yAtMin });
    const yAtMax = (rhs - a * xMax) / b;
    if (yAtMax >= yMin - eps && yAtMax <= yMax + eps) pts.push({ x: xMax, y: yAtMax });
  }
  if (Math.abs(a) > eps) {
    const xAtMin = (rhs - b * yMin) / a;
    if (xAtMin > xMin + eps && xAtMin < xMax - eps) pts.push({ x: xAtMin, y: yMin });
    const xAtMax = (rhs - b * yMax) / a;
    if (xAtMax > xMin + eps && xAtMax < xMax - eps) pts.push({ x: xAtMax, y: yMax });
  }
  if (pts.length < 2) return null;
  return [pts[0]!, pts[pts.length - 1]!];
}

export const AmplConstraints2D: React.FC<{
  geometry: AmplGeomInfo;
  solution: Record<string, number>;
  constraintSuffixes?: Record<string, Record<string, unknown>>;
}> = ({ geometry, solution, constraintSuffixes }) => {
  const vars = geometry.variables;
  const [varXName, setVarXName] = useState<string>(() => vars[0]?.name ?? "");
  const [varYName, setVarYName] = useState<string>(() => vars[1]?.name ?? vars[0]?.name ?? "");
  const [fixedOverrides, setFixedOverrides] = useState<Record<string, number>>({});
  const [hoverPt, setHoverPt] = useState<Pt | null>(null);

  const effectiveX = vars.some((v) => v.name === varXName) ? varXName : (vars[0]?.name ?? "");
  const effectiveY = vars.some((v) => v.name === varYName) ? varYName : (vars[1]?.name ?? vars[0]?.name ?? "");

  const borderCol = "var(--color-border-default, var(--ms-border, rgba(148, 163, 184, 0.18)))";
  const cardBg = "var(--bgColor-muted, var(--ms-bg-elv))";
  const textPrimary = "var(--ms-text-1, var(--color-fg-default))";
  const textMuted = "var(--ms-text-2, var(--color-fg-muted))";

  const varX = vars.find((v) => v.name === effectiveX) ?? vars[0];
  const varY = vars.find((v) => v.name === effectiveY) ?? vars[1] ?? vars[0];
  const otherVars = vars.filter((v) => v.name !== effectiveX && v.name !== effectiveY);

  const getFixedVal = (name: string) => fixedOverrides[name] ?? solution[name] ?? 0;

  const { xMin, xMax, yMin, yMax, feasiblePoly, lines, contours, optPt } = useMemo(() => {
    if (!varX || !varY || vars.length < 2) {
      return {
        xMin: 0,
        xMax: 1,
        yMin: 0,
        yMax: 1,
        feasiblePoly: [] as Pt[],
        lines: [] as Array<{
          name: string;
          a: number;
          b: number;
          rhs: number;
          sense: "<=" | ">=" | "=";
          color: string;
          slack?: number;
          dual?: number;
        }>,
        contours: [] as Array<{ level: number; p1: Pt; p2: Pt }>,
        optPt: null as Pt | null,
      };
    }
    const ox = solution[effectiveX] ?? 0;
    const oy = solution[effectiveY] ?? 0;

    // Gather intercepts to auto-frame the viewport
    const xs: number[] = [0, ox];
    const ys: number[] = [0, oy];
    if (varX.lb !== null) xs.push(varX.lb);
    if (varX.ub !== null) xs.push(varX.ub);
    if (varY.lb !== null) ys.push(varY.lb);
    if (varY.ub !== null) ys.push(varY.ub);

    const parsedLines: Array<{
      name: string;
      a: number;
      b: number;
      rhs: number;
      sense: "<=" | ">=" | "=";
      color: string;
      binding: boolean;
    }> = [];

    geometry.constraints.forEach((con, idx) => {
      const a = con.linearCoeffs[effectiveX] ?? 0;
      const b = con.linearCoeffs[effectiveY] ?? 0;
      if (Math.abs(a) < 1e-12 && Math.abs(b) < 1e-12) return;

      let fixedContrib = con.constant;
      for (const [k, c] of Object.entries(con.linearCoeffs)) {
        if (k !== effectiveX && k !== effectiveY) {
          fixedContrib += c * getFixedVal(k);
        }
      }

      const color = LINE_COLORS[idx % LINE_COLORS.length]!;
      const slack = constraintSuffixes?.[con.name]?.slack;
      const binding = slack !== undefined && Math.abs(Number(slack)) < 1e-7;

      const addBound = (bound: number, sense: "<=" | ">=" | "=") => {
        const rhs = bound - fixedContrib;
        parsedLines.push({ name: con.name, a, b, rhs, sense, color, binding });
        if (Math.abs(a) > 1e-9) xs.push(rhs / a);
        if (Math.abs(b) > 1e-9) ys.push(rhs / b);
      };

      if (con.lb !== null && con.ub !== null && Math.abs(con.lb - con.ub) < 1e-9) {
        addBound(con.ub, "=");
      } else {
        if (con.ub !== null) addBound(con.ub, "<=");
        if (con.lb !== null) addBound(con.lb, ">=");
      }
    });

    const rawXMin = Math.min(...xs);
    const rawXMax = Math.max(...xs);
    const rawYMin = Math.min(...ys);
    const rawYMax = Math.max(...ys);
    const padX = Math.max((rawXMax - rawXMin) * 0.18, 1.5);
    const padY = Math.max((rawYMax - rawYMin) * 0.18, 1.5);

    const x0 = varX.lb !== null ? Math.min(rawXMin, varX.lb) - padX * 0.35 : rawXMin - padX;
    const x1 = rawXMax + padX;
    const y0 = varY.lb !== null ? Math.min(rawYMin, varY.lb) - padY * 0.35 : rawYMin - padY;
    const y1 = rawYMax + padY;

    let poly: Pt[] = [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ];

    if (varX.lb !== null) poly = clipHalfPlane(poly, -1, 0, -varX.lb);
    if (varX.ub !== null) poly = clipHalfPlane(poly, 1, 0, varX.ub);
    if (varY.lb !== null) poly = clipHalfPlane(poly, 0, -1, -varY.lb);
    if (varY.ub !== null) poly = clipHalfPlane(poly, 0, 1, varY.ub);

    for (const ln of parsedLines) {
      if (ln.sense === "<=") {
        poly = clipHalfPlane(poly, ln.a, ln.b, ln.rhs);
      } else if (ln.sense === ">=") {
        poly = clipHalfPlane(poly, -ln.a, -ln.b, -ln.rhs);
      } else {
        poly = clipHalfPlane(poly, ln.a, ln.b, ln.rhs);
        poly = clipHalfPlane(poly, -ln.a, -ln.b, -ln.rhs);
      }
    }

    // Objective contours
    const obj = geometry.objectives[0];
    const contourLines: Array<{ seg: [Pt, Pt]; level: number; isOpt: boolean }> = [];
    if (obj) {
      const ca = obj.linearCoeffs[effectiveX] ?? 0;
      const cb = obj.linearCoeffs[effectiveY] ?? 0;
      if (Math.abs(ca) > 1e-12 || Math.abs(cb) > 1e-12) {
        const optLevel = ca * ox + cb * oy;
        const step = Math.max(Math.abs(optLevel) * 0.25, 1);
        for (const mult of [-2, -1, 0, 1]) {
          const level = optLevel + mult * step;
          const seg = clipLineToBox(ca, cb, level, x0, x1, y0, y1);
          if (seg) contourLines.push({ seg, level, isOpt: mult === 0 });
        }
      }
    }

    return {
      xMin: x0,
      xMax: x1,
      yMin: y0,
      yMax: y1,
      feasiblePoly: poly,
      lines: parsedLines,
      contours: contourLines,
      optPt: { x: ox, y: oy },
    };
  }, [geometry, effectiveX, effectiveY, solution, fixedOverrides, constraintSuffixes]);

  if (vars.length < 2) {
    return (
      <div style={{ padding: 24, color: textMuted, fontSize: 13 }}>
        At least 2 decision variables are required for 2D constraint visualization (found {vars.length}).
      </div>
    );
  }

  const W = 680;
  const H = 430;
  const pad = { l: 58, r: 24, t: 24, b: 46 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;

  const sx = (x: number) => pad.l + ((x - xMin) / (xMax - xMin || 1)) * plotW;
  const sy = (y: number) => pad.t + plotH - ((y - yMin) / (yMax - yMin || 1)) * plotH;
  const invX = (px: number) => xMin + ((px - pad.l) / plotW) * (xMax - xMin || 1);
  const invY = (py: number) => yMin + ((pad.t + plotH - py) / plotH) * (yMax - yMin || 1);

  const ticks = 5;
  const xTicks = Array.from({ length: ticks + 1 }, (_, i) => xMin + ((xMax - xMin) * i) / ticks);
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => yMin + ((yMax - yMin) * i) / ticks);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Controls */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
          <span style={{ color: textMuted }}>X-Axis:</span>
          <select
            value={effectiveX}
            onChange={(e) => setVarXName(e.target.value)}
            style={{
              padding: "4px 8px",
              borderRadius: 6,
              border: `1px solid ${borderCol}`,
              backgroundColor: cardBg,
              color: textPrimary,
              fontSize: 12,
            }}
          >
            {vars.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
          <span style={{ color: textMuted }}>Y-Axis:</span>
          <select
            value={effectiveY}
            onChange={(e) => setVarYName(e.target.value)}
            style={{
              padding: "4px 8px",
              borderRadius: 6,
              border: `1px solid ${borderCol}`,
              backgroundColor: cardBg,
              color: textPrimary,
              fontSize: 12,
            }}
          >
            {vars.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name}
              </option>
            ))}
          </select>
        </label>

        {hoverPt && (
          <span style={{ fontSize: 12, fontFamily: "monospace", color: textMuted, marginLeft: "auto" }}>
            {effectiveX}={hoverPt.x.toFixed(2)}, {effectiveY}={hoverPt.y.toFixed(2)}
          </span>
        )}
      </div>

      {/* Sliders for remaining variables if >2 vars */}
      {otherVars.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 14,
            padding: "8px 12px",
            borderRadius: 8,
            border: `1px solid ${borderCol}`,
            backgroundColor: cardBg,
          }}
        >
          {otherVars.slice(0, 6).map((ov) => {
            const val = getFixedVal(ov.name);
            const lo = ov.lb ?? 0;
            const hi = ov.ub ?? Math.max(10, Math.abs(val) * 2 || 10);
            return (
              <label key={ov.name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                <span style={{ fontFamily: "monospace" }}>
                  {ov.name} = {val.toFixed(2)}
                </span>
                <input
                  type="range"
                  min={lo}
                  max={hi}
                  step={(hi - lo) / 50 || 0.1}
                  value={val}
                  onChange={(e) => setFixedOverrides((p) => ({ ...p, [ov.name]: Number(e.target.value) }))}
                />
              </label>
            );
          })}
        </div>
      )}

      {/* Plot + Legend */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
        <div
          style={{
            border: `1px solid ${borderCol}`,
            borderRadius: 8,
            backgroundColor: cardBg,
            padding: 8,
            flex: "1 1 520px",
          }}
        >
          <svg
            viewBox={`0 0 ${W} ${H}`}
            style={{ width: "100%", height: "auto", display: "block" }}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const px = ((e.clientX - rect.left) / rect.width) * W;
              const py = ((e.clientY - rect.top) / rect.height) * H;
              if (px >= pad.l && px <= W - pad.r && py >= pad.t && py <= H - pad.b) {
                setHoverPt({ x: invX(px), y: invY(py) });
              } else {
                setHoverPt(null);
              }
            }}
            onMouseLeave={() => setHoverPt(null)}
          >
            <defs>
              <clipPath id="ampl-2d-plot-clip">
                <rect x={pad.l} y={pad.t} width={plotW} height={plotH} />
              </clipPath>
            </defs>

            {/* Grid */}
            {xTicks.map((t, i) => (
              <g key={`xg-${i}`}>
                <line x1={sx(t)} y1={pad.t} x2={sx(t)} y2={H - pad.b} stroke="rgba(148,163,184,0.16)" />
                <text x={sx(t)} y={H - pad.b + 16} textAnchor="middle" fontSize="10" fill="currentColor" opacity={0.65}>
                  {t.toFixed(1)}
                </text>
              </g>
            ))}
            {yTicks.map((t, i) => (
              <g key={`yg-${i}`}>
                <line x1={pad.l} y1={sy(t)} x2={W - pad.r} y2={sy(t)} stroke="rgba(148,163,184,0.16)" />
                <text x={pad.l - 8} y={sy(t) + 3} textAnchor="end" fontSize="10" fill="currentColor" opacity={0.65}>
                  {t.toFixed(1)}
                </text>
              </g>
            ))}

            {/* Axes labels */}
            <text
              x={pad.l + plotW / 2}
              y={H - 8}
              textAnchor="middle"
              fontSize="11"
              fontWeight="600"
              fill="currentColor"
            >
              {effectiveX}
            </text>
            <text
              x={14}
              y={pad.t + plotH / 2}
              textAnchor="middle"
              fontSize="11"
              fontWeight="600"
              fill="currentColor"
              transform={`rotate(-90 14 ${pad.t + plotH / 2})`}
            >
              {effectiveY}
            </text>

            <g clipPath="url(#ampl-2d-plot-clip)">
              {/* Feasible Region */}
              {feasiblePoly.length >= 3 && (
                <polygon
                  points={feasiblePoly.map((p) => `${sx(p.x)},${sy(p.y)}`).join(" ")}
                  fill="rgba(13, 148, 136, 0.22)"
                  stroke="#0d9488"
                  strokeWidth={2}
                />
              )}

              {/* Objective Contours */}
              {contours.map((c, idx) => (
                <line
                  key={`c-${idx}`}
                  x1={sx(c.seg[0].x)}
                  y1={sy(c.seg[0].y)}
                  x2={sx(c.seg[1].x)}
                  y2={sy(c.seg[1].y)}
                  stroke={c.isOpt ? "#22c55e" : "rgba(148,163,184,0.45)"}
                  strokeWidth={c.isOpt ? 1.8 : 1}
                  strokeDasharray={c.isOpt ? "6 4" : "3 4"}
                />
              ))}

              {/* Constraint Lines */}
              {lines.map((ln, idx) => {
                const seg = clipLineToBox(ln.a, ln.b, ln.rhs, xMin, xMax, yMin, y1Bound(yMax));
                if (!seg) return null;
                const midX = (sx(seg[0].x) + sx(seg[1].x)) / 2;
                const midY = (sy(seg[0].y) + sy(seg[1].y)) / 2;
                return (
                  <g key={`ln-${idx}`}>
                    <line
                      x1={sx(seg[0].x)}
                      y1={sy(seg[0].y)}
                      x2={sx(seg[1].x)}
                      y2={sy(seg[1].y)}
                      stroke={ln.color}
                      strokeWidth={ln.binding ? 2.4 : 1.5}
                    />
                    <text x={midX + 4} y={midY - 5} fontSize="10" fontWeight="600" fill={ln.color}>
                      {ln.name}
                    </text>
                  </g>
                );
              })}

              {/* Optimal Point */}
              <circle cx={sx(optPt.x)} cy={sy(optPt.y)} r={7} fill="rgba(34, 197, 94, 0.28)" />
              <circle cx={sx(optPt.x)} cy={sy(optPt.y)} r={4.5} fill="#22c55e" stroke="#ffffff" strokeWidth={1.5} />
              <text x={sx(optPt.x) + 10} y={sy(optPt.y) - 8} fontSize="11" fontWeight="700" fill="#22c55e">
                Optimum ({optPt.x.toFixed(2)}, {optPt.y.toFixed(2)})
              </text>
            </g>

            {/* Plot Frame */}
            <rect x={pad.l} y={pad.t} width={plotW} height={plotH} fill="none" stroke="rgba(148,163,184,0.35)" />
          </svg>
        </div>

        {/* Legend */}
        <div
          style={{
            minWidth: 200,
            maxWidth: 260,
            border: `1px solid ${borderCol}`,
            borderRadius: 8,
            backgroundColor: cardBg,
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            fontSize: 12,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 2 }}>Constraints &amp; Contours</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 12,
                height: 12,
                backgroundColor: "rgba(13,148,136,0.35)",
                border: "1px solid #0d9488",
                borderRadius: 2,
              }}
            />
            <span>Feasible Region</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 12, height: 2, borderTop: "2px dashed #22c55e" }} />
            <span>Optimal Objective Contour</span>
          </div>
          {lines.map((ln, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 12, height: 3, backgroundColor: ln.color, borderRadius: 1 }} />
                <span style={{ fontFamily: "monospace" }}>{ln.name}</span>
              </div>
              {ln.binding && <span style={{ fontSize: 10, color: "#d29922", fontWeight: 700 }}>binding</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

function y1Bound(v: number): number {
  return v;
}
