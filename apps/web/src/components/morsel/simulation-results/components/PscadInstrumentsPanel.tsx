// SPDX-License-Identifier: AGPL-3.0-or-later

import { evaluateHarmonicDistortion, extractSequencePhasors } from "@modelscript/pscad";
import React, { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface PscadInstrumentsPanelProps {
  data: Record<string, number | string>[];
  variables: string[];
  colorMode: "light" | "dark";
  nominalFreqHz?: number | undefined;
  onClose?: (() => void) | undefined;
}

const PHASE_COLORS = ["#ef4444", "#eab308", "#3b82f6"];

function computeFundamentalPhasor(
  time: Float64Array,
  vals: Float64Array,
  freqHz: number,
): { mag: number; deg: number; rms: number; peak: number } {
  const n = time.length;
  if (n < 4) return { mag: 0, deg: 0, rms: 0, peak: 0 };
  const dt = Math.max(1e-9, (time[n - 1]! - time[0]!) / Math.max(1, n - 1));
  const cycleSteps = Math.max(4, Math.min(n, Math.round(1 / (freqHz * dt))));
  const start = n - cycleSteps;
  const omega = 2 * Math.PI * freqHz;
  let re = 0;
  let im = 0;
  let sumSq = 0;
  let peak = 0;
  for (let k = start; k < n; k++) {
    const v = vals[k] ?? 0;
    const t = (k - start) * dt;
    re += v * Math.cos(omega * t);
    im -= v * Math.sin(omega * t);
    sumSq += v * v;
    const av = Math.abs(v);
    if (av > peak) peak = av;
  }
  const cRe = (2 / cycleSteps) * re;
  const cIm = (2 / cycleSteps) * im;
  const mag = Math.hypot(cRe, cIm) / Math.SQRT2;
  const deg = (Math.atan2(cIm, cRe) * 180) / Math.PI;
  const rms = Math.sqrt(sumSq / cycleSteps);
  return { mag, deg, rms, peak };
}

export const PscadInstrumentsPanel: React.FC<PscadInstrumentsPanelProps> = ({
  data,
  variables,
  colorMode,
  nominalFreqHz = 60,
  onClose,
}) => {
  const isDark = colorMode === "dark";
  const [freqHz, setFreqHz] = useState(nominalFreqHz);
  const [selectedHarmonicVar, setSelectedHarmonicVar] = useState<string>(() => variables[0] || "");
  const [trigEdge, setTrigEdge] = useState<"rising" | "falling">("rising");
  const [trigLevel, setTrigLevel] = useState(0);
  const [windowCycles, setWindowCycles] = useState(2);
  const [fftWinStartPct, setFftWinStartPct] = useState(0);
  const [fftWinEndPct, setFftWinEndPct] = useState(100);

  const threePhaseGroups = useMemo(() => {
    const groups = new Map<string, { a: string; b: string; c: string }>();
    const varSet = new Set(variables);
    for (const v of variables) {
      if (v.endsWith("_a")) {
        const base = v.slice(0, -2);
        if (varSet.has(`${base}_b`) && varSet.has(`${base}_c`)) {
          groups.set(base, { a: `${base}_a`, b: `${base}_b`, c: `${base}_c` });
        }
      }
    }
    return Array.from(groups.entries()).map(([base, chs]) => ({ base, ...chs }));
  }, [variables]);

  const [selectedGroup, setSelectedGroup] = useState<string>(() => threePhaseGroups[0]?.base || "");
  const activeGroup = useMemo(
    () => threePhaseGroups.find((g) => g.base === selectedGroup) ?? threePhaseGroups[0],
    [threePhaseGroups, selectedGroup],
  );

  const timeArr = useMemo(() => {
    const arr = new Float64Array(data.length);
    for (let i = 0; i < data.length; i++) arr[i] = Number(data[i]?.["time"] ?? i);
    return arr;
  }, [data]);

  const activeHarmonicVar = variables.includes(selectedHarmonicVar) ? selectedHarmonicVar : variables[0] || "";

  const harmonicResult = useMemo(() => {
    if (!activeHarmonicVar || data.length < 16) return null;
    const i0 = Math.max(0, Math.floor((fftWinStartPct / 100) * data.length));
    const i1 = Math.max(i0 + 16, Math.min(data.length, Math.ceil((fftWinEndPct / 100) * data.length)));
    const len = i1 - i0;
    const tWin = timeArr.subarray(i0, i1);
    const wf = new Float64Array(len);
    for (let i = 0; i < len; i++) wf[i] = Number(data[i0 + i]?.[activeHarmonicVar] ?? 0);
    return evaluateHarmonicDistortion(tWin, wf, freqHz, 25);
  }, [activeHarmonicVar, data, timeArr, freqHz, fftWinStartPct, fftWinEndPct]);

  const harmonicBars = useMemo(() => {
    if (!harmonicResult) return [];
    const bars: { order: string; pct: number }[] = [];
    for (let h = 1; h < harmonicResult.harmonics.length; h++) {
      bars.push({
        order: `h${h + 1}`,
        pct: Number((harmonicResult.harmonics[h] ?? 0).toFixed(2)),
      });
    }
    return bars;
  }, [harmonicResult]);

  const phasorData = useMemo(() => {
    const chList = activeGroup ? [activeGroup.a, activeGroup.b, activeGroup.c] : variables.slice(0, 3);
    const items = chList.map((ch, idx) => {
      const wf = new Float64Array(data.length);
      for (let i = 0; i < data.length; i++) wf[i] = Number(data[i]?.[ch] ?? 0);
      const ph = computeFundamentalPhasor(timeArr, wf, freqHz);
      return { name: ch, color: PHASE_COLORS[idx % PHASE_COLORS.length]!, ...ph };
    });
    const maxMag = Math.max(1e-9, ...items.map((x) => x.mag));

    let seqSummary: { v0: number; v1: number; v2: number } | null = null;
    if (activeGroup && data.length >= 4) {
      const va = new Float64Array(data.length);
      const vb = new Float64Array(data.length);
      const vc = new Float64Array(data.length);
      for (let i = 0; i < data.length; i++) {
        va[i] = Number(data[i]?.[activeGroup.a] ?? 0);
        vb[i] = Number(data[i]?.[activeGroup.b] ?? 0);
        vc[i] = Number(data[i]?.[activeGroup.c] ?? 0);
      }
      const seq = extractSequencePhasors(timeArr, { a: va, b: vb, c: vc }, { a: va, b: vb, c: vc }, freqHz);
      const last = data.length - 1;
      seqSummary = { v0: seq.v0[last] ?? 0, v1: seq.v1[last] ?? 0, v2: seq.v2[last] ?? 0 };
    }
    return { items, maxMag, seqSummary };
  }, [activeGroup, variables, data, timeArr, freqHz]);

  const borderColor = isDark ? "#30363d" : "#d0d7de";
  const panelBg = isDark ? "#121214" : "#f6f8fa";
  const cardBg = isDark ? "#1b1d22" : "#ffffff";
  const mutedColor = isDark ? "#8b949e" : "#57606a";

  return (
    <div
      style={{
        border: `1px solid ${borderColor}`,
        borderRadius: 10,
        background: panelBg,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <strong style={{ fontSize: 13 }}>PSCAD Instruments (PhasorMeter · FFT · PolyMeter)</strong>
          <label style={{ fontSize: 11, color: mutedColor, display: "inline-flex", alignItems: "center", gap: 4 }}>
            f₀:
            <select
              value={freqHz}
              onChange={(e) => setFreqHz(Number(e.target.value))}
              style={{
                fontSize: 11,
                padding: "2px 6px",
                borderRadius: 4,
                border: `1px solid ${borderColor}`,
                background: cardBg,
                color: "inherit",
              }}
            >
              <option value={60}>60 Hz</option>
              <option value={50}>50 Hz</option>
            </select>
          </label>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            style={{
              border: `1px solid ${borderColor}`,
              background: cardBg,
              color: "inherit",
              borderRadius: 6,
              padding: "3px 8px",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            Close
          </button>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
        {/* PhasorMeter */}
        <div style={{ border: `1px solid ${borderColor}`, borderRadius: 8, background: cardBg, padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>PhasorMeter (Polar DFT)</span>
            {threePhaseGroups.length > 0 && (
              <select
                value={activeGroup?.base ?? ""}
                onChange={(e) => setSelectedGroup(e.target.value)}
                style={{
                  fontSize: 11,
                  padding: "2px 6px",
                  borderRadius: 4,
                  border: `1px solid ${borderColor}`,
                  background: "transparent",
                  color: "inherit",
                }}
              >
                {threePhaseGroups.map((g) => (
                  <option key={g.base} value={g.base}>
                    {g.base} (abc)
                  </option>
                ))}
              </select>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <svg width={150} height={150} viewBox="-80 -80 160 160" aria-label="PhasorMeter polar plot">
              <circle cx={0} cy={0} r={64} fill="none" stroke={borderColor} strokeDasharray="3,3" />
              <circle cx={0} cy={0} r={32} fill="none" stroke={borderColor} strokeDasharray="2,3" />
              <line x1={-70} y1={0} x2={70} y2={0} stroke={borderColor} strokeWidth={0.8} />
              <line x1={0} y1={-70} x2={0} y2={70} stroke={borderColor} strokeWidth={0.8} />
              {phasorData.items.map((p) => {
                const len = (p.mag / phasorData.maxMag) * 60;
                const rad = (p.deg * Math.PI) / 180;
                const x2 = len * Math.cos(rad);
                const y2 = -len * Math.sin(rad);
                return (
                  <g key={p.name}>
                    <line x1={0} y1={0} x2={x2} y2={y2} stroke={p.color} strokeWidth={2.2} />
                    <circle cx={x2} cy={y2} r={3} fill={p.color} />
                  </g>
                );
              })}
            </svg>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, fontFamily: "monospace" }}>
              {phasorData.items.map((p) => (
                <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span
                    style={{ width: 8, height: 8, borderRadius: "50%", background: p.color, display: "inline-block" }}
                  />
                  <span>{p.name}:</span>
                  <strong>
                    {p.mag.toPrecision(4)} ∠ {p.deg.toFixed(1)}°
                  </strong>
                </div>
              ))}
              {phasorData.seqSummary && (
                <div style={{ marginTop: 4, paddingTop: 4, borderTop: `1px solid ${borderColor}`, color: mutedColor }}>
                  V₁={phasorData.seqSummary.v1.toPrecision(3)} · V₂={phasorData.seqSummary.v2.toPrecision(3)} · V₀=
                  {phasorData.seqSummary.v0.toPrecision(3)}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Harmonic Spectrum (FFT) */}
        <div style={{ border: `1px solid ${borderColor}`, borderRadius: 8, background: cardBg, padding: 12 }}>
          <div
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 6 }}
          >
            <span style={{ fontSize: 12, fontWeight: 600 }}>
              Harmonic Spectrum {harmonicResult ? `(THD: ${harmonicResult.thdPercent.toFixed(2)}%)` : ""}
            </span>
            <select
              value={activeHarmonicVar}
              onChange={(e) => setSelectedHarmonicVar(e.target.value)}
              style={{
                fontSize: 11,
                padding: "2px 6px",
                borderRadius: 4,
                border: `1px solid ${borderColor}`,
                background: "transparent",
                color: "inherit",
                maxWidth: 150,
              }}
            >
              {variables.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div
            style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, fontSize: 10, color: mutedColor }}
          >
            <span>
              Win {fftWinStartPct}%–{fftWinEndPct}%
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(0, fftWinEndPct - 10)}
              value={fftWinStartPct}
              onChange={(e) => setFftWinStartPct(Number(e.target.value))}
              style={{ width: 64 }}
              title="Window Start (%)"
            />
            <input
              type="range"
              min={Math.min(100, fftWinStartPct + 10)}
              max={100}
              value={fftWinEndPct}
              onChange={(e) => setFftWinEndPct(Number(e.target.value))}
              style={{ width: 64 }}
              title="Window End (%)"
            />
          </div>
          <div style={{ height: 150, width: "100%" }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={harmonicBars} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={borderColor} />
                <XAxis dataKey="order" tick={{ fontSize: 10, fill: mutedColor }} interval={2} />
                <YAxis tick={{ fontSize: 10, fill: mutedColor }} unit="%" />
                <Tooltip
                  contentStyle={{
                    background: cardBg,
                    border: `1px solid ${borderColor}`,
                    fontSize: 11,
                  }}
                />
                <Bar dataKey="pct" name="% of Fundamental" fill="#38bdf8" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* PolyMeter (Multi-Channel RMS / Peak Readout) */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 8 }}>
        {phasorData.items.map((p) => (
          <div
            key={p.name}
            style={{
              border: `1px solid ${borderColor}`,
              borderRadius: 6,
              background: cardBg,
              padding: "6px 10px",
              fontSize: 11,
            }}
          >
            <div style={{ color: mutedColor, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>
              {p.name}
            </div>
            <div style={{ fontFamily: "monospace", marginTop: 2 }}>
              RMS: <strong>{p.rms.toPrecision(4)}</strong> · Pk: {p.peak.toPrecision(4)}
            </div>
          </div>
        ))}
      </div>

      {/* PolyMeter (Multi-Channel RMS / Peak + P / Q / S / PF Readout) */}
      {(() => {
        const vGroup =
          threePhaseGroups.find((g) => g.base === activeGroup?.base && /^v/i.test(g.base)) ??
          threePhaseGroups.find((g) => /^v/i.test(g.base));
        const iGroup = threePhaseGroups.find((g) => /^i/i.test(g.base));
        let powerMetrics: { pTot: number; qTot: number; sTot: number; pf: number; label: string } | null = null;
        const computeGroupPhasors = (chs: string[]) =>
          chs.map((ch) => {
            const wf = new Float64Array(data.length);
            for (let i = 0; i < data.length; i++) wf[i] = Number(data[i]?.[ch] ?? 0);
            return computeFundamentalPhasor(timeArr, wf, freqHz);
          });
        if (vGroup && iGroup) {
          const vs = computeGroupPhasors([vGroup.a, vGroup.b, vGroup.c]);
          const is = computeGroupPhasors([iGroup.a, iGroup.b, iGroup.c]);
          let pSum = 0;
          let qSum = 0;
          for (let idx = 0; idx < 3; idx++) {
            const theta = ((vs[idx]!.deg - is[idx]!.deg) * Math.PI) / 180;
            pSum += vs[idx]!.rms * is[idx]!.rms * Math.cos(theta);
            qSum += vs[idx]!.rms * is[idx]!.rms * Math.sin(theta);
          }
          const sTot = Math.hypot(pSum, qSum);
          powerMetrics = {
            pTot: pSum,
            qTot: qSum,
            sTot,
            pf: sTot > 1e-9 ? pSum / sTot : 1,
            label: `${vGroup.base} · ${iGroup.base}`,
          };
        } else {
          const vChs = phasorData.items.filter((x) => /^v/i.test(x.name));
          const iChs = phasorData.items.filter((x) => /^i/i.test(x.name));
          if (vChs.length > 0 && iChs.length > 0) {
            const pairs = Math.min(3, vChs.length, iChs.length);
            let pSum = 0;
            let qSum = 0;
            for (let idx = 0; idx < pairs; idx++) {
              const theta = ((vChs[idx]!.deg - iChs[idx]!.deg) * Math.PI) / 180;
              pSum += vChs[idx]!.rms * iChs[idx]!.rms * Math.cos(theta);
              qSum += vChs[idx]!.rms * iChs[idx]!.rms * Math.sin(theta);
            }
            if (pairs === 1) {
              pSum *= 3;
              qSum *= 3;
            }
            const sTot = Math.hypot(pSum, qSum);
            powerMetrics = { pTot: pSum, qTot: qSum, sTot, pf: sTot > 1e-9 ? pSum / sTot : 1, label: "3-Ph" };
          }
        }
        return powerMetrics ? (
          <div
            style={{
              border: `1px solid ${borderColor}`,
              borderRadius: 6,
              background: cardBg,
              padding: "6px 12px",
              display: "flex",
              gap: 16,
              flexWrap: "wrap",
              fontSize: 11,
              fontFamily: "monospace",
            }}
          >
            <span>
              P = <strong>{(powerMetrics.pTot / 1e6).toFixed(3)} MW</strong>
            </span>
            <span>
              Q = <strong>{(powerMetrics.qTot / 1e6).toFixed(3)} Mvar</strong>
            </span>
            <span>
              S = <strong>{(powerMetrics.sTot / 1e6).toFixed(3)} MVA</strong>
            </span>
            <span>
              PF = <strong>{powerMetrics.pf.toFixed(3)}</strong>
            </span>
          </div>
        ) : null;
      })()}

      {/* Triggered Oscilloscope */}
      {activeHarmonicVar && data.length >= 4 && (
        <div style={{ border: `1px solid ${borderColor}`, borderRadius: 8, background: cardBg, padding: 12 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 8,
              marginBottom: 8,
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600 }}>Triggered Oscilloscope ({activeHarmonicVar})</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
              <select
                value={trigEdge}
                onChange={(e) => setTrigEdge(e.target.value as "rising" | "falling")}
                style={{
                  padding: "2px 6px",
                  borderRadius: 4,
                  border: `1px solid ${borderColor}`,
                  background: "transparent",
                  color: "inherit",
                }}
              >
                <option value="rising">Rising</option>
                <option value="falling">Falling</option>
              </select>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 4, color: mutedColor }}>
                Level:
                <input
                  type="number"
                  value={trigLevel}
                  onChange={(e) => setTrigLevel(Number(e.target.value) || 0)}
                  style={{
                    width: 64,
                    padding: "2px 4px",
                    borderRadius: 4,
                    border: `1px solid ${borderColor}`,
                    background: "transparent",
                    color: "inherit",
                  }}
                />
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 4, color: mutedColor }}>
                Cycles:
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={windowCycles}
                  onChange={(e) => setWindowCycles(Math.max(1, Math.min(10, Number(e.target.value) || 2)))}
                  style={{
                    width: 44,
                    padding: "2px 4px",
                    borderRadius: 4,
                    border: `1px solid ${borderColor}`,
                    background: "transparent",
                    color: "inherit",
                  }}
                />
              </label>
            </div>
          </div>
          {(() => {
            const winSec = windowCycles / Math.max(1, freqHz);
            let trigIdx = Math.floor(data.length / 2);
            let triggered = false;
            for (let i = 1; i < data.length; i++) {
              const prev = Number(data[i - 1]?.[activeHarmonicVar] ?? 0);
              const curr = Number(data[i]?.[activeHarmonicVar] ?? 0);
              const hit =
                trigEdge === "rising" ? prev < trigLevel && curr >= trigLevel : prev > trigLevel && curr <= trigLevel;
              if (hit) {
                trigIdx = i;
                triggered = true;
                break;
              }
            }
            const tTrig = Number(data[trigIdx]?.["time"] ?? 0);
            const scopeRows = data
              .filter((r) => {
                const dt = Number(r["time"] ?? 0) - tTrig;
                return dt >= -0.25 * winSec && dt <= 0.75 * winSec;
              })
              .map((r) => ({
                tMs: Number(((Number(r["time"] ?? 0) - tTrig) * 1e3).toFixed(3)),
                val: Number(r[activeHarmonicVar] ?? 0),
              }));
            return (
              <div>
                <div style={{ fontSize: 10, color: triggered ? "#10b981" : "#d29922", marginBottom: 4 }}>
                  {triggered ? `TRIGGERED @ t = ${tTrig.toFixed(4)} s` : "UNTRIGGERED (midpoint window)"}
                </div>
                <div style={{ height: 140, width: "100%" }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={scopeRows} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={borderColor} />
                      <XAxis
                        dataKey="tMs"
                        type="number"
                        domain={["dataMin", "dataMax"]}
                        tick={{ fontSize: 10, fill: mutedColor }}
                        unit=" ms"
                      />
                      <YAxis tick={{ fontSize: 10, fill: mutedColor }} />
                      <Tooltip
                        contentStyle={{ background: cardBg, border: `1px solid ${borderColor}`, fontSize: 11 }}
                      />
                      <ReferenceLine x={0} stroke="#f59e0b" strokeDasharray="3 3" />
                      <ReferenceLine y={trigLevel} stroke="#8b949e" strokeDasharray="2 2" />
                      <Line
                        type="monotone"
                        dataKey="val"
                        name={activeHarmonicVar}
                        stroke="#10b981"
                        dot={false}
                        strokeWidth={1.8}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};
