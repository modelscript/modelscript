// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  extractEmtNetlist,
  parsePscx,
  runFrequencyScan,
  runMultipleRunSweep,
  runPointOnWaveSweep,
  type FrequencyScanResult,
  type MultipleRunSweepResult,
  type PointOnWaveSweepResult,
} from "../index.js";

export interface PscadSweepPanelProps {
  code: string;
  colorMode: "light" | "dark";
}

export const PscadSweepPanel: React.FC<PscadSweepPanelProps> = ({ code, colorMode }) => {
  const isDark = colorMode === "dark";
  const borderColor = isDark ? "#30363d" : "#d0d7de";
  const bg = isDark ? "#121214" : "#f6f8fa";
  const cardBg = isDark ? "#1b1d22" : "#ffffff";
  const muted = isDark ? "#8b949e" : "#57606a";

  const [mode, setMode] = useState<"pow" | "mrun" | "freq" | "relay">("pow");
  const [numRuns, setNumRuns] = useState(24);
  const [poleScatterMs, setPoleScatterMs] = useState(1.0);
  const [selectedBreaker, setSelectedBreaker] = useState("");
  const [selectedMrunTarget, setSelectedMrunTarget] = useState("");
  const [mrunMin, setMrunMin] = useState(0.5);
  const [mrunMax, setMrunMax] = useState(1.5);
  const [selectedBus, setSelectedBus] = useState("");
  const [fMinHz, setFMinHz] = useState(1);
  const [fMaxHz, setFMaxHz] = useState(150);
  const [fStepHz, setFStepHz] = useState(2);
  const [coupledFreqMode, setCoupledFreqMode] = useState(true);
  const [powResult, setPowResult] = useState<PointOnWaveSweepResult | null>(null);
  const [mrunResult, setMrunResult] = useState<MultipleRunSweepResult | null>(null);
  const [freqResult, setFreqResult] = useState<FrequencyScanResult | null>(null);
  const [relayZones, setRelayZones] = useState<
    Array<{ id: string; ansiCode: string; z1: number; z2: number; z3: number; angleDeg: number }>
  >([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { busIds, breakerIds, mrunTargets } = useMemo(() => {
    try {
      const proj = parsePscx(code);
      const net = extractEmtNetlist(proj);
      const bIds = Array.from(net.buses.keys());
      const brks = net.branches.filter((b) => b.kind === "switch").map((b) => b.id);
      const targets: Array<{ key: string; targetId: string; paramName: string; defaultVal: number; label: string }> =
        [];
      for (const flt of net.faults ?? []) {
        targets.push({
          key: `${flt.id}:startSec`,
          targetId: flt.id,
          paramName: "startSec",
          defaultVal: flt.startSec || 0.02,
          label: `${flt.id}.startSec`,
        });
      }
      for (const src of net.sources) {
        targets.push({
          key: `${src.id}:vPeakKv`,
          targetId: src.id,
          paramName: "vPeakKv",
          defaultVal: src.vPeakKv || 100,
          label: `${src.id}.vPeakKv`,
        });
      }
      for (const br of net.branches.filter((b) => b.kind === "rlc")) {
        if (br.resistanceOhm > 0) {
          targets.push({
            key: `${br.id}:resistanceOhm`,
            targetId: br.id,
            paramName: "resistanceOhm",
            defaultVal: br.resistanceOhm,
            label: `${br.id}.R`,
          });
        }
      }
      return { busIds: bIds, breakerIds: brks, mrunTargets: targets };
    } catch {
      return { busIds: [], breakerIds: [], mrunTargets: [] };
    }
  }, [code]);

  const activeBus = busIds.includes(selectedBus) ? selectedBus : busIds[0] || "Bus1";
  const activeBreaker = breakerIds.includes(selectedBreaker) ? selectedBreaker : breakerIds[0] || "";
  const activeMrun = mrunTargets.find((t) => t.key === selectedMrunTarget) ?? mrunTargets[0];

  const handleRun = () => {
    setErrorMsg(null);
    try {
      const proj = parsePscx(code);
      const netlist = extractEmtNetlist(proj);
      if (mode === "pow") {
        const res = runPointOnWaveSweep(netlist, {
          ...(activeBreaker ? { breakerId: activeBreaker } : {}),
          poleScatterSec: Math.max(0, poleScatterMs) * 1e-3,
          numRuns: Math.max(4, Math.min(200, numRuns)),
        });
        setPowResult(res);
      } else if (mode === "mrun") {
        const params = activeMrun
          ? [
              {
                targetId: activeMrun.targetId,
                paramName: activeMrun.paramName,
                min: Math.min(mrunMin, mrunMax),
                max: Math.max(mrunMin, mrunMax),
                distribution: "grid" as const,
              },
            ]
          : undefined;
        const res = runMultipleRunSweep(netlist, {
          numRuns: Math.max(4, Math.min(200, numRuns)),
          ...(params ? { parameters: params } : {}),
        });
        setMrunResult(res);
      } else if (mode === "relay") {
        const relays = (netlist.protectionRelays ?? []).map((r) => {
          const z1 = r.zone1ReachOhm ?? 15;
          return {
            id: r.id,
            ansiCode: r.ansiCode,
            z1,
            z2: r.zone2ReachOhm ?? 1.25 * z1,
            z3: r.zone3ReachOhm ?? 1.8 * z1,
            angleDeg: r.mtaDeg ?? 75,
          };
        });
        setRelayZones(
          relays.length > 0 ? relays : [{ id: "Relay_21", ansiCode: "21", z1: 15, z2: 18.75, z3: 27, angleDeg: 75 }],
        );
      } else {
        const minF = Math.max(0.1, fMinHz);
        const maxF = Math.max(minF + 1, fMaxHz);
        const stepF = Math.max(0.1, fStepHz);
        const res = runFrequencyScan(netlist, {
          busId: activeBus,
          fMinHz: minF,
          fMaxHz: maxF,
          fStepHz: stepF,
          mode: coupledFreqMode ? "three_phase_coupled" : "single_phase",
          nominalFrequencyHz: netlist.nominalFrequencyHz || 60,
        });
        setFreqResult(res);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const powBars = useMemo(
    () =>
      (powResult?.histogram ?? []).map((b) => ({
        range: `${b.binMinKv.toFixed(0)}–${b.binMaxKv.toFixed(0)} kV`,
        count: b.count,
        percent: Number(b.percent.toFixed(1)),
      })),
    [powResult],
  );

  const mrunRows = useMemo(
    () =>
      (mrunResult?.runs ?? []).map((r) => ({
        run: `#${r.runIndex + 1}`,
        peakKv: Number(r.maxPeakKv.toFixed(2)),
        currentA: Number(r.maxCurrentAmp.toFixed(1)),
      })),
    [mrunResult],
  );

  const freqRows = useMemo(() => {
    if (!freqResult) return [];
    return freqResult.frequenciesHz.map((f, i) => ({
      f,
      R: Number((freqResult.rOhm[i] ?? 0).toFixed(2)),
      X: Number((freqResult.xOhm[i] ?? 0).toFixed(2)),
      Z: Number((freqResult.zMagOhm[i] ?? 0).toFixed(2)),
      ...(freqResult.z0Ohm?.[i]
        ? { R0: Number(freqResult.z0Ohm[i]!.r.toFixed(2)), X0: Number(freqResult.z0Ohm[i]!.x.toFixed(2)) }
        : {}),
    }));
  }, [freqResult]);

  return (
    <div
      style={{
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        background: bg,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 12.5 }}>Parametric Sweeps & Frequency Scan</strong>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as "pow" | "mrun" | "freq" | "relay")}
            style={{
              fontSize: 11.5,
              padding: "3px 8px",
              borderRadius: 6,
              border: `1px solid ${borderColor}`,
              background: cardBg,
              color: "inherit",
            }}
          >
            <option value="pow">Point-on-Wave (PoW / SSOV)</option>
            <option value="mrun">Multiple-Run (MRUN)</option>
            <option value="freq">Frequency Scan Z(f) (SSCI)</option>
            <option value="relay">Relay Mho (R-X Plane)</option>
          </select>
          {mode === "pow" || mode === "mrun" ? (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                flexWrap: "wrap",
                fontSize: 11,
                color: muted,
              }}
            >
              <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                Runs:
                <input
                  type="number"
                  value={numRuns}
                  min={4}
                  max={200}
                  onChange={(e) => setNumRuns(Number(e.target.value) || 24)}
                  style={{
                    width: 52,
                    padding: "2px 6px",
                    borderRadius: 4,
                    border: `1px solid ${borderColor}`,
                    background: cardBg,
                    color: "inherit",
                  }}
                />
              </label>
              {mode === "pow" && (
                <>
                  {breakerIds.length > 0 && (
                    <select
                      value={activeBreaker}
                      onChange={(e) => setSelectedBreaker(e.target.value)}
                      style={{
                        fontSize: 11,
                        padding: "2px 6px",
                        borderRadius: 4,
                        border: `1px solid ${borderColor}`,
                        background: cardBg,
                        color: "inherit",
                      }}
                    >
                      {breakerIds.map((b) => (
                        <option key={b} value={b}>
                          Brk: {b}
                        </option>
                      ))}
                    </select>
                  )}
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                    σ(ms):
                    <input
                      type="number"
                      value={poleScatterMs}
                      min={0}
                      max={10}
                      step={0.2}
                      onChange={(e) => setPoleScatterMs(Number(e.target.value) || 0)}
                      style={{
                        width: 46,
                        padding: "2px 5px",
                        borderRadius: 4,
                        border: `1px solid ${borderColor}`,
                        background: cardBg,
                        color: "inherit",
                      }}
                    />
                  </label>
                </>
              )}
              {mode === "mrun" && mrunTargets.length > 0 && (
                <>
                  <select
                    value={activeMrun?.key ?? ""}
                    onChange={(e) => {
                      const found = mrunTargets.find((t) => t.key === e.target.value);
                      setSelectedMrunTarget(e.target.value);
                      if (found) {
                        setMrunMin(Number((found.defaultVal * 0.5).toPrecision(3)));
                        setMrunMax(Number((found.defaultVal * 1.5).toPrecision(3)));
                      }
                    }}
                    style={{
                      fontSize: 11,
                      padding: "2px 6px",
                      borderRadius: 4,
                      border: `1px solid ${borderColor}`,
                      background: cardBg,
                      color: "inherit",
                    }}
                  >
                    {mrunTargets.map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                    Min:
                    <input
                      type="number"
                      value={mrunMin}
                      step="any"
                      onChange={(e) => setMrunMin(Number(e.target.value) || 0)}
                      style={{
                        width: 54,
                        padding: "2px 5px",
                        borderRadius: 4,
                        border: `1px solid ${borderColor}`,
                        background: cardBg,
                        color: "inherit",
                      }}
                    />
                  </label>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                    Max:
                    <input
                      type="number"
                      value={mrunMax}
                      step="any"
                      onChange={(e) => setMrunMax(Number(e.target.value) || 0)}
                      style={{
                        width: 54,
                        padding: "2px 5px",
                        borderRadius: 4,
                        border: `1px solid ${borderColor}`,
                        background: cardBg,
                        color: "inherit",
                      }}
                    />
                  </label>
                </>
              )}
            </div>
          ) : mode === "freq" ? (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                flexWrap: "wrap",
                fontSize: 11,
                color: muted,
              }}
            >
              <select
                value={activeBus}
                onChange={(e) => setSelectedBus(e.target.value)}
                style={{
                  fontSize: 11.5,
                  padding: "3px 8px",
                  borderRadius: 6,
                  border: `1px solid ${borderColor}`,
                  background: cardBg,
                  color: "inherit",
                }}
              >
                {busIds.map((b) => (
                  <option key={b} value={b}>
                    Bus: {b}
                  </option>
                ))}
              </select>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                fMin:
                <input
                  type="number"
                  value={fMinHz}
                  min={0.1}
                  max={5000}
                  onChange={(e) => setFMinHz(Number(e.target.value) || 1)}
                  style={{
                    width: 52,
                    padding: "2px 5px",
                    borderRadius: 4,
                    border: `1px solid ${borderColor}`,
                    background: cardBg,
                    color: "inherit",
                  }}
                />
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                fMax:
                <input
                  type="number"
                  value={fMaxHz}
                  min={5}
                  max={10000}
                  onChange={(e) => setFMaxHz(Number(e.target.value) || 150)}
                  style={{
                    width: 56,
                    padding: "2px 5px",
                    borderRadius: 4,
                    border: `1px solid ${borderColor}`,
                    background: cardBg,
                    color: "inherit",
                  }}
                />
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                Δf:
                <input
                  type="number"
                  value={fStepHz}
                  min={0.1}
                  max={100}
                  step={0.5}
                  onChange={(e) => setFStepHz(Number(e.target.value) || 2)}
                  style={{
                    width: 48,
                    padding: "2px 5px",
                    borderRadius: 4,
                    border: `1px solid ${borderColor}`,
                    background: cardBg,
                    color: "inherit",
                  }}
                />
              </label>
              <label
                style={{ display: "inline-flex", alignItems: "center", gap: 3, cursor: "pointer" }}
                title="Distributed hyperbolic Y1/Y0 coupled sequence scan"
              >
                <input
                  type="checkbox"
                  checked={coupledFreqMode}
                  onChange={(e) => setCoupledFreqMode(e.target.checked)}
                />
                3-Ph Coupled (Z₀)
              </label>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={handleRun}
          style={{
            padding: "4px 12px",
            borderRadius: 6,
            fontSize: 11.5,
            fontWeight: 600,
            border: "none",
            background: "var(--ms-brand, #2f81f7)",
            color: "#ffffff",
            cursor: "pointer",
          }}
        >
          Run{" "}
          {mode === "pow" ? "PoW Sweep" : mode === "mrun" ? "MRUN Sweep" : mode === "relay" ? "Mho Plot" : "Freq Scan"}
        </button>
      </div>

      {errorMsg && <div style={{ fontSize: 11, color: "#f85149" }}>{errorMsg}</div>}

      {mode === "relay" &&
        relayZones.length > 0 &&
        (() => {
          const rz = relayZones[0]!;
          const maxR = Math.max(10, rz.z3 * 1.15);
          const rad = (rz.angleDeg * Math.PI) / 180;
          const zoneCircle = (reach: number, color: string, label: string) => {
            const r = reach / 2;
            const cx = r * Math.cos(rad);
            const cy = -r * Math.sin(rad);
            return (
              <g key={label}>
                <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={0.8} />
                <text x={cx + r * 0.5} y={cy - r * 0.5} fontSize={2.4} fill={color}>
                  {label}
                </text>
              </g>
            );
          };
          return (
            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <svg
                width={170}
                height={170}
                viewBox={`${-maxR * 0.6} ${-maxR * 1.05} ${maxR * 1.6} ${maxR * 1.4}`}
                style={{ border: `1px solid ${borderColor}`, borderRadius: 6, background: cardBg }}
                aria-label="Relay Mho R-X plane"
              >
                <line x1={-maxR} y1={0} x2={maxR} y2={0} stroke={borderColor} strokeWidth={0.5} />
                <line x1={0} y1={-maxR} x2={0} y2={maxR * 0.4} stroke={borderColor} strokeWidth={0.5} />
                {zoneCircle(rz.z3, "#a855f7", "Z3")}
                {zoneCircle(rz.z2, "#f59e0b", "Z2")}
                {zoneCircle(rz.z1, "#ef4444", "Z1")}
              </svg>
              <div style={{ fontSize: 11.5, fontFamily: "monospace", color: muted }}>
                <div>
                  <strong>{rz.id}</strong> (ANSI {rz.ansiCode}) · MTA {rz.angleDeg}°
                </div>
                <div>Zone 1: {rz.z1.toFixed(2)} Ω</div>
                <div>Zone 2: {rz.z2.toFixed(2)} Ω</div>
                <div>Zone 3: {rz.z3.toFixed(2)} Ω</div>
              </div>
            </div>
          );
        })()}

      {mode === "mrun" && mrunResult && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 11.5, fontFamily: "monospace", color: muted }}>
            Runs: <strong>{mrunResult.totalRuns}</strong> · P98: <strong>{mrunResult.p98PeakKv.toFixed(2)} kV</strong> ·
            Mean: {mrunResult.meanPeakKv.toFixed(2)} kV · σ: {mrunResult.stdDevPeakKv.toFixed(2)} kV
          </div>
          <div style={{ height: 150, width: "100%" }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={mrunRows} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={borderColor} />
                <XAxis dataKey="run" tick={{ fontSize: 10, fill: muted }} />
                <YAxis tick={{ fontSize: 10, fill: muted }} unit=" kV" />
                <Tooltip contentStyle={{ background: cardBg, border: `1px solid ${borderColor}`, fontSize: 11 }} />
                <Bar dataKey="peakKv" name="Peak kV" fill="#38bdf8" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {mode === "pow" && powResult && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 11.5, fontFamily: "monospace", color: muted }}>
            Runs: <strong>{powResult.totalRuns}</strong> · V₂%:{" "}
            <strong>{powResult.ssovV2PercentPu.toFixed(3)} pu</strong> ({powResult.ssovV2PercentKv.toFixed(1)} kV) ·
            Max: {powResult.maxPeakKv.toFixed(1)} kV · {powResult.wallClockTimeMs.toFixed(0)} ms
          </div>
          <div style={{ height: 150, width: "100%" }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={powBars} margin={{ top: 4, right: 8, left: -14, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={borderColor} />
                <XAxis dataKey="range" tick={{ fontSize: 10, fill: muted }} />
                <YAxis tick={{ fontSize: 10, fill: muted }} />
                <Tooltip contentStyle={{ background: cardBg, border: `1px solid ${borderColor}`, fontSize: 11 }} />
                <Bar dataKey="count" name="Runs" fill="#a855f7" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {mode === "freq" && freqResult && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 11.5, fontFamily: "monospace", color: muted }}>
            Resonances: <strong>{freqResult.resonancePoints.length}</strong> · Min R:{" "}
            <strong>{freqResult.minResistanceOhm.toFixed(2)} Ω</strong> · SSCI Risk:{" "}
            <strong style={{ color: freqResult.hasSsciRisk ? "#f85149" : "#3fb950" }}>
              {freqResult.hasSsciRisk ? "YES" : "NO"}
            </strong>
          </div>
          <div style={{ height: 160, width: "100%" }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={freqRows} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={borderColor} />
                <XAxis dataKey="f" tick={{ fontSize: 10, fill: muted }} unit=" Hz" />
                <YAxis tick={{ fontSize: 10, fill: muted }} unit=" Ω" />
                <Tooltip contentStyle={{ background: cardBg, border: `1px solid ${borderColor}`, fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="Z" name="|Z(f)|" stroke="#38bdf8" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="R" name="R(f)" stroke="#10b981" dot={false} strokeWidth={1.5} />
                <Line type="monotone" dataKey="X" name="X(f)" stroke="#f59e0b" dot={false} strokeWidth={1.5} />
                {Boolean(freqResult.z0Ohm?.length) && (
                  <>
                    <Line
                      type="monotone"
                      dataKey="R0"
                      name="R₀(f)"
                      stroke="#a855f7"
                      strokeDasharray="4 2"
                      dot={false}
                      strokeWidth={1.2}
                    />
                    <Line
                      type="monotone"
                      dataKey="X0"
                      name="X₀(f)"
                      stroke="#ec4899"
                      strokeDasharray="4 2"
                      dot={false}
                      strokeWidth={1.2}
                    />
                  </>
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
};
