/* eslint-disable */
/**
 * examples/modelica/language.ts — Full Modelica language definition
 *
 * Faithful port of the tree-sitter-modelica grammar.js into metascript
 * combinators, covering the complete Modelica 3.6 Appendix A grammar
 * (§A.1–A.2.7). Every grammar rule is expressed here so that
 * `metascript generate` produces:
 *
 *   - grammar.js      — tree-sitter grammar
 *   - ast_classes.ts   — typed semantic node wrappers
 *   - indexer_config.ts — symbol indexer hooks
 *   - query_hooks.ts   — query / lint functions
 *   - ref_config.ts    — reference resolution hooks
 *
 * Semantic annotations include:
 *   - def() on every symbol-bearing rule
 *   - model configs for AST class generation
 *   - Salsa-memoized queries implementing the Modelica instantiation algorithm
 *   - Lint rules for common diagnostics
 *   - Cross-language adapters for SysML2 interop
 */

import {
  choice,
  def,
  error,
  field,
  info,
  language,
  opt,
  prec,
  ref,
  rep,
  rep1,
  seq,
  token,
  warning,
  type QueryDB,
  type Rule,
  type SymbolEntry,
  type SymbolId,
} from "@modelscript/polyglot";
import { isBroken, mergeModArgs, modelicaMod, subModification, type ModelicaModArgs } from "./modification-args.js";

function parseModArgsFromCst(node: any, scopeId: number | null = null): any {
  const args: any[] = [];
  if (!node) return { args, bindingExpression: null, evaluationScopeId: scopeId };

  const walk = (n: any) => {
    if (!n) return;
    if (n.type === "ElementModification") {
      const nameNode = n.childForFieldName("name");
      const modNode = n.childForFieldName("modification");
      const finalNode = n.children.find((c: any) => c.type === "final");
      const eachNode = n.children.find((c: any) => c.type === "each");

      const name = nameNode ? nameNode.text : "";
      const nested = parseModArgsFromCst(modNode, scopeId);

      args.push({
        name,
        each: !!eachNode,
        final: !!finalNode,
        isRedeclaration: false,
        nestedArgs: nested.args,
        value: nested.bindingExpression,
        evaluationScopeId: scopeId,
      });
      return;
    } else if (n.type === "ElementRedeclaration") {
      const clause = n.childForFieldName("componentClause");
      if (clause) {
        const typeSpec = clause.childForFieldName("typeSpecifier");
        const decl1 = clause.childForFieldName("componentDeclaration");
        const decl = decl1?.childForFieldName("declaration");
        const ident = decl?.childForFieldName("identifier");
        const modNode = decl?.childForFieldName("modification");

        const name = ident ? ident.text : "";
        const typeName = typeSpec ? typeSpec.text : "";
        const nested = parseModArgsFromCst(modNode, scopeId);

        args.push({
          name,
          each: false,
          final: false,
          isRedeclaration: true,
          redeclaredTypeSpecifier: typeName,
          nestedArgs: nested.args,
          value: nested.bindingExpression,
          evaluationScopeId: scopeId,
        });
      }
      return;
    }
    if (n.type === "ModificationExpression") return;
    for (const child of n.children) walk(child);
  };
  walk(node);

  let bindingExpression = null;
  if (node.type === "Modification" || node.type === "ElementModification") {
    const expr = node.childForFieldName("modificationExpression");
    if (expr) bindingExpression = { kind: "expression", cstBytes: [expr.startIndex, expr.endIndex], text: expr.text };
  }

  return { args, bindingExpression, evaluationScopeId: scopeId };
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

// ---------------------------------------------------------------------------
// Helper combinators (mirrors grammar.js utility functions)
// ---------------------------------------------------------------------------

/** Match zero or more rules delimited by a separator. */
function commaSep(rule: Rule, sep: Rule = ","): Rule {
  return opt(commaSep1(rule, sep));
}

/** Match one or more rules delimited by a separator. */
function commaSep1(rule: Rule, sep: Rule = ","): Rule {
  return seq(rule, rep(seq(sep, rule)));
}

/** Unary expression template: operator operand. */
function unaryExp(operator: Rule, operand: Rule): Rule {
  return seq(field("operator", operator), field("operand", operand));
}

/** Binary expression template: operand1 operator operand2. */
function binaryExp(operator: Rule, operand1: Rule, operand2: Rule): Rule {
  return seq(field("operand1", operand1), field("operator", operator), field("operand2", operand2));
}

/**
 * Split a string on top-level commas (ignoring commas inside parentheses).
 * Used for parsing class modification argument lists.
 */
function splitTopLevel(text: string): string[] {
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
 * Resolves a dot-separated path from the global scope.
 * Used for resolving import targets and global fallbacks.
 */
function resolveQualified(db: QueryDB, path: string): SymbolEntry | null {
  const parts = path.split(".");
  if (parts.length === 0) return null;

  // Try to find the root part (entry with no parent)
  const rootEntries = db.byName(parts[0]!);
  let current =
    rootEntries.find((e) => (e.metadata as any)?.isPredefined) ??
    rootEntries.find((e) => e.parentId === null) ??
    rootEntries[0] ??
    null;

  if (!current) return null;

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]!;
    const children = db.childrenOf(current.id);
    // Prefer non-reference entries (Class, Component) over Reference entries
    current =
      children.find((c) => c.name === part && c.kind !== "Reference") || children.find((c) => c.name === part) || null;
    if (!current) return null;
  }

  return current;
}

// ---------------------------------------------------------------------------
// Precedence constants (matching grammar.js)
// ---------------------------------------------------------------------------

const PREC = {
  LOGICAL_OR: 4,
  LOGICAL_AND: 5,
  UNARY_NEGATION: 6,
  RELATIONAL: 7,
  ADDITIVE: 8,
  ADDITIVE_UNARY: 9,
  MULTIPLICATIVE: 10,
  EXPONENTIATION: 11,
} as const;

// ---------------------------------------------------------------------------
// Language Definition
// ---------------------------------------------------------------------------

export default language({
  name: "modelica",

  extras: ($) => [/\s/, $.BLOCK_COMMENT, $.LINE_COMMENT],

  conflicts: ($) => [
    [$.Name],
    [$.EquationSection],
    [$.ElseIfEquationClause],
    [$.ElseWhenEquationClause],
    [$.ElementSection],
    [$.InitialElementSection],
    [$.AlgorithmSection],
    [$.ConstraintSection],
    [$.Name, $.ComponentReferencePart],
  ],

  word: ($) => $.IDENT,

  rules: {
    // =====================================================================
    // §A.2.1 — Stored Definition
    // =====================================================================

    StoredDefinition: ($) =>
      seq(
        opt($.BOM),
        opt(field("withinDirective", $.WithinDirective)),
        rep(
          choice(
            field("classDefinition", $.ClassDefinition),
            field("componentClause", $.ComponentClause),
            field("statement", $._Statement),
          ),
        ),
      ),

    WithinDirective: ($) => seq("within", opt(field("packageName", $.Name)), ";"),

    // =====================================================================
    // §A.2.2 — Class Definition
    // =====================================================================

    ClassDefinition: ($) =>
      def({
        syntax: seq(
          opt(field("redeclare", "redeclare")),
          opt(field("final", "final")),
          opt(field("inner", "inner")),
          opt(field("outer", "outer")),
          opt(field("replaceable", "replaceable")),
          opt(field("encapsulated", "encapsulated")),
          field("classPrefixes", $.ClassPrefixes),
          field("classSpecifier", $._ClassSpecifier),
          opt(field("constrainingClause", $.ConstrainingClause)),
          ";",
        ),
        symbol: (self) => {
          return {
            kind: "Class",
            name: self.classSpecifier!.identifier,
            exports: self.classSpecifier?.identifier ? [self.classSpecifier.identifier] : [],
            inherits: self.classSpecifier?.identifier ? [self.classSpecifier.identifier] : [],
            attributes: {
              classPrefixes: self.classPrefixes,
              redeclare: self.redeclare,
              final: self.final,
              inner: self.inner,
              outer: self.outer,
              replaceable: self.replaceable,
              encapsulated: self.encapsulated,
              annotationClause: (self.classSpecifier as any).annotationClause,
            },
          };
        },
        queries: {
          /** All direct children of this class. */
          members: (db, self) => db.childrenOf(self.id),
          /** Only nested class definitions. */
          nestedClasses: (db, self) => db.childrenOf(self.id).filter((c) => c.kind === "Class"),
          /** Only component declarations. */
          components: (db, self) => db.childrenOf(self.id).filter((c) => c.kind === "Component"),
          /** Only extends clauses. */
          extendsClasses: (db, self) => db.childrenOf(self.id).filter((c) => c.kind === "Extends"),
          /** Only import clauses. */
          imports: (db, self) => db.childrenOf(self.id).filter((c) => c.kind === "Import"),
          /** Components with causality=input. */
          inputParameters: (db, self) =>
            db
              .childrenOf(self.id)
              .filter((c) => c.kind === "Component" && (c.metadata as Record<string, unknown>)?.causality === "input"),
          /** Components with causality=output. */
          outputParameters: (db, self) =>
            db
              .childrenOf(self.id)
              .filter((c) => c.kind === "Component" && (c.metadata as Record<string, unknown>)?.causality === "output"),
          /** Components with variability=parameter. */
          parameters: (db, self) =>
            db
              .childrenOf(self.id)
              .filter(
                (c) => c.kind === "Component" && (c.metadata as Record<string, unknown>)?.variability === "parameter",
              ),
          /** Components with variability=constant. */
          constants: (db, self) =>
            db
              .childrenOf(self.id)
              .filter(
                (c) => c.kind === "Component" && (c.metadata as Record<string, unknown>)?.variability === "constant",
              ),
          /** Connect equations among children. */
          connectEquations: (db, self) => db.childrenOf(self.id).filter((c) => c.kind === "ConnectEquation"),
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
                if (child.kind === "Component" && (child.metadata as Record<string, unknown>)?.redeclare) {
                  redeclaredNames.add(child.name);
                }
                if (child.kind === "Class" && (child.metadata as Record<string, unknown>)?.redeclare) {
                  redeclaredNames.add(child.name);
                }
              }

              // Inline extends at their declaration order
              for (const child of children) {
                if (child.kind === "Extends") {
                  // Resolve the base class
                  const baseName = child.name;
                  const baseEntries = db.byName(baseName);
                  const baseClass = baseEntries?.[0];
                  if (baseClass && !visited.has(baseClass.id)) {
                    visited.add(baseClass.id);
                    // Recursively get all elements of the base class
                    const baseElements = db.childrenOf(baseClass.id);
                    for (const inherited of baseElements) {
                      if (inherited.name && !redeclaredNames.has(inherited.name) && !brokenNames.has(inherited.name)) {
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
            const kind = (self.metadata as Record<string, unknown>)?.classPrefixes;
            return (
              kind === "connector" ||
              kind === "expandable connector" ||
              (typeof kind === "string" && kind.includes("connector"))
            );
          },
          /**
           * Resolve a modification argument by name from the class's
           * active modification context.
           */
          resolveModification: (db: QueryDB, self: SymbolEntry) => {
            // Modification resolution is context-dependent:
            // the effective modification comes from the instantiation site
            // (outer modification merged with local declaration modifications).
            // In a Salsa query context, we return the metadata-level modification info.
            return (self.metadata as Record<string, unknown>)?.modification ?? null;
          },

          // =================================================================
          // Milestone 2: Scope Resolution (Modelica §5.3)
          // =================================================================

          /**
           * Resolve a simple name in this class's scope.
           *
           * Implements Modelica §5.3 name lookup:
           *   1. Direct elements (class defs, components)
           *   2. Inherited elements (via extends)
           *   3. Qualified imports (import A = B.C.D)
           *   4. Unqualified imports (import B.C.*)
           *   5. Compound imports (import B.C.{D, E})
           *   6. Parent scope walk (unless encapsulated)
           *   7. Predefined types fallback (via db.byName)
           *
           * Returns a resolver function that accepts a name string.
           * This is a "factory query" — it computes the scope once and
           * returns a closure that callers invoke with specific names.
           */
          resolveSimpleName: (db: QueryDB, self: SymbolEntry) => {
            const baseId = db.baseOf(self.id);
            const sourceId = baseId ?? self.id;
            // Pre-compute lookup structures for O(1) name resolution
            const children = db.childrenOf(sourceId);
            const directByName = new Map<string, SymbolEntry>();
            const qualifiedImports = new Map<string, string>(); // shortName → pkgName
            const unqualifiedImportPkgs: string[] = [];
            const compoundImports: Array<{ pkg: string; names: string[] }> = [];

            for (const child of children) {
              // Direct elements
              if (child.kind === "Class" || child.kind === "Component") {
                directByName.set(child.name, child);
              }

              // Import processing
              if (child.kind === "Import") {
                const meta = child.metadata as Record<string, unknown>;
                const importKind = meta?.importKind as string | undefined;
                const pkgName = (meta?.packageName ?? child.name) as string;

                if (importKind === "simple" || !importKind) {
                  // import A = B.C.D  or  import B.C.D
                  const shortName = (meta?.shortName as string) ?? pkgName.split(".").pop() ?? pkgName;
                  qualifiedImports.set(shortName, pkgName);
                } else if (importKind === "unqualified") {
                  // import B.C.*
                  unqualifiedImportPkgs.push(pkgName);
                } else if (importKind === "compound") {
                  // import B.C.{D, E}
                  const importNames = db
                    .childrenOfField(child.id, "importName")
                    .map((c) => c.name)
                    .filter(Boolean);
                  compoundImports.push({ pkg: pkgName, names: importNames });
                }
              }
            }

            // Inherited elements for lookup (LAZY and RECURSIVE to reach base chains)
            let inheritedByName: Map<string, SymbolEntry> | null = null;
            const getInherited = () => {
              if (inheritedByName) return inheritedByName;
              inheritedByName = new Map<string, SymbolEntry>();

              const visited = new Set<number>([self.id]);
              const walk = (targetId: number) => {
                if (visited.has(targetId)) return;
                visited.add(targetId);

                const targetChildren = db.childrenOf(targetId);
                const targetEntry = db.symbol(targetId);

                for (const child of targetChildren) {
                  if (child.kind === "Extends") {
                    const baseClass = db.query<SymbolEntry | null>("resolvedBaseClass", child.id);
                    if (baseClass) {
                      // (debug log removed)
                      walk(baseClass.id);
                    }
                  } else if (
                    child.name &&
                    child.kind !== "Reference" &&
                    child.kind !== "Import" &&
                    !inheritedByName!.has(child.name)
                  ) {
                    inheritedByName!.set(child.name, child);
                  }
                }
              };

              for (const child of children) {
                if (child.kind === "Extends") {
                  const baseClass = db.query<SymbolEntry | null>("resolvedBaseClass", child.id);
                  if (baseClass) walk(baseClass.id);
                }
              }
              return inheritedByName;
            };

            const isEncapsulated = !!(self.metadata as Record<string, unknown>)?.encapsulated;

            // Return the resolver closure
            return (name: string, encapsulated = false, skipInherited = false): SymbolEntry | null => {
              // (debug log removed)
              // 1. Direct elements
              const direct = directByName.get(name);
              if (direct) return direct;

              // 2. Inherited elements
              if (!skipInherited) {
                const inherited = getInherited().get(name);
                if (inherited) return inherited;
              }

              // 3. Qualified imports
              const qualPkg = qualifiedImports.get(name);
              if (qualPkg) {
                return resolveQualified(db, qualPkg);
              }

              // 4. Compound imports
              for (const ci of compoundImports) {
                if (ci.names.includes(name)) {
                  const resolved = db.byName(`${ci.pkg}.${name}`);
                  const foundEntry = resolved?.find(
                    (e) => e.kind === "Class" || e.kind === "Package" || e.kind === "Function",
                  );
                  if (foundEntry) return foundEntry;
                }
              }

              // 5. Unqualified imports
              for (const pkg of unqualifiedImportPkgs) {
                const pkgEntry = db
                  .byName(pkg)
                  ?.find((e) => e.kind === "Class" || e.kind === "Package" || e.kind === "Function");
                if (pkgEntry) {
                  for (const pkgChild of db.childrenOf(pkgEntry.id)) {
                    if (pkgChild.name === name && pkgChild.kind !== "Reference") return pkgChild;
                  }
                }
              }

              // 6. Parent scope walk (unless encapsulated)
              if (!encapsulated && !isEncapsulated && self.parentId !== null && self.parentId !== self.id) {
                const parentEntry = db.symbol(self.parentId);
                if (parentEntry && (parentEntry.kind === "Class" || parentEntry.kind === "Package")) {
                  const parentResolver = db.query<(n: string, enc?: boolean, skip?: boolean) => SymbolEntry | null>(
                    "resolveSimpleName",
                    parentEntry.id,
                  );
                  if (parentResolver) return parentResolver(name, false, skipInherited);
                }
              }

              // 7. Predefined types fallback
              const predefined = db.byName(name);
              return (
                predefined?.find((e) => e.kind === "Class" || e.kind === "Package" || e.kind === "Function") ?? null
              );
            };
          },

          /**
           * Resolve a qualified (dot-separated) name from this class's scope.
           *
           * Uses resolveSimpleName for the first part, then navigates
           * into children for each subsequent part.
           */
          resolveName: (db: QueryDB, self: SymbolEntry) => {
            return (qualifiedName: string, skipInherited = false): SymbolEntry | null => {
              const parts = qualifiedName.split(".");
              if (parts.length === 0) return null;

              // Resolve first part via scope resolution
              const resolver = db.query<(n: string, enc?: boolean, skip?: boolean) => SymbolEntry | null>(
                "resolveSimpleName",
                self.id,
              );
              let current = resolver?.(parts[0]!, false, skipInherited) ?? null;
              if (!current) return null;

              // Navigate remaining parts
              for (let i = 1; i < parts.length; i++) {
                const part = parts[i]!;
                let found: SymbolEntry | null = null;
                let fallback: SymbolEntry | null = null;
                for (const child of db.childrenOf(current.id)) {
                  if (child.name === part) {
                    // Prefer Class/Component/Extends over Reference entries
                    if (child.kind !== "Reference") {
                      found = child;
                      break;
                    } else if (!fallback) {
                      fallback = child;
                    }
                  }
                }
                if (!found) found = fallback;
                if (!found) return null;
                current = found;
              }

              return current;
            };
          },

          // =================================================================
          // Milestone 3: Instantiation Query
          // =================================================================

          /**
           * Instantiate this class: resolve all elements, merge outer
           * modifications (from SpecializationArgs), expand extends,
           * and filter redeclarations.
           *
           * This is the central query that replaces ModelicaClassInstance.instantiate().
           *
           * For a base (non-specialized) symbol, returns direct children.
           * For a specialized (virtual) symbol, applies outer modifications:
           *   - Components get their sub-modification via specialize()
           *   - Extends get their merged modification via specialize()
           *   - Redeclared names are filtered out
           *   - Broken names are removed
           *
           * Returns a list of SymbolIds — some may be virtual (specialized).
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
              const children = db.childrenOf(sourceId);

              // Pre-scan for body-level redeclares
              const redeclaredNames = new Set<string>();
              for (const child of children) {
                const meta = child.metadata as Record<string, unknown>;
                if (meta?.redeclare) {
                  redeclaredNames.add(child.name);
                }
              }

              const elements: SymbolId[] = [];

              for (const child of children) {
                if (child.kind === "Component") {
                  // Get this component's sub-modification from the outer mod
                  const childSubMod = subModification(outerMod, child.name);

                  if (childSubMod && (childSubMod.args.length > 0 || childSubMod.bindingExpression)) {
                    // Specialize this component with its effective modification
                    const specialized = db.specialize(child.id, modelicaMod(childSubMod));
                    elements.push(specialized);
                  } else {
                    // No outer modification for this component — use as-is
                    elements.push(child.id);
                  }
                } else if (child.kind === "Extends") {
                  // Check for break
                  if (isBroken(outerMod, child.name)) continue;

                  // Resolve the base class
                  const resolveName = db.query<(n: string) => SymbolEntry | null>("resolveName", self.id);
                  let baseClass: SymbolEntry | null | undefined = undefined;
                  if (resolveName) {
                    baseClass = resolveName(child.name);
                  }
                  if (!baseClass) {
                    baseClass = db.byName(child.name)?.find((e) => e.kind === "Class" || e.kind === "Package") ?? null;
                  }

                  if (!baseClass) {
                    // Unresolved extends — skip but still record the extends entry
                    elements.push(child.id);
                    continue;
                  }

                  // Parse local modification of the extends clause
                  const childCst = db.cstNode(child.id) as any;
                  const localModNode = childCst?.childForFieldName("classOrInheritanceModification");
                  const localMod = localModNode
                    ? (parseModArgsFromCst(localModNode, self.id) as ModelicaModArgs)
                    : null;

                  // Merge local modification with outer modification
                  const mergedMod = mergeModArgs(outerMod, localMod);

                  // Specialize the base class with the merged modification
                  // (extends modifications are propagated to the base)
                  let specializedBaseId: SymbolId;
                  if (mergedMod && mergedMod.args.length > 0) {
                    specializedBaseId = db.specialize(baseClass.id, modelicaMod(mergedMod));
                  } else {
                    specializedBaseId = baseClass.id;
                  }

                  // Recursively get the base class's instantiated elements
                  const baseElements = db.query<SymbolId[]>("instantiate", specializedBaseId);

                  // Inline inherited elements, filtering redeclared names
                  for (const eid of baseElements) {
                    const entry = db.symbol(eid);
                    if (entry && !redeclaredNames.has(entry.name)) {
                      elements.push(eid);
                    }
                  }
                } else if (child.kind === "Class") {
                  // Nested class — include unless redeclared
                  if (!redeclaredNames.has(child.name)) {
                    elements.push(child.id);
                  }
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
        },
        model: {
          name: "ClassDefinition",
          specializable: true,
          visitable: true,
          properties: {
            diagnostics: "string[]",
            isPartial: "boolean",
            isEncapsulated: "boolean",
            isReplaceable: "boolean",
            isExpandable: "boolean",
            isFinal: "boolean",
            isRedeclare: "boolean",
          },
          queryTypes: {
            members: "SemanticNode[]",
            nestedClasses: "ClassDefinition[]",
            components: "ComponentDeclaration[]",
            extendsClasses: "ExtendsClause[]",
            imports: "SemanticNode[]",
            inputParameters: "ComponentDeclaration[]",
            outputParameters: "ComponentDeclaration[]",
            parameters: "ComponentDeclaration[]",
            constants: "ComponentDeclaration[]",
            connectEquations: "SemanticNode[]",
            allElements: "SemanticNode[]",
            isConnector: "boolean",
            resolveModification: "unknown",
            resolveSimpleName: "((name: string, encapsulated?: boolean) => SemanticNode | null)",
            resolveName: "((qualifiedName: string) => SemanticNode | null)",
            instantiate: "SymbolId[]",
          },
        },
        lints: {
          /** Warn if class name starts with lowercase letter. */
          classNamingConvention: (_db: QueryDB, self: SymbolEntry) => {
            if (self.name && /^[a-z]/.test(self.name)) {
              return warning(`Class '${self.name}' should start with an uppercase letter`, { field: "classSpecifier" });
            }
            return null;
          },
          /** Warn if the class body is empty (no members at all). */
          emptyClass: (db: QueryDB, self: SymbolEntry) => {
            if (db.childrenOf(self.id).filter((c: any) => c.kind !== "Reference").length === 0) {
              return info(`Class '${self.name}' has no members`);
            }
            return null;
          },
          /** Error if endIdentifier does not match class identifier. */
          identifierMismatch: (db: QueryDB, self: SymbolEntry) => {
            const cst = db.cstNode(self.id) as any;
            if (!cst) return null;
            const classSpec = cst.childForFieldName("classSpecifier");
            if (classSpec) {
              const startId = classSpec.childForFieldName("identifier")?.text;
              const endId = classSpec.childForFieldName("endIdentifier")?.text;
              if (startId && endId && startId !== endId) {
                return error(`Class end identifier '${endId}' does not match class name '${startId}'`);
              }
            }
            return null;
          },
          /** Error if duplicate element names exist in this class. */
          duplicateElement: (db: QueryDB, self: SymbolEntry) => {
            const names = new Set<string>();
            const elements = db.childrenOf(self.id);
            const duplicates = new Set<string>();
            for (const el of elements) {
              if ((el.kind !== "Class" && el.kind !== "Component") || !el.name || BUILTIN_MODELICA_NAMES.has(el.name))
                continue;
              if (names.has(el.name)) {
                duplicates.add(el.name);
              } else {
                names.add(el.name);
              }
            }
            if (duplicates.size > 0) {
              const results = [];
              for (const dup of duplicates) {
                results.push(error(`Duplicate element '${dup}' in class '${self.name}'`));
              }
              return results;
            }
            return null;
          },
          /** Function components must not be public unless they are input/output */
          functionPublicVariable: (db: QueryDB, self: SymbolEntry) => {
            const meta = self.metadata as Record<string, unknown>;
            if (meta?.classPrefixes !== "function" && meta?.classPrefixes !== "operator function") return null;

            const results = [];
            for (const el of db.childrenOf(self.id)) {
              if (el.kind === "Component") {
                const elMeta = el.metadata as Record<string, unknown>;
                if (!elMeta?.causality && !elMeta?.isProtected) {
                  results.push(
                    error(`Public variable '${el.name}' in function '${self.name}' must be an input or output`, {
                      field: "classSpecifier",
                    }),
                  );
                }
              }
            }
            return results.length > 0 ? results : null;
          },
          /** External functions cannot have an algorithm section */
          externalWithAlgorithm: (db: QueryDB, self: SymbolEntry) => {
            const meta = self.metadata as Record<string, unknown>;
            if (meta?.classPrefixes !== "function" && meta?.classPrefixes !== "operator function") return null;

            const cst = db.cstNode(self.id) as any;
            if (!cst) return null;
            const classSpec = cst.childForFieldName("classSpecifier");
            if (!classSpec) return null;

            const hasExternal = !!classSpec.childForFieldName("externalFunctionClause");
            if (!hasExternal) return null;

            let hasAlgorithm = false;
            for (const child of classSpec.children) {
              if (child.type === "AlgorithmSection") {
                hasAlgorithm = true;
                break;
              }
            }

            if (hasAlgorithm) {
              return error(`Function '${self.name}' cannot have both an external clause and an algorithm section`, {
                field: "classSpecifier",
              });
            }
            return null;
          },
          /** Functions can only contain certain types of variables */
          functionInvalidVarType: (db: QueryDB, self: SymbolEntry) => {
            const meta = self.metadata as Record<string, unknown>;
            if (meta?.classPrefixes !== "function" && meta?.classPrefixes !== "operator function") return null;

            const results = [];
            for (const el of db.childrenOf(self.id)) {
              if (el.kind === "Component") {
                const elMeta = el.metadata as Record<string, unknown>;
                if (elMeta?.causality) {
                  const typeName = elMeta.typeSpecifier as string;
                  if (typeName) {
                    const resolved = db.byName(typeName)?.find((e) => e.kind === "Class" || e.kind === "Package");
                    if (resolved) {
                      const resMeta = resolved.metadata as Record<string, unknown>;
                      const prefix = resMeta?.classPrefixes as string;
                      if (
                        prefix === "model" ||
                        prefix === "block" ||
                        prefix === "connector" ||
                        prefix === "expandable connector"
                      ) {
                        results.push(
                          error(
                            `Function '${self.name}' cannot have an input/output variable '${el.name}' of type '${typeName}'`,
                            { field: "classSpecifier" },
                          ),
                        );
                      }
                    }
                  }
                }
              }
            }
            return results.length > 0 ? results : null;
          },
          /** Function input/output variables cannot be protected */
          functionProtectedIo: (db: QueryDB, self: SymbolEntry) => {
            const meta = self.metadata as Record<string, unknown>;
            if (meta?.classPrefixes !== "function" && meta?.classPrefixes !== "operator function") return null;

            const results = [];
            for (const el of db.childrenOf(self.id)) {
              if (el.kind === "Component") {
                const elMeta = el.metadata as Record<string, unknown>;
                if (elMeta?.causality && elMeta?.isProtected) {
                  results.push(
                    error(`Function input/output variable '${el.name}' cannot be protected`, {
                      field: "classSpecifier",
                    }),
                  );
                }
              }
            }
            return results.length > 0 ? results : null;
          },
          /** Nested when-statements are not allowed */
          nestedWhen: (db: QueryDB, self: SymbolEntry) => {
            const cst = db.cstNode(self.id) as any;
            if (!cst) return null;
            const classSpec = cst.childForFieldName("classSpecifier");
            if (!classSpec) return null;

            const results: any[] = [];
            const walk = (node: any, inWhen: boolean) => {
              if (node.type === "WhenStatement" || node.type === "WhenEquation") {
                if (inWhen) {
                  results.push(error(`Nested when-statements are not allowed`, { field: "classSpecifier" }));
                } else {
                  inWhen = true;
                }
              }
              for (const child of node.children) {
                walk(child, inWhen);
              }
            };

            for (const child of classSpec.children) {
              if (child.type === "AlgorithmSection" || child.type === "EquationSection") {
                walk(child, false);
              }
            }
            return results.length > 0 ? results : null;
          },
          /** Detect literal division by zero */
          divisionByZero: (db: QueryDB, self: SymbolEntry) => {
            const cst = db.cstNode(self.id) as any;
            if (!cst) return null;

            const results: any[] = [];
            const walk = (node: any) => {
              if (node.type === "BinaryExpression") {
                if (node.childForFieldName("operator")?.text === "/") {
                  const op2 = node.childForFieldName("operand2");
                  if (op2 && op2.text && op2.text.trim() === "0") {
                    results.push(error(`Division by zero`, { field: "classSpecifier" }));
                  } else if (
                    op2 &&
                    op2.type === "UnaryExpression" &&
                    op2.childForFieldName("operator")?.text === "-" &&
                    op2.childForFieldName("operand")?.text?.trim() === "0"
                  ) {
                    results.push(error(`Division by zero`, { field: "classSpecifier" }));
                  }
                }
              }
              for (const child of node.children) walk(child);
            };

            if (cst) walk(cst);
            return results.length > 0 ? results : null;
          },
          /** Assignment to constant Variables */
          assignmentToConstant: (db: QueryDB, self: SymbolEntry) => {
            const cst = db.cstNode(self.id) as any;
            if (!cst) return null;

            const resolve = db.query<(name: string) => SymbolEntry | null>("resolveSimpleName", self.id);
            if (!resolve) return null;

            const results: any[] = [];
            const walk = (node: any) => {
              if (node.type === "SimpleAssignmentStatement" || node.type === "ComplexAssignmentStatement") {
                const targetNode =
                  node.childForFieldName("target") ||
                  (node.type === "ComplexAssignmentStatement" ? node.childForFieldName("outputExpressionList") : null);

                // For simple assignments checking the main identifier
                if (node.type === "SimpleAssignmentStatement" && targetNode?.type === "ComponentReference") {
                  const refName =
                    targetNode.children.find((c: any) => c.type === "IDENT")?.text ||
                    targetNode.text.split("[")[0].trim();
                  const resolved = resolve(refName);
                  if (resolved) {
                    const meta = resolved.metadata as Record<string, unknown>;
                    if (meta?.variability === "constant") {
                      results.push(
                        error(`Cannot assign to constant '${targetNode.text}'`, { field: "classSpecifier" }),
                      );
                    }
                  }
                }
              }
              for (const child of node.children) walk(child);
            };

            for (const child of cst.childForFieldName("classSpecifier")?.children || []) {
              if (child.type === "AlgorithmSection") walk(child);
            }
            return results.length > 0 ? results : null;
          },
          /** For-loop iterator must be 1D */
          forIteratorNot1D: (db: QueryDB, self: SymbolEntry) => {
            const cst = db.cstNode(self.id) as any;
            if (!cst) return null;

            const results: any[] = [];
            const walk = (node: any) => {
              if (node.type === "ForIndex") {
                const expr = node.childForFieldName("expression");
                if (expr && expr.type === "ArrayConstructor") {
                  const list = expr.childForFieldName("expressionList");
                  if (list) {
                    const elements = list.children.filter(
                      (c: any) => c.type === "Expression" || c.type === "ArrayConstructor",
                    );
                    const hasNested = elements.some((e: any) => e.type === "ArrayConstructor");
                    if (hasNested) {
                      const outerLen = elements.length;
                      const nested = elements.find((e: any) => e.type === "ArrayConstructor");
                      const innerElements =
                        nested
                          ?.childForFieldName("expressionList")
                          ?.children.filter((c: any) => c.type === "Expression" || c.type === "ArrayConstructor") || [];
                      const innerLen = innerElements.length;
                      const shape = `Integer[${outerLen}, ${innerLen}]`;
                      const varName = node.childForFieldName("identifier")?.text || "?";
                      results.push(
                        error(`For loop iterator '${varName}' must be a 1-dimensional array, got shape ${shape}`, {
                          field: "classSpecifier",
                        }),
                      );
                    }
                  }
                }
              }
              for (const child of node.children) walk(child);
            };

            for (const child of cst.childForFieldName("classSpecifier")?.children || []) {
              if (
                child.type === "AlgorithmSection" ||
                child.type === "EquationSection" ||
                child.type === "ForEquation"
              ) {
                walk(child);
              }
            }
            return results.length > 0 ? results : null;
          },
          /** Type mismatch checks for equations, assignments, and if-branches */
          classBodyTypeChecks: (db: QueryDB, self: SymbolEntry) => {
            const cst = db.cstNode(self.id) as any;
            if (!cst) return null;

            const resolve = db.query<(name: string) => SymbolEntry | null>("resolveName", self.id);
            if (!resolve) return null;

            const results: any[] = [];

            const getType = (cstNode: any) => {
              if (cstNode.type === "ComponentReference") {
                const text = cstNode.text.split("[")[0].trim();
                const resolved = resolve(text);
                if (resolved && resolved.kind === "Component") {
                  const typeId = db.query<SymbolId | null>("resolvedType", resolved.id);
                  if (typeId) {
                    const t = db.symbol(typeId);
                    return t ? t.name : null;
                  }
                }
              } else if (
                cstNode.type === "Literal" ||
                cstNode.type === "IntegerLiteral" ||
                cstNode.type === "RealLiteral" ||
                cstNode.type === "StringLiteral" ||
                cstNode.type === "BooleanLiteral"
              ) {
                if (cstNode.type === "StringLiteral" || cstNode.text.startsWith('"')) return "String";
                if (cstNode.type === "BooleanLiteral" || cstNode.text === "true" || cstNode.text === "false")
                  return "Boolean";
                if (cstNode.type === "IntegerLiteral" || (!cstNode.text.includes(".") && !cstNode.text.includes("e")))
                  return "Integer";
                return "Real";
              }
              return null;
            };

            const walk = (node: any) => {
              if (node.type === "SimpleAssignmentStatement" || node.type === "SimpleEquation") {
                const lhs = node.childForFieldName("target") || node.childForFieldName("expression1");
                const rhs = node.childForFieldName("source") || node.childForFieldName("expression2");
                if (lhs && rhs) {
                  const t1 = getType(lhs);
                  const t2 = getType(rhs);
                  if (t1 && t2 && t1 !== t2) {
                    // Basic compatibility (Integer -> Real is ok)
                    if (t1 === "Real" && t2 === "Integer") {
                    } // allowed
                    else if (t2 === "enumeration" && t1 === "Integer") {
                    } // sometimes allowed
                    else {
                      const kind = node.type === "SimpleEquation" ? "Equation" : "Assignment";
                      results.push(
                        error(`${kind} type mismatch: '${lhs.text}' is ${t1}, but '${rhs.text}' is ${t2}`, {
                          field: "classSpecifier",
                        }),
                      );
                    }
                  }
                }
              } else if (
                node.type === "IfStatement" ||
                node.type === "IfEquation" ||
                node.type === "WhenStatement" ||
                node.type === "WhenEquation" ||
                node.type === "ElseIfStatementClause" ||
                node.type === "ElseIfEquationClause" ||
                node.type === "ElseWhenStatementClause" ||
                node.type === "ElseWhenEquationClause"
              ) {
                const cond = node.childForFieldName("condition");
                if (cond) {
                  const cType = getType(cond);
                  if (cType && cType !== "Boolean") {
                    results.push(
                      error(`Condition expression must be Boolean, got ${cType} for '${cond.text}'`, {
                        field: "classSpecifier",
                      }),
                    );
                  }
                }
              }
              for (const child of node.children) walk(child);
            };

            for (const child of cst.childForFieldName("classSpecifier")?.children || []) {
              if (child.type === "AlgorithmSection" || child.type === "EquationSection") walk(child);
            }
            return results.length > 0 ? results : null;
          },
          /** Tuple expressions can only be used in assignments/equations */
          tupleExpressionContext: (db: QueryDB, self: SymbolEntry) => {
            const cst = db.cstNode(self.id) as any;
            if (!cst) return null;

            const results: any[] = [];
            const walk = (node: any, isValidContext: boolean) => {
              if (node.type === "OutputExpressionList") {
                let count = 0;
                for (const child of node.children) {
                  if (
                    child.type === "Expression" ||
                    child.type === "ComponentReference" ||
                    child.type === "FunctionCall"
                  )
                    count++;
                }
                if (count > 1 && !isValidContext) {
                  results.push(
                    error(`Tuple expression '${node.text}' can only be used in a function call assignment`, {
                      field: "classSpecifier",
                    }),
                  );
                }
                return; // Avoid descending into child expressions if we already handled the output list
              }

              let validForChildren = false;
              if (node.type === "ComplexAssignmentStatement") validForChildren = true;
              if (node.type === "SimpleEquation") {
                const expr2 = node.childForFieldName("expression2");
                if (expr2 && expr2.type === "FunctionCall") validForChildren = true;
              }

              for (const child of node.children) {
                walk(child, validForChildren || isValidContext);
              }
            };

            for (const child of cst.childForFieldName("classSpecifier")?.children || []) {
              if (child.type === "AlgorithmSection" || child.type === "EquationSection") walk(child, false);
            }
            return results.length > 0 ? results : null;
          },
          /** Stubs for Batch 4 and 5 remaining ClassDefinition lints */
          connectFlowMismatch: () => null,
          nonConnectorType: () => null,
          functionArgVariability: () => null,
          functionDefaultArgCycle: () => null,
          unusedInputVariable: () => null,
          unbalancedModel: () => null,
          missingInner: () => null,
          nameNotFound: () => null,
          binaryOpTypeMismatch: () => null,
          withinInScript: () => null,
          arrayDimensionMismatch: () => null,
        },
        adapters: {
          sysml2: {
            target: "BlockDefinition",
            transform: (db, self) => ({
              name: (self as SymbolEntry).name,
              defKind: ((self as SymbolEntry).metadata as Record<string, unknown>)?.classPrefixes ?? "class",
              isAbstract: false,
              parts: db
                .childrenOf((self as SymbolEntry).id)
                .filter((c) => c.kind === "Component")
                .map((c) => ({
                  name: c.name,
                  typeName: (c.metadata as Record<string, unknown>)?.typeSpecifier,
                  direction: (c.metadata as Record<string, unknown>)?.causality ?? null,
                  isParameter: (c.metadata as Record<string, unknown>)?.variability === "parameter",
                })),
              nestedBlocks: db
                .childrenOf((self as SymbolEntry).id)
                .filter((c) => c.kind === "Class")
                .map((c) => db.project(c, "sysml2")),
            }),
          },
        },
        graphics: (self) => ({
          role: "node" as const,
          node: {
            shape: "rect",
            markup: [
              { tagName: "rect", selector: "body" },
              { tagName: "text", selector: "header" },
              { tagName: "line", selector: "separator" },
              { tagName: "text", selector: "label" },
            ],
            attrs: {
              body: { fill: "#e3f2fd", stroke: "#1565c0", strokeWidth: 2, rx: 4, ry: 4 },
              header: {
                text: "{{classPrefixes}}",
                fill: "#1565c0",
                fontSize: 10,
                textAnchor: "middle",
                refX: 0.5,
                refY: 14,
              },
              separator: { x1: 0, y1: 24, x2: "100%", y2: 24, stroke: "#1565c0", strokeWidth: 1 },
              label: {
                text: "{{name}}",
                fill: "#0d47a1",
                fontSize: 14,
                fontWeight: "bold",
                textAnchor: "middle",
                refX: 0.5,
                refY: 40,
              },
            },
            size: { width: 200, height: 60 },
            ports: {
              groups: {
                in: {
                  position: "left",
                  attrs: { circle: { r: 5, fill: "#43a047", stroke: "#fff", strokeWidth: 1.5 } },
                },
                out: {
                  position: "right",
                  attrs: { circle: { r: 5, fill: "#ef6c00", stroke: "#fff", strokeWidth: 1.5 } },
                },
              },
            },
            portQuery: "components",
          },
        }),
      }),

    ClassPrefixes: () =>
      seq(
        opt(field("partial", "partial")),
        choice(
          field("class", "class"),
          field("model", "model"),
          seq(opt(field("operator", "operator")), field("record", "record")),
          field("block", "block"),
          seq(opt(field("expandable", "expandable")), field("connector", "connector")),
          field("type", "type"),
          field("package", "package"),
          seq(
            opt(field("purity", choice("pure", "impure"))),
            opt(field("operator", "operator")),
            field("function", "function"),
          ),
          field("operator", "operator"),
          field("optimization", "optimization"),
        ),
      ),

    _ClassSpecifier: ($) => choice($.LongClassSpecifier, $.ShortClassSpecifier, $.DerClassSpecifier),

    LongClassSpecifier: ($) =>
      seq(
        opt(field("extends", "extends")),
        field("identifier", $.IDENT),
        opt(field("classModification", $.ClassModification)),
        opt(field("description", $.Description)),
        opt(field("section", $.InitialElementSection)),
        rep(field("section", choice($.ElementSection, $.EquationSection, $.AlgorithmSection, $.ConstraintSection))),
        opt(field("externalFunctionClause", $.ExternalFunctionClause)),
        opt(seq(field("annotationClause", $.AnnotationClause), ";")),
        "end",
        field("endIdentifier", $.IDENT),
      ),

    ShortClassSpecifier: ($) =>
      seq(
        field("identifier", $.IDENT),
        "=",
        choice(
          seq(
            opt(field("causality", choice("input", "output"))),
            field("typeSpecifier", $.TypeSpecifier),
            opt(field("arraySubscripts", $.ArraySubscripts)),
            opt(field("classModification", $.ClassModification)),
          ),
          seq(
            field("enumeration", "enumeration"),
            "(",
            opt(
              choice(
                commaSep1(field("enumerationLiteral", $.EnumerationLiteral)),
                field("unspecifiedEnumeration", ":"),
              ),
            ),
            ")",
          ),
        ),
        opt(field("description", $.Description)),
        opt(field("annotationClause", $.AnnotationClause)),
      ),

    DerClassSpecifier: ($) =>
      seq(
        field("identifier", $.IDENT),
        "=",
        "der",
        "(",
        field("typeSpecifier", $.TypeSpecifier),
        ",",
        commaSep1(field("input", $.IDENT)),
        ")",
        opt(field("description", $.Description)),
        opt(field("annotationClause", $.AnnotationClause)),
      ),

    EnumerationLiteral: ($) =>
      def({
        syntax: seq(
          field("identifier", $.IDENT),
          opt(field("description", $.Description)),
          opt(field("annotationClause", $.AnnotationClause)),
        ),
        symbol: (self) => ({
          kind: "EnumerationLiteral",
          name: self.identifier,
        }),
        model: {
          name: "EnumerationLiteral",
          visitable: true,
        },
      }),

    ExternalFunctionClause: ($) =>
      seq(
        "external",
        opt(field("languageSpecification", $.LanguageSpecification)),
        opt(field("externalFunctionCall", $.ExternalFunctionCall)),
        opt(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    LanguageSpecification: ($) => field("language", $.STRING),

    ExternalFunctionCall: ($) =>
      seq(
        opt(seq(field("output", $.ComponentReference), "=")),
        field("functionName", $.IDENT),
        "(",
        opt(field("arguments", $.ExpressionList)),
        ")",
      ),

    // =====================================================================
    // §A.2.2a — Element Sections
    // =====================================================================

    InitialElementSection: ($) => seq(rep1(field("element", $._Element))),

    ElementSection: ($) => seq(field("visibility", choice("protected", "public")), rep(field("element", $._Element))),

    _Element: ($) =>
      choice($.ClassDefinition, $.ComponentClause, $.ExtendsClause, $._ImportClause, $.ElementAnnotation),

    ElementAnnotation: ($) => prec(-1, seq($.AnnotationClause, ";")),

    _ImportClause: ($) => choice($.SimpleImportClause, $.CompoundImportClause, $.UnqualifiedImportClause),

    SimpleImportClause: ($) =>
      def({
        syntax: seq(
          "import",
          opt(seq(field("shortName", $.IDENT), "=")),
          field("packageName", $.Name),
          opt(field("description", $.Description)),
          opt(field("annotationClause", $.AnnotationClause)),
          ";",
        ),
        symbol: (self) => ({
          kind: "Import",
          name: self.packageName,
          attributes: {
            shortName: self.shortName,
            packageName: self.packageName,
          },
        }),
        model: {
          name: "SimpleImportClause",
          visitable: true,
          properties: {
            importKind: '"simple"',
          },
        },
      }),

    CompoundImportClause: ($) =>
      def({
        syntax: seq(
          "import",
          field("packageName", $.Name),
          ".",
          "{",
          commaSep1(field("importName", $.IDENT)),
          "}",
          opt(field("description", $.Description)),
          opt(field("annotationClause", $.AnnotationClause)),
          ";",
        ),
        symbol: (self) => ({
          kind: "Import",
          name: self.packageName,
          attributes: {
            packageName: self.packageName,
          },
        }),
        model: {
          name: "CompoundImportClause",
          visitable: true,
          properties: {
            importKind: '"compound"',
          },
        },
      }),

    UnqualifiedImportClause: ($) =>
      def({
        syntax: seq(
          "import",
          field("packageName", $.Name),
          ".",
          "*",
          opt(field("description", $.Description)),
          opt(field("annotationClause", $.AnnotationClause)),
          ";",
        ),
        symbol: (self) => ({
          kind: "Import",
          name: self.packageName,
          attributes: {
            packageName: self.packageName,
          },
        }),
        model: {
          name: "UnqualifiedImportClause",
          visitable: true,
          properties: {
            importKind: '"unqualified"',
          },
        },
      }),

    // =====================================================================
    // §A.2.3 — Extends
    // =====================================================================

    ExtendsClause: ($) =>
      def({
        syntax: seq(
          "extends",
          field("typeSpecifier", $.TypeSpecifier),
          opt(field("classOrInheritanceModification", $.ClassOrInheritanceModification)),
          opt(field("annotationClause", $.AnnotationClause)),
          ";",
        ),
        symbol: (self) => ({
          kind: "Extends",
          name: self.typeSpecifier,
          ref: { resolve: "qualified", targetKinds: ["Class"] },
          attributes: {
            typeSpecifier: self.typeSpecifier,
          },
        }),
        queries: {
          modificationText: (db: QueryDB, self: SymbolEntry) => {
            const cst = db.cstNode(self.id) as any;
            return cst?.childForFieldName("classOrInheritanceModification")?.text ?? null;
          },
          /**
           * Resolve the base class referenced by this extends clause.
           * Returns the SymbolEntry of the resolved class, or null.
           */
          resolvedBaseClass: (db: QueryDB, self: SymbolEntry) => {
            const baseName = self.name;
            if (!baseName) return null;
            // Use resolveName from the enclosing class for proper scope resolution
            if (self.parentId !== null) {
              const resolveName = db.query<(n: string, skip?: boolean) => SymbolEntry | null>(
                "resolveName",
                self.parentId,
              );
              if (resolveName) {
                // Pass true for skipInherited to prevent cyclic lookup in extends clauses
                const resolved = resolveName(baseName, true);
                if (resolved && resolved.kind !== "Reference") return resolved;
              }
            }
            // Fallback to global lookup, filtering out Reference entries
            const entries = db.byName(baseName);
            return entries?.find((e) => e.kind === "Class" || e.kind === "Package") ?? entries?.[0] ?? null;
          },
          /**
           * Get the merged modification for this extends clause.
           * Combines the class-or-inheritance-modification with the
           * outer modification from the enclosing class.
           */
          effectiveModification: (db: QueryDB, self: SymbolEntry) => {
            // The modification from the extends clause itself
            return (self.metadata as Record<string, unknown>)?.classOrInheritanceModification ?? null;
          },
        },
        model: {
          name: "ExtendsClause",
          visitable: true,
          specializable: true,
          properties: {
            visibility: "string | null",
          },
          queryTypes: {
            resolvedBaseClass: "SemanticNode | null",
            effectiveModification: "unknown",
          },
        },
        lints: {
          /**
           * Detect extends cycles (A extends B extends A).
           */
          extendsCycle: (db: QueryDB, self: SymbolEntry) => {
            const visited = new Set<string>();
            let current: SymbolEntry | undefined = self;
            while (current) {
              if (visited.has(current.name)) {
                return error(`Extends cycle detected: ${[...visited, current.name].join(" → ")}`);
              }
              visited.add(current.name);
              const baseEntries = db.byName(current.name);
              const baseClass = baseEntries?.[0];
              if (!baseClass) break;
              // Find extends clause in base class
              const extendsChildren = db.childrenOf(baseClass.id).filter((c) => c.kind === "Extends");
              current = extendsChildren[0];
            }
            return null;
          },
        },
        graphics: (self) => ({
          role: "edge" as const,
          edge: {
            shape: "edge",
            attrs: {
              line: {
                stroke: "#7b1fa2",
                strokeWidth: 1.5,
                strokeDasharray: "6 3",
                targetMarker: { name: "block", size: 10 },
              },
            },
            labels: [
              {
                attrs: {
                  text: { text: "??extends??", fill: "#7b1fa2", fontSize: 11 },
                  rect: { fill: "#fff", stroke: "none", rx: 3, ry: 3 },
                },
                position: { distance: 0.5, offset: 0 },
              },
            ],
            router: "manhattan",
            connector: "rounded",
          },
        }),
      }),

    ConstrainingClause: ($) =>
      seq(
        "constrainedby",
        field("typeSpecifier", $.TypeSpecifier),
        opt(field("classModification", $.ClassModification)),
        opt(field("description", $.Description)),
      ),

    ClassOrInheritanceModification: ($) =>
      seq(
        "(",
        commaSep(
          field(
            "modificationArgumentOrInheritanceModification",
            choice($._ModificationArgument, $.InheritanceModification),
          ),
        ),
        ")",
      ),

    InheritanceModification: ($) =>
      seq("break", choice(field("connectEquation", $.ConnectEquation), field("identifier", $.IDENT))),

    // =====================================================================
    // §A.2.4 — Component Clause
    // =====================================================================

    ComponentClause: ($) =>
      seq(
        opt(field("redeclare", "redeclare")),
        opt(field("final", "final")),
        opt(field("inner", "inner")),
        opt(field("outer", "outer")),
        opt(field("replaceable", "replaceable")),
        opt(field("flow", choice("flow", "stream"))),
        opt(field("variability", choice("discrete", "parameter", "constant"))),
        opt(field("causality", choice("input", "output"))),
        field("typeSpecifier", $.TypeSpecifier),
        opt(field("arraySubscripts", $.ArraySubscripts)),
        commaSep1(field("componentDeclaration", $.ComponentDeclaration)),
        opt(field("constrainingClause", $.ConstrainingClause)),
        ";",
      ),

    ComponentDeclaration: ($) =>
      def({
        syntax: seq(
          field("declaration", $.Declaration),
          opt(field("conditionAttribute", $.ConditionAttribute)),
          opt(field("description", $.Description)),
          opt(field("annotationClause", $.AnnotationClause)),
        ),
        symbol: (self) => ({
          kind: "Component",
          name: self.declaration.identifier,
          attributes: {
            modification: self.declaration.modification,
          },
        }),
        queries: {
          /**
           * Resolve the type specifier to the class it references.
           */
          resolvedType: (db: QueryDB, self: SymbolEntry) => {
            const specArgs = db.argsOf<import("./modification-args.js").ModelicaModArgs>(self.id);
            let typeName = "";

            if (specArgs?.data?.isRedeclaration && specArgs.data.redeclaredTypeSpecifier) {
              typeName = specArgs.data.redeclaredTypeSpecifier;
            } else {
              const cstNode = db.cstNode(self.id);
              let current = cstNode as any;
              while (current && current.type !== "ComponentClause") {
                current = current.parent;
              }
              typeName = current?.childForFieldName("typeSpecifier")?.text ?? "";
            }

            if (!typeName || typeof typeName !== "string") return null;

            // Try qualified resolution from parent scope
            if (typeName.includes(".") && self.parentId !== null) {
              const parentEntry = db.symbol(self.parentId);
              if (parentEntry && (parentEntry.kind === "Class" || parentEntry.kind === "Package")) {
                const qualResolver = db.query<(n: string) => SymbolEntry | null>("resolveName", parentEntry.id);
                if (qualResolver) {
                  const resolved = qualResolver(typeName);
                  if (resolved) return resolved;
                }
              }
            }

            // Fallback: global lookup — try full qualified name first, then simple name
            if (typeName.includes(".")) {
              const entries = db.byName(typeName);
              const found = entries?.find((e) => e.kind === "Class" || e.kind === "Package" || e.kind === "Function");
              if (found) return found;
            }
            const simpleName = typeName.includes(".") ? typeName.split(".").pop()! : typeName;
            const entries = db.byName(simpleName);
            return (
              entries?.find((e) => (e.metadata as Record<string, unknown>)?.isPredefined && e.kind === "Class") ??
              entries?.find((e) => e.kind === "Class" || e.kind === "Package" || e.kind === "Function") ??
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
            const cst = db.cstNode(self.id) as any;
            let current = cst;
            while (current && current.type !== "ComponentDeclaration") {
              current = current.parent;
            }
            const declNode = current?.childForFieldName("declaration");
            const modNode = declNode?.childForFieldName("modification");
            if (!modNode) return null;
            return parseModArgsFromCst(modNode, self.parentId) as ModelicaModArgs;
          },
          /**
           * Check if this component's type is a connector.
           */
          isConnectorType: (db: QueryDB, self: SymbolEntry) => {
            const cstNode = db.cstNode(self.id);
            let current = cstNode as any;
            while (current && current.type !== "ComponentClause") {
              current = current.parent;
            }
            let typeName = current?.childForFieldName("typeSpecifier")?.text;
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
              const entries = db.byName(typeName);
              typeEntry =
                entries?.find((e) => e.kind === "Class" || e.kind === "Package" || e.kind === "Function") ?? null;
            }
            if (!typeEntry) {
              const simpleName = typeName.includes(".") ? typeName.split(".").pop()! : typeName;
              const entries = db.byName(simpleName);
              typeEntry =
                entries?.find((e) => (e.metadata as Record<string, unknown>)?.isPredefined && e.kind === "Class") ??
                entries?.find((e) => e.kind === "Class" || e.kind === "Package" || e.kind === "Function") ??
                null;
            }

            if (!typeEntry) return false;
            const classPrefixes = (typeEntry.metadata as Record<string, unknown>)?.classPrefixes;
            return typeof classPrefixes === "string" && classPrefixes.includes("connector");
          },

          variability: (db: QueryDB, self: SymbolEntry) => {
            let current = db.cstNode(self.id) as any;
            while (current && current.type !== "ComponentClause") current = current.parent;
            return current?.childForFieldName("variability")?.text ?? null;
          },

          causality: (db: QueryDB, self: SymbolEntry) => {
            let current = db.cstNode(self.id) as any;
            while (current && current.type !== "ComponentClause") current = current.parent;
            return current?.childForFieldName("causality")?.text ?? null;
          },

          flowPrefix: (db: QueryDB, self: SymbolEntry) => {
            let current = db.cstNode(self.id) as any;
            while (current && current.type !== "ComponentClause") current = current.parent;
            return current?.childForFieldName("flow")?.text ?? null;
          },

          isFinal: (db: QueryDB, self: SymbolEntry) => {
            let current = db.cstNode(self.id) as any;
            while (current && current.type !== "ComponentClause") current = current.parent;
            return !!current?.childForFieldName("final");
          },

          isRedeclare: (db: QueryDB, self: SymbolEntry) => {
            let current = db.cstNode(self.id) as any;
            while (current && current.type !== "ComponentClause") current = current.parent;
            return !!current?.childForFieldName("redeclare");
          },

          isInner: (db: QueryDB, self: SymbolEntry) => {
            let current = db.cstNode(self.id) as any;
            while (current && current.type !== "ComponentClause") current = current.parent;
            return !!current?.childForFieldName("inner");
          },

          isReplaceable: (db: QueryDB, self: SymbolEntry) => {
            let current = db.cstNode(self.id) as any;
            while (current && current.type !== "ComponentClause") current = current.parent;
            return !!current?.childForFieldName("replaceable");
          },

          isProtected: (db: QueryDB, self: SymbolEntry) => {
            let current = db.cstNode(self.id) as any;
            while (current && current.type !== "ElementSection") current = current.parent;
            return current ? current.childForFieldName("protected") !== null : false;
          },

          isOuter: (db: QueryDB, self: SymbolEntry) => {
            let current = db.cstNode(self.id) as any;
            while (current && current.type !== "ComponentClause") current = current.parent;
            return !!current?.childForFieldName("outer");
          },

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
            const specArgs = db.argsOf<import("./modification-args.js").ModelicaModArgs>(self.id);
            let typeName = "";

            if (specArgs?.data?.isRedeclaration && specArgs.data.redeclaredTypeSpecifier) {
              typeName = specArgs.data.redeclaredTypeSpecifier;
            } else {
              const cstNode = db.cstNode(self.id);
              let current = cstNode as any;
              while (current && current.type !== "ComponentClause") {
                current = current.parent;
              }
              typeName = current?.childForFieldName("typeSpecifier")?.text ?? "";
            }

            if (!typeName) return null;

            let typeEntry: SymbolEntry | null = null;
            if (self.parentId !== null) {
              const parentEntry = db.symbol(self.parentId);
              if (parentEntry && (parentEntry.kind === "Class" || parentEntry.kind === "Package")) {
                // Use resolveName for qualified (dotted) names, resolveSimpleName for simple names
                if (typeName.includes(".")) {
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
            // Fallback: global lookup — try full qualified name first, then simple name
            if (!typeEntry && typeName.includes(".")) {
              typeEntry = resolveQualified(db, typeName);
            }
            if (!typeEntry) {
              const simpleName = typeName.includes(".") ? typeName.split(".").pop()! : typeName;
              const entries = db.byName(simpleName);
              // Prefer predefined types (Real, Integer, etc.) and types over models
              // to avoid resolving e.g. "Temperature" to a random sensor class.
              typeEntry =
                entries?.find((e) => (e.metadata as Record<string, unknown>)?.isPredefined && e.kind === "Class") ??
                entries?.find((e) => (e.metadata as Record<string, unknown>)?.classPrefixes === "type") ??
                entries?.find((e) => e.kind === "Class" || e.kind === "Package" || e.kind === "Function") ??
                null;
            }
            if (!typeEntry) return null;

            // Outer modification (from enclosing class's instantiate)
            const outerMod = specArgs?.data ?? null;

            // Inline modification from the component's CST declaration
            // e.g., `SineVoltage Vb(V=10, f=50)` → inline mod is (V=10, f=50)
            // This is needed because the instantiate query of the parent class
            // only propagates modifications from the parent's own outer mod,
            // not from inline declarations in the source code.
            const inlineMod = db.query<ModelicaModArgs | null>("effectiveModification", self.id);

            // Merge: outer mod (from instantiation site) takes precedence over
            // inline mod (from declaration site)
            const effectiveMod = mergeModArgs(outerMod, inlineMod);

            // If there's a modification, specialize the type class
            if (effectiveMod && (effectiveMod.args.length > 0 || effectiveMod.bindingExpression)) {
              return db.specialize(typeEntry.id, modelicaMod(effectiveMod));
            }

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
            const cst = db.cstNode(self.id) as import("@modelscript/polyglot/symbol-indexer").CSTNode | null;
            if (!cst) return null;

            // Navigate up to ComponentClause
            let current = cst as any;
            while (
              current &&
              current.type !== "ComponentDeclaration" &&
              current.type !== "ComponentClause" &&
              current.type !== "Declaration"
            ) {
              current = current.parent;
            }
            let arraySubNode = current?.childForFieldName("arraySubscripts");
            if (!arraySubNode) {
              while (current && current.type !== "ComponentClause") {
                current = current.parent;
              }
              arraySubNode = current?.childForFieldName("arraySubscripts");
            }
            if (!arraySubNode) return null;

            const subscripts: Array<
              | { kind: "literal"; value: number }
              | { kind: "flexible" }
              | { kind: "expression"; cstBytes: readonly [number, number]; text?: string }
            > = [];

            // Walk Subscript children
            for (const child of arraySubNode.children) {
              if (child.type !== "Subscript") continue;

              // Check for flexible dimension ':'
              const flexChild = child.childForFieldName("flexible");
              if (flexChild) {
                subscripts.push({ kind: "flexible" });
                continue;
              }

              // Check for expression
              const exprChild = child.childForFieldName("expression");
              if (exprChild) {
                // Check if the expression is a single integer literal node
                if (exprChild.type === "UNSIGNED_INTEGER") {
                  subscripts.push({ kind: "literal", value: parseInt(exprChild.text, 10) });
                } else {
                  // Store byte range for lazy evaluation
                  subscripts.push({
                    kind: "expression",
                    cstBytes: [exprChild.startByte, exprChild.endByte],
                    text: exprChild.text,
                  });
                }
                continue;
              }
            }

            return subscripts.length > 0 ? subscripts : null;
          },
        },
        model: {
          name: "ComponentDeclaration",
          specializable: true,
          visitable: true,
          properties: {},
          queryTypes: {
            resolvedType: "SemanticNode | null",
            effectiveModification: "unknown",
            isConnectorType: "boolean",
            classInstance: "SymbolId | null",
            arrayDimensions:
              "({ kind: 'literal'; value: number } | { kind: 'flexible' } | { kind: 'expression'; cstBytes: readonly [number, number] })[] | null",
            variability: "string | null",
            causality: "string | null",
            isFinal: "boolean",
            isInner: "boolean",
            isOuter: "boolean",
            isReplaceable: "boolean",
            isProtected: "boolean",
            flowPrefix: "string | null",
            isRedeclare: "boolean",
          },
        },
        lints: {
          /** Warn if component name starts with an uppercase letter. */
          componentNamingConvention: (_db: QueryDB, self: SymbolEntry) => {
            if (self.name && /^[A-Z]/.test(self.name)) {
              return warning(`Component '${self.name}' should start with a lowercase letter`, {
                field: "componentDeclaration",
              });
            }
            return null;
          },
          /** Validates that applied modifiers match an actual attribute or element in the component's type. */
          modifierNotFound: (db: QueryDB, self: SymbolEntry) => {
            const typeClassId = db.query<SymbolId | null>("classInstance", self.id);
            if (!typeClassId) return null;
            const typeEntry = db.symbol(typeClassId);
            if (!typeEntry) return null;

            const mod = db.query<any | null>("effectiveModification", self.id);
            if (!mod || !mod.args || mod.args.length === 0) return null;

            const declaredNames = new Set<string>();
            const isBuiltin = typeEntry.metadata?.isPredefined;
            if (isBuiltin || typeEntry.metadata?.classPrefixes === "enumeration") {
              for (const k of Object.keys(typeEntry.metadata || {})) {
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
              if (typeEntry.metadata?.classPrefixes === "enumeration") {
                declaredNames.add("min");
                declaredNames.add("max");
                declaredNames.add("start");
                declaredNames.add("fixed");
              }
              if (typeEntry.name === "StateSelect") declaredNames.add("default");
            } else {
              const elements = db.query<SymbolId[]>("instantiate", typeClassId) || [];
              for (const eid of elements) {
                const child = db.symbol(eid);
                if (child && child.name && child.kind !== "Reference") declaredNames.add(child.name);
              }
            }

            const results = [];
            for (const arg of mod.args) {
              if (arg.name && arg.name !== "annotation" && !declaredNames.has(arg.name)) {
                results.push(
                  error(`Modifier '${arg.name}' not found in type '${typeEntry.name}'`, {
                    field: "componentDeclaration",
                  }),
                );
              }
            }
            return results.length > 0 ? results : null;
          },
          /** Error if duplicate element names exist in classModification. */
          duplicateModification: (db: QueryDB, self: SymbolEntry) => {
            const cst = db.cstNode(self.id) as any;
            if (!cst) return null;
            let current = cst;
            while (current && current.type !== "ComponentDeclaration") current = current.parent;

            const decl = current?.childForFieldName("declaration");
            if (!decl) return null;
            const mod = decl.childForFieldName("modification");
            if (!mod) return null;
            const classMod = mod.childForFieldName("classModification");
            if (!classMod) return null;

            const paths: string[] = [];
            const results = [];

            const walkMods = (node: any, prefix: string) => {
              if (node.type === "ElementModification") {
                const nameNode = node.childForFieldName("name");
                if (nameNode) {
                  const path = prefix ? prefix + "." + nameNode.text : nameNode.text;
                  const modExpr = node.childForFieldName("modification")?.childForFieldName("modificationExpression");
                  if (modExpr) {
                    if (paths.includes(path)) {
                      results.push(
                        error(`Duplicate modification of element '${path}'`, { field: "componentDeclaration" }),
                      );
                    } else {
                      paths.push(path);
                    }
                  }

                  // Check nested classModification
                  const innerClassMod = node.childForFieldName("modification")?.childForFieldName("classModification");
                  if (innerClassMod) {
                    for (const child of innerClassMod.children) walkMods(child, path);
                  }
                }
              }
            };

            for (const child of classMod.children) walkMods(child, "");
            return results.length > 0 ? results : null;
          },
          /** Error if the component specifies a SysML implements target that cannot be resolved in the SysML index. */
          implementsTargetUnresolved: (db: QueryDB, self: SymbolEntry) => {
            const cst = db.cstNode(self.id) as any;
            let current = cst;
            while (current && current.type !== "ComponentDeclaration") current = current.parent;
            const ann = current?.childForFieldName("annotationClause");
            if (!ann) return null;
            const match = ann.text.match(/SysML\s*\(\s*implements\s*=\s*"([^"]+)"\s*\)/);
            const targetName = match ? match[1] : undefined;
            if (!targetName) return null;

            // In the unified workspace, SysML parts/requirements are registered
            // under byName. We can just check the simple name.
            // Ideally, we restrict it to sysml2 language or SysML specific definitions.
            const entries = db.byName(targetName);
            const foundSysML = entries.find(
              (e) =>
                e.language === "sysml2" && (e.kind === "Part" || e.kind === "Requirement" || e.kind === "Definition"),
            );

            if (!foundSysML) {
              return error(`SysML implements target '${targetName}' could not be resolved in the workspace`, {
                field: "componentDeclaration",
              });
            }
            return null;
          },
          /**
           * Error when the type specifier references an undefined class.
           * e.g. `F x;` where F doesn't exist in scope.
           */
          unresolvedTypeSpecifier: (db: QueryDB, self: SymbolEntry) => {
            const meta = self.metadata as Record<string, unknown>;
            const typeName = meta?.typeSpecifier as string | undefined;
            if (!typeName) return null;

            // Skip built-in types
            const builtins = new Set(["Real", "Integer", "Boolean", "String"]);
            if (builtins.has(typeName)) return null;

            // Try to resolve via enclosing scope
            let found = false;
            if (self.parentId !== null) {
              const parent = db.symbol(self.parentId);
              if (parent && (parent.kind === "Class" || parent.kind === "Package")) {
                const resolve = db.query<(name: string) => SymbolEntry | null>("resolveSimpleName", parent.id);
                if (resolve) {
                  const resolved = resolve(typeName);
                  if (resolved) found = true;
                }
              }
            }

            // Fallback: global lookup
            if (!found) {
              const globals = db.byName(typeName);
              if (globals.length > 0) found = true;
            }

            if (!found) {
              const scopeName = self.parentId !== null ? (db.symbol(self.parentId)?.name ?? "<unknown>") : "<global>";
              return error(`Class '${typeName}' not found in scope ${scopeName}`, { field: "typeSpecifier" });
            }

            return null;
          },
          /**
           * Error when a component's type creates a recursive definition.
           * e.g. `class A  A a; end A;` — A contains itself.
           */
          recursiveDefinition: (db: QueryDB, self: SymbolEntry) => {
            const meta = self.metadata as Record<string, unknown>;
            const typeName = meta?.typeSpecifier as string | undefined;
            if (!typeName) return null;

            // Skip built-in types
            const builtins = new Set(["Real", "Integer", "Boolean", "String"]);
            if (builtins.has(typeName)) return null;

            // Walk up the parent chain to check if any enclosing class
            // has the same name as the type specifier
            let current = self.parentId;
            while (current !== null) {
              const parent = db.symbol(current);
              if (!parent) break;
              if (parent.kind === "Class" && parent.name === typeName) {
                return error(`Declaration of element '${self.name}' causes recursive definition of class ${typeName}`, {
                  field: "typeSpecifier",
                });
              }
              current = parent.parentId;
            }

            return null;
          },
          /**
           * Error when a scalar binding expression is assigned to a composite type.
           * e.g. `X x = 1;` where X is a record with members.
           */
          typeMismatch: (db: QueryDB, self: SymbolEntry) => {
            const meta = self.metadata as Record<string, unknown>;
            const typeName = meta?.typeSpecifier as string | undefined;
            if (!typeName) return null;

            // Skip built-in scalar types
            const builtins = new Set(["Real", "Integer", "Boolean", "String"]);
            if (builtins.has(typeName)) return null;

            // Use the structured effectiveModification query (Salsa-memoized)
            const mod = db.query<ModelicaModArgs | null>("effectiveModification", self.id);
            if (!mod) return null;

            // Only flag when there's a scalar binding (= expr) without class modification args
            // Class modifications like (x=1) are valid for composite types
            if (!mod.bindingExpression || mod.args.length > 0) return null;

            // Resolve the type
            const typeEntries = db.byName(typeName);
            const typeEntry = typeEntries?.find((e) => e.kind === "Class");
            if (!typeEntry) return null;

            // Check if the type has members (is composite)
            const children = db.childrenOf(typeEntry.id);
            const members = children.filter((c) => c.kind === "Component");
            if (members.length === 0) return null;

            // The type is composite but has a scalar binding — this is a type error
            return error(
              `Type mismatch: '${typeName}' is a composite type with ${members.length} member(s), cannot assign a scalar value`,
              { field: "componentDeclaration" },
            );
          },
          /**
           * Error when a binding expression has an incompatible type.
           * e.g. `Integer y = x;` where x is Real (Real is not subtype of Integer).
           * e.g. `Integer y = 1.5;` (Real literal assigned to Integer).
           */
          bindingTypeMismatch: (db: QueryDB, self: SymbolEntry) => {
            type CSTNode = import("@modelscript/polyglot/symbol-indexer").CSTNode;

            const meta = self.metadata as Record<string, unknown>;
            const declaredType = meta?.typeSpecifier as string | undefined;
            if (!declaredType) return null;

            // Only check scalar built-in types for now
            const builtinScalars = new Set(["Real", "Integer", "Boolean", "String"]);
            if (!builtinScalars.has(declaredType)) return null;

            // Skip array types (handled by arrayElementTypeMismatch)
            const dims = db.query<Array<{ kind: string }> | null>("arrayDimensions", self.id);
            if (dims && dims.length > 0) return null;

            // Get the CST binding expression
            const cst = db.cstNode(self.id) as CSTNode | null;
            if (!cst) return null;
            const compDecl = cst.childForFieldName("componentDeclaration");
            if (!compDecl) return null;
            const decl = compDecl.childForFieldName("declaration");
            if (!decl) return null;
            const mod = decl.childForFieldName("modification");
            if (!mod) return null;
            const modExpr = mod.childForFieldName("modificationExpression");
            if (!modExpr) return null;
            const expr = modExpr.childForFieldName("expression");
            if (!expr) return null;

            // Map CST literal types to Modelica types
            const literalTypes: Record<string, string> = {
              UNSIGNED_INTEGER: "Integer",
              UNSIGNED_REAL: "Real",
              BOOLEAN: "Boolean",
              STRING: "String",
            };

            // Type compatibility: Integer is subtype of Real, but not vice versa
            const isSubtypeOf = (actual: string, expected: string): boolean => {
              if (actual === expected) return true;
              if (expected === "Real" && actual === "Integer") return true;
              return false;
            };

            // Infer the type of the expression
            let exprType: string | null = null;

            // Case 1: literal value
            const litType = literalTypes[expr.type];
            if (litType) {
              exprType = litType;
            }

            // Case 2: variable reference — resolve to get its declared type
            if (!exprType && expr.type === "ComponentReference") {
              const refName = expr.text.trim();
              // Resolve the referenced variable
              let refEntry: SymbolEntry | null = null;
              if (self.parentId !== null) {
                const parent = db.symbol(self.parentId);
                if (parent && (parent.kind === "Class" || parent.kind === "Package")) {
                  const resolve = db.query<(name: string) => SymbolEntry | null>("resolveSimpleName", parent.id);
                  if (resolve) refEntry = resolve(refName);
                }
              }
              if (!refEntry) {
                const globals = db.byName(refName);
                if (globals.length > 0) refEntry = globals[0];
              }
              if (refEntry) {
                const refMeta = refEntry.metadata as Record<string, unknown>;
                const refType = refMeta?.typeSpecifier as string | undefined;
                if (refType && builtinScalars.has(refType)) {
                  exprType = refType;
                }

                // Check dimension mismatch — e.g. Real y = x where x is Real[2]
                const refDims = db.query<Array<{ kind: string; value?: number }> | null>(
                  "arrayDimensions",
                  refEntry.id,
                );
                const selfDims = db.query<Array<{ kind: string; value?: number }> | null>("arrayDimensions", self.id);
                const refDimStr =
                  refDims && refDims.length > 0
                    ? `[${refDims.map((d) => (d.kind === "literal" ? d.value : ":")).join(",")}]`
                    : "[]";
                const selfDimStr =
                  selfDims && selfDims.length > 0
                    ? `[${selfDims.map((d) => (d.kind === "literal" ? d.value : ":")).join(",")}]`
                    : "[]";

                if (refDimStr !== selfDimStr) {
                  return error(
                    `Type mismatch in binding '${self.name} = ${refName}', expected array dimensions ${selfDimStr}, got ${refDimStr}`,
                    { field: "componentDeclaration" },
                  );
                }
              }
            }

            if (exprType && !isSubtypeOf(exprType, declaredType)) {
              return error(`Type mismatch in binding: expected subtype of ${declaredType}, got type ${exprType}`, {
                field: "componentDeclaration",
              });
            }

            return null;
          },
          /**
           * Error when an array initializer has a different number of elements
           * than the declared array dimension.
           * e.g. `Real[2] x = {1,2,3};` — declared size 2 but 3 elements.
           */
          arrayShapeMismatch: (db: QueryDB, self: SymbolEntry) => {
            type CSTNode = import("@modelscript/polyglot/symbol-indexer").CSTNode;

            // Get declared dimensions via query
            const dims = db.query<Array<{ kind: string; value?: number }> | null>("arrayDimensions", self.id);
            if (!dims || dims.length === 0) return null;

            // Only check the first dimension for now, and only if it's a literal
            const firstDim = dims[0];
            if (firstDim.kind !== "literal" || !firstDim.value) return null;
            const declaredSize = firstDim.value;

            // Get the CST node and find the modification expression
            const cst = db.cstNode(self.id) as CSTNode | null;
            if (!cst) return null;

            // Navigate: ComponentClause → componentDeclaration → declaration → modification
            const compDecl = cst.childForFieldName("componentDeclaration");
            if (!compDecl) return null;
            const decl = compDecl.childForFieldName("declaration");
            if (!decl) return null;
            const mod = decl.childForFieldName("modification");
            if (!mod) return null;

            // Find the modificationExpression (the '= expr' part)
            const modExpr = mod.childForFieldName("modificationExpression");
            if (!modExpr) return null;

            // Find the expression child
            const expr = modExpr.childForFieldName("expression");
            if (!expr) return null;

            // Check if the expression is an ArrayConstructor { ... }
            if (expr.type !== "ArrayConstructor") return null;

            // Count elements in the expression list
            const exprList = expr.childForFieldName("expressionList");
            if (!exprList) return null;

            let elementCount = 0;
            for (const child of exprList.children) {
              // Count named expression children (skip commas and other tokens)
              if (child.type !== ",") elementCount++;
            }

            if (elementCount !== declaredSize) {
              return error(
                `Array shape mismatch: declared size [${declaredSize}] but initializer has ${elementCount} element(s)`,
                { field: "componentDeclaration" },
              );
            }

            return null;
          },
          /**
           * Error when array initializer elements don't match the declared
           * base type.
           * e.g. `Integer[2] x = {1, 2.5};` — 2.5 is Real, not Integer.
           * e.g. `B[2] b = {1, 2};` — scalars where composite expected.
           * e.g. `B[2] b = {B(1,1), C(2)};` — C is not B.
           */
          arrayElementTypeMismatch: (db: QueryDB, self: SymbolEntry) => {
            type CSTNode = import("@modelscript/polyglot/symbol-indexer").CSTNode;

            const meta = self.metadata as Record<string, unknown>;
            const typeName = meta?.typeSpecifier as string | undefined;
            if (!typeName) return null;

            // Must have array dimensions
            const dims = db.query<Array<{ kind: string; value?: number }> | null>("arrayDimensions", self.id);
            if (!dims || dims.length === 0) return null;

            // Get the CST to find the initializer expression
            const cst = db.cstNode(self.id) as CSTNode | null;
            if (!cst) return null;

            const compDecl = cst.childForFieldName("componentDeclaration");
            if (!compDecl) return null;
            const decl = compDecl.childForFieldName("declaration");
            if (!decl) return null;
            const mod = decl.childForFieldName("modification");
            if (!mod) return null;
            const modExpr = mod.childForFieldName("modificationExpression");
            if (!modExpr) return null;
            const expr = modExpr.childForFieldName("expression");
            if (!expr) return null;

            // Must be an ArrayConstructor { ... }
            if (expr.type !== "ArrayConstructor") return null;
            const exprList = expr.childForFieldName("expressionList");
            if (!exprList) return null;

            // Map CST literal node types to Modelica types
            const nodeTypeToModelica: Record<string, string> = {
              UNSIGNED_INTEGER: "Integer",
              UNSIGNED_REAL: "Real",
              BOOLEAN: "Boolean",
              STRING: "String",
            };

            // Infer the Modelica type of an expression CST node
            const inferElementType = (node: CSTNode): string | null => {
              // Literal nodes
              const literal = nodeTypeToModelica[node.type];
              if (literal) return literal;
              // FunctionCall (constructor): B(1,1) → type "B"
              if (node.type === "FunctionCall") {
                const funcRef = node.childForFieldName("functionReference");
                if (funcRef) return funcRef.text.trim();
              }
              // ComponentReference (variable)
              if (node.type === "ComponentReference") {
                return node.text.trim();
              }
              return null;
            };

            // Determine if the base type is a built-in scalar
            const builtinScalars = new Set(["Real", "Integer", "Boolean", "String"]);
            const isScalarBaseType = builtinScalars.has(typeName);

            // Type compatibility: Integer is a subtype of Real
            const isCompatible = (elementType: string, declaredType: string): boolean => {
              if (elementType === declaredType) return true;
              if (declaredType === "Real" && elementType === "Integer") return true;
              return false;
            };

            // Format dimension suffix like "[2]"
            const dimSuffix =
              dims.length > 0 ? `[${dims.map((d) => (d.kind === "literal" ? d.value : ":")).join(",")}]` : "";

            // Check each element
            let argIndex = 0;
            for (const child of exprList.children) {
              if (child.type === ",") continue;
              argIndex++;

              const elemType = inferElementType(child);
              if (!elemType) continue;

              if (!isCompatible(elemType, typeName)) {
                return error(
                  `Array type mismatch. Argument ${argIndex} (${child.text.trim()}) has type ${elemType} whereas ${typeName}${dimSuffix} expects type ${typeName}`,
                  { field: "componentDeclaration" },
                );
              }
            }

            return null;
          },
          /**
           * Error when a binding expression references an undefined variable.
           * e.g. `constant Real x = y;` where y doesn't exist in scope.
           */
          unresolvedReference: (db: QueryDB, self: SymbolEntry) => {
            type CSTNode = import("@modelscript/polyglot/symbol-indexer").CSTNode;

            // Get the CST node
            const cst = db.cstNode(self.id) as CSTNode | null;
            if (!cst) return null;

            // Navigate to the modification expression
            const compDecl = cst.childForFieldName("componentDeclaration");
            if (!compDecl) return null;
            const decl = compDecl.childForFieldName("declaration");
            if (!decl) return null;
            const mod = decl.childForFieldName("modification");
            if (!mod) return null;
            const modExpr = mod.childForFieldName("modificationExpression");
            if (!modExpr) return null;
            const expr = modExpr.childForFieldName("expression");
            if (!expr) return null;

            // Get the enclosing scope's resolveSimpleName function
            let resolve: ((name: string) => SymbolEntry | null) | null = null;
            if (self.parentId !== null) {
              const parent = db.symbol(self.parentId);
              if (parent && (parent.kind === "Class" || parent.kind === "Package")) {
                resolve = db.query<(name: string) => SymbolEntry | null>("resolveSimpleName", parent.id);
              }
            }

            // Collect all ComponentReference nodes in the expression
            const unresolvedRefs: string[] = [];
            const builtinScalars = new Set(["Real", "Integer", "Boolean", "String", "true", "false", "time"]);

            const walkForRefs = (node: CSTNode) => {
              if (node.type === "ComponentReference") {
                const refName = node.text.trim();
                // Skip built-in names and keywords
                if (builtinScalars.has(refName)) return;
                // Skip if it's the component's own name
                if (refName === self.name) return;

                // Try to resolve
                let found = false;
                if (resolve) {
                  const resolved = resolve(refName);
                  if (resolved) found = true;
                }
                if (!found) {
                  // Fallback: global lookup
                  const globals = db.byName(refName);
                  if (globals.length > 0) found = true;
                }
                if (!found) {
                  unresolvedRefs.push(refName);
                }
                return; // Don't recurse into ComponentReference children
              }
              // Recurse into children
              for (const child of node.children) {
                walkForRefs(child);
              }
            };

            walkForRefs(expr);

            if (unresolvedRefs.length > 0) {
              // Determine the enclosing scope name
              const scopeName = self.parentId !== null ? (db.symbol(self.parentId)?.name ?? "<unknown>") : "<global>";

              return error(`Variable '${unresolvedRefs[0]}' not found in scope ${scopeName}`, {
                field: "componentDeclaration",
              });
            }

            return null;
          },
          /**
           * Error when a function call has wrong number of arguments.
           * e.g. `Real x = X(2,3);` where X takes 1 input.
           */
          functionCallMismatch: (db: QueryDB, self: SymbolEntry) => {
            type CSTNode = import("@modelscript/polyglot/symbol-indexer").CSTNode;

            // Get the CST binding expression
            const cst = db.cstNode(self.id) as CSTNode | null;
            if (!cst) return null;
            const compDecl = cst.childForFieldName("componentDeclaration");
            if (!compDecl) return null;
            const decl = compDecl.childForFieldName("declaration");
            if (!decl) return null;
            const mod = decl.childForFieldName("modification");
            if (!mod) return null;
            const modExpr = mod.childForFieldName("modificationExpression");
            if (!modExpr) return null;
            const expr = modExpr.childForFieldName("expression");
            if (!expr) return null;

            // Find all FunctionCall nodes (could be nested)
            const functionCalls: CSTNode[] = [];
            const collectFunctionCalls = (node: CSTNode) => {
              if (node.type === "FunctionCall") {
                functionCalls.push(node);
              }
              for (const child of node.children) {
                collectFunctionCalls(child);
              }
            };
            collectFunctionCalls(expr);

            if (functionCalls.length === 0) return null;

            // Map literal node types for signature display
            const nodeTypeToModelica: Record<string, string> = {
              UNSIGNED_INTEGER: "Integer",
              UNSIGNED_REAL: "Real",
              BOOLEAN: "Boolean",
              STRING: "String",
            };

            // Resolve function name in scope
            let resolve: ((name: string) => SymbolEntry | null) | null = null;
            if (self.parentId !== null) {
              const parent = db.symbol(self.parentId);
              if (parent && (parent.kind === "Class" || parent.kind === "Package")) {
                resolve = db.query<(name: string) => SymbolEntry | null>("resolveSimpleName", parent.id);
              }
            }

            const scopeName = self.parentId !== null ? (db.symbol(self.parentId)?.name ?? "") : "";

            for (const call of functionCalls) {
              const funcRef = call.childForFieldName("functionReference");
              if (!funcRef) continue;
              const funcName = funcRef.text.trim();

              // Resolve the function
              let funcEntry: SymbolEntry | null = null;
              if (resolve) funcEntry = resolve(funcName);
              if (!funcEntry) {
                const globals = db.byName(funcName);
                funcEntry = globals.find((e) => e.kind === "Class") ?? null;
              }
              if (!funcEntry) continue;

              // Check if it's a function (classPrefixes contains "function")
              const funcMeta = funcEntry.metadata as Record<string, unknown>;
              const prefixes = funcMeta?.classPrefixes as string | undefined;
              if (!prefixes || !prefixes.includes("function")) continue;

              // Get input parameters
              const inputs = db.query<SymbolEntry[]>("inputParameters", funcEntry.id);
              if (!inputs) continue;

              // Count actual arguments
              const callArgs = call.childForFieldName("functionCallArguments");
              if (!callArgs) continue;

              let actualArgCount = 0;
              const actualArgTypes: string[] = [];
              const actualArgEntries: (SymbolEntry | null)[] = [];
              for (const child of callArgs.children) {
                if (child.type === "FunctionArgument") {
                  actualArgCount++;
                  // Try to infer argument type from the expression child
                  const argExpr = child.childForFieldName("expression");
                  if (argExpr) {
                    // Literal types
                    const litType = nodeTypeToModelica[argExpr.type];
                    if (litType) {
                      actualArgTypes.push(litType);
                      actualArgEntries.push(null);
                    } else if (argExpr.type === "ComponentReference") {
                      // Variable reference — resolve to get declared type
                      const refName = argExpr.text.trim();
                      let refEntry: SymbolEntry | null = null;
                      if (resolve) refEntry = resolve(refName);
                      if (!refEntry) {
                        const globals = db.byName(refName);
                        if (globals.length > 0) refEntry = globals[0];
                      }
                      if (refEntry) {
                        const refMeta = refEntry.metadata as Record<string, unknown>;
                        const refType = refMeta?.typeSpecifier as string | undefined;
                        actualArgTypes.push(refType ?? "?");
                        actualArgEntries.push(refEntry);
                      } else {
                        actualArgTypes.push("?");
                        actualArgEntries.push(null);
                      }
                    } else {
                      actualArgTypes.push("?");
                      actualArgEntries.push(null);
                    }
                  } else {
                    actualArgTypes.push("?");
                    actualArgEntries.push(null);
                  }
                } else if (child.type === "NamedArgument") {
                  actualArgCount++;
                  actualArgTypes.push("?");
                  actualArgEntries.push(null);
                }
              }

              // Type compatibility check
              const isSubtypeOf = (actual: string, expected: string): boolean => {
                if (actual === expected) return true;
                if (expected === "Real" && actual === "Integer") return true;
                return false;
              };

              // Helper to build qualified name and candidate signature
              const qualName = scopeName ? `${scopeName}.${funcName}` : funcName;
              const buildCandidateSig = () => {
                const candidateSig = inputs
                  .map((inp) => {
                    const inpMeta = inp.metadata as Record<string, unknown>;
                    const inpType = (inpMeta?.typeSpecifier as string) ?? "?";
                    return `${inpType} ${inp.name}`;
                  })
                  .join(", ");
                const outputs = db.query<SymbolEntry[]>("outputParameters", funcEntry!.id);
                const outputType =
                  outputs && outputs.length > 0
                    ? (((outputs[0].metadata as Record<string, unknown>)?.typeSpecifier as string) ?? "?")
                    : "void";
                return { candidateSig, outputType };
              };

              if (actualArgCount !== inputs.length) {
                // Arity mismatch
                const actualSig = actualArgTypes
                  .map(
                    (t, i) =>
                      `/*${t}*/ ${callArgs.children.filter((c) => c.type === "FunctionArgument" || c.type === "NamedArgument")[i]?.text.trim() ?? "?"}`,
                  )
                  .join(", ");
                const { candidateSig, outputType } = buildCandidateSig();

                return error(
                  `No matching function found for ${qualName}(${actualSig}).\nCandidates are:\n  ${qualName}(${candidateSig}) => ${outputType}`,
                  { field: "componentDeclaration" },
                );
              }

              // Arity matches — check each argument type
              for (let i = 0; i < actualArgTypes.length; i++) {
                const actualType = actualArgTypes[i];
                if (actualType === "?") continue; // Can't infer, skip

                const expectedMeta = inputs[i].metadata as Record<string, unknown>;
                const expectedType = expectedMeta?.typeSpecifier as string | undefined;
                if (!expectedType) continue;

                if (!isSubtypeOf(actualType, expectedType)) {
                  const argNodes = callArgs.children.filter(
                    (c) => c.type === "FunctionArgument" || c.type === "NamedArgument",
                  );
                  const argText = argNodes[i]?.text.trim() ?? "?";

                  return error(
                    `Type mismatch for positional argument ${i + 1} in ${qualName}(${inputs[i].name}=${argText}). The argument has type:\n  ${actualType}\nexpected type:\n  ${expectedType}`,
                    { field: "componentDeclaration" },
                  );
                }

                // Check for array/scalar dimension mismatch (vectorization)
                if (actualArgEntries[i]) {
                  const argEntry = actualArgEntries[i]!;
                  const argDims = db.query<Array<{ kind: string; value?: number }> | null>(
                    "arrayDimensions",
                    argEntry.id,
                  );
                  // Check if parameter expects scalar but argument is array
                  const paramDims = db.query<Array<{ kind: string; value?: number }> | null>(
                    "arrayDimensions",
                    inputs[i].id,
                  );
                  if (argDims && argDims.length > 0 && (!paramDims || paramDims.length === 0)) {
                    // This call would vectorize — check if declared type has matching dimensions
                    const selfDims = db.query<Array<{ kind: string; value?: number }> | null>(
                      "arrayDimensions",
                      self.id,
                    );
                    const argDimStr = `[${argDims.map((d) => (d.kind === "literal" ? d.value : ":")).join(",")}]`;
                    const selfDimStr =
                      selfDims && selfDims.length > 0
                        ? `[${selfDims.map((d) => (d.kind === "literal" ? d.value : ":")).join(",")}]`
                        : "[]";

                    if (selfDimStr !== argDimStr) {
                      const argNodes = callArgs.children.filter(
                        (c) => c.type === "FunctionArgument" || c.type === "NamedArgument",
                      );
                      const argText = argNodes[i]?.text.trim() ?? "?";
                      const vectorized = `{${qualName}(${argText}[$i1]) for $i1 in 1:${argDims[0]?.value ?? "n"}}`;
                      return error(
                        `Type mismatch in binding '${self.name} = ${vectorized}', expected array dimensions ${selfDimStr}, got ${argDimStr}`,
                        { field: "componentDeclaration" },
                      );
                    }
                  }
                }
              }
            }

            return null;
          },
          evolutionCheck: (db, self, previous) => {
            if (previous) {
              const prevMeta = previous.metadata as Record<string, unknown>;
              const currMeta = self.metadata as Record<string, unknown>;
              if (prevMeta.visibility === "public" && currMeta.visibility === "protected") {
                return error("Breaking API Change: Cannot narrow visibility of an existing component.", {
                  field: "componentDeclaration",
                });
              }
            }
            return null;
          },
        },
        diff: {
          ignore: ["annotationClause", "description"],
          minor: ["visibility"],
          breaking: ["typeSpecifier", "causality", "isParameter"],
        },
        adapters: {
          sysml2: {
            target: "PartUsage",
            transform: (_db, self) => ({
              name: (self as SymbolEntry).name,
              typeName: ((self as SymbolEntry).metadata as Record<string, unknown>)?.typeSpecifier,
              direction: ((self as SymbolEntry).metadata as Record<string, unknown>)?.causality ?? null,
              isParameter: ((self as SymbolEntry).metadata as Record<string, unknown>)?.variability === "parameter",
            }),
          },
        },
        graphics: (self) => ({
          role: "port-owner" as const,
          node: {
            shape: "rect",
            markup: [
              { tagName: "rect", selector: "body" },
              { tagName: "text", selector: "label" },
            ],
            attrs: {
              body: { fill: "#e8f5e9", stroke: "#43a047", strokeWidth: 1.5, rx: 2, ry: 2 },
              label: { text: "{{name}}", fill: "#1b5e20", fontSize: 11, textAnchor: "middle", refX: 0.5, refY: 0.5 },
            },
            size: { width: 120, height: 30 },
          },
        }),
      }),

    ConditionAttribute: ($) => seq("if", field("condition", $._Expression)),

    Declaration: ($) =>
      seq(
        field("identifier", $.IDENT),
        opt(field("arraySubscripts", $.ArraySubscripts)),
        opt(field("modification", $.Modification)),
      ),

    // =====================================================================
    // §A.2.5 — Modification
    // =====================================================================

    Modification: ($) =>
      choice(
        seq(
          field("classModification", $.ClassModification),
          opt(seq("=", field("modificationExpression", $.ModificationExpression))),
        ),
        seq("=", field("modificationExpression", $.ModificationExpression)),
      ),

    ModificationExpression: ($) => choice(field("expression", $._Expression), field("break", "break")),

    ClassModification: ($) => seq("(", commaSep(field("modificationArgument", $._ModificationArgument)), ")"),

    _ModificationArgument: ($) => choice($.ElementModification, $.ElementRedeclaration),

    ElementModification: ($) =>
      seq(
        opt(field("each", "each")),
        opt(field("final", "final")),
        field("name", $.Name),
        opt(field("modification", $.Modification)),
        opt(field("description", $.Description)),
      ),

    ElementRedeclaration: ($) =>
      seq(
        opt(field("redeclare", "redeclare")),
        opt(field("each", "each")),
        opt(field("final", "final")),
        opt(field("replaceable", "replaceable")),
        choice(field("classDefinition", $.ShortClassDefinition), field("componentClause", $.ComponentClause1)),
      ),

    ComponentClause1: ($) =>
      seq(
        opt(field("flow", choice("flow", "stream"))),
        opt(field("variability", choice("discrete", "parameter", "constant"))),
        opt(field("causality", choice("input", "output"))),
        field("typeSpecifier", $.TypeSpecifier),
        field("componentDeclaration", $.ComponentDeclaration1),
        opt(field("constrainingClause", $.ConstrainingClause)),
      ),

    ComponentDeclaration1: ($) =>
      seq(
        field("declaration", $.Declaration),
        opt(field("description", $.Description)),
        opt(field("annotationClause", $.AnnotationClause)),
      ),

    ShortClassDefinition: ($) =>
      def({
        syntax: seq(
          field("classPrefixes", $.ClassPrefixes),
          field("classSpecifier", $.ShortClassSpecifier),
          opt(field("constrainingClause", $.ConstrainingClause)),
        ),
        symbol: (self) => ({
          kind: "Class",
          name: self.classSpecifier.identifier,
          attributes: {
            classPrefixes: self.classPrefixes,
          },
        }),
        model: {
          name: "ShortClassDefinition",
          visitable: true,
          specializable: true,
        },
      }),

    // =====================================================================
    // §A.2.6 — Equations
    // =====================================================================

    EquationSection: ($) =>
      seq(
        opt(field("initial", "initial")),
        "equation",
        rep(field("equation", $._Equation)),
        opt(seq(field("annotationClause", $.AnnotationClause), ";")),
      ),

    AlgorithmSection: ($) =>
      seq(
        opt(field("initial", "initial")),
        "algorithm",
        rep(field("statement", $._Statement)),
        opt(seq(field("annotationClause", $.AnnotationClause), ";")),
      ),

    ConstraintSection: ($) =>
      seq(
        opt(field("initial", "initial")),
        "constraint",
        rep(field("equation", $._Equation)),
        opt(seq(field("annotationClause", $.AnnotationClause), ";")),
      ),

    _Equation: ($) =>
      choice($.SimpleEquation, $.SpecialEquation, $.IfEquation, $.ForEquation, $.ConnectEquation, $.WhenEquation),

    _Statement: ($) =>
      choice(
        $.SimpleAssignmentStatement,
        $.ProcedureCallStatement,
        $.ComplexAssignmentStatement,
        $.BreakStatement,
        $.ReturnStatement,
        $.IfStatement,
        $.ForStatement,
        $.WhileStatement,
        $.WhenStatement,
      ),

    SimpleAssignmentStatement: ($) =>
      seq(
        field("target", $.ComponentReference),
        choice(":=", "="),
        field("source", $._Expression),
        opt(field("description", $.Description)),
        opt(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    ProcedureCallStatement: ($) =>
      seq(
        field("functionReference", $.ComponentReference),
        field("functionCallArguments", $.FunctionCallArguments),
        opt(field("description", $.Description)),
        opt(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    ComplexAssignmentStatement: ($) =>
      seq(
        field("outputExpressionList", $.OutputExpressionList),
        choice(":=", "="),
        field("functionReference", $.ComponentReference),
        field("functionCallArguments", $.FunctionCallArguments),
        opt(field("description", $.Description)),
        opt(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    SimpleEquation: ($) =>
      seq(
        field("expression1", $._SimpleExpression),
        field("operator", choice("=", "<=", ">=", "<", ">")),
        field("expression2", $._Expression),
        opt(field("description", $.Description)),
        opt(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    SpecialEquation: ($) =>
      seq(
        field("functionReference", $.ComponentReference),
        field("functionCallArguments", $.FunctionCallArguments),
        opt(field("description", $.Description)),
        opt(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    BreakStatement: ($) =>
      seq("break", opt(field("description", $.Description)), opt(field("annotationClause", $.AnnotationClause)), ";"),

    ReturnStatement: ($) =>
      seq("return", opt(field("description", $.Description)), opt(field("annotationClause", $.AnnotationClause)), ";"),

    IfEquation: ($) =>
      seq(
        "if",
        field("condition", $._Expression),
        "then",
        rep(field("equation", $._Equation)),
        rep(field("elseIfEquationClause", $.ElseIfEquationClause)),
        opt(seq("else", rep(field("elseEquation", $._Equation)))),
        "end",
        "if",
        opt(field("description", $.Description)),
        opt(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    ElseIfEquationClause: ($) =>
      seq("elseif", field("condition", $._Expression), "then", rep(field("equation", $._Equation))),

    IfStatement: ($) =>
      seq(
        "if",
        field("condition", $._Expression),
        "then",
        rep(field("statement", $._Statement)),
        rep(field("elseIfStatementClause", $.ElseIfStatementClause)),
        opt(seq("else", rep(field("elseStatement", $._Statement)))),
        "end",
        "if",
        opt(field("description", $.Description)),
        opt(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    ElseIfStatementClause: ($) =>
      seq("elseif", field("condition", $._Expression), "then", rep(field("statement", $._Statement))),

    ForEquation: ($) =>
      seq(
        "for",
        commaSep1(field("forIndex", $.ForIndex)),
        "loop",
        rep(field("equation", $._Equation)),
        "end",
        "for",
        opt(field("description", $.Description)),
        opt(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    ForStatement: ($) =>
      seq(
        "for",
        commaSep1(field("forIndex", $.ForIndex)),
        "loop",
        rep(field("statement", $._Statement)),
        "end",
        "for",
        opt(field("description", $.Description)),
        opt(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    ForIndex: ($) => seq(field("identifier", $.IDENT), opt(seq("in", field("expression", $._Expression)))),

    WhileStatement: ($) =>
      seq(
        "while",
        field("condition", $._Expression),
        "loop",
        rep(field("statement", $._Statement)),
        "end",
        "while",
        opt(field("description", $.Description)),
        opt(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    WhenEquation: ($) =>
      seq(
        "when",
        field("condition", $._Expression),
        "then",
        rep(field("equation", $._Equation)),
        rep(field("elseWhenEquationClause", $.ElseWhenEquationClause)),
        "end",
        "when",
        opt(field("description", $.Description)),
        opt(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    ElseWhenEquationClause: ($) =>
      seq("elsewhen", field("condition", $._Expression), "then", rep(field("equation", $._Equation))),

    WhenStatement: ($) =>
      seq(
        "when",
        field("condition", $._Expression),
        "then",
        rep(field("statement", $._Statement)),
        rep(field("elseWhenStatementClause", $.ElseWhenStatementClause)),
        "end",
        "when",
        opt(field("description", $.Description)),
        opt(field("annotationClause", $.AnnotationClause)),
        ";",
      ),

    ElseWhenStatementClause: ($) =>
      seq("elsewhen", field("condition", $._Expression), "then", rep(field("statement", $._Statement))),

    ConnectEquation: ($) =>
      def({
        syntax: seq(
          "connect",
          "(",
          field("componentReference1", $.ComponentReference),
          ",",
          field("componentReference2", $.ComponentReference),
          ")",
          opt(field("description", $.Description)),
          opt(field("annotationClause", $.AnnotationClause)),
          ";",
        ),
        symbol: (self) => ({
          kind: "ConnectEquation",
          name: self.componentReference1,
          attributes: {
            ref1: self.componentReference1,
            ref2: self.componentReference2,
          },
        }),
        queries: {
          /**
           * Validate that both sides of the connect equation reference
           * connector-typed components, and that they are plug-compatible.
           */
          validateConnect: (db: QueryDB, self: SymbolEntry) => {
            const meta = self.metadata as Record<string, unknown>;
            const ref1Name = typeof meta?.ref1 === "string" ? meta.ref1 : null;
            const ref2Name = typeof meta?.ref2 === "string" ? meta.ref2 : null;
            if (!ref1Name || !ref2Name) return { valid: false, reason: "unresolved" };

            // Resolve both component references
            const ref1Entries = db.byName(ref1Name);
            const ref2Entries = db.byName(ref2Name);
            if (!ref1Entries?.length || !ref2Entries?.length) {
              return { valid: false, reason: "not found" };
            }
            return { valid: true, reason: null };
          },
        },
        model: {
          name: "ConnectEquation",
          visitable: true,
          queryTypes: {
            validateConnect: "{ valid: boolean; reason: string | null }",
          },
        },
        lints: {
          /**
           * Error when a connect argument is not a connector type.
           * e.g. `connect(x, y)` where x/y are plain Real variables.
           */
          nonConnectorType: (db: QueryDB, self: SymbolEntry) => {
            type CSTNode = import("@modelscript/polyglot/symbol-indexer").CSTNode;

            const meta = self.metadata as Record<string, unknown>;
            const ref1Name = typeof meta?.ref1 === "string" ? meta.ref1 : null;
            const ref2Name = typeof meta?.ref2 === "string" ? meta.ref2 : null;

            const builtinScalars = new Set(["Real", "Integer", "Boolean", "String"]);

            // Primary: resolve via symbol index
            let resolve: ((name: string) => SymbolEntry | null) | null = null;
            if (self.parentId !== null) {
              const parent = db.symbol(self.parentId);
              if (parent && (parent.kind === "Class" || parent.kind === "Package")) {
                resolve = db.query<(name: string) => SymbolEntry | null>("resolveSimpleName", parent.id);
              }
            }

            // CST fallback: get the parent class's CST node to find component types
            const getTypeFromCST = (refName: string): string | null => {
              if (self.parentId === null) return null;
              const parentCst = db.cstNode(self.parentId) as CSTNode | null;
              if (!parentCst) return null;
              const search = (node: CSTNode): string | null => {
                if (node.type === "ComponentClause") {
                  const ts = node.childForFieldName("typeSpecifier");
                  const tn = ts?.text.trim() ?? null;
                  for (const c of node.children) {
                    if (c.type === "ComponentDeclaration") {
                      const d = c.childForFieldName("declaration");
                      const id = d?.childForFieldName("identifier");
                      if (id && id.text.trim() === refName) return tn;
                    }
                  }
                }
                for (const c of node.children) {
                  const r = search(c);
                  if (r !== null) return r;
                }
                return null;
              };
              return search(parentCst);
            };

            const checkRef = (refName: string, fieldName: string) => {
              // Try symbol-based resolution first
              let refEntry: SymbolEntry | null = null;
              if (resolve) refEntry = resolve(refName);
              if (!refEntry) {
                const entries = db.byName(refName);
                if (entries?.length) refEntry = entries[0];
              }
              if (refEntry && refEntry.kind === "Component") {
                const refMeta = refEntry.metadata as Record<string, unknown>;
                const typeName = refMeta?.typeSpecifier as string | undefined;
                if (typeName && builtinScalars.has(typeName)) {
                  return error(`'${refName}' is not a valid connector`, { field: fieldName });
                }
                const isConnector = db.query<boolean>("isConnectorType", refEntry.id);
                if (isConnector === false) {
                  return error(`'${refName}' is not a valid connector`, { field: fieldName });
                }
                return null;
              }

              // Fallback: CST-based type lookup
              const cstType = getTypeFromCST(refName);
              if (cstType && builtinScalars.has(cstType)) {
                return error(`'${refName}' is not a valid connector`, { field: fieldName });
              }

              return null;
            };

            const diagnostics = [];
            if (ref1Name) {
              const err = checkRef(ref1Name, "componentReference1");
              if (err) diagnostics.push(err);
            }
            if (ref2Name) {
              const err = checkRef(ref2Name, "componentReference2");
              if (err) diagnostics.push(err);
            }

            return diagnostics.length > 0 ? diagnostics : null;
          },
        },
        graphics: (self) => ({
          role: "edge" as const,
          edge: {
            shape: "edge",
            source: self.componentReference1,
            target: self.componentReference2,
            attrs: {
              line: { stroke: "#c62828", strokeWidth: 2, targetMarker: "classic" },
            },
            labels: [
              {
                attrs: {
                  text: { text: "connect", fill: "#c62828", fontSize: 10 },
                  rect: { fill: "#fff", stroke: "none", rx: 3, ry: 3 },
                },
                position: { distance: 0.5, offset: 0 },
              },
            ],
            router: "manhattan",
            connector: "rounded",
          },
        }),
      }),

    _Expression: ($) => choice($.IfElseExpression, $.RangeExpression, $._SimpleExpression),

    IfElseExpression: ($) =>
      seq(
        "if",
        field("condition", $._Expression),
        "then",
        field("expression", $._Expression),
        rep(field("elseIfExpressionClause", $.ElseIfExpressionClause)),
        "else",
        field("elseExpression", $._Expression),
      ),

    ElseIfExpressionClause: ($) =>
      seq("elseif", field("condition", $._Expression), "then", field("expression", $._Expression)),

    RangeExpression: ($) =>
      choice(
        seq(
          field("startExpression", $._SimpleExpression),
          ":",
          field("stepExpression", $._SimpleExpression),
          ":",
          field("stopExpression", $._SimpleExpression),
        ),
        seq(field("startExpression", $._SimpleExpression), ":", field("stopExpression", $._SimpleExpression)),
      ),

    _SimpleExpression: ($) => choice($.UnaryExpression, $.BinaryExpression, $._PrimaryExpression),

    UnaryExpression: ($) =>
      choice(
        prec(PREC.UNARY_NEGATION, unaryExp("not", $._SimpleExpression)),
        prec(PREC.ADDITIVE_UNARY, unaryExp("+", $._SimpleExpression)),
        prec(PREC.ADDITIVE_UNARY, unaryExp("-", $._SimpleExpression)),
        prec(PREC.ADDITIVE_UNARY, unaryExp(".+", $._SimpleExpression)),
        prec(PREC.ADDITIVE_UNARY, unaryExp(".-", $._SimpleExpression)),
      ),

    BinaryExpression: ($) =>
      choice(
        // Logical operators
        prec.left(PREC.LOGICAL_OR, binaryExp("or", $._SimpleExpression, $._SimpleExpression)),
        prec.left(PREC.LOGICAL_AND, binaryExp("and", $._SimpleExpression, $._SimpleExpression)),
        // Relational operators
        prec.right(PREC.RELATIONAL, binaryExp("<", $._SimpleExpression, $._SimpleExpression)),
        prec.right(PREC.RELATIONAL, binaryExp("<=", $._SimpleExpression, $._SimpleExpression)),
        prec.right(PREC.RELATIONAL, binaryExp(">", $._SimpleExpression, $._SimpleExpression)),
        prec.right(PREC.RELATIONAL, binaryExp(">=", $._SimpleExpression, $._SimpleExpression)),
        prec.right(PREC.RELATIONAL, binaryExp("==", $._SimpleExpression, $._SimpleExpression)),
        prec.right(PREC.RELATIONAL, binaryExp("<>", $._SimpleExpression, $._SimpleExpression)),
        // Additive operators
        prec.left(PREC.ADDITIVE, binaryExp("+", $._SimpleExpression, $._SimpleExpression)),
        prec.left(PREC.ADDITIVE, binaryExp("-", $._SimpleExpression, $._SimpleExpression)),
        prec.left(PREC.ADDITIVE, binaryExp(".+", $._SimpleExpression, $._SimpleExpression)),
        prec.left(PREC.ADDITIVE, binaryExp(".-", $._SimpleExpression, $._SimpleExpression)),
        // Multiplicative operators
        prec.left(PREC.MULTIPLICATIVE, binaryExp("*", $._SimpleExpression, $._SimpleExpression)),
        prec.left(PREC.MULTIPLICATIVE, binaryExp("/", $._SimpleExpression, $._SimpleExpression)),
        prec.left(PREC.MULTIPLICATIVE, binaryExp(".*", $._SimpleExpression, $._SimpleExpression)),
        prec.left(PREC.MULTIPLICATIVE, binaryExp("./", $._SimpleExpression, $._SimpleExpression)),
        // Exponentiation
        prec.right(PREC.EXPONENTIATION, binaryExp("^", $._PrimaryExpression, $._PrimaryExpression)),
        prec.right(PREC.EXPONENTIATION, binaryExp(".^", $._PrimaryExpression, $._PrimaryExpression)),
      ),

    _PrimaryExpression: ($) =>
      choice(
        $._Literal,
        $.FunctionCall,
        $.ComponentReference,
        $.MemberAccessExpression,
        $.OutputExpressionList,
        $.ArrayConcatenation,
        $.ArrayConstructor,
        $.EndExpression,
      ),

    EndExpression: () => "end",

    _Literal: ($) => choice($.UNSIGNED_INTEGER, $.UNSIGNED_REAL, $.BOOLEAN, $.STRING),

    TypeSpecifier: ($) =>
      ref({
        syntax: seq(opt(field("global", ".")), field("name", $.Name)),
        name: (self) => self.name,
        targetKinds: ["Class"],
        resolve: "qualified",
      }),

    Name: ($) => commaSep1(field("part", $.IDENT), "."),

    ComponentReference: ($) =>
      ref({
        syntax: seq(opt(field("global", ".")), commaSep1(field("part", $.ComponentReferencePart), ".")),
        name: (self) => self.part,
        targetKinds: ["Component", "Class"],
        resolve: "qualified",
      }),

    ComponentReferencePart: ($) => seq(field("identifier", $.IDENT), opt(field("arraySubscripts", $.ArraySubscripts))),

    FunctionCall: ($) =>
      seq(
        field("functionReference", choice($.ComponentReference, "der", "initial", "pure")),
        field("functionCallArguments", $.FunctionCallArguments),
      ),

    FunctionCallArguments: ($) =>
      seq(
        "(",
        opt(
          choice(
            field("comprehensionClause", $.ComprehensionClause),
            seq(
              commaSep1(field("argument", $.FunctionArgument)),
              opt(seq(",", commaSep1(field("namedArgument", $.NamedArgument)))),
            ),
            commaSep1(field("namedArgument", $.NamedArgument)),
          ),
        ),
        ")",
      ),

    ArrayConcatenation: ($) => seq("[", commaSep1(field("expressionList", $.ExpressionList), ";"), "]"),

    ArrayConstructor: ($) =>
      seq(
        "{",
        opt(choice(field("comprehensionClause", $.ComprehensionClause), field("expressionList", $.ExpressionList))),
        "}",
      ),

    ComprehensionClause: ($) =>
      seq(field("expression", $._Expression), "for", commaSep1(field("forIndex", $.ForIndex))),

    NamedArgument: ($) => seq(field("identifier", $.IDENT), "=", field("argument", $.FunctionArgument)),

    FunctionArgument: ($) =>
      choice(field("expression", $._Expression), field("functionPartialApplication", $.FunctionPartialApplication)),

    FunctionPartialApplication: ($) =>
      seq(
        "function",
        field("typeSpecifier", $.TypeSpecifier),
        "(",
        commaSep(field("namedArgument", $.NamedArgument)),
        ")",
      ),

    MemberAccessExpression: ($) =>
      seq(
        field("outputExpressionList", $.OutputExpressionList),
        choice(field("arraySubscripts", $.ArraySubscripts), seq(".", field("identifier", $.IDENT))),
      ),

    OutputExpressionList: ($) => seq("(", commaSep(opt(field("output", $._Expression)), ","), ")"),

    ExpressionList: ($) => commaSep1(field("expression", $._Expression)),

    ArraySubscripts: ($) => seq("[", commaSep1(field("subscript", $.Subscript)), "]"),

    Subscript: ($) => choice(field("flexible", ":"), field("expression", $._Expression)),

    Description: ($) => commaSep1(field("descriptionString", $.STRING), "+"),

    AnnotationClause: ($) => seq("annotation", field("classModification", $.ClassModification)),

    // =====================================================================
    // §A.1 — Lexical Conventions
    // =====================================================================

    BOOLEAN: () => choice("false", "true"),

    IDENT: () =>
      token(
        choice(
          seq(
            /[_a-zA-Z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u0500-\u052F\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0E00-\u0E7F\u0E80-\u0EFF\u1000-\u109F\u1100-\u11FF\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uFB50-\uFDFF\uFE70-\uFEFF]/,
            rep(
              choice(
                /[0-9]/,
                /[_a-zA-Z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u0500-\u052F\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0E00-\u0E7F\u0E80-\u0EFF\u1000-\u109F\u1100-\u11FF\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uFB50-\uFDFF\uFE70-\uFEFF]/,
              ),
            ),
          ),
          // Q-IDENT: 'quoted identifier'
          seq(
            "'",
            rep(
              choice(
                /[_a-zA-Z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u0500-\u052F\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0E00-\u0E7F\u0E80-\u0EFF\u1000-\u109F\u1100-\u11FF\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uFB50-\uFDFF\uFE70-\uFEFF]/,
                /[0-9]/,
                "!",
                "#",
                "$",
                "%",
                "&",
                "(",
                ")",
                "*",
                "+",
                ",",
                "-",
                ".",
                "/",
                ":",
                ";",
                "<",
                ">",
                "=",
                "?",
                "@",
                "[",
                "]",
                "^",
                "{",
                "}",
                "|",
                "~",
                " ",
                '"',
                seq("\\", choice("'", '"', "?", "\\", "a", "b", "f", "n", "r", "t", "v")),
              ),
            ),
            "'",
          ),
        ),
      ),
    /* eslint-enable no-control-regex */

    STRING: () =>
      token(
        seq('"', rep(choice(/[^"\\]/, seq("\\", choice("'", '"', "?", "\\", "a", "b", "f", "n", "r", "t", "v")))), '"'),
      ),

    UNSIGNED_INTEGER: () => /[0-9]+/,

    UNSIGNED_REAL: () =>
      token(
        choice(
          seq(/[0-9]+/, ".", opt(/[0-9]+/)),
          seq(/[0-9]+/, opt(seq(".", opt(/[0-9]+/))), choice("e", "E"), opt(choice("+", "-")), /[0-9]+/),
          seq(".", /[0-9]+/, opt(seq(choice("e", "E"), opt(choice("+", "-")), /[0-9]+/))),
        ),
      ),

    BLOCK_COMMENT: () => token(seq("/*", /[^*]*\*+([^/*][^*]*\*+)*/, "/")),

    LINE_COMMENT: () => token(seq("//", /[^\r\n]*/)),

    BOM: () => /\u00EF\u00BB\u00BF/,
  },

  // =====================================================================
  // Top-Level Adapters (Approach C — language-wide registry)
  // =====================================================================

  adapters: {
    sysml2: {
      ClassDefinition: (db, node) => ({
        target: "BlockDefinition",
        props: {
          name: node.name,
          isAbstract: false,
          defKind: "block",
          classKind: (node.metadata as Record<string, unknown>)?.classPrefixes ?? "model",
          parts: db
            .childrenOf(node.id)
            .filter((c) => c.kind === "Component")
            .map((c) => ({
              name: c.name,
              typeName: (c.metadata as Record<string, unknown>)?.typeSpecifier,
              direction: (c.metadata as Record<string, unknown>)?.causality ?? null,
            })),
        },
      }),
    },
  },
});
