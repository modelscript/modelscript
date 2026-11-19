// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LanguagePanelProps } from "@modelscript/design-tokens/panel";
import { PanelKpiStrip, PanelShell, PanelTabBar, PanelToolbar } from "@modelscript/design-tokens/panel";
import React, { useMemo, useState } from "react";

interface ScadSymbol {
  kind: "module" | "function" | "param";
  name: string;
  detail: string;
}

function inspectScadSource(source: string): { symbols: ScadSymbol[]; primitives: string[] } {
  const symbols: ScadSymbol[] = [];
  const primitives: string[] = [];
  const primNames = [
    "cube",
    "sphere",
    "cylinder",
    "polyhedron",
    "circle",
    "square",
    "polygon",
    "linear_extrude",
    "rotate_extrude",
  ];

  for (const line of source.split(/\r?\n/)) {
    const modMatch = line.match(/^\s*module\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/);
    if (modMatch) {
      symbols.push({ kind: "module", name: modMatch[1]!, detail: `(${modMatch[2] ?? ""})` });
      continue;
    }
    const fnMatch = line.match(/^\s*function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/);
    if (fnMatch) {
      symbols.push({ kind: "function", name: fnMatch[1]!, detail: `(${fnMatch[2] ?? ""})` });
      continue;
    }
    const paramMatch = line.match(/^\s*([A-Za-z_$][A-Za-z0-9_]*)\s*=\s*([^;]+);/);
    if (paramMatch) {
      symbols.push({ kind: "param", name: paramMatch[1]!, detail: paramMatch[2]!.trim() });
    }
  }

  for (const prim of primNames) {
    const re = new RegExp(`\\b${prim}\\s*\\(`, "g");
    const count = (source.match(re) ?? []).length;
    for (let i = 0; i < count; i++) primitives.push(prim);
  }

  return { symbols, primitives };
}

type ScadTab = "params" | "modules";

export const ScadPanel: React.FC<LanguagePanelProps> = ({ code, colorMode, mode, isFullScreen }) => {
  const [tab, setTab] = useState<ScadTab>("params");
  const { symbols, primitives } = useMemo(() => inspectScadSource(code || ""), [code]);
  const params = useMemo(() => symbols.filter((s) => s.kind === "param"), [symbols]);
  const modules = useMemo(() => symbols.filter((s) => s.kind !== "param"), [symbols]);

  return (
    <PanelShell mode={mode} colorMode={colorMode} isFullScreen={isFullScreen}>
      <PanelToolbar
        title="OpenSCAD Parametric CSG Inspector"
        subtitle={`${modules.length} modules/functions · ${params.length} parameters · ${primitives.length} CSG primitives`}
      />
      <PanelKpiStrip
        items={[
          { label: "Parameters", value: params.length },
          { label: "Modules / Fns", value: modules.length },
          { label: "CSG Primitives", value: primitives.length },
        ]}
      />
      <PanelTabBar
        activeTab={tab}
        onSelect={(id) => setTab(id as ScadTab)}
        tabs={[
          { id: "params", label: `Parameters (${params.length})` },
          { id: "modules", label: `Modules & Functions (${modules.length})` },
        ]}
      />
      <div style={{ overflow: "auto", flex: 1, fontSize: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--ms-border-default, #30363d)" }}>
              <th style={{ padding: "6px 8px" }}>Name</th>
              <th style={{ padding: "6px 8px" }}>{tab === "params" ? "Value" : "Signature"}</th>
            </tr>
          </thead>
          <tbody>
            {(tab === "params" ? params : modules).map((s, idx) => (
              <tr
                key={`${s.name}-${idx}`}
                style={{ borderBottom: "1px solid var(--ms-border-subtle, rgba(128,128,128,0.15))" }}
              >
                <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>{s.name}</td>
                <td style={{ padding: "5px 8px", fontFamily: "monospace", opacity: 0.85 }}>{s.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PanelShell>
  );
};

export default ScadPanel;
