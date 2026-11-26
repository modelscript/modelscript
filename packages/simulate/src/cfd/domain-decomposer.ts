// SPDX-License-Identifier: AGPL-3.0-or-later

import { getDefaultWasmExports } from "@modelscript/runtime";
import fs from "node:fs";
import path from "node:path";
import { CfdFieldArena, D3Q19_CX as CX, D3Q19_CY as CY, D3Q19_CZ as CZ } from "./cfd-arena.js";
import { LbmCellType, type LbmGridConfig, type LbmStepResult } from "./lbm-types.js";
import { WebGPULbmRunner } from "./webgpu-lbm-runner.js";

// WASM kernel (packages/runtime/src/wasm/cfd/wasm_lbm.ts) diagonal velocity indexing
const WASM_CY = new Int32Array([0, 0, 0, 1, -1, 0, 0, 1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1]);
const WASM_CZ = new Int32Array([0, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0, 1, 1, -1, -1, 1, 1, -1, -1]);

export type FaceAxis = "xm" | "xp" | "ym" | "yp" | "zm" | "zp";

/**
 * The 5 D3Q19 discrete velocity directions crossing each Cartesian face.
 * Transferring only these 5 populations instead of all 19 reduces halo bandwidth by ~74%.
 */
export const FACE_OUTGOING_DIRS: Record<FaceAxis, readonly number[]> = {
  xp: [1, 7, 9, 11, 13], // cx = +1
  xm: [2, 8, 10, 12, 14], // cx = -1
  yp: [3, 7, 10, 15, 17], // cy = +1
  ym: [4, 8, 9, 16, 18], // cy = -1
  zp: [5, 11, 14, 15, 18], // cz = +1
  zm: [6, 12, 13, 16, 17], // cz = -1
};

export const OPPOSITE_FACE: Record<FaceAxis, FaceAxis> = {
  xm: "xp",
  xp: "xm",
  ym: "yp",
  yp: "ym",
  zm: "zp",
  zp: "zm",
};

export interface SubdomainPartition {
  rank: number;
  coords: [number, number, number];
  /** Starting global cell index of interior region [x0, y0, z0]. */
  globalOrigin: [number, number, number];
  /** Interior cell dimensions [ix, iy, iz] (excluding ghost layers). */
  interiorSize: [number, number, number];
  /** Local padded grid dimensions [px, py, pz] (including 1-cell ghost layers on internal faces). */
  paddedSize: [number, number, number];
  /** Ghost layer thickness (0 or 1) on each side. */
  ghost: { xm: number; xp: number; ym: number; yp: number; zm: number; zp: number };
  /** Neighbor rank ID on each face (-1 if global domain boundary). */
  neighbors: Record<FaceAxis, number>;
}

/**
 * Transport-agnostic halo exchange interface supporting shared-memory multi-worker
 * execution or MPI/Slurm cluster IPC.
 */
export interface HaloExchangeTransport {
  sendFace(srcRank: number, dstRank: number, face: FaceAxis, payload: Float32Array): void;
  recvFace(rank: number, fromFace: FaceAxis): Float32Array | undefined;
  clear(): void;
}

/**
 * Zero-copy / SharedArrayBuffer-friendly in-process halo transport for multi-worker or
 * multi-GPU workstation execution.
 */
export class SharedMemoryHaloTransport implements HaloExchangeTransport {
  private readonly mailboxes = new Map<string, Float32Array>();

  public sendFace(_srcRank: number, dstRank: number, face: FaceAxis, payload: Float32Array): void {
    const key = `${dstRank}:${OPPOSITE_FACE[face]}`;
    this.mailboxes.set(key, payload);
  }

  public recvFace(rank: number, fromFace: FaceAxis): Float32Array | undefined {
    return this.mailboxes.get(`${rank}:${fromFace}`);
  }

  public clear(): void {
    this.mailboxes.clear();
  }
}

/**
 * Shared-filesystem / Slurm IPC halo transport backed by binary face-buffer files.
 * Suitable for multi-node cluster rank exchange over Lustre/GPFS/NFS or local tmpfs.
 */
export class IpcSlurmHaloTransport implements HaloExchangeTransport {
  public readonly exchangeDir: string;

  constructor(exchangeDir: string) {
    this.exchangeDir = exchangeDir;
    fs.mkdirSync(this.exchangeDir, { recursive: true });
  }

  private faceFilePath(rank: number, face: FaceAxis): string {
    return path.join(this.exchangeDir, `halo_r${rank}_${face}.bin`);
  }

  public sendFace(_srcRank: number, dstRank: number, face: FaceAxis, payload: Float32Array): void {
    const filePath = this.faceFilePath(dstRank, OPPOSITE_FACE[face]);
    const bytes = new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
    fs.writeFileSync(filePath, bytes);
  }

  public recvFace(rank: number, fromFace: FaceAxis): Float32Array | undefined {
    const filePath = this.faceFilePath(rank, fromFace);
    if (!fs.existsSync(filePath)) {
      return undefined;
    }
    const buf = fs.readFileSync(filePath);
    const out = new Float32Array(buf.byteLength / 4);
    new Uint8Array(out.buffer).set(buf);
    return out;
  }

  public clear(): void {
    if (!fs.existsSync(this.exchangeDir)) {
      return;
    }
    for (const entry of fs.readdirSync(this.exchangeDir)) {
      if (entry.startsWith("halo_r") && entry.endsWith(".bin")) {
        fs.rmSync(path.join(this.exchangeDir, entry), { force: true });
      }
    }
  }
}

/**
 * WGSL compute shader snippet for GPU-side 5-population halo packing along +/-X faces.
 */
export const LBM_HALO_PACK_WGSL = /* wgsl */ `
struct HaloUniforms {
  nx: u32,
  ny: u32,
  nz: u32,
  totalCells: u32,
  sliceX: u32,
  dir0: u32,
  dir1: u32,
  dir2: u32,
  dir3: u32,
  dir4: u32,
};

@group(0) @binding(0) var<uniform> hu: HaloUniforms;
@group(0) @binding(1) var<storage, read> fBuf: array<f32>;
@group(0) @binding(2) var<storage, read_write> haloOut: array<f32>;

@compute @workgroup_size(8, 8, 1)
fn cs_pack_halo_x(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= hu.ny || gid.y >= hu.nz) { return; }
  let y = gid.x;
  let z = gid.y;
  let cellIdx = hu.sliceX + y * hu.nx + z * hu.nx * hu.ny;
  let base = (y + z * hu.ny) * 5u;
  haloOut[base + 0u] = fBuf[hu.dir0 * hu.totalCells + cellIdx];
  haloOut[base + 1u] = fBuf[hu.dir1 * hu.totalCells + cellIdx];
  haloOut[base + 2u] = fBuf[hu.dir2 * hu.totalCells + cellIdx];
  haloOut[base + 3u] = fBuf[hu.dir3 * hu.totalCells + cellIdx];
  haloOut[base + 4u] = fBuf[hu.dir4 * hu.totalCells + cellIdx];
}
`;

/**
 * Cartesian 1D/2D/3D domain decomposer with 1-cell ghost layers on internal boundaries.
 */
export class CartesianDomainDecomposer {
  public static decompose(
    nx: number,
    ny: number,
    nz: number,
    px: number,
    py: number = 1,
    pz: number = 1,
  ): SubdomainPartition[] {
    const splitAxis = (n: number, p: number): Array<[number, number]> => {
      const base = Math.floor(n / p);
      const rem = n % p;
      const res: Array<[number, number]> = [];
      let start = 0;
      for (let i = 0; i < p; i++) {
        const len = base + (i < rem ? 1 : 0);
        res.push([start, len]);
        start += len;
      }
      return res;
    };

    const xSplits = splitAxis(nx, px);
    const ySplits = splitAxis(ny, py);
    const zSplits = splitAxis(nz, pz);

    const rankOf = (rx: number, ry: number, rz: number): number => {
      if (rx < 0 || rx >= px || ry < 0 || ry >= py || rz < 0 || rz >= pz) return -1;
      return rx + ry * px + rz * px * py;
    };

    const partitions: SubdomainPartition[] = [];
    for (let rz = 0; rz < pz; rz++) {
      for (let ry = 0; ry < py; ry++) {
        for (let rx = 0; rx < px; rx++) {
          const rank = rankOf(rx, ry, rz);
          const [x0, ix] = xSplits[rx]!;
          const [y0, iy] = ySplits[ry]!;
          const [z0, iz] = zSplits[rz]!;

          const neighbors: Record<FaceAxis, number> = {
            xm: rankOf(rx - 1, ry, rz),
            xp: rankOf(rx + 1, ry, rz),
            ym: rankOf(rx, ry - 1, rz),
            yp: rankOf(rx, ry + 1, rz),
            zm: rankOf(rx, ry, rz - 1),
            zp: rankOf(rx, ry, rz + 1),
          };

          const ghost = {
            xm: neighbors.xm >= 0 ? 1 : 0,
            xp: neighbors.xp >= 0 ? 1 : 0,
            ym: neighbors.ym >= 0 ? 1 : 0,
            yp: neighbors.yp >= 0 ? 1 : 0,
            zm: neighbors.zm >= 0 ? 1 : 0,
            zp: neighbors.zp >= 0 ? 1 : 0,
          };

          partitions.push({
            rank,
            coords: [rx, ry, rz],
            globalOrigin: [x0, y0, z0],
            interiorSize: [ix, iy, iz],
            paddedSize: [ix + ghost.xm + ghost.xp, iy + ghost.ym + ghost.yp, iz + ghost.zm + ghost.zp],
            ghost,
            neighbors,
          });
        }
      }
    }
    return partitions;
  }
}

export interface DistributedLbmOptions {
  /**
   * When true on 1D X-slab decompositions (py === 1 && pz === 1), packs and exchanges
   * only the 5 outgoing D3Q19 populations per face from FACE_OUTGOING_DIRS (~74% bandwidth reduction).
   * Automatically falls back to sequential 19-pop sweeps on 2D/3D decompositions for corner propagation.
   */
  compactFivePop?: boolean;
}

/**
 * Distributed / Multi-Subdomain D3Q19 Lattice Boltzmann Runner.
 * Partitions a global LBM grid into Cartesian subdomains with 1-cell ghost layers,
 * executes per-subdomain collision/streaming, exchanges ghost halos across faces,
 * and reduces global aerodynamic forces and flow statistics across all ranks.
 */
export class DistributedLbmRunner {
  public readonly globalConfig: LbmGridConfig;
  public readonly gridTopology: [number, number, number];
  public readonly partitions: SubdomainPartition[];
  public readonly runners: WebGPULbmRunner[];
  public readonly transport: HaloExchangeTransport;
  public readonly compactFivePop: boolean;
  private readonly globalCellTypes: Uint8Array | Uint32Array;
  private lastHaloBytesTransferred: number = 0;

  constructor(
    globalConfig: LbmGridConfig,
    globalCellTypes: Uint8Array | Uint32Array,
    gridTopology: [number, number, number] = [2, 1, 1],
    transport?: HaloExchangeTransport,
    options?: DistributedLbmOptions,
  ) {
    this.globalConfig = globalConfig;
    this.gridTopology = [gridTopology[0], gridTopology[1], gridTopology[2]];
    this.globalCellTypes = globalCellTypes;
    this.transport = transport ?? new SharedMemoryHaloTransport();
    this.compactFivePop = options?.compactFivePop ?? false;
    this.partitions = CartesianDomainDecomposer.decompose(
      globalConfig.nx,
      globalConfig.ny,
      globalConfig.nz,
      gridTopology[0],
      gridTopology[1],
      gridTopology[2],
    );

    this.runners = this.partitions.map((part) => {
      const [lnx, lny, lnz] = part.paddedSize;
      const localTypes = new Uint8Array(lnx * lny * lnz);
      const localDelta = globalConfig.deltaWall ? new Float32Array(lnx * lny * lnz * 19) : undefined;
      if (localDelta) localDelta.fill(0.5);

      const gNx = globalConfig.nx;
      const gNy = globalConfig.ny;
      const gTotal = gNx * gNy * globalConfig.nz;
      const lTotal = lnx * lny * lnz;

      for (let lz = 0; lz < lnz; lz++) {
        const gz = part.globalOrigin[2] - part.ghost.zm + lz;
        for (let ly = 0; ly < lny; ly++) {
          const gy = part.globalOrigin[1] - part.ghost.ym + ly;
          for (let lx = 0; lx < lnx; lx++) {
            const gx = part.globalOrigin[0] - part.ghost.xm + lx;
            const lIdx = lx + ly * lnx + lz * lnx * lny;
            const gIdx = gx + gy * gNx + gz * gNx * gNy;
            localTypes[lIdx] = globalCellTypes[gIdx]!;
            if (localDelta && globalConfig.deltaWall) {
              for (let q = 0; q < 19; q++) {
                localDelta[q * lTotal + lIdx] = globalConfig.deltaWall[q * gTotal + gIdx]!;
              }
            }
          }
        }
      }

      const localCfg: LbmGridConfig = {
        ...globalConfig,
        nx: lnx,
        ny: lny,
        nz: lnz,
        ...(localDelta ? { deltaWall: localDelta } : {}),
      };
      const arena = new CfdFieldArena(localCfg, localTypes, { scheme: "two-buffer" });
      return new WebGPULbmRunner(localCfg, localTypes, arena);
    });
  }

  /** Returns total payload bytes transferred during the most recent exchangeHalos() call. */
  public getLastHaloBytesTransferred(): number {
    return this.lastHaloBytesTransferred;
  }

  private is1DXSlab(): boolean {
    return this.gridTopology[1] === 1 && this.gridTopology[2] === 1;
  }

  /**
   * Exchanges ghost-layer populations between neighboring subdomains.
   * - When `compactFivePop` is enabled on a 1D X-slab decomposition (`py === 1 && pz === 1`),
   *   packs ONLY the 5 outgoing D3Q19 post-streaming populations from `FACE_OUTGOING_DIRS`
   *   (~74% bandwidth reduction vs 19 populations).
   * - Otherwise uses sequential X -> Y -> Z 19-population sweeps to propagate diagonal edge
   *   and corner ghost cells required by the D3Q19 stencil without separate corner messages.
   */
  public exchangeHalos(compactFivePop?: boolean): void {
    const getActiveF = (runner: WebGPULbmRunner): Float32Array => {
      const ping = (runner as unknown as { currentPing: boolean }).currentPing;
      return ping ? runner.arena.f0 : (runner.arena.f1 ?? runner.arena.f0);
    };

    this.lastHaloBytesTransferred = 0;
    const useCompact = (compactFivePop ?? this.compactFivePop) && this.is1DXSlab();

    if (useCompact) {
      this.transport.clear();
      const xFaces: readonly [FaceAxis, FaceAxis] = ["xm", "xp"];

      // 1. Pack & send the 5 outgoing post-streaming populations from each rank's X ghost slice
      for (const part of this.partitions) {
        const runner = this.runners[part.rank]!;
        const f = getActiveF(runner);
        const [lnx, lny, lnz] = part.paddedSize;
        const lTotal = lnx * lny * lnz;

        for (const face of xFaces) {
          const nbr = part.neighbors[face];
          if (nbr < 0) continue;

          const dirs = FACE_OUTGOING_DIRS[face];
          const gx = face === "xm" ? 0 : lnx - 1;
          const payload = new Float32Array(lny * lnz * 5);
          let p = 0;
          for (let z = 0; z < lnz; z++) {
            for (let y = 0; y < lny; y++) {
              const idx = gx + y * lnx + z * lnx * lny;
              for (let d = 0; d < 5; d++) {
                payload[p++] = f[dirs[d]! * lTotal + idx]!;
              }
            }
          }
          this.lastHaloBytesTransferred += payload.byteLength;
          this.transport.sendFace(part.rank, nbr, face, payload);
        }
      }

      // 2. Unpack received 5-population payloads into the receiving rank's interior boundary slice
      const turbModel = this.globalConfig.turbulenceModel ?? "laminar";
      const hasAdvancedPhysics =
        turbModel === "dynamic_smagorinsky" ||
        turbModel === "wmles" ||
        this.globalConfig.collisionOperator === "regularized" ||
        this.globalConfig.thermal?.enabled === true;
      const wasmExports = getDefaultWasmExports() as { lbm_d3q19_step_f32?: unknown } | null | undefined;
      const wasmKernelAvailable = !hasAdvancedPhysics && typeof wasmExports?.lbm_d3q19_step_f32 === "function";

      for (const part of this.partitions) {
        const runner = this.runners[part.rank]!;
        const f = getActiveF(runner);
        const [lnx, lny, lnz] = part.paddedSize;
        const lTotal = lnx * lny * lnz;
        const usesWasm =
          wasmKernelAvailable &&
          runner.movingWallVelocity[0] === 0 &&
          runner.movingWallVelocity[1] === 0 &&
          runner.movingWallVelocity[2] === 0;
        const cyEff = usesWasm ? WASM_CY : CY;
        const czEff = usesWasm ? WASM_CZ : CZ;

        for (const face of xFaces) {
          const payload = this.transport.recvFace(part.rank, face);
          if (!payload) continue;

          const dirs = FACE_OUTGOING_DIRS[OPPOSITE_FACE[face]];
          const ix = face === "xm" ? part.ghost.xm : part.ghost.xm + part.interiorSize[0] - 1;
          let p = 0;
          for (let z = 0; z < lnz; z++) {
            for (let y = 0; y < lny; y++) {
              const idx = ix + y * lnx + z * lnx * lny;
              const dstType = runner.cellTypes[idx];
              const dstIsFluid = dstType !== LbmCellType.ObstacleSolid && dstType !== LbmCellType.ChannelWall;
              for (let d = 0; d < 5; d++) {
                const val = payload[p++]!;
                if (!dstIsFluid) continue;
                const q = dirs[d]!;
                const sx = ix - CX[q]!;
                const sy = y - cyEff[q]!;
                const sz = z - czEff[q]!;
                if (sx >= 0 && sx < lnx && sy >= 0 && sy < lny && sz >= 0 && sz < lnz) {
                  const srcType = runner.cellTypes[sx + sy * lnx + sz * lnx * lny];
                  if (srcType !== LbmCellType.ObstacleSolid && srcType !== LbmCellType.ChannelWall) {
                    f[q * lTotal + idx] = val;
                  }
                }
              }
            }
          }
        }
      }
      return;
    }

    const axisSweeps: Array<[FaceAxis, FaceAxis]> = [
      ["xm", "xp"],
      ["ym", "yp"],
      ["zm", "zp"],
    ];

    for (const facePair of axisSweeps) {
      this.transport.clear();

      // 1. Pack & send interior boundary slices along current axis
      for (const part of this.partitions) {
        const runner = this.runners[part.rank]!;
        const f = getActiveF(runner);
        const [lnx, lny, lnz] = part.paddedSize;
        const lTotal = lnx * lny * lnz;

        for (const face of facePair) {
          const nbr = part.neighbors[face];
          if (nbr < 0) continue;

          if (face === "xm" || face === "xp") {
            const sx = face === "xm" ? part.ghost.xm : part.ghost.xm + part.interiorSize[0] - 1;
            const payload = new Float32Array(lny * lnz * 19);
            let p = 0;
            for (let z = 0; z < lnz; z++) {
              for (let y = 0; y < lny; y++) {
                const idx = sx + y * lnx + z * lnx * lny;
                for (let q = 0; q < 19; q++) {
                  payload[p++] = f[q * lTotal + idx]!;
                }
              }
            }
            this.lastHaloBytesTransferred += payload.byteLength;
            this.transport.sendFace(part.rank, nbr, face, payload);
          } else if (face === "ym" || face === "yp") {
            const sy = face === "ym" ? part.ghost.ym : part.ghost.ym + part.interiorSize[1] - 1;
            const payload = new Float32Array(lnx * lnz * 19);
            let p = 0;
            for (let z = 0; z < lnz; z++) {
              for (let x = 0; x < lnx; x++) {
                const idx = x + sy * lnx + z * lnx * lny;
                for (let q = 0; q < 19; q++) {
                  payload[p++] = f[q * lTotal + idx]!;
                }
              }
            }
            this.lastHaloBytesTransferred += payload.byteLength;
            this.transport.sendFace(part.rank, nbr, face, payload);
          } else {
            const sz = face === "zm" ? part.ghost.zm : part.ghost.zm + part.interiorSize[2] - 1;
            const payload = new Float32Array(lnx * lny * 19);
            let p = 0;
            for (let y = 0; y < lny; y++) {
              for (let x = 0; x < lnx; x++) {
                const idx = x + y * lnx + sz * lnx * lny;
                for (let q = 0; q < 19; q++) {
                  payload[p++] = f[q * lTotal + idx]!;
                }
              }
            }
            this.lastHaloBytesTransferred += payload.byteLength;
            this.transport.sendFace(part.rank, nbr, face, payload);
          }
        }
      }

      // 2. Unpack received payloads into ghost layer before next axis sweep
      for (const part of this.partitions) {
        const runner = this.runners[part.rank]!;
        const f = getActiveF(runner);
        const [lnx, lny, lnz] = part.paddedSize;
        const lTotal = lnx * lny * lnz;

        for (const face of facePair) {
          const payload = this.transport.recvFace(part.rank, face);
          if (!payload) continue;

          if (face === "xm" || face === "xp") {
            const gx = face === "xm" ? 0 : lnx - 1;
            let p = 0;
            for (let z = 0; z < lnz; z++) {
              for (let y = 0; y < lny; y++) {
                const idx = gx + y * lnx + z * lnx * lny;
                for (let q = 0; q < 19; q++) {
                  f[q * lTotal + idx] = payload[p++]!;
                }
              }
            }
          } else if (face === "ym" || face === "yp") {
            const gy = face === "ym" ? 0 : lny - 1;
            let p = 0;
            for (let z = 0; z < lnz; z++) {
              for (let x = 0; x < lnx; x++) {
                const idx = x + gy * lnx + z * lnx * lny;
                for (let q = 0; q < 19; q++) {
                  f[q * lTotal + idx] = payload[p++]!;
                }
              }
            }
          } else {
            const gz = face === "zm" ? 0 : lnz - 1;
            let p = 0;
            for (let y = 0; y < lny; y++) {
              for (let x = 0; x < lnx; x++) {
                const idx = x + y * lnx + gz * lnx * lny;
                for (let q = 0; q < 19; q++) {
                  f[q * lTotal + idx] = payload[p++]!;
                }
              }
            }
          }
        }
      }
    }
  }

  /**
   * Advances all subdomains synchronously by numSteps, performing halo exchange each timestep
   * and reducing aerodynamic forces and velocity statistics across ranks.
   */
  public step(numSteps: number = 1): LbmStepResult {
    const useCompact = this.compactFivePop && this.is1DXSlab();

    for (let s = 0; s < numSteps; s++) {
      if (useCompact) {
        for (const runner of this.runners) {
          runner.step(1);
        }
        this.exchangeHalos(true);
      } else {
        this.exchangeHalos(false);
        for (const runner of this.runners) {
          runner.step(1);
        }
      }
    }

    return this.reduceGlobalResult();
  }

  /**
   * Advances all subdomains concurrently using Promise.all across async rank tasks
   * with synchronized halo exchange per timestep, then reduces global aerodynamic forces.
   */
  public async stepParallel(numSteps: number = 1): Promise<LbmStepResult> {
    const useCompact = this.compactFivePop && this.is1DXSlab();

    for (let s = 0; s < numSteps; s++) {
      if (useCompact) {
        await Promise.all(
          this.runners.map(
            (runner) =>
              new Promise<void>((resolve) => {
                runner.step(1);
                resolve();
              }),
          ),
        );
        this.exchangeHalos(true);
      } else {
        this.exchangeHalos(false);
        await Promise.all(
          this.runners.map(
            (runner) =>
              new Promise<void>((resolve) => {
                runner.step(1);
                resolve();
              }),
          ),
        );
      }
    }

    return this.reduceGlobalResult();
  }

  /**
   * Reduces interior-only aerodynamic forces and max velocity across all subdomain ranks
   * (avoiding double-counting ghost obstacle links).
   */
  private reduceGlobalResult(): LbmStepResult {
    let fxTotal = 0.0;
    let fyTotal = 0.0;
    let fzTotal = 0.0;
    let maxVelGlobal = 0.0;

    const { dx, dt, tau, density } = this.globalConfig;
    const omega0 = 1.0 / tau;
    const forceScale = density * (Math.pow(dx, 4) / Math.pow(dt, 2));

    for (const part of this.partitions) {
      const runner = this.runners[part.rank]!;
      const [lnx, lny, lnz] = part.paddedSize;
      const lTotal = lnx * lny * lnz;
      const ping = (runner as unknown as { currentPing: boolean }).currentPing;
      const src = ping ? runner.arena.f0 : (runner.arena.f1 ?? runner.arena.f0);

      for (let iz = 0; iz < part.interiorSize[2]; iz++) {
        const lz = part.ghost.zm + iz;
        for (let iy = 0; iy < part.interiorSize[1]; iy++) {
          const ly = part.ghost.ym + iy;
          for (let ix = 0; ix < part.interiorSize[0]; ix++) {
            const lx = part.ghost.xm + ix;
            const lIdx = lx + ly * lnx + lz * lnx * lny;
            const cType = runner.cellTypes[lIdx];
            if (cType === LbmCellType.ObstacleSolid || cType === LbmCellType.ChannelWall) continue;

            const vMag = Math.hypot(runner.vx[lIdx]!, runner.vy[lIdx]!, runner.vz[lIdx]!);
            if (vMag > maxVelGlobal) maxVelGlobal = vMag;

            const rho = runner.rho[lIdx]!;
            const ux = runner.vx[lIdx]! * (dt / dx);
            const uy = runner.vy[lIdx]! * (dt / dx);
            const uz = runner.vz[lIdx]! * (dt / dx);
            const uSq = ux * ux + uy * uy + uz * uz;

            for (let i = 1; i < 19; i++) {
              const nxCoord = lx + CX[i]!;
              const nyCoord = ly + CY[i]!;
              const nzCoord = lz + CZ[i]!;
              if (nxCoord < 0 || nxCoord >= lnx || nyCoord < 0 || nyCoord >= lny || nzCoord < 0 || nzCoord >= lnz) {
                continue;
              }
              const targetIdx = nxCoord + nyCoord * lnx + nzCoord * lnx * lny;
              if (runner.cellTypes[targetIdx] === LbmCellType.ObstacleSolid) {
                const fi = src[i * lTotal + lIdx]!;
                const cu = CX[i]! * ux + CY[i]! * uy + CZ[i]! * uz;
                const w = i <= 6 ? 1.0 / 18.0 : 1.0 / 36.0;
                const feq = w * rho * (1.0 + 3.0 * cu + 4.5 * cu * cu - 1.5 * uSq);
                const fOut = fi - omega0 * (fi - feq);
                const dP = 2.0 * fOut;
                fxTotal += dP * CX[i]! * forceScale;
                fyTotal += dP * CY[i]! * forceScale;
                fzTotal += dP * CZ[i]! * forceScale;
              }
            }
          }
        }
      }
    }

    const channelArea = Math.max(1e-12, this.globalConfig.ny * dx * (this.globalConfig.nz * dx));
    const inletV = this.globalConfig.inletVelocity ?? [1.0, 0, 0];
    const inMagPhys = Math.hypot(inletV[0], inletV[1], inletV[2]);
    const pDrop = fxTotal / channelArea + 0.5 * density * inletV[0] * inMagPhys;

    return {
      aerodynamicForceN: [fxTotal, fyTotal, fzTotal],
      maxVelocity: maxVelGlobal,
      pressureDropPa: pDrop,
    };
  }

  /**
   * Gathers the global velocity magnitude field [nx * ny * nz] from all subdomain interiors.
   */
  public gatherVelocityMagnitude(): Float32Array {
    const { nx, ny, nz } = this.globalConfig;
    const out = new Float32Array(nx * ny * nz);
    for (const part of this.partitions) {
      const runner = this.runners[part.rank]!;
      const [lnx, lny] = part.paddedSize;
      for (let iz = 0; iz < part.interiorSize[2]; iz++) {
        const lz = part.ghost.zm + iz;
        const gz = part.globalOrigin[2] + iz;
        for (let iy = 0; iy < part.interiorSize[1]; iy++) {
          const ly = part.ghost.ym + iy;
          const gy = part.globalOrigin[1] + iy;
          for (let ix = 0; ix < part.interiorSize[0]; ix++) {
            const lx = part.ghost.xm + ix;
            const gx = part.globalOrigin[0] + ix;
            const lIdx = lx + ly * lnx + lz * lnx * lny;
            const gIdx = gx + gy * nx + gz * nx * ny;
            out[gIdx] = Math.hypot(runner.vx[lIdx]!, runner.vy[lIdx]!, runner.vz[lIdx]!);
          }
        }
      }
    }
    return out;
  }

  /** Returns the global cell type grid reference. */
  public getGlobalCellTypes(): Uint8Array | Uint32Array {
    return this.globalCellTypes;
  }
}
