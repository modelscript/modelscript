// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/genbank — Zero-Regex GenBank (.gb, .gbk) & FASTA (.fasta, .fa) Parser and Serializer.
 *
 * Character-by-character scanner supporting multi-record GenBank flat files (LOCUS, DEFINITION,
 * ACCESSION, VERSION, KEYWORDS, SOURCE, ORGANISM, FEATURES, ORIGIN, //) and FASTA sequence files.
 */

import type {
  GenbankDocument,
  GenbankFeature,
  GenbankLocation,
  GenbankLocationSpan,
  GenbankMoleculeType,
  GenbankQualifier,
  GenbankRange,
  GenbankRecord,
  GenbankTopology,
} from "../types.js";

interface LineInfo {
  lineNumber: number;
  startOffset: number;
  endOffset: number;
  text: string;
}

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\n";
}

function isDigit(ch: string): boolean {
  if (ch.length === 0) return false;
  const code = ch.charCodeAt(0);
  return code >= 48 && code <= 57;
}

function stripWhitespace(input: string): string {
  let out = "";
  for (let i = 0; i < input.length; i++) {
    const ch = input[i] ?? "";
    if (!isWhitespace(ch)) {
      out += ch;
    }
  }
  return out;
}

function splitWhitespaceTokens(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] ?? "";
    if (isWhitespace(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}

function countLeadingSpaces(line: string): number {
  let count = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] ?? "";
    if (ch === " ") {
      count++;
    } else if (ch === "\t") {
      count += 2;
    } else {
      break;
    }
  }
  return count;
}

function splitFirstTokenAndRest(trimmed: string): { first: string; rest: string } {
  let idx = 0;
  while (idx < trimmed.length && !isWhitespace(trimmed[idx] ?? "")) {
    idx++;
  }
  const first = trimmed.slice(0, idx);
  while (idx < trimmed.length && isWhitespace(trimmed[idx] ?? "")) {
    idx++;
  }
  const rest = trimmed.slice(idx).trim();
  return { first, rest };
}

function parseDigitsOnly(str: string): number | null {
  if (str.length === 0) return null;
  let val = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i] ?? "";
    if (!isDigit(ch)) return null;
    val = val * 10 + (ch.charCodeAt(0) - 48);
  }
  return val;
}

function parseSignedInt(str: string): number {
  const s = str.trim();
  if (s.length === 0) return 0;
  let idx = 0;
  let sign = 1;
  if (s[0] === "-") {
    sign = -1;
    idx = 1;
  } else if (s[0] === "+") {
    idx = 1;
  }
  let val = 0;
  let foundDigit = false;
  while (idx < s.length) {
    const ch = s[idx] ?? "";
    if (isDigit(ch)) {
      val = val * 10 + (ch.charCodeAt(0) - 48);
      foundDigit = true;
    }
    idx++;
  }
  return foundDigit ? sign * val : 0;
}

function splitLines(source: string): LineInfo[] {
  const lines: LineInfo[] = [];
  let lineStart = 0;
  let lineNum = 1;
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") {
      const endOffset = i > lineStart && source[i - 1] === "\r" ? i - 1 : i;
      lines.push({
        lineNumber: lineNum++,
        startOffset: lineStart,
        endOffset,
        text: source.slice(lineStart, endOffset),
      });
      lineStart = i + 1;
    }
  }
  if (lineStart <= source.length) {
    const endOffset =
      source.length > lineStart && source[source.length - 1] === "\r" ? source.length - 1 : source.length;
    lines.push({
      lineNumber: lineNum,
      startOffset: lineStart,
      endOffset,
      text: source.slice(lineStart, endOffset),
    });
  }
  return lines;
}

function makeRange(startLine: LineInfo, endLine: LineInfo): GenbankRange {
  return {
    startLine: startLine.lineNumber,
    startColumn: 1,
    endLine: endLine.lineNumber,
    endColumn: Math.max(1, endLine.text.length + 1),
    startOffset: startLine.startOffset,
    endOffset: endLine.endOffset,
  };
}

function splitTopLevelCommas(expr: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i] ?? "";
    if (ch === "(") {
      depth++;
      current += ch;
    } else if (ch === ")") {
      depth = Math.max(0, depth - 1);
      current += ch;
    } else if (ch === "," && depth === 0) {
      if (current.length > 0) {
        parts.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) {
    parts.push(current);
  }
  return parts;
}

function parseSingleSpan(token: string): GenbankLocationSpan {
  let clean = token.trim();
  while (clean.endsWith(")")) {
    clean = clean.slice(0, clean.length - 1);
  }
  while (clean.startsWith("(")) {
    clean = clean.slice(1);
  }
  const dotIdx = clean.indexOf("..");
  if (dotIdx !== -1) {
    let left = clean.slice(0, dotIdx);
    let right = clean.slice(dotIdx + 2);
    let partialStart = false;
    let partialEnd = false;
    if (left.startsWith("<")) {
      partialStart = true;
      left = left.slice(1);
    }
    if (right.startsWith(">")) {
      partialEnd = true;
      right = right.slice(1);
    }
    const start = parseSignedInt(left);
    const end = parseSignedInt(right);
    return {
      start,
      end,
      ...(partialStart ? { partialStart: true } : {}),
      ...(partialEnd ? { partialEnd: true } : {}),
    };
  }

  let partialStart = false;
  if (clean.startsWith("<")) {
    partialStart = true;
    clean = clean.slice(1);
  } else if (clean.startsWith(">")) {
    clean = clean.slice(1);
  }
  const pos = parseSignedInt(clean);
  return {
    start: pos,
    end: pos,
    ...(partialStart ? { partialStart: true } : {}),
  };
}

export function parseGenbankLocation(rawLocation: string): GenbankLocation {
  const raw = stripWhitespace(rawLocation);
  let working = raw;
  let isComplement = false;
  let isJoin = false;

  let changed = true;
  while (changed) {
    changed = false;
    const lower = working.toLowerCase();
    if (lower.startsWith("complement(") && working.endsWith(")")) {
      isComplement = true;
      working = working.slice("complement(".length, working.length - 1);
      changed = true;
    } else if (lower.startsWith("join(") && working.endsWith(")")) {
      isJoin = true;
      working = working.slice("join(".length, working.length - 1);
      changed = true;
    } else if (lower.startsWith("order(") && working.endsWith(")")) {
      isJoin = true;
      working = working.slice("order(".length, working.length - 1);
      changed = true;
    }
  }

  const parts = splitTopLevelCommas(working);
  if (parts.length > 1) {
    isJoin = true;
  }

  const spans: GenbankLocationSpan[] = [];
  for (const part of parts) {
    let inner = part.trim();
    const lowerInner = inner.toLowerCase();
    if (lowerInner.startsWith("complement(") && inner.endsWith(")")) {
      isComplement = true;
      inner = inner.slice("complement(".length, inner.length - 1);
    }
    spans.push(parseSingleSpan(inner));
  }

  if (spans.length === 0) {
    spans.push({ start: 1, end: 1 });
  }

  const firstSpan = spans[0]!;
  const lastSpan = spans[spans.length - 1]!;
  const start = firstSpan.start;
  const end = lastSpan.end;

  return {
    start,
    end,
    strand: isComplement ? -1 : 1,
    isComplement,
    isJoin,
    spans,
    raw: raw.length > 0 ? raw : "1..1",
  };
}

function areParenthesesBalanced(str: string): boolean {
  let depth = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
  }
  return depth <= 0;
}

function parseLocusHeader(lineText: string): {
  locus: string;
  declaredLength: number;
  moleculeType: GenbankMoleculeType;
  topology: GenbankTopology;
  division?: string | undefined;
  date?: string | undefined;
} {
  const tokens = splitWhitespaceTokens(lineText);
  const locus = tokens[1] ?? "Unknown_Locus";
  let declaredLength = 0;
  let moleculeType: GenbankMoleculeType = "DNA";
  let topology: GenbankTopology = "linear";
  let division: string | undefined;
  let date: string | undefined;

  const knownDivisions = new Set([
    "SYN",
    "BCT",
    "PLN",
    "PRI",
    "ROD",
    "MAM",
    "VRT",
    "INV",
    "VRL",
    "PHG",
    "RNA",
    "UNA",
    "UNC",
    "EST",
    "STS",
    "GSS",
    "HTG",
    "CON",
    "ENV",
  ]);

  for (let i = 2; i < tokens.length; i++) {
    const tok = tokens[i]!;
    const upper = tok.toUpperCase();
    const lower = tok.toLowerCase();

    const numVal = parseDigitsOnly(tok);
    if (numVal !== null && declaredLength === 0) {
      declaredLength = numVal;
      continue;
    }
    if (lower.endsWith("bp") && lower.length > 2) {
      const prefixNum = parseDigitsOnly(lower.slice(0, lower.length - 2));
      if (prefixNum !== null && declaredLength === 0) {
        declaredLength = prefixNum;
        continue;
      }
    }
    if (lower === "bp" || lower === "aa" || lower === "nt") {
      continue;
    }
    if (lower === "circular" || lower === "linear") {
      topology = lower;
      continue;
    }
    if (
      upper === "DNA" ||
      upper === "RNA" ||
      upper === "DS-DNA" ||
      upper === "SS-DNA" ||
      upper === "MRNA" ||
      upper === "TRNA" ||
      upper === "RRNA" ||
      upper === "PROTEIN"
    ) {
      moleculeType = tok as GenbankMoleculeType;
      continue;
    }
    if (knownDivisions.has(upper) && division === undefined) {
      division = upper;
      continue;
    }
    if (tok.includes("-") && tok.length >= 9) {
      date = tok;
    }
  }

  return {
    locus,
    declaredLength,
    moleculeType,
    topology,
    division,
    date,
  };
}

function isTopLevelGenbankKeyword(lineText: string): boolean {
  if (lineText.length === 0) return false;
  const firstChar = lineText[0] ?? "";
  if (isWhitespace(firstChar)) return false;
  const { first } = splitFirstTokenAndRest(lineText);
  return (
    first === "LOCUS" ||
    first === "DEFINITION" ||
    first === "ACCESSION" ||
    first === "VERSION" ||
    first === "KEYWORDS" ||
    first === "SOURCE" ||
    first === "REFERENCE" ||
    first === "COMMENT" ||
    first === "FEATURES" ||
    first === "ORIGIN" ||
    first === "CONTIG" ||
    first === "BASE" ||
    first === "//"
  );
}

function finalizeQualifierValue(key: string, rawVal: string): string {
  let val = rawVal.trim();
  if (val.startsWith('"')) {
    val = val.slice(1);
  }
  if (val.endsWith('"')) {
    val = val.slice(0, val.length - 1);
  }
  if (key === "translation") {
    return stripWhitespace(val).toUpperCase();
  }
  return val;
}

export function parseFasta(text: string, sourceFile?: string): GenbankDocument {
  const lines = splitLines(text);
  const records: GenbankRecord[] = [];

  let currentRecord: GenbankRecord | null = null;
  let currentStartLine: LineInfo | null = null;
  let lastLineInfo: LineInfo | null = null;

  const flushRecord = (): void => {
    if (currentRecord && currentStartLine && lastLineInfo) {
      currentRecord.declaredLength = currentRecord.sequence.length;
      currentRecord.range = makeRange(currentStartLine, lastLineInfo);
      currentRecord.originRange = currentRecord.range;
      records.push(currentRecord);
    }
    currentRecord = null;
    currentStartLine = null;
  };

  for (const line of lines) {
    const trimmed = line.text.trim();
    if (trimmed.length === 0 || trimmed.startsWith(";")) {
      continue;
    }
    if (trimmed.startsWith(">")) {
      flushRecord();
      const headerBody = trimmed.slice(1).trim();
      const { first, rest } = splitFirstTokenAndRest(headerBody);
      const locus = first.length > 0 ? first : `FASTA_${records.length + 1}`;
      currentStartLine = line;
      lastLineInfo = line;
      currentRecord = {
        locus,
        declaredLength: 0,
        moleculeType: "DNA",
        topology: "linear",
        ...(rest.length > 0 ? { definition: rest } : {}),
        accession: locus,
        features: [],
        sequence: "",
        hasOriginSection: true,
      };
    } else if (currentRecord) {
      lastLineInfo = line;
      const cleanLine = stripWhitespace(trimmed).toUpperCase();
      currentRecord.sequence += cleanLine;
    }
  }

  flushRecord();

  return {
    format: "fasta",
    records,
    ...(sourceFile !== undefined ? { sourceFile } : {}),
  };
}

export function parseGenbank(text: string, sourceFile?: string): GenbankDocument {
  const trimmedStart = text.trimStart();
  if (trimmedStart.startsWith(">")) {
    return parseFasta(text, sourceFile);
  }

  const lines = splitLines(text);
  const records: GenbankRecord[] = [];

  let currentRecord: GenbankRecord | null = null;
  let recordStartLine: LineInfo | null = null;
  let section:
    | "NONE"
    | "DEFINITION"
    | "ACCESSION"
    | "VERSION"
    | "KEYWORDS"
    | "SOURCE"
    | "ORGANISM"
    | "FEATURES"
    | "ORIGIN"
    | "OTHER" = "NONE";

  let activeFeature: GenbankFeature | null = null;
  let activeFeatureStartLine: LineInfo | null = null;
  let pendingLocationStr = "";
  let activeQualifier: {
    key: string;
    rawValue: string;
    inQuotes: boolean;
    startLine: LineInfo;
  } | null = null;
  let originStartLine: LineInfo | null = null;

  const flushQualifier = (endLine: LineInfo): void => {
    if (activeFeature && activeQualifier) {
      const cleanVal = finalizeQualifierValue(activeQualifier.key, activeQualifier.rawValue);
      activeFeature.qualifiers[activeQualifier.key] = cleanVal;
      activeFeature.qualifierList.push({
        key: activeQualifier.key,
        value: cleanVal,
        range: makeRange(activeQualifier.startLine, endLine),
      });
    }
    activeQualifier = null;
  };

  const flushFeature = (endLine: LineInfo): void => {
    flushQualifier(endLine);
    if (currentRecord && activeFeature) {
      if (pendingLocationStr.length > 0) {
        activeFeature.location = parseGenbankLocation(pendingLocationStr);
        pendingLocationStr = "";
      }
      if (activeFeatureStartLine) {
        activeFeature.range = makeRange(activeFeatureStartLine, endLine);
      }
      currentRecord.features.push(activeFeature);
    }
    activeFeature = null;
    activeFeatureStartLine = null;
    pendingLocationStr = "";
  };

  const flushRecord = (endLine: LineInfo): void => {
    flushFeature(endLine);
    if (currentRecord && recordStartLine) {
      currentRecord.range = makeRange(recordStartLine, endLine);
      if (originStartLine) {
        currentRecord.originRange = makeRange(originStartLine, endLine);
      }
      records.push(currentRecord);
    }
    currentRecord = null;
    recordStartLine = null;
    originStartLine = null;
    section = "NONE";
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const rawText = line.text;
    const trimmed = rawText.trim();

    if (trimmed.length === 0) {
      continue;
    }

    if (trimmed === "//") {
      flushRecord(line);
      continue;
    }

    const leadingSpaces = countLeadingSpaces(rawText);
    const { first, rest } = splitFirstTokenAndRest(trimmed);

    if (leadingSpaces === 0 && first === "LOCUS") {
      if (currentRecord) {
        flushRecord(lines[Math.max(0, i - 1)]!);
      }
      const parsedHeader = parseLocusHeader(trimmed);
      recordStartLine = line;
      currentRecord = {
        locus: parsedHeader.locus,
        declaredLength: parsedHeader.declaredLength,
        moleculeType: parsedHeader.moleculeType,
        topology: parsedHeader.topology,
        ...(parsedHeader.division !== undefined ? { division: parsedHeader.division } : {}),
        ...(parsedHeader.date !== undefined ? { date: parsedHeader.date } : {}),
        features: [],
        sequence: "",
        hasOriginSection: false,
      };
      section = "NONE";
      continue;
    }

    // Also allow LOCUS with leading spaces if no record is currently open
    if (!currentRecord && first === "LOCUS") {
      const parsedHeader = parseLocusHeader(trimmed);
      recordStartLine = line;
      currentRecord = {
        locus: parsedHeader.locus,
        declaredLength: parsedHeader.declaredLength,
        moleculeType: parsedHeader.moleculeType,
        topology: parsedHeader.topology,
        ...(parsedHeader.division !== undefined ? { division: parsedHeader.division } : {}),
        ...(parsedHeader.date !== undefined ? { date: parsedHeader.date } : {}),
        features: [],
        sequence: "",
        hasOriginSection: false,
      };
      section = "NONE";
      continue;
    }

    if (!currentRecord) {
      continue;
    }

    if (
      (leadingSpaces === 0 && isTopLevelGenbankKeyword(rawText)) ||
      (section !== "FEATURES" && section !== "ORIGIN" && isTopLevelGenbankKeyword(trimmed)) ||
      (section === "FEATURES" && first === "ORIGIN" && rest.length === 0)
    ) {
      if (section === "FEATURES") {
        flushFeature(lines[Math.max(0, i - 1)]!);
      }
      if (first === "DEFINITION") {
        currentRecord.definition = rest;
        section = "DEFINITION";
      } else if (first === "ACCESSION") {
        currentRecord.accession = rest;
        section = "ACCESSION";
      } else if (first === "VERSION") {
        currentRecord.version = rest;
        section = "VERSION";
      } else if (first === "KEYWORDS") {
        currentRecord.keywords = rest;
        section = "KEYWORDS";
      } else if (first === "SOURCE") {
        currentRecord.source = rest;
        section = "SOURCE";
      } else if (first === "FEATURES") {
        section = "FEATURES";
      } else if (first === "ORIGIN") {
        currentRecord.hasOriginSection = true;
        originStartLine = line;
        section = "ORIGIN";
      } else {
        section = "OTHER";
      }
      continue;
    }

    if (section === "DEFINITION") {
      currentRecord.definition = currentRecord.definition ? `${currentRecord.definition} ${trimmed}` : trimmed;
      continue;
    }
    if (section === "ACCESSION") {
      currentRecord.accession = currentRecord.accession ? `${currentRecord.accession} ${trimmed}` : trimmed;
      continue;
    }
    if (section === "VERSION") {
      currentRecord.version = currentRecord.version ? `${currentRecord.version} ${trimmed}` : trimmed;
      continue;
    }
    if (section === "KEYWORDS") {
      currentRecord.keywords = currentRecord.keywords ? `${currentRecord.keywords} ${trimmed}` : trimmed;
      continue;
    }
    if (section === "SOURCE" || section === "ORGANISM") {
      if (first === "ORGANISM") {
        currentRecord.organism = rest;
        section = "ORGANISM";
      } else if (section === "SOURCE") {
        currentRecord.source = currentRecord.source ? `${currentRecord.source} ${trimmed}` : trimmed;
      } else {
        currentRecord.organism = currentRecord.organism ? `${currentRecord.organism} ${trimmed}` : trimmed;
      }
      continue;
    }

    if (section === "ORIGIN") {
      let seqLine = "";
      for (let c = 0; c < trimmed.length; c++) {
        const ch = trimmed[c] ?? "";
        if (isDigit(ch) || isWhitespace(ch)) {
          continue;
        }
        seqLine += ch.toUpperCase();
      }
      currentRecord.sequence += seqLine;
      continue;
    }

    if (section === "FEATURES") {
      // 1. Check if we are continuing a multi-line location with unbalanced parentheses
      if (activeFeature && !activeQualifier && !areParenthesesBalanced(pendingLocationStr)) {
        pendingLocationStr += trimmed;
        activeFeature.location = parseGenbankLocation(pendingLocationStr);
        continue;
      }

      // 2. Check if we are inside an unclosed multi-line quoted qualifier
      if (activeQualifier && activeQualifier.inQuotes) {
        activeQualifier.rawValue += ` ${trimmed}`;
        if (trimmed.endsWith('"') && !trimmed.endsWith('""')) {
          activeQualifier.inQuotes = false;
          flushQualifier(line);
        }
        continue;
      }

      // 3. Qualifier line starting with '/'
      if (trimmed.startsWith("/")) {
        flushQualifier(lines[Math.max(0, i - 1)]!);
        const body = trimmed.slice(1);
        const eqIdx = body.indexOf("=");
        if (eqIdx === -1) {
          const qKey = body.trim();
          if (activeFeature && qKey.length > 0) {
            activeFeature.qualifiers[qKey] = "true";
            activeFeature.qualifierList.push({
              key: qKey,
              value: "true",
              range: makeRange(line, line),
            });
          }
        } else {
          const qKey = body.slice(0, eqIdx).trim();
          const qValRaw = body.slice(eqIdx + 1).trim();
          const startsQuoted = qValRaw.startsWith('"');
          const endsQuoted = qValRaw.length > 1 && qValRaw.endsWith('"');
          if (startsQuoted && !endsQuoted) {
            activeQualifier = {
              key: qKey,
              rawValue: qValRaw,
              inQuotes: true,
              startLine: line,
            };
          } else {
            activeQualifier = {
              key: qKey,
              rawValue: qValRaw,
              inQuotes: false,
              startLine: line,
            };
            flushQualifier(line);
          }
        }
        continue;
      }

      // 4. New feature header line: "<featureKey>   <location>"
      if (first.length > 0 && rest.length > 0) {
        flushFeature(lines[Math.max(0, i - 1)]!);
        pendingLocationStr = rest;
        activeFeatureStartLine = line;
        activeFeature = {
          key: first,
          location: parseGenbankLocation(pendingLocationStr),
          qualifiers: {},
          qualifierList: [],
          range: makeRange(line, line),
        };
      }
    }
  }

  if (currentRecord && lines.length > 0) {
    flushRecord(lines[lines.length - 1]!);
  }

  return {
    format: "genbank",
    records,
    ...(sourceFile !== undefined ? { sourceFile } : {}),
  };
}

function padRight(str: string, width: number): string {
  if (str.length >= width) return `${str} `;
  return str + " ".repeat(width - str.length);
}

function padLeft(str: string, width: number): string {
  if (str.length >= width) return str;
  return " ".repeat(width - str.length) + str;
}

export function serializeGenbank(doc: GenbankDocument): string {
  const outLines: string[] = [];

  for (const rec of doc.records) {
    const len = rec.sequence.length > 0 ? rec.sequence.length : rec.declaredLength;
    const div = rec.division ?? "SYN";
    const date = rec.date ?? "01-JAN-2026";
    outLines.push(
      `LOCUS       ${padRight(rec.locus, 16)}${padLeft(String(len), 7)} bp    ${padRight(rec.moleculeType, 7)} ${padRight(rec.topology, 8)} ${div} ${date}`,
    );
    if (rec.definition !== undefined) {
      outLines.push(`DEFINITION  ${rec.definition}`);
    }
    if (rec.accession !== undefined) {
      outLines.push(`ACCESSION   ${rec.accession}`);
    }
    if (rec.version !== undefined) {
      outLines.push(`VERSION     ${rec.version}`);
    }
    if (rec.keywords !== undefined) {
      outLines.push(`KEYWORDS    ${rec.keywords}`);
    }
    if (rec.source !== undefined) {
      outLines.push(`SOURCE      ${rec.source}`);
      if (rec.organism !== undefined) {
        outLines.push(`  ORGANISM  ${rec.organism}`);
      }
    }

    outLines.push(`FEATURES             Location/Qualifiers`);
    for (const feat of rec.features) {
      outLines.push(`     ${padRight(feat.key, 16)}${feat.location.raw}`);
      const qEntries: GenbankQualifier[] =
        feat.qualifierList.length > 0
          ? feat.qualifierList
          : Object.entries(feat.qualifiers).map(([key, value]) => ({ key, value }));
      for (const q of qEntries) {
        if (q.key === "codon_start" || q.key === "transl_table") {
          outLines.push(`                     /${q.key}=${q.value}`);
        } else {
          outLines.push(`                     /${q.key}="${q.value}"`);
        }
      }
    }

    outLines.push(`ORIGIN`);
    const lowerSeq = rec.sequence.toLowerCase();
    for (let i = 0; i < lowerSeq.length; i += 60) {
      const idxStr = padLeft(String(i + 1), 9);
      const chunks: string[] = [];
      for (let j = i; j < Math.min(i + 60, lowerSeq.length); j += 10) {
        chunks.push(lowerSeq.slice(j, Math.min(j + 10, lowerSeq.length)));
      }
      outLines.push(`${idxStr} ${chunks.join(" ")}`);
    }
    outLines.push(`//`);
  }

  return outLines.join("\n");
}

export function serializeFasta(doc: GenbankDocument): string {
  const outLines: string[] = [];
  for (const rec of doc.records) {
    const header = rec.definition ? `>${rec.locus} ${rec.definition}` : `>${rec.locus}`;
    outLines.push(header);
    const seq = rec.sequence.toUpperCase();
    if (seq.length === 0) {
      outLines.push("");
    } else {
      for (let i = 0; i < seq.length; i += 80) {
        outLines.push(seq.slice(i, i + 80));
      }
    }
  }
  return outLines.join("\n");
}
