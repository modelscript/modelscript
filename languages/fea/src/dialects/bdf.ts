// SPDX-License-Identifier: AGPL-3.0-or-later

import { materializeFeaDeck } from "../materializer.js";
import type { FeaDialect, FeaModelData, FeaNode, MaterializeOptions } from "../types.js";

/**
 * Bulk Data (.bdf / .dat) FEA deck dialect implementation.
 */
export class BdfDialect implements FeaDialect {
  public readonly id = "bdf";
  public readonly name = "FEA Bulk Data Deck (.bdf / .dat)";
  public readonly extensions = [".bdf", ".dat"];

  /**
   * Materializes a NASTRAN Bulk Data `.bdf` template by evaluating embedded `{{ ... }}` expressions.
   */
  public materialize(templateText: string, options?: MaterializeOptions): string {
    return materializeFeaDeck(templateText, options);
  }

  /**
   * Parses a NASTRAN Bulk Data (`.bdf` / `.dat`) deck (supporting both free-field comma-separated
   * and 8-column small-field formats with continuation cards) into `FeaModelData`.
   */
  public parse(deckText: string): FeaModelData {
    const lines = deckText.split(/\r?\n/);
    const data: FeaModelData = {
      dialect: this.id,
      nodes: new Map<number, FeaNode>(),
      elements: new Map(),
      nodeSets: new Map(),
      elementSets: new Map(),
      materials: new Map(),
      fixedNodes: new Set(),
      fixedDofs: new Map(),
      nodalLoads: new Map(),
      elsetMaterials: new Map(),
      sectionThickness: new Map(),
      beamAreas: new Map(),
    };

    /**
     * Parses a floating-point value supporting NASTRAN short-field scientific notation (e.g., `2.1+11` -> `2.1e11`).
     */
    function parseNastranFloat(val: string): number {
      const trimmed = val.trim();
      if (!trimmed) return NaN;
      if (!isNaN(Number(trimmed))) return Number(trimmed);
      // NASTRAN short-field format without 'E': e.g. 2.1+11, 1.5-4, .5+3
      const shortMatch = trimmed.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))([+-]\d+)$/);
      if (shortMatch) {
        return parseFloat(`${shortMatch[1]}e${shortMatch[2]}`);
      }
      return parseFloat(trimmed);
    }

    function parseComponentDofs(cField: string | undefined): number[] {
      const digits = (cField || "123456")
        .trim()
        .split("")
        .map((ch) => parseInt(ch, 10))
        .filter((d) => !isNaN(d) && d >= 1 && d <= 6);
      return digits.length > 0 ? digits : [1, 2, 3];
    }

    const cardTokensList: string[][] = [];
    for (const rawLine of lines) {
      // Strip comments starting with $
      const commentIdx = rawLine.indexOf("$");
      const cleanLine = commentIdx !== -1 ? rawLine.slice(0, commentIdx) : rawLine;
      if (!cleanLine.trim()) continue;

      const isContinuation =
        cleanLine.startsWith("+") ||
        cleanLine.startsWith("*") ||
        cleanLine.startsWith("        ") ||
        cleanLine.trimStart().startsWith(",");

      let tokens: string[];
      if (cleanLine.includes(",")) {
        tokens = cleanLine.split(",").map((t) => t.trim());
      } else if (cleanLine.length >= 8) {
        // Standard NASTRAN small field format: 8 characters per column (fields 1..9 in cols 0..72)
        tokens = [];
        const maxLen = Math.min(cleanLine.length, 72);
        for (let i = 0; i < maxLen; i += 8) {
          tokens.push(cleanLine.slice(i, i + 8).trim());
        }
      } else {
        tokens = cleanLine
          .trim()
          .split(/\s+/)
          .map((t) => t.trim());
      }

      if (isContinuation && cardTokensList.length > 0) {
        const prev = cardTokensList[cardTokensList.length - 1]!;
        // Remove trailing continuation marker on previous line if present (e.g. "+C1")
        if (
          prev.length >= 2 &&
          (prev[prev.length - 1]!.startsWith("+") ||
            prev[prev.length - 1]!.startsWith("*") ||
            prev[prev.length - 1] === "")
        ) {
          prev.pop();
        }
        // Skip leading continuation marker in tokens[0]
        prev.push(...tokens.slice(1));
      } else {
        cardTokensList.push(tokens);
      }
    }

    for (const tokens of cardTokensList) {
      if (tokens.length === 0 || !tokens[0]) continue;
      const card = tokens[0].toUpperCase();

      if (card === "GRID" && tokens.length >= 6) {
        const id = parseInt(tokens[1]!, 10);
        const x = parseNastranFloat(tokens[3]!);
        const y = parseNastranFloat(tokens[4]!);
        const z = parseNastranFloat(tokens[5]!);
        if (!isNaN(id)) {
          data.nodes.set(id, { id, x: isNaN(x) ? 0 : x, y: isNaN(y) ? 0 : y, z: isNaN(z) ? 0 : z });
        }
      } else if (card === "CQUAD4" && tokens.length >= 7) {
        const id = parseInt(tokens[1]!, 10);
        const n1 = parseInt(tokens[3]!, 10);
        const n2 = parseInt(tokens[4]!, 10);
        const n3 = parseInt(tokens[5]!, 10);
        const n4 = parseInt(tokens[6]!, 10);
        if (!isNaN(id)) {
          data.elements.set(id, {
            id,
            type: "CQUAD4",
            family: "shell",
            nodes: [n1, n2, n3, n4].filter((n) => !isNaN(n)),
          });
        }
      } else if (card === "CTRIA3" && tokens.length >= 6) {
        const id = parseInt(tokens[1]!, 10);
        const n1 = parseInt(tokens[3]!, 10);
        const n2 = parseInt(tokens[4]!, 10);
        const n3 = parseInt(tokens[5]!, 10);
        if (!isNaN(id)) {
          data.elements.set(id, {
            id,
            type: "CTRIA3",
            family: "shell",
            nodes: [n1, n2, n3].filter((n) => !isNaN(n)),
          });
        }
      } else if (card === "CTETRA" && tokens.length >= 7) {
        const id = parseInt(tokens[1]!, 10);
        const maxNodeIdx = tokens.length >= 13 ? 13 : 7;
        const nodes = tokens
          .slice(3, maxNodeIdx)
          .map((t) => parseInt(t, 10))
          .filter((n) => !isNaN(n));
        if (!isNaN(id) && (nodes.length === 4 || nodes.length === 10)) {
          data.elements.set(id, {
            id,
            type: nodes.length === 10 ? "C3D10" : "CTETRA",
            family: "solid",
            nodes,
          });
        }
      } else if (card === "CHEXA" && tokens.length >= 11) {
        const id = parseInt(tokens[1]!, 10);
        const maxNodeIdx = tokens.length >= 23 ? 23 : tokens.length;
        const nodes = tokens
          .slice(3, maxNodeIdx)
          .map((t) => parseInt(t, 10))
          .filter((n) => !isNaN(n));
        if (!isNaN(id) && nodes.length >= 8) {
          data.elements.set(id, { id, type: "CHEXA", family: "solid", nodes });
        }
      } else if (card === "CPENTA" && tokens.length >= 9) {
        const id = parseInt(tokens[1]!, 10);
        const maxNodeIdx = tokens.length >= 18 ? 18 : 9;
        const nodes = tokens
          .slice(3, maxNodeIdx)
          .map((t) => parseInt(t, 10))
          .filter((n) => !isNaN(n));
        if (!isNaN(id) && nodes.length >= 6) {
          data.elements.set(id, { id, type: "CPENTA", family: "solid", nodes });
        }
      } else if ((card === "CBAR" || card === "CBEAM" || card === "CROD") && tokens.length >= 5) {
        const id = parseInt(tokens[1]!, 10);
        const n1 = parseInt(tokens[3]!, 10);
        const n2 = parseInt(tokens[4]!, 10);
        if (!isNaN(id) && !isNaN(n1) && !isNaN(n2)) {
          data.elements.set(id, {
            id,
            type: card,
            family: card === "CROD" ? "truss" : "beam",
            nodes: [n1, n2],
          });
        }
      } else if (card === "CONROD" && tokens.length >= 4) {
        const id = parseInt(tokens[1]!, 10);
        const n1 = parseInt(tokens[2]!, 10);
        const n2 = parseInt(tokens[3]!, 10);
        if (!isNaN(id) && !isNaN(n1) && !isNaN(n2)) {
          data.elements.set(id, {
            id,
            type: "CROD",
            family: "truss",
            nodes: [n1, n2],
          });
        }
      } else if (card === "MAT1" && tokens.length >= 3) {
        const mid = tokens[1]!;
        const E = parseNastranFloat(tokens[2]!);
        const nu = tokens.length >= 5 ? parseNastranFloat(tokens[4]!) : undefined;
        const rho = tokens.length >= 6 ? parseNastranFloat(tokens[5]!) : undefined;
        data.materials.set(mid, {
          name: mid,
          E: isNaN(E) ? undefined : E,
          nu: nu !== undefined && !isNaN(nu) ? nu : undefined,
          rho: rho !== undefined && !isNaN(rho) ? rho : undefined,
        });
      } else if (card === "SPC1" && tokens.length >= 4) {
        const compDofs = parseComponentDofs(tokens[2]);
        const applyFixedDofs = (g: number) => {
          data.fixedNodes.add(g);
          if (!data.fixedDofs!.has(g)) data.fixedDofs!.set(g, new Set());
          const set = data.fixedDofs!.get(g)!;
          for (const d of compDofs) set.add(d);
        };
        let lastGrid: number | null = null;
        for (let j = 3; j < tokens.length; j++) {
          const tokenStr = tokens[j]!.toUpperCase();
          if (tokenStr === "THRU" && lastGrid !== null && j + 1 < tokens.length) {
            const endGrid = parseInt(tokens[j + 1]!, 10);
            if (!isNaN(endGrid) && endGrid >= lastGrid) {
              for (let g = lastGrid + 1; g <= endGrid; g++) {
                applyFixedDofs(g);
              }
            }
            j++; // skip next grid token
            continue;
          }
          const g = parseInt(tokenStr, 10);
          if (!isNaN(g)) {
            applyFixedDofs(g);
            lastGrid = g;
          }
        }
      } else if (card === "SPC" && tokens.length >= 4) {
        for (let j = 2; j < tokens.length; j += 3) {
          const g = parseInt(tokens[j]!, 10);
          if (isNaN(g)) continue;
          const compDofs = parseComponentDofs(tokens[j + 1]);
          const dispVal = j + 2 < tokens.length && tokens[j + 2] !== "" ? parseNastranFloat(tokens[j + 2]!) : 0.0;
          if (!isNaN(dispVal) && Math.abs(dispVal) > 0) {
            if (!data.displacements) data.displacements = new Map();
            if (!data.displacements.has(g)) data.displacements.set(g, [0, 0, 0]);
            if (!data.prescribedDisplacements) data.prescribedDisplacements = new Map();
            if (!data.prescribedDisplacements.has(g)) data.prescribedDisplacements.set(g, new Map());
            const vec = data.displacements.get(g)!;
            const dofMap = data.prescribedDisplacements.get(g)!;
            for (const d of compDofs) {
              if (d >= 1 && d <= 3) {
                vec[d - 1] = dispVal;
                dofMap.set(d, dispVal);
              }
            }
          } else {
            data.fixedNodes.add(g);
            if (!data.fixedDofs!.has(g)) data.fixedDofs!.set(g, new Set());
            const set = data.fixedDofs!.get(g)!;
            for (const d of compDofs) set.add(d);
          }
        }
      } else if (card === "FORCE" && tokens.length >= 8) {
        const g = parseInt(tokens[2]!, 10);
        const f = parseNastranFloat(tokens[4]!);
        const n1 = parseNastranFloat(tokens[5]!) || 0;
        const n2 = parseNastranFloat(tokens[6]!) || 0;
        const n3 = parseNastranFloat(tokens[7]!) || 0;
        if (!isNaN(g) && !isNaN(f)) {
          if (!data.nodalLoads.has(g)) data.nodalLoads.set(g, [0, 0, 0]);
          const loadVec = data.nodalLoads.get(g)!;
          loadVec[0] += f * n1;
          loadVec[1] += f * n2;
          loadVec[2] += f * n3;
        }
      }
    }

    return data;
  }
}
