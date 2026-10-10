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
import { escapeRegExp, getSymbolQualifiedName } from "../expressions/index.js";
import { getClassDiagRange } from "../support/range-utils.js";
import type { ComponentInstanceData } from "../types.js";

export function isFunctionSym(db: QueryDB, sym: any): boolean {
  if (!sym) return false;
  const meta = (sym.metadata as any) || {};
  const rawKind = String(meta.classKind ?? meta.classPrefixes ?? "");
  const cleanKind = rawKind.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
  const words = cleanKind.split(/\s+/).filter(Boolean);
  if (words.includes("function")) return true;
  const cst = db.cstNode(sym.id) as any;
  if (cst) {
    for (const child of cst.children || []) {
      if (child.type === "class_prefixes") {
        const childText = (child.text ?? "").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
        const childWords = childText.split(/\s+/).filter(Boolean);
        if (childWords.includes("function")) return true;
      }
    }
    const text = (cst.text?.trim() ?? "").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
    if (/^(?:(?:encapsulated|partial|replaceable|pure|impure)\s+)*function\b/.test(text)) return true;
  }
  return false;
}

export function generateRecordConstructorFor(
  flattener: any,
  sym: any,
  dae: DAEBuilder,
  rootClassId?: SymbolId,
): DAEBuilder | null {
  if (!sym) return null;
  const db: QueryDB = flattener.db;
  const qualName = getSymbolQualifiedName(db, sym.id);
  const fnName =
    rootClassId && sym.parentId === rootClassId && dae.name
      ? dae.name.includes(".") || !qualName.includes(".")
        ? `${dae.name}.${sym.name}`
        : qualName
      : qualName || sym.name;
  const existing =
    dae.getFunction(fnName) ?? dae.getFunction(sym.name) ?? (qualName ? dae.getFunction(qualName) : undefined);
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
  const redeclArgs = symMod?.args?.filter((a: any) => a.isRedeclaration) ?? [];
  const redeclaredCompNames = new Set(redeclArgs.map((a: any) => a.name));

  if (
    comps.some((c) => {
      const ci = db.query<ComponentInstanceData>("componentInstance", c.id);
      return ci?.isReplaceable && !redeclaredCompNames.has(c.name);
    })
  ) {
    return null;
  }

  for (const comp of comps) {
    if (comp && comp.kind === "Component") {
      const compInst = db.query<ComponentInstanceData>("componentInstance", comp.id);
      const cMeta = (comp.metadata as any) || {};
      const redeclForComp = redeclArgs.find((a: any) => a.name === comp.name);
      let typeSpec = redeclForComp?.redeclaredTypeSpecifier ?? compInst?.typeSpecifier ?? cMeta.typeSpecifier;
      let compTargetId: SymbolId | null = null;
      if (typeSpec) {
        const simple = typeSpec.split(".").pop()!;
        const targets = db.byName(simple);
        const found = targets.find((t) => t.kind === "Class" || (t.metadata as any)?.classKind === "type");
        if (found) compTargetId = found.id;
      }

      const compTypeMods: any[] = [];
      if (compTargetId && flattener.isClassType(compTargetId)) {
        let currTypeId: SymbolId | null = compTargetId;
        while (currTypeId) {
          const mod = db.query<any>("effectiveModification", currTypeId);
          if (mod?.args) compTypeMods.unshift(...mod.args);
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
      if (typeSpec === "Integer" || cMeta.varType === VarType.Integer) vType = VarType.Integer;
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
      if (isCompProt) {
        fn.setVarProtected(varIdx, true);
      }
      if (typeSpec && !["Real", "Integer", "Boolean", "String"].includes(typeSpec)) {
        fn.setVarCustomType(varIdx, typeSpec);
      }
      if (compInst?.arrayDimensions && compInst.arrayDimensions.length > 0) {
        fn.setVarShape(varIdx, compInst.arrayDimensions);
      }
      for (const attr of compTypeMods) {
        if (attr.value) {
          const val = attr.value;
          let exprId: number | null = null;
          if (val.kind === "literal") {
            if (typeof val.value === "number") exprId = fn.addRealLiteral(val.value);
            else if (typeof val.value === "string") exprId = fn.addStringLiteral(val.value);
          } else if (val.text) {
            const t = val.text.trim();
            if (t.startsWith('"') && t.endsWith('"')) {
              exprId = fn.addStringLiteral(t.slice(1, -1));
            } else {
              const num = Number(t);
              if (!isNaN(num)) exprId = fn.addRealLiteral(num);
            }
          }
          if (exprId !== null) {
            fn.setVarAttr(varIdx, attr.name, exprId);
          }
        }
      }
      const bText = compInst?.modification?.bindingExpression?.text?.trim();
      if (bText) {
        const num = Number(bText);
        if (!isNaN(num)) {
          const exprId = vType === VarType.Integer ? fn.addIntLiteral(Math.round(num)) : fn.addRealLiteral(num);
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
          const modChild = (compCst as any)?.children?.find((c: any) => c.type === "modification");
          const exprCst = findBindingExprNode(modChild ?? compCst);
          if (exprCst) {
            const exprId = flattener.lowerExpr(exprCst, fn, "");
            if (exprId >= 0) fn.setVarExpression(varIdx, exprId);
          }
        }
      }
    }
  }
  const resIdx = fn.addVariable("res", VarType.Real, Variability.Continuous, Causality.Output);
  fn.setVarCustomType(resIdx, sym.name);
  dae.addFunction(fnName, fn);
  if (sym.name && sym.name !== fnName) dae.addFunction(sym.name, fn);
  if (qualName && qualName !== fnName && qualName !== sym.name) dae.addFunction(qualName, fn);

  let rootDae: any = (flattener as any)?.currentRootDae ?? dae;
  while (rootDae.parentDae) rootDae = rootDae.parentDae;
  rootDae.addFunction(fnName, fn);
  if (sym.name && sym.name !== fnName) rootDae.addFunction(sym.name, fn);
  if (qualName && qualName !== fnName && qualName !== sym.name) rootDae.addFunction(qualName, fn);

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
  let fileSymbols: any[] = [];
  if (rootSym?.resourceId) {
    fileSymbols = flattener.getFileSymbols(rootSym.resourceId);
    const fileClasses = fileSymbols.filter((s: any) => s.kind === "Class" && s.id !== rootClassId);
    for (const fc of fileClasses) {
      if (!candidates.some((c) => c.id === fc.id)) candidates.push(fc);
    }
  }

  const isRecordSym = (sym: any): boolean => {
    if (sym.id === rootClassId) return false;
    return flattener.isRecordSym(sym);
  };

  const usedRecordNames = new Set<string>();
  if (flattener.usedRecordNames) {
    for (const name of flattener.usedRecordNames) {
      usedRecordNames.add(name);
      if (name.includes(".")) usedRecordNames.add(name.split(".").pop()!);
    }
  }
  if (flattener.usedRecordSymIds) {
    for (const sid of flattener.usedRecordSymIds) {
      const s = db.symbol(sid);
      if (s) {
        if (s.name) usedRecordNames.add(s.name);
        const q = getSymbolQualifiedName(db, s.id);
        if (q) usedRecordNames.add(q);
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
    for (let i = 0; i < fn.varCount; i++) {
      const ct = fn.getVarCustomType(i);
      if (ct) {
        usedRecordNames.add(ct);
        if (ct.includes(".")) usedRecordNames.add(ct.split(".").pop()!);
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

  const isRecordUsed = (sym: any): boolean => {
    if (!sym || !sym.name) return false;
    const name = sym.name;
    const qName = getSymbolQualifiedName(db, sym.id);
    return usedRecordNames.has(name) || (Boolean(qName) && usedRecordNames.has(qName!));
  };

  for (const sym of candidates) {
    if (isRecordSym(sym) && isRecordUsed(sym)) {
      const fn = flattener.generateRecordConstructorFor(sym, dae, rootClassId);
      if (fn) {
        const qualName = getSymbolQualifiedName(db, sym.id);
        const baseName = sym.name;
        if (flattener.calledFunctionSignatures && flattener.calledFunctionSignatures.size > 0) {
          for (const [callName, sigs] of flattener.calledFunctionSignatures.entries()) {
            if (
              callName === baseName ||
              callName === qualName ||
              (dae.name && callName === `${dae.name}.${baseName}`)
            ) {
              for (const sig of sigs) {
                const specFnName = `${callName}$${sig.types.join("$")}`;
                if (!dae.functions.has(specFnName)) {
                  const specFn = new DAEBuilder(dae.interner, specFnName, "");
                  specFn.classKind = "function";
                  specFn.description = `Specialized record constructor for ${specFnName}`;
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
                    const specVarIdx = specFn.addVariable(vName, vType, Variability.Continuous, vCausality);
                    if (vProt) specFn.setVarProtected(specVarIdx, true);
                    if (vCustom) specFn.setVarCustomType(specVarIdx, vCustom);
                    if (vShape.length > 0) specFn.setVarShape(specVarIdx, vShape);
                    if (vExpr >= 0) {
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
                  specFn.setVarCustomType(specResIdx, specFnName);
                  dae.addFunction(specFnName, specFn);
                }
              }
            }
          }
        }
      }
      if (flattener.isOperatorRecordSym(sym)) {
        const ctors = db.query<any[]>("operatorConstructors", sym.id);
        if (ctors && ctors.length > 0) {
          for (const ctor of ctors) {
            if (!dae.functions.has(ctor.qualifiedName)) {
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
  (fn as any).isBeingFlattened = true;
  fn.extensionMetadata.isOldFrontend = Boolean(
    parentDae?.extensionMetadata?.isOldFrontend ?? (flattener.options as any)?.isOldFrontend,
  );

  const prevImports = flattener.currentImports;
  try {
    const parts = cleanFnName.split(".");
    const baseName = parts[parts.length - 1];

    if (parentDae) {
      parentDae.addFunction(cleanFnName, fn);
      parentDae.addFunction(fnName, fn);
      if (baseName) parentDae.addFunction(baseName, fn);
    }
    fn.addFunction(cleanFnName, fn);
    fn.addFunction(fnName, fn);
    if (baseName) fn.addFunction(baseName, fn);

    const fnImports = flattener.collectClassImports(fnSymId);
    flattener.currentImports = new Map([...flattener.currentImports, ...fnImports]);

    const cst = db.cstNode(fnSymId) as any;
    if (cst?.text && /\b__OpenModelica_EarlyInline\s*=\s*true\b/.test(cst.text)) {
      (fn as any).isEarlyInline = true;
    }

    let pureDeclared = false;
    let impureDeclared = false;
    if (cst) {
      for (const child of cst.children || []) {
        if (child.type === "class_prefixes") {
          const pfx = (child.text ?? "").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ").trim();
          const words = pfx.split(/\s+/).filter(Boolean);
          if (words.includes("pure")) pureDeclared = true;
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
    let targetSymId = fnSymId;
    const combinedMods = [...(modifiers ?? [])];

    if (shortSpec) {
      const typeSpecNode =
        Cst.ShortClassSpecifier.typeSpecifier(shortSpec) ??
        shortSpec.children?.find((c: any) => c.type === "type_specifier");
      const baseName = typeSpecNode?.text?.trim() ?? "";
      if (baseName) {
        const resolver = db.query<any>("resolveName", fnSymId) ?? db.query<any>("resolveSimpleName", fnSymId);
        let baseSym = resolver ? resolver(baseName) : null;
        if (!baseSym) {
          baseSym = db.byName(baseName).find((e: any) => e.kind === "Class");
        }
        if (baseSym) {
          targetSymId = baseSym.id;
          if (!fn.description) {
            const targetCst = db.cstNode(baseSym.id) as any;
            const targetDesc = findDesc(targetCst);
            if (targetDesc) fn.description = targetDesc;
          }
        }
      }
      const modNode =
        Cst.ShortClassSpecifier.classModification(shortSpec) ??
        shortSpec.children?.find((c: any) => c.type === "class_modification");
      if (modNode) {
        const parsed = db.query<any>("effectiveModification", fnSymId);
        if (parsed?.args) {
          combinedMods.unshift(...parsed.args);
        }
      } else {
        const mathMatch = baseName.match(
          /^(?:Modelica\.Math\.)?(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|exp|log|log10|sqrt)$/,
        );
        if (mathMatch) {
          (fn as any).aliasTo = mathMatch[1];
        }
      }
    }

    const elements = db.query<SymbolId[]>("instantiate", targetSymId);
    if (elements && elements.length > 0) {
      flattener.instantiateElements(elements, "", fn, { args: combinedMods });
    } else {
      const children = db.childrenOf(targetSymId);
      const childIds: SymbolId[] = [];
      for (const ch of children) {
        if (ch.kind === "Component") childIds.push(ch.id);
      }
      if (childIds.length > 0) {
        flattener.instantiateElements(childIds, "", fn, { args: combinedMods });
      }
    }

    flattener.generateRecordConstructors(targetSymId, fn);

    const childFuncs = db.childrenOf(targetSymId).filter((c) => c.kind === "Class" && isFunctionSym(db, c));
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
    if (ownExtClause) {
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

    if (ownExtClause && inheritedExtClause) {
      const extCst = db.cstNode(inheritedExtClause.id) as any;
      const notifRange = extCst
        ? {
            startPosition: extCst.startPosition,
            endPosition: extCst.endPosition,
            startByte: extCst.startIndex ?? extCst.startByte,
            endByte: extCst.endIndex ?? extCst.endByte,
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
            startByte: cst.startIndex ?? cst.startByte,
            endByte: cst.endIndex ?? cst.endByte,
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

      const hasCall =
        extClause.children?.some((c: any) => c.type === "external_function_call") || /\(/.test(extClause.text ?? "");
      let extText = extClause.text?.trim() ?? "";
      extText = extText.replace(/\s*annotation\s*\([\s\S]*?\)\s*;?$/, "").trim();
      if (extText.endsWith(";")) extText = extText.slice(0, -1).trim();

      const langMatch = extText.match(/^external\s+(?:"[^"]+"|\bbuiltin\b)/);
      if (!langMatch) {
        extText = extText.replace(/^external\b/, 'external "C"');
      }

      const langRawMatch = extClause.text?.match(/^external\s+("(?:[^"\\]|\\.)*")/);
      if (langRawMatch) {
        const rawLang = langRawMatch[1];
        const lang = rawLang.startsWith('"') ? rawLang.slice(1, -1) : rawLang;
        if (lang !== "C" && lang !== "FORTRAN 77" && lang !== "Fortran 77" && lang !== "builtin" && lang !== "none") {
          const bCst = db.cstNode(targetSymId) as any;
          const rangeObj = getClassDiagRange(bCst);
          fn.diagnostics.push({
            severity: "error",
            code: ModelicaErrorCode.EXTERNAL_INVALID_LANGUAGE.code,
            message: ModelicaErrorCode.EXTERNAL_INVALID_LANGUAGE.message(lang),
            range: rangeObj,
          });
        }
      }

      // Check if external function return (explicit LHS) has array type
      const extLhsMatch = extText.match(/^external(?:\s+"[^"]+"|\s+\b\w+\b)?\s+([a-zA-Z_]\w*)\s*=/);
      const lhsVarName = extLhsMatch ? extLhsMatch[1] : null;
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

      // External function call arguments validation
      const callArgsMatch = extText.match(/\((.*)\)\s*$/);
      if (callArgsMatch) {
        const rawArgsStr = callArgsMatch[1].trim();
        if (rawArgsStr) {
          const argsList: string[] = [];
          let depth = 0,
            current = "";
          for (let i = 0; i < rawArgsStr.length; i++) {
            const ch = rawArgsStr[i];
            if (ch === "(" || ch === "{" || ch === "[") depth++;
            else if (ch === ")" || ch === "}" || ch === "]") depth--;
            if (ch === "," && depth === 0) {
              argsList.push(current.trim());
              current = "";
            } else {
              current += ch;
            }
          }
          if (current.trim()) argsList.push(current.trim());

          for (const a of argsList) {
            if (a.startsWith("{") && a.endsWith("}")) {
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
              const dimExpr = sizeMatch[2].trim();
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
        }
      }

      if (!hasCall) {
        // Synthesize default external call: [output =] name(inputs) per MLS §12.9.1
        const inputs: string[] = [];
        const outputs: string[] = [];
        for (let i = 0; i < fn.varCount; i++) {
          if (fn.isVarRemoved(i)) continue;
          const causality = fn.getVarCausality(i);
          const varName = fn.getVarName(i);
          if (causality === Causality.Input) {
            inputs.push(varName);
          } else if (causality === Causality.Output) {
            outputs.push(varName);
          }
        }
        let defaultCall: string;
        if (outputs.length === 1) {
          defaultCall = `${outputs[0]} = ${baseName}(${inputs.join(", ")})`;
        } else {
          const allArgs = [...inputs, ...outputs];
          defaultCall = `${baseName}(${allArgs.join(", ")})`;
        }
        extText = `${extText} ${defaultCall}`.trim();
      }

      if (!extText.endsWith(";")) extText += ";";
      fn.externalDecl = extText;
    }

    flattener.extractClassEquations(targetSymId, "", fn);
    foldArenaConstants(fn, db, targetSymId, true);

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
                        startByte: bCst.startIndex ?? bCst.startByte,
                        endByte: bCst.endIndex ?? bCst.endByte,
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
            startByte: bCst.startIndex ?? bCst.startByte,
            endByte: bCst.endIndex ?? bCst.endByte,
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

    if (fn.diagnostics.some((d: any) => d.severity === "error")) {
      const cleanupFrom = (targetDae: any) => {
        if (!targetDae) return;
        for (const k of [cleanFnName, fnName, baseName]) {
          if (!k) continue;
          targetDae.functions.delete(k);
          const id = targetDae.interner?.lookup(k);
          if (id !== undefined) targetDae.functions.delete(id);
        }
      };
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
    } else if (fn.functions && fn.functions.size > 0) {
      let rootDae: any = (flattener as any)?.currentRootDae ?? parentDae;
      while (rootDae?.parentDae) rootDae = rootDae.parentDae;
      if (rootDae) {
        for (const [nestedName, nestedFn] of fn.functions.entries()) {
          rootDae.addFunction(nestedName, nestedFn);
        }
      }
      if (parentDae) {
        for (const [nestedName, nestedFn] of fn.functions.entries()) {
          parentDae.addFunction(nestedName, nestedFn);
        }
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
      if (fn.externalDecl && fn.externalDecl.includes('"builtin"')) {
        continue;
      }
      if (fn.diagnostics.some((d: any) => d.severity === "error")) {
        for (const d of fn.diagnostics) {
          if (!dae.diagnostics.some((existing) => existing.message === d.message)) {
            (d as any).fromFunction = true;
            dae.diagnostics.push(d);
          }
        }
        flattener.failedFunctionIds.add(cc.id);
      } else {
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
          } else {
            dae.addFunction(fc.name, fn);
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
      if (ct && (ct.includes("SerialPort") || ct.includes("SerialPackager") || ct.includes("ExternalObject"))) {
        fn.isImpure = true;
      }
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const fn of dae.functions.values()) {
      if (fn.isImpure) continue;
      for (let i = 0; i < fn.exprCount; i++) {
        if (fn.getExprKind(i) === ExprKind.Call) {
          const calledName = fn.interner.resolve(fn.getExprData1(i));
          if (calledName) {
            const targetFn =
              dae.getFunction(calledName) ??
              (calledName.includes(".") ? dae.getFunction(calledName.split(".").pop()!) : undefined);
            if (targetFn?.isImpure) {
              fn.isImpure = true;
              changed = true;
              break;
            }
          }
        }
      }
    }
  }
}
