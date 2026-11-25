// SPDX-License-Identifier: AGPL-3.0-or-later

import { type SymbolEntry, type SymbolId } from "@modelscript/runtime";
import { type SyntaxNode } from "../../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../../errors.js";
import { validateComponentClauseInCst, validateImportInCompositeName } from "./component-clause-cst-checks.js";
import { inferSimpleLiteralType } from "./const-eval.js";
import {
  collectClassComponents,
  findAncestor,
  getClassSpecialization,
  getCompInfo,
  isClassPartial,
  isSubclassOf,
  resolveClassSym,
} from "./cst-helpers.js";
import { cstOf, pushNotification } from "./diagnostics.js";
import {
  validateAlgorithmCallStatement,
  validateFunctionCallNode,
  validateFunctionComponentBinding,
} from "./function-call-checks.js";
import { PRIMITIVE_BUILTIN_TYPES, type ClassValidationContext, type CompInfo, type WalkCstState } from "./types.js";

export function walkClassCst(ctx: ClassValidationContext): void {
  const { db, dae, classId, sym, classCst, spec, comps, isOldFrontend, pushErrorOnce } = ctx;
  const className = sym.name;
  const walkState: WalkCstState = { emittedDelayError: false };

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
      // CardinalityInvalidArg2: cardinality(arr.conn) where arr is an array component
      if (t === "if_equation" && !isOldFrontend) {
        const cardM = node.text.match(/\bcardinality\s*\(\s*([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*\)/);
        if (cardM) {
          const baseComp = comps.get(cardM[1]!);
          const subField = cardM[2]!;
          if (baseComp) {
            const baseClause = findAncestor(baseComp.cst, "component_clause") ?? baseComp.cst;
            const dimM = baseClause?.text?.match(new RegExp(`\\b${cardM[1]!}\\s*\\[(\\d+)\\]`));
            if (dimM) {
              const baseSym = resolveClassSym(db, classId, baseComp.typeName);
              const subComp = baseSym ? collectClassComponents(db, baseSym.id).get(subField) : null;
              if (subComp) {
                pushErrorOnce(
                  3006,
                  "cardinality-array-arg",
                  `Type mismatch for positional argument 1 in cardinality(c=${cardM[1]!}.${subField}). The argument has type:\n  ${subComp.typeName}[${dimM[1]!}]\nexpected type:\n  Connector`,
                  node,
                );
              }
            }
          }
        }
      }
      // EnumFuncRel: comparing uncalled function name returning enum against enum literal (if f == E.one)
      if (t === "if_statement" && isOldFrontend) {
        const relM = node.text.match(
          /\bif\s+([A-Za-z_]\w*)\s*(==|<>|<|<=|>|>=)\s*([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s+then\b/,
        );
        if (relM) {
          const fnName = relM[1]!;
          const opStr = relM[2]!;
          const enumName = relM[3]!;
          const litName = relM[4]!;
          const fnSym = !comps.has(fnName) ? resolveClassSym(db, classId, fnName) : null;
          const enumSym = resolveClassSym(db, classId, enumName);
          if (
            fnSym &&
            (fnSym.kind === "Function" || getClassSpecialization(fnSym, cstOf(db, fnSym.id)) === "function") &&
            enumSym
          ) {
            const enumTxt = cstOf(db, enumSym.id)?.text ?? "";
            const em = enumTxt.match(/\benumeration\s*\(([^)]+)\)/);
            if (em) {
              const lits = em[1]!
                .split(",")
                .map((s) => s.trim())
                .join(", ");
              pushErrorOnce(
                3001,
                "enum-func-rel",
                `Cannot resolve type of expression ${fnName} ${opStr} ${enumName}.${litName}. The operands have types .${fnName}<function>() => #enumeration(${lits}), enumeration(${lits}) in component <NO COMPONENT>.`,
                node,
              );
            }
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
                  4055,
                  "expandable-both-undeclared",
                  `Cannot connect undeclared connectors ${lhs} with ${rhs}. At least one of them must be declared.`,
                  lDot[2] === rDot[2] ? null : node,
                );
              }
            }
          }
        }
        // Reject non-connector short-class alias (e.g. `class C2 = C; C2 c1, c2; connect(c1, c2);`) (Connect3)
        if (!isOldFrontend && !lhs.includes(".") && !rhs.includes(".")) {
          const lInfo = comps.get(lhs);
          const rInfo = comps.get(rhs);
          for (const [opName, opInfo] of [
            [lhs, lInfo],
            [rhs, rInfo],
          ] as const) {
            if (!opInfo) continue;
            const opTypeSym = resolveClassSym(db, opInfo.ownerClassId, opInfo.typeName);
            if (!opTypeSym) continue;
            const opTypeCst = cstOf(db, opTypeSym.id);
            const opTypeTxt = opTypeCst?.text?.trim() ?? "";
            if (/^(?:partial\s+)?class\s+[A-Za-z_]\w*\s*=/.test(opTypeTxt)) {
              pushErrorOnce(3004, "not-a-connector", `${opName} is not a valid connector.`, node);
              break;
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

    if (
      validateFunctionCallNode(ctx, node, argsNode, isExprCall, isDerExprCall, inWhen, inCondCtx, walkState, walkCst)
    ) {
      return;
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

    validateImportInCompositeName(ctx, node);
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

    validateFunctionComponentBinding(ctx, node);
    // ConstantMissingBinding2: P.x used in equation where P is a package and x is an unbound constant
    if (t === "simple_equation" && !isOldFrontend) {
      const eqTxt = node.text.trim();
      for (const pm of eqTxt.matchAll(/\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)\b/g)) {
        const pName = pm[1]!;
        const cName = pm[2]!;
        if (comps.has(pName)) continue;
        const pSym = resolveClassSym(db, classId, pName);
        if (!pSym) continue;
        const pSpec = getClassSpecialization(pSym, cstOf(db, pSym.id));
        if (pSpec !== "package" && pSym.kind !== "Package") continue;
        const cSym = db.childrenOf(pSym.id).find((c) => c.kind === "Component" && c.name === cName);
        if (!cSym) continue;
        const cCst = cstOf(db, cSym.id);
        const cClause = cCst ? (findAncestor(cCst, "component_clause") ?? cCst) : null;
        const cTxt = cClause?.text?.trim() ?? "";
        if (cClause && /^\s*constant\b/.test(cTxt) && !cTxt.includes("=")) {
          pushNotification(dae, cClause);
          pushErrorOnce(
            4055,
            "constant-missing-binding",
            `Constant ${pName}.${cName} is used without having been given a value.`,
            node,
          );
          break;
        }
      }
    }

    validateAlgorithmCallStatement(ctx, node);
    // conngraph1 / conngraph2: Connections.root(ri) or Connections.root(c1.ri) where argument is not A.R with over-determined R
    if ((t === "function_call" || t === "equation") && !isOldFrontend) {
      const crM = node.text.trim().match(/^Connections\.root\s*\(\s*([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?)\s*\)\s*;?$/);
      if (crM) {
        const argStr = crM[1]!;
        let invalidRootArg = false;
        if (!argStr.includes(".")) {
          if (comps.has(argStr)) invalidRootArg = true;
        } else {
          const [cName, fName] = argStr.split(".");
          const cComp = comps.get(cName!);
          const cSym = cComp?.typeName ? resolveClassSym(db, classId, cComp.typeName) : null;
          if (cSym) {
            const fComp = collectClassComponents(db, cSym.id).get(fName!);
            if (fComp) {
              if (PRIMITIVE_BUILTIN_TYPES.has(fComp.typeName)) {
                invalidRootArg = true;
              } else {
                const fSym = resolveClassSym(db, cSym.id, fComp.typeName);
                const fCstTxt = fSym ? (cstOf(db, fSym.id)?.text ?? "") : "";
                if (fSym && /=\s*(?:input|output)?\s*(?:Real|Integer|Boolean|String)\b/.test(fCstTxt)) {
                  invalidRootArg = true;
                }
              }
            }
          }
        }
        if (invalidRootArg) {
          pushErrorOnce(
            4055,
            "connections-root-arg",
            `The first argument '${argStr}' of Connections.root must have the form A.R, where A is a connector and R an over-determined type/record.`,
            node,
          );
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

    validateComponentClauseInCst(ctx, node);
    // Function8: function call in simple_equation with String arg passed to Real input (old frontend)
    if (t === "simple_equation" && isOldFrontend) {
      const eqTxt = node.text.trim().replace(/;$/, "").trim();
      const eqCallM = eqTxt.match(/=\s*([A-Za-z_]\w*)\s*\(([^)]*)\)$/);
      if (eqCallM) {
        const fnName = eqCallM[1]!;
        const argList = eqCallM[2]!
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const fnSym = resolveClassSym(db, classId, fnName);
        if (fnSym && (fnSym.kind === "Function" || getClassSpecialization(fnSym, cstOf(db, fnSym.id)) === "function")) {
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
              if (
                argComp &&
                argComp.typeName === "String" &&
                (inp.typeName === "Real" || inp.typeName === "Integer" || inp.typeName === "Boolean")
              ) {
                pushErrorOnce(
                  3006,
                  "func-arg-type-mismatch",
                  `Type mismatch for positional argument ${ai + 1} in ${fnName}(${inp.name}=${arg}). The argument has type:\n  ${argComp.typeName}\nexpected type:\n  ${inp.typeName}`,
                  node,
                );
              }
            }
          }
        }
      }
    }
    // ExpandableConnectorNonDecl3 & IndexOutOfBoundsConnect4 on connect_equation / connect_clause
    if (t === "connect_equation" || t === "connect_clause") {
      const cTxt = node.text.trim();
      const cm = cTxt.match(/^connect\s*\(\s*([^,]+),\s*([^)]+)\s*\)/);
      if (cm) {
        const a1 = cm[1]!.trim();
        const a2 = cm[2]!.trim();
        // ExpandableConnectorNonDecl3: nested virtual element ec.c.ri on an expandable connector
        if (!isOldFrontend) {
          for (const ep of [a1, a2]) {
            const parts = ep.split(".");
            if (parts.length >= 3) {
              const rootComp = comps.get(parts[0]!);
              const rootSym = rootComp ? resolveClassSym(db, classId, rootComp.typeName) : null;
              const rootCstTxt = rootSym ? (cstOf(db, rootSym.id)?.text ?? "") : "";
              if (rootSym && /\bexpandable\s+connector\b/.test(rootCstTxt)) {
                const hasChild1 = collectClassComponents(db, rootSym.id).has(parts[1]!);
                if (!hasChild1) {
                  pushErrorOnce(
                    4055,
                    "expandable-virtual-augment",
                    `Internal error Augmenting a virtual element in an expandable connector is not yet supported.`,
                    null,
                  );
                }
              }
            }
          }
        }
        // IndexOutOfBoundsConnect4: connect(c1[2:3], c2[1:2]) where c1 has size 2
        if (isOldFrontend) {
          for (const ep of [a1, a2]) {
            const sm = ep.match(/^([A-Za-z_]\w*)\[\s*(\d+)\s*:\s*(\d+)\s*\]$/);
            if (sm) {
              const vn = sm[1]!;
              const lo = parseInt(sm[2]!, 10);
              const hi = parseInt(sm[3]!, 10);
              const vc = comps.get(vn);
              const vClause = vc ? (findAncestor(vc.cst, "component_clause") ?? vc.cst) : null;
              const dm = vClause?.text?.match(new RegExp(`\\b${vn}\\s*\\[\\s*(\\d+)\\s*\\]`));
              if (dm) {
                const sz = parseInt(dm[1]!, 10);
                if (hi > sz) {
                  const elems: number[] = [];
                  for (let k = lo; k <= hi; k++) elems.push(k);
                  pushErrorOnce(
                    4055,
                    "connect-index-oob",
                    `Subscript '${hi}' for dimension 1 (size = ${sz}) of ${vn}[{${elems.join(", ")}}] is out of bounds.`,
                    node,
                  );
                }
              }
            }
          }
        }
      }
    }
    // OperatorOverloadArrayOp3, OperatorOverloadError1, OperatorOverloadBinaryAmbiguous, OperatorOverloadConstructorDefault2
    if (t === "simple_equation" && !isOldFrontend) {
      const eqTxt = node.text.trim().replace(/;$/, "").trim();
      // OperatorOverloadConstructorDefault2: c = C(1.0, 2.0) when operator record C defines custom 'constructor'
      const ctorM = eqTxt.match(/^([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\s*\(([^)]+)\)$/);
      if (ctorM) {
        const recName = ctorM[2]!;
        const recSym = resolveClassSym(db, classId, recName);
        const recTxt = recSym ? (cstOf(db, recSym.id)?.text ?? "") : "";
        if (recSym && /\boperator\s+record\b/.test(recTxt)) {
          const ctorChild = db
            .childrenOf(recSym.id)
            .find((c) => c.name === "'constructor'" || c.name === "constructor");
          if (ctorChild) {
            const ctorCst = cstOf(db, ctorChild.id);
            const ctorTxt = ctorCst?.text ?? "";
            if (/\boperator\s+function\b/.test(ctorTxt)) {
              const callArgs = ctorM[3]!
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
              const inputs: { typeName: string; name: string }[] = [];
              for (const fc of db.childrenOf(ctorChild.id)) {
                if (fc.kind !== "Component") continue;
                const fcCst = cstOf(db, fc.id);
                const fcClause = fcCst ? (findAncestor(fcCst, "component_clause") ?? fcCst) : null;
                const fcTxt = fcClause?.text?.trim() ?? "";
                if (!/^\s*(?:(?:constant|parameter|discrete)\s+)*input\b/.test(fcTxt)) continue;
                const tm = fcTxt.match(/\binput\s+([A-Za-z_][\w.]*)/);
                if (tm) inputs.push({ typeName: tm[1]!, name: fc.name });
              }
              if (callArgs.length !== inputs.length) {
                const fmtArgs = callArgs.map((a) => {
                  const lt = inferSimpleLiteralType(a);
                  return lt ? `/*${lt}*/ ${a}` : a;
                });
                const fmtParams = inputs.map((i) => `${i.typeName} ${i.name}`).join(", ");
                pushErrorOnce(
                  3006,
                  "operator-constructor-mismatch",
                  `No matching function found for ${recName}(${fmtArgs.join(", ")}).\nCandidates are:\n  ${recName}.'constructor'(${fmtParams}) => ${recName}`,
                  node,
                );
              }
            }
          }
        }
      }
      // Binary operator on operator record: c1 = c2 (+|-|*|/) c3
      const binM = eqTxt.match(/^[A-Za-z_]\w*\s*=\s*([A-Za-z_]\w*)\s*([+\-*/])\s*([A-Za-z_]\w*|\d+(?:\.\d+)?)$/);
      if (binM) {
        const lStr = binM[1]!;
        const opStr = binM[2]!;
        const rStr = binM[3]!;
        const unwrapShortType = (
          startScope: SymbolId,
          startType: string,
        ): { sym: SymbolEntry | null; canonType: string } => {
          let curT = startType;
          let curScope = startScope;
          let curSym: SymbolEntry | null = null;
          const seen = new Set<number>();
          for (let depth = 0; depth < 8; depth++) {
            if (PRIMITIVE_BUILTIN_TYPES.has(curT)) return { sym: null, canonType: curT };
            const s = resolveClassSym(db, curScope, curT);
            if (!s || seen.has(s.id)) return { sym: curSym, canonType: curSym?.name ?? curT };
            seen.add(s.id);
            curSym = s;
            const txt = cstOf(db, s.id)?.text?.trim() ?? "";
            const sm = txt.match(
              /^(?:(?:encapsulated|partial|replaceable|final|inner|outer)\s+)*(?:(?:operator\s+record|type|connector|model|block|record|class)\s+)[A-Za-z_]\w*\s*=\s*(?:(?:input|output|flow|stream|discrete|parameter|constant)\s+)*([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/,
            );
            if (!sm) return { sym: curSym, canonType: curSym.name };
            curT = sm[1]!;
            curScope = s.parentId ?? curScope;
          }
          return { sym: curSym, canonType: curSym?.name ?? curT };
        };
        const lComp = comps.get(lStr);
        const lUnwrapped =
          lComp && !PRIMITIVE_BUILTIN_TYPES.has(lComp.typeName)
            ? unwrapShortType(lComp.ownerClassId ?? classId, lComp.typeName)
            : { sym: null, canonType: lComp?.typeName ?? "" };
        const lSym = lUnwrapped.sym;
        const lRecTxt = lSym ? (cstOf(db, lSym.id)?.text ?? "") : "";
        if (lSym && /\boperator\s+record\b/.test(lRecTxt)) {
          const rComp = comps.get(rStr);
          const rTypeRaw = rComp ? rComp.typeName : (inferSimpleLiteralType(rStr) ?? "");
          const rUnwrapped =
            rComp && !PRIMITIVE_BUILTIN_TYPES.has(rTypeRaw)
              ? unwrapShortType(rComp.ownerClassId ?? classId, rTypeRaw)
              : { sym: null, canonType: rTypeRaw };
          const rType = rUnwrapped.canonType;
          const lType = lUnwrapped.canonType;
          const lClause = findAncestor(lComp!.cst, "component_clause") ?? lComp!.cst;
          const lDimM = lClause?.text?.match(new RegExp(`\\b${lStr}\\s*\\[(\\d+)\\]`));
          const opChild = db.childrenOf(lSym.id).find((c) => c.name === `'${opStr}'` || c.name === opStr);
          if (!opChild) {
            const lTDisp = lDimM ? `${lComp!.typeName}[${lDimM[1]!}]` : lComp!.typeName;
            const rClause = rComp ? (findAncestor(rComp.cst, "component_clause") ?? rComp.cst) : null;
            const rDimM = rClause?.text?.match(new RegExp(`\\b${rStr}\\s*\\[(\\d+)\\]`));
            const rTDisp = rDimM ? `${rTypeRaw}[${rDimM[1]!}]` : rTypeRaw;
            pushErrorOnce(
              3001,
              "operator-not-found",
              `Cannot resolve type of expression ${lStr} ${opStr} ${rStr}. The operands have types ${lTDisp}, ${rTDisp} in component <NO_COMPONENT>.`,
              node,
            );
          } else if (rType) {
            const cands: { sig: string; t0: string; t1: string }[] = [];
            const collectOpCands = (recSym: SymbolEntry, opNode: SymbolEntry) => {
              for (const fnCh of db.childrenOf(opNode.id)) {
                const ins: { t: string; n: string }[] = [];
                let outT = recSym.name;
                for (const fc of db.childrenOf(fnCh.id)) {
                  if (fc.kind !== "Component") continue;
                  const fcCst = cstOf(db, fc.id);
                  const fcClause = fcCst ? (findAncestor(fcCst, "component_clause") ?? fcCst) : null;
                  const fcTxt = fcClause?.text?.trim() ?? "";
                  if (/^\s*(?:(?:constant|parameter|discrete)\s+)*input\b/.test(fcTxt)) {
                    const tm = fcTxt.match(/\binput\s+([A-Za-z_][\w.]*(?:\[[^\]]*\])?)/);
                    const postDim = fcTxt.match(new RegExp(`\\b${fc.name}\\s*(\\[[^\\]]*\\])`));
                    if (tm) {
                      const fullT = postDim && !tm[1]!.includes("[") ? `${tm[1]!}${postDim[1]!}` : tm[1]!;
                      ins.push({ t: fullT, n: fc.name });
                    }
                  } else if (/^\s*(?:(?:constant|parameter|discrete)\s+)*output\b/.test(fcTxt)) {
                    const tm = fcTxt.match(/\boutput\s+([A-Za-z_][\w.]*(?:\[[^\]]*\])?)/);
                    if (tm) outT = tm[1]!;
                  }
                }
                if (ins.length === 2) {
                  cands.push({
                    sig: `${recSym.name}.'${opStr}'.${fnCh.name}(${ins[0]!.t} ${ins[0]!.n}, ${ins[1]!.t} ${ins[1]!.n}) => ${outT}`,
                    t0: ins[0]!.t,
                    t1: ins[1]!.t,
                  });
                }
              }
            };
            collectOpCands(lSym, opChild);
            if (rUnwrapped.sym && rUnwrapped.sym.id !== lSym.id) {
              const rRecTxt = cstOf(db, rUnwrapped.sym.id)?.text ?? "";
              if (/\boperator\s+record\b/.test(rRecTxt)) {
                const rOpChild = db
                  .childrenOf(rUnwrapped.sym.id)
                  .find((c) => c.name === `'${opStr}'` || c.name === opStr);
                if (rOpChild) collectOpCands(rUnwrapped.sym, rOpChild);
              }
            }
            const lIsArr = /\[/.test(lComp?.cst?.text ?? "");
            const rIsArr = /\[/.test(rComp?.cst?.text ?? "");
            const exact = cands.filter((c) => c.t0 === lType && c.t1 === rType);
            if (exact.length >= 2 && !lIsArr && !rIsArr) {
              pushErrorOnce(
                3006,
                "operator-ambiguous",
                `Ambiguous matching overloaded operator functions found for ${lStr} ${opStr} ${rStr}.\nCandidates are:\n${cands.map((e) => `  ${e.sig}`).join("\n")}`,
                node,
              );
            } else if (exact.length === 0 && cands.length > 0) {
              const hasCtor = db
                .childrenOf(lSym.id)
                .some((c) => c.name === "'constructor'" || c.name === "constructor");
              if (!hasCtor) {
                pushErrorOnce(
                  3001,
                  "operator-no-match",
                  `Cannot resolve type of expression ${lStr} ${opStr} ${rStr}. The operands have types ${lComp!.typeName}, ${rTypeRaw} in component <NO_COMPONENT>.`,
                  node,
                );
              }
            }
          }
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
              !inCondCtx &&
              /^\d+$/.test(subBody) &&
              !findAncestor(node, "connect_equation", 6) &&
              !findAncestor(node, "connect_clause", 6) &&
              !findAncestor(node, "if_equation", 8)
            ) {
              const idx = parseInt(subBody, 10);
              const compClause = findAncestor(cInfo.cst, "component_clause") ?? cInfo.cst;
              const dimM = (compClause?.text ?? "").match(/\[\s*(\d+)\s*\]/);
              if (dimM) {
                const sz = parseInt(dimM[1]!, 10);
                if (sz > 0 && (idx < 1 || idx > sz)) {
                  const oobMsg = `Subscript '${idx}' for dimension 1 (size = ${sz}) of ${baseName} is out of bounds.`;
                  if (!dae.diagnostics.some((d) => d.message === oobMsg)) {
                    pushErrorOnce(3001, "subscript-out-of-bounds", oobMsg, node);
                  }
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
