// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Canonical ALM / Requirements Management Intermediate Representation (IR).
 *
 * Bridges external protocol/API tools (IBM DOORS Next, Jama Connect, PTC Codebeamer,
 * Siemens Polarion, Jira) with ModelScript's `OslcGateway`, `DigitalThreadHypergraph`,
 * and deterministic `.sysml` / `.ms` file materializer.
 */

import type { OslcGateway } from "../oslc_gateway.js";
import { DigitalThreadHypergraph, ThreadDomain, ThreadRelation } from "../thread_hypergraph.js";

export type AlmArtifactKind = "requirement" | "change_request" | "test_case" | "document_section";

export type AlmLinkRelation = "satisfies" | "verifies" | "derivesFrom" | "tracks" | "blocks" | "relatesTo";

export interface AlmArtifact {
  /** Stable identifier in the remote tool (e.g., `REQ-042`, `ENG-1420`, `10429`). */
  externalId: string;
  /** Kind of ALM artifact. */
  kind: AlmArtifactKind;
  /** Canonical API / OSLC resource URI. */
  uri: string;
  /** Clickable web UI URL for LSP hover / deep links. */
  webUrl?: string | undefined;
  /** Human-readable title / summary. */
  title: string;
  /** Normalized plain-text body / requirement statement. */
  text: string;
  /** Lifecycle status (e.g., `Approved`, `Draft`, `Rejected`, `In Progress`, `Closed`). */
  status: string;
  /** Optional priority / criticality / ASIL / DAL label. */
  priority?: string | undefined;
  /** Optional parent external ID (for DOORS modules, Jama trees, Polarion LiveDocs). */
  parentId?: string | undefined;
  /** Optional ordinal position within parent/module for deterministic ordering. */
  order?: number | undefined;
  /** Remote revision identifier (e.g., Polarion SVN rev, Codebeamer item version). */
  revision?: string | undefined;
  /** HTTP ETag for optimistic concurrency (`If-Match`). */
  etag?: string | undefined;
  /** ISO-8601 modification timestamp. */
  modifiedAt?: string | undefined;
  /** Additional scalar custom fields preserved across round-trips. */
  attributes: Record<string, string | number | boolean>;
}

export interface AlmLink {
  /** External ID or local ModelScript symbol FQN on the source side. */
  sourceId: string;
  /** Target external ID or canonical URI. */
  targetId: string;
  /** Semantic relationship kind. */
  relation: AlmLinkRelation;
  /** Optional link title or label. */
  title?: string | undefined;
}

export interface AlmVerificationRun {
  /** Unique run identifier (e.g. CI build ID or UUID). */
  runId: string;
  /** Human-readable title for the test/verification run. */
  title: string;
  /** Outcome status. */
  status: "Passed" | "Failed" | "Inconclusive" | "Error";
  /** Git commit SHA that produced this verification evidence. */
  commitSha?: string | undefined;
  /** Deterministic DAE/model integrity hash. */
  daeHash?: string | undefined;
  /** External IDs of requirements/items verified by this run. */
  verifiesIds: string[];
  /** Key numerical metrics (RMSE, max overshoot, margin, etc.). */
  metrics: Record<string, number>;
  /** Execution duration in milliseconds. */
  durationMs?: number | undefined;
  /** ISO-8601 execution timestamp. */
  timestamp: string;
  /** Optional Ed25519 / compliance attestation signature. */
  signature?: string | undefined;
  /** Optional details or failure diagnostics. */
  details?: string | undefined;
  /** Optional URL to CI report / HTML dashboard. */
  reportUrl?: string | undefined;
}

export interface AlmDelta {
  /** Artifacts created or updated since the previous cursor (or full snapshot). */
  upserted: AlmArtifact[];
  /** External IDs deleted on the remote since the previous cursor. */
  deletedIds: string[];
  /** Traceability links discovered on the remote. */
  links: AlmLink[];
  /** True when `upserted` represents a complete snapshot rather than an incremental delta. */
  isFullSnapshot: boolean;
  /** Opaque cursor for the next incremental `fetchDelta()` call. */
  nextCursor?: string | undefined;
  /** Resolved baseline / configuration URI on the remote. */
  baselineUri?: string | undefined;
  /** Resolved working-set / branch name on the remote (if applicable). */
  workingSet?: string | undefined;
  /** Human-readable version/snapshot label for `modelscript.lock`. */
  snapshotVersion: string;
}

export interface ArtifactEdit {
  externalId: string;
  uri?: string | undefined;
  title?: string | undefined;
  text?: string | undefined;
  status?: string | undefined;
  expectedEtag?: string | undefined;
  expectedRevision?: string | undefined;
  attributes?: Record<string, string | number | boolean> | undefined;
}

export interface PushResult {
  pushed: number;
  skipped: number;
  errors: Array<{ id: string; message: string; statusCode?: number | undefined }>;
  createdIds?: Record<string, string> | undefined;
}

export interface RemoteCapabilities {
  protocol: string;
  serverName?: string | undefined;
  serverVersion?: string | undefined;
  supportsIncrementalDelta: boolean;
  supportsBaselines: boolean;
  supportsWorkingSets: boolean;
  supportsVerificationPush: boolean;
  supportsLinkPush: boolean;
  supportsArtifactUpsert: boolean;
}

export interface OAuth2AuthConfig {
  tokenUrl: string;
  clientId: string;
  clientSecret?: string | undefined;
  refreshToken?: string | undefined;
  scope?: string | undefined;
}

export interface AuthContext {
  /** Bearer token / PAT / OAuth2 access token. */
  token?: string | undefined;
  /** Username or email (for Basic auth, e.g. Jira Cloud email + API token). */
  username?: string | undefined;
  /** Password or API token when paired with `username`. */
  password?: string | undefined;
  /** Optional OAuth2 client-credentials or refresh-token grant configuration. */
  oauth2?: OAuth2AuthConfig | undefined;
  /** Optional custom HTTP headers. */
  headers?: Record<string, string> | undefined;
  /** Optional custom fetch implementation (useful for tests or proxy injection). */
  fetchImpl?: typeof fetch | undefined;
}

/**
 * Registers canonical `AlmArtifact` records into an `OslcGateway` instance
 * so they can be exported as OSLC Turtle/JSON-LD or served over HTTP.
 */
export function ingestAlmIntoOslcGateway(gateway: OslcGateway, artifacts: AlmArtifact[]): void {
  for (const item of artifacts) {
    if (item.kind === "change_request") {
      gateway.registerChangeRequest({
        identifier: item.externalId,
        uri: item.uri,
        title: item.title,
        description: item.text,
        status: item.status,
        externalKey: item.externalId,
        externalUrl: item.webUrl,
        attributes: item.attributes,
      });
    } else {
      gateway.registerRequirement({
        identifier: item.externalId,
        uri: item.uri,
        title: item.title,
        description: item.text,
        status: item.status,
        attributes: item.attributes,
      });
    }
  }
}

function hashStringToUint32(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0 || 1;
}

/**
 * Populates a `DigitalThreadHypergraph` with synced ALM artifacts and links
 * under `ThreadDomain.Requirements` and `ThreadDomain.Verification`.
 */
export function ingestAlmIntoDigitalThread(
  thread: DigitalThreadHypergraph,
  packageName: string,
  artifacts: AlmArtifact[],
  links: AlmLink[] = [],
): number {
  let count = 0;
  for (const item of artifacts) {
    const domain = item.kind === "test_case" ? ThreadDomain.Verification : ThreadDomain.Requirements;
    const symbolId = `${packageName}::${item.externalId}`;
    const nodeId = hashStringToUint32(symbolId);
    const slot = thread.createThread(nodeId, 1, ThreadRelation.Aligned);
    thread.bindDomainNode(slot, domain, nodeId);
    count++;
  }

  for (const link of links) {
    const rel =
      link.relation === "satisfies"
        ? ThreadRelation.Satisfies
        : link.relation === "verifies"
          ? ThreadRelation.Verifies
          : link.relation === "derivesFrom"
            ? ThreadRelation.DerivesFrom
            : ThreadRelation.Aligned;
    const targetNodeId = hashStringToUint32(`${packageName}::${link.targetId}`);
    const sourceNodeId = hashStringToUint32(link.sourceId);
    const threadId = hashStringToUint32(`${link.sourceId}:${link.relation}:${packageName}::${link.targetId}`);
    const slot = thread.createThread(threadId, 1, rel);
    thread.bindDomainNode(slot, ThreadDomain.Requirements, targetNodeId);
    thread.bindDomainNode(slot, ThreadDomain.Verification, sourceNodeId);
  }
  return count;
}
