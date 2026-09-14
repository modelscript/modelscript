// SPDX-License-Identifier: AGPL-3.0-or-later

import { Tet4Element } from "./tet4-stiffness.js";
import type { FeaBoundaryConditions, FeaStepResult, MaterialProperties, Tet4Mesh } from "./tet4-types.js";

/**
 * High-Performance Sparse Linear Tet4 Finite Element Solver.
 * Designed for sub-5ms live co-simulation time steps in the browser.
 */
export class FeaSolver {
  public readonly mesh: Tet4Mesh;
  public readonly material: MaterialProperties;
  public readonly numDofs: number;

  private D: Float64Array;
  private elementB: Float64Array[];
  private elementKe: Float64Array[];

  // Sparse matrix in Compressed Sparse Row / Coordinate format for fast SpMV
  private rowOffsets: Int32Array;
  private colIndices: Int32Array;
  private values: Float64Array;
  private diagInv: Float64Array;

  // Warm-start vector for interactive 60 FPS stepping
  private lastDisplacements: Float64Array;

  constructor(mesh: Tet4Mesh, material: MaterialProperties) {
    this.mesh = mesh;
    this.material = material;
    this.numDofs = mesh.numNodes * 3;
    this.lastDisplacements = new Float64Array(this.numDofs);

    this.D = Tet4Element.computeConstitutiveMatrix(material);
    this.elementB = new Array(mesh.numElements);
    this.elementKe = new Array(mesh.numElements);

    this.precomputeElementMatrices();
    this.assembleSparsityPattern();
  }

  private precomputeElementMatrices(): void {
    const { nodeCoords, elements, numElements } = this.mesh;

    for (let e = 0; e < numElements; e++) {
      const n0 = elements[e * 4 + 0];
      const n1 = elements[e * 4 + 1];
      const n2 = elements[e * 4 + 2];
      const n3 = elements[e * 4 + 3];

      const p0: [number, number, number] = [nodeCoords[n0 * 3], nodeCoords[n0 * 3 + 1], nodeCoords[n0 * 3 + 2]];
      const p1: [number, number, number] = [nodeCoords[n1 * 3], nodeCoords[n1 * 3 + 1], nodeCoords[n1 * 3 + 2]];
      const p2: [number, number, number] = [nodeCoords[n2 * 3], nodeCoords[n2 * 3 + 1], nodeCoords[n2 * 3 + 2]];
      const p3: [number, number, number] = [nodeCoords[n3 * 3], nodeCoords[n3 * 3 + 1], nodeCoords[n3 * 3 + 2]];

      const { Ke, B } = Tet4Element.computeElementStiffness(p0, p1, p2, p3, this.D);
      this.elementKe[e] = Ke;
      this.elementB[e] = B;
    }
  }

  private assembleSparsityPattern(): void {
    const { elements, numElements } = this.mesh;
    const numDofs = this.numDofs;

    // Build adjacency list for each DOF
    const adj = new Array<Set<number>>(numDofs);
    for (let i = 0; i < numDofs; i++) {
      adj[i] = new Set<number>();
    }

    for (let e = 0; e < numElements; e++) {
      const nodes = [elements[e * 4 + 0], elements[e * 4 + 1], elements[e * 4 + 2], elements[e * 4 + 3]];

      for (let i = 0; i < 4; i++) {
        const ni = nodes[i];
        for (let j = 0; j < 4; j++) {
          const nj = nodes[j];
          for (let di = 0; di < 3; di++) {
            const row = ni * 3 + di;
            for (let dj = 0; dj < 3; dj++) {
              const col = nj * 3 + dj;
              adj[row].add(col);
            }
          }
        }
      }
    }

    // Count non-zeros
    let totalNnz = 0;
    this.rowOffsets = new Int32Array(numDofs + 1);
    for (let i = 0; i < numDofs; i++) {
      this.rowOffsets[i] = totalNnz;
      totalNnz += adj[i].size;
    }
    this.rowOffsets[numDofs] = totalNnz;

    this.colIndices = new Int32Array(totalNnz);
    this.values = new Float64Array(totalNnz);
    this.diagInv = new Float64Array(numDofs);

    let ptr = 0;
    for (let i = 0; i < numDofs; i++) {
      const sortedCols = Array.from(adj[i]).sort((a, b) => a - b);
      for (const col of sortedCols) {
        this.colIndices[ptr++] = col;
      }
    }
  }

  /**
   * Assembles the global stiffness values and enforces Dirichlet boundary constraints.
   */
  private assembleGlobalStiffness(fixedDofs: Set<number>): void {
    this.values.fill(0);
    const { elements, numElements } = this.mesh;

    // Helper to find index in CSR row
    const findColIndex = (row: number, col: number): number => {
      const start = this.rowOffsets[row];
      const end = this.rowOffsets[row + 1];
      for (let p = start; p < end; p++) {
        if (this.colIndices[p] === col) return p;
      }
      return -1;
    };

    for (let e = 0; e < numElements; e++) {
      const Ke = this.elementKe[e];
      const nodes = [elements[e * 4 + 0], elements[e * 4 + 1], elements[e * 4 + 2], elements[e * 4 + 3]];

      for (let i = 0; i < 4; i++) {
        const ni = nodes[i];
        for (let di = 0; di < 3; di++) {
          const row = ni * 3 + di;
          const isRowFixed = fixedDofs.has(row);

          for (let j = 0; j < 4; j++) {
            const nj = nodes[j];
            for (let dj = 0; dj < 3; dj++) {
              const col = nj * 3 + dj;
              const isColFixed = fixedDofs.has(col);

              const keVal = Ke[(i * 3 + di) * 12 + (j * 3 + dj)];
              const p = findColIndex(row, col);

              if (p !== -1) {
                if (isRowFixed || isColFixed) {
                  if (row === col) {
                    this.values[p] = 1.0;
                  }
                } else {
                  this.values[p] += keVal;
                }
              }
            }
          }
        }
      }
    }

    // Ensure fixed DOFs have exactly 1.0 on diagonal
    for (const dof of fixedDofs) {
      const p = findColIndex(dof, dof);
      if (p !== -1) {
        this.values[p] = 1.0;
      }
    }

    // Precompute Jacobi preconditioner: diagInv[i] = 1.0 / A[i, i]
    for (let i = 0; i < this.numDofs; i++) {
      const p = findColIndex(i, i);
      const diag = p !== -1 && Math.abs(this.values[p]) > 1e-18 ? this.values[p] : 1.0;
      this.diagInv[i] = 1.0 / diag;
    }
  }

  /**
   * Solves the static equilibrium Ku = f using Preconditioned Conjugate Gradient (PCG).
   */
  public step(bcs: FeaBoundaryConditions, tol: number = 1e-6, maxIters: number = 500): FeaStepResult {
    // 1. Identify all constrained DOFs
    const fixedDofs = new Set<number>();
    for (const n of bcs.fixedNodes) {
      fixedDofs.add(n * 3 + 0);
      fixedDofs.add(n * 3 + 1);
      fixedDofs.add(n * 3 + 2);
    }

    // 2. Assemble matrix with boundary conditions
    this.assembleGlobalStiffness(fixedDofs);

    // 3. Assemble RHS load vector f
    const rhs = new Float64Array(this.numDofs);
    for (const [node, force] of bcs.nodalLoads) {
      if (!bcs.fixedNodes.has(node)) {
        rhs[node * 3 + 0] += force[0];
        rhs[node * 3 + 1] += force[1];
        rhs[node * 3 + 2] += force[2];
      }
    }

    for (const dof of fixedDofs) {
      rhs[dof] = 0.0;
    }

    // 4. Solve Ku = f via Preconditioned Conjugate Gradient (PCG)
    const u = new Float64Array(this.lastDisplacements); // warm-start from previous step
    for (const dof of fixedDofs) {
      u[dof] = 0.0;
    }

    this.solvePcg(rhs, u, tol, maxIters);
    this.lastDisplacements.set(u);

    // 5. Post-process: Compute element and nodal von Mises stresses
    return this.postProcess(u);
  }

  private solvePcg(b: Float64Array, x: Float64Array, tol: number, maxIters: number): void {
    const n = this.numDofs;
    const r = new Float64Array(n);
    const z = new Float64Array(n);
    const p = new Float64Array(n);
    const Ap = new Float64Array(n);

    // r = b - A * x
    this.spmv(x, Ap);
    for (let i = 0; i < n; i++) {
      r[i] = b[i] - Ap[i];
      z[i] = r[i] * this.diagInv[i]; // Preconditioned z = M^-1 * r
      p[i] = z[i];
    }

    let rzOld = this.dot(r, z);
    const bNorm = Math.sqrt(this.dot(b, b)) || 1.0;

    for (let iter = 0; iter < maxIters; iter++) {
      this.spmv(p, Ap);
      const pAp = this.dot(p, Ap);
      if (Math.abs(pAp) < 1e-30) break;

      const alpha = rzOld / pAp;
      for (let i = 0; i < n; i++) {
        x[i] += alpha * p[i];
        r[i] -= alpha * Ap[i];
      }

      const resNorm = Math.sqrt(this.dot(r, r)) / bNorm;
      if (resNorm < tol) break;

      for (let i = 0; i < n; i++) {
        z[i] = r[i] * this.diagInv[i];
      }

      const rzNew = this.dot(r, z);
      const beta = rzNew / rzOld;
      for (let i = 0; i < n; i++) {
        p[i] = z[i] + beta * p[i];
      }
      rzOld = rzNew;
    }
  }

  private spmv(x: Float64Array, y: Float64Array): void {
    const n = this.numDofs;
    for (let i = 0; i < n; i++) {
      let sum = 0.0;
      const start = this.rowOffsets[i];
      const end = this.rowOffsets[i + 1];
      for (let p = start; p < end; p++) {
        sum += this.values[p] * x[this.colIndices[p]];
      }
      y[i] = sum;
    }
  }

  private dot(a: Float64Array, b: Float64Array): number {
    let sum = 0.0;
    const len = a.length;
    for (let i = 0; i < len; i++) {
      sum += a[i] * b[i];
    }
    return sum;
  }

  private postProcess(u: Float64Array): FeaStepResult {
    const { elements, numNodes, numElements } = this.mesh;
    const elementVonMises = new Float32Array(numElements);
    const nodalVonMises = new Float32Array(numNodes);
    const nodeCounts = new Uint32Array(numNodes);

    let maxDispSq = 0.0;
    for (let i = 0; i < numNodes; i++) {
      const ux = u[i * 3 + 0];
      const uy = u[i * 3 + 1];
      const uz = u[i * 3 + 2];
      const magSq = ux * ux + uy * uy + uz * uz;
      if (magSq > maxDispSq) maxDispSq = magSq;
    }

    let maxStress = 0.0;
    const ue = new Float64Array(12);

    for (let e = 0; e < numElements; e++) {
      const n0 = elements[e * 4 + 0];
      const n1 = elements[e * 4 + 1];
      const n2 = elements[e * 4 + 2];
      const n3 = elements[e * 4 + 3];

      for (let d = 0; d < 3; d++) {
        ue[0 * 3 + d] = u[n0 * 3 + d];
        ue[1 * 3 + d] = u[n1 * 3 + d];
        ue[2 * 3 + d] = u[n2 * 3 + d];
        ue[3 * 3 + d] = u[n3 * 3 + d];
      }

      const { vonMises } = Tet4Element.computeElementStress(this.elementB[e], this.D, ue);
      elementVonMises[e] = vonMises;
      if (vonMises > maxStress) maxStress = vonMises;

      nodalVonMises[n0] += vonMises;
      nodalVonMises[n1] += vonMises;
      nodalVonMises[n2] += vonMises;
      nodalVonMises[n3] += vonMises;
      nodeCounts[n0]++;
      nodeCounts[n1]++;
      nodeCounts[n2]++;
      nodeCounts[n3]++;
    }

    for (let i = 0; i < numNodes; i++) {
      if (nodeCounts[i] > 0) {
        nodalVonMises[i] /= nodeCounts[i];
      }
    }

    return {
      displacements: new Float32Array(u),
      elementVonMises,
      nodalVonMises,
      maxDisplacement: Math.sqrt(maxDispSq),
      maxVonMisesStress: maxStress,
      safetyFactor: this.material.yieldStrength ? this.material.yieldStrength / Math.max(1e-6, maxStress) : undefined,
    };
  }
}
