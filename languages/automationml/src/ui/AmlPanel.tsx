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
  renderAmlTopologySvg,
  renderAmlWorkcell3dSvg,
  type AmlDocumentLike,
} from "@modelscript/diagram/aml-diagram-builder";
import React, { useMemo, useState } from "react";
import { lintAutomationML } from "../lints/index.js";
import { parseAutomationML } from "../parser/index.js";

type AmlTabId = "topology" | "workcell3d" | "elements" | "lints";

export const AmlPanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  documentUri,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<AmlTabId>("topology");

  const computed = useMemo(() => {
    if (!code.trim()) {
      return { doc: null, lints: [] as ReturnType<typeof lintAutomationML>, error: undefined as string | undefined };
    }
    try {
      const doc = parseAutomationML(code, documentUri);
      const lints = lintAutomationML(doc);
      return { doc, lints, error: undefined };
    } catch (err) {
      return { doc: null, lints: [], error: err instanceof Error ? err.message : String(err) };
    }
  }, [code, documentUri]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    computed.doc?.fileName ||
    "AutomationML Engineering Workbench";

  const svg = useMemo(() => {
    if (!computed.doc) return "";
    try {
      const dLike = computed.doc as unknown as AmlDocumentLike;
      return activeTab === "workcell3d" ? renderAmlWorkcell3dSvg(dLike) : renderAmlTopologySvg(dLike);
    } catch {
      return "";
    }
  }, [computed.doc, activeTab]);

  const allElements = useMemo(() => {
    const out: { name: string; id?: string | undefined; role?: string | undefined }[] = [];
    const walk = (els: unknown[]) => {
      for (const raw of els) {
        const el = raw as {
          name?: string;
          id?: string;
          roleRequirements?: { refBaseRoleClassPath?: string }[];
          elements?: unknown[];
          internalElements?: unknown[];
        };
        if (el.name) {
          out.push({
            name: el.name,
            id: el.id,
            role: el.roleRequirements?.[0]?.refBaseRoleClassPath,
          });
        }
        const children = el.elements ?? el.internalElements;
        if (Array.isArray(children)) walk(children);
      }
    };
    for (const ih of computed.doc?.instanceHierarchies ?? []) {
      const children =
        (ih as { elements?: unknown[]; internalElements?: unknown[] }).elements ??
        (ih as { internalElements?: unknown[] }).internalElements ??
        [];
      walk(children);
    }
    return out;
  }, [computed.doc]);

  const kpis = useMemo<PanelKpiItem[]>(() => {
    const hierarchies = computed.doc?.instanceHierarchies?.length ?? 0;
    return [
      { label: "Hierarchies", value: hierarchies, tone: "info" },
      { label: "InternalElements", value: allElements.length },
      { label: "Diagnostics", value: computed.lints.length, tone: computed.lints.length > 0 ? "warning" : "success" },
    ];
  }, [computed.doc, allElements.length, computed.lints]);

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="IEC 62714 AutomationML / CAEX"
        badge={computed.error ? { label: "Parse Error", tone: "danger" } : { label: "AML", tone: "info" }}
        actions={
          <>
            {(activeTab === "topology" || activeTab === "workcell3d") && host.exportFile && (
              <PanelButton
                onClick={() => host.exportFile?.(`aml-${activeTab}.svg`, svg, "image/svg+xml")}
                disabled={!svg}
              >
                Export SVG
              </PanelButton>
            )}
            {mode === "artifact" && host.openInAnsatzEditor && code && (
              <PanelButton
                variant="primary"
                onClick={() => host.openInAnsatzEditor?.(code, dialect || "automationml", title)}
              >
                Open in Ansatz Editor
              </PanelButton>
            )}
          </>
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<AmlTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "topology", label: "Plant Topology" },
          { id: "workcell3d", label: "3D Workcell" },
          { id: "elements", label: "Elements", count: allElements.length },
          { id: "lints", label: "Lints", count: computed.lints.length },
        ]}
      />

      {(activeTab === "topology" || activeTab === "workcell3d") && (
        <PanelSvgStage
          svg={svg}
          onRevealLine={host.onRevealLine}
          emptyMessage={computed.error ?? "Load an AutomationML (.aml / .caex) document to inspect plant topology."}
        />
      )}

      {activeTab === "elements" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>Name</th>
                <th style={{ padding: "5px 6px" }}>Role</th>
                <th style={{ padding: "5px 6px" }}>ID</th>
              </tr>
            </thead>
            <tbody>
              {allElements.slice(0, 200).map((el, idx) => (
                <tr
                  key={`${el.id ?? el.name}-${idx}`}
                  style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                >
                  <td style={{ padding: "4px 6px", fontWeight: 600 }}>{el.name}</td>
                  <td style={{ padding: "4px 6px", color: "var(--ms-text-2)" }}>{el.role ?? "—"}</td>
                  <td style={{ padding: "4px 6px", color: "var(--ms-text-3)" }}>{el.id ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
            <div style={{ color: "var(--ms-text-2)" }}>No AutomationML lint diagnostics.</div>
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

export default AmlPanel;
