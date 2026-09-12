// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CodeGraph, f64, i32, u16, u32, u8 } from "@modelscript/dsl";

function matchesName(graph: CodeGraph, strId: u32, target: string): boolean {
  if (strId == 0) return false;
  const pool = graph.scope.pool;
  if (strId >= pool.stringCount) return false;
  const len = pool.stringLengths.get(strId);
  if (len != (target.length as u32)) return false;
  const start = pool.stringOffsets.get(strId);
  for (let i: u32 = 0; i < len; i++) {
    if (pool.charBuffer.get(start + i) != (target.charCodeAt(i) as u8)) return false;
  }
  return true;
}

function internAscii(graph: CodeGraph, s: string): u32 {
  const pool = graph.scope.pool;
  const len: u32 = s.length as u32;
  for (let id: u32 = 1; id < pool.stringCount; id++) {
    if (matchesName(graph, id, s)) return id;
  }
  const id = pool.stringCount++;
  const start = pool.charOffset;
  pool.stringOffsets.set(id, start);
  pool.stringLengths.set(id, len);
  for (let i: u32 = 0; i < len; i++) {
    pool.charBuffer.set(start + i, s.charCodeAt(i) as u8);
  }
  pool.charOffset += len;
  return id;
}

function isRealExpr(graph: CodeGraph, exprId: u32): boolean {
  if (exprId == 0) return false;
  const kind = graph.dae.exprData.get(exprId * 4 + 0);
  if (kind == 2 /* RealLiteral */) return true;
  if (kind == 1 /* IntLiteral */) return false;
  if (kind == 0 /* Name */) {
    const nameStrId = graph.dae.exprData.get(exprId * 4 + 1) as u32;
    const vIdx = graph.dae.lookupVariableByName(nameStrId);
    if (vIdx >= 0 && graph.dae.getVarType(vIdx as u32) == 0 /* VarType.Real */) {
      return true;
    }
    return false;
  }
  if (kind == 12 /* Der */) return true;
  if (kind == 14 /* Negate */) {
    return isRealExpr(graph, graph.dae.exprData.get(exprId * 4 + 2) as u32);
  }
  if (kind == 6 /* Unary */) {
    return isRealExpr(graph, graph.dae.exprData.get(exprId * 4 + 2) as u32);
  }
  if (kind == 5 /* Binary */) {
    const left = graph.dae.exprData.get(exprId * 4 + 2) as u32;
    const right = graph.dae.exprData.get(exprId * 4 + 3) as u32;
    return isRealExpr(graph, left) || isRealExpr(graph, right);
  }
  if (kind == 7 /* Call */) {
    return true;
  }
  return false;
}

function castToReal(graph: CodeGraph, exprId: u32): u32 {
  if (exprId == 0) return 0;
  const kind = graph.dae.exprData.get(exprId * 4 + 0);
  if (kind == 1 /* IntLiteral */) {
    const val = graph.dae.exprData.get(exprId * 4 + 1);
    return graph.dae.addRealLiteral(val as f64);
  }
  if (kind == 14 /* Negate */) {
    const operand = castToReal(graph, graph.dae.exprData.get(exprId * 4 + 2) as u32);
    return graph.dae.addExpression(14 /* Negate */, 0, operand);
  }
  if (kind == 6 /* Unary */) {
    const op = graph.dae.exprData.get(exprId * 4 + 1) as u32;
    const operand = castToReal(graph, graph.dae.exprData.get(exprId * 4 + 2) as u32);
    return graph.dae.addExpression(6 /* Unary */, op, operand);
  }
  if (kind == 5 /* Binary */) {
    const op = graph.dae.exprData.get(exprId * 4 + 1) as u16;
    const left = castToReal(graph, graph.dae.exprData.get(exprId * 4 + 2) as u32);
    const right = castToReal(graph, graph.dae.exprData.get(exprId * 4 + 3) as u32);
    return graph.dae.addBinaryExpr(op, left, right);
  }
  if (kind == 9 /* ArrayCtor */) {
    const count = graph.dae.exprData.get(exprId * 4 + 1) as u32;
    if (count == 0) return exprId;
    const firstOrig = graph.dae.exprData.get(exprId * 4 + 2) as u32;
    const firstCast = castToReal(graph, firstOrig);
    const ctorId = graph.dae.addExpression(9 /* ArrayCtor */, count, firstCast, 0xffffffff);
    for (let i: u32 = 1; i < count; i++) {
      const orig = graph.dae.exprData.get((exprId + i) * 4 + 2) as u32;
      const elemCast = castToReal(graph, orig);
      graph.dae.addExpression(15 /* Tuple */, 0, elemCast, 0);
    }
    return ctorId;
  }
  return exprId;
}

function collectTopLevelExpressions(
  graph: CodeGraph,
  container: u32,
  out: u32[],
  prefixId: u32,
  $: Record<string, u16>,
): void {
  if (container == 0) return;
  let ch = graph.ast.getFirstChild(container);
  while (ch != 0) {
    const chType = graph.ast.getType(ch);
    if (chType == $.expression) {
      out.push(lowerExpression(graph, ch, prefixId, $));
    } else {
      collectTopLevelExpressions(graph, ch, out, prefixId, $);
    }
    ch = graph.ast.getNextSibling(ch);
  }
}

/**
 * Recursively lowers an AST expression into the WASM DAE expression arena.
 */
function lowerExpression(graph: CodeGraph, node: u32, prefixId: u32, $: Record<string, u16>): u32 {
  if (node == 0) return 0;
  const nodeType = graph.ast.getType(node);

  // 1. Binary Expression (left op right)
  const leftNode = graph.ast.getChildByFieldId(node, "left");
  const rightNode = graph.ast.getChildByFieldId(node, "right");
  if (leftNode != 0 && rightNode != 0) {
    const leftId = lowerExpression(graph, leftNode, prefixId, $);
    const rightId = lowerExpression(graph, rightNode, prefixId, $);

    const op = graph.ast.getBinaryOp(leftNode, rightNode);

    // Range expression: start : stop or start : step : stop
    if (op == 18 /* BinOp.Colon */) {
      const leftKind = graph.dae.exprData.get(leftId * 4 + 0);
      const leftStep = graph.dae.exprData.get(leftId * 4 + 2);
      if (leftKind == 10 /* Range */ && leftStep == 0xffffffff) {
        const startId = graph.dae.exprData.get(leftId * 4 + 1) as u32;
        const stepId = graph.dae.exprData.get(leftId * 4 + 3) as u32;
        return graph.dae.addExpression(10 /* Range */, startId, stepId, rightId);
      }
      return graph.dae.addExpression(10 /* Range */, leftId, 0xffffffff, rightId);
    }

    // Algebraic simplification: e - 1 -> -1 + e
    if (op == 1 /* BinOp.Sub */) {
      const rightKind = graph.dae.exprData.get(rightId * 4 + 0);
      const rightVal = graph.dae.exprData.get(rightId * 4 + 1);
      if (rightKind == 1 /* IntLiteral */ && rightVal == 1) {
        const negLitId = graph.dae.addExpression(1 /* IntLiteral */, -1 as u32);
        return graph.dae.addBinaryExpr(0 /* BinOp.Add */, negLitId, leftId);
      }
    }

    // Algebraic simplification: sin(x) / cos(x) -> tan(x)
    if (op == 3 /* BinOp.Div */) {
      const leftKind = graph.dae.exprData.get(leftId * 4 + 0);
      const rightKind = graph.dae.exprData.get(rightId * 4 + 0);
      if (leftKind == 7 /* Call */ && rightKind == 7 /* Call */) {
        const leftNameId = graph.dae.exprData.get(leftId * 4 + 1) as u32;
        const rightNameId = graph.dae.exprData.get(rightId * 4 + 1) as u32;
        if (matchesName(graph, leftNameId, "sin") && matchesName(graph, rightNameId, "cos")) {
          const leftArg = graph.dae.exprData.get(leftId * 4 + 2) as u32;
          const rightArg = graph.dae.exprData.get(rightId * 4 + 2) as u32;
          const leftArgCount = graph.dae.exprData.get(leftId * 4 + 3) as u32;
          const rightArgCount = graph.dae.exprData.get(rightId * 4 + 3) as u32;
          let sameArg = leftArg == rightArg;
          if (!sameArg && leftArg != 0 && rightArg != 0) {
            const k1 = graph.dae.exprData.get(leftArg * 4 + 0);
            const k2 = graph.dae.exprData.get(rightArg * 4 + 0);
            const d1 = graph.dae.exprData.get(leftArg * 4 + 1);
            const d2 = graph.dae.exprData.get(rightArg * 4 + 1);
            sameArg = k1 == k2 && d1 == d2;
          }
          if (leftArgCount == 1 && rightArgCount == 1 && sameArg) {
            const tanNameId = internAscii(graph, "tan");
            return graph.dae.addExpression(7 /* Call */, tanNameId, leftArg, 1);
          }
        }
      }
    }

    // Algebraic simplification: x * x -> x ^ 2.0
    if (op == 2 /* BinOp.Mul */) {
      let same = leftId == rightId;
      if (!same) {
        const k1 = graph.dae.exprData.get(leftId * 4 + 0);
        const k2 = graph.dae.exprData.get(rightId * 4 + 0);
        const d1 = graph.dae.exprData.get(leftId * 4 + 1);
        const d2 = graph.dae.exprData.get(rightId * 4 + 1);
        same = k1 == 0 && k2 == 0 && d1 == d2;
      }
      if (same) {
        const twoExpr = graph.dae.addRealLiteral(2.0);
        return graph.dae.addBinaryExpr(4 /* BinOp.Pow */, leftId, twoExpr);
      }
    }

    // Real operand coercion
    const leftIsReal = isRealExpr(graph, leftId);
    const rightIsReal = isRealExpr(graph, rightId);
    let finalLeft = leftId;
    let finalRight = rightId;
    if (leftIsReal && !rightIsReal) {
      finalRight = castToReal(graph, rightId);
    } else if (!leftIsReal && rightIsReal) {
      finalLeft = castToReal(graph, leftId);
    }

    return graph.dae.addBinaryExpr(op, finalLeft, finalRight);
  }

  // 2. Unary Expression (op operand)
  const operandNode = graph.ast.getChildByFieldId(node, "operand");
  if (operandNode != 0) {
    const opId = lowerExpression(graph, operandNode, prefixId, $);
    if (graph.ast.startsWith(node, "-") || graph.ast.textEquals(node, "-")) {
      return graph.dae.addExpression(14 /* Negate */, 0, opId);
    }
    if (graph.ast.startsWith(node, "not") || graph.ast.textEquals(node, "not")) {
      return graph.dae.addExpression(6 /* Unary */, 1 /* Not */, opId);
    }
    return opId;
  }

  // 3. der( expr )
  if (nodeType == $.primary || nodeType == $.expression) {
    if (graph.ast.startsWith(node, "der")) {
      for (const exprList of graph.ast.getDescendants(node, $.expression_list)) {
        for (const expr of graph.ast.getDescendants(exprList, $.expression)) {
          const innerId = lowerExpression(graph, expr, prefixId, $);
          return graph.dae.addExpression(12 /* Der */, 0, innerId);
        }
      }
    }
  }

  // 4. Function Call: name(args...)
  let fnCallArgsNode: u32 = 0;
  let fnRefNode: u32 = 0;
  if (nodeType == $.function_call) {
    fnRefNode = graph.ast.getChildByFieldId(node, "name");
    fnCallArgsNode = graph.ast.getChildByFieldId(node, "args");
  } else if (nodeType == $.primary) {
    const ch1 = graph.ast.getFirstChild(node);
    if (ch1 != 0) {
      const ch2 = graph.ast.getNextSibling(ch1);
      if (ch2 != 0 && graph.ast.getType(ch2) == $.function_call_args) {
        fnRefNode = ch1;
        fnCallArgsNode = ch2;
      }
    }
  }
  if (fnRefNode != 0 && fnCallArgsNode != 0) {
    let fnNameStrId: u32 = 0;
    for (const id of graph.ast.getDescendants(fnRefNode, $.identifier)) {
      let leafId = id;
      while (leafId != 0 && graph.ast.getFirstChild(leafId) != 0) leafId = graph.ast.getFirstChild(leafId);
      const segStrId = graph.scope.internNode(leafId);
      if (fnNameStrId == 0) {
        fnNameStrId = segStrId;
      } else {
        fnNameStrId = graph.scope.concatPrefix(fnNameStrId, segStrId);
      }
    }
    if (fnNameStrId == 0) {
      let leaf = fnRefNode;
      while (leaf != 0 && graph.ast.getFirstChild(leaf) != 0) leaf = graph.ast.getFirstChild(leaf);
      fnNameStrId = graph.scope.internNode(leaf);
    }

    const argExprIds: u32[] = [];
    collectTopLevelExpressions(graph, fnCallArgsNode, argExprIds, prefixId, $);

    if (
      matchesName(graph, fnNameStrId, "sin") ||
      matchesName(graph, fnNameStrId, "cos") ||
      matchesName(graph, fnNameStrId, "tan") ||
      matchesName(graph, fnNameStrId, "exp") ||
      matchesName(graph, fnNameStrId, "log") ||
      matchesName(graph, fnNameStrId, "sqrt") ||
      matchesName(graph, fnNameStrId, "asin") ||
      matchesName(graph, fnNameStrId, "acos") ||
      matchesName(graph, fnNameStrId, "atan") ||
      matchesName(graph, fnNameStrId, "sinh") ||
      matchesName(graph, fnNameStrId, "cosh") ||
      matchesName(graph, fnNameStrId, "tanh")
    ) {
      for (let i = 0; i < argExprIds.length; i++) {
        argExprIds[i] = castToReal(graph, argExprIds[i]);
      }
    }

    if (argExprIds.length == 0) {
      return graph.dae.addExpression(7 /* Call */, fnNameStrId, 0xffffffff, 0);
    }
    const callId = graph.dae.addExpression(7 /* Call */, fnNameStrId, argExprIds[0], argExprIds.length as u32);
    for (let i = 1; i < argExprIds.length; i++) {
      graph.dae.addExpression(15 /* Tuple */, 0, argExprIds[i], 0);
    }
    return callId;
  }

  // 5. Array Constructors: [e1, e2] or {e1, e2}
  if (nodeType == $.primary || nodeType == $.expression) {
    if (graph.ast.startsWith(node, "[") || graph.ast.startsWith(node, "{")) {
      const elemIds: u32[] = [];
      collectTopLevelExpressions(graph, node, elemIds, prefixId, $);
      if (elemIds.length == 0) {
        return graph.dae.addExpression(9 /* ArrayCtor */, 0, 0xffffffff, 0xffffffff);
      }
      const ctorId = graph.dae.addExpression(9 /* ArrayCtor */, elemIds.length as u32, elemIds[0], 0xffffffff);
      for (let i = 1; i < elemIds.length; i++) {
        graph.dae.addExpression(15 /* Tuple */, 0, elemIds[i], 0);
      }
      return ctorId;
    }
  }

  // 6. Literals: Integer
  if (nodeType == $.unsigned_integer) {
    const val = graph.ast.parseInteger(node);
    return graph.dae.addExpression(1 /* IntLiteral */, val as u32);
  }

  // 7. Literals: Real
  if (nodeType == $.unsigned_real) {
    const val = graph.ast.parseReal(node);
    return graph.dae.addRealLiteral(val);
  }

  // 8. Boolean literals
  if (graph.ast.textEquals(node, "true")) {
    return graph.dae.addExpression(3 /* BoolLiteral */, 1);
  }
  if (graph.ast.textEquals(node, "false")) {
    return graph.dae.addExpression(3 /* BoolLiteral */, 0);
  }

  // 9. Built-in variable: time
  if (graph.ast.textEquals(node, "time")) {
    const timeStrId = internAscii(graph, "time");
    return graph.dae.addExpression(0 /* Name */, timeStrId);
  }

  // 10. Check if node is an expression / primary / unsigned_number wrapper
  if (nodeType == $.expression || nodeType == $.primary || nodeType == $.unsigned_number) {
    const firstChild = graph.ast.getFirstChild(node);
    if (firstChild != 0 && graph.ast.getNextSibling(firstChild) == 0) {
      return lowerExpression(graph, firstChild, prefixId, $);
    }
    if (graph.ast.startsWith(node, "(")) {
      let cur = graph.ast.getFirstChild(node);
      while (cur != 0) {
        if (graph.ast.getType(cur) == $.expression) {
          return lowerExpression(graph, cur, prefixId, $);
        }
        cur = graph.ast.getNextSibling(cur);
      }
    }
    for (const num of graph.ast.getDescendants(node, $.unsigned_integer)) {
      const val = graph.ast.parseInteger(num);
      return graph.dae.addExpression(1 /* IntLiteral */, val as u32);
    }
    for (const num of graph.ast.getDescendants(node, $.unsigned_real)) {
      const val = graph.ast.parseReal(num);
      return graph.dae.addRealLiteral(val);
    }
  }

  // 11. Subscripts: arr[subscripts]
  let subNode: u32 = 0;
  if ($.array_subscripts != 0) {
    for (const s of graph.ast.getDescendants(node, $.array_subscripts)) {
      subNode = s;
      break;
    }
  }

  // 12. Identifiers / Component References (Variables)
  let nameStrId: u32 = 0;
  for (const id of graph.ast.getDescendants(node, $.identifier)) {
    if (subNode != 0) {
      let isInsideSub = false;
      for (const anc of graph.ast.getAncestors(id, 0)) {
        if (anc == subNode) {
          isInsideSub = true;
          break;
        }
      }
      if (isInsideSub) continue;
    }

    let leafId = id;
    while (leafId != 0 && graph.ast.getFirstChild(leafId) != 0) leafId = graph.ast.getFirstChild(leafId);
    const segStrId = graph.scope.internNode(leafId);
    if (nameStrId == 0) {
      nameStrId = segStrId;
    } else {
      nameStrId = graph.scope.concatPrefix(nameStrId, segStrId);
    }
  }
  if (nameStrId == 0) {
    let leaf = node;
    while (leaf != 0 && graph.ast.getFirstChild(leaf) != 0) leaf = graph.ast.getFirstChild(leaf);
    nameStrId = graph.scope.internNode(leaf);
  }

  const fullNameId = prefixId != 0 ? graph.scope.concatPrefix(prefixId, nameStrId) : nameStrId;

  if (subNode != 0) {
    const subIds: u32[] = [];
    collectTopLevelExpressions(graph, subNode, subIds, prefixId, $);
    if (subIds.length > 0) {
      const baseVarExpr = graph.dae.addExpression(0 /* Name */, fullNameId);
      const subId = graph.dae.addExpression(8 /* Subscript */, baseVarExpr, subIds[0], subIds.length as u32);
      for (let i = 1; i < subIds.length; i++) {
        graph.dae.addExpression(15 /* Tuple */, 0, subIds[i], 0);
      }
      return subId;
    }
  }

  return graph.dae.addExpression(0 /* Name / Var */, fullNameId);
}

/**
 * 4-Pass Physical Modelica 3.7 Flattening Pipeline.
 * Lowers AST components, recursive sub-models, extends chains, equations,
 * and acausal connections into graph.dae (WASM Struct-of-Arrays).
 */
export const modelicaFlatteningPasses = [
  // Pass 1: Symbol & Scope Indexing
  (graph: CodeGraph) => {
    graph.scope.reset();
    graph.dae.reset();
  },

  // Pass 2: Component Instantiation & Hierarchical Lowering
  (graph: CodeGraph, rootNode: u32, $: Record<string, u16>) => {
    const docRoot = rootNode != 0 ? rootNode : graph.ast.getRootNode();
    if (docRoot == 0) return;

    let targetClass: u32 = 0;
    for (const spec of graph.ast.getDescendants(docRoot, $.long_class_specifier)) {
      for (const anc of graph.ast.getAncestors(spec, 0)) {
        if (graph.ast.getType(anc) == $.class_definition) {
          targetClass = anc;
          break;
        }
      }
    }
    if (targetClass == 0) return;

    const classStack: u32[] = [targetClass];
    const prefixStack: u32[] = [0];

    while (classStack.length > 0) {
      const classNode = classStack.pop();
      const prefixId = prefixStack.pop();

      // 1. Walk Extends Clauses
      if ($.extends_clause != 0) {
        for (const ext of graph.ast.getDescendants(classNode, $.extends_clause)) {
          let isInner = false;
          for (const anc of graph.ast.getAncestors(ext, 0)) {
            if (anc == classNode) break;
            if (graph.ast.getType(anc) == $.class_definition) {
              isInner = true;
              break;
            }
          }
          if (isInner) continue;

          for (const ts of graph.ast.getDescendants(ext, $.type_specifier)) {
            for (const def of graph.ast.getDescendants(docRoot, $.class_definition)) {
              if (def == classNode) continue;
              for (const spec of graph.ast.getDescendants(def, $.long_class_specifier)) {
                for (const id of graph.ast.getDescendants(spec, $.identifier)) {
                  let c1 = id;
                  while (c1 != 0 && graph.ast.getFirstChild(c1) != 0) c1 = graph.ast.getFirstChild(c1);
                  let c2 = ts;
                  while (c2 != 0 && graph.ast.getFirstChild(c2) != 0) c2 = graph.ast.getFirstChild(c2);
                  if (c1 != 0 && c2 != 0) {
                    const s1 = graph.scope.internNode(c1);
                    const s2 = graph.scope.internNode(c2);
                    if (graph.scope.equals(s1, s2)) {
                      classStack.push(def);
                      prefixStack.push(prefixId);
                    }
                  }
                  break;
                }
                break;
              }
            }
            break;
          }
        }
      }

      // 2. Walk Local Component Clauses
      for (const comp of graph.ast.getDescendants(classNode, $.component_clause)) {
        let isInner = false;
        for (const anc of graph.ast.getAncestors(comp, 0)) {
          if (anc == classNode) break;
          if (graph.ast.getType(anc) == $.class_definition) {
            isInner = true;
            break;
          }
        }
        if (isInner) continue;

        // 2a. Determine Primitive Type
        let varType: i32 = -1;
        let typeNode: u32 = 0;
        for (const ts of graph.ast.getDescendants(comp, $.type_specifier)) {
          typeNode = ts;
          let leafTs = ts;
          while (leafTs != 0 && graph.ast.getFirstChild(leafTs) != 0) leafTs = graph.ast.getFirstChild(leafTs);
          if (graph.ast.startsWith(leafTs, "Real") || graph.ast.textEquals(leafTs, "Real")) varType = 0;
          else if (graph.ast.startsWith(leafTs, "Integer") || graph.ast.textEquals(leafTs, "Integer")) varType = 1;
          else if (graph.ast.startsWith(leafTs, "Boolean") || graph.ast.textEquals(leafTs, "Boolean")) varType = 2;
          else if (graph.ast.startsWith(leafTs, "String") || graph.ast.textEquals(leafTs, "String")) varType = 3;
          else if (graph.ast.startsWith(leafTs, "Clock") || graph.ast.textEquals(leafTs, "Clock")) varType = 5;
          break;
        }

        // 2b. Determine Variability
        let variability: i32 = 0;
        for (const tp of graph.ast.getDescendants(comp, $.type_prefix)) {
          let leafTp = tp;
          while (leafTp != 0 && graph.ast.getFirstChild(leafTp) != 0) leafTp = graph.ast.getFirstChild(leafTp);
          if (graph.ast.startsWith(leafTp, "parameter") || graph.ast.textEquals(leafTp, "parameter")) variability = 2;
          else if (graph.ast.startsWith(leafTp, "constant") || graph.ast.textEquals(leafTp, "constant"))
            variability = 3;
          else if (graph.ast.startsWith(leafTp, "discrete") || graph.ast.textEquals(leafTp, "discrete"))
            variability = 1;
        }

        // 2c. Determine Causality
        let causality: i32 = 0;
        for (const tp of graph.ast.getDescendants(comp, $.type_prefix)) {
          let leafTp = tp;
          while (leafTp != 0 && graph.ast.getFirstChild(leafTp) != 0) leafTp = graph.ast.getFirstChild(leafTp);
          if (graph.ast.startsWith(leafTp, "input") || graph.ast.textEquals(leafTp, "input")) causality = 1;
          else if (graph.ast.startsWith(leafTp, "output") || graph.ast.textEquals(leafTp, "output")) causality = 2;
        }

        // 2d. Determine Flow Flag
        let flags: i32 = 0;
        for (const tp of graph.ast.getDescendants(comp, $.type_prefix)) {
          let leafTp = tp;
          while (leafTp != 0 && graph.ast.getFirstChild(leafTp) != 0) leafTp = graph.ast.getFirstChild(leafTp);
          if (graph.ast.startsWith(leafTp, "flow") || graph.ast.textEquals(leafTp, "flow")) flags |= 1 << 1;
        }

        // 2e. Process Component Declarations
        for (const decl of graph.ast.getDescendants(comp, $.declaration)) {
          let declId: u32 = 0;
          for (const id of graph.ast.getDescendants(decl, $.identifier)) {
            declId = id;
            break;
          }
          if (declId != 0) {
            const nameStrId = graph.scope.internNode(declId);
            const fullNameId = prefixId != 0 ? graph.scope.concatPrefix(prefixId, nameStrId) : nameStrId;

            // Extract array subscripts from declaration (e.g. x[9]) or component_clause (e.g. Real[9] x)
            const dims: i32[] = [];
            let subNode: u32 = 0;
            for (const s of graph.ast.getDescendants(decl, $.array_subscripts)) {
              subNode = s;
              break;
            }
            if (subNode == 0) {
              for (const s of graph.ast.getDescendants(comp, $.array_subscripts)) {
                subNode = s;
                break;
              }
            }
            if (subNode != 0) {
              const sz = graph.ast.parseInteger(subNode);
              if (sz > 0) dims.push(sz);
            }

            let varFlags = flags;
            if (dims.length > 0) {
              varFlags |= 1 << 4; // Array flag
            }

            if (varType >= 0) {
              const varIdx = graph.dae.addVariable(fullNameId, varType, variability, causality, 0.0, varFlags);
              for (let d = 0; d < dims.length; d++) {
                graph.dae.setVarShapeDim(varIdx, d as u32, dims[d]);
              }
            } else if (typeNode != 0) {
              for (const def of graph.ast.getDescendants(docRoot, $.class_definition)) {
                if (def == classNode) continue;
                for (const spec of graph.ast.getDescendants(def, $.long_class_specifier)) {
                  for (const id of graph.ast.getDescendants(spec, $.identifier)) {
                    let c1 = id;
                    while (c1 != 0 && graph.ast.getFirstChild(c1) != 0) c1 = graph.ast.getFirstChild(c1);
                    let c2 = typeNode;
                    while (c2 != 0 && graph.ast.getFirstChild(c2) != 0) c2 = graph.ast.getFirstChild(c2);
                    if (c1 != 0 && c2 != 0) {
                      const s1 = graph.scope.internNode(c1);
                      const s2 = graph.scope.internNode(c2);
                      if (graph.scope.equals(s1, s2)) {
                        classStack.push(def);
                        prefixStack.push(fullNameId);
                      }
                    }
                    break;
                  }
                  break;
                }
              }
            }
          }
        }
      }
    }
  },

  // Pass 3: Equation Lowering & Connector Port Balancing
  (graph: CodeGraph, rootNode: u32, $: Record<string, u16>) => {
    const docRoot = rootNode != 0 ? rootNode : graph.ast.getRootNode();
    if (docRoot == 0) return;

    let targetClass: u32 = 0;
    for (const spec of graph.ast.getDescendants(docRoot, $.long_class_specifier)) {
      for (const anc of graph.ast.getAncestors(spec, 0)) {
        if (graph.ast.getType(anc) == $.class_definition) {
          targetClass = anc;
          break;
        }
      }
    }
    if (targetClass == 0) return;

    const classStack: u32[] = [targetClass];
    const prefixStack: u32[] = [0];

    while (classStack.length > 0) {
      const classNode = classStack.pop();
      const prefixId = prefixStack.pop();

      // 1. Lower inherited equations from Extends Clauses
      if ($.extends_clause != 0) {
        for (const ext of graph.ast.getDescendants(classNode, $.extends_clause)) {
          let isInner = false;
          for (const anc of graph.ast.getAncestors(ext, 0)) {
            if (anc == classNode) break;
            if (graph.ast.getType(anc) == $.class_definition) {
              isInner = true;
              break;
            }
          }
          if (isInner) continue;

          for (const ts of graph.ast.getDescendants(ext, $.type_specifier)) {
            for (const def of graph.ast.getDescendants(docRoot, $.class_definition)) {
              if (def == classNode) continue;
              for (const spec of graph.ast.getDescendants(def, $.long_class_specifier)) {
                for (const id of graph.ast.getDescendants(spec, $.identifier)) {
                  let c1 = id;
                  while (c1 != 0 && graph.ast.getFirstChild(c1) != 0) c1 = graph.ast.getFirstChild(c1);
                  let c2 = ts;
                  while (c2 != 0 && graph.ast.getFirstChild(c2) != 0) c2 = graph.ast.getFirstChild(c2);
                  if (c1 != 0 && c2 != 0) {
                    const s1 = graph.scope.internNode(c1);
                    const s2 = graph.scope.internNode(c2);
                    if (graph.scope.equals(s1, s2)) {
                      classStack.push(def);
                      prefixStack.push(prefixId);
                    }
                  }
                  break;
                }
                break;
              }
            }
            break;
          }
        }
      }

      // 2. Simple Equations (lhs = rhs)
      if ($.simple_equation != 0) {
        for (const eq of graph.ast.getDescendants(classNode, $.simple_equation)) {
          let isInner = false;
          for (const anc of graph.ast.getAncestors(eq, 0)) {
            if (anc == classNode) break;
            if (graph.ast.getType(anc) == $.class_definition) {
              isInner = true;
              break;
            }
          }
          if (isInner) continue;

          let lhsNode = graph.ast.getChildByFieldId(eq, "lhs");
          let rhsNode = graph.ast.getChildByFieldId(eq, "rhs");
          if (lhsNode == 0 || rhsNode == 0) {
            const ch1 = graph.ast.getFirstChild(eq);
            if (ch1 != 0) {
              lhsNode = ch1;
              const ch2 = graph.ast.getNextSibling(ch1);
              if (ch2 != 0) {
                const ch3 = graph.ast.getNextSibling(ch2);
                rhsNode = ch3 != 0 ? ch3 : ch2;
              }
            }
          }
          if (lhsNode != 0 && rhsNode != 0) {
            let lhsExprId = lowerExpression(graph, lhsNode, prefixId, $);
            let rhsExprId = lowerExpression(graph, rhsNode, prefixId, $);
            if (isRealExpr(graph, lhsExprId) && !isRealExpr(graph, rhsExprId)) {
              rhsExprId = castToReal(graph, rhsExprId);
            } else if (!isRealExpr(graph, lhsExprId) && isRealExpr(graph, rhsExprId)) {
              lhsExprId = castToReal(graph, lhsExprId);
            }
            graph.dae.addEquation(0, lhsExprId, rhsExprId); // EqKind.Simple
          }
        }
      }

      // 3. Connect Equations (connect(lhs, rhs))
      if ($.connect_equation != 0) {
        for (const conn of graph.ast.getDescendants(classNode, $.connect_equation)) {
          let isInner = false;
          for (const anc of graph.ast.getAncestors(conn, 0)) {
            if (anc == classNode) break;
            if (graph.ast.getType(anc) == $.class_definition) {
              isInner = true;
              break;
            }
          }
          if (isInner) continue;

          const lhsNode = graph.ast.getChildByFieldId(conn, "lhs");
          const rhsNode = graph.ast.getChildByFieldId(conn, "rhs");
          if (lhsNode != 0 && rhsNode != 0) {
            const lhsExprId = lowerExpression(graph, lhsNode, prefixId, $);
            const rhsExprId = lowerExpression(graph, rhsNode, prefixId, $);
            graph.dae.addEquation(6, lhsExprId, rhsExprId); // EqKind.Connect
          }
        }
      }
    }
    graph.connectors.finalize();
  },

  // Pass 4: BLT Partitioning & Balance Analysis
  (graph: CodeGraph) => {
    graph.blt.computeBLT();
  },
];
