// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import type { LibraryDatabase, OrgRole } from "../database.js";
import { requireAuth } from "../middleware/auth-middleware.js";

function isValidSlug(slug: string): boolean {
  return /^[a-zA-Z0-9_-]{2,50}$/.test(slug);
}

export function organizationsRouter(database: LibraryDatabase): Router {
  const router = createRouter();

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
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to create organization" });
    }
  });

  /**
   * GET /api/v1/organizations/:slug
   *
   * Get organization profile and details.
   */
  router.get("/:slug", (req: Request, res: Response): void => {
    const slug = String(req.params["slug"] ?? "")
      .trim()
      .toLowerCase();
    const org = database.getOrganizationBySlug(slug);
    if (!org) {
      res.status(404).json({ error: `Organization '${slug}' not found` });
      return;
    }

    res.json({ organization: org });
  });

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

  /**
   * POST /api/v1/organizations/:slug/members
   *
   * Add or update an organization member's role.
   * Requires caller to be an 'owner' or 'maintainer' in the organization.
   */
  router.post("/:slug/members", requireAuth, (req: Request, res: Response): void => {
    const slug = String(req.params["slug"] ?? "")
      .trim()
      .toLowerCase();
    const org = database.getOrganizationBySlug(slug);
    if (!org) {
      res.status(404).json({ error: `Organization '${slug}' not found` });
      return;
    }

    const callerRole = database.getOrganizationMemberRole(org.id, req.user!.id);
    const isAdmin = req.user!.account_type === "admin";
    if (!isAdmin && callerRole !== "owner" && callerRole !== "maintainer") {
      res.status(403).json({ error: "Only organization owners or maintainers can manage membership" });
      return;
    }

    const role = String(req.body?.role ?? "contributor") as OrgRole;
    if (!["owner", "maintainer", "contributor"].includes(role)) {
      res.status(400).json({ error: "Role must be 'owner', 'maintainer', or 'contributor'" });
      return;
    }

    let targetUserId = Number(req.body?.userId);
    if (!targetUserId && req.body?.username) {
      const targetUser = database.getUserByUsername(String(req.body.username).trim());
      if (targetUser) targetUserId = targetUser.id;
    }

    if (!targetUserId) {
      res.status(400).json({ error: "Valid userId or username is required" });
      return;
    }

    database.addOrganizationMember(org.id, targetUserId, role);
    res.json({ success: true, message: `Member role set to '${role}'` });
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
    const targetUserId = Number(req.params["userId"]);

    const org = database.getOrganizationBySlug(slug);
    if (!org) {
      res.status(404).json({ error: `Organization '${slug}' not found` });
      return;
    }

    const callerRole = database.getOrganizationMemberRole(org.id, req.user!.id);
    const isAdmin = req.user!.account_type === "admin";
    if (!isAdmin && callerRole !== "owner") {
      res.status(403).json({ error: "Only organization owners can remove members" });
      return;
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
