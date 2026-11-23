// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core data structures for `@modelscript/ihex` (Intel HEX, 1973).
 */

export const IhexRecordType = {
  /** 00 — Data record */
  Data: 0x00,
  /** 01 — End Of File record */
  Eof: 0x01,
  /** 02 — Extended Segment Address record (I16HEX, base = seg << 4) */
  ExtendedSegmentAddress: 0x02,
  /** 03 — Start Segment Address record (I16HEX, 80x86 CS:IP) */
  StartSegmentAddress: 0x03,
  /** 04 — Extended Linear Address record (I32HEX, base = upper16 << 16) */
  ExtendedLinearAddress: 0x04,
  /** 05 — Start Linear Address record (I32HEX, 32-bit EIP) */
  StartLinearAddress: 0x05,
} as const;

export type IhexRecordType = (typeof IhexRecordType)[keyof typeof IhexRecordType];

export type IhexFormat = "I8HEX" | "I16HEX" | "I32HEX";

export interface IhexStartSegmentAddress {
  cs: number;
  ip: number;
}

export interface IhexParseError {
  lineNumber: number;
  column: number;
  startOffset: number;
  endOffset: number;
  code: "IHEX1001" | "IHEX1002" | "IHEX1003";
  message: string;
  raw: string;
}

export interface IhexRecord {
  /** 1-based line number in source text */
  lineNumber: number;
  /** 0-based UTF-16 start offset in source text */
  startOffset: number;
  /** 0-based UTF-16 end offset in source text */
  endOffset: number;
  /** Trimmed raw record line */
  raw: string;
  /** Declared data byte count `LL` (0x00–0xFF) */
  byteCount: number;
  /** 16-bit load offset `AAAA` (0x0000–0xFFFF) */
  address: number;
  /** Record type `TT` (0x00–0xFF; standard is 0x00–0x05) */
  recordType: number;
  /** Decoded payload bytes */
  data: Uint8Array;
  /** Recorded checksum byte `CC` */
  checksum: number;
  /** Computed 2's-complement checksum byte */
  expectedChecksum: number;
  /** Whether `checksum === expectedChecksum` */
  checksumValid: boolean;
  /** Whether `data.length === byteCount` */
  byteCountValid: boolean;
  /** Active extended base address (linear or segment) when this record was encountered */
  baseAddress: number;
  /** Effective 32-bit linear address (`(baseAddress + address) >>> 0`) for Data records */
  linearAddress: number;
}

export interface IhexModel {
  name: string;
  format: IhexFormat;
  records: IhexRecord[];
  parseErrors: IhexParseError[];
  hasEof: boolean;
  eofLine?: number | undefined;
  startSegmentAddress?: IhexStartSegmentAddress | undefined;
  startLinearAddress?: number | undefined;
  totalDataBytes: number;
  minAddress?: number | undefined;
  maxAddress?: number | undefined;
}

export interface IhexInputSegment {
  address: number;
  data: Uint8Array;
}

export interface IhexEncodeOptions {
  /** Output Intel HEX variant (defaults to auto-detect based on max address) */
  format?: IhexFormat | undefined;
  /** Data bytes per `00` record (1–255, default 16) */
  bytesPerLine?: number | undefined;
  /** Optional 32-bit entry point for `05` Start Linear Address record */
  startLinearAddress?: number | undefined;
  /** Optional 80x86 CS:IP entry point for `03` Start Segment Address record */
  startSegmentAddress?: IhexStartSegmentAddress | undefined;
  /** Line ending (default "\n") */
  lineEnding?: "\n" | "\r\n" | undefined;
  /** Emit uppercase hex digits (default true) */
  uppercase?: boolean | undefined;
}

export interface IhexSegment {
  index: number;
  startAddress: number;
  /** Exclusive end address (`startAddress + length`) */
  endAddress: number;
  length: number;
  data: Uint8Array;
  crc32: number;
  fletcher16: number;
  recordCount: number;
  startLine: number;
  endLine: number;
}

export interface IhexOverlap {
  address: number;
  firstLine: number;
  secondLine: number;
  byteCount: number;
}

export interface IhexMemoryMap {
  format: IhexFormat;
  segments: IhexSegment[];
  overlaps: IhexOverlap[];
  minAddress: number;
  maxAddress: number;
  totalDataBytes: number;
  totalSpanBytes: number;
  totalGapBytes: number;
  fillByte: number;
  startLinearAddress?: number | undefined;
  startSegmentAddress?: IhexStartSegmentAddress | undefined;
}

export interface IhexSolveResult {
  memoryMap: IhexMemoryMap;
  binaryImage: Uint8Array;
  imageCrc32: number;
  imageFletcher16: number;
  recordCount: number;
  validChecksumCount: number;
  checksumRmse: number;
  flashSizeBytes: number;
  flashUtilization: number;
}

export type IhexDiagnosticSeverity = "error" | "warning" | "info";

export interface IhexLintDiagnostic {
  code: string;
  rule: string;
  severity: IhexDiagnosticSeverity;
  message: string;
  line: number;
  column: number;
  endColumn?: number | undefined;
}
