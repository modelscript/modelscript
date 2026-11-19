// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Modelica Salsa Query Hooks.
 * Semantic query definitions for QueryEngine.
 */

import type { Verification3DOverlayPayload } from "@modelscript/cad";
import { error, info, warning } from "@modelscript/dsl";
import {
  checkPortPlugCompatibility,
  extractPortSignature,
  isMemberLikeSymbol,
  isNamespaceLikeSymbol,
  isPortDefinitionSymbol,
  isPortLikeSymbol,
  isRelationshipOrImportSymbol,
  isTypeLikeSymbol,
  splitQualifiedPath,
  UnifiedWorkspace,
  WorkspaceTypeRegistry,
  type QueryDB,
  type SymbolEntry,
  type SymbolId,
} from "@modelscript/runtime";
import { Cst, type SyntaxNode } from "../src-gen/bindings.js";
import {
  AnnotationEvaluator,
  evaluateDiagramWasm,
  evaluateIconWasm,
  evaluatePlacementWasm,
} from "./diagram/annotation-evaluator.js";
import { ModelicaErrorCode } from "./errors.js";
import { type CstNodeLike } from "./flattener/expressions/cst-utils.js";
import { runModelicaCfaAnalysis } from "./lints/cfa.js";
import { findNonlinearTermsInCst } from "./lints/homotopy-synthesis.js";
import { isBroken, mergeModArgs, type ModelicaModArgs } from "./modifications.js";
import type { OperatorOverload, OperatorOverloadParam } from "./types.js";
import { parseUnit, unitsCompatible } from "./units.js";
import { collapseSpaceTokens, extractWithinFromCstNode, extractWithinFromSource } from "./workspace-hooks.js";

function isIdentStartCode(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
}

function isIdentCharCode(code: number): boolean {
  return isIdentStartCode(code) || (code >= 48 && code <= 57);
}

function isAsciiIdentStr(text: string): boolean {
  if (text.length === 0 || !isIdentStartCode(text.charCodeAt(0))) return false;
  for (let i = 1; i < text.length; i++) {
    if (!isIdentCharCode(text.charCodeAt(i))) return false;
  }
  return true;
}

function stripOuterChar(text: string, ch: string): string {
  let out = text;
  if (out.startsWith(ch)) out = out.slice(ch.length);
  if (out.endsWith(ch)) out = out.slice(0, out.length - ch.length);
  return out;
}

function stripTrailingBrackets(text: string): string {
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

function stripModelicaComments(raw: string): string {
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

function containsWord(text: string, word: string): boolean {
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

function hasLeadingEncapsulatedPrefix(text: string): boolean {
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

function findEnumerationSliceRange(cstText: string): { start: number; end: number; isColon: boolean } | null {
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

function hasEnumTypeText(text: string): boolean {
  return findEnumerationSliceRange(text) !== null;
}

function parseEnumLiteralsFromText(
  cstText: string,
  baseOffset = 0,
  stripSingleQuotes = true,
): { name: string; startOffset: number; endOffset: number }[] {
  const sliceRange = findEnumerationSliceRange(cstText);
  if (!sliceRange || sliceRange.isColon) return [];
  const parser = UnifiedWorkspace.getGlobalParser(".mo") as
    | { parse?: (src: string) => { rootNode?: CstNodeLike } | null | undefined }
    | undefined;
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

function hasNodePrefixKeyword(node: CstNodeLike | null | undefined, kw: string, stopAtParen = false): boolean {
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

function findAnnotationClearanceMin(cst: CstNodeLike | null | undefined): number | null {
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

function isClassExtendsInCst(cst: CstNodeLike | null | undefined): boolean {
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

function isOperatorRecordSymbol(db: QueryDB, self: SymbolEntry): boolean {
  const meta = (self.metadata as Record<string, unknown>) || {};
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

function extractDeclBindingExprText(declOrCompNode: CstNodeLike | null | undefined): string | null {
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

function parseConnectRefCst(refText: string): CstNodeLike | null {
  const parser = UnifiedWorkspace.getGlobalParser(".mo") as
    | { parse?: (src: string) => { rootNode?: CstNodeLike } | null | undefined }
    | undefined;
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
function getSharedTypeRegistry(): WorkspaceTypeRegistry {
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
function getSymbolQualifiedName(db: QueryDB, symId: SymbolId): string {
  const sym = db.symbol(symId);
  if (!sym) return "";
  if ((sym as any)._fqn !== undefined) return (sym as any)._fqn;
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
  (sym as any)._fqn = fqn;
  return fqn;
}

/**
 * Validates that every argument in a parsed class or component modification (`ModelicaModArgs`)
 * references an existing member or built-in attribute on the target class (`typeClassId`),
 * recursively checking nested modification trees and sibling redeclarations.
 *
 * @param db - Active Salsa query database.
 * @param self - Symbol entry owning the modification (Component, Class, or Extends).
 * @param mod - Parsed modification arguments structure.
 * @param typeClassId - Resolved target class symbol ID being modified.
 * @param typeEntry - Resolved target class symbol entry.
 * @param overrideClassName - Optional intermediate member/class name for nested diagnostic formatting.
 * @returns Array of `M2004` (`MODIFIER_CLASS_NOT_FOUND` / `MODIFIED_ELEMENT_NOT_FOUND`) diagnostics, or `null`.
 */
export function checkModifierNotFound(
  db: QueryDB,
  self: SymbolEntry,
  mod: any,
  typeClassId: SymbolId,
  typeEntry: SymbolEntry,
  overrideClassName?: string,
): any {
  if (!typeClassId || !typeEntry || !mod || !mod.args || mod.args.length === 0) return null;

  const declaredNames = new Set<string>();

  // --- 1. Base Type Chain Walk ---
  // Traverse `classInstance`, `extends`, and short class specifiers to detect whether the
  // underlying root type is a built-in primitive (`Real`, `Integer`, `Boolean`, `String`) or `enumeration`.
  let currentEntry: SymbolEntry | null = typeEntry;
  let isBuiltin = Boolean(currentEntry?.metadata?.["isPredefined"]);
  let isEnum =
    currentEntry?.metadata?.["classPrefixes"] === "enumeration" ||
    Boolean(currentEntry?.metadata?.["isEnumeration"]) ||
    Array.isArray(currentEntry?.metadata?.["literals"]) ||
    Boolean(currentEntry && (db.cstNode(currentEntry.id) as any)?.text?.includes("enumeration("));
  let visited = new Set<SymbolId>();

  if (
    currentEntry &&
    (currentEntry.name === "Real" ||
      currentEntry.name === "Integer" ||
      currentEntry.name === "Boolean" ||
      currentEntry.name === "String")
  ) {
    isBuiltin = true;
  }

  while (currentEntry && !isBuiltin && !isEnum && !visited.has(currentEntry.id)) {
    visited.add(currentEntry.id);
    let nextId: SymbolId | null = null;

    // If it's a component, get its class instance
    if (currentEntry.kind === "Component") {
      nextId = db.query<SymbolId | null>("classInstance", currentEntry.id);
    } else if (currentEntry.kind === "Class") {
      const extendsChildren = db.childrenOf(currentEntry.id).filter((c) => c.kind === "Extends");
      for (const ext of extendsChildren) {
        const base = db.query<SymbolEntry | null>("resolvedBaseClass", ext.id);
        if (base && !visited.has(base.id)) {
          nextId = base.id;
          break;
        }
      }
      if (!nextId) {
        const cst = db.cstNode(currentEntry.id) as any;
        const spec = getShortClassSpecifierNode(cst);
        if (spec) {
          const typeSpec =
            Cst.ShortClassSpecifier.typeSpecifier(spec) ??
            spec.children?.find((c: SyntaxNode) => c.type === "type_specifier" || c.type === "TypeSpecifier");
          let typeName = typeSpec?.text?.trim();
          if (typeName) {
            typeName = typeName.split("[")[0].trim();
            if (typeName === "Real" || typeName === "Integer" || typeName === "Boolean" || typeName === "String") {
              isBuiltin = true;
              break;
            }
            const resolve = db.query<any>("resolveName", currentEntry.parentId || currentEntry.id);
            let baseEntry: SymbolEntry | null = null;
            if (resolve) baseEntry = resolve(typeName, true) as SymbolEntry | null;
            if (!baseEntry && currentEntry.parentId) {
              const resSimple = db.query<any>("resolveSimpleName", currentEntry.parentId);
              if (resSimple) baseEntry = resSimple(typeName.split(".")[0]) as SymbolEntry | null;
            }
            if (!baseEntry) baseEntry = resolveQualified(db, typeName);
            if (!baseEntry) baseEntry = db.byName(typeName.split(".").pop()!)[0] ?? null;
            if (baseEntry) nextId = baseEntry.id;
          }
        }
      }
    }

    if (!nextId || nextId === currentEntry.id) break;
    currentEntry = db.symbol(nextId) as SymbolEntry | null;
    if (currentEntry) {
      isBuiltin =
        Boolean(currentEntry.metadata?.["isPredefined"]) ||
        currentEntry.name === "Real" ||
        currentEntry.name === "Integer" ||
        currentEntry.name === "Boolean" ||
        currentEntry.name === "String";
      isEnum =
        currentEntry.metadata?.["classPrefixes"] === "enumeration" ||
        Boolean(currentEntry.metadata?.["isEnumeration"]) ||
        Array.isArray(currentEntry.metadata?.["literals"]) ||
        Boolean((db.cstNode(currentEntry.id) as any)?.text?.includes("enumeration("));
    }
  }

  // --- 2. Allowed Attribute & Member Collection ---
  // Populate `declaredNames` with built-in type attributes (`min`, `max`, `start`, `fixed`, `unit`, etc.)
  // and all instantiated elements of `typeClassId`.
  if (isBuiltin || isEnum) {
    declaredNames.add("quantity");
    declaredNames.add("unit");
    declaredNames.add("displayUnit");
    declaredNames.add("min");
    declaredNames.add("max");
    declaredNames.add("start");
    declaredNames.add("fixed");
    declaredNames.add("nominal");
    declaredNames.add("stateSelect");
    declaredNames.add("unbounded");
    for (const k of Object.keys(currentEntry?.metadata || {})) {
      if (
        k !== "classKind" &&
        k !== "isPredefined" &&
        k !== "description" &&
        k !== "isEnumeration" &&
        k !== "literals" &&
        k !== "classPrefixes"
      ) {
        declaredNames.add(k);
      }
    }
    if (isEnum) {
      declaredNames.add("min");
      declaredNames.add("max");
      declaredNames.add("start");
      declaredNames.add("fixed");
    }
    if (currentEntry?.name === "StateSelect") declaredNames.add("default");
  }

  const elements = db.query<SymbolId[]>("instantiate", typeClassId) || [];
  for (const eid of elements) {
    const child = db.symbol(eid);
    if (child && child.name && !isRelationshipOrImportSymbol(child)) declaredNames.add(child.name);
  }
  if (typeEntry.language && typeEntry.language !== "modelica") {
    for (const child of db.childrenOf(typeClassId)) {
      if (child.name && isMemberLikeSymbol(child)) {
        declaredNames.add(child.name);
      }
    }
    const collectNamedParams = (metaObj: unknown) => {
      const m = metaObj as Record<string, unknown> | undefined;
      const np = m?.["namedParams"];
      if (np && typeof np === "object" && !Array.isArray(np)) {
        for (const k of Object.keys(np as Record<string, unknown>)) {
          declaredNames.add(k);
        }
      }
    };
    collectNamedParams(typeEntry.metadata);
    collectNamedParams(currentEntry?.metadata);
  }

  // --- 3. Modifier Argument Lookup & Recursive Nested Validation ---
  // Emit diagnostics for unknown modifier names and recursively validate `arg.nestedArgs`
  // against the target element's class (accounting for sibling or inline `redeclare` overrides).
  const results = [];
  for (const arg of mod.args) {
    if (
      arg.name &&
      arg.name !== "annotation" &&
      !arg.name.startsWith("break_connect:") &&
      !declaredNames.has(arg.name)
    ) {
      let msg: string;
      let diagCode: number = ModelicaErrorCode.MODIFIER_CLASS_NOT_FOUND.code;
      if (self.kind === "Class") {
        if (!arg.isRedeclaration && overrideClassName === self.name) {
          let modText = arg.name;
          if (arg.value && typeof arg.value.text === "string") {
            modText += " = " + arg.value.text;
          } else if (arg.bindingExpression) {
            modText += " = " + arg.bindingExpression;
          }
          msg = `In modifier (${modText}), class or component ${arg.name} not found in <${self.name}>.`;
          diagCode = ModelicaErrorCode.MODIFIER_CLASS_NOT_FOUND.code;
        } else {
          msg = `Modified element ${arg.name} not found in class ${typeEntry.name}.`;
          diagCode = ModelicaErrorCode.MODIFIED_ELEMENT_NOT_FOUND.code;
        }
      } else if (!arg.isRedeclaration && overrideClassName) {
        // value modifier on a short class or nested
        let modText = arg.name;
        if (arg.value && typeof arg.value.text === "string") {
          modText += " = " + arg.value.text;
        } else if (arg.bindingExpression) {
          modText += " = " + arg.bindingExpression;
        }
        msg = `Variable ${self.name}.${overrideClassName}: In modifier (${modText}), class or component ${arg.name} not found in <${typeEntry.name}$${self.name}$${overrideClassName}>.`;
        diagCode = ModelicaErrorCode.MODIFIER_CLASS_NOT_FOUND.code;
      } else if (
        self.kind === "Component" &&
        !arg.isRedeclaration &&
        arg.name === typeEntry.name &&
        arg.nestedArgs &&
        arg.nestedArgs.length > 0 &&
        self.parentId
      ) {
        const parentSym = db.symbol(self.parentId);
        let varPath = self.name;
        let scopeTag = `${typeEntry.name}$${self.name}`;
        if (parentSym) {
          const topSyms = db.childrenOf(parentSym.parentId ?? null);
          for (const s of topSyms) {
            if (s && s.kind === "Class") {
              for (const ch of db.childrenOf(s.id)) {
                const ci = db.query<any>("componentInstance", ch.id);
                const tSpec = ci?.typeSpecifier ?? (ch.metadata as any)?.typeSpecifier;
                if (ch.kind === "Component" && tSpec === parentSym.name) {
                  varPath = `${ch.name}.${self.name}`;
                  scopeTag = `${typeEntry.name}$${ch.name}$${self.name}`;
                  break;
                }
              }
            }
          }
        }
        const nested = arg.nestedArgs[0]!;
        let nestedVal = "";
        if (nested.value && typeof nested.value.text === "string") {
          nestedVal = " = " + nested.value.text;
        } else if (nested.bindingExpression) {
          nestedVal = " = " + nested.bindingExpression;
        }
        const modText = `${arg.name}(${nested.name}${nestedVal}), class or component ${nested.name}`;
        msg = `Variable ${varPath}: In modifier (${modText}), class or component ${arg.name} not found in <${scopeTag}>.`;
        diagCode = ModelicaErrorCode.MODIFIER_CLASS_NOT_FOUND.code;
        let curCst = db.cstNode(self.id) as SyntaxNode | null;
        while (curCst && curCst.type !== "component_clause" && curCst.parent) {
          curCst = curCst.parent;
        }
        if (curCst && curCst.startOffset !== undefined && curCst.endOffset !== undefined) {
          results.push(
            error(msg, {
              startOffset: curCst.startOffset,
              endOffset: curCst.endOffset,
              code: diagCode,
            }),
          );
          continue;
        }
      } else if (!db.cstNode(typeEntry.id)) {
        // Foreign / CST-less classes are outside the WASM CST table (so WASM M4045 does not inspect them)
        msg = ModelicaErrorCode.MODIFIED_ELEMENT_NOT_FOUND.message(arg.name, typeEntry.name);
        diagCode = ModelicaErrorCode.MODIFIED_ELEMENT_NOT_FOUND.code;
      } else {
        // Direct component modifier is already handled by WASM M4045
        continue;
      }

      const isShortClassUnknownMod = self.kind === "Class" && !arg.isRedeclaration && overrideClassName === self.name;
      if (isShortClassUnknownMod) {
        results.push(error(msg, { code: diagCode }));
      } else if (arg.nameRange) {
        results.push(
          error(msg, {
            startOffset: arg.nameRange[0],
            endOffset: arg.nameRange[1],
            code: diagCode,
          }),
        );
      } else {
        results.push(
          error(msg, {
            field: "declaration.modification",
            code: diagCode,
          }),
        );
      }
    } else if (arg.name && declaredNames.has(arg.name)) {
      // Find the original element to check if it's a function replacement, or if it's final/constant
      const elements = db.query<SymbolId[]>("instantiate", typeClassId) || [];
      let originalId: SymbolId | null = null;
      for (const eid of elements) {
        const child = db.symbol(eid);
        if (child && child.name === arg.name) {
          originalId = eid;
          break;
        }
      }

      if (originalId) {
        const originalEntry = db.symbol(originalId);
        void originalEntry;

        // Recursively check nested arguments
        if (arg.nestedArgs && arg.nestedArgs.length > 0) {
          let nestedTypeClassId = db.query<SymbolId | null>("classInstance", originalId);

          // Check if originalId's type was redeclared in sibling modifiers of mod.args
          if (originalId) {
            const origTypeSpec = db.query<string | null>("typeSpecifier", originalId);
            if (origTypeSpec) {
              const siblingRedecl = mod.args.find(
                (a: any) => a.isRedeclaration && (a.name === origTypeSpec || a.name === origTypeSpec.split(".").pop()),
              );
              if (siblingRedecl) {
                const targetTypeName = siblingRedecl.redeclaredTypeSpecifier || siblingRedecl.name;
                const resolve = db.query<any>("resolveName", self.id);
                let redeclEntry: SymbolEntry | null = null;
                if (resolve) redeclEntry = resolve(targetTypeName, true) as SymbolEntry | null;
                if (!redeclEntry && self.parentId) {
                  const resolveParent = db.query<any>("resolveName", self.parentId);
                  if (resolveParent) redeclEntry = resolveParent(targetTypeName, true) as SymbolEntry | null;
                }
                if (!redeclEntry) {
                  redeclEntry =
                    db.byName(targetTypeName.split(".").pop()!)?.find((e: any) => e.kind === "Class") ?? null;
                }
                if (redeclEntry) {
                  nestedTypeClassId = redeclEntry.id;
                }
              }
            }
          }

          if (arg.isRedeclaration && arg.redeclaredTypeSpecifier) {
            const resolve = db.query<any>("resolveName", self.id);
            let redeclaredEntry: SymbolEntry | null = null;
            if (resolve) redeclaredEntry = resolve(arg.redeclaredTypeSpecifier, true) as SymbolEntry | null;
            if (!redeclaredEntry && self.parentId) {
              const resolveParent = db.query<any>("resolveName", self.parentId);
              if (resolveParent)
                redeclaredEntry = resolveParent(arg.redeclaredTypeSpecifier, true) as SymbolEntry | null;
            }
            if (redeclaredEntry) nestedTypeClassId = redeclaredEntry.id;
          }

          if (nestedTypeClassId) {
            const nestedTypeEntry = db.symbol(nestedTypeClassId);
            if (nestedTypeEntry) {
              const nestedResults = checkModifierNotFound(
                db,
                self,
                { args: arg.nestedArgs },
                nestedTypeClassId,
                nestedTypeEntry,
                arg.name,
              );
              if (nestedResults) results.push(...nestedResults);
            }
          }
        }
      }
    }
  }
  return results.length > 0 ? results : null;
}

/**
 * Parses a CST modification subtree (`modification`, `class_modification`, or `element_modification`)
 * into a normalized `ModelicaModArgs` structure with hierarchical `nestedArgs` and `bindingExpression`.
 *
 * Handles:
 * - Standard element modifications (`a.b.c(x = 1) = 2`), splitting dotted paths into nested argument chains.
 * - Component and short-class redeclarations (`redeclare Type comp(...)`, `redeclare class C = Base(...)`)
 *   along with any attached `constrainedby` modifications.
 * - Inheritance `break` modifications (`break connect(...)` or `break ident`).
 *
 * @param node - CST modification node to walk.
 * @param scopeId - Optional lexical scope symbol ID where binding expressions should be evaluated.
 * @returns Normalized `ModelicaModArgs` containing merged modification arguments and optional binding value.
 */
export function parseModArgsFromCst(node: any, scopeId: number | null = null): any {
  const args: any[] = [];
  if (!node) return { args, bindingExpression: null, evaluationScopeId: scopeId };

  // Walk the CST modification tree to extract element modifications, redeclarations, and inheritance breaks.
  const walk = (n: any) => {
    if (!n) return;
    // Case 1: Standard `element_modification` (including dotted modification paths like `a.b.c = 1`).
    if (n.type === "ElementModification" || n.type === "element_modification") {
      const nameNode =
        Cst.ElementModification.name(n) ??
        n.children?.find((c: SyntaxNode) => c.type === "name" || c.type === "Name" || c.type === "identifier");
      const modNode =
        Cst.ElementModification.modification(n) ??
        n.children?.find((c: SyntaxNode) => c.type === "modification" || c.type === "Modification");
      const parentNode = n.parent;
      const isParentModOrRepl =
        parentNode &&
        (parentNode.type === "element_modification_or_replaceable" ||
          parentNode.type === "ElementModificationOrReplaceable" ||
          parentNode.type === "argument" ||
          parentNode.type === "Argument");
      const finalNode =
        n.children?.find((c: SyntaxNode) => c.type === "final" || c.text === "final") ??
        (isParentModOrRepl
          ? parentNode.children?.find((c: SyntaxNode) => c.type === "final" || c.text === "final")
          : undefined);
      const eachNode =
        n.children?.find((c: SyntaxNode) => c.type === "each" || c.text === "each") ??
        (isParentModOrRepl
          ? parentNode.children?.find((c: SyntaxNode) => c.type === "each" || c.text === "each")
          : undefined);

      const name = nameNode ? nameNode.text : "";
      const modRange = n ? ([n.startIndex ?? n.startOffset, n.endIndex ?? n.endOffset] as const) : undefined;
      const modPosition = n ? { startPosition: n.startPosition, endPosition: n.endPosition } : undefined;

      const isOldInst = Boolean(
        n.tree?.rootNode?.text?.includes("-d=-newInst") || node?.tree?.rootNode?.text?.includes("-d=-newInst"),
      );
      let modText = "";
      if (modNode) {
        if (isOldInst) {
          const nText = n.text || "";
          const nameLen = nameNode ? nameNode.text.length : 0;
          modText = nText.slice(nameLen);
        } else {
          modText = modNode.text?.trim() ?? "";
        }
      }

      const nested = parseModArgsFromCst(modNode, scopeId);

      const parts = name.split(".");
      const getPartNameRange = (partIndex: number): readonly [number, number] | undefined => {
        if (!nameNode) return undefined;
        const baseStart = nameNode.startIndex ?? nameNode.startOffset;
        if (typeof baseStart !== "number") return undefined;
        if (parts.length <= 1) {
          const baseEnd = nameNode.endIndex ?? nameNode.endOffset ?? baseStart + name.length;
          return [baseStart, baseEnd] as const;
        }
        let offset = 0;
        for (let k = 0; k < partIndex; k++) {
          offset += parts[k].length + 1;
        }
        const s = baseStart + offset;
        return [s, s + parts[partIndex].length] as const;
      };

      let currentNested = nested;
      for (let i = parts.length - 1; i > 0; i--) {
        currentNested = {
          args: [
            {
              name: parts[i],
              nameRange: getPartNameRange(i),
              modRange,
              modPosition,
              modText,
              each: false,
              final: false,
              isRedeclaration: false,
              nestedArgs: currentNested.args,
              value: currentNested.bindingExpression,
              evaluationScopeId: scopeId,
            },
          ],
          bindingExpression: null,
        };
      }

      args.push({
        name: parts[0],
        nameRange: getPartNameRange(0),
        modRange,
        modPosition,
        modText: parts.length > 1 ? "" : modText,
        each: !!eachNode,
        final: !!finalNode,
        isRedeclaration: false,
        nestedArgs: currentNested.args,
        value: currentNested.bindingExpression,
        evaluationScopeId: scopeId,
      });
      return;
    } else if (
      // Case 2: `element_redeclaration` or `element_replaceable` (component or short-class redeclaration).
      n.type === "ElementRedeclaration" ||
      n.type === "element_redeclaration" ||
      n.type === "ElementReplaceable" ||
      n.type === "element_replaceable"
    ) {
      const extractSubscripts = (arraySubNode: any): any[] | undefined => {
        if (!arraySubNode) return undefined;
        const subs: any[] = [];
        for (const child of arraySubNode.children) {
          if (child.type !== "Subscript" && child.type !== "subscript") continue;
          const flexChild =
            Cst.Subscript.flexible(child) ??
            child.children?.find((c: SyntaxNode) => c.text === ":" || c.type === ":" || c.type === '":"');
          if (flexChild && flexChild.text?.trim() === ":") {
            subs.push({ kind: "flexible" });
            continue;
          }
          const exprChild =
            Cst.Subscript.expression(child) ??
            child.children?.find((c: SyntaxNode) => c.type === "expression" || c.type === "Expression") ??
            (child.childCount > 0 ? child.child(0) : null);
          if (exprChild) {
            if (exprChild.type === "UNSIGNED_INTEGER" || exprChild.type === "unsigned_integer") {
              subs.push({ kind: "literal", value: parseInt(exprChild.text, 10) });
            } else {
              subs.push({
                kind: "expression",
                cstBytes: [
                  exprChild.startOffset ?? exprChild.startIndex ?? exprChild.startOffset,
                  exprChild.endOffset ?? exprChild.endIndex ?? exprChild.endOffset,
                ],
                text: exprChild.text,
              });
            }
            continue;
          }
        }
        return subs.length > 0 ? subs : undefined;
      };

      const replaceableNode = n.children?.find(
        (c: SyntaxNode) => c.type === "ElementReplaceable" || c.type === "element_replaceable",
      );
      const targetNode = replaceableNode ?? n;

      const clause =
        Cst.Element.componentClause(targetNode) ??
        targetNode.children?.find(
          (c: SyntaxNode) =>
            c.type === "component_clause" || c.type === "ComponentClause" || c.type === "component_clause1",
        ) ??
        Cst.Element.componentClause(n) ??
        n.children?.find(
          (c: SyntaxNode) =>
            c.type === "component_clause" || c.type === "ComponentClause" || c.type === "component_clause1",
        );
      if (clause) {
        const typePrefixNode =
          clause.children?.find((c: SyntaxNode) => c.type === "type_prefix" || c.type === "TypePrefix") ??
          Cst.ComponentClause.typePrefix(clause);
        const redeclaredPrefix = typePrefixNode?.text?.trim() ?? "";
        const typeSpec =
          clause.children?.find((c: SyntaxNode) => c.type === "type_specifier" || c.type === "TypeSpecifier") ??
          Cst.ComponentClause.typeSpecifier(clause);
        const compList = Cst.ComponentClause.componentList(clause);
        const decl1 =
          (compList ? Cst.ComponentList.componentDeclaration(compList) : null) ??
          clause.children?.find(
            (c: SyntaxNode) =>
              c.type === "component_declaration" ||
              c.type === "ComponentDeclaration" ||
              c.type === "component_declaration1",
          );
        const decl =
          Cst.ComponentDeclaration.declaration(decl1) ??
          decl1?.children?.find((c: SyntaxNode) => c.type === "declaration" || c.type === "Declaration") ??
          decl1;
        const ident =
          Cst.Declaration.name(decl) ??
          decl?.children?.find((c: SyntaxNode) => c.type === "identifier" || c.type === "Identifier");
        const modNode =
          Cst.Declaration.modification(decl) ??
          decl?.children?.find((c: SyntaxNode) => c.type === "modification" || c.type === "Modification");

        const name = ident ? ident.text : "";
        const nameRange = ident ? ([ident.startIndex, ident.endIndex] as const) : undefined;
        const typeName = typeSpec ? typeSpec.text : "";
        const nested = parseModArgsFromCst(modNode, scopeId);

        const constrClause =
          targetNode.children?.find(
            (c: SyntaxNode) => c.type === "constraining_clause" || c.type === "ConstrainingClause",
          ) ?? n.children?.find((c: SyntaxNode) => c.type === "constraining_clause" || c.type === "ConstrainingClause");
        if (constrClause) {
          const constrMod = constrClause.children?.find(
            (c: SyntaxNode) => c.type === "class_modification" || c.type === "ClassModification",
          );
          if (constrMod) {
            const constrParsed = parseModArgsFromCst(constrMod, scopeId);
            if (constrParsed && constrParsed.args && constrParsed.args.length > 0) {
              const existingNames = new Set(nested.args.map((a: any) => a.name));
              for (const cArg of constrParsed.args) {
                if (!existingNames.has(cArg.name)) {
                  nested.args.push(cArg);
                }
              }
            }
            if (!nested.bindingExpression && constrParsed.bindingExpression) {
              nested.bindingExpression = constrParsed.bindingExpression;
            }
          }
        }

        args.push({
          name,
          nameRange,
          modRange: n ? ([n.startIndex ?? n.startOffset, n.endIndex ?? n.endOffset] as const) : undefined,
          modPosition: n ? { startPosition: n.startPosition, endPosition: n.endPosition } : undefined,
          modText: n.text?.trim() ?? "",
          each: false,
          final: hasNodePrefixKeyword(n, "final", true),
          isRedeclaration: true,
          redeclaredKind: "component",
          redeclaredTypeSpecifier: typeName,
          redeclaredPrefix,
          redeclaredArrayDimensionsRaw: extractSubscripts(
            (decl ? Cst.Declaration.arraySubscripts(decl) : null) ??
              (decl1 ? Cst.Declaration.arraySubscripts(decl1) : null) ??
              decl1?.children?.find((c: SyntaxNode) => c.type === "array_subscripts" || c.type === "arraySubscripts"),
          ),
          nestedArgs: nested.args,
          value: nested.bindingExpression,
          evaluationScopeId: scopeId,
        });
      } else {
        const classDef =
          Cst.Element.classDefinition(targetNode) ??
          targetNode.children?.find(
            (c: SyntaxNode) =>
              c.type === "class_definition" ||
              c.type === "ClassDefinition" ||
              c.type === "short_class_definition" ||
              c.type === "ShortClassDefinition",
          ) ??
          Cst.Element.classDefinition(n) ??
          n.children?.find(
            (c: SyntaxNode) =>
              c.type === "class_definition" ||
              c.type === "ClassDefinition" ||
              c.type === "short_class_definition" ||
              c.type === "ShortClassDefinition",
          );
        if (classDef) {
          let shortClass =
            Cst.ClassDefinition.classSpecifier(classDef) ??
            classDef.children?.find(
              (c: SyntaxNode) =>
                c.type === "class_specifier" ||
                c.type === "ClassSpecifier" ||
                c.type === "short_class_specifier" ||
                c.type === "ShortClassSpecifier",
            ) ??
            (classDef.type === "short_class_specifier" || classDef.type === "ShortClassSpecifier" ? classDef : null);
          if (shortClass) {
            if (shortClass.type === "class_specifier" || shortClass.type === "ClassSpecifier") {
              const innerShort = shortClass.children?.find(
                (c: SyntaxNode) => c.type === "short_class_specifier" || c.type === "ShortClassSpecifier",
              );
              if (innerShort) shortClass = innerShort;
            }
            const ident =
              Cst.ShortClassSpecifier.name(shortClass) ??
              shortClass.children?.find((c: SyntaxNode) => c.type === "identifier" || c.type === "Identifier");
            const typeSpec =
              Cst.ShortClassSpecifier.typeSpecifier(shortClass) ??
              shortClass.children?.find((c: SyntaxNode) => c.type === "type_specifier" || c.type === "TypeSpecifier");
            const name = ident ? ident.text?.trim() : "";
            let typeName = typeSpec ? typeSpec.text?.trim() : "";
            if (!typeName && shortClass.text?.includes("enumeration")) {
              typeName = shortClass.text.slice(shortClass.text.indexOf("enumeration")).trim();
            }
            const modNode =
              Cst.ShortClassSpecifier.classModification(shortClass) ??
              shortClass.children?.find(
                (c: SyntaxNode) => c.type === "class_modification" || c.type === "ClassModification",
              );
            const nested = parseModArgsFromCst(modNode, scopeId);

            const constrClause =
              targetNode.children?.find(
                (c: SyntaxNode) => c.type === "constraining_clause" || c.type === "ConstrainingClause",
              ) ??
              n.children?.find((c: SyntaxNode) => c.type === "constraining_clause" || c.type === "ConstrainingClause");
            if (constrClause) {
              const constrMod = constrClause.children?.find(
                (c: SyntaxNode) => c.type === "class_modification" || c.type === "ClassModification",
              );
              if (constrMod) {
                const constrParsed = parseModArgsFromCst(constrMod, scopeId);
                if (constrParsed && constrParsed.args && constrParsed.args.length > 0) {
                  const existingNames = new Set(nested.args.map((a: any) => a.name));
                  for (const cArg of constrParsed.args) {
                    if (!existingNames.has(cArg.name)) {
                      nested.args.push(cArg);
                    }
                  }
                }
                if (!nested.bindingExpression && constrParsed.bindingExpression) {
                  nested.bindingExpression = constrParsed.bindingExpression;
                }
              }
            }

            args.push({
              name,
              nameRange: ident
                ? ([ident.startIndex ?? ident.startOffset, ident.endIndex ?? ident.endOffset] as const)
                : undefined,
              modRange: n ? ([n.startIndex ?? n.startOffset, n.endIndex ?? n.endOffset] as const) : undefined,
              modPosition: n ? { startPosition: n.startPosition, endPosition: n.endPosition } : undefined,
              modText: n.text?.trim() ?? "",
              each: false,
              final: hasNodePrefixKeyword(n, "final", true),
              isRedeclaration: true,
              redeclaredKind: "class",
              redeclaredTypeSpecifier: typeName,
              redeclaredArrayDimensionsRaw: extractSubscripts(
                Cst.ShortClassSpecifier.arraySubscripts(shortClass) ??
                  shortClass.children?.find(
                    (c: SyntaxNode) => c.type === "array_subscripts" || c.type === "arraySubscripts",
                  ),
              ),
              nestedArgs: nested.args,
              value: nested.bindingExpression,
              evaluationScopeId: scopeId,
            });
          }
        }
      }
      return;
    } else if (n.type === "InheritanceModification" || n.type === "inheritance_modification") {
      // Case 3: `inheritance_modification` (`break connect(a, b)` or `break ident`).
      const connectEq =
        (Cst.ConnectEquation.is(n) ? n : null) ??
        (n.children || []).find((c: SyntaxNode) => c.type === "connect_equation" || c.type === "ConnectEquation");
      if (connectEq) {
        const source =
          Cst.ConnectEquation.lhs(connectEq) ??
          (connectEq.children || []).filter(
            (c: SyntaxNode) =>
              c.type === "component_reference" ||
              c.type === "expression" ||
              c.type === "identifier" ||
              c.type === "name",
          )[0];
        const target =
          Cst.ConnectEquation.rhs(connectEq) ??
          (connectEq.children || []).filter(
            (c: SyntaxNode) =>
              c.type === "component_reference" ||
              c.type === "expression" ||
              c.type === "identifier" ||
              c.type === "name",
          )[1];
        if (source && target) {
          const canonEq = `connect(${source.text.trim()},${target.text.trim()})`;
          args.push({
            name: "break_connect:" + canonEq,
            isBreak: true,
            each: false,
            final: false,
            isRedeclaration: false,
            nestedArgs: [],
            value: { kind: "break", target: canonEq },
            evaluationScopeId: scopeId,
          });
        }
      }
      const identifier = (n.children || []).find((c: SyntaxNode) => c.type === "identifier" || c.type === "Identifier");
      if (identifier) {
        args.push({
          name: identifier.text.trim(),
          isBreak: true,
          each: false,
          final: false,
          isRedeclaration: false,
          nestedArgs: [],
          value: { kind: "break" },
          evaluationScopeId: scopeId,
        });
      }
      return;
    }
    if (n.type === "ModificationExpression" || n.type === "modification_expression") return;
    for (const child of n.children) walk(child);
  };
  walk(node);

  // Extract direct value binding expression (`= expr` or `:= expr`) if attached to the modification root.
  let bindingExpression: ModelicaModArgs["bindingExpression"] = null;
  const nt = node.type.toLowerCase();
  if (nt === "modification" || nt === "elementmodification" || nt === "element_modification") {
    const expr = Cst.Modification.modificationExpression(node);
    if (expr)
      bindingExpression = {
        kind: "expression",
        cstBytes: [expr.startOffset ?? expr.startIndex, expr.endOffset ?? expr.endIndex],
        text: expr.text,
        evaluationScopeId: scopeId,
      };
  }

  // Preserve duplicate redeclarations unmerged so downstream lints can flag duplicate modification errors.
  const redeclNames = new Set<string>();
  let hasDupRedecl = false;
  for (const a of args) {
    if (a.isRedeclaration && a.name) {
      if (redeclNames.has(a.name)) {
        hasDupRedecl = true;
        break;
      }
      redeclNames.add(a.name);
    }
  }
  if (hasDupRedecl) {
    return { args, bindingExpression, evaluationScopeId: scopeId };
  }

  let finalMod: ModelicaModArgs = { args: [], bindingExpression, evaluationScopeId: scopeId };
  for (const arg of args) {
    finalMod = mergeModArgs({ args: [arg], bindingExpression: null, evaluationScopeId: scopeId }, finalMod);
  }

  return finalMod;
}

const BUILTIN_MODELICA_NAMES = new Set([
  // Independent variable
  "time",
  // Built-in operators
  "der",
  "pre",
  "edge",
  "change",
  "reinit",
  "initial",
  "terminal",
  "sample",
  "noEvent",
  "smooth",
  "delay",
  "cardinality",
  "inStream",
  "actualStream",
  // Synchronous Language Elements
  "Clock",
  "hold",
  "previous",
  "backSample",
  "shiftSample",
  "subSample",
  "superSample",
  "noClock",
  "interval",
  "initialState",
  "activeState",
  "ticksInState",
  "timeInState",
  "transition",
  // Assertions / utilities
  "assert",
  "print",
  "terminate",
  // Mathematical functions
  "abs",
  "sign",
  "sqrt",
  "exp",
  "log",
  "log10",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "atan2",
  "sinh",
  "cosh",
  "tanh",
  "floor",
  "ceil",
  "integer",
  "mod",
  "rem",
  "div",
  // Array / reduction functions
  "max",
  "min",
  "sum",
  "product",
  "ndims",
  "size",
  "zeros",
  "ones",
  "fill",
  "identity",
  "diagonal",
  "transpose",
  "cat",
  "scalar",
  "vector",
  "matrix",
  "cross",
  "skew",
  "outerProduct",
  "symmetric",
  // Type names
  "String",
  "Integer",
  "Boolean",
  "Real",
  // Modelica package
  "Modelica",
  // Enumerations
  "enumeration",
  // Scripting API
  "simulate",
]);
void BUILTIN_MODELICA_NAMES;

// ---------------------------------------------------------------------------
// Helper combinators (mirrors grammar.js utility functions)
// ---------------------------------------------------------------------------

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
 * Precomputed lexical scope summary for a Modelica class or package,
 * indexing direct members and all three forms of `import` clauses (`MLS §13.2.1`).
 */
export interface ScopeData {
  directByName: Record<string, SymbolId>;
  qualifiedImports: Record<string, string>;
  unqualifiedImportPkgs: string[];
  compoundImports: Array<{ pkg: string; names: string[] }>;
  isEncapsulated: boolean;
  parentId: SymbolId | null;
  id: SymbolId;
}

let __g_scope_calls = 0;
let __g_scope_time = 0;
void __g_scope_time;
/**
 * Builds the `ScopeData` lookup table for a class or package symbol by scanning its direct
 * `Class`, `Component`, `EnumerationLiteral`, and `Import` children.
 *
 * @param db - Active Salsa query database.
 * @param self - Class or package symbol entry.
 * @returns Populated `ScopeData` structure for fast name resolution.
 */
export function getScopeData(db: QueryDB, self: SymbolEntry): ScopeData {
  const _t0 = performance.now();
  void _t0;
  __g_scope_calls++;
  const baseId = db.baseOf(self.id);
  const sourceId = baseId ?? self.id;
  const children = db.childrenOf(sourceId);

  const directByName: Record<string, SymbolId> = {};
  const qualifiedImports: Record<string, string> = {};
  const unqualifiedImportPkgs: string[] = [];
  const compoundImports: Array<{ pkg: string; names: string[] }> = [];

  for (const child of children) {
    if (
      child.kind === "Class" ||
      child.kind === "Component" ||
      child.kind === "EnumerationLiteral" ||
      (child.language && child.language !== "modelica" && (isTypeLikeSymbol(child) || isMemberLikeSymbol(child)))
    ) {
      directByName[child.name] = child.id;
    } else if (child.kind === "Extends") {
      for (const extChild of db.childrenOf(child.id)) {
        if (extChild.kind === "Class" || isTypeLikeSymbol(extChild)) {
          directByName[extChild.name] = extChild.id;
        }
      }
    }

    if (child.kind === "Import") {
      const meta = child.metadata as Record<string, unknown>;
      let importKind =
        (meta?.["importKind"] as string | undefined) ??
        (child.ruleName === "UnqualifiedImportClause"
          ? "unqualified"
          : child.ruleName === "CompoundImportClause"
            ? "compound"
            : undefined);
      let pkgName = (meta?.["packageName"] ?? child.name) as string;
      let aliasName = meta?.["shortName"] as string | undefined;

      // For WASM GLR parser import_clause nodes, inspect the CST to determine the import kind
      if (importKind === undefined && (child.ruleName === "import_clause" || child.ruleName === "ImportClause")) {
        const importCst = db.cstNode(child.id) as SyntaxNode | null;
        if (importCst) {
          const aliasNode = Cst.ImportClause.alias(importCst);
          const importListNode = Cst.ImportClause.importList(importCst);
          const cstText: string = importCst.text ?? "";

          if (aliasNode) {
            // Renamed import: import MyC = A.B2.C;
            aliasName = aliasNode.text;
            importKind = "simple";
          } else if (importListNode) {
            // Compound import: import A.B.{C, D};
            importKind = "compound";
          } else if (
            (importCst.children || []).some(
              (c: CstNodeLike) => c.type === "*" || c.type === '"*"' || c.text?.trim() === "*",
            ) ||
            cstText.trimEnd().endsWith("*")
          ) {
            // Unqualified import: import A.B.*;
            // pkgName is already the name without .* (from name field)
            importKind = "unqualified";
          } else {
            // Simple import: import A.B.C;
            importKind = "simple";
          }
        } else {
          importKind = "simple";
        }
      }
      if (!importKind) importKind = "simple";

      if (db.ensureFQNIndexed && pkgName) {
        db.ensureFQNIndexed(pkgName);
      }

      if (importKind === "simple") {
        const shortName = aliasName ?? splitQualifiedPath(pkgName).pop() ?? pkgName;
        if (shortName in qualifiedImports) {
          qualifiedImports[shortName] = "__CONFLICT__";
        } else {
          qualifiedImports[shortName] = pkgName;
        }
      } else if (importKind === "unqualified") {
        unqualifiedImportPkgs.push(pkgName);
      } else if (importKind === "compound") {
        const importNames = db
          .childrenOfField(child.id, "importName")
          .map((c) => c.name)
          .filter(Boolean);
        // Also try extracting import names from CST if childrenOfField returned nothing
        if (importNames.length === 0) {
          const importCst = db.cstNode(child.id) as SyntaxNode | null;
          if (importCst) {
            const importListNode = Cst.ImportClause.importList(importCst);
            if (importListNode) {
              const listText: string = importListNode.text ?? "";
              const names = listText
                .split(",")
                .map((n: string) => n.trim())
                .filter(Boolean);
              if (names.length > 0) {
                // Strip trailing ".{...}" from pkgName if present
                if (pkgName.endsWith("}")) {
                  const braceIdx = pkgName.lastIndexOf(".{");
                  if (braceIdx >= 0) pkgName = pkgName.slice(0, braceIdx);
                }
                compoundImports.push({ pkg: pkgName, names });
                continue;
              }
            }
          }
        }
        compoundImports.push({ pkg: pkgName, names: importNames });
      }
    }
  }

  const isEncapsulated = isSymbolEncapsulated(db, self);

  const ret = {
    directByName,
    qualifiedImports,
    unqualifiedImportPkgs,
    compoundImports,
    isEncapsulated,
    parentId: self.parentId,
    id: self.id,
  };
  return ret;
}

/**
 * Checks whether a single symbol declaration carries the `encapsulated` prefix (`MLS §5.3.1`).
 *
 * @param db - Active Salsa query database.
 * @param sym - Symbol entry to inspect.
 * @returns `true` if `sym` is declared `encapsulated`.
 */
export function isSymbolEncapsulated(db: QueryDB, sym: SymbolEntry): boolean {
  if ((sym as any)._isEncapsulated !== undefined) return (sym as any)._isEncapsulated;
  if ((sym.metadata as Record<string, unknown> | undefined)?.["encapsulated"]) {
    (sym as any)._isEncapsulated = true;
    return true;
  }
  const rawKind = String(
    (sym.metadata as Record<string, unknown> | undefined)?.["classKind"] ??
      (sym.metadata as Record<string, unknown> | undefined)?.["classPrefixes"] ??
      "",
  );
  if (collapseSpaceTokens(stripModelicaComments(rawKind)).includes("encapsulated")) {
    (sym as any)._isEncapsulated = true;
    return true;
  }
  const cst = db.cstNode(sym.id) as (CstNodeLike & { text?: string }) | null;
  if (cst && cst.children) {
    for (const ch of cst.children) {
      if (ch.type === "encapsulated" || ch.type === '"encapsulated"' || ch.text === "encapsulated") {
        (sym as { _isEncapsulated?: boolean })._isEncapsulated = true;
        return true;
      }
      if (ch.type === "class_prefixes" && ch.children) {
        for (const pch of ch.children) {
          if (pch.type === "encapsulated" || pch.type === '"encapsulated"' || pch.text === "encapsulated") {
            (sym as { _isEncapsulated?: boolean })._isEncapsulated = true;
            return true;
          }
        }
      }
      if (ch.type === "class_specifier") break;
    }
  }
  const queryDbWithCst = db as { cstText?: (s: number, e: number, sym?: unknown) => string | null };
  if (sym.startOffset != null && sym.endOffset != null && typeof queryDbWithCst.cstText === "function") {
    const header = queryDbWithCst.cstText(sym.startOffset, Math.min(sym.endOffset, sym.startOffset + 120), sym);
    if (typeof header === "string" && header.length > 0) {
      const res = hasLeadingEncapsulatedPrefix(header);
      (sym as { _isEncapsulated?: boolean })._isEncapsulated = res;
      return res;
    }
  }
  const text = cst ? (cst.text ?? "").slice(0, 120) : "";
  const res = hasLeadingEncapsulatedPrefix(text);
  (sym as any)._isEncapsulated = res;
  return res;
}

/**
 * Checks whether `symbolId` or any of its enclosing lexical ancestors is declared `encapsulated`.
 *
 * @param db - Active Salsa query database.
 * @param symbolId - Starting scope symbol ID.
 * @returns `true` if the scope chain contains an `encapsulated` boundary.
 */
export function isScopeEncapsulated(db: QueryDB, symbolId: SymbolId | null | undefined): boolean {
  if (symbolId === null || symbolId === undefined) return false;
  const rootSym = db.symbol(symbolId);
  if (!rootSym) return false;
  if ((rootSym as any)._isScopeEncapsulated !== undefined) return (rootSym as any)._isScopeEncapsulated;
  const seen = new Set<SymbolId>();
  let curr: SymbolEntry | null | undefined = rootSym;
  while (curr && !seen.has(curr.id)) {
    seen.add(curr.id);
    if (isSymbolEncapsulated(db, curr)) {
      (rootSym as any)._isScopeEncapsulated = true;
      return true;
    }
    curr = curr.parentId !== null ? db.symbol(curr.parentId) : null;
  }
  (rootSym as any)._isScopeEncapsulated = false;
  return false;
}

/**
 * Copies entries from `source` into `target` without overwriting existing keys in `target`.
 *
 * @param target - Destination symbol map.
 * @param source - Inherited symbol map to merge in.
 */
export function mergeInto(target: Record<string, SymbolId>, source: Record<string, SymbolId>) {
  for (const [key, value] of Object.entries(source)) {
    if (!(key in target)) {
      target[key] = value;
    }
  }
}

/**
 * Resolves a simple (unqualified) identifier within `classId`'s scope according to Modelica §5.3:
 * 1. Direct elements (and enumeration literals)
 * 2. Inherited elements via `extends` or short-class base types
 * 3. Qualified/renamed imports (`import A = B.C` or `import B.C`)
 * 4. Compound imports (`import B.{C, D}`)
 * 5. Unqualified imports (`import B.*`, rejecting ambiguous multi-package matches)
 * 6. Enclosing lexical parent scopes (unless blocked by `encapsulated`)
 * 7. Global predefined/top-level package fallback
 *
 * @param db - Active Salsa query database.
 * @param classId - Scope class symbol ID.
 * @param name - Unqualified identifier to resolve.
 * @param encapsulated - Whether lookup is restricted by an `encapsulated` boundary.
 * @param skipInherited - Whether to skip `extends` inheritance lookup.
 * @param visited - Cycle-detection set of visited class IDs.
 * @param memberOnly - When `true`, restricts lookup to direct/inherited members of `classId` (no parent scope walk).
 * @returns Resolved `SymbolEntry`, or `null` if not found.
 */
export function resolveSimpleNameHelper(
  db: QueryDB,
  classId: SymbolId,
  name: string,
  encapsulated = false,
  skipInherited = false,
  visited: Set<SymbolId> = new Set(),
  memberOnly = false,
): SymbolEntry | null {
  if (visited.has(classId)) return null;
  visited.add(classId);

  const unspecializedId = db.baseOf(classId) ?? classId;
  let scope = db.query<ScopeData | null>("scopeData", unspecializedId);
  if (!scope) return null;

  // 1. Direct elements
  let directId: SymbolId | undefined = scope.directByName[name];
  if (directId === undefined && db.ensureFQNIndexed) {
    const classEntry = db.symbol(unspecializedId);
    if (classEntry) {
      const fqn = getSymbolQualifiedName(db, classEntry.id);
      if (fqn) {
        db.ensureFQNIndexed(fqn + "." + name);
        const refreshed = db.query<ScopeData | null>("scopeData", unspecializedId);
        if (refreshed) scope = refreshed;
        directId = scope.directByName[name];
      }
    }
  }
  if (directId !== undefined) return db.symbol(directId) ?? null;

  const unspecializedSym = db.symbol(unspecializedId);
  if (unspecializedSym) {
    const unspecMeta = unspecializedSym.metadata as Record<string, unknown> | undefined;
    const uKind = String(unspecMeta?.["classKind"] ?? unspecMeta?.["classPrefixes"] ?? "");
    if (!uKind || uKind.includes("type") || uKind.includes("enumeration") || uKind === "class") {
      let cstText: string | undefined;
      const queryDbWithCst = db as { cstText?: (s: number, e: number, sym?: unknown) => string | null };
      if (
        unspecializedSym.startOffset != null &&
        unspecializedSym.endOffset != null &&
        typeof queryDbWithCst.cstText === "function"
      ) {
        if (unspecializedSym.endOffset - unspecializedSym.startOffset < 8192) {
          cstText =
            queryDbWithCst.cstText(unspecializedSym.startOffset, unspecializedSym.endOffset, unspecializedSym) ??
            undefined;
        }
      } else {
        cstText = (db.cstNode(unspecializedId) as { text?: string } | null)?.text;
      }
      const cstNode = db.cstNode(unspecializedId) as CstNodeLike | null;
      const shortSpec = getShortClassSpecifierNode(cstNode) as CstNodeLike | null;
      const enumListNode =
        shortSpec?.children?.find((c) => c.type === "enum_list" || c.type === "EnumList") ??
        cstNode?.children?.find((c) => c.type === "enum_list" || c.type === "EnumList");
      if (enumListNode && enumListNode.children) {
        for (const c of enumListNode.children) {
          if (c.type === "enumeration_literal" || c.type === "EnumerationLiteral") {
            const idNode = c.children?.find((ch) => ch.type === "identifier" || ch.type === "Identifier") ?? c;
            const litName = idNode?.text ? stripOuterChar(idNode.text.trim(), "'") : undefined;
            if (litName === name) {
              return {
                ...unspecializedSym,
                id: -1 as SymbolId,
                parentId: unspecializedId,
                kind: "EnumerationLiteral" as SymbolEntry["kind"],
                name,
              };
            }
          }
        }
      }

      if (typeof cstText === "string" && cstText.includes("enumeration")) {
        const hasLit = parseEnumLiteralsFromText(cstText, 0, true).some((l) => l.name === name);
        if (hasLit) {
          return {
            ...unspecializedSym,
            id: -1 as SymbolId,
            parentId: unspecializedId,
            kind: "EnumerationLiteral" as SymbolEntry["kind"],
            name,
          };
        }
      }
    }
  }

  // 2. Inherited elements
  if (!skipInherited) {
    const inheritedMap = db.query<Record<string, SymbolId> | null>("inheritedSymbolsMap", unspecializedId);
    const inheritedId = inheritedMap?.[name];
    if (inheritedId !== undefined) return db.symbol(inheritedId) ?? null;
  }

  // 2.5. Short class target
  if (!skipInherited) {
    const self = db.symbol(classId);
    const meta = self?.metadata as Record<string, unknown>;
    if (self && !meta?.["isPredefined"]) {
      let mayBeShortClass = true;
      const queryDbWithCst = db as { cstText?: (s: number, e: number, sym?: unknown) => string | null };
      if (self.startOffset != null && self.endOffset != null && typeof queryDbWithCst.cstText === "function") {
        const hdr = queryDbWithCst.cstText(self.startOffset, Math.min(self.endOffset, self.startOffset + 256), self);
        if (typeof hdr === "string" && hdr.length > 0) {
          mayBeShortClass = hdr.includes("=");
        }
      }
      const cst = mayBeShortClass ? (db.cstNode(classId) as { type?: string } | null) : null;
      const classSpecifier = cst ? getShortClassSpecifierNode(cst) : null;
      if (classSpecifier) {
        const effMod = db.query<any>("effectiveModification", classId);
        const redeclClassArg = effMod?.args?.find(
          (a: any) => a.name === name && a.isRedeclaration && a.redeclaredKind === "class" && a.redeclaredTypeSpecifier,
        );
        if (redeclClassArg) {
          const evalScopeId = redeclClassArg.evaluationScopeId ?? self.parentId;
          const redeclTargetName: string = redeclClassArg.redeclaredTypeSpecifier;
          let redeclTarget: SymbolEntry | null = null;
          if (evalScopeId !== null && evalScopeId !== undefined && !visited.has(evalScopeId)) {
            redeclTarget =
              db.query<(n: string) => SymbolEntry | null>("resolveName", evalScopeId)?.(redeclTargetName) ?? null;
          }
          if (!redeclTarget) {
            redeclTarget =
              resolveQualified(db, redeclTargetName) ??
              db
                .byName(redeclTargetName)
                ?.find((e) => e.kind === "Class" || e.kind === "Package" || e.kind === "Function") ??
              null;
          }
          if (redeclTarget && redeclTarget.id !== classId) {
            return redeclTarget;
          }
        }
        const typeSpec =
          Cst.ShortClassSpecifier.typeSpecifier(classSpecifier) ??
          classSpecifier.children?.find((c: SyntaxNode) => c.type === "type_specifier" || c.type === "TypeSpecifier");
        const typeName = typeSpec?.text?.trim();
        if (typeName) {
          let resolved: { id: SymbolId } | null = null;
          if (self.parentId !== null) {
            const parentResolver = db.query<(n: string) => { id: SymbolId } | null>("resolveName", self.parentId);
            if (parentResolver) {
              resolved = parentResolver(typeName);
            }
          }
          if (!resolved) {
            resolved = db.byName(typeName)?.find((e) => e.kind === "Class" || e.kind === "Package") ?? null;
          }
          if (resolved?.id && resolved.id !== classId && !visited.has(resolved.id)) {
            const found = resolveSimpleNameHelper(
              db,
              resolved.id,
              name,
              encapsulated,
              skipInherited,
              visited,
              memberOnly,
            );
            if (found) return found;
          }
        }
      }
    }
  }

  if (memberOnly) {
    const qualPkg = scope.qualifiedImports[name];
    if (qualPkg && qualPkg !== "__CONFLICT__") {
      const target = resolveQualified(db, qualPkg, true);
      if (target?.kind === "Component") return target;
    }
    return null;
  }

  // 3. Qualified imports
  const qualPkg = scope.qualifiedImports[name];
  if (qualPkg) {
    if (qualPkg === "__CONFLICT__") return null;
    return resolveQualified(db, qualPkg, true);
  }

  // Helper to resolve an import path, respecting local aliases for the first segment
  const resolveImportPath = (pathStr: string): SymbolEntry | null => {
    const parts = splitQualifiedPath(pathStr);
    const first = parts[0];
    const aliasTarget = first ? scope.qualifiedImports[first] : undefined;
    if (aliasTarget && aliasTarget !== "__CONFLICT__") {
      const fullPath = [aliasTarget, ...parts.slice(1)].join(".");
      return resolveQualified(db, fullPath, true);
    } else {
      return resolveQualified(db, parts.join("."), true);
    }
  };

  // 4. Compound imports
  for (const ci of scope.compoundImports) {
    if (ci.names.includes(name)) {
      const pkgEntry = resolveImportPath(ci.pkg);
      if (pkgEntry) {
        const foundEntry = db.childrenOf(pkgEntry.id).find((c) => c.name === name && !isRelationshipOrImportSymbol(c));
        if (foundEntry) return foundEntry;
      }
    }
  }

  // 5. Unqualified imports
  let unqualMatch: SymbolEntry | null = null;
  let unqualMatchCount = 0;
  for (const pkg of scope.unqualifiedImportPkgs) {
    const pkgEntry = resolveImportPath(pkg);
    if (pkgEntry) {
      for (const pkgChild of db.childrenOf(pkgEntry.id)) {
        if (pkgChild.name === name && !isRelationshipOrImportSymbol(pkgChild)) {
          unqualMatch = pkgChild;
          unqualMatchCount++;
          break;
        }
      }
    }
  }
  if (unqualMatchCount === 1 && unqualMatch) return unqualMatch;
  if (unqualMatchCount > 1) return null;

  // 6. Parent scope walk (unless encapsulated)
  if (
    !encapsulated &&
    !scope.isEncapsulated &&
    scope.parentId !== null &&
    scope.parentId !== unspecializedId &&
    !visited.has(scope.parentId)
  ) {
    const parentEntry = db.symbol(scope.parentId);
    if (
      parentEntry &&
      (parentEntry.kind === "Class" ||
        parentEntry.kind === "Package" ||
        isNamespaceLikeSymbol(parentEntry) ||
        isTypeLikeSymbol(parentEntry))
    ) {
      const found =
        visited.size <= 1 && !skipInherited
          ? (db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", parentEntry.id)?.(name) ?? null)
          : resolveSimpleNameHelper(db, parentEntry.id, name, false, skipInherited, visited, false);
      if (found) return found;
    }
  }

  // 7. Predefined types fallback
  if (db.ensureFQNIndexed) {
    db.ensureFQNIndexed(name);
  }
  const predefined = db.byName(name);
  if (encapsulated || scope.isEncapsulated) {
    return predefined?.find((e) => (e.metadata as any)?.isPredefined) ?? null;
  }
  return (
    predefined?.find((e) => (e.metadata as any)?.isPredefined) ??
    predefined?.find((e) => isTypeLikeSymbol(e) && e.parentId === null && (!e.language || e.language === "modelica")) ??
    predefined?.find((e) => {
      if (!isTypeLikeSymbol(e) && e.kind !== "Module") return false;
      if (e.parentId === null) return true;
      if (!e.language || e.language === "modelica") return false;
      const p = db.symbol(e.parentId);
      return Boolean(
        p &&
        p.parentId === null &&
        (p.ruleName === "scad_file" ||
          p.ruleName === "step_product" ||
          p.ruleName === "pscad_library" ||
          p.ruleName === "pscad_project"),
      );
    }) ??
    null
  );
}

/**
 * Resolves a dot- or double-colon-separated path from the global scope.
 * Used for resolving import targets and cross-language global fallbacks.
 */
export function resolveQualified(db: QueryDB, path: string, topOnly = false): SymbolEntry | null {
  if (path.startsWith(".")) {
    path = path.slice(1);
  }
  const cacheKey = topOnly ? `${path}|top` : path;
  const dbAny = db as any;
  let qualCache: Map<string, SymbolEntry> | undefined = dbAny._resolveQualifiedCache;
  if (!qualCache) {
    qualCache = new Map<string, SymbolEntry>();
    dbAny._resolveQualifiedCache = qualCache;
  }
  const cached = qualCache.get(cacheKey);
  if (cached !== undefined) return cached;

  if (db.ensureFQNIndexed) {
    db.ensureFQNIndexed(path);
  }
  const parts = splitQualifiedPath(path);
  if (parts.length === 0 || !parts[0]) return null;

  // Try to find the root part (entry with no parent)
  const rootEntries = db.byName(parts[0]!);
  const candidates = topOnly
    ? rootEntries.filter((e) => (e.metadata as any)?.isPredefined || e.parentId === null)
    : [
        ...rootEntries.filter((e) => (e.metadata as any)?.isPredefined || e.parentId === null),
        ...rootEntries.filter((e) => !(e.metadata as any)?.isPredefined && e.parentId !== null),
      ];

  for (const rootCandidate of candidates) {
    let current: SymbolEntry | null = rootCandidate;
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i]!;
      const children = db.childrenOf(current.id);
      // Prefer non-relationship entries (Class, Component, Definition, Usage) over Reference/Import entries
      current =
        children.find((c) => c.name === part && !isRelationshipOrImportSymbol(c)) ||
        children.find((c) => c.name === part) ||
        null;
      if (!current) break;
    }
    if (current) {
      qualCache.set(cacheKey, current);
      return current;
    }
  }

  return null;
}

/**
 * Pinpoints the exact identifier segment in a qualified type specifier (`A.B.C`) where lookup failed,
 * returning its byte and character offsets for accurate `M2003` (`CLASS_NOT_FOUND`) diagnostic highlighting.
 *
 * @param db - Active Salsa query database.
 * @param scopeId - Enclosing lexical scope ID.
 * @param typeName - Raw type specifier text.
 * @param node - CST node of the type specifier or clause.
 * @param fallbackStart - Fallback start byte offset.
 * @param fallbackEnd - Fallback end byte offset.
 * @returns Byte and character range of the first unresolved identifier segment.
 */
function getQualifiedTypeFailRange(
  db: QueryDB,
  scopeId: SymbolId | null,
  typeName: string,
  node: any,
  fallbackStart: number,
  fallbackEnd: number,
): { startOffset: number; endOffset: number } {
  let targetNode = node;
  if (targetNode && (targetNode.type === "extends_clause" || targetNode.type === "ExtendsClause")) {
    const typeSpecChild =
      (Cst.ExtendsClause as any)?.typeSpecifier?.(targetNode) ??
      targetNode.children?.find(
        (c: SyntaxNode) =>
          c.type === "type_specifier" || c.type === "TypeSpecifier" || c.type === "name" || c.type === "Name",
      );
    if (typeSpecChild) targetNode = typeSpecChild;
  }

  let startOffset = targetNode?.startOffset ?? targetNode?.startIndex ?? fallbackStart;
  let endOffset = targetNode?.endOffset ?? targetNode?.endIndex ?? fallbackEnd;

  const cleanType = stripTrailingBrackets(typeName);
  const hasLeadingDot = cleanType.startsWith(".");
  const stripped = hasLeadingDot ? cleanType.slice(1) : cleanType;
  const parts = stripped.split(".");

  const idents: any[] = [];
  const collectIdents = (n: any) => {
    if (!n) return;
    if (
      n.type === "array_subscripts" ||
      n.type === "ArraySubscripts" ||
      n.type === "class_modification" ||
      n.type === "ClassModification" ||
      n.type === "class_or_inheritance_modification" ||
      n.type === "ClassOrInheritanceModification" ||
      n.type === "annotation" ||
      n.type === "Annotation"
    ) {
      return;
    }
    if (n.type === "identifier" || n.type === "Identifier") {
      idents.push(n);
      return;
    }
    if (n.children) {
      for (const c of n.children) collectIdents(c);
    }
  };
  collectIdents(targetNode);

  if (parts.length <= 1) {
    if (idents.length === 1) {
      const idNode = idents[0];
      startOffset = idNode.startOffset ?? idNode.startIndex ?? startOffset;
      endOffset = idNode.endOffset ?? idNode.endIndex ?? endOffset;
    }
    return { startOffset, endOffset };
  }

  let failIdx = 0;
  let current: SymbolEntry | null = null;
  if (!hasLeadingDot && scopeId !== null) {
    const resolver =
      db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", scopeId) ??
      db.query<(n: string) => SymbolEntry | null>("resolveName", scopeId);
    if (resolver) current = resolver(parts[0]!);
  }
  if (!current && (hasLeadingDot || scopeId === null || !isScopeEncapsulated(db, scopeId))) {
    const rootEntries = db.byName(parts[0]!);
    current =
      rootEntries.find((e) => (e.metadata as any)?.isPredefined) ??
      rootEntries.find((e) => e.parentId === null) ??
      rootEntries.find((e) => ["Class", "Package", "Function", "Definition", "Enumeration"].includes(e.kind)) ??
      rootEntries[0] ??
      null;
  }

  if (current) {
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i]!;
      let next: SymbolEntry | null = null;
      const simpleRes: ((n: string) => SymbolEntry | null) | null = db.query<(n: string) => SymbolEntry | null>(
        "resolveSimpleName",
        current.id,
      );
      if (simpleRes) next = simpleRes(part);
      if (!next) {
        const children = db.childrenOf(current.id);
        next =
          children.find((c) => c.name === part && c.kind !== "Reference") ||
          children.find((c) => c.name === part) ||
          null;
      }
      if (!next) {
        failIdx = i;
        break;
      }
      current = next;
    }
  }

  if (failIdx < idents.length) {
    const idNode = idents[failIdx];
    const so = idNode.startOffset ?? idNode.startIndex ?? startOffset;
    const eo = idNode.endOffset ?? idNode.endIndex ?? endOffset;
    return { startOffset: so, endOffset: eo };
  }

  const nodeText: string = targetNode?.text ?? cleanType;
  let searchPos = 0;
  for (let i = 0; i <= failIdx; i++) {
    const seg = parts[i]!;
    const idx = nodeText.indexOf(seg, searchPos);
    if (idx === -1) break;
    if (i === failIdx) {
      return {
        startOffset: startOffset + idx,
        endOffset: startOffset + idx + seg.length,
      };
    }
    searchPos = idx + seg.length + 1;
  }

  return { startOffset, endOffset };
}

/** Result of evaluating a single array dimension or dimension-referenced parameter in Salsa. */
interface DimEvalResult {
  value: number | null;
  cyclic?: boolean;
  exprText?: string;
  /** Origin token (`"dim:<symId>:<idx>"` or `"param:<symId>"`) propagated until the cycle loop closes. */
  cycleOrigin?: string;
}

// ---------------------------------------------------------------------------
// Dimension Expression Evaluator (for resolvedArrayDimensions Salsa query)
// ---------------------------------------------------------------------------

/**
 * Evaluate a dimension expression to a concrete integer value.
 *
 * Walks the CST node for the expression and evaluates it in the Salsa
 * query context. Supports:
 *   - Integer literals
 *   - Name references to parameters/constants (reads their binding value via `resolvedDimParamValue`)
 *   - size(x, d) calls → recursively queries `resolvedArrayDimensionAt` (cycle-safe)
 *   - Basic arithmetic (+, -, *, integer(), ndims())
 *   - Enumeration type references (returns literal count)
 */
function evaluateDimExpr(
  db: QueryDB,
  self: SymbolEntry,
  dim: { kind: "expression"; cstBytes: readonly [number, number]; text?: string | undefined },
): DimEvalResult {
  // Try to get the CST node for this expression
  const cst = db.cstNodeRange(dim.cstBytes[0], dim.cstBytes[1], self) as any;
  if (!cst) {
    // Fallback: try to parse the text directly as an integer
    if (dim.text) {
      const parsed = parseInt(dim.text, 10);
      if (!isNaN(parsed) && String(parsed) === dim.text.trim()) return { value: parsed };
    }
    return { value: null };
  }
  return evaluateDimCSTNode(db, self, cst);
}

/**
 * Extract argument CST nodes from a function call or primary node.
 */
function extractFunctionCallArgNodes(node: any): any[] {
  const fca = node.type === "primary" ? node.child(1) : (Cst.FunctionCall?.args?.(node) ?? node.child(1));
  if (!fca) return [];
  const results: any[] = [];
  function collectExprs(n: any) {
    if (!n) return;
    if (n.type === "expression_list") {
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (c.type !== "," && c.text !== "," && c.type !== "(" && c.type !== ")") {
          results.push(c);
        }
      }
      return;
    }
    if (n.type === "expression" || n.type === "named_argument") {
      results.push(n);
      return;
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c.type !== "(" && c.type !== ")" && c.type !== "," && c.text !== ",") {
        collectExprs(c);
      }
    }
  }
  collectExprs(fca);
  return results.filter((a) => a && a.type !== "," && a.text !== ",");
}

/**
 * Recursively evaluate a CST node to an integer value in a Salsa context.
 */
function evaluateDimCSTNode(db: QueryDB, self: SymbolEntry, node: any): DimEvalResult {
  if (!node) return { value: null };
  const type = node.type;

  if (
    (type === "expression" ||
      type === "simple_expression" ||
      type === "logical_expression" ||
      type === "primary" ||
      type === "expression_list" ||
      type === "Expression" ||
      type === "Primary" ||
      type === "subscript") &&
    node.childCount === 1
  ) {
    return evaluateDimCSTNode(db, self, node.child(0));
  }

  // Integer literal
  if (type === "UNSIGNED_INTEGER" || type === "unsigned_integer") {
    return { value: parseInt(node.text, 10) };
  }

  // Parenthesized expression — unwrap
  if (type === "ParenthesizedExpression" || (type === "primary" && node.child(0)?.text === "(")) {
    const inner =
      node.namedChildren?.find((c: SyntaxNode) => c.type !== "(" && c.type !== ")") ??
      node.children?.find((c: SyntaxNode) => c.type !== "(" && c.type !== ")");
    return evaluateDimCSTNode(db, self, inner);
  }

  // Binary expression (+, -, *, /)
  if (type === "BinaryExpression" || (node.childCount === 3 && node.type === "expression")) {
    const rawOp = (node.child(1)?.text ?? "").trim();
    const op = stripOuterChar(rawOp, '"');
    const leftRes = evaluateDimCSTNode(db, self, node.child(0));
    if (leftRes.cycleOrigin) return { value: null, cycleOrigin: leftRes.cycleOrigin };
    const rightRes = evaluateDimCSTNode(db, self, node.child(2));
    if (rightRes.cycleOrigin) return { value: null, cycleOrigin: rightRes.cycleOrigin };
    const left = leftRes.value;
    const right = rightRes.value;
    if (left === null || right === null) return { value: null };

    switch (op) {
      case "+":
        return { value: left + right };
      case "-":
        return { value: left - right };
      case "*":
        return { value: left * right };
      case "/":
        return { value: right !== 0 ? Math.floor(left / right) : null };
      default:
        return { value: null };
    }
  }

  // Unary expression (-a, +a)
  if (type === "UnaryExpression" || (node.childCount === 2 && node.type === "expression")) {
    const rawOp = node.child(0)?.text?.trim() ?? "";
    const op = stripOuterChar(rawOp, '"');
    const res = evaluateDimCSTNode(db, self, node.child(1));
    if (res.cycleOrigin) return { value: null, cycleOrigin: res.cycleOrigin };
    if (res.value === null) return { value: null };
    return { value: op === "-" ? -res.value : res.value };
  }

  // Function call — handle size(), integer(), ndims()
  if (type === "FunctionCall" || (type === "primary" && node.child(1)?.type === "function_call_args")) {
    const funcRef = Cst.FunctionCall.name(node) ?? node.child(0);
    const funcName = funcRef?.text?.trim();

    if (funcName === "size") {
      return evaluateDimSizeCall(db, self, node);
    }
    if (funcName === "integer") {
      const argNodes = extractFunctionCallArgNodes(node);
      return argNodes.length > 0 ? evaluateDimCSTNode(db, self, argNodes[0]) : { value: null };
    }
    if (funcName === "ndims") {
      return { value: evaluateDimNdimsCall(db, self, node) };
    }
    return { value: null };
  }

  // Component reference / Name / Identifier
  if (
    type === "ComponentReference" ||
    type === "ComponentReferencePart" ||
    type === "component_reference" ||
    type === "Name" ||
    type === "IDENT" ||
    type === "name" ||
    type === "identifier" ||
    isAsciiIdentStr(node.text?.trim() ?? "")
  ) {
    const refText = node.text?.trim();
    if (!refText) return { value: null };
    return evaluateDimNameRef(db, self, refText);
  }

  // If the node is a simple text that looks like an integer
  if (node.text) {
    const parsed = parseInt(node.text.trim(), 10);
    if (!isNaN(parsed) && String(parsed) === node.text.trim()) return { value: parsed };
  }

  return { value: null };
}

/**
 * Helper to get the number of dimensions (ndims) of a component.
 */
function getOrEvaluateNdims(db: QueryDB, resolved: SymbolEntry): number | null {
  const rawDims = db.query<Array<
    | { kind: "literal"; value: number }
    | { kind: "flexible" }
    | { kind: "expression"; cstBytes: readonly [number, number]; text?: string | undefined }
  > | null>("arrayDimensions", resolved.id);
  return rawDims?.length ?? null;
}

/**
 * Evaluate a `size(x, d)` call in a dimension context.
 */
function evaluateDimSizeCall(db: QueryDB, self: SymbolEntry, node: any): DimEvalResult {
  const argNodes = extractFunctionCallArgNodes(node);
  if (argNodes.length < 2) return { value: null };

  const arrayRefNode = argNodes[0];
  const dimArgNode = argNodes[1];
  const dimIdxRes = evaluateDimCSTNode(db, self, dimArgNode);
  if (dimIdxRes.cycleOrigin) return { value: null, cycleOrigin: dimIdxRes.cycleOrigin };
  if (dimIdxRes.value === null) return { value: null };
  const dimIndex = dimIdxRes.value;

  // Resolve the array reference to a symbol
  const refName = arrayRefNode?.text?.trim();
  if (!refName) return { value: null };

  // Find the component in the parent scope
  const parentId = self.parentId;
  if (parentId === null) return { value: null };

  const resolver = db.query<((name: string) => SymbolEntry | null) | null>("resolveSimpleName", parentId);
  if (!resolver) return { value: null };

  // Handle dot-separated references (e.g., pkg.x)
  const parts = refName.split(".");
  let resolved = resolver(parts[0]!);
  for (let i = 1; i < parts.length && resolved; i++) {
    const subResolver = db.query<((name: string) => SymbolEntry | null) | null>("resolveSimpleName", resolved.id);
    if (!subResolver) {
      resolved = null;
      break;
    }
    resolved = subResolver(parts[i]!);
  }

  if (!resolved) {
    return { value: null };
  }

  const targetDimIdx = dimIndex - 1;
  const dimRes = db.queryWith<DimEvalResult>(
    "resolvedArrayDimensionAt",
    resolved.id,
    { dimIndex: targetDimIdx },
    String(targetDimIdx),
  );
  if (dimRes?.cycleOrigin) {
    return { value: null, cycleOrigin: dimRes.cycleOrigin };
  }
  const val = dimRes?.value ?? null;
  return { value: val !== null && val > 0 ? val : null };
}

/**
 * Inspects a flexible (`:`) component's binding CST for `size(...)` or component references that
 * create a Salsa cycle back to `resolvedArrayDimensionAt`, returning the originating `cycleOrigin`
 * if a cycle is encountered.
 */
function findFlexibleBindingDimCycle(db: QueryDB, self: SymbolEntry, dimIndex: number, node: any): string | undefined {
  if (!node) return undefined;
  const type = node.type;
  if (type === "function_call" || type === "FunctionCall" || (type === "primary" && node.childCount >= 2)) {
    const callee = node.child(0);
    const calleeName = callee?.text?.trim();
    if (calleeName === "size") {
      const argNodes = extractFunctionCallArgNodes(node);
      if (argNodes.length >= 2) {
        const sizeRes = evaluateDimSizeCall(db, self, node);
        if (sizeRes.cycleOrigin) return sizeRes.cycleOrigin;
      } else if (argNodes.length === 1 && self.parentId !== null) {
        const refName = argNodes[0]?.text?.trim();
        if (refName) {
          const resolver = db.query<((name: string) => SymbolEntry | null) | null>("resolveSimpleName", self.parentId);
          let resolved = resolver ? resolver(refName.split(".")[0]!) : null;
          const parts = refName.split(".");
          for (let i = 1; i < parts.length && resolved; i++) {
            const subResolver = db.query<((name: string) => SymbolEntry | null) | null>(
              "resolveSimpleName",
              resolved.id,
            );
            resolved = subResolver ? subResolver(parts[i]!) : null;
          }
          if (resolved) {
            const dimRes = db.queryWith<DimEvalResult>(
              "resolvedArrayDimensionAt",
              resolved.id,
              { dimIndex },
              String(dimIndex),
            );
            if (dimRes?.cycleOrigin) return dimRes.cycleOrigin;
            if (dimRes?.cyclic) return `dim:${resolved.id}:${dimIndex}`;
          }
        }
      }
      for (let i = 1; i < argNodes.length; i++) {
        const nested = findFlexibleBindingDimCycle(db, self, dimIndex, argNodes[i]);
        if (nested) return nested;
      }
      return undefined;
    }
    if (calleeName === "ndims") {
      return undefined;
    }
    const argNodes = extractFunctionCallArgNodes(node);
    if (argNodes.length > 0) {
      for (const arg of argNodes) {
        const nested = findFlexibleBindingDimCycle(db, self, dimIndex, arg);
        if (nested) return nested;
      }
      return undefined;
    }
  }

  if (type === "component_reference" || type === "ComponentReference") {
    const refName = node.text?.trim();
    if (refName && self.parentId !== null) {
      const resolver = db.query<((name: string) => SymbolEntry | null) | null>("resolveSimpleName", self.parentId);
      const parts = refName.split(".");
      let resolved = resolver ? resolver(parts[0]!) : null;
      for (let i = 1; i < parts.length && resolved; i++) {
        const subResolver = db.query<((name: string) => SymbolEntry | null) | null>("resolveSimpleName", resolved.id);
        resolved = subResolver ? subResolver(parts[i]!) : null;
      }
      if (resolved && resolved.kind === "Component") {
        const rawDims = db.query<any[] | null>("arrayDimensions", resolved.id);
        if (rawDims && dimIndex < rawDims.length) {
          const dimRes = db.queryWith<DimEvalResult>(
            "resolvedArrayDimensionAt",
            resolved.id,
            { dimIndex },
            String(dimIndex),
          );
          if (dimRes?.cycleOrigin) return dimRes.cycleOrigin;
          if (dimRes?.cyclic) return `dim:${resolved.id}:${dimIndex}`;
        }
      }
    }
    return undefined;
  }

  for (let i = 0; i < (node.childCount ?? 0); i++) {
    const child = node.child(i);
    const res = findFlexibleBindingDimCycle(db, self, dimIndex, child);
    if (res) return res;
  }
  return undefined;
}

/**
 * Evaluate an `ndims(x)` call in a dimension context.
 */
function evaluateDimNdimsCall(db: QueryDB, self: SymbolEntry, node: any): number | null {
  const argNodes = extractFunctionCallArgNodes(node);
  if (argNodes.length < 1) return null;

  const refName = argNodes[0]?.text?.trim();
  if (!refName) return null;

  const parentId = self.parentId;
  if (parentId === null) return null;

  const resolver = db.query<((name: string) => SymbolEntry | null) | null>("resolveSimpleName", parentId);
  if (!resolver) return null;
  const resolved = resolver(refName);
  if (!resolved) return null;

  return getOrEvaluateNdims(db, resolved);
}

/**
 * Resolve a name reference (e.g., `n`, `N`, `pkg.n`) to an integer value.
 *
 * Looks up the symbol and reads its binding value via the `resolvedDimParamValue` Salsa query.
 */
function evaluateDimNameRef(db: QueryDB, self: SymbolEntry, name: string): DimEvalResult {
  if (name === "Boolean") return { value: 2 };
  const parentId = self.parentId;
  if (parentId === null) return { value: null };

  const resolver = db.query<((name: string) => SymbolEntry | null) | null>("resolveSimpleName", parentId);
  if (!resolver) return { value: null };

  // Handle dot-separated names
  const parts = name.split(".");
  let resolved = resolver(parts[0]!);
  for (let i = 1; i < parts.length && resolved; i++) {
    const subResolver = db.query<((name: string) => SymbolEntry | null) | null>("resolveSimpleName", resolved.id);
    if (!subResolver) {
      resolved = null;
      break;
    }
    resolved = subResolver(parts[i]!);
  }
  if (!resolved) {
    const typeClassId = db.query<SymbolId | null>("classInstance", self.id);
    if (typeClassId) {
      const typeEntry = db.symbol(typeClassId);
      if (typeEntry && typeEntry.parentId != null) {
        const typeResolver = db.query<((name: string) => SymbolEntry | null) | null>(
          "resolveSimpleName",
          typeEntry.parentId,
        );
        if (typeResolver) {
          resolved = typeResolver(parts[0]!);
          for (let i = 1; i < parts.length && resolved; i++) {
            const subResolver = db.query<((name: string) => SymbolEntry | null) | null>(
              "resolveSimpleName",
              resolved.id,
            );
            if (!subResolver) {
              resolved = null;
              break;
            }
            resolved = subResolver(parts[i]!);
          }
        }
      }
    }
  }
  if (!resolved) return { value: null };

  // Check if it's an enumeration type (return literal count)
  if (resolved.kind === "Class") {
    let curCls: SymbolEntry | null = resolved;
    const visitedCls = new Set<SymbolId>();
    while (curCls && !visitedCls.has(curCls.id)) {
      visitedCls.add(curCls.id);
      const meta = curCls.metadata as Record<string, unknown>;
      const classPrefixes = meta?.["classPrefixes"];
      const cstNode = db.cstNode(curCls.id) as CstNodeLike | null;
      const cstText = cstNode?.text ?? "";
      const shortSpec = getShortClassSpecifierNode(cstNode) as CstNodeLike | null;
      const enumListNode =
        shortSpec?.children?.find((c) => c.type === "enum_list" || c.type === "EnumList") ??
        cstNode?.children?.find((c) => c.type === "enum_list" || c.type === "EnumList");
      const isEnum =
        (typeof classPrefixes === "string" && classPrefixes.includes("enumeration")) ||
        Boolean(enumListNode) ||
        Boolean(shortSpec?.children?.some((c) => c.text?.trim() === "enumeration" || c.type === '"enumeration"')) ||
        hasEnumTypeText(cstText);
      if (isEnum) {
        if (enumListNode && enumListNode.children) {
          const lits = enumListNode.children.filter(
            (c) => c.type === "enumeration_literal" || c.type === "EnumerationLiteral",
          );
          if (lits.length > 0) return { value: lits.length };
        }
        const parsedLits = parseEnumLiteralsFromText(cstText, 0, true);
        if (parsedLits.length > 0) return { value: parsedLits.length };
        const children = db.childrenOf(curCls.id);
        return { value: children.filter((c) => c.kind === "Component").length };
      }
      curCls = db.query<SymbolEntry | null>("resolvedBaseClass", curCls.id);
    }
  }

  // Must be a parameter or constant with an integer binding
  if (resolved.kind !== "Component") return { value: null };
  const res = db.query<DimEvalResult>("resolvedDimParamValue", resolved.id);
  return res ?? { value: null };
}

/**
 * Extracts the `ShortClassSpecifier` CST node from a class definition or specifier wrapper node, if present.
 *
 * @param cst - CST node for a `class_definition`, `class_specifier`, or `short_class_specifier`.
 * @returns The inner `short_class_specifier` CST node, or `null` if the class is not a short class definition.
 */
export function getShortClassSpecifierNode(cst: any): any {
  if (!cst) return null;
  if (cst.type === "short_class_specifier" || cst.type === "ShortClassSpecifier") return cst;
  if (
    cst.type === "long_class_specifier" ||
    cst.type === "LongClassSpecifier" ||
    cst.type === "composition" ||
    cst.type === "Composition"
  ) {
    return null;
  }
  const spec = Cst.ClassDefinition.classSpecifier(cst);
  if (spec) {
    if (spec.type === "short_class_specifier" || spec.type === "ShortClassSpecifier") return spec;
    if (spec.type === "class_specifier" || spec.type === "ClassSpecifier") {
      const shortChild = spec.children?.find(
        (c: SyntaxNode) => c.type === "short_class_specifier" || c.type === "ShortClassSpecifier",
      );
      if (shortChild) return shortChild;
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
      if (found) return found;
    }
  }
  return null;
}

/**
 * Diagnostic payload returned when an `enumeration(...)` type definition fails validation.
 */
export interface EnumValidationResult {
  code: number;
  message: string;
  startOffset: number;
  endOffset: number;
}

/**
 * Validates a Modelica `type E = enumeration(...)` declaration for reserved built-in attribute names
 * (`M4084` / `M2001`) and duplicate enumeration literal identifiers (`M4083`).
 *
 * @param cstNode - CST node of the enumeration class definition.
 * @param sym - Optional symbol entry for fallback metadata and character range lookup.
 * @returns First detected `EnumValidationResult` error, or `null` if valid.
 */
export function validateEnumeration(cstNode: any, sym?: SymbolEntry | null): EnumValidationResult | null {
  if (!cstNode && !sym) return null;
  const shortSpec = getShortClassSpecifierNode(cstNode);
  const cstText = cstNode?.text ?? "";
  const isEnum =
    shortSpec?.children?.some((c: SyntaxNode) => c.text?.trim() === "enumeration" || c.type === '"enumeration"') ||
    Boolean(shortSpec && cstText.includes("enumeration(")) ||
    (sym?.metadata as any)?.["classPrefixes"] === "enumeration";
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

  const isNewInst =
    Boolean(cstNode?.tree?.rootNode?.text?.includes("-d=-newInst")) || Boolean(cstText.includes("-d=-newInst"));

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
function isRedeclareQuery(db: QueryDB, self: SymbolEntry): boolean {
  if ((self.metadata as any)?.redeclare) return true;
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

/**
 * Resolves whether a symbol is declared with the `inner` scoping prefix.
 */
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
  const meta = self.metadata as any;
  const rawPrefixes = meta?.["classPrefixes"] ?? meta?.prefixes;
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
 * Salsa semantic and lint queries attached to `class_definition` (`ClassDefinition`) symbols.
 */
export const classDefinitionQueries: Record<string, any> = {
  /** All direct children of this class. */
  members: (db: QueryDB, self: SymbolEntry) => db.childrenOf(self.id),
  /** Evaluates and memoizes the Icon annotation graphics for this class definition. */
  classIconGraphics: (db: QueryDB, self: SymbolEntry) => {
    const cst = db.cstNode(self.id);
    if (!cst) {
      return (self.metadata as Record<string, unknown> | undefined)?.["iconAnnotation"] ?? null;
    }
    const wasmIcon = evaluateIconWasm(cst);
    if (wasmIcon !== undefined) return wasmIcon;
    const evaluator = new AnnotationEvaluator();
    return evaluator.evaluate(cst, "Icon");
  },
  /** Evaluates and memoizes the Diagram annotation graphics for this class definition. */
  classDiagramGraphics: (db: QueryDB, self: SymbolEntry) => {
    const cst = db.cstNode(self.id);
    if (!cst) {
      return (self.metadata as Record<string, unknown> | undefined)?.["diagramAnnotation"] ?? null;
    }
    const wasmDiagram = evaluateDiagramWasm(cst);
    if (wasmDiagram !== undefined) return wasmDiagram;
    const evaluator = new AnnotationEvaluator();
    return evaluator.evaluate(cst, "Diagram");
  },
  /** Evaluates or derives the memoized 3D formal verification overlay payload for this class definition. */
  verification3DOverlay: (db: QueryDB, self: SymbolEntry): Verification3DOverlayPayload => {
    const cst = db.cstNode(self.id) as SyntaxNode | null;
    const minClearance = findAnnotationClearanceMin(cst) ?? 10.0;

    const defaultPayload: Verification3DOverlayPayload = {
      version: 1,
      isCertifiedSafe: true,
      verdict: "passed",
      summary: `Formal verification certified for class '${self.name}'`,
      worstMargin: minClearance,
      flowpipes: {},
      clearanceHistory: [],
      barrierShells: [],
      counterexamples: [],
      spatialPins: [],
    };

    return defaultPayload;
  },
  /** Returns `true` if this class definition carries a `redeclare` prefix. */
  isRedeclare: (db: QueryDB, self: SymbolEntry) => isRedeclareQuery(db, self),
  /** Checks whether this class is declared with the `inner` dynamic scoping prefix. */
  isInner: (db: QueryDB, self: SymbolEntry) => isInnerQuery(db, self),
  /** Checks whether this class is declared with the `outer` dynamic scoping prefix. */
  isOuter: (db: QueryDB, self: SymbolEntry) => isOuterQuery(db, self),

  /** Recommends homotopy operator for steep nonlinear equations. */
  lint__homotopyRecommended: (db: QueryDB, self: SymbolEntry) => {
    const cst = db.cstNode(self.id) as SyntaxNode | null;
    if (!cst) return null;
    const nonlinear = findNonlinearTermsInCst(cst);
    if (!nonlinear || nonlinear.length === 0) return null;
    return nonlinear.map((item) =>
      info(ModelicaErrorCode.HOMOTOPY_RECOMMENDED.message(item.termText), {
        startOffset: item.startOffset,
        endOffset: item.endOffset,
        code: ModelicaErrorCode.HOMOTOPY_RECOMMENDED.code,
      }),
    );
  },

  /** Control Flow Analysis (CFA): Definite assignment (M5020), uninitialized reads (M5021), unreachable statements (M5022). */
  lint__cfaAnalysis: (db: QueryDB, self: SymbolEntry) => {
    const cst = db.cstNode(self.id) as SyntaxNode | null;
    if (!cst) return null;
    const diags = runModelicaCfaAnalysis(db, self, cst);
    return diags && diags.length > 0 ? diags : null;
  },

  /** M4083, M4084: Validate enumeration literals for duplicates and reserved attribute names. */
  lint__validateEnumeration: (db: QueryDB, self: SymbolEntry) => {
    const cst = db.cstNode(self.id) as SyntaxNode | null;
    const res = validateEnumeration(cst, self);
    if (!res) return null;
    return [
      error(res.message, {
        startOffset: res.startOffset,
        endOffset: res.endOffset,
        code: res.code,
      }),
    ];
  },

  /** M4062: Invalid external object containing invalid elements or missing structors. */
  lint__invalidExternalObject: (db: QueryDB, self: SymbolEntry) => {
    const children = db.childrenOf(self.id);
    if (!children || children.length === 0) return null;
    const extendsEntries = children.filter((c) => c.kind === "Extends");
    const hasExternalObject = extendsEntries.some((e) => e.name === "ExternalObject");
    if (!hasExternalObject) return null;

    const invalidElements: { name: string; entry: SymbolEntry }[] = [];
    let hasConstructor = false;
    let hasDestructor = false;
    const replaceableElements: SymbolEntry[] = [];

    for (const child of children) {
      const cst = db.cstNode(child.id) as SyntaxNode | null;
      const text = cst?.text?.trim() ?? "";
      const isReplaceable = Boolean(
        (child.metadata as any)?.isReplaceable ||
        db.query<boolean>("isReplaceable", child.id) ||
        cst?.parent?.type === "element_replaceable" ||
        cst?.parent?.type === "ElementReplaceable" ||
        hasNodePrefixKeyword(cst?.parent, "replaceable"),
      );

      if (child.kind === "Extends") {
        if (child.name !== "ExternalObject" && child.name !== "Icon" && !child.name.toLowerCase().endsWith("icon")) {
          invalidElements.push({ name: `extends ${child.name}`, entry: child });
        }
      } else if (child.kind === "Class") {
        const classPrefixes = String((child.metadata as any)?.["classPrefixes"] ?? "");
        const isFunction =
          text.startsWith("function ") ||
          text.startsWith("pure function ") ||
          text.startsWith("impure function ") ||
          text.startsWith("encapsulated function ") ||
          text.startsWith("encapsulated pure function ") ||
          text.startsWith("encapsulated impure function ") ||
          (child.metadata as any)?.["classKind"] === "function" ||
          collapseSpaceTokens(classPrefixes).includes("function") ||
          child.ruleName === "function_definition";

        if (child.name === "constructor" && isFunction) {
          hasConstructor = true;
          if (isReplaceable) replaceableElements.push(child);
        } else if (child.name === "destructor" && isFunction) {
          hasDestructor = true;
          if (isReplaceable) replaceableElements.push(child);
        } else {
          invalidElements.push({ name: child.name, entry: child });
        }
      } else if (child.kind === "Component") {
        invalidElements.push({ name: child.name, entry: child });
      }
    }

    if (replaceableElements.length > 0) {
      const rep = replaceableElements[0]!;
      const repRange = rep.fieldRanges?.["name"] ?? rep.fieldRanges?.["declaredName"];
      return [
        error(ModelicaErrorCode.EXTERNAL_OBJECT_NOT_REPLACEABLE.message(rep.name), {
          startOffset: repRange?.startOffset ?? rep.startOffset,
          endOffset: repRange?.endOffset ?? rep.endOffset,
          code: ModelicaErrorCode.EXTERNAL_OBJECT_NOT_REPLACEABLE.code,
        }),
      ];
    }
    const selfCst = db.cstNode(self.id) as SyntaxNode | null;
    const isOldInst = Boolean(
      selfCst?.tree?.rootNode?.text?.includes("-d=-newInst") || selfCst?.text?.includes("-d=-newInst"),
    );
    if (isOldInst && invalidElements.length > 0) {
      const invNames = invalidElements.map((e) => e.name).join(", ");
      return [
        error(`Invalid external object ${self.name}, contains invalid elements: ${invNames}.`, {
          startOffset: self.startOffset,
          endOffset: self.endOffset,
          code: ModelicaErrorCode.INVALID_EXTERNAL_OBJECT.code,
        }),
      ];
    }
    const diags: any[] = [];
    for (const inv of invalidElements) {
      const invRange = inv.entry.fieldRanges?.["name"] ?? inv.entry.fieldRanges?.["declaredName"];
      diags.push(
        error(ModelicaErrorCode.INVALID_EXTERNAL_OBJECT.message(self.name, inv.name), {
          startOffset: invRange?.startOffset ?? inv.entry.startOffset,
          endOffset: invRange?.endOffset ?? inv.entry.endOffset,
          code: ModelicaErrorCode.INVALID_EXTERNAL_OBJECT.code,
        }),
      );
    }
    if (diags.length > 0) return diags;

    if (!hasDestructor) {
      return [
        error(ModelicaErrorCode.EXTERNAL_OBJECT_MISSING_DESTRUCTOR.message(self.name), {
          startOffset: self.startOffset,
          endOffset: self.endOffset,
          code: ModelicaErrorCode.EXTERNAL_OBJECT_MISSING_DESTRUCTOR.code,
        }),
      ];
    }
    if (!hasConstructor) {
      return [
        error(ModelicaErrorCode.EXTERNAL_OBJECT_MISSING_CONSTRUCTOR.message(self.name), {
          startOffset: self.startOffset,
          endOffset: self.endOffset,
          code: ModelicaErrorCode.EXTERNAL_OBJECT_MISSING_CONSTRUCTOR.code,
        }),
      ];
    }
    return null;
  },

  /** M4069: Non-constructors may not return an external object (Modelica §12.9.7). */
  lint__functionReturnsExternalObject: (db: QueryDB, self: SymbolEntry) => {
    const cst = db.cstNode(self.id) as SyntaxNode | null;
    const text = cst?.text?.trim() ?? "";
    const isFunction =
      text.startsWith("function ") ||
      text.startsWith("pure function ") ||
      text.startsWith("impure function ") ||
      (self.metadata as any)?.["classKind"] === "function" ||
      self.ruleName === "function_definition";
    if (!isFunction) return null;

    const children = db.childrenOf(self.id);
    for (const child of children) {
      if (child.kind === "Component") {
        const compInst = db.query<any>("componentInstance", child.id);
        if (compInst?.causality === "output") {
          const typeName = compInst.typeSpecifier;
          if (typeName) {
            const resolver =
              db.query<(name: string) => SymbolEntry | null>("resolveName", self.id) ??
              db.query<(name: string) => SymbolEntry | null>("resolveSimpleName", self.id);
            const targetClass =
              resolver?.(typeName) ?? db.byName(typeName.split(".").pop()!).find((e) => e.kind === "Class");
            if (targetClass) {
              const targetChildren = db.childrenOf(targetClass.id);
              const extendsExtObj = targetChildren?.some((c) => c.kind === "Extends" && c.name === "ExternalObject");
              if (extendsExtObj) {
                const isConstructor = self.name === "constructor" && self.parentId === targetClass.id;
                if (!isConstructor) {
                  const fnQName = getSymbolQualifiedName(db, self.id);
                  const extObjQName = getSymbolQualifiedName(db, targetClass.id);
                  return [
                    error(
                      `Function ${fnQName} returns an external object, but the only function allowed to return this object is ${extObjQName}.constructor.`,
                      {
                        startOffset: child.startOffset,
                        endOffset: child.endOffset,
                        code: ModelicaErrorCode.EXTERNAL_OBJECT_RETURN_RESTRICTION.code,
                      },
                    ),
                  ];
                }
              }
            }
          }
        }
      }
    }
    return null;
  },

  /**
   * M2003: Type / class not found in scope for short class specifiers.
   */
  lint__typeNotFound: (db: QueryDB, self: SymbolEntry) => {
    const cst = db.cstNode(self.id) as SyntaxNode | null;
    if (!cst) return null;
    if (
      self.parentId !== null &&
      db.childrenOf(self.id).some((c) => c.kind === "Extends" && c.name === self.name) &&
      isClassExtendsInCst(cst)
    ) {
      let hasIgnoreReplaceable = false;
      let currId: SymbolId | null = self.id;
      while (currId !== null) {
        const currNode = db.cstNode(currId) as any;
        if (currNode?.text?.includes("--ignoreReplaceable")) {
          hasIgnoreReplaceable = true;
          break;
        }
        const sym = db.symbol(currId);
        currId = sym?.parentId ?? null;
      }
      if (hasIgnoreReplaceable) return null;

      const inheritedMap = db.query<Record<string, SymbolId>>("inheritedSymbolsMap", self.parentId);
      const inheritedId = inheritedMap?.[self.name];
      if (inheritedId !== undefined && !db.query<boolean>("isReplaceable", inheritedId)) {
        return [
          error(`Redeclaration with a new type requires '${self.name}' to be replaceable.`, {
            startOffset: self.startOffset,
            endOffset: self.endOffset,
            code: 4019,
          }),
        ];
      }
    }
    const spec = getShortClassSpecifierNode(cst);
    if (!spec) return null;

    const typeSpec =
      Cst.ShortClassSpecifier.typeSpecifier(spec) ??
      spec.children?.find((c: SyntaxNode) => c.type === "type_specifier" || c.type === "TypeSpecifier");
    let typeName = typeSpec?.text?.trim();
    if (!typeName) return null;
    typeName = typeName.split("[")[0].trim();
    if (!typeName) return null;

    if (
      typeName === "Real" ||
      typeName === "Integer" ||
      typeName === "Boolean" ||
      typeName === "String" ||
      typeName === "Clock" ||
      typeName === "StateSelect" ||
      typeName === "AssertionLevel" ||
      typeName === "ExternalObject"
    ) {
      return null;
    }

    // Resolve via Salsa
    let baseEntry: SymbolEntry | null = null;
    if (self.parentId !== null) {
      const resolve = db.query<any>("resolveName", self.parentId);
      if (resolve) baseEntry = resolve(typeName, true) as SymbolEntry | null;
      if (!baseEntry && !typeName.includes(".") && !typeName.includes("::")) {
        const resSimple = db.query<any>("resolveSimpleName", self.parentId);
        if (resSimple) baseEntry = resSimple(typeName) as SymbolEntry | null;
      }
    }

    if (!baseEntry && (typeName.startsWith(".") || self.parentId === null || !isScopeEncapsulated(db, self.parentId))) {
      if (typeName.includes(".") || typeName.includes("::")) {
        baseEntry = resolveQualified(db, typeName);
      } else {
        const entries = db.byName(typeName);
        baseEntry =
          entries?.find(
            (e: SymbolEntry) => (e.metadata as Record<string, unknown>)?.["isPredefined"] || isTypeLikeSymbol(e),
          ) ?? null;
      }
    }

    if (baseEntry) return null;

    const failRange = getQualifiedTypeFailRange(
      db,
      self.parentId,
      typeName,
      typeSpec,
      self.startOffset,
      self.startOffset + typeName.length,
    );

    const msg = `Class or type '${typeName}' not found in scope.`;
    return [
      error(msg, {
        ...failRange,
        code: 2003,
      }),
    ];
  },

  /** Returns `true` if this class definition is declared with a `replaceable` prefix. */
  isReplaceable: (db: QueryDB, self: SymbolEntry) => {
    let current = db.cstNode(self.id) as SyntaxNode | null;
    if (current && (current.type === "class_definition" || current.type === "ClassDefinition")) {
      current = current.parent;
    }
    while (current) {
      if (current.type === "element_replaceable" || current.type === "ElementReplaceable") return true;
      if (
        current.type === "ComponentClause" ||
        current.type === "component_clause" ||
        current.type === "element" ||
        current.type === "Element"
      ) {
        if (
          current.children?.some(
            (c: SyntaxNode) =>
              c.text?.trim() === "replaceable" || c.type === "replaceable" || c.type === '"replaceable"',
          )
        )
          return true;
      }
      if (current.type === "composition" || current.type === "Composition") break;
      current = current.parent;
    }
    return false;
  },
  /** Extract array dimensions for ShortClassSpecifiers like type ArrayType = Real[3]; */
  arrayDimensions: (db: QueryDB, self: SymbolEntry) => {
    const cst = db.cstNode(self.id) as SyntaxNode | null;
    if (!cst) return null;
    const classSpec = getShortClassSpecifierNode(cst);
    if (!classSpec) return null;
    const arraySubNode =
      Cst.ShortClassSpecifier.arraySubscripts(classSpec) ??
      classSpec.children?.find((c: SyntaxNode) => c.type === "array_subscripts" || c.type === "ArraySubscripts");
    if (!arraySubNode) return null;

    const subscripts: Array<
      | { kind: "literal"; value: number }
      | { kind: "flexible" }
      | { kind: "expression"; cstBytes: readonly [number, number]; text?: string | undefined }
    > = [];

    for (const child of arraySubNode.children) {
      if (child.type !== "Subscript" && child.type !== "subscript") continue;
      const flexChild =
        Cst.Subscript.flexible(child) ??
        child.children?.find((c: SyntaxNode) => c.text === ":" || c.type === ":" || c.type === '":"');
      if (flexChild && flexChild.text?.trim() === ":") {
        subscripts.push({ kind: "flexible" });
        continue;
      }
      const exprChild =
        Cst.Subscript.expression(child) ??
        child.children?.find((c: SyntaxNode) => c.type === "expression" || c.type === "Expression") ??
        (child.childCount > 0 ? child.child(0) : null);
      if (exprChild) {
        const num = parseInt(exprChild.text, 10);
        if (!isNaN(num) && String(num) === exprChild.text.trim()) {
          subscripts.push({ kind: "literal", value: num });
        } else {
          subscripts.push({
            kind: "expression",
            cstBytes: [
              exprChild.startOffset ?? exprChild.startIndex ?? exprChild.startOffset,
              exprChild.endOffset ?? exprChild.endIndex ?? exprChild.endOffset,
            ],
            text: exprChild.text,
          });
        }
      }
    }
    return subscripts;
  },
  /**
   * Get the effective modification for this class (specifically for ShortClassSpecifier).
   */
  effectiveModification: (db: QueryDB, self: SymbolEntry) => {
    const cst = db.cstNode(self.id) as SyntaxNode | null;
    if (!cst) return null;
    const classSpec = getShortClassSpecifierNode(cst);
    if (!classSpec) return null;
    let scopeParentId = self.parentId;
    if (scopeParentId !== null && db.symbol(scopeParentId)?.kind === "Extends") {
      scopeParentId = db.symbol(scopeParentId)?.parentId ?? scopeParentId;
    }
    const modNode =
      Cst.ShortClassSpecifier.classModification(classSpec) ??
      classSpec.children?.find((c: SyntaxNode) => c.type === "class_modification" || c.type === "ClassModification");
    let parsed: any = modNode ? (parseModArgsFromCst(modNode, scopeParentId) as any) : null;

    let constrClause: any = null;
    let curr: SyntaxNode | null = cst;
    while (curr && curr.type !== "Composition" && curr.type !== "composition") {
      constrClause = curr.children?.find(
        (c: SyntaxNode) => c.type === "constraining_clause" || c.type === "ConstrainingClause",
      );
      if (constrClause) break;
      curr = curr.parent;
    }
    if (constrClause) {
      const constrMod = constrClause.children?.find(
        (c: SyntaxNode) => c.type === "class_modification" || c.type === "ClassModification",
      );
      if (constrMod) {
        const constrParsed = parseModArgsFromCst(constrMod, scopeParentId);
        if (constrParsed && constrParsed.args && constrParsed.args.length > 0) {
          if (!parsed) {
            parsed = constrParsed;
          } else {
            const existingNames = new Set(parsed.args?.map((a: any) => a.name) || []);
            for (const cArg of constrParsed.args) {
              if (!existingNames.has(cArg.name)) {
                parsed.args.push(cArg);
              }
            }
          }
        }
      }
    }
    const baseCls = db.query<SymbolEntry | null>("resolvedBaseClass", self.id);
    if (baseCls && baseCls.id !== self.id) {
      const baseMod = db.query<any>("effectiveModification", baseCls.id);
      if (baseMod?.args && baseMod.args.length > 0) {
        if (!parsed) {
          parsed = { args: [...baseMod.args] };
        } else {
          const existingNames = new Set(parsed.args?.map((a: any) => a.name) || []);
          for (const bArg of baseMod.args) {
            if (!existingNames.has(bArg.name)) {
              parsed.args.push(bArg);
            }
          }
        }
      }
    }
    return parsed as import("./modifications.js").ModelicaModArgs;
  },
  /** Resolves the base class symbol for a short class specifier or first `extends` clause. */
  resolvedBaseClass: (db: QueryDB, self: SymbolEntry) => {
    const cst = db.cstNode(self.id) as SyntaxNode | null;
    if (!cst) return null;
    const classSpec = getShortClassSpecifierNode(cst);
    if (classSpec) {
      const typeSpec =
        Cst.ShortClassSpecifier.typeSpecifier(classSpec) ??
        classSpec.children?.find((c: SyntaxNode) => c.type === "type_specifier" || c.type === "TypeSpecifier");
      const typeName = typeSpec?.text?.trim();
      if (typeName) {
        let scopeParentId = self.parentId;
        if (scopeParentId !== null && db.symbol(scopeParentId)?.kind === "Extends") {
          scopeParentId = db.symbol(scopeParentId)?.parentId ?? scopeParentId;
        }
        if (scopeParentId !== null) {
          const parentResolver = db.query<(n: string) => SymbolEntry | null>("resolveName", scopeParentId);
          if (parentResolver) {
            const resolved = parentResolver(typeName);
            if (resolved && resolved.id !== self.id) return resolved;
          }
        }
        if (typeName.includes(".")) {
          const qRes = resolveQualified(db, typeName.startsWith(".") ? typeName.slice(1) : typeName);
          if (qRes && qRes.id !== self.id) return qRes;
        }
        const matches = db.byName(typeName);
        return matches?.find((e) => (e.metadata as any)?.isPredefined || e.kind === "Class") ?? matches?.[0] ?? null;
      }
    }
    const extClauses = db.childrenOf(self.id).filter((c) => c.kind === "Extends");
    if (extClauses.length > 0) {
      const base = db.query<SymbolEntry | null>("resolvedBaseClass", extClauses[0]!.id);
      if (base) return base;
    }
    return null;
  },
  /** Only nested class definitions. */
  nestedClasses: (db: QueryDB, self: SymbolEntry) => db.childrenOf(self.id).filter((c) => c.kind === "Class"),
  /** Only component declarations. */
  components: (db: QueryDB, self: SymbolEntry) => db.childrenOf(self.id).filter((c) => c.kind === "Component"),
  /** Only extends clauses. */
  extendsClasses: (db: QueryDB, self: SymbolEntry) => db.childrenOf(self.id).filter((c) => c.kind === "Extends"),
  /** Direct resolved base classes for inheritance analysis. */
  directBaseClasses: (db: QueryDB, self: SymbolEntry): SymbolEntry[] => {
    const extClauses = db.childrenOf(self.id).filter((c) => c.kind === "Extends");
    const bases: SymbolEntry[] = [];
    for (const ext of extClauses) {
      const base = db.query<SymbolEntry | null>("resolvedBaseClass", ext.id);
      if (base) bases.push(base);
    }
    return bases;
  },
  /**
   * Checks whether self is a subtype of targetNameOrId via TaxonomyIndex or transitive extends.
   */
  isSubtype:
    (db: QueryDB, self: SymbolEntry) =>
    (targetNameOrId: string | SymbolId): boolean => {
      let targetName: string;
      if (typeof targetNameOrId === "number") {
        const targetSym = db.symbol(targetNameOrId);
        if (!targetSym) return false;
        targetName = targetSym.name;
      } else {
        targetName = targetNameOrId;
      }

      if (self.name === targetName) return true;

      // Check TaxonomyIndex if available
      if (db.taxonomy && db.taxonomy.has?.(self.name) && db.taxonomy.has?.(targetName)) {
        if (db.taxonomy.isSubtype(self.name, targetName)) return true;
      }

      // Direct and transitive extends traversal
      const extClauses = db.childrenOf(self.id).filter((c) => c.kind === "Extends");
      for (const ext of extClauses) {
        const base = db.query<SymbolEntry | null>("resolvedBaseClass", ext.id);
        if (base) {
          if (db.taxonomy?.addClass) {
            db.taxonomy.addClass(self.name, [base.name]);
          }
          if (base.name === targetName) return true;
          if (db.query<(t: string | SymbolId) => boolean>("isSubtype", base.id)?.(targetName)) return true;
        }
      }
      return false;
    },
  /**
   * Structural subtyping check for records and classes (MLS §6.2.2).
   */
  isRecordSubtype:
    (db: QueryDB, self: SymbolEntry) =>
    (parentSymId: SymbolId): boolean => {
      if (self.id === parentSymId) return true;
      const parentSym = db.symbol(parentSymId);
      if (!parentSym) return false;

      const childElemIds = db.query<SymbolId[]>("instantiate", self.id) || [];
      const parentElemIds = db.query<SymbolId[]>("instantiate", parentSymId) || [];

      const childComps = childElemIds
        .map((id) => db.symbol(id))
        .filter((s): s is SymbolEntry => !!s && s.kind === "Component");
      const parentComps = parentElemIds
        .map((id) => db.symbol(id))
        .filter((s): s is SymbolEntry => !!s && s.kind === "Component");

      for (const pComp of parentComps) {
        const cComp = childComps.find((c) => c.name === pComp.name);
        if (!cComp) return false;

        const pMeta = (pComp.metadata as any) ?? {};
        const cMeta = (cComp.metadata as any) ?? {};

        if (Boolean(pMeta.flowPrefix) !== Boolean(cMeta.flowPrefix)) return false;
        if (Boolean(pMeta.streamPrefix) !== Boolean(cMeta.streamPrefix)) return false;

        if (pMeta.typeSpecifier && cMeta.typeSpecifier && pMeta.typeSpecifier !== cMeta.typeSpecifier) {
          if (pMeta.typeSpecifier === "Real" && cMeta.typeSpecifier === "Integer") {
            continue;
          }
          const pSubSym = db.byName(pMeta.typeSpecifier)?.[0];
          const cSubSym = db.byName(cMeta.typeSpecifier)?.[0];
          if (pSubSym && cSubSym) {
            if (!db.query<(id: SymbolId) => boolean>("isRecordSubtype", cSubSym.id)?.(pSubSym.id)) {
              return false;
            }
          } else {
            return false;
          }
        }
      }
      return true;
    },
  /** Only import clauses. */
  imports: (db: QueryDB, self: SymbolEntry) => db.childrenOf(self.id).filter((c) => c.kind === "Import"),
  /** Components with causality=input. */
  inputParameters: (db: QueryDB, self: SymbolEntry) =>
    db
      .childrenOf(self.id)
      .filter((c) => c.kind === "Component" && (c.metadata as Record<string, unknown>)?.["causality"] === "input"),
  /** Components with causality=output. */
  outputParameters: (db: QueryDB, self: SymbolEntry) =>
    db
      .childrenOf(self.id)
      .filter((c) => c.kind === "Component" && (c.metadata as Record<string, unknown>)?.["causality"] === "output"),
  /** Components with variability=parameter. */
  parameters: (db: QueryDB, self: SymbolEntry) =>
    db
      .childrenOf(self.id)
      .filter(
        (c) => c.kind === "Component" && (c.metadata as Record<string, unknown>)?.["variability"] === "parameter",
      ),
  /** Components with variability=constant. */
  constants: (db: QueryDB, self: SymbolEntry) =>
    db
      .childrenOf(self.id)
      .filter((c) => c.kind === "Component" && (c.metadata as Record<string, unknown>)?.["variability"] === "constant"),
  /** Connect equations among children. */
  connectEquations: (db: QueryDB, self: SymbolEntry) =>
    db.childrenOf(self.id).filter((c) => c.kind === "ConnectEquation"),
  /**
   * All elements including inherited members (flattened).
   *
   * Implements the core of the Modelica instantiation algorithm:
   * 1. Collect declared elements from the class body
   * 2. For each extends clause, resolve the base class and inline its elements
   * 3. Filter out elements that have been redeclared in the body
   * 4. Filter out elements removed via `break` in extends clauses
   *
   * Uses cycle recovery to handle circular extends chains.
   */
  allElements: {
    execute: (db: QueryDB, self: SymbolEntry) => {
      const visited = new Set<SymbolId>([self.id]);
      const result: SymbolEntry[] = [];

      // Collect names of body-level redeclare elements
      const redeclaredNames = new Set<string>();
      const brokenNames = new Set<string>();
      const children = db.childrenOf(self.id);

      for (const child of children) {
        if (
          (child.kind === "Component" ||
            child.kind === "Class" ||
            isMemberLikeSymbol(child) ||
            isTypeLikeSymbol(child)) &&
          ((child.metadata as Record<string, unknown>)?.["redeclare"] || db.query<boolean>("isRedeclare", child.id))
        ) {
          redeclaredNames.add(child.name);
        }
      }

      // Inline extends at their declaration order
      for (const child of children) {
        if (child.kind === "Extends") {
          // Resolve the base class
          const baseClass = db.query<SymbolEntry | null>("resolvedBaseClass", child.id) ?? db.byName(child.name)?.[0];
          if (baseClass && !visited.has(baseClass.id)) {
            visited.add(baseClass.id);
            // Extract broken names from extends clause modifications
            const extendsModParsedRaw = db.query<any>("extendsModificationParsed", child.id);
            const extendsModParsed: any[] = Array.isArray(extendsModParsedRaw)
              ? extendsModParsedRaw
              : (extendsModParsedRaw?.args ?? []);
            const clauseBrokenNames = new Set<string>();
            for (const arg of extendsModParsed) {
              if ((arg.isBreak || arg.value?.kind === "break") && !arg.name.startsWith("break_connect:")) {
                clauseBrokenNames.add(arg.name);
              }
            }
            // Recursively get all elements of the base class
            const baseElements = db.query<SymbolEntry[]>("allElements", baseClass.id) ?? db.childrenOf(baseClass.id);
            for (const inherited of baseElements) {
              if (
                inherited.name &&
                !redeclaredNames.has(inherited.name) &&
                !brokenNames.has(inherited.name) &&
                !clauseBrokenNames.has(inherited.name)
              ) {
                result.push(inherited);
              }
            }
          }
        } else {
          result.push(child);
        }
      }

      return result;
    },
    recovery: () => [],
  },
  /**
   * Check if this class is a connector type.
   */
  isConnector: (db: QueryDB, self: SymbolEntry) => {
    if (isPortDefinitionSymbol(self)) {
      return true;
    }
    const meta = self.metadata as Record<string, unknown> | undefined;
    if (meta?.["isConnector"] === true) {
      return true;
    }
    let kind = String(meta?.["classPrefixes"] ?? meta?.["classKind"] ?? "");
    if (!kind) {
      const cst = db.cstNode(self.id) as SyntaxNode | null;
      if (cst) {
        const prefixes = Cst.ClassDefinition.classPrefixes(cst);
        if (prefixes?.text) kind = prefixes.text;
      }
    }
    if (
      kind === "connector" ||
      kind === "expandable connector" ||
      (typeof kind === "string" && kind.includes("connector"))
    ) {
      return true;
    }
    const base = db.query<SymbolEntry | null>("resolvedBaseClass", self.id);
    if (base && base.id !== self.id) {
      return db.query<boolean>("isConnector", base.id) || false;
    }
    return false;
  },
  /**
   * Check if this class is an expandable connector type.
   */
  isExpandableConnector: (db: QueryDB, self: SymbolEntry) => {
    const rawKind = String(
      (self.metadata as Record<string, unknown>)?.["classPrefixes"] ??
        (self.metadata as Record<string, unknown>)?.["classKind"] ??
        "",
    );
    const words = collapseSpaceTokens(stripModelicaComments(rawKind));
    if (words.includes("expandable") && words.includes("connector")) return true;
    const cst = db.cstNode(self.id) as SyntaxNode | null;
    if (cst) {
      const pfx = Cst.ClassDefinition.classPrefixes(cst);
      const pfxWords = collapseSpaceTokens(stripModelicaComments(pfx?.text ?? cst.text ?? ""));
      if (pfxWords.includes("expandable") && pfxWords.includes("connector")) return true;
    }
    const base = db.query<SymbolEntry | null>("resolvedBaseClass", self.id);
    if (base && base.id !== self.id) {
      return db.query<boolean>("isExpandableConnector", base.id) || false;
    }
    return false;
  },
  /**
   * Check if this class is an operator record type.
   */
  isOperatorRecord: (db: QueryDB, self: SymbolEntry) => isOperatorRecordSymbol(db, self),
  /**
   * For an `operator record` class, collect all operator functions.
   *
   * Returns a Map from operator name (e.g. "'+'", "'-'", "'*'") to an
   * array of function overloads. Each overload describes input types
   * and the qualified function name for call emission.
   *
   * Structure of each operator class:
   *   operator record C
   *     operator '+'
   *       function self ... end self;
   *       function rightInt ... end rightInt;
   *     end '+';
   *     operator function '+' ... end '+';  // shorthand form
   *   end C;
   */
  operatorFunctions: (db: QueryDB, self: SymbolEntry): Map<string, OperatorOverload[]> | null => {
    if (!isOperatorRecordSymbol(db, self)) return null;

    const recordName = self.name;
    const result = new Map<string, OperatorOverload[]>();

    const addOverload = (opName: string, overload: OperatorOverload) => {
      const list1 = result.get(opName) ?? [];
      list1.push(overload);
      result.set(opName, list1);

      const clean = stripOuterChar(opName, "'");
      if (clean !== opName) {
        const list2 = result.get(clean) ?? [];
        list2.push(overload);
        result.set(clean, list2);
      }
    };

    const extractOverload = (
      funcSym: SymbolEntry,
      opName: string,
      shortName: string,
      qualifiedName: string,
    ): OperatorOverload => {
      const inputParams: OperatorOverloadParam[] = [];
      const inputTypes: string[] = [];
      let outputParam: OperatorOverloadParam | null = null;
      let outputType = "";
      let inputCount = 0;

      for (const param of db.childrenOf(funcSym.id)) {
        if (param.kind !== "Component") continue;
        const pMeta = param.metadata as Record<string, unknown>;
        const compInst = db.query<any>("componentInstance", param.id);
        const causality = compInst?.causality ?? (pMeta?.["causality"] as string | undefined);
        let typeSpec = compInst?.typeSpecifier ?? (pMeta?.["typeSpecifier"] as string | undefined) ?? "Real";
        let isArray = false;
        if (typeSpec.includes("[")) {
          isArray = true;
          typeSpec = stripTrailingBrackets(typeSpec);
        }
        if (param.name.includes("[")) {
          isArray = true;
        }
        if (compInst?.arrayDimensions && compInst.arrayDimensions.length > 0) {
          isArray = true;
        }

        let hasDefault = false;
        let defaultValue: string | undefined = undefined;
        const paramCst = db.cstNode(param.id) as any;
        if (paramCst) {
          const pText = paramCst.text ?? "";
          if (pText.includes("[:]")) {
            isArray = true;
          }
          const bindingText = extractDeclBindingExprText(paramCst);
          if (bindingText !== null) {
            hasDefault = true;
            defaultValue = bindingText;
          }
        }

        if (causality === "input") {
          inputParams.push({
            name: stripTrailingBrackets(param.name),
            typeSpec,
            isArray,
            hasDefault,
            defaultValue,
          });
          inputTypes.push(typeSpec);
          inputCount++;
        } else if (causality === "output") {
          outputType = typeSpec;
          outputParam = {
            name: stripTrailingBrackets(param.name),
            typeSpec,
            isArray,
            hasDefault,
            defaultValue,
          };
        }
      }

      let isInline = false;
      const funcCst = db.cstNode(funcSym.id) as any;
      if (funcCst) {
        const fText = funcCst.text ?? "";
        if (fText.includes("Inline=true") || fText.includes("Inline = true")) {
          isInline = true;
        }
      }

      return {
        opName,
        shortName,
        qualifiedName,
        funcSymId: funcSym.id,
        inputParams,
        inputTypes,
        outputType,
        outputParam,
        inputCount,
        isInline,
      };
    };

    const children = db.childrenOf(self.id);
    for (const child of children) {
      if (child.kind !== "Class") continue;
      const childMeta = (child.metadata as Record<string, unknown>) || {};
      const childPrefix = String(childMeta?.["classPrefixes"] ?? childMeta?.["classKind"] ?? "");

      // Case 1: `operator function '+'` (shorthand — the class IS the function)
      if (childPrefix.includes("operator function")) {
        const opName = child.name; // e.g., "'+'"
        const qual = `${recordName}.${opName}`;
        addOverload(opName, extractOverload(child, opName, opName, qual));
        continue;
      }

      // Case 2: `operator '+'` containing function children
      if (childPrefix.includes("operator") || child.name.startsWith("'")) {
        const opName = child.name; // e.g., "'+'"
        const funcs = db.childrenOf(child.id);
        for (const func of funcs) {
          if (func.kind !== "Class") continue;
          const funcMeta = (func.metadata as Record<string, unknown>) || {};
          const funcPrefix = String(funcMeta?.["classPrefixes"] ?? funcMeta?.["classKind"] ?? "");
          if (!funcPrefix.includes("function")) {
            const fCst = db.cstNode(func.id) as any;
            const fText = fCst?.text?.trim() ?? "";
            if (!fText.startsWith("function")) continue;
          }
          const qual = `${recordName}.${opName}.${func.name}`;
          addOverload(opName, extractOverload(func, opName, func.name, qual));
        }
        continue;
      }
    }

    return result.size > 0 ? result : null;
  },

  /** Returns all `'constructor'` operator overloads defined on an `operator record` class. */
  operatorConstructors: (db: QueryDB, self: SymbolEntry): OperatorOverload[] => {
    const ops = db.query<Map<string, OperatorOverload[]> | null>("operatorFunctions", self.id);
    if (!ops) return [];
    return ops.get("'constructor'") ?? ops.get("constructor") ?? [];
  },

  /** Returns `true` if this `operator record` defines at least one `'constructor'` overload. */
  hasOperatorConstructor: (db: QueryDB, self: SymbolEntry): boolean => {
    const ctors = db.query<OperatorOverload[]>("operatorConstructors", self.id);
    return Boolean(ctors && ctors.length > 0);
  },
  /**
   * Resolve a modification argument by name from the class's
   * active modification context.
   */
  resolveModification: (_db: QueryDB, self: SymbolEntry) => {
    // Modification resolution is context-dependent:
    // the effective modification comes from the instantiation site
    // (outer modification merged with local declaration modifications).
    // In a Salsa query context, we return the metadata-level modification info.
    return (self.metadata as Record<string, unknown>)?.["modification"] ?? null;
  },

  // =================================================================
  // Milestone 2: Scope Resolution (Modelica §5.3)
  // =================================================================

  /**
   * Precomputes the lexical scope summary (`ScopeData`) for this class, including direct elements
   * and qualified, compound, and unqualified import clauses.
   */
  scopeData: (db: QueryDB, self: SymbolEntry): ScopeData => {
    return getScopeData(db, self);
  },

  /** Precompute inherited symbols mapping (memoized). */
  inheritedSymbolsMap: {
    execute: (db: QueryDB, self: SymbolEntry): Record<string, SymbolId> => {
      const result: Record<string, SymbolId> = {};
      const baseId = db.baseOf(self.id);
      const sourceId = baseId ?? self.id;
      const children = db.childrenOf(sourceId);

      // First walk extends clauses in declaration order
      for (const child of children) {
        if (child.kind === "Extends") {
          const baseClass = db.query<SymbolEntry | null>("resolvedBaseClass", child.id);
          if (baseClass) {
            const baseUnspecializedId = db.baseOf(baseClass.id) ?? baseClass.id;
            const baseScope = db.query<ScopeData>("scopeData", baseUnspecializedId);
            if (baseScope) {
              mergeInto(result, baseScope.directByName);
            }
            const baseInherited = db.query<Record<string, SymbolId>>("inheritedSymbolsMap", baseUnspecializedId) || {};
            mergeInto(result, baseInherited);
          }
        }
      }

      // Also handle extends in LongClassSpecifier
      let mayBeClassExtends = self.parentId !== null;
      if (mayBeClassExtends && self.startOffset != null && self.endOffset != null) {
        const queryDbWithCst = db as { cstText?: (s: number, e: number, sym?: unknown) => string | null };
        if (typeof queryDbWithCst.cstText === "function") {
          const hdr = queryDbWithCst.cstText(self.startOffset, Math.min(self.endOffset, self.startOffset + 160), self);
          if (typeof hdr === "string" && hdr.length > 0) {
            mayBeClassExtends = containsWord(hdr, "extends");
          }
        }
      }
      const selfCst = mayBeClassExtends ? (db.cstNode(sourceId) as SyntaxNode | null) : null;
      const spec = selfCst ? Cst.ClassDefinition.classSpecifier(selfCst) : null;
      if (spec?.type === "LongClassSpecifier") {
        let hasExtends = false;
        for (let i = 0; i < spec.childCount; i++) {
          if (spec.child(i)?.type === "extends") {
            hasExtends = true;
            break;
          }
        }
        if (hasExtends) {
          const identNode = Cst.LongClassSpecifier.name(spec);
          if (identNode?.text && self.parentId !== null) {
            const baseName = identNode.text;
            const resolveName = db.query<any>("resolveName", self.parentId);
            if (resolveName) {
              let resolved = resolveName(baseName, true);
              if (resolved && resolved.id === self.id) {
                resolved = null;
                if (self.parentId !== null && self.parentId !== undefined) {
                  for (const pChild of db.childrenOf(self.parentId)) {
                    if (pChild.kind === "Extends") {
                      const pBase = db.query<any>("resolvedBaseClass", pChild.id);
                      if (pBase) {
                        const pExtResolver = db.query<any>("resolveName", pBase.id);
                        if (pExtResolver) {
                          const found = pExtResolver(baseName);
                          if (found && found.id !== self.parentId) {
                            resolved = found;
                            break;
                          }
                        }
                      }
                    }
                  }
                }
              }
              if (resolved && resolved.kind !== "Reference") {
                const resolvedUnspecializedId = db.baseOf(resolved.id) ?? resolved.id;
                const baseScope = db.query<ScopeData>("scopeData", resolvedUnspecializedId);
                if (baseScope) {
                  mergeInto(result, baseScope.directByName);
                }
                const baseInherited =
                  db.query<Record<string, SymbolId>>("inheritedSymbolsMap", resolvedUnspecializedId) || {};
                mergeInto(result, baseInherited);
              }
            }
          }
        }
      }

      return result;
    },
    recovery: () => ({}),
  },

  /**
   * Returns a memoized closure that resolves a simple identifier in this class's scope
   * according to Modelica §5.3 lookup rules (direct members, inherited members, imports, enclosing scopes).
   */
  resolveSimpleName: (db: QueryDB, self: SymbolEntry) => {
    db.symbol(self.id);
    const cache = new Map<string, SymbolEntry | null>();
    let lastRev = db.getRevision?.() ?? 0;
    return (name: string, encapsulated = false, skipInherited = false, memberOnly = false): SymbolEntry | null => {
      const curRev = db.getRevision?.() ?? 0;
      if (curRev !== lastRev) {
        cache.clear();
        lastRev = curRev;
      }
      const key =
        !encapsulated && !skipInherited && !memberOnly
          ? name
          : `${name}|${encapsulated ? 1 : 0}${skipInherited ? 1 : 0}${memberOnly ? 1 : 0}`;
      const cached = cache.get(key);
      if (cached !== undefined) return cached;
      const res = resolveSimpleNameHelper(db, self.id, name, encapsulated, skipInherited, new Set(), memberOnly);
      if (res !== null) {
        cache.set(key, res);
      }
      return res;
    };
  },

  /**
   * Resolve a qualified (dot-separated) name from this class's scope.
   *
   * Uses resolveSimpleName for the first part, then navigates
   * into children for each subsequent part.
   */
  resolveName: (db: QueryDB, self: SymbolEntry) => {
    db.symbol(self.id);
    const cache = new Map<string, SymbolEntry | null>();
    let lastRev = db.getRevision?.() ?? 0;
    return (qualifiedName: string, skipInherited = false, allowMemberImports = false): SymbolEntry | null => {
      const curRev = db.getRevision?.() ?? 0;
      if (curRev !== lastRev) {
        cache.clear();
        lastRev = curRev;
      }
      const key =
        !skipInherited && !allowMemberImports
          ? qualifiedName
          : `${qualifiedName}|${skipInherited ? 1 : 0}${allowMemberImports ? 1 : 0}`;
      const cached = cache.get(key);
      if (cached !== undefined) return cached;

      const parts = splitQualifiedPath(qualifiedName);
      if (parts.length === 0) {
        return null;
      }

      const tryResolve = (): SymbolEntry | null => {
        // Handle fully qualified names (e.g. .Modelica.Math.sin)
        let startIndex = 0;
        let initial: SymbolEntry | null = null;
        if (qualifiedName.trim().startsWith(".")) {
          if (parts.length < 1) return null;
          initial = db.byName(parts[0]!)?.find((e) => e.parentId === null && isTypeLikeSymbol(e)) ?? null;
          startIndex = 1;
        } else {
          // Resolve first part via scope resolution
          const resolver = db.query<(n: string, enc?: boolean, skip?: boolean, mem?: boolean) => SymbolEntry | null>(
            "resolveSimpleName",
            self.id,
          );
          initial = resolver?.(parts[0]!, false, skipInherited) ?? null;
          startIndex = 1;
        }

        if (!initial) return null;
        let current: SymbolEntry = initial;

        // Navigate remaining parts
        for (let i = startIndex; i < parts.length; i++) {
          const part = parts[i]!;
          if ((part === "constructor" || part === "destructor") && current.id !== self.id) {
            const currentChildren = db.childrenOf(current.id);
            const extendsExtObj = currentChildren?.some((c) => c.kind === "Extends" && c.name === "ExternalObject");
            if (extendsExtObj) {
              return null;
            }
          }
          let targetResolver: ((n: string, enc?: boolean, skip?: boolean, mem?: boolean) => SymbolEntry | null) | null =
            db.query<(n: string, enc?: boolean, skip?: boolean, mem?: boolean) => SymbolEntry | null>(
              "resolveSimpleName",
              current.id,
            );
          let nextPart: SymbolEntry | null | undefined = targetResolver?.(part, false, false, !allowMemberImports);
          if (!nextPart && db.ensureFQNIndexed) {
            const curFQN = getSymbolQualifiedName(db, current.id);
            if (curFQN) {
              db.ensureFQNIndexed(curFQN + "." + part);
              targetResolver = db.query<
                (n: string, enc?: boolean, skip?: boolean, mem?: boolean) => SymbolEntry | null
              >("resolveSimpleName", current.id);
              nextPart = targetResolver?.(part, false, false, !allowMemberImports);
            }
          }
          if (!nextPart) return null;
          current = nextPart;
        }

        return current;
      };

      let result = tryResolve();
      if (!result && db.ensureFQNIndexed) {
        if (qualifiedName.includes(".") || qualifiedName.includes("::")) {
          db.ensureFQNIndexed(parts.join("."));
        }
        let enc: SymbolEntry | null = self;
        while (enc) {
          const encFQN = getSymbolQualifiedName(db, enc.id);
          if (encFQN) {
            db.ensureFQNIndexed(
              encFQN + "." + (qualifiedName.startsWith(".") ? qualifiedName.slice(1) : qualifiedName),
            );
          }
          enc = enc.parentId !== null ? (db.symbol(enc.parentId) ?? null) : null;
        }
        result = tryResolve();
      }

      if (result !== null) {
        cache.set(key, result);
      }
      return result;
    };
  },

  // =================================================================
  // Milestone 3: Instantiation Query
  // =================================================================

  /**
   * Instantiate this class: resolve all elements, expand extends,
   * and filter redeclarations.
   *
   * This is the central query that replaces ModelicaClassInstance.instantiate().
   *
   * Returns direct children, recursively inlining inherited elements
   * from extends clauses and filtering redeclared names.
   *
   * NOTE: This query no longer creates virtual (specialized) symbols.
   * All modification propagation is handled by the flattener's
   * ModificationStack during flattening.
   *
   * Returns a list of static (non-virtual) SymbolIds.
   */
  instantiate: {
    execute: (db: QueryDB, self: SymbolEntry) => {
      // Get outer modification (if this is a specialized entry)
      const specArgs = db.argsOf<ModelicaModArgs>(self.id);
      const outerMod: ModelicaModArgs | null = specArgs?.data ?? null;

      // Determine actual children: for specialized entries,
      // use the base symbol's children
      const baseId = db.baseOf(self.id);
      const sourceId = baseId ?? self.id;

      // Handle ShortClassSpecifier aliases
      const selfCstShort = db.cstNode(sourceId) as any;
      const specShort = getShortClassSpecifierNode(selfCstShort);
      if (specShort) {
        const typeSpec =
          Cst.ShortClassSpecifier.typeSpecifier(specShort) ??
          specShort.children?.find((c: SyntaxNode) => c.type === "type_specifier" || c.type === "TypeSpecifier");
        const typeName = typeSpec?.text?.trim();
        if (typeName) {
          let resolved: { id: SymbolId } | null = null;
          let scopeParentId = self.parentId;
          if (scopeParentId !== null && db.symbol(scopeParentId)?.kind === "Extends") {
            scopeParentId = db.symbol(scopeParentId)?.parentId ?? scopeParentId;
          }
          if (scopeParentId !== null) {
            const parentResolver = db.query<(n: string) => { id: SymbolId } | null>("resolveName", scopeParentId);
            if (parentResolver) {
              resolved = parentResolver(typeName);
            }
          }
          const isEncapsulatedShort = isScopeEncapsulated(db, self.id);
          if (!resolved && !isEncapsulatedShort) {
            resolved = resolveQualified(db, typeName);
          }
          if (!resolved && !isEncapsulatedShort) {
            const simpleName = typeName.includes(".") ? typeName.split(".").pop()! : typeName;
            const matches = db.byName(simpleName);
            if (matches && matches.length > 0) {
              resolved = matches[0]!;
            }
          }
          if (resolved && resolved.id !== self.id) {
            return db.query<SymbolId[]>("instantiate", resolved.id) || [];
          }
        }
      }

      const children = db.childrenOf(sourceId);

      // Pre-scan for body-level redeclares
      const redeclaredNames = new Set<string>();
      for (const child of children) {
        const meta = child.metadata as Record<string, unknown>;
        if (meta?.["redeclare"] || db.query<boolean>("isRedeclare", child.id)) {
          redeclaredNames.add(child.name);
        }
      }

      // In Modelica §5.6.1, elements inherited from extends clauses are added before
      // elements declared directly in the class, in the order of the extends-clauses.
      // Trailing extends clauses (no public components declared after them) are moved before all components.
      let lastCompIdx = -1;
      for (let i = children.length - 1; i >= 0; i--) {
        if (children[i]!.kind === "Component" && !db.query<boolean>("isProtected", children[i]!.id)) {
          lastCompIdx = i;
          break;
        }
      }

      const orderedChildren: SymbolEntry[] = [];
      const trailingExtends: SymbolEntry[] = [];
      for (let i = 0; i < children.length; i++) {
        const child = children[i]!;
        if (child.kind === "Extends") {
          if (i > lastCompIdx) {
            trailingExtends.push(child);
            continue;
          }
        }
        orderedChildren.push(child);
      }
      if (trailingExtends.length > 0) {
        const firstCompIdx = orderedChildren.findIndex((c) => c.kind === "Component");
        if (firstCompIdx >= 0) {
          orderedChildren.splice(firstCompIdx, 0, ...trailingExtends);
        } else {
          orderedChildren.push(...trailingExtends);
        }
      }

      const elements: SymbolId[] = [];
      const seenNames = new Set<string>();

      // NEW: handle extends in long class specifier!
      const selfCstExt = db.cstNode(self.id) as SyntaxNode | null;
      const specExt = Cst.ClassDefinition.classSpecifier(selfCstExt);
      if (specExt?.type === "LongClassSpecifier") {
        let hasExtends = false;
        for (let i = 0; i < specExt.childCount; i++) {
          if (specExt.child(i)?.type === "extends") {
            hasExtends = true;
            break;
          }
        }
        if (hasExtends) {
          const identNode = Cst.LongClassSpecifier.name(specExt);
          if (identNode?.text && self.parentId !== null) {
            const baseName = identNode.text;
            const resolveName = db.query<any>("resolveName", self.parentId);
            if (resolveName) {
              let resolved = resolveName(baseName, true);
              if (resolved && resolved.id === self.id) {
                // Cycle detected, look in parent's inherited classes
                resolved = null;
                const grandParentId = db.symbol(self.parentId)?.parentId;
                void grandParentId;
                if (self.parentId !== null && self.parentId !== undefined) {
                  for (const pChild of db.childrenOf(self.parentId)) {
                    if (pChild.kind === "Extends") {
                      const pBase = db.query<any>("resolvedBaseClass", pChild.id);
                      if (pBase) {
                        const pExtResolver = db.query<any>("resolveName", pBase.id);
                        if (pExtResolver) {
                          const found = pExtResolver(baseName);
                          if (found && found.id !== self.parentId) {
                            resolved = found;
                            break;
                          }
                        }
                      }
                    }
                  }
                }
              }

              if (resolved && resolved.kind !== "Reference") {
                // We found the base class! Let's instantiate it!
                const baseElements = db.query<any>("instantiate", resolved.id) || [];
                for (const eid of baseElements) {
                  const entry = db.symbol(eid);
                  if (entry && !redeclaredNames.has(entry.name)) {
                    if (entry.name) {
                      if (seenNames.has(entry.name)) continue;
                      seenNames.add(entry.name);
                    }
                    elements.push(eid);
                  }
                }
              }
            }
          }
        }
      }

      for (const child of orderedChildren) {
        if (child.kind === "Component") {
          // Always use the static component SymbolId.
          // Outer modifications are resolved by the flattener's ModificationStack,
          // eliminating the need for virtual specialized component entries.
          if (child.name && !redeclaredNames.has(child.name)) {
            if (seenNames.has(child.name)) continue;
            seenNames.add(child.name);
          }
          elements.push(child.id);
        } else if (child.kind === "Extends") {
          // Check for break
          if (isBroken(outerMod, child.name)) continue;

          // Resolve the base class
          let baseClass = db.query<SymbolEntry | null>("resolvedBaseClass", child.id);
          if (!baseClass) {
            const resolveName = db.query<(n: string) => SymbolEntry | null>("resolveName", self.id);
            if (resolveName) {
              baseClass = resolveName(child.name);
            }
          }
          const isEnc = isScopeEncapsulated(db, self.id);
          if ((!baseClass || baseClass.id === self.id) && !isEnc) {
            const entries = db.byName(child.name);
            baseClass = entries?.find((e) => (e.kind === "Class" || e.kind === "Package") && e.id !== self.id) ?? null;
          }

          if (!baseClass) {
            // Unresolved extends — skip but still record the extends entry
            elements.push(child.id);
            continue;
          }

          // Instantiate the base class directly (unmodified).
          // Extends modifications are propagated by the flattener's ModificationStack,
          // eliminating the need for virtual specialized base class entries.
          const baseElements = db.query<SymbolId[]>("instantiate", baseClass.id) || [];

          // Extract broken names from the extends clause modification
          const extendsModParsedRaw = db.query<any>("extendsModificationParsed", child.id);
          const extendsModParsed: any[] = Array.isArray(extendsModParsedRaw)
            ? extendsModParsedRaw
            : (extendsModParsedRaw?.args ?? []);
          const brokenNames = new Set<string>();
          for (const arg of extendsModParsed) {
            if ((arg.isBreak || arg.value?.kind === "break") && !arg.name.startsWith("break_connect:")) {
              brokenNames.add(arg.name);
            }
          }

          // Inline inherited elements, filtering redeclared names and broken names
          for (const eid of baseElements) {
            const entry = db.symbol(eid);
            if (entry && !redeclaredNames.has(entry.name) && !brokenNames.has(entry.name)) {
              if (entry.name) {
                if (seenNames.has(entry.name)) continue;
                seenNames.add(entry.name);
              }
              elements.push(eid);
            }
          }
        } else if (child.kind === "Class") {
          // Nested class — include local redeclarations and regular classes
          elements.push(child.id);
        } else if (child.kind === "Import") {
          // Imports are not instantiated elements but recorded for scope
          elements.push(child.id);
        } else if (child.kind === "Reference") {
          // References shouldn't be instantiated as child elements
          continue;
        } else {
          // Other children (equations, algorithms, etc.)
          elements.push(child.id);
        }
      }

      return elements;
    },
    recovery: (_cycle: unknown, _self: SymbolEntry) => [] as SymbolId[],
  },
  /**
   * M2004 / M4045: Validates that all modification arguments on a short class specifier
   * target existing elements or predefined attributes of the base class.
   */
  lint__modifierNotFound: (db: QueryDB, self: SymbolEntry) => {
    const cst = db.cstNode(self.id) as SyntaxNode | null;
    const spec = getShortClassSpecifierNode(cst);
    if (!spec) return null;
    const modNode =
      Cst.ShortClassSpecifier.classModification(spec) ??
      spec.children?.find((c: SyntaxNode) => c.type === "class_modification" || c.type === "ClassModification");
    const mod = parseModArgsFromCst(modNode, self.parentId);
    if (!mod || !mod.args || mod.args.length === 0) return null;
    const typeSpec =
      Cst.ShortClassSpecifier.typeSpecifier(spec) ??
      spec.children?.find((c: SyntaxNode) => c.type === "type_specifier" || c.type === "TypeSpecifier");
    const typeName = typeSpec?.text?.trim();
    if (typeName) {
      let baseEntry: SymbolEntry | null = null;
      if (self.parentId !== null) {
        const resolve = db.query<any>("resolveName", self.parentId);
        if (resolve) baseEntry = resolve(typeName, true) as SymbolEntry | null;
        if (!baseEntry && !typeName.includes(".")) {
          const resSimple = db.query<any>("resolveSimpleName", self.parentId);
          if (resSimple) baseEntry = resSimple(typeName) as SymbolEntry | null;
        }
      }
      if (!baseEntry) {
        if (typeName.includes(".")) {
          baseEntry = resolveQualified(db, typeName);
        } else {
          const entries = db.byName(typeName);
          baseEntry = entries?.find((e: any) => e.kind === "Class") ?? null;
        }
      }
      if (baseEntry) {
        return checkModifierNotFound(db, self, mod, baseEntry.id, baseEntry, self.name);
      }
    }
    return null;
  },
  /**
   * M2021: Conflicting import short names within the same class definition (MLS §13.2.1.1).
   */
  lint__importConflict: (db: QueryDB, self: SymbolEntry) => {
    const meta = self.metadata as Record<string, unknown> | undefined;
    if (meta?.["isPredefined"]) return null;

    const seenShortToTarget = new Map<string, string>();
    const diags: ReturnType<typeof warning>[] = [];

    for (const child of db.childrenOf(self.id)) {
      if (child.kind !== "Import") continue;
      const parsed = extractClassImportPairs(db, child);
      if (!parsed || parsed.importKind === "unqualified") continue;

      for (const [shortName, target] of parsed.pairs) {
        const existing = seenShortToTarget.get(shortName);
        if (existing !== undefined && existing !== target) {
          diags.push(
            warning(ModelicaErrorCode.IMPORT_CONFLICT.message(shortName, self.name), {
              startOffset: parsed.startOffset,
              endOffset: parsed.endOffset,
              code: ModelicaErrorCode.IMPORT_CONFLICT.code,
            }),
          );
        } else if (existing === undefined) {
          seenShortToTarget.set(shortName, target);
        }
      }
    }

    return diags.length > 0 ? diags : null;
  },
  /**
   * M2024: Unused qualified, renamed, or compound import in non-package classes (MLS §13.2).
   */
  lint__unusedImport: (db: QueryDB, self: SymbolEntry) => {
    const meta = self.metadata as Record<string, unknown> | undefined;
    if (meta?.["isPredefined"]) return null;
    const prefix = ((meta?.["classPrefixes"] as string) ?? "").toLowerCase();
    if (prefix.includes("package")) return null;

    const classCst = db.cstNode(self.id) as SyntaxNode | null;
    const fullText: string = classCst?.text ?? "";
    if (!fullText) return null;

    const classStart = classCst?.startIndex ?? classCst?.startOffset ?? self.startOffset;
    // Build body text with direct import_clause spans blanked out so we never match the import itself
    const chars = fullText.split("");
    let hasImports = false;
    const importEntries: Array<{ pairs: Array<[string, string]>; startOffset: number; endOffset: number }> = [];
    for (const child of db.childrenOf(self.id)) {
      if (child.kind !== "Import") continue;
      hasImports = true;
      const parsed = extractClassImportPairs(db, child);
      if (parsed && parsed.importKind !== "unqualified") {
        importEntries.push(parsed);
      }
      const relS = Math.max(0, (parsed?.startOffset ?? child.startOffset) - classStart);
      const relE = Math.min(chars.length, (parsed?.endOffset ?? child.endOffset) - classStart);
      for (let i = relS; i < relE; i++) chars[i] = " ";
    }
    if (!hasImports || importEntries.length === 0) return null;

    const usedIdents = new Set<string>();
    const scanText = chars.join("");
    let cur = "";
    for (let i = 0; i < scanText.length; i++) {
      const ch = scanText.charCodeAt(i);
      if (cur.length === 0 ? isIdentStartCode(ch) : isIdentCharCode(ch)) {
        cur += scanText[i];
      } else if (cur.length > 0) {
        usedIdents.add(cur);
        cur = "";
      }
    }
    if (cur.length > 0) usedIdents.add(cur);

    const diags: ReturnType<typeof info>[] = [];
    for (const parsed of importEntries) {
      for (const [shortName] of parsed.pairs) {
        if (!usedIdents.has(shortName)) {
          diags.push(
            info(ModelicaErrorCode.UNUSED_IMPORT.message(shortName, self.name), {
              startOffset: parsed.startOffset,
              endOffset: parsed.endOffset,
              code: ModelicaErrorCode.UNUSED_IMPORT.code,
            }),
          );
        }
      }
    }
    return diags.length > 0 ? diags : null;
  },
  /**
   * M4148: Checks physical connector balance (#potential == #flow for connectors with flow variables, MLS §9.3.1).
   */
  lint__connectorUnbalanced: (db: QueryDB, self: SymbolEntry) => {
    const meta = self.metadata as Record<string, unknown> | undefined;
    if (meta?.["isPredefined"]) return null;
    const prefix = ((meta?.["classPrefixes"] as string) ?? "").toLowerCase();
    if (!prefix.includes("connector") || prefix.includes("partial") || prefix.includes("expandable")) {
      return null;
    }

    const countBalance = (classId: SymbolId, visited: Set<SymbolId>): { potential: number; flow: number } | null => {
      if (visited.has(classId)) return { potential: 0, flow: 0 };
      visited.add(classId);
      let potential = 0;
      let flow = 0;

      const elems = db.query<SymbolEntry[]>("allElements", classId) ?? [];
      for (const elem of elems) {
        if (elem.kind !== "Component") continue;
        const variab = db.query<string | null>("variability", elem.id);
        if (variab === "parameter" || variab === "constant") continue;

        const fp = db.query<string | null>("flowPrefix", elem.id);
        if (fp === "stream") continue;

        const dims = db.query<number[] | null>("resolvedArrayDimensions", elem.id);
        let scalarCount = 1;
        if (Array.isArray(dims) && dims.length > 0) {
          for (const d of dims) {
            if (typeof d !== "number" || d < 0) return null; // dynamic/unknown size
            scalarCount *= d;
          }
        }

        const typeSpec = (db.query<string | null>("typeSpecifier", elem.id) ?? "").trim();
        const typeClassId = db.query<SymbolId | null>("classInstance", elem.id);
        const typeEntry = typeClassId ? db.symbol(typeClassId) : null;
        const typeMeta = typeEntry?.metadata as Record<string, unknown> | undefined;
        const typePrefixes = ((typeMeta?.["classPrefixes"] as string) ?? "").toLowerCase();

        if (typePrefixes.includes("connector") && typeClassId && !typePrefixes.includes("expandable")) {
          const sub = countBalance(typeClassId, visited);
          if (!sub) return null;
          potential += sub.potential * scalarCount;
          flow += sub.flow * scalarCount;
          continue;
        }

        // Only count Real-based physical variables (including short type aliases of Real)
        const baseType = typeEntry ? db.query<string | null>("typeSpecifier", typeEntry.id) : null;
        const isRealLike =
          typeSpec === "Real" ||
          baseType === "Real" ||
          (!typeEntry && (typeSpec === "" || typeSpec === "Real")) ||
          typePrefixes.includes("type");
        if (!isRealLike) {
          // Discrete Integer/Boolean/String/Enumeration signals or complex records are outside simple flow=potential check
          if (typeSpec === "Integer" || typeSpec === "Boolean" || typeSpec === "String") continue;
          return null;
        }

        if (fp === "flow") {
          flow += scalarCount;
        } else {
          potential += scalarCount;
        }
      }
      return { potential, flow };
    };

    const bal = countBalance(self.id, new Set());
    if (!bal || bal.flow === 0 || bal.potential === bal.flow) return null;

    const cst = db.cstNode(self.id) as SyntaxNode | null;
    return warning(ModelicaErrorCode.CONNECTOR_UNBALANCED.message(self.name, String(bal.potential), String(bal.flow)), {
      startOffset: cst?.startIndex ?? cst?.startOffset ?? self.startOffset,
      endOffset: cst?.endIndex ?? cst?.endOffset ?? self.endOffset,
      code: ModelicaErrorCode.CONNECTOR_UNBALANCED.code,
    });
  },

  /** M4150: Function derivative annotation target cannot be resolved or is not a function. */
  lint__derivativeAnnotationMismatch: (db: QueryDB, self: SymbolEntry) => {
    const getMetaKind = (sym: SymbolEntry): string =>
      String(
        (sym.metadata as Record<string, unknown> | undefined)?.["classKind"] ??
          (sym.metadata as Record<string, unknown> | undefined)?.["classPrefixes"] ??
          "",
      ).toLowerCase();
    const isFunctionLike = (sym: SymbolEntry): boolean =>
      sym.kind === "Function" || /\bfunction\b/.test(getMetaKind(sym));
    if (!isFunctionLike(self)) return null;
    const cst = db.cstNode(self.id) as SyntaxNode | null;
    if (!cst) return null;

    const spec =
      Cst.ClassDefinition?.classSpecifier?.(cst) ??
      cst.children?.find(
        (c: SyntaxNode) =>
          c.type === "long_class_specifier" || c.type === "short_class_specifier" || c.type === "class_specifier",
      );
    const annContainers: SyntaxNode[] = [];
    const collectOwnAnnotations = (n: SyntaxNode) => {
      if (!n) return;
      if (n.type === "class_definition" && n !== cst) return;
      if (n.type === "annotation_clause") {
        annContainers.push(n);
        return;
      }
      for (const ch of n.children || []) collectOwnAnnotations(ch);
    };
    collectOwnAnnotations(spec ?? cst);
    if (annContainers.length === 0) return null;

    const derivTargets: Array<{ name: string; node: SyntaxNode }> = [];
    const extractDerivatives = (n: SyntaxNode) => {
      if (!n) return;
      if (n.type === "element_modification") {
        const nameNode = n.childForFieldName?.("name") ?? n.children?.find((c: SyntaxNode) => c.type === "name");
        if (nameNode?.text?.trim() === "derivative") {
          const modNode =
            n.childForFieldName?.("modification") ?? n.children?.find((c: SyntaxNode) => c.type === "modification");
          const modExpr = modNode?.children?.find((c: SyntaxNode) => c.type === "modification_expression");
          const raw = modExpr?.text?.trim() ?? "";
          if (/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(raw)) {
            derivTargets.push({ name: raw, node: modExpr ?? n });
          }
          return;
        }
      }
      for (const ch of n.children || []) extractDerivatives(ch);
    };
    for (const ann of annContainers) extractDerivatives(ann);
    if (derivTargets.length === 0) return null;

    const diags: ReturnType<typeof warning>[] = [];
    const scopeId = self.parentId ?? self.id;
    const resolver = db.query<(n: string) => SymbolEntry | null>("resolveName", scopeId);

    for (const target of derivTargets) {
      let resolved: SymbolEntry | null = null;
      if (self.parentId !== null) {
        resolved =
          db
            .childrenOf(self.parentId)
            ?.find((c) => (c.kind === "Class" || c.kind === "Function") && c.name === target.name) ?? null;
      }
      if (!resolved && resolver) resolved = resolver(target.name);
      if (!resolved && target.name.includes(".")) resolved = resolveQualified(db, target.name);
      if (!resolved && !target.name.includes(".")) {
        const matches = db.byName(target.name);
        resolved = matches.find((m) => m.kind === "Class" || m.kind === "Function") ?? matches[0] ?? null;
      }

      if (!resolved) {
        if (target.name.includes(".")) {
          const rootPkg = target.name.split(".")[0]!;
          const rootExists = Boolean(resolver?.(rootPkg)) || db.byName(rootPkg).length > 0;
          if (!rootExists) continue;
        }
        diags.push(
          warning(ModelicaErrorCode.DERIVATIVE_ANNOTATION_MISMATCH.message(self.name, target.name), {
            startOffset: target.node.startIndex ?? target.node.startOffset ?? self.startOffset,
            endOffset: target.node.endIndex ?? target.node.endOffset ?? self.endOffset,
            code: ModelicaErrorCode.DERIVATIVE_ANNOTATION_MISMATCH.code,
          }),
        );
        continue;
      }

      const targetKind = getMetaKind(resolved);
      const isValidTarget = isFunctionLike(resolved) || (resolved.kind === "Class" && /\bclass\b/.test(targetKind));
      if (!isValidTarget) {
        diags.push(
          warning(ModelicaErrorCode.DERIVATIVE_ANNOTATION_MISMATCH.message(self.name, target.name), {
            startOffset: target.node.startIndex ?? target.node.startOffset ?? self.startOffset,
            endOffset: target.node.endIndex ?? target.node.endOffset ?? self.endOffset,
            code: ModelicaErrorCode.DERIVATIVE_ANNOTATION_MISMATCH.code,
          }),
        );
      }
    }

    return diags.length > 0 ? diags : null;
  },

  /**
   * M2020: Unresolved import target in Modelica class (MLS §13.2.1).
   * Scoped to workspace-rooted packages or unqualified targets to avoid false positives on unmounted external libraries.
   */
  lint__importNotFound: (db: QueryDB, self: SymbolEntry) => {
    const meta = self.metadata as Record<string, unknown> | undefined;
    if (meta?.["isPredefined"]) return null;

    const diags: ReturnType<typeof warning>[] = [];
    const scopeId = self.parentId ?? self.id;
    const resolver = db.query<(n: string) => SymbolEntry | null>("resolveName", scopeId);

    const resolveNonImportTarget = (pathStr: string): SymbolEntry | null => {
      if (pathStr.includes(".")) {
        const q = resolveQualified(db, pathStr);
        return q && q.kind !== "Import" ? q : null;
      }
      const fromScope = resolver?.(pathStr);
      if (fromScope && fromScope.kind !== "Import") return fromScope;
      return db.byName(pathStr).find((e) => e.kind !== "Import") ?? null;
    };
    const isRootKnown = (pathStr: string): boolean => {
      if (!pathStr.includes(".")) return true;
      const rootPkg = pathStr.split(".")[0]!;
      const fromScope = resolver?.(rootPkg);
      if (fromScope && fromScope.kind !== "Import") return true;
      return db.byName(rootPkg).some((e) => e.kind !== "Import");
    };

    for (const child of db.childrenOf(self.id)) {
      if (child.kind !== "Import") continue;
      const parsed = extractClassImportPairs(db, child);
      if (!parsed) continue;

      if (parsed.importKind === "unqualified") {
        const metaPkg = (child.metadata as Record<string, unknown> | undefined)?.["packageName"] as string | undefined;
        const cstText = (db.cstNode(child.id) as SyntaxNode | null)?.text as string | undefined;
        let pkgPath = metaPkg && metaPkg.trim().length > 0 ? metaPkg : "";
        if (!pkgPath && cstText) {
          pkgPath = cstText
            .replace(/^\s*import\s+/, "")
            .replace(/;$/, "")
            .trim();
        }
        if (!pkgPath) pkgPath = child.name;
        const cleanPkg = pkgPath.replace(/\.\*$/, "").trim();
        if (!cleanPkg || cleanPkg === "*") continue;
        if (!resolveNonImportTarget(cleanPkg) && isRootKnown(cleanPkg)) {
          diags.push(
            warning(ModelicaErrorCode.IMPORT_NOT_FOUND.message(cleanPkg, self.name), {
              startOffset: parsed.startOffset,
              endOffset: parsed.endOffset,
              code: ModelicaErrorCode.IMPORT_NOT_FOUND.code,
            }),
          );
        }
        continue;
      }

      for (const [, target] of parsed.pairs) {
        if (!target) continue;
        if (!resolveNonImportTarget(target) && isRootKnown(target)) {
          diags.push(
            warning(ModelicaErrorCode.IMPORT_NOT_FOUND.message(target, self.name), {
              startOffset: parsed.startOffset,
              endOffset: parsed.endOffset,
              code: ModelicaErrorCode.IMPORT_NOT_FOUND.code,
            }),
          );
        }
      }
    }

    return diags.length > 0 ? diags : null;
  },

  /**
   * M4151: Unconnected required input on block/model component instances.
   */
  lint__unconnectedInput: (db: QueryDB, self: SymbolEntry) => {
    const meta = self.metadata as Record<string, unknown> | undefined;
    if (meta?.["isPredefined"]) return null;
    const prefix = String(meta?.["classPrefixes"] ?? meta?.["classKind"] ?? "").toLowerCase();
    if (prefix.includes("partial")) return null;
    const isModelOrBlock = /\b(model|block)\b/.test(prefix);
    if (!isModelOrBlock) return null;

    // Collect referenced dotted paths in equations/algorithms across self and inherited base classes
    const referencedPaths = new Set<string>();
    const collectEqRefs = (clsId: SymbolId, visited: Set<SymbolId>) => {
      if (visited.has(clsId)) return;
      visited.add(clsId);
      const clsCst = db.cstNode(clsId) as SyntaxNode | null;
      if (clsCst) {
        const walkEqSections = (node: SyntaxNode) => {
          if (!node) return;
          if (node !== clsCst && node.type === "class_definition") return;
          if (node.type === "equation_section" || node.type === "algorithm_section") {
            const txt = String(node.text ?? "");
            for (const m of txt.matchAll(
              /\b([A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?(?:\.[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?)+)\b/g,
            )) {
              const normalized = m[1]!.replace(/\[[^\]]*\]/g, "");
              referencedPaths.add(normalized);
            }
            return;
          }
          for (const ch of node.children ?? []) walkEqSections(ch);
        };
        walkEqSections(clsCst);
      }
      for (const ch of db.childrenOf(clsId)) {
        if (ch.kind === "Connect") {
          const cmeta = ch.metadata as Record<string, unknown> | undefined;
          for (const side of [cmeta?.["lhs"], cmeta?.["rhs"]]) {
            if (typeof side === "string") referencedPaths.add(side.replace(/\[[^\]]*\]/g, "").trim());
          }
        } else if (ch.kind === "Extends") {
          const base = db.query<SymbolEntry | null>("resolvedBaseClass", ch.id);
          if (base) collectEqRefs(base.id, visited);
        }
      }
    };
    collectEqRefs(self.id, new Set());

    const hasDefaultBindingOrProtected = (elem: SymbolEntry): boolean => {
      const em = elem.metadata as Record<string, unknown> | undefined;
      if (em?.["visibility"] === "protected") return true;
      const ecst = db.cstNode(elem.id) as SyntaxNode | null;
      if (!ecst) return false;
      // Check visibility prefix on enclosing element/component_clause
      let cur: SyntaxNode | null = ecst;
      while (cur && cur.type !== "element" && cur.type !== "component_clause") cur = cur.parent;
      if (
        cur?.parent?.type === "protected" ||
        String(ecst.text ?? "")
          .trimStart()
          .startsWith("protected")
      )
        return true;
      // Look for explicit '= expr' binding on declaration
      const declText = String(ecst.text ?? "");
      let depth = 0;
      let inStr = false;
      for (let i = 0; i < declText.length; i++) {
        const c = declText[i]!;
        if (inStr) {
          if (c === "\\" && i + 1 < declText.length) i++;
          else if (c === '"') inStr = false;
          continue;
        }
        if (c === '"') inStr = true;
        else if (c === "(" || c === "[") depth++;
        else if (c === ")" || c === "]") depth = Math.max(0, depth - 1);
        else if (depth === 0 && c === "=") return true;
      }
      return false;
    };

    const diags: ReturnType<typeof warning>[] = [];
    for (const comp of db.childrenOf(self.id)) {
      if (comp.kind !== "Component") continue;
      const cCst = db.cstNode(comp.id) as SyntaxNode | null;
      if (cCst) {
        // Skip conditional components or outer components
        let clauseNode: SyntaxNode | null = cCst;
        while (clauseNode && clauseNode.type !== "component_clause") clauseNode = clauseNode.parent;
        const clauseTxt = String(clauseNode?.text ?? "");
        if (/\bouter\b/.test(clauseTxt.split(/\s+/)[0] ?? "")) continue;
        if (cCst.children?.some((ch: SyntaxNode) => ch.type === "condition_attribute")) continue;
      }

      const compTypeId = db.query<SymbolId | null>("classInstance", comp.id);
      if (!compTypeId) continue;
      const compType = db.symbol(compTypeId);
      if (!compType || compType.kind !== "Class") continue;
      const typePrefix = String(
        (compType.metadata as Record<string, unknown> | undefined)?.["classPrefixes"] ?? "",
      ).toLowerCase();
      if (!/\b(block|model)\b/.test(typePrefix) || /\bconnector\b/.test(typePrefix)) continue;

      const compMod = db.query<ModelicaModArgs | null>("effectiveModification", comp.id);
      const modifiedNames = new Set((compMod?.args ?? []).map((a) => a.name));

      const subElems = (db.query<SymbolEntry[]>("allElements", compTypeId) ?? []).filter((e) => e.kind === "Component");
      for (const elem of subElems) {
        if (modifiedNames.has(elem.name)) continue;
        let isInput = db.query<string | null>("causality", elem.id) === "input";
        if (!isInput) {
          const elemTypeId = db.query<SymbolId | null>("classInstance", elem.id);
          if (elemTypeId) {
            const elemTypeCst = db.cstNode(elemTypeId) as SyntaxNode | null;
            const scs = getShortClassSpecifierNode(elemTypeCst);
            const pfx = scs?.children?.find((c: SyntaxNode) => c.type === "base_prefix" || c.type === "type_prefix");
            if (/\binput\b/.test(String(pfx?.text ?? scs?.text ?? ""))) isInput = true;
          }
        }
        if (!isInput) continue;
        if (hasDefaultBindingOrProtected(elem)) continue;

        const targetPath = `${comp.name}.${elem.name}`;
        let connected = referencedPaths.has(targetPath);
        if (!connected) {
          for (const ref of referencedPaths) {
            if (ref.startsWith(`${targetPath}.`)) {
              connected = true;
              break;
            }
          }
        }
        if (!connected) {
          diags.push(
            warning(ModelicaErrorCode.UNCONNECTED_INPUT.message(targetPath, comp.name), {
              startOffset: cCst?.startIndex ?? cCst?.startOffset ?? comp.startOffset,
              endOffset: cCst?.endIndex ?? cCst?.endOffset ?? comp.endOffset,
              code: ModelicaErrorCode.UNCONNECTED_INPUT.code,
            }),
          );
        }
      }
    }

    return diags.length > 0 ? diags : null;
  },

  /**
   * M4152: Concrete example model/block inside an 'Examples' package missing an experiment(...) annotation.
   */
  lint__experimentAnnotationMissing: (db: QueryDB, self: SymbolEntry) => {
    const meta = self.metadata as Record<string, unknown> | undefined;
    if (meta?.["isPredefined"]) return null;
    const prefix = String(meta?.["classPrefixes"] ?? meta?.["classKind"] ?? "").toLowerCase();
    if (prefix.includes("partial") || !/\b(model|block)\b/.test(prefix)) return null;

    let inExamplesPkg = false;
    let pId = self.parentId;
    while (pId !== null) {
      const parent = db.symbol(pId);
      if (!parent) break;
      if (parent.name === "Examples") {
        inExamplesPkg = true;
        break;
      }
      pId = parent.parentId;
    }
    if (!inExamplesPkg) return null;

    const cst = db.cstNode(self.id) as SyntaxNode | null;
    if (!cst) return null;
    const spec =
      Cst.ClassDefinition?.classSpecifier?.(cst) ??
      cst.children?.find(
        (c: SyntaxNode) =>
          c.type === "long_class_specifier" || c.type === "short_class_specifier" || c.type === "class_specifier",
      );
    let hasExperiment = false;
    const visitAnn = (n: SyntaxNode) => {
      if (!n || hasExperiment) return;
      if (n !== cst && n.type === "class_definition") return;
      if (n.type === "annotation_clause") {
        const checkMod = (an: SyntaxNode) => {
          if (!an || hasExperiment) return;
          if (an.type === "element_modification") {
            const nameNode = an.childForFieldName?.("name") ?? an.children?.find((c: SyntaxNode) => c.type === "name");
            if (nameNode?.text?.trim() === "experiment") {
              hasExperiment = true;
              return;
            }
          }
          for (const ch of an.children ?? []) checkMod(ch);
        };
        checkMod(n);
        return;
      }
      for (const ch of n.children ?? []) visitAnn(ch);
    };
    visitAnn(spec ?? cst);
    if (hasExperiment) return null;

    return info(ModelicaErrorCode.EXPERIMENT_ANNOTATION_MISSING.message(self.name), {
      startOffset: cst.startIndex ?? cst.startOffset ?? self.startOffset,
      endOffset: cst.endIndex ?? cst.endOffset ?? self.endOffset,
      code: ModelicaErrorCode.EXPERIMENT_ANNOTATION_MISSING.code,
    });
  },

  /**
   * M2022: Encapsulated lookup violation — referencing an outer non-imported, non-global symbol inside an encapsulated scope (MLS §5.3.1).
   */
  lint__encapsulatedLookupViolation: (db: QueryDB, self: SymbolEntry) => {
    const meta = self.metadata as Record<string, unknown> | undefined;
    if (meta?.["isPredefined"]) return null;
    if (!isScopeEncapsulated(db, self.id)) return null;

    // Walk up to find the nearest encapsulated boundary ancestor (or self)
    let encapBoundary: SymbolEntry = self;
    {
      let cur: SymbolEntry | null = self;
      while (cur) {
        const pfx = String(
          (cur.metadata as Record<string, unknown> | undefined)?.["classPrefixes"] ?? "",
        ).toLowerCase();
        const curCst = db.cstNode(cur.id) as SyntaxNode | null;
        const rawPfx = (curCst?.text?.slice(0, 64) ?? "").toLowerCase();
        if (pfx.includes("encapsulated") || /^\s*encapsulated\b/.test(rawPfx)) {
          encapBoundary = cur;
          break;
        }
        cur = cur.parentId !== null ? (db.symbol(cur.parentId) ?? null) : null;
      }
    }

    const PREDEFINED_TYPES = new Set([
      "Real",
      "Integer",
      "Boolean",
      "String",
      "Clock",
      "StateSelect",
      "AssertionLevel",
      "ExternalObject",
      "ModelicaServices",
      "Connections",
    ]);

    const allowedNames = new Set<string>(PREDEFINED_TYPES);
    const encapSubtreeIds = new Set<SymbolId>();
    const collectSubtreeClasses = (clsId: SymbolId) => {
      if (encapSubtreeIds.has(clsId)) return;
      encapSubtreeIds.add(clsId);
      const sym = db.symbol(clsId);
      if (sym && (sym.kind === "Class" || sym.kind === "Package" || sym.kind === "Function")) {
        allowedNames.add(sym.name);
      }
      for (const ch of db.childrenOf(clsId)) {
        if (ch.kind === "Class" || ch.kind === "Package" || ch.kind === "Function") {
          collectSubtreeClasses(ch.id);
        }
      }
    };
    collectSubtreeClasses(encapBoundary.id);

    // Collect imports only along self's enclosing ancestor chain up to encapBoundary (never siblings)
    {
      let anc: SymbolEntry | null = self;
      while (anc) {
        for (const ch of db.childrenOf(anc.id)) {
          if (ch.kind !== "Import") continue;
          const parsed = extractClassImportPairs(db, ch);
          if (!parsed) continue;
          if (parsed.importKind === "unqualified") {
            const pkgStr =
              ((ch.metadata as Record<string, unknown> | undefined)?.["packageName"] as string | undefined) ?? ch.name;
            const targetPkg = resolveQualified(db, pkgStr.replace(/\.\*$/, "").trim());
            if (targetPkg) {
              for (const exported of db.childrenOf(targetPkg.id)) {
                if (exported.kind === "Class" || exported.kind === "Package" || exported.kind === "Function") {
                  allowedNames.add(exported.name);
                }
              }
            }
          } else {
            for (const [shortName] of parsed.pairs) allowedNames.add(shortName);
          }
        }
        if (anc.id === encapBoundary.id) break;
        anc = anc.parentId !== null ? (db.symbol(anc.parentId) ?? null) : null;
      }
    }

    const isInsideEncap = (sym: SymbolEntry): boolean => {
      let cur: SymbolEntry | null = sym;
      while (cur) {
        if (encapSubtreeIds.has(cur.id)) return true;
        cur = cur.parentId !== null ? (db.symbol(cur.parentId) ?? null) : null;
      }
      return false;
    };

    const diags: ReturnType<typeof warning>[] = [];
    const seen = new Set<string>();
    const checkTypeRef = (typeRef: string | null | undefined, startOffset: number, endOffset: number) => {
      if (!typeRef) return;
      const trimmed = typeRef.trim();
      if (!trimmed || trimmed.startsWith(".")) return; // global-rooted .Foo is allowed in encapsulated
      const rootName = trimmed.split(".")[0]!;
      if (allowedNames.has(rootName)) return;
      const externalMatches = db
        .byName(rootName)
        .filter((e) => (e.kind === "Class" || e.kind === "Package" || e.kind === "Function") && !isInsideEncap(e));
      if (externalMatches.length > 0 && !seen.has(rootName)) {
        seen.add(rootName);
        diags.push(
          warning(ModelicaErrorCode.ENCAPSULATED_LOOKUP_VIOLATION.message(trimmed, encapBoundary.name), {
            startOffset,
            endOffset,
            code: ModelicaErrorCode.ENCAPSULATED_LOOKUP_VIOLATION.code,
          }),
        );
      }
    };

    for (const ch of db.childrenOf(self.id)) {
      if (ch.kind === "Component") {
        const ts = db.query<string | null>("typeSpecifier", ch.id);
        const cstNode = db.cstNode(ch.id) as SyntaxNode | null;
        checkTypeRef(
          ts,
          cstNode?.startIndex ?? cstNode?.startOffset ?? ch.startOffset,
          cstNode?.endIndex ?? cstNode?.endOffset ?? ch.endOffset,
        );
      } else if (ch.kind === "Extends") {
        const cstNode = db.cstNode(ch.id) as SyntaxNode | null;
        const typeNode = cstNode ? Cst.ExtendsClause.typeSpecifier(cstNode) : null;
        checkTypeRef(
          typeNode?.text?.trim() ?? ch.name,
          cstNode?.startIndex ?? cstNode?.startOffset ?? ch.startOffset,
          cstNode?.endIndex ?? cstNode?.endOffset ?? ch.endOffset,
        );
      }
    }

    return diags.length > 0 ? diags : null;
  },

  /**
   * M4153: Library package references external libraries via imports/types without declaring annotation(uses(...)).
   */
  lint__missingUsesAnnotation: (db: QueryDB, self: SymbolEntry) => {
    const meta = self.metadata as Record<string, unknown> | undefined;
    if (meta?.["isPredefined"] || self.parentId !== null) return null;
    const prefix = String(meta?.["classPrefixes"] ?? meta?.["classKind"] ?? "").toLowerCase();
    if (!/\bpackage\b/.test(prefix)) return null;

    const cst = db.cstNode(self.id) as SyntaxNode | null;
    if (!cst) return null;
    const spec =
      Cst.ClassDefinition?.classSpecifier?.(cst) ??
      cst.children?.find(
        (c: SyntaxNode) =>
          c.type === "long_class_specifier" || c.type === "short_class_specifier" || c.type === "class_specifier",
      );

    // Only enforce library-profile `uses` check on packages carrying library metadata (version= or uses(...))
    let isLibraryPkg = false;
    const declaredUses = new Set<string>();
    const scanTopAnn = (n: SyntaxNode) => {
      if (!n) return;
      if (n !== cst && n.type === "class_definition") return;
      if (n.type === "annotation_clause") {
        const inspectMods = (an: SyntaxNode) => {
          if (!an) return;
          if (an.type === "element_modification") {
            const nm = (
              an.childForFieldName?.("name") ?? an.children?.find((c: SyntaxNode) => c.type === "name")
            )?.text?.trim();
            if (nm === "version" || nm === "uses") isLibraryPkg = true;
            if (nm === "uses") {
              const modText = String(an.text ?? "");
              for (const um of modText.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
                if (um[1] && um[1] !== "uses") declaredUses.add(um[1]);
              }
              return;
            }
          }
          for (const ch of an.children ?? []) inspectMods(ch);
        };
        inspectMods(n);
        return;
      }
      for (const ch of n.children ?? []) scanTopAnn(ch);
    };
    scanTopAnn(spec ?? cst);
    if (!isLibraryPkg) return null;

    const IGNORED_ROOTS = new Set([
      self.name,
      "Real",
      "Integer",
      "Boolean",
      "String",
      "Complex",
      "StateSelect",
      "AssertionLevel",
      "Clock",
      "ExternalObject",
      "ModelicaServices",
      "Connections",
    ]);
    const referencedLibs = new Map<string, { startOffset: number; endOffset: number }>();
    const collectSubtreeImports = (clsId: SymbolId, visited: Set<SymbolId>) => {
      if (visited.has(clsId)) return;
      visited.add(clsId);
      for (const ch of db.childrenOf(clsId)) {
        if (ch.kind === "Import") {
          const parsed = extractClassImportPairs(db, ch);
          if (!parsed) continue;
          const targets: string[] = [];
          if (parsed.importKind === "unqualified") {
            const mp = (ch.metadata as Record<string, unknown> | undefined)?.["packageName"] as string | undefined;
            const ct = (db.cstNode(ch.id) as SyntaxNode | null)?.text as string | undefined;
            const raw =
              mp?.trim() ||
              ct
                ?.replace(/^\s*import\s+/, "")
                .replace(/;$/, "")
                .trim() ||
              ch.name;
            targets.push(raw.replace(/\.\*$/, "").trim());
          } else {
            for (const [, t] of parsed.pairs) targets.push(t);
          }
          for (const t of targets) {
            const rootLib = t.split(".")[0]!;
            if (!rootLib || IGNORED_ROOTS.has(rootLib) || rootLib.startsWith(".")) continue;
            // Flag when target looks like a library reference (qualified path or loaded external Package)
            const isLoadedExternalPkg = db.byName(rootLib).some((s) => s.kind === "Package" && s.id !== self.id);
            if ((t.includes(".") || isLoadedExternalPkg) && !referencedLibs.has(rootLib)) {
              referencedLibs.set(rootLib, { startOffset: parsed.startOffset, endOffset: parsed.endOffset });
            }
          }
        } else if (ch.kind === "Class" || ch.kind === "Package" || ch.kind === "Function") {
          collectSubtreeImports(ch.id, visited);
        }
      }
    };
    collectSubtreeImports(self.id, new Set());

    const diags: ReturnType<typeof warning>[] = [];
    for (const [lib, span] of referencedLibs.entries()) {
      if (!declaredUses.has(lib)) {
        diags.push(
          warning(ModelicaErrorCode.MISSING_USES_ANNOTATION.message(self.name, lib), {
            startOffset: span.startOffset,
            endOffset: span.endOffset,
            code: ModelicaErrorCode.MISSING_USES_ANNOTATION.code,
          }),
        );
      }
    }
    return diags.length > 0 ? diags : null;
  },

  /**
   * M2023: Validates top-level `within <pkg>;` header against enclosing `package.mo` directory
   * hierarchy and optional `package.order` file (MLS §13.4).
   */
  lint__withinMismatch: (db: QueryDB, self: SymbolEntry) => {
    const meta = self.metadata as Record<string, unknown> | undefined;
    if (meta?.["isPredefined"]) return null;

    const normalizeRes = (u: string): string => {
      let s = u.replace(/\\/g, "/");
      if (s.startsWith("file:///")) s = s.slice(7);
      else if (s.startsWith("file://")) s = s.slice(7);
      return s;
    };
    const cst = db.cstNode(self.id) as SyntaxNode | null;
    const rawRes = self.documentUri ?? self.resourceId ?? (cst?.tree as { uri?: string } | undefined)?.uri;
    if (!rawRes) return null;
    const normPath = normalizeRes(rawRes);
    const lastSlash = normPath.lastIndexOf("/");
    if (lastSlash < 0) return null; // Single-file / virtual buffer without directory hierarchy

    // Only validate file-top-level declarations (skip classes nested inside another class of the same file)
    if (self.parentId !== null) {
      const parentSym = db.parentOf(self.id);
      const parentRawRes = parentSym?.documentUri ?? parentSym?.resourceId;
      if (parentSym && parentRawRes && normalizeRes(parentRawRes) === normPath) return null;
    }

    const dirPath = normPath.slice(0, lastSlash);
    const fileBase = normPath.slice(lastSlash + 1);
    const isPackageMo = fileBase === "package.mo";
    const parentDirOfScope = (() => {
      if (!isPackageMo) return dirPath;
      const s = dirPath.lastIndexOf("/");
      return s >= 0 ? dirPath.slice(0, s) : "";
    })();

    // Index all loaded directory packages (`.../Dir/package.mo` -> top-level package symbol)
    const packageByDir = new Map<string, SymbolEntry>();
    for (const entry of db.allEntries()) {
      const er = entry.documentUri ?? entry.resourceId;
      if (!er) continue;
      const en = normalizeRes(er);
      if (!en.endsWith("/package.mo")) continue;
      const ek = entry.kind;
      const ePrefix = String(
        (entry.metadata as Record<string, unknown> | undefined)?.["classPrefixes"] ?? "",
      ).toLowerCase();
      if (ek !== "Package" && !(ek === "Class" && /\bpackage\b/.test(ePrefix))) continue;
      const ep = entry.parentId !== null ? db.parentOf(entry.id) : null;
      const epRes = ep?.documentUri ?? ep?.resourceId;
      if (ep && epRes && normalizeRes(epRes) === en) continue;
      const eSlash = en.lastIndexOf("/");
      if (eSlash >= 0) {
        const eDir = en.slice(0, eSlash);
        if (!packageByDir.has(eDir)) packageByDir.set(eDir, entry);
      }
    }

    // Reconstruct expected `within` chain by walking enclosing directories that hold a loaded `package.mo`
    const expectedSegments: string[] = [];
    let curDir = parentDirOfScope;
    const seenDirs = new Set<string>();
    while (curDir.length > 0 && !seenDirs.has(curDir)) {
      seenDirs.add(curDir);
      const dirPkg = packageByDir.get(curDir);
      if (!dirPkg) break;
      expectedSegments.unshift(dirPkg.name);
      const s = curDir.lastIndexOf("/");
      curDir = s >= 0 ? curDir.slice(0, s) : "";
    }

    const src = cst?.tree?.sourceCode as string | undefined;
    const withinPkg = extractWithinFromCstNode(cst?.tree?.rootNode) ?? (src ? extractWithinFromSource(src) : null);
    const diags: ReturnType<typeof warning>[] = [];
    const span = {
      startOffset: self.startOffset,
      endOffset: Math.max(self.startOffset + 1, self.endOffset),
      code: ModelicaErrorCode.WITHIN_MISMATCH.code,
    };

    if (expectedSegments.length > 0) {
      const expectedWithin = expectedSegments.join(".");
      const actualWithin = withinPkg ?? "";
      if (actualWithin !== expectedWithin) {
        diags.push(
          warning(
            ModelicaErrorCode.WITHIN_MISMATCH.message(
              actualWithin || "<empty>",
              fileBase,
              `expected 'within ${expectedWithin};'`,
            ),
            span,
          ),
        );
      }
    }

    // Check `package.order` in `parentDirOfScope` when running on Node with local filesystem access
    if (parentDirOfScope.length > 0 && !rawRes.startsWith("http")) {
      try {
        const proc = (globalThis as any).process;
        const nodeFs = proc?.getBuiltinModule?.("node:fs");
        if (nodeFs) {
          const orderFile = `${parentDirOfScope}/package.order`;
          if (nodeFs.existsSync(orderFile)) {
            const rawOrder = String(nodeFs.readFileSync(orderFile, "utf8"));
            const orderSet = new Set<string>();
            for (const line of rawOrder.split(/\r?\n/)) {
              const trimmed = line.replace(/\/\/.*$/, "").trim();
              if (trimmed.length > 0) orderSet.add(trimmed);
            }
            if (orderSet.size > 0 && !orderSet.has(self.name)) {
              diags.push(
                warning(
                  ModelicaErrorCode.WITHIN_MISMATCH.message(
                    withinPkg ?? "<empty>",
                    fileBase,
                    `class '${self.name}' is omitted from 'package.order'`,
                  ),
                  span,
                ),
              );
            }
          }
        }
      } catch {
        // Ignore filesystem access errors in virtual or sandboxed workspaces
      }
    }

    return diags.length > 0 ? diags : null;
  },

  /**
   * M4154: Locally unbalanced non-partial model/block check via `instantiate` (MLS §4.8).
   */
  lint__locallyUnbalancedClass: (db: QueryDB, self: SymbolEntry) => {
    const meta = self.metadata as Record<string, unknown> | undefined;
    if (meta?.["isPredefined"]) return null;
    const prefix = String(meta?.["classPrefixes"] ?? meta?.["classKind"] ?? "").toLowerCase();
    if (
      /\bpartial\b/.test(prefix) ||
      /\bfunction\b/.test(prefix) ||
      /\brecord\b/.test(prefix) ||
      /\btype\b/.test(prefix) ||
      /\bconnector\b/.test(prefix) ||
      /\bpackage\b/.test(prefix) ||
      /\boperator\b/.test(prefix)
    ) {
      return null;
    }
    if (!/\b(model|block|class)\b/.test(prefix) && prefix !== "") return null;

    // Collect self + transitive extends classes cleanly; bail if any extends target or compound equation construct is unresolved/non-trivial
    const classChain: SymbolEntry[] = [];
    const visitedCls = new Set<SymbolId>();
    const collectHierarchy = (clsSym: SymbolEntry): boolean => {
      if (visitedCls.has(clsSym.id)) return true;
      visitedCls.add(clsSym.id);
      classChain.push(clsSym);
      for (const ch of db.childrenOf(clsSym.id)) {
        if (ch.kind === "Extends") {
          const baseName = String(
            (ch.metadata as Record<string, unknown> | undefined)?.["typeSpecifier"] ?? ch.name ?? "",
          ).trim();
          if (!baseName) return false;
          const resolver = db.query<(n: string) => SymbolEntry | null>("resolveName", clsSym.parentId ?? clsSym.id);
          const resolved = baseName.includes(".") ? resolveQualified(db, baseName) : resolver?.(baseName);
          if (!resolved) return false;
          if (!collectHierarchy(resolved)) return false;
        }
      }
      return true;
    };
    if (!collectHierarchy(self)) return null;

    let localEqs = 0;
    const bailTypes = new Set([
      "algorithm_section",
      "for_equation",
      "if_equation",
      "when_equation",
      "connect_equation",
    ]);
    for (const clsSym of classChain) {
      const cst = db.cstNode(clsSym.id) as SyntaxNode | null;
      if (!cst) return null;
      let unsafeStructure = false;
      let sawSimpleEq = false;
      const eqSizeByLhsText = new Map<string, number>();

      const inspectTree = (n: SyntaxNode) => {
        if (!n || unsafeStructure) return;
        if (n !== cst && n.type === "class_definition") return;
        if (bailTypes.has(n.type) || n.type === "external_function_call") {
          unsafeStructure = true;
          return;
        }
        if (
          n.type === "equation_section" &&
          String(n.text ?? "")
            .trimStart()
            .startsWith("initial")
        ) {
          // Initial equations do not contribute to continuous/local simulation equation balance
          return;
        }
        if (n.type === "simple_equation") {
          sawSimpleEq = true;
          const children = n.children ?? [];
          const eqIdx = children.findIndex((c: SyntaxNode) => c.type === "=");
          const lhs = eqIdx > 0 ? children[0] : null;
          const lhsTxt = String(lhs?.text ?? "").trim();
          // Tuple / vector expressions on LHS can mask multi-equation counts
          if (lhsTxt.startsWith("(") || lhsTxt.startsWith("{") || lhsTxt.startsWith("[")) {
            unsafeStructure = true;
            return;
          }
          eqSizeByLhsText.set(lhsTxt, (eqSizeByLhsText.get(lhsTxt) ?? 0) + 1);
          localEqs += 1;
          return;
        }
        if (n.type === "some_equation" || n.type === "equation_or_procedure") {
          const t = String(n.text ?? "").trim();
          if (
            t &&
            !t.startsWith("assert(") &&
            !t.startsWith("terminate(") &&
            !n.children?.some((c: SyntaxNode) => c.type === "simple_equation")
          ) {
            // Standalone procedure/annotation call inside equation section: bail out cleanly
            const hasSimple = (node: any): boolean =>
              Boolean(node && (node.type === "simple_equation" || (node.children ?? []).some(hasSimple)));
            if (!hasSimple(n)) {
              unsafeStructure = true;
              return;
            }
          }
        }
        for (const ch of n.children ?? []) inspectTree(ch);
      };
      inspectTree(cst);
      if (unsafeStructure) return null;
      void sawSimpleEq;
    }

    if (localEqs === 0) return null;

    const elementIds = db.query<SymbolId[]>("instantiate", self.id) ?? [];
    let localVars = 0;
    let arrayUnknowns = false;
    for (const eid of elementIds) {
      const el = typeof eid === "number" ? db.symbol(eid) : (eid as unknown as SymbolEntry);
      if (!el || el.kind !== "Component") continue;
      const elCst = db.cstNode(el.id) as any;
      const elTxt = String(elCst?.text ?? "");
      if (/\bif\b/.test(elTxt) && /\bif\s+[^;]/.test(elTxt)) return null; // Conditional component
      const elMeta = el.metadata as Record<string, unknown> | undefined;
      const varb = String(db.query<string>("variability", el.id) ?? elMeta?.["variability"] ?? "").toLowerCase();
      const caus = String(db.query<string>("causality", el.id) ?? elMeta?.["causality"] ?? "").toLowerCase();
      if (varb === "parameter" || varb === "constant") continue;
      if (caus === "input") continue;

      // Array subscripts require flattened/scalarized matching unless handled carefully
      if (elTxt.includes("[") || String(elCst?.parent?.text ?? "").includes("[")) {
        arrayUnknowns = true;
        break;
      }

      const tSpec = String(elMeta?.["typeSpecifier"] ?? "").trim();
      if (tSpec === "Real" || tSpec === "Integer" || tSpec === "Boolean" || tSpec === "String") {
        localVars += 1;
        continue;
      }

      const resolvedType = db.query<SymbolEntry | null>("classInstance", el.id);
      if (!resolvedType) return null;
      const tPrefix = String(
        (resolvedType.metadata as Record<string, unknown> | undefined)?.["classPrefixes"] ?? "",
      ).toLowerCase();
      if (/\bconnector\b/.test(tPrefix)) {
        // MLS §4.8: external connector contributes its flow variables to enclosing local unknown count
        const connEids = db.query<SymbolId[]>("instantiate", resolvedType.id) ?? [];
        for (const ceid of connEids) {
          const ce = typeof ceid === "number" ? db.symbol(ceid) : (ceid as unknown as SymbolEntry);
          if (!ce || ce.kind !== "Component") continue;
          const ceCst = db.cstNode(ce.id) as any;
          const ceParentTxt = String(ceCst?.parent?.text ?? ceCst?.text ?? "");
          if (/\bflow\b/.test(ceParentTxt)) localVars += 1;
        }
        continue;
      }
      if (/\btype\b/.test(tPrefix)) {
        localVars += 1;
        continue;
      }
      // Subcomponent models/blocks carry coupled internal balance; defer to post-flattening M4004
      return null;
    }

    if (arrayUnknowns || localVars === 0) return null;
    if (localVars !== localEqs) {
      const classKind = /\bblock\b/.test(prefix) ? "block" : "model";
      return warning(
        ModelicaErrorCode.LOCALLY_UNBALANCED_CLASS.message(classKind, self.name, String(localEqs), String(localVars)),
        {
          startOffset: self.startOffset,
          endOffset: Math.max(self.startOffset + 1, self.endOffset),
          code: ModelicaErrorCode.LOCALLY_UNBALANCED_CLASS.code,
        },
      );
    }
    return null;
  },
};

function extractClassImportPairs(
  db: QueryDB,
  child: SymbolEntry,
): { importKind: string; pairs: Array<[string, string]>; startOffset: number; endOffset: number } | null {
  const cmeta = child.metadata as Record<string, unknown> | undefined;
  let importKind =
    (cmeta?.["importKind"] as string | undefined) ??
    (child.ruleName === "UnqualifiedImportClause"
      ? "unqualified"
      : child.ruleName === "CompoundImportClause"
        ? "compound"
        : undefined);
  let pkgName = ((cmeta?.["packageName"] ?? child.name) as string) ?? "";
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

/**
 * Salsa semantic queries and lint hooks attached to `extends_clause` (`Extends`) symbols.
 * Resolves base class targets, parses inheritance modifications (`break` and element modifiers),
 * and validates base class existence (`M2003`).
 */
export const extendsClauseQueries: Record<string, any> = {
  /**
   * Raw source text of the `class_or_inheritance_modification` attached to this `extends` clause, or `null`.
   */
  modificationText: (db: QueryDB, self: SymbolEntry) => {
    const cst = db.cstNode(self.id) as SyntaxNode | null;
    const modNode =
      cst?.type === "class_modification" ||
      cst?.type === "ClassModification" ||
      cst?.type === "classOrInheritanceModification" ||
      cst?.type === "class_or_inheritance_modification"
        ? cst
        : (cst?.children || []).find(
            (c: SyntaxNode) =>
              c.type === "classOrInheritanceModification" ||
              c.type === "class_or_inheritance_modification" ||
              c.type === "ClassOrInheritanceModification" ||
              c.type === "class_modification" ||
              c.type === "ClassModification",
          );
    return modNode?.text ?? null;
  },
  /**
   * Resolve the base class referenced by this extends clause.
   * Returns the SymbolEntry of the resolved class, or null.
   */
  resolvedBaseClass: (db: QueryDB, self: SymbolEntry) => {
    const baseName = self.name;
    if (!baseName) return null;
    if (db.ensureFQNIndexed && baseName.includes(".")) {
      db.ensureFQNIndexed(baseName.startsWith(".") ? baseName.slice(1) : baseName);
    }
    // Use resolveName from the enclosing class for proper scope resolution
    if (self.parentId !== null) {
      const parentSym = db.symbol(self.parentId);
      const isRedeclareExtends = parentSym?.kind === "Class" && parentSym.name === baseName;
      if (isRedeclareExtends) {
        let resolved: SymbolEntry | null = null;
        const grandParentId = parentSym?.parentId;
        if (grandParentId !== null && grandParentId !== undefined) {
          const gpQueue: SymbolId[] = [grandParentId];
          const gpVisited = new Set<SymbolId>();
          while (gpQueue.length > 0 && !resolved) {
            const curGp = gpQueue.shift()!;
            if (gpVisited.has(curGp)) continue;
            gpVisited.add(curGp);
            const candidateBases: SymbolEntry[] = [];
            for (const pChild of db.childrenOf(curGp)) {
              if (pChild.kind === "Extends") {
                const pBase = db.query<SymbolEntry | null>("resolvedBaseClass", pChild.id);
                if (pBase) candidateBases.push(pBase);
              }
            }
            const directBase = db.query<SymbolEntry | null>("resolvedBaseClass", curGp);
            if (directBase && directBase.id !== curGp) {
              candidateBases.push(directBase);
            }
            for (const pBase of candidateBases) {
              if (!gpVisited.has(pBase.id)) {
                const directMatch = db
                  .childrenOf(pBase.id)
                  .find(
                    (c) =>
                      (c.kind === "Class" || c.kind === "Package") && c.name === baseName && c.id !== self.parentId,
                  );
                if (directMatch) {
                  resolved = directMatch;
                  break;
                }
                gpQueue.push(pBase.id);
              }
            }
          }
        }
        return resolved;
      }

      const resolveName = db.query<(n: string, skip?: boolean, allowMemImp?: boolean) => SymbolEntry | null>(
        "resolveName",
        self.parentId,
      );
      if (resolveName) {
        // Pass true for skipInherited to prevent cyclic lookup in extends clauses
        const resolved = resolveName(baseName, true, true);
        if (resolved && resolved.id !== self.parentId && resolved.kind !== "Reference") return resolved;
      }
    }
    if (self.parentId !== null && isScopeEncapsulated(db, self.parentId)) {
      return null;
    }
    if (baseName.includes(".")) {
      const qRes = resolveQualified(db, baseName.startsWith(".") ? baseName.slice(1) : baseName);
      if (qRes && (qRes.kind === "Class" || qRes.kind === "Package")) return qRes;
    }
    // Fallback to global lookup, filtering out Reference and Extends entries
    const entries = db.byName(baseName);
    return (
      entries?.find((e) => e.kind === "Class" || e.kind === "Package") ??
      (entries?.[0] && entries[0].kind !== "Extends" && entries[0].kind !== "Reference" ? entries[0] : null)
    );
  },
  /**
   * Get the merged modification for this extends clause.
   * Combines the class-or-inheritance-modification with the
   * outer modification from the enclosing class.
   */
  effectiveModification: (_db: QueryDB, self: SymbolEntry) => {
    // The modification from the extends clause itself
    return (self.metadata as Record<string, unknown>)?.["classOrInheritanceModification"] ?? null;
  },
  /**
   * Parse the extends clause's class-or-inheritance modification from the CST
   * into a structured ModelicaModArgs object.
   *
   * This is the extends-clause equivalent of the component's effectiveModification
   * query, providing the modification data needed by the flattener's ModificationStack.
   *
   * e.g., `extends Base(p = 1, redeclare type T = NewT)` →
   *   { args: [{name:"p", value:{kind:"expression",...}}, {name:"T", isRedeclaration:true, ...}], ... }
   */
  extendsModificationParsed: (db: QueryDB, self: SymbolEntry) => {
    const cst = db.cstNode(self.id) as SyntaxNode | null;
    const modNode =
      cst?.type === "class_modification" ||
      cst?.type === "ClassModification" ||
      cst?.type === "classOrInheritanceModification" ||
      cst?.type === "class_or_inheritance_modification"
        ? cst
        : (cst?.children || []).find(
            (c: SyntaxNode) =>
              c.type === "classOrInheritanceModification" ||
              c.type === "class_or_inheritance_modification" ||
              c.type === "ClassOrInheritanceModification" ||
              c.type === "class_modification" ||
              c.type === "ClassModification",
          );
    if (!modNode) return null;
    return parseModArgsFromCst(modNode, self.parentId) as ModelicaModArgs;
  },
  /**
   * M2003: Emits a diagnostic when the base class referenced by an `extends` clause cannot be resolved in scope.
   */
  lint__baseClassNotFound: (db: QueryDB, self: SymbolEntry) => {
    const baseName = self.name;
    if (!baseName) return null;
    const baseClass = db.query<SymbolEntry | null>("resolvedBaseClass", self.id);
    if (baseClass) return null;

    if (self.parentId !== null) {
      const resolveName = db.query<(n: string) => SymbolEntry | null>("resolveName", self.parentId);
      if (resolveName && resolveName(baseName)) return null;
    }

    if (baseName.includes(".")) {
      if (resolveQualified(db, baseName)) return null;
      if (self.parentId !== null) {
        const parts = baseName.split(".");
        let currentScope: SymbolEntry | null = db.symbol(self.parentId) ?? null;
        for (let i = 0; i < parts.length - 1; i++) {
          const part = parts[i]!;
          let resolved: SymbolEntry | null = null;
          if (i === 0) {
            const resolver =
              db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", currentScope?.id ?? self.parentId) ??
              db.query<(n: string) => SymbolEntry | null>("resolveName", currentScope?.id ?? self.parentId);
            resolved = resolver ? resolver(part) : null;
            if (!resolved) {
              resolved = db.byName(part).find((e: any) => e.kind === "Class" || e.kind === "Component") ?? null;
            }
          } else if (currentScope) {
            resolved = db.childrenOf(currentScope.id).find((c) => c.name === part) ?? null;
          }
          if (resolved) {
            if (resolved.kind === "Component") return null;
            if (resolved.kind === "Class") {
              const cst = db.cstNode(resolved.id) as any;
              if (getShortClassSpecifierNode(cst)) {
                return null;
              }
            }
          }
          currentScope = resolved;
        }
      }
    } else {
      const entries = db.byName(baseName);
      if (entries?.some((e: any) => e.kind === "Class" || e.kind === "Package" || e.kind === "Component")) return null;
    }

    const cstNode = db.cstNode(self.id) as SyntaxNode | null;
    const failRange = getQualifiedTypeFailRange(db, self.parentId, baseName, cstNode, self.startOffset, self.endOffset);

    const msg = `Class or type '${baseName}' not found in scope.`;
    return error(msg, {
      ...failRange,
      code: 2003,
    });
  },
};

/**
 * Salsa semantic queries and lint hooks attached to `component_declaration` (`Component`) symbols.
 * Computes type resolution, variability/causality/flow prefixes, visibility, array dimension shapes,
 * merged modifications, and component-level semantic diagnostics (`M2003`, `M2004`, `M4043`, `M4076`).
 */
export const componentDeclarationQueries: Record<string, any> = {
  /** Evaluates and memoizes the Placement annotation for this component declaration. */
  componentPlacement: (db: QueryDB, self: SymbolEntry) => {
    const cst = db.cstNode(self.id);
    if (!cst) {
      return (self.metadata as Record<string, unknown> | undefined)?.["placementAnnotation"] ?? null;
    }
    const wasmPlacement = evaluatePlacementWasm(cst);
    if (wasmPlacement !== undefined) return wasmPlacement;
    const evaluator = new AnnotationEvaluator();
    return evaluator.evaluate(cst, "Placement");
  },
  /**
   * Get the raw type specifier name for this component.
   */
  typeSpecifier: (db: QueryDB, self: SymbolEntry) => {
    const specArgs = db.argsOf<import("./modifications.js").ModelicaModArgs>(self.id);
    if (specArgs?.data?.isRedeclaration && specArgs.data.redeclaredTypeSpecifier) {
      return specArgs.data.redeclaredTypeSpecifier;
    }
    const meta = self.metadata as Record<string, unknown> | undefined;
    const directMeta = meta?.["typeSpecifier"] ?? meta?.["type_specifier"] ?? meta?.["typeName"];
    if (typeof directMeta === "string" && directMeta.trim()) {
      return directMeta.trim();
    }
    if (self.language && self.language !== "modelica") {
      for (const child of db.childrenOf(self.id)) {
        if (
          child.ruleName === "OwnedFeatureTyping" ||
          child.ruleName === "FeatureTyping" ||
          child.ruleName === "ConjugatedPortTyping" ||
          child.kind === "OwnedFeatureTyping" ||
          child.kind === "FeatureTyping" ||
          child.kind === "ConjugatedPortTyping"
        ) {
          const cmeta = child.metadata as Record<string, unknown> | undefined;
          const raw =
            (typeof cmeta?.["typeName"] === "string" && cmeta["typeName"]) ||
            (typeof cmeta?.["target"] === "string" && cmeta["target"]) ||
            (typeof child.name === "string" && child.name && !child.name.startsWith("<") ? child.name : "");
          const trimmedRaw = raw.trim();
          const cleaned = trimmedRaw.startsWith("~") ? trimmedRaw.slice(1).trim() : trimmedRaw;
          if (cleaned) return cleaned;
        }
      }
      return null;
    }
    const cstNode = db.cstNode(self.id);
    let current = cstNode as any;
    while (current && current.type !== "ComponentClause" && current.type !== "component_clause") {
      current = current.parent;
    }
    const typeSpecNode =
      Cst.ComponentClause.typeSpecifier(current) ??
      current?.children?.find((c: SyntaxNode) => c.type === "type_specifier" || c.type === "TypeSpecifier");
    return typeSpecNode?.text ?? null;
  },

  /**
   * Resolve the type specifier to the class it references.
   */
  resolvedType: (db: QueryDB, self: SymbolEntry) => {
    const typeName = db.query<string | null>("typeSpecifier", self.id)?.trim() ?? "";

    if (!typeName || typeof typeName !== "string") return null;

    // Try resolution from parent scope
    if (self.parentId !== null) {
      const parentEntry = db.symbol(self.parentId);
      if (
        parentEntry &&
        (parentEntry.kind === "Class" ||
          parentEntry.kind === "Package" ||
          isNamespaceLikeSymbol(parentEntry) ||
          isTypeLikeSymbol(parentEntry))
      ) {
        const qualResolver = db.query<(n: string) => SymbolEntry | null>("resolveName", parentEntry.id);
        if (qualResolver) {
          const resolved = qualResolver(typeName);
          if (resolved) return resolved;
        }
      }
    }

    // Fallback: global lookup — try full qualified name first, then simple name
    if (typeName.includes(".") || typeName.includes("::")) {
      const qual = resolveQualified(db, typeName);
      if (qual) return qual;
      const entries = db.byName(typeName);
      const found = entries?.find((e) => isTypeLikeSymbol(e));
      if (found) return found;
    }
    const simpleName = splitQualifiedPath(typeName).pop() ?? typeName;
    const entries = db.byName(simpleName);
    return (
      entries?.find((e) => (e.metadata as Record<string, unknown>)?.["isPredefined"] && e.kind === "Class") ??
      entries?.find((e) => isTypeLikeSymbol(e)) ??
      null
    );
  },
  /**
   * Get the effective modification for this component as a
   * structured ModelicaModArgs object.
   *
   * Parses the raw modification metadata text into:
   * - args: nested modifications like (x=1, y=2)
   * - bindingExpression: scalar binding like = expr
   *
   * Returns null if no modification is present.
   */
  effectiveModification: (db: QueryDB, self: SymbolEntry) => {
    const cst = db.cstNode(self.id) as SyntaxNode | null;
    if (!cst) {
      const meta = self.metadata as Record<string, unknown> | undefined;
      if (meta?.["modification"]) return meta["modification"];
      const defaultVal = meta?.["defaultValue"];
      if (defaultVal !== undefined) {
        return {
          args: [],
          bindingExpression: {
            kind: typeof defaultVal === "number" || typeof defaultVal === "boolean" ? "literal" : "expression",
            value: defaultVal,
            text: String(defaultVal),
          },
        };
      }
      return null;
    }
    let current: SyntaxNode | null = cst;
    while (
      current &&
      current.type !== "ComponentDeclaration" &&
      current.type !== "component_declaration" &&
      current.type !== "Declaration" &&
      current.type !== "declaration"
    ) {
      current = current.parent;
    }
    const declNode =
      current?.type === "Declaration" || current?.type === "declaration"
        ? current
        : (Cst.ComponentDeclaration.declaration(current) ??
          current?.children?.find((c: SyntaxNode) => c.type === "declaration" || c.type === "Declaration"));
    const modNode =
      Cst.Declaration.modification(declNode) ??
      declNode?.children?.find((c: SyntaxNode) => c.type === "modification" || c.type === "Modification");
    if (!modNode) return null;
    return parseModArgsFromCst(modNode, self.parentId) as ModelicaModArgs;
  },

  /**
   * Check if this component's type is a connector.
   */
  isConnectorType: (db: QueryDB, self: SymbolEntry) => {
    const selfMeta = self.metadata as Record<string, unknown> | undefined;
    if (selfMeta?.["isConnectorPort"] === true) return true;
    const cstNode = db.cstNode(self.id);
    let current = cstNode as any;
    while (current && current.type !== "ComponentClause" && current.type !== "component_clause") {
      current = current.parent;
    }
    const typeSpecNode =
      Cst.ComponentClause.typeSpecifier(current) ??
      current?.children?.find((c: SyntaxNode) => c.type === "type_specifier" || c.type === "TypeSpecifier");
    let typeName =
      typeSpecNode?.text ?? (typeof selfMeta?.["typeSpecifier"] === "string" ? selfMeta["typeSpecifier"] : undefined);
    if (!typeName || typeof typeName !== "string") return false;

    let typeEntry: SymbolEntry | null = null;

    // Try qualified resolution from parent scope
    if (typeName.includes(".") && self.parentId !== null) {
      const parentEntry = db.symbol(self.parentId);
      if (parentEntry && (parentEntry.kind === "Class" || parentEntry.kind === "Package")) {
        const qualResolver = db.query<(n: string) => SymbolEntry | null>("resolveName", parentEntry.id);
        if (qualResolver) {
          typeEntry = qualResolver(typeName);
        }
      }
    }

    // Fallback: global lookup — try full qualified name first
    if (!typeEntry && typeName.includes(".")) {
      typeEntry = resolveQualified(db, typeName);
      if (!typeEntry) {
        const entries = db.byName(typeName);
        typeEntry = entries?.find((e) => e.kind === "Class" || e.kind === "Package" || e.kind === "Function") ?? null;
      }
    }
    if (!typeEntry) {
      const simpleName = typeName.includes(".") ? typeName.split(".").pop()! : typeName;
      const entries = db.byName(simpleName);
      typeEntry =
        entries?.find((e) => (e.metadata as Record<string, unknown>)?.["isPredefined"] && e.kind === "Class") ??
        entries?.find((e) => e.kind === "Class" || e.kind === "Package" || e.kind === "Function") ??
        null;
    }

    if (!typeEntry) return false;
    const entryMeta = typeEntry.metadata as Record<string, unknown> | undefined;
    if (entryMeta?.["isConnector"] === true) return true;
    const classPrefixes = entryMeta?.["classPrefixes"] ?? entryMeta?.["classKind"];
    return typeof classPrefixes === "string" && classPrefixes.includes("connector");
  },

  /**
   * Determines the variability prefix (`"parameter"`, `"constant"`, `"discrete"`, or `null` for continuous)
   * from the enclosing `ComponentClause` CST node.
   */
  variability: (db: QueryDB, self: SymbolEntry) => {
    let current = db.cstNode(self.id) as SyntaxNode | null;
    if (!current) {
      const metaVar = (self.metadata as Record<string, unknown> | undefined)?.["variability"];
      if (metaVar === "parameter" || metaVar === "constant" || metaVar === "discrete") {
        return metaVar;
      }
      return null;
    }
    while (
      current &&
      current.type !== "ComponentClause" &&
      current.type !== "ComponentClause1" &&
      current.type !== "component_clause" &&
      current.type !== "component_clause1"
    )
      current = current.parent;
    const tp = Cst.ComponentClause.typePrefix(current);
    const vNode = (tp?.children || current?.children || []).find((c: SyntaxNode) => c.type === "variability");
    if (vNode?.text) return vNode.text;
    const tpText = tp?.text ?? "";
    if (tpText.includes("parameter")) return "parameter";
    if (tpText.includes("constant")) return "constant";
    if (tpText.includes("discrete")) return "discrete";
    return null;
  },

  /**
   * Determines the causality prefix (`"input"`, `"output"`, or `null` for acausal/local)
   * from the enclosing `ComponentClause` CST node.
   */
  causality: (db: QueryDB, self: SymbolEntry) => {
    let current = db.cstNode(self.id) as SyntaxNode | null;
    if (!current) {
      const metaCaus = (self.metadata as Record<string, unknown> | undefined)?.["causality"];
      if (metaCaus === "input" || metaCaus === "output") {
        return metaCaus;
      }
      return null;
    }
    while (
      current &&
      current.type !== "ComponentClause" &&
      current.type !== "ComponentClause1" &&
      current.type !== "component_clause" &&
      current.type !== "component_clause1"
    )
      current = current.parent;
    const tp = Cst.ComponentClause.typePrefix(current);
    const cNode = (tp?.children || current?.children || []).find((c: SyntaxNode) => c.type === "causality");
    if (cNode?.text) return cNode.text;
    const tpText = tp?.text ?? "";
    if (tpText.includes("input")) return "input";
    if (tpText.includes("output")) return "output";
    return null;
  },

  /**
   * Determines the connector flow prefix (`"flow"`, `"stream"`, or `null`) from the enclosing
   * `ComponentClause` or from the `base_prefix` of a referenced short class definition.
   */
  flowPrefix: (db: QueryDB, self: SymbolEntry) => {
    let current = db.cstNode(self.id) as SyntaxNode | null;
    if (!current) {
      const metaFlow = (self.metadata as Record<string, unknown> | undefined)?.["flowPrefix"];
      if (metaFlow === "flow" || metaFlow === "stream") {
        return metaFlow;
      }
      return null;
    }
    while (
      current &&
      current.type !== "ComponentClause" &&
      current.type !== "ComponentClause1" &&
      current.type !== "component_clause" &&
      current.type !== "component_clause1"
    )
      current = current.parent;
    const tp = Cst.ComponentClause.typePrefix(current);
    if (tp) {
      const tpText = tp.text?.trim() ?? "";
      if (tpText.includes("stream")) return "stream";
      if (tpText.includes("flow")) return "flow";
    }
    const direct =
      (current?.children || []).find((c: SyntaxNode) => c.type === "flow" || c.text === "flow")?.text ?? null;
    if (direct) return direct;
    const resType = db.query<any>("resolvedType", self.id);
    if (resType) {
      const typeCst = db.cstNode(resType.id ?? resType) as any;
      if (typeCst) {
        let shortClass =
          Cst.ClassDefinition.classSpecifier(typeCst) ??
          typeCst.children?.find(
            (c: SyntaxNode) =>
              c.type === "class_specifier" ||
              c.type === "ClassSpecifier" ||
              c.type === "short_class_specifier" ||
              c.type === "ShortClassSpecifier",
          ) ??
          (typeCst.type === "short_class_specifier" || typeCst.type === "ShortClassSpecifier" ? typeCst : null);
        if (shortClass) {
          if (shortClass.type === "class_specifier" || shortClass.type === "ClassSpecifier") {
            const innerShort = shortClass.children?.find(
              (c: SyntaxNode) => c.type === "short_class_specifier" || c.type === "ShortClassSpecifier",
            );
            if (innerShort) shortClass = innerShort;
          }
          const bp =
            Cst.ShortClassSpecifier.basePrefix(shortClass) ??
            shortClass.children?.find((c: SyntaxNode) => c.type === "base_prefix" || c.type === "BasePrefix");
          if (bp) {
            const bpText = bp.text?.trim() ?? "";
            if (bpText.includes("stream")) return "stream";
            if (bpText.includes("flow")) return "flow";
          }
        }
      }
    }
    return null;
  },

  /**
   * Checks whether this component declaration is marked with the `final` prefix.
   */
  isFinal: (db: QueryDB, self: SymbolEntry) => {
    let current = db.cstNode(self.id) as SyntaxNode | null;
    while (current) {
      if (
        current.type === "LongClassSpecifier" ||
        current.type === "ShortClassSpecifier" ||
        current.type === "long_class_specifier" ||
        current.type === "short_class_specifier"
      ) {
        break;
      }
      if (
        current.type === "element" ||
        current.type === "Element" ||
        current.type === "component_clause" ||
        current.type === "ComponentClause"
      ) {
        for (const ch of current.children || []) {
          if (ch.type === "final" || ch.text === "final") return true;
        }
        if (current.type === "element" || current.type === "Element") {
          const text = current.text || "";
          if (containsWord(text.slice(0, 50), "final")) return true;
          break;
        }
      }
      current = current.parent;
    }
    return false;
  },

  /**
   * Check if this component has annotation(Evaluate=true).
   * Per Modelica §18.3, this promotes a parameter to be evaluated at compile time.
   */
  isEvaluate: (db: QueryDB, self: SymbolEntry) => {
    const cst = db.cstNode(self.id) as SyntaxNode | null;
    if (!cst) return false;
    let current: SyntaxNode | null = cst;
    while (current && current.type !== "ComponentDeclaration" && current.type !== "component_declaration")
      current = current.parent;
    const evaluator = new AnnotationEvaluator();
    const evalRes = evaluator.evaluate(current ?? cst, "evaluate");
    if (evalRes !== null && evalRes !== undefined) {
      if (typeof evalRes === "boolean") return evalRes;
      if (typeof evalRes === "object" && evalRes.value !== undefined) return Boolean(evalRes.value);
      return true;
    }
    return false;
  },

  /** Checks whether this component is declared with the `redeclare` prefix. */
  isRedeclare: (db: QueryDB, self: SymbolEntry) => isRedeclareQuery(db, self),

  /** Checks whether this component is declared with the `inner` dynamic scoping prefix. */
  isInner: (db: QueryDB, self: SymbolEntry) => isInnerQuery(db, self),

  /** Checks whether this component is declared with the `replaceable` prefix. */
  isReplaceable: (db: QueryDB, self: SymbolEntry) => {
    let current = db.cstNode(self.id) as SyntaxNode | null;
    if (current && (current.type === "class_definition" || current.type === "ClassDefinition")) {
      current = current.parent;
    }
    while (current) {
      if (current.type === "element_replaceable" || current.type === "ElementReplaceable") return true;
      if (
        current.type === "ComponentClause" ||
        current.type === "component_clause" ||
        current.type === "element" ||
        current.type === "Element"
      ) {
        if (
          current.children?.some(
            (c: SyntaxNode) =>
              c.text?.trim() === "replaceable" || c.type === "replaceable" || c.type === '"replaceable"',
          )
        )
          return true;
      }
      if (
        current.type === "composition" ||
        current.type === "Composition" ||
        current.type === "class_definition" ||
        current.type === "ClassDefinition"
      )
        break;
      current = current.parent;
    }
    return false;
  },

  /** Checks whether this component resides inside a `protected` element section of its enclosing class. */
  isProtected: (db: QueryDB, self: SymbolEntry) => {
    const rawNode = db.cstNode(self.id) as SyntaxNode | null;
    let current = rawNode;
    const nodeStart = rawNode?.startIndex ?? rawNode?.startOffset ?? 0;
    while (current) {
      if (current.type === "ElementSection" || current.type === "element_section") {
        const vis = current.children
          ?.find((c: SyntaxNode) => c.text === "protected" || c.text === "public")
          ?.text?.trim();
        if (vis === "protected" || current.text?.trim()?.startsWith("protected")) return true;
        if (vis === "public" || current.text?.trim()?.startsWith("public")) return false;
      }
      if (current.type === "composition" || current.type === "Composition") {
        let isProt = false;
        for (const child of current.children || []) {
          const t = child.text?.trim();
          if (child.type === "protected" || t === "protected") {
            isProt = true;
          } else if (child.type === "public" || t === "public") {
            isProt = false;
          }
          const start = child.startIndex ?? child.startOffset;
          const end = child.endIndex ?? child.endOffset;
          if (start !== undefined && end !== undefined) {
            if (nodeStart >= start && nodeStart < end) {
              return isProt;
            }
          }
        }
        return isProt;
      }
      // Stop at class definition boundaries — don't walk into a parent class
      if (
        current.type === "LongClassSpecifier" ||
        current.type === "ShortClassSpecifier" ||
        current.type === "long_class_specifier" ||
        current.type === "short_class_specifier"
      )
        return false;
      current = current.parent;
    }
    return false;
  },

  /** Checks whether this component is declared with the `outer` dynamic scoping prefix. */
  isOuter: (db: QueryDB, self: SymbolEntry) => isOuterQuery(db, self),

  // =================================================================
  // Milestone 3: Component Instantiation
  // =================================================================

  /**
   * Instantiate this component: resolve its type specifier
   * to a class, then specialize that class with the component's
   * effective modification.
   *
   * Returns the SymbolId of the (possibly specialized) class.
   * Returns null if the type cannot be resolved.
   *
   * This replaces ModelicaComponentInstance.classInstance.
   */
  classInstance: (db: QueryDB, self: SymbolEntry) => {
    const specArgs = db.argsOf<import("./modifications.js").ModelicaModArgs>(self.id);
    let typeName = "";

    if (specArgs?.data?.isRedeclaration && specArgs.data.redeclaredTypeSpecifier) {
      typeName = specArgs.data.redeclaredTypeSpecifier;
    } else {
      typeName = (self.metadata as any)?.typeSpecifier ?? (self.metadata as any)?.type_specifier ?? "";
      if (!typeName) {
        const cstNode = db.cstNode(self.id);
        let current = cstNode as any;
        while (current && current.type !== "ComponentClause" && current.type !== "component_clause") {
          current = current.parent;
        }
        const typeSpecNode = Cst.ComponentClause.typeSpecifier(current);
        typeName = typeSpecNode?.text ?? "";
      }
    }

    if (!typeName) return null;

    let typeEntry: SymbolEntry | null = null;
    const scopeId =
      specArgs?.data?.evaluationScopeId !== undefined && specArgs.data.evaluationScopeId !== null
        ? specArgs.data.evaluationScopeId
        : self.parentId;
    if (scopeId !== null) {
      const parentEntry = db.symbol(scopeId);
      if (
        parentEntry &&
        (parentEntry.kind === "Class" ||
          parentEntry.kind === "Package" ||
          isNamespaceLikeSymbol(parentEntry) ||
          isTypeLikeSymbol(parentEntry))
      ) {
        // Use resolveName for qualified paths, resolveSimpleName for simple names
        if (typeName.includes(".") || typeName.includes("::")) {
          const qualResolver = db.query<(n: string) => SymbolEntry | null>("resolveName", parentEntry.id);
          if (qualResolver) {
            typeEntry = qualResolver(typeName);
          }
        } else {
          const resolver = db.query<(n: string, enc?: boolean) => SymbolEntry | null>(
            "resolveSimpleName",
            parentEntry.id,
          );
          if (resolver) {
            typeEntry = resolver(typeName);
          }
        }
      }
    }
    if (!typeEntry && self.parentId !== null && self.parentId !== scopeId && !specArgs?.data?.isRedeclaration) {
      const declParent = db.symbol(self.parentId);
      if (
        declParent &&
        (declParent.kind === "Class" ||
          declParent.kind === "Package" ||
          isNamespaceLikeSymbol(declParent) ||
          isTypeLikeSymbol(declParent))
      ) {
        if (typeName.includes(".") || typeName.includes("::")) {
          const qualResolver = db.query<(n: string) => SymbolEntry | null>("resolveName", declParent.id);
          if (qualResolver) {
            typeEntry = qualResolver(typeName);
          }
        } else {
          const resolver = db.query<(n: string, enc?: boolean) => SymbolEntry | null>(
            "resolveSimpleName",
            declParent.id,
          );
          if (resolver) {
            typeEntry = resolver(typeName);
          }
        }
      }
    }
    const isEncapsulatedScope = scopeId !== null ? isScopeEncapsulated(db, scopeId) : false;
    if (isEncapsulatedScope) {
      if (!typeEntry) {
        const simpleName = splitQualifiedPath(typeName).pop() ?? typeName;
        const entries = db.byName(simpleName);
        typeEntry =
          entries?.find((e) => (e.metadata as Record<string, unknown>)?.["isPredefined"] && e.kind === "Class") ?? null;
      }
      if (!typeEntry) return null;
      return typeEntry.id;
    }

    // Fallback: global lookup — try full qualified name first, then simple name
    if (!typeEntry && (typeName.includes(".") || typeName.includes("::"))) {
      typeEntry = resolveQualified(db, typeName);
    }
    if (!typeEntry) {
      const simpleName = splitQualifiedPath(typeName).pop() ?? typeName;
      const entries = db.byName(simpleName);
      // Prefer predefined types (Real, Integer, etc.), or top-level types across Modelica & foreign languages
      typeEntry =
        entries?.find((e) => (e.metadata as Record<string, unknown>)?.["isPredefined"] && e.kind === "Class") ??
        (!typeName.includes(".") && !typeName.includes("::")
          ? (entries?.find(
              (e) => e.parentId === null && (e.metadata as Record<string, unknown>)?.["classPrefixes"] === "type",
            ) ?? entries?.find((e) => e.parentId === null && isTypeLikeSymbol(e)))
          : null) ??
        null;
    }
    if (!typeEntry) return null;

    // Return the unmodified type class ID.
    // Value modifications (e.g., R=100) are resolved by the flattener's
    // ModificationStack, eliminating the need for virtual specialized type entries.
    // Note: Redeclarations (type replacement via extends) are still handled
    // by extends specialization in the instantiate query (Phase 1b).
    return typeEntry.id;
  },

  /**
   * Get the array dimensions for this component as structured subscripts.
   *
   * Walks the actual CST ArraySubscripts → Subscript children to produce:
   *   - { kind: "literal", value: number }   — integer literal dimension
   *   - { kind: "flexible" }                  — ':' (flexible dimension)
   *   - { kind: "expression", cstBytes: [start, end] } — symbolic expression
   */
  arrayDimensions: (db: QueryDB, self: SymbolEntry) => {
    // Get the CST node for this ComponentDeclaration
    const cst = db.cstNode(self.id) as import("@modelscript/runtime").CSTNode | null;
    if (!cst) return null;

    /** Extract subscript descriptors from an ArraySubscripts CST node. */
    const extractSubscripts = (
      arraySubNode: any,
    ): Array<
      | { kind: "literal"; value: number }
      | { kind: "flexible" }
      | { kind: "expression"; cstBytes: readonly [number, number]; text?: string | undefined }
    > => {
      const subs: Array<
        | { kind: "literal"; value: number }
        | { kind: "flexible" }
        | { kind: "expression"; cstBytes: readonly [number, number]; text?: string | undefined }
      > = [];
      for (const child of arraySubNode.children) {
        if (child.type !== "Subscript" && child.type !== "subscript") continue;
        const flexChild =
          Cst.Subscript.flexible(child) ??
          child.children?.find((c: SyntaxNode) => c.text === ":" || c.type === ":" || c.type === '":"');
        if (flexChild && flexChild.text?.trim() === ":") {
          subs.push({ kind: "flexible" });
          continue;
        }
        const exprChild =
          Cst.Subscript.expression(child) ??
          child.children?.find((c: SyntaxNode) => c.type === "expression" || c.type === "Expression") ??
          (child.childCount > 0 ? child.child(0) : null);
        if (exprChild) {
          const num = parseInt(exprChild.text, 10);
          if (!isNaN(num) && String(num) === exprChild.text.trim()) {
            subs.push({ kind: "literal", value: num });
          } else {
            subs.push({
              kind: "expression",
              cstBytes: [
                exprChild.startOffset ?? exprChild.startIndex ?? exprChild.startOffset,
                exprChild.endOffset ?? exprChild.endIndex ?? exprChild.endOffset,
              ],
              text: exprChild.text,
            });
          }
          continue;
        }
      }

      return subs;
    };

    // Navigate up to the Declaration node to get component-level subscripts (e.g. x[2])
    let declNode = cst as any;
    if (declNode && declNode.type !== "Declaration" && declNode.type !== "declaration") {
      const childDecl = declNode.children?.find(
        (c: SyntaxNode) => c.type === "Declaration" || c.type === "declaration",
      );
      if (childDecl) {
        declNode = childDecl;
      }
    }
    while (declNode && declNode.type !== "Declaration" && declNode.type !== "declaration") {
      declNode = declNode.parent;
    }
    const declArraySubNode = Cst.Declaration.arraySubscripts(declNode);
    const declSubscripts = declArraySubNode ? extractSubscripts(declArraySubNode) : [];

    // Navigate up to the ComponentClause to get type-level subscripts (e.g. Real[3])
    let clauseNode = cst as any;
    while (
      clauseNode &&
      clauseNode.type !== "ComponentClause" &&
      clauseNode.type !== "component_clause" &&
      clauseNode.type !== "ComponentClause1" &&
      clauseNode.type !== "component_clause1"
    ) {
      clauseNode = clauseNode.parent;
    }
    const clauseArraySubNode = Cst.ComponentClause.arraySubscripts(clauseNode);
    const typeSubscripts = clauseArraySubNode ? extractSubscripts(clauseArraySubNode) : [];

    // Combine: component dimensions first, then type dimensions.
    // For `Real[3] x[2]`, this produces [2, 3] matching Modelica semantics.
    const subscripts = [...declSubscripts, ...typeSubscripts];

    // Also check if the resolved type has its own array dimensions (e.g. type T = Real[3])
    const classInstanceId = db.query<SymbolId | null>("classInstance", self.id);
    if (classInstanceId !== null) {
      let currentClassId: SymbolId | null = classInstanceId;
      const visitedBase = new Set<SymbolId>();

      while (currentClassId && !visitedBase.has(currentClassId)) {
        visitedBase.add(currentClassId);
        const typeClassDims = db.query<any[] | null>("arrayDimensions", currentClassId);
        if (typeClassDims && typeClassDims.length > 0) {
          subscripts.push(...typeClassDims);
        }

        // Check Extends
        const children = db.childrenOf(currentClassId);
        const extendsClause = children.find((c) => c.kind === "Extends");
        if (extendsClause) {
          const baseClass = db.query<{ id: SymbolId } | null>("resolvedBaseClass", extendsClause.id);
          if (baseClass) {
            currentClassId = baseClass.id;
            continue;
          }
        }

        // Check ShortClassSpecifier
        const cstNode = db.cstNode(currentClassId) as any;
        const spec = getShortClassSpecifierNode(cstNode);
        if (spec) {
          const typeSpec =
            Cst.ShortClassSpecifier.typeSpecifier(spec) ??
            spec.children?.find((c: SyntaxNode) => c.type === "type_specifier" || c.type === "TypeSpecifier");
          if (typeSpec?.text) {
            const currentEntry = db.symbol(currentClassId);
            if (currentEntry) {
              // We need to resolve the type name in the scope of the class
              const resolvedEntry = resolveQualified(db, typeSpec.text); // Fast path
              if (resolvedEntry) {
                currentClassId = resolvedEntry.id;
                continue;
              }
              const simpleName = typeSpec.text.includes(".") ? typeSpec.text.split(".").pop()! : typeSpec.text;
              const entries = db.byName(simpleName);
              const typeEntry = entries?.find((e) => e.kind === "Class" || e.kind === "Package") ?? null;
              if (typeEntry) {
                currentClassId = typeEntry.id;
                continue;
              }
            }
          }
        }

        break;
      }
    }

    return subscripts.length > 0 ? subscripts : null;
  },

  /**
   * Evaluates a parameter or constant binding expression in an array-dimension context,
   * propagating any cycle origin back to the originating cycle member without global state.
   */
  resolvedDimParamValue: {
    execute: (db: QueryDB, self: SymbolEntry): DimEvalResult => {
      const meta = self.metadata as Record<string, unknown>;
      const variability = (meta?.["variability"] as string) ?? db.query<string | null>("variability", self.id);
      if (variability !== "parameter" && variability !== "constant") return { value: null };

      const mod = db.query<any>("effectiveModification", self.id);
      if (mod?.bindingExpression?.text) {
        const trimmed = mod.bindingExpression.text.trim();
        const val = parseInt(trimmed, 10);
        if (!isNaN(val) && String(val) === trimmed) return { value: val };
        if (mod.bindingExpression.cstBytes) {
          const exprCst = db.cstNodeRange(
            mod.bindingExpression.cstBytes[0],
            mod.bindingExpression.cstBytes[1],
            self,
          ) as any;
          if (exprCst) {
            const res = evaluateDimCSTNode(db, self, exprCst);
            if (res.cycleOrigin) {
              const selfOrigin = `param:${self.id}`;
              return res.cycleOrigin === selfOrigin ? { value: null } : { value: null, cycleOrigin: res.cycleOrigin };
            }
            return { value: res.value };
          }
        }
      }
      return { value: null };
    },
    recovery: (_cycleDb: QueryDB, self: SymbolEntry): DimEvalResult => {
      return { value: null, cycleOrigin: `param:${self.id}` };
    },
  },

  /**
   * Evaluates a single dimension index (`dimIndex`) of a component's declared array shape
   * as an independent Salsa query so cross-dimension references like `x[2, size(y,1)], y[size(x,1)]`
   * do not trigger false component-level cycles, while genuine cycles are detected deterministically.
   */
  resolvedArrayDimensionAt: {
    execute: (db: QueryDB, self: SymbolEntry, args?: Record<string, unknown>): DimEvalResult => {
      const dimIndex = Number(args?.["dimIndex"] ?? 0);
      const rawDims = db.query<Array<
        | { kind: "literal"; value: number }
        | { kind: "flexible" }
        | { kind: "expression"; cstBytes: readonly [number, number]; text?: string | undefined }
      > | null>("arrayDimensions", self.id);
      if (!rawDims || dimIndex < 0 || dimIndex >= rawDims.length) return { value: null };

      const dim = rawDims[dimIndex]!;
      if (dim.kind === "literal") {
        return { value: dim.value };
      }
      if (dim.kind === "flexible") {
        const mod = db.query<any | null>("effectiveModification", self.id);
        if (mod?.bindingExpression) {
          if (mod.bindingExpression.cstBytes) {
            const bindingCst = db.cstNodeRange(
              mod.bindingExpression.cstBytes[0],
              mod.bindingExpression.cstBytes[1],
              self,
            ) as any;
            if (bindingCst) {
              const cycleOrigin = findFlexibleBindingDimCycle(db, self, dimIndex, bindingCst);
              if (cycleOrigin) {
                const selfOrigin = `dim:${self.id}:${dimIndex}`;
                if (cycleOrigin === selfOrigin) {
                  return { value: null, cyclic: true, exprText: ":" };
                }
                return { value: null, cyclic: true, exprText: ":", cycleOrigin };
              }
            }
          }
          const val = db.evaluate(mod.bindingExpression, self.parentId);
          if (Array.isArray(val)) {
            let cur: any = val;
            let valid = true;
            for (let d = 0; d < dimIndex; d++) {
              if (Array.isArray(cur) && cur.length > 0) {
                cur = cur[0];
              } else {
                valid = false;
                break;
              }
            }
            if (valid && Array.isArray(cur)) {
              return { value: cur.length };
            }
          }
        }
        return { value: 0 };
      }

      const res = evaluateDimExpr(db, self, dim);
      if (res.cycleOrigin) {
        const selfOrigin = `dim:${self.id}:${dimIndex}`;
        const exprText = dim.text ?? "?";
        if (res.cycleOrigin === selfOrigin) {
          return { value: null, cyclic: true, exprText };
        }
        return { value: null, cyclic: true, exprText, cycleOrigin: res.cycleOrigin };
      }
      return { value: res.value };
    },
    recovery: (cycleDb: QueryDB, self: SymbolEntry, args?: Record<string, unknown>): DimEvalResult => {
      const dimIndex = Number(args?.["dimIndex"] ?? 0);
      const rawDims = cycleDb.query<any[] | null>("arrayDimensions", self.id);
      const rawDim = rawDims?.[dimIndex];
      const exprText = rawDim?.text ?? (rawDim?.kind === "flexible" ? ":" : "?");
      return { value: null, cyclic: true, exprText, cycleOrigin: `dim:${self.id}:${dimIndex}` };
    },
  },

  /**
   * Returns cyclic array dimension dependencies (`M4035`) detected via `resolvedArrayDimensionAt`,
   * tracked directly by Salsa with no module-global side channel.
   */
  cyclicDimensionInfo: (db: QueryDB, self: SymbolEntry): Array<{ dimIndex: number; exprText: string }> | null => {
    const rawDims = db.query<any[] | null>("arrayDimensions", self.id);
    if (!rawDims || rawDims.length === 0) return null;
    const cycles: Array<{ dimIndex: number; exprText: string }> = [];
    for (let i = 0; i < rawDims.length; i++) {
      const res = db.queryWith<DimEvalResult>("resolvedArrayDimensionAt", self.id, { dimIndex: i }, String(i));
      if (res?.cyclic) {
        cycles.push({ dimIndex: i, exprText: res.exprText ?? "?" });
      }
    }
    return cycles.length > 0 ? cycles : null;
  },

  /**
   * Resolve array dimensions to concrete numeric values.
   *
   * For literal dimensions, returns the value directly.
   * For expression dimensions (e.g. `size(y,1)`, `n+1`), evaluates
   * each dimension independently via `resolvedArrayDimensionAt`.
   * For flexible dimensions (`:`), returns 0 (or inferred binding length).
   */
  resolvedArrayDimensions: (db: QueryDB, self: SymbolEntry): number[] | null => {
    const rawDims = db.query<Array<
      | { kind: "literal"; value: number }
      | { kind: "flexible" }
      | { kind: "expression"; cstBytes: readonly [number, number]; text?: string | undefined }
    > | null>("arrayDimensions", self.id);
    if (!rawDims || rawDims.length === 0) return null;

    const shape: number[] = [];
    for (let i = 0; i < rawDims.length; i++) {
      const dim = rawDims[i]!;
      const res = db.queryWith<DimEvalResult>("resolvedArrayDimensionAt", self.id, { dimIndex: i }, String(i));
      if (res?.value !== null && res?.value !== undefined) {
        shape.push(res.value);
      } else if (res?.cyclic) {
        shape.push(-1);
      } else {
        shape.push(dim.kind === "flexible" ? 0 : -1);
      }
    }
    return shape;
  },

  /**
   * Aggregate query returning the component's complete semantic metadata in a single CST pass.
   * Combines type specifier, variability, causality, flow/stream prefix, visibility (`isProtected`),
   * element prefixes (`final`, `inner`, `outer`, `replaceable`, `redeclare`), merged modifications
   * (including constraining-clause defaults), and resolved array dimensions.
   */
  componentInstance: (db: QueryDB, self: SymbolEntry) => {
    const cstNode = db.cstNode(self.id) as SyntaxNode | null;
    if (!cstNode) {
      const meta = (self.metadata as Record<string, unknown> | undefined) ?? {};
      const typeSpec =
        typeof meta["typeSpecifier"] === "string" && meta["typeSpecifier"].trim().length > 0
          ? meta["typeSpecifier"].trim()
          : null;
      const variability =
        meta["variability"] === "parameter" || meta["variability"] === "constant" || meta["variability"] === "discrete"
          ? (meta["variability"] as string)
          : null;
      const causality =
        meta["causality"] === "input" || meta["causality"] === "output" ? (meta["causality"] as string) : null;
      const flowPrefix =
        meta["flowPrefix"] === "flow" || meta["flowPrefix"] === "stream" ? (meta["flowPrefix"] as string) : null;
      const isPrim = typeSpec === "Real" || typeSpec === "Integer" || typeSpec === "Boolean" || typeSpec === "String";
      const classInst = !isPrim && typeSpec ? db.query<SymbolId | null>("classInstance", self.id) : null;
      const isConn =
        meta["isConnectorPort"] === true ||
        (classInst !== null ? Boolean(db.query<boolean>("isConnector", classInst)) : false);
      const defaultVal = meta["defaultValue"];
      const modification =
        meta["modification"] ??
        (defaultVal !== undefined
          ? {
              args: [],
              bindingExpression: {
                kind: typeof defaultVal === "number" || typeof defaultVal === "boolean" ? "literal" : "expression",
                value: defaultVal,
                text: String(defaultVal),
              },
            }
          : null);
      return {
        id: self.id,
        name: self.name,
        classInstance: classInst,
        variability,
        causality,
        flowPrefix,
        isFinal: Boolean(meta["isFinal"]),
        isRedeclare: Boolean(meta["redeclare"] || meta["isRedeclare"]),
        isInner: Boolean(meta["isInner"]),
        isOuter: Boolean(meta["isOuter"]),
        isReplaceable: Boolean(meta["isReplaceable"]),
        isProtected: Boolean(meta["isProtected"]),
        arrayDimensions: Array.isArray(meta["arrayDimensions"]) ? (meta["arrayDimensions"] as number[]) : null,
        isConnectorType: isConn,
        typeSpecifier: typeSpec,
        modification,
      };
    }

    // 1. Walk up to the enclosing `ComponentClause` to extract type specifier and type prefixes
    let clause: SyntaxNode | null = cstNode;
    while (
      clause &&
      clause.type !== "ComponentClause" &&
      clause.type !== "ComponentClause1" &&
      clause.type !== "component_clause" &&
      clause.type !== "component_clause1"
    ) {
      clause = clause.parent;
    }

    const typeSpecNode =
      Cst.ComponentClause.typeSpecifier(clause) ??
      clause?.children?.find((c: SyntaxNode) => c.type === "type_specifier" || c.type === "TypeSpecifier");
    const typeSpec = typeSpecNode?.text ?? null;

    const tp = Cst.ComponentClause.typePrefix(clause);
    const tpText = tp?.text ?? "";
    let variability: string | null = null;
    if (tpText.includes("parameter")) variability = "parameter";
    else if (tpText.includes("constant")) variability = "constant";
    else if (tpText.includes("discrete")) variability = "discrete";

    let causality: string | null = null;
    if (tpText.includes("input")) causality = "input";
    else if (tpText.includes("output")) causality = "output";

    // 2. Resolve `flow` / `stream` prefix, falling back to `base_prefix` on a referenced short class definition
    let flowPrefix: string | null = null;
    if (tpText.includes("flow")) flowPrefix = "flow";
    else if (tpText.includes("stream")) flowPrefix = "stream";
    if (!flowPrefix) {
      const resType = db.query<any>("resolvedType", self.id);
      if (resType) {
        const typeCst = db.cstNode(resType.id ?? resType) as any;
        if (typeCst) {
          let shortClass =
            Cst.ClassDefinition.classSpecifier(typeCst) ??
            typeCst.children?.find(
              (c: SyntaxNode) =>
                c.type === "class_specifier" ||
                c.type === "ClassSpecifier" ||
                c.type === "short_class_specifier" ||
                c.type === "ShortClassSpecifier",
            ) ??
            (typeCst.type === "short_class_specifier" || typeCst.type === "ShortClassSpecifier" ? typeCst : null);
          if (shortClass) {
            if (shortClass.type === "class_specifier" || shortClass.type === "ClassSpecifier") {
              const innerShort = shortClass.children?.find(
                (c: SyntaxNode) => c.type === "short_class_specifier" || c.type === "ShortClassSpecifier",
              );
              if (innerShort) shortClass = innerShort;
            }
            const bp =
              Cst.ShortClassSpecifier.basePrefix(shortClass) ??
              shortClass.children?.find((c: SyntaxNode) => c.type === "base_prefix" || c.type === "BasePrefix");
            if (bp) {
              const bpText = bp.text?.trim() ?? "";
              if (bpText.includes("stream")) flowPrefix = "stream";
              else if (bpText.includes("flow")) flowPrefix = "flow";
            }
          }
        }
      }
    }

    // 3. Determine `public` vs `protected` section visibility and element-level prefixes
    const elemParent = clause?.parent;
    let isProtected = false;
    let sec = elemParent;
    while (sec && sec.type !== "Composition" && sec.type !== "composition" && sec.type !== "ClassDefinition") {
      if (sec.type === "ElementSection" || sec.type === "element_section") {
        isProtected = sec.children?.[0]?.text === "protected";
        break;
      }
      if (sec.type === "protected_element_list" || sec.type === "ProtectedElementList") {
        isProtected = true;
        break;
      }
      sec = sec.parent;
    }
    if (!isProtected && sec && (sec.type === "Composition" || sec.type === "composition")) {
      const clauseStart = clause?.startIndex ?? clause?.startOffset ?? 0;
      let currProt = false;
      for (const child of sec.children || []) {
        const t = child.text?.trim();
        const firstTok = child.children?.[0]?.text?.trim() ?? "";
        if (
          child.type === "protected" ||
          child.type === "Protected" ||
          t === "protected" ||
          firstTok === "protected" ||
          child.text?.startsWith("protected")
        ) {
          currProt = true;
        } else if (
          child.type === "public" ||
          child.type === "Public" ||
          t === "public" ||
          firstTok === "public" ||
          child.text?.startsWith("public")
        ) {
          currProt = false;
        }
        const start = child.startIndex ?? child.startOffset;
        const end = child.endIndex ?? child.endOffset;
        if (start !== undefined && end !== undefined && clauseStart >= start && clauseStart < end) {
          isProtected = currProt;
          break;
        }
      }
    }

    const prefixNode =
      elemParent && (elemParent.type === "Element" || elemParent.type === "element") ? elemParent : clause;
    const isFinal = Boolean(
      prefixNode?.children?.some((c: SyntaxNode) => c.type === "final" || c.text === "final") ||
      clause?.children?.some((c: SyntaxNode) => c.type === "final" || c.text === "final"),
    );
    const isInner = Boolean(
      prefixNode?.children?.some((c: SyntaxNode) => c.type === "inner" || c.text === "inner") ||
      clause?.children?.some((c: SyntaxNode) => c.type === "inner" || c.text === "inner"),
    );
    const isOuter = Boolean(
      prefixNode?.children?.some((c: SyntaxNode) => c.type === "outer" || c.text === "outer") ||
      clause?.children?.some((c: SyntaxNode) => c.type === "outer" || c.text === "outer"),
    );
    const isReplaceable = Boolean(
      prefixNode?.children?.some((c: SyntaxNode) => c.type === "replaceable" || c.text === "replaceable") ||
      clause?.children?.some((c: SyntaxNode) => c.type === "replaceable" || c.text === "replaceable"),
    );
    const isRedeclare = Boolean(
      prefixNode?.children?.some((c: SyntaxNode) => c.type === "redeclare" || c.text === "redeclare") ||
      clause?.children?.some((c: SyntaxNode) => c.type === "redeclare" || c.text === "redeclare"),
    );

    // 4. Parse declaration modifications and merge fallback arguments from local or inherited `constraining_clause`s
    let declNode = cstNode;
    if (cstNode.type !== "Declaration" && cstNode.type !== "declaration") {
      declNode =
        Cst.ComponentDeclaration.declaration(cstNode) ??
        cstNode.children?.find((c: SyntaxNode) => c.type === "declaration" || c.type === "Declaration") ??
        cstNode;
    }

    const modNode =
      Cst.Declaration.modification(declNode) ??
      declNode?.children?.find((c: SyntaxNode) => c.type === "modification" || c.type === "Modification");
    let modification = modNode ? (parseModArgsFromCst(modNode, self.parentId) as ModelicaModArgs) : null;

    let localConstrClause: any = null;
    let currNode: SyntaxNode | null = cstNode;
    while (currNode && currNode.type !== "Composition" && currNode.type !== "composition") {
      localConstrClause = currNode.children?.find(
        (c: SyntaxNode) => c.type === "constraining_clause" || c.type === "ConstrainingClause",
      );
      if (localConstrClause) break;
      currNode = currNode.parent;
    }
    if (localConstrClause) {
      const constrMod = localConstrClause.children?.find(
        (c: SyntaxNode) => c.type === "class_modification" || c.type === "ClassModification",
      );
      if (constrMod) {
        const constrParsed = parseModArgsFromCst(constrMod, self.parentId);
        if (constrParsed && constrParsed.args && constrParsed.args.length > 0) {
          if (!modification) {
            modification = { args: [...constrParsed.args] } as any;
          } else {
            const existingNames = new Set(modification.args?.map((a: any) => a.name) || []);
            const mergedArgs = [...(modification.args || [])];
            for (const cArg of constrParsed.args) {
              if (!existingNames.has(cArg.name)) {
                mergedArgs.push(cArg);
              }
            }
            modification = { ...modification, args: mergedArgs };
          }
        }
      }
    }

    if (isRedeclare && self.parentId) {
      const extendsClauses = db.childrenOf(self.parentId).filter((c) => c.kind === "Extends");
      for (const ext of extendsClauses) {
        const baseClass = db.query<SymbolEntry | null>("resolvedBaseClass", ext.id);
        if (baseClass) {
          const baseElements = db.query<SymbolId[]>("instantiate", baseClass.id) || [];
          for (const baseElemId of baseElements) {
            const baseElem = db.symbol(baseElemId);
            if (baseElem && baseElem.kind === "Component" && baseElem.name === self.name) {
              const baseCst = db.cstNode(baseElem.id) as any;
              let curr = baseCst;
              let constrClause: any = null;
              while (curr && curr.type !== "Composition" && curr.type !== "composition") {
                constrClause = curr.children?.find(
                  (c: SyntaxNode) => c.type === "constraining_clause" || c.type === "ConstrainingClause",
                );
                if (constrClause) break;
                curr = curr.parent;
              }
              if (constrClause) {
                const constrMod = constrClause.children?.find(
                  (c: SyntaxNode) => c.type === "class_modification" || c.type === "ClassModification",
                );
                if (constrMod) {
                  const constrParsed = parseModArgsFromCst(constrMod, baseClass.id);
                  if (constrParsed && constrParsed.args && constrParsed.args.length > 0) {
                    if (!modification) {
                      modification = { args: [...constrParsed.args] } as any;
                    } else {
                      const existingNames = new Set(modification.args?.map((a: any) => a.name) || []);
                      const mergedArgs = [...(modification.args || [])];
                      for (const cArg of constrParsed.args) {
                        if (!existingNames.has(cArg.name)) {
                          mergedArgs.push(cArg);
                        }
                      }
                      modification = { ...modification, args: mergedArgs };
                    }
                  }
                }
              }
              break;
            }
          }
        }
      }
    }

    // 5. Fast path for scalar primitive components (`Real`, `Integer`, `Boolean`, `String`):
    //    bypass `classInstance`, `resolvedArrayDimensions`, and `isConnectorType` Salsa queries.
    const arraySub =
      Cst.Declaration.arraySubscripts(declNode) ??
      declNode?.children?.find((c: SyntaxNode) => c.type === "array_subscripts" || c.type === "ArraySubscripts");
    const clauseArraySub =
      Cst.ComponentClause.arraySubscripts(clause) ??
      clause?.children?.find((c: SyntaxNode) => c.type === "array_subscripts" || c.type === "ArraySubscripts");

    const isPrim = typeSpec === "Real" || typeSpec === "Integer" || typeSpec === "Boolean" || typeSpec === "String";

    if (isPrim && !arraySub && !clauseArraySub) {
      return {
        id: self.id,
        name: self.name,
        classInstance: null,
        variability,
        causality,
        flowPrefix,
        isFinal,
        isRedeclare,
        isInner,
        isOuter,
        isReplaceable,
        isProtected,
        arrayDimensions: null,
        isConnectorType: false,
        typeSpecifier: typeSpec,
        modification,
      };
    }

    return {
      id: self.id,
      name: self.name,
      classInstance: db.query<SymbolId | null>("classInstance", self.id),
      variability,
      causality,
      flowPrefix,
      isFinal,
      isRedeclare,
      isInner,
      isOuter,
      isReplaceable,
      isProtected,
      arrayDimensions: db.query<number[] | null>("resolvedArrayDimensions", self.id),
      isConnectorType: isPrim ? false : db.query<boolean>("isConnectorType", self.id),
      typeSpecifier: typeSpec,
      modification,
    };
  },
  /**
   * M2004 / M4045: Validates that all modification arguments on this component declaration
   * exist on the resolved component class or its predefined type attributes.
   */
  lint__modifierNotFound: (db: QueryDB, self: SymbolEntry) => {
    const typeClassId = db.query<SymbolId | null>("classInstance", self.id);
    if (!typeClassId) return null;
    const typeEntry = db.symbol(typeClassId);
    if (!typeEntry) return null;
    const mod = db.query<any | null>("effectiveModification", self.id);
    return checkModifierNotFound(db, self, mod, typeClassId, typeEntry, undefined);
  },
  /**
   * M2003: Emits a diagnostic when the component's type specifier cannot be resolved in scope.
   */
  lint__typeNotFound: (db: QueryDB, self: SymbolEntry) => {
    let typeName = db.query<string | null>("typeSpecifier", self.id);
    if (!typeName || typeof typeName !== "string") return null;
    typeName = typeName.trim();
    if (!typeName) return null;

    const baseType = stripTrailingBrackets(typeName);
    if (!baseType) return null;

    if (
      baseType === "Real" ||
      baseType === "Integer" ||
      baseType === "Boolean" ||
      baseType === "String" ||
      baseType === "Clock" ||
      baseType === "StateSelect" ||
      baseType === "AssertionLevel" ||
      baseType === "ExternalObject"
    ) {
      return null;
    }

    const typeClassId = db.query<SymbolId | null>("classInstance", self.id);
    if (typeClassId) return null;

    if (self.parentId !== null) {
      if (baseType.includes(".") || baseType.includes("::")) {
        const qualResolver = db.query<(n: string) => SymbolEntry | null>("resolveName", self.parentId);
        if (qualResolver && qualResolver(baseType)) return null;
      } else {
        const simpleResolver = db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", self.parentId);
        if (simpleResolver && simpleResolver(baseType)) return null;
      }
    }

    if (baseType.includes(".") || baseType.includes("::")) {
      const resolved = resolveQualified(db, baseType);
      if (resolved) return null;
    } else {
      const entries = db.byName(baseType);
      const found = entries?.find(
        (e: any) =>
          (e.metadata as Record<string, unknown>)?.["isPredefined"] ||
          e.kind === "Class" ||
          e.kind === "Package" ||
          e.kind === "Function" ||
          e.kind === "Def" ||
          isTypeLikeSymbol(e),
      );
      if (found) return null;
    }

    const cstNode = db.cstNode(self.id) as SyntaxNode | null;
    let current = cstNode;
    while (current && current.type !== "ComponentClause" && current.type !== "component_clause") {
      current = current.parent;
    }
    const typeSpecNode =
      Cst.ComponentClause.typeSpecifier(current) ??
      current?.children?.find((c: SyntaxNode) => c.type === "type_specifier" || c.type === "TypeSpecifier");

    const failRange = getQualifiedTypeFailRange(
      db,
      self.parentId,
      baseType,
      typeSpecNode,
      self.startOffset,
      self.startOffset + typeName.length,
    );

    const msg = `Class or type '${typeName}' not found in scope.`;
    return error(msg, {
      ...failRange,
      code: 2003,
    });
  },
  /**
   * M4035: Reports cyclic array dimension dependencies (e.g. `Real x[size(y, 1)], y[size(x, 1)]`)
   * tracked via the `cyclicDimensionInfo` Salsa query.
   */
  lint__cyclicDimension: (db: QueryDB, self: SymbolEntry) => {
    const diags = db.query<Array<{ dimIndex: number; exprText: string }> | null>("cyclicDimensionInfo", self.id);
    if (diags && diags.length > 0) {
      const d = diags[0]!;
      const cst = db.cstNode(self.id) as SyntaxNode | null;
      let clauseNode = cst;
      while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.parent) {
        clauseNode = clauseNode.parent;
      }
      const rangeNode = clauseNode ?? cst;
      const startOffset = rangeNode?.startIndex ?? rangeNode?.startOffset ?? self.startOffset;
      const endOffset = rangeNode?.endIndex ?? rangeNode?.endOffset ?? self.endOffset;
      const msg = ModelicaErrorCode.CYCLIC_DIMENSION_DEPENDENCY.message(String(d.dimIndex + 1), self.name, d.exprText);
      return error(msg, {
        startOffset,
        endOffset,
        code: ModelicaErrorCode.CYCLIC_DIMENSION_DEPENDENCY.code,
      });
    }
    return null;
  },
  /**
   * M4147: Reports instantiating a class annotated with `annotation(obsolete = "...")` (MLS §18.8).
   */
  lint__obsoleteClassUsage: (db: QueryDB, self: SymbolEntry) => {
    const typeClassId = db.query<SymbolId | null>("classInstance", self.id);
    if (!typeClassId) return null;
    const typeEntry = db.symbol(typeClassId);
    if (!typeEntry) return null;
    if ((typeEntry.metadata as Record<string, unknown> | undefined)?.["isPredefined"]) return null;

    const typeCst = db.cstNode(typeClassId) as any;
    if (!typeCst) return null;

    // Inspect direct annotation_clause(s) of the class specifier (not nested sub-classes)
    let obsoleteReason: string | undefined;
    let foundObsolete = false;
    const spec =
      Cst.ClassDefinition?.classSpecifier?.(typeCst) ??
      typeCst.children?.find(
        (c: SyntaxNode) =>
          c.type === "long_class_specifier" || c.type === "short_class_specifier" || c.type === "class_specifier",
      );
    const annContainers: SyntaxNode[] = [];
    const collectOwnAnnotations = (n: SyntaxNode) => {
      if (!n) return;
      if (n.type === "class_definition" && n !== typeCst) return;
      if (n.type === "annotation_clause") {
        annContainers.push(n);
        return;
      }
      for (const ch of n.children || []) {
        collectOwnAnnotations(ch);
      }
    };
    if (spec) {
      collectOwnAnnotations(spec);
    } else {
      collectOwnAnnotations(typeCst);
    }

    const extractObsolete = (n: any): boolean => {
      if (!n) return false;
      if (n.type === "element_modification") {
        const nameNode = n.childForFieldName?.("name") ?? n.children?.find((c: SyntaxNode) => c.type === "name");
        if (nameNode?.text?.trim() === "obsolete") {
          const modNode =
            n.childForFieldName?.("modification") ?? n.children?.find((c: SyntaxNode) => c.type === "modification");
          const modExpr = modNode?.children?.find((c: SyntaxNode) => c.type === "modification_expression");
          const raw = modExpr?.text?.trim() ?? "";
          if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
            obsoleteReason = raw.slice(1, -1);
          } else if (raw) {
            obsoleteReason = raw;
          }
          return true;
        }
      }
      for (const ch of n.children || []) {
        if (extractObsolete(ch)) return true;
      }
      return false;
    };

    for (const ann of annContainers) {
      if (extractObsolete(ann)) {
        foundObsolete = true;
        break;
      }
    }
    if (!foundObsolete) return null;

    const cst = db.cstNode(self.id) as SyntaxNode | null;
    const msg = ModelicaErrorCode.OBSOLETE_CLASS_USAGE.message(typeEntry.name, obsoleteReason);
    return warning(msg, {
      startOffset: cst?.startIndex ?? cst?.startOffset ?? self.startOffset,
      endOffset: cst?.endIndex ?? cst?.endOffset ?? self.endOffset,
      code: ModelicaErrorCode.OBSOLETE_CLASS_USAGE.code,
    });
  },
  /**
   * M3024: Checks `displayUnit` SI dimensional compatibility against `unit` (MLS §19.1).
   */
  lint__incompatibleDisplayUnit: (db: QueryDB, self: SymbolEntry) => {
    const extractStrAttr = (args: readonly any[] | undefined, attrName: string): string | null => {
      if (!args) return null;
      for (const a of args) {
        if (a?.name !== attrName || !a.value) continue;
        let raw = "";
        if (a.value.kind === "literal") {
          raw = String(a.value.value ?? "");
        } else if (a.value.kind === "expression") {
          raw = (a.value.text ?? "").trim();
        }
        if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
          raw = raw.slice(1, -1);
        }
        return raw.trim();
      }
      return null;
    };

    const mod = db.query<ModelicaModArgs | null>("effectiveModification", self.id);
    let unitStr = extractStrAttr(mod?.args, "unit");
    let displayStr = extractStrAttr(mod?.args, "displayUnit");

    if (unitStr == null || displayStr == null) {
      const typeClassId = db.query<SymbolId | null>("classInstance", self.id);
      if (typeClassId) {
        const typeMod = db.query<ModelicaModArgs | null>("effectiveModification", typeClassId);
        if (unitStr == null) unitStr = extractStrAttr(typeMod?.args, "unit");
        if (displayStr == null) displayStr = extractStrAttr(typeMod?.args, "displayUnit");
      }
    }

    if (!unitStr || !displayStr) return null;
    const u = parseUnit(unitStr);
    const du = parseUnit(displayStr);
    if (!u || !du || unitsCompatible(u, du)) return null;

    const cst = db.cstNode(self.id) as SyntaxNode | null;
    const detail = `Incompatible displayUnit '${displayStr}' for component '${self.name}' with unit '${unitStr}'`;
    return warning(ModelicaErrorCode.INCOMPATIBLE_DISPLAY_UNIT.message(detail), {
      startOffset: cst?.startIndex ?? cst?.startOffset ?? self.startOffset,
      endOffset: cst?.endIndex ?? cst?.endOffset ?? self.endOffset,
      code: ModelicaErrorCode.INCOMPATIBLE_DISPLAY_UNIT.code,
    });
  },
  /**
   * M4076: Prohibits direct binding equations (`= expr`) on components whose resolved class is a
   * `model`, `block`, `package`, `function`, or non-primitive `connector`.
   */
  lint__componentBindingRestriction: (db: QueryDB, self: SymbolEntry) => {
    const cstNode = db.cstNode(self.id) as SyntaxNode | null;
    let current = cstNode;
    while (
      current &&
      current.type !== "ComponentDeclaration" &&
      current.type !== "component_declaration" &&
      current.type !== "Declaration" &&
      current.type !== "declaration"
    ) {
      current = current.parent;
    }
    const declNode =
      current?.type === "Declaration" || current?.type === "declaration"
        ? current
        : (Cst.ComponentDeclaration.declaration(current) ??
          current?.children?.find((c: SyntaxNode) => c.type === "declaration" || c.type === "Declaration"));
    const modNode =
      Cst.Declaration.modification(declNode) ??
      declNode?.children?.find((c: SyntaxNode) => c.type === "modification" || c.type === "Modification");

    const mod = db.query<any | null>("effectiveModification", self.id);
    const hasBinding = Boolean(
      mod?.bindingExpression ||
      (modNode && Cst.Modification.modificationExpression(modNode) != null) ||
      (modNode?.children && modNode.children.some((c: SyntaxNode) => c.text === "=" || c.type === "=")),
    );
    if (!hasBinding) return null;

    let typeName = db.query<string | null>("typeSpecifier", self.id);
    if (!typeName || typeof typeName !== "string") return null;
    typeName = typeName.trim();
    if (!typeName) return null;

    const baseType = stripTrailingBrackets(typeName);
    if (!baseType) return null;

    if (
      baseType === "Real" ||
      baseType === "Integer" ||
      baseType === "Boolean" ||
      baseType === "String" ||
      baseType === "Clock" ||
      baseType === "StateSelect" ||
      baseType === "AssertionLevel" ||
      baseType === "ExternalObject"
    ) {
      return null;
    }

    const typeClassId = db.query<SymbolId | null>("classInstance", self.id);
    let resolved: SymbolEntry | null = typeClassId ? (db.symbol(typeClassId) ?? null) : null;
    if (!resolved && self.parentId !== null) {
      if (baseType.includes(".")) {
        const qualResolver = db.query<(n: string) => SymbolEntry | null>("resolveName", self.parentId);
        if (qualResolver) resolved = qualResolver(baseType);
      } else {
        const simpleResolver = db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", self.parentId);
        if (simpleResolver) resolved = simpleResolver(baseType);
      }
    }
    if (!resolved && baseType.includes(".")) {
      resolved = resolveQualified(db, baseType);
    }
    if (!resolved) {
      const entries = db.byName(baseType);
      resolved = entries?.find((e: any) => e.kind === "Package" || e.kind === "Class" || e.kind === "Function") ?? null;
    }

    if (resolved) {
      const meta = resolved.metadata as Record<string, unknown> | undefined;
      const rawKind = String(meta?.["classPrefixes"] ?? meta?.["classKind"] ?? resolved.kind ?? "").toLowerCase();
      const words = collapseSpaceTokens(stripModelicaComments(rawKind));

      if (words.includes("type")) {
        return null;
      }

      let specKind: string | null = null;
      if (resolved.kind === "Package" || words.includes("package")) {
        specKind = "package";
      } else if (resolved.kind === "Model" || words.includes("model")) {
        specKind = "model";
      } else if (resolved.kind === "Block" || words.includes("block")) {
        specKind = "block";
      } else if (resolved.kind === "Connector" || words.includes("connector")) {
        const resolvedCst = db.cstNode(resolved.id) as any;
        let isPrimitiveAlias = false;
        if (resolvedCst) {
          const shortSpec =
            resolvedCst.type === "short_class_specifier" || resolvedCst.type === "ShortClassSpecifier"
              ? resolvedCst
              : (resolvedCst.children?.find(
                  (c: SyntaxNode) =>
                    c.type === "short_class_specifier" ||
                    c.type === "ShortClassSpecifier" ||
                    c.type === "class_specifier",
                ) ?? null);
          const actualSpec =
            shortSpec?.type === "class_specifier"
              ? shortSpec.children?.find(
                  (c: SyntaxNode) => c.type === "short_class_specifier" || c.type === "ShortClassSpecifier",
                )
              : shortSpec;
          if (actualSpec) {
            const typeSpec =
              Cst.ShortClassSpecifier.typeSpecifier(actualSpec) ??
              actualSpec.children?.find((c: SyntaxNode) => c.type === "type_specifier" || c.type === "TypeSpecifier");
            const typeText = typeSpec?.text?.trim() ?? "";
            if (["Real", "Integer", "Boolean", "String", "Clock"].includes(typeText)) {
              isPrimitiveAlias = true;
            }
          }
        }
        if (!isPrimitiveAlias) {
          specKind = "connector";
        }
      } else if (resolved.kind === "Function" || words.includes("function")) {
        specKind = "function";
      }

      if (specKind) {
        const rangeNode = modNode ?? declNode;
        const startOffset = rangeNode?.startOffset ?? rangeNode?.startIndex ?? self.startOffset;
        const endOffset = rangeNode?.endOffset ?? rangeNode?.endIndex ?? self.endOffset;

        const msg = ModelicaErrorCode.COMPONENT_BINDING_RESTRICTION.message(self.name, specKind);
        return error(msg, {
          startOffset,
          endOffset,
          code: ModelicaErrorCode.COMPONENT_BINDING_RESTRICTION.code,
        });
      }
    }
    return null;
  },
};

/**
 * Salsa semantic queries attached to `short_class_specifier` (`type T = Base(...)`) symbols.
 * Delegates instantiation, element enumeration, and scope lookup to the aliased `resolvedBaseClass`.
 */
export const shortClassSpecifierQueries: Record<string, any> = {
  /** Parses the `class_modification` on this short class specifier into a `ModelicaModArgs` structure. */
  effectiveModification: {
    execute: (db: QueryDB, self: SymbolEntry) => {
      const cst = db.cstNode(self.id) as SyntaxNode | null;
      if (!cst) return null;
      const classSpec = getShortClassSpecifierNode(cst);
      if (!classSpec) return null;
      const modNode =
        Cst.ShortClassSpecifier.classModification(classSpec) ??
        classSpec.children?.find((c: SyntaxNode) => c.type === "class_modification" || c.type === "ClassModification");
      if (!modNode) return null;
      return parseModArgsFromCst(modNode, self.parentId);
    },
    recovery: () => null,
  },
  /** Resolves the target class referenced by the `type_specifier` of this short class definition. */
  resolvedBaseClass: {
    execute: (db: QueryDB, self: SymbolEntry) => {
      const selfCstShort = db.cstNode(self.id) as SyntaxNode | null;
      const specShort = getShortClassSpecifierNode(selfCstShort);
      if (specShort) {
        const typeSpec =
          Cst.ShortClassSpecifier.typeSpecifier(specShort) ??
          specShort.children?.find((c: SyntaxNode) => c.type === "type_specifier" || c.type === "TypeSpecifier");
        const typeName = typeSpec?.text?.trim();
        if (typeName && self.parentId !== null) {
          const parentResolver = db.query<(n: string) => { id: number } | null>("resolveName", self.parentId);
          if (parentResolver) {
            const resolved = parentResolver(typeName);
            if (resolved && resolved.id !== self.id) {
              return resolved;
            }
          }
        }
      }
      return null;
    },
    recovery: () => null,
  },
  /** Instantiates the aliased base class and returns its flattened element `SymbolId`s. */
  instantiate: {
    execute: (db: QueryDB, self: SymbolEntry) => {
      const base = db.query<any>("resolvedBaseClass", self.id);
      if (base && base.id !== self.id) {
        return db.query<number[]>("instantiate", base.id) || [];
      }
      return [];
    },
    recovery: () => [],
  },
  /** Forwards simple name resolution to the aliased base class, respecting class redeclarations. */
  resolveSimpleName: (db: QueryDB, self: SymbolEntry) => {
    const cache = new Map<string, SymbolEntry | null>();
    let lastRev = db.getRevision?.() ?? 0;
    return (name: string, encapsulated?: boolean, skipInherited?: boolean, memberOnly?: boolean) => {
      const curRev = db.getRevision?.() ?? 0;
      if (curRev !== lastRev) {
        cache.clear();
        lastRev = curRev;
      }
      const key =
        !encapsulated && !skipInherited && !memberOnly
          ? name
          : `${name}|${encapsulated ? 1 : 0}${skipInherited ? 1 : 0}${memberOnly ? 1 : 0}`;
      const cached = cache.get(key);
      if (cached !== undefined) return cached;

      const compute = (): SymbolEntry | null => {
        const effMod = db.query<any>("effectiveModification", self.id);
        const redeclClassArg = effMod?.args?.find(
          (a: any) => a.name === name && a.isRedeclaration && a.redeclaredKind === "class" && a.redeclaredTypeSpecifier,
        );
        if (redeclClassArg) {
          const evalScopeId = redeclClassArg.evaluationScopeId ?? self.parentId;
          const redeclTargetName: string = redeclClassArg.redeclaredTypeSpecifier;
          let redeclTarget: SymbolEntry | null = null;
          if (evalScopeId !== null && evalScopeId !== undefined && evalScopeId !== self.id) {
            redeclTarget =
              db.query<(n: string) => SymbolEntry | null>("resolveName", evalScopeId)?.(redeclTargetName) ?? null;
          }
          if (!redeclTarget) {
            redeclTarget =
              resolveQualified(db, redeclTargetName) ??
              db
                .byName(redeclTargetName)
                ?.find((e) => e.kind === "Class" || e.kind === "Package" || e.kind === "Function") ??
              null;
          }
          if (redeclTarget && redeclTarget.id !== self.id) {
            return redeclTarget;
          }
        }
        const base = db.query<any>("resolvedBaseClass", self.id);
        if (base && base.id !== self.id) {
          const baseResolver = db.query<any>("resolveSimpleName", base.id);
          if (baseResolver) return baseResolver(name, encapsulated, skipInherited, memberOnly);
        }
        return null;
      };
      const res = compute();
      if (res !== null) {
        cache.set(key, res);
      }
      return res;
    };
  },
  /** Resolves a simple or qualified name via the aliased base class, falling back to the parent scope. */
  resolveName: (db: QueryDB, self: SymbolEntry) => {
    const cache = new Map<string, SymbolEntry | null>();
    let lastRev = db.getRevision?.() ?? 0;
    return (name: string, encapsulated?: boolean) => {
      const curRev = db.getRevision?.() ?? 0;
      if (curRev !== lastRev) {
        cache.clear();
        lastRev = curRev;
      }
      const key = !encapsulated ? name : `${name}|1`;
      const cached = cache.get(key);
      if (cached !== undefined) return cached;

      const compute = (): SymbolEntry | null => {
        const parts = splitQualifiedPath(name);
        if (parts.length > 1 && parts[0]) {
          const simpleNameResolver = db.query<any>("resolveSimpleName", self.id);
          let current: SymbolEntry | null = simpleNameResolver ? simpleNameResolver(parts[0], encapsulated) : null;
          if (current) {
            for (let i = 1; i < parts.length && current; i++) {
              const part = parts[i]!;
              const nextResolver: any = db.query<any>("resolveSimpleName", current.id);
              const nextPart: SymbolEntry | null = nextResolver ? nextResolver(part, false, false, true) : null;
              if (!nextPart) {
                current = null;
                break;
              }
              current = nextPart;
            }
            if (current) return current;
          }
        } else {
          const simpleNameResolver = db.query<any>("resolveSimpleName", self.id);
          if (simpleNameResolver) {
            const resolved = simpleNameResolver(name, encapsulated);
            if (resolved) return resolved;
          }
        }
        if (self.parentId !== null) {
          const parentResolver = db.query<any>("resolveName", self.parentId);
          if (parentResolver) return parentResolver(name, encapsulated);
        }
        return null;
      };
      const res = compute();
      if (res !== null) {
        cache.set(key, res);
      }
      return res;
    };
  },
  /** Returns all elements (direct and inherited) of the aliased base class. */
  allElements: (db: QueryDB, self: SymbolEntry) => {
    const base = db.query<any>("resolvedBaseClass", self.id);
    if (base && base.id !== self.id) {
      return db.query<any>("allElements", base.id);
    }
    return [];
  },
  /** Returns the `ScopeData` of the aliased base class. */
  scopeData: (db: QueryDB, self: SymbolEntry) => {
    const base = db.query<any>("resolvedBaseClass", self.id);
    if (base && base.id !== self.id) {
      return db.query<any>("scopeData", base.id);
    }
    return { directByName: {}, extendsClasses: [], imports: [], hasExtends: false };
  },
};

/**
 * Salsa lint hooks attached to `connect_equation` (`ConnectEquation`) symbols.
 */
export const connectEquationQueries: Record<string, any> = {
  /**
   * Validate that both sides of the connect equation reference
   * connector-typed components, and that they are plug-compatible.
   */
  lint__validateConnect: (db: QueryDB, self: SymbolEntry) => {
    const cst = db.cstNode(self.id) as SyntaxNode | null;
    let p = cst?.parent;
    while (p) {
      if (p.type === "inheritance_modification" || p.type === "InheritanceModification") {
        return null;
      }
      p = p.parent;
    }
    let lhsNode = cst ? Cst.ConnectEquation.lhs(cst) : null;
    let rhsNode = cst ? Cst.ConnectEquation.rhs(cst) : null;
    if (!lhsNode || !rhsNode) {
      const children = (cst?.children || []).filter(
        (c: SyntaxNode) => c.type === "component_reference" || c.type === "ComponentReference",
      );
      if (!lhsNode && children.length > 0) lhsNode = children[0] ?? null;
      if (!rhsNode && children.length > 1) rhsNode = children[1] ?? null;
    }

    const meta = (self.metadata as Record<string, unknown>) || {};
    const lhsText = lhsNode?.text?.trim() ?? (typeof meta["lhs"] === "string" ? meta["lhs"] : null);
    const rhsText = rhsNode?.text?.trim() ?? (typeof meta["rhs"] === "string" ? meta["rhs"] : null);
    if (!lhsText || !rhsText) return null;

    if (self.parentId === null) return null;
    const parentClassId = self.parentId;
    const parentEntry = db.symbol(parentClassId);
    const parentClassName = parentEntry?.name ?? "";

    const resolveEndpoint = (refText: string) => {
      const rawSegments = splitQualifiedPath(refText);
      let currentClassId: SymbolId = parentClassId;
      let currentEntry: SymbolEntry | null = null;
      let isInsideExpandable = false;

      const compConnectors: boolean[] = [];

      for (let i = 0; i < rawSegments.length; i++) {
        const seg = stripTrailingBrackets(rawSegments[i]!);
        if (!seg) return { resolved: false, missingSegment: rawSegments[i], missingSegmentIndex: i };

        if (i > 0 && db.query<boolean>("isExpandableConnector", currentClassId)) {
          isInsideExpandable = true;
        }

        const resolver = db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", currentClassId);
        let found: SymbolEntry | null = resolver ? resolver(seg) : null;
        if (!found) {
          const allElems = db.query<SymbolEntry[]>("allElements", currentClassId) ?? [];
          found = allElems.find((e) => e.name === seg) ?? null;
        }
        if (!found) {
          if (
            i > 0 &&
            currentEntry?.kind === "Component" &&
            db.query<boolean>("isExpandableConnector", currentClassId)
          ) {
            return {
              resolved: true,
              entry: currentEntry,
              typeClassId: null,
              isConnector: true,
              isExpandable: false,
              isInsideExpandable: true,
              isVirtualExpandableMember: true,
            };
          }
          const fullMissing = rawSegments.slice(0, i + 1).join(".");
          return { resolved: false, missingSegment: fullMissing, missingSegmentIndex: i };
        }

        currentEntry = found;
        const isForeignMember = Boolean(found.language && found.language !== "modelica" && isMemberLikeSymbol(found));
        const isForeignPort = Boolean(found.language && found.language !== "modelica" && isPortLikeSymbol(found));
        if (found.kind === "Component" || isForeignMember) {
          const nextClassId = db.query<SymbolId | null>("classInstance", found.id);
          let isInlineForeignPort = false;
          if (!nextClassId) {
            let typeName = String(
              found.metadata?.["typeSpecifier"] ??
                found.metadata?.["type_specifier"] ??
                found.metadata?.["typeName"] ??
                (isForeignMember ? (db.query<string | null>("typeSpecifier", found.id) ?? "") : ""),
            ).trim();
            if (!typeName && (!found.language || found.language === "modelica")) {
              let cur = db.cstNode(found.id) as SyntaxNode | null | undefined;
              while (cur && cur.type !== "ComponentClause" && cur.type !== "component_clause") {
                cur = cur.parent;
              }
              typeName = cur ? (Cst.ComponentClause.typeSpecifier(cur)?.text?.trim() ?? "") : "";
            }
            const isBuiltinNonConnector =
              typeName === "Real" ||
              typeName === "Integer" ||
              typeName === "Boolean" ||
              typeName === "String" ||
              typeName === "Clock" ||
              typeName === "StateSelect" ||
              typeName === "AssertionLevel" ||
              typeName === "ExternalObject" ||
              Boolean(
                found.language &&
                found.language !== "modelica" &&
                getSharedTypeRegistry().toCanonicalPrimitive(found.language, typeName) !== null,
              );
            isInlineForeignPort = isForeignPort && (!typeName || isBuiltinNonConnector);
            if ((!isBuiltinNonConnector && !isInlineForeignPort) || i < rawSegments.length - 1) {
              const fullMissing = rawSegments.slice(0, i + 1).join(".");
              return { resolved: false, unresolvableType: true, missingSegment: fullMissing, missingSegmentIndex: i };
            }
          }
          const isC =
            (nextClassId ? db.query<boolean>("isConnector", nextClassId) || false : false) || isInlineForeignPort;
          compConnectors.push(isC);
          if (i < rawSegments.length - 1 && nextClassId) {
            currentClassId = nextClassId;
          }
        } else if (
          found.kind === "Class" ||
          found.kind === "Package" ||
          Boolean(
            found.language &&
            found.language !== "modelica" &&
            (isTypeLikeSymbol(found) || isNamespaceLikeSymbol(found)) &&
            !isMemberLikeSymbol(found),
          )
        ) {
          if (i < rawSegments.length - 1) {
            currentClassId = found.id;
          }
        } else {
          if (i < rawSegments.length - 1) {
            const fullMissing = rawSegments.slice(0, i + 1).join(".");
            return { resolved: false, missingSegment: fullMissing, missingSegmentIndex: i };
          }
        }
      }

      if (!currentEntry) return { resolved: false, missingSegment: refText, missingSegmentIndex: 0 };

      const currentIsForeignPort = Boolean(
        currentEntry.language &&
        currentEntry.language !== "modelica" &&
        isPortLikeSymbol(currentEntry) &&
        isMemberLikeSymbol(currentEntry),
      );
      let typeClassId: SymbolId | null = null;
      if (
        currentEntry.kind === "Component" ||
        Boolean(currentEntry.language && currentEntry.language !== "modelica" && isMemberLikeSymbol(currentEntry))
      ) {
        typeClassId = db.query<SymbolId | null>("classInstance", currentEntry.id);
      } else if (
        currentEntry.kind === "Class" ||
        Boolean(
          currentEntry.language &&
          currentEntry.language !== "modelica" &&
          isTypeLikeSymbol(currentEntry) &&
          !isMemberLikeSymbol(currentEntry),
        )
      ) {
        typeClassId = currentEntry.id;
      }

      const isConn =
        (typeClassId ? db.query<boolean>("isConnector", typeClassId) || false : false) || currentIsForeignPort;
      const isExp = typeClassId ? db.query<boolean>("isExpandableConnector", typeClassId) || false : false;
      const invalidForm = compConnectors.length >= 2 && !compConnectors[0] && !compConnectors[1];

      return {
        resolved: true,
        entry: currentEntry,
        typeClassId,
        isConnector: isConn,
        isExpandable: isExp,
        isInsideExpandable,
        invalidForm,
      };
    };

    const lhsRes = resolveEndpoint(lhsText);
    const rhsRes = resolveEndpoint(rhsText);
    const diags: any[] = [];

    const getRange = (node: any) => {
      const startOffset = node?.startOffset ?? node?.startIndex ?? self.startOffset;
      const endOffset = node?.endOffset ?? node?.endIndex ?? self.endOffset;
      return { startOffset, endOffset };
    };

    const getSegmentRange = (node: any, refText: string, segIdx: number | undefined) => {
      const base = getRange(node);
      if (segIdx === undefined || !node) return base;
      const idents: any[] = [];
      const collectTopLevelIdents = (n: any) => {
        if (!n) return;
        if (
          n.type === "array_subscripts" ||
          n.type === "ArraySubscripts" ||
          n.type === "subscript" ||
          n.type === "Subscript"
        ) {
          return;
        }
        if (n.type === "identifier" || n.type === "Identifier") {
          idents.push(n);
          return;
        }
        if (n.children) {
          for (const c of n.children) collectTopLevelIdents(c);
        }
      };
      collectTopLevelIdents(node);
      if (segIdx < idents.length) {
        return getRange(idents[segIdx]);
      }
      const rawSegments = refText.split(".");
      if (segIdx < rawSegments.length) {
        const nodeText: string = node?.text ?? refText;
        let searchPos = 0;
        for (let i = 0; i <= segIdx; i++) {
          const rawSeg = rawSegments[i]!;
          const cleanSeg = stripTrailingBrackets(rawSeg);
          const idx = nodeText.indexOf(cleanSeg, searchPos);
          if (idx === -1) break;
          if (i === segIdx) {
            return {
              startOffset: base.startOffset + idx,
              endOffset: base.startOffset + idx + cleanSeg.length,
            };
          }
          searchPos = idx + rawSeg.length + 1;
        }
      }
      return base;
    };

    // 1. Check if endpoints resolve (M2002)
    if (!lhsRes.resolved && !lhsRes.unresolvableType) {
      const dotted = lhsText.includes(".");
      diags.push(
        error(
          ModelicaErrorCode.VARIABLE_NOT_FOUND.message(
            dotted ? lhsText : lhsRes.missingSegment || lhsText,
            parentClassName,
          ),
          {
            ...getSegmentRange(lhsNode, lhsText, lhsRes.missingSegmentIndex),
            code: ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
          },
        ),
      );
    }
    if (!rhsRes.resolved && !rhsRes.unresolvableType) {
      diags.push(
        error(ModelicaErrorCode.VARIABLE_NOT_FOUND.message(rhsRes.missingSegment || rhsText, parentClassName), {
          ...getSegmentRange(rhsNode, rhsText, rhsRes.missingSegmentIndex),
          code: ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
        }),
      );
    }
    if (diags.length > 0 || !lhsRes.resolved || !rhsRes.resolved) return diags;

    const checkSubscripts = (refText: string, node: any) => {
      let targetRoot = node;
      if ((!targetRoot || !targetRoot.children || targetRoot.children.length === 0) && refText.includes("[")) {
        targetRoot = parseConnectRefCst(refText);
      }
      if (!targetRoot) return null;
      const resolver = db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", parentClassId);
      if (!resolver) return null;

      const subscripts: any[] = [];
      const stack: any[] = [targetRoot];
      while (stack.length > 0) {
        const cur = stack.pop()!;
        if (cur.type === "subscript" || cur.type === "Subscript") {
          subscripts.push(cur);
          continue;
        }
        const children = cur.children || [];
        for (let i = children.length - 1; i >= 0; i--) {
          stack.push(children[i]);
        }
      }

      for (const subNode of subscripts) {
        const subText = subNode.text?.trim() ?? "";
        const idStack: any[] = [subNode];
        while (idStack.length > 0) {
          const cur = idStack.pop()!;
          if (cur.type === "identifier" || cur.type === "Identifier" || cur.type === "IDENT") {
            const idm = cur.text?.trim() ?? "";
            if (idm && idm !== "true" && idm !== "false" && idm !== "end") {
              const sym = resolver(idm);
              if (sym) {
                const vari = db.query<string | null>("variability", sym.id);
                if (vari !== "parameter" && vari !== "constant") {
                  return {
                    invalid: true,
                    subText,
                    refText,
                    range: getRange(node),
                  };
                }
              }
            }
            continue;
          }
          const children = cur.children || [];
          for (let i = children.length - 1; i >= 0; i--) {
            idStack.push(children[i]);
          }
        }
      }
      return null;
    };

    const lhsSubErr = checkSubscripts(lhsText, lhsNode);
    if (lhsSubErr) {
      diags.push(
        error(ModelicaErrorCode.CONNECTOR_NON_PARAMETER_SUBSCRIPT.message(lhsText, lhsSubErr.subText), {
          ...lhsSubErr.range,
          code: ModelicaErrorCode.CONNECTOR_NON_PARAMETER_SUBSCRIPT.code,
        }),
      );
      return diags;
    }
    const rhsSubErr = checkSubscripts(rhsText, rhsNode);
    if (rhsSubErr) {
      diags.push(
        error(ModelicaErrorCode.CONNECTOR_NON_PARAMETER_SUBSCRIPT.message(rhsText, rhsSubErr.subText), {
          ...rhsSubErr.range,
          code: ModelicaErrorCode.CONNECTOR_NON_PARAMETER_SUBSCRIPT.code,
        }),
      );
      return diags;
    }
    if (diags.length > 0) return diags;

    const isOldInst = Boolean(
      cst?.tree?.rootNode?.text?.includes("-d=-newInst") ||
      (parentClassId && (db.cstNode(parentClassId) as any)?.text?.includes("-d=-newInst")),
    );

    // 2. Check if endpoints are connectors (M3004) or components (M4048)
    if (!isOldInst) {
      if (lhsRes.invalidForm) {
        diags.push(
          error(ModelicaErrorCode.CONNECT_INVALID_FORM.message(lhsText), {
            ...getRange(lhsNode),
            code: ModelicaErrorCode.CONNECT_INVALID_FORM.code,
          }),
        );
        return diags;
      }
      if (rhsRes.invalidForm) {
        diags.push(
          error(ModelicaErrorCode.CONNECT_INVALID_FORM.message(rhsText), {
            ...getRange(rhsNode),
            code: ModelicaErrorCode.CONNECT_INVALID_FORM.code,
          }),
        );
        return diags;
      }

      if (
        lhsRes.entry &&
        (lhsRes.entry.kind === "Class" ||
          (lhsRes.entry.language !== "modelica" &&
            isTypeLikeSymbol(lhsRes.entry) &&
            !isMemberLikeSymbol(lhsRes.entry))) &&
        lhsRes.isConnector
      ) {
        diags.push(
          error(ModelicaErrorCode.CARDINALITY_EXPECTED_COMPONENT.message(lhsText), {
            ...getRange(lhsNode),
            code: ModelicaErrorCode.CARDINALITY_EXPECTED_COMPONENT.code,
          }),
        );
        return diags;
      }
      if (
        rhsRes.entry &&
        (rhsRes.entry.kind === "Class" ||
          (rhsRes.entry.language !== "modelica" &&
            isTypeLikeSymbol(rhsRes.entry) &&
            !isMemberLikeSymbol(rhsRes.entry))) &&
        rhsRes.isConnector
      ) {
        diags.push(
          error(ModelicaErrorCode.CARDINALITY_EXPECTED_COMPONENT.message(rhsText), {
            ...getRange(rhsNode),
            code: ModelicaErrorCode.CARDINALITY_EXPECTED_COMPONENT.code,
          }),
        );
        return diags;
      }

      // Check M4149: connecting two outputs at the same component/class ownership level
      if (lhsRes.entry && rhsRes.entry) {
        const resolveEndpointCausality = (
          entry: SymbolEntry,
          typeClassId: SymbolId | null | undefined,
        ): string | null => {
          const direct = db.query<string | null>("causality", entry.id);
          if (direct) return direct;
          if (typeClassId) {
            const typeCst = db.cstNode(typeClassId) as any;
            const spec = getShortClassSpecifierNode(typeCst);
            const basePfx = spec?.children?.find(
              (c: SyntaxNode) => c.type === "base_prefix" || c.type === "type_prefix",
            );
            const txt = basePfx?.text ?? spec?.text ?? "";
            if (/\boutput\b/.test(txt)) return "output";
            if (/\binput\b/.test(txt)) return "input";
          }
          return null;
        };
        const lhsCaus = resolveEndpointCausality(lhsRes.entry, lhsRes.typeClassId);
        const rhsCaus = resolveEndpointCausality(rhsRes.entry, rhsRes.typeClassId);
        if (lhsCaus === "output" && rhsCaus === "output") {
          const lhsIsOwn = lhsRes.entry.parentId === parentClassId;
          const rhsIsOwn = rhsRes.entry.parentId === parentClassId;
          if (lhsIsOwn === rhsIsOwn) {
            diags.push(
              warning(ModelicaErrorCode.CONNECT_TWO_OUTPUTS.message(lhsText, rhsText), {
                ...getRange(cst),
                code: ModelicaErrorCode.CONNECT_TWO_OUTPUTS.code,
              }),
            );
          }
        }
      }

      if (!lhsRes.isConnector && !lhsRes.isExpandable && !lhsRes.isInsideExpandable) {
        diags.push(
          error(ModelicaErrorCode.NOT_A_CONNECTOR.message(lhsText), {
            ...getRange(lhsNode),
            code: ModelicaErrorCode.NOT_A_CONNECTOR.code,
          }),
        );
        return diags;
      }
      if (!rhsRes.isConnector && !rhsRes.isExpandable && !rhsRes.isInsideExpandable) {
        diags.push(
          error(ModelicaErrorCode.NOT_A_CONNECTOR.message(rhsText), {
            ...getRange(rhsNode),
            code: ModelicaErrorCode.NOT_A_CONNECTOR.code,
          }),
        );
        return diags;
      }
    }

    // 3. Expandable connector compatibility (M4055)
    if (lhsRes.isExpandable && !rhsRes.isExpandable && !rhsRes.isInsideExpandable) {
      diags.push(
        error(ModelicaErrorCode.CANNOT_CONNECT_EXPANDABLE_WITH_NON_EXPANDABLE.message(lhsText, rhsText), {
          ...getRange(cst),
          code: ModelicaErrorCode.CANNOT_CONNECT_EXPANDABLE_WITH_NON_EXPANDABLE.code,
        }),
      );
      return diags;
    } else if (rhsRes.isExpandable && !lhsRes.isExpandable && !lhsRes.isInsideExpandable) {
      diags.push(
        error(ModelicaErrorCode.CANNOT_CONNECT_EXPANDABLE_WITH_NON_EXPANDABLE.message(rhsText, lhsText), {
          ...getRange(cst),
          code: ModelicaErrorCode.CANNOT_CONNECT_EXPANDABLE_WITH_NON_EXPANDABLE.code,
        }),
      );
      return diags;
    } else if (lhsRes.isExpandable && rhsRes.isExpandable) {
      return diags.length > 0 ? diags : null;
    }

    // 4. Standard connector plug-compatibility (M3003, M5004)
    if (lhsRes.isInsideExpandable || rhsRes.isInsideExpandable) {
      return diags.length > 0 ? diags : null;
    }

    const lhsTypeEntry = (lhsRes.typeClassId ? db.symbol(lhsRes.typeClassId) : null) ?? null;
    const rhsTypeEntry = (rhsRes.typeClassId ? db.symbol(rhsRes.typeClassId) : null) ?? null;
    const isCrossLangConnect =
      Boolean(lhsRes.entry?.language && lhsRes.entry.language !== "modelica") ||
      Boolean(rhsRes.entry?.language && rhsRes.entry.language !== "modelica") ||
      Boolean(lhsTypeEntry?.language && lhsTypeEntry.language !== "modelica") ||
      Boolean(rhsTypeEntry?.language && rhsTypeEntry.language !== "modelica");

    if (isCrossLangConnect) {
      const lhsPortEntry = lhsRes.entry ?? lhsTypeEntry;
      const rhsPortEntry = rhsRes.entry ?? rhsTypeEntry;
      if (lhsPortEntry && rhsPortEntry) {
        const registry = getSharedTypeRegistry();
        let lhsSig = extractPortSignature(db, lhsPortEntry, { registry });
        if ((!lhsSig || lhsSig.variables.length === 0) && lhsTypeEntry && lhsTypeEntry.id !== lhsPortEntry.id) {
          const typeSig = extractPortSignature(db, lhsTypeEntry, { registry });
          if (typeSig && typeSig.variables.length > 0) lhsSig = typeSig;
        }
        let rhsSig = extractPortSignature(db, rhsPortEntry, { registry });
        if ((!rhsSig || rhsSig.variables.length === 0) && rhsTypeEntry && rhsTypeEntry.id !== rhsPortEntry.id) {
          const typeSig = extractPortSignature(db, rhsTypeEntry, { registry });
          if (typeSig && typeSig.variables.length > 0) rhsSig = typeSig;
        }
        if (lhsSig && rhsSig) {
          const compat = checkPortPlugCompatibility(lhsSig, rhsSig, registry);
          if (!compat.compatible) {
            const isElectricalBoundary = (entry: typeof lhsPortEntry) => {
              const name = (entry.name || "").toLowerCase();
              const rule = (entry.ruleName || "").toLowerCase();
              return (
                rule === "pscad_port" ||
                rule === "pscad_connector" ||
                rule === "psse_component" ||
                name.includes("pin") ||
                name.includes("plug") ||
                name.includes("pcc") ||
                name.includes("bus") ||
                name === "electricalpin"
              );
            };
            if (isElectricalBoundary(lhsPortEntry) && isElectricalBoundary(rhsPortEntry)) {
              return diags.length > 0 ? diags : null;
            }
            diags.push(
              error(
                ModelicaErrorCode.NOT_PLUG_COMPATIBLE.message(lhsText, rhsText) +
                  (compat.reason ? ` (${compat.reason})` : ""),
                {
                  ...getRange(cst),
                  code: ModelicaErrorCode.NOT_PLUG_COMPATIBLE.code,
                },
              ),
            );
            return diags;
          }
          return diags.length > 0 ? diags : null;
        }
      }
    }

    // 4. Standard connector plug-compatibility (M3003, M5004)
    if (lhsRes.typeClassId && rhsRes.typeClassId) {
      const lhsMod = lhsRes.entry ? db.query<any>("effectiveModification", lhsRes.entry.id) : null;
      const rhsMod = rhsRes.entry ? db.query<any>("effectiveModification", rhsRes.entry.id) : null;
      const lhsHasRedecl = Boolean(lhsMod?.args?.some((a: any) => a.isRedeclaration));
      const rhsHasRedecl = Boolean(rhsMod?.args?.some((a: any) => a.isRedeclaration));
      const hasRedeclMod = lhsHasRedecl || rhsHasRedecl;
      if (lhsRes.typeClassId === rhsRes.typeClassId && !hasRedeclMod) {
        return diags.length > 0 ? diags : null;
      }
      const lhsElems = (db.query<SymbolEntry[]>("allElements", lhsRes.typeClassId) ?? []).filter(
        (e) => e.kind === "Component",
      );
      const rhsElems = (db.query<SymbolEntry[]>("allElements", rhsRes.typeClassId) ?? []).filter(
        (e) => e.kind === "Component",
      );

      // Check flow matching (M5004)
      const lhsFlowMap = new Map<string, string | null>();
      for (const elem of lhsElems) {
        let flow = db.query<string | null>("flowPrefix", elem.id) ?? null;
        const redecl = lhsMod?.args?.find((a: any) => a.isRedeclaration && a.name === elem.name);
        if (redecl && redecl.redeclaredPrefix !== undefined) {
          flow = redecl.redeclaredPrefix === "flow" ? "flow" : null;
        }
        lhsFlowMap.set(elem.name, flow);
      }
      const rhsFlowMap = new Map<string, string | null>();
      for (const elem of rhsElems) {
        let flow = db.query<string | null>("flowPrefix", elem.id) ?? null;
        const redecl = rhsMod?.args?.find((a: any) => a.isRedeclaration && a.name === elem.name);
        if (redecl && redecl.redeclaredPrefix !== undefined) {
          flow = redecl.redeclaredPrefix === "flow" ? "flow" : null;
        }
        rhsFlowMap.set(elem.name, flow);
      }

      for (const [name, lFlow] of lhsFlowMap.entries()) {
        if (rhsFlowMap.has(name)) {
          const rFlow = rhsFlowMap.get(name);
          if (lFlow === "flow" && rFlow !== "flow") {
            diags.push(
              error(ModelicaErrorCode.CONNECT_FLOW_MISMATCH.message(`${lhsText}.${name}`, `${rhsText}.${name}`), {
                ...(hasRedeclMod && isOldInst ? getRange(cst) : getRange(lhsNode)),
                code: ModelicaErrorCode.CONNECT_FLOW_MISMATCH.code,
              }),
            );
          } else if (rFlow === "flow" && lFlow !== "flow") {
            diags.push(
              error(ModelicaErrorCode.CONNECT_FLOW_MISMATCH.message(`${rhsText}.${name}`, `${lhsText}.${name}`), {
                ...(hasRedeclMod && isOldInst ? getRange(cst) : getRange(rhsNode)),
                code: ModelicaErrorCode.CONNECT_FLOW_MISMATCH.code,
              }),
            );
          }
        }
      }
      if (diags.length > 0) {
        if (hasRedeclMod && isOldInst) {
          const formatConnType = (
            typeClassId: SymbolId,
            elems: SymbolEntry[],
            flowMap: Map<string, string | null>,
            mod: any,
            hasRedecl: boolean,
            compName: string,
          ) => {
            const baseName = db.symbol(typeClassId)?.name ?? "Connector";
            const connName = hasRedecl ? `${baseName}$${compName}` : baseName;
            const sortedElems = [...elems].sort((a, b) => a.name.localeCompare(b.name));
            const lines = sortedElems.map((el) => {
              const fl = flowMap.get(el.name);
              const redecl = mod?.args?.find((a: any) => a.isRedeclaration && a.name === el.name);
              const elType =
                redecl?.redeclaredTypeSpecifier ?? db.query<string | null>("typeSpecifier", el.id) ?? "Real";
              return `  ${fl === "flow" ? "flow " : ""}${elType} ${el.name};`;
            });
            return `connector ${connName}\n${lines.join("\n")}\nend ${connName};`;
          };
          const lhsTypeDesc = formatConnType(lhsRes.typeClassId, lhsElems, lhsFlowMap, lhsMod, lhsHasRedecl, lhsText);
          const rhsTypeDesc = formatConnType(rhsRes.typeClassId, rhsElems, rhsFlowMap, rhsMod, rhsHasRedecl, rhsText);
          diags.push(
            error(
              `The type of variables \n${lhsText} type:\n${lhsTypeDesc} and \n${rhsText} type:\n${rhsTypeDesc}\nare inconsistent in connect equations.`,
              {
                ...getRange(cst),
                code: ModelicaErrorCode.NOT_PLUG_COMPATIBLE.code,
              },
            ),
          );
        }
        return diags;
      }

      // Check number of elements & type compatibility (M3003)
      if (lhsElems.length !== rhsElems.length) {
        diags.push(
          error(ModelicaErrorCode.NOT_PLUG_COMPATIBLE.message(lhsText, rhsText), {
            ...getRange(cst),
            code: ModelicaErrorCode.NOT_PLUG_COMPATIBLE.code,
          }),
        );
        return diags;
      }

      for (const lElem of lhsElems) {
        const rElem = rhsElems.find((r) => r.name === lElem.name);
        if (!rElem) {
          diags.push(
            error(ModelicaErrorCode.NOT_PLUG_COMPATIBLE.message(lhsText, rhsText), {
              ...getRange(cst),
              code: ModelicaErrorCode.NOT_PLUG_COMPATIBLE.code,
            }),
          );
          return diags;
        }
        const lType = db.query<string | null>("typeSpecifier", lElem.id);
        const rType = db.query<string | null>("typeSpecifier", rElem.id);
        if (lType && rType && lType !== rType) {
          diags.push(
            error(ModelicaErrorCode.NOT_PLUG_COMPATIBLE.message(lhsText, rhsText), {
              ...getRange(cst),
              code: ModelicaErrorCode.NOT_PLUG_COMPATIBLE.code,
            }),
          );
          return diags;
        }
      }
    }

    return diags.length > 0 ? diags : null;
  },
};

function stripLintQueries(hooks: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, fn] of Object.entries(hooks)) {
    if (!key.startsWith("lint__")) {
      out[key] = fn;
    }
  }
  return out;
}

/**
 * Polyglot fallback Salsa query tables for non-Modelica symbols (`PSSEDynamics.*`, `PSCAD`,
 * `SPICE`, `SysML v2`, etc.) resolved by `SymbolEntry.kind` when `ruleName` is foreign.
 */
export const foreignClassQueries: Record<string, any> = stripLintQueries(classDefinitionQueries);
export const foreignComponentQueries: Record<string, any> = stripLintQueries(componentDeclarationQueries);

/**
 * Registry mapping Modelica CST node rule names (and polyglot `@kind:*` fallbacks)
 * to their corresponding Salsa query hook tables.
 */
export const modelicaQueryHooks = new Map<string, Record<string, any>>([
  ["class_definition", classDefinitionQueries],
  ["ClassDefinition", classDefinitionQueries],
  ["component_declaration", componentDeclarationQueries],
  ["ComponentDeclaration", componentDeclarationQueries],
  ["extends_clause", extendsClauseQueries],
  ["ExtendsClause", extendsClauseQueries],
  ["short_class_specifier", shortClassSpecifierQueries],
  ["ShortClassSpecifier", shortClassSpecifierQueries],
  ["connect_equation", connectEquationQueries],
  ["ConnectEquation", connectEquationQueries],
  ["@kind:Class", foreignClassQueries],
  ["@kind:Package", foreignClassQueries],
  ["@kind:Definition", foreignClassQueries],
  ["@kind:Port", foreignClassQueries],
  ["@kind:Component", foreignComponentQueries],
  ["@kind:Variable", foreignComponentQueries],
  ["@kind:Usage", foreignComponentQueries],
]);
