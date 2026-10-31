// SPDX-License-Identifier: AGPL-3.0-or-later

import { materializeFeaDeck } from "../materializer.js";
import type { FeaDialect, FeaElement, FeaMaterial, FeaModelData, FeaNode, MaterializeOptions } from "../types.js";

/**
 * Standard FEA Input Deck (.inp) / CalculiX dialect implementation.
 */
export class InpDialect implements FeaDialect {
  public readonly id = "inp";
  public readonly name = "Standard FEA Input Deck (.inp) / CalculiX";
  public readonly extensions = [".inp"];

  /**
   * Materializes an Abaqus/CalculiX `.inpt` template by evaluating embedded `{{ ... }}` expressions.
   */
  public materialize(templateText: string, options?: MaterializeOptions): string {
    return materializeFeaDeck(templateText, options);
  }

  /**
   * Parses an Abaqus/CalculiX `.inp` input deck into nodes, elements, node/element sets,
   * material constitutive properties, fixed boundary conditions, and nodal loads.
   */
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
      fixedDofs: new Map<number, Set<number>>(),
      nodalLoads: new Map<number, [number, number, number]>(),
      elsetMaterials: new Map<string, string>(),
      sectionThickness: new Map<string, number>(),
      beamAreas: new Map<string, number>(),
      nodeLines: new Map<number, number>(),
      elementLines: new Map<number, number>(),
      materialLines: new Map<string, number>(),
      sectionLines: new Map<string, number>(),
      boundaryLines: [],
    };

    let currentSection = "";
    let currentOptions: Record<string, string> = {};
    let activeMaterial: FeaMaterial | null = null;
    let lastElementId: number | null = null;
    let isElementContinuation = false;

    /**
     * Classifies an Abaqus/CalculiX element type code (e.g., `C3D8`, `S4`, `B31`, `T3D2`) into its structural family.
     */
    function inferElementFamily(type: string): "solid" | "shell" | "beam" | "truss" | "other" {
      const t = type.toUpperCase();
      if (t.startsWith("C3D") || t.includes("TET") || t.includes("HEX") || t.includes("PENT") || t.includes("WEDGE")) {
        return "solid";
      }
      if (
        t.startsWith("S") ||
        t.startsWith("CPS") ||
        t.startsWith("CPE") ||
        t.startsWith("CAX") ||
        t.includes("SHELL") ||
        t.includes("QUAD") ||
        t.includes("TRIA")
      ) {
        return "shell";
      }
      if (t.startsWith("B") || t.includes("BEAM")) {
        return "beam";
      }
      if (t.startsWith("T") || t.includes("TRUSS") || t.includes("ROD")) {
        return "truss";
      }
      return "other";
    }

    const SYMBOLIC_BOUNDARY_DOFS: Record<string, number[]> = {
      ENCASTRE: [1, 2, 3, 4, 5, 6],
      PINNED: [1, 2, 3],
      XSYMM: [1, 5, 6],
      YSymm: [2, 4, 6],
      YSYMM: [2, 4, 6],
      ZSYMM: [3, 4, 5],
      XASYMM: [2, 3, 4],
      YASYMM: [1, 3, 5],
      ZASYMM: [1, 2, 6],
    };

    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1;
      const rawLine = lines[i]!.trim();
      if (!rawLine || rawLine.startsWith("**")) {
        continue;
      }

      if (rawLine.startsWith("*")) {
        lastElementId = null;
        isElementContinuation = false;
        const parts = rawLine
          .substring(1)
          .split(",")
          .map((s) => s.trim());
        const keyword = parts[0]!.toUpperCase();
        currentSection = keyword;
        currentOptions = {};

        for (let p = 1; p < parts.length; p++) {
          const opt = parts[p]!;
          if (opt.includes("=")) {
            const [k, v] = opt.split("=").map((s) => s.trim());
            currentOptions[k!.toUpperCase()] = v!;
          } else {
            currentOptions[opt.toUpperCase()] = "TRUE";
          }
        }

        if (keyword === "HEADING") {
          if (i + 1 < lines.length && !lines[i + 1]!.trim().startsWith("*")) {
            data.heading = lines[++i]!.trim();
          }
        } else if (keyword === "MATERIAL") {
          const matName = currentOptions["NAME"] || "DEFAULT_MATERIAL";
          activeMaterial = { name: matName };
          data.materials.set(matName, activeMaterial);
          data.materialLines!.set(matName, lineNum);
        } else if (keyword === "SOLID SECTION" || keyword === "SHELL SECTION" || keyword === "BEAM SECTION") {
          const elset = currentOptions["ELSET"];
          const matName = currentOptions["MATERIAL"];
          if (elset) {
            data.sectionLines!.set(elset.toUpperCase(), lineNum);
            if (matName) {
              data.elsetMaterials!.set(elset.toUpperCase(), matName);
            }
          }
        } else if (keyword === "BOUNDARY") {
          data.boundaryLines!.push(lineNum);
        }

        continue;
      }

      // Data lines
      const endsWithComma = rawLine.endsWith(",");
      const cleanLine = endsWithComma ? rawLine.slice(0, -1).trim() : rawLine;
      const tokens = cleanLine.split(",").map((s) => s.trim());

      if (currentSection === "NODE") {
        if (tokens.length >= 3) {
          const id = parseInt(tokens[0]!, 10);
          const x = parseFloat(tokens[1]!);
          const y = parseFloat(tokens[2]!);
          const z = tokens.length >= 4 ? parseFloat(tokens[3]!) : 0.0;
          if (!isNaN(id) && !isNaN(x) && !isNaN(y) && !isNaN(z)) {
            data.nodes.set(id, { id, x, y, z });
            data.nodeLines!.set(id, lineNum);

            if (currentOptions["NSET"]) {
              const setName = currentOptions["NSET"].toUpperCase();
              if (!data.nodeSets.has(setName)) data.nodeSets.set(setName, new Set());
              data.nodeSets.get(setName)!.add(id);
            }
          }
        }
      } else if (currentSection === "ELEMENT") {
        if (isElementContinuation && lastElementId !== null && data.elements.has(lastElementId)) {
          const elem = data.elements.get(lastElementId)!;
          const continuedNodes = tokens.map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));
          elem.nodes.push(...continuedNodes);
        } else if (tokens.length >= 2) {
          const id = parseInt(tokens[0]!, 10);
          const nodeIds = tokens
            .slice(1)
            .map((s) => parseInt(s, 10))
            .filter((n) => !isNaN(n));
          const type = currentOptions["TYPE"] || "C3D4";
          const family = inferElementFamily(type);
          if (!isNaN(id) && nodeIds.length > 0) {
            data.elements.set(id, { id, type, nodes: nodeIds, elset: currentOptions["ELSET"], family });
            data.elementLines!.set(id, lineNum);
            lastElementId = id;

            if (currentOptions["ELSET"]) {
              const setName = currentOptions["ELSET"].toUpperCase();
              if (!data.elementSets.has(setName)) data.elementSets.set(setName, new Set());
              data.elementSets.get(setName)!.add(id);
            }
          }
        }
        isElementContinuation = endsWithComma;
      } else if (currentSection === "NSET") {
        const setName = (currentOptions["NSET"]! || tokens[0]!).toUpperCase();
        if (!data.nodeSets.has(setName)) data.nodeSets.set(setName, new Set());
        const set = data.nodeSets.get(setName)!;
        const isGenerate = "GENERATE" in currentOptions || currentOptions["GENERATE"] === "TRUE";
        const valTokens = !currentOptions["NSET"]! ? tokens.slice(1) : tokens;
        if (isGenerate && valTokens.length >= 2) {
          const start = parseInt(valTokens[0]!, 10);
          const end = parseInt(valTokens[1]!, 10);
          const step = valTokens.length >= 3 ? parseInt(valTokens[2]!, 10) : 1;
          if (!isNaN(start) && !isNaN(end)) {
            const actualStep = !isNaN(step) && step > 0 ? step : 1;
            for (let nid = start; nid <= end; nid += actualStep) {
              set.add(nid);
            }
          }
        } else {
          for (const t of valTokens) {
            const nid = parseInt(t, 10);
            if (!isNaN(nid)) set.add(nid);
          }
        }
      } else if (currentSection === "ELSET") {
        const setName = (currentOptions["ELSET"]! || tokens[0]!).toUpperCase();
        if (!data.elementSets.has(setName)) data.elementSets.set(setName, new Set());
        const set = data.elementSets.get(setName)!;
        const isGenerate = "GENERATE" in currentOptions || currentOptions["GENERATE"] === "TRUE";
        const valTokens = !currentOptions["ELSET"]! ? tokens.slice(1) : tokens;
        if (isGenerate && valTokens.length >= 2) {
          const start = parseInt(valTokens[0]!, 10);
          const end = parseInt(valTokens[1]!, 10);
          const step = valTokens.length >= 3 ? parseInt(valTokens[2]!, 10) : 1;
          if (!isNaN(start) && !isNaN(end)) {
            const actualStep = !isNaN(step) && step > 0 ? step : 1;
            for (let eid = start; eid <= end; eid += actualStep) {
              set.add(eid);
            }
          }
        } else {
          for (const t of valTokens) {
            const eid = parseInt(t, 10);
            if (!isNaN(eid)) set.add(eid);
          }
        }
      } else if (currentSection === "SHELL SECTION") {
        if (tokens.length >= 1 && currentOptions["ELSET"]) {
          const t = parseFloat(tokens[0]!);
          if (!isNaN(t) && t > 0) {
            data.sectionThickness!.set(currentOptions["ELSET"].toUpperCase(), t);
          }
        }
      } else if (currentSection === "SOLID SECTION" || currentSection === "BEAM SECTION") {
        if (tokens.length >= 1 && currentOptions["ELSET"]) {
          const a = parseFloat(tokens[0]!);
          if (!isNaN(a) && a > 0) {
            data.beamAreas!.set(currentOptions["ELSET"].toUpperCase(), a);
          }
        }
      } else if (currentSection === "ELASTIC" && activeMaterial) {
        if (tokens.length >= 2) {
          activeMaterial.E = parseFloat(tokens[0]!);
          activeMaterial.nu = parseFloat(tokens[1]!);
        }
      } else if (currentSection === "DENSITY" && activeMaterial) {
        if (tokens.length >= 1) {
          activeMaterial.rho = parseFloat(tokens[0]!);
        }
      } else if (currentSection === "PLASTIC" && activeMaterial) {
        if (tokens.length >= 1 && activeMaterial.yieldStrength === undefined) {
          const ys = parseFloat(tokens[0]!);
          if (!isNaN(ys)) {
            activeMaterial.yieldStrength = ys;
          }
        }
      } else if (currentSection === "BOUNDARY") {
        if (tokens.length >= 1) {
          const target = tokens[0]!;
          const tok1Upper = tokens.length >= 2 ? tokens[1]!.toUpperCase() : "";
          const symbolicDofs = SYMBOLIC_BOUNDARY_DOFS[tok1Upper];

          let dofs: number[];
          let dispVal = 0.0;

          if (symbolicDofs) {
            dofs = symbolicDofs;
          } else {
            const dofStart = tokens.length >= 2 && tokens[1] !== "" ? parseInt(tokens[1]!, 10) : 1;
            const dofEnd =
              tokens.length >= 3 && tokens[2] !== "" ? parseInt(tokens[2]!, 10) : tokens.length >= 2 ? dofStart : 3;
            dispVal = tokens.length >= 4 && tokens[3] !== "" ? parseFloat(tokens[3]!) : 0.0;
            const s = isNaN(dofStart) ? 1 : dofStart;
            const e = isNaN(dofEnd) ? s : dofEnd;
            dofs = [];
            for (let d = s; d <= e; d++) {
              dofs.push(d);
            }
          }

          const applyBoundary = (nid: number) => {
            if (!isNaN(dispVal) && Math.abs(dispVal) > 0) {
              if (!data.displacements) data.displacements = new Map();
              if (!data.displacements.has(nid)) data.displacements.set(nid, [0, 0, 0]);
              if (!data.prescribedDisplacements) data.prescribedDisplacements = new Map();
              if (!data.prescribedDisplacements.has(nid)) data.prescribedDisplacements.set(nid, new Map());
              const vec = data.displacements.get(nid)!;
              const dofMap = data.prescribedDisplacements.get(nid)!;
              for (const d of dofs) {
                if (d >= 1 && d <= 3) {
                  vec[d - 1] = dispVal;
                  dofMap.set(d, dispVal);
                }
              }
            } else {
              data.fixedNodes.add(nid);
              if (!data.fixedDofs!.has(nid)) data.fixedDofs!.set(nid, new Set());
              const dofSet = data.fixedDofs!.get(nid)!;
              for (const d of dofs) {
                dofSet.add(d);
              }
            }
          };

          const numId = parseInt(target, 10);
          if (!isNaN(numId)) {
            applyBoundary(numId);
          } else {
            const nset = data.nodeSets.get(target.toUpperCase());
            if (nset) {
              for (const nid of nset) {
                applyBoundary(nid);
              }
            }
          }
        }
      } else if (currentSection === "CLOAD") {
        if (tokens.length >= 3) {
          const target = tokens[0]!;
          const dof = parseInt(tokens[1]!, 10);
          const mag = parseFloat(tokens[2]!);

          const applyLoad = (nid: number, nodeMag: number) => {
            if (!data.nodalLoads.has(nid)) data.nodalLoads.set(nid, [0, 0, 0]);
            const loadVec = data.nodalLoads.get(nid)!;
            if (dof === 1) loadVec[0] += nodeMag;
            else if (dof === 2) loadVec[1] += nodeMag;
            else if (dof === 3) loadVec[2] += nodeMag;
          };

          const numId = parseInt(target, 10);
          if (!isNaN(numId)) {
            applyLoad(numId, mag);
          } else {
            const nset = data.nodeSets.get(target.toUpperCase());
            if (nset && nset.size > 0) {
              const isTotal = "TOTAL" in currentOptions;
              const nodeMag = isTotal ? mag / nset.size : mag;
              for (const nid of nset) {
                applyLoad(nid, nodeMag);
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
 * Convenience helper to parse a standard FEA (.inp) / CalculiX deck.
 */
export function parseInpDeck(deckText: string): FeaModelData {
  return new InpDialect().parse(deckText);
}

/**
 * Convenience helper to materialize a standard FEA (.inp) / CalculiX deck template.
 */
export function materializeCalculixDeck(templateText: string, options?: MaterializeOptions): string {
  return new InpDialect().materialize(templateText, options);
}

/**
 * Type alias for parsed Abaqus/CalculiX `.inp` deck model data.
 */
export type InpDeckData = FeaModelData;
