// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  PanelButton,
  PanelDataGrid,
  PanelKpiStrip,
  PanelShell,
  PanelSvgStage,
  PanelTabBar,
  PanelToolbar,
  type LanguagePanelProps,
  type PanelDataGridColumn,
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
  type ControlRow = (typeof controls)[number];
  const controlColumns = useMemo<PanelDataGridColumn<ControlRow>[]>(
    () => [
      { key: "id", label: "ID", mono: true, sortValue: (c) => c.id, render: (c) => <strong>{c.id}</strong> },
      { key: "title", label: "Title", sortValue: (c) => c.title ?? "", render: (c) => c.title },
    ],
    [],
  );

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
                Open in Editor
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
        <PanelDataGrid
          rows={controls}
          columns={controlColumns}
          rowKey={(c, idx) => `${c.id}-${idx}`}
          searchPlaceholder="Filter OSCAL controls by ID or title…"
          emptyMessage="No OSCAL controls parsed."
        />
      )}
    </PanelShell>
  );
};

export default OscalPanel;
