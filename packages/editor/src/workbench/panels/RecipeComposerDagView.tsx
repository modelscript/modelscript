// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Visual Recipe Composer DAG (`training-recipe`).
 *
 * Interactive 3-column SVG pipeline graph allowing engineers to compose a
 * `modelscript.json` `training-recipe` manifest by toggling & weighting Sources,
 * configuring Formal Verification / Dynamic-m Gates, and selecting Output Artifacts.
 */

import React, { useCallback, useMemo, useState } from "react";
import { checkZonotopeFeasibility, extractNumericParamsFromSource } from "../util/zonotope-feasibility.js";
import {
  DEFAULT_MODALITY_BUDGETS,
  toApiHypergraphOverrides,
  type ModalityPerturbationBudgets,
  type ZonotopeWorkbenchState,
} from "../util/zonotope-workbench-state.js";

export interface RecipeRewardWeights {
  gate1Syntax: number;
  gate2Units: number;
  gate3Smt: number;
  gate4Dae: number;
  physicsSim: number;
  cadClearance: number;
  zonotopeContraction: number;
}

export interface RecipeComposerDagViewProps {
  colorMode: "light" | "dark";
  dialect?: string | undefined;
  mStart?: number | undefined;
  mMax?: number | undefined;
  mCap?: number | undefined;
  retrievalTau?: number | undefined;
  rewardWeights?: RecipeRewardWeights | undefined;
  onUpdateDynamicM?: ((next: { mStart: number; mMax: number; mCap: number }) => void) | undefined;
  apiBaseUrl?: string | undefined;
  currentSource?: string | undefined;
  currentDialect?: string | undefined;
  zonotopeState?: ZonotopeWorkbenchState | undefined;
  onUpdateZonotopeBudgets?: ((patch: Partial<ModalityPerturbationBudgets>) => void) | undefined;
  onClearPendingOverrides?: (() => void) | undefined;
  currentDocumentUri?: string | undefined;
}

interface CommitOverlayPatchResponseDto {
  success?: boolean | undefined;
  patch?:
    | {
        id: number;
        recipeName?: string | undefined;
        exampleId?: string | undefined;
        action?: string | undefined;
        createdAt?: string | undefined;
      }
    | undefined;
  error?: string | undefined;
}

interface CompiledShardSummaryDto {
  shardId: string;
  recipeName?: string | undefined;
  recipeVersion?: string | undefined;
  datasetKind?: string | undefined;
  dialect: string;
  mMin: number;
  mMax: number;
  exampleCount: number;
  byteSize: number;
}

interface CompileShardsResponseDto {
  recipeName: string;
  recipeVersion: string;
  totalInputFiles: number;
  verifiedExamples: number;
  rejectedExamples: number;
  shards: CompiledShardSummaryDto[];
  error?: string | undefined;
}

interface DecontaminationMatchDto {
  trainUri: string;
  trainExampleId: string;
  evalUri: string;
  evalExampleId: string;
  matchKind: "exact-hash" | "near-duplicate";
  similarity: number;
}

interface DecontaminationReportDto {
  trainCount: number;
  evalCount: number;
  contaminatedCount: number;
  contaminationRate: number;
  matches: DecontaminationMatchDto[];
  recommendedQuarantineIds: string[];
  error?: string | undefined;
}

interface SignedPosttrainProofDto {
  type?: string | undefined;
  payloadSha256?: string | undefined;
  publicKeyMultibase?: string | undefined;
  verificationMethod?: string | undefined;
  created?: string | undefined;
  proofValue?: string | undefined;
}

interface ReleasePosttrainResponseDto {
  success?: boolean | undefined;
  recipeName: string;
  recipeVersion: string;
  datasetKind: string;
  includedChallengeCount: number;
  excludedHoneypotCount?: number | undefined;
  excludedNonPublicCount?: number | undefined;
  verifiedExamples: number;
  rejectedExamples: number;
  shards: CompiledShardSummaryDto[];
  proof?: SignedPosttrainProofDto | undefined;
  error?: string | undefined;
}

function fileExtForDialect(d: string): string {
  switch (d.toLowerCase()) {
    case "modelica":
      return "mo";
    case "sysml2":
      return "sysml";
    case "scad":
      return "scad";
    case "spice":
      return "sp";
    case "urdf":
      return "urdf";
    case "owl2":
      return "ofn";
    default:
      return "mo";
  }
}

function fallbackProbeSourceForDialect(d: string): string {
  switch (d.toLowerCase()) {
    case "scad":
      return "wall = 3.0;\nwidth = 40.0;\ncube([width, width, wall]);\n";
    case "sysml2":
      return "package RecipeProbe {\n  part def Actuator {\n    attribute mass : Real = 2.5;\n  }\n}\n";
    default:
      return "model RecipeProbe\n  parameter Real R = 100.0;\n  parameter Real C = 0.01;\n  Real v(start = 1.0);\nequation\n  R * C * der(v) + v = 0.0;\nend RecipeProbe;\n";
  }
}

const HELD_OUT_EVAL_PROBE =
  "model HeldOutThermalEval\n  parameter Real k = 0.45;\n  Real T(start = 300.0);\nequation\n  der(T) = -k * (T - 293.15);\nend HeldOutThermalEval;\n";

type SourceNodeId = "dataset-pretrain" | "dataset-posttrain" | "private-org-git" | "federated-diskann";
type GateNodeId = "formal-verifier-4gate" | "anti-reward-hacking" | "diskann-decontam" | "dynamic-m-curriculum";
type OutputNodeId = "m-init-shards" | "pinned-diskann-snapshot" | "webgpu-slurm-export";
type AnyDagNodeId = SourceNodeId | GateNodeId | OutputNodeId;

interface SourceNodeState {
  id: SourceNodeId;
  title: string;
  subtitle: string;
  badge: string;
  enabled: boolean;
  weightPct: number;
}

interface GateNodeState {
  id: GateNodeId;
  title: string;
  subtitle: string;
  badge: string;
  enabled: boolean;
}

interface OutputNodeState {
  id: OutputNodeId;
  title: string;
  subtitle: string;
  badge: string;
  enabled: boolean;
}

const DEFAULT_REWARD_WEIGHTS: RecipeRewardWeights = {
  gate1Syntax: 1.0,
  gate2Units: 1.0,
  gate3Smt: 1.2,
  gate4Dae: 1.5,
  physicsSim: 1.0,
  cadClearance: 1.2,
  zonotopeContraction: 0.6,
};

const INITIAL_SOURCES: SourceNodeState[] = [
  {
    id: "dataset-pretrain",
    title: "dataset-pretrain",
    subtitle: "MSL / CAD / SysML2",
    badge: "pretrain",
    enabled: true,
    weightPct: 45,
  },
  {
    id: "dataset-posttrain",
    title: "dataset-posttrain",
    subtitle: "Social RLHF Arena",
    badge: "posttrain",
    enabled: true,
    weightPct: 25,
  },
  {
    id: "private-org-git",
    title: "Private Org Git",
    subtitle: "Tenant-scoped repos",
    badge: "org-git",
    enabled: true,
    weightPct: 15,
  },
  {
    id: "federated-diskann",
    title: "Federated DiskANN Peers",
    subtitle: "Ed25519 trust-pinned",
    badge: "Ed25519",
    enabled: true,
    weightPct: 15,
  },
];

const INITIAL_GATES: GateNodeState[] = [
  {
    id: "formal-verifier-4gate",
    title: "4-Gate Formal Verifier",
    subtitle: "G1 GLR · G2 QUDV · G3 SMT · G4 DAE",
    badge: "G1–G4",
    enabled: true,
  },
  {
    id: "anti-reward-hacking",
    title: "Anti-Reward-Hacking Guard",
    subtitle: "Symbol coverage & triviality audit",
    badge: "RLVR",
    enabled: true,
  },
  {
    id: "diskann-decontam",
    title: "DiskANN Decontamination",
    subtitle: "Eval leakage & cosine dedup",
    badge: "Dedup",
    enabled: true,
  },
  {
    id: "dynamic-m-curriculum",
    title: "Dynamic-m Curriculum",
    subtitle: "m_start -> m_max -> m_cap",
    badge: "Zonotope",
    enabled: true,
  },
];

const INITIAL_OUTPUTS: OutputNodeState[] = [
  {
    id: "m-init-shards",
    title: "m_init-Bucketed Shards",
    subtitle: "HTTP 206 OPFS streaming",
    badge: "Shards",
    enabled: true,
  },
  {
    id: "pinned-diskann-snapshot",
    title: "Pinned DiskANN Snapshot",
    subtitle: "INT8 RAM + NVMe FP32",
    badge: "DiskANN",
    enabled: true,
  },
  {
    id: "webgpu-slurm-export",
    title: "WebGPU / Slurm Export",
    subtitle: "Browser LoRA & torchrun",
    badge: "Export",
    enabled: true,
  },
];

const SOURCE_TO_GATE_EDGES: ReadonlyArray<readonly [SourceNodeId, GateNodeId]> = [
  ["dataset-pretrain", "formal-verifier-4gate"],
  ["dataset-pretrain", "diskann-decontam"],
  ["dataset-pretrain", "dynamic-m-curriculum"],
  ["dataset-posttrain", "formal-verifier-4gate"],
  ["dataset-posttrain", "anti-reward-hacking"],
  ["dataset-posttrain", "dynamic-m-curriculum"],
  ["private-org-git", "formal-verifier-4gate"],
  ["private-org-git", "anti-reward-hacking"],
  ["private-org-git", "diskann-decontam"],
  ["federated-diskann", "diskann-decontam"],
  ["federated-diskann", "dynamic-m-curriculum"],
];

const GATE_TO_OUTPUT_EDGES: ReadonlyArray<readonly [GateNodeId, OutputNodeId]> = [
  ["formal-verifier-4gate", "m-init-shards"],
  ["formal-verifier-4gate", "pinned-diskann-snapshot"],
  ["anti-reward-hacking", "m-init-shards"],
  ["anti-reward-hacking", "webgpu-slurm-export"],
  ["diskann-decontam", "m-init-shards"],
  ["diskann-decontam", "pinned-diskann-snapshot"],
  ["dynamic-m-curriculum", "m-init-shards"],
  ["dynamic-m-curriculum", "webgpu-slurm-export"],
];

function slotCenterY(index: number, total: number): number {
  return ((index + 0.5) / total) * 100;
}

export const RecipeComposerDagView: React.FC<RecipeComposerDagViewProps> = ({
  colorMode,
  dialect = "modelica",
  mStart = 1,
  mMax = 24,
  mCap = 32,
  retrievalTau = 0.35,
  rewardWeights = DEFAULT_REWARD_WEIGHTS,
  onUpdateDynamicM,
  apiBaseUrl = "",
  currentSource,
  currentDialect,
  zonotopeState,
  onUpdateZonotopeBudgets,
  onClearPendingOverrides,
  currentDocumentUri,
}) => {
  const isDark = colorMode === "dark";
  const effectiveDialect = (currentDialect ?? dialect ?? "modelica").trim().toLowerCase() || "modelica";
  const normalizedApiBase = apiBaseUrl.replace(/\/+$/, "");
  const [recipeName, setRecipeName] = useState("@org/ansatz-training-recipe");
  const [recipeVersion, setRecipeVersion] = useState("0.1.0");
  const [sources, setSources] = useState<SourceNodeState[]>(INITIAL_SOURCES);
  const [gates, setGates] = useState<GateNodeState[]>(INITIAL_GATES);
  const [outputs, setOutputs] = useState<OutputNodeState[]>(INITIAL_OUTPUTS);
  const [selectedNode, setSelectedNode] = useState<AnyDagNodeId | null>("dynamic-m-curriculum");
  const [hoveredNode, setHoveredNode] = useState<AnyDagNodeId | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  // Live Executable DAG Action states
  const [runningAction, setRunningAction] = useState<"compile" | "decontaminate" | "release" | "commit-patch" | null>(
    null,
  );
  const [compileResult, setCompileResult] = useState<CompileShardsResponseDto | null>(null);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [decontamResult, setDecontamResult] = useState<DecontaminationReportDto | null>(null);
  const [decontamError, setDecontamError] = useState<string | null>(null);
  const [releaseResult, setReleaseResult] = useState<ReleasePosttrainResponseDto | null>(null);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [patchCommitResult, setPatchCommitResult] = useState<CommitOverlayPatchResponseDto | null>(null);
  const [patchCommitError, setPatchCommitError] = useState<string | null>(null);

  const [localBudgets, setLocalBudgets] = useState<ModalityPerturbationBudgets>(() => ({
    ...DEFAULT_MODALITY_BUDGETS,
  }));
  const effectiveBudgets: ModalityPerturbationBudgets = zonotopeState?.budgets ?? localBudgets;

  const updateBudgets = useCallback(
    (patch: Partial<ModalityPerturbationBudgets>) => {
      if (onUpdateZonotopeBudgets) {
        onUpdateZonotopeBudgets(patch);
      } else {
        setLocalBudgets((prev) => ({ ...prev, ...patch }));
      }
    },
    [onUpdateZonotopeBudgets],
  );

  const [localMStart, setLocalMStart] = useState(mStart);
  const [localMMax, setLocalMMax] = useState(mMax);
  const [localMCap, setLocalMCap] = useState(mCap);

  const effMStart = onUpdateDynamicM ? mStart : localMStart;
  const effMMax = onUpdateDynamicM ? mMax : localMMax;
  const effMCap = onUpdateDynamicM ? mCap : localMCap;

  const updateDynamicM = useCallback(
    (next: { mStart: number; mMax: number; mCap: number }) => {
      if (onUpdateDynamicM) {
        onUpdateDynamicM(next);
      } else {
        setLocalMStart(next.mStart);
        setLocalMMax(next.mMax);
        setLocalMCap(next.mCap);
      }
    },
    [onUpdateDynamicM],
  );

  const totalEnabledWeight = useMemo(
    () => sources.reduce((acc, s) => acc + (s.enabled ? s.weightPct : 0), 0),
    [sources],
  );

  const normalizedMixById = useMemo(() => {
    const map: Record<SourceNodeId, number> = {
      "dataset-pretrain": 0,
      "dataset-posttrain": 0,
      "private-org-git": 0,
      "federated-diskann": 0,
    };
    for (const s of sources) {
      map[s.id] = s.enabled && totalEnabledWeight > 0 ? Number((s.weightPct / totalEnabledWeight).toFixed(4)) : 0;
    }
    return map;
  }, [sources, totalEnabledWeight]);

  const sourceMap = useMemo(() => new Map(sources.map((s, idx) => [s.id, { node: s, idx }])), [sources]);
  const gateMap = useMemo(() => new Map(gates.map((g, idx) => [g.id, { node: g, idx }])), [gates]);
  const outputMap = useMemo(() => new Map(outputs.map((o, idx) => [o.id, { node: o, idx }])), [outputs]);

  const generatedManifest = useMemo(() => {
    const pretrainEnabled = sourceMap.get("dataset-pretrain")?.node.enabled ?? false;
    const posttrainEnabled = sourceMap.get("dataset-posttrain")?.node.enabled ?? false;
    const orgGitEnabled = sourceMap.get("private-org-git")?.node.enabled ?? false;
    const federatedEnabled = sourceMap.get("federated-diskann")?.node.enabled ?? false;

    const gate4Enabled = gateMap.get("formal-verifier-4gate")?.node.enabled ?? false;
    const antiHackEnabled = gateMap.get("anti-reward-hacking")?.node.enabled ?? false;
    const decontamEnabled = gateMap.get("diskann-decontam")?.node.enabled ?? false;
    const dynamicMEnabled = gateMap.get("dynamic-m-curriculum")?.node.enabled ?? false;

    const shardsOut = outputMap.get("m-init-shards")?.node.enabled ?? false;
    const snapshotOut = outputMap.get("pinned-diskann-snapshot")?.node.enabled ?? false;
    const exportOut = outputMap.get("webgpu-slurm-export")?.node.enabled ?? false;

    const langs = Array.from(new Set([effectiveDialect, "modelica", "scad", "sysml2"]));

    return {
      name: recipeName.trim() || "@org/ansatz-training-recipe",
      version: recipeVersion.trim() || "0.1.0",
      modelscript: {
        category: "training-recipe",
        languages: langs,
        ml: {
          kind: "training-recipe",
          aiGovernance: {
            allowRag: true,
            allowPretrain: pretrainEnabled,
            allowPosttrain: posttrainEnabled,
            tenantScope: orgGitEnabled ? "org" : "public",
            attributionRequired: true,
          },
          targetModel: {
            baseModel: "Qwen/Qwen2.5-Coder-1.5B",
            parameterScale: "1.5B",
            mode: posttrainEnabled ? "posttrain-lora" : "pretrain",
            loraRank: 16,
            loraAlpha: 32,
            projectionLayerIndex: 14,
            retrieverEmbeddingDim: 256,
          },
          dynamicM: {
            enabled: dynamicMEnabled,
            mStart: effMStart,
            mMax: effMMax,
            mCap: effMCap,
            expansionTau: 0.05,
            pruneEps: 0.0001,
            collinearCosineThreshold: 0.98,
            girardReduceEvery: 4,
            retrievalTau,
          },
          memoryConfig: {
            backend: "diskann",
            ramQuantization: "int8",
            nvmeFlashEnabled: true,
            semverPinned: snapshotOut,
            includeVerifiedSocialPosts: posttrainEnabled,
            latencySlaMs: 15,
          },
          memoryPins: federatedEnabled
            ? [
                {
                  originNode: "ansatz.social",
                  packageName: "@modelica/msl-memory",
                  version: "^4.0.0",
                  signerPubkey: "z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH",
                },
              ]
            : [],
          rewardWeights,
          perturbationBudgets: { ...effectiveBudgets },
          linearConstraints: (zonotopeState?.constraints ?? []).map((c) => ({
            id: c.id,
            expression: c.expression,
            coeffs: c.coeffs,
            sense: c.sense,
            rhs: c.rhs,
            modality: c.modality,
          })),
          faultGenerators: (zonotopeState?.faultGenerators ?? [])
            .filter((f) => f.enabled)
            .map((f) => ({
              id: f.id,
              componentName: f.componentName,
              faultMode: f.faultMode,
              severity: f.severity,
              enabled: f.enabled,
            })),
          pipelineDag: {
            sources: sources
              .filter((s) => s.enabled)
              .map((s) => ({
                id: s.id,
                label: s.title,
                weightPct: s.weightPct,
                normalizedMix: normalizedMixById[s.id],
              })),
            gates: {
              formalVerifier4Gate: gate4Enabled,
              antiRewardHackingGuard: antiHackEnabled,
              diskAnnDecontamination: decontamEnabled,
              dynamicMCurriculum: dynamicMEnabled,
            },
            outputs: {
              mInitBucketedShards: shardsOut,
              pinnedDiskAnnSnapshot: snapshotOut,
              webGpuSlurmExport: exportOut,
            },
          },
        },
      },
    };
  }, [
    recipeName,
    recipeVersion,
    effectiveDialect,
    sourceMap,
    gateMap,
    outputMap,
    effMStart,
    effMMax,
    effMCap,
    retrievalTau,
    rewardWeights,
    effectiveBudgets,
    zonotopeState?.constraints,
    zonotopeState?.faultGenerators,
    sources,
    normalizedMixById,
  ]);

  const manifestJson = useMemo(() => JSON.stringify(generatedManifest, null, 2), [generatedManifest]);

  const handleCopyManifest = useCallback(async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(manifestJson);
      } else if (typeof document !== "undefined") {
        const ta = document.createElement("textarea");
        ta.value = manifestJson;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopyFeedback("Copied modelscript.json ✓");
      window.setTimeout(() => setCopyFeedback(null), 2200);
    } catch {
      setCopyFeedback("Copy failed — select JSON below");
      window.setTimeout(() => setCopyFeedback(null), 2500);
    }
  }, [manifestJson]);

  const effectiveSource = useMemo(
    () =>
      currentSource && currentSource.trim().length > 0
        ? currentSource
        : fallbackProbeSourceForDialect(effectiveDialect),
    [currentSource, effectiveDialect],
  );

  const handleCompileShards = useCallback(async () => {
    setRunningAction("compile");
    setCompileError(null);
    try {
      const ml = generatedManifest.modelscript.ml;
      const datasetKind =
        ml.aiGovernance.allowPosttrain && !ml.aiGovernance.allowPretrain
          ? "dataset-posttrain"
          : ml.aiGovernance.allowPretrain
            ? "dataset-pretrain"
            : "training-recipe";
      const ext = fileExtForDialect(effectiveDialect);
      const res = await fetch(`${normalizedApiBase}/api/v1/memory/datasets/compile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          recipeName: generatedManifest.name,
          recipeVersion: generatedManifest.version,
          datasetKind,
          files: [
            {
              uri: `workspace://${effectiveDialect}/active.${ext}`,
              dialect: effectiveDialect,
              source: effectiveSource,
            },
          ],
          aiGovernance: ml.aiGovernance,
          requireFormalPass: ml.pipelineDag.gates.formalVerifier4Gate,
          mCap: effMCap,
          domain: effectiveDialect,
          parameterScale: ml.targetModel.parameterScale,
          targetModel: ml.targetModel,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as CompileShardsResponseDto;
      if (!res.ok) {
        throw new Error(data.error || `Shard compilation failed (HTTP ${res.status})`);
      }
      setCompileResult(data);
    } catch (e) {
      setCompileError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunningAction(null);
    }
  }, [generatedManifest, effectiveDialect, effectiveSource, normalizedApiBase, effMCap]);

  const handleRunDecontamination = useCallback(async () => {
    setRunningAction("decontaminate");
    setDecontamError(null);
    try {
      const ext = fileExtForDialect(effectiveDialect);
      const res = await fetch(`${normalizedApiBase}/api/v1/recipes/decontaminate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          train: [
            {
              uri: `train://${effectiveDialect}/active.${ext}`,
              dialect: effectiveDialect,
              source: effectiveSource,
            },
          ],
          eval: [
            {
              uri: "eval://heldout/thermal-reference.mo",
              dialect: "modelica",
              source: HELD_OUT_EVAL_PROBE,
            },
          ],
          nearDuplicateThreshold: 0.72,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as DecontaminationReportDto;
      if (!res.ok) {
        throw new Error(data.error || `Decontamination audit failed (HTTP ${res.status})`);
      }
      setDecontamResult(data);
    } catch (e) {
      setDecontamError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunningAction(null);
    }
  }, [effectiveDialect, effectiveSource, normalizedApiBase]);

  const handleReleasePosttrain = useCallback(async () => {
    setRunningAction("release");
    setReleaseError(null);
    try {
      const ml = generatedManifest.modelscript.ml;
      const res = await fetch(`${normalizedApiBase}/api/v1/recipes/release-posttrain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          recipeName: generatedManifest.name,
          recipeVersion: generatedManifest.version,
          dialect: effectiveDialect,
          mCap: effMCap,
          requireFormalPass: ml.pipelineDag.gates.formalVerifier4Gate,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as ReleasePosttrainResponseDto;
      if (!res.ok) {
        throw new Error(data.error || `Signed post-train release failed (HTTP ${res.status})`);
      }
      setReleaseResult(data);
    } catch (e) {
      setReleaseError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunningAction(null);
    }
  }, [generatedManifest, effectiveDialect, normalizedApiBase, effMCap]);

  const zonotopeStressScale = zonotopeState?.stressScale ?? 1.0;
  const zonotopeConstraints = useMemo(() => zonotopeState?.constraints ?? [], [zonotopeState?.constraints]);
  const pendingOverrides = useMemo(() => zonotopeState?.pendingOverrides ?? [], [zonotopeState?.pendingOverrides]);
  const overrideCount = pendingOverrides.length;
  const constraintCount = zonotopeConstraints.length;

  const extractedParams = useMemo(
    () => extractNumericParamsFromSource(effectiveSource, effectiveBudgets, 1.0),
    [effectiveSource, effectiveBudgets],
  );

  const zonotopeFeasibility = useMemo(
    () => checkZonotopeFeasibility(extractedParams, zonotopeConstraints, zonotopeStressScale),
    [extractedParams, zonotopeConstraints, zonotopeStressScale],
  );

  const gpuBucketingStats = useMemo(() => {
    const activeBands =
      (effectiveBudgets.textParaphraseRadius > 0 ? 1 : 0) +
      (effectiveBudgets.codeIdentifierScale > 0 ? 1 : 0) +
      (effectiveBudgets.diagramLayoutJitterPx > 0 || effectiveBudgets.diagramAllowRotation ? 1 : 0) +
      (effectiveBudgets.cadToleranceFraction > 0 ? 1 : 0) +
      (effectiveBudgets.physicsParamFraction > 0 ? 1 : 0);
    const projectedM = Math.max(effMStart, Math.round(effMStart + zonotopeFeasibility.estimatedMShift + activeBands));
    const clampedM = Math.min(effMCap, projectedM);
    const warpBucket = Math.min(effMCap, Math.max(4, Math.ceil(clampedM / 4) * 4));
    const efficiencyPct = Math.round((clampedM / Math.max(1, warpBucket)) * 100);
    return {
      projectedM,
      clampedM,
      warpBucket,
      efficiencyPct,
      exceedsCap: projectedM > effMCap,
    };
  }, [effectiveBudgets, effMStart, effMCap, zonotopeFeasibility.estimatedMShift]);

  const handleCommitVisualLabels = useCallback(async () => {
    setRunningAction("commit-patch");
    setPatchCommitError(null);
    setPatchCommitResult(null);
    try {
      const token =
        typeof window !== "undefined" && window.localStorage
          ? window.localStorage.getItem("modelscript-auth-token") ||
            window.localStorage.getItem("token") ||
            window.localStorage.getItem("auth_token")
          : null;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const res = await fetch(`${normalizedApiBase}/api/v1/recipes/patches`, {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({
          recipeName: generatedManifest.name,
          exampleId: currentDocumentUri || `workspace:${currentDialect || dialect || "modelica"}`,
          action: "hypergraph_override",
          reason: "Visual multi-modal zonotope labels & linear constraints authored in Ansatz Workbench",
          hypergraphOverrides: toApiHypergraphOverrides(pendingOverrides),
          constraints: zonotopeConstraints.map((c) => ({
            id: c.id,
            expression: c.expression,
            coeffs: c.coeffs,
            sense: c.sense,
            rhs: c.rhs,
          })),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as CommitOverlayPatchResponseDto;
      if (res.status === 401) {
        throw new Error(
          data.error ||
            "Authentication required (HTTP 401) — sign in to commit visual labels as a recipe overlay patch.",
        );
      }
      if (!res.ok) {
        throw new Error(data.error || `Overlay patch commit failed (HTTP ${res.status})`);
      }
      setPatchCommitResult(data);
      onClearPendingOverrides?.();
    } catch (e) {
      setPatchCommitError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunningAction(null);
    }
  }, [
    normalizedApiBase,
    generatedManifest.name,
    currentDocumentUri,
    currentDialect,
    dialect,
    pendingOverrides,
    zonotopeConstraints,
    onClearPendingOverrides,
  ]);

  const toggleSource = useCallback((id: SourceNodeId) => {
    setSources((prev) => prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)));
  }, []);

  const setSourceWeight = useCallback((id: SourceNodeId, weightPct: number) => {
    setSources((prev) => prev.map((s) => (s.id === id ? { ...s, weightPct } : s)));
  }, []);

  const toggleGate = useCallback((id: GateNodeId) => {
    setGates((prev) => prev.map((g) => (g.id === id ? { ...g, enabled: !g.enabled } : g)));
  }, []);

  const toggleOutput = useCallback((id: OutputNodeId) => {
    setOutputs((prev) => prev.map((o) => (o.id === id ? { ...o, enabled: !o.enabled } : o)));
  }, []);

  const border = isDark ? "#30363d" : "#d0d7de";
  const bg = isDark ? "#0d1117" : "#ffffff";
  const bgSubtle = isDark ? "#161b22" : "#f6f8fa";
  const fg = isDark ? "#e6edf3" : "#1f2328";
  const fgMuted = isDark ? "#8b949e" : "#656d76";
  const accent = isDark ? "#38bdf8" : "#0969da";
  const violet = isDark ? "#a78bfa" : "#8250df";
  const emerald = isDark ? "#34d399" : "#1a7f37";
  const amber = isDark ? "#fbbf24" : "#9a6700";
  const danger = isDark ? "#f87171" : "#cf222e";

  const focusNode = hoveredNode ?? selectedNode;
  const hasActionFeedback = Boolean(
    compileResult || compileError || decontamResult || decontamError || releaseResult || releaseError,
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Top Toolbar */}
      <div
        style={{
          border: `1px solid ${border}`,
          borderRadius: 8,
          padding: 10,
          background: bgSubtle,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 12 }}>Visual Recipe Composer DAG</strong>
          <input
            type="text"
            value={recipeName}
            onChange={(e) => setRecipeName(e.target.value)}
            aria-label="Recipe package name"
            style={{
              background: bg,
              color: fg,
              border: `1px solid ${border}`,
              borderRadius: 5,
              padding: "3px 7px",
              fontSize: 11,
              fontFamily: "monospace",
              width: 190,
            }}
          />
          <input
            type="text"
            value={recipeVersion}
            onChange={(e) => setRecipeVersion(e.target.value)}
            aria-label="Recipe version"
            style={{
              background: bg,
              color: fg,
              border: `1px solid ${border}`,
              borderRadius: 5,
              padding: "3px 6px",
              fontSize: 11,
              fontFamily: "monospace",
              width: 64,
            }}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, color: fgMuted, fontFamily: "monospace" }}>
            {sources.filter((s) => s.enabled).length}/4 sources · {gates.filter((g) => g.enabled).length}/4 gates ·{" "}
            {outputs.filter((o) => o.enabled).length}/3 outputs
          </span>
          <button
            type="button"
            onClick={() => void handleCopyManifest()}
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              border: `1px solid ${accent}`,
              background: "rgba(56,189,248,0.16)",
              color: accent,
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {copyFeedback ?? "Copy modelscript.json"}
          </button>
        </div>
      </div>

      {/* Live Executable Action Bar */}
      <div
        style={{
          border: `1px solid ${border}`,
          borderRadius: 8,
          padding: "9px 10px",
          background: bgSubtle,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <strong style={{ fontSize: 11 }}>Live Pipeline Execution</strong>
            <span style={{ fontSize: 10, color: fgMuted, fontFamily: "monospace" }}>
              dialect={effectiveDialect} · {currentSource?.trim() ? "active editor buffer" : "probe sample"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <button
              type="button"
              disabled={runningAction !== null}
              onClick={() => void handleCompileShards()}
              style={{
                padding: "4px 10px",
                borderRadius: 6,
                border: `1px solid ${accent}`,
                background: isDark ? "rgba(56,189,248,0.16)" : "rgba(9,105,218,0.1)",
                color: accent,
                fontSize: 11,
                fontWeight: 600,
                cursor: runningAction !== null ? "not-allowed" : "pointer",
                opacity: runningAction !== null && runningAction !== "compile" ? 0.55 : 1,
              }}
            >
              {runningAction === "compile" ? "Compiling Shards…" : "Compile Shards Now"}
            </button>
            <button
              type="button"
              disabled={runningAction !== null}
              onClick={() => void handleRunDecontamination()}
              style={{
                padding: "4px 10px",
                borderRadius: 6,
                border: `1px solid ${amber}`,
                background: isDark ? "rgba(251,191,36,0.14)" : "rgba(154,103,0,0.08)",
                color: amber,
                fontSize: 11,
                fontWeight: 600,
                cursor: runningAction !== null ? "not-allowed" : "pointer",
                opacity: runningAction !== null && runningAction !== "decontaminate" ? 0.55 : 1,
              }}
            >
              {runningAction === "decontaminate" ? "Auditing…" : "Run Decontamination"}
            </button>
            <button
              type="button"
              disabled={runningAction !== null}
              onClick={() => void handleReleasePosttrain()}
              style={{
                padding: "4px 10px",
                borderRadius: 6,
                border: `1px solid ${emerald}`,
                background: isDark ? "rgba(52,211,153,0.16)" : "rgba(26,127,55,0.1)",
                color: emerald,
                fontSize: 11,
                fontWeight: 600,
                cursor: runningAction !== null ? "not-allowed" : "pointer",
                opacity: runningAction !== null && runningAction !== "release" ? 0.55 : 1,
              }}
            >
              {runningAction === "release" ? "Signing Release…" : "Release Signed Post-Train"}
            </button>
          </div>
        </div>

        {hasActionFeedback && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 10, fontFamily: "monospace" }}>
            {/* Compile Shards Result */}
            {(compileError || compileResult) && (
              <div
                style={{
                  border: `1px solid ${compileError ? danger : accent}`,
                  borderRadius: 6,
                  padding: "6px 8px",
                  background: bg,
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                }}
              >
                <div style={{ fontWeight: 700, color: compileError ? danger : accent }}>
                  {compileError
                    ? `Compile Shards Error: ${compileError}`
                    : `Compiled Shards ✓ (${compileResult?.verifiedExamples ?? 0}/${compileResult?.totalInputFiles ?? 0} verified, ${compileResult?.rejectedExamples ?? 0} rejected)`}
                </div>
                {compileResult?.shards.map((sh) => (
                  <div key={sh.shardId} style={{ color: fg, wordBreak: "break-all" }}>
                    sha256: {sh.shardId} · {sh.dialect} · m_init∈[{sh.mMin}, {sh.mMax}] · {sh.exampleCount} ex (
                    {sh.byteSize} B)
                  </div>
                ))}
              </div>
            )}

            {/* Decontamination Audit Result */}
            {(decontamError || decontamResult) && (
              <div
                style={{
                  border: `1px solid ${
                    decontamError ? danger : (decontamResult?.contaminatedCount ?? 0) > 0 ? amber : emerald
                  }`,
                  borderRadius: 6,
                  padding: "6px 8px",
                  background: bg,
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                    color: decontamError ? danger : (decontamResult?.contaminatedCount ?? 0) > 0 ? amber : emerald,
                  }}
                >
                  {decontamError
                    ? `Decontamination Error: ${decontamError}`
                    : `Decontamination Rate: ${((decontamResult?.contaminationRate ?? 0) * 100).toFixed(2)}% (${
                        decontamResult?.contaminatedCount ?? 0
                      }/${decontamResult?.trainCount ?? 0} train vs ${decontamResult?.evalCount ?? 0} eval)`}
                </div>
                {decontamResult && decontamResult.matches.length > 0 && (
                  <div style={{ color: fgMuted }}>
                    Quarantine recommended: {decontamResult.recommendedQuarantineIds.join(", ")}
                  </div>
                )}
              </div>
            )}

            {/* Signed Post-Train Release Result */}
            {(releaseError || releaseResult) && (
              <div
                style={{
                  border: `1px solid ${releaseError ? danger : emerald}`,
                  borderRadius: 6,
                  padding: "6px 8px",
                  background: bg,
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                }}
              >
                <div style={{ fontWeight: 700, color: releaseError ? danger : emerald }}>
                  {releaseError
                    ? `Release Post-Train Error: ${releaseError}`
                    : `Ed25519 Signed Post-Train ✓ (${releaseResult?.includedChallengeCount ?? 0} RLHF challenges · ${
                        releaseResult?.verifiedExamples ?? 0
                      } verified · ${releaseResult?.shards.length ?? 0} shard${
                        (releaseResult?.shards.length ?? 0) === 1 ? "" : "s"
                      })`}
                </div>
                {releaseResult?.proof && (
                  <div style={{ color: fg, wordBreak: "break-all" }}>
                    proof={releaseResult.proof.type ?? "Ed25519Signature2020"} · payloadSha256=
                    {releaseResult.proof.payloadSha256 ?? "—"} · pubkey=
                    {releaseResult.proof.publicKeyMultibase ?? "—"}
                  </div>
                )}
                {releaseResult?.shards.map((sh) => (
                  <div key={sh.shardId} style={{ color: fgMuted, wordBreak: "break-all" }}>
                    shard: {sh.shardId} · m_init∈[{sh.mMin}, {sh.mMax}] · {sh.exampleCount} ex
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 5-Band Modality Perturbation Equalizer & Visual Overlay Patch Commit */}
      <div
        style={{
          border: `1px solid ${border}`,
          borderRadius: 8,
          padding: 10,
          background: bgSubtle,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <strong style={{ fontSize: 11 }}>5-Band Modality Perturbation Equalizer</strong>
            <span style={{ fontSize: 10, color: fgMuted, fontFamily: "monospace" }}>
              stress={Math.round(zonotopeStressScale * 100)}% · {extractedParams.length} params · {constraintCount} Cξ≤d
            </span>
          </div>
          <button
            type="button"
            disabled={runningAction !== null || (overrideCount === 0 && constraintCount === 0)}
            onClick={() => void handleCommitVisualLabels()}
            title={
              overrideCount === 0 && constraintCount === 0
                ? "Author visual generator overrides or linear constraints in the workbench to commit an overlay patch"
                : "Persist pending visual hypergraph overrides and linear constraints to /api/v1/recipes/patches"
            }
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              border: `1px solid ${overrideCount > 0 || constraintCount > 0 ? violet : border}`,
              background:
                overrideCount > 0 || constraintCount > 0
                  ? isDark
                    ? "rgba(167,139,250,0.18)"
                    : "rgba(130,80,223,0.1)"
                  : bg,
              color: overrideCount > 0 || constraintCount > 0 ? violet : fgMuted,
              fontSize: 11,
              fontWeight: 600,
              cursor:
                runningAction !== null || (overrideCount === 0 && constraintCount === 0) ? "not-allowed" : "pointer",
              opacity:
                runningAction !== null && runningAction !== "commit-patch"
                  ? 0.55
                  : overrideCount === 0 && constraintCount === 0
                    ? 0.65
                    : 1,
            }}
          >
            {runningAction === "commit-patch"
              ? "Committing Overlay Patch…"
              : `Commit ${overrideCount} Labels & ${constraintCount} Constraints as Overlay Patch`}
          </button>
        </div>

        {/* 5-Band Equalizer Sliders */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))",
            gap: 8,
          }}
        >
          {/* Band 1: ε_text */}
          <div
            style={{
              border: `1px solid ${border}`,
              borderRadius: 6,
              padding: "7px 8px",
              background: bg,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4 }}>
              <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 11, color: accent }}>ε_text</span>
              <span style={{ fontFamily: "monospace", fontSize: 10.5, fontWeight: 600 }}>
                ±{effectiveBudgets.textParaphraseRadius.toFixed(2)}
              </span>
            </div>
            <div style={{ fontSize: 9.5, color: fgMuted }}>Prose/Spec Paraphrase Radius</div>
            <input
              type="range"
              min={0}
              max={0.5}
              step={0.02}
              value={effectiveBudgets.textParaphraseRadius}
              onChange={(e) => updateBudgets({ textParaphraseRadius: Number(e.target.value) })}
              aria-label="Prose/Spec Paraphrase Radius"
              style={{ width: "100%", margin: 0, accentColor: accent }}
            />
          </div>

          {/* Band 2: ε_code */}
          <div
            style={{
              border: `1px solid ${border}`,
              borderRadius: 6,
              padding: "7px 8px",
              background: bg,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4 }}>
              <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 11, color: violet }}>ε_code</span>
              <span style={{ fontFamily: "monospace", fontSize: 10.5, fontWeight: 600 }}>
                ±{effectiveBudgets.codeIdentifierScale.toFixed(2)}
              </span>
            </div>
            <div style={{ fontSize: 9.5, color: fgMuted }}>Code Identifier / Semantic Perturbation</div>
            <input
              type="range"
              min={0}
              max={0.5}
              step={0.02}
              value={Math.min(0.5, effectiveBudgets.codeIdentifierScale)}
              onChange={(e) => updateBudgets({ codeIdentifierScale: Number(e.target.value) })}
              aria-label="Code Identifier / Semantic Perturbation"
              style={{ width: "100%", margin: 0, accentColor: violet }}
            />
          </div>

          {/* Band 3: ε_2d */}
          <div
            style={{
              border: `1px solid ${border}`,
              borderRadius: 6,
              padding: "7px 8px",
              background: bg,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4 }}>
              <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 11, color: emerald }}>ε_2d</span>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span style={{ fontFamily: "monospace", fontSize: 10.5, fontWeight: 600 }}>
                  ±{Math.round(effectiveBudgets.diagramLayoutJitterPx)} px
                </span>
                <button
                  type="button"
                  aria-pressed={effectiveBudgets.diagramAllowRotation}
                  onClick={() => updateBudgets({ diagramAllowRotation: !effectiveBudgets.diagramAllowRotation })}
                  title="Allow 90° schematic block rotations during layout-invariance augmentation"
                  style={{
                    padding: "1px 5px",
                    borderRadius: 4,
                    border: `1px solid ${effectiveBudgets.diagramAllowRotation ? emerald : border}`,
                    background: effectiveBudgets.diagramAllowRotation
                      ? isDark
                        ? "rgba(52,211,153,0.18)"
                        : "rgba(26,127,55,0.1)"
                      : bgSubtle,
                    color: effectiveBudgets.diagramAllowRotation ? emerald : fgMuted,
                    fontSize: 9.5,
                    fontFamily: "monospace",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  ↻ 90°
                </button>
              </div>
            </div>
            <div style={{ fontSize: 9.5, color: fgMuted }}>2D Schematic Layout Jitter</div>
            <input
              type="range"
              min={0}
              max={80}
              step={2}
              value={effectiveBudgets.diagramLayoutJitterPx}
              onChange={(e) => updateBudgets({ diagramLayoutJitterPx: Number(e.target.value) })}
              aria-label="2D Schematic Layout Jitter (px)"
              style={{ width: "100%", margin: 0, accentColor: emerald }}
            />
          </div>

          {/* Band 4: ε_3d */}
          <div
            style={{
              border: `1px solid ${border}`,
              borderRadius: 6,
              padding: "7px 8px",
              background: bg,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4 }}>
              <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 11, color: amber }}>ε_3d</span>
              <span style={{ fontFamily: "monospace", fontSize: 10.5, fontWeight: 600 }}>
                ±{Math.round(effectiveBudgets.cadToleranceFraction * 100)}%
              </span>
            </div>
            <div style={{ fontSize: 9.5, color: fgMuted }}>3D CAD GD&amp;T Tolerance Shell</div>
            <input
              type="range"
              min={0}
              max={0.25}
              step={0.01}
              value={effectiveBudgets.cadToleranceFraction}
              onChange={(e) => updateBudgets({ cadToleranceFraction: Number(e.target.value) })}
              aria-label="3D CAD GD&T Tolerance Shell"
              style={{ width: "100%", margin: 0, accentColor: amber }}
            />
          </div>

          {/* Band 5: ε_phys */}
          <div
            style={{
              border: `1px solid ${border}`,
              borderRadius: 6,
              padding: "7px 8px",
              background: bg,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 4 }}>
              <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 11, color: danger }}>ε_phys</span>
              <span style={{ fontFamily: "monospace", fontSize: 10.5, fontWeight: 600 }}>
                ±{Math.round(effectiveBudgets.physicsParamFraction * 100)}%
              </span>
            </div>
            <div style={{ fontSize: 9.5, color: fgMuted }}>Physics Parameter Perturbation</div>
            <input
              type="range"
              min={0}
              max={0.3}
              step={0.01}
              value={effectiveBudgets.physicsParamFraction}
              onChange={(e) => updateBudgets({ physicsParamFraction: Number(e.target.value) })}
              aria-label="Physics Parameter Perturbation"
              style={{ width: "100%", margin: 0, accentColor: danger }}
            />
          </div>
        </div>

        {/* Live Metrics Strip */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 8,
            fontFamily: "monospace",
          }}
        >
          <div
            style={{
              border: `1px solid ${border}`,
              borderRadius: 6,
              padding: "6px 8px",
              background: bg,
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <span style={{ fontSize: 9.5, color: fgMuted }}>Effective m_init Shift</span>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: accent }}>
              +{zonotopeFeasibility.estimatedMShift} dims
            </span>
          </div>

          <div
            style={{
              border: `1px solid ${gpuBucketingStats.exceedsCap ? danger : border}`,
              borderRadius: 6,
              padding: "6px 8px",
              background: bg,
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <span style={{ fontSize: 9.5, color: fgMuted }}>GPU Bucketing Efficiency</span>
            <span
              style={{
                fontSize: 11.5,
                fontWeight: 700,
                color: gpuBucketingStats.exceedsCap ? danger : gpuBucketingStats.efficiencyPct >= 75 ? emerald : amber,
              }}
            >
              {gpuBucketingStats.efficiencyPct}% (m≈{gpuBucketingStats.clampedM}/{effMCap} · bucket{" "}
              {gpuBucketingStats.warpBucket})
            </span>
          </div>

          <div
            style={{
              border: `1px solid ${zonotopeFeasibility.feasible ? emerald : danger}`,
              borderRadius: 6,
              padding: "6px 8px",
              background: zonotopeFeasibility.feasible
                ? isDark
                  ? "rgba(52,211,153,0.08)"
                  : "rgba(26,127,55,0.06)"
                : isDark
                  ? "rgba(248,113,113,0.14)"
                  : "rgba(207,34,46,0.08)",
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <span style={{ fontSize: 9.5, color: fgMuted }}>Constrained-Zonotope Feasibility Rate</span>
            <span
              style={{
                fontSize: 11.5,
                fontWeight: 700,
                color: zonotopeFeasibility.feasible ? emerald : danger,
              }}
            >
              {zonotopeFeasibility.feasible
                ? `${Math.round(zonotopeFeasibility.feasibilityRate * 100)}% feasible`
                : `0% — Empty Zonotope Conflict (${zonotopeFeasibility.conflictingConstraintIds.length})`}
            </span>
          </div>
        </div>

        {/* Overlay Patch Commit Feedback */}
        {(patchCommitResult || patchCommitError) && (
          <div
            style={{
              border: `1px solid ${patchCommitError ? danger : emerald}`,
              borderRadius: 6,
              padding: "6px 8px",
              background: bg,
              fontSize: 10.5,
              fontFamily: "monospace",
              color: patchCommitError ? danger : emerald,
              fontWeight: 600,
            }}
          >
            {patchCommitError
              ? `Overlay Patch Error: ${patchCommitError}`
              : `Patch #${patchCommitResult?.patch?.id ?? "—"} committed to shard overlay`}
          </div>
        )}
      </div>

      {/* 3-Column Interactive DAG Canvas with SVG Bezier Edges */}
      <div
        style={{
          border: `1px solid ${border}`,
          borderRadius: 8,
          padding: 12,
          background: bg,
          overflowX: "auto",
        }}
      >
        <div
          style={{
            minWidth: 660,
            display: "grid",
            gridTemplateColumns: "minmax(200px, 1.15fr) 52px minmax(195px, 1.05fr) 52px minmax(175px, 0.95fr)",
            alignItems: "stretch",
            rowGap: 8,
          }}
        >
          {/* Column Headers */}
          <div
            style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: fgMuted }}
          >
            1. Sources (Mix Weights)
          </div>
          <div />
          <div
            style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: fgMuted }}
          >
            2. Gates &amp; Transforms
          </div>
          <div />
          <div
            style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: fgMuted }}
          >
            3. Outputs
          </div>

          {/* Column 1: Sources */}
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 8 }}>
            {sources.map((src) => {
              const isSelected = selectedNode === src.id;
              const mixPct = (normalizedMixById[src.id] * 100).toFixed(1);
              return (
                <div
                  key={src.id}
                  onClick={() => setSelectedNode(src.id)}
                  onMouseEnter={() => setHoveredNode(src.id)}
                  onMouseLeave={() => setHoveredNode(null)}
                  style={{
                    border: `1px solid ${isSelected ? accent : src.enabled ? border : border}`,
                    borderRadius: 8,
                    padding: "8px 9px",
                    background: isSelected ? (isDark ? "rgba(56,189,248,0.1)" : "rgba(9,105,218,0.06)") : bgSubtle,
                    opacity: src.enabled ? 1 : 0.55,
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: 5,
                    transition: "border-color 120ms ease, opacity 120ms ease",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                    <label
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        cursor: "pointer",
                        fontWeight: 600,
                        fontSize: 11,
                      }}
                    >
                      <input type="checkbox" checked={src.enabled} onChange={() => toggleSource(src.id)} />
                      <span>{src.title}</span>
                    </label>
                    <span
                      style={{
                        fontSize: 9,
                        fontFamily: "monospace",
                        padding: "1px 5px",
                        borderRadius: 4,
                        border: `1px solid ${src.enabled ? accent : border}`,
                        color: src.enabled ? accent : fgMuted,
                      }}
                    >
                      {src.badge}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: fgMuted }}>{src.subtitle}</div>
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 1 }}
                  >
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      disabled={!src.enabled}
                      value={src.weightPct}
                      onChange={(e) => setSourceWeight(src.id, Number(e.target.value))}
                      aria-label={`${src.title} mix weight`}
                      style={{ flex: 1, margin: 0 }}
                    />
                    <span
                      style={{
                        fontSize: 10,
                        fontFamily: "monospace",
                        color: src.enabled ? fg : fgMuted,
                        minWidth: 56,
                        textAlign: "right",
                      }}
                    >
                      {src.weightPct}% ({mixPct}%)
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Gutter 1 -> 2 SVG Edges */}
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
            style={{ width: "100%", height: "100%", overflow: "visible" }}
          >
            {SOURCE_TO_GATE_EDGES.map(([fromId, toId]) => {
              const from = sourceMap.get(fromId);
              const to = gateMap.get(toId);
              if (!from || !to) return null;
              const y1 = slotCenterY(from.idx, sources.length);
              const y2 = slotCenterY(to.idx, gates.length);
              const active = from.node.enabled && to.node.enabled && from.node.weightPct > 0;
              const highlighted = focusNode === fromId || focusNode === toId;
              const weightFactor = active ? Math.max(0.35, Math.min(1, normalizedMixById[fromId] * 2.2)) : 0.25;
              const strokeColor = !active
                ? fgMuted
                : highlighted
                  ? accent
                  : isDark
                    ? "rgba(56,189,248,0.55)"
                    : "rgba(9,105,218,0.45)";
              const strokeWidth = !active ? 1 : highlighted ? 2.4 : 1.1 + weightFactor * 1.1;
              return (
                <path
                  key={`${fromId}->${toId}`}
                  d={`M 0 ${y1} C 50 ${y1}, 50 ${y2}, 100 ${y2}`}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth={strokeWidth}
                  strokeDasharray={active ? undefined : "3 3"}
                  strokeOpacity={active ? (highlighted ? 1 : focusNode ? 0.28 : 0.72) : 0.28}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>

          {/* Column 2: Gates & Transforms */}
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 8 }}>
            {gates.map((gate) => {
              const isSelected = selectedNode === gate.id;
              const dynamicSub =
                gate.id === "dynamic-m-curriculum"
                  ? `m_start=${effMStart} → m_max=${effMMax} → m_cap=${effMCap}`
                  : gate.subtitle;
              return (
                <div
                  key={gate.id}
                  onClick={() => setSelectedNode(gate.id)}
                  onMouseEnter={() => setHoveredNode(gate.id)}
                  onMouseLeave={() => setHoveredNode(null)}
                  style={{
                    border: `1px solid ${isSelected ? emerald : border}`,
                    borderRadius: 8,
                    padding: "8px 9px",
                    background: isSelected ? (isDark ? "rgba(52,211,153,0.1)" : "rgba(26,127,55,0.06)") : bgSubtle,
                    opacity: gate.enabled ? 1 : 0.55,
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    transition: "border-color 120ms ease, opacity 120ms ease",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                    <span style={{ fontWeight: 600, fontSize: 11 }}>{gate.title}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleGate(gate.id);
                      }}
                      style={{
                        padding: "1px 6px",
                        borderRadius: 4,
                        fontSize: 9,
                        fontFamily: "monospace",
                        fontWeight: 700,
                        cursor: "pointer",
                        border: `1px solid ${gate.enabled ? emerald : amber}`,
                        background: gate.enabled ? "rgba(52,211,153,0.14)" : "rgba(251,191,36,0.12)",
                        color: gate.enabled ? emerald : amber,
                      }}
                    >
                      {gate.enabled ? "ON" : "OFF"}
                    </button>
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: fgMuted,
                      fontFamily: gate.id === "dynamic-m-curriculum" ? "monospace" : undefined,
                    }}
                  >
                    {dynamicSub}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Gutter 2 -> 3 SVG Edges */}
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
            style={{ width: "100%", height: "100%", overflow: "visible" }}
          >
            {GATE_TO_OUTPUT_EDGES.map(([fromId, toId]) => {
              const from = gateMap.get(fromId);
              const to = outputMap.get(toId);
              if (!from || !to) return null;
              const y1 = slotCenterY(from.idx, gates.length);
              const y2 = slotCenterY(to.idx, outputs.length);
              const active = from.node.enabled && to.node.enabled;
              const highlighted = focusNode === fromId || focusNode === toId;
              const strokeColor = !active
                ? fgMuted
                : highlighted
                  ? emerald
                  : isDark
                    ? "rgba(52,211,153,0.58)"
                    : "rgba(26,127,55,0.48)";
              return (
                <path
                  key={`${fromId}->${toId}`}
                  d={`M 0 ${y1} C 50 ${y1}, 50 ${y2}, 100 ${y2}`}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth={!active ? 1 : highlighted ? 2.4 : 1.5}
                  strokeDasharray={active ? undefined : "3 3"}
                  strokeOpacity={active ? (highlighted ? 1 : focusNode ? 0.28 : 0.78) : 0.28}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>

          {/* Column 3: Outputs */}
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-around", gap: 8 }}>
            {outputs.map((out) => {
              const isSelected = selectedNode === out.id;
              return (
                <div
                  key={out.id}
                  onClick={() => setSelectedNode(out.id)}
                  onMouseEnter={() => setHoveredNode(out.id)}
                  onMouseLeave={() => setHoveredNode(null)}
                  style={{
                    border: `1px solid ${isSelected ? accent : border}`,
                    borderRadius: 8,
                    padding: "9px 10px",
                    background: isSelected ? (isDark ? "rgba(56,189,248,0.1)" : "rgba(9,105,218,0.06)") : bgSubtle,
                    opacity: out.enabled ? 1 : 0.55,
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    transition: "border-color 120ms ease, opacity 120ms ease",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                    <span style={{ fontWeight: 600, fontSize: 11 }}>{out.title}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleOutput(out.id);
                      }}
                      style={{
                        padding: "1px 6px",
                        borderRadius: 4,
                        fontSize: 9,
                        fontFamily: "monospace",
                        fontWeight: 700,
                        cursor: "pointer",
                        border: `1px solid ${out.enabled ? accent : border}`,
                        background: out.enabled ? "rgba(56,189,248,0.14)" : "transparent",
                        color: out.enabled ? accent : fgMuted,
                      }}
                    >
                      {out.enabled ? "EMIT" : "SKIP"}
                    </button>
                  </div>
                  <div style={{ fontSize: 10, color: fgMuted }}>{out.subtitle}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Selected Node Quick Inspector */}
      {selectedNode === "dynamic-m-curriculum" && (
        <div
          style={{
            border: `1px solid ${border}`,
            borderRadius: 8,
            padding: 10,
            background: bgSubtle,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600 }}>
            Dynamic-m Curriculum Schedule (<code>m_start → m_max → m_cap</code>)
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            <label style={{ fontSize: 11 }}>
              m_start: <code>{effMStart}</code>
              <input
                type="range"
                min={1}
                max={8}
                value={effMStart}
                onChange={(e) => updateDynamicM({ mStart: Number(e.target.value), mMax: effMMax, mCap: effMCap })}
                style={{ width: "100%" }}
              />
            </label>
            <label style={{ fontSize: 11 }}>
              m_max: <code>{effMMax}</code>
              <input
                type="range"
                min={4}
                max={32}
                value={effMMax}
                onChange={(e) => updateDynamicM({ mStart: effMStart, mMax: Number(e.target.value), mCap: effMCap })}
                style={{ width: "100%" }}
              />
            </label>
            <label style={{ fontSize: 11 }}>
              m_cap: <code>{effMCap}</code>
              <input
                type="range"
                min={8}
                max={64}
                value={effMCap}
                onChange={(e) => updateDynamicM({ mStart: effMStart, mMax: effMMax, mCap: Number(e.target.value) })}
                style={{ width: "100%" }}
              />
            </label>
          </div>
        </div>
      )}

      {/* Live modelscript.json Manifest Preview */}
      <div
        style={{
          border: `1px solid ${border}`,
          borderRadius: 8,
          padding: 10,
          background: bgSubtle,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <strong style={{ fontSize: 11 }}>
            Live <code>modelscript.json</code> Preview (<code>training-recipe</code>)
          </strong>
          <button
            type="button"
            onClick={() => void handleCopyManifest()}
            style={{
              padding: "3px 9px",
              borderRadius: 5,
              border: `1px solid ${border}`,
              background: bg,
              color: fg,
              fontSize: 10,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {copyFeedback ?? "Copy JSON"}
          </button>
        </div>
        <pre
          style={{
            margin: 0,
            padding: 8,
            borderRadius: 6,
            border: `1px solid ${border}`,
            background: bg,
            color: fg,
            fontSize: 10,
            fontFamily: "monospace",
            maxHeight: 220,
            overflow: "auto",
            whiteSpace: "pre",
          }}
        >
          {manifestJson}
        </pre>
      </div>
    </div>
  );
};

export default RecipeComposerDagView;
