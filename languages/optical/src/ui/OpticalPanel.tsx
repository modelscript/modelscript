// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LanguagePanelProps } from "@modelscript/design-tokens/panel";
import { PanelKpiStrip, PanelShell, PanelTabBar, PanelToolbar } from "@modelscript/design-tokens/panel";
import React, { useMemo, useState } from "react";
import { parseOpenRoadmTopology } from "../parser/openroadm-parser.js";

type OpticalTab = "nodes" | "spans" | "channels";

export const OpticalPanel: React.FC<LanguagePanelProps> = ({ code, colorMode, mode, isFullScreen }) => {
  const [tab, setTab] = useState<OpticalTab>("nodes");

  const { topology, error } = useMemo(() => {
    try {
      return { topology: parseOpenRoadmTopology(code || ""), error: null as string | null };
    } catch (e) {
      return { topology: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [code]);

  const nodes = useMemo(() => (topology ? Array.from(topology.nodes.values()) : []), [topology]);
  const spans = useMemo(() => (topology ? Array.from(topology.spans.values()) : []), [topology]);
  const channels = useMemo(() => (topology ? Array.from(topology.channels.values()) : []), [topology]);

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={topology?.name ? `Optical DWDM: ${topology.name}` : "Optical DWDM / OpenROADM Studio"}
        subtitle={`${nodes.length} nodes · ${spans.length} fiber spans · ${channels.length} channels`}
      />
      {error && <div style={{ color: "var(--ms-error, #f85149)", fontSize: 12, padding: 8 }}>Parse error: {error}</div>}
      <PanelKpiStrip
        items={[
          { label: "Nodes", value: nodes.length },
          { label: "Spans", value: spans.length },
          { label: "Channels", value: channels.length },
        ]}
      />
      <PanelTabBar
        activeTab={tab}
        onSelect={(id) => setTab(id as OpticalTab)}
        tabs={[
          { id: "nodes", label: `Nodes (${nodes.length})` },
          { id: "spans", label: `Spans (${spans.length})` },
          { id: "channels", label: `Channels (${channels.length})` },
        ]}
      />
      <div style={{ overflow: "auto", flex: 1, fontSize: 12 }}>
        {tab === "nodes" && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border-default, #30363d)" }}>
                <th style={{ padding: "6px 8px" }}>Node ID</th>
                <th style={{ padding: "6px 8px" }}>Type</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((n) => (
                <tr key={n.id} style={{ borderBottom: "1px solid var(--ms-border-subtle, rgba(128,128,128,0.15))" }}>
                  <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>{n.id}</td>
                  <td style={{ padding: "5px 8px" }}>{n.nodeType}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === "spans" && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border-default, #30363d)" }}>
                <th style={{ padding: "6px 8px" }}>Span</th>
                <th style={{ padding: "6px 8px" }}>Endpoints</th>
                <th style={{ padding: "6px 8px" }}>Length (km)</th>
              </tr>
            </thead>
            <tbody>
              {spans.map((s) => (
                <tr key={s.id} style={{ borderBottom: "1px solid var(--ms-border-subtle, rgba(128,128,128,0.15))" }}>
                  <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>{s.id}</td>
                  <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>
                    {s.fromNodeId} → {s.toNodeId}
                  </td>
                  <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>{s.lengthKm.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === "channels" && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border-default, #30363d)" }}>
                <th style={{ padding: "6px 8px" }}>Channel</th>
                <th style={{ padding: "6px 8px" }}>Freq (THz)</th>
                <th style={{ padding: "6px 8px" }}>Modulation</th>
                <th style={{ padding: "6px 8px" }}>Req OSNR (dB)</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((c) => (
                <tr key={c.id} style={{ borderBottom: "1px solid var(--ms-border-subtle, rgba(128,128,128,0.15))" }}>
                  <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>{c.id}</td>
                  <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>{c.centerFrequencyThz.toFixed(3)}</td>
                  <td style={{ padding: "5px 8px" }}>{c.modulation}</td>
                  <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>{c.requiredOsnrDb.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </PanelShell>
  );
};

export default OpticalPanel;
