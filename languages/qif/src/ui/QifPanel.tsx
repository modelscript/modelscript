// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  PanelButton,
  PanelDataGrid,
  PanelKpiStrip,
  PanelShell,
  PanelSvgStage,
  PanelTabBar,
  PanelToolbar,
  type LanguagePanelProps,
  type PanelDataGridColumn,
  type PanelKpiItem,
} from "@modelscript/design-tokens/panel";
import {
  renderQif3dIsometricSvg,
  renderQifMbdHeatmapSvg,
  type QifDocumentLike,
} from "@modelscript/diagram/qif-diagram-builder";
import React, { useMemo, useState } from "react";
import { parseQif } from "../parser/index.js";

type QifTabId = "heatmap" | "iso3d" | "characteristics";

export const QifPanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  documentUri,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<QifTabId>("heatmap");

  const computed = useMemo(() => {
    if (!code.trim()) return { doc: null, error: undefined as string | undefined };
    try {
      return { doc: parseQif(code, documentUri), error: undefined };
    } catch (err) {
      return { doc: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [code, documentUri]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    computed.doc?.header?.partName ||
    "QIF Quality Metrology Studio";

  const svg = useMemo(() => {
    if (!computed.doc) return "";
    try {
      const dLike = computed.doc as unknown as QifDocumentLike;
      return activeTab === "iso3d" ? renderQif3dIsometricSvg(dLike) : renderQifMbdHeatmapSvg(dLike);
    } catch {
      return "";
    }
  }, [computed.doc, activeTab]);

  const chars = computed.doc?.characteristics ?? [];
  const actualsByCharId = useMemo(() => {
    const map = new Map<
      string,
      typeof computed.doc extends null ? never : NonNullable<typeof computed.doc>["actuals"][number]
    >();
    for (const a of computed.doc?.actuals ?? []) {
      map.set(a.characteristicId, a);
    }
    return map;
  }, [computed.doc]);

  type CharRow = (typeof chars)[number];
  const charColumns = useMemo<PanelDataGridColumn<CharRow>[]>(
    () => [
      { key: "id", label: "ID", mono: true, sortValue: (c) => c.id, render: (c) => <strong>{c.id}</strong> },
      { key: "name", label: "Name", sortValue: (c) => c.name ?? "", render: (c) => c.name },
      {
        key: "nominalValue",
        label: "Nominal",
        align: "right",
        mono: true,
        sortValue: (c) => c.nominalValue ?? 0,
        render: (c) => c.nominalValue ?? "—",
      },
      {
        key: "measured",
        label: "Measured",
        align: "right",
        mono: true,
        sortValue: (c) => actualsByCharId.get(c.id)?.measuredValue ?? 0,
        render: (c) => actualsByCharId.get(c.id)?.measuredValue ?? "—",
      },
      {
        key: "status",
        label: "Status",
        sortValue: (c) => actualsByCharId.get(c.id)?.status ?? "",
        render: (c) => {
          const status = actualsByCharId.get(c.id)?.status;
          const color =
            status === "FAIL" ? "var(--ms-danger)" : status === "PASS" ? "var(--ms-success)" : "var(--ms-text-2)";
          return <span style={{ fontWeight: 600, color }}>{status ?? "—"}</span>;
        },
      },
    ],
    [actualsByCharId],
  );

  const kpis = useMemo<PanelKpiItem[]>(() => {
    const actuals = computed.doc?.actuals ?? [];
    const pass = actuals.filter((a) => a.status === "PASS").length;
    const fail = actuals.filter((a) => a.status === "FAIL").length;
    return [
      { label: "Characteristics", value: chars.length, tone: "info" },
      { label: "Pass", value: pass, tone: "success" },
      { label: "Fail", value: fail, tone: fail > 0 ? "danger" : "neutral" },
    ];
  }, [chars, computed.doc]);

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="ISO 23952 QIF Metrology"
        badge={computed.error ? { label: "Parse Error", tone: "danger" } : { label: "QIF", tone: "info" }}
        actions={
          <>
            {(activeTab === "heatmap" || activeTab === "iso3d") && host.exportFile && (
              <PanelButton
                onClick={() => host.exportFile?.(`qif-${activeTab}.svg`, svg, "image/svg+xml")}
                disabled={!svg}
              >
                Export SVG
              </PanelButton>
            )}
            {mode === "artifact" && host.openInAnsatzEditor && code && (
              <PanelButton variant="primary" onClick={() => host.openInAnsatzEditor?.(code, dialect || "qif", title)}>
                Open in Editor
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<QifTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "heatmap", label: "MBD Heatmap" },
          { id: "iso3d", label: "3D Tolerance View" },
          { id: "characteristics", label: "Characteristics", count: chars.length },
        ]}
      />

      {(activeTab === "heatmap" || activeTab === "iso3d") && (
        <PanelSvgStage
          svg={svg}
          onRevealLine={host.onRevealLine}
          emptyMessage={computed.error ?? "Load a QIF (.qif / .qif.xml) inspection document."}
        />
      )}

      {activeTab === "characteristics" && (
        <PanelDataGrid
          rows={chars}
          columns={charColumns}
          rowKey={(c, idx) => `${c.id}-${idx}`}
          searchPlaceholder="Filter QIF characteristics by ID, name, or status…"
          emptyMessage="No QIF characteristics parsed."
        />
      )}
    </PanelShell>
  );
};

export default QifPanel;
