// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LibraryDatabase } from "../database.js";
import { defaultMailer } from "../services/mailer.js";
import { isDisposableEmail } from "./email-filter.js";

export interface RedeemedInviteInfo {
  id: number;
  code: string;
  initialCredits: number;
  assignedRole: string;
}

export interface RegistrationPolicyResult {
  allowed: boolean;
  status?: number | undefined;
  error?: string | undefined;
  errorCode?: string | undefined;
  redeemedInvite?: RedeemedInviteInfo | undefined;
  autoVerifiedByAirgap: boolean;
}

export function isEmailDomainAllowed(email: string, allowedEmailDomains: string[]): boolean {
  const emailDomain = String(email).split("@")[1]?.toLowerCase() || "";
  if (!emailDomain) return false;
  return allowedEmailDomains.some((d) => {
    const clean = d.trim().toLowerCase();
    return clean.length > 0 && (emailDomain === clean || emailDomain.endsWith(`.${clean}`));
  });
}

export function resolveBrandInstanceName(database: LibraryDatabase): string {
  try {
    const raw = database.getInstanceSettings().instanceName?.trim();
    if (raw) {
      return raw;
    }
  } catch {
    // Fallback to default
  }
  return "Ansatz";
}

export function evaluateRegistrationPolicy(
  database: LibraryDatabase,
  options: {
    email: string;
    inviteCode?: string | undefined;
  },
): RegistrationPolicyResult {
  const email = String(options.email || "").trim();
  const inviteCode = typeof options.inviteCode === "string" ? options.inviteCode.trim() : "";
  const autoVerifiedByAirgap =
    process.env["AIRGAP_ENFORCED"] === "true" && !defaultMailer.isConfiguredForLiveDelivery();

  if (isDisposableEmail(email)) {
    return {
      allowed: false,
      status: 403,
      errorCode: "DisposableEmailNotAllowed",
      error: "Disposable and temporary email addresses are not permitted. Please use a permanent email address.",
      autoVerifiedByAirgap,
    };
  }

  const instanceSettings = database.getInstanceSettings();

  if (instanceSettings.registrationMode === "closed") {
    return {
      allowed: false,
      status: 403,
      errorCode: "RegistrationClosed",
      error: "Public registration is currently closed on this instance.",
      autoVerifiedByAirgap,
    };
  }

  if (instanceSettings.registrationMode === "domain_allowlist" && !inviteCode) {
    const allowed = isEmailDomainAllowed(email, instanceSettings.allowedEmailDomains);
    if (!allowed) {
      return {
        allowed: false,
        status: 403,
        errorCode: "DomainNotAllowed",
        error: `Registration on this instance is restricted to approved email domains (${instanceSettings.allowedEmailDomains.join(", ") || "none"}).`,
        autoVerifiedByAirgap,
      };
    }
  }

  let redeemedInvite: RedeemedInviteInfo | undefined;
  if (instanceSettings.registrationMode === "invite_only" || inviteCode) {
    if (!inviteCode) {
      return {
        allowed: false,
        status: 403,
        errorCode: "InviteRequired",
        error: "An invitation code is required to register on this instance.",
        autoVerifiedByAirgap,
      };
    }
    const validation = database.validateAndConsumeInstanceInvite(inviteCode);
    if (!validation.valid || !validation.invite) {
      return {
        allowed: false,
        status: 403,
        errorCode: "InvalidInviteCode",
        error: validation.reason || "Invalid invitation code",
        autoVerifiedByAirgap,
      };
    }
    redeemedInvite = validation.invite;
  }

  return {
    allowed: true,
    redeemedInvite,
    autoVerifiedByAirgap,
  };
}
