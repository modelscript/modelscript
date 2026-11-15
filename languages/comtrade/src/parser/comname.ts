// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * IEEE C37.232-2011 (COMNAME) Standard Time-Sequence & Event File Naming Parser/Builder.
 *
 * Format:
 *   StartDate,StartTime,TimeCode,StationName,DeviceId,CompanyName,[OptionalUserFields...].ext
 * Example:
 *   2026-11-14,13-45-00-123,-5T,SPRINGFIELD_345,DFR_01,CITY_UTILITIES.cfg
 */

export interface ComnameComponents {
  startDate: string; // YYYY-MM-DD or YYMMDD
  startTime: string; // HH-MM-SS-mmm
  timeCode: string; // e.g. -5T, 0Z, +0
  stationName: string;
  deviceId: string;
  companyName: string;
  userFields: string[];
  extension: string;
}

/**
 * Parses an IEEE C37.232 COMNAME-compliant filename into its structured fields.
 */
export function parseComname(fileName: string): ComnameComponents {
  const baseName = fileName.split(/[\\/]/).pop() ?? fileName;
  const dotIdx = baseName.lastIndexOf(".");
  const stem = dotIdx > 0 ? baseName.slice(0, dotIdx) : baseName;
  const extension = dotIdx > 0 ? baseName.slice(dotIdx + 1) : "";

  const parts = stem.split(",");
  if (parts.length < 6) {
    throw new Error(
      `Invalid IEEE C37.232 COMNAME '${baseName}': expected at least 6 comma-separated fields (StartDate,StartTime,TimeCode,Station,Device,Company).`,
    );
  }

  return {
    startDate: parts[0]!.trim(),
    startTime: parts[1]!.trim(),
    timeCode: parts[2]!.trim(),
    stationName: parts[3]!.trim(),
    deviceId: parts[4]!.trim(),
    companyName: parts[5]!.trim(),
    userFields: parts.slice(6).map((p) => p.trim()),
    extension,
  };
}

/**
 * Formats structured metadata into an IEEE C37.232 COMNAME filename.
 */
export function formatComname(c: ComnameComponents): string {
  const fields = [c.startDate, c.startTime, c.timeCode, c.stationName, c.deviceId, c.companyName, ...c.userFields];
  const ext = c.extension.startsWith(".") ? c.extension : c.extension ? `.${c.extension}` : "";
  return `${fields.join(",")}${ext}`;
}
