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
import React, { useMemo, useState } from "react";
import { renderGtSuiteSchematicSvg } from "../diagram/index.js";
import { lintGtModel } from "../lints/index.js";
import { parseGtmModel } from "../parser/index.js";

type GtSuiteTabId = "schematic" | "parts" | "connections" | "lints";

export const GtSuitePanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<GtSuiteTabId>("schematic");

  const computed = useMemo(() => {
    if (!code.trim()) {
      return { model: null, lints: [] as ReturnType<typeof lintGtModel>, error: undefined as string | undefined };
    }
    try {
      const model = parseGtmModel(code);
      const lints = lintGtModel(model);
      return { model, lints, error: undefined };
    } catch (err) {
      return { model: null, lints: [], error: err instanceof Error ? err.message : String(err) };
    }
  }, [code]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    computed.model?.title ||
    "GT-SUITE Powertrain & Thermal";

  const svg = useMemo(() => {
    if (!computed.model) return "";
    try {
      return renderGtSuiteSchematicSvg(computed.model);
    } catch {
      return "";
    }
  }, [computed.model]);

  const kpis = useMemo<PanelKpiItem[]>(() => {
    const parts = computed.model?.components?.length ?? 0;
    const conns = computed.model?.connections?.length ?? 0;
    return [
      { label: "Components", value: parts, tone: "info" },
      { label: "Connections", value: conns },
      { label: "Diagnostics", value: computed.lints.length, tone: computed.lints.length > 0 ? "warning" : "success" },
    ];
  }, [computed.model, computed.lints]);

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="GT-SUITE 1D Powertrain & Thermal"
        badge={computed.error ? { label: "Parse Error", tone: "danger" } : { label: "GT-SUITE", tone: "info" }}
        actions={
          <>
            {activeTab === "schematic" && host.exportFile && (
              <PanelButton
                onClick={() => host.exportFile?.("gtsuite-schematic.svg", svg, "image/svg+xml")}
                disabled={!svg}
              >
                Export SVG
              </PanelButton>
            )}
            {mode === "artifact" && host.openInAnsatzEditor && code && (
              <PanelButton
                variant="primary"
                onClick={() => host.openInAnsatzEditor?.(code, dialect || "gtsuite", title)}
              >
                Open in Ansatz Editor
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<GtSuiteTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "schematic", label: "System Schematic" },
          { id: "parts", label: "Components", count: computed.model?.components?.length ?? 0 },
          { id: "connections", label: "Connections", count: computed.model?.connections?.length ?? 0 },
          { id: "lints", label: "Lints", count: computed.lints.length },
        ]}
      />

      {activeTab === "schematic" && (
        <PanelSvgStage
          svg={svg}
          onRevealLine={host.onRevealLine}
          emptyMessage={computed.error ?? "Load a GT-SUITE (.gtm / .gtp) model to render the schematic."}
        />
      )}

      {activeTab === "parts" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>Component</th>
                <th style={{ padding: "5px 6px" }}>Template</th>
              </tr>
            </thead>
            <tbody>
              {(computed.model?.components ?? []).map((p, idx) => (
                <tr
                  key={`${p.id}-${idx}`}
                  style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                >
                  <td style={{ padding: "4px 6px", fontWeight: 600 }}>{p.id}</td>
                  <td style={{ padding: "4px 6px" }}>{p.kind}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "connections" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          {(computed.model?.connections ?? []).map((cn, idx) => (
            <div
              key={idx}
              style={{
                padding: "6px 10px",
                marginBottom: "5px",
                borderRadius: "6px",
                background: "var(--ms-bg-alt)",
                border: "1px solid var(--ms-border)",
                fontFamily: "var(--ms-font-mono)",
              }}
            >
              {cn.fromComponent}.{cn.fromPort} → {cn.toComponent}.{cn.toPort}
            </div>
          ))}
        </div>
      )}

      {activeTab === "lints" && (
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
          {computed.lints.length === 0 ? (
            <div style={{ color: "var(--ms-text-2)" }}>No GT-SUITE lint diagnostics.</div>
          ) : (
            computed.lints.map((d, idx) => (
              <div
                key={`${d.code}-${idx}`}
                style={{
                  padding: "7px 10px",
                  borderRadius: "6px",
                  background: "var(--ms-bg-alt)",
                  border: "1px solid var(--ms-border)",
                }}
              >
                <span style={{ fontWeight: 600, fontFamily: "var(--ms-font-mono)", marginRight: "6px" }}>
                  [{d.code}]
                </span>
                <span>{d.message}</span>
              </div>
            ))
          )}
        </div>
      )}
    </PanelShell>
  );
};

export default GtSuitePanel;
