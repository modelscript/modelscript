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
  renderDicomRtBevSvg,
  renderDicomRtDvhSvg,
  type DicomRtDocumentLike,
} from "@modelscript/diagram/dicom-rt-diagram-builder";
import React, { useMemo, useState } from "react";
import { parseDicomRt } from "../parser/index.js";

type DicomRtTabId = "bev" | "dvh" | "structures";

export const DicomRtPanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  documentUri,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<DicomRtTabId>("bev");

  const computed = useMemo(() => {
    if (!code.trim()) return { doc: null, error: undefined as string | undefined };
    try {
      return { doc: parseDicomRt(code, documentUri), error: undefined };
    } catch (err) {
      return { doc: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [code, documentUri]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    computed.doc?.planLabel ||
    "DICOM-RT Radiation Oncology Studio";

  const svg = useMemo(() => {
    if (!computed.doc) return "";
    try {
      const dLike = computed.doc as unknown as DicomRtDocumentLike;
      return activeTab === "dvh" ? renderDicomRtDvhSvg(dLike) : renderDicomRtBevSvg(dLike);
    } catch {
      return "";
    }
  }, [computed.doc, activeTab]);

  const kpis = useMemo<PanelKpiItem[]>(
    () => [
      { label: "Prescribed", value: computed.doc?.prescribedDoseGy ?? "—", unit: "Gy", tone: "info" },
      { label: "Fractions", value: computed.doc?.fractions ?? "—" },
      { label: "ROIs", value: computed.doc?.structures?.length ?? 0 },
      { label: "Beams", value: computed.doc?.beams?.length ?? 0 },
    ],
    [computed.doc],
  );

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="DICOM-RT Dosimetry & BEV"
        badge={computed.error ? { label: "Parse Error", tone: "danger" } : { label: "DICOM-RT", tone: "info" }}
        actions={
          <>
            {(activeTab === "bev" || activeTab === "dvh") && host.exportFile && (
              <PanelButton
                onClick={() => host.exportFile?.(`dicom-rt-${activeTab}.svg`, svg, "image/svg+xml")}
                disabled={!svg}
              >
                Export SVG
              </PanelButton>
            )}
            {mode === "artifact" && host.openInAnsatzEditor && code && (
              <PanelButton
                variant="primary"
                onClick={() => host.openInAnsatzEditor?.(code, dialect || "dicom-rt", title)}
              >
                Open in Ansatz Editor
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<DicomRtTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "bev", label: "Beam's Eye View" },
          { id: "dvh", label: "Dose-Volume Histogram" },
          { id: "structures", label: "ROI Structures", count: computed.doc?.structures?.length ?? 0 },
        ]}
      />

      {(activeTab === "bev" || activeTab === "dvh") && (
        <PanelSvgStage
          svg={svg}
          onRevealLine={host.onRevealLine}
          emptyMessage={computed.error ?? "Load a DICOM-RT (.dcm.json / .rtplan) plan."}
        />
      )}

      {activeTab === "structures" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>ROI Name</th>
                <th style={{ padding: "5px 6px" }}>Type</th>
              </tr>
            </thead>
            <tbody>
              {(computed.doc?.structures ?? []).map((s, idx) => (
                <tr
                  key={`${s.name}-${idx}`}
                  style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                >
                  <td style={{ padding: "4px 6px", fontWeight: 600 }}>{s.name}</td>
                  <td style={{ padding: "4px 6px", color: "var(--ms-text-2)" }}>{s.interpretedType ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PanelShell>
  );
};

export default DicomRtPanel;
