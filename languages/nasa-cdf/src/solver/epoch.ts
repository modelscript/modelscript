// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nasa-cdf — CDF_EPOCH & CDF_TIME_TT2000 Time Conversion Solver.
 *
 * Implements NASA SPDF CDF time standards:
 * - `CDF_EPOCH`: IEEE-754 float64 milliseconds since `0000-01-01T00:00:00.000Z`
 *   (Unix epoch `1970-01-01T00:00:00.000Z` = `62167219200000.0` ms;
 *    J2000.0 UTC `2000-01-01T12:00:00.000Z` = `63113947200000.0` ms).
 * - `CDF_TIME_TT2000`: Signed 64-bit integer nanoseconds since J2000.0 TT
 *   (`2000-01-01T12:00:00.000000000 TT` = `2000-01-01T11:58:55.816000000 UTC`),
 *   incorporating the IERS UTC leap-second table (`TT = TAI + 32.184 s`).
 */

/** CDF_EPOCH milliseconds at Unix epoch 1970-01-01T00:00:00.000Z (719528 days). */
export const CDF_EPOCH_UNIX_OFFSET_MS = 62_167_219_200_000.0;

/** Unix milliseconds at J2000.0 UTC (2000-01-01T12:00:00.000Z). */
export const J2000_UTC_UNIX_MS = Date.UTC(2000, 0, 1, 12, 0, 0, 0); // 946728000000

/** CDF_EPOCH milliseconds at J2000.0 UTC (2000-01-01T12:00:00.000Z). */
export const CDF_EPOCH_J2000_UTC_MS = CDF_EPOCH_UNIX_OFFSET_MS + J2000_UTC_UNIX_MS; // 63113947200000.0

/** Terrestrial Time offset from TAI in milliseconds (32.184 s). */
export const TT_MINUS_TAI_MS = 32_184;

/**
 * Official IERS leap-second table: `[unixMsAtEffectiveDate, taiMinusUtcSeconds]`.
 */
const LEAP_SECOND_TABLE: ReadonlyArray<readonly [number, number]> = [
  [Date.UTC(1972, 0, 1), 10],
  [Date.UTC(1972, 6, 1), 11],
  [Date.UTC(1973, 0, 1), 12],
  [Date.UTC(1974, 0, 1), 13],
  [Date.UTC(1975, 0, 1), 14],
  [Date.UTC(1976, 0, 1), 15],
  [Date.UTC(1977, 0, 1), 16],
  [Date.UTC(1978, 0, 1), 17],
  [Date.UTC(1979, 0, 1), 18],
  [Date.UTC(1980, 0, 1), 19],
  [Date.UTC(1981, 6, 1), 20],
  [Date.UTC(1982, 6, 1), 21],
  [Date.UTC(1983, 6, 1), 22],
  [Date.UTC(1985, 6, 1), 23],
  [Date.UTC(1988, 0, 1), 24],
  [Date.UTC(1990, 0, 1), 25],
  [Date.UTC(1991, 0, 1), 26],
  [Date.UTC(1992, 6, 1), 27],
  [Date.UTC(1993, 6, 1), 28],
  [Date.UTC(1994, 6, 1), 29],
  [Date.UTC(1996, 0, 1), 30],
  [Date.UTC(1997, 6, 1), 31],
  [Date.UTC(1999, 0, 1), 32],
  [Date.UTC(2006, 0, 1), 33],
  [Date.UTC(2009, 0, 1), 34],
  [Date.UTC(2012, 6, 1), 35],
  [Date.UTC(2015, 6, 1), 36],
  [Date.UTC(2017, 0, 1), 37],
];

/**
 * Returns `TAI - UTC` in seconds for a given Unix millisecond timestamp.
 */
export function getTaiMinusUtcSeconds(unixMs: number): number {
  let offset = 10;
  for (const [effectiveMs, sec] of LEAP_SECOND_TABLE) {
    if (unixMs >= effectiveMs) {
      offset = sec;
    } else {
      break;
    }
  }
  return offset;
}

/**
 * Converts Unix milliseconds (since 1970-01-01T00:00:00.000Z) to `CDF_EPOCH` milliseconds.
 */
export function unixMsToCdfEpoch(unixMs: number): number {
  return unixMs + CDF_EPOCH_UNIX_OFFSET_MS;
}

/**
 * Converts `CDF_EPOCH` milliseconds to Unix milliseconds.
 */
export function cdfEpochToUnixMs(cdfEpochMs: number): number {
  return cdfEpochMs - CDF_EPOCH_UNIX_OFFSET_MS;
}

/**
 * Parses an ISO-8601 or CDF Skeleton Table epoch string (e.g. `2025-03-15T12:00:00.000Z`
 * or `15-Mar-2025 12:00:00.000`) to `CDF_EPOCH` milliseconds.
 */
export function isoToCdfEpoch(timestamp: string): number {
  const trimmed = timestamp.trim();
  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed) ? `${trimmed}Z` : trimmed;
  const unixMs = Date.parse(normalized);
  if (!Number.isFinite(unixMs)) {
    throw new Error(`Invalid CDF epoch timestamp: '${timestamp}'`);
  }
  return unixMsToCdfEpoch(unixMs);
}

/**
 * Formats a `CDF_EPOCH` millisecond value as an ISO-8601 UTC string.
 */
export function cdfEpochToIso(cdfEpochMs: number): string {
  const unixMs = cdfEpochToUnixMs(cdfEpochMs);
  return new Date(unixMs).toISOString();
}

/**
 * Converts `CDF_EPOCH` milliseconds to seconds elapsed since J2000.0 UTC (`2000-01-01T12:00:00.000Z`).
 */
export function cdfEpochToJ2000Seconds(cdfEpochMs: number): number {
  return (cdfEpochMs - CDF_EPOCH_J2000_UTC_MS) / 1000.0;
}

/**
 * Converts seconds since J2000.0 UTC to `CDF_EPOCH` milliseconds.
 */
export function j2000SecondsToCdfEpoch(j2000Sec: number): number {
  return CDF_EPOCH_J2000_UTC_MS + j2000Sec * 1000.0;
}

/**
 * Converts `CDF_EPOCH` milliseconds to `CDF_TIME_TT2000` (signed 64-bit nanoseconds since J2000.0 TT).
 */
export function cdfEpochToTt2000(cdfEpochMs: number): bigint {
  const unixMs = cdfEpochToUnixMs(cdfEpochMs);
  const taiMinusUtcMs = getTaiMinusUtcSeconds(unixMs) * 1000;
  const ttMinusUtcMs = taiMinusUtcMs + TT_MINUS_TAI_MS;
  const deltaFromJ2000Ms = unixMs - J2000_UTC_UNIX_MS + ttMinusUtcMs;
  return BigInt(Math.round(deltaFromJ2000Ms)) * 1_000_000n;
}

/**
 * Converts `CDF_TIME_TT2000` (nanoseconds since J2000.0 TT) to `CDF_EPOCH` milliseconds.
 */
export function tt2000ToCdfEpoch(tt2000Ns: bigint): number {
  const ttMsFromJ2000 = Number(tt2000Ns) / 1_000_000.0;
  // Two-step fixed-point iteration to resolve the leap-second bucket at UTC
  let approxUnixMs = J2000_UTC_UNIX_MS + ttMsFromJ2000 - (37_000 + TT_MINUS_TAI_MS);
  for (let i = 0; i < 3; i++) {
    const ttMinusUtcMs = getTaiMinusUtcSeconds(approxUnixMs) * 1000 + TT_MINUS_TAI_MS;
    approxUnixMs = J2000_UTC_UNIX_MS + ttMsFromJ2000 - ttMinusUtcMs;
  }
  return unixMsToCdfEpoch(approxUnixMs);
}

/**
 * Converts `CDF_TIME_TT2000` (nanoseconds since J2000.0 TT) to an ISO-8601 UTC string.
 */
export function tt2000ToIso(tt2000Ns: bigint): string {
  return cdfEpochToIso(tt2000ToCdfEpoch(tt2000Ns));
}

/**
 * Attempts to convert a raw record value (numeric `CDF_EPOCH`, `CDF_TIME_TT2000`, or ISO string)
 * into `CDF_EPOCH` milliseconds for uniform time-series plotting and monotonicity checking.
 */
export function parseTimeValueToCdfEpoch(value: number | string, dataType: string): number | undefined {
  if (typeof value === "string") {
    try {
      return isoToCdfEpoch(value);
    } catch {
      const asNum = Number(value);
      if (Number.isFinite(asNum)) {
        return dataType === "CDF_TIME_TT2000" ? tt2000ToCdfEpoch(BigInt(Math.round(asNum))) : asNum;
      }
      return undefined;
    }
  }
  if (!Number.isFinite(value)) return undefined;
  if (dataType === "CDF_TIME_TT2000") {
    return tt2000ToCdfEpoch(BigInt(Math.round(value)));
  }
  return value;
}
