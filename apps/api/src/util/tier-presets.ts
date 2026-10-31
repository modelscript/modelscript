// SPDX-License-Identifier: AGPL-3.0-or-later

export interface SetupTierPreset {
  id: string;
  label: string;
  description: string;
  registrationMode: "open" | "invite_only" | "domain_allowlist" | "closed";
  federationMode: "disabled" | "open" | "mesh" | "consortium";
  waitlistEnabled?: boolean;
  userInvitesEnabled?: boolean;
  onboardingWizardEnabled?: boolean;
  academicFastTrackEnabled?: boolean;
  requireAdmin2FA?: boolean;
  autoQuarantineReportThreshold: number;
  backupRetentionCount: number;
  defaultInstanceName: string;
  defaultInstanceBadge: string;
  defaultDocsBaseUrl: string;
  defaultShowPoweredBy: boolean;
}

export const SETUP_TIER_PRESETS: Record<string, SetupTierPreset> = {
  tier0_local_dev: {
    id: "tier0_local_dev",
    label: "Tier 0: Ansatz Local (Offline Developer Sandbox)",
    description:
      "Open local registration with zero federation or internet dependencies. Ideal for standalone workstation modeling and offline debugging.",
    registrationMode: "open",
    federationMode: "disabled",
    waitlistEnabled: false,
    userInvitesEnabled: false,
    onboardingWizardEnabled: false,
    academicFastTrackEnabled: false,
    requireAdmin2FA: false,
    autoQuarantineReportThreshold: 10,
    backupRetentionCount: 3,
    defaultInstanceName: "Ansatz Local",
    defaultInstanceBadge: "Local",
    defaultDocsBaseUrl: "/docs",
    defaultShowPoweredBy: false,
  },
  tier1_federated: {
    id: "tier1_federated",
    label: "Tier 1: Ansatz Lab (Independent Federated Node)",
    description:
      "Invite-only registration with open ActivityPub S2S federation. Ideal for research labs, universities, and self-hosted federated operators.",
    registrationMode: "invite_only",
    federationMode: "open",
    waitlistEnabled: false,
    userInvitesEnabled: true,
    onboardingWizardEnabled: true,
    academicFastTrackEnabled: true,
    requireAdmin2FA: false,
    autoQuarantineReportThreshold: 3,
    backupRetentionCount: 7,
    defaultInstanceName: "Ansatz Lab",
    defaultInstanceBadge: "Lab",
    defaultDocsBaseUrl: "https://modelscript.org",
    defaultShowPoweredBy: true,
  },
  tier2_corporate: {
    id: "tier2_corporate",
    label: "Tier 2: Ansatz Enterprise (Corporate Intranet / Air-Gapped Appliance)",
    description:
      "Email domain allowlist registration with outbound ActivityPub federation disabled. Ideal for internal R&D intranets and classified SCIF/air-gapped appliances.",
    registrationMode: "domain_allowlist",
    federationMode: "disabled",
    waitlistEnabled: false,
    userInvitesEnabled: false,
    onboardingWizardEnabled: false,
    academicFastTrackEnabled: false,
    requireAdmin2FA: true,
    autoQuarantineReportThreshold: 5,
    backupRetentionCount: 14,
    defaultInstanceName: "Ansatz Enterprise",
    defaultInstanceBadge: "Enterprise",
    defaultDocsBaseUrl: "/docs",
    defaultShowPoweredBy: false,
  },
  tier3_flagship: {
    id: "tier3_flagship",
    label: "Tier 3: Ansatz Social (Public Flagship Node at ansatz.social)",
    description:
      "Open or gated registration with anti-Sybil verification, open ActivityPub federation, and automated report threshold quarantine. Flagship node at ansatz.social.",
    registrationMode: "open",
    federationMode: "open",
    waitlistEnabled: true,
    userInvitesEnabled: true,
    onboardingWizardEnabled: true,
    academicFastTrackEnabled: true,
    requireAdmin2FA: false,
    autoQuarantineReportThreshold: 5,
    backupRetentionCount: 30,
    defaultInstanceName: "Ansatz",
    defaultInstanceBadge: "",
    defaultDocsBaseUrl: "https://modelscript.org",
    defaultShowPoweredBy: true,
  },
};

/**
 * Normalizes a tier name or alias into a canonical SetupTierPreset.
 * Supported aliases:
 * - "flagship" | "tier3" | "tier3_flagship" -> tier3_flagship
 * - "federated" | "federated-lite" | "tier1" | "tier1_federated" -> tier1_federated
 * - "corporate" | "enterprise" | "tier2" | "tier2_corporate" -> tier2_corporate
 * - "local" | "dev" | "standalone" | "tier0" | "tier0_local_dev" -> tier0_local_dev
 */
export function resolveTierPreset(presetNameOrAlias?: string | null): SetupTierPreset | undefined {
  if (!presetNameOrAlias) return undefined;
  const normalized = presetNameOrAlias.trim().toLowerCase().replace(/-/g, "_");

  if (SETUP_TIER_PRESETS[normalized]) {
    return SETUP_TIER_PRESETS[normalized];
  }

  const aliasMap: Record<string, string> = {
    flagship: "tier3_flagship",
    tier3: "tier3_flagship",
    tier3_flagship: "tier3_flagship",
    federated: "tier1_federated",
    federated_lite: "tier1_federated",
    tier1: "tier1_federated",
    tier1_federated: "tier1_federated",
    corporate: "tier2_corporate",
    enterprise: "tier2_corporate",
    tier2: "tier2_corporate",
    tier2_corporate: "tier2_corporate",
    local: "tier0_local_dev",
    dev: "tier0_local_dev",
    standalone: "tier0_local_dev",
    tier0: "tier0_local_dev",
    tier0_local_dev: "tier0_local_dev",
  };

  const targetKey = aliasMap[normalized];
  return targetKey ? SETUP_TIER_PRESETS[targetKey] : undefined;
}

/**
 * Returns true if strict air-gap / enterprise appliance environment flags are active.
 */
export function isStrictAirgapEnv(): boolean {
  return (
    process.env["AIRGAP_ENFORCED"] === "true" ||
    process.env["ENTERPRISE_APPLIANCE"] === "true" ||
    resolveTierPreset(process.env["ANSATZ_TIER"] || process.env["DEPLOYMENT_PRESET"] || process.env["MSX_SETUP_PRESET"])
      ?.id === "tier2_corporate"
  );
}

/**
 * Returns true if the node is operating in Corporate / Air-Gapped mode (via env or instance settings).
 */
export function isCorporateOrAirgapTier(settings?: {
  federationMode?: string | undefined;
  registrationMode?: string | undefined;
}): boolean {
  if (isStrictAirgapEnv()) return true;
  if (settings && settings.federationMode === "disabled" && settings.registrationMode === "domain_allowlist") {
    return true;
  }
  return false;
}

/**
 * Returns true if ActivityPub federation is disabled via environment or instance settings.
 */
export function isFederationDisabled(settings?: { federationMode?: string | undefined }): boolean {
  if (
    isStrictAirgapEnv() ||
    process.env["FEDERATION_MODE"] === "disabled" ||
    process.env["MSX_FEDERATION_MODE"] === "disabled"
  ) {
    return true;
  }
  return settings?.federationMode === "disabled";
}
