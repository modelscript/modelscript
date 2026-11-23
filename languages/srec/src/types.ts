// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core TypeScript types for Motorola S-Record (SREC) firmware memory images.
 */

export type SrecRecordType = "S0" | "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7" | "S8" | "S9";

export type SrecDataRecordType = "S1" | "S2" | "S3";
export type SrecCountRecordType = "S5" | "S6";
export type SrecTermRecordType = "S7" | "S8" | "S9";

export interface SrecRecord {
  /** 1-based line number in the source document. */
  line: number;
  /** Byte offset of the start of this line in the source text. */
  startOffset: number;
  /** Byte offset of the end of this line in the source text. */
  endOffset: number;
  /** Raw trimmed line text. */
  raw: string;
  /** Record type (`S0`–`S9`). */
  type: SrecRecordType;
  /** Address width in bytes (2 for 16-bit, 3 for 24-bit, 4 for 32-bit). */
  addressBytes: number;
  /** Declared byte count (address bytes + data bytes + 1 checksum byte). */
  byteCount: number;
  /** Parsed address (or record count for `S5`/`S6`, or 0 for `S0`). */
  address: number;
  /** Payload data bytes (empty for `S5`–`S9`). */
  data: Uint8Array;
  /** Declared 1's-complement checksum byte at end of record. */
  checksum: number;
  /** Recomputed 1's-complement checksum byte. */
  computedChecksum: number;
  /** True if `checksum === computedChecksum`. */
  checksumValid: boolean;
  /** True if `byteCount === addressBytes + data.length + 1`. */
  byteCountValid: boolean;
}

export interface SrecParseError {
  line: number;
  column: number;
  startOffset: number;
  endOffset: number;
  raw: string;
  message: string;
}

export interface SrecFile {
  /** Optional source file name or header module name. */
  name: string;
  /** Decoded ASCII header text from `S0` record (if present). */
  headerText?: string | undefined;
  /** All parsed S-Records in source order. */
  records: SrecRecord[];
  /** Syntax-level parse errors for malformed lines. */
  parseErrors: SrecParseError[];
  /** Entry-point / execution start address from `S7`/`S8`/`S9` (if present). */
  startAddress?: number | undefined;
  /** Termination record type (`S7`, `S8`, or `S9`) if present. */
  terminationType?: SrecTermRecordType | undefined;
  /** Declared data record count from `S5`/`S6` (if present). */
  declaredRecordCount?: number | undefined;
  /** Actual number of data records (`S1`, `S2`, `S3`). */
  dataRecordCount: number;
  /** Total payload data bytes across all `S1`/`S2`/`S3` records. */
  totalDataBytes: number;
}

export interface SrecMemoryRegion {
  /** Region index (0-based). */
  index: number;
  /** Inclusive start address. */
  startAddress: number;
  /** Exclusive end address (`startAddress + size`). */
  endAddress: number;
  /** Size in bytes. */
  size: number;
  /** Contiguous byte payload for this region. */
  data: Uint8Array;
  /** IEEE 802.3 CRC-32 of this region's bytes. */
  crc32: number;
  /** Number of S-records coalesced into this region. */
  recordCount: number;
  /** First source line contributing to this region (1-based). */
  firstLine: number;
}

export interface SrecBinaryImage {
  /** Base (lowest) address of the flat binary image. */
  baseAddress: number;
  /** Exclusive end address (`baseAddress + data.length`). */
  endAddress: number;
  /** Flat binary image with gaps filled by `fillByte`. */
  data: Uint8Array;
  /** Fill byte used for gaps between regions (default `0xFF`). */
  fillByte: number;
  /** IEEE 802.3 CRC-32 of the flat binary image. */
  crc32: number;
}

export interface SrecSolveResult {
  regions: SrecMemoryRegion[];
  totalDataBytes: number;
  minAddress: number;
  maxAddress: number;
  addressSpan: number;
  utilization: number;
  overallCrc32: number;
  startAddress?: number | undefined;
  entryPointValid: boolean;
  entryPointRegionIndex: number;
  overlappingAddresses: number[];
}

export interface SrecDiagnostic {
  code: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
  column: number;
  endColumn?: number | undefined;
}

export interface SrecEncodeOptions {
  /** Optional ASCII header string for `S0` record (omit to skip `S0`). */
  header?: string | undefined;
  /** Data record type: `"S1"` (16-bit), `"S2"` (24-bit), `"S3"` (32-bit), or `"auto"`. Default `"auto"`. */
  dataRecordType?: SrecDataRecordType | "auto" | undefined;
  /** Maximum data bytes per record (1..250). Default 16. */
  bytesPerLine?: number | undefined;
  /** Emit `S5` (<= 65535 records) or `S6` (> 65535 records) count record. Default `true`. */
  includeRecordCount?: boolean | undefined;
  /** Execution start address for `S9`/`S8`/`S7` terminator. Default `0` or first region start. */
  startAddress?: number | undefined;
  /** Line ending. Default `"\n"`. */
  lineEnding?: "\n" | "\r\n" | undefined;
}
