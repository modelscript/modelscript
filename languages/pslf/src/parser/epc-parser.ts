// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * GE PSLF Extended Power flow Card (.epc) Parser.
 */

import type {
  PslfArea,
  PslfBranch,
  PslfBus,
  PslfEpcCase,
  PslfGenerator,
  PslfLoad,
  PslfShunt,
  PslfTransformer,
  PslfZone,
} from "../types.js";

/**
 * Tokenizes a single EPC record line, handling quoted strings and whitespace/comma delimiters.
 */
export function tokenizeEpcLine(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;

    if (inQuote) {
      if (ch === quoteChar) {
        tokens.push(current);
        current = "";
        inQuote = false;
      } else {
        current += ch;
      }
    } else if (ch === "'" || ch === '"') {
      if (current.trim().length > 0) {
        tokens.push(current.trim());
        current = "";
      }
      inQuote = true;
      quoteChar = ch;
    } else if (ch === "," || ch === " " || ch === "\t") {
      if (current.trim().length > 0) {
        tokens.push(current.trim());
        current = "";
      }
    } else {
      current += ch;
    }
  }

  if (current.trim().length > 0) {
    tokens.push(current.trim());
  }

  return tokens;
}

/**
 * Parses a GE PSLF .epc power flow file.
 */
export function parsePslfEpc(content: string): PslfEpcCase {
  const lines = content.split(/\r?\n/);
  const buses = new Map<number, PslfBus>();
  const generators: PslfGenerator[] = [];
  const loads: PslfLoad[] = [];
  const shunts: PslfShunt[] = [];
  const branches: PslfBranch[] = [];
  const transformers: PslfTransformer[] = [];
  const areas: PslfArea[] = [];
  const zones: PslfZone[] = [];

  let title1 = "GE PSLF Base Case";
  let title2 = "";
  let mbaseMva = 100.0;
  let baseFreqHz = 60.0;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const rawLine = lines[lineIdx]!.trim();
    if (rawLine.length === 0) continue;

    // Comments
    if (rawLine.startsWith("c ") || rawLine.startsWith("C ") || rawLine.startsWith("//") || rawLine.startsWith("#")) {
      continue;
    }

    const tokens = tokenizeEpcLine(rawLine);
    if (tokens.length === 0) continue;

    const card = tokens[0]!.toLowerCase();

    // Case Header / Parameters
    if (card === "case" || card === "title") {
      if (tokens[1]) title1 = tokens.slice(1).join(" ");
      continue;
    }

    // Bus Card: b <num> '<name>' <kv> <ide> <area> <zone> <vm> <va> <vmax> <vmin>
    if (card === "b") {
      const busNumber = parseInt(tokens[1] ?? "0", 10);
      const name = tokens[2] ?? `BUS_${busNumber}`;
      const baseKv = parseFloat(tokens[3] ?? "115.0");
      const busType = parseInt(tokens[4] ?? "1", 10);
      const area = parseInt(tokens[5] ?? "1", 10);
      const zone = parseInt(tokens[6] ?? "1", 10);
      const vmPu = parseFloat(tokens[7] ?? "1.0");
      const vaDeg = parseFloat(tokens[8] ?? "0.0");
      const vmax = parseFloat(tokens[9] ?? "1.1");
      const vmin = parseFloat(tokens[10] ?? "0.9");

      buses.set(busNumber, {
        busNumber,
        name,
        baseKv,
        busType,
        area,
        zone,
        vmPu,
        vaDeg,
        vmax,
        vmin,
      });
      continue;
    }

    // Generator Card: g <num> '<id>' <stat> <pg> <qg> <qmax> <qmin> <vsch> <mbase> <rSource> <xSource> <pmax> <pmin>
    if (card === "g") {
      const busNumber = parseInt(tokens[1] ?? "0", 10);
      const genId = tokens[2] ?? "1";
      const status = parseInt(tokens[3] ?? "1", 10);
      const pgMw = parseFloat(tokens[4] ?? "0.0");
      const qgMvar = parseFloat(tokens[5] ?? "0.0");
      const qmaxMvar = parseFloat(tokens[6] ?? "999.0");
      const qminMvar = parseFloat(tokens[7] ?? "-999.0");
      const vschedPu = parseFloat(tokens[8] ?? "1.0");
      const genMbase = parseFloat(tokens[9] ?? "100.0");
      const rSource = parseFloat(tokens[10] ?? "0.0");
      const xSource = parseFloat(tokens[11] ?? "0.2");
      const pmaxMw = parseFloat(tokens[12] ?? (pgMw > 0 ? (pgMw * 1.1).toFixed(1) : "999.0"));
      const pminMw = parseFloat(tokens[13] ?? "0.0");

      generators.push({
        busNumber,
        genId,
        status,
        pgMw,
        qgMvar,
        qmaxMvar,
        qminMvar,
        pmaxMw,
        pminMw,
        vschedPu,
        mbaseMva: genMbase,
        rSource,
        xSource,
      });
      continue;
    }

    // Load Card: ld <num> '<id>' <stat> <pl> <ql> ... OR l <bus> '<id>' when single bus
    if (card === "ld" || (card === "l" && isNaN(parseInt(tokens[2] ?? "", 10)))) {
      const busNumber = parseInt(tokens[1] ?? "0", 10);
      const loadId = tokens[2] ?? "1";
      const status = parseInt(tokens[3] ?? "1", 10);
      const plMw = parseFloat(tokens[4] ?? "0.0");
      const qlMvar = parseFloat(tokens[5] ?? "0.0");
      const ipMw = parseFloat(tokens[6] ?? "0.0");
      const iqMvar = parseFloat(tokens[7] ?? "0.0");
      const ypMw = parseFloat(tokens[8] ?? "0.0");
      const yqMvar = parseFloat(tokens[9] ?? "0.0");
      const area = parseInt(tokens[10] ?? "1", 10);
      const zone = parseInt(tokens[11] ?? "1", 10);

      loads.push({
        busNumber,
        loadId,
        status,
        plMw,
        qlMvar,
        ipMw,
        iqMvar,
        ypMw,
        yqMvar,
        area,
        zone,
      });
      continue;
    }

    // Shunt Card: s <num> '<id>' <stat> <g> <b>
    if (card === "s" || card === "sh") {
      const busNumber = parseInt(tokens[1] ?? "0", 10);
      const shuntId = tokens[2] ?? "1";
      const status = parseInt(tokens[3] ?? "1", 10);
      const gMw = parseFloat(tokens[4] ?? "0.0");
      const bMvar = parseFloat(tokens[5] ?? "0.0");

      shunts.push({
        busNumber,
        shuntId,
        status,
        gMw,
        bMvar,
      });
      continue;
    }

    // Transmission Line Card: ln <from> <to> '<ckt>' <stat> <r> <x> <b> <rate1> <rate2> <rate3>
    // Or 'l' with two numeric bus arguments
    if (card === "ln" || (card === "l" && !isNaN(parseInt(tokens[2] ?? "", 10)))) {
      const fromBus = parseInt(tokens[1] ?? "0", 10);
      const toBus = parseInt(tokens[2] ?? "0", 10);
      const circuitId = tokens[3] ?? "1";
      const status = parseInt(tokens[4] ?? "1", 10);
      const rPu = parseFloat(tokens[5] ?? "0.01");
      const xPu = parseFloat(tokens[6] ?? "0.05");
      const bPu = parseFloat(tokens[7] ?? "0.0");
      const rate1Mva = parseFloat(tokens[8] ?? "999.0");
      const rate2Mva = parseFloat(tokens[9] ?? rate1Mva.toString());
      const rate3Mva = parseFloat(tokens[10] ?? rate1Mva.toString());

      branches.push({
        fromBus,
        toBus,
        circuitId,
        status,
        rPu,
        xPu,
        bPu,
        rate1Mva,
        rate2Mva,
        rate3Mva,
      });
      continue;
    }

    // Transformer Card: t <from> <to> '<ckt>' <stat> <r> <x> <ratio> <phase> <rate1> <rate2> <rate3>
    if (card === "t" || card === "xf") {
      const fromBus = parseInt(tokens[1] ?? "0", 10);
      const toBus = parseInt(tokens[2] ?? "0", 10);
      const circuitId = tokens[3] ?? "1";
      const status = parseInt(tokens[4] ?? "1", 10);
      const rPu = parseFloat(tokens[5] ?? "0.005");
      const xPu = parseFloat(tokens[6] ?? "0.08");
      const ratio = parseFloat(tokens[7] ?? "1.0");
      const phaseDeg = parseFloat(tokens[8] ?? "0.0");
      const rate1Mva = parseFloat(tokens[9] ?? "999.0");
      const rate2Mva = parseFloat(tokens[10] ?? rate1Mva.toString());
      const rate3Mva = parseFloat(tokens[11] ?? rate1Mva.toString());

      transformers.push({
        fromBus,
        toBus,
        circuitId,
        status,
        rPu,
        xPu,
        ratio,
        phaseDeg,
        rate1Mva,
        rate2Mva,
        rate3Mva,
      });
      continue;
    }

    // Area Card: a <areaNumber> <slackBus> <desiredMw> <tolMw> '<name>'
    if (card === "a") {
      const areaNumber = parseInt(tokens[1] ?? "1", 10);
      const slackBus = parseInt(tokens[2] ?? "0", 10);
      const desiredNetInterchangeMw = parseFloat(tokens[3] ?? "0.0");
      const toleranceMw = parseFloat(tokens[4] ?? "10.0");
      const name = tokens[5] ?? `Area_${areaNumber}`;

      areas.push({
        areaNumber,
        slackBus,
        desiredNetInterchangeMw,
        toleranceMw,
        name,
      });
      continue;
    }

    // Zone Card: z <zoneNumber> '<name>'
    if (card === "z") {
      const zoneNumber = parseInt(tokens[1] ?? "1", 10);
      const name = tokens[2] ?? `Zone_${zoneNumber}`;
      zones.push({ zoneNumber, name });
      continue;
    }
  }

  return {
    title1,
    title2,
    mbaseMva,
    baseFreqHz,
    buses,
    generators,
    loads,
    shunts,
    branches,
    transformers,
    areas,
    zones,
  };
}
