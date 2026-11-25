// SPDX-License-Identifier: AGPL-3.0-or-later

import { type QueryDB, type SymbolEntry, type SymbolId } from "@modelscript/runtime";
import { Cst, type SyntaxNode } from "../../../../src-gen/bindings.js";
import { isPredefinedType } from "../../../predefined-types.js";
import { getShortClassSpecifierNode } from "../../../queries.js";
import { extractAsciiIdentifiers, stripComments, tokenizeCommentStrippedWords } from "../../expressions/index.js";
import { type FlattenerCstNode } from "../../types.js";
import {
  getCstNode,
  getSymMeta,
  type ComponentFlattener,
  type ModArgData,
  type ParentModData,
  type ResolveNameFn,
  type ResolveSimpleNameFn,
} from "./types.js";

/**
 * Resolves the target base class {@link SymbolEntry} for an `extends` clause symbol.
 *
 * Queries Salsa's `resolvedBaseClass` first, falling back to `resolveName`/`resolveSimpleName`
 * in `scopeId` and finally global `byName` lookup.
 *
 * @param flattener - Active component flattener context.
 * @param extChild - Symbol entry of the `Extends` clause.
 * @param scopeId - Enclosing class scope ID.
 * @returns Resolved base class symbol entry, or `null` if unresolvable.
 */
export function resolveExtendsBase(
  flattener: ComponentFlattener | { db: QueryDB },
  extChild: SymbolEntry | null | undefined,
  scopeId: SymbolId,
): SymbolEntry | null {
  if (!extChild || !extChild.name) return null;
  const baseClass = flattener.db.query<SymbolEntry | null>("resolvedBaseClass", extChild.id);
  if (baseClass) return baseClass;
  try {
    const res =
      flattener.db.query<ResolveNameFn | undefined>("resolveName", scopeId)?.(extChild.name) ??
      flattener.db.query<ResolveSimpleNameFn | undefined>("resolveSimpleName", scopeId)?.(extChild.name);
    if (res) {
      const s = flattener.db.symbol(res as unknown as SymbolId);
      if (s && s.kind === "Class") return s;
    }
  } catch {
    /* ignore resolution error and fall back to global class lookup */
  }
  return flattener.db.byName(extChild.name).find((e) => e.kind === "Class") ?? null;
}

/**
 * Determines whether a class symbol represents a scalar or array `type` alias
 * (e.g., `type Voltage = Real(unit="V")` or a class extending a predefined primitive type
 * without declaring sub-components) rather than a composite structured model/record/block.
 *
 * @param flattener - Active component flattener context.
 * @param classId - Symbol ID of the candidate class.
 * @param visited - Cycle-detection set for recursive `extends` chains.
 * @returns `true` if `classId` specializes a primitive or enumeration type.
 */
export function isClassType(flattener: ComponentFlattener, classId: SymbolId, visited = new Set<SymbolId>()): boolean {
  if (visited.has(classId)) return false;
  visited.add(classId);
  const target = flattener.db.symbol(classId);
  if (!target) return false;
  const meta = getSymMeta(target);
  const metaPrefixTokens = extractAsciiIdentifiers(stripComments(String(meta?.classKind ?? meta?.classPrefixes ?? "")));
  if (metaPrefixTokens.includes("type") || meta?.isType) return true;
  const cst = getCstNode(flattener.db, classId);
  if (!cst) {
    const baseType = meta?.baseType;
    return typeof baseType === "string" && ["Real", "Integer", "Boolean", "String"].includes(baseType);
  }

  const prefixes = Cst.ClassDefinition.classPrefixes(cst);
  const prefixWords = tokenizeCommentStrippedWords(prefixes?.text ?? "");
  if (prefixWords.includes("type")) return true;
  if (
    prefixWords.includes("model") ||
    prefixWords.includes("record") ||
    prefixWords.includes("block") ||
    prefixWords.includes("package")
  ) {
    return false;
  }

  const shortSpec = getShortClassSpecifierNode(cst);
  const isShort = Boolean(shortSpec);

  if (prefixWords.includes("connector") && !isShort) return false;

  if (isShort) {
    const subElems = flattener.db.query<SymbolId[]>("instantiate", classId);
    const hasComponents = subElems?.some((id) => flattener.db.symbol(id)?.kind === "Component");
    if (hasComponents) return false;
    return true;
  }

  const children = flattener.db.childrenOf(classId);
  const hasComponents = children.some((c) => c.kind === "Component");
  if (!hasComponents) {
    const extChild = children.find((c) => c.kind === "Extends");
    if (extChild) {
      const base = resolveExtendsBase(flattener, extChild, classId);
      if (base) {
        if (
          isPredefinedType(base) ||
          base.name === "Real" ||
          base.name === "Integer" ||
          base.name === "Boolean" ||
          base.name === "String"
        )
          return true;
        if (base.id !== classId && isClassType(flattener, base.id, visited)) return true;
      }
    }
  }

  return false;
}

/**
 * Recursively collects type-level attribute modifiers applied to `typeLeafName` via
 * `extends Base(TypeName(unit=..., min=...))` clauses along the inheritance hierarchy of `scopeId`.
 *
 * @param flattener - Active component flattener context.
 * @param scopeId - Enclosing class or package symbol ID.
 * @param typeLeafName - Unqualified name of the `type` alias being modified.
 * @param visited - Cycle-detection set of visited class IDs.
 * @returns Ordered list of inherited modification argument descriptors.
 */
export function collectInheritedTypeModifiers(
  flattener: ComponentFlattener,
  scopeId: SymbolId,
  typeLeafName: string,
  visited = new Set<SymbolId>(),
): ModArgData[] {
  if (visited.has(scopeId)) return [];
  visited.add(scopeId);
  const result: ModArgData[] = [];
  const children = flattener.db.childrenOf(scopeId);
  for (const child of children) {
    if (child.kind === "Extends") {
      const baseClass = flattener.db.query<SymbolEntry | null>("resolvedBaseClass", child.id);
      if (baseClass && baseClass.id !== scopeId) {
        result.push(...collectInheritedTypeModifiers(flattener, baseClass.id, typeLeafName, visited));
      }
      const extMod = flattener.db.query<ParentModData | ModArgData[] | null>("extendsModificationParsed", child.id);
      const args: readonly ModArgData[] = Array.isArray(extMod) ? extMod : (extMod?.args ?? []);
      const match = args.find((a) => a.name === typeLeafName);
      if (match?.nestedArgs || match?.args) {
        result.push(...(match.nestedArgs || match.args || []));
      }
    }
  }
  return result;
}

/**
 * Looks up a direct or inherited member (component or nested class) named `name` inside `classId`.
 *
 * Searches direct children first, then Salsa's `instantiate` element list, and finally
 * traverses `Extends` clauses recursively.
 *
 * @param flattener - Active component flattener context.
 * @param classId - Target class symbol ID to search.
 * @param name - Unqualified member identifier.
 * @param visited - Cycle-detection set of visited class IDs.
 * @returns Matching {@link SymbolEntry}, or `null` if not found.
 */
export function classFindMember(
  flattener: ComponentFlattener,
  classId: SymbolId,
  name: string,
  visited: Set<SymbolId> = new Set(),
): SymbolEntry | null {
  if (visited.has(classId)) return null;
  visited.add(classId);

  for (const child of flattener.db.childrenOf(classId)) {
    if (child.name === name) return child;
  }

  const instElems = flattener.db.query<SymbolId[]>("instantiate", classId);
  if (instElems) {
    for (const elemId of instElems) {
      const sym = flattener.db.symbol(elemId);
      if (sym && sym.name === name) return sym;
    }
  }

  for (const child of flattener.db.childrenOf(classId)) {
    if (child.kind === "Extends") {
      const base = resolveExtendsBase(flattener, child, classId);
      if (base && (base.kind === "Class" || base.kind === "Package")) {
        const found = classFindMember(flattener, base.id, name, visited);
        if (found) return found;
      }
    }
  }

  const directBase = flattener.db.query<SymbolEntry | null>("resolvedBaseClass", classId);
  if (directBase && (directBase.kind === "Class" || directBase.kind === "Package")) {
    const found = classFindMember(flattener, directBase.id, name, visited);
    if (found) return found;
  } else {
    const cst = getCstNode(flattener.db, classId);
    const shortSpec = getShortClassSpecifierNode(cst);
    if (shortSpec) {
      const typeSpec =
        Cst.ShortClassSpecifier.typeSpecifier(shortSpec) ??
        shortSpec.children?.find((c) => c.type === "type_specifier" || c.type === "TypeSpecifier");
      const typeName = typeSpec?.text?.trim()?.split("[")[0]?.trim();
      if (typeName) {
        const sym = flattener.db.symbol(classId);
        const scopeId = sym?.parentId ?? classId;
        const resolved =
          flattener.db.query<ResolveNameFn | undefined>("resolveName", scopeId)?.(typeName) ??
          flattener.db.query<ResolveSimpleNameFn | undefined>("resolveSimpleName", scopeId)?.(typeName) ??
          flattener.resolveTypeName?.(typeName, scopeId) ??
          null;
        if (resolved && (resolved.kind === "Class" || resolved.kind === "Package")) {
          const found = classFindMember(flattener, resolved.id, name, visited);
          if (found) return found;
        }
      }
    }
  }

  return null;
}

/**
 * Recursively collects the set of `protected` component names declared directly in `classId`
 * or inherited through `extends` clauses (marking all elements of a `protected extends Base`
 * clause as protected).
 *
 * @param flattener - Active component flattener context.
 * @param classId - Target class symbol ID to inspect.
 * @param visited - Cycle-detection set of visited class IDs.
 * @returns Set of protected component names within `classId`.
 */
export function collectProtectedNames(
  flattener: ComponentFlattener,
  classId: SymbolId,
  visited: Set<SymbolId> = new Set<SymbolId>(),
): Set<string> {
  const protectedNames = new Set<string>();
  if (visited.has(classId)) return protectedNames;
  visited.add(classId);

  for (const ch of flattener.db.childrenOf(classId)) {
    if (ch.kind === "Component") {
      if (flattener["isCstNodeProtected"](flattener.db.cstNode(ch.id))) {
        protectedNames.add(ch.name);
      }
    } else if (ch.kind === "Extends") {
      const isExtProt = flattener["isCstNodeProtected"](flattener.db.cstNode(ch.id));
      const baseSym = resolveExtendsBase(flattener, ch, classId);
      if (baseSym) {
        if (isExtProt) {
          const baseElems = flattener.db.query<SymbolId[]>("instantiate", baseSym.id) || [];
          for (const beid of baseElems) {
            const bentry = flattener.db.symbol(beid);
            if (bentry?.name) protectedNames.add(bentry.name);
          }
        } else {
          const baseProtected = collectProtectedNames(flattener, baseSym.id, visited);
          for (const pn of baseProtected) protectedNames.add(pn);
        }
      }
    }
  }
  return protectedNames;
}

/**
 * Recursively collects class-level modifications from short class definitions (`model M = Base(...)`)
 * and `extends Base(...)` clauses across the inheritance hierarchy of `classId`.
 *
 * Tags each collected modifier with `isExtendsMod: true` and `extendsTargetClassId` so
 * downstream redeclaration and override checks can distinguish inherited base modifications
 * from direct component modifications.
 *
 * @param flattener - Active component flattener context.
 * @param classId - Target class symbol ID to inspect.
 * @param visited - Cycle-detection set of visited class IDs.
 * @returns Ordered list of inherited `extends` modification descriptors.
 */
export function collectExtendsMods(
  flattener: ComponentFlattener,
  classId: SymbolId,
  visited: Set<SymbolId> = new Set<SymbolId>(),
): ModArgData[] {
  if (visited.has(classId)) return [];
  visited.add(classId);
  const result: ModArgData[] = [];

  const selfCstShort = getCstNode(flattener.db, classId);
  const specShort = getShortClassSpecifierNode(selfCstShort);
  if (specShort) {
    const selfSym = flattener.db.symbol(classId);
    let lookupScopeId = selfSym?.parentId ?? classId;
    if (lookupScopeId !== null && flattener.db.symbol(lookupScopeId)?.kind === "Extends") {
      lookupScopeId = flattener.db.symbol(lookupScopeId)?.parentId ?? lookupScopeId;
    }
    const typeSpec =
      Cst.ShortClassSpecifier.typeSpecifier(specShort) ?? specShort.children?.find((c) => c.type === "type_specifier");
    const typeName = typeSpec?.text?.trim();
    let targetClass: SymbolEntry | null = null;
    if (typeName) {
      const resolved =
        (typeName.includes(".")
          ? flattener.db.query<(n: string) => SymbolEntry | null>("resolveName", lookupScopeId)?.(typeName)
          : flattener.db.query<(n: string) => SymbolEntry | null>("resolveSimpleName", lookupScopeId)?.(typeName)) ??
        flattener.db.byName(typeName)?.find((m) => m.kind === "Class") ??
        null;
      if (resolved && resolved.kind === "Class") {
        targetClass = resolved;
        result.push(...collectExtendsMods(flattener, targetClass.id, visited));
      }
    }
    const isShortInClassMod = (node: FlattenerCstNode | SyntaxNode | null | undefined): boolean => {
      let cur = node?.parent;
      while (cur && cur.type !== "class_definition" && cur.type !== "ClassDefinition") {
        if (
          cur.type === "element_redeclaration" ||
          cur.type === "ElementRedeclaration" ||
          cur.type === "class_modification" ||
          cur.type === "ClassModification"
        ) {
          return true;
        }
        cur = cur.parent;
      }
      return false;
    };
    const parentSym = lookupScopeId != null ? flattener.db.symbol(lookupScopeId) : null;
    if (
      lookupScopeId != null &&
      selfSym &&
      (parentSym?.kind === "Class" || parentSym?.kind === "Package") &&
      isShortInClassMod(selfCstShort)
    ) {
      const findOrigClassInAncestors = (clsId: SymbolId, seenAnc = new Set<SymbolId>()): SymbolEntry | null => {
        if (seenAnc.has(clsId)) return null;
        seenAnc.add(clsId);
        const directChild = flattener.db
          .childrenOf(clsId)
          .find(
            (c) => c.kind === "Class" && c.name === selfSym.name && !isShortInClassMod(getCstNode(flattener.db, c.id)),
          );
        if (directChild) return directChild;
        const pBase = flattener.db.query<SymbolEntry | null>("resolvedBaseClass", clsId);
        if (pBase && pBase.id !== clsId) {
          const found = findOrigClassInAncestors(pBase.id, seenAnc);
          if (found) return found;
        }
        for (const ch of flattener.db.childrenOf(clsId)) {
          if (ch.kind === "Extends") {
            const bSym = resolveExtendsBase(flattener, ch, clsId);
            if (bSym && bSym.id !== clsId) {
              const found = findOrigClassInAncestors(bSym.id, seenAnc);
              if (found) return found;
            }
          }
        }
        return null;
      };
      const origClassSym = findOrigClassInAncestors(lookupScopeId);
      if (origClassSym) {
        const origMod = flattener.db.query<ParentModData | null>("effectiveModification", origClassSym.id);
        const pkgMod = flattener.db.query<ParentModData | null>("effectiveModification", lookupScopeId);
        if (origMod?.args) {
          for (const arg of origMod.args) {
            let mappedVal = arg.value;
            const valText = arg.value?.text?.trim();
            if (valText && pkgMod?.args) {
              const pkgOverride = pkgMod.args.find((pa) => !pa.isBreak && pa.name === valText && pa.value);
              if (pkgOverride) {
                mappedVal = pkgOverride.value;
              }
            }
            result.push({
              ...arg,
              value: mappedVal,
              isExtendsMod: true,
              extendsTargetClassId: targetClass?.id ?? classId,
              ownerClassId: lookupScopeId,
            });
          }
        }
      }
    }
    const shortMod = flattener.db.query<ParentModData | null>("effectiveModification", classId);
    if (shortMod?.args) {
      result.push(
        ...shortMod.args.map((a) => ({
          ...a,
          isExtendsMod: true,
          extendsTargetClassId: targetClass?.id ?? classId,
          ownerClassId: classId,
        })),
      );
    }
  }

  const seenInheritedNames = new Set<string>();
  for (const child of flattener.db.childrenOf(classId)) {
    if (child.kind === "Extends") {
      const target = resolveExtendsBase(flattener, child, classId);
      const extMod = flattener.db.query<ParentModData | null>("extendsModificationParsed", child.id);
      const redeclaredInExtMod = new Set<string>(
        (extMod?.args || [])
          .filter((a) => (a.isRedeclaration || a.redeclaredTypeSpecifier) && a.name)
          .map((a) => a.name),
      );
      if (target && target.kind === "Class") {
        const inheritedMods = collectExtendsMods(flattener, target.id, visited);
        for (const mod of inheritedMods) {
          if (mod.name && redeclaredInExtMod.has(mod.name) && (mod.isRedeclaration || mod.redeclaredTypeSpecifier)) {
            continue;
          }
          if (!mod.name || !seenInheritedNames.has(mod.name)) {
            result.push({ ...mod, isExtendsMod: true });
          }
        }
        for (const mod of inheritedMods) {
          if (mod.name) seenInheritedNames.add(mod.name);
        }
      }
      if (extMod?.args) {
        for (const arg of extMod.args) {
          if (arg.name) seenInheritedNames.add(arg.name);
          result.push({
            ...arg,
            isExtendsMod: true,
            extendsTargetClassId: target?.id,
            ownerClassId: arg.ownerClassId ?? classId,
          });
        }
      }
    }
  }
  return result;
}
