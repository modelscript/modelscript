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
            {mode === "artifact" && host.openInMorsel && code && (
              <PanelButton variant="primary" onClick={() => host.openInMorsel?.(code, dialect || "qif", title)}>
                Open in Morsel
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
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>ID</th>
                <th style={{ padding: "5px 6px" }}>Name</th>
                <th style={{ padding: "5px 6px" }}>Nominal</th>
                <th style={{ padding: "5px 6px" }}>Measured</th>
                <th style={{ padding: "5px 6px" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {chars.slice(0, 200).map((c, idx) => {
                const actual = actualsByCharId.get(c.id);
                return (
                  <tr
                    key={`${c.id}-${idx}`}
                    style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                  >
                    <td style={{ padding: "4px 6px", fontWeight: 600 }}>{c.id}</td>
                    <td style={{ padding: "4px 6px", fontFamily: "var(--ms-font-sans)" }}>{c.name}</td>
                    <td style={{ padding: "4px 6px" }}>{c.nominalValue ?? "—"}</td>
                    <td style={{ padding: "4px 6px" }}>{actual?.measuredValue ?? "—"}</td>
                    <td
                      style={{
                        padding: "4px 6px",
                        fontWeight: 600,
                        color:
                          actual?.status === "FAIL"
                            ? "var(--ms-danger)"
                            : actual?.status === "PASS"
                              ? "var(--ms-success)"
                              : "var(--ms-text-2)",
                      }}
                    >
                      {actual?.status ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </PanelShell>
  );
};

export default QifPanel;
