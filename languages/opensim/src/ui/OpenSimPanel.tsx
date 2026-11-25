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
  renderOpenSimForceCurveSvg,
  renderOpenSimTopologySvg,
  type OpenSimDocumentLike,
} from "@modelscript/diagram/opensim-diagram-builder";
import React, { useMemo, useState } from "react";
import { parseOpenSim } from "../parser/index.js";

type OpenSimTabId = "topology" | "muscles" | "bodies";

export const OpenSimPanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  documentUri,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<OpenSimTabId>("topology");

  const computed = useMemo(() => {
    if (!code.trim()) return { doc: null, error: undefined as string | undefined };
    try {
      return { doc: parseOpenSim(code, documentUri), error: undefined };
    } catch (err) {
      return { doc: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [code, documentUri]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    computed.doc?.modelName ||
    "OpenSim Biomechanics Studio";

  const svg = useMemo(() => {
    if (!computed.doc) return "";
    try {
      const dLike = computed.doc as unknown as OpenSimDocumentLike;
      return activeTab === "muscles" ? renderOpenSimForceCurveSvg(dLike) : renderOpenSimTopologySvg(dLike);
    } catch {
      return "";
    }
  }, [computed.doc, activeTab]);

  const kpis = useMemo<PanelKpiItem[]>(
    () => [
      { label: "Bodies", value: computed.doc?.bodies?.length ?? 0, tone: "info" },
      { label: "Joints", value: computed.doc?.joints?.length ?? 0 },
      { label: "Muscles", value: computed.doc?.muscles?.length ?? 0, tone: "success" },
      { label: "Markers", value: computed.doc?.markers?.length ?? 0 },
    ],
    [computed.doc],
  );

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="OpenSim Musculoskeletal"
        badge={computed.error ? { label: "Parse Error", tone: "danger" } : { label: "OpenSim", tone: "info" }}
        actions={
          <>
            {(activeTab === "topology" || activeTab === "muscles") && host.exportFile && (
              <PanelButton
                onClick={() => host.exportFile?.(`opensim-${activeTab}.svg`, svg, "image/svg+xml")}
                disabled={!svg}
              >
                Export SVG
              </PanelButton>
            )}
            {mode === "artifact" && host.openInAnsatzEditor && code && (
              <PanelButton
                variant="primary"
                onClick={() => host.openInAnsatzEditor?.(code, dialect || "opensim", title)}
              >
                Open in Ansatz Editor
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<OpenSimTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "topology", label: "Skeletal Topology" },
          { id: "muscles", label: "Muscle Force Curves", count: computed.doc?.muscles?.length ?? 0 },
          { id: "bodies", label: "Bodies", count: computed.doc?.bodies?.length ?? 0 },
        ]}
      />

      {(activeTab === "topology" || activeTab === "muscles") && (
        <PanelSvgStage
          svg={svg}
          onRevealLine={host.onRevealLine}
          emptyMessage={computed.error ?? "Load an OpenSim (.osim) musculoskeletal model."}
        />
      )}

      {activeTab === "bodies" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>Body</th>
                <th style={{ padding: "5px 6px" }}>Mass (kg)</th>
              </tr>
            </thead>
            <tbody>
              {(computed.doc?.bodies ?? []).map((b, idx) => (
                <tr
                  key={`${b.name}-${idx}`}
                  style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                >
                  <td style={{ padding: "4px 6px", fontWeight: 600 }}>{b.name}</td>
                  <td style={{ padding: "4px 6px" }}>{b.mass}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PanelShell>
  );
};

export default OpenSimPanel;
