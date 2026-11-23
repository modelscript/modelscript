// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/scale — Semantic Parser for ORNL SCALE / KENO V.a-VI / ORIGEN Decks.
 */

import { normalizeNuclideId } from "../catalog/scale-std-schemas.js";
import {
  KNOWN_SCALE_SEQUENCES,
  type KenoArrayDef,
  type KenoGeometryBody,
  type KenoUnit,
  type OrigenCase,
  type OrigenMaterialNuclide,
  type OrigenTimeSpec,
  type ScaleBoundsBlock,
  type ScaleDeck,
  type ScaleRange,
  type ScaleSequenceType,
} from "../types.js";

interface SourceLine {
  lineNo: number;
  raw: string;
  clean: string;
  offset: number;
}

const TIME_UNIT_TO_SECONDS: Record<OrigenTimeSpec["unit"], number> = {
  seconds: 1,
  minutes: 60,
  hours: 3600,
  days: 86400,
  years: 365.25 * 86400,
};

function stripComment(line: string): string {
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "'" && !inQuotes) {
      return line.slice(0, i);
    }
  }
  return line;
}

function makeLineRange(line: SourceLine): ScaleRange {
  return {
    startLine: line.lineNo,
    startColumn: 1,
    endLine: line.lineNo,
    endColumn: Math.max(1, line.raw.length),
    startOffset: line.offset,
    endOffset: line.offset + line.raw.length,
  };
}

function classifySequence(seqName: string): ScaleSequenceType {
  const lower = seqName.toLowerCase();
  if (
    lower === "csas6" ||
    lower === "csas5" ||
    lower === "csas25" ||
    lower === "csas26" ||
    lower === "origen" ||
    lower === "t-depl" ||
    lower === "t5-depl" ||
    lower === "t6-depl" ||
    lower === "triton"
  ) {
    return lower;
  }
  return "unknown";
}

function parseNumber(tok: string | undefined): number | undefined {
  if (tok === undefined) return undefined;
  const cleaned = tok.replace(/,/g, "");
  if (!/^[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/.test(cleaned)) return undefined;
  const v = Number(cleaned);
  return Number.isFinite(v) ? v : undefined;
}

function expandRepeatTokens(tokens: string[]): number[] {
  const out: number[] = [];
  for (const tok of tokens) {
    const rep = /^(\d+)\*([-+]?\d+)$/.exec(tok);
    if (rep) {
      const count = Number.parseInt(rep[1]!, 10);
      const val = Number.parseInt(rep[2]!, 10);
      for (let i = 0; i < count; i++) out.push(val);
      continue;
    }
    const n = parseNumber(tok);
    if (n !== undefined) out.push(Math.trunc(n));
  }
  return out;
}

function parseOrigin(tokens: string[]): [number, number, number] | undefined {
  const idx = tokens.findIndex((t) => t.toLowerCase() === "origin");
  if (idx < 0) return undefined;
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = idx + 1; i < tokens.length; i++) {
    const t = tokens[i]!;
    const kv = /^([xyz])=(.+)$/i.exec(t);
    if (kv) {
      const v = parseNumber(kv[2]);
      if (v !== undefined) {
        const axis = kv[1]!.toLowerCase();
        if (axis === "x") x = v;
        else if (axis === "y") y = v;
        else if (axis === "z") z = v;
      }
    }
  }
  return [x, y, z];
}

function parseCompLines(lines: SourceLine[], deck: ScaleDeck): void {
  // Accumulate statements terminated by 'end' or single-line entries
  const statements: Array<{ tokens: string[]; line: SourceLine }> = [];
  let curTokens: string[] = [];
  let curStartLine: SourceLine | undefined;

  for (const line of lines) {
    const tokens = line.clean.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    if (!curStartLine) curStartLine = line;
    for (const tok of tokens) {
      if (tok.toLowerCase() === "end") {
        if (curTokens.length > 0 && curStartLine) {
          statements.push({ tokens: curTokens, line: curStartLine });
        }
        curTokens = [];
        curStartLine = undefined;
      } else {
        curTokens.push(tok);
      }
    }
  }
  if (curTokens.length > 0 && curStartLine) {
    statements.push({ tokens: curTokens, line: curStartLine });
  }

  for (const stmt of statements) {
    const { tokens, line } = stmt;
    if (tokens.length < 2) continue;
    const materialName = tokens[0]!;
    const mixIdNum = parseNumber(tokens[1]);
    if (mixIdNum === undefined) continue;
    const mixtureId = Math.trunc(mixIdNum);

    let density: number | undefined;
    let volumeFraction: number | undefined;
    let temperature: number | undefined;
    let enrichment: number | undefined;
    const isotopes: Record<string, number> = {};

    const positionalNums: number[] = [];
    let i = 2;
    while (i < tokens.length) {
      const tok = tokens[i]!;
      const kv = /^([a-zA-Z0-9_-]+)=(.+)$/.exec(tok);
      if (kv) {
        const key = kv[1]!.toLowerCase();
        const val = parseNumber(kv[2]);
        if (val !== undefined) {
          if (key === "den" || key === "density") density = val;
          else if (key === "temp" || key === "temperature") temperature = val;
          else if (key === "vf" || key === "volfrac") volumeFraction = val;
          else if (key === "enrich" || key === "enrichment") enrichment = val;
          else isotopes[normalizeNuclideId(kv[1]!)] = val;
        }
        i++;
        continue;
      }
      // Check ZAID isotope pair: e.g. 92235 4.0
      const num = parseNumber(tok);
      if (num !== undefined && Number.isInteger(num) && num >= 1000 && i + 1 < tokens.length) {
        const pct = parseNumber(tokens[i + 1]);
        if (pct !== undefined) {
          const isoId = normalizeNuclideId(String(num));
          isotopes[isoId] = pct;
          if (num === 92235 && enrichment === undefined) {
            enrichment = pct;
          }
          i += 2;
          continue;
        }
      }
      if (num !== undefined) {
        positionalNums.push(num);
      }
      i++;
    }

    // Standard SCALE positional conventions after den=...: [vf, temp]
    if (volumeFraction === undefined && positionalNums.length >= 1) {
      volumeFraction = positionalNums[0];
    }
    if (temperature === undefined && positionalNums.length >= 2) {
      temperature = positionalNums[1];
    }

    deck.compositions.push({
      materialName,
      mixtureId,
      density,
      volumeFraction,
      temperature,
      enrichment,
      isotopes,
      rawLine: line.raw.trim(),
      range: makeLineRange(line),
    });
  }
}

function parseCellDataLines(lines: SourceLine[], deck: ScaleDeck): void {
  for (const line of lines) {
    const trimmed = line.clean.trim();
    if (!trimmed) continue;
    const tokens = trimmed.split(/\s+/).filter((t) => t.toLowerCase() !== "end");
    if (tokens.length === 0) continue;
    const cellType = tokens[0]!;
    const parameters: Record<string, number | string> = {};
    for (let i = 1; i < tokens.length; i++) {
      const tok = tokens[i]!;
      const kv = /^([a-zA-Z0-9_-]+)=(.+)$/.exec(tok);
      if (kv) {
        const n = parseNumber(kv[2]);
        parameters[kv[1]!.toLowerCase()] = n !== undefined ? n : kv[2]!;
      } else {
        parameters[`arg${i}`] = parseNumber(tok) ?? tok;
      }
    }
    deck.cellData.push({
      cellType,
      parameters,
      rawLine: trimmed,
      range: makeLineRange(line),
    });
  }
}

function parseParamLines(lines: SourceLine[], deck: ScaleDeck): void {
  for (const line of lines) {
    const tokens = line.clean.trim().split(/\s+/).filter(Boolean);
    for (const tok of tokens) {
      const kv = /^([a-zA-Z0-9_-]+)=(.+)$/.exec(tok);
      if (kv) {
        const key = kv[1]!.toLowerCase();
        const n = parseNumber(kv[2]);
        deck.params.parameters[key] = n !== undefined ? n : kv[2]!;
      }
    }
  }
}

function parseBoundsLines(lines: SourceLine[], range: ScaleRange): ScaleBoundsBlock {
  const bounds: ScaleBoundsBlock = { rawEntries: {}, range };
  for (const line of lines) {
    const tokens = line.clean.trim().split(/\s+/).filter(Boolean);
    for (const tok of tokens) {
      const kv = /^([a-zA-Z0-9_+-]+)=(.+)$/.exec(tok);
      if (!kv) continue;
      const key = kv[1]!.toLowerCase();
      const val = kv[2]!.toLowerCase();
      bounds.rawEntries[key] = val;
      if (key === "all") bounds.all = val;
      else if (key === "x-" || key === "xb") bounds.xMinus = val;
      else if (key === "x+" || key === "xf") bounds.xPlus = val;
      else if (key === "y-" || key === "yl") bounds.yMinus = val;
      else if (key === "y+" || key === "yr") bounds.yPlus = val;
      else if (key === "z-" || key === "zb") bounds.zMinus = val;
      else if (key === "z+" || key === "zt") bounds.zPlus = val;
    }
  }
  return bounds;
}

function parseGeomLines(lines: SourceLine[], deck: ScaleDeck): void {
  let currentUnit: KenoUnit | undefined;

  for (const line of lines) {
    const trimmed = line.clean.trim();
    if (!trimmed) continue;
    const tokens = trimmed.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;

    const first = tokens[0]!.toLowerCase();
    const second = tokens[1]?.toLowerCase();

    // global unit <id> | unit <id>
    if ((first === "global" && second === "unit") || first === "unit") {
      const isGlobal = first === "global";
      const idTok = isGlobal ? tokens[2] : tokens[1];
      const idNum = parseNumber(idTok);
      if (idNum !== undefined) {
        const unitId = Math.trunc(idNum);
        const range = makeLineRange(line);
        if (deck.units.has(unitId)) {
          deck.duplicateUnitIds.push({ id: unitId, range });
        }
        const unit: KenoUnit = {
          id: unitId,
          isGlobal,
          bodies: [],
          media: [],
          holes: [],
          arrayPlacements: [],
          range,
        };
        deck.units.set(unitId, unit);
        currentUnit = unit;
      }
      continue;
    }

    if (!currentUnit) continue;

    if (first === "cylinder" || first === "zcylinder") {
      const id = parseNumber(tokens[1]);
      const r = parseNumber(tokens[2]);
      const zPlus = parseNumber(tokens[3]);
      const zMinus = parseNumber(tokens[4]);
      if (id !== undefined) {
        const body: KenoGeometryBody = {
          id: Math.trunc(id),
          kind: "cylinder",
          radius: r,
          zPlus,
          zMinus,
          origin: parseOrigin(tokens),
          rawLine: trimmed,
          range: makeLineRange(line),
        };
        currentUnit.bodies.push(body);
      }
      continue;
    }

    if (first === "sphere") {
      const id = parseNumber(tokens[1]);
      const r = parseNumber(tokens[2]);
      if (id !== undefined) {
        currentUnit.bodies.push({
          id: Math.trunc(id),
          kind: "sphere",
          radius: r,
          origin: parseOrigin(tokens),
          rawLine: trimmed,
          range: makeLineRange(line),
        });
      }
      continue;
    }

    if (first === "cuboid") {
      const id = parseNumber(tokens[1]);
      const xPlus = parseNumber(tokens[2]);
      const xMinus = parseNumber(tokens[3]);
      const yPlus = parseNumber(tokens[4]);
      const yMinus = parseNumber(tokens[5]);
      const zPlus = parseNumber(tokens[6]);
      const zMinus = parseNumber(tokens[7]);
      if (id !== undefined) {
        currentUnit.bodies.push({
          id: Math.trunc(id),
          kind: "cuboid",
          xPlus,
          xMinus,
          yPlus,
          yMinus,
          zPlus,
          zMinus,
          origin: parseOrigin(tokens),
          rawLine: trimmed,
          range: makeLineRange(line),
        });
      }
      continue;
    }

    if (first === "hexprism") {
      const id = parseNumber(tokens[1]);
      const apothem = parseNumber(tokens[2]);
      const zPlus = parseNumber(tokens[3]);
      const zMinus = parseNumber(tokens[4]);
      if (id !== undefined) {
        currentUnit.bodies.push({
          id: Math.trunc(id),
          kind: "hexprism",
          radius: apothem,
          zPlus,
          zMinus,
          origin: parseOrigin(tokens),
          rawLine: trimmed,
          range: makeLineRange(line),
        });
      }
      continue;
    }

    if (first === "media") {
      const mixId = parseNumber(tokens[1]);
      const vf = parseNumber(tokens[2]);
      if (mixId !== undefined && vf !== undefined) {
        const regions: number[] = [];
        for (let i = 3; i < tokens.length; i++) {
          const reg = parseNumber(tokens[i]);
          if (reg !== undefined) regions.push(Math.trunc(reg));
        }
        currentUnit.media.push({
          mixtureId: Math.trunc(mixId),
          volumeFraction: vf,
          regions,
          rawLine: trimmed,
          range: makeLineRange(line),
        });
      }
      continue;
    }

    if (first === "hole") {
      const unitId = parseNumber(tokens[1]);
      if (unitId !== undefined) {
        const origin = parseOrigin(tokens) ?? [
          parseNumber(tokens[2]) ?? 0,
          parseNumber(tokens[3]) ?? 0,
          parseNumber(tokens[4]) ?? 0,
        ];
        currentUnit.holes.push({
          unitId: Math.trunc(unitId),
          origin,
          range: makeLineRange(line),
        });
      }
      continue;
    }

    if (first === "array") {
      const arrayId = parseNumber(tokens[1]);
      const regionId = parseNumber(tokens[2]);
      if (arrayId !== undefined) {
        currentUnit.arrayPlacements.push({
          arrayId: Math.trunc(arrayId),
          regionId: regionId !== undefined ? Math.trunc(regionId) : 1,
          origin: parseOrigin(tokens),
          range: makeLineRange(line),
        });
      }
      continue;
    }

    if (first === "boundary") {
      const bodyId = parseNumber(tokens[1]);
      if (bodyId !== undefined) {
        currentUnit.boundaryBodyId = Math.trunc(bodyId);
      }
      continue;
    }
  }
}

function parseArrayLines(lines: SourceLine[], deck: ScaleDeck): void {
  const fullText = lines.map((l) => l.clean).join(" ");
  const tokens = fullText.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  let current: KenoArrayDef | undefined;

  const commitCurrent = () => {
    if (!current) return;
    if (deck.arrays.has(current.id)) {
      deck.duplicateArrayIds.push({ id: current.id, range: current.range });
    }
    deck.arrays.set(current.id, current);
  };

  while (i < tokens.length) {
    const tok = tokens[i]!;
    const lower = tok.toLowerCase();
    const kv = /^([a-zA-Z]+)=(.+)$/.exec(tok);
    if (kv) {
      const key = kv[1]!.toLowerCase();
      const val = kv[2]!;
      if (key === "ara") {
        commitCurrent();
        const idNum = parseNumber(val);
        current = {
          id: idNum !== undefined ? Math.trunc(idNum) : deck.arrays.size + 1,
          araType: idNum === undefined ? val : "square",
          nux: 1,
          nuy: 1,
          nuz: 1,
          fill: [],
          range: lines[0] ? makeLineRange(lines[0]) : undefined,
        };
      } else if (current) {
        const num = parseNumber(val);
        if (key === "nux" && num !== undefined) current.nux = Math.trunc(num);
        else if (key === "nuy" && num !== undefined) current.nuy = Math.trunc(num);
        else if (key === "nuz" && num !== undefined) current.nuz = Math.trunc(num);
        else if (key === "typ") current.araType = val;
      }
      i++;
      continue;
    }

    if (lower === "fill" && current) {
      const fillToks: string[] = [];
      i++;
      while (i < tokens.length) {
        const ft = tokens[i]!;
        if (ft.toLowerCase() === "end") {
          i++;
          if (i < tokens.length && tokens[i]!.toLowerCase() === "fill") i++;
          break;
        }
        fillToks.push(ft);
        i++;
      }
      current.fill.push(...expandRepeatTokens(fillToks));
      continue;
    }

    i++;
  }
  commitCurrent();
}

function parseOrigenCases(lines: SourceLine[], deck: ScaleDeck): void {
  const joined = lines.map((l) => l.clean).join("\n");
  const caseRegex = /\bcase\s*(?:\(\s*([^)]+?)\s*\))?\s*\{/gi;
  let match: RegExpExecArray | null;

  while ((match = caseRegex.exec(joined)) !== null) {
    const caseId = (match[1] ?? `case_${deck.origenCases.length + 1}`).trim();
    const openBraceIdx = match.index + match[0].length - 1;
    let depth = 1;
    let pos = openBraceIdx + 1;
    while (pos < joined.length && depth > 0) {
      const ch = joined[pos];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      pos++;
    }
    const body = joined.slice(openBraceIdx + 1, depth === 0 ? pos - 1 : joined.length);
    const startLineNo = joined.slice(0, match.index).split("\n").length;
    const endLineNo = joined.slice(0, pos).split("\n").length;
    const caseRange: ScaleRange = {
      startLine: startLineNo,
      startColumn: 1,
      endLine: endLineNo,
      endColumn: 1,
    };

    const origenCase: OrigenCase = {
      id: caseId,
      nuclides: [],
      power: [],
      flux: [],
      save: /\bsave\b/i.test(body),
      range: caseRange,
    };

    // lib { file="..." } or lib { ... }
    const libMatch = /\blib\s*\{([^}]*)\}/i.exec(body);
    if (libMatch) {
      const fileM = /\bfile\s*=\s*"([^"]+)"/i.exec(libMatch[1]!);
      origenCase.library = fileM ? fileM[1] : libMatch[1]!.trim();
    }

    // mat { units=... iso=[ u235=1e20 ... ] }
    const matMatch = /\bmat\s*\{([^}]*)\}/i.exec(body);
    if (matMatch) {
      const matBody = matMatch[1]!;
      const unitM = /\bunits\s*=\s*(atoms|moles|grams|kg)\b/i.exec(matBody);
      const unit = (unitM ? unitM[1]!.toLowerCase() : "atoms") as OrigenMaterialNuclide["unit"];
      const isoM = /\biso\s*=\s*\[([^\]]*)\]/i.exec(matBody);
      const isoSource = isoM ? isoM[1]! : matBody;
      const pairRe = /([a-zA-Z]{1,2}-?\d{1,3}[mM]?|\d{4,6})\s*=\s*([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)/g;
      let pm: RegExpExecArray | null;
      while ((pm = pairRe.exec(isoSource)) !== null) {
        const key = pm[1]!.toLowerCase();
        if (key === "units" || key === "iso") continue;
        const val = parseNumber(pm[2]);
        if (val !== undefined) {
          origenCase.nuclides.push({
            nuclide: normalizeNuclideId(pm[1]!),
            amount: val,
            unit,
            range: caseRange,
          });
        }
      }
    }

    // time { units=days t=[ 10 20 30 ] }
    const timeMatch = /\btime\s*\{([^}]*)\}/i.exec(body);
    if (timeMatch) {
      const tb = timeMatch[1]!;
      const uM = /\bunits\s*=\s*(seconds|minutes|hours|days|years)\b/i.exec(tb);
      const unit = (uM ? uM[1]!.toLowerCase() : "seconds") as OrigenTimeSpec["unit"];
      const tListM = /\bt\s*=\s*\[([^\]]*)\]/i.exec(tb);
      const vals = (tListM ? tListM[1]! : tb)
        .split(/[\s,]+/)
        .map((s) => parseNumber(s))
        .filter((v): v is number => v !== undefined);
      const scale = TIME_UNIT_TO_SECONDS[unit];
      origenCase.time = {
        unit,
        values: vals,
        valuesSeconds: vals.map((v) => v * scale),
        range: caseRange,
      };
    }

    // power=[ ... ]
    const powMatch = /\bpower\s*=\s*\[([^\]]*)\]/i.exec(body);
    if (powMatch) {
      origenCase.power = powMatch[1]!
        .split(/[\s,]+/)
        .map((s) => parseNumber(s))
        .filter((v): v is number => v !== undefined);
    }

    // flux=[ ... ]
    const fluxMatch = /\bflux\s*=\s*\[([^\]]*)\]/i.exec(body);
    if (fluxMatch) {
      origenCase.flux = fluxMatch[1]!
        .split(/[\s,]+/)
        .map((s) => parseNumber(s))
        .filter((v): v is number => v !== undefined);
    }

    deck.origenCases.push(origenCase);
  }
}

/**
 * Parses an ORNL SCALE / KENO / ORIGEN deck into a strongly typed `ScaleDeck` IR.
 */
export function parseScale(text: string, uri?: string): ScaleDeck {
  const rawLines = text.split(/\r?\n/);
  const lines: SourceLine[] = [];
  let offset = 0;
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i]!;
    lines.push({
      lineNo: i + 1,
      raw,
      clean: stripComment(raw),
      offset,
    });
    offset += raw.length + 1;
  }

  const deck: ScaleDeck = {
    uri,
    sequence: "",
    sequenceType: "unknown",
    title: "Untitled SCALE Deck",
    compositions: [],
    cellData: [],
    params: { parameters: {} },
    units: new Map(),
    duplicateUnitIds: [],
    arrays: new Map(),
    duplicateArrayIds: [],
    origenCases: [],
    readBlocks: [],
    syntaxErrors: [],
  };

  let foundSequence = false;
  let foundTitle = false;

  // Scan top-level structure and extract `read <block> ... end <block>` blocks
  let activeBlock: { kind: string; startLine: SourceLine; body: SourceLine[] } | undefined;

  for (const line of lines) {
    const trimmed = line.clean.trim();
    if (!trimmed) continue;

    // Sequence header: =csas6, =origen, =t-depl, =triton, etc.
    if (!activeBlock && trimmed.startsWith("=")) {
      const seqToken = trimmed.slice(1).split(/\s+/)[0] ?? "";
      deck.sequence = seqToken.toLowerCase();
      deck.sequenceType = classifySequence(deck.sequence);
      foundSequence = true;
      if (!KNOWN_SCALE_SEQUENCES.has(deck.sequence) && deck.sequence.length === 0) {
        deck.syntaxErrors.push({
          message: "Empty sequence directive '='",
          range: makeLineRange(line),
        });
      }
      continue;
    }

    // Check for `read <kind>`
    const readM = /^read\s+([a-zA-Z0-9_-]+)/i.exec(trimmed);
    if (readM && !activeBlock) {
      const rawKind = readM[1]!.toLowerCase();
      const normKind =
        rawKind === "composition"
          ? "comp"
          : rawKind === "parameter" || rawKind === "parameters"
            ? "param"
            : rawKind === "geometry"
              ? "geom"
              : rawKind;
      activeBlock = { kind: normKind, startLine: line, body: [] };
      continue;
    }

    // Check for `end <kind>` closing the active read block
    if (activeBlock) {
      const endM = /^end(?:\s+([a-zA-Z0-9_-]+))?$/i.exec(trimmed);
      if (endM) {
        const endKindRaw = endM[1]?.toLowerCase();
        const endKind =
          endKindRaw === "composition"
            ? "comp"
            : endKindRaw === "parameter" || endKindRaw === "parameters"
              ? "param"
              : endKindRaw === "geometry"
                ? "geom"
                : endKindRaw;
        if (!endKind || endKind === activeBlock.kind) {
          const range: ScaleRange = {
            startLine: activeBlock.startLine.lineNo,
            startColumn: 1,
            endLine: line.lineNo,
            endColumn: Math.max(1, line.raw.length),
            startOffset: activeBlock.startLine.offset,
            endOffset: line.offset + line.raw.length,
          };
          deck.readBlocks.push({ kind: activeBlock.kind, closed: true, range });
          if (activeBlock.kind === "comp") parseCompLines(activeBlock.body, deck);
          else if (activeBlock.kind === "celldata") parseCellDataLines(activeBlock.body, deck);
          else if (activeBlock.kind === "param") {
            deck.params.range = range;
            parseParamLines(activeBlock.body, deck);
          } else if (activeBlock.kind === "geom") parseGeomLines(activeBlock.body, deck);
          else if (activeBlock.kind === "bounds") deck.bounds = parseBoundsLines(activeBlock.body, range);
          else if (activeBlock.kind === "array") parseArrayLines(activeBlock.body, deck);
          activeBlock = undefined;
          continue;
        }
      }
      activeBlock.body.push(line);
      continue;
    }

    // Title & Cross-section library lines immediately after sequence
    if (foundSequence && !foundTitle && !/^case\b/i.test(trimmed) && !/^end\b/i.test(trimmed)) {
      deck.title = trimmed;
      foundTitle = true;
      continue;
    }

    if (
      foundTitle &&
      !deck.crossSectionLib &&
      /^(?:v\d|ce_|xn\d|238group|252group|56group)/i.test(trimmed) &&
      !trimmed.includes("=")
    ) {
      deck.crossSectionLib = trimmed.split(/\s+/)[0];
      continue;
    }
  }

  // Record any unclosed read block
  if (activeBlock) {
    const lastLine = activeBlock.body[activeBlock.body.length - 1] ?? activeBlock.startLine;
    const range: ScaleRange = {
      startLine: activeBlock.startLine.lineNo,
      startColumn: 1,
      endLine: lastLine.lineNo,
      endColumn: Math.max(1, lastLine.raw.length),
    };
    deck.readBlocks.push({ kind: activeBlock.kind, closed: false, range });
    // Still parse partial contents so downstream tools can inspect them
    if (activeBlock.kind === "comp") parseCompLines(activeBlock.body, deck);
    else if (activeBlock.kind === "celldata") parseCellDataLines(activeBlock.body, deck);
    else if (activeBlock.kind === "param") parseParamLines(activeBlock.body, deck);
    else if (activeBlock.kind === "geom") parseGeomLines(activeBlock.body, deck);
    else if (activeBlock.kind === "bounds") deck.bounds = parseBoundsLines(activeBlock.body, range);
    else if (activeBlock.kind === "array") parseArrayLines(activeBlock.body, deck);
  }

  // Parse ORIGEN case(...) { ... } blocks
  parseOrigenCases(lines, deck);

  return deck;
}
