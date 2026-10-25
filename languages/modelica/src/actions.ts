// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ActionExecutionContext } from "@modelscript/dsl";
import { ExprKind, initBltWasm, printArenaDAE, Variability, VarType } from "@modelscript/runtime";
import { simulateArenaAsync } from "@modelscript/simulate";
import { ModelicaFlattener } from "./flattener.js";

import { injectPredefinedTypes } from "./predefined-types.js";

function resolveClassId(queryEngine: any, queryDB: any, className: string): number | undefined {
  let firstId: number | undefined;
  if (className.includes(".")) {
    const parts = className.split(".");
    let currentId: any = null;
    for (const part of parts) {
      const resolver = queryDB.query?.("resolveSimpleName", currentId);
      const res = resolver ? resolver(part) : null;
      if (!res) {
        currentId = null;
        break;
      }
      currentId = res.id ?? null;
    }
    firstId = currentId ?? undefined;
  }
  if (firstId === undefined && queryEngine.index?.byName) {
    const entries = queryEngine.index.byName.get(className) || [];
    firstId = entries[0];
  }
  if (firstId === undefined && queryEngine.index?.symbols) {
    for (const [id, entry] of queryEngine.index.symbols.entries()) {
      if (entry.name === className || entry.qualifiedName === className) {
        firstId = id;
        break;
      }
    }
  }
  // Fallback to short name if qualified lookup didn't match directly
  if (firstId === undefined && className.includes(".")) {
    const shortName = className.split(".").pop()!;
    if (queryEngine.index?.byName) {
      const entries = queryEngine.index.byName.get(shortName) || [];
      firstId = entries[0];
    }
    if (firstId === undefined && queryEngine.index?.symbols) {
      for (const [id, entry] of queryEngine.index.symbols.entries()) {
        if (entry.name === shortName) {
          firstId = id;
          break;
        }
      }
    }
  }
  return firstId;
}

function ensureClassIndexed(
  context: ActionExecutionContext,
  className: string,
  queryEngine: any,
): { firstId: number | undefined; queryDB: any } {
  let docText = context.documentText;
  let uri = context.uri;

  if (!docText && uri && typeof (context as any).documents?.get === "function") {
    const doc = (context as any).documents.get(uri);
    if (doc) docText = doc.getText();
  }

  if (!docText && typeof (context as any).documents?.all === "function") {
    for (const d of (context as any).documents.all()) {
      const t = d.getText();
      if (t.includes(className)) {
        docText = t;
        if (!uri) uri = d.uri;
        break;
      }
    }
  }

  const ws =
    (context.workspaceManager as any)?.globalWorkspaceIndex ??
    (context.workspaceManager as any)?.getWorkspaceIndex?.("modelica");
  const sharedCtx =
    (globalThis as any).sharedContext ??
    (context as any).sharedContext ??
    (context as any).state?.sharedContext ??
    (context as any).parserService?.sharedContext ??
    (context.workspaceManager as any)?.sharedContext;

  let parseFn = sharedCtx?.parse;
  if (typeof parseFn !== "function") {
    const parser =
      (globalThis as any).modelicaParser ??
      (context as any).parserService?.getParser?.("modelica") ??
      (context as any).parserService?.parser ??
      (context.workspaceManager as any)?.parserService?.getParser?.("modelica") ??
      (context.workspaceManager as any)?.parserService?.parser;
    if (parser && typeof parser.parse === "function") {
      parseFn = (_ext: string, input: string) => parser.parse(input);
    }
  }

  if (docText && typeof parseFn === "function" && ws) {
    try {
      const tree = parseFn(".mo", docText);
      if (tree) {
        const effectiveUri = uri ?? "file:///unnamed.mo";
        const docTrees =
          (context as any).documentManager?.documentTrees ??
          (context.workspaceManager as any)?.documentManager?.documentTrees;
        if (docTrees && typeof docTrees.set === "function") {
          docTrees.set(effectiveUri, { text: docText, tree });
        }

        const prevTree = (queryEngine as any).tree;
        const cstWrapper = {
          getText: (s: number, e: number, entry?: any) => {
            const resUri = entry?.resourceId ?? effectiveUri;
            const norm = resUri.replace(/^([a-z0-9+-]+):\/{1,3}/i, "$1:///");
            const dt = docTrees?.get?.(resUri) ?? docTrees?.get?.(norm);
            if (dt?.text) return dt.text.substring(s, e);
            const sharedWrapper = (context as any).parserService?.getSharedCstTreeWrapper?.();
            if (sharedWrapper) return sharedWrapper.getText(s, e, entry);
            if (resUri === effectiveUri && docText) return docText.substring(s, e);
            if (prevTree && typeof prevTree.getText === "function") {
              const res = prevTree.getText(s, e, entry);
              if (res) return res;
            }
            return docText ? docText.substring(s, e) : null;
          },
          getNode: (s: number, e: number, entry?: any) => {
            const resUri = entry?.resourceId ?? effectiveUri;
            const norm = resUri.replace(/^([a-z0-9+-]+):\/{1,3}/i, "$1:///");
            const dt = docTrees?.get?.(resUri) ?? docTrees?.get?.(norm);
            const rNode = dt ? dt.tree?.rootNode : resUri === effectiveUri ? tree.rootNode : null;
            if (rNode) {
              return typeof rNode.descendantForIndex === "function"
                ? rNode.descendantForIndex(s, Math.max(s, e))
                : typeof rNode.getNode === "function"
                  ? rNode.getNode(s, e)
                  : null;
            }
            const sharedWrapper = (context as any).parserService?.getSharedCstTreeWrapper?.();
            if (sharedWrapper) return sharedWrapper.getNode(s, e, entry);
            if (prevTree && typeof prevTree.getNode === "function") {
              const res = prevTree.getNode(s, e, entry);
              if (res) return res;
            }
            return null;
          },
        };
        if (typeof queryEngine.updateTree === "function") {
          queryEngine.updateTree(cstWrapper);
        }

        const uws = (context.workspaceManager as any)?.unifiedWorkspace;
        let unified: any;
        let changedInfo: any;

        if (uws && typeof uws.reindexDocument === "function") {
          uws.reindexDocument(effectiveUri, () => tree.rootNode);
          if (typeof ws.reindexDocument === "function") {
            ws.reindexDocument(effectiveUri, () => tree.rootNode);
          }
          unified = uws.toUnifiedPartial();
          changedInfo = ws.takeGlobalChangedIds?.();
        } else {
          if (typeof ws.reindexDocument === "function") {
            ws.reindexDocument(effectiveUri, () => tree.rootNode);
          } else {
            ws.indexDocument(effectiveUri, () => tree.rootNode);
          }
          unified = ws.toUnified();
          changedInfo = ws.takeGlobalChangedIds?.();
        }

        injectPredefinedTypes(unified);

        if (typeof queryEngine.updateIndex === "function") {
          queryEngine.updateIndex(unified, effectiveUri, changedInfo?.changedIds, changedInfo?.structuralChangedIds);
        }
      }
    } catch (err) {
      console.warn("[ensureClassIndexed] Error reindexing documentText:", err);
    }
  }

  let queryDB = queryEngine.toQueryDB();
  let firstId = resolveClassId(queryEngine, queryDB, className);

  if (firstId !== undefined && typeof queryEngine.invalidate === "function") {
    const childIds = queryEngine.index?.childrenOf?.get(firstId) ?? [];
    const structSet = new Set<number>([firstId, ...childIds]);
    queryEngine.invalidate(structSet, structSet);
    queryDB = queryEngine.toQueryDB();
  }

  const shortName = className.includes(".") ? className.split(".").pop()! : className;

  if (firstId === undefined && ws?.unifiedIndex) {
    let entries = ws.unifiedIndex.byName?.get(className) || [];
    if (entries.length === 0 && shortName !== className) {
      entries = ws.unifiedIndex.byName?.get(shortName) || [];
    }
    firstId = entries[0];
    if (firstId === undefined && ws.unifiedIndex.symbols) {
      for (const [id, entry] of ws.unifiedIndex.symbols.entries()) {
        if (entry.name === className || entry.qualifiedName === className || entry.name === shortName) {
          firstId = id;
          break;
        }
      }
    }
    if (firstId !== undefined && typeof queryEngine.updateIndex === "function") {
      const unified = ws.toUnified();
      injectPredefinedTypes(unified);
      queryEngine.updateIndex(unified);
      queryDB = queryEngine.toQueryDB();
      const childIds = queryEngine.index?.childrenOf?.get(firstId) ?? [];
      const structSet = new Set<number>([firstId, ...childIds]);
      queryEngine.invalidate(structSet, structSet);
    }
  }

  if (firstId === undefined && (context.workspaceManager as any)?.unifiedWorkspace) {
    const uws = (context.workspaceManager as any).unifiedWorkspace.toUnifiedPartial();
    if (uws?.byName) {
      let entries = uws.byName.get(className) || [];
      if (entries.length === 0 && shortName !== className) {
        entries = uws.byName.get(shortName) || [];
      }
      firstId = entries[0];
      if (firstId === undefined && uws.symbols) {
        for (const [id, entry] of uws.symbols.entries()) {
          if (entry.name === className || entry.qualifiedName === className || entry.name === shortName) {
            firstId = id;
            break;
          }
        }
      }
      if (firstId !== undefined && typeof queryEngine.updateIndex === "function") {
        injectPredefinedTypes(uws);
        queryEngine.updateIndex(uws);
        queryDB = queryEngine.toQueryDB();
        const childIds = queryEngine.index?.childrenOf?.get(firstId) ?? [];
        const structSet = new Set<number>([firstId, ...childIds]);
        queryEngine.invalidate(structSet, structSet);
      }
    }
  }

  return { firstId, queryDB };
}

function extractClassName(context: ActionExecutionContext, inputs: any): string | undefined {
  let className = inputs?.name;
  let docText = context.documentText;
  let uri = context.uri;

  if (!docText && uri && typeof (context as any).documents?.get === "function") {
    const doc = (context as any).documents.get(uri);
    if (doc) docText = doc.getText();
  }
  if (!docText && typeof (context as any).documents?.all === "function") {
    for (const d of (context as any).documents.all()) {
      const t = d.getText();
      if ((className && t.includes(className)) || /\b(?:model|block|class|record)\s+/.test(t)) {
        docText = t;
        if (!uri) uri = d.uri;
        break;
      }
    }
  }
  if (docText) {
    const wm = docText.match(/^\s*within\s*([a-zA-Z0-9_.]+)\s*;/m);
    if (wm && wm[1]?.trim()) {
      const pkg = wm[1].trim();
      if (!className) {
        const m = docText.match(/\b(?:model|block|class|record)\s+([A-Za-z0-9_]+)/);
        if (m) className = `${pkg}.${m[1]}`;
      } else if (!className.includes(".")) {
        className = `${pkg}.${className}`;
      }
    }
  }
  if (!className && docText) {
    const m = docText.match(/\b(?:model|block|class|record)\s+([A-Za-z0-9_]+)/);
    if (m) className = m[1];
  }
  return className;
}

/**
 * Host-side execution handlers for Modelica actions.
 * Decoupled from the declarative language syntax grammar.
 */
export const modelicaActionHandlers: Record<
  string,
  (context: ActionExecutionContext, inputs: any) => Promise<any> | any
> = {
  flatten: async (context: ActionExecutionContext, inputs: any) => {
    const className = extractClassName(context, inputs);
    if (!className) {
      throw new Error("No Modelica class name specified to flatten.");
    }

    const queryEngine = context.queryEngine;
    if (!queryEngine) {
      throw new Error("QueryEngine not available in execution context.");
    }

    const { firstId, queryDB } = ensureClassIndexed(context, className, queryEngine);
    if (firstId === undefined) {
      throw new Error(`Class '${className}' not found in index.`);
    }

    const flattener = new ModelicaFlattener(queryDB);
    context.notifyProgress?.(`Flattening ${className}...`, 50);
    const arena = flattener.flatten(firstId);
    const text = printArenaDAE(arena);
    context.notifyProgress?.("Flattening complete", 100);
    return {
      text,
      name: className,
    };
  },

  simulate: async (context: ActionExecutionContext, inputs: any) => {
    const className = extractClassName(context, inputs);
    if (!className) {
      throw new Error("No Modelica class name specified to simulate.");
    }

    const queryEngine = context.queryEngine;
    if (!queryEngine) {
      throw new Error("QueryEngine not available in execution context.");
    }

    const { firstId, queryDB } = ensureClassIndexed(context, className, queryEngine);
    if (firstId === undefined) {
      throw new Error(`Class '${className}' not found in index.`);
    }

    const flattener = new ModelicaFlattener(queryDB);
    context.notifyProgress?.(`Flattening ${className}...`, 30);
    const arena = flattener.flatten(firstId);

    context.notifyProgress?.(`Simulating ${className}...`, 60);
    const tier0Ids: number[] = [];
    const tier1Ids: number[] = [];
    const tier2Ids: number[] = [];
    const derIds: number[] = [];
    const seenIds = new Set<number>();
    for (let i = 0; i < arena.varCount; i++) {
      if (arena.isVarRemoved(i)) continue;
      if (arena.hiddenVarIndices?.has(i)) continue;
      const v = arena.getVarVariability(i);
      if (v === Variability.Parameter || v === Variability.Constant) continue;
      if (arena.getVarShape(i).length > 0) continue;
      const name = arena.getVarName(i);
      const nameId = arena.getVarNameId(i);
      seenIds.add(nameId);
      if (arena.isVarFixed(i)) {
        tier0Ids.push(nameId);
      } else if (
        name.split(".").length <= 2 &&
        !name.startsWith("ground.") &&
        !name.endsWith(".T_heatPort") &&
        !name.endsWith(".R_actual")
      ) {
        tier1Ids.push(nameId);
      } else {
        tier2Ids.push(nameId);
      }
    }
    for (let e = 0; e < arena.exprCount; e++) {
      if (arena.getExprKind(e) === ExprKind.Der) {
        const argId = arena.getExprData1(e);
        if (argId >= 0 && arena.getExprKind(argId) === ExprKind.Name) {
          const baseName = arena.interner.resolve(arena.getExprData1(argId));
          if (baseName) {
            const baseIdx = arena.getVarIdxByName(baseName);
            if (baseIdx >= 0 && !arena.isVarRemoved(baseIdx) && !arena.hiddenVarIndices?.has(baseIdx)) {
              const derId = arena.interner.intern(`der(${baseName})`);
              if (!seenIds.has(derId)) {
                seenIds.add(derId);
                derIds.push(derId);
              }
            }
          }
        }
      }
    }
    const outputStringIds = [...tier0Ids, ...tier1Ids, ...tier2Ids, ...derIds];

    if (arena.experiment.stopTime === undefined && inputs?.stopTime === undefined) {
      let maxFreq = 0;
      for (let i = 0; i < arena.varCount; i++) {
        if (arena.isVarRemoved(i)) continue;
        if (arena.getVarVariability(i) !== Variability.Parameter) continue;
        const name = arena.getVarName(i);
        if (name === "f" || name === "freqHz" || name.endsWith(".f") || name.endsWith(".freqHz")) {
          const val = arena.getVarStartValue(i);
          if (Number.isFinite(val) && val > maxFreq) maxFreq = val;
        }
      }
      // Per Modelica Spec Section 18.4 & OMEdit, default StopTime is 1.0 s (500 intervals -> dt=0.002s).
      // Only shorten StopTime automatically when frequency >= 100 Hz where dt=0.002s would alias.
      arena.experiment.stopTime = maxFreq >= 100 ? Number((10 / maxFreq).toPrecision(4)) : 1.0;
      if (arena.experiment.interval === undefined) {
        arena.experiment.interval = Number(
          ((arena.experiment.stopTime - (arena.experiment.startTime ?? 0)) / 500).toPrecision(4),
        );
      }
    }

    const simOpts: any = {
      solver: inputs?.solver || "dopri5",
      ...(outputStringIds.length > 0 ? { outputStringIds } : {}),
    };
    if (inputs?.startTime !== undefined) simOpts.startTime = inputs.startTime;
    if (inputs?.stopTime !== undefined) simOpts.stopTime = inputs.stopTime;
    if (inputs?.interval !== undefined) simOpts.step = inputs.interval;

    if (inputs?.parameterOverrides) {
      simOpts.parameterOverrides = new Map(Object.entries(inputs.parameterOverrides));
    }

    try {
      const serverDist = (globalThis as any).serverDistBase;
      if (serverDist) {
        await initBltWasm(`${serverDist}/release.wasm`);
      } else {
        await initBltWasm();
      }
    } catch {
      // ignore if already initialized
    }

    const result = await simulateArenaAsync(arena as any, simOpts);
    context.notifyProgress?.("Simulation complete", 100);

    const tArr = Array.from(result.t);
    const yArr = (result.y || []).map((row: any) => (Array.isArray(row) ? row : Array.from(row)));

    function resolveAttrString(ar: any, varIdx: number, attrName: string): string | undefined {
      const exprId = ar.getVarAttrExprId?.(varIdx, attrName);
      if (exprId === undefined || exprId < 0) return undefined;
      if (ar.getExprKind(exprId) === ExprKind.StringLiteral) {
        return ar.interner.resolve(ar.getExprData1(exprId));
      }
      return undefined;
    }

    function evalAttrNum(ar: any, varIdx: number, attrName: string): number | undefined {
      const exprId = ar.getVarAttrExprId?.(varIdx, attrName);
      if (exprId === undefined || exprId < 0) return undefined;
      const kind = ar.getExprKind(exprId);
      if (kind === ExprKind.RealLiteral) return ar.getExprRealValue(exprId);
      if (kind === ExprKind.IntLiteral) return ar.getExprData1(exprId);
      return undefined;
    }

    function extractArenaParameters(ar: any): any[] {
      const infos: any[] = [];
      for (let i = 0; i < ar.varCount; i++) {
        if (ar.isVarRemoved(i)) continue;
        if (ar.getVarVariability(i) !== Variability.Parameter) continue;
        const name = ar.getVarName(i);
        const startVal = ar.getVarStartValue(i);
        const varType = ar.getVarType(i);
        let type: "real" | "integer" | "boolean" | "enumeration" = "real";
        let step = 0.1;
        if (varType === VarType.Boolean) {
          type = "boolean";
          step = 1;
        } else if (varType === VarType.Integer) {
          type = "integer";
          step = 1;
        }
        const unit = resolveAttrString(ar, i, "displayUnit") ?? resolveAttrString(ar, i, "unit");
        const description = ar.getVarDescription?.(i);
        const min = evalAttrNum(ar, i, "min");
        const max = evalAttrNum(ar, i, "max");
        infos.push({
          name,
          type,
          defaultValue: startVal,
          step,
          ...(unit ? { unit } : {}),
          ...(description ? { description } : {}),
          ...(min !== undefined ? { min } : {}),
          ...(max !== undefined ? { max } : {}),
        });
      }
      return infos;
    }

    function extractVariableMetadata(
      ar: any,
      stateNames: string[],
    ): Record<string, { unit?: string; description?: string }> {
      const meta: Record<string, { unit?: string; description?: string }> = {};
      for (const state of stateNames) {
        const isDer = state.startsWith("der(") && state.endsWith(")");
        const lookupName = isDer ? state.slice(4, -1) : state;
        const varIdx = ar.getVarIdxByName(lookupName);
        if (varIdx >= 0) {
          const baseUnit = resolveAttrString(ar, varIdx, "displayUnit") ?? resolveAttrString(ar, varIdx, "unit");
          const baseDesc = ar.getVarDescription?.(varIdx);
          const unit = isDer ? (baseUnit ? `${baseUnit}/s` : "1/s") : baseUnit;
          const description = isDer ? (baseDesc ? `der(${baseDesc})` : `Time derivative of ${lookupName}`) : baseDesc;
          if (unit || description) {
            meta[state] = {
              ...(unit ? { unit } : {}),
              ...(description ? { description } : {}),
            };
          }
        }
      }
      return meta;
    }

    const statesList = result.states || [];
    const variableMetadata = extractVariableMetadata(arena, statesList);

    if ((inputs?.format ?? "json") === "csv") {
      const states = statesList;
      const lines = [`time,${states.join(",")}`];
      for (let i = 0; i < tArr.length; i++) {
        const values = [tArr[i], ...states.map((_: string, vi: number) => yArr[i]?.[vi] ?? 0)];
        lines.push(values.join(","));
      }
      return {
        format: "csv",
        text: lines.join("\n"),
        t: tArr,
        states,
        parameters: extractArenaParameters(arena),
        variableMetadata,
        experiment: {
          ...(arena as any).experiment,
          solver: (arena as any).experiment?.solver ?? simOpts.solver ?? "dopri5",
        },
      };
    }

    return {
      name: className,
      t: tArr,
      y: yArr,
      states: statesList,
      parameters: extractArenaParameters(arena),
      variableMetadata,
      experiment: {
        ...(arena as any).experiment,
        solver: (arena as any).experiment?.solver ?? simOpts.solver ?? "dopri5",
      },
      text: `Simulation of ${className} completed: ${tArr.length} steps, states: [${statesList.join(", ")}]`,
    };
  },

  query: async (context: ActionExecutionContext, inputs: any) => {
    const name = inputs?.name;
    if (!name) throw new Error("Missing required class name");
    const queryEngine = context.queryEngine;
    if (!queryEngine) throw new Error("QueryEngine not available");

    const queryDB = queryEngine.toQueryDB ? queryEngine.toQueryDB() : null;
    const firstId = resolveClassId(queryEngine, queryDB, name);
    if (firstId === undefined) {
      return { error: `Class '${name}' not found.` };
    }
    const entry = queryEngine.index.symbols.get(firstId);
    const children = queryEngine.index.childrenOf.get(firstId) || [];
    const components: any[] = [];
    const childClasses: any[] = [];

    for (const chId of children) {
      const ch = queryEngine.index.symbols.get(chId);
      if (!ch) continue;
      if (ch.kind === 2 /* Component */) {
        components.push({
          name: ch.name,
          type: ch.typeText || "",
          description: ch.comment || "",
        });
      } else if (ch.kind === 1 /* Class */) {
        childClasses.push({
          name: ch.name,
          kind: "class",
        });
      }
    }

    return {
      name,
      kind: entry ? "class" : "unknown",
      description: entry?.comment || "",
      components,
      childClasses,
    };
  },

  parse: async (_context: ActionExecutionContext, inputs: any) => {
    const code = inputs?.code ?? "";
    const classes: { name: string; kind: string }[] = [];
    const classRegex = /\b(model|block|class|record|connector|function|package)\s+([A-Za-z0-9_]+)/g;
    let m: RegExpExecArray | null;
    while ((m = classRegex.exec(code)) !== null) {
      classes.push({ kind: m[1]!, name: m[2]! });
    }
    return {
      classes,
      syntaxErrors: [],
    };
  },
};
