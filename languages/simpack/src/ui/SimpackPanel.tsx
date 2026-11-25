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
import { renderSimpackSvg } from "../diagram/simpack-diagram.js";
import { parseSimDeck } from "../parser/sim-deck-parser.js";
import { parseSpckXml } from "../parser/spck-xml-parser.js";

type SimpackTabId = "topology" | "bodies" | "joints";

export const SimpackPanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<SimpackTabId>("topology");

  const computed = useMemo(() => {
    if (!code.trim()) return { model: null, error: undefined as string | undefined };
    try {
      const model = code.trimStart().startsWith("<") ? parseSpckXml(code) : parseSimDeck(code);
      return { model, error: undefined };
    } catch (err) {
      return { model: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [code]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    computed.model?.name ||
    "SIMPACK Multibody Dynamics";

  const svg = useMemo(() => {
    if (!computed.model) return "";
    try {
      return renderSimpackSvg(computed.model);
    } catch {
      return "";
    }
  }, [computed.model]);

  const bodies = useMemo(() => Array.from(computed.model?.bodies?.values() ?? []), [computed.model]);
  const joints = useMemo(() => Array.from(computed.model?.joints?.values() ?? []), [computed.model]);

  const kpis = useMemo<PanelKpiItem[]>(
    () => [
      { label: "Bodies", value: bodies.length, tone: "info" },
      { label: "Joints", value: joints.length },
      { label: "Force Elements", value: computed.model?.forces?.size ?? 0 },
    ],
    [bodies.length, joints.length, computed.model],
  );

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="SIMPACK Multibody System"
        badge={computed.error ? { label: "Parse Error", tone: "danger" } : { label: "SIMPACK", tone: "info" }}
        actions={
          <>
            {activeTab === "topology" && host.exportFile && (
              <PanelButton
                onClick={() => host.exportFile?.("simpack-topology.svg", svg, "image/svg+xml")}
                disabled={!svg}
              >
                Export SVG
              </PanelButton>
            )}
            {mode === "artifact" && host.openInAnsatzEditor && code && (
              <PanelButton
                variant="primary"
                onClick={() => host.openInAnsatzEditor?.(code, dialect || "simpack", title)}
              >
                Open in Ansatz Editor
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<SimpackTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "topology", label: "MBS Topology" },
          { id: "bodies", label: "Bodies", count: bodies.length },
          { id: "joints", label: "Joints", count: joints.length },
        ]}
      />

      {activeTab === "topology" && (
        <PanelSvgStage
          svg={svg}
          onRevealLine={host.onRevealLine}
          emptyMessage={computed.error ?? "Load a SIMPACK (.spck / .sim) multibody model."}
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
              {bodies.map((b, idx) => (
                <tr
                  key={`${b.name}-${idx}`}
                  style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                >
                  <td style={{ padding: "4px 6px", fontWeight: 600 }}>{b.name}</td>
                  <td style={{ padding: "4px 6px" }}>{b.mass ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "joints" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>Joint</th>
                <th style={{ padding: "5px 6px" }}>Type</th>
              </tr>
            </thead>
            <tbody>
              {joints.map((j, idx) => (
                <tr
                  key={`${j.name}-${idx}`}
                  style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                >
                  <td style={{ padding: "4px 6px", fontWeight: 600 }}>{j.name}</td>
                  <td style={{ padding: "4px 6px", color: "var(--ms-brand)" }}>{j.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PanelShell>
  );
};

export default SimpackPanel;
