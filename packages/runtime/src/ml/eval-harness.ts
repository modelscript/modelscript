// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Formal Model Evaluation Harness, Anti-Reward-Hacking Guard,
 * Δ_t Uncertainty Calibration (ECE) Audit, and PyTorch/Slurm HPC Recipe Exporter.
 *
 * Gates every compact reasoning core (0.5B–1.5B) and LoRA adapter before promotion to
 * production or federated publication on Ansatz.
 */

import { compileRelationalHypergraph } from "./hypergraph-compiler.js";
import {
  DEFAULT_DYNAMIC_M_CONFIG,
  type DiskAnnMemoryConfig,
  type DynamicMConfig,
  type FormalCertificateSummary,
  type RelationalHypergraphRecord,
  type SmallLlmRecipeTarget,
} from "./schemas.js";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Anti-Reward-Hacking / Specification Gaming Detector
// ─────────────────────────────────────────────────────────────────────────────

export interface RewardHackingAuditResult {
  isRewardHacking: boolean;
  reasons: string[];
  requiredSymbolCoverage: number;
}

/**
 * Detects degenerate RLVR specification-gaming outputs that trivially pass syntax/balance
 * gates or achieve artificial zero zonotope spread without solving the engineering task.
 */
export function detectRewardHacking(options: {
  source: string;
  dialect: string;
  hypergraph?: RelationalHypergraphRecord | undefined;
  requiredSymbols?: string[] | undefined;
  minTokenCount?: number | undefined;
}): RewardHackingAuditResult {
  const { source, dialect } = options;
  const trimmed = source.trim();
  const d = dialect.trim().toLowerCase();
  const hg = options.hypergraph ?? compileRelationalHypergraph({ source, dialect });
  const reasons: string[] = [];

  const minTokens = options.minTokenCount ?? 6;
  if (hg.tokenIds.length < minTokens) {
    reasons.push(`Trivially short output (${hg.tokenIds.length} tokens < minimum ${minTokens}).`);
  }

  // Degenerate zero-generator collapse on code models (only locked keywords, no real variables/parameters)
  if ((d === "modelica" || d === "scad" || d === "openscad" || d === "sysml2") && hg.mInit === 0) {
    reasons.push(`Degenerate zero-generator output (m_init = 0) with no active engineering symbols.`);
  }

  // Modelica empty model or constant-zero stub
  if (d === "modelica") {
    const hasBodyContent = /\b(?:parameter|Real|Integer|Boolean|equation|algorithm|connect|extends)\b/.test(trimmed);
    if (!hasBodyContent) {
      reasons.push("Empty Modelica shell with no declarations, equations, or connections.");
    }
    if (/equation\s+[A-Za-z_]\w*\s*=\s*0(?:\.0)?\s*;\s*end\b/i.test(trimmed) && !/\bder\s*\(/.test(trimmed)) {
      reasons.push("Trivial constant-zero equation stub detected.");
    }
  }

  // CAD zero-volume degenerate primitive (e.g. cube([0,0,0]) or cylinder(r=0, h=0))
  if (d === "scad" || d === "openscad") {
    if (/\bcube\s*\(\s*\[\s*0(?:\.0+)?\s*,\s*0(?:\.0+)?\s*,\s*0(?:\.0+)?\s*\]\s*\)/.test(trimmed)) {
      reasons.push("Degenerate zero-volume cube([0,0,0]) detected.");
    }
    if (/\b(?:cylinder|sphere)\s*\([^)]*\b(?:r|h|d)\s*=\s*0(?:\.0+)?\b/.test(trimmed)) {
      reasons.push("Degenerate zero-radius/zero-height CAD primitive detected.");
    }
  }

  // Required specification symbol coverage
  let coverage = 1.0;
  const reqSymbols = options.requiredSymbols ?? [];
  if (reqSymbols.length > 0) {
    const tokenSet = new Set(hg.spans.map((s) => s.text));
    let matched = 0;
    const missing: string[] = [];
    for (const sym of reqSymbols) {
      const isQualified = sym.includes(".") || sym.includes("::") || sym.includes(":");
      if (tokenSet.has(sym) || (isQualified && trimmed.includes(sym))) {
        matched++;
      } else {
        missing.push(sym);
      }
    }
    coverage = matched / reqSymbols.length;
    if (coverage < 0.75) {
      reasons.push(
        `Low specification symbol coverage (${(coverage * 100).toFixed(0)}%; missing: ${missing.slice(0, 5).join(", ")}).`,
      );
    }
  }

  return {
    isRewardHacking: reasons.length > 0,
    reasons,
    requiredSymbolCoverage: Number(coverage.toFixed(4)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Δ_t Zonotope Spread Calibration Audit (Expected Calibration Error — ECE)
// ─────────────────────────────────────────────────────────────────────────────

export interface UncertaintyCalibrationSample {
  /** Normalized output zonotope spread Δ_t mapped to error probability proxy in [0, 1] (or raw Δ_t with `tau`). */
  spreadDeltaT: number;
  /** Whether the generated output actually failed formal/behavioral verification (`true` = error). */
  actualError: boolean;
}

export interface UncertaintyCalibrationResult {
  ece: number;
  meanSpreadOnErrors: number;
  meanSpreadOnValid: number;
  separationGap: number;
  sampleCount: number;
}

/**
 * Computes Expected Calibration Error (ECE) between zonotope spread `Δ_t` (mapped to an
 * empirical error probability proxy `p_err = 1 - exp(-Δ_t / tau)`) and actual verification errors.
 * Lower ECE + positive `separationGap` proves Δ_t reliably predicts hallucinations and retrieval needs.
 */
export function computeUncertaintyCalibrationEce(
  samples: UncertaintyCalibrationSample[],
  tau = 0.35,
  numBins = 10,
): UncertaintyCalibrationResult {
  if (samples.length === 0) {
    return { ece: 0, meanSpreadOnErrors: 0, meanSpreadOnValid: 0, separationGap: 0, sampleCount: 0 };
  }

  const safeTau = Math.max(1e-4, tau);
  const bins = Array.from({ length: numBins }, () => ({ count: 0, predSum: 0, errSum: 0 }));

  let errSpreadSum = 0;
  let errCount = 0;
  let okSpreadSum = 0;
  let okCount = 0;

  for (const s of samples) {
    const pErr = 1 - Math.exp(-Math.max(0, s.spreadDeltaT) / safeTau);
    const binIdx = Math.min(numBins - 1, Math.floor(pErr * numBins));
    const bin = bins[binIdx]!;
    bin.count++;
    bin.predSum += pErr;
    bin.errSum += s.actualError ? 1 : 0;

    if (s.actualError) {
      errSpreadSum += s.spreadDeltaT;
      errCount++;
    } else {
      okSpreadSum += s.spreadDeltaT;
      okCount++;
    }
  }

  let ece = 0;
  for (const b of bins) {
    if (b.count === 0) continue;
    const avgPred = b.predSum / b.count;
    const avgActual = b.errSum / b.count;
    ece += (b.count / samples.length) * Math.abs(avgPred - avgActual);
  }

  const meanSpreadOnErrors = errCount > 0 ? errSpreadSum / errCount : 0;
  const meanSpreadOnValid = okCount > 0 ? okSpreadSum / okCount : 0;

  return {
    ece: Number(ece.toFixed(4)),
    meanSpreadOnErrors: Number(meanSpreadOnErrors.toFixed(4)),
    meanSpreadOnValid: Number(meanSpreadOnValid.toFixed(4)),
    separationGap: Number((meanSpreadOnErrors - meanSpreadOnValid).toFixed(4)),
    sampleCount: samples.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Formal CI Model Promotion Gate
// ─────────────────────────────────────────────────────────────────────────────

export interface FormalEvalCase {
  caseId: string;
  dialect: string;
  generatedSource: string;
  formalCert: FormalCertificateSummary;
  requiredSymbols?: string[] | undefined;
  outputSpreadDeltaT: number;
  /** Optional Behavioral/Simulation RMSE or CAD tolerance error (0 = exact parity). */
  behavioralError?: number | undefined;
  behavioralErrorTolerance?: number | undefined;
  /** Optional DiskANN retrieval recall@k check for this case. */
  diskAnnRecallHit?: boolean | undefined;
}

export interface EvalPromotionThresholds {
  minFormalPassRate: number;
  minNonTrivialPassRate: number;
  maxRewardHackingRate: number;
  maxCalibrationEce: number;
  minDiskAnnRecall: number;
  retrievalTau: number;
}

export const DEFAULT_EVAL_PROMOTION_THRESHOLDS: EvalPromotionThresholds = {
  minFormalPassRate: 0.9,
  minNonTrivialPassRate: 0.85,
  maxRewardHackingRate: 0.05,
  maxCalibrationEce: 0.25,
  minDiskAnnRecall: 0.8,
  retrievalTau: 0.35,
};

export interface FormalModelEvalReport {
  promoted: boolean;
  totalCases: number;
  formalGatePassRate: number;
  nonTrivialPassRate: number;
  rewardHackingRate: number;
  diskAnnRecallAtK: number;
  calibration: UncertaintyCalibrationResult;
  failureReasons: string[];
  perCase: {
    caseId: string;
    formalPassed: boolean;
    behavioralPassed: boolean;
    rewardHacking: boolean;
    rewardHackingReasons: string[];
    outputSpreadDeltaT: number;
  }[];
}

/**
 * Runs the complete CI Model Promotion Gate over a benchmark suite of generated engineering models.
 */
export function runFormalModelEvalSuite(
  cases: FormalEvalCase[],
  thresholds: Partial<EvalPromotionThresholds> = {},
): FormalModelEvalReport {
  const cfg = { ...DEFAULT_EVAL_PROMOTION_THRESHOLDS, ...thresholds };
  if (cases.length === 0) {
    return {
      promoted: false,
      totalCases: 0,
      formalGatePassRate: 0,
      nonTrivialPassRate: 0,
      rewardHackingRate: 0,
      diskAnnRecallAtK: 0,
      calibration: computeUncertaintyCalibrationEce([], cfg.retrievalTau),
      failureReasons: ["Evaluation suite contains zero cases."],
      perCase: [],
    };
  }

  let formalPassCount = 0;
  let nonTrivialPassCount = 0;
  let rewardHackCount = 0;
  let recallTotal = 0;
  let recallHits = 0;
  const calSamples: UncertaintyCalibrationSample[] = [];
  const perCase: FormalModelEvalReport["perCase"] = [];

  for (const c of cases) {
    const formalPassed =
      c.formalCert.gate1GlrSyntax &&
      c.formalCert.gate2QudvUnits &&
      c.formalCert.gate3SmtFeasibility &&
      c.formalCert.gate4DaeBalance;

    const behavioralPassed =
      c.behavioralError === undefined || c.behavioralError <= (c.behavioralErrorTolerance ?? 0.05);

    const hackAudit = detectRewardHacking({
      source: c.generatedSource,
      dialect: c.dialect,
      requiredSymbols: c.requiredSymbols,
    });

    if (formalPassed) formalPassCount++;
    if (hackAudit.isRewardHacking) rewardHackCount++;
    const nonTrivialPass = formalPassed && behavioralPassed && !hackAudit.isRewardHacking;
    if (nonTrivialPass) nonTrivialPassCount++;

    if (typeof c.diskAnnRecallHit === "boolean") {
      recallTotal++;
      if (c.diskAnnRecallHit) recallHits++;
    }

    calSamples.push({
      spreadDeltaT: c.outputSpreadDeltaT,
      actualError: !nonTrivialPass,
    });

    perCase.push({
      caseId: c.caseId,
      formalPassed,
      behavioralPassed,
      rewardHacking: hackAudit.isRewardHacking,
      rewardHackingReasons: hackAudit.reasons,
      outputSpreadDeltaT: c.outputSpreadDeltaT,
    });
  }

  const n = cases.length;
  const formalGatePassRate = Number((formalPassCount / n).toFixed(4));
  const nonTrivialPassRate = Number((nonTrivialPassCount / n).toFixed(4));
  const rewardHackingRate = Number((rewardHackCount / n).toFixed(4));
  const diskAnnRecallAtK = recallTotal > 0 ? Number((recallHits / recallTotal).toFixed(4)) : 1.0;
  const calibration = computeUncertaintyCalibrationEce(calSamples, cfg.retrievalTau);

  const failureReasons: string[] = [];
  if (formalGatePassRate < cfg.minFormalPassRate) {
    failureReasons.push(`formalGatePassRate ${formalGatePassRate} < ${cfg.minFormalPassRate}`);
  }
  if (nonTrivialPassRate < cfg.minNonTrivialPassRate) {
    failureReasons.push(`nonTrivialPassRate ${nonTrivialPassRate} < ${cfg.minNonTrivialPassRate}`);
  }
  if (rewardHackingRate > cfg.maxRewardHackingRate) {
    failureReasons.push(`rewardHackingRate ${rewardHackingRate} > ${cfg.maxRewardHackingRate}`);
  }
  if (calibration.ece > cfg.maxCalibrationEce) {
    failureReasons.push(`calibration ECE ${calibration.ece} > ${cfg.maxCalibrationEce}`);
  }
  if (recallTotal > 0 && diskAnnRecallAtK < cfg.minDiskAnnRecall) {
    failureReasons.push(`diskAnnRecallAtK ${diskAnnRecallAtK} < ${cfg.minDiskAnnRecall}`);
  }

  return {
    promoted: failureReasons.length === 0,
    totalCases: n,
    formalGatePassRate,
    nonTrivialPassRate,
    rewardHackingRate,
    diskAnnRecallAtK,
    calibration,
    failureReasons,
    perCase,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. PyTorch / Triton + Slurm HPC Training Bundle Exporter
// ─────────────────────────────────────────────────────────────────────────────

export interface PyTorchSlurmExportOptions {
  recipeName: string;
  recipeVersion?: string | undefined;
  targetModel?: Partial<SmallLlmRecipeTarget> | undefined;
  dynamicM?: Partial<DynamicMConfig> | undefined;
  memoryConfig?: Partial<DiskAnnMemoryConfig> | undefined;
  shardIds: string[];
  memoryApiUrl?: string | undefined;
  gpus?: number | undefined;
  partition?: string | undefined;
  walltime?: string | undefined;
}

export interface PyTorchSlurmExportBundle {
  manifestJson: string;
  slurmScript: string;
}

/**
 * Generates a reproducible PyTorch/Triton Dynamic-m training manifest and Slurm HPC batch script
 * pinned to exact content-addressed `m_init`-bucketed shard IDs and DiskANN memory settings.
 */
export function generatePyTorchSlurmRecipeExport(options: PyTorchSlurmExportOptions): PyTorchSlurmExportBundle {
  const version = options.recipeVersion ?? "0.1.0";
  const gpus = Math.max(1, options.gpus ?? 4);
  const partition = options.partition ?? "gpu";
  const walltime = options.walltime ?? "12:00:00";
  const memoryApiUrl = options.memoryApiUrl ?? "http://localhost:3001/api/v1/memory";

  const manifest = {
    schema: "modelscript.training-recipe.v1",
    recipeName: options.recipeName,
    recipeVersion: version,
    targetModel: {
      baseModel: options.targetModel?.baseModel ?? "Qwen/Qwen2.5-Coder-1.5B",
      parameterScale: options.targetModel?.parameterScale ?? "1.5B",
      mode: options.targetModel?.mode ?? "posttrain-lora",
      loraRank: options.targetModel?.loraRank ?? 16,
      loraAlpha: options.targetModel?.loraAlpha ?? 32,
      projectionLayerIndex: options.targetModel?.projectionLayerIndex ?? 14,
      retrieverEmbeddingDim: options.targetModel?.retrieverEmbeddingDim ?? 256,
    },
    dynamicM: { ...DEFAULT_DYNAMIC_M_CONFIG, ...(options.dynamicM ?? {}) },
    memoryConfig: {
      backend: "diskann" as const,
      ramQuantization: options.memoryConfig?.ramQuantization ?? "int8",
      nvmeFlashEnabled: options.memoryConfig?.nvmeFlashEnabled ?? true,
      semverPinned: options.memoryConfig?.semverPinned ?? true,
      includeVerifiedSocialPosts: options.memoryConfig?.includeVerifiedSocialPosts ?? true,
      latencySlaMs: options.memoryConfig?.latencySlaMs ?? 15,
      apiUrl: memoryApiUrl,
    },
    shards: options.shardIds,
  };

  const safeJobName = options.recipeName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
  const slurmScript = [
    "#!/usr/bin/env bash",
    `#SBATCH --job-name=msx_${safeJobName}`,
    `#SBATCH --partition=${partition}`,
    `#SBATCH --gres=gpu:${gpus}`,
    `#SBATCH --cpus-per-task=${gpus * 4}`,
    `#SBATCH --mem=${gpus * 32}G`,
    `#SBATCH --time=${walltime}`,
    "#SBATCH --output=logs/%x-%j.out",
    "",
    "set -euo pipefail",
    "mkdir -p logs checkpoints",
    `export MSX_RECIPE_MANIFEST="training-recipe.manifest.json"`,
    `export MSX_MEMORY_API_URL="${memoryApiUrl}"`,
    `export MSX_DYNAMIC_M_CAP="${manifest.dynamicM.mCap}"`,
    "",
    `echo "[msx-slurm] Launching Dynamic-m Relational Zonotope training for ${options.recipeName}@${version} (${gpus} GPUs)"`,
    `torchrun --nproc_per_node=${gpus} -m modelscript_trainer.train_dynamic_m \\`,
    `  --manifest "$MSX_RECIPE_MANIFEST" \\`,
    `  --base-model "${manifest.targetModel.baseModel}" \\`,
    `  --mode "${manifest.targetModel.mode}" \\`,
    `  --lora-rank ${manifest.targetModel.loraRank} \\`,
    `  --m-start ${manifest.dynamicM.mStart} \\`,
    `  --m-max ${manifest.dynamicM.mMax} \\`,
    `  --m-cap ${manifest.dynamicM.mCap} \\`,
    `  --expansion-tau ${manifest.dynamicM.expansionTau} \\`,
    `  --prune-eps ${manifest.dynamicM.pruneEps} \\`,
    `  --diskann-url "$MSX_MEMORY_API_URL" \\`,
    `  --output-dir "checkpoints/${safeJobName}"`,
    "",
  ].join("\n");

  return {
    manifestJson: JSON.stringify(manifest, null, 2) + "\n",
    slurmScript,
  };
}
