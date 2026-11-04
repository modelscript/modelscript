// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/smiles — Pre-Flight Cheminformatics & Molecular Graph Linter.
 *
 * Implements 10 diagnostic rules (M9301 - M9310):
 * - M9301: unclosed-ring-digit
 * - M9302: unbalanced-branch-parenthesis
 * - M9303: valence-exceeded
 * - M9304: invalid-aromatic-kekule-ring
 * - M9305: unknown-chemical-element
 * - M9306: conflicting-ring-bond-order
 * - M9307: self-loop-bond
 * - M9308: duplicate-atom-bond
 * - M9309: invalid-tetrahedral-chirality
 * - M9310: empty-molecular-graph
 */

import { type DiagnosticItem, SmilesErrorCode } from "../errors.js";
import { ELEMENT_BY_SYMBOL, getMaxAllowedValence } from "../parser/smiles-parser.js";
import type { MolecularGraph, MoleculeBond, SmilesDocument } from "../types.js";

function isSmilesDocument(input: SmilesDocument | MolecularGraph): input is SmilesDocument {
  return "molecules" in input && Array.isArray(input.molecules);
}

export function lintSmiles(input: SmilesDocument | MolecularGraph): DiagnosticItem[] {
  const diagnostics: DiagnosticItem[] = [];
  const molecules: MolecularGraph[] = isSmilesDocument(input) ? input.molecules : [input];

  if (molecules.length === 0) {
    diagnostics.push({
      code: SmilesErrorCode.EMPTY_MOLECULAR_GRAPH.code,
      rule: SmilesErrorCode.EMPTY_MOLECULAR_GRAPH.rule,
      severity: SmilesErrorCode.EMPTY_MOLECULAR_GRAPH.severity,
      message: SmilesErrorCode.EMPTY_MOLECULAR_GRAPH.message("EmptyDocument"),
      range: isSmilesDocument(input) ? input.range : undefined,
    });
    return diagnostics;
  }

  for (const mol of molecules) {
    lintSingleMolecule(mol, diagnostics);
  }

  return diagnostics;
}

function lintSingleMolecule(mol: MolecularGraph, diagnostics: DiagnosticItem[]): void {
  const molName = mol.name || mol.id || "Molecule";

  // M9310: Empty molecular graph
  if (mol.atoms.length === 0) {
    diagnostics.push({
      code: SmilesErrorCode.EMPTY_MOLECULAR_GRAPH.code,
      rule: SmilesErrorCode.EMPTY_MOLECULAR_GRAPH.rule,
      severity: SmilesErrorCode.EMPTY_MOLECULAR_GRAPH.severity,
      message: SmilesErrorCode.EMPTY_MOLECULAR_GRAPH.message(molName),
      range: mol.range,
    });
    return;
  }

  // M9301: Unclosed ring closure digit
  if (mol.unclosedRings && mol.unclosedRings.length > 0) {
    for (const r of mol.unclosedRings) {
      diagnostics.push({
        code: SmilesErrorCode.UNCLOSED_RING_DIGIT.code,
        rule: SmilesErrorCode.UNCLOSED_RING_DIGIT.rule,
        severity: SmilesErrorCode.UNCLOSED_RING_DIGIT.severity,
        message: SmilesErrorCode.UNCLOSED_RING_DIGIT.message(r.ringId, molName),
        range: r.range ?? mol.range,
      });
    }
  }

  // M9302: Unbalanced branch parenthesis
  if (mol.unbalancedParentheses && mol.unbalancedParentheses.length > 0) {
    for (const p of mol.unbalancedParentheses) {
      diagnostics.push({
        code: SmilesErrorCode.UNBALANCED_BRANCH_PARENTHESIS.code,
        rule: SmilesErrorCode.UNBALANCED_BRANCH_PARENTHESIS.rule,
        severity: SmilesErrorCode.UNBALANCED_BRANCH_PARENTHESIS.severity,
        message: SmilesErrorCode.UNBALANCED_BRANCH_PARENTHESIS.message(molName),
        range: p.range ?? mol.range,
      });
    }
  }

  // M9306: Conflicting ring bond order
  if (mol.conflictingRingBonds && mol.conflictingRingBonds.length > 0) {
    for (const c of mol.conflictingRingBonds) {
      diagnostics.push({
        code: SmilesErrorCode.CONFLICTING_RING_BOND_ORDER.code,
        rule: SmilesErrorCode.CONFLICTING_RING_BOND_ORDER.rule,
        severity: SmilesErrorCode.CONFLICTING_RING_BOND_ORDER.severity,
        message: SmilesErrorCode.CONFLICTING_RING_BOND_ORDER.message(c.ringId, molName),
        range: c.range ?? mol.range,
      });
    }
  }

  // Build adjacency lists and check M9307 (self-loop) and M9308 (duplicate bond)
  const adjBonds = new Map<number, MoleculeBond[]>();
  for (const atom of mol.atoms) {
    adjBonds.set(atom.index, []);
  }

  const seenBondPairs = new Set<string>();
  for (const bond of mol.bonds) {
    // M9307: Self-loop bond
    if (bond.source === bond.target) {
      diagnostics.push({
        code: SmilesErrorCode.SELF_LOOP_BOND.code,
        rule: SmilesErrorCode.SELF_LOOP_BOND.rule,
        severity: SmilesErrorCode.SELF_LOOP_BOND.severity,
        message: SmilesErrorCode.SELF_LOOP_BOND.message(bond.source, molName),
        range: bond.range ?? mol.range,
      });
      continue;
    }

    const atomA = Math.min(bond.source, bond.target);
    const atomB = Math.max(bond.source, bond.target);
    const pairKey = `${atomA}:${atomB}`;

    // M9308: Duplicate atom bond
    if (seenBondPairs.has(pairKey)) {
      diagnostics.push({
        code: SmilesErrorCode.DUPLICATE_ATOM_BOND.code,
        rule: SmilesErrorCode.DUPLICATE_ATOM_BOND.rule,
        severity: SmilesErrorCode.DUPLICATE_ATOM_BOND.severity,
        message: SmilesErrorCode.DUPLICATE_ATOM_BOND.message(atomA, atomB, molName),
        range: bond.range ?? mol.range,
      });
    } else {
      seenBondPairs.add(pairKey);
    }

    adjBonds.get(bond.source)?.push(bond);
    adjBonds.get(bond.target)?.push(bond);
  }

  // M9305 (unknown element), M9303 (valence exceeded), M9309 (invalid tetrahedral chirality)
  for (const atom of mol.atoms) {
    const isWildcard = atom.rawSymbol === "*";
    if (!isWildcard && (atom.atomicNumber === 0 || !ELEMENT_BY_SYMBOL.has(atom.element))) {
      diagnostics.push({
        code: SmilesErrorCode.UNKNOWN_CHEMICAL_ELEMENT.code,
        rule: SmilesErrorCode.UNKNOWN_CHEMICAL_ELEMENT.rule,
        severity: SmilesErrorCode.UNKNOWN_CHEMICAL_ELEMENT.severity,
        message: SmilesErrorCode.UNKNOWN_CHEMICAL_ELEMENT.message(atom.rawSymbol ?? atom.element, molName),
        range: atom.range ?? mol.range,
      });
      continue;
    }

    // M9303: Valence exceeded check
    const incident = adjBonds.get(atom.index) ?? [];
    const maxValence = getMaxAllowedValence(atom.element, atom.formalCharge);
    const explicitH = atom.explicitHydrogens ?? 0;

    let actualValence = 0;
    if (!atom.isAromatic) {
      let bondSum = 0;
      for (const b of incident) {
        bondSum += b.isAromatic ? 1.5 : b.order;
      }
      actualValence = Math.round((bondSum + explicitH) * 100) / 100;
    } else {
      let aromCount = 0;
      let exoOrderSum = 0;
      let exoBondCount = 0;
      for (const b of incident) {
        if (b.isAromatic) {
          aromCount++;
        } else {
          exoOrderSum += b.order;
          exoBondCount++;
        }
      }

      if (atom.element === "C") {
        if (aromCount === 2) {
          if (exoBondCount === 0 && explicitH <= 1) {
            actualValence = 3 + explicitH;
          } else if (exoBondCount === 1 && exoOrderSum === 1 && explicitH === 0) {
            actualValence = 4;
          } else if (exoBondCount === 1 && exoOrderSum === 2 && explicitH === 0) {
            // Exocyclic carbonyl c(=O) in pyridone/xanthine
            actualValence = 4;
          } else {
            actualValence = 3 + exoOrderSum + explicitH;
          }
        } else if (aromCount === 3) {
          actualValence = 4 + exoOrderSum + explicitH;
        } else {
          actualValence = Math.ceil(aromCount * 1.5) + exoOrderSum + explicitH;
        }
      } else {
        const ringBase = atom.element === "O" || atom.element === "S" ? 2 : aromCount >= 2 ? 3 : aromCount;
        actualValence = ringBase + exoOrderSum + explicitH;
      }
    }

    if (actualValence > maxValence) {
      diagnostics.push({
        code: SmilesErrorCode.VALENCE_EXCEEDED.code,
        rule: SmilesErrorCode.VALENCE_EXCEEDED.rule,
        severity: SmilesErrorCode.VALENCE_EXCEEDED.severity,
        message: SmilesErrorCode.VALENCE_EXCEEDED.message(atom.element, atom.index, molName, actualValence, maxValence),
        range: atom.range ?? mol.range,
      });
    }

    // M9309: Invalid tetrahedral chirality
    if (atom.chiralTag === "@" || atom.chiralTag === "@@") {
      const totalH = (atom.explicitHydrogens ?? 0) + atom.implicitHydrogens;
      const totalSubstituents = incident.length + totalH;
      if (totalSubstituents < 4 || totalH >= 2) {
        diagnostics.push({
          code: SmilesErrorCode.INVALID_TETRAHEDRAL_CHIRALITY.code,
          rule: SmilesErrorCode.INVALID_TETRAHEDRAL_CHIRALITY.rule,
          severity: SmilesErrorCode.INVALID_TETRAHEDRAL_CHIRALITY.severity,
          message: SmilesErrorCode.INVALID_TETRAHEDRAL_CHIRALITY.message(atom.index, molName),
          range: atom.range ?? mol.range,
        });
      } else {
        const signatures = new Set<string>();
        if (totalH === 1) {
          signatures.add("H");
        }
        for (const b of incident) {
          const neighborIdx = b.source === atom.index ? b.target : b.source;
          const sig = computeSubstituentSignature(mol, adjBonds, neighborIdx, atom.index, b.order, 5);
          signatures.add(sig);
        }
        if (signatures.size < 4) {
          diagnostics.push({
            code: SmilesErrorCode.INVALID_TETRAHEDRAL_CHIRALITY.code,
            rule: SmilesErrorCode.INVALID_TETRAHEDRAL_CHIRALITY.rule,
            severity: SmilesErrorCode.INVALID_TETRAHEDRAL_CHIRALITY.severity,
            message: SmilesErrorCode.INVALID_TETRAHEDRAL_CHIRALITY.message(atom.index, molName),
            range: atom.range ?? mol.range,
          });
        }
      }
    }
  }

  // M9304: Aromatic Kekulé / Hückel 4n+2 validation
  const aromaticAtoms = mol.atoms.filter((a) => a.isAromatic);
  if (aromaticAtoms.length > 0) {
    if (!validateAromaticSystem(mol, adjBonds)) {
      diagnostics.push({
        code: SmilesErrorCode.INVALID_AROMATIC_KEKULE_RING.code,
        rule: SmilesErrorCode.INVALID_AROMATIC_KEKULE_RING.rule,
        severity: SmilesErrorCode.INVALID_AROMATIC_KEKULE_RING.severity,
        message: SmilesErrorCode.INVALID_AROMATIC_KEKULE_RING.message(molName),
        range: aromaticAtoms[0]?.range ?? mol.range,
      });
    }
  }
}

function computeSubstituentSignature(
  mol: MolecularGraph,
  adjBonds: Map<number, MoleculeBond[]>,
  currentIdx: number,
  fromIdx: number,
  incomingOrder: number,
  depth: number,
): string {
  const atom = mol.atoms[currentIdx];
  if (!atom) return "null";
  const totalH = (atom.explicitHydrogens ?? 0) + atom.implicitHydrogens;
  const base = `${incomingOrder}:${atom.isotope ?? ""}${atom.element}H${totalH}q${atom.formalCharge}`;
  if (depth <= 0) return base;

  const childSigs: string[] = [];
  for (const b of adjBonds.get(currentIdx) ?? []) {
    const nextIdx = b.source === currentIdx ? b.target : b.source;
    if (nextIdx === fromIdx) continue;
    childSigs.push(computeSubstituentSignature(mol, adjBonds, nextIdx, currentIdx, b.order, depth - 1));
  }
  childSigs.sort();
  return childSigs.length > 0 ? `${base}(${childSigs.join(",")})` : base;
}

/**
 * Validates that all aromatic atoms belong to rings and that every elementary aromatic ring
 * satisfies Hückel's 4n+2 pi-electron rule and Kekulé valence constraints.
 */
function validateAromaticSystem(mol: MolecularGraph, adjBonds: Map<number, MoleculeBond[]>): boolean {
  const aromSet = new Set<number>();
  for (const a of mol.atoms) {
    if (a.isAromatic) aromSet.add(a.index);
  }

  // Build aromatic adjacency list
  const aromAdj = new Map<number, number[]>();
  for (const idx of aromSet) {
    aromAdj.set(idx, []);
  }
  for (const b of mol.bonds) {
    if (b.source === b.target) continue;
    if (aromSet.has(b.source) && aromSet.has(b.target)) {
      aromAdj.get(b.source)?.push(b.target);
      aromAdj.get(b.target)?.push(b.source);
    }
  }

  // Every aromatic atom must have at least 2 aromatic neighbors (must be in a ring)
  for (const idx of aromSet) {
    const neighbors = aromAdj.get(idx) ?? [];
    if (neighbors.length < 2) {
      return false;
    }
  }

  // Find elementary chordless cycles in the aromatic subgraph
  const rings = findChordlessCycles(aromSet, aromAdj);
  if (rings.length === 0) {
    return false;
  }

  // Verify every aromatic atom belongs to at least one cycle
  const atomsInRings = new Set<number>();
  for (const r of rings) {
    for (const u of r) atomsInRings.add(u);
  }
  for (const idx of aromSet) {
    if (!atomsInRings.has(idx)) {
      return false;
    }
  }

  // Check Hückel 4n+2 rule on each elementary aromatic cycle
  for (const ring of rings) {
    let piElectrons = 0;
    for (const u of ring) {
      const atom = mol.atoms[u]!;
      const incident = adjBonds.get(u) ?? [];
      const aromDegree = (aromAdj.get(u) ?? []).length;

      let hasExocyclicDouble = false;
      let exoSingleCount = atom.explicitHydrogens ?? 0;

      for (const b of incident) {
        const other = b.source === u ? b.target : b.source;
        if (!aromSet.has(other)) {
          if (b.order === 2) {
            hasExocyclicDouble = true;
          } else if (b.order === 1) {
            exoSingleCount++;
          }
        }
      }

      if (atom.element === "C") {
        if (hasExocyclicDouble) {
          piElectrons += 0;
        } else if (atom.formalCharge === -1) {
          piElectrons += 2;
        } else if (atom.formalCharge === 1) {
          piElectrons += 0;
        } else {
          piElectrons += 1;
        }
      } else if (atom.element === "N" || atom.element === "P" || atom.element === "As") {
        if (atom.formalCharge === 1) {
          piElectrons += 1;
        } else if (exoSingleCount >= 1 || aromDegree >= 3) {
          piElectrons += 2;
        } else {
          piElectrons += 1;
        }
      } else if (atom.element === "O" || atom.element === "S" || atom.element === "Se") {
        if (atom.formalCharge === 1) {
          piElectrons += 1;
        } else {
          piElectrons += 2;
        }
      } else if (atom.element === "B") {
        piElectrons += atom.formalCharge === -1 ? 1 : 0;
      } else {
        piElectrons += 1;
      }
    }

    // Hückel's rule: 4n + 2 (2, 6, 10, 14, 18, ...)
    if (piElectrons < 2 || (piElectrons - 2) % 4 !== 0) {
      return false;
    }
  }

  return true;
}

/**
 * Finds chordless elementary cycles in an undirected graph.
 */
export function findChordlessCycles(vertices: Set<number>, adj: Map<number, number[]>): number[][] {
  const cycles: number[][] = [];
  const seenCycleKeys = new Set<string>();

  for (const start of vertices) {
    const neighbors = adj.get(start) ?? [];
    for (let i = 0; i < neighbors.length; i++) {
      for (let j = i + 1; j < neighbors.length; j++) {
        const first = neighbors[i]!;
        const last = neighbors[j]!;
        // Find shortest path between `first` and `last` in `vertices \ {start}`
        const path = bfsShortestPath(first, last, start, adj);
        if (path) {
          const cycle = [start, ...path];
          const cycleSet = new Set<number>(cycle);
          // Verify cycle is chordless (every vertex in `cycle` has exactly 2 neighbors in `cycleSet`)
          let isChordless = true;
          for (const u of cycle) {
            let degInCycle = 0;
            for (const w of adj.get(u) ?? []) {
              if (cycleSet.has(w)) degInCycle++;
            }
            if (degInCycle !== 2) {
              isChordless = false;
              break;
            }
          }
          if (!isChordless) continue;

          const sortedKey = [...cycle].sort((a, b) => a - b).join(",");
          if (!seenCycleKeys.has(sortedKey)) {
            seenCycleKeys.add(sortedKey);
            cycles.push(cycle);
          }
        }
      }
    }
  }

  return cycles;
}

function bfsShortestPath(
  source: number,
  target: number,
  excludedNode: number,
  adj: Map<number, number[]>,
): number[] | null {
  const queue: number[] = [source];
  const parent = new Map<number, number>();
  parent.set(source, -1);

  let head = 0;
  while (head < queue.length) {
    const u = queue[head++]!;
    if (u === target) {
      const path: number[] = [];
      let curr = target;
      while (curr !== -1) {
        path.push(curr);
        curr = parent.get(curr) ?? -1;
      }
      path.reverse();
      return path;
    }

    for (const v of adj.get(u) ?? []) {
      if (v === excludedNode) continue;
      // Avoid direct edge from source to target if length would be 2
      if (u === source && v === target) continue;
      if (!parent.has(v)) {
        parent.set(v, u);
        queue.push(v);
      }
    }
  }

  return null;
}
