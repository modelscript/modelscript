// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Core types for `@modelscript/jcamp-dx` (IUPAC JCAMP-DX Analytical Spectroscopy Exchange Format).
 */

export type AsdfMode = "AFFN" | "PAC" | "SQZ" | "DIF" | "DUP" | "DIFDUP";

export type JcampSpectrumType =
  "INFRARED SPECTRUM" | "NMR SPECTRUM" | "MASS SPECTRUM" | "UV/VIS SPECTRUM" | "RAMAN SPECTRUM" | "LINK" | string;

export interface JcampLdr {
  /** Normalized uppercase label without `##` prefix or `=` suffix (e.g. "TITLE", "DATA TYPE"). */
  label: string;
  /** Raw label text as written in the file. */
  rawLabel: string;
  /** Trimmed value payload (may span multiple lines). */
  value: string;
  /** 1-indexed start line number. */
  line: number;
  /** 1-indexed end line number. */
  endLine: number;
  /** 0-indexed character start offset in source. */
  startOffset: number;
  /** 0-indexed character end offset in source. */
  endOffset: number;
  /** Optional inline `$$` comment attached to this LDR. */
  comment?: string;
}

export interface JcampDataPoint {
  x: number;
  y: number;
}

export interface JcampCheckpointError {
  /** 1-indexed line number in the source document (or relative to XYDATA block). */
  line: number;
  /** Expected ordinate (last Y value of previous line in unscaled integer/raw units). */
  expectedY: number;
  /** Actual checkpoint ordinate on this line (in unscaled raw units). */
  actualY: number;
  /** X coordinate at the checkpoint line (scaled). */
  x: number;
  /** Absolute difference `|actualY - expectedY|`. */
  delta: number;
}

export interface JcampParseError {
  line: number;
  column?: number;
  message: string;
}

export interface JcampBlock {
  title: string;
  jcampDxVersion: string;
  dataType: JcampSpectrumType;
  origin?: string;
  owner?: string;
  date?: string;
  time?: string;
  xUnits?: string;
  yUnits?: string;
  xLabel?: string;
  yLabel?: string;
  firstX?: number;
  lastX?: number;
  firstY?: number;
  lastY?: number;
  maxX?: number;
  minX?: number;
  maxY?: number;
  minY?: number;
  nPoints?: number;
  xFactor?: number;
  yFactor?: number;
  deltaX?: number;
  /** Data table header variable list, e.g. "(X++(Y..Y))" or "(XY..XY)". */
  dataFormat?: string;
  /** Decoded continuous/sampled XY spectrum points (scaled by xFactor/yFactor). */
  points: JcampDataPoint[];
  /** Decoded discrete peak table points from `##PEAK TABLE=` (if present). */
  peakTable: JcampDataPoint[];
  /** All Labeled Data Records in this block. */
  ldrs: JcampLdr[];
  /** Standalone `$$` comments encountered in this block. */
  comments: string[];
  /** DIFDUP checkpoint continuity errors encountered during ASDF decoding. */
  checkpointErrors: JcampCheckpointError[];
  /** Syntax / parsing errors encountered while parsing this block. */
  parseErrors: JcampParseError[];
  /** Nested child blocks (used in `##DATA TYPE= LINK` compound files). */
  children: JcampBlock[];
  /** 1-indexed line where the block starts. */
  startLine: number;
  /** 1-indexed line where the block ends. */
  endLine: number;
  /** Whether an explicit `##END=` record terminated this block. */
  hasEnd: boolean;
}

export interface JcampDocument {
  /** Top-level JCAMP-DX blocks in the document. */
  blocks: JcampBlock[];
  /** Convenience reference to the primary spectrum block (first non-LINK block, or first block). */
  primary: JcampBlock | null;
}

export interface SpectralPeak {
  /** Index into the spectrum points array. */
  index: number;
  /** X coordinate (wavenumber cm^-1, chemical shift ppm, m/z, wavelength nm). */
  x: number;
  /** Y intensity (absorbance, transmittance, relative intensity). */
  y: number;
  /** Topographic prominence of the peak. */
  prominence: number;
  /** Whether this peak is a local maximum (e.g. Absorbance/MS/NMR) or minimum (e.g. Transmittance). */
  kind: "maximum" | "minimum";
  /** Optional IR functional group assignment when matched against cleanroom catalog. */
  assignment?: string;
}

export interface JcampDxDiagnostic {
  code: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
  column?: number;
  label?: string;
}
