// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * RS-274X / Gerber X2 & Excellon Drill Importer.
 *
 * Inverse of `gerber.ts` — parses Gerber aperture definitions, draw/flash
 * commands (D01/D02/D03), and Excellon drill hits into canonical
 * `TraceSegment[]`, `PadDefinition[]`, and `ViaDefinition[]` for CAM/DFM
 * verification.
 */

import type { PadDefinition, TraceSegment, ViaDefinition } from "./gerber.js";

export interface GerberParseResult {
  layer: string;
  units: "mm" | "inch";
  traces: TraceSegment[];
  pads: PadDefinition[];
}

export interface ExcellonParseResult {
  units: "mm" | "inch";
  holes: ViaDefinition[];
}

interface ApertureDef {
  shape: PadDefinition["shape"];
  width: number;
  height: number;
}

/**
 * Parses an RS-274X / Gerber X2 copper layer file into `TraceSegment[]` and
 * `PadDefinition[]` normalized to millimeters.
 */
export function parseGerber(text: string, layer = "TopCopper"): GerberParseResult {
  let units: "mm" | "inch" = "mm";
  let scale = 1.0;
  let intDigits = 4;
  let decDigits = 6;

  const apertures = new Map<number, ApertureDef>();
  let currentAperture = 10;
  let curX = 0;
  let curY = 0;

  const traces: TraceSegment[] = [];
  const pads: PadDefinition[] = [];

  const decodeCoord = (raw: string): number => {
    const sign = raw.startsWith("-") ? -1 : 1;
    const digits = raw.replace(/^[+-]/, "");
    const val = Number.parseInt(digits, 10) / Math.pow(10, decDigits);
    return sign * val * scale;
  };

  // Split into extended commands (%...%) and normal commands (...*)
  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("G04")) continue;

    // Units: %MOMM*% or %MOIN*%
    if (line.includes("%MOIN")) {
      units = "inch";
      scale = 25.4;
      continue;
    }
    if (line.includes("%MOMM")) {
      units = "mm";
      scale = 1.0;
      continue;
    }

    // Format specification: %FSLAX46Y46*%
    const fsMatch = /%FS[LT][AI]X(\d)(\d)Y(\d)(\d)\*%/.exec(line);
    if (fsMatch) {
      intDigits = Number.parseInt(fsMatch[1]!, 10);
      decDigits = Number.parseInt(fsMatch[2]!, 10);
      void intDigits;
      continue;
    }

    // Aperture definition: %ADD10C,0.2500*% or %ADD11R,1.5000X0.6000*%
    const adMatch = /%ADD(\d+)([CRO]),([0-9.]+)(?:X([0-9.]+))?\*%/.exec(line);
    if (adMatch) {
      const code = Number.parseInt(adMatch[1]!, 10);
      const kind = adMatch[2]!;
      const w = Number.parseFloat(adMatch[3]!) * scale;
      const h = adMatch[4] ? Number.parseFloat(adMatch[4]) * scale : w;
      const shape: PadDefinition["shape"] = kind === "C" ? "circle" : kind === "O" ? "oval" : "rect";
      apertures.set(code, { shape, width: w, height: h });
      continue;
    }

    // Aperture select: D10* or G54D10*
    const selMatch = /^(?:G54)?D(\d{2,})\*$/.exec(line);
    if (selMatch) {
      currentAperture = Number.parseInt(selMatch[1]!, 10);
      continue;
    }

    // Coordinate operation: X...Y...D01* / D02* / D03*
    const opMatch = /^(?:G01)?(?:X([+-]?\d+))?(?:Y([+-]?\d+))?D0([123])\*$/.exec(line);
    if (opMatch) {
      const nextX = opMatch[1] !== undefined ? decodeCoord(opMatch[1]) : curX;
      const nextY = opMatch[2] !== undefined ? decodeCoord(opMatch[2]) : curY;
      const op = opMatch[3]!;
      const ap = apertures.get(currentAperture) ?? { shape: "circle" as const, width: 0.25, height: 0.25 };

      if (op === "1") {
        traces.push({
          start: [curX, curY],
          end: [nextX, nextY],
          width: ap.width,
          layer,
          net: "",
        });
      } else if (op === "3") {
        pads.push({
          center: [nextX, nextY],
          shape: ap.shape,
          width: ap.width,
          height: ap.height,
          drill: 0,
          layer,
          net: "",
          component: "",
        });
      }
      curX = nextX;
      curY = nextY;
    }
  }

  return { layer, units, traces, pads };
}

/**
 * Parses an Excellon NC drill file into `ViaDefinition[]` normalized to mm.
 */
export function parseExcellon(text: string): ExcellonParseResult {
  let units: "mm" | "inch" = "mm";
  let scale = 1.0;
  const tools = new Map<number, number>();
  let activeTool = 1;
  const holes: ViaDefinition[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";")) continue;

    if (line.startsWith("INCH")) {
      units = "inch";
      scale = 25.4;
      continue;
    }
    if (line.startsWith("METRIC")) {
      units = "mm";
      scale = 1.0;
      continue;
    }

    const toolDef = /^T(\d+)C([0-9.]+)/.exec(line);
    if (toolDef) {
      tools.set(Number.parseInt(toolDef[1]!, 10), Number.parseFloat(toolDef[2]!) * scale);
      continue;
    }

    const toolSel = /^T(\d+)$/.exec(line);
    if (toolSel) {
      activeTool = Number.parseInt(toolSel[1]!, 10);
      continue;
    }

    const hit = /^X([+-]?[0-9.]+)Y([+-]?[0-9.]+)$/.exec(line);
    if (hit) {
      const drill = tools.get(activeTool) ?? 0.3;
      holes.push({
        center: [Number.parseFloat(hit[1]!) * scale, Number.parseFloat(hit[2]!) * scale],
        drill,
        annularRing: 0.15,
        net: "",
      });
    }
  }

  return { units, holes };
}
