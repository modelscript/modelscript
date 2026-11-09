// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview WebAssembly Bytecode Reverse-Mode Automatic Differentiation Synthesizer (`wasm-enzyme`).
 *
 * Implements compiler-level bytecode-to-bytecode transformation on WebAssembly modules.
 * Synthesizes an exact adjoint function $f^\dagger(x_1, \dots, x_n, \bar{y}) \to (\bar{x}_1, \dots, \bar{x}_n)$
 * directly from binary WASM instructions, supporting:
 * - Straight-line arithmetic & transcendental intrinsics (`add`, `sub`, `mul`, `div`, `neg`, `sqrt`, `abs`)
 * - Piecewise branchless selection (`OP_SELECT`)
 * - Structured control flow (`OP_IF` / `OP_ELSE` / `OP_END`) with branch condition recording
 * - Bounded/counted loops (`OP_LOOP` / `OP_BLOCK` / `OP_BR_IF` / `OP_BR`) via automatic linear-memory forward taping
 * - Linear memory loads and stores (`OP_F64_LOAD` / `OP_F64_STORE`) with shadow memory gradient accumulation
 *
 * Academic Citations:
 * - Moses, W. S., & Churavy, V. (2020). "Instead of rewriting everything, combine differentiable
 *   programming with existing code (Enzyme)." Advances in Neural Information Processing Systems, 33, 12472-12485.
 * - Griewank, A., & Walther, A. (2008). Evaluating Derivatives: Principles and Techniques of
 *   Algorithmic Differentiation (2nd ed.). SIAM. ISBN: 978-0-898716-59-7.
 */

import {
  decodeWasmModule,
  encodeWasmModule,
  OP_BLOCK,
  OP_BR,
  OP_BR_IF,
  OP_CALL,
  OP_ELSE,
  OP_END,
  OP_F64_ABS,
  OP_F64_ADD,
  OP_F64_CONST,
  OP_F64_DIV,
  OP_F64_EQ,
  OP_F64_GE,
  OP_F64_GT,
  OP_F64_LE,
  OP_F64_LOAD,
  OP_F64_LT,
  OP_F64_MUL,
  OP_F64_NE,
  OP_F64_NEG,
  OP_F64_SQRT,
  OP_F64_STORE,
  OP_F64_SUB,
  OP_I32_ADD,
  OP_I32_CONST,
  OP_I32_EQ,
  OP_I32_EQZ,
  OP_I32_GE_S,
  OP_I32_GT_S,
  OP_I32_LE_S,
  OP_I32_LOAD,
  OP_I32_LT_S,
  OP_I32_MUL,
  OP_I32_NE,
  OP_I32_STORE,
  OP_I32_SUB,
  OP_IF,
  OP_LOCAL_GET,
  OP_LOCAL_SET,
  OP_LOCAL_TEE,
  OP_LOOP,
  OP_RETURN,
  OP_SELECT,
  TYPE_F64,
  TYPE_I32,
  TYPE_VOID,
  type WasmFunction,
  type WasmInstruction,
  type WasmMemArg,
  type WasmModule,
  type WasmType,
} from "./wasm-cfg.js";

export interface WasmAdjointOptions {
  /** Custom export name for the synthesized adjoint function (default: `${targetFuncName}_adjoint`). */
  adjointExportName?: string | undefined;
  /**
   * Byte offset in linear memory where shadow gradients $\bar{M}[\text{addr} + \text{shadowMemoryOffset}]$
   * are stored and accumulated for `f64.load` and `f64.store` instructions (default: `4096`).
   */
  shadowMemoryOffset?: number | undefined;
  /**
   * Byte offset in linear memory used as the base of the forward-pass loop value tape stack
   * (default: `16384`).
   */
  tapeMemoryOffset?: number | undefined;
}

export interface WasmAdjointResult {
  /** Transformed WebAssembly binary bytes containing both the original and synthesized adjoint functions. */
  wasmBytes: Uint8Array;
  /** Name of the synthesized adjoint function export. */
  adjointExportName: string;
}

/**
 * Synthesizes a reverse-mode adjoint function for an exported WASM function.
 *
 * @param wasmBytes The input compiled WebAssembly binary module.
 * @param targetFuncName The name of the exported function to differentiate: $f(x_1, \dots, x_n) \to y$.
 * @param adjointExportNameOrOptions Optional custom export name or configuration object.
 */
export function differentiateWasmModule(
  wasmBytes: Uint8Array,
  targetFuncName: string,
  adjointExportNameOrOptions?: string | WasmAdjointOptions,
): WasmAdjointResult {
  const options: WasmAdjointOptions =
    typeof adjointExportNameOrOptions === "string"
      ? { adjointExportName: adjointExportNameOrOptions }
      : (adjointExportNameOrOptions ?? {});

  const module = decodeWasmModule(wasmBytes);
  const outName = options.adjointExportName ?? `${targetFuncName}_adjoint`;
  const shadowMemoryOffset = options.shadowMemoryOffset ?? 4096;
  const tapeMemoryOffset = options.tapeMemoryOffset ?? 16384;

  // 1. Locate target export
  const targetExp = module.exports.find((e) => e.name === targetFuncName && e.kind === 0);
  if (!targetExp) {
    throw new Error(`differentiateWasmModule: Exported function '${targetFuncName}' not found.`);
  }

  // Check if any function in the module uses loops and ensure module has linear memory for loop taping
  const anyUsesLoop = module.code.some((fn) => fn.instructions.some((inst) => inst.opcode === OP_LOOP));
  if (anyUsesLoop && (!module.memories || module.memories.length === 0)) {
    module.memories = [{ min: 1 }];
  }

  const adjointFuncMap = new Map<number, number>();
  const tapeOffsetRef = { current: tapeMemoryOffset };

  function ensureFunctionAdjoint(fnIdx: number): number {
    const existing = adjointFuncMap.get(fnIdx);
    if (existing !== undefined) {
      return existing;
    }

    const typeIdx = module.functions[fnIdx];
    if (typeIdx === undefined) {
      throw new Error(`differentiateWasmModule: Function index ${fnIdx} has no associated type.`);
    }

    const origType = module.types[typeIdx];
    if (!origType) {
      throw new Error(`differentiateWasmModule: Type index ${typeIdx} not found in module.`);
    }

    const nOrigParams = origType.params.length;
    const f64ParamIndices: number[] = [];
    for (let i = 0; i < nOrigParams; i++) {
      const pType = origType.params[i]!;
      if (pType === TYPE_F64) {
        f64ParamIndices.push(i);
      } else if (pType !== TYPE_I32) {
        throw new Error(
          `differentiateWasmModule: Parameter ${i} has unsupported type 0x${pType.toString(16)} (only f64 and i32 supported).`,
        );
      }
    }

    const hasF64Result = origType.results.length > 0 && origType.results[0] === TYPE_F64;

    const origCode = module.code[fnIdx];
    if (!origCode) {
      throw new Error(`differentiateWasmModule: Code for function ${fnIdx} not found.`);
    }

    // Synthesize adjoint type:
    // params: [...origType.params, ...(hasF64Result ? [TYPE_F64] : [])]
    // results: one TYPE_F64 per f64 parameter in origType.params
    const adjointType: WasmType = {
      params: hasF64Result ? [...origType.params, TYPE_F64] : [...origType.params],
      results: new Array(f64ParamIndices.length).fill(TYPE_F64),
    };

    const adjointTypeIdx = module.types.length;
    module.types.push(adjointType);

    // Reserve function slot before synthesizing body (supports call graph recursion)
    const newFuncIdx = module.functions.length;
    module.functions.push(adjointTypeIdx);
    module.code.push({ typeIdx: adjointTypeIdx, locals: [], instructions: [] });
    adjointFuncMap.set(fnIdx, newFuncIdx);

    const adjointFunc = synthesizeAdjointFunction(
      origCode,
      origType,
      hasF64Result,
      adjointTypeIdx,
      shadowMemoryOffset,
      tapeOffsetRef,
      module,
      ensureFunctionAdjoint,
    );
    module.code[newFuncIdx] = adjointFunc;
    return newFuncIdx;
  }

  const rootAdjointIdx = ensureFunctionAdjoint(targetExp.index);

  module.exports.push({
    name: outName,
    kind: 0,
    index: rootAdjointIdx,
  });

  const transformedBytes = encodeWasmModule(module);
  return {
    wasmBytes: transformedBytes,
    adjointExportName: outName,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Structured IR for Forward Taping & Reverse Adjoint Code Generation
// ─────────────────────────────────────────────────────────────────────────────

interface ExprNode {
  id: number;
  op: WasmInstruction;
  args: ExprNode[];
  isI32: boolean;
  needsSave: boolean;
  savedLocal?: number | undefined;
  addrLocal?: number | undefined;
  calleeAdjointIdx?: number | undefined;
  calleeParamTypes?: number[] | undefined;
}

type StmtNode =
  | {
      kind: "assign_local";
      targetLocal: number; // remapped local index in adjoint function
      isF64: boolean;
      expr: ExprNode;
    }
  | {
      kind: "store_mem";
      opcode: number;
      memarg: WasmMemArg;
      addrExpr: ExprNode;
      valExpr: ExprNode;
      addrLocal: number;
    }
  | {
      kind: "call_void";
      calleeIdx: number;
      calleeAdjointIdx: number;
      calleeParamTypes: number[];
      args: ExprNode[];
    }
  | {
      kind: "if_else";
      condExpr: ExprNode;
      condLocal: number;
      thenStmts: StmtNode[];
      elseStmts: StmtNode[];
    }
  | {
      kind: "loop";
      pattern: "do_while" | "while_block";
      exitCondExpr?: ExprNode | undefined;
      continueCondExpr?: ExprNode | undefined;
      bodyStmts: StmtNode[];
      tripCountLocal: number;
      tapeBaseOffset: number;
    };

function isComparisonOrI32Op(op: number): boolean {
  return (
    op === OP_I32_CONST ||
    op === OP_I32_EQZ ||
    op === OP_I32_EQ ||
    op === OP_I32_NE ||
    op === OP_I32_LT_S ||
    op === OP_I32_GT_S ||
    op === OP_I32_LE_S ||
    op === OP_I32_GE_S ||
    op === OP_I32_ADD ||
    op === OP_I32_SUB ||
    op === OP_I32_MUL ||
    op === OP_I32_LOAD ||
    op === OP_F64_EQ ||
    op === OP_F64_NE ||
    op === OP_F64_LT ||
    op === OP_F64_GT ||
    op === OP_F64_LE ||
    op === OP_F64_GE
  );
}

function isBinaryOp(op: number): boolean {
  return (
    op === OP_F64_ADD ||
    op === OP_F64_SUB ||
    op === OP_F64_MUL ||
    op === OP_F64_DIV ||
    op === OP_F64_EQ ||
    op === OP_F64_NE ||
    op === OP_F64_LT ||
    op === OP_F64_GT ||
    op === OP_F64_LE ||
    op === OP_F64_GE ||
    op === OP_I32_EQ ||
    op === OP_I32_NE ||
    op === OP_I32_LT_S ||
    op === OP_I32_GT_S ||
    op === OP_I32_LE_S ||
    op === OP_I32_GE_S ||
    op === OP_I32_ADD ||
    op === OP_I32_SUB ||
    op === OP_I32_MUL
  );
}

function isUnaryOp(op: number): boolean {
  return (
    op === OP_F64_NEG ||
    op === OP_F64_SQRT ||
    op === OP_F64_ABS ||
    op === OP_I32_EQZ ||
    op === OP_F64_LOAD ||
    op === OP_I32_LOAD
  );
}

function synthesizeAdjointFunction(
  origCode: WasmFunction,
  origType: WasmType,
  hasF64Result: boolean,
  typeIdx: number,
  shadowMemoryOffset: number,
  tapeOffsetRef: { current: number },
  module: WasmModule,
  ensureFunctionAdjoint: (fnIdx: number) => number,
): WasmFunction {
  const nOrigParams = origType.params.length;
  const barYLocal = hasF64Result ? nOrigParams : -1;
  const nAdjointParams = nOrigParams + (hasF64Result ? 1 : 0);

  // Build map of original local types (params + declared locals)
  const origLocalTypes: number[] = [...origType.params];
  for (const decl of origCode.locals) {
    for (let c = 0; c < decl.count; c++) {
      origLocalTypes.push(decl.type);
    }
  }
  const nOrigTotalLocals = origLocalTypes.length;
  const nOrigDeclaredLocals = nOrigTotalLocals - nOrigParams;

  // Remap an original local index to its index in the adjoint function
  const remapOrigLocal = (origIdx: number): number => {
    if (origIdx < nOrigParams) return origIdx;
    return origIdx + (hasF64Result ? 1 : 0);
  };

  const getRemappedLocalType = (remappedIdx: number): number => {
    if (remappedIdx < nOrigParams) return origType.params[remappedIdx]!;
    if (hasF64Result && remappedIdx === barYLocal) return TYPE_F64;
    const origIdx = remappedIdx - (hasF64Result ? 1 : 0);
    return origLocalTypes[origIdx] ?? TYPE_F64;
  };

  // Local pools in adjoint function:
  // [0 .. nOrigParams - 1]: original params
  // [barYLocal]: seed bar_y (if hasF64Result)
  // [nAdjointParams .. nAdjointParams + nOrigDeclaredLocals - 1]: original declared locals
  // [f64PoolBase .. f64PoolBase + 255]: shadow locals for all remapped locals + scratch f64 locals
  // [i32PoolBase .. i32PoolBase + 127]: scratch i32 locals (conditions, loop counters, addresses)
  const f64PoolBase = nAdjointParams + nOrigDeclaredLocals;
  const NUM_RESERVED_F64 = 256;
  const i32PoolBase = f64PoolBase + NUM_RESERVED_F64;
  const NUM_RESERVED_I32 = 128;

  // Every remapped local index `rIdx` in [0 .. f64PoolBase - 1] gets a dedicated shadow f64 local
  // at `f64PoolBase + rIdx`.
  const shadowLocalFor = (remappedIdx: number): number => f64PoolBase + remappedIdx;
  let nextF64Scratch = f64PoolBase + f64PoolBase;
  let nextI32Scratch = i32PoolBase;

  const allocF64 = (): number => nextF64Scratch++;
  const allocI32 = (): number => nextI32Scratch++;

  // Strip trailing OP_END and any OP_RETURN
  const rawInsts = origCode.instructions.filter((inst) => inst.opcode !== OP_RETURN);
  if (rawInsts.length > 0 && rawInsts[rawInsts.length - 1]!.opcode === OP_END) {
    rawInsts.pop();
  }

  let nextExprId = 1;

  function markSaved(node: ExprNode): void {
    if (node.op.opcode === OP_F64_CONST || node.op.opcode === OP_I32_CONST) return;
    node.needsSave = true;
    if (node.savedLocal === undefined) {
      node.savedLocal = node.isI32 ? allocI32() : allocF64();
    }
  }

  // Parse a range of instructions [start, end) into statements and remaining stack expressions
  function parseBlock(
    insts: WasmInstruction[],
    start: number,
    end: number,
  ): { stmts: StmtNode[]; stack: ExprNode[]; nextPos: number } {
    const stmts: StmtNode[] = [];
    const stack: ExprNode[] = [];
    let pos = start;

    while (pos < end) {
      const inst = insts[pos]!;
      const op = inst.opcode;

      if (op === OP_ELSE || op === OP_END) {
        break;
      }

      if (op === OP_LOCAL_GET) {
        const remapped = remapOrigLocal(inst.imm);
        const lType = getRemappedLocalType(remapped);
        stack.push({
          id: nextExprId++,
          op: { opcode: OP_LOCAL_GET, imm: remapped },
          args: [],
          isI32: lType === TYPE_I32,
          needsSave: false,
        });
        pos++;
      } else if (op === OP_F64_CONST) {
        stack.push({
          id: nextExprId++,
          op: inst,
          args: [],
          isI32: false,
          needsSave: false,
        });
        pos++;
      } else if (op === OP_I32_CONST) {
        stack.push({
          id: nextExprId++,
          op: inst,
          args: [],
          isI32: true,
          needsSave: false,
        });
        pos++;
      } else if (isBinaryOp(op)) {
        const right = stack.pop()!;
        const left = stack.pop()!;
        if (op === OP_F64_MUL || op === OP_F64_DIV) {
          markSaved(left);
          markSaved(right);
        }
        const node: ExprNode = {
          id: nextExprId++,
          op: inst,
          args: [left, right],
          isI32: isComparisonOrI32Op(op),
          needsSave: false,
        };
        stack.push(node);
        pos++;
      } else if (isUnaryOp(op)) {
        const child = stack.pop()!;
        if (op === OP_F64_SQRT || op === OP_F64_ABS) {
          markSaved(child);
        }
        const node: ExprNode = {
          id: nextExprId++,
          op: inst,
          args: [child],
          isI32: isComparisonOrI32Op(op),
          needsSave: false,
        };
        if (op === OP_F64_LOAD) {
          markSaved(child);
          node.addrLocal = child.savedLocal;
          markSaved(node);
        }
        stack.push(node);
        pos++;
      } else if (op === OP_SELECT) {
        const cond = stack.pop()!;
        const val2 = stack.pop()!;
        const val1 = stack.pop()!;
        markSaved(cond);
        const node: ExprNode = {
          id: nextExprId++,
          op: inst,
          args: [val1, val2, cond],
          isI32: val1.isI32,
          needsSave: false,
        };
        stack.push(node);
        pos++;
      } else if (op === OP_CALL) {
        const calleeIdx = inst.imm as number;
        const calleeTypeIdx = module.functions[calleeIdx];
        if (calleeTypeIdx === undefined) {
          throw new Error(`synthesizeAdjointFunction: OP_CALL target function ${calleeIdx} not found.`);
        }
        const calleeType = module.types[calleeTypeIdx]!;
        const nArgs = calleeType.params.length;
        const callArgs: ExprNode[] = new Array(nArgs);
        for (let a = nArgs - 1; a >= 0; a--) {
          const argExpr = stack.pop()!;
          markSaved(argExpr);
          callArgs[a] = argExpr;
        }
        const calleeAdjointIdx = ensureFunctionAdjoint(calleeIdx);
        if (calleeType.results.length > 0) {
          const node: ExprNode = {
            id: nextExprId++,
            op: inst,
            args: callArgs,
            isI32: calleeType.results[0] === TYPE_I32,
            needsSave: false,
            calleeAdjointIdx,
            calleeParamTypes: calleeType.params,
          };
          stack.push(node);
        } else {
          stmts.push({
            kind: "call_void",
            calleeIdx,
            calleeAdjointIdx,
            calleeParamTypes: calleeType.params,
            args: callArgs,
          });
        }
        pos++;
      } else if (op === OP_LOCAL_SET || op === OP_LOCAL_TEE) {
        const val = stack.pop()!;
        const remapped = remapOrigLocal(inst.imm);
        const isF64 = getRemappedLocalType(remapped) === TYPE_F64;
        stmts.push({
          kind: "assign_local",
          targetLocal: remapped,
          isF64,
          expr: val,
        });
        if (op === OP_LOCAL_TEE) {
          stack.push({
            id: nextExprId++,
            op: { opcode: OP_LOCAL_GET, imm: remapped },
            args: [],
            isI32: !isF64,
            needsSave: false,
          });
        }
        pos++;
      } else if (op === OP_F64_STORE || op === OP_I32_STORE) {
        const valExpr = stack.pop()!;
        const addrExpr = stack.pop()!;
        markSaved(addrExpr);
        stmts.push({
          kind: "store_mem",
          opcode: op,
          memarg: inst.imm as WasmMemArg,
          addrExpr,
          valExpr,
          addrLocal: addrExpr.savedLocal!,
        });
        pos++;
      } else if (op === OP_IF) {
        const blockType = inst.imm;
        const condExpr = stack.pop()!;
        const condLocal = allocI32();
        pos++; // consume OP_IF

        const thenParsed = parseBlock(insts, pos, end);
        pos = thenParsed.nextPos;

        let elseStmts: StmtNode[] = [];
        let elseStack: ExprNode[] = [];
        if (pos < end && insts[pos]!.opcode === OP_ELSE) {
          pos++; // consume OP_ELSE
          const elseParsed = parseBlock(insts, pos, end);
          elseStmts = elseParsed.stmts;
          elseStack = elseParsed.stack;
          pos = elseParsed.nextPos;
        }
        if (pos < end && insts[pos]!.opcode === OP_END) {
          pos++; // consume OP_END
        }

        const thenStmts = [...thenParsed.stmts];
        if (blockType === TYPE_F64 || (thenParsed.stack.length > 0 && elseStack.length > 0)) {
          const branchResLocal = allocF64();
          const thenVal = thenParsed.stack.pop()!;
          const elseVal = elseStack.pop()!;
          thenStmts.push({
            kind: "assign_local",
            targetLocal: branchResLocal,
            isF64: true,
            expr: thenVal,
          });
          elseStmts.push({
            kind: "assign_local",
            targetLocal: branchResLocal,
            isF64: true,
            expr: elseVal,
          });
          stack.push({
            id: nextExprId++,
            op: { opcode: OP_LOCAL_GET, imm: branchResLocal },
            args: [],
            isI32: false,
            needsSave: false,
          });
        }

        stmts.push({
          kind: "if_else",
          condExpr,
          condLocal,
          thenStmts,
          elseStmts,
        });
      } else if (op === OP_BLOCK && pos + 1 < end && insts[pos + 1]!.opcode === OP_LOOP) {
        // Pattern 2: block { loop { exitCond; br_if 1; bodyStmts; br 0; end } end }
        pos += 2; // consume OP_BLOCK and OP_LOOP
        // Find matching ends for loop and block
        let depth = 2;
        let loopEndPos = pos;
        while (loopEndPos < end && depth > 0) {
          const curOp = insts[loopEndPos]!.opcode;
          if (curOp === OP_BLOCK || curOp === OP_LOOP || curOp === OP_IF) depth++;
          else if (curOp === OP_END) depth--;
          loopEndPos++;
        }
        // Inside the loop: [pos .. loopEndPos - 2)
        const innerEnd = loopEndPos - 2;
        // Find OP_BR_IF 1
        let brIfPos = pos;
        while (brIfPos < innerEnd && !(insts[brIfPos]!.opcode === OP_BR_IF && insts[brIfPos]!.imm === 1)) {
          brIfPos++;
        }
        const condParsed = parseBlock(insts, pos, brIfPos);
        const exitCondExpr = condParsed.stack.pop()!;
        // Body is after br_if 1 up to optional trailing `br 0`
        let bodyEnd = innerEnd;
        if (bodyEnd > brIfPos + 1 && insts[bodyEnd - 1]!.opcode === OP_BR && insts[bodyEnd - 1]!.imm === 0) {
          bodyEnd--;
        }
        const bodyParsed = parseBlock(insts, brIfPos + 1, bodyEnd);
        const tripCountLocal = allocI32();
        const loopStmt: StmtNode = {
          kind: "loop",
          pattern: "while_block",
          exitCondExpr,
          bodyStmts: bodyParsed.stmts,
          tripCountLocal,
          tapeBaseOffset: tapeOffsetRef.current,
        };
        tapeOffsetRef.current += 4096;
        stmts.push(loopStmt);
        pos = loopEndPos;
      } else if (op === OP_LOOP) {
        // Pattern 1: loop { bodyStmts; continueCond; br_if 0; end }
        pos++; // consume OP_LOOP
        let depth = 1;
        let loopEndPos = pos;
        while (loopEndPos < end && depth > 0) {
          const curOp = insts[loopEndPos]!.opcode;
          if (curOp === OP_BLOCK || curOp === OP_LOOP || curOp === OP_IF) depth++;
          else if (curOp === OP_END) depth--;
          loopEndPos++;
        }
        const innerEnd = loopEndPos - 1; // before OP_END
        // Last instruction before OP_END is OP_BR_IF 0
        const brIfPos = innerEnd - 1;
        const bodyAndCond = parseBlock(insts, pos, brIfPos);
        const continueCondExpr = bodyAndCond.stack.pop()!;
        const tripCountLocal = allocI32();
        const loopStmt: StmtNode = {
          kind: "loop",
          pattern: "do_while",
          continueCondExpr,
          bodyStmts: bodyAndCond.stmts,
          tripCountLocal,
          tapeBaseOffset: tapeOffsetRef.current,
        };
        tapeOffsetRef.current += 4096;
        stmts.push(loopStmt);
        pos = loopEndPos;
      } else {
        pos++;
      }
    }

    return { stmts, stack, nextPos: pos };
  }

  const parsed = parseBlock(rawInsts, 0, rawInsts.length);
  const topLevelStmts = parsed.stmts;

  // If the function returns an f64 expression on the stack, bind it to a virtual result local
  let returnResultLocal = -1;
  if (hasF64Result && parsed.stack.length > 0) {
    const retExpr = parsed.stack.pop()!;
    returnResultLocal = allocF64();
    topLevelStmts.push({
      kind: "assign_local",
      targetLocal: returnResultLocal,
      isF64: true,
      expr: retExpr,
    });
  }

  // Helper to collect all saved locals within a statement list (for loop taping)
  function collectSavedLocalsInExpr(expr: ExprNode, outF64: number[], outI32: number[]): void {
    for (const arg of expr.args) {
      collectSavedLocalsInExpr(arg, outF64, outI32);
    }
    if (expr.needsSave && expr.savedLocal !== undefined) {
      if (expr.isI32) {
        if (!outI32.includes(expr.savedLocal)) outI32.push(expr.savedLocal);
      } else {
        if (!outF64.includes(expr.savedLocal)) outF64.push(expr.savedLocal);
      }
    }
  }

  function collectSavedLocalsInStmts(stmts: StmtNode[], outF64: number[], outI32: number[]): void {
    for (const s of stmts) {
      if (s.kind === "assign_local") {
        collectSavedLocalsInExpr(s.expr, outF64, outI32);
      } else if (s.kind === "store_mem") {
        collectSavedLocalsInExpr(s.addrExpr, outF64, outI32);
        collectSavedLocalsInExpr(s.valExpr, outF64, outI32);
      } else if (s.kind === "call_void") {
        for (const arg of s.args) {
          collectSavedLocalsInExpr(arg, outF64, outI32);
        }
      } else if (s.kind === "if_else") {
        if (!outI32.includes(s.condLocal)) outI32.push(s.condLocal);
        collectSavedLocalsInStmts(s.thenStmts, outF64, outI32);
        collectSavedLocalsInStmts(s.elseStmts, outF64, outI32);
      }
    }
  }

  // ── Emit Forward Pass ──
  const instructions: WasmInstruction[] = [];

  // Initialize all shadow f64 locals to 0.0
  for (let rIdx = 0; rIdx < f64PoolBase; rIdx++) {
    instructions.push({ opcode: OP_F64_CONST, imm: 0.0 });
    instructions.push({ opcode: OP_LOCAL_SET, imm: shadowLocalFor(rIdx) });
  }

  function emitForwardExpr(expr: ExprNode, out: WasmInstruction[]): void {
    for (const arg of expr.args) {
      emitForwardExpr(arg, out);
    }
    out.push(expr.op);
    if (expr.needsSave && expr.savedLocal !== undefined) {
      out.push({ opcode: OP_LOCAL_TEE, imm: expr.savedLocal });
    }
  }

  function emitForwardStmts(stmts: StmtNode[], out: WasmInstruction[]): void {
    for (const stmt of stmts) {
      if (stmt.kind === "assign_local") {
        emitForwardExpr(stmt.expr, out);
        out.push({ opcode: OP_LOCAL_SET, imm: stmt.targetLocal });
      } else if (stmt.kind === "store_mem") {
        emitForwardExpr(stmt.addrExpr, out);
        emitForwardExpr(stmt.valExpr, out);
        out.push({ opcode: stmt.opcode, imm: stmt.memarg });
      } else if (stmt.kind === "call_void") {
        for (const arg of stmt.args) {
          emitForwardExpr(arg, out);
        }
        out.push({ opcode: OP_CALL, imm: stmt.calleeIdx });
      } else if (stmt.kind === "if_else") {
        emitForwardExpr(stmt.condExpr, out);
        out.push({ opcode: OP_LOCAL_TEE, imm: stmt.condLocal });
        out.push({ opcode: OP_IF, imm: TYPE_VOID });
        emitForwardStmts(stmt.thenStmts, out);
        if (stmt.elseStmts.length > 0) {
          out.push({ opcode: OP_ELSE });
          emitForwardStmts(stmt.elseStmts, out);
        }
        out.push({ opcode: OP_END });
      } else if (stmt.kind === "loop") {
        const tapedF64: number[] = [];
        const tapedI32: number[] = [];
        collectSavedLocalsInStmts(stmt.bodyStmts, tapedF64, tapedI32);
        const stride = tapedF64.length * 8 + tapedI32.length * 4;

        // tripCount = 0
        out.push({ opcode: OP_I32_CONST, imm: 0 });
        out.push({ opcode: OP_LOCAL_SET, imm: stmt.tripCountLocal });

        const emitTapePush = (): void => {
          if (stride > 0) {
            for (let k = 0; k < tapedF64.length; k++) {
              // addr = tripCount * stride
              out.push({ opcode: OP_LOCAL_GET, imm: stmt.tripCountLocal });
              out.push({ opcode: OP_I32_CONST, imm: stride });
              out.push({ opcode: OP_I32_MUL });
              out.push({ opcode: OP_LOCAL_GET, imm: tapedF64[k]! });
              out.push({
                opcode: OP_F64_STORE,
                imm: { align: 3, offset: stmt.tapeBaseOffset + k * 8 },
              });
            }
            for (let k = 0; k < tapedI32.length; k++) {
              out.push({ opcode: OP_LOCAL_GET, imm: stmt.tripCountLocal });
              out.push({ opcode: OP_I32_CONST, imm: stride });
              out.push({ opcode: OP_I32_MUL });
              out.push({ opcode: OP_LOCAL_GET, imm: tapedI32[k]! });
              out.push({
                opcode: OP_I32_STORE,
                imm: { align: 2, offset: stmt.tapeBaseOffset + tapedF64.length * 8 + k * 4 },
              });
            }
          }
          // tripCount += 1
          out.push({ opcode: OP_LOCAL_GET, imm: stmt.tripCountLocal });
          out.push({ opcode: OP_I32_CONST, imm: 1 });
          out.push({ opcode: OP_I32_ADD });
          out.push({ opcode: OP_LOCAL_SET, imm: stmt.tripCountLocal });
        };

        if (stmt.pattern === "while_block") {
          out.push({ opcode: OP_BLOCK, imm: TYPE_VOID });
          out.push({ opcode: OP_LOOP, imm: TYPE_VOID });
          emitForwardExpr(stmt.exitCondExpr!, out);
          out.push({ opcode: OP_BR_IF, imm: 1 });
          emitForwardStmts(stmt.bodyStmts, out);
          emitTapePush();
          out.push({ opcode: OP_BR, imm: 0 });
          out.push({ opcode: OP_END });
          out.push({ opcode: OP_END });
        } else {
          out.push({ opcode: OP_LOOP, imm: TYPE_VOID });
          emitForwardStmts(stmt.bodyStmts, out);
          emitTapePush();
          emitForwardExpr(stmt.continueCondExpr!, out);
          out.push({ opcode: OP_BR_IF, imm: 0 });
          out.push({ opcode: OP_END });
        }
      }
    }
  }

  emitForwardStmts(topLevelStmts, instructions);

  // ── Emit Reverse Adjoint Pass ──
  // Seed returnResultLocal's adjoint with barYLocal
  const exprAdjointLocals = new Map<number, number>();
  function getExprAdjointLocal(nodeId: number): number {
    let loc = exprAdjointLocals.get(nodeId);
    if (loc === undefined) {
      loc = allocF64();
      exprAdjointLocals.set(nodeId, loc);
    }
    return loc;
  }

  function emitSavedValueGet(node: ExprNode, out: WasmInstruction[]): void {
    if (node.savedLocal !== undefined) {
      out.push({ opcode: OP_LOCAL_GET, imm: node.savedLocal });
    } else if (node.op.opcode === OP_LOCAL_GET) {
      out.push({ opcode: OP_LOCAL_GET, imm: node.op.imm });
    } else if (node.op.opcode === OP_F64_CONST || node.op.opcode === OP_I32_CONST) {
      out.push(node.op);
    } else {
      emitForwardExpr(node, out);
    }
  }

  let emitReverseExpr = (node: ExprNode, seedAdjointLocal: number, out: WasmInstruction[]): void => {
    const op = node.op.opcode;

    if (op === OP_LOCAL_GET) {
      const rIdx = node.op.imm as number;
      if (getRemappedLocalType(rIdx) === TYPE_F64) {
        const sLoc = shadowLocalFor(rIdx);
        out.push({ opcode: OP_LOCAL_GET, imm: sLoc });
        out.push({ opcode: OP_LOCAL_GET, imm: seedAdjointLocal });
        out.push({ opcode: OP_F64_ADD });
        out.push({ opcode: OP_LOCAL_SET, imm: sLoc });
      }
      return;
    }

    if (op === OP_F64_CONST || op === OP_I32_CONST || node.isI32) {
      return;
    }

    if (op === OP_F64_LOAD) {
      const memarg = node.op.imm as WasmMemArg;
      const shadowOffset = (memarg?.offset ?? 0) + shadowMemoryOffset;
      const align = memarg?.align ?? 3;
      const addrExpr = node.args[0]!;
      // shadow_mem[addr + shadowOffset] += seedAdjointLocal
      emitSavedValueGet(addrExpr, out);
      emitSavedValueGet(addrExpr, out);
      out.push({ opcode: OP_F64_LOAD, imm: { align, offset: shadowOffset } });
      out.push({ opcode: OP_LOCAL_GET, imm: seedAdjointLocal });
      out.push({ opcode: OP_F64_ADD });
      out.push({ opcode: OP_F64_STORE, imm: { align, offset: shadowOffset } });
      return;
    }

    if (op === OP_CALL) {
      for (let a = 0; a < node.args.length; a++) {
        emitSavedValueGet(node.args[a]!, out);
      }
      out.push({ opcode: OP_LOCAL_GET, imm: seedAdjointLocal });
      out.push({ opcode: OP_CALL, imm: node.calleeAdjointIdx! });

      const paramTypes = node.calleeParamTypes ?? [];
      const argAdjointLocals: (number | undefined)[] = new Array(node.args.length);
      for (let a = node.args.length - 1; a >= 0; a--) {
        if (paramTypes[a] === TYPE_F64) {
          const adjLoc = allocF64();
          out.push({ opcode: OP_LOCAL_SET, imm: adjLoc });
          argAdjointLocals[a] = adjLoc;
        }
      }
      for (let a = 0; a < node.args.length; a++) {
        const adjLoc = argAdjointLocals[a];
        if (adjLoc !== undefined) {
          emitReverseExpr(node.args[a]!, adjLoc, out);
        }
      }
      return;
    }

    if (op === OP_F64_ADD) {
      const [left, right] = node.args;
      emitReverseExpr(left!, seedAdjointLocal, out);
      emitReverseExpr(right!, seedAdjointLocal, out);
    } else if (op === OP_F64_SUB) {
      const [left, right] = node.args;
      emitReverseExpr(left!, seedAdjointLocal, out);
      const negSeed = allocF64();
      out.push({ opcode: OP_LOCAL_GET, imm: seedAdjointLocal });
      out.push({ opcode: OP_F64_NEG });
      out.push({ opcode: OP_LOCAL_SET, imm: negSeed });
      emitReverseExpr(right!, negSeed, out);
    } else if (op === OP_F64_MUL) {
      const [left, right] = node.args;
      const adjLeft = allocF64();
      out.push({ opcode: OP_LOCAL_GET, imm: seedAdjointLocal });
      emitSavedValueGet(right!, out);
      out.push({ opcode: OP_F64_MUL });
      out.push({ opcode: OP_LOCAL_SET, imm: adjLeft });
      emitReverseExpr(left!, adjLeft, out);

      const adjRight = allocF64();
      out.push({ opcode: OP_LOCAL_GET, imm: seedAdjointLocal });
      emitSavedValueGet(left!, out);
      out.push({ opcode: OP_F64_MUL });
      out.push({ opcode: OP_LOCAL_SET, imm: adjRight });
      emitReverseExpr(right!, adjRight, out);
    } else if (op === OP_F64_DIV) {
      const [left, right] = node.args;
      const adjLeft = allocF64();
      out.push({ opcode: OP_LOCAL_GET, imm: seedAdjointLocal });
      emitSavedValueGet(right!, out);
      out.push({ opcode: OP_F64_DIV });
      out.push({ opcode: OP_LOCAL_SET, imm: adjLeft });
      emitReverseExpr(left!, adjLeft, out);

      const adjRight = allocF64();
      out.push({ opcode: OP_LOCAL_GET, imm: seedAdjointLocal });
      emitSavedValueGet(left!, out);
      out.push({ opcode: OP_F64_MUL });
      emitSavedValueGet(right!, out);
      out.push({ opcode: OP_F64_DIV });
      emitSavedValueGet(right!, out);
      out.push({ opcode: OP_F64_DIV });
      out.push({ opcode: OP_F64_NEG });
      out.push({ opcode: OP_LOCAL_SET, imm: adjRight });
      emitReverseExpr(right!, adjRight, out);
    } else if (op === OP_F64_NEG) {
      const [child] = node.args;
      const negSeed = allocF64();
      out.push({ opcode: OP_LOCAL_GET, imm: seedAdjointLocal });
      out.push({ opcode: OP_F64_NEG });
      out.push({ opcode: OP_LOCAL_SET, imm: negSeed });
      emitReverseExpr(child!, negSeed, out);
    } else if (op === OP_F64_SQRT) {
      const [child] = node.args;
      const adjChild = allocF64();
      out.push({ opcode: OP_LOCAL_GET, imm: seedAdjointLocal });
      out.push({ opcode: OP_F64_CONST, imm: 0.5 });
      out.push({ opcode: OP_F64_MUL });
      emitSavedValueGet(child!, out);
      out.push({ opcode: OP_F64_SQRT });
      out.push({ opcode: OP_F64_DIV });
      out.push({ opcode: OP_LOCAL_SET, imm: adjChild });
      emitReverseExpr(child!, adjChild, out);
    } else if (op === OP_F64_ABS) {
      const [child] = node.args;
      const adjChild = allocF64();
      out.push({ opcode: OP_LOCAL_GET, imm: seedAdjointLocal });
      out.push({ opcode: OP_LOCAL_GET, imm: seedAdjointLocal });
      out.push({ opcode: OP_F64_NEG });
      emitSavedValueGet(child!, out);
      out.push({ opcode: OP_F64_CONST, imm: 0.0 });
      out.push({ opcode: OP_F64_GE });
      out.push({ opcode: OP_SELECT });
      out.push({ opcode: OP_LOCAL_SET, imm: adjChild });
      emitReverseExpr(child!, adjChild, out);
    } else if (op === OP_SELECT) {
      const [val1, val2, cond] = node.args;
      const adjVal1 = allocF64();
      out.push({ opcode: OP_LOCAL_GET, imm: seedAdjointLocal });
      out.push({ opcode: OP_F64_CONST, imm: 0.0 });
      emitSavedValueGet(cond!, out);
      out.push({ opcode: OP_SELECT });
      out.push({ opcode: OP_LOCAL_SET, imm: adjVal1 });
      emitReverseExpr(val1!, adjVal1, out);

      const adjVal2 = allocF64();
      out.push({ opcode: OP_F64_CONST, imm: 0.0 });
      out.push({ opcode: OP_LOCAL_GET, imm: seedAdjointLocal });
      emitSavedValueGet(cond!, out);
      out.push({ opcode: OP_SELECT });
      out.push({ opcode: OP_LOCAL_SET, imm: adjVal2 });
      emitReverseExpr(val2!, adjVal2, out);
    }
  };

  if (returnResultLocal >= 0 && barYLocal >= 0) {
    // Seed shadow local of returnResultLocal with barYLocal
    // Note: returnResultLocal is in f64Pool, so we use a dedicated shadow or seed directly
    instructions.push({ opcode: OP_LOCAL_GET, imm: barYLocal });
    instructions.push({ opcode: OP_LOCAL_SET, imm: getExprAdjointLocal(returnResultLocal) });
  }

  function getShadowForTargetLocal(targetLocal: number): number {
    if (targetLocal < f64PoolBase) {
      return shadowLocalFor(targetLocal);
    }
    return getExprAdjointLocal(targetLocal);
  }

  // Also allow OP_LOCAL_GET of synthetic branchResLocal (targetLocal >= f64PoolBase)
  const origEmitReverseExpr = emitReverseExpr;
  emitReverseExpr = (node: ExprNode, seedAdjointLocal: number, out: WasmInstruction[]): void => {
    if (node.op.opcode === OP_LOCAL_GET) {
      const rIdx = node.op.imm as number;
      if (rIdx >= f64PoolBase) {
        const sLoc = getExprAdjointLocal(rIdx);
        out.push({ opcode: OP_LOCAL_GET, imm: sLoc });
        out.push({ opcode: OP_LOCAL_GET, imm: seedAdjointLocal });
        out.push({ opcode: OP_F64_ADD });
        out.push({ opcode: OP_LOCAL_SET, imm: sLoc });
        return;
      }
    }
    origEmitReverseExpr(node, seedAdjointLocal, out);
  };

  function emitReverseStmts(stmts: StmtNode[], out: WasmInstruction[]): void {
    for (let i = stmts.length - 1; i >= 0; i--) {
      const stmt = stmts[i]!;
      if (stmt.kind === "assign_local") {
        if (!stmt.isF64) continue;
        const sLoc = getShadowForTargetLocal(stmt.targetLocal);
        const tmpBar = allocF64();
        // tmpBar = shadow[targetLocal]; shadow[targetLocal] = 0.0
        out.push({ opcode: OP_LOCAL_GET, imm: sLoc });
        out.push({ opcode: OP_LOCAL_SET, imm: tmpBar });
        out.push({ opcode: OP_F64_CONST, imm: 0.0 });
        out.push({ opcode: OP_LOCAL_SET, imm: sLoc });
        emitReverseExpr(stmt.expr, tmpBar, out);
      } else if (stmt.kind === "store_mem") {
        if (stmt.opcode !== OP_F64_STORE) continue;
        const shadowOffset = (stmt.memarg?.offset ?? 0) + shadowMemoryOffset;
        const align = stmt.memarg?.align ?? 3;
        const tmpBar = allocF64();
        // tmpBar = shadow_mem[addr + shadowOffset]; shadow_mem[addr + shadowOffset] = 0.0
        emitSavedValueGet(stmt.addrExpr, out);
        out.push({ opcode: OP_F64_LOAD, imm: { align, offset: shadowOffset } });
        out.push({ opcode: OP_LOCAL_SET, imm: tmpBar });
        emitSavedValueGet(stmt.addrExpr, out);
        out.push({ opcode: OP_F64_CONST, imm: 0.0 });
        out.push({ opcode: OP_F64_STORE, imm: { align, offset: shadowOffset } });
        emitReverseExpr(stmt.valExpr, tmpBar, out);
      } else if (stmt.kind === "call_void") {
        for (let a = 0; a < stmt.args.length; a++) {
          emitSavedValueGet(stmt.args[a]!, out);
        }
        out.push({ opcode: OP_CALL, imm: stmt.calleeAdjointIdx });

        const argAdjointLocals: (number | undefined)[] = new Array(stmt.args.length);
        for (let a = stmt.args.length - 1; a >= 0; a--) {
          if (stmt.calleeParamTypes[a] === TYPE_F64) {
            const adjLoc = allocF64();
            out.push({ opcode: OP_LOCAL_SET, imm: adjLoc });
            argAdjointLocals[a] = adjLoc;
          }
        }
        for (let a = 0; a < stmt.args.length; a++) {
          const adjLoc = argAdjointLocals[a];
          if (adjLoc !== undefined) {
            emitReverseExpr(stmt.args[a]!, adjLoc, out);
          }
        }
      } else if (stmt.kind === "if_else") {
        out.push({ opcode: OP_LOCAL_GET, imm: stmt.condLocal });
        out.push({ opcode: OP_IF, imm: TYPE_VOID });
        emitReverseStmts(stmt.thenStmts, out);
        if (stmt.elseStmts.length > 0) {
          out.push({ opcode: OP_ELSE });
          emitReverseStmts(stmt.elseStmts, out);
        }
        out.push({ opcode: OP_END });
      } else if (stmt.kind === "loop") {
        const tapedF64: number[] = [];
        const tapedI32: number[] = [];
        collectSavedLocalsInStmts(stmt.bodyStmts, tapedF64, tapedI32);
        const stride = tapedF64.length * 8 + tapedI32.length * 4;

        out.push({ opcode: OP_BLOCK, imm: TYPE_VOID });
        out.push({ opcode: OP_LOOP, imm: TYPE_VOID });
        // if (tripCount == 0) break
        out.push({ opcode: OP_LOCAL_GET, imm: stmt.tripCountLocal });
        out.push({ opcode: OP_I32_EQZ });
        out.push({ opcode: OP_BR_IF, imm: 1 });
        // tripCount -= 1
        out.push({ opcode: OP_LOCAL_GET, imm: stmt.tripCountLocal });
        out.push({ opcode: OP_I32_CONST, imm: 1 });
        out.push({ opcode: OP_I32_SUB });
        out.push({ opcode: OP_LOCAL_SET, imm: stmt.tripCountLocal });

        // Restore taped locals for iteration `tripCount`
        if (stride > 0) {
          for (let k = 0; k < tapedF64.length; k++) {
            out.push({ opcode: OP_LOCAL_GET, imm: stmt.tripCountLocal });
            out.push({ opcode: OP_I32_CONST, imm: stride });
            out.push({ opcode: OP_I32_MUL });
            out.push({
              opcode: OP_F64_LOAD,
              imm: { align: 3, offset: stmt.tapeBaseOffset + k * 8 },
            });
            out.push({ opcode: OP_LOCAL_SET, imm: tapedF64[k]! });
          }
          for (let k = 0; k < tapedI32.length; k++) {
            out.push({ opcode: OP_LOCAL_GET, imm: stmt.tripCountLocal });
            out.push({ opcode: OP_I32_CONST, imm: stride });
            out.push({ opcode: OP_I32_MUL });
            out.push({
              opcode: OP_I32_LOAD,
              imm: { align: 2, offset: stmt.tapeBaseOffset + tapedF64.length * 8 + k * 4 },
            });
            out.push({ opcode: OP_LOCAL_SET, imm: tapedI32[k]! });
          }
        }

        emitReverseStmts(stmt.bodyStmts, out);
        out.push({ opcode: OP_BR, imm: 0 });
        out.push({ opcode: OP_END });
        out.push({ opcode: OP_END });
      }
    }
  }

  emitReverseStmts(topLevelStmts, instructions);

  // ── Emit Final Result: Push all f64 parameter gradients onto the stack ──
  for (let i = 0; i < nOrigParams; i++) {
    if (origType.params[i] === TYPE_F64) {
      instructions.push({ opcode: OP_LOCAL_GET, imm: shadowLocalFor(i) });
    }
  }
  instructions.push({ opcode: OP_END });

  return {
    typeIdx,
    locals: [
      ...origCode.locals,
      { count: NUM_RESERVED_F64, type: TYPE_F64 },
      { count: NUM_RESERVED_I32, type: TYPE_I32 },
    ],
    instructions,
  };
}
