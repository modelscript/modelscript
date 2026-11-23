// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core TypeScript data structures for `@modelscript/arinc429`.
 */

export type Arinc429BusRate = "LOW" | "HIGH";

export type Arinc429Encoding = "BNR" | "BCD" | "DISCRETE";

/**
 * 2-bit Sign/Status Matrix (SSM) value (`0..3`).
 */
export type Arinc429SsmCode = 0 | 1 | 2 | 3;

export type Arinc429SsmMeaning =
  "FAILURE_WARNING" | "NO_COMPUTED_DATA" | "FUNCTIONAL_TEST" | "NORMAL_OPERATION" | "PLUS" | "MINUS";

/**
 * Declarative ARINC 429 label specification in a bus schema.
 */
export interface Arinc429LabelDef {
  /** 3-digit octal string, e.g. "203", "310". */
  labelOctal: string;
  /** Numeric label value 0..255 (octal 000..377), or NaN if invalid. */
  labelValue: number;
  /** Symbolic parameter name (e.g. "ALTITUDE", "PITCH"). */
  name: string;
  /** Word payload encoding. */
  encoding: Arinc429Encoding;
  /** Source/Destination Identifier (0..3), or undefined if wildcard/unused. */
  sdi?: number | undefined;
  /** Full-scale engineering range (e.g. 131072 ft, 180 deg). */
  range?: number | undefined;
  /** Engineering value per LSB (for BNR or BCD scaling). */
  resolution?: number | undefined;
  /** Engineering units (e.g. "ft", "kt", "deg", "Mach", "degC"). */
  units?: string | undefined;
  /** Scheduled transmission rate in Hz. */
  rateHz?: number | undefined;
  /** Source equipment identifier (e.g. "ADC", "IRS", "LRRA"). */
  equipment?: string | undefined;
  /** 1-based line number in source file. */
  line?: number | undefined;
  /** Character offset in source text. */
  startOffset?: number | undefined;
  endOffset?: number | undefined;
}

/**
 * Raw 32-bit word entry in an ARINC 429 trace file.
 */
export interface Arinc429FrameEntry {
  /** Optional timestamp in seconds. */
  timestampSec: number;
  /** Raw unsigned 32-bit word value. */
  rawWord: number;
  /** Original hex literal string (e.g. "0xE0C350C1"). */
  rawHex: string;
  /** Optional inline comment or label annotation. */
  comment?: string | undefined;
  /** 1-based line number in source file. */
  line?: number | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
}

/**
 * Parse error recorded during schema/trace parsing.
 */
export interface Arinc429ParseError {
  message: string;
  line: number;
  column: number;
}

/**
 * Parsed ARINC 429 bus schema and optional trace frame document.
 */
export interface Arinc429Document {
  /** Bus name (from `BUS <name>`). */
  busName: string;
  /** Bus bit rate (`LOW` = 12.5 kbps, `HIGH` = 100 kbps). */
  rate: Arinc429BusRate;
  /** Whether `RATE` was explicitly specified in the document. */
  rateExplicit: boolean;
  /** Label definitions in declaration order. */
  labels: Arinc429LabelDef[];
  /** Trace frames / 32-bit words in file order. */
  frames: Arinc429FrameEntry[];
  /** Parse errors encountered while reading the text. */
  parseErrors: Arinc429ParseError[];
}

/**
 * Decoded 32-bit ARINC 429 word breakdown.
 */
export interface DecodedArinc429Word {
  /** Unsigned 32-bit raw word. */
  rawWord: number;
  /** Uppercase 8-hex-digit representation (`0xXXXXXXXX`). */
  rawHex: string;
  /** Wire-order label byte (bits 1..8 as stored in LSB). */
  wireLabelByte: number;
  /** Decoded label numeric value (bit-reversed from bits 1..8, 0..255). */
  labelValue: number;
  /** 3-digit zero-padded octal label string (e.g. "203"). */
  labelOctal: string;
  /** 2-bit SDI (bits 9..10). */
  sdi: number;
  /** Raw 19-bit data payload (bits 11..29, unsigned 0..524287). */
  rawData19: number;
  /** Signed 19-bit two's-complement integer (for BNR). */
  signedData19: number;
  /** 5 BCD digits [d5, d4, d3, d2, d1] (most-significant 3-bit digit first). */
  bcdDigits: [number, number, number, number, number];
  /** True if all 4-bit BCD nibbles are <= 9 (and 3-bit MSB digit <= 7). */
  bcdValid: boolean;
  /** Invalid BCD nibble indices (1-based digit positions 1..4) if any > 9. */
  invalidBcdDigits: number[];
  /** 2-bit SSM (bits 30..31). */
  ssm: Arinc429SsmCode;
  /** Semantic meaning of SSM for the chosen encoding. */
  ssmMeaning: Arinc429SsmMeaning;
  /** Bit 32 parity bit (0 or 1). */
  parityBit: 0 | 1;
  /** True iff total 1-bits across all 32 bits is odd. */
  parityValid: boolean;
  /** Encoding used to interpret the payload. */
  encoding: Arinc429Encoding;
  /** Decoded engineering value (BNR/BCD) or raw integer mask (DISCRETE). */
  engineeringValue: number;
  /** Engineering units if known. */
  units: string;
  /** Label name if known. */
  labelName: string;
}

/**
 * Input parameters for encoding a 32-bit ARINC 429 word.
 */
export interface EncodeArinc429WordInput {
  /** Octal label string (e.g. "203") or numeric value (0..255). */
  label: string | number;
  /** 2-bit SDI (0..3, default 0). */
  sdi?: number | undefined;
  /** Payload encoding (default "BNR"). */
  encoding?: Arinc429Encoding | undefined;
  /** Engineering value to encode (for BNR/BCD) or bitmask (for DISCRETE). */
  value: number;
  /** Full-scale range for BNR (used when resolution is omitted). */
  range?: number | undefined;
  /** LSB resolution (value per LSB for BNR, or scale per least-significant digit for BCD). */
  resolution?: number | undefined;
  /** 2-bit SSM override (defaults to 3 for BNR normal, 0/3 for BCD +/-, 0 for DISCRETE). */
  ssm?: Arinc429SsmCode | undefined;
  /** Force inverted (bad) parity for fault-injection testing. */
  injectParityError?: boolean | undefined;
}

/**
 * Diagnostic emitted by the ARINC 429 linter.
 */
export interface Arinc429Diagnostic {
  code: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
  column: number;
  labelOctal?: string | undefined;
}

/**
 * Decoded avionics flight-state snapshot extracted from ARINC 429 telemetry.
 */
export interface Arinc429FlightState {
  altitudeFt: number;
  airspeedKt: number;
  mach: number;
  totalAirTempC: number;
  pitchDeg: number;
  rollDeg: number;
  headingDeg: number;
  latitudeDeg: number;
  longitudeDeg: number;
  radioAltFt: number;
  decodedFrames: Array<{
    timestampSec: number;
    word: DecodedArinc429Word;
  }>;
}

/**
 * Bus bandwidth utilization & timing margin analysis result.
 */
export interface Arinc429BusUtilization {
  busName: string;
  rate: Arinc429BusRate;
  bitRateBps: number;
  bitsPerWordWithGap: number;
  wordDurationSec: number;
  maxWordsPerSec: number;
  scheduledWordsPerSec: number;
  utilizationPct: number;
  timingMarginPct: number;
  slackTimeSecPerSec: number;
  overloaded: boolean;
  perLabel: Array<{
    labelOctal: string;
    name: string;
    rateHz: number;
    bandwidthBps: number;
    utilizationPct: number;
  }>;
}
