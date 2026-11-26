// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Dataset & Training-Recipe Pre-Flight Debugger, Semantic Diff, Decontamination Scanner,
 * Single-Example X-Ray Diagnostics, Immutable Overlay Patches, Blast-Radius Lineage,
 * Columnar Shard Browser, Bulk Actions & Automated Post-Train Release API.
 *
 * Mounted at `/api/v1/recipes`:
 *   - `POST /preflight`           : Pre-flight Data Nutrition Label, Dynamic-m VRAM savings, reward-hacking & live DiskANN symbol coverage
 *   - `POST /diff`                : Semantic dataset version diff (`v1..v2`)
 *   - `POST /decontaminate`       : Train/Eval exact, 4-gram Jaccard & optional isomorphic hypergraph decontamination audit
 *   - `POST /coverage-and-fill`   : Geometric `m_init` & parameter manifold coverage analysis + certified ConstrainedZonotope fill synthesis
 *   - `POST /check-constraints`   : Exact ConstrainedZonotope feasibility, tightened parameter bounds, volume retention & conflicting constraint IDs
 *   - `POST /xray`                : Single-example 1-step Dynamic-m X-Ray (token heatmap + layer waterfall + ξ* worst-case corner)
 *   - `GET  /patches`             : List immutable dataset overlay patches (filtered by `recipeName` / `exampleId`)
 *   - `POST /patches`             : Create an immutable overlay patch (`quarantine` | `patch_source` | `hypergraph_override`)
 *   - `GET  /lineage/:exampleId`  : Compute Blast Radius for an `exampleId` or URI substring across patches, compiled shards, and DiskANN memory chunks
 *   - `POST /browse-shard`        : Paginated columnar shard browser joining active overlay patches with server-side filtering & sorting
 *   - `POST /bulk-action`         : Bulk `quarantine` overlay patch insertion or `spawn_campaign` sprint creation for failing examples
 *   - `POST /release-posttrain`   : Snapshot `consensus_reached`/`adjudicated` RLHF challenges into compiled `dataset-posttrain` shards + Ed25519 signed manifest
 */

import {
  analyzeGeometricCoverage,
  analyzeRecipePreFlight,
  auditIsomorphicContamination,
  auditTrainEvalContamination,
  compileRelationalHypergraph,
  ConstrainedZonotope,
  diagnoseExampleXRay,
  diffDatasetVersions,
  synthesizeConstrainedVariants,
  type AiGovernancePolicy,
  type FormalCertificateSummary,
  type HypergraphTokenOverride,
  type RecipeExampleInput,
  type RlhfChallengeType,
  type TenantScope,
} from "@modelscript/runtime";
import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LibraryDatabase } from "../database.js";
import { optionalAuth, requireAuth } from "../middleware/auth-middleware.js";
import { compileDatasetShards, type RawDatasetFileInput } from "../services/dataset-compiler.js";
import { getOrCreateDiskAnnService } from "../services/diskann-memory.js";
import {
  getDefaultDatasetSigningKeyPair,
  signDatasetManifestEd25519,
  type DatasetManifestPayload,
} from "../services/federated-diskann.js";
import { publicErrorMessage } from "../utils/http-error.js";
import {
  computeChallengePriorityScore,
  ensureAnnotationCampaignSchema,
  evaluateFormalGatesForCandidate,
  passesAllFormalGates,
  slugifyCampaignTitle,
  type CampaignDbRow,
  type ChallengeDbRow,
} from "./rlhf-arena.js";

type OverlayPatchAction = "quarantine" | "patch_source" | "hypergraph_override";

const VALID_PATCH_ACTIONS = new Set<OverlayPatchAction>(["quarantine", "patch_source", "hypergraph_override"]);

interface OverlayPatchRow {
  id: number;
  recipe_name: string;
  example_id: string;
  action: OverlayPatchAction;
  reason: string;
  patched_source: string | null;
  overrides_json: string | null;
  created_by: number | null;
  created_at: string;
}

interface ShardDbRow {
  shard_id: string;
  recipe_name: string;
  recipe_version: string;
  dataset_kind: "dataset-pretrain" | "dataset-posttrain" | "training-recipe";
  dialect: string;
  m_min: number;
  m_max: number;
  example_count: number;
  storage_path: string;
  byte_size: number;
  tenant_scope: TenantScope;
  provenance_json: string;
  created_at: string;
}

interface MemoryChunkLineageRow {
  chunk_id: string;
  source_kind: string;
  source_uri: string;
  package_name: string | null;
  package_version: string | null;
  git_sha: string | null;
  dialect: string;
  tenant_scope: TenantScope;
  org_id: number | null;
  formal_verified: number;
  symbol_tags_json: string;
  updated_at: string;
}

interface ShardJsonlRow {
  example_id?: string | undefined;
  uri?: string | undefined;
  dialect?: string | undefined;
  m_init?: number | undefined;
  token_ids?: unknown[] | undefined;
  group_ids?: unknown[] | undefined;
  rel_type_ids?: unknown[] | undefined;
  rel_signs?: unknown[] | undefined;
  source?: string | undefined;
  formal_cert?:
    | {
        gate1_glr?: boolean | undefined;
        gate2_units?: boolean | undefined;
        gate3_smt?: boolean | undefined;
        gate4_dae?: boolean | undefined;
        cad_clearance?: boolean | null | undefined;
      }
    | null
    | undefined;
}

interface BrowsableShardRow {
  exampleId: string;
  uri: string;
  dialect: string;
  mInit: number;
  tokenCount: number;
  groupCount: number;
  formalCert: {
    gate1GlrSyntax: boolean;
    gate2QudvUnits: boolean;
    gate3SmtFeasibility: boolean;
    gate4DaeBalance: boolean;
    cadClearance?: boolean | undefined;
    diagnostics?: string[] | undefined;
  } | null;
  gatePassed: boolean;
  quarantined: boolean;
  hasSourcePatch: boolean;
  hasHypergraphOverride: boolean;
  activePatches: ReturnType<typeof mapPatchRow>[];
  source?: string | undefined;
}

function resolveMlStorageDir(database: LibraryDatabase, storageDir?: string): string {
  if (storageDir && storageDir.trim()) {
    const clean = storageDir.trim();
    return path.basename(clean) === "ml-memory" ? clean : path.join(clean, "ml-memory");
  }
  const dbName = database.db.name;
  if (dbName && dbName !== ":memory:") {
    const dbDir = path.dirname(dbName);
    const siblingStorage = path.join(dbDir, "storage", "ml-memory");
    if (fs.existsSync(siblingStorage)) return siblingStorage;
    return path.join(dbDir, "ml-memory");
  }
  return path.join(os.tmpdir(), "modelscript-ml-memory");
}

function resolveExistingShardFilePath(
  database: LibraryDatabase,
  relOrAbsStoragePath: string,
  storageDir?: string,
): string | null {
  if (path.isAbsolute(relOrAbsStoragePath) && fs.existsSync(relOrAbsStoragePath)) {
    return relOrAbsStoragePath;
  }
  const candidates: string[] = [];
  if (storageDir && storageDir.trim()) {
    const clean = storageDir.trim();
    candidates.push(path.join(clean, "ml-memory", relOrAbsStoragePath));
    candidates.push(path.join(clean, relOrAbsStoragePath));
  }
  const dbName = database.db.name;
  if (dbName && dbName !== ":memory:") {
    const dbDir = path.dirname(dbName);
    candidates.push(path.join(dbDir, "storage", "ml-memory", relOrAbsStoragePath));
    candidates.push(path.join(dbDir, "ml-memory", relOrAbsStoragePath));
    candidates.push(path.join(dbDir, relOrAbsStoragePath));
  }
  candidates.push(path.join(resolveMlStorageDir(database, storageDir), relOrAbsStoragePath));
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function resolveCallerOrgId(req: Request): number | null {
  const rawHeader = req.headers["x-modelscript-org-id"];
  if (typeof rawHeader === "string" && /^\d+$/.test(rawHeader)) {
    return Number(rawHeader);
  }
  return null;
}

function parseJsonSafe<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizeExampleInputs(raw: unknown): RecipeExampleInput[] | null {
  if (!Array.isArray(raw)) return null;
  const out: RecipeExampleInput[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== "object") return null;
    const obj = item as Record<string, unknown>;
    if (typeof obj["source"] !== "string") return null;
    const uri = typeof obj["uri"] === "string" && obj["uri"].trim() ? obj["uri"].trim() : `example_${i}`;
    const dialect =
      typeof obj["dialect"] === "string" && obj["dialect"].trim() ? obj["dialect"].trim().toLowerCase() : "text";
    const entry: RecipeExampleInput = {
      uri,
      dialect,
      source: obj["source"],
    };
    if (typeof obj["exampleId"] === "string" && obj["exampleId"].trim()) {
      entry.exampleId = obj["exampleId"].trim();
    }
    out.push(entry);
  }
  return out;
}

type LinearConstraintSense = "<=" | ">=" | "==";

interface NormalizedParamSpec {
  name: string;
  nominal: number;
  halfWidth: number;
}

interface NormalizedLinearConstraint {
  id: string;
  expression?: string | undefined;
  coeffs: Record<string, number>;
  sense: LinearConstraintSense;
  rhs: number;
}

const VALID_CONSTRAINT_SENSES = new Set<LinearConstraintSense>(["<=", ">=", "=="]);

function normalizeConstraintParams(raw: unknown): NormalizedParamSpec[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: NormalizedParamSpec[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const obj = item as Record<string, unknown>;
    const name = typeof obj["name"] === "string" ? obj["name"].trim() : "";
    const nominal = obj["nominal"];
    const halfWidth = obj["halfWidth"];
    if (
      !name ||
      seen.has(name) ||
      typeof nominal !== "number" ||
      !Number.isFinite(nominal) ||
      typeof halfWidth !== "number" ||
      !Number.isFinite(halfWidth) ||
      halfWidth < 0
    ) {
      return null;
    }
    seen.add(name);
    out.push({ name, nominal, halfWidth });
  }
  return out;
}

function normalizeLinearConstraints(raw: unknown): NormalizedLinearConstraint[] | null {
  if (!Array.isArray(raw)) return null;
  const out: NormalizedLinearConstraint[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const obj = item as Record<string, unknown>;
    const id = typeof obj["id"] === "string" && obj["id"].trim() ? obj["id"].trim() : `c_${i}`;
    const sense = obj["sense"];
    const rhs = obj["rhs"];
    const rawCoeffs = obj["coeffs"];
    if (
      typeof sense !== "string" ||
      !VALID_CONSTRAINT_SENSES.has(sense as LinearConstraintSense) ||
      typeof rhs !== "number" ||
      !Number.isFinite(rhs) ||
      !rawCoeffs ||
      typeof rawCoeffs !== "object" ||
      Array.isArray(rawCoeffs)
    ) {
      return null;
    }
    const coeffs: Record<string, number> = {};
    for (const [k, v] of Object.entries(rawCoeffs as Record<string, unknown>)) {
      if (typeof v !== "number" || !Number.isFinite(v)) return null;
      coeffs[k] = v;
    }
    const expression = typeof obj["expression"] === "string" ? obj["expression"] : undefined;
    out.push({
      id,
      ...(expression !== undefined ? { expression } : {}),
      coeffs,
      sense: sense as LinearConstraintSense,
      rhs,
    });
  }
  return out;
}

function applyLinearConstraintToZonotope(
  cz: ConstrainedZonotope,
  constraint: NormalizedLinearConstraint,
  paramIndex: Map<string, number>,
  dim: number,
): ConstrainedZonotope {
  const h = new Array<number>(dim).fill(0);
  for (const [paramName, coeff] of Object.entries(constraint.coeffs)) {
    const idx = paramIndex.get(paramName);
    if (idx !== undefined) {
      h[idx] = (h[idx] ?? 0) + coeff;
    }
  }
  if (constraint.sense === "<=") {
    return cz.intersectHalfspace(h, constraint.rhs);
  }
  if (constraint.sense === ">=") {
    return cz.intersectHalfspace(
      h.map((v) => -v),
      -constraint.rhs,
    );
  }
  return cz.intersectHyperplane(h, constraint.rhs);
}

function isConstraintSubsetFeasible(
  baseCz: ConstrainedZonotope,
  constraints: NormalizedLinearConstraint[],
  paramIndex: Map<string, number>,
  dim: number,
): boolean {
  let cz = baseCz;
  for (const c of constraints) {
    cz = applyLinearConstraintToZonotope(cz, c, paramIndex, dim);
  }
  return cz.isFeasible();
}

function findConflictingConstraintIds(
  baseCz: ConstrainedZonotope,
  constraints: NormalizedLinearConstraint[],
  paramIndex: Map<string, number>,
  dim: number,
): string[] {
  if (constraints.length === 0) return [];

  const conflictingSet = new Set<string>();
  const remaining: NormalizedLinearConstraint[] = [];

  // 1. Identify constraints individually inconsistent with the parameter box
  for (const c of constraints) {
    const singleCz = applyLinearConstraintToZonotope(baseCz, c, paramIndex, dim);
    if (!singleCz.isFeasible()) {
      conflictingSet.add(c.id);
    } else {
      remaining.push(c);
    }
  }

  // 2. If remaining constraints are mutually inconsistent, extract a minimal conflicting subset (IIS)
  if (remaining.length > 0 && !isConstraintSubsetFeasible(baseCz, remaining, paramIndex, dim)) {
    if (remaining.length <= 64) {
      let active = [...remaining];
      for (let i = 0; i < remaining.length; i++) {
        const candidate = remaining[i]!;
        const withoutCandidate = active.filter((c) => c !== candidate);
        if (withoutCandidate.length > 0 && !isConstraintSubsetFeasible(baseCz, withoutCandidate, paramIndex, dim)) {
          active = withoutCandidate;
        }
      }
      for (const c of active) {
        conflictingSet.add(c.id);
      }
    } else {
      let accCz = baseCz;
      for (const c of remaining) {
        const nextCz = applyLinearConstraintToZonotope(accCz, c, paramIndex, dim);
        if (!nextCz.isFeasible()) {
          conflictingSet.add(c.id);
        } else {
          accCz = nextCz;
        }
      }
    }
  }

  // Fallback safeguard: ensure at least one conflicting ID is surfaced when infeasible
  if (conflictingSet.size === 0) {
    for (const c of constraints) {
      conflictingSet.add(c.id);
    }
  }

  const ordered: string[] = [];
  const emitted = new Set<string>();
  for (const c of constraints) {
    if (conflictingSet.has(c.id) && !emitted.has(c.id)) {
      emitted.add(c.id);
      ordered.push(c.id);
    }
  }
  return ordered;
}

function mapPatchRow(row: OverlayPatchRow) {
  const parsedOverrides = row.overrides_json ? parseJsonSafe<unknown>(row.overrides_json, undefined) : undefined;
  let hypergraphOverrides: HypergraphTokenOverride[] | undefined;
  let constraints: unknown[] | undefined;
  if (Array.isArray(parsedOverrides)) {
    hypergraphOverrides = parsedOverrides as HypergraphTokenOverride[];
  } else if (parsedOverrides && typeof parsedOverrides === "object") {
    const obj = parsedOverrides as Record<string, unknown>;
    if (Array.isArray(obj["overrides"])) {
      hypergraphOverrides = obj["overrides"] as HypergraphTokenOverride[];
    }
    if (Array.isArray(obj["constraints"])) {
      constraints = obj["constraints"];
    }
  }
  return {
    id: row.id,
    recipeName: row.recipe_name,
    exampleId: row.example_id,
    action: row.action,
    reason: row.reason,
    ...(row.patched_source !== null ? { patchedSource: row.patched_source } : {}),
    ...(hypergraphOverrides !== undefined ? { hypergraphOverrides } : {}),
    ...(constraints !== undefined ? { constraints } : {}),
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function loadDiskAnnIndexedSymbols(database: LibraryDatabase, callerOrgId: number | null): Set<string> {
  const symbols = new Set<string>();
  const rows = (
    callerOrgId !== null
      ? database.db
          .prepare(
            `SELECT symbol_tags_json FROM memory_chunks
             WHERE tenant_scope = 'public' OR (tenant_scope IN ('org', 'project-private') AND org_id = ?)`,
          )
          .all(callerOrgId)
      : database.db.prepare(`SELECT symbol_tags_json FROM memory_chunks WHERE tenant_scope = 'public'`).all()
  ) as { symbol_tags_json: string }[];

  for (const row of rows) {
    const tags = parseJsonSafe<unknown[]>(row.symbol_tags_json, []);
    if (!Array.isArray(tags)) continue;
    for (const tag of tags) {
      if (typeof tag === "string") {
        const clean = tag.trim();
        if (clean) symbols.add(clean);
      }
    }
  }
  return symbols;
}

export function recipeDebugRouter(database: LibraryDatabase, storageDir?: string): Router {
  const router = createRouter();

  /**
   * POST /api/v1/recipes/preflight
   * Runs Recipe Pre-Flight Analyzer with automatic live DiskANN symbol coverage auditing.
   */
  router.post("/preflight", optionalAuth, (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as {
        examples?: unknown;
        batchSize?: unknown;
        mCap?: unknown;
        includeDiskAnnCoverage?: unknown;
      };

      const examples = normalizeExampleInputs(body.examples);
      if (!examples) {
        return res.status(400).json({ error: "examples array of { uri, dialect, source } objects is required." });
      }

      const batchSize =
        typeof body.batchSize === "number" && Number.isFinite(body.batchSize) && body.batchSize > 0
          ? Math.floor(body.batchSize)
          : undefined;
      const mCap =
        typeof body.mCap === "number" && Number.isFinite(body.mCap) && body.mCap > 0
          ? Math.floor(body.mCap)
          : undefined;
      const includeDiskAnnCoverage = body.includeDiskAnnCoverage !== false;

      const indexedDiskAnnSymbols = includeDiskAnnCoverage
        ? loadDiskAnnIndexedSymbols(database, resolveCallerOrgId(req))
        : undefined;

      const report = analyzeRecipePreFlight(examples, {
        ...(batchSize !== undefined ? { batchSize } : {}),
        ...(mCap !== undefined ? { mCap } : {}),
        ...(indexedDiskAnnSymbols !== undefined ? { indexedDiskAnnSymbols } : {}),
      });

      return res.json(report);
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to run recipe pre-flight analysis") });
    }
  });

  /**
   * POST /api/v1/recipes/diff
   * Semantic dataset version diff (`v1..v2`) reporting added/removed/modified URIs,
   * dialect deltas, m_init shifts, estimated GPU activation memory multiplier, and reward-hacking delta.
   */
  router.post("/diff", optionalAuth, (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as { before?: unknown; after?: unknown };
      const before = normalizeExampleInputs(body.before);
      const after = normalizeExampleInputs(body.after);
      if (!before || !after) {
        return res.status(400).json({ error: "before and after arrays of { uri, dialect, source } are required." });
      }

      const diff = diffDatasetVersions(before, after);
      return res.json(diff);
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to diff dataset versions") });
    }
  });

  /**
   * POST /api/v1/recipes/decontaminate
   * Scans training examples against held-out eval examples for exact hash matches, 4-gram Jaccard near-duplicates,
   * and (when `isomorphic === true`) renaming-/rescaling-invariant hypergraph isomorphism leaks.
   */
  router.post("/decontaminate", optionalAuth, (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as {
        train?: unknown;
        eval?: unknown;
        nearDuplicateThreshold?: unknown;
        isomorphic?: unknown;
      };
      const train = normalizeExampleInputs(body.train);
      const evalExamples = normalizeExampleInputs(body.eval);
      if (!train || !evalExamples) {
        return res.status(400).json({ error: "train and eval arrays of { uri, dialect, source } are required." });
      }

      const threshold =
        typeof body.nearDuplicateThreshold === "number" &&
        Number.isFinite(body.nearDuplicateThreshold) &&
        body.nearDuplicateThreshold > 0 &&
        body.nearDuplicateThreshold <= 1
          ? body.nearDuplicateThreshold
          : undefined;

      const report = auditTrainEvalContamination(train, evalExamples, threshold);
      if (body.isomorphic === true) {
        const isomorphicReport = auditIsomorphicContamination(train, evalExamples, threshold);
        return res.json({
          ...report,
          isomorphicReport,
        });
      }
      return res.json(report);
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to run train/eval decontamination audit") });
    }
  });

  /**
   * POST /api/v1/recipes/coverage-and-fill
   * Profiles geometric `m_init` band & numeric parameter coverage to detect manifold holes,
   * then synthesizes ConstrainedZonotope parameter variants from `seedSource` (or the first
   * example's source) and runs all 4 formal verification gates on every synthesized candidate.
   */
  router.post("/coverage-and-fill", optionalAuth, (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as {
        examples?: unknown;
        seedSource?: unknown;
        dialect?: unknown;
        count?: unknown;
        deltaFraction?: unknown;
        seed?: unknown;
      };

      const examples = normalizeExampleInputs(body.examples);
      if (!examples) {
        return res.status(400).json({ error: "examples array of { uri, dialect, source } objects is required." });
      }

      const coverage = analyzeGeometricCoverage(examples);

      const explicitSeed = typeof body.seedSource === "string" && body.seedSource.trim() ? body.seedSource : null;
      const firstNonEmptyExample = examples.find((ex) => ex.source.trim().length > 0);
      const resolvedSeed = explicitSeed ?? firstNonEmptyExample?.source ?? null;
      const resolvedDialect =
        typeof body.dialect === "string" && body.dialect.trim()
          ? body.dialect.trim().toLowerCase()
          : (firstNonEmptyExample?.dialect ?? "modelica");
      const resolvedSeedUri = explicitSeed ? `seed://inline.${resolvedDialect}` : firstNonEmptyExample?.uri;
      const count =
        typeof body.count === "number" && Number.isFinite(body.count) && body.count >= 0
          ? Math.min(32, Math.floor(body.count))
          : 4;
      const deltaFraction =
        typeof body.deltaFraction === "number" && Number.isFinite(body.deltaFraction) && body.deltaFraction >= 0
          ? body.deltaFraction
          : 0.12;
      const rngSeed = typeof body.seed === "number" && Number.isFinite(body.seed) ? Math.floor(body.seed) : undefined;

      if (!resolvedSeed) {
        return res.json({
          coverage,
          coverageScore: coverage.coverageScore,
          mInitBands: coverage.mInitBands,
          parameterRanges: coverage.parameterRanges,
          manifoldHoles: coverage.manifoldHoles,
          synthesis: null,
          variants: [],
        });
      }

      const synthesisResult = synthesizeConstrainedVariants(resolvedSeed, resolvedDialect, {
        count,
        relativePerturbation: deltaFraction,
        ...(resolvedSeedUri ? { uri: resolvedSeedUri } : {}),
        ...(rngSeed !== undefined ? { seed: rngSeed } : {}),
      });

      const certifiedVariants = synthesisResult.variants.map((variant, index) => {
        const cert = evaluateFormalGatesForCandidate(variant.source, resolvedDialect);
        return {
          index,
          uri: variant.hypergraph.uri,
          exampleId: variant.hypergraph.exampleId,
          dialect: resolvedDialect,
          source: variant.source,
          parameters: variant.parameters,
          xi: variant.xi,
          mInit: variant.hypergraph.mInit,
          tokenCount: variant.hypergraph.tokenIds.length,
          formalCert: {
            gate1GlrSyntax: cert.gate1GlrSyntax,
            gate2QudvUnits: cert.gate2QudvUnits,
            gate3SmtFeasibility: cert.gate3SmtFeasibility,
            gate4DaeBalance: cert.gate4DaeBalance,
            ...(cert.cadClearance !== undefined ? { cadClearance: cert.cadClearance } : {}),
            diagnostics: cert.diagnostics,
          },
          gatePassed: passesAllFormalGates(cert),
        };
      });

      return res.json({
        coverage,
        coverageScore: coverage.coverageScore,
        mInitBands: coverage.mInitBands,
        parameterRanges: coverage.parameterRanges,
        manifoldHoles: coverage.manifoldHoles,
        synthesis: {
          feasible: synthesisResult.feasible,
          dialect: resolvedDialect,
          seedUri: resolvedSeedUri ?? null,
          deltaFraction,
          parameterNames: synthesisResult.parameterNames,
          nominalParameters: synthesisResult.nominalParameters,
          zonotope: {
            dim: synthesisResult.constrainedZonotope.dim,
            numGenerators: synthesisResult.constrainedZonotope.numGenerators,
            center: synthesisResult.constrainedZonotope.center,
          },
          variantCount: certifiedVariants.length,
          certifiedPassCount: certifiedVariants.filter((v) => v.gatePassed).length,
          variants: certifiedVariants,
        },
        variants: certifiedVariants,
      });
    } catch (err) {
      return res
        .status(500)
        .json({ error: publicErrorMessage(err, "Failed to analyze geometric coverage and synthesize fill variants") });
    }
  });

  /**
   * POST /api/v1/recipes/check-constraints
   * Evaluates exact feasibility, tightened parameter intervals, volume retention, and conflicting
   * constraint IDs for a box of uncertain parameters intersected with linear constraints using
   * `ConstrainedZonotope` arithmetic.
   */
  router.post("/check-constraints", optionalAuth, (req: Request, res: Response) => {
    const startMs = performance.now();
    try {
      const body = (req.body ?? {}) as {
        params?: unknown;
        constraints?: unknown;
        stressScale?: unknown;
      };

      const params = normalizeConstraintParams(body.params);
      if (!params) {
        return res.status(400).json({
          error:
            "params must be a non-empty array of { name, nominal, halfWidth } objects with unique names and halfWidth >= 0.",
        });
      }

      const constraints = normalizeLinearConstraints(body.constraints);
      if (!constraints) {
        return res.status(400).json({
          error: "constraints must be an array of { id, coeffs, sense, rhs } linear constraint objects.",
        });
      }

      const rawStressScale = body.stressScale;
      const stressScale =
        typeof rawStressScale === "number" && Number.isFinite(rawStressScale)
          ? Math.max(0, Math.min(5, rawStressScale))
          : 1.0;

      const n = params.length;
      const paramIndex = new Map<string, number>();
      const center = new Array<number>(n);
      const scaledHalfWidths = new Array<number>(n);
      const nominalBounds: Record<string, [number, number]> = {};
      const generators: number[][] = [];

      for (let i = 0; i < n; i++) {
        const p = params[i]!;
        const scaledHw = p.halfWidth * stressScale;
        paramIndex.set(p.name, i);
        center[i] = p.nominal;
        scaledHalfWidths[i] = scaledHw;
        nominalBounds[p.name] = [p.nominal - scaledHw, p.nominal + scaledHw];

        const col = new Array<number>(n).fill(0);
        col[i] = scaledHw;
        generators.push(col);
      }

      const baseCz = new ConstrainedZonotope(center, generators);
      let fullCz = baseCz;
      for (const constraint of constraints) {
        fullCz = applyLinearConstraintToZonotope(fullCz, constraint, paramIndex, n);
      }

      let feasible = fullCz.isFeasible();
      const tightenedBounds: Record<string, [number, number]> = {};
      let volumeRetention = 0;

      if (feasible) {
        const intervals = fullCz.toIntervals();
        const hasEmptyAxis = intervals.some(
          (iv) => !Number.isFinite(iv.lo) || !Number.isFinite(iv.hi) || iv.lo > iv.hi + 1e-6,
        );
        if (hasEmptyAxis) {
          feasible = false;
        } else {
          const retentionRatios: number[] = [];
          for (let i = 0; i < n; i++) {
            const p = params[i]!;
            const scaledHw = scaledHalfWidths[i]!;
            const nomLo = p.nominal - scaledHw;
            const nomHi = p.nominal + scaledHw;
            const iv = intervals[i];
            const rawLo = iv && Number.isFinite(iv.lo) ? iv.lo : nomLo;
            const rawHi = iv && Number.isFinite(iv.hi) ? iv.hi : nomHi;
            const lo = Math.max(nomLo, Math.min(nomHi, rawLo));
            const hi = Math.max(lo, Math.min(nomHi, rawHi));
            tightenedBounds[p.name] = [lo, hi];

            const nominalWidth = 2 * scaledHw;
            if (nominalWidth > 1e-12) {
              retentionRatios.push(Math.max(0, Math.min(1, (hi - lo) / nominalWidth)));
            }
          }

          if (retentionRatios.length === 0) {
            volumeRetention = 1;
          } else if (retentionRatios.some((r) => r <= 0)) {
            volumeRetention = 0;
          } else {
            const logSum = retentionRatios.reduce((acc, r) => acc + Math.log(r), 0);
            volumeRetention = Math.max(0, Math.min(1, Math.exp(logSum / retentionRatios.length)));
          }
        }
      }

      const conflictingConstraintIds = feasible ? [] : findConflictingConstraintIds(baseCz, constraints, paramIndex, n);

      const elapsedMs = Math.round((performance.now() - startMs) * 1000) / 1000;

      return res.status(200).json({
        feasible,
        engine: "constrained-zonotope",
        conflictingConstraintIds,
        tightenedBounds,
        nominalBounds,
        volumeRetention,
        paramCount: n,
        constraintCount: constraints.length,
        elapsedMs,
      });
    } catch (err) {
      return res
        .status(500)
        .json({ error: publicErrorMessage(err, "Failed to evaluate ConstrainedZonotope constraints") });
    }
  });

  /**
   * POST /api/v1/recipes/xray
   * Runs a 1-step Dynamic-m X-Ray forward pass producing token heatmap, generator lifecycle waterfall, and ξ* worst-case corner.
   */
  router.post("/xray", optionalAuth, async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as {
        source?: unknown;
        dialect?: unknown;
        uri?: unknown;
        computeDialM?: unknown;
        overrides?: unknown;
      };

      if (typeof body.source !== "string" || !body.source.trim()) {
        return res.status(400).json({ error: "Non-empty source string is required." });
      }
      const dialect =
        typeof body.dialect === "string" && body.dialect.trim() ? body.dialect.trim().toLowerCase() : "modelica";
      const uri = typeof body.uri === "string" && body.uri.trim() ? body.uri.trim() : undefined;
      const computeDialM =
        typeof body.computeDialM === "number" && Number.isFinite(body.computeDialM) && body.computeDialM >= 0
          ? Math.floor(body.computeDialM)
          : undefined;
      const overrides = Array.isArray(body.overrides) ? (body.overrides as HypergraphTokenOverride[]) : undefined;

      const diagnostics = await diagnoseExampleXRay(body.source, dialect, {
        ...(uri !== undefined ? { uri } : {}),
        ...(computeDialM !== undefined ? { computeDialM } : {}),
        ...(overrides !== undefined ? { overrides } : {}),
      });

      return res.json(diagnostics);
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to execute example X-Ray diagnostics") });
    }
  });

  /**
   * GET /api/v1/recipes/patches
   * Lists immutable overlay patches filtered optionally by `recipeName` or `exampleId`.
   */
  router.get("/patches", optionalAuth, (req: Request, res: Response) => {
    try {
      const recipeName = typeof req.query["recipeName"] === "string" ? req.query["recipeName"].trim() : "";
      const exampleId = typeof req.query["exampleId"] === "string" ? req.query["exampleId"].trim() : "";

      const where: string[] = [];
      const params: unknown[] = [];
      if (recipeName) {
        where.push("recipe_name = ?");
        params.push(recipeName);
      }
      if (exampleId) {
        where.push("example_id = ?");
        params.push(exampleId);
      }

      const sql =
        where.length > 0
          ? `SELECT * FROM dataset_overlay_patches WHERE ${where.join(" AND ")} ORDER BY created_at DESC, id DESC`
          : `SELECT * FROM dataset_overlay_patches ORDER BY created_at DESC, id DESC`;

      const rows = database.db.prepare(sql).all(...params) as OverlayPatchRow[];
      const patches = rows.map(mapPatchRow);
      return res.json({ patches, total: patches.length });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to list dataset overlay patches") });
    }
  });

  /**
   * POST /api/v1/recipes/patches
   * Persists a new immutable overlay patch (`quarantine`, `patch_source`, or `hypergraph_override`).
   */
  router.post("/patches", requireAuth, (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as {
        recipeName?: unknown;
        exampleId?: unknown;
        action?: unknown;
        reason?: unknown;
        patchedSource?: unknown;
        hypergraphOverrides?: unknown;
        overrides?: unknown;
        constraints?: unknown;
      };

      const recipeName = typeof body.recipeName === "string" ? body.recipeName.trim() : "";
      const exampleId = typeof body.exampleId === "string" ? body.exampleId.trim() : "";
      const action = typeof body.action === "string" ? (body.action.trim() as OverlayPatchAction) : null;
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";

      if (!recipeName) {
        return res.status(400).json({ error: "recipeName string is required." });
      }
      if (!exampleId) {
        return res.status(400).json({ error: "exampleId string is required." });
      }
      if (!action || !VALID_PATCH_ACTIONS.has(action)) {
        return res.status(400).json({
          error: "action must be one of 'quarantine', 'patch_source', or 'hypergraph_override'.",
        });
      }

      const patchedSource = typeof body.patchedSource === "string" ? body.patchedSource : null;
      if (action === "patch_source" && patchedSource === null) {
        return res.status(400).json({ error: "patchedSource string is required when action === 'patch_source'." });
      }

      const rawOverrides = body.hypergraphOverrides ?? body.overrides;
      const overridesArr = Array.isArray(rawOverrides) ? rawOverrides : null;
      const constraintsArr = Array.isArray(body.constraints) ? body.constraints : null;
      const hasOverrides = overridesArr !== null && overridesArr.length > 0;
      const hasConstraints = constraintsArr !== null && constraintsArr.length > 0;
      if (action === "hypergraph_override" && !hasOverrides && !hasConstraints) {
        return res.status(400).json({
          error:
            "hypergraphOverrides (or overrides) or constraints non-empty array is required when action === 'hypergraph_override'.",
        });
      }

      const overridesJson = hasConstraints
        ? JSON.stringify({
            ...(hasOverrides ? { overrides: overridesArr } : {}),
            constraints: constraintsArr,
          })
        : overridesArr
          ? JSON.stringify(overridesArr)
          : null;
      const createdBy = req.user?.id ?? null;

      const info = database.db
        .prepare(
          `INSERT INTO dataset_overlay_patches (
             recipe_name, example_id, action, reason, patched_source, overrides_json, created_by
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(recipeName, exampleId, action, reason, patchedSource, overridesJson, createdBy);

      const inserted = database.db
        .prepare(`SELECT * FROM dataset_overlay_patches WHERE id = ?`)
        .get(info.lastInsertRowid) as OverlayPatchRow;

      let quarantinedMemoryChunks = 0;
      if (action === "quarantine") {
        try {
          const diskAnnDir = storageDir ? path.join(storageDir, "ml-memory") : undefined;
          quarantinedMemoryChunks = getOrCreateDiskAnnService(database, diskAnnDir).quarantineBySourceUri(
            exampleId,
            true,
          );
        } catch {
          // Non-fatal DiskANN sync
        }
      }

      return res.status(201).json({
        success: true,
        patch: mapPatchRow(inserted),
        ...(action === "quarantine" ? { quarantinedMemoryChunks } : {}),
      });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to create dataset overlay patch") });
    }
  });

  /**
   * GET /api/v1/recipes/lineage/:exampleId
   * Computes Blast Radius for an `exampleId` (or URI substring) across:
   *   1. `dataset_overlay_patches`
   *   2. `compiled_dataset_shards` (matching provenance, uris, exampleIds, recipe_names, or patched recipes)
   *   3. `memory_chunks` (respecting RBAC tenant scope)
   */
  router.get("/lineage/:exampleId", optionalAuth, (req: Request, res: Response) => {
    try {
      const rawParam = String(req.params["exampleId"] ?? "").trim();
      if (!rawParam) {
        return res.status(400).json({ error: "exampleId parameter is required." });
      }

      const needle = rawParam;
      const needleLower = needle.toLowerCase();
      const likePattern = `%${needle}%`;
      const callerOrgId = resolveCallerOrgId(req);

      // 1. Matching overlay patches
      const patchRows = database.db
        .prepare(
          `SELECT * FROM dataset_overlay_patches
           WHERE example_id = ? OR LOWER(example_id) LIKE LOWER(?) OR LOWER(recipe_name) LIKE LOWER(?)
           ORDER BY created_at DESC, id DESC`,
        )
        .all(needle, likePattern, likePattern) as OverlayPatchRow[];

      const overlayPatches = patchRows.map(mapPatchRow);
      const patchedRecipeNames = new Set(overlayPatches.map((p) => p.recipeName));

      // 2. Scan compiled_dataset_shards for matching provenance / uris / exampleIds / recipe_names
      const shardRows = database.db
        .prepare(
          `SELECT * FROM compiled_dataset_shards
           WHERE tenant_scope = 'public'
           ORDER BY created_at DESC`,
        )
        .all() as ShardDbRow[];

      const compiledShards: {
        shardId: string;
        recipeName: string;
        recipeVersion: string;
        datasetKind: ShardDbRow["dataset_kind"];
        dialect: string;
        mMin: number;
        mMax: number;
        exampleCount: number;
        byteSize: number;
        matchReasons: string[];
        provenance: Record<string, unknown>;
        createdAt: string;
      }[] = [];

      for (const row of shardRows) {
        const provenance = parseJsonSafe<Record<string, unknown>>(row.provenance_json, {});
        const matchReasons: string[] = [];

        if (row.shard_id.toLowerCase().includes(needleLower)) {
          matchReasons.push("shard_id");
        }
        if (row.recipe_name.toLowerCase().includes(needleLower)) {
          matchReasons.push("recipe_name");
        }
        if (patchedRecipeNames.has(row.recipe_name)) {
          matchReasons.push("overlay_patch_recipe");
        }
        if (row.provenance_json.toLowerCase().includes(needleLower)) {
          matchReasons.push("provenance");
        }

        if (matchReasons.length > 0) {
          compiledShards.push({
            shardId: row.shard_id,
            recipeName: row.recipe_name,
            recipeVersion: row.recipe_version,
            datasetKind: row.dataset_kind,
            dialect: row.dialect,
            mMin: row.m_min,
            mMax: row.m_max,
            exampleCount: row.example_count,
            byteSize: row.byte_size,
            matchReasons,
            provenance,
            createdAt: row.created_at,
          });
        }
      }

      // 3. Scan DiskANN memory_chunks respecting RBAC tenant scope
      const chunkRows = (
        callerOrgId !== null
          ? database.db
              .prepare(
                `SELECT chunk_id, source_kind, source_uri, package_name, package_version, git_sha,
                        dialect, tenant_scope, org_id, formal_verified, symbol_tags_json, updated_at
                 FROM memory_chunks
                 WHERE (tenant_scope = 'public' OR (tenant_scope IN ('org', 'project-private') AND org_id = ?))
                   AND (
                     chunk_id = ?
                     OR LOWER(source_uri) LIKE LOWER(?)
                     OR LOWER(COALESCE(package_name, '')) LIKE LOWER(?)
                     OR LOWER(symbol_tags_json) LIKE LOWER(?)
                   )
                 ORDER BY updated_at DESC
                 LIMIT 200`,
              )
              .all(callerOrgId, needle, likePattern, likePattern, likePattern)
          : database.db
              .prepare(
                `SELECT chunk_id, source_kind, source_uri, package_name, package_version, git_sha,
                        dialect, tenant_scope, org_id, formal_verified, symbol_tags_json, updated_at
                 FROM memory_chunks
                 WHERE tenant_scope = 'public'
                   AND (
                     chunk_id = ?
                     OR LOWER(source_uri) LIKE LOWER(?)
                     OR LOWER(COALESCE(package_name, '')) LIKE LOWER(?)
                     OR LOWER(symbol_tags_json) LIKE LOWER(?)
                   )
                 ORDER BY updated_at DESC
                 LIMIT 200`,
              )
              .all(needle, likePattern, likePattern, likePattern)
      ) as MemoryChunkLineageRow[];

      const memoryChunks = chunkRows.map((c) => ({
        chunkId: c.chunk_id,
        sourceKind: c.source_kind,
        sourceUri: c.source_uri,
        packageName: c.package_name,
        packageVersion: c.package_version,
        gitSha: c.git_sha,
        dialect: c.dialect,
        tenantScope: c.tenant_scope,
        formalVerified: c.formal_verified === 1,
        symbolTags: parseJsonSafe<string[]>(c.symbol_tags_json, []),
        updatedAt: c.updated_at,
      }));

      const affectedRecipes = Array.from(
        new Set([...overlayPatches.map((p) => p.recipeName), ...compiledShards.map((s) => s.recipeName)]),
      ).sort();

      return res.json({
        exampleId: needle,
        blastRadius: {
          totalImpactedArtifacts: overlayPatches.length + compiledShards.length + memoryChunks.length,
          overlayPatchCount: overlayPatches.length,
          impactedShardCount: compiledShards.length,
          impactedRecipeCount: affectedRecipes.length,
          impactedMemoryChunkCount: memoryChunks.length,
          quarantined: overlayPatches.some((p) => p.action === "quarantine"),
          affectedRecipes,
        },
        overlayPatches,
        compiledShards,
        memoryChunks,
      });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to compute example lineage blast radius") });
    }
  });

  /**
   * POST /api/v1/recipes/browse-shard
   * Paginated columnar shard browser reading a compiled shard (by `shardId` + `storageDir`)
   * OR inline `examples[]`, joining active `dataset_overlay_patches`, applying server-side
   * filters (`dialect`, `mMin`, `mMax`, `gatePassed`, `quarantined`, `search`) and sorting
   * (`m_init_desc`, `m_init_asc`, `tokens_desc`).
   */
  router.post("/browse-shard", optionalAuth, (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as {
        shardId?: unknown;
        recipeName?: unknown;
        examples?: unknown;
        filters?:
          | {
              dialect?: unknown;
              mMin?: unknown;
              mMax?: unknown;
              gatePassed?: unknown;
              quarantined?: unknown;
              search?: unknown;
            }
          | undefined;
        dialect?: unknown;
        mMin?: unknown;
        mMax?: unknown;
        gatePassed?: unknown;
        quarantined?: unknown;
        search?: unknown;
        sort?: unknown;
        page?: unknown;
        pageSize?: unknown;
      };

      const shardId = typeof body.shardId === "string" && body.shardId.trim() ? body.shardId.trim() : undefined;
      let resolvedRecipeName =
        typeof body.recipeName === "string" && body.recipeName.trim() ? body.recipeName.trim() : undefined;

      const rawRows: BrowsableShardRow[] = [];

      if (shardId) {
        const shardRow = database.db
          .prepare(`SELECT * FROM compiled_dataset_shards WHERE shard_id = ?`)
          .get(shardId) as ShardDbRow | undefined;
        if (!shardRow) {
          return res.status(404).json({ error: `Compiled shard '${shardId}' not found.` });
        }
        if (!resolvedRecipeName) {
          resolvedRecipeName = shardRow.recipe_name;
        }

        const shardFilePath = resolveExistingShardFilePath(database, shardRow.storage_path, storageDir);
        if (!shardFilePath) {
          return res.status(404).json({
            error: `Shard file for '${shardId}' could not be located on disk (${shardRow.storage_path}).`,
          });
        }

        const content = fs.readFileSync(shardFilePath, "utf8");
        const lines = content.split("\n").filter((l) => l.trim().length > 0);
        for (let i = 0; i < lines.length; i++) {
          const parsed = parseJsonSafe<ShardJsonlRow | null>(lines[i], null);
          if (!parsed) continue;
          const exampleId =
            typeof parsed.example_id === "string" && parsed.example_id.trim()
              ? parsed.example_id.trim()
              : `${shardId}:${i}`;
          const uri = typeof parsed.uri === "string" && parsed.uri.trim() ? parsed.uri.trim() : exampleId;
          const dialect =
            typeof parsed.dialect === "string" && parsed.dialect.trim()
              ? parsed.dialect.trim().toLowerCase()
              : shardRow.dialect;
          const mInit = typeof parsed.m_init === "number" && Number.isFinite(parsed.m_init) ? parsed.m_init : 0;
          const tokenCount = Array.isArray(parsed.token_ids) ? parsed.token_ids.length : 0;
          const groupSet = new Set<number>();
          if (Array.isArray(parsed.group_ids)) {
            for (const g of parsed.group_ids) {
              if (typeof g === "number" && g > 0) groupSet.add(g);
            }
          }
          const fc = parsed.formal_cert;
          const formalCert = fc
            ? {
                gate1GlrSyntax: Boolean(fc.gate1_glr),
                gate2QudvUnits: Boolean(fc.gate2_units),
                gate3SmtFeasibility: Boolean(fc.gate3_smt),
                gate4DaeBalance: Boolean(fc.gate4_dae),
                ...(typeof fc.cad_clearance === "boolean" ? { cadClearance: fc.cad_clearance } : {}),
              }
            : null;
          const gatePassed = formalCert
            ? formalCert.gate1GlrSyntax &&
              formalCert.gate2QudvUnits &&
              formalCert.gate3SmtFeasibility &&
              formalCert.gate4DaeBalance
            : false;

          rawRows.push({
            exampleId,
            uri,
            dialect,
            mInit,
            tokenCount,
            groupCount: groupSet.size,
            formalCert,
            gatePassed,
            quarantined: false,
            hasSourcePatch: false,
            hasHypergraphOverride: false,
            activePatches: [],
            ...(typeof parsed.source === "string" ? { source: parsed.source } : {}),
          });
        }
      } else if (Array.isArray(body.examples)) {
        const examples = normalizeExampleInputs(body.examples);
        if (!examples) {
          return res.status(400).json({ error: "examples must be an array of { uri, dialect, source } objects." });
        }
        for (const ex of examples) {
          const cert = evaluateFormalGatesForCandidate(ex.source, ex.dialect);
          const hg = compileRelationalHypergraph({
            source: ex.source,
            uri: ex.uri,
            dialect: ex.dialect,
            formalCert: cert,
          });
          const gatePassed = passesAllFormalGates(cert);
          rawRows.push({
            exampleId: ex.exampleId ?? hg.exampleId,
            uri: ex.uri,
            dialect: ex.dialect,
            mInit: hg.mInit,
            tokenCount: hg.tokenIds.length,
            groupCount: hg.groups.length,
            formalCert: {
              gate1GlrSyntax: cert.gate1GlrSyntax,
              gate2QudvUnits: cert.gate2QudvUnits,
              gate3SmtFeasibility: cert.gate3SmtFeasibility,
              gate4DaeBalance: cert.gate4DaeBalance,
              ...(cert.cadClearance !== undefined ? { cadClearance: cert.cadClearance } : {}),
              diagnostics: cert.diagnostics,
            },
            gatePassed,
            quarantined: false,
            hasSourcePatch: false,
            hasHypergraphOverride: false,
            activePatches: [],
            source: ex.source,
          });
        }
      } else {
        return res.status(400).json({ error: "Either 'shardId' or inline 'examples[]' is required." });
      }

      // Join active dataset_overlay_patches (matching by example_id or uri)
      const patchRows = (
        resolvedRecipeName
          ? database.db
              .prepare(
                `SELECT * FROM dataset_overlay_patches
                 WHERE recipe_name = ?
                 ORDER BY created_at DESC, id DESC`,
              )
              .all(resolvedRecipeName)
          : database.db.prepare(`SELECT * FROM dataset_overlay_patches ORDER BY created_at DESC, id DESC`).all()
      ) as OverlayPatchRow[];

      const patchesByKey = new Map<string, ReturnType<typeof mapPatchRow>[]>();
      for (const p of patchRows) {
        const mapped = mapPatchRow(p);
        const list = patchesByKey.get(p.example_id) ?? [];
        list.push(mapped);
        patchesByKey.set(p.example_id, list);
      }

      for (const row of rawRows) {
        const byId = patchesByKey.get(row.exampleId) ?? [];
        const byUri = row.uri !== row.exampleId ? (patchesByKey.get(row.uri) ?? []) : [];
        const seenPatchIds = new Set<number>();
        const merged: ReturnType<typeof mapPatchRow>[] = [];
        for (const p of [...byId, ...byUri]) {
          if (!seenPatchIds.has(p.id)) {
            seenPatchIds.add(p.id);
            merged.push(p);
          }
        }
        row.activePatches = merged;
        row.quarantined = merged.some((p) => p.action === "quarantine");
        row.hasSourcePatch = merged.some((p) => p.action === "patch_source");
        row.hasHypergraphOverride = merged.some((p) => p.action === "hypergraph_override");
      }

      // Extract filters (supporting both nested `body.filters` and top-level fields)
      const f = body.filters ?? {};
      const rawDialect = f.dialect ?? body.dialect;
      const filterDialect =
        typeof rawDialect === "string" && rawDialect.trim() && rawDialect.trim().toLowerCase() !== "all"
          ? rawDialect.trim().toLowerCase()
          : undefined;
      const rawMMin = f.mMin ?? body.mMin;
      const filterMMin = typeof rawMMin === "number" && Number.isFinite(rawMMin) ? rawMMin : undefined;
      const rawMMax = f.mMax ?? body.mMax;
      const filterMMax = typeof rawMMax === "number" && Number.isFinite(rawMMax) ? rawMMax : undefined;
      const rawGatePassed = f.gatePassed ?? body.gatePassed;
      const filterGatePassed = typeof rawGatePassed === "boolean" ? rawGatePassed : undefined;
      const rawQuarantined = f.quarantined ?? body.quarantined;
      const filterQuarantined = typeof rawQuarantined === "boolean" ? rawQuarantined : undefined;
      const rawSearch = f.search ?? body.search;
      const filterSearch =
        typeof rawSearch === "string" && rawSearch.trim() ? rawSearch.trim().toLowerCase() : undefined;

      const filtered = rawRows.filter((row) => {
        if (filterDialect && row.dialect.toLowerCase() !== filterDialect) return false;
        if (filterMMin !== undefined && row.mInit < filterMMin) return false;
        if (filterMMax !== undefined && row.mInit > filterMMax) return false;
        if (filterGatePassed !== undefined && row.gatePassed !== filterGatePassed) return false;
        if (filterQuarantined !== undefined && row.quarantined !== filterQuarantined) return false;
        if (filterSearch) {
          const hay = [row.exampleId, row.uri, row.dialect, row.source ?? "", ...row.activePatches.map((p) => p.reason)]
            .join(" ")
            .toLowerCase();
          if (!hay.includes(filterSearch)) return false;
        }
        return true;
      });

      const sort =
        typeof body.sort === "string" &&
        ["m_init_desc", "m_init_asc", "tokens_desc", "tokens_asc", "uri_asc"].includes(body.sort)
          ? body.sort
          : "m_init_desc";

      filtered.sort((a, b) => {
        switch (sort) {
          case "m_init_asc":
            return a.mInit - b.mInit || a.tokenCount - b.tokenCount || a.uri.localeCompare(b.uri);
          case "tokens_desc":
            return b.tokenCount - a.tokenCount || b.mInit - a.mInit || a.uri.localeCompare(b.uri);
          case "tokens_asc":
            return a.tokenCount - b.tokenCount || a.mInit - b.mInit || a.uri.localeCompare(b.uri);
          case "uri_asc":
            return a.uri.localeCompare(b.uri);
          case "m_init_desc":
          default:
            return b.mInit - a.mInit || b.tokenCount - a.tokenCount || a.uri.localeCompare(b.uri);
        }
      });

      const page = Math.max(1, Math.floor(Number(body.page ?? 1) || 1));
      const pageSize = Math.min(200, Math.max(1, Math.floor(Number(body.pageSize ?? 25) || 25)));
      const total = filtered.length;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const start = (page - 1) * pageSize;
      const rows = filtered.slice(start, start + pageSize);

      return res.json({
        ...(shardId ? { shardId } : {}),
        ...(resolvedRecipeName ? { recipeName: resolvedRecipeName } : {}),
        total,
        page,
        pageSize,
        totalPages,
        sort,
        rows,
      });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to browse dataset shard") });
    }
  });

  /**
   * POST /api/v1/recipes/bulk-action
   * Executes bulk operations over selected dataset examples:
   *   - `action: "quarantine"`: bulk inserts immutable `quarantine` rows into `dataset_overlay_patches`
   *   - `action: "spawn_campaign"`: creates an `rlhf_campaigns` sprint + `rlhf_challenges` for every selected failing example
   */
  router.post("/bulk-action", requireAuth, (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as {
        action?: unknown;
        recipeName?: unknown;
        shardId?: unknown;
        reason?: unknown;
        exampleIds?: unknown;
        examples?: unknown;
        onlyFailing?: unknown;
        includePassing?: unknown;
        campaign?:
          | {
              slug?: unknown;
              title?: unknown;
              description?: unknown;
              dialect?: unknown;
              challengeType?: unknown;
              targetAnnotations?: unknown;
              consensusMinVotes?: unknown;
              consensusAgreementThreshold?: unknown;
              bountyPoints?: unknown;
            }
          | undefined;
      };

      const action = typeof body.action === "string" ? body.action.trim() : "";
      if (action !== "quarantine" && action !== "spawn_campaign") {
        return res.status(400).json({ error: "action must be either 'quarantine' or 'spawn_campaign'." });
      }

      const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 1000) : "";

      if (action === "quarantine") {
        let recipeName = typeof body.recipeName === "string" ? body.recipeName.trim() : "";
        if (!recipeName && typeof body.shardId === "string" && body.shardId.trim()) {
          const shardRow = database.db
            .prepare(`SELECT recipe_name FROM compiled_dataset_shards WHERE shard_id = ?`)
            .get(body.shardId.trim()) as { recipe_name: string } | undefined;
          if (shardRow) recipeName = shardRow.recipe_name;
        }
        if (!recipeName) {
          return res.status(400).json({ error: "recipeName (or valid shardId) is required for bulk quarantine." });
        }

        const idSet = new Set<string>();
        if (Array.isArray(body.exampleIds)) {
          for (const id of body.exampleIds) {
            if (typeof id === "string" && id.trim()) idSet.add(id.trim());
          }
        }
        if (Array.isArray(body.examples)) {
          for (const ex of body.examples) {
            if (ex && typeof ex === "object") {
              const obj = ex as Record<string, unknown>;
              const key =
                (typeof obj["exampleId"] === "string" && obj["exampleId"].trim()) ||
                (typeof obj["uri"] === "string" && obj["uri"].trim()) ||
                "";
              if (key) idSet.add(key);
            }
          }
        }

        const targetIds = Array.from(idSet);
        if (targetIds.length === 0) {
          return res.status(400).json({ error: "At least one exampleId or example object is required." });
        }

        const insertStmt = database.db.prepare(
          `INSERT INTO dataset_overlay_patches (
             recipe_name, example_id, action, reason, patched_source, overrides_json, created_by
           ) VALUES (?, ?, 'quarantine', ?, NULL, NULL, ?)`,
        );
        const selectStmt = database.db.prepare(`SELECT * FROM dataset_overlay_patches WHERE id = ?`);

        const createdPatches: ReturnType<typeof mapPatchRow>[] = [];
        database.db.transaction(() => {
          for (const exId of targetIds) {
            const info = insertStmt.run(
              recipeName,
              exId,
              reason || "Bulk quarantined from shard browser",
              req.user!.id,
            );
            const row = selectStmt.get(info.lastInsertRowid) as OverlayPatchRow;
            createdPatches.push(mapPatchRow(row));
          }
        })();

        return res.status(201).json({
          success: true,
          action: "quarantine",
          recipeName,
          quarantinedCount: createdPatches.length,
          patches: createdPatches,
        });
      }

      // action === "spawn_campaign"
      ensureAnnotationCampaignSchema(database);

      interface BulkSpawnInput {
        exampleId?: string | undefined;
        uri: string;
        dialect: string;
        source: string;
        title?: string | undefined;
        prompt?: string | undefined;
        deltaTTrigger?: number | undefined;
      }

      const rawList: BulkSpawnInput[] = [];
      if (Array.isArray(body.examples)) {
        for (let i = 0; i < body.examples.length; i++) {
          const item = body.examples[i];
          if (!item || typeof item !== "object") continue;
          const obj = item as Record<string, unknown>;
          if (typeof obj["source"] !== "string") continue;
          const uri =
            (typeof obj["uri"] === "string" && obj["uri"].trim()) ||
            (typeof obj["exampleId"] === "string" && obj["exampleId"].trim()) ||
            `example_${i}`;
          const dialect =
            typeof obj["dialect"] === "string" && obj["dialect"].trim()
              ? obj["dialect"].trim().toLowerCase()
              : "modelica";
          rawList.push({
            exampleId: typeof obj["exampleId"] === "string" ? obj["exampleId"].trim() : undefined,
            uri,
            dialect,
            source: obj["source"],
            title: typeof obj["title"] === "string" ? obj["title"].trim() : undefined,
            prompt: typeof obj["prompt"] === "string" ? obj["prompt"].trim() : undefined,
            deltaTTrigger:
              typeof obj["deltaTTrigger"] === "number" && Number.isFinite(obj["deltaTTrigger"])
                ? obj["deltaTTrigger"]
                : undefined,
          });
        }
      }

      if (rawList.length === 0) {
        return res.status(400).json({ error: "examples[] with source strings is required for spawn_campaign." });
      }

      const evaluated = rawList.map((item) => {
        const cert = evaluateFormalGatesForCandidate(item.source, item.dialect);
        return {
          item,
          cert,
          passed: passesAllFormalGates(cert),
        };
      });

      const failing = evaluated.filter((e) => !e.passed);
      const passing = evaluated.filter((e) => e.passed);

      if (body.onlyFailing === true && failing.length === 0) {
        return res.status(400).json({ error: "No failing examples found among selected rows." });
      }

      const targets = body.includePassing === true ? evaluated : failing.length > 0 ? failing : evaluated;
      const skippedPassingCount = body.includePassing === true ? 0 : failing.length > 0 ? passing.length : 0;

      const campCfg = body.campaign ?? {};
      const recipeName = typeof body.recipeName === "string" ? body.recipeName.trim() : "";
      const campTitle =
        typeof campCfg.title === "string" && campCfg.title.trim()
          ? campCfg.title.trim()
          : `Fix-It Sprint: ${recipeName || "Shard Triage"}`;
      const baseSlug =
        typeof campCfg.slug === "string" && campCfg.slug.trim()
          ? slugifyCampaignTitle(campCfg.slug.trim())
          : `${slugifyCampaignTitle(campTitle)}-${crypto.randomBytes(3).toString("hex")}`;
      const uniqueDialects = Array.from(new Set(targets.map((t) => t.item.dialect)));
      const campDialect =
        typeof campCfg.dialect === "string" && campCfg.dialect.trim()
          ? campCfg.dialect.trim().toLowerCase()
          : uniqueDialects.length === 1
            ? uniqueDialects[0]!
            : "polyglot";
      const campChallengeType =
        typeof campCfg.challengeType === "string" &&
        ["pairwise_arena", "fix_it_bounty", "tolerance_labeling", "mixed"].includes(campCfg.challengeType.trim())
          ? campCfg.challengeType.trim()
          : "fix_it_bounty";
      const challengeTypeForRows: RlhfChallengeType =
        campChallengeType === "mixed" || campChallengeType === "pairwise_arena"
          ? "fix_it_bounty"
          : (campChallengeType as RlhfChallengeType);
      const targetAnnotations =
        typeof campCfg.targetAnnotations === "number" &&
        Number.isFinite(campCfg.targetAnnotations) &&
        campCfg.targetAnnotations >= 1
          ? Math.floor(campCfg.targetAnnotations)
          : Math.max(targets.length * 3, 10);
      const consensusMinVotes =
        typeof campCfg.consensusMinVotes === "number" &&
        Number.isFinite(campCfg.consensusMinVotes) &&
        campCfg.consensusMinVotes >= 1
          ? Math.floor(campCfg.consensusMinVotes)
          : 3;
      const consensusAgreementThreshold =
        typeof campCfg.consensusAgreementThreshold === "number" &&
        Number.isFinite(campCfg.consensusAgreementThreshold) &&
        campCfg.consensusAgreementThreshold > 0 &&
        campCfg.consensusAgreementThreshold <= 1
          ? campCfg.consensusAgreementThreshold
          : 0.75;
      const bountyPoints =
        typeof campCfg.bountyPoints === "number" && Number.isFinite(campCfg.bountyPoints) && campCfg.bountyPoints >= 0
          ? Math.floor(campCfg.bountyPoints)
          : 25;
      const campDescription =
        typeof campCfg.description === "string" && campCfg.description.trim()
          ? campCfg.description.trim().slice(0, 2000)
          : reason || `Auto-spawned campaign for ${targets.length} failing example(s).`;

      let createdCampaign!: CampaignDbRow;
      const spawnedChallenges: {
        id: number;
        campaignId: number;
        challengeType: RlhfChallengeType;
        dialect: string;
        title: string;
        uri: string;
        priorityScore: number;
        diagnostics: string[];
      }[] = [];

      database.db.transaction(() => {
        const slugExists = database.db.prepare(`SELECT id FROM rlhf_campaigns WHERE slug = ?`).get(baseSlug) as
          { id: number } | undefined;
        const finalSlug = slugExists ? `${baseSlug}-${crypto.randomBytes(2).toString("hex")}` : baseSlug;

        const campInfo = database.db
          .prepare(
            `INSERT INTO rlhf_campaigns (
               slug, title, description, dialect, challenge_type,
               target_annotations, consensus_min_votes, consensus_agreement_threshold,
               bounty_points, status, created_by
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
          )
          .run(
            finalSlug,
            campTitle,
            campDescription,
            campDialect,
            campChallengeType,
            targetAnnotations,
            consensusMinVotes,
            consensusAgreementThreshold,
            bountyPoints,
            req.user!.id,
          );
        const campaignId = Number(campInfo.lastInsertRowid);
        createdCampaign = database.db
          .prepare(`SELECT * FROM rlhf_campaigns WHERE id = ?`)
          .get(campaignId) as CampaignDbRow;

        const insertChallenge = database.db.prepare(
          `INSERT INTO rlhf_challenges (
             campaign_id, created_by, challenge_type, dialect, title, prompt,
             source_code, delta_t_trigger, priority_score, consensus_status, ai_governance_json
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        );
        const defaultGov = JSON.stringify({
          allowRag: true,
          allowPretrain: false,
          allowPosttrain: true,
          tenantScope: "public",
        });

        for (const target of targets) {
          const chTitle = target.item.title || `Repair failing ${target.item.dialect} example: ${target.item.uri}`;
          const diagSummary =
            target.cert.diagnostics.length > 0
              ? target.cert.diagnostics.join(" ")
              : "Formal gate verification failure.";
          const chPrompt =
            target.item.prompt ||
            `Repair '${target.item.uri}' so all 4 formal verification gates pass. Diagnostics: ${diagSummary}`;
          const priorityScore = computeChallengePriorityScore({
            deltaTTrigger: target.item.deltaTTrigger ?? null,
            challengeType: challengeTypeForRows,
            sourceCode: target.item.source,
            dialect: target.item.dialect,
          });

          const chInfo = insertChallenge.run(
            campaignId,
            req.user!.id,
            challengeTypeForRows,
            target.item.dialect,
            chTitle,
            chPrompt,
            target.item.source,
            target.item.deltaTTrigger ?? null,
            priorityScore,
            defaultGov,
          );

          spawnedChallenges.push({
            id: Number(chInfo.lastInsertRowid),
            campaignId,
            challengeType: challengeTypeForRows,
            dialect: target.item.dialect,
            title: chTitle,
            uri: target.item.uri,
            priorityScore,
            diagnostics: target.cert.diagnostics,
          });
        }
      })();

      return res.status(201).json({
        success: true,
        action: "spawn_campaign",
        campaign: {
          id: createdCampaign.id,
          slug: createdCampaign.slug,
          title: createdCampaign.title,
          description: createdCampaign.description,
          dialect: createdCampaign.dialect,
          challengeType: createdCampaign.challenge_type,
          targetAnnotations: createdCampaign.target_annotations,
          consensusMinVotes: createdCampaign.consensus_min_votes,
          consensusAgreementThreshold: createdCampaign.consensus_agreement_threshold,
          bountyPoints: createdCampaign.bounty_points,
          status: createdCampaign.status,
          createdAt: createdCampaign.created_at,
        },
        challenges: spawnedChallenges,
        spawnedCount: spawnedChallenges.length,
        skippedPassingCount,
      });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to execute recipe bulk action") });
    }
  });

  /**
   * POST /api/v1/recipes/release-posttrain
   * Snapshots all `consensus_reached` and `adjudicated` RLHF challenges (excluding honeypots and non-public)
   * into compiled `m_init`-bucketed `dataset-posttrain` shards and signs the release manifest via Ed25519.
   */
  router.post("/release-posttrain", requireAuth, (req: Request, res: Response) => {
    try {
      ensureAnnotationCampaignSchema(database);

      const body = (req.body ?? {}) as {
        recipeName?: unknown;
        recipeVersion?: unknown;
        dialect?: unknown;
        campaignId?: unknown;
        examplesPerShard?: unknown;
        mCap?: unknown;
        requireFormalPass?: unknown;
        sourceLockfile?: Record<string, string> | undefined;
        originInstance?: unknown;
        verificationMethod?: unknown;
      };

      const recipeName =
        typeof body.recipeName === "string" && body.recipeName.trim() ? body.recipeName.trim() : "@ms/rlhf-posttrain";
      const recipeVersion =
        typeof body.recipeVersion === "string" && body.recipeVersion.trim() ? body.recipeVersion.trim() : "1.0.0";
      const dialectFilter =
        typeof body.dialect === "string" && body.dialect.trim() && body.dialect.trim().toLowerCase() !== "all"
          ? body.dialect.trim().toLowerCase()
          : undefined;
      const campaignIdFilter =
        typeof body.campaignId === "number" && Number.isInteger(body.campaignId) && body.campaignId > 0
          ? body.campaignId
          : undefined;

      const where: string[] = ["consensus_status IN ('consensus_reached', 'adjudicated')"];
      const params: unknown[] = [];
      if (dialectFilter) {
        where.push("dialect = ?");
        params.push(dialectFilter);
      }
      if (campaignIdFilter !== undefined) {
        where.push("campaign_id = ?");
        params.push(campaignIdFilter);
      }

      const eligibleRows = database.db
        .prepare(`SELECT * FROM rlhf_challenges WHERE ${where.join(" AND ")} ORDER BY id ASC`)
        .all(...params) as ChallengeDbRow[];

      interface CandidateRow {
        id: number;
        label: string;
        code: string;
        dialect: string;
        formal_cert_json: string;
      }
      interface AnnotationRow {
        id: number;
        preferred_candidate_id: number | null;
        preference_outcome: string;
        fixed_code: string | null;
        fixed_formal_cert_json: string | null;
        hypergraph_overrides_json: string | null;
        weight: number;
      }

      const candStmt = database.db.prepare(
        `SELECT id, label, code, dialect, formal_cert_json FROM rlhf_candidates WHERE challenge_id = ? ORDER BY id ASC`,
      );
      const annStmt = database.db.prepare(
        `SELECT id, preferred_candidate_id, preference_outcome, fixed_code, fixed_formal_cert_json, hypergraph_overrides_json, weight
         FROM rlhf_annotations WHERE challenge_id = ? ORDER BY weight DESC, id ASC`,
      );

      const files: RawDatasetFileInput[] = [];
      const includedChallengeIds: number[] = [];
      let excludedHoneypotCount = 0;
      let excludedNonPublicCount = 0;
      let allGate1 = true;
      let allGate2 = true;
      let allGate3 = true;
      let allGate4 = true;

      for (const ch of eligibleRows) {
        if (ch.is_honeypot === 1) {
          excludedHoneypotCount++;
          continue;
        }
        const gov = parseJsonSafe<AiGovernancePolicy>(ch.ai_governance_json, {
          allowRag: true,
          allowPretrain: false,
          allowPosttrain: true,
          tenantScope: "public",
        });
        if (!gov.allowPosttrain || gov.tenantScope !== "public") {
          excludedNonPublicCount++;
          continue;
        }

        const cands = candStmt.all(ch.id) as CandidateRow[];
        const anns = annStmt.all(ch.id) as AnnotationRow[];

        if (ch.challenge_type === "pairwise_arena" && cands.length >= 2) {
          let chosen =
            ch.winning_candidate_id != null ? cands.find((c) => c.id === ch.winning_candidate_id) : undefined;
          if (!chosen) {
            const scores = new Map<number, number>();
            for (const a of anns) {
              if (a.preference_outcome === "candidate" && a.preferred_candidate_id != null) {
                scores.set(a.preferred_candidate_id, (scores.get(a.preferred_candidate_id) ?? 0) + a.weight);
              }
            }
            const ranked = [...cands].sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0));
            chosen = ranked[0];
          }
          if (chosen && chosen.code.trim()) {
            const cert =
              parseJsonSafe<FormalCertificateSummary | null>(chosen.formal_cert_json, null) ??
              evaluateFormalGatesForCandidate(chosen.code, chosen.dialect);
            allGate1 = allGate1 && cert.gate1GlrSyntax;
            allGate2 = allGate2 && cert.gate2QudvUnits;
            allGate3 = allGate3 && cert.gate3SmtFeasibility;
            allGate4 = allGate4 && cert.gate4DaeBalance;

            files.push({
              uri: `dataset://posttrain/${recipeName}@${recipeVersion}/challenge-${ch.id}/chosen.${chosen.dialect}`,
              dialect: chosen.dialect,
              source: chosen.code,
            });
            includedChallengeIds.push(ch.id);
          }
        } else if (ch.challenge_type === "fix_it_bounty") {
          const bestFix = anns.find((a) => typeof a.fixed_code === "string" && a.fixed_code.trim().length > 0);
          if (bestFix?.fixed_code) {
            const cert =
              parseJsonSafe<FormalCertificateSummary | null>(bestFix.fixed_formal_cert_json, null) ??
              evaluateFormalGatesForCandidate(bestFix.fixed_code, ch.dialect);
            allGate1 = allGate1 && cert.gate1GlrSyntax;
            allGate2 = allGate2 && cert.gate2QudvUnits;
            allGate3 = allGate3 && cert.gate3SmtFeasibility;
            allGate4 = allGate4 && cert.gate4DaeBalance;

            files.push({
              uri: `dataset://posttrain/${recipeName}@${recipeVersion}/challenge-${ch.id}/fix.${ch.dialect}`,
              dialect: ch.dialect,
              source: bestFix.fixed_code,
            });
            includedChallengeIds.push(ch.id);
          }
        } else if (ch.challenge_type === "tolerance_labeling" && ch.source_code) {
          const cert = evaluateFormalGatesForCandidate(ch.source_code, ch.dialect);
          allGate1 = allGate1 && cert.gate1GlrSyntax;
          allGate2 = allGate2 && cert.gate2QudvUnits;
          allGate3 = allGate3 && cert.gate3SmtFeasibility;
          allGate4 = allGate4 && cert.gate4DaeBalance;

          files.push({
            uri: `dataset://posttrain/${recipeName}@${recipeVersion}/challenge-${ch.id}/tolerance.${ch.dialect}`,
            dialect: ch.dialect,
            source: ch.source_code,
          });
          includedChallengeIds.push(ch.id);
        }
      }

      if (files.length === 0) {
        return res.status(400).json({
          error:
            "No eligible public consensus_reached or adjudicated RLHF challenges available for post-train release.",
          excludedHoneypotCount,
          excludedNonPublicCount,
        });
      }

      const mlStorageDir = resolveMlStorageDir(database, storageDir);
      const examplesPerShard =
        typeof body.examplesPerShard === "number" &&
        Number.isFinite(body.examplesPerShard) &&
        body.examplesPerShard >= 1
          ? Math.floor(body.examplesPerShard)
          : undefined;
      const mCap =
        typeof body.mCap === "number" && Number.isFinite(body.mCap) && body.mCap >= 1
          ? Math.floor(body.mCap)
          : undefined;

      const compileResult = compileDatasetShards(database, mlStorageDir, {
        recipeName,
        recipeVersion,
        datasetKind: "dataset-posttrain",
        files,
        aiGovernance: {
          allowRag: true,
          allowPretrain: false,
          allowPosttrain: true,
          tenantScope: "public",
        },
        requireFormalPass: body.requireFormalPass === true,
        applyOverlayPatches: true,
        ...(examplesPerShard !== undefined ? { examplesPerShard } : {}),
        ...(mCap !== undefined ? { mCap } : {}),
        sourceLockfile: {
          ...(body.sourceLockfile ?? {}),
          rlhfChallengeCount: String(includedChallengeIds.length),
        },
      });

      const manifestPayload: DatasetManifestPayload = {
        datasetKind: "dataset-posttrain",
        recipeName,
        recipeVersion,
        originInstance:
          typeof body.originInstance === "string" && body.originInstance.trim() ? body.originInstance.trim() : "local",
        releaseType: "rlhf-posttrain-snapshot",
        snapshotAtIso: new Date().toISOString(),
        includedChallengeIds,
        includedChallengeCount: includedChallengeIds.length,
        excludedHoneypotCount,
        excludedNonPublicCount,
        shards: compileResult.shards.map((s) => ({
          shardId: s.shardId,
          dialect: s.dialect,
          mMin: s.mMin,
          mMax: s.mMax,
          exampleCount: s.exampleCount,
          byteSize: s.byteSize,
          downloadUrl: `/api/v1/memory/datasets/shards/${s.shardId}`,
        })),
        sourceLockfile: {
          ...(body.sourceLockfile ?? {}),
          rlhfChallengeCount: String(includedChallengeIds.length),
        },
        formalCertSummary: {
          gate1: allGate1,
          gate2: allGate2,
          gate3: allGate3,
          gate4: allGate4,
        },
      };

      const persistentKey = getDefaultDatasetSigningKeyPair(database);
      const signedManifest = signDatasetManifestEd25519(manifestPayload, {
        privateKeyPem: persistentKey.privateKeyPem,
        ...(typeof body.verificationMethod === "string" && body.verificationMethod.trim()
          ? { verificationMethod: body.verificationMethod.trim() }
          : {}),
      });

      const updateProvStmt = database.db.prepare(
        `UPDATE compiled_dataset_shards SET provenance_json = ? WHERE shard_id = ?`,
      );
      for (const shard of compileResult.shards) {
        const enriched = {
          ...shard.provenance,
          releaseType: "rlhf-posttrain-snapshot",
          includedChallengeIds,
          signedManifestProof: {
            payloadSha256: signedManifest.proof.payloadSha256,
            publicKeyMultibase: signedManifest.proof.publicKeyMultibase,
            verificationMethod: signedManifest.proof.verificationMethod,
            created: signedManifest.proof.created,
          },
        };
        shard.provenance = enriched;
        updateProvStmt.run(JSON.stringify(enriched), shard.shardId);
      }

      return res.status(201).json({
        success: true,
        recipeName,
        recipeVersion,
        datasetKind: "dataset-posttrain",
        includedChallengeCount: includedChallengeIds.length,
        includedChallengeIds,
        excludedHoneypotCount,
        excludedNonPublicCount,
        verifiedExamples: compileResult.verifiedExamples,
        rejectedExamples: compileResult.rejectedExamples,
        shards: compileResult.shards,
        manifest: signedManifest.manifest,
        proof: signedManifest.proof,
        signedManifest,
      });
    } catch (err) {
      return res.status(500).json({ error: publicErrorMessage(err, "Failed to release post-train RLHF snapshot") });
    }
  });

  return router;
}
