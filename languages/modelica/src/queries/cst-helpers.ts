// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Modelica Salsa Query CST, Text, Enumeration, Prefix, and Import Helpers.
 */

import {
  splitQualifiedPath,
  UnifiedWorkspace,
  WorkspaceTypeRegistry,
  type QueryDB,
  type SymbolEntry,
  type SymbolId,
} from "@modelscript/runtime";
import { Cst, type SyntaxNode } from "../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../errors.js";
import type { CstNodeLike } from "../flattener/expressions/cst-utils.js";
import { collapseSpaceTokens } from "../workspace-hooks.js";
import {
  asSyntaxNode,
  getSymbolMeta,
  type ArrayDimensionDescriptor,
  type CachedSymbolEntry,
  type EnumValidationResult,
  type QueryCstNode,
} from "./types.js";

export function isIdentStartCode(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
}

export function isIdentCharCode(code: number): boolean {
  return isIdentStartCode(code) || (code >= 48 && code <= 57);
}

export function isAsciiIdentStr(text: string): boolean {
  if (text.length === 0 || !isIdentStartCode(text.charCodeAt(0))) return false;
  for (let i = 1; i < text.length; i++) {
    if (!isIdentCharCode(text.charCodeAt(i))) return false;
  }
  return true;
}

export function stripOuterChar(text: string, ch: string): string {
  let out = text;
  if (out.startsWith(ch)) out = out.slice(ch.length);
  if (out.endsWith(ch)) out = out.slice(0, out.length - ch.length);
  return out;
}

export function stripTrailingBrackets(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.endsWith("]")) return trimmed;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!;
    if (inSingle) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === '"') inDouble = false;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === "[") {
      return trimmed.slice(0, i).trim();
    }
  }
  return trimmed;
}

export function stripModelicaComments(raw: string): string {
  if (!raw.includes("//") && !raw.includes("/*")) return raw;
  let out = "";
  let i = 0;
  let inString = false;
  while (i < raw.length) {
    const ch = raw[i]!;
    if (inString) {
      out += ch;
      if (ch === "\\" && i + 1 < raw.length) {
        out += raw[i + 1]!;
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === "/" && raw[i + 1] === "/") {
      out += " ";
      i += 2;
      while (i < raw.length && raw[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && raw[i + 1] === "*") {
      out += " ";
      i += 2;
      while (i + 1 < raw.length && !(raw[i] === "*" && raw[i + 1] === "/")) i++;
      i = Math.min(raw.length, i + 2);
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

export function containsWord(text: string, word: string): boolean {
  if (!text || !word) return false;
  let pos = 0;
  while (pos <= text.length - word.length) {
    const idx = text.indexOf(word, pos);
    if (idx < 0) return false;
    const prevOk = idx === 0 || !isIdentCharCode(text.charCodeAt(idx - 1));
    const end = idx + word.length;
    const nextOk = end >= text.length || !isIdentCharCode(text.charCodeAt(end));
    if (prevOk && nextOk) return true;
    pos = idx + 1;
  }
  return false;
}

export function hasLeadingEncapsulatedPrefix(text: string): boolean {
  const skipPrefixes = new Set(["final", "inner", "outer", "redeclare", "replaceable"]);
  let i = 0;
  const n = text.length;
  while (i < n) {
    while (i < n && (text[i] === " " || text[i] === "\t" || text[i] === "\n" || text[i] === "\r")) i++;
    if (i >= n) return false;
    const start = i;
    while (i < n && isIdentCharCode(text.charCodeAt(i))) i++;
    const word = text.slice(start, i);
    if (!word) return false;
    if (word === "encapsulated") return true;
    if (word === "within") {
      const semi = text.indexOf(";", i);
      if (semi < 0) return false;
      i = semi + 1;
      continue;
    }
    if (skipPrefixes.has(word)) continue;
    return false;
  }
  return false;
}

export function findEnumerationSliceRange(cstText: string): { start: number; end: number; isColon: boolean } | null {
  let pos = 0;
  while (pos < cstText.length) {
    const idx = cstText.indexOf("enumeration", pos);
    if (idx < 0) return null;
    const prevOk = idx === 0 || !isIdentCharCode(cstText.charCodeAt(idx - 1));
    let j = idx + "enumeration".length;
    const afterOk = j < cstText.length && !isIdentCharCode(cstText.charCodeAt(j));
    if (prevOk && afterOk) {
      while (
        j < cstText.length &&
        (cstText[j] === " " || cstText[j] === "\t" || cstText[j] === "\n" || cstText[j] === "\r")
      ) {
        j++;
      }
      if (cstText[j] === "(") {
        let depth = 0;
        let inSingle = false;
        let inDouble = false;
        let k = j;
        while (k < cstText.length) {
          const ch = cstText[k]!;
          if (inSingle) {
            if (ch === "\\") {
              k += 2;
              continue;
            }
            if (ch === "'") inSingle = false;
            k++;
            continue;
          }
          if (inDouble) {
            if (ch === "\\") {
              k += 2;
              continue;
            }
            if (ch === '"') inDouble = false;
            k++;
            continue;
          }
          if (ch === "'") {
            inSingle = true;
            k++;
            continue;
          }
          if (ch === '"') {
            inDouble = true;
            k++;
            continue;
          }
          if (ch === "(") depth++;
          else if (ch === ")") {
            depth--;
            if (depth === 0) {
              const inner = cstText.slice(j + 1, k).trim();
              return { start: idx, end: k + 1, isColon: inner === ":" || inner.length === 0 };
            }
          }
          k++;
        }
      }
    }
    pos = idx + 1;
  }
  return null;
}

export function hasEnumTypeText(text: string): boolean {
  return findEnumerationSliceRange(text) !== null;
}

export function parseEnumLiteralsFromText(
  cstText: string,
  baseOffset = 0,
  stripSingleQuotes = true,
): { name: string; startOffset: number; endOffset: number }[] {
  const sliceRange = findEnumerationSliceRange(cstText);
  if (!sliceRange || sliceRange.isColon) return [];
  const parser = UnifiedWorkspace.getGlobalParser(".mo") as
    { parse?: (src: string) => { rootNode?: CstNodeLike } | null | undefined } | undefined;
  if (!parser || typeof parser.parse !== "function") return [];
  const prefix = "type _E = ";
  const enumSlice = cstText.slice(sliceRange.start, sliceRange.end);
  const tree = parser.parse(`${prefix}${enumSlice};`);
  if (!tree?.rootNode) return [];

  const result: { name: string; startOffset: number; endOffset: number }[] = [];
  const stack: CstNodeLike[] = [tree.rootNode];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur.type === "enumeration_literal" || cur.type === "EnumerationLiteral") {
      const idNode = cur.children?.find((ch) => ch.type === "identifier" || ch.type === "Identifier") ?? cur;
      const rawName = idNode?.text?.trim() ?? "";
      const name = stripSingleQuotes ? stripOuterChar(rawName, "'") : rawName;
      if (name) {
        const sRel = (idNode?.startIndex ?? idNode?.startOffset ?? prefix.length) - prefix.length;
        const eRel = (idNode?.endIndex ?? idNode?.endOffset ?? sRel + rawName.length) - prefix.length;
        result.push({
          name,
          startOffset: baseOffset + sliceRange.start + Math.max(0, sRel),
          endOffset: baseOffset + sliceRange.start + Math.max(0, eRel),
        });
      }
      continue;
    }
    const children = cur.children || [];
    for (let i = children.length - 1; i >= 0; i--) {
      if (children[i]) stack.push(children[i]!);
    }
  }
  return result;
}

export function hasNodePrefixKeyword(node: CstNodeLike | null | undefined, kw: string, stopAtParen = false): boolean {
  if (!node) return false;
  const quoted = `"${kw}"`;
  if (node.children && node.children.length > 0) {
    for (const ch of node.children) {
      if (ch.type === kw || ch.type === quoted || ch.text?.trim() === kw) return true;
      if (ch.type === "class_prefixes" || ch.type === "prefixes") {
        if (hasNodePrefixKeyword(ch, kw, stopAtParen)) return true;
      }
      if (
        ch.type === "component_clause" ||
        ch.type === "class_definition" ||
        ch.type === "class_modification" ||
        (stopAtParen && (ch.type === "(" || ch.type === '"("' || ch.text?.trim() === "("))
      ) {
        break;
      }
    }
    return false;
  }
  const raw = node.text ?? "";
  const target = stopAtParen ? (raw.split("(")[0] ?? "") : raw;
  return containsWord(target, kw);
}

export function findAnnotationClearanceMin(cst: CstNodeLike | null | undefined): number | null {
  if (!cst) return null;
  const stack: CstNodeLike[] = [cst];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur.type === "annotation" || cur.type === "Annotation") {
      const modStack: CstNodeLike[] = [cur];
      while (modStack.length > 0) {
        const mc = modStack.pop()!;
        if (mc.type === "element_modification" || mc.type === "ElementModification") {
          const nameNode = mc.childForFieldName?.("name") ?? mc.children?.find((c) => c.type === "name");
          const modName = nameNode?.text?.trim().toLowerCase() ?? "";
          if (modName === "clearance" || modName === "__modelscript_clearance") {
            const innerMod =
              mc.childForFieldName?.("modification") ?? mc.children?.find((c) => c.type === "modification");
            if (innerMod) {
              const subStack: CstNodeLike[] = [innerMod];
              while (subStack.length > 0) {
                const sc = subStack.pop()!;
                if (sc.type === "element_modification") {
                  const subName = sc.childForFieldName?.("name")?.text?.trim().toLowerCase();
                  if (subName === "min") {
                    const subMod = sc.children?.find((c) => c.type === "modification");
                    const num = parseFloat((subMod?.text ?? "").replaceAll("=", "").trim());
                    if (!isNaN(num) && num > 0) return num;
                  }
                } else if (
                  sc.type === "unsigned_number" ||
                  sc.type === "unsigned_real" ||
                  sc.type === "unsigned_integer"
                ) {
                  const num = parseFloat(sc.text?.trim() ?? "");
                  if (!isNaN(num) && num > 0) return num;
                }
                const scChildren = sc.children || [];
                for (let i = scChildren.length - 1; i >= 0; i--) {
                  if (scChildren[i]) subStack.push(scChildren[i]!);
                }
              }
            }
          }
        }
        const mcChildren = mc.children || [];
        for (let i = mcChildren.length - 1; i >= 0; i--) {
          if (mcChildren[i]) modStack.push(mcChildren[i]!);
        }
      }
      continue;
    }
    const children = cur.children || [];
    for (let i = children.length - 1; i >= 0; i--) {
      if (children[i]) stack.push(children[i]!);
    }
  }
  return null;
}

export function isClassExtendsInCst(cst: CstNodeLike | null | undefined): boolean {
  if (!cst) return false;
  const specContainer =
    (Cst.ClassDefinition.classSpecifier(cst as SyntaxNode) as CstNodeLike | null) ??
    cst.children?.find((c) => c.type === "class_specifier" || c.type === "ClassSpecifier") ??
    cst;
  const longSpec =
    specContainer?.type === "long_class_specifier" || specContainer?.type === "LongClassSpecifier"
      ? specContainer
      : specContainer?.children?.find((c) => c.type === "long_class_specifier" || c.type === "LongClassSpecifier");
  if (longSpec?.children && longSpec.children.length > 0) {
    const first = longSpec.children[0];
    return first?.type === "extends" || first?.type === '"extends"' || first?.text?.trim() === "extends";
  }
  const head = (cst.text ?? "").slice(0, 80);
  const idx = head.indexOf("extends");
  if (idx < 0) return false;
  const after = head.slice(idx + "extends".length).trimStart();
  return after.length > 0 && (isIdentCharCode(after.charCodeAt(0)) || after[0] === "'");
}

export function isOperatorRecordSymbol(db: QueryDB, self: SymbolEntry): boolean {
  const meta = getSymbolMeta(self) ?? {};
  const rawKind = String(meta["classPrefixes"] ?? meta["classKind"] ?? "");
  const metaWords = collapseSpaceTokens(stripModelicaComments(rawKind));
  if (metaWords.includes("operator") && metaWords.includes("record")) return true;
  const cst = db.cstNode(self.id) as CstNodeLike | null;
  if (cst) {
    const pfx = Cst.ClassDefinition.classPrefixes(cst as SyntaxNode);
    const pfxWords = collapseSpaceTokens(stripModelicaComments(pfx?.text ?? ""));
    if (pfxWords.includes("operator") && pfxWords.includes("record")) return true;
    const headerWords = collapseSpaceTokens(stripModelicaComments((cst.text ?? "").slice(0, 120)));
    let idx = 0;
    while (idx < headerWords.length && (headerWords[idx] === "encapsulated" || headerWords[idx] === "partial")) {
      idx++;
    }
    if (headerWords[idx] === "operator" && headerWords[idx + 1] === "record") return true;
  }
  return false;
}

export function extractDeclBindingExprText(declOrCompNode: CstNodeLike | null | undefined): string | null {
  if (!declOrCompNode) return null;
  const stack: CstNodeLike[] = [declOrCompNode];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur.type === "modification_expression" || cur.type === "ModificationExpression") {
      const exprChild = cur.children?.find((c) => c.type === "expression" || c.type === "Expression");
      const target = exprChild ?? cur.children?.find((c) => c.text?.trim() !== "=");
      const text = target?.text?.trim();
      if (text) return text;
      const raw = cur.text?.trim() ?? "";
      return raw.startsWith("=") ? raw.slice(1).trim() : raw;
    }
    if (cur.type === "description" || cur.type === "annotation" || cur.type === "class_modification") {
      continue;
    }
    const children = cur.children || [];
    for (let i = children.length - 1; i >= 0; i--) {
      if (children[i]) stack.push(children[i]!);
    }
  }
  return null;
}

export function parseConnectRefCst(refText: string): CstNodeLike | null {
  const parser = UnifiedWorkspace.getGlobalParser(".mo") as
    { parse?: (src: string) => { rootNode?: CstNodeLike } | null | undefined } | undefined;
  if (!parser || typeof parser.parse !== "function") return null;
  const tree = parser.parse(`model _ConnectRefCheck equation connect(${refText}, _b); end _ConnectRefCheck;`);
  if (!tree?.rootNode) return null;
  const stack: CstNodeLike[] = [tree.rootNode];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur.type === "connect_equation" || cur.type === "ConnectEquation") {
      return cur.childForFieldName?.("lhs") ?? cur.children?.find((c) => c.type === "component_reference") ?? cur;
    }
    const children = cur.children || [];
    for (let i = children.length - 1; i >= 0; i--) {
      if (children[i]) stack.push(children[i]!);
    }
  }
  return null;
}

let _sharedTypeRegistry: WorkspaceTypeRegistry | undefined;
export function getSharedTypeRegistry(): WorkspaceTypeRegistry {
  if (!_sharedTypeRegistry) _sharedTypeRegistry = new WorkspaceTypeRegistry();
  return _sharedTypeRegistry;
}

/**
 * Computes a fast 53-bit non-cryptographic hash (`cyrb53`) for string memoization keys.
 *
 * @param str - Input string to hash.
 * @param seed - Optional 32-bit integer hash seed.
 * @returns Decimal string representation of the 53-bit hash value.
 */
export function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed,
    h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString();
}

/**
 * Computes and caches the dot-separated fully qualified name (FQN) of a symbol by walking its parent chain.
 *
 * @param db - Active Salsa query database.
 * @param symId - Target symbol ID.
 * @returns Fully qualified Modelica path (e.g., `"Modelica.Electrical.Analog.Basic.Resistor"`).
 */
export function getSymbolQualifiedName(db: QueryDB, symId: SymbolId): string {
  const sym = db.symbol(symId) as CachedSymbolEntry | undefined;
  if (!sym) return "";
  if (sym._fqn !== undefined) return sym._fqn;
  const parts: string[] = [];
  const seen = new Set<SymbolId>();
  let curr: SymbolEntry | null | undefined = sym;
  while (curr && !seen.has(curr.id)) {
    seen.add(curr.id);
    if (curr.kind !== "Extends") {
      parts.unshift(curr.name);
    }
    curr = curr.parentId !== null ? db.symbol(curr.parentId) : null;
  }
  const fqn = parts.join(".");
  sym._fqn = fqn;
  return fqn;
}

/**
 * Split a string on top-level commas (ignoring commas inside parentheses).
 * Used for parsing class modification argument lists.
 */
export function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") depth--;
    else if (text[i] === "," && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = text.slice(start).trim();
  if (last) parts.push(last);
  return parts;
}

/**
 * Extracts structured array subscript descriptors from an `array_subscripts` CST node.
 */
export function extractSubscriptsFromCst(
  arraySubNode: QueryCstNode | null | undefined,
  mode: "unsignedIntegerOnly" | "parseIntLiteral" = "parseIntLiteral",
): ArrayDimensionDescriptor[] {
  if (!arraySubNode) return [];
  const subs: ArrayDimensionDescriptor[] = [];
  for (const child of arraySubNode.children ?? []) {
    if (child.type !== "Subscript" && child.type !== "subscript") continue;
    const childSyntax = asSyntaxNode(child);
    const flexChild =
      (childSyntax ? Cst.Subscript.flexible(childSyntax) : null) ??
      child.children?.find((c) => c.text === ":" || c.type === ":" || c.type === '":"');
    if (flexChild && flexChild.text?.trim() === ":") {
      subs.push({ kind: "flexible" });
      continue;
    }
    const exprChild =
      (childSyntax ? Cst.Subscript.expression(childSyntax) : null) ??
      child.children?.find((c) => c.type === "expression" || c.type === "Expression") ??
      ((child.childCount ?? 0) > 0 ? child.child?.(0) : null);
    if (exprChild) {
      const exprText = exprChild.text ?? "";
      if (mode === "unsignedIntegerOnly") {
        if (exprChild.type === "UNSIGNED_INTEGER" || exprChild.type === "unsigned_integer") {
          subs.push({ kind: "literal", value: parseInt(exprText, 10) });
        } else {
          subs.push({
            kind: "expression",
            cstBytes: [
              exprChild.startOffset ?? exprChild.startIndex ?? 0,
              exprChild.endOffset ?? exprChild.endIndex ?? 0,
            ],
            text: exprText,
          });
        }
      } else {
        const num = parseInt(exprText, 10);
        if (!isNaN(num) && String(num) === exprText.trim()) {
          subs.push({ kind: "literal", value: num });
        } else {
          subs.push({
            kind: "expression",
            cstBytes: [
              exprChild.startOffset ?? exprChild.startIndex ?? 0,
              exprChild.endOffset ?? exprChild.endIndex ?? 0,
            ],
            text: exprText,
          });
        }
      }
      continue;
    }
  }
  return subs;
}

/**
 * Extracts the `ShortClassSpecifier` CST node from a class definition or specifier wrapper node, if present.
 *
 * @param cst - CST node for a `class_definition`, `class_specifier`, or `short_class_specifier`.
 * @returns The inner `short_class_specifier` CST node, or `null` if the class is not a short class definition.
 */
export function getShortClassSpecifierNode<T extends QueryCstNode = SyntaxNode>(
  cst: T | null | undefined,
): (unknown extends T ? T : SyntaxNode) | null {
  if (!cst) return null;
  if (cst.type === "short_class_specifier" || cst.type === "ShortClassSpecifier") {
    return asSyntaxNode(cst) as (unknown extends T ? T : SyntaxNode) | null;
  }
  if (
    cst.type === "long_class_specifier" ||
    cst.type === "LongClassSpecifier" ||
    cst.type === "composition" ||
    cst.type === "Composition"
  ) {
    return null;
  }
  const spec = Cst.ClassDefinition.classSpecifier(asSyntaxNode(cst));
  if (spec) {
    if (spec.type === "short_class_specifier" || spec.type === "ShortClassSpecifier") {
      return spec as (unknown extends T ? T : SyntaxNode) | null;
    }
    if (spec.type === "class_specifier" || spec.type === "ClassSpecifier") {
      const shortChild = spec.children?.find(
        (c: SyntaxNode) => c.type === "short_class_specifier" || c.type === "ShortClassSpecifier",
      );
      if (shortChild) return shortChild as (unknown extends T ? T : SyntaxNode) | null;
    }
    return null;
  }
  for (const child of cst.children || []) {
    if (
      child.type === "long_class_specifier" ||
      child.type === "LongClassSpecifier" ||
      child.type === "composition" ||
      child.type === "Composition"
    ) {
      return null;
    }
    if (
      child.type === "short_class_specifier" ||
      child.type === "ShortClassSpecifier" ||
      child.type === "short_class_definition" ||
      child.type === "ShortClassDefinition" ||
      child.type === "class_definition" ||
      child.type === "ClassDefinition" ||
      child.type === "class_specifier" ||
      child.type === "ClassSpecifier" ||
      child.type === "element_replaceable" ||
      child.type === "ElementReplaceable" ||
      child.type === "element_redeclaration" ||
      child.type === "ElementRedeclaration"
    ) {
      const found = getShortClassSpecifierNode(child);
      if (found) return found as (unknown extends T ? T : SyntaxNode) | null;
    }
  }
  return null;
}

/**
 * Validates a Modelica `type E = enumeration(...)` declaration for reserved built-in attribute names
 * (`M4084` / `M2001`) and duplicate enumeration literal identifiers (`M4083`).
 *
 * @param cstNode - CST node of the enumeration class definition.
 * @param sym - Optional symbol entry for fallback metadata and character range lookup.
 * @returns First detected `EnumValidationResult` error, or `null` if valid.
 */
export function validateEnumeration(
  cstNode: QueryCstNode | null | undefined,
  sym?: SymbolEntry | null,
): EnumValidationResult | null {
  if (!cstNode && !sym) return null;
  const shortSpec = getShortClassSpecifierNode(cstNode);
  const cstText = cstNode?.text ?? "";
  const symMeta = getSymbolMeta(sym);
  const isEnum =
    shortSpec?.children?.some((c: SyntaxNode) => c.text?.trim() === "enumeration" || c.type === '"enumeration"') ||
    Boolean(shortSpec && cstText.includes("enumeration(")) ||
    symMeta?.["classPrefixes"] === "enumeration";
  if (!isEnum) return null;

  const literals: string[] = [];
  const literalRanges: { name: string; startOffset: number; endOffset: number }[] = [];
  const enumListNode = shortSpec
    ? (shortSpec.children?.find((c: SyntaxNode) => c.type === "enum_list" || c.type === "EnumList") ??
      (Cst?.ShortClassSpecifier ? Cst.ShortClassSpecifier.enumList(shortSpec) : null))
    : null;

  const baseNodeStart = sym?.startOffset ?? cstNode?.startIndex ?? cstNode?.startOffset ?? 0;

  if (enumListNode && enumListNode.children) {
    for (const c of enumListNode.children) {
      if (c.type === "enumeration_literal" || (Cst?.EnumerationLiteral && Cst.EnumerationLiteral.is(c))) {
        const idNode = c.children?.find((ch: SyntaxNode) => ch.type === "identifier" || ch.type === "Identifier") ?? c;
        const litName = idNode?.text?.trim() ?? (c.text ? collapseSpaceTokens(c.text)[0] : undefined);
        if (litName) {
          literals.push(litName);
          const s = idNode?.startIndex ?? idNode?.startOffset;
          const e = idNode?.endIndex ?? idNode?.endOffset;
          if (typeof s === "number" && typeof e === "number") {
            literalRanges.push({ name: litName, startOffset: s, endOffset: e });
          }
        }
      }
    }
  } else {
    for (const lit of parseEnumLiteralsFromText(cstText, baseNodeStart, false)) {
      literals.push(lit.name);
      literalRanges.push(lit);
    }
  }

  if (literals.length === 0) return null;

  const reservedAttributes = new Set([
    "quantity",
    "unit",
    "displayUnit",
    "min",
    "max",
    "start",
    "fixed",
    "nominal",
    "stateSelect",
    "uncertain",
    "distribution",
  ]);

  let startOffset = sym?.startOffset ?? cstNode?.startIndex ?? cstNode?.startOffset ?? 0;
  const endOffset = sym?.endOffset ?? cstNode?.endIndex ?? cstNode?.endOffset ?? 0;
  if (typeof startOffset === "number" && cstText) {
    const leadingWs = cstText.length - cstText.trimStart().length;
    startOffset += leadingWs;
  }

  const getLitRange = (litName: string, occurrenceIndex = 0) => {
    let seenCount = 0;
    for (const lr of literalRanges) {
      if (lr.name === litName) {
        if (seenCount === occurrenceIndex) {
          return {
            startOffset: lr.startOffset,
            endOffset: lr.endOffset,
          };
        }
        seenCount++;
      }
    }
    if (cstText && litName) {
      const idx = cstText.indexOf(litName);
      if (idx >= 0) {
        const s = baseNodeStart + idx;
        return { startOffset: s, endOffset: s + litName.length };
      }
    }
    return { startOffset, endOffset };
  };

  const cstTreeRootText = cstNode && "tree" in cstNode ? cstNode.tree?.rootNode?.text : undefined;
  const isNewInst = Boolean(cstTreeRootText?.includes("-d=-newInst")) || Boolean(cstText.includes("-d=-newInst"));

  // 1. Reserved attribute names
  for (const lit of literals) {
    if (reservedAttributes.has(lit)) {
      const code = isNewInst
        ? ModelicaErrorCode.ENUM_RESERVED_ATTRIBUTE_LITERAL.code
        : ModelicaErrorCode.DUPLICATE_ELEMENT.code;
      const message = isNewInst
        ? ModelicaErrorCode.ENUM_RESERVED_ATTRIBUTE_LITERAL.message(lit)
        : ModelicaErrorCode.DUPLICATE_ELEMENT.message(lit);
      const range = getLitRange(lit, 0);
      return {
        code,
        message,
        ...range,
      };
    }
  }

  // 2. Duplicate literal names
  const seenCounts = new Map<string, number>();
  for (const lit of literals) {
    const prevCount = seenCounts.get(lit) ?? 0;
    if (prevCount > 0) {
      const listStr = literals.join(",");
      const range = getLitRange(lit, prevCount);
      return {
        code: ModelicaErrorCode.ENUM_DUPLICATE_LITERAL.code,
        message: ModelicaErrorCode.ENUM_DUPLICATE_LITERAL.message(lit, listStr),
        ...range,
      };
    }
    seenCounts.set(lit, prevCount + 1);
  }

  return null;
}

/**
 * Checks whether a class or component declaration is prefixed with `redeclare` in its enclosing `element` CST node.
 *
 * @param db - Active Salsa query database.
 * @param self - Symbol entry to inspect.
 * @returns `true` if declared with a `redeclare` prefix.
 */
export function isRedeclareQuery(db: QueryDB, self: SymbolEntry): boolean {
  if (getSymbolMeta(self)?.["redeclare"]) return true;
  let current = db.cstNode(self.id) as SyntaxNode | null;
  if (current && (current.type === "class_definition" || current.type === "ClassDefinition")) {
    current = current.parent;
  }
  while (current) {
    if (current.type === "element_redeclaration" || current.type === "ElementRedeclaration") {
      return true;
    }
    if (
      current.type === "ComponentClause" ||
      current.type === "component_clause" ||
      current.type === "element" ||
      current.type === "Element"
    ) {
      if (
        current.children?.some(
          (c: SyntaxNode) => c.text?.trim() === "redeclare" || c.type === "redeclare" || c.type === '"redeclare"',
        )
      ) {
        return true;
      }
    }
    if (
      current.type === "composition" ||
      current.type === "Composition" ||
      (current !== db.cstNode(self.id) && (current.type === "class_definition" || current.type === "ClassDefinition"))
    ) {
      break;
    }
    current = current.parent;
  }
  return false;
}

function stripDoubleQuotedStringsAndModTail(raw: string): string {
  let out = "";
  let inQuote = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (inQuote) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === '"') inQuote = false;
      continue;
    }
    if (ch === '"') {
      inQuote = true;
      continue;
    }
    if (ch === "=" || ch === "(" || ch === ";") break;
    out += ch;
  }
  return out;
}

function hasDynamicScopingPrefix(db: QueryDB, self: SymbolEntry, kw: "inner" | "outer"): boolean {
  if (!self) return false;
  const meta = getSymbolMeta(self);
  const rawPrefixes = meta?.["classPrefixes"] ?? meta?.["prefixes"];
  if (typeof rawPrefixes === "string" && containsWord(rawPrefixes, kw)) {
    return true;
  }
  let current = db.cstNode(self.id) as SyntaxNode | null;
  if (current && (current.type === "class_definition" || current.type === "ClassDefinition")) {
    current = current.parent;
  }
  const quotedKw = `"${kw}"`;
  while (current) {
    if (
      current.type === "Element" ||
      current.type === "element" ||
      current.type === "element_replaceable" ||
      current.type === "ElementReplaceable"
    ) {
      if (current.children && current.children.length > 0) {
        for (const ch of current.children) {
          if (ch.type === kw || ch.type === quotedKw || ch.text?.trim() === kw) return true;
          if (ch.type === "component_clause" || ch.type === "class_definition") break;
        }
        return false;
      }
      return containsWord(stripDoubleQuotedStringsAndModTail(current.text ?? ""), kw);
    }
    if (current.type === "class_prefixes" || current.type === "prefixes") {
      if (current.children && current.children.length > 0) {
        for (const ch of current.children) {
          if (ch.type === kw || ch.type === quotedKw || ch.text?.trim() === kw) return true;
        }
        return false;
      }
      return containsWord(stripDoubleQuotedStringsAndModTail(current.text ?? ""), kw);
    }
    if (current.children) {
      for (const ch of current.children) {
        if (ch.type === kw || ch.type === quotedKw || ch.text?.trim() === kw) return true;
      }
    }
    if (
      current.type === "Composition" ||
      current.type === "composition" ||
      current.type === "stored_definition" ||
      current.type === "StoredDefinition"
    ) {
      break;
    }
    current = current.parent;
  }
  return false;
}

/**
 * Resolves whether a symbol is declared with the `inner` scoping prefix.
 */
export function isInnerQuery(db: QueryDB, self: SymbolEntry): boolean {
  return hasDynamicScopingPrefix(db, self, "inner");
}

/**
 * Resolves whether a symbol is declared with the `outer` scoping prefix.
 */
export function isOuterQuery(db: QueryDB, self: SymbolEntry): boolean {
  return hasDynamicScopingPrefix(db, self, "outer");
}

/**
 * Extracts normalized `(shortName, fullTarget)` pairs from an `Import` child symbol.
 */
export function extractClassImportPairs(
  db: QueryDB,
  child: SymbolEntry,
): { importKind: string; pairs: Array<[string, string]>; startOffset: number; endOffset: number } | null {
  const cmeta = getSymbolMeta(child);
  let importKind =
    (cmeta?.["importKind"] as string | undefined) ??
    (child.ruleName === "UnqualifiedImportClause"
      ? "unqualified"
      : child.ruleName === "CompoundImportClause"
        ? "compound"
        : undefined);
  const pkgName = ((cmeta?.["packageName"] ?? child.name) as string) ?? "";
  let aliasName = cmeta?.["shortName"] as string | undefined;

  const importCst = db.cstNode(child.id) as SyntaxNode | null;
  if (importKind === undefined && importCst) {
    const aliasNode = Cst.ImportClause.alias(importCst);
    const importListNode = Cst.ImportClause.importList(importCst);
    const cstText: string = importCst.text ?? "";
    if (aliasNode) {
      aliasName = aliasNode.text?.trim();
      importKind = "simple";
    } else if (importListNode) {
      importKind = "compound";
    } else if (
      (importCst.children || []).some(
        (c: CstNodeLike) => c.type === "*" || c.type === '"*"' || c.text?.trim() === "*",
      ) ||
      cstText.trimEnd().endsWith("*")
    ) {
      importKind = "unqualified";
    } else {
      importKind = "simple";
    }
  }
  if (!importKind) return null;

  const pairs: Array<[string, string]> = [];
  if (importKind === "compound") {
    let basePkg = pkgName;
    if (basePkg.endsWith("}")) {
      const braceIdx = basePkg.lastIndexOf(".{");
      if (braceIdx >= 0) basePkg = basePkg.slice(0, braceIdx);
    }
    const names = importCst
      ? (Cst.ImportClause.importList(importCst)?.text ?? "")
          .split(",")
          .map((s: string) => s.trim())
          .filter(Boolean)
      : db
          .childrenOfField(child.id, "importName")
          .map((c) => c.name)
          .filter(Boolean);
    for (const n of names) {
      pairs.push([n, `${basePkg}.${n}`]);
    }
  } else if (importKind === "simple") {
    const shortName = aliasName ?? splitQualifiedPath(pkgName).pop() ?? pkgName;
    pairs.push([shortName, pkgName]);
  }

  return {
    importKind,
    pairs,
    startOffset: importCst?.startIndex ?? importCst?.startOffset ?? child.startOffset,
    endOffset: importCst?.endIndex ?? importCst?.endOffset ?? child.endOffset,
  };
}
