// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LanguagePanelProps } from "@modelscript/design-tokens/panel";
import { PanelButton, PanelKpiStrip, PanelShell, PanelTabBar, PanelToolbar } from "@modelscript/design-tokens/panel";
import React, { useMemo, useState } from "react";
import { parseSpice } from "../parser/spice-parser.js";
import { solveOp } from "../solvers/index.js";
import type { OperatingPoint } from "../types.js";

type SpiceTab = "components" | "directives" | "op";

export const SpicePanel: React.FC<LanguagePanelProps> = ({ code, colorMode, mode, isFullScreen }) => {
  const [tab, setTab] = useState<SpiceTab>("components");
  const [opResult, setOpResult] = useState<OperatingPoint | null>(null);
  const [opError, setOpError] = useState<string | null>(null);

  const { circuit, error } = useMemo(() => {
    try {
      return { circuit: parseSpice(code || ""), error: null as string | null };
    } catch (e) {
      return { circuit: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [code]);

  const handleSolveOp = () => {
    if (!circuit) return;
    try {
      setOpError(null);
      setOpResult(solveOp(circuit));
      setTab("op");
    } catch (e) {
      setOpError(e instanceof Error ? e.message : String(e));
    }
  };

  const components = circuit?.components ?? [];
  const directives = circuit?.directives ?? [];

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title={circuit?.title ? `SPICE: ${circuit.title}` : "SPICE Analog Circuit Inspector"}
        subtitle={`${components.length} components · ${circuit?.models.size ?? 0} models · ${directives.length} directives`}
        actions={
          <PanelButton variant="primary" onClick={handleSolveOp}>
            Solve DC (.OP)
          </PanelButton>
        }
      />
      {(error || opError) && (
        <div style={{ color: "var(--ms-error, #f85149)", fontSize: 12, padding: 8 }}>{error ?? opError}</div>
      )}
      <PanelKpiStrip
        items={[
          { label: "Components", value: components.length },
          { label: "Subcircuits", value: circuit?.subcircuits.size ?? 0 },
          { label: "Models", value: circuit?.models.size ?? 0 },
          {
            label: "DC .OP",
            value: opResult ? (opResult.converged ? `Converged (${opResult.iterations})` : "No Conv") : "Ready",
            tone: opResult ? (opResult.converged ? "success" : "danger") : "neutral",
          },
        ]}
      />
      <PanelTabBar
        activeTab={tab}
        onSelect={(id) => setTab(id as SpiceTab)}
        tabs={[
          { id: "components", label: `Components (${components.length})` },
          { id: "directives", label: `Directives (${directives.length})` },
          { id: "op", label: "DC Operating Point" },
        ]}
      />
      <div style={{ overflow: "auto", flex: 1, fontSize: 12 }}>
        {tab === "components" && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border-default, #30363d)" }}>
                <th style={{ padding: "6px 8px" }}>Name</th>
                <th style={{ padding: "6px 8px" }}>Kind</th>
                <th style={{ padding: "6px 8px" }}>Nodes</th>
                <th style={{ padding: "6px 8px" }}>Value / Model</th>
              </tr>
            </thead>
            <tbody>
              {components.map((c, idx) => (
                <tr
                  key={`${c.name}-${idx}`}
                  style={{ borderBottom: "1px solid var(--ms-border-subtle, rgba(128,128,128,0.15))" }}
                >
                  <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>{c.name}</td>
                  <td style={{ padding: "5px 8px" }}>{c.kind}</td>
                  <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>{c.nodes.join(", ")}</td>
                  <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>
                    {c.value !== undefined ? String(c.value) : (c.subcktName ?? c.model ?? "—")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === "directives" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: 8 }}>
            {directives.map((d, idx) => (
              <div key={`${d.kind}-${idx}`} style={{ fontFamily: "monospace" }}>
                <strong>{d.kind}</strong> {d.args.join(" ")}
              </div>
            ))}
          </div>
        )}
        {tab === "op" && (
          <div style={{ padding: 8 }}>
            {!opResult ? (
              <div style={{ opacity: 0.7 }}>Click "Solve DC (.OP)" to compute node voltages and branch currents.</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border-default, #30363d)" }}>
                    <th style={{ padding: "6px 8px" }}>Node</th>
                    <th style={{ padding: "6px 8px" }}>Voltage (V)</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(opResult.nodeVoltages.entries()).map(([node, v]) => (
                    <tr
                      key={node}
                      style={{ borderBottom: "1px solid var(--ms-border-subtle, rgba(128,128,128,0.15))" }}
                    >
                      <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>{node}</td>
                      <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>{v.toFixed(4)} V</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </PanelShell>
  );
};

export default SpicePanel;
