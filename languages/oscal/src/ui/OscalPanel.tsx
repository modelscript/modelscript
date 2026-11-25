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
  renderOscalBoundarySvg,
  renderOscalControlMatrixSvg,
  type OscalDocumentLike,
} from "@modelscript/diagram/oscal-diagram-builder";
import React, { useMemo, useState } from "react";
import { parseOscal } from "../parser/index.js";

type OscalTabId = "boundary" | "matrix" | "controls";

export const OscalPanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  documentUri,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<OscalTabId>("boundary");

  const computed = useMemo(() => {
    if (!code.trim()) return { doc: null, error: undefined as string | undefined };
    try {
      return { doc: parseOscal(code, documentUri), error: undefined };
    } catch (err) {
      return { doc: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [code, documentUri]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    computed.doc?.metadata?.title ||
    "OSCAL Security Assessment Studio";

  const svg = useMemo(() => {
    if (!computed.doc) return "";
    try {
      const dLike = computed.doc as unknown as OscalDocumentLike;
      return activeTab === "matrix" ? renderOscalControlMatrixSvg(dLike) : renderOscalBoundarySvg(dLike);
    } catch {
      return "";
    }
  }, [computed.doc, activeTab]);

  const controls = computed.doc?.controls ?? [];

  const kpis = useMemo<PanelKpiItem[]>(
    () => [
      { label: "Model Kind", value: computed.doc?.kind ?? "—", tone: "info" },
      { label: "Controls", value: controls.length },
      { label: "Groups", value: computed.doc?.groups?.length ?? 0 },
      { label: "Version", value: computed.doc?.metadata?.oscalVersion ?? "1.1" },
    ],
    [computed.doc, controls.length],
  );

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="NIST OSCAL / FedRAMP"
        badge={computed.error ? { label: "Parse Error", tone: "danger" } : { label: "OSCAL", tone: "info" }}
        actions={
          <>
            {(activeTab === "boundary" || activeTab === "matrix") && host.exportFile && (
              <PanelButton
                onClick={() => host.exportFile?.(`oscal-${activeTab}.svg`, svg, "image/svg+xml")}
                disabled={!svg}
              >
                Export SVG
              </PanelButton>
            )}
            {mode === "artifact" && host.openInAnsatzEditor && code && (
              <PanelButton variant="primary" onClick={() => host.openInAnsatzEditor?.(code, dialect || "oscal", title)}>
                Open in Ansatz Editor
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<OscalTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "boundary", label: "Authorization Boundary" },
          { id: "matrix", label: "Control Matrix" },
          { id: "controls", label: "Controls", count: controls.length },
        ]}
      />

      {(activeTab === "boundary" || activeTab === "matrix") && (
        <PanelSvgStage
          svg={svg}
          onRevealLine={host.onRevealLine}
          emptyMessage={computed.error ?? "Load a NIST OSCAL (.oscal.json / .oscal.xml) document."}
        />
      )}

      {activeTab === "controls" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>ID</th>
                <th style={{ padding: "5px 6px" }}>Title</th>
              </tr>
            </thead>
            <tbody>
              {controls.slice(0, 200).map((c, idx) => (
                <tr key={`${c.id}-${idx}`} style={{ borderBottom: "1px solid var(--ms-divider)" }}>
                  <td style={{ padding: "4px 6px", fontFamily: "var(--ms-font-mono)", fontWeight: 600 }}>{c.id}</td>
                  <td style={{ padding: "4px 6px" }}>{c.title}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PanelShell>
  );
};

export default OscalPanel;
