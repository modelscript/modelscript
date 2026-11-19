// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  PanelButton,
  PanelKpiStrip,
  PanelShell,
  PanelTabBar,
  PanelToolbar,
  type LanguagePanelProps,
  type PanelKpiItem,
} from "@modelscript/design-tokens/panel";
import React, { useMemo, useState } from "react";
import { parseUsd } from "../parser/usd-parser.js";

type UsdTabId = "hierarchy" | "physics" | "metadata";

interface FlatPrimRow {
  path: string;
  name: string;
  typeName: string;
  depth: number;
  hasPhysics: boolean;
}

export const UsdPanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<UsdTabId>("hierarchy");

  const computed = useMemo(() => {
    if (!code.trim()) return { stage: null, error: undefined as string | undefined };
    try {
      return { stage: parseUsd(code), error: undefined };
    } catch (err) {
      return { stage: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [code]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) ||
    computed.stage?.metadata?.defaultPrim ||
    "OpenUSD Stage Inspector";

  const primRows = useMemo<FlatPrimRow[]>(() => {
    const out: FlatPrimRow[] = [];
    const walk = (prims: unknown[], parentPath: string, depth: number) => {
      for (const raw of prims) {
        const p = raw as {
          name?: string;
          typeName?: string;
          apiSchemas?: string[];
          children?: unknown[];
        };
        const name = p.name ?? "Prim";
        const path = `${parentPath}/${name}`;
        const schemas = p.apiSchemas ?? [];
        const hasPhysics = (p.typeName ?? "").includes("Physics") || schemas.some((s) => s.includes("Physics"));
        out.push({ path, name, typeName: p.typeName ?? "Xform", depth, hasPhysics });
        if (Array.isArray(p.children)) walk(p.children, path, depth + 1);
      }
    };
    if (computed.stage?.rootPrims) walk(computed.stage.rootPrims, "", 0);
    return out;
  }, [computed.stage]);

  const physicsPrims = useMemo(() => primRows.filter((p) => p.hasPhysics), [primRows]);

  const kpis = useMemo<PanelKpiItem[]>(
    () => [
      { label: "Prims", value: primRows.length, tone: "info" },
      { label: "UsdPhysics", value: physicsPrims.length, tone: "success" },
      { label: "Up Axis", value: computed.stage?.metadata?.upAxis ?? "Y" },
      { label: "Meters/Unit", value: computed.stage?.metadata?.metersPerUnit ?? 1 },
    ],
    [primRows.length, physicsPrims.length, computed.stage],
  );

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="OpenUSD / UsdPhysics"
        badge={computed.error ? { label: "Parse Error", tone: "danger" } : { label: "OpenUSD", tone: "info" }}
        actions={
          mode === "artifact" && host.openInMorsel && code ? (
            <PanelButton variant="primary" onClick={() => host.openInMorsel?.(code, dialect || "usd", title)}>
              Open in Morsel
            </PanelButton>
          ) : undefined
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<UsdTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "hierarchy", label: "Scene Graph", count: primRows.length },
          { id: "physics", label: "UsdPhysics", count: physicsPrims.length },
          { id: "metadata", label: "Stage Metadata" },
        ]}
      />

      {activeTab === "hierarchy" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>Prim Path</th>
                <th style={{ padding: "5px 6px" }}>Type</th>
              </tr>
            </thead>
            <tbody>
              {primRows.slice(0, 250).map((p, idx) => (
                <tr
                  key={`${p.path}-${idx}`}
                  style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                >
                  <td style={{ padding: "4px 6px", paddingLeft: `${6 + p.depth * 14}px`, fontWeight: 600 }}>
                    {p.path}
                  </td>
                  <td style={{ padding: "4px 6px", color: p.hasPhysics ? "var(--ms-success)" : "var(--ms-text-2)" }}>
                    {p.typeName}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "physics" && (
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
          {physicsPrims.length === 0 ? (
            <div style={{ color: "var(--ms-text-2)" }}>No UsdPhysics prims detected in stage.</div>
          ) : (
            physicsPrims.map((p, idx) => (
              <div
                key={`${p.path}-${idx}`}
                style={{
                  padding: "7px 10px",
                  borderRadius: "6px",
                  background: "var(--ms-bg-alt)",
                  border: "1px solid var(--ms-border)",
                  fontFamily: "var(--ms-font-mono)",
                }}
              >
                <strong>{p.path}</strong> — {p.typeName}
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === "metadata" && (
        <div
          style={{ flex: 1, overflow: "auto", padding: "12px", fontFamily: "var(--ms-font-mono)", fontSize: "11px" }}
        >
          <div>defaultPrim: {computed.stage?.metadata?.defaultPrim ?? "—"}</div>
          <div>upAxis: {computed.stage?.metadata?.upAxis ?? "—"}</div>
          <div>metersPerUnit: {computed.stage?.metadata?.metersPerUnit ?? "—"}</div>
        </div>
      )}
    </PanelShell>
  );
};

export default UsdPanel;
