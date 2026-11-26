// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Recipe Pre-Flight Analyzer, Semantic Dataset Diff,
 * Train/Eval Decontamination Scanner, Immutable Overlay Patches, and Single-Example X-Ray Debugger.
 *
 * Powers both Ansatz's interactive Dataset Scrubber / X-Ray Debugger and `msx dataset audit|diff`.
 */

import {
  computeWorstCaseLogitLoss,
  computeZonotopeBounds,
  SmallLlmZonotopeRuntime,
  type LayerTelemetrySnapshot,
} from "./dynamic-m-zonotope.js";
import { detectRewardHacking, type FormalModelEvalReport } from "./eval-harness.js";
import {
  applyHypergraphOverrides,
  bucketHypergraphExamples,
  compileRelationalHypergraph,
  fnv1a32,
} from "./hypergraph-compiler.js";
import { REL_TYPE_NAMES, RelTypeId, type HypergraphTokenOverride, type RelationalHypergraphRecord } from "./schemas.js";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Recipe Pre-Flight Analyzer & Data Nutrition Label
// ─────────────────────────────────────────────────────────────────────────────

export interface RecipeExampleInput {
  exampleId?: string | undefined;
  uri: string;
  dialect: string;
  source: string;
  hypergraph?: RelationalHypergraphRecord | undefined;
}

export interface RecipePreFlightOptions {
  batchSize?: number | undefined;
  mCap?: number | undefined;
  /** Symbols currently indexed in DiskANN (used to detect pre-training knowledge gaps). */
  indexedDiskAnnSymbols?: Set<string> | string[] | undefined;
}

export interface RecipePreFlightReport {
  totalExamples: number;
  totalTokens: number;
  dialectCounts: Record<string, number>;
  mInitStats: {
    min: number;
    median: number;
    p95: number;
    max: number;
    mean: number;
    histogram: { m: number; count: number }[];
  };
  relTypeCounts: Record<string, number>;
  lockedTokenRatio: number;
  rewardHackingCount: number;
  rewardHackingRate: number;
  suspectedRewardHackingIds: string[];
  bucketingEfficiency: {
    batchSize: number;
    mCap: number;
    bucketCount: number;
    naivePaddedGeneratorOps: number;
    bucketedGeneratorOps: number;
    estimatedVramSavingsPct: number;
    outlierExampleIds: string[];
  };
  diskAnnCoverage: {
    uniqueExampleSymbols: number;
    coveredSymbols: number;
    coverageRatio: number;
    missingSymbols: string[];
  };
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[pos]!;
}

/**
 * Computes a full pre-flight "Data Nutrition Label", Dynamic-m bucketing VRAM/FLOP savings,
 * anti-reward-hacking audit, and DiskANN symbol-coverage gap report for a dataset or training recipe.
 */
export function analyzeRecipePreFlight(
  inputs: RecipeExampleInput[],
  options: RecipePreFlightOptions = {},
): RecipePreFlightReport {
  const batchSize = Math.max(1, options.batchSize ?? 8);
  const mCap = Math.max(1, options.mCap ?? 32);
  const indexedSet = options.indexedDiskAnnSymbols
    ? new Set(
        Array.from(options.indexedDiskAnnSymbols)
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
      )
    : null;

  const compiled: RelationalHypergraphRecord[] = [];
  const dialectCounts: Record<string, number> = {};
  const relTypeCounts: Record<string, number> = {};
  const mHistMap = new Map<number, number>();
  const allExampleSymbols = new Set<string>();
  const suspectedRewardHackingIds: string[] = [];

  let totalTokens = 0;
  let lockedTokens = 0;

  for (const inp of inputs) {
    const rec =
      inp.hypergraph ??
      compileRelationalHypergraph({
        source: inp.source,
        uri: inp.uri,
        dialect: inp.dialect,
      });
    if (inp.exampleId) rec.exampleId = inp.exampleId;
    compiled.push(rec);

    dialectCounts[rec.dialect] = (dialectCounts[rec.dialect] ?? 0) + 1;
    mHistMap.set(rec.mInit, (mHistMap.get(rec.mInit) ?? 0) + 1);
    totalTokens += rec.tokenIds.length;

    for (let i = 0; i < rec.groupIds.length; i++) {
      if (rec.groupIds[i] === 0) lockedTokens++;
      const rt = rec.relTypeIds[i] as RelTypeId;
      const rtName = REL_TYPE_NAMES[rt] ?? `REL_${rt}`;
      relTypeCounts[rtName] = (relTypeCounts[rtName] ?? 0) + 1;
    }

    for (const g of rec.groups) {
      if (g.symbolName && g.symbolName.length >= 2) {
        allExampleSymbols.add(g.symbolName);
      }
    }

    const hack = detectRewardHacking({ source: inp.source, dialect: inp.dialect, hypergraph: rec });
    if (hack.isRewardHacking) {
      suspectedRewardHackingIds.push(rec.exampleId);
    }
  }

  const mSorted = compiled.map((r) => r.mInit).sort((a, b) => a - b);
  const mSum = mSorted.reduce((a, b) => a + b, 0);
  const histogram = Array.from(mHistMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([m, count]) => ({ m, count }));

  // Bucketing efficiency vs rigid worst-case `mCap` padding
  const buckets = bucketHypergraphExamples(compiled, batchSize, mCap);
  let naiveOps = 0;
  let bucketedOps = 0;
  for (const b of buckets) {
    const batchTokens = b.examples.reduce((acc, e) => acc + e.tokenIds.length, 0);
    naiveOps += batchTokens * (mCap + 1);
    bucketedOps += batchTokens * (b.mBatchMax + 1);
  }
  const estimatedVramSavingsPct = naiveOps > 0 ? Number((((naiveOps - bucketedOps) / naiveOps) * 100).toFixed(2)) : 0;
  const outlierExampleIds = compiled.filter((r) => r.mInit > mCap).map((r) => r.exampleId);

  // DiskANN knowledge-gap audit
  let coveredSymbols = 0;
  const missingSymbols: string[] = [];
  if (indexedSet) {
    for (const sym of allExampleSymbols) {
      if (indexedSet.has(sym.toLowerCase())) {
        coveredSymbols++;
      } else {
        missingSymbols.push(sym);
      }
    }
  } else {
    coveredSymbols = allExampleSymbols.size;
  }
  const uniqueExampleSymbols = allExampleSymbols.size;
  const coverageRatio = uniqueExampleSymbols > 0 ? Number((coveredSymbols / uniqueExampleSymbols).toFixed(4)) : 1.0;

  return {
    totalExamples: compiled.length,
    totalTokens,
    dialectCounts,
    mInitStats: {
      min: mSorted[0] ?? 0,
      median: quantile(mSorted, 0.5),
      p95: quantile(mSorted, 0.95),
      max: mSorted[mSorted.length - 1] ?? 0,
      mean: compiled.length > 0 ? Number((mSum / compiled.length).toFixed(2)) : 0,
      histogram,
    },
    relTypeCounts,
    lockedTokenRatio: totalTokens > 0 ? Number((lockedTokens / totalTokens).toFixed(4)) : 0,
    rewardHackingCount: suspectedRewardHackingIds.length,
    rewardHackingRate:
      compiled.length > 0 ? Number((suspectedRewardHackingIds.length / compiled.length).toFixed(4)) : 0,
    suspectedRewardHackingIds,
    bucketingEfficiency: {
      batchSize,
      mCap,
      bucketCount: buckets.length,
      naivePaddedGeneratorOps: naiveOps,
      bucketedGeneratorOps: bucketedOps,
      estimatedVramSavingsPct,
      outlierExampleIds,
    },
    diskAnnCoverage: {
      uniqueExampleSymbols,
      coveredSymbols,
      coverageRatio,
      missingSymbols: missingSymbols.sort().slice(0, 50),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Semantic Dataset Version Diff (`v1..v2`)
// ─────────────────────────────────────────────────────────────────────────────

export interface DatasetVersionDiff {
  beforeCount: number;
  afterCount: number;
  addedUris: string[];
  removedUris: string[];
  modifiedUris: string[];
  dialectDelta: Record<string, number>;
  mInitMedianBefore: number;
  mInitMedianAfter: number;
  mInitMeanBefore: number;
  mInitMeanAfter: number;
  /** Estimated GPU step activation memory multiplier: (mean_m_after + 1) / (mean_m_before + 1). */
  estimatedMemoryMultiplier: number;
  rewardHackingDelta: number;
}

export function diffDatasetVersions(before: RecipeExampleInput[], after: RecipeExampleInput[]): DatasetVersionDiff {
  const beforePre = analyzeRecipePreFlight(before);
  const afterPre = analyzeRecipePreFlight(after);

  const beforeMap = new Map<string, string>();
  for (const b of before) beforeMap.set(b.uri, fnv1a32(b.source).toString(16));
  const afterMap = new Map<string, string>();
  for (const a of after) afterMap.set(a.uri, fnv1a32(a.source).toString(16));

  const addedUris: string[] = [];
  const removedUris: string[] = [];
  const modifiedUris: string[] = [];

  for (const [uri, hash] of afterMap.entries()) {
    if (!beforeMap.has(uri)) addedUris.push(uri);
    else if (beforeMap.get(uri) !== hash) modifiedUris.push(uri);
  }
  for (const uri of beforeMap.keys()) {
    if (!afterMap.has(uri)) removedUris.push(uri);
  }

  const allDialects = new Set([...Object.keys(beforePre.dialectCounts), ...Object.keys(afterPre.dialectCounts)]);
  const dialectDelta: Record<string, number> = {};
  for (const d of allDialects) {
    const delta = (afterPre.dialectCounts[d] ?? 0) - (beforePre.dialectCounts[d] ?? 0);
    if (delta !== 0) dialectDelta[d] = delta;
  }

  const estimatedMemoryMultiplier = Number(
    ((afterPre.mInitStats.mean + 1) / Math.max(1, beforePre.mInitStats.mean + 1)).toFixed(3),
  );

  return {
    beforeCount: before.length,
    afterCount: after.length,
    addedUris: addedUris.sort(),
    removedUris: removedUris.sort(),
    modifiedUris: modifiedUris.sort(),
    dialectDelta,
    mInitMedianBefore: beforePre.mInitStats.median,
    mInitMedianAfter: afterPre.mInitStats.median,
    mInitMeanBefore: beforePre.mInitStats.mean,
    mInitMeanAfter: afterPre.mInitStats.mean,
    estimatedMemoryMultiplier,
    rewardHackingDelta: afterPre.rewardHackingCount - beforePre.rewardHackingCount,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Train / Eval Decontamination Scanner
// ─────────────────────────────────────────────────────────────────────────────

export interface ContaminationMatch {
  trainUri: string;
  trainExampleId: string;
  evalUri: string;
  evalExampleId: string;
  matchKind: "exact-hash" | "near-duplicate";
  similarity: number;
}

export interface DecontaminationReport {
  trainCount: number;
  evalCount: number;
  contaminatedCount: number;
  contaminationRate: number;
  matches: ContaminationMatch[];
  recommendedQuarantineIds: string[];
}

function buildTokenShingles(source: string, k = 4): Set<number> {
  const toks = source.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
  const shingles = new Set<number>();
  if (toks.length < k) {
    shingles.add(fnv1a32(toks.join(" ")));
    return shingles;
  }
  for (let i = 0; i <= toks.length - k; i++) {
    shingles.add(fnv1a32(toks.slice(i, i + k).join(" ")));
  }
  return shingles;
}

function jaccardSimilarity(a: Set<number>, b: Set<number>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const v of small) {
    if (large.has(v)) inter++;
  }
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Scans training examples against held-out evaluation cases for exact source/token matches
 * and structural 4-gram Jaccard near-duplicates, returning exact quarantine recommendations.
 */
export function auditTrainEvalContamination(
  trainExamples: RecipeExampleInput[],
  evalExamples: RecipeExampleInput[],
  nearDuplicateThreshold = 0.72,
): DecontaminationReport {
  const evalPrepared = evalExamples.map((e) => {
    const norm = e.source.replace(/\s+/g, " ").trim().toLowerCase();
    return {
      uri: e.uri,
      exampleId: e.exampleId ?? `eval_${fnv1a32(`${e.uri}:${e.source}`).toString(16)}`,
      exactHash: fnv1a32(norm),
      shingles: buildTokenShingles(norm),
    };
  });

  const matches: ContaminationMatch[] = [];
  const quarantinedSet = new Set<string>();

  for (const tr of trainExamples) {
    const norm = tr.source.replace(/\s+/g, " ").trim().toLowerCase();
    const trId =
      tr.exampleId ??
      `rhg_${fnv1a32(`${tr.uri}:${tr.dialect.toLowerCase()}:${tr.source}`).toString(16).padStart(8, "0")}`;
    const trHash = fnv1a32(norm);
    const trShingles = buildTokenShingles(norm);

    for (const ev of evalPrepared) {
      if (trHash === ev.exactHash) {
        matches.push({
          trainUri: tr.uri,
          trainExampleId: trId,
          evalUri: ev.uri,
          evalExampleId: ev.exampleId,
          matchKind: "exact-hash",
          similarity: 1.0,
        });
        quarantinedSet.add(trId);
        break;
      }
      const sim = jaccardSimilarity(trShingles, ev.shingles);
      if (sim >= nearDuplicateThreshold) {
        matches.push({
          trainUri: tr.uri,
          trainExampleId: trId,
          evalUri: ev.uri,
          evalExampleId: ev.exampleId,
          matchKind: "near-duplicate",
          similarity: Number(sim.toFixed(4)),
        });
        quarantinedSet.add(trId);
        break;
      }
    }
  }

  return {
    trainCount: trainExamples.length,
    evalCount: evalExamples.length,
    contaminatedCount: quarantinedSet.size,
    contaminationRate: trainExamples.length > 0 ? Number((quarantinedSet.size / trainExamples.length).toFixed(4)) : 0,
    matches,
    recommendedQuarantineIds: Array.from(quarantinedSet),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Immutable Dataset Overlay Patches (`dataset-overrides.json`)
// ─────────────────────────────────────────────────────────────────────────────

export interface DatasetOverlayPatch {
  exampleId: string;
  action: "quarantine" | "patch_source" | "hypergraph_override";
  reason: string;
  patchedSource?: string | undefined;
  hypergraphOverrides?: HypergraphTokenOverride[] | undefined;
}

export function applyDatasetOverlayPatches(
  records: RelationalHypergraphRecord[],
  patches: DatasetOverlayPatch[],
): {
  activeRecords: RelationalHypergraphRecord[];
  quarantinedIds: string[];
  patchedIds: string[];
} {
  const byId = new Map<string, DatasetOverlayPatch>();
  for (const p of patches) byId.set(p.exampleId, p);

  const activeRecords: RelationalHypergraphRecord[] = [];
  const quarantinedIds: string[] = [];
  const patchedIds: string[] = [];

  for (const rec of records) {
    const patch = byId.get(rec.exampleId);
    if (!patch) {
      activeRecords.push(rec);
      continue;
    }
    if (patch.action === "quarantine") {
      quarantinedIds.push(rec.exampleId);
      continue;
    }
    if (patch.action === "patch_source" && typeof patch.patchedSource === "string") {
      const recompiled = compileRelationalHypergraph({
        source: patch.patchedSource,
        uri: rec.uri,
        dialect: rec.dialect,
        overrides: patch.hypergraphOverrides,
      });
      patchedIds.push(rec.exampleId);
      activeRecords.push(recompiled);
      continue;
    }
    if (patch.action === "hypergraph_override" && patch.hypergraphOverrides?.length) {
      patchedIds.push(rec.exampleId);
      activeRecords.push(applyHypergraphOverrides(rec, patch.hypergraphOverrides));
      continue;
    }
    activeRecords.push(rec);
  }

  return { activeRecords, quarantinedIds, patchedIds };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Single-Example "X-Ray" Zonotope & Loss Debugger (Heatmap + Waterfall + ξ*)
// ─────────────────────────────────────────────────────────────────────────────

export interface XRayTokenHeat {
  index: number;
  text: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  groupId: number;
  spreadDeltaT: number;
  worstCaseLoss: number;
  /** Normalized heat intensity in [0, 1] for Monaco visual decorations. */
  intensity: number;
  exceedsRetrievalTau: boolean;
}

export interface WorstCaseCornerComponent {
  groupId: number;
  label: string;
  symbolName?: string | undefined;
  /** Adversarial perturbation sign (+1 or -1) maximizing spread on the peak-uncertainty token. */
  xiSign: 1 | -1;
  contributionMagnitude: number;
}

export interface ExampleXRayDiagnostics {
  exampleId: string;
  dialect: string;
  mInit: number;
  meanWorstCaseLoss: number;
  maxSpreadDeltaT: number;
  peakTokenIndex: number;
  peakTokenText: string;
  retrievalTau: number;
  tokenHeat: XRayTokenHeat[];
  layerWaterfall: LayerTelemetrySnapshot[];
  worstCaseCorner: WorstCaseCornerComponent[];
  rewardHackingAudit: ReturnType<typeof detectRewardHacking>;
}

/**
 * Runs a 1-step Dynamic-m diagnostic forward pass on a single training example to produce:
 *   - Token-level worst-case loss & Δ_t heatmap for Monaco decorations
 *   - Per-layer Generator Lifecycle Waterfall (pruning/merging/expansion/Girard caps)
 *   - Adversarial perturbation corner ξ* ∈ {-1, +1}^m mapped to concrete symbol names for CAD/Sim replay
 */
export async function diagnoseExampleXRay(
  source: string,
  dialect: string,
  options?: {
    uri?: string | undefined;
    runtime?: SmallLlmZonotopeRuntime | undefined;
    computeDialM?: number | undefined;
    overrides?: HypergraphTokenOverride[] | undefined;
  },
): Promise<ExampleXRayDiagnostics> {
  const record = compileRelationalHypergraph({
    source,
    uri: options?.uri,
    dialect,
    overrides: options?.overrides,
  });
  const runtime =
    options?.runtime ??
    new SmallLlmZonotopeRuntime({
      vocabSize: 128,
      hiddenDim: 24,
      loraRank: 4,
      numLayers: 3,
      retrieverDim: 64,
      seed: 2026,
    });
  const computeM = options?.computeDialM ?? Math.max(1, Math.min(record.mInit || 1, runtime.config.mCap));
  const inferRes = await runtime.inferWithComputeDial(record, computeM);

  const V = inferRes.logits.dim;
  const targets = record.tokenIds.map((t) => Math.abs(t) % V);
  const lossRes = computeWorstCaseLogitLoss(inferRes.logits, targets, 0.5);
  const { radius } = computeZonotopeBounds(inferRes.logits);

  // Per-token worst-case loss + spread
  const rawTokenLosses: number[] = [];
  let maxHeatScore = 1e-9;
  let peakTokenIndex = 0;
  let peakSpread = -1;

  for (let t = 0; t < record.spans.length; t++) {
    const base = t * V;
    const tgt = targets[t]!;
    let maxW = -Infinity;
    const worst = new Float64Array(V);
    for (let v = 0; v < V; v++) {
      const val =
        v === tgt
          ? inferRes.logits.center[base + v]! - radius[base + v]!
          : inferRes.logits.center[base + v]! + radius[base + v]!;
      worst[v] = val;
      if (val > maxW) maxW = val;
    }
    let sumExp = 0;
    for (let v = 0; v < V; v++) sumExp += Math.exp(worst[v]! - maxW);
    const tokLoss = -(worst[tgt]! - maxW - Math.log(Math.max(1e-12, sumExp)));
    rawTokenLosses.push(tokLoss);

    const sp = inferRes.spreadPerToken[t] ?? 0;
    if (sp > peakSpread) {
      peakSpread = sp;
      peakTokenIndex = t;
    }
    const combined = sp * 4 + tokLoss * 0.1;
    if (combined > maxHeatScore) maxHeatScore = combined;
  }

  const tokenHeat: XRayTokenHeat[] = record.spans.map((span, t) => {
    const sp = inferRes.spreadPerToken[t] ?? 0;
    const tl = rawTokenLosses[t] ?? 0;
    const combined = sp * 4 + tl * 0.1;
    return {
      index: span.index,
      text: span.text,
      startLine: span.startLine,
      startColumn: span.startColumn,
      endLine: span.endLine,
      endColumn: span.endColumn,
      groupId: span.groupId,
      spreadDeltaT: Number(sp.toFixed(5)),
      worstCaseLoss: Number(tl.toFixed(4)),
      intensity: Number(Math.min(1, Math.max(0, combined / maxHeatScore)).toFixed(3)),
      exceedsRetrievalTau: sp > runtime.config.retrievalTau,
    };
  });

  // Extract worst-case perturbation corner ξ* ∈ {-1, +1}^m maximizing spread on the peak-uncertainty token's target logit
  const worstCaseCorner: WorstCaseCornerComponent[] = [];
  if (inferRes.logits.m > 0 && record.spans.length > 0) {
    const ld = inferRes.logits.seqLen * V;
    const peakTarget = targets[peakTokenIndex]!;
    const elemIdx = peakTokenIndex * V + peakTarget;
    const groupMeta = new Map(record.groups.map((g) => [g.groupId, g]));

    for (let k = 0; k < inferRes.logits.m; k++) {
      const gVal = inferRes.logits.generators[k * ld + elemIdx]!;
      const gid = inferRes.logits.groupIds[k]!;
      const meta = groupMeta.get(gid);
      // Minimizing target logit c_target + Σ ξ_k g_k sets ξ_k = -sign(g_k)
      const xiSign: 1 | -1 = gVal >= 0 ? -1 : 1;
      worstCaseCorner.push({
        groupId: gid,
        label: meta?.label ?? (gid === -1 ? "nonlinear_slack" : `ε_${gid}`),
        ...(meta?.symbolName ? { symbolName: meta.symbolName } : {}),
        xiSign,
        contributionMagnitude: Number(Math.abs(gVal).toFixed(5)),
      });
    }
    worstCaseCorner.sort((a, b) => b.contributionMagnitude - a.contributionMagnitude);
  }

  return {
    exampleId: record.exampleId,
    dialect: record.dialect,
    mInit: record.mInit,
    meanWorstCaseLoss: Number(lossRes.worstCaseCrossEntropy.toFixed(4)),
    maxSpreadDeltaT: inferRes.maxSpread,
    peakTokenIndex,
    peakTokenText: record.spans[peakTokenIndex]?.text ?? "",
    retrievalTau: runtime.config.retrievalTau,
    tokenHeat,
    layerWaterfall: inferRes.layerTelemetry,
    worstCaseCorner,
    rewardHackingAudit: detectRewardHacking({ source, dialect, hypergraph: record }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Side-by-Side Checkpoint / Eval Report Regression Diff
// ─────────────────────────────────────────────────────────────────────────────

export interface EvalReportRegressionDiff {
  promotionChange: "unchanged-pass" | "unchanged-fail" | "promoted" | "regressed";
  formalPassRateDelta: number;
  nonTrivialPassRateDelta: number;
  rewardHackingRateDelta: number;
  eceDelta: number;
  flippedPassToFail: string[];
  flippedFailToPass: string[];
}

export function diffEvalReports(before: FormalModelEvalReport, after: FormalModelEvalReport): EvalReportRegressionDiff {
  const beforeMap = new Map(before.perCase.map((c) => [c.caseId, c]));
  const flippedPassToFail: string[] = [];
  const flippedFailToPass: string[] = [];

  for (const cur of after.perCase) {
    const prev = beforeMap.get(cur.caseId);
    if (!prev) continue;
    const prevOk = prev.formalPassed && prev.behavioralPassed && !prev.rewardHacking;
    const curOk = cur.formalPassed && cur.behavioralPassed && !cur.rewardHacking;
    if (prevOk && !curOk) flippedPassToFail.push(cur.caseId);
    else if (!prevOk && curOk) flippedFailToPass.push(cur.caseId);
  }

  const promotionChange =
    before.promoted === after.promoted
      ? after.promoted
        ? "unchanged-pass"
        : "unchanged-fail"
      : after.promoted
        ? "promoted"
        : "regressed";

  return {
    promotionChange,
    formalPassRateDelta: Number((after.formalGatePassRate - before.formalGatePassRate).toFixed(4)),
    nonTrivialPassRateDelta: Number((after.nonTrivialPassRate - before.nonTrivialPassRate).toFixed(4)),
    rewardHackingRateDelta: Number((after.rewardHackingRate - before.rewardHackingRate).toFixed(4)),
    eceDelta: Number((after.calibration.ece - before.calibration.ece).toFixed(4)),
    flippedPassToFail,
    flippedFailToPass,
  };
}
