// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * 3-Way ALM Sync & Conflict Detection Engine.
 *
 * Coordinates `AlmConnector`, `materializeAlmArtifacts`, and `modelscript.lock`
 * remote revision state to deliver Git-native pull, status, and push workflows.
 */

import type { PushCapability } from "../../workspace/manifest.js";
import type { AlmArtifact, AlmLink, AlmVerificationRun, ArtifactEdit, AuthContext, PushResult } from "./alm_ir.js";
import type { AlmConnector, ResolvedRemoteSpec } from "./connector_spi.js";
import {
  computeAlmItemHash,
  extractLocalItemBlocks,
  materializeAlmArtifacts,
  parseMaterializedExternalItems,
  type MaterializedSnapshot,
} from "./materializer.js";

export interface LockfileItemRevision {
  etag?: string | undefined;
  revision?: string | undefined;
  baseHash: string;
  blockHash?: string | undefined;
}

export interface LockfileRemoteState {
  connector: string;
  cursor?: string | undefined;
  baselineUri?: string | undefined;
  workingSet?: string | undefined;
  materializePath?: string | undefined;
  syncedAt: string;
  itemRevisions: Record<string, LockfileItemRevision>;
}

export interface SyncConflict {
  externalId: string;
  reason: "both-modified" | "deleted-remotely-modified-locally";
  baseHash: string;
  localHash: string;
  remoteHash?: string | undefined;
}

export interface PullSyncOptions {
  conflictStrategy?: "fail" | "theirs" | "ours" | undefined;
  /** Existing materialized file text on disk (if any) for 3-way local edit detection. */
  existingLocalContent?: string | undefined;
  /** Previously synced artifacts (needed to merge incremental deltas cleanly). */
  previousArtifacts?: AlmArtifact[] | undefined;
}

export interface PullSyncResult {
  snapshot: MaterializedSnapshot;
  artifacts: AlmArtifact[];
  links: AlmLink[];
  remoteState: LockfileRemoteState;
  snapshotVersion: string;
  conflicts: SyncConflict[];
  addedIds: string[];
  updatedIds: string[];
  deletedIds: string[];
}

export interface DriftStatusResult {
  packageName: string;
  connector: string;
  inSync: boolean;
  remoteAdded: string[];
  remoteUpdated: string[];
  remoteDeleted: string[];
  localModified: string[];
  conflicts: SyncConflict[];
}

/**
 * Performs a 3-way pull from an `AlmConnector`, merging incremental deltas when supported,
 * checking for both-sides-modified conflicts, and materializing deterministic `.sysml`/`.ms` output.
 */
export async function pullRemotePackage(
  connector: AlmConnector,
  spec: ResolvedRemoteSpec,
  auth: AuthContext,
  prevState?: LockfileRemoteState | null,
  options: PullSyncOptions = {},
): Promise<PullSyncResult> {
  const delta = await connector.fetchDelta(spec, auth, prevState?.cursor);

  // Merge incremental delta with previous artifacts if not a full snapshot
  const artifactMap = new Map<string, AlmArtifact>();
  if (!delta.isFullSnapshot && options.previousArtifacts) {
    for (const prev of options.previousArtifacts) {
      artifactMap.set(prev.externalId, prev);
    }
  }
  for (const item of delta.upserted) {
    artifactMap.set(item.externalId, item);
  }
  for (const delId of delta.deletedIds) {
    artifactMap.delete(delId);
  }

  const localBlocks = options.existingLocalContent ? await extractLocalItemBlocks(options.existingLocalContent) : {};

  const conflicts: SyncConflict[] = [];
  const addedIds: string[] = [];
  const updatedIds: string[] = [];
  const deletedIds: string[] = [...delta.deletedIds];

  const prevRevs = prevState?.itemRevisions ?? {};
  for (const item of delta.upserted) {
    const prev = prevRevs[item.externalId];
    const remoteHash = await computeAlmItemHash(item);
    if (!prev) {
      addedIds.push(item.externalId);
      continue;
    }

    const remoteChanged = prev.baseHash !== remoteHash;
    const localBlockHash = localBlocks[item.externalId];
    const localChanged = Boolean(prev.blockHash && localBlockHash && prev.blockHash !== localBlockHash);

    if (remoteChanged && localChanged) {
      conflicts.push({
        externalId: item.externalId,
        reason: "both-modified",
        baseHash: prev.baseHash,
        localHash: localBlockHash!,
        remoteHash,
      });
    } else if (remoteChanged) {
      updatedIds.push(item.externalId);
    }
  }

  for (const delId of delta.deletedIds) {
    const prev = prevRevs[delId];
    const localBlockHash = localBlocks[delId];
    if (prev?.blockHash && localBlockHash && prev.blockHash !== localBlockHash) {
      conflicts.push({
        externalId: delId,
        reason: "deleted-remotely-modified-locally",
        baseHash: prev.baseHash,
        localHash: localBlockHash,
      });
    }
  }

  const strategy = options.conflictStrategy ?? "fail";
  if (conflicts.length > 0 && strategy === "fail") {
    const ids = conflicts.map((c) => c.externalId).join(", ");
    throw new Error(
      `3-way sync conflict in ${spec.packageName} for item(s): ${ids}. Re-run with --conflict=theirs or resolve manually.`,
    );
  }

  const artifacts = [...artifactMap.values()];
  const snapshot = await materializeAlmArtifacts(spec.packageName, artifacts, delta.links, spec.format ?? "sysml2", {
    source: spec.source,
    baseline: delta.baselineUri ?? spec.baseline,
  });

  // Extract freshly generated block hashes for future 3-way local edit detection
  const newBlockHashes = snapshot.files[0] ? await extractLocalItemBlocks(snapshot.files[0].content) : {};

  const itemRevisions: Record<string, LockfileItemRevision> = {};
  for (const item of artifacts) {
    itemRevisions[item.externalId] = {
      etag: item.etag,
      revision: item.revision,
      baseHash: snapshot.itemHashes[item.externalId] ?? (await computeAlmItemHash(item)),
      blockHash: newBlockHashes[item.externalId],
    };
  }

  const remoteState: LockfileRemoteState = {
    connector: connector.protocol,
    cursor: delta.nextCursor ?? prevState?.cursor,
    baselineUri: delta.baselineUri ?? spec.baseline ?? prevState?.baselineUri,
    workingSet: delta.workingSet ?? spec.workingSet ?? prevState?.workingSet,
    materializePath: spec.materialize,
    syncedAt: new Date().toISOString(),
    itemRevisions,
  };

  return {
    snapshot,
    artifacts,
    links: delta.links,
    remoteState,
    snapshotVersion: delta.snapshotVersion,
    conflicts,
    addedIds,
    updatedIds,
    deletedIds,
  };
}

/**
 * Inspects local vs. remote drift without mutating any local files or lockfiles.
 */
export async function inspectRemoteDrift(
  connector: AlmConnector,
  spec: ResolvedRemoteSpec,
  auth: AuthContext,
  prevState?: LockfileRemoteState | null,
  existingLocalContent?: string,
): Promise<DriftStatusResult> {
  const delta = await connector.fetchDelta(spec, auth, prevState?.cursor);
  const localBlocks = existingLocalContent ? await extractLocalItemBlocks(existingLocalContent) : {};
  const prevRevs = prevState?.itemRevisions ?? {};

  const remoteAdded: string[] = [];
  const remoteUpdated: string[] = [];
  const remoteDeleted: string[] = [...delta.deletedIds];
  const localModified: string[] = [];
  const conflicts: SyncConflict[] = [];

  for (const [id, prev] of Object.entries(prevRevs)) {
    const localBlockHash = localBlocks[id];
    if (prev.blockHash && localBlockHash && prev.blockHash !== localBlockHash) {
      localModified.push(id);
    }
  }

  for (const item of delta.upserted) {
    const prev = prevRevs[item.externalId];
    const remoteHash = await computeAlmItemHash(item);
    if (!prev) {
      remoteAdded.push(item.externalId);
    } else if (prev.baseHash !== remoteHash) {
      remoteUpdated.push(item.externalId);
      if (localModified.includes(item.externalId)) {
        conflicts.push({
          externalId: item.externalId,
          reason: "both-modified",
          baseHash: prev.baseHash,
          localHash: localBlocks[item.externalId]!,
          remoteHash,
        });
      }
    }
  }

  const inSync =
    remoteAdded.length === 0 && remoteUpdated.length === 0 && remoteDeleted.length === 0 && localModified.length === 0;

  return {
    packageName: spec.packageName,
    connector: connector.protocol,
    inSync,
    remoteAdded,
    remoteUpdated,
    remoteDeleted,
    localModified,
    conflicts,
  };
}

/**
 * Guarded outbound push enforcing the `push:` capability list in `modelscript.yaml`.
 */
export async function pushRemotePackage(
  connector: AlmConnector,
  spec: ResolvedRemoteSpec,
  auth: AuthContext,
  payload: {
    links?: AlmLink[] | undefined;
    verificationRuns?: AlmVerificationRun[] | undefined;
    edits?: ArtifactEdit[] | undefined;
  },
): Promise<{
  links?: PushResult | undefined;
  verification?: PushResult | undefined;
  artifacts?: PushResult | undefined;
}> {
  const allowed = new Set<PushCapability>(spec.push ?? []);
  const out: {
    links?: PushResult | undefined;
    verification?: PushResult | undefined;
    artifacts?: PushResult | undefined;
  } = {};

  if (payload.links && payload.links.length > 0) {
    if (!allowed.has("links")) {
      throw new Error(
        `Outbound link push is disabled for "${spec.packageName}". Add "links" to its 'push:' list in modelscript.yaml.`,
      );
    }
    out.links = await connector.pushLinks(spec, auth, payload.links);
  }

  if (payload.verificationRuns && payload.verificationRuns.length > 0) {
    if (!allowed.has("verification") && !allowed.has("defects-on-fail")) {
      throw new Error(
        `Outbound verification push is disabled for "${spec.packageName}". Add "verification" or "defects-on-fail" to its 'push:' list in modelscript.yaml.`,
      );
    }
    out.verification = await connector.pushVerificationRuns(spec, auth, payload.verificationRuns);
  }

  if (payload.edits && payload.edits.length > 0) {
    if (!allowed.has("artifacts")) {
      throw new Error(
        `Outbound artifact editing is disabled for "${spec.packageName}". Add "artifacts" to its 'push:' list in modelscript.yaml.`,
      );
    }
    if (!connector.upsertArtifacts) {
      throw new Error(`Connector "${connector.protocol}" does not support bidirectional artifact upserts.`);
    }
    out.artifacts = await connector.upsertArtifacts(spec, auth, payload.edits);
  }

  return out;
}

/**
 * Compares a materialized `.sysml`/`.ms` file against `prevState.itemRevisions`
 * and extracts `ArtifactEdit[]` for every locally modified item (with optimistic locking ETag/revision).
 */
export async function extractDirtyArtifactEdits(
  localContent: string,
  prevState?: LockfileRemoteState | null,
): Promise<ArtifactEdit[]> {
  const parsedItems = await parseMaterializedExternalItems(localContent);
  const prevRevs = prevState?.itemRevisions ?? {};
  const edits: ArtifactEdit[] = [];

  for (const item of parsedItems) {
    const prev = prevRevs[item.externalId];
    if (prev?.blockHash && prev.blockHash === item.blockHash) {
      continue; // Unchanged locally
    }
    edits.push({
      externalId: item.externalId,
      uri: item.uri,
      title: item.title,
      text: item.text,
      status: item.status,
      expectedEtag: prev?.etag,
      expectedRevision: prev?.revision ?? item.revision,
    });
  }

  return edits;
}
