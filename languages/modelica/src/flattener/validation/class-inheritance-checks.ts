// SPDX-License-Identifier: AGPL-3.0-or-later

import { type SymbolEntry, type SymbolId } from "@modelscript/runtime";
import { type SyntaxNode } from "../../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../../errors.js";
import {
  collectClassComponents,
  collectClassNestedClasses,
  collectModifiersInNode,
  findAncestor,
  getClassSpecialization,
  getHeaderText,
  hasUnresolvedBaseOrReplaceableMatch,
  isClassPartial,
  isShortClassPrimitiveAlias,
  resolveClassSym,
  resolveShortClassBase,
} from "./cst-helpers.js";
import { cstOf, pushNotification } from "./diagnostics.js";
import { PRIMITIVE_BUILTIN_TYPES, type ClassValidationContext } from "./types.js";

export function validateClassAndInheritance(ctx: ClassValidationContext): void {
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
    invalidOrConflictingImports,
    pushErrorOnce,
    recordRedeclare,
  } = ctx;

  // 2. Builtin extension with extra elements (e.g., inst4, usertype6, ClassExtendsBuiltin1/2)
  if (!isOldFrontend) {
    for (const child of children) {
      if (child.kind === "Extends") {
        let isBuiltinExt = PRIMITIVE_BUILTIN_TYPES.has(child.name);
        if (!isBuiltinExt) {
          let baseSym = resolveClassSym(db, sym.parentId ?? classId, child.name);
          if ((!baseSym || baseSym.id === classId) && sym.parentId !== null) {
            const inhMap = db.query<Record<string, SymbolId>>("inheritedSymbolsMap", sym.parentId);
            const inhId = inhMap?.[child.name];
            if (inhId !== undefined && inhId !== classId) {
              baseSym = db.symbol(inhId) ?? null;
            }
          }
          if (baseSym && baseSym.id !== classId && isShortClassPrimitiveAlias(db, baseSym)) {
            isBuiltinExt = true;
          }
        }
        if (isBuiltinExt) {
          const hasOtherElems = children.some(
            (c) => c.kind === "Component" || (c.kind === "Extends" && c.id !== child.id),
          );
          if (hasOtherElems) {
            pushErrorOnce(
              4000,
              "builtin-extends-elements",
              `A class extending from builtin type ${child.name} may not have other elements.`,
              classCst,
            );
          }
        }
      }
    }
  }

  // 2b. Unresolved Modelica.* base class (TypeTest) & unresolved Modelica.* component types in referenced classes (Oscillator, CGraphBug, ConnectForEquations)
  if (isTopLevelRoot && !classPartial) {
    if (!isOldFrontend) {
      for (const ch of children) {
        if (ch.kind === "Extends" && ch.name.startsWith("Modelica.") && !resolveClassSym(db, classId, ch.name)) {
          const extCst = cstOf(db, ch.id);
          pushErrorOnce(
            ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.code,
            ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.rule,
            `Base class ${ch.name} not found in scope ${sym.name}.`,
            extCst ?? classCst,
          );
          return;
        }
        if (ch.kind === "Class") {
          const chCst = cstOf(db, ch.id);
          const shortM = chCst?.text
            ?.trim()
            .match(
              /^(?:(?:encapsulated|partial|replaceable|final)\s+)*(?:type|model|block|record|class|connector|package)\s+[A-Za-z_]\w*\s*=\s*(Modelica\.[A-Za-z_][\w.]*)/,
            );
          if (shortM && !resolveClassSym(db, classId, shortM[1]!)) {
            pushErrorOnce(
              ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.code,
              ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.rule,
              `Base class ${shortM[1]!} not found in scope ${sym.name}.`,
              chCst ?? classCst,
            );
            return;
          }
        }
      }
    } else {
      const seenCheck = new Set<SymbolId>();
      const checkMissingModelicaComp = (cid: SymbolId): boolean => {
        if (seenCheck.has(cid)) return false;
        seenCheck.add(cid);
        const cSym = db.symbol(cid);
        if (!cSym) return false;
        const cPathParts: string[] = [cSym.name];
        let pId = cSym.parentId;
        while (pId != null) {
          const ps = db.symbol(pId);
          if (!ps || (ps.kind !== "Class" && ps.kind !== "Package")) break;
          cPathParts.unshift(ps.name);
          pId = ps.parentId;
        }
        const cScopePath = cPathParts.join(".");
        for (const ch of db.childrenOf(cid)) {
          if (ch.kind === "Extends" && ch.name && !PRIMITIVE_BUILTIN_TYPES.has(ch.name)) {
            const bSym = resolveClassSym(db, cid, ch.name);
            if (bSym && checkMissingModelicaComp(bSym.id)) return true;
          }
        }
        for (const ch of db.childrenOf(cid)) {
          if (ch.kind !== "Component") continue;
          const chCst = cstOf(db, ch.id);
          const chClause = chCst ? (findAncestor(chCst, "component_clause") ?? chCst) : null;
          if (!chClause) continue;
          const tm = chClause.text
            .trim()
            .match(
              /^(?:(?:replaceable|redeclare|inner|outer|final|flow|stream|discrete|parameter|constant|input|output)\s+)*(Modelica\.[A-Za-z_][\w.]*)/,
            );
          if (tm && !resolveClassSym(db, cid, tm[1]!)) {
            pushErrorOnce(
              ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.code,
              ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.rule,
              `Class ${tm[1]!} not found in scope ${cScopePath}.`,
              chClause,
            );
            return true;
          }
          const compInf = comps.get(ch.name) ?? collectClassComponents(db, cid).get(ch.name);
          if (compInf && compInf.typeName && !PRIMITIVE_BUILTIN_TYPES.has(compInf.typeName)) {
            const tSym = resolveClassSym(db, cid, compInf.typeName);
            if (tSym && checkMissingModelicaComp(tSym.id)) return true;
          }
        }
        return false;
      };
      if (checkMissingModelicaComp(classId)) return;
      // PackageParameter: constant Integer a = n.i; where n is a class and i is a parameter (not constant)
      for (const [, cInfo] of comps) {
        if (cInfo.variability !== "constant") continue;
        const cClause = cInfo.cst ? (findAncestor(cInfo.cst, "component_clause") ?? cInfo.cst) : null;
        const cTxt = cClause?.text?.trim() ?? "";
        const bm = cTxt.match(/=\s*([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*;?$/);
        if (!bm || comps.has(bm[1]!)) continue;
        const clsName = bm[1]!;
        const memName = bm[2]!;
        const clsSym = resolveClassSym(db, cInfo.ownerClassId, clsName) ?? resolveClassSym(db, classId, clsName);
        if (!clsSym) continue;
        const memInfo = collectClassComponents(db, clsSym.id).get(memName);
        if (memInfo && memInfo.variability !== "constant") {
          pushErrorOnce(
            2002,
            "package-var-not-constant",
            `Variable ${clsName}.${memName} in package ${sym.name}.${clsName} is not constant.`,
            null,
          );
          pushErrorOnce(
            2002,
            "variable-not-found-scope",
            `Variable ${clsName}.${memName} not found in scope ${sym.name}.`,
            cClause,
          );
          return;
        }
      }
    }
  }

  // 3. Invalid stream connector (must have exactly one flow variable)
  if (spec === "connector" && !classPartial) {
    let hasStream = false;
    let flowCount = 0;
    for (const info of comps.values()) {
      if (info.isStream) hasStream = true;
      if (info.isFlow) flowCount++;
    }
    if (hasStream && flowCount !== 1) {
      pushErrorOnce(
        dae.varCount >= 0 ? 4000 : 4000,
        "invalid-stream-connector",
        `Invalid stream connector ${isOldFrontend ? `.${sym.name}` : sym.name}: A stream connector must have exactly one flow variable, this connector has ${flowCount} flow ${flowCount === 1 ? "variable" : "variables"}.`,
        classCst,
      );
    }
  }

  if (!isOldFrontend && classCst) {
    const seenQualImports = new Map<string, SyntaxNode>();
    const rootScopeId = db.symbol(classId)?.parentId ?? null;
    const isTopLevelTarget = (p: string): boolean => {
      const seg0 = p.split(".")[0]!;
      // Must exist at top scope (not exclusively as a local nested class inside classId)
      const topCandidates = [...db.childrenOf(null), ...(rootScopeId != null ? db.childrenOf(rootScopeId) : [])];
      const topFirst = topCandidates.find((s) => s.name === seg0);
      if (!topFirst) return false;
      const parts = p.split(".");
      let cur = topFirst;
      for (let i = 1; i < parts.length; i++) {
        const nxt = db.childrenOf(cur.id).find((c) => c.name === parts[i]!);
        if (!nxt) return false;
        cur = nxt;
      }
      return true;
    };
    for (const ch of children) {
      if (ch.kind === "Import") {
        const impCst = cstOf(db, ch.id);
        const impTxt = (impCst?.text ?? "").trim();
        const namedM = impTxt.match(/^import\s+([A-Za-z_]\w*)\s*=\s*([A-Za-z_][\w.]*)\s*;?$/);
        const qualM = !namedM ? impTxt.match(/^import\s+([A-Za-z_][\w.]*\.([A-Za-z_]\w*))\s*;?$/) : null;
        if (namedM) {
          const aliasName = namedM[1]!;
          const targetPath = namedM[2]!;
          const targetExists = (p: string): boolean => {
            if (isTopLevelTarget(p)) return true;
            if (resolveClassSym(db, classId, p)) return true;
            const dot = p.lastIndexOf(".");
            if (dot > 0) {
              const pkgSym = resolveClassSym(db, classId, p.slice(0, dot));
              const mem = p.slice(dot + 1);
              if (pkgSym && db.childrenOf(pkgSym.id).some((c) => c.name === mem)) return true;
            }
            return false;
          };
          if (!targetExists(targetPath)) {
            invalidOrConflictingImports.add(aliasName);
            pushErrorOnce(
              ModelicaErrorCode.CLASS_NOT_FOUND.code,
              ModelicaErrorCode.CLASS_NOT_FOUND.rule,
              `Import ${targetPath} not found in scope <top>.`,
              impCst,
            );
          }
          if (seenQualImports.has(aliasName)) {
            const nonImportTxt = classCst.text.replace(/^\s*import\b[^;]*;?/gm, "");
            if (new RegExp(`\\b${aliasName}\\b`).test(nonImportTxt)) {
              invalidOrConflictingImports.add(aliasName);
              const prevImp = seenQualImports.get(aliasName);
              if (prevImp) pushNotification(dae, prevImp);
              pushErrorOnce(
                2001,
                "import-conflict",
                `Qualified import name ${aliasName} already exists in this scope.`,
                impCst,
              );
            }
          } else {
            seenQualImports.set(aliasName, impCst!);
          }
        } else if (qualM) {
          const targetPath = qualM[1]!;
          const shortName = qualM[2]!;
          const seg0 = targetPath.split(".")[0]!;
          const isLocalOnlyPkg = db.childrenOf(classId).some((c) => c.name === seg0) && !isTopLevelTarget(targetPath);
          const dot = targetPath.lastIndexOf(".");
          const pkgSym = dot > 0 ? resolveClassSym(db, classId, targetPath.slice(0, dot)) : null;
          const isPkgComp = Boolean(pkgSym && db.childrenOf(pkgSym.id).some((c) => c.name === shortName));
          if (isLocalOnlyPkg || (!resolveClassSym(db, classId, targetPath) && !isPkgComp)) {
            invalidOrConflictingImports.add(shortName);
            pushErrorOnce(
              ModelicaErrorCode.CLASS_NOT_FOUND.code,
              ModelicaErrorCode.CLASS_NOT_FOUND.rule,
              `Import ${targetPath} not found in scope <top>.`,
              impCst,
            );
          }
          if (seenQualImports.has(shortName)) {
            invalidOrConflictingImports.add(shortName);
            pushErrorOnce(
              2001,
              "import-conflict",
              `Qualified import name ${shortName} already exists in this scope.`,
              impCst,
            );
          } else {
            seenQualImports.set(shortName, impCst!);
          }
        }
      }
    }
  }
  for (const child of children) {
    if (child.kind === "Class") {
      const childCst = cstOf(db, child.id);
      if (childCst) {
        if (!isOldFrontend) {
          const cTxt = childCst.text.trim();
          // RecursiveExtends3: short class A = A;
          const shortSelfM = cTxt.match(
            /^(?:(?:encapsulated|partial|replaceable|redeclare|inner|outer|final)\s+)*(?:type|model|class|block|record|connector|package)\s+([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\s*(?:\([^)]*\))?\s*;?$/,
          );
          if (shortSelfM && shortSelfM[1] === shortSelfM[2]) {
            pushErrorOnce(
              4001,
              "recursive-short-class",
              `Recursive short class definition of ${shortSelfM[1]!} in terms of ${shortSelfM[2]!}.`,
              childCst,
            );
          }
          // TypeMissingBaseType1: long `type T ... end T;` without extends clause
          const cSpec = getClassSpecialization(child, childCst);
          if (
            cSpec === "type" &&
            !cTxt.includes("=") &&
            !isClassPartial(child, childCst) &&
            !db.childrenOf(child.id).some((c) => c.kind === "Extends")
          ) {
            pushErrorOnce(4000, "type-missing-base", `Type '${child.name}' does not extend a basic type.`, childCst);
          }
        }
        const hdr = getHeaderText(childCst);
        const eqIdx = hdr.indexOf("=");
        if (/^\s*outer\b/.test(hdr) && eqIdx >= 0 && hdr.includes("(")) {
          const parenIdx = hdr.indexOf("(", eqIdx);
          if (parenIdx >= 0) {
            const modText = hdr.slice(parenIdx).replace(/;\s*$/, "").trim();
            pushErrorOnce(
              ModelicaErrorCode.OUTER_MODIFIER.code,
              ModelicaErrorCode.OUTER_MODIFIER.rule,
              ModelicaErrorCode.OUTER_MODIFIER.message(modText, child.name),
              childCst,
            );
          }
        }
        const elemParent = childCst.parent?.type === "element" ? childCst.parent : childCst;
        if (/^\s*redeclare\b/.test(elemParent.text ?? "")) {
          recordRedeclare(child.name, elemParent);
        }
      }
    } else if (child.kind === "Component") {
      const compCst = cstOf(db, child.id);
      const elemNode = findAncestor(compCst, "element", 5);
      if (elemNode && /^\s*redeclare\b/.test(elemNode.text ?? "")) {
        recordRedeclare(child.name, elemNode);
      }
    } else if (child.kind === "Extends") {
      const extCst = cstOf(db, child.id);
      if (extCst) {
        // Encapsulated3: encapsulated class cannot extend enclosing-scope class without import
        if (/^encapsulated\b/.test(classCst.text.trim()) && child.name && !child.name.startsWith(".")) {
          const firstSeg = child.name.split(".")[0]!;
          const isLocal = db.childrenOf(classId).some((c) => c.name === firstSeg);
          const hasImport = db.childrenOf(classId).some((c) => {
            if (c.kind !== "Import") return false;
            const it = cstOf(db, c.id)?.text?.trim() ?? "";
            return it.includes(".*") || new RegExp(`\\b${firstSeg}\\b`).test(it);
          });
          if (!isLocal && !hasImport && firstSeg !== sym.name && !PRIMITIVE_BUILTIN_TYPES.has(firstSeg)) {
            const pathParts: string[] = [sym.name];
            let pId = sym.parentId;
            while (pId != null) {
              const pSym = db.symbol(pId);
              if (!pSym || pSym.kind !== "Class") break;
              pathParts.unshift(pSym.name);
              pId = pSym.parentId;
            }
            pushErrorOnce(
              ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.code,
              ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.rule,
              `Base class ${child.name} not found in scope ${pathParts.join(".")}.`,
              extCst,
            );
            if (isOldFrontend) return;
          }
        }
        // Extends4: base class component type must resolve in base class scope, not derived class scope
        if (!isOldFrontend && child.name && !PRIMITIVE_BUILTIN_TYPES.has(child.name)) {
          const baseSym = resolveClassSym(db, classId, child.name);
          if (baseSym && baseSym.id !== classId) {
            const existsInLexicalScope = (scopeId: SymbolId, typeName: string): boolean => {
              const firstSeg = typeName.split(".")[0]!;
              let cur: SymbolId | null = scopeId;
              while (cur != null) {
                if (db.childrenOf(cur).some((c) => c.name === firstSeg)) return true;
                cur = db.symbol(cur)?.parentId ?? null;
              }
              return db.childrenOf(null).some((c) => c.name === firstSeg);
            };
            for (const [, bcInfo] of collectClassComponents(db, baseSym.id)) {
              if (
                bcInfo.typeName &&
                !PRIMITIVE_BUILTIN_TYPES.has(bcInfo.typeName) &&
                !existsInLexicalScope(baseSym.id, bcInfo.typeName) &&
                db.childrenOf(classId).some((c) => c.name === bcInfo.typeName.split(".")[0]!)
              ) {
                const bcClause = findAncestor(bcInfo.cst, "component_clause") ?? bcInfo.cst;
                pushErrorOnce(
                  ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.code,
                  ModelicaErrorCode.CLASS_NOT_FOUND_IN_SCOPE.rule,
                  `Class ${bcInfo.typeName} not found in scope ${baseSym.name}.`,
                  bcClause,
                );
              }
            }
          }
        }
        const modWrap = extCst.namedChildren.find(
          (c) => c.type === "class_or_inheritance_modification" || c.type === "class_modification",
        );
        const modNode =
          modWrap?.type === "class_modification"
            ? modWrap
            : (modWrap?.namedChildren.find((c) => c.type === "class_modification") ?? modWrap ?? null);
        if (modNode) {
          for (const m of collectModifiersInNode(modNode)) {
            if (m.isRedeclare && m.name) recordRedeclare(m.name, m.node);
          }
        }
      }
    }
  }

  // 3d. Cyclic conditional parameter bindings (CyclicBindingConditional)
  if (isOldFrontend && sym) {
    const condDeps = new Map<string, string>();
    for (const ch of children) {
      if (ch.kind !== "Component") continue;
      const chCst = cstOf(db, ch.id);
      const chClause = chCst ? (findAncestor(chCst, "component_clause") ?? chCst) : null;
      const chTxt = chClause?.text?.trim() ?? "";
      if (!/\b(?:parameter|constant)\b/.test(chTxt)) continue;
      const condM = chTxt.match(/\bif\s+([A-Za-z_]\w*)\s*;?$/);
      if (condM) condDeps.set(ch.name, condM[1]!);
    }
    if (condDeps.size >= 2) {
      const seenCycle = new Set<string>();
      for (const [k, dep] of condDeps) {
        if (condDeps.get(dep) === k && !seenCycle.has(k)) {
          seenCycle.add(k);
          seenCycle.add(dep);
          pushErrorOnce(
            4001,
            "cyclic-conditional-binding",
            `Cyclically dependent constants or parameters found in scope ${sym.name}: {${dep},${k}} (ignore with -d=ignoreCycles).`,
            null,
          );
          break;
        }
      }
    }
  }
}

export function checkClassModifiers(
  ctx: ClassValidationContext,
  targetSym: SymbolEntry,
  modNode: SyntaxNode,
  viaExtends: boolean,
): void {
  const { db, dae, classId, isOldFrontend, pushErrorOnce } = ctx;
  const targetComps = collectClassComponents(db, targetSym.id);
  const targetClasses = collectClassNestedClasses(db, targetSym.id);
  for (const m of collectModifiersInNode(modNode)) {
    const target = targetComps.get(m.name);
    const targetCls = targetClasses.get(m.name);

    if (m.isRedeclare && m.name) {
      if (!target && !targetCls) {
        if (!hasUnresolvedBaseOrReplaceableMatch(db, targetSym.id, m.name)) {
          pushErrorOnce(
            ModelicaErrorCode.MODIFIED_ELEMENT_NOT_FOUND.code,
            ModelicaErrorCode.MODIFIED_ELEMENT_NOT_FOUND.rule,
            ModelicaErrorCode.MODIFIED_ELEMENT_NOT_FOUND.message(m.name, targetSym.name),
            m.node,
          );
        }
        continue;
      }
      if (targetCls && !target && !m.isRedeclareClass) {
        pushNotification(dae, m.node);
        pushErrorOnce(
          ModelicaErrorCode.INVALID_REDECLARATION_CLASS_AS_COMPONENT.code,
          ModelicaErrorCode.INVALID_REDECLARATION_CLASS_AS_COMPONENT.rule,
          ModelicaErrorCode.INVALID_REDECLARATION_CLASS_AS_COMPONENT.message(m.name),
          cstOf(db, targetCls.sym.id) ?? m.node,
        );
        continue;
      }
      if (target && !targetCls && m.isRedeclareClass) {
        const targetClause = findAncestor(target.cst, "component_clause") ?? target.cst;
        pushNotification(dae, m.node);
        pushErrorOnce(
          ModelicaErrorCode.INVALID_REDECLARATION_COMPONENT_AS_CLASS.code,
          ModelicaErrorCode.INVALID_REDECLARATION_COMPONENT_AS_CLASS.rule,
          ModelicaErrorCode.INVALID_REDECLARATION_COMPONENT_AS_CLASS.message(m.name),
          targetClause ?? m.node,
        );
        continue;
      }
      // RedeclareEnum2 / RedeclareEnum4 / RedeclareEnum6: enumeration redeclaration subtype check
      if (targetCls && m.isRedeclareClass && !isOldFrontend) {
        const baseClsCst = cstOf(db, targetCls.sym.id);
        const baseClsTxt = baseClsCst?.text?.trim() ?? "";
        const baseEnumM = baseClsTxt.match(/\benumeration\s*\(([^)]*)\)/);
        if (baseEnumM) {
          const baseIsGeneric = baseEnumM[1]!.trim() === ":";
          const redeclTxt = m.node.text.trim();
          const rhsM = redeclTxt.match(/=\s*(.+)$/);
          const rhsStr = rhsM ? rhsM[1]!.trim().replace(/;$/, "").trim() : "";
          const rhsEnumM = rhsStr.match(/^enumeration\s*\(([^)]*)\)$/);
          if (!baseIsGeneric) {
            // Fixed enumeration(a) cannot be redeclared to a different enumeration
            const baseLits = baseEnumM[1]!
              .split(",")
              .map((s) => s.trim().split(/\s+/)[0])
              .join(",");
            const rhsLits = rhsEnumM
              ? rhsEnumM[1]!
                  .split(",")
                  .map((s) => s.trim().split(/\s+/)[0])
                  .join(",")
              : null;
            if (rhsLits !== baseLits) {
              pushNotification(dae, m.node);
              pushErrorOnce(
                4000,
                "redeclare-enum-subtype",
                m.text.includes("enumeration(")
                  ? `Redeclaration of enumeration '${m.name}' is not a subtype of the redeclared element (use enumeration(:) for a generic replaceable enumeration).`
                  : `Redeclaration of enumeration '${m.name}' is not a subtype of the redeclared element.`,
                baseClsCst ?? m.node,
              );
              continue;
            }
          } else {
            // Generic enumeration(:) can only be redeclared to an enumeration type
            let rhsIsEnum = Boolean(rhsEnumM);
            if (!rhsIsEnum && /^[A-Za-z_][\w.]*$/.test(rhsStr) && !PRIMITIVE_BUILTIN_TYPES.has(rhsStr)) {
              const rhsSym = resolveClassSym(db, classId, rhsStr);
              const rhsCstTxt = rhsSym ? (cstOf(db, rhsSym.id)?.text ?? "") : "";
              if (/\benumeration\s*\(/.test(rhsCstTxt)) rhsIsEnum = true;
            }
            if (!rhsIsEnum) {
              pushNotification(dae, m.node);
              pushErrorOnce(
                4000,
                "redeclare-enum-subtype",
                `Redeclaration of enumeration '${m.name}' is not a subtype of the redeclared element.`,
                baseClsCst ?? m.node,
              );
              continue;
            }
          }
        }
      }
    }

    if (!m.isRedeclare && m.isClassAssignEq && targetCls && !target) {
      pushErrorOnce(
        ModelicaErrorCode.MISSING_REDECLARE_KEYWORD.code,
        ModelicaErrorCode.MISSING_REDECLARE_KEYWORD.rule,
        ModelicaErrorCode.MISSING_REDECLARE_KEYWORD.message(m.name),
        m.node,
      );
      continue;
    }

    if (target) {
      const targetNode = findAncestor(target.cst, "component_clause") ?? target.cst;
      if (target.isFinal && !m.isRedeclare) {
        const parenIdx = m.text.indexOf("(");
        const eqIdx = m.text.indexOf("=");
        let eqPart: string;
        if (parenIdx >= 0 && (eqIdx < 0 || parenIdx < eqIdx)) {
          eqPart = m.text.slice(parenIdx).trim();
        } else if (eqIdx >= 0) {
          eqPart = `= ${m.text.slice(eqIdx + 1).trim()}`;
          if (isOldFrontend) eqPart = ` ${eqPart}`;
        } else {
          eqPart = m.text;
        }
        if (isOldFrontend) {
          pushNotification(dae, targetNode);
          pushErrorOnce(
            ModelicaErrorCode.FINAL_OVERRIDE.code,
            ModelicaErrorCode.FINAL_OVERRIDE.rule,
            ModelicaErrorCode.FINAL_OVERRIDE.message(m.name, eqPart),
            m.node,
          );
        } else {
          pushNotification(dae, m.node);
          pushErrorOnce(
            ModelicaErrorCode.FINAL_OVERRIDE.code,
            ModelicaErrorCode.FINAL_OVERRIDE.rule,
            ModelicaErrorCode.FINAL_OVERRIDE.message(m.name, eqPart),
            targetNode,
          );
        }
      }
      // DisturbedResistance1: parameter modified with time-varying expression (e.g. R = 1.0 + 0.1*sin(time))
      if (isOldFrontend && target.variability === "parameter" && !m.isRedeclare) {
        const eqIdx = m.text.indexOf("=");
        if (eqIdx >= 0) {
          const rhsStr = m.text.slice(eqIdx + 1).trim();
          if (/\btime\b/.test(rhsStr)) {
            const formattedRhs = rhsStr.replace(/\s*\*\s*/g, " * ");
            pushErrorOnce(
              ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH.code,
              ModelicaErrorCode.VARIABILITY_BINDING_MISMATCH.rule,
              `Component ${m.name} of variability PARAM has binding ${formattedRhs} of higher variability VAR.`,
              m.node,
            );
          }
        }
      }
      // ArrayModTypeError2: 2D array attribute modification e.g. y(start = {{1, 2, 3}, {4, 5, 6}}) vs Real y[2, 2]
      if (isOldFrontend && targetNode) {
        const dim2M = targetNode.text.match(/\[\s*(\d+)\s*,\s*(\d+)\s*\]/);
        const start2M = m.text.match(/\bstart\s*=\s*\{\s*(\{[^}]+\}(?:\s*,\s*\{[^}]+\})*)\s*\}/);
        if (dim2M && start2M) {
          const expectedCols = parseInt(dim2M[2]!, 10);
          const rows = start2M[1]!.match(/\{[^}]+\}/g) ?? [];
          let badRow: { text: string; len: number } | null = null;
          for (const row of rows) {
            const elems = row
              .slice(1, -1)
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            if (elems.length !== expectedCols) {
              badRow = { text: `{${elems.join(", ")}}`, len: elems.length };
            }
          }
          if (badRow) {
            pushNotification(dae, m.node);
            pushErrorOnce(
              ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.code,
              ModelicaErrorCode.ARRAY_DIMENSION_MISMATCH.rule,
              `Array dimension mismatch, expression ${badRow.text} has type Integer[${badRow.len}], expected array dimensions [${expectedCols}].`,
              targetNode,
            );
          }
        }
      }
      if (target.isProtected && !viaExtends && !isOldFrontend && !resolveShortClassBase(db, targetSym.id)) {
        pushNotification(dae, m.node, ModelicaErrorCode.NOTIFICATION_PROTECTED_MODIFICATION.code);
        pushErrorOnce(
          ModelicaErrorCode.PROTECTED_MODIFICATION.code,
          ModelicaErrorCode.PROTECTED_MODIFICATION.rule,
          ModelicaErrorCode.PROTECTED_MODIFICATION.message(m.name, m.text),
          targetNode,
        );
      }
      if (target.isOuter && !m.isRedeclare && !isOldFrontend) {
        let modText = m.nested?.text?.trim() ?? m.text;
        if (modText.startsWith("=") && !modText.startsWith("= ")) {
          modText = `= ${modText.slice(1).trim()}`;
        }
        pushErrorOnce(
          ModelicaErrorCode.OUTER_MODIFIER.code,
          ModelicaErrorCode.OUTER_MODIFIER.rule,
          ModelicaErrorCode.OUTER_MODIFIER.message(modText, m.name),
          m.node,
        );
      }
      if (m.classModNode) {
        if (PRIMITIVE_BUILTIN_TYPES.has(target.typeName)) {
          if (target.cst) {
            const targetMods = collectModifiersInNode(target.cst);
            for (const nm of collectModifiersInNode(m.classModNode)) {
              const targetMatch = targetMods.find((tm) => tm.name === nm.name);
              if (targetMatch?.isFinal) {
                let eqPart = nm.text.includes("=") ? nm.text.slice(nm.text.indexOf("=")).trim() : nm.text;
                if (eqPart.startsWith("=") && !eqPart.startsWith("= ")) {
                  eqPart = `= ${eqPart.slice(1).trim()}`;
                }
                const targetMod = targetMatch.node ?? target.cst;
                pushNotification(dae, nm.node);
                pushErrorOnce(
                  ModelicaErrorCode.FINAL_OVERRIDE.code,
                  ModelicaErrorCode.FINAL_OVERRIDE.rule,
                  ModelicaErrorCode.FINAL_OVERRIDE.message(nm.name, eqPart),
                  targetMod,
                );
              }
              if (nm.classModNode) {
                for (const nnm of collectModifiersInNode(nm.classModNode)) {
                  if (nnm.name) {
                    pushErrorOnce(
                      ModelicaErrorCode.MODIFIED_ELEMENT_NOT_FOUND.code,
                      ModelicaErrorCode.MODIFIED_ELEMENT_NOT_FOUND.rule,
                      ModelicaErrorCode.MODIFIED_ELEMENT_NOT_FOUND.message(`${nm.name}.${nnm.name}`, target.typeName),
                      nm.node,
                    );
                  }
                }
              }
            }
          }
        } else if (target.typeName) {
          if (target.cst) {
            const targetMods = collectModifiersInNode(target.cst);
            for (const nm of collectModifiersInNode(m.classModNode)) {
              const targetMatch = targetMods.find((tm) => tm.name === nm.name);
              if (targetMatch?.isFinal) {
                let eqPart = nm.text.includes("=") ? nm.text.slice(nm.text.indexOf("=")).trim() : nm.text;
                if (eqPart.startsWith("=") && !eqPart.startsWith("= ")) {
                  eqPart = `= ${eqPart.slice(1).trim()}`;
                }
                const targetMod = targetMatch.node ?? target.cst;
                pushNotification(dae, nm.node);
                pushErrorOnce(
                  ModelicaErrorCode.FINAL_OVERRIDE.code,
                  ModelicaErrorCode.FINAL_OVERRIDE.rule,
                  ModelicaErrorCode.FINAL_OVERRIDE.message(nm.name, eqPart),
                  targetMod,
                );
              }
            }
          }
          const subSym = resolveClassSym(db, target.ownerClassId, target.typeName);
          if (subSym) {
            checkClassModifiers(ctx, subSym, m.classModNode, false);
          }
        }
      }
    }
  }
}

export function validateExtendsModifications(ctx: ClassValidationContext): void {
  const { db, classId, children, validateSubtree } = ctx;
  // 5. Extends modification checks (final override / protected mod / redeclare, including nested)
  for (const child of children) {
    if (child.kind !== "Extends") continue;
    const baseSym =
      db.query<SymbolEntry | null>("resolvedBaseClass", child.id) ?? resolveClassSym(db, classId, child.name);
    if (!baseSym) continue;
    const extCst = cstOf(db, child.id);
    if (extCst) {
      const modWrap = extCst.namedChildren.find(
        (c) => c.type === "class_or_inheritance_modification" || c.type === "class_modification",
      );
      const modNode =
        modWrap?.type === "class_modification"
          ? modWrap
          : (modWrap?.namedChildren.find((c) => c.type === "class_modification") ?? modWrap ?? null);
      if (modNode) {
        checkClassModifiers(ctx, baseSym, modNode, true);
      }
    }
    validateSubtree(baseSym.id);
  }
}
