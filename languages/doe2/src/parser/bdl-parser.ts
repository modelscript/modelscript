// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/doe2 — DOE-2.1E / DOE-2.2 BDL Parser.
 *
 * Parses LBNL DOE-2 Building Description Language (BDL) decks into a structured
 * `Doe2Document` with exact 1-based source ranges, parent-child envelope hierarchy,
 * schedule expansion, and syntax/terminator diagnostics.
 */

import type {
  Doe2BuildingLocation,
  Doe2CommandKind,
  Doe2Construction,
  Doe2DaySchedule,
  Doe2Document,
  Doe2Door,
  Doe2GlassType,
  Doe2Layers,
  Doe2Material,
  Doe2ParamValue,
  Doe2ParseError,
  Doe2PlantEquipment,
  Doe2Range,
  Doe2RawCommand,
  Doe2RunPeriod,
  Doe2Schedule,
  Doe2SectionKind,
  Doe2Space,
  Doe2Surface,
  Doe2System,
  Doe2WeekSchedule,
  Doe2Window,
  Doe2Zone,
} from "../types.js";

export interface ParseDoe2Options {
  units?: "IP" | "SI" | undefined;
}

type TokenKind = "STRING" | "NUMBER" | "IDENT" | "EQ" | "LPAREN" | "RPAREN" | "COMMA" | "DOTDOT";

interface Token {
  kind: TokenKind;
  value: string;
  line: number;
  col: number;
  startOffset: number;
  endOffset: number;
}

const KNOWN_COMMANDS = new Set<Doe2CommandKind>([
  "INPUT",
  "TITLE",
  "RUN-PERIOD",
  "BUILDING-LOCATION",
  "MATERIAL",
  "LAYERS",
  "CONSTRUCTION",
  "GLASS-TYPE",
  "DAY-SCHEDULE",
  "DAY-SCHEDULE-PD",
  "WEEK-SCHEDULE",
  "WEEK-SCHEDULE-PD",
  "SCHEDULE",
  "SCHEDULE-PD",
  "SPACE",
  "EXTERIOR-WALL",
  "ROOF",
  "UNDERGROUND-WALL",
  "WINDOW",
  "DOOR",
  "ZONE",
  "SYSTEM",
  "PLANT-EQUIPMENT",
  "COMPUTE",
  "STOP",
  "END",
]);

const SECTION_KINDS = new Set<Doe2SectionKind>(["LOADS", "SYSTEMS", "PLANT", "ECONOMICS"]);

function normalizeCommand(raw: string): Doe2CommandKind {
  const upper = raw.toUpperCase();
  if (KNOWN_COMMANDS.has(upper as Doe2CommandKind)) {
    return upper as Doe2CommandKind;
  }
  return "UNKNOWN";
}

function makeRange(
  startLine: number,
  startColumn: number,
  endLine: number,
  endColumn: number,
  startOffset: number,
  endOffset: number,
): Doe2Range {
  return { startLine, startColumn, endLine, endColumn, startOffset, endOffset };
}

function tokenizeBdl(text: string, parseErrors: Doe2ParseError[]): Token[] {
  const tokens: Token[] = [];
  const len = text.length;
  let i = 0;
  let line = 1;
  let col = 1;

  const advance = (): string => {
    const ch = text[i++] ?? "";
    if (ch === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
    return ch;
  };

  while (i < len) {
    const ch = text[i] ?? "";

    // Whitespace
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      advance();
      continue;
    }

    // Comment ($ to end of line)
    if (ch === "$") {
      while (i < len && text[i] !== "\n") {
        advance();
      }
      continue;
    }

    const startLine = line;
    const startCol = col;
    const startOffset = i;

    // Terminator '..'
    if (ch === "." && text[i + 1] === ".") {
      advance();
      advance();
      tokens.push({ kind: "DOTDOT", value: "..", line: startLine, col: startCol, startOffset, endOffset: i });
      continue;
    }

    if (ch === "=") {
      advance();
      tokens.push({ kind: "EQ", value: "=", line: startLine, col: startCol, startOffset, endOffset: i });
      continue;
    }

    if (ch === "(") {
      advance();
      tokens.push({ kind: "LPAREN", value: "(", line: startLine, col: startCol, startOffset, endOffset: i });
      continue;
    }

    if (ch === ")") {
      advance();
      tokens.push({ kind: "RPAREN", value: ")", line: startLine, col: startCol, startOffset, endOffset: i });
      continue;
    }

    if (ch === ",") {
      advance();
      tokens.push({ kind: "COMMA", value: ",", line: startLine, col: startCol, startOffset, endOffset: i });
      continue;
    }

    // Quoted string
    if (ch === '"' || ch === "'") {
      const quote = advance();
      let val = "";
      let closed = false;
      while (i < len) {
        const c = advance();
        if (c === quote) {
          closed = true;
          break;
        }
        val += c;
      }
      if (!closed) {
        parseErrors.push({
          code: "DOE1001",
          message: `BDL syntax error: Unterminated string literal starting at line ${startLine}.`,
          range: makeRange(startLine, startCol, line, col, startOffset, i),
        });
      }
      tokens.push({ kind: "STRING", value: val, line: startLine, col: startCol, startOffset, endOffset: i });
      continue;
    }

    // Number literal (supports leading sign if followed by digit or dot+digit)
    const nextCh = text[i + 1] ?? "";
    const isNumberStart =
      (ch >= "0" && ch <= "9") ||
      ((ch === "-" || ch === "+") &&
        ((nextCh >= "0" && nextCh <= "9") ||
          (nextCh === "." && (text[i + 2] ?? "") >= "0" && (text[i + 2] ?? "") <= "9"))) ||
      (ch === "." && nextCh >= "0" && nextCh <= "9");

    if (isNumberStart) {
      let numStr = "";
      if (ch === "-" || ch === "+") {
        numStr += advance();
      }
      while (i < len && (text[i] ?? "") >= "0" && (text[i] ?? "") <= "9") {
        numStr += advance();
      }
      // Decimal point (must NOT consume '..')
      if (text[i] === "." && text[i + 1] !== ".") {
        numStr += advance();
        while (i < len && (text[i] ?? "") >= "0" && (text[i] ?? "") <= "9") {
          numStr += advance();
        }
      }
      // Exponent
      if (text[i] === "e" || text[i] === "E") {
        const expNext = text[i + 1] ?? "";
        const expNext2 = text[i + 2] ?? "";
        if (
          (expNext >= "0" && expNext <= "9") ||
          ((expNext === "+" || expNext === "-") && expNext2 >= "0" && expNext2 <= "9")
        ) {
          numStr += advance();
          if (text[i] === "+" || text[i] === "-") {
            numStr += advance();
          }
          while (i < len && (text[i] ?? "") >= "0" && (text[i] ?? "") <= "9") {
            numStr += advance();
          }
        }
      }
      tokens.push({ kind: "NUMBER", value: numStr, line: startLine, col: startCol, startOffset, endOffset: i });
      continue;
    }

    // Identifier (letters, digits, _, -, /)
    if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_") {
      let ident = "";
      while (i < len) {
        const c = text[i] ?? "";
        if (
          (c >= "a" && c <= "z") ||
          (c >= "A" && c <= "Z") ||
          (c >= "0" && c <= "9") ||
          c === "_" ||
          c === "-" ||
          c === "/"
        ) {
          ident += advance();
        } else {
          break;
        }
      }
      tokens.push({ kind: "IDENT", value: ident, line: startLine, col: startCol, startOffset, endOffset: i });
      continue;
    }

    // Unexpected character
    const bad = advance();
    parseErrors.push({
      code: "DOE1001",
      message: `BDL syntax error: Unexpected character '${bad}' at line ${startLine}, column ${startCol}.`,
      range: makeRange(startLine, startCol, line, col, startOffset, i),
    });
  }

  return tokens;
}

function asNumber(v: Doe2ParamValue | undefined): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function asString(v: Doe2ParamValue | undefined): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return undefined;
}

function asStringList(v: Doe2ParamValue | undefined): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === "string") return [v];
  if (typeof v === "number") return [String(v)];
  return [];
}

function asNumberList(v: Doe2ParamValue | undefined): number[] {
  if (Array.isArray(v)) {
    const nums: number[] = [];
    for (const item of v) {
      const n = typeof item === "number" ? item : Number(item);
      if (Number.isFinite(n)) nums.push(n);
    }
    return nums;
  }
  const n = asNumber(v);
  return n !== undefined ? [n] : [];
}

/**
 * Splits tokenized stream into logical commands, detecting missing '..' terminators.
 */
function parseCommandTokens(tokens: Token[], parseErrors: Doe2ParseError[]): Doe2RawCommand[] {
  const commands: Doe2RawCommand[] = [];
  let idx = 0;

  const PARAM_KEYWORDS = new Set([
    "TYPE",
    "LAYERS",
    "MATERIAL",
    "CONSTRUCTION",
    "GLASS-TYPE",
    "SPACE",
    "SYSTEM",
    "ZONE",
    "EXTERIOR-WALL",
    "SURFACE",
  ]);

  const isCommandStartAt = (pos: number): boolean => {
    const t0 = tokens[pos];
    if (!t0) return false;
    const prev = pos > 0 ? tokens[pos - 1] : undefined;
    const onNewLine = !prev || t0.line > prev.line;
    const t1 = tokens[pos + 1];
    const t2 = tokens[pos + 2];
    // Named command: "NAME" = KNOWN_COMMAND (or unquoted IDENT on a new line that is not a parameter keyword)
    if (t1?.kind === "EQ" && t2?.kind === "IDENT" && KNOWN_COMMANDS.has(t2.value.toUpperCase() as Doe2CommandKind)) {
      if (t0.kind === "STRING") return true;
      if (t0.kind === "IDENT" && onNewLine && !PARAM_KEYWORDS.has(t0.value.toUpperCase())) return true;
    }
    // Unnamed known top-level command on a new line
    if (t0.kind === "IDENT" && onNewLine) {
      const upper = t0.value.toUpperCase();
      if (
        upper === "INPUT" ||
        upper === "TITLE" ||
        upper === "RUN-PERIOD" ||
        upper === "BUILDING-LOCATION" ||
        upper === "COMPUTE" ||
        upper === "STOP" ||
        upper === "END"
      ) {
        return true;
      }
    }
    return false;
  };

  while (idx < tokens.length) {
    // Skip stray DOTDOT
    if (tokens[idx]?.kind === "DOTDOT") {
      idx++;
      continue;
    }

    const startTok = tokens[idx]!;
    let uName: string | undefined;
    let commandTok: Token;

    if (
      (startTok.kind === "STRING" || startTok.kind === "IDENT") &&
      tokens[idx + 1]?.kind === "EQ" &&
      tokens[idx + 2]?.kind === "IDENT"
    ) {
      uName = startTok.value;
      commandTok = tokens[idx + 2]!;
      idx += 3;
    } else if (startTok.kind === "IDENT") {
      commandTok = startTok;
      idx += 1;
    } else {
      parseErrors.push({
        code: "DOE1001",
        message: `BDL syntax error: Expected command name, found '${startTok.value}'.`,
        range: makeRange(
          startTok.line,
          startTok.col,
          startTok.line,
          startTok.col + Math.max(1, startTok.value.length),
          startTok.startOffset,
          startTok.endOffset,
        ),
      });
      idx++;
      continue;
    }

    const normalized = normalizeCommand(commandTok.value);
    const params: Record<string, Doe2ParamValue> = {};
    const positional: (string | number)[] = [];
    const scheduleValues: number[] = [];
    let subCommand: string | undefined;
    let terminated = false;
    let lastTok = commandTok;

    // For INPUT / COMPUTE, capture optional section sub-command
    if ((normalized === "INPUT" || normalized === "COMPUTE") && tokens[idx]?.kind === "IDENT") {
      const nextIdent = tokens[idx]!;
      if (SECTION_KINDS.has(nextIdent.value.toUpperCase() as Doe2SectionKind)) {
        subCommand = nextIdent.value.toUpperCase();
        lastTok = nextIdent;
        idx++;
      }
    }

    const parseValue = (): Doe2ParamValue | undefined => {
      const tok = tokens[idx];
      if (!tok || tok.kind === "DOTDOT") return undefined;

      if (tok.kind === "LPAREN") {
        idx++; // consume '('
        const items: (string | number)[] = [];
        while (idx < tokens.length && tokens[idx]?.kind !== "RPAREN" && tokens[idx]?.kind !== "DOTDOT") {
          const itemTok = tokens[idx]!;
          if (itemTok.kind === "COMMA") {
            idx++;
            continue;
          }
          if (itemTok.kind === "NUMBER") {
            items.push(Number(itemTok.value));
            lastTok = itemTok;
            idx++;
          } else if (itemTok.kind === "STRING" || itemTok.kind === "IDENT") {
            items.push(itemTok.value);
            lastTok = itemTok;
            idx++;
          } else {
            idx++;
          }
        }
        if (tokens[idx]?.kind === "RPAREN") {
          lastTok = tokens[idx]!;
          idx++;
        } else {
          parseErrors.push({
            code: "DOE1001",
            message: `BDL syntax error: Unclosed parenthesized list in '${commandTok.value}'.`,
            range: makeRange(tok.line, tok.col, lastTok.line, lastTok.col + 1, tok.startOffset, lastTok.endOffset),
          });
        }
        return items;
      }

      if (tok.kind === "NUMBER") {
        lastTok = tok;
        idx++;
        return Number(tok.value);
      }

      if (tok.kind === "STRING" || tok.kind === "IDENT") {
        lastTok = tok;
        idx++;
        return tok.value;
      }

      return undefined;
    };

    while (idx < tokens.length) {
      const tok = tokens[idx]!;

      if (tok.kind === "DOTDOT") {
        terminated = true;
        lastTok = tok;
        idx++;
        break;
      }

      // Detect missing '..' before next command
      if (isCommandStartAt(idx)) {
        break;
      }

      if (tok.kind === "COMMA") {
        idx++;
        continue;
      }

      // Keyword assignment: IDENT '=' Value
      if (tok.kind === "IDENT" && tokens[idx + 1]?.kind === "EQ") {
        const key = tok.value.toUpperCase();
        idx += 2; // consume key and '='
        const val = parseValue();
        if (val !== undefined) {
          params[key] = val;
        }
        continue;
      }

      // DOE-2 DAY-SCHEDULE range syntax: (startHr, endHr) (val) or (startHr, endHr) val
      if ((normalized === "DAY-SCHEDULE" || normalized === "DAY-SCHEDULE-PD") && tok.kind === "LPAREN") {
        const rangeVal = parseValue();
        if (
          Array.isArray(rangeVal) &&
          rangeVal.length === 2 &&
          typeof rangeVal[0] === "number" &&
          typeof rangeVal[1] === "number"
        ) {
          const startH = Math.max(1, Math.floor(rangeVal[0]));
          const endH = Math.min(24, Math.floor(rangeVal[1]));
          const nextVal = parseValue();
          const numVal = Array.isArray(nextVal) ? asNumber(nextVal[0]) : asNumber(nextVal);
          if (numVal !== undefined) {
            for (let h = startH; h <= endH; h++) {
              scheduleValues[h - 1] = numVal;
            }
          }
          continue;
        }
        if (Array.isArray(rangeVal)) {
          for (const v of rangeVal) {
            if (typeof v === "number") scheduleValues.push(v);
          }
        }
        continue;
      }

      // Positional value
      const val = parseValue();
      if (val !== undefined) {
        if (Array.isArray(val)) {
          positional.push(...val);
        } else {
          positional.push(val);
        }
      } else {
        idx++;
      }
    }

    if (positional.length > 0 && params["__POSITIONAL__"] === undefined) {
      params["__POSITIONAL__"] = positional;
    }
    if (scheduleValues.length > 0 && params["VALUES"] === undefined) {
      params["VALUES"] = scheduleValues;
    }

    const range = makeRange(
      startTok.line,
      startTok.col,
      lastTok.line,
      lastTok.col + Math.max(1, lastTok.value.length),
      startTok.startOffset,
      lastTok.endOffset,
    );

    if (!terminated) {
      parseErrors.push({
        code: "DOE1002",
        message: `Command '${uName ? `${uName} = ${commandTok.value}` : commandTok.value}' is missing its required '..' terminator.`,
        range,
      });
    }

    commands.push({
      uName,
      command: commandTok.value,
      normalizedCommand: normalized,
      subCommand,
      params,
      terminated,
      range,
    });
  }

  return commands;
}

/**
 * Parses a DOE-2.1E / DOE-2.2 BDL input deck string into a structured `Doe2Document`.
 */
export function parseDoe2(text: string, uri?: string, options?: ParseDoe2Options): Doe2Document {
  const parseErrors: Doe2ParseError[] = [];
  const tokens = tokenizeBdl(text, parseErrors);
  const commands = parseCommandTokens(tokens, parseErrors);

  const doc: Doe2Document = {
    uri,
    units: options?.units ?? "IP",
    sections: [],
    materials: [],
    layers: [],
    constructions: [],
    glassTypes: [],
    daySchedules: [],
    weekSchedules: [],
    schedules: [],
    spaces: [],
    surfaces: [],
    windows: [],
    doors: [],
    zones: [],
    systems: [],
    plantEquipment: [],
    hasCompute: false,
    hasStop: false,
    commands,
    parseErrors,
  };

  let currentSpaceName: string | undefined;
  let currentSurfaceName: string | undefined;
  let currentSystem: Doe2System | undefined;

  for (const cmd of commands) {
    const p = cmd.params;

    // Optional units override via UNITS = SI / IP
    const unitsParam = asString(p["UNITS"])?.toUpperCase();
    if (unitsParam === "SI" || unitsParam === "IP") {
      doc.units = unitsParam;
    }

    switch (cmd.normalizedCommand) {
      case "INPUT": {
        const sec = (cmd.subCommand ?? asString(p["__POSITIONAL__"]))?.toUpperCase();
        if (sec && SECTION_KINDS.has(sec as Doe2SectionKind)) {
          doc.sections.push(sec as Doe2SectionKind);
        }
        break;
      }

      case "TITLE": {
        const line1 = asString(p["LINE-1"]) ?? asString(p["TITLE"]) ?? asString(p["__POSITIONAL__"]);
        if (line1) doc.title = line1;
        break;
      }

      case "RUN-PERIOD": {
        const pos = asNumberList(p["__POSITIONAL__"]);
        const beginMonth = asNumber(p["BEGIN-MONTH"]) ?? pos[0] ?? 1;
        const beginDay = asNumber(p["BEGIN-DAY"]) ?? pos[1] ?? 1;
        const beginYear = asNumber(p["BEGIN-YEAR"]) ?? (pos.length >= 6 ? pos[2] : undefined);
        const endMonth = asNumber(p["END-MONTH"]) ?? (pos.length >= 6 ? pos[3] : pos[2]) ?? 12;
        const endDay = asNumber(p["END-DAY"]) ?? (pos.length >= 6 ? pos[4] : pos[3]) ?? 31;
        const endYear = asNumber(p["END-YEAR"]) ?? (pos.length >= 6 ? pos[5] : undefined);
        const rp: Doe2RunPeriod = {
          beginMonth,
          beginDay,
          beginYear,
          endMonth,
          endDay,
          endYear,
          range: cmd.range,
        };
        doc.runPeriod = rp;
        break;
      }

      case "BUILDING-LOCATION": {
        const loc: Doe2BuildingLocation = {
          name: cmd.uName ?? asString(p["CITY"]) ?? asString(p["LOCATION"]),
          latitude: asNumber(p["LATITUDE"]),
          longitude: asNumber(p["LONGITUDE"]),
          altitude: asNumber(p["ALTITUDE"]),
          timeZone: asNumber(p["TIME-ZONE"]),
          azimuth: asNumber(p["AZIMUTH"]),
          range: cmd.range,
        };
        doc.buildingLocation = loc;
        break;
      }

      case "MATERIAL": {
        const name = cmd.uName ?? `MATERIAL_${doc.materials.length + 1}`;
        const rawType = asString(p["TYPE"])?.toUpperCase();
        const type: "PROPERTIES" | "RESISTANCE" =
          rawType === "RESISTANCE" || (p["RESISTANCE"] !== undefined && p["CONDUCTIVITY"] === undefined)
            ? "RESISTANCE"
            : "PROPERTIES";
        const mat: Doe2Material = {
          name,
          type,
          thickness: asNumber(p["THICKNESS"]),
          conductivity: asNumber(p["CONDUCTIVITY"]),
          density: asNumber(p["DENSITY"]),
          specificHeat: asNumber(p["SPECIFIC-HEAT"]),
          resistance: asNumber(p["RESISTANCE"]),
          range: cmd.range,
        };
        doc.materials.push(mat);
        break;
      }

      case "LAYERS": {
        const name = cmd.uName ?? `LAYERS_${doc.layers.length + 1}`;
        const materials = asStringList(p["MATERIAL"] ?? p["MATERIALS"]);
        const lay: Doe2Layers = {
          name,
          materials,
          insideFilmRes: asNumber(p["INSIDE-FILM-RES"]),
          outsideFilmRes: asNumber(p["OUTSIDE-FILM-RES"]),
          range: cmd.range,
        };
        doc.layers.push(lay);
        break;
      }

      case "CONSTRUCTION": {
        const name = cmd.uName ?? `CONSTRUCTION_${doc.constructions.length + 1}`;
        const rawType = asString(p["TYPE"])?.toUpperCase();
        const uVal = asNumber(p["U-VALUE"]);
        const type: "LAYERS" | "U-VALUE" =
          rawType === "U-VALUE" || (uVal !== undefined && p["LAYERS"] === undefined) ? "U-VALUE" : "LAYERS";
        const con: Doe2Construction = {
          name,
          type,
          layersName: asString(p["LAYERS"]),
          materialName: asString(p["MATERIAL"]),
          uValue: uVal,
          absorptance: asNumber(p["ABSORPTANCE"]),
          roughness: asNumber(p["ROUGHNESS"]),
          range: cmd.range,
        };
        doc.constructions.push(con);
        break;
      }

      case "GLASS-TYPE": {
        const name = cmd.uName ?? `GLASS_${doc.glassTypes.length + 1}`;
        const sc = asNumber(p["SHADING-COEFF"]);
        const shgc = asNumber(p["SHGC"]) ?? (sc !== undefined ? sc * 0.87 : undefined);
        const gt: Doe2GlassType = {
          name,
          type: asString(p["TYPE"]),
          shadingCoeff: sc,
          shgc,
          glassConductance: asNumber(p["GLASS-CONDUCTANCE"]) ?? asNumber(p["U-VALUE"]),
          visibleTransmittance: asNumber(p["VIS-TRANS"]),
          panes: asNumber(p["PANES"]),
          range: cmd.range,
        };
        doc.glassTypes.push(gt);
        break;
      }

      case "DAY-SCHEDULE":
      case "DAY-SCHEDULE-PD": {
        const name = cmd.uName ?? `DAY_SCHED_${doc.daySchedules.length + 1}`;
        const values = asNumberList(p["VALUES"]);
        const ds: Doe2DaySchedule = {
          name,
          type: asString(p["TYPE"])?.toUpperCase(),
          values,
          range: cmd.range,
        };
        doc.daySchedules.push(ds);
        break;
      }

      case "WEEK-SCHEDULE":
      case "WEEK-SCHEDULE-PD": {
        const name = cmd.uName ?? `WEEK_SCHED_${doc.weekSchedules.length + 1}`;
        const daySchedules = asStringList(p["DAY-SCHEDULES"] ?? p["DAY-SCHEDULE"] ?? p["__POSITIONAL__"]).filter(
          (s) => s.toUpperCase() !== "ALL" && s.toUpperCase() !== "WD" && s.toUpperCase() !== "WEH",
        );
        const ws: Doe2WeekSchedule = {
          name,
          type: asString(p["TYPE"])?.toUpperCase(),
          daySchedules,
          range: cmd.range,
        };
        doc.weekSchedules.push(ws);
        break;
      }

      case "SCHEDULE":
      case "SCHEDULE-PD": {
        const name = cmd.uName ?? `SCHED_${doc.schedules.length + 1}`;
        const weekSchedules = asStringList(p["WEEK-SCHEDULES"] ?? p["WEEK-SCHEDULE"] ?? p["__POSITIONAL__"]).filter(
          (s) => s.toUpperCase() !== "THRU" && !/^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|\d+)$/i.test(s),
        );
        const sched: Doe2Schedule = {
          name,
          type: asString(p["TYPE"])?.toUpperCase(),
          weekSchedules,
          range: cmd.range,
        };
        doc.schedules.push(sched);
        break;
      }

      case "SPACE": {
        const name = cmd.uName ?? `SPACE_${doc.spaces.length + 1}`;
        currentSpaceName = name;
        currentSurfaceName = undefined;
        const area = asNumber(p["AREA"]);
        const height = asNumber(p["HEIGHT"]) ?? asNumber(p["CEILING-HEIGHT"]);
        const volume =
          asNumber(p["VOLUME"]) ?? (area !== undefined && height !== undefined ? area * height : undefined);
        const sp: Doe2Space = {
          name,
          area,
          volume,
          height,
          temperature: asNumber(p["TEMPERATURE"]),
          people: asNumber(p["NUMBER-OF-PEOPLE"]) ?? asNumber(p["PEOPLE"]),
          lightingWPerArea: asNumber(p["LIGHTING-W/AREA"]) ?? asNumber(p["LIGHTING-W/SQFT"]),
          equipmentWPerArea: asNumber(p["EQUIPMENT-W/AREA"]) ?? asNumber(p["EQUIPMENT-W/SQFT"]),
          infiltrationAch: asNumber(p["AIR-CHANGES/HR"]) ?? asNumber(p["INF-METHOD-ACH"]),
          infiltrationCfmPerArea: asNumber(p["INF-FLOW/AREA"]),
          zoneType: asString(p["ZONE-TYPE"])?.toUpperCase(),
          floorWeight: asNumber(p["FLOOR-WEIGHT"]),
          range: cmd.range,
        };
        doc.spaces.push(sp);
        break;
      }

      case "EXTERIOR-WALL":
      case "ROOF":
      case "UNDERGROUND-WALL": {
        const name = cmd.uName ?? `${cmd.normalizedCommand}_${doc.surfaces.length + 1}`;
        const spaceName = asString(p["SPACE"]) ?? currentSpaceName;
        currentSurfaceName = name;
        const width = asNumber(p["WIDTH"]);
        const height = asNumber(p["HEIGHT"]);
        const area = asNumber(p["AREA"]) ?? (width !== undefined && height !== undefined ? width * height : undefined);
        const surf: Doe2Surface = {
          name,
          kind: cmd.normalizedCommand,
          spaceName,
          constructionName: asString(p["CONSTRUCTION"]),
          area,
          width,
          height,
          azimuth: asNumber(p["AZIMUTH"]),
          tilt: asNumber(p["TILT"]) ?? (cmd.normalizedCommand === "ROOF" ? 0 : 90),
          range: cmd.range,
        };
        doc.surfaces.push(surf);
        break;
      }

      case "WINDOW": {
        const name = cmd.uName ?? `WINDOW_${doc.windows.length + 1}`;
        const width = asNumber(p["WIDTH"]);
        const height = asNumber(p["HEIGHT"]);
        const area = asNumber(p["AREA"]) ?? (width !== undefined && height !== undefined ? width * height : undefined);
        const win: Doe2Window = {
          name,
          parentSurfaceName: asString(p["EXTERIOR-WALL"]) ?? asString(p["SURFACE"]) ?? currentSurfaceName,
          spaceName: asString(p["SPACE"]) ?? currentSpaceName,
          glassTypeName: asString(p["GLASS-TYPE"]),
          width,
          height,
          area,
          multiplier: asNumber(p["MULTIPLIER"]) ?? 1,
          range: cmd.range,
        };
        doc.windows.push(win);
        break;
      }

      case "DOOR": {
        const name = cmd.uName ?? `DOOR_${doc.doors.length + 1}`;
        const width = asNumber(p["WIDTH"]);
        const height = asNumber(p["HEIGHT"]);
        const area = asNumber(p["AREA"]) ?? (width !== undefined && height !== undefined ? width * height : undefined);
        const door: Doe2Door = {
          name,
          parentSurfaceName: asString(p["EXTERIOR-WALL"]) ?? asString(p["SURFACE"]) ?? currentSurfaceName,
          spaceName: asString(p["SPACE"]) ?? currentSpaceName,
          constructionName: asString(p["CONSTRUCTION"]),
          width,
          height,
          area,
          range: cmd.range,
        };
        doc.doors.push(door);
        break;
      }

      case "SYSTEM": {
        const name = cmd.uName ?? `SYSTEM_${doc.systems.length + 1}`;
        const zones = asStringList(p["ZONE-NAMES"] ?? p["ZONES"]);
        const eir = asNumber(p["COOLING-EIR"]);
        const cop = asNumber(p["COOLING-COP"]) ?? (eir !== undefined && eir > 0 ? 1 / eir : undefined);
        const sys: Doe2System = {
          name,
          type: (asString(p["TYPE"]) ?? "PSZ").toUpperCase(),
          zones,
          coolingCop: cop,
          coolingEir: eir,
          heatingEff: asNumber(p["FURNACE-HIR"])
            ? 1 / Math.max(0.1, asNumber(p["FURNACE-HIR"])!)
            : asNumber(p["HEATING-EFF"]),
          supplyFanKwPerCfm: asNumber(p["SUPPLY-KW/FLOW"]),
          minOutsideAir: asNumber(p["MIN-OUTSIDE-AIR"]),
          maxSupplyT: asNumber(p["MAX-SUPPLY-T"]),
          minSupplyT: asNumber(p["MIN-SUPPLY-T"]),
          range: cmd.range,
        };
        doc.systems.push(sys);
        currentSystem = sys;
        break;
      }

      case "ZONE": {
        const name = cmd.uName ?? `ZONE_${doc.zones.length + 1}`;
        const spaceName = asString(p["SPACE"]) ?? name;
        const sysName = asString(p["SYSTEM"]) ?? currentSystem?.name;
        const zone: Doe2Zone = {
          name,
          type: asString(p["TYPE"])?.toUpperCase() ?? "CONDITIONED",
          spaceName,
          systemName: sysName,
          designHeatT: asNumber(p["DESIGN-HEAT-T"]),
          designCoolT: asNumber(p["DESIGN-COOL-T"]),
          heatTempSched: asString(p["HEAT-TEMP-SCH"]),
          coolTempSched: asString(p["COOL-TEMP-SCH"]),
          exhaustFlow: asNumber(p["EXHAUST-FLOW"]),
          range: cmd.range,
        };
        doc.zones.push(zone);
        if (currentSystem && !currentSystem.zones.includes(name)) {
          currentSystem.zones.push(name);
        }
        break;
      }

      case "PLANT-EQUIPMENT": {
        const name = cmd.uName ?? `PLANT_${doc.plantEquipment.length + 1}`;
        const pe: Doe2PlantEquipment = {
          name,
          type: (asString(p["TYPE"]) ?? "CHILLER").toUpperCase(),
          size: asNumber(p["SIZE"]),
          installedNumber: asNumber(p["INSTALLED-NUMBER"]),
          efficiency: asNumber(p["EFFICIENCY"]),
          range: cmd.range,
        };
        doc.plantEquipment.push(pe);
        break;
      }

      case "COMPUTE":
        doc.hasCompute = true;
        break;

      case "STOP":
        doc.hasStop = true;
        break;

      default:
        break;
    }
  }

  return doc;
}
