// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable react-refresh/only-export-components */

import React, { useMemo, useState } from "react";

export interface BiochemInspectorProps {
  code: string;
  lines: string[];
  colorMode: "dark" | "light";
  onRevealLine?: ((line: number, identifier?: string) => void) | undefined;
}

export interface ParsedReaction {
  id: string;
  reversible: boolean;
  reactants: Array<{ species: string; coeff: number }>;
  products: Array<{ species: string; coeff: number }>;
  kineticLaw?: string | undefined;
  line: number;
}

export interface BiochemSummary {
  species: string[];
  reactions: ParsedReaction[];
  stoichMatrix: number[][]; // [speciesIdx][reactionIdx]
  conservedMoieties: string[];
  smilesFormula?: { smiles: string; formula: string; approxMw: number } | undefined;
}

function parseStoichSide(side: string): Array<{ species: string; coeff: number }> {
  const out: Array<{ species: string; coeff: number }> = [];
  const terms = side
    .split("+")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const term of terms) {
    if (term === "0" || term === "null" || term === "∅") continue;
    const m = /^(?:(\d+(?:\.\d+)?)\s*\*?\s*)?\$?([A-Za-z_][A-Za-z0-9_]*)$/.exec(term);
    if (m) {
      out.push({
        coeff: m[1] !== undefined ? Number(m[1]) : 1,
        species: m[2]!,
      });
    }
  }
  return out;
}

/**
 * Compute left nullspace basis of stoichiometric matrix S (i.e. vectors c such that c^T * S = 0)
 * using Gauss-Jordan RREF on [S^T | I_m].
 */
function computeConservedMoieties(species: string[], stoich: number[][]): string[] {
  const m = species.length;
  const r = stoich[0]?.length ?? 0;
  if (m === 0 || r === 0) return [];

  // Augmented matrix [S^T (r x m) | — ]? Wait: we want c in R^m with S^T * c = 0!
  // Standard nullspace of A = S^T (dimensions r x m): row-reduce A to RREF!
  const A: number[][] = Array.from({ length: r }, (_, j) => Array.from({ length: m }, (__, i) => stoich[i]![j]!));

  const pivotColForRow: number[] = [];
  const isPivotCol = new Array<boolean>(m).fill(false);
  let row = 0;

  for (let col = 0; col < m && row < r; col++) {
    let best = row;
    for (let k = row + 1; k < r; k++) {
      if (Math.abs(A[k]![col]!) > Math.abs(A[best]![col]!)) best = k;
    }
    if (Math.abs(A[best]![col]!) < 1e-9) continue;

    const tmp = A[row]!;
    A[row] = A[best]!;
    A[best] = tmp;

    const piv = A[row]![col]!;
    for (let c = col; c < m; c++) {
      A[row]![c]! /= piv;
    }
    for (let k = 0; k < r; k++) {
      if (k === row) continue;
      const factor = A[k]![col]!;
      if (Math.abs(factor) < 1e-9) continue;
      for (let c = col; c < m; c++) {
        A[k]![c]! -= factor * A[row]![c]!;
      }
    }
    pivotColForRow.push(col);
    isPivotCol[col] = true;
    row++;
  }

  const moieties: string[] = [];
  for (let freeCol = 0; freeCol < m; freeCol++) {
    if (isPivotCol[freeCol]) continue;
    const vec = new Array<number>(m).fill(0);
    vec[freeCol] = 1;
    for (let pIdx = 0; pIdx < pivotColForRow.length; pIdx++) {
      const pCol = pivotColForRow[pIdx]!;
      vec[pCol] = -A[pIdx]![freeCol]!;
    }
    // Prefer non-negative pool representation if all non-zero entries share sign
    const nonZero = vec.filter((v) => Math.abs(v) > 1e-6);
    if (nonZero.length < 2) continue;
    if (nonZero.every((v) => v < 0)) {
      for (let i = 0; i < m; i++) vec[i] = -vec[i]!;
    }

    const terms: string[] = [];
    for (let i = 0; i < m; i++) {
      const val = Math.round(vec[i]! * 100) / 100;
      if (Math.abs(val) < 1e-6) continue;
      const absVal = Math.abs(val);
      const prefix = terms.length === 0 ? (val < 0 ? "-" : "") : val < 0 ? " - " : " + ";
      const coeffStr = Math.abs(absVal - 1) < 1e-6 ? "" : `${absVal}·`;
      terms.push(`${prefix}${coeffStr}[${species[i]}]`);
    }
    if (terms.length >= 2) {
      moieties.push(`${terms.join("")} = const`);
    }
  }
  return moieties;
}

export function analyzeBiochemStoichiometry(code: string, lines: string[]): BiochemSummary {
  const reactions: ParsedReaction[] = [];
  const speciesOrder: string[] = [];
  const speciesSet = new Set<string>();

  const registerSpecies = (name: string) => {
    if (!speciesSet.has(name)) {
      speciesSet.add(name);
      speciesOrder.push(name);
    }
  };

  // 1. SBML XML parsing (<species>, <reaction>, <listOfReactants>, <listOfProducts>)
  if (code.includes("<sbml") || code.includes("<listOfReactions") || code.includes("<reaction")) {
    const spRe = /<species\b([^>]*)\/?>/gi;
    let m: RegExpExecArray | null;
    while ((m = spRe.exec(code)) !== null) {
      const boundary = /\bboundaryCondition\s*=\s*["']true["']/i.test(m[1]!);
      const id = /\bid\s*=\s*["']([^"']+)["']/i.exec(m[1]!)?.[1];
      if (id && !boundary) registerSpecies(id);
    }

    const rxnRe = /<reaction\b([^>]*)>([\s\S]*?)<\/reaction>/gi;
    while ((m = rxnRe.exec(code)) !== null) {
      const attrs = m[1]!;
      const body = m[2]!;
      const id = /\bid\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] ?? `R${reactions.length + 1}`;
      const reversible = !/\breversible\s*=\s*["']false["']/i.test(attrs);
      const line = code.slice(0, m.index).split("\n").length;

      const parseRefBlock = (tag: string) => {
        const block = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i").exec(body)?.[1] ?? "";
        const refRe = /<speciesReference\b([^>]*)\/?>/gi;
        const list: Array<{ species: string; coeff: number }> = [];
        let rm: RegExpExecArray | null;
        while ((rm = refRe.exec(block)) !== null) {
          const sp = /\bspecies\s*=\s*["']([^"']+)["']/i.exec(rm[1]!)?.[1];
          const coeff = Number(/\bstoichiometry\s*=\s*["']([^"']+)["']/i.exec(rm[1]!)?.[1] ?? 1);
          if (sp) {
            registerSpecies(sp);
            list.push({ species: sp, coeff });
          }
        }
        return list;
      };

      const reactants = parseRefBlock("listOfReactants");
      const products = parseRefBlock("listOfProducts");
      if (reactants.length > 0 || products.length > 0) {
        reactions.push({ id, reversible, reactants, products, line });
      }
    }
  }

  // 2. Antimony / Cantera / BNGL line-based reactions
  if (reactions.length === 0) {
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i]!.trim();
      if (!t || t.startsWith("#") || t.startsWith("//")) continue;

      // Cantera: equation: '2 H2 + O2 <=> 2 H2O' or reaction('A + B => C', ...)
      const canteraM = /(?:equation\s*:\s*|reaction\s*\(\s*)["']([^"']+)["']/i.exec(t);
      const candidate = canteraM ? canteraM[1]! : t;

      const arrowM = /^(?:([A-Za-z0-9_]+)\s*:\s*)?([^;=-]+?)(<=>|<->|=>|->)([^;]+)(?:;\s*(.*))?$/.exec(candidate);
      if (arrowM) {
        const id = arrowM[1]?.trim() || `R${reactions.length + 1}`;
        const lhs = parseStoichSide(arrowM[2]!);
        const arrow = arrowM[3]!;
        const rhs = parseStoichSide(arrowM[4]!);
        const kineticLaw = arrowM[5]?.trim();
        if (lhs.length > 0 || rhs.length > 0) {
          for (const item of lhs) registerSpecies(item.species);
          for (const item of rhs) registerSpecies(item.species);
          reactions.push({
            id,
            reversible: arrow === "<=>" || arrow === "<->",
            reactants: lhs,
            products: rhs,
            ...(kineticLaw ? { kineticLaw } : {}),
            line: i + 1,
          });
        }
      }
    }
  }

  // 3. SMILES single-line molecule check when no reactions exist
  let smilesFormula: BiochemSummary["smilesFormula"];
  if (reactions.length === 0) {
    const firstNonComment = lines
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith("#") && !l.startsWith("//") && !l.startsWith("<"));
    if (firstNonComment && /^[BCNOPSFIbcnops0-9@+\-[\]()=#/\\.%]+$/.test(firstNonComment.split(/\s+/)[0]!)) {
      const smiles = firstNonComment.split(/\s+/)[0]!;
      const counts: Record<string, number> = {};
      const atomRe = /Cl|Br|[BCNOPSFI]|[bcnops]/g;
      let am: RegExpExecArray | null;
      while ((am = atomRe.exec(smiles)) !== null) {
        const sym = am[0]!.length === 1 ? am[0]!.toUpperCase() : am[0]!;
        counts[sym] = (counts[sym] ?? 0) + 1;
      }
      const weights: Record<string, number> = {
        C: 12.011,
        N: 14.007,
        O: 15.999,
        P: 30.974,
        S: 32.06,
        F: 18.998,
        Cl: 35.45,
        Br: 79.904,
        I: 126.9,
        B: 10.81,
      };
      let approxMw = 0;
      const formulaParts: string[] = [];
      for (const [el, cnt] of Object.entries(counts)) {
        formulaParts.push(cnt > 1 ? `${el}${cnt}` : el);
        approxMw += (weights[el] ?? 12) * cnt;
      }
      smilesFormula = { smiles, formula: formulaParts.join(""), approxMw: Number(approxMw.toFixed(2)) };
    }
  }

  // Build S (species x reactions)
  const spIndex = new Map(speciesOrder.map((s, idx) => [s, idx]));
  const stoichMatrix: number[][] = Array.from({ length: speciesOrder.length }, () =>
    new Array<number>(reactions.length).fill(0),
  );

  for (let j = 0; j < reactions.length; j++) {
    const rxn = reactions[j]!;
    for (const r of rxn.reactants) {
      const idx = spIndex.get(r.species);
      if (idx !== undefined) stoichMatrix[idx]![j]! -= r.coeff;
    }
    for (const p of rxn.products) {
      const idx = spIndex.get(p.species);
      if (idx !== undefined) stoichMatrix[idx]![j]! += p.coeff;
    }
  }

  const conservedMoieties = computeConservedMoieties(speciesOrder, stoichMatrix);

  return {
    species: speciesOrder,
    reactions,
    stoichMatrix,
    conservedMoieties,
    ...(smilesFormula ? { smilesFormula } : {}),
  };
}

export const BiochemInspector: React.FC<BiochemInspectorProps> = ({ code, lines, colorMode, onRevealLine }) => {
  const isDark = colorMode === "dark";
  const [subView, setSubView] = useState<"stoich" | "pathway" | "moieties">("stoich");

  const borderCol = isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)";
  const cardBg = isDark ? "rgba(22, 27, 34, 0.7)" : "rgba(255, 255, 255, 0.9)";
  const textPrimary = isDark ? "#e6edf3" : "#1f2328";
  const textMuted = isDark ? "#8b949e" : "#59636e";

  const { species, reactions, stoichMatrix, conservedMoieties, smilesFormula } = useMemo(
    () => analyzeBiochemStoichiometry(code, lines),
    [code, lines],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {[
          { id: "stoich", label: `🧬 Stoichiometric Matrix S (${species.length}×${reactions.length})` },
          { id: "pathway", label: `🕸️ Reaction Flux Graph (${reactions.length})` },
          { id: "moieties", label: `⚖️ Conserved Moieties (${conservedMoieties.length})` },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSubView(t.id as typeof subView)}
            style={{
              padding: "6px 12px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 6,
              border: `1px solid ${borderCol}`,
              cursor: "pointer",
              backgroundColor: subView === t.id ? "#1f6feb" : cardBg,
              color: subView === t.id ? "#ffffff" : textPrimary,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {smilesFormula && (
        <div style={{ padding: 12, borderRadius: 8, border: `1px solid ${borderCol}`, backgroundColor: cardBg }}>
          <div style={{ fontWeight: 700, fontSize: 12, color: "#58a6ff" }}>
            SMILES Molecular Structure Detected: <code>{smilesFormula.smiles}</code>
          </div>
          <div style={{ fontSize: 12, color: textMuted, marginTop: 4, fontFamily: "monospace" }}>
            Heavy-Atom Formula: {smilesFormula.formula} | Heavy-Atom Mass: {smilesFormula.approxMw} g/mol
          </div>
        </div>
      )}

      {subView === "stoich" && (
        <div style={{ padding: 14, borderRadius: 8, border: `1px solid ${borderCol}`, backgroundColor: cardBg }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>
            Species × Reactions Stoichiometric Matrix S (d[X]/dt = S · v(X))
          </div>
          {species.length === 0 || reactions.length === 0 ? (
            <div style={{ fontSize: 12, color: textMuted }}>
              No biochemical reactions (SBML, Antimony, Cantera, BNGL) detected in the active buffer.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: "monospace" }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${borderCol}`, color: textMuted, textAlign: "left" }}>
                    <th style={{ padding: "6px 8px" }}>Species \ Reaction</th>
                    {reactions.map((rxn) => (
                      <th
                        key={rxn.id}
                        onClick={() => onRevealLine?.(rxn.line, rxn.id)}
                        style={{ padding: "6px 8px", cursor: "pointer", color: "#58a6ff" }}
                      >
                        {rxn.id}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {species.map((sp, sIdx) => (
                    <tr key={sp} style={{ borderBottom: `1px solid ${borderCol}` }}>
                      <td style={{ padding: "6px 8px", fontWeight: 700, color: textPrimary }}>{sp}</td>
                      {reactions.map((rxn, rIdx) => {
                        const coeff = stoichMatrix[sIdx]![rIdx]!;
                        return (
                          <td
                            key={rxn.id}
                            style={{
                              padding: "6px 8px",
                              fontWeight: coeff !== 0 ? 700 : 400,
                              color: coeff > 0 ? "#3fb950" : coeff < 0 ? "#f85149" : textMuted,
                            }}
                          >
                            {coeff > 0 ? `+${coeff}` : coeff === 0 ? "0" : String(coeff)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {subView === "pathway" && (
        <div style={{ padding: 14, borderRadius: 8, border: `1px solid ${borderCol}`, backgroundColor: cardBg }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>
            Bipartite Metabolic & Chemical Reaction Pathway Graph
          </div>
          {reactions.length === 0 ? (
            <div style={{ fontSize: 12, color: textMuted }}>No reaction steps to visualize.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {reactions.map((rxn) => (
                <div
                  key={rxn.id}
                  onClick={() => onRevealLine?.(rxn.line, rxn.id)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 6,
                    border: `1px solid ${borderCol}`,
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    fontSize: 11,
                    fontFamily: "monospace",
                    gap: 10,
                  }}
                >
                  <div>
                    <span style={{ color: "#f85149" }}>
                      {rxn.reactants.map((r) => (r.coeff !== 1 ? `${r.coeff} ${r.species}` : r.species)).join(" + ") ||
                        "∅"}
                    </span>
                    <span style={{ color: "#58a6ff", fontWeight: 700, margin: "0 8px" }}>
                      {rxn.reversible ? `⇄ [${rxn.id}] ⇄` : `──[${rxn.id}]──▶`}
                    </span>
                    <span style={{ color: "#3fb950" }}>
                      {rxn.products.map((p) => (p.coeff !== 1 ? `${p.coeff} ${p.species}` : p.species)).join(" + ") ||
                        "∅"}
                    </span>
                  </div>
                  <span style={{ color: textMuted }}>{rxn.kineticLaw ?? `L${rxn.line}`}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {subView === "moieties" && (
        <div style={{ padding: 14, borderRadius: 8, border: `1px solid ${borderCol}`, backgroundColor: cardBg }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>
            Left-Nullspace Moiety Conservation Invariants (cᵀ · S = 0)
          </div>
          {conservedMoieties.length === 0 ? (
            <div style={{ fontSize: 12, color: textMuted }}>
              {reactions.length === 0
                ? "No stoichiometric matrix available."
                : "Full row-rank stoichiometric matrix (dim ker(Sᵀ) = 0) — all declared species vary independently without closed moiety pools."}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {conservedMoieties.map((inv, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 6,
                    border: `1px solid ${borderCol}`,
                    fontFamily: "monospace",
                    fontSize: 12,
                    color: "#3fb950",
                    fontWeight: 600,
                  }}
                >
                  ✓ Pool #{idx + 1}: {inv}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
