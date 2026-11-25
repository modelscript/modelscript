// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Modelica Flattener - Enumeration literal extraction and enum type resolution helpers.
 */

import { UnifiedWorkspace, type QueryDB, type SymbolEntry, type SymbolId } from "@modelscript/runtime";
import { Cst, type SyntaxNode } from "../../../../src-gen/bindings.js";
import { firstAsciiToken, isAsciiDigitsOnly } from "../../../ascii.js";
import { getShortClassSpecifierNode } from "../../../queries.js";
import type { FlattenerCstNode } from "../../types.js";
import { getSymbolQualifiedName } from "../functions.js";
import { cstHasError } from "./cst-traversal.js";
import { stripComments, stripLeadingDots } from "./text-scanning.js";
import type { EnumMetaLike, SimpleNameResolver, SymbolWithEnumCache } from "./types.js";

function extractLiteralsFromEnumListNode(enumListNode: SyntaxNode | null | undefined): string[] {
  if (!enumListNode) return [];
  const lits: string[] = [];
  for (const c of enumListNode.children || []) {
    if (c.type === "enumeration_literal" || Cst.EnumerationLiteral.is(c)) {
      const identNode = c.children?.find((ch) => ch.type === "identifier") ?? c.child(0);
      const litText = identNode?.text?.trim() || firstAsciiToken(c.text ?? "");
      if (litText) lits.push(litText);
    }
  }
  return lits;
}

/** Parses an enum type definition or `enumeration(...)` specifier with the WASM parser to extract its literal names. */
export function parseEnumLiteralsText(rawText: string): string[] | null {
  const parser = UnifiedWorkspace.getGlobalParser(".mo");
  if (!parser) return null;
  const trimmed = rawText.trim();
  if (!trimmed) return null;
  const body = trimmed.endsWith(";") ? trimmed.slice(0, -1).trim() : trimmed;
  const src = body.startsWith("enumeration") ? `type _Tmp = ${body};` : `${body};`;
  const tree = parser.parse(src);
  const rootNode = tree?.rootNode as unknown as SyntaxNode | undefined;
  if (!rootNode || cstHasError(rootNode)) return null;
  const findEnumList = (n: SyntaxNode): SyntaxNode | null => {
    if (n.type === "enum_list") return n;
    for (const ch of n.children || []) {
      const found = findEnumList(ch);
      if (found) return found;
    }
    return null;
  };
  const enumList = findEnumList(rootNode);
  const lits = extractLiteralsFromEnumListNode(enumList);
  return lits.length > 0 ? lits : null;
}

export function extractEnumLiteralsFromCst(
  cstNode: FlattenerCstNode | null | undefined,
  targetMeta?: EnumMetaLike | Record<string, unknown> | null,
): string[] | null {
  const rawLiterals = (targetMeta as EnumMetaLike | null | undefined)?.literals;
  if (Array.isArray(rawLiterals) && rawLiterals.length > 0) {
    return rawLiterals as string[];
  }
  const shortSpec = getShortClassSpecifierNode(cstNode as SyntaxNode | null | undefined);
  const enumListNode = shortSpec ? Cst.ShortClassSpecifier.enumList(shortSpec) : null;
  if (enumListNode) {
    const lits = extractLiteralsFromEnumListNode(enumListNode);
    if (lits.length > 0) return lits;
  }
  const cstText = stripComments(cstNode?.text ?? "").trim();
  if (cstText) {
    return parseEnumLiteralsText(cstText);
  }
  return null;
}

export function getBaseEnumSymbol(
  db: QueryDB,
  sym: SymbolEntry | null | undefined,
  visited = new Set<SymbolId>(),
): SymbolEntry | null {
  if (!sym || visited.has(sym.id)) return null;
  visited.add(sym.id);
  const meta = sym.metadata as EnumMetaLike | undefined;
  if (Array.isArray(meta?.literals) && meta.literals.length > 0) {
    return sym;
  }
  if (sym.kind !== "Class" && sym.kind !== "Type") {
    return null;
  }
  const cst = db.cstNode(sym.id) as SyntaxNode | null | undefined;
  const directLits = extractEnumLiteralsFromCst(cst, meta);
  if (directLits && directLits.length > 0) {
    return sym;
  }
  let base = db.query<SymbolEntry | null>("resolvedBaseClass", sym.id);
  if (!base) {
    const extChild = db.childrenOf(sym.id).find((c) => c.kind === "Extends");
    if (extChild) {
      base = db.query<SymbolEntry | null>("resolvedBaseClass", extChild.id);
    }
  }
  if (!base && cst) {
    const shortSpec = getShortClassSpecifierNode(cst);
    const typeSpec =
      (shortSpec ? Cst.ShortClassSpecifier.typeSpecifier(shortSpec) : null) ??
      shortSpec?.children?.find((c) => c.type === "type_specifier" || c.type === "TypeSpecifier");
    const typeName = typeSpec?.text?.trim()?.split("[")[0]?.trim();
    if (typeName && typeName !== "enumeration") {
      const scopeId = sym.parentId ?? sym.id;
      const resolver =
        db.query<SimpleNameResolver | null>("resolveName", scopeId) ??
        db.query<SimpleNameResolver | null>("resolveSimpleName", scopeId);
      base = resolver?.(typeName) ?? db.byName(typeName.split(".").pop()!)?.[0] ?? null;
    }
  }
  if (base && base.id !== sym.id) {
    return getBaseEnumSymbol(db, base, visited);
  }
  return null;
}

export function getSymbolEnumLiterals(db: QueryDB, sym: SymbolEntry): string[] | null {
  const symExt = sym as SymbolWithEnumCache;
  if (symExt._cachedEnumLiterals !== undefined) {
    return symExt._cachedEnumLiterals;
  }
  const baseSym = getBaseEnumSymbol(db, sym);
  if (!baseSym) {
    symExt._cachedEnumLiterals = null;
    return null;
  }
  const meta = baseSym.metadata as EnumMetaLike | undefined;
  if (Array.isArray(meta?.literals) && meta.literals.length > 0) {
    const lits = meta.literals as string[];
    symExt._cachedEnumLiterals = lits;
    return lits;
  }
  const cst = db.cstNode(baseSym.id) as SyntaxNode | null | undefined;
  const res = extractEnumLiteralsFromCst(cst, meta);
  symExt._cachedEnumLiterals = res;
  return res;
}

export function resolveEnumType(
  typeName: string,
  scopeId: SymbolId | undefined,
  db: QueryDB | undefined,
): { sym: SymbolEntry; literals: string[]; qual: string } | null {
  if (!db) return null;
  const cleanName = stripLeadingDots(typeName).trim();
  if (!cleanName) return null;

  let resolvedSym: SymbolEntry | null = null;
  if (scopeId) {
    const resolver =
      db.query<SimpleNameResolver | null>("resolveName", scopeId) ??
      db.query<SimpleNameResolver | null>("resolveSimpleName", scopeId);
    const res = resolver?.(cleanName);
    if (res && (res.kind === "Class" || res.kind === "Type")) {
      resolvedSym = res;
    }
  }

  const leaf = cleanName.includes(".") ? cleanName.split(".").pop()! : cleanName;
  const candidates: SymbolEntry[] = [];
  if (resolvedSym) {
    candidates.push(resolvedSym);
  } else {
    for (const cand of db.byName(leaf)) candidates.push(cand);
  }

  for (const cand of candidates) {
    const baseSym = getBaseEnumSymbol(db, cand);
    const lits = baseSym ? getSymbolEnumLiterals(db, baseSym) : null;
    if (baseSym && lits && lits.length > 0) {
      const candQual = getSymbolQualifiedName(db, cand.id);
      const qual = getSymbolQualifiedName(db, baseSym.id);
      if (cleanName.includes(".")) {
        if (
          !candQual.endsWith(cleanName) &&
          !cleanName.endsWith(candQual) &&
          !qual.endsWith(cleanName) &&
          !cleanName.endsWith(qual)
        ) {
          continue;
        }
      }
      return { sym: baseSym, literals: lits, qual };
    }
  }
  return null;
}

export function getCompDeclSubEnumInfo(
  compSym: SymbolEntry,
  dimIdx: number,
  classId: SymbolId,
  db: QueryDB,
): { sym: SymbolEntry; literals: string[]; qual: string } | null {
  const compExt = compSym as SymbolWithEnumCache;
  let cache = compExt._cachedDeclSubEnumInfo;
  if (!cache) {
    cache = [];
    const cst = db.cstNode(compSym.id) as FlattenerCstNode | null | undefined;
    if (cst) {
      const findArraySubscripts = (n: FlattenerCstNode | null | undefined): FlattenerCstNode | null => {
        if (!n) return null;
        if (n.type === "array_subscripts") return n;
        for (const ch of n.children || []) {
          const res = findArraySubscripts(ch);
          if (res) return res;
        }
        return null;
      };
      const arrSubsNode = findArraySubscripts(cst);
      const declSubs = arrSubsNode?.children?.filter((c) => c.type === "subscript") ?? [];
      for (const ds of declSubs) {
        const dimSubText = ds.text?.trim() ?? "";
        if (!dimSubText || dimSubText === ":" || isAsciiDigitsOnly(dimSubText)) {
          cache.push(null);
        } else {
          cache.push(resolveEnumType(dimSubText, classId, db));
        }
      }
    }
    compExt._cachedDeclSubEnumInfo = cache;
  }
  return dimIdx < cache.length ? (cache[dimIdx] ?? null) : null;
}

export function getEnumLiteralIndex(text: string, db: QueryDB): number | null {
  const parts = text.split(".");
  const litName = parts.pop()!;
  const typeName = parts.length > 0 ? parts.pop()! : null;
  const candidateSyms: SymbolEntry[] = typeName
    ? db.byName(typeName)
    : db
        .byName(litName)
        .map((s) => (s.parentId !== null && s.parentId !== undefined ? db.symbol(s.parentId) : null))
        .filter((s): s is SymbolEntry => Boolean(s && s.kind === "Class"));
  for (const s of candidateSyms) {
    const lits = extractEnumLiteralsFromCst(
      db.cstNode(s.id) as FlattenerCstNode | null | undefined,
      s.metadata as EnumMetaLike | undefined,
    );
    if (lits) {
      const idx = lits.indexOf(litName);
      if (idx >= 0) return idx + 1;
    }
  }
  return null;
}
