// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — 4-Column Typed Relational Hypergraph Compiler.
 *
 * Compiles ModelScript engineering models (across 169 languages via native WASM GLR `SymbolIndex`
 * and `WorkspaceIndex`), CAD formats (`scad`, `step`, `urdf`), OWL2 ontologies, and English Markdown
 * specifications into four aligned parallel columns:
 *   - `tokenIds`   : Base vocabulary lookup IDs
 *   - `groupIds`   : Scoping IDs tying co-referent symbols/entities to ε_k (`0` locks syntax/operators)
 *   - `relTypeIds` : Ontological & physical coupling rules (`RelTypeId`)
 *   - `relSigns`   : Coupling signs (`+1.0`, `-1.0`, `0.0`)
 *   - `mInit`      : Exact input-adaptive initial generator count for Dynamic-m batch bucketing
 */

import type { SymbolEntry, SymbolIndex } from "../runtime.js";
import {
  RelTypeId,
  type FormalCertificateSummary,
  type GeneratorGroupSummary,
  type HypergraphTokenOverride,
  type RelationalHypergraphRecord,
  type RelationalTokenSpan,
} from "./schemas.js";

// ─────────────────────────────────────────────────────────────────────────────
// Language Keyword & Semantic Classification Tables
// ─────────────────────────────────────────────────────────────────────────────

const LOCKED_CODE_KEYWORDS = new Set([
  // Modelica / SysML2 / general engineering keywords
  "model",
  "class",
  "block",
  "connector",
  "record",
  "package",
  "function",
  "type",
  "end",
  "equation",
  "initial",
  "algorithm",
  "parameter",
  "constant",
  "discrete",
  "flow",
  "stream",
  "input",
  "output",
  "public",
  "protected",
  "extends",
  "import",
  "within",
  "connect",
  "der",
  "if",
  "then",
  "else",
  "elseif",
  "for",
  "loop",
  "while",
  "when",
  "elsewhen",
  "and",
  "or",
  "not",
  "true",
  "false",
  "annotation",
  "redeclare",
  "replaceable",
  "inner",
  "outer",
  "partial",
  "encapsulated",
  "expandable",
  "Real",
  "Integer",
  "Boolean",
  "String",
  // SysML2
  "part",
  "def",
  "attribute",
  "port",
  "item",
  "action",
  "state",
  "requirement",
  "constraint",
  "calc",
  "assert",
  "ref",
  "in",
  "out",
  "inout",
  "doc",
  "specializes",
  "redefines",
  "subsets",
  // OpenSCAD / CAD
  "module",
  "cube",
  "sphere",
  "cylinder",
  "union",
  "difference",
  "intersection",
  "translate",
  "rotate",
  "scale",
  "mirror",
  "linear_extrude",
  "rotate_extrude",
  "hull",
  "minkowski",
  "polygon",
  "circle",
  "square",
  // C / Verilog / SPICE
  "int",
  "float",
  "double",
  "void",
  "return",
  "struct",
  "const",
  "static",
  "extern",
  "subckt",
  "ends",
  "tran",
  "ac",
  "dc",
  // OWL2 / SPARQL
  "Prefix",
  "Ontology",
  "Declaration",
  "Class",
  "SubClassOf",
  "EquivalentClasses",
  "ObjectProperty",
  "DataProperty",
  "SELECT",
  "WHERE",
  "PREFIX",
  "FILTER",
]);

const LOCKED_ENGLISH_STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "if",
  "then",
  "else",
  "of",
  "in",
  "on",
  "at",
  "to",
  "for",
  "with",
  "by",
  "from",
  "as",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "that",
  "this",
  "these",
  "those",
  "it",
  "its",
  "we",
  "our",
  "you",
  "your",
  "they",
  "their",
  "can",
  "must",
  "shall",
  "should",
  "will",
  "would",
  "may",
  "might",
  "not",
  "no",
  "all",
  "any",
  "each",
  "every",
  "when",
  "where",
  "which",
  "who",
  "while",
  "into",
  "over",
  "under",
  "between",
  "through",
  "using",
  "via",
]);

const SI_UNIT_TOKENS = new Set([
  "m",
  "mm",
  "cm",
  "km",
  "kg",
  "g",
  "s",
  "ms",
  "Hz",
  "N",
  "kN",
  "Pa",
  "kPa",
  "MPa",
  "GPa",
  "J",
  "kJ",
  "W",
  "kW",
  "MW",
  "V",
  "kV",
  "mV",
  "A",
  "mA",
  "Ohm",
  "F",
  "H",
  "K",
  "degC",
  "rad",
  "deg",
  "Nm",
]);

const CAD_TOLERANCE_HINTS = [
  "tol",
  "tolerance",
  "clearance",
  "thickness",
  "wall",
  "radius",
  "diameter",
  "pitch",
  "fillet",
  "chamfer",
  "hole",
  "bore",
  "shaft",
  "offset",
  "margin",
  "gap",
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers: FNV-1a Deterministic Hash & Line/Column Indexing
// ─────────────────────────────────────────────────────────────────────────────

/** Deterministic FNV-1a 32-bit hash for reproducible token IDs & example IDs. */
export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function buildLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      starts.push(i + 1);
    }
  }
  return starts;
}

function offsetToLineCol(lineStarts: number[], offset: number): { line: number; column: number } {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid]! <= offset) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return { line: lo + 1, column: offset - lineStarts[lo]! + 1 };
}

interface RawLexToken {
  text: string;
  startOffset: number;
  endOffset: number;
  kind: "ident" | "number" | "string" | "operator" | "punct" | "comment";
}

function lexSource(text: string): RawLexToken[] {
  const tokens: RawLexToken[] = [];
  const n = text.length;
  let i = 0;

  while (i < n) {
    const ch = text[i]!;
    const next = i + 1 < n ? text[i + 1]! : "";

    // Skip whitespace
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      i++;
      continue;
    }

    // Line comments // or # (for SPICE/Markdown headings we keep # in markdown separately)
    if (ch === "/" && next === "/") {
      const start = i;
      i += 2;
      while (i < n && text[i] !== "\n") i++;
      tokens.push({ text: text.slice(start, i), startOffset: start, endOffset: i, kind: "comment" });
      continue;
    }

    // Block comments /* ... */
    if (ch === "/" && next === "*") {
      const start = i;
      i += 2;
      while (i + 1 < n && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i = Math.min(n, i + 2);
      tokens.push({ text: text.slice(start, i), startOffset: start, endOffset: i, kind: "comment" });
      continue;
    }

    // Quoted strings
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = i;
      i++;
      while (i < n && text[i] !== quote) {
        if (text[i] === "\\" && i + 1 < n) i++;
        i++;
      }
      if (i < n) i++;
      tokens.push({ text: text.slice(start, i), startOffset: start, endOffset: i, kind: "string" });
      continue;
    }

    // Identifiers (including Unicode / hyphenated URIs / underscores)
    if ((ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_") {
      const start = i;
      i++;
      while (
        i < n &&
        ((text[i]! >= "A" && text[i]! <= "Z") ||
          (text[i]! >= "a" && text[i]! <= "z") ||
          (text[i]! >= "0" && text[i]! <= "9") ||
          text[i] === "_")
      ) {
        i++;
      }
      tokens.push({ text: text.slice(start, i), startOffset: start, endOffset: i, kind: "ident" });
      continue;
    }

    // Numbers
    if (ch >= "0" && ch <= "9") {
      const start = i;
      i++;
      while (
        i < n &&
        ((text[i]! >= "0" && text[i]! <= "9") ||
          text[i] === "." ||
          text[i] === "e" ||
          text[i] === "E" ||
          ((text[i] === "+" || text[i] === "-") && (text[i - 1] === "e" || text[i - 1] === "E")))
      ) {
        i++;
      }
      tokens.push({ text: text.slice(start, i), startOffset: start, endOffset: i, kind: "number" });
      continue;
    }

    // Multi-char operators (:>, :=, ==, !=, <=, >=, ::, ->, ±)
    const two = ch + next;
    if (
      two === ":>" ||
      two === ":=" ||
      two === "==" ||
      two === "!=" ||
      two === "<=" ||
      two === ">=" ||
      two === "::" ||
      two === "->" ||
      two === "+-" ||
      two === "-+"
    ) {
      tokens.push({ text: two, startOffset: i, endOffset: i + 2, kind: "operator" });
      i += 2;
      continue;
    }

    // Single-char operators & punctuation
    if ("+-*/=<>!^~±".includes(ch)) {
      tokens.push({ text: ch, startOffset: i, endOffset: i + 1, kind: "operator" });
    } else {
      tokens.push({ text: ch, startOffset: i, endOffset: i + 1, kind: "punct" });
    }
    i++;
  }

  return tokens;
}

function isCadDialect(dialect: string): boolean {
  const d = dialect.toLowerCase();
  return (
    d === "scad" || d === "openscad" || d === "step" || d === "urdf" || d === "three-mf" || d === "qif" || d === "stl"
  );
}

function isProseDialect(dialect: string): boolean {
  const d = dialect.toLowerCase();
  return d === "markdown" || d === "md" || d === "txt" || d === "text" || d === "reqif";
}

function isOntologyDialect(dialect: string): boolean {
  const d = dialect.toLowerCase();
  return d === "owl2" || d === "owl" || d === "sparql" || d === "ttl" || d === "rdf";
}

function looksLikeToleranceIdent(name: string): boolean {
  const lower = name.toLowerCase();
  return CAD_TOLERANCE_HINTS.some((hint) => lower.includes(hint));
}

function extractYamlFrontmatterSymbols(text: string): {
  symbols: Set<string>;
  isaPairs: Map<string, string>;
} {
  const symbols = new Set<string>();
  const isaPairs = new Map<string, string>();
  if (!text.startsWith("---")) return { symbols, isaPairs };
  const endIdx = text.indexOf("\n---", 3);
  if (endIdx === -1) return { symbols, isaPairs };
  const fm = text.slice(3, endIdx);

  // Parse simple `symbols: [foo, bar]` or `ontology_isa: { Resistor: PassiveComponent }` lines
  const symMatch = fm.match(/symbols\s*:\s*\[([^\]]+)\]/i);
  if (symMatch?.[1]) {
    for (const raw of symMatch[1].split(",")) {
      const cleaned = raw.trim().replace(/^["']|["']$/g, "");
      if (cleaned) symbols.add(cleaned);
    }
  }
  const isaMatches = fm.matchAll(/([A-Za-z_]\w*)\s*(?:is_a|subClassOf|:>)\s*([A-Za-z_]\w*)/gi);
  for (const m of isaMatches) {
    if (m[1] && m[2]) {
      isaPairs.set(m[1], m[2]);
      symbols.add(m[1]);
      symbols.add(m[2]);
    }
  }
  return { symbols, isaPairs };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Hypergraph Compiler API
// ─────────────────────────────────────────────────────────────────────────────

export interface CompileRelationalHypergraphOptions {
  /** Source text to compile. */
  source: string;
  /** Document URI or filename (used for cross-file symbol lookup & exampleId hashing). */
  uri?: string | undefined;
  /** Dialect ID (e.g., `"modelica"`, `"sysml2"`, `"scad"`, `"step"`, `"spice"`, `"owl2"`, `"markdown"`). */
  dialect: string;
  /** Optional native WASM GLR `SymbolIndex` from `WorkspaceIndex` / `SymbolIndexer`. */
  symbolIndex?: SymbolIndex | undefined;
  /** Optional external ontology subsumption map (`childClass -> parentClassIRI`). */
  ontologySubsumptions?: Map<string, string> | Record<string, string> | undefined;
  /** Optional formal verification certificate to attach to the compiled record. */
  formalCert?: FormalCertificateSummary | undefined;
  /** Optional custom vocabulary token ID lookup (defaults to deterministic FNV-1a 32-bit ID). */
  vocabLookup?: ((tokenText: string) => number) | undefined;
  /** Optional interactive annotator overrides to apply after compilation. */
  overrides?: HypergraphTokenOverride[] | undefined;
}

/**
 * Compiles raw engineering source (optionally enriched with ModelScript's native `SymbolIndex`
 * and OWL2 ontology subsumptions) into the 4-column Typed Relational Hypergraph record.
 */
export function compileRelationalHypergraph(options: CompileRelationalHypergraphOptions): RelationalHypergraphRecord {
  const { source, dialect, symbolIndex, formalCert, vocabLookup, overrides } = options;
  const uri = options.uri ?? `memory://example.${dialect}`;
  const dialectNorm = dialect.trim().toLowerCase();
  const isCad = isCadDialect(dialectNorm);
  const isProse = isProseDialect(dialectNorm);
  const isOnt = isOntologyDialect(dialectNorm);

  const lineStarts = buildLineStarts(source);
  const rawTokens = lexSource(source).filter((t) => t.kind !== "comment");

  // Build symbol lookup map from ModelScript's native SymbolIndex when available
  const symbolsByName = new Map<string, SymbolEntry>();
  if (symbolIndex) {
    for (const entry of symbolIndex.symbols.values()) {
      if (entry.name && !symbolsByName.has(entry.name)) {
        symbolsByName.set(entry.name, entry);
      }
    }
  }

  // Merge external ontology subsumption map + YAML frontmatter hints
  const isaMap = new Map<string, string>();
  if (options.ontologySubsumptions) {
    if (options.ontologySubsumptions instanceof Map) {
      for (const [k, v] of options.ontologySubsumptions.entries()) isaMap.set(k, v);
    } else {
      for (const [k, v] of Object.entries(options.ontologySubsumptions)) isaMap.set(k, v);
    }
  }
  const frontmatter = isProse
    ? extractYamlFrontmatterSymbols(source)
    : { symbols: new Set<string>(), isaPairs: new Map<string, string>() };
  for (const [k, v] of frontmatter.isaPairs.entries()) isaMap.set(k, v);

  // Pre-scan for inline ontological/inheritance patterns (`X extends Y`, `X :> Y`, `SubClassOf(X Y)`, `X is a Y`)
  for (let i = 0; i < rawTokens.length; i++) {
    const tok = rawTokens[i]!;
    if (tok.text === ":>" || tok.text === "extends" || tok.text === "specializes") {
      const prev = rawTokens[i - 1];
      const next = rawTokens[i + 1];
      if (prev?.kind === "ident" && next?.kind === "ident") {
        isaMap.set(prev.text, next.text);
      }
    } else if (tok.text === "SubClassOf" && rawTokens[i + 1]?.text === "(") {
      const child = rawTokens[i + 2];
      const parent = rawTokens[i + 3];
      if (child?.kind === "ident" && parent?.kind === "ident") {
        isaMap.set(child.text, parent.text);
      }
    } else if (
      isProse &&
      tok.text.toLowerCase() === "is" &&
      (rawTokens[i + 1]?.text.toLowerCase() === "a" || rawTokens[i + 1]?.text.toLowerCase() === "an")
    ) {
      const prev = rawTokens[i - 1];
      const next = rawTokens[i + 2];
      if (prev?.kind === "ident" && next?.kind === "ident") {
        isaMap.set(prev.text, next.text);
      }
    }
  }

  // Pre-scan `connect(a.p, b.n)` pairs to tie flow-conservation ports to the same generator with opposing signs
  // Maps token index -> { pairKey, sign, relType }
  const connectCouplings = new Map<number, { key: string; sign: 1 | -1; relType: RelTypeId }>();
  for (let i = 0; i < rawTokens.length; i++) {
    if (rawTokens[i]!.text === "connect" && rawTokens[i + 1]?.text === "(") {
      // Collect indices up to matching ')'
      let j = i + 2;
      const lhsIndices: number[] = [];
      const rhsIndices: number[] = [];
      let sawComma = false;
      while (j < rawTokens.length && rawTokens[j]!.text !== ")") {
        const tj = rawTokens[j]!;
        if (tj.text === ",") {
          sawComma = true;
        } else if (tj.kind === "ident") {
          if (!sawComma) lhsIndices.push(j);
          else rhsIndices.push(j);
        }
        j++;
      }
      if (lhsIndices.length > 0 && rhsIndices.length > 0) {
        const lhsName = lhsIndices.map((idx) => rawTokens[idx]!.text).join(".");
        const rhsName = rhsIndices.map((idx) => rawTokens[idx]!.text).join(".");
        const key = `flow:${lhsName}<->${rhsName}`;
        for (const idx of lhsIndices) {
          connectCouplings.set(idx, { key, sign: 1, relType: RelTypeId.FLOW_CONSERVATION });
        }
        for (const idx of rhsIndices) {
          connectCouplings.set(idx, { key, sign: -1, relType: RelTypeId.FLOW_CONSERVATION });
        }
      }
    }
  }

  // Count identifier occurrences in prose so singleton ordinary prose words stay locked (group_id = 0)
  // while repeated technical/co-referent entities or frontmatter symbols receive shared generators.
  const identFreq = new Map<string, number>();
  for (const tok of rawTokens) {
    if (tok.kind === "ident") {
      identFreq.set(tok.text, (identFreq.get(tok.text) ?? 0) + 1);
    }
  }

  // Allocate canonical group IDs (1..m_init)
  const keyToGroupId = new Map<string, number>();
  const groupMeta = new Map<
    number,
    { label: string; primaryRelType: RelTypeId; symbolName?: string; ontologyIri?: string }
  >();
  let nextGroupId = 1;

  const getOrCreateGroup = (
    key: string,
    label: string,
    primaryRelType: RelTypeId,
    symbolName?: string,
    ontologyIri?: string,
  ): number => {
    const existing = keyToGroupId.get(key);
    if (existing !== undefined) return existing;
    const id = nextGroupId++;
    keyToGroupId.set(key, id);
    groupMeta.set(id, {
      label,
      primaryRelType,
      ...(symbolName ? { symbolName } : {}),
      ...(ontologyIri ? { ontologyIri } : {}),
    });
    return id;
  };

  const tokenIds: number[] = [];
  const groupIds: number[] = [];
  const relTypeIds: RelTypeId[] = [];
  const relSigns: number[] = [];
  const spans: RelationalTokenSpan[] = [];

  for (let i = 0; i < rawTokens.length; i++) {
    const tok = rawTokens[i]!;
    const prevTok = i > 0 ? rawTokens[i - 1] : undefined;
    const nextTok = i + 1 < rawTokens.length ? rawTokens[i + 1] : undefined;
    const tokenId = vocabLookup ? vocabLookup(tok.text) : (fnv1a32(tok.text) % 50000) + 1;

    let groupId = 0;
    let relTypeId = RelTypeId.NONE;
    let relSign = 0.0;
    let symbolName: string | undefined;
    let symbolKind: string | undefined;
    let ontologyIri: string | undefined;

    // 1. Check explicit connect() flow conservation coupling
    const flowCouple = connectCouplings.get(i);
    if (flowCouple) {
      groupId = getOrCreateGroup(flowCouple.key, flowCouple.key, flowCouple.relType, tok.text);
      relTypeId = flowCouple.relType;
      relSign = flowCouple.sign;
      symbolName = tok.text;
    } else if (tok.kind === "string") {
      // Check SI unit string literal: unit = "mm" / unit = "V"
      const inner = tok.text.slice(1, -1).trim();
      if (SI_UNIT_TOKENS.has(inner) && (prevTok?.text === "=" || rawTokens[i - 2]?.text === "unit")) {
        groupId = getOrCreateGroup(`unit:${inner}`, `unit:${inner}`, RelTypeId.UNIT_SCALE, inner);
        relTypeId = RelTypeId.UNIT_SCALE;
        relSign = 1.0;
        symbolName = inner;
      }
    } else if (tok.kind === "number") {
      // Numbers adjacent to ± or inside CAD tolerance specs receive a GDT_TOLERANCE_CONE generator
      if (
        prevTok?.text === "±" ||
        prevTok?.text === "+-" ||
        nextTok?.text === "±" ||
        nextTok?.text === "+-" ||
        (isCad && rawTokens[i - 2]?.kind === "ident" && looksLikeToleranceIdent(rawTokens[i - 2]!.text))
      ) {
        const hasNamedParam = rawTokens[i - 2]?.kind === "ident";
        const paramName = hasNamedParam ? rawTokens[i - 2]!.text : `dim_${tok.text}`;
        const key = hasNamedParam ? `sym:${paramName}` : `tol:${paramName}`;
        groupId = getOrCreateGroup(key, paramName, RelTypeId.GDT_TOLERANCE_CONE, paramName);
        relTypeId = RelTypeId.GDT_TOLERANCE_CONE;
        relSign = prevTok?.text === "-" ? -1.0 : 1.0;
        symbolName = paramName;
      }
    } else if (tok.kind === "ident") {
      const lower = tok.text.toLowerCase();
      const isLockedKeyword = isProse ? LOCKED_ENGLISH_STOPWORDS.has(lower) : LOCKED_CODE_KEYWORDS.has(tok.text);

      if (!isLockedKeyword) {
        const resolvedSym = symbolsByName.get(tok.text);
        const isaParent = isaMap.get(tok.text);
        const isFrontmatterSym = frontmatter.symbols.has(tok.text);
        const freq = identFreq.get(tok.text) ?? 1;

        // Determine if this token gets an active ε_k generator
        const shouldBind =
          !isProse || isFrontmatterSym || isaParent !== undefined || resolvedSym !== undefined || freq >= 2;

        if (shouldBind) {
          symbolName = resolvedSym?.name ?? tok.text;
          symbolKind = resolvedSym?.kind;

          // Determine relational rule & sign
          const isNegated =
            prevTok?.text === "-" &&
            (i < 2 ||
              rawTokens[i - 2]!.kind === "operator" ||
              rawTokens[i - 2]!.kind === "punct" ||
              rawTokens[i - 2]!.text === "return");

          if (isaParent) {
            relTypeId = RelTypeId.ONTOLOGY_ISA;
            ontologyIri = `owl:${isaParent}`;
            relSign = 1.0;
            const key = `isa:${symbolName}->${isaParent}`;
            groupId = getOrCreateGroup(key, `${symbolName} ⊑ ${isaParent}`, relTypeId, symbolName, ontologyIri);
          } else if (isCad && looksLikeToleranceIdent(symbolName)) {
            relTypeId = isNegated ? RelTypeId.INVERSE_COUPLE : RelTypeId.GDT_TOLERANCE_CONE;
            relSign = isNegated ? -1.0 : 1.0;
            groupId = getOrCreateGroup(`sym:${symbolName}`, symbolName, RelTypeId.GDT_TOLERANCE_CONE, symbolName);
          } else if (isOnt) {
            relTypeId = RelTypeId.ONTOLOGY_ISA;
            ontologyIri = `owl:${symbolName}`;
            relSign = 1.0;
            groupId = getOrCreateGroup(
              `owl:${symbolName}`,
              symbolName,
              RelTypeId.ONTOLOGY_ISA,
              symbolName,
              ontologyIri,
            );
          } else {
            relTypeId = isNegated ? RelTypeId.INVERSE_COUPLE : RelTypeId.IDENTITY_SYNC;
            relSign = isNegated ? -1.0 : 1.0;
            const canonicalKey = resolvedSym ? `symid:${resolvedSym.id}:${resolvedSym.name}` : `sym:${symbolName}`;
            groupId = getOrCreateGroup(canonicalKey, symbolName, RelTypeId.IDENTITY_SYNC, symbolName);
          }
        }
      }
    }

    const startLC = offsetToLineCol(lineStarts, tok.startOffset);
    const endLC = offsetToLineCol(lineStarts, tok.endOffset);

    tokenIds.push(tokenId);
    groupIds.push(groupId);
    relTypeIds.push(relTypeId);
    relSigns.push(relSign);
    spans.push({
      index: i,
      text: tok.text,
      startOffset: tok.startOffset,
      endOffset: tok.endOffset,
      startLine: startLC.line,
      startColumn: startLC.column,
      endLine: endLC.line,
      endColumn: endLC.column,
      tokenId,
      groupId,
      relTypeId,
      relSign,
      ...(symbolName ? { symbolName } : {}),
      ...(symbolKind ? { symbolKind } : {}),
      ...(ontologyIri ? { ontologyIri } : {}),
    });
  }

  const record: RelationalHypergraphRecord = {
    exampleId: `rhg_${fnv1a32(`${uri}:${dialectNorm}:${source}`).toString(16).padStart(8, "0")}`,
    uri,
    dialect: dialectNorm,
    mInit: 0,
    tokenIds,
    groupIds,
    relTypeIds,
    relSigns,
    spans,
    groups: [],
    ...(formalCert ? { formalCert } : {}),
  };

  rebuildGroupSummaries(record, groupMeta);

  if (overrides && overrides.length > 0) {
    return applyHypergraphOverrides(record, overrides);
  }
  return record;
}

function rebuildGroupSummaries(
  record: RelationalHypergraphRecord,
  existingMeta?: Map<number, { label: string; primaryRelType: RelTypeId; symbolName?: string; ontologyIri?: string }>,
): void {
  const counts = new Map<number, number>();
  const inferred = new Map<
    number,
    { label: string; primaryRelType: RelTypeId; symbolName?: string | undefined; ontologyIri?: string | undefined }
  >();

  for (let i = 0; i < record.spans.length; i++) {
    const span = record.spans[i]!;
    const gid = record.groupIds[i]!;
    if (gid <= 0) continue;
    counts.set(gid, (counts.get(gid) ?? 0) + 1);
    if (!inferred.has(gid)) {
      const m = existingMeta?.get(gid);
      const resolvedSymbol = m?.symbolName ?? span.symbolName;
      const resolvedOnt = m?.ontologyIri ?? span.ontologyIri;
      inferred.set(gid, {
        label: m?.label ?? span.symbolName ?? span.text,
        primaryRelType: m?.primaryRelType ?? record.relTypeIds[i]!,
        ...(resolvedSymbol ? { symbolName: resolvedSymbol } : {}),
        ...(resolvedOnt ? { ontologyIri: resolvedOnt } : {}),
      });
    }
  }

  const sortedIds = Array.from(counts.keys()).sort((a, b) => a - b);
  const groups: GeneratorGroupSummary[] = sortedIds.map((gid) => {
    const meta = inferred.get(gid)!;
    return {
      groupId: gid,
      label: meta.label,
      primaryRelType: meta.primaryRelType,
      tokenCount: counts.get(gid) ?? 0,
      ...(meta.symbolName ? { symbolName: meta.symbolName } : {}),
      ...(meta.ontologyIri ? { ontologyIri: meta.ontologyIri } : {}),
    };
  });

  record.groups = groups;
  record.mInit = groups.length;
}

/**
 * Applies interactive Ansatz Editor or Social RLHF annotator overrides to an existing
 * 4-column RelationalHypergraphRecord, returning a clean updated copy with recomputed `mInit`.
 */
export function applyHypergraphOverrides(
  record: RelationalHypergraphRecord,
  overrides: HypergraphTokenOverride[],
): RelationalHypergraphRecord {
  const next: RelationalHypergraphRecord = {
    ...record,
    tokenIds: [...record.tokenIds],
    groupIds: [...record.groupIds],
    relTypeIds: [...record.relTypeIds],
    relSigns: [...record.relSigns],
    spans: record.spans.map((s) => ({ ...s })),
    groups: record.groups.map((g) => ({ ...g })),
  };

  const toleranceByGroup = new Map<
    number,
    { lower?: number | undefined; upper?: number | undefined; unit?: string | undefined }
  >();

  for (const ov of overrides) {
    for (let i = 0; i < next.spans.length; i++) {
      const span = next.spans[i]!;
      const matches =
        (ov.tokenIndex !== undefined && span.index === ov.tokenIndex) ||
        (ov.symbolName !== undefined && (span.symbolName === ov.symbolName || span.text === ov.symbolName));
      if (!matches) continue;

      if (ov.groupId !== undefined) {
        next.groupIds[i] = ov.groupId;
        span.groupId = ov.groupId;
        if (ov.groupId === 0) {
          next.relTypeIds[i] = RelTypeId.NONE;
          next.relSigns[i] = 0.0;
          span.relTypeId = RelTypeId.NONE;
          span.relSign = 0.0;
        }
      }
      if (ov.relTypeId !== undefined) {
        next.relTypeIds[i] = ov.relTypeId;
        span.relTypeId = ov.relTypeId;
      }
      if (ov.relSign !== undefined) {
        next.relSigns[i] = ov.relSign;
        span.relSign = ov.relSign;
      }
      if (ov.ontologyIri !== undefined) {
        span.ontologyIri = ov.ontologyIri;
      }
      if (ov.toleranceSpec !== undefined && span.groupId > 0) {
        toleranceByGroup.set(span.groupId, ov.toleranceSpec);
      }
    }
  }

  rebuildGroupSummaries(next);
  for (const g of next.groups) {
    const tol = toleranceByGroup.get(g.groupId);
    if (tol) g.toleranceSpec = tol;
  }
  return next;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic-m Batch Bucketing Utility (for Browser OPFS & GPU DataLoaders)
// ─────────────────────────────────────────────────────────────────────────────

export interface DynamicMBatchBucket {
  bucketId: number;
  mBatchMax: number;
  examples: RelationalHypergraphRecord[];
}

/**
 * Groups compiled RelationalHypergraphRecords by similar `mInit` generator counts so GPUs/WebGPU
 * only pad each mini-batch to `mBatchMax` rather than a rigid global worst-case generator cap.
 */
export function bucketHypergraphExamples(
  examples: RelationalHypergraphRecord[],
  batchSize: number,
  mCap = 32,
): DynamicMBatchBucket[] {
  const safeBatchSize = Math.max(1, Math.floor(batchSize));
  const sorted = [...examples].sort((a, b) => a.mInit - b.mInit);
  const buckets: DynamicMBatchBucket[] = [];

  for (let i = 0; i < sorted.length; i += safeBatchSize) {
    const slice = sorted.slice(i, i + safeBatchSize);
    const maxM = slice.reduce((acc, ex) => Math.max(acc, Math.min(ex.mInit, mCap)), 0);
    buckets.push({
      bucketId: buckets.length,
      mBatchMax: maxM,
      examples: slice,
    });
  }

  return buckets;
}
