// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Tet4Mesh } from "../fea/tet4-types.js";
import {
  DEFAULT_GAMMA,
  DEFAULT_GAS_CONSTANT_R,
  MIN_DENSITY,
  MIN_PRESSURE,
  type PrimitiveState,
} from "./compressible-arena.js";
import { computeHllcFlux, computeRoeFlux, type RiemannFluxType } from "./compressible-fvm.js";

export type UnstructuredBcType = "farfield" | "slip_wall" | "inlet" | "outlet";

export interface UnstructuredPrimitiveState {
  rho: number;
  u: number;
  v: number;
  w: number;
  p: number;
}

export interface UnstructuredInternalFace {
  leftCell: number;
  rightCell: number;
  area: number;
  outwardNormal: [number, number, number];
  centroid: [number, number, number];
}

export interface UnstructuredBoundaryFace {
  cell: number;
  area: number;
  outwardNormal: [number, number, number];
  centroid: [number, number, number];
  bcType: UnstructuredBcType;
  patchName?: string | undefined;
}

export interface UnstructuredFvmTopology {
  numCells: number;
  volumes: Float64Array;
  /** Interleaved cell centroids [cx0, cy0, cz0, ...]. */
  centroids: Float64Array;
  internalFaces: UnstructuredInternalFace[];
  boundaryFaces: UnstructuredBoundaryFace[];
  /** Maximum geometric conservation error max_i ||sum_f A_f n_f|| across all cells. */
  maxGeometricConservationError: number;
}

export interface UnstructuredBoundaryConfig {
  /** Default boundary condition for unclassified boundary faces (default "farfield"). */
  defaultBoundaryCondition?: UnstructuredBcType | undefined;
  /** Mapping from mesh boundary patch name to boundary condition type. */
  boundaryConditions?: Record<string, UnstructuredBcType> | undefined;
  /** Optional spatial/patch classifier overriding static patch mappings. */
  classifyBoundaryFace?:
    | ((
        fx: number,
        fy: number,
        fz: number,
        nx: number,
        ny: number,
        nz: number,
        patchName?: string,
      ) => UnstructuredBcType)
    | undefined;
}

export interface UnstructuredCompressibleFvmOptions extends UnstructuredBoundaryConfig {
  /** Ratio of specific heats (default 1.4). */
  gamma?: number | undefined;
  /** Specific gas constant R [J/(kg*K)] (default 287.05). */
  gasConstantR?: number | undefined;
  /** Approximate Riemann solver (default "hllc"). */
  flux?: RiemannFluxType | undefined;
  /** Spatial reconstruction order: 1 (piecewise constant) or 2 (Green-Gauss MUSCL) (default 1). */
  reconstructionOrder?: 1 | 2 | undefined;
  /** Default CFL number for explicit SSP-RK3 timestepping (default 0.45). */
  cfl?: number | undefined;
  /** Harten entropy fix parameter for Roe flux (default 0.1). */
  entropyFixDelta?: number | undefined;
  /** Optional prescribed farfield primitive state (defaults to zero-gradient extrapolation). */
  farfieldState?: UnstructuredPrimitiveState | undefined;
  /** Optional prescribed inlet primitive state. */
  inletState?: UnstructuredPrimitiveState | undefined;
  /** Optional prescribed subsonic outlet static pressure [Pa]. */
  outletPressure?: number | undefined;
}

const NVARS = 5;

const TET_LOCAL_FACES: readonly [number, number, number, number][] = [
  [0, 1, 2, 3],
  [0, 1, 3, 2],
  [0, 2, 3, 1],
  [1, 2, 3, 0],
];

function faceKey(a: number, b: number, c: number): string {
  let s0 = a;
  let s1 = b;
  let s2 = c;
  if (s0 > s1) {
    const t = s0;
    s0 = s1;
    s1 = t;
  }
  if (s1 > s2) {
    const t = s1;
    s1 = s2;
    s2 = t;
  }
  if (s0 > s1) {
    const t = s0;
    s0 = s1;
    s1 = t;
  }
  return `${s0}_${s1}_${s2}`;
}

function inferBcFromPatchName(patchName: string): UnstructuredBcType | undefined {
  const lower = patchName.toLowerCase();
  if (lower === "slip_wall" || lower === "wall" || lower.includes("wall")) {
    return "slip_wall";
  }
  if (lower === "inlet" || lower.includes("inlet")) {
    return "inlet";
  }
  if (lower === "outlet" || lower.includes("outlet")) {
    return "outlet";
  }
  if (lower === "farfield" || lower.includes("farfield")) {
    return "farfield";
  }
  return undefined;
}

/**
 * Build cell-centered unstructured FVM geometry and face connectivity from a Tet4Mesh.
 *
 * Computes per-tet volumes V_i, centroids c_i, internal faces (leftCell, rightCell,
 * area, outwardNormal pointing from leftCell into rightCell), and boundary faces
 * (cell, area, outwardNormal pointing out of the domain, bcType).
 */
export function buildUnstructuredFvmTopology(
  mesh: Tet4Mesh,
  config: UnstructuredBoundaryConfig = {},
): UnstructuredFvmTopology {
  const numCells = mesh.numElements;
  const stride = mesh.nodesPerElement ?? 4;
  const coords = mesh.nodeCoords;
  const elements = mesh.elements;

  if (numCells <= 0) {
    throw new Error("Tet4Mesh must contain at least one tetrahedral element");
  }
  if (stride < 4) {
    throw new Error(`Invalid nodesPerElement: ${stride} (expected >= 4)`);
  }

  const volumes = new Float64Array(numCells);
  const centroids = new Float64Array(numCells * 3);

  // Pre-build patch lookup structures for boundary face classification
  const facePatchMap = new Map<string, string>();
  if (mesh.boundaryFaces) {
    for (const [patchName, faces] of mesh.boundaryFaces.entries()) {
      for (const [a, b, c] of faces) {
        facePatchMap.set(faceKey(a, b, c), patchName);
      }
    }
  }

  const patchNodeSets: { name: string; nodes: Set<number> }[] = [];
  if (mesh.boundaryNodes) {
    for (const [patchName, nodeList] of mesh.boundaryNodes.entries()) {
      patchNodeSets.push({ name: patchName, nodes: new Set(nodeList) });
    }
  }

  interface PendingFace {
    cell: number;
    area: number;
    nx: number;
    ny: number;
    nz: number;
    cx: number;
    cy: number;
    cz: number;
    v0: number;
    v1: number;
    v2: number;
  }

  const pendingFaces = new Map<string, PendingFace>();
  const internalFaces: UnstructuredInternalFace[] = [];

  // Track sum_f (A_f * n_f) per cell to verify geometric conservation
  const gclSumX = new Float64Array(numCells);
  const gclSumY = new Float64Array(numCells);
  const gclSumZ = new Float64Array(numCells);

  const verts = [0, 0, 0, 0];

  for (let i = 0; i < numCells; i++) {
    const base = i * stride;
    const n0 = elements[base] ?? 0;
    const n1 = elements[base + 1] ?? 0;
    const n2 = elements[base + 2] ?? 0;
    const n3 = elements[base + 3] ?? 0;
    verts[0] = n0;
    verts[1] = n1;
    verts[2] = n2;
    verts[3] = n3;

    const x0 = coords[n0 * 3] ?? 0;
    const y0 = coords[n0 * 3 + 1] ?? 0;
    const z0 = coords[n0 * 3 + 2] ?? 0;

    const x1 = coords[n1 * 3] ?? 0;
    const y1 = coords[n1 * 3 + 1] ?? 0;
    const z1 = coords[n1 * 3 + 2] ?? 0;

    const x2 = coords[n2 * 3] ?? 0;
    const y2 = coords[n2 * 3 + 1] ?? 0;
    const z2 = coords[n2 * 3 + 2] ?? 0;

    const x3 = coords[n3 * 3] ?? 0;
    const y3 = coords[n3 * 3 + 1] ?? 0;
    const z3 = coords[n3 * 3 + 2] ?? 0;

    // Volume V_i = 1/6 * |(x1 - x0) . ((x2 - x0) x (x3 - x0))|
    const ax = x1 - x0;
    const ay = y1 - y0;
    const az = z1 - z0;
    const bx = x2 - x0;
    const by = y2 - y0;
    const bz = z2 - z0;
    const cx = x3 - x0;
    const cy = y3 - y0;
    const cz = z3 - z0;

    const crossX = by * cz - bz * cy;
    const crossY = bz * cx - bx * cz;
    const crossZ = bx * cy - by * cx;
    const vol = Math.abs(ax * crossX + ay * crossY + az * crossZ) / 6.0;
    if (vol <= 0.0 || !Number.isFinite(vol)) {
      throw new Error(`Degenerate tetrahedron at element ${i}: volume=${vol}`);
    }
    volumes[i] = vol;

    const centX = 0.25 * (x0 + x1 + x2 + x3);
    const centY = 0.25 * (y0 + y1 + y2 + y3);
    const centZ = 0.25 * (z0 + z1 + z2 + z3);
    centroids[i * 3] = centX;
    centroids[i * 3 + 1] = centY;
    centroids[i * 3 + 2] = centZ;

    // Process 4 triangular faces
    for (let f = 0; f < 4; f++) {
      const localFace = TET_LOCAL_FACES[f]!;
      const va = verts[localFace[0]]!;
      const vb = verts[localFace[1]]!;
      const vc = verts[localFace[2]]!;
      const key = faceKey(va, vb, vc);

      const existing = pendingFaces.get(key);
      if (existing) {
        // Internal face: existing.cell is leftCell, i is rightCell
        // Normal already points outward from leftCell (into rightCell)
        internalFaces.push({
          leftCell: existing.cell,
          rightCell: i,
          area: existing.area,
          outwardNormal: [existing.nx, existing.ny, existing.nz],
          centroid: [existing.cx, existing.cy, existing.cz],
        });

        // Right cell sees opposite outward normal
        gclSumX[i] = (gclSumX[i] ?? 0) - existing.area * existing.nx;
        gclSumY[i] = (gclSumY[i] ?? 0) - existing.area * existing.ny;
        gclSumZ[i] = (gclSumZ[i] ?? 0) - existing.area * existing.nz;

        pendingFaces.delete(key);
      } else {
        const xa = coords[va * 3] ?? 0;
        const ya = coords[va * 3 + 1] ?? 0;
        const za = coords[va * 3 + 2] ?? 0;

        const xb = coords[vb * 3] ?? 0;
        const yb = coords[vb * 3 + 1] ?? 0;
        const zb = coords[vb * 3 + 2] ?? 0;

        const xc = coords[vc * 3] ?? 0;
        const yc = coords[vc * 3 + 1] ?? 0;
        const zc = coords[vc * 3 + 2] ?? 0;

        const e1x = xb - xa;
        const e1y = yb - ya;
        const e1z = zb - za;
        const e2x = xc - xa;
        const e2y = yc - ya;
        const e2z = zc - za;

        let nx = 0.5 * (e1y * e2z - e1z * e2y);
        let ny = 0.5 * (e1z * e2x - e1x * e2z);
        let nz = 0.5 * (e1x * e2y - e1y * e2x);

        const area = Math.hypot(nx, ny, nz);
        if (area <= 0.0) {
          throw new Error(`Degenerate triangular face on element ${i}`);
        }

        const fcx = (xa + xb + xc) / 3.0;
        const fcy = (ya + yb + yc) / 3.0;
        const fcz = (za + zb + zc) / 3.0;

        // Ensure normal points outward from cell i
        const dotOut = nx * (fcx - centX) + ny * (fcy - centY) + nz * (fcz - centZ);
        if (dotOut < 0.0) {
          nx = -nx;
          ny = -ny;
          nz = -nz;
        }

        const invArea = 1.0 / area;
        const unx = nx * invArea;
        const uny = ny * invArea;
        const unz = nz * invArea;

        gclSumX[i] = (gclSumX[i] ?? 0) + area * unx;
        gclSumY[i] = (gclSumY[i] ?? 0) + area * uny;
        gclSumZ[i] = (gclSumZ[i] ?? 0) + area * unz;

        pendingFaces.set(key, {
          cell: i,
          area,
          nx: unx,
          ny: uny,
          nz: unz,
          cx: fcx,
          cy: fcy,
          cz: fcz,
          v0: va,
          v1: vb,
          v2: vc,
        });
      }
    }
  }

  // Remaining pending faces are boundary faces
  const defaultBc: UnstructuredBcType = config.defaultBoundaryCondition ?? "farfield";
  const bcMap = config.boundaryConditions ?? {};
  const classifyFn = config.classifyBoundaryFace;
  const boundaryFaces: UnstructuredBoundaryFace[] = [];

  for (const [key, pf] of pendingFaces.entries()) {
    let patchName = facePatchMap.get(key);
    if (patchName === undefined && patchNodeSets.length > 0) {
      let bestName: string | undefined;
      let bestIsNonDefault = false;
      let bestSize = Number.POSITIVE_INFINITY;
      for (const patch of patchNodeSets) {
        if (patch.nodes.has(pf.v0) && patch.nodes.has(pf.v1) && patch.nodes.has(pf.v2)) {
          const resolvedBc = bcMap[patch.name] ?? inferBcFromPatchName(patch.name) ?? defaultBc;
          const isNonDefault = resolvedBc !== defaultBc;
          const size = patch.nodes.size;
          if (
            bestName === undefined ||
            (isNonDefault && !bestIsNonDefault) ||
            (isNonDefault === bestIsNonDefault && size < bestSize)
          ) {
            bestName = patch.name;
            bestIsNonDefault = isNonDefault;
            bestSize = size;
          }
        }
      }
      patchName = bestName;
    }

    let bcType: UnstructuredBcType;
    if (classifyFn) {
      bcType = classifyFn(pf.cx, pf.cy, pf.cz, pf.nx, pf.ny, pf.nz, patchName);
    } else if (patchName !== undefined && bcMap[patchName] !== undefined) {
      bcType = bcMap[patchName]!;
    } else if (patchName !== undefined) {
      bcType = inferBcFromPatchName(patchName) ?? defaultBc;
    } else {
      bcType = defaultBc;
    }

    boundaryFaces.push({
      cell: pf.cell,
      area: pf.area,
      outwardNormal: [pf.nx, pf.ny, pf.nz],
      centroid: [pf.cx, pf.cy, pf.cz],
      bcType,
      patchName,
    });
  }

  let maxGeometricConservationError = 0.0;
  for (let i = 0; i < numCells; i++) {
    const err = Math.hypot(gclSumX[i] ?? 0, gclSumY[i] ?? 0, gclSumZ[i] ?? 0);
    if (err > maxGeometricConservationError) {
      maxGeometricConservationError = err;
    }
  }

  return {
    numCells,
    volumes,
    centroids,
    internalFaces,
    boundaryFaces,
    maxGeometricConservationError,
  };
}

function primitiveToConserved(prim: UnstructuredPrimitiveState, gamma: number, out: Float64Array): void {
  const rho = Math.max(prim.rho, MIN_DENSITY);
  const p = Math.max(prim.p, MIN_PRESSURE);
  const ke = 0.5 * rho * (prim.u * prim.u + prim.v * prim.v + prim.w * prim.w);
  out[0] = rho;
  out[1] = rho * prim.u;
  out[2] = rho * prim.v;
  out[3] = rho * prim.w;
  out[4] = p / (gamma - 1.0) + ke;
}

/**
 * Cell-centered Unstructured Body-Fitted Tet4 Compressible Euler FVM Solver.
 *
 * Supports:
 * - 1st-order piecewise-constant and 2nd-order Green-Gauss MUSCL (Barth-Jespersen limited) reconstruction
 * - HLLC and Roe approximate Riemann fluxes
 * - Explicit 3-stage SSP-RK3 time integration with unstructured CFL timestep computation
 * - Farfield, reflecting slip-wall, inlet, and outlet boundary conditions
 * - Exact geometric conservation (freestream preservation) on arbitrary tetrahedral meshes
 * - Surface pressure force integration on `slip_wall` patches
 */
export class UnstructuredCompressibleFvmSolver {
  public readonly numCells: number;
  public readonly gamma: number;
  public readonly gasConstantR: number;
  public readonly fluxType: RiemannFluxType;
  public readonly reconstructionOrder: 1 | 2;
  public readonly defaultCfl: number;
  public readonly entropyFixDelta: number;

  public readonly topology: UnstructuredFvmTopology;
  public readonly volumes: Float64Array;
  public readonly centroids: Float64Array;
  public readonly internalFaces: readonly UnstructuredInternalFace[];
  public readonly boundaryFaces: readonly UnstructuredBoundaryFace[];

  /** SoA conserved state buffer: state[varIdx * numCells + cellIdx]. */
  public readonly state: Float64Array;
  public readonly rho: Float64Array;
  public readonly rhoU: Float64Array;
  public readonly rhoV: Float64Array;
  public readonly rhoW: Float64Array;
  public readonly rhoE: Float64Array;

  // SSP-RK3 scratch buffers
  private readonly u0: Float64Array;
  private readonly u1: Float64Array;
  private readonly rhs: Float64Array;

  // Flat SoA face arrays for fast residual sweeps
  private readonly numInternalFaces: number;
  private readonly intLeft: Uint32Array;
  private readonly intRight: Uint32Array;
  private readonly intArea: Float64Array;
  private readonly intNx: Float64Array;
  private readonly intNy: Float64Array;
  private readonly intNz: Float64Array;
  private readonly intCx: Float64Array;
  private readonly intCy: Float64Array;
  private readonly intCz: Float64Array;

  private readonly numBoundaryFaces: number;
  private readonly bndCell: Uint32Array;
  private readonly bndArea: Float64Array;
  private readonly bndNx: Float64Array;
  private readonly bndNy: Float64Array;
  private readonly bndNz: Float64Array;
  private readonly bndCx: Float64Array;
  private readonly bndCy: Float64Array;
  private readonly bndCz: Float64Array;
  /** 0 = farfield, 1 = slip_wall, 2 = inlet, 3 = outlet */
  private readonly bndTypeCode: Uint8Array;

  // Green-Gauss MUSCL scratch buffers (5 primitive variables: rho, u, v, w, p)
  private readonly primBuf: Float64Array;
  private readonly gradX: Float64Array;
  private readonly gradY: Float64Array;
  private readonly gradZ: Float64Array;
  private readonly primMin: Float64Array;
  private readonly primMax: Float64Array;
  private readonly limiterPhi: Float64Array;

  // Spectral radius scratch buffer for CFL
  private readonly spectralRadius: Float64Array;

  // Flux scratch vectors
  private readonly uLBuf = new Float64Array(NVARS);
  private readonly uRBuf = new Float64Array(NVARS);
  private readonly fluxBuf = new Float64Array(NVARS);

  // Prescribed boundary states (conserved)
  private farfieldConserved: Float64Array | null = null;
  private inletConserved: Float64Array | null = null;
  private outletPressure: number | null = null;

  constructor(mesh: Tet4Mesh, options: UnstructuredCompressibleFvmOptions = {}) {
    this.gamma = options.gamma ?? DEFAULT_GAMMA;
    this.gasConstantR = options.gasConstantR ?? DEFAULT_GAS_CONSTANT_R;
    this.fluxType = options.flux ?? "hllc";
    this.reconstructionOrder = options.reconstructionOrder ?? 1;
    this.defaultCfl = options.cfl ?? 0.45;
    this.entropyFixDelta = options.entropyFixDelta ?? 0.1;

    this.topology = buildUnstructuredFvmTopology(mesh, options);
    this.numCells = this.topology.numCells;
    this.volumes = this.topology.volumes;
    this.centroids = this.topology.centroids;
    this.internalFaces = this.topology.internalFaces;
    this.boundaryFaces = this.topology.boundaryFaces;

    this.state = new Float64Array(NVARS * this.numCells);
    this.rho = this.state.subarray(0, this.numCells);
    this.rhoU = this.state.subarray(this.numCells, 2 * this.numCells);
    this.rhoV = this.state.subarray(2 * this.numCells, 3 * this.numCells);
    this.rhoW = this.state.subarray(3 * this.numCells, 4 * this.numCells);
    this.rhoE = this.state.subarray(4 * this.numCells, 5 * this.numCells);

    this.u0 = new Float64Array(NVARS * this.numCells);
    this.u1 = new Float64Array(NVARS * this.numCells);
    this.rhs = new Float64Array(NVARS * this.numCells);

    // Pack internal faces into flat typed arrays
    this.numInternalFaces = this.internalFaces.length;
    this.intLeft = new Uint32Array(this.numInternalFaces);
    this.intRight = new Uint32Array(this.numInternalFaces);
    this.intArea = new Float64Array(this.numInternalFaces);
    this.intNx = new Float64Array(this.numInternalFaces);
    this.intNy = new Float64Array(this.numInternalFaces);
    this.intNz = new Float64Array(this.numInternalFaces);
    this.intCx = new Float64Array(this.numInternalFaces);
    this.intCy = new Float64Array(this.numInternalFaces);
    this.intCz = new Float64Array(this.numInternalFaces);

    for (let f = 0; f < this.numInternalFaces; f++) {
      const face = this.internalFaces[f]!;
      this.intLeft[f] = face.leftCell;
      this.intRight[f] = face.rightCell;
      this.intArea[f] = face.area;
      this.intNx[f] = face.outwardNormal[0];
      this.intNy[f] = face.outwardNormal[1];
      this.intNz[f] = face.outwardNormal[2];
      this.intCx[f] = face.centroid[0];
      this.intCy[f] = face.centroid[1];
      this.intCz[f] = face.centroid[2];
    }

    // Pack boundary faces into flat typed arrays
    this.numBoundaryFaces = this.boundaryFaces.length;
    this.bndCell = new Uint32Array(this.numBoundaryFaces);
    this.bndArea = new Float64Array(this.numBoundaryFaces);
    this.bndNx = new Float64Array(this.numBoundaryFaces);
    this.bndNy = new Float64Array(this.numBoundaryFaces);
    this.bndNz = new Float64Array(this.numBoundaryFaces);
    this.bndCx = new Float64Array(this.numBoundaryFaces);
    this.bndCy = new Float64Array(this.numBoundaryFaces);
    this.bndCz = new Float64Array(this.numBoundaryFaces);
    this.bndTypeCode = new Uint8Array(this.numBoundaryFaces);

    for (let f = 0; f < this.numBoundaryFaces; f++) {
      const face = this.boundaryFaces[f]!;
      this.bndCell[f] = face.cell;
      this.bndArea[f] = face.area;
      this.bndNx[f] = face.outwardNormal[0];
      this.bndNy[f] = face.outwardNormal[1];
      this.bndNz[f] = face.outwardNormal[2];
      this.bndCx[f] = face.centroid[0];
      this.bndCy[f] = face.centroid[1];
      this.bndCz[f] = face.centroid[2];
      this.bndTypeCode[f] =
        face.bcType === "slip_wall" ? 1 : face.bcType === "inlet" ? 2 : face.bcType === "outlet" ? 3 : 0;
    }

    // Allocate MUSCL gradient / limiter buffers
    const totalVars = NVARS * this.numCells;
    this.primBuf = new Float64Array(totalVars);
    this.gradX = new Float64Array(totalVars);
    this.gradY = new Float64Array(totalVars);
    this.gradZ = new Float64Array(totalVars);
    this.primMin = new Float64Array(totalVars);
    this.primMax = new Float64Array(totalVars);
    this.limiterPhi = new Float64Array(totalVars);

    this.spectralRadius = new Float64Array(this.numCells);

    if (options.farfieldState) {
      this.setFarfieldState(options.farfieldState);
    }
    if (options.inletState) {
      this.inletConserved = new Float64Array(NVARS);
      primitiveToConserved(options.inletState, this.gamma, this.inletConserved);
    }
    if (options.outletPressure !== undefined) {
      this.outletPressure = Math.max(options.outletPressure, MIN_PRESSURE);
    }
  }

  /** Set the prescribed farfield state used on `farfield` boundaries. */
  public setFarfieldState(state: UnstructuredPrimitiveState): void {
    this.farfieldConserved = new Float64Array(NVARS);
    primitiveToConserved(state, this.gamma, this.farfieldConserved);
  }

  /** Initialize all cells to a uniform primitive flow state `(rho, u, v, w, p)`. */
  public fillUniform(rho: number, u: number, v: number, w: number, p: number): void {
    const r = Math.max(rho, MIN_DENSITY);
    const pr = Math.max(p, MIN_PRESSURE);
    const ru = r * u;
    const rv = r * v;
    const rw = r * w;
    const rE = pr / (this.gamma - 1.0) + 0.5 * r * (u * u + v * v + w * w);

    this.rho.fill(r);
    this.rhoU.fill(ru);
    this.rhoV.fill(rv);
    this.rhoW.fill(rw);
    this.rhoE.fill(rE);
  }

  /** Initialize each cell using a callback evaluated at cell centroid `(x, y, z)`. */
  public initCustom(fn: (x: number, y: number, z: number, cellIndex: number) => UnstructuredPrimitiveState): void {
    const invGm1 = 1.0 / (this.gamma - 1.0);
    for (let i = 0; i < this.numCells; i++) {
      const cx = this.centroids[i * 3] ?? 0;
      const cy = this.centroids[i * 3 + 1] ?? 0;
      const cz = this.centroids[i * 3 + 2] ?? 0;
      const st = fn(cx, cy, cz, i);
      const r = Math.max(st.rho, MIN_DENSITY);
      const pr = Math.max(st.p, MIN_PRESSURE);
      this.rho[i] = r;
      this.rhoU[i] = r * st.u;
      this.rhoV[i] = r * st.v;
      this.rhoW[i] = r * st.w;
      this.rhoE[i] = pr * invGm1 + 0.5 * r * (st.u * st.u + st.v * st.v + st.w * st.w);
    }
  }

  /** Extract primitive variables and derived thermodynamics for a cell. */
  public getCellPrimitive(cellIndex: number): PrimitiveState {
    const rho = Math.max(this.rho[cellIndex] ?? MIN_DENSITY, MIN_DENSITY);
    const u = (this.rhoU[cellIndex] ?? 0) / rho;
    const v = (this.rhoV[cellIndex] ?? 0) / rho;
    const w = (this.rhoW[cellIndex] ?? 0) / rho;
    const rE = this.rhoE[cellIndex] ?? 0;
    const q2 = u * u + v * v + w * w;
    const p = Math.max((this.gamma - 1.0) * (rE - 0.5 * rho * q2), MIN_PRESSURE);
    const T = p / (rho * this.gasConstantR);
    const c = Math.sqrt((this.gamma * p) / rho);
    const mach = Math.sqrt(q2) / Math.max(c, 1e-12);
    return { rho, u, v, w, p, T, c, mach };
  }

  private evalRiemannFlux(nx: number, ny: number, nz: number): void {
    if (this.fluxType === "roe") {
      computeRoeFlux(this.uLBuf, this.uRBuf, nx, ny, nz, this.gamma, this.fluxBuf, this.entropyFixDelta);
    } else {
      computeHllcFlux(this.uLBuf, this.uRBuf, nx, ny, nz, this.gamma, this.fluxBuf);
    }
  }

  /**
   * Compute cell-centered Green-Gauss gradients and Barth-Jespersen slope limiters
   * for primitive variables `[rho, u, v, w, p]`.
   */
  private computeGreenGaussGradients(state: Float64Array): void {
    const n = this.numCells;
    const gm1 = this.gamma - 1.0;

    // 1. Convert conserved state to primitives and initialize min/max/grad buffers
    for (let i = 0; i < n; i++) {
      const rho = Math.max(state[i] ?? MIN_DENSITY, MIN_DENSITY);
      const u = (state[n + i] ?? 0) / rho;
      const v = (state[2 * n + i] ?? 0) / rho;
      const w = (state[3 * n + i] ?? 0) / rho;
      const rE = state[4 * n + i] ?? 0;
      const p = Math.max(gm1 * (rE - 0.5 * rho * (u * u + v * v + w * w)), MIN_PRESSURE);

      this.primBuf[i] = rho;
      this.primBuf[n + i] = u;
      this.primBuf[2 * n + i] = v;
      this.primBuf[3 * n + i] = w;
      this.primBuf[4 * n + i] = p;

      this.primMin[i] = rho;
      this.primMin[n + i] = u;
      this.primMin[2 * n + i] = v;
      this.primMin[3 * n + i] = w;
      this.primMin[4 * n + i] = p;

      this.primMax[i] = rho;
      this.primMax[n + i] = u;
      this.primMax[2 * n + i] = v;
      this.primMax[3 * n + i] = w;
      this.primMax[4 * n + i] = p;
    }

    this.gradX.fill(0.0);
    this.gradY.fill(0.0);
    this.gradZ.fill(0.0);

    // 2. Accumulate Green-Gauss surface integrals over internal faces
    for (let f = 0; f < this.numInternalFaces; f++) {
      const iL = this.intLeft[f]!;
      const iR = this.intRight[f]!;
      const area = this.intArea[f]!;
      const sx = area * this.intNx[f]!;
      const sy = area * this.intNy[f]!;
      const sz = area * this.intNz[f]!;

      for (let m = 0; m < NVARS; m++) {
        const base = m * n;
        const qL = this.primBuf[base + iL]!;
        const qR = this.primBuf[base + iR]!;
        const qF = 0.5 * (qL + qR);

        this.gradX[base + iL] = (this.gradX[base + iL] ?? 0) + qF * sx;
        this.gradY[base + iL] = (this.gradY[base + iL] ?? 0) + qF * sy;
        this.gradZ[base + iL] = (this.gradZ[base + iL] ?? 0) + qF * sz;

        this.gradX[base + iR] = (this.gradX[base + iR] ?? 0) - qF * sx;
        this.gradY[base + iR] = (this.gradY[base + iR] ?? 0) - qF * sy;
        this.gradZ[base + iR] = (this.gradZ[base + iR] ?? 0) - qF * sz;

        if (qR < this.primMin[base + iL]!) this.primMin[base + iL] = qR;
        if (qR > this.primMax[base + iL]!) this.primMax[base + iL] = qR;
        if (qL < this.primMin[base + iR]!) this.primMin[base + iR] = qL;
        if (qL > this.primMax[base + iR]!) this.primMax[base + iR] = qL;
      }
    }

    // 3. Accumulate boundary face contributions (zero-gradient closure)
    for (let f = 0; f < this.numBoundaryFaces; f++) {
      const iC = this.bndCell[f]!;
      const area = this.bndArea[f]!;
      const sx = area * this.bndNx[f]!;
      const sy = area * this.bndNy[f]!;
      const sz = area * this.bndNz[f]!;

      for (let m = 0; m < NVARS; m++) {
        const base = m * n;
        const qF = this.primBuf[base + iC]!;
        this.gradX[base + iC] = (this.gradX[base + iC] ?? 0) + qF * sx;
        this.gradY[base + iC] = (this.gradY[base + iC] ?? 0) + qF * sy;
        this.gradZ[base + iC] = (this.gradZ[base + iC] ?? 0) + qF * sz;
      }
    }

    // 4. Divide by cell volume
    for (let i = 0; i < n; i++) {
      const invVol = 1.0 / this.volumes[i]!;
      for (let m = 0; m < NVARS; m++) {
        const idx = m * n + i;
        this.gradX[idx] = (this.gradX[idx] ?? 0) * invVol;
        this.gradY[idx] = (this.gradY[idx] ?? 0) * invVol;
        this.gradZ[idx] = (this.gradZ[idx] ?? 0) * invVol;
      }
    }

    // 5. Barth-Jespersen slope limiter across internal faces
    this.limiterPhi.fill(1.0);
    for (let f = 0; f < this.numInternalFaces; f++) {
      const iL = this.intLeft[f]!;
      const iR = this.intRight[f]!;
      const fcx = this.intCx[f]!;
      const fcy = this.intCy[f]!;
      const fcz = this.intCz[f]!;

      const dxL = fcx - this.centroids[iL * 3]!;
      const dyL = fcy - this.centroids[iL * 3 + 1]!;
      const dzL = fcz - this.centroids[iL * 3 + 2]!;

      const dxR = fcx - this.centroids[iR * 3]!;
      const dyR = fcy - this.centroids[iR * 3 + 1]!;
      const dzR = fcz - this.centroids[iR * 3 + 2]!;

      for (let m = 0; m < NVARS; m++) {
        const base = m * n;

        // Left cell limiter
        const idxL = base + iL;
        const dqL = this.gradX[idxL]! * dxL + this.gradY[idxL]! * dyL + this.gradZ[idxL]! * dzL;
        if (dqL > 1e-15) {
          const dMax = this.primMax[idxL]! - this.primBuf[idxL]!;
          const phi = Math.min(1.0, Math.max(0.0, dMax / dqL));
          if (phi < this.limiterPhi[idxL]!) this.limiterPhi[idxL] = phi;
        } else if (dqL < -1e-15) {
          const dMin = this.primMin[idxL]! - this.primBuf[idxL]!;
          const phi = Math.min(1.0, Math.max(0.0, dMin / dqL));
          if (phi < this.limiterPhi[idxL]!) this.limiterPhi[idxL] = phi;
        }

        // Right cell limiter
        const idxR = base + iR;
        const dqR = this.gradX[idxR]! * dxR + this.gradY[idxR]! * dyR + this.gradZ[idxR]! * dzR;
        if (dqR > 1e-15) {
          const dMax = this.primMax[idxR]! - this.primBuf[idxR]!;
          const phi = Math.min(1.0, Math.max(0.0, dMax / dqR));
          if (phi < this.limiterPhi[idxR]!) this.limiterPhi[idxR] = phi;
        } else if (dqR < -1e-15) {
          const dMin = this.primMin[idxR]! - this.primBuf[idxR]!;
          const phi = Math.min(1.0, Math.max(0.0, dMin / dqR));
          if (phi < this.limiterPhi[idxR]!) this.limiterPhi[idxR] = phi;
        }
      }
    }
  }

  /**
   * Compute the finite-volume spatial residual `R(U) = -(1/V_i) sum_f A_f F_f`
   * for all cells and conserved variables.
   */
  public computeResidual(state: Float64Array = this.state, rhsOut: Float64Array = this.rhs): Float64Array {
    const n = this.numCells;
    const gm1 = this.gamma - 1.0;
    const invGm1 = 1.0 / gm1;
    const useMuscl = this.reconstructionOrder === 2;

    rhsOut.fill(0.0);

    if (useMuscl) {
      this.computeGreenGaussGradients(state);
    }

    // 1. Internal faces
    for (let f = 0; f < this.numInternalFaces; f++) {
      const iL = this.intLeft[f]!;
      const iR = this.intRight[f]!;
      const area = this.intArea[f]!;
      const nx = this.intNx[f]!;
      const ny = this.intNy[f]!;
      const nz = this.intNz[f]!;

      if (useMuscl) {
        const fcx = this.intCx[f]!;
        const fcy = this.intCy[f]!;
        const fcz = this.intCz[f]!;

        const dxL = fcx - this.centroids[iL * 3]!;
        const dyL = fcy - this.centroids[iL * 3 + 1]!;
        const dzL = fcz - this.centroids[iL * 3 + 2]!;

        const rhoL =
          this.primBuf[iL]! +
          this.limiterPhi[iL]! * (this.gradX[iL]! * dxL + this.gradY[iL]! * dyL + this.gradZ[iL]! * dzL);
        const uL =
          this.primBuf[n + iL]! +
          this.limiterPhi[n + iL]! *
            (this.gradX[n + iL]! * dxL + this.gradY[n + iL]! * dyL + this.gradZ[n + iL]! * dzL);
        const vL =
          this.primBuf[2 * n + iL]! +
          this.limiterPhi[2 * n + iL]! *
            (this.gradX[2 * n + iL]! * dxL + this.gradY[2 * n + iL]! * dyL + this.gradZ[2 * n + iL]! * dzL);
        const wL =
          this.primBuf[3 * n + iL]! +
          this.limiterPhi[3 * n + iL]! *
            (this.gradX[3 * n + iL]! * dxL + this.gradY[3 * n + iL]! * dyL + this.gradZ[3 * n + iL]! * dzL);
        const pL =
          this.primBuf[4 * n + iL]! +
          this.limiterPhi[4 * n + iL]! *
            (this.gradX[4 * n + iL]! * dxL + this.gradY[4 * n + iL]! * dyL + this.gradZ[4 * n + iL]! * dzL);

        if (rhoL > MIN_DENSITY && pL > MIN_PRESSURE) {
          this.uLBuf[0] = rhoL;
          this.uLBuf[1] = rhoL * uL;
          this.uLBuf[2] = rhoL * vL;
          this.uLBuf[3] = rhoL * wL;
          this.uLBuf[4] = pL * invGm1 + 0.5 * rhoL * (uL * uL + vL * vL + wL * wL);
        } else {
          for (let m = 0; m < NVARS; m++) {
            this.uLBuf[m] = state[m * n + iL]!;
          }
        }

        const dxR = fcx - this.centroids[iR * 3]!;
        const dyR = fcy - this.centroids[iR * 3 + 1]!;
        const dzR = fcz - this.centroids[iR * 3 + 2]!;

        const rhoR =
          this.primBuf[iR]! +
          this.limiterPhi[iR]! * (this.gradX[iR]! * dxR + this.gradY[iR]! * dyR + this.gradZ[iR]! * dzR);
        const uR =
          this.primBuf[n + iR]! +
          this.limiterPhi[n + iR]! *
            (this.gradX[n + iR]! * dxR + this.gradY[n + iR]! * dyR + this.gradZ[n + iR]! * dzR);
        const vR =
          this.primBuf[2 * n + iR]! +
          this.limiterPhi[2 * n + iR]! *
            (this.gradX[2 * n + iR]! * dxR + this.gradY[2 * n + iR]! * dyR + this.gradZ[2 * n + iR]! * dzR);
        const wR =
          this.primBuf[3 * n + iR]! +
          this.limiterPhi[3 * n + iR]! *
            (this.gradX[3 * n + iR]! * dxR + this.gradY[3 * n + iR]! * dyR + this.gradZ[3 * n + iR]! * dzR);
        const pR =
          this.primBuf[4 * n + iR]! +
          this.limiterPhi[4 * n + iR]! *
            (this.gradX[4 * n + iR]! * dxR + this.gradY[4 * n + iR]! * dyR + this.gradZ[4 * n + iR]! * dzR);

        if (rhoR > MIN_DENSITY && pR > MIN_PRESSURE) {
          this.uRBuf[0] = rhoR;
          this.uRBuf[1] = rhoR * uR;
          this.uRBuf[2] = rhoR * vR;
          this.uRBuf[3] = rhoR * wR;
          this.uRBuf[4] = pR * invGm1 + 0.5 * rhoR * (uR * uR + vR * vR + wR * wR);
        } else {
          for (let m = 0; m < NVARS; m++) {
            this.uRBuf[m] = state[m * n + iR]!;
          }
        }
      } else {
        for (let m = 0; m < NVARS; m++) {
          const base = m * n;
          this.uLBuf[m] = state[base + iL]!;
          this.uRBuf[m] = state[base + iR]!;
        }
      }

      this.evalRiemannFlux(nx, ny, nz);

      for (let m = 0; m < NVARS; m++) {
        const fluxA = this.fluxBuf[m]! * area;
        const base = m * n;
        rhsOut[base + iL] = (rhsOut[base + iL] ?? 0) - fluxA;
        rhsOut[base + iR] = (rhsOut[base + iR] ?? 0) + fluxA;
      }
    }

    // 2. Boundary faces
    for (let f = 0; f < this.numBoundaryFaces; f++) {
      const iC = this.bndCell[f]!;
      const area = this.bndArea[f]!;
      const nx = this.bndNx[f]!;
      const ny = this.bndNy[f]!;
      const nz = this.bndNz[f]!;
      const bcCode = this.bndTypeCode[f]!;

      for (let m = 0; m < NVARS; m++) {
        this.uLBuf[m] = state[m * n + iC]!;
      }

      if (bcCode === 1) {
        // slip_wall: reflect normal velocity into ghost state
        const rho = this.uLBuf[0]!;
        const ru = this.uLBuf[1]!;
        const rv = this.uLBuf[2]!;
        const rw = this.uLBuf[3]!;
        const rE = this.uLBuf[4]!;
        const rqn = ru * nx + rv * ny + rw * nz;
        this.uRBuf[0] = rho;
        this.uRBuf[1] = ru - 2.0 * rqn * nx;
        this.uRBuf[2] = rv - 2.0 * rqn * ny;
        this.uRBuf[3] = rw - 2.0 * rqn * nz;
        this.uRBuf[4] = rE;
      } else if (bcCode === 2) {
        // inlet: use prescribed inlet state (fallback to farfield or interior)
        const src = this.inletConserved ?? this.farfieldConserved;
        if (src) {
          this.uRBuf.set(src);
        } else {
          this.uRBuf.set(this.uLBuf);
        }
      } else if (bcCode === 3) {
        // outlet: prescribed static pressure for subsonic outflow, else extrapolate
        if (this.outletPressure !== null) {
          const rho = Math.max(this.uLBuf[0]!, MIN_DENSITY);
          const u = this.uLBuf[1]! / rho;
          const v = this.uLBuf[2]! / rho;
          const w = this.uLBuf[3]! / rho;
          const ke = 0.5 * rho * (u * u + v * v + w * w);
          const pInt = Math.max(gm1 * (this.uLBuf[4]! - ke), MIN_PRESSURE);
          const c = Math.sqrt((this.gamma * pInt) / rho);
          const qn = u * nx + v * ny + w * nz;
          if (qn < c) {
            this.uRBuf[0] = rho;
            this.uRBuf[1] = this.uLBuf[1]!;
            this.uRBuf[2] = this.uLBuf[2]!;
            this.uRBuf[3] = this.uLBuf[3]!;
            this.uRBuf[4] = this.outletPressure * invGm1 + ke;
          } else {
            this.uRBuf.set(this.uLBuf);
          }
        } else {
          this.uRBuf.set(this.uLBuf);
        }
      } else {
        // farfield: prescribed freestream state if set, otherwise zero-gradient extrapolation
        if (this.farfieldConserved) {
          this.uRBuf.set(this.farfieldConserved);
        } else {
          this.uRBuf.set(this.uLBuf);
        }
      }

      this.evalRiemannFlux(nx, ny, nz);

      for (let m = 0; m < NVARS; m++) {
        const fluxA = this.fluxBuf[m]! * area;
        const base = m * n;
        rhsOut[base + iC] = (rhsOut[base + iC] ?? 0) - fluxA;
      }
    }

    // 3. Divide accumulated flux divergence by cell volume V_i
    for (let i = 0; i < n; i++) {
      const invVol = 1.0 / this.volumes[i]!;
      for (let m = 0; m < NVARS; m++) {
        const idx = m * n + i;
        rhsOut[idx] = (rhsOut[idx] ?? 0) * invVol;
      }
    }

    return rhsOut;
  }

  /**
   * Compute the maximum absolute residual `max_{i, m} |R_m(U_i)|` for the current state.
   * Used to verify exact freestream preservation (`< 1e-11`).
   */
  public computeMaxResidual(): number {
    this.computeResidual(this.state, this.rhs);
    let maxRes = 0.0;
    for (let i = 0; i < this.rhs.length; i++) {
      const a = Math.abs(this.rhs[i] ?? 0);
      if (a > maxRes) maxRes = a;
    }
    return maxRes;
  }

  /**
   * Compute the global stable explicit timestep `dt` from the unstructured FVM
   * convective spectral radius `Lambda_i = sum_f (|u_i . n_f| + c_i) A_f`:
   * `dt = min_i (cfl * V_i / Lambda_i)`.
   */
  public computeCflTimestep(cfl: number = this.defaultCfl): number {
    const n = this.numCells;
    const gm1 = this.gamma - 1.0;
    this.spectralRadius.fill(0.0);

    // Precompute cell velocities and sound speeds into primBuf[0..4*n]
    for (let i = 0; i < n; i++) {
      const rho = Math.max(this.rho[i] ?? MIN_DENSITY, MIN_DENSITY);
      const u = (this.rhoU[i] ?? 0) / rho;
      const v = (this.rhoV[i] ?? 0) / rho;
      const w = (this.rhoW[i] ?? 0) / rho;
      const p = Math.max(gm1 * ((this.rhoE[i] ?? 0) - 0.5 * rho * (u * u + v * v + w * w)), MIN_PRESSURE);
      const c = Math.sqrt((this.gamma * p) / rho);
      this.primBuf[i] = u;
      this.primBuf[n + i] = v;
      this.primBuf[2 * n + i] = w;
      this.primBuf[3 * n + i] = c;
    }

    for (let f = 0; f < this.numInternalFaces; f++) {
      const iL = this.intLeft[f]!;
      const iR = this.intRight[f]!;
      const area = this.intArea[f]!;
      const nx = this.intNx[f]!;
      const ny = this.intNy[f]!;
      const nz = this.intNz[f]!;

      const qnL = Math.abs(this.primBuf[iL]! * nx + this.primBuf[n + iL]! * ny + this.primBuf[2 * n + iL]! * nz);
      const lamL = (qnL + this.primBuf[3 * n + iL]!) * area;
      this.spectralRadius[iL] = (this.spectralRadius[iL] ?? 0) + lamL;

      const qnR = Math.abs(this.primBuf[iR]! * nx + this.primBuf[n + iR]! * ny + this.primBuf[2 * n + iR]! * nz);
      const lamR = (qnR + this.primBuf[3 * n + iR]!) * area;
      this.spectralRadius[iR] = (this.spectralRadius[iR] ?? 0) + lamR;
    }

    for (let f = 0; f < this.numBoundaryFaces; f++) {
      const iC = this.bndCell[f]!;
      const area = this.bndArea[f]!;
      const nx = this.bndNx[f]!;
      const ny = this.bndNy[f]!;
      const nz = this.bndNz[f]!;

      const qn = Math.abs(this.primBuf[iC]! * nx + this.primBuf[n + iC]! * ny + this.primBuf[2 * n + iC]! * nz);
      const lam = (qn + this.primBuf[3 * n + iC]!) * area;
      this.spectralRadius[iC] = (this.spectralRadius[iC] ?? 0) + lam;
    }

    let dtMin = Number.POSITIVE_INFINITY;
    for (let i = 0; i < n; i++) {
      const lam = Math.max(this.spectralRadius[i] ?? 0, 1e-12);
      const dtCell = (cfl * this.volumes[i]!) / lam;
      if (dtCell < dtMin) dtMin = dtCell;
    }

    return Number.isFinite(dtMin) ? dtMin : 1e-6;
  }

  private enforcePositivity(state: Float64Array): void {
    const n = this.numCells;
    const invGm1 = 1.0 / (this.gamma - 1.0);
    for (let i = 0; i < n; i++) {
      let rho = state[i] ?? MIN_DENSITY;
      if (rho < MIN_DENSITY) {
        rho = MIN_DENSITY;
        state[i] = rho;
      }
      const ru = state[n + i] ?? 0;
      const rv = state[2 * n + i] ?? 0;
      const rw = state[3 * n + i] ?? 0;
      const ke = (0.5 * (ru * ru + rv * rv + rw * rw)) / rho;
      const minE = ke + MIN_PRESSURE * invGm1;
      if ((state[4 * n + i] ?? 0) < minE) {
        state[4 * n + i] = minE;
      }
    }
  }

  /**
   * Advance the solution by one explicit 3-stage Strong-Stability-Preserving
   * Runge-Kutta (SSP-RK3) step of size `dt` (or auto-computed CFL timestep if omitted).
   */
  public stepSspRk3(dtOverride?: number | undefined): number {
    const dt = dtOverride ?? this.computeCflTimestep(this.defaultCfl);
    const len = this.state.length;

    this.u0.set(this.state);

    // Stage 1: u1 = u0 + dt * R(u0)
    this.computeResidual(this.u0, this.rhs);
    for (let i = 0; i < len; i++) {
      this.u1[i] = this.u0[i]! + dt * this.rhs[i]!;
    }
    this.enforcePositivity(this.u1);

    // Stage 2: u2 = 3/4 u0 + 1/4 u1 + 1/4 dt * R(u1)
    this.computeResidual(this.u1, this.rhs);
    for (let i = 0; i < len; i++) {
      this.state[i] = 0.75 * this.u0[i]! + 0.25 * this.u1[i]! + 0.25 * dt * this.rhs[i]!;
    }
    this.enforcePositivity(this.state);

    // Stage 3: u^{n+1} = 1/3 u0 + 2/3 u2 + 2/3 dt * R(u2)
    this.computeResidual(this.state, this.rhs);
    for (let i = 0; i < len; i++) {
      this.state[i] = (1.0 / 3.0) * this.u0[i]! + (2.0 / 3.0) * this.state[i]! + (2.0 / 3.0) * dt * this.rhs[i]!;
    }
    this.enforcePositivity(this.state);

    return dt;
  }

  /**
   * Integrate pressure force `sum_f (p_f * A_f * n_f)` across all `slip_wall`
   * boundary faces and return `[Fx, Fy, Fz]` in Newtons.
   */
  public computeWallForces(): [number, number, number] {
    const gm1 = this.gamma - 1.0;
    let fx = 0.0;
    let fy = 0.0;
    let fz = 0.0;

    for (let f = 0; f < this.numBoundaryFaces; f++) {
      if (this.bndTypeCode[f] !== 1) continue;
      const iC = this.bndCell[f]!;
      const rho = Math.max(this.rho[iC] ?? MIN_DENSITY, MIN_DENSITY);
      const u = (this.rhoU[iC] ?? 0) / rho;
      const v = (this.rhoV[iC] ?? 0) / rho;
      const w = (this.rhoW[iC] ?? 0) / rho;
      const p = Math.max(gm1 * ((this.rhoE[iC] ?? 0) - 0.5 * rho * (u * u + v * v + w * w)), MIN_PRESSURE);
      const pA = p * this.bndArea[f]!;
      fx += pA * this.bndNx[f]!;
      fy += pA * this.bndNy[f]!;
      fz += pA * this.bndNz[f]!;
    }

    return [fx, fy, fz];
  }
}
