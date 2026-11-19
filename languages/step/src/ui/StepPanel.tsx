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
import { extractStepAssembly } from "../assembly-extractor.js";

type StepTabId = "assembly" | "parts" | "relations";

export const StepPanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<StepTabId>("assembly");
  const [search, setSearch] = useState("");

  const computed = useMemo(() => {
    if (!code.trim()) return { assembly: null, error: undefined as string | undefined };
    try {
      return { assembly: extractStepAssembly(code), error: undefined };
    } catch (err) {
      return { assembly: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [code]);

  const title = (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) || "ISO 10303 STEP AP242 Assembly";

  const parts = useMemo(() => Array.from(computed.assembly?.parts?.values() ?? []), [computed.assembly]);
  const relations = computed.assembly?.edges ?? [];

  const filteredParts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return parts.slice(0, 250);
    return parts.filter((p) => p.name.toLowerCase().includes(q) || String(p.id).includes(q)).slice(0, 250);
  }, [parts, search]);

  const kpis = useMemo<PanelKpiItem[]>(
    () => [
      { label: "Parts", value: parts.length, tone: "info" },
      { label: "Assembly Links", value: relations.length },
      { label: "Joints", value: computed.assembly?.joints?.length ?? 0 },
    ],
    [parts.length, relations.length, computed.assembly],
  );

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="ISO 10303-21 STEP CAD"
        badge={computed.error ? { label: "Parse Error", tone: "danger" } : { label: "STEP", tone: "info" }}
        actions={
          mode === "artifact" && host.openInMorsel && code ? (
            <PanelButton variant="primary" onClick={() => host.openInMorsel?.(code, dialect || "step", title)}>
              Open in Morsel
            </PanelButton>
          ) : undefined
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<StepTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "assembly", label: "Assembly BOM", count: parts.length },
          { id: "parts", label: "Part Entities", count: parts.length },
          { id: "relations", label: "NAUO Relations", count: relations.length },
        ]}
      />

      {(activeTab === "assembly" || activeTab === "parts") && (
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
            placeholder="Filter STEP products / parts..."
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
                <th style={{ padding: "5px 6px" }}>Entity ID</th>
                <th style={{ padding: "5px 6px" }}>Product Name</th>
                <th style={{ padding: "5px 6px" }}>Shape Ref</th>
              </tr>
            </thead>
            <tbody>
              {filteredParts.map((p, idx) => (
                <tr
                  key={`${p.id}-${idx}`}
                  style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                >
                  <td style={{ padding: "4px 6px", color: "var(--ms-brand)" }}>{p.id}</td>
                  <td style={{ padding: "4px 6px", fontWeight: 600, fontFamily: "var(--ms-font-sans)" }}>{p.name}</td>
                  <td style={{ padding: "4px 6px", color: "var(--ms-text-2)" }}>{p.shapeId || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "relations" && (
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
          {relations.map((rel, idx) => (
            <div
              key={idx}
              style={{
                padding: "7px 10px",
                borderRadius: "6px",
                background: "var(--ms-bg-alt)",
                border: "1px solid var(--ms-border)",
                fontFamily: "var(--ms-font-mono)",
              }}
            >
              {rel.parentPartId} → {rel.childPartId}
            </div>
          ))}
        </div>
      )}
    </PanelShell>
  );
};

export default StepPanel;
