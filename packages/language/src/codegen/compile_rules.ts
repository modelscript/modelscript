import { TransformCombinator } from "../dsl.js";

export interface RewriteRule {
  name: string;
  lhs: TransformCombinator | string;
  rhs: TransformCombinator | string;
}

export function compileRewriteRules(rules: RewriteRule[]): string {
  let out = "// --- AOT Compiled Rewrite Rules ---\n";
  out += "function allocEClass(opType: u16, leftClass: u32, rightClass: u32): u32 {\n";
  out += "    let key: u64 = ((opType as u64) << 48) | ((leftClass as u64) << 24) | (rightClass as u64);\n";
  out += "    let existing = hashFind(key);\n";
  out += "    if (existing != 0xFFFFFFFF) return ufFind(existing);\n";
  out += "    let id = ufMakeSet();\n";
  out += "    hashInsert(key, id);\n";
  out += "    return id;\n";
  out += "}\n\n";
  out += "function allocConstantEClass(val: f64): u32 {\n";
  out += "    let key: u64 = ((512 as u64) << 48) | (reinterpret<u64>(val) >>> 32);\n"; // 512 is (ExprKind.RealLiteral << 8)
  out += "    let existing = hashFind(key);\n";
  out += "    if (existing != 0xFFFFFFFF) return ufFind(existing);\n";
  out += "    let id = ufMakeSet();\n";
  out += "    hashInsert(key, id);\n";
  out += "    return id;\n";
  out += "}\n\n";
  out += "export function saturateEGraph(): void {\n";
  out += "    let anyMerged = true;\n";
  out += "    let iterations = 0;\n";
  out += "    while (anyMerged && iterations < 10) {\n";
  out += "        anyMerged = false;\n";
  out += "        for (let i: u32 = 0; i < hashCount; i++) {\n";
  out += "            let eClass = ufFind(load<u32>(hashValsOffset + i * 4));\n";
  out += "            let key = load<u64>(hashKeysOffset + i * 8);\n";
  out += "            let op = (key >> 48) as u16;\n";
  out += "            let left = ((key >> 24) & 0xFFFFFF) as u32;\n";
  out += "            let right = (key & 0xFFFFFF) as u32;\n\n";

  for (const rule of rules) {
    out += compileRule(rule);
  }

  out += "        }\n";
  out += "        iterations++;\n";
  out += "    }\n";
  out += "}\n\n";

  out += "// --- DP Extractor (Bellman-Ford Relaxation) ---\n";
  out += "let dpCostOffset: u32 = 0;\n";
  out += "let dpKeyOffset: u32 = 0;\n";
  out += "export function initDPExtractor(): void {\n";
  out += "    dpCostOffset = arenaOffset;\n";
  out += "    arenaOffset += 10000 * 4;\n";
  out += "    dpKeyOffset = arenaOffset;\n";
  out += "    arenaOffset += 10000 * 8;\n";
  out += "    for (let i: u32 = 0; i < 10000; i++) {\n";
  out += "        store<u32>(dpCostOffset + i * 4, 0xFFFFFFFF);\n";
  out += "        store<u64>(dpKeyOffset + i * 8, 0);\n";
  out += "    }\n";

  // Relaxation Loop
  out += "    let changed = true;\n";
  out += "    while (changed) {\n";
  out += "        changed = false;\n";
  out += "        for (let i: u32 = 0; i < hashCount; i++) {\n";
  out += "            let key = load<u64>(hashKeysOffset + i * 8);\n";
  out += "            let op = (key >> 48) as u16;\n";
  out += "            let left = ((key >> 24) & 0xFFFFFF) as u32;\n";
  out += "            let right = (key & 0xFFFFFF) as u32;\n";
  out += "            let nodeClass = ufFind(load<u32>(hashValsOffset + i * 4));\n";
  out += "            let cost: u32 = 1;\n";
  out += "            if (op == 1280 || op == 1281 || op == 1282 || op == 1283) {\n";
  out += "                let lCost = load<u32>(dpCostOffset + ufFind(left) * 4);\n";
  out += "                let rCost = load<u32>(dpCostOffset + ufFind(right) * 4);\n";
  out += "                if (lCost == 0xFFFFFFFF || rCost == 0xFFFFFFFF) cost = 0xFFFFFFFF;\n";
  out += "                else cost += lCost + rCost;\n";
  out += "            } else if (op == 512 || op == 0) {\n"; // RealLiteral or Name
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
  out += "    }\n";
  out += "}\n\n";

  out += "export function extractAst(eClass: u32, dae: DaeBuilder): u32 {\n";
  out += "    let root = ufFind(eClass);\n";
  out += "    let key = load<u64>(dpKeyOffset + root * 8);\n";
  out += "    if (key == 0) return 0; // Unreachable or not evaluated\n";
  out += "    let op = (key >> 48) as u16;\n";
  out += "    if (op == 512 || op == 0) {\n"; // RealLiteral or Name
  out += "        let originalNode = (key & 0xFFFFFFFF) as u32;\n"; // Hack for now
  out += "        return originalNode;\n";
  out += "    } else if (op == 1280 || op == 1281 || op == 1282 || op == 1283) {\n";
  out += "        let left = ((key >> 24) & 0xFFFFFF) as u32;\n";
  out += "        let right = (key & 0xFFFFFF) as u32;\n";
  out += "        let leftNode = extractAst(left, dae);\n";
  out += "        let rightNode = extractAst(right, dae);\n";
  out += "        if (leftNode == 0xFFFFFFFF || rightNode == 0xFFFFFFFF) return 0xFFFFFFFF;\n";
  out += "        let binOp: u32 = 0;\n";
  out += "        if (op == 1280) binOp = 0;\n";
  out += "        if (op == 1281) binOp = 1;\n";
  out += "        if (op == 1282) binOp = 2;\n";
  out += "        if (op == 1283) binOp = 3;\n";
  out += "        return dae.addExpression(5 /* Binary */, binOp, leftNode, rightNode);\n";
  out += "    }\n";
  out += "    return 0;\n";
  out += "}\n";

  return out;
}

type Expr = string | { op: string; left: Expr; right: Expr };

function parseSExpr(s: string): Expr {
  s = s.trim();
  if (!s.startsWith("(")) return s; // var or const
  // e.g. "(add ?a (mul ?b 0))"
  let inner = s.substring(1, s.length - 1).trim();
  let parts = [];
  let depth = 0;
  let curr = "";
  for (const c of inner) {
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === " " && depth === 0) {
      if (curr.length > 0) parts.push(curr);
      curr = "";
    } else {
      curr += c;
    }
  }
  if (curr.length > 0) parts.push(curr);
  return { op: parts[0], left: parseSExpr(parts[1]), right: parseSExpr(parts[2]) };
}

function getOpCode(op: string): number {
  if (op === "add") return 1280; // (5 << 8) | 0
  if (op === "sub") return 1281; // (5 << 8) | 1
  if (op === "mul") return 1282; // (5 << 8) | 2
  if (op === "div") return 1283; // (5 << 8) | 3
  return 0;
}

function compileRule(rule: RewriteRule): string {
  let out = `            // Rule: ${rule.name}\n`;
  let lhsStr =
    typeof rule.lhs === "string"
      ? rule.lhs
      : typeof (rule.lhs as any)?.toSExpr === "function"
        ? (rule.lhs as any).toSExpr()
        : String(rule.lhs);
  let rhsStr =
    typeof rule.rhs === "string"
      ? rule.rhs
      : typeof (rule.rhs as any)?.toSExpr === "function"
        ? (rule.rhs as any).toSExpr()
        : String(rule.rhs);
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
        res += `${indent}    for (let j${j}: u32 = 0; j${j} < hashCount; j${j}++) {\n`;
        res += `${indent}        if (ufFind(load<u32>(hashValsOffset + j${j} * 4)) == ${l_class}) {\n`;
        res += `${indent}            let key_j${j} = load<u64>(hashKeysOffset + j${j} * 8);\n`;
        res += `${indent}            let op_j${j} = (key_j${j} >> 48) as u16;\n`;
        res += `${indent}            let left_j${j} = ((key_j${j} >> 24) & 0xFFFFFF) as u32;\n`;
        res += `${indent}            let right_j${j} = (key_j${j} & 0xFFFFFF) as u32;\n`;
        let inner = genMatch(l_expr, l_class, `op_j${j}`, `left_j${j}`, `right_j${j}`, indent + "            ");
        res += inner;
      } else {
        res += genMatch(l_expr, l_class, "", "", "", indent + "    ");
      }

      if (typeof r_expr !== "string") {
        let j = uid++;
        r_class = `r_class_${j}`;
        res += `${indent}    let ${r_class} = ${targetRight};\n`;
        res += `${indent}    for (let k${j}: u32 = 0; k${j} < hashCount; k${j}++) {\n`;
        res += `${indent}        if (ufFind(load<u32>(hashValsOffset + k${j} * 4)) == ${r_class}) {\n`;
        res += `${indent}            let key_k${j} = load<u64>(hashKeysOffset + k${j} * 8);\n`;
        res += `${indent}            let op_k${j} = (key_k${j} >> 48) as u16;\n`;
        res += `${indent}            let left_k${j} = ((key_k${j} >> 24) & 0xFFFFFF) as u32;\n`;
        res += `${indent}            let right_k${j} = (key_k${j} & 0xFFFFFF) as u32;\n`;
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
        return boundVars[expr];
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
  if (typeof rhs === "string" && rhs.startsWith("?")) {
    rhsEmitStr = `                if (ufUnion(eClass, ${boundVars[rhs]}) != eClass) anyMerged = true;\n`;
  } else if (typeof rhs === "string") {
    rhsEmitStr = `                if (ufUnion(eClass, ${boundConsts[rhs]}) != eClass) anyMerged = true;\n`;
  } else {
    let rhsCall = genRHS(rhs, "");
    rhsEmitStr = `                let newRhs = ${rhsCall};\n                if (ufUnion(eClass, newRhs) != eClass) anyMerged = true;\n`;
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
  out += rhsStr;
  out += closeStr;

  return out;
}
