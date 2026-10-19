// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Conductance Matrix [G] Builder for Dommel's EMT Companion Circuit Algorithm.
 */

import { denseToCCS, sparseLuFactor, sparseLuSolve, type CCSMatrix, type SparseLU } from "../sparse-solver-bridge.js";
import type {
  BergeronLineState,
  BreakerPoleState,
  FmuIbrState,
  RlcBranchState,
  TransformerWindingState,
} from "./types.js";

export interface CompanionSubsystem {
  id: number;
  globalNodes: Int32Array;
  nSub: number;
  Gdense: Float64Array[];
  Gccs: CCSMatrix;
  lu: SparseLU;
  bLocal: Float64Array;
  vLocal: Float64Array;
}

export interface CompanionSystem {
  nNodes: number;
  Gdense: Float64Array[];
  Gccs: CCSMatrix;
  lu: SparseLU;
  subsystemCount: number;
  nodeToSubsystem: Int32Array;
  nodeToLocalIdx: Int32Array;
  subsystems: CompanionSubsystem[];
  stampConductance(i: number, j: number, g: number): void;
  refactorizeSubsystem(globalNode: number): void;
  refactorizeAll(): void;
  solve(bVec: Float64Array, vVec: Float64Array): void;
}

/**
 * Stamps a two-terminal conductance g between node i and node j.
 * Node -1 represents ground (GND / reference).
 */
export function stampTwoTerminalConductance(dense: Float64Array[], n: number, i: number, j: number, g: number): void {
  if (i === ("__proto__" as any) || j === ("__proto__" as any) || typeof i !== "number" || typeof j !== "number")
    return;
  if (i >= 0 && i < n) {
    const row = dense[i];
    if (row) row[i] = row[i]! + g;
  }
  if (j >= 0 && j < n) {
    const row = dense[j];
    if (row) row[j] = row[j]! + g;
  }
  if (i >= 0 && j >= 0 && i < n && j < n) {
    const rowI = dense[i];
    const rowJ = dense[j];
    if (rowI && rowJ) {
      rowI[j] = rowI[j]! - g;
      rowJ[i] = rowJ[i]! - g;
    }
  }
}

/**
 * Stamps a shunt conductance g from node i to ground.
 */
export function stampShuntConductance(dense: Float64Array[], n: number, i: number, g: number): void {
  if (i === ("__proto__" as any) || typeof i !== "number") return;
  if (i >= 0 && i < n) {
    const row = dense[i];
    if (row) row[i] = row[i]! + g;
  }
}

/**
 * Stamps a 4-terminal coupled transformer winding with primary terminals (pPos, pNeg),
 * secondary terminals (sPos, sNeg), primary-referred leakage conductance g, and turns ratio a = V_p / V_s.
 *
 * Implements the exact power-invariant nodal admittance block:
 *   i_p =  g * (v_p - a * v_s)
 *   i_s = -a * g * (v_p - a * v_s) = -a * g * v_p + a^2 * g * v_s
 */
export function stampTransformerWinding(
  dense: Float64Array[],
  n: number,
  pPos: number,
  pNeg: number,
  sPos: number,
  sNeg: number,
  g: number,
  a: number,
): void {
  // Primary self-conductance: g between (pPos, pNeg)
  stampTwoTerminalConductance(dense, n, pPos, pNeg, g);

  // Secondary self-conductance: a^2 * g between (sPos, sNeg)
  stampTwoTerminalConductance(dense, n, sPos, sNeg, a * a * g);

  // Mutual coupling: -a * g between primary (pPos, pNeg) and secondary (sPos, sNeg)
  const ag = a * g;
  const addEntry = (r: number, c: number, val: number) => {
    if (r === ("__proto__" as any) || c === ("__proto__" as any) || typeof r !== "number" || typeof c !== "number")
      return;
    if (r >= 0 && r < n && c >= 0 && c < n) {
      const row = dense[r];
      if (row) row[c] = row[c]! + val;
    }
  };

  addEntry(pPos, sPos, -ag);
  addEntry(sPos, pPos, -ag);

  addEntry(pPos, sNeg, ag);
  addEntry(sNeg, pPos, ag);

  addEntry(pNeg, sPos, ag);
  addEntry(sPos, pNeg, ag);

  addEntry(pNeg, sNeg, -ag);
  addEntry(sNeg, pNeg, -ag);
}

/**
 * Builds and factorizes the system conductance matrix [G], automatically partitioning
 * the network into decoupled electrical subsystems (BBDF / traveling-wave network tearing)
 * separated by Bergeron and FD transmission lines.
 */
export function buildCompanionSystem(
  nNodes: number,
  rlcBranches: RlcBranchState[],
  lines: BergeronLineState[],
  fmus: FmuIbrState[],
  sources?: { node: number; gSource?: number | undefined }[],
  transformerWindings?: TransformerWindingState[],
  breakerPoles?: BreakerPoleState[],
  dynamicPairs?: { nodeA: number; nodeB: number }[],
): CompanionSystem {
  const dense: Float64Array[] = [];
  for (let i = 0; i < nNodes; i++) {
    dense.push(new Float64Array(nNodes));
  }

  // 1. Stamp RLC branches (including 3-phase zero-sequence mutual coupling when active)
  const addEntry = (r: number, c: number, val: number) => {
    if (r === ("__proto__" as any) || c === ("__proto__" as any) || typeof r !== "number" || typeof c !== "number")
      return;
    if (r >= 0 && r < nNodes && c >= 0 && c < nNodes) {
      const row = dense[r];
      if (row) row[c] = row[c]! + val;
    }
  };
  for (let i = 0; i < rlcBranches.length; i++) {
    const b = rlcBranches[i]!;
    stampTwoTerminalConductance(dense, nNodes, b.fromNode, b.toNode, b.gTotal);
    if (b.hasZeroSeq && b.gMutual && i % 3 === 0 && i + 2 < rlcBranches.length) {
      const gm = b.gMutual;
      const phases = [rlcBranches[i]!, rlcBranches[i + 1]!, rlcBranches[i + 2]!];
      for (let p = 0; p < 3; p++) {
        for (let q = p + 1; q < 3; q++) {
          const fp = phases[p]!.fromNode;
          const tp = phases[p]!.toNode;
          const fq = phases[q]!.fromNode;
          const tq = phases[q]!.toNode;
          addEntry(fp, fq, gm);
          addEntry(fq, fp, gm);
          addEntry(tp, tq, gm);
          addEntry(tq, tp, gm);
          addEntry(fp, tq, -gm);
          addEntry(tq, fp, -gm);
          addEntry(tp, fq, -gm);
          addEntry(fq, tp, -gm);
        }
      }
    }
  }

  // 1b. Stamp 4-terminal coupled transformer windings (with exact turns ratio and vector group)
  if (transformerWindings) {
    for (const w of transformerWindings) {
      stampTransformerWinding(dense, nNodes, w.pPosNode, w.pNegNode, w.sPosNode, w.sNegNode, w.gLeakage, w.turnsRatio);
    }
  }

  // 1c. Stamp circuit breaker poles
  if (breakerPoles) {
    for (const bp of breakerPoles) {
      stampTwoTerminalConductance(dense, nNodes, bp.fromNode, bp.toNode, bp.gCurrent);
    }
  }

  // 2. Stamp transmission lines (Bergeron characteristic surge admittance Gc = 1 / Zc)
  for (const line of lines) {
    stampShuntConductance(dense, nNodes, line.fromNode, line.gc);
    stampShuntConductance(dense, nNodes, line.toNode, line.gc);
  }

  // 3. Stamp FMU Norton equivalent interface conductance (for co-simulation stability)
  for (const fmu of fmus) {
    stampShuntConductance(dense, nNodes, fmu.node, fmu.gEq);
  }

  // 4. Stamp AC / DC voltage sources (Norton internal source conductance)
  if (sources) {
    for (const src of sources) {
      stampShuntConductance(dense, nNodes, src.node, src.gSource ?? 1e3);
    }
  }

  // Add small numerical ground conductance to prevent isolated floating node singularities
  const gGroundRegularizer = 1e-7;
  for (let i = 0; i < nNodes; i++) {
    dense[i]![i] = dense[i]![i]! + gGroundRegularizer;
  }

  // 5. Partition into connected electrical subsystems (traveling-wave network tearing)
  const parent = new Int32Array(nNodes);
  for (let i = 0; i < nNodes; i++) parent[i] = i;
  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) root = parent[root]!;
    let cur = x;
    while (cur !== root) {
      const nxt = parent[cur]!;
      parent[cur] = root;
      cur = nxt;
    }
    return root;
  };
  const unite = (a: number, b: number) => {
    if (a < 0 || b < 0 || a >= nNodes || b >= nNodes) return;
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  for (let r = 0; r < nNodes; r++) {
    for (let c = r + 1; c < nNodes; c++) {
      if (Math.abs(dense[r]![c]!) > 1e-15 || Math.abs(dense[c]![r]!) > 1e-15) {
        unite(r, c);
      }
    }
  }
  if (breakerPoles) {
    for (const bp of breakerPoles) unite(bp.fromNode, bp.toNode);
  }
  if (dynamicPairs) {
    for (const dp of dynamicPairs) unite(dp.nodeA, dp.nodeB);
  }

  const rootToGroup = new Map<number, number[]>();
  for (let i = 0; i < nNodes; i++) {
    const r = find(i);
    let grp = rootToGroup.get(r);
    if (!grp) {
      grp = [];
      rootToGroup.set(r, grp);
    }
    grp.push(i);
  }

  const nodeToSubsystem = new Int32Array(nNodes);
  const nodeToLocalIdx = new Int32Array(nNodes);
  const subsystems: CompanionSubsystem[] = [];

  let subId = 0;
  for (const grp of rootToGroup.values()) {
    const nSub = grp.length;
    const globalNodes = new Int32Array(grp);
    const subDense: Float64Array[] = [];
    for (let localR = 0; localR < nSub; localR++) {
      const gR = globalNodes[localR]!;
      nodeToSubsystem[gR] = subId;
      nodeToLocalIdx[gR] = localR;
      const row = new Float64Array(nSub);
      for (let localC = 0; localC < nSub; localC++) {
        row[localC] = dense[gR]![globalNodes[localC]!]!;
      }
      subDense.push(row);
    }
    const subCcs = denseToCCS(subDense, nSub);
    const subLu = sparseLuFactor(subCcs);
    subsystems.push({
      id: subId,
      globalNodes,
      nSub,
      Gdense: subDense,
      Gccs: subCcs,
      lu: subLu,
      bLocal: new Float64Array(nSub),
      vLocal: new Float64Array(nSub),
    });
    subId++;
  }

  const syncSubsystemFromGlobal = (sub: CompanionSubsystem) => {
    const nSub = sub.nSub;
    const gn = sub.globalNodes;
    for (let r = 0; r < nSub; r++) {
      const gR = gn[r]!;
      const row = sub.Gdense[r]!;
      for (let c = 0; c < nSub; c++) {
        row[c] = dense[gR]![gn[c]!]!;
      }
    }
    sub.Gccs = denseToCCS(sub.Gdense, nSub);
    sub.lu = sparseLuFactor(sub.Gccs);
  };

  // Convert full matrix to CCS sparse matrix format and compute Sparse LU factorization
  const Gccs = denseToCCS(dense, nNodes);
  const lu = sparseLuFactor(Gccs);

  return {
    nNodes,
    Gdense: dense,
    Gccs,
    lu,
    subsystemCount: subsystems.length,
    nodeToSubsystem,
    nodeToLocalIdx,
    subsystems,
    stampConductance(i: number, j: number, g: number) {
      stampTwoTerminalConductance(dense, nNodes, i, j, g);
    },
    refactorizeSubsystem(globalNode: number) {
      if (subsystems.length <= 1 || globalNode < 0 || globalNode >= nNodes) {
        this.Gccs = denseToCCS(dense, nNodes);
        this.lu = sparseLuFactor(this.Gccs);
        return;
      }
      const sId = nodeToSubsystem[globalNode]!;
      syncSubsystemFromGlobal(subsystems[sId]!);
    },
    refactorizeAll() {
      this.Gccs = denseToCCS(dense, nNodes);
      this.lu = sparseLuFactor(this.Gccs);
      if (subsystems.length > 1) {
        for (const sub of subsystems) {
          syncSubsystemFromGlobal(sub);
        }
      }
    },
    solve(bVec: Float64Array, vVec: Float64Array) {
      if (subsystems.length <= 1) {
        sparseLuSolve(this.lu, bVec, vVec);
        return;
      }
      for (let s = 0; s < subsystems.length; s++) {
        const sub = subsystems[s]!;
        const nSub = sub.nSub;
        const gn = sub.globalNodes;
        const bLoc = sub.bLocal;
        const vLoc = sub.vLocal;
        for (let i = 0; i < nSub; i++) {
          bLoc[i] = bVec[gn[i]!]!;
        }
        sparseLuSolve(sub.lu, bLoc, vLoc);
        for (let i = 0; i < nSub; i++) {
          vVec[gn[i]!] = vLoc[i]!;
        }
      }
    },
  };
}
