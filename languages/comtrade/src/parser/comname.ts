// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * IEEE C37.232-2011 (COMNAME) Standard Time-Sequence & Event File Naming Parser/Builder.
 *
 * Uses the @modelscript/comtrade WASM GLR parser CST for comma-separated field extraction
 * and deterministic character/numeric validation (no regexes).
 *
 * Format:
 *   StartDate,StartTime,TimeCode,StationName,DeviceId,CompanyName,[OptionalUserFields...].ext
 * Example:
 *   2026-11-14,13-45-00-123,-5T,SPRINGFIELD_345,DFR_01,CITY_UTILITIES.cfg
 */

import { createWasmParserSync } from "@modelscript/comtrade/wasm-parser";
import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { cstLineText, groupAllCstTokensByLine } from "@modelscript/runtime";
import type { ComtradeConfig } from "../types.js";

type CstToken = ReturnType<typeof groupAllCstTokensByLine>[number]["tokens"][number];

function getComtradeWasmParser() {
  return getOrLoadLanguageWasmParser("comtrade", import.meta.url, createWasmParserSync);
}

export interface ComnameComponents {
  startDate: string; // YYYY-MM-DD or YYMMDD
  startTime: string; // HH-MM-SS-mmm or HHMMSS[mmm]
  timeCode: string; // e.g. -5T, 0Z, +0
  stationName: string;
  deviceId: string;
  companyName: string;
  userFields: string[];
  extension: string;
}

export interface ComnameValidationResult {
  valid: boolean;
  errors: string[];
  components?: ComnameComponents | undefined;
}

/** Splits a CST token line into comma-separated fields using CST token boundaries. */
export function splitCstLineByComma(text: string, tokens: readonly CstToken[]): string[] {
  const fields: string[] = [];
  let currentStart = tokens[0]?.startIndex ?? 0;
  for (const tok of tokens) {
    const tokText = tok.text ?? text.slice(tok.startIndex, tok.endIndex);
    let searchFrom = 0;
    while (searchFrom < tokText.length) {
      const commaOffset = tokText.indexOf(",", searchFrom);
      if (commaOffset < 0) break;
      const absCommaStart = (tok.startIndex ?? currentStart) + commaOffset;
      fields.push(text.slice(currentStart, absCommaStart).trim());
      currentStart = absCommaStart + 1;
      searchFrom = commaOffset + 1;
    }
  }
  const lastEnd = tokens.length > 0 ? (tokens[tokens.length - 1]!.endIndex ?? text.length) : currentStart;
  fields.push(text.slice(currentStart, lastEnd).trim());
  return fields;
}

function isAllDigits(s: string): boolean {
  if (s.length === 0) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
}

function isValidCalendarDate(s: string): boolean {
  let month: number;
  let day: number;
  if (s.length === 6 && isAllDigits(s)) {
    month = Number.parseInt(s.slice(2, 4), 10);
    day = Number.parseInt(s.slice(4, 6), 10);
  } else if (s.length === 10 && s[4] === "-" && s[7] === "-") {
    const y = s.slice(0, 4);
    const m = s.slice(5, 7);
    const d = s.slice(8, 10);
    if (!isAllDigits(y) || !isAllDigits(m) || !isAllDigits(d)) return false;
    month = Number.parseInt(m, 10);
    day = Number.parseInt(d, 10);
  } else {
    return false;
  }
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

function isValidTimeOfDay(s: string): boolean {
  let hour: number;
  let min: number;
  let sec: number;
  if ((s.length === 6 || s.length === 9) && isAllDigits(s)) {
    hour = Number.parseInt(s.slice(0, 2), 10);
    min = Number.parseInt(s.slice(2, 4), 10);
    sec = Number.parseInt(s.slice(4, 6), 10);
  } else if (s.includes("-")) {
    const parts = s.split("-");
    if (parts.length < 3 || parts.length > 4) return false;
    if (parts[0]!.length !== 2 || parts[1]!.length !== 2 || parts[2]!.length !== 2) return false;
    if (!isAllDigits(parts[0]!) || !isAllDigits(parts[1]!) || !isAllDigits(parts[2]!)) return false;
    if (parts[3] !== undefined && (parts[3].length < 1 || parts[3].length > 6 || !isAllDigits(parts[3]))) {
      return false;
    }
    hour = Number.parseInt(parts[0]!, 10);
    min = Number.parseInt(parts[1]!, 10);
    sec = Number.parseInt(parts[2]!, 10);
  } else {
    return false;
  }
  return hour >= 0 && hour <= 23 && min >= 0 && min <= 59 && sec >= 0 && sec <= 59;
}

function isValidTimeCode(s: string): boolean {
  if (s.length === 0) return false;
  const last = s[s.length - 1]!.toUpperCase();
  const hasSuffix = last === "T" || last === "Z";
  const numPart = hasSuffix ? s.slice(0, -1) : s;
  if (numPart.length === 0) return false;
  const unsigned = numPart[0] === "+" || numPart[0] === "-" ? numPart.slice(1) : numPart;
  if (!isAllDigits(unsigned) || unsigned.length > 2) return false;
  const offset = Number.parseInt(numPart, 10);
  return offset >= -12 && offset <= 14;
}

function extractBaseName(filePath: string): string {
  const slashIdx = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return slashIdx >= 0 ? filePath.slice(slashIdx + 1) : filePath;
}

/**
 * Parses an IEEE C37.232 COMNAME-compliant filename using the WASM GLR parser CST.
 */
export function parseComname(fileName: string): ComnameComponents {
  const baseName = extractBaseName(fileName);
  const dotIdx = baseName.lastIndexOf(".");
  const stem = dotIdx > 0 ? baseName.slice(0, dotIdx) : baseName;
  const extension = dotIdx > 0 ? baseName.slice(dotIdx + 1) : "";

  const cstTree = getComtradeWasmParser().parse(stem);
  const cstLines = groupAllCstTokensByLine(cstTree?.rootNode);
  const parts =
    cstLines.length > 0
      ? splitCstLineByComma(stem, cstLines[0]!.tokens)
      : [cstLineText(stem, []).trim()].filter(Boolean);

  if (parts.length < 6) {
    throw new Error(
      `Invalid IEEE C37.232 COMNAME '${baseName}': expected at least 6 comma-separated fields (StartDate,StartTime,TimeCode,Station,Device,Company).`,
    );
  }

  return {
    startDate: parts[0]!,
    startTime: parts[1]!,
    timeCode: parts[2]!,
    stationName: parts[3]!,
    deviceId: parts[4]!,
    companyName: parts[5]!,
    userFields: parts.slice(6),
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

/**
 * Validates an IEEE C37.232 COMNAME filename against date, time, time-code, and required-field rules.
 */
export function validateComname(fileName: string): ComnameValidationResult {
  const errors: string[] = [];
  let components: ComnameComponents;
  try {
    components = parseComname(fileName);
  } catch (err) {
    return { valid: false, errors: [err instanceof Error ? err.message : String(err)] };
  }

  if (!isValidCalendarDate(components.startDate)) {
    errors.push(`Invalid COMNAME startDate '${components.startDate}' (expected YYMMDD or YYYY-MM-DD).`);
  }
  if (!isValidTimeOfDay(components.startTime)) {
    errors.push(`Invalid COMNAME startTime '${components.startTime}' (expected HHMMSS[mmm] or HH-MM-SS[-mmm]).`);
  }
  if (!isValidTimeCode(components.timeCode)) {
    errors.push(`Invalid COMNAME timeCode '${components.timeCode}' (expected e.g. -5T, 0Z, +0).`);
  }
  if (!components.stationName) errors.push("COMNAME stationName must not be empty.");
  if (!components.deviceId) errors.push("COMNAME deviceId must not be empty.");
  if (!components.companyName) errors.push("COMNAME companyName must not be empty.");

  return {
    valid: errors.length === 0,
    errors,
    components,
  };
}

/**
 * Cross-checks IEEE C37.232 COMNAME filename metadata against an IEEE C37.111 COMTRADE .cfg header.
 */
export function crossCheckComnameWithComtrade(comname: ComnameComponents, config: ComtradeConfig): string[] {
  const warnings: string[] = [];
  if (
    config.stationName &&
    comname.stationName &&
    config.stationName.toLowerCase() !== comname.stationName.toLowerCase()
  ) {
    warnings.push(
      `COMNAME stationName '${comname.stationName}' differs from COMTRADE .cfg stationName '${config.stationName}'.`,
    );
  }
  if (
    config.recordingDeviceId &&
    comname.deviceId &&
    config.recordingDeviceId.toLowerCase() !== comname.deviceId.toLowerCase()
  ) {
    warnings.push(
      `COMNAME deviceId '${comname.deviceId}' differs from COMTRADE .cfg recordingDeviceId '${config.recordingDeviceId}'.`,
    );
  }
  return warnings;
}
