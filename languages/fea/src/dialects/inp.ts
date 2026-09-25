// SPDX-License-Identifier: AGPL-3.0-or-later

import { materializeFeaDeck } from "../materializer.js";
import type { FeaDialect, FeaElement, FeaMaterial, FeaModelData, FeaNode, MaterializeOptions } from "../types.js";

/**
 * Abaqus / CalculiX (.inp) FEA deck dialect implementation.
 */
export class InpDialect implements FeaDialect {
  public readonly id = "inp";
  public readonly name = "Abaqus / CalculiX Input Deck";
  public readonly extensions = [".inp"];

  public materialize(templateText: string, options?: MaterializeOptions): string {
    return materializeFeaDeck(templateText, options);
  }

  public parse(deckText: string): FeaModelData {
    const lines = deckText.split(/\r?\n/);

    const data: FeaModelData = {
      dialect: this.id,
      nodes: new Map<number, FeaNode>(),
      elements: new Map<number, FeaElement>(),
      nodeSets: new Map<string, Set<number>>(),
      elementSets: new Map<string, Set<number>>(),
      materials: new Map<string, FeaMaterial>(),
      fixedNodes: new Set<number>(),
      nodalLoads: new Map<number, [number, number, number]>(),
    };

    let currentSection = "";
    let currentOptions: Record<string, string> = {};
    let activeMaterial: FeaMaterial | null = null;

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i].trim();
      if (!rawLine || rawLine.startsWith("**")) {
        continue;
      }

      if (rawLine.startsWith("*")) {
        const parts = rawLine
          .substring(1)
          .split(",")
          .map((s) => s.trim());
        const keyword = parts[0].toUpperCase();
        currentSection = keyword;
        currentOptions = {};

        for (let p = 1; p < parts.length; p++) {
          const opt = parts[p];
          if (opt.includes("=")) {
            const [k, v] = opt.split("=").map((s) => s.trim());
            currentOptions[k.toUpperCase()] = v;
          } else {
            currentOptions[opt.toUpperCase()] = "TRUE";
          }
        }

        if (keyword === "HEADING") {
          if (i + 1 < lines.length && !lines[i + 1].trim().startsWith("*")) {
            data.heading = lines[++i].trim();
          }
        } else if (keyword === "MATERIAL") {
          const matName = currentOptions["NAME"] || "DEFAULT_MATERIAL";
          activeMaterial = { name: matName };
          data.materials.set(matName, activeMaterial);
        }

        continue;
      }

      // Data lines
      const tokens = rawLine.split(",").map((s) => s.trim());

      if (currentSection === "NODE") {
        if (tokens.length >= 4) {
          const id = parseInt(tokens[0], 10);
          const x = parseFloat(tokens[1]);
          const y = parseFloat(tokens[2]);
          const z = parseFloat(tokens[3]);
          if (!isNaN(id) && !isNaN(x) && !isNaN(y) && !isNaN(z)) {
            data.nodes.set(id, { id, x, y, z });

            if (currentOptions["NSET"]) {
              const setName = currentOptions["NSET"].toUpperCase();
              if (!data.nodeSets.has(setName)) data.nodeSets.set(setName, new Set());
              data.nodeSets.get(setName)!.add(id);
            }
          }
        }
      } else if (currentSection === "ELEMENT") {
        if (tokens.length >= 2) {
          const id = parseInt(tokens[0], 10);
          const nodeIds = tokens
            .slice(1)
            .map((s) => parseInt(s, 10))
            .filter((n) => !isNaN(n));
          const type = currentOptions["TYPE"] || "C3D4";
          if (!isNaN(id) && nodeIds.length > 0) {
            data.elements.set(id, { id, type, nodes: nodeIds, elset: currentOptions["ELSET"] });

            if (currentOptions["ELSET"]) {
              const setName = currentOptions["ELSET"].toUpperCase();
              if (!data.elementSets.has(setName)) data.elementSets.set(setName, new Set());
              data.elementSets.get(setName)!.add(id);
            }
          }
        }
      } else if (currentSection === "NSET") {
        const setName = (currentOptions["NSET"] || tokens[0]).toUpperCase();
        if (!data.nodeSets.has(setName)) data.nodeSets.set(setName, new Set());
        const set = data.nodeSets.get(setName)!;
        for (const t of tokens) {
          const nid = parseInt(t, 10);
          if (!isNaN(nid)) set.add(nid);
        }
      } else if (currentSection === "ELASTIC" && activeMaterial) {
        if (tokens.length >= 2) {
          activeMaterial.E = parseFloat(tokens[0]);
          activeMaterial.nu = parseFloat(tokens[1]);
        }
      } else if (currentSection === "DENSITY" && activeMaterial) {
        if (tokens.length >= 1) {
          activeMaterial.rho = parseFloat(tokens[0]);
        }
      } else if (currentSection === "BOUNDARY") {
        if (tokens.length >= 1) {
          const target = tokens[0];
          const numId = parseInt(target, 10);
          if (!isNaN(numId)) {
            data.fixedNodes.add(numId);
          } else {
            const nset = data.nodeSets.get(target.toUpperCase());
            if (nset) {
              for (const nid of nset) {
                data.fixedNodes.add(nid);
              }
            }
          }
        }
      } else if (currentSection === "CLOAD") {
        if (tokens.length >= 3) {
          const target = tokens[0];
          const dof = parseInt(tokens[1], 10);
          const mag = parseFloat(tokens[2]);

          const applyLoad = (nid: number) => {
            if (!data.nodalLoads.has(nid)) data.nodalLoads.set(nid, [0, 0, 0]);
            const loadVec = data.nodalLoads.get(nid)!;
            if (dof === 1) loadVec[0] += mag;
            else if (dof === 2) loadVec[1] += mag;
            else if (dof === 3) loadVec[2] += mag;
          };

          const numId = parseInt(target, 10);
          if (!isNaN(numId)) {
            applyLoad(numId);
          } else {
            const nset = data.nodeSets.get(target.toUpperCase());
            if (nset && nset.size > 0) {
              const perNode = mag / nset.size;
              for (const nid of nset) {
                if (!data.nodalLoads.has(nid)) data.nodalLoads.set(nid, [0, 0, 0]);
                const vec = data.nodalLoads.get(nid)!;
                if (dof === 1) vec[0] += perNode;
                else if (dof === 2) vec[1] += perNode;
                else if (dof === 3) vec[2] += perNode;
              }
            }
          }
        }
      }
    }

    return data;
  }
}

/**
 * Convenience helper to parse an Abaqus / CalculiX (.inp) deck.
 */
export function parseInpDeck(deckText: string): FeaModelData {
  return new InpDialect().parse(deckText);
}

/**
 * Convenience helper to materialize an Abaqus / CalculiX (.inp) deck template.
 */
export function materializeCalculixDeck(templateText: string, options?: MaterializeOptions): string {
  return new InpDialect().materialize(templateText, options);
}

export type InpDeckData = FeaModelData;
