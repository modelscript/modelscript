// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Host-to-WASM scope resolution and source-range recording bridge.
 */

import { ExprKind } from "@modelscript/dsl";
import { type DAEBuilder, type SymbolEntry, type SymbolId, VarType } from "@modelscript/runtime";
import type { SyntaxNode } from "../../../src-gen/bindings.js";
import { MODELICA_BASE_CONSTANTS, MODELICA_CONSTANTS } from "../../constants.js";
import { extractDescription } from "../elaboration/index.js";
import {
  extractEnumLiteralsFromCst,
  getSymbolQualifiedName,
  tokenizeCommentStrippedWords,
} from "../expressions/index.js";
import { inputEncodingUnitSize } from "../support/wasm-bail-reasons.js";
import { markConditionalParametersFinal } from "./annotations-and-extensions.js";
import { extractFirstDeclToken, findDeclElementModificationValueCst } from "./cst-token-helpers.js";
import type {
  ClassFlattenerContext,
  ComponentInstanceQueryData,
  CstNodeLike,
  FlatteningStateWithWasm,
  SymbolMetaLike,
} from "./types.js";

export function recordWasmSourceRanges(ctx: ClassFlattenerContext, dae: DAEBuilder, classId: SymbolId): void {
  const cst = ctx.db.cstNode(classId) as CstNodeLike | null;
  if (!cst) return;

  const topEqNodes: CstNodeLike[] = [];
  const bodyForEqNodes: CstNodeLike[] = [];
  let hasCompoundEq = false;
  const walkEqs = (node: CstNodeLike | null | undefined, insideCompound = false): void => {
    if (!node) return;
    if (
      (node !== cst && node.type === "class_definition") ||
      node.type === "extends_clause" ||
      node.type === "component_clause" ||
      node.type === "component_clause1" ||
      node.type === "component_declaration" ||
      node.type === "algorithm_section"
    ) {
      return;
    }

    if (node.type === "for_equation" || node.type === "if_equation" || node.type === "when_equation") {
      hasCompoundEq = true;
      for (const child of node.children || []) {
        walkEqs(child, true);
      }
      return;
    }

    if (node.type === "simple_equation" || node.type === "connect_equation" || node.type === "function_call") {
      if (insideCompound) {
        bodyForEqNodes.push(node);
      } else {
        topEqNodes.push(node);
      }
      return;
    }

    for (const child of node.children || []) {
      walkEqs(child, insideCompound);
    }
  };
  walkEqs(cst, false);

  const applyEqNodeMeta = (eqIdx: number, node: CstNodeLike | null | undefined): void => {
    if (!node) return;
    const sB = node.startIndex ?? node.startOffset;
    const eB = node.endIndex ?? node.endOffset;
    if (sB != null && eB != null && eqIdx >= 0 && eqIdx < dae.getEqCount()) {
      dae.setEqSourceRange(eqIdx, sB, eB);
      for (const c of node.children || []) {
        if (c.type === "description" || c.type === "description_string" || c.type === "string_literal") {
          const t = c.text?.trim();
          if (t) dae.setEqDescription(eqIdx, t);
          break;
        }
      }
    }
  };

  const totalEqs = dae.getEqCount();
  if (!hasCompoundEq && topEqNodes.length > 0 && topEqNodes.length <= totalEqs) {
    // Root class equations are emitted after inherited/subcomponent equations in WASM flattening
    const offset = totalEqs - topEqNodes.length;
    for (let i = 0; i < topEqNodes.length; i++) {
      applyEqNodeMeta(offset + i, topEqNodes[i]);
    }
  } else if (hasCompoundEq && topEqNodes.length === 0 && bodyForEqNodes.length === 1 && totalEqs > 0) {
    // Single unrolled loop/branch body equation: propagate its source range and description
    for (let i = 0; i < totalEqs; i++) {
      applyEqNodeMeta(i, bodyForEqNodes[0]);
    }
  }

  // Pre-resolve all variable names so interner lookup succeeds in getVarIdxByName
  const varCount = dae.varCount;
  for (let i = 0; i < varCount; i++) {
    dae.getVarName(i);
  }

  const walkVars = (node: CstNodeLike | null | undefined): void => {
    if (!node) return;
    if (node !== cst && node.type === "class_definition") return;
    if (
      node.type === "component_declaration" ||
      node.type === "component_declaration1" ||
      node.type === "declaration"
    ) {
      const declNodes: CstNodeLike[] =
        node.type === "component_declaration" || node.type === "component_declaration1"
          ? (node.children || []).filter((c) => c.type === "declaration")
          : [node];
      if (declNodes.length === 0) declNodes.push(node);

      let typeSpecNode: CstNodeLike | null | undefined = null;
      let pNode: CstNodeLike | null | undefined = node;
      while (pNode && pNode.type !== "composition") {
        typeSpecNode = (pNode.children || []).find((c) => c.type === "type_specifier" || c.type === "name");
        if (typeSpecNode) break;
        pNode = pNode.parent;
      }
      const rawTypeName = typeSpecNode?.text?.trim();
      const leafTypeName = rawTypeName ? rawTypeName.split(".").pop() : undefined;

      for (const declNode of declNodes) {
        const idChild = (declNode.children || []).find((c) => c.type === "identifier");
        const name = idChild ? idChild.text?.trim() : extractFirstDeclToken(declNode.text);
        if (name) {
          let varIdx = dae.getVarIdxByName(name);
          if (varIdx < 0) {
            varIdx = dae.getVarIdxByName(`${name}[1]`);
          }
          const sB = declNode.startIndex ?? declNode.startOffset;
          const eB = declNode.endIndex ?? declNode.endOffset;
          if (varIdx >= 0 && sB != null && eB != null) {
            dae.setVarSourceRange(varIdx, sB, eB);
            const arrayIndices = dae.getArrayElementIndices(name);
            for (const idx of arrayIndices) {
              dae.setVarSourceRange(idx, sB, eB);
            }
          }
          const desc = extractDescription(node as SyntaxNode);
          if (desc && varIdx >= 0) {
            dae.setVarDescription(varIdx, desc);
            const arrayIndices = dae.getArrayElementIndices(name);
            for (const idx of arrayIndices) {
              dae.setVarDescription(idx, desc);
            }
          }
          let p = node.parent;
          while (p && p.type !== "element" && p.type !== "composition") {
            p = p.parent;
          }
          const isFinalElement =
            p &&
            p.type === "element" &&
            ((p.children || []).some((c) => c.type === "final" || c.text?.trim() === "final") ||
              tokenizeCommentStrippedWords((p.text ?? "").split("(")[0] ?? "").includes("final"));
          if (isFinalElement) {
            if (varIdx >= 0) {
              dae.setVarFinal(varIdx, true);
            }
            const arrayIndices = dae.getArrayElementIndices(name);
            for (const idx of arrayIndices) {
              dae.setVarFinal(idx, true);
            }
            for (let i = 0; i < dae.varCount; i++) {
              const vName = dae.getVarName(i);
              if (vName === name || vName.startsWith(`${name}.`) || vName.startsWith(`${name}[`)) {
                dae.setVarFinal(i, true);
              }
            }
          }
          if (varIdx >= 0) {
            const targetModRoot = declNode ?? node;
            const qValRaw = findDeclElementModificationValueCst(targetModRoot, "quantity");
            if (qValRaw && qValRaw.startsWith('"') && qValRaw.endsWith('"')) {
              try {
                const qStr = JSON.parse(qValRaw);
                const qId = dae.addExpression(ExprKind.StringLiteral, dae.interner.intern(qStr));
                dae.setVarAttr(varIdx, "quantity", qId);
                const arrayIndices = dae.getArrayElementIndices(name);
                for (const idx of arrayIndices) {
                  dae.setVarAttr(idx, "quantity", qId);
                }
              } catch {
                // Fallback for non-standard string escapes in Modelica quantity attribute
                const qStr = qValRaw.slice(1, -1);
                const qId = dae.addExpression(ExprKind.StringLiteral, dae.interner.intern(qStr));
                dae.setVarAttr(varIdx, "quantity", qId);
                const arrayIndices = dae.getArrayElementIndices(name);
                for (const idx of arrayIndices) {
                  dae.setVarAttr(idx, "quantity", qId);
                }
              }
            }
            const ssValRaw = findDeclElementModificationValueCst(targetModRoot, "stateSelect");
            if (ssValRaw) {
              const ssShort = ssValRaw.startsWith("StateSelect.") ? ssValRaw.slice("StateSelect.".length) : ssValRaw;
              const ssLiterals = ["never", "avoid", "default", "prefer", "always"];
              const ssIdx = ssLiterals.indexOf(ssShort);
              if (ssIdx >= 0) {
                const enumExprId = dae.addEnumLiteral(ssIdx + 1, `StateSelect.${ssShort}`);
                dae.setVarAttr(varIdx, "stateSelect", enumExprId);
                const arrayIndices = dae.getArrayElementIndices(name);
                for (const idx of arrayIndices) {
                  dae.setVarAttr(idx, "stateSelect", enumExprId);
                }
              }
            }

            const isEnumVar =
              dae.getVarType(varIdx) === VarType.Enumeration ||
              (rawTypeName && ctx.enumTypeMap.has(rawTypeName)) ||
              (leafTypeName && ctx.enumTypeMap.has(leafTypeName));
            if (isEnumVar) {
              const lits =
                (rawTypeName ? ctx.enumTypeMap.get(rawTypeName) : undefined) ??
                (leafTypeName ? ctx.enumTypeMap.get(leafTypeName) : undefined);
              if (lits && lits.length > 0) {
                const formatted = lits.map((s: string) => ({ stringValue: s }));
                dae.setVarEnumerationLiterals(varIdx, formatted);
                const arrayIndices = dae.getArrayElementIndices(name);
                for (const idx of arrayIndices) {
                  dae.setVarEnumerationLiterals(idx, formatted);
                }
              }
            }
          }
        }
      }
      if (node.type === "component_declaration" || node.type === "component_declaration1") {
        return;
      }
    }
    for (const child of node.children || []) {
      walkVars(child);
    }
  };
  walkVars(cst);

  if (!dae.extensionMetadata?.["isOldFrontend"]) {
    markConditionalParametersFinal(ctx.db, dae, classId);
  }

  for (let i = 0; i < dae.varCount; i++) {
    if (dae.getVarType(i) === VarType.Enumeration) {
      const existing = dae.getVarEnumerationLiterals(i);
      if (!existing || existing.length === 0) {
        let resolvedLits: string[] | undefined;
        const varName = dae.getVarName(i);
        const leafComp = varName.split(".").pop()!.split("[")[0]!;
        const compSyms = ctx.db.byName(leafComp).filter((s) => s.kind === "Component");
        for (const cs of compSyms) {
          const compInst = ctx.db.query<ComponentInstanceQueryData | null>("componentInstance", cs.id);
          const typeSpec = compInst?.typeSpecifier;
          if (typeSpec) {
            const lits = ctx.enumTypeMap.get(typeSpec) ?? ctx.enumTypeMap.get(typeSpec.split(".").pop()!);
            if (lits && lits.length > 0) {
              resolvedLits = lits;
              break;
            }
          }
        }
        if (!resolvedLits) {
          const bindExpr = dae.getVarExpression(i) ?? -1;
          if (bindExpr >= 0 && dae.getExprKind(bindExpr) === ExprKind.EnumLiteral) {
            const litPath = dae.interner.resolve(dae.getExprLeft(bindExpr));
            if (litPath) {
              const dotIdx = litPath.lastIndexOf(".");
              if (dotIdx > 0) {
                const enumTypePath = litPath.slice(0, dotIdx);
                const lits = ctx.enumTypeMap.get(enumTypePath) ?? ctx.enumTypeMap.get(enumTypePath.split(".").pop()!);
                if (lits && lits.length > 0) {
                  resolvedLits = lits;
                }
              }
            }
          }
        }
        if (!resolvedLits) {
          const rootTxt: string = cst.text ?? "";
          if (rootTxt.includes("redeclare")) {
            for (const cs of compSyms) {
              const compInst = ctx.db.query<ComponentInstanceQueryData | null>("componentInstance", cs.id);
              const typeSpec = compInst?.typeSpecifier;
              if (!typeSpec) continue;
              const leafT = typeSpec.split(".").pop()!;
              const re = new RegExp(
                `\\bredeclare\\s+(?:replaceable\\s+)?type\\s+${leafT.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\s*=\\s*([A-Za-z_][\\w.]*)`,
              );
              const m = rootTxt.match(re);
              if (m) {
                const target = m[1]!;
                const lits = ctx.enumTypeMap.get(target) ?? ctx.enumTypeMap.get(target.split(".").pop()!);
                if (lits && lits.length > 0) {
                  resolvedLits = lits;
                  break;
                }
              }
            }
          }
        }
        if (resolvedLits && resolvedLits.length > 0) {
          const formatted = resolvedLits.map((s: string) => ({ stringValue: s }));
          dae.setVarEnumerationLiterals(i, formatted);
        }
      }
    }
  }
}

export function populateWasmScopeResolutions(
  ctx: ClassFlattenerContext,
  wasmFlattener: number,
  rootClassId: SymbolId,
  dae: DAEBuilder,
): void {
  interface ScopeResExports {
    flattener_registerScopeResolution?: (
      wf: number,
      scopePtr: number,
      nameId: number,
      targetPtr: number,
      globalOffset: number,
      alsoGlobal?: number,
    ) => void;
    flattener_registerEnumLiteral?: (wf: number, typeNameId: number, litNameId: number, index: number) => void;
    flattener_registerScopeConstReal?: (wf: number, scopePtr: number, nameId: number, value: number) => void;
    flattener_registerCanonicalName?: (wf: number, targetPtr: number, canonFqnId: number) => void;
    flattener_registerComplexType?: (wf: number, typeId: number) => void;
    flattener_allocSourceBuffer?: (wf: number, totalBytes: number, enc: number) => number;
    lsp_isCharOffsetKernel?: () => boolean | number;
    lsp_getInputEncoding?: () => number;
    memory?: WebAssembly.Memory;
  }
  const ex = dae.exports as unknown as ScopeResExports;
  if (typeof ex.flattener_registerScopeResolution !== "function") return;
  const register = ex.flattener_registerScopeResolution;
  const registerEnum = ex.flattener_registerEnumLiteral;
  const registerConstReal = ex.flattener_registerScopeConstReal;
  const registerCanon = ex.flattener_registerCanonicalName;
  const registerComplexType = ex.flattener_registerComplexType;
  const allocSourceBuf: ((wf: number, totalBytes: number, enc: number) => number) | undefined =
    typeof ex.flattener_allocSourceBuffer === "function" ? ex.flattener_allocSourceBuffer : undefined;
  const wasmMemory: WebAssembly.Memory | undefined = ex.memory;

  if (typeof registerConstReal === "function") {
    for (const [cKey, cVal] of Object.entries(MODELICA_CONSTANTS)) {
      if (cKey.includes(".") && typeof cVal === "number" && Number.isFinite(cVal)) {
        registerConstReal(wasmFlattener, 0, dae.interner.intern(cKey), cVal);
      }
    }
  }

  const isPackageSymEntry = (entry: SymbolEntry | null | undefined): boolean => {
    if (!entry) return false;
    if (entry.kind === "Package") return true;
    const ck = String((entry.metadata as Record<string, unknown> | undefined)?.["classKind"] ?? "").toLowerCase();
    if (ck === "package") return true;
    if (ck) return false;
    const cst = ctx.db.cstNode(entry.id) as { text?: string } | null;
    return Boolean(cst?.text && /^(?:encapsulated\s+)?package\b/.test(cst.text.trimStart()));
  };

  const evalConstantCompReal = (sym: SymbolEntry): number | null => {
    const cst = ctx.db.cstNode(sym.id) as { text?: string } | null;
    const txt = cst?.text;
    if (!txt) return null;
    const eqIdx = txt.indexOf("=");
    if (eqIdx < 0) return null;
    let rhs = txt.slice(eqIdx + 1).trim();
    const semiIdx = rhs.indexOf(";");
    if (semiIdx >= 0) rhs = rhs.slice(0, semiIdx).trim();
    const qIdx = rhs.indexOf('"');
    if (qIdx >= 0) rhs = rhs.slice(0, qIdx).trim();
    const annIdx = rhs.search(/\bannotation\b/);
    if (annIdx >= 0) rhs = rhs.slice(0, annIdx).trim();
    if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(rhs)) {
      const v = Number(rhs);
      return Number.isFinite(v) ? v : null;
    }
    const known = MODELICA_CONSTANTS[rhs];
    return typeof known === "number" && Number.isFinite(known) ? known : null;
  };

  const isCharOffset = typeof ex.lsp_isCharOffsetKernel === "function" && Boolean(ex.lsp_isCharOffsetKernel());
  const encoding = typeof ex.lsp_getInputEncoding === "function" ? ex.lsp_getInputEncoding() : undefined;
  const isUtf16 = encoding === 1 || encoding === 2 || isCharOffset;
  const unitSize = isCharOffset ? 1 : inputEncodingUnitSize(encoding);

  type ResolveNameFn = (name: string) => SymbolEntry | undefined;

  // Track per-file source texts so cross-file CST nodes (libraries, MSL, multi-file workspaces)
  // share one contiguous linear-memory source buffer with root file anchored at offset 0.
  interface FileSourceEntry {
    key: string;
    text: string;
    utf8Bytes?: Uint8Array;
    baseUnitOffset: number;
    unitLen: number;
  }
  const fileEntries = new Map<string, FileSourceEntry>();
  let nextBaseUnitOffset = 0;
  let utf8Encoder: TextEncoder | null = null;

  const ensureFileSource = (
    cst: CstNodeLike | null | undefined,
    sym: SymbolEntry | null | undefined,
  ): FileSourceEntry | null => {
    const text: string | undefined = cst?.tree?.sourceCode;
    if (typeof text !== "string") return null;
    const key: string =
      sym?.resourceId ??
      (cst?.tree?.rootPtr
        ? `tree:${cst.tree.rootPtr}`
        : cst?.tree?.rootNode?.ptr
          ? `tree:${cst.tree.rootNode.ptr}`
          : "");
    if (!key) return null;
    let entry = fileEntries.get(key);
    if (!entry) {
      if (isUtf16) {
        entry = { key, text, baseUnitOffset: nextBaseUnitOffset, unitLen: text.length };
        nextBaseUnitOffset += text.length;
      } else {
        if (!utf8Encoder) utf8Encoder = new TextEncoder();
        const utf8Bytes = utf8Encoder.encode(text);
        entry = { key, text, utf8Bytes, baseUnitOffset: nextBaseUnitOffset, unitLen: utf8Bytes.length };
        nextBaseUnitOffset += utf8Bytes.length;
      }
      fileEntries.set(key, entry);
    }
    return entry;
  };

  const rootEntrySym = ctx.db.symbol(rootClassId);
  const rootCst = ctx.db.cstNode(rootClassId) as unknown as CstNodeLike | null;
  const rootFileEntry = ensureFileSource(rootCst, rootEntrySym);

  interface PendingScopeRes {
    scopePtr: number;
    nameId: number;
    targetPtr: number;
    localOffset: number;
    fileEntry: FileSourceEntry | null;
    alsoGlobal: boolean;
  }
  const pendingResolutions: PendingScopeRes[] = [];

  const computeLocalOffset = (targetCst: CstNodeLike, resolvedSym: SymbolEntry | null | undefined): number => {
    return targetCst._startOffset !== undefined
      ? targetCst._startOffset + (targetCst._cachedPad ?? 0)
      : (targetCst.startIndex ??
          targetCst.startOffset ??
          (resolvedSym as { startOffset?: number } | null | undefined)?.startOffset ??
          0) * unitSize;
  };

  const pendingCanonNames: { targetPtr: number; canonId: number }[] = [];
  const complexTypeCache = new Map<SymbolId, boolean>();
  const registeredComplexIds = new Set<number>();
  const isComplexSubtypeSym = (sym: SymbolEntry | null | undefined, depth = 0): boolean => {
    if (!sym?.id || depth > 8) return false;
    const cached = complexTypeCache.get(sym.id);
    if (cached !== undefined) return cached;
    if (sym.name === "Complex" || getSymbolQualifiedName(ctx.db, sym.id) === "Complex") {
      complexTypeCache.set(sym.id, true);
      return true;
    }
    const symCst = ctx.db.cstNode(sym.id) as CstNodeLike | null;
    const findShortType = (node: CstNodeLike | null | undefined): string | undefined => {
      if (!node) return undefined;
      if (node.type === "short_class_specifier") {
        return node.children?.find((c) => c.type === "type_specifier" || c.type === "name")?.text?.trim();
      }
      for (const ch of node.children || []) {
        const r = findShortType(ch);
        if (r) return r;
      }
      return undefined;
    };
    const baseName = findShortType(symCst);
    if (baseName) {
      if (baseName === "Complex" || baseName === ".Complex") {
        complexTypeCache.set(sym.id, true);
        return true;
      }
      const lookupScope = sym.parentId ?? sym.id;
      const baseSym =
        ctx.db.query<ResolveNameFn>("resolveName", sym.id)?.(baseName) ??
        ctx.db.query<ResolveNameFn>("resolveSimpleName", sym.id)?.(baseName) ??
        ctx.db.query<ResolveNameFn>("resolveName", lookupScope)?.(baseName) ??
        ctx.db.query<ResolveNameFn>("resolveSimpleName", lookupScope)?.(baseName);
      if (baseSym && baseSym.id !== sym.id) {
        const res = isComplexSubtypeSym(baseSym, depth + 1);
        complexTypeCache.set(sym.id, res);
        return res;
      }
    }
    complexTypeCache.set(sym.id, false);
    return false;
  };

  const queueResolution = (
    scopePtr: number,
    name: string,
    targetCst: CstNodeLike | null | undefined,
    resolvedSym: SymbolEntry | null | undefined,
    alsoGlobal: boolean,
  ): void => {
    if (!targetCst?.ptr) return;
    const fileEntry = ensureFileSource(targetCst, resolvedSym);
    const nameId = dae.interner.intern(name);
    const localOffset = computeLocalOffset(targetCst, resolvedSym);
    pendingResolutions.push({ scopePtr, nameId, targetPtr: targetCst.ptr, localOffset, fileEntry, alsoGlobal });
    if (resolvedSym?.id) {
      const qName = getSymbolQualifiedName(ctx.db, resolvedSym.id);
      if (qName) {
        const canonId = dae.interner.intern(qName);
        pendingCanonNames.push({ targetPtr: targetCst.ptr, canonId });
        if (isComplexSubtypeSym(resolvedSym)) {
          registeredComplexIds.add(nameId);
          registeredComplexIds.add(canonId);
        }
      }
    }
  };

  const visited = new Set<SymbolId>();
  const queue: SymbolId[] = [rootClassId];
  ctx.enumTypeMap.clear();
  const builtinEnums: Array<[string, string[]]> = [
    ["AssertionLevel", ["warning", "error"]],
    ["StateSelect", ["never", "avoid", "default", "prefer", "always"]],
  ];
  for (const [bName, bLits] of builtinEnums) {
    ctx.enumTypeMap.set(bName, bLits);
    if (typeof registerEnum === "function") {
      for (let i = 0; i < bLits.length; i++) {
        const lit = bLits[i];
        const refId = dae.interner.intern(`${bName}.${lit}`);
        registerEnum(wasmFlattener, refId, i + 1, refId);
      }
    }
  }
  const skipCallBuiltins = new Set([
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
    "abs",
    "sign",
    "floor",
    "ceil",
    "div",
    "mod",
    "rem",
    "min",
    "max",
    "sum",
    "product",
    "integer",
    "Integer",
    "String",
    "Real",
    "Boolean",
    "fill",
    "zeros",
    "ones",
    "identity",
    "diagonal",
    "linspace",
    "cat",
    "size",
    "ndims",
    "transpose",
    "vector",
    "matrix",
    "scalar",
    "symmetric",
    "cross",
    "skew",
    "pre",
    "previous",
    "hold",
    "noEvent",
    "smooth",
    "sample",
    "superSample",
    "subSample",
    "shiftSample",
    "backSample",
    "interval",
    "noClock",
    "Clock",
    "change",
    "edge",
    "initial",
    "terminal",
    "assert",
    "terminate",
    "reinit",
    "delay",
    "spatialDistribution",
    "semiLinear",
    "getInstanceName",
    "cardinality",
    "homotopy",
    "inStream",
    "actualStream",
    "firstTick",
    "der",
    "connect",
    "Connections",
    "array",
  ]);

  while (queue.length > 0) {
    const classId = queue.pop()!;
    if (visited.has(classId)) continue;
    visited.add(classId);

    const classEntry = ctx.db.symbol(classId);
    const classCst = ctx.db.cstNode(classId) as unknown as CstNodeLike | null;
    const scopePtr: number = classCst?.ptr ?? 0;
    ensureFileSource(classCst, classEntry);

    const rootQNameForEnum = getSymbolQualifiedName(ctx.db, rootClassId);
    const isNewInstEnum = !(ctx.options.isOldFrontend || dae.extensionMetadata?.["isOldFrontend"]);
    const formatEnumDisplayName = (qName: string, fallback: string): string => {
      if (isNewInstEnum && rootQNameForEnum && qName.startsWith(`${rootQNameForEnum}.`)) {
        return qName.slice(rootQNameForEnum.length + 1);
      }
      return qName || fallback;
    };
    const registerEnumTypeAlias = (
      aliasName: string,
      aliasQName: string,
      lits: string[],
      canonDisplayName: string,
    ): void => {
      ctx.enumTypeMap.set(aliasName, lits);
      if (aliasQName) {
        ctx.enumTypeMap.set(aliasQName, lits);
        const qParts = aliasQName.split(".");
        for (let pIdx = 1; pIdx < qParts.length; pIdx++) {
          ctx.enumTypeMap.set(qParts.slice(pIdx).join("."), lits);
        }
      }
      if (typeof registerEnum === "function") {
        for (let i = 0; i < lits.length; i++) {
          const lit = lits[i];
          const ordinal = i + 1;
          const fullPath = `${canonDisplayName}.${lit}`;
          const fullPathId = dae.interner.intern(fullPath);
          const shortRefId = dae.interner.intern(`${aliasName}.${lit}`);
          registerEnum(wasmFlattener, shortRefId, ordinal, fullPathId);
          if (aliasQName) {
            const qRefId = dae.interner.intern(`${aliasQName}.${lit}`);
            registerEnum(wasmFlattener, qRefId, ordinal, fullPathId);
            const qParts = aliasQName.split(".");
            for (let pIdx = 1; pIdx < qParts.length; pIdx++) {
              const suffix = qParts.slice(pIdx).join(".");
              const sRefId = dae.interner.intern(`${suffix}.${lit}`);
              registerEnum(wasmFlattener, sRefId, ordinal, fullPathId);
            }
          }
        }
      }
    };

    // Check if this class definition itself is an enumeration (not a class containing a nested enum type)
    const findOwnShortSpec = <
      T extends { type?: string | undefined; text?: string | undefined; children?: readonly T[] | null | undefined },
    >(
      node: T | null | undefined,
    ): T | null => {
      if (!node) return null;
      if (node.type === "short_class_specifier") return node;
      if (node.type === "long_class_specifier" || node.type === "composition" || node.type === "element_list") {
        return null;
      }
      for (const ch of node.children || []) {
        const found = findOwnShortSpec(ch);
        if (found) return found;
      }
      return null;
    };
    const ownShortSpec = findOwnShortSpec(classCst);
    const isEnum =
      (classEntry?.metadata as SymbolMetaLike | undefined)?.isEnumeration ||
      Boolean(ownShortSpec && /\benumeration\s*\(/.test(ownShortSpec.text ?? ""));
    if (isEnum && classEntry) {
      const lits = extractEnumLiteralsFromCst(ownShortSpec ?? classCst, classEntry.metadata);
      if (lits && lits.length > 0) {
        const qName = getSymbolQualifiedName(ctx.db, classId);
        const displayName = formatEnumDisplayName(qName, classEntry.name);
        registerEnumTypeAlias(classEntry.name, qName, lits, displayName);
        if (qName) queueResolution(scopePtr, qName, classCst, classEntry, true);
      }
    }

    // Check if this class definition is a short class specifier (e.g. model E = B.C(x=6) or type E2 = E1(...))
    const findShortSpec = (node: CstNodeLike | null | undefined): CstNodeLike | null => {
      if (!node) return null;
      if (node.type === "short_class_specifier") return node;
      for (const ch of node.children || []) {
        const found = findShortSpec(ch);
        if (found) return found;
      }
      return null;
    };
    const shortSpecNode = findShortSpec(classCst);
    if (shortSpecNode) {
      const typeSpecNode = shortSpecNode.children?.find((c) => c.type === "type_specifier" || c.type === "name");
      const typeName: string | undefined = typeSpecNode?.text?.trim();
      if (typeName) {
        const lookupScope = classEntry?.parentId ?? classId;
        const resolved =
          ctx.db.query<ResolveNameFn>("resolveName", classId)?.(typeName) ??
          ctx.db.query<ResolveNameFn>("resolveSimpleName", classId)?.(typeName) ??
          ctx.db.query<ResolveNameFn>("resolveName", lookupScope)?.(typeName) ??
          ctx.db.query<ResolveNameFn>("resolveSimpleName", lookupScope)?.(typeName);
        if (resolved && resolved.id) {
          const targetCst = ctx.db.cstNode(resolved.id) as unknown as CstNodeLike | null;
          queueResolution(scopePtr, typeName, targetCst, resolved, false);
          queue.push(resolved.id);

          // Chase short-class chain to see if this derived type aliases an enumeration
          if (!isEnum && classEntry) {
            let curSym: SymbolEntry | undefined = resolved;
            for (let hop = 0; hop < 8 && curSym?.id; hop++) {
              const curCst = ctx.db.cstNode(curSym.id) as unknown as CstNodeLike | null;
              const curIsEnum =
                Boolean(curSym.metadata?.["isEnumeration"]) || Boolean(curCst?.text?.includes("enumeration("));
              if (curIsEnum) {
                const baseLits = extractEnumLiteralsFromCst(curCst, curSym.metadata);
                if (baseLits && baseLits.length > 0) {
                  const baseQName = getSymbolQualifiedName(ctx.db, curSym.id);
                  const canonDisplay = formatEnumDisplayName(baseQName, curSym.name);
                  const aliasQName = getSymbolQualifiedName(ctx.db, classId);
                  registerEnumTypeAlias(classEntry.name, aliasQName, baseLits, canonDisplay);
                  if (baseQName) queueResolution(scopePtr, baseQName, curCst, curSym, true);
                }
                break;
              }
              const nextShort = findShortSpec(curCst);
              const nextTypeNode = nextShort?.children?.find(
                (c: CstNodeLike) => c.type === "type_specifier" || c.type === "name",
              );
              const nextTypeName: string | undefined = nextTypeNode?.text?.trim();
              if (!nextTypeName) break;
              const nextScope: SymbolId = curSym.parentId ?? curSym.id;
              curSym =
                ctx.db.query<ResolveNameFn>("resolveName", nextScope)?.(nextTypeName) ??
                ctx.db.query<ResolveNameFn>("resolveSimpleName", nextScope)?.(nextTypeName);
            }
          }
        }
      }
    }

    // Collect imports for this class and register with WASM flattener
    const classImports = ctx.collectClassImports(classId);
    for (const [shortName, fullPkg] of classImports) {
      const resolved =
        ctx.db.query<ResolveNameFn>("resolveName", classId)?.(fullPkg) ??
        ctx.db.query<ResolveNameFn>("resolveSimpleName", classId)?.(fullPkg) ??
        ctx.db
          .byName(fullPkg.split(".").pop() ?? "")
          .find((e) => e.kind === "Class" || e.kind === "Package" || e.kind === "Component");
      const knownConstVal = MODELICA_CONSTANTS[fullPkg];
      if (typeof knownConstVal === "number" && Number.isFinite(knownConstVal)) {
        const astVal = resolved?.kind === "Component" ? evalConstantCompReal(resolved) : null;
        const chosen = astVal !== null ? astVal : knownConstVal;
        if (typeof registerConstReal === "function" && scopePtr !== 0) {
          registerConstReal(wasmFlattener, scopePtr, dae.interner.intern(shortName), chosen);
        }
        continue;
      }
      if (resolved && resolved.id) {
        if (resolved.kind === "Component") {
          const cVal = evalConstantCompReal(resolved);
          if (cVal !== null && typeof registerConstReal === "function" && scopePtr !== 0) {
            registerConstReal(wasmFlattener, scopePtr, dae.interner.intern(shortName), cVal);
          }
          continue;
        }
        const targetCst = ctx.db.cstNode(resolved.id) as unknown as CstNodeLike | null;
        queueResolution(scopePtr, shortName, targetCst, resolved, false);
        if (!isPackageSymEntry(resolved)) {
          queue.push(resolved.id);
        } else if (
          (fullPkg === "Modelica.Constants" || fullPkg === "ModelicaServices.Machine") &&
          typeof registerConstReal === "function" &&
          scopePtr !== 0
        ) {
          for (const [cName, cVal] of Object.entries(MODELICA_BASE_CONSTANTS)) {
            registerConstReal(wasmFlattener, scopePtr, dae.interner.intern(`${shortName}.${cName}`), cVal);
          }
        }
      }
    }

    // Collect redeclare type targets AND function/record call targets inside extends/component modifications/equations of this class
    const scanRedeclareTargets = (node: CstNodeLike | null | undefined): void => {
      if (!node) return;
      const nt = node.type;
      if (nt === "class_definition" && node !== classCst) return;
      if (nt === "equation_section" || nt === "algorithm_section" || nt === "annotation_clause") return;
      if (nt === "element_redeclaration") {
        const findTypeSpecs = (sub: CstNodeLike | null | undefined): void => {
          if (!sub) return;
          if (sub.type === "type_specifier" || (sub.type === "name" && Boolean(sub.text?.includes(".")))) {
            const tName = sub.text?.trim();
            if (tName && tName !== "Real" && tName !== "Integer" && tName !== "Boolean" && tName !== "String") {
              const resolved =
                ctx.db.query<ResolveNameFn>("resolveName", classId)?.(tName) ??
                ctx.db.query<ResolveNameFn>("resolveSimpleName", classId)?.(tName);
              if (resolved && resolved.id) {
                const targetCst = ctx.db.cstNode(resolved.id) as unknown as CstNodeLike | null;
                queueResolution(scopePtr, tName, targetCst, resolved, true);
                queue.push(resolved.id);
              }
            }
            return;
          }
          for (const c of sub.children || []) findTypeSpecs(c);
        };
        findTypeSpecs(node);
        return;
      }
      for (const c of node.children || []) scanRedeclareTargets(c);
    };
    scanRedeclareTargets(classCst);

    const scanCallTargets = (node: CstNodeLike | null | undefined): void => {
      if (!node) return;
      const nt = node.type;
      if (nt === "class_definition" && node !== classCst) return;
      if (nt === "annotation_clause") return;
      const isExprCall =
        (nt === "primary" || nt === "lhs_primary") &&
        Boolean(node.children?.some((c) => c.type === "function_call_args"));
      if (nt === "function_call" || isExprCall) {
        const calleeNode =
          node.children?.find(
            (c) => c.type === "component_reference" || c.type === "name" || c.type === "identifier",
          ) ?? node.children?.[0];
        const fnName = calleeNode?.text?.trim();
        if (
          fnName &&
          !fnName.includes("[") &&
          !fnName.includes("(") &&
          !/^\d/.test(fnName) &&
          !skipCallBuiltins.has(fnName)
        ) {
          const resolved =
            ctx.db.query<ResolveNameFn>("resolveName", classId)?.(fnName) ??
            ctx.db.query<ResolveNameFn>("resolveSimpleName", classId)?.(fnName);
          if (resolved && resolved.id) {
            const targetCst = ctx.db.cstNode(resolved.id) as unknown as CstNodeLike | null;
            queueResolution(scopePtr, fnName, targetCst, resolved, fnName.includes("."));
            const qName = getSymbolQualifiedName(ctx.db, resolved.id);
            if (qName && qName !== fnName) {
              queueResolution(scopePtr, qName, targetCst, resolved, true);
            }
            const isRec = Boolean(
              (resolved.metadata as Record<string, unknown> | undefined)?.["isRecord"] ||
              (typeof targetCst?.text === "string" &&
                /^\s*(?:encapsulated\s+)?(?:partial\s+)?(?:replaceable\s+)?(?:operator\s+)?record\b/.test(
                  targetCst.text,
                )),
            );
            if (isRec && !isPackageSymEntry(resolved)) {
              queue.push(resolved.id);
            }
          }
        }
      }
      for (const c of node.children || []) scanCallTargets(c);
    };
    scanCallTargets(classCst);

    const children = ctx.db.childrenOf(classId);
    const isCurrentPkg = isPackageSymEntry(classEntry);

    for (const child of children) {
      if (child.kind === "Extends") {
        const extCst = ctx.db.cstNode(child.id) as unknown as CstNodeLike | null;
        const typeSpecNode = extCst?.children?.find(
          (c: CstNodeLike) => c.type === "type_specifier" || c.type === "name",
        );
        const extName: string = typeSpecNode?.text?.trim() ?? child.name;
        if (extName) {
          const resolved =
            ctx.db.query<ResolveNameFn>("resolveName", classId)?.(extName) ??
            ctx.db.query<ResolveNameFn>("resolveSimpleName", classId)?.(extName) ??
            ctx.db.query<SymbolEntry | undefined>("resolvedBaseClass", classId);
          if (resolved && resolved.id) {
            const targetCst = ctx.db.cstNode(resolved.id) as unknown as CstNodeLike | null;
            queueResolution(scopePtr, extName, targetCst, resolved, true);
            queue.push(resolved.id);
          }
        }
      } else if (child.kind === "Component") {
        const compInst = ctx.db.query<{ typeSpecifier?: string; classInstance?: SymbolId } | undefined>(
          "componentInstance",
          child.id,
        );
        const typeSpec: string | undefined = compInst?.typeSpecifier;
        if (
          typeSpec &&
          typeSpec !== "Real" &&
          typeSpec !== "Integer" &&
          typeSpec !== "Boolean" &&
          typeSpec !== "String"
        ) {
          let targetId = compInst?.classInstance;
          if (!targetId) {
            const resolved =
              ctx.db.query<ResolveNameFn>("resolveName", classId)?.(typeSpec) ??
              ctx.db.query<ResolveNameFn>("resolveSimpleName", classId)?.(typeSpec);
            if (resolved) targetId = resolved.id;
          }
          if (targetId) {
            const targetSym = ctx.db.symbol(targetId);
            const targetCst = ctx.db.cstNode(targetId) as unknown as CstNodeLike | null;
            queueResolution(scopePtr, typeSpec, targetCst, targetSym, true);
            if (!isPackageSymEntry(targetSym)) {
              queue.push(targetId);
            }
          }
        }
      } else if (child.kind === "Class") {
        if (!isCurrentPkg && !isPackageSymEntry(child)) {
          queue.push(child.id);
        }
        const childCst = ctx.db.cstNode(child.id) as unknown as CstNodeLike | null;
        const isChildEnum =
          Boolean(child.metadata?.["isEnumeration"]) || Boolean(childCst?.text?.includes("enumeration("));
        if (isChildEnum) {
          const lits = extractEnumLiteralsFromCst(childCst, child.metadata);
          if (lits && lits.length > 0) {
            const qName = getSymbolQualifiedName(ctx.db, child.id);
            const displayName = formatEnumDisplayName(qName, child.name);
            registerEnumTypeAlias(child.name, qName, lits, displayName);
          }
        } else {
          // Check if child is a derived enum type via `extends E;` (e.g., `type E2 extends E; end E2;`)
          const childExtends = ctx.db.childrenOf(child.id).find((c) => c.kind === "Extends");
          const extTarget =
            (childExtends?.metadata?.["targetClass"] as string | undefined) ??
            (childExtends?.metadata?.["baseClass"] as string | undefined) ??
            childExtends?.name;
          if (extTarget) {
            const extScope = child.parentId ?? child.id;
            let curSym: SymbolEntry | undefined =
              ctx.db.query<ResolveNameFn>("resolveName", extScope)?.(extTarget) ??
              ctx.db.query<ResolveNameFn>("resolveSimpleName", extScope)?.(extTarget);
            for (let hop = 0; hop < 8 && curSym?.id; hop++) {
              const curCst = ctx.db.cstNode(curSym.id) as unknown as CstNodeLike | null;
              const curIsEnum =
                Boolean(curSym.metadata?.["isEnumeration"]) || Boolean(curCst?.text?.includes("enumeration("));
              if (curIsEnum) {
                const baseLits = extractEnumLiteralsFromCst(curCst, curSym.metadata);
                if (baseLits && baseLits.length > 0) {
                  const baseQName = getSymbolQualifiedName(ctx.db, curSym.id);
                  const canonDisplay = formatEnumDisplayName(baseQName, curSym.name);
                  const aliasQName = getSymbolQualifiedName(ctx.db, child.id);
                  registerEnumTypeAlias(child.name, aliasQName, baseLits, canonDisplay);
                }
                break;
              }
              const nextExt = ctx.db.childrenOf(curSym.id).find((c) => c.kind === "Extends");
              const nextTgt =
                (nextExt?.metadata?.["targetClass"] as string | undefined) ??
                (nextExt?.metadata?.["baseClass"] as string | undefined) ??
                nextExt?.name;
              if (!nextTgt) break;
              const nextScope: SymbolId = curSym.parentId ?? curSym.id;
              curSym =
                ctx.db.query<ResolveNameFn>("resolveName", nextScope)?.(nextTgt) ??
                ctx.db.query<ResolveNameFn>("resolveSimpleName", nextScope)?.(nextTgt);
            }
          }
        }
        const aliasTarget =
          (child.metadata?.["aliasTarget"] as string | undefined) ??
          (child.metadata?.["baseClass"] as string | undefined);
        if (aliasTarget) {
          const resolved =
            ctx.db.query<ResolveNameFn>("resolveName", classId)?.(aliasTarget) ??
            ctx.db.query<ResolveNameFn>("resolveSimpleName", classId)?.(aliasTarget);
          if (resolved) {
            const targetCst = ctx.db.cstNode(resolved.id) as CstNodeLike | null;
            queueResolution(scopePtr, child.name, targetCst, resolved, true);
            queue.push(resolved.id);
          }
        }
      }
    }
  }

  const complexSymCandidates = ctx.db.byName("Complex") ?? [];
  for (const cSym of complexSymCandidates) {
    if (cSym.kind === "Class" && (!cSym.parentId || getSymbolQualifiedName(ctx.db, cSym.id) === "Complex")) {
      const cCst = ctx.db.cstNode(cSym.id) as unknown as CstNodeLike | null;
      if (cCst?.ptr) {
        queueResolution(0, "Complex", cCst, cSym, true);
      }
      break;
    }
  }

  // Materialize contiguous multi-file source buffer in WASM linear memory when available.
  let useMultiFileOffsets = false;
  if (allocSourceBuf && wasmMemory && rootFileEntry && nextBaseUnitOffset > 0) {
    const totalBytes = isUtf16 ? nextBaseUnitOffset * 2 : nextBaseUnitOffset;
    const bufPtr = allocSourceBuf(wasmFlattener, totalBytes, isUtf16 ? 1 : 0);
    if (bufPtr !== 0) {
      // Re-read wasmMemory.buffer AFTER allocSourceBuf in case memory.grow() ran.
      if (isUtf16) {
        const u16 = new Uint16Array(wasmMemory.buffer, bufPtr, nextBaseUnitOffset);
        for (const entry of fileEntries.values()) {
          const base = entry.baseUnitOffset;
          const txt = entry.text;
          for (let i = 0; i < txt.length; i++) {
            u16[base + i] = txt.charCodeAt(i);
          }
        }
      } else {
        const u8 = new Uint8Array(wasmMemory.buffer, bufPtr, totalBytes);
        for (const entry of fileEntries.values()) {
          if (entry.utf8Bytes) {
            u8.set(entry.utf8Bytes, entry.baseUnitOffset);
          }
        }
      }
      useMultiFileOffsets = true;
    }
  }

  (ctx.state as FlatteningStateWithWasm).wasmSourceFiles = Array.from(fileEntries.values()).map((e) => ({
    key: e.key,
    text: e.text,
    utf8Bytes: e.utf8Bytes,
    baseUnitOffset: e.baseUnitOffset,
    unitLen: e.unitLen,
    isUtf16,
  }));

  for (const res of pendingResolutions) {
    const baseOff = useMultiFileOffsets && res.fileEntry ? res.fileEntry.baseUnitOffset : 0;
    const targetOffset = baseOff + res.localOffset;
    register(wasmFlattener, res.scopePtr, res.nameId, res.targetPtr, targetOffset);
    if (res.alsoGlobal) {
      register(wasmFlattener, 0, res.nameId, res.targetPtr, targetOffset);
    }
  }
  if (typeof registerCanon === "function") {
    for (const cn of pendingCanonNames) {
      registerCanon(wasmFlattener, cn.targetPtr, cn.canonId);
    }
  }
  if (typeof registerComplexType === "function") {
    for (const cid of registeredComplexIds) {
      registerComplexType(wasmFlattener, cid);
    }
  }
}
