// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "node:crypto";
import type { ThreadAuditLogEntry, ThreadConflictRecord, ThreadProposal } from "../../database.js";
import { BaseRepository } from "./base.js";
export class Sysml2Repository extends BaseRepository {
  // ── SysML v2 OMG Persistence ──

  saveSysml2Project(project: {
    "@id": string;
    name: string;
    description?: string | undefined;
    created: string;
    defaultBranch: { "@id": string; name: string; headCommitId?: string | undefined };
  }): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO sysml2_projects (id, name, description, created, default_branch)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        project["@id"],
        project.name,
        project.description || null,
        project.created,
        JSON.stringify(project.defaultBranch),
      );
  }

  getSysml2Projects(): {
    "@id": string;
    "@type": "Project";
    name: string;
    description?: string | undefined;
    created: string;
    defaultBranch: { "@id": string; name: string; headCommitId?: string | undefined };
  }[] {
    const rows = this.db.prepare(`SELECT * FROM sysml2_projects ORDER BY created ASC`).all() as {
      id: string;
      name: string;
      description: string | null;
      created: string;
      default_branch: string;
    }[];
    return rows.map((r) => ({
      "@id": r.id,
      "@type": "Project" as const,
      name: r.name,
      description: r.description || undefined,
      created: r.created,
      defaultBranch: JSON.parse(r.default_branch) as {
        "@id": string;
        name: string;
        headCommitId?: string | undefined;
      },
    }));
  }

  deleteSysml2Project(projectId: string): void {
    this.db.transaction(() => {
      const commits = this.db.prepare(`SELECT id FROM sysml2_commits WHERE project_id = ?`).all(projectId) as {
        id: string;
      }[];
      for (const c of commits) {
        this.db.prepare(`DELETE FROM sysml2_elements WHERE commit_id = ?`).run(c.id);
        this.db.prepare(`DELETE FROM sysml2_relationships WHERE commit_id = ?`).run(c.id);
      }
      this.db.prepare(`DELETE FROM sysml2_tags WHERE project_id = ?`).run(projectId);
      this.db.prepare(`DELETE FROM sysml2_branches WHERE project_id = ?`).run(projectId);
      this.db.prepare(`DELETE FROM sysml2_commits WHERE project_id = ?`).run(projectId);
      this.db.prepare(`DELETE FROM sysml2_projects WHERE id = ?`).run(projectId);
    })();
  }

  saveSysml2Branch(branch: {
    "@id": string;
    projectId: string;
    name: string;
    headCommitId?: string | undefined;
    created: string;
  }): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO sysml2_branches (id, project_id, name, head_commit_id, created)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(branch["@id"], branch.projectId, branch.name, branch.headCommitId || null, branch.created);
  }

  getSysml2Branches(projectId: string): {
    "@id": string;
    "@type": "Branch";
    projectId: string;
    name: string;
    headCommitId?: string | undefined;
    created: string;
  }[] {
    const rows = this.db
      .prepare(`SELECT * FROM sysml2_branches WHERE project_id = ? ORDER BY created ASC`)
      .all(projectId) as {
      id: string;
      project_id: string;
      name: string;
      head_commit_id: string | null;
      created: string;
    }[];
    return rows.map((r) => ({
      "@id": r.id,
      "@type": "Branch" as const,
      projectId: r.project_id,
      name: r.name,
      headCommitId: r.head_commit_id || undefined,
      created: r.created,
    }));
  }

  deleteSysml2Branch(projectId: string, branchId: string): boolean {
    const res = this.db.prepare(`DELETE FROM sysml2_branches WHERE project_id = ? AND id = ?`).run(projectId, branchId);
    return res.changes > 0;
  }

  saveSysml2Tag(tag: {
    "@id": string;
    projectId: string;
    name: string;
    taggedCommit: { "@id": string };
    created: string;
  }): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO sysml2_tags (id, project_id, name, tagged_commit_id, created)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(tag["@id"], tag.projectId, tag.name, tag.taggedCommit["@id"], tag.created);
  }

  getSysml2Tags(projectId: string): {
    "@id": string;
    "@type": "Tag";
    projectId: string;
    name: string;
    taggedCommit: { "@id": string };
    created: string;
  }[] {
    const rows = this.db
      .prepare(`SELECT * FROM sysml2_tags WHERE project_id = ? ORDER BY created ASC`)
      .all(projectId) as {
      id: string;
      project_id: string;
      name: string;
      tagged_commit_id: string;
      created: string;
    }[];
    return rows.map((r) => ({
      "@id": r.id,
      "@type": "Tag" as const,
      projectId: r.project_id,
      name: r.name,
      taggedCommit: { "@id": r.tagged_commit_id },
      created: r.created,
    }));
  }

  saveSysml2Commit(commit: {
    "@id": string;
    projectId: string;
    description: string;
    created: string;
    previousCommit?: { "@id": string } | null | undefined;
    mergedCommit?: { "@id": string } | null | undefined;
  }): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO sysml2_commits (id, project_id, description, created, previous_commit, merged_commit)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        commit["@id"],
        commit.projectId,
        commit.description,
        commit.created,
        commit.previousCommit ? commit.previousCommit["@id"] : null,
        commit.mergedCommit ? commit.mergedCommit["@id"] : null,
      );
  }

  getSysml2Commits(projectId: string): {
    "@id": string;
    "@type": "Commit";
    projectId: string;
    description: string;
    created: string;
    previousCommit?: { "@id": string } | null | undefined;
    mergedCommit?: { "@id": string } | null | undefined;
  }[] {
    const rows = this.db
      .prepare(`SELECT * FROM sysml2_commits WHERE project_id = ? ORDER BY created ASC`)
      .all(projectId) as {
      id: string;
      project_id: string;
      description: string;
      created: string;
      previous_commit: string | null;
      merged_commit: string | null;
    }[];
    return rows.map((r) => ({
      "@id": r.id,
      "@type": "Commit" as const,
      projectId: r.project_id,
      description: r.description,
      created: r.created,
      previousCommit: r.previous_commit ? { "@id": r.previous_commit } : null,
      ...(r.merged_commit ? { mergedCommit: { "@id": r.merged_commit } } : {}),
    }));
  }

  saveSysml2Elements(commitId: string, elements: Record<string, unknown>[]): void {
    const insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO sysml2_elements (id, commit_id, name, qualified_name, owner_id, is_abstract, element_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    this.db.transaction(() => {
      for (const elem of elements) {
        const owner = elem["owner"] as { "@id"?: string | undefined } | null | undefined;
        insertStmt.run(
          elem["@id"] as string,
          commitId,
          (elem["name"] as string | undefined) || "",
          (elem["qualifiedName"] as string | undefined) || "",
          owner?.["@id"] || null,
          elem["isAbstract"] ? 1 : 0,
          JSON.stringify(elem),
        );
      }
    })();
  }

  getSysml2Elements(commitId: string): Record<string, unknown>[] {
    const rows = this.db.prepare(`SELECT element_json FROM sysml2_elements WHERE commit_id = ?`).all(commitId) as {
      element_json: string;
    }[];
    return rows.map((r) => JSON.parse(r.element_json) as Record<string, unknown>);
  }

  saveSysml2Relationships(commitId: string, relationships: Record<string, unknown>[]): void {
    const insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO sysml2_relationships (id, commit_id, source_id, target_id, rel_type, rel_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    this.db.transaction(() => {
      for (const rel of relationships) {
        const source = rel["source"] as { "@id"?: string | undefined }[] | undefined;
        const target = rel["target"] as { "@id"?: string | undefined }[] | undefined;
        const sourceId = source?.[0]?.["@id"] || "";
        const targetId = target?.[0]?.["@id"] || "";
        insertStmt.run(
          rel["@id"] as string,
          commitId,
          sourceId,
          targetId,
          (rel["relationshipType"] as string | undefined) || "",
          JSON.stringify(rel),
        );
      }
    })();
  }

  getSysml2Relationships(commitId: string): Record<string, unknown>[] {
    const rows = this.db.prepare(`SELECT rel_json FROM sysml2_relationships WHERE commit_id = ?`).all(commitId) as {
      rel_json: string;
    }[];
    return rows.map((r) => JSON.parse(r.rel_json) as Record<string, unknown>);
  }

  getFeatureFlags() {
    return this.facade.admin.getFeatureFlags();
  }

  getFeatureFlag(key: string) {
    return this.facade.admin.getFeatureFlag(key);
  }

  isFeatureFlagEnabled(key: string): boolean {
    return this.facade.admin.isFeatureFlagEnabled(key);
  }

  setFeatureFlag(key: string, isEnabled: boolean, allowedRoles?: string, rolloutPercentage = 100): void {
    this.facade.admin.setFeatureFlag(key, isEnabled, allowedRoles, rolloutPercentage);
  }

  createThreadProposal(proposal: {
    threadId: string;
    title: string;
    description?: string | undefined;
    proposedBy: string;
    diffSummary: string | object;
    safetyStandard?: string | undefined;
  }): ThreadProposal {
    const diffStr =
      typeof proposal.diffSummary === "object" ? JSON.stringify(proposal.diffSummary) : proposal.diffSummary;
    const stmt = this.db.prepare(`
      INSERT INTO thread_proposals (thread_id, title, description, status, proposed_by, diff_summary, created_at)
      VALUES (?, ?, ?, 'open', ?, ?, datetime('now'))
    `);
    const res = stmt.run(proposal.threadId, proposal.title, proposal.description || null, proposal.proposedBy, diffStr);
    const newId = Number(res.lastInsertRowid);

    this.logThreadAudit({
      threadId: proposal.threadId,
      proposalId: newId,
      action: "proposal_created",
      actor: proposal.proposedBy,
      safetyStandard: proposal.safetyStandard || "ISO-26262",
      metadata: { title: proposal.title, diffSummary: proposal.diffSummary },
    });

    return this.getThreadProposalById(newId)!;
  }

  getThreadProposalById(id: number): ThreadProposal | undefined {
    return this.db.prepare(`SELECT * FROM thread_proposals WHERE id = ?`).get(id) as ThreadProposal | undefined;
  }

  getThreadProposals(threadId?: string, status?: string): ThreadProposal[] {
    let sql = `SELECT * FROM thread_proposals WHERE 1=1`;
    const params: string[] = [];
    if (threadId) {
      sql += ` AND thread_id = ?`;
      params.push(threadId);
    }
    if (status) {
      sql += ` AND status = ?`;
      params.push(status);
    }
    sql += ` ORDER BY created_at DESC`;
    return this.db.prepare(sql).all(...params) as ThreadProposal[];
  }

  reviewThreadProposal(
    id: number,
    status: "approved" | "rejected" | "applied",
    resolvedBy: string,
    comment?: string,
    safetyStandard?: string,
  ): ThreadProposal | undefined {
    const existing = this.getThreadProposalById(id);
    if (!existing) return undefined;

    this.db
      .prepare(
        `
      UPDATE thread_proposals
      SET status = ?, resolved_at = datetime('now'), resolved_by = ?, review_comment = ?
      WHERE id = ?
    `,
      )
      .run(status, resolvedBy, comment || null, id);

    this.logThreadAudit({
      threadId: existing.thread_id,
      proposalId: id,
      action: `proposal_${status}`,
      actor: resolvedBy,
      safetyStandard: safetyStandard || "ISO-26262",
      metadata: { comment, previousStatus: existing.status, newStatus: status },
    });

    return this.getThreadProposalById(id);
  }

  logThreadAudit(entry: {
    threadId: string;
    proposalId?: number | null | undefined;
    action: string;
    actor: string;
    safetyStandard?: string | null | undefined;
    metadata?: string | object | undefined;
  }): ThreadAuditLogEntry {
    const last = this.db
      .prepare(`SELECT checksum FROM thread_audit_log WHERE thread_id = ? ORDER BY id DESC LIMIT 1`)
      .get(entry.threadId) as { checksum: string } | undefined;
    const prevChecksum = last?.checksum || "GENESIS_ROOT";

    const metaStr = entry.metadata
      ? typeof entry.metadata === "object"
        ? JSON.stringify(entry.metadata)
        : entry.metadata
      : null;

    // Cryptographic hash chaining: SHA256(prevChecksum + fields)
    const raw = `${prevChecksum}:${entry.threadId}:${entry.proposalId ?? ""}:${entry.action}:${entry.actor}:${entry.safetyStandard ?? ""}:${metaStr ?? ""}`;
    const checksum = crypto.createHash("sha256").update(raw).digest("hex");

    const stmt = this.db.prepare(`
      INSERT INTO thread_audit_log (thread_id, proposal_id, action, actor, safety_standard, checksum, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);
    const res = stmt.run(
      entry.threadId,
      entry.proposalId ?? null,
      entry.action,
      entry.actor,
      entry.safetyStandard ?? null,
      checksum,
      metaStr,
    );

    return this.db
      .prepare(`SELECT * FROM thread_audit_log WHERE id = ?`)
      .get(res.lastInsertRowid) as ThreadAuditLogEntry;
  }

  getThreadAuditLogs(threadId?: string): ThreadAuditLogEntry[] {
    if (threadId) {
      return this.db
        .prepare(`SELECT * FROM thread_audit_log WHERE thread_id = ? ORDER BY id ASC`)
        .all(threadId) as ThreadAuditLogEntry[];
    }
    return this.db.prepare(`SELECT * FROM thread_audit_log ORDER BY id ASC`).all() as ThreadAuditLogEntry[];
  }

  verifyThreadAuditChain(threadId: string): { valid: boolean; totalEntries: number; brokenAtId?: number | undefined } {
    const logs = this.getThreadAuditLogs(threadId);
    let prevChecksum = "GENESIS_ROOT";

    for (const log of logs) {
      const raw = `${prevChecksum}:${log.thread_id}:${log.proposal_id ?? ""}:${log.action}:${log.actor}:${log.safety_standard ?? ""}:${log.metadata ?? ""}`;
      const expectedChecksum = crypto.createHash("sha256").update(raw).digest("hex");
      if (log.checksum !== expectedChecksum) {
        return { valid: false, totalEntries: logs.length, brokenAtId: log.id };
      }
      prevChecksum = log.checksum;
    }

    return { valid: true, totalEntries: logs.length };
  }

  saveThreadSnapshot(
    serializedJson: string,
    metadataMap?: Map<string, unknown> | Record<string, unknown>,
    workspaceId = "default",
  ): void {
    let metaObj: Record<string, unknown> = {};
    if (metadataMap instanceof Map) {
      metaObj = Object.fromEntries(metadataMap.entries());
    } else if (metadataMap && typeof metadataMap === "object") {
      metaObj = metadataMap;
    }
    this.db
      .prepare(
        `INSERT OR REPLACE INTO thread_snapshots (workspace_id, serialized_json, metadata_json, updated_at)
         VALUES (?, ?, ?, datetime('now'))`,
      )
      .run(workspaceId, serializedJson, JSON.stringify(metaObj));
  }

  loadThreadSnapshot(workspaceId = "default"): {
    serializedJson: string;
    metadata: Record<string, unknown>;
    updatedAt: string;
  } | null {
    const row = this.db.prepare(`SELECT * FROM thread_snapshots WHERE workspace_id = ?`).get(workspaceId) as
      | {
          serialized_json: string;
          metadata_json: string | null;
          updated_at: string;
        }
      | undefined;
    if (!row) return null;
    let metadata: Record<string, unknown> = {};
    try {
      metadata = JSON.parse(row.metadata_json || "{}") as Record<string, unknown>;
    } catch {
      metadata = {};
    }
    return {
      serializedJson: row.serialized_json,
      metadata,
      updatedAt: row.updated_at,
    };
  }

  saveThreadConflict(conflict: {
    conflictId: string;
    workspaceId?: string | undefined;
    slot: number;
    sourceDomain: string;
    sourceValue: number;
    sourceUnit: string;
    targetDomain: string;
    targetValue: number;
    targetUnit: string;
    min: number;
    max: number;
    status?: "conflicted" | "resolved" | undefined;
    resolvedValue?: number | null | undefined;
  }): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO thread_conflicts (
          conflict_id, workspace_id, slot, source_domain, source_value, source_unit,
          target_domain, target_value, target_unit, min_bound, max_bound, status, resolved_value, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(
        conflict.conflictId,
        conflict.workspaceId || "default",
        conflict.slot,
        conflict.sourceDomain,
        conflict.sourceValue,
        conflict.sourceUnit,
        conflict.targetDomain,
        conflict.targetValue,
        conflict.targetUnit,
        conflict.min,
        conflict.max,
        conflict.status || "conflicted",
        conflict.resolvedValue ?? null,
      );
  }

  getThreadConflicts(workspaceId = "default", status?: string): ThreadConflictRecord[] {
    let sql = `SELECT * FROM thread_conflicts WHERE workspace_id = ?`;
    const params: string[] = [workspaceId];
    if (status) {
      sql += ` AND status = ?`;
      params.push(status);
    }
    sql += ` ORDER BY updated_at DESC`;
    const rows = this.db.prepare(sql).all(...params) as {
      conflict_id: string;
      workspace_id: string;
      slot: number;
      source_domain: string;
      source_value: number;
      source_unit: string;
      target_domain: string;
      target_value: number;
      target_unit: string;
      min_bound: number;
      max_bound: number;
      status: "conflicted" | "resolved";
      resolved_value: number | null;
      updated_at: string;
    }[];
    return rows.map((r) => ({
      conflictId: r.conflict_id,
      workspaceId: r.workspace_id,
      slot: r.slot,
      sourceDomain: r.source_domain,
      sourceValue: r.source_value,
      sourceUnit: r.source_unit,
      targetDomain: r.target_domain,
      targetValue: r.target_value,
      targetUnit: r.target_unit,
      min: r.min_bound,
      max: r.max_bound,
      status: r.status,
      resolvedValue: r.resolved_value,
      updatedAt: r.updated_at,
    }));
  }

  resolveThreadConflict(conflictId: string, resolvedValue: number): void {
    this.db
      .prepare(
        `UPDATE thread_conflicts
         SET status = 'resolved', resolved_value = ?, updated_at = datetime('now')
         WHERE conflict_id = ?`,
      )
      .run(resolvedValue, conflictId);
  }
}
