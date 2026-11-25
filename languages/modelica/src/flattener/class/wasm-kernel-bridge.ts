// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Native WebAssembly Semantic Flattening Kernel invocation, diff-mode parity probing,
 * and post-WASM arena/metadata hydration bridge.
 */

import { ExprKind } from "@modelscript/dsl";
import {
  Causality,
  DAEBuilder,
  EqKind,
  foldArenaConstants,
  type SymbolEntry,
  type SymbolId,
  VarType,
} from "@modelscript/runtime";
import { BUILTIN_FUNCTIONS } from "../../builtins.js";
import { ModelicaErrorCode } from "../../errors.js";
import { getSymbolQualifiedName, SCALAR_VECTORIZABLE_FUNCTIONS } from "../expressions/index.js";
import { emitWasmBailDiagnostic, postWasmValidate } from "../post-wasm-validate.js";
import { getFlatteningState } from "../support/state.js";
import {
  describeWasmBail,
  inputEncodingUnitSize,
  type WasmBailInfo,
  WasmBailReason,
} from "../support/wasm-bail-reasons.js";
import { extractBuiltinSinCosCalleeCst, findFirstCstNode } from "./cst-token-helpers.js";
import type {
  ClassFlattenerContext,
  CstNodeLike,
  DaeDiagnosticWithOrigin,
  DaeWithExtras,
  FlatteningStateWithWasm,
  FlattenOptionsExtended,
  QueryDBWithCaches,
  WasmDiffStats,
  WasmKernelExports,
} from "./types.js";
import { populateWasmScopeResolutions, recordWasmSourceRanges } from "./wasm-scope-bridge.js";

export interface WasmKernelFlattenParams {
  ctx: ClassFlattenerContext;
  rootClassId: SymbolId;
  dae: DAEBuilder;
  cachedArena?: DAEBuilder | null | undefined;
  classCst: CstNodeLike | null;
  wasmExports: ConstructorParameters<typeof DAEBuilder>[0] | undefined;
  rootName: string;
  specKind: string | null;
  rawKind: string;
  isOldInst: boolean;
}

export interface WasmKernelFlattenResult {
  dae: DAEBuilder;
  flattenedInWasm: boolean;
  wasmBail: WasmBailInfo | null;
  wasmDiffStats: WasmDiffStats | null;
  earlyReturn: boolean;
}

export function tryFlattenWithWasmKernel(params: WasmKernelFlattenParams): WasmKernelFlattenResult {
  const { ctx, rootClassId, cachedArena, classCst, wasmExports, rootName, specKind, rawKind, isOldInst } = params;
  let { dae } = params;
  let flattenedInWasm = false;
  let wasmBail: WasmBailInfo | null = null;
  const classNodePtr = classCst?.ptr ?? classCst?.id;
  const rootProgramPtr =
    classCst?.tree?.rootPtr ?? classCst?.tree?.rootNode?.ptr ?? (ctx.db as QueryDBWithCaches)?.rootNode?.ptr ?? 0;
  const daeKernelEx = dae.exports as unknown as WasmKernelExports | undefined;
  const hasWasmFlattener = typeof daeKernelEx?.flattener_flatten === "function";
  const isStrictWasm = ctx.options.backend === "wasm";
  const isDiffMode = ctx.options.backend === "diff";
  const allowWasm =
    ctx.explicitArrayMode !== "preserve" &&
    (ctx.options.backend === "wasm" ||
      ((ctx.options.backend === "hybrid" || !ctx.options.backend) &&
        // Explicit `backend: "wasm"` runs WASM under `omcCompatibility` (via `flattener_setOmcCompatibility`),
        // whereas `hybrid` stays on TS for OMC-exact formatting parity until WASM passes the full OMC testsuite.
        !ctx.options.omcCompatibility &&
        Boolean(ctx.options.useWasmKernel) &&
        !ctx.useLocalDirection &&
        !ctx.classHasUnsupportedWasmFeatures(rootClassId)));

  let wasmDiffStats: WasmDiffStats | null = null;
  if (isDiffMode && hasWasmFlattener && classNodePtr) {
    let testDae: DAEBuilder | null = null;
    let wf = 0;
    try {
      testDae = new DAEBuilder(wasmExports, rootName, "");
      const testEx = testDae.exports as unknown as WasmKernelExports;
      wf = testEx.flattener_create ? testEx.flattener_create(testDae.ptr) : 0;
      if (wf) {
        if (
          (ctx.options.omcCompatibility || ctx.useLocalDirection) &&
          typeof testEx.flattener_setOmcCompatibility === "function"
        ) {
          const omcFlags = (ctx.options.omcCompatibility ? (isOldInst ? 1 : 2) : 0) | (ctx.useLocalDirection ? 4 : 0);
          testEx.flattener_setOmcCompatibility(wf, omcFlags);
        }
        populateWasmScopeResolutions(ctx, wf, rootClassId, testDae);
        const vc = testEx.flattener_flatten ? testEx.flattener_flatten(wf, classNodePtr, rootProgramPtr) : 0;
        const errCode = typeof testEx.flattener_getErrorCode === "function" ? testEx.flattener_getErrorCode(wf) : 0;
        const diffBail =
          errCode !== 0
            ? describeWasmBail(
                errCode,
                typeof testEx.flattener_getErrorStartByte === "function"
                  ? testEx.flattener_getErrorStartByte(wf)
                  : undefined,
                typeof testEx.flattener_getErrorEndByte === "function"
                  ? testEx.flattener_getErrorEndByte(wf)
                  : undefined,
                "ts-fallback",
                typeof testEx.lsp_isCharOffsetKernel === "function" && testEx.lsp_isCharOffsetKernel()
                  ? 1
                  : inputEncodingUnitSize(
                      typeof testEx.lsp_getInputEncoding === "function" ? testEx.lsp_getInputEncoding() : undefined,
                    ),
              )
            : undefined;
        wasmDiffStats = { varCount: vc, eqCount: testDae.eqCount, bail: diffBail };
      }
    } catch (err: unknown) {
      wasmDiffStats = { varCount: 0, eqCount: 0, error: err instanceof Error ? err.message : String(err) };
    } finally {
      const testExFin = testDae?.exports as unknown as WasmKernelExports | undefined;
      if (wf && typeof testExFin?.flattener_destroy === "function") {
        try {
          testExFin.flattener_destroy(wf);
        } catch {
          // ignore
        }
      }
      if (testDae) {
        testDae.free?.();
      }
    }
  }

  let wasmErrStartByte = -1;
  let wasmErrEndByte = -1;
  if (!cachedArena && hasWasmFlattener && classNodePtr && allowWasm) {
    let wasmFlattener = 0;
    let trappedInWasm = false;
    const ex = dae.exports as unknown as WasmKernelExports;
    try {
      wasmFlattener = typeof ex.flattener_create === "function" ? ex.flattener_create(dae.ptr) : 0;
      if (wasmFlattener) {
        if (
          (ctx.options.omcCompatibility || ctx.useLocalDirection) &&
          typeof ex.flattener_setOmcCompatibility === "function"
        ) {
          const omcFlags = (ctx.options.omcCompatibility ? (isOldInst ? 1 : 2) : 0) | (ctx.useLocalDirection ? 4 : 0);
          ex.flattener_setOmcCompatibility(wasmFlattener, omcFlags);
        }
        populateWasmScopeResolutions(ctx, wasmFlattener, rootClassId, dae);
        const varCount = ex.flattener_flatten ? ex.flattener_flatten(wasmFlattener, classNodePtr, rootProgramPtr) : 0;
        const wasmErrorCode =
          typeof ex.flattener_getErrorCode === "function" ? ex.flattener_getErrorCode(wasmFlattener) : 0;
        ctx.state.wasmErrorCode = wasmErrorCode;
        // In hybrid mode, if WASM flattener set a non-zero error code, fall back to TS
        const disabledCount =
          typeof ex.flattener_getDisabledCount === "function" ? ex.flattener_getDisabledCount(wasmFlattener) : 0;
        if (wasmErrorCode !== 0) {
          wasmErrStartByte =
            typeof ex.flattener_getErrorStartByte === "function" ? ex.flattener_getErrorStartByte(wasmFlattener) : -1;
          wasmErrEndByte =
            typeof ex.flattener_getErrorEndByte === "function" ? ex.flattener_getErrorEndByte(wasmFlattener) : -1;
          wasmBail = describeWasmBail(
            wasmErrorCode,
            wasmErrStartByte >= 0 ? wasmErrStartByte : undefined,
            wasmErrEndByte >= 0 ? wasmErrEndByte : undefined,
            isStrictWasm ? "strict-partial" : "ts-fallback",
            typeof ex.lsp_isCharOffsetKernel === "function" && ex.lsp_isCharOffsetKernel()
              ? 1
              : inputEncodingUnitSize(
                  typeof ex.lsp_getInputEncoding === "function" ? ex.lsp_getInputEncoding() : undefined,
                ),
          );
          const srcFiles = (ctx.state as FlatteningStateWithWasm).wasmSourceFiles;
          if (wasmBail.range && srcFiles) {
            const sOff = wasmBail.range.startOffset;
            const eOff = wasmBail.range.endOffset;
            const entry = srcFiles.find((f) => sOff >= f.baseUnitOffset && sOff < f.baseUnitOffset + f.unitLen);
            if (entry) {
              const lStart = sOff - entry.baseUnitOffset;
              const lEnd = Math.min(entry.unitLen, Math.max(lStart + 1, eOff - entry.baseUnitOffset));
              const snip =
                !entry.isUtf16 && entry.utf8Bytes
                  ? new TextDecoder().decode(entry.utf8Bytes.subarray(lStart, Math.min(lEnd, lStart + 240)))
                  : entry.text.slice(lStart, Math.min(lEnd, lStart + 240));
              wasmBail.file = entry.key;
              wasmBail.snippet = snip;
            }
          }
        }
        const algSectionCount: number =
          typeof ex.flattener_getAlgorithmSectionCount === "function"
            ? ex.flattener_getAlgorithmSectionCount(wasmFlattener)
            : 0;
        const hybridAlgorithmGate =
          !isStrictWasm &&
          wasmErrorCode === 0 &&
          algSectionCount > 0 &&
          Boolean((ctx.options as FlattenOptionsExtended)?.allowNonStandardModelica?.length);
        if (hybridAlgorithmGate) {
          wasmBail = describeWasmBail(WasmBailReason.HybridAlgorithmGate, undefined, undefined, "ts-fallback");
        }
        const whenRecCount: number =
          typeof ex.flattener_getWhenRecordCount === "function" ? ex.flattener_getWhenRecordCount(wasmFlattener) : 0;
        const ifRecCount: number =
          typeof ex.flattener_getIfRecordCount === "function" ? ex.flattener_getIfRecordCount(wasmFlattener) : 0;
        if ((varCount > 0 || disabledCount > 0 || isStrictWasm) && wasmErrorCode === 0 && !hybridAlgorithmGate) {
          flattenedInWasm = true;
          recordWasmSourceRanges(ctx, dae, rootClassId);
          if (disabledCount > 0 && typeof ex.flattener_getDisabledNameId === "function") {
            for (let d = 0; d < disabledCount; d++) {
              const nameId = ex.flattener_getDisabledNameId(wasmFlattener, d);
              const disabledName = nameId === 0 ? "" : dae.interner.resolve(nameId);
              if (disabledName) {
                ctx.disabledComponents.add(disabledName);
              }
            }
          }
          // Ensure any user/external functions called inside WASM-instantiated subcomponents
          // (e.g., Modelica.Math.acos or TimeTable.getInterpolationCoefficients) are flattened into dae.functions.
          {
            const origExprCount = dae.exprCount;
            const isFunctionSym = (s: SymbolEntry | undefined): boolean => {
              if (!s) return false;
              if (s.kind === "Function") return true;
              if (s.kind !== "Class") return false;
              const rk = String(s.metadata?.["classKind"] ?? s.metadata?.["classPrefixes"] ?? "").toLowerCase();
              return rk.includes("function");
            };
            const resolveFnSymbol = (callName: string) => {
              if (callName.includes(".")) {
                const parts = callName.split(".");
                const roots = ctx.db.byName(parts[0]!) ?? [];
                for (const rootSym of roots) {
                  if (rootSym.kind !== "Class" && rootSym.kind !== "Package") continue;
                  let cur: typeof rootSym | undefined = rootSym;
                  for (let p = 1; p < parts.length && cur; p++) {
                    const chs = ctx.db.childrenOf(cur.id);
                    cur = chs.find(
                      (c) =>
                        (c.kind === "Class" || c.kind === "Package" || c.kind === "Function") && c.name === parts[p],
                    );
                  }
                  if (cur && isFunctionSym(cur)) return cur;
                }
              } else {
                const cands = (ctx.db.byName(callName) ?? []).filter((s) => isFunctionSym(s));
                if (cands.length === 1) return cands[0];
              }
              return undefined;
            };
            const scannedCalls = new Set<string>();
            for (let eIdx = 0; eIdx < origExprCount; eIdx++) {
              if (dae.getExprKind(eIdx) !== ExprKind.Call) continue;
              const rawCallName = dae.interner.resolve(dae.getExprData1(eIdx));
              if (!rawCallName || dae.functions.has(rawCallName) || scannedCalls.has(rawCallName)) continue;
              scannedCalls.add(rawCallName);
              const fnSym = resolveFnSymbol(rawCallName);
              if (!fnSym) continue;
              const fnQualName = getSymbolQualifiedName(ctx.db, fnSym.id);
              if (!dae.functions.has(fnQualName)) {
                const fn = ctx.flattenFunction(fnSym.id, fnQualName, undefined, dae);
                foldArenaConstants(fn, ctx.db, fnSym.id, true);
                (fn as { wasCalled?: boolean }).wasCalled = true;
                dae.addFunction(fnQualName, fn);
              }
              if (rawCallName !== fnQualName && !dae.functions.has(rawCallName)) {
                const fnObj = dae.functions.get(fnQualName);
                if (fnObj) dae.functions.set(rawCallName, fnObj);
              }
            }
          }
          // Rewrite enum-indexed array element names (e.g., e1[1] -> e1[E.AA], x[1] -> x[Color.green])
          const daeExprEx = dae.exports as unknown as {
            dae_setExprData1?: (ptr: number, idx: number, data1: number) => void;
          };
          if (typeof daeExprEx.dae_setExprData1 === "function") {
            const arrayBaseIndices = new Map<string, Array<{ fullName: string; indices: number[] }>>();
            for (let v = 0; v < dae.varCount; v++) {
              const vName = dae.getVarName(v);
              const lb = vName.lastIndexOf("[");
              if (lb <= 0 || !vName.endsWith("]")) continue;
              const subStr = vName.slice(lb + 1, -1);
              const parts = subStr.split(",");
              if (!parts.every((p) => /^\d+$/.test(p))) continue;
              const base = vName.slice(0, lb);
              let arr = arrayBaseIndices.get(base);
              if (!arr) {
                arr = [];
                arrayBaseIndices.set(base, arr);
              }
              arr.push({ fullName: vName, indices: parts.map((p) => Number(p)) });
            }
            if (arrayBaseIndices.size > 0) {
              const resolveClassInScope = (name: string, scId: SymbolId | null) => {
                if (scId && !name.includes(".")) {
                  const resolver = ctx.db.query<((n: string) => SymbolEntry | undefined) | null>(
                    "resolveSimpleName",
                    scId,
                  );
                  const resolved = resolver?.(name);
                  if (resolved?.id) return ctx.db.symbol(resolved.id);
                }
                if (name.includes(".")) {
                  const segs = name.split(".");
                  for (const rootSym of ctx.db.byName(segs[0]!) ?? []) {
                    if (rootSym.kind !== "Class" && rootSym.kind !== "Package" && rootSym.kind !== "Type") continue;
                    let cur: typeof rootSym | undefined = rootSym;
                    for (let i = 1; i < segs.length && cur; i++) {
                      cur = ctx.db.childrenOf(cur.id).find((c) => c.name === segs[i]);
                    }
                    if (cur) return cur;
                  }
                } else {
                  const cands = (ctx.db.byName(name) ?? []).filter((s) => s.kind === "Class" || s.kind === "Type");
                  if (cands.length === 1) return cands[0];
                }
                return undefined;
              };
              const resolveEnumTypeLiterals = (typeName: string, scopeId: SymbolId | null): string[] | null => {
                let curSym = resolveClassInScope(typeName, scopeId);
                for (let hop = 0; hop < 6 && curSym; hop++) {
                  const cst = ctx.db.cstNode(curSym.id) as CstNodeLike | null;
                  if (!cst) break;
                  const enumList = findFirstCstNode(cst, (n) => n.type === "enum_list");
                  if (enumList) {
                    const rawQualName = getSymbolQualifiedName(ctx.db, curSym.id);
                    const rootQNameForEnum = getSymbolQualifiedName(ctx.db, rootClassId);
                    const isNewInstEnum = !(ctx.options.isOldFrontend || dae.extensionMetadata?.["isOldFrontend"]);
                    const qualName =
                      isNewInstEnum && rootQNameForEnum && rawQualName.startsWith(`${rootQNameForEnum}.`)
                        ? rawQualName.slice(rootQNameForEnum.length + 1)
                        : rawQualName;
                    const lits: string[] = [];
                    const walkEnum = (n: CstNodeLike) => {
                      if (n.type === "enumeration_literal") {
                        const idNode = findFirstCstNode(
                          n,
                          (c) => c.type === "IDENT" || c.type === "identifier" || c.type === "IDENTIFIER",
                        );
                        const litText = (idNode?.text ?? n.text ?? "").trim();
                        if (litText) lits.push(`${qualName}.${litText}`);
                        return;
                      }
                      if (n.children) {
                        for (const c of n.children) if (c) walkEnum(c);
                      }
                    };
                    walkEnum(enumList);
                    return lits.length > 0 ? lits : null;
                  }
                  const shortSpec = findFirstCstNode(cst, (n) => n.type === "short_class_specifier");
                  const baseTypeNode = shortSpec
                    ? findFirstCstNode(shortSpec, (n) => n.type === "type_specifier" || n.type === "name")
                    : null;
                  const baseName = baseTypeNode?.text?.trim();
                  if (!baseName || baseName === curSym.name) break;
                  curSym = resolveClassInScope(baseName, curSym.parentId ?? scopeId);
                }
                return null;
              };
              const renameMap = new Map<string, string>();
              for (const [baseName, entries] of arrayBaseIndices) {
                const leaf = baseName.includes(".") ? baseName.slice(baseName.lastIndexOf(".") + 1) : baseName;
                const compSyms = (ctx.db.byName(leaf) ?? []).filter((s) => s.kind === "Component");
                let dimEnums: Array<string[] | null> | null = null;
                for (const compSym of compSyms) {
                  const cst = ctx.db.cstNode(compSym.id) as CstNodeLike | null;
                  if (!cst) continue;
                  let subNode = findFirstCstNode(cst, (n) => n.type === "array_subscripts");
                  let anc = cst.parent;
                  for (let hop = 0; hop < 4 && !subNode && anc; hop++, anc = anc.parent) {
                    if (
                      anc.type === "component_clause" ||
                      anc.type === "component_clause1" ||
                      anc.type === "component_declaration"
                    ) {
                      subNode = findFirstCstNode(anc, (n) => n.type === "array_subscripts");
                    }
                  }
                  if (!subNode) {
                    const typeSpec = ctx.db.query<string | null>("typeSpecifier", compSym.id);
                    if (typeSpec) {
                      const typeSym = resolveClassInScope(typeSpec, compSym.parentId ?? rootClassId);
                      const typeCst = typeSym ? (ctx.db.cstNode(typeSym.id) as CstNodeLike | null) : null;
                      if (typeCst) {
                        subNode = findFirstCstNode(typeCst, (n) => n.type === "array_subscripts");
                      }
                    }
                  }
                  if (!subNode) continue;
                  const subs: string[] = [];
                  const collectSubs = (n: CstNodeLike) => {
                    if (n.type === "subscript") {
                      subs.push((n.text ?? "").trim());
                      return;
                    }
                    if (n.children) {
                      for (const c of n.children) if (c) collectSubs(c);
                    }
                  };
                  collectSubs(subNode);
                  if (subs.length === 0) continue;
                  const resolvedDims = subs.map((s) =>
                    s === "Boolean"
                      ? ["false", "true"]
                      : s && s !== ":" && !/^\d+$/.test(s)
                        ? resolveEnumTypeLiterals(s, compSym.parentId ?? rootClassId)
                        : null,
                  );
                  if (resolvedDims.some((d) => d !== null)) {
                    dimEnums = resolvedDims;
                    break;
                  }
                }
                if (!dimEnums) continue;
                for (const entry of entries) {
                  if (entry.indices.length !== dimEnums.length) continue;
                  let changed = false;
                  const newParts = entry.indices.map((idx, d) => {
                    const lits = dimEnums![d];
                    if (lits && idx >= 1 && idx <= lits.length) {
                      changed = true;
                      return lits[idx - 1]!;
                    }
                    return String(idx);
                  });
                  if (changed) {
                    renameMap.set(entry.fullName, `${baseName}[${newParts.join(",")}]`);
                  }
                }
              }
              if (renameMap.size > 0) {
                for (const [oldName, newName] of renameMap) {
                  dae.renameVar(oldName, newName);
                }
                for (let eIdx = 0; eIdx < dae.exprCount; eIdx++) {
                  if (dae.getExprKind(eIdx) !== ExprKind.Name) continue;
                  const oldName = dae.interner.resolve(dae.getExprData1(eIdx));
                  const newName = oldName ? renameMap.get(oldName) : undefined;
                  if (newName) {
                    daeExprEx.dae_setExprData1!(dae.ptr, eIdx, dae.interner.intern(newName));
                  }
                }
              }
            }
          }
          if (typeof daeExprEx.dae_setExprData1 === "function") {
            const MATH_BUILTIN_NAMES = new Set([
              "sin",
              "cos",
              "tan",
              "asin",
              "acos",
              "atan",
              "atan2",
              "sinh",
              "cosh",
              "tanh",
              "exp",
              "log",
              "log10",
              "sqrt",
            ]);
            const origExprCount = dae.exprCount;
            for (let eIdx = 0; eIdx < origExprCount; eIdx++) {
              if (dae.getExprKind(eIdx) === ExprKind.Call) {
                const rawCallName = dae.interner.resolve(dae.getExprData1(eIdx));
                const fnDae = rawCallName ? dae.functions.get(rawCallName) : undefined;
                if (!fnDae && rawCallName && rawCallName.startsWith("Modelica.Math.")) {
                  const shortName = rawCallName.slice("Modelica.Math.".length);
                  if (MATH_BUILTIN_NAMES.has(shortName)) {
                    const newId = dae.interner.intern(shortName);
                    daeExprEx.dae_setExprData1(dae.ptr, eIdx, newId);
                    continue;
                  }
                }
                if (fnDae) {
                  if (
                    rawCallName &&
                    !rawCallName.includes(".") &&
                    (BUILTIN_FUNCTIONS.has(rawCallName) || SCALAR_VECTORIZABLE_FUNCTIONS.has(rawCallName)) &&
                    fnDae.name.startsWith("Modelica.ComplexMath.")
                  ) {
                    dae.functions.delete(rawCallName);
                    continue;
                  }
                  (fnDae as { wasCalled?: boolean }).wasCalled = true;
                  let targetFnCallName =
                    fnDae.externalDecl && fnDae.externalDecl.includes('"builtin"') ? rawCallName : fnDae.name;
                  if (fnDae.externalDecl) {
                    const builtinCallee = extractBuiltinSinCosCalleeCst(fnDae.externalDecl);
                    if (builtinCallee) {
                      targetFnCallName = builtinCallee;
                    } else if (
                      fnDae.name.startsWith("Modelica.Math.") &&
                      (fnDae.externalDecl.includes('"builtin"') || fnDae.externalDecl.includes('"C"'))
                    ) {
                      const shortName = fnDae.name.slice("Modelica.Math.".length);
                      if (MATH_BUILTIN_NAMES.has(shortName)) {
                        targetFnCallName = shortName;
                      }
                    }
                  }
                  if (targetFnCallName && targetFnCallName !== rawCallName) {
                    const newId = dae.interner.intern(targetFnCallName);
                    daeExprEx.dae_setExprData1(dae.ptr, eIdx, newId);
                  }
                  if (typeof ex.flattener_setExprLeft === "function") {
                    const inputVarIndices: number[] = [];
                    for (let v = 0; v < fnDae.varCount; v++) {
                      if (fnDae.getVarCausality(v) === Causality.Input) {
                        inputVarIndices.push(v);
                      }
                    }
                    const argCount = dae.getExprRight(eIdx);
                    const limit = Math.min(argCount, inputVarIndices.length);
                    for (let argIdx = 0; argIdx < limit; argIdx++) {
                      const slotId = argIdx === 0 ? eIdx : eIdx + argIdx;
                      const argExprId = dae.getExprLeft(slotId);
                      if (argExprId === 0xffffffff || argExprId >= dae.exprCount) continue;
                      const formalVarIdx = inputVarIndices[argIdx]!;
                      const formalType = fnDae.getVarType(formalVarIdx);
                      const formalShape = fnDae.getVarShape(formalVarIdx);
                      if (
                        formalType === VarType.Real &&
                        !fnDae.getVarCustomType(formalVarIdx) &&
                        dae.getExprKind(argExprId) === ExprKind.IntLiteral
                      ) {
                        const realLitId = dae.addRealLiteral(dae.getExprData1(argExprId));
                        ex.flattener_setExprLeft(dae.ptr, slotId, realLitId);
                      } else if (
                        ctx.options.isOldFrontend &&
                        (formalShape?.length ?? 0) === 1 &&
                        dae.getExprKind(argExprId) === ExprKind.Name
                      ) {
                        const argName = dae.interner.resolve(dae.getExprData1(argExprId));
                        if (argName && dae.getVarIdxByName(argName) < 0 && dae.getVarIdxByName(`${argName}[1]`) >= 0) {
                          const elemIds: number[] = [];
                          for (let k = 1; dae.getVarIdxByName(`${argName}[${k}]`) >= 0; k++) {
                            elemIds.push(dae.addNameExpr(`${argName}[${k}]`));
                          }
                          if (elemIds.length > 0) {
                            const arrCtorId = dae.addArrayCtorExpr(elemIds);
                            ex.flattener_setExprLeft(dae.ptr, slotId, arrCtorId);
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
          if (typeof ex.flattener_getAlgorithmSectionCount === "function") {
            const secCount: number = ex.flattener_getAlgorithmSectionCount(wasmFlattener);
            for (let s = 0; s < secCount; s++) {
              const section = {
                start: ex.flattener_getAlgorithmSectionStart?.(wasmFlattener, s) ?? 0,
                count: ex.flattener_getAlgorithmSectionLength?.(wasmFlattener, s) ?? 0,
              };
              if (ex.flattener_getAlgorithmSectionIsInitial?.(wasmFlattener, s)) {
                dae.initialAlgorithmSections.push(section);
              } else {
                dae.algorithmSections.push(section);
              }
            }
            if (secCount > 0) dae.hasAlgorithmSection = true;
          }
          interface InlineEqRecord {
            kind: EqKind;
            lhsExprId: number;
            rhsExprId: number;
            thenEquations?: InlineEqRecord[] | undefined;
            elseIfClauses?:
              | {
                  conditionExprId: number;
                  bodyEquations: InlineEqRecord[];
                  equations: { kind: EqKind; lhs: number; rhs: number }[];
                }[]
              | undefined;
            elseEquations?: InlineEqRecord[] | undefined;
          }
          interface ParsedIfRec {
            ifEqIdx: number;
            conditionExprId: number;
            thenEquations: InlineEqRecord[];
            elseIfClauses: {
              conditionExprId: number;
              bodyEquations: InlineEqRecord[];
              equations: { kind: EqKind; lhs: number; rhs: number }[];
            }[];
            elseEquations: InlineEqRecord[];
          }
          const parsedIfRecords: ParsedIfRec[] = [];
          const materializeInlineEq = (kind: EqKind, lhs: number, rhs: number): InlineEqRecord => {
            if (kind === EqKind.If && rhs >= 0 && rhs < parsedIfRecords.length) {
              const sub = parsedIfRecords[rhs]!;
              return {
                kind: EqKind.If,
                lhsExprId: lhs,
                rhsExprId: -1,
                thenEquations: sub.thenEquations,
                elseIfClauses: sub.elseIfClauses,
                elseEquations: sub.elseEquations.length > 0 ? sub.elseEquations : undefined,
              };
            }
            return { kind, lhsExprId: lhs, rhsExprId: rhs };
          };
          const exIf = dae.exports as unknown as {
            flattener_getIfRecordCount?: (wf: number) => number;
            flattener_getIfRecordData: (wf: number, idx: number) => number;
          };
          if (typeof exIf.flattener_getIfRecordCount === "function" && ifRecCount > 0) {
            let offset = 0;
            for (let f = 0; f < ifRecCount; f++) {
              const ifEqIdx = exIf.flattener_getIfRecordData(wasmFlattener, offset++);
              const condExprId = exIf.flattener_getIfRecordData(wasmFlattener, offset++);
              const thenEqCount = exIf.flattener_getIfRecordData(wasmFlattener, offset++);
              const thenEquations: InlineEqRecord[] = [];
              for (let k = 0; k < thenEqCount; k++) {
                const kind = exIf.flattener_getIfRecordData(wasmFlattener, offset++) as EqKind;
                const lhs = exIf.flattener_getIfRecordData(wasmFlattener, offset++);
                const rhs = exIf.flattener_getIfRecordData(wasmFlattener, offset++);
                thenEquations.push(materializeInlineEq(kind, lhs, rhs));
              }
              const elseIfBranchCount = exIf.flattener_getIfRecordData(wasmFlattener, offset++);
              const elseIfClauses: {
                conditionExprId: number;
                bodyEquations: InlineEqRecord[];
                equations: { kind: EqKind; lhs: number; rhs: number }[];
              }[] = [];
              for (let b = 0; b < elseIfBranchCount; b++) {
                const elseCondId = exIf.flattener_getIfRecordData(wasmFlattener, offset++);
                const bEqCount = exIf.flattener_getIfRecordData(wasmFlattener, offset++);
                const bBodyEquations: InlineEqRecord[] = [];
                const bEquations: { kind: EqKind; lhs: number; rhs: number }[] = [];
                for (let k = 0; k < bEqCount; k++) {
                  const kind = exIf.flattener_getIfRecordData(wasmFlattener, offset++) as EqKind;
                  const lhs = exIf.flattener_getIfRecordData(wasmFlattener, offset++);
                  const rhs = exIf.flattener_getIfRecordData(wasmFlattener, offset++);
                  const eqObj = materializeInlineEq(kind, lhs, rhs);
                  bBodyEquations.push(eqObj);
                  bEquations.push({ kind, lhs, rhs: eqObj.rhsExprId });
                }
                elseIfClauses.push({
                  conditionExprId: elseCondId,
                  bodyEquations: bBodyEquations,
                  equations: bEquations,
                });
              }
              const elseEqCount = exIf.flattener_getIfRecordData(wasmFlattener, offset++);
              const elseEquations: InlineEqRecord[] = [];
              for (let k = 0; k < elseEqCount; k++) {
                const kind = exIf.flattener_getIfRecordData(wasmFlattener, offset++) as EqKind;
                const lhs = exIf.flattener_getIfRecordData(wasmFlattener, offset++);
                const rhs = exIf.flattener_getIfRecordData(wasmFlattener, offset++);
                elseEquations.push(materializeInlineEq(kind, lhs, rhs));
              }
              const rec: ParsedIfRec = {
                ifEqIdx,
                conditionExprId: condExprId,
                thenEquations,
                elseIfClauses,
                elseEquations,
              };
              parsedIfRecords.push(rec);
              if (ifEqIdx >= 0) {
                dae.setIfEquationMeta(ifEqIdx, {
                  conditionExprId: condExprId,
                  thenEquations,
                  elseIfClauses,
                  elseEquations: elseEquations.length > 0 ? elseEquations : undefined,
                });
              }
            }
          }
          const exWhen = dae.exports as unknown as {
            flattener_getWhenRecordCount?: (wf: number) => number;
            flattener_getWhenRecordData: (wf: number, idx: number) => number;
          };
          if (typeof exWhen.flattener_getWhenRecordCount === "function" && whenRecCount > 0) {
            let offset = 0;
            for (let w = 0; w < whenRecCount; w++) {
              const whenEqIdx = exWhen.flattener_getWhenRecordData(wasmFlattener, offset++);
              const condExprId = exWhen.flattener_getWhenRecordData(wasmFlattener, offset++);
              const mainEqCount = exWhen.flattener_getWhenRecordData(wasmFlattener, offset++);
              const bodyEquations: InlineEqRecord[] = [];
              const equations: { kind: EqKind; lhs: number; rhs: number }[] = [];
              for (let k = 0; k < mainEqCount; k++) {
                const kind = exWhen.flattener_getWhenRecordData(wasmFlattener, offset++) as EqKind;
                const lhs = exWhen.flattener_getWhenRecordData(wasmFlattener, offset++);
                const rhs = exWhen.flattener_getWhenRecordData(wasmFlattener, offset++);
                const eqObj = materializeInlineEq(kind, lhs, rhs);
                bodyEquations.push(eqObj);
                equations.push({ kind, lhs, rhs: eqObj.rhsExprId });
              }
              const elseWhenBranchCount = exWhen.flattener_getWhenRecordData(wasmFlattener, offset++);
              const elseWhenClauses: {
                conditionExprId: number;
                bodyEquations: InlineEqRecord[];
                equations: { kind: EqKind; lhs: number; rhs: number }[];
              }[] = [];
              for (let b = 0; b < elseWhenBranchCount; b++) {
                const elseCondId = exWhen.flattener_getWhenRecordData(wasmFlattener, offset++);
                const bEqCount = exWhen.flattener_getWhenRecordData(wasmFlattener, offset++);
                const bBodyEquations: InlineEqRecord[] = [];
                const bEquations: { kind: EqKind; lhs: number; rhs: number }[] = [];
                for (let k = 0; k < bEqCount; k++) {
                  const kind = exWhen.flattener_getWhenRecordData(wasmFlattener, offset++) as EqKind;
                  const lhs = exWhen.flattener_getWhenRecordData(wasmFlattener, offset++);
                  const rhs = exWhen.flattener_getWhenRecordData(wasmFlattener, offset++);
                  const eqObj = materializeInlineEq(kind, lhs, rhs);
                  bBodyEquations.push(eqObj);
                  bEquations.push({ kind, lhs, rhs: eqObj.rhsExprId });
                }
                elseWhenClauses.push({
                  conditionExprId: elseCondId,
                  bodyEquations: bBodyEquations,
                  equations: bEquations,
                });
              }
              dae.setWhenEquationMeta(whenEqIdx, {
                conditionExprId: condExprId,
                bodyEquations,
                equations,
                elseWhenClauses,
                elseEquations: [],
              });
            }
          }
          const exEqDesc = dae.exports as unknown as {
            flattener_getEqDescCount?: (wf: number) => number;
            flattener_getEqDescEqIdx?: (wf: number, idx: number) => number;
            flattener_getEqDescStrId?: (wf: number, idx: number) => number;
          };
          if (
            ctx.options.omcCompatibility &&
            !isOldInst &&
            typeof exEqDesc.flattener_getEqDescCount === "function" &&
            typeof exEqDesc.flattener_getEqDescEqIdx === "function" &&
            typeof exEqDesc.flattener_getEqDescStrId === "function"
          ) {
            const descCount = exEqDesc.flattener_getEqDescCount(wasmFlattener);
            for (let i = 0; i < descCount; i++) {
              const eqIdx = exEqDesc.flattener_getEqDescEqIdx(wasmFlattener, i);
              const strId = exEqDesc.flattener_getEqDescStrId(wasmFlattener, i);
              const descStr = dae.interner.resolve(strId);
              if (descStr) dae.setEqDescription(eqIdx, descStr);
            }
          }
          for (let i = 0; i < dae.eqCount; i++) {
            const rhsId = dae.getEqRhs(i);
            dae.setOrigEqRhs(i, rhsId);
            if (rhsId >= 0) {
              const names = dae.collectExprVarNames(rhsId);
              for (const name of names) {
                dae.registerParamEquationDep(name, i);
              }
            }
            const lhsId = dae.getEqLhs(i);
            if (lhsId >= 0) {
              const names = dae.collectExprVarNames(lhsId);
              for (const name of names) {
                dae.registerParamEquationDep(name, i);
              }
            }
          }
          if (typeof ex.flattener_getExpandableBusCount === "function") {
            const busCount = ex.flattener_getExpandableBusCount(wasmFlattener);
            const busPrefixes: string[] = [];
            for (let b = 0; b < busCount; b++) {
              const id = ex.flattener_getExpandableBus?.(wasmFlattener, b) ?? 0;
              const busName = id === 0 ? "" : (dae.interner.resolve(id) ?? "");
              busPrefixes.push(busName);
              ctx.expandableBuses.set(busName, 0);
            }
            dae.extensionMetadata.expandableBuses = busPrefixes;
          }
          if (typeof ex.flattener_getArrayCount === "function") {
            const aCount = ex.flattener_getArrayCount(wasmFlattener);
            for (let a = 0; a < aCount; a++) {
              const nameId = ex.flattener_getArrayName?.(wasmFlattener, a) ?? 0;
              const name = dae.interner.resolve(nameId);
              if (name) {
                const nDims = ex.flattener_getArrayNDims?.(wasmFlattener, a) ?? 0;
                const d1 = ex.flattener_getArrayDim1?.(wasmFlattener, a) ?? 0;
                const d2 = ex.flattener_getArrayDim2?.(wasmFlattener, a) ?? 0;
                const d3 = ex.flattener_getArrayDim3?.(wasmFlattener, a) ?? 0;
                const d4 =
                  typeof ex.flattener_getArrayDim4 === "function" ? ex.flattener_getArrayDim4(wasmFlattener, a) : 0;
                const shape: number[] = [];
                if (nDims >= 1) shape.push(d1);
                if (nDims >= 2) shape.push(d2);
                if (nDims >= 3) shape.push(d3);
                if (nDims >= 4) shape.push(d4);
                dae.setNamedArrayShape(name, shape);
              }
            }
          }
          if (typeof ex.flattener_getInnerCount === "function") {
            const innerCount = ex.flattener_getInnerCount(wasmFlattener);
            const innerSet: Set<string> = (ctx.state.innerComponents ??= new Set<string>());
            for (let idx = 0; idx < innerCount; idx++) {
              const fullPathId = ex.flattener_getInnerFullPath?.(wasmFlattener, idx) ?? 0;
              const fullPath = dae.interner.resolve(fullPathId);
              if (fullPath) {
                innerSet.add(fullPath);
                ctx.innerOuterComponents.add(fullPath);
              }
            }
          }
          if (typeof ex.flattener_getOuterMapCount === "function") {
            const outerCount = ex.flattener_getOuterMapCount(wasmFlattener);
            const outerMap: Map<string, string> = (ctx.state.outerToInner ??= new Map<string, string>());
            const innerSet: Set<string> = (ctx.state.innerComponents ??= new Set<string>());
            for (let idx = 0; idx < outerCount; idx++) {
              const outerId = ex.flattener_getOuterPath?.(wasmFlattener, idx) ?? 0;
              const targetId = ex.flattener_getTargetInnerPath?.(wasmFlattener, idx) ?? 0;
              const outerPath = dae.interner.resolve(outerId);
              const targetPath = dae.interner.resolve(targetId);
              if (outerPath && targetPath) {
                outerMap.set(outerPath, targetPath);
                innerSet.add(targetPath);
                ctx.innerOuterComponents.add(outerPath);
                ctx.innerOuterComponents.add(targetPath);
              }
            }
          }
          if (typeof ex.flattener_getOcBranchCount === "function") {
            const ocRootCount = ex.flattener_getOcRootCount?.(wasmFlattener) ?? 0;
            const ocPotCount = ex.flattener_getOcPotentialRootCount?.(wasmFlattener) ?? 0;
            const ocBranchCount = ex.flattener_getOcBranchCount(wasmFlattener) ?? 0;
            const ocQueriedCount = ex.flattener_getOcQueriedRootCount?.(wasmFlattener) ?? 0;
            if (ocRootCount > 0 || ocPotCount > 0 || ocBranchCount > 0 || ocQueriedCount > 0) {
              const roots = new Set<string>();
              for (let idx = 0; idx < ocRootCount; idx++) {
                const s = dae.interner.resolve(ex.flattener_getOcRoot?.(wasmFlattener, idx) ?? 0);
                if (s) roots.add(s);
              }
              const potentialRoots = new Map<string, number>();
              for (let idx = 0; idx < ocPotCount; idx++) {
                const s = dae.interner.resolve(ex.flattener_getOcPotentialRoot?.(wasmFlattener, idx) ?? 0);
                const prio = ex.flattener_getOcPotentialRootPrio?.(wasmFlattener, idx) ?? 0;
                if (s) {
                  const prev = potentialRoots.get(s);
                  if (prev === undefined || prio < prev) potentialRoots.set(s, prio);
                }
              }
              const branches: { a: string; b: string }[] = [];
              for (let idx = 0; idx < ocBranchCount; idx++) {
                const sa = dae.interner.resolve(ex.flattener_getOcBranchA?.(wasmFlattener, idx) ?? 0);
                const sb = dae.interner.resolve(ex.flattener_getOcBranchB?.(wasmFlattener, idx) ?? 0);
                if (sa && sb) branches.push({ a: sa, b: sb });
              }
              const queriedRoots = new Set<string>();
              for (let idx = 0; idx < ocQueriedCount; idx++) {
                const s = dae.interner.resolve(ex.flattener_getOcQueriedRoot?.(wasmFlattener, idx) ?? 0);
                if (s) queriedRoots.add(s);
              }
              dae.extensionMetadata["overconstrainedGraph"] = { roots, potentialRoots, branches, queriedRoots };
            }
          }
          const totalVars = dae.varCount;
          for (let v = 0; v < totalVars; v++) {
            if ((dae.getVarFlags(v) & (1 << 9)) !== 0) {
              dae.setVarDescription(v, "virtual variable in expandable connector");
            }
          }
        }
      }
    } catch (err: unknown) {
      trappedInWasm = true;
      flattenedInWasm = false;
      const errMsg = err instanceof Error ? err.message : String(err);
      const bail = describeWasmBail(
        WasmBailReason.KernelTrap,
        undefined,
        undefined,
        isStrictWasm ? "strict-partial" : "ts-fallback",
      );
      if (errMsg) {
        bail.description = `${bail.description}: ${errMsg}`;
      }
      wasmBail ??= bail;
    } finally {
      if (!trappedInWasm && wasmFlattener && typeof ex.flattener_destroy === "function") {
        try {
          ex.flattener_destroy(wasmFlattener);
        } catch {
          // ignore
        }
      }
    }
    if (!flattenedInWasm) {
      if (isStrictWasm) {
        emitWasmBailDiagnostic(
          ctx.db,
          dae,
          rootClassId,
          ctx.state.wasmErrorCode ?? 0,
          wasmErrStartByte,
          wasmErrEndByte,
        );
        if (!dae.diagnostics.some((d) => d.severity === "error" && !(d as DaeDiagnosticWithOrigin).fromFunction)) {
          postWasmValidate(ctx.db, dae, rootClassId, ctx.failedFunctionIds, ctx.invalidInterfaceFunctionIds);
        }
        if (!dae.diagnostics.some((d) => d.severity === "error")) {
          dae.diagnostics.push({
            code: ModelicaErrorCode.WASM_FLATTENER_UNSUPPORTED.code,
            rule: "wasm-flattener-unsupported",
            severity: "error",
            message: `[ModelicaFlattener] Model '${rootName}' could not be flattened using strict WASM backend.`,
            range: null,
          });
        }
        if (wasmBail) {
          ctx.state.wasmBail = wasmBail;
          (dae as DaeWithExtras).wasmBail = wasmBail;
        }
        return { dae, flattenedInWasm, wasmBail, wasmDiffStats, earlyReturn: true };
      }
      const savedDesc = dae.description;
      const savedDiags = dae.diagnostics;
      const savedExtMeta = dae.extensionMetadata;
      const savedExperiment = dae.experiment;
      const savedFunctions = dae.functions;
      dae.free?.();
      dae = new DAEBuilder(wasmExports, rootName, "");
      dae.description = savedDesc;
      dae.diagnostics = savedDiags;
      dae.extensionMetadata = savedExtMeta;
      dae.experiment = savedExperiment;
      dae.functions = savedFunctions;
      ctx.currentRootDae = dae;
      ctx.state = getFlatteningState(dae, ctx);
      ctx.state.innerOuterComponents = ctx.innerOuterComponents;
      ctx.state.activeLoopVars = ctx.activeLoopVars;
      ctx.state.db = ctx.db;
      ctx.state.flattener = ctx;
      ctx.state.currentClassId = rootClassId;
      ctx.currentClassId = rootClassId;
      dae.classKind = specKind ?? rawKind;
    }
  }
  return { dae, flattenedInWasm, wasmBail, wasmDiffStats, earlyReturn: false };
}
