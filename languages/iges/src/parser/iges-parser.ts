// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/iges — Fixed 80-Column IGES 5.3 Parser & Serializer.
 *
 * Parses Start (S), Global (G with Hollerith strings), Directory Entry (D, 2-line 8-char fields),
 * Parameter Data (P, multi-line continuation + Fortran D-exponent), and Terminate (T) sections.
 */

import { IgesErrorCode } from "../errors.js";
import type {
  IgesCircularArcEntity,
  IgesCompositeCurveEntity,
  IgesConicArcEntity,
  IgesCopiousDataEntity,
  IgesCurveOnSurfaceEntity,
  IgesDirectoryEntry,
  IgesDocument,
  IgesEntity,
  IgesGenericEntity,
  IgesGlobalParams,
  IgesLineEntity,
  IgesManifoldSolidBRepEntity,
  IgesNurbsCurveEntity,
  IgesNurbsSurfaceEntity,
  IgesParameterRecord,
  IgesParseIssue,
  IgesPlaneEntity,
  IgesPointEntity,
  IgesRawLine,
  IgesSectionCode,
  IgesSectionCounts,
  IgesSurfaceOfRevolutionEntity,
  IgesTabulatedCylinderEntity,
  IgesTerminateSection,
  IgesTransformMatrixEntity,
  IgesTrimmedSurfaceEntity,
  Point3D,
} from "../types.js";
import { IGES_UNIT_NAMES } from "../types.js";

const VALID_SECTIONS = new Set<string>(["S", "G", "D", "P", "T"]);
const SECTION_ORDER: Record<IgesSectionCode, number> = { S: 0, G: 1, D: 2, P: 3, T: 4 };

/**
 * Parse a numeric IGES value (supports Fortran `D`/`d` exponent notation).
 */
export function parseIgesNumber(raw: string | undefined, fallback = 0): number {
  if (!raw) return fallback;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return fallback;
  const normalized = trimmed.replace(/[dD]/g, "e");
  const val = Number(normalized);
  return Number.isFinite(val) ? val : fallback;
}

/**
 * Parse an integer IGES field (8-char fixed field or P-section parameter).
 */
export function parseIgesInt(raw: string | undefined, fallback = 0): number {
  if (!raw) return fallback;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return fallback;
  const val = parseInt(trimmed, 10);
  return Number.isNaN(val) ? fallback : val;
}

/**
 * Parse a Hollerith string (`nH<n chars>`).
 * Returns `{ value, valid, error }` where `value` is the decoded text.
 */
export function parseHollerith(raw: string): { value: string; valid: boolean; error?: string } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { value: "", valid: true };
  }
  const hIdx = trimmed.indexOf("H");
  if (hIdx <= 0) {
    return { value: trimmed, valid: false, error: "missing 'nH' Hollerith prefix" };
  }
  const countStr = trimmed.slice(0, hIdx);
  if (!/^\d+$/.test(countStr)) {
    return { value: trimmed, valid: false, error: `non-numeric Hollerith length '${countStr}'` };
  }
  const declaredLen = parseInt(countStr, 10);
  const body = trimmed.slice(hIdx + 1);
  if (body.length !== declaredLen) {
    return {
      value: body,
      valid: false,
      error: `declared length ${declaredLen} does not match actual length ${body.length}`,
    };
  }
  return { value: body, valid: true };
}

/**
 * Tokenize an IGES Global or Parameter Data string into fields, respecting Hollerith strings `nH...`
 * so parameter delimiters inside Hollerith text are not split.
 */
export function splitIgesRecordFields(
  text: string,
  paramDelim: string,
  recordDelim: string,
  issues: IgesParseIssue[],
  lineNumber: number,
): string[] {
  const fields: string[] = [];
  let i = 0;
  const len = text.length;

  while (i < len) {
    // Skip leading whitespace before a token
    while (i < len && (text[i] === " " || text[i] === "\t")) {
      i++;
    }
    if (i >= len) break;

    if (text[i] === recordDelim) {
      break;
    }

    if (text[i] === paramDelim) {
      fields.push("");
      i++;
      continue;
    }

    // Check for Hollerith literal: digits followed by 'H'
    const hollerithMatch = /^(\d+)H/.exec(text.slice(i));
    if (hollerithMatch && hollerithMatch[1]) {
      const count = parseInt(hollerithMatch[1], 10);
      const prefixLen = hollerithMatch[0].length;
      const bodyStart = i + prefixLen;
      const bodyEnd = bodyStart + count;

      if (bodyEnd > len) {
        const rawTok = text.slice(i).trim();
        issues.push({
          code: IgesErrorCode.INVALID_HOLLERITH_STRING.id,
          severity: "error",
          message: IgesErrorCode.INVALID_HOLLERITH_STRING.message(
            rawTok,
            `declared length ${count} exceeds remaining record length ${len - bodyStart}`,
          ),
          line: lineNumber,
        });
        fields.push(text.slice(i));
        break;
      }

      const token = text.slice(i, bodyEnd);
      fields.push(token);
      i = bodyEnd;

      // Advance to next delimiter, checking for stray characters
      while (i < len && (text[i] === " " || text[i] === "\t")) i++;
      if (i < len && text[i] === paramDelim) {
        i++;
      } else if (i < len && text[i] === recordDelim) {
        break;
      } else if (i < len) {
        // Extra characters after Hollerith string before delimiter -> Hollerith length mismatch
        let endIdx = i;
        while (endIdx < len && text[endIdx] !== paramDelim && text[endIdx] !== recordDelim) {
          endIdx++;
        }
        const badTok = token + text.slice(i, endIdx);
        issues.push({
          code: IgesErrorCode.INVALID_HOLLERITH_STRING.id,
          severity: "error",
          message: IgesErrorCode.INVALID_HOLLERITH_STRING.message(
            badTok.trim(),
            `trailing characters after ${count}H payload before delimiter`,
          ),
          line: lineNumber,
        });
        fields[fields.length - 1] = badTok;
        i = endIdx;
        if (i < len && text[i] === paramDelim) i++;
        else if (i < len && text[i] === recordDelim) break;
      }
      continue;
    }

    // Standard non-Hollerith field
    let endIdx = i;
    while (endIdx < len && text[endIdx] !== paramDelim && text[endIdx] !== recordDelim) {
      endIdx++;
    }
    fields.push(text.slice(i, endIdx).trim());
    i = endIdx;
    if (i < len && text[i] === paramDelim) {
      i++;
    } else if (i < len && text[i] === recordDelim) {
      break;
    }
  }

  return fields;
}

/**
 * Parse the IGES Global section text into structured `IgesGlobalParams`.
 */
function parseGlobalSection(
  globalLines: Array<{ data: string; lineNumber: number }>,
  issues: IgesParseIssue[],
): IgesGlobalParams | null {
  if (globalLines.length === 0) return null;

  const startLine = globalLines[0]!.lineNumber;
  const endLine = globalLines[globalLines.length - 1]!.lineNumber;
  const combined = globalLines.map((l) => l.data).join("");

  // Detect parameter delimiter (field 1) and record delimiter (field 2) per IGES 5.3 §2.2.4.2
  let paramDelim = ",";
  let recordDelim = ";";
  let cursor = 0;
  while (cursor < combined.length && combined[cursor] === " ") cursor++;

  if (combined.slice(cursor, cursor + 2) === "1H" && cursor + 2 < combined.length) {
    paramDelim = combined[cursor + 2]!;
    cursor += 3;
    if (combined[cursor] === paramDelim) cursor++;
  } else if (combined[cursor] === ",") {
    // Empty field 1 defaults to ','
    cursor++;
  }

  while (cursor < combined.length && combined[cursor] === " ") cursor++;
  if (combined.slice(cursor, cursor + 2) === "1H" && cursor + 2 < combined.length) {
    recordDelim = combined[cursor + 2]!;
    cursor += 3;
    if (combined[cursor] === paramDelim) cursor++;
  } else if (combined[cursor] === paramDelim) {
    // Empty field 2 defaults to ';'
    cursor++;
  }

  const remainingFields = splitIgesRecordFields(combined.slice(cursor), paramDelim, recordDelim, issues, startLine);
  const rawFields = [`1H${paramDelim}`, `1H${recordDelim}`, ...remainingFields];

  const decodeH = (idx: number): string => {
    const raw = rawFields[idx];
    if (!raw || raw.trim().length === 0) return "";
    const parsed = parseHollerith(raw);
    if (!parsed.valid) {
      // Only push if not already reported by splitIgesRecordFields
      const alreadyReported = issues.some(
        (iss) => iss.code === IgesErrorCode.INVALID_HOLLERITH_STRING.id && iss.message.includes(raw.trim()),
      );
      if (!alreadyReported) {
        issues.push({
          code: IgesErrorCode.INVALID_HOLLERITH_STRING.id,
          severity: "error",
          message: IgesErrorCode.INVALID_HOLLERITH_STRING.message(raw.trim(), parsed.error ?? "malformed"),
          line: startLine,
        });
      }
    }
    return parsed.value;
  };

  const unitFlag = parseIgesInt(rawFields[13], 1);
  const unitName = decodeH(14) || IGES_UNIT_NAMES[unitFlag] || "UNKNOWN";

  return {
    parameterDelimiter: paramDelim,
    recordDelimiter: recordDelim,
    productIdSender: decodeH(2),
    fileName: decodeH(3),
    nativeSystemId: decodeH(4),
    preprocessorVersion: decodeH(5),
    integerBits: parseIgesInt(rawFields[6], 32),
    singlePrecisionMag: parseIgesInt(rawFields[7], 38),
    singlePrecisionSig: parseIgesInt(rawFields[8], 6),
    doublePrecisionMag: parseIgesInt(rawFields[9], 308),
    doublePrecisionSig: parseIgesInt(rawFields[10], 15),
    productIdReceiver: decodeH(11),
    modelSpaceScale: parseIgesNumber(rawFields[12], 1.0),
    unitFlag,
    unitName,
    maxLineWeightGradations: parseIgesInt(rawFields[15], 1),
    maxLineWeight: parseIgesNumber(rawFields[16], 0.0),
    creationDate: decodeH(17),
    minResolution: parseIgesNumber(rawFields[18], 1e-6),
    maxCoordinate: parseIgesNumber(rawFields[19], 1000.0),
    authorName: decodeH(20),
    authorOrganization: decodeH(21),
    versionFlag: parseIgesInt(rawFields[22], 11),
    draftingStandardFlag: parseIgesInt(rawFields[23], 0),
    modifiedDate: decodeH(24),
    rawFields,
    startLine,
    endLine,
  };
}

/**
 * Decode a typed IGES entity from its Directory Entry and Parameter Data fields.
 */
function decodeEntity(de: IgesDirectoryEntry, paramRecord: IgesParameterRecord | undefined): IgesEntity {
  const fields = paramRecord?.fields ?? [];
  const base = {
    deNumber: de.deNumber,
    entityType: de.entityType,
    formNumber: de.formNumber,
    transformMatrixPointer: de.transformMatrixPointer,
    label: de.entityLabel,
    colorNumber: de.colorNumber,
    level: de.level,
    startLine: de.startLine,
    endLine: de.endLine,
  };

  switch (de.entityType) {
    case 100: {
      const entity: IgesCircularArcEntity = {
        ...base,
        entityType: 100,
        zt: parseIgesNumber(fields[1]),
        center: [parseIgesNumber(fields[2]), parseIgesNumber(fields[3])],
        start: [parseIgesNumber(fields[4]), parseIgesNumber(fields[5])],
        end: [parseIgesNumber(fields[6]), parseIgesNumber(fields[7])],
      };
      return entity;
    }

    case 102: {
      const n = parseIgesInt(fields[1]);
      const constituentPointers: number[] = [];
      for (let i = 0; i < n; i++) {
        constituentPointers.push(parseIgesInt(fields[2 + i]));
      }
      const entity: IgesCompositeCurveEntity = {
        ...base,
        entityType: 102,
        constituentPointers,
      };
      return entity;
    }

    case 104: {
      const entity: IgesConicArcEntity = {
        ...base,
        entityType: 104,
        a: parseIgesNumber(fields[1]),
        b: parseIgesNumber(fields[2]),
        c: parseIgesNumber(fields[3]),
        d: parseIgesNumber(fields[4]),
        e: parseIgesNumber(fields[5]),
        f: parseIgesNumber(fields[6]),
        zt: parseIgesNumber(fields[7]),
        start: [parseIgesNumber(fields[8]), parseIgesNumber(fields[9])],
        end: [parseIgesNumber(fields[10]), parseIgesNumber(fields[11])],
      };
      return entity;
    }

    case 106: {
      const ip = parseIgesInt(fields[1], 1);
      const n = parseIgesInt(fields[2], 0);
      const points: Point3D[] = [];
      if (ip === 1) {
        const zt = parseIgesNumber(fields[3], 0);
        for (let i = 0; i < n; i++) {
          points.push([parseIgesNumber(fields[4 + 2 * i]), parseIgesNumber(fields[5 + 2 * i]), zt]);
        }
      } else if (ip === 2) {
        for (let i = 0; i < n; i++) {
          points.push([
            parseIgesNumber(fields[3 + 3 * i]),
            parseIgesNumber(fields[4 + 3 * i]),
            parseIgesNumber(fields[5 + 3 * i]),
          ]);
        }
      } else {
        for (let i = 0; i < n; i++) {
          points.push([
            parseIgesNumber(fields[3 + 6 * i]),
            parseIgesNumber(fields[4 + 6 * i]),
            parseIgesNumber(fields[5 + 6 * i]),
          ]);
        }
      }
      const entity: IgesCopiousDataEntity = {
        ...base,
        entityType: 106,
        interpretationFlag: ip,
        points,
      };
      return entity;
    }

    case 108: {
      const entity: IgesPlaneEntity = {
        ...base,
        entityType: 108,
        a: parseIgesNumber(fields[1]),
        b: parseIgesNumber(fields[2]),
        c: parseIgesNumber(fields[3]),
        d: parseIgesNumber(fields[4]),
        boundingCurvePointer: parseIgesInt(fields[5]),
        displaySymbolLocation: [parseIgesNumber(fields[6]), parseIgesNumber(fields[7]), parseIgesNumber(fields[8])],
        displaySymbolSize: parseIgesNumber(fields[9]),
      };
      return entity;
    }

    case 110: {
      const entity: IgesLineEntity = {
        ...base,
        entityType: 110,
        start: [parseIgesNumber(fields[1]), parseIgesNumber(fields[2]), parseIgesNumber(fields[3])],
        end: [parseIgesNumber(fields[4]), parseIgesNumber(fields[5]), parseIgesNumber(fields[6])],
      };
      return entity;
    }

    case 116: {
      const entity: IgesPointEntity = {
        ...base,
        entityType: 116,
        point: [parseIgesNumber(fields[1]), parseIgesNumber(fields[2]), parseIgesNumber(fields[3])],
        displaySymbolPointer: parseIgesInt(fields[4]),
      };
      return entity;
    }

    case 120: {
      const entity: IgesSurfaceOfRevolutionEntity = {
        ...base,
        entityType: 120,
        axisPointer: parseIgesInt(fields[1]),
        generatrixPointer: parseIgesInt(fields[2]),
        startAngle: parseIgesNumber(fields[3]),
        endAngle: parseIgesNumber(fields[4], 2 * Math.PI),
      };
      return entity;
    }

    case 122: {
      const entity: IgesTabulatedCylinderEntity = {
        ...base,
        entityType: 122,
        directrixPointer: parseIgesInt(fields[1]),
        directionEnd: [parseIgesNumber(fields[2]), parseIgesNumber(fields[3]), parseIgesNumber(fields[4])],
      };
      return entity;
    }

    case 124: {
      const entity: IgesTransformMatrixEntity = {
        ...base,
        entityType: 124,
        rotation: [
          [parseIgesNumber(fields[1], 1), parseIgesNumber(fields[2], 0), parseIgesNumber(fields[3], 0)],
          [parseIgesNumber(fields[5], 0), parseIgesNumber(fields[6], 1), parseIgesNumber(fields[7], 0)],
          [parseIgesNumber(fields[9], 0), parseIgesNumber(fields[10], 0), parseIgesNumber(fields[11], 1)],
        ],
        translation: [parseIgesNumber(fields[4], 0), parseIgesNumber(fields[8], 0), parseIgesNumber(fields[12], 0)],
      };
      return entity;
    }

    case 126: {
      const k = parseIgesInt(fields[1], 0);
      const m = parseIgesInt(fields[2], 1);
      const planar = parseIgesInt(fields[3], 0) !== 0;
      const closed = parseIgesInt(fields[4], 0) !== 0;
      const polynomial = parseIgesInt(fields[5], 0) !== 0;
      const periodic = parseIgesInt(fields[6], 0) !== 0;

      const numKnots = k + m + 2; // N + 2M + 1 where N = 1 + K - M => K + M + 2
      const numCtrl = k + 1;
      let idx = 7;

      const knots: number[] = [];
      for (let i = 0; i < numKnots && idx < fields.length; i++, idx++) {
        knots.push(parseIgesNumber(fields[idx]));
      }

      const weights: number[] = [];
      for (let i = 0; i < numCtrl && idx < fields.length; i++, idx++) {
        weights.push(parseIgesNumber(fields[idx], 1));
      }

      const controlPoints: Point3D[] = [];
      for (let i = 0; i < numCtrl && idx + 2 < fields.length; i++, idx += 3) {
        controlPoints.push([
          parseIgesNumber(fields[idx]),
          parseIgesNumber(fields[idx + 1]),
          parseIgesNumber(fields[idx + 2]),
        ]);
      }

      const v0 = parseIgesNumber(fields[idx], knots[m] ?? 0);
      const v1 = parseIgesNumber(fields[idx + 1], knots[k + 1] ?? 1);
      const normal: Point3D = [
        parseIgesNumber(fields[idx + 2], 0),
        parseIgesNumber(fields[idx + 3], 0),
        parseIgesNumber(fields[idx + 4], 1),
      ];

      const entity: IgesNurbsCurveEntity = {
        ...base,
        entityType: 126,
        k,
        m,
        planar,
        closed,
        polynomial,
        periodic,
        knots,
        weights,
        controlPoints,
        v0,
        v1,
        normal,
      };
      return entity;
    }

    case 128: {
      const k1 = parseIgesInt(fields[1], 0);
      const k2 = parseIgesInt(fields[2], 0);
      const m1 = parseIgesInt(fields[3], 1);
      const m2 = parseIgesInt(fields[4], 1);
      const closedU = parseIgesInt(fields[5], 0) !== 0;
      const closedV = parseIgesInt(fields[6], 0) !== 0;
      const polynomial = parseIgesInt(fields[7], 0) !== 0;
      const periodicU = parseIgesInt(fields[8], 0) !== 0;
      const periodicV = parseIgesInt(fields[9], 0) !== 0;

      const numKnotsU = k1 + m1 + 2;
      const numKnotsV = k2 + m2 + 2;
      const numCtrl = (k1 + 1) * (k2 + 1);
      let idx = 10;

      const knotsU: number[] = [];
      for (let i = 0; i < numKnotsU && idx < fields.length; i++, idx++) {
        knotsU.push(parseIgesNumber(fields[idx]));
      }

      const knotsV: number[] = [];
      for (let i = 0; i < numKnotsV && idx < fields.length; i++, idx++) {
        knotsV.push(parseIgesNumber(fields[idx]));
      }

      const weights: number[] = [];
      for (let i = 0; i < numCtrl && idx < fields.length; i++, idx++) {
        weights.push(parseIgesNumber(fields[idx], 1));
      }

      const controlPoints: Point3D[] = [];
      for (let i = 0; i < numCtrl && idx + 2 < fields.length; i++, idx += 3) {
        controlPoints.push([
          parseIgesNumber(fields[idx]),
          parseIgesNumber(fields[idx + 1]),
          parseIgesNumber(fields[idx + 2]),
        ]);
      }

      const u0 = parseIgesNumber(fields[idx], knotsU[m1] ?? 0);
      const u1 = parseIgesNumber(fields[idx + 1], knotsU[k1 + 1] ?? 1);
      const v0 = parseIgesNumber(fields[idx + 2], knotsV[m2] ?? 0);
      const v1 = parseIgesNumber(fields[idx + 3], knotsV[k2 + 1] ?? 1);

      const entity: IgesNurbsSurfaceEntity = {
        ...base,
        entityType: 128,
        k1,
        k2,
        m1,
        m2,
        closedU,
        closedV,
        polynomial,
        periodicU,
        periodicV,
        knotsU,
        knotsV,
        weights,
        controlPoints,
        u0,
        u1,
        v0,
        v1,
      };
      return entity;
    }

    case 142: {
      const entity: IgesCurveOnSurfaceEntity = {
        ...base,
        entityType: 142,
        creationWay: parseIgesInt(fields[1]),
        surfacePointer: parseIgesInt(fields[2]),
        paramCurvePointer: parseIgesInt(fields[3]),
        modelCurvePointer: parseIgesInt(fields[4]),
        preference: parseIgesInt(fields[5]),
      };
      return entity;
    }

    case 144: {
      const nInner = parseIgesInt(fields[3], 0);
      const innerBoundaryPointers: number[] = [];
      for (let i = 0; i < nInner; i++) {
        innerBoundaryPointers.push(parseIgesInt(fields[5 + i]));
      }
      const entity: IgesTrimmedSurfaceEntity = {
        ...base,
        entityType: 144,
        surfacePointer: parseIgesInt(fields[1]),
        outerBoundaryType: parseIgesInt(fields[2]),
        outerBoundaryPointer: parseIgesInt(fields[4]),
        innerBoundaryPointers,
      };
      return entity;
    }

    case 186: {
      const outerShellPointer = parseIgesInt(fields[1]);
      const outerShellOrientation = parseIgesInt(fields[2], 1) !== 0;
      const nVoids = parseIgesInt(fields[3], 0);
      const voidShellPointers: number[] = [];
      const voidShellOrientations: boolean[] = [];
      for (let i = 0; i < nVoids; i++) {
        voidShellPointers.push(parseIgesInt(fields[4 + 2 * i]));
        voidShellOrientations.push(parseIgesInt(fields[5 + 2 * i], 1) !== 0);
      }
      const entity: IgesManifoldSolidBRepEntity = {
        ...base,
        entityType: 186,
        outerShellPointer,
        outerShellOrientation,
        voidShellPointers,
        voidShellOrientations,
      };
      return entity;
    }

    default: {
      const entity: IgesGenericEntity = {
        ...base,
        rawParams: fields.slice(1),
      };
      return entity;
    }
  }
}

/**
 * Parse an IGES 5.3 ASCII text string into an `IgesDocument`.
 */
export function parseIges(source: string): IgesDocument {
  const normalized = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  // Drop a single trailing empty line caused by final newline
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  const rawLines: IgesRawLine[] = [];
  const parseIssues: IgesParseIssue[] = [];
  const sectionCounts: IgesSectionCounts = { S: 0, G: 0, D: 0, P: 0, T: 0 };

  const startLines: string[] = [];
  const globalLines: Array<{ data: string; lineNumber: number }> = [];
  const dirLines: Array<{
    data: string;
    seq: number;
    lineNumber: number;
    startOffset: number;
    endOffset: number;
  }> = [];
  const paramLines: Array<{
    data: string;
    dePointer: number;
    seq: number;
    lineNumber: number;
  }> = [];
  let terminate: IgesTerminateSection | null = null;

  let lastSection: IgesSectionCode | null = null;
  let offset = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const lineNumber = i + 1;
    const startOffset = offset;
    const endOffset = offset + raw.length;
    offset = endOffset + 1; // +1 for '\n'

    if (raw.length === 0) {
      rawLines.push({
        lineNumber,
        raw,
        length: 0,
        sectionCode: null,
        sequenceNumber: null,
        startOffset,
        endOffset,
      });
      parseIssues.push({
        code: IgesErrorCode.SYNTAX_COLUMN_WIDTH.id,
        severity: "error",
        message: IgesErrorCode.SYNTAX_COLUMN_WIDTH.message(lineNumber, "empty line in 80-column IGES stream"),
        line: lineNumber,
        column: 1,
      });
      continue;
    }

    if (raw.length !== 80) {
      parseIssues.push({
        code: IgesErrorCode.SYNTAX_COLUMN_WIDTH.id,
        severity: "error",
        message: IgesErrorCode.SYNTAX_COLUMN_WIDTH.message(lineNumber, `expected 80 columns, got ${raw.length}`),
        line: lineNumber,
        column: Math.min(raw.length + 1, 73),
      });
    }

    const secChar = raw.length >= 73 ? raw[72]! : "";
    const sectionCode: IgesSectionCode | null = VALID_SECTIONS.has(secChar) ? (secChar as IgesSectionCode) : null;
    const seqStr = raw.length >= 74 ? raw.slice(73, 80).trim() : "";
    const sequenceNumber = /^\d+$/.test(seqStr) ? parseInt(seqStr, 10) : null;

    rawLines.push({
      lineNumber,
      raw,
      length: raw.length,
      sectionCode,
      sequenceNumber,
      startOffset,
      endOffset,
    });

    if (!sectionCode) {
      parseIssues.push({
        code: IgesErrorCode.SYNTAX_COLUMN_WIDTH.id,
        severity: "error",
        message: IgesErrorCode.SYNTAX_COLUMN_WIDTH.message(
          lineNumber,
          `invalid section code '${secChar || "<missing>"}' at column 73 (expected S, G, D, P, or T)`,
        ),
        line: lineNumber,
        column: 73,
      });
      continue;
    }

    if (lastSection !== null && SECTION_ORDER[sectionCode] < SECTION_ORDER[lastSection]) {
      parseIssues.push({
        code: IgesErrorCode.INVALID_SECTION_ORDER.id,
        severity: "error",
        message: IgesErrorCode.INVALID_SECTION_ORDER.message(sectionCode, lastSection),
        line: lineNumber,
        column: 73,
      });
    }
    lastSection = sectionCode;
    sectionCounts[sectionCode]++;

    const data72 = raw.slice(0, 72);

    switch (sectionCode) {
      case "S":
        startLines.push(data72.trimEnd());
        break;
      case "G":
        globalLines.push({ data: data72, lineNumber });
        break;
      case "D":
        dirLines.push({
          data: data72,
          seq: sequenceNumber ?? dirLines.length + 1,
          lineNumber,
          startOffset,
          endOffset,
        });
        break;
      case "P": {
        const data64 = raw.slice(0, 64);
        const dePtrStr = raw.slice(64, 72).trim();
        const dePointer = parseIgesInt(dePtrStr, 0);
        paramLines.push({
          data: data64,
          dePointer,
          seq: sequenceNumber ?? paramLines.length + 1,
          lineNumber,
        });
        break;
      }
      case "T": {
        const sCount = parseIgesInt(data72.slice(1, 8), 0);
        const gCount = parseIgesInt(data72.slice(9, 16), 0);
        const dCount = parseIgesInt(data72.slice(17, 24), 0);
        const pCount = parseIgesInt(data72.slice(25, 32), 0);
        terminate = {
          startCount: sCount,
          globalCount: gCount,
          directoryCount: dCount,
          parameterCount: pCount,
          lineNumber,
        };
        break;
      }
    }
  }

  // Parse Global Section
  const global = parseGlobalSection(globalLines, parseIssues);
  const paramDelim = global?.parameterDelimiter ?? ",";
  const recordDelim = global?.recordDelimiter ?? ";";

  // Parse Directory Entries (2-line pairs)
  const directoryEntries = new Map<number, IgesDirectoryEntry>();
  for (let i = 0; i < dirLines.length; i += 2) {
    const l1 = dirLines[i]!;
    const l2 = dirLines[i + 1];
    const deNumber = l1.seq;

    const f1 = (idx: number): string => l1.data.slice(idx * 8, (idx + 1) * 8);
    const f2 = (idx: number): string => (l2 ? l2.data.slice(idx * 8, (idx + 1) * 8) : "");

    const entityType = parseIgesInt(f1(0), 0);
    const entityTypeLine2 = l2 ? parseIgesInt(f2(0), 0) : entityType;

    const entry: IgesDirectoryEntry = {
      deNumber,
      entityType,
      entityTypeLine2,
      parameterDataPointer: parseIgesInt(f1(1), 0),
      structure: parseIgesInt(f1(2), 0),
      lineFontPattern: parseIgesInt(f1(3), 0),
      level: parseIgesInt(f1(4), 0),
      view: parseIgesInt(f1(5), 0),
      transformMatrixPointer: parseIgesInt(f1(6), 0),
      labelDisplayAssoc: parseIgesInt(f1(7), 0),
      statusNumber: f1(8).trim(),
      lineWeightNumber: parseIgesInt(f2(1), 0),
      colorNumber: parseIgesInt(f2(2), 0),
      parameterLineCount: parseIgesInt(f2(3), 1),
      formNumber: parseIgesInt(f2(4), 0),
      entityLabel: f2(7).trim(),
      entitySubscript: parseIgesInt(f2(8), 0),
      startLine: l1.lineNumber,
      endLine: l2 ? l2.lineNumber : l1.lineNumber,
      startOffset: l1.startOffset,
      endOffset: l2 ? l2.endOffset : l1.endOffset,
      incomplete: !l2,
    };

    directoryEntries.set(deNumber, entry);
  }

  // Group Parameter Data lines by DE pointer
  const parameterRecords = new Map<number, IgesParameterRecord>();
  const groupedParams = new Map<number, { chunks: string[]; startLine: number; endLine: number }>();
  for (const pl of paramLines) {
    const existing = groupedParams.get(pl.dePointer);
    if (existing) {
      existing.chunks.push(pl.data);
      existing.endLine = pl.lineNumber;
    } else {
      groupedParams.set(pl.dePointer, {
        chunks: [pl.data],
        startLine: pl.lineNumber,
        endLine: pl.lineNumber,
      });
    }
  }

  for (const [dePointer, group] of groupedParams) {
    const rawText = group.chunks.join("");
    const fields = splitIgesRecordFields(rawText, paramDelim, recordDelim, parseIssues, group.startLine);
    const entityType = parseIgesInt(fields[0], 0);
    parameterRecords.set(dePointer, {
      dePointer,
      entityType,
      rawText,
      fields,
      startLine: group.startLine,
      endLine: group.endLine,
    });
  }

  // Decode Entities
  const entities: IgesEntity[] = [];
  const entitiesByDe = new Map<number, IgesEntity>();
  for (const [deNum, de] of directoryEntries) {
    const prec = parameterRecords.get(deNum);
    const entity = decodeEntity(de, prec);
    entities.push(entity);
    entitiesByDe.set(deNum, entity);
  }

  return {
    startLines,
    global,
    directoryEntries,
    parameterRecords,
    entities,
    entitiesByDe,
    terminate,
    sectionCounts,
    rawLines,
    parseIssues,
  };
}

/**
 * Format a single 80-column IGES record line.
 */
export function formatIgesLine(data72: string, section: IgesSectionCode, seq: number): string {
  const paddedData = data72.length > 72 ? data72.slice(0, 72) : data72.padEnd(72, " ");
  const seqStr = String(seq).padStart(7, " ");
  return `${paddedData}${section}${seqStr}`;
}

/**
 * Format a Hollerith string `nH<text>`.
 */
export function formatHollerith(text: string): string {
  return `${text.length}H${text}`;
}

function padField8(val: number | string): string {
  const s = String(val);
  return s.length > 8 ? s.slice(0, 8) : s.padStart(8, " ");
}

export interface IgesBuilderEntityInput {
  entityType: number;
  params: Array<number | string>;
  formNumber?: number;
  transformMatrixPointer?: number;
  label?: string;
  colorNumber?: number;
  level?: number;
}

export interface IgesBuildOptions {
  startComment?: string;
  fileName?: string;
  productId?: string;
  author?: string;
  organization?: string;
  unitFlag?: number;
  entities: IgesBuilderEntityInput[];
}

/**
 * Construct a spec-compliant 80-column IGES 5.3 ASCII file from structured entity inputs.
 */
export function buildIgesFile(options: IgesBuildOptions): string {
  const lines: string[] = [];

  // Start section
  const startText = options.startComment ?? "ModelScript IGES 5.3 Generated File";
  lines.push(formatIgesLine(startText, "S", 1));
  const sCount = 1;

  // Global section
  const unitFlag = options.unitFlag ?? 6; // meters default
  const unitName = IGES_UNIT_NAMES[unitFlag] ?? "M";
  const globalFields = [
    "1H,",
    "1H;",
    formatHollerith(options.productId ?? "ModelScript"),
    formatHollerith(options.fileName ?? "model.igs"),
    formatHollerith("ModelScript-CAD"),
    formatHollerith("ModelScript 1.0"),
    "32",
    "38",
    "6",
    "308",
    "15",
    formatHollerith(options.productId ?? "ModelScript"),
    "1.0",
    String(unitFlag),
    formatHollerith(unitName),
    "1",
    "0.0",
    formatHollerith("20260101.000000"),
    "1.0E-6",
    "1000.0",
    formatHollerith(options.author ?? "ModelScript"),
    formatHollerith(options.organization ?? "ModelScript"),
    "11",
    "0",
    formatHollerith("20260101.000000"),
  ];
  const globalPayload = globalFields.join(",") + ";";
  let gCount = 0;
  for (let i = 0; i < globalPayload.length; i += 72) {
    gCount++;
    lines.push(formatIgesLine(globalPayload.slice(i, i + 72), "G", gCount));
  }

  // Build Parameter Data first so we know P-line pointers and counts
  const pLines: string[] = [];
  const dLines: string[] = [];
  let pSeq = 0;
  let dSeq = 0;

  for (const ent of options.entities) {
    const deNum = dSeq + 1;
    const pStart = pSeq + 1;
    const pText = [String(ent.entityType), ...ent.params.map((p) => String(p))].join(",") + ";";

    let pLineCount = 0;
    for (let i = 0; i < pText.length; i += 64) {
      pSeq++;
      pLineCount++;
      const chunk = pText.slice(i, i + 64).padEnd(64, " ");
      const dePtr = padField8(deNum);
      pLines.push(formatIgesLine(chunk + dePtr, "P", pSeq));
    }

    // DE Line 1
    dSeq++;
    const deLine1 =
      padField8(ent.entityType) +
      padField8(pStart) +
      padField8(0) +
      padField8(1) +
      padField8(ent.level ?? 0) +
      padField8(0) +
      padField8(ent.transformMatrixPointer ?? 0) +
      padField8(0) +
      "00000000";
    dLines.push(formatIgesLine(deLine1, "D", dSeq));

    // DE Line 2
    dSeq++;
    const deLine2 =
      padField8(ent.entityType) +
      padField8(0) +
      padField8(ent.colorNumber ?? 0) +
      padField8(pLineCount) +
      padField8(ent.formNumber ?? 0) +
      padField8("") +
      padField8("") +
      padField8(ent.label ?? "") +
      padField8(0);
    dLines.push(formatIgesLine(deLine2, "D", dSeq));
  }

  lines.push(...dLines, ...pLines);

  // Terminate section
  const termData =
    `S${String(sCount).padStart(7, "0")}` +
    `G${String(gCount).padStart(7, "0")}` +
    `D${String(dSeq).padStart(7, "0")}` +
    `P${String(pSeq).padStart(7, "0")}`;
  lines.push(formatIgesLine(termData, "T", 1));

  return lines.join("\n") + "\n";
}
