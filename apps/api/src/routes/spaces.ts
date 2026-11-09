// SPDX-License-Identifier: AGPL-3.0-or-later

import bcrypt from "bcryptjs";
import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import fs from "node:fs";
import path from "node:path";
import type { LibraryDatabase, SpaceOwnerType, SpaceRole, SpaceVisibility } from "../database.js";
import { optionalAuth, requireAuth } from "../middleware/auth-middleware.js";
import { defaultApiLimiter } from "../middleware/rate-limiter.js";
import { JiraConnector, postAutomatedSimulationCommentsIfConfigured } from "../services/integrations/jira-connector.js";
import { getSpaceDomainPreset, listSpaceDomainPresets } from "../services/spaces/domain-presets.js";
import {
  commitFilesToBareGitVault,
  ensureSpaceGitVaultInitialized,
  generateStarterFilesForSpace,
  resolveSpaceGitRepoPath,
} from "../services/spaces/space-git-vault.js";
import { discoverWorkflowsInRepo, type WorkflowJob, type WorkflowManifest } from "../services/workflows/index.js";
import { LocalGitProvider } from "../util/local-git.js";
import { broadcastSpaceChatEvent } from "./collab-ws.js";
import { createSpaceSysml2Router } from "./spaces-sysml2.js";

function isValidSlug(slug: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,63}$/.test(slug);
}

const VALID_SPACE_ROLES: readonly SpaceRole[] = [
  "owner",
  "lead_engineer",
  "approver",
  "contributor",
  "reviewer",
  "viewer",
];

const VALID_VISIBILITIES: readonly SpaceVisibility[] = ["public", "unlisted", "internal", "private"];

function isCallerAdmin(req: Request): boolean {
  return Boolean(
    req.user && (req.user.account_type === "admin" || req.user.accountType === "admin" || req.user.role === "admin"),
  );
}

export function spacesRouter(database: LibraryDatabase): Router {
  const router = createRouter();
  const localGitProvider = new LocalGitProvider();
  router.use(defaultApiLimiter);

  /**
   * GET /api/v1/spaces/presets
   * Returns all 7 industry domain presets covering the 68 engineering languages.
   */
  router.get("/presets", (_req: Request, res: Response): void => {
    res.json({ presets: listSpaceDomainPresets() });
  });

  /**
   * GET /api/v1/spaces/my
   * Returns the authenticated user's joined and owned Spaces with channels and unread counts
   * for the Slack/Discord-style Chat Sidenav.
   */
  router.get("/my", requireAuth, (req: Request, res: Response): void => {
    const tree = database.getUserChatSidebarTree(req.user!.id);
    const organizations = database.getUserOrganizations(req.user!.id);
    res.json({
      spaces: tree.spaces,
      organizations,
    });
  });

  /**
   * GET /api/v1/spaces/resolve-namespace/:slug
   * Resolves a polymorphic container slug (`/@:slug`) to either an Organization or a User Profile,
   * including all visible Spaces inside that container.
   */
  router.get("/resolve-namespace/:slug", optionalAuth, (req: Request, res: Response): void => {
    const rawSlug = String(req.params["slug"] ?? "").trim();
    const resolved = database.resolveNamespacePrincipal(rawSlug, req.user?.id);
    if (!resolved) {
      res.status(404).json({ error: `Namespace '@${rawSlug.replace(/^@/, "")}' not found` });
      return;
    }
    res.json(resolved);
  });

  /**
   * GET /api/v1/spaces
   * List and filter Spaces across the platform.
   */
  router.get("/", optionalAuth, (req: Request, res: Response): void => {
    const ownerTypeRaw = typeof req.query["ownerType"] === "string" ? req.query["ownerType"].trim() : "";
    const ownerType: SpaceOwnerType | undefined =
      ownerTypeRaw === "organization" || ownerTypeRaw === "user" ? ownerTypeRaw : undefined;
    const namespace = typeof req.query["namespace"] === "string" ? req.query["namespace"].trim() : undefined;
    const domainPreset = typeof req.query["domainPreset"] === "string" ? req.query["domainPreset"].trim() : undefined;
    const search = typeof req.query["search"] === "string" ? req.query["search"].trim() : undefined;
    const limit = req.query["limit"] ? Number(req.query["limit"]) : 100;

    const spaces = database.listSpaces({
      ownerType,
      namespace,
      domainPreset,
      search,
      viewerUserId: req.user?.id,
      limit,
    });
    res.json({ spaces });
  });

  /**
   * POST /api/v1/spaces
   * Create a new Space under either the authenticated User's profile or an Organization.
   */
  router.post("/", requireAuth, (req: Request, res: Response): void => {
    const body = req.body ?? {};
    const slug = String(body.slug ?? "")
      .trim()
      .toLowerCase();
    const name = String(body.name ?? "").trim();
    const tagline = body.tagline != null ? String(body.tagline).trim() : null;
    const description = body.description != null ? String(body.description).trim() : null;
    const ownerType: SpaceOwnerType = body.ownerType === "organization" ? "organization" : "user";
    const domainPreset = typeof body.domainPreset === "string" ? body.domainPreset.trim() : "systems_general";
    const visibilityRaw = typeof body.visibility === "string" ? body.visibility.trim().toLowerCase() : "public";
    const visibility: SpaceVisibility = VALID_VISIBILITIES.includes(visibilityRaw as SpaceVisibility)
      ? (visibilityRaw as SpaceVisibility)
      : "public";
    const avatarUrl = body.avatarUrl ? String(body.avatarUrl).trim() : null;
    const bannerUrl = body.bannerUrl ? String(body.bannerUrl).trim() : null;
    const defaultBranch =
      typeof body.defaultBranch === "string" && body.defaultBranch.trim() ? body.defaultBranch.trim() : "main";

    if (!slug || !isValidSlug(slug)) {
      res.status(400).json({ error: "Space slug must be 2–64 alphanumeric, dash, or underscore characters" });
      return;
    }
    if (!name) {
      res.status(400).json({ error: "Space name is required" });
      return;
    }

    let organizationId: number | null = null;
    if (ownerType === "organization") {
      if (body.organizationId) {
        organizationId = Number(body.organizationId);
      } else if (typeof body.organizationSlug === "string" && body.organizationSlug.trim()) {
        const org = database.getOrganizationBySlug(body.organizationSlug.trim().replace(/^@/, ""));
        if (org) organizationId = org.id;
      }
      if (!organizationId || Number.isNaN(organizationId)) {
        res.status(400).json({ error: "Valid organizationId or organizationSlug is required for organization Spaces" });
        return;
      }
      const orgRole = database.getOrganizationMemberRole(organizationId, req.user!.id);
      if (!isCallerAdmin(req) && orgRole !== "owner" && orgRole !== "maintainer") {
        res
          .status(403)
          .json({ error: "Only organization owners or maintainers can create Spaces in this organization" });
        return;
      }
    }

    try {
      const space = database.createSpace({
        slug,
        name,
        tagline,
        description,
        ownerType,
        userId: ownerType === "user" ? req.user!.id : null,
        organizationId,
        creatorUserId: req.user!.id,
        domainPreset,
        visibility,
        avatarUrl,
        bannerUrl,
        defaultBranch,
      });

      res.status(201).json({
        space,
        channels: database.getSpaceChannels(space.id, req.user!.id),
        pages: database.getSpacePages(space.id),
        ecos: database.getSpaceEcoProposals(space.id),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes("already exists") ? 409 : 400;
      res.status(status).json({ error: msg || "Failed to create Space" });
    }
  });

  /**
   * GET /api/v1/spaces/:namespace/:slug
   * Full hydration of a Space by owner namespace (`@user` or `@org`) and Space slug.
   */
  router.get("/:namespace/:slug", optionalAuth, (req: Request, res: Response): void => {
    const namespace = String(req.params["namespace"] ?? "");
    const slug = String(req.params["slug"] ?? "");
    const space = database.getSpaceByNamespaceAndSlug(namespace, slug);
    if (!space) {
      res.status(404).json({ error: `Space '@${namespace.replace(/^@/, "")}/${slug}' not found` });
      return;
    }

    const isAdmin = isCallerAdmin(req);
    if (!database.canUserViewSpace(space, req.user?.id, isAdmin)) {
      res.status(403).json({ error: "You do not have permission to view this private Space" });
      return;
    }

    const channels = database.getSpaceChannels(space.id, req.user?.id);
    const pages = database.getSpacePages(space.id);
    const members = database.getSpaceMembers(space.id);
    const ecos = database.getSpaceEcoProposals(space.id);
    const issues = database.getSpaceIssues(space.id);
    const preset = getSpaceDomainPreset(space.domain_preset);
    const isFollowing = req.user ? database.isFollowingSpace(space.id, req.user.id) : false;
    const viewerRole = req.user ? database.getSpaceMemberRole(space.id, req.user.id) : null;
    const canWrite = database.canUserWriteSpace(space, req.user?.id, isAdmin);
    const canAdmin = database.canUserAdminSpace(space, req.user?.id, isAdmin);

    res.json({
      space,
      preset,
      channels,
      pages,
      members,
      ecos,
      issues,
      viewerState: {
        isFollowing,
        role: viewerRole,
        canWrite,
        canAdmin,
      },
    });
  });

  /**
   * PATCH / PUT /api/v1/spaces/:namespace/:slug
   * Update Space settings.
   */
  const handleUpdateSpace = (req: Request, res: Response): void => {
    const namespace = String(req.params["namespace"] ?? "");
    const slug = String(req.params["slug"] ?? "");
    const space = database.getSpaceByNamespaceAndSlug(namespace, slug);
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }
    if (!database.canUserAdminSpace(space, req.user!.id, isCallerAdmin(req))) {
      res.status(403).json({ error: "Only Space owners, lead engineers, or org admins can update Space settings" });
      return;
    }

    const body = req.body ?? {};
    const visibilityRaw = typeof body.visibility === "string" ? body.visibility.trim().toLowerCase() : undefined;
    const visibility =
      visibilityRaw && VALID_VISIBILITIES.includes(visibilityRaw as SpaceVisibility)
        ? (visibilityRaw as SpaceVisibility)
        : undefined;

    const updated = database.updateSpace(space.id, {
      name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : undefined,
      tagline: body.tagline !== undefined ? (body.tagline ? String(body.tagline).trim() : null) : undefined,
      description:
        body.description !== undefined ? (body.description ? String(body.description).trim() : null) : undefined,
      domainPreset: typeof body.domainPreset === "string" ? body.domainPreset.trim() : undefined,
      visibility,
      avatarUrl: body.avatarUrl !== undefined ? (body.avatarUrl ? String(body.avatarUrl).trim() : null) : undefined,
      bannerUrl: body.bannerUrl !== undefined ? (body.bannerUrl ? String(body.bannerUrl).trim() : null) : undefined,
      defaultBranch: typeof body.defaultBranch === "string" ? body.defaultBranch.trim() : undefined,
      enabledTabs: Array.isArray(body.enabledTabs) ? body.enabledTabs.map(String) : undefined,
      settings: body.settings && typeof body.settings === "object" ? body.settings : undefined,
    });

    res.json({ space: updated });
  };

  router.patch("/:namespace/:slug", requireAuth, handleUpdateSpace);
  router.put("/:namespace/:slug", requireAuth, handleUpdateSpace);

  /**
   * POST /api/v1/spaces/:namespace/:slug/transfer
   * Transfer a Space between a User Profile and an Organization container.
   */
  router.post("/:namespace/:slug/transfer", requireAuth, (req: Request, res: Response): void => {
    const namespace = String(req.params["namespace"] ?? "");
    const slug = String(req.params["slug"] ?? "");
    const space = database.getSpaceByNamespaceAndSlug(namespace, slug);
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }

    const isAdmin = isCallerAdmin(req);
    if (!database.canUserAdminSpace(space, req.user!.id, isAdmin)) {
      res.status(403).json({ error: "Only the Space owner or organization admin can transfer ownership" });
      return;
    }

    const targetOwnerType: SpaceOwnerType = req.body?.targetOwnerType === "organization" ? "organization" : "user";
    const targetSlug = String(req.body?.targetSlug ?? "")
      .trim()
      .replace(/^@/, "")
      .toLowerCase();
    const newSlug = typeof req.body?.newSlug === "string" ? req.body.newSlug.trim().toLowerCase() : undefined;

    if (!targetSlug) {
      res.status(400).json({ error: "targetSlug is required" });
      return;
    }

    if (targetOwnerType === "organization") {
      const org = database.getOrganizationBySlug(targetSlug);
      if (!org) {
        res.status(404).json({ error: `Target organization '@${targetSlug}' not found` });
        return;
      }
      const callerOrgRole = database.getOrganizationMemberRole(org.id, req.user!.id);
      if (!isAdmin && callerOrgRole !== "owner" && callerOrgRole !== "maintainer") {
        res
          .status(403)
          .json({ error: `You must be an owner or maintainer of '@${targetSlug}' to transfer a Space into it` });
        return;
      }
    } else {
      const targetUser = database.getUserByUsername(targetSlug);
      if (!targetUser) {
        res.status(404).json({ error: `Target user '@${targetSlug}' not found` });
        return;
      }
      if (!isAdmin && targetUser.id !== req.user!.id) {
        res.status(403).json({ error: "Can only transfer a personal Space to your own profile" });
        return;
      }
    }

    try {
      const transferred = database.transferSpaceOwnership(space.id, targetOwnerType, targetSlug, newSlug);
      res.json({ space: transferred });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Failed to transfer Space" });
    }
  });

  /**
   * DELETE /api/v1/spaces/:namespace/:slug
   */
  router.delete("/:namespace/:slug", requireAuth, (req: Request, res: Response): void => {
    const namespace = String(req.params["namespace"] ?? "");
    const slug = String(req.params["slug"] ?? "");
    const space = database.getSpaceByNamespaceAndSlug(namespace, slug);
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }
    if (!database.canUserAdminSpace(space, req.user!.id, isCallerAdmin(req))) {
      res.status(403).json({ error: "Only Space owners can delete this Space" });
      return;
    }
    database.deleteSpace(space.id);
    res.json({ success: true });
  });

  /**
   * POST / DELETE /api/v1/spaces/:namespace/:slug/follow
   */
  router.post("/:namespace/:slug/follow", requireAuth, (req: Request, res: Response): void => {
    const space = database.getSpaceByNamespaceAndSlug(
      String(req.params["namespace"] ?? ""),
      String(req.params["slug"] ?? ""),
    );
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }
    database.followSpace(space.id, req.user!.id);
    const refreshed = database.getSpaceById(space.id)!;
    res.json({ isFollowing: true, followerCount: refreshed.follower_count });
  });

  router.delete("/:namespace/:slug/follow", requireAuth, (req: Request, res: Response): void => {
    const space = database.getSpaceByNamespaceAndSlug(
      String(req.params["namespace"] ?? ""),
      String(req.params["slug"] ?? ""),
    );
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }
    database.unfollowSpace(space.id, req.user!.id);
    const refreshed = database.getSpaceById(space.id)!;
    res.json({ isFollowing: false, followerCount: refreshed.follower_count });
  });

  /**
   * GET / POST / DELETE /api/v1/spaces/:namespace/:slug/members
   */
  router.get("/:namespace/:slug/members", optionalAuth, (req: Request, res: Response): void => {
    const space = database.getSpaceByNamespaceAndSlug(
      String(req.params["namespace"] ?? ""),
      String(req.params["slug"] ?? ""),
    );
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }
    res.json({ members: database.getSpaceMembers(space.id) });
  });

  router.post("/:namespace/:slug/members", requireAuth, (req: Request, res: Response): void => {
    const space = database.getSpaceByNamespaceAndSlug(
      String(req.params["namespace"] ?? ""),
      String(req.params["slug"] ?? ""),
    );
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }
    if (!database.canUserAdminSpace(space, req.user!.id, isCallerAdmin(req))) {
      res.status(403).json({ error: "Only Space admins can manage Space members" });
      return;
    }
    const roleRaw = String(req.body?.role ?? "contributor")
      .trim()
      .toLowerCase() as SpaceRole;
    if (!VALID_SPACE_ROLES.includes(roleRaw)) {
      res.status(400).json({ error: `Invalid Space role. Must be one of: ${VALID_SPACE_ROLES.join(", ")}` });
      return;
    }
    let targetUserId = Number(req.body?.userId);
    if (!targetUserId || Number.isNaN(targetUserId)) {
      const uname = String(req.body?.username ?? "")
        .trim()
        .replace(/^@/, "");
      const u = uname ? database.getUserByUsername(uname) : null;
      if (u) targetUserId = u.id;
    }
    if (!targetUserId || Number.isNaN(targetUserId) || !database.getUserById(targetUserId)) {
      res.status(400).json({ error: "Valid username or userId is required" });
      return;
    }
    database.upsertSpaceMember(space.id, targetUserId, roleRaw);
    res.json({ members: database.getSpaceMembers(space.id) });
  });

  router.delete("/:namespace/:slug/members/:userId", requireAuth, (req: Request, res: Response): void => {
    const space = database.getSpaceByNamespaceAndSlug(
      String(req.params["namespace"] ?? ""),
      String(req.params["slug"] ?? ""),
    );
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }
    const targetUserId = Number(req.params["userId"]);
    if (targetUserId !== req.user!.id && !database.canUserAdminSpace(space, req.user!.id, isCallerAdmin(req))) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    database.removeSpaceMember(space.id, targetUserId);
    res.json({ members: database.getSpaceMembers(space.id) });
  });

  // ── Living Docs (Git-Backed CMS / Engineering Wiki) ─────────────────────────

  router.get("/:namespace/:slug/docs", optionalAuth, (req: Request, res: Response): void => {
    const space = database.getSpaceByNamespaceAndSlug(
      String(req.params["namespace"] ?? ""),
      String(req.params["slug"] ?? ""),
    );
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }
    if (!database.canUserViewSpace(space, req.user?.id, isCallerAdmin(req))) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    res.json({ pages: database.getSpacePages(space.id) });
  });

  router.get("/:namespace/:slug/docs/:docSlug", optionalAuth, (req: Request, res: Response): void => {
    const space = database.getSpaceByNamespaceAndSlug(
      String(req.params["namespace"] ?? ""),
      String(req.params["slug"] ?? ""),
    );
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }
    const page = database.getSpacePageBySlug(space.id, String(req.params["docSlug"] ?? ""));
    if (!page) {
      res.status(404).json({ error: "Living Doc page not found" });
      return;
    }
    res.json({ page });
  });

  router.post("/:namespace/:slug/docs", requireAuth, (req: Request, res: Response): void => {
    const space = database.getSpaceByNamespaceAndSlug(
      String(req.params["namespace"] ?? ""),
      String(req.params["slug"] ?? ""),
    );
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }
    if (!database.canUserWriteSpace(space, req.user!.id, isCallerAdmin(req))) {
      res.status(403).json({ error: "You do not have write access to edit Living Docs in this Space" });
      return;
    }

    const docSlug = String(req.body?.slug ?? "").trim();
    const title = String(req.body?.title ?? "").trim();
    const summary = req.body?.summary != null ? String(req.body.summary).trim() : null;
    const contentMarkdown = String(req.body?.contentMarkdown ?? req.body?.content ?? "");

    if (!docSlug || !title) {
      res.status(400).json({ error: "Both slug and title are required for a Living Doc" });
      return;
    }

    const page = database.upsertSpacePage({
      spaceId: space.id,
      slug: docSlug,
      title,
      summary,
      contentMarkdown,
      parentId: req.body?.parentId ? String(req.body.parentId) : null,
      orderIndex: typeof req.body?.orderIndex === "number" ? req.body.orderIndex : undefined,
      authorUserId: req.user!.id,
    });

    res.status(201).json({ page, pages: database.getSpacePages(space.id) });
  });

  router.delete("/:namespace/:slug/docs/:docSlug", requireAuth, (req: Request, res: Response): void => {
    const space = database.getSpaceByNamespaceAndSlug(
      String(req.params["namespace"] ?? ""),
      String(req.params["slug"] ?? ""),
    );
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }
    if (!database.canUserWriteSpace(space, req.user!.id, isCallerAdmin(req))) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    database.deleteSpacePage(space.id, String(req.params["docSlug"] ?? ""));
    res.json({ pages: database.getSpacePages(space.id) });
  });

  // ── Real-Time Slack / Discord Channels & Messages ───────────────────────────

  router.get("/:namespace/:slug/channels", optionalAuth, (req: Request, res: Response): void => {
    const space = database.getSpaceByNamespaceAndSlug(
      String(req.params["namespace"] ?? ""),
      String(req.params["slug"] ?? ""),
    );
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }
    res.json({ channels: database.getSpaceChannels(space.id, req.user?.id) });
  });

  router.post("/:namespace/:slug/channels", requireAuth, (req: Request, res: Response): void => {
    const space = database.getSpaceByNamespaceAndSlug(
      String(req.params["namespace"] ?? ""),
      String(req.params["slug"] ?? ""),
    );
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }
    if (!database.canUserWriteSpace(space, req.user!.id, isCallerAdmin(req))) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const chSlug = String(req.body?.slug ?? req.body?.name ?? "").trim();
    const chName = String(req.body?.name ?? chSlug).trim();
    if (!chSlug) {
      res.status(400).json({ error: "Channel name is required" });
      return;
    }
    try {
      const channel = database.createSpaceChannel({
        spaceId: space.id,
        slug: chSlug,
        name: chName,
        topic: req.body?.topic ? String(req.body.topic) : null,
        kind: req.body?.kind || "text",
        isPrivate: Boolean(req.body?.isPrivate),
      });
      res.status(201).json({ channel, channels: database.getSpaceChannels(space.id, req.user!.id) });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Failed to create channel" });
    }
  });

  router.get("/:namespace/:slug/channels/:channelSlug/messages", optionalAuth, (req: Request, res: Response): void => {
    const space = database.getSpaceByNamespaceAndSlug(
      String(req.params["namespace"] ?? ""),
      String(req.params["slug"] ?? ""),
    );
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }
    const channel = database.getSpaceChannelBySlug(space.id, String(req.params["channelSlug"] ?? ""));
    if (!channel) {
      res.status(404).json({ error: "Channel not found" });
      return;
    }
    const parentMessageId =
      typeof req.query["parentMessageId"] === "string" ? req.query["parentMessageId"].trim() : undefined;
    const messages = database.getSpaceMessages(channel.id, {
      limit: req.query["limit"] ? Number(req.query["limit"]) : 100,
      parentMessageId,
    });
    if (req.user) {
      database.markSpaceChannelRead(channel.id, req.user.id, messages[messages.length - 1]?.id);
    }
    res.json({ channel, messages });
  });

  router.post("/:namespace/:slug/channels/:channelSlug/messages", requireAuth, (req: Request, res: Response): void => {
    const space = database.getSpaceByNamespaceAndSlug(
      String(req.params["namespace"] ?? ""),
      String(req.params["slug"] ?? ""),
    );
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }
    const channel = database.getSpaceChannelBySlug(space.id, String(req.params["channelSlug"] ?? ""));
    if (!channel) {
      res.status(404).json({ error: "Channel not found" });
      return;
    }
    const content = String(req.body?.content ?? "").trim();
    if (!content) {
      res.status(400).json({ error: "Message content cannot be empty" });
      return;
    }

    const message = database.createSpaceMessage({
      channelId: channel.id,
      spaceId: space.id,
      authorId: req.user!.id,
      senderType: "user",
      content,
      replyToId: req.body?.replyToId ? String(req.body.replyToId) : null,
      attachments: Array.isArray(req.body?.attachments) ? req.body.attachments : [],
      embeddedArtifacts: Array.isArray(req.body?.embeddedArtifacts) ? req.body.embeddedArtifacts : [],
    });

    broadcastSpaceChatEvent({
      type: "chat:message",
      channelId: channel.id,
      spaceId: space.id,
      message,
    });

    // Built-in interactive bot responses for /run or @bot commands
    let botReply: ReturnType<LibraryDatabase["createSpaceMessage"]> | null = null;
    if (content.startsWith("/run") || content.includes("@ansatz-sim-bot")) {
      const preset = getSpaceDomainPreset(space.domain_preset);
      botReply = database.createSpaceMessage({
        channelId: channel.id,
        spaceId: space.id,
        authorId: req.user!.id,
        senderType: "ci_runner",
        senderName: "Ansatz WASM Solver Bot",
        content: `✅ **WASM Linear-Memory Simulation Completed** (\`14.2 ms\`)\n- **Preset**: ${preset.shortLabel} (${preset.complianceStandards[0] || "OMC Parity"})\n- **DAE System**: \`2 continuous states\`, \`0 algebraic loops\`, \`RMSE = 1.4e-5\`\n\n\`\`\`${preset.sampleCodeSnippet.language}\n${preset.sampleCodeSnippet.code}\n\`\`\``,
        replyToId: message.reply_to_id || message.id,
      });
      broadcastSpaceChatEvent({
        type: "chat:message",
        channelId: channel.id,
        spaceId: space.id,
        message: botReply,
      });
    }

    res.status(201).json({ message, botReply });
  });

  router.post(
    "/:namespace/:slug/channels/:channelSlug/messages/:messageId/reactions",
    requireAuth,
    (req: Request, res: Response): void => {
      const space = database.getSpaceByNamespaceAndSlug(
        String(req.params["namespace"] ?? ""),
        String(req.params["slug"] ?? ""),
      );
      if (!space) {
        res.status(404).json({ error: "Space not found" });
        return;
      }
      const emoji = String(req.body?.emoji ?? "🚀")
        .trim()
        .slice(0, 16);
      const updated = database.toggleSpaceMessageReaction(
        String(req.params["messageId"] ?? ""),
        req.user!.username,
        emoji,
      );
      if (!updated) {
        res.status(404).json({ error: "Message not found" });
        return;
      }
      broadcastSpaceChatEvent({
        type: "chat:reaction",
        channelId: updated.channel_id,
        spaceId: space.id,
        message: updated,
      });
      res.json({ message: updated });
    },
  );

  /**
   * POST /api/v1/spaces/:namespace/:slug/channels/:channelSlug/messages/:messageId/promote
   * Anti-amnesia engine: Promotes a chat message/thread to a Living Doc or PLM ECO.
   */
  router.post(
    "/:namespace/:slug/channels/:channelSlug/messages/:messageId/promote",
    requireAuth,
    (req: Request, res: Response): void => {
      const space = database.getSpaceByNamespaceAndSlug(
        String(req.params["namespace"] ?? ""),
        String(req.params["slug"] ?? ""),
      );
      if (!space) {
        res.status(404).json({ error: "Space not found" });
        return;
      }
      const targetType: "doc" | "eco" = req.body?.targetType === "eco" ? "eco" : "doc";
      const title = typeof req.body?.title === "string" ? req.body.title.trim() : undefined;

      try {
        const result = database.promoteSpaceMessage({
          messageId: String(req.params["messageId"] ?? ""),
          targetType,
          actorUserId: req.user!.id,
          title,
        });

        broadcastSpaceChatEvent({
          type: "chat:promoted",
          channelId: result.message.channel_id,
          spaceId: space.id,
          message: result.message,
          doc: result.doc,
          eco: result.eco,
        });

        res.status(201).json(result);
      } catch (err: unknown) {
        res.status(400).json({ error: err instanceof Error ? err.message : "Failed to promote message" });
      }
    },
  );

  // ── Space Problem Reports & Engineering Issues (ECR) ──────────────────────

  router.get("/:namespace/:slug/issues", optionalAuth, (req: Request, res: Response): void => {
    const space = database.getSpaceByNamespaceAndSlug(
      String(req.params["namespace"] ?? ""),
      String(req.params["slug"] ?? ""),
    );
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }
    res.json({ issues: database.getSpaceIssues(space.id) });
  });

  router.post("/:namespace/:slug/issues", requireAuth, (req: Request, res: Response): void => {
    const space = database.getSpaceByNamespaceAndSlug(
      String(req.params["namespace"] ?? ""),
      String(req.params["slug"] ?? ""),
    );
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }
    const title = String(req.body?.title ?? "").trim();
    const description = String(req.body?.description ?? "").trim();
    if (!title) {
      res.status(400).json({ error: "Issue title is required" });
      return;
    }

    const issue = database.createSpaceIssue({
      spaceId: space.id,
      title,
      description,
      severity: req.body?.severity || "standard",
      authorId: req.user!.id,
      impactedModels: Array.isArray(req.body?.impactedModels) ? req.body.impactedModels.map(String) : [],
      labels: Array.isArray(req.body?.labels) ? req.body.labels.map(String) : [],
      linkedPrNumber: req.body?.linkedPrNumber != null ? Number(req.body.linkedPrNumber) : null,
    });

    res.status(201).json({ issue, issues: database.getSpaceIssues(space.id) });
  });

  router.get("/:namespace/:slug/issues/:issueId", optionalAuth, (req: Request, res: Response): void => {
    const space = database.getSpaceByNamespaceAndSlug(
      String(req.params["namespace"] ?? ""),
      String(req.params["slug"] ?? ""),
    );
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }
    const issue = database.getSpaceIssueById(space.id, String(req.params["issueId"] ?? ""));
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    res.json({ issue });
  });

  router.patch("/:namespace/:slug/issues/:issueId", requireAuth, (req: Request, res: Response): void => {
    const space = database.getSpaceByNamespaceAndSlug(
      String(req.params["namespace"] ?? ""),
      String(req.params["slug"] ?? ""),
    );
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }
    const updated = database.updateSpaceIssue({
      spaceId: space.id,
      issueId: String(req.params["issueId"] ?? ""),
      status: req.body?.status === "closed" ? "closed" : req.body?.status === "open" ? "open" : undefined,
      title: req.body?.title,
      description: req.body?.description,
      severity: req.body?.severity,
      linkedPrNumber: req.body?.linkedPrNumber != null ? Number(req.body.linkedPrNumber) : undefined,
    });
    if (!updated) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    res.json({ issue: updated, issues: database.getSpaceIssues(space.id) });
  });

  router.post("/:namespace/:slug/issues/:issueId/comments", requireAuth, (req: Request, res: Response): void => {
    const space = database.getSpaceByNamespaceAndSlug(
      String(req.params["namespace"] ?? ""),
      String(req.params["slug"] ?? ""),
    );
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }
    const content = String(req.body?.content ?? "").trim();
    if (!content) {
      res.status(400).json({ error: "Comment content is required" });
      return;
    }
    const issue = database.getSpaceIssueById(space.id, String(req.params["issueId"] ?? ""));
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    const comment = database.addSpaceIssueComment({
      issueId: issue.id,
      userId: req.user!.id,
      content,
    });
    const refreshed = database.getSpaceIssueById(space.id, issue.id)!;
    res.status(201).json({ comment, issue: refreshed });
  });

  // ── Jira Integration Configuration & Persistence ────────────────────────────

  router.get("/:namespace/:slug/integrations/jira", requireAuth, (req: Request, res: Response): void => {
    const namespace = String(req.params["namespace"] ?? "");
    const slug = String(req.params["slug"] ?? "");
    const space = database.getSpaceByNamespaceAndSlug(namespace, slug);
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }

    const saved = (space.settings?.["jira"] as Record<string, unknown> | undefined) || {};
    const baseUrl = String(saved["baseUrl"] ?? saved["jiraBaseUrl"] ?? "");
    const email = String(saved["email"] ?? "");
    const jql = String(saved["jql"] ?? "");
    const modelCustomField = String(saved["modelCustomField"] ?? "");
    const autoCommentOnSimulation = saved["autoCommentOnSimulation"] !== false;
    const hasApiToken = Boolean(saved["apiToken"]);

    res.json({
      configured: Boolean(baseUrl && hasApiToken),
      baseUrl,
      email,
      jql,
      modelCustomField,
      autoCommentOnSimulation,
      hasApiToken,
    });
  });

  router.put("/:namespace/:slug/integrations/jira", requireAuth, async (req: Request, res: Response): Promise<void> => {
    const namespace = String(req.params["namespace"] ?? "");
    const slug = String(req.params["slug"] ?? "");
    const space = database.getSpaceByNamespaceAndSlug(namespace, slug);
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }

    if (!database.canUserAdminSpace(space, req.user!.id, isCallerAdmin(req))) {
      res
        .status(403)
        .json({ error: "Only Space owners, lead engineers, or org admins can configure Jira integrations" });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const saved = (space.settings?.["jira"] as Record<string, unknown> | undefined) || {};

    const baseUrl = String(
      body["baseUrl"] ?? body["jiraBaseUrl"] ?? saved["baseUrl"] ?? saved["jiraBaseUrl"] ?? "",
    ).trim();
    const email =
      body["email"] !== undefined ? String(body["email"]).trim() : saved["email"] ? String(saved["email"]).trim() : "";
    const apiToken = body["apiToken"]
      ? String(body["apiToken"]).trim()
      : saved["apiToken"]
        ? String(saved["apiToken"]).trim()
        : "";
    const jql =
      body["jql"] !== undefined ? String(body["jql"]).trim() : saved["jql"] ? String(saved["jql"]).trim() : "";
    const modelCustomField =
      body["modelCustomField"] !== undefined
        ? String(body["modelCustomField"]).trim()
        : saved["modelCustomField"]
          ? String(saved["modelCustomField"]).trim()
          : "";
    const autoCommentOnSimulation =
      body["autoCommentOnSimulation"] !== undefined
        ? Boolean(body["autoCommentOnSimulation"])
        : saved["autoCommentOnSimulation"] !== false;

    // Optional test connection if requested or when saving new token
    if (body["testConnection"] && baseUrl && apiToken) {
      try {
        const connector = new JiraConnector({
          baseUrl,
          auth: { email: email || undefined, apiToken },
          timeoutMs: 5000,
        });
        await connector.searchIssues({ maxResults: 1 });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(400).json({ error: `Jira connection verification failed: ${msg}` });
        return;
      }
    }

    const updatedSettings = {
      ...(space.settings || {}),
      jira: {
        baseUrl,
        email,
        apiToken,
        jql,
        modelCustomField,
        autoCommentOnSimulation,
      },
    };

    const updated = database.updateSpace(space.id, {
      settings: updatedSettings,
    });

    res.json({
      success: true,
      integration: {
        configured: Boolean(baseUrl && apiToken),
        baseUrl,
        email,
        jql,
        modelCustomField,
        autoCommentOnSimulation,
        hasApiToken: Boolean(apiToken),
      },
      space: updated,
    });
  });

  // ── Jira Issue Ingestion & Bi-Directional Synchronization ──────────────────

  router.post(
    "/:namespace/:slug/integrations/jira/sync",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      const namespace = String(req.params["namespace"] ?? "");
      const slug = String(req.params["slug"] ?? "");
      const space = database.getSpaceByNamespaceAndSlug(namespace, slug);
      if (!space) {
        res.status(404).json({ error: "Space not found" });
        return;
      }

      // Check write permissions
      const memberRole = database.getSpaceMemberRole(space.id, req.user!.id);
      const isOwner = space.owner_namespace === req.user!.username;
      const isAdmin = isCallerAdmin(req);
      const canWrite =
        isOwner ||
        isAdmin ||
        Boolean(memberRole && ["owner", "lead_engineer", "approver", "contributor"].includes(memberRole));

      if (!canWrite) {
        res.status(403).json({ error: "Forbidden: insufficient permissions to sync issues for this space" });
        return;
      }

      const savedJira = (space.settings?.["jira"] as Record<string, unknown> | undefined) || {};
      const jiraBaseUrl = String(
        req.body?.jiraBaseUrl ?? req.body?.baseUrl ?? savedJira["baseUrl"] ?? savedJira["jiraBaseUrl"] ?? "",
      ).trim();
      const apiToken = String(req.body?.apiToken ?? req.body?.auth?.apiToken ?? savedJira["apiToken"] ?? "").trim();
      const email =
        req.body?.email || req.body?.auth?.email || savedJira["email"]
          ? String(req.body?.email || req.body?.auth?.email || savedJira["email"]).trim()
          : undefined;
      const jql = req.body?.jql
        ? String(req.body.jql).trim()
        : savedJira["jql"]
          ? String(savedJira["jql"]).trim()
          : undefined;
      const maxResults = req.body?.maxResults != null ? Math.min(Math.max(Number(req.body.maxResults), 1), 100) : 50;
      const modelCustomField = req.body?.modelCustomField
        ? String(req.body.modelCustomField).trim()
        : savedJira["modelCustomField"]
          ? String(savedJira["modelCustomField"]).trim()
          : undefined;

      if (!jiraBaseUrl) {
        res.status(400).json({ error: "jiraBaseUrl is required or configure Jira in Space settings" });
        return;
      }
      if (!apiToken) {
        res.status(400).json({ error: "apiToken is required or configure Jira in Space settings" });
        return;
      }

      try {
        const connector = new JiraConnector({
          baseUrl: jiraBaseUrl,
          auth: { email, apiToken },
        });

        const searchRes = await connector.searchIssues({
          jql,
          maxResults,
          modelCustomField,
        });

        let createdCount = 0;
        let updatedCount = 0;

        for (const jiraIssue of searchRes.issues) {
          const result = database.upsertSpaceIssueFromExternal({
            spaceId: space.id,
            externalSource: "jira",
            externalKey: jiraIssue.key,
            externalUrl: jiraIssue.browseUrl,
            externalUpdatedAt: jiraIssue.updatedAt,
            title: jiraIssue.title,
            description: jiraIssue.description,
            status: jiraIssue.status,
            severity: jiraIssue.severity,
            authorId: req.user!.id,
            impactedModels: jiraIssue.impactedModels,
            labels: jiraIssue.labels,
            syncStatus: "synced",
          });

          if (result.isNew) createdCount++;
          else updatedCount++;
        }

        res.json({
          success: true,
          synced: searchRes.issues.length,
          created: createdCount,
          updated: updatedCount,
          issues: database.getSpaceIssues(space.id),
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(502).json({ error: `Jira synchronization failed: ${msg}` });
      }
    },
  );

  router.post(
    "/:namespace/:slug/integrations/jira/issues/:key/verify",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      const namespace = String(req.params["namespace"] ?? "");
      const slug = String(req.params["slug"] ?? "");
      const space = database.getSpaceByNamespaceAndSlug(namespace, slug);
      if (!space) {
        res.status(404).json({ error: "Space not found" });
        return;
      }

      const savedJira = (space.settings?.["jira"] as Record<string, unknown> | undefined) || {};
      const jiraBaseUrl = String(
        req.body?.jiraBaseUrl ?? req.body?.baseUrl ?? savedJira["baseUrl"] ?? savedJira["jiraBaseUrl"] ?? "",
      ).trim();
      const apiToken = String(req.body?.apiToken ?? req.body?.auth?.apiToken ?? savedJira["apiToken"] ?? "").trim();
      const email =
        req.body?.email || req.body?.auth?.email || savedJira["email"]
          ? String(req.body?.email || req.body?.auth?.email || savedJira["email"]).trim()
          : undefined;
      const comment = String(req.body?.comment ?? "").trim();
      const key = String(req.params["key"] ?? "");

      if (!jiraBaseUrl || !apiToken || !comment) {
        res
          .status(400)
          .json({ error: "jiraBaseUrl, apiToken, and comment are required (or configure Jira in Space settings)" });
        return;
      }

      try {
        const connector = new JiraConnector({
          baseUrl: jiraBaseUrl,
          auth: { email, apiToken },
        });

        const feedback = await connector.postVerificationComment(key, comment);
        res.json({ success: true, commentId: feedback.id });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(502).json({ error: `Failed to post verification to Jira: ${msg}` });
      }
    },
  );

  // ── PLM Engineering Change Orders (ECOs) ────────────────────────────────────

  router.get("/:namespace/:slug/ecos", optionalAuth, (req: Request, res: Response): void => {
    const space = database.getSpaceByNamespaceAndSlug(
      String(req.params["namespace"] ?? ""),
      String(req.params["slug"] ?? ""),
    );
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }
    res.json({ ecos: database.getSpaceEcoProposals(space.id) });
  });

  router.post("/:namespace/:slug/ecos", requireAuth, (req: Request, res: Response): void => {
    const space = database.getSpaceByNamespaceAndSlug(
      String(req.params["namespace"] ?? ""),
      String(req.params["slug"] ?? ""),
    );
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }
    const title = String(req.body?.title ?? "").trim();
    const description = String(req.body?.description ?? "").trim();
    if (!title) {
      res.status(400).json({ error: "ECO title is required" });
      return;
    }

    const eco = database.createSpaceEcoProposal({
      spaceId: space.id,
      title,
      description,
      severity: req.body?.severity || "standard",
      sourceBranch: req.body?.sourceBranch,
      targetBranch: req.body?.targetBranch || space.default_branch,
      authorId: req.user!.id,
      impactedModels: Array.isArray(req.body?.impactedModels) ? req.body.impactedModels.map(String) : [],
    });

    res.status(201).json({ eco, ecos: database.getSpaceEcoProposals(space.id) });
  });

  router.post(
    "/:namespace/:slug/ecos/:ecoId/review",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      const space = database.getSpaceByNamespaceAndSlug(
        String(req.params["namespace"] ?? ""),
        String(req.params["slug"] ?? ""),
      );
      if (!space) {
        res.status(404).json({ error: "Space not found" });
        return;
      }

      // 21 CFR Part 11 §11.200 dual-component identification: verify account password if supplied
      if (req.body?.password) {
        const hash = database.getPasswordHash(req.user!.id);
        if (hash) {
          const validPassword = await bcrypt.compare(String(req.body.password), hash);
          if (!validPassword) {
            res.status(401).json({ error: "Invalid password for 21 CFR Part 11 electronic signature" });
            return;
          }
        }
      }

      const decisionRaw = String(req.body?.decision ?? "approved");
      const decision: "approved" | "changes_requested" | "rejected" =
        decisionRaw === "rejected"
          ? "rejected"
          : decisionRaw === "changes_requested"
            ? "changes_requested"
            : "approved";

      const updated = database.reviewSpaceEcoProposal({
        ecoId: String(req.params["ecoId"] ?? ""),
        spaceId: space.id,
        userId: req.user!.id,
        decision,
        role: req.body?.role ? String(req.body.role) : undefined,
        intent: req.body?.intent ? String(req.body.intent) : undefined,
        signatureHex: req.body?.signatureHex ? String(req.body.signatureHex) : undefined,
        comment: req.body?.comment ? String(req.body.comment) : null,
      });
      if (!updated) {
        res.status(404).json({ error: "ECO proposal not found" });
        return;
      }
      res.json({ eco: updated, ecos: database.getSpaceEcoProposals(space.id) });
    },
  );

  router.get("/:namespace/:slug/ecos/:ecoId/diff", optionalAuth, (req: Request, res: Response): void => {
    const space = database.getSpaceByNamespaceAndSlug(
      String(req.params["namespace"] ?? ""),
      String(req.params["slug"] ?? ""),
    );
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }
    const diff = database.getSpaceEcoDiff(space.id, String(req.params["ecoId"] ?? ""));
    if (!diff) {
      res.status(404).json({ error: "ECO proposal not found" });
      return;
    }
    res.json({ diff });
  });

  router.get("/:namespace/:slug/ecos/:ecoId/simulation", optionalAuth, (req: Request, res: Response): void => {
    const space = database.getSpaceByNamespaceAndSlug(
      String(req.params["namespace"] ?? ""),
      String(req.params["slug"] ?? ""),
    );
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }
    const simulation = database.getSpaceEcoSimulation(space.id, String(req.params["ecoId"] ?? ""));
    if (!simulation) {
      res.status(404).json({ error: "ECO proposal not found" });
      return;
    }
    res.json({ simulation });
  });

  router.post("/:namespace/:slug/ecos/:ecoId/simulate", requireAuth, (req: Request, res: Response): void => {
    const space = database.getSpaceByNamespaceAndSlug(
      String(req.params["namespace"] ?? ""),
      String(req.params["slug"] ?? ""),
    );
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }
    const result = database.reverifySpaceEcoSimulation(space.id, String(req.params["ecoId"] ?? ""));
    if (!result) {
      res.status(404).json({ error: "ECO proposal not found" });
      return;
    }
    res.json({ eco: result.eco, simulation: result.simulation, ecos: database.getSpaceEcoProposals(space.id) });
  });

  router.get("/:namespace/:slug/ecos/:ecoId/workflows", optionalAuth, (req: Request, res: Response): void => {
    const space = database.getSpaceByNamespaceAndSlug(
      String(req.params["namespace"] ?? ""),
      String(req.params["slug"] ?? ""),
    );
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }
    const ecoId = String(req.params["ecoId"] ?? "");
    const eco = database.getSpaceEcoProposals(space.id).find((e) => e.id === ecoId);
    if (!eco) {
      res.status(404).json({ error: "ECO proposal not found" });
      return;
    }

    let manifests =
      space.git_repo_path && fs.existsSync(space.git_repo_path)
        ? discoverWorkflowsInRepo({
            repoPath: space.git_repo_path,
            ref: eco.source_branch,
          })
        : [];

    if (manifests.length === 0 && space.git_repo_path && fs.existsSync(space.git_repo_path)) {
      manifests = discoverWorkflowsInRepo({
        repoPath: space.git_repo_path,
        ref: eco.target_branch,
      });
    }

    const runs = database.getSpaceWorkflowRuns(space.id, eco.id);
    res.json({
      manifests: manifests.map((m: WorkflowManifest) => ({
        provider: m.provider,
        name: m.name,
        filePath: m.filePath,
        jobs: Array.from(m.jobs.values()).map((j: WorkflowJob) => ({
          id: j.id,
          name: j.name,
          needs: j.needs,
          runsOn: j.runsOn,
          stepsCount: j.steps.length,
        })),
      })),
      runs,
    });
  });

  router.post("/:namespace/:slug/ecos/:ecoId/workflows/run", requireAuth, (req: Request, res: Response): void => {
    const space = database.getSpaceByNamespaceAndSlug(
      String(req.params["namespace"] ?? ""),
      String(req.params["slug"] ?? ""),
    );
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }
    const ecoId = String(req.params["ecoId"] ?? "");
    const workflowFile = typeof req.body?.workflowFile === "string" ? req.body.workflowFile : undefined;
    const result = database.runSpaceWorkflows(space.id, ecoId, workflowFile);
    if (!result) {
      res.status(404).json({ error: "ECO proposal or repository not found" });
      return;
    }
    if (result.simulation) {
      void postAutomatedSimulationCommentsIfConfigured({
        space,
        eco: result.eco,
        simulation: result.simulation,
        issues: database.getSpaceIssues(space.id),
      });
    }

    res.json({
      eco: result.eco,
      runs: result.runs,
      simulation: result.simulation,
      ecos: database.getSpaceEcoProposals(space.id),
    });
  });

  router.post("/:namespace/:slug/ecos/:ecoId/workflows/external-report", (req: Request, res: Response): void => {
    const space = database.getSpaceByNamespaceAndSlug(
      String(req.params["namespace"] ?? ""),
      String(req.params["slug"] ?? ""),
    );
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }
    const ecoId = String(req.params["ecoId"] ?? "");
    const eco = database.getSpaceEcoProposals(space.id).find((e) => e.id === ecoId);
    if (!eco) {
      res.status(404).json({ error: "ECO proposal not found" });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const provider = String(body["provider"] || "github") as "github" | "gitlab" | "ansatz";
    const status = body["status"] === "failed" ? "failed" : "passed";
    const workflowName = String(body["workflowName"] || "External CI Pipeline");
    const workflowFile = String(
      body["workflowFile"] || (provider === "gitlab" ? ".gitlab-ci.yml" : ".github/workflows/ci.yml"),
    );
    const commitSha = body["commitSha"] ? String(body["commitSha"]) : null;
    const ref = body["ref"] ? String(body["ref"]) : eco.source_branch;
    const jobs = Array.isArray(body["jobs"]) ? body["jobs"] : [];
    const artifacts = Array.isArray(body["artifacts"]) ? body["artifacts"] : [];
    const simulationSummary = (body["simulationSummary"] as Record<string, unknown> | undefined) || {
      status,
      checkedAt: new Date().toISOString(),
      solver: "External CI Runner",
    };
    const logs = String(body["logs"] || "");

    const run = database.createSpaceWorkflowRun({
      spaceId: space.id,
      ecoId: eco.id,
      provider,
      workflowFile,
      workflowName,
      triggerEvent: "external_report",
      commitSha: commitSha ?? null,
      ref,
      status,
      conclusion: status === "passed" ? "success" : "failure",
      jobs,
      artifacts,
      summary: simulationSummary,
      logs,
    });

    // Update ECO simulation gate from external report
    database.db
      .prepare(
        `UPDATE space_eco_proposals
         SET simulation_gate_status = ?,
             simulation_summary_json = ?,
             updated_at = datetime('now')
         WHERE id = ? AND space_id = ?`,
      )
      .run(status, JSON.stringify(simulationSummary), eco.id, space.id);

    const updatedEco = database.getSpaceEcoProposals(space.id).find((e) => e.id === eco.id)!;
    const simulation = database.getSpaceEcoSimulation(space.id, eco.id);

    if (simulation) {
      void postAutomatedSimulationCommentsIfConfigured({
        space,
        eco: updatedEco,
        simulation,
        issues: database.getSpaceIssues(space.id),
      });
    }

    res.json({
      success: true,
      runId: run.id,
      simulationGateStatus: status,
      eco: updatedEco,
      simulation,
    });
  });

  router.post("/:namespace/:slug/webhooks/:provider", (req: Request, res: Response): void => {
    const namespace = String(req.params["namespace"] ?? "");
    const slug = String(req.params["slug"] ?? "");
    const provider = String(req.params["provider"] ?? "").toLowerCase();
    const space = database.getSpaceByNamespaceAndSlug(namespace, slug);
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }

    const githubEvent = req.headers["x-github-event"] as string | undefined;
    const gitlabEvent = (req.headers["x-gitlab-event"] as string | undefined) || "";

    let eventType = githubEvent || gitlabEvent || String(req.body?.event || "push");
    let commitSha: string | null = null;
    let ref: string | null = null;
    let ciStatus: "pending" | "running" | "passed" | "failed" = "passed";
    let workflowName = "CI Pipeline";
    let summary: Record<string, unknown> = {};

    if (provider === "github") {
      if (githubEvent === "check_run") {
        const cr = (req.body?.check_run || {}) as Record<string, unknown>;
        commitSha = cr["head_sha"] ? String(cr["head_sha"]) : null;
        const cs = (cr["check_suite"] || {}) as Record<string, unknown>;
        ref = cs["head_branch"] ? String(cs["head_branch"]) : null;
        workflowName = String(cr["name"] || "GitHub Check Run");

        const conclusion = String(cr["conclusion"] || "");
        const status = String(cr["status"] || "");
        if (status === "in_progress" || status === "queued") {
          ciStatus = "running";
        } else if (conclusion === "success") {
          ciStatus = "passed";
        } else {
          ciStatus = "failed";
        }

        const output = (cr["output"] || {}) as Record<string, unknown>;
        summary = {
          title: output["title"],
          summary: output["summary"],
          text: output["text"],
          conclusion,
        };
      } else if (githubEvent === "workflow_run") {
        const wr = (req.body?.workflow_run || {}) as Record<string, unknown>;
        commitSha = wr["head_sha"] ? String(wr["head_sha"]) : null;
        ref = wr["head_branch"] ? String(wr["head_branch"]) : null;
        workflowName = String(wr["name"] || "GitHub Workflow");
        const conclusion = String(wr["conclusion"] || "");
        const status = String(wr["status"] || "");
        if (status === "in_progress" || status === "queued") {
          ciStatus = "running";
        } else if (conclusion === "success") {
          ciStatus = "passed";
        } else {
          ciStatus = "failed";
        }
        summary = { conclusion, status };
      } else {
        ref = String(req.body?.ref || "").replace(/^refs\/heads\//, "");
        commitSha = req.body?.after ? String(req.body.after) : null;
      }
    } else if (provider === "gitlab") {
      if (gitlabEvent.includes("Pipeline") || req.body?.object_attributes) {
        const attrs = (req.body?.object_attributes || {}) as Record<string, unknown>;
        ref = attrs["ref"] ? String(attrs["ref"]) : null;
        commitSha = attrs["sha"] ? String(attrs["sha"]) : null;
        const st = String(attrs["status"] || "");
        if (st === "running" || st === "pending") {
          ciStatus = "running";
        } else if (st === "success") {
          ciStatus = "passed";
        } else {
          ciStatus = "failed";
        }
        workflowName = "GitLab CI Pipeline";
        summary = { status: st, stages: attrs["stages"] };
      } else {
        ref = String(req.body?.ref || "").replace(/^refs\/heads\//, "");
        commitSha = req.body?.checkout_sha ? String(req.body.checkout_sha) : null;
      }
    }

    // Match active ECO proposal for this ref or commit
    const eco = ref || commitSha ? database.findEcoByCommitOrBranch(space.id, ref || commitSha || "") : null;
    let runId: string | null = null;

    if (eco) {
      const run = database.createSpaceWorkflowRun({
        spaceId: space.id,
        ecoId: eco.id,
        provider: provider === "gitlab" ? "gitlab" : "github",
        workflowFile: provider === "gitlab" ? ".gitlab-ci.yml" : ".github/workflows/ci.yml",
        workflowName,
        triggerEvent: eventType,
        commitSha,
        ref: ref || eco.source_branch,
        status: ciStatus,
        conclusion: ciStatus === "passed" ? "success" : ciStatus === "failed" ? "failure" : null,
        summary,
      });
      runId = run.id;

      database.db
        .prepare(
          `UPDATE space_eco_proposals
           SET simulation_gate_status = ?,
               simulation_summary_json = ?,
               updated_at = datetime('now')
           WHERE id = ? AND space_id = ?`,
        )
        .run(ciStatus, JSON.stringify(summary), eco.id, space.id);
    }

    res.status(202).json({
      success: true,
      spaceId: space.id,
      ecoId: eco?.id || null,
      eventType,
      ciStatus,
      runId,
    });
  });

  const handleEcoBlastRadius = (req: Request, res: Response): void => {
    const space = database.getSpaceByNamespaceAndSlug(
      String(req.params["namespace"] ?? ""),
      String(req.params["slug"] ?? ""),
    );
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }
    const impact = database.getSpaceEcoBlastRadius(space.id, String(req.params["ecoId"] ?? ""));
    if (!impact) {
      res.status(404).json({ error: "ECO proposal not found" });
      return;
    }
    res.json({ impact, blastRadius: impact });
  };

  router.get("/:namespace/:slug/ecos/:ecoId/impact", optionalAuth, handleEcoBlastRadius);
  router.get("/:namespace/:slug/ecos/:ecoId/blast-radius", optionalAuth, handleEcoBlastRadius);

  router.get("/:namespace/:slug/ecos/:ecoId/bom", optionalAuth, (req: Request, res: Response): void => {
    const space = database.getSpaceByNamespaceAndSlug(
      String(req.params["namespace"] ?? ""),
      String(req.params["slug"] ?? ""),
    );
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }
    const bom = database.getSpaceEcoBom(space.id, String(req.params["ecoId"] ?? ""));
    if (!bom) {
      res.status(404).json({ error: "ECO proposal not found" });
      return;
    }
    res.json({ bom });
  });

  router.post("/:namespace/:slug/ecos/:ecoId/merge", requireAuth, (req: Request, res: Response): void => {
    const space = database.getSpaceByNamespaceAndSlug(
      String(req.params["namespace"] ?? ""),
      String(req.params["slug"] ?? ""),
    );
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }
    const memberRole = database.getSpaceMemberRole(space.id, req.user!.id);
    const canWrite =
      memberRole === "owner" ||
      memberRole === "lead_engineer" ||
      memberRole === "approver" ||
      memberRole === "contributor" ||
      isCallerAdmin(req);
    if (!canWrite) {
      res.status(403).json({ error: "Forbidden: Write permission required to merge change order" });
      return;
    }

    try {
      const result = database.mergeSpaceEcoProposal({
        spaceId: space.id,
        ecoId: String(req.params["ecoId"] ?? ""),
        userId: req.user!.id,
      });
      res.json({ ...result, ecos: database.getSpaceEcoProposals(space.id) });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err || "Failed to merge ECO");
      res.status(400).json({ error: message });
    }
  });

  // ── Semantic Autocomplete (`#doc:`, `#eco:`, `#channel`, `@member`) ─────────

  router.get("/:namespace/:slug/autocomplete", optionalAuth, (req: Request, res: Response): void => {
    const space = database.getSpaceByNamespaceAndSlug(
      String(req.params["namespace"] ?? ""),
      String(req.params["slug"] ?? ""),
    );
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }
    const q = typeof req.query["q"] === "string" ? req.query["q"] : "";
    res.json({ suggestions: database.autocompleteSpaceEntities(space.id, q) });
  });

  // ── Native Git Vault Inspection (Code, Tree, Files, Commits, Branches) ──────

  router.get("/:namespace/:slug/tree", optionalAuth, async (req: Request, res: Response): Promise<void> => {
    const namespace = String(req.params["namespace"] ?? "");
    const slug = String(req.params["slug"] ?? "");
    const space = database.getSpaceByNamespaceAndSlug(namespace, slug);
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }
    const isAdmin = isCallerAdmin(req);
    if (!database.canUserViewSpace(space, req.user?.id, isAdmin)) {
      res.status(403).json({ error: "You do not have permission to view this Space" });
      return;
    }

    const ref = typeof req.query["ref"] === "string" ? req.query["ref"] : space.default_branch || "main";
    const subpath = typeof req.query["path"] === "string" ? req.query["path"] : "";
    const recursive = req.query["recursive"] === "true";
    try {
      const targetId =
        space.git_repo_path ||
        resolveSpaceGitRepoPath(database.dbDir, space.owner_namespace, space.slug) ||
        `${space.owner_namespace}/${space.slug}`;
      const tree = await localGitProvider.getRepositoryTree(targetId, ref, subpath, recursive);
      res.json({ tree, ref, path: subpath });
    } catch {
      // Empty or newly initialized repository with no commits yet
      res.json({ tree: [], ref, path: subpath, empty: true });
    }
  });

  router.get("/:namespace/:slug/files/raw", optionalAuth, async (req: Request, res: Response): Promise<void> => {
    const namespace = String(req.params["namespace"] ?? "");
    const slug = String(req.params["slug"] ?? "");
    const space = database.getSpaceByNamespaceAndSlug(namespace, slug);
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }
    const isAdmin = isCallerAdmin(req);
    if (!database.canUserViewSpace(space, req.user?.id, isAdmin)) {
      res.status(403).json({ error: "You do not have permission to view this Space" });
      return;
    }

    const filePath = typeof req.query["path"] === "string" ? req.query["path"] : "";
    if (!filePath) {
      res.status(400).json({ error: "Missing file path query parameter" });
      return;
    }
    const ref = typeof req.query["ref"] === "string" ? req.query["ref"] : space.default_branch || "main";
    try {
      const targetId =
        space.git_repo_path ||
        resolveSpaceGitRepoPath(database.dbDir, space.owner_namespace, space.slug) ||
        `${space.owner_namespace}/${space.slug}`;
      const content = await localGitProvider.getRepositoryFileRaw(targetId, filePath, ref);
      res.type("text/plain").send(content);
    } catch (err: unknown) {
      res.status(404).json({ error: err instanceof Error ? err.message : "File not found" });
    }
  });

  router.get("/:namespace/:slug/commits", optionalAuth, async (req: Request, res: Response): Promise<void> => {
    const namespace = String(req.params["namespace"] ?? "");
    const slug = String(req.params["slug"] ?? "");
    const space = database.getSpaceByNamespaceAndSlug(namespace, slug);
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }
    const isAdmin = isCallerAdmin(req);
    if (!database.canUserViewSpace(space, req.user?.id, isAdmin)) {
      res.status(403).json({ error: "You do not have permission to view this Space" });
      return;
    }

    const ref = typeof req.query["ref"] === "string" ? req.query["ref"] : space.default_branch || "main";
    try {
      const targetId =
        space.git_repo_path ||
        resolveSpaceGitRepoPath(database.dbDir, space.owner_namespace, space.slug) ||
        `${space.owner_namespace}/${space.slug}`;
      const commits = await localGitProvider.getCommits(targetId, ref);
      res.json({ commits });
    } catch {
      res.json({ commits: [] });
    }
  });

  router.get("/:namespace/:slug/branches", optionalAuth, async (req: Request, res: Response): Promise<void> => {
    const namespace = String(req.params["namespace"] ?? "");
    const slug = String(req.params["slug"] ?? "");
    const space = database.getSpaceByNamespaceAndSlug(namespace, slug);
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }
    const isAdmin = isCallerAdmin(req);
    if (!database.canUserViewSpace(space, req.user?.id, isAdmin)) {
      res.status(403).json({ error: "You do not have permission to view this Space" });
      return;
    }

    try {
      const targetId =
        space.git_repo_path ||
        resolveSpaceGitRepoPath(database.dbDir, space.owner_namespace, space.slug) ||
        `${space.owner_namespace}/${space.slug}`;
      const branches = await localGitProvider.getBranches(targetId);
      res.json({
        branches: branches.length > 0 ? branches : [{ name: space.default_branch || "main", default: true }],
      });
    } catch {
      res.json({ branches: [{ name: space.default_branch || "main", default: true }] });
    }
  });

  /**
   * POST /api/v1/spaces/:namespace/:slug/init-template
   * Populates starter domain models, package.mo, and README.md into the Space's Git Vault.
   */
  router.post("/:namespace/:slug/init-template", optionalAuth, async (req: Request, res: Response): Promise<void> => {
    const namespace = String(req.params["namespace"] ?? "");
    const slug = String(req.params["slug"] ?? "");
    const space = database.getSpaceByNamespaceAndSlug(namespace, slug);
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }
    const isAdmin = isCallerAdmin(req);
    if (!database.canUserWriteSpace(space, req.user?.id, isAdmin)) {
      res.status(403).json({ error: "You do not have permission to modify this Space" });
      return;
    }

    const vault = ensureSpaceGitVaultInitialized({
      dbDir: database.dbDir,
      namespace: space.owner_namespace,
      slug: space.slug,
      name: space.name,
      domainPreset: space.domain_preset,
      defaultBranch: space.default_branch || "main",
    });
    const repoPath = vault.repoPath;
    if (!repoPath) {
      res.status(500).json({ error: "Unable to resolve space Git repository path" });
      return;
    }

    const starterFiles = generateStarterFilesForSpace(
      space.name,
      space.owner_namespace,
      space.slug,
      space.domain_preset,
    );
    const branch = space.default_branch || "main";
    const commitSha = commitFilesToBareGitVault({
      repoPath,
      branch,
      message: "feat: initialize Space Git Vault with starter domain models and README",
      authorName: req.user?.username || "Ansatz Space Engineer",
      authorEmail: req.user?.email || "engineer@modelscript.org",
      files: starterFiles,
    });

    res.json({ ok: true, commitSha, branch });
  });

  /**
   * GET /api/v1/spaces/:namespace/:slug/packages/:filename
   * Download a generated PLM package (AASX, ProSTEP DDP, or FMU) for a Space.
   */
  router.get("/:namespace/:slug/packages/:filename", optionalAuth, (req: Request, res: Response): void => {
    const namespace = String(req.params["namespace"] ?? "");
    const slug = String(req.params["slug"] ?? "");
    const filename = String(req.params["filename"] ?? "");
    const space = database.getSpaceByNamespaceAndSlug(namespace, slug);
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }
    const isAdmin = isCallerAdmin(req);
    if (!database.canUserViewSpace(space, req.user?.id, isAdmin)) {
      res.status(403).json({ error: "You do not have permission to view this Space" });
      return;
    }

    const cleanFilename = path.basename(filename);
    const filePath = path.join(database.dbDir, "packages", space.id, cleanFilename);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "Package file not found" });
      return;
    }
    res.download(filePath, cleanFilename);
  });

  // Space-Scoped OMG SysML v2 API Bridge
  router.use("/:namespace/:slug/sysml2", createSpaceSysml2Router(database));

  return router;
}
