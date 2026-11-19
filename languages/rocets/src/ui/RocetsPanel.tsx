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
import { renderRocetsPidSvg } from "../diagram/index.js";
import { lintRocets } from "../lints/index.js";
import { parseRocetsDeck } from "../parser/deck-parser.js";

type RocetsTabId = "pid" | "modules" | "streams" | "lints";

export const RocetsPanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<RocetsTabId>("pid");

  const computed = useMemo(() => {
    if (!code.trim()) {
      return { model: null, lints: [] as ReturnType<typeof lintRocets>, error: undefined as string | undefined };
    }
    try {
      const model = parseRocetsDeck(code);
      const lints = lintRocets(model);
      return { model, lints, error: undefined };
    } catch (err) {
      return { model: null, lints: [], error: err instanceof Error ? err.message : String(err) };
    }
  }, [code]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    computed.model?.title ||
    "ROCETS Propulsion Cycle";

  const svg = useMemo(() => {
    if (!computed.model) return "";
    try {
      return renderRocetsPidSvg(computed.model);
    } catch {
      return "";
    }
  }, [computed.model]);

  const kpis = useMemo<PanelKpiItem[]>(() => {
    const mods = computed.model?.components?.size ?? 0;
    const streams = computed.model?.connections?.length ?? 0;
    const diagCount = computed.lints.length;
    return [
      { label: "Modules", value: mods, tone: "info" },
      { label: "Fluid Streams", value: streams },
      { label: "Diagnostics", value: diagCount, tone: diagCount > 0 ? "warning" : "success" },
    ];
  }, [computed.model, computed.lints]);

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="NASA ROCETS Propulsion"
        badge={computed.error ? { label: "Parse Error", tone: "danger" } : { label: "ROCETS", tone: "info" }}
        actions={
          <>
            {activeTab === "pid" && host.exportFile && (
              <PanelButton onClick={() => host.exportFile?.("rocets-pid.svg", svg, "image/svg+xml")} disabled={!svg}>
                Export SVG
              </PanelButton>
            )}
            {mode === "artifact" && host.openInMorsel && code && (
              <PanelButton variant="primary" onClick={() => host.openInMorsel?.(code, dialect || "rocets", title)}>
                Open in Morsel
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<RocetsTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "pid", label: "Propulsion P&ID" },
          { id: "modules", label: "Modules", count: computed.model?.components?.size ?? 0 },
          { id: "streams", label: "Streams", count: computed.model?.connections?.length ?? 0 },
          { id: "lints", label: "Lints", count: computed.lints.length },
        ]}
      />

      {activeTab === "pid" && (
        <PanelSvgStage
          svg={svg}
          onRevealLine={host.onRevealLine}
          emptyMessage={computed.error ?? "Load a ROCETS (.roc / .deck) propulsion deck to render the P&ID."}
        />
      )}

      {activeTab === "modules" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>Module</th>
                <th style={{ padding: "5px 6px" }}>Type</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(computed.model?.components?.values() ?? []).map((m, idx) => (
                <tr
                  key={`${m.id}-${idx}`}
                  style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                >
                  <td style={{ padding: "4px 6px", fontWeight: 600 }}>{m.id}</td>
                  <td style={{ padding: "4px 6px" }}>{m.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "streams" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>From</th>
                <th style={{ padding: "5px 6px" }}>To</th>
                <th style={{ padding: "5px 6px" }}>Fluid</th>
              </tr>
            </thead>
            <tbody>
              {(computed.model?.connections ?? []).map((s, idx) => (
                <tr
                  key={idx}
                  style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                >
                  <td style={{ padding: "4px 6px" }}>{s.fromComponent}</td>
                  <td style={{ padding: "4px 6px" }}>{s.toComponent}</td>
                  <td style={{ padding: "4px 6px", color: "var(--ms-text-2)" }}>{s.fluid ?? "—"}</td>
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
            <div style={{ color: "var(--ms-text-2)" }}>No ROCETS lint diagnostics.</div>
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

export default RocetsPanel;
