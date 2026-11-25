// SPDX-License-Identifier: AGPL-3.0-or-later

import { type SymbolEntry } from "@modelscript/runtime";
import { type SyntaxNode } from "../../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../../errors.js";
import { inferSimpleLiteralType } from "./const-eval.js";
import {
  collectClassComponents,
  findAncestor,
  getClassSpecialization,
  isClassPartial,
  isNodeInProtectedSection,
  resolveClassSym,
} from "./cst-helpers.js";
import { cstOf, pushNotification } from "./diagnostics.js";
import { BUILTIN_MODELICA_FUNCTIONS, PRIMITIVE_BUILTIN_TYPES, type ClassValidationContext } from "./types.js";

export function validateImportInCompositeName(ctx: ClassValidationContext, node: SyntaxNode): void {
  const { db, classId, isOldFrontend, pushErrorOnce } = ctx;
  const t = node.type;
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
}

export function validateComponentClauseInCst(ctx: ClassValidationContext, node: SyntaxNode): void {
  const { db, dae, classId, sym, comps, isOldFrontend, pushErrorOnce } = ctx;
  const t = node.type;
  // PartialFunction1, ReductionInvalidTypeMax/Min, VectorizeSeveralArguments, ExtObjError, BadVariabilityBug3150
  if (t === "component_clause") {
    const ccTxt = node.text.trim();
    // ReductionInvalidTypeMax / ReductionInvalidTypeMin
    if (!isOldFrontend) {
      const redM = ccTxt.match(/=\s*(min|max)\s*\(\s*(.+?)\s+for\s+[A-Za-z_]\w*\s+in\b/);
      if (redM) {
        const redFn = redM[1]!;
        const bodyStr = redM[2]!.trim();
        let badType: string | null = null;
        if (/^"[^"]*"$/.test(bodyStr)) {
          badType = "String";
        } else if (/^\{[^}]+\}$/.test(bodyStr)) {
          const elems = bodyStr
            .slice(1, -1)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          const allInt = elems.every((e) => /^-?\d+$/.test(e));
          badType = `${allInt ? "Integer" : "Real"}[${elems.length}]`;
        }
        if (badType) {
          pushErrorOnce(
            3001,
            "reduction-invalid-type",
            `Invalid expression '${bodyStr}' of type ${badType} in ${redFn} reduction, expected scalar enumeration, Boolean, Integer, or Real.`,
            node,
          );
        }
      }
      // PartialFunction1: calling a partial function in a binding
      const pfM = ccTxt.match(/=\s*([A-Za-z_]\w*)\s*\(/);
      if (pfM) {
        const fnName = pfM[1]!;
        const fnSym = resolveClassSym(db, classId, fnName);
        const fnCst = fnSym ? cstOf(db, fnSym.id) : null;
        const fnSpec = fnSym ? getClassSpecialization(fnSym, fnCst) : null;
        const fnParentTxt = (findAncestor(fnCst, "class_definition", 3) ?? fnCst)?.text ?? "";
        const fnElemTxt = (findAncestor(fnCst, "element", 3) ?? fnCst)?.text?.slice(0, 120) ?? "";
        const fnIsPartial =
          Boolean(fnSym && isClassPartial(fnSym, fnCst)) || /\bpartial\s+function\b/.test(fnParentTxt);
        if (
          fnSym &&
          (fnSym.kind === "Function" || fnSpec === "function") &&
          fnIsPartial &&
          !/\breplaceable\b/.test(fnElemTxt)
        ) {
          if (!/\bif\s+false\b/.test(ccTxt)) {
            pushErrorOnce(4055, "partial-function-call", `Called function '${fnName}' is partial.`, node);
          }
        } else if (fnSym && fnCst && (fnSym.kind === "Function" || fnSpec === "function")) {
          const fnFullTxt = fnParentTxt || fnCst.text;
          // CevalFuncAssert2 / CevalFuncRecursive2 / CevalFuncWhile2 on `constant ... = f(...)`
          const callArgsM = ccTxt.match(/=\s*[A-Za-z_]\w*\s*\(([^)]*)\)\s*;?$/);
          if (/^\s*constant\b/.test(ccTxt) && callArgsM) {
            const callArgList = callArgsM[1]!
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            // CevalFuncWhile2: `while true loop ... end while` without break/return
            if (/\bwhile\s+true\s+loop\b/.test(fnFullTxt) && !/\b(?:break|return)\b/.test(fnFullTxt)) {
              const findWhile = (n: SyntaxNode): SyntaxNode | null => {
                if (n.type === "while_statement" || (n.type === "statement" && n.text.trim().startsWith("while ")))
                  return n;
                for (const ch of n.namedChildren) {
                  const r = findWhile(ch);
                  if (r) return r;
                }
                return null;
              };
              pushErrorOnce(
                4055,
                "eval-loop-limit",
                `The loop iteration limit (--evalLoopLimit=100000) was exceeded during evaluation.`,
                findWhile(fnCst) ?? fnCst,
              );
            }
            // CevalFuncRecursive2: unconditional self-recursion in algorithm
            const algIdx = fnFullTxt.indexOf("algorithm");
            if (algIdx >= 0) {
              const algBody = fnFullTxt.slice(algIdx);
              if (!/\b(?:if|when)\b/.test(algBody) && new RegExp(`:=\\s*${fnName}\\s*\\(`).test(algBody)) {
                const fnDefNode = findAncestor(fnCst, "class_definition", 3) ?? fnCst;
                pushErrorOnce(
                  4055,
                  "eval-recursion-limit",
                  `The recursion limit (--evalRecursionLimit=256) was exceeded during evaluation of ${fnName}.`,
                  fnDefNode,
                );
              }
              // CevalFuncAssert2: assert(n <= 2, "msg", AssertionLevel.error) with constant literal arg
              const astM = algBody.match(
                /\bassert\s*\(\s*([A-Za-z_]\w*)\s*(<=|<|>=|>|==|<>)\s*(-?\d+(?:\.\d+)?)\s*,\s*"([^"]*)"([^)]*)\)/,
              );
              if (
                astM &&
                !/AssertionLevel\.warning/.test(astM[5] ?? "") &&
                callArgList.length >= 1 &&
                /^-?\d+(?:\.\d+)?$/.test(callArgList[0]!)
              ) {
                const pName = astM[1]!;
                const op = astM[2]!;
                const rhsV = Number(astM[3]!);
                const msg = astM[4]!;
                const firstIn = db.childrenOf(fnSym.id).find((c) => {
                  if (c.kind !== "Component") return false;
                  const ct = cstOf(db, c.id)?.text ?? "";
                  const cl = findAncestor(cstOf(db, c.id), "component_clause")?.text ?? ct;
                  return /^\s*(?:(?:constant|parameter|discrete)\s+)*input\b/.test(cl);
                });
                if (firstIn && firstIn.name === pName) {
                  const argV = Number(callArgList[0]!);
                  const condOk =
                    op === "<="
                      ? argV <= rhsV
                      : op === "<"
                        ? argV < rhsV
                        : op === ">="
                          ? argV >= rhsV
                          : op === ">"
                            ? argV > rhsV
                            : op === "=="
                              ? argV === rhsV
                              : argV !== rhsV;
                  if (!condOk) {
                    const findAssert = (n: SyntaxNode): SyntaxNode | null => {
                      if (
                        n.text.trim().startsWith("assert(") &&
                        (n.type.includes("statement") || n.type === "function_call")
                      )
                        return n;
                      for (const ch of n.namedChildren) {
                        const r = findAssert(ch);
                        if (r) return r;
                      }
                      return null;
                    };
                    pushErrorOnce(
                      4055,
                      "ceval-assert-triggered",
                      `assert triggered: ${msg}`,
                      findAssert(fnCst) ?? node,
                    );
                  }
                }
              }
            }
          }
          // FunctionalArgInvalidType1 & FuncMissingDefault1
          if (callArgsM) {
            const rawArgs = callArgsM[1]!.trim();
            const callArgList = rawArgs
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            const fnInputs: { name: string; typeName: string; hasDefault: boolean; isProtected: boolean }[] = [];
            for (const fc of db.childrenOf(fnSym.id)) {
              if (fc.kind !== "Component") continue;
              const fcCst = cstOf(db, fc.id);
              const fcClause = fcCst ? (findAncestor(fcCst, "component_clause") ?? fcCst) : null;
              const fcTxt = fcClause?.text?.trim() ?? "";
              if (!/^\s*(?:(?:constant|parameter|discrete)\s+)*input\b/.test(fcTxt)) continue;
              const tm = fcTxt.match(/\binput\s+([A-Za-z_][\w.]*)/);
              if (tm)
                fnInputs.push({
                  name: fc.name,
                  typeName: tm[1]!,
                  hasDefault: fcTxt.includes("="),
                  isProtected: isNodeInProtectedSection(fcClause),
                });
            }
            if (
              !rawArgs.includes("=") &&
              !/\bfunction\b/.test(rawArgs) &&
              !db.childrenOf(fnSym.id).some((c) => c.kind === "Extends") &&
              callArgList.length < fnInputs.length
            ) {
              const missing = fnInputs[callArgList.length];
              if (missing && !missing.hasDefault && !missing.isProtected) {
                pushErrorOnce(
                  3006,
                  "func-missing-default",
                  `Function parameter ${missing.name} was not given by the function call, and does not have a default value.`,
                  node,
                );
              }
            }
            for (let ai = 0; ai < Math.min(callArgList.length, fnInputs.length); ai++) {
              const inp = fnInputs[ai]!;
              const arg = callArgList[ai]!;
              if (!/^[A-Za-z_]\w*$/.test(arg) || PRIMITIVE_BUILTIN_TYPES.has(inp.typeName)) continue;
              const expFnSym =
                resolveClassSym(db, fnSym.id, inp.typeName) ??
                db.byName(inp.typeName).find((e) => e.kind === "Function" || e.kind === "Class") ??
                null;
              const argFnSym =
                resolveClassSym(db, classId, arg) ??
                db.byName(arg).find((e) => e.kind === "Function" || e.kind === "Class") ??
                null;
              if (expFnSym && argFnSym) {
                const getSig = (fs: SymbolEntry) => {
                  const ins: string[] = [];
                  const outs: string[] = [];
                  for (const fc of db.childrenOf(fs.id)) {
                    if (fc.kind !== "Component") continue;
                    const fcCst = cstOf(db, fc.id);
                    const fcClause = fcCst ? (findAncestor(fcCst, "component_clause") ?? fcCst) : null;
                    const fcTxt = fcClause?.text?.trim() ?? "";
                    if (/^\s*input\b/.test(fcTxt)) {
                      const tm = fcTxt.match(/\binput\s+([A-Za-z_][\w.]*)/);
                      if (tm) ins.push(`${tm[1]!} ${fc.name}`);
                    } else if (/^\s*output\b/.test(fcTxt)) {
                      const tm = fcTxt.match(/\boutput\s+([A-Za-z_][\w.]*)/);
                      if (tm) outs.push(`${tm[1]!} ${fc.name}`);
                    }
                  }
                  return { ins, outs };
                };
                const eSig = getSig(expFnSym);
                const aSig = getSig(argFnSym);
                const eTypes = eSig.ins.map((s) => s.split(" ")[0]!);
                const aTypes = aSig.ins.map((s) => s.split(" ")[0]!);
                const aReqCount = db.childrenOf(argFnSym.id).filter((fc) => {
                  if (fc.kind !== "Component") return false;
                  const fcCst = cstOf(db, fc.id);
                  const fcClause = fcCst ? (findAncestor(fcCst, "component_clause") ?? fcCst) : null;
                  const fcTxt = fcClause?.text?.trim() ?? "";
                  return /^\s*input\b/.test(fcTxt) && !fcTxt.includes("=");
                }).length;
                const compat =
                  aTypes.length >= eTypes.length &&
                  aReqCount <= eTypes.length &&
                  eTypes.every((et, idx) => aTypes[idx] === et);
                if (eSig.ins.length > 0 && aSig.ins.length > 0 && !compat) {
                  pushErrorOnce(
                    3006,
                    "functional-arg-type-mismatch",
                    `Type mismatch for positional argument ${ai + 1} in ${fnName}(${inp.name}=${arg}). The argument has type:\n  ${arg}<function>(${aSig.ins.join(", ")}) => ${aSig.outs.join(", ")}\nexpected type:\n  ${inp.name}<function>(${eSig.ins.join(", ")}) => ${eSig.outs.join(", ")}`,
                    node,
                  );
                }
              }
            }
          }
          // PartialApplicationInvalidArg1 / 2: `function f1(y = "fish")` or `function f1(z = 2.0)`
          for (const paM of ccTxt.matchAll(/\bfunction\s+([A-Za-z_]\w*)\s*\(\s*([A-Za-z_]\w*)\s*=\s*([^,)]+)\s*\)/g)) {
            const paFnName = paM[1]!;
            const paParam = paM[2]!;
            const paVal = paM[3]!.trim();
            const paSym =
              resolveClassSym(db, classId, paFnName) ??
              db.byName(paFnName).find((e) => e.kind === "Function" || e.kind === "Class") ??
              null;
            if (paSym) {
              const paInputs = new Map<string, string>();
              for (const fc of db.childrenOf(paSym.id)) {
                if (fc.kind !== "Component") continue;
                const fcCst = cstOf(db, fc.id);
                const fcClause = fcCst ? (findAncestor(fcCst, "component_clause") ?? fcCst) : null;
                const fcTxt = fcClause?.text?.trim() ?? "";
                if (!/^\s*(?:(?:constant|parameter|discrete)\s+)*input\b/.test(fcTxt)) continue;
                const tm = fcTxt.match(/\binput\s+([A-Za-z_][\w.]*)/);
                if (tm) paInputs.set(fc.name, tm[1]!);
              }
              const expT = paInputs.get(paParam);
              if (!expT) {
                pushErrorOnce(
                  3006,
                  "partial-app-invalid-arg",
                  `Function ${paFnName} has no input parameter named ${paParam}.`,
                  node,
                );
              } else {
                const gotT = inferSimpleLiteralType(paVal);
                if (gotT && gotT !== expT && !(expT === "Real" && gotT === "Integer")) {
                  pushErrorOnce(
                    3006,
                    "partial-app-type-mismatch",
                    `Type mismatch for named argument in ${paFnName}(${paParam}=${paVal}). The argument has type:\n  ${gotT}\nexpected type:\n  ${expT}`,
                    node,
                  );
                }
              }
            }
          }
          // FunctionDerivativeInvalidInput1 / Order1 / Order2: annotation(derivative(...) = f2)
          const fnFull = fnParentTxt || fnCst.text;
          const derAnnM = fnFull.match(/\bannotation\s*\(\s*derivative\s*\(([^)]*)\)\s*=/);
          if (derAnnM) {
            const derArgs = derAnnM[1]!;
            const fnCompsMap = collectClassComponents(db, fnSym.id);
            const zdM = derArgs.match(/\bzeroDerivative\s*=\s*([A-Za-z_]\w*)/);
            if (zdM) {
              const zdName = zdM[1]!;
              const zdInfo = fnCompsMap.get(zdName);
              if (!zdInfo || !zdInfo.isInput) {
                pushErrorOnce(
                  4055,
                  "derivative-invalid-input",
                  `'${zdName}' is not an input of function '${fnName}'.`,
                  fnCst,
                );
              }
            }
            const ordM = derArgs.match(/\border\s*=\s*([A-Za-z_]\w*)/);
            if (ordM) {
              const ordName = ordM[1]!;
              const ordInfo = fnCompsMap.get(ordName);
              if (ordInfo) {
                if (ordInfo.typeName !== "Integer") {
                  pushErrorOnce(
                    3001,
                    "derivative-invalid-order-type",
                    `Type mismatch in binding order = ${ordName}, expected subtype of Integer, got type ${ordInfo.typeName}.`,
                    findAncestor(fnCst, "class_definition", 3) ?? fnCst,
                  );
                } else if (ordInfo.variability !== "constant") {
                  pushErrorOnce(
                    4055,
                    "derivative-invalid-order-var",
                    `Component order of variability constant has binding ${ordName} of higher variability discrete.`,
                    findAncestor(fnCst, "class_definition", 3) ?? fnCst,
                  );
                }
              }
            }
          }
          // FunctionInverseInvalid2 / 3: annotation(inverse(p = f_inv(...)))
          const invAnnM = fnFull.match(/\bannotation\s*\(\s*inverse\s*\(\s*([A-Za-z_]\w*)\s*=/);
          if (invAnnM) {
            const invParam = invAnnM[1]!;
            const fnCompsMap = collectClassComponents(db, fnSym.id);
            let outCount = 0;
            for (const [, ci] of fnCompsMap) {
              if (ci.causality === "output") outCount++;
            }
            if (outCount !== 1) {
              pushErrorOnce(
                4055,
                "inverse-invalid-outputs",
                `Invalid inverse annotation for '${fnName}', only functions with exactly one output may have an inverse.`,
                fnCst,
              );
            } else {
              const pInfo = fnCompsMap.get(invParam);
              if (!pInfo || !pInfo.isInput) {
                pushErrorOnce(
                  4055,
                  "inverse-invalid-input",
                  `'${invParam}' is not an input of function '${fnName}'.`,
                  fnCst,
                );
              }
            }
          }
          // FunctionPartialDerivative2 / 3: `function df = der(f, arg);`
          const pderM = fnFull.match(/=\s*der\s*\(\s*([A-Za-z_][\w.]*)\s*,\s*([A-Za-z_]\w*)\s*\)/);
          if (pderM) {
            const baseFnName = pderM[1]!;
            const derArg = pderM[2]!;
            const baseFnSym =
              resolveClassSym(db, fnSym.parentId ?? classId, baseFnName) ??
              db
                .childrenOf(classId)
                .find((c) => (c.kind === "Function" || c.kind === "Class") && c.name === baseFnName) ??
              null;
            if (baseFnSym) {
              const baseComps = collectClassComponents(db, baseFnSym.id);
              const argInfo = baseComps.get(derArg);
              const qualBase = baseFnSym.parentId === classId ? `${sym!.name}.${baseFnName}` : baseFnName;
              if (!argInfo || !argInfo.isInput) {
                pushErrorOnce(
                  4055,
                  "partial-derivative-invalid-input",
                  `'${derArg}' in partial derivative of '${qualBase}' does not name an input parameter of the function.`,
                  node,
                );
              } else if (argInfo.typeName !== "Real" || argInfo.ndims > 0) {
                pushErrorOnce(
                  4055,
                  "partial-derivative-non-real-input",
                  `'${derArg}' in partial derivative of '${qualBase}' is not a scalar Real input parameter of the function.`,
                  findAncestor(fnCst, "class_definition", 3) ?? fnCst,
                );
              }
            }
          }
        }
      }
      // lookup3 / lookup4: dotted RHS starting with a component (e.g. a.B.C or a.b.C.d.x)
      const rhsChainM = ccTxt.match(/=\s*([A-Za-z_]\w*(?:\.[A-Za-z_]\w*){2,})\s*;?$/);
      if (rhsChainM) {
        const fullChain = rhsChainM[1]!;
        const segs = fullChain.split(".");
        const rootComp = comps.get(segs[0]!);
        if (rootComp && rootComp.typeName && !PRIMITIVE_BUILTIN_TYPES.has(rootComp.typeName)) {
          let curCls = resolveClassSym(db, classId, rootComp.typeName);
          let sawClassStep = false;
          for (let si = 1; si < segs.length && curCls; si++) {
            const seg = segs[si]!;
            const childComp = collectClassComponents(db, curCls.id).get(seg);
            const childCls = db
              .childrenOf(curCls.id)
              .find((c) => (c.kind === "Class" || c.kind === "Package") && c.name === seg);
            if (childComp) {
              if (sawClassStep && si < segs.length - 1) {
                pushErrorOnce(
                  2003,
                  "lookup-comp-in-class-chain",
                  `Found component '${seg}' in composite name '${fullChain}', expected class.`,
                  node,
                );
                break;
              }
              curCls = childComp.typeName ? resolveClassSym(db, curCls.id, childComp.typeName) : null;
            } else if (childCls) {
              sawClassStep = true;
              curCls = childCls;
              if (si === segs.length - 1) {
                pushErrorOnce(
                  2003,
                  "lookup-class-via-comp",
                  `Class name '${fullChain}' was found via a component (only component and function call names may be accessed in this way).`,
                  node,
                );
              }
            } else {
              break;
            }
          }
        }
      }
      // TypenameInvalid3: Real x[E] = E; (type name used as expression)
      const rhsSimpleM = ccTxt.match(/=\s*([A-Za-z_]\w*)\s*;?$/);
      if (rhsSimpleM) {
        const rhsId = rhsSimpleM[1]!;
        if (rhsId !== "true" && rhsId !== "false" && rhsId !== "time" && !comps.has(rhsId)) {
          const rhsCls = resolveClassSym(db, classId, rhsId);
          if (rhsCls) {
            const rhsSpec = getClassSpecialization(rhsCls, cstOf(db, rhsCls.id));
            if (rhsSpec === "type") {
              pushErrorOnce(
                3001,
                "typename-invalid-context",
                `Type name '${rhsId}' is not allowed in this context.`,
                node,
              );
            }
          }
        }
      }
      // PackageConstant7: Real x = R.x; where R is a record (not a package) and x is a non-encapsulated member
      const rhsDotM = ccTxt.match(/=\s*([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*;?$/);
      if (rhsDotM) {
        const recName = rhsDotM[1]!;
        const memName = rhsDotM[2]!;
        if (!comps.has(recName)) {
          const recSym = resolveClassSym(db, classId, recName);
          const recSpec = recSym ? getClassSpecialization(recSym, cstOf(db, recSym.id)) : "";
          if (recSym && recSpec === "record") {
            const memSym = db.childrenOf(recSym.id).find((c) => c.kind === "Component" && c.name === memName);
            const memCst = memSym ? cstOf(db, memSym.id) : null;
            const memClause = memCst ? (findAncestor(memCst, "component_clause") ?? memCst) : null;
            if (memSym && memClause) {
              pushNotification(dae, memClause);
              pushErrorOnce(
                4055,
                "non-package-member-lookup",
                `Class ${recName} does not satisfy the requirements for a package. Lookup is therefore restricted to encapsulated elements, but ${memName} is not encapsulated.`,
                node,
              );
            }
          }
        }
      }
    }
    // Enum5: P.h tt(redeclare type E = enumeration(a1, b2, c1)); where P.h equations reference old enum literal E.j
    if (isOldFrontend) {
      const redeclEnumM = ccTxt.match(
        /^([A-Za-z_][\w.]*)\s+([A-Za-z_]\w*)\s*\(\s*redeclare\s+type\s+([A-Za-z_]\w*)\s*=\s*enumeration\s*\(([^)]+)\)\s*\)/,
      );
      if (redeclEnumM) {
        const compType = redeclEnumM[1]!;
        const compName = redeclEnumM[2]!;
        const enumAlias = redeclEnumM[3]!;
        const newLits = new Set(redeclEnumM[4]!.split(",").map((s) => s.trim().split(/\s+/)[0]!));
        const typeSym = resolveClassSym(db, classId, compType);
        const typeCst = typeSym ? cstOf(db, typeSym.id) : null;
        if (typeSym && typeCst) {
          const scanEqs = (n: SyntaxNode): boolean => {
            if (n.type === "simple_equation") {
              const eqT = n.text.trim();
              const litM = eqT.match(new RegExp(`([A-Za-z_]\\w*)\\s*\\[\\s*(${enumAlias}\\.([A-Za-z_]\\w*))\\s*\\]`));
              if (litM && !newLits.has(litM[3]!)) {
                pushErrorOnce(
                  2002,
                  "redeclare-enum-lit-not-found",
                  `Variable ${litM[2]!} not found in scope ${compType}$${compName}.`,
                  n,
                );
                pushErrorOnce(
                  2002,
                  "redeclare-enum-sub-not-found",
                  `Variable ${litM[1]!}[${litM[2]!}] not found in scope ${compType}$${compName}.`,
                  n,
                );
                return true;
              }
            }
            for (const ch of n.namedChildren) {
              if (scanEqs(ch)) return true;
            }
            return false;
          };
          scanEqs(typeCst);
        }
      }
    }
    // VectorizeSeveralArguments / ExtObjError (old frontend)
    if (isOldFrontend && sym) {
      const callM2 = ccTxt.match(/=\s*([A-Za-z_]\w*)\s*\(([^)]*)\)\s*;?$/);
      if (callM2) {
        const fnName = callM2[1]!;
        const argsStr = callM2[2]!.trim();
        const fnSym = resolveClassSym(db, classId, fnName);
        const isImportedAlias = db.childrenOf(classId).some((c) => {
          if (c.kind !== "Import") return false;
          if (c.name === fnName) return true;
          const it = cstOf(db, c.id)?.text?.trim() ?? "";
          return new RegExp(`^import\\s+${fnName}\\s*=`).test(it);
        });
        if (!fnSym && !isImportedAlias && !comps.has(fnName) && !BUILTIN_MODELICA_FUNCTIONS.has(fnName)) {
          pushErrorOnce(
            ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.code,
            ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.rule,
            `Class ${fnName} not found in scope ${sym.name} (looking for a function or record).`,
            node,
          );
        } else if (
          fnSym &&
          (fnSym.kind === "Function" || getClassSpecialization(fnSym, cstOf(db, fnSym.id)) === "function")
        ) {
          const argList = argsStr
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          const fnInputs: { name: string; typeName: string }[] = [];
          for (const fc of db.childrenOf(fnSym.id)) {
            if (fc.kind !== "Component") continue;
            const fcCst = cstOf(db, fc.id);
            const fcClause = fcCst ? (findAncestor(fcCst, "component_clause") ?? fcCst) : null;
            const fcTxt = fcClause?.text?.trim() ?? "";
            if (!/\binput\b/.test(fcTxt.split(fc.name)[0] ?? "")) continue;
            const tM = fcTxt.match(/\binput\s+(?:(?:constant|parameter|discrete)\s+)?([A-Za-z_][\w.]*)/);
            if (tM) fnInputs.push({ name: fc.name, typeName: tM[1]! });
          }
          for (let ai = 0; ai < Math.min(argList.length, fnInputs.length); ai++) {
            const inp = fnInputs[ai]!;
            const arg = argList[ai]!;
            if (/^[A-Za-z_]\w*$/.test(arg)) {
              const argComp = comps.get(arg);
              if (argComp && argComp.typeName !== inp.typeName) {
                // ExtObjError: ExternalObject type mismatch
                const argTypeSym = !PRIMITIVE_BUILTIN_TYPES.has(argComp.typeName)
                  ? resolveClassSym(db, classId, argComp.typeName)
                  : null;
                const inpTypeSym = !PRIMITIVE_BUILTIN_TYPES.has(inp.typeName)
                  ? resolveClassSym(db, classId, inp.typeName)
                  : null;
                const argIsExtObj = argTypeSym
                  ? db.childrenOf(argTypeSym.id).some((c) => c.kind === "Extends" && c.name === "ExternalObject")
                  : false;
                const inpIsExtObj = inpTypeSym
                  ? db.childrenOf(inpTypeSym.id).some((c) => c.kind === "Extends" && c.name === "ExternalObject")
                  : false;
                if (argIsExtObj && inpIsExtObj) {
                  const fnQual = fnSym.parentId === classId ? `${sym.name}.${fnName}` : fnName;
                  const argQual =
                    argTypeSym!.parentId === classId ? `${sym.name}.${argComp.typeName}` : argComp.typeName;
                  const inpQual = inpTypeSym!.parentId === classId ? `${sym.name}.${inp.typeName}` : inp.typeName;
                  pushErrorOnce(
                    3006,
                    "extobj-arg-type-mismatch",
                    `Type mismatch for positional argument ${ai + 1} in ${fnQual}(${inp.name}=${arg}). The argument has type:\n  ExternalObject ${argQual}\nexpected type:\n  ExternalObject ${inpQual}`,
                    node,
                  );
                }
              }
            }
          }
        }
      }
      // BadVariabilityBug3150: array component modifying a `constant` member with `array(... for i in 1:param)`
      const arrCompModM = ccTxt.match(
        /^([A-Za-z_]\w*)\s*\[\s*([A-Za-z_]\w*)\s*\]\s+([A-Za-z_]\w*)\s*\(\s*([A-Za-z_]\w*)\s*=\s*array\s*\(([^)]+)\)\s*\)/,
      );
      if (arrCompModM) {
        const compType = arrCompModM[1]!;
        const dimVar = arrCompModM[2]!;
        const compName = arrCompModM[3]!;
        const modField = arrCompModM[4]!;
        const arrBody = arrCompModM[5]!;
        const dimComp = comps.get(dimVar);
        const compSym = resolveClassSym(db, classId, compType);
        const fieldComp = compSym ? collectClassComponents(db, compSym.id).get(modField) : null;
        if (
          dimComp &&
          dimComp.variability === "parameter" &&
          fieldComp &&
          fieldComp.variability === "constant" &&
          new RegExp(`\\b${dimVar}\\b`).test(arrBody)
        ) {
          const dimClause = findAncestor(dimComp.cst, "component_clause") ?? dimComp.cst;
          const nM = dimClause?.text?.match(/=\s*(\d+)/);
          const nVal = nM ? nM[1]! : "2";
          const findElMod = (n: SyntaxNode): SyntaxNode | null => {
            if (n.type === "element_modification") return n;
            for (const ch of n.namedChildren) {
              const r = findElMod(ch);
              if (r) return r;
            }
            return null;
          };
          const elemMod = findElMod(node) ?? node;
          pushErrorOnce(
            ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH.code,
            ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH.rule,
            `Component ${compName}[${nVal}].${modField} of variability CONST has binding false of higher variability PARAM.`,
            elemMod,
          );
        }
      }
    }
  }
}
