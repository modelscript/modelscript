/* eslint-disable */
/**
 * examples/sysml2/language.ts — SysML v2 language definition
 *
 * Port of the SysML2 Xtext grammar into metascript combinators.
 * Inherits KerML expression rules inline (flattened AST).
 *
 * @license LGPL-3.0-or-later
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
  type SymbolEntry,
} from "@modelscript/polyglot";

// ---------------------------------------------------------------------------
// Precedence constants
// ---------------------------------------------------------------------------

const PREC = {
  CONDITIONAL: 1,
  NULL_COALESCING: 2,
  IMPLIES: 3,
  OR: 4,
  XOR: 5,
  AND: 6,
  EQUALITY: 7,
  CLASSIFICATION: 8,
  RELATIONAL: 9,
  RANGE: 10,
  ADDITIVE: 11,
  MULTIPLICATIVE: 12,
  EXPONENTIATION: 13,
  UNARY: 14,
  EXTENT: 15,
  PRIMARY: 16,
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---- shared attribute extractors ----
const meta = (self: SymbolEntry) => self.metadata as Record<string, unknown> | null;
const metaStr = (self: SymbolEntry, key: string): string | null => (meta(self)?.[key] as string) ?? null;

// ---- shared symbol helpers ----

/** Shared symbol lambda for all Definition rules.
 *  Captures modifier fields as attributes from CST nodes. */
const defAttrs = (_defKind: string) => (self: any) => ({
  kind: "Definition" as const,
  name: self.declaredName,
  exports: [self.declaredName],
  attributes: {
    isAbstract: self.isAbstract,
    isVariation: self.isVariation,
  },
});

/** Shared symbol lambda for all Usage rules.
 *  Captures all modifier fields from _usage_modifier as CST attributes. */
const usageAttrs = (_usageKind: string) => (self: any) => ({
  kind: "Usage" as const,
  name: self.declaredName,
  attributes: {
    direction: self.direction,
    isAbstract: self.isAbstract,
    isVariation: self.isVariation,
    isDerived: self.isDerived,
    isEnd: self.isEnd,
    isRef: self.isRef,
    isOrdered: self.isOrdered,
    isNonunique: self.isNonunique,
    isConstant: self.isConstant,
    multiplicityLower: self.ownedMultiplicity.ownedRelatedElement.lowerBound,
    multiplicityUpper: self.ownedMultiplicity.ownedRelatedElement.upperBound,
  },
});

// ---- shared queries ----

/** Shared queries for all Definition and Package rules */
const namespaceQueries = {
  members: (db: QueryDB, self: SymbolEntry) => db.childrenOf(self.id),
  ownedDefinitions: (db: QueryDB, self: SymbolEntry) =>
    db.childrenOf(self.id).filter((c) => c.kind === "Definition" || c.kind === "Enumeration"),
  ownedUsages: (db: QueryDB, self: SymbolEntry) => db.childrenOf(self.id).filter((c) => c.kind === "Usage"),
  imports: (db: QueryDB, self: SymbolEntry) => db.childrenOf(self.id).filter((c) => c.kind === "Import"),
};

/** Structural queries for definitions — filter children by usageKind metadata */
const definitionStructuralQueries = {
  ...namespaceQueries,
  ownedParts: (db: QueryDB, self: SymbolEntry) => db.childrenOf(self.id).filter((c) => c.ruleName === "PartUsage"),
  ownedAttributes: (db: QueryDB, self: SymbolEntry) =>
    db.childrenOf(self.id).filter((c) => c.ruleName === "AttributeUsage"),
  ownedPorts: (db: QueryDB, self: SymbolEntry) => db.childrenOf(self.id).filter((c) => c.ruleName === "PortUsage"),
  ownedActions: (db: QueryDB, self: SymbolEntry) => db.childrenOf(self.id).filter((c) => c.ruleName === "ActionUsage"),
  ownedConstraints: (db: QueryDB, self: SymbolEntry) =>
    db.childrenOf(self.id).filter((c) => c.ruleName === "ConstraintUsage"),
  ownedConnections: (db: QueryDB, self: SymbolEntry) =>
    db.childrenOf(self.id).filter((c) => c.ruleName === "ConnectionUsage"),
  superclassifiers: (db: QueryDB, self: SymbolEntry) => {
    // Find child OwnedSubclassification ref entries and resolve them
    const results: SymbolEntry[] = [];
    for (const child of db.childrenOf(self.id)) {
      if (child.ruleName === "OwnedSubclassification" && child.name) {
        const targets = db.byName(child.name);
        for (const t of targets) if (t.kind === "Definition") results.push(t);
      }
    }
    return results;
  },
  extractTopology: (db: QueryDB, self: SymbolEntry) => {
    // Basic extraction to stub out Phase 3 logic
    const rootIds = [self.id];
    const nodes = new Map<number, import("@modelscript/polyglot").TopologyNode>();
    const edges: import("@modelscript/polyglot").TopologyEdge[] = [];

    const walk = (entryId: number, parentId: number | null, pathPrefix: string) => {
      const entry = db.symbol(entryId);
      if (!entry) return;

      const path = pathPrefix ? `${pathPrefix}.${entry.name}` : entry.name || "";
      const node: import("@modelscript/polyglot").TopologyNode = {
        usageId: entry.id,
        path,
        targetClassId: null,
        typeName: "",
        children: [],
        parentId,
      };
      nodes.set(entry.id, node);

      // Check allocation
      const allocations = db.childrenOf(entry.id).filter((c) => c.ruleName === "AllocationUsage");
      for (const alloc of allocations) {
        const target = db.query<SymbolEntry | null>("resolvedTarget", alloc.id);
        if (target) {
          node.targetClassId = target.id;
        }
      }

      // Check implements in SysML itself (or modelica index)
      const implementsTarget = (entry.metadata as any)?.implementsTarget;
      if (implementsTarget) {
        const res = db.byName(implementsTarget);
        if (res && res.length > 0) node.targetClassId = res[0].id;
      }

      const parts = db.childrenOf(entry.id).filter((c) => c.ruleName === "PartUsage");
      for (const part of parts) {
        const childNode = walk(part.id, entry.id, path);
        if (childNode) node.children.push(childNode);
      }

      const connects = db.childrenOf(entry.id).filter((c) => c.ruleName === "ConnectionUsage");
      for (const conn of connects) {
        // extract endpoints
        const refs = db.childrenOf(conn.id).filter((c) => c.kind === "Reference");
        if (refs.length >= 2 && refs[0].name && refs[1].name) {
          const src = resolveFeatureInScope(db, conn.parentId, refs[0].name);
          const tgt = resolveFeatureInScope(db, conn.parentId, refs[1].name);
          if (src && tgt) {
            edges.push({
              sourceId: src.id,
              targetId: tgt.id,
              connectionId: conn.id,
            });
          }
        }
      }

      return node;
    };

    walk(self.id, null, "");

    return { rootIds, nodes, edges };
  },
};

/** Queries for all Usage rules */
const usageQueries = {
  ownedFeatures: (db: QueryDB, self: SymbolEntry) => db.childrenOf(self.id).filter((c) => c.kind === "Usage"),
  resolvedType: (db: QueryDB, self: SymbolEntry) => {
    // Find child OwnedFeatureTyping ref entries and resolve the type name
    for (const child of db.childrenOf(self.id)) {
      if (child.ruleName === "OwnedFeatureTyping" && child.name) {
        const targets = db.byName(child.name);
        for (const t of targets) {
          if (t.kind === "Definition" || t.kind === "Enumeration") return t;
        }
      }
    }
    return null;
  },
  redefinedFeatures: (db: QueryDB, self: SymbolEntry) =>
    db.childrenOf(self.id).filter((c) => c.ruleName === "OwnedRedefinition"),
  subsettedFeatures: (db: QueryDB, self: SymbolEntry) =>
    db.childrenOf(self.id).filter((c) => c.ruleName === "OwnedSubsetting"),
};

// ---- shared model configs ----

/** Shared model config for all Definition rules */
const definitionModel = {
  name: "DefinitionNode" as const,
  visitable: true,
  specializable: true,
  properties: {
    defKind: "string" as const,
    isAbstract: "boolean" as const,
    isVariation: "boolean" as const,
  },
  queryTypes: {
    members: "SemanticNode[]" as const,
    ownedUsages: "UsageNode[]" as const,
    ownedDefinitions: "DefinitionNode[]" as const,
    imports: "SemanticNode[]" as const,
    ownedParts: "UsageNode[]" as const,
    ownedAttributes: "UsageNode[]" as const,
    ownedPorts: "UsageNode[]" as const,
    ownedActions: "UsageNode[]" as const,
    ownedConstraints: "UsageNode[]" as const,
    ownedConnections: "UsageNode[]" as const,
    superclassifiers: "DefinitionNode[]" as const,
  },
};

/** Shared model config for all Usage rules */
const usageModel = {
  name: "UsageNode" as const,
  visitable: true,
  specializable: true,
  properties: {
    usageKind: "string" as const,
    isRef: "boolean" as const,
    isAbstract: "boolean" as const,
    isVariation: "boolean" as const,
    isDerived: "boolean" as const,
    isEnd: "boolean" as const,
    isOrdered: "boolean" as const,
    isNonunique: "boolean" as const,
    isConstant: "boolean" as const,
    direction: "string | null" as const,
  },
  queryTypes: {
    resolvedType: "DefinitionNode | null" as const,
    ownedFeatures: "UsageNode[]" as const,
    redefinedFeatures: "SemanticNode[]" as const,
    subsettedFeatures: "SemanticNode[]" as const,
  },
};

/** Shared model config for Package rules */
const packageModel = {
  name: "PackageNode" as const,
  visitable: true,
  properties: { isLibrary: "boolean" as const, isStandard: "boolean" as const },
  queryTypes: {
    members: "SemanticNode[]" as const,
    ownedDefinitions: "DefinitionNode[]" as const,
    ownedUsages: "UsageNode[]" as const,
    imports: "SemanticNode[]" as const,
  },
};

// ---------------------------------------------------------------------------
// KerML Expression Evaluator — CST-based tree-walk interpreter
// ---------------------------------------------------------------------------

/** Result of evaluating an expression. undefined = "cannot evaluate". */
type EvalResult = number | boolean | string | null | undefined;

/** CSTNode type alias for expression evaluation */
type CSTNode = import("@modelscript/polyglot/symbol-indexer").CSTNode;

/**
 * Resolve a feature reference name within a scope.
 * Searches: (1) children of the enclosing definition, (2) global byName.
 */
const resolveFeatureInScope = (db: QueryDB, scopeId: number | null, name: string): SymbolEntry | null => {
  // Search enclosing scope's children first
  if (scopeId !== null) {
    let current: number | null = scopeId;
    while (current !== null) {
      const parent = db.symbol(current);
      if (!parent) break;
      for (const child of db.childrenOf(parent.id)) {
        if (child.name === name) return child;
      }
      current = parent.parentId;
    }
  }
  // Fallback: global name lookup
  const globals = db.byName(name);
  return globals?.[0] ?? null;
};

/**
 * Resolve the type entry for a feature usage.
 * Reads the OwnedFeatureTyping child's name and resolves via db.byName().
 */
const resolveTypeOf = (db: QueryDB, entry: SymbolEntry): SymbolEntry | null => {
  // Look for OwnedFeatureTyping children to get the type name
  for (const child of db.childrenOf(entry.id)) {
    if (child.ruleName === "OwnedFeatureTyping" && child.name) {
      const typeEntries = db.byName(child.name);
      if (typeEntries.length > 0) return typeEntries[0];
    }
  }
  return null;
};

/**
 * Get the bound value of a feature (from modification, default value, etc.).
 * Returns undefined if no value is bound.
 */
const getFeatureValue = (db: QueryDB, entry: SymbolEntry): EvalResult => {
  // Try to get the result expression (for calculations)
  // or read the CST default value
  const cst = db.cstNode(entry.id) as CSTNode | null;
  if (!cst) return undefined;

  // Look for a ValuePart → OwnedExpression default value
  for (const child of cst.children) {
    if (child.type === "OwnedExpression" || child.type === "ResultExpressionMember") {
      const exprNode = child.type === "ResultExpressionMember" ? child.childForFieldName("ownedRelatedElement") : child;
      if (exprNode) return evaluateExpressionNode(db, exprNode, entry.parentId);
    }
  }

  // Look for default value in modification syntax (= expr)
  const text = db.cstText(entry.startByte, entry.endByte);
  if (text) {
    const eqMatch = text.match(/=\s*([0-9]+(?:\.[0-9]+)?)\s*;?\s*$/);
    if (eqMatch) {
      const num = parseFloat(eqMatch[1]);
      if (!isNaN(num)) return num;
    }
  }

  return undefined;
};

/**
 * Resolve a dot-path like `vehicle.mass`:
 * 1. Resolve `vehicle` in scope → find its type definition
 * 2. Look up `mass` in that type's children
 * 3. Return the final feature's value
 */
const resolveFeaturePath = (db: QueryDB, names: string[], scopeId: number | null): EvalResult => {
  if (names.length === 0) return undefined;

  // Resolve the base name
  let current = resolveFeatureInScope(db, scopeId, names[0]);
  if (!current) return undefined;

  // If single name, return its value directly
  if (names.length === 1) {
    return getFeatureValue(db, current);
  }

  // Walk the chain: for each step, resolve the type and find the member
  for (let i = 1; i < names.length; i++) {
    // Get the type of the current feature
    const typeDef = resolveTypeOf(db, current);
    if (!typeDef) return undefined;

    // Find the named member in the type's children
    const memberName = names[i];
    let found: SymbolEntry | null = null;
    for (const child of db.childrenOf(typeDef.id)) {
      if (child.name === memberName) {
        found = child;
        break;
      }
    }
    if (!found) return undefined;

    // If this is the last step, return the value
    if (i === names.length - 1) {
      return getFeatureValue(db, found);
    }

    // Otherwise, continue traversal
    current = found;
  }

  return undefined;
};

/**
 * Extract the feature name chain from a FeatureReferenceExpression or
 * PrimaryExpression with featureChain.
 */
const extractNameChain = (node: CSTNode): string[] => {
  const names: string[] = [];

  const extractQualifiedName = (qn: CSTNode): string | null => {
    // QualifiedName → name: Name → ID
    const nameNode = qn.childForFieldName("name");
    if (nameNode) {
      // Get the last segment of a qualified name
      const id = nameNode.children.find((c) => c.type === "ID");
      if (id) return id.text;
      return nameNode.text;
    }
    return qn.text;
  };

  // Walk the node to extract names
  if (node.type === "FeatureReferenceExpression") {
    const rel = node.childForFieldName("ownedRelationship");
    if (rel) {
      const memberElement = rel.childForFieldName("memberElement");
      if (memberElement) {
        const name = extractQualifiedName(memberElement);
        if (name) names.push(name);
      }
    }
  } else if (node.type === "PrimaryExpression") {
    // base: _BaseExpression, featureChain: FeatureChainMember
    const base = node.childForFieldName("base");
    if (base) {
      const baseNames = extractNameChain(base);
      names.push(...baseNames);
    }
    // Collect all featureChain members
    for (const child of node.children) {
      if (child.type === "FeatureChainMember") {
        const memberElement = child.childForFieldName("memberElement");
        if (memberElement) {
          const name = extractQualifiedName(memberElement);
          if (name) names.push(name);
        }
      }
    }
  }

  return names;
};

/**
 * Evaluate a KerML expression CST node.
 *
 * Walks the expression AST and computes values for:
 * - Literals (integer, real, boolean, string, null, infinity)
 * - Arithmetic (+, -, *, /, %, **, ^)
 * - Relational (<, >, <=, >=)
 * - Equality (==, !=)
 * - Logical (and, or, xor, not, implies)
 * - Conditional (if ? else)
 * - Feature references with full dot-path resolution (vehicle.mass)
 *
 * Returns undefined for expressions that cannot be statically evaluated.
 */
const evaluateExpressionNode = (db: QueryDB, node: CSTNode, scopeId: number | null): EvalResult => {
  switch (node.type) {
    // --- Literals ---
    case "LiteralInteger": {
      const val = node.childForFieldName("value");
      return val ? parseInt(val.text, 10) : undefined;
    }
    case "LiteralReal": {
      const val = node.childForFieldName("value");
      return val ? parseFloat(val.text) : undefined;
    }
    case "LiteralBoolean": {
      const val = node.childForFieldName("value");
      return val?.text === "true";
    }
    case "LiteralString": {
      const val = node.childForFieldName("value");
      return val ? val.text.slice(1, -1) : undefined; // strip quotes
    }
    case "NullExpression":
      return null;
    case "LiteralInfinity":
      return Infinity;

    // --- Arithmetic ---
    case "AdditiveExpression":
    case "MultiplicativeExpression":
    case "ExponentiationExpression": {
      const operands: CSTNode[] = [];
      const operators: string[] = [];
      for (const child of node.children) {
        const fn = node.fieldNameForChild?.(node.children.indexOf(child));
        if (fn === "operand") operands.push(child);
        else if (fn === "operator") operators.push(child.text);
      }
      if (operands.length < 2 || operators.length === 0) return undefined;
      let result = evaluateExpressionNode(db, operands[0], scopeId);
      if (typeof result !== "number") return undefined;
      for (let i = 0; i < operators.length; i++) {
        const right = evaluateExpressionNode(db, operands[i + 1], scopeId);
        if (typeof right !== "number") return undefined;
        switch (operators[i]) {
          case "+":
            result = (result as number) + right;
            break;
          case "-":
            result = (result as number) - right;
            break;
          case "*":
            result = (result as number) * right;
            break;
          case "/":
            result = right !== 0 ? (result as number) / right : undefined;
            break;
          case "%":
            result = right !== 0 ? (result as number) % right : undefined;
            break;
          case "**":
          case "^":
            result = Math.pow(result as number, right);
            break;
          default:
            return undefined;
        }
        if (result === undefined) return undefined;
      }
      return result;
    }

    // --- Unary ---
    case "UnaryExpression": {
      const op = node.childForFieldName("operator");
      const operand = node.childForFieldName("operand");
      if (!op || !operand) return undefined;
      const val = evaluateExpressionNode(db, operand, scopeId);
      switch (op.text) {
        case "+":
          return typeof val === "number" ? val : undefined;
        case "-":
          return typeof val === "number" ? -val : undefined;
        case "not":
          return typeof val === "boolean" ? !val : undefined;
        case "~":
          return typeof val === "number" ? ~val : undefined;
        default:
          return undefined;
      }
    }

    // --- Relational ---
    case "RelationalExpression": {
      const operands: CSTNode[] = [];
      const operators: string[] = [];
      for (const child of node.children) {
        const fn = node.fieldNameForChild?.(node.children.indexOf(child));
        if (fn === "operand") operands.push(child);
        else if (fn === "operator") operators.push(child.text ?? child.children?.[0]?.text ?? "");
      }
      if (operands.length < 2 || operators.length === 0) return undefined;
      const left = evaluateExpressionNode(db, operands[0], scopeId);
      const right = evaluateExpressionNode(db, operands[1], scopeId);
      if (typeof left !== "number" || typeof right !== "number") return undefined;
      const opText = operators[0];
      switch (opText) {
        case "<":
          return left < right;
        case ">":
          return left > right;
        case "<=":
          return left <= right;
        case ">=":
          return left >= right;
        default:
          return undefined;
      }
    }

    // --- Equality ---
    case "EqualityExpression": {
      const operands: CSTNode[] = [];
      const operators: string[] = [];
      for (const child of node.children) {
        const fn = node.fieldNameForChild?.(node.children.indexOf(child));
        if (fn === "operand") operands.push(child);
        else if (fn === "operator") operators.push(child.text ?? child.children?.[0]?.text ?? "");
      }
      if (operands.length < 2 || operators.length === 0) return undefined;
      const left = evaluateExpressionNode(db, operands[0], scopeId);
      const right = evaluateExpressionNode(db, operands[1], scopeId);
      if (left === undefined || right === undefined) return undefined;
      const opText = operators[0];
      switch (opText) {
        case "==":
          return left === right;
        case "!=":
          return left !== right;
        case "===":
          return left === right;
        case "!==":
          return left !== right;
        default:
          return undefined;
      }
    }

    // --- Logical ---
    case "AndExpression": {
      const operands: CSTNode[] = [];
      for (const child of node.children) {
        const fn = node.fieldNameForChild?.(node.children.indexOf(child));
        if (fn === "operand") operands.push(child);
      }
      if (operands.length < 2) return undefined;
      let result = evaluateExpressionNode(db, operands[0], scopeId);
      if (typeof result !== "boolean") return undefined;
      for (let i = 1; i < operands.length; i++) {
        const right = evaluateExpressionNode(db, operands[i], scopeId);
        if (typeof right !== "boolean") return undefined;
        result = (result as boolean) && right;
      }
      return result;
    }

    case "OrExpression": {
      const operands: CSTNode[] = [];
      for (const child of node.children) {
        const fn = node.fieldNameForChild?.(node.children.indexOf(child));
        if (fn === "operand") operands.push(child);
      }
      if (operands.length < 2) return undefined;
      let result = evaluateExpressionNode(db, operands[0], scopeId);
      if (typeof result !== "boolean") return undefined;
      for (let i = 1; i < operands.length; i++) {
        const right = evaluateExpressionNode(db, operands[i], scopeId);
        if (typeof right !== "boolean") return undefined;
        result = (result as boolean) || right;
      }
      return result;
    }

    case "XorExpression": {
      const operands: CSTNode[] = [];
      for (const child of node.children) {
        const fn = node.fieldNameForChild?.(node.children.indexOf(child));
        if (fn === "operand") operands.push(child);
      }
      if (operands.length < 2) return undefined;
      let result = evaluateExpressionNode(db, operands[0], scopeId);
      if (typeof result !== "boolean") return undefined;
      for (let i = 1; i < operands.length; i++) {
        const right = evaluateExpressionNode(db, operands[i], scopeId);
        if (typeof right !== "boolean") return undefined;
        result = (result as boolean) !== right;
      }
      return result;
    }

    case "ImpliesExpression": {
      const operands: CSTNode[] = [];
      for (const child of node.children) {
        const fn = node.fieldNameForChild?.(node.children.indexOf(child));
        if (fn === "operand") operands.push(child);
      }
      if (operands.length < 2) return undefined;
      const left = evaluateExpressionNode(db, operands[0], scopeId);
      // For implies references, we need to unwrap the ImpliesExpressionReference
      let rightNode = operands[1];
      if (rightNode.type === "ImpliesExpressionReference") {
        const inner = rightNode.childForFieldName("ownedRelationship");
        if (inner) {
          const elem = inner.childForFieldName("ownedRelatedElement");
          if (elem) rightNode = elem;
        }
      }
      const right = evaluateExpressionNode(db, rightNode, scopeId);
      if (typeof left !== "boolean" || typeof right !== "boolean") return undefined;
      return !left || right; // p implies q ≡ ¬p ∨ q
    }

    // --- Conditional ---
    case "ConditionalExpression": {
      const operand = node.childForFieldName("operand");
      const thenRef = node.childForFieldName("thenOperand");
      const elseRef = node.childForFieldName("elseOperand");
      if (!operand || !thenRef || !elseRef) return undefined;
      const cond = evaluateExpressionNode(db, operand, scopeId);
      if (typeof cond !== "boolean") return undefined;
      // Unwrap OwnedExpressionReference → OwnedExpressionMember → OwnedExpression
      const unwrap = (ref: CSTNode): CSTNode => {
        const rel = ref.childForFieldName("ownedRelationship");
        if (rel) {
          const elem = rel.childForFieldName("ownedRelatedElement");
          if (elem) return elem;
        }
        return ref;
      };
      return cond
        ? evaluateExpressionNode(db, unwrap(thenRef), scopeId)
        : evaluateExpressionNode(db, unwrap(elseRef), scopeId);
    }

    // --- Feature references (with dot-path resolution) ---
    case "FeatureReferenceExpression": {
      const names = extractNameChain(node);
      if (names.length === 0) return undefined;
      return resolveFeaturePath(db, names, scopeId);
    }

    case "PrimaryExpression": {
      const names = extractNameChain(node);
      if (names.length > 0) {
        return resolveFeaturePath(db, names, scopeId);
      }
      // Single base expression with postfix ops — not supported yet
      const base = node.childForFieldName("base");
      if (base) return evaluateExpressionNode(db, base, scopeId);
      return undefined;
    }

    // --- Wrapped expressions ---
    case "OwnedExpression":
    case "SequenceExpression": {
      // Unwrap: delegate to the first child expression
      for (const child of node.children) {
        if (child.type !== "," && child.type !== "(" && child.type !== ")") {
          return evaluateExpressionNode(db, child, scopeId);
        }
      }
      return undefined;
    }

    // --- Parenthesized expressions ---
    default: {
      // Try to find a single expression child
      if (node.children.length === 3 && node.children[0]?.type === "(") {
        return evaluateExpressionNode(db, node.children[1], scopeId);
      }
      // Try to unwrap single-child nodes
      if (node.children.length === 1) {
        return evaluateExpressionNode(db, node.children[0], scopeId);
      }
      return undefined;
    }
  }
};

/**
 * Evaluate the result expression of a CalculationBody.
 * Finds the ResultExpressionMember in the CST and evaluates it.
 */
const evaluateResultExpression = (db: QueryDB, self: SymbolEntry): EvalResult => {
  const cst = db.cstNode(self.id) as CSTNode | null;
  if (!cst) return undefined;

  // Find ResultExpressionMember in the calculation body
  const findResultExpr = (node: CSTNode): CSTNode | null => {
    if (node.type === "ResultExpressionMember") return node;
    for (const child of node.children) {
      const found = findResultExpr(child);
      if (found) return found;
    }
    return null;
  };

  const resultMember = findResultExpr(cst);
  if (!resultMember) return undefined;

  // Navigate to the OwnedExpression inside
  const ownedRelElem = resultMember.childForFieldName("ownedRelatedElement");
  if (!ownedRelElem) return undefined;

  return evaluateExpressionNode(db, ownedRelElem, self.parentId);
};

// ---------------------------------------------------------------------------
// Calculation Definition/Usage — dedicated models and queries
// ---------------------------------------------------------------------------

/** Model config for CalculationDefinition */
const calculationDefinitionModel = {
  name: "CalculationDefinitionNode" as const,
  visitable: true,
  specializable: true,
  properties: {
    ...definitionModel.properties,
  },
  queryTypes: {
    ...definitionModel.queryTypes,
    parameters: "UsageNode[]" as const,
    returnParameter: "UsageNode | null" as const,
    resultExpression: "unknown" as const,
  },
};

/** Model config for CalculationUsage */
const calculationUsageModel = {
  name: "CalculationUsageNode" as const,
  visitable: true,
  specializable: true,
  properties: {
    ...usageModel.properties,
  },
  queryTypes: {
    ...usageModel.queryTypes,
    parameters: "UsageNode[]" as const,
    returnParameter: "UsageNode | null" as const,
    resultExpression: "unknown" as const,
  },
};

/** Queries for CalculationDefinition */
const calculationQueries = {
  ...definitionStructuralQueries,
  parameters: (db: QueryDB, self: SymbolEntry) =>
    db
      .childrenOf(self.id)
      .filter((c) => c.fieldName === "ownedRelatedElement" && db.parentOf(c.id)?.ruleName === "ParameterMember"),
  returnParameter: (db: QueryDB, self: SymbolEntry) => {
    for (const c of db.childrenOf(self.id)) {
      if (c.fieldName === "ownedRelatedElement") {
        const parent = db.parentOf(c.id);
        if (parent?.ruleName === "ReturnParameterMember") return c;
      }
    }
    return null;
  },
  resultExpression: (db: QueryDB, self: SymbolEntry) => evaluateResultExpression(db, self),
};

/** Queries for CalculationUsage */
const calculationUsageQueries = {
  ...usageQueries,
  parameters: calculationQueries.parameters,
  returnParameter: calculationQueries.returnParameter,
  resultExpression: calculationQueries.resultExpression,
};

// ---------------------------------------------------------------------------
// Constraint Evaluation — computed fields
// ---------------------------------------------------------------------------

/**
 * Evaluate a constraint body expression.
 * The constraint body is a _CalculationBody containing a ResultExpressionMember.
 * Returns true/false/null (null = indeterminate).
 */
const evaluateConstraintBody = (db: QueryDB, self: SymbolEntry): boolean | null => {
  const result = evaluateResultExpression(db, self);
  if (typeof result === "boolean") return result;
  if (result === undefined) return null; // indeterminate
  // Coerce numbers: 0 = false, nonzero = true
  if (typeof result === "number") return result !== 0;
  return null;
};

/** Constraint-specific queries */
const constraintEvalQueries = {
  /** Evaluate the constraint body and return true/false/null */
  constraintResult: (db: QueryDB, self: SymbolEntry) => evaluateConstraintBody(db, self),

  /** Dynamic simulation-backed validation via VerificationRunner */
  dynamicConstraintResult: (db: QueryDB, self: SymbolEntry) => {
    // Re-evaluates automatically when SimulationResult inputs (Salsa queries) change
    // db.query<SimulationResult>("activeSimulation", ...)
    return null; // stubbed
  },
};

/** Constraint Definition model with evaluation */
const constraintDefinitionModel = {
  name: "ConstraintDefinitionNode" as const,
  visitable: true,
  specializable: true,
  properties: {
    ...definitionModel.properties,
  },
  queryTypes: {
    ...definitionModel.queryTypes,
    constraintResult: "boolean | null" as const,
  },
};

/** Constraint Usage model with evaluation */
const constraintUsageModel = {
  name: "ConstraintUsageNode" as const,
  visitable: true,
  properties: {
    ...usageModel.properties,
  },
  queryTypes: {
    ...usageModel.queryTypes,
    constraintResult: "boolean | null" as const,
  },
};

/** Constraint Definition queries */
const constraintDefinitionQueries = {
  ...definitionStructuralQueries,
  ...constraintEvalQueries,
};

/** Constraint Usage queries */
const constraintUsageQueries = {
  ...usageQueries,
  ...constraintEvalQueries,
};

/**
 * Computed: are all require constraints met for a requirement?
 * Returns true (all pass), false (any fail), or null (indeterminate).
 */
const evaluateConstraintsMet = (db: QueryDB, self: SymbolEntry): boolean | null => {
  const requireConstraints = db
    .childrenOf(self.id)
    .filter((c) => c.ruleName === "RequirementConstraintUsage" && metaStr(c, "constraintKind") === "require");

  if (requireConstraints.length === 0) return null; // no constraints to check

  let allMet = true;
  let anyIndeterminate = false;

  for (const constraint of requireConstraints) {
    const result = evaluateConstraintBody(db, constraint);
    if (result === false) return false; // short-circuit: constraint violated
    if (result === null) anyIndeterminate = true;
    // result === true → continue
  }

  if (anyIndeterminate) return null;
  return allMet;
};

// ---------------------------------------------------------------------------
// Requirement satisfaction/verification — computed field helpers
// ---------------------------------------------------------------------------

/**
 * Extract the reference target name from a SatisfyRequirementUsage or VerifyRequirementUsage.
 * These nodes use OwnedReferenceSubsetting to reference the target requirement:
 *   satisfy MassRequirement by vehicle;  →  target = "MassRequirement"
 *   verify SafetyRequirement;            →  target = "SafetyRequirement"
 *
 * Falls back to the symbol's own name (for the `requirement <name>` branch).
 */
const getRelationshipTargetName = (db: QueryDB, entry: SymbolEntry): string | null => {
  // If the symbol has a declared name, it's using the `requirement <name>` branch
  if (entry.name) return entry.name;

  // Otherwise, extract from OwnedReferenceSubsetting CST child.
  // The CST text of the OwnedReferenceSubsetting span contains the qualified name.
  for (const child of db.childrenOf(entry.id)) {
    if (child.ruleName === "OwnedReferenceSubsetting" && child.name) {
      return child.name;
    }
  }

  // Final fallback: read the raw CST text between the keyword and the body/semicolon
  // to get the target name from the source text.
  const text = db.cstText(entry.startByte, entry.endByte);
  if (text) {
    // Match patterns:  "verify <name>" or "satisfy <name>"
    const match = text.match(/(?:verify|satisfy)\s+(?:requirement\s+)?([A-Za-z_][A-Za-z0-9_]*)/);
    if (match) return match[1];
  }
  return null;
};

/**
 * Walk all symbols in the file to find satisfy/verify relationships
 * targeting a given requirement name.
 */
const findRelationshipsTargeting = (
  db: QueryDB,
  self: SymbolEntry,
  reqName: string,
  ruleNames: string[],
): SymbolEntry[] => {
  // Walk up to root to get the file-level scope
  let root = self;
  while (root.parentId !== null) {
    const parent = db.parentOf(root.id);
    if (!parent) break;
    root = parent;
  }

  // Recursively collect matching relationship entries
  const results: SymbolEntry[] = [];
  const walk = (parentId: number) => {
    for (const c of db.childrenOf(parentId)) {
      if (ruleNames.includes(c.ruleName)) {
        const targetName = getRelationshipTargetName(db, c);
        if (targetName === reqName) results.push(c);
      }
      // Walk into packages and definitions to find nested relationships
      if (c.kind === "Package" || c.kind === "Definition" || c.kind === "Usage") {
        walk(c.id);
      }
    }
  };
  walk(root.id);
  return results;
};

/** Computed satisfaction/verification queries for requirements */
const requirementSatisfactionQueries = {
  /** Whether this requirement has at least one satisfy relationship targeting it */
  isSatisfied: (db: QueryDB, self: SymbolEntry) => {
    if (!self.name) return false;
    return findRelationshipsTargeting(db, self, self.name, ["SatisfyRequirementUsage"]).length > 0;
  },

  /** The satisfy relationships targeting this requirement */
  satisfiedBy: (db: QueryDB, self: SymbolEntry) => {
    if (!self.name) return [];
    return findRelationshipsTargeting(db, self, self.name, ["SatisfyRequirementUsage"]);
  },

  /** Whether this requirement has at least one verify relationship targeting it */
  isVerified: (db: QueryDB, self: SymbolEntry) => {
    if (!self.name) return false;
    return findRelationshipsTargeting(db, self, self.name, ["VerifyRequirementUsage"]).length > 0;
  },

  /** The verify relationships targeting this requirement */
  verifiedBy: (db: QueryDB, self: SymbolEntry) => {
    if (!self.name) return [];
    return findRelationshipsTargeting(db, self, self.name, ["VerifyRequirementUsage"]);
  },

  /**
   * Computed verification status of this requirement.
   * Returns one of:
   *   "verified" | "satisfied" | "violated" | "partial" | "unverified" | "indeterminate"
   *
   * - "verified":      has both satisfy + verify, and all constraints met
   * - "satisfied":     has satisfy, constraints met (or no constraints)
   * - "violated":      has satisfy/verify, but constraints evaluate to false
   * - "partial":       has verify but no satisfy relationship
   * - "unverified":    has neither satisfy nor verify
   * - "indeterminate": constraints cannot be evaluated (references unresolved)
   */
  verificationStatus: (db: QueryDB, self: SymbolEntry) => {
    if (!self.name) return "unverified";
    if (metaStr(self, "isAbstract") === "true") return "unverified";
    const hasSatisfy = findRelationshipsTargeting(db, self, self.name, ["SatisfyRequirementUsage"]).length > 0;
    const hasVerify = findRelationshipsTargeting(db, self, self.name, ["VerifyRequirementUsage"]).length > 0;

    // Evaluate constraints if satisfy/verify relationships exist
    if (hasSatisfy || hasVerify) {
      const constraintsMet = evaluateConstraintsMet(db, self);
      if (constraintsMet === false) return "violated";
      if (constraintsMet === null) {
        // Constraints exist but can't be evaluated
        const hasConstraints = db
          .childrenOf(self.id)
          .some((c) => c.ruleName === "RequirementConstraintUsage" && metaStr(c, "constraintKind") === "require");
        if (hasConstraints) return "indeterminate";
      }
    }

    if (hasSatisfy && hasVerify) return "verified";
    if (hasSatisfy) return "satisfied";
    if (hasVerify) return "partial";
    return "unverified";
  },

  /** Computed: are all require constraints met? */
  constraintsMet: (db: QueryDB, self: SymbolEntry) => evaluateConstraintsMet(db, self),
};

/** Model config for Requirement Definition/Usage */
const requirementDefinitionModel = {
  name: "RequirementDefinitionNode" as const,
  visitable: true,
  specializable: true,
  properties: {
    ...definitionModel.properties,
  },
  queryTypes: {
    ...definitionModel.queryTypes,
    subject: "UsageNode | null" as const,
    assumeConstraints: "SemanticNode[]" as const,
    requireConstraints: "SemanticNode[]" as const,
    actors: "UsageNode[]" as const,
    stakeholders: "UsageNode[]" as const,
    isSatisfied: "boolean" as const,
    satisfiedBy: "SemanticNode[]" as const,
    isVerified: "boolean" as const,
    verifiedBy: "SemanticNode[]" as const,
    verificationStatus: "string" as const,
    constraintsMet: "boolean | null" as const,
  },
};

/** Queries for Requirement rules */
const requirementQueries = {
  ...definitionStructuralQueries,
  subject: (db: QueryDB, self: SymbolEntry) => {
    for (const c of db.childrenOf(self.id)) {
      if (c.ruleName === "SubjectUsage") return c;
    }
    return null;
  },
  assumeConstraints: (db: QueryDB, self: SymbolEntry) =>
    db
      .childrenOf(self.id)
      .filter((c) => c.ruleName === "RequirementConstraintUsage" && metaStr(c, "constraintKind") === "assume"),
  requireConstraints: (db: QueryDB, self: SymbolEntry) =>
    db
      .childrenOf(self.id)
      .filter((c) => c.ruleName === "RequirementConstraintUsage" && metaStr(c, "constraintKind") === "require"),
  actors: (db: QueryDB, self: SymbolEntry) => db.childrenOf(self.id).filter((c) => c.ruleName === "ActorUsage"),
  stakeholders: (db: QueryDB, self: SymbolEntry) =>
    db.childrenOf(self.id).filter((c) => c.ruleName === "StakeholderUsage"),
  ...requirementSatisfactionQueries,
};

/** Model config for State Definition/Usage */
const stateDefinitionModel = {
  name: "StateDefinitionNode" as const,
  visitable: true,
  specializable: true,
  properties: {
    ...definitionModel.properties,
    isParallel: "boolean" as const,
  },
  queryTypes: {
    ...definitionModel.queryTypes,
    entryAction: "SemanticNode | null" as const,
    doAction: "SemanticNode | null" as const,
    exitAction: "SemanticNode | null" as const,
    transitions: "SemanticNode[]" as const,
  },
};

/** Model config for State Usage */
const stateUsageModel = {
  name: "StateUsageNode" as const,
  visitable: true,
  specializable: true,
  properties: {
    ...usageModel.properties,
    isParallel: "boolean" as const,
  },
  queryTypes: {
    ...usageModel.queryTypes,
  },
};

/** Queries for State rules */
const stateQueries = {
  ...definitionStructuralQueries,
  entryAction: (db: QueryDB, self: SymbolEntry) => {
    for (const c of db.childrenOf(self.id)) {
      if (c.ruleName === "StateActionUsage" && c.fieldName === "ownedRelatedElement") {
        // Check if parent is EntryActionMember
        const parent = db.parentOf(self.id);
        if (parent) return c;
      }
    }
    return null;
  },
  doAction: (_db: QueryDB, _self: SymbolEntry) => null as SymbolEntry | null,
  exitAction: (_db: QueryDB, _self: SymbolEntry) => null as SymbolEntry | null,
  transitions: (db: QueryDB, self: SymbolEntry) =>
    db.childrenOf(self.id).filter((c) => c.ruleName === "TransitionUsage"),
};

/** Model config for Import rules */
const importModel = {
  name: "ImportNode" as const,
  visitable: true,
  properties: {
    importKind: "string" as const,
    isImportAll: "boolean" as const,
    isRecursive: "boolean" as const,
  },
};

/** Shared lint rules for all Definition rules */
const definitionLints = {
  definitionNaming: (_db: QueryDB, self: SymbolEntry) => {
    if (self.name && /^[a-z]/.test(self.name)) {
      return warning(`Definition '${self.name}' should start with an uppercase letter`, { field: "declaredName" });
    }
    return null;
  },
  emptyDefinition: (db: QueryDB, self: SymbolEntry) => {
    if (db.childrenOf(self.id).length === 0) {
      return info(`Definition '${self.name}' has no members`);
    }
    return null;
  },
  /** Error when two direct children share the same name. */
  duplicateFeatureName: (db: QueryDB, self: SymbolEntry) => {
    const seen = new Map<string, SymbolEntry>();
    for (const child of db.childrenOf(self.id)) {
      if (!child.name || child.name === "<anonymous>") continue;
      const prev = seen.get(child.name);
      if (prev) {
        return warning(`Duplicate member '${child.name}' in '${self.name}'`, { field: "declaredName" });
      }
      seen.set(child.name, child);
    }
    return null;
  },
  /** Error when a definition's superclassifier chain creates a cycle. */
  circularSpecialization: (db: QueryDB, self: SymbolEntry) => {
    const visited = new Set<string>();
    visited.add(self.name);
    for (const child of db.childrenOf(self.id)) {
      if (child.ruleName !== "OwnedSubclassification" || !child.name) continue;
      // Walk up the specialization chain
      let current = child.name;
      const chain = new Set<string>([current]);
      while (current) {
        const targets = db.byName(current);
        const target = targets.find((t) => t.kind === "Definition");
        if (!target) break;
        if (visited.has(target.name)) {
          return error(`Circular specialization: '${self.name}' transitively specializes itself`, {
            field: "declaredName",
          });
        }
        // Find the target's superclassifiers
        const superRefs = db.childrenOf(target.id).filter((c) => c.ruleName === "OwnedSubclassification" && c.name);
        if (superRefs.length === 0) break;
        current = superRefs[0].name;
        if (chain.has(current)) break; // prevent infinite loop
        chain.add(current);
      }
    }
    return null;
  },
};

/** Shared lint rules for all Usage rules */
const usageLints = {
  usageNaming: (_db: QueryDB, self: SymbolEntry) => {
    if (self.name && /^[A-Z]/.test(self.name)) {
      return warning(`Usage '${self.name}' should start with a lowercase letter`, { field: "declaredName" });
    }
    return null;
  },
  multiplicityBounds: (_db: QueryDB, self: SymbolEntry) => {
    // metadata fields are extracted as strings from the CST if they existed
    const lowerStr = self.metadata?.multiplicityLower as string | undefined;
    if (!lowerStr) return null; // No multiplicity declared

    let upperStr = self.metadata?.multiplicityUpper as string | undefined;
    if (!upperStr) upperStr = lowerStr; // e.g. [3] means lower=3, upper=3

    const parseBound = (s: string) => (s.trim() === "*" || s.includes("Infinity") ? Infinity : parseFloat(s));
    const lower = parseBound(lowerStr);
    const upper = parseBound(upperStr);

    if (!isNaN(lower) && !isNaN(upper) && lower > upper) {
      return error(
        `Invalid multiplicity bounds: lower bound (${lowerStr}) cannot be greater than upper bound (${upperStr}).`,
        { startByte: self.startByte, endByte: self.endByte },
      );
    }

    return null;
  },
};

/** Lint rules for Constraint Definition/Usage — report violated constraints */
const constraintLints = {
  constraintViolated: (db: QueryDB, self: SymbolEntry) => {
    const result = evaluateConstraintBody(db, self);
    if (result === false) {
      return error(`Constraint '${self.name || "<anonymous>"}' evaluates to false`);
    }
    return null;
  },
};

const constraintDefinitionLints = {
  ...definitionLints,
  ...constraintLints,
};

const constraintUsageLintRules = {
  ...usageLints,
  ...constraintLints,
};

const requirementLints = {
  missingSubject: (db: QueryDB, self: SymbolEntry) => {
    if (metaStr(self, "isAbstract") === "true") return null;

    const subjects = db.childrenOf(self.id).filter((c) => c.ruleName === "SubjectUsage");
    const satisfied = db.childrenOf(self.id).filter((c) => c.ruleName === "SatisfyRequirementUsage");
    if (subjects.length === 0 && satisfied.length === 0 && self.name && self.kind === "Definition") {
      return info(`Requirement '${self.name}' should have a specified subject or satisfy relation`, {
        field: "declaredName",
      });
    }
    return null;
  },
  cyclicSatisfaction: (db: QueryDB, self: SymbolEntry) => {
    const satisfyUsages = db.childrenOf(self.id).filter((c) => c.ruleName === "SatisfyRequirementUsage");
    const visited = new Set<string>();
    if (self.name) visited.add(self.name);

    for (const satisfy of satisfyUsages) {
      if (!satisfy.name) continue;
      let current = satisfy.name;
      const chain = new Set<string>([current]);

      while (current) {
        const targets = db.byName(current);
        const reqTarget = targets.find(
          (t) => t.ruleName === "RequirementDefinition" || t.ruleName === "RequirementUsage",
        );
        if (!reqTarget) break;

        if (visited.has(reqTarget.name)) {
          return error(`Circular satisfaction: '${self.name}' transitively satisfies itself`, {
            field: "declaredName",
          });
        }

        const nextSatisfies = db
          .childrenOf(reqTarget.id)
          .filter((c) => c.ruleName === "SatisfyRequirementUsage" && c.name);
        if (nextSatisfies.length === 0) break;
        current = nextSatisfies[0].name;
        if (chain.has(current)) break;
        chain.add(current);
      }
    }
    return null;
  },
  /** Error when a requirement's require-constraints evaluate to false */
  requirementConstraintViolated: (db: QueryDB, self: SymbolEntry) => {
    const result = evaluateConstraintsMet(db, self);
    if (result === false) {
      return error(`Requirement '${self.name}' has constraint(s) that evaluate to false`, { field: "declaredName" });
    }
    return null;
  },
};

const requirementDefinitionLints = {
  ...definitionLints,
  ...requirementLints,
};

const requirementUsageLints = {
  ...usageLints,
  ...requirementLints,
};

const satisfyRequirementLints = {
  ...usageLints,
  invalidTarget: (db: QueryDB, self: SymbolEntry) => {
    if (!self.name) return null;
    const targets = db.byName(self.name);
    const reqTarget = targets.find((t) => t.ruleName === "RequirementDefinition" || t.ruleName === "RequirementUsage");
    if (targets.length > 0 && !reqTarget) {
      return error(`Target '${self.name}' is not a Requirement`, { field: "declaredName" });
    }
    return null;
  },
  /** Warning when satisfying a requirement whose constraints are violated */
  satisfyingViolatedRequirement: (db: QueryDB, self: SymbolEntry) => {
    const targetName = getRelationshipTargetName(db, self);
    if (!targetName) return null;
    const targets = db.byName(targetName);
    const reqTarget = targets.find((t) => t.ruleName === "RequirementDefinition" || t.ruleName === "RequirementUsage");
    if (!reqTarget) return null;
    const constraintsMet = evaluateConstraintsMet(db, reqTarget);
    if (constraintsMet === false) {
      return warning(`Satisfying '${targetName}' whose constraints evaluate to false`);
    }
    return null;
  },
};

// ---------------------------------------------------------------------------
// Verification Case models, queries, and lints
// ---------------------------------------------------------------------------

/** Model config for VerificationCaseDefinition */
const verificationCaseDefinitionModel = {
  name: "VerificationCaseDefinitionNode" as const,
  visitable: true,
  specializable: true,
  properties: {
    ...definitionModel.properties,
  },
  queryTypes: {
    ...definitionModel.queryTypes,
    verifiedRequirements: "SemanticNode[]" as const,
    objective: "SemanticNode | null" as const,
  },
};

/** Model config for VerificationCaseUsage */
const verificationCaseUsageModel = {
  name: "VerificationCaseUsageNode" as const,
  visitable: true,
  specializable: true,
  properties: {
    ...usageModel.properties,
  },
  queryTypes: {
    ...usageModel.queryTypes,
    verifiedRequirements: "SemanticNode[]" as const,
    objective: "SemanticNode | null" as const,
  },
};

/** Queries for VerificationCase rules */
const verificationCaseQueries = {
  ...definitionStructuralQueries,
  verifiedRequirements: (db: QueryDB, self: SymbolEntry) =>
    db.childrenOf(self.id).filter((c) => c.ruleName === "VerifyRequirementUsage"),
  objective: (db: QueryDB, self: SymbolEntry) => {
    for (const c of db.childrenOf(self.id)) {
      if (c.ruleName === "ObjectiveRequirementUsage") return c;
    }
    return null;
  },
};

/** Queries for VerificationCaseUsage */
const verificationCaseUsageQueries = {
  ...usageQueries,
  verifiedRequirements: (db: QueryDB, self: SymbolEntry) =>
    db.childrenOf(self.id).filter((c) => c.ruleName === "VerifyRequirementUsage"),
  objective: (db: QueryDB, self: SymbolEntry) => {
    for (const c of db.childrenOf(self.id)) {
      if (c.ruleName === "ObjectiveRequirementUsage") return c;
    }
    return null;
  },
};

/** Lint rules for VerificationCaseDefinition */
const verificationCaseDefinitionLints = {
  ...definitionLints,
  emptyVerificationCase: (db: QueryDB, self: SymbolEntry) => {
    const verifyMembers = db.childrenOf(self.id).filter((c) => c.ruleName === "VerifyRequirementUsage");
    if (verifyMembers.length === 0 && self.name) {
      return info(`Verification case '${self.name}' has no 'verify' members`, { field: "declaredName" });
    }
    return null;
  },
  missingObjective: (db: QueryDB, self: SymbolEntry) => {
    if (metaStr(self, "isAbstract") === "true") return null;
    const objectives = db.childrenOf(self.id).filter((c) => c.ruleName === "ObjectiveRequirementUsage");
    if (objectives.length === 0 && self.name) {
      return info(`Verification case '${self.name}' has no objective`, { field: "declaredName" });
    }
    return null;
  },
};

/** Lint rules for VerificationCaseUsage */
const verificationCaseUsageLints = {
  ...usageLints,
  emptyVerificationCase: (db: QueryDB, self: SymbolEntry) => {
    const verifyMembers = db.childrenOf(self.id).filter((c) => c.ruleName === "VerifyRequirementUsage");
    if (verifyMembers.length === 0 && self.name) {
      return info(`Verification case '${self.name}' has no 'verify' members`, { field: "declaredName" });
    }
    return null;
  },
  /** Provide a hook into the VerificationRunner for incremental verification */
  verificationResult: (db: QueryDB, self: SymbolEntry) => {
    // Requires a SimulationResult object to evaluate.
    // In practice, this would look up another query that returns the simulation object:
    // const simResult = db.query<SimulationResult>("simulationData", self.id);
    return null;
  },
};

/** Queries for Allocation usage */
const allocationQueries = {
  ...usageQueries,
  resolvedSource: (db: QueryDB, self: SymbolEntry) => {
    const refs = db.childrenOf(self.id).filter((c) => c.kind === "Reference" && c.name);
    if (refs.length >= 2) {
      const resolved = resolveFeatureInScope(db, self.parentId, refs[0].name!);
      if (resolved) return resolved;
    }
    return null;
  },
  resolvedTarget: (db: QueryDB, self: SymbolEntry) => {
    const refs = db.childrenOf(self.id).filter((c) => c.kind === "Reference" && c.name);
    if (refs.length >= 2) {
      // In allocate A to B, A is refs[0] and B is refs[1]
      const resolved = resolveFeatureInScope(db, self.parentId, refs[1].name!);
      if (resolved) return resolved;
    }
    return null;
  },
};

/** Lint rules for AllocationUsage */
const allocationLints = {
  ...usageLints,
  allocationTargetUnresolved: (db: QueryDB, self: SymbolEntry) => {
    const refs = db.childrenOf(self.id).filter((c) => c.kind === "Reference" && c.name);
    if (refs.length >= 2) {
      const targetName = refs[1].name!;
      const resolved = resolveFeatureInScope(db, self.parentId, targetName);
      if (!resolved) {
        return error(`Allocation target '${targetName}' could not be resolved`, { field: "declaredName" });
      }
    }
    return null;
  },
  allocationSourceUnresolved: (db: QueryDB, self: SymbolEntry) => {
    const refs = db.childrenOf(self.id).filter((c) => c.kind === "Reference" && c.name);
    if (refs.length >= 2) {
      const sourceName = refs[0].name!;
      const resolved = resolveFeatureInScope(db, self.parentId, sourceName);
      if (!resolved) {
        return error(`Allocation source '${sourceName}' could not be resolved`, { field: "declaredName" });
      }
    }
    return null;
  },
  portInterfaceMismatch: (db: QueryDB, self: SymbolEntry) => {
    // Basic lint for port-interface matching (stubbed for future deeper types)
    return null;
  },
};

/** Lint rules for VerifyRequirementUsage */
const verifyRequirementLints = {
  verifyTargetNotRequirement: (db: QueryDB, self: SymbolEntry) => {
    if (!self.name) return null;
    const targets = db.byName(self.name);
    const reqTarget = targets.find((t) => t.ruleName === "RequirementDefinition" || t.ruleName === "RequirementUsage");
    if (targets.length > 0 && !reqTarget) {
      return error(`Verify target '${self.name}' is not a Requirement`, { field: "declaredName" });
    }
    return null;
  },
};

// ---------------------------------------------------------------------------
// RequirementUsage — promoted model and queries
// ---------------------------------------------------------------------------

/** Model config for RequirementUsage (promoted from generic UsageNode) */
const requirementUsageModel = {
  name: "RequirementUsageNode" as const,
  visitable: true,
  specializable: true,
  properties: {
    ...usageModel.properties,
  },
  queryTypes: {
    ...usageModel.queryTypes,
    subject: "UsageNode | null" as const,
    assumeConstraints: "SemanticNode[]" as const,
    requireConstraints: "SemanticNode[]" as const,
    isSatisfied: "boolean" as const,
    satisfiedBy: "SemanticNode[]" as const,
    isVerified: "boolean" as const,
    verifiedBy: "SemanticNode[]" as const,
    verificationStatus: "string" as const,
    constraintsMet: "boolean | null" as const,
  },
};

/** Queries for RequirementUsage (promoted) */
const requirementUsageQueries = {
  ...usageQueries,
  subject: requirementQueries.subject,
  assumeConstraints: requirementQueries.assumeConstraints,
  requireConstraints: requirementQueries.requireConstraints,
  ...requirementSatisfactionQueries,
};

// ---------------------------------------------------------------------------
// SatisfyRequirementUsage — dedicated model and queries
// ---------------------------------------------------------------------------

/** Model config for SatisfyRequirementUsage */
const satisfyRequirementModel = {
  name: "SatisfyRequirementNode" as const,
  visitable: true,
  properties: {
    ...usageModel.properties,
    isNegated: "boolean" as const,
  },
  queryTypes: {
    ...usageModel.queryTypes,
    satisfiedRequirement: "SemanticNode | null" as const,
    satisfyingSubject: "UsageNode | null" as const,
  },
};

/** Queries for SatisfyRequirementUsage */
const satisfyRequirementQueries = {
  ...usageQueries,
  satisfiedRequirement: (db: QueryDB, self: SymbolEntry) => {
    // The satisfy references a requirement via OwnedReferenceSubsetting or name
    if (!self.name) return null;
    const targets = db.byName(self.name);
    return targets.find((t) => t.ruleName === "RequirementDefinition" || t.ruleName === "RequirementUsage") ?? null;
  },
  satisfyingSubject: (db: QueryDB, self: SymbolEntry) => {
    for (const c of db.childrenOf(self.id)) {
      if (c.ruleName === "SubjectUsage") return c;
    }
    return null;
  },
};

// ---------------------------------------------------------------------------
// Requirement structural lint (enhancement)
// ---------------------------------------------------------------------------

const requirementStructuralLints = {
  requirementWithoutConstraint: (db: QueryDB, self: SymbolEntry) => {
    if (metaStr(self, "isAbstract") === "true") return null;
    const assumes = db
      .childrenOf(self.id)
      .filter((c) => c.ruleName === "RequirementConstraintUsage" && metaStr(c, "constraintKind") === "assume");
    const requires = db
      .childrenOf(self.id)
      .filter((c) => c.ruleName === "RequirementConstraintUsage" && metaStr(c, "constraintKind") === "require");
    if (assumes.length === 0 && requires.length === 0 && self.name) {
      return info(`Requirement '${self.name}' has no assume or require constraints`, { field: "declaredName" });
    }
    return null;
  },
};

// Re-compose requirement lints with structural checks
const requirementDefinitionLintsEnhanced = {
  ...definitionLints,
  ...requirementLints,
  ...requirementStructuralLints,
};

const requirementUsageLintsEnhanced = {
  ...usageLints,
  ...requirementLints,
  ...requirementStructuralLints,
};

// ---------------------------------------------------------------------------
// Package-level traceability queries
// ---------------------------------------------------------------------------

/** Walk all descendants to find requirement/verification symbols */
const collectDescendants = (db: QueryDB, parentId: number, ruleNames: string[]): SymbolEntry[] => {
  const results: SymbolEntry[] = [];
  const walk = (id: number) => {
    for (const c of db.childrenOf(id)) {
      if (ruleNames.includes(c.ruleName)) results.push(c);
      if (c.kind === "Package" || c.kind === "Definition") walk(c.id);
    }
  };
  walk(parentId);
  return results;
};

const traceabilityQueries = {
  allRequirements: (db: QueryDB, self: SymbolEntry) =>
    collectDescendants(db, self.id, ["RequirementDefinition", "RequirementUsage"]),
  satisfiedRequirements: (db: QueryDB, self: SymbolEntry) => {
    const satisfies = collectDescendants(db, self.id, ["SatisfyRequirementUsage"]);
    const satisfiedNames = new Set(satisfies.map((s) => s.name).filter(Boolean));
    return collectDescendants(db, self.id, ["RequirementDefinition", "RequirementUsage"]).filter(
      (r) => r.name && satisfiedNames.has(r.name),
    );
  },
  unsatisfiedRequirements: (db: QueryDB, self: SymbolEntry) => {
    const satisfies = collectDescendants(db, self.id, ["SatisfyRequirementUsage"]);
    const satisfiedNames = new Set(satisfies.map((s) => s.name).filter(Boolean));
    return collectDescendants(db, self.id, ["RequirementDefinition", "RequirementUsage"]).filter(
      (r) => r.name && !satisfiedNames.has(r.name),
    );
  },
  verifiedRequirements: (db: QueryDB, self: SymbolEntry) => {
    const verifies = collectDescendants(db, self.id, ["VerifyRequirementUsage"]);
    const verifiedNames = new Set(verifies.map((v) => v.name).filter(Boolean));
    return collectDescendants(db, self.id, ["RequirementDefinition", "RequirementUsage"]).filter(
      (r) => r.name && verifiedNames.has(r.name),
    );
  },
  unverifiedRequirements: (db: QueryDB, self: SymbolEntry) => {
    const verifies = collectDescendants(db, self.id, ["VerifyRequirementUsage"]);
    const verifiedNames = new Set(verifies.map((v) => v.name).filter(Boolean));
    return collectDescendants(db, self.id, ["RequirementDefinition", "RequirementUsage"]).filter(
      (r) => r.name && !verifiedNames.has(r.name) && metaStr(r, "isAbstract") !== "true",
    );
  },
};

/** Extended package queries with traceability */
const packageTraceabilityQueries = {
  ...namespaceQueries,
  ...traceabilityQueries,
};

/** Extended package model with traceability query types */
const packageTraceabilityModel = {
  name: "PackageNode" as const,
  visitable: true,
  properties: { isLibrary: "boolean" as const, isStandard: "boolean" as const },
  queryTypes: {
    ...packageModel.queryTypes,
    allRequirements: "SemanticNode[]" as const,
    satisfiedRequirements: "SemanticNode[]" as const,
    unsatisfiedRequirements: "SemanticNode[]" as const,
    verifiedRequirements: "SemanticNode[]" as const,
    unverifiedRequirements: "SemanticNode[]" as const,
  },
};

/** Package lints with traceability gap detection */
const packageTraceabilityLints = {
  packageNaming: (_db: QueryDB, self: SymbolEntry) => {
    if (self.name && /^[a-z]/.test(self.name)) {
      return warning(`Package '${self.name}' should start with an uppercase letter`, { field: "declaredName" });
    }
    return null;
  },
  emptyPackage: (db: QueryDB, self: SymbolEntry) => {
    if (db.childrenOf(self.id).length === 0) {
      return info(`Package '${self.name}' has no members`);
    }
    return null;
  },
  unverifiedRequirement: (db: QueryDB, self: SymbolEntry) => {
    const verifies = collectDescendants(db, self.id, ["VerifyRequirementUsage"]);
    const verifiedNames = new Set(verifies.map((v) => v.name).filter(Boolean));
    const unverified = collectDescendants(db, self.id, ["RequirementDefinition", "RequirementUsage"]).filter(
      (r) => r.name && !verifiedNames.has(r.name) && metaStr(r, "isAbstract") !== "true",
    );
    if (unverified.length > 0) {
      const names = unverified.map((r) => r.name).join(", ");
      return warning(`Package '${self.name}' has unverified requirements: ${names}`, { field: "declaredName" });
    }
    return null;
  },
};

// ---------------------------------------------------------------------------
// X6-Compatible Graphics Configuration — Reusable helpers
// ---------------------------------------------------------------------------

import type { GraphicsConfig, X6Markup } from "@modelscript/polyglot";

/** Standard SysML block-style node markup: header + separator + label + icon */
const blockMarkup: X6Markup[] = [
  { tagName: "rect", selector: "body" },
  { tagName: "text", selector: "header" },
  { tagName: "line", selector: "separator" },
  { tagName: "text", selector: "label" },
  { tagName: "image", selector: "icon" },
];

/** Minimal node markup for simpler nodes */
const simpleMarkup: X6Markup[] = [
  { tagName: "rect", selector: "body" },
  { tagName: "text", selector: "label" },
];

/** Create a SysML block-style node GraphicsConfig */
const sysmlNodeGraphics = (opts: {
  stereotype: string;
  fill: string;
  stroke: string;
  iconHref?: string;
  width?: number;
  height?: number;
  portQuery?: string;
}): GraphicsConfig => ({
  role: "node",
  node: {
    shape: "rect",
    markup: blockMarkup,
    attrs: {
      body: { fill: opts.fill, stroke: opts.stroke, strokeWidth: 2, rx: 4, ry: 4 },
      header: {
        text: `«${opts.stereotype}»`,
        fill: opts.stroke,
        fontSize: 10,
        textAnchor: "middle",
        refX: 0.5,
        refY: 14,
      },
      separator: { x1: 0, y1: 24, x2: "100%", y2: 24, stroke: opts.stroke, strokeWidth: 1 },
      label: {
        text: "{{name}}",
        fill: "#1a1a1a",
        fontSize: 14,
        fontWeight: "bold",
        textAnchor: "middle",
        refX: 0.5,
        refY: 40,
      },
      icon: {
        ...(opts.iconHref ? { href: opts.iconHref, width: 16, height: 16, x: 6, y: 4 } : {}),
      },
    },
    size: { width: opts.width ?? 180, height: opts.height ?? 60 },
    ports: {
      groups: {
        in: { position: "left", attrs: { circle: { r: 5, fill: opts.stroke, stroke: "#fff", strokeWidth: 1.5 } } },
        out: { position: "right", attrs: { circle: { r: 5, fill: opts.stroke, stroke: "#fff", strokeWidth: 1.5 } } },
      },
    },
    portQuery: opts.portQuery,
  },
});

/** Create a SysML usage-style node (lighter fill, no header separator) */
const sysmlUsageGraphics = (opts: {
  stereotype: string;
  fill: string;
  stroke: string;
  iconHref?: string;
}): GraphicsConfig => ({
  role: "node",
  node: {
    shape: "rect",
    markup: simpleMarkup,
    attrs: {
      body: { fill: opts.fill, stroke: opts.stroke, strokeWidth: 1.5, rx: 4, ry: 4, strokeDasharray: "6 3" },
      label: {
        text: "{{name}}",
        fill: "#1a1a1a",
        fontSize: 13,
        textAnchor: "middle",
        refX: 0.5,
        refY: 0.5,
      },
    },
    size: { width: 140, height: 40 },
  },
});

/** Create a SysML package/group GraphicsConfig */
const sysmlGroupGraphics = (opts: { fill: string; stroke: string; tabText: string }): GraphicsConfig => ({
  role: "group",
  node: {
    shape: "rect",
    markup: [
      { tagName: "rect", selector: "body" },
      { tagName: "rect", selector: "tab" },
      { tagName: "text", selector: "tabLabel" },
      { tagName: "text", selector: "label" },
    ],
    attrs: {
      body: { fill: opts.fill, stroke: opts.stroke, strokeWidth: 2, rx: 0, ry: 0 },
      tab: { fill: opts.stroke, width: 80, height: 20, rx: 0, ry: 0, x: 0, y: 0 },
      tabLabel: { text: opts.tabText, fill: "#fff", fontSize: 10, x: 40, y: 13, textAnchor: "middle" },
      label: {
        text: "{{name}}",
        fill: "#1a1a1a",
        fontSize: 14,
        fontWeight: "bold",
        refX: 0.5,
        refY: 34,
        textAnchor: "middle",
      },
    },
    size: { width: 300, height: 200 },
  },
});

/** Create a SysML edge GraphicsConfig */
const sysmlEdgeGraphics = (opts: {
  label?: string;
  stroke?: string;
  strokeDasharray?: string;
  targetMarker?: string;
  router?: string;
  connector?: string;
}): GraphicsConfig => ({
  role: "edge",
  edge: {
    shape: "edge",
    attrs: {
      line: {
        stroke: opts.stroke ?? "#333",
        strokeWidth: 1.5,
        ...(opts.strokeDasharray ? { strokeDasharray: opts.strokeDasharray } : {}),
        targetMarker: opts.targetMarker ?? "classic",
      },
    },
    labels: opts.label
      ? [
          {
            attrs: {
              text: { text: opts.label, fill: "#666", fontSize: 11 },
              rect: { fill: "#fff", stroke: "none", rx: 3, ry: 3 },
            },
            position: { distance: 0.5, offset: 0 },
          },
        ]
      : undefined,
    router: opts.router ?? "manhattan",
    connector: opts.connector ?? "rounded",
  },
});

// ---------------------------------------------------------------------------
// Cross-Language Adapters — SysML2 → Modelica helpers
// ---------------------------------------------------------------------------

import type { AdapterDB } from "@modelscript/polyglot";

/** Project a SysML2 Definition as a Modelica ClassDefinition. */
const modelicaClassAdapter = (classKind: string) => ({
  modelica: {
    target: "ClassDefinition",
    transform: (db: AdapterDB, self: SymbolEntry | any) => {
      const s = self as SymbolEntry;
      return {
        name: s.name,
        classKind,
        isAbstract: false,
        components: db
          .childrenOf(s.id)
          .filter((c) => c.kind === "Usage")
          .map((c) => db.project(c, "modelica"))
          .filter(Boolean),
        nestedClasses: db
          .childrenOf(s.id)
          .filter((c) => c.kind === "Definition")
          .map((c) => db.project(c, "modelica"))
          .filter(Boolean),
      };
    },
  },
});

/** Project a SysML2 Usage as a Modelica ComponentClause. */
const modelicaComponentAdapter = (opts?: { variability?: string; mapDirection?: boolean }) => ({
  modelica: {
    target: "ComponentClause",
    transform: (db: AdapterDB, self: SymbolEntry | any) => {
      const s = self as SymbolEntry;
      // Resolve type from child OwnedFeatureTyping ref
      const typeChild = db.childrenOf(s.id).find((c) => c.ruleName === "OwnedFeatureTyping");
      const dir = (s.metadata as Record<string, unknown>)?.direction;
      return {
        name: s.name,
        typeSpecifier: typeChild?.name ?? null,
        causality: opts?.mapDirection ? (dir === "in" ? "input" : dir === "out" ? "output" : null) : null,
        variability: opts?.variability ?? null,
      };
    },
  },
});

export default language({
  name: "sysml2",

  extras: ($) => [/\s/, $.ML_NOTE, $.SL_NOTE],

  conflicts: ($) => [
    [$.LiteralInteger, $.RealValue],
    [$.FeatureReferenceMember, $.ElementReferenceMember, $.OwnedFeatureChaining],
    [$.Qualification],
    [$.FeatureChainMember, $.OwnedFeatureChaining],
    [$._FeatureChain],
    [$._postfix_operation],
    // All definition and usage rules share modifier keyword prefixes
    [
      $.DefaultReferenceUsage,
      $.ReferenceUsage,
      $.AttributeDefinition,
      $.AttributeUsage,
      $.EnumerationDefinition,
      $.EnumerationUsage,
      $.EnumeratedValue,
      $.OccurrenceDefinition,
      $.OccurrenceUsage,
      $.ItemDefinition,
      $.ItemUsage,
      $.PartDefinition,
      $.PartUsage,
      $.PortDefinition,
      $.PortUsage,
      $.ConnectionDefinition,
      $.ConnectionUsage,
      $.InterfaceDefinition,
      $.InterfaceUsage,
      $.AllocationDefinition,
      $.AllocationUsage,
      $.FlowDefinition,
      $.FlowUsage,
      $.SuccessionFlowUsage,
      $.BindingConnectorAsUsage,
      $.SuccessionAsUsage,
      $.ActionDefinition,
      $.ActionUsage,
      $.PerformActionUsage,
      $.CalculationDefinition,
      $.CalculationUsage,
      $.ConstraintDefinition,
      $.ConstraintUsage,
      $.AssertConstraintUsage,
      $.RequirementDefinition,
      $.RequirementUsage,
      $.SatisfyRequirementUsage,
      $.ConcernDefinition,
      $.ConcernUsage,
      $.CaseDefinition,
      $.CaseUsage,
      $.AnalysisCaseDefinition,
      $.AnalysisCaseUsage,
      $.VerificationCaseDefinition,
      $.VerificationCaseUsage,
      $.UseCaseDefinition,
      $.UseCaseUsage,
      $.IncludeUseCaseUsage,
      $.StateDefinition,
      $.StateUsage,
      $.ExhibitStateUsage,
      $.ViewDefinition,
      $.ViewUsage,
      $.ViewpointDefinition,
      $.ViewpointUsage,
      $.RenderingDefinition,
      $.RenderingUsage,
      $.MetadataDefinition,
      $.MetadataUsage,
      $.MergeNode,
      $.DecisionNode,
      $.JoinNode,
      $.ForkNode,
      $.AcceptActionNode,
      $.SendActionNode,
      $.AssignActionNode,
      $.VerifyRequirementUsage,
      $.ObjectiveRequirementUsage,
    ],
    [$._usage_modifier, $.ReferenceUsage],
    [$.PrefixMetadataAnnotation, $.PrefixMetadataMember],
    [$.OwnedReferenceSubsetting, $.OwnedFeatureChaining],
    [$.OwnedFeatureTyping, $.OwnedFeatureChaining],
    [$.OwnedSubsetting, $.OwnedFeatureChaining],
    [$.OwnedRedefinition, $.OwnedFeatureChaining],
    [$.OwnedCrossSubsetting, $.OwnedFeatureChaining],
    [$.Qualification, $.QualifiedName],
    [$._FeatureSpecializationPart],
    [$.MetadataUsage, $.ClassificationTestOperator],
    [$._Identification, $.QualifiedName],
    [$._Identification],
    [$._ActionBody, $.StateActionUsage],
    [$._ActionBodyItem, $._CalculationBody],
    [$.FeatureReferenceMember, $.InstantiatedTypeMember],
  ],

  word: ($) => $.ID,

  rules: {
    // =====================================================================
    // ROOT
    // =====================================================================

    RootNamespace: ($) => rep($._PackageBodyElement),

    _PackageBodyElement: ($) => choice($.PackageMember, $.ElementFilterMember, $.AliasMember, $.Import),

    // =====================================================================
    // BASIC ELEMENTS
    // =====================================================================

    _Identification: ($) =>
      choice(
        seq("<", field("declaredShortName", $.Name), ">", opt(field("declaredName", $.Name))),
        field("declaredName", $.Name),
      ),

    _RelationshipBody: ($) => choice(";", seq("{", rep($.OwnedAnnotation), "}")),

    // =====================================================================
    // VISIBILITY
    // =====================================================================

    VisibilityIndicator: () => choice("public", "private", "protected"),

    // =====================================================================
    // DEPENDENCIES
    // =====================================================================

    Dependency: ($) =>
      seq(
        rep($.PrefixMetadataAnnotation),
        "dependency",
        opt(seq(opt($._Identification), "from")),
        field("client", $.QualifiedName),
        rep(seq(",", field("client", $.QualifiedName))),
        "to",
        field("supplier", $.QualifiedName),
        rep(seq(",", field("supplier", $.QualifiedName))),
        $._RelationshipBody,
      ),

    // =====================================================================
    // ANNOTATIONS
    // =====================================================================

    Annotation: ($) =>
      ref({
        syntax: field("annotatedElement", $.QualifiedName),
        name: (self) => self.annotatedElement,
        targetKinds: ["Element"],
        resolve: "qualified",
      }),

    OwnedAnnotation: ($) => field("ownedRelatedElement", $._AnnotatingElement),

    AnnotatingMember: ($) => field("ownedRelatedElement", $._AnnotatingElement),

    _AnnotatingElement: ($) => choice($.Comment, $.Documentation, $.TextualRepresentation, $.MetadataUsage),

    Comment: ($) =>
      seq(
        opt(seq("comment", opt($._Identification), opt(seq("about", $.Annotation, rep(seq(",", $.Annotation)))))),
        opt(seq("locale", field("locale", $.STRING_VALUE))),
        field("body", $.REGULAR_COMMENT),
      ),

    Documentation: ($) =>
      seq(
        "doc",
        opt($._Identification),
        opt(seq("locale", field("locale", $.STRING_VALUE))),
        field("body", $.REGULAR_COMMENT),
      ),

    TextualRepresentation: ($) =>
      seq(
        opt(seq("rep", opt($._Identification))),
        "language",
        field("language", $.STRING_VALUE),
        field("body", $.REGULAR_COMMENT),
      ),

    // =====================================================================
    // METADATA
    // =====================================================================

    PrefixMetadataAnnotation: ($) => seq("#", field("ownedRelatedElement", $.PrefixMetadataUsage)),

    PrefixMetadataMember: ($) => seq("#", field("ownedRelatedElement", $.PrefixMetadataUsage)),

    PrefixMetadataUsage: ($) => field("ownedRelationship", $.MetadataTyping),

    MetadataUsage: ($) =>
      def({
        syntax: seq(
          rep($._usage_modifier),
          choice("metadata", "@"),
          opt(seq(opt($._Identification), opt(seq(choice(":", seq("defined", "by")))))),
          field("ownedRelationship", $.MetadataTyping),
          opt(seq("about", $.Annotation, rep(seq(",", $.Annotation)))),
          $._MetadataBody,
        ),
        symbol: usageAttrs("metadata"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
      }),

    MetadataTyping: ($) =>
      ref({
        syntax: field("type", $.QualifiedName),
        name: (self) => self.type,
        targetKinds: ["Metaclass"],
        resolve: "qualified",
      }),

    _MetadataBody: ($) =>
      choice(";", seq("{", rep(choice($.DefinitionMember, $.MetadataBodyUsageMember, $.AliasMember, $.Import)), "}")),

    MetadataBodyUsageMember: ($) => field("ownedRelatedElement", $.MetadataBodyUsage),

    MetadataBodyUsage: ($) =>
      seq(
        opt("ref"),
        opt(choice(":>>", "redefines")),
        field("ownedRelationship", $.OwnedRedefinition),
        opt($._FeatureSpecializationPart),
        opt($._ValuePart),
        $._MetadataBody,
      ),

    MetadataDefinition: ($) =>
      def({
        syntax: seq(rep($._usage_modifier), "metadata", "def", $._Definition),
        symbol: defAttrs("metadata"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
      }),

    // =====================================================================
    // PACKAGES
    // =====================================================================

    Package: ($) =>
      def({
        syntax: seq(rep($._usage_modifier), "package", opt($._Identification), $._PackageBody),
        symbol: (self: any) => ({
          kind: "Package",
          name: self.declaredName,
          exports: [self.declaredName],
        }),
        queries: packageTraceabilityQueries,
        model: packageTraceabilityModel,
        lints: packageTraceabilityLints,
        graphics: () => sysmlGroupGraphics({ fill: "#f0f4ff", stroke: "#4a90d9", tabText: "package" }),
      }),

    LibraryPackage: ($) =>
      def({
        syntax: seq(
          opt(field("isStandard", "standard")),
          "library",
          rep($._usage_modifier),
          "package",
          opt($._Identification),
          $._PackageBody,
        ),
        symbol: (self: any) => ({
          kind: "Package",
          name: self.declaredName,
          exports: [self.declaredName],
          attributes: { isStandard: self.isStandard },
        }),
        queries: packageTraceabilityQueries,
        model: packageTraceabilityModel,
        lints: packageTraceabilityLints,
        graphics: () => sysmlGroupGraphics({ fill: "#f0f4ff", stroke: "#4a90d9", tabText: "library" }),
      }),

    _PackageBody: ($) => choice(";", seq("{", rep($._PackageBodyElement), "}")),

    PackageMember: ($) =>
      seq(
        opt($.VisibilityIndicator),
        choice(field("ownedRelatedElement", $._DefinitionElement), field("ownedRelatedElement", $._UsageElement)),
      ),

    ElementFilterMember: ($) =>
      seq(opt($.VisibilityIndicator), "filter", field("ownedRelatedElement", $.OwnedExpression), ";"),

    AliasMember: ($) =>
      def({
        syntax: seq(
          opt($.VisibilityIndicator),
          "alias",
          opt(seq("<", field("memberShortName", $.Name), ">")),
          opt(field("memberName", $.Name)),
          "for",
          ref({
            syntax: field("memberElement", $.QualifiedName),
            name: (self) => self.memberElement,
            targetKinds: ["Element"],
            resolve: "qualified",
          }),
          $._RelationshipBody,
        ),
        symbol: (self) => ({ kind: "Alias", name: self.memberName }),
        model: {
          name: "AliasNode" as const,
          visitable: true,
        },
      }),

    // =====================================================================
    // IMPORTS
    // =====================================================================

    _ImportPrefix: ($) => seq(opt($.VisibilityIndicator), "import", opt(field("isImportAll", "all"))),

    Import: ($) => seq(choice($.MembershipImport, $.NamespaceImport), $._RelationshipBody),

    MembershipImport: ($) =>
      def({
        syntax: seq($._ImportPrefix, $._ImportedMembership),
        symbol: (self) => ({
          kind: "Import",
          name: self.importedMembership,
          attributes: {
            isImportAll: self.isImportAll,
            isRecursive: self.isRecursive,
          },
        }),
        model: importModel,
      }),

    _ImportedMembership: ($) =>
      seq(
        ref({
          syntax: field("importedMembership", $.QualifiedName),
          name: (self) => self.importedMembership,
          targetKinds: ["Membership"],
          resolve: "qualified",
        }),
        opt(seq("::", field("isRecursive", "**"))),
      ),

    NamespaceImport: ($) =>
      def({
        syntax: seq($._ImportPrefix, choice($._ImportedNamespace, field("ownedRelatedElement", $.FilterPackage))),
        symbol: (self: any) => ({
          kind: "Import",
          name: self.importedNamespace,
          attributes: {
            isImportAll: self.isImportAll,
            isRecursive: self.isRecursive,
          },
        }),
        model: importModel,
      }),

    _ImportedNamespace: ($) =>
      seq(
        ref({
          syntax: field("importedNamespace", $.QualifiedName),
          name: (self) => self.importedNamespace,
          targetKinds: ["Namespace"],
          resolve: "qualified",
        }),
        "::",
        "*",
        opt(seq("::", field("isRecursive", "**"))),
      ),

    FilterPackage: ($) => seq($.FilterPackageImport, rep1($.FilterPackageMember)),

    FilterPackageImport: ($) => choice($.FilterPackageMembershipImport, $.FilterPackageNamespaceImport),

    FilterPackageMembershipImport: ($) => $._ImportedMembership,
    FilterPackageNamespaceImport: ($) => $._ImportedNamespace,

    FilterPackageMember: ($) => seq("[", field("ownedRelatedElement", $.OwnedExpression), "]"),

    // =====================================================================
    // DEFINITION & USAGE ELEMENTS (dispatch)
    // =====================================================================

    _DefinitionElement: ($) =>
      choice(
        $.Package,
        $.LibraryPackage,
        $._AnnotatingElement,
        $.Dependency,
        $.AttributeDefinition,
        $.EnumerationDefinition,
        $.OccurrenceDefinition,
        $.ItemDefinition,
        $.MetadataDefinition,
        $.PartDefinition,
        $.ConnectionDefinition,
        $.FlowDefinition,
        $.InterfaceDefinition,
        $.AllocationDefinition,
        $.PortDefinition,
        $.ActionDefinition,
        $.CalculationDefinition,
        $.StateDefinition,
        $.ConstraintDefinition,
        $.RequirementDefinition,
        $.ConcernDefinition,
        $.CaseDefinition,
        $.AnalysisCaseDefinition,
        $.VerificationCaseDefinition,
        $.UseCaseDefinition,
        $.ViewDefinition,
        $.ViewpointDefinition,
        $.RenderingDefinition,
      ),

    _UsageElement: ($) => choice($._NonOccurrenceUsageElement, $._OccurrenceUsageElement),

    _NonOccurrenceUsageElement: ($) =>
      choice(
        $.DefaultReferenceUsage,
        $.ReferenceUsage,
        $.AttributeUsage,
        $.EnumerationUsage,
        $.BindingConnectorAsUsage,
        $.SuccessionAsUsage,
      ),

    _OccurrenceUsageElement: ($) => choice($._StructureUsageElement, $._BehaviorUsageElement),

    _StructureUsageElement: ($) =>
      choice(
        $.OccurrenceUsage,
        $.ItemUsage,
        $.PartUsage,
        $.PortUsage,
        $.ConnectionUsage,
        $.InterfaceUsage,
        $.AllocationUsage,
        $.FlowUsage,
        $.SuccessionFlowUsage,
        $.ViewUsage,
        $.RenderingUsage,
      ),

    _BehaviorUsageElement: ($) =>
      choice(
        $.ActionUsage,
        $.CalculationUsage,
        $.StateUsage,
        $.ConstraintUsage,
        $.RequirementUsage,
        $.ConcernUsage,
        $.CaseUsage,
        $.AnalysisCaseUsage,
        $.VerificationCaseUsage,
        $.UseCaseUsage,
        $.ViewpointUsage,
        $.PerformActionUsage,
        $.ExhibitStateUsage,
        $.IncludeUseCaseUsage,
        $.AssertConstraintUsage,
        $.SatisfyRequirementUsage,
      ),

    // =====================================================================
    // CLASSIFIERS — Subclassification
    // =====================================================================

    _SubclassificationPart: ($) =>
      seq(choice(":>", "specializes"), $.OwnedSubclassification, rep(seq(",", $.OwnedSubclassification))),

    OwnedSubclassification: ($) =>
      ref({
        syntax: field("superclassifier", $.QualifiedName),
        name: (self) => self.superclassifier,
        targetKinds: ["Classifier"],
        resolve: "qualified",
      }),

    // =====================================================================
    // FEATURES
    // =====================================================================

    _FeatureDeclaration: ($) =>
      choice(seq($._Identification, opt($._FeatureSpecializationPart)), $._FeatureSpecializationPart),

    _FeatureSpecializationPart: ($) =>
      choice(
        seq(rep1($._FeatureSpecialization), opt($._MultiplicityPart), rep($._FeatureSpecialization)),
        seq($._MultiplicityPart, rep($._FeatureSpecialization)),
      ),

    _MultiplicityPart: ($) =>
      choice(
        $.OwnedMultiplicity,
        seq(
          opt($.OwnedMultiplicity),
          choice(
            seq(field("isOrdered", "ordered"), opt(field("isNonunique", "nonunique"))),
            seq(field("isNonunique", "nonunique"), opt(field("isOrdered", "ordered"))),
          ),
        ),
      ),

    _FeatureSpecialization: ($) => choice($._Typings, $._Subsettings, $._References, $._Crosses, $._Redefinitions),

    _Typings: ($) => seq(choice(":", seq("defined", "by")), $.FeatureTyping, rep(seq(",", $.FeatureTyping))),

    _Subsettings: ($) => seq(choice(":>", "subsets"), $.OwnedSubsetting, rep(seq(",", $.OwnedSubsetting))),

    _References: ($) => seq(choice("::>", "references"), $.OwnedReferenceSubsetting),

    _Crosses: ($) => seq(choice("=>", "crosses"), $.OwnedCrossSubsetting),

    _Redefinitions: ($) => seq(choice(":>>", "redefines"), $.OwnedRedefinition, rep(seq(",", $.OwnedRedefinition))),

    FeatureTyping: ($) => choice($.OwnedFeatureTyping, $.ConjugatedPortTyping),

    OwnedFeatureTyping: ($) =>
      choice(
        ref({
          syntax: field("type", $.QualifiedName),
          name: (self) => self.type,
          targetKinds: ["Type"],
          resolve: "qualified",
        }),
        field("ownedRelatedElement", $.OwnedFeatureChain),
      ),

    OwnedSubsetting: ($) =>
      choice(
        ref({
          syntax: field("subsettedFeature", $.QualifiedName),
          name: (self) => self.subsettedFeature,
          targetKinds: ["Feature"],
          resolve: "qualified",
        }),
        field("ownedRelatedElement", $.OwnedFeatureChain),
      ),

    OwnedReferenceSubsetting: ($) =>
      choice(
        ref({
          syntax: field("referencedFeature", $.QualifiedName),
          name: (self) => self.referencedFeature,
          targetKinds: ["Feature"],
          resolve: "qualified",
        }),
        field("ownedRelatedElement", $.OwnedFeatureChain),
      ),

    OwnedCrossSubsetting: ($) =>
      choice(
        ref({
          syntax: field("crossedFeature", $.QualifiedName),
          name: (self) => self.crossedFeature,
          targetKinds: ["Feature"],
          resolve: "qualified",
        }),
        field("ownedRelatedElement", $.OwnedFeatureChain),
      ),

    OwnedRedefinition: ($) =>
      choice(
        ref({
          syntax: field("redefinedFeature", $.QualifiedName),
          name: (self) => self.redefinedFeature,
          targetKinds: ["Feature"],
          resolve: "qualified",
        }),
        field("ownedRelatedElement", $.OwnedFeatureChain),
      ),

    // =====================================================================
    // MULTIPLICITY
    // =====================================================================

    OwnedMultiplicity: ($) => field("ownedRelatedElement", $.MultiplicityRange),

    MultiplicityRange: ($) =>
      seq(
        "[",
        field("lowerBound", $.MultiplicityExpressionMember),
        opt(seq("..", field("upperBound", $.MultiplicityExpressionMember))),
        "]",
      ),

    MultiplicityExpressionMember: ($) =>
      field("ownedRelatedElement", choice($._LiteralExpression, $.FeatureReferenceExpression)),

    // =====================================================================
    // DEFINITIONS
    // =====================================================================

    _Definition: ($) => seq(opt($._Identification), opt($._SubclassificationPart), $._DefinitionBody),

    _DefinitionBody: ($) => choice(";", seq("{", rep($._DefinitionBodyItem), "}")),

    _DefinitionBodyItem: ($) =>
      choice(
        $.DefinitionMember,
        $.VariantUsageMember,
        $.NonOccurrenceUsageMember,
        seq(opt($.EmptySuccessionMember), $.OccurrenceUsageMember),
        $.AliasMember,
        $.Import,
      ),

    DefinitionMember: ($) => seq(opt($.VisibilityIndicator), field("ownedRelatedElement", $._DefinitionElement)),

    VariantUsageMember: ($) =>
      seq(opt($.VisibilityIndicator), "variant", field("ownedRelatedElement", $._UsageElement)),

    NonOccurrenceUsageMember: ($) =>
      seq(opt($.VisibilityIndicator), field("ownedRelatedElement", $._NonOccurrenceUsageElement)),

    OccurrenceUsageMember: ($) =>
      seq(opt($.VisibilityIndicator), field("ownedRelatedElement", $._OccurrenceUsageElement)),

    // =====================================================================
    // USAGES
    // =====================================================================
    // Single shared modifier rule — avoids per-rule rep() conflicts
    _usage_modifier: ($) =>
      choice(
        field("isEnd", "end"),
        field("direction", "in"),
        field("direction", "out"),
        field("direction", "inout"),
        field("isDerived", "derived"),
        field("isAbstract", "abstract"),
        field("isVariation", "variation"),
        field("isConstant", "constant"),
        field("isRef", "ref"),
        "individual",
        "snapshot",
        "timeslice",
        $.PrefixMetadataMember,
      ),

    _UsageDeclaration: ($) => $._FeatureDeclaration,

    _UsageCompletion: ($) => seq(opt($._ValuePart), $._DefinitionBody),

    _Usage: ($) => seq(opt($._UsageDeclaration), $._UsageCompletion),

    _ValuePart: ($) => $.FeatureValue,

    FeatureValue: ($) =>
      seq(
        choice(
          "=",
          field("isInitial", ":="),
          seq(field("isDefault", "default"), opt(choice("=", field("isInitial", ":=")))),
        ),
        field("ownedRelatedElement", $.OwnedExpression),
      ),

    // =====================================================================
    // REFERENCE USAGES
    // =====================================================================

    DefaultReferenceUsage: ($) =>
      def({
        syntax: seq(rep($._usage_modifier), $._UsageDeclaration, opt($._ValuePart), $._DefinitionBody),
        symbol: usageAttrs("ref"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
      }),

    ReferenceUsage: ($) =>
      def({
        syntax: seq(rep($._usage_modifier), "ref", $._Usage),
        symbol: usageAttrs("ref"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
      }),

    // =====================================================================
    // ATTRIBUTES
    // =====================================================================

    AttributeDefinition: ($) =>
      def({
        syntax: seq(rep($._usage_modifier), "attribute", "def", $._Definition),
        symbol: defAttrs("attribute"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        adapters: modelicaClassAdapter("record"),
        graphics: () => sysmlNodeGraphics({ stereotype: "attribute def", fill: "#fce4ec", stroke: "#e91e63" }),
      }),

    AttributeUsage: ($) =>
      def({
        syntax: seq(rep($._usage_modifier), "attribute", $._Usage),
        symbol: usageAttrs("attribute"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        adapters: modelicaComponentAdapter({ variability: "parameter" }),
        graphics: () => sysmlUsageGraphics({ stereotype: "attribute", fill: "#fce4ec", stroke: "#f48fb1" }),
      }),

    // =====================================================================
    // ENUMERATIONS
    // =====================================================================

    EnumerationDefinition: ($) =>
      def({
        syntax: seq(
          rep($._usage_modifier),
          "enum",
          "def",
          opt($._Identification),
          opt($._SubclassificationPart),
          $._EnumerationBody,
        ),
        symbol: (self) => ({ kind: "Enumeration", name: self.declaredName, exports: [self.declaredName] }),
        queries: definitionStructuralQueries,
        model: {
          name: "EnumerationNode" as const,
          visitable: true,
          specializable: true,
          properties: { isAbstract: "boolean" as const },
          queryTypes: {
            members: "SemanticNode[]" as const,
            ownedDefinitions: "DefinitionNode[]" as const,
            ownedUsages: "UsageNode[]" as const,
            imports: "SemanticNode[]" as const,
          },
        },
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "enum def", fill: "#f3e5f5", stroke: "#7b1fa2" }),
      }),

    _EnumerationBody: ($) => choice(";", seq("{", rep(choice($.AnnotatingMember, $.EnumerationUsageMember)), "}")),

    EnumerationUsageMember: ($) => seq(opt($.VisibilityIndicator), field("ownedRelatedElement", $.EnumeratedValue)),

    EnumeratedValue: ($) =>
      def({
        syntax: seq(rep($._usage_modifier), opt("enum"), $._Usage),
        symbol: (self) => ({ kind: "EnumerationValue", name: self.declaredName }),
        model: {
          name: "EnumerationValueNode" as const,
          visitable: true,
        },
      }),

    EnumerationUsage: ($) =>
      def({
        syntax: seq(rep($._usage_modifier), "enum", $._Usage),
        symbol: usageAttrs("enumeration"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
      }),

    // =====================================================================
    // OCCURRENCES
    // =====================================================================

    OccurrenceDefinition: ($) =>
      def({
        syntax: seq(rep($._usage_modifier), "occurrence", "def", $._Definition),
        symbol: defAttrs("occurrence"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "occurrence def", fill: "#f5f5f5", stroke: "#616161" }),
      }),

    OccurrenceUsage: ($) =>
      def({
        syntax: seq(rep($._usage_modifier), "occurrence", $._Usage),
        symbol: usageAttrs("occurrence"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
      }),

    // =====================================================================
    // ITEMS
    // =====================================================================

    ItemDefinition: ($) =>
      def({
        syntax: seq(rep($._usage_modifier), "item", "def", $._Definition),
        symbol: defAttrs("item"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "item def", fill: "#e0f2f1", stroke: "#00897b" }),
      }),

    ItemUsage: ($) =>
      def({
        syntax: seq(rep($._usage_modifier), "item", $._Usage),
        symbol: usageAttrs("item"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => sysmlUsageGraphics({ stereotype: "item", fill: "#e0f2f1", stroke: "#4db6ac" }),
      }),

    PartDefinition: ($) =>
      def({
        syntax: seq(rep($._usage_modifier), "part", "def", $._Definition),
        symbol: defAttrs("part"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        adapters: modelicaClassAdapter("model"),
        graphics: () =>
          sysmlNodeGraphics({ stereotype: "part def", fill: "#e8f5e9", stroke: "#43a047", portQuery: "ownedPorts" }),
        diff: {
          ignore: ["annotationClause", "description"],
          breaking: ["isAbstract"],
        },
      }),

    PartUsage: ($) =>
      def({
        syntax: seq(rep($._usage_modifier), "part", $._Usage),
        symbol: usageAttrs("part"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        adapters: modelicaComponentAdapter(),
        graphics: () => sysmlUsageGraphics({ stereotype: "part", fill: "#e8f5e9", stroke: "#66bb6a" }),
      }),

    // =====================================================================
    // PORTS
    // =====================================================================

    PortDefinition: ($) =>
      def({
        syntax: seq(rep($._usage_modifier), "port", "def", $._Definition),
        symbol: defAttrs("port"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "port def", fill: "#fff9c4", stroke: "#f57f17" }),
        adapters: modelicaClassAdapter("connector"),
        diff: {
          ignore: ["annotationClause", "description"],
          breaking: ["direction"],
        },
      }),

    PortUsage: ($) =>
      def({
        syntax: seq(rep($._usage_modifier), "port", $._Usage),
        symbol: usageAttrs("port"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        adapters: modelicaComponentAdapter({ mapDirection: true }),
        graphics: () => ({
          role: "port-owner" as const,
          node: {
            shape: "rect",
            markup: [
              { tagName: "rect", selector: "body" },
              { tagName: "text", selector: "label" },
            ],
            attrs: {
              body: { fill: "#fff3e0", stroke: "#ef6c00", strokeWidth: 2, rx: 0, ry: 0, width: 16, height: 16 },
              label: { text: "{{name}}", fill: "#1a1a1a", fontSize: 10, refX: 0.5, refY: 20, textAnchor: "middle" },
            },
            size: { width: 16, height: 16 },
          },
        }),
      }),

    ConjugatedPortTyping: ($) =>
      seq(
        "~",
        ref({
          syntax: field("conjugatedPortDefinition", $.QualifiedName),
          name: (self) => self.conjugatedPortDefinition,
          targetKinds: ["ConjugatedPortDefinition"],
          resolve: "qualified",
        }),
      ),

    // =====================================================================
    // CONNECTIONS
    // =====================================================================

    ConnectorEndMember: ($) => field("ownedRelatedElement", $.ConnectorEnd),

    ConnectorEnd: ($) =>
      seq(
        opt(field("ownedRelationship", $.OwnedMultiplicity)),
        opt(seq(field("declaredName", $.Name), choice("::>", "references"))),
        $.OwnedReferenceSubsetting,
      ),

    ConnectionDefinition: ($) =>
      def({
        syntax: seq(rep($._usage_modifier), "connection", "def", $._Definition),
        symbol: defAttrs("connection"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        adapters: modelicaClassAdapter("model"),
        graphics: () => sysmlNodeGraphics({ stereotype: "connection def", fill: "#eceff1", stroke: "#546e7a" }),
      }),

    ConnectionUsage: ($) =>
      def({
        syntax: seq(
          rep($._usage_modifier),
          choice(
            seq("connection", opt($._UsageDeclaration), opt($._ValuePart), opt(seq("connect", $._ConnectorPart))),
            seq("connect", $._ConnectorPart),
          ),
          $._DefinitionBody,
        ),
        symbol: usageAttrs("connection"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => sysmlEdgeGraphics({ stroke: "#546e7a", label: "«connect»" }),
        diff: {
          identity: (self) => self.name || `connection_${self.id}`,
        },
      }),

    _ConnectorPart: ($) => choice($._BinaryConnectorPart, $._NaryConnectorPart),

    _BinaryConnectorPart: ($) => seq($.ConnectorEndMember, "to", $.ConnectorEndMember),

    _NaryConnectorPart: ($) =>
      seq("(", $.ConnectorEndMember, ",", $.ConnectorEndMember, rep(seq(",", $.ConnectorEndMember)), ")"),

    BindingConnectorAsUsage: ($) =>
      def({
        syntax: seq(
          rep($._usage_modifier),
          opt(seq("binding", opt($._UsageDeclaration))),
          "bind",
          $.ConnectorEndMember,
          "=",
          $.ConnectorEndMember,
          $._DefinitionBody,
        ),
        symbol: usageAttrs("binding"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => sysmlEdgeGraphics({ label: "«bind»", stroke: "#37474f" }),
      }),

    SuccessionAsUsage: ($) =>
      def({
        syntax: seq(
          rep($._usage_modifier),
          opt(seq("succession", opt($._UsageDeclaration))),
          "first",
          $.ConnectorEndMember,
          "then",
          $.ConnectorEndMember,
          $._DefinitionBody,
        ),
        symbol: usageAttrs("succession"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => sysmlEdgeGraphics({ label: "«succession»", stroke: "#455a64", strokeDasharray: "4 2" }),
      }),

    // =====================================================================
    // INTERFACES
    // =====================================================================

    InterfaceDefinition: ($) =>
      def({
        syntax: seq(
          rep($._usage_modifier),
          "interface",
          "def",
          opt($._Identification),
          opt($._SubclassificationPart),
          $._DefinitionBody,
        ),
        symbol: defAttrs("interface"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "interface def", fill: "#e0f2f1", stroke: "#00695c" }),
      }),

    InterfaceUsage: ($) =>
      def({
        syntax: seq(
          rep($._usage_modifier),
          "interface",
          opt($._UsageDeclaration),
          opt(seq("connect", $._ConnectorPart)),
          $._DefinitionBody,
        ),
        symbol: usageAttrs("interface"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => sysmlEdgeGraphics({ label: "«interface»", stroke: "#00695c" }),
      }),

    // =====================================================================
    // ALLOCATIONS
    // =====================================================================

    AllocationDefinition: ($) =>
      def({
        syntax: seq(rep($._usage_modifier), "allocation", "def", $._Definition),
        symbol: defAttrs("allocation"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "allocation def", fill: "#e8eaf6", stroke: "#283593" }),
      }),

    AllocationUsage: ($) =>
      def({
        syntax: seq(
          rep($._usage_modifier),
          choice(
            seq("allocation", opt($._UsageDeclaration), opt(seq("allocate", $._ConnectorPart))),
            seq("allocate", $._ConnectorPart),
          ),
          $._DefinitionBody,
        ),
        symbol: usageAttrs("allocation"),
        queries: allocationQueries,
        model: usageModel,
        lints: allocationLints,
        graphics: () => sysmlEdgeGraphics({ label: "«allocate»", stroke: "#283593", strokeDasharray: "6 3" }),
      }),

    // =====================================================================
    // FLOWS
    // =====================================================================

    FlowDefinition: ($) =>
      def({
        syntax: seq(rep($._usage_modifier), "flow", "def", $._Definition),
        symbol: defAttrs("flow"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "flow def", fill: "#e1f5fe", stroke: "#01579b" }),
      }),

    FlowUsage: ($) =>
      def({
        syntax: seq(
          rep($._usage_modifier),
          "flow",
          choice(
            seq($.FlowEndMember, "to", $.FlowEndMember),
            seq(
              opt($._UsageDeclaration),
              opt($._ValuePart),
              opt(seq("of", $.PayloadFeatureMember)),
              opt(seq("from", $.FlowEndMember, "to", $.FlowEndMember)),
            ),
          ),
          $._DefinitionBody,
        ),
        symbol: usageAttrs("flow"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => sysmlEdgeGraphics({ label: "«flow»", stroke: "#01579b" }),
      }),

    SuccessionFlowUsage: ($) =>
      def({
        syntax: seq(
          rep($._usage_modifier),
          "succession",
          "flow",
          choice(
            seq($.FlowEndMember, "to", $.FlowEndMember),
            seq(
              opt($._UsageDeclaration),
              opt($._ValuePart),
              opt(seq("of", $.PayloadFeatureMember)),
              opt(seq("from", $.FlowEndMember, "to", $.FlowEndMember)),
            ),
          ),
          $._DefinitionBody,
        ),
        symbol: usageAttrs("flow"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => sysmlEdgeGraphics({ label: "«succession flow»", stroke: "#01579b", strokeDasharray: "4 2" }),
      }),

    PayloadFeatureMember: ($) => field("ownedRelatedElement", $.PayloadFeature),

    PayloadFeature: ($) =>
      choice(
        seq(opt($._Identification), $._FeatureSpecializationPart, opt($._ValuePart)),
        seq(opt($._Identification), $._ValuePart),
        seq($.OwnedFeatureTyping, opt($.OwnedMultiplicity)),
        seq($.OwnedMultiplicity, $.OwnedFeatureTyping),
      ),

    FlowEndMember: ($) => field("ownedRelatedElement", $.FlowEnd),

    FlowEnd: ($) => seq(opt(seq($.OwnedReferenceSubsetting, ".")), field("ownedRelationship", $.FlowFeatureMember)),

    FlowFeatureMember: ($) => field("ownedRelatedElement", $.FlowFeature),

    FlowFeature: ($) =>
      ref({
        syntax: field("ownedRelationship", $.QualifiedName),
        name: (self) => self.ownedRelationship,
        targetKinds: ["Feature"],
        resolve: "qualified",
      }),

    // =====================================================================
    // ACTIONS
    // =====================================================================

    ActionDefinition: ($) =>
      def({
        syntax: seq(
          rep($._usage_modifier),
          "action",
          "def",
          opt($._Identification),
          opt($._SubclassificationPart),
          opt($._ParameterList),
          $._ActionBody,
        ),
        symbol: defAttrs("action"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        adapters: modelicaClassAdapter("function"),
        graphics: () => sysmlNodeGraphics({ stereotype: "action def", fill: "#e3f2fd", stroke: "#1565c0" }),
      }),

    _ActionBody: ($) => choice(";", seq("{", rep($._ActionBodyItem), "}")),

    _ActionBodyItem: ($) =>
      choice(
        $.Import,
        $.AliasMember,
        $.DefinitionMember,
        $.VariantUsageMember,
        $.NonOccurrenceUsageMember,
        seq(opt($.EmptySuccessionMember), $._OccurrenceUsageElement),
        $.ActionNodeMember,
        $.ReturnParameterMember,
      ),

    EmptySuccessionMember: ($) => seq("then", field("ownedRelatedElement", $.MultiplicitySourceEnd)),

    MultiplicitySourceEnd: ($) => field("ownedRelationship", $.OwnedMultiplicity),

    ActionNodeMember: ($) => seq(opt($.VisibilityIndicator), field("ownedRelatedElement", $._ActionNode)),

    _ActionNode: ($) =>
      choice(
        $.IfNode,
        $.WhileLoopNode,
        $.ForLoopNode,
        $.ControlNode,
        $.AcceptActionNode,
        $.SendActionNode,
        $.AssignActionNode,
      ),

    IfNode: ($) =>
      seq(
        rep($._usage_modifier),
        opt(seq("action", opt($._UsageDeclaration))),
        "if",
        field("condition", $.OwnedExpression),
        field("thenBody", $.ActionBodyParameter),
        opt(seq("else", choice(field("elseBody", $.ActionBodyParameter), $.IfNode))),
      ),

    ActionBodyParameter: ($) => seq(opt(seq("action", opt($._UsageDeclaration))), "{", rep($._ActionBodyItem), "}"),

    WhileLoopNode: ($) =>
      seq(
        rep($._usage_modifier),
        opt(seq("action", opt($._UsageDeclaration))),
        choice(seq("while", field("condition", $.OwnedExpression)), "loop"),
        $.ActionBodyParameter,
        opt(seq("until", field("untilCondition", $.OwnedExpression), ";")),
      ),

    ForLoopNode: ($) =>
      seq(
        rep($._usage_modifier),
        opt(seq("action", opt($._UsageDeclaration))),
        "for",
        field("variable", $.ForVariableDeclaration),
        "in",
        field("range", $.OwnedExpression),
        $.ActionBodyParameter,
      ),

    ForVariableDeclaration: ($) => $._UsageDeclaration,

    ControlNode: ($) => choice($.MergeNode, $.DecisionNode, $.JoinNode, $.ForkNode),

    MergeNode: ($) => seq(rep($._usage_modifier), "merge", opt($._UsageDeclaration), $._ActionBody),

    DecisionNode: ($) => seq(rep($._usage_modifier), "decide", opt($._UsageDeclaration), $._ActionBody),

    JoinNode: ($) => seq(rep($._usage_modifier), "join", opt($._UsageDeclaration), $._ActionBody),

    ForkNode: ($) => seq(rep($._usage_modifier), "fork", opt($._UsageDeclaration), $._ActionBody),

    ActionUsage: ($) =>
      def({
        syntax: seq(
          rep($._usage_modifier),
          "action",
          opt($._UsageDeclaration),
          opt($._ValuePart),
          opt($._ParameterList),
          $._ActionBody,
        ),
        symbol: usageAttrs("action"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => sysmlUsageGraphics({ stereotype: "action", fill: "#e3f2fd", stroke: "#1976d2" }),
      }),

    // -----------------------------------------------------------------
    // ACCEPT / SEND / ASSIGN action nodes
    // -----------------------------------------------------------------

    AcceptActionNode: ($) =>
      def({
        syntax: seq(
          rep($._usage_modifier),
          opt(seq("action", opt($._UsageDeclaration))),
          "accept",
          $.PayloadFeatureMember,
          opt(seq("via", $.OwnedReferenceSubsetting)),
          $._ActionBody,
        ),
        symbol: usageAttrs("action"),
        queries: usageQueries,
        model: usageModel,
      }),

    SendActionNode: ($) =>
      def({
        syntax: seq(
          rep($._usage_modifier),
          opt(seq("action", opt($._UsageDeclaration))),
          "send",
          field("sentItem", $.OwnedExpression),
          opt(seq("via", $.OwnedReferenceSubsetting)),
          opt(seq("to", field("receiver", $.OwnedExpression))),
          $._ActionBody,
        ),
        symbol: usageAttrs("action"),
        queries: usageQueries,
        model: usageModel,
      }),

    AssignActionNode: ($) =>
      def({
        syntax: seq(
          rep($._usage_modifier),
          opt(seq("action", opt($._UsageDeclaration))),
          "assign",
          field("assignedValue", $.OwnedExpression),
          "=:",
          field("targetFeature", $.OwnedExpression),
          $._ActionBody,
        ),
        symbol: usageAttrs("action"),
        queries: usageQueries,
        model: usageModel,
      }),

    PerformActionUsage: ($) =>
      def({
        syntax: seq(
          rep($._usage_modifier),
          "perform",
          choice(
            seq($.OwnedReferenceSubsetting, opt($._FeatureSpecializationPart)),
            seq("action", opt($._UsageDeclaration)),
          ),
          opt($._ValuePart),
          $._ActionBody,
        ),
        symbol: usageAttrs("action"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => sysmlUsageGraphics({ stereotype: "perform", fill: "#e3f2fd", stroke: "#0d47a1" }),
      }),

    // =====================================================================
    // CALCULATIONS
    // =====================================================================

    CalculationDefinition: ($) =>
      def({
        syntax: seq(
          rep($._usage_modifier),
          "calc",
          "def",
          opt($._Identification),
          opt($._SubclassificationPart),
          opt($._ParameterList),
          $._CalculationBody,
        ),
        symbol: defAttrs("calc"),
        queries: calculationQueries,
        model: calculationDefinitionModel,
        lints: definitionLints,
        adapters: modelicaClassAdapter("function"),
        graphics: () => sysmlNodeGraphics({ stereotype: "calc def", fill: "#e0f7fa", stroke: "#00838f" }),
      }),

    _CalculationBody: ($) =>
      choice(
        ";",
        seq("{", rep(choice($._ActionBodyItem, $.ReturnParameterMember)), opt($.ResultExpressionMember), "}"),
      ),

    _ParameterList: ($) => seq("(", opt(seq($.ParameterMember, rep(seq(",", $.ParameterMember)))), ")"),

    ParameterMember: ($) => seq(opt($.VisibilityIndicator), field("ownedRelatedElement", $._UsageElement)),

    ReturnParameterMember: ($) =>
      seq(opt($.VisibilityIndicator), "return", field("ownedRelatedElement", $._UsageElement)),

    ResultExpressionMember: ($) => seq(opt($.VisibilityIndicator), field("ownedRelatedElement", $.OwnedExpression)),

    CalculationUsage: ($) =>
      def({
        syntax: seq(
          rep($._usage_modifier),
          "calc",
          opt($._UsageDeclaration),
          opt($._ValuePart),
          opt($._ParameterList),
          $._CalculationBody,
        ),
        symbol: usageAttrs("calc"),
        queries: calculationUsageQueries,
        model: calculationUsageModel,
        lints: usageLints,
        graphics: () => sysmlUsageGraphics({ stereotype: "calc", fill: "#e0f7fa", stroke: "#006064" }),
      }),

    // =====================================================================
    // CONSTRAINTS
    // =====================================================================

    ConstraintDefinition: ($) =>
      def({
        syntax: seq(
          rep($._usage_modifier),
          "constraint",
          "def",
          opt($._Identification),
          opt($._SubclassificationPart),
          $._CalculationBody,
        ),
        symbol: defAttrs("constraint"),
        queries: constraintDefinitionQueries,
        model: constraintDefinitionModel,
        lints: constraintDefinitionLints,
        adapters: modelicaClassAdapter("model"),
        graphics: () => sysmlNodeGraphics({ stereotype: "constraint def", fill: "#ffebee", stroke: "#c62828" }),
      }),

    ConstraintUsage: ($) =>
      def({
        syntax: seq(
          rep($._usage_modifier),
          "constraint",
          opt($._UsageDeclaration),
          opt($._ValuePart),
          $._CalculationBody,
        ),
        symbol: usageAttrs("constraint"),
        queries: constraintUsageQueries,
        model: constraintUsageModel,
        graphics: () => sysmlUsageGraphics({ stereotype: "constraint", fill: "#ffebee", stroke: "#b71c1c" }),
        lints: constraintUsageLintRules,
      }),

    AssertConstraintUsage: ($) =>
      def({
        syntax: seq(
          rep($._usage_modifier),
          "assert",
          opt(field("isNegated", "not")),
          choice(
            seq($.OwnedReferenceSubsetting, opt($._FeatureSpecializationPart)),
            seq("constraint", opt($._UsageDeclaration), opt($._ValuePart)),
          ),
          $._CalculationBody,
        ),
        symbol: usageAttrs("constraint"),
        queries: constraintUsageQueries,
        model: constraintUsageModel,
        lints: constraintUsageLintRules,
      }),

    // =====================================================================
    // REQUIREMENTS
    // =====================================================================

    RequirementDefinition: ($) =>
      def({
        syntax: seq(
          rep($._usage_modifier),
          "requirement",
          "def",
          opt($._Identification),
          opt($._SubclassificationPart),
          $._RequirementBody,
        ),
        symbol: defAttrs("requirement"),
        queries: requirementQueries,
        model: requirementDefinitionModel,
        lints: {
          ...requirementDefinitionLintsEnhanced,
          evolutionCheck: (db, self, previous) => {
            if (previous) {
              const prevIsAbstract = (previous.metadata as Record<string, unknown>)?.isAbstract;
              const currIsAbstract = (self.metadata as Record<string, unknown>)?.isAbstract;
              if (currIsAbstract && !prevIsAbstract) {
                return error("Cannot make an existing concrete requirement abstract.", { field: "name" });
              }
            }
            return null;
          },
        },
        graphics: () =>
          sysmlNodeGraphics({
            stereotype: "requirement def",
            fill: "#f3e5f5",
            stroke: "#9c27b0",
            width: 200,
            height: 70,
          }),
        diff: {
          ignore: ["description", "text"], // Formatting of text is ignored, logical rules matter
          breaking: ["subject", "isAbstract"],
        },
      }),

    _RequirementBody: ($) => choice(";", seq("{", rep($._RequirementBodyItem), "}")),

    _RequirementBodyItem: ($) =>
      choice($._DefinitionBodyItem, $.SubjectMember, $.RequirementConstraintMember, $.ActorMember, $.StakeholderMember),

    SubjectMember: ($) => seq(opt($.VisibilityIndicator), field("ownedRelatedElement", $.SubjectUsage)),

    SubjectUsage: ($) =>
      def({
        syntax: seq("subject", rep($._usage_modifier), $._Usage),
        symbol: usageAttrs("subject"),
        model: usageModel,
        graphics: () => sysmlUsageGraphics({ stereotype: "subject", fill: "#f1f8e9", stroke: "#33691e" }),
      }),

    RequirementConstraintMember: ($) =>
      seq(
        opt($.VisibilityIndicator),
        field("constraintKind", choice("assume", "require")),
        field("ownedRelatedElement", $.RequirementConstraintUsage),
      ),

    RequirementConstraintUsage: ($) =>
      def({
        syntax: choice(
          seq($.OwnedReferenceSubsetting, rep($._FeatureSpecialization), $._CalculationBody),
          seq(
            rep($._usage_modifier),
            opt("constraint"),
            opt($._UsageDeclaration),
            opt($._ValuePart),
            $._CalculationBody,
          ),
        ),
        symbol: usageAttrs("constraint"),
        queries: constraintUsageQueries,
        model: constraintUsageModel,
      }),

    ActorMember: ($) => seq(opt($.VisibilityIndicator), field("ownedRelatedElement", $.ActorUsage)),

    ActorUsage: ($) =>
      def({
        syntax: seq("actor", rep($._usage_modifier), $._Usage),
        symbol: usageAttrs("actor"),
        model: usageModel,
        graphics: () => sysmlUsageGraphics({ stereotype: "actor", fill: "#fff3e0", stroke: "#e65100" }),
      }),

    StakeholderMember: ($) => seq(opt($.VisibilityIndicator), field("ownedRelatedElement", $.StakeholderUsage)),

    StakeholderUsage: ($) =>
      def({
        syntax: seq("stakeholder", rep($._usage_modifier), $._Usage),
        symbol: usageAttrs("stakeholder"),
        model: usageModel,
        graphics: () => sysmlUsageGraphics({ stereotype: "stakeholder", fill: "#fbe9e7", stroke: "#bf360c" }),
      }),

    RequirementUsage: ($) =>
      def({
        syntax: seq(
          rep($._usage_modifier),
          "requirement",
          opt($._UsageDeclaration),
          opt($._ValuePart),
          $._RequirementBody,
        ),
        symbol: usageAttrs("requirement"),
        queries: requirementUsageQueries,
        model: requirementUsageModel,
        lints: requirementUsageLintsEnhanced,
        graphics: () => sysmlUsageGraphics({ stereotype: "requirement", fill: "#f3e5f5", stroke: "#4a148c" }),
      }),

    SatisfyRequirementUsage: ($) =>
      def({
        syntax: seq(
          rep($._usage_modifier),
          opt("assert"),
          opt(field("isNegated", "not")),
          "satisfy",
          choice(
            seq($.OwnedReferenceSubsetting, opt($._FeatureSpecializationPart)),
            seq("requirement", opt($._UsageDeclaration)),
          ),
          opt($._ValuePart),
          opt(seq("by", field("satisfyingFeature", $.OwnedReferenceSubsetting))),
          $._RequirementBody,
        ),
        symbol: usageAttrs("requirement"),
        queries: satisfyRequirementQueries,
        model: satisfyRequirementModel,
        lints: satisfyRequirementLints,
        graphics: () => sysmlEdgeGraphics({ label: "«satisfy»", stroke: "#9c27b0", strokeDasharray: "8 4" }),
      }),

    // =====================================================================
    // CONCERNS
    // =====================================================================

    ConcernDefinition: ($) =>
      def({
        syntax: seq(
          rep($._usage_modifier),
          "concern",
          "def",
          opt($._Identification),
          opt($._SubclassificationPart),
          $._RequirementBody,
        ),
        symbol: defAttrs("concern"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "concern def", fill: "#fce4ec", stroke: "#ad1457" }),
      }),

    ConcernUsage: ($) =>
      def({
        syntax: seq(rep($._usage_modifier), "concern", opt($._UsageDeclaration), opt($._ValuePart), $._RequirementBody),
        symbol: usageAttrs("concern"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => sysmlUsageGraphics({ stereotype: "concern", fill: "#fce4ec", stroke: "#c2185b" }),
      }),

    // =====================================================================
    // CASES
    // =====================================================================

    CaseDefinition: ($) =>
      def({
        syntax: seq(
          rep($._usage_modifier),
          "case",
          "def",
          opt($._Identification),
          opt($._SubclassificationPart),
          $._CaseBody,
        ),
        symbol: defAttrs("case"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "case def", fill: "#ede7f6", stroke: "#4527a0" }),
      }),

    _CaseBody: ($) =>
      choice(
        ";",
        seq(
          "{",
          rep(choice($._ActionBodyItem, $.SubjectMember, $.ActorMember, $.StakeholderMember)),
          opt($.ResultExpressionMember),
          "}",
        ),
      ),

    CaseUsage: ($) =>
      def({
        syntax: seq(rep($._usage_modifier), "case", opt($._UsageDeclaration), opt($._ValuePart), $._CaseBody),
        symbol: usageAttrs("case"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => sysmlUsageGraphics({ stereotype: "case", fill: "#ede7f6", stroke: "#311b92" }),
      }),

    AnalysisCaseDefinition: ($) =>
      def({
        syntax: seq(
          rep($._usage_modifier),
          "analysis",
          "def",
          opt($._Identification),
          opt($._SubclassificationPart),
          $._CaseBody,
        ),
        symbol: defAttrs("analysisCase"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "analysis case def", fill: "#ede7f6", stroke: "#311b92" }),
      }),

    AnalysisCaseUsage: ($) =>
      def({
        syntax: seq(rep($._usage_modifier), "analysis", opt($._UsageDeclaration), opt($._ValuePart), $._CaseBody),
        symbol: usageAttrs("analysisCase"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => sysmlUsageGraphics({ stereotype: "analysis case", fill: "#ede7f6", stroke: "#512da8" }),
      }),

    VerificationCaseDefinition: ($) =>
      def({
        syntax: seq(
          rep($._usage_modifier),
          "verification",
          "def",
          opt($._Identification),
          opt($._SubclassificationPart),
          $._VerificationBody,
        ),
        symbol: defAttrs("verificationCase"),
        queries: verificationCaseQueries,
        model: verificationCaseDefinitionModel,
        lints: verificationCaseDefinitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "verification def", fill: "#e8eaf6", stroke: "#3f51b5" }),
      }),

    VerificationCaseUsage: ($) =>
      def({
        syntax: seq(
          rep($._usage_modifier),
          "verification",
          opt($._UsageDeclaration),
          opt($._ValuePart),
          $._VerificationBody,
        ),
        symbol: usageAttrs("verificationCase"),
        queries: verificationCaseUsageQueries,
        model: verificationCaseUsageModel,
        graphics: () => sysmlUsageGraphics({ stereotype: "verification case", fill: "#e8eaf6", stroke: "#1a237e" }),
        lints: verificationCaseUsageLints,
      }),

    _VerificationBody: ($) => choice(";", seq("{", rep($._VerificationBodyItem), opt($.ResultExpressionMember), "}")),

    _VerificationBodyItem: ($) => choice($._ActionBodyItem, $.VerifyRequirementUsageMember, $.ObjectiveMember),

    VerifyRequirementUsageMember: ($) =>
      seq(opt($.VisibilityIndicator), field("ownedRelatedElement", $.VerifyRequirementUsage)),

    VerifyRequirementUsage: ($) =>
      def({
        syntax: seq(
          rep($._usage_modifier),
          "verify",
          choice(
            seq($.OwnedReferenceSubsetting, opt($._FeatureSpecializationPart)),
            seq("requirement", opt($._UsageDeclaration)),
          ),
          opt($._ValuePart),
          $._RequirementBody,
        ),
        symbol: usageAttrs("verification"),
        queries: usageQueries,
        model: usageModel,
        lints: verifyRequirementLints,
        graphics: () => sysmlEdgeGraphics({ label: "«verify»", stroke: "#3f51b5", strokeDasharray: "4 4" }),
      }),

    ObjectiveMember: ($) => seq(opt($.VisibilityIndicator), field("ownedRelatedElement", $.ObjectiveRequirementUsage)),

    ObjectiveRequirementUsage: ($) =>
      def({
        syntax: seq("objective", rep($._usage_modifier), $._RequirementBody),
        symbol: usageAttrs("objective"),
        model: usageModel,
      }),

    UseCaseDefinition: ($) =>
      def({
        syntax: seq(
          rep($._usage_modifier),
          "use",
          "case",
          "def",
          opt($._Identification),
          opt($._SubclassificationPart),
          $._CaseBody,
        ),
        symbol: defAttrs("useCase"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "use case def", fill: "#fce4ec", stroke: "#880e4f" }),
      }),

    UseCaseUsage: ($) =>
      def({
        syntax: seq(rep($._usage_modifier), "use", "case", opt($._UsageDeclaration), opt($._ValuePart), $._CaseBody),
        symbol: usageAttrs("useCase"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => sysmlUsageGraphics({ stereotype: "use case", fill: "#fce4ec", stroke: "#c2185b" }),
      }),

    IncludeUseCaseUsage: ($) =>
      def({
        syntax: seq(
          rep($._usage_modifier),
          "include",
          choice(
            seq($.OwnedReferenceSubsetting, opt($._FeatureSpecializationPart)),
            seq("use", "case", opt($._UsageDeclaration)),
          ),
          opt($._ValuePart),
          $._CaseBody,
        ),
        symbol: usageAttrs("useCase"),
        queries: usageQueries,
        model: usageModel,
      }),

    // =====================================================================
    // STATES
    // =====================================================================

    StateDefinition: ($) =>
      def({
        syntax: seq(
          rep($._usage_modifier),
          "state",
          "def",
          opt($._Identification),
          opt($._SubclassificationPart),
          choice(";", seq(opt(field("isParallel", "parallel")), "{", rep($._StateBodyItem), "}")),
        ),
        symbol: (self: any) => ({
          kind: "Definition" as const,
          name: self.declaredName,
          exports: [self.declaredName],
          attributes: {
            isAbstract: self.isAbstract,
            isVariation: self.isVariation,
            isParallel: self.isParallel,
          },
        }),
        queries: stateQueries,
        model: stateDefinitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "state def", fill: "#fff8e1", stroke: "#f9a825" }),
      }),

    _StateBodyItem: ($) =>
      choice(
        $.Import,
        $.AliasMember,
        $.DefinitionMember,
        $.VariantUsageMember,
        $.NonOccurrenceUsageMember,
        seq(opt($.EmptySuccessionMember), $._OccurrenceUsageElement),
        $.TransitionUsageMember,
        $.EntryActionMember,
        $.DoActionMember,
        $.ExitActionMember,
      ),

    EntryActionMember: ($) =>
      seq(opt($.VisibilityIndicator), "entry", field("ownedRelatedElement", $.StateActionUsage)),

    DoActionMember: ($) => seq(opt($.VisibilityIndicator), "do", field("ownedRelatedElement", $.StateActionUsage)),

    ExitActionMember: ($) => seq(opt($.VisibilityIndicator), "exit", field("ownedRelatedElement", $.StateActionUsage)),

    StateActionUsage: ($) => choice(";", seq(opt($._UsageDeclaration), opt($._ValuePart), $._ActionBody)),

    StateUsage: ($) =>
      def({
        syntax: seq(
          rep($._usage_modifier),
          "state",
          opt($._UsageDeclaration),
          opt($._ValuePart),
          choice(";", seq(opt(field("isParallel", "parallel")), "{", rep($._StateBodyItem), "}")),
        ),
        symbol: (self: any) => ({
          kind: "Usage" as const,
          name: self.declaredName,
          attributes: {
            ...usageAttrs("state")(self).attributes,
            isParallel: self.isParallel,
          },
        }),
        queries: { ...usageQueries, ...stateQueries },
        model: stateUsageModel,
        lints: usageLints,
        graphics: () => sysmlUsageGraphics({ stereotype: "state", fill: "#fff8e1", stroke: "#fbc02d" }),
      }),

    ExhibitStateUsage: ($) =>
      def({
        syntax: seq(
          rep($._usage_modifier),
          "exhibit",
          choice(
            seq($.OwnedReferenceSubsetting, opt($._FeatureSpecializationPart)),
            seq("state", opt($._UsageDeclaration)),
          ),
          opt($._ValuePart),
          choice(";", seq(opt(field("isParallel", "parallel")), "{", rep($._StateBodyItem), "}")),
        ),
        symbol: (self: any) => ({
          kind: "Usage" as const,
          name: self.declaredName,
          attributes: {
            ...usageAttrs("state")(self).attributes,
            isParallel: self.isParallel,
          },
          graphics: () => sysmlUsageGraphics({ stereotype: "exhibit", fill: "#fff8e1", stroke: "#ff8f00" }),
        }),
        queries: { ...usageQueries, ...stateQueries },
        model: stateUsageModel,
        lints: usageLints,
      }),

    TransitionUsageMember: ($) => seq(opt($.VisibilityIndicator), field("ownedRelatedElement", $.TransitionUsage)),

    TransitionUsage: ($) =>
      def({
        syntax: seq(
          "transition",
          opt(seq(opt($._UsageDeclaration), "first")),
          ref({
            syntax: field("source", $.QualifiedName),
            name: (self) => self.source,
            targetKinds: ["Feature"],
            resolve: "qualified",
          }),
          opt(seq("accept", $.PayloadFeatureMember)),
          opt(seq("if", field("guard", $.OwnedExpression))),
          opt(seq("do", field("effect", $.StateActionUsage))),
          "then",
          $.ConnectorEndMember,
          $._ActionBody,
        ),
        symbol: usageAttrs("transition"),
        queries: usageQueries,
        model: usageModel,
      }),

    // =====================================================================
    // VIEWS
    // =====================================================================

    ViewDefinition: ($) =>
      def({
        syntax: seq(
          rep($._usage_modifier),
          "view",
          "def",
          opt($._Identification),
          opt($._SubclassificationPart),
          choice(";", seq("{", rep(choice($._DefinitionBodyItem, $.ElementFilterMember)), "}")),
        ),
        symbol: defAttrs("view"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "view def", fill: "#efebe9", stroke: "#4e342e" }),
      }),

    ViewUsage: ($) =>
      def({
        syntax: seq(
          rep($._usage_modifier),
          "view",
          opt($._UsageDeclaration),
          opt($._ValuePart),
          choice(";", seq("{", rep(choice($._DefinitionBodyItem, $.ElementFilterMember)), "}")),
        ),
        symbol: usageAttrs("view"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => sysmlUsageGraphics({ stereotype: "view", fill: "#efebe9", stroke: "#6d4c41" }),
      }),

    ViewpointDefinition: ($) =>
      def({
        syntax: seq(
          rep($._usage_modifier),
          "viewpoint",
          "def",
          opt($._Identification),
          opt($._SubclassificationPart),
          $._RequirementBody,
        ),
        symbol: defAttrs("viewpoint"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "viewpoint def", fill: "#efebe9", stroke: "#3e2723" }),
      }),

    ViewpointUsage: ($) =>
      def({
        syntax: seq(
          rep($._usage_modifier),
          "viewpoint",
          opt($._UsageDeclaration),
          opt($._ValuePart),
          $._RequirementBody,
        ),
        symbol: usageAttrs("viewpoint"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => sysmlUsageGraphics({ stereotype: "viewpoint", fill: "#efebe9", stroke: "#5d4037" }),
      }),

    // =====================================================================
    // RENDERINGS
    // =====================================================================

    RenderingDefinition: ($) =>
      def({
        syntax: seq(rep($._usage_modifier), "rendering", "def", $._Definition),
        symbol: defAttrs("rendering"),
        queries: definitionStructuralQueries,
        model: definitionModel,
        lints: definitionLints,
        graphics: () => sysmlNodeGraphics({ stereotype: "rendering def", fill: "#fafafa", stroke: "#424242" }),
      }),

    RenderingUsage: ($) =>
      def({
        syntax: seq(rep($._usage_modifier), "rendering", $._Usage),
        symbol: usageAttrs("rendering"),
        queries: usageQueries,
        model: usageModel,
        lints: usageLints,
        graphics: () => sysmlUsageGraphics({ stereotype: "rendering", fill: "#fafafa", stroke: "#616161" }),
      }),

    // =====================================================================
    // EXPRESSIONS (copied from KerML Expressions, flattened)
    // =====================================================================

    OwnedExpressionMember: ($) => field("ownedRelatedElement", $.OwnedExpression),

    OwnedExpression: ($) => $._Expression,

    _Expression: ($) =>
      choice(
        $.ConditionalExpression,
        $.NullCoalescingExpression,
        $.ImpliesExpression,
        $.OrExpression,
        $.XorExpression,
        $.AndExpression,
        $.EqualityExpression,
        $.ClassificationExpression,
        $.RelationalExpression,
        $.RangeExpression,
        $.AdditiveExpression,
        $.MultiplicativeExpression,
        $.ExponentiationExpression,
        $.UnaryExpression,
        $.ExtentExpression,
        $.PrimaryExpression,
        $._BaseExpression,
      ),

    OwnedExpressionReference: ($) => field("ownedRelationship", $.OwnedExpressionMember),

    ConditionalExpression: ($) =>
      prec.right(
        PREC.CONDITIONAL,
        seq(
          field("operator", "if"),
          field("operand", $._Expression),
          "?",
          field("thenOperand", $.OwnedExpressionReference),
          "else",
          field("elseOperand", $.OwnedExpressionReference),
        ),
      ),

    NullCoalescingExpression: ($) =>
      prec.left(
        PREC.NULL_COALESCING,
        seq(
          field("operand", $._Expression),
          rep1(seq(field("operator", "??"), field("operand", $.ImpliesExpressionReference))),
        ),
      ),

    ImpliesExpressionReference: ($) => field("ownedRelationship", $.ImpliesExpressionMember),
    ImpliesExpressionMember: ($) => field("ownedRelatedElement", $._Expression),

    ImpliesExpression: ($) =>
      prec.left(
        PREC.IMPLIES,
        seq(
          field("operand", $._Expression),
          rep1(seq(field("operator", "implies"), field("operand", $.ImpliesExpressionReference))),
        ),
      ),

    OrExpressionReference: ($) => field("ownedRelationship", $.OrExpressionMember),
    OrExpressionMember: ($) => field("ownedRelatedElement", $._Expression),

    OrExpression: ($) =>
      prec.left(
        PREC.OR,
        seq(
          field("operand", $._Expression),
          rep1(
            choice(
              seq(field("operator", "|"), field("operand", $._Expression)),
              seq(field("operator", "or"), field("operand", $.XorExpressionReference)),
            ),
          ),
        ),
      ),

    XorExpressionReference: ($) => field("ownedRelationship", $.XorExpressionMember),
    XorExpressionMember: ($) => field("ownedRelatedElement", $._Expression),

    XorExpression: ($) =>
      prec.left(
        PREC.XOR,
        seq(field("operand", $._Expression), rep1(seq(field("operator", "xor"), field("operand", $._Expression)))),
      ),

    AndExpression: ($) =>
      prec.left(
        PREC.AND,
        seq(
          field("operand", $._Expression),
          rep1(
            choice(
              seq(field("operator", "&"), field("operand", $._Expression)),
              seq(field("operator", "and"), field("operand", $.EqualityExpressionReference)),
            ),
          ),
        ),
      ),

    EqualityExpressionReference: ($) => field("ownedRelationship", $.EqualityExpressionMember),
    EqualityExpressionMember: ($) => field("ownedRelatedElement", $._Expression),

    EqualityExpression: ($) =>
      prec.left(
        PREC.EQUALITY,
        seq(
          field("operand", $._Expression),
          rep1(seq(field("operator", $.EqualityOperator), field("operand", $._Expression))),
        ),
      ),

    EqualityOperator: () => choice("==", "!=", "===", "!=="),

    ClassificationExpression: ($) =>
      prec(
        PREC.CLASSIFICATION,
        choice(
          seq(
            field("operand", $._Expression),
            choice(
              seq(field("operator", $.ClassificationTestOperator), field("typeReference", $.TypeReferenceMember)),
              seq(field("operator", $.CastOperator), field("typeResult", $.TypeResultMember)),
            ),
          ),
          seq(field("operator", $.ClassificationTestOperator), field("typeReference", $.TypeReferenceMember)),
          seq(
            field("operand", $.MetadataReference),
            field("operator", $.MetaClassificationTestOperator),
            field("typeReference", $.TypeReferenceMember),
          ),
          seq(field("operator", $.CastOperator), field("typeResult", $.TypeResultMember)),
          seq(
            field("operand", $.MetadataReference),
            field("operator", $.MetaCastOperator),
            field("typeResult", $.TypeResultMember),
          ),
        ),
      ),

    ClassificationTestOperator: () => choice("hastype", "istype", "@"),
    MetaClassificationTestOperator: () => "@@",
    CastOperator: () => "as",
    MetaCastOperator: () => "meta",

    MetadataReference: ($) => field("ownedRelationship", $.ElementReferenceMember),

    TypeReferenceMember: ($) => field("ownedRelatedElement", $.TypeReference),
    TypeResultMember: ($) => field("ownedRelatedElement", $.TypeReference),
    TypeReference: ($) => field("ownedRelationship", $.ReferenceTyping),

    ReferenceTyping: ($) =>
      ref({
        syntax: field("type", $.QualifiedName),
        name: (self) => self.type,
        targetKinds: ["Type"],
        resolve: "qualified",
      }),

    RelationalExpression: ($) =>
      prec.left(
        PREC.RELATIONAL,
        seq(
          field("operand", $._Expression),
          rep1(seq(field("operator", $.RelationalOperator), field("operand", $._Expression))),
        ),
      ),
    RelationalOperator: () => choice("<", ">", "<=", ">="),

    RangeExpression: ($) =>
      prec.left(
        PREC.RANGE,
        seq(field("operand", $._Expression), field("operator", ".."), field("operand", $._Expression)),
      ),

    AdditiveExpression: ($) =>
      prec.left(
        PREC.ADDITIVE,
        seq(
          field("operand", $._Expression),
          rep1(seq(field("operator", $.AdditiveOperator), field("operand", $._Expression))),
        ),
      ),
    AdditiveOperator: () => choice("+", "-"),

    MultiplicativeExpression: ($) =>
      prec.left(
        PREC.MULTIPLICATIVE,
        seq(
          field("operand", $._Expression),
          rep1(seq(field("operator", $.MultiplicativeOperator), field("operand", $._Expression))),
        ),
      ),
    MultiplicativeOperator: () => choice("*", "/", "%"),

    ExponentiationExpression: ($) =>
      prec.right(
        PREC.EXPONENTIATION,
        seq(
          field("operand", $._Expression),
          field("operator", $.ExponentiationOperator),
          field("operand", $._Expression),
        ),
      ),
    ExponentiationOperator: () => choice("**", "^"),

    UnaryExpression: ($) => prec(PREC.UNARY, seq(field("operator", $.UnaryOperator), field("operand", $._Expression))),
    UnaryOperator: () => choice("+", "-", "~", "not"),

    ExtentExpression: ($) => prec(PREC.EXTENT, seq(field("operator", "all"), field("typeResult", $.TypeResultMember))),

    _postfix_operation: ($) =>
      seq(
        choice(
          seq("#", "(", field("indexOperand", $.SequenceExpression), ")"),
          seq(field("operator", "["), field("filterOperand", $.SequenceExpression), "]"),
          seq(
            "->",
            field("invocationType", $.InstantiatedTypeMember),
            choice(
              field("body", $.BodyExpression),
              field("functionRef", $.FunctionReferenceExpression),
              $._ArgumentList,
            ),
          ),
          seq(".", field("collect", $.BodyExpression)),
          seq(".?", field("select", $.BodyExpression)),
        ),
        opt(seq(".", field("featureChain", $.FeatureChainMember))),
      ),

    PrimaryExpression: ($) =>
      prec.left(
        PREC.PRIMARY,
        choice(
          seq(
            field("base", $._BaseExpression),
            seq(".", field("featureChain", $.FeatureChainMember)),
            rep($._postfix_operation),
          ),
          seq(field("base", $._BaseExpression), rep1($._postfix_operation)),
        ),
      ),

    FunctionReferenceExpression: ($) => field("ownedRelationship", $.FunctionReferenceMember),
    FunctionReferenceMember: ($) => field("ownedRelatedElement", $.FunctionReference),
    FunctionReference: ($) => field("ownedRelationship", $.ReferenceTyping),

    FeatureChainMember: ($) =>
      choice(
        ref({
          syntax: field("memberElement", $.QualifiedName),
          name: (self) => self.memberElement,
          targetKinds: ["Feature"],
          resolve: "qualified",
        }),
        field("ownedRelatedElement", $.OwnedFeatureChain),
      ),

    OwnedFeatureChain: ($) => $._FeatureChain,

    _BaseExpression: ($) =>
      choice(
        $.NullExpression,
        $._LiteralExpression,
        $.FeatureReferenceExpression,
        $.MetadataAccessExpression,
        $.InvocationExpression,
        $.ConstructorExpression,
        $.BodyExpression,
        seq("(", $.SequenceExpression, ")"),
      ),

    // SysML2 overrides ExpressionBody to use CalculationBody
    BodyExpression: ($) => field("ownedRelationship", $.ExpressionBodyMember),
    ExpressionBodyMember: ($) => field("ownedRelatedElement", $.ExpressionBody),
    ExpressionBody: ($) => $._CalculationBody,

    SequenceExpression: ($) =>
      seq($.OwnedExpression, opt(choice(",", seq(field("operator", ","), field("operand", $.SequenceExpression))))),

    FeatureReferenceExpression: ($) => field("ownedRelationship", $.FeatureReferenceMember),
    FeatureReferenceMember: ($) =>
      ref({
        syntax: field("memberElement", $.QualifiedName),
        name: (self) => self.memberElement,
        targetKinds: ["Feature"],
        resolve: "qualified",
      }),

    MetadataAccessExpression: ($) => seq(field("ownedRelationship", $.ElementReferenceMember), ".", "metadata"),
    ElementReferenceMember: ($) =>
      ref({
        syntax: field("memberElement", $.QualifiedName),
        name: (self) => self.memberElement,
        targetKinds: ["Element"],
        resolve: "qualified",
      }),

    InvocationExpression: ($) => seq(field("type", $.InstantiatedTypeMember), $._ArgumentList),
    ConstructorExpression: ($) =>
      seq("new", field("type", $.InstantiatedTypeMember), field("result", $.ConstructorResultMember)),
    ConstructorResultMember: ($) => field("ownedRelatedElement", $.ConstructorResult),
    ConstructorResult: ($) => $._ArgumentList,

    InstantiatedTypeMember: ($) =>
      choice(
        ref({
          syntax: field("memberElement", $.QualifiedName),
          name: (self) => self.memberElement,
          targetKinds: ["Type"],
          resolve: "qualified",
        }),
        field("ownedRelatedElement", $.OwnedFeatureChain),
      ),

    _FeatureChain: ($) =>
      seq(field("chaining", $.OwnedFeatureChaining), rep1(seq(".", field("chaining", $.OwnedFeatureChaining)))),

    OwnedFeatureChaining: ($) =>
      ref({
        syntax: field("chainingFeature", $.QualifiedName),
        name: (self) => self.chainingFeature,
        targetKinds: ["Feature"],
        resolve: "qualified",
      }),

    _ArgumentList: ($) => seq("(", opt(choice($._PositionalArgumentList, $._NamedArgumentList)), ")"),

    _PositionalArgumentList: ($) =>
      seq(field("argument", $.ArgumentMember), rep(seq(",", field("argument", $.ArgumentMember)))),

    ArgumentMember: ($) => field("ownedRelatedElement", $.Argument),
    Argument: ($) => field("ownedRelationship", $.ArgumentValue),

    _NamedArgumentList: ($) =>
      seq(field("namedArgument", $.NamedArgumentMember), rep(seq(",", field("namedArgument", $.NamedArgumentMember)))),

    NamedArgumentMember: ($) => field("ownedRelatedElement", $.NamedArgument),
    NamedArgument: ($) =>
      seq(field("parameterRedefinition", $.ParameterRedefinition), "=", field("value", $.ArgumentValue)),

    ParameterRedefinition: ($) =>
      ref({
        syntax: field("redefinedFeature", $.QualifiedName),
        name: (self) => self.redefinedFeature,
        targetKinds: ["Feature"],
        resolve: "qualified",
      }),

    ArgumentValue: ($) => field("ownedRelatedElement", $.OwnedExpression),

    NullExpression: () => choice("null", seq("(", ")")),

    _LiteralExpression: ($) =>
      choice($.LiteralBoolean, $.LiteralString, $.LiteralInteger, $.LiteralReal, $.LiteralInfinity),

    LiteralBoolean: ($) => field("value", $.BooleanValue),
    BooleanValue: () => choice("true", "false"),
    LiteralString: ($) => field("value", $.STRING_VALUE),
    LiteralInteger: ($) => field("value", $.DECIMAL_VALUE),
    LiteralReal: ($) => field("value", $.RealValue),
    RealValue: ($) => choice(seq(opt($.DECIMAL_VALUE), ".", choice($.DECIMAL_VALUE, $.EXP_VALUE)), $.EXP_VALUE),
    LiteralInfinity: () => "*",

    // =====================================================================
    // NAMES
    // =====================================================================

    Name: ($) => choice($.ID, $.UNRESTRICTED_NAME),
    GlobalQualification: () => seq("$", "::"),
    Qualification: ($) => rep1(seq($.Name, "::")),
    QualifiedName: ($) => seq(opt($.GlobalQualification), opt($.Qualification), field("name", $.Name)),

    // =====================================================================
    // TERMINALS
    // =====================================================================

    DECIMAL_VALUE: () => token(/[0-9]+/),

    EXP_VALUE: () => token(seq(/[0-9]+/, choice("e", "E"), opt(choice("+", "-")), /[0-9]+/)),

    ID: () => token(seq(/[a-zA-Z_]/, rep(/[a-zA-Z_0-9]/))),

    UNRESTRICTED_NAME: () =>
      token(seq("'", rep(choice(seq("\\", choice("b", "t", "n", "f", "r", '"', "'", "\\")), /[^'\\]/)), "'")),

    STRING_VALUE: () =>
      token(seq('"', rep(choice(seq("\\", choice("b", "t", "n", "f", "r", '"', "'", "\\")), /[^"\\]/)), '"')),

    REGULAR_COMMENT: () => token(seq("/*", /[^*]*\*+([^/*][^*]*\*+)*/, "/")),
    ML_NOTE: () => token(seq("//*", /[^*]*\*+([^/*][^*]*\*+)*/, "/")),
    SL_NOTE: () => token(seq("//", /[^\r\n]*/)),
  },
});
