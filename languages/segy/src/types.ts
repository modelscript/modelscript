// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core data structures for SEG-Y Rev 0 / Rev 1 seismic files, headers, traces, and acoustic models.
 */

export type SegyTextEncoding = "ascii" | "ebcdic";

/**
 * Valid SEG-Y sample data format codes (binary header bytes 3225–3226).
 * - 1: 4-byte IBM System/360 hexadecimal floating-point
 * - 2: 4-byte two's complement integer (int32)
 * - 3: 2-byte two's complement integer (int16)
 * - 5: 4-byte IEEE-754 floating-point (float32)
 * - 8: 1-byte two's complement integer (int8)
 */
export const SegySampleFormat = {
  IBM_FLOAT32: 1,
  INT32: 2,
  INT16: 3,
  IEEE_FLOAT32: 5,
  INT8: 8,
} as const;

export type SegySampleFormatCode = (typeof SegySampleFormat)[keyof typeof SegySampleFormat];

export const VALID_SEGY_SAMPLE_FORMATS: ReadonlySet<number> = new Set([1, 2, 3, 5, 8]);

/**
 * Valid SEG-Y measurement system codes (binary header bytes 3255–3256).
 * - 1: Meters
 * - 2: Feet
 */
export const SegyMeasurementSystem = {
  METERS: 1,
  FEET: 2,
} as const;

export interface SegyTextualCard {
  /** 1-based card index (1..40). */
  cardNumber: number;
  /** Raw 80-character card text. */
  raw: string;
  /** Optional recognized keyword (e.g. CLIENT, LINE, AREA, SAMPLE INTERVAL). */
  key?: string | undefined;
  /** Extracted value following the keyword. */
  value?: string | undefined;
  /** 1-based line number in textual source. */
  line: number;
}

export interface SegyTextualHeader {
  encoding: SegyTextEncoding;
  /** Up to 40 textual header cards (80 chars each). */
  cards: SegyTextualCard[];
  /** Extracted standard metadata fields from textual cards. */
  client?: string | undefined;
  line?: string | undefined;
  area?: string | undefined;
  sampleIntervalUs?: number | undefined;
  traceLengthMs?: number | undefined;
  format?: string | undefined;
  revision?: string | undefined;
  hasEndTextualHeader: boolean;
  /** Raw decoded 3200-char (or multi-line) text. */
  rawText: string;
}

/**
 * SEG-Y 400-byte binary reel header (bytes 3201–3600).
 */
export interface SegyBinaryHeader {
  jobId: number;
  lineNumber: number;
  reelNumber: number;
  tracesPerEnsemble: number;
  auxTracesPerEnsemble: number;
  /** Sample interval in microseconds (Δt). */
  sampleIntervalUs: number;
  origSampleIntervalUs: number;
  /** Number of samples per trace. */
  samplesPerTrace: number;
  origSamplesPerTrace: number;
  /** Data sample format code (1, 2, 3, 5, 8). */
  sampleFormatCode: number;
  ensembleFold: number;
  traceSortingCode: number;
  verticalSumCode: number;
  sweepFreqStartHz: number;
  sweepFreqEndHz: number;
  sweepLengthMs: number;
  sweepTypeCode: number;
  /** Measurement system: 1 = Meters, 2 = Feet. */
  measurementSystem: number;
  impulsePolarity: number;
  /** SEG-Y format revision number (e.g. 0x0000 for Rev 0, 0x0100 for Rev 1.0). */
  segyRevision: number;
  fixedLengthTraceFlag: number;
  extendedTextualHeadersCount: number;
}

/**
 * SEG-Y 240-byte trace header.
 */
export interface SegyTraceHeader {
  traceSeqLine: number;
  traceSeqFile: number;
  fieldRecord: number;
  traceNumberField: number;
  cdp: number;
  traceNumberEnsemble: number;
  traceIdCode: number;
  /** Distance from center of source point to center of receiver group (m or ft). */
  offsetM: number;
  receiverElevation: number;
  sourceElevation: number;
  sourceDepth: number;
  coordScalar: number;
  sourceX: number;
  sourceY: number;
  groupX: number;
  groupY: number;
  coordUnits: number;
  delayRecordingTimeMs: number;
  /** Number of samples in this trace. */
  sampleCount: number;
  /** Sample interval in microseconds for this trace. */
  sampleIntervalUs: number;
  /** 3D poststack inline number (Rev 1 bytes 189–192). */
  inline3D: number;
  /** 3D poststack crossline number (Rev 1 bytes 193–196). */
  crossline3D: number;
}

export interface SegyTrace {
  header: SegyTraceHeader;
  /** Decoded floating-point amplitude samples. */
  samples: Float32Array;
  /** Byte offset of this trace in the binary stream (if decoded from binary). */
  byteOffset?: number | undefined;
}

export interface SegyStreamIssue {
  code: string;
  message: string;
  byteOffset?: number | undefined;
  traceIndex?: number | undefined;
}

export interface SegyFile {
  textualHeader: SegyTextualHeader;
  binaryHeader: SegyBinaryHeader;
  extendedTextualHeaders: string[];
  traces: SegyTrace[];
  /** Total byte length of source stream, if decoded from binary. */
  byteLength?: number | undefined;
  /** Low-level stream/framing issues collected during decode. */
  streamIssues: SegyStreamIssue[];
}

export interface SegyAcousticLayer {
  name: string;
  /** Thickness in meters. */
  thicknessM: number;
  /** P-wave velocity in m/s. */
  velocityMps: number;
  /** Bulk density in kg/m³. */
  densityKgM3: number;
}

export interface SegyAcousticModel {
  name: string;
  /** Dominant source wavelet frequency in Hz. */
  dominantFreqHz: number;
  /** Sample interval in seconds. */
  dtSec: number;
  /** Number of spatial grid cells per layer (default 1). */
  cellsPerLayer?: number | undefined;
  layers: SegyAcousticLayer[];
}
