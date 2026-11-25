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
import { renderPscadSvg, type PscadProjectLike } from "@modelscript/diagram/pscad-diagram-builder";
import React, { useMemo, useState } from "react";
import { parsePscx } from "../parser/pscx-parser.js";

type PscadTabId = "schematic" | "components" | "wires";

export const PscadPanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<PscadTabId>("schematic");

  const computed = useMemo(() => {
    if (!code.trim()) return { project: null, error: undefined as string | undefined };
    try {
      return { project: parsePscx(code), error: undefined };
    } catch (err) {
      return { project: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [code]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    computed.project?.name ||
    "PSCAD EMT Schematic";

  const mainMod = computed.project?.rootModule ?? null;

  const svg = useMemo(() => {
    if (!computed.project) return "";
    try {
      return renderPscadSvg(computed.project as unknown as PscadProjectLike);
    } catch {
      return "";
    }
  }, [computed.project]);

  const kpis = useMemo<PanelKpiItem[]>(() => {
    const defCount = computed.project?.definitions?.size ?? 0;
    const compCount = mainMod?.components.length ?? 0;
    const wireCount = mainMod?.wires.length ?? 0;
    return [
      { label: "Definitions", value: defCount, tone: "info" },
      { label: "Components", value: compCount },
      { label: "Wires", value: wireCount },
    ];
  }, [computed.project, mainMod]);

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="PSCAD / EMTDC Schematic"
        badge={computed.error ? { label: "Parse Error", tone: "danger" } : { label: "PSCAD", tone: "info" }}
        actions={
          <>
            {activeTab === "schematic" && host.exportFile && (
              <PanelButton
                onClick={() => host.exportFile?.("pscad-schematic.svg", svg, "image/svg+xml")}
                disabled={!svg}
              >
                Export SVG
              </PanelButton>
            )}
            {mode === "artifact" && host.openInAnsatzEditor && code && (
              <PanelButton variant="primary" onClick={() => host.openInAnsatzEditor?.(code, dialect || "pscad", title)}>
                Open in Ansatz Editor
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<PscadTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "schematic", label: "EMT Schematic" },
          { id: "components", label: "Components", count: mainMod?.components.length ?? 0 },
          { id: "wires", label: "Wires", count: mainMod?.wires.length ?? 0 },
        ]}
      />

      {activeTab === "schematic" && (
        <PanelSvgStage
          svg={svg}
          onRevealLine={host.onRevealLine}
          emptyMessage={computed.error ?? "Load a PSCAD (.pscx / .pslx) project to view the EMT schematic."}
        />
      )}

      {activeTab === "components" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>ID</th>
                <th style={{ padding: "5px 6px" }}>Name</th>
                <th style={{ padding: "5px 6px" }}>Position</th>
              </tr>
            </thead>
            <tbody>
              {(mainMod?.components ?? []).slice(0, 200).map((inst, idx) => (
                <tr
                  key={`${inst.id}-${idx}`}
                  style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                >
                  <td style={{ padding: "4px 6px", fontWeight: 600 }}>{inst.id}</td>
                  <td style={{ padding: "4px 6px" }}>{inst.instanceName ?? inst.definitionName}</td>
                  <td style={{ padding: "4px 6px", color: "var(--ms-text-2)" }}>
                    ({inst.position.x}, {inst.position.y})
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "wires" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          {(mainMod?.wires ?? []).slice(0, 200).map((w, idx) => (
            <div
              key={`${w.id}-${idx}`}
              style={{
                padding: "6px 10px",
                marginBottom: "5px",
                borderRadius: "6px",
                background: "var(--ms-bg-alt)",
                border: "1px solid var(--ms-border)",
                fontFamily: "var(--ms-font-mono)",
              }}
            >
              Wire #{w.id}: ({w.vertices[0]?.x ?? 0}, {w.vertices[0]?.y ?? 0}) — {w.vertices.length} vertices
            </div>
          ))}
        </div>
      )}
    </PanelShell>
  );
};

export default PscadPanel;
