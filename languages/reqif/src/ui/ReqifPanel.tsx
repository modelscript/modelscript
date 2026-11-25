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
import { parseReqIf } from "../parser/reqif-parser.js";

type ReqifTabId = "requirements" | "relations" | "types";

export const ReqifPanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<ReqifTabId>("requirements");
  const [search, setSearch] = useState("");

  const computed = useMemo(() => {
    if (!code.trim()) return { doc: null, error: undefined as string | undefined };
    try {
      return { doc: parseReqIf(code), error: undefined };
    } catch (err) {
      return { doc: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [code]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    computed.doc?.header?.title ||
    "ReqIF Requirements Specification";

  const specObjects = useMemo(() => Array.from(computed.doc?.specObjects?.values() ?? []), [computed.doc]);
  const specRelations = computed.doc?.specRelations ?? [];
  const specTypes = useMemo(() => Array.from(computed.doc?.specTypes?.values() ?? []), [computed.doc]);

  const filteredObjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return specObjects.slice(0, 250);
    return specObjects
      .filter(
        (obj) =>
          obj.identifier.toLowerCase().includes(q) ||
          (obj.longName ?? "").toLowerCase().includes(q) ||
          (obj.text ?? "").toLowerCase().includes(q),
      )
      .slice(0, 250);
  }, [specObjects, search]);

  const kpis = useMemo<PanelKpiItem[]>(
    () => [
      { label: "Requirements", value: specObjects.length, tone: "info" },
      { label: "Relations", value: specRelations.length },
      { label: "Spec Types", value: specTypes.length },
    ],
    [specObjects.length, specRelations.length, specTypes.length],
  );

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="OMG ReqIF 1.2 Requirements"
        badge={computed.error ? { label: "Parse Error", tone: "danger" } : { label: "ReqIF", tone: "info" }}
        actions={
          mode === "artifact" && host.openInAnsatzEditor && code ? (
            <PanelButton variant="primary" onClick={() => host.openInAnsatzEditor?.(code, dialect || "reqif", title)}>
              Open in Ansatz Editor
            </PanelButton>
          ) : undefined
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<ReqifTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "requirements", label: "Requirements", count: specObjects.length },
          { id: "relations", label: "Trace Relations", count: specRelations.length },
          { id: "types", label: "Spec Types", count: specTypes.length },
        ]}
      />

      {activeTab === "requirements" && (
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
            placeholder="Filter ReqIF spec objects..."
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
                <th style={{ padding: "5px 6px" }}>Identifier</th>
                <th style={{ padding: "5px 6px" }}>Name</th>
                <th style={{ padding: "5px 6px" }}>Specification Text</th>
              </tr>
            </thead>
            <tbody>
              {filteredObjects.map((obj, idx) => (
                <tr key={`${obj.identifier}-${idx}`} style={{ borderBottom: "1px solid var(--ms-divider)" }}>
                  <td style={{ padding: "5px 6px", fontFamily: "var(--ms-font-mono)", fontWeight: 600 }}>
                    {obj.identifier}
                  </td>
                  <td style={{ padding: "5px 6px" }}>{obj.longName ?? "—"}</td>
                  <td style={{ padding: "5px 6px", color: "var(--ms-text-2)" }}>{obj.text || "—"}</td>
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
          {specRelations.map((rel, idx) => (
            <div
              key={`${rel.identifier}-${idx}`}
              style={{
                padding: "7px 10px",
                borderRadius: "6px",
                background: "var(--ms-bg-alt)",
                border: "1px solid var(--ms-border)",
                fontFamily: "var(--ms-font-mono)",
              }}
            >
              {rel.sourceId} → {rel.targetId}
            </div>
          ))}
        </div>
      )}

      {activeTab === "types" && (
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
          {specTypes.map((st, idx) => (
            <div
              key={`${st.identifier}-${idx}`}
              style={{
                padding: "7px 10px",
                borderRadius: "6px",
                background: "var(--ms-bg-alt)",
                border: "1px solid var(--ms-border)",
              }}
            >
              <strong>{st.longName ?? st.identifier}</strong>
            </div>
          ))}
        </div>
      )}
    </PanelShell>
  );
};

export default ReqifPanel;
