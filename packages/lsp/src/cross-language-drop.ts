// SPDX-License-Identifier: AGPL-3.0-or-later

import { appendChildSplice, parseXmlSync, type Splice, type XmlElement } from "@modelscript/dsl/xml";
import type { SymbolEntry, SymbolIndex } from "@modelscript/runtime";
import { parseSpice } from "@modelscript/spice";
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

function isSimpleAsciiIdent(s: string): boolean {
  if (!s || !isIdentStartChar(s[0]!)) return false;
  for (let i = 1; i < s.length; i++) {
    if (!isWordTokenChar(s[i]!)) return false;
  }
  return true;
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

function tokenizeAsciiWords(text: string, fromIndex = 0, maxTokens = Number.MAX_SAFE_INTEGER): string[] {
  const tokens: string[] = [];
  let i = fromIndex;
  while (i < text.length && tokens.length < maxTokens) {
    const ch = text[i]!;
    if (isWsChar(ch)) {
      i++;
      continue;
    }
    if (isWordTokenChar(ch)) {
      const start = i;
      i++;
      while (i < text.length && isWordTokenChar(text[i]!)) i++;
      tokens.push(text.slice(start, i));
    } else {
      tokens.push(ch);
      i++;
    }
  }
  return tokens;
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

function stripHashCommentOutsideQuotes(line: string): string {
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === "\\" && i + 1 < line.length) i++;
      else if (ch === '"') inQuotes = false;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === "#") {
      return line.slice(0, i);
    }
  }
  return line;
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

const MODELICA_CLASS_QUALIFIERS = new Set(["partial", "encapsulated", "replaceable"]);
const MODELICA_CLASS_KEYWORDS = new Set(["model", "class", "block", "record", "package", "connector", "type"]);

function matchModelicaClassHeaderIndent(line: string, targetClassName?: string): string | null {
  let i = 0;
  while (i < line.length && isWsChar(line[i]!)) i++;
  const baseIndent = line.slice(0, i);
  const tokens = tokenizeAsciiWords(line, i, 6);
  let tokIdx = 0;
  while (tokIdx < tokens.length && MODELICA_CLASS_QUALIFIERS.has(tokens[tokIdx]!)) {
    tokIdx++;
  }
  const kw = tokens[tokIdx];
  if (!kw) return null;
  const validKw = MODELICA_CLASS_KEYWORDS.has(kw) || (targetClassName !== undefined && kw === "function");
  if (!validKw) return null;
  const nameTok = tokens[tokIdx + 1];
  if (!nameTok) return null;
  if (targetClassName !== undefined) {
    return nameTok === targetClassName ? baseIndent : null;
  }
  return isSimpleAsciiIdent(nameTok) ? baseIndent : null;
}

function countUnescapedDoubleQuotes(line: string): number {
  let count = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === "\\" && i + 1 < line.length) {
      i++;
      continue;
    }
    if (ch === '"') count++;
  }
  return count;
}

/**
 * Finds the line index immediately after the class header (and optional description string)
 * inside a Modelica source buffer so `import` / nested stubs can be inserted cleanly.
 */
function findModelicaClassHeaderEndLine(lines: string[], className?: string): { line: number; indent: string } | null {
  for (let i = 0; i < lines.length; i++) {
    const baseIndent = matchModelicaClassHeaderIndent(lines[i]!, className);
    if (baseIndent === null) continue;
    const bodyIndent = `${baseIndent}  `;
    let afterLine = i;
    // Skip optional Modelica description string immediately following class header
    if (i + 1 < lines.length && lines[i + 1]!.trimStart().startsWith('"')) {
      afterLine = i + 1;
      let quoteCount = countUnescapedDoubleQuotes(lines[afterLine]!);
      while (quoteCount % 2 === 1 && afterLine + 1 < lines.length) {
        afterLine++;
        quoteCount += countUnescapedDoubleQuotes(lines[afterLine]!);
      }
    }
    return { line: afterLine, indent: bodyIndent };
  }
  return null;
}

function indentMultiline(block: string, indent: string): string {
  return block
    .split("\n")
    .map((l) => (l.trim().length > 0 ? `${indent}${l}` : ""))
    .join("\n");
}

function formatPlacementAnnotation(x: number, y: number): string {
  const rx = Math.round(x);
  const ry = Math.round(y);
  return `annotation(Placement(transformation(extent={{${rx - 10},${ry - 10}},{${rx + 10},${ry + 10}}})))`;
}

/**
 * Derives a valid Modelica identifier from a document URI for scaffolding empty `.mo` files.
 */
export function deriveModelNameFromUri(uri: string): string {
  const rawName = decodeURIComponent(uri.split("/").pop() || "Model");
  const strippedExt = rawName.toLowerCase().endsWith(".mo") ? rawName.slice(0, -3) : rawName;
  let fileName = "";
  for (let i = 0; i < strippedExt.length; i++) {
    const ch = strippedExt[i]!;
    fileName += isWordTokenChar(ch) ? ch : "_";
  }
  if (!fileName) return "Model";
  return isIdentStartChar(fileName[0]!) ? fileName : `M_${fileName}`;
}

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
    | ((ci: T, className: string, compName: string, x: number, y: number, docText: string) => TextEdit[])
    | undefined;
  unifiedIndex?: SymbolIndex | null | undefined;
  instanceName?: string | undefined;
}): TextEdit[] {
  const { docText, uri, rawClassName, x, y, classInstance, computeComponentInsert, unifiedIndex, instanceName } =
    params;
  const resolved = resolveCrossLanguageComponentDrop(unifiedIndex, rawClassName, "modelica", docText);
  const compName = instanceName || generateUniqueNameInText(docText, resolved.baseName);

  // Empty .mo file scaffold
  if (!docText || docText.trim().length === 0 || !classInstance) {
    const modelName = deriveModelNameFromUri(uri);
    const bodyLines: string[] = [];
    if (resolved.importPath && !hasModelicaImport(docText, resolved.importPath)) {
      bodyLines.push(`  import ${resolved.importPath};`);
    }
    if (resolved.stubBlock) {
      bodyLines.push(indentMultiline(resolved.stubBlock, "  "));
    }
    bodyLines.push(`  ${resolved.className} ${compName} ${formatPlacementAnnotation(x, y)};`);
    const scaffold = `model ${modelName}\n${bodyLines.join("\n")}\nequation\nend ${modelName};\n`;
    return [TextEdit.insert({ line: 0, character: 0 }, scaffold)];
  }

  const compEdits: TextEdit[] = computeComponentInsert
    ? computeComponentInsert(classInstance, resolved.className, compName, x, y, docText)
    : [];

  const needsImport = Boolean(resolved.importPath && !hasModelicaImport(docText, resolved.importPath));
  const importLine = needsImport ? `import ${resolved.importPath};` : undefined;
  const preambleChunks: string[] = [];
  if (importLine) preambleChunks.push(importLine);
  if (resolved.stubBlock) preambleChunks.push(resolved.stubBlock);

  if (preambleChunks.length === 0) {
    return compEdits;
  }

  const lines = docText.split("\n");
  const headerPos = findModelicaClassHeaderEndLine(lines, classInstance?.name);
  if (!headerPos) {
    const topPreamble = preambleChunks.map((c) => c).join("\n") + "\n";
    return [TextEdit.insert({ line: 0, character: 0 }, topPreamble), ...compEdits];
  }

  const preambleText = preambleChunks.map((c) => indentMultiline(c, headerPos.indent)).join("\n");
  const headerLine = headerPos.line;
  const conflictsWithCompEdit = compEdits.some(
    (e) => e.range.start.line <= headerLine && e.range.end.line >= headerLine,
  );

  if (!conflictsWithCompEdit) {
    const endCol = lines[headerLine]?.length ?? 0;
    return [TextEdit.insert({ line: headerLine, character: endCol }, `\n${preambleText}`), ...compEdits];
  }

  // Merge cleanly onto the first component edit when the class is on a single line
  if (compEdits.length > 0) {
    const first = compEdits[0]!;
    return [TextEdit.replace(first.range, `${preambleText}\n${first.newText}`), ...compEdits.slice(1)];
  }

  const endCol = lines[headerLine]?.length ?? 0;
  return [TextEdit.insert({ line: headerLine, character: endCol }, `\n${preambleText}`)];
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

function escapeXmlAttr(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
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

function findAllXmlElements(root: XmlElement | null, predicate: (el: XmlElement) => boolean): XmlElement[] {
  const out: XmlElement[] = [];
  const visit = (el: XmlElement) => {
    if (predicate(el)) out.push(el);
    for (const ch of el.children) visit(ch);
  };
  if (root) visit(root);
  return out;
}

function getXmlAttr(el: XmlElement, name: string): string | undefined {
  return el.attributes.find((a) => a.name.toLowerCase() === name.toLowerCase())?.value;
}

function xmlSpliceToTextEdit(docText: string, splice: Splice): TextEdit {
  const lineStarts = [0];
  for (let i = 0; i < docText.length; i++) {
    if (docText[i] === "\n") lineStarts.push(i + 1);
  }
  const toPos = (offset: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lineStarts[mid]! <= offset) lo = mid + 1;
      else hi = mid - 1;
    }
    const line = hi;
    return { line, character: offset - lineStarts[line]! };
  };
  return TextEdit.replace({ start: toPos(splice.start), end: toPos(splice.end) }, splice.text);
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
  const {
    docText,
    rawClassName,
    x,
    y,
    instanceName,
    section,
    hasNativeSchema,
    schematicEndLine,
    unifiedIndex,
    batchState,
  } = opts;
  if (hasNativeSchema) return null;

  const info = resolveForeignDropInfo(unifiedIndex, rawClassName);
  if (info.sourceLanguage === "pscad") return null;

  const xmlDoc = parseXmlSync(docText);
  const defElements = findAllXmlElements(xmlDoc.root, (el) => el.name.toLowerCase() === "definition");
  const existingDefs: Array<{ name: string; body: string }> = [];
  for (const defEl of defElements) {
    const defName = getXmlAttr(defEl, "name");
    if (defName) {
      existingDefs.push({ name: defName, body: docText.slice(defEl.openEnd, defEl.closeStart) });
    }
  }

  // If the drop name matches a native user definition without a @twin marker and we didn't find a foreign symbol, defer to native
  const directNativeDef = existingDefs.find((d) => d.name === info.cleanName || d.name === info.shortName);
  if (
    directNativeDef &&
    !directNativeDef.body.includes("@twin") &&
    !info.explicitLanguage &&
    info.sourceLanguage === "unknown"
  ) {
    return null;
  }

  if (info.sourceLanguage === "unknown" && !info.explicitLanguage && !info.cleanName.includes(".")) {
    return null;
  }

  const edits: TextEdit[] = [];
  const defnRef = info.explicitLanguage ? info.cleanName.replace(/^[^:]+::/, "") : info.cleanName;

  const baseInstName = info.shortName.charAt(0).toLowerCase() + info.shortName.slice(1);
  const instName = instanceName
    ? sanitizeIdentifier(instanceName, "cmp")
    : allocateUniqueIdentifier(docText, baseInstName, batchState);
  const instId = allocateUniqueNumericId(xmlDoc.root, 100100, batchState);

  const paramEntries = info.params
    .map((p) => `<param name="${escapeXmlAttr(p.name)}" value="${escapeXmlAttr(p.defaultValue)}" />`)
    .join("");
  const userXml =
    `<User classid="UserCmp" id="${instId}" name="${escapeXmlAttr(defnRef)}" defn="${escapeXmlAttr(defnRef)}" ` +
    `x="${Math.round(x)}" y="${Math.round(y)}" w="60" h="60" z="0" orient="0" link="-1" q="4" disable="false">` +
    `<paramlist><param name="Name" value="${escapeXmlAttr(instName)}" />${paramEntries}</paramlist></User>`;

  let targetSchematic: XmlElement | null = null;
  if (section) {
    const secDef = defElements.find((d) => getXmlAttr(d, "name") === section);
    targetSchematic = secDef?.children.find((c) => c.name.toLowerCase() === "schematic") ?? null;
  }
  if (!targetSchematic) {
    const schematics = findAllXmlElements(xmlDoc.root, (el) => el.name.toLowerCase() === "schematic");
    targetSchematic = schematics[schematics.length - 1] ?? null;
  }

  if (targetSchematic) {
    edits.push(xmlSpliceToTextEdit(docText, appendChildSplice(targetSchematic, userXml, docText)));
  } else {
    edits.push(TextEdit.insert({ line: schematicEndLine, character: 0 }, `      ${userXml}\n`));
  }
  return edits;
}

const SIMULINK_NATIVE_BLOCK_TYPES = new Set<string>([
  "Inport",
  "Outport",
  "Constant",
  "Integrator",
  "UnitDelay",
  "Gain",
  "Sum",
  "Product",
  "TransferFcn",
  "DiscreteFilter",
  "StateSpace",
  "SubSystem",
  "BusCreator",
  "BusSelector",
  "Mux",
  "Demux",
  "Math",
  "RelationalOperator",
  "LogicalOperator",
  "Switch",
  "Scope",
  "Lookup_nD",
  "Ground",
  "Terminator",
]);

function findSimulinkTargetSystemInsertLine(docText: string, section?: string): number {
  const lines = docText.split("\n");
  const stack: Array<{ kind: string; name?: string; openLine: number }> = [];
  let rootSystemCloseLine = -1;
  let sectionSystemCloseLine = -1;
  let pendingNameTarget = false;
  let lastWord = "";

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const stripped = stripHashCommentOutsideQuotes(raw);
    let j = 0;
    let inQuotes = false;
    let token = "";

    const flushToken = () => {
      if (!token) return;
      lastWord = token;
      if (pendingNameTarget && stack.length > 0 && !stack[stack.length - 1]!.name) {
        // Ignore bare unquoted Name token keyword itself
      } else if (token === "Name") {
        pendingNameTarget = true;
      } else {
        pendingNameTarget = false;
      }
      token = "";
    };

    while (j < stripped.length) {
      const ch = stripped[j]!;
      if (inQuotes) {
        if (ch === "\\" && j + 1 < stripped.length) {
          j += 2;
          continue;
        }
        if (ch === '"') {
          if (pendingNameTarget && stack.length > 0) {
            stack[stack.length - 1]!.name = token;
            pendingNameTarget = false;
          }
          token = "";
          lastWord = "";
          inQuotes = false;
        } else {
          token += ch;
        }
        j++;
        continue;
      }

      if (ch === '"') {
        flushToken();
        inQuotes = true;
        token = "";
        j++;
        continue;
      }
      if (ch === "{") {
        const blockKind = token.trim() || lastWord || "Block";
        token = "";
        lastWord = "";
        pendingNameTarget = false;
        stack.push({ kind: blockKind, openLine: i });
        j++;
        continue;
      }
      if (ch === "}") {
        flushToken();
        const popped = stack.pop();
        if (popped && popped.kind.toLowerCase() === "system") {
          const parent = stack[stack.length - 1];
          if (parent && parent.kind.toLowerCase() === "model" && rootSystemCloseLine === -1) {
            rootSystemCloseLine = i;
          }
          if (section && popped.name === section) {
            sectionSystemCloseLine = i;
          }
        }
        j++;
        continue;
      }
      if (isWsChar(ch)) {
        flushToken();
      } else {
        token += ch;
      }
      j++;
    }
    if (!inQuotes) {
      flushToken();
    }
  }

  if (sectionSystemCloseLine !== -1) return sectionSystemCloseLine;
  if (rootSystemCloseLine !== -1) return rootSystemCloseLine;
  return Math.max(0, lines.length - 1);
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
  const { docText, rawClassName, x, y, instanceName, section, unifiedIndex, batchState } = opts;
  const info = resolveForeignDropInfo(unifiedIndex, rawClassName);

  const nativeMatch = Array.from(SIMULINK_NATIVE_BLOCK_TYPES).find(
    (bt) => bt.toLowerCase() === info.shortName.toLowerCase(),
  );
  const isForeign =
    info.sourceLanguage !== "simulink" &&
    (info.symbol !== null ||
      info.explicitLanguage !== null ||
      (info.sourceLanguage !== "unknown" && !nativeMatch) ||
      (!nativeMatch && info.cleanName.includes(".")));

  const instName = instanceName
    ? sanitizeIdentifier(instanceName, "blk")
    : allocateUniqueIdentifier(docText, info.shortName, batchState);

  const rx = Math.round(x);
  const ry = Math.round(y);
  const insertLine = findSimulinkTargetSystemInsertLine(docText, section);

  if (!isForeign && nativeMatch) {
    const paramLine =
      nativeMatch === "Gain" ? `      Gain "1"\n` : nativeMatch === "Constant" ? `      Value "1"\n` : "";
    const blockText = [
      `    Block {`,
      `      BlockType ${nativeMatch}`,
      `      Name "${instName}"`,
      `      Position [${rx}, ${ry}, ${rx + 80}, ${ry + 40}]`,
      ...(paramLine ? [paramLine.trimEnd()] : []),
      `    }`,
    ].join("\n");
    return [TextEdit.insert({ line: insertLine, character: 0 }, `${blockText}\n`)];
  }

  // Foreign component -> SubSystem stub with internal matching Inport / Outport definitions
  const inPorts: DropPortMember[] = [];
  const outPorts: DropPortMember[] = [];
  for (const p of info.ports) {
    if (p.direction === "out") outPorts.push(p);
    else if (p.direction === "in") inPorts.push(p);
    else {
      // Treat bidirectional physical connector as both an input/output pair or balanced port
      if (inPorts.length <= outPorts.length) inPorts.push(p);
      else outPorts.push(p);
    }
  }

  const innerLines: string[] = [`        Name "${instName}"`];
  let rowY = 40;
  inPorts.forEach((p, idx) => {
    innerLines.push(
      `        Block {`,
      `          BlockType Inport`,
      `          Name "${p.name}"`,
      `          Port "${idx + 1}"`,
      `          Position [40, ${rowY}, 70, ${rowY + 20}]`,
      `        }`,
    );
    rowY += 50;
  });

  rowY = 40;
  outPorts.forEach((p, idx) => {
    innerLines.push(
      `        Block {`,
      `          BlockType Outport`,
      `          Name "${p.name}"`,
      `          Port "${idx + 1}"`,
      `          Position [260, ${rowY}, 290, ${rowY + 20}]`,
      `        }`,
    );
    rowY += 50;
  });

  // Wire each internal Outport so M7201 never flags internal stub Outports as unconnected
  if (outPorts.length > 0) {
    if (inPorts.length > 0) {
      outPorts.forEach((op, idx) => {
        const srcIn = inPorts[Math.min(idx, inPorts.length - 1)]!;
        innerLines.push(
          `        Line {`,
          `          SrcBlock "${srcIn.name}"`,
          `          SrcPort 1`,
          `          DstBlock "${op.name}"`,
          `          DstPort 1`,
          `        }`,
        );
      });
    } else {
      innerLines.push(
        `        Block {`,
        `          BlockType Constant`,
        `          Name "${instName}_src"`,
        `          Value "0"`,
        `          Position [120, 40, 150, 70]`,
        `        }`,
      );
      for (const op of outPorts) {
        innerLines.push(
          `        Line {`,
          `          SrcBlock "${instName}_src"`,
          `          SrcPort 1`,
          `          DstBlock "${op.name}"`,
          `          DstPort 1`,
          `        }`,
        );
      }
    }
  }

  const paramAttrs = info.params
    .slice(0, 8)
    .map((p) => `      ${sanitizeIdentifier(p.name, "Param")} "${p.defaultValue.replaceAll('"', "'")}"`);

  const subBlock = [
    `    # @twin ${info.cleanName} (${info.sourceLanguage})`,
    `    Block {`,
    `      BlockType SubSystem`,
    `      Name "${instName}"`,
    `      Tag "@twin ${info.cleanName}"`,
    `      Ports [${inPorts.length}, ${outPorts.length}]`,
    `      Position [${rx}, ${ry}, ${rx + 110}, ${ry + 64}]`,
    ...paramAttrs,
    `      System {`,
    ...innerLines,
    `      }`,
    `    }`,
  ].join("\n");

  return [TextEdit.insert({ line: insertLine, character: 0 }, `${subBlock}\n`)];
}

export interface SpiceDropOptions {
  docText: string;
  rawClassName: string;
  instanceName?: string | undefined;
  unifiedIndex?: SymbolIndex | null | undefined;
  batchState?: DropBatchState | undefined;
}

const SPICE_NATIVE_CATEGORY_MAP: Record<string, { prefix: string; defaultVal: string; pins: number }> = {
  R: { prefix: "R", defaultVal: "1k", pins: 2 },
  RESISTOR: { prefix: "R", defaultVal: "1k", pins: 2 },
  C: { prefix: "C", defaultVal: "1u", pins: 2 },
  CAPACITOR: { prefix: "C", defaultVal: "1u", pins: 2 },
  L: { prefix: "L", defaultVal: "1m", pins: 2 },
  INDUCTOR: { prefix: "L", defaultVal: "1m", pins: 2 },
  V: { prefix: "V", defaultVal: "DC 5", pins: 2 },
  VOLTAGESOURCE: { prefix: "V", defaultVal: "DC 5", pins: 2 },
  I: { prefix: "I", defaultVal: "DC 1m", pins: 2 },
  CURRENTSOURCE: { prefix: "I", defaultVal: "DC 1m", pins: 2 },
};

function findSpiceInsertPoint(
  docText: string,
  directives?: ReadonlyArray<{ kind: string; span?: { startLine: number } | undefined }>,
): { line: number; character: number; prefixNewline: string } {
  if (directives) {
    for (let i = directives.length - 1; i >= 0; i--) {
      const d = directives[i]!;
      if (d.kind === ".END" && d.span && d.span.startLine > 0) {
        return { line: d.span.startLine - 1, character: 0, prefixNewline: "" };
      }
    }
  }
  const lines = docText.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.trim().toUpperCase() === ".END") {
      return { line: i, character: 0, prefixNewline: "" };
    }
  }
  const lastLine = Math.max(0, lines.length - 1);
  const lastCol = lines[lastLine]?.length ?? 0;
  const prefixNewline = docText.length > 0 && !docText.endsWith("\n") ? "\n" : "";
  return { line: lastLine, character: lastCol, prefixNewline };
}

/**
 * Generates SPICE `.SUBCKT` stub + `X<inst>` call (or native passive/source line)
 * inserted cleanly prior to `.END`, ensuring pin counts and passives pass SPICE linting.
 */
export function computeSpiceComponentDropEdits(opts: SpiceDropOptions): TextEdit[] {
  const { docText, rawClassName, instanceName, unifiedIndex, batchState } = opts;
  const info = resolveForeignDropInfo(unifiedIndex, rawClassName);
  const spiceCircuit = parseSpice(docText);
  const pt = findSpiceInsertPoint(docText, spiceCircuit.directives);

  const upperShort = info.shortName.toUpperCase();
  const nativeSpec = SPICE_NATIVE_CATEGORY_MAP[upperShort];
  const isForeign =
    info.sourceLanguage !== "spice" &&
    (info.symbol !== null ||
      info.explicitLanguage !== null ||
      (info.sourceLanguage !== "unknown" && !nativeSpec) ||
      (!nativeSpec && info.cleanName.includes(".")));

  if (!isForeign && nativeSpec) {
    let devName: string;
    if (instanceName) {
      const sanitized = sanitizeIdentifier(instanceName, "1");
      const suffix = sanitized.length > 0 && isAsciiLetter(sanitized[0]!) ? sanitized.slice(1) : sanitized;
      devName = `${nativeSpec.prefix}${suffix}`;
    } else {
      devName = allocateUniqueIdentifier(docText, `${nativeSpec.prefix}`, batchState);
    }
    const nodes = Array.from({ length: nativeSpec.pins }, () => "0").join(" ");
    return [
      TextEdit.insert(
        { line: pt.line, character: pt.character },
        `${pt.prefixNewline}${devName} ${nodes} ${nativeSpec.defaultVal}\n`,
      ),
    ];
  }

  // Reuse parsed .SUBCKT definitions from @modelscript/spice parser
  const existingSubckts = new Map<string, { name: string; portCount: number }>();
  for (const sub of spiceCircuit.subcircuits.values()) {
    existingSubckts.set(sub.name.toUpperCase(), { name: sub.name, portCount: sub.ports.length });
  }

  const candidateSubName = sanitizeIdentifier(info.shortName, "STUB").toUpperCase();
  const existingMatch = existingSubckts.get(candidateSubName);
  const subName = existingMatch?.name ?? candidateSubName;
  const subKey = `spice:${subName.toUpperCase()}`;

  const rawPorts = info.ports.map((p) => sanitizeIdentifier(p.name, "pin").toUpperCase());
  const effectivePorts = rawPorts.length > 0 ? rawPorts : ["IN", "OUT"];
  const pinCount = existingMatch ? existingMatch.portCount : effectivePorts.length;

  const numericParams = info.params
    .map((p) => {
      const n = Number(p.defaultValue);
      return Number.isFinite(n) ? { name: sanitizeIdentifier(p.name, "P").toUpperCase(), val: String(n) } : null;
    })
    .filter((p): p is { name: string; val: string } => p !== null);

  const paramSuffix =
    numericParams.length > 0 ? ` PARAMS: ${numericParams.map((p) => `${p.name}=${p.val}`).join(" ")}` : "";

  const chunks: string[] = [];
  if (!existingMatch && !batchState?.emittedDefs.has(subKey)) {
    batchState?.emittedDefs.add(subKey);
    const bodyLines = effectivePorts.map((pin, idx) => `R_stub${idx + 1} ${pin} 0 1k`);
    chunks.push(
      `* @twin ${info.cleanName} (${info.sourceLanguage})`,
      `.SUBCKT ${subName} ${effectivePorts.join(" ")}${paramSuffix}`,
      ...bodyLines,
      `.ENDS ${subName}`,
    );
  }

  const rawXName = instanceName
    ? instanceName.toUpperCase().startsWith("X")
      ? sanitizeIdentifier(instanceName, "X1")
      : `X_${sanitizeIdentifier(instanceName, "cmp")}`
    : allocateUniqueIdentifier(docText, `X_${info.shortName.toLowerCase()}`, batchState);

  const instNodes = Array.from({ length: pinCount }, () => "0").join(" ");
  const nodePart = instNodes ? ` ${instNodes}` : "";
  chunks.push(`${rawXName}${nodePart} ${subName}${paramSuffix}`);

  return [TextEdit.insert({ line: pt.line, character: pt.character }, `${pt.prefixNewline}${chunks.join("\n")}\n`)];
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
