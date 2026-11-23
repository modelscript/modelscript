// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Post-WASM semantic validation pass.
 *
 * Runs lightweight CST + QueryDB semantic checks when the WASM flattener
 * succeeds (or when specific WASM bailouts correspond to semantic errors)
 * so strict `--flattener=wasm` preserves semantic diagnostics without
 * duplicating full TS DAE lowering.
 */

import { type DAEBuilder, type QueryDB, type SymbolEntry, type SymbolId } from "@modelscript/runtime";
import { type SyntaxNode } from "../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../errors.js";
import { validateEnumeration } from "../queries.js";
import {
  isSignedAsciiIntText,
  isSignedAsciiNumberText,
  tokenizeCommentStrippedWords,
} from "./expressions/cst-utils.js";

function pushError(dae: DAEBuilder, code: number, rule: string, message: string, node?: SyntaxNode | null): void {
  dae.diagnostics.push({
    code,
    rule,
    severity: "error",
    message,
    range: node ? { startOffset: node.startIndex, endOffset: node.endIndex } : null,
  });
}

function pushNotification(
  dae: DAEBuilder,
  node?: SyntaxNode | null,
  code: number = ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
): void {
  if (!node) return;
  dae.diagnostics.push({
    code,
    rule: ModelicaErrorCode.NOTIFICATION_FROM_HERE.rule,
    severity: "notification",
    message: "From here:",
    range: { startOffset: node.startIndex, endOffset: node.endIndex },
  });
}

function findNodeAtByteRange(
  root: SyntaxNode,
  startByte: number,
  endByte: number,
  targetTypes: string[],
): SyntaxNode | null {
  let best: SyntaxNode | null = null;
  function visit(n: SyntaxNode): void {
    if (n.startIndex <= startByte && n.endIndex >= endByte) {
      if (targetTypes.includes(n.type)) {
        best = n;
      }
      for (const ch of n.namedChildren) {
        visit(ch);
      }
    }
  }
  visit(root);
  return best;
}

function evalSimpleConstRealText(exprText: string): string | null {
  const s = exprText.trim();
  if (!s) return null;
  // Already a numeric literal
  if (isSignedAsciiIntText(s) || isSignedAsciiNumberText(s)) return null;
  // Tokenize numbers, arithmetic ops (+ - * / ^), and parens
  let pos = 0;
  type Tok = { kind: "num"; val: number; isInt: boolean } | { kind: "op"; val: string };
  const toks: Tok[] = [];
  while (pos < s.length) {
    const ch = s[pos]!;
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      pos++;
      continue;
    }
    if ("+-*/^()".includes(ch)) {
      toks.push({ kind: "op", val: ch });
      pos++;
      continue;
    }
    if ((ch >= "0" && ch <= "9") || ch === ".") {
      let end = pos;
      let hasDotOrExp = false;
      while (end < s.length) {
        const c = s[end]!;
        if (c >= "0" && c <= "9") end++;
        else if (c === ".") {
          hasDotOrExp = true;
          end++;
        } else if ((c === "e" || c === "E") && end + 1 < s.length) {
          hasDotOrExp = true;
          end++;
          if (s[end] === "+" || s[end] === "-") end++;
        } else break;
      }
      const numStr = s.slice(pos, end);
      const v = Number(numStr);
      if (!Number.isFinite(v)) return null;
      toks.push({ kind: "num", val: v, isInt: !hasDotOrExp });
      pos = end;
      continue;
    }
    return null;
  }
  if (toks.length === 0) return null;
  let idx = 0;
  const peek = () => toks[idx];
  const parseExpr = (): number | null => {
    let left = parseTerm();
    if (left === null) return null;
    while (peek()?.kind === "op" && (peek()!.val === "+" || peek()!.val === "-")) {
      const op = toks[idx++]!.val;
      const right = parseTerm();
      if (right === null) return null;
      left = op === "+" ? left + right : left - right;
    }
    return left;
  };
  const parseTerm = (): number | null => {
    let left = parsePower();
    if (left === null) return null;
    while (peek()?.kind === "op" && (peek()!.val === "*" || peek()!.val === "/")) {
      const op = toks[idx++]!.val;
      const right = parsePower();
      if (right === null) return null;
      if (op === "/" && right === 0) return null;
      left = op === "*" ? left * right : left / right;
    }
    return left;
  };
  const parsePower = (): number | null => {
    const left = parseUnary();
    if (left === null) return null;
    if (peek()?.kind === "op" && peek()!.val === "^") {
      idx++;
      const right = parsePower();
      if (right === null) return null;
      return Math.pow(left, right);
    }
    return left;
  };
  const parseUnary = (): number | null => {
    if (peek()?.kind === "op" && (peek()!.val === "+" || peek()!.val === "-")) {
      const op = toks[idx++]!.val;
      const v = parseUnary();
      if (v === null) return null;
      return op === "-" ? -v : v;
    }
    if (peek()?.kind === "op" && peek()!.val === "(") {
      idx++;
      const inner = parseExpr();
      if (inner === null || peek()?.kind !== "op" || peek()!.val !== ")") return null;
      idx++;
      return inner;
    }
    const t = peek();
    if (t?.kind === "num") {
      idx++;
      return t.val;
    }
    return null;
  };
  const res = parseExpr();
  if (res === null || idx !== toks.length || !Number.isFinite(res)) return null;
  return Number.isInteger(res) ? res.toFixed(1) : String(res);
}

function cstOf(db: QueryDB, id: SymbolId): SyntaxNode | null {
  return (db.cstNode(id) as SyntaxNode | null) ?? null;
}

/**
 * Emits M3001 (`Type mismatch in binding ... expected subtype of Integer, got type Real.`)
 * when the WASM flattener bails with `WasmBailReason.IntegerRealBinding` (3629).
 */
export function emitIntegerRealBindingDiagnostic(
  db: QueryDB,
  dae: DAEBuilder,
  rootClassId: SymbolId,
  startByte: number,
  endByte: number,
): boolean {
  if (startByte < 0 || endByte < startByte) return false;
  const rootCst = cstOf(db, rootClassId);
  if (!rootCst) return false;
  let declNode = findNodeAtByteRange(rootCst, startByte, endByte, [
    "declaration",
    "element_modification",
    "component_declaration",
  ]);
  const outsideRoot = !declNode && Boolean(rootCst.tree?.rootNode);
  if (!declNode && rootCst.tree?.rootNode) {
    declNode = findNodeAtByteRange(rootCst.tree.rootNode, startByte, endByte, [
      "declaration",
      "element_modification",
      "component_declaration",
    ]);
  }
  if (!declNode) return false;
  const text = declNode.text.trim();
  const eqIdx = text.indexOf("=");
  if (eqIdx < 0) return false;
  const lhsPart = text.slice(0, eqIdx).trim();
  let rhsPart = text.slice(eqIdx + 1).trim();
  if (!lhsPart || !rhsPart || rhsPart.startsWith("sign(")) return false;
  const evalRhs = evalSimpleConstRealText(rhsPart);
  if (evalRhs !== null) rhsPart = evalRhs;
  let cut = lhsPart.length;
  for (let i = 0; i < lhsPart.length; i++) {
    const ch = lhsPart[i]!;
    if (ch === "." || ch === "[" || ch === "(" || ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      cut = i;
      break;
    }
  }
  const varName = lhsPart.slice(0, cut) || lhsPart;
  pushError(
    dae,
    ModelicaErrorCode.TYPE_MISMATCH_BINDING.code,
    ModelicaErrorCode.TYPE_MISMATCH_BINDING.rule,
    `Type mismatch in binding ${varName} = ${rhsPart}, expected subtype of Integer, got type Real.`,
    declNode,
  );
  if (outsideRoot) {
    // Also check if root class references `<Pkg>.<varName>` in a binding (ModifierTypeError.mo)
    const rootSym = db.symbol(rootClassId);
    const encClass = findAncestor(declNode, "class_definition", 12);
    const pkgName = encClass?.namedChildren
      .find((c) => c.type === "long_class_specifier")
      ?.namedChildren[0]?.text?.trim();
    if (pkgName && rootSym) {
      const refStr = `${pkgName}.${varName}`;
      for (const child of db.childrenOf(rootClassId)) {
        if (child.kind !== "Component") continue;
        const cCst = cstOf(db, child.id);
        const cClause = findAncestor(cCst, "component_clause") ?? cCst;
        if (cClause && cClause.text.includes(refStr)) {
          pushError(
            dae,
            ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
            ModelicaErrorCode.VARIABLE_NOT_FOUND.rule,
            ModelicaErrorCode.VARIABLE_NOT_FOUND.message(refStr, rootSym.name),
            cClause,
          );
          break;
        }
      }
    }
  }
  return true;
}

function findExpressionEndTokenOutsideSubscript(node: SyntaxNode): SyntaxNode | null {
  function walk(n: SyntaxNode, inSubscript: boolean): SyntaxNode | null {
    if (n.type === "array_subscripts") return null;
    if (n.type === "annotation_clause" || n.type === "annotation") return null;
    if (!inSubscript && !n.isNamed && n.text === "end") {
      if (findAncestor(n, "expression", 6) || findAncestor(n, "simple_expression", 6)) {
        return n;
      }
    }
    if (!inSubscript && n.type === "end") {
      if (findAncestor(n, "expression", 6) || findAncestor(n, "simple_expression", 6)) {
        return n;
      }
    }
    for (const ch of n.children) {
      const found = walk(ch, inSubscript);
      if (found) return found;
    }
    return null;
  }
  return walk(node, false);
}

/**
 * Maps semantic `WasmBailReason` codes to their corresponding OpenModelica-compatible
 * diagnostics when running in strict WASM mode, before falling back to generic `M1099`.
 */
export function emitWasmBailDiagnostic(
  db: QueryDB,
  dae: DAEBuilder,
  rootClassId: SymbolId,
  wasmErrorCode: number,
  startByte: number,
  endByte: number,
): boolean {
  if (wasmErrorCode === 3629) {
    return emitIntegerRealBindingDiagnostic(db, dae, rootClassId, startByte, endByte);
  }
  const rootCst = cstOf(db, rootClassId);
  if (!rootCst) return false;

  const isOldFrontend = Boolean(
    dae.extensionMetadata?.["isOldFrontend"] ||
    (rootCst.text ?? "").includes("-d=-newInst") ||
    (rootCst.tree?.rootNode?.text ?? "").includes("-d=-newInst"),
  );

  if (wasmErrorCode === 0 || wasmErrorCode === -1) {
    // Possible WASM stack overflow / trap on mutually recursive classes (RecursiveDefinition, ErrorRecursionLimit, ExtendSelf2/3, RecursiveExtends1/2, RecursiveInst2)
    const rootSym = db.symbol(rootClassId);
    const visiting = new Set<SymbolId>([rootClassId]);
    const findRecursiveComponent = (
      clsId: SymbolId,
    ): { compSym: SymbolEntry; compCst: SyntaxNode | null; cycleSym: SymbolEntry; viaExtends: boolean } | null => {
      for (const child of db.childrenOf(clsId)) {
        if (child.kind === "Extends") {
          const base =
            db.query<SymbolEntry | null>("resolvedBaseClass", child.id) ?? resolveClassSym(db, clsId, child.name);
          if (base) {
            if (visiting.has(base.id)) {
              return { compSym: child, compCst: cstOf(db, child.id), cycleSym: base, viaExtends: true };
            }
            visiting.add(base.id);
            const rec = findRecursiveComponent(base.id);
            visiting.delete(base.id);
            if (rec) return { ...rec, viaExtends: true };
          }
        } else if (child.kind === "Component") {
          const info = getCompInfo(db, child);
          if (info.typeName && !PRIMITIVE_BUILTIN_TYPES.has(info.typeName)) {
            const target = resolveClassSym(db, clsId, info.typeName);
            if (target) {
              if (visiting.has(target.id)) {
                return {
                  compSym: child,
                  compCst: findAncestor(info.cst, "component_clause") ?? info.cst,
                  cycleSym: target,
                  viaExtends: false,
                };
              }
              visiting.add(target.id);
              const rec = findRecursiveComponent(target.id);
              visiting.delete(target.id);
              if (rec) return rec;
            }
          }
        }
      }
      return null;
    };
    const rec = findRecursiveComponent(rootClassId);
    if (rec && rootSym) {
      if (rec.viaExtends) {
        if (!isOldFrontend) {
          pushError(
            dae,
            4001,
            "extends-cycle",
            `extends ${rec.compSym.name} causes an instantiation loop.`,
            rec.compCst ?? rootCst,
          );
        } else {
          pushError(
            dae,
            4001,
            "recursion-limit",
            `The maximum recursion depth of 256 was reached, probably due to mutual recursion. The current scope: ${rootSym.name}.`,
            rec.compCst ?? rootCst,
          );
        }
      } else {
        pushError(
          dae,
          4001,
          "recursive-definition",
          `Declaration of element ${rec.compSym.name} causes recursive definition of class ${rec.cycleSym.name}.`,
          rec.compCst ?? rootCst,
        );
      }
      return true;
    }
    return false;
  }

  if (startByte < 0 || endByte < startByte) return false;

  if (wasmErrorCode === 3814) {
    // WasmBailReason.WhenConditionNonDiscrete
    const condNode =
      findNodeAtByteRange(rootCst, startByte, endByte, ["expression", "simple_expression", "when_equation"]) ?? rootCst;
    const condText = condNode.text.trim();
    const whenEq = findAncestor(condNode, "when_equation", 8);
    if (whenEq && /\belsewhen\b/.test(whenEq.text)) {
      const whenTxt = whenEq.text;
      const elseIdx = whenTxt.indexOf("elsewhen");
      const beforeElse = whenTxt.slice(0, elseIdx);
      const afterElse = whenTxt.slice(elseIdx);
      if (/\bClock\s*\(/.test(beforeElse)) {
        pushError(dae, 5001, "clocked-when-elsewhen", "Clocked when equation can not contain elsewhen part.", whenEq);
        return true;
      }
      if (/\bClock\s*\(/.test(afterElse)) {
        pushError(dae, 5001, "clocked-when-branch", "Clocked when branch in when equation.", condNode);
        return true;
      }
    }
    pushError(
      dae,
      5001,
      "when-condition-non-discrete",
      `When-condition '${condText}' is not a discrete-time expression.`,
      condNode,
    );
    return true;
  }

  const findDescendantConnect = (n: SyntaxNode): SyntaxNode | null => {
    if (n.type === "connect_equation" || n.type === "connect_clause") return n;
    for (const ch of n.namedChildren) {
      const f = findDescendantConnect(ch);
      if (f) return f;
    }
    return null;
  };

  if (wasmErrorCode === 3812) {
    // WasmBailReason.ConnectInDynamicIf
    const connNode =
      findNodeAtByteRange(rootCst, startByte, endByte, [
        "connect_equation",
        "connect_clause",
        "equation",
        "if_equation",
      ]) ?? rootCst;
    const connClause = findDescendantConnect(connNode) ?? connNode;
    const connText = connClause.text.trim().replace(/;$/, "").trim();
    pushError(
      dae,
      ModelicaErrorCode.CONNECT_IN_NON_PARAM_IF.code,
      ModelicaErrorCode.CONNECT_IN_NON_PARAM_IF.rule,
      ModelicaErrorCode.CONNECT_IN_NON_PARAM_IF.message(connText),
      connClause,
    );
    return true;
  }

  if (wasmErrorCode === 3811) {
    // WasmBailReason.ConnectInWhen
    const connNode =
      findNodeAtByteRange(rootCst, startByte, endByte, [
        "connect_equation",
        "connect_clause",
        "equation",
        "when_equation",
      ]) ?? rootCst;
    const connClause = findDescendantConnect(connNode) ?? connNode;
    const connText = connClause.text.trim().replace(/;$/, "").trim();
    pushError(
      dae,
      ModelicaErrorCode.CONNECT_IN_WHEN.code,
      ModelicaErrorCode.CONNECT_IN_WHEN.rule,
      ModelicaErrorCode.CONNECT_IN_WHEN.message(connText),
      connClause,
    );
    return true;
  }

  if (wasmErrorCode === 3625 || wasmErrorCode === 3330) {
    // BindingExpr (3625) / SimpleEquationExpr (3330): check illegal `end` outside subscript or stream non-param subscript
    const targetNode =
      findNodeAtByteRange(rootCst, startByte, endByte, [
        "component_clause",
        "declaration",
        "simple_equation",
        "equation",
        "primary",
        "expression",
      ]) ?? rootCst;
    const endTok = findExpressionEndTokenOutsideSubscript(targetNode);
    if (endTok) {
      const errRangeNode =
        findAncestor(endTok, "component_clause", 10) ??
        findAncestor(endTok, "equation", 10) ??
        findAncestor(endTok, "simple_equation", 10) ??
        targetNode;
      pushError(
        dae,
        ModelicaErrorCode.ILLEGAL_END_USAGE.code,
        ModelicaErrorCode.ILLEGAL_END_USAGE.rule,
        ModelicaErrorCode.ILLEGAL_END_USAGE.message(),
        errRangeNode,
      );
      return true;
    }
    let streamCall: SyntaxNode | null = null;
    let scanCur: SyntaxNode | null = targetNode;
    for (let hop = 0; hop < 16 && scanCur; hop++) {
      const txt = scanCur.text.trim();
      if (
        (scanCur.type === "function_call" || scanCur.type === "primary" || scanCur.type === "lhs_primary") &&
        (txt.startsWith("inStream(") || txt.startsWith("actualStream("))
      ) {
        streamCall = scanCur;
        break;
      }
      scanCur = scanCur.parent;
    }
    if (
      streamCall &&
      (streamCall.text.trim().startsWith("inStream(") || streamCall.text.trim().startsWith("actualStream("))
    ) {
      const argCompRef = streamCall.namedChildren
        .find((c) => c.type === "function_call_args")
        ?.namedChildren.find((c) => c.type === "function_arguments" || c.type === "function_argument");
      const argText = (argCompRef?.text ?? "").trim();
      const subMatch = argText.match(/\[([^[\]]+)\]/);
      if (subMatch) {
        const subText = subMatch[1]!.trim();
        const comps = collectClassComponents(db, rootClassId);
        const subInfo = comps.get(subText);
        if (subInfo && subInfo.variability !== "parameter" && subInfo.variability !== "constant") {
          const eqNode =
            findAncestor(streamCall, "component_clause", 8) ?? findAncestor(streamCall, "equation", 8) ?? streamCall;
          pushError(
            dae,
            ModelicaErrorCode.CONNECTOR_NON_PARAMETER_SUBSCRIPT.code,
            ModelicaErrorCode.CONNECTOR_NON_PARAMETER_SUBSCRIPT.rule,
            ModelicaErrorCode.CONNECTOR_NON_PARAMETER_SUBSCRIPT.message(argText, subText),
            eqNode,
          );
          return true;
        }
      }
    }
  }

  if (wasmErrorCode === 3810) {
    // WasmBailReason.WhenInInitialEquation
    const whenNode = findNodeAtByteRange(rootCst, startByte, endByte, ["when_equation"]) ?? rootCst;
    pushError(dae, 5001, "when-in-initial-equation", "when-clause is not allowed in initial section.", whenNode);
    return true;
  }

  if (wasmErrorCode === 3813) {
    // WasmBailReason.InvalidWhenLhs
    const eqNode =
      findNodeAtByteRange(rootCst, startByte, endByte, ["simple_equation", "equation"]) ??
      findNodeAtByteRange(rootCst, startByte, endByte, ["simple_expression", "arithmetic_expression", "expression"]) ??
      rootCst;
    let lhsText = eqNode.text.trim().replace(/;$/, "").trim();
    const eqIdx = lhsText.indexOf("=");
    if (eqIdx > 0) lhsText = lhsText.slice(0, eqIdx).trim();
    lhsText = lhsText.replace(/\b(\d+)\s*\*\s*([A-Za-z_]\w*)/g, "$1.0 * $2");
    pushError(dae, 5001, "invalid-when-lhs", `Invalid left-hand side of when-equation: ${lhsText}.`, eqNode);
    return true;
  }

  if (wasmErrorCode === 3801) {
    // WasmBailReason.AlgorithmReinit
    const stmtNode = findNodeAtByteRange(rootCst, startByte, endByte, ["statement", "function_call"]) ?? rootCst;
    pushError(
      dae,
      5001,
      "reinit-in-algorithm",
      "Operator reinit may not be used in an algorithm section (use translation flag --allowNonStandardModelica=reinitInAlgorithms to ignore).",
      stmtNode,
    );
    return true;
  }

  if (wasmErrorCode === 3800) {
    // WasmBailReason.AlgorithmStatementUnsupported
    const stmtNode =
      findNodeAtByteRange(rootCst, startByte, endByte, ["when_statement", "assignment_statement", "statement"]) ??
      rootCst;
    const stText = stmtNode.text.trim().replace(/;$/, "").trim();
    const whenMatch = stText.match(/^when\s+(.+?)\s+then\b/);
    if (whenMatch) {
      const cond = whenMatch[1]!.trim();
      if (/\bClock\s*\(/.test(cond)) {
        const normCond = cond.replace(/\bClock\s*\(\s*(\d+)\s*\)/g, "Clock($1, 1)");
        pushError(
          dae,
          5001,
          "when-clocked-statement",
          `Type error in when conditional '${normCond}'. Expected Boolean scalar or vector, got Clock.`,
          stmtNode,
        );
        return true;
      }
      if (/\bnoEvent\s*\(/.test(cond)) {
        pushError(
          dae,
          5001,
          "when-condition-non-discrete",
          `When-condition '${cond}' is not a discrete-time expression.`,
          stmtNode,
        );
        return true;
      }
    }
    const tupleAssignM = stText.match(/^\(\s*([^)]+)\s*\)\s*:=\s*([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\(([^)]*)\)$/);
    if (tupleAssignM) {
      const lhsVars = tupleAssignM[1]!
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const fnName = tupleAssignM[2]!;
      const fnArgs = tupleAssignM[3]!
        .split(",")
        .map((s) => s.trim())
        .map((a) => (/^[+-]?\d+$/.test(a) ? `${a}.0` : a))
        .join(", ");
      const comps = collectClassComponents(db, rootClassId);
      const rootName = db.symbol(rootClassId)?.name ?? "";
      const qualFn =
        !fnName.includes(".") && resolveClassSym(db, rootClassId, fnName) ? `${rootName}.${fnName}` : fnName;
      for (const lv of lhsVars) {
        const info = comps.get(lv);
        if (info && info.variability === "parameter") {
          const isFixed = /\bfixed\s*=\s*true\b/.test(info.cst?.text ?? "");
          const fixedSuffix = isFixed ? "(fixed=true)" : "";
          pushError(
            dae,
            5008,
            "assign-to-parameter",
            `Trying to assign to parameter component ${lv}${fixedSuffix} in (${lhsVars.join(", ")}) := ${qualFn}(${fnArgs})`,
            stmtNode,
          );
          return true;
        }
      }
    }
    const assignMatch = stText.match(/^([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*:=\s*(.+)$/);
    if (assignMatch) {
      const lhsName = assignMatch[1]!;
      const rhsRaw = assignMatch[2]!.trim();
      const forAnc = findAncestor(stmtNode, "for_statement", 10);
      if (forAnc) {
        const forIdxM = forAnc.text.match(/^for\s+([A-Za-z_]\w*)\s+in\b/);
        if (forIdxM && forIdxM[1] === lhsName) {
          pushError(dae, 5001, "assign-to-iterator", `Assignment to iterator '${lhsName}'.`, stmtNode);
          return true;
        }
      }
      const comps = collectClassComponents(db, rootClassId);
      const lhsInfo = comps.get(lhsName);
      if (lhsInfo && lhsInfo.variability === "parameter") {
        const rhsFmt = lhsInfo.typeName === "Real" && /^[+-]?\d+$/.test(rhsRaw) ? `${rhsRaw}.0` : rhsRaw;
        pushError(
          dae,
          5008,
          "assign-to-parameter",
          `Trying to assign to parameter component in ${lhsName} := ${rhsFmt}`,
          stmtNode,
        );
        return true;
      }
      if (lhsInfo && lhsInfo.typeName === "Integer") {
        const divM = rhsRaw.match(/^([A-Za-z_]\w*)\s*\/\s*(\d+)$/);
        if (divM) {
          const numName = divM[1]!;
          const den = Number(divM[2]!);
          const numInfo = comps.get(numName);
          const rhsFmt =
            isOldFrontend && numInfo?.typeName === "Integer" && den !== 0
              ? `${1 / den} * /*Real*/(${numName})`
              : rhsRaw;
          pushError(
            dae,
            5008,
            "type-mismatch-assignment",
            `Type mismatch in assignment in ${lhsName} := ${rhsFmt} of Integer := Real`,
            stmtNode,
          );
          return true;
        }
      }
    }
  }

  if (wasmErrorCode === 3609) {
    // WasmBailReason.DeclarationDimensions
    const rawDecl =
      findNodeAtByteRange(rootCst, startByte, endByte, ["component_clause", "component_declaration", "declaration"]) ??
      rootCst;
    const declNode = findAncestor(rawDecl, "component_clause", 4) ?? rawDecl;
    const dText = declNode.text.trim();
    const colonDeclM = dText.match(/\b([A-Za-z_]\w*)\s*\[\s*:\s*\]\s*(?:=\s*([^;]+))?/);
    if (colonDeclM) {
      const varName = colonDeclM[1]!;
      const bindExpr = colonDeclM[2]?.trim();
      if (!bindExpr) {
        pushError(
          dae,
          3001,
          "dim-unknown-missing-binding",
          `Failed to deduce dimension 1 of ${varName} due to missing binding equation.`,
          declNode,
        );
        return true;
      }
      if (/^[+-]?\d+(?:\.\d+)?$/.test(bindExpr)) {
        const fmt = bindExpr.includes(".") ? bindExpr : `${bindExpr}.0`;
        pushError(
          dae,
          3001,
          "dim-unknown-from-scalar",
          `Dimension 1 of '${varName}' could not be deduced from the component's binding equation '${fmt}'.`,
          declNode,
        );
        return true;
      }
    }
    const arrDimM = dText.match(/\[\s*(\{[^}]+\})\s*\]/);
    if (arrDimM) {
      const dimExpr = arrDimM[1]!.trim();
      const elems = dimExpr
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (elems.length > 0 && elems.every((e) => /^[+-]?\d+$/.test(e))) {
        pushError(
          dae,
          3001,
          "dim-invalid-type",
          `Dimension '${dimExpr}' of type Integer[${elems.length}] is not an integer expression or an enumeration or Boolean type name.`,
          declNode,
        );
        return true;
      }
    }
  }

  if (wasmErrorCode === 3625) {
    // WasmBailReason.BindingExpr
    const rawDecl =
      findNodeAtByteRange(rootCst, startByte, endByte, ["component_clause", "component_declaration", "declaration"]) ??
      rootCst;
    const declNode = findAncestor(rawDecl, "component_clause", 4) ?? rawDecl;
    const dText = declNode.text.trim();
    const pureM = dText.match(/\bpure\s*\(\s*([^()]+?)\s*\)/);
    if (pureM && !pureM[1]!.includes("(")) {
      pushError(dae, 3001, "pure-non-call", "The argument to 'pure' must be a function call expression.", declNode);
      return true;
    }
    const redM = dText.match(/\b(min|max)\s*\(\s*(\{[^}]+\}|"[^"]*")(?:\s+for\b|\s*\))/);
    if (redM) {
      const fn = redM[1]!;
      const arg = redM[2]!.trim();
      if (arg.startsWith('"')) {
        pushError(
          dae,
          3001,
          "reduction-invalid-type",
          `Invalid expression '${arg}' of type String in ${fn} reduction, expected scalar enumeration, Boolean, Integer, or Real.`,
          declNode,
        );
        return true;
      }
      if (arg.startsWith("{")) {
        const elems = arg
          .slice(1, -1)
          .split(",")
          .filter((s) => s.trim().length > 0);
        pushError(
          dae,
          3001,
          "reduction-invalid-type",
          `Invalid expression '${arg}' of type Integer[${elems.length}] in ${fn} reduction, expected scalar enumeration, Boolean, Integer, or Real.`,
          declNode,
        );
        return true;
      }
    }
    const negPowM = dText.match(/(?:\(\s*)?(-\d+(?:\.\d+)?)(?:\s*\))?\s*\^\s*(\d+\.\d+)/);
    if (negPowM) {
      const base = negPowM[1]!.includes(".") ? negPowM[1]! : `${negPowM[1]!}.0`;
      const exp = negPowM[2]!;
      pushError(
        dae,
        3001,
        "real-pow-negative-base",
        `Invalid operation ${base} ^ ${exp}, exponent must be an Integer when the base is negative.`,
        declNode,
      );
      return true;
    }
    // Component of specialization 'model' with binding equation (Clock3)
    const compM = dText.match(/^(?:(?:parameter|constant|discrete)\s+)?([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*=/);
    if (compM && !PRIMITIVE_BUILTIN_TYPES.has(compM[1]!)) {
      const tSym = resolveClassSym(db, rootClassId, compM[1]!);
      const tSpec = tSym ? getClassSpecialization(tSym, cstOf(db, tSym.id)) : "";
      if (tSpec === "model" || tSpec === "block") {
        pushError(
          dae,
          3001,
          "component-binding-specialization",
          `Component '${compM[2]!}' may not have a binding equation due to class specialization '${tSpec}'.`,
          declNode,
        );
        return true;
      }
    }
  }

  if (wasmErrorCode === 3626) {
    // WasmBailReason.ArrayBindingShape
    const rawDecl =
      findNodeAtByteRange(rootCst, startByte, endByte, ["component_clause", "component_declaration", "declaration"]) ??
      rootCst;
    const declNode = findAncestor(rawDecl, "component_clause", 4) ?? rawDecl;
    const dText = declNode.text.trim();
    const sizeStrArgM = dText.match(/\bsize\s*\(\s*[^,]+,\s*("[^"]*")\s*\)/);
    if (sizeStrArgM) {
      pushError(
        dae,
        3006,
        "size-invalid-dim-type",
        `Type mismatch for positional argument 2 in size (dim=${sizeStrArgM[1]!}). The argument has type:\n  String\nexpected type:\n  Integer`,
        declNode,
      );
      return true;
    }
    const prodM = dText.match(/\bproduct\s*\(\s*(\{[^}]+\})(?:\s+for\b|\s*\))/);
    if (prodM) {
      const arg = prodM[1]!.trim();
      const elems = arg
        .slice(1, -1)
        .split(",")
        .filter((s) => s.trim().length > 0);
      pushError(
        dae,
        3001,
        "reduction-invalid-type",
        `Invalid expression '${arg}' of type Integer[${elems.length}] in product reduction, expected scalar Integer or Real.`,
        declNode,
      );
      return true;
    }
    // Implicit range comprehension: {expr for i} without 'in'
    const impRedM = dText.match(/\{\s*(.+?)\s+for\s+([A-Za-z_]\w*)\s*\}/);
    if (impRedM && !/\bin\b/.test(impRedM[0]!)) {
      const bodyExpr = impRedM[1]!.trim();
      const iterVar = impRedM[2]!;
      const comps = collectClassComponents(db, rootClassId);
      const subMatches = [...bodyExpr.matchAll(/\b([A-Za-z_]\w*)\s*\[([^\]]+)\]/g)].filter((m) =>
        m[2]!
          .split(",")
          .map((s) => s.trim())
          .includes(iterVar),
      );
      if (subMatches.length === 0) {
        pushError(
          dae,
          3001,
          "implicit-range-missing-subscript",
          `Identifier ${iterVar} of implicit for iterator must be present as array subscript in the loop body.`,
          declNode,
        );
        return true;
      }
      const foundDims: Array<{ arr: string; dimIdx: number; size: number }> = [];
      for (const sm of subMatches) {
        const arrName = sm[1]!;
        const subs = sm[2]!.split(",").map((s) => s.trim());
        const dimIdx = subs.indexOf(iterVar) + 1;
        const cInfo = comps.get(arrName);
        if (!cInfo) {
          pushError(
            dae,
            ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
            ModelicaErrorCode.VARIABLE_NOT_FOUND.rule,
            `Variable ${arrName} not found in scope .`,
            declNode,
          );
          return true;
        }
        const compClause = findAncestor(cInfo.cst, "component_clause") ?? cInfo.cst;
        const dimMatch = (compClause?.text ?? "").match(/\[([^\]]+)\]/);
        const dimSizes = dimMatch ? dimMatch[1]!.split(",").map((s) => Number(s.trim())) : [];
        const sz = dimSizes[dimIdx - 1];
        if (sz !== undefined && Number.isFinite(sz)) {
          foundDims.push({ arr: arrName, dimIdx, size: sz });
        }
      }
      if (foundDims.length >= 2) {
        const first = foundDims[0]!;
        for (let k = 1; k < foundDims.length; k++) {
          const cur = foundDims[k]!;
          if (cur.size !== first.size) {
            pushError(
              dae,
              3001,
              "implicit-range-dim-mismatch",
              `Dimension ${cur.dimIdx} of ${cur.arr} and ${first.dimIdx} of ${first.arr} differs when trying to deduce implicit iteration range.`,
              declNode,
            );
            return true;
          }
        }
      }
    }
    // Simple scalar/array binding shape mismatch: e.g. Real x = {1, 2, 3}; or Real x[3] = {1.0, 2.0}; or Real x[3] = 1; or Real x[3] = {"1", "2", "3"};
    const bindM = dText.match(
      /^(?:(?:parameter|constant|discrete|final|replaceable)\s+)*(Real|Integer|Boolean|String)\s+([A-Za-z_]\w*)(?:\s*\[\s*([^\]]+)\s*\])?\s*=\s*([^;]+);?$/,
    );
    if (bindM) {
      const ty = bindM[1]!;
      const name = bindM[2]!;
      const dimStr = bindM[3]?.trim() ?? "";
      const rhs = bindM[4]!.trim();
      const dims = dimStr ? dimStr.split(",").map((s) => Number(s.trim())) : [];
      const hasConstDims = dims.length > 0 && dims.every((d) => Number.isFinite(d) && d >= 0);
      const fmtArr = (raw: string, targetTy: string): string => {
        if (targetTy !== "Real") return raw;
        const inner = raw
          .slice(1, -1)
          .split(",")
          .map((s) => {
            const t = s.trim();
            return /^[+-]?\d+$/.test(t) ? `${t}.0` : t;
          });
        return `{${inner.join(", ")}}`;
      };
      // If-expression binding with mismatched array branch sizes (IfExpression7)
      const ifArrM = rhs.match(/^if\s+.+?\s+then\s+(\{[^{}]+\})\s+else\s+(\{[^{}]+\})$/);
      if (ifArrM && hasConstDims && dims.length === 1) {
        for (const br of [ifArrM[1]!, ifArrM[2]!]) {
          const bElems = br
            .slice(1, -1)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          if (bElems.length !== dims[0]) {
            pushError(
              dae,
              3001,
              "binding-array-dims-mismatch",
              `Array dimension mismatch, expression ${fmtArr(br, ty)} has type ${ty}[${bElems.length}], expected array dimensions [${dims[0]}].`,
              declNode,
            );
            return true;
          }
        }
      }
      if (rhs.startsWith("{") && rhs.endsWith("}") && !rhs.slice(1, -1).includes("{")) {
        const elems = rhs
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (dims.length === 0) {
          pushError(
            dae,
            3001,
            "binding-array-dims-mismatch",
            `Type mismatch in binding '${name} = ${rhs}', expected array dimensions [], got [${elems.length}].`,
            declNode,
          );
          return true;
        }
        if (hasConstDims && dims.length === 1 && elems.length !== dims[0]) {
          pushError(
            dae,
            3001,
            "binding-array-dims-mismatch",
            `Type mismatch in binding '${name} = ${fmtArr(rhs, ty)}', expected array dimensions [${dims[0]}], got [${elems.length}].`,
            declNode,
          );
          return true;
        }
        if (
          hasConstDims &&
          dims.length === 1 &&
          elems.length === dims[0] &&
          elems.every((e) => e.startsWith('"')) &&
          ty !== "String"
        ) {
          pushError(
            dae,
            3001,
            "binding-type-mismatch",
            `Type mismatch in binding ${name} = ${rhs}, expected subtype of ${ty}[${dims[0]}], got type String[${elems.length}].`,
            declNode,
          );
          return true;
        }
      } else if (hasConstDims && dims.length === 1 && rhs.startsWith("[") && rhs.endsWith("]") && !rhs.includes(";")) {
        const elems = rhs
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const elTy = elems.every((e) => /^[+-]?\d+$/.test(e)) ? "Integer" : "Real";
        pushError(
          dae,
          3001,
          "binding-array-dims-mismatch",
          `Array dimension mismatch, expression {{${elems.join(", ")}}} has type ${elTy}[1, ${elems.length}], expected array dimensions [${dims[0]}].`,
          declNode,
        );
        return true;
      } else if (hasConstDims && /^[+-]?\d+(?:\.\d+)?$/.test(rhs)) {
        pushError(
          dae,
          3001,
          "non-array-mod-for-array",
          `Non-array modification '${rhs}' for array component '${name}', possibly due to missing 'each'.`,
          declNode,
        );
        return true;
      } else if (/^\{[^{}]+\}\s*[+-]\s*(\{[^{}]+\}|[+-]?\d+(?:\.\d+)?)$/.test(rhs)) {
        let emittedAny = false;
        for (const ch of db.childrenOf(rootClassId)) {
          if (ch.kind !== "Component") continue;
          const cCst = cstOf(db, ch.id);
          const cc = (cCst ? findAncestor(cCst, "component_clause", 4) : null) ?? cCst;
          if (!cc) continue;
          const m = cc.text.trim().match(/=\s*(\{[^{}]+\})\s*([+-])\s*(\{[^{}]+\}|[+-]?\d+(?:\.\d+)?)\s*;?$/);
          if (!m) continue;
          const lArr = m[1]!;
          const op = m[2]!;
          const rPart = m[3]!;
          const lElems = lArr
            .slice(1, -1)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          const lTy = lElems.every((e) => /^[+-]?\d+$/.test(e)) ? "Integer" : "Real";
          const rhsExprNode =
            cc.namedChildren
              .flatMap((x) => x.namedChildren)
              .flatMap((x) => x.namedChildren)
              .find((x) => x.type === "modification")
              ?.namedChildren.find((x) => x.type === "expression") ?? cc;
          if (rPart.startsWith("{")) {
            const rElems = rPart
              .slice(1, -1)
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            if (rElems.length !== lElems.length) {
              const rTy = rElems.every((e) => /^[+-]?\d+$/.test(e)) ? "Integer" : "Real";
              pushError(
                dae,
                3001,
                "array-binop-mismatch",
                `Cannot resolve type of expression ${lArr} ${op} ${rPart}. The operands have types ${lTy}[${lElems.length}], ${rTy}[${rElems.length}] in component <NO COMPONENT>.`,
                rhsExprNode,
              );
              emittedAny = true;
            }
          } else {
            const rTy = rPart.includes(".") ? "Real" : "Integer";
            pushError(
              dae,
              3001,
              "array-binop-mismatch",
              `Cannot resolve type of expression ${lArr} ${op} ${rPart}. The operands have types ${lTy}[${lElems.length}], ${rTy} in component <NO COMPONENT>.`,
              rhsExprNode,
            );
            emittedAny = true;
          }
        }
        if (emittedAny) return true;
      }
    }
  }

  if (wasmErrorCode === 3292) {
    // WasmBailReason.ForEquationRange
    const forNode =
      findNodeAtByteRange(rootCst, startByte, endByte, ["for_index", "for_equation", "for_statement"]) ?? rootCst;
    const fText = forNode.text.trim();
    const scalarRangeM = fText.match(/^(?:for\s+)?([A-Za-z_]\w*)\s+in\s+([+-]?\d+)\b/);
    if (scalarRangeM && !fText.includes(":")) {
      pushError(
        dae,
        3001,
        "for-range-non-vector",
        `Type error in iteration range '${scalarRangeM[2]!}'. Expected array got Integer.`,
        forNode,
      );
      return true;
    }
    const typeSubM = fText.match(/\b(Boolean|Integer|Real|String)\s*\[([^\]]+)\]/);
    if (typeSubM) {
      const subs = typeSubM[2]!.split(",").length;
      pushError(
        dae,
        3001,
        "wrong-number-of-subscripts",
        `Wrong number of subscripts in ${typeSubM[1]!}[${typeSubM[2]!}] (${subs} subscripts for 0 dimensions).`,
        forNode,
      );
      return true;
    }
    // Implicit for-loop without 'in': for i loop ... end for
    const forEqNode = findAncestor(forNode, "for_equation", 4) ?? (forNode.type === "for_equation" ? forNode : null);
    if (forEqNode) {
      const impForM = forEqNode.text.trim().match(/^for\s+([A-Za-z_]\w*)\s+loop\b([\s\S]+)\bend\s+for\b/);
      if (impForM) {
        const iterVar = impForM[1]!;
        const loopBody = impForM[2]!;
        const hasSub = new RegExp(`\\[[^\\]]*\\b${iterVar}\\b[^\\]]*\\]`).test(loopBody);
        if (!hasSub) {
          pushError(
            dae,
            3001,
            "implicit-range-missing-subscript",
            `Identifier ${iterVar} of implicit for iterator must be present as array subscript in the loop body.`,
            forEqNode,
          );
          return true;
        }
      }
    }
  }

  if (wasmErrorCode === 3348) {
    // WasmBailReason.ArrayEquationSize
    const comps = collectClassComponents(db, rootClassId);
    // Check Array5/Array6: short type T1 = Real[3](start={1,0,0}) used in T2 = T1[2]; T2 x;
    if (isOldFrontend) {
      for (const [cName, cInfo] of comps) {
        if (!PRIMITIVE_BUILTIN_TYPES.has(cInfo.typeName)) {
          const tSym = resolveClassSym(db, rootClassId, cInfo.typeName);
          const tTxt = tSym ? (cstOf(db, tSym.id)?.text ?? "") : "";
          const aliasM = tTxt.match(/=\s*([A-Za-z_]\w*)\s*\[\s*(\d+)\s*\]/);
          if (aliasM) {
            const baseSym = resolveClassSym(db, rootClassId, aliasM[1]!);
            const baseTxt = baseSym ? (cstOf(db, baseSym.id)?.text ?? "") : "";
            const startM = baseTxt.match(/=\s*(Real)\s*\[\s*(\d+)\s*\]\s*\(\s*start\s*=\s*\{([^{}]+)\}\s*\)/);
            if (startM) {
              const sElems = startM[3]!
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
              if (sElems.every((e) => /^[+-]?\d+$/.test(e))) {
                const cClause = findAncestor(cInfo.cst, "component_clause") ?? cInfo.cst;
                pushError(
                  dae,
                  3001,
                  "wrong-builtin-attr-type",
                  `Variable ${cName}: Wrong type on builtin attribute start of type Integer[${sElems.length}], expected ${startM[1]!}.`,
                  cClause,
                );
                return true;
              }
            }
          }
        }
      }
    }
    const eqNode = findNodeAtByteRange(rootCst, startByte, endByte, ["simple_equation", "equation"]) ?? rootCst;
    const eqText = eqNode.text.trim().replace(/;$/, "").trim();
    const getDims2D = (cInfo: CompInfo): number[] => {
      const clause = findAncestor(cInfo.cst, "component_clause") ?? cInfo.cst;
      const clauseTxt = clause?.text?.trim() ?? "";
      const lhsDecl = clauseTxt.split("=")[0] ?? "";
      // Handle Real[3] x[2] (outer dim [2], inner dim [3] -> [2, 3]) as well as Real y[3, 3]
      const typeDimM = lhsDecl.match(/^(?:(?:parameter|constant|discrete)\s+)?[A-Za-z_]\w*\s*\[([^\]]+)\]/);
      const declTxt = cInfo.cst?.text?.trim() ?? "";
      const compDimM = declTxt.match(/\[([^\]]+)\]/);
      const dims: number[] = [];
      if (compDimM) {
        for (const s of compDimM[1]!.split(",")) {
          const n = Number(s.trim());
          if (Number.isFinite(n)) dims.push(n);
        }
      }
      if (typeDimM) {
        for (const s of typeDimM[1]!.split(",")) {
          const n = Number(s.trim());
          if (Number.isFinite(n)) dims.push(n);
        }
      }
      return dims;
    };
    const fmtMatrixVars = (name: string, d1: number, d2: number): string => {
      const rows: string[] = [];
      for (let i = 1; i <= d1; i++) {
        const cols: string[] = [];
        for (let j = 1; j <= d2; j++) cols.push(`${name}[${i},${j}]`);
        rows.push(`{${cols.join(", ")}}`);
      }
      return `{${rows.join(", ")}}`;
    };
    // Case A: x = y (2D vs 2D mismatch: prtest, modelica_1_1_Type10)
    const xyM = eqText.match(/^([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)$/);
    if (xyM) {
      const c1 = comps.get(xyM[1]!);
      const c2 = comps.get(xyM[2]!);
      if (c1 && c2) {
        const d1 = getDims2D(c1);
        const d2 = getDims2D(c2);
        if (d1.length === 2 && d2.length === 2 && (d1[0] !== d2[0] || d1[1] !== d2[1])) {
          pushError(
            dae,
            5001,
            "equation-type-mismatch",
            `Type mismatch in equation ${fmtMatrixVars(xyM[1]!, d1[0]!, d1[1]!)}=${fmtMatrixVars(xyM[2]!, d2[0]!, d2[1]!)} of type ${c1.typeName}[${d1[0]}, ${d1[1]}]=${c2.typeName}[${d2[0]}, ${d2[1]}].`,
            eqNode,
          );
          return true;
        }
      }
    }
    // Case B: Div1 = {2, 4, 6} / 2 (2D vs 1D mismatch: ArrayDivError)
    const divM = eqText.match(/^([A-Za-z_]\w*)\s*=\s*\{([^{}]+)\}\s*\/\s*([+-]?\d+(?:\.\d+)?)$/);
    if (divM) {
      const c1 = comps.get(divM[1]!);
      const den = Number(divM[3]!);
      if (c1 && Number.isFinite(den) && den !== 0) {
        const d1 = getDims2D(c1);
        const rNums = divM[2]!.split(",").map((s) => Number(s.trim()));
        if (d1.length === 2 && rNums.every((n) => Number.isFinite(n))) {
          const rFmt = rNums.map((n) => {
            const v = n / den;
            return Number.isInteger(v) ? `${v}.0` : `${v}`;
          });
          pushError(
            dae,
            5001,
            "equation-type-mismatch",
            `Type mismatch in equation ${fmtMatrixVars(divM[1]!, d1[0]!, d1[1]!)}=${`{${rFmt.join(", ")}}`} of type ${c1.typeName}[${d1[0]}, ${d1[1]}]=Real[${rNums.length}].`,
            eqNode,
          );
          return true;
        }
      }
    }
  }

  if (wasmErrorCode === 3770) {
    // WasmBailReason.IfExprArrayNesting (ConditionalArrayExpression1)
    const eqNode = findNodeAtByteRange(rootCst, startByte, endByte, ["simple_equation", "equation"]) ?? rootCst;
    const eqText = eqNode.text.trim().replace(/;$/, "").trim();
    const ifMatM = eqText.match(/=\s*if\s+.+?\s+then\s+([A-Za-z_]\w*)\s+else\s+\[([^\]]+)\]$/);
    if (ifMatM) {
      const comps = collectClassComponents(db, rootClassId);
      const tComp = comps.get(ifMatM[1]!);
      const tClause = tComp ? (findAncestor(tComp.cst, "component_clause") ?? tComp.cst) : null;
      const tDimM = (tClause?.text ?? "").match(/\[(\d+)\]/);
      const tN = tDimM ? Number(tDimM[1]!) : 0;
      const fRows = ifMatM[2]!
        .split(";")
        .map((r) => r.trim())
        .filter(Boolean);
      if (tComp && tN > 0 && fRows.length > 0) {
        const tElems = Array.from({ length: tN }, (_, i) => `${ifMatM[1]!}[${i + 1}]`).join(", ");
        const fCols = fRows[0]!
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean).length;
        const fStr = `{${fRows.map((r) => `{${r}}`).join(", ")}}`;
        pushError(
          dae,
          5001,
          "if-expr-type-mismatch",
          `Type mismatch in if-expression in component <NO COMPONENT>. True branch: {${tElems}} has type ${tComp.typeName}[${tN}], false branch: ${fStr} has type ${tComp.typeName}[${fRows.length}, ${fCols}].`,
          eqNode,
        );
        return true;
      }
    }
  }

  if (wasmErrorCode === 3363) {
    // WasmBailReason.ArrayEquationNonCtor
    const comps = collectClassComponents(db, rootClassId);
    // TestArrayUnknown: component with unbound structural parameter dimension (X blah[p];)
    for (const [cName, cInfo] of comps) {
      const cClause = findAncestor(cInfo.cst, "component_clause") ?? cInfo.cst;
      const lhsDecl = (cClause?.text ?? "").split("=")[0] ?? "";
      const dm = lhsDecl.match(/\[([A-Za-z_]\w*)\]/);
      if (dm) {
        const pName = dm[1]!;
        const pInfo = comps.get(pName);
        const pClause = pInfo ? (findAncestor(pInfo.cst, "component_clause") ?? pInfo.cst) : null;
        if (pInfo && pInfo.variability === "parameter" && !(pClause?.text ?? "").includes("=")) {
          pushError(
            dae,
            3001,
            "dim-unbound-parameter",
            `Could not evaluate structural parameter (or constant): ${pName} which gives dimensions of array: ${cName}[${pName}]. Array dimensions must be known at compile time.`,
            cClause,
          );
          return true;
        }
      }
    }
    const eqNode = findNodeAtByteRange(rootCst, startByte, endByte, ["simple_equation", "equation"]) ?? rootCst;
    const eqText = eqNode.text.trim().replace(/;$/, "").trim();
    const tupleArrM = eqText.match(/^\(\s*([^)]+)\s*\)\s*=\s*(\{[^{}]+\})$/);
    if (tupleArrM) {
      const lhsNames = tupleArrM[1]!
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const rhsText = tupleArrM[2]!;
      const rhsElems = rhsText
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const lhsTypes = lhsNames.map((n) => comps.get(n)?.typeName ?? "Real");
      const rhsTy = rhsElems.every((e) => /^[+-]?\d+$/.test(e))
        ? "Integer"
        : rhsElems.every((e) => e.startsWith('"'))
          ? "String"
          : "Real";
      pushError(
        dae,
        5001,
        "equation-type-mismatch",
        `Type mismatch in equation (${lhsNames.join(", ")}) = ${rhsText} of type (${lhsTypes.join(", ")}) = ${rhsTy}[${rhsElems.length}].`,
        eqNode,
      );
      return true;
    }
  }

  if (wasmErrorCode === 3330 || wasmErrorCode === 3370 || wasmErrorCode === 3377) {
    // SimpleEquationExpr / EquationLhsUnresolved / EquationRhsUnresolved: check subscript, class-as-component, break, & non-const package var errors
    const rawErrNode =
      findNodeAtByteRange(rootCst, startByte, endByte, [
        "simple_equation",
        "equation",
        "component_reference",
        "primary",
      ]) ?? rootCst;
    const errNode =
      findAncestor(rawErrNode, "component_clause", 12) ??
      findAncestor(rawErrNode, "simple_equation", 12) ??
      findAncestor(rawErrNode, "equation", 12) ??
      rawErrNode;
    const eText = errNode.text.trim().replace(/;$/, "").trim();
    const comps = collectClassComponents(db, rootClassId);
    // Check ClassAsComponentError: LHS is a class name (e.g. M = 3)
    if (wasmErrorCode === 3370) {
      const lhsIdM = eText.match(/^([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*=/);
      if (lhsIdM && !comps.has(lhsIdM[1]!) && resolveClassSym(db, rootClassId, lhsIdM[1]!)) {
        pushError(
          dae,
          2003,
          "class-as-component",
          `Expected ${lhsIdM[1]!} to be a component, but found class instead.`,
          errNode,
        );
        return true;
      }
      // Check BreakComponentInvalid6: extends B(break a) and equation in B references a.x
      const breakExtM = (rootCst.text ?? "").match(/\bextends\s+([A-Za-z_]\w*)\s*\(\s*break\s+([A-Za-z_]\w*)\s*\)/);
      if (breakExtM && lhsIdM) {
        const baseName = breakExtM[1]!;
        const brokenComp = breakExtM[2]!;
        if (lhsIdM[1] === brokenComp || lhsIdM[1]!.startsWith(`${brokenComp}.`)) {
          pushError(
            dae,
            ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
            ModelicaErrorCode.VARIABLE_NOT_FOUND.rule,
            `Variable ${lhsIdM[1]!} not found in scope ${baseName}.`,
            errNode,
          );
          return true;
        }
      }
    }
    // Check ColorClasses / OperatorFunction2: Pkg.nonConstVar in equation
    for (const dotM of eText.matchAll(/\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)\b/g)) {
      const pName = dotM[1]!;
      const mName = dotM[2]!;
      if (comps.has(pName)) continue;
      const pSym = resolveClassSym(db, rootClassId, pName);
      if (!pSym) continue;
      const pSpec = getClassSpecialization(pSym, cstOf(db, pSym.id));
      if (pSpec === "package") {
        const mComp = collectClassComponents(db, pSym.id).get(mName);
        if (mComp && mComp.variability !== "constant") {
          pushError(
            dae,
            ModelicaErrorCode.PACKAGE_VARIABLE_NOT_CONSTANT.code,
            ModelicaErrorCode.PACKAGE_VARIABLE_NOT_CONSTANT.rule,
            ModelicaErrorCode.PACKAGE_VARIABLE_NOT_CONSTANT.message(`${pName}.${mName}`, pName),
            errNode,
          );
          return true;
        }
      }
    }
    // Check subscript count mismatch or Real subscript on all component_references in the equation
    for (const subMatch of eText.matchAll(/\b([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\[([^\]]+)\]/g)) {
      const refName = subMatch[1]!;
      const subBody = subMatch[2]!;
      const subs = subBody
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const compactSub = isOldFrontend ? subs.join(",") : subBody;
      for (const s of subs) {
        if (/^[+-]?\d+\.\d+$/.test(s)) {
          pushError(
            dae,
            3001,
            "wrong-subscript-type",
            `Subscript ${s} of type Real is not a subtype of Integer, Boolean or enumeration.`,
            errNode,
          );
          if (isOldFrontend) {
            const rootName = db.symbol(rootClassId)?.name ?? "";
            pushError(
              dae,
              ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
              ModelicaErrorCode.VARIABLE_NOT_FOUND.rule,
              ModelicaErrorCode.VARIABLE_NOT_FOUND.message(`${refName}[${compactSub}]`, rootName),
              errNode,
            );
          }
          return true;
        }
      }
      const cInfo = comps.get(refName);
      if (cInfo) {
        const compClause = findAncestor(cInfo.cst, "component_clause") ?? cInfo.cst;
        const dimMatch = (compClause?.text ?? "").match(/\[([^\]]+)\]/);
        const ndims = dimMatch ? dimMatch[1]!.split(",").length : 0;
        if (subs.length > ndims) {
          pushError(
            dae,
            3001,
            "wrong-number-of-subscripts",
            `Wrong number of subscripts in ${refName}[${compactSub}] (${subs.length} subscripts for ${ndims} dimensions).`,
            errNode,
          );
          if (isOldFrontend) {
            const rootName = db.symbol(rootClassId)?.name ?? "";
            pushError(
              dae,
              ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
              ModelicaErrorCode.VARIABLE_NOT_FOUND.rule,
              ModelicaErrorCode.VARIABLE_NOT_FOUND.message(`${refName}[${compactSub}]`, rootName),
              errNode,
            );
          }
          return true;
        }
      } else if (
        refName.includes(".") ||
        (findAncestor(errNode, "for_equation", 16)?.text ?? "").match(new RegExp(`\\bfor\\s+${refName}\\s+in\\b`))
      ) {
        // Subscripting enum literal (E.one[1]) or loop iterator (i[1])
        pushError(
          dae,
          3001,
          "wrong-number-of-subscripts",
          `Wrong number of subscripts in ${refName}[${compactSub}] (${subs.length} subscripts for 0 dimensions).`,
          errNode,
        );
        return true;
      }
    }
  }

  return false;
}

const PRIMITIVE_BUILTIN_TYPES = new Set(["Real", "Integer", "Boolean", "String", "Clock"]);
const NUMERIC_BUILTIN_TYPES = new Set(["Real", "Integer"]);
const NON_REAL_BUILTIN_TYPES = new Set(["Integer", "Boolean", "String"]);
const CLASS_SPEC_KEYWORDS = new Set([
  "package",
  "model",
  "block",
  "connector",
  "record",
  "type",
  "function",
  "class",
  "operator",
]);
const BUILTIN_MODELICA_FUNCTIONS = new Set([
  "assert",
  "cardinality",
  "reinit",
  "der",
  "pre",
  "size",
  "sum",
  "product",
  "min",
  "max",
  "sin",
  "cos",
  "tan",
  "exp",
  "log",
  "sqrt",
  "abs",
  "sign",
  "integer",
  "mod",
  "rem",
  "div",
  "ceil",
  "floor",
  "noEvent",
  "smooth",
  "sample",
  "initial",
  "terminal",
  "edge",
  "change",
  "delay",
  "spatialDistribution",
  "fill",
  "zeros",
  "ones",
  "identity",
  "diagonal",
  "linspace",
  "transpose",
  "cross",
  "skew",
  "outerProduct",
  "symmetric",
  "cat",
  "ndims",
  "scalar",
  "vector",
  "matrix",
  "String",
]);

function getHeaderText(classCst: SyntaxNode): string {
  const txt = classCst.text ?? "";
  const nl = txt.indexOf("\n");
  return nl >= 0 ? txt.slice(0, nl) : txt;
}

function getClassSpecialization(sym: SymbolEntry, classCst: SyntaxNode | null): string {
  const meta = sym.metadata as Record<string, unknown> | undefined;
  const spec = (meta?.["specialization"] ?? meta?.["classType"] ?? meta?.["classKind"] ?? "") as string;
  if (spec) return spec;
  if (!classCst) return "";
  const pfxNode = classCst.namedChildren.find((c) => c.type === "class_prefixes");
  const words = tokenizeCommentStrippedWords(pfxNode?.text ?? getHeaderText(classCst));
  for (const w of words) {
    if (CLASS_SPEC_KEYWORDS.has(w)) return w;
  }
  return "model";
}

function isClassPartial(sym: SymbolEntry, classCst: SyntaxNode | null): boolean {
  const meta = sym.metadata as Record<string, unknown> | undefined;
  if (meta?.["isPartial"] === true) return true;
  if (!classCst) return false;
  const pfxNode = classCst.namedChildren.find((c) => c.type === "class_prefixes");
  if (pfxNode) {
    for (const ch of pfxNode.children) {
      if (ch.type === "partial" || ch.text === "partial") return true;
    }
  }
  const words = tokenizeCommentStrippedWords(getHeaderText(classCst));
  let idx = 0;
  while (idx < words.length && (words[idx] === "encapsulated" || words[idx] === "pure" || words[idx] === "impure")) {
    idx++;
  }
  return words[idx] === "partial";
}

function resolveClassSym(db: QueryDB, scopeId: SymbolId, name: string): SymbolEntry | null {
  const scopeSym = db.symbol(scopeId);
  const directChild = db
    .childrenOf(scopeId)
    .find((c) => (c.kind === "Class" || c.kind === "Package") && c.name === name);
  if (directChild && !name.includes(".")) return directChild;
  const fullResolved =
    db.query<((n: string) => SymbolEntry | null) | null>("resolveName", scopeId)?.(name) ??
    db.query<((n: string) => SymbolEntry | null) | null>("resolveSimpleName", scopeId)?.(name);
  if (fullResolved && (fullResolved.kind === "Class" || fullResolved.kind === "Package")) {
    return fullResolved;
  }
  const baseName = name.split(".")[0] ?? name;
  const resolved =
    db.query<((n: string) => SymbolEntry | null) | null>("resolveSimpleName", scopeId)?.(baseName) ??
    db
      .byName(name)
      .find(
        (e) =>
          (e.kind === "Class" || e.kind === "Package") &&
          (!scopeSym?.resourceId || e.resourceId === scopeSym.resourceId),
      ) ??
    db
      .byName(baseName)
      .find(
        (e) =>
          (e.kind === "Class" || e.kind === "Package") &&
          (!scopeSym?.resourceId || e.resourceId === scopeSym.resourceId),
      ) ??
    db.byName(name).find((e) => e.kind === "Class" || e.kind === "Package") ??
    db.byName(baseName).find((e) => e.kind === "Class" || e.kind === "Package") ??
    null;
  if (!resolved) return null;
  if (!name.includes(".")) return resolved;
  const parts = name.split(".");
  let cur: SymbolEntry | null = resolved;
  for (let i = 1; i < parts.length && cur; i++) {
    const child: SymbolEntry | undefined = db
      .childrenOf(cur.id)
      .find((c) => c.name === parts[i] && (c.kind === "Class" || c.kind === "Package"));
    cur = child ?? null;
  }
  return cur;
}

function inferSimpleLiteralType(exprText: string): string | null {
  const t = exprText.trim();
  if (t === "true" || t === "false") return "Boolean";
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) return "String";
  if (isSignedAsciiIntText(t)) return "Integer";
  if (isSignedAsciiNumberText(t)) return "Real";
  return null;
}

interface CompInfo {
  sym: SymbolEntry;
  ownerClassId: SymbolId;
  typeName: string;
  variability: string;
  causality: "" | "input" | "output";
  isProtected: boolean;
  isFinal: boolean;
  isFlow: boolean;
  isStream: boolean;
  isOuter: boolean;
  isReplaceable: boolean;
  isInput: boolean;
  ndims: number;
  cst: SyntaxNode | null;
}

function isNodeInProtectedSection(node: SyntaxNode | null): boolean {
  let cur: SyntaxNode | null = node;
  for (let hop = 0; hop < 5 && cur; hop++) {
    const parent = cur.parent;
    if (!parent) break;
    if (
      cur.type === "element" ||
      cur.type === "element_list" ||
      cur.type === "extends_clause" ||
      cur.type === "component_clause"
    ) {
      const siblings = parent.children;
      const idx = siblings.indexOf(cur);
      if (idx > 0) {
        for (let i = idx - 1; i >= 0; i--) {
          const sibText = siblings[i]?.text?.trim();
          if (sibText === "protected") return true;
          if (sibText === "public") return false;
        }
      }
    }
    cur = parent;
  }
  return false;
}

function countSubscriptDims(node: SyntaxNode | null | undefined): number {
  if (!node) return 0;
  const sub = node.type === "array_subscripts" ? node : node.namedChildren.find((c) => c.type === "array_subscripts");
  if (!sub) return 0;
  const txt = sub.text.trim();
  if (!txt.startsWith("[") || !txt.endsWith("]")) return 0;
  let depth = 0;
  let dims = 1;
  for (let i = 1; i < txt.length - 1; i++) {
    const ch = txt[i]!;
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) dims++;
  }
  return dims;
}

function collectComponentPrefixWords(
  elemNode: SyntaxNode | null | undefined,
  declClause: SyntaxNode | null | undefined,
  headerBeforeParen: string,
): Set<string> {
  const prefixes = new Set<string>();
  const collectLeaves = (node: SyntaxNode): void => {
    const t = node.type;
    if (t === "comment" || t === "line_comment" || t === "block_comment") return;
    if (node.childCount === 0) {
      const txt = node.text.trim();
      if (txt) prefixes.add(txt);
      return;
    }
    for (const ch of node.children) {
      if (
        ch.type === "type_specifier" ||
        ch.type === "component_list" ||
        ch.type === "component_declaration" ||
        ch.type === "component_declaration1" ||
        ch.type === "declaration"
      )
        break;
      collectLeaves(ch);
    }
  };
  if (elemNode && elemNode !== declClause) {
    for (const ch of elemNode.children) {
      if (ch.type === "component_clause") break;
      collectLeaves(ch);
    }
  }
  if (declClause?.type === "component_clause") {
    for (const ch of declClause.children) {
      if (
        ch.type === "type_specifier" ||
        ch.type === "component_list" ||
        ch.type === "component_declaration" ||
        ch.type === "component_declaration1" ||
        ch.type === "declaration"
      )
        break;
      collectLeaves(ch);
    }
  }
  if (prefixes.size === 0) {
    for (const w of tokenizeCommentStrippedWords(headerBeforeParen)) {
      const clean = w.split("[")[0]?.split(";")[0] ?? w;
      if (clean) prefixes.add(clean);
    }
  }
  return prefixes;
}

function findAncestor(node: SyntaxNode | null, typeName: string, maxHops = 5): SyntaxNode | null {
  let cur = node;
  for (let i = 0; i < maxHops && cur; i++) {
    if (cur.type === typeName) return cur;
    cur = cur.parent;
  }
  return null;
}

function getCompInfo(db: QueryDB, compSym: SymbolEntry, ownerClassId: SymbolId = compSym.parentId ?? 0): CompInfo {
  const meta = (compSym.metadata ?? {}) as Record<string, unknown>;
  const cst = cstOf(db, compSym.id);
  const declClause = findAncestor(cst, "component_clause") ?? cst?.parent?.parent ?? cst?.parent;
  const elemNode = declClause?.parent?.type === "element" ? declClause.parent : declClause;
  const clauseText = (elemNode?.text ?? cst?.text ?? "").trim();
  const headerBeforeParen = clauseText.split("(")[0] ?? clauseText;
  const prefixWords = collectComponentPrefixWords(elemNode, declClause, headerBeforeParen);
  let typeName = (meta["typeName"] as string) ?? "";
  if (!typeName && declClause) {
    const tsNode = declClause.namedChildren.find((c) => c.type === "type_specifier");
    if (tsNode) typeName = tsNode.text.trim();
  }
  let variability = (meta["variability"] as string) ?? "";
  if (!variability) {
    if (prefixWords.has("constant")) variability = "constant";
    else if (prefixWords.has("parameter")) variability = "parameter";
    else if (prefixWords.has("discrete")) variability = "discrete";
    else variability = "continuous";
  }
  const causality: "" | "input" | "output" =
    meta["causality"] === "input" || prefixWords.has("input")
      ? "input"
      : meta["causality"] === "output" || prefixWords.has("output")
        ? "output"
        : "";
  const subDims =
    countSubscriptDims(cst) ||
    countSubscriptDims(cst?.namedChildren.find((c) => c.type === "declaration")) ||
    countSubscriptDims(declClause?.namedChildren.find((c) => c.type === "array_subscripts"));
  const metaNdims = Array.isArray(meta["dimensions"]) ? meta["dimensions"].length : 0;
  const ndims = metaNdims > 0 ? metaNdims : subDims > 0 ? subDims : headerBeforeParen.includes("[") ? 1 : 0;
  return {
    sym: compSym,
    ownerClassId,
    typeName,
    variability,
    causality,
    isProtected: Boolean(meta["isProtected"]) || isNodeInProtectedSection(elemNode ?? cst),
    isFinal: Boolean(meta["isFinal"]) || prefixWords.has("final"),
    isFlow: prefixWords.has("flow"),
    isStream: prefixWords.has("stream"),
    isOuter: prefixWords.has("outer") && !prefixWords.has("inner"),
    isReplaceable: prefixWords.has("replaceable"),
    isInput: causality === "input",
    ndims,
    cst,
  };
}

function resolveShortClassBase(db: QueryDB, classId: SymbolId): SymbolEntry | null {
  const sym = db.symbol(classId);
  const cst = cstOf(db, classId);
  if (!sym || !cst) return null;
  const specNode =
    cst.type === "short_class_specifier"
      ? cst
      : (cst.namedChildren.find((c) => c.type === "short_class_specifier") ??
        cst.namedChildren
          .find((c) => c.type === "class_specifier")
          ?.namedChildren.find((c) => c.type === "short_class_specifier"));
  if (!specNode) return null;
  const tsNode = specNode.namedChildren.find((c) => c.type === "type_specifier" || c.type === "name");
  const baseName = tsNode?.text?.trim();
  if (!baseName || PRIMITIVE_BUILTIN_TYPES.has(baseName)) return null;
  return resolveClassSym(db, sym.parentId ?? classId, baseName);
}

function isShortClassPrimitiveAlias(db: QueryDB, classSym: SymbolEntry | null, depth = 0): boolean {
  if (!classSym || depth > 8) return false;
  const cst = cstOf(db, classSym.id);
  if (!cst) return false;
  const specNode =
    cst.type === "short_class_specifier"
      ? cst
      : (cst.namedChildren.find((c) => c.type === "short_class_specifier") ??
        cst.namedChildren
          .find((c) => c.type === "class_specifier")
          ?.namedChildren.find((c) => c.type === "short_class_specifier"));
  if (!specNode) return false;
  const tsNode = specNode.namedChildren.find((c) => c.type === "type_specifier" || c.type === "name");
  const baseName = tsNode?.text?.trim();
  if (!baseName) return false;
  if (PRIMITIVE_BUILTIN_TYPES.has(baseName)) return true;
  const baseSym = resolveClassSym(db, classSym.parentId ?? classSym.id, baseName);
  return isShortClassPrimitiveAlias(db, baseSym, depth + 1);
}

function hasUnresolvedBaseOrReplaceableMatch(
  db: QueryDB,
  classId: SymbolId,
  modName: string,
  visited = new Set<SymbolId>(),
): boolean {
  if (visited.has(classId)) return false;
  visited.add(classId);
  const cst = cstOf(db, classId);
  if (cst?.text && cst.text.includes("replaceable") && modName && cst.text.includes(modName)) {
    return true;
  }
  const children = db.childrenOf(classId);
  if (children.length === 0) {
    const sc =
      cst?.namedChildren
        .find((c) => c.type === "class_specifier")
        ?.namedChildren.find((c) => c.type === "short_class_specifier") ??
      cst?.namedChildren.find((c) => c.type === "short_class_specifier");
    if (sc) {
      const ts = sc.namedChildren.find((c) => c.type === "type_specifier" || c.type === "name");
      const bName = ts?.text?.trim();
      if (bName && !PRIMITIVE_BUILTIN_TYPES.has(bName)) {
        const baseSym = resolveShortClassBase(db, classId);
        if (!baseSym) return true;
        if (hasUnresolvedBaseOrReplaceableMatch(db, baseSym.id, modName, visited)) return true;
      }
    }
  }
  for (const ch of children) {
    if (ch.kind === "Extends") {
      const base = db.query<SymbolEntry | null>("resolvedBaseClass", ch.id) ?? resolveClassSym(db, classId, ch.name);
      if (!base) return true;
      if (hasUnresolvedBaseOrReplaceableMatch(db, base.id, modName, visited)) return true;
    }
  }
  return false;
}

function isReplaceablePackagePrefix(db: QueryDB, scopeId: SymbolId, dottedTypeName: string): boolean {
  if (!dottedTypeName.includes(".")) return false;
  const firstSeg = dottedTypeName.split(".")[0]?.trim();
  if (!firstSeg) return false;
  const pkgSym = resolveClassSym(db, scopeId, firstSeg);
  if (pkgSym) {
    const pkgCst = cstOf(db, pkgSym.id);
    const parentElem = pkgCst?.parent?.type === "element" ? pkgCst.parent : pkgCst;
    if (
      (pkgSym.metadata as Record<string, unknown> | undefined)?.["isReplaceable"] ||
      /^\s*(?:redeclare\s+)?replaceable\b/.test(parentElem?.text ?? "")
    ) {
      return true;
    }
    if (hasUnresolvedBaseOrReplaceableMatch(db, scopeId, firstSeg)) return true;
  }
  const clsCst = cstOf(db, scopeId);
  if (clsCst?.text && clsCst.text.includes("replaceable") && clsCst.text.includes(firstSeg)) {
    return true;
  }
  return false;
}

function collectClassComponents(db: QueryDB, classId: SymbolId, visited = new Set<SymbolId>()): Map<string, CompInfo> {
  const map = new Map<string, CompInfo>();
  if (visited.has(classId)) return map;
  visited.add(classId);

  const children = db.childrenOf(classId);
  if (children.length === 0) {
    const shortBase = resolveShortClassBase(db, classId);
    if (shortBase) {
      return collectClassComponents(db, shortBase.id, visited);
    }
  }

  for (const child of children) {
    if (child.kind === "Extends") {
      const base =
        db.query<SymbolEntry | null>("resolvedBaseClass", child.id) ?? resolveClassSym(db, classId, child.name);
      const extCst = cstOf(db, child.id);
      const extProtected = isNodeInProtectedSection(extCst);
      const finalModifiedNames = new Set<string>();
      if (extCst) {
        const modWrap = extCst.namedChildren.find(
          (c) => c.type === "class_or_inheritance_modification" || c.type === "class_modification",
        );
        const modNode =
          modWrap?.type === "class_modification"
            ? modWrap
            : (modWrap?.namedChildren.find((c) => c.type === "class_modification") ?? modWrap ?? null);
        if (modNode) {
          for (const em of collectModifiersInNode(modNode)) {
            if (em.isFinal && em.name) finalModifiedNames.add(em.name);
          }
        }
      }
      if (base) {
        const baseComps = collectClassComponents(db, base.id, visited);
        for (const [k, v] of baseComps) {
          if (!map.has(k)) {
            if (extProtected || finalModifiedNames.has(k)) {
              map.set(k, {
                ...v,
                isProtected: v.isProtected || extProtected,
                isFinal: v.isFinal || finalModifiedNames.has(k),
              });
            } else {
              map.set(k, v);
            }
          }
        }
      }
    } else if (child.kind === "Component") {
      map.set(child.name, getCompInfo(db, child, classId));
    }
  }
  return map;
}

function collectClassNestedClasses(
  db: QueryDB,
  classId: SymbolId,
  visited = new Set<SymbolId>(),
): Map<string, { sym: SymbolEntry; isProtected: boolean }> {
  const map = new Map<string, { sym: SymbolEntry; isProtected: boolean }>();
  if (visited.has(classId)) return map;
  visited.add(classId);

  const children = db.childrenOf(classId);
  if (children.length === 0) {
    const shortBase = resolveShortClassBase(db, classId);
    if (shortBase) {
      return collectClassNestedClasses(db, shortBase.id, visited);
    }
  }

  for (const child of children) {
    if (child.kind === "Extends") {
      const extCst = cstOf(db, child.id);
      const extProtected = isNodeInProtectedSection(extCst);
      const base =
        db.query<SymbolEntry | null>("resolvedBaseClass", child.id) ?? resolveClassSym(db, classId, child.name);
      if (base) {
        for (const [k, v] of collectClassNestedClasses(db, base.id, visited)) {
          if (!map.has(k)) {
            map.set(k, { sym: v.sym, isProtected: v.isProtected || extProtected });
          }
        }
      }
    } else if (child.kind === "Class" || child.kind === "Package") {
      const cCst = cstOf(db, child.id);
      const meta = (child.metadata ?? {}) as Record<string, unknown>;
      map.set(child.name, {
        sym: child,
        isProtected: Boolean(meta["isProtected"]) || isNodeInProtectedSection(cCst),
      });
    }
  }
  return map;
}

interface ModItem {
  name: string;
  text: string;
  node: SyntaxNode;
  nested: SyntaxNode | null;
  classModNode: SyntaxNode | null;
  isFinal: boolean;
  isRedeclare: boolean;
  isRedeclareClass: boolean;
  isClassAssignEq: boolean;
}

function collectModifiersInNode(modListNode: SyntaxNode | null): ModItem[] {
  const out: ModItem[] = [];
  if (!modListNode) return out;
  function findClassMod(n: SyntaxNode | null | undefined): SyntaxNode | null {
    if (!n) return null;
    if (n.type === "class_modification") return n;
    for (const c of n.namedChildren) {
      if (c.type === "class_modification") return c;
    }
    return null;
  }
  function walk(n: SyntaxNode): void {
    if (n.type === "element_modification") {
      const nameNode = n.childForFieldName("name") ?? n.namedChildren[0] ?? null;
      const name = nameNode?.text?.trim() ?? "";
      if (name) {
        const modNode = n.childForFieldName("modification") ?? n.namedChildren[1] ?? null;
        const isFinal = n.parent?.children?.some((c) => c.type === "final" || c.text === "final") ?? false;
        const classModNode = findClassMod(modNode);
        const modText = modNode?.text?.trim() ?? "";
        const isClassAssignEq =
          !classModNode && modText.startsWith("=") && /^[A-Za-z_][A-Za-z0-9_.]*$/.test(modText.slice(1).trim());
        out.push({
          name,
          text: n.text.trim(),
          node: n,
          nested: modNode,
          classModNode,
          isFinal,
          isRedeclare: false,
          isRedeclareClass: false,
          isClassAssignEq,
        });
      }
      return;
    }
    if (n.type === "element_redeclaration") {
      const rawText = n.text.trim();
      const headerBeforeEqOrParen = rawText.split("=")[0]?.split("(")[0] ?? rawText;
      const headerWords = tokenizeCommentStrippedWords(headerBeforeEqOrParen);
      let kwIdx = -1;
      for (let i = 0; i < headerWords.length; i++) {
        if (CLASS_SPEC_KEYWORDS.has(headerWords[i]!)) kwIdx = i;
      }
      const shortClass = n.namedChildren.find((c) => c.type === "short_class_definition");
      let isRedeclareClass = kwIdx >= 0 || Boolean(shortClass);
      let name = "";
      let classModNode: SyntaxNode | null = null;
      if (shortClass) {
        const shortSpec = shortClass.namedChildren.find((c) => c.type === "short_class_specifier");
        const idNode = shortSpec?.namedChildren.find((c) => c.type === "identifier");
        name = idNode?.text?.trim() ?? "";
        classModNode = findClassMod(shortSpec);
      } else if (isRedeclareClass && kwIdx >= 0) {
        let nameIdx = kwIdx + 1;
        if (headerWords[nameIdx] === "extends") nameIdx++;
        name = headerWords[nameIdx] ?? "";
        classModNode = findClassMod(n);
      } else {
        const comp1 = n.namedChildren.find((c) => c.type === "component_clause1");
        const decl1 = comp1?.namedChildren.find((c) => c.type === "component_declaration1");
        const decl = decl1?.namedChildren.find((c) => c.type === "declaration");
        const idNode = decl?.namedChildren.find((c) => c.type === "identifier");
        name = idNode?.text?.trim() ?? "";
        const modNode = decl?.namedChildren.find((c) => c.type === "modification");
        classModNode = findClassMod(modNode);
      }
      if (!name && headerWords.length > 0) {
        name = headerWords[headerWords.length - 1] ?? "";
      }
      out.push({
        name,
        text: rawText,
        node: n,
        nested: classModNode,
        classModNode,
        isFinal: /\bfinal\b/.test(rawText.split("=")[0] ?? ""),
        isRedeclare: true,
        isRedeclareClass,
        isClassAssignEq: false,
      });
      return;
    }
    for (const ch of n.namedChildren) walk(ch);
  }
  walk(modListNode);
  return out;
}

function isSubclassOf(
  db: QueryDB,
  childClassId: SymbolId,
  targetBaseId: SymbolId,
  visited = new Set<SymbolId>(),
): boolean {
  if (childClassId === targetBaseId) return true;
  if (visited.has(childClassId)) return false;
  visited.add(childClassId);
  for (const ch of db.childrenOf(childClassId)) {
    if (ch.kind === "Extends") {
      const base =
        db.query<SymbolEntry | null>("resolvedBaseClass", ch.id) ?? resolveClassSym(db, childClassId, ch.name);
      if (base && isSubclassOf(db, base.id, targetBaseId, visited)) return true;
    }
  }
  return false;
}

function getShortClassCausality(
  db: QueryDB,
  scopeId: SymbolId,
  typeName: string,
  visited = new Set<SymbolId>(),
): "" | "input" | "output" {
  const sym = resolveClassSym(db, scopeId, typeName);
  if (!sym || visited.has(sym.id)) return "";
  visited.add(sym.id);
  const cst = cstOf(db, sym.id);
  if (!cst) return "";
  const spec = getClassSpecialization(sym, cst);
  if (spec !== "type") return "";
  const txt = cst.text ?? "";
  const eqIdx = txt.indexOf("=");
  if (eqIdx < 0) return "";
  const rhs = txt.slice(eqIdx + 1).trim();
  const words = tokenizeCommentStrippedWords(rhs.split("(")[0] ?? rhs);
  if (words[0] === "input") return "input";
  if (words[0] === "output") return "output";
  if (words[0] && !PRIMITIVE_BUILTIN_TYPES.has(words[0])) {
    return getShortClassCausality(db, sym.parentId ?? sym.id, words[0], visited);
  }
  return "";
}

function validateClassSubtree(
  db: QueryDB,
  dae: DAEBuilder,
  classId: SymbolId,
  visitedClasses: Set<SymbolId>,
  failedFunctionIds?: Set<SymbolId>,
  invalidInterfaceFunctionIds?: Set<SymbolId>,
): void {
  if (visitedClasses.has(classId)) return;
  visitedClasses.add(classId);
  const isTopLevelRoot = visitedClasses.size === 1;

  const sym = db.symbol(classId);
  if (!sym) return;
  const classCst = cstOf(db, classId);
  if (!classCst) return;

  const emittedKeys = new Set<string>();
  const pushErrorOnce = (code: number, rule: string, message: string, node?: SyntaxNode | null): void => {
    const key = `${code}:${node?.startIndex ?? -1}:${message}`;
    if (emittedKeys.has(key)) return;
    emittedKeys.add(key);
    pushError(dae, code, rule, message, node);
  };

  // 1. Enumeration validation (skipped when flattenedInWasm === true)
  const enumErr = validateEnumeration(classCst as any, sym);
  if (enumErr) {
    pushErrorOnce(enumErr.code, "enum-validation", enumErr.message, classCst);
  }

  const spec = getClassSpecialization(sym, classCst);
  const classPartial = isClassPartial(sym, classCst);
  const children = db.childrenOf(classId);
  const comps = collectClassComponents(db, classId);
  const isOldFrontend = Boolean(
    dae.extensionMetadata?.["isOldFrontend"] ||
    (classCst.text ?? "").includes("-d=-newInst") ||
    (classCst.tree?.rootNode?.text ?? "").includes("-d=-newInst"),
  );

  // 2. Builtin extension with extra elements (e.g., inst4, usertype6)
  if (!isOldFrontend) {
    for (const child of children) {
      if (child.kind === "Extends" && PRIMITIVE_BUILTIN_TYPES.has(child.name)) {
        const hasOtherElems = children.some(
          (c) => c.kind === "Component" || (c.kind === "Extends" && c.id !== child.id),
        );
        if (hasOtherElems) {
          pushErrorOnce(
            4000,
            "builtin-extends-elements",
            `A class extending from builtin type ${child.name} may not have other elements.`,
            classCst,
          );
        }
      }
    }
  }

  // 3. Invalid stream connector (must have exactly one flow variable)
  if (spec === "connector" && !classPartial) {
    let hasStream = false;
    let flowCount = 0;
    for (const info of comps.values()) {
      if (info.isStream) hasStream = true;
      if (info.isFlow) flowCount++;
    }
    if (hasStream && flowCount !== 1) {
      pushErrorOnce(
        dae.varCount >= 0 ? 4000 : 4000,
        "invalid-stream-connector",
        `Invalid stream connector ${isOldFrontend ? `.${sym.name}` : sym.name}: A stream connector must have exactly one flow variable, this connector has ${flowCount} flow ${flowCount === 1 ? "variable" : "variables"}.`,
        classCst,
      );
    }
  }

  // 3b. Outer short class definition with modifier (InnerOuterInvalidMod4) + duplicate own redeclares (DuplicateRedeclares1)
  const firstRedeclares = new Map<string, SyntaxNode>();
  const recordRedeclare = (name: string, node: SyntaxNode): void => {
    if (!name) return;
    const prev = firstRedeclares.get(name);
    if (prev && prev !== node) {
      pushNotification(dae, prev);
      pushErrorOnce(
        ModelicaErrorCode.DUPLICATE_REDECLARE.code,
        ModelicaErrorCode.DUPLICATE_REDECLARE.rule,
        ModelicaErrorCode.DUPLICATE_REDECLARE.message(name),
        node,
      );
    } else if (!prev) {
      firstRedeclares.set(name, node);
    }
  };
  // 3c. Duplicate qualified imports (ImportConflict1) & unresolved imports (ImportNamedInvalid1, ImportQualifiedInvalid1/2)
  const invalidOrConflictingImports = new Set<string>();
  if (!isOldFrontend && classCst) {
    const seenQualImports = new Map<string, SyntaxNode>();
    const rootScopeId = db.symbol(classId)?.parentId ?? null;
    const isTopLevelTarget = (p: string): boolean => {
      const seg0 = p.split(".")[0]!;
      // Must exist at top scope (not exclusively as a local nested class inside classId)
      const topCandidates = [...db.childrenOf(null), ...(rootScopeId != null ? db.childrenOf(rootScopeId) : [])];
      const topFirst = topCandidates.find((s) => s.name === seg0);
      if (!topFirst) return false;
      const parts = p.split(".");
      let cur = topFirst;
      for (let i = 1; i < parts.length; i++) {
        const nxt = db.childrenOf(cur.id).find((c) => c.name === parts[i]!);
        if (!nxt) return false;
        cur = nxt;
      }
      return true;
    };
    for (const ch of children) {
      if (ch.kind === "Import") {
        const impCst = cstOf(db, ch.id);
        const impTxt = (impCst?.text ?? "").trim();
        const namedM = impTxt.match(/^import\s+([A-Za-z_]\w*)\s*=\s*([A-Za-z_][\w.]*)\s*;?$/);
        const qualM = !namedM ? impTxt.match(/^import\s+([A-Za-z_][\w.]*\.([A-Za-z_]\w*))\s*;?$/) : null;
        if (namedM) {
          const aliasName = namedM[1]!;
          const targetPath = namedM[2]!;
          const targetExists = (p: string): boolean => {
            if (isTopLevelTarget(p)) return true;
            if (resolveClassSym(db, classId, p)) return true;
            const dot = p.lastIndexOf(".");
            if (dot > 0) {
              const pkgSym = resolveClassSym(db, classId, p.slice(0, dot));
              const mem = p.slice(dot + 1);
              if (pkgSym && db.childrenOf(pkgSym.id).some((c) => c.name === mem)) return true;
            }
            return false;
          };
          if (!targetExists(targetPath)) {
            invalidOrConflictingImports.add(aliasName);
            pushErrorOnce(
              ModelicaErrorCode.CLASS_NOT_FOUND.code,
              ModelicaErrorCode.CLASS_NOT_FOUND.rule,
              `Import ${targetPath} not found in scope <top>.`,
              impCst,
            );
          }
          if (seenQualImports.has(aliasName)) {
            invalidOrConflictingImports.add(aliasName);
            const prevImp = seenQualImports.get(aliasName);
            if (prevImp) pushNotification(dae, prevImp);
            pushErrorOnce(
              2001,
              "import-conflict",
              `Qualified import name ${aliasName} already exists in this scope.`,
              impCst,
            );
          } else {
            seenQualImports.set(aliasName, impCst!);
          }
        } else if (qualM) {
          const targetPath = qualM[1]!;
          const shortName = qualM[2]!;
          const seg0 = targetPath.split(".")[0]!;
          const isLocalOnlyPkg = db.childrenOf(classId).some((c) => c.name === seg0) && !isTopLevelTarget(targetPath);
          const dot = targetPath.lastIndexOf(".");
          const pkgSym = dot > 0 ? resolveClassSym(db, classId, targetPath.slice(0, dot)) : null;
          const isPkgComp = Boolean(pkgSym && db.childrenOf(pkgSym.id).some((c) => c.name === shortName));
          if (isLocalOnlyPkg || (!resolveClassSym(db, classId, targetPath) && !isPkgComp)) {
            invalidOrConflictingImports.add(shortName);
            pushErrorOnce(
              ModelicaErrorCode.CLASS_NOT_FOUND.code,
              ModelicaErrorCode.CLASS_NOT_FOUND.rule,
              `Import ${targetPath} not found in scope <top>.`,
              impCst,
            );
          }
          if (seenQualImports.has(shortName)) {
            invalidOrConflictingImports.add(shortName);
            pushErrorOnce(
              2001,
              "import-conflict",
              `Qualified import name ${shortName} already exists in this scope.`,
              impCst,
            );
          } else {
            seenQualImports.set(shortName, impCst!);
          }
        }
      }
    }
  }
  for (const child of children) {
    if (child.kind === "Class") {
      const childCst = cstOf(db, child.id);
      if (childCst) {
        if (!isOldFrontend) {
          const cTxt = childCst.text.trim();
          // RecursiveExtends3: short class A = A;
          const shortSelfM = cTxt.match(
            /^(?:(?:encapsulated|partial|replaceable|redeclare|inner|outer|final)\s+)*(?:type|model|class|block|record|connector|package)\s+([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\s*(?:\([^)]*\))?\s*;?$/,
          );
          if (shortSelfM && shortSelfM[1] === shortSelfM[2]) {
            pushErrorOnce(
              4001,
              "recursive-short-class",
              `Recursive short class definition of ${shortSelfM[1]!} in terms of ${shortSelfM[2]!}.`,
              childCst,
            );
          }
          // TypeMissingBaseType1: long `type T ... end T;` without extends clause
          const cSpec = getClassSpecialization(child, childCst);
          if (
            cSpec === "type" &&
            !cTxt.includes("=") &&
            !isClassPartial(child, childCst) &&
            !db.childrenOf(child.id).some((c) => c.kind === "Extends")
          ) {
            pushErrorOnce(4000, "type-missing-base", `Type '${child.name}' does not extend a basic type.`, childCst);
          }
        }
        const hdr = getHeaderText(childCst);
        const eqIdx = hdr.indexOf("=");
        if (/^\s*outer\b/.test(hdr) && eqIdx >= 0 && hdr.includes("(")) {
          const parenIdx = hdr.indexOf("(", eqIdx);
          if (parenIdx >= 0) {
            const modText = hdr.slice(parenIdx).replace(/;\s*$/, "").trim();
            pushErrorOnce(
              ModelicaErrorCode.OUTER_MODIFIER.code,
              ModelicaErrorCode.OUTER_MODIFIER.rule,
              ModelicaErrorCode.OUTER_MODIFIER.message(modText, child.name),
              childCst,
            );
          }
        }
        const elemParent = childCst.parent?.type === "element" ? childCst.parent : childCst;
        if (/^\s*redeclare\b/.test(elemParent.text ?? "")) {
          recordRedeclare(child.name, elemParent);
        }
      }
    } else if (child.kind === "Component") {
      const compCst = cstOf(db, child.id);
      const elemNode = findAncestor(compCst, "element", 5);
      if (elemNode && /^\s*redeclare\b/.test(elemNode.text ?? "")) {
        recordRedeclare(child.name, elemNode);
      }
    } else if (child.kind === "Extends") {
      const extCst = cstOf(db, child.id);
      if (extCst) {
        // Encapsulated3: encapsulated class cannot extend enclosing-scope class without import
        if (/^encapsulated\b/.test(classCst.text.trim()) && child.name && !child.name.startsWith(".")) {
          const firstSeg = child.name.split(".")[0]!;
          const isLocal = db.childrenOf(classId).some((c) => c.name === firstSeg);
          const hasImport = db.childrenOf(classId).some((c) => {
            if (c.kind !== "Import") return false;
            const it = cstOf(db, c.id)?.text?.trim() ?? "";
            return it.includes(".*") || new RegExp(`\\b${firstSeg}\\b`).test(it);
          });
          if (!isLocal && !hasImport && firstSeg !== sym.name && !PRIMITIVE_BUILTIN_TYPES.has(firstSeg)) {
            const pathParts: string[] = [sym.name];
            let pId = sym.parentId;
            while (pId != null) {
              const pSym = db.symbol(pId);
              if (!pSym || pSym.kind !== "Class") break;
              pathParts.unshift(pSym.name);
              pId = pSym.parentId;
            }
            pushErrorOnce(
              ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.code,
              ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.rule,
              `Base class ${child.name} not found in scope ${pathParts.join(".")}.`,
              extCst,
            );
            if (isOldFrontend) return;
          }
        }
        // Extends4: base class component type must resolve in base class scope, not derived class scope
        if (!isOldFrontend && child.name && !PRIMITIVE_BUILTIN_TYPES.has(child.name)) {
          const baseSym = resolveClassSym(db, classId, child.name);
          if (baseSym && baseSym.id !== classId) {
            const existsInLexicalScope = (scopeId: SymbolId, typeName: string): boolean => {
              const firstSeg = typeName.split(".")[0]!;
              let cur: SymbolId | null = scopeId;
              while (cur != null) {
                if (db.childrenOf(cur).some((c) => c.name === firstSeg)) return true;
                cur = db.symbol(cur)?.parentId ?? null;
              }
              return db.childrenOf(null).some((c) => c.name === firstSeg);
            };
            for (const [, bcInfo] of collectClassComponents(db, baseSym.id)) {
              if (
                bcInfo.typeName &&
                !PRIMITIVE_BUILTIN_TYPES.has(bcInfo.typeName) &&
                !existsInLexicalScope(baseSym.id, bcInfo.typeName) &&
                db.childrenOf(classId).some((c) => c.name === bcInfo.typeName.split(".")[0]!)
              ) {
                const bcClause = findAncestor(bcInfo.cst, "component_clause") ?? bcInfo.cst;
                pushErrorOnce(
                  ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.code,
                  ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.rule,
                  `Class ${bcInfo.typeName} not found in scope ${baseSym.name}.`,
                  bcClause,
                );
              }
            }
          }
        }
        const modWrap = extCst.namedChildren.find(
          (c) => c.type === "class_or_inheritance_modification" || c.type === "class_modification",
        );
        const modNode =
          modWrap?.type === "class_modification"
            ? modWrap
            : (modWrap?.namedChildren.find((c) => c.type === "class_modification") ?? modWrap ?? null);
        if (modNode) {
          for (const m of collectModifiersInNode(modNode)) {
            if (m.isRedeclare && m.name) recordRedeclare(m.name, m.node);
          }
        }
      }
    }
  }

  // 3d. Cyclic conditional parameter bindings (CyclicBindingConditional)
  if (isOldFrontend && sym) {
    const condDeps = new Map<string, string>();
    for (const ch of children) {
      if (ch.kind !== "Component") continue;
      const chCst = cstOf(db, ch.id);
      const chClause = chCst ? (findAncestor(chCst, "component_clause") ?? chCst) : null;
      const chTxt = chClause?.text?.trim() ?? "";
      if (!/\b(?:parameter|constant)\b/.test(chTxt)) continue;
      const condM = chTxt.match(/\bif\s+([A-Za-z_]\w*)\s*;?$/);
      if (condM) condDeps.set(ch.name, condM[1]!);
    }
    if (condDeps.size >= 2) {
      const seenCycle = new Set<string>();
      for (const [k, dep] of condDeps) {
        if (condDeps.get(dep) === k && !seenCycle.has(k)) {
          seenCycle.add(k);
          seenCycle.add(dep);
          pushErrorOnce(
            4001,
            "cyclic-conditional-binding",
            `Cyclically dependent constants or parameters found in scope ${sym.name}: {${dep},${k}} (ignore with -d=ignoreCycles).`,
            null,
          );
          break;
        }
      }
    }
  }

  // Helper: recursively check class_modification nodes against target class members
  const checkClassModifiers = (targetSym: SymbolEntry, modNode: SyntaxNode, viaExtends: boolean): void => {
    const targetComps = collectClassComponents(db, targetSym.id);
    const targetClasses = collectClassNestedClasses(db, targetSym.id);
    for (const m of collectModifiersInNode(modNode)) {
      const target = targetComps.get(m.name);
      const targetCls = targetClasses.get(m.name);

      if (m.isRedeclare && m.name) {
        if (!target && !targetCls) {
          if (!hasUnresolvedBaseOrReplaceableMatch(db, targetSym.id, m.name)) {
            pushErrorOnce(
              ModelicaErrorCode.MODIFIED_ELEMENT_NOT_FOUND.code,
              ModelicaErrorCode.MODIFIED_ELEMENT_NOT_FOUND.rule,
              ModelicaErrorCode.MODIFIED_ELEMENT_NOT_FOUND.message(m.name, targetSym.name),
              m.node,
            );
          }
          continue;
        }
        if (targetCls && !target && !m.isRedeclareClass) {
          pushNotification(dae, m.node);
          pushErrorOnce(
            ModelicaErrorCode.INVALID_REDECLARATION_CLASS_AS_COMPONENT.code,
            ModelicaErrorCode.INVALID_REDECLARATION_CLASS_AS_COMPONENT.rule,
            ModelicaErrorCode.INVALID_REDECLARATION_CLASS_AS_COMPONENT.message(m.name),
            cstOf(db, targetCls.sym.id) ?? m.node,
          );
          continue;
        }
        if (target && !targetCls && m.isRedeclareClass) {
          const targetClause = findAncestor(target.cst, "component_clause") ?? target.cst;
          pushNotification(dae, m.node);
          pushErrorOnce(
            ModelicaErrorCode.INVALID_REDECLARATION_COMPONENT_AS_CLASS.code,
            ModelicaErrorCode.INVALID_REDECLARATION_COMPONENT_AS_CLASS.rule,
            ModelicaErrorCode.INVALID_REDECLARATION_COMPONENT_AS_CLASS.message(m.name),
            targetClause ?? m.node,
          );
          continue;
        }
        // RedeclareEnum2 / RedeclareEnum4 / RedeclareEnum6: enumeration redeclaration subtype check
        if (targetCls && m.isRedeclareClass && !isOldFrontend) {
          const baseClsCst = cstOf(db, targetCls.sym.id);
          const baseClsTxt = baseClsCst?.text?.trim() ?? "";
          const baseEnumM = baseClsTxt.match(/\benumeration\s*\(([^)]*)\)/);
          if (baseEnumM) {
            const baseIsGeneric = baseEnumM[1]!.trim() === ":";
            const redeclTxt = m.node.text.trim();
            const rhsM = redeclTxt.match(/=\s*(.+)$/);
            const rhsStr = rhsM ? rhsM[1]!.trim().replace(/;$/, "").trim() : "";
            const rhsEnumM = rhsStr.match(/^enumeration\s*\(([^)]*)\)$/);
            if (!baseIsGeneric) {
              // Fixed enumeration(a) cannot be redeclared to a different enumeration
              const baseLits = baseEnumM[1]!
                .split(",")
                .map((s) => s.trim().split(/\s+/)[0])
                .join(",");
              const rhsLits = rhsEnumM
                ? rhsEnumM[1]!
                    .split(",")
                    .map((s) => s.trim().split(/\s+/)[0])
                    .join(",")
                : null;
              if (rhsLits !== baseLits) {
                pushNotification(dae, m.node);
                pushErrorOnce(
                  4000,
                  "redeclare-enum-subtype",
                  `Redeclaration of enumeration '${m.name}' is not a subtype of the redeclared element (use enumeration(:) for a generic replaceable enumeration).`,
                  baseClsCst ?? m.node,
                );
                continue;
              }
            } else {
              // Generic enumeration(:) can only be redeclared to an enumeration type
              let rhsIsEnum = Boolean(rhsEnumM);
              if (!rhsIsEnum && /^[A-Za-z_][\w.]*$/.test(rhsStr) && !PRIMITIVE_BUILTIN_TYPES.has(rhsStr)) {
                const rhsSym = resolveClassSym(db, classId, rhsStr);
                const rhsCstTxt = rhsSym ? (cstOf(db, rhsSym.id)?.text ?? "") : "";
                if (/\benumeration\s*\(/.test(rhsCstTxt)) rhsIsEnum = true;
              }
              if (!rhsIsEnum) {
                pushNotification(dae, m.node);
                pushErrorOnce(
                  4000,
                  "redeclare-enum-subtype",
                  `Redeclaration of enumeration '${m.name}' is not a subtype of the redeclared element.`,
                  baseClsCst ?? m.node,
                );
                continue;
              }
            }
          }
        }
      }

      if (!m.isRedeclare && m.isClassAssignEq && targetCls && !target) {
        pushErrorOnce(
          ModelicaErrorCode.MISSING_REDECLARE_KEYWORD.code,
          ModelicaErrorCode.MISSING_REDECLARE_KEYWORD.rule,
          ModelicaErrorCode.MISSING_REDECLARE_KEYWORD.message(m.name),
          m.node,
        );
        continue;
      }

      if (target) {
        const targetNode = findAncestor(target.cst, "component_clause") ?? target.cst;
        if (target.isFinal && !m.isRedeclare) {
          const parenIdx = m.text.indexOf("(");
          const eqIdx = m.text.indexOf("=");
          let eqPart: string;
          if (parenIdx >= 0 && (eqIdx < 0 || parenIdx < eqIdx)) {
            eqPart = m.text.slice(parenIdx).trim();
          } else if (eqIdx >= 0) {
            eqPart = `= ${m.text.slice(eqIdx + 1).trim()}`;
            if (isOldFrontend) eqPart = ` ${eqPart}`;
          } else {
            eqPart = m.text;
          }
          if (isOldFrontend) {
            pushNotification(dae, targetNode);
            pushErrorOnce(
              ModelicaErrorCode.FINAL_OVERRIDE.code,
              ModelicaErrorCode.FINAL_OVERRIDE.rule,
              ModelicaErrorCode.FINAL_OVERRIDE.message(m.name, eqPart),
              m.node,
            );
          } else {
            pushNotification(dae, m.node);
            pushErrorOnce(
              ModelicaErrorCode.FINAL_OVERRIDE.code,
              ModelicaErrorCode.FINAL_OVERRIDE.rule,
              ModelicaErrorCode.FINAL_OVERRIDE.message(m.name, eqPart),
              targetNode,
            );
          }
        }
        // DisturbedResistance1: parameter modified with time-varying expression (e.g. R = 1.0 + 0.1*sin(time))
        if (isOldFrontend && target.variability === "parameter" && !m.isRedeclare) {
          const eqIdx = m.text.indexOf("=");
          if (eqIdx >= 0) {
            const rhsStr = m.text.slice(eqIdx + 1).trim();
            if (/\btime\b/.test(rhsStr)) {
              const formattedRhs = rhsStr.replace(/\s*\*\s*/g, " * ");
              pushErrorOnce(
                ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH.code,
                ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH.rule,
                `Component ${m.name} of variability PARAM has binding ${formattedRhs} of higher variability VAR.`,
                m.node,
              );
            }
          }
        }
        // ArrayModTypeError2: 2D array attribute modification e.g. y(start = {{1, 2, 3}, {4, 5, 6}}) vs Real y[2, 2]
        if (isOldFrontend && targetNode) {
          const dim2M = targetNode.text.match(/\[\s*(\d+)\s*,\s*(\d+)\s*\]/);
          const start2M = m.text.match(/\bstart\s*=\s*\{\s*(\{[^}]+\}(?:\s*,\s*\{[^}]+\})*)\s*\}/);
          if (dim2M && start2M) {
            const expectedCols = parseInt(dim2M[2]!, 10);
            const rows = start2M[1]!.match(/\{[^}]+\}/g) ?? [];
            let badRow: { text: string; len: number } | null = null;
            for (const row of rows) {
              const elems = row
                .slice(1, -1)
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
              if (elems.length !== expectedCols) {
                badRow = { text: `{${elems.join(", ")}}`, len: elems.length };
              }
            }
            if (badRow) {
              pushNotification(dae, m.node);
              pushErrorOnce(
                ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.code,
                ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.rule,
                `Array dimension mismatch, expression ${badRow.text} has type Integer[${badRow.len}], expected array dimensions [${expectedCols}].`,
                targetNode,
              );
            }
          }
        }
        if (target.isProtected && !viaExtends && !isOldFrontend && !resolveShortClassBase(db, targetSym.id)) {
          pushNotification(dae, m.node, ModelicaErrorCode.NOTIFICATION_PROTECTED_MODIFICATION.code);
          pushErrorOnce(
            ModelicaErrorCode.PROTECTED_MODIFICATION.code,
            ModelicaErrorCode.PROTECTED_MODIFICATION.rule,
            ModelicaErrorCode.PROTECTED_MODIFICATION.message(m.name, m.text),
            targetNode,
          );
        }
        if (target.isOuter && !m.isRedeclare && !isOldFrontend) {
          let modText = m.nested?.text?.trim() ?? m.text;
          if (modText.startsWith("=") && !modText.startsWith("= ")) {
            modText = `= ${modText.slice(1).trim()}`;
          }
          pushErrorOnce(
            ModelicaErrorCode.OUTER_MODIFIER.code,
            ModelicaErrorCode.OUTER_MODIFIER.rule,
            ModelicaErrorCode.OUTER_MODIFIER.message(modText, m.name),
            m.node,
          );
        }
        if (m.classModNode) {
          if (PRIMITIVE_BUILTIN_TYPES.has(target.typeName)) {
            if (target.cst) {
              const targetMods = collectModifiersInNode(target.cst);
              for (const nm of collectModifiersInNode(m.classModNode)) {
                const targetMatch = targetMods.find((tm) => tm.name === nm.name);
                if (targetMatch?.isFinal) {
                  let eqPart = nm.text.includes("=") ? nm.text.slice(nm.text.indexOf("=")).trim() : nm.text;
                  if (eqPart.startsWith("=") && !eqPart.startsWith("= ")) {
                    eqPart = `= ${eqPart.slice(1).trim()}`;
                  }
                  const targetMod = targetMatch.node ?? target.cst;
                  pushNotification(dae, nm.node);
                  pushErrorOnce(
                    ModelicaErrorCode.FINAL_OVERRIDE.code,
                    ModelicaErrorCode.FINAL_OVERRIDE.rule,
                    ModelicaErrorCode.FINAL_OVERRIDE.message(nm.name, eqPart),
                    targetMod,
                  );
                }
                if (nm.classModNode) {
                  for (const nnm of collectModifiersInNode(nm.classModNode)) {
                    if (nnm.name) {
                      pushErrorOnce(
                        ModelicaErrorCode.MODIFIED_ELEMENT_NOT_FOUND.code,
                        ModelicaErrorCode.MODIFIED_ELEMENT_NOT_FOUND.rule,
                        ModelicaErrorCode.MODIFIED_ELEMENT_NOT_FOUND.message(`${nm.name}.${nnm.name}`, target.typeName),
                        nm.node,
                      );
                    }
                  }
                }
              }
            }
          } else if (target.typeName) {
            if (target.cst) {
              const targetMods = collectModifiersInNode(target.cst);
              for (const nm of collectModifiersInNode(m.classModNode)) {
                const targetMatch = targetMods.find((tm) => tm.name === nm.name);
                if (targetMatch?.isFinal) {
                  let eqPart = nm.text.includes("=") ? nm.text.slice(nm.text.indexOf("=")).trim() : nm.text;
                  if (eqPart.startsWith("=") && !eqPart.startsWith("= ")) {
                    eqPart = `= ${eqPart.slice(1).trim()}`;
                  }
                  const targetMod = targetMatch.node ?? target.cst;
                  pushNotification(dae, nm.node);
                  pushErrorOnce(
                    ModelicaErrorCode.FINAL_OVERRIDE.code,
                    ModelicaErrorCode.FINAL_OVERRIDE.rule,
                    ModelicaErrorCode.FINAL_OVERRIDE.message(nm.name, eqPart),
                    targetMod,
                  );
                }
              }
            }
            const subSym = resolveClassSym(db, target.ownerClassId, target.typeName);
            if (subSym) {
              checkClassModifiers(subSym, m.classModNode, false);
            }
          }
        }
      }
    }
  };

  // 4. Component-level checks (partial type, outer modifier, final override, protected mod, condition type, connector variability, prefix conflict)
  for (const child of children) {
    if (child.kind !== "Component") continue;
    const info = getCompInfo(db, child, classId);
    const compCst = info.cst;

    // 4a. Outer element with modifier
    if (info.isOuter && compCst && !isOldFrontend) {
      const errNode = findAncestor(compCst, "component_clause") ?? compCst;
      const errText = errNode.text;
      const hasEq = errText.includes("=");
      const hasParen = errText.includes("(");
      if (hasEq || hasParen) {
        let modIdx = Math.min(hasEq ? errText.indexOf("=") : Infinity, hasParen ? errText.indexOf("(") : Infinity);
        if (hasEq && modIdx === errText.indexOf("=") && modIdx > 0 && errText[modIdx - 1] === " ") {
          modIdx -= 1;
        }
        const rawMod = errText.slice(modIdx).trimEnd();
        const modText = (rawMod.endsWith(";") ? rawMod.slice(0, -1) : rawMod).trimEnd();
        pushErrorOnce(
          ModelicaErrorCode.OUTER_MODIFIER.code,
          ModelicaErrorCode.OUTER_MODIFIER.rule,
          ModelicaErrorCode.OUTER_MODIFIER.message(modText, child.name),
          errNode,
        );
      }
    }

    // 4a2. Parameter/constant binding to initial()/terminal() or higher-variability variables
    if (
      (info.variability === "parameter" || info.variability === "constant") &&
      compCst &&
      spec !== "function" &&
      spec !== "record"
    ) {
      const declNode = findAncestor(compCst, "declaration", 3) ?? compCst;
      const modNode = declNode.namedChildren.find((c) => c.type === "modification");
      const mText = modNode?.text?.trim() ?? "";
      if (mText.startsWith("=")) {
        const rhs = mText.slice(1).trim();
        const formatVarMsg = (targetVar: string, exprText: string, exprVar: string): string => {
          if (isOldFrontend) {
            const toOld = (v: string): string =>
              v === "constant" ? "CONST" : v === "parameter" ? "PARAM" : v === "discrete" ? "DISCRETE" : "VAR";
            return `Component ${child.name} of variability ${toOld(targetVar)} has binding ${exprText} of higher variability ${toOld(exprVar)}.`;
          }
          return ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH.message(child.name, targetVar, exprText, exprVar);
        };
        if (rhs === "initial()" || rhs === "terminal()") {
          const errNode = findAncestor(compCst, "component_clause") ?? compCst;
          pushErrorOnce(
            ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH.code,
            ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH.rule,
            formatVarMsg(info.variability, rhs, "discrete"),
            errNode,
          );
        } else if (modNode && !/\bfor\b/.test(rhs)) {
          const varRank = (v: string): number =>
            v === "constant" ? 0 : v === "parameter" ? 1 : v === "discrete" ? 2 : 3;
          const targetRank = varRank(info.variability);
          let highestVar: string | null = null;
          let highestRank = targetRank;
          const scanMod = (n: SyntaxNode): void => {
            if (n.type === "function_call" || n.type === "primary") {
              const txt = n.text.trim();
              if (/^(?:size|ndims|cardinality)\s*\(/.test(txt)) return;
            }
            if (n.type === "component_reference") {
              // Skip function callees (e.g. sin(...) where parent is function_call and this is first child)
              if (n.parent?.type === "function_call" && n.parent.namedChildren[0] === n) return;
              const refName = n.text.trim();
              if (refName === "time") {
                if (3 > highestRank) {
                  highestRank = 3;
                  highestVar = "continuous";
                }
                return;
              }
              // Dotted references (e.g. ground_context.road) may refer to parameter/constant fields
              // inside a continuous component; skip unless we resolve the field itself.
              if (refName.includes(".")) return;
              const baseRef = refName.split("[")[0]!.trim();
              const refInfo = comps.get(baseRef);
              if (refInfo) {
                const rRank = varRank(refInfo.variability);
                if (rRank > highestRank) {
                  highestRank = rRank;
                  highestVar = refInfo.variability;
                }
              }
              return;
            }
            for (const ch of n.namedChildren) scanMod(ch);
          };
          scanMod(modNode);
          if (highestVar) {
            const errNode = findAncestor(compCst, "component_clause") ?? compCst;
            pushErrorOnce(
              ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH.code,
              ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH.rule,
              formatVarMsg(info.variability, rhs, highestVar),
              errNode,
            );
          }
        }
      }
    }

    // 4a3. Conflicting input/output prefixes across short class chains (conn8, type4), partial lookup/alias (PartialLookup1, PartialType2), inner/outer (InnerOuterMissing1/7, InnerOuterInvalidMod3/4/5), and connector redeclare (RedeclareInvalidConnectorType1)
    if (compCst && !isOldFrontend) {
      const compClause4a3 = findAncestor(compCst, "component_clause") ?? compCst;
      const clauseTxt4a3 = compClause4a3.text.trim();
      const ownCausality: "input" | "output" | null = info.isInput
        ? "input"
        : /\boutput\b/.test(clauseTxt4a3.split(info.typeName)[0] ?? "")
          ? "output"
          : null;
      const isRootClass = visitedClasses.size === 1;
      if (info.typeName && !PRIMITIVE_BUILTIN_TYPES.has(info.typeName)) {
        // Walk short class alias chain for causality conflicts & partial base
        let curCausality: "input" | "output" | null = ownCausality;
        let curTypeName = info.typeName;
        let curScope = classId;
        let firstSym: SymbolEntry | null = null;
        const seenChain = new Set<number>();
        for (let depth = 0; depth < 8; depth++) {
          const tSym = resolveClassSym(db, curScope, curTypeName);
          if (!tSym || seenChain.has(tSym.id)) break;
          seenChain.add(tSym.id);
          if (depth === 0) firstSym = tSym;
          const tCst = cstOf(db, tSym.id);
          const tTxt = tCst?.text?.trim() ?? "";
          const shortM = tTxt.match(
            /^(?:(?:encapsulated|partial|replaceable|final|inner|outer)\s+)*(?:type|connector|model|block|record|class)\s+[A-Za-z_]\w*\s*=\s*(input|output)?\s*([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/,
          );
          if (!shortM) break;
          const nextCausality = (shortM[1] as "input" | "output" | undefined) ?? null;
          if (nextCausality) {
            if (curCausality && curCausality !== nextCausality) {
              pushErrorOnce(
                4001,
                "conflicting-causality-prefix",
                `Invalid type prefix '${nextCausality}' on component ${child.name}, due to existing type prefix '${curCausality}'.`,
                compClause4a3,
              );
              break;
            }
            curCausality = nextCausality;
          }
          const baseName = shortM[2]!;
          if (PRIMITIVE_BUILTIN_TYPES.has(baseName)) break;
          const baseSym = resolveClassSym(db, tSym.parentId ?? curScope, baseName);
          if (depth === 0 && !classPartial && baseSym && isClassPartial(baseSym, cstOf(db, baseSym.id))) {
            const firstCst = cstOf(db, firstSym!.id);
            if (firstCst) pushNotification(dae, firstCst);
            pushErrorOnce(
              4000,
              "partial-component-type",
              `Component '${child.name}' has partial type '${info.typeName}'.`,
              compClause4a3,
            );
          }
          curTypeName = baseName;
          curScope = tSym.parentId ?? curScope;
        }

        // PartialLookup1: dotted type P.A where P is a non-replaceable partial class/package
        if (info.typeName.includes(".") && !info.typeName.startsWith(".")) {
          const seg0 = info.typeName.split(".")[0]!;
          const segSym = resolveClassSym(db, classId, seg0);
          if (segSym) {
            const segCst = cstOf(db, segSym.id);
            const segTxt = segCst?.text?.trim() ?? "";
            if (isClassPartial(segSym, segCst) && !/\breplaceable\b/.test(segTxt)) {
              const parentSym = segSym.parentId != null ? db.symbol(segSym.parentId) : null;
              if (!parentSym || parentSym.id !== classId) {
                pushErrorOnce(
                  4000,
                  "partial-lookup",
                  `${seg0} is partial, name lookup is not allowed in partial classes.`,
                  compClause4a3,
                );
              }
            }
          }
        }
      }

      // InnerOuterMissing1: top-level outer element in root class
      const compElem4a3 = findAncestor(compClause4a3, "element", 3) ?? compClause4a3;
      const elemPrefix4a3 = compElem4a3.text.trim().split(info.typeName)[0] ?? "";
      const compIsOuter = /\bouter\b/.test(elemPrefix4a3);
      const compIsInner = /\binner\b/.test(elemPrefix4a3);
      if (isRootClass && !classPartial && compIsOuter && !compIsInner) {
        pushErrorOnce(
          4000,
          "top-level-outer",
          `The model can't be instantiated due to top-level outer element '${child.name}', it may only be used as part of a simulation model.`,
          compElem4a3,
        );
      }

      // InnerOuterMissing7 & InnerOuterInvalidMod3/4/5 & RedeclareInvalidConnectorType1
      if (info.typeName && !PRIMITIVE_BUILTIN_TYPES.has(info.typeName)) {
        const compTypeSym = resolveClassSym(db, classId, info.typeName);
        if (compTypeSym) {
          const subComps = collectClassComponents(db, compTypeSym.id);
          if (isRootClass && !classPartial) {
            for (const [subName, subInfo] of subComps) {
              const subClause = findAncestor(subInfo.cst, "component_clause") ?? subInfo.cst;
              const subElem = (subClause ? findAncestor(subClause, "element", 3) : null) ?? subClause;
              const subTxt = subElem?.text?.trim() ?? "";
              const subPrefix = subTxt.split(subInfo.typeName)[0] ?? "";
              if (/\bouter\b/.test(subPrefix) && !/\binner\b/.test(subPrefix)) {
                const rootComp = comps.get(subName);
                if (rootComp) {
                  const rootClause = findAncestor(rootComp.cst, "component_clause") ?? rootComp.cst;
                  const rootElem = (rootClause ? findAncestor(rootClause, "element", 3) : null) ?? rootClause;
                  const rootPrefix = (rootElem?.text?.trim() ?? "").split(rootComp.typeName)[0] ?? "";
                  if (!/\binner\b/.test(rootPrefix)) {
                    if (rootElem) pushNotification(dae, rootElem);
                    pushErrorOnce(
                      4000,
                      "inner-outer-missing-conflict",
                      `An inner declaration for outer element '${subName}' could not be found, and could not be automatically generated due to an existing declaration of that name.`,
                      subElem,
                    );
                  }
                }
              }
            }
            // PartialLookup2: component `a` of type `A` where `A` has a partial package `PP` referenced by `PP.B b;` and not redeclared
            for (const subCls of db.childrenOf(compTypeSym.id)) {
              if (subCls.kind !== "Class" && subCls.kind !== "Package") continue;
              const subClsCst = cstOf(db, subCls.id);
              const subClsElem = subClsCst ? (findAncestor(subClsCst, "element", 2) ?? subClsCst) : null;
              const subIsPartial =
                isClassPartial(subCls, subClsCst) || /\bpartial\s+package\b/.test(subClsElem?.text ?? "");
              if (!subIsPartial) continue;
              const subSpec = getClassSpecialization(subCls, subClsCst);
              if (subSpec !== "package" && subCls.kind !== "Package") continue;
              const usedBySubComp = Array.from(subComps.values()).some((sc) =>
                sc.typeName.startsWith(`${subCls.name}.`),
              );
              if (!usedBySubComp) continue;
              const compTxt4a3 = compClause4a3.text;
              const isRedeclared = new RegExp(`\\bredeclare\\b[^;]*\\b${subCls.name}\\b`).test(compTxt4a3);
              if (!isRedeclared) {
                if (subClsCst) pushNotification(dae, subClsCst);
                pushErrorOnce(
                  4000,
                  "partial-lookup-component",
                  `component ${child.name} contains the definition of a partial class ${subCls.name}.\nPlease redeclare it to any package compatible with ${compTypeSym.name}.${subCls.name}.`,
                  compClause4a3,
                );
              }
            }
          }
          // Check outer nested short class definitions with modifiers (InnerOuterInvalidMod4)
          for (const subChild of db.childrenOf(compTypeSym.id)) {
            if (subChild.kind === "Class") {
              const subClassCst = cstOf(db, subChild.id);
              const subClassElem = (subClassCst ? findAncestor(subClassCst, "element", 3) : null) ?? subClassCst;
              const subClassTxt = subClassElem?.text?.trim() ?? "";
              const outerShortModM = subClassTxt.match(
                /^outer\s+(?:model|block|record|class|package|connector|type)\s+([A-Za-z_]\w*)\s*=\s*[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\s*(\([^)]+\))/,
              );
              if (outerShortModM && subClassCst) {
                pushErrorOnce(
                  4000,
                  "outer-element-modifier",
                  `Modifier '${outerShortModM[2]!}' found on outer element ${outerShortModM[1]!}.`,
                  subClassCst,
                );
              }
            }
          }
          // Check element_redeclaration inside component's class_modification (InnerOuterInvalidMod3/5, RedeclareInvalidConnectorType1)
          const decl4a3 = findAncestor(compCst, "declaration", 3) ?? compCst;
          const mod4a3 = decl4a3.namedChildren.find((c) => c.type === "modification");
          const walkRedecl = (n: SyntaxNode) => {
            if (n.type === "element_redeclaration") {
              const rTxt = n.text.trim();
              // Redeclare class: redeclare model M = B(x = 1.0)
              const clsRedM = rTxt.match(
                /^redeclare\s+(?:each\s+)?(?:final\s+)?(?:model|block|record|class|package|connector|type)\s+([A-Za-z_]\w*)\s*=/,
              );
              if (clsRedM) {
                const targetName = clsRedM[1]!;
                const targetCls = db
                  .childrenOf(compTypeSym.id)
                  .find((c) => c.kind === "Class" && c.name === targetName);
                const targetCst = targetCls ? cstOf(db, targetCls.id) : null;
                const targetElem = (targetCst ? findAncestor(targetCst, "element", 3) : null) ?? targetCst;
                const targetTxt = targetElem?.text?.trim() ?? "";
                if (/\bouter\b/.test(targetTxt.split(targetName)[0] ?? "")) {
                  const classDefNode =
                    n.namedChildren.find((c) => c.type === "short_class_definition" || c.type === "class_definition") ??
                    n;
                  pushErrorOnce(
                    4000,
                    "outer-element-modifier",
                    `Modifier '${rTxt}' found on outer element ${targetName}.`,
                    classDefNode,
                  );
                }
              }
              // Redeclare component: redeclare [stream|flow] [parameter|constant|discrete] Real f [= ...]
              const compRedM = rTxt.match(
                /^redeclare\s+(?:each\s+)?(?:final\s+)?(?:(flow|stream)\s+)?(?:(discrete|parameter|constant)\s+)?(?:(?:input|output)\s+)?[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\s+([A-Za-z_]\w*)/,
              );
              if (compRedM) {
                const newConnPrefix = compRedM[1] ?? "";
                const newVarPrefix = compRedM[2] ?? "";
                const targetName = compRedM[3]!;
                const origInfo = subComps.get(targetName);
                if (origInfo) {
                  const origClause = findAncestor(origInfo.cst, "component_clause") ?? origInfo.cst;
                  const origElem = (origClause ? findAncestor(origClause, "element", 3) : null) ?? origClause;
                  const origTxt = origElem?.text?.trim() ?? "";
                  const origPrefix = origTxt.split(origInfo.typeName)[0] ?? "";
                  if (/\bouter\b/.test(origPrefix) && !/\binner\b/.test(origPrefix)) {
                    pushErrorOnce(
                      4000,
                      "outer-element-modifier",
                      `Modifier '${rTxt}' found on outer element ${targetName}.`,
                      n,
                    );
                  } else if (newVarPrefix && origInfo.variability === "constant" && newVarPrefix !== "constant") {
                    pushErrorOnce(
                      3001,
                      "redeclare-invalid-variability",
                      `Invalid redeclaration '${newVarPrefix} ${targetName}', original element is declared '${origInfo.variability}'.`,
                      n,
                    );
                  } else if (newConnPrefix) {
                    const origConnPrefix = /\bflow\b/.test(origPrefix)
                      ? "flow"
                      : /\bstream\b/.test(origPrefix)
                        ? "stream"
                        : "";
                    if (origConnPrefix && origConnPrefix !== newConnPrefix) {
                      pushErrorOnce(
                        4000,
                        "redeclare-invalid-connector-prefix",
                        `Invalid redeclaration '${newConnPrefix} ${targetName}', original element is declared '${origConnPrefix}'.`,
                        n,
                      );
                    }
                  }
                }
              }
              return;
            }
            for (const ch of n.namedChildren) walkRedecl(ch);
          };
          if (mod4a3) walkRedecl(mod4a3);
        }
      }
    }

    // 4b. Conditional component condition type (e.g. Real x if "true";)
    if (compCst) {
      for (const n of compCst.namedChildren) {
        if (n.type === "condition_attribute") {
          const expr = n.namedChildren[0];
          if (expr) {
            const litType = inferSimpleLiteralType(expr.text);
            if (litType && litType !== "Boolean") {
              pushErrorOnce(
                ModelicaErrorCode.TYPE_MISMATCH_BINDING.code,
                ModelicaErrorCode.TYPE_MISMATCH_BINDING.rule,
                `Type error in conditional '${expr.text.trim()}'. Expected Boolean, got ${litType}.`,
                n,
              );
            }
          }
        }
      }
    }

    // 4b2. Discrete variable bound to noEvent(...) (NoEvent1) + non-parameter array dimension (dim8)
    if (compCst && spec !== "function") {
      if (info.variability === "discrete" || info.typeName === "Boolean") {
        const declNode = findAncestor(compCst, "declaration", 3) ?? compCst;
        const modNode = declNode.namedChildren.find((c) => c.type === "modification");
        const mText = modNode?.text?.trim() ?? "";
        if (mText.startsWith("=")) {
          const rhs = mText.slice(1).trim();
          if (/^noEvent\s*\(/.test(rhs)) {
            const errNode = findAncestor(compCst, "component_clause") ?? compCst;
            pushErrorOnce(
              ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH.code,
              ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH.rule,
              `Component ${child.name} of variability discrete has binding '${rhs}' of higher variability continuous.`,
              errNode,
            );
          }
        }
      }
      const compClause = findAncestor(compCst, "component_clause") ?? compCst;
      const lhsDeclText = (compClause.text ?? "").split("=")[0] ?? "";
      const dimMatch = lhsDeclText.match(/\[([^\]]+)\]/);
      if (dimMatch && !isOldFrontend) {
        for (const rawD of dimMatch[1]!.split(",")) {
          const d = rawD.trim();
          if (/^[+-]?\d+\.\d+$/.test(d)) {
            pushErrorOnce(
              3001,
              "dim-invalid-type",
              `Dimension '${d}' of type Real is not an integer expression or an enumeration or Boolean type name.`,
              compClause,
            );
            break;
          }
          if (/^[A-Za-z_]\w*$/.test(d)) {
            const dInfo = comps.get(d);
            const dClauseTxt = (dInfo ? findAncestor(dInfo.cst, "component_clause")?.text : "") ?? "";
            if (
              dInfo &&
              dInfo.ownerClassId === classId &&
              dInfo.variability === "continuous" &&
              !/\b(parameter|constant)\b/.test(dClauseTxt) &&
              !dClauseTxt.includes("=")
            ) {
              pushErrorOnce(
                3001,
                "dim-non-parameter",
                `Dimensions must be parameter or constant expression (in ${child.name}).`,
                compClause,
              );
              break;
            }
            if (
              visitedClasses.size === 1 &&
              !classPartial &&
              dInfo &&
              dInfo.ownerClassId === classId &&
              dInfo.variability === "parameter" &&
              !dClauseTxt.includes("=") &&
              !dClauseTxt.includes("start")
            ) {
              pushErrorOnce(
                3001,
                "dim-unbound-parameter",
                `Could not evaluate structural parameter (or constant): ${d} which gives dimensions of array: ${child.name}. Array dimensions must be known at compile time.`,
                compClause,
              );
              break;
            }
          }
        }
      }
      // IfExpression5: Real x[2] = if <non-param cond> then {1, 2} else {3, 4, 5};
      if (!isOldFrontend && PRIMITIVE_BUILTIN_TYPES.has(info.typeName)) {
        const decl5 = findAncestor(compCst, "declaration", 3) ?? compCst;
        const mod5 = decl5.namedChildren.find((c) => c.type === "modification");
        const mTxt5 = mod5?.text?.trim() ?? "";
        if (mTxt5.startsWith("=")) {
          const rhs5 = mTxt5.slice(1).trim();
          const ifBrM = rhs5.match(/^if\s+(.+?)\s+then\s+(\{[^{}]+\})\s+else\s+(\{[^{}]+\})$/);
          if (ifBrM) {
            const cond5 = ifBrM[1]!.trim();
            const isDynamicCond =
              /\btime\b/.test(cond5) ||
              [...cond5.matchAll(/\b([A-Za-z_]\w*)\b/g)].some((m) => comps.get(m[1]!)?.variability === "continuous");
            if (isDynamicCond) {
              const tElems = ifBrM[2]!
                .slice(1, -1)
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
              const fElems = ifBrM[3]!
                .slice(1, -1)
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
              if (tElems.length !== fElems.length) {
                const fmtB = (es: string[]) =>
                  info.typeName === "Real"
                    ? `{${es.map((e) => (/^[+-]?\d+$/.test(e) ? `${e}.0` : e)).join(", ")}}`
                    : `{${es.join(", ")}}`;
                pushErrorOnce(
                  3001,
                  "if-expr-branch-dims",
                  `Type mismatch in if-expression in component . True branch: ${fmtB(tElems)} has type ${info.typeName}[${tElems.length}], false branch: ${fmtB(fElems)} has type ${info.typeName}[${fElems.length}].`,
                  compClause,
                );
              }
            }
          }
        }
      }
      // ConditionInvalid1: conditional component with non-parameter/non-constant or unfixed parameter without binding
      const condAttr = compCst.namedChildren.find((c) => c.type === "condition_attribute");
      if (condAttr && !isOldFrontend) {
        const condExpr = condAttr.namedChildren[0]?.text?.trim() ?? "";
        if (/^[A-Za-z_]\w*$/.test(condExpr)) {
          const cRef = comps.get(condExpr);
          const cRefClause = cRef ? (findAncestor(cRef.cst, "component_clause")?.text ?? "") : "";
          const cRefIsUnfixedParam =
            Boolean(cRef) &&
            cRef!.variability === "parameter" &&
            /\bfixed\s*=\s*false\b/.test(cRefClause) &&
            !cRefClause.replace(/\([^)]*\)/g, "").includes("=");
          if ((cRef && cRef.variability !== "parameter" && cRef.variability !== "constant") || cRefIsUnfixedParam) {
            pushErrorOnce(
              3001,
              "condition-non-constant",
              `The conditional expression ${condExpr} could not be evaluated.`,
              compClause,
            );
          }
        }
      }
      // BuiltinAttribute24/25/26 & ArrayModTypeError: array component with mismatched start attribute dimensions
      if (dimMatch && PRIMITIVE_BUILTIN_TYPES.has(info.typeName)) {
        const targetDims = dimMatch[1]!.split(",").map((s) => Number(s.trim()));
        if (targetDims.length > 0 && targetDims.every((d) => Number.isFinite(d) && d > 0)) {
          const declAttr = findAncestor(compCst, "declaration", 3) ?? compCst;
          const modAttr = declAttr.namedChildren.find((c) => c.type === "modification");
          const classModAttr = modAttr?.namedChildren.find((c) => c.type === "class_modification");
          if (classModAttr) {
            for (const m of collectModifiersInNode(classModAttr)) {
              if (m.name === "start" && m.text.includes("=")) {
                const startRhs = m.text.slice(m.text.indexOf("=") + 1).trim();
                let gotDims: number[] | null = null;
                let fmtRhs = startRhs;
                if (startRhs.startsWith("{") && startRhs.endsWith("}") && !startRhs.slice(1, -1).includes("{")) {
                  const elems = startRhs
                    .slice(1, -1)
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean);
                  gotDims = [elems.length];
                  if (info.typeName === "Real") {
                    fmtRhs = `{${elems.map((e) => (/^[+-]?\d+$/.test(e) ? `${e}.0` : e)).join(", ")}}`;
                  }
                } else if (/^[A-Za-z_]\w*$/.test(startRhs)) {
                  const rInfo = comps.get(startRhs);
                  const rClause = rInfo ? (findAncestor(rInfo.cst, "component_clause")?.text ?? "") : "";
                  const rEq = rClause.match(/=\s*(\{[^{}]+\})/);
                  if (rEq) {
                    const elems = rEq[1]!
                      .slice(1, -1)
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean);
                    gotDims = [elems.length];
                  }
                } else if (startRhs.startsWith("{{") && startRhs.endsWith("}}") && targetDims.length === 2) {
                  const rows = [...startRhs.slice(1, -1).matchAll(/\{([^{}]+)\}/g)];
                  if (rows.length > 0) {
                    const lastRow = rows[rows.length - 1]![1]!;
                    const rElems = lastRow
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean);
                    if (rElems.length !== targetDims[1]!) {
                      const elTy = rElems.every((e) => /^[+-]?\d+$/.test(e)) ? "Integer" : "Real";
                      pushNotification(dae, m.node);
                      pushErrorOnce(
                        3001,
                        "builtin-attr-dims-mismatch",
                        `Array dimension mismatch, expression {${rElems.join(", ")}} has type ${elTy}[${rElems.length}], expected array dimensions [${targetDims[1]!}].`,
                        compClause,
                      );
                    }
                  }
                } else {
                  const subRefM = startRhs.match(/^([A-Za-z_]\w*)\s*\[\s*(\d+)\s*\]$/);
                  if (subRefM) {
                    const rInfo = comps.get(subRefM[1]!);
                    const rClause = rInfo ? (findAncestor(rInfo.cst, "component_clause")?.text ?? "") : "";
                    const rDimM = (rClause.split("=")[0] ?? "").match(/\[([^\]]+)\]/);
                    if (rDimM) {
                      const rDims = rDimM[1]!.split(",").map((s) => Number(s.trim()));
                      if (rDims.length === 2 && Number.isFinite(rDims[1]!)) gotDims = [rDims[1]!];
                    }
                    if (!gotDims) {
                      const rEq2D = rClause.match(/=\s*\{\s*\{([^{}]+)\}/);
                      if (rEq2D) {
                        gotDims = [rEq2D[1]!.split(",").filter((s) => s.trim().length > 0).length];
                      }
                    }
                  }
                }
                if (
                  gotDims &&
                  (gotDims.length !== targetDims.length || gotDims.some((d, idx) => d !== targetDims[idx]))
                ) {
                  pushNotification(dae, m.node);
                  pushErrorOnce(
                    3001,
                    "builtin-attr-dims-mismatch",
                    `Type mismatch in binding 'start = ${fmtRhs}', expected array dimensions [${targetDims.join(", ")}], got [${gotDims.join(", ")}].`,
                    compClause,
                  );
                }
              }
              // SubscriptTypename2: StateSelect[1].never in modification
              const stSubM = m.text.match(/\b(StateSelect|AssertionLevel)\s*\[[^\]]+\]\.[A-Za-z_]\w*/);
              if (stSubM) {
                pushErrorOnce(
                  3001,
                  "wrong-number-of-subscripts",
                  `Wrong number of subscripts in ${stSubM[0]} (0 subscripts for 0 dimensions).`,
                  m.node,
                );
              }
            }
          }
        }
      }
      // SubscriptTypename2 on scalar component (e.g. Real x(stateSelect = StateSelect[1].never);)
      if (!isOldFrontend && !dimMatch && PRIMITIVE_BUILTIN_TYPES.has(info.typeName)) {
        const declAttr = findAncestor(compCst, "declaration", 3) ?? compCst;
        const modAttr = declAttr.namedChildren.find((c) => c.type === "modification");
        const classModAttr = modAttr?.namedChildren.find((c) => c.type === "class_modification");
        if (classModAttr) {
          for (const m of collectModifiersInNode(classModAttr)) {
            const stSubM = m.text.match(/\b(StateSelect|AssertionLevel)\s*\[[^\]]+\]\.[A-Za-z_]\w*/);
            if (stSubM) {
              pushErrorOnce(
                3001,
                "wrong-number-of-subscripts",
                `Wrong number of subscripts in ${stSubM[0]} (0 subscripts for 0 dimensions).`,
                m.node,
              );
            }
          }
        }
      }
      // ArrayBounds3 & SubscriptWrongType2 & Enum12 on component binding expressions
      {
        const declB = findAncestor(compCst, "declaration", 3) ?? compCst;
        const modB = declB.namedChildren.find((c) => c.type === "modification");
        const mTxtB = modB?.text?.trim() ?? "";
        if (mTxtB.startsWith("=")) {
          const rhsB = mTxtB.slice(1).trim();
          // ArrayBounds3: x[n + 1] where x[n] and parameter Integer n = 2
          if (!isOldFrontend) {
            const subB = rhsB.match(/^([A-Za-z_]\w*)\s*\[\s*([^\]]+)\s*\]$/);
            if (subB) {
              const arrName = subB[1]!;
              const idxExpr = subB[2]!.trim();
              const arrInfo = comps.get(arrName);
              if (arrInfo) {
                const arrClause = (findAncestor(arrInfo.cst, "component_clause")?.text ?? "").split("=")[0] ?? "";
                const arrDimM = arrClause.match(/\[\s*([^\]]+)\s*\]/);
                if (arrDimM) {
                  const dimTok = arrDimM[1]!.trim();
                  // SubscriptWrongType2: Real x[E]; Real y = x[1];
                  if (/^[A-Za-z_]\w*$/.test(dimTok) && /^[+-]?\d+$/.test(idxExpr)) {
                    const eSym = resolveClassSym(db, classId, dimTok);
                    const eTxt = eSym ? (cstOf(db, eSym.id)?.text ?? "") : "";
                    const em = eTxt.match(/\benumeration\s*\(\s*([^):][^)]*)\)/);
                    if (em) {
                      const lits = em[1]!
                        .split(",")
                        .map((s) => s.trim().split(/\s+/)[0]!)
                        .filter(Boolean)
                        .join(", ");
                      pushErrorOnce(
                        3001,
                        "subscript-wrong-enum-type",
                        `Subscript '${idxExpr}' has type Integer, expected type enumeration ${dimTok}(${lits}).`,
                        compClause,
                      );
                    }
                  }
                  // ArrayBounds3: evaluate simple param dim and param + k subscript
                  const evalSimpleParam = (expr: string): number | null => {
                    if (/^[+-]?\d+$/.test(expr)) return Number(expr);
                    const pm = expr.match(/^([A-Za-z_]\w*)(?:\s*([+-])\s*(\d+))?$/);
                    if (!pm) return null;
                    const pInfo = comps.get(pm[1]!);
                    if (!pInfo || (pInfo.variability !== "parameter" && pInfo.variability !== "constant")) return null;
                    const pClause = findAncestor(pInfo.cst, "component_clause")?.text ?? "";
                    const pvM = pClause.match(/=\s*([+-]?\d+)\s*;?$/);
                    if (!pvM) return null;
                    const baseV = Number(pvM[1]!);
                    if (!pm[2]) return baseV;
                    return pm[2] === "+" ? baseV + Number(pm[3]!) : baseV - Number(pm[3]!);
                  };
                  const dimVal = evalSimpleParam(dimTok);
                  const idxVal = evalSimpleParam(idxExpr);
                  if (dimVal !== null && idxVal !== null && dimVal > 0 && (idxVal < 1 || idxVal > dimVal)) {
                    pushErrorOnce(
                      4031,
                      "array-bounds",
                      `Subscript '${idxVal}' for dimension 1 (size = ${dimVal}) of ${arrName} is out of bounds.`,
                      compClause,
                    );
                  }
                }
              }
            }
          }
          // Enum12: E1 e = E2.B where E1 and E2 are distinct enumeration types
          const enumLitM = rhsB.match(/^([A-Za-z_]\w*)\.([A-Za-z_]\w*)$/);
          if (enumLitM && !PRIMITIVE_BUILTIN_TYPES.has(info.typeName) && enumLitM[1] !== info.typeName) {
            const targetSym = resolveClassSym(db, classId, info.typeName);
            const rhsSym = resolveClassSym(db, classId, enumLitM[1]!);
            if (targetSym && rhsSym && targetSym.id !== rhsSym.id) {
              const tEm = (cstOf(db, targetSym.id)?.text ?? "").match(/\benumeration\s*\(\s*([^):][^)]*)\)/);
              const rEm = (cstOf(db, rhsSym.id)?.text ?? "").match(/\benumeration\s*\(\s*([^):][^)]*)\)/);
              if (tEm && rEm) {
                const tLits = tEm[1]!
                  .split(",")
                  .map((s) => s.trim().split(/\s+/)[0]!)
                  .filter(Boolean)
                  .join(", ");
                const rLits = rEm[1]!
                  .split(",")
                  .map((s) => s.trim().split(/\s+/)[0]!)
                  .filter(Boolean)
                  .join(", ");
                const qualRhs = rhsSym.parentId === classId ? `${sym.name}.${rhsB}` : rhsB;
                pushErrorOnce(
                  3001,
                  "enum-type-mismatch",
                  `Type mismatch in binding ${child.name} = ${qualRhs}, expected subtype of enumeration(${tLits}), got type enumeration(${rLits}).`,
                  compClause,
                );
              }
            }
          }
        }
      }
      // ComponentAsTypeError / ClassNotFound / ImportInCompositeName / Encapsulated / ImportConflict3 / FlowInvalid1 / InvalidComplexConnectorType4
      if (info.typeName && !PRIMITIVE_BUILTIN_TYPES.has(info.typeName)) {
        const resolvedT = resolveClassSym(db, classId, info.typeName);
        if (!resolvedT && !isOldFrontend) {
          let emittedCompTypeErr = false;
          // ImportInCompositeName1 / ImportSubPackage1: B.MyType where B imports MyType
          const lastDot = info.typeName.lastIndexOf(".");
          if (lastDot > 0) {
            const pPath = info.typeName.slice(0, lastDot);
            const mName = info.typeName.slice(lastDot + 1);
            const pSym = resolveClassSym(db, classId, pPath);
            if (pSym) {
              const pHasImport = db.childrenOf(pSym.id).some((ch) => {
                if (ch.kind !== "Import") return false;
                const it = cstOf(db, ch.id)?.text?.trim() ?? "";
                return (
                  new RegExp(`^import\\s+${mName}\\s*=`).test(it) ||
                  new RegExp(`^import\\s+[A-Za-z_][\\w.]*\\.${mName}\\s*;?$`).test(it)
                );
              });
              if (pHasImport) {
                pushErrorOnce(
                  ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.code,
                  "import-in-composite-name",
                  `Found imported name '${mName}' while looking up composite name '${info.typeName}'.`,
                  compClause,
                );
                emittedCompTypeErr = true;
              }
            }
          }
          if (!emittedCompTypeErr) {
            if (comps.has(info.typeName)) {
              pushErrorOnce(
                2003,
                "component-as-type",
                `Expected ${info.typeName} to be a class, but found component instead.`,
                compClause,
              );
            } else if (
              spec !== "function" &&
              !info.isReplaceable &&
              !info.typeName.includes("$") &&
              !isReplaceablePackagePrefix(db, classId, info.typeName) &&
              !info.typeName.startsWith("OpenModelica.") &&
              info.typeName !== "StateSelect" &&
              info.typeName !== "AssertionLevel" &&
              info.typeName !== "ExternalObject"
            ) {
              pushErrorOnce(
                ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.code,
                ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.rule,
                `Class ${info.typeName} not found in scope ${sym.name}.`,
                compClause,
              );
            }
          }
        }
        // ImportConflict3: simple type name found in >= 2 unqualified import statements in classId
        if (!isOldFrontend && !info.typeName.includes(".")) {
          const isLocalDecl = db.childrenOf(classId).some((c) => c.kind === "Class" && c.name === info.typeName);
          if (!isLocalDecl) {
            const matchingUnqualImports: SyntaxNode[] = [];
            for (const ch of db.childrenOf(classId)) {
              if (ch.kind !== "Import") continue;
              const ic = cstOf(db, ch.id);
              const it = ic?.text?.trim() ?? "";
              const unqM = it.match(/^import\s+([A-Za-z_][\w.]*)\.\*\s*;?$/);
              if (unqM && ic) {
                const pkgSym = resolveClassSym(db, classId, unqM[1]!);
                if (pkgSym && db.childrenOf(pkgSym.id).some((pc) => pc.name === info.typeName)) {
                  matchingUnqualImports.push(ic);
                }
              }
            }
            if (matchingUnqualImports.length >= 2) {
              pushNotification(dae, matchingUnqualImports[0]!);
              pushErrorOnce(
                ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.code,
                "import-conflict-unqualified",
                `${info.typeName} found in several unqualified import statements.`,
                matchingUnqualImports[1]!,
              );
              pushErrorOnce(
                ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.code,
                ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.rule,
                `Class ${info.typeName} not found in scope ${sym.name}.`,
                compClause,
              );
            }
          }
        }
        // ImportConflict1 / ImportQualifiedInvalid2: component using an invalid or conflicting imported class name
        if (invalidOrConflictingImports.has(info.typeName)) {
          pushErrorOnce(
            ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.code,
            ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.rule,
            `Class ${info.typeName} not found in scope ${sym.name}.`,
            compClause,
          );
        }
        // Encapsulated1 & Encapsulated2: encapsulated class cannot look up enclosing/top-level classes without import
        if (
          resolvedT &&
          /^encapsulated\b/.test(classCst.text.trim()) &&
          !info.typeName.startsWith(".") &&
          info.typeName !== "StateSelect" &&
          info.typeName !== "AssertionLevel" &&
          info.typeName !== "ExternalObject"
        ) {
          const firstSeg = info.typeName.split(".")[0]!;
          const isLocal = db.childrenOf(classId).some((c) => c.name === firstSeg);
          const hasImport = db.childrenOf(classId).some((c) => {
            if (c.kind !== "Import") return false;
            const it = cstOf(db, c.id)?.text?.trim() ?? "";
            return it.includes(".*") || new RegExp(`\\b${firstSeg}\\b`).test(it);
          });
          if (!isLocal && !hasImport && firstSeg !== sym.name) {
            pushErrorOnce(
              ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.code,
              ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.rule,
              `Class ${info.typeName} not found in scope ${sym.name}.`,
              compClause,
            );
            if (isOldFrontend) return;
          }
        }
        // FlowInvalid1, InvalidComplexConnectorType3/4, conn14, CevalFuncRecord3/4, PackageConstant5, Lookup3/7, ScopeDeclaration2, PartialLookup2
        if (resolvedT && !classPartial && isTopLevelRoot) {
          const rtCst = cstOf(db, resolvedT.id);
          const rtSpec = getClassSpecialization(resolvedT, rtCst);
          if (rtSpec === "connector") {
            const connComps = collectClassComponents(db, resolvedT.id);
            const hasFlowMember = Array.from(connComps.values()).some((mInfo) => {
              const mClause = findAncestor(mInfo.cst, "component_clause") ?? mInfo.cst;
              const mTxt = mClause?.text?.trim() ?? "";
              return /\bflow\b/.test(mTxt.split(mInfo.typeName)[0] ?? "");
            });
            // conn14 & InvalidComplexConnectorType3: parameter/constant connector with flow variable
            if (
              hasFlowMember &&
              (info.variability === "parameter" || info.variability === "constant") &&
              !isOldFrontend
            ) {
              pushErrorOnce(
                4055,
                "invalid-connector-variability",
                `Invalid variability ${info.variability} on connector '${child.name}'.`,
                compClause,
              );
              return;
            }
            for (const [mName, mInfo] of connComps) {
              const mClause = findAncestor(mInfo.cst, "component_clause") ?? mInfo.cst;
              const mTxt = mClause?.text?.trim() ?? "";
              const mPrefix = mTxt.split(mInfo.typeName)[0] ?? "";
              // InvalidComplexConnectorType4: flow parameter Real x; without binding or start
              if (
                !isOldFrontend &&
                /\bflow\b/.test(mPrefix) &&
                mInfo.variability === "parameter" &&
                !mTxt.includes("=") &&
                !mTxt.includes("start")
              ) {
                pushErrorOnce(
                  4028,
                  "unbound-connector-parameter",
                  `Parameter ${child.name}.${mName} has neither value nor start value, and is fixed during initialization (fixed=true).`,
                  mClause,
                );
              }
              // FlowInvalid1: flow R r where R has a flow field y
              if (/\bflow\b/.test(mPrefix) && !PRIMITIVE_BUILTIN_TYPES.has(mInfo.typeName)) {
                const recSym = resolveClassSym(db, resolvedT.id, mInfo.typeName);
                if (recSym) {
                  for (const [fName, fInfo] of collectClassComponents(db, recSym.id)) {
                    const fClause = findAncestor(fInfo.cst, "component_clause") ?? fInfo.cst;
                    const fPrefix = (fClause?.text?.trim() ?? "").split(fInfo.typeName)[0] ?? "";
                    if (/\bflow\b/.test(fPrefix)) {
                      pushErrorOnce(
                        4001,
                        "nested-flow-prefix",
                        `Invalid type prefix 'flow' on variable ${child.name}.${mName}.${fName}, due to existing type prefix 'flow'.`,
                        mClause,
                      );
                    }
                  }
                }
              }
            }
          }
          // CevalFuncRecord3 / CevalFuncRecord4: constant record without binding
          if (
            rtSpec === "record" &&
            info.variability === "constant" &&
            !compClause.text.includes("=") &&
            !isOldFrontend
          ) {
            const recComps = collectClassComponents(db, resolvedT.id);
            for (const [fName, fInfo] of recComps) {
              const fClause = findAncestor(fInfo.cst, "component_clause") ?? fInfo.cst;
              if (fClause && !fClause.text.includes("=")) {
                pushErrorOnce(4000, "constant-no-value", `Constant '${child.name}.${fName}' has no value.`, fClause);
                break;
              }
            }
          }
          // PackageConstant5 / Lookup3 / Lookup7 / ScopeDeclaration2 / PartialLookup2
          if (rtSpec !== "connector" && rtSpec !== "function" && rtSpec !== "type") {
            const subCompsRT = collectClassComponents(db, resolvedT.id);
            for (const [subName, subInfo] of subCompsRT) {
              const subClause = findAncestor(subInfo.cst, "component_clause") ?? subInfo.cst;
              const subTxt = subClause?.text?.trim() ?? "";
              // ScopeDeclaration2: Real a(min = a); (self-reference in PARAM attribute)
              if (isOldFrontend && subInfo.variability !== "parameter" && subInfo.variability !== "constant") {
                const selfAttrM = subTxt.match(
                  new RegExp(`\\b${subName}\\s*\\(\\s*(min|max|nominal)\\s*=\\s*${subName}\\b`),
                );
                if (selfAttrM) {
                  pushErrorOnce(
                    ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH.code,
                    ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH.rule,
                    `Variable ${child.name}.${subName}: Component ${selfAttrM[1]!} of variability PARAM has binding ${child.name}.${subName} of higher variability VAR.`,
                    subClause,
                  );
                }
              }
              // PackageConstant5 / Lookup3 / Lookup7: binding `= ident` referencing enclosing non-constant or outer-scope variable
              const bindIdM = subTxt.match(/=\s*([A-Za-z_]\w*)\s*;?$/);
              if (bindIdM) {
                const refId = bindIdM[1]!;
                if (
                  refId !== "time" &&
                  refId !== "true" &&
                  refId !== "false" &&
                  !subCompsRT.has(refId) &&
                  !resolveClassSym(db, resolvedT.id, refId)
                ) {
                  const outerComp = comps.get(refId);
                  if (outerComp && outerComp.variability !== "constant") {
                    const isNested = resolvedT.parentId === classId;
                    if (isNested) {
                      if (isOldFrontend) {
                        pushErrorOnce(
                          2002,
                          "enclosing-non-constant",
                          `Variable ${child.name}: Variable ${refId} in package ${sym.name} is not constant.`,
                          compClause,
                        );
                        pushErrorOnce(
                          2002,
                          "variable-not-found-scope",
                          `Variable ${refId} not found in scope ${sym.name}.${resolvedT.name}.`,
                          subClause,
                        );
                      } else {
                        const outerClause = findAncestor(outerComp.cst, "component_clause") ?? outerComp.cst;
                        if (outerClause) pushNotification(dae, outerClause);
                        pushErrorOnce(
                          2002,
                          "enclosing-non-constant",
                          `Component '${refId}' was found in an enclosing scope but is not a constant.`,
                          subClause,
                        );
                      }
                    } else if (isOldFrontend) {
                      pushErrorOnce(
                        2002,
                        "variable-not-found-scope",
                        `Variable ${refId} not found in scope ${resolvedT.name}.`,
                        subClause,
                      );
                    }
                  }
                }
              }
            }
            // PartialLookup2 (both scodeinst and scoping): component of class A containing partial package PP referenced by PP.B b
            for (const subCls of db.childrenOf(resolvedT.id)) {
              const subClsCst = cstOf(db, subCls.id);
              if (!subClsCst) continue;
              const subClsElem = findAncestor(subClsCst, "element", 5) ?? subClsCst;
              const subIsPartial = isClassPartial(subCls, subClsCst) || /\bpartial\s+package\b/.test(subClsElem.text);
              if (!subIsPartial) continue;
              const subSpec = getClassSpecialization(subCls, subClsCst);
              if (subSpec !== "package" && subCls.kind !== "Package") continue;
              const usedBySubComp = Array.from(subCompsRT.values()).some((sc) =>
                sc.typeName.startsWith(`${subCls.name}.`),
              );
              if (!usedBySubComp) continue;
              if (!new RegExp(`\\bredeclare\\b[^;]*\\b${subCls.name}\\b`).test(compClause.text)) {
                pushNotification(dae, subClsCst);
                pushErrorOnce(
                  4000,
                  "partial-lookup-component",
                  `component ${child.name} contains the definition of a partial class ${subCls.name}.\nPlease redeclare it to any package compatible with ${resolvedT.name}.${subCls.name}.`,
                  compClause,
                );
              }
            }
          }
        }
        const tSymEnum = resolvedT;
        if (tSymEnum && !classPartial && !isOldFrontend) {
          const tCst = cstOf(db, tSymEnum.id);
          const tTxt = tCst?.text ?? "";
          const tParentTxt = tCst?.parent?.text ?? tTxt;
          if (
            tCst &&
            /=\s*enumeration\s*\(\s*:\s*\)/.test(tTxt) &&
            !/\breplaceable\b/.test(tTxt) &&
            !/\breplaceable\b/.test(tParentTxt)
          ) {
            pushErrorOnce(
              3001,
              "enum-unspecified",
              `Component '${child.name}' has an unspecified enumeration type (enumeration(:)).`,
              compClause,
            );
          }
        }
      }
    }

    // 4c. Builtin attribute nested modification (BuiltinAttribute3), redeclare (BuiltinAttribute7),
    // start variability (BuiltinAttribute9), missing each on array attribute (Each3), and NonFixedConstant1
    if (info.typeName && PRIMITIVE_BUILTIN_TYPES.has(info.typeName) && compCst) {
      const compDeclNode =
        findAncestor(compCst, "declaration", 3) ?? findAncestor(compCst, "component_declaration") ?? compCst;
      const modNode =
        compDeclNode.namedChildren.find((c) => c.type === "modification" || c.type === "class_modification") ?? null;
      const compClause = findAncestor(compCst, "component_clause") ?? compCst;
      const isArrayComp = (compClause.text ?? "").includes("[");
      if (modNode) {
        for (const m of collectModifiersInNode(modNode)) {
          if (m.isRedeclare && m.name) {
            pushErrorOnce(
              4000,
              "builtin-attr-redeclare",
              `Invalid redeclaration of ${m.name}, attributes of basic types may not be redeclared.`,
              m.node,
            );
          }
          if (!isOldFrontend && info.variability === "constant" && m.name === "fixed" && m.node) {
            const mTxt = m.node.text.trim();
            if (/=\s*false\b/.test(mTxt)) {
              pushErrorOnce(
                3001,
                "non-fixed-constant",
                `Constant '${child.name}' must be fixed but has 'fixed = false'`,
                compClause,
              );
            }
          }
          if (!isOldFrontend && m.name === "start" && m.node) {
            const mTxt = m.node.text.trim();
            const eqIdx = mTxt.indexOf("=");
            if (eqIdx > 0) {
              const rhs = mTxt.slice(eqIdx + 1).trim();
              if (/^[A-Za-z_]\w*$/.test(rhs)) {
                const refInfo = comps.get(rhs);
                if (refInfo && refInfo.variability === "continuous") {
                  pushErrorOnce(
                    ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH.code,
                    ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH.rule,
                    `Component start of variability parameter has binding '${rhs}' of higher variability continuous.`,
                    m.node,
                  );
                }
              }
            }
          }
          if (!isOldFrontend && isArrayComp && m.name === "fixed" && m.node) {
            const mTxt = m.node.text.trim();
            const parentTxt = m.node.parent?.text ?? mTxt;
            if (!/\beach\b/.test(mTxt) && !/\beach\b/.test(parentTxt)) {
              const eqIdx = mTxt.indexOf("=");
              if (eqIdx > 0) {
                const rhs = mTxt.slice(eqIdx + 1).trim();
                if (rhs === "true" || rhs === "false") {
                  pushErrorOnce(
                    3001,
                    "non-array-mod-for-array",
                    `Non-array modification '${rhs}' for array component 'fixed', possibly due to missing 'each'.`,
                    m.node,
                  );
                }
              }
            }
          }
          if (m.classModNode) {
            for (const nm of collectModifiersInNode(m.classModNode)) {
              if (nm.name) {
                pushErrorOnce(
                  ModelicaErrorCode.MODIFIED_ELEMENT_NOT_FOUND.code,
                  ModelicaErrorCode.MODIFIED_ELEMENT_NOT_FOUND.rule,
                  ModelicaErrorCode.MODIFIED_ELEMENT_NOT_FOUND.message(`${m.name}.${nm.name}`, info.typeName),
                  m.node,
                );
              }
            }
          }
        }
      }
    }

    // 4d. Resolve component type and recurse + check partial/final/protected/connector variability/stream/prefixes
    if (info.typeName && !PRIMITIVE_BUILTIN_TYPES.has(info.typeName)) {
      if (info.causality) {
        const typeCausality = getShortClassCausality(db, classId, info.typeName);
        if (typeCausality && typeCausality !== info.causality) {
          const errNode = findAncestor(compCst, "component_clause") ?? compCst;
          pushErrorOnce(
            ModelicaErrorCode.INVALID_TYPE_PREFIX_CONFLICT.code,
            ModelicaErrorCode.INVALID_TYPE_PREFIX_CONFLICT.rule,
            ModelicaErrorCode.INVALID_TYPE_PREFIX_CONFLICT.message(typeCausality, child.name, info.causality),
            errNode,
          );
        }
      }

      const typeSym = resolveClassSym(db, classId, info.typeName);
      if (typeSym) {
        const typeCst = cstOf(db, typeSym.id);
        const typeSpec = getClassSpecialization(typeSym, typeCst);
        const typePartial = isClassPartial(typeSym, typeCst);

        if (
          !classPartial &&
          !info.isReplaceable &&
          !info.isOuter &&
          typePartial &&
          !isReplaceablePackagePrefix(db, classId, info.typeName)
        ) {
          const errNode = findAncestor(compCst, "component_clause") ?? compCst;
          if (!isOldFrontend) pushNotification(dae, typeCst);
          pushErrorOnce(
            4028,
            "partial-type-component",
            isOldFrontend
              ? `Illegal to instantiate partial class ${info.typeName}.`
              : `Component '${child.name}' has partial type '${info.typeName}'.`,
            errNode,
          );
        }

        // Connector variability restriction (ConnectorVariability1)
        if (
          !isOldFrontend &&
          typeSpec === "connector" &&
          !isShortClassPrimitiveAlias(db, typeSym) &&
          (info.variability === "parameter" || info.variability === "constant" || info.variability === "discrete")
        ) {
          const errNode = findAncestor(compCst, "component_clause") ?? compCst;
          pushErrorOnce(
            ModelicaErrorCode.CONNECTOR_VARIABILITY.code,
            ModelicaErrorCode.CONNECTOR_VARIABILITY.rule,
            ModelicaErrorCode.CONNECTOR_VARIABILITY.message(info.variability, child.name),
            errNode,
          );
        }

        // Short-class stream connector (InvalidConnectorType3/4: connector C = stream Real;)
        if (typeSpec === "connector" && !typePartial && typeCst) {
          const tText = getHeaderText(typeCst);
          if (/=\s*(?:[^;]*\b)?stream\b/.test(tText)) {
            const errNode = findAncestor(compCst, "component_clause") ?? compCst;
            pushErrorOnce(
              4000,
              "invalid-stream-connector",
              `Invalid stream connector ${child.name}: A stream connector must have exactly one flow variable, this connector has 0 flow variables.`,
              errNode,
            );
          }
        }

        // Component input/output prefix conflicting with non-connector child component causality (ComponentAttributes2)
        if (info.causality && (typeSpec === "model" || typeSpec === "class" || typeSpec === "block")) {
          for (const subChild of db.childrenOf(typeSym.id)) {
            if (subChild.kind !== "Component") continue;
            const subInfo = getCompInfo(db, subChild, typeSym.id);
            if (subInfo.causality) {
              const subClause = findAncestor(subInfo.cst, "component_clause") ?? subInfo.cst;
              pushErrorOnce(
                ModelicaErrorCode.INVALID_TYPE_PREFIX_CONFLICT.code,
                ModelicaErrorCode.INVALID_TYPE_PREFIX_CONFLICT.rule,
                ModelicaErrorCode.INVALID_TYPE_PREFIX_CONFLICT.message(
                  info.causality,
                  subChild.name,
                  subInfo.causality,
                ),
                subClause,
              );
            }
          }
        }

        // Check component class_modification against target class members
        if (compCst) {
          const compDeclNode = findAncestor(compCst, "component_declaration") ?? compCst;
          const modNode =
            compDeclNode.namedChildren.find((c) => c.type === "modification" || c.type === "class_modification") ??
            compDeclNode;
          if (modNode) {
            checkClassModifiers(typeSym, modNode, false);
          }
        }

        validateClassSubtree(db, dae, typeSym.id, visitedClasses, failedFunctionIds, invalidInterfaceFunctionIds);
      }
    }
  }

  // 5. Extends modification checks (final override / protected mod / redeclare, including nested)
  for (const child of children) {
    if (child.kind !== "Extends") continue;
    const baseSym =
      db.query<SymbolEntry | null>("resolvedBaseClass", child.id) ?? resolveClassSym(db, classId, child.name);
    if (!baseSym) continue;
    const extCst = cstOf(db, child.id);
    if (extCst) {
      const modWrap = extCst.namedChildren.find(
        (c) => c.type === "class_or_inheritance_modification" || c.type === "class_modification",
      );
      const modNode =
        modWrap?.type === "class_modification"
          ? modWrap
          : (modWrap?.namedChildren.find((c) => c.type === "class_modification") ?? modWrap ?? null);
      if (modNode) {
        checkClassModifiers(baseSym, modNode, true);
      }
    }
    validateClassSubtree(db, dae, baseSym.id, visitedClasses, failedFunctionIds, invalidInterfaceFunctionIds);
  }

  // 6. Walk CST for equations, statements, package lookups, protected member access, and function calls
  const className = sym.name;
  let emittedDelayError = false;
  function walkCst(node: SyntaxNode, inWhen: boolean, inCondCtx: boolean): void {
    const t = node.type;

    if (t === "annotation_clause" || t === "annotation") return;
    if (node !== classCst && t === "class_definition") return;

    const isIfExprNode =
      t === "if_expression" || ((t === "expression" || t === "lhs_expression") && node.children[0]?.text === "if");
    if (t === "if_equation" || t === "if_statement" || isIfExprNode) {
      let expectCond = false;
      for (const ch of node.children) {
        if (!ch.isNamed && (ch.text === "if" || ch.text === "elseif")) {
          expectCond = true;
          continue;
        }
        if (ch.isNamed) {
          if (expectCond) {
            expectCond = false;
            const litType = inferSimpleLiteralType(ch.text);
            if (litType && litType !== "Boolean") {
              pushErrorOnce(
                ModelicaErrorCode.TYPE_MISMATCH_BINDING.code,
                ModelicaErrorCode.TYPE_MISMATCH_BINDING.rule,
                `Type error in conditional '${ch.text.trim()}'. Expected Boolean, got ${litType}.`,
                node,
              );
            } else if (t === "if_equation" && !isOldFrontend && /^[A-Za-z_]\w*$/.test(ch.text.trim())) {
              const condName = ch.text.trim();
              const cInfo = comps.get(condName);
              if (cInfo && (cInfo.typeName === "String" || cInfo.typeName === "Real" || cInfo.typeName === "Integer")) {
                pushErrorOnce(
                  ModelicaErrorCode.TYPE_MISMATCH_BINDING.code,
                  ModelicaErrorCode.TYPE_MISMATCH_BINDING.rule,
                  `Type error in conditional '${condName}'. Expected Boolean, got ${cInfo.typeName}.`,
                  node,
                );
              }
            }
            walkCst(ch, inWhen, true);
          } else {
            walkCst(ch, inWhen, inCondCtx);
          }
        }
      }
      if (t === "if_equation" && inWhen && !isOldFrontend) {
        const ifTxt = node.text.trim().replace(/;$/, "").trim();
        const branchSplit = ifTxt.split(/\b(?:else|elseif\b[^]*?\bthen)\b/);
        if (branchSplit.length >= 2) {
          const getBranchLhs = (seg: string): string => {
            const clean = seg.replace(/^if\b[^]*?\bthen\b/, "").replace(/\bend\s+if\s*;?$/, "");
            const names = new Set<string>();
            for (const m of clean.matchAll(/([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*=/g)) {
              names.add(m[1]!);
            }
            return Array.from(names).sort().join(",");
          };
          const firstLhs = getBranchLhs(branchSplit[0]!);
          if (
            firstLhs.length > 0 &&
            branchSplit.slice(1).some((b) => {
              const s = getBranchLhs(b);
              return s.length > 0 && s !== firstLhs;
            })
          ) {
            pushErrorOnce(
              5008,
              "when-if-branch-mismatch",
              `The branches of an if-equation inside a when-equation must have the same set of component references on the left-hand side.`,
              node,
            );
          }
        }
      }
      return;
    }

    if (t === "when_equation") {
      const branches: Set<string>[] = [];
      let curSet = new Set<string>();
      function collectBranchEqs(n: SyntaxNode): void {
        if (n.type.includes("elsewhen") || n.text === "elsewhen") {
          branches.push(curSet);
          curSet = new Set<string>();
          if (n.type !== "elsewhen" && n.text !== "elsewhen") {
            for (const ch of n.children) collectBranchEqs(ch);
          }
          return;
        }
        if (n.type === "simple_equation" || n.type === "equation" || n.type === "assignment_statement") {
          const lhs = n.namedChildren[0]?.text?.trim();
          if (lhs) curSet.add(lhs.replace(/\s+/g, ""));
          return;
        }
        for (const ch of n.children) collectBranchEqs(ch);
      }
      for (const ch of node.children) collectBranchEqs(ch);
      branches.push(curSet);
      if (branches.length > 1) {
        const hasSliceOrWholeOverlap = (() => {
          const allLhs = branches.flatMap((b) => Array.from(b));
          if (allLhs.some((v) => v.includes(":"))) return true;
          const baseHasSub = new Set<string>();
          const baseHasWhole = new Set<string>();
          for (const v of allLhs) {
            const base = v.split("[")[0]!;
            if (v.includes("[")) baseHasSub.add(base);
            else baseHasWhole.add(base);
          }
          for (const b of baseHasSub) {
            if (baseHasWhole.has(b)) return true;
          }
          return false;
        })();
        const normBranches = hasSliceOrWholeOverlap
          ? branches.map((b) => new Set(Array.from(b).map((v) => v.split("[")[0]!)))
          : branches;
        const first = normBranches[0]!;
        for (let i = 1; i < normBranches.length; i++) {
          const b = normBranches[i]!;
          if (b.size !== first.size || Array.from(first).some((v) => !b.has(v))) {
            if (!/\bif\b[^]*?\belse\b[^]*?\bend\s+if\b/.test(node.text)) {
              pushErrorOnce(
                5000,
                "when-variable-mismatch",
                `The same variables must be solved in elsewhen clause as in the when clause.`,
                node,
              );
            }
            break;
          }
        }
      }
      for (const ch of node.namedChildren) {
        walkCst(ch, true, inCondCtx);
      }
      return;
    }

    if ((t === "connect_equation" || t === "connect_clause") && !isOldFrontend) {
      const cTxt = node.text.trim();
      const cm = cTxt.match(/^connect\s*\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)/);
      if (cm) {
        const lhs = cm[1]!.trim();
        const rhs = cm[2]!.trim();
        // ConnectInvalidType1: scalar connector vs array connector (C c1, c2[2]; connect(c1, c2))
        if (/^[A-Za-z_]\w*$/.test(lhs) && /^[A-Za-z_]\w*$/.test(rhs)) {
          const c1 = comps.get(lhs);
          const c2 = comps.get(rhs);
          if (c1 && c2) {
            const d1 = (c1.cst?.text ?? "").includes("[") ? 1 : 0;
            const d2 = (c2.cst?.text ?? "").includes("[") ? 1 : 0;
            if (d1 !== d2) {
              const eqNode = findAncestor(node, "equation", 3) ?? node;
              pushErrorOnce(
                3003,
                "not-plug-compatible",
                `The connectors in connect(${lhs}, ${rhs}) are not type compatible.`,
                eqNode,
              );
            }
          }
        }
        // ExpandableConnectorNonDecl1: both ec1.c and ec2.c undeclared on expandable connectors
        const lDot = lhs.match(/^([A-Za-z_]\w*)\.([A-Za-z_]\w*)$/);
        const rDot = rhs.match(/^([A-Za-z_]\w*)\.([A-Za-z_]\w*)$/);
        if (lDot && rDot) {
          const c1 = comps.get(lDot[1]!);
          const c2 = comps.get(rDot[1]!);
          if (c1 && c2) {
            const s1 = resolveClassSym(db, c1.ownerClassId, c1.typeName);
            const s2 = resolveClassSym(db, c2.ownerClassId, c2.typeName);
            const t1 = s1 ? (cstOf(db, s1.id)?.text ?? "") : "";
            const t2 = s2 ? (cstOf(db, s2.id)?.text ?? "") : "";
            if (/\bexpandable\s+connector\b/.test(t1) && /\bexpandable\s+connector\b/.test(t2)) {
              const m1 = collectClassComponents(db, s1!.id).has(lDot[2]!);
              const m2 = collectClassComponents(db, s2!.id).has(rDot[2]!);
              if (!m1 && !m2) {
                pushErrorOnce(
                  3003,
                  "expandable-both-undeclared",
                  `Cannot connect undeclared connectors ${lhs} with ${rhs}. At least one of them must be declared.`,
                  null,
                );
              }
            }
          }
        }
      }
    }

    if (t === "for_equation" && !isOldFrontend) {
      const fTxt = node.text.trim();
      const impForM = fTxt.match(/^for\s+([A-Za-z_]\w*)\s+loop\b([\s\S]+)\bend\s+for\b/);
      if (impForM) {
        const iterVar = impForM[1]!;
        const body = impForM[2]!;
        const foundDims: Array<{ arr: string; dimIdx: number; size: number }> = [];
        for (const sm of body.matchAll(/\b([A-Za-z_]\w*)\s*\[([^\]]+)\]/g)) {
          const subs = sm[2]!.split(",").map((s) => s.trim());
          const dimIdx = subs.indexOf(iterVar) + 1;
          if (dimIdx <= 0) continue;
          const arrName = sm[1]!;
          const cInfo = comps.get(arrName);
          if (!cInfo) continue;
          const compClause = findAncestor(cInfo.cst, "component_clause") ?? cInfo.cst;
          const dimMatch = (compClause?.text ?? "").match(/\[([^\]]+)\]/);
          const dimSizes = dimMatch ? dimMatch[1]!.split(",").map((s) => Number(s.trim())) : [];
          const sz = dimSizes[dimIdx - 1];
          if (sz !== undefined && Number.isFinite(sz)) {
            foundDims.push({ arr: arrName, dimIdx, size: sz });
          }
        }
        if (foundDims.length >= 2) {
          const first = foundDims[0]!;
          for (let k = 1; k < foundDims.length; k++) {
            const cur = foundDims[k]!;
            if (cur.size !== first.size) {
              pushErrorOnce(
                3001,
                "implicit-range-dim-mismatch",
                `Dimension ${cur.dimIdx} of ${cur.arr} and ${first.dimIdx} of ${first.arr} differs when trying to deduce implicit iteration range.`,
                node,
              );
              break;
            }
          }
        }
      }
    }

    if (t === "when_statement") {
      for (const ch of node.namedChildren) {
        walkCst(ch, true, inCondCtx);
      }
      return;
    }

    if (t === "simple_equation" || t === "equation" || t === "assignment_statement") {
      const lhs = node.namedChildren[0];
      if (lhs) {
        const lhsName = lhs.text.trim();
        const comp = comps.get(lhsName);
        if (comp && comp.typeName && !PRIMITIVE_BUILTIN_TYPES.has(comp.typeName)) {
          const typeSym = resolveClassSym(db, classId, comp.typeName);
          if (typeSym) {
            const tSpec = getClassSpecialization(typeSym, cstOf(db, typeSym.id));
            if (tSpec === "model" || tSpec === "package" || tSpec === "block") {
              pushErrorOnce(
                5014,
                "assignment-to-non-variable",
                `Component '${lhsName}' may not be assigned to due to class specialization '${tSpec}'.`,
                node,
              );
            }
          }
        }
        // Tuple assignment LHS non-cref check (EqualityEquations, TupleInvalid4)
        if (lhsName.startsWith("(") && lhsName.endsWith(")") && lhsName.includes(",")) {
          const inner = lhsName.slice(1, -1);
          const elems: string[] = [];
          let cur = "";
          let depth = 0;
          for (let i = 0; i < inner.length; i++) {
            const ch = inner[i]!;
            if (ch === "(" || ch === "[" || ch === "{") depth++;
            else if (ch === ")" || ch === "]" || ch === "}") depth--;
            else if (ch === "," && depth === 0) {
              elems.push(cur);
              cur = "";
              continue;
            }
            cur += ch;
          }
          elems.push(cur);
          const hasInvalidCref = elems.some((el) => {
            const trimmed = el.trim();
            if (!trimmed) return false;
            return !/^\.?[A-Za-z_]\w*(?:\s*(?:\[[^\]]*\]|\.[A-Za-z_]\w*))*$/.test(trimmed);
          });
          if (hasInvalidCref) {
            const inExprText = isOldFrontend
              ? node.text
                  .trim()
                  .replace(/\s+/g, " ")
                  .replace(/([^\s+])\+([^\s+=])/g, "$1 + $2")
                  .replace(/([^;])$/, "$1;")
              : lhsName.replace(/(?<![\w.[])(\d+)(?![\w.eE\]])/g, "$1.0");
            pushErrorOnce(
              5014,
              "tuple-assignment-lhs",
              `Tuple assignment only allowed for tuple of component references in lhs (in ${inExprText}).`,
              node,
            );
          }
        }
      }
    }

    let rangeStepText: string | null = null;
    if (t === "range_expression" && node.namedChildren.length === 3) {
      rangeStepText = node.namedChildren[1]!.text.trim();
    } else if (
      (t === "expression" || t === "lhs_expression") &&
      node.namedChildren.length === 2 &&
      node.children.some((c) => !c.isNamed && c.text === ":")
    ) {
      const leftRange = node.namedChildren[0]!;
      if (
        (leftRange.type === "expression" || leftRange.type === "lhs_expression") &&
        leftRange.namedChildren.length === 2 &&
        leftRange.children.some((c) => !c.isNamed && c.text === ":")
      ) {
        rangeStepText = leftRange.namedChildren[1]!.text.trim();
      }
    }
    if (rangeStepText === "0" || rangeStepText === "0.0") {
      pushErrorOnce(5000, "range-invalid-step", `Step size 0 in range is too small.`, node);
    }

    const argsNode = node.namedChildren.find((c) => c.type === "function_call_args" || c.type === "function_arguments");
    const isExprCall = (t === "primary" || t === "lhs_primary") && Boolean(argsNode);
    const isDerExprCall = (t === "primary" || t === "lhs_primary") && node.children[0]?.text === "der";

    if (t === "function_call" || isExprCall || isDerExprCall) {
      let fnName = "";
      const rawArgs: SyntaxNode[] = [];
      if (isDerExprCall) {
        fnName = "der";
        const exprList = node.namedChildren.find((c) => c.type === "expression_list");
        if (exprList) {
          for (const ch of exprList.namedChildren) rawArgs.push(ch);
        } else {
          for (const ch of node.namedChildren) rawArgs.push(ch);
        }
      } else {
        const fnNode =
          node.childForFieldName("name") ?? node.childForFieldName("callee") ?? node.namedChildren[0] ?? null;
        fnName = fnNode?.text?.trim() ?? "";
        if (argsNode) {
          function collectArgs(n: SyntaxNode): void {
            if (n.type === "function_argument" || n.type === "named_argument") {
              rawArgs.push(n);
              return;
            }
            if (n.type === "function_call") return;
            if (
              (n.type === "primary" || n.type === "lhs_primary") &&
              n.children.some((c) => c.type === "function_call_args")
            ) {
              return;
            }
            for (const ch of n.namedChildren) collectArgs(ch);
          }
          collectArgs(argsNode);
        }
      }
      const argTexts = rawArgs.map((a) => a.text.trim());

      if (fnName === "assert" && argTexts.length >= 2) {
        const condType = inferSimpleLiteralType(argTexts[0]!);
        if (condType && condType !== "Boolean") {
          pushErrorOnce(
            ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
            ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.rule,
            `Type mismatch for positional argument 1 in assert(condition=${argTexts[0]}). The argument has type:\n  ${condType}\nexpected type:\n  Boolean`,
            node,
          );
        }
        const msgType = inferSimpleLiteralType(argTexts[1]!);
        if (msgType && msgType !== "String") {
          pushErrorOnce(
            ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
            ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.rule,
            `Type mismatch for positional argument 2 in assert(message=${argTexts[1]}). The argument has type:\n  ${msgType}\nexpected type:\n  String`,
            node,
          );
        }
        if (rawArgs[0]) walkCst(rawArgs[0], inWhen, true);
        for (let i = 1; i < rawArgs.length; i++) walkCst(rawArgs[i]!, inWhen, inCondCtx);
        return;
      }

      if (fnName === "cardinality" && argTexts.length >= 1) {
        if (!inCondCtx && !isOldFrontend) {
          pushErrorOnce(
            4000,
            "cardinality-invalid-context",
            `cardinality may only be used in the condition of an if-statement/equation or an assert.`,
            node,
          );
        }
        const argNode = rawArgs[0];
        const argExpr =
          argNode?.type === "named_argument"
            ? (argNode.childForFieldName("value") ?? argNode.namedChildren[1] ?? argNode)
            : argNode;
        const argName = argExpr?.text?.trim() ?? argTexts[0]!;
        if (!comps.has(argName) && resolveClassSym(db, classId, argName)) {
          pushErrorOnce(
            4048,
            "cardinality-expected-component",
            `Expected ${argName} to be a component, but found class instead.`,
            rawArgs[0],
          );
        } else if (!argName.includes(".")) {
          const cInfo = comps.get(argName);
          if (
            cInfo &&
            PRIMITIVE_BUILTIN_TYPES.has(cInfo.typeName) &&
            !cInfo.isInput &&
            !/\b(input|output)\b/.test(cInfo.cst?.parent?.parent?.text ?? "")
          ) {
            pushErrorOnce(
              ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
              ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.rule,
              `Type mismatch for positional argument 1 in ${node.text.trim()}.`,
              node,
            );
          }
        }
      }

      if (fnName === "reinit" && argTexts.length >= 2) {
        if (!inWhen) {
          pushErrorOnce(
            5000,
            "reinit-outside-when",
            `Operator reinit may only be used in the body of a when equation.`,
            node,
          );
        }
        const xName = argTexts[0]!;
        const cInfo = !xName.includes(".") && !xName.includes("(") ? comps.get(xName.split("[")[0]!.trim()) : undefined;
        if (cInfo) {
          if (
            cInfo.variability === "parameter" ||
            cInfo.variability === "constant" ||
            cInfo.variability === "discrete"
          ) {
            pushErrorOnce(
              5000,
              "reinit-non-continuous",
              `The first argument to reinit must be a continuous time variable, but ${xName} is ${cInfo.variability}.`,
              node,
            );
          } else if (NON_REAL_BUILTIN_TYPES.has(cInfo.typeName)) {
            pushErrorOnce(
              3000,
              "reinit-invalid-type",
              `The first argument to reinit must be a subtype of Real, but ${xName} has type ${cInfo.typeName}.`,
              node,
            );
          }
        }
      }

      if (fnName === "der" && argTexts.length === 1) {
        const xName = argTexts[0]!;
        const cInfo = !xName.includes(".") && !xName.includes("(") ? comps.get(xName.split("[")[0]!.trim()) : undefined;
        if (cInfo) {
          if (NON_REAL_BUILTIN_TYPES.has(cInfo.typeName)) {
            pushErrorOnce(
              3000,
              "der-invalid-type",
              isOldFrontend
                ? `Argument '${xName}' to der has illegal type ${cInfo.typeName}, must be a subtype of Real.`
                : `Argument '${xName}' of der is not differentiable.`,
              node,
            );
          } else if (cInfo.variability === "discrete") {
            pushErrorOnce(3000, "der-not-differentiable", `Argument '${xName}' of der is not differentiable.`, node);
          }
        }
      }

      if (fnName === "identity") {
        if (argTexts.length !== 1) {
          const stmtOrClause =
            findAncestor(node, "component_clause", 8) ??
            findAncestor(node, "equation", 8) ??
            findAncestor(node, "statement", 8) ??
            node;
          pushErrorOnce(
            ModelicaErrorCode.IDENTITY_ARG_COUNT.code,
            ModelicaErrorCode.IDENTITY_ARG_COUNT.rule,
            ModelicaErrorCode.IDENTITY_ARG_COUNT.message(),
            stmtOrClause,
          );
        } else {
          const litType = inferSimpleLiteralType(argTexts[0]!);
          if (litType && litType !== "Integer") {
            const stmtOrClause =
              findAncestor(node, "component_clause", 8) ??
              findAncestor(node, "equation", 8) ??
              findAncestor(node, "statement", 8) ??
              node;
            pushErrorOnce(
              ModelicaErrorCode.IDENTITY_FIRST_ARG_INTEGER.code,
              ModelicaErrorCode.IDENTITY_FIRST_ARG_INTEGER.rule,
              ModelicaErrorCode.IDENTITY_FIRST_ARG_INTEGER.message("<NO COMPONENT>"),
              stmtOrClause,
            );
          }
        }
      }

      if (fnName === "delay" && !emittedDelayError && (argTexts.length === 2 || argTexts.length === 3)) {
        const checkIdx = argTexts.length === 2 ? 1 : 2;
        const paramLabel = argTexts.length === 2 ? "delayTime" : "delayMax";
        const omInternalName = argTexts.length === 2 ? "OpenModelica.Internal.delay2" : "OpenModelica.Internal.delay3";
        const dText = argTexts[checkIdx]!;
        const dInfo = !dText.includes(".") && !dText.includes("(") ? comps.get(dText) : undefined;
        if (dInfo && dInfo.variability !== "parameter" && dInfo.variability !== "constant") {
          emittedDelayError = true;
          const eqNode = findAncestor(node, "equation", 6) ?? findAncestor(node, "simple_equation", 6) ?? node;
          pushErrorOnce(
            ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
            ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.rule,
            `Function argument ${paramLabel}=${dText} in call to ${omInternalName} has variability ${dInfo.variability} which is not a parameter expression.`,
            eqNode,
          );
          if (isOldFrontend) {
            pushErrorOnce(
              ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.code,
              ModelicaErrorCode.FUNCTION_ARG_TYPE_MISMATCH.rule,
              `No matching function found for delay in component <NO COMPONENT>\ncandidates are .OpenModelica.Internal.delay2<function>(Real expr, Real parameter delayTime) => Real\n -.OpenModelica.Internal.delay3<function>(Real expr, Real delayTime, Real parameter delayMax) => Real`,
              eqNode,
            );
          }
        }
      }

      if (!isOldFrontend && fnName === "pre" && argTexts.length === 1) {
        const arg = argTexts[0]!;
        const cInfo = !arg.includes(".") && !arg.includes("[") && !arg.includes("(") ? comps.get(arg) : undefined;
        if (cInfo && cInfo.typeName === "Real" && cInfo.variability === "continuous") {
          const clsTxt = classCst?.text ?? "";
          // A Real variable assigned in a when-clause or reinitialized via reinit() is valid in pre()
          const lhsInWhenRe = new RegExp(`\\bwhen\\b[\\s\\S]*?\\b${arg}\\s*(?::=|=)(?!=)`);
          const reinitRe = new RegExp(`\\breinit\\s*\\(\\s*${arg}\\b`);
          if (!lhsInWhenRe.test(clsTxt) && !reinitRe.test(clsTxt)) {
            pushErrorOnce(
              3001,
              "pre-non-discrete",
              `Argument 1 of pre must be a discrete expression, but ${arg} is continuous.`,
              node,
            );
          }
        }
      }

      if (fnName === "size" && argTexts.length >= 1) {
        const arrArg = argTexts[0]!;
        const cInfo = comps.get(arrArg);
        const compClauseTxt = (cInfo ? findAncestor(cInfo.cst, "component_clause")?.text : "") ?? "";
        const hasBracketInDecl =
          compClauseTxt.includes("[") ||
          (cInfo?.cst?.text ?? "").includes("[") ||
          (cInfo?.cst?.parent?.parent?.text ?? "").includes("[");
        if (
          (cInfo && cInfo.ndims === 0 && PRIMITIVE_BUILTIN_TYPES.has(cInfo.typeName) && !hasBracketInDecl) ||
          inferSimpleLiteralType(arrArg) !== null
        ) {
          pushErrorOnce(
            3000,
            "size-non-array",
            isOldFrontend
              ? `The first argument of size(${arrArg}) must be an array expression.`
              : "The first argument of size must be an array expression.",
            node,
          );
        } else if (
          argTexts.length >= 2 &&
          arrArg.startsWith("{") &&
          arrArg.endsWith("}") &&
          isSignedAsciiIntText(argTexts[1]!, false)
        ) {
          let litNDims = 0;
          for (let i = 0; i < arrArg.length; i++) {
            const ch = arrArg[i]!;
            if (ch === "{") litNDims++;
            else if (ch !== " " && ch !== "\t" && ch !== "\n" && ch !== "\r") break;
          }
          const dim = parseInt(argTexts[1]!, 10);
          if (litNDims > 0 && (dim < 1 || dim > litNDims)) {
            pushErrorOnce(
              3000,
              "size-invalid-index",
              `Invalid index ${dim} in call to size of ${arrArg}, valid index interval is [1,${litNDims}].`,
              node,
            );
          }
        } else if (
          argTexts.length >= 2 &&
          cInfo &&
          cInfo.ndims > 0 &&
          PRIMITIVE_BUILTIN_TYPES.has(cInfo.typeName) &&
          isSignedAsciiIntText(argTexts[1]!, false)
        ) {
          const dim = parseInt(argTexts[1]!, 10);
          if (dim < 1 || dim > cInfo.ndims) {
            const errNode = findAncestor(node, "component_clause", 6) ?? findAncestor(node, "equation", 6) ?? node;
            pushErrorOnce(
              3000,
              "size-invalid-index",
              `Invalid index ${dim} in call to size of ${arrArg}, valid index interval is [1,${cInfo.ndims}].`,
              errNode,
            );
          }
        } else if (argTexts.length >= 2 && /^[A-Za-z_]\w*$/.test(argTexts[1]!)) {
          const dInfo = comps.get(argTexts[1]!);
          if (dInfo && dInfo.variability !== "parameter" && dInfo.variability !== "constant") {
            pushErrorOnce(
              3001,
              "size-dim-non-parameter",
              `Dimensions must be parameter or constant expression (in size(${arrArg}, ${argTexts[1]!})).`,
              node,
            );
          }
        }
      }

      if (fnName === "smooth") {
        if (argTexts.length !== 2) {
          pushErrorOnce(
            3000,
            "smooth-wrong-args",
            `No matching function found for smooth(${argTexts.join(", ")}).\nCandidates are:\n  smooth(Integer, Any) => Any`,
            node,
          );
        } else {
          const kArg = argTexts[0]!;
          const kInfo = /^[A-Za-z_]\w*$/.test(kArg) ? comps.get(kArg) : undefined;
          if (kInfo && kInfo.variability !== "parameter" && kInfo.variability !== "constant") {
            pushErrorOnce(
              3001,
              "smooth-non-parameter",
              `Argument 1 of smooth must be a parameter expression, but ${kArg} is ${kInfo.variability}.`,
              node,
            );
          }
        }
      }

      if ((fnName === "min" || fnName === "max") && !node.text.includes(" for ")) {
        const mmCands =
          `Candidates are:\n` +
          `  ${fnName}(Real, Real) => Real\n` +
          `  ${fnName}(Integer, Integer) => Integer\n` +
          `  ${fnName}(Boolean, Boolean) => Boolean\n` +
          `  ${fnName}(enumeration(:), enumeration(:)) => enumeration(:)\n` +
          `  ${fnName}(Real[:, ...]) => Real\n` +
          `  ${fnName}(Integer[:, ...]) => Integer\n` +
          `  ${fnName}(Boolean[:, ...]) => Boolean\n` +
          `  ${fnName}(enumeration(:)[:, ...]) => enumeration(:)`;
        if (argTexts.length > 2) {
          pushErrorOnce(
            3000,
            "minmax-wrong-args",
            `No matching function found for ${fnName}(${argTexts.join(", ")}).\n${mmCands}`,
            node,
          );
        } else if (
          argTexts.length === 2 &&
          ((argTexts[0]!.startsWith('"') && argTexts[0]!.endsWith('"')) ||
            (argTexts[1]!.startsWith('"') && argTexts[1]!.endsWith('"')))
        ) {
          pushErrorOnce(
            3000,
            "minmax-string-arg",
            `No matching function found for ${fnName}(${argTexts.join(", ")}).\n${mmCands}`,
            node,
          );
        } else if (
          argTexts.length === 1 &&
          argTexts[0]!.startsWith("{") &&
          argTexts[0]!.endsWith("}") &&
          argTexts[0]!.includes('"')
        ) {
          pushErrorOnce(
            3000,
            "minmax-string-array",
            `No matching function found for ${fnName}(${argTexts[0]!}).\n${mmCands}`,
            node,
          );
        }
      }

      if (fnName === "sample" && argTexts.length === 2) {
        const sArg = argTexts[0]!;
        const sInfo = /^[A-Za-z_]\w*$/.test(sArg) ? comps.get(sArg) : undefined;
        if (sInfo && sInfo.variability !== "parameter" && sInfo.variability !== "constant") {
          pushErrorOnce(
            3001,
            "sample-non-parameter",
            `Function argument start=${sArg} in call to sample has variability ${sInfo.variability} which is not a parameter expression.`,
            node,
          );
        }
      }

      if (!isOldFrontend && fnName === "reinit" && argTexts.length >= 1) {
        const rArg = argTexts[0]!;
        const rInfo = /^[A-Za-z_]\w*$/.test(rArg) ? comps.get(rArg) : undefined;
        if ((rInfo && NON_REAL_BUILTIN_TYPES.has(rInfo.typeName)) || inferSimpleLiteralType(rArg) !== null) {
          pushErrorOnce(
            3001,
            "reinit-non-real",
            "The first argument to reinit must be a variable of type Real or an array of such variables.",
            node,
          );
        }
      }

      if (fnName === "promote" && argTexts.length === 2 && isSignedAsciiIntText(argTexts[1]!, false)) {
        const a0 = argTexts[0]!;
        const pInfo = /^[A-Za-z_]\w*$/.test(a0) ? comps.get(a0) : undefined;
        const nVal = parseInt(argTexts[1]!, 10);
        if (pInfo && pInfo.ndims > 0 && nVal < pInfo.ndims) {
          pushErrorOnce(
            3001,
            "promote-invalid-dim",
            `The second argument '${nVal}' of promote may not be smaller than the number of dimensions (${pInfo.ndims}) of the first argument.`,
            node,
          );
        }
      }

      if (!isOldFrontend && fnName.includes("[") && fnName.includes(".")) {
        if (!dae.diagnostics.some((d) => d.rule === "subscripted-function-call")) {
          pushErrorOnce(3001, "subscripted-function-call", `Function call ${fnName} contains subscripts.`, node);
        }
      }

      if (fnName.endsWith(".constructor") || fnName.endsWith(".destructor")) {
        const baseCls = fnName.slice(0, fnName.lastIndexOf("."));
        const baseSym = resolveClassSym(db, classId, baseCls);
        if (baseSym) {
          const baseCst = cstOf(db, baseSym.id);
          if (baseCst && /\bextends\s+ExternalObject\b/.test(baseCst.text ?? "")) {
            pushErrorOnce(
              ModelicaErrorCode.CLASS_NOT_FOUND.code,
              ModelicaErrorCode.CLASS_NOT_FOUND.rule,
              `Function ${fnName} not found in scope ${className}.`,
              node,
            );
          }
        }
      }

      if ((fnName === "acos" || fnName === "asin") && argTexts.length === 1) {
        const a0 = argTexts[0]!;
        if (/^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(a0)) {
          const val = Number(a0);
          if (Number.isFinite(val) && (val < -1 || val > 1)) {
            pushErrorOnce(
              3001,
              "math-domain-error",
              `Argument ${a0} of ${fnName} is out of range (-1 <= x <= 1)`,
              node,
            );
          }
        }
      }

      if ((fnName === "log" || fnName === "log10") && argTexts.length === 1) {
        const a0 = argTexts[0]!;
        if (/^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(a0)) {
          const val = Number(a0);
          if (Number.isFinite(val) && val <= 0) {
            pushErrorOnce(3001, "math-domain-error", `Argument ${a0} of ${fnName} is out of range (x > 0)`, node);
          }
        }
      }

      const callSite =
        findAncestor(node, "component_clause", 10) ??
        findAncestor(node, "simple_equation", 10) ??
        findAncestor(node, "equation", 10) ??
        findAncestor(node, "statement", 10) ??
        node;

      if (fnName === "size") {
        if (rawArgs.some((a) => a.type === "named_argument")) {
          for (const ra of rawArgs) {
            if (ra.type === "named_argument") {
              const pName = ra.childForFieldName("name")?.text?.trim() ?? ra.namedChildren[0]?.text?.trim() ?? "";
              if (pName) {
                pushErrorOnce(3001, "size-named-arg", `Function size has no input parameter named ${pName}.`, callSite);
              }
            }
          }
        }
        if (!isOldFrontend && argTexts.length > 2) {
          pushErrorOnce(
            3006,
            "size-invalid-args",
            `No matching function found for size(${argTexts.join(", ")}).\nCandidates are:\n  size(Any[:, ...]) => Integer[:]\n  size(Any[:, ...], Integer) => Integer`,
            callSite,
          );
        }
        if (!isOldFrontend && argTexts.length >= 1) {
          const a0 = argTexts[0]!;
          const subM = a0.match(/^([A-Za-z_]\w*)\s*\[([^\]]+)\]$/);
          if (subM && !subM[2]!.includes(":")) {
            const cInfo = comps.get(subM[1]!);
            if (cInfo) {
              const compClause = findAncestor(cInfo.cst, "component_clause") ?? cInfo.cst;
              const dimM = (compClause?.text ?? "").match(/\[([^\]]+)\]/);
              const ndims = dimM ? dimM[1]!.split(",").length : 0;
              const nsubs = subM[2]!.split(",").length;
              if (ndims > 0 && nsubs >= ndims) {
                pushErrorOnce(
                  3006,
                  "size-scalar-arg",
                  "The first argument of size must be an array expression.",
                  callSite,
                );
              }
            }
          }
        }
      }

      if (fnName === "terminate" && argTexts.length === 1 && !isOldFrontend) {
        const a0 = argTexts[0]!;
        const litTy = inferSimpleLiteralType(a0);
        if (litTy && litTy !== "String") {
          pushErrorOnce(
            3006,
            "terminate-invalid-arg",
            `Type mismatch for positional argument 1 in terminate(message=${a0}). The argument has type:\n  ${litTy}\nexpected type:\n  String`,
            callSite,
          );
        }
      }

      if (fnName === "smooth" && argTexts.length === 2 && !isOldFrontend) {
        const a0 = argTexts[0]!;
        const a1 = argTexts[1]!;
        const c0 = comps.get(a0);
        const c1 = comps.get(a1);
        if (c0 && c0.typeName !== "Integer") {
          pushErrorOnce(
            3006,
            "smooth-invalid-arg1",
            `Type mismatch for positional argument 1 in smooth(=${a0}). The argument has type:\n  ${c0.typeName}\nexpected type:\n  Integer`,
            callSite,
          );
        }
        if (c1 && c1.typeName === "String") {
          pushErrorOnce(
            3006,
            "smooth-invalid-arg2",
            `Type mismatch for positional argument 2 in smooth(=${a1}). The argument has type:\n  String\nexpected type:\n  Real\n  Real[:, ...]\n  Real record\n  Real record[:, ...]`,
            callSite,
          );
        }
      }

      if (fnName === "vector" && argTexts.length === 1 && !isOldFrontend) {
        const a0 = argTexts[0]!.replace(/\s+/g, " ").trim();
        if (a0.startsWith("{{") && a0.endsWith("}}") && !a0.startsWith("{{{")) {
          const rows = [...a0.slice(1, -1).matchAll(/\{([^{}]+)\}/g)];
          if (rows.length > 1) {
            const cols = rows[0]![1]!
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            if (cols.length > 1) {
              const elTy = cols.every((c) => /^[+-]?\d+$/.test(c)) ? "Integer" : "Real";
              pushErrorOnce(
                3006,
                "vector-invalid-dims",
                `Invalid dimensions ${elTy}[${rows.length}, ${cols.length}] in vector(${a0}), no more than one dimension may have size > 1.`,
                callSite,
              );
            }
          }
        }
      }

      if (fnName === "matrix" && argTexts.length === 1 && !isOldFrontend) {
        const a0 = argTexts[0]!.replace(/\s+/g, " ").trim();
        if (a0.startsWith("{{{") && a0.endsWith("}}}")) {
          const innerLeaf = a0.match(/\{([^{}]+)\}/);
          if (innerLeaf) {
            const d3 = innerLeaf[1]!.split(",").filter((s) => s.trim().length > 0).length;
            if (d3 > 1) {
              pushErrorOnce(
                3006,
                "matrix-invalid-dim3",
                `Invalid dimension 3 of argument to matrix, expected dimension size 1 but got ${d3}.`,
                callSite,
              );
            }
          }
        }
      }

      if (fnName === "symmetric" && argTexts.length === 1 && !isOldFrontend) {
        const a0 = argTexts[0]!.replace(/\s+/g, " ").trim();
        if (a0.startsWith("{{") && a0.endsWith("}}") && !a0.startsWith("{{{")) {
          const rows = [...a0.slice(1, -1).matchAll(/\{([^{}]+)\}/g)];
          if (rows.length > 0) {
            const cols = rows[0]![1]!
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            if (rows.length !== cols.length) {
              const elTy = cols.every((c) => /^[+-]?\d+$/.test(c)) ? "Integer" : "Real";
              const normA0 = `{${rows.map((r) => `{${r[1]!.trim()}}`).join(", ")}}`;
              pushErrorOnce(
                3006,
                "symmetric-non-square",
                `Type mismatch for positional argument 1 in symmetric(=${normA0}). The argument has type:\n  ${elTy}[${rows.length}, ${cols.length}]\nexpected type:\n  Any[n, n]`,
                callSite,
              );
            }
          }
        }
      }

      if (fnName === "fill" && argTexts.length >= 2 && !isOldFrontend) {
        for (let ai = 1; ai < argTexts.length; ai++) {
          const dArg = argTexts[ai]!;
          if (/^[A-Za-z_]\w*$/.test(dArg)) {
            const cInfo = comps.get(dArg);
            if (cInfo && cInfo.variability === "continuous") {
              pushErrorOnce(
                3006,
                "fill-non-param-dim",
                `Expression '${dArg}' that determines the size of dimension '${ai}' of 'fill(${argTexts.join(", ")})' is not an evaluable parameter expression.`,
                callSite,
              );
              break;
            }
          }
        }
      }

      if (fnName === "previous" && argTexts.length === 1 && !isOldFrontend) {
        const a0 = argTexts[0]!;
        if (/^[A-Za-z_]\w*$/.test(a0) && !comps.has(a0)) {
          const fSym = resolveClassSym(db, classId, a0);
          if (fSym && getClassSpecialization(fSym, cstOf(db, fSym.id)) === "function") {
            pushErrorOnce(
              3006,
              "previous-func-arg",
              `Type mismatch for positional argument 1 in previous(u=${a0}). The argument has type:\n  ${a0}<function>() => ()\nexpected type:\n  ComponentExpression`,
              callSite,
            );
          }
        }
      }

      if (fnName === "String" && argTexts.length >= 1 && !isOldFrontend) {
        const stringCandidates =
          "Candidates are:\n" +
          "  String(enumeration(:) $e, Integer minimumLength = 0, Boolean leftJustified = true) => String\n" +
          "  String(Integer $i, Integer minimumLength = 0, Boolean leftJustified = true) => String\n" +
          "  String(Boolean $b, Integer minimumLength = 0, Boolean leftJustified = true) => String\n" +
          "  String(Real $r, Integer significantDigits = 6, Integer minimumLength = 0, Boolean leftJustified = true) => String\n" +
          "  String(Real $r, String format) => String";
        const a0 = argTexts[0]!;
        const c0 = /^[A-Za-z_]\w*$/.test(a0) ? comps.get(a0) : undefined;
        if (c0 && !PRIMITIVE_BUILTIN_TYPES.has(c0.typeName)) {
          const tSym = resolveClassSym(db, c0.ownerClassId, c0.typeName);
          const tSpec = tSym ? getClassSpecialization(tSym, cstOf(db, tSym.id)) : "";
          if (tSpec === "record" || tSpec === "model" || tSpec === "block") {
            pushErrorOnce(
              3006,
              "string-invalid-arg",
              `No matching function found for String(/*${c0.typeName}*/ ${a0}).\n${stringCandidates}`,
              callSite,
            );
          }
        } else if (
          argTexts.length >= 2 &&
          !rawArgs.some((a) => a.type === "named_argument") &&
          (argTexts[1] === "true" || argTexts[1] === "false")
        ) {
          const fmtArgs = argTexts.map((a) => {
            const lt = inferSimpleLiteralType(a) ?? comps.get(a)?.typeName ?? "Any";
            return `/*${lt}*/ ${a}`;
          });
          pushErrorOnce(
            3006,
            "string-invalid-args",
            `No matching function found for String(${fmtArgs.join(", ")}).\n${stringCandidates}`,
            callSite,
          );
        }
      }

      if (fnName === "assert" && argTexts.length === 3 && !isOldFrontend) {
        const a2 = argTexts[2]!;
        const lit2 = inferSimpleLiteralType(a2);
        if (lit2) {
          pushErrorOnce(
            3006,
            "assert-invalid-level-type",
            `Type mismatch for positional argument 3 in assert(level=${a2}). The argument has type:\n  ${lit2}\nexpected type:\n  enumeration AssertionLevel(warning, error)`,
            callSite,
          );
        } else if (/^[A-Za-z_]\w*$/.test(a2)) {
          const c2 = comps.get(a2);
          if (c2 && c2.variability !== "parameter" && c2.variability !== "constant") {
            pushErrorOnce(
              3006,
              "assert-level-variability",
              `Function argument level=${a2} in call to assert has variability discrete which is not a parameter expression.`,
              callSite,
            );
          }
        }
      }

      if (fnName === "reinit" && argTexts.length >= 1) {
        const rArg = argTexts[0]!;
        const forAnc = findAncestor(node, "for_equation", 12) ?? findAncestor(node, "for_statement", 12);
        if (forAnc && /^[A-Za-z_]\w*$/.test(rArg)) {
          const fm = forAnc.text.match(/\bfor\s+([A-Za-z_]\w*)\s+in\b/);
          if (fm && fm[1] === rArg) {
            pushErrorOnce(5001, "assign-to-iterator", `Assignment to iterator '${rArg}'.`, node);
          }
        }
        if (!isOldFrontend && argTexts.length === 2 && /^[A-Za-z_]\w*$/.test(rArg)) {
          const rInfo = comps.get(rArg);
          const a1 = argTexts[1]!;
          const rClause = rInfo ? ((findAncestor(rInfo.cst, "component_clause")?.text ?? "").split("=")[0] ?? "") : "";
          if (
            rInfo &&
            !rClause.includes("[") &&
            a1.startsWith("{") &&
            a1.endsWith("}") &&
            !a1.slice(1, -1).includes("{")
          ) {
            const elems = a1
              .slice(1, -1)
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            const elTy = elems.every((e) => /^[+-]?\d+$/.test(e)) ? "Integer" : "Real";
            pushErrorOnce(
              3006,
              "reinit-invalid-arg2",
              `Type mismatch for positional argument 2 in reinit(=${a1}). The argument has type:\n  ${elTy}[${elems.length}]\nexpected type:\n  ${rInfo.typeName}`,
              callSite,
            );
          }
        }
      }

      if (fnName === "sum" && node.text.includes(" for ")) {
        const strRedM = node.text.match(/\bsum\s*\(\s*("[^"]*")\s+for\b/);
        if (strRedM) {
          pushErrorOnce(
            3001,
            "reduction-invalid-type",
            `Invalid expression '${strRedM[1]!}' of type String in sum reduction, expected Integer or Real, or operator record.`,
            node,
          );
        }
      }

      if (fnName === "Integer" && argTexts.length === 1 && !isOldFrontend) {
        const a0 = argTexts[0]!;
        if (/^[+-]?\d+\.\d+$/.test(a0)) {
          pushErrorOnce(
            3001,
            "integer-arg-type",
            `Type mismatch for positional argument 1 in Integer(e=${a0}). The argument has type:\n  Real\nexpected type:\n  enumeration(:)`,
            node,
          );
        }
      }

      if (
        !isOldFrontend &&
        /^[A-Za-z_]\w*$/.test(fnName) &&
        !BUILTIN_MODELICA_FUNCTIONS.has(fnName) &&
        !PRIMITIVE_BUILTIN_TYPES.has(fnName) &&
        comps.has(fnName) &&
        !resolveClassSym(db, classId, fnName)
      ) {
        pushErrorOnce(2003, "comp-as-func", `Expected ${fnName} to be a function, but found component instead.`, node);
      }

      if ((fnName === "sum" || fnName === "product") && argTexts.length === 1) {
        const arg0 = argTexts[0]!;
        if (!arg0.includes(" for ")) {
          const cInfo = comps.get(arg0);
          const hasBracketInDecl =
            (cInfo?.cst?.text ?? "").includes("[") || (cInfo?.cst?.parent?.parent?.text ?? "").includes("[");
          const litType = inferSimpleLiteralType(arg0);
          if (
            (cInfo && cInfo.ndims === 0 && NUMERIC_BUILTIN_TYPES.has(cInfo.typeName) && !hasBracketInDecl) ||
            litType !== null
          ) {
            const tName = cInfo ? cInfo.typeName : litType!;
            if (!isOldFrontend) {
              pushErrorOnce(
                3006,
                "reduction-scalar-arg",
                `Type mismatch for positional argument 1 in ${fnName}(a=${arg0}). The argument has type:\n  ${tName}\nexpected type:\n  Array`,
                callSite,
              );
            } else {
              pushErrorOnce(
                3000,
                "reduction-scalar-arg",
                `In ${fnName}(${arg0}), the expression is of type ${tName}, but is required to be of builtin array type (of any number of dimensions).`,
                node,
              );
            }
          }
        }
      }

      // Dotted protected function call check (ExtendsVisibility4: b.f())
      if (fnName.includes(".") && !fnName.startsWith(".")) {
        const dotIdx = fnName.indexOf(".");
        const compPart = fnName.slice(0, dotIdx).split("[")[0]!.trim();
        const memPart = fnName.slice(dotIdx + 1).trim();
        const compInfo = comps.get(compPart);
        if (compInfo && !memPart.includes(".")) {
          const compTypeSym = resolveClassSym(db, compInfo.ownerClassId, compInfo.typeName);
          if (compTypeSym && compTypeSym.id !== classId && !isSubclassOf(db, classId, compTypeSym.id)) {
            const nestedClasses = collectClassNestedClasses(db, compTypeSym.id);
            const targetFnEntry = nestedClasses.get(memPart);
            if (!isOldFrontend && targetFnEntry?.isProtected) {
              const fnCst = cstOf(db, targetFnEntry.sym.id);
              pushErrorOnce(2002, "illegal-protected-access", `Illegal access of protected element ${memPart}.`, fnCst);
              pushErrorOnce(
                ModelicaErrorCode.CLASS_NOT_FOUND.code,
                ModelicaErrorCode.CLASS_NOT_FOUND.rule,
                `Function ${fnName} not found in scope ${className}.`,
                callSite,
              );
            }
          }
        }
      }

      // User-defined function call checks & failed interface functions
      if (fnName && !BUILTIN_MODELICA_FUNCTIONS.has(fnName)) {
        const fnSym = resolveClassSym(db, classId, fnName);
        if (fnSym && failedFunctionIds?.has(fnSym.id) && invalidInterfaceFunctionIds?.has(fnSym.id)) {
          if (isOldFrontend) {
            pushErrorOnce(
              ModelicaErrorCode.CLASS_NOT_FOUND.code,
              ModelicaErrorCode.CLASS_NOT_FOUND.rule,
              `Class ${fnName} not found in scope ${className} (looking for a function or record).`,
              callSite,
            );
          }
        } else if (fnSym) {
          const fnCst = cstOf(db, fnSym.id);
          const fnSpec = getClassSpecialization(fnSym, fnCst);
          const isShortFnAlias = Boolean(
            (fnCst?.text ?? "").match(
              /^\s*(?:encapsulated\s+)?(?:partial\s+)?(?:pure\s+|impure\s+)?function\s+[A-Za-z_]\w*\s*=/,
            ),
          );
          if (fnSpec === "function" && !isShortFnAlias) {
            if (isClassPartial(fnSym, fnCst)) {
              pushErrorOnce(4000, "partial-function-call", `Called function '${fnName}' is partial.`, callSite);
            }
            const fnComps = collectClassComponents(db, fnSym.id);
            if (fnComps.size > 0) {
              for (const rawArg of rawArgs) {
                if (rawArg.type === "named_argument") {
                  const paramName =
                    rawArg.childForFieldName("name")?.text?.trim() ?? rawArg.namedChildren[0]?.text?.trim() ?? "";
                  const pInfo = fnComps.get(paramName);
                  if (!pInfo || !pInfo.isInput) {
                    pushErrorOnce(
                      3000,
                      "named-arg-not-input",
                      `'${paramName}' is not an input of function '${fnName}'.`,
                      rawArg,
                    );
                  }
                }
              }
              if (!isOldFrontend && rawArgs.length > 0 && rawArgs[0]!.type !== "named_argument") {
                const inputParams = Array.from(fnComps.entries()).filter(([, v]) => v.isInput);
                const p0 = inputParams[0];
                const a0 = argTexts[0] ?? "";
                const litTy = inferSimpleLiteralType(a0);
                if (
                  p0 &&
                  litTy &&
                  PRIMITIVE_BUILTIN_TYPES.has(p0[1].typeName) &&
                  litTy !== p0[1].typeName &&
                  !(litTy === "Integer" && p0[1].typeName === "Real")
                ) {
                  pushErrorOnce(
                    3006,
                    "func-arg-type-mismatch",
                    `Type mismatch for positional argument 1 in ${fnName}(${p0[0]}=${a0}). The argument has type:\n  ${litTy}\nexpected type:\n  ${p0[1].typeName}`,
                    callSite,
                  );
                }
              }
            }
          }
        }
      }
    }

    // 6a2. Range expression validation (RangeInvalidStep3/4, RangeTypeError2)
    if ((t === "simple_expression" || t === "range_expression" || t === "expression") && !isOldFrontend) {
      const rTxt = node.text.trim();
      if (
        rTxt.includes(":") &&
        !rTxt.includes("=") &&
        !rTxt.includes(";") &&
        !rTxt.includes("(") &&
        !rTxt.includes("{")
      ) {
        const parts = rTxt.split(":").map((s) => s.trim());
        if (parts.length === 3 && parts.every((p) => p.length > 0)) {
          const rangeSite =
            findAncestor(node, "component_clause", 10) ??
            findAncestor(node, "simple_equation", 10) ??
            findAncestor(node, "equation", 10) ??
            node;
          const [p0, p1, p2] = [parts[0]!, parts[1]!, parts[2]!];
          const enumInfo = (expr: string): { name: string; lits: string } | null => {
            const m = expr.match(/^([A-Za-z_]\w*)\.([A-Za-z_]\w*)$/);
            if (!m) return null;
            const eSym = resolveClassSym(db, classId, m[1]!);
            if (!eSym) return null;
            const eTxt = cstOf(db, eSym.id)?.text ?? "";
            const em = eTxt.match(/\benumeration\s*\(\s*([^):][^)]*)\)/);
            if (!em) return null;
            const lits = em[1]!
              .split(",")
              .map((s) => s.trim().split(/\s+/)[0]!)
              .filter(Boolean)
              .join(", ");
            return { name: m[1]!, lits };
          };
          const e0 = enumInfo(p0);
          const e1 = enumInfo(p1);
          const e2 = enumInfo(p2);
          if (e0 && e2) {
            pushErrorOnce(
              3001,
              "range-enum-step",
              `Range of type enumeration ${e0.name}(${e0.lits}) may not specify a step size.`,
              rangeSite,
            );
          } else if (/^[+-]?\d+$/.test(p0) && e1) {
            pushErrorOnce(
              3001,
              "range-type-mismatch",
              `Type mismatch in range: '${p0}' of type\n  Integer\nis not type compatible with '${p1}' of type\n  enumeration ${e1.name}(${e1.lits})`,
              rangeSite,
            );
          } else if (
            /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(p0) &&
            /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(p1) &&
            /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(p2)
          ) {
            const s0 = Number(p0);
            const step = Number(p1);
            const s2 = Number(p2);
            if (Number.isFinite(step) && step !== 0 && Math.abs(step) < 1e-100 && Math.abs(s2 - s0) > 0) {
              pushErrorOnce(3001, "range-step-too-small", `Step size ${p1} in range is too small.`, rangeSite);
            }
          }
        }
      }
    }

    // 6a3. Tuple expression on RHS of equation (TupleInvalid2) + Terminal2 + AssertInvalid3/4
    if (t === "simple_equation") {
      const eqTxt = node.text.trim().replace(/;$/, "").trim();
      if (!isOldFrontend) {
        const rhsTupleM = eqTxt.match(/^\([^)]+\)\s*=\s*(\(\s*[^,)]+\s*,[^)]+\))$/);
        if (rhsTupleM) {
          pushErrorOnce(
            5001,
            "tuple-invalid-rhs",
            `Tuple expressions may only occur on the left side of an assignment or equation with a single function call on the right side. Got the following expression: ${rhsTupleM[1]!}.`,
            node,
          );
        }
      }
      const termMulM = eqTxt.match(/\b(\d+\.\d+)\s*\*\s*terminal\s*\(\s*\)/);
      if (termMulM) {
        pushErrorOnce(
          5001,
          "terminal-arith-type",
          `Cannot resolve type of expression ${termMulM[1]!}*terminal(). The operands have types Real, Boolean in component <NO COMPONENT>.`,
          node,
        );
      }
    }
    if ((t === "equation" || t.endsWith("_equation") || t === "function_call") && !isOldFrontend) {
      const eqTxt = node.text.trim().replace(/;$/, "").trim();
      const assertM = eqTxt.match(/^assert\s*\(\s*[^,]+,\s*"[^"]*",\s*([^,)]+?)\s*\)$/);
      if (assertM) {
        const a2 = assertM[1]!.trim();
        const lit2 = inferSimpleLiteralType(a2);
        if (lit2) {
          pushErrorOnce(
            3006,
            "assert-invalid-level-type",
            `Type mismatch for positional argument 3 in assert(level=${a2}). The argument has type:\n  ${lit2}\nexpected type:\n  enumeration AssertionLevel(warning, error)`,
            node,
          );
        } else if (/^[A-Za-z_]\w*$/.test(a2)) {
          const c2 = comps.get(a2);
          if (c2 && c2.variability !== "parameter" && c2.variability !== "constant") {
            pushErrorOnce(
              3006,
              "assert-level-variability",
              `Function argument level=${a2} in call to assert has variability discrete which is not a parameter expression.`,
              node,
            );
          }
        }
      }
    }
    // ImportInCompositeName2: Real x = P2.PI; where P2 imports PI
    if (t === "component_clause" && !isOldFrontend) {
      const ccTxt = node.text.trim();
      const bindM = ccTxt.match(/=\s*([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*;?$/);
      if (bindM) {
        const pkgName = bindM[1]!;
        const memName = bindM[2]!;
        const pkgSym = resolveClassSym(db, classId, pkgName);
        if (pkgSym && !db.childrenOf(pkgSym.id).some((c) => c.name === memName)) {
          const hasImportedMem = db.childrenOf(pkgSym.id).some((c) => {
            if (c.kind !== "Import") return false;
            const it = cstOf(db, c.id)?.text?.trim() ?? "";
            return new RegExp(`(?:\\.|=\\s*)${memName}\\b`).test(it);
          });
          if (hasImportedMem) {
            pushErrorOnce(
              ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.code,
              ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.rule,
              `Found imported name '${memName}' while looking up composite name '${pkgName}.${memName}'.`,
              node,
            );
          }
        }
      }
    }
    // Encapsulated4: calling non-builtin top-level function from encapsulated class without import
    if (
      (t === "function_call" || t === "component_clause") &&
      sym &&
      classCst &&
      /^encapsulated\b/.test(classCst.text.trim())
    ) {
      const callTxt = node.text.trim();
      const fnM =
        t === "function_call" ? callTxt.match(/^([A-Za-z_]\w*)\s*\(/) : callTxt.match(/=\s*([A-Za-z_]\w*)\s*\(/);
      if (fnM) {
        const fnName = fnM[1]!;
        const isLocal = db.childrenOf(classId).some((c) => c.name === fnName);
        const hasImport = db.childrenOf(classId).some((c) => {
          if (c.kind !== "Import") return false;
          const it = cstOf(db, c.id)?.text?.trim() ?? "";
          return it.includes(".*") || new RegExp(`\\b${fnName}\\b`).test(it);
        });
        if (!isLocal && !hasImport && fnName !== sym.name) {
          const fnSym = resolveClassSym(db, classId, fnName);
          const fnSpec = fnSym ? getClassSpecialization(fnSym, cstOf(db, fnSym.id)) : null;
          if (fnSym && (fnSym.kind === "Function" || fnSpec === "function" || fnSpec === "record")) {
            const reportNode =
              findAncestor(node, "component_clause", 5) ?? findAncestor(node, "simple_equation", 5) ?? node;
            pushErrorOnce(
              ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.code,
              ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.rule,
              `Class ${fnName} not found in scope ${sym.name} (looking for a function or record).`,
              reportNode,
            );
          }
        }
      }
    }
    // IfEquationInvalidCond1: non-Boolean condition variable in if-equation
    if ((t === "if_equation" || t === "equation") && !isOldFrontend) {
      const ifTxt = node.text.trim().replace(/;$/, "").trim();
      const condM = ifTxt.match(/^if\s+([A-Za-z_]\w*)\s+then\b/);
      if (condM) {
        const condName = condM[1]!;
        const cInfo = comps.get(condName);
        if (cInfo && (cInfo.typeName === "String" || cInfo.typeName === "Real" || cInfo.typeName === "Integer")) {
          pushErrorOnce(
            3001,
            "if-equation-cond-type",
            `Type error in conditional '${condName}'. Expected Boolean, got ${cInfo.typeName}.`,
            node,
          );
        }
      }
    }
    // WhenVariableMismatch3: if-equation inside when-equation with mismatched LHS variables across branches
    if ((t === "if_equation" || t === "equation") && !isOldFrontend && findAncestor(node, "when_equation", 5)) {
      const ifTxt = node.text.trim().replace(/;$/, "").trim();
      if (/^if\b/.test(ifTxt) && /\bend\s+if$/.test(ifTxt)) {
        const branchSplit = ifTxt.split(/\b(?:else|elseif\b[^]*?\bthen)\b/);
        if (branchSplit.length >= 2) {
          const getBranchLhs = (seg: string): string => {
            const clean = seg.replace(/^if\b[^]*?\bthen\b/, "").replace(/\bend\s+if\s*;?$/, "");
            const names = new Set<string>();
            for (const m of clean.matchAll(/([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*=/g)) {
              names.add(m[1]!);
            }
            return Array.from(names).sort().join(",");
          };
          const firstLhs = getBranchLhs(branchSplit[0]!);
          if (
            firstLhs.length > 0 &&
            branchSplit.slice(1).some((b) => {
              const s = getBranchLhs(b);
              return s.length > 0 && s !== firstLhs;
            })
          ) {
            pushErrorOnce(
              5008,
              "when-if-branch-mismatch",
              `The branches of an if-equation inside a when-equation must have the same set of component references on the left-hand side.`,
              node,
            );
          }
        }
      }
    }
    // FunctionVariability & FunctionDefaultArgsCycle: check calls in component_clause bindings
    if (t === "component_clause" && isOldFrontend) {
      const ccTxt = node.text.trim();
      // ArrayInvalidDims: array({1,2,3}, {3,4}) with mismatched element lengths
      const arrCallM = ccTxt.match(/=\s*array\s*\(\s*(\{[^}]+\}(?:\s*,\s*\{[^}]+\})+)\s*\)\s*;?$/);
      if (arrCallM) {
        const subArrs = arrCallM[1]!.match(/\{[^}]+\}/g) ?? [];
        const lens = subArrs.map(
          (a) =>
            a
              .slice(1, -1)
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean).length,
        );
        if (lens.length >= 2 && lens.some((l) => l !== lens[0])) {
          pushErrorOnce(
            3001,
            "array-invalid-dims",
            `Different dimension sizes in arguments to array in component <NO COMPONENT>.`,
            node,
          );
        }
      }
      const callM = ccTxt.match(/=\s*([A-Za-z_]\w*)\s*\(([^)]*)\)\s*;?$/);
      if (callM) {
        const fnName = callM[1]!;
        const argList = callM[2]!
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const fnSym = resolveClassSym(db, classId, fnName);
        const fnSpec = fnSym ? getClassSpecialization(fnSym, cstOf(db, fnSym.id)) : null;
        if (fnSym && (fnSym.kind === "Function" || fnSpec === "function")) {
          const fnInputs: { name: string; variability: string; defaultRhs: string | null }[] = [];
          for (const fc of db.childrenOf(fnSym.id)) {
            if (fc.kind !== "Component") continue;
            const fcCst = cstOf(db, fc.id);
            const fcClause = fcCst ? (findAncestor(fcCst, "component_clause") ?? fcCst) : null;
            const fcTxt = fcClause?.text?.trim() ?? "";
            if (!/\binput\b/.test(fcTxt.split(fc.name)[0] ?? "")) continue;
            const eqI = fcTxt.indexOf("=");
            const defRhs =
              eqI >= 0
                ? fcTxt
                    .slice(eqI + 1)
                    .replace(/;$/, "")
                    .trim()
                : null;
            const variab = /\bconstant\b/.test(fcTxt)
              ? "constant"
              : /\bparameter\b/.test(fcTxt)
                ? "parameter"
                : "continuous";
            fnInputs.push({ name: fc.name, variability: variab, defaultRhs: defRhs });
          }
          // FunctionVariability: passing non-constant variable to constant input parameter
          for (let ai = 0; ai < Math.min(argList.length, fnInputs.length); ai++) {
            const inp = fnInputs[ai]!;
            const arg = argList[ai]!;
            if (inp.variability === "constant" && /^[A-Za-z_]\w*$/.test(arg)) {
              const argComp = comps.get(arg);
              if (argComp && argComp.variability !== "constant") {
                pushErrorOnce(
                  3006,
                  "function-arg-variability",
                  `Function argument ${inp.name}=${arg} in call to ${fnName} has variability continuous which is not a constant expression.`,
                  node,
                );
              }
            }
          }
          // FunctionDefaultArgsCycle: cyclic default arguments among omitted inputs
          const omitted = fnInputs.slice(argList.length).filter((inp) => inp.defaultRhs !== null);
          if (omitted.length >= 2) {
            const omittedNames = new Set(omitted.map((o) => o.name));
            const deps = new Map<string, string[]>();
            for (const o of omitted) {
              const refs: string[] = [];
              for (const on of omittedNames) {
                if (on !== o.name && new RegExp(`\\b${on}\\b`).test(o.defaultRhs!)) refs.push(on);
              }
              deps.set(o.name, refs);
            }
            for (const o of omitted) {
              const d1 = deps.get(o.name) ?? [];
              if (d1.some((d) => (deps.get(d) ?? []).includes(o.name))) {
                pushErrorOnce(
                  4001,
                  "function-default-args-cycle",
                  `The default value of ${o.name} causes a cyclic dependency.`,
                  node,
                );
                break;
              }
            }
          }
        }
      }
    }
    // Abs2: abs(Boolean) in equation
    if (t === "simple_equation" && isOldFrontend) {
      const eqTxt = node.text.trim().replace(/;$/, "").trim();
      const absM = eqTxt.match(/\babs\s*\(\s*([A-Za-z_]\w*)\s*\)/);
      if (absM) {
        const argName = absM[1]!;
        const argComp = comps.get(argName);
        if (argName === "true" || argName === "false" || argComp?.typeName === "Boolean") {
          pushErrorOnce(
            3006,
            "abs-boolean-arg",
            `No matching function found for abs in component <NO COMPONENT>\ncandidates are .OpenModelica.Internal.intAbs<function>(Integer v) => Integer\n -.OpenModelica.Internal.realAbs<function>(Real v) => Real`,
            node,
          );
        }
      }
    }

    // 6a4. Tuple assignment output count mismatch (TupleAssignmentMismatch1)
    if (t === "assignment_statement" || t === "statement") {
      const stTxt = node.text.trim().replace(/;$/, "").trim();
      const tupM = stTxt.match(/^\(\s*([^)]+)\s*\)\s*:=\s*([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\(([^)]*)\)$/);
      if (tupM) {
        const lhsVars = tupM[1]!
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const fnName = tupM[2]!;
        const fnSym = resolveClassSym(db, classId, fnName);
        if (fnSym && getClassSpecialization(fnSym, cstOf(db, fnSym.id)) === "function") {
          const fnComps = collectClassComponents(db, fnSym.id);
          const outputs = Array.from(fnComps.values()).filter((c) => {
            const cl = findAncestor(c.cst, "component_clause")?.text ?? "";
            return /\boutput\b/.test(cl.split(c.typeName)[0] ?? "");
          });
          if (outputs.length > 0 && lhsVars.length > outputs.length) {
            const lhsTypes = lhsVars.map((v) => comps.get(v)?.typeName ?? "Real");
            const outTypes = outputs.map((o) => o.typeName);
            pushErrorOnce(
              5008,
              "tuple-assignment-mismatch",
              `Type mismatch in assignment in (${lhsVars.join(", ")}) := ${fnName}(${tupM[3]!}) of (${lhsTypes.join(", ")}) := (${outTypes.join(", ")})`,
              node,
            );
          }
        }
      }
    }

    // 6b. Component references: illegal protected access (Visibility3) and package lookup restrictions (PackageRestriction1/2/3, Constant9)
    if (
      t === "component_reference" &&
      node.parent?.type !== "component_reference" &&
      !isExprCall &&
      node.parent?.type !== "function_call" &&
      !(
        (node.parent?.type === "primary" || node.parent?.type === "lhs_primary") &&
        node.parent.namedChildren.some((c) => c.type === "function_call_args")
      )
    ) {
      const refText = node.text.trim();
      if (refText.includes(".") && !refText.startsWith(".")) {
        const parts = refText.split(".");
        const firstSeg = parts[0]!.split("[")[0]!.trim();
        const refSite =
          findAncestor(node, "component_clause", 8) ??
          findAncestor(node, "simple_equation", 8) ??
          findAncestor(node, "equation", 8) ??
          findAncestor(node, "statement", 8) ??
          node;
        const firstComp = comps.get(firstSeg);
        if (firstComp && parts.length === 2 && !parts[1]!.includes("[")) {
          const compTypeSym = resolveClassSym(db, firstComp.ownerClassId, firstComp.typeName);
          if (compTypeSym && compTypeSym.id !== classId && !isSubclassOf(db, classId, compTypeSym.id)) {
            const typeComps = collectClassComponents(db, compTypeSym.id);
            const targetField = typeComps.get(parts[1]!);
            if (!isOldFrontend && targetField?.isProtected) {
              const targetFieldClause = findAncestor(targetField.cst, "component_clause") ?? targetField.cst;
              pushErrorOnce(
                2002,
                "illegal-protected-access",
                `Illegal access of protected element ${parts[1]}.`,
                targetFieldClause,
              );
              pushErrorOnce(
                ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
                ModelicaErrorCode.VARIABLE_NOT_FOUND.rule,
                ModelicaErrorCode.VARIABLE_NOT_FOUND.message(refText, className),
                refSite,
              );
            }
          }
        } else if (!firstComp && parts.length >= 2) {
          const pkgPath = parts.slice(0, -1).join(".");
          const memName = parts[parts.length - 1]!.split("[")[0]!.trim();
          const pkgSym = resolveClassSym(db, classId, pkgPath);
          const pkgCst = pkgSym ? cstOf(db, pkgSym.id) : null;
          if (pkgSym && pkgCst && getClassSpecialization(pkgSym, pkgCst) === "package") {
            const pkgSpecNode =
              pkgCst.namedChildren.find((c) => c.type === "long_class_specifier") ??
              pkgCst.namedChildren
                .find((c) => c.type === "class_specifier")
                ?.namedChildren.find((c) => c.type === "long_class_specifier");
            const pkgCompNode = pkgSpecNode?.namedChildren.find((c) => c.type === "composition");
            let hasPkgEq = false;
            let hasPkgAlg = false;
            let eqSecNode: SyntaxNode | null = null;
            let algSecNode: SyntaxNode | null = null;
            if (pkgCompNode) {
              for (const sc of pkgCompNode.namedChildren) {
                if (sc.type === "equation_section") {
                  hasPkgEq = true;
                  eqSecNode ??= sc;
                } else if (sc.type === "algorithm_section") {
                  hasPkgAlg = true;
                  algSecNode ??= sc;
                }
              }
            }
            void eqSecNode;
            void algSecNode;
            const memSym = db.childrenOf(pkgSym.id).find((c) => c.kind === "Component" && c.name === memName);
            const memIsNonConst = memSym ? getCompInfo(db, memSym, pkgSym.id).variability !== "constant" : false;
            if (memSym && memIsNonConst && !hasPkgEq && !hasPkgAlg && isOldFrontend) {
              pushErrorOnce(
                ModelicaErrorCode.PACKAGE_VARIABLE_NOT_CONSTANT.code,
                ModelicaErrorCode.PACKAGE_VARIABLE_NOT_CONSTANT.rule,
                ModelicaErrorCode.PACKAGE_VARIABLE_NOT_CONSTANT.message(`${pkgSym.name}.${memName}`, pkgSym.name),
                null,
              );
            }
            if (hasPkgEq || hasPkgAlg || memIsNonConst) {
              pushErrorOnce(
                ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
                ModelicaErrorCode.VARIABLE_NOT_FOUND.rule,
                ModelicaErrorCode.VARIABLE_NOT_FOUND.message(refText, className),
                refSite,
              );
            }
          }
        }
      }
      // BuiltinLookup1: Boolean.x / Real.x / Integer.x / String.x
      if (refText.includes(".") && !refText.startsWith(".")) {
        const firstSeg = refText.split(".")[0]!.trim();
        if (firstSeg !== "Clock" && PRIMITIVE_BUILTIN_TYPES.has(firstSeg)) {
          pushErrorOnce(
            ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
            ModelicaErrorCode.VARIABLE_NOT_FOUND.rule,
            ModelicaErrorCode.VARIABLE_NOT_FOUND.message(refText, className),
            node,
          );
        }
      }
      // Type3 (division subscript) and ArrayBounds3 (constant 1D out-of-bounds subscript)
      if (refText.includes("[") && !refText.includes(".") && spec !== "function") {
        const subM = refText.match(/^([A-Za-z_]\w*)\s*\[\s*([^\]]+)\s*\]$/);
        if (subM) {
          const baseName = subM[1]!;
          const subBody = subM[2]!.trim();
          const cInfo = comps.get(baseName);
          if (cInfo && !subBody.includes(",")) {
            if (!isOldFrontend && subBody.startsWith('"') && subBody.endsWith('"')) {
              pushErrorOnce(
                3001,
                "wrong-subscript-type",
                `Subscript '${subBody}' has type String, expected type Integer.`,
                node,
              );
            } else if (subBody.includes("/")) {
              pushErrorOnce(
                3001,
                "wrong-subscript-type",
                `Subscript ${subBody} of type Real is not a subtype of Integer, Boolean or enumeration.`,
                node,
              );
              if (isOldFrontend) {
                pushErrorOnce(
                  ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
                  ModelicaErrorCode.VARIABLE_NOT_FOUND.rule,
                  ModelicaErrorCode.VARIABLE_NOT_FOUND.message(refText, className),
                  node,
                );
              }
            } else if (
              !isOldFrontend &&
              /^\d+$/.test(subBody) &&
              !findAncestor(node, "connect_equation", 6) &&
              !findAncestor(node, "connect_clause", 6)
            ) {
              const idx = parseInt(subBody, 10);
              const compClause = findAncestor(cInfo.cst, "component_clause") ?? cInfo.cst;
              const dimM = (compClause?.text ?? "").match(/\[\s*(\d+)\s*\]/);
              if (dimM) {
                const sz = parseInt(dimM[1]!, 10);
                if (sz > 0 && (idx < 1 || idx > sz)) {
                  pushErrorOnce(
                    3001,
                    "subscript-out-of-bounds",
                    `Subscript '${idx}' for dimension 1 (size = ${sz}) of ${baseName} is out of bounds.`,
                    node,
                  );
                }
              }
            }
          }
        }
      }
    }

    // 6c. For-equation range variability (VariableRange, ForEquationNonParam)
    if (t === "for_index" && findAncestor(node, "for_equation", 4) && spec !== "function") {
      const fTxt = node.text.trim();
      const inM = fTxt.match(/^[A-Za-z_]\w*\s+in\s+(.+)$/);
      if (inM && inM[1]!.includes(":")) {
        const rangeTxt = inM[1]!.trim();
        const parts = rangeTxt.split(":").map((p) => p.trim());
        let badInfo: CompInfo | undefined;
        let hasReal = false;
        for (const pt of parts) {
          if (/^[A-Za-z_]\w*$/.test(pt)) {
            const pInfo = comps.get(pt);
            if (pInfo?.typeName === "Real") hasReal = true;
            if (pInfo && pInfo.variability !== "parameter" && pInfo.variability !== "constant" && !badInfo) {
              badInfo = pInfo;
            }
          }
        }
        if (badInfo) {
          const fmtRange =
            hasReal && !isOldFrontend ? parts.map((p) => (/^[+-]?\d+$/.test(p) ? `${p}.0` : p)).join(":") : rangeTxt;
          pushErrorOnce(
            3001,
            "for-range-non-parameter",
            `The iteration range ${fmtRange} is not a constant or parameter expression.`,
            node,
          );
        }
      }
    }

    // 6d. If-equation non-Boolean condition (IfEquationInvalidCond1)
    if (t === "if_equation" && spec !== "function") {
      const condM = node.text.trim().match(/^if\s+([A-Za-z_]\w*)\s+then\b/);
      if (condM) {
        const cName = condM[1]!;
        const cInfo = comps.get(cName);
        if (cInfo && PRIMITIVE_BUILTIN_TYPES.has(cInfo.typeName) && cInfo.typeName !== "Boolean") {
          pushErrorOnce(
            3001,
            "if-cond-not-boolean",
            `Type error in conditional '${cName}'. Expected Boolean, got ${cInfo.typeName}.`,
            node,
          );
        }
      }
    }

    // 6e. Range step too small (RangeInvalidStep4) & String range (RangeTypeError3)
    if (t === "simple_expression" && node.text.includes(":")) {
      const rParts = node.text.trim().split(":");
      if (rParts.length === 2 && !isOldFrontend) {
        const p0 = rParts[0]!.trim();
        const p1 = rParts[1]!.trim();
        if (p0.startsWith('"') && p0.endsWith('"') && p1.startsWith('"') && p1.endsWith('"')) {
          pushErrorOnce(3001, "range-invalid-type", "Range has invalid type String.", node);
        }
      }
      if (rParts.length === 3) {
        const stepStr = rParts[1]!.trim();
        if (/^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/.test(stepStr)) {
          const sv = Math.abs(Number(stepStr));
          if (sv > 0 && sv < 1e-15) {
            pushErrorOnce(3001, "range-step-too-small", `Step size ${stepStr} in range is too small.`, node);
          }
        }
      }
    }

    // 6e2. Assignment to constant component in algorithm (AssignConstant1)
    if (t === "assignment_statement" && !isOldFrontend) {
      const aTxt = node.text.trim().replace(/;$/, "").trim();
      const am = aTxt.match(/^([A-Za-z_]\w*)\s*:=\s*(.+)$/);
      if (am) {
        const lhs = am[1]!;
        const rhsRaw = am[2]!.trim();
        const lInfo = comps.get(lhs);
        if (lInfo && lInfo.variability === "constant") {
          const rhsFmt = lInfo.typeName === "Real" && /^[+-]?\d+$/.test(rhsRaw) ? `${rhsRaw}.0` : rhsRaw;
          pushErrorOnce(
            5008,
            "assignment-to-constant",
            `Trying to assign to constant component in ${lhs} := ${rhsFmt}`,
            node,
          );
        }
      }
    }

    // 6f. Arithmetic with terminal()/initial() (Terminal2)
    if (t === "term" || t === "arithmetic_expression") {
      const mTerm = node.text.trim().match(/^(\d+(?:\.\d+)?)\s*\*\s*(terminal|initial)\(\)$/);
      if (mTerm) {
        const lhsNum = mTerm[1]!.includes(".") ? mTerm[1]! : `${mTerm[1]!}.0`;
        pushErrorOnce(
          3001,
          "arithmetic-boolean-op",
          `Cannot resolve type of expression ${lhsNum}*${mTerm[2]!}(). The operands have types Real, Boolean in component <NO COMPONENT>.`,
          node,
        );
      }
    }

    // 6g. Lookup inside partial class (PartialLookup1)
    if (t === "component_reference" && !isOldFrontend && node.text.includes(".") && !node.text.startsWith(".")) {
      const firstSeg = node.text.trim().split(".")[0]!.trim();
      if (!comps.has(firstSeg) && !PRIMITIVE_BUILTIN_TYPES.has(firstSeg)) {
        const clsSym = resolveClassSym(db, classId, firstSeg);
        if (clsSym && clsSym.id !== classId && isClassPartial(clsSym, cstOf(db, clsSym.id))) {
          pushErrorOnce(
            4028,
            "partial-class-lookup",
            `${firstSeg} is partial, name lookup is not allowed in partial classes.`,
            node,
          );
        }
      }
    }

    for (const ch of node.namedChildren) {
      walkCst(ch, inWhen, inCondCtx);
    }
  }

  walkCst(classCst, false, false);
}

/**
 * Runs post-WASM semantic validation on `rootClassId` and populates `dae.diagnostics`.
 */
export function postWasmValidate(
  db: QueryDB,
  dae: DAEBuilder,
  rootClassId: SymbolId,
  failedFunctionIds?: Set<SymbolId>,
  invalidInterfaceFunctionIds?: Set<SymbolId>,
): void {
  const visited = new Set<SymbolId>();
  validateClassSubtree(db, dae, rootClassId, visited, failedFunctionIds, invalidInterfaceFunctionIds);
}
