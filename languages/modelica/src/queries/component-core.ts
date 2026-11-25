// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Modelica Component Declaration Core Salsa Queries (`component_declaration` / `ComponentDeclaration`).
 */

import {
  isNamespaceLikeSymbol,
  isTypeLikeSymbol,
  splitQualifiedPath,
  type CycleInfo,
  type QueryDB,
  type SymbolEntry,
  type SymbolId,
} from "@modelscript/runtime";
import { Cst, type SyntaxNode } from "../../src-gen/bindings.js";
import { AnnotationEvaluator, evaluatePlacementWasm } from "../diagram/annotation-evaluator.js";
import type { ModelicaModArgs } from "../modifications.js";
import {
  containsWord,
  extractSubscriptsFromCst,
  getShortClassSpecifierNode,
  isInnerQuery,
  isOuterQuery,
  isRedeclareQuery,
} from "./cst-helpers.js";
import { evaluateDimCSTNode, evaluateDimExpr, findFlexibleBindingDimCycle } from "./dimensions.js";
import { parseModArgsFromCst } from "./modifications.js";
import { isScopeEncapsulated, resolveQualified } from "./name-resolution.js";
import {
  asSyntaxNode,
  getSymbolMeta,
  type ArrayDimensionDescriptor,
  type ComponentInstanceSummary,
  type DimEvalResult,
  type ModelicaQueryHooks,
  type ParsedModArgs,
  type QueryCstNode,
} from "./types.js";

/**
 * Core (non-lint) Salsa semantic queries attached to `component_declaration` (`Component`) symbols.
 */
export const componentCoreQueries: ModelicaQueryHooks = {
  /** Evaluates and memoizes the Placement annotation for this component declaration. */
  componentPlacement: (db: QueryDB, self: SymbolEntry) => {
    const cst = db.cstNode(self.id);
    if (!cst) {
      return getSymbolMeta(self)?.["placementAnnotation"] ?? null;
    }
    const wasmPlacement = evaluatePlacementWasm(cst);
    if (wasmPlacement !== undefined) return wasmPlacement;
    const evaluator = new AnnotationEvaluator();
    return evaluator.evaluate(cst, "Placement");
  },

  /** Get the raw type specifier name for this component. */
  typeSpecifier: (db: QueryDB, self: SymbolEntry) => {
    const specArgs = db.argsOf<ModelicaModArgs>(self.id);
    if (specArgs?.data?.isRedeclaration && specArgs.data.redeclaredTypeSpecifier) {
      return specArgs.data.redeclaredTypeSpecifier;
    }
    const meta = getSymbolMeta(self);
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
          const cmeta = getSymbolMeta(child);
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
    let current = db.cstNode(self.id) as SyntaxNode | null;
    while (current && current.type !== "ComponentClause" && current.type !== "component_clause") {
      current = current.parent;
    }
    const typeSpecNode =
      Cst.ComponentClause.typeSpecifier(current) ??
      current?.children?.find((c: SyntaxNode) => c.type === "type_specifier" || c.type === "TypeSpecifier");
    return typeSpecNode?.text ?? null;
  },

  /** Resolve the type specifier to the class it references. */
  resolvedType: (db: QueryDB, self: SymbolEntry) => {
    const typeName = db.query<string | null>("typeSpecifier", self.id)?.trim() ?? "";
    if (!typeName || typeof typeName !== "string") return null;

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
      entries?.find((e) => Boolean(getSymbolMeta(e)?.["isPredefined"]) && e.kind === "Class") ??
      entries?.find((e) => isTypeLikeSymbol(e)) ??
      null
    );
  },

  /**
   * Get the effective modification for this component as a
   * structured ModelicaModArgs object.
   */
  effectiveModification: (db: QueryDB, self: SymbolEntry) => {
    const cst = db.cstNode(self.id) as SyntaxNode | null;
    if (!cst) {
      const meta = getSymbolMeta(self);
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
    return parseModArgsFromCst(modNode, self.parentId) as unknown as ModelicaModArgs;
  },

  /** Check if this component's type is a connector. */
  isConnectorType: (db: QueryDB, self: SymbolEntry) => {
    const selfMeta = getSymbolMeta(self);
    if (selfMeta?.["isConnectorPort"] === true) return true;
    let current = db.cstNode(self.id) as SyntaxNode | null;
    while (current && current.type !== "ComponentClause" && current.type !== "component_clause") {
      current = current.parent;
    }
    const typeSpecNode =
      Cst.ComponentClause.typeSpecifier(current) ??
      current?.children?.find((c: SyntaxNode) => c.type === "type_specifier" || c.type === "TypeSpecifier");
    const typeName =
      typeSpecNode?.text ?? (typeof selfMeta?.["typeSpecifier"] === "string" ? selfMeta["typeSpecifier"] : undefined);
    if (!typeName || typeof typeName !== "string") return false;

    let typeEntry: SymbolEntry | null = null;

    if (typeName.includes(".") && self.parentId !== null) {
      const parentEntry = db.symbol(self.parentId);
      if (parentEntry && (parentEntry.kind === "Class" || parentEntry.kind === "Package")) {
        const qualResolver = db.query<(n: string) => SymbolEntry | null>("resolveName", parentEntry.id);
        if (qualResolver) {
          typeEntry = qualResolver(typeName);
        }
      }
    }

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
        entries?.find((e) => Boolean(getSymbolMeta(e)?.["isPredefined"]) && e.kind === "Class") ??
        entries?.find((e) => e.kind === "Class" || e.kind === "Package" || e.kind === "Function") ??
        null;
    }

    if (!typeEntry) return false;
    const entryMeta = getSymbolMeta(typeEntry);
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
      const metaVar = getSymbolMeta(self)?.["variability"];
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
      const metaCaus = getSymbolMeta(self)?.["causality"];
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
      const metaFlow = getSymbolMeta(self)?.["flowPrefix"];
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
    const resType = db.query<SymbolEntry | SymbolId | null>("resolvedType", self.id);
    if (resType !== null && resType !== undefined) {
      const resTypeId = typeof resType === "number" ? resType : resType.id;
      const typeCst = db.cstNode(resTypeId) as SyntaxNode | null;
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

  /** Checks whether this component declaration is marked with the `final` prefix. */
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
    const evalRes: unknown = evaluator.evaluate(current ?? cst, "evaluate");
    if (evalRes !== null && evalRes !== undefined) {
      if (typeof evalRes === "boolean") return evalRes;
      if (typeof evalRes === "object" && "value" in evalRes && (evalRes as { value?: unknown }).value !== undefined) {
        return Boolean((evalRes as { value?: unknown }).value);
      }
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
   * Instantiate this component: resolve its type specifier to a class.
   * Returns the SymbolId of the resolved class, or null if unresolved.
   */
  classInstance: (db: QueryDB, self: SymbolEntry) => {
    const specArgs = db.argsOf<ModelicaModArgs>(self.id);
    let typeName = "";

    if (specArgs?.data?.isRedeclaration && specArgs.data.redeclaredTypeSpecifier) {
      typeName = specArgs.data.redeclaredTypeSpecifier;
    } else {
      const meta = getSymbolMeta(self);
      const rawType = meta?.["typeSpecifier"] ?? meta?.["type_specifier"];
      typeName = typeof rawType === "string" ? rawType : "";
      if (!typeName) {
        let current = db.cstNode(self.id) as SyntaxNode | null;
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
        typeEntry = entries?.find((e) => Boolean(getSymbolMeta(e)?.["isPredefined"]) && e.kind === "Class") ?? null;
      }
      if (!typeEntry) return null;
      return typeEntry.id;
    }

    if (!typeEntry && (typeName.includes(".") || typeName.includes("::"))) {
      typeEntry = resolveQualified(db, typeName);
    }
    if (!typeEntry) {
      const simpleName = splitQualifiedPath(typeName).pop() ?? typeName;
      const entries = db.byName(simpleName);
      typeEntry =
        entries?.find((e) => Boolean(getSymbolMeta(e)?.["isPredefined"]) && e.kind === "Class") ??
        (!typeName.includes(".") && !typeName.includes("::")
          ? (entries?.find((e) => e.parentId === null && getSymbolMeta(e)?.["classPrefixes"] === "type") ??
            entries?.find((e) => e.parentId === null && isTypeLikeSymbol(e)))
          : null) ??
        null;
    }
    if (!typeEntry) return null;
    return typeEntry.id;
  },

  /**
   * Get the array dimensions for this component as structured subscripts.
   */
  arrayDimensions: (db: QueryDB, self: SymbolEntry) => {
    const cst = db.cstNode(self.id) as SyntaxNode | null;
    if (!cst) return null;

    let declNode: SyntaxNode | null = cst;
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
    const declSubscripts = declArraySubNode ? extractSubscriptsFromCst(declArraySubNode, "parseIntLiteral") : [];

    let clauseNode: SyntaxNode | null = cst;
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
    const typeSubscripts = clauseArraySubNode ? extractSubscriptsFromCst(clauseArraySubNode, "parseIntLiteral") : [];

    const subscripts: ArrayDimensionDescriptor[] = [...declSubscripts, ...typeSubscripts];

    const classInstanceId = db.query<SymbolId | null>("classInstance", self.id);
    if (classInstanceId !== null) {
      let currentClassId: SymbolId | null = classInstanceId;
      const visitedBase = new Set<SymbolId>();

      while (currentClassId && !visitedBase.has(currentClassId)) {
        visitedBase.add(currentClassId);
        const typeClassDims = db.query<ArrayDimensionDescriptor[] | null>("arrayDimensions", currentClassId);
        if (typeClassDims && typeClassDims.length > 0) {
          subscripts.push(...typeClassDims);
        }

        const children = db.childrenOf(currentClassId);
        const extendsClause = children.find((c) => c.kind === "Extends");
        if (extendsClause) {
          const baseClass = db.query<{ id: SymbolId } | null>("resolvedBaseClass", extendsClause.id);
          if (baseClass) {
            currentClassId = baseClass.id;
            continue;
          }
        }

        const cstNode = db.cstNode(currentClassId) as QueryCstNode | null;
        const spec = getShortClassSpecifierNode(cstNode);
        if (spec) {
          const typeSpec =
            Cst.ShortClassSpecifier.typeSpecifier(spec) ??
            spec.children?.find((c: SyntaxNode) => c.type === "type_specifier" || c.type === "TypeSpecifier");
          if (typeSpec?.text) {
            const currentEntry = db.symbol(currentClassId);
            if (currentEntry) {
              const resolvedEntry = resolveQualified(db, typeSpec.text);
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
      const meta = getSymbolMeta(self);
      const variability =
        (meta?.["variability"] as string | undefined) ?? db.query<string | null>("variability", self.id);
      if (variability !== "parameter" && variability !== "constant") return { value: null };

      const mod = db.query<ModelicaModArgs | null>("effectiveModification", self.id);
      const binding = mod?.bindingExpression;
      if (binding && binding.kind === "expression" && binding.text) {
        const trimmed = binding.text.trim();
        const val = parseInt(trimmed, 10);
        if (!isNaN(val) && String(val) === trimmed) return { value: val };
        if (binding.cstBytes) {
          const exprCst = db.cstNodeRange(binding.cstBytes[0], binding.cstBytes[1], self) as QueryCstNode | null;
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
    recovery: (_cycleDb: QueryDB & CycleInfo, self: SymbolEntry): DimEvalResult => {
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
      const rawDims = db.query<ArrayDimensionDescriptor[] | null>("arrayDimensions", self.id);
      if (!rawDims || dimIndex < 0 || dimIndex >= rawDims.length) return { value: null };

      const dim = rawDims[dimIndex]!;
      if (dim.kind === "literal") {
        return { value: dim.value };
      }
      if (dim.kind === "flexible") {
        const mod = db.query<ModelicaModArgs | null>("effectiveModification", self.id);
        const binding = mod?.bindingExpression;
        if (binding) {
          if (binding.kind === "expression" && binding.cstBytes) {
            const bindingCst = db.cstNodeRange(binding.cstBytes[0], binding.cstBytes[1], self) as QueryCstNode | null;
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
          const val = db.evaluate(binding, self.parentId);
          if (Array.isArray(val)) {
            let cur: unknown = val;
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
    recovery: (cycleDb: QueryDB & CycleInfo, self: SymbolEntry, args?: Record<string, unknown>): DimEvalResult => {
      const dimIndex = Number(args?.["dimIndex"] ?? 0);
      const rawDims = cycleDb.query<ArrayDimensionDescriptor[] | null>("arrayDimensions", self.id);
      const rawDim = rawDims?.[dimIndex];
      const exprText =
        rawDim?.kind === "expression"
          ? (rawDim.text ?? "?")
          : rawDim?.kind === "flexible"
            ? ":"
            : rawDim?.kind === "literal"
              ? String(rawDim.value)
              : "?";
      return { value: null, cyclic: true, exprText, cycleOrigin: `dim:${self.id}:${dimIndex}` };
    },
  },

  /**
   * Returns cyclic array dimension dependencies (`M4035`) detected via `resolvedArrayDimensionAt`,
   * tracked directly by Salsa with no module-global side channel.
   */
  cyclicDimensionInfo: (db: QueryDB, self: SymbolEntry): Array<{ dimIndex: number; exprText: string }> | null => {
    const rawDims = db.query<ArrayDimensionDescriptor[] | null>("arrayDimensions", self.id);
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
   */
  resolvedArrayDimensions: (db: QueryDB, self: SymbolEntry): number[] | null => {
    const rawDims = db.query<ArrayDimensionDescriptor[] | null>("arrayDimensions", self.id);
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
   */
  componentInstance: (db: QueryDB, self: SymbolEntry): ComponentInstanceSummary => {
    const cstNode = db.cstNode(self.id) as SyntaxNode | null;
    if (!cstNode) {
      const meta = getSymbolMeta(self) ?? {};
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
      const resType = db.query<SymbolEntry | SymbolId | null>("resolvedType", self.id);
      if (resType !== null && resType !== undefined) {
        const resTypeId = typeof resType === "number" ? resType : resType.id;
        const typeCst = db.cstNode(resTypeId) as SyntaxNode | null;
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
    let modification: ParsedModArgs | null = modNode ? parseModArgsFromCst(modNode, self.parentId) : null;

    let localConstrClause: SyntaxNode | undefined;
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
        if (constrParsed.args.length > 0) {
          if (!modification) {
            modification = { args: [...constrParsed.args], bindingExpression: null };
          } else {
            const existingNames = new Set(modification.args.map((a) => a.name));
            const mergedArgs = [...modification.args];
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
              const baseCst = asSyntaxNode(db.cstNode(baseElem.id) as QueryCstNode | null);
              let curr: SyntaxNode | null = baseCst;
              let constrClause: SyntaxNode | undefined;
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
                  if (constrParsed.args.length > 0) {
                    if (!modification) {
                      modification = { args: [...constrParsed.args], bindingExpression: null };
                    } else {
                      const existingNames = new Set(modification.args.map((a) => a.name));
                      const mergedArgs = [...modification.args];
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

    // 5. Fast path for scalar primitive components
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
};
