// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  LbmCellType,
  LbmVoxelizer,
  WebGPULbmRunner,
  type LbmGridConfig,
  type LbmStepResult,
} from "@modelscript/simulate";
import type { CosimValue } from "../coupling.js";
import type { ParticipantMetadata } from "../mqtt/protocol.js";
import type { CoSimParticipant } from "../participant.js";

/**
 * CFD LBM Mesh frame payload streamed over LSP / Co-Simulation.
 * Supports zero-copy TypedArrays (Float32Array / Uint32Array) to eliminate GC heap thrashing.
 */
export interface LbmMeshPayload {
  type: "cfd-mesh";
  participantId: string;
  time: number;
  geometry: {
    positions: Float32Array | number[];
    indices: Uint32Array | number[];
    normals?: Float32Array | number[];
  };
  fields: {
    "alpha.polymer": Float32Array | number[];
    temperature: Float32Array | number[];
    velocityMagnitude: Float32Array | number[];
    pressure: Float32Array | number[];
  };
  metadata: {
    dragForce: [number, number, number];
    maxVelocity: number;
    pressureDrop: number;
  };
}

export interface LbmCoSimOptions {
  /** Physical lattice dimensions and properties */
  config: LbmGridConfig;
  /** Obstacle definitions for the voxelizer */
  obstacles?: {
    boxes?: { min: [number, number, number]; max: [number, number, number] }[];
    cylinders?: { center: [number, number, number]; radius: number; axis: "x" | "y" | "z"; length: number }[];
    solidWalls?: { minX?: boolean; maxX?: boolean; minY?: boolean; maxY?: boolean; minZ?: boolean; maxZ?: boolean };
  };
  /** Pre-voxelized cellTypes (optional, overrides obstacles) */
  cellTypes?: Uint8Array;
}

/**
 * 3D Lattice Boltzmann CFD Co-Simulation Participant.
 * Steps the transient fluid domain and couples aerodynamic drag/lift forces
 * and flow fields back to 1D Modelica dynamics.
 */
export class LbmCoSimParticipant implements CoSimParticipant {
  public readonly id: string;
  public readonly modelName: string;
  public readonly metadata: ParticipantMetadata;

  private runner: WebGPULbmRunner;
  private currentTime = 0;
  private lastResult: LbmStepResult | null = null;
  private movingWallVel: [number, number, number] = [0, 0, 0];

  constructor(id: string, modelName: string, options: LbmCoSimOptions) {
    this.id = id;
    this.modelName = modelName;

    const cellTypes =
      options.cellTypes ??
      (options.obstacles
        ? LbmVoxelizer.voxelize(options.config, options.obstacles)
        : new Uint8Array(options.config.nx * options.config.ny * options.config.nz));

    this.runner = new WebGPULbmRunner(options.config, cellTypes);

    this.metadata = {
      participantId: id,
      modelName,
      type: "external",
      classKind: "field",
      timestamp: new Date().toISOString(),
      description: "3D Lattice Boltzmann CFD aerodynamics participant",
      variables: [
        {
          name: "velocity_x",
          type: "Real",
          causality: "input",
          start: 0,
          description: "Vehicle / moving wall velocity X (m/s)",
        },
        { name: "velocity_y", type: "Real", causality: "input", start: 0, description: "Moving wall velocity Y (m/s)" },
        { name: "velocity_z", type: "Real", causality: "input", start: 0, description: "Moving wall velocity Z (m/s)" },
        { name: "inlet_speed", type: "Real", causality: "input", start: 0, description: "Inflow speed (m/s)" },
        {
          name: "aerodynamic_drag",
          type: "Real",
          causality: "output",
          description: "Net aerodynamic drag force Fx (N)",
        },
        { name: "aerodynamic_side", type: "Real", causality: "output", description: "Net side force Fy (N)" },
        {
          name: "aerodynamic_lift",
          type: "Real",
          causality: "output",
          description: "Net aerodynamic lift force Fz (N)",
        },
        { name: "max_velocity", type: "Real", causality: "output", description: "Peak flow velocity in domain (m/s)" },
        { name: "pressure_drop", type: "Real", causality: "output", description: "Inlet-to-outlet pressure drop (Pa)" },
      ],
    };
  }

  public async initialize(startTime: number, stopTime: number, stepSize: number): Promise<void> {
    this.currentTime = startTime;
    this.lastResult = {
      aerodynamicForceN: [0, 0, 0],
      maxVelocity: 0,
      pressureDropPa: 0,
    };
  }

  public async doStep(currentTime: number, stepSize: number): Promise<void> {
    this.currentTime = currentTime + stepSize;

    // Determine how many LBM lattice sub-steps to perform for this communication interval
    const dt = this.runner.config.dt;
    const subSteps = Math.max(1, Math.min(50, Math.round(stepSize / dt)));

    this.runner.setMovingWallVelocity(this.movingWallVel);
    this.lastResult = this.runner.step(subSteps);
  }

  public async getOutputs(): Promise<Map<string, CosimValue>> {
    const outputs = new Map<string, CosimValue>();
    const forces = this.lastResult?.aerodynamicForceN ?? [0, 0, 0];

    outputs.set("aerodynamic_drag", forces[0]);
    outputs.set("aerodynamic_side", forces[1]);
    outputs.set("aerodynamic_lift", forces[2]);
    outputs.set("max_velocity", this.lastResult?.maxVelocity ?? 0);
    outputs.set("pressure_drop", this.lastResult?.pressureDropPa ?? 0);

    return outputs;
  }

  public async setInputs(values: Map<string, CosimValue>): Promise<void> {
    let vx = this.movingWallVel[0];
    let vy = this.movingWallVel[1];
    let vz = this.movingWallVel[2];

    for (const [key, val] of values.entries()) {
      const num = typeof val === "number" ? val : parseFloat(String(val));
      if (isNaN(num)) continue;

      const lower = key.toLowerCase();
      if (lower.includes("velocity_x") || lower === "vx" || lower.includes("speed")) vx = num;
      else if (lower.includes("velocity_y") || lower === "vy") vy = num;
      else if (lower.includes("velocity_z") || lower === "vz") vz = num;
    }

    this.movingWallVel = [vx, vy, vz];
  }

  public async terminate(): Promise<void> {
    // No-op for WASM/JS runner
  }

  /**
   * Synthesizes a surface/slice mesh of the flow field and obstacle for 3D visualization.
   */
  public getMeshPayload(): LbmMeshPayload {
    const { nx, ny, nz, dx } = this.runner.config;
    const positions: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];
    const velocityMag: number[] = [];
    const pressure: number[] = [];
    const alphaPolymer: number[] = [];
    const temperature: number[] = [];

    // 1. Extract 3D solid obstacle surface boundary triangles
    let vertIdx = 0;
    for (let iz = 0; iz < nz; iz++) {
      for (let iy = 0; iy < ny; iy++) {
        for (let ix = 0; ix < nx; ix++) {
          const idx = ix + iy * nx + iz * nx * ny;
          if (this.runner.cellTypes[idx] !== LbmCellType.ObstacleSolid) continue;

          const neighbors = [
            {
              dx: -1,
              dy: 0,
              dz: 0,
              normal: [-1, 0, 0],
              quad: [
                [0, 0, 0],
                [0, 1, 0],
                [0, 1, 1],
                [0, 0, 1],
              ],
            },
            {
              dx: 1,
              dy: 0,
              dz: 0,
              normal: [1, 0, 0],
              quad: [
                [1, 0, 0],
                [1, 0, 1],
                [1, 1, 1],
                [1, 1, 0],
              ],
            },
            {
              dx: 0,
              dy: -1,
              dz: 0,
              normal: [0, -1, 0],
              quad: [
                [0, 0, 0],
                [0, 0, 1],
                [1, 0, 1],
                [1, 0, 0],
              ],
            },
            {
              dx: 0,
              dy: 1,
              dz: 0,
              normal: [0, 1, 0],
              quad: [
                [0, 1, 0],
                [1, 1, 0],
                [1, 1, 1],
                [0, 1, 1],
              ],
            },
            {
              dx: 0,
              dy: 0,
              dz: -1,
              normal: [0, 0, -1],
              quad: [
                [0, 0, 0],
                [1, 0, 0],
                [1, 1, 0],
                [0, 1, 0],
              ],
            },
            {
              dx: 0,
              dy: 0,
              dz: 1,
              normal: [0, 0, 1],
              quad: [
                [0, 0, 1],
                [0, 1, 1],
                [1, 1, 1],
                [1, 0, 1],
              ],
            },
          ];

          for (const nb of neighbors) {
            const nxCoord = ix + nb.dx;
            const nyCoord = iy + nb.dy;
            const nzCoord = iz + nb.dz;

            const isFluidNeighbor =
              nxCoord >= 0 &&
              nxCoord < nx &&
              nyCoord >= 0 &&
              nyCoord < ny &&
              nzCoord >= 0 &&
              nzCoord < nz &&
              this.runner.cellTypes[nxCoord + nyCoord * nx + nzCoord * nx * ny] !== LbmCellType.ObstacleSolid;

            if (isFluidNeighbor) {
              const base = vertIdx;
              const nIdx = nxCoord + nyCoord * nx + nzCoord * nx * ny;
              const vMag = Math.hypot(this.runner.vx[nIdx] ?? 0, this.runner.vy[nIdx] ?? 0, this.runner.vz[nIdx] ?? 0);
              const rhoVal = this.runner.rho[nIdx] ?? 1.0;
              const pVal = ((rhoVal - 1.0) / 3.0) * (dx / this.runner.config.dt) ** 2 * this.runner.config.density;

              for (const [qx, qy, qz] of nb.quad) {
                positions.push((ix + qx) * dx, (iy + qy) * dx, (iz + qz) * dx);
                normals.push(nb.normal[0], nb.normal[1], nb.normal[2]);
                velocityMag.push(vMag);
                pressure.push(pVal);
                alphaPolymer.push(1.0);
                temperature.push(300.0);
              }

              indices.push(base, base + 1, base + 2);
              indices.push(base, base + 2, base + 3);
              vertIdx += 4;
            }
          }
        }
      }
    }

    // 2. Extract mid-Z 2D slice plane of fluid cells
    const midZ = Math.floor(nz / 2);
    const zCoord = (midZ + 0.5) * dx;

    for (let iy = 0; iy < ny - 1; iy++) {
      for (let ix = 0; ix < nx - 1; ix++) {
        const x0 = ix * dx,
          x1 = (ix + 1) * dx;
        const y0 = iy * dx,
          y1 = (iy + 1) * dx;

        const cell0 = ix + iy * nx + midZ * nx * ny;
        const cell1 = ix + 1 + iy * nx + midZ * nx * ny;
        const cell2 = ix + 1 + (iy + 1) * nx + midZ * nx * ny;
        const cell3 = ix + (iy + 1) * nx + midZ * nx * ny;

        const cells = [cell0, cell1, cell2, cell3];
        const pts = [
          [x0, y0, zCoord],
          [x1, y0, zCoord],
          [x1, y1, zCoord],
          [x0, y1, zCoord],
        ];

        const base = vertIdx;
        for (let p = 0; p < 4; p++) {
          positions.push(pts[p][0], pts[p][1], pts[p][2]);
          normals.push(0, 0, 1);

          const c = cells[p];
          const vx = this.runner.vx[c] ?? 0;
          const vy = this.runner.vy[c] ?? 0;
          const vz = this.runner.vz[c] ?? 0;
          const vMag = Math.hypot(vx, vy, vz);
          const rhoVal = this.runner.rho[c] ?? 1.0;
          const pVal = ((rhoVal - 1.0) / 3.0) * (dx / this.runner.config.dt) ** 2 * this.runner.config.density;

          velocityMag.push(vMag);
          pressure.push(pVal);
          alphaPolymer.push(this.runner.cellTypes[c] === LbmCellType.ObstacleSolid ? 1.0 : 0.0);
          temperature.push(300.0);
        }

        indices.push(base, base + 1, base + 2);
        indices.push(base, base + 2, base + 3);
        vertIdx += 4;
      }
    }

    const forces = this.lastResult?.aerodynamicForceN ?? [0, 0, 0];
    const posArr = new Float32Array(positions);
    const idxArr = new Uint32Array(indices);
    const normArr = new Float32Array(normals);
    const vMagArr = new Float32Array(velocityMag);
    const pressArr = new Float32Array(pressure);
    const alphaArr = new Float32Array(alphaPolymer);
    const tempArr = new Float32Array(temperature);

    return {
      type: "cfd-mesh",
      participantId: this.id,
      time: this.currentTime,
      geometry: { positions: posArr, indices: idxArr, normals: normArr },
      fields: {
        "alpha.polymer": alphaArr,
        temperature: tempArr,
        velocityMagnitude: vMagArr,
        pressure: pressArr,
      },
      metadata: {
        dragForce: forces,
        maxVelocity: this.lastResult?.maxVelocity ?? 0,
        pressureDrop: this.lastResult?.pressureDropPa ?? 0,
      },
    };
  }

  /**
   * Generates a contiguous binary buffer suitable for zero-copy Transferable postMessage
   * or WebSocket binary frames. Eliminates all JSON stringification and GC pauses.
   */
  public getBinaryMeshPayload(): ArrayBuffer {
    const payload = this.getMeshPayload();
    const pos = payload.geometry.positions as Float32Array;
    const idx = payload.geometry.indices as Uint32Array;
    const norm = (payload.geometry.normals ?? new Float32Array(0)) as Float32Array;
    const vMag = payload.fields.velocityMagnitude as Float32Array;
    const press = payload.fields.pressure as Float32Array;

    // Header:
    // [0..3]: Magic 0x4C424D31 ('LBM1')
    // [4..11]: Float64 time
    // [12..23]: Float32 dragForce [Fx, Fy, Fz]
    // [24..27]: Float32 maxVelocity
    // [28..31]: Float32 pressureDrop
    // [32..35]: Uint32 vertexCount
    // [36..39]: Uint32 indexCount
    const headerBytes = 40;
    const totalBytes =
      headerBytes + pos.byteLength + idx.byteLength + norm.byteLength + vMag.byteLength + press.byteLength;

    const buffer = new ArrayBuffer(totalBytes);
    const view = new DataView(buffer);

    view.setUint32(0, 0x4c424d31, true); // 'LBM1'
    view.setFloat64(4, payload.time, true);
    view.setFloat32(12, payload.metadata.dragForce[0], true);
    view.setFloat32(16, payload.metadata.dragForce[1], true);
    view.setFloat32(20, payload.metadata.dragForce[2], true);
    view.setFloat32(24, payload.metadata.maxVelocity, true);
    view.setFloat32(28, payload.metadata.pressureDrop, true);
    view.setUint32(32, pos.length / 3, true);
    view.setUint32(36, idx.length, true);

    let offset = headerBytes;
    new Uint8Array(buffer, offset, pos.byteLength).set(new Uint8Array(pos.buffer, pos.byteOffset, pos.byteLength));
    offset += pos.byteLength;

    new Uint8Array(buffer, offset, idx.byteLength).set(new Uint8Array(idx.buffer, idx.byteOffset, idx.byteLength));
    offset += idx.byteLength;

    new Uint8Array(buffer, offset, norm.byteLength).set(new Uint8Array(norm.buffer, norm.byteOffset, norm.byteLength));
    offset += norm.byteLength;

    new Uint8Array(buffer, offset, vMag.byteLength).set(new Uint8Array(vMag.buffer, vMag.byteOffset, vMag.byteLength));
    offset += vMag.byteLength;

    new Uint8Array(buffer, offset, press.byteLength).set(
      new Uint8Array(press.buffer, press.byteOffset, press.byteLength),
    );

    return buffer;
  }
}
