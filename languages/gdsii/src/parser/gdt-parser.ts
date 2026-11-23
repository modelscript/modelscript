// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * GDSII GDT / ASCII Textual Stream Parser and Formatter.
 *
 * Parses standard GDSII ASCII stream records (`HEADER`, `BGNLIB`, `LIBNAME`, `UNITS`,
 * `BGNSTR`, `STRNAME`, `BOUNDARY`, `PATH`, `SREF`, `AREF`, `TEXT`, `LAYER`, `DATATYPE`,
 * `TEXTTYPE`, `PATHTYPE`, `WIDTH`, `XY`, `SNAME`, `STRANS`, `MAG`, `ANGLE`, `COLROW`,
 * `STRING`, `ENDEL`, `ENDSTR`, `ENDLIB`) into a structured `GdsiiLibrary`.
 */

import type {
  GdsiiBoundaryElement,
  GdsiiElement,
  GdsiiLibrary,
  GdsiiParseError,
  GdsiiPathElement,
  GdsiiPoint,
  GdsiiStrans,
  GdsiiStructure,
  GdsiiTextElement,
} from "../types.js";

function unquote(raw: string): string {
  const s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function parseNumberTokens(text: string): number[] {
  const cleaned = text.replace(/[,:;()[\]]/g, " ");
  const parts = cleaned.trim().split(/\s+/).filter(Boolean);
  const nums: number[] = [];
  for (const p of parts) {
    const n = Number(p);
    if (Number.isFinite(n)) nums.push(n);
  }
  return nums;
}

function parseStransValue(raw: string): GdsiiStrans {
  const trimmed = raw.trim();
  // Support 16-bit binary string e.g. "1000000000000000" or hex "0x8000" or integer
  let mask = 0;
  if (/^[01]{16}$/.test(trimmed)) {
    mask = Number.parseInt(trimmed, 2);
  } else if (/^0x[0-9a-fA-F]+$/.test(trimmed)) {
    mask = Number.parseInt(trimmed, 16);
  } else {
    const n = Number.parseInt(trimmed, 10);
    mask = Number.isFinite(n) ? n : 0;
  }
  return {
    reflectX: (mask & 0x8000) !== 0,
    absoluteMag: (mask & 0x0004) !== 0,
    absoluteAngle: (mask & 0x0002) !== 0,
    raw: mask,
  };
}

/**
 * Parses a GDSII GDT / ASCII textual stream into a `GdsiiLibrary`.
 */
export function parseGdsiiAscii(source: string): GdsiiLibrary {
  const library: GdsiiLibrary = {
    version: 600,
    name: "UNNAMED",
    units: { dbUnitInUserUnits: 1e-3, dbUnitInMeters: 1e-9 },
    structures: [],
  };
  const errors: GdsiiParseError[] = [];

  const lines = source.split(/\r?\n/);
  let currentStruct: GdsiiStructure | null = null;
  let currentEl: (Partial<GdsiiElement> & { kind?: GdsiiElement["kind"]; _xyBuf?: GdsiiPoint[] }) | null = null;
  let inXyContinuation = false;
  let offset = 0;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx]!;
    const lineNum = lineIdx + 1;
    const lineStartOffset = offset;
    offset += rawLine.length + 1;

    // Strip # or // comments (outside quotes)
    let stripped = rawLine;
    const commentIdx = stripped.search(/(?:^|\s)(?:#|\/\/)/);
    if (commentIdx >= 0) {
      stripped = stripped.slice(0, commentIdx);
    }
    const trimmed = stripped.trim();
    if (!trimmed) continue;

    // Check if this line is a pure coordinate continuation under XY
    if (inXyContinuation && /^[+-]?\d/.test(trimmed)) {
      const nums = parseNumberTokens(trimmed);
      if (currentEl?._xyBuf) {
        for (let i = 0; i + 1 < nums.length; i += 2) {
          currentEl._xyBuf.push({ x: nums[i]!, y: nums[i + 1]! });
        }
      }
      continue;
    }
    inXyContinuation = false;

    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*(.*)$/.exec(trimmed);
    if (!match) {
      errors.push({
        message: `Unrecognized GDSII stream syntax: '${trimmed}'`,
        line: lineNum,
        column: 1,
        offset: lineStartOffset,
      });
      continue;
    }

    const keyword = match[1]!.toUpperCase();
    const rest = match[2]!.trim();

    switch (keyword) {
      case "HEADER": {
        const nums = parseNumberTokens(rest);
        if (nums.length > 0) library.version = nums[0]!;
        break;
      }
      case "BGNLIB":
        break;
      case "LIBNAME":
        if (rest) library.name = unquote(rest.replace(/;$/, ""));
        break;
      case "UNITS": {
        const nums = parseNumberTokens(rest);
        if (nums.length >= 2) {
          library.units = {
            dbUnitInUserUnits: nums[0]!,
            dbUnitInMeters: nums[1]!,
          };
        } else {
          errors.push({
            message: `UNITS requires two numeric scale factors (dbUnitInUserUnits, dbUnitInMeters)`,
            line: lineNum,
            column: 1,
            offset: lineStartOffset,
          });
        }
        break;
      }
      case "BGNSTR": {
        if (currentStruct) {
          errors.push({
            message: `Nested BGNSTR encountered before ENDSTR for '${currentStruct.name}'`,
            line: lineNum,
            column: 1,
            offset: lineStartOffset,
          });
          library.structures.push(currentStruct);
        }
        currentStruct = {
          name: "UNNAMED_STR",
          elements: [],
          startOffset: lineStartOffset,
          line: lineNum,
        };
        break;
      }
      case "STRNAME": {
        if (!currentStruct) {
          errors.push({
            message: `STRNAME outside of BGNSTR..ENDSTR block`,
            line: lineNum,
            column: 1,
            offset: lineStartOffset,
          });
        } else if (rest) {
          currentStruct.name = unquote(rest.replace(/;$/, ""));
        }
        break;
      }
      case "ENDSTR": {
        if (!currentStruct) {
          errors.push({
            message: `Unexpected ENDSTR without matching BGNSTR`,
            line: lineNum,
            column: 1,
            offset: lineStartOffset,
          });
        } else {
          currentStruct.endOffset = lineStartOffset + rawLine.length;
          library.structures.push(currentStruct);
          currentStruct = null;
        }
        break;
      }
      case "ENDLIB":
        break;
      case "BOUNDARY":
        currentEl = {
          kind: "boundary",
          layer: 0,
          datatype: 0,
          xy: [],
          _xyBuf: [],
          startOffset: lineStartOffset,
          line: lineNum,
          column: 1,
        };
        break;
      case "PATH":
        currentEl = {
          kind: "path",
          layer: 0,
          datatype: 0,
          xy: [],
          _xyBuf: [],
          startOffset: lineStartOffset,
          line: lineNum,
          column: 1,
        };
        break;
      case "SREF":
        currentEl = {
          kind: "sref",
          sname: "",
          xy: { x: 0, y: 0 },
          _xyBuf: [],
          startOffset: lineStartOffset,
          line: lineNum,
          column: 1,
        };
        break;
      case "AREF":
        currentEl = {
          kind: "aref",
          sname: "",
          columns: 1,
          rows: 1,
          xy: [
            { x: 0, y: 0 },
            { x: 0, y: 0 },
            { x: 0, y: 0 },
          ],
          _xyBuf: [],
          startOffset: lineStartOffset,
          line: lineNum,
          column: 1,
        };
        break;
      case "TEXT":
        currentEl = {
          kind: "text",
          layer: 0,
          texttype: 0,
          xy: { x: 0, y: 0 },
          string: "",
          _xyBuf: [],
          startOffset: lineStartOffset,
          line: lineNum,
          column: 1,
        };
        break;
      case "LAYER": {
        const nums = parseNumberTokens(rest);
        if (currentEl && nums.length > 0 && "layer" in currentEl) {
          (currentEl as GdsiiBoundaryElement | GdsiiPathElement | GdsiiTextElement).layer = nums[0]!;
        }
        break;
      }
      case "DATATYPE": {
        const nums = parseNumberTokens(rest);
        if (currentEl && nums.length > 0 && (currentEl.kind === "boundary" || currentEl.kind === "path")) {
          currentEl.datatype = nums[0]!;
        }
        break;
      }
      case "TEXTTYPE": {
        const nums = parseNumberTokens(rest);
        if (currentEl && nums.length > 0 && currentEl.kind === "text") {
          currentEl.texttype = nums[0]!;
        }
        break;
      }
      case "PATHTYPE": {
        const nums = parseNumberTokens(rest);
        if (currentEl && nums.length > 0 && (currentEl.kind === "path" || currentEl.kind === "text")) {
          currentEl.pathtype = nums[0]!;
        }
        break;
      }
      case "WIDTH": {
        const nums = parseNumberTokens(rest);
        if (currentEl && nums.length > 0 && (currentEl.kind === "path" || currentEl.kind === "text")) {
          currentEl.width = nums[0]!;
        }
        break;
      }
      case "SNAME":
        if (currentEl && (currentEl.kind === "sref" || currentEl.kind === "aref")) {
          currentEl.sname = unquote(rest.replace(/;$/, ""));
        }
        break;
      case "STRANS":
        if (currentEl && (currentEl.kind === "sref" || currentEl.kind === "aref" || currentEl.kind === "text")) {
          currentEl.strans = parseStransValue(rest);
        }
        break;
      case "MAG": {
        const nums = parseNumberTokens(rest);
        if (
          currentEl &&
          nums.length > 0 &&
          (currentEl.kind === "sref" || currentEl.kind === "aref" || currentEl.kind === "text")
        ) {
          currentEl.mag = nums[0]!;
        }
        break;
      }
      case "ANGLE": {
        const nums = parseNumberTokens(rest);
        if (
          currentEl &&
          nums.length > 0 &&
          (currentEl.kind === "sref" || currentEl.kind === "aref" || currentEl.kind === "text")
        ) {
          currentEl.angle = nums[0]!;
        }
        break;
      }
      case "COLROW": {
        const nums = parseNumberTokens(rest);
        if (currentEl && currentEl.kind === "aref" && nums.length >= 2) {
          currentEl.columns = nums[0]!;
          currentEl.rows = nums[1]!;
        }
        break;
      }
      case "STRING":
        if (currentEl && currentEl.kind === "text") {
          currentEl.string = unquote(rest.replace(/;$/, ""));
        }
        break;
      case "XY": {
        inXyContinuation = true;
        const nums = parseNumberTokens(rest);
        if (currentEl?._xyBuf) {
          for (let i = 0; i + 1 < nums.length; i += 2) {
            currentEl._xyBuf.push({ x: nums[i]!, y: nums[i + 1]! });
          }
        }
        break;
      }
      case "ENDEL": {
        if (!currentStruct || !currentEl) {
          errors.push({
            message: `Unexpected ENDEL outside of element declaration`,
            line: lineNum,
            column: 1,
            offset: lineStartOffset,
          });
        } else {
          const pts = currentEl._xyBuf ?? [];
          delete currentEl._xyBuf;
          currentEl.endOffset = lineStartOffset + rawLine.length;

          if (currentEl.kind === "boundary" || currentEl.kind === "path") {
            currentEl.xy = pts;
          } else if (currentEl.kind === "sref" || currentEl.kind === "text") {
            currentEl.xy = pts[0] ?? { x: 0, y: 0 };
          } else if (currentEl.kind === "aref") {
            currentEl.xy = [pts[0] ?? { x: 0, y: 0 }, pts[1] ?? { x: 0, y: 0 }, pts[2] ?? { x: 0, y: 0 }];
          }
          currentStruct.elements.push(currentEl as GdsiiElement);
        }
        currentEl = null;
        break;
      }
      default:
        errors.push({
          message: `Unknown GDSII record keyword '${keyword}'`,
          line: lineNum,
          column: 1,
          offset: lineStartOffset,
        });
        break;
    }
  }

  if (currentEl) {
    errors.push({
      message: `Unterminated ${currentEl.kind?.toUpperCase() ?? "ELEMENT"} block (missing ENDEL)`,
      line: lines.length,
      column: 1,
    });
  }
  if (currentStruct) {
    errors.push({
      message: `Unterminated structure '${currentStruct.name}' (missing ENDSTR)`,
      line: lines.length,
      column: 1,
    });
    library.structures.push(currentStruct);
  }

  if (errors.length > 0) {
    library.parseErrors = errors;
  }

  return library;
}

/**
 * Formats a `GdsiiLibrary` back to canonical GDSII GDT / ASCII textual stream format.
 */
export function formatGdsiiAscii(library: GdsiiLibrary): string {
  const out: string[] = [];
  out.push(`HEADER ${library.version}`);
  out.push(`BGNLIB`);
  out.push(`LIBNAME ${library.name}`);
  out.push(`UNITS ${library.units.dbUnitInUserUnits} ${library.units.dbUnitInMeters}`);

  for (const struct of library.structures) {
    out.push(`BGNSTR`);
    out.push(`STRNAME ${struct.name}`);
    for (const el of struct.elements) {
      if (el.kind === "boundary") {
        out.push(`  BOUNDARY`);
        out.push(`  LAYER ${el.layer}`);
        out.push(`  DATATYPE ${el.datatype}`);
        out.push(`  XY ${el.xy.map((p) => `${p.x}: ${p.y}`).join("  ")}`);
        out.push(`  ENDEL`);
      } else if (el.kind === "path") {
        out.push(`  PATH`);
        out.push(`  LAYER ${el.layer}`);
        out.push(`  DATATYPE ${el.datatype}`);
        if (el.pathtype !== undefined) out.push(`  PATHTYPE ${el.pathtype}`);
        if (el.width !== undefined) out.push(`  WIDTH ${el.width}`);
        out.push(`  XY ${el.xy.map((p) => `${p.x}: ${p.y}`).join("  ")}`);
        out.push(`  ENDEL`);
      } else if (el.kind === "sref") {
        out.push(`  SREF`);
        out.push(`  SNAME ${el.sname}`);
        if (el.strans) {
          const mask =
            el.strans.raw ??
            (el.strans.reflectX ? 0x8000 : 0) |
              (el.strans.absoluteMag ? 0x0004 : 0) |
              (el.strans.absoluteAngle ? 0x0002 : 0);
          out.push(`  STRANS ${mask.toString(2).padStart(16, "0")}`);
        }
        if (el.mag !== undefined) out.push(`  MAG ${el.mag}`);
        if (el.angle !== undefined) out.push(`  ANGLE ${el.angle}`);
        out.push(`  XY ${el.xy.x}: ${el.xy.y}`);
        out.push(`  ENDEL`);
      } else if (el.kind === "aref") {
        out.push(`  AREF`);
        out.push(`  SNAME ${el.sname}`);
        if (el.strans) {
          const mask =
            el.strans.raw ??
            (el.strans.reflectX ? 0x8000 : 0) |
              (el.strans.absoluteMag ? 0x0004 : 0) |
              (el.strans.absoluteAngle ? 0x0002 : 0);
          out.push(`  STRANS ${mask.toString(2).padStart(16, "0")}`);
        }
        if (el.mag !== undefined) out.push(`  MAG ${el.mag}`);
        if (el.angle !== undefined) out.push(`  ANGLE ${el.angle}`);
        out.push(`  COLROW ${el.columns} ${el.rows}`);
        out.push(`  XY ${el.xy.map((p) => `${p.x}: ${p.y}`).join("  ")}`);
        out.push(`  ENDEL`);
      } else if (el.kind === "text") {
        out.push(`  TEXT`);
        out.push(`  LAYER ${el.layer}`);
        out.push(`  TEXTTYPE ${el.texttype}`);
        out.push(`  XY ${el.xy.x}: ${el.xy.y}`);
        out.push(`  STRING "${el.string}"`);
        out.push(`  ENDEL`);
      }
    }
    out.push(`ENDSTR`);
  }

  out.push(`ENDLIB`);
  return out.join("\n") + "\n";
}
