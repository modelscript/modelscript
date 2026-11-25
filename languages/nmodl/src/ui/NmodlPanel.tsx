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
import { parseNmodl } from "../parser/nmodl-parser.js";

type NmodlTabId = "overview" | "parameters" | "states";

export const NmodlPanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<NmodlTabId>("overview");

  const computed = useMemo(() => {
    if (!code.trim()) return { doc: null, error: undefined as string | undefined };
    try {
      return { doc: parseNmodl(code), error: undefined };
    } catch (err) {
      return { doc: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [code]);

  const m = computed.doc?.model;
  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    m?.title ||
    m?.suffix ||
    "NMODL Ion Channel Mechanism";

  const params = m?.parameters ?? [];
  const states = m?.states ?? [];

  const kpis = useMemo<PanelKpiItem[]>(
    () => [
      { label: "Mechanism", value: m?.suffix ?? "—", tone: "info" },
      { label: "States", value: states.length },
      { label: "Parameters", value: params.length },
      { label: "Ions", value: m?.ions?.length ?? 0 },
    ],
    [m, states.length, params.length],
  );

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="NEURON NMODL Electrophysiology"
        badge={computed.error ? { label: "Parse Error", tone: "danger" } : { label: "NMODL", tone: "info" }}
        actions={
          mode === "artifact" && host.openInAnsatzEditor && code ? (
            <PanelButton variant="primary" onClick={() => host.openInAnsatzEditor?.(code, dialect || "nmodl", title)}>
              Open in Ansatz Editor
            </PanelButton>
          ) : undefined
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<NmodlTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "overview", label: "Neuron Block" },
          { id: "parameters", label: "Parameters", count: params.length },
          { id: "states", label: "States", count: states.length },
        ]}
      />

      {activeTab === "overview" && (
        <div
          style={{ flex: 1, overflow: "auto", padding: "12px", display: "flex", flexDirection: "column", gap: "8px" }}
        >
          <div
            style={{
              padding: "8px 10px",
              borderRadius: "6px",
              background: "var(--ms-bg-alt)",
              border: "1px solid var(--ms-border)",
              fontFamily: "var(--ms-font-mono)",
            }}
          >
            SUFFIX: <strong>{m?.suffix ?? "—"}</strong>
          </div>
          <div
            style={{
              padding: "8px 10px",
              borderRadius: "6px",
              background: "var(--ms-bg-alt)",
              border: "1px solid var(--ms-border)",
              fontFamily: "var(--ms-font-mono)",
            }}
          >
            RANGE: {(m?.ranges ?? []).join(", ") || "—"}
          </div>
          <div
            style={{
              padding: "8px 10px",
              borderRadius: "6px",
              background: "var(--ms-bg-alt)",
              border: "1px solid var(--ms-border)",
              fontFamily: "var(--ms-font-mono)",
            }}
          >
            USEION: {(m?.ions ?? []).map((ion) => ion.ion).join(", ") || "—"}
          </div>
        </div>
      )}

      {activeTab === "parameters" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>Parameter</th>
                <th style={{ padding: "5px 6px" }}>Default</th>
                <th style={{ padding: "5px 6px" }}>Units</th>
              </tr>
            </thead>
            <tbody>
              {params.map((p, idx) => (
                <tr
                  key={`${p.name}-${idx}`}
                  style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                >
                  <td style={{ padding: "4px 6px", fontWeight: 600 }}>{p.name}</td>
                  <td style={{ padding: "4px 6px" }}>{p.val ?? "—"}</td>
                  <td style={{ padding: "4px 6px", color: "var(--ms-text-2)" }}>{p.units ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "states" && (
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
          {states.map((st, idx) => (
            <div
              key={`${st.name}-${idx}`}
              style={{
                padding: "7px 10px",
                borderRadius: "6px",
                background: "var(--ms-bg-alt)",
                border: "1px solid var(--ms-border)",
                fontFamily: "var(--ms-font-mono)",
              }}
            >
              <strong>{st.name}</strong> {st.units ? `(${st.units})` : ""}
            </div>
          ))}
        </div>
      )}
    </PanelShell>
  );
};

export default NmodlPanel;
