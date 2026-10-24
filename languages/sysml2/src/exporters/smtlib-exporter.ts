// SPDX-License-Identifier: AGPL-3.0-or-later

import type { QueryDB } from "@modelscript/runtime";
import { type ExtractedConstraint, extractSysML2Constraints } from "../constraint-extractor.js";
import { findCstDescendants, findFirstDescendant } from "../flattener/cst-lowerer.js";
import { getSysmlParser } from "../sysml2-dae-lowerer.js";

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

type Token =
  | { type: "num"; value: number }
  | { type: "ident"; value: string }
  | { type: "op"; value: string }
  | { type: "lparen" }
  | { type: "rparen" };

function tokenizeArithmetic(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ type: "lparen" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "rparen" });
      i++;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/" || ch === "^") {
      tokens.push({ type: "op", value: ch });
      i++;
      continue;
    }
    // Number: digits and optional dot
    if (/[0-9]/.test(ch)) {
      let numStr = "";
      while (i < expr.length && /[0-9.eE+-]/.test(expr[i]!)) {
        // If '+' or '-' appears, ensure it's exponent
        const curr = expr[i]!;
        if ((curr === "+" || curr === "-") && !/[eE]/.test(expr[i - 1] ?? "")) {
          break;
        }
        numStr += curr;
        i++;
      }
      tokens.push({ type: "num", value: parseFloat(numStr) });
      continue;
    }
    // Identifier: letter or underscore, followed by alphanumeric, dot, or underscore
    if (/[a-zA-Z_]/.test(ch)) {
      let identStr = "";
      while (i < expr.length && /[a-zA-Z0-9_.]/.test(expr[i]!)) {
        identStr += expr[i]!;
        i++;
      }
      tokens.push({ type: "ident", value: identStr.replace(/\./g, "_") });
      continue;
    }
    i++;
  }
  return tokens;
}

interface AstNode {
  kind: "num" | "ident" | "unary" | "binary";
  op?: string | undefined;
  val?: number | undefined;
  name?: string | undefined;
  left?: AstNode | undefined;
  right?: AstNode | undefined;
}

function parseArithmeticExpr(tokens: Token[]): AstNode {
  let pos = 0;

  function peek(): Token | undefined {
    return tokens[pos];
  }

  function consume(): Token {
    return tokens[pos++]!;
  }

  // E -> T ( ('+' | '-') T )*
  function parseE(): AstNode {
    let left = parseT();
    while (true) {
      const t = peek();
      if (t && t.type === "op" && (t.value === "+" || t.value === "-")) {
        consume();
        const right = parseT();
        left = { kind: "binary", op: t.value, left, right };
      } else {
        break;
      }
    }
    return left;
  }

  // T -> F ( ('*' | '/') F )*
  function parseT(): AstNode {
    let left = parseF();
    while (true) {
      const t = peek();
      if (t && t.type === "op" && (t.value === "*" || t.value === "/")) {
        consume();
        const right = parseF();
        left = { kind: "binary", op: t.value, left, right };
      } else {
        break;
      }
    }
    return left;
  }

  // F -> P ( '^' P )*
  function parseF(): AstNode {
    let left = parseP();
    while (true) {
      const t = peek();
      if (t && t.type === "op" && t.value === "^") {
        consume();
        const right = parseP();
        left = { kind: "binary", op: "^", left, right };
      } else {
        break;
      }
    }
    return left;
  }

  // P -> '-' P | '(' E ')' | num | ident
  function parseP(): AstNode {
    const t = peek();
    if (!t) return { kind: "num", val: 0 };

    if (t.type === "op" && t.value === "-") {
      consume();
      const child = parseP();
      return { kind: "unary", op: "-", left: child };
    }
    if (t.type === "lparen") {
      consume();
      const e = parseE();
      if (peek() && peek()!.type === "rparen") {
        consume();
      }
      return e;
    }
    if (t.type === "num") {
      consume();
      return { kind: "num", val: t.value };
    }
    if (t.type === "ident") {
      consume();
      return { kind: "ident", name: t.value };
    }
    consume();
    return { kind: "num", val: 0 };
  }

  return parseE();
}

function astToSmt(node: AstNode): string {
  switch (node.kind) {
    case "num": {
      const v = node.val ?? 0;
      return Number.isInteger(v) ? `${v}.0` : String(v);
    }
    case "ident":
      return node.name ?? "x";
    case "unary":
      return `(- ${astToSmt(node.left!)})`;
    case "binary": {
      const op = node.op!;
      const l = astToSmt(node.left!);
      const r = astToSmt(node.right!);
      if (op === "^") {
        if (node.right?.kind === "num" && node.right.val === 2) {
          return `(* ${l} ${l})`;
        }
        return `(^ ${l} ${r})`;
      }
      return `(${op} ${l} ${r})`;
    }
  }
}

/**
 * Converts a CST expression node into an SMT-LIB2 prefix S-expression string.
 */
function cstToSmt(node: any): string | null {
  if (!node) return null;
  // Unwrap wrapper nodes
  while (
    node &&
    (node.type === "OwnedExpression" ||
      node.type === "SequenceExpression" ||
      node.type === "ResultExpressionMember" ||
      node.type === "_Expression" ||
      node.type === "_BaseExpression")
  ) {
    const inner =
      node.childForFieldName?.("ownedRelatedElement") ||
      (node.childCount > 0 ? (node.child ? node.child(0) : node.children[0]) : null);
    if (inner && inner !== node) {
      node = inner;
    } else {
      break;
    }
  }

  // Parenthesized: ( expr )
  if (node.childCount >= 3) {
    const first = node.child ? node.child(0) : node.children[0];
    const last = node.child ? node.child(node.childCount - 1) : node.children[node.childCount - 1];
    if (first?.text === "(" && last?.text === ")") {
      const inner = node.child ? node.child(1) : node.children[1];
      return cstToSmt(inner);
    }
  }

  // Binary expression
  if (node.childCount >= 3) {
    const op = node.child ? node.child(1)?.text : node.children[1]?.text;
    const left = cstToSmt(node.child ? node.child(0) : node.children[0]);
    const right = cstToSmt(node.child ? node.child(2) : node.children[2]);
    if (left !== null && right !== null && op) {
      if (op === "^" || op === "**") {
        if (right === "2" || right === "2.0") return `(* ${left} ${left})`;
      }
      return `(${op} ${left} ${right})`;
    }
  }

  // Unary expression
  if (node.childCount === 2) {
    const op = node.child ? node.child(0)?.text : node.children[0]?.text;
    const operand = cstToSmt(node.child ? node.child(1) : node.children[1]);
    if (op === "-" && operand !== null) return `(- ${operand})`;
    if (op === "+" && operand !== null) return operand;
  }

  // Number literal
  if (/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(node.text)) {
    const v = parseFloat(node.text);
    return Number.isInteger(v) ? `${v}.0` : String(v);
  }

  // Identifier
  if (/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(node.text)) {
    return node.text.replace(/\./g, "_");
  }

  return null;
}

export function infixArithmeticToSmt(expr: string): string {
  const trimmed = expr.trim();
  if (!trimmed) return "0.0";
  // If already in prefix SMT form e.g. "(* x x)", return directly
  if (/^\(\s*[-+*/^=<>a-zA-Z]/.test(trimmed) && trimmed.endsWith(")")) {
    return trimmed;
  }
  // Fast path for single identifier or number
  if (/^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(trimmed)) {
    return trimmed.replace(/\./g, "_");
  }
  const num = parseFloat(trimmed);
  if (!isNaN(num) && String(num) === trimmed) {
    return Number.isInteger(num) ? `${num}.0` : String(num);
  }

  // Fast-path: Native WASM GLR parser
  const parser = getSysmlParser();
  if (parser) {
    try {
      const tree = parser.parse(`calc def __E { return ${trimmed}; }`);
      if (tree?.rootNode && !tree.rootNode.hasError?.()) {
        const retNode =
          findFirstDescendant(tree.rootNode, "ReturnStatement") ||
          findFirstDescendant(tree.rootNode, "ResultExpressionMember");
        if (retNode) {
          const exprChild =
            retNode.childCount > 1
              ? retNode.child
                ? retNode.child(1)
                : retNode.children[1]
              : retNode.child
                ? retNode.child(0)
                : retNode.children[0];
          const smt = cstToSmt(exprChild);
          if (smt) return smt;
        }
      }
    } catch {
      // Fallback to legacy tokenizer
    }
  }

  const tokens = tokenizeArithmetic(trimmed);
  if (tokens.length === 0) return trimmed;
  try {
    const ast = parseArithmeticExpr(tokens);
    return astToSmt(ast);
  } catch {
    return trimmed.replace(/\./g, "_");
  }
}

export function extractVariablesFromArithmetic(expr: string): string[] {
  const parser = getSysmlParser();
  if (parser) {
    try {
      const tree = parser.parse(`calc def __E { return ${expr.trim()}; }`);
      if (tree?.rootNode && !tree.rootNode.hasError?.()) {
        const vars: string[] = [];
        const idents = findCstDescendants(tree.rootNode, "Identification") || [];
        for (const idNode of idents) {
          if (idNode.text && idNode.text !== "__E") vars.push(idNode.text.replace(/\./g, "_"));
        }
        if (vars.length > 0) return vars;
      }
    } catch {
      // Fallback
    }
  }

  const tokens = tokenizeArithmetic(expr);
  const vars: string[] = [];
  for (const t of tokens) {
    if (t.type === "ident") {
      vars.push(t.value);
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

  for (const e of entries) {
    if (e.ruleName === "CalculationDefinition" || e.ruleName === "ActionDefinition") {
      let extracted: SmtFunctionDef | null = null;

      // 1. Direct CST inspection if QueryDB provides cstNode
      if (typeof (db as any).cstNode === "function") {
        try {
          const cst = (db as any).cstNode(e.id);
          if (cst) {
            const nameNode = findFirstDescendant(cst, "Name") || findFirstDescendant(cst, "ID");
            const name = nameNode?.text?.trim();
            if (name) {
              const params: { name: string; type?: string | undefined }[] = [];
              const paramNodes = [...findCstDescendants(cst, "Parameter"), ...findCstDescendants(cst, "InUsage")];
              for (const pn of paramNodes) {
                const pName = (findFirstDescendant(pn, "Name") || findFirstDescendant(pn, "ID"))?.text?.trim();
                const pType = findFirstDescendant(pn, "FeatureTyping")
                  ?.text?.replace(/^[:\s]+/, "")
                  .trim();
                if (pName) {
                  params.push({ name: pName, type: pType ?? "Real" });
                }
              }

              const retNode = findFirstDescendant(cst, "ReturnFeature") || findFirstDescendant(cst, "FeatureTyping");
              const returnType = retNode?.text?.replace(/^[:\s]+/, "").trim() || "Real";

              const returnExpr =
                findFirstDescendant(cst, "ResultExpressionMember") ||
                findFirstDescendant(cst, "ReturnStatement") ||
                findFirstDescendant(cst, "OwnedExpression");
              const bodyText = returnExpr?.text
                ?.replace(/^return\s+/, "")
                .replace(/;$/, "")
                .trim();

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

      // 2. Textual fallback for mock QueryDB
      const text = db.cstText(e.startOffset, e.endOffset, e);
      if (!text) continue;

      // Match: calc def <name>(<params>): <returnType> { return <body>; }
      // Or: calc def <name>(<params>) { <body> }
      const match = text.match(
        /(?:calc|action)\s+def\s+([a-zA-Z0-9_]+)\s*\((.*?)\)(?:\s*:\s*([a-zA-Z0-9_]+))?\s*\{([\s\S]*?)\}/,
      );
      if (match) {
        const name = match[1]!;
        const rawParams = match[2] ?? "";
        const returnType = match[3] ?? "Real";
        const rawBody = match[4] ?? "";

        // Extract return expression
        const returnMatch = rawBody.match(/return\s+([^;]+);/) || rawBody.match(/([a-zA-Z0-9_.+*/^ -]+);?/);
        const bodyExpr = returnMatch ? returnMatch[1]!.trim() : "0.0";

        const params: { name: string; type?: string | undefined }[] = [];
        if (rawParams.trim()) {
          const paramParts = rawParams.split(",");
          for (const part of paramParts) {
            const pMatch = part.match(/([a-zA-Z0-9_]+)(?:\s*:\s*([a-zA-Z0-9_]+))?/);
            if (pMatch) {
              params.push({ name: pMatch[1]!, type: pMatch[2] ?? "Real" });
            }
          }
        }

        funcs.push({
          name,
          params,
          returnType: returnType === "Real" || returnType === "Integer" ? "Real" : returnType,
          body: infixArithmeticToSmt(bodyExpr),
        });
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
    if (/[*^/]/.test(c.lhs) || (typeof c.rhs === "string" && /[*^/]/.test(c.rhs))) {
      hasNonlinear = true;
      break;
    }
  }
  if (!hasNonlinear && options.minimize?.some((e) => /[*^/]/.test(e))) hasNonlinear = true;
  if (!hasNonlinear && options.maximize?.some((e) => /[*^/]/.test(e))) hasNonlinear = true;
  if (!hasNonlinear && options.functions?.some((f) => /[*^/]/.test(f.body))) hasNonlinear = true;

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
