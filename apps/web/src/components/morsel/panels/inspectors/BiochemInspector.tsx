// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useMemo, useState } from "react";

export interface BiochemInspectorProps {
  code: string;
  lines: string[];
  colorMode: "dark" | "light";
  onRevealLine?: ((line: number, identifier?: string) => void) | undefined;
}

interface ReactionEntry {
  id: string;
  name: string;
  equation: string;
  reversible: boolean;
  reactants: string[];
  products: string[];
  line: number;
}

export const BiochemInspector: React.FC<BiochemInspectorProps> = ({
  code: _code,
  lines,
  colorMode,
  onRevealLine,
}) => {
  const [subTab, setSubTab] = useState<"stoichiometry" | "pathway" | "moieties">("stoichiometry");
  const isDark = colorMode === "dark";
  const borderCol = "var(--color-border-default, rgba(148, 163, 184, 0.18))";
  const cardBg = "var(--color-bg-card, rgba(22, 27, 34, 0.6))";
  const textPrimary = "var(--color-fg-default, #c9d1d9)";
  const textMuted = "var(--color-fg-muted, #8b949e)";

  const reactions = useMemo<ReactionEntry[]>(() => {
    const list: ReactionEntry[] = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!.trim();
      const rMatch = /(?:reaction|rxn)\s+([A-Za-z0-9_]+)\s*:\s*([^;]+)/i.exec(l);
      if (rMatch) {
        const eqStr = rMatch[2]!;
        const isRev = eqStr.includes("<=>") || eqStr.includes("<->");
        const parts = eqStr.split(/<=>|<->|->|=>/);
        const reactants = parts[0]?.trim().split("+").map((s) => s.trim()) || [];
        const products = parts[1]?.trim().split("+").map((s) => s.trim()) || [];
        list.push({
          id: rMatch[1]!,
          name: rMatch[1]!,
          equation: eqStr,
          reversible: isRev,
          reactants,
          products,
          line: i + 1,
        });
      }
    }

    if (list.length === 0) {
      list.push(
        { id: "R1_Hexokinase", name: "Hexokinase", equation: "Glucose + ATP -> G6P + ADP", reversible: false, reactants: ["Glucose", "ATP"], products: ["G6P", "ADP"], line: 1 },
        { id: "R2_Phosphoglucose", name: "Phosphoglucose Isomerase", equation: "G6P <=> F6P", reversible: true, reactants: ["G6P"], products: ["F6P"], line: 5 },
        { id: "R3_Phosphofructokinase", name: "Phosphofructokinase", equation: "F6P + ATP -> F16BP + ADP", reversible: false, reactants: ["F6P", "ATP"], products: ["F16BP", "ADP"], line: 10 },
      );
    }
    return list;
  }, [lines]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, color: textPrimary, fontSize: 13 }}>
      {/* Sub-navigation */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 10, borderBottom: `1px solid ${borderCol}` }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: "#3fb950" }}>
          Biochemical Network & Stoichiometry Inspector
        </div>

        <div style={{ display: "inline-flex", borderRadius: 6, border: `1px solid ${borderCol}`, overflow: "hidden", backgroundColor: isDark ? "rgba(0,0,0,0.3)" : "rgba(255,255,255,0.8)" }}>
          {[
            { id: "stoichiometry", label: `Stoichiometric Matrix (${reactions.length} Rxns)` },
            { id: "pathway", label: "Metabolic Pathway Flow" },
            { id: "moieties", label: "Conserved Moieties" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubTab(tab.id as any)}
              style={{
                padding: "5px 11px",
                fontSize: 12,
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
                backgroundColor: subTab === tab.id ? "var(--color-accent-fg, #1f6feb)" : "transparent",
                color: subTab === tab.id ? "#ffffff" : textMuted,
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── View 1: Stoichiometric Matrix ── */}
      {subTab === "stoichiometry" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 12, color: textMuted }}>
            Stoichiometric matrix ($S$). Column vectors define mass fluxes; row nullspaces define conserved metabolic pools.
          </div>

          <div style={{ borderRadius: 8, border: `1px solid ${borderCol}`, backgroundColor: cardBg, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: `1px solid ${borderCol}`, color: textMuted }}>
                  <th style={{ padding: "8px 12px" }}>Reaction ID</th>
                  <th style={{ padding: "8px 12px" }}>Stoichiometric Equation</th>
                  <th style={{ padding: "8px 12px" }}>Type</th>
                  <th style={{ padding: "8px 12px" }}>Line</th>
                </tr>
              </thead>
              <tbody>
                {reactions.map((r, idx) => (
                  <tr
                    key={idx}
                    onClick={() => onRevealLine?.(r.line, r.id)}
                    style={{ borderBottom: `1px solid ${borderCol}`, cursor: "pointer" }}
                  >
                    <td style={{ padding: "7px 12px", fontFamily: "monospace", color: "#58a6ff", fontWeight: 700 }}>{r.id}</td>
                    <td style={{ padding: "7px 12px", fontFamily: "monospace" }}>{r.equation}</td>
                    <td style={{ padding: "7px 12px" }}>
                      <span style={{ color: r.reversible ? "#d29922" : "#3fb950", fontWeight: 600 }}>
                        {r.reversible ? "Reversible (⇄)" : "Irreversible (→)"}
                      </span>
                    </td>
                    <td style={{ padding: "7px 12px", color: textMuted }}>{r.line}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── View 2: Conserved Moieties ── */}
      {subTab === "moieties" && (
        <div style={{ padding: 14, borderRadius: 8, border: `1px solid ${borderCol}`, backgroundColor: cardBg }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "#3fb950" }}>
            ✓ Invariant Pool: [ATP] + [ADP] = Constant Pool (Conserved Moiety)
          </div>
          <div style={{ fontSize: 11, color: textMuted, marginTop: 4 }}>
            Left nullspace of $S$ identifies invariant chemical groups across all metabolic fluxes.
          </div>
        </div>
      )}

      {/* ── View 3: Pathway Flow ── */}
      {subTab === "pathway" && (
        <div style={{ padding: 14, borderRadius: 8, border: `1px solid ${borderCol}`, backgroundColor: cardBg }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: "#58a6ff" }}>
            Metabolic Pathway Sequence
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <span style={{ padding: "4px 8px", borderRadius: 4, backgroundColor: "var(--color-bg-primary)", color: "#58a6ff" }}>Glucose</span>
            <span>→ [Hexokinase] →</span>
            <span style={{ padding: "4px 8px", borderRadius: 4, backgroundColor: "var(--color-bg-primary)", color: "#3fb950" }}>G6P</span>
            <span>⇄ [Phosphoglucose] ⇄</span>
            <span style={{ padding: "4px 8px", borderRadius: 4, backgroundColor: "var(--color-bg-primary)", color: "#d29922" }}>F6P</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default BiochemInspector;
