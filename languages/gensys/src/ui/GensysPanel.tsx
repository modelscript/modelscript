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
import { renderGensysSvg } from "../diagram/gensys-diagram.js";
import { parseGensysDeck } from "../parser/deck-parser.js";

type GensysTabId = "vehicle" | "masses" | "couplings";

export const GensysPanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<GensysTabId>("vehicle");

  const computed = useMemo(() => {
    if (!code.trim()) return { model: null, error: undefined as string | undefined };
    try {
      return { model: parseGensysDeck(code), error: undefined };
    } catch (err) {
      return { model: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [code]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    computed.model?.name ||
    "GENSYS Railway Vehicle Dynamics";

  const svg = useMemo(() => {
    if (!computed.model) return "";
    try {
      return renderGensysSvg(computed.model);
    } catch {
      return "";
    }
  }, [computed.model]);

  const masses = useMemo(() => Array.from(computed.model?.bodies?.values() ?? []), [computed.model]);
  const couplings = useMemo(() => Array.from(computed.model?.couplings?.values() ?? []), [computed.model]);

  const kpis = useMemo<PanelKpiItem[]>(
    () => [
      { label: "Masses", value: masses.length, tone: "info" },
      { label: "Couplings", value: couplings.length },
      { label: "Wheelsets", value: computed.model?.wheelsets?.size ?? 0, tone: "success" },
    ],
    [masses.length, couplings.length, computed.model],
  );

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="GENSYS Rail Multibody"
        badge={computed.error ? { label: "Parse Error", tone: "danger" } : { label: "GENSYS", tone: "info" }}
        actions={
          <>
            {activeTab === "vehicle" && host.exportFile && (
              <PanelButton
                onClick={() => host.exportFile?.("gensys-vehicle.svg", svg, "image/svg+xml")}
                disabled={!svg}
              >
                Export SVG
              </PanelButton>
            )}
            {mode === "artifact" && host.openInAnsatzEditor && code && (
              <PanelButton
                variant="primary"
                onClick={() => host.openInAnsatzEditor?.(code, dialect || "gensys", title)}
              >
                Open in Ansatz Editor
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<GensysTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "vehicle", label: "Vehicle Diagram" },
          { id: "masses", label: "Masses", count: masses.length },
          { id: "couplings", label: "Couplings", count: couplings.length },
        ]}
      />

      {activeTab === "vehicle" && (
        <PanelSvgStage
          svg={svg}
          onRevealLine={host.onRevealLine}
          emptyMessage={computed.error ?? "Load a GENSYS (.calc / .run / .sub) rail vehicle deck."}
        />
      )}

      {activeTab === "masses" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>Mass</th>
                <th style={{ padding: "5px 6px" }}>m (kg)</th>
              </tr>
            </thead>
            <tbody>
              {masses.map((m, idx) => (
                <tr
                  key={`${m.name}-${idx}`}
                  style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                >
                  <td style={{ padding: "4px 6px", fontWeight: 600 }}>{m.name}</td>
                  <td style={{ padding: "4px 6px" }}>{m.mass ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "couplings" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          {couplings.map((c, idx) => (
            <div
              key={`${c.name}-${idx}`}
              style={{
                padding: "6px 10px",
                marginBottom: "5px",
                borderRadius: "6px",
                background: "var(--ms-bg-alt)",
                border: "1px solid var(--ms-border)",
                fontFamily: "var(--ms-font-mono)",
              }}
            >
              <strong>{c.name}</strong> ({c.type})
            </div>
          ))}
        </div>
      )}
    </PanelShell>
  );
};

export default GensysPanel;
