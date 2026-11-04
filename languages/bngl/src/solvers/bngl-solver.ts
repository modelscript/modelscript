// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/bngl — Rule-Based Network Generator ('generateBnglNetwork')
 * & Deterministic RK4 ODE / Observable Trajectory Solver ('solveBngl').
 *
 * Expands seed species across pattern-based reaction rules using graph canonicalization
 * and subgraph isomorphism, then integrates the resulting mass-action ODE network via RK4.
 */

import { serializeComplexPattern } from "../parser/bngl-parser.js";
import type {
  BnglComplexPattern,
  BnglComponentState,
  BnglDocument,
  BnglMoleculeInstance,
  BnglMoleculeType,
  BnglObservableType,
} from "../types.js";

export interface BnglExpandedSpecies {
  id: string;
  canonicalPattern: string;
  pattern: BnglComplexPattern;
  initialConcentration: number;
  constant: boolean;
  compartment?: string | undefined;
}

export interface BnglExpandedReaction {
  id: string;
  ruleId: string;
  reactantIds: string[];
  productIds: string[];
  rateExpression: string;
  multiplicity: number;
  rateLaw: string;
}

export interface BnglObservableGroup {
  name: string;
  type: BnglObservableType;
  weights: Map<string, number>;
}

export interface BnglGeneratedNetwork {
  species: BnglExpandedSpecies[];
  reactions: BnglExpandedReaction[];
  observableGroups: BnglObservableGroup[];
  iterations: number;
}

export interface BnglSolverOptions {
  duration?: number | undefined;
  timeStep?: number | undefined;
  maxIterations?: number | undefined;
  maxSpecies?: number | undefined;
}

export interface BnglStepRecord {
  time: number;
  concentrations: Record<string, number>;
  observables: Record<string, number>;
  reactionRates: Record<string, number>;
}

export interface BnglSimulationResult {
  modelId: string;
  network: BnglGeneratedNetwork;
  speciesNames: string[];
  observableNames: string[];
  initialConcentrations: Record<string, number>;
  finalConcentrations: Record<string, number>;
  initialObservables: Record<string, number>;
  finalObservables: Record<string, number>;
  trajectory: BnglStepRecord[];
  stepsCount: number;
}

type ExprEvaluator = (env: Record<string, number>) => number;

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isAlpha(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

function isAlphaNum(ch: string): boolean {
  return isAlpha(ch) || isDigit(ch);
}

function cloneMolecule(mol: BnglMoleculeInstance): BnglMoleculeInstance {
  return {
    name: mol.name,
    components: mol.components.map((c) => ({
      name: c.name,
      state: c.state,
      bond: c.bond,
    })),
    compartment: mol.compartment,
  };
}

function clonePattern(pat: BnglComplexPattern): BnglComplexPattern {
  return {
    molecules: pat.molecules.map(cloneMolecule),
    compartment: pat.compartment,
    stoichiometry: pat.stoichiometry,
    isConstant: pat.isConstant,
    raw: pat.raw,
  };
}

/**
 * Normalizes a concrete species pattern by filling declared sites in canonical order,
 * sorting molecules deterministically, and renumbering bond labels 1..K.
 */
export function canonicalizeSpeciesPattern(
  input: BnglComplexPattern,
  moleculeTypes: Map<string, BnglMoleculeType>,
): { canonical: string; pattern: BnglComplexPattern } {
  const cloned = clonePattern(input);

  // 1. Order components on each molecule according to moleculeTypes definition
  for (const mol of cloned.molecules) {
    const molDef = moleculeTypes.get(mol.name);
    if (molDef && molDef.sites.length > 0) {
      const usedIndices = new Set<number>();
      const orderedComponents: BnglComponentState[] = [];

      for (const siteDef of molDef.sites) {
        let foundIdx = -1;
        for (let i = 0; i < mol.components.length; i++) {
          if (!usedIndices.has(i) && mol.components[i]?.name === siteDef.name) {
            foundIdx = i;
            break;
          }
        }
        if (foundIdx >= 0) {
          usedIndices.add(foundIdx);
          const existing = mol.components[foundIdx]!;
          orderedComponents.push({
            name: siteDef.name,
            state:
              existing.state !== undefined
                ? existing.state
                : siteDef.allowedStates.length > 0
                  ? siteDef.allowedStates[0]
                  : undefined,
            bond: existing.bond,
          });
        } else {
          orderedComponents.push({
            name: siteDef.name,
            state: siteDef.allowedStates.length > 0 ? siteDef.allowedStates[0] : undefined,
            bond: undefined,
          });
        }
      }

      for (let i = 0; i < mol.components.length; i++) {
        if (!usedIndices.has(i)) {
          orderedComponents.push(mol.components[i]!);
        }
      }
      mol.components = orderedComponents;
    } else {
      mol.components.sort((a, b) => a.name.localeCompare(b.name));
    }
  }

  // 2. Compute bond-independent molecule signatures for deterministic ordering
  const baseSig = (m: BnglMoleculeInstance): string => {
    const cStr = m.components
      .map((c) => `${c.name}${c.state !== undefined ? `~${c.state}` : ""}${c.bond !== undefined ? "!*" : ""}`)
      .join(",");
    return `${m.name}(${cStr})`;
  };

  cloned.molecules.sort((a, b) => baseSig(a).localeCompare(baseSig(b)));

  // 3. Renumber bond labels 1, 2, ... in order of first appearance
  const bondMap = new Map<string, string>();
  let nextBond = 1;
  for (const mol of cloned.molecules) {
    for (const comp of mol.components) {
      if (comp.bond !== undefined && comp.bond !== "+" && comp.bond !== "?" && comp.bond !== "-") {
        let mapped = bondMap.get(comp.bond);
        if (!mapped) {
          mapped = String(nextBond++);
          bondMap.set(comp.bond, mapped);
        }
        comp.bond = mapped;
      }
    }
  }

  // Clear stoichiometry / constant wrapper flags for canonical species string
  const cleanSpeciesPattern: BnglComplexPattern = {
    molecules: cloned.molecules,
    compartment: cloned.compartment,
  };
  const canonical = serializeComplexPattern(cleanSpeciesPattern);
  cleanSpeciesPattern.raw = canonical;

  return { canonical, pattern: cleanSpeciesPattern };
}

interface PatternEmbedding {
  /** Maps pattern molecule index -> concrete species molecule index */
  molMap: number[];
  /** Maps pattern molecule index -> array mapping pattern component index -> species component index */
  compMap: number[][];
}

/**
 * Finds all valid subgraph embeddings of a BNGL pattern into a concrete species complex.
 */
export function findPatternEmbeddings(pattern: BnglComplexPattern, species: BnglComplexPattern): PatternEmbedding[] {
  if (pattern.molecules.length === 0 || pattern.molecules.length > species.molecules.length) {
    return [];
  }

  if (
    pattern.compartment !== undefined &&
    species.compartment !== undefined &&
    pattern.compartment !== species.compartment
  ) {
    return [];
  }

  const pMols = pattern.molecules;
  const sMols = species.molecules;
  const embeddings: PatternEmbedding[] = [];

  // Match components of a single pattern molecule against a single concrete species molecule
  const matchMoleculeComponents = (pMol: BnglMoleculeInstance, sMol: BnglMoleculeInstance): number[] | null => {
    if (pMol.name !== sMol.name) return null;
    const usedSComp = new Set<number>();
    const cMap: number[] = [];

    for (const pComp of pMol.components) {
      let matchedIdx = -1;
      for (let scIdx = 0; scIdx < sMol.components.length; scIdx++) {
        if (usedSComp.has(scIdx)) continue;
        const sComp = sMol.components[scIdx]!;
        if (sComp.name !== pComp.name) continue;

        // Check internal state constraint
        if (pComp.state !== undefined && pComp.state !== "?") {
          if (sComp.state !== pComp.state) continue;
        }

        // Check local bond constraint
        if (pComp.bond === undefined || pComp.bond === "-") {
          if (sComp.bond !== undefined) continue;
        } else if (pComp.bond === "+") {
          if (sComp.bond === undefined) continue;
        } else if (pComp.bond !== "?") {
          // Specific bond label !1, !2, etc. requires concrete site to be bound
          if (sComp.bond === undefined) continue;
        }

        matchedIdx = scIdx;
        break;
      }

      if (matchedIdx < 0) return null;
      usedSComp.add(matchedIdx);
      cMap.push(matchedIdx);
    }

    return cMap;
  };

  const usedSMols = new Set<number>();
  const currentMolMap: number[] = [];
  const currentCompMap: number[][] = [];

  const verifyBondTopology = (molMap: number[], compMap: number[][]): boolean => {
    // Map pattern bond label -> concrete bond label
    const pBondToSBond = new Map<string, string>();
    const sBondToPBond = new Map<string, string>();

    for (let pmIdx = 0; pmIdx < pMols.length; pmIdx++) {
      const pMol = pMols[pmIdx]!;
      const sMol = sMols[molMap[pmIdx]!]!;
      const cMap = compMap[pmIdx]!;

      for (let pcIdx = 0; pcIdx < pMol.components.length; pcIdx++) {
        const pComp = pMol.components[pcIdx]!;
        const sComp = sMol.components[cMap[pcIdx]!]!;

        if (pComp.bond !== undefined && pComp.bond !== "+" && pComp.bond !== "?" && pComp.bond !== "-") {
          const sBond = sComp.bond;
          if (!sBond) return false;

          const existingSBond = pBondToSBond.get(pComp.bond);
          if (existingSBond !== undefined && existingSBond !== sBond) {
            return false;
          }
          const existingPBond = sBondToPBond.get(sBond);
          if (existingPBond !== undefined && existingPBond !== pComp.bond) {
            return false;
          }
          pBondToSBond.set(pComp.bond, sBond);
          sBondToPBond.set(sBond, pComp.bond);
        }
      }
    }

    // Also ensure that for every pattern bond label b_P, both endpoints in species connected by b_S are matched by b_P
    for (const [pBond, sBond] of pBondToSBond) {
      let pEndpointCount = 0;
      for (let pmIdx = 0; pmIdx < pMols.length; pmIdx++) {
        const pMol = pMols[pmIdx]!;
        for (const pComp of pMol.components) {
          if (pComp.bond === pBond) pEndpointCount++;
        }
      }

      let matchedSEndpoints = 0;
      for (let pmIdx = 0; pmIdx < pMols.length; pmIdx++) {
        const pMol = pMols[pmIdx]!;
        const sMol = sMols[molMap[pmIdx]!]!;
        const cMap = compMap[pmIdx]!;
        for (let pcIdx = 0; pcIdx < pMol.components.length; pcIdx++) {
          if (pMol.components[pcIdx]?.bond === pBond && sMol.components[cMap[pcIdx]!]?.bond === sBond) {
            matchedSEndpoints++;
          }
        }
      }

      if (matchedSEndpoints !== pEndpointCount) {
        return false;
      }
    }

    return true;
  };

  const backtrack = (pIdx: number): void => {
    if (pIdx === pMols.length) {
      if (verifyBondTopology(currentMolMap, currentCompMap)) {
        embeddings.push({
          molMap: [...currentMolMap],
          compMap: currentCompMap.map((arr) => [...arr]),
        });
      }
      return;
    }

    const pMol = pMols[pIdx]!;
    for (let sIdx = 0; sIdx < sMols.length; sIdx++) {
      if (usedSMols.has(sIdx)) continue;
      const cMap = matchMoleculeComponents(pMol, sMols[sIdx]!);
      if (!cMap) continue;

      usedSMols.add(sIdx);
      currentMolMap.push(sIdx);
      currentCompMap.push(cMap);
      backtrack(pIdx + 1);
      currentCompMap.pop();
      currentMolMap.pop();
      usedSMols.delete(sIdx);
    }
  };

  backtrack(0);
  return embeddings;
}

/**
 * Applies a directional reaction rule to concrete reactant species given their embeddings,
 * returning the resulting canonical product species patterns.
 */
function applyRuleEmbedding(
  reactantSpecies: BnglComplexPattern[],
  reactantPatterns: BnglComplexPattern[],
  embeddings: PatternEmbedding[],
  productPatterns: BnglComplexPattern[],
  moleculeTypes: Map<string, BnglMoleculeType>,
): Array<{ canonical: string; pattern: BnglComplexPattern }> | null {
  if (productPatterns.length === 0) {
    return [];
  }

  // 1. Build disjoint union of concrete reactant molecules, offsetting concrete bond numbers per reactant
  const unionMols: BnglMoleculeInstance[] = [];
  const reactantMolOffset: number[] = [];

  for (let rIdx = 0; rIdx < reactantSpecies.length; rIdx++) {
    reactantMolOffset.push(unionMols.length);
    const sp = reactantSpecies[rIdx]!;
    const bondOffset = (rIdx + 1) * 1000;
    for (const m of sp.molecules) {
      const cloned = cloneMolecule(m);
      for (const c of cloned.components) {
        if (c.bond !== undefined) {
          const num = Number(c.bond);
          c.bond = !Number.isNaN(num) ? String(num + bondOffset) : `R${rIdx}_${c.bond}`;
        }
      }
      unionMols.push(cloned);
    }
  }

  // 2. Flatten reactant pattern molecules and record their concrete molecule index + component mapping
  interface FlatReactantMol {
    patternMol: BnglMoleculeInstance;
    unionMolIdx: number;
    compMap: number[];
    reactantIdx: number;
  }

  const flatReactantMols: FlatReactantMol[] = [];
  for (let rIdx = 0; rIdx < reactantPatterns.length; rIdx++) {
    const rPat = reactantPatterns[rIdx]!;
    const emb = embeddings[rIdx]!;
    const offset = reactantMolOffset[rIdx]!;
    for (let pmIdx = 0; pmIdx < rPat.molecules.length; pmIdx++) {
      flatReactantMols.push({
        patternMol: rPat.molecules[pmIdx]!,
        unionMolIdx: offset + emb.molMap[pmIdx]!,
        compMap: emb.compMap[pmIdx]!,
        reactantIdx: rIdx,
      });
    }
  }

  // 3. Flatten product pattern molecules (with unique bond labels per product pattern)
  interface FlatProductMol {
    patternMol: BnglMoleculeInstance;
    productIdx: number;
  }

  const flatProductMols: FlatProductMol[] = [];
  for (let pIdx = 0; pIdx < productPatterns.length; pIdx++) {
    const pPat = productPatterns[pIdx]!;
    for (const m of pPat.molecules) {
      const cloned = cloneMolecule(m);
      for (const c of cloned.components) {
        if (c.bond !== undefined && c.bond !== "+" && c.bond !== "?" && c.bond !== "-") {
          c.bond = `P${pIdx}_${c.bond}`;
        }
      }
      flatProductMols.push({
        patternMol: cloned,
        productIdx: pIdx,
      });
    }
  }

  // 4. Match flatReactantMols to flatProductMols by molecule name
  const rToP = new Map<number, number>();
  const pToR = new Map<number, number>();

  for (let rIdx = 0; rIdx < flatReactantMols.length; rIdx++) {
    const rName = flatReactantMols[rIdx]!.patternMol.name;
    for (let pIdx = 0; pIdx < flatProductMols.length; pIdx++) {
      if (!pToR.has(pIdx) && flatProductMols[pIdx]!.patternMol.name === rName) {
        rToP.set(rIdx, pIdx);
        pToR.set(pIdx, rIdx);
        break;
      }
    }
  }

  // 5. Handle degraded molecules (in reactants but not in products)
  const deletedUnionIdxs = new Set<number>();
  for (let rIdx = 0; rIdx < flatReactantMols.length; rIdx++) {
    if (!rToP.has(rIdx)) {
      const uIdx = flatReactantMols[rIdx]!.unionMolIdx;
      deletedUnionIdxs.add(uIdx);
      const uMol = unionMols[uIdx]!;
      for (const c of uMol.components) {
        if (c.bond !== undefined) {
          const brokenBond = c.bond;
          for (const otherMol of unionMols) {
            for (const otherComp of otherMol.components) {
              if (otherComp.bond === brokenBond) {
                otherComp.bond = undefined;
              }
            }
          }
        }
      }
    }
  }

  // 6. Map each flatProductMol to its concrete unionMolIdx (synthesizing new molecules if needed)
  const pToUnionIdx: number[] = [];
  for (let pIdx = 0; pIdx < flatProductMols.length; pIdx++) {
    const rIdx = pToR.get(pIdx);
    if (rIdx !== undefined) {
      pToUnionIdx.push(flatReactantMols[rIdx]!.unionMolIdx);
    } else {
      const newMol = cloneMolecule(flatProductMols[pIdx]!.patternMol);
      for (const c of newMol.components) {
        c.bond = undefined;
      }
      const newUIdx = unionMols.length;
      unionMols.push(newMol);
      pToUnionIdx.push(newUIdx);
    }
  }

  // 7. Apply state changes and bond removals on surviving molecules
  for (let rIdx = 0; rIdx < flatReactantMols.length; rIdx++) {
    const pIdx = rToP.get(rIdx);
    if (pIdx === undefined) continue;

    const rInfo = flatReactantMols[rIdx]!;
    const pInfo = flatProductMols[pIdx]!;
    const uMol = unionMols[rInfo.unionMolIdx]!;

    for (let rcIdx = 0; rcIdx < rInfo.patternMol.components.length; rcIdx++) {
      const rComp = rInfo.patternMol.components[rcIdx]!;
      const uCompIdx = rInfo.compMap[rcIdx]!;
      const uComp = uMol.components[uCompIdx]!;

      // Find corresponding component in pInfo.patternMol
      const pComp = pInfo.patternMol.components.find((c) => c.name === rComp.name);
      if (!pComp) continue;

      if (pComp.state !== undefined && pComp.state !== "?") {
        uComp.state = pComp.state;
      }

      // If site was bound in reactant pattern and is unbound in product pattern, break the concrete bond
      if (
        rComp.bond !== undefined &&
        rComp.bond !== "?" &&
        rComp.bond !== "-" &&
        (pComp.bond === undefined || pComp.bond === "-")
      ) {
        const oldConcreteBond = uComp.bond;
        if (oldConcreteBond !== undefined) {
          for (const m of unionMols) {
            for (const c of m.components) {
              if (c.bond === oldConcreteBond) {
                c.bond = undefined;
              }
            }
          }
        }
      }
    }

    // Also check if pInfo specifies state updates on components not listed in rInfo
    for (const pComp of pInfo.patternMol.components) {
      if (pComp.state !== undefined && pComp.state !== "?") {
        const uComp = uMol.components.find((c) => c.name === pComp.name);
        if (uComp) {
          uComp.state = pComp.state;
        }
      }
    }
  }

  // 8. Apply newly formed or preserved bonds from flatProductMols
  const productBondEndpoints = new Map<string, Array<{ uIdx: number; compName: string }>>();

  for (let pIdx = 0; pIdx < flatProductMols.length; pIdx++) {
    const pMol = flatProductMols[pIdx]!.patternMol;
    const uIdx = pToUnionIdx[pIdx]!;
    for (const pComp of pMol.components) {
      if (pComp.bond !== undefined && pComp.bond !== "+" && pComp.bond !== "?" && pComp.bond !== "-") {
        const list = productBondEndpoints.get(pComp.bond) ?? [];
        list.push({ uIdx, compName: pComp.name });
        productBondEndpoints.set(pComp.bond, list);
      }
    }
  }

  let freshBondCounter = 9000;
  for (const [, endpoints] of productBondEndpoints) {
    if (endpoints.length !== 2) continue;
    const ep1 = endpoints[0]!;
    const ep2 = endpoints[1]!;
    const uMol1 = unionMols[ep1.uIdx]!;
    const uMol2 = unionMols[ep2.uIdx]!;

    const uComp1 = uMol1.components.find((c) => c.name === ep1.compName);
    const uComp2 = uMol2.components.find(
      (c, idx) => c.name === ep2.compName && (ep1.uIdx !== ep2.uIdx || uMol1.components[idx] !== uComp1),
    );

    if (!uComp1 || !uComp2) continue;

    // If they already share the same concrete bond, keep it; otherwise create a new concrete bond
    if (uComp1.bond !== undefined && uComp1.bond === uComp2.bond) {
      continue;
    }

    const newBondLabel = `NEW_${freshBondCounter++}`;
    uComp1.bond = newBondLabel;
    uComp2.bond = newBondLabel;
  }

  // 9. Partition surviving unionMols into connected components via concrete bonds
  const survivingIdxs: number[] = [];
  for (let i = 0; i < unionMols.length; i++) {
    if (!deletedUnionIdxs.has(i)) {
      survivingIdxs.push(i);
    }
  }

  const adj = new Map<number, Set<number>>();
  for (const idx of survivingIdxs) {
    adj.set(idx, new Set());
  }

  const bondHolders = new Map<string, number[]>();
  for (const idx of survivingIdxs) {
    const m = unionMols[idx]!;
    for (const c of m.components) {
      if (c.bond !== undefined) {
        const list = bondHolders.get(c.bond) ?? [];
        list.push(idx);
        bondHolders.set(c.bond, list);
      }
    }
  }

  for (const [, holders] of bondHolders) {
    for (let i = 0; i < holders.length; i++) {
      for (let j = i + 1; j < holders.length; j++) {
        const a = holders[i]!;
        const b = holders[j]!;
        adj.get(a)?.add(b);
        adj.get(b)?.add(a);
      }
    }
  }

  const visited = new Set<number>();
  const connectedComponents: Array<{ canonical: string; pattern: BnglComplexPattern }> = [];

  for (const startIdx of survivingIdxs) {
    if (visited.has(startIdx)) continue;
    const queue: number[] = [startIdx];
    visited.add(startIdx);
    const compMols: BnglMoleculeInstance[] = [];

    while (queue.length > 0) {
      const curr = queue.shift()!;
      compMols.push(unionMols[curr]!);
      const neighbors = adj.get(curr);
      if (neighbors) {
        for (const nb of neighbors) {
          if (!visited.has(nb)) {
            visited.add(nb);
            queue.push(nb);
          }
        }
      }
    }

    const rawComplex: BnglComplexPattern = {
      molecules: compMols,
    };
    connectedComponents.push(canonicalizeSpeciesPattern(rawComplex, moleculeTypes));
  }

  return connectedComponents;
}

/**
 * Expands a BioNetGen document's seed species and reaction rules into a concrete
 * biochemical species and elementary reaction network.
 */
export function generateBnglNetwork(
  doc: BnglDocument,
  options?: { maxIterations?: number | undefined; maxSpecies?: number | undefined },
): BnglGeneratedNetwork {
  const model = doc.model;
  const genNetAction = doc.actions.find((a) => a.command === "generate_network");
  const actionMaxIter = typeof genNetAction?.args["max_iter"] === "number" ? genNetAction.args["max_iter"] : undefined;

  const maxIterations = options?.maxIterations ?? actionMaxIter ?? 15;
  const maxSpecies = options?.maxSpecies ?? 150;

  const speciesByCanonical = new Map<string, BnglExpandedSpecies>();
  const speciesList: BnglExpandedSpecies[] = [];

  const registerSpecies = (
    rawPattern: BnglComplexPattern,
    initialConc: number,
    constant: boolean,
    compartment?: string,
  ): BnglExpandedSpecies => {
    const { canonical, pattern } = canonicalizeSpeciesPattern(rawPattern, model.moleculeTypes);
    const existing = speciesByCanonical.get(canonical);
    if (existing) {
      existing.initialConcentration += initialConc;
      if (constant) existing.constant = true;
      return existing;
    }

    const sp: BnglExpandedSpecies = {
      id: `S${speciesList.length + 1}`,
      canonicalPattern: canonical,
      pattern,
      initialConcentration: initialConc,
      constant,
      compartment: compartment ?? rawPattern.compartment,
    };
    speciesByCanonical.set(canonical, sp);
    speciesList.push(sp);
    return sp;
  };

  // 1. Register seed species
  for (const seed of model.seedSpecies) {
    registerSpecies(seed.pattern, seed.initialConcentration, seed.constant, seed.compartment);
  }

  // 2. Build directional elementary rules from reactionRules
  interface DirectionalRule {
    ruleId: string;
    reactants: BnglComplexPattern[];
    products: BnglComplexPattern[];
    rateExpr: string;
  }

  const directionalRules: DirectionalRule[] = [];
  const rulesList = model.reactionRuleList ?? Array.from(model.reactionRules.values());
  for (const rule of rulesList) {
    if (rule.forwardRate && rule.forwardRate.trim().length > 0) {
      directionalRules.push({
        ruleId: rule.id,
        reactants: rule.reactants,
        products: rule.products,
        rateExpr: rule.forwardRate.trim(),
      });
    }
    if (rule.reversible && rule.reverseRate && rule.reverseRate.trim().length > 0) {
      directionalRules.push({
        ruleId: `${rule.id}_rev`,
        reactants: rule.products,
        products: rule.reactants,
        rateExpr: rule.reverseRate.trim(),
      });
    }
  }

  const reactionsByKey = new Map<string, BnglExpandedReaction>();
  const reactionsList: BnglExpandedReaction[] = [];

  const recordReaction = (
    ruleId: string,
    reactantIds: string[],
    productIds: string[],
    rateExpression: string,
    multiplicity: number,
  ): void => {
    const sortedReactants = [...reactantIds].sort();
    const sortedProducts = [...productIds].sort();
    const rxnKey = `${ruleId}::${sortedReactants.join("+")}->${sortedProducts.join("+")}`;

    if (reactionsByKey.has(rxnKey)) {
      return;
    }

    const massActionFactors = [...reactantIds];
    const rateTerms: string[] = [];
    if (multiplicity !== 1) {
      rateTerms.push(String(multiplicity));
    }
    rateTerms.push(`(${rateExpression})`);
    for (const rId of massActionFactors) {
      rateTerms.push(rId);
    }

    const rxn: BnglExpandedReaction = {
      id: `Rxn${reactionsList.length + 1}`,
      ruleId,
      reactantIds,
      productIds,
      rateExpression,
      multiplicity,
      rateLaw: rateTerms.join(" * "),
    };
    reactionsByKey.set(rxnKey, rxn);
    reactionsList.push(rxn);
  };

  // 3. Iterative network expansion loop
  let iterations = 0;
  for (let iter = 0; iter < maxIterations; iter++) {
    const startSpeciesCount = speciesList.length;
    const startRxnCount = reactionsList.length;
    iterations = iter + 1;

    const currentSpeciesSnapshot = [...speciesList];

    for (const dRule of directionalRules) {
      const rCount = dRule.reactants.length;

      if (rCount === 0) {
        // Zero-order synthesis: 0 -> Products
        const prodIds: string[] = [];
        for (const pPat of dRule.products) {
          if (speciesList.length < maxSpecies) {
            const sp = registerSpecies(pPat, 0.0, false);
            prodIds.push(sp.id);
          }
        }
        if (prodIds.length > 0) {
          recordReaction(dRule.ruleId, [], prodIds, dRule.rateExpr, 1);
        }
      } else if (rCount === 1) {
        // Unimolecular rule: R1 -> Products
        const rPat1 = dRule.reactants[0]!;
        for (const sp1 of currentSpeciesSnapshot) {
          const embs1 = findPatternEmbeddings(rPat1, sp1.pattern);
          if (embs1.length === 0) continue;

          // Group by canonical products produced across embeddings
          const outcomeCounts = new Map<
            string,
            { products: Array<{ canonical: string; pattern: BnglComplexPattern }>; count: number }
          >();

          for (const emb1 of embs1) {
            const outProds = applyRuleEmbedding([sp1.pattern], [rPat1], [emb1], dRule.products, model.moleculeTypes);
            if (!outProds) continue;
            const outKey = outProds
              .map((p) => p.canonical)
              .sort()
              .join(" + ");
            const existing = outcomeCounts.get(outKey);
            if (existing) {
              existing.count++;
            } else {
              outcomeCounts.set(outKey, { products: outProds, count: 1 });
            }
          }

          for (const [, outcome] of outcomeCounts) {
            const prodIds: string[] = [];
            let canRegisterAll = true;
            for (const p of outcome.products) {
              if (!speciesByCanonical.has(p.canonical) && speciesList.length >= maxSpecies) {
                canRegisterAll = false;
                break;
              }
              const prodSp = registerSpecies(p.pattern, 0.0, false);
              prodIds.push(prodSp.id);
            }
            if (canRegisterAll) {
              recordReaction(dRule.ruleId, [sp1.id], prodIds, dRule.rateExpr, outcome.count);
            }
          }
        }
      } else if (rCount === 2) {
        // Bimolecular rule: R1 + R2 -> Products
        const rPat1 = dRule.reactants[0]!;
        const rPat2 = dRule.reactants[1]!;
        const symmetricPatterns = serializeComplexPattern(rPat1) === serializeComplexPattern(rPat2);

        for (let i = 0; i < currentSpeciesSnapshot.length; i++) {
          const sp1 = currentSpeciesSnapshot[i]!;
          const embs1 = findPatternEmbeddings(rPat1, sp1.pattern);
          if (embs1.length === 0) continue;

          const jStart = symmetricPatterns ? i : 0;
          for (let j = jStart; j < currentSpeciesSnapshot.length; j++) {
            const sp2 = currentSpeciesSnapshot[j]!;
            const embs2 = findPatternEmbeddings(rPat2, sp2.pattern);
            if (embs2.length === 0) continue;

            const outcomeCounts = new Map<
              string,
              { products: Array<{ canonical: string; pattern: BnglComplexPattern }>; count: number }
            >();

            for (const emb1 of embs1) {
              for (const emb2 of embs2) {
                const outProds = applyRuleEmbedding(
                  [sp1.pattern, sp2.pattern],
                  [rPat1, rPat2],
                  [emb1, emb2],
                  dRule.products,
                  model.moleculeTypes,
                );
                if (!outProds) continue;
                const outKey = outProds
                  .map((p) => p.canonical)
                  .sort()
                  .join(" + ");
                const existing = outcomeCounts.get(outKey);
                if (existing) {
                  existing.count++;
                } else {
                  outcomeCounts.set(outKey, { products: outProds, count: 1 });
                }
              }
            }

            for (const [, outcome] of outcomeCounts) {
              const prodIds: string[] = [];
              let canRegisterAll = true;
              for (const p of outcome.products) {
                if (!speciesByCanonical.has(p.canonical) && speciesList.length >= maxSpecies) {
                  canRegisterAll = false;
                  break;
                }
                const prodSp = registerSpecies(p.pattern, 0.0, false);
                prodIds.push(prodSp.id);
              }
              if (canRegisterAll) {
                const mult =
                  sp1.id === sp2.id && symmetricPatterns ? Math.max(0.5, outcome.count * 0.5) : outcome.count;
                recordReaction(dRule.ruleId, [sp1.id, sp2.id], prodIds, dRule.rateExpr, mult);
              }
            }
          }
        }
      }
    }

    if (speciesList.length === startSpeciesCount && reactionsList.length === startRxnCount) {
      break;
    }
    if (speciesList.length >= maxSpecies) {
      break;
    }
  }

  // 4. Compute Observable Group Weights across expanded species
  const observableGroups: BnglObservableGroup[] = [];
  const obsList = model.observableList ?? Array.from(model.observables.values());

  for (const obs of obsList) {
    const weights = new Map<string, number>();
    for (const sp of speciesList) {
      let totalMatches = 0;
      for (const pat of obs.patterns) {
        const embs = findPatternEmbeddings(pat, sp.pattern);
        if (obs.type === "Species") {
          if (embs.length > 0) {
            totalMatches = 1;
            break;
          }
        } else {
          // For Molecules observables, normalize by pattern symmetry if pattern has multiple identical molecules
          let symmetry = 1;
          if (pat.molecules.length > 1) {
            const selfEmbs = findPatternEmbeddings(pat, pat);
            symmetry = Math.max(1, selfEmbs.length);
          }
          totalMatches += embs.length / symmetry;
        }
      }
      if (totalMatches > 0) {
        weights.set(sp.id, totalMatches);
      }
    }
    observableGroups.push({
      name: obs.name,
      type: obs.type,
      weights,
    });
  }

  return {
    species: speciesList,
    reactions: reactionsList,
    observableGroups,
    iterations,
  };
}

/**
 * Safe, zero-eval, zero-regex recursive-descent mathematical expression compiler.
 */
export function compileBnglExpr(formula: string): ExprEvaluator {
  type TokenType = "NUM" | "ID" | "OP" | "LPAREN" | "RPAREN" | "COMMA";
  interface Token {
    type: TokenType;
    value: string;
  }

  const tokens: Token[] = [];
  let pos = 0;
  const n = formula.length;

  while (pos < n) {
    const ch = formula[pos] ?? "";
    const next = formula[pos + 1] ?? "";

    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      pos++;
      continue;
    }

    if (isDigit(ch) || (ch === "." && isDigit(next))) {
      let numStr = "";
      while (pos < n && isDigit(formula[pos] ?? "")) {
        numStr += formula[pos] ?? "";
        pos++;
      }
      if (pos < n && formula[pos] === ".") {
        numStr += ".";
        pos++;
        while (pos < n && isDigit(formula[pos] ?? "")) {
          numStr += formula[pos] ?? "";
          pos++;
        }
      }
      if (pos < n && (formula[pos] === "e" || formula[pos] === "E")) {
        const eNext = formula[pos + 1] ?? "";
        const eNext2 = formula[pos + 2] ?? "";
        if (isDigit(eNext) || ((eNext === "+" || eNext === "-") && isDigit(eNext2))) {
          numStr += formula[pos] ?? "";
          pos++;
          if (formula[pos] === "+" || formula[pos] === "-") {
            numStr += formula[pos] ?? "";
            pos++;
          }
          while (pos < n && isDigit(formula[pos] ?? "")) {
            numStr += formula[pos] ?? "";
            pos++;
          }
        }
      }
      tokens.push({ type: "NUM", value: numStr });
      continue;
    }

    if (isAlpha(ch)) {
      let idStr = "";
      while (pos < n && isAlphaNum(formula[pos] ?? "")) {
        idStr += formula[pos] ?? "";
        pos++;
      }
      tokens.push({ type: "ID", value: idStr });
      continue;
    }

    if (ch === "(") {
      tokens.push({ type: "LPAREN", value: "(" });
      pos++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "RPAREN", value: ")" });
      pos++;
      continue;
    }
    if (ch === ",") {
      tokens.push({ type: "COMMA", value: "," });
      pos++;
      continue;
    }
    if (ch === "*" && next === "*") {
      tokens.push({ type: "OP", value: "^" });
      pos += 2;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "^") {
      tokens.push({ type: "OP", value: ch });
      pos++;
      continue;
    }
    pos++;
  }

  if (tokens.length === 0) return () => 0.0;

  let tIdx = 0;
  const peek = (): Token | undefined => tokens[tIdx];
  const consume = (): Token => tokens[tIdx++] ?? { type: "NUM", value: "0" };

  function parseAdditive(): ExprEvaluator {
    let left = parseMultiplicative();
    while (peek()?.type === "OP" && (peek()?.value === "+" || peek()?.value === "-")) {
      const op = consume().value;
      const right = parseMultiplicative();
      const prev = left;
      left = op === "+" ? (env) => prev(env) + right(env) : (env) => prev(env) - right(env);
    }
    return left;
  }

  function parseMultiplicative(): ExprEvaluator {
    let left = parsePower();
    while (peek()?.type === "OP" && (peek()?.value === "*" || peek()?.value === "/")) {
      const op = consume().value;
      const right = parsePower();
      const prev = left;
      if (op === "*") {
        left = (env) => prev(env) * right(env);
      } else {
        left = (env) => {
          const d = right(env);
          return d !== 0.0 ? prev(env) / d : 0.0;
        };
      }
    }
    return left;
  }

  function parsePower(): ExprEvaluator {
    const base = parseUnary();
    if (peek()?.type === "OP" && peek()?.value === "^") {
      consume();
      const exp = parsePower();
      return (env) => Math.pow(base(env), exp(env));
    }
    return base;
  }

  function parseUnary(): ExprEvaluator {
    if (peek()?.type === "OP" && (peek()?.value === "+" || peek()?.value === "-")) {
      const op = consume().value;
      const inner = parseUnary();
      return op === "-" ? (env) => -inner(env) : inner;
    }
    return parsePrimary();
  }

  function parsePrimary(): ExprEvaluator {
    const tok = peek();
    if (!tok) return () => 0.0;

    if (tok.type === "NUM") {
      consume();
      const val = Number(tok.value);
      return () => (Number.isNaN(val) ? 0.0 : val);
    }

    if (tok.type === "LPAREN") {
      consume();
      const inner = parseAdditive();
      if (peek()?.type === "RPAREN") consume();
      return inner;
    }

    if (tok.type === "ID") {
      consume();
      const id = tok.value;
      const lower = id.toLowerCase();

      if (lower === "pi") return () => Math.PI;
      if (lower === "e") return () => Math.E;

      if (peek()?.type === "LPAREN") {
        consume();
        const args: ExprEvaluator[] = [];
        if (peek() && peek()?.type !== "RPAREN") {
          args.push(parseAdditive());
          while (peek()?.type === "COMMA") {
            consume();
            args.push(parseAdditive());
          }
        }
        if (peek()?.type === "RPAREN") consume();

        if (lower === "sqrt") return (env) => Math.sqrt(Math.max(0, args[0]?.(env) ?? 0));
        if (lower === "exp") return (env) => Math.exp(args[0]?.(env) ?? 0);
        if (lower === "log" || lower === "ln") {
          return (env) => Math.log(Math.max(1e-15, args[0]?.(env) ?? 1));
        }
        if (lower === "sin") return (env) => Math.sin(args[0]?.(env) ?? 0);
        if (lower === "cos") return (env) => Math.cos(args[0]?.(env) ?? 0);
        if (lower === "abs") return (env) => Math.abs(args[0]?.(env) ?? 0);
        if (lower === "min") {
          return (env) => Math.min(args[0]?.(env) ?? 0, args[1]?.(env) ?? 0);
        }
        if (lower === "max") {
          return (env) => Math.max(args[0]?.(env) ?? 0, args[1]?.(env) ?? 0);
        }
        if (lower === "sat") {
          return (env) => {
            const k = args[0]?.(env) ?? 0;
            const kMax = args[1]?.(env) ?? 1;
            return k / Math.max(1e-12, kMax);
          };
        }
      }

      return (env) => env[id] ?? 0.0;
    }

    consume();
    return () => 0.0;
  }

  return parseAdditive();
}

/**
 * Expands the rule-based BNGL network and integrates species and observable trajectories via RK4.
 */
export function solveBngl(doc: BnglDocument, options?: BnglSolverOptions): BnglSimulationResult {
  const model = doc.model;
  const network = generateBnglNetwork(doc, {
    maxIterations: options?.maxIterations,
    maxSpecies: options?.maxSpecies,
  });

  // Determine simulation duration and step size from options or simulate({...}) action
  const simAction = doc.actions.find((a) => a.command === "simulate" || a.command === "simulate_ode");
  const actionTEnd = typeof simAction?.args["t_end"] === "number" ? simAction.args["t_end"] : undefined;
  const actionNSteps = typeof simAction?.args["n_steps"] === "number" ? simAction.args["n_steps"] : undefined;

  const duration = options?.duration ?? actionTEnd ?? 10.0;
  const defaultDt =
    actionTEnd !== undefined && actionNSteps !== undefined && actionNSteps > 0
      ? Math.min(0.1, actionTEnd / actionNSteps)
      : 0.05;
  const dt = options?.timeStep ?? defaultDt;
  const steps = Math.max(1, Math.round(duration / dt));

  // Build parameter environment
  const paramEnv: Record<string, number> = {};
  for (const [pId, param] of model.parameters) {
    paramEnv[pId] = param.value;
  }
  for (const [cId, comp] of model.compartments) {
    paramEnv[cId] = comp.size;
  }

  // Compile reaction rate laws
  const compiledReactions = new Map<string, ExprEvaluator>();
  for (const rxn of network.reactions) {
    compiledReactions.set(rxn.id, compileBnglExpr(rxn.rateLaw));
  }

  // Initialize state vector
  const state: Record<string, number> = {};
  for (const sp of network.species) {
    state[sp.id] = sp.initialConcentration;
  }

  const computeObservables = (concById: Record<string, number>): Record<string, number> => {
    const obsValues: Record<string, number> = {};
    for (const grp of network.observableGroups) {
      let sum = 0.0;
      for (const [spId, weight] of grp.weights) {
        sum += weight * (concById[spId] ?? 0.0);
      }
      obsValues[grp.name] = sum;
    }
    return obsValues;
  };

  const buildSnapshotConcentrations = (concById: Record<string, number>): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const sp of network.species) {
      const val = concById[sp.id] ?? 0.0;
      out[sp.id] = val;
      out[sp.canonicalPattern] = val;
    }
    return out;
  };

  const computeReactionRates = (
    concById: Record<string, number>,
    obsValues: Record<string, number>,
    time: number,
  ): Record<string, number> => {
    const env: Record<string, number> = {
      ...paramEnv,
      ...obsValues,
      ...concById,
      time,
      t: time,
    };
    const rates: Record<string, number> = {};
    for (const rxn of network.reactions) {
      const ev = compiledReactions.get(rxn.id);
      rates[rxn.id] = ev ? ev(env) : 0.0;
    }
    return rates;
  };

  const computeDerivatives = (concById: Record<string, number>, time: number): Record<string, number> => {
    const obsValues = computeObservables(concById);
    const rates = computeReactionRates(concById, obsValues, time);
    const dS: Record<string, number> = {};

    for (const sp of network.species) {
      dS[sp.id] = 0.0;
    }

    for (const rxn of network.reactions) {
      const v = rates[rxn.id] ?? 0.0;
      for (const rId of rxn.reactantIds) {
        dS[rId] = (dS[rId] ?? 0.0) - v;
      }
      for (const pId of rxn.productIds) {
        dS[pId] = (dS[pId] ?? 0.0) + v;
      }
    }

    for (const sp of network.species) {
      if (sp.constant) {
        dS[sp.id] = 0.0;
      }
    }

    return dS;
  };

  const trajectory: BnglStepRecord[] = [];
  const initialConcentrations = buildSnapshotConcentrations(state);
  const initialObservables = computeObservables(state);

  // Record t = 0
  trajectory.push({
    time: 0.0,
    concentrations: { ...initialConcentrations },
    observables: { ...initialObservables },
    reactionRates: computeReactionRates(state, initialObservables, 0.0),
  });

  // RK4 integration loop
  let currentTime = 0.0;
  for (let step = 1; step <= steps; step++) {
    const k1 = computeDerivatives(state, currentTime);

    const state2: Record<string, number> = {};
    for (const sp of network.species) {
      state2[sp.id] = Math.max(0.0, (state[sp.id] ?? 0.0) + 0.5 * dt * (k1[sp.id] ?? 0.0));
    }
    const k2 = computeDerivatives(state2, currentTime + 0.5 * dt);

    const state3: Record<string, number> = {};
    for (const sp of network.species) {
      state3[sp.id] = Math.max(0.0, (state[sp.id] ?? 0.0) + 0.5 * dt * (k2[sp.id] ?? 0.0));
    }
    const k3 = computeDerivatives(state3, currentTime + 0.5 * dt);

    const state4: Record<string, number> = {};
    for (const sp of network.species) {
      state4[sp.id] = Math.max(0.0, (state[sp.id] ?? 0.0) + dt * (k3[sp.id] ?? 0.0));
    }
    const k4 = computeDerivatives(state4, currentTime + dt);

    for (const sp of network.species) {
      if (sp.constant) continue;
      const delta =
        (dt / 6.0) * ((k1[sp.id] ?? 0.0) + 2.0 * (k2[sp.id] ?? 0.0) + 2.0 * (k3[sp.id] ?? 0.0) + (k4[sp.id] ?? 0.0));
      state[sp.id] = Math.max(0.0, (state[sp.id] ?? 0.0) + delta);
    }

    currentTime = Number((step * dt).toFixed(10));
    const snapConc = buildSnapshotConcentrations(state);
    const snapObs = computeObservables(state);
    const snapRates = computeReactionRates(state, snapObs, currentTime);

    trajectory.push({
      time: currentTime,
      concentrations: snapConc,
      observables: snapObs,
      reactionRates: snapRates,
    });
  }

  const finalConcentrations = buildSnapshotConcentrations(state);
  const finalObservables = computeObservables(state);

  return {
    modelId: model.id,
    network,
    speciesNames: network.species.map((s) => s.canonicalPattern),
    observableNames: network.observableGroups.map((g) => g.name),
    initialConcentrations,
    finalConcentrations,
    initialObservables,
    finalObservables,
    trajectory,
    stepsCount: steps,
  };
}

export const simulateBngl = solveBngl;
