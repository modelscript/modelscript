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

  type PartRow = (typeof parts)[number];
  const partColumns = useMemo<PanelDataGridColumn<PartRow>[]>(
    () => [
      {
        key: "id",
        label: "Entity ID",
        mono: true,
        sortValue: (p) => String(p.id),
        render: (p) => <span style={{ color: "var(--ms-brand)" }}>{p.id}</span>,
      },
      { key: "name", label: "Product Name", sortValue: (p) => p.name, render: (p) => <strong>{p.name}</strong> },
      {
        key: "shapeId",
        label: "Shape Ref",
        mono: true,
        sortValue: (p) => p.shapeId ?? "",
        render: (p) => <span style={{ color: "var(--ms-text-2)" }}>{p.shapeId || "—"}</span>,
      },
    ],
    [],
  );

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
          mode === "artifact" && host.openInAnsatzEditor && code ? (
            <PanelButton variant="primary" onClick={() => host.openInAnsatzEditor?.(code, dialect || "step", title)}>
              Open in Editor
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
        <PanelDataGrid
          rows={parts}
          columns={partColumns}
          rowKey={(p, idx) => `${p.id}-${idx}`}
          searchPlaceholder="Filter STEP products / parts…"
          emptyMessage={computed.error ?? "No STEP product parts parsed."}
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
