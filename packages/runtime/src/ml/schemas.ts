// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Relational Dynamic-m Zonotope ML & Governance Schemas.
 *
 * Defines the canonical cross-package contracts for:
 *   - 4-column Typed Relational Hypergraph tensors (`token_ids`, `group_ids`, `rel_type_ids`, `rel_signs`, `m_init`)
 *   - Extended ModelScript package manifest kinds (`dataset-pretrain`, `dataset-posttrain`, `training-recipe`,
 *     `model-core`, `lora-adapter`, `projection-head`) and AI data-governance consent policies
 *   - Dynamic-m curriculum & DiskANN vector-memory API contracts
 *   - Social RLHF Arena (`pairwise_arena`, `fix_it_bounty`, `tolerance_labeling`) payloads
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. 4-Column Typed Relational Hypergraph Contracts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ontological & physical relational edge types attached to each token position
 * in the 4-column Typed Relational Hypergraph.
 */
export enum RelTypeId {
  /** Locked syntax token, punctuation, or uncoupled literal (typically paired with `group_id = 0`). */
  NONE = 0,
  /** Co-referent variable, symbol occurrence, or semantically equivalent entity tied to the same ε_k. */
  IDENTITY_SYNC = 1,
  /** Opposite-sign coupled quantities (e.g., opposing forces, inverted logic, complementary tolerances). */
  INVERSE_COUPLE = 2,
  /** OWL2 / SysML2 class subsumption cone (`SubClassOf`, `:>`, `is-a`). */
  ONTOLOGY_ISA = 3,
  /** Conservation-law flow coupling (e.g., Modelica/SPICE KCL/KVL connector flow variables). */
  FLOW_CONSERVATION = 4,
  /** QUDV SI-7 physical unit scaling relationship (e.g., mm <-> m, kV <-> V). */
  UNIT_SCALE = 5,
  /** Geometric CAD GD&T tolerance envelope or parametric dimension cone. */
  GDT_TOLERANCE_CONE = 6,
}

export const REL_TYPE_NAMES: Record<RelTypeId, string> = {
  [RelTypeId.NONE]: "NONE",
  [RelTypeId.IDENTITY_SYNC]: "IDENTITY_SYNC",
  [RelTypeId.INVERSE_COUPLE]: "INVERSE_COUPLE",
  [RelTypeId.ONTOLOGY_ISA]: "ONTOLOGY_ISA",
  [RelTypeId.FLOW_CONSERVATION]: "FLOW_CONSERVATION",
  [RelTypeId.UNIT_SCALE]: "UNIT_SCALE",
  [RelTypeId.GDT_TOLERANCE_CONE]: "GDT_TOLERANCE_CONE",
};

/**
 * Per-token span metadata aligned 1:1 with `tokenIds`, `groupIds`, `relTypeIds`, and `relSigns`.
 * Used by the Ansatz Editor (Monaco/X6/CAD) to render live `group_id` overlays and hover tooltips.
 */
export interface RelationalTokenSpan {
  index: number;
  text: string;
  startOffset: number;
  endOffset: number;
  /** 1-indexed line number for Monaco decorations. */
  startLine: number;
  /** 1-indexed column number for Monaco decorations. */
  startColumn: number;
  /** 1-indexed end line number. */
  endLine: number;
  /** 1-indexed end column number. */
  endColumn: number;
  tokenId: number;
  groupId: number;
  relTypeId: RelTypeId;
  relSign: number;
  /** Optional resolved symbol or ontology IRI backing this token's `groupId`. */
  symbolName?: string | undefined;
  symbolKind?: string | undefined;
  ontologyIri?: string | undefined;
}

/**
 * Summary of a single perturbation generator dimension ε_k (k = 1..m_init).
 */
export interface GeneratorGroupSummary {
  groupId: number;
  label: string;
  primaryRelType: RelTypeId;
  tokenCount: number;
  symbolName?: string | undefined;
  ontologyIri?: string | undefined;
  toleranceSpec?: { lower?: number | undefined; upper?: number | undefined; unit?: string | undefined } | undefined;
}

/**
 * Formal 4-gate (+ CAD/Simulation) verification certificate embedded in every compiled example.
 */
export interface FormalCertificateSummary {
  gate1GlrSyntax: boolean;
  gate2QudvUnits: boolean;
  gate3SmtFeasibility: boolean;
  gate4DaeBalance: boolean;
  cadClearance?: boolean | undefined;
  simulationVerified?: boolean | undefined;
  diagnostics: string[];
  verifiedAtIso: string;
}

/**
 * Canonical 4-column Typed Relational Hypergraph record serialized to Arrow/Parquet shards
 * and returned by `modelscript/getRelationalHypergraph`.
 */
export interface RelationalHypergraphRecord {
  exampleId: string;
  uri: string;
  dialect: string;
  /** Exact input-adaptive initial generator count for Dynamic-m GPU batch bucketing. */
  mInit: number;
  /** Base vocabulary token IDs (`uint32[]`). */
  tokenIds: number[];
  /** Scoping IDs tying co-referent symbols to ε_k (`0` locks syntax/keywords/safety tokens). */
  groupIds: number[];
  /** Ontological / physical relation type IDs (`RelTypeId[]`). */
  relTypeIds: RelTypeId[];
  /** Coupling signs (`+1.0`, `-1.0`, `0.0`). */
  relSigns: number[];
  /** Aligned source spans for editor overlays and interactive overrides. */
  spans: RelationalTokenSpan[];
  /** Metadata per active generator ε_1 .. ε_{m_init}. */
  groups: GeneratorGroupSummary[];
  /** Optional formal verification certificate. */
  formalCert?: FormalCertificateSummary | undefined;
}

/**
 * User/annotator override applied to a specific token span or symbol group in the Ansatz Editor
 * or Social RLHF Tolerance Labeling UI.
 */
export interface HypergraphTokenOverride {
  /** Target by exact token index or by symbolName (applies to all occurrences). */
  tokenIndex?: number | undefined;
  symbolName?: string | undefined;
  /** Set `0` to lock the token as invariant syntax/safety critical. */
  groupId?: number | undefined;
  relTypeId?: RelTypeId | undefined;
  relSign?: -1 | 0 | 1 | undefined;
  ontologyIri?: string | undefined;
  toleranceSpec?: { lower?: number | undefined; upper?: number | undefined; unit?: string | undefined } | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Extended Package Kinds, AI Governance & Dynamic-m Training Recipe Schema
// ─────────────────────────────────────────────────────────────────────────────

export type MlPackageKind =
  | "dataset-pretrain"
  | "dataset-posttrain"
  | "training-recipe"
  | "memory-shard"
  | "model-core"
  | "lora-adapter"
  | "projection-head";

export type TenantScope = "public" | "org" | "project-private";

export interface AiGovernancePolicy {
  allowRag: boolean;
  allowPretrain: boolean;
  allowPosttrain: boolean;
  tenantScope: TenantScope;
  license?: string | undefined;
  /** Optional reciprocal/ShareAlike training license (e.g., "CC-BY-SA-4.0", "AGPL-3.0-or-later", "commercial-only"). */
  reciprocalTrainingLicense?: string | undefined;
  attributionRequired?: boolean | undefined;
  /** Creator royalty basis points (0..5000, e.g. 2000 = 20% of AI/retrieval credit spend). */
  royaltyBps?: number | undefined;
  /** Commercial / attribution rights tier for social network monetization. */
  licenseTier?: "open-attribution" | "commercial-revshare" | "org-private" | undefined;
  /** Optional CID of a revocation tombstone if the author withdrew consent. */
  revocationTombstoneCid?: string | undefined;
}

/**
 * Trust-pinned reference to a federated package or memory shard.
 * Prevents untrusted remote nodes from injecting vectors or training examples without explicit allowlisting.
 */
export interface MemoryShardPin {
  /** Federated origin domain (e.g., "ansatz.social", "lab-a.edu"). */
  originNode: string;
  /** Package identifier (e.g., "@modelica/msl-memory"). */
  packageName: string;
  /** Semver range or exact version pin. */
  version: string;
  /** Multibase Ed25519 public key (e.g., "z6Mk...") required to verify `eddsa-jcs-2022` proofs. */
  signerPubkey: string;
  /** Optional Git commit SHA for exact provenance pinning. */
  gitSha?: string | undefined;
}

/**
 * Canonical embedding-space contract carried by every `memory-shard` and `projection-head` package.
 * Ensures latent queries q = Normalize(W_q h_t + b_q) only hit vector indices sharing the exact embedder space.
 */
export interface MemoryShardContract {
  /** Canonical versioned embedding space ID (e.g., "ansatz-embed-v1"). */
  embedderId: string;
  /** Immutable SHA-256 weight digest of the canonical embedder. */
  embedderHash: string;
  /** Vector dimensionality matching W_q output dimension. */
  dimension: number;
  /** On-disk DiskANN quantization layout. */
  quantization: "int8-diskann" | "pq-diskann" | "fp16-diskann";
  /** Verified source packages compiled into this DiskANN + SPARQL shard. */
  sourcePackages: MemoryShardPin[];
}

/**
 * Elastic Dynamic-m Zonotope propagation & curriculum schedule.
 */
export interface DynamicMConfig {
  /** Warm-up generator cap (typically 1 for interval warm-up). */
  mStart: number;
  /** Target peak generator count during late annealing (typically 16-32). */
  mMax: number;
  /** Hard VRAM safety ceiling for Girard/SVD reduction. */
  mCap: number;
  /** Non-linear approximation gap threshold triggering selective generator expansion (m -> m + 1). */
  expansionTau: number;
  /** Vanishing-norm pruning floor (||g_k|| < pruneEps -> prune generator). */
  pruneEps: number;
  /** Cosine similarity threshold for merging nearly collinear generators (m -> m - 1). */
  collinearCosineThreshold: number;
  /** Frequency (in Transformer layers) for Girard/SVD order reduction when approaching `mCap`. */
  girardReduceEvery: number;
  /** Output zonotope spread threshold triggering DiskANN retrieval (Δ_t > retrievalTau). */
  retrievalTau: number;
}

export const DEFAULT_DYNAMIC_M_CONFIG: DynamicMConfig = {
  mStart: 1,
  mMax: 24,
  mCap: 32,
  expansionTau: 0.05,
  pruneEps: 1e-4,
  collinearCosineThreshold: 0.98,
  girardReduceEvery: 4,
  retrievalTau: 0.35,
};

/**
 * Target small-LLM architecture & LoRA + Query Projection Head configuration.
 */
export interface SmallLlmRecipeTarget {
  /** Base model package URI or HuggingFace/SafeTensors identifier (e.g. "0.5B-1.5B" small reasoning core). */
  baseModel: string;
  parameterScale: "0.5B" | "1B" | "1.5B" | "3B" | "7B" | "10B" | string;
  mode: "pretrain" | "posttrain-lora" | "posttrain-qlora" | "projection-head-align";
  loraRank?: number | undefined;
  loraAlpha?: number | undefined;
  /** Middle Transformer layer index where Linear Query Projection Head q = Normalize(W_q h_t + b_q) attaches. */
  projectionLayerIndex?: number | undefined;
  /** Output dimension of the DiskANN external retriever embedding space. */
  retrieverEmbeddingDim?: number | undefined;
}

/**
 * DiskANN NVMe-flash Vector DB configuration for decoupled external memory.
 */
export interface DiskAnnMemoryConfig {
  backend: "diskann";
  ramQuantization: "int8" | "pq" | "fp16";
  nvmeFlashEnabled: boolean;
  /** Pin retrieval to exact `package@semver` dependencies from `modelscript.json`. */
  semverPinned: boolean;
  includeVerifiedSocialPosts: boolean;
  latencySlaMs: number;
}

export interface MlPackageManifestExtension {
  kind: MlPackageKind;
  aiGovernance: AiGovernancePolicy;
  dynamicM?: DynamicMConfig | undefined;
  targetModel?: SmallLlmRecipeTarget | undefined;
  memoryConfig?: DiskAnnMemoryConfig | undefined;
  /** Canonical embedding-space contract (required for `memory-shard` and `projection-head`). */
  memoryContract?: MemoryShardContract | undefined;
  /** Explicit trust-pinned federated memory shards consumed by a workspace or `training-recipe`. */
  memoryPins?: MemoryShardPin[] | undefined;
  /** Formal reward weights for RLVR / GRPO post-training. */
  rewardWeights?:
    | {
        gate1Syntax: number;
        gate2Units: number;
        gate3Smt: number;
        gate4Dae: number;
        physicsSim: number;
        cadClearance: number;
        zonotopeContraction: number;
      }
    | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. DiskANN Memory API & Federated Control-Plane Contracts
// ─────────────────────────────────────────────────────────────────────────────

export interface MemoryQueryRequest {
  mode: "latent" | "hybrid";
  /** Quantized latent query vector q = Normalize(W_q h_t + b_q) when mode === "latent". */
  latentVector?: number[] | undefined;
  /** Canonical embedder ID of the calling projection head (required for latent queries). */
  embedderId?: string | undefined;
  /** Optional immutable SHA-256 hash of the canonical embedder for strict verification. */
  embedderHash?: string | undefined;
  /** Text/symbol query when mode === "hybrid". */
  textQuery?: string | undefined;
  /** Exact package@semver pins from the active workspace's `modelscript.json`. */
  packagePins?: Record<string, string> | undefined;
  /** Trust-pinned federated memory shards allowed to answer this query. */
  memoryPins?: MemoryShardPin[] | undefined;
  dialects?: string[] | undefined;
  includeSocialPosts?: boolean | undefined;
  topK?: number | undefined;
  tenantScope?: TenantScope | undefined;
}

export interface MemoryChunkResult {
  chunkId: string;
  sourceKind: "package-doc" | "package-symbol" | "owl2-axiom" | "social-post" | "rlhf-verified-fix";
  sourceUri: string;
  originNode?: string | undefined;
  packageName?: string | undefined;
  packageVersion?: string | undefined;
  dialect?: string | undefined;
  score: number;
  content: string;
  formalVerified: boolean;
  symbolTags: string[];
}

export interface MemoryQueryResponse {
  backend: "diskann";
  embedderId?: string | undefined;
  latencyMs: number;
  chunks: MemoryChunkResult[];
}

/**
 * ActivityStreams 2.0 control-plane announcement for a signed `memory-shard`, `dataset-*`,
 * or `training-recipe` release. Heavy Parquet/DiskANN blobs replicate asynchronously via `mirrorUrl`.
 */
export interface FederatedMemoryShardRelease {
  type: "ansatz:MemoryShardRelease" | "ansatz:DatasetRelease" | "ansatz:TrainingRecipeRelease";
  id: string;
  originNode: string;
  packageName: string;
  version: string;
  embedderId?: string | undefined;
  embedderHash?: string | undefined;
  manifestCid: string;
  mirrorUrl: string;
  signerPubkey: string;
  aiGovernance: AiGovernancePolicy;
  formalCertSummary: {
    gate1: boolean;
    gate2: boolean;
    gate3: boolean;
    gate4: boolean;
  };
}

/**
 * Independent peer verification attestation published over ActivityPub after a receiving node
 * re-verifies a remote release in its local WASM sandbox.
 */
export interface FederatedVerificationAttestation {
  type: "ansatz:VerificationAttestation";
  targetReleaseId: string;
  manifestCid: string;
  verifierNode: string;
  verifierPubkey: string;
  passedGates: {
    gate1: boolean;
    gate2: boolean;
    gate3: boolean;
    gate4: boolean;
  };
  verifiedAtIso: string;
}

export interface MemoryShardCompatibilityResult {
  compatible: boolean;
  reasons: string[];
}

/**
 * Validates whether a `MemoryQueryRequest` (from a small LLM's W_q projection head) is compatible
 * with a locally mirrored DiskANN `MemoryShardContract` and its origin/signer provenance.
 */
export function validateMemoryShardCompatibility(
  query: Pick<MemoryQueryRequest, "mode" | "embedderId" | "embedderHash" | "latentVector" | "memoryPins">,
  shard: {
    originNode: string;
    packageName: string;
    signerPubkey: string;
    aiGovernance: AiGovernancePolicy;
    memoryContract: MemoryShardContract;
  },
): MemoryShardCompatibilityResult {
  const reasons: string[] = [];

  if (!shard.aiGovernance.allowRag) {
    reasons.push(`Shard '${shard.packageName}' has aiGovernance.allowRag=false.`);
  }

  if (query.mode === "latent") {
    if (!query.embedderId) {
      reasons.push("Latent memory query must declare a canonical embedderId.");
    } else if (query.embedderId !== shard.memoryContract.embedderId) {
      reasons.push(
        `Embedder mismatch: query expects '${query.embedderId}', shard uses '${shard.memoryContract.embedderId}'.`,
      );
    }

    if (query.embedderHash && query.embedderHash !== shard.memoryContract.embedderHash) {
      reasons.push(
        `Embedder hash mismatch: query expects '${query.embedderHash}', shard uses '${shard.memoryContract.embedderHash}'.`,
      );
    }

    if (query.latentVector && query.latentVector.length !== shard.memoryContract.dimension) {
      reasons.push(
        `Latent vector dimension mismatch: got ${query.latentVector.length}, expected ${shard.memoryContract.dimension}.`,
      );
    }
  }

  if (query.memoryPins && query.memoryPins.length > 0) {
    const trusted = query.memoryPins.some(
      (pin) =>
        pin.originNode === shard.originNode &&
        pin.packageName === shard.packageName &&
        pin.signerPubkey === shard.signerPubkey,
    );
    if (!trusted) {
      reasons.push(
        `Shard '${shard.packageName}' from '${shard.originNode}' (signer '${shard.signerPubkey}') is not in query memoryPins.`,
      );
    }
  }

  return { compatible: reasons.length === 0, reasons };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Social Network RLHF Arena Contracts
// ─────────────────────────────────────────────────────────────────────────────

export type RlhfChallengeType = "pairwise_arena" | "fix_it_bounty" | "tolerance_labeling";

export interface RlhfCandidateSpec {
  id?: number | undefined;
  label: string;
  code: string;
  dialect: string;
  artifactId?: string | number | undefined;
  formalCert?: FormalCertificateSummary | undefined;
  mInit?: number | undefined;
  tokenCount?: number | undefined;
}

export interface RlhfAnnotationSubmission {
  /** Candidate ID preferred in `pairwise_arena` mode (or `"tie"` / `"both_bad"` via `preferenceOutcome`). */
  preferredCandidateId?: number | undefined;
  preferenceOutcome?: "candidate" | "tie" | "both_bad" | undefined;
  /** Structured engineering rationale tags (e.g., `"better-manufacturability"`, `"tighter-tolerance"`, `"cleaner-dae"`). */
  rationaleTags?: string[] | undefined;
  notes?: string | undefined;
  /** Verified code patch submitted in `fix_it_bounty` mode. */
  fixedCode?: string | undefined;
  /** Crowd-sourced relational zonotope overrides in `tolerance_labeling` mode. */
  hypergraphOverrides?: HypergraphTokenOverride[] | undefined;
}
