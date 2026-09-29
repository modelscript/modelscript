// SPDX-License-Identifier: AGPL-3.0-or-later

import { materializeFeaDeck } from "../materializer.js";
import type { FeaDialect, FeaModelData, FeaNode, MaterializeOptions } from "../types.js";

/**
 * Nastran Bulk Data (.bdf / .dat) FEA deck dialect implementation.
 */
export class BdfDialect implements FeaDialect {
  public readonly id = "bdf";
  public readonly name = "Nastran Bulk Data Deck";
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

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("$")) continue; // Comment

      let tokens: string[];
      if (line.includes(",")) {
        tokens = line.split(",").map((t) => t.trim());
      } else if (line.length >= 16 && !line.includes(" ")) {
        tokens = [];
        for (let i = 0; i < line.length; i += 8) {
          tokens.push(line.slice(i, i + 8).trim());
        }
      } else {
        tokens = line.split(/\s+/).map((t) => t.trim());
      }
      if (tokens.length === 0) continue;
      const card = tokens[0].toUpperCase();

      if (card === "GRID" && tokens.length >= 6) {
        const id = parseInt(tokens[1], 10);
        const x = parseFloat(tokens[3]);
        const y = parseFloat(tokens[4]);
        const z = parseFloat(tokens[5]);
        if (!isNaN(id)) {
          data.nodes.set(id, { id, x, y, z });
        }
      } else if (card === "CQUAD4" && tokens.length >= 6) {
        const id = parseInt(tokens[1], 10);
        const n1 = parseInt(tokens[3], 10);
        const n2 = parseInt(tokens[4], 10);
        const n3 = parseInt(tokens[5], 10);
        const n4 = parseInt(tokens[6], 10);
        if (!isNaN(id)) {
          data.elements.set(id, { id, type: "CQUAD4", nodes: [n1, n2, n3, n4].filter((n) => !isNaN(n)) });
        }
      } else if (card === "CTRIA3" && tokens.length >= 5) {
        const id = parseInt(tokens[1], 10);
        const n1 = parseInt(tokens[3], 10);
        const n2 = parseInt(tokens[4], 10);
        const n3 = parseInt(tokens[5], 10);
        if (!isNaN(id)) {
          data.elements.set(id, { id, type: "CTRIA3", nodes: [n1, n2, n3].filter((n) => !isNaN(n)) });
        }
      } else if (card === "CTETRA" && tokens.length >= 6) {
        const id = parseInt(tokens[1], 10);
        const n1 = parseInt(tokens[3], 10);
        const n2 = parseInt(tokens[4], 10);
        const n3 = parseInt(tokens[5], 10);
        const n4 = parseInt(tokens[6], 10);
        if (!isNaN(id)) {
          data.elements.set(id, { id, type: "CTETRA", nodes: [n1, n2, n3, n4].filter((n) => !isNaN(n)) });
        }
      } else if (card === "CHEXA" && tokens.length >= 10) {
        const id = parseInt(tokens[1], 10);
        const nodes = tokens
          .slice(3, 11)
          .map((t) => parseInt(t, 10))
          .filter((n) => !isNaN(n));
        if (!isNaN(id)) {
          data.elements.set(id, { id, type: "CHEXA", nodes });
        }
      } else if (card === "MAT1" && tokens.length >= 3) {
        const mid = tokens[1];
        const E = parseFloat(tokens[2]);
        const nu = tokens.length >= 5 ? parseFloat(tokens[4]) : undefined;
        const rho = tokens.length >= 6 ? parseFloat(tokens[5]) : undefined;
        data.materials.set(mid, {
          name: mid,
          E: isNaN(E) ? undefined : E,
          nu: nu !== undefined && !isNaN(nu) ? nu : undefined,
          rho: rho !== undefined && !isNaN(rho) ? rho : undefined,
        });
      } else if ((card === "SPC" || card === "SPC1") && tokens.length >= 3) {
        const startIdx = card === "SPC1" ? 3 : 2;
        for (let j = startIdx; j < tokens.length; j += card === "SPC" ? 3 : 1) {
          const g = parseInt(tokens[j], 10);
          if (!isNaN(g)) {
            data.fixedNodes.add(g);
          }
        }
      } else if (card === "FORCE" && tokens.length >= 8) {
        const g = parseInt(tokens[2], 10);
        const f = parseFloat(tokens[4]);
        const n1 = parseFloat(tokens[5]) || 0;
        const n2 = parseFloat(tokens[6]) || 0;
        const n3 = parseFloat(tokens[7]) || 0;
        if (!isNaN(g) && !isNaN(f)) {
          data.nodalLoads.set(g, [f * n1, f * n2, f * n3]);
        }
      }
    }

    return data;
  }
}
