// SPDX-License-Identifier: AGPL-3.0-or-later

import { type SymbolEntry } from "@modelscript/runtime";
import { type SyntaxNode } from "../../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../../errors.js";
import { checkClassModifiers } from "./class-inheritance-checks.js";
import { inferSimpleLiteralType } from "./const-eval.js";
import {
  collectClassComponents,
  collectModifiersInNode,
  findAncestor,
  getClassSpecialization,
  getCompInfo,
  getHeaderText,
  getShortClassCausality,
  isClassPartial,
  isReplaceablePackagePrefix,
  isShortClassPrimitiveAlias,
  resolveClassSym,
} from "./cst-helpers.js";
import { cstOf, pushNotification } from "./diagnostics.js";
import { PRIMITIVE_BUILTIN_TYPES, type ClassValidationContext } from "./types.js";

export function validateClassComponents(ctx: ClassValidationContext): void {
  const {
    db,
    dae,
    classId,
    sym,
    classCst,
    isTopLevelRoot,
    spec,
    classPartial,
    children,
    comps,
    isOldFrontend,
    visitedClasses,
    invalidOrConflictingImports,
    pushErrorOnce,
    validateSubtree,
  } = ctx;

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
      const isRootClass = isTopLevelRoot;
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
                `Dimensions must be parameter or constant expression (in ${d}).`,
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
            if (m.text.includes("=")) {
              const attrVal = m.text.slice(m.text.indexOf("=") + 1).trim();
              const gotT = inferSimpleLiteralType(attrVal);
              if (gotT) {
                const expT =
                  m.name === "quantity" || m.name === "unit" || m.name === "displayUnit"
                    ? "String"
                    : m.name === "fixed" || m.name === "unbounded"
                      ? "Boolean"
                      : m.name === "start" || m.name === "min" || m.name === "max" || m.name === "nominal"
                        ? info.typeName
                        : null;
                if (expT && gotT !== expT && !(expT === "Real" && gotT === "Integer")) {
                  pushNotification(dae, m.node);
                  pushErrorOnce(
                    3001,
                    "builtin-attr-type-mismatch",
                    `Type mismatch in binding ${m.name} = ${attrVal}, expected subtype of ${expT}, got type ${gotT}.`,
                    compClause,
                  );
                }
              }
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
          if (!emittedCompTypeErr && info.typeName.includes(".")) {
            const tSegs = info.typeName.split(".");
            let curCls: SymbolEntry | null = null;
            let viaComp = false;
            const firstComp = comps.get(tSegs[0]!);
            if (firstComp && firstComp.typeName && !PRIMITIVE_BUILTIN_TYPES.has(firstComp.typeName)) {
              curCls = resolveClassSym(db, classId, firstComp.typeName);
              viaComp = true;
            } else {
              curCls = resolveClassSym(db, classId, tSegs[0]!);
            }
            for (let si = 1; si < tSegs.length && curCls; si++) {
              const seg = tSegs[si]!;
              const chCls = db
                .childrenOf(curCls.id)
                .find((c) => (c.kind === "Class" || c.kind === "Package") && c.name === seg);
              if (chCls) {
                curCls = chCls;
                if (si === tSegs.length - 1 && viaComp) {
                  pushErrorOnce(
                    2012,
                    "lookup-class-via-comp",
                    `Class name '${info.typeName}' was found via a component (only component and function call names may be accessed in this way).`,
                    compClause,
                  );
                  emittedCompTypeErr = true;
                }
              } else {
                const chComp = collectClassComponents(db, curCls.id).get(seg);
                if (chComp && chComp.typeName && !PRIMITIVE_BUILTIN_TYPES.has(chComp.typeName)) {
                  curCls = resolveClassSym(db, curCls.id, chComp.typeName);
                  viaComp = true;
                } else {
                  curCls = null;
                }
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
                return;
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
                      if (isOldFrontend) return;
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
            // InnerOuterInvalidType1: outer component in resolvedT matched by inner class in classId
            if (!isOldFrontend) {
              for (const [subName, subInfo] of subCompsRT) {
                if (!subInfo.isOuter) continue;
                const innerCls = db
                  .childrenOf(classId)
                  .find((c) => (c.kind === "Class" || c.kind === "Package") && c.name === subName);
                if (innerCls) {
                  const icCst = cstOf(db, innerCls.id);
                  const icElem = icCst ? (findAncestor(icCst, "element", 3) ?? icCst) : null;
                  if (icElem && /\binner\b/.test(icElem.text)) {
                    const subClause = subInfo.cst
                      ? (findAncestor(subInfo.cst, "component_clause") ?? subInfo.cst)
                      : null;
                    if (subClause) pushNotification(dae, subClause);
                    pushErrorOnce(
                      4055,
                      "inner-class-expected-comp",
                      `Found inner class ${subName} instead of expected component.`,
                      icCst ?? icElem,
                    );
                  }
                }
              }
              // InnerOuterInvalidType2: outer class in resolvedT matched by inner component in classId
              for (const subCls of db.childrenOf(resolvedT.id)) {
                if (subCls.kind !== "Class" && subCls.kind !== "Package") continue;
                const scCst = cstOf(db, subCls.id);
                const scElem = scCst ? (findAncestor(scCst, "element", 3) ?? scCst) : null;
                if (!scElem || !/^\s*outer\b/.test(scElem.text.trim())) continue;
                const innerComp = comps.get(subCls.name);
                if (innerComp) {
                  const icClause = innerComp.cst
                    ? (findAncestor(innerComp.cst, "component_clause") ?? innerComp.cst)
                    : null;
                  const icElem = icClause ? (findAncestor(icClause, "element", 3) ?? icClause) : null;
                  if (icElem && /\binner\b/.test(icElem.text)) {
                    pushNotification(dae, scCst ?? scElem);
                    pushErrorOnce(
                      4055,
                      "inner-comp-expected-class",
                      `Found inner component ${subCls.name} instead of expected class.`,
                      icClause ?? icElem,
                    );
                  }
                }
              }
              // Each3: A a(each n(fixed = true)) where n is an array component of A and nested attr lacks `each`
              const eachNestedM = compClause.text.match(
                /\beach\s+([A-Za-z_]\w*)\s*\(\s*([A-Za-z_]\w*)\s*=\s*([^,)]+)\s*\)/,
              );
              if (eachNestedM) {
                const arrCompName = eachNestedM[1]!;
                const attrName = eachNestedM[2]!;
                const attrVal = eachNestedM[3]!.trim();
                const arrInfo = subCompsRT.get(arrCompName);
                if (arrInfo && arrInfo.ndims > 0 && !attrVal.startsWith("{")) {
                  const arrClause = arrInfo.cst ? (findAncestor(arrInfo.cst, "component_clause") ?? arrInfo.cst) : null;
                  pushNotification(dae, compClause);
                  pushErrorOnce(
                    3001,
                    "missing-each-nested-attr",
                    `Non-array modification '${attrVal}' for array component '${attrName}', possibly due to missing 'each'.`,
                    arrClause ?? compClause,
                  );
                }
              }
              // func2: component binding `Real x = f();` in resolvedT where f has 0 outputs
              for (const [subName, subInfo] of subCompsRT) {
                const subClause = subInfo.cst ? (findAncestor(subInfo.cst, "component_clause") ?? subInfo.cst) : null;
                const subTxt = subClause?.text?.trim() ?? "";
                const zeroCallM = subTxt.match(/=\s*([A-Za-z_]\w*)\s*\(\s*\)\s*;?$/);
                if (zeroCallM) {
                  const fnN = zeroCallM[1]!;
                  const fnS = db
                    .childrenOf(resolvedT.id)
                    .find((c) => (c.kind === "Function" || c.kind === "Class") && c.name === fnN);
                  if (
                    fnS &&
                    (fnS.kind === "Function" || getClassSpecialization(fnS, cstOf(db, fnS.id)) === "function")
                  ) {
                    const hasOut = Array.from(collectClassComponents(db, fnS.id).values()).some(
                      (ci) => ci.causality === "output",
                    );
                    if (!hasOut) {
                      pushErrorOnce(
                        3001,
                        "zero-output-func-binding",
                        `Type mismatch in binding ${subName} = ${sym.name}.${child.name}.${fnN}(), expected subtype of ${subInfo.typeName}, got type ().`,
                        subClause ?? compClause,
                      );
                    }
                  }
                }
              }
            }
            // ConstrainingType3: A b(redeclare Conductor r(...)) where A has replaceable Resistor r(R=1) and Conductor has no R
            if (isOldFrontend) {
              const redM = compClause.text.match(/\bredeclare\s+([A-Za-z_][\w.]*)\s+([A-Za-z_]\w*)\b/);
              if (redM) {
                const newTypeName = redM[1]!;
                const redCompName = redM[2]!;
                const origInfo = subCompsRT.get(redCompName);
                const newTypeSym = resolveClassSym(db, classId, newTypeName);
                if (origInfo && newTypeSym) {
                  const origClause = origInfo.cst
                    ? (findAncestor(origInfo.cst, "component_clause") ?? origInfo.cst)
                    : null;
                  const origTxt = origClause?.text ?? "";
                  const constrM = origTxt.match(/\bextends\s+([A-Za-z_][\w.]*)/);
                  const origModM =
                    !constrM || constrM[1] === origInfo.typeName
                      ? origTxt.match(new RegExp(`\\b${redCompName}\\s*\\(\\s*([A-Za-z_]\\w*)\\s*=\\s*([^,)]+)\\s*\\)`))
                      : null;
                  if (origModM) {
                    const modKey = origModM[1]!;
                    const modVal = origModM[2]!.trim();
                    const newComps = collectClassComponents(db, newTypeSym.id);
                    if (!newComps.has(modKey)) {
                      pushErrorOnce(
                        2004,
                        "constraining-type-modifier-not-found",
                        `Variable ${child.name}.${redCompName}: In modifier (${modKey} = ${modVal}), class or component ${modKey} not found in <${newTypeName}$${child.name}$${redCompName}>.`,
                        origClause ?? compClause,
                      );
                    }
                  }
                }
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
            getClassSpecialization(tSymEnum, tCst) === "type" &&
            /=\s*enumeration\s*\(\s*:\s*\)/.test(tTxt) &&
            (isTopLevelRoot || (!/\breplaceable\b/.test(tTxt) && !/\breplaceable\b/.test(tParentTxt)))
          ) {
            pushErrorOnce(
              3001,
              "enum-unspecified",
              `Component '${child.name}' has an unspecified enumeration type (enumeration(:)).`,
              compClause,
            );
          }
          // TypeMissingBaseType1: `type T end T;` without extends or short-class `=`
          if (
            isTopLevelRoot &&
            tCst &&
            getClassSpecialization(tSymEnum, tCst) === "type" &&
            !tTxt.includes("=") &&
            !db.childrenOf(tSymEnum.id).some((c) => c.kind === "Extends")
          ) {
            pushErrorOnce(
              3001,
              "type-missing-base-type",
              `Type '${tSymEnum.name}' does not extend a basic type.`,
              tCst,
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

      if (!info.typeName.includes(".") && isOldFrontend) {
        const directScope =
          db
            .childrenOf(classId)
            .find((c) => (c.kind === "Class" || c.kind === "Package") && c.name === info.typeName) ??
          db.query<((n: string) => SymbolEntry | null) | null>("resolveName", classId)?.(info.typeName) ??
          db.query<((n: string) => SymbolEntry | null) | null>("resolveSimpleName", classId)?.(info.typeName) ??
          db.childrenOf(null).find((c) => (c.kind === "Class" || c.kind === "Package") && c.name === info.typeName) ??
          null;
        if (!directScope && /\bextends\b/.test(classCst.text)) {
          const errNode = findAncestor(compCst, "component_clause") ?? compCst;
          for (let di = dae.diagnostics.length - 1; di >= 0; di--) {
            if (dae.diagnostics[di]?.code === 2003 && dae.diagnostics[di]?.message.startsWith("Class or type '")) {
              dae.diagnostics.splice(di, 1);
            }
          }
          pushErrorOnce(2003, "class-not-found", `Class ${info.typeName} not found in scope ${sym.name}.`, errNode);
          return;
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
            checkClassModifiers(ctx, typeSym, modNode, false);
          }
        }

        validateSubtree(typeSym.id);
      }
    }
  }
}
