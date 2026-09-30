// SPDX-License-Identifier: AGPL-3.0-or-later

import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { LibraryDatabase } from "../database.js";

export interface AdminSeedResult {
  created: boolean;
  username: string;
  email: string;
  generatedPassword?: string;
}

/**
 * Ensures an instance administrator exists in the database.
 * If no user with account_type = 'admin' exists, creates one using
 * credentials from parameters or environment variables (ADMIN_INIT_USERNAME / ADMIN_INIT_PASSWORD).
 */
export async function seedInitialAdmin(
  database: LibraryDatabase,
  options?: {
    username?: string;
    email?: string;
    password?: string;
  },
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

  let generatedPassword: string | undefined;
  let finalPassword = envPassword;

  if (!finalPassword) {
    generatedPassword = crypto.randomBytes(16).toString("hex");
    finalPassword = generatedPassword;
  }

  const passwordHash = await bcrypt.hash(finalPassword, 10);

  // If user with this username already exists (e.g. from prior dev seeding), upgrade them to admin
  const existingUser = database.getUserByUsername(username);
  if (existingUser) {
    database.setUserAccountType(existingUser.id, "admin");
    return {
      created: true,
      username: existingUser.username,
      email: existingUser.email,
    };
  }

  database.createUser(username, email, passwordHash, {
    accountType: "admin",
    emailVerified: true,
    initialCredits: 1000.0,
    status: "active",
    termsAcceptedAt: new Date().toISOString(),
  });

  database.logAudit({
    actorId: 1,
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

  // Ensure instance actor keys are initialized
  database.getInstanceKeys();

  return {
    created: true,
    username,
    email,
    ...(generatedPassword ? { generatedPassword } : {}),
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
