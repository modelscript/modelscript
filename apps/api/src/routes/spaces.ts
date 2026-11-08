// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import type { LibraryDatabase, SpaceOwnerType, SpaceRole, SpaceVisibility } from "../database.js";
import { optionalAuth, requireAuth } from "../middleware/auth-middleware.js";
import { defaultApiLimiter } from "../middleware/rate-limiter.js";
import { getSpaceDomainPreset, listSpaceDomainPresets } from "../services/spaces/domain-presets.js";
import { broadcastSpaceChatEvent } from "./collab-ws.js";

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

  router.post("/:namespace/:slug/ecos/:ecoId/review", requireAuth, (req: Request, res: Response): void => {
    const space = database.getSpaceByNamespaceAndSlug(
      String(req.params["namespace"] ?? ""),
      String(req.params["slug"] ?? ""),
    );
    if (!space) {
      res.status(404).json({ error: "Space not found" });
      return;
    }
    const decisionRaw = String(req.body?.decision ?? "approved");
    const decision: "approved" | "changes_requested" | "rejected" =
      decisionRaw === "rejected" ? "rejected" : decisionRaw === "changes_requested" ? "changes_requested" : "approved";

    const updated = database.reviewSpaceEcoProposal({
      ecoId: String(req.params["ecoId"] ?? ""),
      spaceId: space.id,
      userId: req.user!.id,
      decision,
      comment: req.body?.comment ? String(req.body.comment) : null,
    });
    if (!updated) {
      res.status(404).json({ error: "ECO proposal not found" });
      return;
    }
    res.json({ eco: updated, ecos: database.getSpaceEcoProposals(space.id) });
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

  return router;
}
