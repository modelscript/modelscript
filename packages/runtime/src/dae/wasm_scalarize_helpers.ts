// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Array, matrix, and record structural inspection and element/field extraction
 * helpers supporting {@link scalarizeArena}.
 */

import { evaluateConstantArenaExpression } from "./wasm_const_eval.js";
import { BinOp, Causality, DAEBuilder, EqKind, ExprKind, VarType } from "./wasm_dae.js";
import {
  type DAEBuilderFoldExtensions,
  generateIndices,
  getArrayCtorElement,
  isLiteralZero,
  lookupRecordFunctionInDae,
} from "./wasm_fold_helpers.js";

/**
 * Checks if the DAE contains any array or record equations that need to be scalarized.
 */
export function hasArrayEquations(dae: DAEBuilder): boolean {
  let compositePrefixes: Set<string> | null = null;
  const getCompositePrefixes = (): Set<string> => {
    if (compositePrefixes) return compositePrefixes;
    compositePrefixes = new Set<string>();
    for (let i = 0; i < dae.varCount; i++) {
      if (dae.isVarRemoved(i)) continue;
      const vName = dae.getVarName(i);
      let dotPos = vName.indexOf(".");
      while (dotPos > 0) {
        compositePrefixes.add(vName.slice(0, dotPos));
        dotPos = vName.indexOf(".", dotPos + 1);
      }
    }
    return compositePrefixes;
  };

  const isComposite = (exprId: number): boolean => {
    if (exprId < 0) return false;
    const k = dae.getExprKind(exprId);
    if (k === ExprKind.ArrayCtor) return true;
    if (k === ExprKind.Call && isComplexRecordCall(dae, exprId)) return true;
    if (k === ExprKind.Name) {
      const name = dae.interner.resolve(dae.getExprData1(exprId));
      if (name) {
        if (dae.getVarIdxByName(`${name}[1]`) >= 0) return true;
        const vIdx = dae.getVarIdxByName(name);
        if (vIdx >= 0 && dae.getVarShape(vIdx).length > 0) return true;
        if (vIdx < 0 && getCompositePrefixes().has(name)) {
          return true;
        }
      }
    }
    if (k === ExprKind.Der || k === ExprKind.Pre) {
      return isComposite(dae.getExprData1(exprId));
    }
    return false;
  };

  for (let e = 0; e < dae.exprCount; e++) {
    if (dae.getExprKind(e) === ExprKind.Call) {
      const fnName = dae.interner.resolve(dae.getExprData1(e)) || "";
      if (
        fnName === "Complex" ||
        fnName.startsWith("Complex.") ||
        fnName.startsWith("Modelica.ComplexMath.") ||
        fnName.startsWith("ComplexMath.")
      ) {
        return true;
      }
      if (dae.functions.size > 0 && lookupRecordFunctionInDae(dae, fnName)) {
        return true;
      }
    }
  }

  for (let i = 0; i < dae.eqCount; i++) {
    const kind = dae.getEqKind(i);
    if (kind === EqKind.Array || kind === EqKind.For || kind === EqKind.InitialFor) return true;
    if (kind === EqKind.Simple || kind === EqKind.InitialSimple) {
      const lhs = dae.getEqLhs(i);
      const rhs = dae.getEqRhs(i);
      if (isComposite(lhs) || isComposite(rhs)) return true;
    } else if (kind === EqKind.If) {
      const meta = dae.getIfEquationMeta(i);
      if (meta) {
        for (const eq of meta.thenEquations) {
          if (isComposite(eq.lhsExprId) || isComposite(eq.rhsExprId)) return true;
        }
        for (const clause of meta.elseIfClauses) {
          for (const eq of clause.bodyEquations) {
            if (isComposite(eq.lhsExprId) || isComposite(eq.rhsExprId)) return true;
          }
        }
        if (meta.elseEquations) {
          for (const eq of meta.elseEquations) {
            if (isComposite(eq.lhsExprId) || isComposite(eq.rhsExprId)) return true;
          }
        }
      }
    } else if (kind === EqKind.When) {
      const meta = dae.getWhenEquationMeta(i);
      if (meta) {
        for (const eq of meta.bodyEquations) {
          if (isComposite(eq.lhsExprId) || isComposite(eq.rhsExprId)) return true;
        }
      }
    }
  }
  return false;
}

export function getArrayElements(dae: DAEBuilder, exprId: number): number[] | null {
  if (exprId < 0) return null;
  const kind = dae.getExprKind(exprId);
  if (kind === ExprKind.ArrayCtor) {
    const count = dae.getExprData1(exprId);
    const elements: number[] = [];
    for (let i = 0; i < count; i++) {
      elements.push(i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i));
    }
    let hasNested = false;
    for (const e of elements) {
      if (dae.getExprKind(e) === ExprKind.ArrayCtor || getArrayElements(dae, e) !== null) {
        hasNested = true;
        break;
      }
    }
    if (hasNested) {
      const flattened: number[] = [];
      for (const e of elements) {
        const sub = getArrayElements(dae, e);
        if (sub) flattened.push(...sub);
        else flattened.push(e);
      }
      return flattened;
    }
    return elements;
  }
  if (kind === ExprKind.Name) {
    const name = dae.interner.resolve(dae.getExprData1(exprId));
    if (name) {
      const vIdx = dae.getVarIdxByName(name);
      if (vIdx >= 0) {
        const shape = dae.getVarShape(vIdx);
        if (shape.length > 0) {
          const indices = generateIndices(shape);
          const elements: number[] = [];
          for (const idx of indices) {
            elements.push(dae.addExpression(ExprKind.Name, dae.interner.intern(`${name}[${idx.join(",")}]`)));
          }
          return elements;
        }
        return null;
      }
      if (dae.getVarIdxByName(`${name}[1,1]`) >= 0) {
        let rows = 0;
        while (dae.getVarIdxByName(`${name}[${rows + 1},1]`) >= 0) rows++;
        let cols = 0;
        while (dae.getVarIdxByName(`${name}[1,${cols + 1}]`) >= 0) cols++;
        const elements: number[] = [];
        for (let r = 1; r <= rows; r++) {
          for (let c = 1; c <= cols; c++) {
            elements.push(dae.addExpression(ExprKind.Name, dae.interner.intern(`${name}[${r},${c}]`)));
          }
        }
        return elements;
      }
      if (dae.getVarIdxByName(`${name}[1]`) >= 0) {
        const elements: number[] = [];
        let k = 1;
        while (dae.getVarIdxByName(`${name}[${k}]`) >= 0) {
          elements.push(dae.addExpression(ExprKind.Name, dae.interner.intern(`${name}[${k}]`)));
          k++;
        }
        return elements;
      }
      const indexed = dae.baseArrayIndices.get(name);
      if (indexed && indexed.length > 0) {
        const prefixMatch = `${name}[`;
        const elements: number[] = [];
        for (const v of indexed) {
          if (dae.isVarRemoved(v)) continue;
          const vName = dae.getVarName(v);
          if (vName.startsWith(prefixMatch) && vName.endsWith("]")) {
            elements.push(dae.addExpression(ExprKind.Name, dae.interner.intern(vName)));
          }
        }
        if (elements.length > 0) return elements;
      }
    }
  }
  if (kind === ExprKind.Der) {
    const inner = dae.getExprData1(exprId);
    const innerElems = getArrayElements(dae, inner);
    if (innerElems) {
      return innerElems.map((e) => dae.addDerExpr(e));
    }
  }
  if (kind === ExprKind.Pre) {
    const inner = dae.getExprData1(exprId);
    const innerElems = getArrayElements(dae, inner);
    if (innerElems) {
      return innerElems.map((e) => dae.addPreExpr(e));
    }
  }
  if (kind === ExprKind.Negate) {
    const inner = dae.getExprLeft(exprId);
    const innerElems = getArrayElements(dae, inner);
    if (innerElems) {
      return innerElems.map((e) => dae.addExpression(ExprKind.Negate, 0, e));
    }
  }
  if (kind === ExprKind.Unary) {
    const op = dae.getExprData1(exprId);
    const inner = dae.getExprLeft(exprId);
    const innerElems = getArrayElements(dae, inner);
    if (innerElems) {
      return innerElems.map((e) => dae.addUnaryExpr(op, e));
    }
  }
  if (kind === ExprKind.Subscript) {
    const baseId = dae.getExprData1(exprId);
    const baseKind = dae.getExprKind(baseId);
    if (baseKind === ExprKind.Name) {
      const baseName = dae.interner.resolve(dae.getExprData1(baseId));
      if (baseName) {
        const scount = Math.max(1, dae.getExprRight(exprId));
        let shape: number[] = [];
        const vIdx = dae.getVarIdxByName(baseName);
        if (vIdx >= 0) {
          shape = dae.getVarShape(vIdx);
        }
        if (shape.length === 0) {
          const prefixMatch = `${baseName}[`;
          const maxDims: number[] = [];
          const candidateIndices =
            typeof dae.getArrayElementIndices === "function" ? dae.getArrayElementIndices(baseName) : null;
          if (candidateIndices && candidateIndices.length > 0) {
            for (const v of candidateIndices) {
              if (dae.isVarRemoved(v)) continue;
              const vName = dae.getVarName(v);
              if (vName.startsWith(prefixMatch) && vName.endsWith("]")) {
                const idxParts = vName.slice(prefixMatch.length, -1).split(",").map(Number);
                for (let d = 0; d < idxParts.length; d++) {
                  if (idxParts[d]! > (maxDims[d] ?? 0)) {
                    maxDims[d] = idxParts[d]!;
                  }
                }
              }
            }
          } else if (!candidateIndices) {
            for (let v = 0; v < dae.varCount; v++) {
              if (dae.isVarRemoved(v)) continue;
              const vName = dae.getVarName(v);
              if (vName.startsWith(prefixMatch) && vName.endsWith("]")) {
                const idxParts = vName.slice(prefixMatch.length, -1).split(",").map(Number);
                for (let d = 0; d < idxParts.length; d++) {
                  if (idxParts[d]! > (maxDims[d] ?? 0)) {
                    maxDims[d] = idxParts[d]!;
                  }
                }
              }
            }
          }
          if (maxDims.length > 0) {
            shape = maxDims;
          }
        }

        const dimRanges: number[][] = [];
        let hasSlice = false;
        for (let i = 0; i < scount; i++) {
          const subExpr = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
          const subKind = dae.getExprKind(subExpr);
          const isColon =
            subKind === ExprKind.Colon ||
            (subKind === ExprKind.Name && dae.interner.resolve(dae.getExprData1(subExpr)) === ":");
          if (isColon) {
            hasSlice = true;
            const maxVal = i < shape.length ? shape[i]! : 1;
            const vals: number[] = [];
            for (let v = 1; v <= maxVal; v++) vals.push(v);
            dimRanges.push(vals);
          } else {
            const val = evaluateConstantArenaExpression(dae, subExpr);
            if (typeof val === "number") {
              dimRanges.push([Math.trunc(val)]);
            } else if (Array.isArray(val)) {
              hasSlice = true;
              dimRanges.push(val.map((x) => Math.trunc(Number(x))));
            } else {
              return null;
            }
          }
        }

        if (hasSlice) {
          const generateCartesian = (ranges: number[][]): number[][] => {
            if (ranges.length === 0) return [[]];
            const head = ranges[0]!;
            const rest = generateCartesian(ranges.slice(1));
            const res: number[][] = [];
            for (const h of head) {
              for (const r of rest) {
                res.push([h, ...r]);
              }
            }
            return res;
          };
          const tuples = generateCartesian(dimRanges);
          const elements: number[] = [];
          for (const t of tuples) {
            elements.push(dae.addExpression(ExprKind.Name, dae.interner.intern(`${baseName}[${t.join(",")}]`)));
          }
          return elements;
        }
      }
    }
  }
  return null;
}

function isComplexRecordCall(dae: DAEBuilder, exprId: number): boolean {
  if (exprId < 0 || dae.getExprKind(exprId) !== ExprKind.Call) return false;
  const fnName = dae.interner.resolve(dae.getExprData1(exprId)) || "";
  if (fnName.startsWith("Complex.'=='") || fnName.startsWith("Complex.'<>'")) return false;
  return (
    fnName === "Complex" ||
    fnName.startsWith("Complex.") ||
    fnName === "Modelica.ComplexMath.conj" ||
    fnName === "Modelica.ComplexMath.fromPolar" ||
    fnName === "Modelica.ComplexMath.exp" ||
    fnName === "Modelica.ComplexMath.sqrt"
  );
}

export interface RecordFieldIndex {
  exactFields: Map<string, string[]>;
  arrayElemFields: Map<string, string[]>;
  streamPrefixes: Set<string>;
}

export function buildRecordFieldIndex(dae: DAEBuilder): RecordFieldIndex {
  const exactFields = new Map<string, string[]>();
  const arrayElemFields = new Map<string, string[]>();
  const streamPrefixes = new Set<string>();

  for (let i = 0; i < dae.varCount; i++) {
    if (dae.isVarRemoved(i)) continue;
    const vName = dae.getVarName(i);
    if (!vName.includes(".")) continue;
    const isStream = dae.isVarStream(i);

    let bracketDepth = 0;
    for (let c = 0; c < vName.length; c++) {
      const ch = vName.charCodeAt(c);
      if (ch === 91 /* '[' */) {
        bracketDepth++;
      } else if (ch === 93 /* ']' */) {
        if (bracketDepth > 0) bracketDepth--;
      } else if (ch === 46 /* '.' */ && bracketDepth === 0) {
        const pfx = vName.slice(0, c);
        const rest = vName.slice(c + 1);
        if (!rest) continue;
        let list = exactFields.get(pfx);
        if (!list) {
          list = [];
          exactFields.set(pfx, list);
        }
        list.push(rest);

        if (pfx.includes("[")) {
          const stripped = pfx.replace(/\[[^\][]*\]/g, "");
          if (stripped && stripped !== pfx) {
            let arrList = arrayElemFields.get(stripped);
            if (!arrList) {
              arrList = [];
              arrayElemFields.set(stripped, arrList);
            }
            if (!arrList.includes(rest)) {
              arrList.push(rest);
            }
          }
        }
        if (isStream) {
          streamPrefixes.add(pfx);
        }
      }
    }
  }

  return { exactFields, arrayElemFields, streamPrefixes };
}

export function getRecordFields(
  dae: DAEBuilder,
  exprId: number,
  expandOperatorRecords = false,
  recordIndex?: RecordFieldIndex,
): string[] | null {
  if (exprId < 0) return null;
  const kind = dae.getExprKind(exprId);
  if (expandOperatorRecords && kind === ExprKind.Call && isComplexRecordCall(dae, exprId)) {
    return ["re", "im"];
  }
  if (kind === ExprKind.Name) {
    const name = dae.interner.resolve(dae.getExprData1(exprId));
    if (name && dae.getVarIdxByName(name) < 0) {
      if (recordIndex) {
        const baseName = name.replace(/\[[^\][]*\]/g, "");
        const exact = recordIndex.exactFields.get(name);
        const baseExact = baseName !== name ? recordIndex.exactFields.get(baseName) : undefined;
        const arrElem = recordIndex.arrayElemFields.get(baseName);
        if (!exact && !baseExact && !arrElem) return null;
        const seen = new Set<string>();
        if (exact) for (const f of exact) seen.add(f);
        if (baseExact) for (const f of baseExact) seen.add(f);
        if (arrElem) for (const f of arrElem) seen.add(f);
        return seen.size > 0 ? Array.from(seen) : null;
      }
      const prefix = `${name}.`;
      const baseName = name.replace(/\[[^\][]*\]/g, "");
      const basePrefix = `${baseName}.`;
      const fields: string[] = [];
      for (let i = 0; i < dae.varCount; i++) {
        if (dae.isVarRemoved(i)) continue;
        const vName = dae.getVarName(i);
        if (vName.startsWith(prefix)) {
          fields.push(vName.slice(prefix.length));
        } else if (basePrefix !== prefix && vName.startsWith(basePrefix)) {
          fields.push(vName.slice(basePrefix.length));
        } else if (vName.startsWith(baseName + "[")) {
          let rest = vName.slice(baseName.length);
          while (rest.startsWith("[")) {
            const closeIdx = rest.indexOf("]");
            if (closeIdx < 0) break;
            rest = rest.slice(closeIdx + 1);
          }
          if (rest.startsWith(".") && rest.length > 1) {
            fields.push(rest.slice(1));
          }
        }
      }
      if (fields.length > 0) return Array.from(new Set(fields));
    }
  }
  if (kind === ExprKind.Subscript) {
    return getRecordFields(dae, dae.getExprData1(exprId), expandOperatorRecords, recordIndex);
  }
  if (kind === ExprKind.IfElse) {
    return (
      getRecordFields(dae, dae.getExprLeft(exprId), expandOperatorRecords, recordIndex) ||
      getRecordFields(dae, dae.getExprRight(exprId), expandOperatorRecords, recordIndex)
    );
  }
  return null;
}

export function isRecordConstructorCall(dae: DAEBuilder, exprId: number): boolean {
  if (exprId < 0 || dae.getExprKind(exprId) !== ExprKind.Call) return false;
  const rawFnName = dae.interner.resolve(dae.getExprData1(exprId));
  const fn = lookupRecordFunctionInDae(dae, rawFnName);
  if (
    !dae.extensionMetadata?.["isOldFrontend"] &&
    fn &&
    ((fn as DAEBuilder & DAEBuilderFoldExtensions).isOperatorRecord || fn.extensionMetadata?.isOperatorRecord)
  ) {
    return false;
  }
  if (fn && fn.description && fn.description.startsWith("Automatically generated record constructor")) {
    return true;
  }
  return false;
}

export function getFieldExpr(
  dae: DAEBuilder,
  out: DAEBuilder,
  exprId: number,
  field: string,
  cloneExpr?: (id: number, suffix: string, shape: number[] | null) => number,
  expandOperatorRecords = false,
): number {
  if (exprId < 0) return exprId;
  const kind = dae.getExprKind(exprId);
  switch (kind) {
    case ExprKind.Name: {
      const name = dae.interner.resolve(dae.getExprData1(exprId));
      if (
        (field === "re" || field === "im") &&
        (name === "Modelica.ComplexMath.j" || name === "ComplexMath.j" || name?.endsWith(".ComplexMath.j"))
      ) {
        return out.addRealLiteral(field === "re" ? 0.0 : 1.0);
      }
      if (
        expandOperatorRecords &&
        (field === "re" || field === "im") &&
        name &&
        dae.getVarIdxByName(`${name}.re`) < 0 &&
        dae.getVarIdxByName(`${name}.im`) < 0 &&
        dae.getVarIdxByName(name) >= 0
      ) {
        return field === "re" ? out.addNameExpr(name) : out.addRealLiteral(0.0);
      }
      const candidate = `${name}.${field}`;
      if (name && out.getVarIdxByName(candidate) < 0 && dae.getVarIdxByName(candidate) < 0 && name.endsWith("]")) {
        const m = /^(.+)(\[[^\][]+])$/.exec(name);
        if (m) {
          const transposed = `${m[1]}.${field}${m[2]}`;
          if (out.getVarIdxByName(transposed) >= 0 || dae.getVarIdxByName(`${m[1]}.${field}`) >= 0) {
            return out.addNameExpr(transposed);
          }
        }
      }
      return out.addNameExpr(candidate);
    }
    case ExprKind.Call: {
      const rawFnName = dae.interner.resolve(dae.getExprData1(exprId)) || "";
      if (expandOperatorRecords && (field === "re" || field === "im")) {
        const argCount = dae.getExprRight(exprId);
        const getArg = (idx: number) => (idx === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + idx));
        const cloneScalar = (id: number) => (cloneExpr ? cloneExpr(id, "", null) : id);
        const getRe = (id: number) => getFieldExpr(dae, out, id, "re", cloneExpr, true);
        const getIm = (id: number) => getFieldExpr(dae, out, id, "im", cloneExpr, true);
        if (rawFnName === "Complex" || rawFnName === "Complex.'constructor'.fromReal") {
          if (field === "re") return argCount >= 1 ? cloneScalar(getArg(0)) : out.addRealLiteral(0);
          return argCount >= 2 ? cloneScalar(getArg(1)) : out.addRealLiteral(0);
        }
        if (rawFnName === "Complex.'0'") {
          return out.addRealLiteral(0);
        }
        if ((rawFnName === "Complex.'+'.add" || rawFnName === "Complex.'+'") && argCount >= 2) {
          return out.addBinaryExpr(
            BinOp.Add,
            getFieldExpr(dae, out, getArg(0), field, cloneExpr, true),
            getFieldExpr(dae, out, getArg(1), field, cloneExpr, true),
          );
        }
        if ((rawFnName === "Complex.'-'.subtract" || (rawFnName === "Complex.'-'" && argCount >= 2)) && argCount >= 2) {
          return out.addBinaryExpr(
            BinOp.Sub,
            getFieldExpr(dae, out, getArg(0), field, cloneExpr, true),
            getFieldExpr(dae, out, getArg(1), field, cloneExpr, true),
          );
        }
        if ((rawFnName === "Complex.'-'.negate" || (rawFnName === "Complex.'-'" && argCount === 1)) && argCount >= 1) {
          return out.addExpression(ExprKind.Negate, 0, getFieldExpr(dae, out, getArg(0), field, cloneExpr, true));
        }
        if ((rawFnName === "Complex.'*'.multiply" || rawFnName === "Complex.'*'") && argCount >= 2) {
          const aRe = getRe(getArg(0));
          const aIm = getIm(getArg(0));
          const bRe = getRe(getArg(1));
          const bIm = getIm(getArg(1));
          if (field === "re") {
            return out.addBinaryExpr(
              BinOp.Sub,
              out.addBinaryExpr(BinOp.Mul, aRe, bRe),
              out.addBinaryExpr(BinOp.Mul, aIm, bIm),
            );
          }
          return out.addBinaryExpr(
            BinOp.Add,
            out.addBinaryExpr(BinOp.Mul, aRe, bIm),
            out.addBinaryExpr(BinOp.Mul, aIm, bRe),
          );
        }
        if ((rawFnName === "Complex.'/'.divide" || rawFnName === "Complex.'/'") && argCount >= 2) {
          const aRe = getRe(getArg(0));
          const aIm = getIm(getArg(0));
          const bRe = getRe(getArg(1));
          const bIm = getIm(getArg(1));
          const denom = out.addBinaryExpr(
            BinOp.Add,
            out.addBinaryExpr(BinOp.Mul, bRe, bRe),
            out.addBinaryExpr(BinOp.Mul, bIm, bIm),
          );
          if (field === "re") {
            const numRe = out.addBinaryExpr(
              BinOp.Add,
              out.addBinaryExpr(BinOp.Mul, aRe, bRe),
              out.addBinaryExpr(BinOp.Mul, aIm, bIm),
            );
            return out.addBinaryExpr(BinOp.Div, numRe, denom);
          }
          const numIm = out.addBinaryExpr(
            BinOp.Sub,
            out.addBinaryExpr(BinOp.Mul, aIm, bRe),
            out.addBinaryExpr(BinOp.Mul, aRe, bIm),
          );
          return out.addBinaryExpr(BinOp.Div, numIm, denom);
        }
        if ((rawFnName === "Modelica.ComplexMath.conj" || rawFnName === "ComplexMath.conj") && argCount >= 1) {
          if (field === "re") return getRe(getArg(0));
          return out.addExpression(ExprKind.Negate, 0, getIm(getArg(0)));
        }
        if (
          (rawFnName === "Modelica.ComplexMath.fromPolar" || rawFnName === "ComplexMath.fromPolar") &&
          argCount >= 2
        ) {
          const lenExpr = cloneScalar(getArg(0));
          const phiExpr = cloneScalar(getArg(1));
          return out.addBinaryExpr(BinOp.Mul, lenExpr, out.addCallExpr(field === "re" ? "cos" : "sin", [phiExpr]));
        }
        if ((rawFnName === "Modelica.ComplexMath.exp" || rawFnName === "ComplexMath.exp") && argCount >= 1) {
          const aRe = getRe(getArg(0));
          const aIm = getIm(getArg(0));
          return out.addBinaryExpr(
            BinOp.Mul,
            out.addCallExpr("exp", [aRe]),
            out.addCallExpr(field === "re" ? "cos" : "sin", [aIm]),
          );
        }
      }
      const fn = lookupRecordFunctionInDae(dae, rawFnName);
      if (fn && cloneExpr) {
        const argCount = dae.getExprRight(exprId);
        let paramIdx = 0;
        for (let p = 0; p < fn.varCount; p++) {
          if (fn.getVarCausality(p) === Causality.Input) {
            const pName = fn.getVarName(p);
            if (pName === field) {
              if (paramIdx < argCount) {
                const argExprId = paramIdx === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + paramIdx);
                if (fn.getVarType(p) === VarType.Real && dae.getExprKind(argExprId) === ExprKind.IntLiteral) {
                  return out.addRealLiteral(dae.getExprData1(argExprId));
                }
                return cloneExpr(argExprId, "", null);
              }
            } else if (field.startsWith(`${pName}[`) && field.endsWith("]")) {
              if (paramIdx < argCount) {
                const argExprId = paramIdx === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + paramIdx);
                const idx = field
                  .slice(pName.length + 1, -1)
                  .split(",")
                  .map(Number);
                if (idx.length > 0 && idx.every((n) => !Number.isNaN(n) && n >= 1)) {
                  const elemExprId = getArrayCtorElement(dae, argExprId, idx);
                  if (elemExprId >= 0) {
                    if (fn.getVarType(p) === VarType.Real && dae.getExprKind(elemExprId) === ExprKind.IntLiteral) {
                      return out.addRealLiteral(dae.getExprData1(elemExprId));
                    }
                    return cloneExpr(elemExprId, "", null);
                  }
                  const elems = getArrayElements(dae, argExprId);
                  if (elems) {
                    const shape = fn.getVarShape(p);
                    if (shape.length === idx.length) {
                      const indices = generateIndices(shape);
                      const flatIdx = indices.findIndex((t) => t.every((v, i) => v === idx[i]));
                      if (flatIdx >= 0 && flatIdx < elems.length) {
                        const eId = elems[flatIdx]!;
                        if (fn.getVarType(p) === VarType.Real && dae.getExprKind(eId) === ExprKind.IntLiteral) {
                          return out.addRealLiteral(dae.getExprData1(eId));
                        }
                        return cloneExpr(eId, "", null);
                      }
                    }
                  }
                }
              }
            } else if (field.startsWith(`${pName}.`)) {
              if (paramIdx < argCount) {
                const argExprId = paramIdx === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + paramIdx);
                return getFieldExpr(
                  dae,
                  out,
                  argExprId,
                  field.slice(pName.length + 1),
                  cloneExpr,
                  expandOperatorRecords,
                );
              }
            }
            paramIdx++;
          }
        }
      }
      return cloneExpr ? cloneExpr(exprId, "", null) : exprId;
    }
    case ExprKind.IfElse: {
      const cond = cloneExpr ? cloneExpr(dae.getExprData1(exprId), "", null) : dae.getExprData1(exprId);
      const thenBranch = getFieldExpr(dae, out, dae.getExprLeft(exprId), field, cloneExpr, expandOperatorRecords);
      const elseBranch = getFieldExpr(dae, out, dae.getExprRight(exprId), field, cloneExpr, expandOperatorRecords);
      return out.addIfElseExpr(cond, thenBranch, elseBranch);
    }
    case ExprKind.Der: {
      const inner = getFieldExpr(dae, out, dae.getExprData1(exprId), field, cloneExpr, expandOperatorRecords);
      return out.addDerExpr(inner);
    }
    case ExprKind.Negate: {
      const inner = getFieldExpr(dae, out, dae.getExprLeft(exprId), field, cloneExpr, expandOperatorRecords);
      return out.addExpression(ExprKind.Negate, 0, inner);
    }
    case ExprKind.Unary: {
      const op = dae.getExprData1(exprId);
      const inner = getFieldExpr(dae, out, dae.getExprLeft(exprId), field, cloneExpr, expandOperatorRecords);
      return out.addUnaryExpr(op, inner);
    }
    case ExprKind.Subscript: {
      const baseId = dae.getExprData1(exprId);
      const subCount = dae.getExprRight(exprId);
      const subs: number[] = [];
      for (let i = 0; i < subCount; i++) {
        const rawSub = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
        subs.push(cloneExpr ? cloneExpr(rawSub, "", null) : rawSub);
      }
      if (
        dae.getExprKind(baseId) === ExprKind.Name &&
        subs.length > 0 &&
        subs.every((s) => out.getExprKind(s) === ExprKind.IntLiteral)
      ) {
        const baseName = dae.interner.resolve(dae.getExprData1(baseId));
        if (baseName) {
          const idxStr = subs.map((s) => out.getExprData1(s)).join(",");
          const candidate = `${baseName}[${idxStr}].${field}`;
          if (out.getVarIdxByName(candidate) >= 0 || dae.getVarIdxByName(candidate) >= 0) {
            return out.addNameExpr(candidate);
          }
          const transposed = `${baseName}.${field}[${idxStr}]`;
          if (out.getVarIdxByName(transposed) >= 0 || dae.getVarIdxByName(`${baseName}.${field}`) >= 0) {
            return out.addNameExpr(transposed);
          }
        }
      }
      const target = getFieldExpr(dae, out, baseId, field, cloneExpr, expandOperatorRecords);
      return out.addSubscriptExpr(target, subs);
    }
    default:
      if (
        expandOperatorRecords &&
        field === "im" &&
        (kind === ExprKind.RealLiteral || kind === ExprKind.IntLiteral || kind === ExprKind.Binary)
      ) {
        return out.addRealLiteral(0.0);
      }
      return cloneExpr ? cloneExpr(exprId, "", null) : exprId;
  }
}

function evalConstantNum(dae: DAEBuilder, exprId: number): number | null {
  const val = evaluateConstantArenaExpression(dae, exprId);
  if (typeof val === "number") return val;
  return null;
}

export function getMatrixDimensions(
  dae: DAEBuilder,
  exprId: number,
  isInnerRow = false,
): { rows: number; cols: number } | null {
  if (exprId < 0) return null;
  const kind = dae.getExprKind(exprId);
  switch (kind) {
    case ExprKind.Name: {
      const name = dae.interner.resolve(dae.getExprData1(exprId));
      if (!name) return null;
      if (dae.getVarIdxByName(`${name}[1,1]`) >= 0) {
        let rows = 0;
        while (dae.getVarIdxByName(`${name}[${rows + 1},1]`) >= 0) rows++;
        let cols = 0;
        while (dae.getVarIdxByName(`${name}[1,${cols + 1}]`) >= 0) cols++;
        if (rows > 0 && cols > 0) return { rows, cols };
      }
      const vIdx = dae.getVarIdxByName(name);
      if (vIdx >= 0) {
        const shape = dae.getVarShape(vIdx);
        if (shape.length === 2) return { rows: shape[0]!, cols: shape[1]! };
        if (shape.length === 1) return { rows: shape[0]!, cols: 1 };
      }
      if (dae.getVarIdxByName(`${name}[1]`) >= 0) {
        let count = 0;
        while (dae.getVarIdxByName(`${name}[${count + 1}]`) >= 0) count++;
        if (count > 0) return { rows: count, cols: 1 };
      }
      return null;
    }
    case ExprKind.Call: {
      const fnName = dae.interner.resolve(dae.getExprData1(exprId));
      if (fnName === "/*Real*/" || fnName === "Real") {
        return getMatrixDimensions(dae, dae.getExprLeft(exprId), isInnerRow);
      }
      if (fnName === "transpose") {
        const inner = dae.getExprLeft(exprId);
        const innerDims = getMatrixDimensions(dae, inner, false);
        if (innerDims) {
          return { rows: innerDims.cols, cols: innerDims.rows };
        }
        return null;
      }
      if (fnName === "zeros" || fnName === "ones") {
        const argCount = dae.getExprRight(exprId);
        if (argCount >= 2) {
          const r = evalConstantNum(dae, dae.getExprLeft(exprId));
          const c = evalConstantNum(dae, dae.getExprLeft(exprId + 1));
          if (r !== null && c !== null && r > 0 && c > 0) {
            return { rows: Math.trunc(r), cols: Math.trunc(c) };
          }
        } else if (argCount === 1) {
          const n = evalConstantNum(dae, dae.getExprLeft(exprId));
          if (n !== null && n > 0) {
            return { rows: Math.trunc(n), cols: 1 };
          }
        }
      }
      return null;
    }
    case ExprKind.ArrayCtor: {
      const count = dae.getExprData1(exprId);
      if (count <= 0) return null;
      const elems = getArrayElements(dae, exprId);
      if (!elems || elems.length === 0) return null;

      if (isInnerRow) {
        return { rows: 1, cols: count };
      }

      const hasArrayOrMatrixChild = elems.some((e) => {
        const k = dae.getExprKind(e);
        if (k === ExprKind.ArrayCtor) return true;
        if (k === ExprKind.Call) {
          const fn = dae.interner.resolve(dae.getExprData1(e));
          if (fn === "zeros" || fn === "ones" || fn === "transpose" || fn === "/*Real*/" || fn === "Real") return true;
        }
        return false;
      });

      if (hasArrayOrMatrixChild) {
        let totalRows = 0;
        let maxCols = 1;
        for (const elem of elems) {
          const d = getMatrixDimensions(dae, elem, true);
          if (d) {
            totalRows += d.rows;
            if (d.cols > maxCols) maxCols = d.cols;
          } else {
            totalRows += 1;
          }
        }
        return { rows: totalRows, cols: maxCols };
      }

      return { rows: count, cols: 1 };
    }
    default:
      return null;
  }
}

export function getMatrixElement(
  dae: DAEBuilder,
  exprId: number,
  row: number,
  col: number,
  isInnerRow = false,
): number | null {
  if (exprId < 0) return null;
  const kind = dae.getExprKind(exprId);
  switch (kind) {
    case ExprKind.Name: {
      const name = dae.interner.resolve(dae.getExprData1(exprId));
      if (!name) return null;
      if (dae.getVarIdxByName(`${name}[1,1]`) >= 0) {
        return dae.addExpression(ExprKind.Name, dae.interner.intern(`${name}[${row},${col}]`));
      }
      const vIdx = dae.getVarIdxByName(name);
      if (vIdx >= 0) {
        const shape = dae.getVarShape(vIdx);
        if (shape.length === 2) {
          return dae.addExpression(ExprKind.Name, dae.interner.intern(`${name}[${row},${col}]`));
        }
        if (shape.length === 1 && col === 1) {
          return dae.addExpression(ExprKind.Name, dae.interner.intern(`${name}[${row}]`));
        }
      }
      if (col === 1 && dae.getVarIdxByName(`${name}[${row}]`) >= 0) {
        return dae.addExpression(ExprKind.Name, dae.interner.intern(`${name}[${row}]`));
      }
      return null;
    }
    case ExprKind.Call: {
      const fnName = dae.interner.resolve(dae.getExprData1(exprId));
      if (fnName === "/*Real*/" || fnName === "Real") {
        return getMatrixElement(dae, dae.getExprLeft(exprId), row, col, isInnerRow);
      }
      if (fnName === "transpose") {
        const inner = dae.getExprLeft(exprId);
        return getMatrixElement(dae, inner, col, row, false);
      }
      if (fnName === "zeros" || fnName === "ones") {
        return dae.addRealLiteral(fnName === "zeros" ? 0.0 : 1.0);
      }
      return null;
    }
    case ExprKind.ArrayCtor: {
      const elems = getArrayElements(dae, exprId);
      if (!elems || elems.length === 0) return null;

      if (isInnerRow) {
        if (row === 1 && col >= 1 && col <= elems.length) {
          return elems[col - 1]!;
        }
        return null;
      }

      const hasArrayOrMatrixChild = elems.some((e) => {
        const k = dae.getExprKind(e);
        if (k === ExprKind.ArrayCtor) return true;
        if (k === ExprKind.Call) {
          const fn = dae.interner.resolve(dae.getExprData1(e));
          if (fn === "zeros" || fn === "ones" || fn === "transpose" || fn === "/*Real*/" || fn === "Real") return true;
        }
        return false;
      });

      if (hasArrayOrMatrixChild) {
        let currentRow = 1;
        for (const elem of elems) {
          const d = getMatrixDimensions(dae, elem, true);
          const elemRows = d ? d.rows : 1;
          if (row >= currentRow && row < currentRow + elemRows) {
            const subRow = row - currentRow + 1;
            if (d) {
              return getMatrixElement(dae, elem, subRow, col, true);
            } else {
              if (col === 1) return elem;
              return null;
            }
          }
          currentRow += elemRows;
        }
        return null;
      }

      if (col === 1 && row >= 1 && row <= elems.length) {
        return elems[row - 1]!;
      }
      return null;
    }
    default:
      if (row === 1 && col === 1) return exprId;
      return null;
  }
}

export function isArrayOfLength(dae: DAEBuilder, exprId: number, n: number): boolean {
  if (exprId < 0) return false;
  const kind = dae.getExprKind(exprId);
  if (kind === ExprKind.ArrayCtor || kind === ExprKind.Tuple) {
    return dae.getExprData1(exprId) === n;
  }
  if (kind === ExprKind.Der || kind === ExprKind.Pre) {
    return isArrayOfLength(dae, dae.getExprData1(exprId), n);
  }
  if (kind === ExprKind.Subscript) {
    const subCount = dae.getExprRight(exprId);
    for (let i = 0; i < subCount; i++) {
      const sId = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
      if (isArrayOfLength(dae, sId, n)) return true;
    }
  }
  if (kind === ExprKind.Unary || kind === ExprKind.Negate) {
    return isArrayOfLength(dae, dae.getExprLeft(exprId), n);
  }
  if (kind === ExprKind.Binary) {
    const op = dae.getExprData1(exprId);
    if (op === BinOp.Mul) {
      const l = dae.getExprLeft(exprId);
      const matDim = getMatrixDimensions(dae, l);
      if (matDim && matDim.rows === n) return true;
    }
    return isArrayOfLength(dae, dae.getExprLeft(exprId), n) || isArrayOfLength(dae, dae.getExprRight(exprId), n);
  }
  if (kind === ExprKind.Name) {
    const name = dae.interner.resolve(dae.getExprData1(exprId));
    if (name) {
      const vIdx = dae.getVarIdxByName(name);
      if (vIdx >= 0) {
        const shape = dae.getVarShape(vIdx);
        if (shape.length === 1) return shape[0] === n;
        if (shape.length > 1) {
          const total = shape.reduce((a, b) => a * b, 1);
          return total === n;
        }
      }
      if (dae.getVarIdxByName(`${name}[1,1]`) >= 0) {
        let rows = 0;
        while (dae.getVarIdxByName(`${name}[${rows + 1},1]`) >= 0) rows++;
        let cols = 0;
        while (dae.getVarIdxByName(`${name}[1,${cols + 1}]`) >= 0) cols++;
        return rows * cols === n;
      }
      return dae.getVarIdxByName(`${name}[${n}]`) >= 0 && dae.getVarIdxByName(`${name}[${n + 1}]`) < 0;
    }
  }
  if (kind === ExprKind.Call) {
    const fnName = dae.interner.resolve(dae.getExprData1(exprId));
    const argCount = dae.getExprRight(exprId);
    if (fnName === "fill" && argCount >= 2) {
      let prod = 1;
      for (let i = 1; i < argCount; i++) {
        const countExpr = dae.getExprLeft(exprId + i);
        const countVal = evaluateConstantArenaExpression(dae, countExpr);
        if (typeof countVal === "number") {
          if (i === 1 && Math.trunc(countVal) === n) return true;
          prod *= Math.trunc(countVal);
        } else {
          prod = -1;
          break;
        }
      }
      if (prod === n) return true;
    }
    if ((fnName === "zeros" || fnName === "ones") && argCount >= 1) {
      let prod = 1;
      for (let i = 0; i < argCount; i++) {
        const countExpr = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
        const countVal = evaluateConstantArenaExpression(dae, countExpr);
        if (typeof countVal === "number") {
          if (i === 0 && Math.trunc(countVal) === n) return true;
          prod *= Math.trunc(countVal);
        } else {
          prod = -1;
          break;
        }
      }
      if (prod === n) return true;
    }
    for (let i = 0; i < argCount; i++) {
      const argExprId = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
      if (isArrayOfLength(dae, argExprId, n)) return true;
    }
  }
  return false;
}

export function getNthExpr(dae: DAEBuilder, exprId: number, k: number, n: number): number {
  if (exprId < 0) return exprId;
  const kind = dae.getExprKind(exprId);
  switch (kind) {
    case ExprKind.ArrayCtor: {
      let res = exprId;
      const count = dae.getExprData1(exprId);
      if (count === n) {
        res = k === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + k);
      } else {
        const elems = getArrayElements(dae, exprId);
        if (elems && elems.length === n) {
          res = elems[k]!;
        }
      }
      if (res !== exprId && res >= 0) {
        while (
          (dae.getExprKind(res) === ExprKind.ArrayCtor || dae.getExprKind(res) === ExprKind.Tuple) &&
          dae.getExprData1(res) === 1
        ) {
          res = dae.getExprLeft(res);
        }
        return res;
      }
      return exprId;
    }
    case ExprKind.Tuple: {
      const count = dae.getExprData1(exprId);
      if (count === n) {
        let res = k === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + k);
        while (
          (dae.getExprKind(res) === ExprKind.ArrayCtor || dae.getExprKind(res) === ExprKind.Tuple) &&
          dae.getExprData1(res) === 1
        ) {
          res = dae.getExprLeft(res);
        }
        return res;
      }
      return exprId;
    }
    case ExprKind.Der: {
      const inner = dae.getExprData1(exprId);
      const innerElem = getNthExpr(dae, inner, k, n);
      return dae.addDerExpr(innerElem);
    }
    case ExprKind.Pre: {
      const inner = dae.getExprData1(exprId);
      const innerElem = getNthExpr(dae, inner, k, n);
      return dae.addPreExpr(innerElem);
    }
    case ExprKind.Negate: {
      const inner = dae.getExprLeft(exprId);
      const innerElem = getNthExpr(dae, inner, k, n);
      return dae.addExpression(ExprKind.Negate, 0, innerElem);
    }
    case ExprKind.Unary: {
      const op = dae.getExprData1(exprId);
      const operand = dae.getExprLeft(exprId);
      const opElem = getNthExpr(dae, operand, k, n);
      return dae.addUnaryExpr(op, opElem);
    }
    case ExprKind.Binary: {
      const op = dae.getExprData1(exprId);
      const left = dae.getExprLeft(exprId);
      const right = dae.getExprRight(exprId);

      // Check for matrix-vector multiplication: M * v where M has rows=n
      if (op === BinOp.Mul) {
        const matDim = getMatrixDimensions(dae, left);
        if (matDim && matDim.rows === n && matDim.cols > 0) {
          let rowSum: number | null = null;
          for (let j = 0; j < matDim.cols; j++) {
            const matElem = getMatrixElement(dae, left, k + 1, j + 1);
            if (matElem === null) continue;
            if (isLiteralZero(dae, matElem)) continue;
            const vecElem = getNthExpr(dae, right, j, matDim.cols);
            if (isLiteralZero(dae, vecElem)) continue;
            const prod = dae.addBinaryExpr(BinOp.Mul, matElem, vecElem);
            rowSum = rowSum === null ? prod : dae.addBinaryExpr(BinOp.Add, rowSum, prod);
          }
          if (rowSum !== null) return rowSum;
          return dae.addRealLiteral(0.0);
        }
      }

      const leftIsArr = isArrayOfLength(dae, left, n);
      const rightIsArr = isArrayOfLength(dae, right, n);
      const leftElem = leftIsArr ? getNthExpr(dae, left, k, n) : left;
      const rightElem = rightIsArr ? getNthExpr(dae, right, k, n) : right;
      return dae.addBinaryExpr(op, leftElem, rightElem);
    }
    case ExprKind.Call: {
      const funcNameId = dae.getExprData1(exprId);
      const fnName = dae.interner.resolve(funcNameId) || "";
      const argCount = dae.getExprRight(exprId);
      if (fnName === "/*Real*/" || fnName === "Real" || fnName.startsWith("/*Real[")) {
        const inner = dae.getExprLeft(exprId);
        const innerElem = getNthExpr(dae, inner, k, n);
        if (dae.getExprKind(innerElem) === ExprKind.RealLiteral) {
          return innerElem;
        }
        if (dae.getExprKind(innerElem) === ExprKind.IntLiteral) {
          return dae.addRealLiteral(dae.getExprData1(innerElem));
        }
        return dae.addCallExpr("/*Real*/", [innerElem]);
      }
      if (fnName === "linspace" && argCount >= 2) {
        const startExpr = dae.getExprLeft(exprId);
        const stopExpr = dae.getExprLeft(exprId + 1);
        const evalNum = (id: number): number | null => {
          const knd = dae.getExprKind(id);
          if (knd === ExprKind.IntLiteral) return dae.getExprData1(id);
          if (knd === ExprKind.RealLiteral) return dae.getExprRealValue(id);
          if (knd === ExprKind.Negate) {
            const v = evalNum(dae.getExprLeft(id));
            return v !== null ? -v : null;
          }
          if (knd === ExprKind.Name) {
            const nm = dae.interner.resolve(dae.getExprData1(id));
            if (nm) {
              const vi = dae.getVarIdxByName(nm);
              if (vi >= 0) {
                const bx = dae.getVarExpression(vi);
                if (bx !== undefined && bx >= 0) return evalNum(bx);
                const sv = dae.getVarStartValue(vi);
                if (sv !== 0) return sv;
              }
            }
          }
          return null;
        };
        const sVal = evalNum(startExpr);
        const eVal = evalNum(stopExpr);
        let nVal = n;
        if (argCount >= 3) {
          const argN = evalNum(dae.getExprLeft(exprId + 2));
          if (argN !== null && argN >= 2) nVal = Math.trunc(argN);
        }
        if (sVal !== null && eVal !== null && nVal >= 2) {
          const step = (eVal - sVal) / (nVal - 1);
          const val = k === 0 ? sVal : k === nVal - 1 ? eVal : sVal + k * step;
          return dae.addRealLiteral(val);
        }
      }
      if (fnName === "zeros" && argCount >= 1) {
        return dae.addIntLiteral(0);
      }
      if (fnName === "ones" && argCount >= 1) {
        return dae.addIntLiteral(1);
      }
      if (fnName === "fill" && argCount >= 2) {
        const valExprId = dae.getExprLeft(exprId);
        if (argCount === 2) {
          return valExprId;
        } else {
          let prod = 1;
          for (let i = 1; i < argCount; i++) {
            const countVal = evaluateConstantArenaExpression(dae, dae.getExprLeft(exprId + i));
            if (typeof countVal === "number") prod *= Math.trunc(countVal);
            else prod = -1;
          }
          if (prod === n) return valExprId;
          const remainingArgs: number[] = [valExprId];
          for (let i = 2; i < argCount; i++) {
            remainingArgs.push(dae.getExprLeft(exprId + i));
          }
          return dae.addCallExpr("fill", remainingArgs);
        }
      }
      const nthArgs: number[] = [];
      for (let i = 0; i < argCount; i++) {
        const argExprId = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
        if (isArrayOfLength(dae, argExprId, n)) {
          nthArgs.push(getNthExpr(dae, argExprId, k, n));
        } else {
          nthArgs.push(argExprId);
        }
      }
      return dae.addCallExpr(fnName, nthArgs);
    }
    case ExprKind.IfElse: {
      const cond = dae.getExprData1(exprId);
      const thenBranch = dae.getExprLeft(exprId);
      const elseBranch = dae.getExprRight(exprId);
      const thenElem = getNthExpr(dae, thenBranch, k, n);
      const elseElem = getNthExpr(dae, elseBranch, k, n);
      return dae.addIfElseExpr(cond, thenElem, elseElem);
    }
    case ExprKind.Name: {
      const name = dae.interner.resolve(dae.getExprData1(exprId));
      if (name) {
        const vIdx = dae.getVarIdxByName(name);
        if (vIdx >= 0) {
          const shape = dae.getVarShape(vIdx);
          if (shape.length >= 1) {
            const indices = generateIndices(shape);
            if (k < indices.length) {
              const multiIdx = indices[k]!.join(",");
              return dae.addExpression(ExprKind.Name, dae.interner.intern(`${name}[${multiIdx}]`));
            }
          }
        }
        const hasPrefix = (p: string) => {
          for (let i = 0; i < dae.varCount; i++) {
            if (!dae.isVarRemoved(i) && dae.getVarName(i).startsWith(p)) return true;
          }
          return false;
        };
        if (dae.getVarIdxByName(`${name}[1,1]`) >= 0 || hasPrefix(`${name}[1,1]`)) {
          let rows = 0;
          while (dae.getVarIdxByName(`${name}[${rows + 1},1]`) >= 0 || hasPrefix(`${name}[${rows + 1},1]`)) rows++;
          let cols = 0;
          while (dae.getVarIdxByName(`${name}[1,${cols + 1}]`) >= 0 || hasPrefix(`${name}[1,${cols + 1}]`)) cols++;
          if (rows > 0 && cols > 0 && n === rows * cols) {
            const r = Math.floor(k / cols) + 1;
            const c = (k % cols) + 1;
            return dae.addExpression(ExprKind.Name, dae.interner.intern(`${name}[${r},${c}]`));
          }
        }
        const indexedName = `${name}[${k + 1}]`;
        if (
          dae.getVarIdxByName(indexedName) >= 0 ||
          dae.hasArrayElements(name) ||
          hasPrefix(`${indexedName}.`) ||
          hasPrefix(`${indexedName}[`)
        ) {
          return dae.addExpression(ExprKind.Name, dae.interner.intern(indexedName));
        }
      }
      return exprId;
    }
    case ExprKind.Subscript: {
      const baseId = dae.getExprData1(exprId);
      const subCount = dae.getExprRight(exprId);
      const subIds: number[] = [];
      for (let i = 0; i < subCount; i++) {
        const sId = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
        if (isArrayOfLength(dae, sId, n)) {
          subIds.push(getNthExpr(dae, sId, k, n));
        } else {
          subIds.push(sId);
        }
      }
      return dae.addSubscriptExpr(baseId, subIds);
    }
    default:
      return exprId;
  }
}
