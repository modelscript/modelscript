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
import { renderIgtlTransformTreeSvg, type IgtlDocumentLike } from "@modelscript/diagram/igtl-diagram-builder";
import React, { useMemo, useState } from "react";
import { parseIgtl } from "../parser/index.js";

type IgtlTabId = "tree" | "devices" | "transforms";

export const IgtlPanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  documentUri,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<IgtlTabId>("tree");

  const computed = useMemo(() => {
    if (!code.trim()) return { doc: null, error: undefined as string | undefined };
    try {
      return { doc: parseIgtl(code, documentUri), error: undefined };
    } catch (err) {
      return { doc: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [code, documentUri]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) || "OpenIGTLink Surgical Robotics Studio";

  const svg = useMemo(() => {
    if (!computed.doc) return "";
    try {
      return renderIgtlTransformTreeSvg(computed.doc as unknown as IgtlDocumentLike);
    } catch {
      return "";
    }
  }, [computed.doc]);

  const kpis = useMemo<PanelKpiItem[]>(
    () => [
      { label: "Devices", value: computed.doc?.devices?.length ?? 0, tone: "info" },
      { label: "Transforms", value: computed.doc?.transforms?.length ?? 0 },
      { label: "Servers", value: computed.doc?.servers?.length ?? 0 },
      { label: "Messages", value: computed.doc?.messages?.length ?? 0 },
    ],
    [computed.doc],
  );

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="OpenIGTLink / PLUS Navigation"
        badge={computed.error ? { label: "Parse Error", tone: "danger" } : { label: "IGTL", tone: "info" }}
        actions={
          <>
            {activeTab === "tree" && host.exportFile && (
              <PanelButton
                onClick={() => host.exportFile?.("igtl-transforms.svg", svg, "image/svg+xml")}
                disabled={!svg}
              >
                Export SVG
              </PanelButton>
            )}
            {mode === "artifact" && host.openInAnsatzEditor && code && (
              <PanelButton variant="primary" onClick={() => host.openInAnsatzEditor?.(code, dialect || "igtl", title)}>
                Open in Ansatz Editor
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<IgtlTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "tree", label: "Transform Tree" },
          { id: "devices", label: "Devices", count: computed.doc?.devices?.length ?? 0 },
          { id: "transforms", label: "Transforms", count: computed.doc?.transforms?.length ?? 0 },
        ]}
      />

      {activeTab === "tree" && (
        <PanelSvgStage
          svg={svg}
          onRevealLine={host.onRevealLine}
          emptyMessage={computed.error ?? "Load an OpenIGTLink (.igtl / .igtl.json / .plus.xml) configuration."}
        />
      )}

      {activeTab === "devices" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          {(computed.doc?.devices ?? []).map((dev, idx) => (
            <div
              key={`${dev.id}-${idx}`}
              style={{
                padding: "7px 10px",
                marginBottom: "6px",
                borderRadius: "6px",
                background: "var(--ms-bg-alt)",
                border: "1px solid var(--ms-border)",
                fontFamily: "var(--ms-font-mono)",
              }}
            >
              <strong>{dev.id}</strong> ({dev.type})
            </div>
          ))}
        </div>
      )}

      {activeTab === "transforms" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          {(computed.doc?.transforms ?? []).map((tf, idx) => (
            <div
              key={idx}
              style={{
                padding: "7px 10px",
                marginBottom: "6px",
                borderRadius: "6px",
                background: "var(--ms-bg-alt)",
                border: "1px solid var(--ms-border)",
                fontFamily: "var(--ms-font-mono)",
              }}
            >
              {tf.from} → {tf.to}
            </div>
          ))}
        </div>
      )}
    </PanelShell>
  );
};

export default IgtlPanel;
