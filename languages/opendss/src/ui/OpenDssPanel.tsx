// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LanguagePanelProps } from "@modelscript/design-tokens/panel";
import { PanelKpiStrip, PanelShell, PanelTabBar, PanelToolbar } from "@modelscript/design-tokens/panel";
import React, { useMemo, useState } from "react";

interface DssElementRow {
  cls: string;
  name: string;
  params: string;
}

function parseDssElements(source: string): { circuitName: string; elements: DssElementRow[]; buses: Set<string> } {
  let circuitName = "OpenDSS Feeder";
  const elements: DssElementRow[] = [];
  const buses = new Set<string>();

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine
      .replace(/!.*$/, "")
      .replace(/\/\/.*$/, "")
      .trim();
    if (!line) continue;
    const match = line.match(/^new\s+([A-Za-z0-9_]+)\.([^\s]+)\s*(.*)$/i);
    if (!match) continue;
    const cls = match[1]!;
    const name = match[2]!;
    const params = match[3] ?? "";
    if (cls.toLowerCase() === "circuit") {
      circuitName = name;
    }
    elements.push({ cls, name, params });
    for (const busMatch of params.matchAll(/\bbus[12]?\s*=\s*([^\s,\]]+)/gi)) {
      const b = busMatch[1]?.split(".")[0];
      if (b) buses.add(b);
    }
  }

  return { circuitName, elements, buses };
}

type DssTab = "all" | "lines" | "loads";

export const OpenDssPanel: React.FC<LanguagePanelProps> = ({ code, colorMode, mode, isFullScreen }) => {
  const [tab, setTab] = useState<DssTab>("all");

  const parsed = useMemo(() => parseDssElements(code || ""), [code]);
  const lines = useMemo(() => parsed.elements.filter((e) => e.cls.toLowerCase() === "line"), [parsed]);
  const loads = useMemo(
    () => parsed.elements.filter((e) => ["load", "pvsystem", "generator", "storage"].includes(e.cls.toLowerCase())),
    [parsed],
  );

  const visible = tab === "lines" ? lines : tab === "loads" ? loads : parsed.elements;

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={`OpenDSS: ${parsed.circuitName}`}
        subtitle={`${parsed.buses.size} buses · ${lines.length} lines · ${loads.length} loads/DERs`}
      />
      <PanelKpiStrip
        items={[
          { label: "Buses", value: parsed.buses.size },
          { label: "Lines", value: lines.length },
          { label: "Loads / DER", value: loads.length },
          { label: "Total Elements", value: parsed.elements.length },
        ]}
      />
      <PanelTabBar
        activeTab={tab}
        onSelect={(id) => setTab(id as DssTab)}
        tabs={[
          { id: "all", label: `All (${parsed.elements.length})` },
          { id: "lines", label: `Lines (${lines.length})` },
          { id: "loads", label: `Loads & DER (${loads.length})` },
        ]}
      />
      <div style={{ overflow: "auto", flex: 1, fontSize: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border-default, #30363d)" }}>
              <th style={{ padding: "6px 8px" }}>Class</th>
              <th style={{ padding: "6px 8px" }}>Name</th>
              <th style={{ padding: "6px 8px" }}>Parameters</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((el, idx) => (
              <tr
                key={`${el.cls}.${el.name}-${idx}`}
                style={{ borderBottom: "1px solid var(--ms-border-subtle, rgba(128,128,128,0.15))" }}
              >
                <td style={{ padding: "5px 8px", fontWeight: 600 }}>{el.cls}</td>
                <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>{el.name}</td>
                <td style={{ padding: "5px 8px", fontFamily: "monospace", opacity: 0.8 }}>{el.params || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PanelShell>
  );
};

export default OpenDssPanel;
