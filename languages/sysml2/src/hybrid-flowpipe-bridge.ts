// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sysml2 — Hybrid Flowpipe Reachability Bridge.
 *
 * Bridges SysML v2 state machine definitions and continuous dynamics with
 * @modelscript/runtime's validated HybridFlowpipeSolver (Taylor models,
 * Householder QR coordinate rotations, and Interval Newton guard root-finding).
 */

import type {
  ArenaEvalEnv,
  HybridAutomaton,
  HybridFlowpipeResult,
  HybridMode,
  HybridTransition,
  VerificationVerdict,
} from "@modelscript/runtime";
import {
  evalArenaExpr,
  ExprKind,
  HybridFlowpipeSolver,
  Interval,
  TaylorDomain,
  TaylorModel,
  ZonotopeReachabilitySolver,
} from "@modelscript/runtime";
import { SysML2DaeLowerer } from "./sysml2-dae-lowerer.js";

export interface HybridReachabilityBridgeOptions {
  modelName?: string | undefined;
  sourceText?: string | undefined;
  timeSpan?: string | [number, number] | undefined;
  dt?: number | undefined;
  order?: number | undefined;
  minOrder?: number | undefined;
  maxOrder?: number | undefined;
  adaptive?: boolean | undefined;
  tol?: number | undefined;
  reachabilityEngine?: "taylor" | "zonotope" | undefined;
  useConstrainedZonotopes?: boolean | undefined;
  maxConstrainedGenerators?: number | undefined;
  linearMatrixA?: number[][] | undefined;
  linearMatrixB?: number[][] | undefined;
}

export interface HybridReachabilityBridgeResult {
  isCertifiedSafe: boolean;
  verdict: VerificationVerdict;
  modelName: string;
  totalSteps: number;
  jumpCount: number;
  segments: {
    modeId: string;
    modeName?: string | undefined;
    startTime: number;
    endTime: number;
    stepCount: number;
  }[];
  jumps: {
    transitionId: string;
    sourceModeId: string;
    targetModeId: string;
    time: number;
    preJumpEnclosure: { lo: number; hi: number }[];
    postJumpEnclosure: { lo: number; hi: number }[];
    preJumpNominal: number[];
    postJumpNominal: number[];
  }[];
  violations: {
    stepIndex: number;
    time: number;
    stateIndex: number;
    operator: string;
    worstCaseValue: number;
    limitValue: number;
    reason: string;
  }[];
  summary: string;
}

function buildBenchmarkThermostatAutomaton(order: number): {
  modes: HybridMode[];
  transitions: HybridTransition[];
} {
  const heatingMode: HybridMode = {
    id: "Heating",
    name: "Heating Phase",
    dynamics: (_t: TaylorModel, y: TaylorModel[]) => {
      const const3 = TaylorModel.constant(3.0, y[0]!.numVars, y[0]!.domain, order);
      const decr = y[0]!.scale(-0.1);
      return [const3.add(decr)];
    },
  };

  const coolingMode: HybridMode = {
    id: "Cooling",
    name: "Cooling Phase",
    dynamics: (_t: TaylorModel, y: TaylorModel[]) => {
      const const1 = TaylorModel.constant(1.0, y[0]!.numVars, y[0]!.domain, order);
      const decr = y[0]!.scale(-0.1);
      return [const1.add(decr)];
    },
  };

  const transitions: HybridTransition[] = [
    {
      id: "HeatToCool",
      sourceModeId: "Heating",
      targetModeId: "Cooling",
      guard: (y: TaylorModel[]) => {
        const const22 = TaylorModel.constant(22.0, y[0]!.numVars, y[0]!.domain, order);
        return const22.sub(y[0]!);
      },
      guardPoint: (pt: number[]) => 22.0 - pt[0]!,
      reset: (preState: Interval[]) => [new Interval(preState[0]!.lo, preState[0]!.hi)],
      resetPoint: (pt: number[]) => [pt[0]!],
      label: "TurnOffHeater",
    },
    {
      id: "CoolToHeat",
      sourceModeId: "Cooling",
      targetModeId: "Heating",
      guard: (y: TaylorModel[]) => {
        const const18 = TaylorModel.constant(18.0, y[0]!.numVars, y[0]!.domain, order);
        return y[0]!.sub(const18);
      },
      guardPoint: (pt: number[]) => pt[0]! - 18.0,
      reset: (preState: Interval[]) => [new Interval(preState[0]!.lo, preState[0]!.hi)],
      resetPoint: (pt: number[]) => [pt[0]!],
      label: "TurnOnHeater",
    },
  ];

  return { modes: [heatingMode, coolingMode], transitions };
}

function buildHybridModeFromLoweredDae(
  modeId: string,
  lowered: Awaited<ReturnType<typeof SysML2DaeLowerer.lowerConstraint>>,
  defaultOrder: number,
): HybridMode {
  const diffEquations = new Map<string, number>();
  for (let eqIdx = 0; eqIdx < lowered.arena.eqCount; eqIdx++) {
    const lhs = lowered.arena.getEqLhs(eqIdx);
    const rhs = lowered.arena.getEqRhs(eqIdx);
    if (lowered.arena.getExprKind(lhs) === ExprKind.Der) {
      const inner = lowered.arena.getExprData1(lhs);
      if (lowered.arena.getExprKind(inner) === ExprKind.Name) {
        const nameId = lowered.arena.getExprData1(inner);
        const varName = lowered.arena.interner.resolve(nameId) || "";
        diffEquations.set(varName, rhs);
        diffEquations.set(varName.split("::").pop()!, rhs);
      }
    } else if (lowered.arena.getExprKind(rhs) === ExprKind.Der) {
      const inner = lowered.arena.getExprData1(rhs);
      if (lowered.arena.getExprKind(inner) === ExprKind.Name) {
        const nameId = lowered.arena.getExprData1(inner);
        const varName = lowered.arena.interner.resolve(nameId) || "";
        diffEquations.set(varName, lhs);
        diffEquations.set(varName.split("::").pop()!, lhs);
      }
    }
  }

  return {
    id: modeId,
    name: `${modeId} Phase`,
    dynamics: (_t: TaylorModel, y: TaylorModel[]) => {
      if (y.length === 0) return [];
      const domainBoxes = y[0]!.domain;
      const currentOrder = y[0]!.order ?? defaultOrder;
      const domain = new TaylorDomain(domainBoxes, currentOrder);

      const stateNames = lowered.states.length > 0 ? lowered.states : ["x"];
      const stateIndexMap = new Map<string, number>();
      for (let idx = 0; idx < stateNames.length; idx++) {
        const sn = stateNames[idx]!;
        stateIndexMap.set(sn, idx);
        stateIndexMap.set(sn.split("::").pop()!, idx);
      }

      const env: ArenaEvalEnv<TaylorModel> = {
        variable: (varIdx: number, _name: string) => {
          const vName = lowered.arena.getVarName(varIdx);
          const shortName = vName.split("::").pop() || vName;
          const sIdx = stateIndexMap.get(vName) ?? stateIndexMap.get(shortName);
          if (sIdx !== undefined && sIdx < y.length && y[sIdx]) {
            return y[sIdx]!;
          }
          const startVal = lowered.arena.getVarStartValue(varIdx);
          return domain.constant(isNaN(startVal) ? 0 : startVal);
        },
        derivative: () => domain.constant(0),
      };

      const derivativesOut: TaylorModel[] = [];
      for (let i = 0; i < stateNames.length; i++) {
        const sName = stateNames[i]!;
        const rhsExprId = diffEquations.get(sName) ?? diffEquations.get(sName.split("::").pop()!);
        if (rhsExprId !== undefined) {
          try {
            const evalRes = evalArenaExpr<TaylorModel>(lowered.arena, rhsExprId, env, domain);
            if (evalRes && evalRes.value) {
              derivativesOut.push(evalRes.value);
              continue;
            }
          } catch {
            // Fall through to zero derivative
          }
        }
        // State without an explicit derivative equation has zero rate of change (dx/dt = 0)
        derivativesOut.push(domain.constant(0));
      }
      return derivativesOut.length > 0 ? derivativesOut : [domain.constant(0)];
    },
  };
}

/**
 * Executes validated hybrid flowpipe reachability verification for a SysML v2 model.
 */
export async function verifyHybridSysml2Reachability(
  queryDB: any,
  options: HybridReachabilityBridgeOptions = {},
): Promise<HybridReachabilityBridgeResult> {
  const dt = options.dt ?? 0.05;
  const order = options.order ?? 2;
  const adaptive = options.adaptive ?? true;
  const tol = options.tol ?? 1e-4;
  const useQrPreconditioning = (options as any).useQrPreconditioning ?? true;
  const maxJumps = (options as any).maxJumps ?? 16;

  let tSpan: [number, number] = [0, 5];
  if (Array.isArray(options.timeSpan) && options.timeSpan.length === 2) {
    tSpan = options.timeSpan;
  } else if (typeof options.timeSpan === "string") {
    try {
      const parsed = JSON.parse(options.timeSpan);
      if (Array.isArray(parsed) && parsed.length === 2) {
        tSpan = [Number(parsed[0]), Number(parsed[1])];
      }
    } catch {
      // Keep default
    }
  }

  // Discover state machine or component definitions from queryDB
  let targetName = options.modelName || "HybridSystem";
  if (queryDB && typeof queryDB.allEntries === "function") {
    const entries = queryDB.allEntries();
    for (const e of entries) {
      if (e.ruleName === "StateDefinition" || e.ruleName === "PartDefinition") {
        if (!options.modelName || e.name === options.modelName) {
          targetName = e.name || targetName;
          break;
        }
      }
    }
  }

  // Dynamically lower custom state definitions and equations when source text is provided
  const sourceText = options.sourceText || queryDB?.source || (queryDB?.doc?.text ? queryDB.doc.text : "");
  const customModes: HybridMode[] = [];
  if (sourceText) {
    try {
      const stateRegex = /\bstate\s+(?:def\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\{([^}]*)\}/g;
      let sm: RegExpExecArray | null;
      while ((sm = stateRegex.exec(sourceText)) !== null) {
        const stateName = sm[1]!;
        const stateBody = sm[2]!;
        const lowered = await SysML2DaeLowerer.lowerConstraint(`constraint def ${stateName} { ${stateBody} }`);
        if (lowered.derivatives.length > 0) {
          customModes.push(buildHybridModeFromLoweredDae(stateName, lowered, order));
        }
      }
      // If no `state def` blocks had derivatives, check if the model defines continuous ODEs in a constraint/part def
      if (customModes.length === 0) {
        const loweredWhole = await SysML2DaeLowerer.lowerConstraint(sourceText);
        if (loweredWhole.derivatives.length > 0) {
          customModes.push(buildHybridModeFromLoweredDae(targetName, loweredWhole, order));
        }
      }
    } catch {
      // Fallback cleanly to default benchmark modes when no custom dynamics can be lowered
    }
  }

  const benchmark = customModes.length === 0 ? buildBenchmarkThermostatAutomaton(order) : null;
  const modes = customModes.length >= 1 ? customModes : benchmark!.modes;
  const modeIdSet = new Set(modes.map((m) => m.id));
  const validTransitions = benchmark
    ? benchmark.transitions.filter((t) => modeIdSet.has(t.sourceModeId) && modeIdSet.has(t.targetModeId))
    : [];

  if (sourceText && customModes.length >= 2) {
    const transRegex = /\btransition\s+([^;{}]+)/g;
    let tm: RegExpExecArray | null;
    while ((tm = transRegex.exec(sourceText)) !== null) {
      const stmt = tm[1]!.trim();
      const thenParts = stmt.split(/\bthen\s+/);
      if (thenParts.length < 2) continue;
      const leftPart = thenParts[0]!.trim();
      const dstMode = thenParts[1]!.trim().split(/\s+/)[0]!;

      const firstParts = leftPart.split(/\bfirst\s+/);
      if (firstParts.length < 2) continue;
      const rawTransName = firstParts[0]!.trim();
      const afterFirst = firstParts[1]!.trim();

      const ifParts = afterFirst.split(/\bif\s+/);
      const srcMode = ifParts[0]!.trim();
      const guardExpr = (ifParts[1] ?? "").trim();
      const transName = rawTransName || `${srcMode}To${dstMode}`;
      if (!modeIdSet.has(srcMode) || !modeIdSet.has(dstMode)) continue;
      const numMatch = guardExpr.match(/([<>]=?)\s*([+-]?\d+(?:\.\d+)?)/);
      const op = numMatch?.[1] ?? ">=";
      const thresholdVal = numMatch?.[2] !== undefined ? parseFloat(numMatch[2]) : 25.0;
      const isGreater = op.startsWith(">");
      validTransitions.push({
        id: transName,
        sourceModeId: srcMode,
        targetModeId: dstMode,
        guard: (y: TaylorModel[]) => {
          const threshold = TaylorModel.constant(thresholdVal, y[0]!.numVars, y[0]!.domain, order);
          return isGreater ? threshold.sub(y[0]!) : y[0]!.sub(threshold);
        },
        guardPoint: (pt: number[]) => (isGreater ? thresholdVal - pt[0]! : pt[0]! - thresholdVal),
        reset: (preState: Interval[]) => preState.map((iv) => new Interval(iv.lo, iv.hi)),
        resetPoint: (pt: number[]) => [...pt],
        label: transName,
      });
    }
  }

  if (validTransitions.length === 0 && customModes.length >= 2) {
    validTransitions.push({
      id: `${customModes[0]!.id}To${customModes[1]!.id}`,
      sourceModeId: customModes[0]!.id,
      targetModeId: customModes[1]!.id,
      guard: (y: TaylorModel[]) => {
        const threshold = TaylorModel.constant(25.0, y[0]!.numVars, y[0]!.domain, order);
        return threshold.sub(y[0]!);
      },
      guardPoint: (pt: number[]) => 25.0 - pt[0]!,
      reset: (preState: Interval[]) => preState.map((iv) => new Interval(iv.lo, iv.hi)),
      resetPoint: (pt: number[]) => [...pt],
      label: `Switch_${customModes[0]!.id}_to_${customModes[1]!.id}`,
    });
  }

  const automaton: HybridAutomaton = {
    modes,
    transitions: validTransitions,
  };
  const initialModeId =
    (Array.isArray(automaton.modes) ? automaton.modes[0]?.id : automaton.modes.values().next().value?.id) ?? "Heating";

  const initialEnclosure = [new Interval(19.8, 20.2)];
  const nominalInitial = [20.0];

  const extractedReqs: { stateIndex: number; stateName: string; operator: "<=" | ">="; limitValue: number }[] = [];
  if (sourceText) {
    const reqBlockRegex = /\brequirement\s+(?:def\s+)?[A-Za-z_][A-Za-z0-9_]*\s*\{([^}]*)\}/g;
    let rm: RegExpExecArray | null;
    while ((rm = reqBlockRegex.exec(sourceText)) !== null) {
      const body = rm[1]!;
      const boundRegex = /\b([A-Za-z_][A-Za-z0-9_]*)\s*(<=|>=|<|>)\s*([+-]?\d+(?:\.\d+)?)/g;
      let bm: RegExpExecArray | null;
      while ((bm = boundRegex.exec(body)) !== null) {
        const varName = bm[1]!;
        const rawOp = bm[2]!;
        const limitVal = parseFloat(bm[3]!);
        if (!isNaN(limitVal)) {
          extractedReqs.push({
            stateIndex: 0,
            stateName: varName,
            operator: rawOp.startsWith("<") ? "<=" : ">=",
            limitValue: limitVal,
          });
        }
      }
    }
  }
  const activeRequirements =
    extractedReqs.length > 0
      ? extractedReqs
      : [
          { stateIndex: 0, stateName: "temperature", operator: "<=" as const, limitValue: 24.0 },
          { stateIndex: 0, stateName: "temperature", operator: ">=" as const, limitValue: 16.0 },
        ];

  if (options.reachabilityEngine === "zonotope") {
    const A = options.linearMatrixA || [[-0.1]];
    const zResult = ZonotopeReachabilitySolver.solve({
      A,
      B: options.linearMatrixB,
      initialSet: initialEnclosure,
      tSpan,
      dt,
      requirements: activeRequirements.map((r) => ({
        stateIndex: r.stateIndex,
        operator: r.operator,
        limitValue: r.limitValue,
      })),
    });

    const isLinearFallback = !options.linearMatrixA;
    const zVerdict: VerificationVerdict = isLinearFallback
      ? {
          kind: "unknown",
          reason: "unsupported",
          detail: "SysML model did not supply linear dynamics matrix A; executed benchmark linear mode.",
        }
      : zResult.verdict;
    const zCertified = isLinearFallback ? false : zResult.isCertifiedSafe;

    return {
      isCertifiedSafe: zCertified,
      verdict: zVerdict,
      modelName: targetName,
      totalSteps: zResult.totalSteps,
      jumpCount: 0,
      segments: [
        {
          modeId: "LinearZonotopeMode",
          modeName: "Linear Continuous Mode",
          startTime: tSpan[0],
          endTime: tSpan[1],
          stepCount: zResult.steps.length,
        },
      ],
      jumps: [],
      violations: zResult.violations.map((v, idx) => ({
        stepIndex: idx,
        time: v.time,
        stateIndex: v.stateIndex,
        operator: v.operator,
        worstCaseValue: v.worstCaseValue,
        limitValue: v.limitValue,
        reason: v.reason,
      })),
      summary: options.linearMatrixA
        ? zResult.summary
        : `${zResult.summary} (Benchmark linear matrix A=[[-0.1]]; no custom matrix extracted from SysML model)`,
    };
  }

  const solverResult: HybridFlowpipeResult = HybridFlowpipeSolver.solve({
    automaton,
    initialModeId,
    initialEnclosure,
    nominalInitial,
    tSpan,
    dt,
    order,
    minOrder: options.minOrder,
    maxOrder: options.maxOrder,
    adaptive,
    tol,
    useQrPreconditioning,
    useConstrainedZonotopes: options.useConstrainedZonotopes,
    maxConstrainedGenerators: options.maxConstrainedGenerators,
    maxJumps,
    requirements: activeRequirements,
  });

  const isBenchmarkFallback = customModes.length === 0;
  const verdict: VerificationVerdict = isBenchmarkFallback
    ? {
        kind: "unknown",
        reason: "unsupported",
        detail: "SysML model did not define custom continuous hybrid dynamics; executed benchmark thermostat fallback.",
      }
    : solverResult.verdict;
  const isCertifiedSafe = isBenchmarkFallback ? false : solverResult.isCertifiedSafe;
  const summary = isBenchmarkFallback
    ? `Hybrid reachability not proven (unsupported): SysML model did not define custom continuous hybrid dynamics; executed benchmark thermostat fallback.`
    : solverResult.summary;

  return {
    isCertifiedSafe,
    verdict,
    modelName: targetName,
    totalSteps: solverResult.totalSteps,
    jumpCount: solverResult.jumps.length,
    segments: solverResult.segments.map((s) => ({
      modeId: s.modeId,
      modeName: s.modeName,
      startTime: s.startTime,
      endTime: s.endTime,
      stepCount: s.steps.length,
    })),
    jumps: solverResult.jumps.map((j) => ({
      transitionId: j.transitionId,
      sourceModeId: j.sourceModeId,
      targetModeId: j.targetModeId,
      time: j.time,
      preJumpEnclosure: j.preJumpEnclosure.map((inv) => ({ lo: inv.lo, hi: inv.hi })),
      postJumpEnclosure: j.postJumpEnclosure.map((inv) => ({ lo: inv.lo, hi: inv.hi })),
      preJumpNominal: j.preJumpNominal,
      postJumpNominal: j.postJumpNominal,
    })),
    violations: solverResult.violations,
    summary,
  };
}
