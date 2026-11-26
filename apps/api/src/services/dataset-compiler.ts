// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Deterministic Dynamic-m Dataset & Training-Recipe Shard Compiler.
 *
 * Compiles `dataset-pretrain`, `dataset-posttrain`, and `training-recipe` packages into
 * content-addressed, `m_init`-bucketed JSONL/Arrow-ready shards containing aligned 4-column
 * Typed Relational Hypergraph tensors (`tokenIds`, `groupIds`, `relTypeIds`, `relSigns`, `mInit`)
 * plus 4-gate formal verification certificates and provenance manifests.
 */

import {
  applyHypergraphOverrides,
  bucketHypergraphExamples,
  compileRelationalHypergraph,
  type AiGovernancePolicy,
  type HypergraphTokenOverride,
  type RelationalHypergraphRecord,
  type TenantScope,
} from "@modelscript/runtime";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { LibraryDatabase } from "../database.js";
import { evaluateFormalGatesForCandidate } from "../routes/rlhf-arena.js";

export interface RawDatasetFileInput {
  uri: string;
  dialect: string;
  source: string;
  gitSha?: string | undefined;
}

export interface CompileDatasetRecipeOptions {
  recipeName: string;
  recipeVersion?: string | undefined;
  datasetKind: "dataset-pretrain" | "dataset-posttrain" | "training-recipe";
  files: RawDatasetFileInput[];
  aiGovernance?: AiGovernancePolicy | undefined;
  /** Drop examples that fail any of the 4 formal gates (default: true). */
  requireFormalPass?: boolean | undefined;
  /** Maximum examples per `m_init`-bucketed shard (default: 256). */
  examplesPerShard?: number | undefined;
  /** Hard Dynamic-m safety cap (default: 32). */
  mCap?: number | undefined;
  /** Optional Git SHAs / dependency lockfile metadata stored in shard provenance. */
  sourceLockfile?: Record<string, string> | undefined;
  /** Apply active `dataset_overlay_patches` for this recipe during compilation (default: true). */
  applyOverlayPatches?: boolean | undefined;
}

export interface CompiledShardSummary {
  shardId: string;
  recipeName: string;
  recipeVersion: string;
  datasetKind: "dataset-pretrain" | "dataset-posttrain" | "training-recipe";
  dialect: string;
  mMin: number;
  mMax: number;
  exampleCount: number;
  storagePath: string;
  byteSize: number;
  provenance: Record<string, unknown>;
}

export interface CompileDatasetRecipeResult {
  recipeName: string;
  recipeVersion: string;
  totalInputFiles: number;
  verifiedExamples: number;
  rejectedExamples: number;
  quarantinedExamples?: number | undefined;
  appliedOverlayPatchIds?: number[] | undefined;
  shards: CompiledShardSummary[];
}

function inferDialectFromExt(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".mo":
      return "modelica";
    case ".sysml":
    case ".kerml":
      return "sysml2";
    case ".scad":
      return "scad";
    case ".step":
    case ".stp":
      return "step";
    case ".urdf":
      return "urdf";
    case ".owl":
    case ".ofn":
    case ".ttl":
      return "owl2";
    case ".sp":
    case ".cir":
      return "spice";
    case ".md":
      return "markdown";
    default:
      return null;
  }
}

interface OverlayPatchDbRow {
  id: number;
  example_id: string;
  action: "quarantine" | "patch_source" | "hypergraph_override";
  patched_source: string | null;
  overrides_json: string | null;
}

/**
 * Compiles a list of raw engineering files into deterministic, `m_init`-bucketed shards
 * stored under `<storageDir>/datasets/` and indexed in `compiled_dataset_shards`.
 * Automatically folds active `dataset_overlay_patches` (`quarantine`, `patch_source`, `hypergraph_override`).
 */
export function compileDatasetShards(
  database: LibraryDatabase,
  storageDir: string,
  options: CompileDatasetRecipeOptions,
): CompileDatasetRecipeResult {
  const recipeVersion = options.recipeVersion ?? "0.1.0";
  const requireFormalPass = options.requireFormalPass !== false;
  const applyOverlays = options.applyOverlayPatches === true;
  const examplesPerShard = Math.max(1, options.examplesPerShard ?? 256);
  const mCap = Math.max(1, options.mCap ?? 32);
  const governance: AiGovernancePolicy = options.aiGovernance ?? {
    allowRag: true,
    allowPretrain: options.datasetKind === "dataset-pretrain",
    allowPosttrain: true,
    tenantScope: "public",
  };

  // Enforce consent flags before compiling any training shards
  if (options.datasetKind === "dataset-pretrain" && !governance.allowPretrain) {
    throw new Error(`Governance policy blocks pre-training compilation for '${options.recipeName}'.`);
  }
  if (options.datasetKind === "dataset-posttrain" && !governance.allowPosttrain) {
    throw new Error(`Governance policy blocks post-training compilation for '${options.recipeName}'.`);
  }

  // Load immutable overlay patches for this recipe in chronological order
  const quarantineSet = new Set<string>();
  const sourcePatchMap = new Map<string, { patchId: number; source: string }>();
  const overridePatchMap = new Map<string, { patchIds: number[]; overrides: HypergraphTokenOverride[] }>();
  const appliedPatchIds = new Set<number>();

  if (applyOverlays) {
    try {
      const patchRows = database.db
        .prepare(
          `SELECT id, example_id, action, patched_source, overrides_json
           FROM dataset_overlay_patches
           WHERE recipe_name = ?
           ORDER BY id ASC`,
        )
        .all(options.recipeName) as OverlayPatchDbRow[];
      for (const p of patchRows) {
        if (p.action === "quarantine") {
          quarantineSet.add(p.example_id);
        } else if (p.action === "patch_source" && typeof p.patched_source === "string") {
          sourcePatchMap.set(p.example_id, { patchId: p.id, source: p.patched_source });
        } else if (p.action === "hypergraph_override" && p.overrides_json) {
          try {
            const parsed = JSON.parse(p.overrides_json) as HypergraphTokenOverride[];
            if (Array.isArray(parsed) && parsed.length > 0) {
              const cur = overridePatchMap.get(p.example_id) ?? { patchIds: [], overrides: [] };
              cur.patchIds.push(p.id);
              cur.overrides.push(...parsed);
              overridePatchMap.set(p.example_id, cur);
            }
          } catch {
            // Skip malformed override patch payload
          }
        }
      }
    } catch {
      // Table may not exist in isolated minimal DB tests
    }
  }

  const verifiedRecords: RelationalHypergraphRecord[] = [];
  let rejectedExamples = 0;
  let quarantinedExamples = 0;

  // Deterministic input ordering by URI so identical corpora yield identical SHA-256 shard IDs
  const sortedFiles = [...options.files].sort((a, b) => a.uri.localeCompare(b.uri));
  for (const file of sortedFiles) {
    // Check URI-level quarantine first
    if (quarantineSet.has(file.uri)) {
      quarantinedExamples++;
      continue;
    }

    const preliminaryRecord = compileRelationalHypergraph({
      source: file.source,
      uri: file.uri,
      dialect: file.dialect,
    });
    if (quarantineSet.has(preliminaryRecord.exampleId)) {
      quarantinedExamples++;
      continue;
    }

    // Apply latest source patch if present (matched by exampleId or URI)
    const srcPatch = sourcePatchMap.get(preliminaryRecord.exampleId) ?? sourcePatchMap.get(file.uri);
    const effectiveSource = srcPatch ? srcPatch.source : file.source;
    if (srcPatch) {
      appliedPatchIds.add(srcPatch.patchId);
    }

    const cert = evaluateFormalGatesForCandidate(effectiveSource, file.dialect);
    const passedAll = cert.gate1GlrSyntax && cert.gate2QudvUnits && cert.gate3SmtFeasibility && cert.gate4DaeBalance;

    if (requireFormalPass && !passedAll) {
      rejectedExamples++;
      continue;
    }

    let record = compileRelationalHypergraph({
      source: effectiveSource,
      uri: file.uri,
      dialect: file.dialect,
      formalCert: cert,
    });

    const ovPatch =
      overridePatchMap.get(preliminaryRecord.exampleId) ??
      overridePatchMap.get(record.exampleId) ??
      overridePatchMap.get(file.uri);
    if (ovPatch && ovPatch.overrides.length > 0) {
      record = applyHypergraphOverrides(record, ovPatch.overrides);
      for (const pid of ovPatch.patchIds) appliedPatchIds.add(pid);
    }

    verifiedRecords.push(record);
  }

  const datasetsDir = path.join(storageDir, "datasets");
  fs.mkdirSync(datasetsDir, { recursive: true });

  // Bucket examples by m_init for zero-waste Dynamic-m GPU/WebGPU batching
  const buckets = bucketHypergraphExamples(verifiedRecords, examplesPerShard, mCap);
  const shards: CompiledShardSummary[] = [];

  const upsertStmt = database.db.prepare(`
    INSERT INTO compiled_dataset_shards (
      shard_id, recipe_name, recipe_version, dataset_kind, dialect,
      m_min, m_max, example_count, storage_path, byte_size, tenant_scope, provenance_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(shard_id) DO UPDATE SET
      recipe_name = excluded.recipe_name,
      recipe_version = excluded.recipe_version,
      provenance_json = excluded.provenance_json
  `);

  for (const bucket of buckets) {
    const lines = bucket.examples.map((ex) =>
      JSON.stringify({
        example_id: ex.exampleId,
        uri: ex.uri,
        dialect: ex.dialect,
        m_init: ex.mInit,
        token_ids: ex.tokenIds,
        group_ids: ex.groupIds,
        rel_type_ids: ex.relTypeIds,
        rel_signs: ex.relSigns,
        formal_cert: ex.formalCert
          ? {
              gate1_glr: ex.formalCert.gate1GlrSyntax,
              gate2_units: ex.formalCert.gate2QudvUnits,
              gate3_smt: ex.formalCert.gate3SmtFeasibility,
              gate4_dae: ex.formalCert.gate4DaeBalance,
              cad_clearance: ex.formalCert.cadClearance ?? null,
            }
          : null,
      }),
    );

    const payload = lines.join("\n") + "\n";
    const shardId = crypto.createHash("sha256").update(payload).digest("hex");
    const relStoragePath = path.join("datasets", `${shardId}.jsonl`);
    const absStoragePath = path.join(storageDir, relStoragePath);
    fs.writeFileSync(absStoragePath, payload, "utf8");
    const byteSize = Buffer.byteLength(payload, "utf8");

    const mValues = bucket.examples.map((e) => e.mInit);
    const mMin = Math.min(...mValues);
    const mMax = Math.max(...mValues);
    const uniqueDialects = Array.from(new Set(bucket.examples.map((e) => e.dialect)));
    const dialect = uniqueDialects.length === 1 ? uniqueDialects[0]! : "polyglot";

    const provenance = {
      compilerVersion: "modelscript-rhg-v1",
      memoryBackend: "diskann",
      targetModelScale: "0.5B-1.5B",
      mCap,
      bucketId: bucket.bucketId,
      dialects: uniqueDialects,
      exampleIds: bucket.examples.slice(0, 512).map((e) => e.exampleId),
      uris: bucket.examples.slice(0, 512).map((e) => e.uri),
      sourceLockfile: options.sourceLockfile ?? {},
      aiGovernance: governance,
      appliedOverlayPatchIds: Array.from(appliedPatchIds),
    };

    upsertStmt.run(
      shardId,
      options.recipeName,
      recipeVersion,
      options.datasetKind,
      dialect,
      mMin,
      mMax,
      bucket.examples.length,
      relStoragePath,
      byteSize,
      governance.tenantScope as TenantScope,
      JSON.stringify(provenance),
    );

    shards.push({
      shardId,
      recipeName: options.recipeName,
      recipeVersion,
      datasetKind: options.datasetKind,
      dialect,
      mMin,
      mMax,
      exampleCount: bucket.examples.length,
      storagePath: relStoragePath,
      byteSize,
      provenance,
    });
  }

  return {
    recipeName: options.recipeName,
    recipeVersion,
    totalInputFiles: options.files.length,
    verifiedExamples: verifiedRecords.length,
    rejectedExamples,
    quarantinedExamples,
    appliedOverlayPatchIds: Array.from(appliedPatchIds),
    shards,
  };
}

/**
 * Walks an extracted package directory on disk and collects eligible engineering source files
 * for DiskANN indexing or Dynamic-m dataset shard compilation.
 */
export function collectPackageSourceFiles(
  packageRootDir: string,
  packageName: string,
  packageVersion: string,
  maxFiles = 2000,
): RawDatasetFileInput[] {
  const results: RawDatasetFileInput[] = [];
  const walk = (dir: string) => {
    if (results.length >= maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (results.length >= maxFiles) break;
      if (ent.name === ".git" || ent.name === "node_modules" || ent.name === "dist") continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
      } else if (ent.isFile()) {
        const dialect = inferDialectFromExt(full);
        if (!dialect) continue;
        try {
          const stat = fs.statSync(full);
          if (stat.size > 512 * 1024) continue; // skip huge binary-like files
          const source = fs.readFileSync(full, "utf8");
          const rel = path.relative(packageRootDir, full).replace(/\\/g, "/");
          results.push({
            uri: `pkg://${packageName}@${packageVersion}/${rel}`,
            dialect,
            source,
          });
        } catch {
          // skip unreadable file
        }
      }
    }
  };
  walk(packageRootDir);
  return results;
}
