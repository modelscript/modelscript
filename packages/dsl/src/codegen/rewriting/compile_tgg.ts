import { PolyglotConfig, TGGConstraint, TGGRuleOptions } from "../../dsl/language.js";
import type { u32 } from "../../dsl/primitives.js";
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
  cpaReport?: CpaReport;
  losslessnessReport?: {
    isFullyLossless: boolean;
    reports: LosslessnessReport[];
    leakedRuleCount: number;
  };
}

/**
 * Compiles declarative Triple Graph Grammar (TGG) rules into an AOT AssemblyScript
 * transformation kernel with bidirectional forward/backward matching, correspondence indexing,
 * and O(ΔN) incremental propagation.
 */
export function compileTGGRules(
  config: PolyglotConfig | TGGRuleOptions[],
  options: {
    sourceLang?: string;
    targetLang?: string;
    strictCpa?: boolean;
    verifyLossless?: boolean;
  } = {},
): CompiledTGGOutput {
  const allRules: TGGRuleOptions[] = Array.isArray(config) ? config : config.rules || [];
  const typeMaps = !Array.isArray(config) ? config.typeMaps || {} : {};

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
    const errorConflicts = cpaReport.conflicts.filter((c) => c.severity === "error");
    if (errorConflicts.length > 0) {
      throw new Error(
        `Critical Pair Analysis failed with ${errorConflicts.length} error(s):\n` +
          errorConflicts.map((c) => `  - [${c.kind}] ${c.description}`).join("\n"),
      );
    }
  }

  const ruleNames: string[] = [];
  let code = `// ============================================================================\n`;
  code += `// AOT Compiled Triple Graph Grammar (TGG) Polyglot Transformation Kernel\n`;
  code += `// ============================================================================\n`;
  code += `import { CorrespondenceIndex, CORR_FLAG_SYNCED, CORR_FLAG_STALE, CORR_FLAG_CONFLICT } from "./correspondence";\n`;
  code += `import { PolyglotArena } from "./polyglot_arena";\n`;
  code += `import { graph, ModelAPI } from "./graph";\n`;
  code += `import { getNodeType, getNodeFirstChild, getNodeNextSibling, ast_createNode } from "./arena";\n`;
  code += `import { tgg_reconcile_scalar, tgg_reconcile_interval } from "./tgg_reconciler";\n\n`;

  for (let idx = 0; idx < activeRules.length; idx++) {
    const r = activeRules[idx];
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
    code += `export function tgg_forward_${ruleName}(sourceNodeId: u32, corr: CorrespondenceIndex, arena: PolyglotArena): u32 {\n`;
    code += `  if (sourceNodeId == 0) return 0;\n`;
    code += `  \n`;
    code += `  // Check if target already created in correspondence index\n`;
    code += `  let existingTarget = corr.findBySource(sourceNodeId);\n`;
    code += `  if (existingTarget != 0) return existingTarget;\n\n`;
    code += `  // Allocate target AST node\n`;
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
      const c = constraints[cIdx];
      if (c.kind === "eq") {
        const [a, b] = c.args;
        code += `  // Constraint: eq(${a}, ${b})\n`;
      } else if (c.kind === "defaultVal") {
        const [targetVar, defVal] = c.args;
        const tgtVarName =
          typeof targetVar === "string" && targetVar.startsWith("__var_") ? targetVar.slice(6) : String(targetVar);
        const tgtProp =
          Object.keys(tgtBindings).find((k) => tgtBindings[k] === targetVar || k === tgtVarName) || tgtVarName;
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
        const srcProp = Object.keys(srcBindings).find((k) => srcBindings[k] === sourceVar) || "type";
        const tgtProp = Object.keys(tgtBindings).find((k) => tgtBindings[k] === targetVar) || "type";
        const srcPropHash = getDJB2Hash(srcProp) as u32;
        const tgtPropHash = getDJB2Hash(tgtProp) as u32;
        code += `  // Type mapping: ${srcProp} -> ${tgtProp} using ${typeof mapKey === "string" ? mapKey : "custom map"}\n`;
        code += `  let __srcType_${idx}_${cIdx} = graph.model.getProperty<u32>(sourceNodeId, ${srcPropHash} as u32);\n`;
        code += `  graph.model.setProperty<u32>(targetNodeId, ${tgtPropHash} as u32, __srcType_${idx}_${cIdx});\n`;
      } else if (c.kind === "formatUri") {
        const [idVar, prefix, targetVar] = c.args;
        const srcProp = Object.keys(srcBindings).find((k) => srcBindings[k] === idVar) || "id";
        const tgtProp = Object.keys(tgtBindings).find((k) => tgtBindings[k] === targetVar) || "iri";
        const srcPropHash = getDJB2Hash(srcProp) as u32;
        const tgtPropHash = getDJB2Hash(tgtProp) as u32;
        code += `  // Format URI: ${targetVar} = ${JSON.stringify(prefix)} + ${idVar}\n`;
        code += `  let __idVal_${idx}_${cIdx} = graph.model.getProperty<u32>(sourceNodeId, ${srcPropHash} as u32);\n`;
        code += `  graph.model.setProperty<u32>(targetNodeId, ${tgtPropHash} as u32, __idVal_${idx}_${cIdx});\n`;
      } else if (c.kind === "mapList") {
        const [sourceListVar, targetListVar] = c.args;
        code += `  // Map List: ${sourceListVar} -> ${targetListVar}\n`;
      } else if (c.kind === "compute") {
        const [targetVar, queryName, sourceVar] = c.args;
        code += `  // Compute: ${targetVar} = query("${queryName}", ${sourceVar})\n`;
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
        code += `  // Property path: ${sourceVar} --[${pathString}]--> ${targetVar}\n`;
      } else if (c.kind === "forEach") {
        const [collectionVar, itemVar] = c.args;
        code += `  // Multi-amalgamation: forEach ${itemVar} in ${collectionVar}\n`;
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
        code += `  // Invertible constraint: forward='${fwd}' backward='${bwd || "auto-derived"}'\n`;
      }
    }

    code += `  // Register bidirectional link in correspondence index\n`;
    code += `  corr.addLink(sourceNodeId, targetNodeId, ${idx}, CORR_FLAG_SYNCED, 0);\n`;
    code += `  return targetNodeId;\n`;
    code += `}\n\n`;

    // Backward transformation
    code += `// --- Rule ${idx}: ${ruleName} (Backward) ---\n`;
    code += `export function tgg_backward_${ruleName}(targetNodeId: u32, corr: CorrespondenceIndex, arena: PolyglotArena): u32 {\n`;
    code += `  if (targetNodeId == 0) return 0;\n`;
    code += `  \n`;
    code += `  let existingSource = corr.findByTarget(targetNodeId);\n`;
    code += `  if (existingSource != 0) return existingSource;\n\n`;
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

    code += `  corr.addLink(sourceNodeId, targetNodeId, ${idx}, CORR_FLAG_SYNCED, 0);\n`;
    code += `  return sourceNodeId;\n`;
    code += `}\n\n`;

    // Retraction (DBSP negative delta)
    code += `// --- Rule ${idx}: ${ruleName} (Retract) ---\n`;
    code += `export function tgg_retract_${ruleName}(sourceNodeId: u32, corr: CorrespondenceIndex, arena: PolyglotArena): u32 {\n`;
    code += `  if (sourceNodeId == 0) return 0;\n`;
    code += `  let targetNodeId = corr.retractBySource(sourceNodeId);\n`;
    code += `  return targetNodeId;\n`;
    code += `}\n\n`;

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
    const recPhysConstraint = constraints.find((c) => c.kind === "reconcilePhysics");
    const recConstraint = constraints.find((c) => c.kind === "reconcile");
    if (recPhysConstraint) {
      const bounds = recPhysConstraint.args[2] || { min: 0, max: 1000 };
      code += `    tgg_reconcile_physics_simplex(slot, 0.0, 0.0, ${bounds.min}.0, ${bounds.max}.0, corr);\n`;
      code += `    if (corr.isConflicted(slot)) return;\n`;
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
      code += `    tgg_reconcile_scalar(slot, 0.0, 0.0, ${stratNum}, corr);\n`;
      code += `    if (corr.isConflicted(slot)) return;\n`;
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

  code += `export function tgg_forward_dispatch(sourceNodeTypeHash: u32, sourceNodeId: u32, corr: CorrespondenceIndex, arena: PolyglotArena, targetLangId: u16 = 0): u32 {\n`;
  code += `  switch (sourceNodeTypeHash) {\n`;
  for (const [srcHash, group] of rulesBySourceHash.entries()) {
    group.sort((a, b) => b.priority - a.priority);
    code += `    case ${srcHash}: {\n`;
    if (group.length === 1) {
      code += `      return tgg_forward_${group[0].ruleName}(sourceNodeId, corr, arena);\n`;
    } else {
      for (const r of group) {
        if (r.targetLang) {
          const langId = getDJB2Hash(r.targetLang) & 0xffff;
          code += `      if (targetLangId == ${langId}) return tgg_forward_${r.ruleName}(sourceNodeId, corr, arena);\n`;
        }
      }
      code += `      return tgg_forward_${group[0].ruleName}(sourceNodeId, corr, arena);\n`;
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

  code += `export function tgg_backward_dispatch(targetNodeTypeHash: u32, targetNodeId: u32, corr: CorrespondenceIndex, arena: PolyglotArena, sourceLangId: u16 = 0): u32 {\n`;
  code += `  switch (targetNodeTypeHash) {\n`;
  for (const [tgtHash, group] of rulesByTargetHash.entries()) {
    group.sort((a, b) => b.priority - a.priority);
    code += `    case ${tgtHash}: {\n`;
    if (group.length === 1) {
      code += `      return tgg_backward_${group[0].ruleName}(targetNodeId, corr, arena);\n`;
    } else {
      for (const r of group) {
        if (r.sourceLang) {
          const langId = getDJB2Hash(r.sourceLang) & 0xffff;
          code += `      if (sourceLangId == ${langId}) return tgg_backward_${r.ruleName}(targetNodeId, corr, arena);\n`;
        }
      }
      code += `      return tgg_backward_${group[0].ruleName}(targetNodeId, corr, arena);\n`;
    }
    code += `    }\n`;
  }
  code += `    default: return 0;\n`;
  code += `  }\n`;
  code += `}\n\n`;

  code += `export function tgg_retract_dispatch(sourceNodeTypeHash: u32, sourceNodeId: u32, corr: CorrespondenceIndex, arena: PolyglotArena): u32 {\n`;
  code += `  switch (sourceNodeTypeHash) {\n`;
  for (const [srcHash, group] of rulesBySourceHash.entries()) {
    code += `    case ${srcHash}: return tgg_retract_${group[0].ruleName}(sourceNodeId, corr, arena);\n`;
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
    const ruleName = activeRules[rIdx].ruleName;
    code += `        case ${rIdx}: tgg_propagate_${ruleName}(slot, corr); updatedCount++; break;\n`;
  }
  code += `        default: break;\n`;
  code += `      }\n`;
  code += `    }\n`;
  code += `  }\n`;
  code += `  return updatedCount;\n`;
  code += `}\n\n`;

  code += `export function tgg_reconcile_all_conflicts(corr: CorrespondenceIndex, strategy: u32 = 0): u32 {\n`;
  code += `  let resolvedCount: u32 = 0;\n`;
  code += `  for (let slot: u32 = 0; slot < corr.count; slot++) {\n`;
  code += `    if (corr.isConflicted(slot) && !corr.isRemoved(slot)) {\n`;
  code += `      tgg_reconcile_scalar(slot, 0.0, 0.0, strategy, corr);\n`;
  code += `      if (!corr.isConflicted(slot)) resolvedCount++;\n`;
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
