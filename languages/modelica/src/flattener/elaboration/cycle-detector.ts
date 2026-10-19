// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder, ExprKind, type QueryDB, type SymbolId, Variability } from "@modelscript/runtime";
import { ModelicaErrorCode } from "../../errors.js";
import { extractCompilerOptions } from "../support/compiler-options.js";

export function collectExprVarNames(
  exprId: number,
  dae: DAEBuilder,
  names: Set<string>,
  visited = new Set<number>(),
): void {
  if (exprId < 0 || visited.has(exprId)) return;
  visited.add(exprId);
  const kind = dae.getExprKind(exprId);
  switch (kind) {
    case ExprKind.Name: {
      const name = dae.interner.resolve(dae.getExprData1(exprId));
      if (name) names.add(name);
      break;
    }
    case ExprKind.Binary: {
      collectExprVarNames(dae.getExprLeft(exprId), dae, names, visited);
      collectExprVarNames(dae.getExprRight(exprId), dae, names, visited);
      break;
    }
    case ExprKind.Unary:
    case ExprKind.Negate: {
      collectExprVarNames(dae.getExprLeft(exprId), dae, names, visited);
      break;
    }
    case ExprKind.Call: {
      const argCount = dae.getExprRight(exprId);
      for (let i = 0; i < argCount; i++) {
        const argExprId = i === 0 ? dae.getExprLeft(exprId) : dae.getExprLeft(exprId + i);
        collectExprVarNames(argExprId, dae, names, visited);
      }
      break;
    }
    case ExprKind.Subscript: {
      collectExprVarNames(dae.getExprData1(exprId), dae, names, visited);
      collectExprVarNames(dae.getExprLeft(exprId), dae, names, visited);
      break;
    }
    case ExprKind.ArrayCtor: {
      const count = dae.getExprData1(exprId);
      if (count > 0) collectExprVarNames(dae.getExprLeft(exprId), dae, names, visited);
      for (let i = 1; i < count; i++) {
        collectExprVarNames(dae.getExprLeft(exprId + i), dae, names, visited);
      }
      break;
    }
    case ExprKind.IfElse: {
      collectExprVarNames(dae.getExprData1(exprId), dae, names, visited);
      collectExprVarNames(dae.getExprLeft(exprId), dae, names, visited);
      collectExprVarNames(dae.getExprRight(exprId), dae, names, visited);
      break;
    }
    case ExprKind.Der:
    case ExprKind.Pre: {
      collectExprVarNames(dae.getExprData1(exprId), dae, names, visited);
      break;
    }
  }
}

export function checkCyclicConstantsAndParameters(
  dae: DAEBuilder,
  rootClassId: SymbolId,
  db: QueryDB,
  options: any,
  varConditionDeps: Map<string, string[] | Set<string>>,
): void {
  const rootSym = db.symbol(rootClassId);
  const rootCst = db.cstNode(rootClassId) as any;
  const ignoreCycles =
    Boolean(options?.ignoreCycles) || extractCompilerOptions(rootCst, options, db, rootSym).ignoreCycles;
  if (ignoreCycles) return;

  if (dae.diagnostics.some((d) => d.code === ModelicaErrorCode.CYCLIC_CONSTANTS_OR_PARAMETERS.code)) {
    return;
  }

  if (!dae.extensionMetadata?.["isOldFrontend"]) {
    const children = db.childrenOf(rootClassId);
    const paramNames = new Set<string>();
    for (const ch of children) {
      if (ch.kind === "Component") {
        const ci = db.query<any>("componentInstance", ch.id);
        if (ci?.variability === "parameter") {
          paramNames.add(ch.name);
        }
      }
    }
    if (paramNames.size > 0) {
      for (const ch of children) {
        if (ch.kind === "Component") {
          const ci = db.query<any>("componentInstance", ch.id);
          const rawBind =
            ci?.modification?.bindingExpression?.text ?? ci?.modification?.value?.text ?? ci?.bindingExpression?.text;
          if (ci?.variability === "constant" && rawBind) {
            const bText = rawBind.trim();
            const ids = bText.match(/[a-zA-Z_]\w*/g) || [];
            if (ids.some((id: string) => paramNames.has(id))) {
              let clauseNode: any = db.cstNode(ch.id);
              while (clauseNode && clauseNode.type !== "component_clause" && clauseNode.type !== "element") {
                clauseNode = clauseNode.parent;
              }
              const rNode = clauseNode ?? (db.cstNode(ch.id) as any);
              const rangeObj = rNode
                ? {
                    startOffset: rNode.startIndex ?? rNode.startOffset,
                    endOffset: rNode.endIndex ?? rNode.endOffset,
                    startPosition: rNode.startPosition,
                    endPosition: rNode.endPosition,
                  }
                : undefined;
              dae.diagnostics.push({
                severity: "error",
                code: ModelicaErrorCode.CONSTANT_VARIABILITY_VIOLATION.code,
                message: ModelicaErrorCode.CONSTANT_VARIABILITY_VIOLATION.message(ch.name, bText, "parameter"),
                range: rangeObj,
              });
              return;
            }
          }
        }
      }
    }
  }

  const rootClassName = rootSym?.name ?? "Model";

  const scopeToVars = new Map<string, string[]>();
  const scopeVarToDeps = new Map<string, Map<string, string[]>>();

  for (let i = 0; i < dae.varCount; i++) {
    if (dae.isVarRemoved(i)) continue;
    const variability = dae.getVarVariability(i);
    if (variability !== Variability.Constant && variability !== Variability.Parameter) continue;

    const fullName = dae.getVarName(i);
    const baseName = fullName.replace(/\[.*\]$/, "");
    const dotIdx = baseName.lastIndexOf(".");
    const scope = dotIdx >= 0 ? `${rootClassName}.${baseName.slice(0, dotIdx)}` : rootClassName;
    const simpleName = dotIdx >= 0 ? baseName.slice(dotIdx + 1) : baseName;
    const prefix = dotIdx >= 0 ? baseName.slice(0, dotIdx) : "";

    if (!scopeToVars.has(scope)) {
      scopeToVars.set(scope, []);
    }
    const varsInScope = scopeToVars.get(scope)!;
    if (!varsInScope.includes(simpleName)) {
      varsInScope.push(simpleName);
    }

    if (!scopeVarToDeps.has(scope)) {
      scopeVarToDeps.set(scope, new Map());
    }
    const varToDeps = scopeVarToDeps.get(scope)!;

    const rawDeps = new Set<string>();
    const exprId = dae.getVarExpression(i);
    if (exprId !== undefined && exprId >= 0) {
      collectExprVarNames(exprId, dae, rawDeps);
    }
    const condDeps = varConditionDeps.get(fullName) ?? varConditionDeps.get(baseName);
    if (condDeps) {
      for (const cd of condDeps) rawDeps.add(cd);
    }

    const scopeDeps = varToDeps.get(simpleName) ?? [];
    for (const d of rawDeps) {
      const cleanD = d.replace(/\[.*\]$/, "");
      if (prefix) {
        if (cleanD.startsWith(prefix + ".")) {
          const depSimple = cleanD.slice(prefix.length + 1);
          if (!depSimple.includes(".")) {
            if (!scopeDeps.includes(depSimple)) scopeDeps.push(depSimple);
          }
        }
      } else {
        if (!cleanD.includes(".")) {
          if (!scopeDeps.includes(cleanD)) scopeDeps.push(cleanD);
        }
      }
    }
    varToDeps.set(simpleName, scopeDeps);
  }

  const rootVars = scopeToVars.get(rootClassName);
  const rootVarToDeps = scopeVarToDeps.get(rootClassName);
  if (rootVars && rootVarToDeps) {
    const children = db.childrenOf(rootClassId);
    for (const ch of children) {
      if (ch.kind === "Component" && rootVars.includes(ch.name)) {
        const ci = db.query<any>("componentInstance", ch.id);
        if (ci?.variability !== "constant") continue;
        let rawBind =
          ci?.modification?.bindingExpression?.text ?? ci?.modification?.value?.text ?? ci?.bindingExpression?.text;
        if (!rawBind) {
          const cstText = (db.cstNode(ch.id) as any)?.text ?? "";
          const eqIdx = cstText.indexOf("=");
          if (eqIdx >= 0) rawBind = cstText.slice(eqIdx + 1);
        }
        if (rawBind) {
          const cleanedBind = rawBind.replace(/\.\s*[a-zA-Z_]\w*/g, "").replace(/\bsize\s*\([^)]*\)/g, "");
          const ids = cleanedBind.match(/[a-zA-Z_]\w*/g) || [];
          const scopeDeps = rootVarToDeps.get(ch.name) ?? [];
          for (const id of ids) {
            if (rootVars.includes(id) && !scopeDeps.includes(id)) {
              scopeDeps.push(id);
            }
          }
          rootVarToDeps.set(ch.name, scopeDeps);
        }
      }
    }
  }

  for (const [scope, vars] of scopeToVars) {
    const varToDeps = scopeVarToDeps.get(scope);
    if (!varToDeps) continue;
    for (let idx = vars.length - 1; idx >= 0; idx--) {
      const startNode = vars[idx]!;
      const visited = new Set<string>();
      const path: string[] = [startNode];

      const dfs = (curr: string): boolean => {
        const neighbors = varToDeps.get(curr) || [];
        for (const next of neighbors) {
          if (next === startNode) return true;
          if (!visited.has(next)) {
            visited.add(next);
            path.push(next);
            if (dfs(next)) return true;
            path.pop();
          }
        }
        return false;
      };

      if (dfs(startNode)) {
        const cycleStr = path.join(",");
        dae.diagnostics.push({
          severity: "error",
          code: ModelicaErrorCode.CYCLIC_CONSTANTS_OR_PARAMETERS.code,
          message: ModelicaErrorCode.CYCLIC_CONSTANTS_OR_PARAMETERS.message(scope, cycleStr),
        });
        return;
      }
    }
  }
}

export function checkCyclicFunctionComponents(fn: DAEBuilder, fnSymId: SymbolId, db: QueryDB): void {
  if (fn.extensionMetadata?.["isOldFrontend"]) {
    return;
  }
  if (fn.diagnostics.some((d) => d.code === ModelicaErrorCode.CYCLIC_FUNCTION_COMPONENTS.code)) {
    return;
  }

  const compNames: string[] = [];
  const varToDeps = new Map<string, string[]>();

  for (let i = 0; i < fn.varCount; i++) {
    if (fn.isVarRemoved(i)) continue;
    const name = fn.getVarName(i);
    const cleanName = name.replace(/\[.*\]$/, "");
    if (!compNames.includes(cleanName)) {
      compNames.push(cleanName);
    }

    const rawDeps = new Set<string>();
    const exprId = fn.getVarExpression(i);
    if (exprId !== undefined && exprId >= 0) {
      collectExprVarNames(exprId, fn, rawDeps);
    }

    const deps: string[] = [];
    for (const d of rawDeps) {
      const cleanD = d.replace(/\[.*\]$/, "");
      if (!deps.includes(cleanD)) {
        deps.push(cleanD);
      }
    }
    varToDeps.set(cleanName, deps);
  }

  for (let idx = compNames.length - 1; idx >= 0; idx--) {
    const startNode = compNames[idx]!;
    const visited = new Set<string>();
    const path: string[] = [startNode];

    const dfs = (curr: string): boolean => {
      const neighbors = varToDeps.get(curr) || [];
      for (const next of neighbors) {
        if (next === startNode) return true;
        if (!visited.has(next)) {
          visited.add(next);
          path.push(next);
          if (dfs(next)) return true;
          path.pop();
        }
      }
      return false;
    };

    if (dfs(startNode)) {
      const cycleStr = path.join(", ");
      const bCst = db.cstNode(fnSymId) as any;
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
        code: ModelicaErrorCode.CYCLIC_FUNCTION_COMPONENTS.code,
        message: ModelicaErrorCode.CYCLIC_FUNCTION_COMPONENTS.message(cycleStr),
        range: rangeObj,
      });
      return;
    }
  }
}
