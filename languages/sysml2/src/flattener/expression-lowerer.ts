// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sysml2 — Direct Linear-Memory CST Expression Lowerer.
 *
 * Recursively translates GLR concrete syntax tree (CST) expression nodes directly into
 * `DAEBuilder` integer IDs (`ExprId`) in WebAssembly linear memory without intermediate
 * string slicing or wrapper object allocations.
 */

import { BinOp, type DAEBuilder, ExprKind, UnaryOp } from "@modelscript/runtime";
import { type SysmlCstNode, lowerSysmlExpr, prefixSysmlExpression } from "./cst-lowerer.js";

/**
 * Resolves a variable or port name by applying the hierarchical instance prefix
 * if its root identifier matches any known local attribute or port name in `localNames`.
 */
export function resolvePrefixedName(rawName: string, prefix: string, localNames: Set<string>): string {
  if (!prefix || localNames.size === 0) return rawName;
  const root = rawName.split(".")[0]!;
  if (localNames.has(root)) {
    return prefix + rawName;
  }
  return rawName;
}

/**
 * Strips transparent grammatical wrappers (precedence levels, feature wrappers, sequence wrappers)
 * down to the active expression node.
 */
export function unwrapCstNode(node: SysmlCstNode): SysmlCstNode {
  let curr: SysmlCstNode = node;
  while (curr) {
    const t = curr.type;
    if (
      t === "OwnedExpression" ||
      t === "OwnedExpressionMember" ||
      t === "OwnedExpressionReference" ||
      t === "_Expression" ||
      t === "_BaseExpression" ||
      t === "ExpressionBody" ||
      t === "ExpressionBodyMember" ||
      t === "BodyExpression" ||
      t === "ArgumentValue" ||
      t === "ArgumentMember" ||
      t === "Argument" ||
      t === "ImpliesExpressionReference" ||
      t === "ImpliesExpressionMember" ||
      t === "OrExpressionReference" ||
      t === "OrExpressionMember" ||
      t === "XorExpressionReference" ||
      t === "XorExpressionMember" ||
      t === "EqualityExpressionReference" ||
      t === "EqualityExpressionMember"
    ) {
      const children = curr.children || [];
      const child = children.find((c) => c && c.type !== "(" && c.type !== ")" && c.type !== "," && c.type !== ";");
      if (child) {
        curr = child;
        continue;
      }
    }

    // Single-element SequenceExpression: SequenceExpression -> OwnedExpression
    if (t === "SequenceExpression") {
      const children = curr.children || [];
      const nonPunct = children.filter((c) => c && c.type !== "(" && c.type !== ")" && c.type !== ",");
      if (nonPunct.length === 1 && nonPunct[0]) {
        curr = nonPunct[0];
        continue;
      }
    }

    // Parenthesized expression: "(" expr ")"
    if (
      curr.children &&
      curr.children.length === 3 &&
      curr.children[0]?.text === "(" &&
      curr.children[2]?.text === ")"
    ) {
      curr = curr.children[1]!;
      continue;
    }

    break;
  }
  return curr;
}

/**
 * Extracts the callee identifier string and argument CST nodes from an `InvocationExpression`.
 */
function extractInvocation(node: SysmlCstNode): { callee: string; args: SysmlCstNode[] } {
  let callee = "";
  const args: SysmlCstNode[] = [];

  const typeNode = node.childForFieldName?.("type") ?? node.children?.[0];
  if (typeNode) {
    callee = typeNode.text?.trim() || "";
  }

  // Find argument expressions within _ArgumentList
  const collectArgs = (n: SysmlCstNode) => {
    if (!n) return;
    if (n.type === "ArgumentMember" || n.type === "ArgumentValue" || n.type === "Argument") {
      const unwrapped = unwrapCstNode(n);
      args.push(unwrapped);
      return;
    }
    const count = n.childCount ?? n.children?.length ?? 0;
    for (let i = 0; i < count; i++) {
      const child = n.child ? n.child(i) : n.children?.[i];
      if (child) collectArgs(child);
    }
  };

  const count = node.childCount ?? node.children?.length ?? 0;
  for (let i = 0; i < count; i++) {
    const child = node.child ? node.child(i) : node.children?.[i];
    if (child && child !== typeNode) {
      collectArgs(child);
    }
  }

  return { callee, args };
}

/**
 * Lowers a SysML v2 / KerML CST expression node directly into an integer `ExprId` in `DAEBuilder`.
 *
 * @param rawNode - Raw GLR parser CST node.
 * @param arena - Destination linear-memory `DAEBuilder` arena.
 * @param prefix - Instance hierarchy path prefix (e.g. `"r1."`).
 * @param localNames - Known attributes and ports defined in the active component scope.
 * @returns Allocated `ExprId` index within `arena`.
 */
export function lowerDirectCstExpression(
  rawNode: SysmlCstNode | null | undefined,
  arena: DAEBuilder,
  prefix = "",
  localNames: Set<string> = new Set<string>(),
): number {
  if (!rawNode) return arena.addRealLiteral(0.0);

  const node = unwrapCstNode(rawNode);
  const nodeType = node.type;

  switch (nodeType) {
    // ── Literals ──
    case "LiteralInteger": {
      const val = parseInt(node.text.trim(), 10);
      return isNaN(val) ? arena.addIntLiteral(0) : arena.addIntLiteral(val);
    }

    case "LiteralReal": {
      const val = parseFloat(node.text.trim());
      return isNaN(val) ? arena.addRealLiteral(0.0) : arena.addRealLiteral(val);
    }

    case "LiteralBoolean":
    case "BooleanValue": {
      return arena.addBoolLiteral(node.text.trim() === "true");
    }

    case "LiteralInfinity":
      return arena.addRealLiteral(Infinity);

    case "NullExpression":
      return arena.addRealLiteral(0.0);

    case "LiteralString": {
      const clean = node.text.trim().replace(/^["']|["']$/g, "");
      return arena.addStringLiteral(clean);
    }

    // ── Variable & Feature References ──
    case "FeatureReferenceExpression":
    case "FeatureReferenceMember":
    case "Name":
    case "ID":
    case "UNRESTRICTED_NAME": {
      const rawName = node.text.trim();
      const resolved = resolvePrefixedName(rawName, prefix, localNames);
      const nameId = arena.interner.intern(resolved);
      return arena.addName(nameId);
    }

    case "PrimaryExpression": {
      // Dotted feature chains like p.v, r1.n.v or array indexing arr[1]
      const rawText = node.text.trim();
      // If it contains an operator or invocation syntax, parse recursively
      if (!rawText.includes("(") && !rawText.includes("+") && !rawText.includes("-") && !rawText.includes("*")) {
        const resolved = resolvePrefixedName(rawText, prefix, localNames);
        const nameId = arena.interner.intern(resolved);
        return arena.addName(nameId);
      }
      break;
    }

    // ── Invocations & Functions (der, sqrt, sin, cos, etc.) ──
    case "InvocationExpression": {
      const { callee, args } = extractInvocation(node);
      const loweredArgs = args.map((a) => lowerDirectCstExpression(a, arena, prefix, localNames));

      if (callee === "der" && loweredArgs.length === 1) {
        return arena.addDerExpr(loweredArgs[0]!);
      }
      if (callee) {
        return arena.addCallExpr(callee, loweredArgs);
      }
      break;
    }

    // ── Unary Operators (+, -, ~, not) ──
    case "UnaryExpression": {
      const opNode = node.childForFieldName?.("operator");
      const opText = opNode ? opNode.text.trim() : node.children?.[0]?.text.trim() || "";
      const operandNode =
        node.childForFieldName?.("operand") ??
        node.children?.find(
          (c) => c !== opNode && c.type !== "+" && c.type !== "-" && c.type !== "~" && c.type !== "not",
        );

      const operandId = lowerDirectCstExpression(operandNode, arena, prefix, localNames);

      if (opText === "-") {
        if (arena.getExprKind(operandId) === ExprKind.Binary && arena.getExprData1(operandId) === BinOp.Mul) {
          const leftId = arena.getExprLeft(operandId);
          const rightId = arena.getExprRight(operandId);
          const negLeft = arena.addUnaryExpr(UnaryOp.Negate, leftId);
          return arena.addBinaryExpr(BinOp.Mul, negLeft, rightId);
        }
        return arena.addUnaryExpr(UnaryOp.Negate, operandId);
      }
      if (opText === "not" || opText === "~" || opText === "!") {
        return arena.addUnaryExpr(UnaryOp.Not, operandId);
      }
      if (opText === "+") {
        return operandId;
      }
      break;
    }

    // ── Binary Arithmetic & Relations ──
    case "AdditiveExpression":
    case "MultiplicativeExpression":
    case "RelationalExpression":
    case "EqualityExpression":
    case "AndExpression":
    case "OrExpression":
    case "XorExpression":
    case "ImpliesExpression":
    case "ExponentiationExpression":
    case "BinaryExpression": {
      return lowerBinaryChainedExpression(node, arena, prefix, localNames);
    }
  }

  // Robust fallback: if node shape is unconventional or grammar contains dynamic constructs,
  // parse using the zero-dependency Pratt SysmlExprParser.
  const text = node.text?.trim() || "";
  if (!text) return arena.addRealLiteral(0.0);
  const prefixed = prefixSysmlExpression(text, prefix, localNames);
  return lowerSysmlExpr(prefixed, arena);
}

/**
 * Lowers left-associative chained binary expressions directly into `DAEBuilder` binary operators.
 */
function lowerBinaryChainedExpression(
  node: SysmlCstNode,
  arena: DAEBuilder,
  prefix: string,
  localNames: Set<string>,
): number {
  // 1. Try field-based access
  let operands = node.childrenForFieldName?.("operand") ?? [];
  let operators = node.childrenForFieldName?.("operator") ?? [];

  // 2. If fields not populated, decompose from children
  if (operands.length < 2 && node.children && node.children.length >= 3) {
    const exprChildren: SysmlCstNode[] = [];
    const opChildren: SysmlCstNode[] = [];
    for (const c of node.children) {
      const txt = c.text.trim();
      if (
        txt === "+" ||
        txt === "-" ||
        txt === "*" ||
        txt === "/" ||
        txt === "%" ||
        txt === "^" ||
        txt === "**" ||
        txt === "==" ||
        txt === "!=" ||
        txt === "===" ||
        txt === "!==" ||
        txt === "<" ||
        txt === "<=" ||
        txt === ">" ||
        txt === ">=" ||
        txt === "&&" ||
        txt === "and" ||
        txt === "||" ||
        txt === "or" ||
        txt === "xor" ||
        txt === "implies"
      ) {
        opChildren.push(c);
      } else if (txt && txt !== "(" && txt !== ")") {
        exprChildren.push(c);
      }
    }
    if (exprChildren.length >= 2 && opChildren.length >= 1) {
      operands = exprChildren;
      operators = opChildren;
    }
  }

  // 3. Fallback to base/exponent for ExponentiationExpression
  if (operands.length < 2 && node.type === "ExponentiationExpression") {
    const baseNode = node.childForFieldName?.("base");
    const expNode = node.childForFieldName?.("exponent");
    if (baseNode && expNode) {
      const left = lowerDirectCstExpression(baseNode, arena, prefix, localNames);
      const right = lowerDirectCstExpression(expNode, arena, prefix, localNames);
      return arena.addBinaryExpr(BinOp.Pow, left, right);
    }
  }

  if (operands.length < 2) {
    // Fall back to Pratt token parser
    const text = node.text?.trim() || "";
    const prefixed = prefixSysmlExpression(text, prefix, localNames);
    return lowerSysmlExpr(prefixed, arena);
  }

  // Detect GLR grammar precedence inversions:
  // In standard mathematical notation, multiplicative operators (*, /, %) have strictly higher
  // precedence than additive operators (+, -). If the GLR parser reduced a MultiplicativeExpression
  // with an unparenthesized Additive child, or an AdditiveExpression with an inverted Multiplicative child,
  // fall back to the exact Pratt parser which strictly adheres to operator precedence hierarchies.
  if (node.type === "MultiplicativeExpression") {
    const hasUnparenthesizedAdditive = operands.some((op) => {
      const unwrapped = unwrapCstNode(op);
      const trimmed = op.text.trim();
      return unwrapped.type === "AdditiveExpression" && !(trimmed.startsWith("(") && trimmed.endsWith(")"));
    });
    if (hasUnparenthesizedAdditive) {
      const text = node.text?.trim() || "";
      const prefixed = prefixSysmlExpression(text, prefix, localNames);
      return lowerSysmlExpr(prefixed, arena);
    }
  }

  if (node.type === "AdditiveExpression") {
    const hasInvertedChild = operands.some((op) => {
      const unwrapped = unwrapCstNode(op);
      if (unwrapped.type === "MultiplicativeExpression") {
        const mulOperands = unwrapped.childrenForFieldName?.("operand") ?? unwrapped.children ?? [];
        return mulOperands.some((mop) => {
          const u = unwrapCstNode(mop);
          const trimmed = mop.text.trim();
          return u.type === "AdditiveExpression" && !(trimmed.startsWith("(") && trimmed.endsWith(")"));
        });
      }
      return false;
    });
    if (hasInvertedChild) {
      const text = node.text?.trim() || "";
      const prefixed = prefixSysmlExpression(text, prefix, localNames);
      return lowerSysmlExpr(prefixed, arena);
    }
  }

  let leftId = lowerDirectCstExpression(operands[0]!, arena, prefix, localNames);

  for (let i = 0; i < operators.length && i + 1 < operands.length; i++) {
    const op = operators[i]!.text.trim();
    const rightId = lowerDirectCstExpression(operands[i + 1]!, arena, prefix, localNames);

    switch (op) {
      case "+":
        leftId = arena.addBinaryExpr(BinOp.Add, leftId, rightId);
        break;
      case "-":
        leftId = arena.addBinaryExpr(BinOp.Sub, leftId, rightId);
        break;
      case "*":
        leftId = arena.addBinaryExpr(BinOp.Mul, leftId, rightId);
        break;
      case "/":
        leftId = arena.addBinaryExpr(BinOp.Div, leftId, rightId);
        break;
      case "%":
        leftId = arena.addCallExpr("mod", [leftId, rightId]);
        break;
      case "^":
      case "**":
        leftId = arena.addBinaryExpr(BinOp.Pow, leftId, rightId);
        break;
      case "==":
      case "===":
        leftId = arena.addBinaryExpr(BinOp.Eq, leftId, rightId);
        break;
      case "!=":
      case "!==":
        leftId = arena.addBinaryExpr(BinOp.Neq, leftId, rightId);
        break;
      case "<":
        leftId = arena.addBinaryExpr(BinOp.Lt, leftId, rightId);
        break;
      case "<=":
        leftId = arena.addBinaryExpr(BinOp.Lte, leftId, rightId);
        break;
      case ">":
        leftId = arena.addBinaryExpr(BinOp.Gt, leftId, rightId);
        break;
      case ">=":
        leftId = arena.addBinaryExpr(BinOp.Gte, leftId, rightId);
        break;
      case "&&":
      case "and":
        leftId = arena.addBinaryExpr(BinOp.And, leftId, rightId);
        break;
      case "||":
      case "or":
        leftId = arena.addBinaryExpr(BinOp.Or, leftId, rightId);
        break;
      default:
        leftId = arena.addBinaryExpr(BinOp.Add, leftId, rightId);
        break;
    }
  }

  return leftId;
}
