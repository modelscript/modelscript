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

  public materialize(templateText: string, options?: MaterializeOptions): string {
    return materializeFeaDeck(templateText, options);
  }

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
      nodalLoads: new Map(),
    };

    function parseNastranFloat(val: string): number {
      const trimmed = val.trim();
      if (!trimmed) return NaN;
      if (!isNaN(Number(trimmed))) return Number(trimmed);
      // NASTRAN short-field format without 'E': e.g. 2.1+11, 1.5-4, .5+3
      const shortMatch = trimmed.match(/^([+-]?(?:\d+\.?\d*|\.\d+))([+-]\d+)$/);
      if (shortMatch) {
        return parseFloat(`${shortMatch[1]}e${shortMatch[2]}`);
      }
      return parseFloat(trimmed);
    }

    for (const rawLine of lines) {
      // Strip comments starting with $
      const commentIdx = rawLine.indexOf("$");
      const cleanLine = commentIdx !== -1 ? rawLine.slice(0, commentIdx) : rawLine;
      if (!cleanLine.trim()) continue;

      let tokens: string[];
      if (cleanLine.includes(",")) {
        tokens = cleanLine.split(",").map((t) => t.trim());
      } else if (cleanLine.length >= 8) {
        // Standard NASTRAN small field format: 8 characters per column
        tokens = [];
        tokens.push(cleanLine.slice(0, 8).trim());
        for (let i = 8; i < cleanLine.length; i += 8) {
          tokens.push(cleanLine.slice(i, i + 8).trim());
        }
      } else {
        tokens = cleanLine
          .trim()
          .split(/\s+/)
          .map((t) => t.trim());
      }
      if (tokens.length === 0 || !tokens[0]) continue;
      const card = tokens[0].toUpperCase();

      if (card === "GRID" && tokens.length >= 6) {
        const id = parseInt(tokens[1], 10);
        const x = parseNastranFloat(tokens[3]);
        const y = parseNastranFloat(tokens[4]);
        const z = parseNastranFloat(tokens[5]);
        if (!isNaN(id)) {
          data.nodes.set(id, { id, x: isNaN(x) ? 0 : x, y: isNaN(y) ? 0 : y, z: isNaN(z) ? 0 : z });
        }
      } else if (card === "CQUAD4" && tokens.length >= 6) {
        const id = parseInt(tokens[1], 10);
        const n1 = parseInt(tokens[3], 10);
        const n2 = parseInt(tokens[4], 10);
        const n3 = parseInt(tokens[5], 10);
        const n4 = parseInt(tokens[6], 10);
        if (!isNaN(id)) {
          data.elements.set(id, {
            id,
            type: "CQUAD4",
            family: "shell",
            nodes: [n1, n2, n3, n4].filter((n) => !isNaN(n)),
          });
        }
      } else if (card === "CTRIA3" && tokens.length >= 5) {
        const id = parseInt(tokens[1], 10);
        const n1 = parseInt(tokens[3], 10);
        const n2 = parseInt(tokens[4], 10);
        const n3 = parseInt(tokens[5], 10);
        if (!isNaN(id)) {
          data.elements.set(id, {
            id,
            type: "CTRIA3",
            family: "shell",
            nodes: [n1, n2, n3].filter((n) => !isNaN(n)),
          });
        }
      } else if (card === "CTETRA" && tokens.length >= 6) {
        const id = parseInt(tokens[1], 10);
        const n1 = parseInt(tokens[3], 10);
        const n2 = parseInt(tokens[4], 10);
        const n3 = parseInt(tokens[5], 10);
        const n4 = parseInt(tokens[6], 10);
        if (!isNaN(id)) {
          data.elements.set(id, {
            id,
            type: "CTETRA",
            family: "solid",
            nodes: [n1, n2, n3, n4].filter((n) => !isNaN(n)),
          });
        }
      } else if (card === "CHEXA" && tokens.length >= 10) {
        const id = parseInt(tokens[1], 10);
        const nodes = tokens
          .slice(3, 11)
          .map((t) => parseInt(t, 10))
          .filter((n) => !isNaN(n));
        if (!isNaN(id)) {
          data.elements.set(id, { id, type: "CHEXA", family: "solid", nodes });
        }
      } else if (card === "MAT1" && tokens.length >= 3) {
        const mid = tokens[1];
        const E = parseNastranFloat(tokens[2]);
        const nu = tokens.length >= 5 ? parseNastranFloat(tokens[4]) : undefined;
        const rho = tokens.length >= 6 ? parseNastranFloat(tokens[5]) : undefined;
        data.materials.set(mid, {
          name: mid,
          E: isNaN(E) ? undefined : E,
          nu: nu !== undefined && !isNaN(nu) ? nu : undefined,
          rho: rho !== undefined && !isNaN(rho) ? rho : undefined,
        });
      } else if ((card === "SPC" || card === "SPC1") && tokens.length >= 3) {
        const startIdx = card === "SPC1" ? 3 : 2;
        let lastGrid: number | null = null;
        for (let j = startIdx; j < tokens.length; j += card === "SPC" ? 3 : 1) {
          const tokenStr = tokens[j].toUpperCase();
          if (tokenStr === "THRU" && lastGrid !== null && j + 1 < tokens.length) {
            const endGrid = parseInt(tokens[j + 1], 10);
            if (!isNaN(endGrid) && endGrid >= lastGrid) {
              for (let g = lastGrid + 1; g <= endGrid; g++) {
                data.fixedNodes.add(g);
              }
            }
            j++; // skip next grid token
            continue;
          }
          const g = parseInt(tokenStr, 10);
          if (!isNaN(g)) {
            data.fixedNodes.add(g);
            lastGrid = g;
          }
        }
      } else if (card === "FORCE" && tokens.length >= 8) {
        const g = parseInt(tokens[2], 10);
        const f = parseNastranFloat(tokens[4]);
        const n1 = parseNastranFloat(tokens[5]) || 0;
        const n2 = parseNastranFloat(tokens[6]) || 0;
        const n3 = parseNastranFloat(tokens[7]) || 0;
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
