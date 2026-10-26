// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/spice — Modified Nodal Analysis (MNA) Linear Formulation & Subcircuit Flattener.
 *
 * Provides:
 * 1. Subcircuit flattener: Expands hierarchical 'X' calls into flat components with scoped prefixes.
 * 2. MNA Matrix structure and linear equation solver via Gaussian elimination with partial pivoting.
 * 3. Passive, active, and source matrix stamps.
 */

import type { SpiceCircuit, SpiceComponent, SpiceSubcircuit } from "../types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Subcircuit Flattener
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recursively flattens all subcircuit instances ('X') in a circuit into a single flat list of components.
 */
export function flattenSpiceCircuit(circuit: SpiceCircuit): SpiceComponent[] {
  const result: SpiceComponent[] = [];

  for (const comp of circuit.components) {
    if (comp.kind === "X" && comp.subcktName) {
      flattenInstance(comp, "", circuit.subcircuits, result);
    } else {
      result.push(comp);
    }
  }

  return result;
}

function flattenInstance(
  instance: SpiceComponent,
  prefix: string,
  subcircuits: Map<string, SpiceSubcircuit>,
  out: SpiceComponent[],
): void {
  const subName = (instance.subcktName ?? "").toUpperCase();
  const sub = subcircuits.get(subName);
  if (!sub) return;

  const currentPrefix = prefix ? `${prefix}.${instance.name}` : instance.name;

  // Node substitution map from subcircuit formal ports to instance actual nodes
  const nodeMap = new Map<string, string>();
  for (let i = 0; i < sub.ports.length && i < instance.nodes.length; i++) {
    const port = sub.ports[i];
    const node = instance.nodes[i];
    if (port !== undefined && node !== undefined) {
      nodeMap.set(port.toUpperCase(), node);
    }
  }

  const resolveNode = (formalNode: string): string => {
    const upper = formalNode.toUpperCase();
    if (upper === "0" || upper === "GND") return "0";
    if (nodeMap.has(upper)) return nodeMap.get(upper)!;
    return `${currentPrefix}.${formalNode}`;
  };

  for (const child of sub.components) {
    if (child.kind === "X" && child.subcktName) {
      const childResolvedNodes = child.nodes.map(resolveNode);
      const childInst: SpiceComponent = {
        ...child,
        name: child.name,
        nodes: childResolvedNodes,
      };
      flattenInstance(childInst, currentPrefix, subcircuits, out);
    } else {
      const mappedNodes = child.nodes.map(resolveNode);
      const clonedComp: SpiceComponent = {
        ...child,
        name: `${currentPrefix}.${child.name}`,
        nodes: mappedNodes,
        params: new Map(child.params),
      };
      if (child.controlNodes) {
        clonedComp.controlNodes = [resolveNode(child.controlNodes[0]), resolveNode(child.controlNodes[1])];
      }
      if (child.controlSource) {
        clonedComp.controlSource = `${currentPrefix}.${child.controlSource}`;
      }
      out.push(clonedComp);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Real Dense Matrix & Linear System Solver
// ─────────────────────────────────────────────────────────────────────────────

export class DenseMatrix {
  public data: Float64Array;
  public size: number;

  constructor(size: number) {
    this.size = size;
    this.data = new Float64Array(size * size);
  }

  public get(row: number, col: number): number {
    return this.data[row * this.size + col] ?? 0;
  }

  public set(row: number, col: number, val: number): void {
    this.data[row * this.size + col] = val;
  }

  public add(row: number, col: number, delta: number): void {
    const idx = row * this.size + col;
    this.data[idx] = (this.data[idx] ?? 0) + delta;
  }

  public clear(): void {
    this.data.fill(0);
  }
}

/**
 * Solves A * x = b in-place using Gaussian elimination with partial pivoting.
 */
export function solveLinearSystem(A: DenseMatrix, b: Float64Array): Float64Array | null {
  const n = A.size;
  const M = new Float64Array(A.data); // Clone
  const rhs = new Float64Array(b); // Clone

  for (let i = 0; i < n; i++) {
    // Partial pivoting
    let maxRow = i;
    let maxVal = Math.abs(M[i * n + i] ?? 0);
    for (let k = i + 1; k < n; k++) {
      const val = Math.abs(M[k * n + i] ?? 0);
      if (val > maxVal) {
        maxVal = val;
        maxRow = k;
      }
    }

    if (maxVal < 1e-15) {
      return null; // Singular or ill-conditioned
    }

    if (maxRow !== i) {
      // Swap rows in M
      for (let c = i; c < n; c++) {
        const tmp = M[i * n + c] ?? 0;
        M[i * n + c] = M[maxRow * n + c] ?? 0;
        M[maxRow * n + c] = tmp;
      }
      // Swap in rhs
      const tmpRhs = rhs[i] ?? 0;
      rhs[i] = rhs[maxRow] ?? 0;
      rhs[maxRow] = tmpRhs;
    }

    // Eliminate below
    const pivot = M[i * n + i] ?? 1.0;
    for (let r = i + 1; r < n; r++) {
      const factor = (M[r * n + i] ?? 0) / pivot;
      for (let c = i; c < n; c++) {
        M[r * n + c] = (M[r * n + c] ?? 0) - factor * (M[i * n + c] ?? 0);
      }
      rhs[r] = (rhs[r] ?? 0) - factor * (rhs[i] ?? 0);
    }
  }

  // Back-substitution
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = rhs[i] ?? 0;
    for (let c = i + 1; c < n; c++) {
      sum -= (M[i * n + c] ?? 0) * (x[c] ?? 0);
    }
    const diag = M[i * n + i] ?? 1.0;
    x[i] = sum / diag;
  }

  return x;
}

// ─────────────────────────────────────────────────────────────────────────────
// Node & Branch Mapper
// ─────────────────────────────────────────────────────────────────────────────

export interface MnaIndexing {
  nodeToIdx: Map<string, number>;
  idxToNode: string[];
  branchToIdx: Map<string, number>;
  numNodes: number;
  numBranches: number;
  totalSize: number;
}

export function buildMnaIndexing(components: SpiceComponent[]): MnaIndexing {
  const nodeSet = new Set<string>();
  const branchSources: string[] = [];

  for (const comp of components) {
    for (const node of comp.nodes) {
      const norm = node.toUpperCase();
      if (norm !== "0" && norm !== "GND") {
        nodeSet.add(norm);
      }
    }
    // Independent V, controlled E, H require auxiliary branch rows
    if (comp.kind === "V" || comp.kind === "E" || comp.kind === "H") {
      branchSources.push(comp.name);
    }
  }

  const idxToNode = Array.from(nodeSet);
  const nodeToIdx = new Map<string, number>();
  for (let i = 0; i < idxToNode.length; i++) {
    const node = idxToNode[i];
    if (node !== undefined) {
      nodeToIdx.set(node, i);
    }
  }

  const branchToIdx = new Map<string, number>();
  const numNodes = idxToNode.length;
  for (let i = 0; i < branchSources.length; i++) {
    const src = branchSources[i];
    if (src !== undefined) {
      branchToIdx.set(src, numNodes + i);
    }
  }

  return {
    nodeToIdx,
    idxToNode,
    branchToIdx,
    numNodes,
    numBranches: branchSources.length,
    totalSize: numNodes + branchSources.length,
  };
}

/**
 * Stamps a two-terminal conductance G between node n1 and n2 into the MNA matrix.
 */
export function stampConductance(matrix: DenseMatrix, indexing: MnaIndexing, n1: string, n2: string, g: number): void {
  const i1 = indexing.nodeToIdx.get(n1.toUpperCase()) ?? -1;
  const i2 = indexing.nodeToIdx.get(n2.toUpperCase()) ?? -1;

  if (i1 >= 0) matrix.add(i1, i1, g);
  if (i2 >= 0) matrix.add(i2, i2, g);
  if (i1 >= 0 && i2 >= 0) {
    matrix.add(i1, i2, -g);
    matrix.add(i2, i1, -g);
  }
}

/**
 * Stamps a current source I injecting current from n1 to n2 into the RHS vector.
 */
export function stampCurrentSource(
  rhs: Float64Array,
  indexing: MnaIndexing,
  n1: string,
  n2: string,
  current: number,
): void {
  const i1 = indexing.nodeToIdx.get(n1.toUpperCase()) ?? -1;
  const i2 = indexing.nodeToIdx.get(n2.toUpperCase()) ?? -1;

  // Current leaves n1, enters n2
  if (i1 >= 0) rhs[i1] = (rhs[i1] ?? 0) - current;
  if (i2 >= 0) rhs[i2] = (rhs[i2] ?? 0) + current;
}

/**
 * Stamps an independent voltage source V between n1 and n2.
 */
export function stampVoltageSource(
  matrix: DenseMatrix,
  rhs: Float64Array,
  indexing: MnaIndexing,
  sourceName: string,
  n1: string,
  n2: string,
  voltage: number,
): void {
  const branchIdx = indexing.branchToIdx.get(sourceName);
  if (branchIdx === undefined) return;

  const i1 = indexing.nodeToIdx.get(n1.toUpperCase()) ?? -1;
  const i2 = indexing.nodeToIdx.get(n2.toUpperCase()) ?? -1;

  if (i1 >= 0) {
    matrix.add(i1, branchIdx, 1.0);
    matrix.add(branchIdx, i1, 1.0);
  }
  if (i2 >= 0) {
    matrix.add(i2, branchIdx, -1.0);
    matrix.add(branchIdx, i2, -1.0);
  }

  rhs[branchIdx] = voltage;
}
