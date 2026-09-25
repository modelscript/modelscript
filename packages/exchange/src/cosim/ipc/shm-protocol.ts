// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Binary Shared Memory & Unix Domain Socket IPC Protocol for Native CFD Solvers.
 *
 * Provides a lock-free, zero-disk-write binary communication bridge between ModelScript's
 * co-simulation orchestrator and persistent native CFD solver daemons (OpenFOAM, SU2).
 */

export const CFD_IPC_MAGIC = 0x4346445f; // 'CFD_'
export const CFD_IPC_VERSION = 1;

export enum CfdIpcCommand {
  Idle = 0,
  Step = 1,
  Initialize = 2,
  Terminate = 3,
  GetMesh = 4,
}

export enum CfdIpcStatus {
  Ready = 0,
  Busy = 1,
  StepDone = 2,
  Error = 3,
  Terminated = 4,
}

export enum CfdPatchType {
  VelocityInlet = 0,
  PressureOutlet = 1,
  Wall = 2,
  MovingWall = 3,
}

/**
 * Binary layout for a single boundary patch interface:
 * Total: 64 bytes per patch (fixed-stride struct)
 *
 * [0..3]:   Uint32 patchId
 * [4..7]:   Uint32 patchType (CfdPatchType)
 * [8..15]:  Float64 pressure (Pa) [Input or Output]
 * [16..23]: Float64 massFlow (kg/s) [Input or Output]
 * [24..31]: Float64 velocityX (m/s)
 * [32..39]: Float64 velocityY (m/s)
 * [40..47]: Float64 velocityZ (m/s)
 * [48..55]: Float64 temperature (K)
 * [56..63]: Float64 wallForceNormal (N) or wallShearStress (Pa)
 */
export const CFD_PATCH_STRIDE_BYTES = 64;

export interface CfdPatchData {
  patchId: number;
  patchName: string;
  patchType: CfdPatchType;
  pressure: number;
  massFlow: number;
  velocity: [number, number, number];
  temperature: number;
  wallForce: number;
}

/**
 * Binary Header Layout (64 bytes):
 * [0..3]:   Uint32 magic (0x4346445F)
 * [4..7]:   Uint32 version (1)
 * [8..11]:  Uint32 command (CfdIpcCommand)
 * [12..15]: Uint32 status (CfdIpcStatus)
 * [16..19]: Uint32 stepId
 * [20..23]: Uint32 numPatches
 * [24..31]: Float64 currentTime
 * [32..39]: Float64 stepSize
 * [40..47]: Float64 maxVelocity
 * [48..55]: Float64 totalDragForceX
 * [56..63]: Float64 totalDragForceY
 */
export const CFD_HEADER_BYTES = 64;

export class CfdIpcCodec {
  public static encodeHeader(
    view: DataView,
    cmd: CfdIpcCommand,
    status: CfdIpcStatus,
    stepId: number,
    numPatches: number,
    currentTime: number,
    stepSize: number,
    metrics?: { maxVelocity?: number; dragForceX?: number; dragForceY?: number },
  ): void {
    view.setUint32(0, CFD_IPC_MAGIC, true);
    view.setUint32(4, CFD_IPC_VERSION, true);
    view.setUint32(8, cmd, true);
    view.setUint32(12, status, true);
    view.setUint32(16, stepId, true);
    view.setUint32(20, numPatches, true);
    view.setFloat64(24, currentTime, true);
    view.setFloat64(32, stepSize, true);
    view.setFloat64(40, metrics?.maxVelocity ?? 0, true);
    view.setFloat64(48, metrics?.dragForceX ?? 0, true);
    view.setFloat64(56, metrics?.dragForceY ?? 0, true);
  }

  public static decodeHeader(view: DataView): {
    magic: number;
    version: number;
    command: CfdIpcCommand;
    status: CfdIpcStatus;
    stepId: number;
    numPatches: number;
    currentTime: number;
    stepSize: number;
    maxVelocity: number;
    dragForceX: number;
    dragForceY: number;
  } {
    return {
      magic: view.getUint32(0, true),
      version: view.getUint32(4, true),
      command: view.getUint32(8, true) as CfdIpcCommand,
      status: view.getUint32(12, true) as CfdIpcStatus,
      stepId: view.getUint32(16, true),
      numPatches: view.getUint32(20, true),
      currentTime: view.getFloat64(24, true),
      stepSize: view.getFloat64(32, true),
      maxVelocity: view.getFloat64(40, true),
      dragForceX: view.getFloat64(48, true),
      dragForceY: view.getFloat64(56, true),
    };
  }

  public static encodePatch(view: DataView, offset: number, patch: CfdPatchData): void {
    view.setUint32(offset + 0, patch.patchId, true);
    view.setUint32(offset + 4, patch.patchType, true);
    view.setFloat64(offset + 8, patch.pressure, true);
    view.setFloat64(offset + 16, patch.massFlow, true);
    view.setFloat64(offset + 24, patch.velocity[0], true);
    view.setFloat64(offset + 32, patch.velocity[1], true);
    view.setFloat64(offset + 40, patch.velocity[2], true);
    view.setFloat64(offset + 48, patch.temperature, true);
    view.setFloat64(offset + 56, patch.wallForce, true);
  }

  public static decodePatch(view: DataView, offset: number, patchName = ""): CfdPatchData {
    return {
      patchId: view.getUint32(offset + 0, true),
      patchName,
      patchType: view.getUint32(offset + 4, true) as CfdPatchType,
      pressure: view.getFloat64(offset + 8, true),
      massFlow: view.getFloat64(offset + 16, true),
      velocity: [
        view.getFloat64(offset + 24, true),
        view.getFloat64(offset + 32, true),
        view.getFloat64(offset + 40, true),
      ],
      temperature: view.getFloat64(offset + 48, true),
      wallForce: view.getFloat64(offset + 56, true),
    };
  }
}
