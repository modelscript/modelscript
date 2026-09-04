import { ruleCombinators, TransformCombinator } from "../dsl/language.js";

/**
 * Interface representing an algebraic or AST rewrite rule.
 */
export interface RewriteRule {
  name: string;
  lhs: TransformCombinator | string | ((...args: any[]) => any);
  rhs: TransformCombinator | string | ((...args: any[]) => any);
}

/**
 * Compiles a list of algebraic rewrite rules into an optimized AOT AssemblyScript
 * e-graph saturation and Bellman-Ford DP extraction engine.
 *
 * @param rules Array of AST rewrite rules (LHS pattern -> RHS target).
 * @returns AssemblyScript source code string for saturation and extraction.
 */
export function compileRewriteRules(rules: RewriteRule[]): string {
  let out = "// --- AOT Compiled Rewrite Rules ---\n";
  out += "function allocEClass(opType: u16, leftClass: u32, rightClass: u32): u32 {\n";
  out +=
    "    let key: u64 = ((opType as u64) << 48) | (((ufFind(leftClass) & 0xFFFFFF) as u64) << 24) | ((ufFind(rightClass) & 0xFFFFFF) as u64);\n";
  out += "    let existing = hashFind(key);\n";
  out += "    if (existing != 0xFFFFFFFF) return ufFind(existing);\n";
  out += "    let id = ufMakeSet();\n";
  out += "    hashInsert(key, id);\n";
  out += "    return id;\n";
  out += "}\n\n";
  out += "function allocConstantEClass(val: f64): u32 {\n";
  out += "    let floatBits = reinterpret<u64>(val);\n";
  out += "    let key: u64 = ((512 as u64) << 48) | (floatBits >>> 16);\n"; // 512 is (ExprKind.RealLiteral << 8)
  out += "    let existing = hashFind(key);\n";
  out += "    if (existing != 0xFFFFFFFF) return ufFind(existing);\n";
  out += "    let id = ufMakeSet();\n";
  out += "    hashInsert(key, id);\n";
  out += "    return id;\n";
  out += "}\n\n";
  out += "export function saturateEGraph(): void {\n";
  out += "    let anyMerged = true;\n";
  out += "    let iterations: u32 = 0;\n";
  out += "    while (anyMerged && iterations < 10) {\n";
  out += "        anyMerged = false;\n";
  out += "        let count = eNodeCount;\n";
  out += "        for (let i: u32 = 0; i < count; i++) {\n";
  out += "            let eClass = ufFind(load<u32>(eNodeClassesOffset + i * 4));\n";
  out += "            let key = load<u64>(eNodeKeysOffset + i * 8);\n";
  out += "            let op = (key >> 48) as u16;\n";
  out += "            let left = ufFind(((key >> 24) & 0xFFFFFF) as u32);\n";
  out += "            let right = ufFind((key & 0xFFFFFF) as u32);\n\n";

  for (let rule of rules) {
    if (typeof rule === "object" && rule !== null && !(rule as any).lhs) {
      const keys = Object.keys(rule);
      if (keys.length === 1) {
        const name = keys[0];
        const fn = (rule as any)[name];
        if (typeof fn === "function") {
          const res = fn(ruleCombinators.var("x"), ruleCombinators.var("y"));
          if (Array.isArray(res) && res.length === 2) {
            rule = { name, lhs: res[0], rhs: res[1] };
          }
        }
      }
    }
    out += compileRule(rule);
  }

  out += "        }\n";
  out += "        if (anyMerged) {\n";
  out += "            rebuildEGraph();\n";
  out += "        }\n";
  out += "        iterations++;\n";
  out += "    }\n";
  out += "}\n\n";

  out += "// --- DP Extractor (Bellman-Ford Relaxation) ---\n";
  out += "let dpCostOffset: u32 = 0;\n";
  out += "let dpKeyOffset: u32 = 0;\n";
  out += "export function initDPExtractor(): void {\n";
  out += "    if (dpCostOffset == 0) {\n";
  out += "        dpCostOffset = atomicChunkAlloc(MAX_ECLASSES * 4);\n";
  out += "        dpKeyOffset = atomicChunkAlloc(MAX_ECLASSES * 8);\n";
  out += "    }\n";
  out += "    for (let i: u32 = 0; i < MAX_ECLASSES; i++) {\n";
  out += "        store<u32>(dpCostOffset + i * 4, 0xFFFFFFFF);\n";
  out += "        store<u64>(dpKeyOffset + i * 8, 0);\n";
  out += "    }\n";

  // Relaxation Loop over dense e-nodes
  out += "    let changed = true;\n";
  out += "    let pass: u32 = 0;\n";
  out += "    while (changed && pass < 20) {\n";
  out += "        changed = false;\n";
  out += "        for (let i: u32 = 0; i < eNodeCount; i++) {\n";
  out += "            let key = load<u64>(eNodeKeysOffset + i * 8);\n";
  out += "            let op = (key >> 48) as u16;\n";
  out += "            let left = ufFind(((key >> 24) & 0xFFFFFF) as u32);\n";
  out += "            let right = ufFind((key & 0xFFFFFF) as u32);\n";
  out += "            let nodeClass = ufFind(load<u32>(eNodeClassesOffset + i * 4));\n";
  out += "            let cost: u32 = 1;\n";
  out += "            if ((op >= 1280 && op <= 1284) || (op >= 1536 && op <= 1539) || (op >= 1792 && op <= 1793)) {\n";
  out += "                let lCost = load<u32>(dpCostOffset + left * 4);\n";
  out += "                let rCost = load<u32>(dpCostOffset + right * 4);\n";
  out += "                if (lCost == 0xFFFFFFFF || rCost == 0xFFFFFFFF) cost = 0xFFFFFFFF;\n";
  out += "                else cost += lCost + rCost;\n";
  out += "            } else if ((op >= 1024 && op <= 1027) || (op >= 1800 && op <= 1810)) {\n";
  out += "                let lCost = load<u32>(dpCostOffset + left * 4);\n";
  out += "                if (lCost == 0xFFFFFFFF) cost = 0xFFFFFFFF;\n";
  out += "                else cost += lCost;\n";
  out += "            } else if (op == 512 || op == 256 || op == 0 || op == 768) {\n";
  out += "                cost = 1;\n";
  out += "            }\n";
  out += "            if (cost != 0xFFFFFFFF) {\n";
  out += "                let currentCost = load<u32>(dpCostOffset + nodeClass * 4);\n";
  out += "                if (cost < currentCost) {\n";
  out += "                    store<u32>(dpCostOffset + nodeClass * 4, cost);\n";
  out += "                    store<u64>(dpKeyOffset + nodeClass * 8, key);\n";
  out += "                    changed = true;\n";
  out += "                }\n";
  out += "            }\n";
  out += "        }\n";
  out += "        pass++;\n";
  out += "    }\n";
  out += "}\n\n";

  out += "export function extractAst(eClass: u32, dae: DaeBuilder): u32 {\n";
  out += "    let root = ufFind(eClass);\n";
  out += "    let key = load<u64>(dpKeyOffset + root * 8);\n";
  out += "    if (key == 0) return 0xFFFFFFFF;\n";
  out += "    let op = (key >> 48) as u16;\n";
  out += "    if (op == 512) { // RealLiteral\n";
  out += "        let valBits = (key & 0xFFFFFFFFFFFF) << 16;\n";
  out += "        return dae.addRealLiteral(reinterpret<f64>(valBits));\n";
  out += "    } else if (op == 256) { // IntLiteral\n";
  out += "        let val = (key & 0xFFFFFFFF) as i32;\n";
  out += "        return dae.addIntLiteral(val);\n";
  out += "    } else if (op == 0) { // Name\n";
  out += "        let nameId = (key & 0xFFFFFFFF) as u32;\n";
  out += "        return dae.addExpression(0 /* Name */, nameId, 0xFFFFFFFF, 0xFFFFFFFF);\n";
  out += "    } else if (op >= 1280 && op <= 1284) {\n";
  out += "        let left = ((key >> 24) & 0xFFFFFF) as u32;\n";
  out += "        let right = (key & 0xFFFFFF) as u32;\n";
  out += "        let leftNode = extractAst(left, dae);\n";
  out += "        let rightNode = extractAst(right, dae);\n";
  out += "        if (leftNode == 0xFFFFFFFF || rightNode == 0xFFFFFFFF) return 0xFFFFFFFF;\n";
  out += "        let binOp: u32 = op - 1280;\n";
  out += "        return dae.addExpression(5 /* Binary */, binOp, leftNode, rightNode);\n";
  out += "    } else if (op >= 1024 && op <= 1027) {\n";
  out += "        let left = ((key >> 24) & 0xFFFFFF) as u32;\n";
  out += "        let leftNode = extractAst(left, dae);\n";
  out += "        if (leftNode == 0xFFFFFFFF) return 0xFFFFFFFF;\n";
  out += "        let unOp: u32 = op - 1024;\n";
  out += "        return dae.addExpression(6 /* Unary */, unOp, leftNode, 0xFFFFFFFF);\n";
  out += "    } else if (op >= 1800 && op <= 1810) {\n";
  out += "        let left = ((key >> 24) & 0xFFFFFF) as u32;\n";
  out += "        let leftNode = extractAst(left, dae);\n";
  out += "        if (leftNode == 0xFFFFFFFF) return 0xFFFFFFFF;\n";
  out += "        let funcId: u32 = op - 1800;\n";
  out += "        return dae.addExpression(7 /* Call */, funcId, leftNode, 1);\n";
  out += "    }\n";
  out += "    return 0xFFFFFFFF;\n";
  out += "}\n";

  return out;
}

type Expr = string | { op: string; left: Expr; right: Expr };

/**
 * Resolves rule LHS/RHS from function lambdas, TransformCombinators, or strings.
 */
function resolveRuleExpr(expr: any): string {
  if (typeof expr === "function") {
    const paramNames = ["x", "y", "z", "w", "a", "b", "c", "d"];
    const args: any[] = [ruleCombinators];
    const funcLength = expr.length;
    for (let i = 1; i < funcLength; i++) {
      args.push(ruleCombinators.var(paramNames[(i - 1) % paramNames.length]));
    }
    const res = expr(...args);
    return res instanceof TransformCombinator ? res.toSExpr() : String(res);
  }
  if (typeof expr === "object" && typeof expr?.toSExpr === "function") {
    return expr.toSExpr();
  }
  return String(expr);
}

/**
 * Parses an S-expression or infix expression string into an expression tree.
 */
function parseSExpr(s: string): Expr {
  s = s.trim();
  if (s.startsWith("(") && s.endsWith(")")) {
    let depth = 0;
    let matchedOuter = true;
    for (let i = 0; i < s.length - 1; i++) {
      if (s[i] === "(") depth++;
      else if (s[i] === ")") depth--;
      if (depth === 0 && i > 0) {
        matchedOuter = false;
        break;
      }
    }
    if (matchedOuter) {
      const inner = s.substring(1, s.length - 1).trim();
      const spaceIdx = inner.indexOf(" ");
      const firstToken = spaceIdx !== -1 ? inner.substring(0, spaceIdx) : inner;
      const normToken = firstToken.startsWith("fn:") ? firstToken.substring(3) : firstToken;
      const knownOps = [
        "add",
        "sub",
        "mul",
        "div",
        "pow",
        "neg",
        "abs",
        "sqrt",
        "sin",
        "cos",
        "tan",
        "asin",
        "acos",
        "atan",
        "sinh",
        "cosh",
        "tanh",
        "exp",
        "log",
        "eq",
        "neq",
        "lt",
        "gt",
        "and",
        "or",
        "not",
      ];
      if (knownOps.includes(normToken)) {
        const parts: string[] = [];
        let pDepth = 0;
        let curr = "";
        for (const c of inner) {
          if (c === "(") pDepth++;
          else if (c === ")") pDepth--;
          if (c === " " && pDepth === 0) {
            if (curr.length > 0) parts.push(curr);
            curr = "";
          } else {
            curr += c;
          }
        }
        if (curr.length > 0) parts.push(curr);
        if (parts.length === 2) {
          return { op: normToken, left: parseSExpr(parts[1]), right: "" };
        }
        return { op: normToken, left: parseSExpr(parts[1]), right: parseSExpr(parts[2]) };
      } else {
        return parseSExpr(inner);
      }
    }
  }

  // Prefix function call: e.g. sin(x), fn:sin(x), cos(x + y), sqrt(x)
  const fnMatch = s.match(/^([a-zA-Z_][a-zA-Z0-9_:]*)\s*\((.*)\)$/);
  if (fnMatch) {
    const rawName = fnMatch[1];
    const fnName = rawName.startsWith("fn:") ? rawName.substring(3) : rawName;
    const innerArg = fnMatch[2];
    const knownFns = [
      "add",
      "sub",
      "mul",
      "div",
      "pow",
      "neg",
      "abs",
      "sqrt",
      "sin",
      "cos",
      "tan",
      "asin",
      "acos",
      "atan",
      "sinh",
      "cosh",
      "tanh",
      "exp",
      "log",
      "not",
    ];
    if (knownFns.includes(fnName)) {
      let commaIdx = -1;
      let depth = 0;
      for (let i = 0; i < innerArg.length; i++) {
        if (innerArg[i] === "(") depth++;
        else if (innerArg[i] === ")") depth--;
        else if (innerArg[i] === "," && depth === 0) {
          commaIdx = i;
          break;
        }
      }
      if (commaIdx !== -1) {
        const a1 = innerArg.substring(0, commaIdx).trim();
        const a2 = innerArg.substring(commaIdx + 1).trim();
        return { op: fnName, left: parseSExpr(a1), right: parseSExpr(a2) };
      }
      return { op: fnName, left: parseSExpr(innerArg.trim()), right: "" };
    }
  }

  const opGroups = [
    [
      { sym: "==", op: "eq" },
      { sym: "!=", op: "neq" },
      { sym: "<=", op: "lte" },
      { sym: ">=", op: "gte" },
      { sym: "<", op: "lt" },
      { sym: ">", op: "gt" },
    ],
    [
      { sym: "+", op: "add" },
      { sym: "-", op: "sub" },
    ],
    [
      { sym: "*", op: "mul" },
      { sym: "/", op: "div" },
    ],
    [{ sym: "^", op: "pow" }],
  ];

  for (const group of opGroups) {
    let depth = 0;
    for (let i = s.length - 1; i >= 0; i--) {
      const c = s[i];
      if (c === ")") depth++;
      else if (c === "(") depth--;
      else if (depth === 0) {
        for (const opInfo of group) {
          const len = opInfo.sym.length;
          if (i >= len - 1 && s.substring(i - len + 1, i + 1) === opInfo.sym) {
            const leftStr = s.substring(0, i - len + 1).trim();
            const rightStr = s.substring(i + 1).trim();
            if (leftStr.length > 0 && rightStr.length > 0) {
              return { op: opInfo.op, left: parseSExpr(leftStr), right: parseSExpr(rightStr) };
            }
          }
        }
      }
    }
  }

  if (isNaN(Number(s)) && !s.startsWith("?")) {
    return `?${s}`;
  }
  return s;
}

/**
 * Maps binary/unary operation string names to their encoded opcode values.
 */
export function getOpCode(op: string): number {
  if (op.startsWith("fn:")) op = op.substring(3);
  if (op === "add") return 1280; // (5 << 8) | 0
  if (op === "sub") return 1281; // (5 << 8) | 1
  if (op === "mul") return 1282; // (5 << 8) | 2
  if (op === "div") return 1283; // (5 << 8) | 3
  if (op === "pow") return 1284; // (5 << 8) | 4
  if (op === "neg") return 1024; // (4 << 8) | 0
  if (op === "abs") return 1025; // (4 << 8) | 1
  if (op === "not") return 1026;
  if (op === "sqrt") return 1027;
  if (op === "sin") return 1800; // (7 << 8) | 8
  if (op === "cos") return 1801;
  if (op === "tan") return 1802;
  if (op === "asin") return 1803;
  if (op === "acos") return 1804;
  if (op === "atan") return 1805;
  if (op === "sinh") return 1806;
  if (op === "cosh") return 1807;
  if (op === "tanh") return 1808;
  if (op === "exp") return 1809;
  if (op === "log") return 1810;
  if (op === "eq") return 1536; // (6 << 8) | 0
  if (op === "neq") return 1537;
  if (op === "lt") return 1538;
  if (op === "gt") return 1539;
  if (op === "and") return 1792; // (7 << 8) | 0
  if (op === "or") return 1793;
  return 0;
}

export const TRIG_RULES: RewriteRule[] = [
  { name: "sin_zero", lhs: "sin(0)", rhs: "0" },
  { name: "cos_zero", lhs: "cos(0)", rhs: "1" },
  { name: "tan_zero", lhs: "tan(0)", rhs: "0" },
  { name: "sinh_zero", lhs: "sinh(0)", rhs: "0" },
  { name: "cosh_zero", lhs: "cosh(0)", rhs: "1" },
  { name: "tanh_zero", lhs: "tanh(0)", rhs: "0" },
  { name: "exp_zero", lhs: "exp(0)", rhs: "1" },
  { name: "log_one", lhs: "log(1)", rhs: "0" },
  { name: "sin_asin", lhs: "sin(asin(x))", rhs: "x" },
  { name: "cos_acos", lhs: "cos(acos(x))", rhs: "x" },
  { name: "tan_atan", lhs: "tan(atan(x))", rhs: "x" },
  { name: "sin_neg", lhs: "sin(neg(x))", rhs: "neg(sin(x))" },
  { name: "cos_neg", lhs: "cos(neg(x))", rhs: "cos(x)" },
  { name: "tan_neg", lhs: "tan(neg(x))", rhs: "neg(tan(x))" },
  { name: "sinh_neg", lhs: "sinh(neg(x))", rhs: "neg(sinh(x))" },
  { name: "cosh_neg", lhs: "cosh(neg(x))", rhs: "cosh(x)" },
  { name: "tanh_neg", lhs: "tanh(neg(x))", rhs: "neg(tanh(x))" },
  { name: "pythagorean", lhs: "(sin(x) ^ 2) + (cos(x) ^ 2)", rhs: "1" },
  { name: "pythagorean_alt", lhs: "(cos(x) ^ 2) + (sin(x) ^ 2)", rhs: "1" },
  { name: "sqrt_square", lhs: "sqrt(x ^ 2)", rhs: "abs(x)" },
];

/**
 * Compiles a single rewrite rule into AssemblyScript conditional matching and union logic.
 */
function compileRule(rule: RewriteRule): string {
  let out = `            // Rule: ${rule.name}\n`;
  let lhsStr = resolveRuleExpr(rule.lhs);
  let rhsStr = resolveRuleExpr(rule.rhs);
  let lhs = parseSExpr(lhsStr);
  let rhs = parseSExpr(rhsStr);

  let uid = 0;
  let boundVars: Record<string, string> = {};
  let boundConsts: Record<string, string> = {};

  function genMatch(
    expr: Expr,
    targetEClass: string,
    targetOp: string,
    targetLeft: string,
    targetRight: string,
    indent: string,
  ): string {
    if (typeof expr === "string") {
      if (expr.startsWith("?")) {
        if (boundVars[expr]) {
          return `${indent}if (${targetEClass} == ${boundVars[expr]}) {\n`; // Variables must match exactly
        } else {
          boundVars[expr] = targetEClass;
          return ""; // Always match first time
        }
      } else {
        // Constant
        let constVal = parseFloat(expr);
        boundConsts[expr] = targetEClass;
        return `${indent}if (isConstant(${targetEClass}, ${constVal})) {\n`;
      }
    } else {
      let opCode = getOpCode(expr.op);
      let res = `${indent}if (${targetOp} == ${opCode}) {\n`;

      let l_expr = expr.left;
      let r_expr = expr.right;
      let l_class = `${targetLeft}`;
      let r_class = `${targetRight}`;

      // Nested expressions need a search loop
      if (typeof l_expr !== "string") {
        let j = uid++;
        l_class = `l_class_${j}`;
        res += `${indent}    let ${l_class} = ${targetLeft};\n`;
        res += `${indent}    for (let j${j}: u32 = 0; j${j} < eNodeCount; j${j}++) {\n`;
        res += `${indent}        if (ufFind(load<u32>(eNodeClassesOffset + j${j} * 4)) == ${l_class}) {\n`;
        res += `${indent}            let key_j${j} = load<u64>(eNodeKeysOffset + j${j} * 8);\n`;
        res += `${indent}            let op_j${j} = (key_j${j} >> 48) as u16;\n`;
        res += `${indent}            let left_j${j} = ufFind(((key_j${j} >> 24) & 0xFFFFFF) as u32);\n`;
        res += `${indent}            let right_j${j} = ufFind((key_j${j} & 0xFFFFFF) as u32);\n`;
        let inner = genMatch(l_expr, l_class, `op_j${j}`, `left_j${j}`, `right_j${j}`, indent + "            ");
        res += inner;
      } else {
        res += genMatch(l_expr, l_class, "", "", "", indent + "    ");
      }

      if (typeof r_expr !== "string") {
        let j = uid++;
        r_class = `r_class_${j}`;
        res += `${indent}    let ${r_class} = ${targetRight};\n`;
        res += `${indent}    for (let k${j}: u32 = 0; k${j} < eNodeCount; k${j}++) {\n`;
        res += `${indent}        if (ufFind(load<u32>(eNodeClassesOffset + k${j} * 4)) == ${r_class}) {\n`;
        res += `${indent}            let key_k${j} = load<u64>(eNodeKeysOffset + k${j} * 8);\n`;
        res += `${indent}            let op_k${j} = (key_k${j} >> 48) as u16;\n`;
        res += `${indent}            let left_k${j} = ufFind(((key_k${j} >> 24) & 0xFFFFFF) as u32);\n`;
        res += `${indent}            let right_k${j} = ufFind((key_k${j} & 0xFFFFFF) as u32);\n`;
        let inner = genMatch(r_expr, r_class, `op_k${j}`, `left_k${j}`, `right_k${j}`, indent + "            ");
        res += inner;
      } else {
        res += genMatch(r_expr, r_class, "", "", "", indent + "    ");
      }

      return res;
    }
  }

  let matchStr = genMatch(lhs, "eClass", "op", "left", "right", "            ");

  // Generate RHS instantiation
  function genRHS(expr: Expr, indent: string): string {
    if (typeof expr === "string") {
      if (expr.startsWith("?")) {
        return boundVars[expr] || "0";
      } else {
        if (boundConsts[expr]) return boundConsts[expr]; // Reusing matched constant E-class
        let constVal = parseFloat(expr);
        return `allocConstantEClass(${constVal})`; // new constant
      }
    } else {
      let opCode = getOpCode(expr.op);
      let l_val = genRHS(expr.left, indent);
      let r_val = genRHS(expr.right, indent);
      return `allocEClass(${opCode}, ${l_val}, ${r_val})`;
    }
  }

  let rhsEmitStr = ``;
  if (typeof rhs === "string" && rhs.startsWith("?") && boundVars[rhs]) {
    rhsEmitStr = `                let rA = ufFind(eClass);\n                let rB = ufFind(${boundVars[rhs]});\n                if (rA != rB) { ufUnion(rA, rB); anyMerged = true; }\n`;
  } else if (typeof rhs === "string" && boundConsts[rhs]) {
    rhsEmitStr = `                let rA = ufFind(eClass);\n                let rB = ufFind(${boundConsts[rhs]});\n                if (rA != rB) { ufUnion(rA, rB); anyMerged = true; }\n`;
  } else {
    let rhsCall = genRHS(rhs, "");
    rhsEmitStr = `                {\n                  let newRhs = ${rhsCall};\n                  let rA = ufFind(eClass);\n                  let rB = ufFind(newRhs);\n                  if (rA != rB) { ufUnion(rA, rB); anyMerged = true; }\n                }\n`;
  }

  // Close blocks
  let closeStr = "";
  let lines = matchStr.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes("if (") || lines[i].includes("for (")) {
      let ind = lines[i].match(/^\s*/)?.[0] || "";
      closeStr += `${ind}}\n`;
    }
  }

  out += matchStr;
  out += rhsEmitStr;
  out += closeStr;

  return out;
}
