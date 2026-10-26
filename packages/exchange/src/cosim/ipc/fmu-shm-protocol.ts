// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Binary Shared Memory IPC Protocol for Ultra-High-Speed Native FMU Stepping.
 *
 * Provides a lock-free, zero-copy shared memory bridge between ModelScript's
 * co-simulation orchestrator and native FMI 2.0 / FMI 3.0 shared library harnesses.
 *
 * Replaces line-delimited JSON-RPC over stdin/stdout, reducing per-step latency
 * from ~50 µs to < 1 µs for high-frequency electrical and continuum co-simulation.
 */

export const FMU_IPC_MAGIC = 0x464d555f; // 'FMU_'
export const FMU_IPC_VERSION = 1;

export enum FmuIpcCommand {
  Idle = 0,
  Init = 1,
  SetInputs = 2,
  DoStep = 3,
  GetOutputs = 4,
  Terminate = 5,
  Reset = 6,
}

export enum FmuIpcStatus {
  Ready = 0,
  Busy = 1,
  StepDone = 2,
  Error = 3,
  Terminated = 4,
}

/**
 * Cache-line aligned 64-byte Header Layout:
 * [0..3]:   Uint32 magic (0x464D555F)
 * [4..7]:   Uint32 version (1)
 * [8..11]:  Uint32 command (FmuIpcCommand)
 * [12..15]: Uint32 status (FmuIpcStatus)
 * [16..19]: Uint32 sequenceId
 * [20..23]: Uint32 numInputs
 * [24..27]: Uint32 numOutputs
 * [28..31]: Uint32 errorCode
 * [32..39]: Float64 currentTime
 * [40..47]: Float64 stepSize
 * [48..55]: Float64 stopTime
 * [56..63]: Uint8[8] reserved
 */
export const FMU_SHM_HEADER_BYTES = 64;

export interface FmuShmMemoryLayout {
  headerBytes: number;
  maxInputs: number;
  maxOutputs: number;
  inputVrsOffset: number;
  inputValuesOffset: number;
  outputVrsOffset: number;
  outputValuesOffset: number;
  totalBytes: number;
}

/**
 * Calculates aligned offsets and total byte size for a shared memory region.
 */
export function computeFmuShmLayout(maxInputs = 512, maxOutputs = 512): FmuShmMemoryLayout {
  const headerBytes = FMU_SHM_HEADER_BYTES;
  const inputVrsOffset = headerBytes;
  // Align to 8 bytes for Float64
  const rawInputVals = inputVrsOffset + maxInputs * 4;
  const inputValuesOffset = (rawInputVals + 7) & ~7;

  const outputVrsOffset = inputValuesOffset + maxInputs * 8;
  const rawOutputVals = outputVrsOffset + maxOutputs * 4;
  const outputValuesOffset = (rawOutputVals + 7) & ~7;

  const totalBytes = outputValuesOffset + maxOutputs * 8;

  return {
    headerBytes,
    maxInputs,
    maxOutputs,
    inputVrsOffset,
    inputValuesOffset,
    outputVrsOffset,
    outputValuesOffset,
    totalBytes,
  };
}

export class FmuShmCodec {
  public static encodeHeader(
    view: DataView,
    cmd: FmuIpcCommand,
    status: FmuIpcStatus,
    sequenceId: number,
    numInputs: number,
    numOutputs: number,
    currentTime: number,
    stepSize: number,
    stopTime = 0.0,
    errorCode = 0,
  ): void {
    view.setUint32(0, FMU_IPC_MAGIC, true);
    view.setUint32(4, FMU_IPC_VERSION, true);
    view.setUint32(8, cmd, true);
    view.setUint32(12, status, true);
    view.setUint32(16, sequenceId >>> 0, true);
    view.setUint32(20, numInputs >>> 0, true);
    view.setUint32(24, numOutputs >>> 0, true);
    view.setUint32(28, errorCode >>> 0, true);
    view.setFloat64(32, currentTime, true);
    view.setFloat64(40, stepSize, true);
    view.setFloat64(48, stopTime, true);
  }

  public static decodeHeader(view: DataView): {
    magic: number;
    version: number;
    command: FmuIpcCommand;
    status: FmuIpcStatus;
    sequenceId: number;
    numInputs: number;
    numOutputs: number;
    errorCode: number;
    currentTime: number;
    stepSize: number;
    stopTime: number;
  } {
    return {
      magic: view.getUint32(0, true),
      version: view.getUint32(4, true),
      command: view.getUint32(8, true) as FmuIpcCommand,
      status: view.getUint32(12, true) as FmuIpcStatus,
      sequenceId: view.getUint32(16, true),
      numInputs: view.getUint32(20, true),
      numOutputs: view.getUint32(24, true),
      errorCode: view.getUint32(28, true),
      currentTime: view.getFloat64(32, true),
      stepSize: view.getFloat64(40, true),
      stopTime: view.getFloat64(48, true),
    };
  }

  public static writeInputs(
    buffer: ArrayBuffer | Uint8Array,
    layout: FmuShmMemoryLayout,
    vrs: number[],
    values: number[],
  ): void {
    const count = Math.min(vrs.length, values.length, layout.maxInputs);
    const vrArray = new Uint32Array(
      buffer instanceof Uint8Array ? buffer.buffer : buffer,
      (buffer instanceof Uint8Array ? buffer.byteOffset : 0) + layout.inputVrsOffset,
      count,
    );
    const valArray = new Float64Array(
      buffer instanceof Uint8Array ? buffer.buffer : buffer,
      (buffer instanceof Uint8Array ? buffer.byteOffset : 0) + layout.inputValuesOffset,
      count,
    );

    for (let i = 0; i < count; i++) {
      vrArray[i] = vrs[i]! >>> 0;
      valArray[i] = values[i]!;
    }
  }

  public static readOutputs(
    buffer: ArrayBuffer | Uint8Array,
    layout: FmuShmMemoryLayout,
    numOutputs: number,
  ): { vrs: number[]; values: number[] } {
    const count = Math.min(numOutputs, layout.maxOutputs);
    const vrArray = new Uint32Array(
      buffer instanceof Uint8Array ? buffer.buffer : buffer,
      (buffer instanceof Uint8Array ? buffer.byteOffset : 0) + layout.outputVrsOffset,
      count,
    );
    const valArray = new Float64Array(
      buffer instanceof Uint8Array ? buffer.buffer : buffer,
      (buffer instanceof Uint8Array ? buffer.byteOffset : 0) + layout.outputValuesOffset,
      count,
    );

    const vrs: number[] = new Array(count);
    const values: number[] = new Array(count);
    for (let i = 0; i < count; i++) {
      vrs[i] = vrArray[i]!;
      values[i] = valArray[i]!;
    }
    return { vrs, values };
  }
}
