// SPDX-License-Identifier: AGPL-3.0-or-later

import { AmrErrorIndicator, OctreeLbmRefiner } from "../meshing/amr-adapter.js";
import { CfdFieldArena, D3Q19_CX as CX, D3Q19_CY as CY, D3Q19_CZ as CZ, D3Q19_WEIGHTS as W } from "./cfd-arena.js";
import { LbmCellType, type LbmGridConfig, type LbmStepResult } from "./lbm-types.js";
import { WebGPULbmRunner } from "./webgpu-lbm-runner.js";

/**
 * Specification for a 2x-refined local octree patch block embedded in the coarse LBM grid.
 */
export interface OctreePatchSpec {
  /** Optional identifier for this refined patch (e.g. "cylinder-bl", "wake"). */
  id?: string | undefined;
  /** Coarse-grid origin cell indices [x0, y0, z0] (inclusive). */
  coarseOrigin: [number, number, number];
  /** Number of coarse cells covered by this patch [cx, cy, cz]. */
  coarseSize: [number, number, number];
  /**
   * Optional fine-resolution cell type classifier (overrides coarse prolongation).
   * Receives fine cell center coordinates in normalized domain units [0, 1]^3.
   */
  fineCellClassifier?: ((nxFrac: number, nyFrac: number, nzFrac: number) => LbmCellType) | undefined;
}

/**
 * Options for configuring the 2-level OctreeLbmRunner.
 */
export interface OctreeLbmOptions {
  /** Explicit refined patch specifications. If omitted, patches are derived automatically via OctreeLbmRefiner. */
  patches?: OctreePatchSpec[] | undefined;
  /** Target fraction of coarse cells to refine when auto-generating patches (default: 0.12). */
  refineFraction?: number | undefined;
  /** Optional fine-resolution cell classifier used when auto-generating patches around obstacles. */
  fineCellClassifier?: ((nxFrac: number, nyFrac: number, nzFrac: number) => LbmCellType) | undefined;
}

/**
 * A single 2x-refined local fine LBM patch block with 1-cell ghost halo on all 6 faces.
 */
export interface OctreeRefinedPatch {
  readonly id: string;
  /** Coarse-grid origin [x0, y0, z0] (inclusive). */
  readonly coarseOrigin: [number, number, number];
  /** Number of coarse cells covered [cx, cy, cz]. */
  readonly coarseSize: [number, number, number];
  /** Fine-grid dimensions including 1-cell ghost halo on all 6 faces: [2*cx+2, 2*cy+2, 2*cz+2]. */
  readonly fineSize: [number, number, number];
  /** Fine-grid LBM configuration (dx_f = dx_c/2, dt_f = dt_c/2, tau_f = 0.5 + 2*(tau_c - 0.5)). */
  readonly config: LbmGridConfig;
  /** Dedicated WebGPULbmRunner executing on this fine patch block. */
  readonly runner: WebGPULbmRunner;
  /** Whether this patch contains any ObstacleSolid cells. */
  readonly hasObstacleCells: boolean;
}

/**
 * Extended step result for multi-level Octree LBM simulations.
 */
export interface OctreeLbmStepResult extends LbmStepResult {
  /** Total coarse steps executed in this call. */
  coarseSteps: number;
  /** Total fine sub-steps executed per patch in this call (2 * coarseSteps). */
  fineSteps: number;
  /** Physical kinematic viscosity on coarse grid (m^2/s). */
  coarseViscosity: number;
  /** Physical kinematic viscosity on fine patches (m^2/s), invariant under acoustic scaling. */
  fineViscosity: number;
  /** Coarse BGK relaxation time tau_c. */
  coarseTau: number;
  /** Fine BGK relaxation time tau_f = 0.5 + 2 * (tau_c - 0.5). */
  fineTau: number;
  /** Total active cells across uncovered coarse cells + fine patch cells. */
  activeCellCount: number;
  /** Equivalent uniform fine grid cell count (8 * nx_c * ny_c * nz_c). */
  equivalentUniformFineCells: number;
  /** Ratio activeCellCount / equivalentUniformFineCells (< 1.0 means memory/compute savings). */
  compressionRatio: number;
  /** Composite fluid mass (kg) across uncovered coarse cells + fine interior cells. */
  totalMass: number;
  /** Relative mass conservation drift |M(t) - M(0)| / M(0). */
  massConservationError: number;
  /** Number of active fine patches. */
  patchCount: number;
}

/**
 * Computes acoustic-scaled fine relaxation time tau_f from coarse tau_c so that
 * physical kinematic viscosity nu = c_s^2 * (tau - 0.5) * (dx^2 / dt) is invariant
 * under 2:1 grid/timestep refinement (dx_f = dx_c / 2, dt_f = dt_c / 2).
 */
export function computeAcousticFineTau(coarseTau: number): number {
  return 0.5 + 2.0 * (coarseTau - 0.5);
}

/**
 * Computes physical kinematic viscosity nu = (1/3) * (tau - 0.5) * (dx^2 / dt).
 */
export function computePhysicalViscosity(tau: number, dx: number, dt: number): number {
  return (1.0 / 3.0) * (tau - 0.5) * ((dx * dx) / dt);
}

/**
 * Computes D3Q19 2nd-order equilibrium distribution f^eq_i(rho, ux, uy, uz).
 */
function computeFeq(i: number, rho: number, ux: number, uy: number, uz: number, uSq: number): number {
  const cu = CX[i]! * ux + CY[i]! * uy + CZ[i]! * uz;
  return W[i]! * rho * (1.0 + 3.0 * cu + 4.5 * cu * cu - 1.5 * uSq);
}

/**
 * Returns the currently active ping/pong distribution buffer for a WebGPULbmRunner.
 */
function getActiveF(runner: WebGPULbmRunner): Float32Array {
  const ping = (runner as unknown as { currentPing: boolean }).currentPing;
  return ping ? runner.arena.f0 : (runner.arena.f1 ?? runner.arena.f0);
}

/**
 * Invalidates the static WASM LBM buffer ownership cache on WebGPULbmRunner
 * after external JS mutation of f0/f1 buffers.
 */
function invalidateWasmCache(): void {
  const staticClass = WebGPULbmRunner as unknown as {
    wasmLbmBuffers?: { owner: unknown } | undefined;
  };
  if (staticClass.wasmLbmBuffers) {
    staticClass.wasmLbmBuffers.owner = null;
  }
}

/**
 * Multi-Level 2:1 Octree Lattice Boltzmann Runner.
 *
 * Couples a coarse global D3Q19 LBM grid (`WebGPULbmRunner`) with one or more
 * 2x-refined local fine patch blocks (`OctreeRefinedPatch`) guided by
 * `OctreeLbmRefiner`.
 *
 * Implements:
 * - Acoustic-scaled 2:1 sub-stepping: 1 coarse step (dx_c, dt_c, tau_c) <->
 *   2 fine steps (dx_f = dx_c/2, dt_f = dt_c/2, tau_f = 0.5 + 2*(tau_c - 0.5)),
 *   preserving physical kinematic viscosity nu_f === nu_c and lattice velocity scale.
 * - Coarse-to-fine explosion: trilinear interpolation of macroscopic (rho, u)
 *   and rescaled non-equilibrium populations f^neq_f = (tau_f / (2 * tau_c)) * f^neq_c
 *   onto fine patch ghost boundaries.
 * - Fine-to-coarse coalescence: conservative 2x2x2 volume-averaged restriction of
 *   fine interior cells back onto the coarse grid with inverse non-equilibrium
 *   rescaling f^neq_c = (2 * tau_c / tau_f) * <f^neq_f>.
 */
export class OctreeLbmRunner {
  public readonly coarseConfig: LbmGridConfig;
  public readonly coarseRunner: WebGPULbmRunner;
  public readonly patches: OctreeRefinedPatch[];

  public readonly coarseTau: number;
  public readonly fineTau: number;
  public readonly coarseViscosity: number;
  public readonly fineViscosity: number;

  public readonly activeCellCount: number;
  public readonly equivalentUniformFineCells: number;
  public readonly compressionRatio: number;

  private readonly coveredCoarseMask: Uint8Array;
  private readonly hasUncoveredObstacleCells: boolean;
  private readonly initialMass: number;
  private totalCoarseSteps: number = 0;

  constructor(coarseConfig: LbmGridConfig, coarseCellTypes: Uint8Array | Uint32Array, options?: OctreeLbmOptions) {
    this.coarseConfig = coarseConfig;
    const coarseArena = new CfdFieldArena(coarseConfig, coarseCellTypes, { scheme: "two-buffer" });
    this.coarseRunner = new WebGPULbmRunner(coarseConfig, coarseCellTypes, coarseArena);

    this.coarseTau = coarseConfig.tau;
    this.fineTau = computeAcousticFineTau(coarseConfig.tau);
    this.coarseViscosity = computePhysicalViscosity(this.coarseTau, coarseConfig.dx, coarseConfig.dt);
    this.fineViscosity = computePhysicalViscosity(this.fineTau, coarseConfig.dx * 0.5, coarseConfig.dt * 0.5);

    const specs =
      options?.patches && options.patches.length > 0
        ? options.patches
        : OctreeLbmRunner.buildAutoPatches(
            coarseConfig,
            coarseCellTypes,
            options?.refineFraction ?? 0.12,
            options?.fineCellClassifier,
          );

    const { nx, ny, nz } = coarseConfig;
    const coarseTotal = nx * ny * nz;
    this.coveredCoarseMask = new Uint8Array(coarseTotal);

    this.patches = specs.map((spec, idx) =>
      this.createRefinedPatch(spec, idx, coarseCellTypes, options?.fineCellClassifier),
    );

    // Mark coarse cells covered by fine patches
    let coveredCount = 0;
    for (const patch of this.patches) {
      const [x0, y0, z0] = patch.coarseOrigin;
      const [cx, cy, cz] = patch.coarseSize;
      for (let z = z0; z < z0 + cz; z++) {
        for (let y = y0; y < y0 + cy; y++) {
          for (let x = x0; x < x0 + cx; x++) {
            const cIdx = x + y * nx + z * nx * ny;
            if (this.coveredCoarseMask[cIdx] === 0) {
              this.coveredCoarseMask[cIdx] = 1;
              coveredCount++;
            }
          }
        }
      }
    }

    // Detect if any ObstacleSolid cells exist outside all fine patches
    let uncoveredObstacle = false;
    for (let i = 0; i < coarseTotal; i++) {
      if (coarseCellTypes[i] === LbmCellType.ObstacleSolid && this.coveredCoarseMask[i] === 0) {
        uncoveredObstacle = true;
        break;
      }
    }
    this.hasUncoveredObstacleCells = uncoveredObstacle;

    let fineCellsTotal = 0;
    for (const patch of this.patches) {
      fineCellsTotal += patch.runner.totalCells;
    }

    const uncoveredCoarseCells = coarseTotal - coveredCount;
    this.activeCellCount = uncoveredCoarseCells + fineCellsTotal;
    this.equivalentUniformFineCells = coarseTotal * 8;
    this.compressionRatio =
      this.equivalentUniformFineCells > 0 ? this.activeCellCount / this.equivalentUniformFineCells : 1.0;

    // Synchronize initial fine patch interiors from coarse grid
    for (const patch of this.patches) {
      this.explodeCoarseToFine(patch, true);
    }
    this.initialMass = this.computeTotalMass();
  }

  /**
   * Automatically builds localized 2x refinement patch specs using `OctreeLbmRefiner`
   * driven by obstacle boundary-layer proximity and/or vorticity feature indicators.
   */
  public static buildAutoPatches(
    coarseConfig: LbmGridConfig,
    coarseCellTypes: Uint8Array | Uint32Array,
    refineFraction: number = 0.12,
    fineCellClassifier?: (nxFrac: number, nyFrac: number, nzFrac: number) => LbmCellType,
  ): OctreePatchSpec[] {
    const { nx, ny, nz } = coarseConfig;
    const total = nx * ny * nz;
    const indicator = new Float32Array(total);

    // Build obstacle proximity + wake indicator so OctreeLbmRefiner concentrates refinement
    // around immersed obstacle boundary layers and near-wake.
    const obstacleCoords: Array<[number, number, number]> = [];
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const idx = x + y * nx + z * nx * ny;
          if (coarseCellTypes[idx] === LbmCellType.ObstacleSolid) {
            obstacleCoords.push([x, y, z]);
          }
        }
      }
    }

    if (obstacleCoords.length > 0) {
      let minOx = nx,
        maxOx = 0,
        minOy = ny,
        maxOy = 0,
        minOz = nz,
        maxOz = 0;
      for (const [ox, oy, oz] of obstacleCoords) {
        if (ox < minOx) minOx = ox;
        if (ox > maxOx) maxOx = ox;
        if (oy < minOy) minOy = oy;
        if (oy > maxOy) maxOy = oy;
        if (oz < minOz) minOz = oz;
        if (oz > maxOz) maxOz = oz;
      }
      const cxMid = 0.5 * (minOx + maxOx);
      const cyMid = 0.5 * (minOy + maxOy);
      const czMid = 0.5 * (minOz + maxOz);
      const rad = Math.max(1.5, 0.5 * Math.hypot(maxOx - minOx + 1, maxOy - minOy + 1));

      for (let z = 1; z < nz - 1; z++) {
        for (let y = 1; y < ny - 1; y++) {
          for (let x = 1; x < nx - 1; x++) {
            const idx = x + y * nx + z * nx * ny;
            // Weight obstacle surface and downstream wake (+x)
            const dxw = x >= cxMid ? (x - cxMid) * 0.65 : (cxMid - x) * 1.1;
            const dyw = y - cyMid;
            const dzw = (z - czMid) * 0.5;
            const dist = Math.hypot(dxw, dyw, dzw);
            indicator[idx] = 1.0 / (1.0 + (dist / rad) * (dist / rad));
          }
        }
      }
    } else {
      // Fallback: center-domain indicator
      for (let z = 1; z < nz - 1; z++) {
        for (let y = 1; y < ny - 1; y++) {
          for (let x = 1; x < nx - 1; x++) {
            const idx = x + y * nx + z * nx * ny;
            const dxw = x - 0.5 * nx;
            const dyw = y - 0.5 * ny;
            const dzw = z - 0.5 * nz;
            indicator[idx] = 1.0 / (1.0 + dxw * dxw + dyw * dyw + dzw * dzw);
          }
        }
      }
    }

    const amr = OctreeLbmRefiner.buildRefinementMap(nx, ny, nz, indicator, {
      refineFraction,
      maxLevel: 1,
    });

    // Compute tight bounding box of refined cells (clamped inside [1 .. n-2] to leave coarse boundary margin)
    let minX = nx - 2,
      maxX = 1;
    let minY = ny - 2,
      maxY = 1;
    let minZ = nz - 2,
      maxZ = 1;
    let found = false;

    for (let z = 1; z < nz - 1; z++) {
      for (let y = 1; y < ny - 1; y++) {
        for (let x = 1; x < nx - 1; x++) {
          const idx = x + y * nx + z * nx * ny;
          if (amr.refinementLevel[idx]! > 0) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            if (z < minZ) minZ = z;
            if (z > maxZ) maxZ = z;
            found = true;
          }
        }
      }
    }

    if (!found) {
      minX = Math.max(1, Math.floor(nx * 0.25));
      maxX = Math.min(nx - 2, Math.floor(nx * 0.55));
      minY = Math.max(1, Math.floor(ny * 0.25));
      maxY = Math.min(ny - 2, Math.floor(ny * 0.75));
      minZ = Math.max(1, Math.floor(nz * 0.25));
      maxZ = Math.min(nz - 2, Math.floor(nz * 0.75));
    }

    return [
      {
        id: "amr-patch-0",
        coarseOrigin: [minX, minY, minZ],
        coarseSize: [Math.max(2, maxX - minX + 1), Math.max(2, maxY - minY + 1), Math.max(2, maxZ - minZ + 1)],
        ...(fineCellClassifier ? { fineCellClassifier } : {}),
      },
    ];
  }

  /**
   * Computes a solution-driven vorticity refinement map on the current coarse velocity field
   * using `AmrErrorIndicator` and `OctreeLbmRefiner`.
   */
  public computeVorticityRefinementMap(refineFraction: number = 0.15) {
    const { nx, ny, nz, dx } = this.coarseConfig;
    const feat = AmrErrorIndicator.computeFeatureIndicator(
      nx,
      ny,
      nz,
      dx,
      this.coarseRunner.vx,
      this.coarseRunner.vy,
      this.coarseRunner.vz,
    );
    return OctreeLbmRefiner.buildRefinementMap(nx, ny, nz, feat.indicator, {
      refineFraction,
      maxLevel: 1,
    });
  }

  private createRefinedPatch(
    spec: OctreePatchSpec,
    index: number,
    coarseCellTypes: Uint8Array | Uint32Array,
    fallbackClassifier?: (nxFrac: number, nyFrac: number, nzFrac: number) => LbmCellType,
  ): OctreeRefinedPatch {
    const { nx, ny, nz } = this.coarseConfig;
    const x0 = Math.max(1, Math.min(nx - 3, Math.floor(spec.coarseOrigin[0])));
    const y0 = Math.max(1, Math.min(ny - 3, Math.floor(spec.coarseOrigin[1])));
    const z0 = Math.max(1, Math.min(nz - 3, Math.floor(spec.coarseOrigin[2])));
    const cx = Math.max(2, Math.min(nx - 1 - x0, Math.floor(spec.coarseSize[0])));
    const cy = Math.max(2, Math.min(ny - 1 - y0, Math.floor(spec.coarseSize[1])));
    const cz = Math.max(2, Math.min(nz - 1 - z0, Math.floor(spec.coarseSize[2])));

    // 1-cell fine ghost layer on all 6 faces
    const fnx = cx * 2 + 2;
    const fny = cy * 2 + 2;
    const fnz = cz * 2 + 2;
    const fTotal = fnx * fny * fnz;
    const fineCellTypes = new Uint8Array(fTotal);
    const classifier = spec.fineCellClassifier ?? fallbackClassifier;

    let hasObstacleCells = false;

    for (let fz = 0; fz < fnz; fz++) {
      const isGhostZ = fz === 0 || fz === fnz - 1;
      const czCoord = z0 + 0.5 * (fz - 1) - 0.25;
      const czIdx = Math.max(0, Math.min(nz - 1, Math.floor(czCoord + 0.5)));
      const nzFrac = (czCoord + 0.5) / nz;

      for (let fy = 0; fy < fny; fy++) {
        const isGhostY = fy === 0 || fy === fny - 1;
        const cyCoord = y0 + 0.5 * (fy - 1) - 0.25;
        const cyIdx = Math.max(0, Math.min(ny - 1, Math.floor(cyCoord + 0.5)));
        const nyFrac = (cyCoord + 0.5) / ny;

        for (let fx = 0; fx < fnx; fx++) {
          const isGhostX = fx === 0 || fx === fnx - 1;
          const cxCoord = x0 + 0.5 * (fx - 1) - 0.25;
          const cxIdx = Math.max(0, Math.min(nx - 1, Math.floor(cxCoord + 0.5)));
          const nxFrac = (cxCoord + 0.5) / nx;

          const fIdx = fx + fy * fnx + fz * fnx * fny;
          const isGhost = isGhostX || isGhostY || isGhostZ;

          let cType: LbmCellType;
          if (classifier) {
            cType = classifier(nxFrac, nyFrac, nzFrac);
          } else {
            cType = coarseCellTypes[cxIdx + cyIdx * nx + czIdx * nx * ny] as LbmCellType;
          }

          // Ghost boundary cells that map to fluid/inlet/outlet are treated as Fluid
          // so coarse-to-fine explosion supplies their boundary populations cleanly.
          if (isGhost && cType !== LbmCellType.ObstacleSolid && cType !== LbmCellType.ChannelWall) {
            cType = LbmCellType.Fluid;
          } else if (!isGhost && (cType === LbmCellType.VelocityInlet || cType === LbmCellType.PressureOutlet)) {
            cType = LbmCellType.Fluid;
          }

          fineCellTypes[fIdx] = cType;
          if (!isGhost && cType === LbmCellType.ObstacleSolid) {
            hasObstacleCells = true;
          }
        }
      }
    }

    // Acoustic-scaled fine configuration: dx_f = dx_c/2, dt_f = dt_c/2, tau_f = 0.5 + 2*(tau_c - 0.5)
    const fineConfig: LbmGridConfig = {
      ...this.coarseConfig,
      nx: fnx,
      ny: fny,
      nz: fnz,
      dx: this.coarseConfig.dx * 0.5,
      dt: this.coarseConfig.dt * 0.5,
      tau: this.fineTau,
      curvedBoundary: false,
      deltaWall: undefined,
    };

    const fineArena = new CfdFieldArena(fineConfig, fineCellTypes, { scheme: "two-buffer" });
    const fineRunner = new WebGPULbmRunner(fineConfig, fineCellTypes, fineArena);

    return {
      id: spec.id ?? `octree-patch-${index}`,
      coarseOrigin: [x0, y0, z0],
      coarseSize: [cx, cy, cz],
      fineSize: [fnx, fny, fnz],
      config: fineConfig,
      runner: fineRunner,
      hasObstacleCells,
    };
  }

  /**
   * Trilinearly samples coarse fluid macroscopic (rho, ux_lat, uy_lat, uz_lat) and
   * non-equilibrium distribution f^neq_c at continuous coarse cell-center coordinates (cx, cy, cz).
   */
  private sampleCoarseTrilinear(
    cx: number,
    cy: number,
    cz: number,
    coarseF: Float32Array,
    outFneq: Float64Array,
  ): { rho: number; ux: number; uy: number; uz: number } {
    const { nx, ny, nz } = this.coarseConfig;
    const cTotal = nx * ny * nz;
    const cTypes = this.coarseRunner.cellTypes;

    const x0 = Math.max(0, Math.min(nx - 2, Math.floor(cx)));
    const y0 = Math.max(0, Math.min(ny - 2, Math.floor(cy)));
    const z0 = Math.max(0, Math.min(nz - 2, Math.floor(cz)));
    const x1 = x0 + 1;
    const y1 = y0 + 1;
    const z1 = z0 + 1;

    const tx = Math.max(0.0, Math.min(1.0, cx - x0));
    const ty = Math.max(0.0, Math.min(1.0, cy - y0));
    const tz = Math.max(0.0, Math.min(1.0, cz - z0));

    const wx = [1.0 - tx, tx];
    const wy = [1.0 - ty, ty];
    const wz = [1.0 - tz, tz];
    const xs = [x0, x1];
    const ys = [y0, y1];
    const zs = [z0, z1];

    let wSum = 0.0;
    let rhoAcc = 0.0;
    let uxAcc = 0.0;
    let uyAcc = 0.0;
    let uzAcc = 0.0;
    outFneq.fill(0.0);

    for (let kz = 0; kz < 2; kz++) {
      const gz = zs[kz]!;
      for (let ky = 0; ky < 2; ky++) {
        const gy = ys[ky]!;
        for (let kx = 0; kx < 2; kx++) {
          const gx = xs[kx]!;
          const cIdx = gx + gy * nx + gz * nx * ny;
          const ct = cTypes[cIdx];
          if (ct === LbmCellType.ObstacleSolid || ct === LbmCellType.ChannelWall) {
            continue;
          }

          const weight = wx[kx]! * wy[ky]! * wz[kz]!;
          if (weight <= 0) continue;

          // Recover exact lattice moments directly from active coarse distribution buffer
          let rho = 0.0;
          let jx = 0.0;
          let jy = 0.0;
          let jz = 0.0;
          for (let q = 0; q < 19; q++) {
            const fq = coarseF[q * cTotal + cIdx]!;
            rho += fq;
            jx += CX[q]! * fq;
            jy += CY[q]! * fq;
            jz += CZ[q]! * fq;
          }
          const invRho = 1.0 / Math.max(1e-6, rho);
          const ux = jx * invRho;
          const uy = jy * invRho;
          const uz = jz * invRho;
          const uSq = ux * ux + uy * uy + uz * uz;

          wSum += weight;
          rhoAcc += weight * rho;
          uxAcc += weight * ux;
          uyAcc += weight * uy;
          uzAcc += weight * uz;

          for (let q = 0; q < 19; q++) {
            const feq = computeFeq(q, rho, ux, uy, uz, uSq);
            const fneq = coarseF[q * cTotal + cIdx]! - feq;
            outFneq[q] = outFneq[q]! + weight * fneq;
          }
        }
      }
    }

    if (wSum > 1e-12) {
      const invW = 1.0 / wSum;
      for (let q = 0; q < 19; q++) {
        outFneq[q] = outFneq[q]! * invW;
      }
      return {
        rho: rhoAcc * invW,
        ux: uxAcc * invW,
        uy: uyAcc * invW,
        uz: uzAcc * invW,
      };
    }

    return { rho: 1.0, ux: 0.0, uy: 0.0, uz: 0.0 };
  }

  /**
   * Coarse-to-fine explosion (prolongation):
   * Trilinearly interpolates macroscopic (rho, u) and non-equilibrium populations
   * from the coarse grid onto the fine patch boundary ghost layer (or entire patch if `fillInterior`),
   * applying acoustic non-equilibrium rescaling:
   *   f^neq_f = (tau_f / (2 * tau_c)) * f^neq_c
   *   f_f = f^eq(rho_f, u_f) + f^neq_f
   */
  public explodeCoarseToFine(patch: OctreeRefinedPatch, fillInterior: boolean = false): void {
    const coarseF = getActiveF(this.coarseRunner);
    const fineF = getActiveF(patch.runner);
    const [x0, y0, z0] = patch.coarseOrigin;
    const [fnx, fny, fnz] = patch.fineSize;
    const fTotal = fnx * fny * fnz;
    const fTypes = patch.runner.cellTypes;

    const neqScale = this.fineTau / (2.0 * this.coarseTau);
    const latToPhys = patch.config.dx / patch.config.dt;
    const fneqTmp = new Float64Array(19);

    for (let fz = 0; fz < fnz; fz++) {
      const isGhostZ = fz === 0 || fz === fnz - 1;
      const cz = z0 + 0.5 * (fz - 1) - 0.25;

      for (let fy = 0; fy < fny; fy++) {
        const isGhostY = fy === 0 || fy === fny - 1;
        const cy = y0 + 0.5 * (fy - 1) - 0.25;

        for (let fx = 0; fx < fnx; fx++) {
          const isGhostX = fx === 0 || fx === fnx - 1;
          if (!fillInterior && !isGhostX && !isGhostY && !isGhostZ) {
            continue;
          }

          const fIdx = fx + fy * fnx + fz * fnx * fny;
          const ft = fTypes[fIdx];
          if (ft === LbmCellType.ObstacleSolid || ft === LbmCellType.ChannelWall) {
            continue;
          }

          const cx = x0 + 0.5 * (fx - 1) - 0.25;
          const { rho, ux, uy, uz } = this.sampleCoarseTrilinear(cx, cy, cz, coarseF, fneqTmp);
          const uSq = ux * ux + uy * uy + uz * uz;

          for (let q = 0; q < 19; q++) {
            const feq = computeFeq(q, rho, ux, uy, uz, uSq);
            fineF[q * fTotal + fIdx] = feq + neqScale * fneqTmp[q]!;
          }

          patch.runner.rho[fIdx] = rho;
          patch.runner.vx[fIdx] = ux * latToPhys;
          patch.runner.vy[fIdx] = uy * latToPhys;
          patch.runner.vz[fIdx] = uz * latToPhys;
        }
      }
    }

    invalidateWasmCache();
  }

  /**
   * Fine-to-coarse coalescence (conservative restriction):
   * Volume-averages each 2x2x2 block of interior fine fluid cells back onto its parent
   * coarse cell, preserving mass (rho_c) and momentum (rho_c * u_c), and applies inverse
   * acoustic non-equilibrium rescaling:
   *   f^neq_c = (2 * tau_c / tau_f) * <f^neq_f>_{2x2x2}
   *   f_c = f^eq(rho_c, u_c) + f^neq_c
   */
  public coalesceFineToCoarse(patch: OctreeRefinedPatch): void {
    const coarseF = getActiveF(this.coarseRunner);
    const fineF = getActiveF(patch.runner);
    const { nx, ny, nz, dx, dt } = this.coarseConfig;
    const cTotal = nx * ny * nz;
    const cTypes = this.coarseRunner.cellTypes;

    const [x0, y0, z0] = patch.coarseOrigin;
    const [cxCount, cyCount, czCount] = patch.coarseSize;
    const [fnx, fny, fnz] = patch.fineSize;
    const fTotal = fnx * fny * fnz;
    const fTypes = patch.runner.cellTypes;

    const invNeqScale = (2.0 * this.coarseTau) / this.fineTau;
    const latToPhys = dx / dt;
    const fneqSum = new Float64Array(19);

    for (let lz = 0; lz < czCount; lz++) {
      const gz = z0 + lz;
      const fzBase = 1 + lz * 2;
      for (let ly = 0; ly < cyCount; ly++) {
        const gy = y0 + ly;
        const fyBase = 1 + ly * 2;
        for (let lx = 0; lx < cxCount; lx++) {
          const gx = x0 + lx;
          const fxBase = 1 + lx * 2;
          const cIdx = gx + gy * nx + gz * nx * ny;
          const ct = cTypes[cIdx];
          if (ct === LbmCellType.ObstacleSolid || ct === LbmCellType.ChannelWall) {
            continue;
          }

          let fluidCount = 0;
          let rhoSum = 0.0;
          let jxSum = 0.0;
          let jySum = 0.0;
          let jzSum = 0.0;
          fneqSum.fill(0.0);

          for (let dz = 0; dz < 2; dz++) {
            const fz = fzBase + dz;
            for (let dy = 0; dy < 2; dy++) {
              const fy = fyBase + dy;
              for (let dxIdx = 0; dxIdx < 2; dxIdx++) {
                const fx = fxBase + dxIdx;
                const fIdx = fx + fy * fnx + fz * fnx * fny;
                const ft = fTypes[fIdx];
                if (ft === LbmCellType.ObstacleSolid || ft === LbmCellType.ChannelWall) {
                  continue;
                }

                let fRho = 0.0;
                let fJx = 0.0;
                let fJy = 0.0;
                let fJz = 0.0;
                for (let q = 0; q < 19; q++) {
                  const fq = fineF[q * fTotal + fIdx]!;
                  fRho += fq;
                  fJx += CX[q]! * fq;
                  fJy += CY[q]! * fq;
                  fJz += CZ[q]! * fq;
                }
                const invFRho = 1.0 / Math.max(1e-6, fRho);
                const fUx = fJx * invFRho;
                const fUy = fJy * invFRho;
                const fUz = fJz * invFRho;
                const fUSq = fUx * fUx + fUy * fUy + fUz * fUz;

                fluidCount++;
                rhoSum += fRho;
                jxSum += fJx;
                jySum += fJy;
                jzSum += fJz;

                for (let q = 0; q < 19; q++) {
                  const feq = computeFeq(q, fRho, fUx, fUy, fUz, fUSq);
                  fneqSum[q] = fneqSum[q]! + (fineF[q * fTotal + fIdx]! - feq);
                }
              }
            }
          }

          if (fluidCount === 0) continue;

          const invN = 1.0 / fluidCount;
          const rhoC = rhoSum * invN;
          const invMassSum = 1.0 / Math.max(1e-6, rhoSum);
          const uxC = jxSum * invMassSum;
          const uyC = jySum * invMassSum;
          const uzC = jzSum * invMassSum;
          const uSqC = uxC * uxC + uyC * uyC + uzC * uzC;

          for (let q = 0; q < 19; q++) {
            const feqC = computeFeq(q, rhoC, uxC, uyC, uzC, uSqC);
            coarseF[q * cTotal + cIdx] = feqC + invNeqScale * (fneqSum[q]! * invN);
          }

          this.coarseRunner.rho[cIdx] = rhoC;
          this.coarseRunner.vx[cIdx] = uxC * latToPhys;
          this.coarseRunner.vy[cIdx] = uyC * latToPhys;
          this.coarseRunner.vz[cIdx] = uzC * latToPhys;
        }
      }
    }

    invalidateWasmCache();
  }

  /**
   * Computes total physical fluid mass (kg) across the composite 2-level octree grid
   * directly from the active post-streaming D3Q19 distribution buffers:
   * uncovered coarse fluid cells (volume dx_c^3) + fine interior fluid cells (volume dx_f^3 = dx_c^3 / 8).
   */
  public computeTotalMass(): number {
    const { nx, ny, nz, dx, density } = this.coarseConfig;
    const coarseVol = dx * dx * dx;
    const fineVol = coarseVol * 0.125;
    const cTypes = this.coarseRunner.cellTypes;
    const cTotal = nx * ny * nz;
    const coarseF = getActiveF(this.coarseRunner);

    let mass = 0.0;
    for (let i = 0; i < cTotal; i++) {
      if (this.coveredCoarseMask[i] !== 0) continue;
      const ct = cTypes[i];
      if (ct === LbmCellType.ObstacleSolid || ct === LbmCellType.ChannelWall) continue;
      let rho = 0.0;
      for (let q = 0; q < 19; q++) {
        rho += coarseF[q * cTotal + i]!;
      }
      mass += rho * density * coarseVol;
    }

    for (const patch of this.patches) {
      const [fnx, fny, fnz] = patch.fineSize;
      const fTotal = fnx * fny * fnz;
      const fTypes = patch.runner.cellTypes;
      const fineF = getActiveF(patch.runner);
      for (let fz = 1; fz < fnz - 1; fz++) {
        for (let fy = 1; fy < fny - 1; fy++) {
          for (let fx = 1; fx < fnx - 1; fx++) {
            const fIdx = fx + fy * fnx + fz * fnx * fny;
            const ft = fTypes[fIdx];
            if (ft === LbmCellType.ObstacleSolid || ft === LbmCellType.ChannelWall) continue;
            let rho = 0.0;
            for (let q = 0; q < 19; q++) {
              rho += fineF[q * fTotal + fIdx]!;
            }
            mass += rho * density * fineVol;
          }
        }
      }
    }

    return mass;
  }

  /**
   * Advances the 2-level octree LBM simulation by `numCoarseSteps` coarse steps
   * (= `2 * numCoarseSteps` acoustic-scaled fine sub-steps).
   */
  public step(numCoarseSteps: number = 1): OctreeLbmStepResult {
    let lastCoarseResult: LbmStepResult = {
      aerodynamicForceN: [0, 0, 0],
      maxVelocity: 0,
      pressureDropPa: 0,
    };
    const lastPatchResults: LbmStepResult[] = new Array(this.patches.length);

    for (let s = 0; s < numCoarseSteps; s++) {
      // 1. Coarse-to-fine explosion for fine sub-step 1
      for (const patch of this.patches) {
        this.explodeCoarseToFine(patch, false);
      }

      // 2. Fine sub-step 1 (t -> t + dt_c / 2)
      for (let p = 0; p < this.patches.length; p++) {
        this.patches[p]!.runner.step(1);
      }

      // 3. Coarse step (t -> t + dt_c)
      lastCoarseResult = this.coarseRunner.step(1);

      // 4. Coarse-to-fine explosion for fine sub-step 2
      for (const patch of this.patches) {
        this.explodeCoarseToFine(patch, false);
      }

      // 5. Fine sub-step 2 (t + dt_c / 2 -> t + dt_c)
      for (let p = 0; p < this.patches.length; p++) {
        lastPatchResults[p] = this.patches[p]!.runner.step(1);
      }

      // 6. Conservative fine-to-coarse coalescence back onto coarse grid
      for (const patch of this.patches) {
        this.coalesceFineToCoarse(patch);
      }

      this.totalCoarseSteps++;
    }

    // Combine aerodynamic forces without double-counting obstacles covered by fine patches
    let fx = 0.0;
    let fy = 0.0;
    let fz = 0.0;
    let anyFineObstacle = false;
    let maxVel = lastCoarseResult.maxVelocity;

    for (let p = 0; p < this.patches.length; p++) {
      const pr = lastPatchResults[p];
      if (!pr) continue;
      if (pr.maxVelocity > maxVel) maxVel = pr.maxVelocity;
      if (this.patches[p]!.hasObstacleCells) {
        anyFineObstacle = true;
        fx += pr.aerodynamicForceN[0];
        fy += pr.aerodynamicForceN[1];
        fz += pr.aerodynamicForceN[2];
      }
    }

    if (!anyFineObstacle || this.hasUncoveredObstacleCells) {
      fx += lastCoarseResult.aerodynamicForceN[0];
      fy += lastCoarseResult.aerodynamicForceN[1];
      fz += lastCoarseResult.aerodynamicForceN[2];
    }

    const totalMass = this.computeTotalMass();
    const massConservationError =
      this.initialMass > 0 ? Math.abs(totalMass - this.initialMass) / this.initialMass : 0.0;

    return {
      aerodynamicForceN: [fx, fy, fz],
      maxVelocity: maxVel,
      pressureDropPa: lastCoarseResult.pressureDropPa,
      coarseSteps: numCoarseSteps,
      fineSteps: numCoarseSteps * 2,
      coarseViscosity: this.coarseViscosity,
      fineViscosity: this.fineViscosity,
      coarseTau: this.coarseTau,
      fineTau: this.fineTau,
      activeCellCount: this.activeCellCount,
      equivalentUniformFineCells: this.equivalentUniformFineCells,
      compressionRatio: this.compressionRatio,
      totalMass,
      massConservationError,
      patchCount: this.patches.length,
    };
  }

  /**
   * Returns total coarse steps executed since construction.
   */
  public getTotalCoarseSteps(): number {
    return this.totalCoarseSteps;
  }

  /**
   * Releases GPU resources for the coarse runner and all refined patch runners.
   */
  public destroy(): void {
    this.coarseRunner.destroy();
    for (const patch of this.patches) {
      patch.runner.destroy();
    }
  }
}
