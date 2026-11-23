// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  Plot3dBlockDims,
  Plot3dDimension,
  Plot3dEndianness,
  Plot3dFlowConditions,
  Plot3dGrid,
  Plot3dGridBlock,
  Plot3dPrecision,
  Plot3dSolution,
  Plot3dSolutionBlock,
} from "../types.js";

export interface Plot3dBinaryParseOptions {
  dimension?: Plot3dDimension | undefined;
  multiBlock?: boolean | undefined;
  hasIblank?: boolean | undefined;
  endianness?: Plot3dEndianness | undefined;
  precision?: Plot3dPrecision | undefined;
}

export interface Plot3dBinaryEncodeOptions {
  endianness?: Plot3dEndianness | undefined;
  precision?: Plot3dPrecision | undefined;
}

export interface FortranRecord {
  index: number;
  byteLength: number;
  payload: Uint8Array;
}

/**
 * Detects endianness of a Fortran unformatted binary buffer by checking
 * whether the first 32-bit record header matches its corresponding trailer marker.
 */
export function detectFortranEndianness(bytes: Uint8Array): Plot3dEndianness {
  if (bytes.byteLength < 8) {
    throw new Error("Buffer too short to contain a Fortran unformatted binary record");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const checkEndian = (littleEndian: boolean): boolean => {
    const headerLen = view.getInt32(0, littleEndian);
    if (headerLen < 0 || 4 + headerLen + 4 > bytes.byteLength) return false;
    const trailerLen = view.getInt32(4 + headerLen, littleEndian);
    return headerLen === trailerLen;
  };

  if (checkEndian(true)) return "little";
  if (checkEndian(false)) return "big";
  throw new Error("Unable to detect Fortran unformatted binary endianness: record markers do not match");
}

/**
 * Reads all Fortran unformatted sequential binary records (`<int32 len><payload><int32 len>`).
 */
export function readFortranRecords(
  bytes: Uint8Array,
  endianness?: Plot3dEndianness,
): { endianness: Plot3dEndianness; records: FortranRecord[] } {
  const resolvedEndian = endianness ?? detectFortranEndianness(bytes);
  const le = resolvedEndian === "little";
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const records: FortranRecord[] = [];
  let offset = 0;
  let index = 0;

  while (offset < bytes.byteLength) {
    if (offset + 4 > bytes.byteLength) {
      throw new Error(`Truncated Fortran record ${index} header at byte offset ${offset}`);
    }
    const headerLen = view.getInt32(offset, le);
    offset += 4;
    if (headerLen < 0 || offset + headerLen + 4 > bytes.byteLength) {
      throw new Error(
        `Fortran record ${index} length (${headerLen}) exceeds remaining buffer size (${bytes.byteLength - offset})`,
      );
    }
    const payload = bytes.subarray(offset, offset + headerLen);
    offset += headerLen;
    const trailerLen = view.getInt32(offset, le);
    offset += 4;
    if (headerLen !== trailerLen) {
      throw new Error(`Fortran record ${index} marker mismatch: header=${headerLen}, trailer=${trailerLen}`);
    }
    records.push({ index, byteLength: headerLen, payload });
    index++;
  }

  return { endianness: resolvedEndian, records };
}

/**
 * Wraps a payload into a single Fortran unformatted binary record (`<int32 len><payload><int32 len>`).
 */
export function writeFortranRecord(payload: Uint8Array, endianness: Plot3dEndianness = "little"): Uint8Array {
  const le = endianness === "little";
  const out = new Uint8Array(payload.byteLength + 8);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setInt32(0, payload.byteLength, le);
  out.set(payload, 4);
  view.setInt32(4 + payload.byteLength, payload.byteLength, le);
  return out;
}

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.byteLength;
  }
  return out;
}

function readInt32Array(payload: Uint8Array, le: boolean): Int32Array {
  const count = Math.floor(payload.byteLength / 4);
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const out = new Int32Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = view.getInt32(i * 4, le);
  }
  return out;
}

function writeInt32Record(values: number[], endianness: Plot3dEndianness): Uint8Array {
  const le = endianness === "little";
  const payload = new Uint8Array(values.length * 4);
  const view = new DataView(payload.buffer);
  for (let i = 0; i < values.length; i++) {
    view.setInt32(i * 4, values[i]!, le);
  }
  return writeFortranRecord(payload, endianness);
}

function readFloatArray(
  view: DataView,
  byteOffset: number,
  count: number,
  precision: Plot3dPrecision,
  le: boolean,
): Float64Array {
  const out = new Float64Array(count);
  if (precision === "float64") {
    for (let i = 0; i < count; i++) {
      out[i] = view.getFloat64(byteOffset + i * 8, le);
    }
  } else {
    for (let i = 0; i < count; i++) {
      out[i] = view.getFloat32(byteOffset + i * 4, le);
    }
  }
  return out;
}

function writeFloatValues(
  view: DataView,
  byteOffset: number,
  values: Float64Array | number[],
  precision: Plot3dPrecision,
  le: boolean,
): number {
  if (precision === "float64") {
    for (let i = 0; i < values.length; i++) {
      view.setFloat64(byteOffset + i * 8, values[i]!, le);
    }
    return byteOffset + values.length * 8;
  }
  for (let i = 0; i < values.length; i++) {
    view.setFloat32(byteOffset + i * 4, values[i]!, le);
  }
  return byteOffset + values.length * 4;
}

/**
 * Parses a Fortran unformatted binary PLOT3D grid (`.xyz` / `.g`), supporting single-block
 * and multi-block, 2D and 3D, float32 and float64, little and big endian.
 */
export function parsePlot3dGridBinary(bytes: Uint8Array, options?: Plot3dBinaryParseOptions): Plot3dGrid {
  const { endianness, records } = readFortranRecords(bytes, options?.endianness);
  const le = endianness === "little";
  if (records.length < 2) {
    throw new Error(`Expected at least 2 Fortran records in PLOT3D binary grid, got ${records.length}`);
  }

  let recIdx = 0;
  let multiBlock = options?.multiBlock;
  let nBlocks = 1;

  if (multiBlock === undefined) {
    // Multi-block binary PLOT3D starts with a 4-byte record containing NBLOCKS
    if (records[0]!.byteLength === 4 && records.length >= 3) {
      const nb = readInt32Array(records[0]!.payload, le)[0]!;
      if (nb > 0 && records.length === 2 + nb) {
        multiBlock = true;
        nBlocks = nb;
        recIdx = 1;
      } else {
        multiBlock = false;
      }
    } else {
      multiBlock = false;
    }
  } else if (multiBlock) {
    if (records[0]!.byteLength !== 4) {
      throw new Error(`Expected 4-byte NBLOCKS record, got ${records[0]!.byteLength} bytes`);
    }
    nBlocks = readInt32Array(records[0]!.payload, le)[0]!;
    recIdx = 1;
  }

  const dimInts = readInt32Array(records[recIdx++]!.payload, le);
  let dimension = options?.dimension;
  if (!dimension) {
    if (dimInts.length === nBlocks * 3) {
      dimension = "3d";
    } else if (dimInts.length === nBlocks * 2) {
      dimension = "2d";
    } else {
      throw new Error(`Cannot infer grid dimension from ${dimInts.length} dimension integers for ${nBlocks} block(s)`);
    }
  }

  const dims: Plot3dBlockDims[] = [];
  for (let b = 0; b < nBlocks; b++) {
    if (dimension === "3d") {
      dims.push({ ni: dimInts[b * 3]!, nj: dimInts[b * 3 + 1]!, nk: dimInts[b * 3 + 2]! });
    } else {
      dims.push({ ni: dimInts[b * 2]!, nj: dimInts[b * 2 + 1]!, nk: 1 });
    }
  }

  if (records.length < recIdx + nBlocks) {
    throw new Error(`Expected ${recIdx + nBlocks} Fortran records for ${nBlocks} blocks, got ${records.length}`);
  }

  const dimCount = dimension === "3d" ? 3 : 2;
  // Detect precision and iblank from first block's byteLength if not specified
  const firstN = dims[0]!.ni * dims[0]!.nj * dims[0]!.nk;
  const firstBytes = records[recIdx]!.byteLength;
  let precision = options?.precision;
  let hasIblank = options?.hasIblank;

  if (!precision || hasIblank === undefined) {
    if (firstBytes === firstN * dimCount * 8) {
      precision = precision ?? "float64";
      hasIblank = hasIblank ?? false;
    } else if (firstBytes === firstN * dimCount * 4) {
      precision = precision ?? "float32";
      hasIblank = hasIblank ?? false;
    } else if (firstBytes === firstN * (dimCount * 8 + 4)) {
      precision = precision ?? "float64";
      hasIblank = hasIblank ?? true;
    } else if (firstBytes === firstN * (dimCount * 4 + 4)) {
      precision = precision ?? "float32";
      hasIblank = hasIblank ?? true;
    } else {
      precision = precision ?? "float64";
      hasIblank = hasIblank ?? false;
    }
  }

  const elemSize = precision === "float64" ? 8 : 4;
  const blocks: Plot3dGridBlock[] = [];

  for (let b = 0; b < nBlocks; b++) {
    const { ni, nj, nk } = dims[b]!;
    const nNodes = ni * nj * nk;
    const payload = records[recIdx++]!.payload;
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    let offset = 0;

    const x = readFloatArray(view, offset, nNodes, precision, le);
    offset += nNodes * elemSize;
    const y = readFloatArray(view, offset, nNodes, precision, le);
    offset += nNodes * elemSize;
    let z: Float64Array;
    if (dimension === "3d") {
      z = readFloatArray(view, offset, nNodes, precision, le);
      offset += nNodes * elemSize;
    } else {
      z = new Float64Array(nNodes);
    }

    let iblank: Int32Array | undefined;
    if (hasIblank && offset + nNodes * 4 <= payload.byteLength) {
      iblank = new Int32Array(nNodes);
      for (let i = 0; i < nNodes; i++) {
        iblank[i] = view.getInt32(offset + i * 4, le);
      }
    }

    blocks.push({ index: b, ni, nj, nk, x, y, z, iblank });
  }

  return {
    format: "binary",
    dimension,
    multiBlock,
    hasIblank,
    endianness,
    precision,
    blocks,
  };
}

/**
 * Encodes a `Plot3dGrid` into Fortran unformatted binary format.
 */
export function encodePlot3dGridBinary(grid: Plot3dGrid, options?: Plot3dBinaryEncodeOptions): Uint8Array {
  const endianness = options?.endianness ?? grid.endianness ?? "little";
  const precision = options?.precision ?? grid.precision ?? "float64";
  const le = endianness === "little";
  const elemSize = precision === "float64" ? 8 : 4;
  const dimCount = grid.dimension === "3d" ? 3 : 2;
  const chunks: Uint8Array[] = [];

  if (grid.multiBlock) {
    chunks.push(writeInt32Record([grid.blocks.length], endianness));
  }

  const dimInts: number[] = [];
  for (const b of grid.blocks) {
    dimInts.push(b.ni, b.nj);
    if (grid.dimension === "3d") dimInts.push(b.nk);
  }
  chunks.push(writeInt32Record(dimInts, endianness));

  for (const b of grid.blocks) {
    const nNodes = b.ni * b.nj * b.nk;
    const includeIblank = grid.hasIblank && b.iblank !== undefined;
    const payloadBytes = nNodes * dimCount * elemSize + (includeIblank ? nNodes * 4 : 0);
    const payload = new Uint8Array(payloadBytes);
    const view = new DataView(payload.buffer);
    let offset = 0;
    offset = writeFloatValues(view, offset, b.x, precision, le);
    offset = writeFloatValues(view, offset, b.y, precision, le);
    if (grid.dimension === "3d") {
      offset = writeFloatValues(view, offset, b.z, precision, le);
    }
    if (includeIblank && b.iblank) {
      for (let i = 0; i < nNodes; i++) {
        view.setInt32(offset + i * 4, b.iblank[i]!, le);
      }
    }
    chunks.push(writeFortranRecord(payload, endianness));
  }

  return concatUint8Arrays(chunks);
}

/**
 * Parses a Fortran unformatted binary PLOT3D conservative solution file (`.q`).
 */
export function parsePlot3dSolutionBinary(bytes: Uint8Array, options?: Plot3dBinaryParseOptions): Plot3dSolution {
  const { endianness, records } = readFortranRecords(bytes, options?.endianness);
  const le = endianness === "little";
  if (records.length < 3) {
    throw new Error(`Expected at least 3 Fortran records in PLOT3D binary solution, got ${records.length}`);
  }

  let recIdx = 0;
  let multiBlock = options?.multiBlock;
  let nBlocks = 1;

  if (multiBlock === undefined) {
    if (records[0]!.byteLength === 4 && records.length >= 4) {
      const nb = readInt32Array(records[0]!.payload, le)[0]!;
      if (nb > 0 && records.length === 2 + 2 * nb) {
        multiBlock = true;
        nBlocks = nb;
        recIdx = 1;
      } else {
        multiBlock = false;
      }
    } else {
      multiBlock = false;
    }
  } else if (multiBlock) {
    nBlocks = readInt32Array(records[0]!.payload, le)[0]!;
    recIdx = 1;
  }

  const dimInts = readInt32Array(records[recIdx++]!.payload, le);
  let dimension = options?.dimension;
  if (!dimension) {
    if (dimInts.length === nBlocks * 3) {
      dimension = "3d";
    } else if (dimInts.length === nBlocks * 2) {
      dimension = "2d";
    } else {
      throw new Error(`Cannot infer solution dimension from ${dimInts.length} integers for ${nBlocks} block(s)`);
    }
  }

  const dims: Plot3dBlockDims[] = [];
  for (let b = 0; b < nBlocks; b++) {
    if (dimension === "3d") {
      dims.push({ ni: dimInts[b * 3]!, nj: dimInts[b * 3 + 1]!, nk: dimInts[b * 3 + 2]! });
    } else {
      dims.push({ ni: dimInts[b * 2]!, nj: dimInts[b * 2 + 1]!, nk: 1 });
    }
  }

  // Detect precision from first conditions record (4 floats = 16 or 32 bytes)
  const condBytes = records[recIdx]!.byteLength;
  const precision: Plot3dPrecision = options?.precision ?? (condBytes === 32 ? "float64" : "float32");
  const elemSize = precision === "float64" ? 8 : 4;

  const blocks: Plot3dSolutionBlock[] = [];
  for (let b = 0; b < nBlocks; b++) {
    const { ni, nj, nk } = dims[b]!;
    const nNodes = ni * nj * nk;

    const condPayload = records[recIdx++]!.payload;
    const condView = new DataView(condPayload.buffer, condPayload.byteOffset, condPayload.byteLength);
    const condVals = readFloatArray(condView, 0, 4, precision, le);
    const conditions: Plot3dFlowConditions = {
      fsmach: condVals[0]!,
      alpha: condVals[1]!,
      re: condVals[2]!,
      time: condVals[3]!,
    };

    const qPayload = records[recIdx++]!.payload;
    const qView = new DataView(qPayload.buffer, qPayload.byteOffset, qPayload.byteLength);
    let offset = 0;
    const rho = readFloatArray(qView, offset, nNodes, precision, le);
    offset += nNodes * elemSize;
    const rhou = readFloatArray(qView, offset, nNodes, precision, le);
    offset += nNodes * elemSize;
    const rhov = readFloatArray(qView, offset, nNodes, precision, le);
    offset += nNodes * elemSize;
    const rhow =
      dimension === "3d"
        ? (() => {
            const arr = readFloatArray(qView, offset, nNodes, precision, le);
            offset += nNodes * elemSize;
            return arr;
          })()
        : new Float64Array(nNodes);
    const energy = readFloatArray(qView, offset, nNodes, precision, le);

    blocks.push({ index: b, ni, nj, nk, conditions, rho, rhou, rhov, rhow, energy });
  }

  return {
    format: "binary",
    dimension,
    multiBlock,
    endianness,
    precision,
    blocks,
  };
}

/**
 * Encodes a `Plot3dSolution` into Fortran unformatted binary format.
 */
export function encodePlot3dSolutionBinary(solution: Plot3dSolution, options?: Plot3dBinaryEncodeOptions): Uint8Array {
  const endianness = options?.endianness ?? solution.endianness ?? "little";
  const precision = options?.precision ?? solution.precision ?? "float64";
  const le = endianness === "little";
  const elemSize = precision === "float64" ? 8 : 4;
  const qCount = solution.dimension === "3d" ? 5 : 4;
  const chunks: Uint8Array[] = [];

  if (solution.multiBlock) {
    chunks.push(writeInt32Record([solution.blocks.length], endianness));
  }

  const dimInts: number[] = [];
  for (const b of solution.blocks) {
    dimInts.push(b.ni, b.nj);
    if (solution.dimension === "3d") dimInts.push(b.nk);
  }
  chunks.push(writeInt32Record(dimInts, endianness));

  for (const b of solution.blocks) {
    const condPayload = new Uint8Array(4 * elemSize);
    const condView = new DataView(condPayload.buffer);
    writeFloatValues(
      condView,
      0,
      [b.conditions.fsmach, b.conditions.alpha, b.conditions.re, b.conditions.time],
      precision,
      le,
    );
    chunks.push(writeFortranRecord(condPayload, endianness));

    const nNodes = b.ni * b.nj * b.nk;
    const qPayload = new Uint8Array(nNodes * qCount * elemSize);
    const qView = new DataView(qPayload.buffer);
    let offset = 0;
    offset = writeFloatValues(qView, offset, b.rho, precision, le);
    offset = writeFloatValues(qView, offset, b.rhou, precision, le);
    offset = writeFloatValues(qView, offset, b.rhov, precision, le);
    if (solution.dimension === "3d") {
      offset = writeFloatValues(qView, offset, b.rhow, precision, le);
    }
    writeFloatValues(qView, offset, b.energy, precision, le);
    chunks.push(writeFortranRecord(qPayload, endianness));
  }

  return concatUint8Arrays(chunks);
}
