// SPDX-License-Identifier: AGPL-3.0-or-later

import type { UserRow } from "../database/types.js";

export interface SandboxingCheckResult {
  sandboxed: boolean;
  code?: string | undefined;
  error?: string | undefined;
  fallbackAvailable?: string | undefined;
}

/**
 * Checks if a user's compute privileges are sandboxed to in-browser execution.
 * Community-federated accounts without verified email or subscription are restricted
 * from consuming server-side HPC cluster resources.
 */
export function checkComputeSandboxing(user?: UserRow | null): SandboxingCheckResult {
  if (!user) {
    return { sandboxed: false };
  }

  const accountType = user.account_type;
  const isFederated = accountType === "community_federated";
  const isEmailVerified = user.email_verified === 1;

  if (isFederated && !isEmailVerified) {
    return {
      sandboxed: true,
      code: "COMPUTE_TIER_SANDBOXED",
      error: "Cloud solver quota requires verified email or subscription.",
      fallbackAvailable: "wasm_in_browser",
    };
  }

  return { sandboxed: false };
}
