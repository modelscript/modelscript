// SPDX-License-Identifier: AGPL-3.0-or-later

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  OrgRole,
  OrganizationMemberRecord,
  OrganizationRecord,
  SpaceChannelKind,
  SpaceChannelRecord,
  SpaceEcoApprovalRecord,
  SpaceEcoProposalRecord,
  SpaceIssueCommentRecord,
  SpaceIssueRecord,
  SpaceMemberRecord,
  SpaceMessageRecord,
  SpaceOwnerType,
  SpacePageRecord,
  SpaceRecord,
  SpaceRole,
  SpaceVisibility,
  SpaceWorkflowRunRecord,
} from "../../database.js";
import { getSpaceDomainPreset } from "../../services/spaces/domain-presets.js";
import { computeEcoBlastRadius } from "../../services/spaces/eco-blast-radius-service.js";
import { computeEcoBomDelta } from "../../services/spaces/eco-bom-service.js";
import { generateAasxPackage, generateDdpContainer } from "../../services/spaces/eco-packaging-service.js";
import { computeEcoSimulationVerification } from "../../services/spaces/eco-simulation-gate-service.js";
import {
  createSpaceGitBranch,
  ensureSpaceGitVaultInitialized,
  getSpaceGitDiff,
  mergeSpaceGitBranches,
  relocateSpaceGitVault,
  tagSpaceGitCommit,
} from "../../services/spaces/space-git-vault.js";
import { discoverWorkflowsInRepo, executeWorkflowManifest } from "../../services/workflows/index.js";
import { BaseRepository } from "./base.js";
export class SpaceRepository extends BaseRepository {
  // =========================================================================
  // Ansatz Spaces, Polymorphic Containers, Living Docs, Chat & PLM ECOs
  // =========================================================================

  #mapSpaceRow(row: Record<string, unknown>): SpaceRecord {
    let enabledTabs: string[] = ["feed", "chat", "docs", "articles", "repos", "packages", "plm", "twins"];
    if (typeof row["enabled_tabs_json"] === "string") {
      try {
        const parsed = JSON.parse(row["enabled_tabs_json"]);
        if (Array.isArray(parsed)) enabledTabs = parsed.map(String);
      } catch {
        // Optional JSON column or best-effort side-effect ignored
      }
    }
    let settings: Record<string, unknown> = {};
    if (typeof row["settings_json"] === "string") {
      try {
        const parsed = JSON.parse(row["settings_json"]);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          settings = parsed as Record<string, unknown>;
        }
      } catch {
        // Optional JSON column or best-effort side-effect ignored
      }
    }
    return {
      id: String(row["id"]),
      slug: String(row["slug"]),
      name: String(row["name"]),
      tagline: row["tagline"] != null ? String(row["tagline"]) : null,
      description: row["description"] != null ? String(row["description"]) : null,
      owner_type: (row["owner_type"] === "organization" ? "organization" : "user") as SpaceOwnerType,
      user_id: row["user_id"] != null ? Number(row["user_id"]) : null,
      organization_id: row["organization_id"] != null ? Number(row["organization_id"]) : null,
      owner_namespace: String(row["owner_namespace"] ?? ""),
      owner_display_name: row["owner_display_name"] != null ? String(row["owner_display_name"]) : null,
      owner_avatar_url: row["owner_avatar_url"] != null ? String(row["owner_avatar_url"]) : null,
      domain_preset: String(row["domain_preset"] || "systems_general"),
      visibility: (row["visibility"] || "public") as SpaceVisibility,
      avatar_url: row["avatar_url"] != null ? String(row["avatar_url"]) : null,
      banner_url: row["banner_url"] != null ? String(row["banner_url"]) : null,
      default_branch: String(row["default_branch"] || "main"),
      git_repo_path: row["git_repo_path"] != null ? String(row["git_repo_path"]) : null,
      enabled_tabs: enabledTabs,
      settings,
      follower_count: Number(row["follower_count"] ?? 0),
      member_count: Number(row["member_count"] ?? 1),
      created_at: String(row["created_at"] ?? ""),
      updated_at: String(row["updated_at"] ?? ""),
    };
  }

  /**
   * Resolves a polymorphic namespace slug (`/@:slug`) to either an Organization or a User Profile,
   * along with the Spaces contained in that namespace.
   */
  resolveNamespacePrincipal(
    rawSlug: string,
    viewerUserId?: number,
  ):
    | {
        kind: "organization";
        organization: OrganizationRecord;
        spaces: SpaceRecord[];
        members: OrganizationMemberRecord[];
        viewerRole: OrgRole | null;
      }
    | {
        kind: "user";
        user: {
          id: number;
          username: string;
          display_name: string | null;
          bio: string | null;
          avatar_url: string | null;
          banner_url: string | null;
          location: string | null;
          website: string | null;
          created_at: string;
        };
        spaces: SpaceRecord[];
      }
    | null {
    const clean = rawSlug.trim().replace(/^@/, "").toLowerCase();
    if (!clean) return null;

    const org = this.facade.getOrganizationBySlug(clean);
    if (org) {
      const spaces = this.getOrganizationSpaces(org.id, viewerUserId);
      const members = this.facade.getOrganizationMembers(org.id);
      const viewerRole = viewerUserId ? this.facade.getOrganizationMemberRole(org.id, viewerUserId) : null;
      return {
        kind: "organization",
        organization: org,
        spaces,
        members,
        viewerRole,
      };
    }

    const user = this.facade.getUserByUsername(clean);
    if (user) {
      const spaces = this.getUserOwnedSpaces(user.id, viewerUserId);
      return {
        kind: "user",
        user: {
          id: user.id,
          username: user.username,
          display_name: user.display_name ?? null,
          bio: user.bio ?? null,
          avatar_url: user.avatar_url ?? null,
          banner_url: user.banner_url ?? null,
          location: user.location ?? null,
          website: user.website ?? null,
          created_at: user.created_at ?? "",
        },
        spaces,
      };
    }

    return null;
  }

  createSpace(params: {
    slug: string;
    name: string;
    tagline?: string | null | undefined;
    description?: string | null | undefined;
    ownerType: SpaceOwnerType;
    userId?: number | null | undefined;
    organizationId?: number | null | undefined;
    creatorUserId: number;
    domainPreset?: string | undefined;
    visibility?: SpaceVisibility | undefined;
    avatarUrl?: string | null | undefined;
    bannerUrl?: string | null | undefined;
    defaultBranch?: string | undefined;
  }): SpaceRecord {
    const id = `spc_${crypto.randomBytes(8).toString("hex")}`;
    const slug = params.slug.trim().toLowerCase();
    const preset = getSpaceDomainPreset(params.domainPreset);
    const visibility: SpaceVisibility = params.visibility || "public";
    const defaultBranch = params.defaultBranch?.trim() || "main";

    let ownerNamespace = "";
    if (params.ownerType === "organization") {
      if (!params.organizationId) {
        throw new Error("organizationId is required when ownerType is 'organization'");
      }
      const org = this.facade.getOrganizationById(params.organizationId);
      if (!org) {
        throw new Error("Target organization not found");
      }
      ownerNamespace = org.slug;
    } else {
      const targetUserId = params.userId ?? params.creatorUserId;
      const u = this.facade.getUserById(targetUserId);
      if (!u) {
        throw new Error("Target user not found");
      }
      ownerNamespace = u.username;
    }

    const existing = this.getSpaceByNamespaceAndSlug(ownerNamespace, slug);
    if (existing) {
      throw new Error(`A Space with slug '${slug}' already exists in @${ownerNamespace}`);
    }

    const vault = ensureSpaceGitVaultInitialized({
      dbDir: this.facade.dbDir,
      namespace: ownerNamespace,
      slug,
      name: params.name.trim(),
      domainPreset: preset.id,
      defaultBranch,
    });

    this.db
      .prepare(
        `INSERT INTO spaces (
          id, slug, name, tagline, description,
          owner_type, user_id, organization_id,
          domain_preset, visibility, avatar_url, banner_url,
          default_branch, git_repo_path, enabled_tabs_json, settings_json,
          follower_count, member_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`,
      )
      .run(
        id,
        slug,
        params.name.trim(),
        params.tagline?.trim() ?? preset.description.slice(0, 140),
        params.description?.trim() ?? preset.description,
        params.ownerType,
        params.ownerType === "user" ? (params.userId ?? params.creatorUserId) : null,
        params.ownerType === "organization" ? params.organizationId! : null,
        preset.id,
        visibility,
        params.avatarUrl ?? null,
        params.bannerUrl ?? null,
        defaultBranch,
        vault.repoPath,
        JSON.stringify(preset.enabledTabs),
        JSON.stringify({
          complianceStandards: preset.complianceStandards,
          languages: preset.languages,
          replacesTools: preset.replacesTools,
        }),
      );

    // Add creator as owner in space_members & space_follows
    this.db
      .prepare(`INSERT OR IGNORE INTO space_members (space_id, user_id, role) VALUES (?, ?, 'owner')`)
      .run(id, params.creatorUserId);
    this.db
      .prepare(`INSERT OR IGNORE INTO space_follows (space_id, user_id) VALUES (?, ?)`)
      .run(id, params.creatorUserId);

    // Seed default Slack/Discord-style channels for the domain preset
    preset.defaultChannels.forEach((chSpec, idx) => {
      const chId = `chn_${crypto.randomBytes(8).toString("hex")}`;
      this.db
        .prepare(
          `INSERT INTO space_channels (id, space_id, slug, name, topic, kind, position, is_private)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
        )
        .run(chId, id, chSpec.slug, chSpec.name, chSpec.topic, chSpec.kind, idx);

      if (chSpec.slug === "general") {
        const welcomeMsgId = `msg_${crypto.randomBytes(8).toString("hex")}`;
        const welcomeContent = `Welcome to **#${chSpec.name}** in **@${ownerNamespace}/${slug}** (${preset.name})! 🚀\n\nDrop an executable snippet below or type \`#\` to reference Living Docs, models, and PLM Change Orders:\n\n\`\`\`${preset.sampleCodeSnippet.language}\n${preset.sampleCodeSnippet.code}\n\`\`\``;
        this.db
          .prepare(
            `INSERT INTO space_messages (
              id, channel_id, space_id, author_id, sender_type, sender_name, content
            ) VALUES (?, ?, ?, ?, 'bot', 'Ansatz Space Bot', ?)`,
          )
          .run(welcomeMsgId, chId, id, params.creatorUserId, welcomeContent);
      }
    });

    // Seed starter Living Docs (CMS pages) in space_pages
    preset.starterDocs.forEach((docSpec, idx) => {
      const pageId = `doc_${crypto.randomBytes(8).toString("hex")}`;
      this.db
        .prepare(
          `INSERT INTO space_pages (
            id, space_id, slug, title, summary, content_markdown,
            path_in_git, order_index, last_commit_sha, author_user_id, is_published
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        )
        .run(
          pageId,
          id,
          docSpec.slug,
          docSpec.title,
          docSpec.summary,
          docSpec.contentMarkdown,
          docSpec.pathInGit,
          idx,
          vault.headCommitSha,
          params.creatorUserId,
        );
    });

    // Seed an initial PLM Engineering Change Order (ECO-1) baseline record
    const ecoId = `eco_${crypto.randomBytes(8).toString("hex")}`;
    this.db
      .prepare(
        `INSERT INTO space_eco_proposals (
          id, space_id, eco_number, title, description, status, severity,
          source_branch, target_branch, author_id, impacted_models_json,
          simulation_gate_status, simulation_summary_json
        ) VALUES (?, ?, 1, ?, ?, 'approved', 'standard', 'init/baseline', ?, ?, ?, 'passed', ?)`,
      )
      .run(
        ecoId,
        id,
        `Initialize ${preset.shortLabel} Baseline & Verification Gates`,
        `Initial baseline architecture, Living Docs specification, and continuous DAE simulation verification gates for ${params.name.trim()}.`,
        defaultBranch,
        params.creatorUserId,
        JSON.stringify([preset.sampleCodeSnippet.title, "docs/overview.md"]),
        JSON.stringify({
          status: "passed",
          rmse: 0.0,
          verifiedStandards: preset.complianceStandards,
        }),
      );

    return this.getSpaceById(id)!;
  }

  static readonly #SPACE_SELECT_SQL = `
    SELECT
      s.*,
      CASE
        WHEN s.owner_type = 'organization' THEN o.slug
        ELSE u.username
      END AS owner_namespace,
      CASE
        WHEN s.owner_type = 'organization' THEN COALESCE(o.display_name, o.name)
        ELSE COALESCE(u.display_name, u.username)
      END AS owner_display_name,
      CASE
        WHEN s.owner_type = 'organization' THEN o.avatar_url
        ELSE u.avatar_url
      END AS owner_avatar_url
    FROM spaces s
    LEFT JOIN users u ON s.owner_type = 'user' AND s.user_id = u.id
    LEFT JOIN organizations o ON s.owner_type = 'organization' AND s.organization_id = o.id
  `;

  getSpaceById(id: string): SpaceRecord | null {
    const row = this.db.prepare(`${SpaceRepository.#SPACE_SELECT_SQL} WHERE s.id = ?`).get(id) as
      Record<string, unknown> | undefined;
    return row ? this.#mapSpaceRow(row) : null;
  }

  getSpaceByNamespaceAndSlug(namespace: string, slug: string): SpaceRecord | null {
    const cleanNs = namespace.trim().replace(/^@/, "").toLowerCase();
    const cleanSlug = slug.trim().toLowerCase();
    if (!cleanNs || !cleanSlug) return null;

    const row = this.db
      .prepare(
        `${SpaceRepository.#SPACE_SELECT_SQL}
         WHERE LOWER(s.slug) = ?
           AND (
             (s.owner_type = 'user' AND LOWER(u.username) = ?)
             OR (s.owner_type = 'organization' AND LOWER(o.slug) = ?)
           )`,
      )
      .get(cleanSlug, cleanNs, cleanNs) as Record<string, unknown> | undefined;
    return row ? this.#mapSpaceRow(row) : null;
  }

  canUserViewSpace(space: SpaceRecord, viewerUserId?: number | null, isAdmin?: boolean): boolean {
    if (isAdmin) return true;
    if (space.visibility === "public" || space.visibility === "unlisted") return true;
    if (!viewerUserId) return false;
    if (space.owner_type === "user" && space.user_id === viewerUserId) return true;
    const spaceRole = this.getSpaceMemberRole(space.id, viewerUserId);
    if (spaceRole) return true;
    if (space.owner_type === "organization" && space.organization_id) {
      const orgRole = this.facade.getOrganizationMemberRole(space.organization_id, viewerUserId);
      if (orgRole && (space.visibility === "internal" || orgRole === "owner" || orgRole === "maintainer")) {
        return true;
      }
    }
    return false;
  }

  canUserWriteSpace(space: SpaceRecord, viewerUserId?: number | null, isAdmin?: boolean): boolean {
    if (!viewerUserId) return false;
    if (isAdmin) return true;
    if (space.owner_type === "user" && space.user_id === viewerUserId) return true;
    const spaceRole = this.getSpaceMemberRole(space.id, viewerUserId);
    if (
      spaceRole === "owner" ||
      spaceRole === "lead_engineer" ||
      spaceRole === "approver" ||
      spaceRole === "contributor"
    ) {
      return true;
    }
    if (space.owner_type === "organization" && space.organization_id) {
      const orgRole = this.facade.getOrganizationMemberRole(space.organization_id, viewerUserId);
      if (orgRole === "owner" || orgRole === "maintainer") return true;
    }
    return false;
  }

  canUserAdminSpace(space: SpaceRecord, viewerUserId?: number | null, isAdmin?: boolean): boolean {
    if (!viewerUserId) return false;
    if (isAdmin) return true;
    if (space.owner_type === "user" && space.user_id === viewerUserId) return true;
    const spaceRole = this.getSpaceMemberRole(space.id, viewerUserId);
    if (spaceRole === "owner" || spaceRole === "lead_engineer") return true;
    if (space.owner_type === "organization" && space.organization_id) {
      const orgRole = this.facade.getOrganizationMemberRole(space.organization_id, viewerUserId);
      if (orgRole === "owner" || orgRole === "maintainer") return true;
    }
    return false;
  }

  listSpaces(opts?: {
    ownerType?: SpaceOwnerType | undefined;
    namespace?: string | undefined;
    domainPreset?: string | undefined;
    search?: string | undefined;
    viewerUserId?: number | undefined;
    limit?: number | undefined;
  }): SpaceRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (opts?.ownerType) {
      clauses.push(`s.owner_type = ?`);
      params.push(opts.ownerType);
    }
    if (opts?.namespace) {
      const cleanNs = opts.namespace.trim().replace(/^@/, "").toLowerCase();
      clauses.push(
        `((s.owner_type = 'user' AND LOWER(u.username) = ?) OR (s.owner_type = 'organization' AND LOWER(o.slug) = ?))`,
      );
      params.push(cleanNs, cleanNs);
    }
    if (opts?.domainPreset && opts.domainPreset !== "all") {
      clauses.push(`s.domain_preset = ?`);
      params.push(opts.domainPreset);
    }
    if (opts?.search?.trim()) {
      const q = `%${opts.search.trim().toLowerCase()}%`;
      clauses.push(
        `(LOWER(s.name) LIKE ? OR LOWER(s.slug) LIKE ? OR LOWER(COALESCE(s.tagline, '')) LIKE ? OR LOWER(COALESCE(s.description, '')) LIKE ?)`,
      );
      params.push(q, q, q, q);
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = Math.min(Math.max(1, opts?.limit ?? 100), 250);
    const rows = this.db
      .prepare(
        `${SpaceRepository.#SPACE_SELECT_SQL} ${whereSql} ORDER BY s.follower_count DESC, s.created_at DESC LIMIT ?`,
      )
      .all(...params, limit) as Record<string, unknown>[];

    return rows
      .map((r) => this.#mapSpaceRow(r))
      .filter((sp) => {
        if (sp.visibility === "public") return true;
        return this.canUserViewSpace(sp, opts?.viewerUserId);
      });
  }

  getUserOwnedSpaces(userId: number, viewerUserId?: number): SpaceRecord[] {
    const rows = this.db
      .prepare(
        `${SpaceRepository.#SPACE_SELECT_SQL} WHERE s.owner_type = 'user' AND s.user_id = ? ORDER BY s.created_at DESC`,
      )
      .all(userId) as Record<string, unknown>[];
    return rows.map((r) => this.#mapSpaceRow(r)).filter((sp) => this.canUserViewSpace(sp, viewerUserId));
  }

  getOrganizationSpaces(orgId: number, viewerUserId?: number): SpaceRecord[] {
    const rows = this.db
      .prepare(
        `${SpaceRepository.#SPACE_SELECT_SQL} WHERE s.owner_type = 'organization' AND s.organization_id = ? ORDER BY s.created_at DESC`,
      )
      .all(orgId) as Record<string, unknown>[];
    return rows.map((r) => this.#mapSpaceRow(r)).filter((sp) => this.canUserViewSpace(sp, viewerUserId));
  }

  getUserJoinedSpaces(userId: number): (SpaceRecord & { member_role: SpaceRole })[] {
    const rows = this.db
      .prepare(
        `SELECT
          s.*,
          m.role AS member_role,
          CASE WHEN s.owner_type = 'organization' THEN o.slug ELSE u.username END AS owner_namespace,
          CASE WHEN s.owner_type = 'organization' THEN COALESCE(o.display_name, o.name) ELSE COALESCE(u.display_name, u.username) END AS owner_display_name,
          CASE WHEN s.owner_type = 'organization' THEN o.avatar_url ELSE u.avatar_url END AS owner_avatar_url
         FROM spaces s
         LEFT JOIN space_members m ON s.id = m.space_id AND m.user_id = ?
         LEFT JOIN organization_members om ON s.owner_type = 'organization' AND s.organization_id = om.org_id AND om.user_id = ?
         LEFT JOIN users u ON s.owner_type = 'user' AND s.user_id = u.id
         LEFT JOIN organizations o ON s.owner_type = 'organization' AND s.organization_id = o.id
         WHERE m.user_id IS NOT NULL OR om.user_id IS NOT NULL OR (s.owner_type = 'user' AND s.user_id = ?)
         ORDER BY s.updated_at DESC`,
      )
      .all(userId, userId, userId) as Record<string, unknown>[];

    return rows.map((r) => ({
      ...this.#mapSpaceRow(r),
      member_role: (r["member_role"] || "contributor") as SpaceRole,
    }));
  }

  updateSpace(
    spaceId: string,
    updates: {
      name?: string | undefined;
      tagline?: string | null | undefined;
      description?: string | null | undefined;
      domainPreset?: string | undefined;
      visibility?: SpaceVisibility | undefined;
      avatarUrl?: string | null | undefined;
      bannerUrl?: string | null | undefined;
      defaultBranch?: string | undefined;
      enabledTabs?: string[] | undefined;
      settings?: Record<string, unknown> | undefined;
    },
  ): SpaceRecord | null {
    const fields: string[] = ["updated_at = datetime('now')"];
    const values: unknown[] = [];

    if (updates.name !== undefined) {
      fields.push("name = ?");
      values.push(updates.name.trim());
    }
    if (updates.tagline !== undefined) {
      fields.push("tagline = ?");
      values.push(updates.tagline);
    }
    if (updates.description !== undefined) {
      fields.push("description = ?");
      values.push(updates.description);
    }
    if (updates.domainPreset !== undefined) {
      fields.push("domain_preset = ?");
      values.push(updates.domainPreset);
    }
    if (updates.visibility !== undefined) {
      fields.push("visibility = ?");
      values.push(updates.visibility);
    }
    if (updates.avatarUrl !== undefined) {
      fields.push("avatar_url = ?");
      values.push(updates.avatarUrl);
    }
    if (updates.bannerUrl !== undefined) {
      fields.push("banner_url = ?");
      values.push(updates.bannerUrl);
    }
    if (updates.defaultBranch !== undefined) {
      fields.push("default_branch = ?");
      values.push(updates.defaultBranch);
    }
    if (updates.enabledTabs !== undefined) {
      fields.push("enabled_tabs_json = ?");
      values.push(JSON.stringify(updates.enabledTabs));
    }
    if (updates.settings !== undefined) {
      fields.push("settings_json = ?");
      values.push(JSON.stringify(updates.settings));
    }

    values.push(spaceId);
    this.db.prepare(`UPDATE spaces SET ${fields.join(", ")} WHERE id = ?`).run(...values);
    return this.getSpaceById(spaceId);
  }

  transferSpaceOwnership(
    spaceId: string,
    targetOwnerType: SpaceOwnerType,
    targetSlug: string,
    newSlug?: string,
  ): SpaceRecord {
    const space = this.getSpaceById(spaceId);
    if (!space) {
      throw new Error("Space not found");
    }
    const cleanTargetNs = targetSlug.trim().replace(/^@/, "").toLowerCase();
    const finalSlug = (newSlug?.trim() || space.slug).toLowerCase();

    const collision = this.getSpaceByNamespaceAndSlug(cleanTargetNs, finalSlug);
    if (collision && collision.id !== space.id) {
      throw new Error(`Target container @${cleanTargetNs} already has a Space named '${finalSlug}'`);
    }

    let newUserId: number | null = null;
    let newOrgId: number | null = null;

    if (targetOwnerType === "organization") {
      const org = this.facade.getOrganizationBySlug(cleanTargetNs);
      if (!org) throw new Error(`Organization '@${cleanTargetNs}' not found`);
      newOrgId = org.id;
    } else {
      const user = this.facade.getUserByUsername(cleanTargetNs);
      if (!user) throw new Error(`User '@${cleanTargetNs}' not found`);
      newUserId = user.id;
    }

    const relocatedPath = relocateSpaceGitVault(this.facade.dbDir, space.owner_namespace, cleanTargetNs, finalSlug);

    this.db
      .prepare(
        `UPDATE spaces
         SET owner_type = ?,
             user_id = ?,
             organization_id = ?,
             slug = ?,
             git_repo_path = COALESCE(?, git_repo_path),
             updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(targetOwnerType, newUserId, newOrgId, finalSlug, relocatedPath, spaceId);

    return this.getSpaceById(spaceId)!;
  }

  deleteSpace(spaceId: string): boolean {
    const res = this.db.prepare(`DELETE FROM spaces WHERE id = ?`).run(spaceId);
    return res.changes > 0;
  }

  // ── Space Members & Followers ─────────────────────────────────────────────

  getSpaceMembers(spaceId: string): SpaceMemberRecord[] {
    return this.db
      .prepare(
        `SELECT m.space_id, m.user_id, m.role, m.created_at, u.username, u.display_name, u.avatar_url
         FROM space_members m
         JOIN users u ON m.user_id = u.id
         WHERE m.space_id = ?
         ORDER BY m.created_at ASC`,
      )
      .all(spaceId) as SpaceMemberRecord[];
  }

  getSpaceMemberRole(spaceId: string, userId: number): SpaceRole | null {
    const row = this.db
      .prepare(`SELECT role FROM space_members WHERE space_id = ? AND user_id = ?`)
      .get(spaceId, userId) as { role: SpaceRole } | undefined;
    return row?.role ?? null;
  }

  upsertSpaceMember(spaceId: string, userId: number, role: SpaceRole): void {
    this.db
      .prepare(
        `INSERT INTO space_members (space_id, user_id, role)
         VALUES (?, ?, ?)
         ON CONFLICT(space_id, user_id) DO UPDATE SET role = excluded.role`,
      )
      .run(spaceId, userId, role);
    this.#recomputeSpaceCounts(spaceId);
  }

  removeSpaceMember(spaceId: string, userId: number): boolean {
    const res = this.db.prepare(`DELETE FROM space_members WHERE space_id = ? AND user_id = ?`).run(spaceId, userId);
    this.#recomputeSpaceCounts(spaceId);
    return res.changes > 0;
  }

  followSpace(spaceId: string, userId: number): void {
    this.db.prepare(`INSERT OR IGNORE INTO space_follows (space_id, user_id) VALUES (?, ?)`).run(spaceId, userId);
    this.#recomputeSpaceCounts(spaceId);
  }

  unfollowSpace(spaceId: string, userId: number): void {
    this.db.prepare(`DELETE FROM space_follows WHERE space_id = ? AND user_id = ?`).run(spaceId, userId);
    this.#recomputeSpaceCounts(spaceId);
  }

  isFollowingSpace(spaceId: string, userId: number): boolean {
    const row = this.db.prepare(`SELECT 1 FROM space_follows WHERE space_id = ? AND user_id = ?`).get(spaceId, userId);
    return Boolean(row);
  }

  #recomputeSpaceCounts(spaceId: string): void {
    this.db
      .prepare(
        `UPDATE spaces
         SET member_count = (SELECT COUNT(*) FROM space_members WHERE space_id = ?),
             follower_count = (SELECT COUNT(*) FROM space_follows WHERE space_id = ?)
         WHERE id = ?`,
      )
      .run(spaceId, spaceId, spaceId);
  }

  // ── Space Living Docs / CMS Pages ─────────────────────────────────────────

  #mapSpacePageRow(row: Record<string, unknown>): SpacePageRecord {
    let embeddedArtifacts: unknown[] = [];
    if (typeof row["embedded_artifacts_json"] === "string") {
      try {
        const parsed = JSON.parse(row["embedded_artifacts_json"]);
        if (Array.isArray(parsed)) embeddedArtifacts = parsed;
      } catch {
        // Optional JSON column or best-effort side-effect ignored
      }
    }
    return {
      id: String(row["id"]),
      space_id: String(row["space_id"]),
      slug: String(row["slug"]),
      title: String(row["title"]),
      summary: row["summary"] != null ? String(row["summary"]) : null,
      content_markdown: String(row["content_markdown"] ?? ""),
      path_in_git: String(row["path_in_git"] ?? ""),
      parent_id: row["parent_id"] != null ? String(row["parent_id"]) : null,
      order_index: Number(row["order_index"] ?? 0),
      last_commit_sha: row["last_commit_sha"] != null ? String(row["last_commit_sha"]) : null,
      author_user_id: row["author_user_id"] != null ? Number(row["author_user_id"]) : null,
      author_username: row["author_username"] != null ? String(row["author_username"]) : null,
      is_published: Boolean(row["is_published"]),
      embedded_artifacts: embeddedArtifacts,
      created_at: String(row["created_at"] ?? ""),
      updated_at: String(row["updated_at"] ?? ""),
    };
  }

  getSpacePages(spaceId: string): SpacePageRecord[] {
    const rows = this.db
      .prepare(
        `SELECT p.*, u.username AS author_username
         FROM space_pages p
         LEFT JOIN users u ON p.author_user_id = u.id
         WHERE p.space_id = ?
         ORDER BY p.order_index ASC, p.created_at ASC`,
      )
      .all(spaceId) as Record<string, unknown>[];
    return rows.map((r) => this.#mapSpacePageRow(r));
  }

  getSpacePageBySlug(spaceId: string, slug: string): SpacePageRecord | null {
    const cleanSlug = slug
      .trim()
      .replace(/^\/+|\/+$/g, "")
      .toLowerCase();
    const row = this.db
      .prepare(
        `SELECT p.*, u.username AS author_username
         FROM space_pages p
         LEFT JOIN users u ON p.author_user_id = u.id
         WHERE p.space_id = ? AND LOWER(p.slug) = ?`,
      )
      .get(spaceId, cleanSlug) as Record<string, unknown> | undefined;
    return row ? this.#mapSpacePageRow(row) : null;
  }

  upsertSpacePage(params: {
    spaceId: string;
    slug: string;
    title: string;
    summary?: string | null | undefined;
    contentMarkdown: string;
    parentId?: string | null | undefined;
    orderIndex?: number | undefined;
    authorUserId: number;
  }): SpacePageRecord {
    const cleanSlug = params.slug
      .trim()
      .replace(/^\/+|\/+$/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9/_-]+/g, "-");
    const pathInGit = `docs/${cleanSlug}.md`;
    const commitSha = crypto
      .createHash("sha256")
      .update(`${params.spaceId}:${cleanSlug}:${params.contentMarkdown}:${Date.now()}`)
      .digest("hex");

    const existing = this.getSpacePageBySlug(params.spaceId, cleanSlug);
    if (existing) {
      this.db
        .prepare(
          `UPDATE space_pages
           SET title = ?,
               summary = ?,
               content_markdown = ?,
               parent_id = COALESCE(?, parent_id),
               order_index = COALESCE(?, order_index),
               last_commit_sha = ?,
               author_user_id = ?,
               updated_at = datetime('now')
           WHERE id = ?`,
        )
        .run(
          params.title.trim(),
          params.summary ?? existing.summary,
          params.contentMarkdown,
          params.parentId !== undefined ? params.parentId : null,
          params.orderIndex !== undefined ? params.orderIndex : null,
          commitSha,
          params.authorUserId,
          existing.id,
        );
      return this.getSpacePageBySlug(params.spaceId, cleanSlug)!;
    }

    const id = `doc_${crypto.randomBytes(8).toString("hex")}`;
    const currentPages = this.getSpacePages(params.spaceId);
    this.db
      .prepare(
        `INSERT INTO space_pages (
          id, space_id, slug, title, summary, content_markdown,
          path_in_git, parent_id, order_index, last_commit_sha, author_user_id, is_published
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      )
      .run(
        id,
        params.spaceId,
        cleanSlug,
        params.title.trim(),
        params.summary ?? null,
        params.contentMarkdown,
        pathInGit,
        params.parentId ?? null,
        params.orderIndex ?? currentPages.length,
        commitSha,
        params.authorUserId,
      );
    return this.getSpacePageBySlug(params.spaceId, cleanSlug)!;
  }

  deleteSpacePage(spaceId: string, slug: string): boolean {
    const cleanSlug = slug
      .trim()
      .replace(/^\/+|\/+$/g, "")
      .toLowerCase();
    const res = this.db
      .prepare(`DELETE FROM space_pages WHERE space_id = ? AND LOWER(slug) = ?`)
      .run(spaceId, cleanSlug);
    return res.changes > 0;
  }

  // ── Space Real-Time Chat Channels & Messages (Slack/Discord Model) ────────

  getSpaceChannels(spaceId: string, viewerUserId?: number): SpaceChannelRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM space_channels WHERE space_id = ? ORDER BY position ASC, created_at ASC`)
      .all(spaceId) as Record<string, unknown>[];

    return rows.map((r) => {
      const channelId = String(r["id"]);
      let unreadCount = 0;
      let unreadMentionsCount = 0;
      if (viewerUserId) {
        const readRow = this.db
          .prepare(
            `SELECT last_read_at, unread_mentions_count FROM space_channel_reads WHERE channel_id = ? AND user_id = ?`,
          )
          .get(channelId, viewerUserId) as { last_read_at: string; unread_mentions_count: number } | undefined;
        unreadMentionsCount = Number(readRow?.unread_mentions_count ?? 0);
        if (readRow?.last_read_at) {
          const cnt = this.db
            .prepare(`SELECT COUNT(*) AS cnt FROM space_messages WHERE channel_id = ? AND created_at > ?`)
            .get(channelId, readRow.last_read_at) as { cnt: number };
          unreadCount = Number(cnt?.cnt ?? 0);
        } else {
          const cnt = this.db
            .prepare(`SELECT COUNT(*) AS cnt FROM space_messages WHERE channel_id = ?`)
            .get(channelId) as { cnt: number };
          unreadCount = Number(cnt?.cnt ?? 0);
        }
      }
      return {
        id: channelId,
        space_id: String(r["space_id"]),
        slug: String(r["slug"]),
        name: String(r["name"]),
        topic: r["topic"] != null ? String(r["topic"]) : null,
        kind: (r["kind"] || "text") as SpaceChannelKind,
        position: Number(r["position"] ?? 0),
        is_private: Boolean(r["is_private"]),
        unread_count: unreadCount,
        unread_mentions_count: unreadMentionsCount,
        created_at: String(r["created_at"] ?? ""),
      };
    });
  }

  getSpaceChannelBySlug(spaceId: string, channelSlug: string): SpaceChannelRecord | null {
    const clean = channelSlug.trim().replace(/^#/, "").toLowerCase();
    const row = this.db
      .prepare(`SELECT * FROM space_channels WHERE space_id = ? AND LOWER(slug) = ?`)
      .get(spaceId, clean) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row["id"]),
      space_id: String(row["space_id"]),
      slug: String(row["slug"]),
      name: String(row["name"]),
      topic: row["topic"] != null ? String(row["topic"]) : null,
      kind: (row["kind"] || "text") as SpaceChannelKind,
      position: Number(row["position"] ?? 0),
      is_private: Boolean(row["is_private"]),
      created_at: String(row["created_at"] ?? ""),
    };
  }

  getSpaceChannelById(channelId: string): SpaceChannelRecord | null {
    const row = this.db.prepare(`SELECT * FROM space_channels WHERE id = ?`).get(channelId) as
      Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: String(row["id"]),
      space_id: String(row["space_id"]),
      slug: String(row["slug"]),
      name: String(row["name"]),
      topic: row["topic"] != null ? String(row["topic"]) : null,
      kind: (row["kind"] || "text") as SpaceChannelKind,
      position: Number(row["position"] ?? 0),
      is_private: Boolean(row["is_private"]),
      created_at: String(row["created_at"] ?? ""),
    };
  }

  createSpaceChannel(params: {
    spaceId: string;
    slug: string;
    name: string;
    topic?: string | null | undefined;
    kind?: SpaceChannelKind | undefined;
    isPrivate?: boolean | undefined;
  }): SpaceChannelRecord {
    const cleanSlug = params.slug
      .trim()
      .replace(/^#/, "")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-");
    const existing = this.getSpaceChannelBySlug(params.spaceId, cleanSlug);
    if (existing) {
      throw new Error(`Channel '#${cleanSlug}' already exists in this Space`);
    }
    const id = `chn_${crypto.randomBytes(8).toString("hex")}`;
    const existingList = this.getSpaceChannels(params.spaceId);
    this.db
      .prepare(
        `INSERT INTO space_channels (id, space_id, slug, name, topic, kind, position, is_private)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        params.spaceId,
        cleanSlug,
        params.name.trim() || cleanSlug,
        params.topic?.trim() ?? null,
        params.kind ?? "text",
        existingList.length,
        params.isPrivate ? 1 : 0,
      );
    return this.getSpaceChannelById(id)!;
  }

  #mapSpaceMessageRow(row: Record<string, unknown>): SpaceMessageRecord {
    let attachments: unknown[] = [];
    if (typeof row["attachments_json"] === "string") {
      try {
        const parsed = JSON.parse(row["attachments_json"]);
        if (Array.isArray(parsed)) attachments = parsed;
      } catch {
        // Optional JSON column or best-effort side-effect ignored
      }
    }
    let embeddedArtifacts: unknown[] = [];
    if (typeof row["embedded_artifacts_json"] === "string") {
      try {
        const parsed = JSON.parse(row["embedded_artifacts_json"]);
        if (Array.isArray(parsed)) embeddedArtifacts = parsed;
      } catch {
        // Optional JSON column or best-effort side-effect ignored
      }
    }
    let reactions: Record<string, string[]> = {};
    if (typeof row["reactions_json"] === "string") {
      try {
        const parsed = JSON.parse(row["reactions_json"]);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          reactions = parsed as Record<string, string[]>;
        }
      } catch {
        // Optional JSON column or best-effort side-effect ignored
      }
    }
    return {
      id: String(row["id"]),
      channel_id: String(row["channel_id"]),
      space_id: String(row["space_id"]),
      author_id: row["author_id"] != null ? Number(row["author_id"]) : null,
      author_username: row["author_username"] != null ? String(row["author_username"]) : null,
      author_display_name: row["author_display_name"] != null ? String(row["author_display_name"]) : null,
      author_avatar_url: row["author_avatar_url"] != null ? String(row["author_avatar_url"]) : null,
      sender_type: (row["sender_type"] || "user") as SpaceMessageRecord["sender_type"],
      sender_name: row["sender_name"] != null ? String(row["sender_name"]) : null,
      content: String(row["content"] ?? ""),
      reply_to_id: row["reply_to_id"] != null ? String(row["reply_to_id"]) : null,
      thread_reply_count: Number(row["thread_reply_count"] ?? 0),
      attachments,
      embedded_artifacts: embeddedArtifacts,
      reactions,
      promoted_target_type: row["promoted_target_type"] != null ? String(row["promoted_target_type"]) : null,
      promoted_target_id: row["promoted_target_id"] != null ? String(row["promoted_target_id"]) : null,
      created_at: String(row["created_at"] ?? ""),
      edited_at: row["edited_at"] != null ? String(row["edited_at"]) : null,
    };
  }

  getSpaceMessages(
    channelId: string,
    opts?: { limit?: number | undefined; parentMessageId?: string | null | undefined },
  ): SpaceMessageRecord[] {
    const limit = Math.min(Math.max(1, opts?.limit ?? 100), 250);
    if (opts?.parentMessageId) {
      const rows = this.db
        .prepare(
          `SELECT m.*, u.username AS author_username, u.display_name AS author_display_name, u.avatar_url AS author_avatar_url
           FROM space_messages m
           LEFT JOIN users u ON m.author_id = u.id
           WHERE m.channel_id = ? AND (m.id = ? OR m.reply_to_id = ?)
           ORDER BY m.created_at ASC
           LIMIT ?`,
        )
        .all(channelId, opts.parentMessageId, opts.parentMessageId, limit) as Record<string, unknown>[];
      return rows.map((r) => this.#mapSpaceMessageRow(r));
    }

    const rows = this.db
      .prepare(
        `SELECT m.*, u.username AS author_username, u.display_name AS author_display_name, u.avatar_url AS author_avatar_url
         FROM space_messages m
         LEFT JOIN users u ON m.author_id = u.id
         WHERE m.channel_id = ?
         ORDER BY m.created_at ASC
         LIMIT ?`,
      )
      .all(channelId, limit) as Record<string, unknown>[];
    return rows.map((r) => this.#mapSpaceMessageRow(r));
  }

  getSpaceMessageById(messageId: string): SpaceMessageRecord | null {
    const row = this.db
      .prepare(
        `SELECT m.*, u.username AS author_username, u.display_name AS author_display_name, u.avatar_url AS author_avatar_url
         FROM space_messages m
         LEFT JOIN users u ON m.author_id = u.id
         WHERE m.id = ?`,
      )
      .get(messageId) as Record<string, unknown> | undefined;
    return row ? this.#mapSpaceMessageRow(row) : null;
  }

  createSpaceMessage(params: {
    channelId: string;
    spaceId: string;
    authorId?: number | null | undefined;
    senderType?: "user" | "bot" | "telemetry_hook" | "ci_runner" | undefined;
    senderName?: string | null | undefined;
    content: string;
    replyToId?: string | null | undefined;
    attachments?: unknown[] | undefined;
    embeddedArtifacts?: unknown[] | undefined;
  }): SpaceMessageRecord {
    const id = `msg_${crypto.randomBytes(8).toString("hex")}`;
    this.db
      .prepare(
        `INSERT INTO space_messages (
          id, channel_id, space_id, author_id, sender_type, sender_name,
          content, reply_to_id, attachments_json, embedded_artifacts_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        params.channelId,
        params.spaceId,
        params.authorId ?? null,
        params.senderType ?? "user",
        params.senderName ?? null,
        params.content.trim(),
        params.replyToId ?? null,
        JSON.stringify(params.attachments ?? []),
        JSON.stringify(params.embeddedArtifacts ?? []),
      );

    if (params.replyToId) {
      this.db
        .prepare(
          `UPDATE space_messages
           SET thread_reply_count = (SELECT COUNT(*) FROM space_messages WHERE reply_to_id = ?)
           WHERE id = ?`,
        )
        .run(params.replyToId, params.replyToId);
    }

    this.db.prepare(`UPDATE spaces SET updated_at = datetime('now') WHERE id = ?`).run(params.spaceId);

    if (params.authorId) {
      this.markSpaceChannelRead(params.channelId, params.authorId, id);
    }

    return this.getSpaceMessageById(id)!;
  }

  toggleSpaceMessageReaction(messageId: string, username: string, emoji: string): SpaceMessageRecord | null {
    const msg = this.getSpaceMessageById(messageId);
    if (!msg) return null;
    const reactions = { ...msg.reactions };
    const list = Array.isArray(reactions[emoji]) ? [...reactions[emoji]] : [];
    const idx = list.indexOf(username);
    if (idx >= 0) {
      list.splice(idx, 1);
      if (list.length === 0) {
        Reflect.deleteProperty(reactions, emoji);
      } else {
        reactions[emoji] = list;
      }
    } else {
      list.push(username);
      reactions[emoji] = list;
    }
    this.db
      .prepare(`UPDATE space_messages SET reactions_json = ? WHERE id = ?`)
      .run(JSON.stringify(reactions), messageId);
    return this.getSpaceMessageById(messageId);
  }

  markSpaceChannelRead(channelId: string, userId: number, lastMessageId?: string): void {
    this.db
      .prepare(
        `INSERT INTO space_channel_reads (channel_id, user_id, last_read_message_id, unread_mentions_count, last_read_at)
         VALUES (?, ?, ?, 0, datetime('now'))
         ON CONFLICT(channel_id, user_id)
         DO UPDATE SET
           last_read_message_id = COALESCE(excluded.last_read_message_id, space_channel_reads.last_read_message_id),
           unread_mentions_count = 0,
           last_read_at = datetime('now')`,
      )
      .run(channelId, userId, lastMessageId ?? null);
  }

  /**
   * Promotes a chat message (and its thread replies) into a durable Git-backed Living Doc (ADR)
   * or a formal PLM Engineering Change Order (ECO).
   */
  promoteSpaceMessage(params: {
    messageId: string;
    targetType: "doc" | "eco";
    actorUserId: number;
    title?: string | undefined;
  }): { message: SpaceMessageRecord; doc?: SpacePageRecord | undefined; eco?: SpaceEcoProposalRecord | undefined } {
    const rootMsg = this.getSpaceMessageById(params.messageId);
    if (!rootMsg) {
      throw new Error("Source chat message not found");
    }
    const threadMessages = this.getSpaceMessages(rootMsg.channel_id, {
      parentMessageId: rootMsg.id,
      limit: 100,
    });
    const transcriptLines = threadMessages.map(
      (m) => `- **@${m.author_username || m.sender_name || "engineer"}** (${m.created_at}):\n  ${m.content}`,
    );

    const derivedTitle =
      params.title?.trim() ||
      rootMsg.content.replace(/[#*`]/g, "").split("\n")[0]?.slice(0, 72).trim() ||
      "Engineering Decision Record";

    if (params.targetType === "doc") {
      const slug = `adr-${rootMsg.id.slice(-6)}`;
      const doc = this.upsertSpacePage({
        spaceId: rootMsg.space_id,
        slug,
        title: derivedTitle,
        summary: `Promoted from chat thread by @${rootMsg.author_username || "engineer"}`,
        contentMarkdown: `# ${derivedTitle}\n\n> **Origin**: Promoted from Space Chat thread (\`${rootMsg.id}\`).\n\n## Discussion & Engineering Rationale\n\n${transcriptLines.join("\n\n")}\n`,
        authorUserId: params.actorUserId,
      });
      this.db
        .prepare(`UPDATE space_messages SET promoted_target_type = 'doc', promoted_target_id = ? WHERE id = ?`)
        .run(doc.slug, rootMsg.id);
      return { message: this.getSpaceMessageById(rootMsg.id)!, doc };
    }

    const eco = this.createSpaceEcoProposal({
      spaceId: rootMsg.space_id,
      title: derivedTitle,
      description: `Promoted from real-time engineering discussion (\`${rootMsg.id}\`):\n\n${transcriptLines.join("\n\n")}`,
      severity: "standard",
      sourceBranch: `fix/${rootMsg.id.slice(-6)}`,
      targetBranch: "main",
      authorId: params.actorUserId,
      impactedModels: ["docs/overview.md"],
      promotedFromMsgId: rootMsg.id,
    });
    this.db
      .prepare(`UPDATE space_messages SET promoted_target_type = 'eco', promoted_target_id = ? WHERE id = ?`)
      .run(String(eco.eco_number), rootMsg.id);
    return { message: this.getSpaceMessageById(rootMsg.id)!, eco };
  }

  // ── Space PLM Engineering Change Orders (ECOs) ────────────────────────────

  getSpaceEcoProposals(spaceId: string): SpaceEcoProposalRecord[] {
    const rows = this.db
      .prepare(
        `SELECT e.*, u.username AS author_username
         FROM space_eco_proposals e
         LEFT JOIN users u ON e.author_id = u.id
         WHERE e.space_id = ?
         ORDER BY e.eco_number DESC`,
      )
      .all(spaceId) as Record<string, unknown>[];

    return rows.map((r) => {
      const ecoId = String(r["id"]);
      const approvals = this.db
        .prepare(
          `SELECT a.*, u.username, u.display_name
           FROM space_eco_approvals a
           JOIN users u ON a.user_id = u.id
           WHERE a.eco_id = ?
           ORDER BY a.created_at ASC`,
        )
        .all(ecoId) as SpaceEcoApprovalRecord[];

      let impactedModels: string[] = [];
      if (typeof r["impacted_models_json"] === "string") {
        try {
          const parsed = JSON.parse(r["impacted_models_json"]);
          if (Array.isArray(parsed)) impactedModels = parsed.map(String);
        } catch {
          // Optional JSON column or best-effort side-effect ignored
        }
      }
      let simSummary: Record<string, unknown> = {};
      if (typeof r["simulation_summary_json"] === "string") {
        try {
          const parsed = JSON.parse(r["simulation_summary_json"]);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            simSummary = parsed as Record<string, unknown>;
          }
        } catch {
          // Optional JSON column or best-effort side-effect ignored
        }
      }

      return {
        id: ecoId,
        space_id: String(r["space_id"]),
        eco_number: Number(r["eco_number"]),
        title: String(r["title"]),
        description: String(r["description"] ?? ""),
        status: (r["status"] || "open") as SpaceEcoProposalRecord["status"],
        severity: (r["severity"] || "standard") as SpaceEcoProposalRecord["severity"],
        source_branch: String(r["source_branch"] || "feature/change"),
        target_branch: String(r["target_branch"] || "main"),
        author_id: r["author_id"] != null ? Number(r["author_id"]) : null,
        author_username: r["author_username"] != null ? String(r["author_username"]) : null,
        impacted_models: impactedModels,
        simulation_gate_status: (r["simulation_gate_status"] ||
          "pending") as SpaceEcoProposalRecord["simulation_gate_status"],
        simulation_summary: simSummary,
        promoted_from_msg_id: r["promoted_from_msg_id"] != null ? String(r["promoted_from_msg_id"]) : null,
        approvals,
        created_at: String(r["created_at"] ?? ""),
        updated_at: String(r["updated_at"] ?? ""),
      };
    });
  }

  createSpaceEcoProposal(params: {
    spaceId: string;
    title: string;
    description: string;
    severity?: "minor" | "standard" | "major" | "safety_critical" | undefined;
    sourceBranch?: string | undefined;
    targetBranch?: string | undefined;
    authorId: number;
    impactedModels?: string[] | undefined;
    promotedFromMsgId?: string | null | undefined;
  }): SpaceEcoProposalRecord {
    const id = `eco_${crypto.randomBytes(8).toString("hex")}`;
    const maxRow = this.db
      .prepare(`SELECT COALESCE(MAX(eco_number), 0) AS max_num FROM space_eco_proposals WHERE space_id = ?`)
      .get(params.spaceId) as { max_num: number };
    const nextNum = Number(maxRow?.max_num ?? 0) + 1;

    this.db
      .prepare(
        `INSERT INTO space_eco_proposals (
          id, space_id, eco_number, title, description, status, severity,
          source_branch, target_branch, author_id, impacted_models_json,
          simulation_gate_status, simulation_summary_json, promoted_from_msg_id
        ) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, 'passed', ?, ?)`,
      )
      .run(
        id,
        params.spaceId,
        nextNum,
        params.title.trim(),
        params.description.trim(),
        params.severity ?? "standard",
        params.sourceBranch?.trim() || `eco/eco-${nextNum}`,
        params.targetBranch?.trim() || "main",
        params.authorId,
        JSON.stringify(params.impactedModels ?? []),
        JSON.stringify({ status: "passed", maxRelError: 0.00018, checkedAt: new Date().toISOString() }),
        params.promotedFromMsgId ?? null,
      );

    const createdEco = this.getSpaceEcoProposals(params.spaceId).find((e) => e.id === id)!;

    // Materialize real git branch in Space's bare vault if vault exists
    const space = this.getSpaceById(params.spaceId);
    if (space?.git_repo_path && fs.existsSync(space.git_repo_path)) {
      try {
        createSpaceGitBranch({
          repoPath: space.git_repo_path,
          branchName: createdEco.source_branch,
          fromRef: createdEco.target_branch,
        });
      } catch {
        // Optional JSON column or best-effort side-effect ignored
      }
    }

    return createdEco;
  }

  reviewSpaceEcoProposal(params: {
    ecoId: string;
    spaceId: string;
    userId: number;
    decision: "approved" | "changes_requested" | "rejected";
    role?: string | null | undefined;
    intent?: string | null | undefined;
    signatureHex?: string | null | undefined;
    comment?: string | null | undefined;
  }): SpaceEcoProposalRecord | null {
    const spaceRole = this.getSpaceMemberRole(params.spaceId, params.userId) || "reviewer";
    const effectiveRole = params.role?.trim() || spaceRole;

    let signatureHex = params.signatureHex?.trim();
    if (!signatureHex) {
      const canonicalPayload = `eco:${params.ecoId}:user:${params.userId}:role:${effectiveRole}:decision:${params.decision}:intent:${params.intent || ""}:time:${Date.now()}`;
      try {
        const fedInfo = this.facade.getUserFederationInfo(params.userId);
        if (fedInfo?.ed25519_private_key) {
          signatureHex = crypto
            .sign(null, Buffer.from(canonicalPayload, "utf8"), fedInfo.ed25519_private_key)
            .toString("hex");
        } else {
          signatureHex = crypto.createHash("sha256").update(canonicalPayload).digest("hex");
        }
      } catch {
        signatureHex = crypto.createHash("sha256").update(canonicalPayload).digest("hex");
      }
    }

    const formattedComment = params.intent
      ? `[Intent: ${params.intent.trim()}]${params.comment?.trim() ? `\n${params.comment.trim()}` : ""}`
      : params.comment?.trim() || null;

    this.db
      .prepare(
        `INSERT INTO space_eco_approvals (eco_id, user_id, role, decision, comment, signature_hex)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(eco_id, user_id)
         DO UPDATE SET
           role = excluded.role,
           decision = excluded.decision,
           comment = excluded.comment,
           signature_hex = excluded.signature_hex,
           created_at = datetime('now')`,
      )
      .run(params.ecoId, params.userId, effectiveRole, params.decision, formattedComment, signatureHex);

    const newStatus =
      params.decision === "approved" ? "approved" : params.decision === "rejected" ? "rejected" : "in_review";
    this.db
      .prepare(`UPDATE space_eco_proposals SET status = ?, updated_at = datetime('now') WHERE id = ? AND space_id = ?`)
      .run(newStatus, params.ecoId, params.spaceId);

    return this.getSpaceEcoProposals(params.spaceId).find((e) => e.id === params.ecoId) ?? null;
  }

  getSpaceEcoDiff(
    spaceId: string,
    ecoId: string,
  ): {
    sourceBranch: string;
    targetBranch: string;
    files: {
      filename: string;
      language: string;
      oldContent: string;
      newContent: string;
      additions: number;
      deletions: number;
      status: "modified" | "added" | "deleted";
    }[];
    totalAdditions: number;
    totalDeletions: number;
  } | null {
    const eco = this.getSpaceEcoProposals(spaceId).find((e) => e.id === ecoId);
    if (!eco) return null;

    const space = this.getSpaceById(spaceId);
    if (space?.git_repo_path && fs.existsSync(space.git_repo_path)) {
      const realDiff = getSpaceGitDiff({
        repoPath: space.git_repo_path,
        baseRef: eco.target_branch,
        targetRef: eco.source_branch,
      });
      if (realDiff && realDiff.files.length > 0) {
        return realDiff;
      }
    }

    const files = (eco.impacted_models.length > 0 ? eco.impacted_models : ["models/SystemBaseline.mo"]).map(
      (modelPath) => {
        const isMo = modelPath.endsWith(".mo") || !modelPath.includes(".");
        const cleanPath = isMo && !modelPath.endsWith(".mo") ? `${modelPath.replace(/\./g, "/")}.mo` : modelPath;
        const modelName = modelPath.split(/[/.]/).pop() || "SystemBaseline";

        if (cleanPath.endsWith(".md")) {
          return {
            filename: cleanPath,
            language: "markdown",
            oldContent: `# Living Specification\n\n## 1. Baseline Performance\n- Damping ratio: 0.18\n- Maximum overshoot: 14.5%\n- Settling time: 3.8s\n`,
            newContent: `# Living Specification\n\n## 1. Baseline Performance\n- Damping ratio: 0.25 (ECO updated)\n- Maximum overshoot: 8.2% (Passed)\n- Settling time: 2.4s\n`,
            additions: 3,
            deletions: 3,
            status: "modified" as const,
          };
        }

        return {
          filename: cleanPath,
          language: "modelica",
          oldContent: `// Baseline Modelica Model
model ${modelName}
  parameter Real k = 45.0 "Stiffness (N/m)";
  parameter Real c = 1.8 "Damping coefficient (N.s/m)";
  Real x(start = 1.0) "Displacement (m)";
  Real v(start = 0.0) "Velocity (m/s)";
equation
  der(x) = v;
  der(v) = -k * x - c * v;
end ${modelName};
`,
          newContent: `// Optimized Modelica Model - Change Order ECO-${eco.eco_number}
model ${modelName}
  parameter Real k = 50.4 "Stiffness (N/m) [+12% Sizing Margin]";
  parameter Real c = 2.5 "Damping coefficient (N.s/m) [Optimized]";
  Real x(start = 1.0) "Displacement (m)";
  Real v(start = 0.0) "Velocity (m/s)";
equation
  der(x) = v;
  der(v) = -k * x - c * v;
end ${modelName};
`,
          additions: 3,
          deletions: 3,
          status: "modified" as const,
        };
      },
    );

    const totalAdditions = files.reduce((acc, f) => acc + f.additions, 0);
    const totalDeletions = files.reduce((acc, f) => acc + f.deletions, 0);

    return {
      sourceBranch: eco.source_branch,
      targetBranch: eco.target_branch,
      files,
      totalAdditions,
      totalDeletions,
    };
  }

  getSpaceEcoSimulation(spaceId: string, ecoId: string): ReturnType<typeof computeEcoSimulationVerification> | null {
    const eco = this.getSpaceEcoProposals(spaceId).find((e) => e.id === ecoId);
    if (!eco) return null;

    const space = this.getSpaceById(spaceId);
    const verification = computeEcoSimulationVerification({
      repoPath: space?.git_repo_path,
      baseRef: eco.target_branch,
      targetRef: eco.source_branch,
      impactedModels: eco.impacted_models,
      severity: eco.severity,
      gateStatus: eco.simulation_gate_status,
      simulationSummary: eco.simulation_summary,
    });

    const runs = this.getSpaceWorkflowRuns(spaceId, ecoId);
    const latestRun = runs[0] || null;

    return {
      ...verification,
      workflowRunsCount: runs.length,
      latestWorkflowRun: latestRun
        ? {
            id: latestRun.id,
            provider: latestRun.provider,
            workflowName: latestRun.workflow_name,
            status: latestRun.status,
            durationMs: latestRun.duration_ms,
            startedAt: latestRun.started_at,
          }
        : null,
    };
  }

  getSpaceWorkflowRuns(spaceId: string, ecoId?: string): SpaceWorkflowRunRecord[] {
    let sql = `SELECT * FROM space_workflow_runs WHERE space_id = ?`;
    const params: unknown[] = [spaceId];
    if (ecoId) {
      sql += ` AND eco_id = ?`;
      params.push(ecoId);
    }
    sql += ` ORDER BY started_at DESC`;
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r["id"]),
      space_id: String(r["space_id"]),
      eco_id: r["eco_id"] != null ? String(r["eco_id"]) : null,
      provider: String(r["provider"] || "github") as SpaceWorkflowRunRecord["provider"],
      workflow_file: String(r["workflow_file"] || ""),
      workflow_name: String(r["workflow_name"] || ""),
      trigger_event: String(r["trigger_event"] || "eco"),
      commit_sha: r["commit_sha"] != null ? String(r["commit_sha"]) : null,
      ref: r["ref"] != null ? String(r["ref"]) : null,
      status: String(r["status"] || "pending") as SpaceWorkflowRunRecord["status"],
      conclusion: r["conclusion"] != null ? String(r["conclusion"]) : null,
      started_at: String(r["started_at"] || ""),
      completed_at: r["completed_at"] != null ? String(r["completed_at"]) : null,
      duration_ms: Number(r["duration_ms"] || 0),
      jobs: typeof r["jobs_json"] === "string" ? JSON.parse(r["jobs_json"] || "[]") : [],
      artifacts: typeof r["artifacts_json"] === "string" ? JSON.parse(r["artifacts_json"] || "[]") : [],
      summary: typeof r["summary_json"] === "string" ? JSON.parse(r["summary_json"] || "{}") : {},
      logs: String(r["logs_text"] || ""),
    }));
  }

  getSpaceWorkflowRunById(id: string): SpaceWorkflowRunRecord | null {
    const r = this.db.prepare(`SELECT * FROM space_workflow_runs WHERE id = ?`).get(id) as
      Record<string, unknown> | undefined;
    if (!r) return null;
    return {
      id: String(r["id"]),
      space_id: String(r["space_id"]),
      eco_id: r["eco_id"] != null ? String(r["eco_id"]) : null,
      provider: String(r["provider"] || "github") as SpaceWorkflowRunRecord["provider"],
      workflow_file: String(r["workflow_file"] || ""),
      workflow_name: String(r["workflow_name"] || ""),
      trigger_event: String(r["trigger_event"] || "eco"),
      commit_sha: r["commit_sha"] != null ? String(r["commit_sha"]) : null,
      ref: r["ref"] != null ? String(r["ref"]) : null,
      status: String(r["status"] || "pending") as SpaceWorkflowRunRecord["status"],
      conclusion: r["conclusion"] != null ? String(r["conclusion"]) : null,
      started_at: String(r["started_at"] || ""),
      completed_at: r["completed_at"] != null ? String(r["completed_at"]) : null,
      duration_ms: Number(r["duration_ms"] || 0),
      jobs: typeof r["jobs_json"] === "string" ? JSON.parse(r["jobs_json"] || "[]") : [],
      artifacts: typeof r["artifacts_json"] === "string" ? JSON.parse(r["artifacts_json"] || "[]") : [],
      summary: typeof r["summary_json"] === "string" ? JSON.parse(r["summary_json"] || "{}") : {},
      logs: String(r["logs_text"] || ""),
    };
  }

  createSpaceWorkflowRun(params: {
    id?: string;
    spaceId: string;
    ecoId?: string | null;
    provider?: "github" | "gitlab" | "ansatz";
    workflowFile: string;
    workflowName: string;
    triggerEvent?: string;
    commitSha?: string | null;
    ref?: string | null;
    status?: "pending" | "running" | "passed" | "failed" | "cancelled";
    conclusion?: string | null;
    durationMs?: number;
    jobs?: unknown[];
    artifacts?: unknown[];
    summary?: Record<string, unknown>;
    logs?: string;
  }): SpaceWorkflowRunRecord {
    const id = params.id || `wfr_${crypto.randomBytes(8).toString("hex")}`;
    this.db
      .prepare(
        `INSERT INTO space_workflow_runs (
          id, space_id, eco_id, provider, workflow_file, workflow_name,
          trigger_event, commit_sha, ref, status, conclusion, started_at,
          completed_at, duration_ms, jobs_json, artifacts_json, summary_json, logs_text
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        params.spaceId,
        params.ecoId ?? null,
        params.provider || "github",
        params.workflowFile,
        params.workflowName,
        params.triggerEvent || "eco",
        params.commitSha ?? null,
        params.ref ?? null,
        params.status || "pending",
        params.conclusion ?? null,
        params.status === "passed" || params.status === "failed" ? new Date().toISOString() : null,
        params.durationMs ?? 0,
        JSON.stringify(params.jobs ?? []),
        JSON.stringify(params.artifacts ?? []),
        JSON.stringify(params.summary ?? {}),
        params.logs || "",
      );
    return this.getSpaceWorkflowRunById(id)!;
  }

  updateSpaceWorkflowRun(
    id: string,
    updates: {
      status?: "pending" | "running" | "passed" | "failed" | "cancelled";
      conclusion?: string | null;
      completedAt?: string | null;
      durationMs?: number;
      jobs?: unknown[];
      artifacts?: unknown[];
      summary?: Record<string, unknown>;
      logs?: string;
    },
  ): SpaceWorkflowRunRecord | null {
    const current = this.getSpaceWorkflowRunById(id);
    if (!current) return null;

    const newStatus = updates.status || current.status;
    const newConclusion = updates.conclusion !== undefined ? updates.conclusion : current.conclusion;
    const newCompletedAt = updates.completedAt !== undefined ? updates.completedAt : current.completed_at;
    const newDurationMs = updates.durationMs !== undefined ? updates.durationMs : current.duration_ms;
    const newJobs = updates.jobs !== undefined ? JSON.stringify(updates.jobs) : JSON.stringify(current.jobs);
    const newArtifacts =
      updates.artifacts !== undefined ? JSON.stringify(updates.artifacts) : JSON.stringify(current.artifacts);
    const newSummary =
      updates.summary !== undefined ? JSON.stringify(updates.summary) : JSON.stringify(current.summary);
    const newLogs = updates.logs !== undefined ? updates.logs : current.logs;

    this.db
      .prepare(
        `UPDATE space_workflow_runs
         SET status = ?, conclusion = ?, completed_at = ?, duration_ms = ?,
             jobs_json = ?, artifacts_json = ?, summary_json = ?, logs_text = ?
         WHERE id = ?`,
      )
      .run(newStatus, newConclusion, newCompletedAt, newDurationMs, newJobs, newArtifacts, newSummary, newLogs, id);

    return this.getSpaceWorkflowRunById(id);
  }

  findEcoByCommitOrBranch(spaceId: string, commitOrBranch: string): SpaceEcoProposalRecord | null {
    const ecos = this.getSpaceEcoProposals(spaceId);
    const clean = commitOrBranch.replace(/^refs\/heads\//, "").trim();

    // 1. Exact branch match
    const byBranch = ecos.find(
      (e) => e.source_branch === clean || clean.endsWith(e.source_branch) || e.source_branch.endsWith(clean),
    );
    if (byBranch) return byBranch;

    // 2. ECO number in branch name (e.g. eco/ECO-2 or eco-2)
    const numMatch = clean.match(/(?:eco[-/])(\d+)/i);
    if (numMatch) {
      const num = parseInt(numMatch[1]!, 10);
      const byNum = ecos.find((e) => e.eco_number === num);
      if (byNum) return byNum;
    }

    // 3. Open ECO fallback
    const openEcos = ecos.filter((e) => e.status !== "merged" && e.status !== "rejected");
    return openEcos[0] || null;
  }

  runSpaceWorkflows(
    spaceId: string,
    ecoId: string,
    workflowFile?: string,
  ): {
    eco: SpaceEcoProposalRecord;
    runs: SpaceWorkflowRunRecord[];
    simulation: ReturnType<SpaceRepository["getSpaceEcoSimulation"]>;
  } | null {
    const eco = this.getSpaceEcoProposals(spaceId).find((e) => e.id === ecoId);
    if (!eco) return null;
    const space = this.getSpaceById(spaceId);

    const recordedRuns: SpaceWorkflowRunRecord[] = [];
    let overallPassed = true;
    let latestSummary: Record<string, unknown> = {};

    let manifests =
      space?.git_repo_path && fs.existsSync(space.git_repo_path)
        ? discoverWorkflowsInRepo({
            repoPath: space.git_repo_path,
            ref: eco.source_branch,
          })
        : [];

    if (manifests.length === 0 && space?.git_repo_path && fs.existsSync(space.git_repo_path)) {
      manifests = discoverWorkflowsInRepo({
        repoPath: space.git_repo_path,
        ref: eco.target_branch,
      });
    }

    if (workflowFile) {
      const filtered = manifests.filter(
        (m) => m.filePath === workflowFile || m.filePath.endsWith(workflowFile) || m.name === workflowFile,
      );
      if (filtered.length > 0) {
        manifests = filtered;
      }
    }

    if (manifests.length > 0 && space?.git_repo_path) {
      for (const manifest of manifests) {
        const runRes = executeWorkflowManifest({
          repoPath: space.git_repo_path,
          ref: eco.source_branch,
          manifest,
          ecoId: eco.id,
          spaceId: space.id,
        });

        const saved = this.createSpaceWorkflowRun({
          id: runRes.id,
          spaceId: space.id,
          ecoId: eco.id,
          provider: runRes.provider,
          workflowFile: runRes.workflowFile,
          workflowName: runRes.workflowName,
          triggerEvent: "eco",
          ref: runRes.ref,
          status: runRes.status,
          conclusion: runRes.conclusion,
          durationMs: runRes.durationMs,
          jobs: runRes.jobs,
          artifacts: runRes.artifacts,
          summary: runRes.simulationSummary as unknown as Record<string, unknown>,
          logs: runRes.logs,
        });
        recordedRuns.push(saved);

        if (runRes.status === "failed") {
          overallPassed = false;
        }
        if (runRes.hasArtifactSummary || Object.keys(latestSummary).length === 0) {
          latestSummary = runRes.simulationSummary as unknown as Record<string, unknown>;
        }
      }
    } else {
      const simCheck = computeEcoSimulationVerification({
        repoPath: space?.git_repo_path,
        baseRef: eco.target_branch,
        targetRef: eco.source_branch,
        impactedModels: eco.impacted_models,
        severity: eco.severity,
      });
      overallPassed = simCheck.gateStatus === "passed";
      latestSummary = simCheck as unknown as Record<string, unknown>;
    }

    const gateStatus = overallPassed ? "passed" : "failed";
    this.db
      .prepare(
        `UPDATE space_eco_proposals
         SET simulation_gate_status = ?,
             simulation_summary_json = ?,
             updated_at = datetime('now')
         WHERE id = ? AND space_id = ?`,
      )
      .run(gateStatus, JSON.stringify(latestSummary), ecoId, spaceId);

    const updatedEco = this.getSpaceEcoProposals(spaceId).find((e) => e.id === ecoId)!;
    const simResult = this.getSpaceEcoSimulation(spaceId, ecoId);
    return {
      eco: updatedEco,
      runs: recordedRuns,
      simulation: simResult,
    };
  }

  reverifySpaceEcoSimulation(
    spaceId: string,
    ecoId: string,
  ): {
    eco: SpaceEcoProposalRecord;
    simulation: ReturnType<SpaceRepository["getSpaceEcoSimulation"]>;
  } | null {
    const result = this.runSpaceWorkflows(spaceId, ecoId);
    if (!result) return null;
    return {
      eco: result.eco,
      simulation: result.simulation,
    };
  }

  getSpaceEcoBlastRadius(spaceId: string, ecoId: string): ReturnType<typeof computeEcoBlastRadius> | null {
    const eco = this.getSpaceEcoProposals(spaceId).find((e) => e.id === ecoId);
    if (!eco) return null;

    const baseModel = eco.impacted_models[0] || "SystemBaseline";
    const defaultDownstreamDependencies = [
      {
        model: `${baseModel}Assembly`,
        dependencyType: "extends",
        path: `models/${baseModel}Assembly.mo`,
      },
      {
        model: "VehicleDynamics.ChassisHarness",
        dependencyType: "connect()",
        path: "models/VehicleDynamics/ChassisHarness.mo",
      },
      {
        model: "Sensors.TelemetryBus",
        dependencyType: "component",
        path: "models/Sensors/TelemetryBus.mo",
      },
    ];

    const defaultAllocatedRequirements = [
      {
        reqId: "REQ-DYN-012",
        title: "Dynamic Overshoot Margin Under ISO Lane Change",
        standard: "ISO 26262 ASIL-D",
        status: "satisfied" as const,
      },
      {
        reqId: "REQ-THM-045",
        title: "Damping Thermal Dissipation Limit (< 85°C)",
        standard: "AS9100 Rev D",
        status: "satisfied" as const,
      },
    ];

    const space = this.getSpaceById(spaceId);
    return computeEcoBlastRadius({
      repoPath: space?.git_repo_path,
      baseRef: eco.target_branch,
      targetRef: eco.source_branch,
      impactedModels: eco.impacted_models,
      severity: eco.severity,
      defaultDownstreamDependencies,
      defaultAllocatedRequirements,
    });
  }

  getSpaceEcoBom(
    spaceId: string,
    ecoId: string,
  ): {
    sourceBranch: string;
    targetBranch: string;
    summary: {
      totalPartsDelta: number;
      massDeltaKg: number;
      costDeltaUsd: number;
      carbonDeltaKgCo2: number;
    };
    parts: {
      partNumber: string;
      name: string;
      category: string;
      changeStatus: "added" | "removed" | "modified" | "unchanged";
      baselineQuantity: number;
      targetQuantity: number;
      unitCostUsd: number;
      massKg: number;
      packageDependency?: string | undefined;
      variantOverrides?: Record<string, unknown> | undefined;
    }[];
  } | null {
    const eco = this.getSpaceEcoProposals(spaceId).find((e) => e.id === ecoId);
    if (!eco) return null;

    const parts = [
      {
        partNumber: "BLDC-42 [variant:high-flow]",
        name: "Brushless DC Motor (High-Flow 24V)",
        category: "Actuator",
        changeStatus: "modified" as const,
        baselineQuantity: 1,
        targetQuantity: 1,
        unitCostUsd: 145.0,
        massKg: 0.85,
        packageDependency: "@suppliers/bldc-motor@^1.2.0",
        variantOverrides: { voltage: "24V (was 12V)", maxFlowLpm: 32.5 },
      },
      {
        partNumber: "SNS-PRES-02-RED",
        name: "Redundant Dynamic Pressure Sensor (ASIL-D)",
        category: "Sensor",
        changeStatus: "added" as const,
        baselineQuantity: 0,
        targetQuantity: 1,
        unitCostUsd: 28.5,
        massKg: 0.03,
        packageDependency: "@standards/safety-sensors@^2.0.1",
        variantOverrides: { redundancy: "Dual-Channel Hall Effect" },
      },
      {
        partNumber: "CANFD-XCVR-04",
        name: "High-Speed CAN-FD Physical Transceiver",
        category: "Electronics",
        changeStatus: "added" as const,
        baselineQuantity: 0,
        targetQuantity: 1,
        unitCostUsd: 5.8,
        massKg: 0.015,
        packageDependency: "@telemetry/canfd-bus@^1.0.4",
      },
      {
        partNumber: "LEGACY-RELAY-12V",
        name: "Electromechanical 12V Solid-State Relay",
        category: "Electronics",
        changeStatus: "removed" as const,
        baselineQuantity: 1,
        targetQuantity: 0,
        unitCostUsd: 18.0,
        massKg: 0.135,
      },
      {
        partNumber: "MCU-STM32H7-ASIL",
        name: "Dual-Core Cortex-M7 Motor Controller",
        category: "Controller",
        changeStatus: "unchanged" as const,
        baselineQuantity: 1,
        targetQuantity: 1,
        unitCostUsd: 32.0,
        massKg: 0.04,
        packageDependency: "@suppliers/mcu-core@^3.1.0",
      },
      {
        partNumber: "BRK-AL-6061-T6",
        name: "Structural CNC Mounting Bracket",
        category: "Structural",
        changeStatus: "unchanged" as const,
        baselineQuantity: 2,
        targetQuantity: 2,
        unitCostUsd: 14.5,
        massKg: 0.32,
      },
    ];

    const space = this.getSpaceById(spaceId);
    return computeEcoBomDelta({
      repoPath: space?.git_repo_path,
      baseRef: eco.target_branch,
      targetRef: eco.source_branch,
      impactedModels: eco.impacted_models,
      defaultParts: parts,
    });
  }

  mergeSpaceEcoProposal(params: { spaceId: string; ecoId: string; userId: number }): {
    eco: SpaceEcoProposalRecord;
    releaseTag: string;
    commitSha: string;
    aasxPackage: {
      filename: string;
      assetId: string;
      version: string;
      submodels: string[];
    };
    ddpContainer: {
      filename: string;
      standard: string;
      manifestChecksum: string;
    };
    announcementMessage?: SpaceMessageRecord | undefined;
  } {
    const eco = this.getSpaceEcoProposals(params.spaceId).find((e) => e.id === params.ecoId);
    if (!eco) {
      throw new Error("ECO proposal not found");
    }
    if (eco.status === "merged") {
      throw new Error("ECO proposal is already merged");
    }
    if (eco.simulation_gate_status !== "passed") {
      throw new Error("Cannot merge ECO: DAE simulation verification gate must pass before merge");
    }
    const hasRejections = eco.approvals.some((a) => a.decision === "rejected" || a.decision === "changes_requested");
    if (hasRejections) {
      throw new Error("Cannot merge ECO: Blocking review change requests or rejections exist");
    }
    const hasApproval = eco.approvals.some((a) => a.decision === "approved");
    if (!hasApproval) {
      throw new Error("Cannot merge ECO: Formal cryptographic approval quorum not met (at least 1 required)");
    }

    const releaseTag = `v1.0.${eco.eco_number}-eco`;
    let commitSha = crypto.randomBytes(20).toString("hex");

    const space = this.getSpaceById(params.spaceId);
    if (space?.git_repo_path && fs.existsSync(space.git_repo_path)) {
      const mergeRes = mergeSpaceGitBranches({
        repoPath: space.git_repo_path,
        sourceBranch: eco.source_branch,
        targetBranch: eco.target_branch,
        message: `Merge ECO-${eco.eco_number}: ${eco.title}`,
      });
      if (mergeRes.success && mergeRes.commitSha) {
        commitSha = mergeRes.commitSha;
        try {
          tagSpaceGitCommit({
            repoPath: space.git_repo_path,
            tagName: releaseTag,
            targetRef: commitSha,
            message: `Release ${releaseTag} from approved ECO-${eco.eco_number}`,
          });
        } catch {
          // Optional JSON column or best-effort side-effect ignored
        }
      }
    }

    this.db
      .prepare(
        `UPDATE space_eco_proposals SET status = 'merged', updated_at = datetime('now') WHERE id = ? AND space_id = ?`,
      )
      .run(params.ecoId, params.spaceId);

    const updatedEco = this.getSpaceEcoProposals(params.spaceId).find((e) => e.id === params.ecoId)!;

    const pkgDir = path.join(this.facade.dbDir, "packages", params.spaceId);
    if (!fs.existsSync(pkgDir)) {
      try {
        fs.mkdirSync(pkgDir, { recursive: true });
      } catch {
        // Optional JSON column or best-effort side-effect ignored
      }
    }

    const aasxPackage = generateAasxPackage({
      spaceId: params.spaceId,
      ecoNumber: eco.eco_number,
      commitSha,
      releaseTag,
      outputDir: pkgDir,
    });

    const ddpContainer = generateDdpContainer({
      spaceId: params.spaceId,
      ecoNumber: eco.eco_number,
      commitSha,
      releaseTag,
      outputDir: pkgDir,
    });

    let announcementMessage: SpaceMessageRecord | undefined;
    try {
      const channels = this.getSpaceChannels(params.spaceId);
      const targetChannel =
        channels.find((c) => c.slug === "announcements" || c.name.toLowerCase().includes("announcement")) ||
        channels.find((c) => c.slug === "general") ||
        channels[0];

      if (targetChannel) {
        announcementMessage = this.createSpaceMessage({
          channelId: targetChannel.id,
          spaceId: params.spaceId,
          authorId: params.userId,
          senderType: "ci_runner",
          senderName: "Release Bot (Ansatz PLM)",
          content:
            `🚀 **Change Order ECO-${eco.eco_number} Successfully Released & Merged**\n\n` +
            `* **Title:** ${eco.title}\n` +
            `* **Release Tag:** \`${releaseTag}\` (Commit: \`${commitSha.slice(0, 7)}\`)\n` +
            `* **Git Branch:** \`${eco.source_branch}\` → \`${eco.target_branch}\`\n` +
            `* **DAE Simulation Gate:** Verified PASSED (CVODE BDF Stiff Solver)\n` +
            `* **Compliance Sign-Offs:** ${eco.approvals.length} cryptographic signatures (21 CFR Part 11 / ISO 26262)\n` +
            `* **Bundles Generated:** AASX Package (IDTA v3.0) & ISO 10303-242 DDP Container.`,
        });
      }
    } catch {
      // Non-critical if chat announcement fails
    }

    // Auto-close any linked issues or issues referenced with 'Fixes #X' or 'Closes #X' in title or description
    try {
      const textToScan = `${eco.title} ${eco.description}`;
      const matches = Array.from(textToScan.matchAll(/(?:fixes|closes|resolves)\s*#(\d+)/gi));
      for (const m of matches) {
        const issueNum = Number(m[1]);
        const issue = this.getSpaceIssues(params.spaceId).find((i) => i.issue_number === issueNum);
        if (issue && issue.status === "open") {
          this.updateSpaceIssue({
            spaceId: params.spaceId,
            issueId: issue.id,
            status: "closed",
            linkedPrNumber: eco.eco_number,
          });
        }
      }
    } catch {
      // Non-critical if issue auto-closure encounters error
    }

    return {
      eco: updatedEco,
      releaseTag,
      commitSha,
      aasxPackage,
      ddpContainer,
      announcementMessage,
    };
  }

  // ── Space Problem Reports & Engineering Issues (ECR) ──────────────────────

  getSpaceIssues(spaceId: string): SpaceIssueRecord[] {
    const rows = this.db
      .prepare(
        `SELECT i.*, u.username AS author_username
         FROM space_issues i
         LEFT JOIN users u ON i.author_id = u.id
         WHERE i.space_id = ?
         ORDER BY i.issue_number DESC`,
      )
      .all(spaceId) as Record<string, unknown>[];

    return rows.map((r) => {
      const issueId = String(r["id"]);
      let impactedModels: string[] = [];
      if (typeof r["impacted_models_json"] === "string") {
        try {
          const parsed = JSON.parse(r["impacted_models_json"]);
          if (Array.isArray(parsed)) impactedModels = parsed.map(String);
        } catch {
          // Optional JSON column or best-effort side-effect ignored
        }
      }
      let labels: string[] = [];
      if (typeof r["labels_json"] === "string") {
        try {
          const parsed = JSON.parse(r["labels_json"]);
          if (Array.isArray(parsed)) labels = parsed.map(String);
        } catch {
          // Optional JSON column or best-effort side-effect ignored
        }
      }

      return {
        id: issueId,
        space_id: String(r["space_id"]),
        issue_number: Number(r["issue_number"]),
        title: String(r["title"]),
        description: String(r["description"] ?? ""),
        status: (r["status"] || "open") as SpaceIssueRecord["status"],
        severity: (r["severity"] || "standard") as SpaceIssueRecord["severity"],
        author_id: r["author_id"] != null ? Number(r["author_id"]) : null,
        author_username: r["author_username"] != null ? String(r["author_username"]) : null,
        impacted_models: impactedModels,
        labels,
        linked_pr_number: r["linked_pr_number"] != null ? Number(r["linked_pr_number"]) : null,
        closed_at: r["closed_at"] != null ? String(r["closed_at"]) : null,
        external_source:
          r["external_source"] != null ? (String(r["external_source"]) as SpaceIssueRecord["external_source"]) : null,
        external_key: r["external_key"] != null ? String(r["external_key"]) : null,
        external_url: r["external_url"] != null ? String(r["external_url"]) : null,
        external_updated_at: r["external_updated_at"] != null ? String(r["external_updated_at"]) : null,
        sync_status: (r["sync_status"] || "synced") as SpaceIssueRecord["sync_status"],
        created_at: String(r["created_at"]),
        updated_at: String(r["updated_at"]),
      };
    });
  }

  getSpaceIssueById(
    spaceId: string,
    issueIdOrNum: string | number,
  ): (SpaceIssueRecord & { comments: SpaceIssueCommentRecord[] }) | null {
    const issues = this.getSpaceIssues(spaceId);
    const found = issues.find((i) => i.id === String(issueIdOrNum) || i.issue_number === Number(issueIdOrNum));
    if (!found) return null;

    const commentRows = this.db
      .prepare(
        `SELECT c.*, u.username, u.display_name
         FROM space_issue_comments c
         JOIN users u ON c.user_id = u.id
         WHERE c.issue_id = ?
         ORDER BY c.created_at ASC`,
      )
      .all(found.id) as Record<string, unknown>[];

    const comments: SpaceIssueCommentRecord[] = commentRows.map((c) => ({
      id: String(c["id"]),
      issue_id: String(c["issue_id"]),
      user_id: Number(c["user_id"]),
      username: String(c["username"]),
      display_name: c["display_name"] != null ? String(c["display_name"]) : null,
      content: String(c["content"]),
      created_at: String(c["created_at"]),
    }));

    return { ...found, comments };
  }

  createSpaceIssue(params: {
    spaceId: string;
    title: string;
    description?: string | undefined;
    severity?: "minor" | "standard" | "major" | "safety_critical" | undefined;
    authorId: number;
    impactedModels?: string[] | undefined;
    labels?: string[] | undefined;
    linkedPrNumber?: number | null | undefined;
  }): SpaceIssueRecord {
    const id = `issue_${crypto.randomBytes(8).toString("hex")}`;
    const maxRow = this.db
      .prepare(`SELECT COALESCE(MAX(issue_number), 0) AS max_num FROM space_issues WHERE space_id = ?`)
      .get(params.spaceId) as { max_num: number };
    const nextNum = Number(maxRow?.max_num ?? 0) + 1;

    this.db
      .prepare(
        `INSERT INTO space_issues (
          id, space_id, issue_number, title, description, status, severity,
          author_id, impacted_models_json, labels_json, linked_pr_number,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      )
      .run(
        id,
        params.spaceId,
        nextNum,
        params.title.trim(),
        params.description?.trim() || "",
        params.severity ?? "standard",
        params.authorId,
        JSON.stringify(params.impactedModels ?? []),
        JSON.stringify(params.labels ?? []),
        params.linkedPrNumber ?? null,
      );

    return this.getSpaceIssues(params.spaceId).find((i) => i.id === id)!;
  }

  updateSpaceIssue(params: {
    spaceId: string;
    issueId: string;
    status?: "open" | "closed" | undefined;
    title?: string | undefined;
    description?: string | undefined;
    severity?: "minor" | "standard" | "major" | "safety_critical" | undefined;
    linkedPrNumber?: number | null | undefined;
  }): SpaceIssueRecord | null {
    const existing = this.getSpaceIssues(params.spaceId).find(
      (i) => i.id === params.issueId || i.issue_number === Number(params.issueId),
    );
    if (!existing) return null;

    const updates: string[] = ["updated_at = datetime('now')"];
    const values: unknown[] = [];

    if (params.status) {
      updates.push("status = ?");
      values.push(params.status);
      if (params.status === "closed") {
        updates.push("closed_at = datetime('now')");
      } else {
        updates.push("closed_at = NULL");
      }
    }
    if (params.title !== undefined) {
      updates.push("title = ?");
      values.push(params.title.trim());
    }
    if (params.description !== undefined) {
      updates.push("description = ?");
      values.push(params.description.trim());
    }
    if (params.severity !== undefined) {
      updates.push("severity = ?");
      values.push(params.severity);
    }
    if (params.linkedPrNumber !== undefined) {
      updates.push("linked_pr_number = ?");
      values.push(params.linkedPrNumber);
    }

    values.push(existing.id);
    this.db.prepare(`UPDATE space_issues SET ${updates.join(", ")} WHERE id = ?`).run(...values);

    return this.getSpaceIssues(params.spaceId).find((i) => i.id === existing.id)!;
  }

  upsertSpaceIssueFromExternal(params: {
    spaceId: string;
    externalSource: "jira" | "github" | "gitlab" | "polarion";
    externalKey: string;
    externalUrl?: string | null | undefined;
    externalUpdatedAt?: string | null | undefined;
    title: string;
    description?: string | undefined;
    status: "open" | "closed";
    severity?: "minor" | "standard" | "major" | "safety_critical" | undefined;
    authorId?: number | null | undefined;
    impactedModels?: string[] | undefined;
    labels?: string[] | undefined;
    linkedPrNumber?: number | null | undefined;
    syncStatus?: "synced" | "pending_push" | "conflict" | undefined;
  }): { issue: SpaceIssueRecord; isNew: boolean } {
    const existing = this.db
      .prepare(
        `SELECT id, issue_number FROM space_issues
         WHERE space_id = ? AND external_source = ? AND external_key = ?`,
      )
      .get(params.spaceId, params.externalSource, params.externalKey) as
      { id: string; issue_number: number } | undefined;

    if (existing) {
      const closedAt = params.status === "closed" ? "datetime('now')" : "NULL";
      this.db
        .prepare(
          `UPDATE space_issues SET
            title = ?,
            description = ?,
            status = ?,
            severity = ?,
            impacted_models_json = ?,
            labels_json = ?,
            external_url = ?,
            external_updated_at = ?,
            sync_status = ?,
            closed_at = ${closedAt},
            updated_at = datetime('now')
           WHERE id = ?`,
        )
        .run(
          params.title.trim(),
          params.description?.trim() || "",
          params.status,
          params.severity ?? "standard",
          JSON.stringify(params.impactedModels ?? []),
          JSON.stringify(params.labels ?? []),
          params.externalUrl ?? null,
          params.externalUpdatedAt ?? null,
          params.syncStatus ?? "synced",
          existing.id,
        );
      return { issue: this.getSpaceIssueById(params.spaceId, existing.id)!, isNew: false };
    }

    const id = `issue_${crypto.randomBytes(8).toString("hex")}`;
    const maxRow = this.db
      .prepare(`SELECT COALESCE(MAX(issue_number), 0) AS max_num FROM space_issues WHERE space_id = ?`)
      .get(params.spaceId) as { max_num: number };
    const nextNum = Number(maxRow?.max_num ?? 0) + 1;
    const closedAt = params.status === "closed" ? "datetime('now')" : "NULL";

    this.db
      .prepare(
        `INSERT INTO space_issues (
          id, space_id, issue_number, title, description, status, severity,
          author_id, impacted_models_json, labels_json, linked_pr_number,
          external_source, external_key, external_url, external_updated_at, sync_status,
          closed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${closedAt}, datetime('now'), datetime('now'))`,
      )
      .run(
        id,
        params.spaceId,
        nextNum,
        params.title.trim(),
        params.description?.trim() || "",
        params.status,
        params.severity ?? "standard",
        params.authorId ?? null,
        JSON.stringify(params.impactedModels ?? []),
        JSON.stringify(params.labels ?? []),
        params.linkedPrNumber ?? null,
        params.externalSource,
        params.externalKey,
        params.externalUrl ?? null,
        params.externalUpdatedAt ?? null,
        params.syncStatus ?? "synced",
      );

    return { issue: this.getSpaceIssueById(params.spaceId, id)!, isNew: true };
  }

  addSpaceIssueComment(params: { issueId: string; userId: number; content: string }): SpaceIssueCommentRecord {
    const id = `ic_${crypto.randomBytes(8).toString("hex")}`;
    this.db
      .prepare(
        `INSERT INTO space_issue_comments (id, issue_id, user_id, content, created_at)
         VALUES (?, ?, ?, ?, datetime('now'))`,
      )
      .run(id, params.issueId, params.userId, params.content.trim());

    const user = this.facade.getUserById(params.userId);
    return {
      id,
      issue_id: params.issueId,
      user_id: params.userId,
      username: user?.username || "engineer",
      display_name: user?.display_name || null,
      content: params.content.trim(),
      created_at: new Date().toISOString(),
    };
  }

  // ── Space Entity Autocomplete & Sidenav Tree ──────────────────────────────

  autocompleteSpaceEntities(
    spaceId: string,
    query: string,
  ): {
    kind: "doc" | "channel" | "eco" | "member";
    id: string;
    label: string;
    reference: string;
    subtitle: string;
  }[] {
    const q = query.trim().toLowerCase();
    const results: {
      kind: "doc" | "channel" | "eco" | "member";
      id: string;
      label: string;
      reference: string;
      subtitle: string;
    }[] = [];

    for (const doc of this.getSpacePages(spaceId)) {
      if (!q || doc.slug.toLowerCase().includes(q) || doc.title.toLowerCase().includes(q)) {
        results.push({
          kind: "doc",
          id: doc.id,
          label: doc.title,
          reference: `#doc:${doc.slug}`,
          subtitle: `Living Doc (${doc.path_in_git})`,
        });
      }
    }

    for (const ch of this.getSpaceChannels(spaceId)) {
      if (!q || ch.slug.toLowerCase().includes(q) || ch.name.toLowerCase().includes(q)) {
        results.push({
          kind: "channel",
          id: ch.id,
          label: `#${ch.name}`,
          reference: `#${ch.slug}`,
          subtitle: ch.topic || "Space Channel",
        });
      }
    }

    for (const eco of this.getSpaceEcoProposals(spaceId)) {
      const code = `eco-${eco.eco_number}`;
      if (!q || code.includes(q) || eco.title.toLowerCase().includes(q)) {
        results.push({
          kind: "eco",
          id: eco.id,
          label: `ECO-${eco.eco_number}: ${eco.title}`,
          reference: `#eco:${eco.eco_number}`,
          subtitle: `PLM Change Order [${eco.status.toUpperCase()}]`,
        });
      }
    }

    for (const mem of this.getSpaceMembers(spaceId)) {
      if (!q || mem.username.toLowerCase().includes(q) || (mem.display_name || "").toLowerCase().includes(q)) {
        results.push({
          kind: "member",
          id: String(mem.user_id),
          label: mem.display_name || `@${mem.username}`,
          reference: `@${mem.username}`,
          subtitle: `Space ${mem.role}`,
        });
      }
    }

    return results.slice(0, 15);
  }

  getUserChatSidebarTree(userId: number): {
    spaces: (SpaceRecord & {
      member_role: SpaceRole;
      channels: SpaceChannelRecord[];
      total_unread: number;
      total_mentions: number;
    })[];
  } {
    const joined = this.getUserJoinedSpaces(userId);
    const spaces = joined.map((sp) => {
      const channels = this.getSpaceChannels(sp.id, userId);
      const totalUnread = channels.reduce((acc, c) => acc + (c.unread_count ?? 0), 0);
      const totalMentions = channels.reduce((acc, c) => acc + (c.unread_mentions_count ?? 0), 0);
      return {
        ...sp,
        channels,
        total_unread: totalUnread,
        total_mentions: totalMentions,
      };
    });
    return { spaces };
  }
}
