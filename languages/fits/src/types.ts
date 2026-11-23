// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/fits — Core Data Types for FITS 4.0 Headers, Binary HDUs, WCS & Photometry.
 */

export type FitsBitpix = 8 | 16 | 32 | 64 | -32 | -64;

export type FitsHduKind = "PRIMARY" | "IMAGE" | "TABLE" | "BINTABLE" | "UNKNOWN";

export type FitsCardValueType = "boolean" | "integer" | "float" | "string" | "complex" | "comment" | "empty";

export interface FitsCard {
  /** Keyword name (1–8 uppercase ASCII characters, or "" for blank cards). */
  keyword: string;
  /** Parsed scalar/complex value (null for COMMENT/HISTORY/END/blank cards). */
  value: boolean | number | string | [number, number] | null;
  /** Classified value type. */
  valueType: FitsCardValueType;
  /** Inline comment after `/` or commentary text for HISTORY/COMMENT cards. */
  comment: string;
  /** Original raw card text (up to 80 chars, or longer if malformed). */
  raw: string;
  /** 1-based line or card index within the document/header. */
  line: number;
  /** 0-based card index within its HDU. */
  cardIndex: number;
}

export interface FitsHeader {
  cards: FitsCard[];
  /** Quick lookup of last value for non-commentary keywords. */
  keywords: Record<string, FitsCard>;
  /** All HISTORY commentary entries. */
  history: string[];
  /** All COMMENT commentary entries. */
  comments: string[];
  /** Whether an explicit END card was present. */
  hasEndCard: boolean;
  /** Duplicate non-commentary keywords detected during parsing. */
  duplicateKeywords: Array<{ keyword: string; line: number }>;
}

export interface FitsTableColumn {
  index: number;
  name: string;
  tform: string;
  unit?: string | undefined;
  /** Column start byte/char offset (1-based for ASCII TABLE TBCOLn). */
  tbcol?: number | undefined;
  /** Repeat count (for BINTABLE e.g. "3E" -> repeat 3, typeCode "E"). */
  repeat: number;
  /** Single-character FITS format code (L, X, B, I, J, K, A, E, D, F). */
  typeCode: string;
  /** Byte width per row in BINTABLE or character width in ASCII TABLE. */
  byteWidth: number;
  tscal?: number | undefined;
  tzero?: number | undefined;
}

export interface FitsTableData {
  kind: "TABLE" | "BINTABLE";
  rowCount: number;
  rowBytes: number;
  columns: FitsTableColumn[];
  rows: Array<Record<string, unknown>>;
}

export interface FitsImageData {
  bitpix: FitsBitpix;
  naxis: number;
  axes: number[];
  bscale: number;
  bzero: number;
  /** Physically scaled pixel values (`physical = bzero + bscale * raw`) in row-major order. */
  data: Float64Array;
}

export interface FitsHdu {
  index: number;
  kind: FitsHduKind;
  name?: string | undefined;
  header: FitsHeader;
  image?: FitsImageData | undefined;
  table?: FitsTableData | undefined;
  /** Raw byte offset in binary FITS stream (if decoded from binary). */
  byteOffset?: number | undefined;
  /** Raw data payload byte length before 2880-byte padding. */
  rawDataBytes?: number | undefined;
}

export interface FitsDocument {
  uri?: string | undefined;
  hdus: FitsHdu[];
  /** Total binary byte length if parsed from a binary FITS buffer. */
  binaryByteLength?: number | undefined;
  /** True if parsed from a binary 2880-byte FITS stream. */
  isBinary: boolean;
}

export type WcsProjectionType = "TAN" | "SIN" | "ARC";

export interface FitsWcsParams {
  ctype1: string;
  ctype2: string;
  projection: WcsProjectionType;
  /** Reference pixel coordinates (1-based FITS convention). */
  crpix1: number;
  crpix2: number;
  /** Reference celestial coordinates (J2000 degrees: RA, Dec). */
  crval1: number;
  crval2: number;
  /** 2x2 Jacobian CD matrix (deg/pixel). */
  cd1_1: number;
  cd1_2: number;
  cd2_1: number;
  cd2_2: number;
  /** Native pole longitude (deg, default 180 for zenithal projections). */
  lonpole?: number | undefined;
  /** Native pole latitude (deg, default 0). */
  latpole?: number | undefined;
  /** Coordinate equinox (e.g., 2000.0). */
  equinox?: number | undefined;
}

export interface CelestialCoord {
  /** Right Ascension in degrees [0, 360). */
  raDeg: number;
  /** Declination in degrees [-90, 90]. */
  decDeg: number;
}

export interface PixelCoord {
  /** 1-based FITS X pixel coordinate. */
  x: number;
  /** 1-based FITS Y pixel coordinate. */
  y: number;
}

export interface ImageStatistics {
  count: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  stdDev: number;
  /** Sigma-clipped background mean. */
  clippedMean: number;
  /** Sigma-clipped background RMS. */
  clippedRms: number;
  /** Number of pixels retained after sigma clipping. */
  clippedCount: number;
}

export interface AperturePhotometryResult {
  cx: number;
  cy: number;
  apertureRadius: number;
  skyInnerRadius: number;
  skyOuterRadius: number;
  /** Total raw sum inside aperture. */
  grossFlux: number;
  /** Background-subtracted net source flux. */
  netFlux: number;
  /** Estimated sky background per pixel. */
  skyPerPixel: number;
  /** Background RMS per pixel in sky annulus. */
  skyRms: number;
  /** Number of pixels inside source aperture. */
  aperturePixels: number;
  /** Number of pixels inside sky annulus. */
  skyPixels: number;
  /** Signal-to-noise ratio estimate. */
  snr: number;
  /** Instrumental magnitude (-2.5 * log10(netFlux) + zeroPoint). */
  magnitude: number;
}

export interface FitsSourceRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface FitsDiagnostic {
  code: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  range: FitsSourceRange;
  hduIndex: number;
}
