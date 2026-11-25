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
import { parseAmplModelWithDiagnostics } from "../parser/ampl-mod-parser.js";

type AmplTabId = "variables" | "objectives" | "constraints" | "sets" | "diagnostics";

export const AmplPanel: React.FC<LanguagePanelProps> = ({
  code,
  dialect,
  colorMode,
  mode,
  viewConfig,
  isFullScreen = false,
  host,
}) => {
  const [activeTab, setActiveTab] = useState<AmplTabId>("variables");

  const parsed = useMemo(() => {
    if (!code.trim())
      return {
        model: null,
        diagnostics: [] as { message: string; line?: number }[],
        error: undefined as string | undefined,
      };
    try {
      const res = parseAmplModelWithDiagnostics(code);
      const diags: { message: string; line?: number }[] = (res.errors ?? []).map((d) => ({
        message: d.message,
        ...(d.range?.start?.line !== undefined ? { line: d.range.start.line } : {}),
      }));
      return { model: res.model, diagnostics: diags, error: undefined };
    } catch (err) {
      return {
        model: null,
        diagnostics: [] as { message: string; line?: number }[],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [code]);

  const title =
    (typeof viewConfig?.["title"] === "string" && viewConfig["title"]) || "AMPL Mathematical Optimization Model";

  const sets = useMemo(() => Array.from(parsed.model?.sets?.values() ?? []), [parsed.model]);
  const params = useMemo(() => Array.from(parsed.model?.params?.values() ?? []), [parsed.model]);
  const vars = useMemo(() => Array.from(parsed.model?.vars?.values() ?? []), [parsed.model]);
  const objectives = useMemo(() => Array.from(parsed.model?.objectives?.values() ?? []), [parsed.model]);
  const constraints = useMemo(() => Array.from(parsed.model?.constraints?.values() ?? []), [parsed.model]);

  const kpis = useMemo<PanelKpiItem[]>(
    () => [
      { label: "Sets", value: sets.length },
      { label: "Params", value: params.length },
      { label: "Variables", value: vars.length, tone: "info" },
      { label: "Objectives", value: objectives.length, tone: "success" },
      { label: "Constraints", value: constraints.length },
    ],
    [sets.length, params.length, vars.length, objectives.length, constraints.length],
  );

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={title}
        subtitle="AMPL Optimization Inspector"
        badge={parsed.error ? { label: "Parse Error", tone: "danger" } : { label: "AMPL", tone: "info" }}
        actions={
          mode === "artifact" && host.openInAnsatzEditor && code ? (
            <PanelButton variant="primary" onClick={() => host.openInAnsatzEditor?.(code, dialect || "ampl", title)}>
              Open in Ansatz Editor
            </PanelButton>
          ) : undefined
        }
      />

      <PanelKpiStrip items={kpis} />

      <PanelTabBar<AmplTabId>
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabs={[
          { id: "variables", label: "Variables", count: vars.length },
          { id: "objectives", label: "Objectives", count: objectives.length },
          { id: "constraints", label: "Constraints", count: constraints.length },
          { id: "sets", label: "Sets & Params", count: sets.length + params.length },
          { id: "diagnostics", label: "Diagnostics", count: parsed.diagnostics.length },
        ]}
      />

      {activeTab === "variables" && (
        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11px" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border)", color: "var(--ms-text-2)" }}>
                <th style={{ padding: "5px 6px" }}>Variable</th>
                <th style={{ padding: "5px 6px" }}>Domain</th>
                <th style={{ padding: "5px 6px" }}>Type</th>
              </tr>
            </thead>
            <tbody>
              {vars.map((v, idx) => (
                <tr
                  key={`${v.name}-${idx}`}
                  style={{ borderBottom: "1px solid var(--ms-divider)", fontFamily: "var(--ms-font-mono)" }}
                >
                  <td style={{ padding: "4px 6px", fontWeight: 600 }}>{v.name}</td>
                  <td style={{ padding: "4px 6px", color: "var(--ms-text-2)" }}>{v.indexing ? "indexed" : "scalar"}</td>
                  <td style={{ padding: "4px 6px" }}>{v.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "objectives" && (
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
          {objectives.map((obj, idx) => (
            <div
              key={`${obj.name}-${idx}`}
              style={{
                padding: "8px 10px",
                borderRadius: "6px",
                background: "var(--ms-bg-alt)",
                border: "1px solid var(--ms-border)",
              }}
            >
              <span
                style={{ fontWeight: 700, textTransform: "uppercase", color: "var(--ms-brand)", marginRight: "8px" }}
              >
                {obj.direction}
              </span>
              <span style={{ fontFamily: "var(--ms-font-mono)", fontWeight: 600 }}>{obj.name}</span>
            </div>
          ))}
        </div>
      )}

      {activeTab === "constraints" && (
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
          {constraints.map((con, idx) => (
            <div
              key={`${con.name}-${idx}`}
              style={{
                padding: "7px 10px",
                borderRadius: "6px",
                background: "var(--ms-bg-alt)",
                border: "1px solid var(--ms-border)",
                fontFamily: "var(--ms-font-mono)",
              }}
            >
              <span style={{ fontWeight: 600 }}>{con.name}</span>
            </div>
          ))}
        </div>
      )}

      {activeTab === "sets" && (
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
          {sets.map((s, idx) => (
            <div
              key={`set-${s.name}-${idx}`}
              style={{
                padding: "6px 10px",
                borderRadius: "6px",
                background: "var(--ms-bg-alt)",
                border: "1px solid var(--ms-border)",
                fontFamily: "var(--ms-font-mono)",
              }}
            >
              set <strong>{s.name}</strong>
            </div>
          ))}
          {params.map((p, idx) => (
            <div
              key={`param-${p.name}-${idx}`}
              style={{
                padding: "6px 10px",
                borderRadius: "6px",
                background: "var(--ms-bg-alt)",
                border: "1px solid var(--ms-border)",
                fontFamily: "var(--ms-font-mono)",
              }}
            >
              param <strong>{p.name}</strong>
            </div>
          ))}
        </div>
      )}

      {activeTab === "diagnostics" && (
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
          {parsed.diagnostics.length === 0 ? (
            <div style={{ color: "var(--ms-text-2)" }}>No AMPL parse diagnostics.</div>
          ) : (
            parsed.diagnostics.map((d, idx) => (
              <div
                key={idx}
                onClick={() => d.line && host.onRevealLine?.(d.line)}
                style={{
                  padding: "7px 10px",
                  borderRadius: "6px",
                  background: "var(--ms-bg-alt)",
                  border: "1px solid var(--ms-border)",
                  cursor: d.line ? "pointer" : "default",
                }}
              >
                {d.message}
              </div>
            ))
          )}
        </div>
      )}
    </PanelShell>
  );
};

export default AmplPanel;
