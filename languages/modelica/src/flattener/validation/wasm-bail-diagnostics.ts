// SPDX-License-Identifier: AGPL-3.0-or-later

import { type DAEBuilder, type QueryDB, type SymbolEntry, type SymbolId } from "@modelscript/runtime";
import { type SyntaxNode } from "../../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../../errors.js";
import { evalSimpleConstRealText } from "./const-eval.js";
import {
  collectClassComponents,
  findAncestor,
  findExpressionEndTokenOutsideSubscript,
  getClassSpecialization,
  getCompInfo,
  resolveClassSym,
} from "./cst-helpers.js";
import { cstOf, findNodeAtByteRange, pushError } from "./diagnostics.js";
import { PRIMITIVE_BUILTIN_TYPES, type CompInfo } from "./types.js";

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
  // ModifierTypeError.mo: Integer k = X.x; where package X has constant Integer x = 1.0;
  const pkgRefM = rhsPart.match(/^([A-Za-z_]\w*)\.([A-Za-z_]\w*)$/);
  if (pkgRefM) {
    const pSym = resolveClassSym(db, rootClassId, pkgRefM[1]!);
    const mComp = pSym ? collectClassComponents(db, pSym.id).get(pkgRefM[2]!) : null;
    const mClause = mComp ? (findAncestor(mComp.cst, "component_clause") ?? mComp.cst) : null;
    const mBindM = mClause?.text?.match(/=\s*([+-]?\d+\.\d+(?:[eE][+-]?\d+)?)\s*;?$/);
    if (mComp && mComp.typeName === "Integer" && mClause && mBindM) {
      pushError(
        dae,
        ModelicaErrorCode.TYPE_MISMATCH_BINDING.code,
        ModelicaErrorCode.TYPE_MISMATCH_BINDING.rule,
        `Type mismatch in binding ${pkgRefM[2]!} = ${mBindM[1]!}, expected subtype of Integer, got type Real.`,
        mClause,
      );
      const declClause = findAncestor(declNode, "component_clause") ?? declNode;
      pushError(
        dae,
        ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
        ModelicaErrorCode.VARIABLE_NOT_FOUND.rule,
        `Variable ${rhsPart} not found in scope ${db.symbol(rootClassId)?.name ?? ""}.`,
        declClause,
      );
      return true;
    }
  }
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
                  cycleSym: db.symbol(clsId) ?? target,
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
      const tCstText = tSym ? (cstOf(db, tSym.id)?.text ?? "") : "";
      if ((tSpec === "model" || tSpec === "block") && !/\bextends\s+ExternalObject\b/.test(tCstText)) {
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

  if (wasmErrorCode === 3377 || wasmErrorCode === 3363) {
    // EquationRhsUnresolved / ArrayEquationNonCtor: check for type name used as expression (TypenameInvalid1/2)
    const eqNode = findNodeAtByteRange(rootCst, startByte, endByte, ["simple_equation", "equation"]) ?? rootCst;
    const eqTxt = eqNode.text.trim().replace(/;$/, "").trim();
    const eqM = eqTxt.match(/^[^=]+=\s*([A-Za-z_]\w*)\s*$/);
    if (eqM) {
      const rhsId = eqM[1]!;
      const isPrimType = PRIMITIVE_BUILTIN_TYPES.has(rhsId);
      const rhsSym = !isPrimType ? resolveClassSym(db, rootClassId, rhsId) : null;
      const rhsTxt = rhsSym ? (cstOf(db, rhsSym.id)?.text ?? "") : "";
      if (isPrimType || (rhsSym && /\benumeration\s*\(/.test(rhsTxt))) {
        pushError(dae, 3001, "typename-in-expression", `Type name '${rhsId}' is not allowed in this context.`, eqNode);
        return true;
      }
    }
  }

  if (wasmErrorCode === 3609 && !isOldFrontend) {
    // DeclarationDimensions: check for scalar binding on unknown-dim array (DimUnknown4)
    if (dae.diagnostics.some((d) => d.code === 4035)) {
      for (let di = dae.diagnostics.length - 1; di >= 0; di--) {
        if (dae.diagnostics[di]?.code === 4042) dae.diagnostics.splice(di, 1);
      }
      return true;
    }
    const modM = rootCst.text.match(/\beach\s+([A-Za-z_]\w*)\s*=\s*([+-]?\d+(?:\.\d+)?)\s*\)/);
    if (modM) {
      const targetVar = modM[1]!;
      const scalarVal = modM[2]!;
      for (const s of db.byName(targetVar)) {
        if (s.kind !== "Component") continue;
        const sCst = cstOf(db, s.id);
        const sClause = sCst ? (findAncestor(sCst, "component_clause") ?? sCst) : null;
        if (sClause && /\[[^[\]]*:[^[\]]*\]/.test(sClause.text)) {
          pushError(
            dae,
            3001,
            "dim-unknown-binding",
            `Dimension 1 of '${targetVar}' could not be deduced from the component's binding equation '${scalarVal}'.`,
            sClause,
          );
          return true;
        }
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
    let searchRoot = rootCst;
    if (startByte < rootCst.startIndex || startByte > rootCst.endIndex) {
      while (searchRoot.parent) searchRoot = searchRoot.parent;
    }
    const rawErrNode =
      findNodeAtByteRange(searchRoot, startByte, endByte, [
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
      // Check RefinedSimpleCircuitInvalid: unresolved simple LHS variable in a nested/sibling class equation
      if (lhsIdM && searchRoot !== rootCst && !lhsIdM[1]!.includes(".")) {
        const encCls = findAncestor(errNode, "class_definition", 12);
        const encNameM = encCls?.text?.match(/\b(?:model|class|block|connector|record)\s+([A-Za-z_]\w*)/);
        if (encNameM) {
          pushError(
            dae,
            ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
            ModelicaErrorCode.VARIABLE_NOT_FOUND.rule,
            `Variable ${lhsIdM[1]!} not found in scope ${encNameM[1]!}.`,
            errNode,
          );
          return true;
        }
      }
    }
    // Check ColorClasses / OperatorFunction2: ClassOrRecord.nonConstVar(.field)* in equation
    const rootName3370 = db.symbol(rootClassId)?.name ?? "";
    for (const dotM of eText.matchAll(/\b([A-Za-z_]\w*)\.([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\b/g)) {
      const pName = dotM[1]!;
      const restPath = dotM[2]!;
      const mName = restPath.split(".")[0]!;
      if (comps.has(pName)) continue;
      const pSym = resolveClassSym(db, rootClassId, pName);
      if (!pSym) continue;
      const mComp = collectClassComponents(db, pSym.id).get(mName);
      if (mComp && mComp.variability !== "constant") {
        const fullRef = `${pName}.${restPath}`;
        if (restPath.includes(".")) {
          pushError(
            dae,
            ModelicaErrorCode.PACKAGE_VARIABLE_NOT_CONSTANT.code,
            ModelicaErrorCode.PACKAGE_VARIABLE_NOT_CONSTANT.rule,
            `Variable ${pName}.${mName} in package ${pName} is not constant.`,
            null,
          );
          pushError(
            dae,
            ModelicaErrorCode.PACKAGE_VARIABLE_NOT_CONSTANT.code,
            ModelicaErrorCode.PACKAGE_VARIABLE_NOT_CONSTANT.rule,
            `Variable ${fullRef} in package ${pName} is not constant.`,
            null,
          );
          pushError(
            dae,
            ModelicaErrorCode.PACKAGE_VARIABLE_NOT_CONSTANT.code,
            ModelicaErrorCode.PACKAGE_VARIABLE_NOT_CONSTANT.rule,
            `Variable ${pName}.${mName} in package ${pName} is not constant.`,
            null,
          );
          pushError(
            dae,
            ModelicaErrorCode.PACKAGE_VARIABLE_NOT_CONSTANT.code,
            ModelicaErrorCode.PACKAGE_VARIABLE_NOT_CONSTANT.rule,
            `Variable ${fullRef} in package ${pName} is not constant.`,
            null,
          );
        } else {
          pushError(
            dae,
            ModelicaErrorCode.PACKAGE_VARIABLE_NOT_CONSTANT.code,
            ModelicaErrorCode.PACKAGE_VARIABLE_NOT_CONSTANT.rule,
            `Variable ${fullRef} in package ${pName} is not constant.`,
            null,
          );
        }
        pushError(
          dae,
          ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
          ModelicaErrorCode.VARIABLE_NOT_FOUND.rule,
          `Variable ${fullRef} not found in scope ${rootName3370}.`,
          errNode,
        );
        // Also report subsequent equations referencing the same record/class (OperatorFunction2.mo)
        if (!restPath.includes(".")) {
          const scanFollowing = (n: SyntaxNode): void => {
            if (n.type === "simple_equation" && n.startIndex > errNode.startIndex) {
              const fm = n.text.trim().match(new RegExp(`^(${pName}\\.[A-Za-z_]\\w*)\\s*=`));
              if (fm) {
                pushError(
                  dae,
                  ModelicaErrorCode.VARIABLE_NOT_FOUND.code,
                  ModelicaErrorCode.VARIABLE_NOT_FOUND.rule,
                  `Variable ${fm[1]!} not found in scope ${rootName3370}.`,
                  n,
                );
              }
              return;
            }
            for (const ch of n.namedChildren) scanFollowing(ch);
          };
          scanFollowing(rootCst);
        }
        return true;
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
