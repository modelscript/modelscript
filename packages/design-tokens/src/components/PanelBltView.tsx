// SPDX-License-Identifier: AGPL-3.0-or-later

import React from "react";

export interface BltEquationInfo {
  index: number;
  text: string;
  line?: number | undefined;
}

export interface BltBlockInfo {
  blockIndex: number;
  equationIndices: number[];
  variables: string[];
  isAlgebraicLoop: boolean;
  isSolved: boolean;
}

export interface BltAnalysisData {
  className?: string | undefined;
  status: "balanced" | "underdetermined" | "overdetermined" | "empty";
  unknowns: string[];
  states: string[];
  equations: BltEquationInfo[];
  /** incidence[eqIdx][varIdx] === true if var appears in eq */
  incidence: boolean[][];
  /** matching[eqIdx] = matched varIdx or -1 */
  matching: number[];
  blocks: BltBlockInfo[];
}

export interface PanelBltViewProps {
  data: BltAnalysisData | null | undefined;
  onRevealLine?: ((line: number) => void) | undefined;
  emptyHint?: string | undefined;
}

export const PanelBltView: React.FC<PanelBltViewProps> = ({ data, onRevealLine, emptyHint }) => {
  if (!data) {
    return (
      <div style={{ padding: 12, fontSize: 12, color: "var(--ms-text-muted, #94a3b8)" }}>
        {emptyHint ?? "No BLT analysis data available for this document."}
      </div>
    );
  }

  const badgeBg =
    data.status === "balanced"
      ? "rgba(16, 185, 129, 0.18)"
      : data.status === "empty"
        ? "rgba(148, 163, 184, 0.18)"
        : "rgba(245, 158, 11, 0.2)";
  const badgeColor = data.status === "balanced" ? "#10b981" : data.status === "empty" ? "#94a3b8" : "#f59e0b";

  return (
    <div style={{ flex: 1, overflow: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", fontSize: 12 }}>
        <span
          style={{
            padding: "3px 8px",
            borderRadius: 999,
            fontWeight: 600,
            background: badgeBg,
            color: badgeColor,
          }}
        >
          {data.status.toUpperCase()}
        </span>
        {data.className && (
          <span>
            Class: <strong>{data.className}</strong>
          </span>
        )}
        <span>
          States: <strong>{data.states.length > 0 ? data.states.join(", ") : "none"}</strong>
        </span>
        <span>
          BLT Blocks: <strong>{data.blocks.length}</strong> ({data.blocks.filter((b) => b.isAlgebraicLoop).length}{" "}
          algebraic loops)
        </span>
      </div>

      {data.equations.length > 0 && data.unknowns.length > 0 ? (
        <>
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                marginBottom: 6,
                color: "var(--ms-text-muted, #94a3b8)",
              }}
            >
              BLT Incidence Matrix
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", fontSize: 11, fontFamily: "ui-monospace, monospace" }}>
                <thead>
                  <tr>
                    <th style={{ padding: "4px 8px", textAlign: "left", color: "var(--ms-text-muted, #94a3b8)" }}>
                      Eq \ Var
                    </th>
                    {data.unknowns.map((v) => (
                      <th key={v} style={{ padding: "4px 8px", borderBottom: "1px solid var(--ms-border, #2a2d3a)" }}>
                        {data.states.includes(v) ? `der(${v})` : v}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.equations.map((eq, eqIdx) => (
                    <tr key={eq.index}>
                      <td
                        onClick={() => eq.line !== undefined && onRevealLine?.(eq.line)}
                        style={{
                          padding: "4px 8px",
                          cursor: eq.line !== undefined && onRevealLine ? "pointer" : "default",
                          borderRight: "1px solid var(--ms-border, #2a2d3a)",
                          color: "var(--ms-text-muted, #94a3b8)",
                        }}
                      >
                        E{eqIdx + 1}
                        {eq.line !== undefined ? ` (L${eq.line})` : ""}
                      </td>
                      {data.unknowns.map((v, varIdx) => {
                        const present = data.incidence[eqIdx]?.[varIdx] ?? false;
                        const matched = data.matching[eqIdx] === varIdx;
                        return (
                          <td
                            key={v}
                            style={{
                              padding: "4px 8px",
                              textAlign: "center",
                              border: "1px solid var(--ms-border, #2a2d3a)",
                              background: matched
                                ? "rgba(16, 185, 129, 0.25)"
                                : present
                                  ? "rgba(59, 130, 246, 0.2)"
                                  : "transparent",
                              fontWeight: matched ? 700 : 400,
                            }}
                          >
                            {matched ? "●" : present ? "×" : ""}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                marginBottom: 6,
                color: "var(--ms-text-muted, #94a3b8)",
              }}
            >
              Ordered BLT Blocks
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {data.blocks.map((blk) => (
                <div
                  key={blk.blockIndex}
                  style={{
                    padding: 8,
                    borderRadius: 6,
                    border: "1px solid var(--ms-border, #2a2d3a)",
                    borderLeft: `3px solid ${blk.isAlgebraicLoop ? "#f59e0b" : "#10b981"}`,
                    background: "var(--ms-surface-2, #161b22)",
                    fontSize: 12,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <strong>
                      Block {blk.blockIndex} {blk.isAlgebraicLoop ? "(Algebraic Loop)" : "(Scalar Assignment)"}
                    </strong>
                    <code style={{ fontSize: 11, fontFamily: "ui-monospace, monospace" }}>
                      solves: {blk.variables.join(", ")}
                    </code>
                  </div>
                  {blk.equationIndices.map((ei) => {
                    const eq = data.equations[ei];
                    if (!eq) return null;
                    return (
                      <div
                        key={ei}
                        onClick={() => eq.line !== undefined && onRevealLine?.(eq.line)}
                        style={{
                          fontFamily: "ui-monospace, monospace",
                          fontSize: 11.5,
                          cursor: eq.line !== undefined && onRevealLine ? "pointer" : "default",
                          color: "var(--ms-text-muted, #94a3b8)",
                        }}
                      >
                        {eq.line !== undefined ? `L${eq.line}: ` : ""}
                        {eq.text}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div style={{ fontSize: 12, color: "var(--ms-text-muted, #94a3b8)" }}>
          {emptyHint ??
            "No scalar equations detected. Add equations and unknowns to view the BLT incidence matrix and block ordering."}
        </div>
      )}
    </div>
  );
};
