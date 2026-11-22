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
    const lhsNode =
      findNodeAtByteRange(rootCst, startByte, endByte, [
        "simple_expression",
        "arithmetic_expression",
        "expression",
        "simple_equation",
        "equation",
      ]) ?? rootCst;
    let lhsText = lhsNode.text.trim();
    if (lhsNode.type === "simple_equation" || lhsNode.type === "equation") {
      const eqIdx = lhsText.indexOf("=");
      if (eqIdx > 0) lhsText = lhsText.slice(0, eqIdx).trim();
    }
    pushError(dae, 5001, "invalid-when-lhs", `Invalid left-hand side of when-equation: ${lhsText}.`, lhsNode);
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
          5001,
          "assign-to-parameter",
          `Trying to assign to parameter component in ${lhsName} := ${rhsFmt}`,
          stmtNode,
        );
        return true;
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
    const negPowM = dText.match(/(-\d+(?:\.\d+)?)\s*\^\s*(\d+\.\d+)/);
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
            `Type mismatch in binding '${name} = ${rhs}', expected array dimensions [${dims[0]}], got [${elems.length}].`,
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
      } else if (hasConstDims && /^[+-]?\d+(?:\.\d+)?$/.test(rhs)) {
        pushError(
          dae,
          3001,
          "non-array-mod-for-array",
          `Non-array modification '${rhs}' for array component '${name}', possibly due to missing 'each'.`,
          declNode,
        );
        return true;
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
  }

  if (wasmErrorCode === 3330 || wasmErrorCode === 3370 || wasmErrorCode === 3377) {
    // SimpleEquationExpr / EquationLhsUnresolved / EquationRhsUnresolved: check subscript errors
    const errNode =
      findNodeAtByteRange(rootCst, startByte, endByte, [
        "component_reference",
        "primary",
        "simple_equation",
        "equation",
      ]) ?? rootCst;
    const eText = errNode.text.trim();
    const comps = collectClassComponents(db, rootClassId);
    // Check subscript count mismatch or Real subscript on component_reference
    const subMatch = eText.match(/\b([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\[([^\]]+)\]/);
    if (subMatch) {
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
        `Invalid stream connector ${sym.name}: A stream connector must have exactly one flow variable, this connector has ${flowCount} flow ${flowCount === 1 ? "variable" : "variables"}.`,
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
  for (const child of children) {
    if (child.kind === "Class") {
      const childCst = cstOf(db, child.id);
      if (childCst) {
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
          let eqPart = m.text.includes("=") ? m.text.slice(m.text.indexOf("=")).trim() : m.text;
          if (eqPart.startsWith("=") && !eqPart.startsWith("= ")) {
            eqPart = `= ${eqPart.slice(1).trim()}`;
          }
          pushNotification(dae, m.node);
          pushErrorOnce(
            ModelicaErrorCode.FINAL_OVERRIDE.code,
            ModelicaErrorCode.FINAL_OVERRIDE.rule,
            ModelicaErrorCode.FINAL_OVERRIDE.message(m.name, eqPart),
            targetNode,
          );
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
    if ((info.variability === "parameter" || info.variability === "constant") && compCst && spec !== "function") {
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
            if (n.type === "function_call") {
              const callee = n.namedChildren[0]?.text?.trim();
              if (callee === "size" || callee === "ndims" || callee === "cardinality") return;
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

    // 4c. Builtin attribute nested modification (BuiltinAttribute3)
    if (info.typeName && PRIMITIVE_BUILTIN_TYPES.has(info.typeName) && compCst) {
      const compDeclNode =
        findAncestor(compCst, "declaration", 3) ?? findAncestor(compCst, "component_declaration") ?? compCst;
      const modNode =
        compDeclNode.namedChildren.find((c) => c.type === "modification" || c.type === "class_modification") ?? null;
      if (modNode) {
        for (const m of collectModifiersInNode(modNode)) {
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
            `Illegal to instantiate partial class ${info.typeName}.`,
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
            }
            walkCst(ch, inWhen, true);
          } else {
            walkCst(ch, inWhen, inCondCtx);
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
          if (lhs) curSet.add(lhs.split("[")[0]!.trim());
          return;
        }
        for (const ch of n.children) collectBranchEqs(ch);
      }
      for (const ch of node.children) collectBranchEqs(ch);
      branches.push(curSet);
      if (branches.length > 1) {
        const first = branches[0]!;
        for (let i = 1; i < branches.length; i++) {
          const b = branches[i]!;
          if (b.size !== first.size || Array.from(first).some((v) => !b.has(v))) {
            pushErrorOnce(
              5000,
              "when-variable-mismatch",
              `The same variables must be solved in elsewhen clause as in the when clause.`,
              node,
            );
            break;
          }
        }
      }
      for (const ch of node.namedChildren) {
        walkCst(ch, true, inCondCtx);
      }
      return;
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
              `Argument '${xName}' to der has illegal type ${cInfo.typeName}, must be a subtype of Real.`,
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

      if (fnName === "pre" && argTexts.length === 1) {
        const arg = argTexts[0]!;
        const cInfo = !arg.includes(".") && !arg.includes("[") && !arg.includes("(") ? comps.get(arg) : undefined;
        if (cInfo && cInfo.typeName === "Real" && cInfo.variability === "continuous") {
          // A Real variable assigned in a when-clause is implicitly discrete in Modelica;
          // only flag if `arg` is not assigned on the LHS of any when-equation/statement.
          const lhsInWhenRe = new RegExp(`\\bwhen\\b[\\s\\S]*?\\b${arg}\\s*(?::=|=)(?!=)`);
          const eqOrAlgHasWhenAssign = lhsInWhenRe.test(classCst?.text ?? "");
          if (!eqOrAlgHasWhenAssign) {
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
        const hasBracketInDecl =
          (cInfo?.cst?.text ?? "").includes("[") || (cInfo?.cst?.parent?.parent?.text ?? "").includes("[");
        if (
          (cInfo && cInfo.ndims === 0 && PRIMITIVE_BUILTIN_TYPES.has(cInfo.typeName) && !hasBracketInDecl) ||
          inferSimpleLiteralType(arrArg) !== null
        ) {
          pushErrorOnce(
            3000,
            "size-non-array",
            `The first argument of size(${arrArg}) must be an array expression.`,
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
        }
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
            pushErrorOnce(
              3000,
              "reduction-scalar-arg",
              `In ${fnName}(${arg0}), the expression is of type ${tName}, but is required to be of builtin array type (of any number of dimensions).`,
              node,
            );
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
              const callSite =
                findAncestor(node, "component_clause", 8) ??
                findAncestor(node, "equation", 8) ??
                findAncestor(node, "statement", 8) ??
                node;
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
            const callSite =
              findAncestor(node, "component_clause", 8) ??
              findAncestor(node, "simple_equation", 8) ??
              findAncestor(node, "equation", 8) ??
              findAncestor(node, "assignment_statement", 8) ??
              findAncestor(node, "statement", 8) ??
              node;
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
              pushErrorOnce(4000, "partial-function-call", `Called function '${fnName}' is partial.`, node);
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
            }
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
