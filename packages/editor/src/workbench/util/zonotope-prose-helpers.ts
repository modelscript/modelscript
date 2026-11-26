// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pure TypeScript helpers for Text/Prose direct-manipulation zonotope annotation.
 *
 * Intentionally free of DOM, React, `monaco-editor`, and `@modelscript/runtime`
 * imports so it runs cleanly in both browser bundles and Node unit tests.
 */

import type { ZonotopePendingOverride } from "./zonotope-workbench-state.js";

export interface ProseTokenSegment {
  text: string;
  start: number;
  end: number;
  kind: "plain" | "symbol" | "safety" | "override";
  groupId?: number | undefined;
  relTypeId?: number | undefined;
  relSign?: number | undefined;
  ontologyIri?: string | undefined;
  symbolName?: string | undefined;
  badge?: string | undefined;
}

export interface ProseHypergraphSpanInput {
  groupId: number;
  relTypeId: number;
  relSign: number;
  symbolName?: string | undefined;
  text: string;
  ontologyIri?: string | undefined;
}

/**
 * Matches safety-critical requirement modals (`SHALL NOT`, `MUST NOT`, `FAIL-SAFE`,
 * `SHALL`, `MUST`, `NEVER`, `CRITICAL`) and numeric safety threshold expressions
 * (`<= 50 ms`, `≤ 50 ms`, `>= 2.0`, `≥ 100 bar`, etc.).
 */
export const SAFETY_CRITICAL_REGEX =
  /\b(?:SHALL\s+NOT|MUST\s+NOT|MUST\s+NEVER|FAIL[\s-]SAFE|SAFETY[\s-]CRITICAL|SHALL|MUST|NEVER|CRITICAL)\b|(?:<=|>=|≤|≥)\s*[+-]?\d+(?:\.\d+)?(?:\s*(?:ms|us|µs|seconds?|sec|s|min|hr|h|mm|cm|km|m|um|µm|in|ft|kg|mg|g|kN|MN|N|kPa|MPa|GPa|Pa|bar|psi|degC|°\s*C|K|kHz|MHz|GHz|Hz|mV|kV|V|mA|kA|A|mW|kW|MW|W|kJ|MJ|J|uF|µF|nF|pF|F|mH|uH|µH|H|kOhm|MOhm|Ohm|kΩ|MΩ|Ω|rad|deg|rpm|%)(?=$|[\s,.;:)\]]))?/gi;

function isWordChar(ch: string): boolean {
  return (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9") || ch === "_";
}

function formatCompactOntologyIri(iri: string): string {
  const trimmed = iri.trim();
  if (!trimmed) return "OWL";
  const hashIdx = trimmed.lastIndexOf("#");
  if (hashIdx >= 0 && hashIdx < trimmed.length - 1) {
    return `OWL:${trimmed.slice(hashIdx + 1)}`;
  }
  const slashIdx = trimmed.lastIndexOf("/");
  if (slashIdx >= 0 && slashIdx < trimmed.length - 1 && trimmed.includes("://")) {
    return `OWL:${trimmed.slice(slashIdx + 1)}`;
  }
  if (/^owl:/i.test(trimmed)) {
    return `OWL:${trimmed.slice(4)}`;
  }
  return trimmed;
}

function formatSymbolBadge(
  groupId: number,
  relTypeId: number,
  relSign: number,
  symbolName: string,
  ontologyIri?: string | undefined,
): string {
  if (groupId <= 0) return "🔒 0";
  if (ontologyIri) return `⊑ ${formatCompactOntologyIri(ontologyIri)}`;
  if (relTypeId === 4) return "FLOW ±1";
  if (relTypeId === 5) return "UNIT";
  if (relTypeId === 6) return "TOL";
  if (relTypeId === 2 || relSign < 0) return `↔ -${symbolName}`;
  if (relTypeId === 1) return `↔ ${symbolName}`;
  return `ε_${groupId}`;
}

function formatOverrideBadge(
  groupId: number,
  relTypeId: number,
  relSign: number,
  symbolName?: string | undefined,
): string {
  if (groupId <= 0) return "🔒 0";
  if (relTypeId === 4) return "FLOW ±1";
  if (relTypeId === 5) return "UNIT";
  if (relTypeId === 6) return "TOL";
  const label = symbolName && symbolName.length <= 14 ? symbolName : `ε_${groupId}`;
  if (relTypeId === 2 || relSign < 0) return `↔ -${label}`;
  return `↔ +${label}`;
}

function findAllOccurrences(text: string, needle: string): Array<{ start: number; end: number }> {
  const matches: Array<{ start: number; end: number }> = [];
  if (!needle) return matches;

  const startsWithWord = isWordChar(needle[0]!);
  const endsWithWord = isWordChar(needle[needle.length - 1]!);

  let fromIndex = 0;
  while (fromIndex <= text.length - needle.length) {
    const idx = text.indexOf(needle, fromIndex);
    if (idx === -1) break;
    const end = idx + needle.length;
    const leftOk = !startsWithWord || idx === 0 || !isWordChar(text[idx - 1]!);
    const rightOk = !endsWithWord || end === text.length || !isWordChar(text[end]!);
    if (leftOk && rightOk) {
      matches.push({ start: idx, end });
      fromIndex = end;
    } else {
      fromIndex = idx + 1;
    }
  }
  return matches;
}

interface CandidateSpan {
  start: number;
  end: number;
  kind: "symbol" | "safety" | "override";
  priority: number;
  groupId: number;
  relTypeId: number;
  relSign: number;
  ontologyIri?: string | undefined;
  symbolName?: string | undefined;
  badge: string;
}

/**
 * Segments prose text into non-overlapping longest-first zonotope spans matching:
 * 1. User `pendingOverrides` (by `textSnippet` or `symbolName`),
 * 2. Safety-critical requirement phrases (`SAFETY_CRITICAL_REGEX`, auto-locked to `groupId = 0`),
 * 3. Known active symbols from `record.spans`.
 *
 * Guaranteed invariant: `segments.map((s) => s.text).join("") === text`.
 */
export function segmentProseForZonotope(
  text: string,
  record: { spans: ProseHypergraphSpanInput[] } | null,
  pendingOverrides: ZonotopePendingOverride[],
): ProseTokenSegment[] {
  if (text.length === 0) return [];

  const candidates: CandidateSpan[] = [];

  // 1. Collect active symbols from hypergraph record (deduplicated by symbol text)
  interface SymbolMeta {
    name: string;
    groupId: number;
    relTypeId: number;
    relSign: number;
    ontologyIri?: string | undefined;
  }

  const symbolMap = new Map<string, SymbolMeta>();
  if (record && record.spans.length > 0) {
    for (const span of record.spans) {
      if (span.groupId <= 0 && !span.ontologyIri) continue;
      const name = (span.symbolName && span.symbolName.trim()) || span.text.trim();
      if (!name || !/[A-Za-z]/.test(name)) continue;

      const existing = symbolMap.get(name);
      if (!existing) {
        symbolMap.set(name, {
          name,
          groupId: span.groupId,
          relTypeId: span.relTypeId,
          relSign: span.relSign,
          ontologyIri: span.ontologyIri,
        });
      } else {
        if (existing.groupId <= 0 && span.groupId > 0) {
          existing.groupId = span.groupId;
          existing.relTypeId = span.relTypeId;
          existing.relSign = span.relSign;
        }
        if (!existing.ontologyIri && span.ontologyIri) {
          existing.ontologyIri = span.ontologyIri;
        }
      }
    }
  }

  for (const sym of symbolMap.values()) {
    const occs = findAllOccurrences(text, sym.name);
    for (const occ of occs) {
      candidates.push({
        start: occ.start,
        end: occ.end,
        kind: "symbol",
        priority: 1,
        groupId: sym.groupId,
        relTypeId: sym.relTypeId,
        relSign: sym.relSign,
        ontologyIri: sym.ontologyIri,
        symbolName: sym.name,
        badge: formatSymbolBadge(sym.groupId, sym.relTypeId, sym.relSign, sym.name, sym.ontologyIri),
      });
    }
  }

  // 2. Collect safety-critical phrases (auto-locked to groupId = 0)
  const safetyRe = new RegExp(SAFETY_CRITICAL_REGEX.source, SAFETY_CRITICAL_REGEX.flags);
  let safetyMatch: RegExpExecArray | null;
  while ((safetyMatch = safetyRe.exec(text)) !== null) {
    const matched = safetyMatch[0];
    if (!matched) {
      safetyRe.lastIndex += 1;
      continue;
    }
    candidates.push({
      start: safetyMatch.index,
      end: safetyMatch.index + matched.length,
      kind: "safety",
      priority: 2,
      groupId: 0,
      relTypeId: 0,
      relSign: 0,
      badge: "🔒 LOCK",
    });
  }

  // 3. Collect user pendingOverrides (latest override per needle wins)
  const overrideByNeedle = new Map<string, ZonotopePendingOverride>();
  for (const ov of pendingOverrides) {
    const snippet = ov.textSnippet?.trim();
    const sym = ov.symbolName?.trim();
    if (snippet) {
      overrideByNeedle.set(snippet, ov);
    }
    if (sym && sym !== snippet) {
      overrideByNeedle.set(sym, ov);
    }
  }

  for (const [needle, ov] of overrideByNeedle.entries()) {
    const symMeta = symbolMap.get(needle) ?? (ov.symbolName ? symbolMap.get(ov.symbolName) : undefined);
    const occs = findAllOccurrences(text, needle);
    for (const occ of occs) {
      candidates.push({
        start: occ.start,
        end: occ.end,
        kind: "override",
        priority: 3,
        groupId: ov.groupId,
        relTypeId: ov.relTypeId,
        relSign: ov.relSign,
        ontologyIri: symMeta?.ontologyIri,
        symbolName: ov.symbolName ?? needle,
        badge: formatOverrideBadge(ov.groupId, ov.relTypeId, ov.relSign, ov.symbolName),
      });
    }
  }

  // Sort longest-first, then highest priority (override > safety > symbol), then earliest start
  candidates.sort((a, b) => {
    const lenDiff = b.end - b.start - (a.end - a.start);
    if (lenDiff !== 0) return lenDiff;
    const prioDiff = b.priority - a.priority;
    if (prioDiff !== 0) return prioDiff;
    return a.start - b.start;
  });

  // Greedily accept non-overlapping spans
  const accepted: CandidateSpan[] = [];
  for (const cand of candidates) {
    let overlaps = false;
    for (const acc of accepted) {
      if (cand.start < acc.end && cand.end > acc.start) {
        overlaps = true;
        break;
      }
    }
    if (!overlaps) {
      accepted.push(cand);
    }
  }

  accepted.sort((a, b) => a.start - b.start);

  const segments: ProseTokenSegment[] = [];
  let cursor = 0;

  for (const span of accepted) {
    if (span.start > cursor) {
      segments.push({
        text: text.slice(cursor, span.start),
        start: cursor,
        end: span.start,
        kind: "plain",
      });
    }

    const seg: ProseTokenSegment = {
      text: text.slice(span.start, span.end),
      start: span.start,
      end: span.end,
      kind: span.kind,
      groupId: span.groupId,
      relTypeId: span.relTypeId,
      relSign: span.relSign,
      badge: span.badge,
    };
    if (span.ontologyIri !== undefined) {
      seg.ontologyIri = span.ontologyIri;
    }
    if (span.symbolName !== undefined) {
      seg.symbolName = span.symbolName;
    }
    segments.push(seg);
    cursor = span.end;
  }

  if (cursor < text.length) {
    segments.push({
      text: text.slice(cursor),
      start: cursor,
      end: text.length,
      kind: "plain",
    });
  }

  return segments;
}

// ---------------------------------------------------------------------------
// Markdown prose sentence splitter (for Paraphrase Neighborhood Peek)
// ---------------------------------------------------------------------------

const ABBREVIATIONS = new Set([
  "e.g.",
  "i.e.",
  "fig.",
  "eq.",
  "eqs.",
  "vs.",
  "approx.",
  "min.",
  "max.",
  "no.",
  "dr.",
  "sec.",
  "ref.",
  "etc.",
]);

function stripInlineMarkdown(line: string): string {
  return (
    line
      // Images: ![alt](url) -> alt
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      // Links: [label](url) -> label
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      // Inline code backticks: `code` -> code
      .replace(/`([^`]+)`/g, "$1")
      // Bold / strikethrough: **text**, __text__, ~~text~~
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/(^|[\s(])__([^_]+)__(?=$|[\s.,;:!?)])/g, "$1$2")
      .replace(/~~([^~]+)~~/g, "$1")
      // Italic: *text* or _text_ (without touching snake_case identifiers)
      .replace(/(^|[\s(])\*([^*]+)\*(?=$|[\s.,;:!?)])/g, "$1$2")
      .replace(/(^|[\s(])_([^_\s][^_]*)_(?=$|[\s.,;:!?)])/g, "$1$2")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function splitParagraphIntoSentences(paragraph: string): string[] {
  const cleaned = stripInlineMarkdown(paragraph);
  if (!cleaned) return [];

  const sentences: string[] = [];
  let start = 0;
  const n = cleaned.length;

  for (let i = 0; i < n; i++) {
    const ch = cleaned[i]!;
    if (ch !== "." && ch !== "!" && ch !== "?") continue;

    // Skip decimal numbers (e.g. `2.5`) or dotted identifiers (e.g. `motor.R1`)
    if (ch === ".") {
      const prev = i > 0 ? cleaned[i - 1]! : "";
      const next = i + 1 < n ? cleaned[i + 1]! : "";
      if (/\d/.test(prev) && /\d/.test(next)) continue;
      if (isWordChar(prev) && isWordChar(next)) continue;

      // Skip common abbreviations like `e.g.`, `i.e.`, `Fig.`
      const beforeSlice = cleaned.slice(start, i + 1);
      const abbrevMatch = /([A-Za-z.]+)$/.exec(beforeSlice);
      if (abbrevMatch && ABBREVIATIONS.has(abbrevMatch[1]!.toLowerCase())) {
        continue;
      }
    }

    // Consume consecutive terminal punctuation or closing quotes/parens
    let end = i + 1;
    while (
      end < n &&
      (cleaned[end] === "." ||
        cleaned[end] === "!" ||
        cleaned[end] === "?" ||
        cleaned[end] === '"' ||
        cleaned[end] === "'" ||
        cleaned[end] === ")")
    ) {
      end++;
    }

    // Split only at end-of-string or before whitespace
    if (end === n || /\s/.test(cleaned[end]!)) {
      const piece = cleaned.slice(start, end).trim();
      if (piece) {
        sentences.push(piece);
      }
      while (end < n && /\s/.test(cleaned[end]!)) {
        end++;
      }
      start = end;
      i = end - 1;
    }
  }

  if (start < n) {
    const tail = cleaned.slice(start).trim();
    if (tail) {
      sentences.push(tail);
    }
  }

  return sentences;
}

/**
 * Splits Markdown prose into clean sentences suitable for the Paraphrase
 * Neighborhood Peek (`~ε`) popover, handling headings, bullet/ordered lists,
 * blockquotes, fenced code blocks, and multi-sentence paragraphs.
 */
export function splitIntoSentences(markdownText: string): string[] {
  if (!markdownText || !markdownText.trim()) return [];

  const lines = markdownText.replace(/\r\n?/g, "\n").split("\n");
  const sentences: string[] = [];
  let paragraphBuf: string[] = [];
  let inCodeFence = false;

  const flushParagraph = (): void => {
    if (paragraphBuf.length === 0) return;
    const joined = paragraphBuf.join(" ").trim();
    paragraphBuf = [];
    if (joined) {
      sentences.push(...splitParagraphIntoSentences(joined));
    }
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    if (/^```|^~~~/.test(trimmed)) {
      flushParagraph();
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;

    // Blank line ends paragraph
    if (!trimmed) {
      flushParagraph();
      continue;
    }

    // Horizontal rule or Markdown table separator line
    if (/^(?:---+|\*\*\*+|___+)$/.test(trimmed) || /^\|?(?:\s*:?-+:?\s*\|)+\s*$/.test(trimmed)) {
      flushParagraph();
      continue;
    }

    // Heading: `# Title`
    const headingMatch = /^#{1,6}\s+(.*?)(?:\s+#+)?$/.exec(trimmed);
    if (headingMatch) {
      flushParagraph();
      const headingText = stripInlineMarkdown(headingMatch[1]!);
      if (headingText) {
        sentences.push(...splitParagraphIntoSentences(headingText));
      }
      continue;
    }

    // Bullet or numbered list item: `- item`, `* item`, `+ item`, `1. item`
    const listMatch = /^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(trimmed);
    if (listMatch) {
      flushParagraph();
      const itemText = listMatch[1]!.trim();
      if (itemText) {
        sentences.push(...splitParagraphIntoSentences(itemText));
      }
      continue;
    }

    // Blockquote line
    const quoteMatch = /^>\s?(.*)$/.exec(trimmed);
    if (quoteMatch) {
      const inner = quoteMatch[1]!.trim();
      if (!inner) {
        flushParagraph();
      } else {
        paragraphBuf.push(inner);
      }
      continue;
    }

    paragraphBuf.push(trimmed);
  }

  flushParagraph();
  return sentences;
}
