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

      // Simple free-field comma-separated Nastran parser
      const tokens = line.split(/,|\s+/).map((t) => t.trim());
      const card = tokens[0].toUpperCase();

      if (card === "GRID" && tokens.length >= 6) {
        const id = parseInt(tokens[1], 10);
        const x = parseFloat(tokens[3]);
        const y = parseFloat(tokens[4]);
        const z = parseFloat(tokens[5]);
        if (!isNaN(id)) {
          data.nodes.set(id, { id, x, y, z });
        }
      }
    }

    return data;
  }
}
