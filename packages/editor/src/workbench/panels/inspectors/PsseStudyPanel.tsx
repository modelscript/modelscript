// SPDX-License-Identifier: AGPL-3.0-or-later

import { comparePowerFlowSnapshots, type PowerFlowComparisonReport } from "@modelscript/exchange";
import {
  analyzeN1Contingencies,
  analyzeSmallSignalStability,
  calculateGic,
  calculateShortCircuit,
  ensurePsseWasmParser,
  parseDyr,
  parseRaw,
  pssePowerFlowToSnapshot,
  solveContinuationPowerFlow,
  solvePowerFlowAsync,
  type CpfResult,
  type GicAnalysisResult,
  type ModalAnalysisResult,
  type N1ContingencyAnalysisResult,
  type PowerFlowOptions,
  type PowerFlowSolution,
  type PsseTransientResult,
  type ShortCircuitAnalysisResult,
} from "@modelscript/psse";
import { solveAcOpf, solveDcOpf, type OpfSolution } from "@modelscript/simulate/opf";
import React, { useMemo, useState } from "react";
import { collectComparatorPowerFlowSnapshots } from "./powerflow-adapters.js";

const SimulationResults = React.lazy(() =>
  import("../../SimulationResults.js").then((m) => ({ default: m.SimulationResults })),
);

export type PsseStudyKind = "powerflow" | "compare" | "accc" | "cpf" | "opf" | "fault" | "modes" | "gic";

export interface PsseStudyPanelProps {
  code: string;
  dyrText: string | null;
  transientResult: PsseTransientResult | null;
  baselineTransientResult?: PsseTransientResult | null | undefined;
  baselineLabel?: string | undefined;
  channelPrefix?: string | undefined;
  onChannelPrefixChange?: ((prefix: string) => void) | undefined;
  projectFiles?: Record<string, string> | undefined;
  onComparisonReport?: ((report: PowerFlowComparisonReport) => void) | undefined;
  onRevealLine?: ((line: number, identifier?: string) => void) | undefined;
  colorMode: "dark" | "light";
  onStatusChange?: ((status: string) => void) | undefined;
}

export const PsseStudyPanel: React.FC<PsseStudyPanelProps> = ({
  code,
  dyrText,
  transientResult,
  baselineTransientResult,
  baselineLabel,
  channelPrefix: controlledPrefix,
  onChannelPrefixChange,
  projectFiles,
  onComparisonReport,
  onRevealLine,
  colorMode,
  onStatusChange,
}) => {
  const isDark = colorMode === "dark";
  const borderCol = isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)";
  const cardBg = isDark ? "rgba(30, 30, 34, 0.75)" : "rgba(255, 255, 255, 0.9)";
  const textPrimary = isDark ? "#e6edf3" : "#1f2328";
  const textMuted = isDark ? "#8b949e" : "#59636e";

  const [studyKind, setStudyKind] = useState<PsseStudyKind>(() => {
    if (typeof window !== "undefined") {
      const q = new URLSearchParams(window.location.search).get("study");
      if (q === "compare") return "compare";
    }
    return "powerflow";
  });
  const [vmTolPu, setVmTolPu] = useState(0.01);
  const [vaTolDeg, setVaTolDeg] = useState(2.5);
  const [pfAlg, setPfAlg] = useState<NonNullable<PowerFlowOptions["algorithm"]>>("newton_raphson");
  const [adjustTaps, setAdjustTaps] = useState(true);
  const [adjustSwitchedShunts, setAdjustSwitchedShunts] = useState(true);
  const [distributedSlack, setDistributedSlack] = useState(false);
  const [areaInterchange, setAreaInterchange] = useState(false);
  const [remoteVoltageControl, setRemoteVoltageControl] = useState(true);
  const [opfFormulation, setOpfFormulation] = useState<"dc" | "ac">("dc");
  const [running, setRunning] = useState(false);
  const [showRawReport, setShowRawReport] = useState(false);
  const [internalPrefix, setInternalPrefix] = useState<string>("all");
  const channelPrefix = controlledPrefix ?? internalPrefix;
  const setChannelPrefix = (next: string) => {
    setInternalPrefix(next);
    onChannelPrefixChange?.(next);
  };
  const [channelSearch, setChannelSearch] = useState("");
  const [selectedAcccId, setSelectedAcccId] = useState<string | null>(null);

  const [pfResult, setPfResult] = useState<PowerFlowSolution | null>(null);
  const [acccResult, setAcccResult] = useState<N1ContingencyAnalysisResult | null>(null);
  const [cpfResult, setCpfResult] = useState<CpfResult | null>(null);
  const [opfResult, setOpfResult] = useState<OpfSolution | null>(null);
  const [scResult, setScResult] = useState<ShortCircuitAnalysisResult | null>(null);
  const [modalResult, setModalResult] = useState<ModalAnalysisResult | null>(null);
  const [gicResult, setGicResult] = useState<GicAnalysisResult | null>(null);
  const [compareResult, setCompareResult] = useState<PowerFlowComparisonReport | null>(null);

  const runSelectedStudy = async () => {
    setRunning(true);
    try {
      await ensurePsseWasmParser();
      const parsed = parseRaw(code);
      if (dyrText) parsed.dyr = parseDyr(dyrText);

      switch (studyKind) {
        case "powerflow": {
          const res = await solvePowerFlowAsync(parsed, {
            algorithm: pfAlg,
            adjustTaps,
            adjustSwitchedShunts,
            distributedSlack,
            areaInterchange,
            remoteVoltageControl,
          });
          setPfResult(res);
          onStatusChange?.(
            res.converged
              ? `Power Flow (${pfAlg}): converged in ${res.iterations} iters, losses ${res.totalLossMw.toFixed(2)} MW`
              : `Power Flow (${pfAlg}): did not converge (${res.iterations} iters)`,
          );
          break;
        }
        case "compare": {
          const pf = await solvePowerFlowAsync(parsed, {
            algorithm: pfAlg,
            adjustTaps,
            adjustSwitchedShunts,
            distributedSlack,
            areaInterchange,
            remoteVoltageControl,
          });
          const psseSnap = pssePowerFlowToSnapshot(parsed, pf);
          const comparators = await collectComparatorPowerFlowSnapshots(
            projectFiles,
            parsed,
            psseSnap.frequencyHz,
            psseSnap.sbaseMva,
          );
          const report = comparePowerFlowSnapshots(psseSnap, comparators, {
            vmTolerancePu: vmTolPu,
            vaToleranceDeg: vaTolDeg,
          });
          setCompareResult(report);
          onComparisonReport?.(report);
          onStatusChange?.(report.summaryText);
          break;
        }
        case "accc": {
          const res = analyzeN1Contingencies(parsed);
          setAcccResult(res);
          onStatusChange?.(
            `ACCC N-1: ${res.totalContingencies} contingencies (${res.violationCount} violations, ${res.collapseCount} collapse)`,
          );
          break;
        }
        case "cpf": {
          const res = solveContinuationPowerFlow(parsed);
          setCpfResult(res);
          onStatusChange?.(
            `CPF: λ_max=${res.lambdaMax.toFixed(3)}, margin=${res.marginMw.toFixed(1)} MW, weakest Bus ${res.weakestBus}`,
          );
          break;
        }
        case "opf": {
          const res =
            opfFormulation === "ac"
              ? solveAcOpf(parsed, { enforceThermalLimits: true, caseTitle: parsed.title1 || "PSS/E Case" })
              : solveDcOpf(parsed, { enforceThermalLimits: true, caseTitle: parsed.title1 || "PSS/E Case" });
          setOpfResult(res);
          onStatusChange?.(
            `${opfFormulation.toUpperCase()}-OPF: ${res.status}, cost=$${res.objectiveValue.toFixed(2)}/hr, avg LMP=$${res.averageLmp.toFixed(2)}/MWh`,
          );
          break;
        }
        case "fault": {
          const res = calculateShortCircuit(parsed);
          setScResult(res);
          onStatusChange?.(`Short-Circuit: max I''k=${res.maxFaultCurrentKa.toFixed(2)} kA at Bus ${res.maxFaultBus}`);
          break;
        }
        case "modes": {
          const res = analyzeSmallSignalStability(parsed);
          setModalResult(res);
          onStatusChange?.(
            `Small-Signal: ${res.modes.length} modes, min ζ=${(res.summary.minDampingRatio * 100).toFixed(2)}%`,
          );
          break;
        }
        case "gic": {
          const res = calculateGic(parsed);
          setGicResult(res);
          onStatusChange?.(
            `GIC: total Q_loss=${res.totalSystemGicLossMvar.toFixed(2)} MVAr, TPL-007 violations=${res.tpl007ViolationsCount}`,
          );
          break;
        }
      }
    } catch (err) {
      onStatusChange?.(`Study error (${studyKind}): ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning(false);
    }
  };

  const transientRows = useMemo(() => {
    if (!transientResult || transientResult.t.length === 0) return null;
    const allCand = Array.from(
      new Set([...transientResult.states, ...Object.keys(transientResult.variables).filter((k) => k !== "time")]),
    );
    const searchLower = channelSearch.trim().toLowerCase();
    const keys = allCand.filter((s) => {
      if (channelPrefix !== "all" && !s.startsWith(channelPrefix)) return false;
      if (searchLower && !s.toLowerCase().includes(searchLower)) return false;
      return true;
    });
    const maxPrimary = baselineTransientResult ? 12 : 24;
    const activeKeys = (keys.length > 0 ? keys : transientResult.states).slice(0, maxPrimary);
    const basePrefix = (baselineLabel ? baselineLabel.replace(/[^A-Za-z0-9_]/g, "_") : "base") + "_";
    const baseKeys = baselineTransientResult
      ? activeKeys.filter((k) => Array.isArray(baselineTransientResult.variables[k]))
      : [];
    const allVars = [...activeKeys, ...baseKeys.map((k) => `${basePrefix}${k}`)];
    return {
      vars: allVars,
      rows: transientResult.t.map((tVal, i) => {
        const row: Record<string, number> = { time: tVal };
        for (const k of activeKeys) {
          row[k] = transientResult.variables[k]?.[i] ?? 0;
        }
        if (baselineTransientResult) {
          for (const k of baseKeys) {
            row[`${basePrefix}${k}`] = baselineTransientResult.variables[k]?.[i] ?? 0;
          }
        }
        return row;
      }),
    };
  }, [transientResult, baselineTransientResult, baselineLabel, channelPrefix, channelSearch]);

  const cpfRows = useMemo(() => {
    if (!cpfResult || cpfResult.steps.length === 0) return null;
    return cpfResult.steps.map((s) => ({
      time: s.totalLoadMw,
      minVoltagePu: s.minVoltagePu,
      lambda: s.lambda,
    }));
  }, [cpfResult]);

  const btnStyle: React.CSSProperties = {
    padding: "4px 10px",
    fontSize: 11,
    fontWeight: 600,
    borderRadius: 5,
    border: `1px solid ${borderCol}`,
    backgroundColor: cardBg,
    color: textPrimary,
    cursor: running ? "wait" : "pointer",
  };

  const selectStyle: React.CSSProperties = {
    padding: "3px 6px",
    fontSize: 11,
    borderRadius: 4,
    border: `1px solid ${borderCol}`,
    backgroundColor: cardBg,
    color: textPrimary,
  };

  const activeReportText =
    (studyKind === "accc" && acccResult?.reportText) ||
    (studyKind === "cpf" && cpfResult?.reportText) ||
    (studyKind === "opf" && opfResult?.reportText) ||
    (studyKind === "fault" && scResult?.reportText) ||
    (studyKind === "modes" && modalResult?.reportText) ||
    null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 8,
          padding: "8px 10px",
          borderRadius: 6,
          border: `1px solid ${borderCol}`,
          backgroundColor: cardBg,
          fontSize: 11,
        }}
      >
        <label style={{ display: "inline-flex", alignItems: "center", gap: 4, color: textMuted }}>
          Study
          <select value={studyKind} onChange={(e) => setStudyKind(e.target.value as PsseStudyKind)} style={selectStyle}>
            <option value="powerflow">AC Power Flow</option>
            <option value="compare">
              Cross-Tool Power Flow Comparison (PSS/E ↔ PSCAD / OpenDSS / PSLF / MATPOWER / PF / CGMES)
            </option>
            <option value="accc">ACCC (N-1 Contingency)</option>
            <option value="cpf">CPF (PV Nose Curve)</option>
            <option value="opf">Optimal Power Flow (OPF)</option>
            <option value="fault">Short-Circuit (IEC 60909 / ANSI)</option>
            <option value="modes">Small-Signal Eigenmodes</option>
            <option value="gic">GIC / TPL-007</option>
          </select>
        </label>

        {studyKind === "compare" && (
          <>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 4, color: textMuted }}>
              ΔV tol (pu)
              <input
                type="number"
                step="0.001"
                min="0.0001"
                value={vmTolPu}
                onChange={(e) => setVmTolPu(Math.max(0.0001, Number(e.target.value) || 0.01))}
                style={{ ...selectStyle, width: 64 }}
              />
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 4, color: textMuted }}>
              Δθ tol (°)
              <input
                type="number"
                step="0.1"
                min="0.05"
                value={vaTolDeg}
                onChange={(e) => setVaTolDeg(Math.max(0.05, Number(e.target.value) || 2.5))}
                style={{ ...selectStyle, width: 56 }}
              />
            </label>
          </>
        )}

        {studyKind === "powerflow" && (
          <>
            <select
              value={pfAlg}
              onChange={(e) => setPfAlg(e.target.value as NonNullable<PowerFlowOptions["algorithm"]>)}
              style={selectStyle}
            >
              <option value="newton_raphson">Newton-Raphson (fnsl)</option>
              <option value="fast_decoupled">Fast Decoupled (fdns)</option>
              <option value="helm">HELM</option>
            </select>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 3, color: textMuted }}>
              <input type="checkbox" checked={adjustTaps} onChange={(e) => setAdjustTaps(e.target.checked)} />
              ULTC Taps
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 3, color: textMuted }}>
              <input
                type="checkbox"
                checked={adjustSwitchedShunts}
                onChange={(e) => setAdjustSwitchedShunts(e.target.checked)}
              />
              Sw. Shunts
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 3, color: textMuted }}>
              <input
                type="checkbox"
                checked={distributedSlack}
                onChange={(e) => setDistributedSlack(e.target.checked)}
              />
              Dist. Slack
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 3, color: textMuted }}>
              <input type="checkbox" checked={areaInterchange} onChange={(e) => setAreaInterchange(e.target.checked)} />
              Area Int.
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 3, color: textMuted }}>
              <input
                type="checkbox"
                checked={remoteVoltageControl}
                onChange={(e) => setRemoteVoltageControl(e.target.checked)}
              />
              Remote V
            </label>
          </>
        )}

        {studyKind === "opf" && (
          <select
            value={opfFormulation}
            onChange={(e) => setOpfFormulation(e.target.value as "dc" | "ac")}
            style={selectStyle}
          >
            <option value="dc">DC-OPF</option>
            <option value="ac">AC-OPF</option>
          </select>
        )}

        <button type="button" style={btnStyle} onClick={() => void runSelectedStudy()} disabled={running}>
          {running ? "Running..." : "Run Study"}
        </button>

        {activeReportText && (
          <button type="button" style={{ ...btnStyle, marginLeft: "auto" }} onClick={() => setShowRawReport((v) => !v)}>
            {showRawReport ? "Hide Text Report" : "View Text Report"}
          </button>
        )}
      </div>

      {showRawReport && activeReportText && (
        <pre
          style={{
            margin: 0,
            padding: 10,
            borderRadius: 6,
            border: `1px solid ${borderCol}`,
            backgroundColor: isDark ? "#121214" : "#f6f8fa",
            color: textPrimary,
            fontSize: 11,
            fontFamily: "monospace",
            maxHeight: 260,
            overflow: "auto",
          }}
        >
          {activeReportText}
        </pre>
      )}

      {studyKind === "powerflow" && pfResult && (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 6,
            border: `1px solid ${borderCol}`,
            backgroundColor: cardBg,
            fontSize: 11,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
            <strong style={{ color: pfResult.converged ? "#3fb950" : "#f85149" }}>
              {pfResult.converged ? "Converged" : "Diverged"} ({pfResult.iterations} iters, max mismatch{" "}
              {pfResult.maxMismatchPu.toExponential(2)} pu)
            </strong>
            <span style={{ color: textMuted }}>Gen: {pfResult.totalGenMw.toFixed(1)} MW</span>
            <span style={{ color: textMuted }}>Load: {pfResult.totalLoadMw.toFixed(1)} MW</span>
            <span style={{ color: textMuted }}>Losses: {pfResult.totalLossMw.toFixed(2)} MW</span>
            <span style={{ color: textMuted }}>
              V range: {Math.min(...pfResult.buses.map((b) => b.vm)).toFixed(3)}–
              {Math.max(...pfResult.buses.map((b) => b.vm)).toFixed(3)} pu
            </span>
            <button
              type="button"
              style={{ ...btnStyle, marginLeft: "auto" }}
              onClick={() => {
                const header = "busNumber,name,baseKv,type,vmPu,vaDeg,pgMw,qgMvar,plMw,qlMvar";
                const rows = pfResult.buses.map(
                  (b) =>
                    `${b.busNumber},"${b.name}",${b.baseKv},${b.type},${b.vm.toFixed(5)},${b.va.toFixed(3)},${b.pgMw.toFixed(2)},${b.qgMvar.toFixed(2)},${b.plMw.toFixed(2)},${b.qlMvar.toFixed(2)}`,
                );
                const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv;charset=utf-8;" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "psse-powerflow-buses.csv";
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Export CSV
            </button>
          </div>
          {(() => {
            const vViol = pfResult.buses.filter((b) => b.vm < 0.95 || b.vm > 1.05);
            const tViolA = pfResult.branches.filter((br) => (br.loadingPercent ?? 0) > 100);
            const parsedRaw = (() => {
              try {
                return parseRaw(code);
              } catch {
                return null;
              }
            })();
            const areaTotals = new Map<number, { gen: number; load: number }>();
            if (parsedRaw) {
              for (const b of pfResult.buses) {
                const areaId = parsedRaw.buses.get(b.busNumber)?.area ?? 1;
                const entry = areaTotals.get(areaId) ?? { gen: 0, load: 0 };
                entry.gen += b.pgMw;
                entry.load += b.plMw;
                areaTotals.set(areaId, entry);
              }
            }
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {vViol.length === 0 && tViolA.length === 0 ? (
                  <div style={{ color: "#3fb950" }}>
                    No bus voltage (&lt;0.95 / &gt;1.05 pu) or Rate A thermal (&gt;100%) violations.
                  </div>
                ) : (
                  <div
                    style={{ display: "flex", flexWrap: "wrap", gap: 10, color: "#f85149", fontFamily: "monospace" }}
                  >
                    {vViol.slice(0, 8).map((b) => (
                      <span key={`vv-${b.busNumber}`}>
                        V-Limit Bus {b.busNumber}: {b.vm.toFixed(3)} pu
                      </span>
                    ))}
                    {tViolA.slice(0, 8).map((br, i) => (
                      <span key={`tv-${i}`}>
                        Overload {br.fromBus}-{br.toBus}({br.ckt}): {(br.loadingPercent ?? 0).toFixed(1)}% RateA
                      </span>
                    ))}
                  </div>
                )}
                {areaTotals.size > 0 && (
                  <div
                    style={{ display: "flex", flexWrap: "wrap", gap: 10, color: textMuted, fontFamily: "monospace" }}
                  >
                    {Array.from(areaTotals.entries())
                      .sort((a, b) => a[0] - b[0])
                      .slice(0, 8)
                      .map(([areaId, tot]) => (
                        <span key={`area-sum-${areaId}`}>
                          Area {areaId}: Gen {tot.gen.toFixed(1)} MW / Load {tot.load.toFixed(1)} MW (Net{" "}
                          {(tot.gen - tot.load).toFixed(1)} MW)
                        </span>
                      ))}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {studyKind === "accc" && acccResult && (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 6,
            border: `1px solid ${borderCol}`,
            backgroundColor: cardBg,
            fontSize: 11,
          }}
        >
          <div style={{ display: "flex", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
            <strong>ACCC N-1 Summary ({acccResult.totalContingencies} cases)</strong>
            <span style={{ color: "#3fb950" }}>Secure: {acccResult.secureCount}</span>
            <span style={{ color: "#d29922" }}>Warning: {acccResult.warningCount}</span>
            <span style={{ color: "#f85149" }}>Violation: {acccResult.violationCount}</span>
            <span style={{ color: "#f85149" }}>Collapse: {acccResult.collapseCount}</span>
          </div>
          <div style={{ maxHeight: 220, overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace", fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${borderCol}`, color: textMuted, textAlign: "left" }}>
                  <th style={{ padding: "4px 6px" }}>Contingency</th>
                  <th style={{ padding: "4px 6px" }}>Severity</th>
                  <th style={{ padding: "4px 6px" }}>Max Loading</th>
                  <th style={{ padding: "4px 6px" }}>Min V (pu)</th>
                  <th style={{ padding: "4px 6px" }}>Max V (pu)</th>
                </tr>
              </thead>
              <tbody>
                {acccResult.contingencies.slice(0, 50).map((c) => (
                  <tr
                    key={c.contingencyId}
                    onClick={() => {
                      const nextId = selectedAcccId === c.contingencyId ? null : c.contingencyId;
                      setSelectedAcccId(nextId);
                      if (typeof window !== "undefined") {
                        window.dispatchEvent(
                          new CustomEvent("modelscript:psse-highlight", {
                            detail: nextId
                              ? {
                                  buses: c.voltageViolations.map((v) => v.bus),
                                  branches: c.overloadedBranches.map((b) => b.branch),
                                }
                              : { buses: [], branches: [] },
                          }),
                        );
                      }
                    }}
                    style={{
                      borderBottom: `1px solid ${borderCol}`,
                      cursor: "pointer",
                      backgroundColor: selectedAcccId === c.contingencyId ? "rgba(88, 166, 255, 0.12)" : "transparent",
                    }}
                  >
                    <td style={{ padding: "4px 6px" }}>{c.description}</td>
                    <td
                      style={{
                        padding: "4px 6px",
                        fontWeight: 700,
                        color: c.severity === "secure" ? "#3fb950" : c.severity === "warning" ? "#d29922" : "#f85149",
                      }}
                    >
                      {c.severity}
                    </td>
                    <td style={{ padding: "4px 6px" }}>{c.maxBranchLoadingPct.toFixed(1)}%</td>
                    <td style={{ padding: "4px 6px" }}>{c.minVoltagePu.toFixed(3)}</td>
                    <td style={{ padding: "4px 6px" }}>{c.maxVoltagePu.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(() => {
            const sel = acccResult.contingencies.find((c) => c.contingencyId === selectedAcccId);
            if (!sel) return null;
            return (
              <div
                style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${borderCol}`, fontFamily: "monospace" }}
              >
                <div style={{ fontWeight: 700, marginBottom: 4 }}>
                  {sel.description} — {sel.overloadedBranches.length} branch overload(s), {sel.voltageViolations.length}{" "}
                  voltage violation(s)
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, color: "#f85149" }}>
                  {sel.overloadedBranches.map((ob, idx) => (
                    <span key={`ob-${idx}`}>
                      {ob.branch}: {ob.loadingPct.toFixed(1)}% ({ob.mvaFlow.toFixed(1)}/{ob.rateMva.toFixed(1)} MVA)
                    </span>
                  ))}
                  {sel.voltageViolations.map((vv, idx) => (
                    <span key={`vv-${idx}`}>
                      Bus {vv.bus} ({vv.name}): {vv.vm.toFixed(3)} pu ({vv.limitType})
                    </span>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {studyKind === "cpf" && cpfResult && cpfRows && (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 6,
            border: `1px solid ${borderCol}`,
            backgroundColor: cardBg,
            fontSize: 11,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <strong>P-V Nose Curve</strong>
            <span style={{ color: textMuted }}>λ_max: {cpfResult.lambdaMax.toFixed(3)}</span>
            <span style={{ color: textMuted }}>
              Margin: {cpfResult.marginMw.toFixed(1)} MW ({cpfResult.marginPercent.toFixed(1)}%)
            </span>
            <span style={{ color: textMuted }}>
              Weakest Bus: {cpfResult.weakestBus} ({cpfResult.criticalVoltagePu.toFixed(3)} pu)
            </span>
          </div>
          <div style={{ height: 280 }}>
            <React.Suspense fallback={null}>
              <SimulationResults
                localData={cpfRows}
                simulationVariables={["minVoltagePu"]}
                colorMode={colorMode}
                modelName="psse-cpf-pv-curve"
              />
            </React.Suspense>
          </div>
        </div>
      )}

      {studyKind === "opf" && opfResult && (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 6,
            border: `1px solid ${borderCol}`,
            backgroundColor: cardBg,
            fontSize: 11,
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <strong style={{ color: opfResult.status === "OPTIMAL" ? "#3fb950" : "#d29922" }}>
            {opfResult.formulation.toUpperCase()}-OPF: {opfResult.status}
          </strong>
          <span style={{ color: textMuted }}>Cost: ${opfResult.objectiveValue.toFixed(2)}/hr</span>
          <span style={{ color: textMuted }}>Avg LMP: ${opfResult.averageLmp.toFixed(2)}/MWh</span>
          <span style={{ color: textMuted }}>Gen: {opfResult.totalGenMw.toFixed(1)} MW</span>
          <span style={{ color: textMuted }}>Losses: {opfResult.totalLossMw.toFixed(2)} MW</span>
        </div>
      )}

      {studyKind === "fault" && scResult && (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 6,
            border: `1px solid ${borderCol}`,
            backgroundColor: cardBg,
            fontSize: 11,
          }}
        >
          <div style={{ display: "flex", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
            <strong>
              Short-Circuit Fault Currents (Sbase={scResult.sbaseMva} MVA, c={scResult.cFactor})
            </strong>
            <span style={{ color: textMuted }}>
              Max I&apos;&apos;k: {scResult.maxFaultCurrentKa.toFixed(2)} kA @ Bus {scResult.maxFaultBus}
            </span>
          </div>
          <div style={{ maxHeight: 220, overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace", fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${borderCol}`, color: textMuted, textAlign: "left" }}>
                  <th style={{ padding: "4px 6px" }}>Bus</th>
                  <th style={{ padding: "4px 6px" }}>3Φ (kA)</th>
                  <th style={{ padding: "4px 6px" }}>1LG (kA)</th>
                  <th style={{ padding: "4px 6px" }}>LL (kA)</th>
                  <th style={{ padding: "4px 6px" }}>Peak ip (kA)</th>
                  <th style={{ padding: "4px 6px" }}>Duty (kA)</th>
                  <th style={{ padding: "4px 6px" }}>X/R</th>
                </tr>
              </thead>
              <tbody>
                {scResult.buses.slice(0, 50).map((b) => (
                  <tr key={b.busNumber} style={{ borderBottom: `1px solid ${borderCol}` }}>
                    <td style={{ padding: "4px 6px" }}>
                      {b.busNumber} ({b.name})
                    </td>
                    <td style={{ padding: "4px 6px" }}>{b.ik3PhaseKa.toFixed(2)}</td>
                    <td style={{ padding: "4px 6px" }}>{b.ik1LineGroundKa.toFixed(2)}</td>
                    <td style={{ padding: "4px 6px" }}>{b.ikLineToLineKa.toFixed(2)}</td>
                    <td style={{ padding: "4px 6px" }}>{b.ipPeakMakeKa.toFixed(2)}</td>
                    <td style={{ padding: "4px 6px", fontWeight: 600 }}>{b.breakerDutyKa.toFixed(2)}</td>
                    <td style={{ padding: "4px 6px" }}>{b.xrRatio.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {studyKind === "modes" && modalResult && (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 6,
            border: `1px solid ${borderCol}`,
            backgroundColor: cardBg,
            fontSize: 11,
          }}
        >
          <div style={{ display: "flex", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
            <strong style={{ color: modalResult.summary.stable ? "#3fb950" : "#f85149" }}>
              Small-Signal Stability ({modalResult.summary.stable ? "Stable" : "Unstable"})
            </strong>
            <span style={{ color: textMuted }}>Min ζ: {(modalResult.summary.minDampingRatio * 100).toFixed(2)}%</span>
            <span style={{ color: textMuted }}>Poorly damped: {modalResult.summary.poorlyDampedCount}</span>
          </div>
          <div style={{ maxHeight: 220, overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace", fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${borderCol}`, color: textMuted, textAlign: "left" }}>
                  <th style={{ padding: "4px 6px" }}>Mode</th>
                  <th style={{ padding: "4px 6px" }}>Type</th>
                  <th style={{ padding: "4px 6px" }}>Freq (Hz)</th>
                  <th style={{ padding: "4px 6px" }}>Damping ζ</th>
                  <th style={{ padding: "4px 6px" }}>Dominant</th>
                </tr>
              </thead>
              <tbody>
                {modalResult.modes.slice(0, 40).map((m) => (
                  <tr key={m.modeIndex} style={{ borderBottom: `1px solid ${borderCol}` }}>
                    <td style={{ padding: "4px 6px" }}>#{m.modeIndex}</td>
                    <td style={{ padding: "4px 6px" }}>{m.modeType}</td>
                    <td style={{ padding: "4px 6px" }}>{m.frequencyHz.toFixed(3)}</td>
                    <td
                      style={{
                        padding: "4px 6px",
                        fontWeight: 700,
                        color: m.severity === "stable" ? "#3fb950" : m.severity === "marginal" ? "#d29922" : "#f85149",
                      }}
                    >
                      {(m.dampingRatio * 100).toFixed(2)}%
                    </td>
                    <td style={{ padding: "4px 6px" }}>
                      {m.dominantMachine} ({m.dominantState})
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {studyKind === "gic" && gicResult && (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 6,
            border: `1px solid ${borderCol}`,
            backgroundColor: cardBg,
            fontSize: 11,
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <strong style={{ color: gicResult.summary.compliant ? "#3fb950" : "#f85149" }}>
            GIC TPL-007: {gicResult.summary.compliant ? "Compliant" : "Violations Found"}
          </strong>
          <span style={{ color: textMuted }}>Total Q_loss: {gicResult.totalSystemGicLossMvar.toFixed(2)} MVAr</span>
          <span style={{ color: textMuted }}>Max Eff. GIC: {gicResult.maxTransformerEffectiveGicAmp.toFixed(1)} A</span>
          <span style={{ color: textMuted }}>Violations: {gicResult.tpl007ViolationsCount}</span>
        </div>
      )}

      {studyKind === "compare" && compareResult && (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 6,
            border: `1px solid ${borderCol}`,
            backgroundColor: cardBg,
            fontSize: 11,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
            <strong
              style={{
                color:
                  compareResult.overallStatus === "PASS"
                    ? "#3fb950"
                    : compareResult.overallStatus === "WARN"
                      ? "#d29922"
                      : "#f85149",
              }}
            >
              Powerflow Parity: {compareResult.overallStatus}
            </strong>
            <span style={{ color: textMuted }}>Solvers: {compareResult.solversCompared.join(" vs ")}</span>
            <span style={{ color: textMuted }}>Max |ΔV|: {compareResult.maxDeltaVmPu.toFixed(4)} pu</span>
            <span style={{ color: textMuted }}>Max |Δθ|: {compareResult.maxDeltaVaDeg.toFixed(2)}°</span>
          </div>
          {compareResult.pairs.map((pair) => (
            <div key={pair.comparatorSolver} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ fontWeight: 600, color: textPrimary }}>
                {pair.baselineSolver} ↔ {pair.comparatorSolver} ({pair.matchedBuses} matched buses, RMSE ΔV=
                {pair.rmseDeltaVmPu.toFixed(4)} pu)
              </div>
              {pair.busDeltas.length > 0 && (
                <div style={{ maxHeight: 180, overflowY: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                    <thead>
                      <tr style={{ color: textMuted, textAlign: "left", borderBottom: `1px solid ${borderCol}` }}>
                        <th style={{ padding: "3px 6px" }}>Bus</th>
                        <th style={{ padding: "3px 6px" }}>{pair.baselineSolver} V (pu)</th>
                        <th style={{ padding: "3px 6px" }}>{pair.comparatorSolver} V (pu)</th>
                        <th style={{ padding: "3px 6px" }}>|ΔV| (pu)</th>
                        <th style={{ padding: "3px 6px" }}>|Δθ| (°)</th>
                        <th style={{ padding: "3px 6px" }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pair.busDeltas.slice(0, 50).map((b) => (
                        <tr
                          key={b.busId}
                          onClick={() => {
                            if (!onRevealLine) return;
                            const idx = code
                              .split(/\r?\n/)
                              .findIndex((ln) => new RegExp(`^\\s*${b.busId}\\s*,`).test(ln));
                            if (idx >= 0) onRevealLine(idx + 1, b.busId);
                          }}
                          style={{
                            borderBottom: `1px solid ${borderCol}`,
                            cursor: onRevealLine ? "pointer" : "default",
                          }}
                          title={onRevealLine ? `Click to jump to Bus ${b.busId}` : undefined}
                        >
                          <td style={{ padding: "3px 6px", fontFamily: "monospace" }}>{b.busId}</td>
                          <td style={{ padding: "3px 6px", fontFamily: "monospace" }}>{b.baselineVmPu.toFixed(4)}</td>
                          <td style={{ padding: "3px 6px", fontFamily: "monospace" }}>{b.comparatorVmPu.toFixed(4)}</td>
                          <td style={{ padding: "3px 6px", fontFamily: "monospace" }}>{b.deltaVmPu.toFixed(4)}</td>
                          <td style={{ padding: "3px 6px", fontFamily: "monospace" }}>{b.deltaVaDeg.toFixed(2)}</td>
                          <td style={{ padding: "3px 6px", color: b.withinTolerance ? "#3fb950" : "#f85149" }}>
                            {b.withinTolerance ? "OK" : "DIFF"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {transientResult && transientRows && (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 6,
            border: `1px solid ${borderCol}`,
            backgroundColor: cardBg,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            fontSize: 11,
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <span style={{ fontWeight: 600, color: transientResult.summary.stable ? "#3fb950" : "#f85149" }}>
              Transient Stability ({transientResult.summary.stable ? "Stable" : "Unstable"})
            </span>
            <span style={{ color: textMuted }}>
              Fault Bus {transientResult.summary.faultBus} ({transientResult.summary.faultStartSec.toFixed(2)}s–
              {transientResult.summary.faultClearSec.toFixed(2)}s)
            </span>
            <span style={{ color: textMuted }}>
              Max Δδ: {transientResult.summary.maxRotorAngleSpreadDeg.toFixed(1)}°
            </span>
            <span style={{ color: textMuted }}>
              Max |Δf|: {transientResult.summary.maxFreqDeviationHz.toFixed(3)} Hz
            </span>
            <span style={{ color: textMuted }}>Min V: {transientResult.summary.minBusVoltagePu.toFixed(3)} pu</span>
            {baselineTransientResult && (
              <span style={{ color: "#58a6ff", fontFamily: "monospace" }}>
                vs {baselineLabel || "Baseline"}: Δ|Δf|{" "}
                {(
                  transientResult.summary.maxFreqDeviationHz - baselineTransientResult.summary.maxFreqDeviationHz
                ).toFixed(3)}{" "}
                Hz, ΔSpread{" "}
                {(
                  transientResult.summary.maxRotorAngleSpreadDeg -
                  baselineTransientResult.summary.maxRotorAngleSpreadDeg
                ).toFixed(1)}
                °
              </span>
            )}
            {(() => {
              const targetKey =
                transientRows.vars.find((v) => v.startsWith("delta_") || v.startsWith("omega_")) ??
                transientRows.vars[0];
              const vals = targetKey ? transientResult.variables[targetKey] : undefined;
              const tArr = transientResult.t;
              if (!vals || vals.length < 16) return null;
              const startIdx = Math.max(
                0,
                tArr.findIndex((tv) => tv >= transientResult.summary.faultClearSec + 0.05),
              );
              const seg = vals.slice(startIdx);
              const tSeg = tArr.slice(startIdx);
              if (seg.length < 10) return null;
              const mean = seg.reduce((a, b) => a + b, 0) / seg.length;
              const peaks: Array<{ t: number; amp: number }> = [];
              for (let i = 1; i < seg.length - 1; i++) {
                const c = seg[i]! - mean;
                if (c > 0 && seg[i]! >= seg[i - 1]! && seg[i]! > seg[i + 1]!) {
                  peaks.push({ t: tSeg[i]!, amp: c });
                }
              }
              if (peaks.length < 2) return null;
              const period = (peaks[peaks.length - 1]!.t - peaks[0]!.t) / (peaks.length - 1);
              const freqHz = period > 1e-4 ? 1 / period : 0;
              const a1 = peaks[0]!.amp;
              const a2 = peaks[1]!.amp;
              const logDec = a1 > 1e-9 && a2 > 1e-9 ? Math.log(a1 / a2) : 0;
              const zeta = (logDec / Math.sqrt(4 * Math.PI * Math.PI + logDec * logDec)) * 100;
              return (
                <span style={{ color: zeta < 5 ? "#d29922" : "#3fb950", fontFamily: "monospace" }}>
                  Ringdown ({targetKey}): f={freqHz.toFixed(2)} Hz, ζ={zeta.toFixed(1)}%
                </span>
              );
            })()}
            <label
              style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: "auto", color: textMuted }}
            >
              CHNF Filter
              <input
                type="text"
                placeholder="e.g. Bus_2 or delta_"
                value={channelSearch}
                onChange={(e) => setChannelSearch(e.target.value)}
                style={{ ...selectStyle, width: 120 }}
              />
              <select value={channelPrefix} onChange={(e) => setChannelPrefix(e.target.value)} style={selectStyle}>
                <option value="all">All (up to 24)</option>
                <option value="Bus_">Bus V/Ang (Bus_)</option>
                <option value="Gen_">Gen States (Gen_)</option>
                <option value="vt_">Bus Voltages (vt_)</option>
                <option value="delta_">Rotor Angles (delta_)</option>
                <option value="omega_">Speed / Freq (omega_)</option>
                <option value="pe_">Active Power (pe_)</option>
                <option value="efd_">Field Voltage (efd_)</option>
              </select>
            </label>
          </div>
          <div style={{ height: 340 }}>
            <React.Suspense fallback={null}>
              <SimulationResults
                localData={transientRows.rows}
                simulationVariables={transientRows.vars}
                colorMode={colorMode}
                modelName="psse-transient"
              />
            </React.Suspense>
          </div>
        </div>
      )}
    </div>
  );
};
