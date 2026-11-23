// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Motorola S-Record memory-region coalescer, flat binary image builder,
 * IEEE 802.3 CRC-32 calculator, and entry-point validator.
 */

import type { SrecBinaryImage, SrecFile, SrecMemoryRegion, SrecSolveResult } from "../types.js";

// Precomputed IEEE 802.3 CRC-32 lookup table (polynomial 0xEDB88320, reflected)
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC32_TABLE[i] = c >>> 0;
}

/**
 * Computes the standard IEEE 802.3 CRC-32 checksum over a byte buffer.
 */
export function computeCrc32(data: Uint8Array, seed: number = 0): number {
  let crc = ~seed >>> 0;
  for (let i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return ~crc >>> 0;
}

/**
 * Coalesces all data records (`S1`, `S2`, `S3`) in an `SrecFile` into sorted contiguous
 * memory regions. Records are sorted by address; adjacent records are merged seamlessly.
 */
export function coalesceMemoryRegions(file: SrecFile): {
  regions: SrecMemoryRegion[];
  overlappingAddresses: number[];
} {
  const dataRecords = file.records
    .filter((r) => (r.type === "S1" || r.type === "S2" || r.type === "S3") && r.data.length > 0)
    .slice()
    .sort((a, b) => (a.address >>> 0) - (b.address >>> 0) || a.line - b.line);

  if (dataRecords.length === 0) {
    return { regions: [], overlappingAddresses: [] };
  }

  const byteMap = new Map<number, number>();
  const overlappingAddresses: number[] = [];
  const lineByAddr = new Map<number, number>();
  const recordCounts: Array<{ start: number; end: number; line: number }> = [];

  for (const rec of dataRecords) {
    const base = rec.address >>> 0;
    recordCounts.push({ start: base, end: base + rec.data.length, line: rec.line });
    for (let i = 0; i < rec.data.length; i++) {
      const addr = (base + i) >>> 0;
      if (byteMap.has(addr)) {
        overlappingAddresses.push(addr);
      }
      byteMap.set(addr, rec.data[i]!);
      if (!lineByAddr.has(addr)) {
        lineByAddr.set(addr, rec.line);
      }
    }
  }

  const sortedAddrs = Array.from(byteMap.keys()).sort((a, b) => a - b);
  const regions: SrecMemoryRegion[] = [];

  let segStart = sortedAddrs[0]!;
  let segBytes: number[] = [byteMap.get(segStart)!];
  let prevAddr = segStart;

  const flushRegion = (): void => {
    const data = Uint8Array.from(segBytes);
    const startAddress = segStart >>> 0;
    const endAddress = (startAddress + data.length) >>> 0;
    let recCount = 0;
    let firstLine = Number.MAX_SAFE_INTEGER;
    for (const rc of recordCounts) {
      if (rc.start < endAddress && rc.end > startAddress) {
        recCount++;
        if (rc.line < firstLine) firstLine = rc.line;
      }
    }
    regions.push({
      index: regions.length,
      startAddress,
      endAddress,
      size: data.length,
      data,
      crc32: computeCrc32(data),
      recordCount: recCount,
      firstLine: firstLine === Number.MAX_SAFE_INTEGER ? 1 : firstLine,
    });
  };

  for (let i = 1; i < sortedAddrs.length; i++) {
    const addr = sortedAddrs[i]!;
    if (addr === prevAddr + 1) {
      segBytes.push(byteMap.get(addr)!);
    } else {
      flushRegion();
      segStart = addr;
      segBytes = [byteMap.get(addr)!];
    }
    prevAddr = addr;
  }
  flushRegion();

  return { regions, overlappingAddresses };
}

/**
 * Builds a flat contiguous binary image spanning `[minAddress, maxAddress)` with gaps filled by `fillByte`.
 */
export function buildBinaryImage(
  file: SrecFile,
  fillByte: number = 0xff,
  maxSpanBytes: number = 16 * 1024 * 1024,
): SrecBinaryImage {
  const { regions } = coalesceMemoryRegions(file);
  if (regions.length === 0) {
    const empty = new Uint8Array(0);
    return {
      baseAddress: 0,
      endAddress: 0,
      data: empty,
      fillByte: fillByte & 0xff,
      crc32: computeCrc32(empty),
    };
  }

  const baseAddress = regions[0]!.startAddress;
  const endAddress = regions[regions.length - 1]!.endAddress;
  const span = endAddress - baseAddress;
  if (span > maxSpanBytes) {
    throw new RangeError(`Address span ${span} bytes exceeds maximum flat binary image limit (${maxSpanBytes} bytes)`);
  }

  const data = new Uint8Array(span);
  data.fill(fillByte & 0xff);
  for (const reg of regions) {
    data.set(reg.data, reg.startAddress - baseAddress);
  }

  return {
    baseAddress,
    endAddress,
    data,
    fillByte: fillByte & 0xff,
    crc32: computeCrc32(data),
  };
}

/**
 * Validates whether a start/entry-point address falls within one of the coalesced memory regions.
 */
export function validateEntryPoint(
  regions: SrecMemoryRegion[],
  startAddress: number | undefined,
): { valid: boolean; regionIndex: number } {
  if (startAddress === undefined) {
    return { valid: false, regionIndex: -1 };
  }
  const addr = startAddress >>> 0;
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i]!;
    if (addr >= r.startAddress && addr < r.endAddress) {
      return { valid: true, regionIndex: i };
    }
  }
  return { valid: false, regionIndex: -1 };
}

/**
 * Solves memory layout, region coalescing, utilization, CRC-32, and entry-point validity for an `SrecFile`.
 */
export function solveSrecMemory(file: SrecFile): SrecSolveResult {
  const { regions, overlappingAddresses } = coalesceMemoryRegions(file);

  let totalDataBytes = 0;
  let overallCrc = 0;
  for (const r of regions) {
    totalDataBytes += r.size;
    overallCrc = computeCrc32(r.data, overallCrc);
  }

  const minAddress = regions.length > 0 ? regions[0]!.startAddress : 0;
  const maxAddress = regions.length > 0 ? regions[regions.length - 1]!.endAddress : 0;
  const addressSpan = maxAddress > minAddress ? maxAddress - minAddress : 0;
  const utilization = addressSpan > 0 ? totalDataBytes / addressSpan : 0;

  const entryCheck = validateEntryPoint(regions, file.startAddress);

  return {
    regions,
    totalDataBytes,
    minAddress,
    maxAddress,
    addressSpan,
    utilization,
    overallCrc32: overallCrc >>> 0,
    startAddress: file.startAddress,
    entryPointValid: entryCheck.valid,
    entryPointRegionIndex: entryCheck.regionIndex,
    overlappingAddresses,
  };
}
