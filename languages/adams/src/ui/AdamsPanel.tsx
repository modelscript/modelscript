// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LanguagePanelProps } from "@modelscript/design-tokens/panel";
import { PanelKpiStrip, PanelShell, PanelTabBar, PanelToolbar } from "@modelscript/design-tokens/panel";
import React, { useMemo, useState } from "react";
import { parseAdams } from "../parser/adams-parser.js";

type AdamsTab = "parts" | "joints" | "forces";

export const AdamsPanel: React.FC<LanguagePanelProps> = ({ code, colorMode, mode, isFullScreen }) => {
  const [tab, setTab] = useState<AdamsTab>("parts");

  const { dataset, error } = useMemo(() => {
    try {
      return { dataset: parseAdams(code || ""), error: null as string | null };
    } catch (e) {
      return { dataset: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [code]);

  const parts = useMemo(() => (dataset ? Array.from(dataset.parts.values()) : []), [dataset]);
  const joints = useMemo(() => (dataset ? Array.from(dataset.joints.values()) : []), [dataset]);
  const forces = useMemo(() => (dataset ? Array.from(dataset.forces.values()) : []), [dataset]);
  const totalMass = useMemo(() => parts.reduce((acc, p) => acc + (p.isGround ? 0 : p.mass), 0), [parts]);

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={dataset?.title ? `Adams: ${dataset.title}` : "MSC Adams Multibody Dynamics"}
        subtitle={`${parts.length} parts · ${joints.length} joints · ${forces.length} forces`}
      />
      {error && <div style={{ color: "var(--ms-error, #f85149)", fontSize: 12, padding: 8 }}>Parse error: {error}</div>}
      <PanelKpiStrip
        items={[
          { label: "Parts", value: parts.length },
          { label: "Joints", value: joints.length },
          { label: "Forces", value: forces.length },
          { label: "Total Mass", value: `${totalMass.toFixed(2)} kg` },
        ]}
      />
      <PanelTabBar
        activeTab={tab}
        onSelect={(id) => setTab(id as AdamsTab)}
        tabs={[
          { id: "parts", label: `Parts (${parts.length})` },
          { id: "joints", label: `Joints (${joints.length})` },
          { id: "forces", label: `Forces (${forces.length})` },
        ]}
      />
      <div style={{ overflow: "auto", flex: 1, fontSize: 12 }}>
        {tab === "parts" && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border-default, #30363d)" }}>
                <th style={{ padding: "6px 8px" }}>ID</th>
                <th style={{ padding: "6px 8px" }}>Name</th>
                <th style={{ padding: "6px 8px" }}>Role</th>
                <th style={{ padding: "6px 8px" }}>Mass</th>
              </tr>
            </thead>
            <tbody>
              {parts.map((p) => (
                <tr
                  key={String(p.id)}
                  style={{ borderBottom: "1px solid var(--ms-border-subtle, rgba(128,128,128,0.15))" }}
                >
                  <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>{String(p.id)}</td>
                  <td style={{ padding: "5px 8px" }}>{p.name}</td>
                  <td style={{ padding: "5px 8px" }}>{p.isGround ? "Ground" : "Rigid Body"}</td>
                  <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>{p.mass.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === "joints" && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border-default, #30363d)" }}>
                <th style={{ padding: "6px 8px" }}>ID</th>
                <th style={{ padding: "6px 8px" }}>Type</th>
                <th style={{ padding: "6px 8px" }}>I / J Markers</th>
                <th style={{ padding: "6px 8px" }}>DOFs</th>
              </tr>
            </thead>
            <tbody>
              {joints.map((j) => (
                <tr
                  key={String(j.id)}
                  style={{ borderBottom: "1px solid var(--ms-border-subtle, rgba(128,128,128,0.15))" }}
                >
                  <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>{String(j.id)}</td>
                  <td style={{ padding: "5px 8px" }}>{j.type}</td>
                  <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>
                    {String(j.iMarkerId)} → {String(j.jMarkerId)}
                  </td>
                  <td style={{ padding: "5px 8px" }}>{j.dofCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === "forces" && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border-default, #30363d)" }}>
                <th style={{ padding: "6px 8px" }}>ID</th>
                <th style={{ padding: "6px 8px" }}>Type</th>
                <th style={{ padding: "6px 8px" }}>Stiffness / Damping</th>
              </tr>
            </thead>
            <tbody>
              {forces.map((f) => (
                <tr
                  key={String(f.id)}
                  style={{ borderBottom: "1px solid var(--ms-border-subtle, rgba(128,128,128,0.15))" }}
                >
                  <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>{String(f.id)}</td>
                  <td style={{ padding: "5px 8px" }}>{f.type}</td>
                  <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>
                    {f.stiffness !== undefined ? `k=${f.stiffness}` : "—"}{" "}
                    {f.damping !== undefined ? `c=${f.damping}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </PanelShell>
  );
};

export default AdamsPanel;
