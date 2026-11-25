// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  PanelButton,
  PanelKpiStrip,
  PanelShell,
  PanelSvgStage,
  PanelTabBar,
  PanelToolbar,
  type LanguagePanelProps,
  type PanelKpiItem,
} from "@modelscript/design-tokens/panel";
import { renderPsseSvg, type PsseCaseLike, type PssePowerFlowOverlay } from "@modelscript/diagram/psse-diagram-builder";
import React, { useEffect, useMemo, useState } from "react";
import { lintPsse } from "../lints/index.js";
import { parseRaw } from "../parser/raw-parser.js";
import { ensurePsseWasmParser, isPsseWasmParserReady } from "../parser/wasm-loader.js";
import { psseToModelica } from "../projections/psse-to-modelica.js";
import { formatPowerFlowReport, solvePowerFlow } from "../solver/ac-powerflow.js";
import type { PsseCase } from "../types.js";

type PsseTabId = "sld" | "buses" | "branches" | "generators" | "report";

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
  const [search, setSearch] = useState("");
  const [parserReady, setParserReady] = useState<boolean>(() => isPsseWasmParserReady());
  const [parserLoadError, setParserLoadError] = useState<string | undefined>(undefined);

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
        lints: [] as ReturnType<typeof lintPsse>,
        parseError: undefined as string | undefined,
        loading: false,
      };
    }
    if (!parserReady) {
      return {
        parsed: null as PsseCase | null,
        pf: null as ReturnType<typeof solvePowerFlow> | null,
        lints: [] as ReturnType<typeof lintPsse>,
        parseError: parserLoadError,
        loading: !parserLoadError,
      };
    }
    try {
      const parsed = parseRaw(code);
      let pf: ReturnType<typeof solvePowerFlow> | null = null;
      try {
        pf = solvePowerFlow(parsed, { algorithm: "newton_raphson", maxIterations: 25 });
      } catch {
        pf = null;
      }
      const lints = lintPsse(parsed);
      return { parsed, pf, lints, parseError: undefined, loading: false };
    } catch (err) {
      return {
        parsed: null,
        pf: null,
        lints: [],
        parseError: err instanceof Error ? err.message : String(err),
        loading: false,
      };
    }
  }, [code, parserReady, parserLoadError]);

  const title = (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) || "PSS/E Power Flow Grid";

  const sldSvg = useMemo(() => {
    if (!computed.parsed) return "";
    try {
      const overlay = computed.pf as unknown as PssePowerFlowOverlay | undefined;
      return renderPsseSvg(computed.parsed as unknown as PsseCaseLike, overlay);
    } catch {
      return "";
    }
  }, [computed.parsed, computed.pf]);

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

  const filteredBuses = useMemo(() => {
    const list = computed.parsed ? Array.from(computed.parsed.buses.values()) : [];
    const q = search.trim().toLowerCase();
    if (!q) return list.slice(0, 200);
    return list.filter((b) => String(b.i).includes(q) || (b.name ?? "").toLowerCase().includes(q)).slice(0, 200);
  }, [computed.parsed, search]);

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
                : { label: "PSS/E", tone: "info" }
        }
        actions={
          <>
            {activeTab === "sld" && host.exportFile && (
              <PanelButton onClick={handleExportSvg} disabled={!sldSvg}>
                Export SLD SVG
              </PanelButton>
            )}
            {mode !== "artifact" && computed.parsed && (host.exportFile || host.onUpdateProjectFile) && (
              <PanelButton onClick={handleExportModelica}>Export Modelica</PanelButton>
            )}
            {mode === "artifact" && host.openInAnsatzEditor && code && (
              <PanelButton variant="primary" onClick={() => host.openInAnsatzEditor?.(code, dialect || "psse", title)}>
                Open in Ansatz Editor
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
          { id: "buses", label: "Buses", count: computed.parsed?.buses?.size ?? 0 },
          {
            id: "branches",
            label: "Branches & Xfmrs",
            count: (computed.parsed?.branches?.length ?? 0) + (computed.parsed?.transformers?.length ?? 0),
          },
          { id: "generators", label: "Generators", count: computed.parsed?.generators?.length ?? 0 },
          { id: "report", label: "Report & Lints", count: computed.lints.length },
        ]}
      />

      {activeTab === "sld" && (
        <PanelSvgStage
          svg={sldSvg}
          onRevealLine={host.onRevealLine}
          emptyMessage={
            computed.loading
              ? "Loading PSS/E WebAssembly parser…"
              : (computed.parseError ?? "Load a PSS/E .raw file to visualize the Single-Line Diagram.")
          }
        />
      )}

      {activeTab === "buses" && (
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter buses by number or name..."
            style={{
              padding: "5px 8px",
              borderRadius: "5px",
              border: "1px solid var(--ms-border)",
              background: "var(--ms-bg-soft)",
              color: "var(--ms-text-1)",
              fontSize: "12px",
            }}
          />
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>Bus #</th>
                <th style={{ padding: "5px 6px" }}>Name</th>
                <th style={{ padding: "5px 6px" }}>Base kV</th>
                <th style={{ padding: "5px 6px" }}>Type</th>
                <th style={{ padding: "5px 6px" }}>|V| (p.u.)</th>
                <th style={{ padding: "5px 6px" }}>Angle (deg)</th>
              </tr>
            </thead>
            <tbody>
              {filteredBuses.map((bus) => {
                const solved = busVoltageMap.get(bus.i);
                const vm = solved?.vm ?? bus.vm ?? 1.0;
                const va = solved?.va ?? bus.va ?? 0.0;
                const vTone = vm < 0.95 || vm > 1.05 ? "var(--ms-warning)" : "var(--ms-text-1)";
                return (
                  <tr
                    key={bus.i}
                    onClick={() => bus.span?.line && host.onRevealLine?.(bus.span.line, bus.name)}
                    style={{
                      borderBottom: "1px solid var(--ms-divider)",
                      fontFamily: "var(--ms-font-mono)",
                      cursor: bus.span?.line ? "pointer" : "default",
                    }}
                  >
                    <td style={{ padding: "4px 6px" }}>{bus.i}</td>
                    <td style={{ padding: "4px 6px", fontFamily: "var(--ms-font-sans)" }}>{bus.name}</td>
                    <td style={{ padding: "4px 6px" }}>{bus.baseKv}</td>
                    <td style={{ padding: "4px 6px" }}>{bus.ide}</td>
                    <td style={{ padding: "4px 6px", color: vTone, fontWeight: 600 }}>{vm.toFixed(4)}</td>
                    <td style={{ padding: "4px 6px" }}>{va.toFixed(2)}°</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "branches" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>From</th>
                <th style={{ padding: "5px 6px" }}>To</th>
                <th style={{ padding: "5px 6px" }}>Ckt</th>
                <th style={{ padding: "5px 6px" }}>R (p.u.)</th>
                <th style={{ padding: "5px 6px" }}>X (p.u.)</th>
                <th style={{ padding: "5px 6px" }}>Rate A (MVA)</th>
              </tr>
            </thead>
            <tbody>
              {(computed.parsed?.branches ?? []).slice(0, 200).map((br, idx) => (
                <tr
                  key={`${br.i}-${br.j}-${br.ckt}-${idx}`}
                  onClick={() => br.span?.line && host.onRevealLine?.(br.span.line)}
                  style={{
                    borderBottom: "1px solid var(--ms-divider)",
                    fontFamily: "var(--ms-font-mono)",
                    cursor: br.span?.line ? "pointer" : "default",
                  }}
                >
                  <td style={{ padding: "4px 6px" }}>{br.i}</td>
                  <td style={{ padding: "4px 6px" }}>{br.j}</td>
                  <td style={{ padding: "4px 6px" }}>{br.ckt}</td>
                  <td style={{ padding: "4px 6px" }}>{br.r.toFixed(5)}</td>
                  <td style={{ padding: "4px 6px" }}>{br.x.toFixed(5)}</td>
                  <td style={{ padding: "4px 6px" }}>{br.rateA}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "generators" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>Bus</th>
                <th style={{ padding: "5px 6px" }}>ID</th>
                <th style={{ padding: "5px 6px" }}>Pg (MW)</th>
                <th style={{ padding: "5px 6px" }}>Qg (MVAr)</th>
                <th style={{ padding: "5px 6px" }}>Vset (p.u.)</th>
                <th style={{ padding: "5px 6px" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {(computed.parsed?.generators ?? []).slice(0, 200).map((g, idx) => (
                <tr
                  key={`${g.i}-${g.id}-${idx}`}
                  onClick={() => g.span?.line && host.onRevealLine?.(g.span.line)}
                  style={{
                    borderBottom: "1px solid var(--ms-divider)",
                    fontFamily: "var(--ms-font-mono)",
                    cursor: g.span?.line ? "pointer" : "default",
                  }}
                >
                  <td style={{ padding: "4px 6px" }}>{g.i}</td>
                  <td style={{ padding: "4px 6px" }}>{g.id}</td>
                  <td style={{ padding: "4px 6px" }}>{g.pg.toFixed(2)}</td>
                  <td style={{ padding: "4px 6px" }}>{g.qg.toFixed(2)}</td>
                  <td style={{ padding: "4px 6px" }}>{g.vs.toFixed(4)}</td>
                  <td style={{ padding: "4px 6px" }}>{g.stat === 1 ? "IN" : "OUT"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "report" && (
        <div
          style={{ flex: 1, overflow: "auto", padding: "12px", display: "flex", flexDirection: "column", gap: "10px" }}
        >
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
            computed.lints.slice(0, 100).map((d, idx) => (
              <div
                key={`${d.code}-${idx}`}
                style={{
                  padding: "7px 10px",
                  borderRadius: "6px",
                  background: "var(--ms-bg-alt)",
                  border: "1px solid var(--ms-border)",
                }}
              >
                <span style={{ fontWeight: 600, fontFamily: "var(--ms-font-mono)", marginRight: "6px" }}>
                  [{d.code}]
                </span>
                <span>{d.message}</span>
              </div>
            ))
          )}
        </div>
      )}
    </PanelShell>
  );
};

export default PssePanel;
