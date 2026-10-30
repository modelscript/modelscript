// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FeatureFlagService } from "../services/feature-flag-service.js";

export interface InstanceCapabilitiesDTO {
  tier: string;
  registrationMode: string;
  federationMode: string;
  capabilities: {
    userInvites: boolean;
    waitlist: boolean;
    onboardingWizard: boolean;
    academicFastTrack: boolean;
    activityPubFederation: boolean;
    caeCompute: boolean;
    cosimMqtt: boolean;
    billing: boolean;
    botAgents: boolean;
    digitalThreads: boolean;
    mcpGateway: boolean;
  };
}

export function buildInstanceCapabilities(
  settings: {
    registrationMode?: string;
    federationMode?: string;
    userInvitesEnabled?: boolean;
    waitlistEnabled?: boolean;
    onboardingWizardEnabled?: boolean;
    academicFastTrackEnabled?: boolean;
    instanceTier?: string;
  },
  tierPresetId = "tier1_federated",
  featureFlags?: FeatureFlagService,
): InstanceCapabilitiesDTO {
  const isCorporate = tierPresetId === "tier2_corporate";
  const isFederationOpen = settings.federationMode !== "disabled";

  const isFlagActive = (key: string, fallback = false): boolean => {
    if (!featureFlags) return fallback;
    try {
      return featureFlags.isEnabled(key);
    } catch {
      return fallback;
    }
  };

  return {
    tier: settings.instanceTier || tierPresetId,
    registrationMode: settings.registrationMode || (isCorporate ? "domain_allowlist" : "open"),
    federationMode: settings.federationMode || (isCorporate ? "disabled" : "open"),
    capabilities: {
      userInvites: settings.userInvitesEnabled ?? !isCorporate,
      waitlist: settings.waitlistEnabled ?? false,
      onboardingWizard: settings.onboardingWizardEnabled ?? !isCorporate,
      academicFastTrack: settings.academicFastTrackEnabled ?? false,
      activityPubFederation: isFederationOpen,
      caeCompute: isFlagActive("cae_cloud_solver", true),
      cosimMqtt: isFlagActive("cosim_mqtt", true),
      billing: isFlagActive("billing_stripe_live", false),
      botAgents: isFlagActive("social_llm_bots", false),
      digitalThreads: isFlagActive("digital_thread_explorer", true),
      mcpGateway: isFlagActive("mcp_gateway_sse", false),
    },
  };
}
