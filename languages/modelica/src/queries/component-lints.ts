// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Modelica Component Declaration Semantic Lint Salsa Queries (`lint__*` hooks on `component_declaration`).
 */

import { error, warning } from "@modelscript/dsl";
import { isTypeLikeSymbol, type QueryDB, type SymbolEntry, type SymbolId } from "@modelscript/runtime";
import { Cst, type SyntaxNode } from "../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../errors.js";
import type { ModelicaModArgs, ModificationArg } from "../modifications.js";
import { parseUnit, unitsCompatible } from "../units.js";
import { collapseSpaceTokens } from "../workspace-hooks.js";
import { stripModelicaComments, stripTrailingBrackets } from "./cst-helpers.js";
import { checkModifierNotFound } from "./modifications.js";
import { getQualifiedTypeFailRange, resolveQualified } from "./name-resolution.js";
import { getSymbolMeta, type CheckableModArgs, type ModelicaQueryHooks } from "./types.js";

/**
 * Semantic lint Salsa hooks attached to `component_declaration` (`Component`) symbols.
 */
export const componentLintQueries: ModelicaQueryHooks = {
  /**
   * M2004 / M4045: Validates that all modification arguments on this component declaration
   * exist on the resolved component class or its predefined type attributes.
   */
  lint__modifierNotFound: (db: QueryDB, self: SymbolEntry) => {
    const typeClassId = db.query<SymbolId | null>("classInstance", self.id);
    if (!typeClassId) return null;
    const typeEntry = db.symbol(typeClassId);
    if (!typeEntry) return null;
    const mod = db.query<CheckableModArgs | null>("effectiveModification", self.id);
    return checkModifierNotFound(db, self, mod, typeClassId, typeEntry, undefined);
  },

  /** M2003: Emits a diagnostic when the component's type specifier cannot be resolved in scope. */
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
        (e) =>
          Boolean(getSymbolMeta(e)?.["isPredefined"]) ||
          e.kind === "Class" ||
          e.kind === "Package" ||
          e.kind === "Function" ||
          e.kind === "Def" ||
          isTypeLikeSymbol(e) ||
          (Boolean(e.language) &&
            e.language!.toLowerCase() !== "modelica" &&
            e.kind !== "Import" &&
            e.kind !== "Extends"),
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
      if (self.parentId) {
        for (const sib of db.childrenOf(self.parentId)) {
          if (sib.id === self.id) break;
          if (sib.kind !== "Component") continue;
          const sibDiags = db.query<Array<{ dimIndex: number; exprText: string }> | null>(
            "cyclicDimensionInfo",
            sib.id,
          );
          if (sibDiags && sibDiags.length > 0) return null;
        }
      }
      const d = diags[0]!;
      const cst = db.cstNode(self.id) as SyntaxNode | null;
      let clauseNode = cst;
      while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.parent) {
        clauseNode = clauseNode.parent;
      }
      const rangeNode = clauseNode ?? cst;
      const startOffset = rangeNode?.startIndex ?? rangeNode?.startOffset ?? self.startOffset;
      const endOffset = rangeNode?.endIndex ?? rangeNode?.endOffset ?? self.endOffset;
      const formattedExpr = d.exprText.replace(/,(\S)/g, ", $1");
      const msg = ModelicaErrorCode.CYCLIC_DIMENSION_DEPENDENCY.message(
        String(d.dimIndex + 1),
        self.name,
        formattedExpr,
      );
      return error(msg, {
        startOffset,
        endOffset,
        code: ModelicaErrorCode.CYCLIC_DIMENSION_DEPENDENCY.code,
      });
    }
    return null;
  },

  /** M4147: Reports instantiating a class annotated with `annotation(obsolete = "...")` (MLS §18.8). */
  lint__obsoleteClassUsage: (db: QueryDB, self: SymbolEntry) => {
    const typeClassId = db.query<SymbolId | null>("classInstance", self.id);
    if (!typeClassId) return null;
    const typeEntry = db.symbol(typeClassId);
    if (!typeEntry) return null;
    if (getSymbolMeta(typeEntry)?.["isPredefined"]) return null;

    const typeCst = db.cstNode(typeClassId) as SyntaxNode | null;
    if (!typeCst) return null;

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

    const extractObsolete = (n: SyntaxNode | null | undefined): boolean => {
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

  /** M3024: Checks `displayUnit` SI dimensional compatibility against `unit` (MLS §19.1). */
  lint__incompatibleDisplayUnit: (db: QueryDB, self: SymbolEntry) => {
    const extractStrAttr = (args: readonly ModificationArg[] | undefined, attrName: string): string | null => {
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

    const mod = db.query<ModelicaModArgs | null>("effectiveModification", self.id);
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
      resolved = entries?.find((e) => e.kind === "Package" || e.kind === "Class" || e.kind === "Function") ?? null;
    }

    if (resolved) {
      const meta = getSymbolMeta(resolved);
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
        const resolvedCst = db.cstNode(resolved.id) as SyntaxNode | null;
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
