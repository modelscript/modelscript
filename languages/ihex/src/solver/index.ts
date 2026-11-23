// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Memory-Map Coalescer, Flat ROM Binary Generator, and Integrity Checksum Solver
 * for `@modelscript/ihex`.
 *
 * Implements:
 * - IEEE 802.3 CRC-32 (polynomial 0xEDB88320, init 0xFFFFFFFF, xorout 0xFFFFFFFF)
 * - Fletcher-16 (mod-255 dual accumulator)
 * - 32-bit linear/segmented memory segment coalescing & overlap tracking
 * - Flat binary ROM image generation with configurable erased-flash fill byte (`0xFF`)
 * - Flash utilization & 2's-complement checksum residual RMSE statistics
 */

import {
  IhexRecordType,
  type IhexMemoryMap,
  type IhexModel,
  type IhexOverlap,
  type IhexSegment,
  type IhexSolveResult,
} from "../types.js";

// Precompute IEEE 802.3 CRC-32 lookup table (reflected polynomial 0xEDB88320)
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let bit = 0; bit < 8; bit++) {
    c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC32_TABLE[i] = c >>> 0;
}

/**
 * Computes standard IEEE 802.3 CRC-32 checksum (check value for `"123456789"` is `0xCBF43926`).
 */
export function computeCrc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    const idx = (crc ^ (data[i] ?? 0)) & 0xff;
    crc = (CRC32_TABLE[idx] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Computes Fletcher-16 checksum over a byte array.
 */
export function computeFletcher16(data: Uint8Array): number {
  let sum1 = 0;
  let sum2 = 0;
  for (let i = 0; i < data.length; i++) {
    sum1 = (sum1 + (data[i] ?? 0)) % 255;
    sum2 = (sum2 + sum1) % 255;
  }
  return ((sum2 << 8) | sum1) & 0xffff;
}

export interface CoalesceOptions {
  /** Fill byte for uninitialized gaps (default `0xFF` erased flash) */
  fillByte?: number | undefined;
}

interface DataChunk {
  start: number;
  end: number;
  data: Uint8Array;
  lineNumber: number;
}

/**
 * Coalesces all Data (`00`) records in an `IhexModel` into sorted, contiguous 32-bit
 * memory segments, detecting overlapping address writes and computing per-segment
 * IEEE CRC-32 and Fletcher-16 checksums.
 */
export function coalesceIhexMemoryMap(model: IhexModel, options: CoalesceOptions = {}): IhexMemoryMap {
  const fillByte = (options.fillByte ?? 0xff) & 0xff;

  const chunks: DataChunk[] = [];
  for (const rec of model.records) {
    if (rec.recordType === IhexRecordType.Data && rec.data.length > 0) {
      chunks.push({
        start: rec.linearAddress >>> 0,
        end: (rec.linearAddress + rec.data.length) >>> 0,
        data: rec.data,
        lineNumber: rec.lineNumber,
      });
    }
  }

  if (chunks.length === 0) {
    return {
      format: model.format,
      segments: [],
      overlaps: [],
      minAddress: 0,
      maxAddress: 0,
      totalDataBytes: 0,
      totalSpanBytes: 0,
      totalGapBytes: 0,
      fillByte,
      startLinearAddress: model.startLinearAddress,
      startSegmentAddress: model.startSegmentAddress,
    };
  }

  // Sort by start address (stable by lineNumber for deterministic overlap resolution)
  chunks.sort((a, b) => (a.start !== b.start ? a.start - b.start : a.lineNumber - b.lineNumber));

  const overlaps: IhexOverlap[] = [];
  const mergedGroups: DataChunk[][] = [];

  let currentGroup: DataChunk[] = [chunks[0]!];
  let currentEnd = chunks[0]!.end;
  let lastChunk = chunks[0]!;

  for (let i = 1; i < chunks.length; i++) {
    const ch = chunks[i]!;
    if (ch.start < currentEnd) {
      // Overlap detected
      const overlapBytes = Math.min(currentEnd, ch.end) - ch.start;
      overlaps.push({
        address: ch.start,
        firstLine: lastChunk.lineNumber,
        secondLine: ch.lineNumber,
        byteCount: overlapBytes,
      });
      currentGroup.push(ch);
      if (ch.end > currentEnd) {
        currentEnd = ch.end;
      }
      lastChunk = ch;
    } else if (ch.start === currentEnd) {
      // Contiguous
      currentGroup.push(ch);
      currentEnd = ch.end;
      lastChunk = ch;
    } else {
      // Gap — start new segment
      mergedGroups.push(currentGroup);
      currentGroup = [ch];
      currentEnd = ch.end;
      lastChunk = ch;
    }
  }
  mergedGroups.push(currentGroup);

  const segments: IhexSegment[] = [];
  let totalDataBytes = 0;

  for (let s = 0; s < mergedGroups.length; s++) {
    const grp = mergedGroups[s]!;
    const segStart = grp[0]!.start;
    let segEnd = grp[0]!.end;
    let startLine = grp[0]!.lineNumber;
    let endLine = grp[0]!.lineNumber;

    for (const ch of grp) {
      if (ch.end > segEnd) segEnd = ch.end;
      if (ch.lineNumber < startLine) startLine = ch.lineNumber;
      if (ch.lineNumber > endLine) endLine = ch.lineNumber;
    }

    const length = segEnd - segStart;
    const data = new Uint8Array(length);
    data.fill(fillByte);

    for (const ch of grp) {
      data.set(ch.data, ch.start - segStart);
    }

    totalDataBytes += length;
    segments.push({
      index: s,
      startAddress: segStart,
      endAddress: segEnd,
      length,
      data,
      crc32: computeCrc32(data),
      fletcher16: computeFletcher16(data),
      recordCount: grp.length,
      startLine,
      endLine,
    });
  }

  const minAddress = segments[0]!.startAddress;
  const maxAddress = segments[segments.length - 1]!.endAddress;
  const totalSpanBytes = maxAddress - minAddress;
  const totalGapBytes = Math.max(0, totalSpanBytes - totalDataBytes);

  return {
    format: model.format,
    segments,
    overlaps,
    minAddress,
    maxAddress,
    totalDataBytes,
    totalSpanBytes,
    totalGapBytes,
    fillByte,
    startLinearAddress: model.startLinearAddress,
    startSegmentAddress: model.startSegmentAddress,
  };
}

/**
 * Generates a contiguous flat binary ROM image spanning `[map.minAddress, map.maxAddress)`
 * with uninitialized gaps filled by `fillByte` (default `0xFF`).
 */
export function toBinaryRomImage(
  map: IhexMemoryMap,
  fillByte: number = map.fillByte,
  maxImageBytes: number = 16 * 1024 * 1024,
): Uint8Array {
  if (map.segments.length === 0 || map.totalSpanBytes <= 0) {
    return new Uint8Array(0);
  }
  const size = Math.min(map.totalSpanBytes, maxImageBytes);
  const image = new Uint8Array(size);
  image.fill(fillByte & 0xff);

  for (const seg of map.segments) {
    const offset = seg.startAddress - map.minAddress;
    if (offset >= size) continue;
    const copyLen = Math.min(seg.length, size - offset);
    image.set(seg.data.subarray(0, copyLen), offset);
  }

  return image;
}

export interface IhexSolveOptions {
  /** Target MCU flash capacity in bytes (auto-sized to next power-of-two KiB if omitted) */
  flashSizeBytes?: number | undefined;
  /** Erased flash fill byte (default `0xFF`) */
  fillByte?: number | undefined;
  /** Cap flat binary allocation for sparse 32-bit images (default 16 MiB) */
  maxFlatImageBytes?: number | undefined;
}

/**
 * Solves an Intel HEX image: coalesces 32-bit segments, generates the flat ROM image,
 * computes IEEE 802.3 CRC-32 & Fletcher-16 checksums, 2's-complement record checksum RMSE,
 * and flash memory utilization statistics.
 */
export function solveIhexImage(model: IhexModel, options: IhexSolveOptions = {}): IhexSolveResult {
  const fillByte = (options.fillByte ?? 0xff) & 0xff;
  const memoryMap = coalesceIhexMemoryMap(model, { fillByte });
  const binaryImage = toBinaryRomImage(memoryMap, fillByte, options.maxFlatImageBytes);

  const imageCrc32 = computeCrc32(binaryImage);
  const imageFletcher16 = computeFletcher16(binaryImage);

  const recordCount = model.records.length;
  let validChecksumCount = 0;
  let sumSqErr = 0;

  for (const rec of model.records) {
    if (rec.checksumValid) {
      validChecksumCount += 1;
    } else {
      const diff = rec.checksum - rec.expectedChecksum;
      sumSqErr += diff * diff;
    }
  }

  const checksumRmse = recordCount > 0 ? Math.sqrt(sumSqErr / recordCount) : 0;

  // Infer a realistic power-of-two flash size if not provided (minimum 4 KiB)
  let flashSizeBytes = options.flashSizeBytes;
  if (flashSizeBytes === undefined || flashSizeBytes <= 0) {
    const needed = Math.max(4096, memoryMap.totalDataBytes);
    let cap = 4096;
    while (cap < needed && cap < 64 * 1024 * 1024) {
      cap *= 2;
    }
    flashSizeBytes = cap;
  }

  const flashUtilization = flashSizeBytes > 0 ? memoryMap.totalDataBytes / flashSizeBytes : 0;

  return {
    memoryMap,
    binaryImage,
    imageCrc32,
    imageFletcher16,
    recordCount,
    validChecksumCount,
    checksumRmse,
    flashSizeBytes,
    flashUtilization,
  };
}
