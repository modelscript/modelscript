// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Modelica Modification Parsing (`parseModArgsFromCst`) and Modifier Validation (`checkModifierNotFound`).
 */

import { error } from "@modelscript/dsl";
import {
  isMemberLikeSymbol,
  isRelationshipOrImportSymbol,
  type QueryDB,
  type SymbolEntry,
  type SymbolId,
} from "@modelscript/runtime";
import { Cst, type SyntaxNode } from "../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../errors.js";
import { mergeModArgs, type ModelicaModArgs, type ModificationArg, type ModificationValue } from "../modifications.js";
import { extractSubscriptsFromCst, getShortClassSpecifierNode, hasNodePrefixKeyword } from "./cst-helpers.js";
import { resolveQualified } from "./name-resolution.js";
import {
  asSyntaxNode,
  getSymbolMeta,
  type CheckableModArgs,
  type ComponentInstanceSummary,
  type ParsedModArgs,
  type ParsedModificationArg,
  type QueryCstNode,
  type QueryDiagnostic,
  type ResolveNameFn,
  type ResolveSimpleNameFn,
} from "./types.js";

function getValueText(value: ModificationValue | null | undefined): string | null {
  if (value && value.kind === "expression" && typeof value.text === "string") {
    return value.text;
  }
  return null;
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
  mod: CheckableModArgs | null | undefined,
  typeClassId: SymbolId,
  typeEntry: SymbolEntry,
  overrideClassName?: string,
): QueryDiagnostic[] | null {
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
    Boolean(currentEntry && (db.cstNode(currentEntry.id) as QueryCstNode | null)?.text?.includes("enumeration("));
  const visited = new Set<SymbolId>();

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
    const curEntry: SymbolEntry = currentEntry;
    visited.add(curEntry.id);
    let nextId: SymbolId | null = null;

    // If it's a component, get its class instance
    if (curEntry.kind === "Component") {
      nextId = db.query<SymbolId | null>("classInstance", curEntry.id);
    } else if (curEntry.kind === "Class") {
      const extendsChildren: SymbolEntry[] = db.childrenOf(curEntry.id).filter((c) => c.kind === "Extends");
      for (const ext of extendsChildren) {
        const base: SymbolEntry | null = db.query<SymbolEntry | null>("resolvedBaseClass", ext.id);
        if (base && !visited.has(base.id)) {
          nextId = base.id;
          break;
        }
      }
      if (!nextId) {
        const cst = db.cstNode(curEntry.id) as SyntaxNode | null;
        const spec = getShortClassSpecifierNode(cst);
        if (spec) {
          const typeSpec =
            Cst.ShortClassSpecifier.typeSpecifier(spec) ??
            spec.children?.find((c: SyntaxNode) => c.type === "type_specifier" || c.type === "TypeSpecifier");
          let typeName = typeSpec?.text?.trim();
          if (typeName) {
            typeName = typeName.split("[")[0]!.trim();
            if (typeName === "Real" || typeName === "Integer" || typeName === "Boolean" || typeName === "String") {
              isBuiltin = true;
              break;
            }
            const resolve: ResolveNameFn | null = db.query<ResolveNameFn | null>(
              "resolveName",
              curEntry.parentId || curEntry.id,
            );
            let baseEntry: SymbolEntry | null = null;
            if (resolve) baseEntry = resolve(typeName, true);
            if (!baseEntry && curEntry.parentId) {
              const resSimple: ResolveSimpleNameFn | null = db.query<ResolveSimpleNameFn | null>(
                "resolveSimpleName",
                curEntry.parentId,
              );
              if (resSimple) baseEntry = resSimple(typeName.split(".")[0]!);
            }
            if (!baseEntry) baseEntry = resolveQualified(db, typeName);
            if (!baseEntry) baseEntry = db.byName(typeName.split(".").pop()!)[0] ?? null;
            if (baseEntry) nextId = baseEntry.id;
          }
        }
      }
    }

    if (!nextId || nextId === curEntry.id) break;
    currentEntry = db.symbol(nextId) ?? null;
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
        Boolean((db.cstNode(currentEntry.id) as QueryCstNode | null)?.text?.includes("enumeration("));
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
  const results: QueryDiagnostic[] = [];
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
          const valText = getValueText(arg.value);
          if (valText !== null) {
            modText += " = " + valText;
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
        const valText = getValueText(arg.value);
        if (valText !== null) {
          modText += " = " + valText;
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
                const ci = db.query<ComponentInstanceSummary | null>("componentInstance", ch.id);
                const tSpec = ci?.typeSpecifier ?? (getSymbolMeta(ch)?.["typeSpecifier"] as string | undefined);
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
        const nestedValText = getValueText(nested.value);
        if (nestedValText !== null) {
          nestedVal = " = " + nestedValText;
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
      const elemIds = db.query<SymbolId[]>("instantiate", typeClassId) || [];
      let originalId: SymbolId | null = null;
      for (const eid of elemIds) {
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
                (a) => a.isRedeclaration && (a.name === origTypeSpec || a.name === origTypeSpec.split(".").pop()),
              );
              if (siblingRedecl) {
                const targetTypeName = siblingRedecl.redeclaredTypeSpecifier || siblingRedecl.name;
                const resolve = db.query<ResolveNameFn | null>("resolveName", self.id);
                let redeclEntry: SymbolEntry | null = null;
                if (resolve) redeclEntry = resolve(targetTypeName, true);
                if (!redeclEntry && self.parentId) {
                  const resolveParent = db.query<ResolveNameFn | null>("resolveName", self.parentId);
                  if (resolveParent) redeclEntry = resolveParent(targetTypeName, true);
                }
                if (!redeclEntry) {
                  redeclEntry = db.byName(targetTypeName.split(".").pop()!)?.find((e) => e.kind === "Class") ?? null;
                }
                if (redeclEntry) {
                  nestedTypeClassId = redeclEntry.id;
                }
              }
            }
          }

          if (arg.isRedeclaration && arg.redeclaredTypeSpecifier) {
            const resolve = db.query<ResolveNameFn | null>("resolveName", self.id);
            let redeclaredEntry: SymbolEntry | null = null;
            if (resolve) redeclaredEntry = resolve(arg.redeclaredTypeSpecifier, true);
            if (!redeclaredEntry && self.parentId) {
              const resolveParent = db.query<ResolveNameFn | null>("resolveName", self.parentId);
              if (resolveParent) redeclaredEntry = resolveParent(arg.redeclaredTypeSpecifier, true);
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
 * @returns Normalized `ParsedModArgs` containing merged modification arguments and optional binding value.
 */
export function parseModArgsFromCst(
  node: QueryCstNode | null | undefined,
  scopeId: number | null = null,
): ParsedModArgs {
  const args: ParsedModificationArg[] = [];
  if (!node) return { args, bindingExpression: null, evaluationScopeId: scopeId };

  const rootTreeText = "tree" in node ? node.tree?.rootNode?.text : undefined;

  // Walk the CST modification tree to extract element modifications, redeclarations, and inheritance breaks.
  const walk = (n: QueryCstNode | null | undefined) => {
    if (!n) return;
    const nSyntax = asSyntaxNode(n);
    // Case 1: Standard `element_modification` (including dotted modification paths like `a.b.c = 1`).
    if (n.type === "ElementModification" || n.type === "element_modification") {
      const nameNode =
        (nSyntax ? Cst.ElementModification.name(nSyntax) : null) ??
        n.children?.find((c) => c.type === "name" || c.type === "Name" || c.type === "identifier");
      const modNode =
        (nSyntax ? Cst.ElementModification.modification(nSyntax) : null) ??
        n.children?.find((c) => c.type === "modification" || c.type === "Modification");
      const parentNode = n.parent;
      const isParentModOrRepl = Boolean(
        parentNode &&
        (parentNode.type === "element_modification_or_replaceable" ||
          parentNode.type === "ElementModificationOrReplaceable" ||
          parentNode.type === "argument" ||
          parentNode.type === "Argument"),
      );
      const finalNode =
        n.children?.find((c) => c.type === "final" || c.text === "final") ??
        (isParentModOrRepl ? parentNode?.children?.find((c) => c.type === "final" || c.text === "final") : undefined);
      const eachNode =
        n.children?.find((c) => c.type === "each" || c.text === "each") ??
        (isParentModOrRepl ? parentNode?.children?.find((c) => c.type === "each" || c.text === "each") : undefined);

      const name = nameNode?.text ?? "";
      const nStart = n.startIndex ?? n.startOffset;
      const nEnd = n.endIndex ?? n.endOffset;
      const modRange: readonly [number, number] | undefined =
        typeof nStart === "number" && typeof nEnd === "number" ? [nStart, nEnd] : undefined;
      const modPosition = { startPosition: n.startPosition, endPosition: n.endPosition };

      const nTreeText = "tree" in n ? n.tree?.rootNode?.text : undefined;
      const isOldInst = Boolean(nTreeText?.includes("-d=-newInst") || rootTreeText?.includes("-d=-newInst"));
      let modText = "";
      if (modNode) {
        if (isOldInst) {
          const nText = n.text || "";
          const nameLen = nameNode?.text ? nameNode.text.length : 0;
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
          offset += parts[k]!.length + 1;
        }
        const s = baseStart + offset;
        return [s, s + parts[partIndex]!.length] as const;
      };

      let currentNested: ParsedModArgs = nested;
      for (let i = parts.length - 1; i > 0; i--) {
        currentNested = {
          args: [
            {
              name: parts[i]!,
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
        name: parts[0]!,
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
      const extractSubscripts = (arraySubNode: QueryCstNode | null | undefined) => {
        const subs = extractSubscriptsFromCst(arraySubNode, "unsignedIntegerOnly");
        return subs.length > 0 ? subs : undefined;
      };

      const replaceableNode = n.children?.find(
        (c) => c.type === "ElementReplaceable" || c.type === "element_replaceable",
      );
      const targetNode = replaceableNode ?? n;
      const targetSyntax = asSyntaxNode(targetNode);

      const clause =
        (targetSyntax ? Cst.Element.componentClause(targetSyntax) : null) ??
        targetNode.children?.find(
          (c) => c.type === "component_clause" || c.type === "ComponentClause" || c.type === "component_clause1",
        ) ??
        (nSyntax ? Cst.Element.componentClause(nSyntax) : null) ??
        n.children?.find(
          (c) => c.type === "component_clause" || c.type === "ComponentClause" || c.type === "component_clause1",
        );
      if (clause) {
        const clauseSyntax = asSyntaxNode(clause);
        const typePrefixNode =
          clause.children?.find((c) => c.type === "type_prefix" || c.type === "TypePrefix") ??
          (clauseSyntax ? Cst.ComponentClause.typePrefix(clauseSyntax) : null);
        const redeclaredPrefix = typePrefixNode?.text?.trim() ?? "";
        const typeSpec =
          clause.children?.find((c) => c.type === "type_specifier" || c.type === "TypeSpecifier") ??
          (clauseSyntax ? Cst.ComponentClause.typeSpecifier(clauseSyntax) : null);
        const compList = clauseSyntax ? Cst.ComponentClause.componentList(clauseSyntax) : null;
        const decl1 =
          (compList ? Cst.ComponentList.componentDeclaration(compList) : null) ??
          clause.children?.find(
            (c) =>
              c.type === "component_declaration" ||
              c.type === "ComponentDeclaration" ||
              c.type === "component_declaration1",
          );
        const decl1Syntax = asSyntaxNode(decl1);
        const decl =
          (decl1Syntax ? Cst.ComponentDeclaration.declaration(decl1Syntax) : null) ??
          decl1?.children?.find((c) => c.type === "declaration" || c.type === "Declaration") ??
          decl1;
        const declSyntax = asSyntaxNode(decl);
        const ident =
          (declSyntax ? Cst.Declaration.name(declSyntax) : null) ??
          decl?.children?.find((c) => c.type === "identifier" || c.type === "Identifier");
        const modNode =
          (declSyntax ? Cst.Declaration.modification(declSyntax) : null) ??
          decl?.children?.find((c) => c.type === "modification" || c.type === "Modification");

        const name = ident?.text ?? "";
        const identStart = ident?.startIndex ?? ident?.startOffset;
        const identEnd = ident?.endIndex ?? ident?.endOffset;
        const nameRange: readonly [number, number] | undefined =
          typeof identStart === "number" && typeof identEnd === "number" ? [identStart, identEnd] : undefined;
        const typeName = typeSpec?.text ?? "";
        const nested = parseModArgsFromCst(modNode, scopeId);

        const constrClause =
          targetNode.children?.find((c) => c.type === "constraining_clause" || c.type === "ConstrainingClause") ??
          n.children?.find((c) => c.type === "constraining_clause" || c.type === "ConstrainingClause");
        if (constrClause) {
          const constrMod = constrClause.children?.find(
            (c) => c.type === "class_modification" || c.type === "ClassModification",
          );
          if (constrMod) {
            const constrParsed = parseModArgsFromCst(constrMod, scopeId);
            if (constrParsed.args.length > 0) {
              const existingNames = new Set(nested.args.map((a) => a.name));
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

        const nStart = n.startIndex ?? n.startOffset;
        const nEnd = n.endIndex ?? n.endOffset;
        args.push({
          name,
          nameRange,
          modRange: typeof nStart === "number" && typeof nEnd === "number" ? [nStart, nEnd] : undefined,
          modPosition: { startPosition: n.startPosition, endPosition: n.endPosition },
          modText: n.text?.trim() ?? "",
          each: false,
          final: hasNodePrefixKeyword(n, "final", true),
          isRedeclaration: true,
          redeclaredKind: "component",
          redeclaredTypeSpecifier: typeName,
          redeclaredPrefix,
          redeclaredArrayDimensionsRaw: extractSubscripts(
            (declSyntax ? Cst.Declaration.arraySubscripts(declSyntax) : null) ??
              (decl1Syntax ? Cst.Declaration.arraySubscripts(decl1Syntax) : null) ??
              decl1?.children?.find((c) => c.type === "array_subscripts" || c.type === "arraySubscripts"),
          ),
          nestedArgs: nested.args,
          value: nested.bindingExpression,
          evaluationScopeId: scopeId,
        });
      } else {
        const classDef =
          (targetSyntax ? Cst.Element.classDefinition(targetSyntax) : null) ??
          targetNode.children?.find(
            (c) =>
              c.type === "class_definition" ||
              c.type === "ClassDefinition" ||
              c.type === "short_class_definition" ||
              c.type === "ShortClassDefinition",
          ) ??
          (nSyntax ? Cst.Element.classDefinition(nSyntax) : null) ??
          n.children?.find(
            (c) =>
              c.type === "class_definition" ||
              c.type === "ClassDefinition" ||
              c.type === "short_class_definition" ||
              c.type === "ShortClassDefinition",
          );
        if (classDef) {
          const classDefSyntax = asSyntaxNode(classDef);
          let shortClass: QueryCstNode | null | undefined =
            (classDefSyntax ? Cst.ClassDefinition.classSpecifier(classDefSyntax) : null) ??
            classDef.children?.find(
              (c) =>
                c.type === "class_specifier" ||
                c.type === "ClassSpecifier" ||
                c.type === "short_class_specifier" ||
                c.type === "ShortClassSpecifier",
            ) ??
            (classDef.type === "short_class_specifier" || classDef.type === "ShortClassSpecifier" ? classDef : null);
          if (shortClass) {
            if (shortClass.type === "class_specifier" || shortClass.type === "ClassSpecifier") {
              const innerShort = shortClass.children?.find(
                (c) => c.type === "short_class_specifier" || c.type === "ShortClassSpecifier",
              );
              if (innerShort) shortClass = innerShort;
            }
            const shortClassSyntax = asSyntaxNode(shortClass);
            const ident =
              (shortClassSyntax ? Cst.ShortClassSpecifier.name(shortClassSyntax) : null) ??
              shortClass.children?.find((c) => c.type === "identifier" || c.type === "Identifier");
            const typeSpec =
              (shortClassSyntax ? Cst.ShortClassSpecifier.typeSpecifier(shortClassSyntax) : null) ??
              shortClass.children?.find((c) => c.type === "type_specifier" || c.type === "TypeSpecifier");
            const name = ident?.text?.trim() ?? "";
            let typeName = typeSpec?.text?.trim() ?? "";
            if (!typeName && shortClass.text?.includes("enumeration")) {
              typeName = shortClass.text.slice(shortClass.text.indexOf("enumeration")).trim();
            }
            const modNode =
              (shortClassSyntax ? Cst.ShortClassSpecifier.classModification(shortClassSyntax) : null) ??
              shortClass.children?.find((c) => c.type === "class_modification" || c.type === "ClassModification");
            const nested = parseModArgsFromCst(modNode, scopeId);

            const constrClause =
              targetNode.children?.find((c) => c.type === "constraining_clause" || c.type === "ConstrainingClause") ??
              n.children?.find((c) => c.type === "constraining_clause" || c.type === "ConstrainingClause");
            if (constrClause) {
              const constrMod = constrClause.children?.find(
                (c) => c.type === "class_modification" || c.type === "ClassModification",
              );
              if (constrMod) {
                const constrParsed = parseModArgsFromCst(constrMod, scopeId);
                if (constrParsed.args.length > 0) {
                  const existingNames = new Set(nested.args.map((a) => a.name));
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

            const identStart = ident?.startIndex ?? ident?.startOffset;
            const identEnd = ident?.endIndex ?? ident?.endOffset;
            const nStart = n.startIndex ?? n.startOffset;
            const nEnd = n.endIndex ?? n.endOffset;
            args.push({
              name,
              nameRange:
                typeof identStart === "number" && typeof identEnd === "number" ? [identStart, identEnd] : undefined,
              modRange: typeof nStart === "number" && typeof nEnd === "number" ? [nStart, nEnd] : undefined,
              modPosition: { startPosition: n.startPosition, endPosition: n.endPosition },
              modText: n.text?.trim() ?? "",
              each: false,
              final: hasNodePrefixKeyword(n, "final", true),
              isRedeclaration: true,
              redeclaredKind: "class",
              redeclaredTypeSpecifier: typeName,
              redeclaredArrayDimensionsRaw: extractSubscripts(
                (shortClassSyntax ? Cst.ShortClassSpecifier.arraySubscripts(shortClassSyntax) : null) ??
                  shortClass.children?.find((c) => c.type === "array_subscripts" || c.type === "arraySubscripts"),
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
        (nSyntax && Cst.ConnectEquation.is(nSyntax) ? nSyntax : null) ??
        (n.children || []).find((c) => c.type === "connect_equation" || c.type === "ConnectEquation");
      if (connectEq) {
        const connectSyntax = asSyntaxNode(connectEq);
        const source =
          (connectSyntax ? Cst.ConnectEquation.lhs(connectSyntax) : null) ??
          (connectEq.children || []).filter(
            (c) =>
              c.type === "component_reference" ||
              c.type === "expression" ||
              c.type === "identifier" ||
              c.type === "name",
          )[0];
        const target =
          (connectSyntax ? Cst.ConnectEquation.rhs(connectSyntax) : null) ??
          (connectEq.children || []).filter(
            (c) =>
              c.type === "component_reference" ||
              c.type === "expression" ||
              c.type === "identifier" ||
              c.type === "name",
          )[1];
        if (source && target) {
          const canonEq = `connect(${(source.text ?? "").trim()},${(target.text ?? "").trim()})`;
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
      const identifier = (n.children || []).find((c) => c.type === "identifier" || c.type === "Identifier");
      if (identifier) {
        args.push({
          name: (identifier.text ?? "").trim(),
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
    for (const child of n.children || []) walk(child);
  };
  walk(node);

  // Extract direct value binding expression (`= expr` or `:= expr`) if attached to the modification root.
  let bindingExpression: ModificationValue | null = null;
  const nt = (node.type ?? "").toLowerCase();
  const nodeSyntax = asSyntaxNode(node);
  if (nodeSyntax && (nt === "modification" || nt === "elementmodification" || nt === "element_modification")) {
    const expr = Cst.Modification.modificationExpression(nodeSyntax);
    if (expr) {
      bindingExpression = {
        kind: "expression",
        cstBytes: [expr.startOffset ?? expr.startIndex, expr.endOffset ?? expr.endIndex],
        text: expr.text,
        evaluationScopeId: scopeId,
      };
    }
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
    finalMod = mergeModArgs(
      { args: [arg as unknown as ModificationArg], bindingExpression: null, evaluationScopeId: scopeId },
      finalMod,
    );
  }

  return {
    ...finalMod,
    args: [...(finalMod.args as readonly ParsedModificationArg[])],
    bindingExpression: finalMod.bindingExpression,
  };
}
