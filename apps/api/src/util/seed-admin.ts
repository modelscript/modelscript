// SPDX-License-Identifier: AGPL-3.0-or-later

import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { LibraryDatabase } from "../database.js";
import { resolveTierPreset, type SetupTierPreset } from "./tier-presets.js";

export interface AdminSeedResult {
  created: boolean;
  username: string;
  email: string;
  generatedPassword?: string | undefined;
  presetApplied?: string | undefined;
}

export interface AdminSeedOptions {
  username?: string | undefined;
  email?: string | undefined;
  password?: string | undefined;
  preset?: string | undefined;
  markSetupCompleted?: boolean | undefined;
  createBaselineBackup?: boolean | undefined;
}

/**
 * Ensures an instance administrator exists in the database.
 * If no user with account_type = 'admin' exists, creates one using
 * credentials from parameters or environment variables (ADMIN_INIT_USERNAME / ADMIN_INIT_PASSWORD).
 *
 * If a deployment preset is specified (DEPLOYMENT_PRESET / MSX_SETUP_PRESET / options.preset),
 * applies the tier branding and policies, initialises instance and user cryptographic keys,
 * and marks first-run setup completed so that the wizard is cleanly bypassed.
 */
export async function seedInitialAdmin(
  database: LibraryDatabase,
  options?: AdminSeedOptions,
): Promise<AdminSeedResult> {
  if (database.hasAdminUser()) {
    return {
      created: false,
      username: "admin",
      email: "admin@modelscript.org",
    };
  }

  const username = options?.username || process.env["ADMIN_INIT_USERNAME"] || "admin";
  const email = options?.email || process.env["ADMIN_INIT_EMAIL"] || "admin@modelscript.org";
  const envPassword = options?.password || process.env["ADMIN_INIT_PASSWORD"];
  const presetKey = options?.preset || process.env["DEPLOYMENT_PRESET"] || process.env["MSX_SETUP_PRESET"];

  let generatedPassword: string | undefined;
  let finalPassword = envPassword;

  if (!finalPassword) {
    generatedPassword = crypto.randomBytes(16).toString("hex");
    finalPassword = generatedPassword;
  }

  const passwordHash = await bcrypt.hash(finalPassword, 10);

  let adminUserId: number;

  // If user with this username already exists (e.g. from prior dev seeding), upgrade them to admin
  const existingUser = database.getUserByUsername(username);
  if (existingUser) {
    database.setUserAccountType(existingUser.id, "admin");
    adminUserId = existingUser.id;
  } else {
    const createdUser = database.createUser(username, email, passwordHash, {
      accountType: "admin",
      emailVerified: true,
      initialCredits: 1000.0,
      status: "active",
      termsAcceptedAt: new Date().toISOString(),
    });
    adminUserId = createdUser.id;
  }

  database.logAudit({
    actorId: adminUserId,
    action: "admin_user_bootstrapped",
    resourceType: "user",
    resourceId: username,
    details: {
      username,
      email,
      accountType: "admin",
      note: "Initial administrator bootstrapped on system initialization",
    },
  });

  // Ensure instance actor keys and admin RSA federation keys are initialized
  database.getInstanceKeys();
  database.ensureUserRSAKeys(adminUserId);

  // Apply deployment preset if specified
  const preset: SetupTierPreset | undefined = resolveTierPreset(presetKey);
  let presetApplied: string | undefined;

  if (preset) {
    const mergedSettingsPatch: Record<string, unknown> = {
      registrationMode: preset.registrationMode,
      federationMode: preset.federationMode,
      autoQuarantineReportThreshold: preset.autoQuarantineReportThreshold,
      backupRetentionCount: preset.backupRetentionCount,
      instanceName: preset.defaultInstanceName,
      instanceBadge: preset.defaultInstanceBadge,
      docsBaseUrl: preset.defaultDocsBaseUrl,
      showPoweredBy: preset.defaultShowPoweredBy,
    };
    if (preset.waitlistEnabled !== undefined) mergedSettingsPatch["waitlistEnabled"] = preset.waitlistEnabled;
    if (preset.userInvitesEnabled !== undefined) mergedSettingsPatch["userInvitesEnabled"] = preset.userInvitesEnabled;
    if (preset.onboardingWizardEnabled !== undefined)
      mergedSettingsPatch["onboardingWizardEnabled"] = preset.onboardingWizardEnabled;
    if (preset.academicFastTrackEnabled !== undefined)
      mergedSettingsPatch["academicFastTrackEnabled"] = preset.academicFastTrackEnabled;
    if (preset.requireAdmin2FA !== undefined) mergedSettingsPatch["requireAdmin2FA"] = preset.requireAdmin2FA;
    if (email) {
      mergedSettingsPatch["contactEmail"] = email;
      if (preset.registrationMode === "domain_allowlist") {
        const emailDomain = email.split("@")[1]?.trim().toLowerCase();
        if (emailDomain && emailDomain !== "modelscript.org" && emailDomain !== "example.com") {
          mergedSettingsPatch["allowedEmailDomains"] = [emailDomain];
        }
      }
    }

    database.updateInstanceSettings(mergedSettingsPatch, adminUserId);
    presetApplied = preset.id;
  }

  // Self-lock setup wizard when bootstrapped with a preset or when explicitly requested
  if (preset || options?.markSetupCompleted !== false) {
    database.markSetupCompleted(adminUserId);
    database.logAudit({
      actorId: adminUserId,
      action: "instance.setup_completed",
      resourceType: "instance_settings",
      resourceId: "setup",
      details: {
        bootstrappedHeadlessly: true,
        preset: preset?.id || "custom_env",
        username,
      },
    });

    if (options?.createBaselineBackup !== false) {
      try {
        database.createHotBackup("first-boot-baseline");
      } catch (err) {
        console.warn("[AdminSeed] Failed to create first-boot-baseline hot backup:", err);
      }
    }
  }

  return {
    created: true,
    username,
    email,
    ...(generatedPassword ? { generatedPassword } : {}),
    ...(presetApplied ? { presetApplied } : {}),
  };
}

// Support CLI execution
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = new LibraryDatabase();
  seedInitialAdmin(db)
    .then((res) => {
      if (res.created) {
        console.log(`[SeedAdmin] Successfully created initial administrator '${res.username}' (${res.email})`);
        if (res.generatedPassword) {
          console.log(`[SeedAdmin] Generated Temporary Password: ${res.generatedPassword}`);
        }
      } else {
        console.log("[SeedAdmin] Administrator user already exists. No action taken.");
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error("[SeedAdmin] Error bootstrapping admin:", err);
      process.exit(1);
    });
}
