// SPDX-License-Identifier: AGPL-3.0-or-later

import { type QueryDB, type SymbolEntry, type SymbolId } from "@modelscript/runtime";
import { type SyntaxNode } from "../../../src-gen/bindings.js";
import { tokenizeCommentStrippedWords } from "../expressions/cst-utils.js";
import { cstOf } from "./diagnostics.js";
import { CLASS_SPEC_KEYWORDS, PRIMITIVE_BUILTIN_TYPES, type CompInfo, type ModItem } from "./types.js";

export function getHeaderText(classCst: SyntaxNode): string {
  const txt = classCst.text ?? "";
  const nl = txt.indexOf("\n");
  return nl >= 0 ? txt.slice(0, nl) : txt;
}

export function getClassSpecialization(sym: SymbolEntry, classCst: SyntaxNode | null): string {
  const meta = sym.metadata as Record<string, unknown> | undefined;
  const spec = (meta?.["specialization"] ?? meta?.["classType"] ?? meta?.["classKind"] ?? "") as string;
  if (spec) {
    const parts = spec.trim().split(/\s+/);
    for (let i = parts.length - 1; i >= 0; i--) {
      if (CLASS_SPEC_KEYWORDS.has(parts[i]!)) return parts[i]!;
    }
    return spec;
  }
  if (!classCst) return "";
  const pfxNode = classCst.namedChildren.find((c) => c.type === "class_prefixes");
  const words = tokenizeCommentStrippedWords(pfxNode?.text ?? getHeaderText(classCst));
  for (const w of words) {
    if (CLASS_SPEC_KEYWORDS.has(w)) return w;
  }
  return "model";
}

export function isClassPartial(sym: SymbolEntry, classCst: SyntaxNode | null): boolean {
  const meta = sym.metadata as Record<string, unknown> | undefined;
  if (meta?.["isPartial"] === true) return true;
  const pfxMeta = `${meta?.["classPrefixes"] ?? ""} ${meta?.["classKind"] ?? ""}`;
  if (/\bpartial\b/.test(pfxMeta)) return true;
  if (!classCst) return false;
  const pfxNode = classCst.namedChildren.find((c) => c.type === "class_prefixes");
  if (pfxNode) {
    for (const ch of pfxNode.children) {
      if (ch.type === "partial" || ch.text === "partial") return true;
    }
  }
  const words = tokenizeCommentStrippedWords(getHeaderText(classCst));
  let idx = 0;
  while (idx < words.length && (words[idx] === "encapsulated" || words[idx] === "pure" || words[idx] === "impure")) {
    idx++;
  }
  return words[idx] === "partial";
}

export function resolveClassSym(db: QueryDB, scopeId: SymbolId, name: string): SymbolEntry | null {
  const scopeSym = db.symbol(scopeId);
  const directChild = db
    .childrenOf(scopeId)
    .find((c) => (c.kind === "Class" || c.kind === "Package") && c.name === name);
  if (directChild && !name.includes(".")) return directChild;
  const fullResolved =
    db.query<((n: string) => SymbolEntry | null) | null>("resolveName", scopeId)?.(name) ??
    db.query<((n: string) => SymbolEntry | null) | null>("resolveSimpleName", scopeId)?.(name);
  if (fullResolved && (fullResolved.kind === "Class" || fullResolved.kind === "Package")) {
    return fullResolved;
  }
  const baseName = name.split(".")[0] ?? name;
  const simpleBase = db.query<((n: string) => SymbolEntry | null) | null>("resolveSimpleName", scopeId)?.(baseName);
  const resolved =
    (simpleBase && (simpleBase.kind === "Class" || simpleBase.kind === "Package") ? simpleBase : null) ??
    db
      .byName(name)
      .find(
        (e) =>
          (e.kind === "Class" || e.kind === "Package") &&
          (!scopeSym?.resourceId || e.resourceId === scopeSym.resourceId),
      ) ??
    db
      .byName(baseName)
      .find(
        (e) =>
          (e.kind === "Class" || e.kind === "Package") &&
          (!scopeSym?.resourceId || e.resourceId === scopeSym.resourceId),
      ) ??
    db.byName(name).find((e) => e.kind === "Class" || e.kind === "Package") ??
    db.byName(baseName).find((e) => e.kind === "Class" || e.kind === "Package") ??
    null;
  if (!resolved) return null;
  if (!name.includes(".")) return resolved;
  const parts = name.split(".");
  let cur: SymbolEntry | null = resolved;
  for (let i = 1; i < parts.length && cur; i++) {
    const child: SymbolEntry | undefined = db
      .childrenOf(cur.id)
      .find((c) => c.name === parts[i] && (c.kind === "Class" || c.kind === "Package"));
    cur = child ?? null;
  }
  return cur;
}

export function isNodeInProtectedSection(node: SyntaxNode | null): boolean {
  let cur: SyntaxNode | null = node;
  for (let hop = 0; hop < 5 && cur; hop++) {
    const parent = cur.parent;
    if (!parent) break;
    if (
      cur.type === "element" ||
      cur.type === "element_list" ||
      cur.type === "extends_clause" ||
      cur.type === "component_clause"
    ) {
      const siblings = parent.children;
      const idx = siblings.indexOf(cur);
      if (idx > 0) {
        for (let i = idx - 1; i >= 0; i--) {
          const sibText = siblings[i]?.text?.trim();
          if (sibText === "protected") return true;
          if (sibText === "public") return false;
        }
      }
    }
    cur = parent;
  }
  return false;
}

export function countSubscriptDims(node: SyntaxNode | null | undefined): number {
  if (!node) return 0;
  const sub = node.type === "array_subscripts" ? node : node.namedChildren.find((c) => c.type === "array_subscripts");
  if (!sub) return 0;
  const txt = sub.text.trim();
  if (!txt.startsWith("[") || !txt.endsWith("]")) return 0;
  let depth = 0;
  let dims = 1;
  for (let i = 1; i < txt.length - 1; i++) {
    const ch = txt[i]!;
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) dims++;
  }
  return dims;
}

export function collectComponentPrefixWords(
  elemNode: SyntaxNode | null | undefined,
  declClause: SyntaxNode | null | undefined,
  headerBeforeParen: string,
): Set<string> {
  const prefixes = new Set<string>();
  const collectLeaves = (node: SyntaxNode): void => {
    const t = node.type;
    if (t === "comment" || t === "line_comment" || t === "block_comment") return;
    if (node.childCount === 0) {
      const txt = node.text.trim();
      if (txt) prefixes.add(txt);
      return;
    }
    for (const ch of node.children) {
      if (
        ch.type === "type_specifier" ||
        ch.type === "component_list" ||
        ch.type === "component_declaration" ||
        ch.type === "component_declaration1" ||
        ch.type === "declaration"
      )
        break;
      collectLeaves(ch);
    }
  };
  if (elemNode && elemNode !== declClause) {
    for (const ch of elemNode.children) {
      if (ch.type === "component_clause") break;
      collectLeaves(ch);
    }
  }
  if (declClause?.type === "component_clause") {
    for (const ch of declClause.children) {
      if (
        ch.type === "type_specifier" ||
        ch.type === "component_list" ||
        ch.type === "component_declaration" ||
        ch.type === "component_declaration1" ||
        ch.type === "declaration"
      )
        break;
      collectLeaves(ch);
    }
  }
  if (prefixes.size === 0 && declClause?.type !== "component_clause") {
    const noStrings = headerBeforeParen.replace(/"(?:\\.|[^"\\])*"/g, " ");
    for (const w of tokenizeCommentStrippedWords(noStrings)) {
      const clean = w.split("[")[0]?.split(";")[0] ?? w;
      if (clean) prefixes.add(clean);
    }
  }
  return prefixes;
}

export function findAncestor(node: SyntaxNode | null, typeName: string, maxHops = 5): SyntaxNode | null {
  let cur = node;
  for (let i = 0; i < maxHops && cur; i++) {
    if (cur.type === typeName) return cur;
    cur = cur.parent;
  }
  return null;
}

export function getCompInfo(
  db: QueryDB,
  compSym: SymbolEntry,
  ownerClassId: SymbolId = compSym.parentId ?? 0,
): CompInfo {
  const meta = (compSym.metadata ?? {}) as Record<string, unknown>;
  const cst = cstOf(db, compSym.id);
  const declClause = findAncestor(cst, "component_clause") ?? cst?.parent?.parent ?? cst?.parent;
  const elemNode = declClause?.parent?.type === "element" ? declClause.parent : declClause;
  const clauseText = (elemNode?.text ?? cst?.text ?? "").trim();
  const headerBeforeParen = clauseText.split("(")[0] ?? clauseText;
  const prefixWords = collectComponentPrefixWords(elemNode, declClause, headerBeforeParen);
  let typeName = (meta["typeName"] as string) ?? (meta["typeSpecifier"] as string) ?? "";
  if (!typeName && declClause) {
    const tsNode = declClause.namedChildren.find((c) => c.type === "type_specifier");
    if (tsNode) typeName = tsNode.text.trim();
  }
  let variability = (meta["variability"] as string) ?? "";
  if (!variability) {
    if (prefixWords.has("constant")) variability = "constant";
    else if (prefixWords.has("parameter")) variability = "parameter";
    else if (prefixWords.has("discrete")) variability = "discrete";
    else variability = "continuous";
  }
  const causality: "" | "input" | "output" =
    meta["causality"] === "input" || prefixWords.has("input")
      ? "input"
      : meta["causality"] === "output" || prefixWords.has("output")
        ? "output"
        : "";
  const subDims =
    countSubscriptDims(cst) ||
    countSubscriptDims(cst?.namedChildren.find((c) => c.type === "declaration")) ||
    countSubscriptDims(declClause?.namedChildren.find((c) => c.type === "array_subscripts"));
  const metaNdims = Array.isArray(meta["dimensions"]) ? meta["dimensions"].length : 0;
  const ndims = metaNdims > 0 ? metaNdims : subDims > 0 ? subDims : headerBeforeParen.includes("[") ? 1 : 0;
  return {
    sym: compSym,
    ownerClassId,
    typeName,
    variability,
    causality,
    isProtected: Boolean(meta["isProtected"]) || isNodeInProtectedSection(elemNode ?? cst),
    isFinal: Boolean(meta["isFinal"]) || prefixWords.has("final"),
    isFlow: prefixWords.has("flow"),
    isStream: prefixWords.has("stream"),
    isOuter: prefixWords.has("outer") && !prefixWords.has("inner"),
    isReplaceable: prefixWords.has("replaceable"),
    isInput: causality === "input",
    ndims,
    cst,
  };
}

export function resolveShortClassBase(db: QueryDB, classId: SymbolId): SymbolEntry | null {
  const sym = db.symbol(classId);
  const cst = cstOf(db, classId);
  if (!sym || !cst) return null;
  const specNode =
    cst.type === "short_class_specifier"
      ? cst
      : (cst.namedChildren.find((c) => c.type === "short_class_specifier") ??
        cst.namedChildren
          .find((c) => c.type === "class_specifier")
          ?.namedChildren.find((c) => c.type === "short_class_specifier"));
  if (!specNode) return null;
  const tsNode = specNode.namedChildren.find((c) => c.type === "type_specifier" || c.type === "name");
  const baseName = tsNode?.text?.trim();
  if (!baseName || PRIMITIVE_BUILTIN_TYPES.has(baseName)) return null;
  return resolveClassSym(db, sym.parentId ?? classId, baseName);
}

export function isShortClassPrimitiveAlias(db: QueryDB, classSym: SymbolEntry | null, depth = 0): boolean {
  if (!classSym || depth > 8) return false;
  const cst = cstOf(db, classSym.id);
  if (!cst) return false;
  const specNode =
    cst.type === "short_class_specifier"
      ? cst
      : (cst.namedChildren.find((c) => c.type === "short_class_specifier") ??
        cst.namedChildren
          .find((c) => c.type === "class_specifier")
          ?.namedChildren.find((c) => c.type === "short_class_specifier"));
  if (!specNode) return false;
  const tsNode = specNode.namedChildren.find((c) => c.type === "type_specifier" || c.type === "name");
  const baseName = tsNode?.text?.trim();
  if (!baseName) return false;
  if (PRIMITIVE_BUILTIN_TYPES.has(baseName)) return true;
  const baseSym = resolveClassSym(db, classSym.parentId ?? classSym.id, baseName);
  return isShortClassPrimitiveAlias(db, baseSym, depth + 1);
}

export function hasUnresolvedBaseOrReplaceableMatch(
  db: QueryDB,
  classId: SymbolId,
  modName: string,
  visited = new Set<SymbolId>(),
): boolean {
  if (visited.has(classId)) return false;
  visited.add(classId);
  const cst = cstOf(db, classId);
  if (cst?.text && cst.text.includes("replaceable") && modName && cst.text.includes(modName)) {
    return true;
  }
  const children = db.childrenOf(classId);
  if (children.length === 0) {
    const sc =
      cst?.namedChildren
        .find((c) => c.type === "class_specifier")
        ?.namedChildren.find((c) => c.type === "short_class_specifier") ??
      cst?.namedChildren.find((c) => c.type === "short_class_specifier");
    if (sc) {
      const ts = sc.namedChildren.find((c) => c.type === "type_specifier" || c.type === "name");
      const bName = ts?.text?.trim();
      if (bName && !PRIMITIVE_BUILTIN_TYPES.has(bName)) {
        const baseSym = resolveShortClassBase(db, classId);
        if (!baseSym) return true;
        if (hasUnresolvedBaseOrReplaceableMatch(db, baseSym.id, modName, visited)) return true;
      }
    }
  }
  for (const ch of children) {
    if (ch.kind === "Extends") {
      const base = db.query<SymbolEntry | null>("resolvedBaseClass", ch.id) ?? resolveClassSym(db, classId, ch.name);
      if (!base) return true;
      if (hasUnresolvedBaseOrReplaceableMatch(db, base.id, modName, visited)) return true;
    }
  }
  return false;
}

export function isReplaceablePackagePrefix(db: QueryDB, scopeId: SymbolId, dottedTypeName: string): boolean {
  if (!dottedTypeName.includes(".")) return false;
  const firstSeg = dottedTypeName.split(".")[0]?.trim();
  if (!firstSeg) return false;
  const pkgSym = resolveClassSym(db, scopeId, firstSeg);
  if (pkgSym) {
    const pkgCst = cstOf(db, pkgSym.id);
    const parentElem = pkgCst?.parent?.type === "element" ? pkgCst.parent : pkgCst;
    if (
      (pkgSym.metadata as Record<string, unknown> | undefined)?.["isReplaceable"] ||
      /^\s*(?:redeclare\s+)?replaceable\b/.test(parentElem?.text ?? "")
    ) {
      return true;
    }
    if (hasUnresolvedBaseOrReplaceableMatch(db, scopeId, firstSeg)) return true;
  }
  const clsCst = cstOf(db, scopeId);
  if (clsCst?.text && clsCst.text.includes("replaceable") && clsCst.text.includes(firstSeg)) {
    return true;
  }
  return false;
}

export function collectClassComponents(
  db: QueryDB,
  classId: SymbolId,
  visited = new Set<SymbolId>(),
): Map<string, CompInfo> {
  const map = new Map<string, CompInfo>();
  if (visited.has(classId)) return map;
  visited.add(classId);

  const children = db.childrenOf(classId);
  if (children.length === 0) {
    const shortBase = resolveShortClassBase(db, classId);
    if (shortBase) {
      return collectClassComponents(db, shortBase.id, visited);
    }
  }

  for (const child of children) {
    if (child.kind === "Extends") {
      const base =
        db.query<SymbolEntry | null>("resolvedBaseClass", child.id) ?? resolveClassSym(db, classId, child.name);
      const extCst = cstOf(db, child.id);
      const extProtected = isNodeInProtectedSection(extCst);
      const finalModifiedNames = new Set<string>();
      if (extCst) {
        const modWrap = extCst.namedChildren.find(
          (c) => c.type === "class_or_inheritance_modification" || c.type === "class_modification",
        );
        const modNode =
          modWrap?.type === "class_modification"
            ? modWrap
            : (modWrap?.namedChildren.find((c) => c.type === "class_modification") ?? modWrap ?? null);
        if (modNode) {
          for (const em of collectModifiersInNode(modNode)) {
            if (em.isFinal && em.name) finalModifiedNames.add(em.name);
          }
        }
      }
      if (base) {
        const baseComps = collectClassComponents(db, base.id, visited);
        for (const [k, v] of baseComps) {
          if (!map.has(k)) {
            if (extProtected || finalModifiedNames.has(k)) {
              map.set(k, {
                ...v,
                isProtected: v.isProtected || extProtected,
                isFinal: v.isFinal || finalModifiedNames.has(k),
              });
            } else {
              map.set(k, v);
            }
          }
        }
      }
    } else if (child.kind === "Component") {
      map.set(child.name, getCompInfo(db, child, classId));
    }
  }
  return map;
}

export function collectClassNestedClasses(
  db: QueryDB,
  classId: SymbolId,
  visited = new Set<SymbolId>(),
): Map<string, { sym: SymbolEntry; isProtected: boolean }> {
  const map = new Map<string, { sym: SymbolEntry; isProtected: boolean }>();
  if (visited.has(classId)) return map;
  visited.add(classId);

  const children = db.childrenOf(classId);
  if (children.length === 0) {
    const shortBase = resolveShortClassBase(db, classId);
    if (shortBase) {
      return collectClassNestedClasses(db, shortBase.id, visited);
    }
  }

  for (const child of children) {
    if (child.kind === "Extends") {
      const extCst = cstOf(db, child.id);
      const extProtected = isNodeInProtectedSection(extCst);
      const base =
        db.query<SymbolEntry | null>("resolvedBaseClass", child.id) ?? resolveClassSym(db, classId, child.name);
      if (base) {
        for (const [k, v] of collectClassNestedClasses(db, base.id, visited)) {
          if (!map.has(k)) {
            map.set(k, { sym: v.sym, isProtected: v.isProtected || extProtected });
          }
        }
      }
    } else if (child.kind === "Class" || child.kind === "Package") {
      const cCst = cstOf(db, child.id);
      const meta = (child.metadata ?? {}) as Record<string, unknown>;
      map.set(child.name, {
        sym: child,
        isProtected: Boolean(meta["isProtected"]) || isNodeInProtectedSection(cCst),
      });
    }
  }
  return map;
}

export function collectModifiersInNode(modListNode: SyntaxNode | null): ModItem[] {
  const out: ModItem[] = [];
  if (!modListNode) return out;
  function findClassMod(n: SyntaxNode | null | undefined): SyntaxNode | null {
    if (!n) return null;
    if (n.type === "class_modification") return n;
    for (const c of n.namedChildren) {
      if (c.type === "class_modification") return c;
    }
    return null;
  }
  function walk(n: SyntaxNode): void {
    if (n.type === "element_modification") {
      const nameNode = n.childForFieldName("name") ?? n.namedChildren[0] ?? null;
      const name = nameNode?.text?.trim() ?? "";
      if (name) {
        const modNode = n.childForFieldName("modification") ?? n.namedChildren[1] ?? null;
        const isFinal = n.parent?.children?.some((c) => c.type === "final" || c.text === "final") ?? false;
        const classModNode = findClassMod(modNode);
        const modText = modNode?.text?.trim() ?? "";
        const isClassAssignEq =
          !classModNode && modText.startsWith("=") && /^[A-Za-z_][A-Za-z0-9_.]*$/.test(modText.slice(1).trim());
        out.push({
          name,
          text: n.text.trim(),
          node: n,
          nested: modNode,
          classModNode,
          isFinal,
          isRedeclare: false,
          isRedeclareClass: false,
          isClassAssignEq,
        });
      }
      return;
    }
    if (n.type === "element_redeclaration") {
      const rawText = n.text.trim();
      const headerBeforeEqOrParen = rawText.split("=")[0]?.split("(")[0] ?? rawText;
      const headerWords = tokenizeCommentStrippedWords(headerBeforeEqOrParen);
      let kwIdx = -1;
      for (let i = 0; i < headerWords.length; i++) {
        if (CLASS_SPEC_KEYWORDS.has(headerWords[i]!)) kwIdx = i;
      }
      const shortClass = n.namedChildren.find((c) => c.type === "short_class_definition");
      let isRedeclareClass = kwIdx >= 0 || Boolean(shortClass);
      let name = "";
      let classModNode: SyntaxNode | null = null;
      if (shortClass) {
        const shortSpec = shortClass.namedChildren.find((c) => c.type === "short_class_specifier");
        const idNode = shortSpec?.namedChildren.find((c) => c.type === "identifier");
        name = idNode?.text?.trim() ?? "";
        classModNode = findClassMod(shortSpec);
      } else if (isRedeclareClass && kwIdx >= 0) {
        let nameIdx = kwIdx + 1;
        if (headerWords[nameIdx] === "extends") nameIdx++;
        name = headerWords[nameIdx] ?? "";
        classModNode = findClassMod(n);
      } else {
        const comp1 = n.namedChildren.find((c) => c.type === "component_clause1");
        const decl1 = comp1?.namedChildren.find((c) => c.type === "component_declaration1");
        const decl = decl1?.namedChildren.find((c) => c.type === "declaration");
        const idNode = decl?.namedChildren.find((c) => c.type === "identifier");
        name = idNode?.text?.trim() ?? "";
        const modNode = decl?.namedChildren.find((c) => c.type === "modification");
        classModNode = findClassMod(modNode);
      }
      if (!name && headerWords.length > 0) {
        name = headerWords[headerWords.length - 1] ?? "";
      }
      out.push({
        name,
        text: rawText,
        node: n,
        nested: classModNode,
        classModNode,
        isFinal: /\bfinal\b/.test(rawText.split("=")[0] ?? ""),
        isRedeclare: true,
        isRedeclareClass,
        isClassAssignEq: false,
      });
      return;
    }
    for (const ch of n.namedChildren) walk(ch);
  }
  walk(modListNode);
  return out;
}

export function isSubclassOf(
  db: QueryDB,
  childClassId: SymbolId,
  targetBaseId: SymbolId,
  visited = new Set<SymbolId>(),
): boolean {
  if (childClassId === targetBaseId) return true;
  if (visited.has(childClassId)) return false;
  visited.add(childClassId);
  for (const ch of db.childrenOf(childClassId)) {
    if (ch.kind === "Extends") {
      const base =
        db.query<SymbolEntry | null>("resolvedBaseClass", ch.id) ?? resolveClassSym(db, childClassId, ch.name);
      if (base && isSubclassOf(db, base.id, targetBaseId, visited)) return true;
    }
  }
  return false;
}

export function getShortClassCausality(
  db: QueryDB,
  scopeId: SymbolId,
  typeName: string,
  visited = new Set<SymbolId>(),
): "" | "input" | "output" {
  const sym = resolveClassSym(db, scopeId, typeName);
  if (!sym || visited.has(sym.id)) return "";
  visited.add(sym.id);
  const cst = cstOf(db, sym.id);
  if (!cst) return "";
  const spec = getClassSpecialization(sym, cst);
  if (spec !== "type") return "";
  const txt = cst.text ?? "";
  const eqIdx = txt.indexOf("=");
  if (eqIdx < 0) return "";
  const rhs = txt.slice(eqIdx + 1).trim();
  const words = tokenizeCommentStrippedWords(rhs.split("(")[0] ?? rhs);
  if (words[0] === "input") return "input";
  if (words[0] === "output") return "output";
  if (words[0] && !PRIMITIVE_BUILTIN_TYPES.has(words[0])) {
    return getShortClassCausality(db, sym.parentId ?? sym.id, words[0], visited);
  }
  return "";
}

export function findExpressionEndTokenOutsideSubscript(node: SyntaxNode): SyntaxNode | null {
  function walk(n: SyntaxNode, inSubscript: boolean): SyntaxNode | null {
    if (n.type === "array_subscripts") return null;
    if (n.type === "annotation_clause" || n.type === "annotation") return null;
    if (!inSubscript && !n.isNamed && n.text === "end") {
      if (findAncestor(n, "expression", 6) || findAncestor(n, "simple_expression", 6)) {
        return n;
      }
    }
    if (!inSubscript && n.type === "end") {
      if (findAncestor(n, "expression", 6) || findAncestor(n, "simple_expression", 6)) {
        return n;
      }
    }
    for (const ch of n.children) {
      const found = walk(ch, inSubscript);
      if (found) return found;
    }
    return null;
  }
  return walk(node, false);
}
