import type { CodeGraph, u16, u32, u8 } from "@modelscript/language";

export const TYPE_UNKNOWN: u16 = 0xffff;
export const TYPE_REAL: u16 = 0;
export const TYPE_INTEGER: u16 = 1;
export const TYPE_BOOLEAN: u16 = 2;
export const TYPE_STRING: u16 = 3;
export const TYPE_ENUM: u16 = 4;
export const TYPE_CLOCK: u16 = 5;

export const VARIABILITY_CONTINUOUS: u8 = 0;
export const VARIABILITY_DISCRETE: u8 = 1;
export const VARIABILITY_PARAMETER: u8 = 2;
export const VARIABILITY_CONSTANT: u8 = 3;

/**
 * Resolves a complex dot-separated name (e.g. `a.b.c` or single identifier `x`)
 * to a target symbol or AST declaration pointer.
 */
export function resolveComplexName(db: CodeGraph, nameNode: u32, $: Record<string, u16>): u32 {
  if (nameNode == 0) return 0;
  const nodeType = db.ast.getType(nameNode);

  if (nodeType == $.identifier) {
    return db.scope.resolve(nameNode);
  }

  const firstChild = db.ast.getFirstChild(nameNode);
  if (firstChild == 0) return 0;

  let currentScope = db.scope.resolve(firstChild);
  if (currentScope == 0) return 0;

  let nextSegment = db.ast.getNextSibling(firstChild);
  while (nextSegment != 0) {
    const span = db.ast.getTextSpan(nextSegment);
    const memberHash = db.ast.hashSpan(span);
    currentScope = db.model.resolveHash(currentScope, memberHash);
    if (currentScope == 0) return 0;
    nextSegment = db.ast.getNextSibling(nextSegment);
  }

  return currentScope;
}

/**
 * Infers the basic variable type of an AST expression node.
 */
export function inferExprType(db: CodeGraph, exprNode: u32, $: Record<string, u16>): u16 {
  if (exprNode == 0) return TYPE_UNKNOWN;
  const nodeType = db.ast.getType(exprNode);

  if (nodeType == $.unsigned_real) return TYPE_REAL;
  if (nodeType == $.unsigned_integer) return TYPE_INTEGER;
  if (nodeType == $.string_literal) return TYPE_STRING;

  if (db.ast.textEquals(exprNode, "true") || db.ast.textEquals(exprNode, "false")) {
    return TYPE_BOOLEAN;
  }

  // Check descendants for literals if wrapped in modification_expression / expression
  for (const lit of db.ast.getDescendants(exprNode, $.string_literal)) {
    if (lit != 0) return TYPE_STRING;
  }
  for (const lit of db.ast.getDescendants(exprNode, $.unsigned_real)) {
    if (lit != 0) return TYPE_REAL;
  }
  for (const lit of db.ast.getDescendants(exprNode, $.unsigned_integer)) {
    if (lit != 0) return TYPE_INTEGER;
  }

  // Identifier / component reference
  if (nodeType == $.identifier || nodeType == $.name || nodeType == $.component_reference) {
    const symId = resolveComplexName(db, exprNode, $);
    if (symId != 0) {
      return db.model.getProperty(symId, "baseType") as u16;
    }
  }

  // Clock constructor -> Clock
  if (nodeType == $.function_call_args || nodeType == $.primary) {
    const funcName = db.ast.getChildByFieldId(exprNode, "name");
    if (funcName != 0 && db.ast.textEquals(funcName, "Clock")) {
      return TYPE_CLOCK;
    }
  }

  return TYPE_UNKNOWN;
}

/**
 * Checks whether an actual type is compatible with (or a subtype of) an expected type.
 */
export function isTypeCompatible(actualType: u16, expectedType: u16): boolean {
  if (actualType == expectedType) return true;
  // Integer coerces to Real
  if (actualType == TYPE_INTEGER && expectedType == TYPE_REAL) return true;
  return false;
}

/**
 * Determines the variability of an expression.
 */
export function getExpressionVariability(db: CodeGraph, exprNode: u32, $: Record<string, u16>): u8 {
  if (exprNode == 0) return VARIABILITY_CONSTANT;

  // Check if expression directly references `time` -> Continuous
  for (const ident of db.ast.getDescendants(exprNode, $.identifier)) {
    if (db.ast.textEquals(ident, "time")) {
      return VARIABILITY_CONTINUOUS;
    }
  }

  return VARIABILITY_CONSTANT;
}

/**
 * Fast $O(1)$ check for class kind (e.g. "function", "record", "connector", "model", "block", "package").
 * Inspects immediate class prefix children rather than walking all descendants of the class.
 */
export function isClassKind(db: CodeGraph, clsNode: u32, kind: string): boolean {
  if (clsNode == 0) return false;
  if (db.ast.startsWith(clsNode, kind)) return true;
  let ch = db.ast.getFirstChild(clsNode);
  while (ch != 0) {
    if (db.ast.startsWith(ch, kind) || db.ast.textEquals(ch, kind)) return true;
    let sub = db.ast.getFirstChild(ch);
    while (sub != 0) {
      if (db.ast.startsWith(sub, kind) || db.ast.textEquals(sub, kind)) return true;
      let leaf = db.ast.getFirstChild(sub);
      while (leaf != 0) {
        if (db.ast.startsWith(leaf, kind) || db.ast.textEquals(leaf, kind)) return true;
        let leafSub = db.ast.getFirstChild(leaf);
        while (leafSub != 0) {
          if (db.ast.startsWith(leafSub, kind) || db.ast.textEquals(leafSub, kind)) return true;
          leafSub = db.ast.getNextSibling(leafSub);
        }
        leaf = db.ast.getNextSibling(leaf);
      }
      sub = db.ast.getNextSibling(sub);
    }
    ch = db.ast.getNextSibling(ch);
  }
  return false;
}

/**
 * Fast check for whether a component_clause has a specific type prefix (e.g. "constant", "input", "output", "flow", "stream").
 */
export function hasTypePrefix(db: CodeGraph, compClauseNode: u32, prefix: string): boolean {
  if (compClauseNode == 0) return false;
  let pfx = db.ast.getChildByFieldId(compClauseNode, "type_prefix");
  if (pfx == 0) pfx = db.ast.getChildByFieldId(compClauseNode, "typePrefix");
  if (pfx != 0) {
    if (db.ast.startsWith(pfx, prefix) || db.ast.textEquals(pfx, prefix)) return true;
    let ch = db.ast.getFirstChild(pfx);
    while (ch != 0) {
      if (db.ast.startsWith(ch, prefix) || db.ast.textEquals(ch, prefix)) return true;
      ch = db.ast.getNextSibling(ch);
    }
  }
  return false;
}

/**
 * Resolves a single component identifier (e.g. `p1` inside `model X`) to its class definition in the document.
 */
export function resolveComponentClassDefinition(
  db: CodeGraph,
  enclosingClass: u32,
  compRefNode: u32,
  $: Record<string, u16>,
): u32 {
  if (enclosingClass == 0 || compRefNode == 0) return 0;
  const docRoot = db.ast.getRootNode();
  if (docRoot == 0) return 0;

  // 1. Direct declarations in enclosingClass (ignoring inner classes)
  let typeSpecNode: u32 = 0;
  for (const comp of db.ast.getDescendants(enclosingClass, $.component_clause)) {
    if (isDescendantOfInnerClass(db, comp, enclosingClass, $)) continue;
    let matchesComp = false;
    for (const decl of db.ast.getDescendants(comp, $.declaration)) {
      for (const id of db.ast.getDescendants(decl, $.identifier)) {
        if (db.ast.textEqualsNode(compRefNode, id)) {
          matchesComp = true;
          break;
        }
      }
      if (matchesComp) break;
    }
    if (matchesComp) {
      for (const ts of db.ast.getDescendants(comp, $.type_specifier)) {
        typeSpecNode = ts;
        break;
      }
      break;
    }
  }

  // 2. Inherited declarations in enclosingClass via extends_clause
  if (typeSpecNode == 0) {
    for (const ext of db.ast.getDescendants(enclosingClass, $.extends_clause)) {
      if (isDescendantOfInnerClass(db, ext, enclosingClass, $)) continue;
      let extTypeSpec = db.ast.getChildByFieldId(ext, "type_specifier");
      if (extTypeSpec == 0) extTypeSpec = db.ast.getFirstChild(ext);
      if (extTypeSpec == 0) continue;

      let baseNameId: u32 = extTypeSpec;
      for (const id of db.ast.getDescendants(extTypeSpec, $.identifier)) {
        baseNameId = id;
        break;
      }

      for (const spec of db.ast.getDescendants(docRoot, $.long_class_specifier)) {
        const nameId = db.ast.getChildByFieldId(spec, "name");
        if (nameId != 0 && db.ast.textEqualsNode(baseNameId, nameId)) {
          let baseClass: u32 = spec;
          for (const anc of db.ast.getAncestors(spec, 0)) {
            if (db.ast.getType(anc) == $.class_definition) {
              baseClass = anc;
              break;
            }
          }
          const resolved = resolveComponentClassDefinition(db, baseClass, compRefNode, $);
          if (resolved != 0) return resolved;
          break;
        }
      }
    }
  }

  if (typeSpecNode == 0) return 0;

  // 3. Find class_definition in document matching typeSpecNode
  for (const spec of db.ast.getDescendants(docRoot, $.long_class_specifier)) {
    const nameId = db.ast.getChildByFieldId(spec, "name");
    if (nameId != 0) {
      for (const tsId of db.ast.getDescendants(typeSpecNode, $.identifier)) {
        if (db.ast.textEqualsNode(tsId, nameId)) {
          for (const cls of db.ast.getAncestors(spec, 0)) {
            if (db.ast.getType(cls) == $.class_definition) return cls;
          }
        }
        break;
      }
    }
  }
  for (const spec of db.ast.getDescendants(docRoot, $.short_class_specifier)) {
    const nameId = db.ast.getChildByFieldId(spec, "name");
    if (nameId != 0) {
      for (const tsId of db.ast.getDescendants(typeSpecNode, $.identifier)) {
        if (db.ast.textEqualsNode(tsId, nameId)) {
          for (const cls of db.ast.getAncestors(spec, 0)) {
            if (db.ast.getType(cls) == $.class_definition) return cls;
          }
        }
        break;
      }
    }
  }
  return 0;
}

/**
 * Resolves a potentially dotted component reference (e.g. `x.p1`) starting from `enclosingClass`
 * down to its leaf class definition (e.g. `Pin1`).
 */
export function resolveDottedComponentClass(
  db: CodeGraph,
  enclosingClass: u32,
  compRefNode: u32,
  $: Record<string, u16>,
): u32 {
  if (enclosingClass == 0 || compRefNode == 0) return 0;

  let currClass = enclosingClass;
  for (const id of db.ast.getDescendants(compRefNode, $.identifier)) {
    const nextClass = resolveComponentClassDefinition(db, currClass, id, $);
    if (nextClass == 0) return 0;
    currClass = nextClass;
  }

  return currClass != enclosingClass ? currClass : 0;
}

/**
 * Checks if a potentially dotted variable reference (e.g. `x` or `x.error` or `x.p1`)
 * is declared across the class hierarchy.
 */
export function isDottedVariableDeclared(
  db: CodeGraph,
  enclosingClass: u32,
  compRefNode: u32,
  $: Record<string, u16>,
): boolean {
  if (enclosingClass == 0 || compRefNode == 0) return false;

  let idCount: u32 = 0;
  for (const id of db.ast.getDescendants(compRefNode, $.identifier)) {
    if (id != 0) idCount++;
  }
  if (idCount == 0) return isVariableDeclaredInClass(db, enclosingClass, compRefNode, $);

  if (idCount == 1) {
    for (const id of db.ast.getDescendants(compRefNode, $.identifier)) {
      return isVariableDeclaredInClass(db, enclosingClass, id, $);
    }
  }

  // Multi-segment reference (e.g. `x.error` or `x.p1.v`)
  let currClass = enclosingClass;
  let idx: u32 = 0;
  for (const id of db.ast.getDescendants(compRefNode, $.identifier)) {
    if (idx == idCount - 1) {
      // Leaf segment: check declaration in currClass
      return isVariableDeclaredInClass(db, currClass, id, $);
    }
    const nextClass = resolveComponentClassDefinition(db, currClass, id, $);
    if (nextClass == 0) return false;
    currClass = nextClass;
    idx++;
  }

  return true;
}

/**
 * Checks if two connector classes are compatible for a connect() equation.
 */
export function isConnectorCompatible(db: CodeGraph, lhsClass: u32, rhsClass: u32, $: Record<string, u16>): boolean {
  if (lhsClass == 0 || rhsClass == 0) return true;
  if (lhsClass == rhsClass) return true;

  // 1. Flow variable count must match
  const lhsFlows = getFlowVariableCount(db, lhsClass, $);
  const rhsFlows = getFlowVariableCount(db, rhsClass, $);
  if (lhsFlows != rhsFlows) return false;

  // 2. Non-flow variable count must match
  let lhsNonFlows: u32 = 0;
  for (const comp of db.ast.getDescendants(lhsClass, $.component_clause)) {
    if (isDescendantOfInnerClass(db, comp, lhsClass, $)) continue;
    if (!hasTypePrefix(db, comp, "flow")) {
      for (const decl of db.ast.getDescendants(comp, $.declaration)) {
        if (decl != 0) lhsNonFlows++;
      }
    }
  }
  let rhsNonFlows: u32 = 0;
  for (const comp of db.ast.getDescendants(rhsClass, $.component_clause)) {
    if (isDescendantOfInnerClass(db, comp, rhsClass, $)) continue;
    if (!hasTypePrefix(db, comp, "flow")) {
      for (const decl of db.ast.getDescendants(comp, $.declaration)) {
        if (decl != 0) rhsNonFlows++;
      }
    }
  }
  if (lhsNonFlows != rhsNonFlows) return false;

  return true;
}

/**
 * Counts the number of flow variables in a class/connector definition.
 */
export function getFlowVariableCount(db: CodeGraph, classDefNode: u32, $: Record<string, u16>): u32 {
  if (classDefNode == 0) return 0;
  let count: u32 = 0;
  for (const comp of db.ast.getDescendants(classDefNode, $.component_clause)) {
    if (isDescendantOfInnerClass(db, comp, classDefNode, $)) continue;
    if (hasTypePrefix(db, comp, "flow")) {
      for (const decl of db.ast.getDescendants(comp, $.declaration)) {
        if (decl != 0) count++;
      }
    }
  }
  return count;
}

/**
 * Fast lookup to check if an identifier matches any top-level class name in the document.
 */
export function isTopLevelClassName(db: CodeGraph, nameNode: u32, $: Record<string, u16>): boolean {
  const docRoot = db.ast.getRootNode();
  if (docRoot == 0) return false;
  let targetIdent: u32 = nameNode;
  for (const id of db.ast.getDescendants(nameNode, $.identifier)) {
    targetIdent = id;
    break;
  }
  for (const spec of db.ast.getDescendants(docRoot, $.long_class_specifier)) {
    const nameId = db.ast.getChildByFieldId(spec, "name");
    if (nameId != 0 && (db.ast.textEqualsNode(nameNode, nameId) || db.ast.textEqualsNode(targetIdent, nameId))) {
      return true;
    }
  }
  for (const spec of db.ast.getDescendants(docRoot, $.short_class_specifier)) {
    const nameId = db.ast.getChildByFieldId(spec, "name");
    if (nameId != 0 && (db.ast.textEqualsNode(nameNode, nameId) || db.ast.textEqualsNode(targetIdent, nameId))) {
      return true;
    }
  }
  return false;
}

/**
 * Returns true if `target` is nested inside an inner class_definition child of `classNode`.
 */
export function isDescendantOfInnerClass(db: CodeGraph, target: u32, classNode: u32, $: Record<string, u16>): boolean {
  for (const anc of db.ast.getAncestors(target, 0)) {
    if (anc == classNode) break;
    if (db.ast.getType(anc) == $.class_definition) {
      return true;
    }
  }
  return false;
}

/**
 * Checks if a variable identifier `identNode` is declared in `classNode` or any of its inherited base classes via `extends`.
 */
export function isVariableDeclaredInClass(
  db: CodeGraph,
  classNode: u32,
  identNode: u32,
  $: Record<string, u16>,
): boolean {
  if (classNode == 0 || identNode == 0) return false;

  // 1. Direct declarations in classNode (ignoring nested classes)
  for (const decl of db.ast.getDescendants(classNode, $.declaration)) {
    if (isDescendantOfInnerClass(db, decl, classNode, $)) continue;
    let declId: u32 = 0;
    for (const id of db.ast.getDescendants(decl, $.identifier)) {
      declId = id;
      break;
    }
    if (declId != 0 && db.ast.textEqualsNode(identNode, declId)) {
      return true;
    }
  }

  // 2. Inherited declarations via `extends_clause`
  const docRoot = db.ast.getRootNode();
  if (docRoot == 0) return false;

  for (const ext of db.ast.getDescendants(classNode, $.extends_clause)) {
    let typeSpec = db.ast.getChildByFieldId(ext, "type_specifier");
    if (typeSpec == 0) typeSpec = db.ast.getFirstChild(ext);
    if (typeSpec == 0) continue;

    let baseNameId: u32 = typeSpec;
    for (const id of db.ast.getDescendants(typeSpec, $.identifier)) {
      baseNameId = id;
      break;
    }

    // Find class_definition for baseNameId
    for (const spec of db.ast.getDescendants(docRoot, $.long_class_specifier)) {
      const nameId = db.ast.getChildByFieldId(spec, "name");
      if (nameId != 0 && db.ast.textEqualsNode(baseNameId, nameId)) {
        let baseClass: u32 = spec;
        for (const anc of db.ast.getAncestors(spec, 0)) {
          if (db.ast.getType(anc) == $.class_definition) {
            baseClass = anc;
            break;
          }
        }
        if (isVariableDeclaredInClass(db, baseClass, identNode, $)) {
          return true;
        }
        break;
      }
    }
    for (const spec of db.ast.getDescendants(docRoot, $.short_class_specifier)) {
      const nameId = db.ast.getChildByFieldId(spec, "name");
      if (nameId != 0 && db.ast.textEqualsNode(baseNameId, nameId)) {
        let baseClass: u32 = spec;
        for (const anc of db.ast.getAncestors(spec, 0)) {
          if (db.ast.getType(anc) == $.class_definition) {
            baseClass = anc;
            break;
          }
        }
        if (isVariableDeclaredInClass(db, baseClass, identNode, $)) {
          return true;
        }
        break;
      }
    }
  }

  return false;
}

/**
 * Resolves the declared type (e.g. TYPE_REAL, TYPE_INTEGER, TYPE_BOOLEAN, TYPE_STRING, TYPE_CLOCK)
 * of a variable identifier `identNode` in `classNode` or its inherited base classes.
 */
export function getVariableTypeInClass(db: CodeGraph, classNode: u32, identNode: u32, $: Record<string, u16>): u16 {
  if (classNode == 0 || identNode == 0) return TYPE_UNKNOWN;

  // 1. Direct declarations in classNode (ignoring nested classes)
  for (const decl of db.ast.getDescendants(classNode, $.declaration)) {
    if (isDescendantOfInnerClass(db, decl, classNode, $)) continue;
    let declId: u32 = 0;
    for (const id of db.ast.getDescendants(decl, $.identifier)) {
      declId = id;
      break;
    }
    if (declId != 0 && db.ast.textEqualsNode(identNode, declId)) {
      // Find parent component_clause or component_clause1
      for (const anc of db.ast.getAncestors(decl, 0)) {
        const ancType = db.ast.getType(anc);
        if (ancType == $.component_clause || ancType == $.component_clause1) {
          for (const id of db.ast.getDescendants(anc, $.identifier)) {
            if (db.ast.textEquals(id, "Real")) return TYPE_REAL;
            if (db.ast.textEquals(id, "Integer")) return TYPE_INTEGER;
            if (db.ast.textEquals(id, "Boolean")) return TYPE_BOOLEAN;
            if (db.ast.textEquals(id, "String")) return TYPE_STRING;
            if (db.ast.textEquals(id, "Clock")) return TYPE_CLOCK;
            break;
          }
          break;
        }
      }
    }
  }

  // 2. Inherited declarations via `extends_clause`
  const docRoot = db.ast.getRootNode();
  if (docRoot == 0) return TYPE_UNKNOWN;

  for (const ext of db.ast.getDescendants(classNode, $.extends_clause)) {
    let typeSpec = db.ast.getChildByFieldId(ext, "type_specifier");
    if (typeSpec == 0) typeSpec = db.ast.getFirstChild(ext);
    if (typeSpec == 0) continue;

    let baseNameId: u32 = typeSpec;
    for (const id of db.ast.getDescendants(typeSpec, $.identifier)) {
      baseNameId = id;
      break;
    }

    // Find class_definition for baseNameId
    for (const spec of db.ast.getDescendants(docRoot, $.long_class_specifier)) {
      const nameId = db.ast.getChildByFieldId(spec, "name");
      if (nameId != 0 && db.ast.textEqualsNode(baseNameId, nameId)) {
        let baseClass: u32 = spec;
        for (const anc of db.ast.getAncestors(spec, 0)) {
          if (db.ast.getType(anc) == $.class_definition) {
            baseClass = anc;
            break;
          }
        }
        const inheritedType = getVariableTypeInClass(db, baseClass, identNode, $);
        if (inheritedType != TYPE_UNKNOWN) return inheritedType;
        break;
      }
    }
    for (const spec of db.ast.getDescendants(docRoot, $.short_class_specifier)) {
      const nameId = db.ast.getChildByFieldId(spec, "name");
      if (nameId != 0 && db.ast.textEqualsNode(baseNameId, nameId)) {
        let baseClass: u32 = spec;
        for (const anc of db.ast.getAncestors(spec, 0)) {
          if (db.ast.getType(anc) == $.class_definition) {
            baseClass = anc;
            break;
          }
        }
        const inheritedType = getVariableTypeInClass(db, baseClass, identNode, $);
        if (inheritedType != TYPE_UNKNOWN) return inheritedType;
        break;
      }
    }
  }

  return TYPE_UNKNOWN;
}
