// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LanguagePanelProps } from "@modelscript/design-tokens/panel";
import { PanelKpiStrip, PanelShell, PanelTabBar, PanelToolbar } from "@modelscript/design-tokens/panel";
import React, { useMemo, useState } from "react";
import { parsePowerFactoryText } from "../parser/powerfactory-parser.js";

type PfTab = "terminals" | "lines" | "machines";

export const PowerFactoryPanel: React.FC<LanguagePanelProps> = ({ code, colorMode, mode, isFullScreen }) => {
  const [tab, setTab] = useState<PfTab>("terminals");

  const { model, error } = useMemo(() => {
    try {
      return { model: parsePowerFactoryText(code || ""), error: null as string | null };
    } catch (e) {
      return { model: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [code]);

  const terminals = useMemo(() => (model ? Array.from(model.terminals.values()) : []), [model]);
  const lines = useMemo(() => (model ? Array.from(model.lines.values()) : []), [model]);
  const generators = useMemo(() => (model ? Array.from(model.generators.values()) : []), [model]);
  const loads = useMemo(() => (model ? Array.from(model.loads.values()) : []), [model]);

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={model?.name ? `PowerFactory: ${model.name}` : "DIgSILENT PowerFactory Grid"}
        subtitle={`${terminals.length} terminals · ${lines.length} lines · ${generators.length} generators`}
      />
      {error && <div style={{ color: "var(--ms-error, #f85149)", fontSize: 12, padding: 8 }}>Parse error: {error}</div>}
      <PanelKpiStrip
        items={[
          { label: "Terminals", value: terminals.length },
          { label: "Lines", value: lines.length },
          { label: "Generators", value: generators.length },
          { label: "Loads", value: loads.length },
        ]}
      />
      <PanelTabBar
        activeTab={tab}
        onSelect={(id) => setTab(id as PfTab)}
        tabs={[
          { id: "terminals", label: `Terminals (${terminals.length})` },
          { id: "lines", label: `Lines (${lines.length})` },
          { id: "machines", label: `Generators & Loads (${generators.length + loads.length})` },
        ]}
      />
      <div style={{ overflow: "auto", flex: 1, fontSize: 12 }}>
        {tab === "terminals" && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border-default, #30363d)" }}>
                <th style={{ padding: "6px 8px" }}>Name</th>
                <th style={{ padding: "6px 8px" }}>Nominal kV</th>
                <th style={{ padding: "6px 8px" }}>ID</th>
              </tr>
            </thead>
            <tbody>
              {terminals.map((t) => (
                <tr key={t.id} style={{ borderBottom: "1px solid var(--ms-border-subtle, rgba(128,128,128,0.15))" }}>
                  <td style={{ padding: "5px 8px" }}>{t.loc_name}</td>
                  <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>{t.uknom.toFixed(2)} kV</td>
                  <td style={{ padding: "5px 8px", fontFamily: "monospace", opacity: 0.7 }}>{t.id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === "lines" && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border-default, #30363d)" }}>
                <th style={{ padding: "6px 8px" }}>Line</th>
                <th style={{ padding: "6px 8px" }}>Length (km)</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} style={{ borderBottom: "1px solid var(--ms-border-subtle, rgba(128,128,128,0.15))" }}>
                  <td style={{ padding: "5px 8px" }}>{l.loc_name}</td>
                  <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>{l.dline.toFixed(3)} km</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === "machines" && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border-default, #30363d)" }}>
                <th style={{ padding: "6px 8px" }}>Kind</th>
                <th style={{ padding: "6px 8px" }}>Name</th>
              </tr>
            </thead>
            <tbody>
              {generators.map((g) => (
                <tr key={g.id} style={{ borderBottom: "1px solid var(--ms-border-subtle, rgba(128,128,128,0.15))" }}>
                  <td style={{ padding: "5px 8px" }}>ElmSym</td>
                  <td style={{ padding: "5px 8px" }}>{g.loc_name}</td>
                </tr>
              ))}
              {loads.map((ld) => (
                <tr key={ld.id} style={{ borderBottom: "1px solid var(--ms-border-subtle, rgba(128,128,128,0.15))" }}>
                  <td style={{ padding: "5px 8px" }}>ElmLod</td>
                  <td style={{ padding: "5px 8px" }}>{ld.loc_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </PanelShell>
  );
};

export default PowerFactoryPanel;
