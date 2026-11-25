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
import { renderUrdfIsometric3DSvg, renderUrdfSvg } from "../diagram/urdf-diagram.js";
import { parseUrdf } from "../parser/urdf-parser.js";

type UrdfTabId = "tree" | "iso3d" | "links" | "joints";

export const UrdfPanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<UrdfTabId>("tree");

  const computed = useMemo(() => {
    if (!code.trim()) return { robot: null, error: undefined as string | undefined };
    try {
      return { robot: parseUrdf(code), error: undefined };
    } catch (err) {
      return { robot: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [code]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    computed.robot?.name ||
    "URDF / SDF Robot Kinematics";

  const svg = useMemo(() => {
    if (!computed.robot) return "";
    try {
      return activeTab === "iso3d" ? renderUrdfIsometric3DSvg(computed.robot) : renderUrdfSvg(computed.robot);
    } catch {
      return "";
    }
  }, [computed.robot, activeTab]);

  const links = useMemo(() => Array.from(computed.robot?.links?.values() ?? []), [computed.robot]);
  const joints = useMemo(() => Array.from(computed.robot?.joints?.values() ?? []), [computed.robot]);

  const kpis = useMemo<PanelKpiItem[]>(() => {
    const dof = joints.filter((j) => j.type !== "fixed").length;
    return [
      { label: "Links", value: links.length, tone: "info" },
      { label: "Joints", value: joints.length },
      { label: "Active DOF", value: dof, tone: "success" },
    ];
  }, [links.length, joints]);

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="ROS URDF / SDFormat Kinematics"
        badge={computed.error ? { label: "Parse Error", tone: "danger" } : { label: "URDF", tone: "info" }}
        actions={
          <>
            {(activeTab === "tree" || activeTab === "iso3d") && host.exportFile && (
              <PanelButton
                onClick={() => host.exportFile?.(`urdf-${activeTab}.svg`, svg, "image/svg+xml")}
                disabled={!svg}
              >
                Export SVG
              </PanelButton>
            )}
            {mode === "artifact" && host.openInAnsatzEditor && code && (
              <PanelButton variant="primary" onClick={() => host.openInAnsatzEditor?.(code, dialect || "urdf", title)}>
                Open in Ansatz Editor
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<UrdfTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "tree", label: "Kinematic Tree" },
          { id: "iso3d", label: "3D Isometric" },
          { id: "links", label: "Links", count: links.length },
          { id: "joints", label: "Joints", count: joints.length },
        ]}
      />

      {(activeTab === "tree" || activeTab === "iso3d") && (
        <PanelSvgStage
          svg={svg}
          onRevealLine={host.onRevealLine}
          emptyMessage={computed.error ?? "Load a URDF / SDF / Xacro robot description."}
        />
      )}

      {activeTab === "links" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>Link</th>
                <th style={{ padding: "5px 6px" }}>Mass (kg)</th>
              </tr>
            </thead>
            <tbody>
              {links.map((lk, idx) => (
                <tr
                  key={`${lk.name}-${idx}`}
                  style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                >
                  <td style={{ padding: "4px 6px", fontWeight: 600 }}>{lk.name}</td>
                  <td style={{ padding: "4px 6px" }}>{lk.inertial?.mass ?? "—"}</td>
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
                <th style={{ padding: "5px 6px" }}>Parent → Child</th>
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
                  <td style={{ padding: "4px 6px" }}>
                    {j.parentLink} → {j.childLink}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PanelShell>
  );
};

export default UrdfPanel;
