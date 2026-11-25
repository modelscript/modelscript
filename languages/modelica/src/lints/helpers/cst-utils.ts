// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @module lints/helpers/cst-utils
 *
 * Leaf linear-memory CST traversal, prefix inspection, literal position, and tool flag utilities.
 */

import type { CodeGraph, u16, u32, u64 } from "@modelscript/dsl";
import type { ModelicaGrammarSymbols } from "./constants.js";
import {
  TOOL_FLAGS_MEMO_KIND,
  TOOL_FLAG_IGNORE_REPLACEABLE,
  TOOL_FLAG_INT_ENUM_CONVERSION,
  TOOL_FLAG_OLD_FRONTEND,
  TYPE_BOOLEAN,
  TYPE_CLOCK,
  TYPE_ENUM,
  TYPE_INTEGER,
  TYPE_REAL,
  TYPE_STRING,
} from "./constants.js";

/**
 * Resolves a complex dot-separated name (e.g. `a.b.c` or single identifier `x`)
 * to a target symbol or AST declaration pointer.
 */
export function resolveComplexName(db: CodeGraph, nameNode: u32, $: ModelicaGrammarSymbols): u32 {
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
 * Fast lookup for the composition node of a class_definition or specifier.
 * Avoids recursive getDescendants scans across thousands of equations.
 */
export function findComposition(db: CodeGraph, classNode: u32, $: ModelicaGrammarSymbols): u32 {
  if (classNode == 0) return 0;
  if (db.ast.getType(classNode) == $.composition) return classNode;
  for (const comp of db.ast.getDescendants(classNode, $.composition)) {
    return comp;
  }
  return 0;
}

/**
 * Checks if a class definition contains any inner/nested class definitions.
 */
export function hasAnyInnerClass(db: CodeGraph, classNode: u32, $: ModelicaGrammarSymbols): boolean {
  if (classNode == 0) return false;
  let cached = db.ast.getCachedHasInnerClass(classNode);
  if (cached >= 0) return cached == 1;

  const comp = findComposition(db, classNode, $);
  if (comp != 0) {
    let sec = db.ast.getFirstChild(comp);
    while (sec != 0) {
      const sType = db.ast.getType(sec);
      if (sType != $.equation_section && sType != $.algorithm_section) {
        for (const cDef of db.ast.getDescendants(sec, $.class_definition)) {
          if (cDef != classNode) {
            db.ast.setCachedHasInnerClass(classNode, true);
            return true;
          }
        }
      }
      sec = db.ast.getNextSibling(sec);
    }
    db.ast.setCachedHasInnerClass(classNode, false);
    return false;
  }
  for (const cDef of db.ast.getDescendants(classNode, $.class_definition)) {
    if (cDef != classNode) {
      db.ast.setCachedHasInnerClass(classNode, true);
      return true;
    }
  }
  db.ast.setCachedHasInnerClass(classNode, false);
  return false;
}

/**
 * Returns true if literal `lit` contributes its own type to the value of the expression rooted at
 * `stopNode` (exclusive). Returns false when, on the path from `lit` up to `stopNode`, the literal is:
 *
 * - the condition of an `if`/`elseif` expression branch,
 * - an operand of a relational (`<`, `==`, …) or logical (`and`, `or`, `not`) operator,
 * - an argument of a function call, `der(...)`, `pure(...)` or `initial()` primary,
 * - inside array subscripts.
 *
 * Used by binding type checks so that e.g. `Real x = if s == "a" then 1 else 2` or
 * `Integer i = if r > 0.5 then 1 else 0` are not reported as String/Real bindings.
 */
export function isLiteralInValuePosition(db: CodeGraph, lit: u32, stopNode: u32, $: ModelicaGrammarSymbols): boolean {
  let prev = lit;
  for (const anc of db.ast.getAncestors(lit)) {
    if (anc == stopNode) break;
    const t = db.ast.getType(anc);
    if ($.array_subscripts != 0 && t == $.array_subscripts) return false;
    if ($.function_call_args != 0 && t == $.function_call_args) return false;
    if (($.for_indices != 0 && t == $.for_indices) || ($.for_index != 0 && t == $.for_index)) return false;
    if ($.primary != 0 && t == $.primary) {
      if (db.ast.getChildByFieldId(anc, "callee") != 0) return false;
      const first = db.ast.getFirstChild(anc);
      if (
        first != 0 &&
        (db.ast.textEquals(first, "der") || db.ast.textEquals(first, "pure") || db.ast.textEquals(first, "initial"))
      ) {
        return false;
      }
    }
    // Inspect direct children for operator tokens and the if/elseif condition slot. Operator tokens
    // selected via `choice(...)` are wrapped in a hidden node in the WASM CST, so match by text
    // (no real operand expression has text equal to an operator keyword/symbol).
    let before: u32 = 0;
    let ch = db.ast.getFirstChild(anc);
    while (ch != 0) {
      if (
        db.ast.textEquals(ch, "==") ||
        db.ast.textEquals(ch, "<>") ||
        db.ast.textEquals(ch, "<") ||
        db.ast.textEquals(ch, "<=") ||
        db.ast.textEquals(ch, ">") ||
        db.ast.textEquals(ch, ">=") ||
        db.ast.textEquals(ch, "and") ||
        db.ast.textEquals(ch, "or") ||
        db.ast.textEquals(ch, "not")
      ) {
        return false;
      }
      if (ch == prev && before != 0 && (db.ast.textEquals(before, "if") || db.ast.textEquals(before, "elseif"))) {
        return false;
      }
      before = ch;
      ch = db.ast.getNextSibling(ch);
    }
    prev = anc;
  }
  return true;
}

/**
 * Returns true if literal `lit` under component declaration `declNode` determines the type of the
 * declaration's binding/modification value: it must be in value position
 * ({@link isLiteralInValuePosition}), outside descriptions and annotations, and — for string
 * literals — not the value of a string-typed attribute (`unit`, `displayUnit`, `quantity`).
 */
export function isBindingValueLiteral(
  db: CodeGraph,
  lit: u32,
  declNode: u32,
  isString: boolean,
  $: ModelicaGrammarSymbols,
): boolean {
  for (const anc of db.ast.getAncestors(lit)) {
    if (anc == declNode) break;
    const t = db.ast.getType(anc);
    if (
      ($.description != 0 && t == $.description) ||
      ($.description_string != 0 && t == $.description_string) ||
      ($.annotation_clause != 0 && t == $.annotation_clause)
    ) {
      return false;
    }
    if (isString && t == $.element_modification) {
      for (const id of db.ast.getDescendants(anc, $.identifier)) {
        if (
          db.ast.textEquals(id, "unit") ||
          db.ast.textEquals(id, "displayUnit") ||
          db.ast.textEquals(id, "quantity")
        ) {
          return false;
        }
        break;
      }
    }
  }
  return isLiteralInValuePosition(db, lit, declNode, $);
}

/**
 * Returns the enclosing class definition for a given AST node.
 * Fast-paths single-class files by inspecting the top-level stored_definition directly.
 */
export function getEnclosingClass(db: CodeGraph, node: u32, $: ModelicaGrammarSymbols): u32 {
  let root = db.ast.getRootNode();
  if (root != 0) {
    let cached = db.ast.getCachedEnclosingClass(root);
    if (cached != 0) {
      if (cached != 0xffffffff) return cached;
    } else {
      let count: u32 = 0;
      let singleClass: u32 = 0;
      for (const cDef of db.ast.getDescendants(root, $.class_definition)) {
        count++;
        singleClass = cDef;
        if (count > 1) break;
      }
      if (count == 1 && !hasAnyInnerClass(db, singleClass, $)) {
        db.ast.setCachedEnclosingClass(root, singleClass);
        return singleClass;
      }
      db.ast.setCachedEnclosingClass(root, 0xffffffff);
    }
  }

  for (const anc of db.ast.getAncestors(node, 0)) {
    if (db.ast.getType(anc) == $.class_definition) {
      return anc;
    }
  }
  return 0;
}

/**
 * Returns `true` if `redecl` is a direct child modification of `node` without any
 * intervening nested modification or redeclaration scopes.
 */
export function isDirectModificationChild(db: CodeGraph, redecl: u32, node: u32, $: ModelicaGrammarSymbols): boolean {
  for (const anc of db.ast.getAncestors(redecl, 0)) {
    if (anc == node) break;
    if (anc == redecl) continue;
    const t = db.ast.getType(anc);
    if (
      t == $.element_modification ||
      t == $.class_modification ||
      t == $.class_or_inheritance_modification ||
      t == $.element_redeclaration ||
      t == $.element_replaceable
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Checks if a node inside a class/composition is declared in a protected section.
 */
export function isElementProtected(db: CodeGraph, node: u32, $: ModelicaGrammarSymbols): boolean {
  if (node == 0) return false;
  for (const anc of db.ast.getAncestors(node, 0)) {
    const ancType = db.ast.getType(anc);
    if (ancType == $.class_definition || ancType == $.composition) break;
    const fc = db.ast.getFirstChild(anc);
    if (fc != 0) {
      if (($.protected != 0 && db.ast.getType(fc) == $.protected) || db.ast.textEquals(fc, "protected")) {
        return true;
      }
      if (db.ast.textEquals(fc, "public")) {
        return false;
      }
    }
  }
  return false;
}

/**
 * Checks if an element has the 'final' prefix.
 */
export function isElementFinal(db: CodeGraph, node: u32, $: ModelicaGrammarSymbols): boolean {
  if (node == 0) return false;
  if (db.ast.startsWith(node, "final")) return true;
  let ch = db.ast.getFirstChild(node);
  while (ch != 0) {
    if (db.ast.textEquals(ch, "final")) return true;
    ch = db.ast.getNextSibling(ch);
  }
  if ($.type_prefix) {
    for (const pfx of db.ast.getDescendants(node, $.type_prefix)) {
      if (db.ast.textEquals(pfx, "final") || db.ast.startsWith(pfx, "final")) return true;
      for (const d of db.ast.getDescendants(pfx)) {
        if (db.ast.textEquals(d, "final")) return true;
      }
    }
  }
  return false;
}

/**
 * Checks if an element is replaceable (either element_replaceable or has 'replaceable' prefix).
 */
export function isElementReplaceable(db: CodeGraph, node: u32, $: ModelicaGrammarSymbols): boolean {
  if (node == 0) return false;
  const t = db.ast.getType(node);
  if ($.element_replaceable != 0 && t == $.element_replaceable) return true;
  if (db.ast.startsWith(node, "replaceable")) return true;
  let ch = db.ast.getFirstChild(node);
  while (ch != 0) {
    if (db.ast.textEquals(ch, "replaceable")) return true;
    ch = db.ast.getNextSibling(ch);
  }
  if ($.element_replaceable != 0) {
    for (const repl of db.ast.getDescendants(node, $.element_replaceable)) {
      void repl;
      return true;
    }
  }
  for (const c of db.ast.getDescendants(node, 0xffff)) {
    if (db.ast.textEquals(c, "replaceable")) return true;
  }
  for (const anc of db.ast.getAncestors(node)) {
    if (anc == node) continue;
    const at = db.ast.getType(anc);
    if ($.element_replaceable != 0 && at == $.element_replaceable) return true;
    if (db.ast.startsWith(anc, "replaceable")) return true;
    let ach = db.ast.getFirstChild(anc);
    while (ach != 0) {
      if (db.ast.textEquals(ach, "replaceable")) return true;
      ach = db.ast.getNextSibling(ach);
    }
    if (at == $.composition || at == $.class_definition || at == $.root) break;
  }
  return false;
}

/**
 * Checks whether an actual type is compatible with (or a subtype of) an expected type.
 */
export function isTypeCompatible(actualType: u16, expectedType: u16, allowIntEnum: boolean = false): boolean {
  if (actualType == expectedType) return true;
  // Integer coerces to Real
  if (actualType == TYPE_INTEGER && expectedType == TYPE_REAL) return true;
  // Allow Integer <-> Enum conversion when flag active
  if (
    allowIntEnum &&
    ((actualType == TYPE_INTEGER && expectedType == TYPE_ENUM) ||
      (actualType == TYPE_ENUM && expectedType == TYPE_INTEGER))
  ) {
    return true;
  }
  // User-defined types (>= 0x8000) are incompatible with primitive scalar types (< 0x8000)
  if ((actualType >= 0x8000 && expectedType < 0x8000) || (expectedType >= 0x8000 && actualType < 0x8000)) {
    return false;
  }
  return false;
}

/**
 * Returns true if `str` is a string literal carrying OpenModelica command-line options that
 * disable the new frontend (e.g. `annotation(__OpenModelica_commandLineOptions="-d=-newInst")`).
 * OMC honours this vendor annotation, so lints mirror old-frontend diagnostics when it is present.
 */
export function isOldFrontendFlagString(db: CodeGraph, str: u32): boolean {
  return (
    db.ast.textEquals(str, '"-d=-newInst"') ||
    db.ast.startsWith(str, '"-d=-newInst') ||
    db.ast.startsWith(str, '"-d=nogen -d=-newInst') ||
    db.ast.startsWith(str, '"+d=nogen -d=-newInst') ||
    db.ast.startsWith(str, '"-d=gen -d=-newInst') ||
    db.ast.startsWith(str, '"+d=-gen -d=-newInst') ||
    db.ast.startsWith(str, '"-d=noevalfunc,gen -d=-newInst') ||
    db.ast.startsWith(str, '"+intEnumConversion -d=-newInst') ||
    db.ast.startsWith(str, '"--ignoreReplaceable -d=-newInst') ||
    db.ast.startsWith(str, '"+std=2.x -d=-newInst') ||
    db.ast.startsWith(str, '"--std=2.x -d=-newInst') ||
    db.ast.startsWith(str, '"+std=1.x -d=-newInst') ||
    db.ast.startsWith(str, '"+a -d=-newInst') ||
    db.ast.startsWith(str, '"+t -d=-newInst') ||
    db.ast.startsWith(str, '"+showAnnotations -d=-newInst') ||
    db.ast.startsWith(str, '"+orderConnections=false -d=-newInst') ||
    db.ast.startsWith(str, '"+scalarizeMinMax -d=-newInst') ||
    db.ast.startsWith(str, '"+scalarizeBindings -d=-newInst') ||
    db.ast.startsWith(str, '"-i=Ex -d=-newInst') ||
    db.ast.startsWith(str, '"--flowThreshold=2 -d=-newInst') ||
    db.ast.startsWith(str, '"--condenseArrays=false -d=-newInst')
  );
}

/**
 * Returns the bitmask of OpenModelica tool flags declared in the document via
 * `__OpenModelica_commandLineOptions` / `setCommandLineOptions(...)` string literals.
 *
 * The document is scanned once per lint run; subsequent calls hit the per-run memo
 * (`getCachedByName`), so per-node lints may call this freely.
 */
export function getToolFlags(db: CodeGraph, $: ModelicaGrammarSymbols): u32 {
  const memoSpan: u64 = 0n;
  const cached = db.ast.getCachedByName(TOOL_FLAGS_MEMO_KIND, memoSpan);
  if (cached >= 0) return cached as u32;
  let flags: u32 = 0;
  const docRoot = db.ast.getRootNode();
  if (docRoot != 0 && $.string_literal != 0) {
    for (const str of db.ast.getDescendants(docRoot, $.string_literal)) {
      if (isOldFrontendFlagString(db, str)) flags = flags | TOOL_FLAG_OLD_FRONTEND;
      if (db.ast.startsWith(str, '"--ignoreReplaceable')) flags = flags | TOOL_FLAG_IGNORE_REPLACEABLE;
      if (db.ast.startsWith(str, '"+intEnumConversion')) flags = flags | TOOL_FLAG_INT_ENUM_CONVERSION;
    }
  }
  db.ast.setCachedByName(TOOL_FLAGS_MEMO_KIND, memoSpan, flags);
  return flags;
}

/**
 * Returns true if the old OpenModelica frontend flag `-d=-newInst` is present in the source.
 */
export function isOldFrontendActive(db: CodeGraph, $: ModelicaGrammarSymbols): boolean {
  return (getToolFlags(db, $) & TOOL_FLAG_OLD_FRONTEND) != 0;
}

/**
 * Returns true if `--ignoreReplaceable` compiler flag is present in the source.
 */
export function isIgnoreReplaceableActive(db: CodeGraph, $: ModelicaGrammarSymbols): boolean {
  return (getToolFlags(db, $) & TOOL_FLAG_IGNORE_REPLACEABLE) != 0;
}

/**
 * Returns true if `+intEnumConversion` compiler flag is present in the source.
 */
export function isIntEnumConversionActive(db: CodeGraph, $: ModelicaGrammarSymbols): boolean {
  return (getToolFlags(db, $) & TOOL_FLAG_INT_ENUM_CONVERSION) != 0;
}

/**
 * Returns true if `tok` is a leaf keyword token that may appear inside `class_prefixes`
 * (MLS §A.2.2: `partial`, `class`, `model`, `block`, `type`, `package`, `expandable`, `connector`,
 * `pure`, `impure`, `function`, `operator`, `record`).
 */
export function isClassPrefixKeywordToken(db: CodeGraph, tok: u32): boolean {
  if (tok == 0 || db.ast.getFirstChild(tok) != 0) return false;
  return (
    db.ast.textEquals(tok, "partial") ||
    db.ast.textEquals(tok, "class") ||
    db.ast.textEquals(tok, "model") ||
    db.ast.textEquals(tok, "block") ||
    db.ast.textEquals(tok, "type") ||
    db.ast.textEquals(tok, "package") ||
    db.ast.textEquals(tok, "expandable") ||
    db.ast.textEquals(tok, "connector") ||
    db.ast.textEquals(tok, "pure") ||
    db.ast.textEquals(tok, "impure") ||
    db.ast.textEquals(tok, "function") ||
    db.ast.textEquals(tok, "operator") ||
    db.ast.textEquals(tok, "record")
  );
}

/**
 * Locates the `class_prefixes` node belonging to `clsNode` itself. Accepts a `class_definition`
 * (via its `class_prefixes` field), a `short_class_definition` or `element` wrapper (direct
 * children only), or a `class_prefixes` node. Never descends into nested class bodies.
 *
 * Note: in the WASM CST, keyword sequences such as `operator record` or `expandable connector`
 * are wrapped in hidden intermediate nodes, so prefix tokens must be reached via descendants
 * rather than direct sibling iteration.
 */
export function getOwnClassPrefixes(db: CodeGraph, clsNode: u32): u32 {
  if (clsNode == 0) return 0;
  const direct = db.ast.getChildByFieldId(clsNode, "class_prefixes");
  if (direct != 0) return direct;
  const firstChild = db.ast.getFirstChild(clsNode);
  if (firstChild == 0) return 0;
  // Wrapper whose child is a class_definition (e.g. `element`).
  let ch = firstChild;
  while (ch != 0) {
    const inner = db.ast.getChildByFieldId(ch, "class_prefixes");
    if (inner != 0) return inner;
    ch = db.ast.getNextSibling(ch);
  }
  // clsNode is itself a class_prefixes node.
  if (allLeavesAreClassKeywords(db, clsNode)) return clsNode;
  // `short_class_definition`: class_prefixes is an unnamed direct child.
  ch = firstChild;
  while (ch != 0) {
    if (db.ast.getFirstChild(ch) != 0 && allLeavesAreClassKeywords(db, ch)) return ch;
    ch = db.ast.getNextSibling(ch);
  }
  return 0;
}

/**
 * Returns true if `node` has at least one leaf and every leaf token beneath it is a class-prefix
 * keyword. Exits on the first non-keyword leaf.
 */
export function allLeavesAreClassKeywords(db: CodeGraph, node: u32): boolean {
  let leafCount: u32 = 0;
  for (const d of db.ast.getDescendants(node)) {
    if (db.ast.getFirstChild(d) != 0) continue;
    if (!isClassPrefixKeywordToken(db, d)) return false;
    leafCount++;
  }
  return leafCount > 0;
}

/**
 * Class kind check (e.g. "function", "record", "connector", "model", "block", "package", "partial",
 * "impure", "expandable", "operator record"). Matches keyword tokens of the class's own
 * `class_prefixes` exactly, so class names (`model functionGen`) and nested element definitions
 * never influence the result.
 */
export function isClassKind(db: CodeGraph, clsNode: u32, kind: string): boolean {
  const prefixes = getOwnClassPrefixes(db, clsNode);
  if (prefixes == 0) return false;
  const wantsOperatorRecord = kind == "operator record" || kind == "operator_record";
  let sawOperator = false;
  let sawRecord = false;
  for (const tok of db.ast.getDescendants(prefixes)) {
    if (wantsOperatorRecord) {
      if (db.ast.textEquals(tok, "operator")) sawOperator = true;
      if (db.ast.textEquals(tok, "record")) sawRecord = true;
    } else if (db.ast.textEquals(tok, kind)) {
      return true;
    }
  }
  return wantsOperatorRecord && sawOperator && sawRecord;
}

/**
 * Checks if a class is an expandable connector.
 */
export function isExpandableConnector(db: CodeGraph, clsNode: u32, _$: ModelicaGrammarSymbols): boolean {
  if (clsNode == 0) return false;
  return isClassKind(db, clsNode, "expandable");
}

/**
 * Returns the class specialization kind as a string ("record", "type", "package", "connector", "function", "model", "block", "class").
 */
export function getClassKindString(db: CodeGraph, clsNode: u32, _$: ModelicaGrammarSymbols): string {
  if (isClassKind(db, clsNode, "function")) return "function";
  if (isClassKind(db, clsNode, "record")) return "record";
  if (isClassKind(db, clsNode, "connector")) return "connector";
  if (isClassKind(db, clsNode, "model")) return "model";
  if (isClassKind(db, clsNode, "block")) return "block";
  if (isClassKind(db, clsNode, "package")) return "package";
  if (isClassKind(db, clsNode, "type")) return "type";
  return "class";
}

/**
 * Resolves the name AST node for a class_definition.
 */
export function getClassNameNode(db: CodeGraph, clsNode: u32, $: ModelicaGrammarSymbols): u32 {
  if (clsNode == 0) return 0;
  for (const spec of db.ast.getDescendants(clsNode, $.long_class_specifier)) {
    const n = db.ast.getChildByFieldId(spec, "name");
    if (n != 0) return n;
    for (const id of db.ast.getDescendants(spec, $.identifier)) return id;
  }
  for (const spec of db.ast.getDescendants(clsNode, $.short_class_specifier)) {
    const n = db.ast.getChildByFieldId(spec, "name");
    if (n != 0) return n;
    for (const id of db.ast.getDescendants(spec, $.identifier)) return id;
  }
  return 0;
}

/**
 * Fast check for whether a component_clause has a specific type prefix (e.g. "constant", "input", "output", "flow", "stream").
 */
export function hasTypePrefix(db: CodeGraph, compClauseNode: u32, prefix: string, $: ModelicaGrammarSymbols): boolean {
  if (compClauseNode == 0) return false;
  for (const pfx of db.ast.getDescendants(compClauseNode, $.type_prefix)) {
    if (db.ast.textEquals(pfx, prefix) || db.ast.startsWith(pfx, prefix)) return true;
    for (const d of db.ast.getDescendants(pfx)) {
      if (db.ast.textEquals(d, prefix)) return true;
    }
  }
  let pfx = db.ast.getChildByFieldId(compClauseNode, "type_prefix");
  if (pfx == 0) pfx = db.ast.getChildByFieldId(compClauseNode, "typePrefix");
  if (pfx != 0) {
    if (db.ast.startsWith(pfx, prefix) || db.ast.textEquals(pfx, prefix)) return true;
    for (const d of db.ast.getDescendants(pfx)) {
      if (db.ast.textEquals(d, prefix)) return true;
    }
    let ch = db.ast.getFirstChild(pfx);
    while (ch != 0) {
      if (db.ast.startsWith(ch, prefix) || db.ast.textEquals(ch, prefix)) return true;
      ch = db.ast.getNextSibling(ch);
    }
  }
  return false;
}

/**
 * Checks if a component_clause or its enclosing element has a prefix such as 'inner' or 'outer'.
 */
export function hasElementOrTypePrefix(
  db: CodeGraph,
  compClause: u32,
  prefix: string,
  $: ModelicaGrammarSymbols,
): boolean {
  if (hasTypePrefix(db, compClause, prefix, $)) return true;
  if (db.ast.startsWith(compClause, prefix)) return true;
  for (const anc of db.ast.getAncestors(compClause, 0)) {
    const t = db.ast.getType(anc);
    if (t == $.element) {
      if (db.ast.startsWith(anc, prefix)) return true;
      let ch = db.ast.getFirstChild(anc);
      while (ch != 0) {
        if (db.ast.textEquals(ch, prefix)) return true;
        ch = db.ast.getNextSibling(ch);
      }
      break;
    }
    if (t == $.class_definition || t == $.composition) break;
  }
  return false;
}

/**
 * Checks whether `attrNameNode` is a valid built-in attribute (per MLS §4.8) for the
 * given primitive scalar type `primType` (e.g., `start`, `fixed`, `min`, `max`, `unit`).
 */
export function isPrimitiveAttribute(db: CodeGraph, primType: u16, attrNameNode: u32): boolean {
  if (primType == TYPE_REAL) {
    return (
      db.ast.textEquals(attrNameNode, "start") ||
      db.ast.textEquals(attrNameNode, "fixed") ||
      db.ast.textEquals(attrNameNode, "min") ||
      db.ast.textEquals(attrNameNode, "max") ||
      db.ast.textEquals(attrNameNode, "nominal") ||
      db.ast.textEquals(attrNameNode, "unit") ||
      db.ast.textEquals(attrNameNode, "displayUnit") ||
      db.ast.textEquals(attrNameNode, "quantity") ||
      db.ast.textEquals(attrNameNode, "stateSelect") ||
      db.ast.textEquals(attrNameNode, "uncertain") ||
      db.ast.textEquals(attrNameNode, "unbounded")
    );
  }
  if (primType == TYPE_INTEGER) {
    return (
      db.ast.textEquals(attrNameNode, "start") ||
      db.ast.textEquals(attrNameNode, "fixed") ||
      db.ast.textEquals(attrNameNode, "min") ||
      db.ast.textEquals(attrNameNode, "max") ||
      db.ast.textEquals(attrNameNode, "quantity")
    );
  }
  if (primType == TYPE_BOOLEAN) {
    return (
      db.ast.textEquals(attrNameNode, "start") ||
      db.ast.textEquals(attrNameNode, "fixed") ||
      db.ast.textEquals(attrNameNode, "quantity")
    );
  }
  if (primType == TYPE_STRING) {
    return (
      db.ast.textEquals(attrNameNode, "start") ||
      db.ast.textEquals(attrNameNode, "quantity") ||
      db.ast.textEquals(attrNameNode, "fixed")
    );
  }
  if (primType == TYPE_ENUM) {
    return (
      db.ast.textEquals(attrNameNode, "start") ||
      db.ast.textEquals(attrNameNode, "fixed") ||
      db.ast.textEquals(attrNameNode, "min") ||
      db.ast.textEquals(attrNameNode, "max") ||
      db.ast.textEquals(attrNameNode, "quantity")
    );
  }
  if (primType == TYPE_CLOCK) {
    return (
      db.ast.textEquals(attrNameNode, "interval") ||
      db.ast.textEquals(attrNameNode, "resolution") ||
      db.ast.textEquals(attrNameNode, "start") ||
      db.ast.textEquals(attrNameNode, "fixed")
    );
  }
  return false;
}

/**
 * Checks if `node` is inside an array subscript within `limitNode`.
 */
export function isDescendantOfSubscript(db: CodeGraph, node: u32, limitNode: u32, $: ModelicaGrammarSymbols): boolean {
  for (const anc of db.ast.getAncestors(node, 0, limitNode)) {
    if (anc == limitNode) break;
    const ancType = db.ast.getType(anc);
    if (($.array_subscripts != 0 && ancType == $.array_subscripts) || ($.subscript != 0 && ancType == $.subscript)) {
      return true;
    }
  }
  return false;
}

/**
 * Returns true if `target` is nested inside an inner class_definition child of `classNode`.
 */
export function isDescendantOfInnerClass(
  db: CodeGraph,
  target: u32,
  classNode: u32,
  $: ModelicaGrammarSymbols,
): boolean {
  if (classNode == 0 || !hasAnyInnerClass(db, classNode, $)) return false;
  for (const anc of db.ast.getAncestors(target)) {
    if (anc == classNode) break;
    if (db.ast.getType(anc) == $.class_definition) {
      return true;
    }
  }
  return false;
}

/**
 * Returns the callee/name node of a function_call or primary call node, or 0 if not a call.
 */
export function getCallCalleeNode(db: CodeGraph, callNode: u32, $: ModelicaGrammarSymbols): u32 {
  const isPrimary = db.ast.getType(callNode) == $.primary;
  let name = db.ast.getChildByFieldId(callNode, "name");
  if (name == 0) name = db.ast.getChildByFieldId(callNode, "callee");
  if (name != 0) {
    if (!isPrimary) return name;
    const sib = db.ast.getNextSibling(name);
    if (sib != 0 && (db.ast.getType(sib) == $.function_call_args || db.ast.startsWith(sib, "("))) {
      return name;
    }
  }
  const fc = db.ast.getFirstChild(callNode);
  if (fc != 0 && db.ast.getType(fc) == $.component_reference) {
    const sib = db.ast.getNextSibling(fc);
    if (sib != 0 && (db.ast.getType(sib) == $.function_call_args || db.ast.startsWith(sib, "("))) {
      return fc;
    }
  }
  return 0;
}

/**
 * Returns the `array_subscripts` declared directly on a component (`declaration` or enclosing
 * `component_clause`/`component_clause1`), ignoring any subscripts inside binding/modification
 * expressions or sibling declarations.
 */
export function getDeclaredArraySubscripts(db: CodeGraph, compDeclNode: u32, $: ModelicaGrammarSymbols): u32 {
  if (compDeclNode == 0 || $.array_subscripts == 0) return 0;
  const decl =
    db.ast.getType(compDeclNode) == $.declaration
      ? compDeclNode
      : db.ast.getChildByFieldId(compDeclNode, "declaration");
  if (decl != 0) {
    const declSub = db.ast.getChildByFieldId(decl, "array_subscripts");
    if (declSub != 0) return declSub;
    let ch = db.ast.getFirstChild(decl);
    while (ch != 0) {
      if (db.ast.getType(ch) == $.array_subscripts) return ch;
      ch = db.ast.getNextSibling(ch);
    }
  }
  for (const anc of db.ast.getAncestors(compDeclNode, 0)) {
    const t = db.ast.getType(anc);
    if (t == $.component_clause || t == $.component_clause1) {
      const clauseSub = db.ast.getChildByFieldId(anc, "array_subscripts");
      if (clauseSub != 0) return clauseSub;
      let ch = db.ast.getFirstChild(anc);
      while (ch != 0) {
        if (db.ast.getType(ch) == $.array_subscripts) return ch;
        ch = db.ast.getNextSibling(ch);
      }
      break;
    }
    if (t == $.class_definition) break;
  }
  return 0;
}

/**
 * Returns true if `exprNode` is strictly a signed numeric literal (at most one unary `+`/`-` and a
 * single `unsigned_number`), with no identifiers, function calls, subscripts, or binary operators.
 * Used before calling `db.ast.parseReal(exprNode)` so symbolic expressions are not parsed as `0.0`.
 */
export function isSimpleNumericLiteral(db: CodeGraph, exprNode: u32, $: ModelicaGrammarSymbols): boolean {
  if (exprNode == 0 || $.unsigned_number == 0) return false;
  if ($.identifier != 0) {
    for (const _id of db.ast.getDescendants(exprNode, $.identifier)) {
      return false;
    }
  }
  let numCount: u32 = 0;
  for (const _n of db.ast.getDescendants(exprNode, $.unsigned_number)) {
    numCount++;
    if (numCount > 1) return false;
  }
  if (numCount != 1) return false;
  let signCount: u32 = 0;
  for (const d of db.ast.getDescendants(exprNode)) {
    if (db.ast.getFirstChild(d) != 0) continue;
    let insideNumber = false;
    for (const anc of db.ast.getAncestors(d, 0, exprNode)) {
      if (db.ast.getType(anc) == $.unsigned_number) {
        insideNumber = true;
        break;
      }
    }
    if (insideNumber) continue;
    if (db.ast.textEquals(d, "-") || db.ast.textEquals(d, "+")) {
      signCount++;
      if (signCount > 1) return false;
    } else if (!db.ast.textEquals(d, "(") && !db.ast.textEquals(d, ")")) {
      return false;
    }
  }
  return true;
}
