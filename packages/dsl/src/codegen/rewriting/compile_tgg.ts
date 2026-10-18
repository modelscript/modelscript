// SPDX-License-Identifier: AGPL-3.0-or-later

import { PolyglotConfig, TGGConstraint, TGGRuleOptions } from "../../dsl/language.js";
import type { u32 } from "../../dsl/primitives.js";
import { invertExpression } from "../analysis/inversion.js";
import { getDJB2Hash } from "../shared/utils.js";
import { inferRuleLanguages, runCPA, type CpaConflict, type CpaReport } from "./cpa.js";
import { verifySuiteLosslessness, type LosslessnessReport } from "./losslessness.js";

export {
  inferRuleLanguages,
  runCPA,
  verifySuiteLosslessness,
  type CpaConflict,
  type CpaReport,
  type LosslessnessReport,
};

export interface CompiledTGGOutput {
  sourceCode: string;
  ruleCount: number;
  ruleNames: string[];
  cpaReport?: CpaReport | undefined;
  losslessnessReport?:
    | {
        isFullyLossless: boolean;
        reports: LosslessnessReport[];
        leakedRuleCount: number;
      }
    | undefined;
}

function stripVarPrefix(v: any): string {
  return typeof v === "string" && v.startsWith("__var_") ? v.slice(6) : String(v ?? "");
}

function findBoundProperty(bindings: Record<string, any>, v: any, fallback: string): string {
  const rawName = stripVarPrefix(v);
  return Object.keys(bindings).find((k) => bindings[k] === v || k === rawName) || rawName || fallback;
}

function formatFloatLiteral(n: number): string {
  if (!Number.isFinite(n)) return "0.0";
  return Number.isInteger(n) ? `${n}.0` : `${n}`;
}

function compileAlgebraicExprToAS(exprStr: string, inputVarIdent: string): string {
  let s = String(exprStr || "").trim();
  if (!s) return inputVarIdent;
  const eqIdx = s.indexOf("==");
  if (eqIdx !== -1) {
    s = s.slice(eqIdx + 2).trim();
  } else {
    const assignIdx = s.indexOf("=");
    if (assignIdx !== -1) {
      s = s.slice(assignIdx + 1).trim();
    }
  }
  s = s.replace(/([a-zA-Z_]\w*|\d+(?:\.\d+)?)\s*(?:\*\*|\^)\s*([\d.]+)/g, "Math.pow($1, $2)");
  const reserved = new Set(["Math", "sqrt", "pow", "exp", "log", "ln", "abs", "sin", "cos", "tan", "min", "max"]);
  s = s.replace(/\b([a-zA-Z_]\w*)\b/g, (match) => {
    if (reserved.has(match)) return match === "ln" ? "log" : match;
    return inputVarIdent;
  });
  return s;
}

/**
 * Compiles declarative Triple Graph Grammar (TGG) rules into an Ahead-Of-Time (AOT)
 * AssemblyScript transformation kernel with bidirectional forward/backward matching,
 * correspondence indexing, and O(ΔN) incremental propagation.
 *
 * Academic Citations:
 *   - Schürr, A. (1994). "Specification of graph translators with triple graph grammars."
 *     In International Workshop on Graph-Theoretic Concepts in Computer Science (WG '94),
 *     LNCS 903, pp. 151–163. Springer. DOI: 10.1007/3-540-59071-4_45.
 *   - Greenyer, J., & Kindler, E. (2010). "Comparing operational execution strategies for
 *     triple graph grammars." Software & Systems Modeling, 9(4), pp. 441–469.
 *     DOI: 10.1007/s10270-009-0140-2.
 *
 * ModelScript Architectural Rationale:
 *   ModelScript operates as a unified polyglot platform across multi-domain engineering languages
 *   (e.g., Modelica 3.x, SysML v2, STEP AP242, OWL2 ontologies). TGG rules provide mathematically
 *   rigorous, bidirectional model transformations that ensure inter-model consistency without
 *   writing error-prone point-to-point imperatively paired translators.
 *
 * Modifications:
 *   - Compiles declarative rule specifications directly to an in-WASM AssemblyScript runtime kernel.
 *   - Integrates bidirectional correspondence mapping directly into the linear memory CST database.
 *   - Supports O(ΔN) incremental delta propagation driven by Salsa query invalidation.
 *   - Automates Critical Pair Analysis (CPA) for confluence and formal information-losslessness verification.
 */
export function compileTGGRules(
  config: PolyglotConfig | TGGRuleOptions[],
  options: {
    sourceLang?: string | undefined;
    targetLang?: string | undefined;
    strictCpa?: boolean | undefined;
    verifyLossless?: boolean | undefined;
  } = {},
): CompiledTGGOutput {
  const allRules: TGGRuleOptions[] = Array.isArray(config) ? config : config.rules || [];
  const _typeMaps = !Array.isArray(config) ? config.typeMaps || {} : {};

  // Helper Proxy to evaluate pattern builder functions during compilation
  const $proxy: any = new Proxy(
    {},
    {
      get:
        (_, prop: string) =>
        (bindings: Record<string, any> = {}) => ({
          nodeType: prop,
          bindings,
        }),
    },
  );

  const vProxy = (name: string) => `__var_${name}`;

  // Evaluate and infer languages for all rules
  const evaluatedRules = allRules.map((rule, rIdx) => {
    const evaluatedSource = typeof rule.source === "function" ? rule.source($proxy, vProxy) : rule.source;
    const evaluatedTarget = typeof rule.target === "function" ? rule.target($proxy, vProxy) : rule.target;
    const constraints: TGGConstraint[] = typeof rule.where === "function" ? rule.where(vProxy) : rule.where || [];
    const { sourceLang, targetLang } = inferRuleLanguages(rule, evaluatedSource, evaluatedTarget, constraints);

    return {
      rule,
      ruleName: rule.name || `rule_${rIdx}`,
      rIdx,
      evaluatedSource,
      evaluatedTarget,
      constraints,
      sourceLang,
      targetLang,
      sourceNodeType: evaluatedSource?.nodeType || "UnknownNode",
      targetNodeType: evaluatedTarget?.nodeType || "UnknownNode",
      sourceNodeHash: getDJB2Hash(evaluatedSource?.nodeType || "UnknownNode"),
      targetNodeHash: getDJB2Hash(evaluatedTarget?.nodeType || "UnknownNode"),
      priority: rule.priority ?? 0,
    };
  });

  // Filter rules if targetLang or sourceLang option is specified
  const activeRules = evaluatedRules.filter((r) => {
    if (options.targetLang && r.targetLang && r.targetLang !== options.targetLang) {
      return false;
    }
    if (options.sourceLang && r.sourceLang && r.sourceLang !== options.sourceLang) {
      return false;
    }
    return true;
  });

  const rulesToCompile = activeRules.map((r) => r.rule);

  // 1. Run Ahead-of-Time Critical Pair Analysis
  const cpaReport = runCPA(rulesToCompile);

  // 1b. Run Automated Round-Trip Losslessness Proofs
  const losslessnessReport = verifySuiteLosslessness(rulesToCompile);
  if (options.strictCpa && cpaReport.hasConflicts) {
    const errorConflicts = cpaReport.conflicts.filter((c) => c.severity === "error" || c.kind === "overlap");
    if (errorConflicts.length > 0) {
      throw new Error(
        `Critical Pair Analysis failed with ${errorConflicts.length} error(s):\n` +
          errorConflicts.map((c) => `  - [${c.kind}] ${c.description}`).join("\n"),
      );
    }
  }

  const ruleNames: string[] = [];
  const ruleReconcileMeta: {
    srcPropHash: u32;
    tgtPropHash: u32;
    hasPhysBounds: boolean;
    minStr: string;
    maxStr: string;
  }[] = [];

  let code = `// ============================================================================\n`;
  code += `// AOT Compiled Triple Graph Grammar (TGG) Polyglot Transformation Kernel\n`;
  code += `// ============================================================================\n`;
  code += `import { CorrespondenceIndex, CORR_FLAG_SYNCED, CORR_FLAG_STALE, CORR_FLAG_CONFLICT } from "./correspondence";\n`;
  code += `import { PolyglotArena } from "./polyglot_arena";\n`;
  code += `import { graph, ModelAPI } from "./graph";\n`;
  code += `import { getNodeType, getNodeFirstChild, getNodeNextSibling, ast_createNode, atomicChunkAlloc } from "./arena";\n`;
  code += `import { tgg_reconcile_scalar, tgg_reconcile_interval, tgg_reconcile_physics_simplex } from "./tgg_reconciler";\n\n`;

  for (let idx = 0; idx < activeRules.length; idx++) {
    const r = activeRules[idx]!;
    const ruleName = r.ruleName;
    ruleNames.push(ruleName);

    const evaluatedSource = r.evaluatedSource;
    const evaluatedTarget = r.evaluatedTarget;
    const constraints = r.constraints;
    const sourceNodeHash = r.sourceNodeHash;
    const targetNodeHash = r.targetNodeHash;
    const srcBindings = evaluatedSource?.bindings || {};
    const tgtBindings = evaluatedTarget?.bindings || {};

    // Forward transformation
    code += `// --- Rule ${idx}: ${ruleName} (Forward) ---\n`;
    code += `export function tgg_forward_${ruleName}(sourceNodeId: u32, corr: CorrespondenceIndex, arena: PolyglotArena, parentSlot: u32 = 0xFFFFFFFF): u32 {\n`;
    code += `  if (sourceNodeId == 0) return 0;\n`;
    code += `  \n`;
    code += `  // Check if target already created in correspondence index\n`;
    code += `  let existingTarget = corr.findBySource(sourceNodeId);\n`;
    code += `  if (existingTarget != 0) return existingTarget;\n\n`;

    // Guard: Verify literal source bindings
    for (const [srcProp, srcVal] of Object.entries(srcBindings)) {
      const srcPropHash = getDJB2Hash(srcProp) as u32;
      if (typeof srcVal === "string" && !srcVal.startsWith("__var_")) {
        code += `  if (graph.model.getProperty<u32>(sourceNodeId, ${srcPropHash} as u32) != ${getDJB2Hash(srcVal)} as u32) return 0;\n`;
      } else if (typeof srcVal === "number") {
        code += `  if (graph.model.getProperty<f64>(sourceNodeId, ${srcPropHash} as u32) != ${srcVal}) return 0;\n`;
      } else if (typeof srcVal === "boolean") {
        code += `  if (graph.model.getProperty<u32>(sourceNodeId, ${srcPropHash} as u32) != ${srcVal ? 1 : 0} as u32) return 0;\n`;
      }
    }

    // Allocate target AST node
    code += `  let targetNodeId = graph.model.create((${targetNodeHash} & 0xffff) as u16);\n\n`;

    // Emit real AST property assignments from bindings
    for (const [tgtProp, tgtVal] of Object.entries(tgtBindings)) {
      const tgtPropHash = getDJB2Hash(tgtProp) as u32;
      if (typeof tgtVal === "string" && tgtVal.startsWith("__var_")) {
        const matchedSrcAttr = Object.keys(srcBindings).find((k) => srcBindings[k] === tgtVal);
        if (matchedSrcAttr) {
          const srcPropHash = getDJB2Hash(matchedSrcAttr) as u32;
          code += `  let __val_${tgtProp} = graph.model.getProperty<u32>(sourceNodeId, ${srcPropHash} as u32);\n`;
          code += `  graph.model.setProperty<u32>(targetNodeId, ${tgtPropHash} as u32, __val_${tgtProp});\n`;
        }
      } else if (typeof tgtVal === "boolean") {
        code += `  graph.model.setProperty<u32>(targetNodeId, ${tgtPropHash} as u32, ${tgtVal ? 1 : 0} as u32);\n`;
      } else if (typeof tgtVal === "number") {
        code += `  graph.model.setProperty<f64>(targetNodeId, ${tgtPropHash} as u32, ${tgtVal});\n`;
      } else if (typeof tgtVal === "string") {
        code += `  graph.model.setProperty<u32>(targetNodeId, ${tgtPropHash} as u32, ${getDJB2Hash(tgtVal)} as u32);\n`;
      }
    }

    // Process constraints
    for (let cIdx = 0; cIdx < constraints.length; cIdx++) {
      const c = constraints[cIdx]!;
      if (c.kind === "eq") {
        const [a, b] = c.args;
        code += `  // Constraint: eq(${a}, ${b})\n`;
        const aName = stripVarPrefix(a);
        const bName = stripVarPrefix(b);
        const srcProp = Object.keys(srcBindings).find(
          (k) => srcBindings[k] === a || k === aName || srcBindings[k] === b || k === bName,
        );
        const tgtProp = Object.keys(tgtBindings).find(
          (k) => tgtBindings[k] === b || k === bName || tgtBindings[k] === a || k === aName,
        );
        if (srcProp && tgtProp) {
          const srcPropHash = getDJB2Hash(srcProp) as u32;
          const tgtPropHash = getDJB2Hash(tgtProp) as u32;
          code += `  let __eqVal_fwd_${idx}_${cIdx} = graph.model.getProperty<u32>(sourceNodeId, ${srcPropHash} as u32);\n`;
          code += `  if (__eqVal_fwd_${idx}_${cIdx} != 0) {\n`;
          code += `    graph.model.setProperty<u32>(targetNodeId, ${tgtPropHash} as u32, __eqVal_fwd_${idx}_${cIdx});\n`;
          code += `  }\n`;
        }
      } else if (c.kind === "defaultVal") {
        const [targetVar, defVal] = c.args;
        const tgtProp = findBoundProperty(tgtBindings, targetVar, stripVarPrefix(targetVar));
        const propHash = getDJB2Hash(tgtProp) as u32;
        if (typeof defVal === "boolean") {
          code += `  if (graph.model.getProperty<u32>(targetNodeId, ${propHash} as u32) == 0) {\n`;
          code += `    graph.model.setProperty<u32>(targetNodeId, ${propHash} as u32, ${defVal ? 1 : 0} as u32);\n`;
          code += `  }\n`;
        } else if (typeof defVal === "number") {
          code += `  if (graph.model.getProperty<f64>(targetNodeId, ${propHash} as u32) == 0.0) {\n`;
          code += `    graph.model.setProperty<f64>(targetNodeId, ${propHash} as u32, ${defVal});\n`;
          code += `  }\n`;
        } else if (typeof defVal === "string") {
          code += `  if (graph.model.getProperty<u32>(targetNodeId, ${propHash} as u32) == 0) {\n`;
          code += `    graph.model.setProperty<u32>(targetNodeId, ${propHash} as u32, ${getDJB2Hash(defVal)} as u32);\n`;
          code += `  }\n`;
        }
      } else if (c.kind === "typeMap") {
        const [sourceVar, targetVar, mapKey] = c.args;
        const srcProp = findBoundProperty(srcBindings, sourceVar, "type");
        const tgtProp = findBoundProperty(tgtBindings, targetVar, "type");
        const srcPropHash = getDJB2Hash(srcProp) as u32;
        const tgtPropHash = getDJB2Hash(tgtProp) as u32;
        const mapObj: Record<string, string> | undefined =
          typeof mapKey === "string"
            ? _typeMaps[mapKey]
            : typeof mapKey === "object" && mapKey !== null
              ? (mapKey as Record<string, string>)
              : undefined;
        code += `  // Type mapping: ${srcProp} -> ${tgtProp} using ${typeof mapKey === "string" ? mapKey : "custom map"}\n`;
        code += `  let __srcType_${idx}_${cIdx} = graph.model.getProperty<u32>(sourceNodeId, ${srcPropHash} as u32);\n`;
        code += `  let __mappedType_${idx}_${cIdx} = __srcType_${idx}_${cIdx};\n`;
        if (mapObj) {
          for (const [k, v] of Object.entries(mapObj)) {
            code += `  if (__srcType_${idx}_${cIdx} == ${getDJB2Hash(k)} as u32) __mappedType_${idx}_${cIdx} = ${getDJB2Hash(String(v))} as u32;\n`;
          }
        }
        code += `  graph.model.setProperty<u32>(targetNodeId, ${tgtPropHash} as u32, __mappedType_${idx}_${cIdx});\n`;
      } else if (c.kind === "formatUri") {
        const [idVar, prefix, targetVar] = c.args;
        const srcProp = findBoundProperty(srcBindings, idVar, "id");
        const tgtProp = findBoundProperty(tgtBindings, targetVar, "iri");
        const srcPropHash = getDJB2Hash(srcProp) as u32;
        const tgtPropHash = getDJB2Hash(tgtProp) as u32;
        const prefixHash = prefix ? (getDJB2Hash(String(prefix)) as u32) : 0;
        code += `  // Format URI: ${targetVar} = ${JSON.stringify(prefix)} + ${idVar}\n`;
        code += `  let __idVal_${idx}_${cIdx} = graph.model.getProperty<u32>(sourceNodeId, ${srcPropHash} as u32);\n`;
        code += `  let __uriVal_${idx}_${cIdx}: u32 = __idVal_${idx}_${cIdx} != 0 ? (__idVal_${idx}_${cIdx} ^ (${prefixHash} as u32)) : 0;\n`;
        code += `  graph.model.setProperty<u32>(targetNodeId, ${tgtPropHash} as u32, __uriVal_${idx}_${cIdx});\n`;
      } else if (c.kind === "mapList") {
        const [sourceListVar, targetListVar, mapper] = c.args;
        const srcProp = findBoundProperty(srcBindings, sourceListVar, "items");
        const tgtProp = findBoundProperty(tgtBindings, targetListVar, "items");
        const srcPropHash = getDJB2Hash(srcProp) as u32;
        const tgtPropHash = getDJB2Hash(tgtProp) as u32;
        const mapperRule =
          typeof mapper === "string" && activeRules.some((ar) => ar.ruleName === mapper) ? mapper : null;
        code += `  // Map List: ${sourceListVar} -> ${targetListVar}\n`;
        code += `  {\n`;
        code += `    let __listVal_fwd_${idx}_${cIdx} = graph.model.getProperty<u32>(sourceNodeId, ${srcPropHash} as u32);\n`;
        code += `    if (__listVal_fwd_${idx}_${cIdx} != 0) {\n`;
        code += `      graph.model.setProperty<u32>(targetNodeId, ${tgtPropHash} as u32, __listVal_fwd_${idx}_${cIdx});\n`;
        code += `    }\n`;
        code += `    let __item_fwd_${idx}_${cIdx} = getNodeFirstChild(sourceNodeId);\n`;
        code += `    while (__item_fwd_${idx}_${cIdx} != 0) {\n`;
        if (mapperRule) {
          code += `      let __mapped_fwd_${idx}_${cIdx} = tgg_forward_${mapperRule}(__item_fwd_${idx}_${cIdx}, corr, arena, parentSlot);\n`;
        } else {
          code += `      let __mapped_fwd_${idx}_${cIdx} = tgg_forward_dispatch(getNodeType(__item_fwd_${idx}_${cIdx}) as u32, __item_fwd_${idx}_${cIdx}, corr, arena, 0, parentSlot);\n`;
        }
        code += `      if (__mapped_fwd_${idx}_${cIdx} == 0) {\n`;
        code += `        __mapped_fwd_${idx}_${cIdx} = graph.model.clone(__item_fwd_${idx}_${cIdx}, true);\n`;
        code += `      }\n`;
        code += `      if (__mapped_fwd_${idx}_${cIdx} != 0) {\n`;
        code += `        graph.model.appendChild(targetNodeId, __mapped_fwd_${idx}_${cIdx});\n`;
        code += `      }\n`;
        code += `      __item_fwd_${idx}_${cIdx} = getNodeNextSibling(__item_fwd_${idx}_${cIdx});\n`;
        code += `    }\n`;
        code += `  }\n`;
      } else if (c.kind === "compute") {
        const [targetVar, queryName, sourceVar] = c.args;
        const srcProp = findBoundProperty(srcBindings, sourceVar, "value");
        const tgtProp = findBoundProperty(tgtBindings, targetVar, "value");
        const srcPropHash = getDJB2Hash(srcProp) as u32;
        const tgtPropHash = getDJB2Hash(tgtProp) as u32;
        const queryHash = getDJB2Hash(String(queryName || "compute")) as u32;
        code += `  // Compute: ${targetVar} = query("${queryName}", ${sourceVar})\n`;
        code += `  {\n`;
        code += `    let __compVal_fwd_${idx}_${cIdx} = graph.model.compute(sourceNodeId, ${queryHash} as u32);\n`;
        code += `    if (__compVal_fwd_${idx}_${cIdx} == 0) {\n`;
        code += `      __compVal_fwd_${idx}_${cIdx} = graph.model.getProperty<u32>(sourceNodeId, ${srcPropHash} as u32);\n`;
        code += `    }\n`;
        code += `    graph.model.setProperty<u32>(targetNodeId, ${tgtPropHash} as u32, __compVal_fwd_${idx}_${cIdx});\n`;
        code += `  }\n`;
      } else if (c.kind === "not") {
        const [forbiddenPattern] = c.args;
        const evaluatedForbidden =
          typeof forbiddenPattern === "function" ? forbiddenPattern($proxy, vProxy) : forbiddenPattern;
        const forbiddenType = evaluatedForbidden?.nodeType || String(forbiddenPattern);
        const forbiddenHash = getDJB2Hash(forbiddenType);
        code += `  // NAC: Verify forbidden pattern '${forbiddenType}' is absent\n`;
        code += `  {\n`;
        code += `    let checkChild = getNodeFirstChild(sourceNodeId);\n`;
        code += `    while (checkChild != 0) {\n`;
        code += `      if (getNodeType(checkChild) == ((${forbiddenHash} & 0xffff) as u16)) return 0;\n`;
        code += `      checkChild = getNodeNextSibling(checkChild);\n`;
        code += `    }\n`;
        code += `  }\n`;
      } else if (c.kind === "path") {
        const [sourceVar, pathString, targetVar] = c.args;
        const srcProp = findBoundProperty(srcBindings, sourceVar, "source");
        const tgtProp = findBoundProperty(tgtBindings, targetVar, "target");
        const srcPropHash = getDJB2Hash(srcProp) as u32;
        const tgtPropHash = getDJB2Hash(tgtProp) as u32;
        const segments = String(pathString || "")
          .split(/[./]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        code += `  // Property path: ${sourceVar} --[${pathString}]--> ${targetVar}\n`;
        code += `  {\n`;
        code += `    let __pathCurr_fwd_${idx}_${cIdx}: u32 = sourceNodeId;\n`;
        for (let sIdx = 0; sIdx < segments.length; sIdx++) {
          const segHash = getDJB2Hash(segments[sIdx]!) as u32;
          code += `    if (__pathCurr_fwd_${idx}_${cIdx} != 0) {\n`;
          code += `      let __nextHop_${idx}_${cIdx}_${sIdx} = graph.model.resolveHash(__pathCurr_fwd_${idx}_${cIdx}, ${segHash} as u32);\n`;
          code += `      if (__nextHop_${idx}_${cIdx}_${sIdx} == 0) {\n`;
          code += `        __nextHop_${idx}_${cIdx}_${sIdx} = graph.model.getProperty<u32>(__pathCurr_fwd_${idx}_${cIdx}, ${segHash} as u32);\n`;
          code += `      }\n`;
          code += `      __pathCurr_fwd_${idx}_${cIdx} = __nextHop_${idx}_${cIdx}_${sIdx};\n`;
          code += `    }\n`;
        }
        code += `    if (__pathCurr_fwd_${idx}_${cIdx} == 0 || __pathCurr_fwd_${idx}_${cIdx} == sourceNodeId) {\n`;
        code += `      __pathCurr_fwd_${idx}_${cIdx} = graph.model.getProperty<u32>(sourceNodeId, ${srcPropHash} as u32);\n`;
        code += `    }\n`;
        code += `    if (__pathCurr_fwd_${idx}_${cIdx} != 0) {\n`;
        code += `      graph.model.setProperty<u32>(targetNodeId, ${tgtPropHash} as u32, __pathCurr_fwd_${idx}_${cIdx});\n`;
        code += `    }\n`;
        code += `  }\n`;
      } else if (c.kind === "forEach") {
        const [collectionVar, itemVar, bodyConstraints] = c.args;
        const srcProp = findBoundProperty(srcBindings, collectionVar, "children");
        const tgtProp = findBoundProperty(tgtBindings, collectionVar, srcProp);
        const srcPropHash = getDJB2Hash(srcProp) as u32;
        const tgtPropHash = getDJB2Hash(tgtProp) as u32;
        code += `  // Multi-amalgamation: forEach ${itemVar} in ${collectionVar}\n`;
        code += `  {\n`;
        code += `    let __collVal_fwd_${idx}_${cIdx} = graph.model.getProperty<u32>(sourceNodeId, ${srcPropHash} as u32);\n`;
        code += `    if (__collVal_fwd_${idx}_${cIdx} != 0) {\n`;
        code += `      graph.model.setProperty<u32>(targetNodeId, ${tgtPropHash} as u32, __collVal_fwd_${idx}_${cIdx});\n`;
        code += `    }\n`;
        code += `    let __child_${idx}_${cIdx} = getNodeFirstChild(sourceNodeId);\n`;
        code += `    while (__child_${idx}_${cIdx} != 0) {\n`;
        code += `      let __mappedChild_${idx}_${cIdx} = tgg_forward_dispatch(getNodeType(__child_${idx}_${cIdx}) as u32, __child_${idx}_${cIdx}, corr, arena, 0, parentSlot);\n`;
        code += `      if (__mappedChild_${idx}_${cIdx} == 0) {\n`;
        code += `        __mappedChild_${idx}_${cIdx} = graph.model.clone(__child_${idx}_${cIdx}, true);\n`;
        code += `      }\n`;
        if (Array.isArray(bodyConstraints)) {
          for (let bIdx = 0; bIdx < bodyConstraints.length; bIdx++) {
            const bc = bodyConstraints[bIdx];
            if (bc && bc.kind === "eq" && Array.isArray(bc.args)) {
              const bPropA = getDJB2Hash(stripVarPrefix(bc.args[0]) || "value") as u32;
              const bPropB = getDJB2Hash(stripVarPrefix(bc.args[1]) || "value") as u32;
              code += `      let __bVal_fwd_${idx}_${cIdx}_${bIdx} = graph.model.getProperty<u32>(__child_${idx}_${cIdx}, ${bPropA} as u32);\n`;
              code += `      if (__bVal_fwd_${idx}_${cIdx}_${bIdx} != 0) {\n`;
              code += `        graph.model.setProperty<u32>(__mappedChild_${idx}_${cIdx}, ${bPropB} as u32, __bVal_fwd_${idx}_${cIdx}_${bIdx});\n`;
              code += `      }\n`;
            }
          }
        }
        code += `      if (__mappedChild_${idx}_${cIdx} != 0) {\n`;
        code += `        graph.model.appendChild(targetNodeId, __mappedChild_${idx}_${cIdx});\n`;
        code += `      }\n`;
        code += `      __child_${idx}_${cIdx} = getNodeNextSibling(__child_${idx}_${cIdx});\n`;
        code += `    }\n`;
        code += `  }\n`;
      } else if (c.kind === "reconcile") {
        const [sourceVar, targetVar, strategy] = c.args;
        code += `  // Conflict reconciliation policy: ${sourceVar} <-> ${targetVar} (${strategy})\n`;
      } else if (c.kind === "reconcilePhysics") {
        const [sourceVar, targetVar, bounds] = c.args;
        code += `  // Physics reconciliation policy: ${sourceVar} <-> ${targetVar} bounds=[${bounds?.min ?? -1e9}, ${bounds?.max ?? 1e9}]\n`;
      } else if (c.kind === "complement") {
        const [fields] = c.args;
        code += `  // Shadow complement preserved fields: [${(fields || []).join(", ")}]\n`;
      } else if (c.kind === "invertible") {
        const [fwd, bwd] = c.args;
        const tgtDefaultProp = Object.keys(tgtBindings)[0] || "value";
        const inv = invertExpression(String(fwd || ""), tgtDefaultProp);
        const srcProp = findBoundProperty(srcBindings, inv.sourceVar || Object.keys(srcBindings)[0], "value");
        const tgtProp = findBoundProperty(tgtBindings, inv.targetVar || tgtDefaultProp, "value");
        const srcPropHash = getDJB2Hash(srcProp) as u32;
        const tgtPropHash = getDJB2Hash(tgtProp) as u32;
        code += `  // Invertible constraint: forward='${fwd}' backward='${bwd || inv.invertedExpr || "auto-derived"}'\n`;
        if (inv.kind === "prefix") {
          const prefixMatch = String(fwd || "")
            .trim()
            .match(/^"([^"]+)"/);
          const prefixHash = prefixMatch ? (getDJB2Hash(prefixMatch[1]!) as u32) : 0;
          code += `  {\n`;
          code += `    let __invId_fwd_${idx}_${cIdx} = graph.model.getProperty<u32>(sourceNodeId, ${srcPropHash} as u32);\n`;
          code += `    let __invOut_fwd_${idx}_${cIdx}: u32 = __invId_fwd_${idx}_${cIdx} != 0 ? (__invId_fwd_${idx}_${cIdx} ^ (${prefixHash} as u32)) : 0;\n`;
          code += `    graph.model.setProperty<u32>(targetNodeId, ${tgtPropHash} as u32, __invOut_fwd_${idx}_${cIdx});\n`;
          code += `  }\n`;
        } else {
          const srcVarIdent = `__invSrc_fwd_${idx}_${cIdx}`;
          const asFwdExpr = compileAlgebraicExprToAS(String(fwd || ""), srcVarIdent);
          code += `  {\n`;
          code += `    let ${srcVarIdent} = graph.model.getProperty<f64>(sourceNodeId, ${srcPropHash} as u32);\n`;
          code += `    let __invTgt_fwd_${idx}_${cIdx}: f64 = ${asFwdExpr};\n`;
          code += `    graph.model.setProperty<f64>(targetNodeId, ${tgtPropHash} as u32, __invTgt_fwd_${idx}_${cIdx});\n`;
          code += `  }\n`;
        }
      } else if (c.kind === "exprMap") {
        const [srcExpr, tgtExpr, dialect] = c.args;
        code += `  // Mathematical expression mapping: ${srcExpr} <-> ${tgtExpr} (${dialect})\n`;
        const srcProp = findBoundProperty(srcBindings, srcExpr, stripVarPrefix(srcExpr));
        const tgtProp = findBoundProperty(tgtBindings, tgtExpr, stripVarPrefix(tgtExpr));
        const srcPropHash = getDJB2Hash(srcProp) as u32;
        const tgtPropHash = getDJB2Hash(tgtProp) as u32;
        code += `  let __exprVal_fwd_${idx}_${cIdx} = graph.model.getProperty<u32>(sourceNodeId, ${srcPropHash} as u32);\n`;
        code += `  if (__exprVal_fwd_${idx}_${cIdx} != 0) {\n`;
        code += `    graph.model.setProperty<u32>(targetNodeId, ${tgtPropHash} as u32, __exprVal_fwd_${idx}_${cIdx});\n`;
        code += `  }\n`;
      } else if (c.kind === "physicalPort") {
        const [acrossVar, flowVar, domain] = c.args;
        code += `  // Physical port balance: domain='${domain}'\n`;
        const srcAcrossProp = findBoundProperty(srcBindings, acrossVar, stripVarPrefix(acrossVar));
        const tgtAcrossProp = findBoundProperty(tgtBindings, acrossVar, stripVarPrefix(acrossVar));
        const srcFlowProp = findBoundProperty(srcBindings, flowVar, stripVarPrefix(flowVar));
        const tgtFlowProp = findBoundProperty(tgtBindings, flowVar, stripVarPrefix(flowVar));
        code += `  let __acrossVal_fwd_${idx} = graph.model.getProperty<u32>(sourceNodeId, ${getDJB2Hash(srcAcrossProp)} as u32);\n`;
        code += `  if (__acrossVal_fwd_${idx} != 0) graph.model.setProperty<u32>(targetNodeId, ${getDJB2Hash(tgtAcrossProp)} as u32, __acrossVal_fwd_${idx});\n`;
        code += `  let __flowVal_fwd_${idx} = graph.model.getProperty<u32>(sourceNodeId, ${getDJB2Hash(srcFlowProp)} as u32);\n`;
        code += `  if (__flowVal_fwd_${idx} != 0) graph.model.setProperty<u32>(targetNodeId, ${getDJB2Hash(tgtFlowProp)} as u32, __flowVal_fwd_${idx});\n`;
      }
    }

    const compConstraint = constraints.find((c) => c.kind === "complement");
    const compFields: string[] = compConstraint?.args?.[0] || [];

    code += `  // Register bidirectional link in correspondence index\n`;
    code += `  let corrSlot = corr.addLink(sourceNodeId, targetNodeId, ${idx}, CORR_FLAG_SYNCED, 0, parentSlot);\n`;
    if (compFields.length > 0) {
      code += `  // Allocate and store shadow complement fiber in linear memory\n`;
      code += `  let compPtr = atomicChunkAlloc(${compFields.length * 8});\n`;
      for (let fIdx = 0; fIdx < compFields.length; fIdx++) {
        const fHash = getDJB2Hash(compFields[fIdx]!) as u32;
        code += `  store<u32>(compPtr + ${fIdx * 8}, ${fHash});\n`;
        code += `  store<u32>(compPtr + ${fIdx * 8 + 4}, graph.model.getProperty<u32>(sourceNodeId, ${fHash}));\n`;
      }
      code += `  corr.setComplement(corrSlot, compPtr as u32);\n`;
    }
    code += `  return targetNodeId;\n`;
    code += `}\n\n`;

    // Backward transformation
    code += `// --- Rule ${idx}: ${ruleName} (Backward) ---\n`;
    code += `export function tgg_backward_${ruleName}(targetNodeId: u32, corr: CorrespondenceIndex, arena: PolyglotArena, parentSlot: u32 = 0xFFFFFFFF): u32 {\n`;
    code += `  if (targetNodeId == 0) return 0;\n`;
    code += `  \n`;
    code += `  let existingSource = corr.findByTarget(targetNodeId);\n`;
    code += `  if (existingSource != 0) return existingSource;\n\n`;

    // Check literal target bindings as preconditions
    for (const [tgtProp, tgtVal] of Object.entries(tgtBindings)) {
      const tgtPropHash = getDJB2Hash(tgtProp) as u32;
      if (typeof tgtVal === "string" && !tgtVal.startsWith("__var_")) {
        code += `  if (graph.model.getProperty<u32>(targetNodeId, ${tgtPropHash} as u32) != ${getDJB2Hash(tgtVal)} as u32) return 0;\n`;
      } else if (typeof tgtVal === "number") {
        code += `  if (graph.model.getProperty<f64>(targetNodeId, ${tgtPropHash} as u32) != ${tgtVal}) return 0;\n`;
      } else if (typeof tgtVal === "boolean") {
        code += `  if (graph.model.getProperty<u32>(targetNodeId, ${tgtPropHash} as u32) != ${tgtVal ? 1 : 0} as u32) return 0;\n`;
      }
    }

    code += `  let sourceNodeId = graph.model.create((${sourceNodeHash} & 0xffff) as u16);\n\n`;

    // Reverse attribute assignments
    for (const [srcProp, srcVal] of Object.entries(srcBindings)) {
      const srcPropHash = getDJB2Hash(srcProp) as u32;
      if (typeof srcVal === "string" && srcVal.startsWith("__var_")) {
        const matchedTgtAttr = Object.keys(tgtBindings).find((k) => tgtBindings[k] === srcVal);
        if (matchedTgtAttr) {
          const tgtPropHash = getDJB2Hash(matchedTgtAttr) as u32;
          code += `  let __val_bwd_${srcProp} = graph.model.getProperty<u32>(targetNodeId, ${tgtPropHash} as u32);\n`;
          code += `  graph.model.setProperty<u32>(sourceNodeId, ${srcPropHash} as u32, __val_bwd_${srcProp});\n`;
        }
      } else if (typeof srcVal === "boolean") {
        code += `  graph.model.setProperty<u32>(sourceNodeId, ${srcPropHash} as u32, ${srcVal ? 1 : 0} as u32);\n`;
      } else if (typeof srcVal === "number") {
        code += `  graph.model.setProperty<f64>(sourceNodeId, ${srcPropHash} as u32, ${srcVal});\n`;
      } else if (typeof srcVal === "string") {
        code += `  graph.model.setProperty<u32>(sourceNodeId, ${srcPropHash} as u32, ${getDJB2Hash(srcVal)} as u32);\n`;
      }
    }

    // Reverse constraint processing
    for (let cIdx = 0; cIdx < constraints.length; cIdx++) {
      const c = constraints[cIdx]!;
      if (c.kind === "eq") {
        const [a, b] = c.args;
        const aName = stripVarPrefix(a);
        const bName = stripVarPrefix(b);
        const srcProp = Object.keys(srcBindings).find(
          (k) => srcBindings[k] === a || k === aName || srcBindings[k] === b || k === bName,
        );
        const tgtProp = Object.keys(tgtBindings).find(
          (k) => tgtBindings[k] === b || k === bName || tgtBindings[k] === a || k === aName,
        );
        if (srcProp && tgtProp) {
          const srcPropHash = getDJB2Hash(srcProp) as u32;
          const tgtPropHash = getDJB2Hash(tgtProp) as u32;
          code += `  let __eqVal_bwd_${idx}_${cIdx} = graph.model.getProperty<u32>(targetNodeId, ${tgtPropHash} as u32);\n`;
          code += `  if (__eqVal_bwd_${idx}_${cIdx} != 0) {\n`;
          code += `    graph.model.setProperty<u32>(sourceNodeId, ${srcPropHash} as u32, __eqVal_bwd_${idx}_${cIdx});\n`;
          code += `  }\n`;
        }
      } else if (c.kind === "formatUri") {
        const [idVar, prefix, targetVar] = c.args;
        const srcProp = findBoundProperty(srcBindings, idVar, "id");
        const tgtProp = findBoundProperty(tgtBindings, targetVar, "iri");
        const srcPropHash = getDJB2Hash(srcProp) as u32;
        const tgtPropHash = getDJB2Hash(tgtProp) as u32;
        const prefixHash = prefix ? (getDJB2Hash(String(prefix)) as u32) : 0;
        code += `  // Reverse Format URI: strip prefix ${JSON.stringify(prefix)} from ${targetVar} -> ${idVar}\n`;
        code += `  let __uriVal_bwd_${idx}_${cIdx} = graph.model.getProperty<u32>(targetNodeId, ${tgtPropHash} as u32);\n`;
        code += `  let __idVal_bwd_${idx}_${cIdx}: u32 = __uriVal_bwd_${idx}_${cIdx} != 0 ? (__uriVal_bwd_${idx}_${cIdx} ^ (${prefixHash} as u32)) : 0;\n`;
        code += `  graph.model.setProperty<u32>(sourceNodeId, ${srcPropHash} as u32, __idVal_bwd_${idx}_${cIdx});\n`;
      } else if (c.kind === "mapList") {
        const [sourceListVar, targetListVar, mapper] = c.args;
        const srcProp = findBoundProperty(srcBindings, sourceListVar, "items");
        const tgtProp = findBoundProperty(tgtBindings, targetListVar, "items");
        const srcPropHash = getDJB2Hash(srcProp) as u32;
        const tgtPropHash = getDJB2Hash(tgtProp) as u32;
        const mapperRule =
          typeof mapper === "string" && activeRules.some((ar) => ar.ruleName === mapper) ? mapper : null;
        code += `  // Reverse Map List: ${targetListVar} -> ${sourceListVar}\n`;
        code += `  {\n`;
        code += `    let __listVal_bwd_${idx}_${cIdx} = graph.model.getProperty<u32>(targetNodeId, ${tgtPropHash} as u32);\n`;
        code += `    if (__listVal_bwd_${idx}_${cIdx} != 0) {\n`;
        code += `      graph.model.setProperty<u32>(sourceNodeId, ${srcPropHash} as u32, __listVal_bwd_${idx}_${cIdx});\n`;
        code += `    }\n`;
        code += `    let __item_bwd_${idx}_${cIdx} = getNodeFirstChild(targetNodeId);\n`;
        code += `    while (__item_bwd_${idx}_${cIdx} != 0) {\n`;
        if (mapperRule) {
          code += `      let __mapped_bwd_${idx}_${cIdx} = tgg_backward_${mapperRule}(__item_bwd_${idx}_${cIdx}, corr, arena, parentSlot);\n`;
        } else {
          code += `      let __mapped_bwd_${idx}_${cIdx} = tgg_backward_dispatch(getNodeType(__item_bwd_${idx}_${cIdx}) as u32, __item_bwd_${idx}_${cIdx}, corr, arena, 0, parentSlot);\n`;
        }
        code += `      if (__mapped_bwd_${idx}_${cIdx} == 0) {\n`;
        code += `        __mapped_bwd_${idx}_${cIdx} = graph.model.clone(__item_bwd_${idx}_${cIdx}, true);\n`;
        code += `      }\n`;
        code += `      if (__mapped_bwd_${idx}_${cIdx} != 0) {\n`;
        code += `        graph.model.appendChild(sourceNodeId, __mapped_bwd_${idx}_${cIdx});\n`;
        code += `      }\n`;
        code += `      __item_bwd_${idx}_${cIdx} = getNodeNextSibling(__item_bwd_${idx}_${cIdx});\n`;
        code += `    }\n`;
        code += `  }\n`;
      } else if (c.kind === "compute") {
        const [targetVar, queryName, sourceVar] = c.args;
        const srcProp = findBoundProperty(srcBindings, sourceVar, "value");
        const tgtProp = findBoundProperty(tgtBindings, targetVar, "value");
        const srcPropHash = getDJB2Hash(srcProp) as u32;
        const tgtPropHash = getDJB2Hash(tgtProp) as u32;
        code += `  // Reverse Compute: ${sourceVar} <- ${targetVar} ("${queryName}")\n`;
        code += `  {\n`;
        code += `    let __compVal_bwd_${idx}_${cIdx} = graph.model.getProperty<u32>(targetNodeId, ${tgtPropHash} as u32);\n`;
        code += `    if (__compVal_bwd_${idx}_${cIdx} != 0) {\n`;
        code += `      graph.model.setProperty<u32>(sourceNodeId, ${srcPropHash} as u32, __compVal_bwd_${idx}_${cIdx});\n`;
        code += `    }\n`;
        code += `  }\n`;
      } else if (c.kind === "path") {
        const [sourceVar, pathString, targetVar] = c.args;
        const srcProp = findBoundProperty(srcBindings, sourceVar, "source");
        const tgtProp = findBoundProperty(tgtBindings, targetVar, "target");
        const srcPropHash = getDJB2Hash(srcProp) as u32;
        const tgtPropHash = getDJB2Hash(tgtProp) as u32;
        const segments = String(pathString || "")
          .split(/[./]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        code += `  // Reverse Property path: ${targetVar} --[${pathString}]--> ${sourceVar}\n`;
        code += `  {\n`;
        code += `    let __pathVal_bwd_${idx}_${cIdx} = graph.model.getProperty<u32>(targetNodeId, ${tgtPropHash} as u32);\n`;
        code += `    if (__pathVal_bwd_${idx}_${cIdx} != 0) {\n`;
        code += `      graph.model.setProperty<u32>(sourceNodeId, ${srcPropHash} as u32, __pathVal_bwd_${idx}_${cIdx});\n`;
        if (segments.length > 0) {
          const lastSegHash = getDJB2Hash(segments[segments.length - 1]!) as u32;
          code += `      graph.model.setProperty<u32>(sourceNodeId, ${lastSegHash} as u32, __pathVal_bwd_${idx}_${cIdx});\n`;
        }
        code += `    }\n`;
        code += `  }\n`;
      } else if (c.kind === "forEach") {
        const [collectionVar, itemVar, bodyConstraints] = c.args;
        const srcProp = findBoundProperty(srcBindings, collectionVar, "children");
        const tgtProp = findBoundProperty(tgtBindings, collectionVar, srcProp);
        const srcPropHash = getDJB2Hash(srcProp) as u32;
        const tgtPropHash = getDJB2Hash(tgtProp) as u32;
        code += `  // Reverse Multi-amalgamation: forEach ${itemVar} in ${collectionVar}\n`;
        code += `  {\n`;
        code += `    let __collVal_bwd_${idx}_${cIdx} = graph.model.getProperty<u32>(targetNodeId, ${tgtPropHash} as u32);\n`;
        code += `    if (__collVal_bwd_${idx}_${cIdx} != 0) {\n`;
        code += `      graph.model.setProperty<u32>(sourceNodeId, ${srcPropHash} as u32, __collVal_bwd_${idx}_${cIdx});\n`;
        code += `    }\n`;
        code += `    let __child_bwd_${idx}_${cIdx} = getNodeFirstChild(targetNodeId);\n`;
        code += `    while (__child_bwd_${idx}_${cIdx} != 0) {\n`;
        code += `      let __mappedChild_bwd_${idx}_${cIdx} = tgg_backward_dispatch(getNodeType(__child_bwd_${idx}_${cIdx}) as u32, __child_bwd_${idx}_${cIdx}, corr, arena, 0, parentSlot);\n`;
        code += `      if (__mappedChild_bwd_${idx}_${cIdx} == 0) {\n`;
        code += `        __mappedChild_bwd_${idx}_${cIdx} = graph.model.clone(__child_bwd_${idx}_${cIdx}, true);\n`;
        code += `      }\n`;
        if (Array.isArray(bodyConstraints)) {
          for (let bIdx = 0; bIdx < bodyConstraints.length; bIdx++) {
            const bc = bodyConstraints[bIdx];
            if (bc && bc.kind === "eq" && Array.isArray(bc.args)) {
              const bPropA = getDJB2Hash(stripVarPrefix(bc.args[0]) || "value") as u32;
              const bPropB = getDJB2Hash(stripVarPrefix(bc.args[1]) || "value") as u32;
              code += `      let __bVal_bwd_${idx}_${cIdx}_${bIdx} = graph.model.getProperty<u32>(__child_bwd_${idx}_${cIdx}, ${bPropB} as u32);\n`;
              code += `      if (__bVal_bwd_${idx}_${cIdx}_${bIdx} != 0) {\n`;
              code += `        graph.model.setProperty<u32>(__mappedChild_bwd_${idx}_${cIdx}, ${bPropA} as u32, __bVal_bwd_${idx}_${cIdx}_${bIdx});\n`;
              code += `      }\n`;
            }
          }
        }
        code += `      if (__mappedChild_bwd_${idx}_${cIdx} != 0) {\n`;
        code += `        graph.model.appendChild(sourceNodeId, __mappedChild_bwd_${idx}_${cIdx});\n`;
        code += `      }\n`;
        code += `      __child_bwd_${idx}_${cIdx} = getNodeNextSibling(__child_bwd_${idx}_${cIdx});\n`;
        code += `    }\n`;
        code += `  }\n`;
      } else if (c.kind === "invertible") {
        const [fwd, bwd] = c.args;
        const tgtDefaultProp = Object.keys(tgtBindings)[0] || "value";
        const inv = invertExpression(String(fwd || ""), tgtDefaultProp);
        const srcProp = findBoundProperty(srcBindings, inv.sourceVar || Object.keys(srcBindings)[0], "value");
        const tgtProp = findBoundProperty(tgtBindings, inv.targetVar || tgtDefaultProp, "value");
        const srcPropHash = getDJB2Hash(srcProp) as u32;
        const tgtPropHash = getDJB2Hash(tgtProp) as u32;
        const effectiveBwd = bwd ? String(bwd) : inv.invertedExpr || String(fwd || "");
        code += `  // Reverse Invertible constraint: backward='${effectiveBwd}'\n`;
        if (inv.kind === "prefix") {
          const prefixMatch = String(fwd || "")
            .trim()
            .match(/^"([^"]+)"/);
          const prefixHash = prefixMatch ? (getDJB2Hash(prefixMatch[1]!) as u32) : 0;
          code += `  {\n`;
          code += `    let __invOut_bwd_${idx}_${cIdx} = graph.model.getProperty<u32>(targetNodeId, ${tgtPropHash} as u32);\n`;
          code += `    let __invId_bwd_${idx}_${cIdx}: u32 = __invOut_bwd_${idx}_${cIdx} != 0 ? (__invOut_bwd_${idx}_${cIdx} ^ (${prefixHash} as u32)) : 0;\n`;
          code += `    graph.model.setProperty<u32>(sourceNodeId, ${srcPropHash} as u32, __invId_bwd_${idx}_${cIdx});\n`;
          code += `  }\n`;
        } else {
          const tgtVarIdent = `__invTgt_bwd_${idx}_${cIdx}`;
          const asBwdExpr = compileAlgebraicExprToAS(effectiveBwd, tgtVarIdent);
          code += `  {\n`;
          code += `    let ${tgtVarIdent} = graph.model.getProperty<f64>(targetNodeId, ${tgtPropHash} as u32);\n`;
          code += `    let __invSrc_bwd_${idx}_${cIdx}: f64 = ${asBwdExpr};\n`;
          code += `    graph.model.setProperty<f64>(sourceNodeId, ${srcPropHash} as u32, __invSrc_bwd_${idx}_${cIdx});\n`;
          code += `  }\n`;
        }
      } else if (c.kind === "exprMap") {
        const [srcExpr, tgtExpr, _dialect] = c.args;
        const srcProp = findBoundProperty(srcBindings, srcExpr, stripVarPrefix(srcExpr));
        const tgtProp = findBoundProperty(tgtBindings, tgtExpr, stripVarPrefix(tgtExpr));
        const srcPropHash = getDJB2Hash(srcProp) as u32;
        const tgtPropHash = getDJB2Hash(tgtProp) as u32;
        code += `  let __exprVal_bwd_${idx}_${cIdx} = graph.model.getProperty<u32>(targetNodeId, ${tgtPropHash} as u32);\n`;
        code += `  if (__exprVal_bwd_${idx}_${cIdx} != 0) {\n`;
        code += `    graph.model.setProperty<u32>(sourceNodeId, ${srcPropHash} as u32, __exprVal_bwd_${idx}_${cIdx});\n`;
        code += `  }\n`;
      } else if (c.kind === "physicalPort") {
        const [acrossVar, flowVar] = c.args;
        const srcAcrossProp = findBoundProperty(srcBindings, acrossVar, stripVarPrefix(acrossVar));
        const tgtAcrossProp = findBoundProperty(tgtBindings, acrossVar, stripVarPrefix(acrossVar));
        const srcFlowProp = findBoundProperty(srcBindings, flowVar, stripVarPrefix(flowVar));
        const tgtFlowProp = findBoundProperty(tgtBindings, flowVar, stripVarPrefix(flowVar));
        code += `  let __acrossVal_bwd_${idx} = graph.model.getProperty<u32>(targetNodeId, ${getDJB2Hash(tgtAcrossProp)} as u32);\n`;
        code += `  if (__acrossVal_bwd_${idx} != 0) graph.model.setProperty<u32>(sourceNodeId, ${getDJB2Hash(srcAcrossProp)} as u32, __acrossVal_bwd_${idx});\n`;
        code += `  let __flowVal_bwd_${idx} = graph.model.getProperty<u32>(targetNodeId, ${getDJB2Hash(tgtFlowProp)} as u32);\n`;
        code += `  if (__flowVal_bwd_${idx} != 0) graph.model.setProperty<u32>(sourceNodeId, ${getDJB2Hash(srcFlowProp)} as u32, __flowVal_bwd_${idx});\n`;
      } else if (c.kind === "typeMap") {
        const [sourceVar, targetVar, mapKey] = c.args;
        const srcProp = findBoundProperty(srcBindings, sourceVar, "type");
        const tgtProp = findBoundProperty(tgtBindings, targetVar, "type");
        const srcPropHash = getDJB2Hash(srcProp) as u32;
        const tgtPropHash = getDJB2Hash(tgtProp) as u32;
        const mapObj: Record<string, string> | undefined =
          typeof mapKey === "string"
            ? _typeMaps[mapKey]
            : typeof mapKey === "object" && mapKey !== null
              ? (mapKey as Record<string, string>)
              : undefined;
        code += `  let __tgtType_bwd_${idx}_${cIdx} = graph.model.getProperty<u32>(targetNodeId, ${tgtPropHash} as u32);\n`;
        code += `  let __mappedType_bwd_${idx}_${cIdx} = __tgtType_bwd_${idx}_${cIdx};\n`;
        if (mapObj) {
          for (const [k, v] of Object.entries(mapObj)) {
            code += `  if (__tgtType_bwd_${idx}_${cIdx} == ${getDJB2Hash(String(v))} as u32) __mappedType_bwd_${idx}_${cIdx} = ${getDJB2Hash(k)} as u32;\n`;
          }
        }
        code += `  graph.model.setProperty<u32>(sourceNodeId, ${srcPropHash} as u32, __mappedType_bwd_${idx}_${cIdx});\n`;
      }
    }

    code += `  let corrSlot = corr.addLink(sourceNodeId, targetNodeId, ${idx}, CORR_FLAG_SYNCED, 0, parentSlot);\n`;
    if (compFields.length > 0) {
      code += `  // Restore preserved shadow complement fiber from linear memory\n`;
      code += `  let targetSlotPlusOne = corr.targetToSlot.get(targetNodeId as u64);\n`;
      code += `  if (targetSlotPlusOne != 0) {\n`;
      code += `    let compPtr = corr.getComplement((targetSlotPlusOne - 1) as u32);\n`;
      code += `    if (compPtr != 0) {\n`;
      for (let fIdx = 0; fIdx < compFields.length; fIdx++) {
        code += `      let compHash_${fIdx} = load<u32>((compPtr as usize) + ${fIdx * 8});\n`;
        code += `      let compVal_${fIdx} = load<u32>((compPtr as usize) + ${fIdx * 8 + 4});\n`;
        code += `      graph.model.setProperty<u32>(sourceNodeId, compHash_${fIdx}, compVal_${fIdx});\n`;
      }
      code += `    }\n`;
      code += `  }\n`;
    }
    code += `  return sourceNodeId;\n`;
    code += `}\n\n`;

    // Retraction (DBSP negative delta)
    code += `// --- Rule ${idx}: ${ruleName} (Retract) ---\n`;
    code += `export function tgg_retract_${ruleName}(sourceNodeId: u32, corr: CorrespondenceIndex, arena: PolyglotArena): u32 {\n`;
    code += `  if (sourceNodeId == 0) return 0;\n`;
    code += `  let targetNodeId = corr.retractBySource(sourceNodeId);\n`;
    code += `  return targetNodeId;\n`;
    code += `}\n\n`;

    // Determine reconciliation properties for this rule
    const recPhysConstraint = constraints.find((c) => c.kind === "reconcilePhysics");
    const recConstraint = constraints.find((c) => c.kind === "reconcile");
    const activeRecArgs = recPhysConstraint?.args || recConstraint?.args;
    const defaultSrcPropName = Object.keys(srcBindings)[0] || "value";
    const defaultTgtPropName = Object.keys(tgtBindings)[0] || "value";
    const recSrcPropName = activeRecArgs
      ? findBoundProperty(srcBindings, activeRecArgs[0], defaultSrcPropName)
      : defaultSrcPropName;
    const recTgtPropName = activeRecArgs
      ? findBoundProperty(tgtBindings, activeRecArgs[1], defaultTgtPropName)
      : defaultTgtPropName;
    const recSrcPropHash = getDJB2Hash(recSrcPropName) as u32;
    const recTgtPropHash = getDJB2Hash(recTgtPropName) as u32;
    const physBounds = recPhysConstraint?.args?.[2] || { min: 0, max: 1000 };
    const physMinStr = formatFloatLiteral(physBounds.min ?? 0);
    const physMaxStr = formatFloatLiteral(physBounds.max ?? 1000);

    ruleReconcileMeta.push({
      srcPropHash: recSrcPropHash,
      tgtPropHash: recTgtPropHash,
      hasPhysBounds: Boolean(recPhysConstraint),
      minStr: physMinStr,
      maxStr: physMaxStr,
    });

    // Incremental propagation
    code += `// --- Rule ${idx}: ${ruleName} (Incremental Propagate) ---\n`;
    code += `export function tgg_propagate_${ruleName}(slot: u32, corr: CorrespondenceIndex): void {\n`;
    code += `  let sourceNodeId = corr.getSource(slot);\n`;
    code += `  let targetNodeId = corr.getTarget(slot);\n`;
    code += `  if (sourceNodeId == 0 || targetNodeId == 0) return;\n`;
    code += `  \n`;
    code += `  // If slot is marked removed, do not propagate further\n`;
    code += `  if (corr.isRemoved(slot)) return;\n`;
    code += `  \n`;
    code += `  // If slot is conflicted, attempt reconciliation before propagating\n`;
    code += `  if (corr.isConflicted(slot)) {\n`;
    if (recPhysConstraint) {
      code += `    let __srcVal = graph.model.getProperty<f64>(sourceNodeId, ${recSrcPropHash} as u32);\n`;
      code += `    let __tgtVal = graph.model.getProperty<f64>(targetNodeId, ${recTgtPropHash} as u32);\n`;
      code += `    let __recVal = tgg_reconcile_physics_simplex(slot, __srcVal, __tgtVal, ${physMinStr}, ${physMaxStr}, corr);\n`;
      code += `    if (corr.isConflicted(slot)) return;\n`;
      code += `    graph.model.setProperty<f64>(sourceNodeId, ${recSrcPropHash} as u32, __recVal);\n`;
      code += `    graph.model.setProperty<f64>(targetNodeId, ${recTgtPropHash} as u32, __recVal);\n`;
    } else if (recConstraint) {
      const strat = recConstraint.args[2] || "smt-simplex";
      const stratNum =
        strat === "source-wins"
          ? 1
          : strat === "target-wins"
            ? 2
            : strat === "prefer-narrower-range"
              ? 3
              : strat === "physics-simplex"
                ? 4
                : 0;
      code += `    let __srcVal = graph.model.getProperty<f64>(sourceNodeId, ${recSrcPropHash} as u32);\n`;
      code += `    let __tgtVal = graph.model.getProperty<f64>(targetNodeId, ${recTgtPropHash} as u32);\n`;
      code += `    let __recVal = tgg_reconcile_scalar(slot, __srcVal, __tgtVal, ${stratNum}, corr);\n`;
      code += `    if (corr.isConflicted(slot)) return;\n`;
      code += `    graph.model.setProperty<f64>(sourceNodeId, ${recSrcPropHash} as u32, __recVal);\n`;
      code += `    graph.model.setProperty<f64>(targetNodeId, ${recTgtPropHash} as u32, __recVal);\n`;
    } else {
      code += `    return;\n`;
    }
    code += `  }\n`;
    code += `  \n`;
    code += `  // Reset STALE flag\n`;
    code += `  corr.addLink(sourceNodeId, targetNodeId, ${idx}, CORR_FLAG_SYNCED, 0);\n`;
    code += `}\n\n`;
  }

  // Generate Master Dispatchers
  code += `// ============================================================================\n`;
  code += `// TGG Dispatch Tables (Language-Scoped & Collision-Free)\n`;
  code += `// ============================================================================\n\n`;

  // Group by sourceNodeHash
  const rulesBySourceHash = new Map<number, typeof activeRules>();
  for (const r of activeRules) {
    if (!rulesBySourceHash.has(r.sourceNodeHash)) {
      rulesBySourceHash.set(r.sourceNodeHash, []);
    }
    rulesBySourceHash.get(r.sourceNodeHash)!.push(r);
  }

  code += `export function tgg_forward_dispatch(sourceNodeTypeHash: u32, sourceNodeId: u32, corr: CorrespondenceIndex, arena: PolyglotArena, targetLangId: u16 = 0, parentSlot: u32 = 0xFFFFFFFF): u32 {\n`;
  code += `  switch (sourceNodeTypeHash) {\n`;
  for (const [srcHash, group] of rulesBySourceHash.entries()) {
    group.sort((a, b) => b.priority - a.priority);
    code += `    case ${srcHash}: {\n`;
    if (group.length === 1) {
      code += `      return tgg_forward_${group[0]!.ruleName}(sourceNodeId, corr, arena, parentSlot);\n`;
    } else {
      for (const r of group) {
        if (r.targetLang) {
          const langId = getDJB2Hash(r.targetLang) & 0xffff;
          code += `      if (targetLangId == 0 || targetLangId == ${langId}) {\n`;
          code += `        let res_${r.rIdx} = tgg_forward_${r.ruleName}(sourceNodeId, corr, arena, parentSlot);\n`;
          code += `        if (res_${r.rIdx} != 0) return res_${r.rIdx};\n`;
          code += `      }\n`;
        } else {
          code += `      {\n`;
          code += `        let res_${r.rIdx} = tgg_forward_${r.ruleName}(sourceNodeId, corr, arena, parentSlot);\n`;
          code += `        if (res_${r.rIdx} != 0) return res_${r.rIdx};\n`;
          code += `      }\n`;
        }
      }
      code += `      return 0;\n`;
    }
    code += `    }\n`;
  }
  code += `    default: return 0;\n`;
  code += `  }\n`;
  code += `}\n\n`;

  // Group by targetNodeHash
  const rulesByTargetHash = new Map<number, typeof activeRules>();
  for (const r of activeRules) {
    if (!rulesByTargetHash.has(r.targetNodeHash)) {
      rulesByTargetHash.set(r.targetNodeHash, []);
    }
    rulesByTargetHash.get(r.targetNodeHash)!.push(r);
  }

  code += `export function tgg_backward_dispatch(targetNodeTypeHash: u32, targetNodeId: u32, corr: CorrespondenceIndex, arena: PolyglotArena, sourceLangId: u16 = 0, parentSlot: u32 = 0xFFFFFFFF): u32 {\n`;
  code += `  switch (targetNodeTypeHash) {\n`;
  for (const [tgtHash, group] of rulesByTargetHash.entries()) {
    group.sort((a, b) => b.priority - a.priority);
    code += `    case ${tgtHash}: {\n`;
    if (group.length === 1) {
      code += `      return tgg_backward_${group[0]!.ruleName}(targetNodeId, corr, arena, parentSlot);\n`;
    } else {
      for (const r of group) {
        if (r.sourceLang) {
          const langId = getDJB2Hash(r.sourceLang) & 0xffff;
          code += `      if (sourceLangId == 0 || sourceLangId == ${langId}) {\n`;
          code += `        let res_bwd_${r.rIdx} = tgg_backward_${r.ruleName}(targetNodeId, corr, arena, parentSlot);\n`;
          code += `        if (res_bwd_${r.rIdx} != 0) return res_bwd_${r.rIdx};\n`;
          code += `      }\n`;
        } else {
          code += `      {\n`;
          code += `        let res_bwd_${r.rIdx} = tgg_backward_${r.ruleName}(targetNodeId, corr, arena, parentSlot);\n`;
          code += `        if (res_bwd_${r.rIdx} != 0) return res_bwd_${r.rIdx};\n`;
          code += `      }\n`;
        }
      }
      code += `      return 0;\n`;
    }
    code += `    }\n`;
  }
  code += `    default: return 0;\n`;
  code += `  }\n`;
  code += `}\n\n`;

  code += `export function tgg_retract_dispatch(sourceNodeTypeHash: u32, sourceNodeId: u32, corr: CorrespondenceIndex, arena: PolyglotArena): u32 {\n`;
  code += `  switch (sourceNodeTypeHash) {\n`;
  for (const [srcHash, group] of rulesBySourceHash.entries()) {
    code += `    case ${srcHash}: return tgg_retract_${group[0]!.ruleName}(sourceNodeId, corr, arena);\n`;
  }
  code += `    default: return 0;\n`;
  code += `  }\n`;
  code += `}\n\n`;

  code += `export function tgg_propagate_all_stale(corr: CorrespondenceIndex): u32 {\n`;
  code += `  let updatedCount: u32 = 0;\n`;
  code += `  for (let slot: u32 = 0; slot < corr.count; slot++) {\n`;
  code += `    if (corr.isStale(slot) && !corr.isRemoved(slot)) {\n`;
  code += `      let ruleId = corr.getRule(slot);\n`;
  code += `      switch (ruleId) {\n`;
  for (let rIdx = 0; rIdx < activeRules.length; rIdx++) {
    const ruleName = activeRules[rIdx]!.ruleName;
    code += `        case ${rIdx}: tgg_propagate_${ruleName}(slot, corr); updatedCount++; break;\n`;
  }
  code += `        default: break;\n`;
  code += `      }\n`;
  code += `    }\n`;
  code += `  }\n`;
  code += `  return updatedCount;\n`;
  code += `}\n\n`;

  const fallbackPropHash = getDJB2Hash("value") as u32;
  code += `export function tgg_reconcile_all_conflicts(corr: CorrespondenceIndex, strategy: u32 = 0): u32 {\n`;
  code += `  let resolvedCount: u32 = 0;\n`;
  code += `  for (let slot: u32 = 0; slot < corr.count; slot++) {\n`;
  code += `    if (corr.isConflicted(slot) && !corr.isRemoved(slot)) {\n`;
  code += `      let sourceNodeId = corr.getSource(slot);\n`;
  code += `      let targetNodeId = corr.getTarget(slot);\n`;
  code += `      let ruleId = corr.getRule(slot);\n`;
  code += `      let srcPropHash: u32 = ${fallbackPropHash} as u32;\n`;
  code += `      let tgtPropHash: u32 = ${fallbackPropHash} as u32;\n`;
  if (ruleReconcileMeta.length > 0) {
    code += `      switch (ruleId) {\n`;
    for (let rIdx = 0; rIdx < ruleReconcileMeta.length; rIdx++) {
      const rm = ruleReconcileMeta[rIdx]!;
      code += `        case ${rIdx}: srcPropHash = ${rm.srcPropHash} as u32; tgtPropHash = ${rm.tgtPropHash} as u32; break;\n`;
    }
    code += `        default: break;\n`;
    code += `      }\n`;
  }
  code += `      let srcVal = sourceNodeId != 0 ? graph.model.getProperty<f64>(sourceNodeId, srcPropHash) : 0.0;\n`;
  code += `      let tgtVal = targetNodeId != 0 ? graph.model.getProperty<f64>(targetNodeId, tgtPropHash) : 0.0;\n`;
  code += `      let recVal = tgg_reconcile_scalar(slot, srcVal, tgtVal, strategy, corr);\n`;
  code += `      if (!corr.isConflicted(slot)) {\n`;
  code += `        if (sourceNodeId != 0) graph.model.setProperty<f64>(sourceNodeId, srcPropHash, recVal);\n`;
  code += `        if (targetNodeId != 0) graph.model.setProperty<f64>(targetNodeId, tgtPropHash, recVal);\n`;
  code += `        resolvedCount++;\n`;
  code += `      }\n`;
  code += `    }\n`;
  code += `  }\n`;
  code += `  return resolvedCount;\n`;
  code += `}\n`;

  return {
    sourceCode: code,
    ruleCount: activeRules.length,
    ruleNames,
    cpaReport,
    losslessnessReport,
  };
}
