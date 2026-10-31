// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/spice — Modified Nodal Analysis (MNA) Linear Formulation & Subcircuit Flattener.
 *
 * Provides:
 * 1. Subcircuit flattener: Expands hierarchical 'X' calls into flat components with scoped prefixes.
 * 2. MNA Matrix structure and linear equation solver via Gaussian elimination with partial pivoting.
 * 3. Passive, active, and source matrix stamps.
 */

import { parseSpiceNumber } from "../parser/spice-parser.js";
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
      flattenInstance(comp, "", circuit.subcircuits, circuit, new Map(), result);
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
  circuit: SpiceCircuit,
  parentParams: Map<string, number>,
  out: SpiceComponent[],
): void {
  const subName = (instance.subcktName ?? "").toUpperCase();
  const sub = subcircuits.get(subName);
  if (!sub) return;

  const currentPrefix = prefix ? `${prefix}.${instance.name}` : instance.name;

  // Register any local subcircuit models into top-level circuit models
  for (const m of sub.models) {
    const mKey = m.name.toUpperCase();
    if (!circuit.models.has(mKey)) {
      circuit.models.set(mKey, m);
    }
  }

  // Merge parameter scopes: parentParams -> sub.params -> instance.params
  const mergedParams = new Map<string, number>(parentParams);
  for (const [k, v] of sub.params) {
    const num = typeof v === "number" ? v : parseSpiceNumber(String(v), mergedParams);
    if (!Number.isNaN(num)) {
      mergedParams.set(k.toUpperCase(), num);
    }
  }
  for (const [k, v] of instance.params) {
    const num = typeof v === "number" ? v : parseSpiceNumber(String(v), mergedParams);
    if (!Number.isNaN(num)) {
      mergedParams.set(k.toUpperCase(), num);
    }
  }

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
    if (upper === "0" || upper === "GND" || circuit.globalNodes.has(formalNode) || circuit.globalNodes.has(upper)) {
      return upper === "GND" ? "0" : formalNode;
    }
    const mapped = nodeMap.get(upper);
    if (mapped !== undefined) return mapped;
    return `${currentPrefix}.${formalNode}`;
  };

  // Combine global and local subcircuits
  const localSubcircuits = new Map<string, SpiceSubcircuit>(subcircuits);
  for (const nested of sub.subcircuits) {
    localSubcircuits.set(nested.name.toUpperCase(), nested);
  }

  for (const child of sub.components) {
    if (child.kind === "X" && child.subcktName) {
      const childResolvedNodes = child.nodes.map(resolveNode);
      const childInst: SpiceComponent = {
        ...child,
        name: child.name,
        nodes: childResolvedNodes,
      };
      flattenInstance(childInst, currentPrefix, localSubcircuits, circuit, mergedParams, out);
    } else if (child.kind === "K") {
      const l1 = child.inductor1 ?? child.nodes[0] ?? "";
      const l2 = child.inductor2 ?? child.nodes[1] ?? "";
      const prefL1 = l1 ? `${currentPrefix}.${l1}` : "";
      const prefL2 = l2 ? `${currentPrefix}.${l2}` : "";
      const resolvedVal =
        child.rawValueExpr !== undefined
          ? parseSpiceNumber(child.rawValueExpr, mergedParams)
          : (child.value ?? child.couplingFactor ?? 1.0);
      const kVal = !Number.isNaN(resolvedVal) ? resolvedVal : (child.value ?? 1.0);
      out.push({
        ...child,
        name: `${currentPrefix}.${child.name}`,
        nodes: [prefL1, prefL2],
        inductor1: prefL1,
        inductor2: prefL2,
        value: kVal,
        couplingFactor: kVal,
        params: new Map(child.params),
      });
    } else {
      const mappedNodes = child.nodes.map(resolveNode);
      let resolvedValue = child.value;
      if (child.rawValueExpr !== undefined) {
        const evaluated = parseSpiceNumber(child.rawValueExpr, mergedParams);
        if (!Number.isNaN(evaluated)) {
          resolvedValue = evaluated;
        }
      }
      const clonedParams = new Map<string, number | string>();
      for (const [pk, pv] of child.params) {
        if (typeof pv === "string") {
          const evalP = parseSpiceNumber(pv, mergedParams);
          clonedParams.set(pk, !Number.isNaN(evalP) ? evalP : pv);
        } else {
          clonedParams.set(pk, pv);
        }
      }
      const clonedComp: SpiceComponent = {
        ...child,
        name: `${currentPrefix}.${child.name}`,
        nodes: mappedNodes,
        value: resolvedValue,
        params: clonedParams,
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
 * Dense LU factorization with partial pivoting and zero-allocation solve.
 * Can be reused across Newton-Raphson iterations or transient time steps.
 */
export class DenseLU {
  public size: number;
  public lu: Float64Array;
  public piv: Int32Array;

  constructor(size: number) {
    this.size = size;
    this.lu = new Float64Array(size * size);
    this.piv = new Int32Array(size);
  }

  /**
   * Factorizes A into P * L * U in-place.
   * Returns true on success, false if matrix is singular.
   */
  public factorize(A: DenseMatrix): boolean {
    const n = this.size;
    this.lu.set(A.data);
    const lu = this.lu;
    const piv = this.piv;
    for (let i = 0; i < n; i++) piv[i] = i;

    for (let i = 0; i < n; i++) {
      // Partial pivoting
      let maxRow = i;
      let maxVal = Math.abs(lu[i * n + i] ?? 0);
      for (let k = i + 1; k < n; k++) {
        const val = Math.abs(lu[k * n + i] ?? 0);
        if (val > maxVal) {
          maxVal = val;
          maxRow = k;
        }
      }

      if (maxVal < 1e-15) {
        return false; // Singular
      }

      if (maxRow !== i) {
        for (let c = 0; c < n; c++) {
          const tmp = lu[i * n + c] ?? 0;
          lu[i * n + c] = lu[maxRow * n + c] ?? 0;
          lu[maxRow * n + c] = tmp;
        }
        const tmpP = piv[i] ?? 0;
        piv[i] = piv[maxRow] ?? 0;
        piv[maxRow] = tmpP;
      }

      const pivot = lu[i * n + i] ?? 1.0;
      for (let r = i + 1; r < n; r++) {
        const factor = (lu[r * n + i] ?? 0) / pivot;
        lu[r * n + i] = factor;
        for (let c = i + 1; c < n; c++) {
          lu[r * n + c] = (lu[r * n + c] ?? 0) - factor * (lu[i * n + c] ?? 0);
        }
      }
    }

    return true;
  }

  /**
   * Solves P * L * U * x = b in-place into outX without any heap allocations.
   */
  public solve(b: Float64Array, outX: Float64Array): void {
    const n = this.size;
    const lu = this.lu;
    const piv = this.piv;

    // Apply permutation vector: outX[i] = b[piv[i]]
    for (let i = 0; i < n; i++) {
      outX[i] = b[piv[i] ?? 0] ?? 0;
    }

    // Forward substitution: L * y = P * b (unit lower triangular: diag(L) = 1)
    for (let i = 0; i < n; i++) {
      let sum = outX[i] ?? 0;
      for (let j = 0; j < i; j++) {
        sum -= (lu[i * n + j] ?? 0) * (outX[j] ?? 0);
      }
      outX[i] = sum;
    }

    // Back substitution: U * x = y
    for (let i = n - 1; i >= 0; i--) {
      let sum = outX[i] ?? 0;
      for (let j = i + 1; j < n; j++) {
        sum -= (lu[i * n + j] ?? 0) * (outX[j] ?? 0);
      }
      const diag = lu[i * n + i] ?? 1.0;
      outX[i] = sum / diag;
    }
  }
}

/**
 * Solves A * x = b. If outX is provided, writes solution into outX without allocations.
 * Optionally reuses an existing DenseLU solver instance.
 */
export function solveLinearSystem(
  A: DenseMatrix,
  b: Float64Array,
  outX?: Float64Array,
  luSolver?: DenseLU,
): Float64Array | null {
  const solver = luSolver ?? new DenseLU(A.size);
  if (!solver.factorize(A)) {
    return null;
  }
  const x = outX ?? new Float64Array(A.size);
  solver.solve(b, x);
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
    if (comp.kind === "K") continue;
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
