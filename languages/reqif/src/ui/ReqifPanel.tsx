// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  PanelButton,
  PanelDataGrid,
  PanelKpiStrip,
  PanelShell,
  PanelTabBar,
  PanelToolbar,
  type LanguagePanelProps,
  type PanelDataGridColumn,
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

  type SpecObjRow = (typeof specObjects)[number];
  const reqColumns = useMemo<PanelDataGridColumn<SpecObjRow>[]>(
    () => [
      {
        key: "identifier",
        label: "Identifier",
        mono: true,
        sortValue: (o) => o.identifier,
        render: (o) => <strong>{o.identifier}</strong>,
      },
      {
        key: "longName",
        label: "Name",
        sortValue: (o) => o.longName ?? "",
        render: (o) => o.longName ?? "—",
      },
      {
        key: "text",
        label: "Specification Text",
        sortValue: (o) => o.text ?? "",
        render: (o) => <span style={{ color: "var(--ms-text-2)" }}>{o.text || "—"}</span>,
      },
    ],
    [],
  );

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
              Open in Editor
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
        <PanelDataGrid
          rows={specObjects}
          columns={reqColumns}
          rowKey={(o, idx) => `${o.identifier}-${idx}`}
          searchPlaceholder="Filter ReqIF spec objects…"
          emptyMessage={computed.error ?? "No ReqIF requirements parsed."}
        />
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
