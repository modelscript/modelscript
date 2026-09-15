import { Tet10Element } from "./tet10-stiffness.js";
import { Tet4Element } from "./tet4-stiffness.js";
import type { FeaBoundaryConditions, FeaStepResult, MaterialProperties, Tet4Mesh } from "./tet4-types.js";

/**
 * High-Performance Sparse Linear & Quadratic (Tet4 / Tet10) Finite Element Solver.
 * Supports corotational kinematics for large-rotation invariance and sub-5ms interactive time steps.
 */
export class FeaSolver {
  public readonly mesh: Tet4Mesh;
  public readonly material: MaterialProperties;
  public readonly numDofs: number;
  public readonly isQuadratic: boolean;
  public readonly nodesPerElement: number;

  private D: Float64Array;
  private elementB: (Float64Array | Float64Array[])[];
  private elementKe: Float64Array[];
  private elementMe: Float64Array[];

  // Sparse matrix in Compressed Sparse Row / Coordinate format for fast SpMV
  private rowOffsets: Int32Array;
  private colIndices: Int32Array;
  private values: Float64Array;
  private diagInv: Float64Array;

  // State vectors for dynamic stepping & warm-starting
  private lastDisplacements: Float64Array;
  private currentVelocities: Float64Array;
  private currentAccelerations: Float64Array;

  constructor(mesh: Tet4Mesh, material: MaterialProperties) {
    this.mesh = mesh;
    this.material = material;
    this.isQuadratic = mesh.elementOrder === "quadratic" || mesh.nodesPerElement === 10;
    this.nodesPerElement = this.isQuadratic ? 10 : 4;
    this.numDofs = mesh.numNodes * 3;
    this.lastDisplacements = new Float64Array(this.numDofs);
    this.currentVelocities = new Float64Array(this.numDofs);
    this.currentAccelerations = new Float64Array(this.numDofs);

    this.D = Tet4Element.computeConstitutiveMatrix(material);
    this.elementB = new Array(mesh.numElements);
    this.elementKe = new Array(mesh.numElements);
    this.elementMe = new Array(mesh.numElements);

    this.precomputeElementMatrices();
    this.assembleSparsityPattern();
  }

  private precomputeElementMatrices(): void {
    const { nodeCoords, elements, numElements } = this.mesh;
    const npe = this.nodesPerElement;
    const rho = this.material.rho ?? 2700.0;

    for (let e = 0; e < numElements; e++) {
      if (this.isQuadratic) {
        const pts: [number, number, number][] = [];
        for (let i = 0; i < 10; i++) {
          const n = elements[e * 10 + i];
          pts.push([nodeCoords[n * 3], nodeCoords[n * 3 + 1], nodeCoords[n * 3 + 2]]);
        }
        const { Ke, B_gauss } = Tet10Element.computeElementStiffness(pts, this.D);
        const { Me } = Tet10Element.computeElementMass(pts, rho);
        this.elementKe[e] = Ke;
        this.elementB[e] = B_gauss;
        this.elementMe[e] = Me;
      } else {
        const n0 = elements[e * 4 + 0];
        const n1 = elements[e * 4 + 1];
        const n2 = elements[e * 4 + 2];
        const n3 = elements[e * 4 + 3];

        const p0: [number, number, number] = [nodeCoords[n0 * 3], nodeCoords[n0 * 3 + 1], nodeCoords[n0 * 3 + 2]];
        const p1: [number, number, number] = [nodeCoords[n1 * 3], nodeCoords[n1 * 3 + 1], nodeCoords[n1 * 3 + 2]];
        const p2: [number, number, number] = [nodeCoords[n2 * 3], nodeCoords[n2 * 3 + 1], nodeCoords[n2 * 3 + 2]];
        const p3: [number, number, number] = [nodeCoords[n3 * 3], nodeCoords[n3 * 3 + 1], nodeCoords[n3 * 3 + 2]];

        const { Ke, B } = Tet4Element.computeElementStiffness(p0, p1, p2, p3, this.D);
        const { Me } = Tet4Element.computeElementMass(p0, p1, p2, p3, rho);
        this.elementKe[e] = Ke;
        this.elementB[e] = B;
        this.elementMe[e] = Me;
      }
    }
  }

  private assembleSparsityPattern(): void {
    const { elements, numElements } = this.mesh;
    const numDofs = this.numDofs;
    const npe = this.nodesPerElement;

    // Build adjacency list for each DOF
    const adj = new Array<Set<number>>(numDofs);
    for (let i = 0; i < numDofs; i++) {
      adj[i] = new Set<number>();
    }

    for (let e = 0; e < numElements; e++) {
      const elNodes: number[] = [];
      for (let i = 0; i < npe; i++) {
        elNodes.push(elements[e * npe + i]);
      }

      for (let i = 0; i < npe; i++) {
        const ni = elNodes[i];
        for (let j = 0; j < npe; j++) {
          const nj = elNodes[j];
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
   * Computes the 3x3 rotation matrix R_e via polar decomposition of element deformation.
   */
  private computeElementRotation(e: number, u: Float64Array): Float64Array {
    const { nodeCoords, elements } = this.mesh;
    const npe = this.nodesPerElement;

    const n0 = elements[e * npe + 0];
    const n1 = elements[e * npe + 1];
    const n2 = elements[e * npe + 2];
    const n3 = elements[e * npe + 3];

    // Undeformed edges
    const X0 = [nodeCoords[n0 * 3], nodeCoords[n0 * 3 + 1], nodeCoords[n0 * 3 + 2]];
    const E0 = [
      nodeCoords[n1 * 3] - X0[0],
      nodeCoords[n2 * 3] - X0[0],
      nodeCoords[n3 * 3] - X0[0],
      nodeCoords[n1 * 3 + 1] - X0[1],
      nodeCoords[n2 * 3 + 1] - X0[1],
      nodeCoords[n3 * 3 + 1] - X0[1],
      nodeCoords[n1 * 3 + 2] - X0[2],
      nodeCoords[n2 * 3 + 2] - X0[2],
      nodeCoords[n3 * 3 + 2] - X0[2],
    ];

    // Deformed edges
    const x0 = [X0[0] + u[n0 * 3], X0[1] + u[n0 * 3 + 1], X0[2] + u[n0 * 3 + 2]];
    const e0 = [
      nodeCoords[n1 * 3] + u[n1 * 3] - x0[0],
      nodeCoords[n2 * 3] + u[n2 * 3] - x0[0],
      nodeCoords[n3 * 3] + u[n3 * 3] - x0[0],

      nodeCoords[n1 * 3 + 1] + u[n1 * 3 + 1] - x0[1],
      nodeCoords[n2 * 3 + 1] + u[n2 * 3 + 1] - x0[1],
      nodeCoords[n3 * 3 + 1] + u[n3 * 3 + 1] - x0[1],

      nodeCoords[n1 * 3 + 2] + u[n1 * 3 + 2] - x0[2],
      nodeCoords[n2 * 3 + 2] + u[n2 * 3 + 2] - x0[2],
      nodeCoords[n3 * 3 + 2] + u[n3 * 3 + 2] - x0[2],
    ];

    // Inverse of E0
    const invE0 = new Float64Array(9);
    const detE0 =
      E0[0] * (E0[4] * E0[8] - E0[5] * E0[7]) -
      E0[1] * (E0[3] * E0[8] - E0[5] * E0[6]) +
      E0[2] * (E0[3] * E0[7] - E0[4] * E0[6]);

    if (Math.abs(detE0) < 1e-15) {
      return new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    }

    const invDet = 1.0 / detE0;
    invE0[0] = (E0[4] * E0[8] - E0[5] * E0[7]) * invDet;
    invE0[1] = (E0[2] * E0[7] - E0[1] * E0[8]) * invDet;
    invE0[2] = (E0[1] * E0[5] - E0[2] * E0[4]) * invDet;
    invE0[3] = (E0[5] * E0[6] - E0[3] * E0[8]) * invDet;
    invE0[4] = (E0[0] * E0[8] - E0[2] * E0[6]) * invDet;
    invE0[5] = (E0[2] * E0[3] - E0[0] * E0[5]) * invDet;
    invE0[6] = (E0[3] * E0[7] - E0[4] * E0[6]) * invDet;
    invE0[7] = (E0[1] * E0[6] - E0[0] * E0[7]) * invDet;
    invE0[8] = (E0[0] * E0[4] - E0[1] * E0[3]) * invDet;

    // Deformation gradient F = e0 * inv(E0)
    const F = new Float64Array(9);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0.0;
        for (let k = 0; k < 3; k++) {
          sum += e0[r * 3 + k] * invE0[k * 3 + c];
        }
        F[r * 3 + c] = sum;
      }
    }

    // Polar decomposition via Higham iterations: R_{k+1} = 0.5 * (R_k + R_k^{-T})
    const R = new Float64Array(F);
    for (let iter = 0; iter < 6; iter++) {
      const detR =
        R[0] * (R[4] * R[8] - R[5] * R[7]) - R[1] * (R[3] * R[8] - R[5] * R[6]) + R[2] * (R[3] * R[7] - R[4] * R[6]);

      if (Math.abs(detR) < 1e-12) break;
      const iDet = 1.0 / detR;

      const invR_T = new Float64Array(9);
      invR_T[0] = (R[4] * R[8] - R[5] * R[7]) * iDet;
      invR_T[1] = (R[5] * R[6] - R[3] * R[8]) * iDet;
      invR_T[2] = (R[3] * R[7] - R[4] * R[6]) * iDet;
      invR_T[3] = (R[2] * R[7] - R[1] * R[8]) * iDet;
      invR_T[4] = (R[0] * R[8] - R[2] * R[6]) * iDet;
      invR_T[5] = (R[1] * R[6] - R[0] * R[7]) * iDet;
      invR_T[6] = (R[1] * R[5] - R[2] * R[4]) * iDet;
      invR_T[7] = (R[2] * R[3] - R[0] * R[5]) * iDet;
      invR_T[8] = (R[0] * R[4] - R[1] * R[3]) * iDet;

      for (let i = 0; i < 9; i++) {
        R[i] = 0.5 * (R[i] + invR_T[i]);
      }
    }

    return R;
  }

  /**
   * Assembles the global stiffness values and enforces Dirichlet boundary constraints.
   * If dynFactors is provided, assembles the dynamic effective matrix KeEff = kFactor * Ke + mFactor * Me.
   */
  private assembleGlobalStiffness(
    fixedDofs: Set<number>,
    corotational: boolean = false,
    dynFactors?: { kFactor: number; mFactor: number },
  ): void {
    this.values.fill(0);
    const { elements, numElements } = this.mesh;
    const npe = this.nodesPerElement;
    const edof = npe * 3;
    const kFactor = dynFactors ? dynFactors.kFactor : 1.0;
    const mFactor = dynFactors ? dynFactors.mFactor : 0.0;

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
      const KeBase = this.elementKe[e];
      let Ke = KeBase;

      if (corotational) {
        const R = this.computeElementRotation(e, this.lastDisplacements);
        // Rotate Ke: K_rot = T * Ke * T^T
        Ke = new Float64Array(edof * edof);
        for (let i = 0; i < npe; i++) {
          for (let j = 0; j < npe; j++) {
            // Extract 3x3 block M = Ke[i, j]
            const M = new Float64Array(9);
            for (let r = 0; r < 3; r++) {
              for (let c = 0; c < 3; c++) {
                M[r * 3 + c] = KeBase[(i * 3 + r) * edof + (j * 3 + c)];
              }
            }
            // Compute R * M * R^T
            const RM = new Float64Array(9);
            for (let r = 0; r < 3; r++) {
              for (let c = 0; c < 3; c++) {
                let sum = 0.0;
                for (let k = 0; k < 3; k++) sum += R[r * 3 + k] * M[k * 3 + c];
                RM[r * 3 + c] = sum;
              }
            }
            for (let r = 0; r < 3; r++) {
              for (let c = 0; c < 3; c++) {
                let sum = 0.0;
                for (let k = 0; k < 3; k++) sum += RM[r * 3 + k] * R[c * 3 + k];
                Ke[(i * 3 + r) * edof + (j * 3 + c)] = sum;
              }
            }
          }
        }
      }

      let KeEff = Ke;
      if (kFactor !== 1.0 || mFactor !== 0.0) {
        const Me = this.elementMe[e];
        KeEff = new Float64Array(edof * edof);
        for (let i = 0; i < edof * edof; i++) {
          KeEff[i] = kFactor * Ke[i] + mFactor * Me[i];
        }
      }

      const elNodes: number[] = [];
      for (let i = 0; i < npe; i++) {
        elNodes.push(elements[e * npe + i]);
      }

      for (let i = 0; i < npe; i++) {
        const ni = elNodes[i];
        for (let di = 0; di < 3; di++) {
          const row = ni * 3 + di;
          const isRowFixed = fixedDofs.has(row);

          for (let j = 0; j < npe; j++) {
            const nj = elNodes[j];
            for (let dj = 0; dj < 3; dj++) {
              const col = nj * 3 + dj;
              const isColFixed = fixedDofs.has(col);

              const keVal = KeEff[(i * 3 + di) * edof + (j * 3 + dj)];
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
   * Solves the static equilibrium Ku = f or dynamic equations of motion Mu'' + Cu' + Ku = f
   * using Preconditioned Conjugate Gradient (PCG) with optional Newmark-beta implicit time integration.
   */
  public step(bcs: FeaBoundaryConditions, tol: number = 1e-6, maxIters: number = 500): FeaStepResult {
    if (bcs.resetDynamics) {
      this.lastDisplacements.fill(0);
      this.currentVelocities.fill(0);
      this.currentAccelerations.fill(0);
    }

    // 1. Identify all constrained DOFs
    const fixedDofs = new Set<number>();
    for (const n of bcs.fixedNodes) {
      fixedDofs.add(n * 3 + 0);
      fixedDofs.add(n * 3 + 1);
      fixedDofs.add(n * 3 + 2);
    }

    // 2. Determine solver mode (static vs. transient Newmark-beta)
    const corotational = bcs.corotational ?? false;
    const isTransient = (bcs.transient ?? false) && bcs.dt !== undefined && bcs.dt > 0;
    const dt = bcs.dt ?? 0.005;
    const alphaM = this.material.alphaM ?? 0.05;
    const betaK = this.material.betaK ?? 0.001;

    let a0 = 0,
      a1 = 0,
      a2 = 0,
      a3 = 0,
      a4 = 0,
      a5 = 0,
      a6 = 0,
      a7 = 0;
    if (isTransient) {
      const beta = 0.25;
      const gamma = 0.5;
      a0 = 1.0 / (beta * dt * dt);
      a1 = gamma / (beta * dt);
      a2 = 1.0 / (beta * dt);
      a3 = 1.0 / (2.0 * beta) - 1.0;
      a4 = gamma / beta - 1.0;
      a5 = (dt / 2.0) * (gamma / beta - 2.0);
      a6 = dt * (1.0 - gamma);
      a7 = gamma * dt;

      this.assembleGlobalStiffness(fixedDofs, corotational, {
        kFactor: 1.0 + a1 * betaK,
        mFactor: a0 + a1 * alphaM,
      });
    } else {
      this.assembleGlobalStiffness(fixedDofs, corotational);
    }

    // 3. Assemble RHS load vector f
    const rhs = new Float64Array(this.numDofs);
    for (const [node, force] of bcs.nodalLoads) {
      if (!bcs.fixedNodes.has(node)) {
        rhs[node * 3 + 0] += force[0];
        rhs[node * 3 + 1] += force[1];
        rhs[node * 3 + 2] += force[2];
      }
    }

    if (isTransient) {
      const wM = new Float64Array(this.numDofs);
      const wK = new Float64Array(this.numDofs);
      for (let i = 0; i < this.numDofs; i++) {
        if (!fixedDofs.has(i)) {
          const un = this.lastDisplacements[i];
          const vn = this.currentVelocities[i];
          const an = this.currentAccelerations[i];
          const vM = a0 * un + a2 * vn + a3 * an;
          const vC = a1 * un + a4 * vn + a5 * an;
          wM[i] = vM + alphaM * vC;
          wK[i] = betaK * vC;
        }
      }

      const { elements, numElements } = this.mesh;
      const npe = this.nodesPerElement;
      const edof = npe * 3;
      for (let e = 0; e < numElements; e++) {
        const Me = this.elementMe[e];
        const Ke = this.elementKe[e];
        for (let i = 0; i < npe; i++) {
          const ni = elements[e * npe + i];
          for (let di = 0; di < 3; di++) {
            const row = ni * 3 + di;
            if (fixedDofs.has(row)) continue;
            let sum = 0.0;
            for (let j = 0; j < npe; j++) {
              const nj = elements[e * npe + j];
              for (let dj = 0; dj < 3; dj++) {
                const col = nj * 3 + dj;
                const idx = (i * 3 + di) * edof + (j * 3 + dj);
                sum += Me[idx] * wM[col] + Ke[idx] * wK[col];
              }
            }
            rhs[row] += sum;
          }
        }
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

    // 5. If transient, update dynamic acceleration and velocity states
    if (isTransient) {
      for (let i = 0; i < this.numDofs; i++) {
        if (fixedDofs.has(i)) {
          this.currentAccelerations[i] = 0.0;
          this.currentVelocities[i] = 0.0;
        } else {
          const un = this.lastDisplacements[i];
          const un1 = u[i];
          const vn = this.currentVelocities[i];
          const an = this.currentAccelerations[i];
          const an1 = a0 * (un1 - un) - a2 * vn - a3 * an;
          const vn1 = vn + a6 * an + a7 * an1;
          this.currentAccelerations[i] = an1;
          this.currentVelocities[i] = vn1;
        }
      }
    }

    this.lastDisplacements.set(u);

    // 6. Post-process: Compute element and nodal von Mises stresses
    return this.postProcess(u, corotational, isTransient);
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
    const initialResidual = Math.sqrt(rzOld);

    if (initialResidual < 1e-18) return;

    for (let iter = 0; iter < maxIters; iter++) {
      this.spmv(p, Ap);
      const pAp = this.dot(p, Ap);
      if (Math.abs(pAp) < 1e-24) break;

      const alpha = rzOld / pAp;
      for (let i = 0; i < n; i++) {
        x[i] += alpha * p[i];
        r[i] -= alpha * Ap[i];
        z[i] = r[i] * this.diagInv[i];
      }

      const rzNew = this.dot(r, z);
      if (Math.sqrt(Math.max(0, rzNew)) / initialResidual < tol) {
        break;
      }

      const beta = rzNew / rzOld;
      for (let i = 0; i < n; i++) {
        p[i] = z[i] + beta * p[i];
      }
      rzOld = rzNew;
    }
  }

  /**
   * Sparse Matrix-Vector multiplication: y = A * x using CSR format.
   */
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

  /**
   * Post-processes displacements to calculate element and nodal von Mises stresses.
   */
  public postProcess(u: Float64Array, corotational: boolean = false, isTransient: boolean = false): FeaStepResult {
    const { nodeCoords, elements, numNodes, numElements } = this.mesh;
    const npe = this.nodesPerElement;
    const edof = npe * 3;
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
    const ue = new Float64Array(edof);

    for (let e = 0; e < numElements; e++) {
      const elNodes: number[] = [];
      for (let i = 0; i < npe; i++) {
        elNodes.push(elements[e * npe + i]);
      }

      if (corotational) {
        const R = this.computeElementRotation(e, u);
        // Compute element centroid in undeformed and deformed states
        let Xc = [0, 0, 0];
        let xc = [0, 0, 0];
        for (let i = 0; i < 4; i++) {
          const ni = elNodes[i];
          Xc[0] += nodeCoords[ni * 3 + 0] / 4;
          Xc[1] += nodeCoords[ni * 3 + 1] / 4;
          Xc[2] += nodeCoords[ni * 3 + 2] / 4;
          xc[0] += (nodeCoords[ni * 3 + 0] + u[ni * 3 + 0]) / 4;
          xc[1] += (nodeCoords[ni * 3 + 1] + u[ni * 3 + 1]) / 4;
          xc[2] += (nodeCoords[ni * 3 + 2] + u[ni * 3 + 2]) / 4;
        }

        // Local displacement u_local = R^T * (x - xc) + Xc - X
        for (let i = 0; i < npe; i++) {
          const ni = elNodes[i];
          const dx = nodeCoords[ni * 3 + 0] + u[ni * 3 + 0] - xc[0];
          const dy = nodeCoords[ni * 3 + 1] + u[ni * 3 + 1] - xc[1];
          const dz = nodeCoords[ni * 3 + 2] + u[ni * 3 + 2] - xc[2];

          const rx = R[0] * dx + R[3] * dy + R[6] * dz;
          const ry = R[1] * dx + R[4] * dy + R[7] * dz;
          const rz = R[2] * dx + R[5] * dy + R[8] * dz;

          ue[i * 3 + 0] = rx + Xc[0] - nodeCoords[ni * 3 + 0];
          ue[i * 3 + 1] = ry + Xc[1] - nodeCoords[ni * 3 + 1];
          ue[i * 3 + 2] = rz + Xc[2] - nodeCoords[ni * 3 + 2];
        }
      } else {
        for (let i = 0; i < npe; i++) {
          const ni = elNodes[i];
          for (let d = 0; d < 3; d++) {
            ue[i * 3 + d] = u[ni * 3 + d];
          }
        }
      }

      let vonMises = 0.0;
      if (this.isQuadratic) {
        const res = Tet10Element.computeElementStress(this.elementB[e] as Float64Array[], this.D, ue);
        vonMises = res.vonMises;
      } else {
        const res = Tet4Element.computeElementStress(this.elementB[e] as Float64Array, this.D, ue);
        vonMises = res.vonMises;
      }

      elementVonMises[e] = vonMises;
      if (vonMises > maxStress) maxStress = vonMises;

      for (let i = 0; i < npe; i++) {
        const ni = elNodes[i];
        nodalVonMises[ni] += vonMises;
        nodeCounts[ni]++;
      }
    }

    for (let i = 0; i < numNodes; i++) {
      if (nodeCounts[i] > 0) {
        nodalVonMises[i] /= nodeCounts[i];
      }
    }

    return {
      displacements: new Float32Array(u),
      velocities: isTransient ? new Float32Array(this.currentVelocities) : undefined,
      accelerations: isTransient ? new Float32Array(this.currentAccelerations) : undefined,
      elementVonMises,
      nodalVonMises,
      maxDisplacement: Math.sqrt(maxDispSq),
      maxVonMisesStress: maxStress,
      safetyFactor: this.material.yieldStrength ? this.material.yieldStrength / Math.max(1e-6, maxStress) : undefined,
    };
  }
}
