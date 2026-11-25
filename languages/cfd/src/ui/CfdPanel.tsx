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
import React, { useMemo, useState } from "react";
import { parseSu2Config } from "../dialects/su2.js";

type CfdTabId = "overview" | "parameters" | "markers";

export const CfdPanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<CfdTabId>("overview");
  const [search, setSearch] = useState("");

  const computed = useMemo(() => {
    if (!code.trim()) return { model: null, error: undefined as string | undefined };
    try {
      return { model: parseSu2Config(code), error: undefined };
    } catch (err) {
      return { model: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [code]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    computed.model?.directives?.get("SOLVER") ||
    "CFD / SU2 Aerodynamics Config";

  const paramEntries = useMemo(() => {
    const entries = Array.from(computed.model?.directives?.entries() ?? []);
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(([k, v]) => k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q));
  }, [computed.model, search]);

  const markers = useMemo(() => Array.from(computed.model?.markers?.values() ?? []), [computed.model]);

  const kpis = useMemo<PanelKpiItem[]>(() => {
    const m = computed.model;
    const solver = m?.directives?.get("SOLVER") ?? m?.mathProblem ?? "—";
    return [
      { label: "Solver", value: solver, tone: "info" },
      { label: "Mach", value: m?.machNumber ?? "—" },
      { label: "Reynolds", value: m?.reynoldsNumber ? m.reynoldsNumber.toExponential(2) : "—" },
      { label: "Directives", value: m?.directives?.size ?? 0 },
      { label: "Markers", value: markers.length },
    ];
  }, [computed.model, markers.length]);

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle={computed.model?.dialect ? `Dialect: ${computed.model.dialect}` : "CFD / SU2"}
        badge={computed.error ? { label: "Parse Error", tone: "danger" } : { label: "CFD", tone: "info" }}
        actions={
          mode === "artifact" && host.openInAnsatzEditor && code ? (
            <PanelButton variant="primary" onClick={() => host.openInAnsatzEditor?.(code, dialect || "cfd", title)}>
              Open in Ansatz Editor
            </PanelButton>
          ) : undefined
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<CfdTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "overview", label: "Flow Regime" },
          { id: "parameters", label: "Directives", count: computed.model?.directives?.size ?? 0 },
          { id: "markers", label: "Boundary Markers", count: markers.length },
        ]}
      />

      {activeTab === "overview" && (
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "12px",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "10px",
            alignContent: "start",
          }}
        >
          {[
            { label: "Solver", value: computed.model?.directives?.get("SOLVER") ?? "N/A" },
            { label: "Turbulence Model", value: computed.model?.directives?.get("KIND_TURB_MODEL") ?? "N/A" },
            { label: "Mach Number", value: computed.model?.machNumber ?? "N/A" },
            { label: "Angle of Attack (deg)", value: computed.model?.aoa ?? "N/A" },
            { label: "Density (kg/m³)", value: computed.model?.density ?? "N/A" },
            { label: "Freestream Velocity (m/s)", value: computed.model?.freestreamVelocity ?? "N/A" },
          ].map((card) => (
            <div
              key={card.label}
              style={{
                padding: "10px 12px",
                borderRadius: "6px",
                background: "var(--ms-bg-alt)",
                border: "1px solid var(--ms-border)",
              }}
            >
              <div style={{ fontSize: "10px", textTransform: "uppercase", color: "var(--ms-text-2)" }}>
                {card.label}
              </div>
              <div style={{ fontSize: "13px", fontWeight: 600, fontFamily: "var(--ms-font-mono)", marginTop: "4px" }}>
                {String(card.value)}
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === "parameters" && (
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
            placeholder="Filter SU2/CFD directives..."
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
                <th style={{ padding: "5px 6px" }}>Key</th>
                <th style={{ padding: "5px 6px" }}>Value</th>
              </tr>
            </thead>
            <tbody>
              {paramEntries.map(([k, v]) => (
                <tr key={k} style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}>
                  <td style={{ padding: "4px 6px", fontWeight: 600 }}>{k}</td>
                  <td style={{ padding: "4px 6px", color: "var(--ms-text-2)" }}>{String(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "markers" && (
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
          {markers.length === 0 ? (
            <div style={{ color: "var(--ms-text-2)" }}>No boundary markers configured.</div>
          ) : (
            markers.map((mk, idx) => (
              <div
                key={`${mk.name}-${idx}`}
                style={{
                  padding: "7px 10px",
                  borderRadius: "6px",
                  background: "var(--ms-bg-alt)",
                  border: "1px solid var(--ms-border)",
                  display: "flex",
                  justifyContent: "space-between",
                  fontFamily: "var(--ms-font-mono)",
                }}
              >
                <strong>{mk.name}</strong>
                <span style={{ color: "var(--ms-text-2)" }}>{mk.type}</span>
              </div>
            ))
          )}
        </div>
      )}
    </PanelShell>
  );
};

export default CfdPanel;
