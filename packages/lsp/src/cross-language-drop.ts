// SPDX-License-Identifier: AGPL-3.0-or-later

import { type XmlElement } from "@modelscript/dsl/xml";
import {
  buildModelicaComponentDropEdits,
  deriveModelNameFromUri,
  parseIconCoordinateSystemFromSource,
  type IconCoordSys,
} from "@modelscript/modelica/diagram";
import { buildPscadComponentDropEdits } from "@modelscript/pscad";
import type { SymbolEntry, SymbolIndex } from "@modelscript/runtime";
import { buildSimulinkComponentDropEdits } from "@modelscript/simulink";
import { buildSpiceComponentDropEdits } from "@modelscript/spice";
import { TextEdit } from "vscode-languageserver";

/**
 * Resolved metadata and code generation instructions when dropping a catalog,
 * library, or workspace component onto a target diagram canvas.
 */
export interface CrossLanguageDropResolution {
  /** Type specifier normalized for the target language (`Pkg::Type` for SysML2, `Pkg.Type` or wrapper name for Modelica). */
  className: string;
  /** Default identifier prefix for generating a unique instance name. */
  baseName: string;
  /** Optional qualified import path to insert into the enclosing scope if missing. */
  importPath?: string | undefined;
  /** SysML2 usage keyword when dropping onto `.sysml`. */
  sysmlUsageKind?: "part" | "port" | "attribute" | "item" | undefined;
  /** Optional unindented black-box stub (`model ...` or `part def ...`) when dropping PSSE/PSCAD components. */
  stubBlock?: string | undefined;
  /** Identifier of the synthesized black-box wrapper/stub, if applicable. */
  stubName?: string | undefined;
  /** Source language of the dropped symbol, when known. */
  sourceLanguage?: string | undefined;
}

const SYSML2_METACLASS_TYPES = new Set([
  "PartDefinition",
  "PartUsage",
  "AttributeDefinition",
  "AttributeUsage",
  "PortDefinition",
  "PortUsage",
  "ItemDefinition",
  "ItemUsage",
  "EnumerationDefinition",
  "ActionDefinition",
  "ActionUsage",
  "StateDefinition",
  "StateUsage",
  "CalculationDefinition",
  "CalculationUsage",
  "RequirementDefinition",
  "RequirementUsage",
  "ConcernDefinition",
  "ConcernUsage",
  "ConstraintDefinition",
  "ConstraintUsage",
  "UseCaseDefinition",
  "UseCaseUsage",
  "AnalysisCaseDefinition",
  "AnalysisCaseUsage",
  "VerificationCaseDefinition",
  "VerificationCaseUsage",
  "CaseDefinition",
  "CaseUsage",
  "ConnectionDefinition",
  "InterfaceDefinition",
  "AllocationDefinition",
  "FlowDefinition",
  "ViewDefinition",
  "ViewUsage",
  "ViewpointDefinition",
  "ViewpointUsage",
  "RenderingDefinition",
  "RenderingUsage",
  "OccurrenceDefinition",
  "ForkNode",
  "JoinNode",
  "DecisionNode",
  "MergeNode",
  "AcceptActionNode",
  "SendActionNode",
  "ActorDefinition",
  "ActorUsage",
]);

function isWsChar(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\n" || ch === "\f" || ch === "\v";
}

function isAsciiLetter(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

function isIdentStartChar(ch: string): boolean {
  return isAsciiLetter(ch) || ch === "_";
}

function isWordTokenChar(ch: string): boolean {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  return isIdentStartChar(ch) || (c >= 48 && c <= 57);
}

function isDigitsOnly(s: string): boolean {
  if (!s) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
}

function hasWordMatch(text: string, word: string): boolean {
  if (!word) return false;
  const checkStart = isWordTokenChar(word[0]!);
  const checkEnd = isWordTokenChar(word[word.length - 1]!);
  let idx = text.indexOf(word);
  while (idx !== -1) {
    const beforeOk = !checkStart || idx === 0 || !isWordTokenChar(text[idx - 1]!);
    const afterPos = idx + word.length;
    const afterOk = !checkEnd || afterPos === text.length || !isWordTokenChar(text[afterPos]!);
    if (beforeOk && afterOk) return true;
    idx = text.indexOf(word, idx + 1);
  }
  return false;
}

function splitPathDelimiters(value: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i <= value.length; i++) {
    const ch = i < value.length ? value[i]! : ".";
    if (ch === "." || ch === ":" || ch === "/" || ch === "\\") {
      if (i > start) out.push(value.slice(start, i));
      start = i + 1;
    }
  }
  return out;
}

function splitLanguagePrefix(rawClassName: string): string | null {
  const sep = rawClassName.indexOf("::");
  if (sep <= 0) return null;
  for (let i = 0; i < sep; i++) {
    const ch = rawClassName[i]!;
    if (!isWordTokenChar(ch) && ch !== "-") return null;
  }
  return rawClassName.slice(0, sep);
}

function findTrailingContainerCloseSuffix(text: string, tagNames: string[]): string | null {
  let end = text.length;
  while (end > 0 && isWsChar(text[end - 1]!)) end--;
  if (end === 0 || text[end - 1] !== ">") return null;
  const tagOpen = text.lastIndexOf("</", end - 1);
  if (tagOpen <= 0) return null;
  const tagName = text
    .slice(tagOpen + 2, end - 1)
    .trim()
    .toLowerCase();
  if (!tagNames.includes(tagName)) return null;
  let lineStart = tagOpen;
  while (lineStart > 0 && (text[lineStart - 1] === " " || text[lineStart - 1] === "\t")) {
    lineStart--;
  }
  if (lineStart === 0 || text[lineStart - 1] !== "\n") return null;
  return text.slice(lineStart - 1);
}

function sanitizeIdentifier(raw: string, fallback = "comp"): string {
  let out = "";
  let prevUnderscore = true;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (isWordTokenChar(ch) && ch !== "_") {
      out += ch;
      prevUnderscore = false;
    } else if (!prevUnderscore) {
      out += "_";
      prevUnderscore = true;
    }
  }
  if (out.endsWith("_")) out = out.slice(0, -1);
  if (!out) return fallback;
  return isIdentStartChar(out[0]!) ? out : `${fallback}_${out}`;
}

const DROP_URI_SCHEMES = ["modelica://", "sysml2://", "sysml://", "psse://", "pscad://"];

/**
 * Strips library / URI prefixes while normalizing separator tokens (`.` vs `::`).
 */
export function cleanDropClassName(rawClassName: string): string {
  let s = rawClassName.trim();
  if (s.startsWith("__LIB__:")) {
    const rest = s.slice("__LIB__:".length);
    const slash = rest.indexOf("/");
    s = slash !== -1 ? rest.slice(slash + 1) : rest;
  }
  const lower = s.toLowerCase();
  for (const scheme of DROP_URI_SCHEMES) {
    if (lower.startsWith(scheme)) {
      return s.slice(scheme.length);
    }
  }
  return s;
}

function splitSegments(qualifiedName: string): string[] {
  const out: string[] = [];
  for (const part of qualifiedName.split("::")) {
    for (const seg of part.split(".")) {
      if (seg.length > 0) out.push(seg);
    }
  }
  return out;
}

function getQualifiedSegmentsFromIndex(index: SymbolIndex, entry: SymbolEntry): string[] {
  const parts: string[] = [entry.name];
  let currId = entry.parentId;
  const visited = new Set<number>([entry.id]);
  while (currId != null && !visited.has(currId)) {
    visited.add(currId);
    const parent = index.symbols.get(currId);
    if (!parent) break;
    if (
      parent.name &&
      parent.name !== "<anonymous>" &&
      parent.name !== "SourceFile" &&
      parent.name !== "PsseCase" &&
      parent.name !== "PsseDynamicData"
    ) {
      parts.unshift(parent.name);
    }
    currId = parent.parentId;
  }
  return parts;
}

function findSymbolInUnifiedIndex(index: SymbolIndex | null | undefined, cleanName: string): SymbolEntry | null {
  if (!index || !cleanName) return null;
  const segments = splitSegments(cleanName);
  if (segments.length === 0) return null;
  const leaf = segments[segments.length - 1]!;

  const candidateIds = index.byName?.get(leaf) ?? [];
  const candidates: SymbolEntry[] = [];
  for (const id of candidateIds) {
    const sym = index.symbols?.get(id);
    if (sym) candidates.push(sym);
  }

  if (candidates.length === 0 && index.symbols) {
    const normClean = segments.join(".");
    for (const sym of index.symbols.values()) {
      const np = (sym.namePath || "").replaceAll("::", ".");
      if (np === normClean || sym.name === cleanName || sym.name === leaf) {
        candidates.push(sym);
      }
    }
  }
  if (candidates.length === 0) return null;

  const isTypeDef = (s: SymbolEntry) =>
    s.kind === "Class" ||
    s.kind === "Definition" ||
    s.kind === "Metaclass" ||
    s.ruleName?.endsWith("Definition") ||
    s.ruleName === "pscad_component";

  if (segments.length === 1) {
    return candidates.find(isTypeDef) ?? candidates[0]!;
  }

  const targetDot = segments.join(".");
  for (const cand of candidates) {
    const qual = getQualifiedSegmentsFromIndex(index, cand).join(".");
    const np = (cand.namePath || "").replaceAll("::", ".");
    if (qual === targetDot || qual.endsWith(`.${targetDot}`) || np === targetDot || np.endsWith(`.${targetDot}`)) {
      return cand;
    }
  }

  return candidates.find(isTypeDef) ?? candidates[0]!;
}

function inferSymbolLanguage(sym: SymbolEntry | null, cleanName: string): string {
  if (sym) {
    const lang = (sym.language ?? "").toLowerCase();
    if (lang === "sysml") return "sysml2";
    if (lang) return lang;
    if (sym.ruleName?.startsWith("pscad_")) return "pscad";
    if (sym.ruleName?.startsWith("psse_")) return "psse";
    if (
      sym.ruleName === "PartDefinition" ||
      sym.ruleName === "PortDefinition" ||
      sym.ruleName === "InterfaceDefinition" ||
      sym.ruleName === "AttributeDefinition" ||
      sym.ruleName === "ItemDefinition" ||
      sym.ruleName === "RequirementDefinition" ||
      sym.ruleName === "ActionDefinition"
    ) {
      return "sysml2";
    }
    if (sym.ruleName?.startsWith("simulink_") || sym.ruleName === "SimulinkBlock") return "simulink";
    if (sym.ruleName?.startsWith("spice_") || sym.ruleName === "SpiceSubcircuit") return "spice";
    const uri = (sym.resourceId ?? sym.documentUri ?? "").toLowerCase();
    if (uri.endsWith(".sysml") || uri.endsWith(".sysml2")) return "sysml2";
    if (uri.endsWith(".pscx") || uri.endsWith(".pslx")) return "pscad";
    if (uri.endsWith(".raw") || uri.endsWith(".dyr")) return "psse";
    if (uri.endsWith(".mdl") || uri.endsWith(".slx")) return "simulink";
    if (uri.endsWith(".cir") || uri.endsWith(".sp") || uri.endsWith(".spice")) return "spice";
    if (uri.endsWith(".mo")) return "modelica";
  }
  if (cleanName.includes("::")) return "sysml2";
  return "";
}

function isConnectorLikeSymbol(sym: SymbolEntry | null): boolean {
  if (!sym) return false;
  if (sym.ruleName === "PortDefinition" || sym.ruleName === "PortUsage") return true;
  const prefixes = String(sym.metadata?.["classPrefixes"] ?? "").toLowerCase();
  if (prefixes.includes("connector")) return true;
  const defKind = String(sym.metadata?.["defKind"] ?? sym.metadata?.["usageKind"] ?? "").toLowerCase();
  return defKind.includes("port");
}

function resolveSysmlUsageKind(sym: SymbolEntry | null): "part" | "port" | "attribute" | "item" {
  if (!sym) return "part";
  if (isConnectorLikeSymbol(sym)) return "port";
  if (sym.ruleName === "AttributeDefinition" || sym.ruleName === "AttributeUsage") return "attribute";
  if (sym.ruleName === "ItemDefinition" || sym.ruleName === "ItemUsage") return "item";
  return "part";
}

function hasModelicaImport(docText: string, importTarget: string): boolean {
  let clean = importTarget.trim();
  while (clean.endsWith(".")) clean = clean.slice(0, -1);
  if (!clean) return true;
  const parts = clean.split(".");
  const wildcardTarget = parts.length >= 2 ? `${parts.slice(0, -1).join(".")}.*` : null;
  for (const rawLine of docText.split("\n")) {
    const trimmed = rawLine.trimStart();
    if (!trimmed.startsWith("import") || trimmed.length <= 6 || !isWsChar(trimmed[6]!)) continue;
    const semiIdx = trimmed.indexOf(";");
    if (semiIdx === -1) continue;
    const target = trimmed.slice(6, semiIdx).trim();
    if (target === clean || (wildcardTarget !== null && target === wildcardTarget)) {
      return true;
    }
  }
  return false;
}

/**
 * Resolves a component or class drop target across Modelica, SysML2, PSSE, and PSCAD
 * into target-language normalized types, missing imports, and optional black-box wrappers.
 */
export function resolveCrossLanguageComponentDrop(
  index: SymbolIndex | null | undefined,
  rawClassName: string,
  targetLang: "modelica" | "sysml2",
  _docText = "",
): CrossLanguageDropResolution {
  const clean = cleanDropClassName(rawClassName);
  const inputSegments = splitSegments(clean);
  const fallbackLeaf = inputSegments[inputSegments.length - 1] || clean || "comp";

  // Preserve SysML2 built-in stencil metaclasses directly
  if (targetLang === "sysml2" && SYSML2_METACLASS_TYPES.has(clean)) {
    const baseParts = clean.replace("Definition", "").replace("Usage", "");
    return {
      className: clean,
      baseName: baseParts.charAt(0).toLowerCase() + baseParts.slice(1),
    };
  }

  const sym = findSymbolInUnifiedIndex(index, clean);
  const srcLang = inferSymbolLanguage(sym, clean);

  // Direct name-based linking for PSCAD & PSSE drops (no _BlackBox / __modelscript_blackbox wrappers)
  if (srcLang === "pscad" || srcLang === "psse") {
    const rawSegs = sym && index ? getQualifiedSegmentsFromIndex(index, sym) : inputSegments;
    const qualSegs = rawSegs.map((s) => sanitizeIdentifier(s, "Item"));
    const leaf = qualSegs[qualSegs.length - 1] || fallbackLeaf;
    const normalizedName = targetLang === "modelica" ? qualSegs.join(".") : qualSegs.join("::");
    return {
      className: normalizedName,
      baseName: leaf,
      ...(targetLang === "sysml2" ? { sysmlUsageKind: "part" as const } : {}),
      sourceLanguage: srcLang,
    };
  }

  // Reconstruct canonical qualified path (`.` vs `::` normalized to target language)
  const projTable = (
    index as { tggProjectionTable?: { canResolveAs?: (lang: string, s: SymbolEntry) => boolean } } | null | undefined
  )?.tggProjectionTable;
  const isTggCompatible = Boolean(sym && projTable?.canResolveAs?.(targetLang, sym));
  const isTypeLike =
    sym &&
    (sym.kind === "Class" ||
      sym.kind === "Definition" ||
      sym.kind === "Metaclass" ||
      sym.kind === "Module" ||
      sym.kind === "Package" ||
      sym.kind === "Type" ||
      isTggCompatible);
  const SYNTHETIC_FILE_ROOTS = new Set(["scad_file", "reqif_specification", "qif_document"]);
  const rawQualSegs =
    isTypeLike && index
      ? (() => {
          const segs: string[] = [];
          let cur: SymbolEntry | undefined = sym;
          const visited = new Set<number>();
          while (cur && !visited.has(cur.id)) {
            visited.add(cur.id);
            if (cur.name && !SYNTHETIC_FILE_ROOTS.has(cur.ruleName ?? "")) {
              segs.unshift(cur.name);
            }
            cur = cur.parentId != null ? index.symbols.get(cur.parentId) : undefined;
          }
          return segs.length > 0 ? segs : getQualifiedSegmentsFromIndex(index, sym);
        })()
      : [];
  const resolvedSegs = rawQualSegs.length > 0 ? rawQualSegs : inputSegments.length > 0 ? inputSegments : [fallbackLeaf];
  const leaf = resolvedSegs[resolvedSegs.length - 1] || fallbackLeaf;
  const isCrossLang = Boolean(srcLang && srcLang !== targetLang);

  if (targetLang === "sysml2") {
    const sysmlType = resolvedSegs.join("::");
    const importPath = resolvedSegs.length >= 2 ? sysmlType : undefined;
    const instanceBase = leaf.charAt(0).toLowerCase() + leaf.slice(1);
    return {
      className: sysmlType,
      baseName: sanitizeIdentifier(instanceBase, "part"),
      importPath,
      sysmlUsageKind: resolveSysmlUsageKind(sym),
      sourceLanguage: srcLang || undefined,
    };
  }

  // targetLang === "modelica"
  const dotType = resolvedSegs.join(".");
  const importPath = isCrossLang && resolvedSegs.length >= 2 ? dotType : undefined;
  return {
    className: dotType,
    baseName: leaf,
    importPath,
    sourceLanguage: srcLang || undefined,
  };
}

/**
 * Generates an initial unique identifier that does not collide with names in `docText`.
 */
export function generateUniqueNameInText(docText: string, baseName: string): string {
  return allocateUniqueIdentifier(docText, baseName);
}

export { deriveModelNameFromUri, parseIconCoordinateSystemFromSource };

/**
 * Computes atomic `TextEdit[]` for dropping a same-language or cross-language component onto a Modelica file,
 * handling `.mo` scaffolding when empty, `::` -> `.` normalization, missing `import` clauses, and
 * PSSE/PSCAD black-box wrapper synthesis.
 */
export function computeModelicaComponentDropEdits<
  T extends { name?: string | undefined } = { name?: string | undefined },
>(params: {
  docText: string;
  uri: string;
  rawClassName: string;
  x: number;
  y: number;
  classInstance: T | null | undefined;
  computeComponentInsert?:
    | ((
        ci: T,
        className: string,
        compName: string,
        x: number,
        y: number,
        docText: string,
        componentIconCoord?: IconCoordSys | null,
      ) => TextEdit[])
    | undefined;
  unifiedIndex?: SymbolIndex | null | undefined;
  instanceName?: string | undefined;
  componentIconCoord?: IconCoordSys | null | undefined;
  getResourceText?: ((uri: string) => string | undefined) | undefined;
}): TextEdit[] {
  const {
    docText,
    uri,
    rawClassName,
    x,
    y,
    classInstance,
    computeComponentInsert,
    unifiedIndex,
    instanceName,
    componentIconCoord,
    getResourceText,
  } = params;
  const resolved = resolveCrossLanguageComponentDrop(unifiedIndex, rawClassName, "modelica", docText);
  const compName = instanceName || generateUniqueNameInText(docText, resolved.baseName);

  let effectiveIconCoord: IconCoordSys | null = componentIconCoord ?? null;
  if (!effectiveIconCoord && unifiedIndex) {
    const sym = findSymbolInUnifiedIndex(unifiedIndex, resolved.className);
    if (sym && sym.startOffset != null && sym.endOffset != null && sym.endOffset > sym.startOffset) {
      const symText = sym.resourceId && sym.resourceId !== uri ? getResourceText?.(sym.resourceId) : docText;
      if (symText && sym.endOffset <= symText.length) {
        effectiveIconCoord = parseIconCoordinateSystemFromSource(symText.slice(sym.startOffset, sym.endOffset));
      }
    }
  }

  return buildModelicaComponentDropEdits({
    docText,
    uri,
    x,
    y,
    classInstance,
    resolved,
    compName,
    effectiveIconCoord,
    hasImport: Boolean(resolved.importPath && hasModelicaImport(docText, resolved.importPath)),
    computeComponentInsert,
  }) as TextEdit[];
}

export interface DropBatchState {
  emittedDefs: Set<string>;
  usedNames: Set<string>;
  usedIds: Set<number>;
}

export function createDropBatchState(): DropBatchState {
  return {
    emittedDefs: new Set<string>(),
    usedNames: new Set<string>(),
    usedIds: new Set<number>(),
  };
}

interface DropPortMember {
  name: string;
  direction: "in" | "out" | "inout";
  typeName: string;
}

interface DropParamMember {
  name: string;
  defaultValue: string;
  typeName: string;
}

interface ResolvedForeignDrop {
  rawClassName: string;
  cleanName: string;
  shortName: string;
  explicitLanguage: string | null;
  sourceLanguage: string;
  symbol: SymbolEntry | null;
  ports: DropPortMember[];
  params: DropParamMember[];
}

function normalizeLanguagePrefix(prefix: string): string {
  const lower = prefix.toLowerCase();
  if (lower === "sysml" || lower === "sysml2") return "sysml2";
  return lower;
}

const DEFINITION_SYMBOL_KIND_PARTS = ["class", "definition", "subcircuit", "block", "model", "entity", "package"];

function isDefinitionSymbol(sym: SymbolEntry): boolean {
  const kind = String(sym.kind ?? "").toLowerCase();
  return DEFINITION_SYMBOL_KIND_PARTS.some((part) => kind.includes(part));
}

function lookupSymbolInIndex(index: SymbolIndex | null | undefined, cleanName: string): SymbolEntry | null {
  if (!index) return null;
  const pickBest = (ids: number[] | undefined): SymbolEntry | null => {
    if (!ids || ids.length === 0) return null;
    let first: SymbolEntry | null = null;
    for (const id of ids) {
      const s = index.symbols.get(id);
      if (!s) continue;
      if (!first) first = s;
      if (isDefinitionSymbol(s)) return s;
    }
    return first;
  };

  const exact = pickBest(index.byName?.get(cleanName));
  if (exact) return exact;

  const segments = splitPathDelimiters(cleanName);
  const shortName = segments[segments.length - 1] ?? cleanName;
  const byShort = index.byName?.get(shortName);
  if (byShort && byShort.length > 0) {
    for (const id of byShort) {
      const s = index.symbols.get(id);
      if (!s || !isDefinitionSymbol(s)) continue;
      const qn = String(s.metadata?.["qualifiedName"] ?? "");
      if (qn === cleanName || qn.endsWith(`.${cleanName}`) || qn.endsWith(`::${cleanName}`)) {
        return s;
      }
      // Walk parents to reconstruct qualified path when available
      const parts: string[] = [s.name];
      let cur = s.parentId;
      while (cur !== null && cur !== undefined) {
        const parent = index.symbols.get(cur);
        if (!parent) break;
        parts.unshift(parent.name);
        cur = parent.parentId;
      }
      const joined = parts.join(".");
      if (joined === cleanName || joined.endsWith(`.${cleanName}`)) {
        return s;
      }
    }
    const fallbackShort = pickBest(byShort);
    if (fallbackShort) return fallbackShort;
  }

  for (const [, s] of index.symbols) {
    const qn = String(s.metadata?.["qualifiedName"] ?? "");
    if (qn === cleanName || (s.name === shortName && isDefinitionSymbol(s))) {
      return s;
    }
  }
  return null;
}

function collectDropInterface(
  index: SymbolIndex | null | undefined,
  sym: SymbolEntry | null,
): { ports: DropPortMember[]; params: DropParamMember[] } {
  const ports: DropPortMember[] = [];
  const params: DropParamMember[] = [];
  if (!index || !sym) return { ports, params };

  const childIds = index.childrenOf?.get(sym.id) ?? [];
  const seenNames = new Set<string>();
  for (const cid of childIds) {
    const child = index.symbols.get(cid);
    if (!child || !child.name) continue;
    const ident = sanitizeIdentifier(child.name, "field");
    if (seenNames.has(ident)) continue;

    const isParam =
      child.ruleName === "pscad_parameter" ||
      child.ruleName === "AttributeUsage" ||
      child.metadata?.["variability"] === "parameter";
    const dirRaw = String(child.metadata?.["causality"] ?? child.metadata?.["direction"] ?? "").toLowerCase();
    const hasDirectedSignal =
      dirRaw === "input" || dirRaw === "output" || dirRaw === "in" || dirRaw === "out" || dirRaw === "inout";
    const isPort =
      child.ruleName === "pscad_port" ||
      child.ruleName === "PortUsage" ||
      child.metadata?.["isConnectorPort"] === true ||
      (!isParam && hasDirectedSignal);

    if (isPort && ports.length < 24) {
      seenNames.add(ident);
      const direction: "in" | "out" | "inout" =
        dirRaw === "input" || dirRaw === "in" ? "in" : dirRaw === "output" || dirRaw === "out" ? "out" : "inout";
      const typeName = String(child.metadata?.["typeName"] ?? "Real");
      ports.push({ name: ident, direction, typeName });
      continue;
    }

    if (isParam && params.length < 24) {
      seenNames.add(ident);
      const rawVal = child.metadata?.["defaultValue"] ?? child.metadata?.["value"];
      const typeName = String(child.metadata?.["typeName"] ?? "Real");
      const defaultValue =
        rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== "" ? String(rawVal) : "0";
      params.push({ name: ident, defaultValue, typeName });
    }
  }
  return { ports, params };
}

function resolveForeignDropInfo(index: SymbolIndex | null | undefined, rawClassName: string): ResolvedForeignDrop {
  const prefix = splitLanguagePrefix(rawClassName);
  const explicitLanguage = prefix ? normalizeLanguagePrefix(prefix) : null;
  const cleanName = cleanDropClassName(rawClassName);
  const segments = splitPathDelimiters(cleanName);
  const rawShort = segments[segments.length - 1] || cleanName || "Component";
  const shortName = sanitizeIdentifier(rawShort, "Component");
  const symbol = lookupSymbolInIndex(index, cleanName);
  const inferred = inferSymbolLanguage(symbol, cleanName);
  const sourceLanguage = inferred !== "unknown" ? inferred : (explicitLanguage ?? "unknown");
  const { ports, params } = collectDropInterface(index, symbol);
  return {
    rawClassName,
    cleanName,
    shortName,
    explicitLanguage,
    sourceLanguage,
    symbol,
    ports,
    params,
  };
}

function allocateUniqueIdentifier(docText: string, baseName: string, batchState?: DropBatchState): string {
  const cleanBase = sanitizeIdentifier(baseName, "comp");
  let idx = 1;
  while (batchState?.usedNames.has(`${cleanBase}${idx}`) || hasWordMatch(docText, `${cleanBase}${idx}`)) {
    idx++;
  }
  const candidate = `${cleanBase}${idx}`;
  batchState?.usedNames.add(candidate);
  return candidate;
}

function getXmlAttr(el: XmlElement, name: string): string | undefined {
  return el.attributes.find((a) => a.name.toLowerCase() === name.toLowerCase())?.value;
}

function allocateUniqueNumericId(xmlRoot: XmlElement | null, seed: number, batchState?: DropBatchState): number {
  const existing = new Set<number>(batchState?.usedIds);
  const visit = (el: XmlElement) => {
    const idAttr = getXmlAttr(el, "id");
    if (idAttr !== undefined && isDigitsOnly(idAttr)) {
      const n = Number.parseInt(idAttr, 10);
      if (!Number.isNaN(n)) existing.add(n);
    }
    for (const ch of el.children) visit(ch);
  };
  if (xmlRoot) visit(xmlRoot);
  let candidate = seed;
  while (existing.has(candidate)) {
    candidate++;
  }
  batchState?.usedIds.add(candidate);
  return candidate;
}

export function mergeCoincidentInsertEdits(edits: TextEdit[]): TextEdit[] {
  const merged: TextEdit[] = [];
  const editIdxByKey = new Map<string, number>();

  for (const edit of edits) {
    const key = `${edit.range.start.line}:${edit.range.start.character}-${edit.range.end.line}:${edit.range.end.character}`;
    const existingIdx = editIdxByKey.get(key);
    const isZeroInsert =
      edit.range.start.line === edit.range.end.line && edit.range.start.character === edit.range.end.character;
    if (existingIdx !== undefined) {
      const prev = merged[existingIdx]!;
      if (isZeroInsert) {
        merged[existingIdx] = TextEdit.insert(edit.range.start, `${prev.newText}${edit.newText}`);
        continue;
      }
      // Two expansions of the same self-closing XML container (e.g. <definitions />) in one batch
      const closeSuffix = findTrailingContainerCloseSuffix(prev.newText, ["definitions", "schematic"]);
      const innerStart = edit.newText.indexOf(">");
      const innerEnd = edit.newText.lastIndexOf("</");
      if (closeSuffix && innerStart !== -1 && innerEnd > innerStart) {
        const innerFragment = edit.newText.slice(innerStart + 1, innerEnd).trimEnd();
        const prevPrefix = prev.newText.slice(0, prev.newText.length - closeSuffix.length);
        merged[existingIdx] = TextEdit.replace(edit.range, `${prevPrefix}${innerFragment}${closeSuffix}`);
        continue;
      }
    }
    editIdxByKey.set(key, merged.length);
    merged.push(edit);
  }
  return merged;
}

export interface PscadForeignDropOptions {
  docText: string;
  rawClassName: string;
  x: number;
  y: number;
  instanceName?: string | undefined;
  section?: string | undefined;
  hasNativeSchema?: boolean | undefined;
  schematicEndLine: number;
  unifiedIndex?: SymbolIndex | null | undefined;
  batchState?: DropBatchState | undefined;
}

/**
 * Generates PSCAD `<Definition classid="UserCmpDefn">` stub (or reuses an existing
 * matching definition) and `<User classid="UserCmp">` instance XML edits when dropping
 * a foreign cross-language symbol onto a `.pscx`/`.pslx` schematic.
 * Returns `null` when the drop targets a native PSCAD master or local user component.
 */
export function computePscadComponentDropEdits(opts: PscadForeignDropOptions): TextEdit[] | null {
  const info = resolveForeignDropInfo(opts.unifiedIndex, opts.rawClassName);
  return buildPscadComponentDropEdits({
    docText: opts.docText,
    info,
    x: opts.x,
    y: opts.y,
    instanceName: opts.instanceName,
    section: opts.section,
    hasNativeSchema: opts.hasNativeSchema,
    schematicEndLine: opts.schematicEndLine,
    batchState: opts.batchState,
    sanitizeIdentifier,
    allocateUniqueIdentifier: (docText, baseName, batchState) =>
      allocateUniqueIdentifier(docText, baseName, batchState as DropBatchState | undefined),
    allocateUniqueNumericId: (xmlRoot, seed, batchState) =>
      allocateUniqueNumericId(xmlRoot, seed, batchState as DropBatchState | undefined),
  }) as TextEdit[] | null;
}

export interface SimulinkDropOptions {
  docText: string;
  rawClassName: string;
  x: number;
  y: number;
  instanceName?: string | undefined;
  section?: string | undefined;
  unifiedIndex?: SymbolIndex | null | undefined;
  batchState?: DropBatchState | undefined;
}

/**
 * Computes `.mdl` TextEdits inserting either a native Simulink `Block` or a self-consistent
 * `SubSystem` `@twin` black-box stub preserving the foreign symbol's ports and parameters.
 */
export function computeSimulinkComponentDropEdits(opts: SimulinkDropOptions): TextEdit[] {
  const info = resolveForeignDropInfo(opts.unifiedIndex, opts.rawClassName);
  return buildSimulinkComponentDropEdits({
    docText: opts.docText,
    info,
    x: opts.x,
    y: opts.y,
    instanceName: opts.instanceName,
    section: opts.section,
    batchState: opts.batchState,
    sanitizeIdentifier,
    allocateUniqueIdentifier: (docText, baseName, batchState) =>
      allocateUniqueIdentifier(docText, baseName, batchState as DropBatchState | undefined),
  }) as TextEdit[];
}

export interface SpiceDropOptions {
  docText: string;
  rawClassName: string;
  instanceName?: string | undefined;
  unifiedIndex?: SymbolIndex | null | undefined;
  batchState?: DropBatchState | undefined;
}

/**
 * Generates SPICE `.SUBCKT` stub + `X<inst>` call (or native passive/source line)
 * inserted cleanly prior to `.END`, ensuring pin counts and passives pass SPICE linting.
 */
export function computeSpiceComponentDropEdits(opts: SpiceDropOptions): TextEdit[] {
  const info = resolveForeignDropInfo(opts.unifiedIndex, opts.rawClassName);
  return buildSpiceComponentDropEdits({
    docText: opts.docText,
    info,
    instanceName: opts.instanceName,
    batchState: opts.batchState,
    sanitizeIdentifier,
    allocateUniqueIdentifier,
  }) as TextEdit[];
}

export interface GenericDropResolution {
  className: string;
  shortName: string;
  instanceName: string;
  isForeign: boolean;
  sourceLanguage: string;
}

function inferTargetLanguageFromUri(uri: string): string {
  const lower = uri.toLowerCase();
  if (lower.endsWith(".mo")) return "modelica";
  if (lower.endsWith(".sysml")) return "sysml2";
  if (lower.endsWith(".pscx") || lower.endsWith(".pslx")) return "pscad";
  if (lower.endsWith(".mdl") || lower.endsWith(".slx")) return "simulink";
  if (lower.endsWith(".cir") || lower.endsWith(".sp") || lower.endsWith(".spice")) return "spice";
  return "generic";
}

/**
 * Resolves and sanitizes foreign/native component class and instance names for Generic DSL backends.
 */
export function resolveGenericComponentDrop(opts: {
  uri: string;
  rawClassName: string;
  docText: string;
  instanceName?: string | undefined;
  symbolIndex?: SymbolIndex | null | undefined;
  batchState?: DropBatchState | undefined;
}): GenericDropResolution {
  const { uri, rawClassName, docText, instanceName, symbolIndex, batchState } = opts;
  const info = resolveForeignDropInfo(symbolIndex, rawClassName);
  const targetLang = inferTargetLanguageFromUri(uri);
  const isForeign =
    info.explicitLanguage !== null ||
    (info.sourceLanguage !== "unknown" && targetLang !== "unknown" && info.sourceLanguage !== targetLang) ||
    (info.symbol?.resourceId !== undefined && info.symbol.resourceId !== uri && info.cleanName.includes("."));

  const className = isForeign ? info.shortName : info.cleanName || info.shortName;
  const baseName = info.shortName.charAt(0).toLowerCase() + info.shortName.slice(1);
  const uniqueName = instanceName
    ? sanitizeIdentifier(instanceName, baseName)
    : allocateUniqueIdentifier(docText, baseName, batchState);

  return {
    className,
    shortName: info.shortName,
    instanceName: uniqueName,
    isForeign,
    sourceLanguage: info.sourceLanguage,
  };
}
