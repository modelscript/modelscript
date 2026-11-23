// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core domain types for IRIG 106 Chapter 9 TMATS (Telemetry Attributes Transfer Standard).
 */

export type TmatsGroupCode = "G" | "T" | "M" | "P" | "D" | "C" | "R" | "B" | "S" | "V" | "H" | "COMMENT";

export interface TmatsAttribute {
  rawCode: string;
  group: string;
  groupIndex?: number | undefined;
  subPath: string;
  value: string;
  line: number;
  column: number;
  startOffset: number;
  endOffset: number;
  missingTerminator?: boolean | undefined;
}

export interface TmatsDataSource {
  index: number;
  id: string;
  type?: string | undefined;
}

export interface TmatsGeneralGroup {
  programName?: string | undefined;
  testItem?: string | undefined;
  irigVersion?: string | undefined;
  originationDate?: string | undefined;
  revisionNumber?: string | undefined;
  dataSources: TmatsDataSource[];
  line?: number | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
}

export interface TmatsTransmissionGroup {
  index: number;
  id?: string | undefined;
  rfCarrierFreqMHz?: number | undefined;
  rfBandwidthKHz?: number | undefined;
  modulationType?: string | undefined;
  subcarrierCount?: number | undefined;
  line?: number | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
}

export interface TmatsMultiplexGroup {
  index: number;
  id?: string | undefined;
  signalStructureType?: string | undefined;
  basebandModulation?: string | undefined;
  pcmDataLinkName?: string | undefined;
  line?: number | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
}

export interface TmatsPcmFormatGroup {
  index: number;
  dataLinkName?: string | undefined;
  /** P-x\D1: Bit rate in bits per second (bps) */
  bitRateBps?: number | undefined;
  /** P-x\D2: Input code / bit encoding (e.g. NRZ-L, BI-L) */
  bitEncoding?: string | undefined;
  /** P-x\D4 or explicit minor frame rate (Hz), if supplied */
  declaredMinorFrameRateHz?: number | undefined;
  /** P-x\F1: Common word length in bits */
  commonWordLengthBits?: number | undefined;
  /** P-x\F2: Word transfer order (M = MSB first, L = LSB first) */
  wordTransferOrder?: string | undefined;
  /** P-x\F3: Parity (EV, OD, NO) */
  parity?: string | undefined;
  /** P-x\MF\N: Number of minor frames in major frame (default 1) */
  minorFramesPerMajorFrame: number;
  /** P-x\MF1: Number of words in minor frame (data words) */
  wordsPerMinorFrame?: number | undefined;
  /** P-x\MF2: Number of bits in minor frame (including sync pattern) */
  bitsPerMinorFrame?: number | undefined;
  /** P-x\MF3: Sync type (e.g. FPT = Fixed Pattern) */
  syncType?: string | undefined;
  /** P-x\MF4: Frame sync pattern (hex or binary) or sync length when MF5 holds pattern */
  syncPattern?: string | undefined;
  /** Resolved sync pattern bit length */
  syncPatternBits?: number | undefined;
  /** P-x\ID1: Subframe ID counter word position */
  subframeIdWordPosition?: number | undefined;
  line?: number | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
}

export interface TmatsMeasurement {
  groupIndex: number;
  listIndex: number;
  measurementIndex: number;
  /** D-x\MN-l-m: Measurement Name */
  name: string;
  /** D-x\LT-l-m: Location Type (W = Word, B = Bit, D = Default) */
  locationType?: string | undefined;
  /** D-x\WP-l-m: Word Position (1-based within minor frame) */
  wordPosition?: number | undefined;
  /** D-x\WI-l-m: Word Interval (supercommutation interval in words; 0 or undefined = single slot per minor frame) */
  wordInterval?: number | undefined;
  /** D-x\FP-l-m: Frame Position (1-based minor frame index within major frame; default 1) */
  framePosition: number;
  /** D-x\FI-l-m: Frame Interval (subcommutation interval in minor frames; default 1 = every minor frame) */
  frameInterval: number;
  /** D-x\WFM-l-m: Word Fragment Mask (FW = full word, or binary/hex mask) */
  wordFragmentMask?: string | undefined;
  /** Optional 0-based start bit within the word (derived from WFM or explicit WFS) */
  bitStart?: number | undefined;
  /** Optional bit length within the word (derived from WFM or explicit WFL) */
  bitLength?: number | undefined;
  line: number;
  startOffset: number;
  endOffset: number;
}

export interface TmatsMeasurementGroup {
  index: number;
  dataLinkName?: string | undefined;
  measurementListNames: Map<number, string>;
  measurements: TmatsMeasurement[];
  line?: number | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
}

export type TmatsConversionType = "COE" | "DER" | "PRS" | "NON" | "DIS" | "OTH";

export interface TmatsPairSetPoint {
  raw: number;
  eu: number;
}

export interface TmatsConversionGroup {
  index: number;
  /** C-x\DCN: Data Conversion Name (matches D-x\MN-l-m) */
  measurementName: string;
  /** C-x\MN1: Measurement Description */
  description?: string | undefined;
  /** C-x\MN3: Engineering Units */
  engineeringUnits?: string | undefined;
  /** C-x\BFM: Binary Format (UNS, TWO, ONE, SIG, OFF, FPT) */
  binaryFormat?: string | undefined;
  /** C-x\DCT: Data Conversion Type */
  conversionType: TmatsConversionType;
  /** C-x\CO\N: Polynomial order */
  polynomialOrder?: number | undefined;
  /** C-x\CO-k: Polynomial coefficients c_0, c_1, ..., c_k */
  coefficients: number[];
  /** C-x\DP-n: Derived parameter references */
  derivedParameters: string[];
  /** C-x\DR: Derived formula expression (optional) */
  derivedFormula?: string;
  /** C-x\PS1-n / C-x\PS2-n: Pair-set lookup table points */
  pairSets: TmatsPairSetPoint[];
  line: number;
  startOffset: number;
  endOffset: number;
}

export interface TmatsParseError {
  message: string;
  line: number;
  column: number;
  startOffset: number;
  endOffset: number;
}

export interface TmatsModel {
  name: string;
  source: string;
  attributes: TmatsAttribute[];
  general: TmatsGeneralGroup;
  transmissions: Map<number, TmatsTransmissionGroup>;
  multiplexes: Map<number, TmatsMultiplexGroup>;
  pcmFormats: Map<number, TmatsPcmFormatGroup>;
  measurementGroups: Map<number, TmatsMeasurementGroup>;
  conversions: Map<number, TmatsConversionGroup>;
  conversionsByName: Map<string, TmatsConversionGroup>;
  comments: Array<{ text: string; line: number; startOffset: number; endOffset: number }>;
  parseErrors: TmatsParseError[];
}
