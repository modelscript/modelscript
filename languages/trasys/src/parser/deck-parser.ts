// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Structured NASA TRASYS deck parser.
 *
 * Parses classic TRASYS input decks containing:
 *   - HEADER OPTIONS DATA
 *   - HEADER SURFACE DATA (RECTANGLE, DISK, CYLINDER, CONE, SPHERE, PARABOLOID, POLYGON)
 *   - HEADER ORBIT DATA (PLANET, ALTITUDE, BETA, SOLAR, ALBEDO, PLANETIR)
 *   - HEADER OPERATIONS DATA (FFCAL, RKCAL, QCAL)
 *   - END OF DATA
 *   - Column-1 'C' and '$' comments
 */

import {
  STEFAN_BOLTZMANN,
  type TrasysActiveSide,
  type TrasysDeck,
  type TrasysOperation,
  type TrasysOperationKind,
  type TrasysOpticalProp,
  type TrasysOrbit,
  type TrasysParseError,
  type TrasysSurface,
  type TrasysSurfaceKind,
  type TrasysTransform,
} from "../types.js";

type SectionKind = "NONE" | "OPTIONS" | "SURFACE" | "ORBIT" | "OPERATIONS";

const SURFACE_KINDS = new Set<TrasysSurfaceKind>([
  "RECTANGLE",
  "DISK",
  "CYLINDER",
  "CONE",
  "SPHERE",
  "PARABOLOID",
  "POLYGON",
]);

const OPERATION_KINDS = new Set<TrasysOperationKind>(["FFCAL", "RKCAL", "QCAL"]);

/** Built-in spacecraft thermal coating optical properties (alpha_s, epsilon_IR). */
export const BUILTIN_COATINGS: Record<string, { alpha: number; epsilon: number }> = {
  WHITE_PAINT_Z93: { alpha: 0.17, epsilon: 0.92 },
  Z93: { alpha: 0.17, epsilon: 0.92 },
  SILVER_TEFLON: { alpha: 0.08, epsilon: 0.8 },
  AG_TEFLON: { alpha: 0.08, epsilon: 0.8 },
  GOLD_KAPTON: { alpha: 0.25, epsilon: 0.03 },
  KAPTON_GOLD: { alpha: 0.25, epsilon: 0.03 },
  SOLAR_CELL: { alpha: 0.82, epsilon: 0.85 },
  BLACK_PAINT: { alpha: 0.96, epsilon: 0.9 },
  OPTICAL_SOLAR_REFLECTOR: { alpha: 0.07, epsilon: 0.81 },
  OSR: { alpha: 0.07, epsilon: 0.81 },
  BLACKBODY: { alpha: 1.0, epsilon: 1.0 },
};

const PLANET_DEFAULTS: Record<string, { radiusKm: number; solarFlux: number; albedo: number; planetIr: number }> = {
  EARTH: { radiusKm: 6371.0, solarFlux: 1361.0, albedo: 0.3, planetIr: 237.0 },
  MOON: { radiusKm: 1737.4, solarFlux: 1361.0, albedo: 0.12, planetIr: 10.0 },
  MARS: { radiusKm: 3389.5, solarFlux: 589.0, albedo: 0.25, planetIr: 110.0 },
  VENUS: { radiusKm: 6051.8, solarFlux: 2614.0, albedo: 0.76, planetIr: 155.0 },
};

function defaultTransform(): TrasysTransform {
  return { tx: 0, ty: 0, tz: 0, rotx: 0, roty: 0, rotz: 0 };
}

function defaultProp(): TrasysOpticalProp {
  return { alpha: 0.5, epsilon: 0.8 };
}

function stripInlineComment(line: string): string {
  // Column-1 'C' or 'c' comment (classic Fortran/TRASYS convention: 'C ' or 'C\t' or 'C*' or lone 'C')
  if (/^[Cc](?:[\s*!/-]|$)/.test(line)) {
    return "";
  }
  // Strip '$' comments outside quotes
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "$" && !inSingle && !inDouble) {
      return line.slice(0, i);
    }
  }
  return line;
}

function parseNumber(raw: string): number | undefined {
  const cleaned = raw.trim().replace(/[Dd]([+-]?\d+)/, "e$1");
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

function parseBool(raw: string): boolean {
  const up = raw.trim().toUpperCase();
  return up === "YES" || up === "TRUE" || up === "ON" || up === "1" || up === "Y" || up === "BOTH" || up === "TOP";
}

function parseActiveSide(raw: string): TrasysActiveSide {
  const up = raw.trim().toUpperCase();
  if (up === "TOP" || up === "BOTTOM" || up === "BOTH" || up === "NONE") {
    return up;
  }
  if (up === "YES" || up === "TRUE" || up === "1") return "TOP";
  if (up === "NO" || up === "FALSE" || up === "0") return "NONE";
  return "TOP";
}

function applySurfaceAttributes(
  surf: TrasysSurface,
  attrText: string,
  lineNum: number,
  parseErrors: TrasysParseError[],
): void {
  // Extract polygon vertices if written as (x,y,z) tuples
  if (surf.kind === "POLYGON") {
    const tupleRegex =
      /\(\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?)\s*,\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?)\s*,\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?)\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = tupleRegex.exec(attrText)) !== null) {
      const x = parseNumber(m[1] ?? "");
      const y = parseNumber(m[2] ?? "");
      const z = parseNumber(m[3] ?? "");
      if (x !== undefined && y !== undefined && z !== undefined) {
        if (!surf.vertices) surf.vertices = [];
        surf.vertices.push([x, y, z]);
      }
    }
  }

  // Match PROP = a, b or PROP = COATING_NAME
  const propPairMatch =
    /\bPROP\s*=\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?)\s*,\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?)/i.exec(
      attrText,
    );
  if (propPairMatch) {
    const a = parseNumber(propPairMatch[1] ?? "");
    const e = parseNumber(propPairMatch[2] ?? "");
    if (a !== undefined) surf.prop.alpha = a;
    if (e !== undefined) surf.prop.epsilon = e;
  } else {
    const propNameMatch = /\bPROP\s*=\s*([A-Za-z_][A-Za-z0-9_-]*)/i.exec(attrText);
    if (propNameMatch) {
      const cname = (propNameMatch[1] ?? "").toUpperCase();
      surf.prop.name = cname;
      const preset = BUILTIN_COATINGS[cname];
      if (preset) {
        surf.prop.alpha = preset.alpha;
        surf.prop.epsilon = preset.epsilon;
      }
    }
  }

  // Parse key = value pairs
  const kvRegex = /\b([A-Za-z_][A-Za-z0-9_]*)\s*=\s*("[^"]*"|'[^']*'|[^\s,;()]+)/g;
  let kv: RegExpExecArray | null;
  while ((kv = kvRegex.exec(attrText)) !== null) {
    const key = (kv[1] ?? "").toUpperCase();
    const rawVal = (kv[2] ?? "").replace(/^["']|["']$/g, "");
    const num = parseNumber(rawVal);

    switch (key) {
      case "PROP":
        break; // Already handled above
      case "NODE":
        if (num !== undefined) surf.nodeId = Math.round(num);
        else parseErrors.push({ message: `Invalid NODE value '${rawVal}'`, line: lineNum, column: 1 });
        break;
      case "ALPHA":
      case "ALPHAS":
      case "ABS":
        if (num !== undefined) surf.prop.alpha = num;
        break;
      case "EPS":
      case "EPSILON":
      case "EMIS":
        if (num !== undefined) surf.prop.epsilon = num;
        break;
      case "TRANS":
      case "TAU":
        if (num !== undefined) surf.prop.transmissivity = num;
        break;
      case "SPEC":
        if (num !== undefined) surf.prop.specularity = num;
        break;
      case "ACTIVE":
        surf.active = parseActiveSide(rawVal);
        break;
      case "SHADE":
        surf.shade = parseBool(rawVal);
        break;
      case "TX":
        if (num !== undefined) surf.transform.tx = num;
        break;
      case "TY":
        if (num !== undefined) surf.transform.ty = num;
        break;
      case "TZ":
        if (num !== undefined) surf.transform.tz = num;
        break;
      case "ROTX":
        if (num !== undefined) surf.transform.rotx = num;
        break;
      case "ROTY":
        if (num !== undefined) surf.transform.roty = num;
        break;
      case "ROTZ":
        if (num !== undefined) surf.transform.rotz = num;
        break;
      case "TEMP":
      case "T":
        if (num !== undefined) surf.temperatureK = num;
        break;
      case "QINT":
      case "Q":
        if (num !== undefined) surf.internalHeatW = num;
        break;
      case "NAME":
        surf.name = rawVal;
        break;
      // Dimensions
      case "W":
      case "WIDTH":
      case "DX":
      case "XMAX":
        if (num !== undefined) surf.dims["width"] = num;
        break;
      case "H":
      case "HEIGHT":
      case "DY":
      case "YMAX":
        if (num !== undefined) {
          if (surf.kind === "CYLINDER" || surf.kind === "CONE") surf.dims["length"] = num;
          else if (surf.kind === "PARABOLOID") surf.dims["focalLength"] = num;
          else surf.dims["height"] = num;
        }
        break;
      case "L":
      case "LENGTH":
      case "DZ":
      case "ZMAX":
        if (num !== undefined) surf.dims["length"] = num;
        break;
      case "R":
      case "RADIUS":
      case "RMAX":
      case "R1":
        if (num !== undefined) surf.dims["radius"] = num;
        break;
      case "R2":
      case "RADIUSTOP":
      case "RTOP":
        if (num !== undefined) surf.dims["radiusTop"] = num;
        break;
      case "RMIN":
      case "INNERRADIUS":
      case "RI":
        if (num !== undefined) surf.dims["innerRadius"] = num;
        break;
      case "F":
      case "FOCAL":
      case "FOCALLENGTH":
        if (num !== undefined) surf.dims["focalLength"] = num;
        break;
      default:
        if (num !== undefined) {
          surf.dims[key.toLowerCase()] = num;
        }
        break;
    }
  }
}

/**
 * Parses a TRASYS deck string into a structured `TrasysDeck`.
 */
export function parseTrasysDeck(source: string): TrasysDeck {
  const lines = source.split(/\r?\n/);
  const parseErrors: TrasysParseError[] = [];
  const surfaces: TrasysSurface[] = [];
  const operations: TrasysOperation[] = [];
  const options: TrasysDeck["options"] = {
    units: "SI",
    stefanBoltzmann: STEFAN_BOLTZMANN,
    rays: 10000,
    raw: {},
  };

  let section: SectionKind = "NONE";
  let orbit: TrasysOrbit | undefined;
  let currentSurface: TrasysSurface | undefined;
  let hasEndOfData = false;
  let autoSurfaceIdx = 0;

  let offset = 0;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? "";
    const lineNum = i + 1;
    const lineStart = offset;
    const lineEnd = offset + rawLine.length;
    offset = lineEnd + 1;

    const cleaned = stripInlineComment(rawLine).trim();
    if (!cleaned) continue;

    const upper = cleaned.toUpperCase();

    // Check END OF DATA
    if (/^END\s+OF\s+DATA\b/.test(upper)) {
      hasEndOfData = true;
      currentSurface = undefined;
      section = "NONE";
      continue;
    }

    // Check HEADER cards
    if (/^HEADER\s+OPTIONS\s+DATA\b/.test(upper)) {
      section = "OPTIONS";
      currentSurface = undefined;
      continue;
    }
    if (/^HEADER\s+SURFACE\s+DATA\b/.test(upper)) {
      section = "SURFACE";
      currentSurface = undefined;
      continue;
    }
    if (/^HEADER\s+ORBIT\s+DATA\b/.test(upper)) {
      section = "ORBIT";
      currentSurface = undefined;
      if (!orbit) {
        orbit = {
          planet: "EARTH",
          altitudeKm: 400,
          betaDeg: 0,
          solarFlux: 1361.0,
          albedo: 0.3,
          planetIr: 237.0,
          planetRadiusKm: 6371.0,
          line: lineNum,
        };
      }
      continue;
    }
    if (/^HEADER\s+OPERATIONS\s+DATA\b/.test(upper)) {
      section = "OPERATIONS";
      currentSurface = undefined;
      continue;
    }

    if (section === "OPTIONS") {
      // TITLE = ... or TITLE ...
      const titleMatch = /^TITLE\s*=?\s*(.+)$/i.exec(cleaned);
      if (titleMatch) {
        const val = (titleMatch[1] ?? "").trim().replace(/^["']|["']$/g, "");
        options.title = val;
        options.raw["TITLE"] = val;
        continue;
      }
      const kvRegex = /\b([A-Za-z_][A-Za-z0-9_]*)\s*=\s*("[^"]*"|'[^']*'|[^\s,;]+)/g;
      let kv: RegExpExecArray | null;
      let matched = false;
      while ((kv = kvRegex.exec(cleaned)) !== null) {
        matched = true;
        const key = (kv[1] ?? "").toUpperCase();
        const rawVal = (kv[2] ?? "").replace(/^["']|["']$/g, "");
        const num = parseNumber(rawVal);
        options.raw[key] = num !== undefined ? num : rawVal;
        if (key === "MODEL") options.model = rawVal;
        else if (key === "UNITS") options.units = rawVal.toUpperCase() === "ENG" ? "ENG" : "SI";
        else if (key === "RAYS" && num !== undefined) options.rays = Math.max(1, Math.round(num));
        else if ((key === "SIGMA" || key === "SB") && num !== undefined) options.stefanBoltzmann = num;
      }
      if (!matched) {
        parseErrors.push({ message: `Unrecognized option card '${cleaned}'`, line: lineNum, column: 1 });
      }
      continue;
    }

    if (section === "SURFACE") {
      // Check if line starts a new surface declaration:
      // Formats:
      //   S <id> <KIND> ...
      //   <KIND> <id> ...
      //   <id> <KIND> ...
      const tokens = cleaned.split(/[\s,]+/).filter(Boolean);
      const t0 = (tokens[0] ?? "").toUpperCase();
      const t1 = (tokens[1] ?? "").toUpperCase();
      const t2 = (tokens[2] ?? "").toUpperCase();

      let surfaceKind: TrasysSurfaceKind | undefined;
      let surfaceId: string | undefined;
      let restText = "";

      if (t0 === "S" && tokens.length >= 3 && SURFACE_KINDS.has(t2 as TrasysSurfaceKind)) {
        surfaceId = tokens[1]!;
        surfaceKind = t2 as TrasysSurfaceKind;
        const idx = cleaned.toUpperCase().indexOf(t2);
        restText = cleaned.slice(idx + t2.length).trim();
      } else if (SURFACE_KINDS.has(t0 as TrasysSurfaceKind)) {
        surfaceKind = t0 as TrasysSurfaceKind;
        // If next token is an identifier (not key=val and not a number), treat as surface ID
        if (
          tokens[1] &&
          !tokens[1].includes("=") &&
          parseNumber(tokens[1]) === undefined &&
          !tokens[1].startsWith("(")
        ) {
          surfaceId = tokens[1];
          const idx = cleaned.indexOf(tokens[1], t0.length);
          restText = cleaned.slice(idx + tokens[1].length).trim();
        } else {
          surfaceId = `S${++autoSurfaceIdx}`;
          restText = cleaned.slice(t0.length).trim();
        }
      } else if (tokens.length >= 2 && SURFACE_KINDS.has(t1 as TrasysSurfaceKind) && !t0.includes("=")) {
        surfaceId = tokens[0]!;
        surfaceKind = t1 as TrasysSurfaceKind;
        const idx = cleaned.toUpperCase().indexOf(t1, tokens[0]!.length);
        restText = cleaned.slice(idx + t1.length).trim();
      }

      if (surfaceKind && surfaceId) {
        const surf: TrasysSurface = {
          id: surfaceId,
          kind: surfaceKind,
          prop: defaultProp(),
          active: "TOP",
          shade: true,
          dims: {},
          transform: defaultTransform(),
          startOffset: lineStart,
          endOffset: lineEnd,
          line: lineNum,
        };
        applySurfaceAttributes(surf, restText, lineNum, parseErrors);
        surfaces.push(surf);
        currentSurface = surf;
      } else if (currentSurface) {
        currentSurface.endOffset = lineEnd;
        applySurfaceAttributes(currentSurface, cleaned, lineNum, parseErrors);
      } else {
        parseErrors.push({
          message: `Unexpected card '${cleaned}' in HEADER SURFACE DATA before any surface declaration`,
          line: lineNum,
          column: 1,
        });
      }
      continue;
    }

    if (section === "ORBIT" && orbit) {
      const kvRegex = /\b([A-Za-z_][A-Za-z0-9_]*)\s*=\s*("[^"]*"|'[^']*'|[^\s,;]+)/g;
      let kv: RegExpExecArray | null;
      let matched = false;
      while ((kv = kvRegex.exec(cleaned)) !== null) {
        matched = true;
        const key = (kv[1] ?? "").toUpperCase();
        const rawVal = (kv[2] ?? "").replace(/^["']|["']$/g, "");
        const num = parseNumber(rawVal);

        switch (key) {
          case "PLANET": {
            const p = rawVal.toUpperCase();
            orbit.planet = p;
            const defaults = PLANET_DEFAULTS[p];
            if (defaults) {
              orbit.planetRadiusKm = defaults.radiusKm;
            }
            break;
          }
          case "ALTITUDE":
          case "ALT":
            if (num !== undefined) orbit.altitudeKm = num;
            break;
          case "BETA":
            if (num !== undefined) orbit.betaDeg = num;
            break;
          case "SOLAR":
            if (num !== undefined) orbit.solarFlux = num;
            break;
          case "ALBEDO":
            if (num !== undefined) orbit.albedo = num;
            break;
          case "PLANETIR":
          case "PIR":
          case "IR":
            if (num !== undefined) orbit.planetIr = num;
            break;
          case "RADIUS":
          case "RPLANET":
            if (num !== undefined) orbit.planetRadiusKm = num;
            break;
          default:
            break;
        }
      }
      if (!matched) {
        parseErrors.push({ message: `Unrecognized orbit card '${cleaned}'`, line: lineNum, column: 1 });
      }
      continue;
    }

    if (section === "OPERATIONS") {
      // Supports "FFCAL ...", "CALL FFCAL(...)", "RKCAL", "QCAL"
      const opMatch = /^(?:CALL\s+)?(FFCAL|RKCAL|QCAL)\b(.*)$/i.exec(cleaned);
      if (opMatch) {
        const kind = (opMatch[1] ?? "").toUpperCase() as TrasysOperationKind;
        const tail = (opMatch[2] ?? "").trim();
        const args: Record<string, number | string | boolean> = {};
        const kvRegex = /\b([A-Za-z_][A-Za-z0-9_]*)\s*=\s*("[^"]*"|'[^']*'|[^\s,;()]+)/g;
        let kv: RegExpExecArray | null;
        while ((kv = kvRegex.exec(tail)) !== null) {
          const k = (kv[1] ?? "").toUpperCase();
          const v = (kv[2] ?? "").replace(/^["']|["']$/g, "");
          const n = parseNumber(v);
          args[k] = n !== undefined ? n : v;
        }
        if (OPERATION_KINDS.has(kind)) {
          operations.push({ kind, args, line: lineNum });
        }
      } else {
        parseErrors.push({ message: `Unknown operation card '${cleaned}'`, line: lineNum, column: 1 });
      }
      continue;
    }

    // Outside any HEADER block
    parseErrors.push({
      message: `Statement '${cleaned}' outside a HEADER DATA block`,
      line: lineNum,
      column: 1,
    });
  }

  const name = options.model ?? options.title ?? "TrasysModel";

  return {
    name,
    options,
    surfaces,
    orbit,
    operations,
    hasEndOfData,
    parseErrors,
  };
}
