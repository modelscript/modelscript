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
import { renderSwmmSvg, type SwmmModelLike } from "@modelscript/diagram/swmm-diagram-builder";
import React, { useMemo, useState } from "react";
import { parseSwmm } from "../parser/swmm-parser.js";

type SwmmTabId = "network" | "subcatchments" | "conduits";

export const SwmmPanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<SwmmTabId>("network");
  const [canvasThemeOverride, setCanvasThemeOverride] = useState<"light" | "dark" | null>(null);
  const canvasTheme = canvasThemeOverride ?? colorMode;

  const computed = useMemo(() => {
    if (!code.trim()) return { deck: null, error: undefined as string | undefined };
    try {
      return { deck: parseSwmm(code), error: undefined };
    } catch (err) {
      return { deck: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [code]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    computed.deck?.title ||
    "SWMM Urban Stormwater Drainage";

  const svg = useMemo(() => {
    if (!computed.deck) return "";
    try {
      return renderSwmmSvg(computed.deck as unknown as SwmmModelLike);
    } catch {
      return "";
    }
  }, [computed.deck]);

  const subcatchments = useMemo(() => Array.from(computed.deck?.subcatchments?.values() ?? []), [computed.deck]);
  const conduits = useMemo(() => Array.from(computed.deck?.conduits?.values() ?? []), [computed.deck]);

  type SubRow = (typeof subcatchments)[number];
  type ConduitRow = (typeof conduits)[number];

  const subColumns = useMemo<PanelDataGridColumn<SubRow>[]>(
    () => [
      { key: "id", label: "Name", mono: true, sortValue: (s) => s.id, render: (s) => <strong>{s.id}</strong> },
      { key: "outlet", label: "Outlet", mono: true, sortValue: (s) => s.outlet, render: (s) => s.outlet },
      { key: "area", label: "Area", align: "right", mono: true, sortValue: (s) => s.area, render: (s) => s.area },
      {
        key: "impervPct",
        label: "% Imperv",
        align: "right",
        mono: true,
        sortValue: (s) => s.impervPct,
        render: (s) => `${s.impervPct}%`,
      },
    ],
    [],
  );

  const conduitColumns = useMemo<PanelDataGridColumn<ConduitRow>[]>(
    () => [
      { key: "id", label: "Name", mono: true, sortValue: (c) => c.id, render: (c) => <strong>{c.id}</strong> },
      {
        key: "nodes",
        label: "Inlet → Outlet",
        mono: true,
        sortValue: (c) => `${c.inletNode}->${c.outletNode}`,
        render: (c) => `${c.inletNode} → ${c.outletNode}`,
      },
      {
        key: "length",
        label: "Length",
        align: "right",
        mono: true,
        sortValue: (c) => c.length,
        render: (c) => c.length,
      },
      {
        key: "roughness",
        label: "Roughness",
        align: "right",
        mono: true,
        sortValue: (c) => c.roughness,
        render: (c) => c.roughness,
      },
    ],
    [],
  );

  const kpis = useMemo<PanelKpiItem[]>(() => {
    const d = computed.deck;
    return [
      { label: "Subcatchments", value: subcatchments.length, tone: "info" },
      { label: "Junctions", value: d?.junctions?.size ?? 0 },
      { label: "Conduits", value: conduits.length },
      { label: "Outfalls", value: d?.outfalls?.size ?? 0 },
    ];
  }, [computed.deck, subcatchments.length, conduits.length]);

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="EPA SWMM5 Stormwater"
        badge={computed.error ? { label: "Parse Error", tone: "danger" } : { label: "SWMM", tone: "info" }}
        actions={
          <>
            {activeTab === "network" && host.exportFile && (
              <PanelButton onClick={() => host.exportFile?.("swmm-network.svg", svg, "image/svg+xml")} disabled={!svg}>
                Export SVG
              </PanelButton>
            )}
            {mode === "artifact" && host.openInAnsatzEditor && code && (
              <PanelButton variant="primary" onClick={() => host.openInAnsatzEditor?.(code, dialect || "swmm", title)}>
                Open in Editor
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<SwmmTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "network", label: "Drainage Network" },
          { id: "subcatchments", label: "Subcatchments", count: subcatchments.length },
          { id: "conduits", label: "Conduits", count: conduits.length },
        ]}
      />

      {activeTab === "network" && (
        <PanelSvgStage
          svg={svg}
          canvasTheme={canvasTheme}
          onToggleCanvasTheme={() =>
            setCanvasThemeOverride((prev) => ((prev ?? colorMode) === "dark" ? "light" : "dark"))
          }
          onRevealLine={host.onRevealLine}
          emptyMessage={computed.error ?? "Load an EPA SWMM (.swmm / .inp) model to visualize the drainage network."}
        />
      )}

      {activeTab === "subcatchments" && (
        <PanelDataGrid
          rows={subcatchments}
          columns={subColumns}
          rowKey={(s, idx) => `${s.id}-${idx}`}
          searchPlaceholder="Filter subcatchments by name or outlet…"
          emptyMessage="No subcatchments parsed."
        />
      )}

      {activeTab === "conduits" && (
        <PanelDataGrid
          rows={conduits}
          columns={conduitColumns}
          rowKey={(c, idx) => `${c.id}-${idx}`}
          searchPlaceholder="Filter conduits by name or nodes…"
          emptyMessage="No conduits parsed."
        />
      )}
    </PanelShell>
  );
};

export default SwmmPanel;
