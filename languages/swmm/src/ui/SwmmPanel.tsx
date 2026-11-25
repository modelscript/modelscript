// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  PanelButton,
  PanelKpiStrip,
  PanelShell,
  PanelSvgStage,
  PanelTabBar,
  PanelToolbar,
  type LanguagePanelProps,
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

  const kpis = useMemo<PanelKpiItem[]>(() => {
    const d = computed.deck;
    return [
      { label: "Subcatchments", value: d?.subcatchments?.size ?? 0, tone: "info" },
      { label: "Junctions", value: d?.junctions?.size ?? 0 },
      { label: "Conduits", value: d?.conduits?.size ?? 0 },
      { label: "Outfalls", value: d?.outfalls?.size ?? 0 },
    ];
  }, [computed.deck]);

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
                Open in Ansatz Editor
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
          { id: "subcatchments", label: "Subcatchments", count: computed.deck?.subcatchments?.size ?? 0 },
          { id: "conduits", label: "Conduits", count: computed.deck?.conduits?.size ?? 0 },
        ]}
      />

      {activeTab === "network" && (
        <PanelSvgStage
          svg={svg}
          onRevealLine={host.onRevealLine}
          emptyMessage={computed.error ?? "Load an EPA SWMM (.swmm / .inp) model to visualize the drainage network."}
        />
      )}

      {activeTab === "subcatchments" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>Name</th>
                <th style={{ padding: "5px 6px" }}>Outlet</th>
                <th style={{ padding: "5px 6px" }}>Area</th>
                <th style={{ padding: "5px 6px" }}>% Imperv</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(computed.deck?.subcatchments?.values() ?? [])
                .slice(0, 200)
                .map((s, idx) => (
                  <tr
                    key={`${s.id}-${idx}`}
                    style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                  >
                    <td style={{ padding: "4px 6px", fontWeight: 600 }}>{s.id}</td>
                    <td style={{ padding: "4px 6px" }}>{s.outlet}</td>
                    <td style={{ padding: "4px 6px" }}>{s.area}</td>
                    <td style={{ padding: "4px 6px" }}>{s.impervPct}%</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "conduits" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>Name</th>
                <th style={{ padding: "5px 6px" }}>Inlet → Outlet</th>
                <th style={{ padding: "5px 6px" }}>Length</th>
                <th style={{ padding: "5px 6px" }}>Roughness</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(computed.deck?.conduits?.values() ?? [])
                .slice(0, 200)
                .map((c, idx) => (
                  <tr
                    key={`${c.id}-${idx}`}
                    style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                  >
                    <td style={{ padding: "4px 6px", fontWeight: 600 }}>{c.id}</td>
                    <td style={{ padding: "4px 6px" }}>
                      {c.inletNode} → {c.outletNode}
                    </td>
                    <td style={{ padding: "4px 6px" }}>{c.length}</td>
                    <td style={{ padding: "4px 6px" }}>{c.roughness}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </PanelShell>
  );
};

export default SwmmPanel;
