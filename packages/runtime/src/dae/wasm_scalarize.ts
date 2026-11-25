// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Deferred batch scalarization pass expanding array/tensor/record variables,
 * equations, loops, and imperative algorithm statements into scalar DAE arenas.
 */

import { evaluateConstantArenaExpression } from "./wasm_const_eval.js";
import { BinOp, Causality, DAEBuilder, EqKind, ExprKind, StmtKind, Variability, VarType } from "./wasm_dae.js";
import {
  type ArenaFoldParamMap,
  type DAEBuilderFoldExtensions,
  type StructuredBodyEquation,
  type StructuredElseIfClause,
  generateIndices,
  getArrayCtorElement,
  isRealType,
  lookupRecordFunctionInDae,
} from "./wasm_fold_helpers.js";
import {
  buildRecordFieldIndex,
  getArrayElements,
  getFieldExpr,
  getNthExpr,
  getRecordFields,
  isArrayOfLength,
  isRecordConstructorCall,
} from "./wasm_scalarize_helpers.js";
import { countArenaStatementSlots } from "./wasm_statement_executor.js";

/**
 * Deferred Batch Scalarization Pass.
 *
 * Transforms a {@link DAEBuilder} containing unexpanded multi-dimensional array variables,
 * array/record equations, and `for` equation loops into a flat scalar {@link DAEBuilder}
 * suitable for BLT sorting and numerical integration:
 * 1. Copies model metadata, functions, diagnostics, annotations, and domain extension metadata.
 * 2. Indexes array variable shapes (`arrayShapes`) and defines `cloneExpr` to deep-copy
 *    expressions into `out` while substituting active loop indices (`loopVarMap`), appending
 *    element subscript suffixes, or reconstructing array constructors for array-taking calls.
 * 3. Expands every array variable of shape $[d_1, \dots, d_k]$ into individual scalar
 *    variables `name[i_1,...,i_k]` and slices array bindings and `start` attributes per element.
 * 4. Scalarizes equations (`emitEquation`) across array elements and record/connector fields,
 *    validating connector plug-compatibility (`M3003`) for `connect(...)` equations and
 *    unrolling `If`, `When`, and `For`/`InitialFor` equation blocks.
 * 5. Clones boundary nodes and imperative algorithm statements into the output arena.
 *
 * @param dae The input DAE arena with preserved array/record structures.
 * @returns A newly allocated `DAEBuilder` containing scalarized variables and equations.
 */
export function scalarizeArena(dae: DAEBuilder, expandArrayEquations = false): DAEBuilder {
  // --- Step 1: Clone Model Metadata & Index Array Variable Shapes ---
  const out = dae.exports
    ? new DAEBuilder(dae.exports, dae.name || "Model", dae.description || "", dae.interner)
    : new DAEBuilder(dae.interner);
  out.name = dae.name;
  out.classKind = dae.classKind;
  out.description = dae.description;
  out.isImpure = dae.isImpure;
  for (const [k, v] of dae.functions) {
    out.functions.set(k, v);
  }
  out.diagnostics.push(...dae.diagnostics);
  out.equationAnnotations = [...dae.equationAnnotations];
  out.algorithmAnnotations = [...dae.algorithmAnnotations];
  out.experiment = { ...dae.experiment };
  out.hiddenVarIndices = new Set(dae.hiddenVarIndices);
  out.extensionMetadata = {
    ...dae.extensionMetadata,
    ...(dae.extensionMetadata.webgpu && { webgpu: { ...dae.extensionMetadata.webgpu } }),
    ...(dae.extensionMetadata.audioClock && { audioClock: { ...dae.extensionMetadata.audioClock } }),
    ...(dae.extensionMetadata.surrogate && { surrogate: new Map(dae.extensionMetadata.surrogate) }),
    ...(dae.extensionMetadata.feaMesh && { feaMesh: dae.extensionMetadata.feaMesh.map((x) => ({ ...x })) }),
    ...(dae.extensionMetadata.cfdFlow && {
      cfdFlow: dae.extensionMetadata.cfdFlow.map((x) => ({ ...x, grid: x.grid ? [...x.grid] : undefined })),
    }),
    ...(dae.extensionMetadata.mbse && { mbse: { ...dae.extensionMetadata.mbse } }),
    ...(dae.extensionMetadata.fmuInstances && {
      fmuInstances: dae.extensionMetadata.fmuInstances.map((x) => ({
        ...x,
        inputs: [...x.inputs],
        outputs: [...x.outputs],
        parameters: [...x.parameters],
        terminalMapping: x.terminalMapping ? x.terminalMapping.map((m) => ({ ...m })) : undefined,
      })),
    }),
  };
  const arrayShapes = new Map<string, number[]>();
  const loopVarMap = new Map<string, number>();

  for (let i = 0; i < dae.varCount; i++) {
    if (dae.isVarRemoved(i)) continue;
    let shape = dae.getVarShape(i);
    const expr = dae.getExplicitVarExpression(i);
    if (shape.length > 0 && shape.some((d) => d <= 0)) {
      if (expr != null && expr >= 0) {
        const k = dae.getExprKind(expr);
        if (k === ExprKind.ArrayCtor) {
          const count = dae.getExprData1(expr);
          if (count === 1) {
            const elem0 = dae.getExprLeft(expr);
            if (dae.getExprKind(elem0) === ExprKind.Name) {
              const refName = dae.interner.resolve(dae.getExprData1(elem0));
              if (refName && arrayShapes.has(refName)) {
                shape = arrayShapes.get(refName)!;
              } else if (count > 0) {
                shape = [count];
              }
            } else if (count > 0) {
              shape = [count];
            }
          } else if (count > 0) {
            shape = [count];
          }
        }
      }
    }
    if (shape.length > 0) {
      arrayShapes.set(dae.getVarName(i), shape);
    }
  }

  // --- Step 2: Expression Cloner with Loop-Index Substitution & Array Element Projection ---
  const cloneExpr = (
    exprId: number,
    indexSuffix: string,
    currentShape: number[] | null,
    reconstructArrays = false,
  ): number => {
    if (exprId < 0) return exprId;
    const kind = dae.getExprKind(exprId);

    switch (kind) {
      case ExprKind.Name: {
        const nameId = dae.getExprData1(exprId);
        const name = dae.interner.resolve(nameId);
        const cleanName = name?.startsWith("\0loop\0") ? name.substring(6) : name;
        if (cleanName && loopVarMap.has(cleanName)) {
          return out.addIntLiteral(loopVarMap.get(cleanName)!);
        }
        if (name && arrayShapes.has(name)) {
          const shape = arrayShapes.get(name)!;
          if (currentShape && shape.join(",") === currentShape.join(",")) {
            return out.addNameExpr(`${name}${indexSuffix}`);
          }
          if (reconstructArrays && !currentShape && indexSuffix === "") {
            const indices = generateIndices(shape);
            const elemExprs = indices.map((idx) => out.addNameExpr(`${name}[${idx.join(",")}]`));
            return out.addArrayCtorExpr(elemExprs);
          }
        }
        if (name && out.getVarIdxByName(name) < 0 && name.includes("[")) {
          const m = /^(.+)(\[[^\][]+])\.([^.[\]]+)$/.exec(name);
          if (m) {
            const transposed = `${m[1]}.${m[3]}${m[2]}`;
            if (out.getVarIdxByName(transposed) >= 0) {
              return out.addNameExpr(transposed);
            }
          }
        }
        return out.addNameExpr(name || "");
      }
      case ExprKind.IntLiteral:
        return out.addIntLiteral(dae.getExprData1(exprId));
      case ExprKind.RealLiteral:
        return out.addRealLiteral(dae.getExprRealValue(exprId));
      case ExprKind.BoolLiteral:
        return out.addBoolLiteral(dae.getExprData1(exprId) !== 0);
      case ExprKind.StringLiteral: {
        const strId = dae.getExprData1(exprId);
        const str = dae.interner.resolve(strId);
        return out.addStringLiteral(str || "");
      }
      case ExprKind.Binary: {
        const op = dae.getExprData1(exprId);
        const origLeft = dae.getExprLeft(exprId);
        const origRight = dae.getExprRight(exprId);
        const left = cloneExpr(origLeft, indexSuffix, currentShape);
        const right = cloneExpr(origRight, indexSuffix, currentShape);
        if (
          loopVarMap.size > 0 &&
          out.getExprKind(left) === ExprKind.IntLiteral &&
          out.getExprKind(right) === ExprKind.IntLiteral
        ) {
          const lv = out.getExprData1(left);
          const rv = out.getExprData1(right);
          if (op === BinOp.Add) return out.addIntLiteral(lv + rv);
          if (op === BinOp.Sub) return out.addIntLiteral(lv - rv);
          if (op === BinOp.Mul) return out.addIntLiteral(lv * rv);
        }
        if (op === BinOp.Mul) {
          const leftName =
            dae.getExprKind(origLeft) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(origLeft)) : null;
          const rightName =
            dae.getExprKind(origRight) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(origRight)) : null;
          const leftIsArray = Boolean(leftName && arrayShapes.has(leftName));
          const rightIsArray = Boolean(rightName && arrayShapes.has(rightName));
          if (!leftIsArray && rightIsArray) {
            return out.addBinaryExpr(op, right, left);
          }
        }
        return out.addBinaryExpr(op, left, right);
      }
      case ExprKind.Unary: {
        const op = dae.getExprData1(exprId);
        const operand = cloneExpr(dae.getExprLeft(exprId), indexSuffix, currentShape);
        return out.addUnaryExpr(op, operand);
      }
      case ExprKind.Negate: {
        const operand = cloneExpr(dae.getExprLeft(exprId), indexSuffix, currentShape);
        return out.addExpression(ExprKind.Negate, 0, operand);
      }
      case ExprKind.Range: {
        const start = cloneExpr(dae.getExprData1(exprId), indexSuffix, currentShape);
        const stepRaw = dae.getExprLeft(exprId);
        const step = stepRaw >= 0 ? cloneExpr(stepRaw, indexSuffix, currentShape) : -1;
        const stop = cloneExpr(dae.getExprRight(exprId), indexSuffix, currentShape);
        return out.addExpression(ExprKind.Range, start, step, stop);
      }
      case ExprKind.Colon:
        return out.addColonExpr();
      case ExprKind.Comprehension: {
        const cfn = dae.interner.resolve(dae.getExprData1(exprId));
        const iterCount = dae.getExprRight(exprId);
        const clonedRanges: number[] = [];
        for (let i = 0; i < iterCount; i++) {
          const iterNodeId = exprId + 1 + i;
          clonedRanges.push(cloneExpr(dae.getExprLeft(iterNodeId), indexSuffix, currentShape));
        }
        const inner = cloneExpr(dae.getExprLeft(exprId), indexSuffix, currentShape);
        const compId = out.addExpression(ExprKind.Comprehension, out.interner.intern(cfn || ""), inner, iterCount);
        for (let i = 0; i < iterCount; i++) {
          const iterNodeId = exprId + 1 + i;
          const varName = dae.interner.resolve(dae.getExprData1(iterNodeId));
          out.addExpression(ExprKind.Tuple, out.interner.intern(varName || ""), clonedRanges[i]!, 0);
        }
        return compId;
      }
      case ExprKind.PartialFunc: {
        const pfn = dae.interner.resolve(dae.getExprData1(exprId)) || "";
        const pcount = dae.getExprRight(exprId);
        const pArgs: number[] = [];
        for (let i = 0; i < pcount; i++) {
          pArgs.push(cloneExpr(dae.getExprLeft(exprId + i), indexSuffix, currentShape, true));
        }
        return out.addPartialFuncExpr(pfn, pArgs);
      }
      case ExprKind.Der: {
        const arg = cloneExpr(dae.getExprData1(exprId), indexSuffix, currentShape);
        return out.addDerExpr(arg);
      }
      case ExprKind.Pre: {
        const arg = cloneExpr(dae.getExprData1(exprId), indexSuffix, currentShape);
        return out.addPreExpr(arg);
      }
      case ExprKind.Call: {
        const funcNameId = dae.getExprData1(exprId);
        const argCount = dae.getExprRight(exprId);
        const funcName = dae.interner.resolve(funcNameId) || "";
        if (expandArrayEquations) {
          if (argCount === 1) {
            const rawArg0 = dae.getExprLeft(exprId);
            if (funcName === "Modelica.ComplexMath.real" || funcName === "ComplexMath.real" || funcName === "real") {
              return getFieldExpr(dae, out, rawArg0, "re", cloneExpr, true);
            }
            if (funcName === "Modelica.ComplexMath.imag" || funcName === "ComplexMath.imag" || funcName === "imag") {
              return getFieldExpr(dae, out, rawArg0, "im", cloneExpr, true);
            }
            if (funcName === "Modelica.ComplexMath.abs" || funcName === "ComplexMath.abs") {
              const re = getFieldExpr(dae, out, rawArg0, "re", cloneExpr, true);
              const im = getFieldExpr(dae, out, rawArg0, "im", cloneExpr, true);
              return out.addCallExpr("sqrt", [
                out.addBinaryExpr(
                  BinOp.Add,
                  out.addBinaryExpr(BinOp.Mul, re, re),
                  out.addBinaryExpr(BinOp.Mul, im, im),
                ),
              ]);
            }
            if (funcName === "Modelica.ComplexMath.arg" || funcName === "ComplexMath.arg") {
              const re = getFieldExpr(dae, out, rawArg0, "re", cloneExpr, true);
              const im = getFieldExpr(dae, out, rawArg0, "im", cloneExpr, true);
              return out.addCallExpr("atan2", [im, re]);
            }
          } else if (argCount === 2 && funcName === "Complex.'=='.equal") {
            const rawArg0 = dae.getExprLeft(exprId);
            const rawArg1 = dae.getExprLeft(exprId + 1);
            const reEq = out.addBinaryExpr(
              BinOp.Eq,
              getFieldExpr(dae, out, rawArg0, "re", cloneExpr, true),
              getFieldExpr(dae, out, rawArg1, "re", cloneExpr, true),
            );
            const imEq = out.addBinaryExpr(
              BinOp.Eq,
              getFieldExpr(dae, out, rawArg0, "im", cloneExpr, true),
              getFieldExpr(dae, out, rawArg1, "im", cloneExpr, true),
            );
            return out.addBinaryExpr(BinOp.And, reEq, imEq);
          }
        }
        const expandCallArg = !funcName.includes(".");
        const args: number[] = [];
        for (let i = 0; i < argCount; i++) {
          const argExprId = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
          args.push(cloneExpr(argExprId, indexSuffix, currentShape, expandCallArg));
        }
        if (
          dae.extensionMetadata?.["scalarizeMinMax"] &&
          (funcName === "min" || funcName === "max") &&
          args.length === 1
        ) {
          let arg0 = args[0]!;
          if (out.getExprKind(arg0) === ExprKind.Name) {
            const vName = out.interner.resolve(out.getExprData1(arg0));
            const shape = vName ? dae.getNamedArrayShape(vName) : null;
            if (vName && shape && shape.length > 0) {
              const indices = generateIndices(shape);
              const elemExprs = indices.map((idx) => out.addNameExpr(`${vName}[${idx.join(",")}]`));
              arg0 = out.addArrayCtorExpr(elemExprs);
            }
          }
          if (out.getExprKind(arg0) === ExprKind.ArrayCtor) {
            const count = out.getExprData1(arg0);
            if (count >= 2) {
              const elems: number[] = [];
              for (let k = 0; k < count; k++) {
                elems.push(k === 0 ? out.getExprLeft(arg0) : out.getExprLeft(arg0 + k));
              }
              let cur = elems[elems.length - 1]!;
              for (let k = elems.length - 2; k >= 0; k--) {
                cur = out.addCallExpr(funcName, [elems[k]!, cur]);
              }
              return cur;
            } else if (count === 1) {
              return out.getExprLeft(arg0);
            }
          }
        }
        if (expandArrayEquations) {
          const inlined = tryInlineSingleAssignCall(funcName, args, 0);
          if (inlined !== null) return inlined;
        }
        return out.addCallExpr(funcName, args);
      }
      case ExprKind.Tuple: {
        const count = dae.getExprData1(exprId);
        const elems: number[] = [];
        for (let i = 0; i < count; i++) {
          const elemId = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
          elems.push(cloneExpr(elemId, indexSuffix, currentShape));
        }
        return out.addTupleExpr(elems);
      }
      case ExprKind.ArrayCtor: {
        const count = dae.getExprData1(exprId);
        const elements: number[] = [];
        for (let i = 0; i < count; i++) {
          const elemId = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
          elements.push(cloneExpr(elemId, indexSuffix, currentShape));
        }
        return out.addArrayCtorExpr(elements);
      }
      case ExprKind.IfElse: {
        const cond = cloneExpr(dae.getExprData1(exprId), indexSuffix, currentShape);
        const thenBranch = cloneExpr(dae.getExprLeft(exprId), indexSuffix, currentShape);
        const elseBranch = cloneExpr(dae.getExprRight(exprId), indexSuffix, currentShape);
        return out.addIfElseExpr(cond, thenBranch, elseBranch);
      }
      case ExprKind.Subscript: {
        const baseId = dae.getExprData1(exprId);
        const subCount = dae.getExprRight(exprId);
        const subIds: number[] = [];
        for (let i = 0; i < subCount; i++) {
          const sId = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
          subIds.push(cloneExpr(sId, indexSuffix, currentShape));
        }
        const clonedBase = cloneExpr(baseId, indexSuffix, currentShape);
        // Flatten constant integer subscripts on known arrays directly into a scalarized `ExprKind.Name` (`x[1,2]`).
        if (
          out.getExprKind(clonedBase) === ExprKind.Name &&
          subIds.length > 0 &&
          subIds.every((s) => out.getExprKind(s) === ExprKind.IntLiteral)
        ) {
          const baseName = out.interner.resolve(out.getExprData1(clonedBase));
          if (baseName) {
            const idxStr = subIds.map((s) => out.getExprData1(s)).join(",");
            const rawBase = baseName.includes("[") ? baseName.slice(0, baseName.indexOf("[")) : baseName;
            const combinedName = baseName.endsWith("]")
              ? `${baseName.slice(0, -1)},${idxStr}]`
              : `${baseName}[${idxStr}]`;
            if (
              out.getVarIdxByName(combinedName) >= 0 ||
              (arrayShapes.has(rawBase) && out.getVarIdxByName(baseName) < 0)
            ) {
              return out.addNameExpr(combinedName);
            }
          }
        }
        return out.addSubscriptExpr(clonedBase, subIds);
      }
      case ExprKind.EnumLiteral: {
        const ordinal = dae.getExprData1(exprId);
        const pathId = dae.getExprLeft(exprId);
        const pathStr = dae.interner.resolve(pathId) || "";
        return out.addEnumLiteral(ordinal, pathStr);
      }
      case ExprKind.TensorSlice: {
        const base = cloneExpr(dae.getExprData1(exprId), indexSuffix, currentShape);
        const slice = cloneExpr(dae.getExprLeft(exprId), indexSuffix, currentShape);
        const axis = dae.getExprRight(exprId);
        return out.addTensorSlice(base, slice, axis);
      }
      case ExprKind.TensorBroadcast: {
        const op = cloneExpr(dae.getExprLeft(exprId), indexSuffix, currentShape);
        const axis = dae.getExprData1(exprId);
        const shape = dae.getExprTensorShape(exprId) ?? [];
        return out.addTensorBroadcast(op, shape, axis);
      }
      case ExprKind.TensorMatMul: {
        const left = cloneExpr(dae.getExprLeft(exprId), indexSuffix, currentShape);
        const right = cloneExpr(dae.getExprRight(exprId), indexSuffix, currentShape);
        const flags = dae.getExprData1(exprId);
        return out.addTensorMatMul(left, right, flags);
      }
      case ExprKind.TensorReduce: {
        const op = cloneExpr(dae.getExprLeft(exprId), indexSuffix, currentShape);
        const redOp = dae.getExprData1(exprId);
        const axis = dae.getExprRight(exprId);
        return out.addTensorReduce(op, redOp, axis);
      }
      case ExprKind.TensorMap: {
        const op = cloneExpr(dae.getExprLeft(exprId), indexSuffix, currentShape);
        const opId = dae.getExprData1(exprId);
        const aux = dae.getExprRight(exprId);
        return out.addTensorMap(op, opId, aux);
      }
      default:
        return exprId;
    }
  };

  function tryInlineSingleAssignCall(funcName: string, args: number[], depth: number): number | null {
    if (!expandArrayEquations || depth > 16 || !funcName) return null;
    const fn = lookupRecordFunctionInDae(dae, funcName);
    if (!fn || fn.externalDecl) return null;
    if (fn.description && fn.description.startsWith("Automatically generated record constructor")) return null;
    if ((fn as DAEBuilder & DAEBuilderFoldExtensions).isOperatorRecord || fn.extensionMetadata?.isOperatorRecord)
      return null;
    if (fn.algorithmSections.length !== 1 || fn.algorithmSections[0]!.count !== 1) return null;
    const stmtIdx = fn.algorithmSections[0]!.start;
    const rootStmtKind = fn.getStmtKind(stmtIdx);
    if (rootStmtKind !== StmtKind.Assignment && rootStmtKind !== StmtKind.If) return null;

    const inputs: { name: string; varIdx: number }[] = [];
    const outputs: string[] = [];
    for (let v = 0; v < fn.varCount; v++) {
      if (fn.isVarRemoved(v)) continue;
      const c = fn.getVarCausality(v);
      const varb = fn.getVarVariability(v);
      const vExpr = fn.getVarExpression(v);
      if (c === Causality.Input) {
        inputs.push({ name: fn.getVarName(v), varIdx: v });
      } else if (c === Causality.Output) {
        outputs.push(fn.getVarName(v));
      } else if (
        varb !== Variability.Constant &&
        varb !== Variability.Parameter &&
        !(typeof vExpr === "number" && vExpr >= 0)
      ) {
        return null;
      }
    }
    if (outputs.length !== 1) return null;
    const outName = outputs[0]!;

    let failed = false;
    const cloneFnExpr = (fnExprId: number, paramMap: Map<string, number>, d: number): number => {
      if (failed || fnExprId < 0 || d > 32) {
        failed = true;
        return -1;
      }
      const k = fn.getExprKind(fnExprId);
      switch (k) {
        case ExprKind.Name: {
          const name = fn.interner.resolve(fn.getExprData1(fnExprId)) || "";
          if (paramMap.has(name)) return paramMap.get(name)!;
          if (name.includes(".")) {
            const dotIdx = name.indexOf(".");
            const rootParam = name.slice(0, dotIdx);
            const restField = name.slice(dotIdx + 1);
            if (paramMap.has(rootParam)) {
              const paramExprInOut = paramMap.get(rootParam)!;
              return getFieldExpr(out, out, paramExprInOut, restField, (id) => id);
            }
          }
          const vIdx = fn.getVarIdxByName(name);
          if (vIdx >= 0) {
            const bindId = fn.getVarExpression(vIdx);
            if (bindId !== undefined && bindId >= 0) {
              const clonedBind = cloneFnExpr(bindId, paramMap, d + 1);
              if (!failed && clonedBind >= 0) {
                paramMap.set(name, clonedBind);
              }
              return clonedBind;
            }
          }
          return out.addNameExpr(name);
        }
        case ExprKind.IntLiteral:
          return out.addIntLiteral(fn.getExprData1(fnExprId));
        case ExprKind.RealLiteral:
          return out.addRealLiteral(fn.getExprRealValue(fnExprId));
        case ExprKind.BoolLiteral:
          return out.addBoolLiteral(fn.getExprData1(fnExprId) !== 0);
        case ExprKind.StringLiteral:
          return out.addStringLiteral(fn.interner.resolve(fn.getExprData1(fnExprId)) || "");
        case ExprKind.EnumLiteral: {
          const ordinal = fn.getExprData1(fnExprId);
          const pathStr = fn.interner.resolve(fn.getExprLeft(fnExprId)) || "";
          return out.addEnumLiteral(ordinal, pathStr);
        }
        case ExprKind.Binary: {
          const op = fn.getExprData1(fnExprId);
          const l = cloneFnExpr(fn.getExprLeft(fnExprId), paramMap, d + 1);
          const r = cloneFnExpr(fn.getExprRight(fnExprId), paramMap, d + 1);
          if (failed) return -1;
          return out.addBinaryExpr(op, l, r);
        }
        case ExprKind.Unary: {
          const op = fn.getExprData1(fnExprId);
          const operand = cloneFnExpr(fn.getExprLeft(fnExprId), paramMap, d + 1);
          if (failed) return -1;
          return out.addUnaryExpr(op, operand);
        }
        case ExprKind.Negate: {
          const operand = cloneFnExpr(fn.getExprLeft(fnExprId), paramMap, d + 1);
          if (failed) return -1;
          return out.addExpression(ExprKind.Negate, 0, operand);
        }
        case ExprKind.IfElse: {
          const cond = cloneFnExpr(fn.getExprData1(fnExprId), paramMap, d + 1);
          const tBranch = cloneFnExpr(fn.getExprLeft(fnExprId), paramMap, d + 1);
          const fBranch = cloneFnExpr(fn.getExprRight(fnExprId), paramMap, d + 1);
          if (failed) return -1;
          return out.addIfElseExpr(cond, tBranch, fBranch);
        }
        case ExprKind.ArrayCtor: {
          const count = fn.getExprData1(fnExprId);
          const elems: number[] = [];
          for (let i = 0; i < count; i++) {
            const elemId = i === 0 ? fn.getExprLeft(fnExprId) : fn.getExprLeft(fnExprId + i);
            elems.push(cloneFnExpr(elemId, paramMap, d + 1));
            if (failed) return -1;
          }
          return out.addArrayCtorExpr(elems);
        }
        case ExprKind.Subscript: {
          const baseId = fn.getExprData1(fnExprId);
          const subCount = fn.getExprRight(fnExprId);
          const subIds: number[] = [];
          for (let i = 0; i < subCount; i++) {
            const sId = i === 0 ? fn.getExprLeft(fnExprId) : fn.getExprLeft(fnExprId + i);
            subIds.push(cloneFnExpr(sId, paramMap, d + 1));
            if (failed) return -1;
          }
          const clonedBase = cloneFnExpr(baseId, paramMap, d + 1);
          if (failed) return -1;
          if (subIds.length > 0 && subIds.every((s) => out.getExprKind(s) === ExprKind.IntLiteral)) {
            const idx = subIds.map((s) => out.getExprData1(s));
            if (out.getExprKind(clonedBase) === ExprKind.ArrayCtor) {
              const elem = getArrayCtorElement(out, clonedBase, idx);
              if (elem >= 0) return elem;
            }
            if (out.getExprKind(clonedBase) === ExprKind.Name) {
              const baseName = out.interner.resolve(out.getExprData1(clonedBase));
              if (baseName) {
                const idxStr = idx.join(",");
                const combinedName = baseName.endsWith("]")
                  ? `${baseName.slice(0, -1)},${idxStr}]`
                  : `${baseName}[${idxStr}]`;
                if (out.getVarIdxByName(combinedName) >= 0 || dae.getVarIdxByName(combinedName) >= 0) {
                  return out.addNameExpr(combinedName);
                }
              }
            }
          }
          return out.addSubscriptExpr(clonedBase, subIds);
        }
        case ExprKind.Call: {
          const subFnName = fn.interner.resolve(fn.getExprData1(fnExprId)) || "";
          const subArgCount = fn.getExprRight(fnExprId);
          const subArgs: number[] = [];
          for (let i = 0; i < subArgCount; i++) {
            const aId = i === 0 ? fn.getExprLeft(fnExprId) : fn.getExprLeft(fnExprId + i);
            subArgs.push(cloneFnExpr(aId, paramMap, d + 1));
            if (failed) return -1;
          }
          const inlinedSub = tryInlineSingleAssignCall(subFnName, subArgs, depth + 1);
          if (inlinedSub !== null) return inlinedSub;
          return out.addCallExpr(subFnName, subArgs);
        }
        default:
          failed = true;
          return -1;
      }
    };

    const paramMap = new Map<string, number>();
    for (let i = 0; i < inputs.length; i++) {
      const inp = inputs[i]!;
      if (i < args.length) {
        let argId = args[i]!;
        if (fn.getVarType(inp.varIdx) === VarType.Real && out.getExprKind(argId) === ExprKind.IntLiteral) {
          argId = out.addRealLiteral(out.getExprData1(argId));
        }
        paramMap.set(inp.name, argId);
      } else {
        const defId = fn.getVarExpression(inp.varIdx);
        if (defId !== undefined && defId >= 0) {
          const defCloned = cloneFnExpr(defId, paramMap, 0);
          if (failed) return null;
          paramMap.set(inp.name, defCloned);
        }
      }
    }

    const convertStmtToExpr = (sIdx: number, d: number): number => {
      if (failed || sIdx < 0 || d > 16) {
        failed = true;
        return -1;
      }
      const sKind = fn.getStmtKind(sIdx);
      if (sKind === StmtKind.Assignment) {
        const targetExprId = fn.getStmtData1(sIdx);
        const sourceExprId = fn.getStmtLeft(sIdx);
        if (targetExprId < 0 || sourceExprId < 0 || fn.getExprKind(targetExprId) !== ExprKind.Name) {
          failed = true;
          return -1;
        }
        const targetName = fn.interner.resolve(fn.getExprData1(targetExprId));
        if (targetName !== outName) {
          failed = true;
          return -1;
        }
        return cloneFnExpr(sourceExprId, paramMap, 0);
      }
      if (sKind === StmtKind.If) {
        const condExprId = fn.getStmtData1(sIdx);
        const thenStmtCount = fn.getStmtLeft(sIdx);
        const branchCount = fn.getStmtRight(sIdx);
        if (thenStmtCount !== 1 || branchCount < 1) {
          failed = true;
          return -1;
        }
        const blockStartIdx = sIdx + 1;
        const thenExpr = convertStmtToExpr(blockStartIdx, d + 1);
        if (failed || thenExpr < 0) return -1;
        const thenSlots = countArenaStatementSlots(fn, blockStartIdx, thenStmtCount);
        let nextIdx = blockStartIdx + thenSlots;
        const clauses: { condExpr: number; bodyExpr: number }[] = [
          { condExpr: cloneFnExpr(condExprId, paramMap, 0), bodyExpr: thenExpr },
        ];
        if (failed) return -1;
        let elseExpr = -1;
        for (let b = 0; b < branchCount; b++) {
          const branchStmtIdx = nextIdx;
          const branchKind = fn.getStmtKind(branchStmtIdx);
          const branchCondExprId = fn.getStmtData1(branchStmtIdx);
          const branchStmtCount = fn.getStmtLeft(branchStmtIdx);
          if (branchKind !== StmtKind.Block || branchStmtCount !== 1) {
            failed = true;
            return -1;
          }
          const branchBodyExpr = convertStmtToExpr(branchStmtIdx + 1, d + 1);
          if (failed || branchBodyExpr < 0) return -1;
          const branchSlots = countArenaStatementSlots(fn, branchStmtIdx + 1, branchStmtCount);
          nextIdx = branchStmtIdx + 1 + branchSlots;
          if (branchCondExprId === -1) {
            elseExpr = branchBodyExpr;
          } else {
            const branchCond = cloneFnExpr(branchCondExprId, paramMap, 0);
            if (failed) return -1;
            clauses.push({ condExpr: branchCond, bodyExpr: branchBodyExpr });
          }
        }
        if (elseExpr < 0) {
          failed = true;
          return -1;
        }
        let acc = elseExpr;
        for (let c = clauses.length - 1; c >= 0; c--) {
          acc = out.addIfElseExpr(clauses[c]!.condExpr, clauses[c]!.bodyExpr, acc);
        }
        return acc;
      }
      failed = true;
      return -1;
    };

    const res = convertStmtToExpr(stmtIdx, 0);
    return failed || res < 0 ? null : res;
  }

  // --- Step 3: Emit Scalarized Variables & Element-Sliced Attributes ---
  // Emit variables
  for (let i = 0; i < dae.varCount; i++) {
    if (dae.isVarRemoved(i)) continue;

    const name = dae.getVarName(i);
    let shape = dae.getVarShape(i);
    const type = dae.getVarType(i);
    const variability = dae.getVarVariability(i);
    const causality = dae.getVarCausality(i);
    const start = dae.getVarStartValue(i);
    const flags = dae.getVarFlags(i);
    const desc = dae.getVarDescription(i);
    const expr = dae.getExplicitVarExpression(i);
    const attrs = dae.getVarAttrExprIds(i);
    const customType = dae.getVarCustomType(i);
    const enumLits = dae.getVarEnumerationLiterals(i);
    const cad = dae.getVarCadAnnotation(i);

    const vRange = dae.getVarSourceRange(i);

    if (shape.length > 0) {
      if (shape.some((d) => d <= 0)) {
        if (arrayShapes.has(name) && arrayShapes.get(name)!.every((d) => d > 0)) {
          shape = arrayShapes.get(name)!;
        } else if (expr != null && expr >= 0 && dae.getExprKind(expr) === ExprKind.ArrayCtor) {
          const count = dae.getExprData1(expr);
          if (count > 0) shape = [count];
        }
      }
      if (shape.some((d) => d <= 0)) {
        shape = shape.map((d) => (d <= 0 ? 1 : d));
      }
      const indices = generateIndices(shape);
      for (let elemIdx = 0; elemIdx < indices.length; elemIdx++) {
        const idx = indices[elemIdx]!;
        const scalarName = `${name}[${idx.join(",")}]`;
        const scalarIdx = out.addVariable(scalarName, type, variability, causality, start, flags);
        if (desc) out.setVarDescription(scalarIdx, desc);
        if (customType) out.setVarCustomType(scalarIdx, customType);
        if (enumLits) out.setVarEnumerationLiterals(scalarIdx, enumLits);
        if (cad) out.setVarCadAnnotation(scalarIdx, cad);
        if (vRange) out.setVarSourceRange(scalarIdx, vRange.startOffset, vRange.endOffset);

        if (expr != null && expr >= 0) {
          if (dae.getExprKind(expr) === ExprKind.ArrayCtor) {
            let elemExpr = getArrayCtorElement(dae, expr, idx);
            if (elemExpr < 0 && dae.getExprData1(expr) === 1) {
              const inside = dae.getExprLeft(expr);
              if (dae.getExprKind(inside) === ExprKind.Name) {
                const insideName = dae.interner.resolve(dae.getExprData1(inside));
                if (insideName) {
                  elemExpr = out.addNameExpr(`${insideName}[${idx.join(",")}]`);
                }
              }
            }
            if (elemExpr >= 0) {
              let cloned: number;
              if (type === VarType.Real && dae.getExprKind(elemExpr) === ExprKind.IntLiteral) {
                cloned = out.addRealLiteral(dae.getExprData1(elemExpr));
              } else {
                cloned = cloneExpr(elemExpr, "", null);
              }
              out.setVarExpression(scalarIdx, cloned);
            }
          } else if (isArrayOfLength(dae, expr, indices.length)) {
            const elemExpr = getNthExpr(dae, expr, elemIdx, indices.length);
            let cloned: number;
            if (type === VarType.Real && dae.getExprKind(elemExpr) === ExprKind.IntLiteral) {
              cloned = out.addRealLiteral(dae.getExprData1(elemExpr));
            } else {
              cloned = cloneExpr(elemExpr, "", null);
            }
            out.setVarExpression(scalarIdx, cloned);
          } else {
            out.setVarExpression(scalarIdx, cloneExpr(expr, `[${idx.join(",")}]`, shape));
          }
        }

        if (attrs) {
          for (const [attrName, attrExprId] of attrs.entries()) {
            if (attrName === "start" && dae.getExprKind(attrExprId) === ExprKind.ArrayCtor) {
              const elemExpr = getArrayCtorElement(dae, attrExprId, idx);
              if (elemExpr >= 0) {
                let cloned: number;
                if (type === VarType.Real && dae.getExprKind(elemExpr) === ExprKind.IntLiteral) {
                  cloned = out.addRealLiteral(dae.getExprData1(elemExpr));
                } else {
                  cloned = cloneExpr(elemExpr, "", null);
                }
                out.setVarAttr(scalarIdx, "start", cloned);
                if (out.getExprKind(cloned) === ExprKind.RealLiteral) {
                  out.setVarStartValue(scalarIdx, out.getExprRealValue(cloned));
                } else if (out.getExprKind(cloned) === ExprKind.IntLiteral) {
                  out.setVarStartValue(scalarIdx, out.getExprData1(cloned));
                }
              }
            } else if (attrName === "start" && isArrayOfLength(dae, attrExprId, indices.length)) {
              const elemExpr = getNthExpr(dae, attrExprId, elemIdx, indices.length);
              let cloned: number;
              if (type === VarType.Real && dae.getExprKind(elemExpr) === ExprKind.IntLiteral) {
                cloned = out.addRealLiteral(dae.getExprData1(elemExpr));
              } else {
                cloned = cloneExpr(elemExpr, "", null);
              }
              out.setVarAttr(scalarIdx, "start", cloned);
              if (out.getExprKind(cloned) === ExprKind.RealLiteral) {
                out.setVarStartValue(scalarIdx, out.getExprRealValue(cloned));
              } else if (out.getExprKind(cloned) === ExprKind.IntLiteral) {
                out.setVarStartValue(scalarIdx, out.getExprData1(cloned));
              }
            } else {
              out.setVarAttr(scalarIdx, attrName, cloneExpr(attrExprId, `[${idx.join(",")}]`, shape));
            }
          }
        }
      }
    } else {
      const scalarIdx = out.addVariable(name, type, variability, causality, start, flags);
      if (desc) out.setVarDescription(scalarIdx, desc);
      if (customType) out.setVarCustomType(scalarIdx, customType);
      if (enumLits) out.setVarEnumerationLiterals(scalarIdx, enumLits);
      if (cad) out.setVarCadAnnotation(scalarIdx, cad);
      if (vRange) out.setVarSourceRange(scalarIdx, vRange.startOffset, vRange.endOffset);
      if (expr != null && expr >= 0) {
        out.setVarExpression(scalarIdx, cloneExpr(expr, "", null));
      }
      if (attrs) {
        for (const [attrName, attrExprId] of attrs.entries()) {
          if (attrName === "start" && attrExprId === expr) continue;
          out.setVarAttr(scalarIdx, attrName, cloneExpr(attrExprId, "", null));
        }
      }
    }
  }

  const checkShape = (id: number) => {
    if (id < 0) return null;
    const kind = dae.getExprKind(id);
    if (kind === ExprKind.Name) {
      const name = dae.interner.resolve(dae.getExprData1(id));
      const idx = dae.lookupVariable(name);
      if (idx >= 0) {
        const s = dae.getVarShape(idx);
        return s.length > 0 ? s : null;
      }
    }
    return null;
  };

  const recordIndex = buildRecordFieldIndex(dae);

  // --- Step 4: Equation Scalarization Helper (`emitEquation`) ---
  // Splits array equations element-by-element (coercing integer literals to Real when paired
  // with Real LHS/RHS elements), decomposes record and `connect(...)` equations field-by-field
  // after verifying plug-compatibility, or iterates over `generateIndices(shape)` for shaped variables.
  const emitEquation = (
    rawKind: EqKind,
    lhsId: number,
    rhsId: number,
    eqFlags: number,
    targetList?: { kind: EqKind; lhsExprId: number; rhsExprId: number }[],
    origEqIdx?: number,
  ) => {
    const kind = rawKind === EqKind.Array && expandArrayEquations ? EqKind.Simple : rawKind;
    const recordEqMeta = (newEqIdx: number) => {
      if (origEqIdx !== undefined) {
        const desc = dae.getEqDescription?.(origEqIdx);
        if (desc) out.setEqDescription(newEqIdx, desc);
        const range = dae.getEqSourceRange?.(origEqIdx);
        if (range) out.setEqSourceRange(newEqIdx, range.startOffset, range.endOffset);
      }
    };

    if (kind === EqKind.Array) {
      const newLhs = cloneExpr(lhsId, "", null);
      let newRhs = -1;
      if (
        Boolean((dae.extensionMetadata as Record<string, unknown> | undefined)?.["omcCompatibility"]) &&
        rhsId >= 0 &&
        dae.getExprKind(rhsId) === ExprKind.Binary
      ) {
        const isOutZero = (eid: number): boolean => {
          const ek = out.getExprKind(eid);
          return (
            (ek === ExprKind.RealLiteral && out.getExprRealValue(eid) === 0.0) ||
            (ek === ExprKind.IntLiteral && out.getExprData1(eid) === 0)
          );
        };
        const isOutOne = (eid: number): boolean => {
          const ek = out.getExprKind(eid);
          return (
            (ek === ExprKind.RealLiteral && out.getExprRealValue(eid) === 1.0) ||
            (ek === ExprKind.IntLiteral && out.getExprData1(eid) === 1)
          );
        };
        const isScalarBcastLeaf = (eid: number): boolean => {
          if (eid < 0) return false;
          const ek = dae.getExprKind(eid);
          if (ek === ExprKind.ArrayCtor || ek === ExprKind.Call || ek === ExprKind.Comprehension) return false;
          if (getArrayElements(dae, eid) !== null) return false;
          if (ek === ExprKind.Name) {
            const nm = dae.interner.resolve(dae.getExprData1(eid)) || "";
            if (arrayShapes.has(nm)) return false;
          }
          return true;
        };
        const mkBinSimp = (bop: BinOp, a: number, b: number): number => {
          if (bop === BinOp.Mul || bop === BinOp.ElemMul) {
            if (isOutZero(a) || isOutZero(b)) return out.addRealLiteral(0.0);
            if (isOutOne(a)) return b;
            if (isOutOne(b)) return a;
            return out.addBinaryExpr(BinOp.Mul, a, b);
          }
          if (bop === BinOp.Add || bop === BinOp.ElemAdd) {
            if (isOutZero(a)) return b;
            if (isOutZero(b)) return a;
            return out.addBinaryExpr(BinOp.Add, a, b);
          }
          if (bop === BinOp.Sub || bop === BinOp.ElemSub) {
            if (isOutZero(b)) return a;
            if (isOutZero(a)) return out.addExpression(ExprKind.Negate, 0, b);
            return out.addBinaryExpr(BinOp.Sub, a, b);
          }
          if (bop === BinOp.Div || bop === BinOp.ElemDiv) {
            if (isOutZero(a)) return out.addRealLiteral(0.0);
            if (isOutOne(b)) return a;
            return out.addBinaryExpr(BinOp.Div, a, b);
          }
          return out.addBinaryExpr(bop, a, b);
        };
        const evalOut1D = (eid: number): number[] | null => {
          if (eid < 0) return null;
          const ek = dae.getExprKind(eid);
          if (ek === ExprKind.ArrayCtor) {
            const cnt = dae.getExprData1(eid);
            if (cnt <= 0) return null;
            const res: number[] = [];
            for (let ai = 0; ai < cnt; ai++) {
              const el = ai === 0 ? dae.getExprLeft(eid) : dae.getExprLeft(eid + ai);
              if (dae.getExprKind(el) === ExprKind.ArrayCtor) return null;
              res.push(cloneExpr(el, "", null));
            }
            return res;
          }
          if (ek === ExprKind.Binary) {
            const bop = dae.getExprData1(eid) as BinOp;
            if (
              bop !== BinOp.Add &&
              bop !== BinOp.Sub &&
              bop !== BinOp.Mul &&
              bop !== BinOp.Div &&
              bop !== BinOp.ElemAdd &&
              bop !== BinOp.ElemSub &&
              bop !== BinOp.ElemMul &&
              bop !== BinOp.ElemDiv
            ) {
              return null;
            }
            const lRaw = dae.getExprLeft(eid);
            const rRaw = dae.getExprRight(eid);
            const lVec = evalOut1D(lRaw);
            const rVec = evalOut1D(rRaw);
            if (lVec && rVec && lVec.length === rVec.length) {
              return lVec.map((lv, idx) => mkBinSimp(bop, lv, rVec[idx]!));
            }
            if (
              lVec &&
              !rVec &&
              (bop === BinOp.Mul || bop === BinOp.ElemMul || bop === BinOp.Div || bop === BinOp.ElemDiv) &&
              isScalarBcastLeaf(rRaw)
            ) {
              const sc = cloneExpr(rRaw, "", null);
              return lVec.map((lv) => mkBinSimp(bop, lv, sc));
            }
            if (!lVec && rVec && (bop === BinOp.Mul || bop === BinOp.ElemMul) && isScalarBcastLeaf(lRaw)) {
              const sc = cloneExpr(lRaw, "", null);
              return rVec.map((rv) => mkBinSimp(bop, sc, rv));
            }
          }
          return null;
        };
        const outVec = evalOut1D(rhsId);
        const lShapeCheck = getArrayElements(dae, lhsId);
        if (outVec && (!lShapeCheck || lShapeCheck.length === outVec.length)) {
          newRhs = out.addArrayCtorExpr(outVec);
        }
      }
      if (newRhs < 0) newRhs = cloneExpr(rhsId, "", null);
      if (targetList) {
        targetList.push({ kind, lhsExprId: newLhs, rhsExprId: newRhs });
      } else {
        out.addEquation(kind, newLhs, newRhs, eqFlags);
        recordEqMeta(out.eqCount - 1);
      }
      return;
    }

    if (
      (kind === EqKind.FunctionCall || kind === EqKind.InitialFunctionCall) &&
      Boolean((dae.extensionMetadata as Record<string, unknown> | undefined)?.["omcCompatibility"]) &&
      lhsId >= 0 &&
      dae.getExprKind(lhsId) === ExprKind.Call &&
      dae.interner.resolve(dae.getExprData1(lhsId)) === "assert" &&
      dae.getExprRight(lhsId) >= 2
    ) {
      const condVal = evaluateConstantArenaExpression(
        dae,
        dae.getExprLeft(lhsId),
        undefined,
        undefined,
        0,
        undefined,
        undefined,
        true,
      );
      if (condVal === true) return;
    }

    const lhsElements = getArrayElements(dae, lhsId);
    const rhsElements = getArrayElements(dae, rhsId);
    if ((lhsElements && lhsElements.length === 0) || (rhsElements && rhsElements.length === 0)) {
      return;
    }
    const isEqualityConstraintCall = (exprId: number): boolean => {
      if (exprId < 0 || dae.getExprKind(exprId) !== ExprKind.Call) return false;
      const fn = dae.interner.resolve(dae.getExprData1(exprId));
      return fn === "equalityConstraint" || fn.endsWith(".equalityConstraint");
    };
    const isScalarOrBuiltinCall = (fn: string): boolean => {
      if (!fn.includes(".") && fn !== "equalityConstraint") return true;
      if (fn.startsWith("/*Real")) return true;
      const dot = fn.lastIndexOf(".");
      const leaf = dot >= 0 ? fn.slice(dot + 1) : fn;
      return (
        leaf === "length" ||
        leaf === "abs" ||
        leaf === "sqrt" ||
        leaf === "sign" ||
        leaf === "sin" ||
        leaf === "cos" ||
        leaf === "tan" ||
        leaf === "asin" ||
        leaf === "acos" ||
        leaf === "atan" ||
        leaf === "atan2" ||
        leaf === "exp" ||
        leaf === "log" ||
        leaf === "log10" ||
        leaf === "min" ||
        leaf === "max" ||
        leaf === "sum" ||
        leaf === "product" ||
        leaf === "size" ||
        leaf === "to_unit1" ||
        leaf === "from_deg" ||
        leaf === "to_deg"
      );
    };
    const containsUnsplitVectorCall = (exprId: number): boolean => {
      if (exprId < 0) return false;
      const ek = dae.getExprKind(exprId);
      if (ek === ExprKind.Comprehension) {
        return true;
      }
      if (ek === ExprKind.Call) {
        const fn = dae.interner.resolve(dae.getExprData1(exprId)) || "";
        return !isScalarOrBuiltinCall(fn);
      }
      if (ek === ExprKind.Negate || ek === ExprKind.Unary) {
        return containsUnsplitVectorCall(dae.getExprLeft(exprId));
      }
      if (ek === ExprKind.Binary) {
        const op = dae.getExprData1(exprId) as BinOp;
        if (op === BinOp.Add || op === BinOp.Sub || op === BinOp.Mul || op === BinOp.Div) {
          return (
            containsUnsplitVectorCall(dae.getExprLeft(exprId)) || containsUnsplitVectorCall(dae.getExprRight(exprId))
          );
        }
      }
      return false;
    };
    const collapseArrayArgCtorsInCall = (callExprId: number): number => {
      if (callExprId < 0 || out.getExprKind(callExprId) !== ExprKind.Call) return callExprId;
      const argc = out.getExprRight(callExprId);
      if (argc <= 0) return callExprId;
      let anyRep = false;
      const args: number[] = [];
      for (let ai = 0; ai < argc; ai++) {
        let arg = ai === 0 ? out.getExprLeft(callExprId) : out.getExprLeft(callExprId + ai);
        if (out.getExprKind(arg) === ExprKind.ArrayCtor) {
          const cnt = out.getExprData1(arg);
          if (cnt >= 2) {
            let base: string | null = null;
            let ok = true;
            for (let k = 0; k < cnt; k++) {
              const el = k === 0 ? out.getExprLeft(arg) : out.getExprLeft(arg + k);
              if (out.getExprKind(el) !== ExprKind.Name) {
                ok = false;
                break;
              }
              const nm = out.interner.resolve(out.getExprData1(el));
              const expectedSfx = `[${k + 1}]`;
              if (!nm || !nm.endsWith(expectedSfx)) {
                ok = false;
                break;
              }
              const b = nm.slice(0, -expectedSfx.length);
              if (base === null) base = b;
              else if (base !== b) {
                ok = false;
                break;
              }
            }
            if (
              ok &&
              base &&
              out.getVarIdxByName(`${base}[1]`) >= 0 &&
              out.getVarIdxByName(`${base}[${cnt + 1}]`) < 0
            ) {
              arg = out.addNameExpr(base);
              anyRep = true;
            }
          }
        }
        args.push(arg);
      }
      if (!anyRep) return callExprId;
      const fnName = out.interner.resolve(out.getExprData1(callExprId)) || "";
      return out.addCallExpr(fnName, args);
    };
    if (
      Boolean((dae.extensionMetadata as Record<string, unknown> | undefined)?.["omcCompatibility"]) &&
      ((kind === EqKind.InitialSimple &&
        lhsElements &&
        lhsElements.length > 0 &&
        !rhsElements &&
        (dae.getExprKind(rhsId) === ExprKind.Call || containsUnsplitVectorCall(rhsId))) ||
        (kind === EqKind.Simple &&
          ((lhsElements &&
            lhsElements.length > 0 &&
            !rhsElements &&
            (isEqualityConstraintCall(rhsId) || (!expandArrayEquations && containsUnsplitVectorCall(rhsId)))) ||
            (rhsElements &&
              rhsElements.length > 0 &&
              !lhsElements &&
              (isEqualityConstraintCall(lhsId) || (!expandArrayEquations && containsUnsplitVectorCall(lhsId)))))))
    ) {
      let newLhs = cloneExpr(lhsId, "", null);
      let newRhs = cloneExpr(rhsId, "", null);
      if (isEqualityConstraintCall(rhsId)) newRhs = collapseArrayArgCtorsInCall(newRhs);
      if (isEqualityConstraintCall(lhsId)) newLhs = collapseArrayArgCtorsInCall(newLhs);
      if (targetList) {
        targetList.push({ kind, lhsExprId: newLhs, rhsExprId: newRhs });
      } else {
        out.addEquation(kind, newLhs, newRhs, eqFlags);
        recordEqMeta(out.eqCount - 1);
      }
      return;
    }
    if (lhsElements && lhsElements.length > 0) {
      const N = lhsElements.length;
      for (let k = 0; k < N; k++) {
        const newLhs = cloneExpr(lhsElements[k]!, "", null);
        const rk_raw = rhsElements && rhsElements.length === N ? rhsElements[k]! : getNthExpr(dae, rhsId, k, N);
        let newRhs = cloneExpr(rk_raw, "", null);
        if (isRealType(dae, lhsElements[k]!)) {
          if (dae.getExprKind(rk_raw) === ExprKind.IntLiteral) {
            newRhs = out.addRealLiteral(dae.getExprData1(rk_raw));
          } else if (dae.getExprKind(rk_raw) === ExprKind.Negate) {
            const inner = dae.getExprLeft(rk_raw);
            if (dae.getExprKind(inner) === ExprKind.IntLiteral) {
              const realLit = out.addRealLiteral(dae.getExprData1(inner));
              newRhs = out.addExpression(ExprKind.Negate, 0, realLit);
            }
          }
        }
        if (targetList) {
          targetList.push({ kind, lhsExprId: newLhs, rhsExprId: newRhs });
        } else {
          out.addEquation(kind, newLhs, newRhs, eqFlags);
          recordEqMeta(out.eqCount - 1);
        }
      }
      return;
    }

    const lhsRec = getRecordFields(dae, lhsId, expandArrayEquations, recordIndex);
    const rhsRec = getRecordFields(dae, rhsId, expandArrayEquations, recordIndex);

    if (rhsElements && rhsElements.length > 0) {
      const N = rhsElements.length;
      for (let k = 0; k < N; k++) {
        let newRhs = cloneExpr(rhsElements[k]!, "", null);
        let newLhs: number;
        if (lhsRec && lhsRec.length === N) {
          newLhs = getFieldExpr(dae, out, lhsId, lhsRec[k]!, cloneExpr, expandArrayEquations);
          if (isRealType(dae, newLhs) && dae.getExprKind(rhsElements[k]!) === ExprKind.IntLiteral) {
            newRhs = out.addRealLiteral(dae.getExprData1(rhsElements[k]!));
          }
        } else {
          const lk_raw = getNthExpr(dae, lhsId, k, N);
          newLhs = cloneExpr(lk_raw, "", null);
          if (isRealType(dae, rhsElements[k]!)) {
            if (dae.getExprKind(lk_raw) === ExprKind.IntLiteral) {
              newLhs = out.addRealLiteral(dae.getExprData1(lk_raw));
            } else if (dae.getExprKind(lk_raw) === ExprKind.Negate) {
              const inner = dae.getExprLeft(lk_raw);
              if (dae.getExprKind(inner) === ExprKind.IntLiteral) {
                const realLit = out.addRealLiteral(dae.getExprData1(inner));
                newLhs = out.addExpression(ExprKind.Negate, 0, realLit);
              }
            }
          }
        }
        if (targetList) {
          targetList.push({ kind, lhsExprId: newLhs, rhsExprId: newRhs });
        } else {
          out.addEquation(kind, newLhs, newRhs, eqFlags);
          recordEqMeta(out.eqCount - 1);
        }
      }
      return;
    }
    const isRhsCall = dae.getExprKind(rhsId) === ExprKind.Call;
    const isRhsComprehension = dae.getExprKind(rhsId) === ExprKind.Comprehension;
    const isRhsRecordCtor = isRhsCall && isRecordConstructorCall(dae, rhsId);
    const isFramesOrientationCtor =
      isRhsCall &&
      (() => {
        const fn = dae.interner.resolve(dae.getExprData1(rhsId));
        return fn === "Modelica.Mechanics.MultiBody.Frames.Orientation" || fn.endsWith(".Frames.Orientation");
      })();
    const isRhsBinary = dae.getExprKind(rhsId) === ExprKind.Binary;
    const isRhsUnary = dae.getExprKind(rhsId) === ExprKind.Unary || dae.getExprKind(rhsId) === ExprKind.Negate;

    const recFields = lhsRec || rhsRec;
    const isComplexRec =
      expandArrayEquations && recFields?.length === 2 && recFields[0] === "re" && recFields[1] === "im";

    // If LHS is a record, and RHS is a function call, comprehension, or binary/unary operation returning a record (but NOT an auto-generated record constructor):
    // preserve the whole-record equation!
    if (
      lhsRec &&
      lhsRec.length > 0 &&
      !isComplexRec &&
      ((isRhsCall &&
        (!isRhsRecordCtor ||
          (isFramesOrientationCtor &&
            !expandArrayEquations &&
            Boolean((dae.extensionMetadata as Record<string, unknown> | undefined)?.["omcCompatibility"])))) ||
        isRhsComprehension ||
        isRhsBinary ||
        isRhsUnary)
    ) {
      const newLhs = cloneExpr(lhsId, "", null);
      const newRhs = cloneExpr(rhsId, "", null);
      if (expandArrayEquations && isRecordConstructorCall(out, newRhs)) {
        for (const field of lhsRec) {
          const fieldLhs = getFieldExpr(dae, out, lhsId, field, cloneExpr, expandArrayEquations);
          const fieldRhs = getFieldExpr(out, out, newRhs, field, (id) => id, expandArrayEquations);
          if (targetList) {
            targetList.push({ kind, lhsExprId: fieldLhs, rhsExprId: fieldRhs });
          } else {
            out.addEquation(kind, fieldLhs, fieldRhs, eqFlags);
            recordEqMeta(out.eqCount - 1);
          }
        }
        return;
      }
      if (targetList) {
        targetList.push({ kind, lhsExprId: newLhs, rhsExprId: newRhs });
      } else {
        out.addEquation(kind, newLhs, newRhs, eqFlags);
        recordEqMeta(out.eqCount - 1);
      }
      return;
    }

    // Plug-compatibility check for connect equations:
    // If both sides are connectors (records), they must have the same member names.
    // If only one side is a record and the other isn't (e.g., scalar vs array), that's also incompatible.
    // For expandable connectors, member sets merge dynamically, so skip plug-compatibility check.
    if (kind === EqKind.Connect && recFields && recFields.length > 0) {
      const lhsName = dae.getExprKind(lhsId) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(lhsId)) : "";
      const rhsName = dae.getExprKind(rhsId) === ExprKind.Name ? dae.interner.resolve(dae.getExprData1(rhsId)) : "";
      const expBuses = (dae.extensionMetadata?.expandableBuses as string[]) ?? [];
      const isBus = (name: string) => expBuses.some((b) => b && (name === b || name.startsWith(b + ".")));
      const isExpConnect = isBus(lhsName) || isBus(rhsName);

      const hasStreamMember = (name: string): boolean => Boolean(name && recordIndex.streamPrefixes.has(name));
      const isOuterOuterStream = eqFlags === 3 && (hasStreamMember(lhsName) || hasStreamMember(rhsName));

      if (isExpConnect || isOuterOuterStream) {
        const newLhs = cloneExpr(lhsId, "", null);
        const newRhs = cloneExpr(rhsId, "", null);
        if (targetList) {
          targetList.push({ kind, lhsExprId: newLhs, rhsExprId: newRhs });
        } else {
          out.addEquation(kind, newLhs, newRhs, eqFlags);
          recordEqMeta(out.eqCount - 1);
        }
        return;
      }

      const flattener = (dae as DAEBuilder & DAEBuilderFoldExtensions).flattener;
      const isDisabledField = (baseName: string, field: string): boolean =>
        Boolean(baseName && flattener?.isComponentDisabled?.(`${baseName}.${field}`));
      const lhsSet = new Set(lhsRec ?? []);
      const rhsSet = new Set(rhsRec ?? []);

      let isPlugCompatible = true;
      if ((lhsRec && lhsRec.length > 0) || (rhsRec && rhsRec.length > 0)) {
        for (const f of lhsSet) {
          if (!rhsSet.has(f) && !isDisabledField(rhsName, f)) {
            isPlugCompatible = false;
            break;
          }
        }
        if (isPlugCompatible) {
          for (const f of rhsSet) {
            if (!lhsSet.has(f) && !isDisabledField(lhsName, f)) {
              isPlugCompatible = false;
              break;
            }
          }
        }
      }
      if (!isPlugCompatible) {
        if (!out.diagnostics.some((d) => d.code === 2002)) {
          const srcRange = origEqIdx !== undefined ? dae.getEqSourceRange?.(origEqIdx) : undefined;
          const rStart = srcRange ? srcRange.startOffset : undefined;
          const rEnd = srcRange ? srcRange.endOffset : undefined;
          out.diagnostics.push({
            severity: "error",
            code: 3003, // NOT_PLUG_COMPATIBLE
            message: `The connectors in connect(${lhsName}, ${rhsName}) are not type compatible.`,
            startOffset: rStart,
            endOffset: rEnd,
            range:
              srcRange && rStart !== undefined && rEnd !== undefined
                ? {
                    startOffset: rStart,
                    endOffset: rEnd,
                  }
                : undefined,
          });
        }
        return;
      }

      const commonFields = (lhsRec ?? []).filter((f) => rhsSet.has(f));
      for (const field of commonFields) {
        const newLhs = getFieldExpr(dae, out, lhsId, field, cloneExpr, expandArrayEquations);
        const newRhs = getFieldExpr(dae, out, rhsId, field, cloneExpr, expandArrayEquations);
        if (targetList) {
          targetList.push({ kind, lhsExprId: newLhs, rhsExprId: newRhs });
        } else {
          out.addEquation(kind, newLhs, newRhs, eqFlags);
          recordEqMeta(out.eqCount - 1);
        }
      }
      return;
    }

    if (recFields && recFields.length > 0) {
      const isWholeComplexRec =
        !expandArrayEquations &&
        kind !== EqKind.Connect &&
        Boolean(dae.extensionMetadata?.["omcCompatibility"]) &&
        !dae.extensionMetadata?.["isOldFrontend"] &&
        recFields.length === 2 &&
        recFields[0] === "re" &&
        recFields[1] === "im";
      if (isWholeComplexRec) {
        const newLhs = cloneExpr(lhsId, "", null);
        const newRhs = cloneExpr(rhsId, "", null);
        if (targetList) {
          targetList.push({ kind, lhsExprId: newLhs, rhsExprId: newRhs });
        } else {
          out.addEquation(kind, newLhs, newRhs, eqFlags);
          recordEqMeta(out.eqCount - 1);
        }
        return;
      }
      for (const field of recFields) {
        const newLhs = getFieldExpr(dae, out, lhsId, field, cloneExpr, expandArrayEquations);
        const newRhs = getFieldExpr(dae, out, rhsId, field, cloneExpr, expandArrayEquations);
        if (targetList) {
          targetList.push({ kind, lhsExprId: newLhs, rhsExprId: newRhs });
        } else {
          out.addEquation(kind, newLhs, newRhs, eqFlags);
          recordEqMeta(out.eqCount - 1);
        }
      }
      return;
    }

    const shape = checkShape(lhsId) || checkShape(rhsId);
    if (shape && shape.length > 0) {
      if (isRhsCall && !isRhsRecordCtor) {
        // If RHS is a vector/array function call (e.g. Complex.'-'.negateArr(ca2)), preserve whole equation!
        const newLhs = cloneExpr(lhsId, "", null);
        const newRhs = cloneExpr(rhsId, "", null);
        if (targetList) {
          targetList.push({ kind, lhsExprId: newLhs, rhsExprId: newRhs });
        } else {
          out.addEquation(kind, newLhs, newRhs, eqFlags);
          recordEqMeta(out.eqCount - 1);
        }
        return;
      }
      const indices = generateIndices(shape);
      for (const idx of indices) {
        const indexSuffix = `[${idx.join(",")}]`;
        const newLhs = cloneExpr(lhsId, indexSuffix, shape);
        const newRhs = cloneExpr(rhsId, indexSuffix, shape);
        if (targetList) {
          targetList.push({ kind, lhsExprId: newLhs, rhsExprId: newRhs });
        } else {
          out.addEquation(kind, newLhs, newRhs, eqFlags);
          recordEqMeta(out.eqCount - 1);
        }
      }
    } else {
      const newLhs = cloneExpr(lhsId, "", null);
      const newRhs = cloneExpr(rhsId, "", null);
      if (targetList) {
        targetList.push({ kind, lhsExprId: newLhs, rhsExprId: newRhs });
      } else {
        out.addEquation(kind, newLhs, newRhs, eqFlags);
        recordEqMeta(out.eqCount - 1);
      }
    }
  };

  const sameOutLhs = (a: number, b: number): boolean => {
    if (a < 0 || b < 0) return false;
    const ka = out.getExprKind(a);
    const kb = out.getExprKind(b);
    if (ka !== kb) return false;
    if (ka === ExprKind.Name || ka === ExprKind.IntLiteral || ka === ExprKind.BoolLiteral) {
      return out.getExprData1(a) === out.getExprData1(b);
    }
    if (ka === ExprKind.RealLiteral) {
      return out.getExprRealValue(a) === out.getExprRealValue(b);
    }
    return false;
  };

  const tryEmitBalancedIfAsSimple = (
    condId: number,
    thenEqs: { kind: EqKind; lhsExprId: number; rhsExprId: number }[],
    elseIfs: { conditionExprId: number; bodyEquations: { kind: EqKind; lhsExprId: number; rhsExprId: number }[] }[],
    elseEqs: { kind: EqKind; lhsExprId: number; rhsExprId: number }[],
    eqFlags: number,
    targetList?: { kind: EqKind; lhsExprId: number; rhsExprId: number }[],
    origEqIdx?: number,
  ): boolean => {
    if (!expandArrayEquations || thenEqs.length === 0 || elseEqs.length !== thenEqs.length) return false;
    if (!elseIfs.every((c) => c.bodyEquations.length === thenEqs.length)) return false;
    const isSimple = (e: { kind: EqKind }) => e.kind === EqKind.Simple || e.kind === EqKind.InitialSimple;
    if (!thenEqs.every(isSimple) || !elseEqs.every(isSimple)) return false;
    if (!elseIfs.every((c) => c.bodyEquations.every(isSimple))) return false;

    const toResidual = (eq: { lhsExprId: number; rhsExprId: number }) =>
      out.addBinaryExpr(BinOp.Sub, eq.lhsExprId, eq.rhsExprId);

    for (let k = 0; k < thenEqs.length; k++) {
      const tEq = thenEqs[k]!;
      const eEq = elseEqs[k]!;
      const allSameLhs =
        sameOutLhs(tEq.lhsExprId, eEq.lhsExprId) &&
        elseIfs.every((c) => sameOutLhs(tEq.lhsExprId, c.bodyEquations[k]!.lhsExprId));
      let combinedLhs: number;
      let combinedRhs: number;
      if (allSameLhs) {
        let rhsChain = eEq.rhsExprId;
        for (let ci = elseIfs.length - 1; ci >= 0; ci--) {
          rhsChain = out.addIfElseExpr(
            elseIfs[ci]!.conditionExprId,
            elseIfs[ci]!.bodyEquations[k]!.rhsExprId,
            rhsChain,
          );
        }
        combinedLhs = tEq.lhsExprId;
        combinedRhs = out.addIfElseExpr(condId, tEq.rhsExprId, rhsChain);
      } else {
        let resChain = toResidual(eEq);
        for (let ci = elseIfs.length - 1; ci >= 0; ci--) {
          resChain = out.addIfElseExpr(
            elseIfs[ci]!.conditionExprId,
            toResidual(elseIfs[ci]!.bodyEquations[k]!),
            resChain,
          );
        }
        combinedLhs = out.addRealLiteral(0.0);
        combinedRhs = out.addIfElseExpr(condId, toResidual(tEq), resChain);
      }
      if (targetList) {
        targetList.push({ kind: tEq.kind, lhsExprId: combinedLhs, rhsExprId: combinedRhs });
      } else {
        out.addEquation(tEq.kind, combinedLhs, combinedRhs, eqFlags);
        if (origEqIdx !== undefined) {
          const desc = dae.getEqDescription?.(origEqIdx);
          if (desc) out.setEqDescription(out.eqCount - 1, desc);
          const range = dae.getEqSourceRange?.(origEqIdx);
          if (range) out.setEqSourceRange(out.eqCount - 1, range.startOffset, range.endOffset);
        }
      }
    }
    return true;
  };

  // --- Step 5: Emit & Unroll Equations (`If`, `When`, `For`/`InitialFor`, and Simple/Connect) ---
  let staticIfNameToIdx: Map<string, number> | undefined;
  let staticIfParamMap: ArenaFoldParamMap | undefined;
  const ensureStaticIfMaps = () => {
    if (staticIfParamMap) return;
    staticIfNameToIdx = new Map<string, number>();
    staticIfParamMap = new Map();
    for (let v = 0; v < dae.varCount; v++) {
      if (dae.isVarRemoved(v)) continue;
      staticIfNameToIdx.set(dae.getVarName(v), v);
    }
    for (let pass = 0; pass < 4; pass++) {
      let progress = false;
      for (let v = 0; v < dae.varCount; v++) {
        if (dae.isVarRemoved(v)) continue;
        const vName = dae.getVarName(v);
        if (staticIfParamMap.has(vName)) continue;
        const vb = dae.getVarVariability(v);
        if (
          vb !== Variability.Constant &&
          !(vb === Variability.Parameter && (dae.isVarFinal(v) || dae.isVarEvaluate(v)))
        ) {
          continue;
        }
        const bindExpr = dae.getExplicitVarExpression(v);
        if (bindExpr === undefined || bindExpr < 0) continue;
        const val = evaluateConstantArenaExpression(
          dae,
          bindExpr,
          staticIfParamMap,
          staticIfNameToIdx,
          0,
          undefined,
          undefined,
          true,
        );
        if (val !== null) {
          staticIfParamMap.set(vName, val);
          progress = true;
        }
      }
      if (!progress) break;
    }
  };

  // Emit equations
  for (let i = 0; i < dae.eqCount; i++) {
    if (dae.isEqRemoved(i)) continue;
    const kind = dae.getEqKind(i);
    const lhsId = dae.getEqLhs(i);
    const rhsId = dae.getEqRhs(i);
    const eqFlags = dae.getEqFlags(i);

    if (kind === EqKind.If) {
      const meta = dae.getIfEquationMeta(i);
      if (meta) {
        const evalStaticIfCond = (condExprId: number): boolean | null => {
          if (condExprId < 0) return null;
          ensureStaticIfMaps();
          const v = evaluateConstantArenaExpression(
            dae,
            condExprId,
            staticIfParamMap,
            staticIfNameToIdx,
            0,
            undefined,
            undefined,
            true,
          );
          return typeof v === "boolean" ? v : null;
        };
        const emitEvaluatedIf = (
          rawCondId: number,
          thenSrc: StructuredBodyEquation[],
          elseIfSrc: StructuredElseIfClause[],
          elseSrc: StructuredBodyEquation[],
          dstList?: StructuredBodyEquation[],
        ): void => {
          const topVal = evalStaticIfCond(rawCondId);
          if (topVal === true) {
            cloneInlineEqList(thenSrc, dstList);
            return;
          }
          if (topVal === false) {
            for (let ci = 0; ci < elseIfSrc.length; ci++) {
              const clause = elseIfSrc[ci]!;
              const cBody = clause.bodyEquations ?? (clause.equations as StructuredBodyEquation[] | undefined) ?? [];
              const cVal = evalStaticIfCond(clause.conditionExprId);
              if (cVal === true) {
                cloneInlineEqList(cBody, dstList);
                return;
              }
              if (cVal === null) {
                emitEvaluatedIf(clause.conditionExprId, cBody, elseIfSrc.slice(ci + 1), elseSrc, dstList);
                return;
              }
            }
            cloneInlineEqList(elseSrc, dstList);
            return;
          }
          const condId = cloneExpr(rawCondId, "", null);
          const thenList: StructuredBodyEquation[] = [];
          cloneInlineEqList(thenSrc, thenList);
          const elseIfList: {
            conditionExprId: number;
            bodyEquations: StructuredBodyEquation[];
            equations: { kind: EqKind; lhs: number; rhs: number; aux?: number | undefined }[];
          }[] = [];
          let activeElseSrc = elseSrc;
          for (const clause of elseIfSrc) {
            const cVal = evalStaticIfCond(clause.conditionExprId);
            if (cVal === false) continue;
            const cBody = clause.bodyEquations ?? (clause.equations as StructuredBodyEquation[] | undefined) ?? [];
            if (cVal === true) {
              activeElseSrc = cBody;
              break;
            }
            const clauseCond = cloneExpr(clause.conditionExprId, "", null);
            const clauseEqs: StructuredBodyEquation[] = [];
            cloneInlineEqList(cBody, clauseEqs);
            elseIfList.push({ conditionExprId: clauseCond, bodyEquations: clauseEqs, equations: [] });
          }
          const elseList: StructuredBodyEquation[] = [];
          if (activeElseSrc.length > 0) {
            cloneInlineEqList(activeElseSrc, elseList);
          }
          if (tryEmitBalancedIfAsSimple(condId, thenList, elseIfList, elseList, eqFlags, dstList, i)) {
            return;
          }
          if (dstList) {
            dstList.push({
              kind: EqKind.If,
              lhsExprId: condId,
              rhsExprId: -1,
              thenEquations: thenList,
              elseIfClauses: elseIfList,
              elseEquations: elseList,
            });
          } else {
            const ifIdx = out.addIfEquation(condId);
            const ifRange = dae.getEqSourceRange?.(i);
            if (ifRange) out.setEqSourceRange(ifIdx, ifRange.startOffset, ifRange.endOffset);
            const outMeta = out.getIfEquationMeta(ifIdx);
            if (outMeta) {
              outMeta.thenEquations.push(...thenList);
              outMeta.elseIfClauses.push(...elseIfList);
              if (meta.elseEquations || elseList.length > 0) {
                outMeta.elseEquations ??= [];
                outMeta.elseEquations.push(...elseList);
              }
            }
          }
        };
        const cloneInlineEqList = (srcList: StructuredBodyEquation[], dstList?: StructuredBodyEquation[]) => {
          for (const eq of srcList) {
            if (eq.kind === EqKind.If && Array.isArray(eq.thenEquations)) {
              emitEvaluatedIf(eq.lhsExprId, eq.thenEquations, eq.elseIfClauses ?? [], eq.elseEquations ?? [], dstList);
            } else {
              const subKind = (eqFlags & 1) !== 0 && eq.kind === EqKind.Simple ? EqKind.InitialSimple : eq.kind;
              emitEquation(subKind, eq.lhsExprId, eq.rhsExprId, eqFlags, dstList, i);
            }
          }
        };
        emitEvaluatedIf(
          meta.conditionExprId,
          meta.thenEquations,
          meta.elseIfClauses,
          meta.elseEquations ?? [],
          undefined,
        );
        continue;
      }
    }

    if (kind === EqKind.When) {
      const meta = dae.getWhenEquationMeta(i);
      if (meta) {
        const condId = cloneExpr(meta.conditionExprId, "", null);
        const whenIdx = out.addWhenEquation(condId);
        const whenRange = dae.getEqSourceRange?.(i);
        if (whenRange) out.setEqSourceRange(whenIdx, whenRange.startOffset, whenRange.endOffset);
        const outMeta = out.getWhenEquationMeta(whenIdx);
        if (outMeta) {
          for (const eq of meta.bodyEquations) {
            emitEquation(eq.kind, eq.lhsExprId, eq.rhsExprId, 0, outMeta.bodyEquations);
          }
          if (meta.elseWhenClauses) {
            for (const clause of meta.elseWhenClauses) {
              const clauseCond = cloneExpr(clause.conditionExprId, "", null);
              const clauseEqs: { kind: EqKind; lhsExprId: number; rhsExprId: number }[] = [];
              for (const eq of clause.bodyEquations) {
                emitEquation(eq.kind, eq.lhsExprId, eq.rhsExprId, 0, clauseEqs);
              }
              outMeta.elseWhenClauses.push({ conditionExprId: clauseCond, bodyEquations: clauseEqs, equations: [] });
            }
          }
        }
        continue;
      }
    }

    // Unroll `For` and `InitialFor` loops by evaluating loop range bounds (`evalRangeVal` / `getRangeValues`),
    // binding the loop variable in `loopVarMap`, and recursively emitting body equations.
    if (kind === EqKind.For || kind === EqKind.InitialFor) {
      const meta = dae.getForEquationMeta(i);
      if (meta) {
        const evalRangeVal = (id: number): number | null => {
          if (id < 0) return null;
          const knd = dae.getExprKind(id);
          if (knd === ExprKind.IntLiteral) return dae.getExprData1(id);
          if (knd === ExprKind.RealLiteral) return dae.getExprRealValue(id);
          if (knd === ExprKind.Negate) {
            const v = evalRangeVal(dae.getExprLeft(id));
            return v !== null ? -v : null;
          }
          if (knd === ExprKind.Name) {
            const nmRaw = dae.interner.resolve(dae.getExprData1(id));
            const nm = nmRaw?.startsWith("\0loop\0") ? nmRaw.substring(6) : nmRaw;
            if (nm && loopVarMap.has(nm)) return loopVarMap.get(nm)!;
            if (nm) {
              const vIdx = dae.getVarIdxByName(nm);
              if (
                vIdx >= 0 &&
                (dae.getVarVariability(vIdx) === Variability.Parameter ||
                  dae.getVarVariability(vIdx) === Variability.Constant)
              ) {
                const exprId = dae.getVarExpression(vIdx);
                if (typeof exprId === "number" && exprId >= 0) {
                  const ev = evalRangeVal(exprId);
                  if (ev !== null) return ev;
                }
                return dae.getVarStartValue(vIdx);
              }
            }
          }
          if (knd === ExprKind.Binary) {
            const op = dae.getExprData1(id);
            const lv = evalRangeVal(dae.getExprLeft(id));
            const rv = evalRangeVal(dae.getExprRight(id));
            if (lv !== null && rv !== null) {
              if (op === BinOp.Add) return lv + rv;
              if (op === BinOp.Sub) return lv - rv;
              if (op === BinOp.Mul) return lv * rv;
              if (op === BinOp.Div && rv !== 0) return Math.trunc(lv / rv);
            }
          }
          const cVal = evaluateConstantArenaExpression(dae, id);
          return typeof cVal === "number" ? cVal : null;
        };
        const getRangeValues = (rangeExprId: number): number[] => {
          if (rangeExprId < 0) return [];
          const rk = dae.getExprKind(rangeExprId);
          if (rk === ExprKind.Range) {
            const sVal = evalRangeVal(dae.getExprData1(rangeExprId));
            const stepId = dae.getExprLeft(rangeExprId);
            const stVal = stepId >= 0 ? evalRangeVal(stepId) : 1;
            const eVal = evalRangeVal(dae.getExprRight(rangeExprId));
            if (sVal !== null && stVal !== null && eVal !== null && stVal !== 0) {
              const vals: number[] = [];
              if (stVal > 0) {
                for (let v = sVal; v <= eVal; v += stVal) vals.push(v);
              } else {
                for (let v = sVal; v >= eVal; v += stVal) vals.push(v);
              }
              return vals;
            }
          } else if (rk === ExprKind.ArrayCtor) {
            const count = dae.getExprData1(rangeExprId);
            const vals: number[] = [];
            for (let k = 0; k < count; k++) {
              const eId = k === 0 ? dae.getExprLeft(rangeExprId) : dae.getExprLeft(rangeExprId + k);
              const v = evalRangeVal(eId);
              if (v !== null) vals.push(v);
            }
            return vals;
          }
          return [];
        };
        const unrollForEqs = (
          indexNameId: number,
          rangeExprId: number,
          bodyEquations: StructuredBodyEquation[],
          isInit: boolean,
          targetList?: { kind: EqKind; lhsExprId: number; rhsExprId: number }[],
        ) => {
          const indexNameRaw = dae.interner.resolve(indexNameId) || "i";
          const indexName = indexNameRaw.startsWith("\0loop\0") ? indexNameRaw.substring(6) : indexNameRaw;
          const vals = getRangeValues(rangeExprId);
          const prevVal = loopVarMap.get(indexName);
          for (const val of vals) {
            loopVarMap.set(indexName, val);
            for (const bodyEq of bodyEquations) {
              if (
                (bodyEq.kind === EqKind.For || bodyEq.kind === EqKind.InitialFor) &&
                Array.isArray(bodyEq.bodyEquations)
              ) {
                unrollForEqs(
                  bodyEq.lhsExprId,
                  bodyEq.rhsExprId,
                  bodyEq.bodyEquations,
                  isInit || bodyEq.kind === EqKind.InitialFor,
                  targetList,
                );
              } else if (bodyEq.kind === EqKind.If && Array.isArray(bodyEq.thenEquations)) {
                const condVal = evaluateConstantArenaExpression(dae, bodyEq.lhsExprId);
                if (typeof condVal === "boolean") {
                  if (condVal) {
                    for (const sub of bodyEq.thenEquations) {
                      const subKind = isInit && sub.kind === EqKind.Simple ? EqKind.InitialSimple : sub.kind;
                      emitEquation(subKind, sub.lhsExprId, sub.rhsExprId, eqFlags, targetList, i);
                    }
                  } else if (Array.isArray(bodyEq.elseEquations)) {
                    for (const sub of bodyEq.elseEquations) {
                      const subKind = isInit && sub.kind === EqKind.Simple ? EqKind.InitialSimple : sub.kind;
                      emitEquation(subKind, sub.lhsExprId, sub.rhsExprId, eqFlags, targetList, i);
                    }
                  }
                } else {
                  const subCond = cloneExpr(bodyEq.lhsExprId, "", null);
                  const thenList: { kind: EqKind; lhsExprId: number; rhsExprId: number }[] = [];
                  for (const sub of bodyEq.thenEquations) {
                    const subKind = isInit && sub.kind === EqKind.Simple ? EqKind.InitialSimple : sub.kind;
                    emitEquation(subKind, sub.lhsExprId, sub.rhsExprId, 0, thenList, i);
                  }
                  const elseIfList: {
                    conditionExprId: number;
                    bodyEquations: { kind: EqKind; lhsExprId: number; rhsExprId: number }[];
                    equations: { kind: EqKind; lhs: number; rhs: number; aux?: number | undefined }[];
                  }[] = [];
                  for (const c of bodyEq.elseIfClauses || []) {
                    const cCond = cloneExpr(c.conditionExprId, "", null);
                    const cBody: { kind: EqKind; lhsExprId: number; rhsExprId: number }[] = [];
                    for (const sub of c.bodyEquations || []) {
                      const subKind = isInit && sub.kind === EqKind.Simple ? EqKind.InitialSimple : sub.kind;
                      emitEquation(subKind, sub.lhsExprId, sub.rhsExprId, 0, cBody, i);
                    }
                    elseIfList.push({ conditionExprId: cCond, bodyEquations: cBody, equations: [] });
                  }
                  const elseList: { kind: EqKind; lhsExprId: number; rhsExprId: number }[] = [];
                  if (Array.isArray(bodyEq.elseEquations)) {
                    for (const sub of bodyEq.elseEquations) {
                      const subKind = isInit && sub.kind === EqKind.Simple ? EqKind.InitialSimple : sub.kind;
                      emitEquation(subKind, sub.lhsExprId, sub.rhsExprId, 0, elseList, i);
                    }
                  }
                  if (tryEmitBalancedIfAsSimple(subCond, thenList, elseIfList, elseList, eqFlags, targetList, i)) {
                    continue;
                  }
                  const ifIdx = out.addIfEquation(subCond);
                  const outIfMeta = out.getIfEquationMeta(ifIdx);
                  if (outIfMeta) {
                    outIfMeta.thenEquations.push(...thenList);
                    outIfMeta.elseIfClauses.push(...elseIfList);
                    if (Array.isArray(bodyEq.elseEquations)) {
                      outIfMeta.elseEquations ??= [];
                      outIfMeta.elseEquations.push(...elseList);
                    }
                  }
                }
              } else {
                const subKind = isInit && bodyEq.kind === EqKind.Simple ? EqKind.InitialSimple : bodyEq.kind;
                emitEquation(subKind, bodyEq.lhsExprId, bodyEq.rhsExprId, eqFlags, targetList, i);
              }
            }
          }
          if (prevVal !== undefined) {
            loopVarMap.set(indexName, prevVal);
          } else {
            loopVarMap.delete(indexName);
          }
        };
        unrollForEqs(meta.indexNameId, meta.rangeExprId, meta.bodyEquations, kind === EqKind.InitialFor);
        continue;
      }
    }

    emitEquation(kind, lhsId, rhsId, eqFlags, undefined, i);
  }

  // --- Step 6: Clone Boundary Nodes & Imperative Algorithm Statements ---
  for (const node of dae.boundaryNodes) {
    out.boundaryNodes.push({ ...node });
  }

  const stmtOffset = out.stmtCount;
  for (let i = 0; i < dae.stmtCount; i++) {
    const k = dae.getStmtKind(i);
    switch (k) {
      case StmtKind.Assignment: {
        const target = cloneExpr(dae.getStmtData1(i), "", null);
        const val = cloneExpr(dae.getStmtLeft(i), "", null);
        out.addStatement(StmtKind.Assignment, target, val);
        break;
      }
      case StmtKind.For: {
        const iterName = dae.interner.resolve(dae.getStmtData1(i)) || "";
        const range = cloneExpr(dae.getStmtLeft(i), "", null);
        out.addStatement(StmtKind.For, out.interner.intern(iterName), range, dae.getStmtRight(i));
        break;
      }
      case StmtKind.While: {
        const cond = cloneExpr(dae.getStmtData1(i), "", null);
        out.addStatement(StmtKind.While, cond, dae.getStmtLeft(i));
        break;
      }
      case StmtKind.If: {
        const cond = cloneExpr(dae.getStmtData1(i), "", null);
        out.addStatement(StmtKind.If, cond, dae.getStmtLeft(i), dae.getStmtRight(i));
        break;
      }
      case StmtKind.When: {
        const cond = cloneExpr(dae.getStmtData1(i), "", null);
        out.addStatement(StmtKind.When, cond, dae.getStmtLeft(i), dae.getStmtRight(i));
        break;
      }
      case StmtKind.Block: {
        const rawCond = dae.getStmtData1(i);
        const cond = rawCond >= 0 ? cloneExpr(rawCond, "", null) : -1;
        out.addStatement(StmtKind.Block, cond, dae.getStmtLeft(i));
        break;
      }
      case StmtKind.Return:
        out.addStatement(StmtKind.Return);
        break;
      case StmtKind.Break:
        out.addStatement(StmtKind.Break);
        break;
      case StmtKind.ProcedureCall: {
        const call = cloneExpr(dae.getStmtData1(i), "", null);
        out.addStatement(StmtKind.ProcedureCall, call);
        break;
      }
      case StmtKind.ComplexAssignment: {
        const val = cloneExpr(dae.getStmtLeft(i), "", null);
        out.addStatement(StmtKind.ComplexAssignment, dae.getStmtData1(i), val);
        break;
      }
      default:
        out.addStatement(k, dae.getStmtData1(i), dae.getStmtLeft(i), dae.getStmtRight(i));
        break;
    }
  }

  for (const algo of dae.algorithmSections) {
    out.addAlgorithmSection(stmtOffset + algo.start, algo.count);
  }

  for (const algo of dae.initialAlgorithmSections) {
    out.addInitialAlgorithmSection(stmtOffset + algo.start, algo.count);
  }

  out.isImpure = dae.isImpure;
  out.descriptionId = dae.descriptionId;
  out.name = dae.name;
  out.classKind = dae.classKind;
  out.description = dae.description;
  out.equationAnnotations = [...dae.equationAnnotations];
  const cloneStateMachine = (sm: (typeof dae.stateMachines)[number]): (typeof dae.stateMachines)[number] => ({
    ...sm,
    transitions: sm.transitions.map((t) => ({
      ...t,
      conditionExprId: t.conditionExprId >= 0 ? cloneExpr(t.conditionExprId, "", null) : t.conditionExprId,
    })),
    states: sm.states.map((s) => ({
      ...s,
      equations: s.equations.map((eq) => ({
        ...eq,
        targetNameId: out.interner.intern(dae.interner.resolve(eq.targetNameId) ?? ""),
        exprId: eq.exprId >= 0 ? cloneExpr(eq.exprId, "", null) : eq.exprId,
      })),
      variables: s.variables.map((v) => ({
        ...v,
        nameId: out.interner.intern(dae.interner.resolve(v.nameId) ?? ""),
      })),
      stateMachines: s.stateMachines ? s.stateMachines.map(cloneStateMachine) : [],
    })),
  });
  out.stateMachines = dae.stateMachines.map(cloneStateMachine);

  out.syncWasmStringPool();
  return out;
}
