// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  AiGovernancePolicy,
  DynamicMConfig,
  MemoryShardContract,
  MemoryShardPin,
  MlPackageKind,
  SmallLlmRecipeTarget,
} from "@modelscript/runtime";

export interface RecipeEvalMetrics {
  passAt1?: number | undefined;
  gate1To4PassRate?: number | undefined;
  simRmse?: number | undefined;
  deltaTEce?: number | undefined;
  vramGb?: number | undefined;
  independentReproductions?: number | undefined;
  domainLeaderboardRank?: { domain: string; rank: number; tier: string } | undefined;
}

export interface RecipeBeforeAfterSample {
  title: string;
  dialect: string;
  prompt: string;
  baseOutput: string;
  baseDeltaT: number;
  baseGatesPassed: number;
  recipeOutput: string;
  recipeDeltaT: number;
  recipeGatesPassed: number;
}

export interface RecipeFailureBounty {
  challengeId?: number | string | undefined;
  title: string;
  dialect: string;
  deltaT: number;
  bountyCredits?: number | undefined;
  url?: string | undefined;
}

export interface RecipeLineageInfo {
  parentPackage?: string | undefined;
  parentPostUrl?: string | undefined;
  parentAuthor?: string | undefined;
  upstreamCredits?: string[] | undefined;
  diffEntries?: RecipeDiffEntry[] | undefined;
}

export interface RecipeDiffEntry {
  field: string;
  kind: "added" | "removed" | "changed";
  before?: string | undefined;
  after?: string | undefined;
  deltaLabel?: string | undefined;
}

export interface RecipeRewardWeights {
  gate1Syntax: number;
  gate2Units: number;
  gate3Smt: number;
  gate4Dae: number;
  physicsSim: number;
  cadClearance: number;
  zonotopeContraction: number;
}

export interface NormalizedTrainingRecipeCard {
  kind: MlPackageKind;
  title: string;
  packageName: string;
  version: string;
  authorHandle?: string | undefined;
  summary?: string | undefined;
  targetModel?: SmallLlmRecipeTarget | undefined;
  dynamicM?: DynamicMConfig | undefined;
  rewardWeights?: RecipeRewardWeights | undefined;
  aiGovernance?: AiGovernancePolicy | undefined;
  memoryContract?: MemoryShardContract | undefined;
  memoryPins: MemoryShardPin[];
  datasetDependencies: Record<string, string>;
  evalMetrics: RecipeEvalMetrics;
  beforeAfterSamples: RecipeBeforeAfterSample[];
  failureBounties: RecipeFailureBounty[];
  lineage?: RecipeLineageInfo | undefined;
  webGpuRunnable: boolean;
}

function asRecord(val: unknown): Record<string, unknown> | undefined {
  return val && typeof val === "object" && !Array.isArray(val) ? (val as Record<string, unknown>) : undefined;
}

function asString(val: unknown): string | undefined {
  return typeof val === "string" && val.trim().length > 0 ? val.trim() : undefined;
}

function asNumber(val: unknown): number | undefined {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string" && val.trim().length > 0) {
    const n = Number(val);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

const VALID_KINDS = new Set<MlPackageKind>([
  "dataset-pretrain",
  "dataset-posttrain",
  "training-recipe",
  "memory-shard",
  "model-core",
  "lora-adapter",
  "projection-head",
]);

/**
 * Normalizes a raw `artifact.view_config` payload into a strongly typed `NormalizedTrainingRecipeCard`.
 */
export function parseTrainingRecipeViewConfig(
  rawConfig: Record<string, unknown> | null | undefined,
  fallbackTitle?: string,
  fallbackKind?: string,
): NormalizedTrainingRecipeCard {
  const cfg = rawConfig ?? {};
  const mlObj = asRecord(cfg["ml"]) ?? asRecord(cfg["recipe"]) ?? cfg;

  const rawKind = asString(mlObj["kind"]) || asString(cfg["kind"]) || fallbackKind || "training-recipe";
  const kind: MlPackageKind = VALID_KINDS.has(rawKind as MlPackageKind)
    ? (rawKind as MlPackageKind)
    : "training-recipe";

  const packageName = asString(cfg["packageName"]) || asString(cfg["name"]) || "@ansatz/untitled-recipe";
  const version = asString(cfg["version"]) || "0.1.0";
  const title = asString(cfg["title"]) || fallbackTitle || `${packageName}@${version}`;
  const authorHandle = asString(cfg["authorHandle"]) || asString(cfg["author"]);
  const summary = asString(cfg["summary"]) || asString(cfg["description"]);

  const targetModel = asRecord(mlObj["targetModel"]) as SmallLlmRecipeTarget | undefined;
  const dynamicM = asRecord(mlObj["dynamicM"]) as DynamicMConfig | undefined;
  const rewardWeights = asRecord(mlObj["rewardWeights"]) as RecipeRewardWeights | undefined;
  const aiGovernance = (asRecord(mlObj["aiGovernance"]) ?? asRecord(cfg["aiGovernance"])) as
    AiGovernancePolicy | undefined;
  const memoryContract = (asRecord(mlObj["memoryContract"]) ?? asRecord(cfg["memoryContract"])) as
    MemoryShardContract | undefined;

  const rawPins = Array.isArray(mlObj["memoryPins"])
    ? mlObj["memoryPins"]
    : Array.isArray(cfg["memoryPins"])
      ? cfg["memoryPins"]
      : [];
  const memoryPins: MemoryShardPin[] = rawPins
    .map((p) => asRecord(p))
    .filter((p): p is Record<string, unknown> => Boolean(p && asString(p["packageName"])))
    .map((p) => ({
      originNode: asString(p["originNode"]) || "ansatz.social",
      packageName: asString(p["packageName"])!,
      version: asString(p["version"]) || "latest",
      signerPubkey: asString(p["signerPubkey"]) || "",
      gitSha: asString(p["gitSha"]),
    }));

  const rawDeps = asRecord(cfg["dependencies"]) ?? asRecord(cfg["datasetDependencies"]) ?? {};
  const datasetDependencies: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawDeps)) {
    if (typeof v === "string") datasetDependencies[k] = v;
  }

  const evalObj = asRecord(cfg["evalMetrics"]) ?? asRecord(cfg["eval"]) ?? {};
  const rankObj = asRecord(evalObj["domainLeaderboardRank"]);
  const evalMetrics: RecipeEvalMetrics = {
    passAt1: asNumber(evalObj["passAt1"]),
    gate1To4PassRate: asNumber(evalObj["gate1To4PassRate"]),
    simRmse: asNumber(evalObj["simRmse"]),
    deltaTEce: asNumber(evalObj["deltaTEce"]),
    vramGb: asNumber(evalObj["vramGb"]),
    independentReproductions: asNumber(evalObj["independentReproductions"]),
    domainLeaderboardRank:
      rankObj && asString(rankObj["domain"]) && asNumber(rankObj["rank"]) !== undefined
        ? {
            domain: asString(rankObj["domain"])!,
            rank: asNumber(rankObj["rank"])!,
            tier: asString(rankObj["tier"]) || "<1.5B",
          }
        : undefined,
  };

  const rawSamples = Array.isArray(cfg["beforeAfterSamples"]) ? cfg["beforeAfterSamples"] : [];
  const beforeAfterSamples: RecipeBeforeAfterSample[] = rawSamples
    .map((s) => asRecord(s))
    .filter((s): s is Record<string, unknown> => Boolean(s && asString(s["title"])))
    .map((s) => ({
      title: asString(s["title"])!,
      dialect: asString(s["dialect"]) || "modelica",
      prompt: asString(s["prompt"]) || "",
      baseOutput: asString(s["baseOutput"]) || "",
      baseDeltaT: asNumber(s["baseDeltaT"]) ?? 0.65,
      baseGatesPassed: asNumber(s["baseGatesPassed"]) ?? 1,
      recipeOutput: asString(s["recipeOutput"]) || "",
      recipeDeltaT: asNumber(s["recipeDeltaT"]) ?? 0.14,
      recipeGatesPassed: asNumber(s["recipeGatesPassed"]) ?? 4,
    }));

  const rawBounties = Array.isArray(cfg["failureBounties"]) ? cfg["failureBounties"] : [];
  const failureBounties: RecipeFailureBounty[] = rawBounties
    .map((b) => asRecord(b))
    .filter((b): b is Record<string, unknown> => Boolean(b && asString(b["title"])))
    .map((b) => ({
      challengeId:
        typeof b["challengeId"] === "number" || typeof b["challengeId"] === "string" ? b["challengeId"] : undefined,
      title: asString(b["title"])!,
      dialect: asString(b["dialect"]) || "modelica",
      deltaT: asNumber(b["deltaT"]) ?? 0.5,
      bountyCredits: asNumber(b["bountyCredits"]),
      url: asString(b["url"]),
    }));

  const lineageObj = asRecord(cfg["lineage"]);
  const lineage: RecipeLineageInfo | undefined = lineageObj
    ? {
        parentPackage: asString(lineageObj["parentPackage"]),
        parentPostUrl: asString(lineageObj["parentPostUrl"]),
        parentAuthor: asString(lineageObj["parentAuthor"]),
        upstreamCredits: Array.isArray(lineageObj["upstreamCredits"])
          ? lineageObj["upstreamCredits"].filter((x): x is string => typeof x === "string")
          : undefined,
        diffEntries: Array.isArray(lineageObj["diffEntries"])
          ? (lineageObj["diffEntries"] as RecipeDiffEntry[])
          : undefined,
      }
    : undefined;

  const mode = targetModel?.mode;
  const webGpuRunnable = mode === "posttrain-lora" || mode === "posttrain-qlora" || mode === "projection-head-align";

  return {
    kind,
    title,
    packageName,
    version,
    authorHandle,
    summary,
    targetModel,
    dynamicM,
    rewardWeights,
    aiGovernance,
    memoryContract,
    memoryPins,
    datasetDependencies,
    evalMetrics,
    beforeAfterSamples,
    failureBounties,
    lineage,
    webGpuRunnable,
  };
}

/**
 * Computes a semantic diff between a parent `training-recipe` and a forked child recipe.
 */
export function computeRecipeSemanticDiff(
  parent: NormalizedTrainingRecipeCard,
  child: NormalizedTrainingRecipeCard,
): RecipeDiffEntry[] {
  const entries: RecipeDiffEntry[] = [];

  // Dataset dependency diffs
  const allDepKeys = new Set([...Object.keys(parent.datasetDependencies), ...Object.keys(child.datasetDependencies)]);
  for (const key of allDepKeys) {
    const pVer = parent.datasetDependencies[key];
    const cVer = child.datasetDependencies[key];
    if (!pVer && cVer) {
      entries.push({ field: `dataset:${key}`, kind: "added", after: cVer });
    } else if (pVer && !cVer) {
      entries.push({ field: `dataset:${key}`, kind: "removed", before: pVer });
    } else if (pVer !== cVer) {
      entries.push({ field: `dataset:${key}`, kind: "changed", before: pVer, after: cVer });
    }
  }

  // Dynamic-m schedule diffs
  if (parent.dynamicM && child.dynamicM) {
    const dmFields: (keyof DynamicMConfig)[] = ["mStart", "mMax", "mCap", "expansionTau", "retrievalTau"];
    for (const f of dmFields) {
      if (parent.dynamicM[f] !== child.dynamicM[f]) {
        entries.push({
          field: `dynamicM.${f}`,
          kind: "changed",
          before: String(parent.dynamicM[f]),
          after: String(child.dynamicM[f]),
        });
      }
    }
  }

  // Reward weight diffs
  if (parent.rewardWeights && child.rewardWeights) {
    for (const key of Object.keys(child.rewardWeights) as (keyof RecipeRewardWeights)[]) {
      const prev = parent.rewardWeights[key];
      const next = child.rewardWeights[key];
      if (prev !== next) {
        entries.push({
          field: `reward.${key}`,
          kind: "changed",
          before: prev.toFixed(2),
          after: next.toFixed(2),
        });
      }
    }
  }

  // Benchmark delta
  if (parent.evalMetrics.passAt1 !== undefined && child.evalMetrics.passAt1 !== undefined) {
    const diffPct = Math.round((child.evalMetrics.passAt1 - parent.evalMetrics.passAt1) * 100);
    if (diffPct !== 0) {
      entries.push({
        field: "eval.passAt1",
        kind: "changed",
        before: `${Math.round(parent.evalMetrics.passAt1 * 100)}%`,
        after: `${Math.round(child.evalMetrics.passAt1 * 100)}%`,
        deltaLabel: `${diffPct > 0 ? "+" : ""}${diffPct}%`,
      });
    }
  }

  return entries;
}

/**
 * Generates a ready-to-paste BibTeX citation for a `training-recipe` or `memory-shard` post.
 */
export function generateRecipeBibtex(recipe: NormalizedTrainingRecipeCard, postUrl?: string): string {
  const year = new Date().getFullYear();
  const slug = recipe.packageName.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const citeKey = `${slug}_${recipe.version.replace(/[^a-zA-Z0-9]+/g, "_")}_${year}`;
  const author = recipe.authorHandle || "Ansatz Community";
  const urlLine = postUrl ? `,\n  url          = {${postUrl}}` : "";
  const embedderNote = recipe.memoryContract?.embedderId ? ` (embedder: ${recipe.memoryContract.embedderId})` : "";

  return `@misc{${citeKey},
  title        = {{${recipe.title}}},
  author       = {${author}},
  year         = {${year}},
  howpublished = {Ansatz Federated Engineering Commons, ${recipe.kind} ${recipe.packageName}@${recipe.version}${embedderNote}}${urlLine}
}`;
}
