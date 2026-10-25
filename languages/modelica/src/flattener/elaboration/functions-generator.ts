// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Causality,
  DAEBuilder,
  ExprKind,
  foldArenaConstants,
  type QueryDB,
  type SymbolEntry,
  type SymbolId,
  Variability,
  VarType,
  varTypeName,
} from "@modelscript/runtime";
import { Cst } from "../../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../../errors.js";
import { getShortClassSpecifierNode, isScopeEncapsulated } from "../../queries.js";
import { stripComments } from "../expressions/cst-utils.js";
import {
  castToRealExpr,
  escapeRegExp,
  evalArithmeticString,
  evalDaeExpr,
  getSymbolEnumLiterals,
  getSymbolQualifiedName,
  isRealExpr,
  lookupDbConstant,
} from "../expressions/index.js";
import { getClassDiagRange } from "../support/range-utils.js";
import type { ComponentInstanceData } from "../types.js";
import { collectExtendsMods } from "./component-inst.js";

export function isFunctionSym(db: QueryDB, sym: any): boolean {
  if (!sym) return false;
  if ((sym as any)._isFunction !== undefined) return (sym as any)._isFunction;
  const meta = (sym.metadata as any) || {};
  const rawKind = String(meta.classKind ?? meta.classPrefixes ?? "");
  const cleanKind = stripComments(rawKind).trim();
  const words = cleanKind.split(/\s+/).filter(Boolean);
  if (words.includes("function")) {
    (sym as any)._isFunction = true;
    return true;
  }
  if (words.length > 0 && !words.includes("function")) {
    (sym as any)._isFunction = false;
    return false;
  }
  const cst = db.cstNode(sym.id) as any;
  if (cst) {
    for (const child of cst.children || []) {
      if (child.type === "class_prefixes") {
        const childText = (child.text ?? "").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
        const childWords = childText.split(/\s+/).filter(Boolean);
        if (childWords.includes("function")) {
          (sym as any)._isFunction = true;
          return true;
        }
      }
    }
    const text = (cst.text?.trim() ?? "").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
    if (/^(?:(?:encapsulated|partial|replaceable|pure|impure)\s+)*function\b/.test(text)) {
      (sym as any)._isFunction = true;
      return true;
    }
  }
  (sym as any)._isFunction = false;
  return false;
}

export function generateRecordConstructorFor(
  flattener: any,
  sym: any,
  dae: DAEBuilder,
  rootClassId?: SymbolId,
  overrideFnName?: string,
  overrideResType?: string,
): DAEBuilder | null {
  if (!sym) return null;
  const db: QueryDB = flattener.db;
  const qualName = getSymbolQualifiedName(db, sym.id);
  const isRedeclaredInRoot = Boolean(
    rootClassId &&
    sym.parentId !== rootClassId &&
    qualName &&
    collectExtendsMods(flattener, rootClassId).some(
      (a: any) =>
        a.isRedeclaration &&
        a.name === sym.name &&
        (a.redeclaredTypeSpecifier === qualName || a.redeclaredTypeSpecifier === `.${qualName}`),
    ),
  );
  const fnName =
    overrideFnName ??
    (rootClassId && (sym.parentId === rootClassId || isRedeclaredInRoot) && dae.name && dae.classKind !== "function"
      ? dae.name.includes(".") || !qualName.includes(".") || isRedeclaredInRoot
        ? `${dae.name}.${sym.name}`
        : qualName
      : qualName || sym.name);
  const bySimpleName = dae.getFunction(sym.name);
  const existing =
    dae.getFunction(fnName) ??
    (!overrideFnName
      ? fnName === sym.name || (dae.name && bySimpleName?.name === `${dae.name}.${sym.name}`)
        ? (bySimpleName ?? (qualName ? dae.getFunction(qualName) : undefined))
        : qualName
          ? dae.getFunction(qualName)
          : undefined
      : undefined);
  if (existing) return existing;

  const fn = new DAEBuilder(dae.interner, fnName, "");
  fn.classKind = "function";
  fn.description = `Automatically generated record constructor for ${fnName}`;
  if (flattener.isOperatorRecordSym(sym)) {
    (fn as any).isOperatorRecord = true;
    fn.extensionMetadata.isOperatorRecord = true;
  }
  const instElements = db.query<SymbolId[]>("instantiate", sym.id);
  const comps: SymbolEntry[] = [];
  if (instElements && instElements.length > 0) {
    for (const eid of instElements) {
      const entry = db.symbol(eid);
      if (entry && entry.kind === "Component") comps.push(entry);
    }
  } else {
    for (const comp of db.childrenOf(sym.id)) {
      if (comp && comp.kind === "Component") comps.push(comp);
    }
  }
  const symMod = db.query<any>("effectiveModification", sym.id);
  const extendsMods = collectExtendsMods(flattener, sym.id);
  const redeclArgs = [
    ...extendsMods.filter((a: any) => a.isRedeclaration),
    ...(symMod?.args?.filter((a: any) => a.isRedeclaration) ?? []),
  ];
  const redeclaredCompNames = new Set(redeclArgs.map((a: any) => a.name));

  if (
    !flattener.isOperatorRecordSym(sym) &&
    comps.some((c) => {
      const ci = db.query<ComponentInstanceData>("componentInstance", c.id);
      return ci?.isReplaceable && !redeclaredCompNames.has(c.name);
    })
  ) {
    return null;
  }

  const recordConstValues = new Map<string, number>();
  for (const comp of comps) {
    if (comp && comp.kind === "Component") {
      const ci = db.query<ComponentInstanceData>("componentInstance", comp.id);
      const cm = (comp.metadata as any) || {};
      const cc = db.cstNode(comp.id) as any;
      const isConst =
        ci?.variability === "constant" ||
        cm.variability === "constant" ||
        cm.isConstant === true ||
        /\bconstant\b/.test(cc?.text ?? "");
      if (isConst) {
        const bt = ci?.modification?.bindingExpression?.text?.trim();
        if (bt) {
          const n = Number(bt);
          if (!isNaN(n)) recordConstValues.set(comp.name, n);
        }
      }
    }
  }

  // Order inputs before protected constants so record constructor inputs come first (e.g. RecordConstructors2)
  const orderedComps = [...comps].sort((a, b) => {
    const aInst = db.query<ComponentInstanceData>("componentInstance", a.id);
    const bInst = db.query<ComponentInstanceData>("componentInstance", b.id);
    const aCst = db.cstNode(a.id) as any;
    const bCst = db.cstNode(b.id) as any;
    const aProt =
      flattener.isCstNodeProtected(aCst) || aInst?.variability === "constant" || /\bconstant\b/.test(aCst?.text ?? "");
    const bProt =
      flattener.isCstNodeProtected(bCst) || bInst?.variability === "constant" || /\bconstant\b/.test(bCst?.text ?? "");
    if (aProt !== bProt) return aProt ? 1 : -1;
    return 0;
  });

  for (const comp of orderedComps) {
    if (comp && comp.kind === "Component") {
      const compInst = db.query<ComponentInstanceData>("componentInstance", comp.id);
      const cMeta = (comp.metadata as any) || {};
      const redeclForComp = redeclArgs.find((a: any) => a.name === comp.name);
      let typeSpec = redeclForComp?.redeclaredTypeSpecifier ?? compInst?.typeSpecifier ?? cMeta.typeSpecifier;
      let compTargetId: SymbolId | null = compInst?.classInstance ?? null;
      if (!compTargetId && typeSpec) {
        const simple = typeSpec.split(".").pop()!;
        const targets = db.byName(simple);
        const found = targets.find((t) => t.kind === "Class" || (t.metadata as any)?.classKind === "type");
        if (found) compTargetId = found.id;
      }

      const compTypeMods: any[] = [];
      let enumLits: string[] | null = null;
      if (compTargetId) {
        const targetSym = db.symbol(compTargetId);
        if (targetSym) {
          enumLits = getSymbolEnumLiterals(db, targetSym);
        }
      }
      if (compInst?.modification?.args) {
        for (const cArg of compInst.modification.args) {
          if (cArg?.name && ["min", "max", "unit", "displayUnit", "quantity", "nominal", "start"].includes(cArg.name)) {
            compTypeMods.push(cArg);
          }
        }
      }
      if (compTargetId && flattener.isClassType(compTargetId) && !enumLits) {
        let currTypeId: SymbolId | null = compTargetId;
        while (currTypeId) {
          const mod = db.query<any>("effectiveModification", currTypeId);
          if (mod?.args) compTypeMods.push(...mod.args);
          let base: any = db.query("resolvedBaseClass", currTypeId);
          const extChild = db.childrenOf(currTypeId).find((c) => c.kind === "Extends");
          if (extChild && !base) {
            base = db.query("resolvedBaseClass", extChild.id) ?? db.byName(extChild.name)[0];
          }
          if (!base || base.id === currTypeId) break;
          typeSpec = base.name;
          currTypeId = flattener.isClassType(base.id) ? base.id : null;
        }
      }

      let vType = VarType.Real;
      if (enumLits && enumLits.length > 0) vType = VarType.Enumeration;
      else if (typeSpec === "Integer" || cMeta.varType === VarType.Integer) vType = VarType.Integer;
      else if (typeSpec === "Boolean" || cMeta.varType === VarType.Boolean) vType = VarType.Boolean;
      else if (typeSpec === "String" || cMeta.varType === VarType.String) vType = VarType.String;
      else if (typeSpec === "Clock" || cMeta.varType === VarType.Clock) vType = VarType.Clock;

      const compCst = db.cstNode(comp.id) as any;
      const cstText = compCst?.text ?? "";
      const isInput = /\binput\b/.test(cstText);
      const isOutput = /\boutput\b/.test(cstText);
      const isConstant =
        compInst?.variability === "constant" ||
        cMeta.variability === "constant" ||
        cMeta.isConstant === true ||
        /\bconstant\b/.test(cstText);
      const isCompProt = (flattener.isCstNodeProtected(compCst) || isConstant) && !isInput && !isOutput;
      const causality = isOutput ? Causality.Output : isCompProt ? Causality.Local : Causality.Input;
      const variability = Variability.Continuous;
      const varIdx = fn.addVariable(comp.name, vType, variability, causality);
      if (isConstant) {
        ((fn as any)._recordConstVarIndices ??= new Set<number>()).add(varIdx);
      }
      if (isCompProt) {
        fn.setVarProtected(varIdx, true);
      }
      if (enumLits && enumLits.length > 0) {
        fn.setVarEnumerationLiterals(
          varIdx,
          enumLits.map((s: string) => ({ stringValue: s })),
        );
      } else if (typeSpec && !["Real", "Integer", "Boolean", "String"].includes(typeSpec)) {
        let customTypeStr = typeSpec;
        if (!customTypeStr.includes(".") && compTargetId && sym.parentId && sym.parentId !== rootClassId) {
          const compTargetSym = db.symbol(compTargetId);
          if (compTargetSym && flattener.isRecordSym(compTargetSym) && compTargetSym.parentId !== rootClassId) {
            const qCompType = getSymbolQualifiedName(db, compTargetId);
            if (qCompType) customTypeStr = qCompType;
          }
        }
        fn.setVarCustomType(varIdx, customTypeStr);
      }
      const rawDims = db.query<any[] | null>("arrayDimensions", comp.id);
      const evaluatedDims: number[] = [];
      if (compInst?.arrayDimensions && compInst.arrayDimensions.length > 0) {
        const effectiveShape = compInst.arrayDimensions.map((dimVal, dIdx) =>
          rawDims?.[dIdx]?.kind !== "literal" ? -1 : dimVal,
        );
        fn.setVarShape(varIdx, effectiveShape);
      }
      if (rawDims && rawDims.length > 0) {
        const shapeExprIds: number[] = [];
        for (const d of rawDims) {
          if (d.kind === "expression") {
            let exprId = -1;
            let evalDim: number | null = null;
            if (d.cstBytes) {
              const cstNode = db.cstNodeRange(d.cstBytes[0], d.cstBytes[1], comp) as any;
              if (cstNode) {
                const loweredDimId = flattener.lowerExpr(cstNode, fn, "");
                if (loweredDimId >= 0) {
                  const ev = evalDaeExpr(loweredDimId, fn);
                  if (typeof ev === "number" && !isNaN(ev) && ev >= 0) {
                    evalDim = Math.round(ev);
                  } else if (!d.text) {
                    exprId = loweredDimId;
                  }
                }
              }
            }
            if (evalDim !== null) {
              exprId = fn.addIntLiteral(evalDim);
              evaluatedDims.push(evalDim);
            } else {
              if (exprId < 0 && d.text) {
                const normText = d.text.replace(/,(\S)/g, ", $1");
                exprId = fn.addExpression(ExprKind.Name, fn.interner.intern(normText));
              }
              evaluatedDims.push(-1);
            }
            if (exprId >= 0) {
              shapeExprIds.push(exprId);
            }
          } else if (d.kind === "literal") {
            shapeExprIds.push(fn.addIntLiteral(d.value));
            evaluatedDims.push(d.value);
          } else if (d.kind === "colon" || d.kind === "flexible" || d.text?.trim() === ":") {
            shapeExprIds.push(fn.addColonExpr());
            evaluatedDims.push(-1);
          }
        }
        if (evaluatedDims.length > 0) {
          fn.setVarShape(varIdx, evaluatedDims);
        }
        if (shapeExprIds.length > 0) {
          fn.setVarShapeExprs(varIdx, shapeExprIds);
        }
      }
      const seenAttrs = new Set<string>();
      for (const attr of compTypeMods) {
        if (attr.value && attr.name && !seenAttrs.has(attr.name)) {
          const val = attr.value;
          let exprId: number | null = null;
          if (val.kind === "literal") {
            if (typeof val.value === "number") {
              exprId =
                vType === VarType.Integer && (attr.name === "min" || attr.name === "max")
                  ? fn.addIntLiteral(Math.round(val.value))
                  : fn.addRealLiteral(val.value);
            } else if (typeof val.value === "string") exprId = fn.addStringLiteral(val.value);
          } else if (val.text) {
            const t = val.text.trim();
            if (t.startsWith('"') && t.endsWith('"')) {
              exprId = fn.addStringLiteral(t.slice(1, -1));
            } else {
              let num = Number(t);
              if (isNaN(num) && /^\.?[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*$/.test(t)) {
                const cRes = lookupDbConstant(t, db, sym.parentId ?? undefined);
                if (cRes && typeof cRes.value === "number") {
                  num = cRes.value;
                }
              }
              if (!isNaN(num)) {
                exprId =
                  vType === VarType.Integer && (attr.name === "min" || attr.name === "max")
                    ? fn.addIntLiteral(Math.round(num))
                    : fn.addRealLiteral(num);
              }
            }
          }
          if (exprId !== null) {
            seenAttrs.add(attr.name);
            fn.setVarAttr(varIdx, attr.name, exprId);
          }
        }
      }
      const extModForComp = [...extendsMods].reverse().find((m: any) => m.name === comp.name && m.value?.text);
      const bText = (extModForComp?.value?.text ?? compInst?.modification?.bindingExpression?.text)?.trim();
      if (isConstant && evaluatedDims.length > 0 && evaluatedDims.some((dim) => dim === 0)) {
        fn.setVarExpression(varIdx, fn.addArrayCtorExpr([]));
      } else if (bText) {
        const num = Number(bText);
        const arithVal = isNaN(num) ? evalArithmeticString(bText, true) : num;
        if (arithVal !== null && !isNaN(arithVal)) {
          const exprId =
            vType === VarType.Integer ? fn.addIntLiteral(Math.round(arithVal)) : fn.addRealLiteral(arithVal);
          fn.setVarExpression(varIdx, exprId);
        } else if (recordConstValues.has(bText)) {
          const cVal = recordConstValues.get(bText)!;
          const exprId = vType === VarType.Integer ? fn.addIntLiteral(Math.round(cVal)) : fn.addRealLiteral(cVal);
          fn.setVarExpression(varIdx, exprId);
        } else if (bText === "true" || bText === "false") {
          fn.setVarExpression(varIdx, fn.addBoolLiteral(bText === "true"));
        } else if (bText.startsWith('"') && bText.endsWith('"')) {
          fn.setVarExpression(varIdx, fn.addStringLiteral(bText.slice(1, -1)));
        } else {
          const findBindingExprNode = (n: any): any => {
            if (!n) return null;
            if (n.type === "expression") return n;
            for (const c of n.children || []) {
              const res = findBindingExprNode(c);
              if (res) return res;
            }
            return null;
          };
          let exprCst: any = null;
          if (extModForComp?.value?.cstBytes) {
            exprCst = db.cstNodeRange(extModForComp.value.cstBytes[0], extModForComp.value.cstBytes[1], sym) as any;
          }
          if (!exprCst) {
            const modChild = (compCst as any)?.children?.find((c: any) => c.type === "modification");
            exprCst = findBindingExprNode(modChild ?? compCst);
          }
          if (exprCst) {
            let exprId = flattener.lowerExpr(exprCst, fn, "");
            if (exprId >= 0) {
              if (isConstant) {
                const ev = evalDaeExpr(exprId, fn);
                if (typeof ev === "number" && !isNaN(ev)) {
                  exprId = vType === VarType.Integer ? fn.addIntLiteral(Math.round(ev)) : fn.addRealLiteral(ev);
                } else if (typeof ev === "boolean") {
                  exprId = fn.addBoolLiteral(ev);
                } else if (typeof ev === "string") {
                  exprId = fn.addStringLiteral(ev);
                } else if (Array.isArray(ev)) {
                  if (ev.length === 0) {
                    exprId = fn.addArrayCtorExpr([]);
                  } else if (ev.every((x) => typeof x === "number" && !isNaN(x))) {
                    exprId = fn.addArrayCtorExpr(
                      ev.map((x: number) =>
                        vType === VarType.Integer ? fn.addIntLiteral(Math.round(x)) : fn.addRealLiteral(x),
                      ),
                    );
                  }
                }
              }
              if (vType === VarType.Real && !isRealExpr(exprId, fn)) {
                exprId = castToRealExpr(exprId, fn);
              }
              fn.setVarExpression(varIdx, exprId);
            }
          }
        }
      }
    }
  }
  const resTypeName = overrideResType ?? sym.name;
  const resIdx = fn.addVariable("res", VarType.Real, Variability.Continuous, Causality.Output);
  fn.setVarCustomType(resIdx, resTypeName);
  dae.addFunction(fnName, fn);
  if (resTypeName && resTypeName !== fnName && !overrideFnName?.includes("$") && !dae.getFunction(resTypeName)) {
    dae.addFunction(resTypeName, fn);
  }
  if (!overrideFnName && qualName && qualName !== fnName && qualName !== sym.name) dae.addFunction(qualName, fn);

  const isSpeculativeFnDae = dae.classKind === "function" && !(dae as any).parentDae;
  if (!isSpeculativeFnDae) {
    let rootDae: any = (flattener as any)?.currentRootDae ?? dae;
    while (rootDae.parentDae) rootDae = rootDae.parentDae;
    rootDae.addFunction(fnName, fn);
    if (resTypeName && resTypeName !== fnName && !overrideFnName?.includes("$") && !rootDae.getFunction(resTypeName)) {
      rootDae.addFunction(resTypeName, fn);
    }
    if (!overrideFnName && qualName && qualName !== fnName && qualName !== sym.name) rootDae.addFunction(qualName, fn);
  }

  return fn;
}

export function generateRecordConstructors(flattener: any, rootClassId: SymbolId, dae: DAEBuilder): void {
  const db: QueryDB = flattener.db;
  const rootSym = db.symbol(rootClassId);
  const childEntries = db.childrenOf(rootClassId);
  const candidates: any[] = [];
  for (const sym of childEntries) {
    if (sym && sym.kind === "Class" && sym.id !== rootClassId) candidates.push(sym);
  }
  const fileSymbols: any[] = flattener.getFileSymbols(rootSym?.resourceId);
  const fileClasses = fileSymbols.filter((s: any) => s.kind === "Class" && s.id !== rootClassId);
  for (const fc of fileClasses) {
    if (!candidates.some((c) => c.id === fc.id)) candidates.push(fc);
  }

  const isRecordSym = (sym: any): boolean => {
    if (sym.id === rootClassId) return false;
    return flattener.isRecordSym(sym);
  };

  const usedRecordNames = new Set<string>();
  if (dae.classKind !== "function" && flattener.usedRecordNames) {
    for (const name of flattener.usedRecordNames) {
      usedRecordNames.add(name);
      if (name.includes(".")) usedRecordNames.add(name.split(".").pop()!);
    }
  }
  if (dae.classKind !== "function" && flattener.usedRecordSymIds) {
    for (const sid of flattener.usedRecordSymIds) {
      const s = db.symbol(sid);
      if (s) {
        if (s.name) usedRecordNames.add(s.name);
        const q = getSymbolQualifiedName(db, s.id);
        if (q) usedRecordNames.add(q);
        if (s.resourceId === rootSym?.resourceId && !candidates.some((c) => c.id === s.id)) candidates.push(s);
      }
    }
  }
  const rootElements = db.query<SymbolId[]>("instantiate", rootClassId);
  const rootComps: SymbolEntry[] = [];
  if (rootElements && rootElements.length > 0) {
    for (const eid of rootElements) {
      const entry = db.symbol(eid);
      if (entry && entry.kind === "Component") rootComps.push(entry);
    }
  } else {
    for (const comp of db.childrenOf(rootClassId) || []) {
      if (comp && comp.kind === "Component") rootComps.push(comp);
    }
  }
  for (const comp of rootComps) {
    const compInst = db.query<ComponentInstanceData>("componentInstance", comp.id);
    const cMeta = (comp.metadata as any) || {};
    const typeSpec = compInst?.typeSpecifier ?? cMeta.typeSpecifier;
    if (typeSpec) {
      const cleanType = typeSpec.includes(".") ? typeSpec.split(".").pop()! : typeSpec;
      usedRecordNames.add(cleanType);
      usedRecordNames.add(typeSpec);
    }
  }
  for (let i = 0; i < dae.varCount; i++) {
    const ct = dae.getVarCustomType(i);
    if (ct) {
      usedRecordNames.add(ct);
      if (ct.includes(".")) usedRecordNames.add(ct.split(".").pop()!);
    }
  }
  for (const [_, fn] of dae.functions) {
    const isAutoRecCtor = Boolean(fn.description?.startsWith("Automatically generated record constructor"));
    for (let i = 0; i < fn.varCount; i++) {
      if (isAutoRecCtor && fn.getVarName(i) === "res") continue;
      const ct = fn.getVarCustomType(i);
      if (ct) {
        usedRecordNames.add(ct);
        if (ct.includes(".") && !ct.includes("$")) usedRecordNames.add(ct.split(".").pop()!);
      }
    }
  }
  const rootCst = db.cstNode(rootClassId) as any;
  if (rootCst && rootCst.text) {
    for (const sym of candidates) {
      if (isRecordSym(sym)) {
        const name = sym.name;
        const qName = getSymbolQualifiedName(db, sym.id);
        const pat = new RegExp(`\\b(${escapeRegExp(name)}|${escapeRegExp(qName)})\\s*\\(`, "m");
        if (pat.test(rootCst.text)) {
          usedRecordNames.add(name);
          if (qName) usedRecordNames.add(qName);
        }
      }
    }
    for (const fsym of fileSymbols) {
      if (fsym && fsym.kind === "Component" && fsym.parentId && fsym.parentId !== rootClassId) {
        const qCompName = getSymbolQualifiedName(db, fsym.id);
        if (qCompName && new RegExp(`\\b${escapeRegExp(qCompName)}\\b`).test(rootCst.text)) {
          const compInst = db.query<ComponentInstanceData>("componentInstance", fsym.id);
          const rawTarget = db.query<any>("classInstance", fsym.id);
          let compTarget: SymbolEntry | null =
            typeof rawTarget === "number" ? (db.symbol(rawTarget) ?? null) : (rawTarget ?? null);
          if (!compTarget) {
            const tSpec = compInst?.typeSpecifier ?? (fsym.metadata as any)?.typeSpecifier;
            if (tSpec) {
              compTarget = db.byName(String(tSpec).split(".").pop()!).find((t) => isRecordSym(t)) ?? null;
            }
          }
          if (compTarget && isRecordSym(compTarget)) {
            usedRecordNames.add(compTarget.name);
            const qTarget = getSymbolQualifiedName(db, compTarget.id) || compTarget.name;
            if (qTarget) usedRecordNames.add(qTarget);
            const parentSym = fsym.parentId ? db.symbol(fsym.parentId) : null;
            if (
              compInst?.modification?.args &&
              compInst.modification.args.length > 0 &&
              fsym.name &&
              !(parentSym && isFunctionSym(db, parentSym))
            ) {
              if (!flattener.instantiatedRecordComponents) {
                flattener.instantiatedRecordComponents = new Map<string, Set<string>>();
              }
              let s = flattener.instantiatedRecordComponents.get(qTarget);
              if (!s) {
                s = new Set<string>();
                flattener.instantiatedRecordComponents.set(qTarget, s);
              }
              s.add(fsym.name);
              if (compTarget.name && compTarget.name !== qTarget) {
                let s2 = flattener.instantiatedRecordComponents.get(compTarget.name);
                if (!s2) {
                  s2 = new Set<string>();
                  flattener.instantiatedRecordComponents.set(compTarget.name, s2);
                }
                s2.add(fsym.name);
              }
            }
          }
        }
      }
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const sym of candidates) {
      if (isRecordSym(sym)) {
        const name = sym.name;
        const qName = getSymbolQualifiedName(db, sym.id);
        if (usedRecordNames.has(name) || (qName && usedRecordNames.has(qName))) {
          const instElements = db.query<SymbolId[]>("instantiate", sym.id);
          const comps: SymbolEntry[] = [];
          if (instElements && instElements.length > 0) {
            for (const eid of instElements) {
              const entry = db.symbol(eid);
              if (entry && entry.kind === "Component") comps.push(entry);
            }
          } else {
            for (const comp of db.childrenOf(sym.id) || []) {
              if (comp && comp.kind === "Component") comps.push(comp);
            }
          }
          for (const comp of comps) {
            const compInst = db.query<ComponentInstanceData>("componentInstance", comp.id);
            const cMeta = (comp.metadata as any) || {};
            const typeSpec = compInst?.typeSpecifier ?? cMeta.typeSpecifier;
            if (typeSpec) {
              const cleanType = typeSpec.includes(".") ? typeSpec.split(".").pop()! : typeSpec;
              if (!usedRecordNames.has(cleanType)) {
                usedRecordNames.add(cleanType);
                usedRecordNames.add(typeSpec);
                changed = true;
              }
            }
          }
        }
      }
    }
  }

  const recordNameCounts = new Map<string, number>();
  for (const sym of candidates) {
    if (isRecordSym(sym) && sym.name) {
      recordNameCounts.set(sym.name, (recordNameCounts.get(sym.name) ?? 0) + 1);
    }
  }

  const isRecordUsed = (sym: any): boolean => {
    if (!sym || !sym.name) return false;
    const name = sym.name;
    const qName = getSymbolQualifiedName(db, sym.id);
    if (sym.parentId && sym.parentId !== rootClassId && flattener.isClassPartial?.(sym.parentId)) {
      if ((dae as any).specializedPrefix && sym.parentId === (dae as any).enclosingScopeId) {
        return usedRecordNames.has(name) || (Boolean(qName) && usedRecordNames.has(qName!));
      }
      return false;
    }
    if (sym.parentId && sym.parentId !== rootClassId && (recordNameCounts.get(name) ?? 0) > 1) {
      return Boolean(flattener.usedRecordSymIds?.has(sym.id)) || (Boolean(qName) && usedRecordNames.has(qName!));
    }
    return usedRecordNames.has(name) || (Boolean(qName) && usedRecordNames.has(qName!));
  };

  for (const sym of candidates) {
    if (isRecordSym(sym) && isRecordUsed(sym)) {
      const specOverrideName =
        (dae as any).specializedPrefix &&
        sym.parentId &&
        sym.parentId !== rootClassId &&
        flattener.isClassPartial?.(sym.parentId)
          ? `${(dae as any).specializedPrefix}.${sym.name}`
          : undefined;
      const fn = flattener.generateRecordConstructorFor(sym, dae, rootClassId, specOverrideName);
      if (fn) {
        const qualName = getSymbolQualifiedName(db, sym.id) || sym.name;
        const compNames =
          flattener.instantiatedRecordComponents?.get(qualName) ??
          flattener.instantiatedRecordComponents?.get(sym.name);
        if (compNames && compNames.size > 0) {
          for (const compName of compNames) {
            const specFnName = `${qualName}$${compName}`;
            const specSimpleName = `${sym.name}$${compName}`;
            if (!dae.functions.has(specFnName)) {
              const specFn = new DAEBuilder(dae.interner, specFnName, "");
              specFn.classKind = "function";
              specFn.description = `Automatically generated record constructor for ${specFnName}`;
              if (flattener.isOperatorRecordSym(sym)) {
                (specFn as any).isOperatorRecord = true;
                specFn.extensionMetadata.isOperatorRecord = true;
              }
              for (let i = 0; i < fn.varCount; i++) {
                const vName = fn.getVarName(i);
                if (vName === "res") continue;
                const vType = fn.getVarType(i);
                const vCausality = fn.getVarCausality(i);
                const vProt = fn.isVarProtected(i);
                const vShape = fn.getVarShape(i);
                const vCustom = fn.getVarCustomType(i);
                const vExpr = fn.getVarExpression(i);
                const vEnumLits = fn.getVarEnumerationLiterals(i);
                const specVarIdx = specFn.addVariable(vName, vType, Variability.Continuous, vCausality);
                if (vProt) specFn.setVarProtected(specVarIdx, true);
                if (vCustom) specFn.setVarCustomType(specVarIdx, vCustom);
                if (vEnumLits) specFn.setVarEnumerationLiterals(specVarIdx, vEnumLits);
                if (vShape.length > 0) specFn.setVarShape(specVarIdx, vShape);
                if (vExpr !== undefined && vExpr >= 0) {
                  const ek = fn.getExprKind(vExpr);
                  if (ek === ExprKind.RealLiteral) {
                    specFn.setVarExpression(specVarIdx, specFn.addRealLiteral(fn.getExprRealValue(vExpr)));
                  } else if (ek === ExprKind.IntLiteral) {
                    specFn.setVarExpression(specVarIdx, specFn.addIntLiteral(fn.getExprData1(vExpr)));
                  } else if (ek === ExprKind.BoolLiteral) {
                    specFn.setVarExpression(specVarIdx, specFn.addBoolLiteral(fn.getExprData1(vExpr) !== 0));
                  }
                }
              }
              const specResIdx = specFn.addVariable("res", VarType.Real, Variability.Continuous, Causality.Output);
              specFn.setVarCustomType(specResIdx, specSimpleName);
              dae.addFunction(specFnName, specFn);
              if (specSimpleName !== specFnName) {
                dae.addFunction(specSimpleName, specFn);
              }
            }
          }
        }
      }
      if (dae.classKind !== "function") {
        for (const ch of db.childrenOf(sym.id) || []) {
          if (ch && ch.name === "equalityConstraint" && isFunctionSym(db, ch)) {
            const qualName = getSymbolQualifiedName(db, sym.id) || sym.name;
            const eqFnName = `${qualName}.equalityConstraint`;
            if (!dae.functions.has(eqFnName) && !flattener.activeFlatteningFunctionIds.has(ch.id)) {
              const eqFn = flattener.flattenFunction(ch.id, eqFnName, undefined, dae);
              (eqFn as any).wasCalled = true;
              dae.addFunction(eqFnName, eqFn);
            }
          }
        }
      }
      if (flattener.isOperatorRecordSym(sym) && dae.classKind !== "function") {
        const ctors = db.query<any[]>("operatorConstructors", sym.id);
        if (ctors && ctors.length > 0) {
          for (const ctor of ctors) {
            if (
              (flattener.usedOperatorFunctions?.has(ctor.qualifiedName) ||
                (!dae.extensionMetadata?.["isOldFrontend"] && usedRecordNames.has(sym.name))) &&
              !dae.functions.has(ctor.qualifiedName) &&
              !flattener.activeFlatteningFunctionIds.has(ctor.funcSymId)
            ) {
              const ctorFn = flattener.flattenFunction(ctor.funcSymId, ctor.qualifiedName, undefined, dae);
              dae.addFunction(ctor.qualifiedName, ctorFn);
            }
          }
        }
      }
    }
  }
}

export function flattenFunction(
  flattener: any,
  fnSymId: SymbolId,
  fnName: string,
  modifiers?: any[],
  parentDae?: DAEBuilder,
  enclosingScopeId?: SymbolId,
): DAEBuilder {
  const db: QueryDB = flattener.db;
  const prevFnId = flattener.currentFlatteningFunctionId;
  const prevClassId = flattener.currentClassId;
  const prevEnclosingScope = flattener.currentFunctionEnclosingScope;
  const prevActiveLoopVars = flattener.activeLoopVars;
  flattener.activeLoopVars = new Set<string>();
  flattener.state.activeLoopVars = flattener.activeLoopVars;
  flattener.currentFlatteningFunctionId = fnSymId;
  flattener.activeFlatteningFunctionIds.add(fnSymId);
  const fnParentId = db.symbol(fnSymId)?.parentId;
  if (enclosingScopeId !== undefined) {
    flattener.currentClassId = enclosingScopeId;
    if (fnParentId !== undefined && fnParentId !== enclosingScopeId) {
      flattener.currentFunctionEnclosingScope = enclosingScopeId;
    }
  } else if (fnParentId !== undefined && fnParentId !== null) {
    flattener.currentClassId = fnParentId;
    flattener.currentFunctionEnclosingScope = fnParentId;
  } else {
    flattener.currentFunctionEnclosingScope = null;
  }

  const cleanFnName = fnName.replace(/^\.+/, "");
  const fn = new DAEBuilder(parentDae ? parentDae.interner : undefined, cleanFnName, "");
  (fn as any).parentDae = parentDae;
  (fn as any).db = db;
  fn.classKind = "function";
  (fn as any).symId = fnSymId;
  (fn as any).flattener = flattener;
  const resolvedEncScope = enclosingScopeId ?? fnParentId ?? db.symbol(fnSymId)?.parentId;
  (fn as any).enclosingScopeId = resolvedEncScope;
  const sameEnclosingAsParent =
    resolvedEncScope !== undefined && resolvedEncScope === (parentDae as any)?.enclosingScopeId;
  (fn as any).componentPrefix =
    (flattener as any).currentFunctionComponentPrefix ??
    (sameEnclosingAsParent ? (parentDae as any)?.componentPrefix : undefined);
  (fn as any).specializedPrefix =
    (flattener as any).currentFunctionSpecializedPrefix ??
    (sameEnclosingAsParent ? (parentDae as any)?.specializedPrefix : undefined);
  (fn as any).componentParentMods =
    (parentDae as any)?.componentParentMods ??
    (parentDae?.classKind !== "function" ? flattener.currentParentMods : undefined);
  (fn as any).isBeingFlattened = true;
  fn.extensionMetadata["isOldFrontend"] = Boolean(
    parentDae?.extensionMetadata?.["isOldFrontend"] ?? (flattener.options as any)?.isOldFrontend,
  );
  (fn.extensionMetadata as any).hasOldInstOption = Boolean((parentDae?.extensionMetadata as any)?.hasOldInstOption);

  const prevImports = flattener.currentImports;
  try {
    const parts = cleanFnName.split(".");
    const baseName = parts[parts.length - 1]!;

    if (parentDae) {
      parentDae.addFunction(cleanFnName, fn);
      parentDae.addFunction(fnName, fn);
      const naturalParentId = fnParentId ?? db.symbol(fnSymId)?.parentId;
      if (baseName && !cleanFnName.includes("$") && (!enclosingScopeId || enclosingScopeId === naturalParentId)) {
        parentDae.addFunction(baseName, fn);
      }
    }
    fn.addFunction(cleanFnName, fn);
    fn.addFunction(fnName, fn);
    if (baseName && !cleanFnName.includes("$")) fn.addFunction(baseName, fn);

    const fnImports = flattener.collectClassImports(fnSymId);
    flattener.currentImports = new Map([...flattener.currentImports, ...fnImports]);

    const cst = db.cstNode(fnSymId) as any;
    if (cst) {
      (fn as any).fnRange = getClassDiagRange(cst);
    }
    if (cst?.text) {
      const uncommentedText = cst.text.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
      if (/\b__OpenModelica_EarlyInline\s*=\s*true\b/.test(uncommentedText)) {
        (fn as any).isEarlyInline = true;
      }
    }

    let _pureDeclared = false;
    void _pureDeclared;
    let impureDeclared = false;
    if (cst) {
      for (const child of cst.children || []) {
        if (child.type === "class_prefixes") {
          const pfx = (child.text ?? "").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
          const words = pfx.split(/\s+/).filter(Boolean);
          if (words.includes("pure")) _pureDeclared = true;
          if (words.includes("impure")) impureDeclared = true;
        }
      }
    }

    if (cst?.text && /\bimpure\s+function\b/.test(cst.text)) {
      fn.isImpure = true;
      (fn as any).isExplicitImpure = true;
    }

    if (impureDeclared) {
      fn.isImpure = true;
      (fn as any).isExplicitImpure = true;
    }

    const findDesc = (node: any): string | null => {
      if (!node) return null;
      if (
        node.type === "element" ||
        node.type === "component_clause" ||
        node.type === "external_clause" ||
        node.type === "equation_section" ||
        node.type === "algorithm_section"
      )
        return null;
      if (node.type === "description_string" || node.type === "string_literal") {
        let t = node.text?.trim() ?? "";
        if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
      }
      for (const child of node.children || []) {
        const d = findDesc(child);
        if (d) return d;
      }
      return null;
    };
    const fnDesc = findDesc(cst);
    if (fnDesc) fn.description = fnDesc;

    const findExternalClause = (node: any): any => {
      if (!node) return null;
      if (node.type === "external_clause") return node;
      for (const child of node.children || []) {
        const found = findExternalClause(child);
        if (found) return found;
      }
      return null;
    };
    let extClause = findExternalClause(cst);

    const shortSpec = getShortClassSpecifierNode(cst);
    if (shortSpec) {
      (fn as any).isShortFunc = true;
    }
    let targetSymId = fnSymId;
    const combinedMods = [...(modifiers ?? [])];

    const visitedUnwrap = new Set<SymbolId>();
    while (!visitedUnwrap.has(targetSymId)) {
      visitedUnwrap.add(targetSymId);
      const currSym = db.symbol(targetSymId);
      const currCst = db.cstNode(targetSymId) as any;
      if (!currSym || !currCst) break;

      const currParentSym = currSym.parentId != null ? db.symbol(currSym.parentId) : null;
      const isCurrInNonFuncClass = Boolean(currParentSym && !isFunctionSym(db, currParentSym));
      const compModsArgs = (fn as any).componentParentMods?.args ?? flattener.currentParentMods?.args ?? [];
      const allCandidateMods = [...compModsArgs, ...combinedMods];
      let matchedRedecl: any = null;
      let matchedRedeclTarget: SymbolEntry | null = null;
      for (let i = allCandidateMods.length - 1; i >= 0; i--) {
        const a = allCandidateMods[i];
        if (!a || a.isBreak || !(a.isRedeclaration || a.redeclaredTypeSpecifier) || a.name !== currSym.name) {
          continue;
        }
        if (isCurrInNonFuncClass && a.ownerClassId) {
          const ownerSym = db.symbol(a.ownerClassId);
          if (ownerSym && isFunctionSym(db, ownerSym)) {
            continue;
          }
        }
        const rawSpec = String(a.redeclaredTypeSpecifier ?? "").replace(/^\.+/, "");
        if (!rawSpec) continue;
        const lookupScope =
          a.evaluationScopeId ?? a.ownerClassId ?? currSym.parentId ?? fnParentId ?? flattener.currentRootClassId;
        const resolver =
          (lookupScope
            ? rawSpec.includes(".")
              ? db.query<any>("resolveName", lookupScope)
              : (db.query<any>("resolveSimpleName", lookupScope) ?? db.query<any>("resolveName", lookupScope))
            : null) ??
          (flattener.currentRootClassId ? db.query<any>("resolveName", flattener.currentRootClassId) : null);
        let candSym = resolver ? resolver(rawSpec) : null;
        if (!candSym) {
          const shortR = rawSpec.includes(".") ? rawSpec.split(".").pop()! : rawSpec;
          candSym = db.byName(shortR).find((e: any) => {
            if (e.kind !== "Class" && e.kind !== "Function") return false;
            if (rawSpec.includes(".")) {
              const qn = getSymbolQualifiedName(db, e.id);
              return qn === rawSpec || qn.endsWith(`.${rawSpec}`);
            }
            return true;
          });
        }
        if (candSym && !visitedUnwrap.has(candSym.id)) {
          matchedRedecl = a;
          matchedRedeclTarget = candSym;
          break;
        }
      }

      if (matchedRedecl && matchedRedeclTarget) {
        const subArgs = matchedRedecl.nestedArgs ?? matchedRedecl.args;
        if (subArgs && subArgs.length > 0) {
          combinedMods.unshift(
            ...subArgs.map((sa: any) => ({
              ...sa,
              ownerClassId: sa.ownerClassId ?? matchedRedeclTarget!.id,
              evaluationScopeId:
                sa.evaluationScopeId ??
                matchedRedecl.evaluationScopeId ??
                matchedRedecl.ownerClassId ??
                currSym.parentId,
            })),
          );
        }
        targetSymId = matchedRedeclTarget.id;
        if (!fn.description) {
          const targetCst = db.cstNode(targetSymId) as any;
          const targetDesc = findDesc(targetCst);
          if (targetDesc) fn.description = targetDesc;
        }
        continue;
      }

      const currShortSpec = getShortClassSpecifierNode(currCst);
      if (!currShortSpec) break;

      const typeSpecNode =
        Cst.ShortClassSpecifier.typeSpecifier(currShortSpec) ??
        currShortSpec.children?.find((c: any) => c.type === "type_specifier");
      const rawBaseName = typeSpecNode?.text?.trim() ?? "";
      const cleanBase = rawBaseName.replace(/^\.+/, "");
      const modNode =
        Cst.ShortClassSpecifier.classModification(currShortSpec) ??
        currShortSpec.children?.find((c: any) => c.type === "class_modification");
      if (modNode) {
        const parsed = db.query<any>("effectiveModification", targetSymId);
        if (parsed?.args) {
          combinedMods.unshift(
            ...parsed.args.map((pa: any) => ({
              ...pa,
              ownerClassId: pa.ownerClassId ?? targetSymId,
              evaluationScopeId: pa.evaluationScopeId ?? currSym.parentId ?? fnParentId,
            })),
          );
        }
      } else if (targetSymId === fnSymId) {
        const mathMatch = cleanBase.match(
          /^(?:Modelica\.Math\.)?(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|exp|log|log10|sqrt)$/,
        );
        if (mathMatch) {
          (fn as any).aliasTo = mathMatch[1];
        }
      }

      if (!cleanBase) break;
      const parentScopeId = currSym.parentId ?? fnParentId;
      const resolver =
        (parentScopeId ? db.query<any>("resolveName", parentScopeId) : null) ??
        db.query<any>("resolveName", targetSymId) ??
        db.query<any>("resolveSimpleName", targetSymId);
      let baseSym = resolver ? resolver(cleanBase) : null;
      if (!baseSym) {
        const shortBase = cleanBase.includes(".") ? cleanBase.split(".").pop()! : cleanBase;
        baseSym = db.byName(shortBase).find((e: any) => {
          if (e.kind !== "Class" && e.kind !== "Function") return false;
          if (cleanBase.includes(".")) {
            const qn = getSymbolQualifiedName(db, e.id);
            return qn === cleanBase || qn.endsWith(`.${cleanBase}`);
          }
          return true;
        });
      }
      if (!baseSym || visitedUnwrap.has(baseSym.id)) break;
      if (targetSymId === fnSymId && baseSym.parentId === currSym.parentId && !cleanBase.includes(".")) {
        (fn as any).shortBaseFuncName = baseSym.name;
      }
      targetSymId = baseSym.id;
      if (!fn.description) {
        const targetCst = db.cstNode(baseSym.id) as any;
        const targetDesc = findDesc(targetCst);
        if (targetDesc) fn.description = targetDesc;
      }
    }

    const extMods = collectExtendsMods(flattener, targetSymId);
    if (extMods.length > 0) {
      combinedMods.unshift(...extMods);
    }

    const elements = db.query<SymbolId[]>("instantiate", targetSymId);
    if (elements && elements.length > 0) {
      flattener.instantiateElements(elements, "", fn, { args: combinedMods, currentClassId: targetSymId });
    } else {
      const children = db.childrenOf(targetSymId);
      const childIds: SymbolId[] = [];
      for (const ch of children) {
        if (ch.kind === "Component") childIds.push(ch.id);
      }
      if (childIds.length > 0) {
        flattener.instantiateElements(childIds, "", fn, { args: combinedMods, currentClassId: targetSymId });
      }
    }

    flattener.generateRecordConstructors(targetSymId, fn);

    const childFuncs =
      targetSymId === fnSymId
        ? db.childrenOf(targetSymId).filter((c) => c.kind === "Class" && isFunctionSym(db, c))
        : [];
    for (const cf of childFuncs) {
      const nestedQualName = `${cleanFnName}.${cf.name}`;
      const nestedFn = flattener.flattenFunction(cf.id, nestedQualName, undefined, fn);
      fn.addFunction(nestedQualName, nestedFn);
      fn.addFunction(cf.name, nestedFn);
      if (parentDae) {
        parentDae.addFunction(nestedQualName, nestedFn);
      }
    }

    let inheritedExtClause: SymbolEntry | null = null;
    const ownExtClause = findExternalClause(cst);
    const hasOwnAlgo = Boolean(cst && /\balgorithm\b/.test(cst.text ?? ""));
    if (ownExtClause || hasOwnAlgo) {
      const extendsChildren = db.childrenOf(fnSymId).filter((c) => c.kind === "Extends");
      for (const ext of extendsChildren) {
        const base = db.query<SymbolEntry | null>("resolvedBaseClass", ext.id);
        if (base) {
          const baseCst = db.cstNode(base.id) as any;
          if (findExternalClause(baseCst)) {
            inheritedExtClause = ext;
            break;
          }
        }
      }
    }

    const isOldFrontend = Boolean(
      fn.extensionMetadata?.["isOldFrontend"] ||
      parentDae?.extensionMetadata?.["isOldFrontend"] ||
      (flattener.options as any)?.isOldFrontend,
    );
    if (!isOldFrontend && (ownExtClause || hasOwnAlgo) && inheritedExtClause) {
      const extCst = db.cstNode(inheritedExtClause.id) as any;
      const notifRange = extCst
        ? {
            startPosition: extCst.startPosition,
            endPosition: extCst.endPosition,
            startOffset: extCst.startIndex ?? extCst.startOffset,
            endOffset: extCst.endIndex ?? extCst.endOffset,
          }
        : undefined;
      fn.diagnostics.push({
        severity: "notification",
        code: ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
        message: "From here:",
        range: notifRange,
      });
      const fnRange = cst
        ? {
            startPosition: cst.startPosition,
            endPosition: cst.endPosition,
            startOffset: cst.startIndex ?? cst.startOffset,
            endOffset: cst.endIndex ?? cst.endOffset,
          }
        : undefined;
      fn.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.FUNCTION_MULTIPLE_ALGORITHM.code,
        message: ModelicaErrorCode.FUNCTION_MULTIPLE_ALGORITHM.message(baseName),
        range: fnRange,
      });
    }

    if (!extClause && targetSymId !== fnSymId) {
      const targetCst = db.cstNode(targetSymId) as any;
      extClause = findExternalClause(targetCst);
    }

    if (extClause) {
      const isCMath =
        /\b(?:sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|exp|log|log10|sqrt|ceil|floor|fabs|pow|fmod)\s*\(/.test(
          extClause.text ?? "",
        );
      if (!extClause.text?.includes('"builtin"') && !isCMath && (!cst?.text || !/\bpure\s+function\b/.test(cst.text))) {
        fn.isImpure = true;
      }

      const includeMatch = extClause.text?.match(/\bInclude\s*=\s*"((?:[^"\\]|\\.)*)"/);
      if (includeMatch) {
        (fn as any).externalInclude = includeMatch[1]!.replace(/\\"/g, '"').replace(/\\n/g, "\n");
      }

      let extText = extClause.text?.trim() ?? "";
      extText = extText.replace(/\s*annotation\s*\([\s\S]*?\)\s*;?$/, "").trim();
      if (extText.endsWith(";")) extText = extText.slice(0, -1).trim();
      const hasCall = extClause.children?.some((c: any) => c.type === "external_function_call") || /\(/.test(extText);

      const langMatch = extText.match(/^external\s+(?:"[^"]+"|\bbuiltin\b)/);
      if (!langMatch) {
        extText = extText.replace(/^external\b/, 'external "C"');
      }

      // 1. Language specification
      const langSpecNode = extClause.children?.find(
        (c: any) => c.type === "language_specification" || c.type === "string_literal",
      );
      let lang: string | null = null;
      if (langSpecNode) {
        const rawLang = langSpecNode.text?.trim() ?? "";
        lang = rawLang.startsWith('"') && rawLang.endsWith('"') ? rawLang.slice(1, -1) : rawLang;
      } else {
        const langRawMatch = extClause.text?.match(/^external\s+("(?:[^"\\]|\\.)*")/);
        if (langRawMatch) {
          const rawLang = langRawMatch[1];
          lang = rawLang.startsWith('"') ? rawLang.slice(1, -1) : rawLang;
        }
      }
      if (
        lang &&
        lang !== "C" &&
        lang !== "FORTRAN 77" &&
        lang !== "Fortran 77" &&
        lang !== "builtin" &&
        lang !== "none"
      ) {
        const bCst = db.cstNode(targetSymId) as any;
        const rangeObj = getClassDiagRange(bCst);
        fn.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.EXTERNAL_INVALID_LANGUAGE.code,
          message: ModelicaErrorCode.EXTERNAL_INVALID_LANGUAGE.message(lang),
          range: rangeObj,
        });
      }

      // 2. Check if external function return (explicit LHS) has array type
      const extCallNode = extClause.children?.find((c: any) => c.type === "external_function_call");
      let lhsVarName: string | null = null;
      if (extCallNode?.children) {
        const eqIdx = extCallNode.children.findIndex((c: any) => c.text?.trim() === "=");
        if (eqIdx > 0) {
          const compRef = extCallNode.children
            .slice(0, eqIdx)
            .find((c: any) => c.type === "component_reference" || c.type === "identifier");
          if (compRef) {
            lhsVarName = compRef.text?.trim() ?? null;
          }
        }
      }
      if (!lhsVarName) {
        const extLhsMatch = extText.match(/^external(?:\s+"[^"]+"|\s+\b\w+\b)?\s+([a-zA-Z_]\w*)\s*=/);
        if (extLhsMatch) lhsVarName = extLhsMatch[1]!;
      }
      if (lhsVarName) {
        const vIdx = fn.getVarIdxByName(lhsVarName);
        if (vIdx >= 0) {
          const shape = fn.getVarShape(vIdx);
          if (shape && shape.length > 0) {
            const vt = fn.getVarType(vIdx);
            const vtName = varTypeName(vt);
            const shapeStr = shape.map((s) => (s > 0 ? String(s) : ":")).join(", ");
            const typeStr = `${vtName}[${shapeStr}]`;
            const bCst = db.cstNode(targetSymId) as any;
            const rangeObj = getClassDiagRange(bCst);
            fn.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.EXTERNAL_ARRAY_RETURN_NOT_ALLOWED.code,
              message: ModelicaErrorCode.EXTERNAL_ARRAY_RETURN_NOT_ALLOWED.message(typeStr),
              range: rangeObj,
            });
          }
        }
      }

      // 3. External function call arguments validation
      const exprListNode = extCallNode?.children?.find(
        (c: any) => c.type === "expression_list" || c.type === "ExpressionList",
      );
      const argList: { text: string; node?: any }[] = [];
      if (exprListNode?.children) {
        for (const ch of exprListNode.children) {
          if (ch.type === "expression" || (ch.text && ch.text !== "," && ch.text !== "(" && ch.text !== ")")) {
            argList.push({ text: ch.text?.trim() ?? "", node: ch });
          }
        }
      } else {
        const callArgsMatch = extText.match(/\((.*)\)\s*$/);
        if (callArgsMatch) {
          const rawArgsStr = callArgsMatch[1].trim();
          if (rawArgsStr) {
            let depth = 0,
              current = "";
            for (let i = 0; i < rawArgsStr.length; i++) {
              const ch = rawArgsStr[i];
              if (ch === "(" || ch === "{" || ch === "[") depth++;
              else if (ch === ")" || ch === "}" || ch === "]") depth--;
              if (ch === "," && depth === 0) {
                if (current.trim()) argList.push({ text: current.trim() });
                current = "";
              } else {
                current += ch;
              }
            }
            if (current.trim()) argList.push({ text: current.trim() });
          }
        }
      }

      for (const arg of argList) {
        const a = arg.text;
        const isArrayCtor =
          arg.node?.type === "array_constructor" ||
          arg.node?.children?.some((c: any) => c.type === "array_constructor") ||
          (a.startsWith("{") && a.endsWith("}"));
        if (isArrayCtor) {
          const bCst = db.cstNode(targetSymId) as any;
          const rangeObj = getClassDiagRange(bCst);
          fn.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.EXTERNAL_INVALID_ARG_EXPR.code,
            message: ModelicaErrorCode.EXTERNAL_INVALID_ARG_EXPR.message(a),
            range: rangeObj,
          });
          break;
        }
        const sizeMatch = a.match(/^size\s*\(\s*([a-zA-Z_]\w*)\s*,\s*(.*)\)$/);
        if (sizeMatch) {
          const dimExpr = sizeMatch[2]!.trim();
          const isConstNum = /^\d+$/.test(dimExpr);
          if (!isConstNum) {
            const bCst = db.cstNode(targetSymId) as any;
            const rangeObj = getClassDiagRange(bCst);
            fn.diagnostics.push({
              severity: "error",
              code: ModelicaErrorCode.EXTERNAL_INVALID_ARG_SIZE_CONST.code,
              message: ModelicaErrorCode.EXTERNAL_INVALID_ARG_SIZE_CONST.message(a),
              range: rangeObj,
            });
            break;
          }
        }
      }

      if (!hasCall) {
        // Synthesize default external call: [output =] name(inputs) per MLS §12.9.1
        const inputsWithSizes: string[] = [];
        const outputsWithSizes: string[] = [];
        const outputs: string[] = [];
        let singleOutputIsArray = false;
        for (let i = 0; i < fn.varCount; i++) {
          if (fn.isVarRemoved(i)) continue;
          const causality = fn.getVarCausality(i);
          const varName = fn.getVarName(i);
          const shape = fn.getVarShape(i);
          const shapeExprs = fn.getVarShapeExprs?.(i);
          const rank = Math.max(shape?.length ?? 0, shapeExprs?.length ?? 0);
          if (causality === Causality.Input) {
            inputsWithSizes.push(varName);
            for (let d = 1; d <= rank; d++) {
              inputsWithSizes.push(`size(${varName}, ${d})`);
            }
          } else if (causality === Causality.Output) {
            outputs.push(varName);
            if (rank > 0) singleOutputIsArray = true;
            outputsWithSizes.push(varName);
            for (let d = 1; d <= rank; d++) {
              outputsWithSizes.push(`size(${varName}, ${d})`);
            }
          }
        }
        let defaultCall: string;
        if (outputs.length === 1 && !singleOutputIsArray) {
          defaultCall = `${outputs[0]} = ${baseName}(${inputsWithSizes.join(", ")})`;
        } else {
          const allArgs = [...inputsWithSizes, ...outputsWithSizes];
          defaultCall = `${baseName}(${allArgs.join(", ")})`;
        }
        extText = `${extText} ${defaultCall}`.trim();
      }

      if (!extText.endsWith(";")) extText += ";";
      fn.externalDecl = extText;
    }

    const targetFnCst = (db.cstNode(targetSymId) as any) ?? cst;
    const fnRawText = targetFnCst?.text ?? "";
    const derivMatch = fnRawText.match(/\bderivative\s*(?:\([^)]*\))?\s*=\s*([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/);
    if (derivMatch && parentDae) {
      const derivRawName = derivMatch[1]!;
      const scopeToSearch = enclosingScopeId ?? fnParentId ?? targetSymId;
      const resolver = db.query<any>("resolveName", scopeToSearch) ?? db.query<any>("resolveSimpleName", scopeToSearch);
      const derivSym =
        (fnParentId
          ? db
              .childrenOf(fnParentId)
              ?.find((c) => c.kind === "Class" && c.name === derivRawName && isFunctionSym(db, c))
          : undefined) ??
        resolver?.(derivRawName) ??
        db.byName(derivRawName.split(".").pop()!).find((e) => e.kind === "Class" && isFunctionSym(db, e));
      if (derivSym && !flattener.activeFlatteningFunctionIds.has(derivSym.id)) {
        const derivQualName = getSymbolQualifiedName(db, derivSym.id) || derivSym.name;
        if (!parentDae.functions.has(derivQualName)) {
          const derivFn = flattener.flattenFunction(
            derivSym.id,
            derivQualName,
            undefined,
            parentDae,
            fnParentId ?? undefined,
          );
          (derivFn as any).isDerivativeFunction = true;
          (derivFn as any).wasCalled = true;
          parentDae.addFunction(derivQualName, derivFn);
        }
      }
    }

    flattener.extractClassEquations(targetSymId, "", fn, undefined, {
      args: combinedMods,
      ownerClassId: targetSymId,
    });
    const foldScope = enclosingScopeId ?? fnParentId ?? targetSymId;
    foldArenaConstants(fn, db, foldScope, true);

    flattener.checkCyclicFunctionComponents(fn, targetSymId);
    // Check if function returns an ExternalObject (and is not its constructor)
    for (let i = 0; i < fn.varCount; i++) {
      if (!fn.isVarRemoved(i) && fn.getVarCausality(i) === Causality.Output) {
        const compSym = db.childrenOf(targetSymId)?.find((c) => c.name === fn.getVarName(i));
        if (compSym) {
          const compInst = db.query<ComponentInstanceData>("componentInstance", compSym.id);
          const typeName = compInst?.typeSpecifier;
          if (typeName) {
            const resolver =
              db.query<any>("resolveName", targetSymId) ?? db.query<any>("resolveSimpleName", targetSymId);
            const targetClass =
              resolver?.(typeName) ?? db.byName(typeName.split(".").pop()!).find((e) => e.kind === "Class");
            if (targetClass) {
              const targetChildren = db.childrenOf(targetClass.id);
              const extendsExtObj = targetChildren?.some((c) => c.kind === "Extends" && c.name === "ExternalObject");
              if (extendsExtObj) {
                const isConstructor =
                  cleanFnName.endsWith(".constructor") || (fn.name === "constructor" && fnParentId === targetClass.id);
                if (!isConstructor) {
                  const fnQName = getSymbolQualifiedName(db, targetSymId);
                  const extObjQName = getSymbolQualifiedName(db, targetClass.id);
                  const bCst = db.cstNode(targetSymId) as any;
                  const rangeObj = bCst
                    ? {
                        startOffset: bCst.startIndex ?? bCst.startOffset,
                        endOffset: bCst.endIndex ?? bCst.endOffset,
                        startPosition: bCst.startPosition,
                        endPosition: bCst.endPosition,
                      }
                    : undefined;
                  fn.diagnostics.push({
                    severity: "error",
                    code: ModelicaErrorCode.EXTERNAL_OBJECT_RETURN_RESTRICTION.code,
                    message: ModelicaErrorCode.EXTERNAL_OBJECT_RETURN_RESTRICTION.message(fnQName, extObjQName),
                    range: rangeObj,
                  });
                }
              }
            }
          }
        }
      }
    }

    if (fn.externalDecl && ((fn as any).hasAlgorithmSection || fn.algorithmSections.length > 0)) {
      const bCst = db.cstNode(targetSymId) as any;
      const rangeObj = bCst
        ? {
            startOffset: bCst.startIndex ?? bCst.startOffset,
            endOffset: bCst.endIndex ?? bCst.endOffset,
            startPosition: bCst.startPosition,
            endPosition: bCst.endPosition,
          }
        : undefined;
      fn.diagnostics.push({
        severity: "error",
        code: ModelicaErrorCode.EXTERNAL_WITH_ALGORITHM.code,
        message: ModelicaErrorCode.EXTERNAL_WITH_ALGORITHM.message(),
        range: rangeObj,
      });
    }

    const cleanupFrom = (targetDae: any) => {
      if (!targetDae) return;
      for (const k of [cleanFnName, fnName, baseName]) {
        if (!k) continue;
        targetDae.functions.delete(k);
        const id = targetDae.interner?.lookup(k);
        if (id !== undefined) targetDae.functions.delete(id);
      }
    };

    if (fn.externalDecl && fn.externalDecl.includes('"builtin"')) {
      const saveBuiltin = (targetDae: any) => {
        if (!targetDae) return;
        const map = ((targetDae as any).builtinFunctions ??= new Map<string, DAEBuilder>());
        for (const k of [cleanFnName, fnName, baseName]) {
          if (k) map.set(k, fn);
        }
      };
      saveBuiltin(fn);
      saveBuiltin(parentDae);
      cleanupFrom(parentDae);
      let rootDae: any = (flattener as any)?.currentRootDae ?? parentDae;
      while (rootDae?.parentDae) rootDae = rootDae.parentDae;
      saveBuiltin(rootDae);
      cleanupFrom(rootDae);
    }

    if (fn.diagnostics.some((d: any) => d.severity === "error")) {
      cleanupFrom(parentDae);
      let rootDae: any = (flattener as any)?.currentRootDae ?? parentDae;
      while (rootDae?.parentDae) rootDae = rootDae.parentDae;
      cleanupFrom(rootDae);
      flattener.failedFunctionIds.add(fnSymId);
      const hasInterfaceError = fn.diagnostics.some(
        (d: any) =>
          d.severity === "error" &&
          d.code !== ModelicaErrorCode.CYCLIC_FUNCTION_COMPONENTS.code &&
          !d.message.includes("looking for a function or record"),
      );
      if (hasInterfaceError) {
        flattener.invalidInterfaceFunctionIds.add(fnSymId);
      }
    } else if (parentDae && fn.functions && fn.functions.size > 0) {
      let rootDae: any = (flattener as any)?.currentRootDae ?? parentDae;
      while (rootDae?.parentDae) rootDae = rootDae.parentDae;
      if (rootDae) {
        for (const [nestedName, nestedFn] of fn.functions.entries()) {
          if (nestedFn === fn) continue;
          rootDae.addFunction(nestedName, nestedFn);
        }
      }
      for (const [nestedName, nestedFn] of fn.functions.entries()) {
        if (nestedFn === fn) continue;
        parentDae.addFunction(nestedName, nestedFn);
      }
    }

    return fn;
  } finally {
    flattener.currentImports = prevImports;
    flattener.currentFlatteningFunctionId = prevFnId;
    flattener.currentClassId = prevClassId;
    flattener.currentFunctionEnclosingScope = prevEnclosingScope;
    flattener.activeFlatteningFunctionIds.delete(fnSymId);
    flattener.activeLoopVars = prevActiveLoopVars;
    flattener.state.activeLoopVars = flattener.activeLoopVars;
    (fn as any).isBeingFlattened = false;
  }
}

export function generateOperatorFunctions(flattener: any, dae: DAEBuilder): void {
  if (!flattener.usedOperatorFunctions || flattener.usedOperatorFunctions.size === 0) return;
  const processed = new Set<string>();
  while (processed.size < flattener.usedOperatorFunctions.size) {
    const entries = Array.from((flattener.usedOperatorFunctions as Map<string, SymbolId>).entries());
    for (const [qualName, symId] of entries) {
      if (processed.has(qualName)) continue;
      processed.add(qualName);
      if (!dae.functions.has(qualName)) {
        const fn = flattener.flattenFunction(symId, qualName, undefined, dae);
        dae.addFunction(qualName, fn);
      }
    }
  }
}

export function generateFunctions(flattener: any, rootClassId: SymbolId, dae: DAEBuilder): void {
  const db: QueryDB = flattener.db;
  const rootSym = db.symbol(rootClassId);
  if (!rootSym) return;

  // 1. Member functions inside rootClassId
  const childClasses = db.childrenOf(rootClassId).filter((c) => c.kind === "Class");
  for (const cc of childClasses) {
    if (isFunctionSym(db, cc)) {
      const qualifiedName = `${dae.name}.${cc.name}`;
      const fn = flattener.flattenFunction(cc.id, qualifiedName, undefined, dae);
      if (fn.diagnostics.some((d: any) => d.severity === "error")) {
        for (const d of fn.diagnostics) {
          if (!dae.diagnostics.some((existing) => existing.message === d.message)) {
            (d as any).fromFunction = true;
            dae.diagnostics.push(d);
          }
        }
        flattener.failedFunctionIds.add(cc.id);
      } else if (!(fn.externalDecl && fn.externalDecl.includes('"builtin"'))) {
        (fn as any).isNestedMember = true;
        (fn as any).symId = cc.id;
        if (flattener.calledFunctionSymIds.has(cc.id)) {
          (fn as any).wasCalled = true;
        }
        dae.addFunction(qualifiedName, fn);
        dae.addFunction(cc.name, fn);
      }
    }
  }

  // 2. Short class specifiers or base class redeclarations on rootClassId
  const rootMod = db.query<any>("effectiveModification", rootClassId);
  if (rootMod?.args) {
    for (const arg of rootMod.args) {
      if (arg.isRedeclaration && arg.redeclaredTypeSpecifier) {
        const target = db.byName(arg.redeclaredTypeSpecifier).find((e) => e.kind === "Class");
        if (target && isFunctionSym(db, target)) {
          const qualifiedName = `${dae.name}.${arg.name}`;
          const fn = flattener.flattenFunction(target.id, qualifiedName, arg.nestedArgs, dae);
          if (fn.diagnostics.some((d: any) => d.severity === "error")) {
            for (const d of fn.diagnostics) {
              if (!dae.diagnostics.some((existing) => existing.message === d.message)) {
                (d as any).fromFunction = true;
                dae.diagnostics.push(d);
              }
            }
            flattener.failedFunctionIds.add(target.id);
          } else {
            (fn as any).symId = target.id;
            dae.addFunction(qualifiedName, fn);
            dae.addFunction(arg.name, fn);
          }
        }
      }
    }
  }

  const addFunctionsFromBase = (base: SymbolEntry) => {
    const baseFuncs = db.childrenOf(base.id).filter((c) => c.kind === "Class" && isFunctionSym(db, c));
    for (const bf of baseFuncs) {
      const matchingRedecl = rootMod?.args?.find((a: any) => a.isRedeclaration && a.name === bf.name);
      if (!matchingRedecl) {
        const qualifiedName = `${dae.name}.${bf.name}`;
        if (!dae.functions.has(qualifiedName)) {
          const fn = flattener.flattenFunction(bf.id, qualifiedName, undefined, dae);
          if (fn.diagnostics.some((d: any) => d.severity === "error")) {
            for (const d of fn.diagnostics) {
              if (!dae.diagnostics.some((existing) => existing.message === d.message)) {
                (d as any).fromFunction = true;
                dae.diagnostics.push(d);
              }
            }
            flattener.failedFunctionIds.add(bf.id);
          } else {
            (fn as any).symId = bf.id;
            dae.addFunction(qualifiedName, fn);
            dae.addFunction(bf.name, fn);
          }
        }
      }
    }
  };

  const collectBaseFunctions = (classId: SymbolId, visited: Set<SymbolId> = new Set()) => {
    if (visited.has(classId)) return;
    visited.add(classId);

    const directBase = db.query<SymbolEntry | null>("resolvedBaseClass", classId);
    if (directBase) {
      addFunctionsFromBase(directBase);
      collectBaseFunctions(directBase.id, visited);
    }

    const extendsChildren = db.childrenOf(classId).filter((c) => c.kind === "Extends");
    for (const ext of extendsChildren) {
      const base = db.query<SymbolEntry | null>("resolvedBaseClass", ext.id);
      if (base) {
        addFunctionsFromBase(base);
        collectBaseFunctions(base.id, visited);
      } else {
        const byNameBase = db.byName(ext.name).find((e) => e.kind === "Class");
        if (byNameBase) {
          addFunctionsFromBase(byNameBase);
          collectBaseFunctions(byNameBase.id, visited);
        }
      }
    }
  };

  collectBaseFunctions(rootClassId);

  // 3. Top-level functions in the same file that are referenced in rootClassId
  if (rootSym.resourceId && !isScopeEncapsulated(db, rootClassId)) {
    const fileClasses = (db.childrenOf(null) ?? []).filter(
      (s: any) => s.resourceId === rootSym.resourceId && s.kind === "Class" && s.id !== rootClassId,
    );
    const rootCst = db.cstNode(rootClassId) as any;
    const rootText = rootCst?.text ?? "";
    for (const fc of fileClasses) {
      if (isFunctionSym(db, fc)) {
        const isShortFuncTarget = new RegExp(`\\bfunction\\s+\\w+\\s*=\\s*${escapeRegExp(fc.name)}\\b`).test(rootText);
        const isCalled = new RegExp(`\\b${escapeRegExp(fc.name)}\\s*\\(`).test(rootText);
        if (isCalled && !isShortFuncTarget) {
          const fn = flattener.flattenFunction(fc.id, fc.name, undefined, dae);
          if (fn.diagnostics.some((d: any) => d.severity === "error")) {
            for (const d of fn.diagnostics) {
              if (!dae.diagnostics.some((existing) => existing.message === d.message)) {
                (d as any).fromFunction = true;
                dae.diagnostics.push(d);
              }
            }
            flattener.failedFunctionIds.add(fc.id);
          } else if (!(fn.externalDecl && fn.externalDecl.includes('"builtin"'))) {
            dae.addFunction(fc.name, fn);
          }
        }
      } else {
        const childFuncs = (db.childrenOf(fc.id) ?? []).filter((c: any) => c.kind === "Class" && isFunctionSym(db, c));
        for (const cf of childFuncs) {
          const qualName = `${fc.name}.${cf.name}`;
          const isQualCalled = new RegExp(`\\b${escapeRegExp(qualName)}\\s*\\(`).test(rootText);
          if (isQualCalled && !dae.functions.has(qualName)) {
            const fn = flattener.flattenFunction(cf.id, qualName, undefined, dae);
            if (
              !fn.diagnostics.some((d: any) => d.severity === "error") &&
              !(fn.externalDecl && fn.externalDecl.includes('"builtin"'))
            ) {
              (fn as any).wasCalled = true;
              dae.addFunction(qualName, fn);
            }
          }
        }
      }
    }
  }
}

export function generateExternalObjectFunctions(flattener: any, dae: DAEBuilder): void {
  const db: QueryDB = flattener.db;
  for (const extObjSymId of flattener.usedExternalObjects) {
    const extObjQualName = getSymbolQualifiedName(db, extObjSymId);
    const children = db.childrenOf(extObjSymId);
    for (const child of children) {
      if (child.kind === "Class" && (child.name === "constructor" || child.name === "destructor")) {
        const fnQualName = `${extObjQualName}.${child.name}`;
        if (!dae.functions.has(fnQualName)) {
          const fn = flattener.flattenFunction(child.id, fnQualName, undefined, dae);
          fn.isImpure = true;
          foldArenaConstants(fn, db, child.id, true);
          dae.addFunction(fnQualName, fn);
        }
      }
    }
  }
}

export function propagateImpureFunctions(dae: DAEBuilder): void {
  for (const fn of dae.functions.values()) {
    for (let i = 0; i < fn.varCount; i++) {
      const ct = fn.getVarCustomType(i);
      const isExtObjType = Boolean(
        ct &&
        (ct.includes("ExternalObject") || dae.getFunction(`${ct}.constructor`) || dae.getFunction(`${ct}.destructor`)),
      );
      if (isExtObjType) {
        fn.isImpure = true;
      }
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const fn of dae.functions.values()) {
      for (let i = 0; i < fn.exprCount; i++) {
        if (fn.getExprKind(i) === ExprKind.Call) {
          const calledName = fn.interner.resolve(fn.getExprData1(i));
          if (calledName) {
            const targetFn =
              dae.getFunction(calledName) ??
              (calledName.includes(".") ? dae.getFunction(calledName.split(".").pop()!) : undefined);
            if (targetFn?.isImpure && !fn.isImpure) {
              fn.isImpure = true;
              changed = true;
            }
            if ((targetFn as any)?.isExplicitImpure && !(fn as any).isExplicitImpure) {
              (fn as any).isExplicitImpure = true;
              changed = true;
            }
          }
        }
      }
    }
  }
}
