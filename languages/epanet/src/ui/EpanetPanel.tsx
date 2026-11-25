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
      return renderEpanetPlanSvg(computed.network as unknown as EpanetModelLike);
    } catch {
      return "";
    }
  }, [computed.network]);

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
                Open in Ansatz Editor
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
          { id: "junctions", label: "Junctions", count: computed.network?.junctions?.length ?? 0 },
          { id: "pipes", label: "Pipes", count: computed.network?.pipes?.length ?? 0 },
        ]}
      />

      {activeTab === "plan" && (
        <PanelSvgStage
          svg={svg}
          onRevealLine={host.onRevealLine}
          emptyMessage={computed.error ?? "Load an EPANET (.epanet / .net / .inp) network file."}
        />
      )}

      {activeTab === "junctions" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>ID</th>
                <th style={{ padding: "5px 6px" }}>Elevation</th>
                <th style={{ padding: "5px 6px" }}>Demand</th>
              </tr>
            </thead>
            <tbody>
              {(computed.network?.junctions ?? []).slice(0, 200).map((j, idx) => (
                <tr
                  key={`${j.id}-${idx}`}
                  style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                >
                  <td style={{ padding: "4px 6px", fontWeight: 600 }}>{j.id}</td>
                  <td style={{ padding: "4px 6px" }}>{j.elevation}</td>
                  <td style={{ padding: "4px 6px" }}>{j.demand ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "pipes" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>ID</th>
                <th style={{ padding: "5px 6px" }}>Node 1 → Node 2</th>
                <th style={{ padding: "5px 6px" }}>Length</th>
                <th style={{ padding: "5px 6px" }}>Diameter</th>
              </tr>
            </thead>
            <tbody>
              {(computed.network?.pipes ?? []).slice(0, 200).map((p, idx) => (
                <tr
                  key={`${p.id}-${idx}`}
                  style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                >
                  <td style={{ padding: "4px 6px", fontWeight: 600 }}>{p.id}</td>
                  <td style={{ padding: "4px 6px" }}>
                    {p.node1} → {p.node2}
                  </td>
                  <td style={{ padding: "4px 6px" }}>{p.length}</td>
                  <td style={{ padding: "4px 6px" }}>{p.diameter}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PanelShell>
  );
};

export default EpanetPanel;
