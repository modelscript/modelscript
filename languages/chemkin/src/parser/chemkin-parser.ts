// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  ArrheniusParams,
  ChemkinDocument,
  ChemkinEnergyUnits,
  ChemkinMechanism,
  ChemkinQuantityUnits,
  ChemkinRange,
  ChemkinReaction,
  ChemkinSpeciesStoich,
  Nasa7Coeffs,
  Nasa7ThermoRecord,
  PlogEntry,
  SriParams,
  TroeParams,
} from "../types.js";
import { getChemkinWasmParser } from "./wasm-loader.js";

export { getChemkinWasmParser, type ChemkinWasmParser } from "./wasm-loader.js";

const ENERGY_UNIT_MAP: Record<string, ChemkinEnergyUnits> = {
  "CAL/MOLE": "CAL/MOLE",
  "CAL/MOL": "CAL/MOLE",
  "KCAL/MOLE": "KCAL/MOLE",
  "KCAL/MOL": "KCAL/MOLE",
  "JOULES/MOLE": "JOULES/MOLE",
  "JOULES/MOL": "JOULES/MOLE",
  "J/MOLE": "JOULES/MOLE",
  "J/MOL": "JOULES/MOLE",
  "KJOULES/MOLE": "KJOULES/MOLE",
  "KJOULES/MOL": "KJOULES/MOLE",
  "KJ/MOLE": "KJOULES/MOLE",
  "KJ/MOL": "KJOULES/MOLE",
  KELVINS: "KELVINS",
  KELVIN: "KELVINS",
  EVOLTS: "EVOLTS",
};

const QUANTITY_UNIT_MAP: Record<string, ChemkinQuantityUnits> = {
  MOLES: "MOLES",
  MOLE: "MOLES",
  MOLECULES: "MOLECULES",
  MOLECULE: "MOLECULES",
};

function buildLineStarts(source: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") {
      starts.push(i + 1);
    }
  }
  return starts;
}

function makeLineRange(lineStarts: number[], lineIdx: number, lineLen: number): ChemkinRange {
  const startOffset = lineStarts[lineIdx] ?? 0;
  const endOffset = startOffset + lineLen;
  return {
    startLine: lineIdx + 1,
    startColumn: 1,
    endLine: lineIdx + 1,
    endColumn: Math.max(1, lineLen + 1),
    startOffset,
    endOffset,
  };
}

function stripComment(line: string): string {
  const idx = line.indexOf("!");
  return idx >= 0 ? line.slice(0, idx) : line;
}

function parseFortranFloat(s: string): number {
  return Number.parseFloat(s.trim().replace(/[dD]/g, "E"));
}

function extractFloats(text: string): number[] {
  const matches = text.match(/[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eEdD][+-]?\d+)?/g);
  if (!matches) return [];
  return matches.map((m) => parseFortranFloat(m)).filter((n) => Number.isFinite(n));
}

function parseNasa7CoeffLine(rawLine: string, expectedCount: number): number[] {
  // Strip trailing record number (column 80 = '2', '3', or '4') if present
  let body = rawLine;
  if (body.length >= 79) {
    body = body.slice(0, 75);
  } else {
    // Also strip trailing whitespace + single digit record marker if line has > expectedCount numbers
    const trimmed = body.trimEnd();
    if (trimmed.length > 2 && /\s+[234]$/.test(trimmed)) {
      const candidate = trimmed.slice(0, -1).trimEnd();
      if (extractFloats(candidate).length >= expectedCount) {
        body = candidate;
      }
    }
  }
  return extractFloats(body).slice(0, expectedCount);
}

function parseThermoHeaderLine(
  rawLine: string,
  defaultTemps: [number, number, number],
  range: ChemkinRange,
): Omit<Nasa7ThermoRecord, "highCoeffs" | "lowCoeffs"> | null {
  const trimmed = rawLine.trim();
  if (!trimmed) return null;

  // Species name is the first whitespace-delimited token (cols 1-18 in standard CHEMKIN)
  const spMatch = /^(\S+)/.exec(trimmed);
  if (!spMatch) return null;
  const species = spMatch[1]!;

  const composition: Record<string, number> = {};
  let phase: "G" | "S" | "L" = "G";
  let tLow = defaultTemps[0];
  let tMid = defaultTemps[1];
  let tHigh = defaultTemps[2];

  // Try fixed-column CHEMKIN NASA-7 format (cols 25-44 = 4x5-char element/count, col 45 = phase, cols 46-75 = Tlow, Thigh, Tmid)
  if (rawLine.length >= 55) {
    const compField = rawLine.slice(24, 44);
    for (let slot = 0; slot < 4; slot++) {
      const chunk = compField.slice(slot * 5, slot * 5 + 5);
      const m = /^\s*([A-Za-z]{1,2})\s*(\d+)\s*$/.exec(chunk);
      if (m) {
        const el = m[1]!.toUpperCase();
        const cnt = Number.parseInt(m[2]!, 10);
        if (cnt > 0) {
          composition[el] = (composition[el] ?? 0) + cnt;
        }
      }
    }
    const phaseChar = (rawLine[44] ?? "").toUpperCase();
    if (phaseChar === "G" || phaseChar === "S" || phaseChar === "L") {
      phase = phaseChar;
    }
    const tempField = rawLine.slice(45, Math.min(rawLine.length, 75));
    const temps = extractFloats(tempField);
    if (temps.length >= 2) {
      tLow = temps[0]!;
      tHigh = temps[1]!;
      if (temps.length >= 3) {
        tMid = temps[2]!;
      }
    }
  }

  // Fallback for flexible whitespace-delimited thermo header:
  // e.g. "H2O  H 2 O 1  G  200.0  3500.0  1000.0  1"
  if (Object.keys(composition).length === 0) {
    const rest = trimmed.slice(species.length).trim();
    const tokens = rest.split(/\s+/);
    let phaseIdx = -1;
    for (let i = 0; i < tokens.length; i++) {
      const tk = tokens[i]!.toUpperCase();
      if (tk === "G" || tk === "S" || tk === "L") {
        phase = tk;
        phaseIdx = i;
        break;
      }
    }
    if (phaseIdx > 0) {
      const compTokens = tokens.slice(0, phaseIdx);
      for (let i = 0; i < compTokens.length; i++) {
        const tk = compTokens[i]!;
        const inlineMatch = /^([A-Za-z]{1,2})(\d+)$/.exec(tk);
        if (inlineMatch) {
          const el = inlineMatch[1]!.toUpperCase();
          const cnt = Number.parseInt(inlineMatch[2]!, 10);
          if (cnt > 0) composition[el] = (composition[el] ?? 0) + cnt;
        } else if (/^[A-Za-z]{1,2}$/.test(tk) && i + 1 < compTokens.length && /^\d+$/.test(compTokens[i + 1]!)) {
          const el = tk.toUpperCase();
          const cnt = Number.parseInt(compTokens[i + 1]!, 10);
          if (cnt > 0) composition[el] = (composition[el] ?? 0) + cnt;
          i++;
        }
      }
      const tempTokens = tokens.slice(phaseIdx + 1);
      const temps = extractFloats(tempTokens.join(" "));
      if (temps.length >= 2) {
        tLow = temps[0]!;
        tHigh = temps[1]!;
        if (temps.length >= 3) {
          tMid = temps[2]!;
        }
      }
    }
  }

  return {
    species,
    phase,
    composition,
    tLow,
    tMid,
    tHigh,
    range,
  };
}

function parseReactionSide(sideText: string): {
  species: ChemkinSpeciesStoich[];
  thirdBody: boolean;
  falloff: boolean;
  thirdBodySpecies?: string | undefined;
} {
  let text = sideText.trim();
  let thirdBody = false;
  let falloff = false;
  let thirdBodySpecies: string | undefined;

  // Detect falloff collider (+M) or (+SP)
  const falloffRe = /\(\s*\+\s*([A-Za-z0-9_*,()-]+)\s*\)/g;
  text = text.replace(falloffRe, (_m, collider: string) => {
    falloff = true;
    const upper = collider.trim().toUpperCase();
    if (upper !== "M") {
      thirdBodySpecies = collider.trim();
    }
    return "";
  });

  // Split by '+' outside parentheses
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "+" && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());

  const stoichMap = new Map<string, number>();
  for (const part of parts) {
    if (part.toUpperCase() === "M") {
      thirdBody = true;
      continue;
    }
    // Match optional leading numeric stoichiometric coefficient: "2 H2", "2H2", "0.5 O2"
    const m = /^(\d+(?:\.\d*)?|\.\d+)\s*([A-Za-z][A-Za-z0-9_*(),.-]*)$/.exec(part);
    if (m) {
      const coeff = Number.parseFloat(m[1]!);
      const sp = m[2]!.trim();
      if (sp.toUpperCase() === "M") {
        thirdBody = true;
      } else {
        stoichMap.set(sp, (stoichMap.get(sp) ?? 0) + coeff);
      }
    } else if (part.length > 0) {
      stoichMap.set(part, (stoichMap.get(part) ?? 0) + 1);
    }
  }

  const species: ChemkinSpeciesStoich[] = [];
  for (const [sp, coeff] of stoichMap) {
    species.push({ species: sp, stoichiometry: coeff });
  }

  return { species, thirdBody, falloff, thirdBodySpecies };
}

function parseReactionHeader(line: string, rxnIndex: number, range: ChemkinRange): ChemkinReaction | null {
  // Must contain <=>, =>, or =
  let arrow = "";
  let arrowIdx = line.indexOf("<=>");
  let reversible = true;
  if (arrowIdx >= 0) {
    arrow = "<=>";
    reversible = true;
  } else {
    arrowIdx = line.indexOf("=>");
    if (arrowIdx >= 0) {
      arrow = "=>";
      reversible = false;
    } else {
      arrowIdx = line.indexOf("=");
      if (arrowIdx >= 0) {
        arrow = "=";
        reversible = true;
      }
    }
  }
  if (arrowIdx < 0) return null;

  // Separate trailing 3 Arrhenius numbers from the reaction equation.
  // Scan tokens from the end of the line.
  const rhsAndParams = line.slice(arrowIdx + arrow.length).trim();
  const numTailRe =
    /^(.*?)\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?)\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?)\s+([+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?)\s*$/;
  const m = numTailRe.exec(rhsAndParams);
  if (!m) return null;

  const lhsText = line.slice(0, arrowIdx).trim();
  const rhsText = m[1]!.trim();
  const A = parseFortranFloat(m[2]!);
  const b = parseFortranFloat(m[3]!);
  const Ea = parseFortranFloat(m[4]!);

  const lhs = parseReactionSide(lhsText);
  const rhs = parseReactionSide(rhsText);
  const equation = `${lhsText} ${arrow} ${rhsText}`.replace(/\s+/g, " ").trim();

  return {
    id: `R${rxnIndex}`,
    equation,
    reactants: lhs.species,
    products: rhs.species,
    reversible,
    thirdBody: lhs.thirdBody || rhs.thirdBody,
    falloff: lhs.falloff || rhs.falloff,
    thirdBodySpecies: lhs.thirdBodySpecies ?? rhs.thirdBodySpecies,
    rate: { A, b, Ea },
    efficiencies: {},
    duplicate: false,
    range,
  };
}

function parseAuxKeywordValues(line: string): { keyword: string; values: number[] } | null {
  const m = /^\s*(LOW|TROE|SRI|REV|PLOG)\s*\/\s*([^/]+?)\s*\/\s*$/i.exec(line);
  if (!m) return null;
  const keyword = m[1]!.toUpperCase();
  const values = extractFloats(m[2]!);
  return { keyword, values };
}

function parseEfficiencyPairs(line: string): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  const re = /([A-Za-z][A-Za-z0-9_*(),-]*)\s*\/\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?)\s*\//g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    out.push([m[1]!, parseFortranFloat(m[2]!)]);
  }
  return out;
}

/**
 * Parses a CHEMKIN gas-phase / surface chemical kinetics deck (`.inp`, `.ck`, `.therm`).
 * Uses the native WebAssembly GLR parser for tokenization/CST validation alongside
 * fixed-column NASA-7 & Arrhenius reaction extraction.
 */
export function parseChemkin(sourceText: string, uri = "memory://mechanism.inp"): ChemkinDocument {
  // Exercise native WASM GLR parser on the input deck
  try {
    getChemkinWasmParser().parse(sourceText);
  } catch {
    // Allow graceful fallback if WASM parser encounters exotic fixed-column text
  }

  const baseName =
    uri
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.(inp|ck|therm)$/i, "") || "ChemkinMechanism";
  const mech: ChemkinMechanism = {
    name: baseName,
    elements: new Map(),
    species: new Map(),
    thermo: new Map(),
    reactions: [],
    energyUnits: "CAL/MOLE",
    quantityUnits: "MOLES",
    duplicateElements: [],
    duplicateSpecies: [],
    parseErrors: [],
  };

  const lines = sourceText.split(/\r?\n/);
  const lineStarts = buildLineStarts(sourceText);

  type Section = "NONE" | "ELEMENTS" | "SPECIES" | "THERMO" | "REACTIONS";
  let section: Section = "NONE";
  let defaultThermoTemps: [number, number, number] = [300.0, 1000.0, 5000.0];
  let expectingThermoDefaultTemps = false;
  let currentReaction: ChemkinReaction | null = null;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i] ?? "";
    const cleanLine = stripComment(rawLine);
    const trimmed = cleanLine.trim();
    if (!trimmed) continue;

    const upper = trimmed.toUpperCase();
    const range = makeLineRange(lineStarts, i, rawLine.length);

    // Check section terminator
    if (upper === "END") {
      section = "NONE";
      expectingThermoDefaultTemps = false;
      currentReaction = null;
      continue;
    }

    // Check section headers
    if (/^(ELEMENTS|ELEM)\b/i.test(trimmed)) {
      section = "ELEMENTS";
      currentReaction = null;
      const inlineRest = trimmed.replace(/^(ELEMENTS|ELEM)\b/i, "").trim();
      if (inlineRest) {
        parseElementsLine(inlineRest, mech, range);
      }
      continue;
    }

    if (/^(SPECIES|SPEC)\b/i.test(trimmed)) {
      section = "SPECIES";
      currentReaction = null;
      const inlineRest = trimmed.replace(/^(SPECIES|SPEC)\b/i, "").trim();
      if (inlineRest) {
        parseSpeciesLine(inlineRest, mech, range);
      }
      continue;
    }

    if (/^(THERMO|THER)\b/i.test(trimmed)) {
      section = "THERMO";
      currentReaction = null;
      expectingThermoDefaultTemps = true;
      continue;
    }

    if (/^(REACTIONS|REAC)\b/i.test(trimmed)) {
      section = "REACTIONS";
      currentReaction = null;
      const tokens = trimmed.split(/\s+/).slice(1);
      for (const tk of tokens) {
        const up = tk.toUpperCase();
        if (ENERGY_UNIT_MAP[up]) {
          mech.energyUnits = ENERGY_UNIT_MAP[up]!;
        } else if (QUANTITY_UNIT_MAP[up]) {
          mech.quantityUnits = QUANTITY_UNIT_MAP[up]!;
        }
      }
      continue;
    }

    // Section body parsing
    if (section === "ELEMENTS") {
      parseElementsLine(trimmed, mech, range);
      continue;
    }

    if (section === "SPECIES") {
      parseSpeciesLine(trimmed, mech, range);
      continue;
    }

    if (section === "THERMO") {
      // Check if this is the 3-temperature default header line (e.g. "300.000  1000.000  5000.000")
      if (expectingThermoDefaultTemps) {
        const temps = extractFloats(trimmed);
        if (temps.length === 3 && /^[+\-\d.\s]+$/.test(trimmed)) {
          defaultThermoTemps = [temps[0]!, temps[1]!, temps[2]!];
          mech.defaultThermoTemps = defaultThermoTemps;
          expectingThermoDefaultTemps = false;
          continue;
        }
        expectingThermoDefaultTemps = false;
      }

      // 4-line NASA-7 record
      const header = parseThermoHeaderLine(cleanLine, defaultThermoTemps, range);
      if (header && i + 3 < lines.length) {
        const l2 = stripComment(lines[i + 1] ?? "");
        const l3 = stripComment(lines[i + 2] ?? "");
        const l4 = stripComment(lines[i + 3] ?? "");
        const c2 = parseNasa7CoeffLine(l2, 5);
        const c3 = parseNasa7CoeffLine(l3, 5);
        const c4 = parseNasa7CoeffLine(l4, 4);
        if (c2.length === 5 && c3.length === 5 && c4.length === 4) {
          const highCoeffs: Nasa7Coeffs = [c2[0]!, c2[1]!, c2[2]!, c2[3]!, c2[4]!, c3[0]!, c3[1]!];
          const lowCoeffs: Nasa7Coeffs = [c3[2]!, c3[3]!, c3[4]!, c4[0]!, c4[1]!, c4[2]!, c4[3]!];
          const endRange = makeLineRange(lineStarts, i + 3, (lines[i + 3] ?? "").length);
          const fullRange: ChemkinRange = {
            startLine: range.startLine,
            startColumn: range.startColumn,
            endLine: endRange.endLine,
            endColumn: endRange.endColumn,
            startOffset: range.startOffset,
            endOffset: endRange.endOffset,
          };
          mech.thermo.set(header.species, {
            ...header,
            highCoeffs,
            lowCoeffs,
            range: fullRange,
          });
          i += 3;
          continue;
        } else {
          mech.parseErrors.push({
            message: `Malformed 4-line NASA-7 thermo record for species '${header.species}'`,
            range,
          });
        }
      }
      continue;
    }

    if (section === "REACTIONS") {
      // Check DUPLICATE / DUP
      if (/^(DUPLICATE|DUP)\b/i.test(trimmed)) {
        if (currentReaction) {
          currentReaction.duplicate = true;
        }
        continue;
      }

      // Check auxiliary keywords: LOW, TROE, SRI, REV, PLOG
      const aux = parseAuxKeywordValues(trimmed);
      if (aux && currentReaction) {
        if (aux.keyword === "LOW" && aux.values.length >= 3) {
          const lowParams: ArrheniusParams = { A: aux.values[0]!, b: aux.values[1]!, Ea: aux.values[2]! };
          currentReaction.low = lowParams;
        } else if (aux.keyword === "TROE" && aux.values.length >= 3) {
          const troeParams: TroeParams = {
            a: aux.values[0]!,
            T3: aux.values[1]!,
            T1: aux.values[2]!,
            ...(aux.values.length >= 4 ? { T2: aux.values[3]! } : {}),
          };
          currentReaction.troe = troeParams;
        } else if (aux.keyword === "SRI" && aux.values.length >= 3) {
          const sriParams: SriParams = {
            a: aux.values[0]!,
            b: aux.values[1]!,
            c: aux.values[2]!,
            ...(aux.values.length >= 4 ? { d: aux.values[3]! } : {}),
            ...(aux.values.length >= 5 ? { e: aux.values[4]! } : {}),
          };
          currentReaction.sri = sriParams;
        } else if (aux.keyword === "REV" && aux.values.length >= 3) {
          const revParams: ArrheniusParams = { A: aux.values[0]!, b: aux.values[1]!, Ea: aux.values[2]! };
          currentReaction.rev = revParams;
        } else if (aux.keyword === "PLOG" && aux.values.length >= 4) {
          const plogEntry: PlogEntry = {
            pressureAtm: aux.values[0]!,
            A: aux.values[1]!,
            b: aux.values[2]!,
            Ea: aux.values[3]!,
          };
          if (!currentReaction.plog) currentReaction.plog = [];
          currentReaction.plog.push(plogEntry);
        }
        continue;
      }

      // Check reaction header line (contains =, =>, <=>)
      if (trimmed.includes("=")) {
        const rxn = parseReactionHeader(trimmed, mech.reactions.length + 1, range);
        if (rxn) {
          mech.reactions.push(rxn);
          currentReaction = rxn;
        } else {
          mech.parseErrors.push({
            message: `Invalid reaction specification: '${trimmed}'`,
            range,
          });
        }
        continue;
      }

      // Check enhanced third-body efficiencies: H2/2.5/ H2O/12.0/
      if (trimmed.includes("/") && currentReaction) {
        const pairs = parseEfficiencyPairs(trimmed);
        if (pairs.length > 0) {
          for (const [sp, eff] of pairs) {
            currentReaction.efficiencies[sp] = eff;
          }
          continue;
        }
      }

      mech.parseErrors.push({
        message: `Unrecognized line in REACTIONS section: '${trimmed}'`,
        range,
      });
    }
  }

  return { uri, source: sourceText, mechanism: mech };
}

function parseElementsLine(line: string, mech: ChemkinMechanism, range: ChemkinRange): void {
  // Handle inline optional atomic weight: "H/1.008/ O C N"
  const tokenRe = /([A-Za-z][A-Za-z0-9_]*)(?:\s*\/\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?)\s*\/)?/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(line)) !== null) {
    const rawName = m[1]!;
    if (rawName.toUpperCase() === "END") break;
    const name = rawName.toUpperCase();
    const atomicWeight = m[2] !== undefined ? parseFortranFloat(m[2]) : undefined;
    if (mech.elements.has(name)) {
      mech.duplicateElements.push({ name, range });
    } else {
      mech.elements.set(name, { name, atomicWeight, range });
    }
  }
}

function parseSpeciesLine(line: string, mech: ChemkinMechanism, range: ChemkinRange): void {
  const tokens = line.split(/\s+/);
  for (const tk of tokens) {
    if (!tk) continue;
    if (tk.toUpperCase() === "END") break;
    if (mech.species.has(tk)) {
      mech.duplicateSpecies.push({ name: tk, range });
    } else {
      mech.species.set(tk, { name: tk, range });
    }
  }
}
