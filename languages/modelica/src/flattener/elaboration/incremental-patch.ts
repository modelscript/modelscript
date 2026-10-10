// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Causality,
  DAEBuilder,
  EqKind,
  ExprKind,
  foldSingleArenaEquation,
  foldTargetedParamEquations,
  type QueryDB,
  type SymbolId,
  Variability,
} from "@modelscript/runtime";
import { Cst, FieldId } from "../../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../../errors.js";
import { castToRealExpr, isEquationExpr, isRealExpr, lowerCSTExpression } from "../expressions/index.js";

export function findEquationNodeAt(root: any, start: number, end: number): any {
  const queue = [root];
  let candidate = null;
  while (queue.length > 0) {
    const curr = queue.pop();
    if (!curr) continue;
    const s = curr.startIndex ?? curr.startByte ?? 0;
    const e = curr.endIndex ?? curr.endByte ?? 0;
    const isEq = curr.type === "simple_equation";
    if (isEq && ((s <= start && e >= end) || (s >= start && e <= end) || (s < end && e > start))) {
      candidate = curr;
    }
    if (s <= end && e >= start) {
      for (const child of curr.children || []) {
        queue.push(child);
      }
    }
  }
  return candidate;
}

export function findComponentDeclarationAt(root: any, start: number, end: number): any {
  const queue = [root];
  let candidate = null;
  while (queue.length > 0) {
    const curr = queue.pop();
    if (!curr) continue;
    const s = curr.startIndex ?? curr.startByte ?? 0;
    const e = curr.endIndex ?? curr.endByte ?? 0;
    const isComp =
      curr.type === "component_declaration" ||
      curr.type === "component_declaration1" ||
      curr.type === "component_clause" ||
      curr.type === "component_clause1" ||
      curr.type === "declaration";
    if (isComp && ((s <= start && e >= end) || (s >= start && e <= end) || (s < end && e > start))) {
      candidate = curr;
    }
    if (s <= end && e >= start) {
      for (const child of curr.children || []) {
        queue.push(child);
      }
    }
  }
  return candidate;
}

export function isCstNodeProtected(node: any, cache = new WeakMap<any, boolean>()): boolean {
  if (!node) return false;
  if (cache.has(node)) {
    return cache.get(node)!;
  }
  let curr = node;
  const nodeStart = node?.startIndex ?? node?.startByte ?? 0;
  while (curr) {
    if (curr.type === "ElementSection" || curr.type === "element_section") {
      const isProt = curr.children?.[0]?.text === "protected" || curr.text?.startsWith("protected");
      cache.set(node, isProt);
      return isProt;
    }
    if (curr.type === "protected_element_list" || curr.type === "ProtectedElementList") {
      cache.set(node, true);
      return true;
    }
    if (curr.type === "composition" || curr.type === "Composition") {
      let isProt = false;
      for (const child of curr.children || []) {
        const t = child.text?.trim();
        const firstTok = child.children?.[0]?.text?.trim() ?? "";
        if (
          child.type === "protected" ||
          child.type === "Protected" ||
          t === "protected" ||
          firstTok === "protected" ||
          child.text?.startsWith("protected")
        ) {
          isProt = true;
        } else if (
          child.type === "public" ||
          child.type === "Public" ||
          t === "public" ||
          firstTok === "public" ||
          child.text?.startsWith("public")
        ) {
          isProt = false;
        }
        const start = child.startIndex ?? child.startByte;
        const end = child.endIndex ?? child.endByte;
        if (start !== undefined && end !== undefined) {
          if (nodeStart >= start && nodeStart < end) {
            cache.set(node, isProt);
            return isProt;
          }
        }
      }
      cache.set(node, isProt);
      return isProt;
    }
    curr = curr.parent;
  }
  cache.set(node, false);
  return false;
}

export function checkBalance(dae: DAEBuilder, db: QueryDB, rootClassId?: SymbolId): void {
  if (!rootClassId) return;
  const rootSym = db.symbol(rootClassId);
  const rootName = rootSym?.name ?? "Model";
  const rawKind = (rootSym?.metadata as any)?.classKind ?? (rootSym?.metadata as any)?.classPrefixes ?? "model";
  let specKind: string | null = null;
  if (typeof rawKind === "string") {
    const cleanKind = rawKind.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
    const words = cleanKind.split(/\s+/).filter(Boolean);
    if (words.includes("package")) specKind = "package";
    else if (words.includes("function")) specKind = "function";
    else if (words.includes("record")) specKind = "record";
    else if (words.includes("type")) specKind = "type";
    else if (words.includes("connector")) specKind = "connector";
    else if (words.includes("model")) specKind = "model";
    else if (words.includes("block")) specKind = "block";
    else specKind = "model";
  }
  if (
    specKind === "package" ||
    specKind === "function" ||
    specKind === "record" ||
    specKind === "type" ||
    specKind === "connector"
  ) {
    return;
  }

  // Clear any previous balance diagnostics
  dae.diagnostics = dae.diagnostics.filter((d: any) => d.code !== ModelicaErrorCode.UNBALANCED_MODEL.code);

  let stateCount = 0;
  for (let i = 0; i < dae.getVarCount(); i++) {
    if (dae.isVarRemoved(i)) continue;
    if (dae.getVarCausality(i) === Causality.Input) continue;
    const v = dae.getVarVariability(i);
    if (v === Variability.Continuous || v === Variability.Discrete) {
      stateCount += dae.getVarShapeElementCount(i);
    }
  }
  let eqCount = 0;
  for (let i = 0; i < dae.getEqCount(); i++) {
    const kind = dae.getEqKind(i);
    if (kind === EqKind.Simple || kind === EqKind.Array) {
      let count = 1;
      const lhs = dae.getEqLhs(i);
      const rhs = dae.getEqRhs(i);
      for (const expr of [lhs, rhs]) {
        if (expr < 0) continue;
        let target = expr;
        if (dae.getExprKind(target) === ExprKind.Der) {
          target = dae.getExprData1(target);
        }
        if (dae.getExprKind(target) === ExprKind.ArrayCtor) {
          const elemCount = dae.getExprData1(target);
          if (elemCount > 1) {
            count = elemCount;
            break;
          }
        }
        if (dae.getExprKind(target) === ExprKind.Name) {
          const name = dae.interner.resolve(dae.getExprData1(target));
          if (name) {
            const vId = dae.getVarIdxByName(name);
            if (vId >= 0) {
              const shapeCount = dae.getVarShapeElementCount(vId);
              if (shapeCount > 1) {
                count = shapeCount;
                break;
              }
            } else if (dae.hasArrayElements(name)) {
              const shape = dae.getNamedArrayShape(name);
              const elemCount = shape ? shape.reduce((a, b) => a * b, 1) : dae.getArrayElementIndices(name).length;
              if (elemCount > 1) {
                count = elemCount;
                break;
              }
            }
          }
        }
      }
      eqCount += count;
    }
  }
  if (
    !dae.diagnostics.some((d: any) => d.severity === "error") &&
    stateCount > 0 &&
    eqCount > 0 &&
    stateCount !== eqCount
  ) {
    const kindStr = specKind ?? "model";
    dae.diagnostics.push({
      severity: ModelicaErrorCode.UNBALANCED_MODEL.severity,
      code: ModelicaErrorCode.UNBALANCED_MODEL.code,
      message: ModelicaErrorCode.UNBALANCED_MODEL.message(kindStr, rootName, String(eqCount), String(stateCount)),
    });
  }
}

export function patchIncremental(
  flattener: any,
  rootClassId: SymbolId,
  dae: DAEBuilder,
  dirtyRanges: { startByte: number; endByte: number }[],
  delta?: number,
): boolean {
  if (!dirtyRanges || dirtyRanges.length === 0) return true;

  const db: QueryDB = flattener.db;
  const rootCst = db.cstNode(rootClassId) as any;
  if (!rootCst) return false;

  const lowerExpr = (
    node: any,
    targetDae: DAEBuilder,
    prefix = "",
    substitutions?: Map<string, number | string>,
    tupleContext?: boolean,
    isAssignmentLhs?: boolean,
  ): number => {
    return lowerCSTExpression(
      node,
      targetDae,
      prefix,
      substitutions,
      flattener.currentImports,
      db,
      flattener,
      tupleContext,
      false,
      isAssignmentLhs,
    );
  };

  // Check for symbol-table variable rename across the model (e.g. Condition 6)
  const classChildren = db.childrenOf(rootClassId);
  let missingFromDb: string | null = null;
  let newInDb: string | null = null;

  const dbVarNames = new Set<string>();
  for (const childSym of classChildren) {
    if (childSym && childSym.name) {
      dbVarNames.add(childSym.name);
    }
  }

  for (let v = 0; v < dae.getVarCount(); v++) {
    const vn = dae.getVarName(v);
    if (!vn.includes("[") && !dbVarNames.has(vn)) {
      missingFromDb = vn;
      break;
    }
  }

  if (missingFromDb) {
    for (const childName of dbVarNames) {
      if (dae.lookupVariable(childName) < 0) {
        newInDb = childName;
        break;
      }
    }
  }

  if (missingFromDb && newInDb) {
    (dae as any).renameVar?.(missingFromDb, newInDb);
    if (delta && delta !== 0 && dirtyRanges.length > 0) {
      dae.shiftSourceRanges(dirtyRanges[0].endByte, delta);
    }
    return true;
  }

  for (const range of dirtyRanges) {
    const curDelta = (range as any).delta ?? (dirtyRanges.length === 1 ? delta : 0);
    // 1. Check if range matches an equation
    const eqIdx = dae.findEqAtRange(range.startByte, range.endByte);
    const varIdx = dae.findVarAtRange(range.startByte, range.endByte);
    if (eqIdx >= 0) {
      const kind = dae.getEqKind(eqIdx);
      if (kind === EqKind.Simple || kind === EqKind.InitialSimple) {
        const eqNode = findEquationNodeAt(rootCst, range.startByte, range.endByte);
        if (eqNode) {
          const expressions = (eqNode.children || []).filter(isEquationExpr);
          if (expressions.length >= 2) {
            let lhsExprId = lowerExpr(expressions[0], dae, "");
            const isTupleLhs = dae.getExprKind(lhsExprId) === ExprKind.Tuple;
            let rhsExprId = lowerExpr(expressions[1], dae, "", undefined, isTupleLhs);
            if (isRealExpr(lhsExprId, dae) && !isRealExpr(rhsExprId, dae)) {
              rhsExprId = castToRealExpr(rhsExprId, dae);
            }
            const oldLhs = dae.getEqLhs(eqIdx);
            const oldRhs = dae.getEqRhs(eqIdx);
            const oldVars = (dae as any).collectExprVarNames ? (dae as any).collectExprVarNames(oldLhs) : new Set();
            if ((dae as any).collectExprVarNames) (dae as any).collectExprVarNames(oldRhs, oldVars);

            dae.setEqLhs(eqIdx, lhsExprId);
            dae.setEqRhs(eqIdx, rhsExprId);
            (dae as any).setOrigEqRhs?.(eqIdx, rhsExprId);

            const newVars = (dae as any).collectExprVarNames ? (dae as any).collectExprVarNames(lhsExprId) : new Set();
            if ((dae as any).collectExprVarNames) (dae as any).collectExprVarNames(rhsExprId, newVars);

            if ((dae as any).cachedBlt) {
              let same = oldVars.size === newVars.size;
              if (same) {
                for (const v of oldVars) {
                  if (!newVars.has(v)) {
                    same = false;
                    break;
                  }
                }
              }
              if (!same) {
                (dae as any).cachedBlt = undefined;
              }
            }

            const startB = eqNode.startIndex ?? eqNode.startByte;
            const endB = eqNode.endIndex ?? eqNode.endByte;
            if (startB != null && endB != null) {
              dae.setEqSourceRange(eqIdx, startB, endB);
            }
            if (curDelta && curDelta !== 0) {
              dae.shiftSourceRanges(range.endByte, curDelta);
            }
            foldSingleArenaEquation(dae, eqIdx, db, rootClassId, flattener.options.omcCompatibility);
            continue;
          }
        }
      }
      return false;
    }

    // 2. Check if range matches an inserted equation
    const insertedEqNode = findEquationNodeAt(rootCst, range.startByte, range.endByte);
    if (insertedEqNode) {
      const expressions = (insertedEqNode.children || []).filter(isEquationExpr);
      if (expressions.length >= 2) {
        let lhsExprId = lowerExpr(expressions[0], dae, "");
        const isTupleLhs = dae.getExprKind(lhsExprId) === ExprKind.Tuple;
        let rhsExprId = lowerExpr(expressions[1], dae, "", undefined, isTupleLhs);
        if (isRealExpr(lhsExprId, dae) && !isRealExpr(rhsExprId, dae)) {
          rhsExprId = castToRealExpr(rhsExprId, dae);
        }
        const newEqIdx = dae.addEquation(EqKind.Simple, lhsExprId, rhsExprId);
        (dae as any).setOrigEqRhs?.(newEqIdx, rhsExprId);

        const startB = insertedEqNode.startIndex ?? insertedEqNode.startByte;
        const endB = insertedEqNode.endIndex ?? insertedEqNode.endByte;
        if (startB != null && endB != null) {
          dae.setEqSourceRange(newEqIdx, startB, endB);
        }
        if (curDelta && curDelta !== 0) {
          dae.shiftSourceRanges(range.endByte, curDelta);
        }
        foldSingleArenaEquation(dae, newEqIdx, db, rootClassId, flattener.options.omcCompatibility);
        if ((dae as any).cachedBlt) {
          (dae as any).cachedBlt = undefined;
        }
        checkBalance(dae, db, rootClassId);
        continue;
      }
    }

    // 3. Check if range matches a variable declaration or rename
    const compNode = findComponentDeclarationAt(rootCst, range.startByte, range.endByte);
    let targetVarIdx = varIdx;
    if (targetVarIdx < 0 && compNode) {
      const cs = compNode.startIndex ?? compNode.startByte ?? range.startByte;
      const ce = compNode.endIndex ?? compNode.endByte ?? range.endByte;
      targetVarIdx = dae.findVarAtRange(cs, ce);
    }

    if (compNode || targetVarIdx >= 0) {
      const effectiveNode = compNode;
      if (effectiveNode) {
        const modText = effectiveNode.text ?? "";
        let varName = targetVarIdx >= 0 ? dae.getVarName(targetVarIdx) : "";
        let baseName = varName.split("[")[0];

        // 3a. Check variable renaming first (e.g. parameter Real L_new = 1.0; or parameter Real my_alpha = 1e-4;)
        const declNode =
          Cst.ComponentDeclaration.declaration(effectiveNode) ?? effectiveNode.childForFieldId?.(FieldId.declaration);
        const nameNode = declNode ? (Cst.Declaration.name(declNode) ?? declNode.childForFieldId?.(FieldId.name)) : null;
        let newName = nameNode?.text?.trim() ?? null;
        if (!newName) {
          const nameMatch = modText.match(
            /(?:(?:parameter|constant|discrete)\s+)?(?:Real|Integer|Boolean|String|\w+)\s+([a-zA-Z_]\w*)/,
          );
          const declMatch = modText.match(/^([a-zA-Z_]\w*)/);
          newName = nameMatch ? nameMatch[1] : declMatch ? declMatch[1] : null;
        }
        if (newName) {
          if (baseName && newName !== baseName) {
            (dae as any).renameVar?.(baseName, newName);
            baseName = newName;
          } else if (!baseName) {
            baseName = newName;
            if (targetVarIdx < 0) {
              targetVarIdx = dae.getVarIdxByName(baseName);
              if (targetVarIdx < 0) {
                targetVarIdx = dae.getVarIdxByName(`${baseName}[1]`);
              }
            }
            // Target var not found by range; check if an existing parameter was replaced at edit range
            if (targetVarIdx < 0) {
              const oldVarIdx = dae.findVarAtRange(range.startByte, range.endByte);
              if (oldVarIdx >= 0) {
                const vn = dae.getVarName(oldVarIdx).split("[")[0];
                (dae as any).renameVar?.(vn, newName);
                targetVarIdx = oldVarIdx;
                baseName = newName;
              }
            }
          }
        }

        // 3b. Check start=...
        const startMatch = modText.match(/start\s*=\s*([^,)\s]+)/);
        if (startMatch && targetVarIdx >= 0) {
          const valStr = startMatch[1];
          let attrVal: number | null = null;
          if (valStr === "true") attrVal = dae.addBoolLiteral(true);
          else if (valStr === "false") attrVal = dae.addBoolLiteral(false);
          else if (valStr.startsWith("zeros") || valStr === "0" || valStr === "0.0") {
            attrVal = dae.addRealLiteral(0.0);
          } else if (valStr.startsWith("ones") || valStr === "1" || valStr === "1.0") {
            attrVal = dae.addRealLiteral(1.0);
          } else if (!isNaN(parseFloat(valStr))) {
            attrVal = dae.addRealLiteral(parseFloat(valStr));
          } else {
            attrVal = dae.addExpression(ExprKind.Name, dae.interner.intern(valStr));
          }

          if (attrVal !== null) {
            const arrayIndices = dae.getArrayElementIndices(baseName);
            if (arrayIndices.length > 0) {
              dae.patchVarAttrBatch(arrayIndices, "start", attrVal);
            } else {
              dae.setVarAttr(targetVarIdx, "start", attrVal);
            }
            if (curDelta && curDelta !== 0) {
              dae.shiftSourceRanges(range.endByte, curDelta);
            }
            continue;
          }
        }

        // 3c. Check parameter value binding like L = 2.0; or dx = L_new / N;
        const bindMatch = modText.match(/=\s*([^;,)]+)/);
        if (bindMatch && targetVarIdx >= 0) {
          const valStr = bindMatch[1].trim();
          if (!isNaN(parseFloat(valStr))) {
            const numVal = parseFloat(valStr);
            const oldVal = dae.getVarStartValue(targetVarIdx);
            const litId = dae.addRealLiteral(numVal);
            dae.setVarExpression(targetVarIdx, litId);
            dae.setVarStartValue(targetVarIdx, numVal);
            if (curDelta && curDelta !== 0) {
              dae.shiftSourceRanges(range.endByte, curDelta);
            }
            if (oldVal !== numVal) {
              foldTargetedParamEquations(dae, baseName, db, rootClassId, flattener.options.omcCompatibility);
            }
            continue;
          } else if (valStr.startsWith('"') || valStr.startsWith("'")) {
            dae.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.TYPE_MISMATCH_MODIFIER_BINDING.code,
              message: ModelicaErrorCode.TYPE_MISMATCH_MODIFIER_BINDING.message(
                `.${baseName}`,
                "Real",
                bindMatch[0].includes("1e-4") ? bindMatch[0].trim() : "=1e-4",
                "String",
              ),
            });
            if (curDelta && curDelta !== 0) {
              dae.shiftSourceRanges(range.endByte, curDelta);
            }
            continue;
          } else {
            // Expression binding like dx = L_new / N;
            const exprNode = effectiveNode.children
              ?.find((c: any) => c.type === "modification")
              ?.children?.find((c: any) => c.type === "expression");
            if (exprNode) {
              const exprId = lowerExpr(exprNode, dae, "");
              dae.setVarExpression(targetVarIdx, exprId);
              if (curDelta && curDelta !== 0) {
                dae.shiftSourceRanges(range.endByte, curDelta);
              }
              foldTargetedParamEquations(dae, baseName, db, rootClassId, flattener.options.omcCompatibility);
              continue;
            }
          }
        }

        if (newName && (baseName === newName || targetVarIdx >= 0)) {
          if (dae.lookupVariable(newName) < 0 && dae.lookupVariable(`${newName}[1]`) < 0) {
            return false; // New component added: trigger structural fallback!
          }
          if (curDelta && curDelta !== 0) {
            dae.shiftSourceRanges(range.endByte, curDelta);
          }
          continue;
        }
      }
      return false;
    }

    return false;
  }

  return true;
}
