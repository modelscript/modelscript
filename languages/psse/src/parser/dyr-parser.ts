// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PsseDyrCase, PsseDyrCategory, PsseDyrRecord, SourceSpan } from "../types.js";

/**
 * Schema metadata for standard IEEE / PSS/E dynamic models in `.dyr` files.
 */
export interface DyrModelSchema {
  model: string;
  category: PsseDyrCategory;
  title: string;
  description: string;
  params: Array<{ name: string; unit: string; description: string }>;
}

export const DYR_MODEL_SCHEMAS: Record<string, DyrModelSchema> = {
  GENCLS: {
    model: "GENCLS",
    category: "generator",
    title: "Classical Constant-Flux Synchronous Generator Model",
    description: "Second-order classical swing equation generator model (constant voltage behind transient reactance).",
    params: [
      { name: "H", unit: "MW·s/MVA", description: "Inertia constant H (0.0 = infinite bus)" },
      { name: "D", unit: "p.u.", description: "Speed damping factor D" },
    ],
  },
  GENROU: {
    model: "GENROU",
    category: "generator",
    title: "Round-Rotor Synchronous Generator Model (Subtransient)",
    description: "Sixth-order solid-rotor synchronous machine model with d/q-axis transient and subtransient dynamics.",
    params: [
      { name: "Td0p", unit: "s", description: "d-axis transient open-circuit time constant T'd0" },
      { name: "Td0pp", unit: "s", description: "d-axis subtransient open-circuit time constant T''d0" },
      { name: "Tq0p", unit: "s", description: "q-axis transient open-circuit time constant T'q0" },
      { name: "Tq0pp", unit: "s", description: "q-axis subtransient open-circuit time constant T''q0" },
      { name: "H", unit: "MW·s/MVA", description: "Inertia constant H" },
      { name: "D", unit: "p.u.", description: "Speed damping coefficient D" },
      { name: "Xd", unit: "p.u.", description: "d-axis synchronous reactance Xd" },
      { name: "Xq", unit: "p.u.", description: "q-axis synchronous reactance Xq" },
      { name: "Xdp", unit: "p.u.", description: "d-axis transient reactance X'd" },
      { name: "Xqp", unit: "p.u.", description: "q-axis transient reactance X'q" },
      { name: "Xdpp", unit: "p.u.", description: "Subtransient reactance X''d = X''q" },
      { name: "Xl", unit: "p.u.", description: "Stator leakage reactance Xl" },
      { name: "S10", unit: "p.u.", description: "Saturation factor S(1.0)" },
      { name: "S12", unit: "p.u.", description: "Saturation factor S(1.2)" },
    ],
  },
  GENSAL: {
    model: "GENSAL",
    category: "generator",
    title: "Salient-Pole Synchronous Generator Model (Subtransient)",
    description: "Fifth-order salient-pole hydro/low-speed synchronous generator model.",
    params: [
      { name: "Td0p", unit: "s", description: "d-axis transient open-circuit time constant T'd0" },
      { name: "Td0pp", unit: "s", description: "d-axis subtransient open-circuit time constant T''d0" },
      { name: "Tq0pp", unit: "s", description: "q-axis subtransient open-circuit time constant T''q0" },
      { name: "H", unit: "MW·s/MVA", description: "Inertia constant H" },
      { name: "D", unit: "p.u.", description: "Speed damping coefficient D" },
      { name: "Xd", unit: "p.u.", description: "d-axis synchronous reactance Xd" },
      { name: "Xq", unit: "p.u.", description: "q-axis synchronous reactance Xq" },
      { name: "Xdp", unit: "p.u.", description: "d-axis transient reactance X'd" },
      { name: "Xdpp", unit: "p.u.", description: "Subtransient reactance X''d = X''q" },
      { name: "Xl", unit: "p.u.", description: "Stator leakage reactance Xl" },
      { name: "S10", unit: "p.u.", description: "Saturation factor S(1.0)" },
      { name: "S12", unit: "p.u.", description: "Saturation factor S(1.2)" },
    ],
  },
  EXST1: {
    model: "EXST1",
    category: "exciter",
    title: "IEEE Type ST1A Potential-Source Controlled-Rectifier Exciter",
    description: "Static excitation system with lead-lag compensation and voltage regulator limits.",
    params: [
      { name: "TR", unit: "s", description: "Voltage transducer filter time constant TR" },
      { name: "VIMAX", unit: "p.u.", description: "Maximum voltage error input limit VIMAX" },
      { name: "VIMIN", unit: "p.u.", description: "Minimum voltage error input limit VIMIN" },
      { name: "TC", unit: "s", description: "Lead time constant TC" },
      { name: "TB", unit: "s", description: "Lag time constant TB" },
      { name: "KA", unit: "p.u.", description: "Voltage regulator gain KA" },
      { name: "TA", unit: "s", description: "Voltage regulator time constant TA" },
      { name: "VRMAX", unit: "p.u.", description: "Maximum regulator output VRMAX" },
      { name: "VRMIN", unit: "p.u.", description: "Minimum regulator output VRMIN" },
      { name: "KC", unit: "p.u.", description: "Rectifier loading factor KC" },
      { name: "KF", unit: "p.u.", description: "Rate feedback gain KF" },
      { name: "TF", unit: "s", description: "Rate feedback time constant TF" },
    ],
  },
  IEEET1: {
    model: "IEEET1",
    category: "exciter",
    title: "IEEE 1968 Type 1 DC Commutator Excitation System",
    description: "Continuously acting regulator and DC generator exciter with saturation and rate feedback.",
    params: [
      { name: "TR", unit: "s", description: "Transducer filter time constant TR" },
      { name: "KA", unit: "p.u.", description: "Regulator gain KA" },
      { name: "TA", unit: "s", description: "Regulator amplifier time constant TA" },
      { name: "VRMAX", unit: "p.u.", description: "Maximum regulator output VRMAX" },
      { name: "VRMIN", unit: "p.u.", description: "Minimum regulator output VRMIN" },
      { name: "KE", unit: "p.u.", description: "Exciter constant KE" },
      { name: "TE", unit: "s", description: "Exciter time constant TE" },
      { name: "KF", unit: "p.u.", description: "Stabilizer feedback gain KF" },
      { name: "TF", unit: "s", description: "Stabilizer feedback time constant TF" },
    ],
  },
  SEXS: {
    model: "SEXS",
    category: "exciter",
    title: "Simplified Excitation System Model",
    description: "General simplified excitation system with lead-lag and first-order gain block.",
    params: [
      { name: "TATB", unit: "ratio", description: "Lead-lag ratio TA/TB" },
      { name: "TB", unit: "s", description: "Lag time constant TB" },
      { name: "K", unit: "p.u.", description: "Exciter gain K" },
      { name: "TE", unit: "s", description: "Exciter time constant TE" },
      { name: "EMIN", unit: "p.u.", description: "Minimum field voltage output EMIN" },
      { name: "EMAX", unit: "p.u.", description: "Maximum field voltage output EMAX" },
    ],
  },
  TGOV1: {
    model: "TGOV1",
    category: "governor",
    title: "Steam Turbine-Governor Model with Reheat",
    description: "Speed governor droop, main steam control valve, and reheat time constants.",
    params: [
      { name: "R", unit: "p.u.", description: "Permanent droop R (speed regulation)" },
      { name: "T1", unit: "s", description: "Steam bowl / valve time constant T1" },
      { name: "VMAX", unit: "p.u.", description: "Maximum valve position limit VMAX" },
      { name: "VMIN", unit: "p.u.", description: "Minimum valve position limit VMIN" },
      { name: "T2", unit: "s", description: "Reheat lead time constant T2" },
      { name: "T3", unit: "s", description: "Reheater time constant T3" },
      { name: "DT", unit: "p.u.", description: "Turbine damping coefficient DT" },
    ],
  },
  HYGOV: {
    model: "HYGOV",
    category: "governor",
    title: "Hydro Turbine-Governor Model",
    description: "Hydraulic turbine and penstock water-hammer model with temporary & permanent droop.",
    params: [
      { name: "R", unit: "p.u.", description: "Permanent droop R" },
      { name: "r", unit: "p.u.", description: "Temporary droop r" },
      { name: "Tr", unit: "s", description: "Governor reset time constant Tr" },
      { name: "Tf", unit: "s", description: "Filter time constant Tf" },
      { name: "Tg", unit: "s", description: "Servo time constant Tg" },
      { name: "VELM", unit: "p.u./s", description: "Gate velocity limit VELM" },
      { name: "GMAX", unit: "p.u.", description: "Maximum gate limit GMAX" },
      { name: "GMIN", unit: "p.u.", description: "Minimum gate limit GMIN" },
      { name: "TW", unit: "s", description: "Water starting time constant TW" },
      { name: "At", unit: "p.u.", description: "Turbine gain At" },
      { name: "Dturb", unit: "p.u.", description: "Turbine damping factor Dturb" },
      { name: "qnl", unit: "p.u.", description: "No-load water flow qnl" },
    ],
  },
  IEEEST: {
    model: "IEEEST",
    category: "stabilizer",
    title: "IEEE Power System Stabilizer (PSS)",
    description: "Washout filter and dual lead-lag phase compensation power system stabilizer.",
    params: [
      { name: "A1", unit: "s", description: "High-frequency filter constant A1" },
      { name: "A2", unit: "s²", description: "High-frequency filter constant A2" },
      { name: "T1", unit: "s", description: "First lead time constant T1" },
      { name: "T2", unit: "s", description: "First lag time constant T2" },
      { name: "T3", unit: "s", description: "Second lead time constant T3" },
      { name: "T4", unit: "s", description: "Second lag time constant T4" },
      { name: "T5", unit: "s", description: "Washout numerator time constant T5" },
      { name: "T6", unit: "s", description: "Washout denominator time constant T6" },
      { name: "KS", unit: "p.u.", description: "Stabilizer gain KS" },
      { name: "LSMAX", unit: "p.u.", description: "Maximum stabilizer output LSMAX" },
      { name: "LSMIN", unit: "p.u.", description: "Minimum stabilizer output LSMIN" },
    ],
  },
};

function classifyDyrModel(modelName: string): PsseDyrCategory {
  const upper = modelName.toUpperCase();
  const schema = DYR_MODEL_SCHEMAS[upper];
  if (schema) return schema.category;
  if (upper.startsWith("GEN") || upper.startsWith("REG")) return "generator";
  if (upper.startsWith("EX") || upper.startsWith("IEEE") || upper.startsWith("ES") || upper.startsWith("SEXS")) {
    return "exciter";
  }
  if (upper.startsWith("TG") || upper.startsWith("HY") || upper.startsWith("GG") || upper.startsWith("GAST")) {
    return "governor";
  }
  if (upper.startsWith("PSS") || upper.startsWith("STAB")) return "stabilizer";
  return "user";
}

function tokenizeDyrRecord(text: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;
  let quoteChar = "";

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === quoteChar) {
        inQuotes = false;
        tokens.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      if (current.trim().length > 0) {
        tokens.push(current.trim());
        current = "";
      }
      inQuotes = true;
      quoteChar = ch;
      continue;
    }

    if (ch === "," || ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      if (current.trim().length > 0) {
        tokens.push(current.trim());
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (current.trim().length > 0) {
    tokens.push(current.trim());
  }
  return tokens;
}

/**
 * Checks whether a document string looks like a PSS/E `.dyr` dynamic model file
 * rather than a `.raw` power-flow file.
 */
export function isLikelyDyrContent(source: string): boolean {
  const lines = source.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//") || line.startsWith("@!") || line.startsWith("/*")) continue;
    // A .dyr record starts with an integer bus number followed by a quoted model name like 'GENROU' or 'GENCLS'
    if (/^\d+\s*[,\s]\s*'(?:GEN|EX|TG|HY|IEEE|SEXS|PSS|USR|REG)/i.test(line)) {
      return true;
    }
    return false;
  }
  return false;
}

/**
 * Parses a PSS/E `.dyr` Dynamic Data file into structured dynamic equipment records.
 * Supports multi-line records terminated by `/` as well as single-line records.
 */
export function parseDyr(source: string): PsseDyrCase {
  const records: PsseDyrRecord[] = [];
  const generatorsByBusId = new Map<string, PsseDyrRecord>();
  const excitersByBusId = new Map<string, PsseDyrRecord>();
  const governorsByBusId = new Map<string, PsseDyrRecord>();
  const stabilizersByBusId = new Map<string, PsseDyrRecord>();

  const lines = source.split(/\r?\n/);
  let currentBuffer = "";
  let recordStartOffset = 0;
  let recordStartLine = 1;
  let currentOffset = 0;

  const flushRecord = (rawChunk: string, startOffset: number, endOffset: number, lineNum: number) => {
    const cleaned = rawChunk.trim();
    if (!cleaned || /^0(?:\s|$|,)/.test(cleaned) || /^Q\b/i.test(cleaned)) return;

    const tokens = tokenizeDyrRecord(cleaned);
    if (tokens.length < 3) return;

    const ibus = Number.parseInt(tokens[0] ?? "0", 10);
    if (!Number.isFinite(ibus) || ibus <= 0) return;

    // Handle USRMDL vs standard `IBUS 'MODEL' ID CON(1)...`
    let model = (tokens[1] ?? "").toUpperCase();
    let id = tokens[2] ?? "1";
    let conStartIdx = 3;

    if (model === "USRMDL" && tokens.length >= 4) {
      id = tokens[2] ?? "1";
      model = (tokens[3] ?? "USRMDL").toUpperCase();
      // Skip IC, IT, NI, NC, NS, NV integers if present before CONs
      conStartIdx = Math.min(tokens.length, 10);
    }

    const con: number[] = [];
    for (let k = conStartIdx; k < tokens.length; k++) {
      const val = Number.parseFloat(tokens[k]!);
      if (Number.isFinite(val)) {
        con.push(val);
      }
    }

    const category = classifyDyrModel(model);
    const schema = DYR_MODEL_SCHEMAS[model];
    const namedParams: Record<string, number> = {};
    if (schema) {
      for (let idx = 0; idx < schema.params.length && idx < con.length; idx++) {
        const paramMeta = schema.params[idx]!;
        namedParams[paramMeta.name] = con[idx]!;
      }
    }

    const span: SourceSpan = {
      startOffset,
      endOffset,
      line: lineNum,
      column: 1,
    };

    const rec: PsseDyrRecord = {
      ibus,
      model,
      id: id.trim() || "1",
      category,
      con,
      namedParams,
      span,
    };

    records.push(rec);
    const key = `${ibus}_${rec.id}`;
    if (category === "generator") {
      generatorsByBusId.set(key, rec);
      if (!generatorsByBusId.has(String(ibus))) {
        generatorsByBusId.set(String(ibus), rec);
      }
    } else if (category === "exciter") {
      excitersByBusId.set(key, rec);
      if (!excitersByBusId.has(String(ibus))) {
        excitersByBusId.set(String(ibus), rec);
      }
    } else if (category === "governor") {
      governorsByBusId.set(key, rec);
      if (!governorsByBusId.has(String(ibus))) {
        governorsByBusId.set(String(ibus), rec);
      }
    } else if (category === "stabilizer") {
      stabilizersByBusId.set(key, rec);
      if (!stabilizersByBusId.has(String(ibus))) {
        stabilizersByBusId.set(String(ibus), rec);
      }
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;
    const lineNum = i + 1;
    const lineStart = currentOffset;
    const lineEnd = currentOffset + rawLine.length;
    currentOffset = lineEnd + 1;

    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("@!") || trimmed.startsWith("/*")) {
      continue;
    }

    if (currentBuffer.length === 0) {
      recordStartOffset = lineStart;
      recordStartLine = lineNum;
    }

    // Find slash terminator outside of quotes
    let slashIdx = -1;
    let inQuotes = false;
    let qChar = "";
    for (let c = 0; c < rawLine.length; c++) {
      const ch = rawLine[c]!;
      if (inQuotes) {
        if (ch === qChar) inQuotes = false;
      } else if (ch === "'" || ch === '"') {
        inQuotes = true;
        qChar = ch;
      } else if (ch === "/") {
        slashIdx = c;
        break;
      }
    }

    if (slashIdx >= 0) {
      currentBuffer += " " + rawLine.slice(0, slashIdx);
      flushRecord(currentBuffer, recordStartOffset, lineStart + slashIdx + 1, recordStartLine);
      currentBuffer = "";
    } else {
      // Check if the next non-empty line starts a new record (single-line .dyr without trailing '/')
      currentBuffer += " " + rawLine;
      const nextLine = lines[i + 1]?.trim() ?? "";
      if (!nextLine || /^\d+\s*[,\s]\s*'/.test(nextLine)) {
        flushRecord(currentBuffer, recordStartOffset, lineEnd, recordStartLine);
        currentBuffer = "";
      }
    }
  }

  if (currentBuffer.trim().length > 0) {
    flushRecord(currentBuffer, recordStartOffset, currentOffset, recordStartLine);
  }

  return {
    records,
    generatorsByBusId,
    excitersByBusId,
    governorsByBusId,
    stabilizersByBusId,
  };
}

/**
 * Serializes a `PsseDyrCase` back to canonical PSS/E `.dyr` text format.
 */
export function writeDyr(dyr: PsseDyrCase): string {
  const lines: string[] = [];
  for (const rec of dyr.records) {
    const paddedModel = `'${rec.model.padEnd(6, " ")}'`;
    const conStr = rec.con.map((v) => Number(v.toPrecision(6)).toString()).join(" ");
    lines.push(`${rec.ibus} ${paddedModel} ${rec.id} ${conStr} /`);
  }
  return lines.join("\n") + "\n";
}
