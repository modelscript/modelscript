// SPDX-License-Identifier: AGPL-3.0-or-later

import { type SymbolEntry } from "@modelscript/runtime";
import { type SyntaxNode } from "../../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../../errors.js";
import { isSignedAsciiIntText } from "../expressions/cst-utils.js";
import { inferSimpleLiteralType } from "./const-eval.js";
import {
  collectClassComponents,
  collectClassNestedClasses,
  findAncestor,
  getClassSpecialization,
  isClassPartial,
  isSubclassOf,
  resolveClassSym,
} from "./cst-helpers.js";
import { cstOf } from "./diagnostics.js";
import {
  BUILTIN_MODELICA_FUNCTIONS,
  NON_REAL_BUILTIN_TYPES,
  NUMERIC_BUILTIN_TYPES,
  PRIMITIVE_BUILTIN_TYPES,
  type ClassValidationContext,
  type WalkCstState,
} from "./types.js";

export function validateFunctionCallNode(
  ctx: ClassValidationContext,
  node: SyntaxNode,
  argsNode: SyntaxNode | undefined,
  isExprCall: boolean,
  isDerExprCall: boolean,
  inWhen: boolean,
  inCondCtx: boolean,
  state: WalkCstState,
  walkChild: (child: SyntaxNode, inWhen: boolean, inCondCtx: boolean) => void,
): boolean {
  const {
    db,
    dae,
    classId,
    sym,
    classCst,
    comps,
    isOldFrontend,
    failedFunctionIds,
    invalidInterfaceFunctionIds,
    pushErrorOnce,
  } = ctx;
  const t = node.type;
  const className = sym.name;

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
      if (rawArgs[0]) walkChild(rawArgs[0], inWhen, true);
      for (let i = 1; i < rawArgs.length; i++) walkChild(rawArgs[i]!, inWhen, inCondCtx);
      return true;
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
        if (cInfo.variability === "parameter" || cInfo.variability === "constant" || cInfo.variability === "discrete") {
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

    if (fnName === "delay" && !state.emittedDelayError && (argTexts.length === 2 || argTexts.length === 3)) {
      const checkIdx = argTexts.length === 2 ? 1 : 2;
      const paramLabel = argTexts.length === 2 ? "delayTime" : "delayMax";
      const omInternalName = argTexts.length === 2 ? "OpenModelica.Internal.delay2" : "OpenModelica.Internal.delay3";
      const dText = argTexts[checkIdx]!;
      const dInfo = !dText.includes(".") && !dText.includes("(") ? comps.get(dText) : undefined;
      if (dInfo && dInfo.variability !== "parameter" && dInfo.variability !== "constant") {
        state.emittedDelayError = true;
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
      const cArg = argTexts[1]!.trim();
      let isClockArg = /^(?:Clock|subSample|superSample|shiftSample|backSample|noClock|firstTick|interval)\s*\(/.test(
        cArg,
      );
      if (!isClockArg && /^[A-Za-z_][\w.]*$/.test(cArg)) {
        const baseIdent = cArg.split(".")[0]!;
        const cInfo = comps.get(cArg) ?? comps.get(baseIdent);
        if (cInfo) {
          let curT = cInfo.typeName;
          let curScope = cInfo.ownerClassId;
          const seen = new Set<number>();
          for (let depth = 0; depth < 8; depth++) {
            if (curT === "Clock") {
              isClockArg = true;
              break;
            }
            if (PRIMITIVE_BUILTIN_TYPES.has(curT)) break;
            const tSym = resolveClassSym(db, curScope, curT);
            if (!tSym || seen.has(tSym.id)) break;
            seen.add(tSym.id);
            const tTxt = cstOf(db, tSym.id)?.text?.trim() ?? "";
            const sm = tTxt.match(
              /^(?:(?:encapsulated|partial|replaceable|final|inner|outer)\s+)*(?:type|connector|model|block|record|class)\s+[A-Za-z_]\w*\s*=\s*(?:(?:input|output|flow|stream|discrete|parameter|constant)\s+)*([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/,
            );
            if (!sm) break;
            curT = sm[1]!;
            curScope = tSym.parentId ?? curScope;
          }
        }
      }
      if (!isClockArg) {
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
          pushErrorOnce(3001, "math-domain-error", `Argument ${a0} of ${fnName} is out of range (-1 <= x <= 1)`, node);
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
        const hasStringOp = tSym && db.childrenOf(tSym.id).some((c) => c.name === "'String'" || c.name === "String");
        if ((tSpec === "record" || tSpec === "model" || tSpec === "block") && !hasStringOp) {
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
          if (isClassPartial(fnSym, fnCst) && !/\bif\s+false\b/.test(callSite.text)) {
            const fnElemTxt = (findAncestor(fnCst, "element", 3) ?? fnCst)?.text?.slice(0, 120) ?? "";
            let isViaReplaceable = /\breplaceable\b/.test(fnElemTxt);
            if (!isViaReplaceable && fnName.includes(".")) {
              const pkgSeg = fnName.split(".")[0]!;
              const pkgSym = resolveClassSym(db, classId, pkgSeg);
              if (pkgSym) {
                const pkgElemTxt =
                  (findAncestor(cstOf(db, pkgSym.id), "element", 3) ?? cstOf(db, pkgSym.id))?.text?.slice(0, 120) ?? "";
                if (/\breplaceable\b/.test(pkgElemTxt)) isViaReplaceable = true;
              }
            }
            if (!isViaReplaceable) {
              pushErrorOnce(4000, "partial-function-call", `Called function '${fnName}' is partial.`, callSite);
            }
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
  return false;
}

export function validateFunctionComponentBinding(ctx: ClassValidationContext, node: SyntaxNode): void {
  const { db, classId, comps, isOldFrontend, pushErrorOnce } = ctx;
  const t = node.type;
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
}

export function validateAlgorithmCallStatement(ctx: ClassValidationContext, node: SyntaxNode): void {
  const { db, classId, sym, comps, isOldFrontend, pushErrorOnce } = ctx;
  const t = node.type;
  // Ticket4786: f(1, function wrongType()) in algorithm section with mismatched functional arg
  if ((t === "statement" || t === "call_statement") && isOldFrontend) {
    const stTxt = node.text.trim().replace(/;$/, "").trim();
    const stM = stTxt.match(/^([A-Za-z_]\w*)\s*\((.*)\)$/);
    if (stM && /\bfunction\s+[A-Za-z_]\w*\s*\(/.test(stM[2]!)) {
      const fnName = stM[1]!;
      const fnSym =
        resolveClassSym(db, classId, fnName) ??
        db.childrenOf(classId).find((c) => (c.kind === "Function" || c.kind === "Class") && c.name === fnName) ??
        null;
      if (fnSym) {
        const argParts = stM[2]!.split(",").map((s) => s.trim());
        const fnIns: { name: string; typeName: string }[] = [];
        for (const fc of db.childrenOf(fnSym.id)) {
          if (fc.kind !== "Component") continue;
          const fcCst = cstOf(db, fc.id);
          const fcClause = fcCst ? (findAncestor(fcCst, "component_clause") ?? fcCst) : null;
          const fcTxt = fcClause?.text?.trim() ?? "";
          if (!/^\s*input\b/.test(fcTxt)) continue;
          const tm = fcTxt.match(/\binput\s+([A-Za-z_][\w.]*)/);
          if (tm) fnIns.push({ name: fc.name, typeName: tm[1]! });
        }
        for (let ai = 0; ai < Math.min(argParts.length, fnIns.length); ai++) {
          const fm = argParts[ai]!.match(/^function\s+([A-Za-z_]\w*)\s*\(\s*\)$/);
          if (!fm) continue;
          const argFnName = fm[1]!;
          const inp = fnIns[ai]!;
          const expSym = resolveClassSym(db, fnSym.id, inp.typeName);
          const argSym =
            resolveClassSym(db, classId, argFnName) ??
            db.childrenOf(classId).find((c) => (c.kind === "Function" || c.kind === "Class") && c.name === argFnName) ??
            null;
          if (expSym && argSym) {
            const fmtSig = (fs: SymbolEntry, withHash: boolean) => {
              const ins: string[] = [];
              const outs: string[] = [];
              for (const fc of db.childrenOf(fs.id)) {
                if (fc.kind !== "Component") continue;
                const fcCst = cstOf(db, fc.id);
                const fcClause = fcCst ? (findAncestor(fcCst, "component_clause") ?? fcCst) : null;
                const fcTxt = fcClause?.text?.trim() ?? "";
                if (/^\s*input\b/.test(fcTxt)) {
                  const tm = fcTxt.match(/\binput\s+([A-Za-z_][\w.]*)\s+[A-Za-z_]\w*(?:\s*=\s*(.+))?/);
                  if (tm) {
                    const defStr = tm[2] ? ` := ${tm[2].replace(/;$/, "").trim()}` : "";
                    ins.push(`${withHash ? "#" : ""}${tm[1]!} ${fc.name}${defStr}`);
                  }
                } else if (/^\s*output\b/.test(fcTxt)) {
                  const tm = fcTxt.match(/\boutput\s+([A-Za-z_][\w.]*)/);
                  if (tm) outs.push(`${withHash ? "#" : ""}${tm[1]!}`);
                }
              }
              return { ins, outs };
            };
            const aSig = fmtSig(argSym, true);
            const eSig = fmtSig(expSym, false);
            if (aSig.ins.length > 0 && eSig.ins.length > 0 && aSig.ins.join(",") !== eSig.ins.join(",")) {
              const aOut = aSig.outs.length > 0 ? aSig.outs.join(", ") : "#NORETCALL#";
              const eOut = eSig.outs.length > 0 ? eSig.outs.join(", ") : "#NORETCALL#";
              const sName = sym!.name;
              pushErrorOnce(
                3006,
                "functional-arg-type-mismatch",
                `Type mismatch for positional argument ${ai + 1} in ${sName}.${fnName}(${inp.name}=${sName}.${argFnName}). The argument has type:\n  .${sName}.${argFnName}<function>(${aSig.ins.join(", ")}) => ${aOut}\nexpected type:\n  .${sName}.${fnName}.${expSym.name}<function>(${eSig.ins.join(", ")}) => ${eOut}`,
                node,
              );
            }
          }
        }
      }
    }
  }
  // FuncWrongType2: F(b) in algorithm section where F expects record A and b has unrelated record type B
  if ((t === "statement" || t === "call_statement") && !isOldFrontend) {
    const stTxt = node.text.trim().replace(/;$/, "").trim();
    const stM = stTxt.match(/^([A-Za-z_]\w*)\s*\(\s*([A-Za-z_]\w*)\s*\)$/);
    if (stM) {
      const fnName = stM[1]!;
      const argName = stM[2]!;
      const argComp = comps.get(argName);
      const fnSym = resolveClassSym(db, classId, fnName);
      if (
        argComp &&
        fnSym &&
        (fnSym.kind === "Function" || getClassSpecialization(fnSym, cstOf(db, fnSym.id)) === "function")
      ) {
        const fnInputs: { name: string; typeName: string }[] = [];
        for (const fc of db.childrenOf(fnSym.id)) {
          if (fc.kind !== "Component") continue;
          const fcCst = cstOf(db, fc.id);
          const fcClause = fcCst ? (findAncestor(fcCst, "component_clause") ?? fcCst) : null;
          const fcTxt = fcClause?.text?.trim() ?? "";
          if (!/^\s*input\b/.test(fcTxt)) continue;
          const tm = fcTxt.match(/\binput\s+([A-Za-z_][\w.]*)/);
          if (tm) fnInputs.push({ name: fc.name, typeName: tm[1]! });
        }
        if (fnInputs.length >= 1) {
          const expT = fnInputs[0]!.typeName;
          const gotT = argComp.typeName;
          if (
            expT &&
            gotT &&
            expT !== gotT &&
            !PRIMITIVE_BUILTIN_TYPES.has(expT) &&
            !PRIMITIVE_BUILTIN_TYPES.has(gotT)
          ) {
            const expSym = resolveClassSym(db, fnSym.id, expT);
            const gotSym = resolveClassSym(db, classId, gotT);
            if (
              expSym &&
              gotSym &&
              expSym.id !== gotSym.id &&
              getClassSpecialization(expSym, cstOf(db, expSym.id)) === "record" &&
              getClassSpecialization(gotSym, cstOf(db, gotSym.id)) === "record" &&
              !db.childrenOf(gotSym.id).some((c) => c.kind === "Extends" && c.name === expT)
            ) {
              pushErrorOnce(
                3006,
                "func-arg-record-mismatch",
                `Type mismatch for positional argument 1 in ${fnName}(${fnInputs[0]!.name}=${argName}). The argument has type:\n  ${gotT}\nexpected type:\n  ${expT}`,
                node,
              );
            }
          }
        }
      }
    }
  }
}
