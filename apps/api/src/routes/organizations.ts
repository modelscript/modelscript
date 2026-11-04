// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import type { LibraryDatabase, OrgRole } from "../database.js";
import { optionalAuth, requireAuth } from "../middleware/auth-middleware.js";
import { defaultApiLimiter } from "../middleware/rate-limiter.js";

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
  router.use(defaultApiLimiter);

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
  router.post("/", requireAuth, (req: Request, res: Response): void => {
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
  });

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

    const safeOrg = isMemberOrAdmin
      ? org
      : {
          id: org.id,
          slug: org.slug,
          name: org.name,
          description: org.description,
          avatar_url: org.avatar_url,
          website: org.website,
          created_at: org.created_at,
        };

    res.json({ organization: safeOrg });
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
      });

      res.json({ success: true, organization: updated });
    } catch (err: unknown) {
      res
        .status(500)
        .json({ error: (err instanceof Error ? err.message : String(err)) || "Failed to update organization" });
    }
  };

  router.patch("/:slug", requireAuth, handleUpdateOrg);
  router.put("/:slug", requireAuth, handleUpdateOrg);

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
  router.post("/:slug/members", requireAuth, (req: Request, res: Response): void => {
    handleUpsertMemberRole(req, res);
  });

  /**
   * PATCH /api/v1/organizations/:slug/members/:userOrId
   * PUT /api/v1/organizations/:slug/members/:userOrId
   *
   * Update an existing member's role by username or userId.
   */
  router.patch("/:slug/members/:userOrId", requireAuth, (req: Request, res: Response): void => {
    handleUpsertMemberRole(req, res, String(req.params["userOrId"] ?? ""));
  });
  router.put("/:slug/members/:userOrId", requireAuth, (req: Request, res: Response): void => {
    handleUpsertMemberRole(req, res, String(req.params["userOrId"] ?? ""));
  });

  /**
   * DELETE /api/v1/organizations/:slug/members/:userId
   *
   * Remove a member from the organization.
   * Requires caller to be an 'owner' in the organization.
   */
  router.delete("/:slug/members/:userId", requireAuth, (req: Request, res: Response): void => {
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
