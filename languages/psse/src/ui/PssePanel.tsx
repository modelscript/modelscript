// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  PanelButton,
  PanelDataGrid,
  PanelKpiStrip,
  PanelShell,
  PanelSvgStage,
  PanelTabBar,
  PanelToolbar,
  type LanguagePanelProps,
  type PanelDataGridColumn,
  type PanelKpiItem,
  type PanelSvgEntitySelection,
} from "@modelscript/design-tokens/panel";
import { renderPsseSvg, type PsseCaseLike, type PssePowerFlowOverlay } from "@modelscript/diagram/psse-diagram-builder";
import React, { useEffect, useMemo, useState } from "react";
import { lintPsse } from "../lints/index.js";
import { parseRaw } from "../parser/raw-parser.js";
import { ensurePsseWasmParser, isPsseWasmParserReady } from "../parser/wasm-loader.js";
import { psseToModelica } from "../projections/psse-to-modelica.js";
import {
  analyzeN1Contingencies,
  calculateShortCircuit,
  formatPowerFlowReport,
  solvePowerFlow,
} from "../solver/ac-powerflow.js";
import { evaluateBreakerDuty } from "../solver/breaker-duty.js";
import { solveContinuationPowerFlow } from "../solver/continuation-powerflow.js";
import { calculateGic } from "../solver/gic-solver.js";
import { solveHelmPowerFlow } from "../solver/helm-powerflow.js";
import { analyzeSmallSignalStability } from "../solver/small-signal.js";
import { analyzeN11Contingencies } from "../solver/transfer-capability.js";
import type { PsseCase } from "../types.js";

type PsseBus = PsseCase["buses"] extends Map<number, infer V> ? V : never;
type PsseGenerator = PsseCase["generators"][number];

type PsseTabId = "sld" | "buses" | "branches" | "generators" | "studies" | "report";
type PsseStudyKind = "accc" | "ascc" | "cpf" | "small_signal" | "gic" | "breaker_duty" | "n11" | "helm";

interface BranchOrXfmrRow {
  key: string;
  kind: "Line" | "2W Xfmr" | "3W Xfmr";
  from: number;
  to: number;
  ckt: string;
  r: number;
  x: number;
  rateA: number;
  tapOrPhase: string;
  loadingPct?: number | undefined;
  pFromMw?: number | undefined;
  qFromMvar?: number | undefined;
  line?: number | undefined;
}

const BUS_TYPE_LABEL: Record<number, string> = {
  1: "PQ",
  2: "PV",
  3: "Slack",
  4: "Isolated",
};

export const PssePanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<PsseTabId>("sld");
  const [canvasThemeOverride, setCanvasThemeOverride] = useState<"light" | "dark" | null>(null);
  const [layoutMode, setLayoutMode] = useState<"auto" | "geographic">("auto");
  const [algorithm, setAlgorithm] = useState<"newton_raphson" | "fast_decoupled">("newton_raphson");
  const [selectedEntity, setSelectedEntity] = useState<PanelSvgEntitySelection | null>(null);
  const [parserReady, setParserReady] = useState<boolean>(() => isPsseWasmParserReady());
  const [parserLoadError, setParserLoadError] = useState<string | undefined>(undefined);
  const [studyKind, setStudyKind] = useState<PsseStudyKind>("accc");
  const [studyOutput, setStudyOutput] = useState<{ kind: PsseStudyKind; summary: string; details: string } | null>(
    null,
  );
  const [studyError, setStudyError] = useState<string | null>(null);

  const canvasTheme = canvasThemeOverride ?? colorMode;

  useEffect(() => {
    if (parserReady) return;
    let cancelled = false;
    void ensurePsseWasmParser()
      .then(() => {
        if (!cancelled) {
          setParserLoadError(undefined);
          setParserReady(true);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setParserLoadError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [parserReady]);

  const computed = useMemo(() => {
    if (!code.trim()) {
      return {
        parsed: null as PsseCase | null,
        pf: null as ReturnType<typeof solvePowerFlow> | null,
        pfError: undefined as string | undefined,
        lints: [] as ReturnType<typeof lintPsse>,
        parseError: undefined as string | undefined,
        loading: false,
      };
    }
    if (!parserReady) {
      return {
        parsed: null as PsseCase | null,
        pf: null as ReturnType<typeof solvePowerFlow> | null,
        pfError: undefined as string | undefined,
        lints: [] as ReturnType<typeof lintPsse>,
        parseError: parserLoadError,
        loading: !parserLoadError,
      };
    }
    try {
      const parsed = parseRaw(code);
      let pf: ReturnType<typeof solvePowerFlow> | null = null;
      let pfError: string | undefined;
      try {
        pf = solvePowerFlow(parsed, { algorithm, maxIterations: 40 });
      } catch (err) {
        pf = null;
        pfError = err instanceof Error ? err.message : String(err);
      }
      const lints = lintPsse(parsed);
      return { parsed, pf, pfError, lints, parseError: undefined, loading: false };
    } catch (err) {
      return {
        parsed: null,
        pf: null,
        pfError: undefined,
        lints: [],
        parseError: err instanceof Error ? err.message : String(err),
        loading: false,
      };
    }
  }, [code, parserReady, parserLoadError, algorithm]);

  const title = (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) || "PSS/E Power Flow Grid";

  const sldSvg = useMemo(() => {
    if (!computed.parsed) return "";
    try {
      const overlay = computed.pf as unknown as PssePowerFlowOverlay | undefined;
      return renderPsseSvg(computed.parsed as unknown as PsseCaseLike, overlay, {
        theme: canvasTheme,
        layoutMode,
      });
    } catch {
      return "";
    }
  }, [computed.parsed, computed.pf, canvasTheme, layoutMode]);

  const kpis = useMemo<PanelKpiItem[]>(() => {
    const buses = computed.parsed?.buses?.size ?? 0;
    const gens = computed.parsed?.generators?.length ?? 0;
    const branches = (computed.parsed?.branches?.length ?? 0) + (computed.parsed?.transformers?.length ?? 0);
    const converged = computed.pf?.converged;
    const totalLoadMw = computed.parsed?.loads?.reduce((acc, l) => acc + (l.pl ?? 0), 0) ?? 0;
    return [
      { label: "Buses", value: buses, tone: "info" },
      { label: "Branches", value: branches },
      { label: "Generators", value: gens },
      { label: "Total Load", value: totalLoadMw.toFixed(1), unit: "MW" },
      {
        label: "AC Power Flow",
        value: converged === undefined ? "N/A" : converged ? `OK (${computed.pf?.iterations ?? 0} it)` : "DIVERGED",
        tone: converged === undefined ? "neutral" : converged ? "success" : "danger",
      },
    ];
  }, [computed.parsed, computed.pf]);

  const busVoltageMap = useMemo(() => {
    const map = new Map<number, { vm: number; va: number }>();
    if (computed.pf?.buses) {
      for (const b of computed.pf.buses) {
        map.set(b.busNumber, { vm: b.vm, va: b.va });
      }
    }
    return map;
  }, [computed.pf]);

  const branchFlowMap = useMemo(() => {
    const map = new Map<string, { pFrom: number; qFrom: number; loadingPct?: number | undefined }>();
    if (computed.pf?.branches) {
      for (const br of computed.pf.branches) {
        const key = `${br.fromBus}_${br.toBus}_${(br.ckt ?? "1").trim()}`;
        map.set(key, {
          pFrom: br.pFromMw ?? 0,
          qFrom: br.qFromMvar ?? 0,
          loadingPct: br.loadingPercent,
        });
      }
    }
    return map;
  }, [computed.pf]);

  const busRows = useMemo<PsseBus[]>(
    () => (computed.parsed ? Array.from(computed.parsed.buses.values()) : []),
    [computed.parsed],
  );

  const branchAndXfmrRows = useMemo<BranchOrXfmrRow[]>(() => {
    if (!computed.parsed) return [];
    const rows: BranchOrXfmrRow[] = [];
    for (let idx = 0; idx < (computed.parsed.branches ?? []).length; idx++) {
      const br = computed.parsed.branches[idx]!;
      const ckt = String(br.ckt ?? "1").trim();
      const flow = branchFlowMap.get(`${br.i}_${br.j}_${ckt}`) ?? branchFlowMap.get(`${br.j}_${br.i}_${ckt}`);
      rows.push({
        key: `br-${br.i}-${br.j}-${ckt}-${idx}`,
        kind: "Line",
        from: br.i,
        to: br.j,
        ckt,
        r: br.r,
        x: br.x,
        rateA: br.rateA,
        tapOrPhase: "—",
        loadingPct: flow?.loadingPct,
        pFromMw: flow?.pFrom,
        qFromMvar: flow?.qFrom,
        line: br.span?.line,
      });
    }
    for (let idx = 0; idx < (computed.parsed.transformers ?? []).length; idx++) {
      const xf = computed.parsed.transformers[idx]!;
      const ckt = String(xf.ckt ?? "1").trim();
      const is3W = Boolean(xf.k && xf.k !== 0);
      const flow = branchFlowMap.get(`${xf.i}_${xf.j}_${ckt}`) ?? branchFlowMap.get(`${xf.j}_${xf.i}_${ckt}`);
      const tapStr =
        xf.windv1 !== undefined && xf.windv1 !== 1
          ? `${xf.windv1.toFixed(3)} pu`
          : xf.ang1
            ? `${xf.ang1.toFixed(1)}°`
            : "1.000 pu";
      rows.push({
        key: `xf-${xf.i}-${xf.j}-${xf.k ?? 0}-${ckt}-${idx}`,
        kind: is3W ? "3W Xfmr" : "2W Xfmr",
        from: xf.i,
        to: xf.j,
        ckt,
        r: xf.r12 ?? 0,
        x: xf.x12 ?? 0,
        rateA: xf.rata1 ?? 0,
        tapOrPhase: tapStr,
        loadingPct: flow?.loadingPct,
        pFromMw: flow?.pFrom,
        qFromMvar: flow?.qFrom,
        line: xf.span?.line,
      });
    }
    return rows;
  }, [computed.parsed, branchFlowMap]);

  const generatorRows = useMemo<PsseGenerator[]>(() => computed.parsed?.generators ?? [], [computed.parsed]);

  const busColumns = useMemo<PanelDataGridColumn<PsseBus>[]>(
    () => [
      { key: "i", label: "Bus #", mono: true, sortValue: (b) => b.i, render: (b) => b.i },
      { key: "name", label: "Name", sortValue: (b) => b.name ?? "", render: (b) => b.name || "—" },
      {
        key: "baseKv",
        label: "Base kV",
        align: "right",
        mono: true,
        sortValue: (b) => b.baseKv,
        render: (b) => b.baseKv.toFixed(1),
      },
      {
        key: "ide",
        label: "Type",
        sortValue: (b) => b.ide,
        render: (b) => BUS_TYPE_LABEL[b.ide] ?? String(b.ide),
      },
      {
        key: "vm",
        label: "|V| (p.u.)",
        align: "right",
        mono: true,
        sortValue: (b) => busVoltageMap.get(b.i)?.vm ?? b.vm ?? 1,
        render: (b) => {
          const vm = busVoltageMap.get(b.i)?.vm ?? b.vm ?? 1;
          const color =
            vm < 0.9 || vm > 1.1
              ? "var(--ms-danger)"
              : vm < 0.95 || vm > 1.05
                ? "var(--ms-warning)"
                : "var(--ms-text-1)";
          return <span style={{ color, fontWeight: 600 }}>{vm.toFixed(4)}</span>;
        },
      },
      {
        key: "va",
        label: "Angle (deg)",
        align: "right",
        mono: true,
        sortValue: (b) => busVoltageMap.get(b.i)?.va ?? b.va ?? 0,
        render: (b) => `${(busVoltageMap.get(b.i)?.va ?? b.va ?? 0).toFixed(2)}°`,
      },
    ],
    [busVoltageMap],
  );

  const branchColumns = useMemo<PanelDataGridColumn<BranchOrXfmrRow>[]>(
    () => [
      {
        key: "kind",
        label: "Type",
        sortValue: (r) => r.kind,
        render: (r) => (
          <span
            style={{
              fontSize: "10px",
              fontWeight: 600,
              padding: "1px 6px",
              borderRadius: "999px",
              background: r.kind === "Line" ? "var(--ms-status-info-bg)" : "var(--ms-status-warn-bg)",
              color: r.kind === "Line" ? "var(--ms-status-info-fg)" : "var(--ms-status-warn-fg)",
            }}
          >
            {r.kind}
          </span>
        ),
      },
      { key: "from", label: "From", mono: true, sortValue: (r) => r.from, render: (r) => r.from },
      { key: "to", label: "To", mono: true, sortValue: (r) => r.to, render: (r) => r.to },
      { key: "ckt", label: "Ckt", mono: true, sortValue: (r) => r.ckt, render: (r) => r.ckt },
      { key: "r", label: "R (p.u.)", align: "right", mono: true, sortValue: (r) => r.r, render: (r) => r.r.toFixed(5) },
      { key: "x", label: "X (p.u.)", align: "right", mono: true, sortValue: (r) => r.x, render: (r) => r.x.toFixed(5) },
      {
        key: "rateA",
        label: "Rate A (MVA)",
        align: "right",
        mono: true,
        sortValue: (r) => r.rateA,
        render: (r) => (r.rateA > 0 ? r.rateA.toFixed(1) : "—"),
      },
      {
        key: "pFrom",
        label: "P Flow (MW)",
        align: "right",
        mono: true,
        sortValue: (r) => r.pFromMw ?? 0,
        render: (r) => (r.pFromMw !== undefined ? r.pFromMw.toFixed(1) : "—"),
      },
      {
        key: "loadingPct",
        label: "Loading",
        align: "right",
        mono: true,
        sortValue: (r) => r.loadingPct ?? -1,
        render: (r) => {
          if (r.loadingPct === undefined) return "—";
          const color =
            r.loadingPct >= 100 ? "var(--ms-danger)" : r.loadingPct >= 80 ? "var(--ms-warning)" : "var(--ms-success)";
          return <span style={{ color, fontWeight: 600 }}>{r.loadingPct.toFixed(1)}%</span>;
        },
      },
      {
        key: "tapOrPhase",
        label: "Tap / Phase",
        align: "right",
        mono: true,
        sortValue: (r) => r.tapOrPhase,
        render: (r) => r.tapOrPhase,
      },
    ],
    [],
  );

  const generatorColumns = useMemo<PanelDataGridColumn<PsseGenerator>[]>(
    () => [
      { key: "i", label: "Bus", mono: true, sortValue: (g) => g.i, render: (g) => g.i },
      { key: "id", label: "ID", mono: true, sortValue: (g) => g.id, render: (g) => g.id },
      {
        key: "pg",
        label: "Pg (MW)",
        align: "right",
        mono: true,
        sortValue: (g) => g.pg,
        render: (g) => g.pg.toFixed(2),
      },
      {
        key: "qg",
        label: "Qg (MVAr)",
        align: "right",
        mono: true,
        sortValue: (g) => g.qg,
        render: (g) => g.qg.toFixed(2),
      },
      {
        key: "vs",
        label: "Vset (p.u.)",
        align: "right",
        mono: true,
        sortValue: (g) => g.vs,
        render: (g) => g.vs.toFixed(4),
      },
      {
        key: "stat",
        label: "Status",
        sortValue: (g) => g.stat,
        render: (g) => (
          <span
            style={{
              fontSize: "10px",
              fontWeight: 600,
              padding: "1px 6px",
              borderRadius: "999px",
              background: g.stat === 1 ? "var(--ms-status-pass-bg)" : "var(--ms-bg-soft)",
              color: g.stat === 1 ? "var(--ms-status-pass-fg)" : "var(--ms-text-2)",
            }}
          >
            {g.stat === 1 ? "IN" : "OUT"}
          </span>
        ),
      },
    ],
    [],
  );

  // Resolve selected SLD entity summary for contextual inspection bar
  const selectedEntitySummary = useMemo(() => {
    if (!selectedEntity || !computed.parsed) return null;
    if (selectedEntity.kind === "bus" || selectedEntity.id.startsWith("bus_")) {
      const busNum = Number(selectedEntity.id.replace("bus_", ""));
      const bus = computed.parsed.buses.get(busNum);
      if (!bus) return null;
      const solved = busVoltageMap.get(bus.i);
      const vm = solved?.vm ?? bus.vm ?? 1;
      const va = solved?.va ?? bus.va ?? 0;
      return {
        title: `Bus ${bus.i} · ${bus.name || "Unnamed"}`,
        details: `${bus.baseKv} kV · ${BUS_TYPE_LABEL[bus.ide] ?? bus.ide} · |V| = ${vm.toFixed(4)} p.u. ∠ ${va.toFixed(2)}°`,
        line: selectedEntity.line ?? bus.span?.line,
      };
    }
    return {
      title: selectedEntity.id,
      details: selectedEntity.kind ? `Type: ${selectedEntity.kind}` : "Selected grid element",
      line: selectedEntity.line,
    };
  }, [selectedEntity, computed.parsed, busVoltageMap]);

  const handleExportSvg = () => {
    if (!sldSvg || !host.exportFile) return;
    host.exportFile("psse-sld.svg", sldSvg, "image/svg+xml");
  };

  const handleExportModelica = () => {
    if (!computed.parsed || (!host.exportFile && !host.onUpdateProjectFile)) return;
    const mo = psseToModelica(computed.parsed);
    const fileName = `${title.replace(/[^a-zA-Z0-9_-]/g, "_") || "psse_grid"}.mo`;
    if (host.exportFile) {
      host.exportFile(fileName, mo, "text/plain");
    } else if (host.onUpdateProjectFile) {
      host.onUpdateProjectFile(fileName, mo);
      host.notify?.("info", `Exported ${fileName}`);
    }
  };

  const handleRunStudy = (kind: PsseStudyKind) => {
    setStudyKind(kind);
    setStudyError(null);
    if (!computed.parsed) {
      setStudyError("No parsed PSS/E case available.");
      return;
    }
    try {
      if (kind === "accc") {
        const res = analyzeN1Contingencies(computed.parsed);
        setStudyOutput({
          kind,
          summary: `ACCC N-1 Contingency Analysis: ${res.totalContingencies} screened · ${res.violationCount} violations · ${res.collapseCount} collapses`,
          details: res.reportText || JSON.stringify(res, null, 2),
        });
      } else if (kind === "ascc") {
        const res = calculateShortCircuit(computed.parsed);
        setStudyOutput({
          kind,
          summary: `ASCC Short-Circuit Fault Study (${res.buses.length} buses)`,
          details: res.reportText || JSON.stringify(res, null, 2),
        });
      } else if (kind === "cpf") {
        const res = solveContinuationPowerFlow(computed.parsed);
        setStudyOutput({
          kind,
          summary: `Continuation Power Flow: λ_max = ${res.lambdaMax.toFixed(3)} · Margin ${res.marginPercent.toFixed(1)}% · Weakest Bus ${res.weakestBus}`,
          details: res.reportText || JSON.stringify(res, null, 2),
        });
      } else if (kind === "small_signal") {
        const res = analyzeSmallSignalStability(computed.parsed);
        setStudyOutput({
          kind,
          summary: `Small-Signal Modal Analysis: ${res.modes.length} modes · Min damping ${(res.summary.minDampingRatio * 100).toFixed(2)}% · ${res.summary.stable ? "STABLE" : "UNSTABLE"}`,
          details: res.reportText || JSON.stringify(res, null, 2),
        });
      } else if (kind === "gic") {
        const res = calculateGic(computed.parsed);
        setStudyOutput({
          kind,
          summary: `GIC Geomagnetic Disturbance: ${res.transformers.length} transformers · Max GIC ${res.maxTransformerEffectiveGicAmp.toFixed(2)} A · ${res.tpl007ViolationsCount} TPL-007 violations`,
          details: JSON.stringify(res, null, 2),
        });
      } else if (kind === "breaker_duty") {
        const res = evaluateBreakerDuty(computed.parsed);
        setStudyOutput({
          kind,
          summary: `Breaker Interrupting Duty: ${res.buses.length} buses · ${res.exceededCount} exceeded · Max ${res.maxDutyPercent.toFixed(1)}%`,
          details: res.summary || JSON.stringify(res, null, 2),
        });
      } else if (kind === "n11") {
        const res = analyzeN11Contingencies(computed.parsed);
        setStudyOutput({
          kind,
          summary: `N-1-1 Compound Contingencies: ${res.totalPairs} pairs · ${res.violationCount} violations · ${res.collapseCount} collapses`,
          details: res.summary || JSON.stringify(res, null, 2),
        });
      } else {
        const res = solveHelmPowerFlow(computed.parsed);
        setStudyOutput({
          kind,
          summary: `HELM Holomorphic Embedding Power Flow: ${res.converged ? "CONVERGED" : "DIVERGED"} (${res.iterations} terms)`,
          details: formatPowerFlowReport(res),
        });
      }
    } catch (err) {
      setStudyOutput(null);
      setStudyError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle={computed.parsed ? `SBASE ${computed.parsed.header?.sbase ?? 100} MVA` : "PSS/E RAW"}
        badge={
          computed.loading
            ? { label: "Loading…", tone: "info" }
            : computed.parseError
              ? { label: "Parse Error", tone: "danger" }
              : computed.pf?.converged
                ? { label: "Converged", tone: "success" }
                : computed.pfError
                  ? { label: "Solver Error", tone: "danger" }
                  : { label: "PSS/E", tone: "info" }
        }
        actions={
          <>
            <select
              aria-label="Power flow solver algorithm"
              value={algorithm}
              onChange={(e) => setAlgorithm(e.target.value as "newton_raphson" | "fast_decoupled")}
              style={{
                fontSize: "11px",
                padding: "3px 6px",
                borderRadius: "6px",
                border: "1px solid var(--ms-border)",
                background: "var(--ms-bg-soft)",
                color: "var(--ms-text-1)",
              }}
            >
              <option value="newton_raphson">Newton-Raphson</option>
              <option value="fast_decoupled">Fast Decoupled</option>
            </select>
            {activeTab === "sld" && host.exportFile && (
              <PanelButton onClick={handleExportSvg} disabled={!sldSvg}>
                Export SVG
              </PanelButton>
            )}
            {mode !== "artifact" && computed.parsed && (host.exportFile || host.onUpdateProjectFile) && (
              <PanelButton onClick={handleExportModelica}>Export Modelica</PanelButton>
            )}
            {mode === "artifact" && host.openInAnsatzEditor && code && (
              <PanelButton variant="primary" onClick={() => host.openInAnsatzEditor?.(code, dialect || "psse", title)}>
                Open in Editor
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<PsseTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "sld", label: "Single-Line Diagram" },
          { id: "buses", label: "Buses", count: busRows.length },
          { id: "branches", label: "Branches & Xfmrs", count: branchAndXfmrRows.length },
          { id: "generators", label: "Generators", count: generatorRows.length },
          { id: "studies", label: "Studies" },
          { id: "report", label: "Report & Lints", count: computed.lints.length },
        ]}
      />

      {activeTab === "sld" && (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", position: "relative" }}>
          <PanelSvgStage
            svg={sldSvg}
            canvasTheme={canvasTheme}
            onToggleCanvasTheme={() =>
              setCanvasThemeOverride((prev) => ((prev ?? colorMode) === "dark" ? "light" : "dark"))
            }
            onRevealLine={host.onRevealLine}
            onSelectEntity={setSelectedEntity}
            hudExtra={
              <>
                <PanelButton
                  variant={layoutMode === "auto" ? "primary" : "ghost"}
                  onClick={() => setLayoutMode("auto")}
                  style={{ padding: "2px 7px" }}
                >
                  Auto Layout
                </PanelButton>
                <PanelButton
                  variant={layoutMode === "geographic" ? "primary" : "ghost"}
                  onClick={() => setLayoutMode("geographic")}
                  style={{ padding: "2px 7px" }}
                >
                  Geographic
                </PanelButton>
              </>
            }
            emptyMessage={
              computed.loading
                ? "Loading PSS/E WebAssembly parser…"
                : (computed.parseError ?? "Load a PSS/E .raw file to visualize the Single-Line Diagram.")
            }
          />
          {selectedEntitySummary && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                padding: "7px 12px",
                borderTop: "1px solid var(--ms-border)",
                background: "var(--ms-bg-alt)",
                flexShrink: 0,
                fontSize: "11.5px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0, overflow: "hidden" }}>
                <span style={{ fontWeight: 600, color: "var(--ms-text-heading)", whiteSpace: "nowrap" }}>
                  {selectedEntitySummary.title}
                </span>
                <span
                  style={{
                    color: "var(--ms-text-2)",
                    fontFamily: "var(--ms-font-mono)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {selectedEntitySummary.details}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
                {selectedEntitySummary.line && host.onRevealLine && (
                  <PanelButton
                    variant="primary"
                    onClick={() => host.onRevealLine?.(selectedEntitySummary.line!, selectedEntitySummary.title)}
                  >
                    Line {selectedEntitySummary.line}
                  </PanelButton>
                )}
                <PanelButton variant="ghost" onClick={() => setSelectedEntity(null)} aria-label="Dismiss selection">
                  ✕
                </PanelButton>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "buses" && (
        <PanelDataGrid
          rows={busRows}
          columns={busColumns}
          rowKey={(b) => String(b.i)}
          searchPlaceholder="Filter buses by number, name, or kV…"
          onRowClick={(b) => b.span?.line && host.onRevealLine?.(b.span.line, b.name)}
          emptyMessage="No buses parsed."
        />
      )}

      {activeTab === "branches" && (
        <PanelDataGrid
          rows={branchAndXfmrRows}
          columns={branchColumns}
          rowKey={(r) => r.key}
          searchPlaceholder="Filter lines & transformers by bus, circuit, or type…"
          onRowClick={(r) => r.line && host.onRevealLine?.(r.line)}
          emptyMessage="No branches or transformers parsed."
        />
      )}

      {activeTab === "generators" && (
        <PanelDataGrid
          rows={generatorRows}
          columns={generatorColumns}
          rowKey={(g, idx) => `${g.i}-${g.id}-${idx}`}
          searchPlaceholder="Filter generators by bus or ID…"
          onRowClick={(g) => g.span?.line && host.onRevealLine?.(g.span.line)}
          emptyMessage="No generators parsed."
        />
      )}

      {activeTab === "studies" && (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            padding: "12px",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
            <PanelButton
              variant={studyKind === "accc" ? "primary" : "default"}
              disabled={!computed.parsed}
              onClick={() => handleRunStudy("accc")}
            >
              Run N-1 Contingencies (ACCC)
            </PanelButton>
            <PanelButton
              variant={studyKind === "ascc" ? "primary" : "default"}
              disabled={!computed.parsed}
              onClick={() => handleRunStudy("ascc")}
            >
              Run Short-Circuit (ASCC)
            </PanelButton>
            <PanelButton
              variant={studyKind === "cpf" ? "primary" : "default"}
              disabled={!computed.parsed}
              onClick={() => handleRunStudy("cpf")}
            >
              Run Voltage Stability (CPF)
            </PanelButton>
            <PanelButton
              variant={studyKind === "small_signal" ? "primary" : "default"}
              disabled={!computed.parsed}
              onClick={() => handleRunStudy("small_signal")}
            >
              Run Small-Signal Modes
            </PanelButton>
            <PanelButton
              variant={studyKind === "gic" ? "primary" : "default"}
              disabled={!computed.parsed}
              onClick={() => handleRunStudy("gic")}
            >
              Run GIC (Geomagnetic)
            </PanelButton>
            <PanelButton
              variant={studyKind === "breaker_duty" ? "primary" : "default"}
              disabled={!computed.parsed}
              onClick={() => handleRunStudy("breaker_duty")}
            >
              Run Breaker Duty
            </PanelButton>
            <PanelButton
              variant={studyKind === "n11" ? "primary" : "default"}
              disabled={!computed.parsed}
              onClick={() => handleRunStudy("n11")}
            >
              Run N-1-1 Screening
            </PanelButton>
            <PanelButton
              variant={studyKind === "helm" ? "primary" : "default"}
              disabled={!computed.parsed}
              onClick={() => handleRunStudy("helm")}
            >
              Run HELM Power Flow
            </PanelButton>
          </div>
          {studyError && (
            <div
              style={{
                padding: "8px 10px",
                borderRadius: "6px",
                background: "var(--ms-status-fail-bg)",
                border: "1px solid var(--ms-status-fail-border)",
                color: "var(--ms-status-fail-fg)",
                fontSize: "12px",
              }}
            >
              {studyError}
            </div>
          )}
          {studyOutput ? (
            <>
              <div
                style={{
                  padding: "8px 10px",
                  borderRadius: "6px",
                  background: "var(--ms-status-info-bg)",
                  border: "1px solid var(--ms-status-info-border)",
                  color: "var(--ms-status-info-fg)",
                  fontWeight: 600,
                  fontSize: "12px",
                }}
              >
                {studyOutput.summary}
              </div>
              <pre
                style={{
                  margin: 0,
                  padding: "10px",
                  borderRadius: "6px",
                  background: "var(--ms-bg-alt)",
                  border: "1px solid var(--ms-border)",
                  fontFamily: "var(--ms-font-mono)",
                  fontSize: "11px",
                  overflowX: "auto",
                  maxHeight: "420px",
                }}
              >
                {studyOutput.details}
              </pre>
            </>
          ) : (
            <div style={{ color: "var(--ms-text-2)", fontSize: "12px" }}>
              Select a power-system study above to run on-demand analysis against the active PSS/E case.
            </div>
          )}
        </div>
      )}

      {activeTab === "report" && (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            padding: "12px",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          {computed.pfError && (
            <div
              style={{
                padding: "8px 10px",
                borderRadius: "6px",
                background: "var(--ms-status-fail-bg)",
                border: "1px solid var(--ms-status-fail-border)",
                color: "var(--ms-status-fail-fg)",
                fontSize: "12px",
              }}
            >
              AC Power Flow failed: {computed.pfError}
            </div>
          )}
          {computed.pf && (
            <pre
              style={{
                margin: 0,
                padding: "10px",
                borderRadius: "6px",
                background: "var(--ms-bg-alt)",
                border: "1px solid var(--ms-border)",
                fontFamily: "var(--ms-font-mono)",
                fontSize: "11px",
                overflowX: "auto",
              }}
            >
              {formatPowerFlowReport(computed.pf)}
            </pre>
          )}
          <div style={{ fontWeight: 600 }}>Grid Diagnostics ({computed.lints.length})</div>
          {computed.lints.length === 0 ? (
            <div style={{ color: "var(--ms-text-2)" }}>No PSS/E lint diagnostics found.</div>
          ) : (
            computed.lints.map((d, idx) => {
              const diagLine =
                (d as unknown as { span?: { line?: number }; line?: number }).span?.line ??
                (d as unknown as { line?: number }).line;
              const isErr = d.severity === "error";
              const isWarn = d.severity === "warning";
              return (
                <div
                  key={`${d.code}-${idx}`}
                  onClick={diagLine && host.onRevealLine ? () => host.onRevealLine?.(diagLine, d.code) : undefined}
                  style={{
                    padding: "7px 10px",
                    borderRadius: "6px",
                    background: isErr
                      ? "var(--ms-status-fail-bg)"
                      : isWarn
                        ? "var(--ms-status-warn-bg)"
                        : "var(--ms-bg-alt)",
                    border: `1px solid ${
                      isErr
                        ? "var(--ms-status-fail-border)"
                        : isWarn
                          ? "var(--ms-status-warn-border)"
                          : "var(--ms-border)"
                    }`,
                    cursor: diagLine && host.onRevealLine ? "pointer" : "default",
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: "8px",
                  }}
                >
                  <div>
                    <span
                      style={{
                        fontWeight: 600,
                        fontFamily: "var(--ms-font-mono)",
                        marginRight: "6px",
                        color: isErr
                          ? "var(--ms-status-fail-fg)"
                          : isWarn
                            ? "var(--ms-status-warn-fg)"
                            : "var(--ms-text-heading)",
                      }}
                    >
                      [{d.code}]
                    </span>
                    <span>{d.message}</span>
                  </div>
                  {diagLine && (
                    <span
                      style={{
                        fontSize: "10.5px",
                        fontFamily: "var(--ms-font-mono)",
                        color: "var(--ms-text-2)",
                        flexShrink: 0,
                      }}
                    >
                      L{diagLine}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </PanelShell>
  );
};

export default PssePanel;
