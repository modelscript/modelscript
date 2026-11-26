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
import { renderEpanetPlanSvg, type EpanetModelLike } from "@modelscript/diagram/epanet-diagram-builder";
import React, { useMemo, useState } from "react";
import { parseInp } from "../parser/inp-parser.js";

type EpanetTabId = "plan" | "junctions" | "pipes";

export const EpanetPanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<EpanetTabId>("plan");
  const [canvasThemeOverride, setCanvasThemeOverride] = useState<"light" | "dark" | null>(null);
  const canvasTheme = canvasThemeOverride ?? colorMode;

  const computed = useMemo(() => {
    if (!code.trim()) return { network: null, error: undefined as string | undefined };
    try {
      return { network: parseInp(code), error: undefined };
    } catch (err) {
      return { network: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [code]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    computed.network?.title ||
    "EPANET Water Distribution Network";

  const svg = useMemo(() => {
    if (!computed.network) return "";
    try {
      return renderEpanetPlanSvg(computed.network as unknown as EpanetModelLike, { theme: canvasTheme });
    } catch {
      return "";
    }
  }, [computed.network, canvasTheme]);

  const kpis = useMemo<PanelKpiItem[]>(() => {
    const net = computed.network;
    return [
      { label: "Junctions", value: net?.junctions?.length ?? 0, tone: "info" },
      { label: "Pipes", value: net?.pipes?.length ?? 0 },
      { label: "Reservoirs", value: net?.reservoirs?.length ?? 0 },
      { label: "Tanks", value: net?.tanks?.length ?? 0 },
      { label: "Pumps", value: net?.pumps?.length ?? 0 },
    ];
  }, [computed.network]);

  const junctions = computed.network?.junctions ?? [];
  const pipes = computed.network?.pipes ?? [];

  type JunctionRow = (typeof junctions)[number];
  type PipeRow = (typeof pipes)[number];

  const junctionColumns = useMemo<PanelDataGridColumn<JunctionRow>[]>(
    () => [
      { key: "id", label: "ID", mono: true, sortValue: (j) => j.id, render: (j) => <strong>{j.id}</strong> },
      {
        key: "elevation",
        label: "Elevation",
        align: "right",
        mono: true,
        sortValue: (j) => j.elevation,
        render: (j) => j.elevation,
      },
      {
        key: "demand",
        label: "Demand",
        align: "right",
        mono: true,
        sortValue: (j) => j.demand ?? 0,
        render: (j) => j.demand ?? 0,
      },
    ],
    [],
  );

  const pipeColumns = useMemo<PanelDataGridColumn<PipeRow>[]>(
    () => [
      { key: "id", label: "ID", mono: true, sortValue: (p) => p.id, render: (p) => <strong>{p.id}</strong> },
      {
        key: "nodes",
        label: "Node 1 → Node 2",
        mono: true,
        sortValue: (p) => `${p.node1}->${p.node2}`,
        render: (p) => `${p.node1} → ${p.node2}`,
      },
      {
        key: "length",
        label: "Length",
        align: "right",
        mono: true,
        sortValue: (p) => p.length,
        render: (p) => p.length,
      },
      {
        key: "diameter",
        label: "Diameter",
        align: "right",
        mono: true,
        sortValue: (p) => p.diameter,
        render: (p) => p.diameter,
      },
    ],
    [],
  );

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="EPANET Pressurized Pipe Network"
        badge={computed.error ? { label: "Parse Error", tone: "danger" } : { label: "EPANET", tone: "info" }}
        actions={
          <>
            {activeTab === "plan" && host.exportFile && (
              <PanelButton onClick={() => host.exportFile?.("epanet-plan.svg", svg, "image/svg+xml")} disabled={!svg}>
                Export SVG
              </PanelButton>
            )}
            {mode === "artifact" && host.openInAnsatzEditor && code && (
              <PanelButton
                variant="primary"
                onClick={() => host.openInAnsatzEditor?.(code, dialect || "epanet", title)}
              >
                Open in Editor
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<EpanetTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "plan", label: "Network Plan" },
          { id: "junctions", label: "Junctions", count: junctions.length },
          { id: "pipes", label: "Pipes", count: pipes.length },
        ]}
      />

      {activeTab === "plan" && (
        <PanelSvgStage
          svg={svg}
          canvasTheme={canvasTheme}
          onToggleCanvasTheme={() =>
            setCanvasThemeOverride((prev) => ((prev ?? colorMode) === "dark" ? "light" : "dark"))
          }
          onRevealLine={host.onRevealLine}
          emptyMessage={computed.error ?? "Load an EPANET (.epanet / .net / .inp) network file."}
        />
      )}

      {activeTab === "junctions" && (
        <PanelDataGrid
          rows={junctions}
          columns={junctionColumns}
          rowKey={(j, idx) => `${j.id}-${idx}`}
          searchPlaceholder="Filter junctions by ID or elevation…"
          emptyMessage="No junctions parsed."
        />
      )}

      {activeTab === "pipes" && (
        <PanelDataGrid
          rows={pipes}
          columns={pipeColumns}
          rowKey={(p, idx) => `${p.id}-${idx}`}
          searchPlaceholder="Filter pipes by ID or connected nodes…"
          emptyMessage="No pipes parsed."
        />
      )}
    </PanelShell>
  );
};

export default EpanetPanel;
