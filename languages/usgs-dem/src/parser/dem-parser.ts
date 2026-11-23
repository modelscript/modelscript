// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Parser and serializer for USGS Digital Elevation Model (DEM) ASCII Terrain Format.
 *
 * Supports:
 * 1. Fixed 1024-byte column-aligned USGS DEM records (Data Users Guide 5, 1970s–1980s)
 * 2. Keyword-tagged free-format ASCII DEM (`TYPE_A`, `TYPE_B`, `TYPE_C`)
 * 3. Whitespace-delimited classic ASCII DEM streams
 */

import type {
  DemCorner,
  DemFormatKind,
  UsgsDemAccuracy,
  UsgsDemGrid,
  UsgsDemHeader,
  UsgsDemModel,
  UsgsDemProfile,
  UsgsDemSyntaxError,
} from "../types.js";

const VOID_ELEVATION = -32767;

function parseFortranNumber(raw: string, fallback = Number.NaN): number {
  const cleaned = raw.trim().replace(/[dD]/g, "E");
  if (!cleaned) return fallback;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

function parseFortranInt(raw: string, fallback = 0): number {
  const n = parseFortranNumber(raw, Number.NaN);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function defaultCorners(
  x0: number,
  y0: number,
  width: number,
  height: number,
): [DemCorner, DemCorner, DemCorner, DemCorner] {
  return [
    { x: x0, y: y0 },
    { x: x0, y: y0 + height },
    { x: x0 + width, y: y0 + height },
    { x: x0 + width, y: y0 },
  ];
}

function createEmptyHeader(): UsgsDemHeader {
  return {
    quadrangleName: "UNTITLED",
    freeFormatText: "",
    processCode: "1",
    sectionalIndicator: "",
    originCode: "USGS",
    demLevelCode: 1,
    elevationPattern: 1,
    groundRefSystem: 1,
    groundRefZone: 13,
    projectionParams: new Array<number>(15).fill(0),
    planimetricUnits: 2,
    elevationUnits: 2,
    polygonSides: 4,
    corners: defaultCorners(0, 0, 0, 0),
    minElevation: 0,
    maxElevation: 0,
    angleRad: 0,
    accuracyCode: 0,
    spatialResolution: { dx: 30, dy: 30, dz: 1 },
    rows: 1,
    cols: 0,
    line: 1,
    startOffset: 0,
    endOffset: 0,
  };
}

/**
 * Detect whether input text is a fixed-column 1024-byte USGS DEM record stream.
 */
function isFixedColumnDem(text: string): boolean {
  const firstNewline = text.indexOf("\n");
  const firstLineLen = firstNewline === -1 ? text.length : firstNewline;
  // Standard fixed-column Type A has >= 864 characters (typically 1024 bytes) before first record break
  // and does not start with keyword TYPE_A
  if (/^\s*TYPE_A\b/i.test(text)) return false;
  return firstLineLen >= 864;
}

function parseFixedTypeA(block: string): UsgsDemHeader {
  const slice = (start: number, end: number): string => block.slice(start, end);
  const quadrangleName = slice(0, 40).trim() || "UNTITLED";
  const freeFormatText = slice(40, 80).trim();
  const processCode = slice(135, 136).trim() || "1";
  const sectionalIndicator = slice(137, 140).trim();
  const originCode = slice(140, 144).trim() || "USGS";
  const demLevelCode = parseFortranInt(slice(144, 150), 1);
  const elevationPattern = parseFortranInt(slice(150, 156), 1);
  const groundRefSystem = parseFortranInt(slice(156, 162), 1);
  const groundRefZone = parseFortranInt(slice(162, 168), 0);

  const projectionParams: number[] = [];
  for (let i = 0; i < 15; i++) {
    projectionParams.push(parseFortranNumber(slice(168 + i * 24, 168 + (i + 1) * 24), 0));
  }

  const planimetricUnits = parseFortranInt(slice(528, 534), 2);
  const elevationUnits = parseFortranInt(slice(534, 540), 2);
  const polygonSides = parseFortranInt(slice(540, 546), 4);

  const cornerList: DemCorner[] = [];
  for (let i = 0; i < 4; i++) {
    const cx = parseFortranNumber(slice(546 + i * 48, 546 + i * 48 + 24), 0);
    const cy = parseFortranNumber(slice(546 + i * 48 + 24, 546 + (i + 1) * 48), 0);
    cornerList.push({ x: cx, y: cy });
  }

  const minElevation = parseFortranNumber(slice(738, 762), 0);
  const maxElevation = parseFortranNumber(slice(762, 786), 0);
  const angleRad = parseFortranNumber(slice(786, 810), 0);
  const accuracyCode = parseFortranInt(slice(810, 816), 0);
  const dx = parseFortranNumber(slice(816, 828), 30);
  const dy = parseFortranNumber(slice(828, 840), 30);
  const dz = parseFortranNumber(slice(840, 852), 1);
  const rows = parseFortranInt(slice(852, 858), 1);
  const cols = parseFortranInt(slice(858, 864), 0);

  const vDatumRaw = slice(890, 892).trim();
  const hDatumRaw = slice(892, 894).trim();
  const verticalDatum = vDatumRaw ? parseFortranInt(vDatumRaw, 0) : undefined;
  const horizontalDatum = hDatumRaw ? parseFortranInt(hDatumRaw, 0) : undefined;

  return {
    quadrangleName,
    freeFormatText,
    processCode,
    sectionalIndicator,
    originCode,
    demLevelCode,
    elevationPattern,
    groundRefSystem,
    groundRefZone,
    projectionParams,
    planimetricUnits,
    elevationUnits,
    polygonSides,
    corners: [cornerList[0]!, cornerList[1]!, cornerList[2]!, cornerList[3]!],
    minElevation,
    maxElevation,
    angleRad,
    accuracyCode,
    spatialResolution: { dx, dy, dz },
    rows,
    cols,
    verticalDatum,
    horizontalDatum,
    line: 1,
    startOffset: 0,
    endOffset: Math.min(block.length, 1024),
  };
}

function parseFixedFormatDem(text: string): {
  header: UsgsDemHeader;
  profiles: UsgsDemProfile[];
  accuracy?: UsgsDemAccuracy | undefined;
  syntaxErrors: UsgsDemSyntaxError[];
} {
  const syntaxErrors: UsgsDemSyntaxError[] = [];
  const hasNewlines = text.includes("\n");
  let records: Array<{ content: string; line: number; startOffset: number; endOffset: number }>;

  if (hasNewlines) {
    records = [];
    const lines = text.split(/\r?\n/);
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i]!;
      const endOffset = offset + lineText.length;
      if (lineText.trim().length > 0) {
        records.push({ content: lineText, line: i + 1, startOffset: offset, endOffset });
      }
      offset = endOffset + 1;
    }
  } else {
    // Pure 1024-byte logical records without newlines
    records = [];
    for (let off = 0; off < text.length; off += 1024) {
      const chunk = text.slice(off, off + 1024);
      if (chunk.trim().length > 0) {
        records.push({
          content: chunk,
          line: Math.floor(off / 1024) + 1,
          startOffset: off,
          endOffset: Math.min(off + 1024, text.length),
        });
      }
    }
  }

  if (records.length === 0) {
    syntaxErrors.push({ message: "Empty USGS DEM input", line: 1, column: 1 });
    return { header: createEmptyHeader(), profiles: [], syntaxErrors };
  }

  const header = parseFixedTypeA(records[0]!.content);
  const dz = header.spatialResolution.dz || 1;
  const profiles: UsgsDemProfile[] = [];
  let accuracy: UsgsDemAccuracy | undefined;

  let idx = 1;
  const expectedCols = header.cols > 0 ? header.cols : records.length - 1;

  while (idx < records.length) {
    const rec = records[idx]!;
    // If we have already read expectedCols profiles and accuracyCode === 1, parse Type C
    if (header.accuracyCode === 1 && profiles.length >= expectedCols) {
      const tokens = rec.content
        .trim()
        .split(/\s+/)
        .map((t) => parseFortranInt(t, 0));
      if (tokens.length >= 10) {
        accuracy = {
          availabilityDatum: tokens[0]!,
          rmseDatum: [tokens[1]!, tokens[2]!, tokens[3]!],
          sampleSizeDatum: tokens[4]!,
          availabilityDem: tokens[5]!,
          rmseDem: [tokens[6]!, tokens[7]!, tokens[8]!],
          sampleSizeDem: tokens[9]!,
          line: rec.line,
          startOffset: rec.startOffset,
          endOffset: rec.endOffset,
        };
      }
      idx++;
      break;
    }

    // Parse Type B profile header + elevations
    const tokens = rec.content.trim().split(/\s+/);
    if (tokens.length < 9) {
      syntaxErrors.push({
        message: `Malformed Type B profile header at line ${rec.line}: expected at least 9 fields`,
        line: rec.line,
        column: 1,
      });
      idx++;
      continue;
    }

    const rowIndex = parseFortranInt(tokens[0]!, 1);
    const colIndex = parseFortranInt(tokens[1]!, profiles.length + 1);
    const numRows = parseFortranInt(tokens[2]!, 0);
    const numCols = parseFortranInt(tokens[3]!, 1);
    const xOrigin = parseFortranNumber(tokens[4]!, 0);
    const yOrigin = parseFortranNumber(tokens[5]!, 0);
    const localDatumElevation = parseFortranNumber(tokens[6]!, 0);
    const minElevation = parseFortranNumber(tokens[7]!, 0);
    const maxElevation = parseFortranNumber(tokens[8]!, 0);

    const rawElevations: number[] = [];
    for (let t = 9; t < tokens.length; t++) {
      const v = parseFortranNumber(tokens[t]!, Number.NaN);
      if (Number.isFinite(v)) rawElevations.push(v);
    }

    let endOffset = rec.endOffset;
    idx++;
    // Continuation records for long profiles (> 146 samples)
    while (rawElevations.length < numRows && idx < records.length) {
      const cont = records[idx]!;
      const contTokens = cont.content.trim().split(/\s+/);
      for (const ct of contTokens) {
        const v = parseFortranNumber(ct, Number.NaN);
        if (Number.isFinite(v)) rawElevations.push(v);
      }
      endOffset = cont.endOffset;
      idx++;
    }

    const elevations = rawElevations.map((r) => (r === VOID_ELEVATION ? VOID_ELEVATION : r * dz + localDatumElevation));

    profiles.push({
      rowIndex,
      colIndex,
      numRows,
      numCols,
      xOrigin,
      yOrigin,
      localDatumElevation,
      minElevation,
      maxElevation,
      rawElevations,
      elevations,
      line: rec.line,
      startOffset: rec.startOffset,
      endOffset,
    });
  }

  return { header, profiles, accuracy, syntaxErrors };
}

function parseFreeFormatDem(text: string): {
  header: UsgsDemHeader;
  profiles: UsgsDemProfile[];
  accuracy?: UsgsDemAccuracy | undefined;
  syntaxErrors: UsgsDemSyntaxError[];
} {
  const syntaxErrors: UsgsDemSyntaxError[] = [];
  const header = createEmptyHeader();
  const profiles: UsgsDemProfile[] = [];
  let accuracy: UsgsDemAccuracy | undefined;

  const lines = text.split(/\r?\n/);
  let offset = 0;
  let seenTypeA = false;
  let activeProfile: UsgsDemProfile | null = null;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;
    const lineNo = i + 1;
    const startOffset = offset;
    const endOffset = offset + rawLine.length;
    offset = endOffset + 1;

    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;

    if (/^TYPE_A\b/i.test(trimmed)) {
      seenTypeA = true;
      header.line = lineNo;
      header.startOffset = startOffset;
      header.endOffset = endOffset;

      const nameMatch = trimmed.match(/TYPE_A\s+(?:"([^"]*)"|'([^']*)'|([A-Za-z0-9_.-]+))/i);
      if (nameMatch) {
        header.quadrangleName = (nameMatch[1] ?? nameMatch[2] ?? nameMatch[3] ?? "UNTITLED").trim();
      }

      const kvRegex = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*("[^"]*"|'[^']*'|[^\s,]+)/g;
      let m: RegExpExecArray | null;
      while ((m = kvRegex.exec(trimmed)) !== null) {
        const key = m[1]!.toUpperCase();
        const rawVal = m[2]!.replace(/^["']|["']$/g, "");
        const numVal = parseFortranNumber(rawVal, Number.NaN);
        switch (key) {
          case "NAME":
          case "QUAD":
          case "QUADRANGLE":
            header.quadrangleName = rawVal;
            break;
          case "DESC":
          case "TEXT":
            header.freeFormatText = rawVal;
            break;
          case "ORIGIN":
            header.originCode = rawVal;
            break;
          case "LEVEL":
            if (Number.isFinite(numVal)) header.demLevelCode = Math.trunc(numVal);
            break;
          case "PATTERN":
            if (Number.isFinite(numVal)) header.elevationPattern = Math.trunc(numVal);
            break;
          case "REF":
          case "GREF":
          case "CRS":
            if (Number.isFinite(numVal)) header.groundRefSystem = Math.trunc(numVal);
            break;
          case "ZONE":
            if (Number.isFinite(numVal)) header.groundRefZone = Math.trunc(numVal);
            break;
          case "UNITS":
          case "XYUNITS":
            if (Number.isFinite(numVal)) header.planimetricUnits = Math.trunc(numVal);
            break;
          case "ZUNITS":
          case "ELEVUNITS":
            if (Number.isFinite(numVal)) header.elevationUnits = Math.trunc(numVal);
            break;
          case "DX":
            if (Number.isFinite(numVal)) header.spatialResolution.dx = numVal;
            break;
          case "DY":
            if (Number.isFinite(numVal)) header.spatialResolution.dy = numVal;
            break;
          case "DZ":
            if (Number.isFinite(numVal)) header.spatialResolution.dz = numVal;
            break;
          case "MINZ":
            if (Number.isFinite(numVal)) header.minElevation = numVal;
            break;
          case "MAXZ":
            if (Number.isFinite(numVal)) header.maxElevation = numVal;
            break;
          case "ANGLE":
            if (Number.isFinite(numVal)) header.angleRad = numVal;
            break;
          case "ACCURACY":
            if (Number.isFinite(numVal)) header.accuracyCode = Math.trunc(numVal);
            break;
          case "NROWS":
          case "ROWS":
            if (Number.isFinite(numVal)) header.rows = Math.trunc(numVal);
            break;
          case "NCOLS":
          case "COLS":
            if (Number.isFinite(numVal)) header.cols = Math.trunc(numVal);
            break;
          case "HDATUM":
            if (Number.isFinite(numVal)) header.horizontalDatum = Math.trunc(numVal);
            break;
          case "VDATUM":
            if (Number.isFinite(numVal)) header.verticalDatum = Math.trunc(numVal);
            break;
          default:
            break;
        }
      }
      activeProfile = null;
      continue;
    }

    if (/^TYPE_B\b/i.test(trimmed)) {
      const rest = trimmed.replace(/^TYPE_B\b\s*/i, "");
      const [hdrPart, samplesPart] = rest.split(":");
      const hdrTokens = (hdrPart ?? "")
        .trim()
        .split(/[\s,]+/)
        .filter(Boolean);
      if (hdrTokens.length < 9) {
        syntaxErrors.push({
          message: `TYPE_B record at line ${lineNo} requires 9 header fields (row col m n x0 y0 datum minZ maxZ)`,
          line: lineNo,
          column: 1,
        });
        continue;
      }

      const dz = header.spatialResolution.dz || 1;
      const rowIndex = parseFortranInt(hdrTokens[0]!, 1);
      const colIndex = parseFortranInt(hdrTokens[1]!, profiles.length + 1);
      const numRows = parseFortranInt(hdrTokens[2]!, 0);
      const numCols = parseFortranInt(hdrTokens[3]!, 1);
      const xOrigin = parseFortranNumber(hdrTokens[4]!, 0);
      const yOrigin = parseFortranNumber(hdrTokens[5]!, 0);
      const localDatumElevation = parseFortranNumber(hdrTokens[6]!, 0);
      const minElevation = parseFortranNumber(hdrTokens[7]!, 0);
      const maxElevation = parseFortranNumber(hdrTokens[8]!, 0);

      const rawElevations: number[] = [];
      const inlineTokens = samplesPart
        ? samplesPart
            .trim()
            .split(/[\s,]+/)
            .filter(Boolean)
        : hdrTokens.slice(9);
      for (const t of inlineTokens) {
        const v = parseFortranNumber(t, Number.NaN);
        if (Number.isFinite(v)) {
          rawElevations.push(v);
        } else {
          syntaxErrors.push({
            message: `Invalid elevation token '${t}' in TYPE_B profile ${colIndex}`,
            line: lineNo,
            column: 1,
          });
        }
      }

      const elevations = rawElevations.map((r) =>
        r === VOID_ELEVATION ? VOID_ELEVATION : r * dz + localDatumElevation,
      );
      const profile: UsgsDemProfile = {
        rowIndex,
        colIndex,
        numRows,
        numCols,
        xOrigin,
        yOrigin,
        localDatumElevation,
        minElevation,
        maxElevation,
        rawElevations,
        elevations,
        line: lineNo,
        startOffset,
        endOffset,
      };
      profiles.push(profile);
      activeProfile = rawElevations.length < numRows ? profile : null;
      continue;
    }

    if (/^TYPE_C\b/i.test(trimmed)) {
      const rest = trimmed.replace(/^TYPE_C\b\s*/i, "");
      const tokens = rest
        .trim()
        .split(/[\s,]+/)
        .filter(Boolean);
      if (tokens.length < 10) {
        syntaxErrors.push({
          message: `TYPE_C record at line ${lineNo} requires 10 numeric fields`,
          line: lineNo,
          column: 1,
        });
        continue;
      }
      accuracy = {
        availabilityDatum: parseFortranInt(tokens[0]!, 0),
        rmseDatum: [
          parseFortranNumber(tokens[1]!, 0),
          parseFortranNumber(tokens[2]!, 0),
          parseFortranNumber(tokens[3]!, 0),
        ],
        sampleSizeDatum: parseFortranInt(tokens[4]!, 0),
        availabilityDem: parseFortranInt(tokens[5]!, 0),
        rmseDem: [
          parseFortranNumber(tokens[6]!, 0),
          parseFortranNumber(tokens[7]!, 0),
          parseFortranNumber(tokens[8]!, 0),
        ],
        sampleSizeDem: parseFortranInt(tokens[9]!, 0),
        line: lineNo,
        startOffset,
        endOffset,
      };
      activeProfile = null;
      continue;
    }

    // Continuation elevation values for an open TYPE_B profile
    if (activeProfile) {
      const dz = header.spatialResolution.dz || 1;
      const tokens = trimmed.split(/[\s,]+/).filter(Boolean);
      for (const t of tokens) {
        const v = parseFortranNumber(t, Number.NaN);
        if (Number.isFinite(v)) {
          activeProfile.rawElevations.push(v);
          activeProfile.elevations.push(
            v === VOID_ELEVATION ? VOID_ELEVATION : v * dz + activeProfile.localDatumElevation,
          );
        } else {
          syntaxErrors.push({
            message: `Invalid elevation token '${t}' on continuation line ${lineNo}`,
            line: lineNo,
            column: 1,
          });
        }
      }
      activeProfile.endOffset = endOffset;
      if (activeProfile.rawElevations.length >= activeProfile.numRows) {
        activeProfile = null;
      }
      continue;
    }

    syntaxErrors.push({
      message: `Unrecognized USGS DEM record at line ${lineNo}: '${trimmed.slice(0, 32)}'`,
      line: lineNo,
      column: 1,
    });
  }

  if (!seenTypeA) {
    syntaxErrors.push({
      message: "Missing USGS DEM Type A header record",
      line: 1,
      column: 1,
    });
  }

  // Recompute bounding corners if not explicitly provided in free-format header
  if (profiles.length > 0) {
    const first = profiles[0]!;
    const last = profiles[profiles.length - 1]!;
    const maxRows = Math.max(...profiles.map((p) => p.elevations.length), 1);
    const width = Math.max(0, last.xOrigin - first.xOrigin);
    const height = Math.max(0, (maxRows - 1) * Math.max(header.spatialResolution.dy, 0));
    header.corners = defaultCorners(first.xOrigin, first.yOrigin, width, height);
  }

  return { header, profiles, accuracy, syntaxErrors };
}

function buildGrid(header: UsgsDemHeader, profiles: UsgsDemProfile[]): UsgsDemGrid {
  const numCols = profiles.length;
  const numRows = numCols > 0 ? Math.max(...profiles.map((p) => p.elevations.length), 0) : 0;
  const dx = header.spatialResolution.dx;
  const dy = header.spatialResolution.dy;
  const dz = header.spatialResolution.dz;
  const xOrigin = numCols > 0 ? profiles[0]!.xOrigin : header.corners[0].x;
  const yOrigin = numCols > 0 ? Math.min(...profiles.map((p) => p.yOrigin)) : header.corners[0].y;

  const z = new Float64Array(numCols * numRows);
  z.fill(VOID_ELEVATION);

  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (let c = 0; c < numCols; c++) {
    const prof = profiles[c]!;
    for (let r = 0; r < prof.elevations.length; r++) {
      const val = prof.elevations[r]!;
      z[r * numCols + c] = val;
      if (val !== VOID_ELEVATION) {
        if (val < minZ) minZ = val;
        if (val > maxZ) maxZ = val;
      }
    }
  }

  if (!Number.isFinite(minZ)) minZ = header.minElevation;
  if (!Number.isFinite(maxZ)) maxZ = header.maxElevation;

  return {
    numCols,
    numRows,
    dx,
    dy,
    dz,
    xOrigin,
    yOrigin,
    minZ,
    maxZ,
    voidValue: VOID_ELEVATION,
    z,
  };
}

/**
 * Parse a USGS Digital Elevation Model (DEM) ASCII text into a structured `UsgsDemModel`.
 */
export function parseUsgsDem(text: string): UsgsDemModel {
  const format: DemFormatKind = isFixedColumnDem(text) ? "fixed-1024" : "free-format";
  const parsed = format === "fixed-1024" ? parseFixedFormatDem(text) : parseFreeFormatDem(text);
  const grid = buildGrid(parsed.header, parsed.profiles);
  return {
    header: parsed.header,
    profiles: parsed.profiles,
    accuracy: parsed.accuracy,
    format,
    grid,
    syntaxErrors: parsed.syntaxErrors,
  };
}

function padRight(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + " ".repeat(len - s.length);
}

function padLeft(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : " ".repeat(len - s.length) + s;
}

function fmtD24(n: number): string {
  return padLeft(n.toExponential(15).replace("e", "D"), 24);
}

function fmtE12(n: number): string {
  return padLeft(n.toExponential(5).toUpperCase(), 12);
}

function fmtI6(n: number): string {
  return padLeft(String(Math.trunc(n)), 6);
}

/**
 * Serialize a `UsgsDemModel` into either 1024-byte fixed-column USGS DEM format or free-format ASCII.
 */
export function serializeUsgsDem(model: UsgsDemModel, format: DemFormatKind = "free-format"): string {
  const h = model.header;
  if (format === "free-format") {
    const lines: string[] = [];
    lines.push(
      `TYPE_A "${h.quadrangleName}" LEVEL=${h.demLevelCode} PATTERN=${h.elevationPattern} REF=${h.groundRefSystem} ZONE=${h.groundRefZone} UNITS=${h.planimetricUnits} ZUNITS=${h.elevationUnits} DX=${h.spatialResolution.dx} DY=${h.spatialResolution.dy} DZ=${h.spatialResolution.dz} MINZ=${h.minElevation} MAXZ=${h.maxElevation} ACCURACY=${h.accuracyCode} NROWS=${h.rows} NCOLS=${h.cols}`,
    );
    for (const p of model.profiles) {
      const samples = p.rawElevations.join(" ");
      lines.push(
        `TYPE_B ${p.rowIndex} ${p.colIndex} ${p.numRows} ${p.numCols} ${p.xOrigin} ${p.yOrigin} ${p.localDatumElevation} ${p.minElevation} ${p.maxElevation} : ${samples}`,
      );
    }
    if (model.accuracy) {
      const a = model.accuracy;
      lines.push(
        `TYPE_C ${a.availabilityDatum} ${a.rmseDatum[0]} ${a.rmseDatum[1]} ${a.rmseDatum[2]} ${a.sampleSizeDatum} ${a.availabilityDem} ${a.rmseDem[0]} ${a.rmseDem[1]} ${a.rmseDem[2]} ${a.sampleSizeDem}`,
      );
    }
    return lines.join("\n") + "\n";
  }

  // Fixed 1024-byte column-aligned USGS DEM format
  const parts: string[] = [];
  let recA = "";
  recA += padRight(h.quadrangleName, 40);
  recA += padRight(h.freeFormatText, 40);
  recA += " ".repeat(55); // cols 81..135
  recA += padRight(h.processCode || "1", 1);
  recA += " "; // col 137
  recA += padRight(h.sectionalIndicator, 3);
  recA += padRight(h.originCode || "USGS", 4);
  recA += fmtI6(h.demLevelCode);
  recA += fmtI6(h.elevationPattern);
  recA += fmtI6(h.groundRefSystem);
  recA += fmtI6(h.groundRefZone);
  for (let i = 0; i < 15; i++) {
    recA += fmtD24(h.projectionParams[i] ?? 0);
  }
  recA += fmtI6(h.planimetricUnits);
  recA += fmtI6(h.elevationUnits);
  recA += fmtI6(h.polygonSides);
  for (let i = 0; i < 4; i++) {
    recA += fmtD24(h.corners[i]!.x);
    recA += fmtD24(h.corners[i]!.y);
  }
  recA += fmtD24(h.minElevation);
  recA += fmtD24(h.maxElevation);
  recA += fmtD24(h.angleRad);
  recA += fmtI6(h.accuracyCode);
  recA += fmtE12(h.spatialResolution.dx);
  recA += fmtE12(h.spatialResolution.dy);
  recA += fmtE12(h.spatialResolution.dz);
  recA += fmtI6(h.rows);
  recA += fmtI6(h.cols);
  recA = padRight(recA, 1024);
  parts.push(recA);

  for (const p of model.profiles) {
    let recB = "";
    recB += fmtI6(p.rowIndex);
    recB += fmtI6(p.colIndex);
    recB += fmtI6(p.numRows);
    recB += fmtI6(p.numCols);
    recB += fmtD24(p.xOrigin);
    recB += fmtD24(p.yOrigin);
    recB += fmtD24(p.localDatumElevation);
    recB += fmtD24(p.minElevation);
    recB += fmtD24(p.maxElevation);
    const firstChunk = p.rawElevations.slice(0, 146);
    for (const v of firstChunk) {
      recB += fmtI6(Math.round(v));
    }
    parts.push(padRight(recB, 1024));

    for (let i = 146; i < p.rawElevations.length; i += 170) {
      const chunk = p.rawElevations.slice(i, i + 170);
      let cont = "";
      for (const v of chunk) cont += fmtI6(Math.round(v));
      parts.push(padRight(cont, 1024));
    }
  }

  if (model.accuracy) {
    const a = model.accuracy;
    const recC =
      fmtI6(a.availabilityDatum) +
      fmtI6(a.rmseDatum[0]) +
      fmtI6(a.rmseDatum[1]) +
      fmtI6(a.rmseDatum[2]) +
      fmtI6(a.sampleSizeDatum) +
      fmtI6(a.availabilityDem) +
      fmtI6(a.rmseDem[0]) +
      fmtI6(a.rmseDem[1]) +
      fmtI6(a.rmseDem[2]) +
      fmtI6(a.sampleSizeDem);
    parts.push(padRight(recC, 1024));
  }

  return parts.join("\n") + "\n";
}
