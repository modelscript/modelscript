// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/grib — Core WMO GRIB Edition 1 TypeScript Interfaces.
 */

export interface GribSpan {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

/**
 * Section 0 — Indicator Section (IS, 8 octets in binary GRIB1).
 */
export interface GribIndicatorSection {
  /** Magic header string, must be "GRIB". */
  magic: string;
  /** Total length of the GRIB message in octets (bytes). */
  totalLength: number;
  /** GRIB Edition number (must be 1 for GRIB Edition 1). */
  edition: number;
  span?: GribSpan | undefined;
}

/**
 * Section 1 — Product Definition Section (PDS, >= 28 octets).
 */
export interface GribProductDefinitionSection {
  /** Parameter table version number (WMO Table 2, typically 2). */
  tableVersion: number;
  /** Identification of originating/generating center (WMO Table 0, e.g. 7 = US NCEP, 98 = ECMWF). */
  centerId: number;
  /** Generating process identification number. */
  generatingProcessId: number;
  /** Grid identification (255 = non-cataloged grid defined in GDS). */
  gridId: number;
  /** Section 2 (GDS) included flag (bit 7 of octet 8). */
  hasGds: boolean;
  /** Section 3 (BMS) included flag (bit 6 of octet 8). */
  hasBms: boolean;
  /** Indicator of parameter and units (WMO Table 2, 1..254). */
  parameterCode: number;
  /** Optional symbolic parameter mnemonic (e.g. "TMP", "HGT", "PRMSL", "UGRD", "VGRD"). */
  parameterName?: string | undefined;
  /** Indicator of type of level or layer (WMO Table 3, e.g. 1=SFC, 100=ISBL, 102=MSL, 105=TGL). */
  levelType: number;
  /** Optional symbolic level mnemonic (e.g. "ISBL", "MSL", "SFC", "TGL"). */
  levelName?: string | undefined;
  /** Height, pressure, etc. of the level (e.g. 500 for 500 hPa ISBL). */
  levelValue: number;
  /** Optional bottom level for layer types. */
  levelValue2?: number | undefined;
  /** Year of century (1..100) or full 4-digit year in textual descriptors. */
  year: number;
  /** Month of year (1..12). */
  month: number;
  /** Day of month (1..31). */
  day: number;
  /** Hour of day (0..23). */
  hour: number;
  /** Minute of hour (0..59). */
  minute: number;
  /** Forecast time unit (WMO Table 4: 0=min, 1=hour, 2=day). */
  timeUnit: number;
  /** Period of time P1 (forecast step). */
  p1: number;
  /** Period of time P2. */
  p2: number;
  /** Time range indicator (WMO Table 5). */
  timeRangeIndicator: number;
  /** Century of reference time (e.g. 20 for 1901-2000, 21 for 2001-2100). */
  century: number;
  /** Identification of sub-center. */
  subCenterId: number;
  /** Decimal scale factor D in Y = (R + X * 2^E) * 10^(-D). */
  decimalScaleFactor: number;
  span?: GribSpan | undefined;
}

/**
 * Section 2 — Grid Definition Section (GDS, Lat/Lon Equidistant Cylindrical = type 0).
 */
export interface GribGridDefinitionSection {
  /** Data representation type (WMO Table 6: 0 = Latitude/Longitude Grid). */
  dataRepresentationType: number;
  /** Number of points along a parallel (longitude / columns). */
  ni: number;
  /** Number of points along a meridian (latitude / rows). */
  nj: number;
  /** Latitude of first grid point in degrees (-90..90). */
  la1: number;
  /** Longitude of first grid point in degrees (-180..360). */
  lo1: number;
  /** Resolution and component flags (WMO Table 7, bit 7 = direction increments given). */
  resolutionFlags: number;
  /** Latitude of last grid point in degrees (-90..90). */
  la2: number;
  /** Longitude of last grid point in degrees (-180..360). */
  lo2: number;
  /** Longitudinal direction increment in degrees. */
  di: number;
  /** Latitudinal direction increment in degrees. */
  dj: number;
  /** Scanning mode flags (WMO Table 8). */
  scanningMode: number;
  span?: GribSpan | undefined;
}

/**
 * Section 3 — Bit-Map Section (BMS).
 */
export interface GribBitmapSection {
  /** Number of unused bits at end of bitmap. */
  unusedBits: number;
  /** Table reference (0 = bitmap follows in section). */
  tableReference: number;
  /** Per-grid-point presence mask (true = data present, false = missing). */
  bitmap: boolean[];
  span?: GribSpan | undefined;
}

/**
 * Section 4 — Binary Data Section (BDS).
 */
export interface GribBinaryDataSection {
  /** Data representation flags (high 4 bits of octet 4). */
  flags: number;
  /** Binary scale factor E in Y = (R + X * 2^E) * 10^(-D). */
  binaryScaleFactor: number;
  /** Reference value R (encoded as IBM System/360 32-bit float in binary GRIB1). */
  referenceValue: number;
  /** Number of bits per packed integer value X (0..32). */
  bitsPerValue: number;
  /** Unpacked physical grid values Y (or NaN for masked points when expanded). */
  values: number[];
  /** Optional raw integer packed values X prior to scaling. */
  packedValues?: number[] | undefined;
  span?: GribSpan | undefined;
}

/**
 * Section 5 — End Section (`7777`).
 */
export interface GribEndSection {
  magic: string;
  present: boolean;
  span?: GribSpan | undefined;
}

/**
 * A complete WMO GRIB Edition 1 message.
 */
export interface GribMessage {
  index: number;
  indicator: GribIndicatorSection;
  pds?: GribProductDefinitionSection | undefined;
  gds?: GribGridDefinitionSection | undefined;
  bms?: GribBitmapSection | undefined;
  bds?: GribBinaryDataSection | undefined;
  end: GribEndSection;
  /** Non-fatal parse warnings/errors attached during binary or textual decoding. */
  parseErrors?: string[] | undefined;
  /** True if a binary message was truncated before its declared totalLength. */
  truncated?: boolean | undefined;
  span?: GribSpan | undefined;
}

/**
 * Parsed GRIB Edition 1 document containing one or more messages.
 */
export interface GribDocument {
  uri?: string | undefined;
  isBinary: boolean;
  messages: GribMessage[];
  syntaxErrors: Array<{
    message: string;
    line: number;
    column: number;
  }>;
}

export type GribDiagnosticSeverity = "error" | "warning" | "info";

export interface GribDiagnostic {
  code: string;
  rule: string;
  severity: GribDiagnosticSeverity;
  message: string;
  messageIndex?: number | undefined;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

export interface GribWmoParameter {
  code: number;
  mnemonic: string;
  name: string;
  unit: string;
  minPlausible?: number | undefined;
  maxPlausible?: number | undefined;
  description: string;
}

export interface GribLevelType {
  code: number;
  mnemonic: string;
  name: string;
  unit: string;
  description: string;
}

export interface GribFieldStats {
  count: number;
  validCount: number;
  min: number;
  max: number;
  mean: number;
  stdDev: number;
  areaWeightedMean: number;
}

export interface GribHypsometricResult {
  /** Geopotential layer thickness Delta Z in meters. */
  thicknessMeters: number;
  /** Mean virtual temperature in Kelvin. */
  meanTemperatureK: number;
  /** Lower pressure boundary in Pa. */
  pBottomPa: number;
  /** Upper pressure boundary in Pa. */
  pTopPa: number;
  /** Atmospheric scale height H = R_d * T / g_0 in meters. */
  scaleHeightMeters: number;
}

export interface GribGeostrophicWindResult {
  /** Zonal (eastward) geostrophic wind u_g in m/s. */
  u: number;
  /** Meridional (northward) geostrophic wind v_g in m/s. */
  v: number;
  /** Wind speed magnitude sqrt(u^2 + v^2) in m/s. */
  speed: number;
  /** Meteorological wind direction (degrees clockwise from North, direction wind blows FROM). */
  directionDeg: number;
  /** Coriolis parameter f = 2 * Omega * sin(lat) in rad/s. */
  coriolisF: number;
}
