// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/mcnp — Full MCNP 3-Block Transport Deck Parser.
 *
 * Parses MCNP input decks consisting of:
 *   - Title card (line 1)
 *   - Block 1: Cell Cards (id, material, density, Boolean CSG, IMP/VOL/U/FILL/TMP)
 *   - Blank-line separator
 *   - Block 2: Surface Cards (optional * / +, id, optional TR, mnemonic, parameters)
 *   - Blank-line separator
 *   - Block 3: Data Cards (MODE, M<n>, MT<n>, SDEF, KCODE, KSRC, F1..F8, E<n>, NPS, PHYS, IMP)
 *   - Supports `C ` full-line comments, `$` inline comments, and 5-space / `&` continuations.
 */

import type {
  McnpCellCard,
  McnpDeck,
  McnpIsotopeEntry,
  McnpParticleType,
  McnpSdefCard,
  McnpSurfaceBoundary,
  McnpSurfaceCard,
  McnpSurfaceType,
  McnpTallyCard,
  McnpTallyType,
} from "../types.js";
import { parseCsgExpression } from "./csg-parser.js";

const VALID_SURFACE_TYPES = new Set<McnpSurfaceType>([
  "P",
  "PX",
  "PY",
  "PZ",
  "SO",
  "S",
  "SX",
  "SY",
  "SZ",
  "C/X",
  "C/Y",
  "C/Z",
  "CX",
  "CY",
  "CZ",
  "K/X",
  "K/Y",
  "K/Z",
  "KX",
  "KY",
  "KZ",
  "GQ",
  "RPP",
  "RCC",
  "SPH",
]);

interface LogicalCard {
  text: string;
  line: number;
  startOffset: number;
  endOffset: number;
  comment?: string | undefined;
}

function isFullLineComment(line: string): boolean {
  return /^\s{0,4}[cC](?:\s|$)/.test(line);
}

function stripInlineComment(line: string): { code: string; comment?: string | undefined } {
  const idx = line.indexOf("$");
  if (idx < 0) return { code: line };
  return {
    code: line.slice(0, idx),
    comment: line.slice(idx + 1).trim(),
  };
}

function isContinuationLine(line: string): boolean {
  return /^ {5,}\S/.test(line);
}

function parseNumber(raw: string): number {
  const v = Number(raw);
  return Number.isFinite(v) ? v : NaN;
}

function parseCellCard(card: LogicalCard, deck: McnpDeck): void {
  const raw = card.text.trim();
  const tokens = raw.split(/\s+/);
  if (tokens.length < 3) {
    deck.parseErrors.push({
      line: card.line,
      column: 1,
      message: `Incomplete cell card '${raw}'`,
    });
    return;
  }

  const id = parseInt(tokens[0]!, 10);
  const materialId = parseInt(tokens[1]!, 10);
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(materialId) || materialId < 0) {
    deck.parseErrors.push({
      line: card.line,
      column: 1,
      message: `Invalid cell ID or material number in '${raw}'`,
    });
    return;
  }

  let idx = 2;
  let density: number | undefined;
  if (materialId !== 0) {
    const d = parseNumber(tokens[idx] ?? "");
    if (!Number.isFinite(d)) {
      deck.parseErrors.push({
        line: card.line,
        column: 1,
        message: `Missing numeric density for non-void cell ${id}`,
      });
      return;
    }
    density = d;
    idx++;
  }

  // Separate CSG geometry tokens from cell keyword parameters (IMP:N=1, VOL=..., U=..., FILL=..., TMP=..., TRCL=...)
  const geomTokens: string[] = [];
  const paramTokens: string[] = [];
  let inParams = false;

  const isCellParamToken = (tok: string): boolean => {
    return /^(?:IMP(?::[A-Z,]+)?|VOL|U|FILL|TMP|TRCL|AREA|EXT|PWT|FCL|WWN|DXC|NONU|PD|LAT)(?:=|$)/i.test(tok);
  };

  for (let i = idx; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (!inParams && isCellParamToken(tok)) {
      inParams = true;
    }
    if (inParams) {
      paramTokens.push(tok);
    } else {
      geomTokens.push(tok);
    }
  }

  const csgRaw = geomTokens.join(" ").trim();
  let csg = null;
  if (csgRaw.length > 0) {
    try {
      csg = parseCsgExpression(csgRaw);
    } catch (err: unknown) {
      deck.parseErrors.push({
        line: card.line,
        column: 1,
        message: `Cell ${id} CSG error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  } else {
    deck.parseErrors.push({
      line: card.line,
      column: 1,
      message: `Cell ${id} is missing CSG geometry specification`,
    });
  }

  const imp: Record<string, number> = {};
  let vol: number | undefined;
  let u: number | undefined;
  let fill: number | undefined;
  let tmp: number | undefined;
  let trcl: number | undefined;

  for (let i = 0; i < paramTokens.length; i++) {
    const tok = paramTokens[i]!;
    let key: string;
    let valStr: string;
    const eqIdx = tok.indexOf("=");
    if (eqIdx >= 0) {
      key = tok.slice(0, eqIdx).toUpperCase();
      valStr = tok.slice(eqIdx + 1);
      if (valStr.length === 0 && i + 1 < paramTokens.length) {
        valStr = paramTokens[++i]!;
      }
    } else {
      key = tok.toUpperCase();
      valStr = i + 1 < paramTokens.length ? paramTokens[++i]! : "";
    }

    const numVal = parseNumber(valStr);
    if (key.startsWith("IMP:")) {
      const particles = key.slice(4).split(",");
      for (const p of particles) {
        if (p && Number.isFinite(numVal)) {
          imp[p] = numVal;
        }
      }
    } else if (key === "IMP" && Number.isFinite(numVal)) {
      imp["N"] = numVal;
    } else if (key === "VOL" && Number.isFinite(numVal)) {
      vol = numVal;
    } else if (key === "U" && Number.isFinite(numVal)) {
      u = Math.trunc(numVal);
    } else if (key === "FILL" && Number.isFinite(numVal)) {
      fill = Math.trunc(numVal);
    } else if (key === "TMP" && Number.isFinite(numVal)) {
      tmp = numVal;
    } else if (key === "TRCL" && Number.isFinite(numVal)) {
      trcl = Math.trunc(numVal);
    }
  }

  if (deck.cells.has(id)) {
    deck.duplicateCellIds.push({ id, line: card.line });
  }

  const cell: McnpCellCard = {
    id,
    materialId,
    density,
    csg,
    csgRaw,
    imp,
    vol,
    u,
    fill,
    tmp,
    trcl,
    line: card.line,
    startOffset: card.startOffset,
    endOffset: card.endOffset,
    comment: card.comment,
  };
  deck.cells.set(id, cell);
}

function parseSurfaceCard(card: LogicalCard, deck: McnpDeck): void {
  const raw = card.text.trim();
  const tokens = raw.split(/\s+/);
  if (tokens.length < 3) {
    deck.parseErrors.push({
      line: card.line,
      column: 1,
      message: `Incomplete surface card '${raw}'`,
    });
    return;
  }

  let idTok = tokens[0]!;
  let boundary: McnpSurfaceBoundary | undefined;
  if (idTok.startsWith("*") || idTok.startsWith("+")) {
    boundary = idTok[0] as McnpSurfaceBoundary;
    idTok = idTok.slice(1);
  }

  const id = parseInt(idTok, 10);
  if (!Number.isInteger(id) || id <= 0) {
    deck.parseErrors.push({
      line: card.line,
      column: 1,
      message: `Invalid surface ID '${tokens[0]}'`,
    });
    return;
  }

  let idx = 1;
  let transformId: number | undefined;
  const maybeMnemonic = tokens[idx]!.toUpperCase();
  if (!VALID_SURFACE_TYPES.has(maybeMnemonic as McnpSurfaceType)) {
    const tr = parseInt(tokens[idx]!, 10);
    if (Number.isInteger(tr) && idx + 1 < tokens.length) {
      transformId = tr;
      idx++;
    }
  }

  const surfTypeStr = (tokens[idx] ?? "").toUpperCase();
  if (!VALID_SURFACE_TYPES.has(surfTypeStr as McnpSurfaceType)) {
    deck.parseErrors.push({
      line: card.line,
      column: 1,
      message: `Unknown surface mnemonic '${tokens[idx] ?? ""}' on surface ${id}`,
    });
    return;
  }
  idx++;

  const params: number[] = [];
  for (let i = idx; i < tokens.length; i++) {
    const val = parseNumber(tokens[i]!);
    if (!Number.isFinite(val)) {
      deck.parseErrors.push({
        line: card.line,
        column: 1,
        message: `Non-numeric surface parameter '${tokens[i]}' on surface ${id}`,
      });
      return;
    }
    params.push(val);
  }

  if (deck.surfaces.has(id)) {
    deck.duplicateSurfaceIds.push({ id, line: card.line });
  }

  const surf: McnpSurfaceCard = {
    id,
    boundary,
    transformId,
    type: surfTypeStr as McnpSurfaceType,
    params,
    line: card.line,
    startOffset: card.startOffset,
    endOffset: card.endOffset,
    comment: card.comment,
  };
  deck.surfaces.set(id, surf);
}

function parseSdefCard(raw: string, line: number): McnpSdefCard {
  const sdef: McnpSdefCard = { raw, line };
  // Extract KEY=val1 val2 ... pairs (preserving scientific notation like 2.53e-8)
  const body = raw.replace(/^SDEF\b/i, "").trim();
  const re = /\b(POS|VEC|DIR|ERG|PAR|RAD|CEL)\s*=\s*(.+?)(?=\s+(?:POS|VEC|DIR|ERG|PAR|RAD|CEL)\s*=|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    const key = match[1]!.toUpperCase();
    const valTokens = match[2]!.trim().split(/\s+/);
    if (key === "POS" && valTokens.length >= 3) {
      const nums = valTokens.slice(0, 3).map(parseNumber);
      if (nums.every(Number.isFinite)) {
        sdef.pos = [nums[0]!, nums[1]!, nums[2]!];
      }
    } else if (key === "VEC" && valTokens.length >= 3) {
      const nums = valTokens.slice(0, 3).map(parseNumber);
      if (nums.every(Number.isFinite)) {
        sdef.vec = [nums[0]!, nums[1]!, nums[2]!];
      }
    } else if (key === "DIR") {
      const v = parseNumber(valTokens[0] ?? "");
      if (Number.isFinite(v)) sdef.dir = v;
    } else if (key === "ERG") {
      const v = parseNumber(valTokens[0] ?? "");
      if (Number.isFinite(v)) sdef.erg = v;
    } else if (key === "RAD") {
      const v = parseNumber(valTokens[0] ?? "");
      if (Number.isFinite(v)) sdef.rad = v;
    } else if (key === "CEL") {
      const v = parseInt(valTokens[0] ?? "", 10);
      if (Number.isInteger(v)) sdef.cel = v;
    } else if (key === "PAR") {
      sdef.par = (valTokens[0] ?? "N").toUpperCase();
    }
  }
  return sdef;
}

function parseDataCard(card: LogicalCard, deck: McnpDeck): void {
  const raw = card.text.trim();
  const tokens = raw.split(/\s+/);
  if (tokens.length === 0) return;

  const head = tokens[0]!.toUpperCase();

  // MODE N P E
  if (head === "MODE") {
    const particles: McnpParticleType[] = [];
    for (let i = 1; i < tokens.length; i++) {
      const p = tokens[i]!.toUpperCase();
      if (p === "N" || p === "P" || p === "E") {
        particles.push(p);
      }
    }
    if (particles.length > 0) {
      deck.mode = particles;
    }
    return;
  }

  // MT<n> thermal scattering law
  const mtMatch = /^MT(\d+)$/.exec(head);
  if (mtMatch) {
    const matId = parseInt(mtMatch[1]!, 10);
    const law = tokens.slice(1).join(" ").trim();
    const existing = deck.materials.get(matId);
    if (existing) {
      existing.thermalLaw = law;
    } else {
      deck.materials.set(matId, {
        id: matId,
        isotopes: [],
        thermalLaw: law,
        line: card.line,
        startOffset: card.startOffset,
        endOffset: card.endOffset,
      });
    }
    return;
  }

  // M<n> material card
  const mMatch = /^M(\d+)$/.exec(head);
  if (mMatch) {
    const matId = parseInt(mMatch[1]!, 10);
    const isotopes: McnpIsotopeEntry[] = [];
    for (let i = 1; i + 1 < tokens.length; i += 2) {
      const zaid = tokens[i]!;
      const frac = parseNumber(tokens[i + 1]!);
      if (!Number.isFinite(frac)) {
        deck.parseErrors.push({
          line: card.line,
          column: 1,
          message: `Invalid fraction '${tokens[i + 1]}' for ZAID '${zaid}' in M${matId}`,
        });
        continue;
      }
      const dotIdx = zaid.indexOf(".");
      const basePart = dotIdx >= 0 ? zaid.slice(0, dotIdx) : zaid;
      const library = dotIdx >= 0 ? zaid.slice(dotIdx + 1) : undefined;
      const zaidNum = /^\d+$/.test(basePart) ? parseInt(basePart, 10) : NaN;
      isotopes.push({ zaid, zaidNum, library, fraction: frac });
    }
    const existing = deck.materials.get(matId);
    if (existing && existing.isotopes.length > 0) {
      deck.duplicateMaterialIds.push({ id: matId, line: card.line });
    }
    deck.materials.set(matId, {
      id: matId,
      isotopes,
      thermalLaw: existing?.thermalLaw,
      line: card.line,
      startOffset: card.startOffset,
      endOffset: card.endOffset,
      comment: card.comment,
    });
    return;
  }

  // SDEF fixed source card
  if (head === "SDEF") {
    deck.source.sdef = parseSdefCard(raw, card.line);
    return;
  }

  // KCODE nsrck rkk ikz kct
  if (head === "KCODE") {
    const nums = tokens.slice(1).map(parseNumber);
    if (nums.length < 4 || nums.slice(0, 4).some((v) => !Number.isFinite(v))) {
      deck.parseErrors.push({
        line: card.line,
        column: 1,
        message: `KCODE requires 4 numeric parameters (nsrck rkk ikz kct)`,
      });
      return;
    }
    deck.source.kcode = {
      nsrck: Math.trunc(nums[0]!),
      rkk: nums[1]!,
      ikz: Math.trunc(nums[2]!),
      kct: Math.trunc(nums[3]!),
      line: card.line,
    };
    return;
  }

  // KSRC x1 y1 z1 [x2 y2 z2 ...]
  if (head === "KSRC") {
    const nums = tokens.slice(1).map(parseNumber);
    for (let i = 0; i + 2 < nums.length; i += 3) {
      if (Number.isFinite(nums[i]!) && Number.isFinite(nums[i + 1]!) && Number.isFinite(nums[i + 2]!)) {
        deck.source.ksrc.push([nums[i]!, nums[i + 1]!, nums[i + 2]!]);
      }
    }
    return;
  }

  // F<n>:<p> tally card
  const fMatch = /^F(\d+)(?::([A-Z,]+))?$/.exec(head);
  if (fMatch) {
    const tallyId = parseInt(fMatch[1]!, 10);
    const mod10 = tallyId % 10;
    const validTypes = [1, 2, 4, 5, 6, 8];
    if (!validTypes.includes(mod10)) {
      deck.parseErrors.push({
        line: card.line,
        column: 1,
        message: `Unsupported tally type 'F${tallyId}' (last digit must be 1, 2, 4, 5, 6, or 8)`,
      });
      return;
    }
    const tallyType = mod10 as McnpTallyType;
    const particle = fMatch[2] ?? "N";

    if (tallyType === 5) {
      const nums = tokens.slice(1).map(parseNumber);
      const pt: [number, number, number, number] | undefined =
        nums.length >= 4 && nums.slice(0, 4).every(Number.isFinite)
          ? [nums[0]!, nums[1]!, nums[2]!, nums[3]!]
          : undefined;
      const tally: McnpTallyCard = {
        id: tallyId,
        type: tallyType,
        particle,
        targets: [],
        point: pt,
        line: card.line,
        startOffset: card.startOffset,
        endOffset: card.endOffset,
      };
      deck.tallies.set(tallyId, tally);
      return;
    }

    const targets: number[] = [];
    for (let i = 1; i < tokens.length; i++) {
      const tok = tokens[i]!;
      if (tok.toUpperCase() === "T") continue;
      const id = parseInt(tok, 10);
      if (Number.isInteger(id) && id > 0) {
        targets.push(id);
      }
    }
    const existingTally = deck.tallies.get(tallyId);
    deck.tallies.set(tallyId, {
      id: tallyId,
      type: tallyType,
      particle,
      targets,
      energyBins: existingTally?.energyBins,
      line: card.line,
      startOffset: card.startOffset,
      endOffset: card.endOffset,
    });
    return;
  }

  // E<n> tally energy bins
  const eMatch = /^E(\d+)$/.exec(head);
  if (eMatch) {
    const tallyId = parseInt(eMatch[1]!, 10);
    const bins = tokens.slice(1).map(parseNumber).filter(Number.isFinite);
    const existing = deck.tallies.get(tallyId);
    if (existing) {
      existing.energyBins = bins;
    }
    return;
  }

  // NPS n
  if (head === "NPS") {
    const val = parseNumber(tokens[1] ?? "");
    deck.nps = val;
    deck.npsLine = card.line;
    return;
  }

  // PHYS:N / PHYS:P
  const physMatch = /^PHYS(?::([A-Z]))?$/.exec(head);
  if (physMatch) {
    const particle = physMatch[1] ?? "N";
    const params = tokens
      .slice(1)
      .map((t) => (t.toUpperCase() === "J" ? 0 : parseNumber(t)))
      .filter(Number.isFinite);
    deck.phys.push({ particle, params, line: card.line });
    return;
  }

  // IMP:N v1 v2 ... (data-block importance card)
  const impMatch = /^IMP:([A-Z,]+)$/.exec(head);
  if (impMatch) {
    const particles = impMatch[1]!.split(",");
    const expanded: number[] = [];
    for (let i = 1; i < tokens.length; i++) {
      const tok = tokens[i]!.toUpperCase();
      const repMatch = /^(\d+)R$/.exec(tok);
      if (repMatch && expanded.length > 0) {
        const count = parseInt(repMatch[1]!, 10);
        const last = expanded[expanded.length - 1]!;
        for (let r = 0; r < count; r++) expanded.push(last);
      } else {
        const v = parseNumber(tok);
        if (Number.isFinite(v)) expanded.push(v);
      }
    }
    const orderedCells = Array.from(deck.cells.values());
    for (let i = 0; i < Math.min(expanded.length, orderedCells.length); i++) {
      for (const p of particles) {
        orderedCells[i]!.imp[p] = expanded[i]!;
      }
    }
    return;
  }
}

/**
 * Parses an MCNP 3-block input deck string into a structured `McnpDeck`.
 */
export function parseMcnpDeck(source: string): McnpDeck {
  const deck: McnpDeck = {
    title: "MCNP Transport Deck",
    cells: new Map(),
    surfaces: new Map(),
    materials: new Map(),
    tallies: new Map(),
    mode: ["N"],
    source: { ksrc: [] },
    phys: [],
    comments: [],
    parseErrors: [],
    duplicateCellIds: [],
    duplicateSurfaceIds: [],
    duplicateMaterialIds: [],
  };

  const rawLines = source.split(/\r?\n/);
  const lineOffsets: number[] = [];
  let offset = 0;
  for (const l of rawLines) {
    lineOffsets.push(offset);
    offset += l.length + 1;
  }

  // Split into 3 blocks separated by blank lines.
  // Line 1 is the title card (if non-empty and not a `C ` comment).
  let startIdx = 0;
  while (startIdx < rawLines.length && rawLines[startIdx]!.trim() === "") {
    startIdx++;
  }

  if (startIdx < rawLines.length && !isFullLineComment(rawLines[startIdx]!)) {
    // Check if line 1 looks like a title card (does not start with a cell card `<int> <int> ...`)
    const firstTrim = rawLines[startIdx]!.trim();
    if (!/^\d+\s+\d+\s+/.test(firstTrim)) {
      deck.title = firstTrim;
      startIdx++;
    }
  }

  const blocks: LogicalCard[][] = [[], [], []];
  let currentBlock = 0;
  let prevEndedWithAmp = false;

  for (let i = startIdx; i < rawLines.length; i++) {
    const rawLine = rawLines[i]!;
    const lineNum = i + 1;
    const lineStart = lineOffsets[i] ?? 0;
    const lineEnd = lineStart + rawLine.length;

    if (rawLine.trim() === "") {
      prevEndedWithAmp = false;
      if (blocks[currentBlock]!.length > 0 && currentBlock < 2) {
        currentBlock++;
      }
      continue;
    }

    if (isFullLineComment(rawLine)) {
      deck.comments.push({ line: lineNum, text: rawLine.trim() });
      continue;
    }

    const { code, comment } = stripInlineComment(rawLine);
    if (comment) {
      deck.comments.push({ line: lineNum, text: comment });
    }
    const trimmedCode = code.trim();
    if (trimmedCode === "") {
      continue;
    }

    const hasAmp = trimmedCode.endsWith("&");
    const cleanChunk = hasAmp ? trimmedCode.slice(0, -1).trimEnd() : trimmedCode;

    const currentCards = blocks[currentBlock]!;
    if ((prevEndedWithAmp || isContinuationLine(code)) && currentCards.length > 0) {
      const last = currentCards[currentCards.length - 1]!;
      last.text = `${last.text} ${cleanChunk}`;
      last.endOffset = lineEnd;
    } else {
      currentCards.push({
        text: cleanChunk,
        line: lineNum,
        startOffset: lineStart,
        endOffset: lineEnd,
        comment,
      });
    }
    prevEndedWithAmp = hasAmp;
  }

  // Parse Block 1: Cells
  for (const card of blocks[0]!) {
    parseCellCard(card, deck);
  }
  // Parse Block 2: Surfaces
  for (const card of blocks[1]!) {
    parseSurfaceCard(card, deck);
  }
  // Parse Block 3: Data
  for (const card of blocks[2]!) {
    parseDataCard(card, deck);
  }

  return deck;
}
