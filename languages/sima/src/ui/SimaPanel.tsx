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
import { renderSimaCatenaryProfileSvg, renderSimaMooringSpreadSvg } from "@modelscript/diagram/sima-diagram-builder";
import React, { useMemo, useState } from "react";
import { lintSimaProject } from "../lints/index.js";
import { parseSimaFile } from "../parser/index.js";
import { solveCatenary } from "../solver/index.js";

type SimaTabId = "catenary" | "spread" | "bodies" | "lints";

export const SimaPanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<SimaTabId>("catenary");

  const computed = useMemo(() => {
    if (!code.trim()) {
      return { project: null, lints: [] as ReturnType<typeof lintSimaProject>, error: undefined as string | undefined };
    }
    try {
      const project = parseSimaFile(code);
      const lints = lintSimaProject(project);
      return { project, lints, error: undefined };
    } catch (err) {
      return { project: null, lints: [], error: err instanceof Error ? err.message : String(err) };
    }
  }, [code]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    computed.project?.title ||
    "SIMA Offshore Marine Operations";

  const svg = useMemo(() => {
    if (!computed.project) return "";
    try {
      const depth = computed.project.environment?.waterDepth ?? 150;
      const lines = computed.project.lines ?? [];
      if (activeTab === "spread") {
        return renderSimaMooringSpreadSvg({
          title,
          vesselName: computed.project.vessels?.[0]?.name ?? "Vessel",
          lines: lines.map((ln, idx) => ({
            name: ln.name || `Line ${idx + 1}`,
            azimuthDeg: (idx * 360) / Math.max(1, lines.length),
            horizontalSpanM: 400,
            tensionKN: 1200,
          })),
        } as never);
      }
      const cat = solveCatenary({
        waterDepth: depth,
        lineLength: depth * 3,
        submergedWeight: 1500,
        horizontalSpan: depth * 2.5,
        axialStiffnessEA: 5e8,
      });
      return renderSimaCatenaryProfileSvg({
        title,
        waterDepth: depth,
        points: cat.profile,
        topTensionKN: (cat.fairleadTotalTension ?? 0) / 1000,
        groundedLengthM: cat.groundedLength,
      } as never);
    } catch {
      return "";
    }
  }, [computed.project, activeTab, title]);

  const kpis = useMemo<PanelKpiItem[]>(() => {
    const bodies = computed.project?.vessels?.length ?? 0;
    const lines = computed.project?.lines?.length ?? 0;
    const depth = computed.project?.environment?.waterDepth;
    return [
      { label: "Vessels", value: bodies, tone: "info" },
      { label: "Mooring Lines", value: lines },
      { label: "Water Depth", value: depth !== undefined ? depth : "—", unit: depth !== undefined ? "m" : undefined },
      { label: "Diagnostics", value: computed.lints.length, tone: computed.lints.length > 0 ? "warning" : "success" },
    ];
  }, [computed.project, computed.lints]);

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="SIMA Offshore Hydrodynamics"
        badge={computed.error ? { label: "Parse Error", tone: "danger" } : { label: "SIMA", tone: "info" }}
        actions={
          <>
            {(activeTab === "catenary" || activeTab === "spread") && host.exportFile && (
              <PanelButton
                onClick={() => host.exportFile?.(`sima-${activeTab}.svg`, svg, "image/svg+xml")}
                disabled={!svg}
              >
                Export SVG
              </PanelButton>
            )}
            {mode === "artifact" && host.openInAnsatzEditor && code && (
              <PanelButton variant="primary" onClick={() => host.openInAnsatzEditor?.(code, dialect || "sima", title)}>
                Open in Ansatz Editor
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<SimaTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "catenary", label: "Catenary Profile" },
          { id: "spread", label: "Mooring Spread" },
          { id: "bodies", label: "Vessels", count: computed.project?.vessels?.length ?? 0 },
          { id: "lints", label: "Lints", count: computed.lints.length },
        ]}
      />

      {(activeTab === "catenary" || activeTab === "spread") && (
        <PanelSvgStage
          svg={svg}
          onRevealLine={host.onRevealLine}
          emptyMessage={
            computed.error ?? "Load a SIMA (.sima / .stask) offshore model to inspect mooring & hydrodynamics."
          }
        />
      )}

      {activeTab === "bodies" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          {(computed.project?.vessels ?? []).map((b, idx) => (
            <div
              key={`${b.name}-${idx}`}
              style={{
                padding: "7px 10px",
                marginBottom: "6px",
                borderRadius: "6px",
                background: "var(--ms-bg-alt)",
                border: "1px solid var(--ms-border)",
              }}
            >
              <div style={{ fontWeight: 600 }}>{b.name}</div>
              <div style={{ color: "var(--ms-text-2)", fontFamily: "var(--ms-font-mono)", fontSize: "11px" }}>
                Mass: {b.mass ?? "—"} kg
              </div>
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
            <div style={{ color: "var(--ms-text-2)" }}>No SIMA lint diagnostics.</div>
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

export default SimaPanel;
