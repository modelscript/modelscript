// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import type { LibraryDatabase, OrgRole } from "../database.js";
import { optionalAuth, requireAuth, requireTokenScope } from "../middleware/auth-middleware.js";
import { type ObjectSchema, registerOpenApiOperation, validateBody } from "../middleware/validate.js";

const ORG_AUTH_SECURITY: Array<Record<string, string[]>> = [{ bearerAuth: [] }, { cookieAuth: [] }, { patAuth: [] }];

const createOrganizationSchema: ObjectSchema = {
  type: "object",
  required: ["slug", "name"],
  description: "Payload for creating a new organization namespace.",
  properties: {
    slug: {
      type: "string",
      required: true,
      minLength: 2,
      maxLength: 50,
      description: "URL-safe organization slug (2-50 alphanumeric, dash, or underscore characters).",
    },
    name: {
      type: "string",
      required: true,
      minLength: 1,
      description: "Human-readable organization name.",
    },
    description: {
      type: "string",
      description: "Optional description of the organization.",
    },
    avatarUrl: {
      type: "string",
      description: "Optional avatar image URL for the organization.",
    },
  },
};

const upsertOrganizationMemberSchema: ObjectSchema = {
  type: "object",
  description: "Payload for adding or updating an organization member's role. Supply either `userId` or `username`.",
  properties: {
    userId: {
      type: "number",
      min: 1,
      description: "Numeric ID of the target user.",
    },
    username: {
      type: "string",
      minLength: 1,
      description: "Username of the target user (used when userId is omitted).",
    },
    role: {
      type: "string",
      description:
        "Organization role ('owner', 'maintainer', or 'contributor'; aliases 'admin' and 'member' are normalized).",
    },
  },
};

registerOpenApiOperation("post", "/api/v1/organizations", {
  summary: "Create a new organization",
  description: "Create a new organization namespace and assign the authenticated creator as 'owner'.",
  tags: ["organizations"],
  security: ORG_AUTH_SECURITY,
  requestBody: createOrganizationSchema,
  responses: {
    "201": {
      description: "Organization created successfully.",
    },
    "400": {
      description: "Invalid organization slug or missing name.",
      content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } },
    },
    "401": {
      description: "Unauthorized.",
      content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } },
    },
    "403": {
      description: "Insufficient token scope.",
      content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } },
    },
    "409": {
      description: "Organization slug already exists or conflicts with a user namespace.",
      content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } },
    },
  },
});

registerOpenApiOperation("post", "/api/v1/organizations/:slug/members", {
  summary: "Add or update an organization member",
  description: "Add a user to an organization or update their role. Requires owner or maintainer privileges.",
  tags: ["organizations"],
  security: ORG_AUTH_SECURITY,
  requestBody: upsertOrganizationMemberSchema,
  responses: {
    "200": {
      description: "Member role added or updated successfully.",
    },
    "400": {
      description: "Invalid role, missing userId/username, or cannot demote last owner.",
      content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } },
    },
    "401": {
      description: "Unauthorized.",
      content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } },
    },
    "403": {
      description: "Caller lacks permission to manage organization membership.",
      content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } },
    },
    "404": {
      description: "Organization not found.",
      content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } },
    },
  },
});

function isValidSlug(slug: string): boolean {
  return /^[a-zA-Z0-9_-]{2,50}$/.test(slug);
}

function normalizeOrgRole(raw: unknown): OrgRole | null {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (s === "owner") return "owner";
  if (s === "maintainer" || s === "admin") return "maintainer";
  if (s === "contributor" || s === "member") return "contributor";
  return null;
}

export function organizationsRouter(database: LibraryDatabase): Router {
  const router = createRouter();
  const requireOrgWriteScope = requireTokenScope("org:write", "account:write");

  /**
   * GET /api/v1/organizations/my
   *
   * List organizations the authenticated user belongs to.
   */
  router.get("/my", requireAuth, (req: Request, res: Response): void => {
    const orgs = database.getUserOrganizations(req.user!.id);
    res.json({ organizations: orgs });
  });

  /**
   * POST /api/v1/organizations
   *
   * Create a new organization and assign the creator as 'owner'.
   */
  router.post(
    "/",
    requireAuth,
    requireOrgWriteScope,
    validateBody(createOrganizationSchema),
    (req: Request, res: Response): void => {
      const slug = String(req.body?.slug ?? "")
        .trim()
        .toLowerCase();
      const name = String(req.body?.name ?? "").trim();
      const description = req.body?.description ? String(req.body.description).trim() : null;
      const avatarUrl = req.body?.avatarUrl ? String(req.body.avatarUrl).trim() : null;

      if (!slug || !isValidSlug(slug)) {
        res.status(400).json({ error: "Organization slug must be 2-50 alphanumeric or dash/underscore characters" });
        return;
      }

      if (!name) {
        res.status(400).json({ error: "Organization name is required" });
        return;
      }

      const existingOrg = database.getOrganizationBySlug(slug);
      if (existingOrg) {
        res.status(409).json({ error: `Organization with slug '${slug}' already exists` });
        return;
      }

      // Check if user with this username exists (prevent namespace confusion)
      const existingUser = database.getUserByUsername(slug);
      if (existingUser && existingUser.id !== req.user!.id) {
        res.status(409).json({ error: `Namespace '${slug}' is already reserved by a user account` });
        return;
      }

      try {
        const org = database.createOrganization({
          slug,
          name,
          description,
          avatarUrl,
          createdBy: req.user!.id,
        });

        res.status(201).json({ organization: org });
      } catch (err: unknown) {
        res
          .status(500)
          .json({ error: (err instanceof Error ? err.message : String(err)) || "Failed to create organization" });
      }
    },
  );

  /**
   * GET /api/v1/organizations/:slug
   *
   * Get organization profile and details.
   */
  router.get("/:slug", optionalAuth, (req: Request, res: Response): void => {
    const slug = String(req.params["slug"] ?? "")
      .trim()
      .toLowerCase();
    const org = database.getOrganizationBySlug(slug);
    if (!org) {
      res.status(404).json({ error: `Organization '${slug}' not found` });
      return;
    }

    const callerRole = req.user ? database.getOrganizationMemberRole(org.id, req.user.id) : null;
    const isMemberOrAdmin = Boolean(callerRole || req.user?.accountType === "admin");
    const spaces = database.getOrganizationSpaces(org.id, req.user?.id);
    const members = database.getOrganizationMembers(org.id);

    const safeOrg = isMemberOrAdmin
      ? org
      : {
          id: org.id,
          slug: org.slug,
          name: org.name,
          display_name: org.display_name,
          description: org.description,
          avatar_url: org.avatar_url,
          banner_url: org.banner_url,
          location: org.location,
          industry_preset: org.industry_preset,
          is_verified: org.is_verified,
          website: org.website,
          created_at: org.created_at,
        };

    res.json({
      organization: safeOrg,
      spaces,
      members,
      viewerRole: callerRole,
    });
  });

  /**
   * GET /api/v1/organizations/:slug/spaces
   *
   * List Spaces belonging to an organization.
   */
  router.get("/:slug/spaces", optionalAuth, (req: Request, res: Response): void => {
    const slug = String(req.params["slug"] ?? "")
      .trim()
      .toLowerCase();
    const org = database.getOrganizationBySlug(slug);
    if (!org) {
      res.status(404).json({ error: `Organization '${slug}' not found` });
      return;
    }
    const spaces = database.getOrganizationSpaces(org.id, req.user?.id);
    res.json({ spaces });
  });

  /**
   * PATCH /api/v1/organizations/:slug
   * PUT /api/v1/organizations/:slug
   *
   * Update organization profile settings.
   * Requires caller to be an 'owner' or 'maintainer' in the organization.
   */
  const handleUpdateOrg = (req: Request, res: Response): void => {
    const slug = String(req.params["slug"] ?? "")
      .trim()
      .toLowerCase();
    const org = database.getOrganizationBySlug(slug);
    if (!org) {
      res.status(404).json({ error: `Organization '${slug}' not found` });
      return;
    }

    const callerRole = database.getOrganizationMemberRole(org.id, req.user!.id);
    const isAdmin =
      req.user!.account_type === "admin" || req.user!.accountType === "admin" || req.user!.role === "admin";
    if (!isAdmin && callerRole !== "owner" && callerRole !== "maintainer") {
      res.status(403).json({ error: "Only organization owners or maintainers can update organization settings" });
      return;
    }

    const body = req.body ?? {};
    const displayNameRaw =
      body.display_name !== undefined
        ? body.display_name
        : body.displayName !== undefined
          ? body.displayName
          : undefined;
    const nameRaw = body.name !== undefined ? body.name : displayNameRaw !== undefined ? displayNameRaw : undefined;
    const descriptionRaw = body.description !== undefined ? body.description : undefined;
    const websiteRaw = body.website !== undefined ? body.website : undefined;
    const billingEmailRaw =
      body.billing_email !== undefined
        ? body.billing_email
        : body.billingEmail !== undefined
          ? body.billingEmail
          : undefined;
    const avatarUrlRaw =
      body.avatar_url !== undefined ? body.avatar_url : body.avatarUrl !== undefined ? body.avatarUrl : undefined;
    const bannerUrlRaw =
      body.banner_url !== undefined ? body.banner_url : body.bannerUrl !== undefined ? body.bannerUrl : undefined;
    const locationRaw = body.location !== undefined ? body.location : undefined;
    const industryPresetRaw =
      body.industry_preset !== undefined
        ? body.industry_preset
        : body.industryPreset !== undefined
          ? body.industryPreset
          : undefined;

    try {
      const updated = database.updateOrganization(org.id, {
        name: typeof nameRaw === "string" && nameRaw.trim() ? nameRaw.trim() : undefined,
        display_name:
          displayNameRaw !== undefined ? (displayNameRaw ? String(displayNameRaw).trim() : null) : undefined,
        description: descriptionRaw !== undefined ? (descriptionRaw ? String(descriptionRaw).trim() : null) : undefined,
        website: websiteRaw !== undefined ? (websiteRaw ? String(websiteRaw).trim() : null) : undefined,
        billing_email:
          billingEmailRaw !== undefined ? (billingEmailRaw ? String(billingEmailRaw).trim() : null) : undefined,
        avatar_url: avatarUrlRaw !== undefined ? (avatarUrlRaw ? String(avatarUrlRaw).trim() : null) : undefined,
        banner_url: bannerUrlRaw !== undefined ? (bannerUrlRaw ? String(bannerUrlRaw).trim() : null) : undefined,
        location: locationRaw !== undefined ? (locationRaw ? String(locationRaw).trim() : null) : undefined,
        industry_preset:
          industryPresetRaw !== undefined ? (industryPresetRaw ? String(industryPresetRaw).trim() : null) : undefined,
      });

      res.json({ success: true, organization: updated });
    } catch (err: unknown) {
      res
        .status(500)
        .json({ error: (err instanceof Error ? err.message : String(err)) || "Failed to update organization" });
    }
  };

  router.patch("/:slug", requireAuth, requireOrgWriteScope, handleUpdateOrg);
  router.put("/:slug", requireAuth, requireOrgWriteScope, handleUpdateOrg);

  /**
   * GET /api/v1/organizations/:slug/members
   *
   * List members of an organization.
   */
  router.get("/:slug/members", (req: Request, res: Response): void => {
    const slug = String(req.params["slug"] ?? "")
      .trim()
      .toLowerCase();
    const org = database.getOrganizationBySlug(slug);
    if (!org) {
      res.status(404).json({ error: `Organization '${slug}' not found` });
      return;
    }

    const members = database.getOrganizationMembers(org.id);
    res.json({ members });
  });

  const handleUpsertMemberRole = (req: Request, res: Response, targetParam?: string): void => {
    const slug = String(req.params["slug"] ?? "")
      .trim()
      .toLowerCase();
    const org = database.getOrganizationBySlug(slug);
    if (!org) {
      res.status(404).json({ error: `Organization '${slug}' not found` });
      return;
    }

    const callerRole = database.getOrganizationMemberRole(org.id, req.user!.id);
    const isAdmin =
      req.user!.account_type === "admin" || req.user!.accountType === "admin" || req.user!.role === "admin";
    if (!isAdmin && callerRole !== "owner" && callerRole !== "maintainer") {
      res.status(403).json({ error: "Only organization owners or maintainers can manage membership" });
      return;
    }

    const role = normalizeOrgRole(req.body?.role ?? "contributor");
    if (!role) {
      res.status(400).json({ error: "Role must be 'owner', 'maintainer', or 'contributor'" });
      return;
    }

    let targetUserId = Number(targetParam ?? req.body?.userId);
    if (!targetUserId || Number.isNaN(targetUserId)) {
      const usernameCandidate = String(targetParam ?? req.body?.username ?? "").trim();
      if (usernameCandidate) {
        const targetUser = database.getUserByUsername(usernameCandidate);
        if (targetUser) targetUserId = targetUser.id;
      }
    }

    if (!targetUserId || Number.isNaN(targetUserId) || !database.getUserById(targetUserId)) {
      res.status(400).json({ error: "Valid userId or username is required" });
      return;
    }

    const targetCurrentRole = database.getOrganizationMemberRole(org.id, targetUserId);
    if (!isAdmin && callerRole === "maintainer") {
      if (role === "owner") {
        res.status(403).json({ error: "Maintainers cannot assign the 'owner' role" });
        return;
      }
      if (targetCurrentRole === "owner") {
        res.status(403).json({ error: "Maintainers cannot modify an organization owner" });
        return;
      }
    }

    if (targetCurrentRole === "owner" && role !== "owner") {
      const members = database.getOrganizationMembers(org.id);
      const ownerCount = members.filter((m) => m.role === "owner").length;
      if (ownerCount <= 1) {
        res.status(400).json({ error: "Cannot demote the last remaining owner of the organization" });
        return;
      }
    }

    try {
      database.addOrganizationMember(org.id, targetUserId, role);
      res.json({ success: true, role, message: `Member role set to '${role}'` });
    } catch {
      res.status(500).json({ error: "Failed to update organization member" });
    }
  };

  /**
   * POST /api/v1/organizations/:slug/members
   *
   * Add or update an organization member's role.
   * Requires caller to be an 'owner' or 'maintainer' in the organization.
   */
  router.post(
    "/:slug/members",
    requireAuth,
    requireOrgWriteScope,
    validateBody(upsertOrganizationMemberSchema),
    (req: Request, res: Response): void => {
      handleUpsertMemberRole(req, res);
    },
  );

  /**
   * PATCH /api/v1/organizations/:slug/members/:userOrId
   * PUT /api/v1/organizations/:slug/members/:userOrId
   *
   * Update an existing member's role by username or userId.
   */
  router.patch("/:slug/members/:userOrId", requireAuth, requireOrgWriteScope, (req: Request, res: Response): void => {
    handleUpsertMemberRole(req, res, String(req.params["userOrId"] ?? ""));
  });
  router.put("/:slug/members/:userOrId", requireAuth, requireOrgWriteScope, (req: Request, res: Response): void => {
    handleUpsertMemberRole(req, res, String(req.params["userOrId"] ?? ""));
  });

  /**
   * DELETE /api/v1/organizations/:slug/members/:userId
   *
   * Remove a member from the organization.
   * Requires caller to be an 'owner' in the organization.
   */
  router.delete("/:slug/members/:userId", requireAuth, requireOrgWriteScope, (req: Request, res: Response): void => {
    const slug = String(req.params["slug"] ?? "")
      .trim()
      .toLowerCase();
    const rawUserParam = String(req.params["userId"] ?? "").trim();
    let targetUserId = Number(rawUserParam);
    if (!targetUserId || Number.isNaN(targetUserId)) {
      const targetUser = database.getUserByUsername(rawUserParam);
      if (targetUser) targetUserId = targetUser.id;
    }

    const org = database.getOrganizationBySlug(slug);
    if (!org) {
      res.status(404).json({ error: `Organization '${slug}' not found` });
      return;
    }

    const callerRole = database.getOrganizationMemberRole(org.id, req.user!.id);
    const isAdmin =
      req.user!.account_type === "admin" || req.user!.accountType === "admin" || req.user!.role === "admin";
    if (!isAdmin && callerRole !== "owner") {
      res.status(403).json({ error: "Only organization owners can remove members" });
      return;
    }

    const targetRole = database.getOrganizationMemberRole(org.id, targetUserId);
    if (targetRole === "owner") {
      const members = database.getOrganizationMembers(org.id);
      const ownerCount = members.filter((m) => m.role === "owner").length;
      if (ownerCount <= 1) {
        res.status(400).json({ error: "Cannot remove the last remaining owner of the organization" });
        return;
      }
    }

    const removed = database.removeOrganizationMember(org.id, targetUserId);
    if (!removed) {
      res.status(404).json({ error: "Member not found in organization" });
      return;
    }

    res.json({ success: true, message: "Member removed from organization" });
  });

  return router;
}
