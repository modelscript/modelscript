// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Parser for Gerber RS-274-D & RS-274X (Extended Gerber) PCB photoplotter files.
 */

import type {
  GerberApertureDef,
  GerberApertureMacro,
  GerberApertureShape,
  GerberAttribute,
  GerberCommand,
  GerberComment,
  GerberCoordNotation,
  GerberDocument,
  GerberFormatSpec,
  GerberInterpolation,
  GerberMacroPrimitive,
  GerberOperationKind,
  GerberParseError,
  GerberPolarity,
  GerberQuadrantMode,
  GerberStepRepeat,
  GerberUnit,
  GerberZeroOmission,
  SourceSpan,
} from "../types.js";

const DEFAULT_FORMAT: Omit<GerberFormatSpec, keyof SourceSpan> = {
  zeroOmission: "L",
  coordNotation: "A",
  xInteger: 2,
  xDecimal: 4,
  yInteger: 2,
  yDecimal: 4,
};

interface LineIndex {
  starts: number[];
}

function buildLineIndex(text: string): LineIndex {
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      starts.push(i + 1);
    }
  }
  return { starts };
}

function offsetToLineCol(index: LineIndex, offset: number): { line: number; column: number } {
  const starts = index.starts;
  let lo = 0;
  let hi = starts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = starts[mid] ?? 0;
    if (s <= offset) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const lineIdx = Math.max(0, hi);
  const lineStart = starts[lineIdx] ?? 0;
  return { line: lineIdx + 1, column: offset - lineStart + 1 };
}

/**
 * Decodes a Gerber coordinate integer string into a floating-point number in native file units
 * according to `%FS` zero omission (`L` or `T`) and integer/decimal digit counts.
 */
export function decodeGerberCoordinate(
  raw: string,
  intDigits: number,
  decDigits: number,
  zeroOmission: GerberZeroOmission,
): number {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return 0;

  let sign = 1;
  let digits = trimmed;
  if (digits.startsWith("-")) {
    sign = -1;
    digits = digits.slice(1);
  } else if (digits.startsWith("+")) {
    digits = digits.slice(1);
  }

  // If an explicit decimal point is present (rare legacy extensions), parse directly
  if (digits.includes(".")) {
    const val = Number.parseFloat(digits);
    return Number.isFinite(val) ? sign * val : 0;
  }

  if (zeroOmission === "T") {
    const totalDigits = intDigits + decDigits;
    const padded = digits.length < totalDigits ? digits.padEnd(totalDigits, "0") : digits;
    const intVal = Number.parseInt(padded, 10);
    return Number.isFinite(intVal) ? (sign * intVal) / Math.pow(10, decDigits) : 0;
  }

  // Leading zero omission ('L')
  const intVal = Number.parseInt(digits, 10);
  return Number.isFinite(intVal) ? (sign * intVal) / Math.pow(10, decDigits) : 0;
}

function makeSpan(lineIndex: LineIndex, startOffset: number, endOffset: number): SourceSpan {
  const { line, column } = offsetToLineCol(lineIndex, startOffset);
  return { startOffset, endOffset, line, column };
}

/**
 * Parses a Gerber RS-274-D or RS-274X document string into a typed `GerberDocument`.
 */
export function parseGerber(content: string, name: string = "layer.gbr"): GerberDocument {
  const lineIndex = buildLineIndex(content);
  const apertures = new Map<number, GerberApertureDef>();
  const macros = new Map<string, GerberApertureMacro>();
  const attributes: GerberAttribute[] = [];
  const comments: GerberComment[] = [];
  const commands: GerberCommand[] = [];
  const parseErrors: GerberParseError[] = [];

  let formatSpec: GerberFormatSpec | null = null;
  let unit: GerberUnit | null = null;
  let hasExplicitUnit = false;
  let hasLegacyUnitCommand = false;
  let hasIncrementalMode = false;
  let hasEof = false;

  // Modal state
  let zeroOmission: GerberZeroOmission = DEFAULT_FORMAT.zeroOmission;
  let coordNotation: GerberCoordNotation = DEFAULT_FORMAT.coordNotation;
  let xInteger = DEFAULT_FORMAT.xInteger;
  let xDecimal = DEFAULT_FORMAT.xDecimal;
  let yInteger = DEFAULT_FORMAT.yInteger;
  let yDecimal = DEFAULT_FORMAT.yDecimal;
  let interpolation: GerberInterpolation = "LINEAR";
  let quadrantMode: GerberQuadrantMode = "MULTI";
  let polarity: GerberPolarity = "D";
  let activeAperture: number | null = null;
  let inRegion = false;
  let currentX = 0;
  let currentY = 0;
  let lastOp: GerberOperationKind | null = null;
  let stepRepeat: GerberStepRepeat = {
    xRepeat: 1,
    yRepeat: 1,
    xStep: 0,
    yStep: 0,
    startOffset: 0,
    endOffset: 0,
    line: 1,
    column: 1,
  };

  let pos = 0;
  const len = content.length;

  function skipWhitespace(): void {
    while (pos < len) {
      const ch = content.charCodeAt(pos);
      if (ch === 32 || ch === 9 || ch === 10 || ch === 13) {
        pos++;
      } else {
        break;
      }
    }
  }

  function processExtendedParam(rawBody: string, span: SourceSpan): void {
    const body = rawBody.trim();
    if (body.length === 0) return;

    // %AM<name>*<primitives>*% — Aperture Macro (may contain multiple '*' statements)
    if (body.startsWith("AM")) {
      const parts = body
        .split("*")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const header = parts[0] ?? "";
      const macroName = header.slice(2).trim();
      if (!macroName) {
        parseErrors.push({ ...span, message: "Malformed %AM aperture macro: missing macro name", raw: `%${rawBody}%` });
        return;
      }
      const primitives: GerberMacroPrimitive[] = [];
      for (let i = 1; i < parts.length; i++) {
        const stmt = parts[i] ?? "";
        if (stmt.startsWith("$") || stmt.startsWith("0 ")) continue;
        const fields = stmt.split(",").map((f) => f.trim());
        const code = Number.parseInt(fields[0] ?? "", 10);
        if (Number.isFinite(code)) {
          primitives.push({ code, modifiers: fields.slice(1) });
        }
      }
      macros.set(macroName, { ...span, name: macroName, body, primitives });
      return;
    }

    // Other extended parameters may contain multiple '*'-delimited commands inside one %...% block
    const stmts = body
      .split("*")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const stmt of stmts) {
      // %FS — Format Specification: FS[L|T][A|I]X<int><dec>Y<int><dec>
      if (stmt.startsWith("FS")) {
        const m = /^FS([LT])([AI])X(\d)(\d)Y(\d)(\d)$/i.exec(stmt);
        if (!m) {
          parseErrors.push({ ...span, message: `Invalid format specification '${stmt}'`, raw: `%${stmt}*%` });
          continue;
        }
        zeroOmission = (m[1] ?? "L").toUpperCase() as GerberZeroOmission;
        coordNotation = (m[2] ?? "A").toUpperCase() as GerberCoordNotation;
        xInteger = Number.parseInt(m[3] ?? "2", 10);
        xDecimal = Number.parseInt(m[4] ?? "4", 10);
        yInteger = Number.parseInt(m[5] ?? "2", 10);
        yDecimal = Number.parseInt(m[6] ?? "4", 10);
        if (coordNotation === "I") hasIncrementalMode = true;
        formatSpec = {
          ...span,
          zeroOmission,
          coordNotation,
          xInteger,
          xDecimal,
          yInteger,
          yDecimal,
        };
        continue;
      }

      // %MO — Mode (Units): MOIN or MOMM
      if (stmt.startsWith("MO")) {
        const m = /^MO(IN|MM)$/i.exec(stmt);
        if (!m) {
          parseErrors.push({
            ...span,
            message: `Invalid unit mode '${stmt}' (expected MOIN or MOMM)`,
            raw: `%${stmt}*%`,
          });
          continue;
        }
        unit = (m[1] ?? "MM").toUpperCase() as GerberUnit;
        hasExplicitUnit = true;
        continue;
      }

      // %AD — Aperture Definition: ADD<dCode><shape>[,<params>]
      if (stmt.startsWith("AD")) {
        const m = /^ADD(\d+)([A-Za-z_][A-Za-z0-9_.$]*)(?:,(.*))?$/.exec(stmt);
        if (!m) {
          parseErrors.push({ ...span, message: `Invalid aperture definition '${stmt}'`, raw: `%${stmt}*%` });
          continue;
        }
        const dCode = Number.parseInt(m[1] ?? "0", 10);
        const shapeToken = m[2] ?? "C";
        const paramStr = m[3] ?? "";
        const params =
          paramStr.length > 0
            ? paramStr
                .split("X")
                .map((p) => Number.parseFloat(p))
                .filter((v) => Number.isFinite(v))
            : [];

        let shape: GerberApertureShape = "MACRO";
        let macroName: string | undefined;
        let width = params[0] ?? 0;
        let height = params[0] ?? 0;
        let holeDiameter: number | undefined;
        let vertices: number | undefined;
        let rotationDeg: number | undefined;

        if (shapeToken === "C") {
          shape = "C";
          width = params[0] ?? 0;
          height = width;
          if (params[1] !== undefined) holeDiameter = params[1];
        } else if (shapeToken === "R" || shapeToken === "O") {
          shape = shapeToken;
          width = params[0] ?? 0;
          height = params[1] ?? width;
          if (params[2] !== undefined) holeDiameter = params[2];
        } else if (shapeToken === "P") {
          shape = "P";
          width = params[0] ?? 0;
          height = width;
          vertices = params[1] !== undefined ? Math.round(params[1]) : 4;
          rotationDeg = params[2] ?? 0;
          if (params[3] !== undefined) holeDiameter = params[3];
        } else {
          shape = "MACRO";
          macroName = shapeToken;
          width = params[0] ?? 0;
          height = params[1] ?? width;
        }

        apertures.set(dCode, {
          ...span,
          dCode,
          shape,
          macroName,
          params,
          width,
          height,
          holeDiameter,
          vertices,
          rotationDeg,
        });
        continue;
      }

      // %LP — Load Polarity: LPD (Dark) or LPC (Clear)
      if (stmt.startsWith("LP")) {
        const m = /^LP([DC])$/i.exec(stmt);
        if (!m) {
          parseErrors.push({ ...span, message: `Invalid polarity '${stmt}' (expected LPD or LPC)`, raw: `%${stmt}*%` });
          continue;
        }
        polarity = (m[1] ?? "D").toUpperCase() as GerberPolarity;
        commands.push({ ...span, kind: "POLARITY", value: polarity });
        continue;
      }

      // %SR — Step and Repeat: SR[X<nx>Y<ny>I<dx>J<dy>]
      if (stmt.startsWith("SR")) {
        if (stmt === "SR") {
          stepRepeat = { ...span, xRepeat: 1, yRepeat: 1, xStep: 0, yStep: 0 };
          commands.push({ ...span, kind: "STEP_REPEAT", value: "1x1" });
          continue;
        }
        const xm = /X(\d+)/i.exec(stmt);
        const ym = /Y(\d+)/i.exec(stmt);
        const im = /I([+-]?\d*\.?\d+)/i.exec(stmt);
        const jm = /J([+-]?\d*\.?\d+)/i.exec(stmt);
        const nx = xm ? Math.max(1, Number.parseInt(xm[1] ?? "1", 10)) : 1;
        const ny = ym ? Math.max(1, Number.parseInt(ym[1] ?? "1", 10)) : 1;
        const dx = im ? Number.parseFloat(im[1] ?? "0") : 0;
        const dy = jm ? Number.parseFloat(jm[1] ?? "0") : 0;
        stepRepeat = { ...span, xRepeat: nx, yRepeat: ny, xStep: dx, yStep: dy };
        commands.push({ ...span, kind: "STEP_REPEAT", value: `${nx}x${ny}` });
        continue;
      }

      // %TF, %TA, %TD — Gerber X2 File / Aperture / Delete Attributes
      if (stmt.startsWith("TF") || stmt.startsWith("TA") || stmt.startsWith("TD")) {
        const kind = stmt.slice(0, 2) as "TF" | "TA" | "TD";
        const rest = stmt.slice(2);
        const parts = rest.split(",");
        const attrName = parts[0] ?? "";
        attributes.push({
          ...span,
          kind,
          name: attrName,
          values: parts.slice(1),
        });
        continue;
      }

      // Recognized non-error RS-274X directives (%LN, %IN, %OF, %IP, %MI, %SF, %AS, %IR, %AB, %LM, %LR, %LS, %TO)
      if (/^(LN|IN|OF|IP|MI|SF|AS|IR|AB|LM|LR|LS|TO)/i.test(stmt)) {
        continue;
      }

      parseErrors.push({
        ...span,
        message: `Unrecognized extended parameter '${stmt}'`,
        raw: `%${stmt}*%`,
      });
    }
  }

  function processStandardCommand(rawCmd: string, span: SourceSpan): void {
    const cmd = rawCmd.trim();
    if (cmd.length === 0) return;

    // G04 — Comment
    if (/^G0?4\b/i.test(cmd) || cmd.startsWith("G04")) {
      const commentText = cmd.replace(/^G0?4\s*/i, "");
      comments.push({ ...span, text: commentText });
      return;
    }

    // M02 / M00 / M01 — End of File
    if (/^M0?[012]$/i.test(cmd)) {
      hasEof = true;
      commands.push({ ...span, kind: "EOF", value: cmd.toUpperCase() });
      return;
    }

    // G36 / G37 — Region fill start / end
    if (/^G36$/i.test(cmd)) {
      inRegion = true;
      commands.push({ ...span, kind: "REGION_START" });
      return;
    }
    if (/^G37$/i.test(cmd)) {
      inRegion = false;
      commands.push({ ...span, kind: "REGION_END" });
      return;
    }

    // G70 / G71 — Legacy RS-274-D unit commands (inch / mm)
    if (/^G70$/i.test(cmd)) {
      unit = "IN";
      hasExplicitUnit = true;
      hasLegacyUnitCommand = true;
      commands.push({ ...span, kind: "UNIT_LEGACY", value: "G70" });
      return;
    }
    if (/^G71$/i.test(cmd)) {
      unit = "MM";
      hasExplicitUnit = true;
      hasLegacyUnitCommand = true;
      commands.push({ ...span, kind: "UNIT_LEGACY", value: "G71" });
      return;
    }

    // G74 / G75 — Single / Multi-quadrant circular arc mode
    if (/^G74$/i.test(cmd)) {
      quadrantMode = "SINGLE";
      commands.push({ ...span, kind: "QUADRANT", value: "G74" });
      return;
    }
    if (/^G75$/i.test(cmd)) {
      quadrantMode = "MULTI";
      commands.push({ ...span, kind: "QUADRANT", value: "G75" });
      return;
    }

    // G90 / G91 — Absolute / Incremental coordinate notation
    if (/^G90$/i.test(cmd)) {
      coordNotation = "A";
      commands.push({ ...span, kind: "COORD_MODE", value: "G90" });
      return;
    }
    if (/^G91$/i.test(cmd)) {
      coordNotation = "I";
      hasIncrementalMode = true;
      commands.push({ ...span, kind: "COORD_MODE", value: "G91" });
      return;
    }

    // Standalone interpolation mode: G01 / G02 / G03
    if (/^G0?1$/i.test(cmd)) {
      interpolation = "LINEAR";
      commands.push({ ...span, kind: "INTERPOLATION", value: "G01" });
      return;
    }
    if (/^G0?2$/i.test(cmd)) {
      interpolation = "CW_ARC";
      commands.push({ ...span, kind: "INTERPOLATION", value: "G02" });
      return;
    }
    if (/^G0?3$/i.test(cmd)) {
      interpolation = "CCW_ARC";
      commands.push({ ...span, kind: "INTERPOLATION", value: "G03" });
      return;
    }

    // Standalone aperture select: D10+ or legacy G54D10+
    const selMatch = /^(?:G54)?D(\d+)$/i.exec(cmd);
    if (selMatch) {
      const dCode = Number.parseInt(selMatch[1] ?? "0", 10);
      if (dCode >= 10) {
        activeAperture = dCode;
        commands.push({ ...span, kind: "SELECT_APERTURE", dCode });
        return;
      }
    }

    // Combined word-address operation block: [G01|G02|G03][X...][Y...][I...][J...][D01|D02|D03]
    let rest = cmd;
    const gPrefix = /^G0?([123])/i.exec(rest);
    if (gPrefix) {
      const gNum = gPrefix[1];
      if (gNum === "1") {
        interpolation = "LINEAR";
        commands.push({ ...span, kind: "INTERPOLATION", value: "G01" });
      } else if (gNum === "2") {
        interpolation = "CW_ARC";
        commands.push({ ...span, kind: "INTERPOLATION", value: "G02" });
      } else if (gNum === "3") {
        interpolation = "CCW_ARC";
        commands.push({ ...span, kind: "INTERPOLATION", value: "G03" });
      }
      rest = rest.slice(gPrefix[0].length);
    }

    const opMatch =
      /^(?:X([+-]?\d+(?:\.\d+)?))?(?:Y([+-]?\d+(?:\.\d+)?))?(?:I([+-]?\d+(?:\.\d+)?))?(?:J([+-]?\d+(?:\.\d+)?))?(?:D0?([123]))?$/i.exec(
        rest,
      );

    if (opMatch && (opMatch[1] || opMatch[2] || opMatch[3] || opMatch[4] || opMatch[5])) {
      const rawX = opMatch[1];
      const rawY = opMatch[2];
      const rawI = opMatch[3];
      const rawJ = opMatch[4];
      const dStr = opMatch[5];

      let op: GerberOperationKind | null = null;
      if (dStr === "1") op = "DRAW";
      else if (dStr === "2") op = "MOVE";
      else if (dStr === "3") op = "FLASH";
      else op = lastOp ?? "DRAW";
      lastOp = op;

      let xVal = currentX;
      let yVal = currentY;
      if (rawX !== undefined) {
        const decodedX = decodeGerberCoordinate(rawX, xInteger, xDecimal, zeroOmission);
        xVal = coordNotation === "I" ? currentX + decodedX : decodedX;
      }
      if (rawY !== undefined) {
        const decodedY = decodeGerberCoordinate(rawY, yInteger, yDecimal, zeroOmission);
        yVal = coordNotation === "I" ? currentY + decodedY : decodedY;
      }
      const iVal = rawI !== undefined ? decodeGerberCoordinate(rawI, xInteger, xDecimal, zeroOmission) : undefined;
      const jVal = rawJ !== undefined ? decodeGerberCoordinate(rawJ, yInteger, yDecimal, zeroOmission) : undefined;

      currentX = xVal;
      currentY = yVal;

      commands.push({
        ...span,
        kind: "OPERATION",
        op,
        x: xVal,
        y: yVal,
        i: iVal,
        j: jVal,
        rawX,
        rawY,
        rawI,
        rawJ,
        interpolation,
        quadrantMode,
        polarity,
        apertureCode: activeAperture,
        inRegion,
        unit: unit ?? "MM",
        stepRepeat: { ...stepRepeat },
      });
      return;
    }

    parseErrors.push({
      ...span,
      message: `Unrecognized Gerber command '${cmd}'`,
      raw: `${cmd}*`,
    });
  }

  while (pos < len) {
    skipWhitespace();
    if (pos >= len) break;

    const startOffset = pos;
    if (content[pos] === "%") {
      pos++; // consume opening '%'
      const endPct = content.indexOf("%", pos);
      if (endPct === -1) {
        const span = makeSpan(lineIndex, startOffset, len);
        parseErrors.push({
          ...span,
          message: "Unterminated extended parameter block (missing closing '%')",
          raw: content.slice(startOffset),
        });
        break;
      }
      const body = content.slice(pos, endPct);
      pos = endPct + 1;
      const span = makeSpan(lineIndex, startOffset, pos);
      processExtendedParam(body, span);
    } else {
      const endStar = content.indexOf("*", pos);
      if (endStar === -1) {
        const trailing = content.slice(pos).trim();
        if (trailing.length > 0) {
          const span = makeSpan(lineIndex, startOffset, len);
          parseErrors.push({
            ...span,
            message: `Unterminated Gerber command (missing '*'): '${trailing}'`,
            raw: trailing,
          });
        }
        break;
      }
      const cmdText = content.slice(pos, endStar);
      pos = endStar + 1;
      const span = makeSpan(lineIndex, startOffset, pos);
      processStandardCommand(cmdText, span);
    }
  }

  return {
    name,
    formatSpec,
    unit,
    hasExplicitUnit,
    hasLegacyUnitCommand,
    hasIncrementalMode,
    hasEof,
    apertures,
    macros,
    attributes,
    comments,
    commands,
    parseErrors,
  };
}
