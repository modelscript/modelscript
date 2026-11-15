// SPDX-License-Identifier: AGPL-3.0-or-later

import type { QueryDB } from "@modelscript/runtime";
import { extractSysML2Constraints, type ExtractedConstraint } from "../constraint-extractor.js";
import {
  collectCstLeaves,
  findCstDescendants,
  findFirstDescendant,
  findMatchingBraceLeaf,
  isDottedIdentText,
  isSysmlIdentLeaf,
  isUnsignedNumberText,
  parseSysmlSource,
  stripLeadingChars,
  tokenizeSysmlExpressionCst,
  trimTrailingSemicolon,
  type SysmlCstNode,
} from "../cst-utils.js";
import { parseSysML2Expression, type SysML2ExprAst } from "../evaluator.js";

export interface SmtFunctionDef {
  name: string;
  params: { name: string; type?: string | undefined }[];
  returnType?: string | undefined;
  body: string;
}

export interface SmtLibExportOptions {
  logic?: "QF_LRA" | "QF_NRA" | "QF_IDL" | "ALL" | undefined;
  scopeFilter?: string | undefined;
  produceModels?: boolean | undefined;
  functions?: SmtFunctionDef[] | undefined;
  minimize?: string[] | undefined;
  maximize?: string[] | undefined;
}

function hasNonlinearOp(expr: string): boolean {
  return expr.includes("*") || expr.includes("^") || expr.includes("/");
}

function trimReturnExpr(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let s = raw.trim();
  if (s.startsWith("return") && (s.length === 6 || s[6] === " " || s[6] === "\t" || s[6] === "\n")) {
    s = s.slice(6).trim();
  }
  return trimTrailingSemicolon(s);
}

const SMT_BINARY_OP_MAP: Record<string, string> = {
  "==": "=",
  "!=": "distinct",
  implies: "=>",
};

function isSmtPrefixSexpr(trimmed: string): boolean {
  if (!trimmed.startsWith("(") || !trimmed.endsWith(")")) return false;
  const toks = tokenizeSysmlExpressionCst(trimmed);
  if (toks[0]?.text !== "(" || toks.length < 3) return false;
  const head = toks[1]!;
  if (head.type === "op") {
    if ((head.text === "-" || head.text === "+") && toks[3]?.text === ")") {
      return false;
    }
    return true;
  }
  if (head.type === "ident") {
    const third = toks[2];
    return Boolean(third && (third.type === "ident" || third.type === "number" || third.text === "("));
  }
  return false;
}

function evalAstToSmt(node: SysML2ExprAst): string {
  switch (node.kind) {
    case "NumberLiteral":
      return Number.isInteger(node.value) ? `${node.value}.0` : String(node.value);
    case "BooleanLiteral":
      return node.value ? "true" : "false";
    case "StringLiteral":
      return JSON.stringify(node.value);
    case "Identifier":
      return node.name.replaceAll(".", "_");
    case "UnaryExpr": {
      const arg = evalAstToSmt(node.operand);
      if (node.op === "+") return arg;
      return `(${node.op} ${arg})`;
    }
    case "BinaryExpr": {
      const l = evalAstToSmt(node.left);
      const r = evalAstToSmt(node.right);
      if (node.op === "^") {
        if (node.right.kind === "NumberLiteral" && node.right.value === 2) {
          return `(* ${l} ${l})`;
        }
        return `(^ ${l} ${r})`;
      }
      const smtOp = SMT_BINARY_OP_MAP[node.op] ?? node.op;
      return `(${smtOp} ${l} ${r})`;
    }
    case "ConditionalExpr":
      return `(ite ${evalAstToSmt(node.condition)} ${evalAstToSmt(node.thenExpr)} ${evalAstToSmt(node.elseExpr)})`;
    case "CallExpr": {
      const args = node.args.map(evalAstToSmt);
      return args.length > 0
        ? `(${node.callee.replaceAll(".", "_")} ${args.join(" ")})`
        : node.callee.replaceAll(".", "_");
    }
  }
}

/**
 * Converts a CST expression node into an SMT-LIB2 prefix S-expression string.
 */
function cstToSmt(node: SysmlCstNode | null | undefined): string | null {
  if (!node) return null;
  // Unwrap wrapper nodes
  while (
    node.type === "OwnedExpression" ||
    node.type === "SequenceExpression" ||
    node.type === "ResultExpressionMember" ||
    node.type === "_Expression" ||
    node.type === "_BaseExpression"
  ) {
    const inner: SysmlCstNode | null | undefined =
      node.childForFieldName?.("ownedRelatedElement") ||
      ((node.childCount ?? 0) > 0 ? (node.child ? node.child(0) : node.children?.[0]) : null);
    if (inner && inner !== node) {
      node = inner;
    } else {
      break;
    }
  }

  const count = node.childCount ?? 0;

  // Parenthesized: ( expr )
  if (count >= 3) {
    const first = node.child ? node.child(0) : node.children?.[0];
    const last = node.child ? node.child(count - 1) : node.children?.[count - 1];
    if (first?.text === "(" && last?.text === ")") {
      const inner = node.child ? node.child(1) : node.children?.[1];
      return cstToSmt(inner);
    }
  }

  // Binary expression
  if (count >= 3) {
    const op = node.child ? node.child(1)?.text : node.children?.[1]?.text;
    const left = cstToSmt(node.child ? node.child(0) : node.children?.[0]);
    const right = cstToSmt(node.child ? node.child(2) : node.children?.[2]);
    if (left !== null && right !== null && op) {
      if (op === "^" || op === "**") {
        if (right === "2" || right === "2.0") return `(* ${left} ${left})`;
      }
      return `(${op} ${left} ${right})`;
    }
  }

  // Unary expression
  if (count === 2) {
    const op = node.child ? node.child(0)?.text : node.children?.[0]?.text;
    const operand = cstToSmt(node.child ? node.child(1) : node.children?.[1]);
    if (op === "-" && operand !== null) return `(- ${operand})`;
    if (op === "+" && operand !== null) return operand;
  }

  // Number literal
  const nodeTrimmed = node.text.trim();
  if (isUnsignedNumberText(nodeTrimmed)) {
    const v = parseFloat(nodeTrimmed);
    return Number.isInteger(v) ? `${v}.0` : String(v);
  }

  // Identifier
  if (isDottedIdentText(nodeTrimmed)) {
    return nodeTrimmed.replaceAll(".", "_");
  }

  return null;
}

export function infixArithmeticToSmt(expr: string): string {
  const trimmed = expr.trim();
  if (!trimmed) return "0.0";
  // If already in prefix SMT form e.g. "(* x x)", return directly
  if (isSmtPrefixSexpr(trimmed)) {
    return trimmed;
  }
  // Fast path for single identifier or number
  if (isDottedIdentText(trimmed)) {
    return trimmed.replaceAll(".", "_");
  }
  const num = parseFloat(trimmed);
  if (!isNaN(num) && String(num) === trimmed) {
    return Number.isInteger(num) ? `${num}.0` : String(num);
  }

  // Fast-path: Native WASM GLR parser
  try {
    const root = parseSysmlSource(`calc def __E { return ${trimmed}; }`);
    if (root && !root.hasError) {
      const retNode =
        findFirstDescendant(root, "ReturnStatement") || findFirstDescendant(root, "ResultExpressionMember");
      if (retNode) {
        const exprChild =
          (retNode.childCount ?? 0) > 1
            ? retNode.child
              ? retNode.child(1)
              : retNode.children?.[1]
            : retNode.child
              ? retNode.child(0)
              : retNode.children?.[0];
        const smt = cstToSmt(exprChild);
        if (smt) return smt;
      }
    }
  } catch {
    // Fallback to evaluator expression AST
  }

  try {
    return evalAstToSmt(parseSysML2Expression(trimmed));
  } catch {
    return trimmed.replaceAll(".", "_");
  }
}

export function extractVariablesFromArithmetic(expr: string): string[] {
  try {
    const root = parseSysmlSource(`calc def __E { return ${expr.trim()}; }`);
    if (root && !root.hasError) {
      const vars: string[] = [];
      const idents = findCstDescendants(root, "Identification") || [];
      for (const idNode of idents) {
        if (idNode.text && idNode.text !== "__E") vars.push(idNode.text.replaceAll(".", "_"));
      }
      if (vars.length > 0) return vars;
    }
  } catch {
    // Fallback to CST expression token stream
  }

  const tokens = tokenizeSysmlExpressionCst(expr);
  const vars: string[] = [];
  for (const t of tokens) {
    if (t.type === "ident" && t.text !== "true" && t.text !== "false") {
      vars.push(t.text.replaceAll(".", "_"));
    }
  }
  return vars;
}

/**
 * Converts an infix comparison expression to prefix SMT-LIB2 syntax.
 * e.g. "x - y <= 5.0" -> "(<= (- x y) 5.0)"
 * e.g. "speed <= 100" -> "(<= speed 100.0)"
 * e.g. "x * y + z <= 10.0" -> "(<= (+ (* x y) z) 10.0)"
 */
export function expressionToSmtLib(c: ExtractedConstraint): string {
  const rhsNum = typeof c.rhs === "number" ? c.rhs : parseFloat(String(c.rhs));
  const rhsStr = Number.isFinite(rhsNum)
    ? Number.isInteger(rhsNum)
      ? `${rhsNum}.0`
      : rhsNum.toString()
    : infixArithmeticToSmt(String(c.rhs));

  const lhsSmt = infixArithmeticToSmt(c.lhs);

  const opMap: Record<string, string> = {
    "<=": "<=",
    "<": "<",
    ">=": ">=",
    ">": ">",
    "==": "=",
    "!=": "distinct",
  };

  const smtOp = opMap[c.operator] || "=";
  return `(${smtOp} ${lhsSmt} ${rhsStr})`;
}

/**
 * Extracts SysML v2 calc def and action def user functions into SMT-LIB define-fun statements.
 */
function extractUserFunctionsFromDb(db: QueryDB): SmtFunctionDef[] {
  const funcs: SmtFunctionDef[] = [];
  const entries = db.allEntries();
  const dbWithCst = db as { cstNode?(id: number): SysmlCstNode | null | undefined };

  for (const e of entries) {
    if (e.ruleName === "CalculationDefinition" || e.ruleName === "ActionDefinition") {
      let extracted: SmtFunctionDef | null = null;

      // 1. Direct CST inspection if QueryDB provides cstNode
      if (typeof dbWithCst.cstNode === "function") {
        try {
          const cst = dbWithCst.cstNode(e.id);
          if (cst) {
            const nameNode = findFirstDescendant(cst, "Name") || findFirstDescendant(cst, "ID");
            const name = nameNode?.text?.trim();
            if (name) {
              const params: { name: string; type?: string | undefined }[] = [];
              const paramNodes = [...findCstDescendants(cst, "Parameter"), ...findCstDescendants(cst, "InUsage")];
              for (const pn of paramNodes) {
                const pName = (findFirstDescendant(pn, "Name") || findFirstDescendant(pn, "ID"))?.text?.trim();
                const pType = stripLeadingChars(findFirstDescendant(pn, "FeatureTyping")?.text, ": \t\r\n");
                if (pName) {
                  params.push({ name: pName, type: pType || "Real" });
                }
              }

              const retNode = findFirstDescendant(cst, "ReturnFeature") || findFirstDescendant(cst, "FeatureTyping");
              const returnType = stripLeadingChars(retNode?.text, ": \t\r\n") || "Real";

              const returnExpr =
                findFirstDescendant(cst, "ResultExpressionMember") ||
                findFirstDescendant(cst, "ReturnStatement") ||
                findFirstDescendant(cst, "OwnedExpression");
              const bodyText = trimReturnExpr(returnExpr?.text);

              if (bodyText) {
                extracted = {
                  name,
                  params,
                  returnType: returnType === "Real" || returnType === "Integer" ? "Real" : returnType,
                  body: infixArithmeticToSmt(bodyText),
                };
              }
            }
          }
        } catch {
          // CST inspection fallback
        }
      }

      if (extracted) {
        funcs.push(extracted);
        continue;
      }

      // 2. Textual fallback via WASM CST leaves for mock QueryDB
      const text = db.cstText(e.startOffset, e.endOffset, e);
      if (!text) continue;

      const leaves = collectCstLeaves(parseSysmlSource(text));
      for (let i = 0; i + 4 < leaves.length; i++) {
        const kw = leaves[i]!.text;
        if ((kw !== "calc" && kw !== "action") || leaves[i + 1]!.text !== "def") continue;
        const name = leaves[i + 2]!.text;
        if (!isSysmlIdentLeaf(name) || leaves[i + 3]!.text !== "(") continue;

        let closeParen = i + 4;
        let parenDepth = 1;
        while (closeParen < leaves.length && parenDepth > 0) {
          if (leaves[closeParen]!.text === "(") parenDepth++;
          else if (leaves[closeParen]!.text === ")") parenDepth--;
          if (parenDepth === 0) break;
          closeParen++;
        }
        if (parenDepth !== 0) continue;

        const params: { name: string; type?: string | undefined }[] = [];
        let pIdx = i + 4;
        while (pIdx < closeParen) {
          let pEnd = pIdx;
          while (pEnd < closeParen && leaves[pEnd]!.text !== ",") pEnd++;
          for (let k = pIdx; k < pEnd; k++) {
            const pName = leaves[k]!.text;
            if (isSysmlIdentLeaf(pName) && pName !== "in" && pName !== "attribute" && pName !== "item") {
              const pType =
                leaves[k + 1]?.text === ":" && k + 2 < pEnd && isSysmlIdentLeaf(leaves[k + 2]?.text)
                  ? leaves[k + 2]!.text
                  : "Real";
              params.push({ name: pName, type: pType });
              break;
            }
          }
          pIdx = pEnd + 1;
        }

        let afterParen = closeParen + 1;
        let returnType = "Real";
        if (leaves[afterParen]?.text === ":" && isSysmlIdentLeaf(leaves[afterParen + 1]?.text)) {
          returnType = leaves[afterParen + 1]!.text;
          afterParen += 2;
        }
        if (leaves[afterParen]?.text !== "{") continue;

        const closeBrace = findMatchingBraceLeaf(leaves, afterParen);
        let bodyStartIdx = afterParen + 1;
        const retIdx = leaves.slice(afterParen + 1, closeBrace).findIndex((lf) => lf.text === "return");
        if (retIdx !== -1) {
          bodyStartIdx = afterParen + 1 + retIdx + 1;
        }
        let bodyEndIdx = bodyStartIdx;
        while (bodyEndIdx < closeBrace && leaves[bodyEndIdx]!.text !== ";") {
          bodyEndIdx++;
        }
        const bodyExpr =
          bodyEndIdx > bodyStartIdx
            ? text.slice(leaves[bodyStartIdx]!.start, leaves[bodyEndIdx - 1]!.end).trim()
            : "0.0";

        funcs.push({
          name,
          params,
          returnType: returnType === "Real" || returnType === "Integer" ? "Real" : returnType,
          body: infixArithmeticToSmt(bodyExpr),
        });
        break;
      }
    }
  }

  return funcs;
}

/**
 * Exports SysML v2 extracted constraints into standard SMT-LIB v2 text.
 */
export function exportToSmtLib(db: QueryDB, options: SmtLibExportOptions = {}): string {
  const constraints = extractSysML2Constraints(db, options.scopeFilter);

  // Auto-detect nonlinear arithmetic
  let hasNonlinear = false;
  for (const c of constraints) {
    if (hasNonlinearOp(c.lhs) || (typeof c.rhs === "string" && hasNonlinearOp(c.rhs))) {
      hasNonlinear = true;
      break;
    }
  }
  if (!hasNonlinear && options.minimize?.some((e) => hasNonlinearOp(e))) hasNonlinear = true;
  if (!hasNonlinear && options.maximize?.some((e) => hasNonlinearOp(e))) hasNonlinear = true;
  if (!hasNonlinear && options.functions?.some((f) => hasNonlinearOp(f.body))) hasNonlinear = true;

  const logic = options.logic || (hasNonlinear ? "QF_NRA" : "QF_LRA");

  const lines: string[] = [];
  lines.push(`; SMT-LIB v2 generated by ModelScript Formal Verification Bridge`);
  lines.push(`; Scope: ${options.scopeFilter || "global"}`);
  lines.push(`(set-logic ${logic})`);
  lines.push(`(set-option :produce-models ${options.produceModels ?? true})`);
  lines.push("");

  // Collect and emit user functions (define-fun)
  const funcs: SmtFunctionDef[] = [...(options.functions ?? []), ...extractUserFunctionsFromDb(db)];
  const functionNames = new Set(funcs.map((f) => f.name));

  if (funcs.length > 0) {
    lines.push("; Function Definitions (calc def / action def)");
    for (const f of funcs) {
      const paramList = f.params.map((p) => `(${p.name} ${p.type ?? "Real"})`).join(" ");
      const retType = f.returnType ?? "Real";
      const bodySmt = infixArithmeticToSmt(f.body);
      lines.push(`(define-fun ${f.name} (${paramList}) ${retType} ${bodySmt})`);
    }
    lines.push("");
  }

  // Collect all unique variables
  const variables = new Set<string>();
  for (const c of constraints) {
    for (const v of extractVariablesFromArithmetic(c.lhs)) {
      if (!functionNames.has(v)) variables.add(v);
    }
    if (typeof c.rhs === "string") {
      for (const v of extractVariablesFromArithmetic(c.rhs)) {
        if (!functionNames.has(v)) variables.add(v);
      }
    }
  }

  // Declare constants
  lines.push("; Variable Declarations");
  for (const v of Array.from(variables).sort()) {
    lines.push(`(declare-const ${v} Real)`);
  }
  lines.push("");

  // Assert constraints
  lines.push("; Assertions");
  for (const c of constraints) {
    const smtExpr = expressionToSmtLib(c);
    const comment = c.requirementName ? ` ; from requirement ${c.requirementName}` : "";
    lines.push(`(assert ${smtExpr})${comment}`);
  }
  lines.push("");

  // Optimization Objectives (minimize / maximize)
  if (options.minimize && options.minimize.length > 0) {
    lines.push("; Optimization Objectives");
    for (const minExpr of options.minimize) {
      lines.push(`(minimize ${infixArithmeticToSmt(minExpr)})`);
    }
    lines.push("");
  }
  if (options.maximize && options.maximize.length > 0) {
    if (!options.minimize || options.minimize.length === 0) lines.push("; Optimization Objectives");
    for (const maxExpr of options.maximize) {
      lines.push(`(maximize ${infixArithmeticToSmt(maxExpr)})`);
    }
    lines.push("");
  }

  // Check satisfiability
  lines.push("(check-sat)");
  if (options.produceModels ?? true) {
    lines.push("(get-model)");
  }

  return lines.join("\n");
}
