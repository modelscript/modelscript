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
import { renderEasy5SchematicSvg } from "../diagram/easy5-diagram.js";
import { lintEasy5 } from "../lints/index.js";
import { parseEasy5 } from "../parser/easy5-parser.js";

type Easy5TabId = "schematic" | "components" | "connections" | "lints";

export const Easy5Panel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<Easy5TabId>("schematic");

  const computed = useMemo(() => {
    if (!code.trim()) {
      return { model: null, lints: [] as ReturnType<typeof lintEasy5>, error: undefined as string | undefined };
    }
    try {
      const model = parseEasy5(code);
      const lints = lintEasy5(model);
      return { model, lints, error: undefined };
    } catch (err) {
      return { model: null, lints: [], error: err instanceof Error ? err.message : String(err) };
    }
  }, [code]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    computed.model?.title ||
    "EASY5 Dynamic Control Model";

  const svg = useMemo(() => {
    if (!computed.model) return "";
    try {
      return renderEasy5SchematicSvg(computed.model);
    } catch {
      return "";
    }
  }, [computed.model]);

  const kpis = useMemo<PanelKpiItem[]>(() => {
    const comps = computed.model?.components?.size ?? 0;
    const conns = computed.model?.connections?.length ?? 0;
    const diagCount = computed.lints.length;
    return [
      { label: "Components", value: comps, tone: "info" },
      { label: "Connections", value: conns },
      { label: "Diagnostics", value: diagCount, tone: diagCount > 0 ? "warning" : "success" },
    ];
  }, [computed.model, computed.lints]);

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="EASY5 Schematic & Control"
        badge={computed.error ? { label: "Parse Error", tone: "danger" } : { label: "EASY5", tone: "info" }}
        actions={
          <>
            {activeTab === "schematic" && host.exportFile && (
              <PanelButton
                onClick={() => host.exportFile?.("easy5-schematic.svg", svg, "image/svg+xml")}
                disabled={!svg}
              >
                Export SVG
              </PanelButton>
            )}
            {mode === "artifact" && host.openInAnsatzEditor && code && (
              <PanelButton variant="primary" onClick={() => host.openInAnsatzEditor?.(code, dialect || "easy5", title)}>
                Open in Ansatz Editor
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<Easy5TabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "schematic", label: "Schematic" },
          { id: "components", label: "Components", count: computed.model?.components?.size ?? 0 },
          { id: "connections", label: "Connections", count: computed.model?.connections?.length ?? 0 },
          { id: "lints", label: "Lints", count: computed.lints.length },
        ]}
      />

      {activeTab === "schematic" && (
        <PanelSvgStage
          svg={svg}
          onRevealLine={host.onRevealLine}
          emptyMessage={computed.error ?? "Load an EASY5 (.ez5 / .ezm) model to view its block schematic."}
        />
      )}

      {activeTab === "components" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>Instance</th>
                <th style={{ padding: "5px 6px" }}>Type</th>
                <th style={{ padding: "5px 6px" }}>Library</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(computed.model?.components?.values() ?? []).map((c, idx) => (
                <tr
                  key={`${c.id}-${idx}`}
                  style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                >
                  <td style={{ padding: "4px 6px", fontWeight: 600 }}>{c.id}</td>
                  <td style={{ padding: "4px 6px" }}>{c.type}</td>
                  <td style={{ padding: "4px 6px", color: "var(--ms-text-2)" }}>{c.title ?? "gp"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "connections" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>From</th>
                <th style={{ padding: "5px 6px" }}>To</th>
              </tr>
            </thead>
            <tbody>
              {(computed.model?.connections ?? []).map((cn, idx) => (
                <tr
                  key={idx}
                  style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                >
                  <td style={{ padding: "4px 6px" }}>
                    {cn.fromComponent}.{cn.fromPort}
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    {cn.toComponent}.{cn.toPort}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
            <div style={{ color: "var(--ms-text-2)" }}>No EASY5 lint diagnostics.</div>
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

export default Easy5Panel;
