// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LanguagePanelProps } from "@modelscript/design-tokens/panel";
import { PanelKpiStrip, PanelShell, PanelTabBar, PanelToolbar } from "@modelscript/design-tokens/panel";
import React, { useMemo, useState } from "react";
import { parseCantera } from "../parser/cantera-parser.js";

type CanteraTab = "species" | "reactions" | "phases";

export const CanteraPanel: React.FC<LanguagePanelProps> = ({ code, colorMode, mode, isFullScreen }) => {
  const [tab, setTab] = useState<CanteraTab>("species");

  const { doc, error } = useMemo(() => {
    try {
      return { doc: parseCantera(code || ""), error: null as string | null };
    } catch (e) {
      return { doc: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [code]);

  const mech = doc?.mechanism;
  const phases = useMemo(() => (mech ? Array.from(mech.phases.values()) : []), [mech]);
  const species = useMemo(() => (mech ? Array.from(mech.species.values()) : []), [mech]);
  const reactions = mech?.reactions ?? [];

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={mech?.name ? `Cantera: ${mech.name}` : "Cantera Chemical Kinetics Studio"}
        subtitle={`${phases.length} phases · ${species.length} species · ${reactions.length} reactions`}
      />
      {error && <div style={{ color: "var(--ms-error, #f85149)", fontSize: 12, padding: 8 }}>Parse error: {error}</div>}
      <PanelKpiStrip
        items={[
          { label: "Phases", value: phases.length },
          { label: "Species", value: species.length },
          { label: "Reactions", value: reactions.length },
          { label: "Format", value: doc?.format?.toUpperCase() ?? "YAML" },
        ]}
      />
      <PanelTabBar
        activeTab={tab}
        onSelect={(id) => setTab(id as CanteraTab)}
        tabs={[
          { id: "species", label: `Species (${species.length})` },
          { id: "reactions", label: `Reactions (${reactions.length})` },
          { id: "phases", label: `Phases (${phases.length})` },
        ]}
      />
      <div style={{ overflow: "auto", flex: 1, fontSize: 12 }}>
        {tab === "species" && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border-default, #30363d)" }}>
                <th style={{ padding: "6px 8px" }}>Species</th>
                <th style={{ padding: "6px 8px" }}>Composition</th>
              </tr>
            </thead>
            <tbody>
              {species.map((sp) => (
                <tr key={sp.name} style={{ borderBottom: "1px solid var(--ms-border-subtle, rgba(128,128,128,0.15))" }}>
                  <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>{sp.name}</td>
                  <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>
                    {Object.entries(sp.composition)
                      .map(([el, n]) => `${el}:${n}`)
                      .join(" ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === "reactions" && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border-default, #30363d)" }}>
                <th style={{ padding: "6px 8px" }}>#</th>
                <th style={{ padding: "6px 8px" }}>Equation</th>
                <th style={{ padding: "6px 8px" }}>Type</th>
              </tr>
            </thead>
            <tbody>
              {reactions.map((rxn, idx) => (
                <tr
                  key={`${rxn.equation}-${idx}`}
                  style={{ borderBottom: "1px solid var(--ms-border-subtle, rgba(128,128,128,0.15))" }}
                >
                  <td style={{ padding: "5px 8px" }}>{idx + 1}</td>
                  <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>{rxn.equation}</td>
                  <td style={{ padding: "5px 8px" }}>{rxn.type ?? "elementary"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === "phases" && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border-default, #30363d)" }}>
                <th style={{ padding: "6px 8px" }}>Phase</th>
                <th style={{ padding: "6px 8px" }}>Thermo</th>
                <th style={{ padding: "6px 8px" }}>Species</th>
              </tr>
            </thead>
            <tbody>
              {phases.map((ph) => (
                <tr key={ph.name} style={{ borderBottom: "1px solid var(--ms-border-subtle, rgba(128,128,128,0.15))" }}>
                  <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>{ph.name}</td>
                  <td style={{ padding: "5px 8px" }}>{ph.thermo}</td>
                  <td style={{ padding: "5px 8px" }}>{ph.species.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </PanelShell>
  );
};

export default CanteraPanel;
