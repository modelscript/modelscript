// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import api from "./api/client";

export interface InstanceCapabilities {
  userInvites: boolean;
  waitlist: boolean;
  onboardingWizard: boolean;
  academicFastTrack: boolean;
  activityPubFederation: boolean;
  cloudSolvers: boolean;
  offlineSandbox: boolean;
  airgapEnforced: boolean;
  billing: boolean;
  caeCompute: boolean;
  cosimMqtt: boolean;
  botAccounts: boolean;
  [key: string]: boolean;
}

export interface CapabilitiesResponse {
  tier: "tier0_local_dev" | "tier1_federated" | "tier2_corporate" | "tier3_flagship";
  edition: "ce" | "ee";
  airgapEnforced: boolean;
  capabilities: InstanceCapabilities;
}

export interface CapabilitiesContextValue {
  tier: "tier0_local_dev" | "tier1_federated" | "tier2_corporate" | "tier3_flagship";
  edition: "ce" | "ee";
  airgapEnforced: boolean;
  capabilities: InstanceCapabilities;
  hasCapability: (key: keyof InstanceCapabilities | string) => boolean;
  loading: boolean;
  refreshCapabilities: () => Promise<void>;
}

const DEFAULT_CAPABILITIES: InstanceCapabilities = {
  userInvites: true,
  waitlist: false,
  onboardingWizard: true,
  academicFastTrack: true,
  activityPubFederation: true,
  cloudSolvers: true,
  offlineSandbox: true,
  airgapEnforced: false,
  billing: false,
  caeCompute: true,
  cosimMqtt: true,
  botAccounts: true,
};

const CapabilitiesContext = createContext<CapabilitiesContextValue>({
  tier: "tier1_federated",
  edition: "ce",
  airgapEnforced: false,
  capabilities: DEFAULT_CAPABILITIES,
  hasCapability: (key: keyof InstanceCapabilities | string) => Boolean(DEFAULT_CAPABILITIES[String(key)]),
  loading: false,
  refreshCapabilities: async () => {},
});

export const CapabilitiesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tier, setTier] = useState<CapabilitiesResponse["tier"]>("tier1_federated");
  const [edition, setEdition] = useState<"ce" | "ee">("ce");
  const [airgapEnforced, setAirgapEnforced] = useState(false);
  const [capabilities, setCapabilities] = useState<InstanceCapabilities>(DEFAULT_CAPABILITIES);
  const [loading, setLoading] = useState(true);

  const refreshCapabilities = useCallback(async () => {
    try {
      const { data } = await api.get<CapabilitiesResponse>("/instance/capabilities");
      if (data) {
        if (data.tier) setTier(data.tier);
        if (data.edition) setEdition(data.edition);
        if (typeof data.airgapEnforced === "boolean") setAirgapEnforced(data.airgapEnforced);
        if (data.capabilities) setCapabilities((prev) => ({ ...prev, ...data.capabilities }));
      }
    } catch {
      // Fallback silently to defaults if endpoint unreachable
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshCapabilities();
  }, [refreshCapabilities]);

  const hasCapability = useCallback(
    (key: keyof InstanceCapabilities | string): boolean => {
      return Boolean(capabilities[key]);
    },
    [capabilities],
  );

  const value = useMemo<CapabilitiesContextValue>(
    () => ({
      tier,
      edition,
      airgapEnforced,
      capabilities,
      hasCapability,
      loading,
      refreshCapabilities,
    }),
    [tier, edition, airgapEnforced, capabilities, hasCapability, loading, refreshCapabilities],
  );

  return <CapabilitiesContext.Provider value={value}>{children}</CapabilitiesContext.Provider>;
};

export const useCapabilities = (): CapabilitiesContextValue => {
  return useContext(CapabilitiesContext);
};
