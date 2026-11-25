// SPDX-License-Identifier: AGPL-3.0-or-later

import bcrypt from "bcryptjs";
import express, { type Request, type Response, type Router } from "express";
import jwt from "jsonwebtoken";
import type { LibraryDatabase } from "../../database.js";
import { isEnterpriseEditionActive } from "../../ee-loader.js";
import { JWT_SECRET, optionalAuth } from "../../middleware/auth-middleware.js";
import { getClientIp } from "../../util/client-ip.js";
import { SETUP_TIER_PRESETS, resolveTierPreset } from "../../util/tier-presets.js";
import { adminAuth, staffAuth, type AdminRouteContext } from "./admin-helpers.js";

export function createInstanceAndSetupRouter({ database, featureFlagService }: AdminRouteContext): Router {
  const router = express.Router();

  // ── Public Instance Banner & First-Run Setup Wizard ──

  /**
   * GET /api/v1/instance/banner & GET /api/v1/instance/branding
   * Public endpoint returning non-sensitive instance identity, white-label branding, announcement banner, registration/federation modes, and first-run setup state
   */
  router.get(["/instance/banner", "/instance/branding"], (_req: Request, res: Response) => {
    try {
      const setupStatus = database.getSetupStatus();
      const { settings } = setupStatus;
      const isDown = settings.maintenanceLevel === "lockdown";
      const isReadOnly = settings.maintenanceLevel === "read_only";
      const buildVersion = process.env["MSX_BUILD_SHA"] || process.env["IMAGE_TAG"] || "0.1.0";
      res.json({
        instanceName: settings.instanceName,
        instanceBadge: settings.instanceBadge,
        instanceTagline: settings.instanceTagline,
        instanceDescription: settings.instanceDescription,
        contactEmail: settings.contactEmail,
        brandLogoUrl: settings.brandLogoUrl,
        brandLogoDarkUrl: settings.brandLogoDarkUrl,
        brandFaviconUrl: settings.brandFaviconUrl,
        brandAccentColor: settings.brandAccentColor,
        docsBaseUrl: settings.docsBaseUrl,
        showPoweredBy: settings.showPoweredBy,
        buildVersion,
        ingressMode: settings.ingressMode,
        cloudflareTunnelConfigured: settings.cloudflareTunnelConfigured,
        maintenanceMode: settings.maintenanceMode,
        maintenanceLevel: settings.maintenanceLevel,
        maintenanceEta: settings.maintenanceEta,
        maintenanceStartedAt: settings.maintenanceStartedAt,
        announcementBanner: settings.announcementBanner,
        announcementLevel: settings.announcementLevel,
        registrationMode: settings.registrationMode,
        federationMode: settings.federationMode,
        waitlistEnabled: settings.waitlistEnabled ?? false,
        userInvitesEnabled: settings.userInvitesEnabled ?? false,
        academicFastTrackEnabled: settings.academicFastTrackEnabled ?? false,
        academicDomainPatterns: settings.academicFastTrackEnabled ? settings.academicDomainPatterns : [],
        onboardingWizardEnabled: settings.onboardingWizardEnabled ?? false,
        customTermsMarkdown: settings.customTermsMarkdown,
        customPrivacyMarkdown: settings.customPrivacyMarkdown,
        customCookiesMarkdown: settings.customCookiesMarkdown,
        legalPolicyMode: settings.legalPolicyMode,
        legalJurisdiction: settings.legalJurisdiction,
        legalEffectiveDate: settings.legalEffectiveDate,
        remoteContentRetentionDays: settings.remoteContentRetentionDays,
        remoteMediaCacheRetentionDays: settings.remoteMediaCacheRetentionDays,
        autoFilterAction: settings.autoFilterAction,
        autoQuarantineReportThreshold: settings.autoQuarantineReportThreshold,
        authorizedFetchEnabled: settings.authorizedFetchEnabled ?? false,
        federatedTimelinePublic: settings.federatedTimelinePublic ?? true,
        domainBlocksPublic: settings.domainBlocksPublic ?? true,
        rules: database.listInstanceRules(),
        needsSetup: setupStatus.needsSetup,
        setupCompleted: setupStatus.setupCompleted,
        subsystems: {
          coreApi: isDown ? "maintenance" : isReadOnly ? "read_only" : "operational",
          packageRegistry: isDown ? "maintenance" : isReadOnly ? "read_only" : "operational",
          cloudSolvers: isDown || isReadOnly ? "paused" : "operational",
          federationQueue:
            settings.federationMode === "disabled" ? "disabled" : isDown || isReadOnly ? "paused" : "operational",
          wasmSandbox: "operational",
        },
      });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch instance banner" });
    }
  });

  /**
   * GET /api/v1/instance/rules
   * Public endpoint listing structured instance moderation rules
   */
  router.get("/instance/rules", (_req: Request, res: Response) => {
    try {
      res.json({ rules: database.listInstanceRules() });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to list instance rules" });
    }
  });

  /**
   * GET /api/v1/instance/domain-blocks
   * Public transparency endpoint listing moderated federation domains (with optional obfuscation)
   */
  router.get("/instance/domain-blocks", optionalAuth, (req: Request, res: Response) => {
    try {
      const settings = database.getInstanceSettings();
      const isStaff = req.user?.role === "admin" || req.user?.role === "moderator" || req.user?.accountType === "admin";
      if (!settings.domainBlocksPublic && !isStaff) {
        res.status(403).json({ error: "Domain block list is not publicly shared on this instance" });
        return;
      }
      res.json({ domainBlocks: database.listPublicDomainBlocks() });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch public domain blocks" });
    }
  });

  /**
   * GET /api/v1/instance/peers
   * Public endpoint listing known federated peer domains
   */
  router.get("/instance/peers", (_req: Request, res: Response) => {
    try {
      res.json({ peers: database.listKnownPeers() });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to list federated peers" });
    }
  });

  /**
   * GET /api/v1/instance/capabilities
   * Public endpoint declaring active deployment tier and granular platform capability flags
   */
  router.get("/instance/capabilities", (_req: Request, res: Response) => {
    try {
      const setupStatus = database.getSetupStatus();
      const { settings } = setupStatus;
      const airgapEnforced =
        process.env["AIRGAP_ENFORCED"] === "true" || process.env["ENTERPRISE_APPLIANCE"] === "true";
      const edition: "ce" | "ee" = isEnterpriseEditionActive() ? "ee" : "ce";
      const rawTier = (settings as { profileTier?: string }).profileTier || process.env["ANSATZ_TIER"];
      const tier =
        rawTier ||
        (airgapEnforced
          ? "tier2_corporate"
          : settings.federationMode === "disabled" && !settings.waitlistEnabled && !settings.userInvitesEnabled
            ? "tier0_local_dev"
            : settings.waitlistEnabled
              ? "tier3_flagship"
              : "tier1_federated");
      const isDown = settings.maintenanceLevel === "lockdown";
      const isReadOnly = settings.maintenanceLevel === "read_only";

      const capabilities = {
        userInvites: settings.userInvitesEnabled ?? false,
        waitlist: settings.waitlistEnabled ?? false,
        onboardingWizard: settings.onboardingWizardEnabled ?? false,
        academicFastTrack: settings.academicFastTrackEnabled ?? false,
        activityPubFederation: settings.federationMode !== "disabled",
        cloudSolvers: !isDown && !isReadOnly && Boolean(featureFlagService?.isEnabled("cae_cloud_solver")),
        offlineSandbox: true,
        airgapEnforced,
        billing: tier === "tier3_flagship",
        caeCompute: Boolean(featureFlagService?.isEnabled("cae_cloud_solver")),
        cosimMqtt: featureFlagService ? featureFlagService.isEnabled("cosim_mqtt") : false,
        timescaleHistorian: featureFlagService ? featureFlagService.isEnabled("timescaledb_historian") : false,
        botAccounts: !airgapEnforced,
      };

      res.json({
        tier,
        edition,
        airgapEnforced,
        capabilities,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load instance capabilities" });
    }
  });

  /**
   * GET /api/v1/setup/status
   * Public endpoint returning first-boot install wizard status and deployment tier presets
   */
  router.get("/setup/status", (_req: Request, res: Response) => {
    try {
      const status = database.getSetupStatus();
      res.json({
        ...status,
        edition: isEnterpriseEditionActive() ? "ee" : "ce",
        airgapEnforced: process.env["AIRGAP_ENFORCED"] === "true" || process.env["ENTERPRISE_APPLIANCE"] === "true",
        presets: SETUP_TIER_PRESETS,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch setup status" });
    }
  });

  /**
   * POST /api/v1/setup/reset
   * Re-opens the First-Run Install Wizard for developer testing or administrator re-configuration.
   * Permitted in non-production environments or when authenticated as an administrator.
   */
  router.post("/setup/reset", optionalAuth, (req: Request, res: Response) => {
    try {
      const callerIsAdmin = req.user?.accountType === "admin" || req.user?.role === "admin";
      const envPreset = resolveTierPreset(
        process.env["ANSATZ_TIER"] || process.env["DEPLOYMENT_PRESET"] || process.env["MSX_SETUP_PRESET"],
      );
      const isProductionOrPreset =
        process.env["NODE_ENV"] === "production" || Boolean(envPreset && envPreset.id !== "tier0_local_dev");
      const isTestEnv = process.env["NODE_ENV"] === "test" && !isProductionOrPreset;

      if (!callerIsAdmin && (isProductionOrPreset || (!isTestEnv && database.hasAdminUser()))) {
        res.status(403).json({
          error: "Only an administrator or development mode session can re-open the setup wizard.",
        });
        return;
      }

      database.resetSetupWizard(req.user?.id ?? null);
      database.logAudit({
        actorId: req.user?.id ?? null,
        action: "instance.setup_reopened",
        resourceType: "instance_settings",
        resourceId: "setup",
        ipAddress: req.ip || null,
        details: { reopenedBy: req.user?.username || "dev-toolbar" },
      });

      const status = database.getSetupStatus();
      res.json({
        success: true,
        ...status,
        edition: isEnterpriseEditionActive() ? "ee" : "ce",
        airgapEnforced: process.env["AIRGAP_ENFORCED"] === "true" || process.env["ENTERPRISE_APPLIANCE"] === "true",
        presets: SETUP_TIER_PRESETS,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to reset setup wizard" });
    }
  });

  /**
   * POST /api/v1/setup/complete
   * Self-locking First-Run Install Wizard endpoint.
   * Once an admin user exists and setup is marked completed, this endpoint permanently rejects requests with 403 Forbidden.
   */
  router.post("/setup/complete", optionalAuth, async (req: Request, res: Response): Promise<void> => {
    try {
      const status = database.getSetupStatus();
      const callerIsAdmin = req.user?.accountType === "admin" || req.user?.role === "admin";
      const envPreset = resolveTierPreset(
        process.env["ANSATZ_TIER"] || process.env["DEPLOYMENT_PRESET"] || process.env["MSX_SETUP_PRESET"],
      );
      const isProductionOrPreset =
        process.env["NODE_ENV"] === "production" || Boolean(envPreset && envPreset.id !== "tier0_local_dev");
      const isTestEnv = process.env["NODE_ENV"] === "test" && !isProductionOrPreset;

      // Lock out unauthenticated callers if an admin already exists, or anyone if setup was already completed
      if (status.setupCompleted && (!callerIsAdmin || database.isSetupCompleted())) {
        res.status(403).json({
          error: "Instance setup has already been completed and is permanently locked.",
        });
        return;
      }

      if ((status.hasAdmin || (!isTestEnv && database.hasAdminUser())) && !callerIsAdmin) {
        res.status(403).json({
          error:
            "An administrator account already exists on this instance. Sign in as administrator to complete setup.",
        });
        return;
      }

      const {
        profileTier,
        admin,
        settings: rawSettings,
        ingressMode: topLevelIngressMode,
        tunnelToken: topLevelTunnelToken,
        initialInvitesCount,
        initialInviteMaxUses,
        initialInviteCredits,
        initialInviteRole,
        createInitialBackup,
        migrationBundle,
      } = req.body ?? {};

      let adminUserId: number;
      let adminUserRecord: {
        id: number;
        username: string;
        email: string;
        account_type?: string | undefined;
        display_name?: string | null | undefined;
      };

      if (!status.hasAdmin && (!callerIsAdmin || admin?.username)) {
        const username = String(admin?.username ?? "").trim();
        const email = String(admin?.email ?? "")
          .trim()
          .toLowerCase();
        const password = String(admin?.password ?? "");
        const displayName = admin?.displayName ? String(admin.displayName).trim() : undefined;

        if (!username || !/^[a-zA-Z0-9_-]{2,32}$/.test(username)) {
          res.status(400).json({
            error:
              "Founding administrator username must be 2–32 characters (letters, numbers, underscores, or hyphens).",
          });
          return;
        }
        if (!email || !email.includes("@")) {
          res.status(400).json({
            error: "A valid founding administrator email address is required.",
          });
          return;
        }
        if (!password || password.length < 8) {
          res.status(400).json({
            error: "Founding administrator password must be at least 8 characters.",
          });
          return;
        }

        const existingUser = database.getUserByUsername(username) || database.getUserByEmail(email);
        const passwordHash = await bcrypt.hash(password, 10);

        if (existingUser) {
          if (!callerIsAdmin && !isTestEnv) {
            res.status(409).json({
              error: "An account with this username or email already exists. Sign in as administrator to reconfigure.",
            });
            return;
          }
          database.setUserAccountType(existingUser.id, "admin");
          database.updatePassword(existingUser.id, passwordHash);
          if (displayName) {
            database.updateProfile(existingUser.id, { display_name: displayName });
          }
          adminUserId = existingUser.id;
          adminUserRecord = {
            id: existingUser.id,
            username: existingUser.username,
            email: existingUser.email,
            account_type: "admin",
            display_name: displayName ?? existingUser.display_name ?? null,
          };
        } else {
          const created = database.createUser(username, email, passwordHash, {
            accountType: "admin",
            emailVerified: true,
            initialCredits: 1000.0,
            status: "active",
            termsAcceptedAt: new Date().toISOString(),
            registrationIp: req.ip || "127.0.0.1",
          });
          if (displayName) {
            database.updateProfile(created.id, { display_name: displayName });
          }
          adminUserId = created.id;
          adminUserRecord = {
            id: created.id,
            username: created.username,
            email: created.email,
            account_type: "admin",
            display_name: displayName ?? null,
          };
        }

        // Provision instance Ed25519 keys & founding admin RSA federation keys immediately
        database.getInstanceKeys();
        database.ensureUserRSAKeys(adminUserId);
      } else {
        adminUserId = req.user!.id;
        const existingAdmin = database.getUserById(adminUserId);
        adminUserRecord = {
          id: adminUserId,
          username: existingAdmin?.username || req.user!.username,
          email: existingAdmin?.email || req.user!.email,
          account_type: "admin",
          display_name: existingAdmin?.display_name ?? null,
        };
      }

      // Apply tier preset + explicit settings overrides
      const preset = resolveTierPreset(profileTier);

      const mergedSettingsPatch: Record<string, unknown> = {};
      if (preset) {
        mergedSettingsPatch["registrationMode"] = preset.registrationMode;
        mergedSettingsPatch["federationMode"] = preset.federationMode;
        mergedSettingsPatch["autoQuarantineReportThreshold"] = preset.autoQuarantineReportThreshold;
        mergedSettingsPatch["backupRetentionCount"] = preset.backupRetentionCount;
        mergedSettingsPatch["instanceName"] = preset.defaultInstanceName;
        mergedSettingsPatch["instanceBadge"] = preset.defaultInstanceBadge;
        mergedSettingsPatch["docsBaseUrl"] = preset.defaultDocsBaseUrl;
        mergedSettingsPatch["showPoweredBy"] = preset.defaultShowPoweredBy;
        if ("waitlistEnabled" in preset) mergedSettingsPatch["waitlistEnabled"] = preset.waitlistEnabled;
        if ("userInvitesEnabled" in preset) mergedSettingsPatch["userInvitesEnabled"] = preset.userInvitesEnabled;
        if ("onboardingWizardEnabled" in preset)
          mergedSettingsPatch["onboardingWizardEnabled"] = preset.onboardingWizardEnabled;
        if ("academicFastTrackEnabled" in preset)
          mergedSettingsPatch["academicFastTrackEnabled"] = preset.academicFastTrackEnabled;
        if ("requireAdmin2FA" in preset && preset.requireAdmin2FA !== undefined)
          mergedSettingsPatch["requireAdmin2FA"] = preset.requireAdmin2FA;
      }
      if (rawSettings && typeof rawSettings === "object") {
        for (const [k, v] of Object.entries(rawSettings)) {
          if (v !== undefined) {
            mergedSettingsPatch[k] = v;
          }
        }
      }
      if (topLevelIngressMode !== undefined) {
        mergedSettingsPatch["ingressMode"] = topLevelIngressMode;
      }
      if (topLevelTunnelToken !== undefined) {
        mergedSettingsPatch["tunnelToken"] = topLevelTunnelToken;
      }
      if (!mergedSettingsPatch["contactEmail"] && adminUserRecord.email) {
        mergedSettingsPatch["contactEmail"] = adminUserRecord.email;
      }
      if (
        mergedSettingsPatch["registrationMode"] === "domain_allowlist" &&
        mergedSettingsPatch["allowedEmailDomains"] === undefined &&
        adminUserRecord.email
      ) {
        const emailDomain = adminUserRecord.email.split("@")[1]?.trim().toLowerCase();
        if (emailDomain && emailDomain !== "modelscript.org" && emailDomain !== "example.com") {
          mergedSettingsPatch["allowedEmailDomains"] = [emailDomain];
        }
      }

      let updatedSettings = database.updateInstanceSettings(mergedSettingsPatch, adminUserId);

      // Optional migration bundle import during first-boot wizard
      let importedBundleResult: ReturnType<LibraryDatabase["importInstanceBundle"]> | null = null;
      if (migrationBundle && typeof migrationBundle === "object") {
        importedBundleResult = database.importInstanceBundle(migrationBundle, adminUserId);
        updatedSettings = database.getInstanceSettings();
      }

      // Optional starter invite code generation
      const inviteCount = Math.min(25, Math.max(0, Number(initialInvitesCount) || 0));
      const generatedInvites: ReturnType<LibraryDatabase["createInstanceInvite"]>[] = [];
      for (let i = 0; i < inviteCount; i++) {
        generatedInvites.push(
          database.createInstanceInvite({
            createdBy: adminUserId,
            maxUses: Number(initialInviteMaxUses) || 5,
            initialCredits: initialInviteCredits !== undefined ? Number(initialInviteCredits) : 100,
            assignedRole: typeof initialInviteRole === "string" ? initialInviteRole : "user",
            note: "Starter invite generated by First-Run Setup Wizard",
            expiresInDays: 30,
          }),
        );
      }

      // Optional initial baseline hot backup
      let backupSnapshot: ReturnType<LibraryDatabase["createHotBackup"]> | null = null;
      if (createInitialBackup !== false) {
        backupSnapshot = database.createHotBackup("first-boot-baseline");
      }

      // Mark setup completed so the wizard self-locks permanently
      database.markSetupCompleted(adminUserId);
      if (updatedSettings.federationMode === "open") {
        database.setFeatureFlag("activitypub_federation", true, "admin,beta_tester,user,guest", 100);
      } else if (updatedSettings.federationMode === "disabled") {
        database.setFeatureFlag("activitypub_federation", false, "admin", 100);
      }
      try {
        database.completeUserOnboarding(adminUserId, "physical_systems");
      } catch {
        // Ignore if onboarding columns are not yet present
      }

      database.logAudit({
        actorId: adminUserId,
        action: "instance.setup_completed",
        resourceType: "instance_settings",
        resourceId: "setup",
        ipAddress: req.ip || null,
        details: {
          profileTier: profileTier || "custom",
          adminUsername: adminUserRecord.username,
          registrationMode: updatedSettings.registrationMode,
          federationMode: updatedSettings.federationMode,
          ingressMode: updatedSettings.ingressMode,
          cloudflareTunnelConfigured: updatedSettings.cloudflareTunnelConfigured,
          generatedInvites: generatedInvites.length,
          backupCreated: Boolean(backupSnapshot),
          migrationBundleImported: Boolean(importedBundleResult),
        },
      });

      const fullAdmin = database.getUserById(adminUserId);
      const token = jwt.sign(
        {
          id: adminUserId,
          username: adminUserRecord.username,
          email: adminUserRecord.email,
          tokenVersion: fullAdmin?.token_version ?? 1,
        },
        JWT_SECRET,
        { expiresIn: "7d" },
      );

      res.cookie("modelscript_token", token, {
        httpOnly: true,
        secure: process.env["NODE_ENV"] === "production",
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: "/",
      });

      res.status(201).json({
        success: true,
        setupCompleted: true,
        token,
        user: {
          id: adminUserRecord.id,
          username: adminUserRecord.username,
          email: adminUserRecord.email,
          display_name: adminUserRecord.display_name ?? null,
          account_type: "admin",
          status: "active",
          credit_balance: fullAdmin?.credit_balance ?? 1000,
          onboarding_completed: true,
        },
        settings: updatedSettings,
        invites: generatedInvites,
        backupSnapshot,
        importedBundle: importedBundleResult,
      });
    } catch (err: unknown) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Failed to complete instance setup",
      });
    }
  });

  /**
   * GET /api/v1/admin/overview
   * Returns pending counts for moderation, DMCA, federation delivery queue, and user governance
   */
  router.get("/admin/overview", staffAuth, (_req: Request, res: Response) => {
    try {
      const counts = database.getAdminPendingCounts();
      res.json(counts);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch admin overview" });
    }
  });

  /**
   * GET /api/v1/admin/stats
   * Enterprise governance summary endpoint (gated by airgap_compliance in EE, 501 in CE)
   */
  router.get("/admin/stats", staffAuth, (_req: Request, res: Response) => {
    try {
      const counts = database.getAdminPendingCounts();
      const diagnostics = database.getSystemDiagnostics();
      res.json({
        edition: isEnterpriseEditionActive() ? "ee" : "ce",
        counts,
        diagnostics,
      });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch enterprise admin stats" });
    }
  });

  // ── Structured Instance Rules ──

  router.get("/admin/rules", staffAuth, (_req: Request, res: Response) => {
    res.json({ rules: database.listInstanceRules() });
  });

  router.post("/admin/rules", adminAuth, express.json(), (req: Request, res: Response) => {
    const text = String(req.body?.text || "").trim();
    const hint = typeof req.body?.hint === "string" ? req.body.hint.trim() : null;
    const position =
      req.body?.position !== undefined
        ? Number(req.body.position)
        : req.body?.priority !== undefined
          ? Number(req.body.priority)
          : undefined;
    if (!text) {
      res.status(400).json({ error: "Rule text is required" });
      return;
    }
    const rule = database.createInstanceRule(text, hint, position);
    database.logAudit({
      actorId: req.user?.id || null,
      action: "instance_rule_created",
      resourceType: "instance_rule",
      resourceId: String(rule.id),
      ipAddress: getClientIp(req),
      details: { text, hint },
    });
    res.status(201).json({ rule });
  });

  router.put("/admin/rules/:id", adminAuth, express.json(), (req: Request, res: Response) => {
    const ruleId = Number(req.params["id"]);
    const rule = database.updateInstanceRule(ruleId, {
      text: typeof req.body?.text === "string" ? req.body.text.trim() : undefined,
      hint: req.body?.hint !== undefined ? req.body.hint : undefined,
      priority:
        req.body?.priority !== undefined
          ? Number(req.body.priority)
          : req.body?.position !== undefined
            ? Number(req.body.position)
            : undefined,
    });
    if (!rule) {
      res.status(404).json({ error: "Rule not found" });
      return;
    }
    res.json({ rule });
  });

  router.delete("/admin/rules/:id", adminAuth, (req: Request, res: Response) => {
    const ruleId = Number(req.params["id"]);
    const deleted = database.deleteInstanceRule(ruleId);
    if (!deleted) {
      res.status(404).json({ error: "Rule not found" });
      return;
    }
    res.json({ success: true });
  });

  return router;
}
