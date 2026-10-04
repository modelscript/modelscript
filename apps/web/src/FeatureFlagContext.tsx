// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import api from "./api";
import { useAuth } from "./AuthContext";

export type FeatureFlags = Record<string, boolean>;

interface FeatureFlagContextType {
  flags: FeatureFlags;
  isLoading: boolean;
  refreshFlags: () => Promise<void>;
  isEnabled: (key: string) => boolean;
}

const FeatureFlagContext = createContext<FeatureFlagContextType | null>(null);

export const DEFAULT_FRONTEND_FLAGS: FeatureFlags = {
  modelica_simulation: true,
  morsel_playground: true,
  package_browser: true,
  community_social: true,
  cad_step_viewer: true,
  cae_cloud_solver: false,
  billing_stripe_live: false,
  digital_twins: false,
  cosim_mqtt: false,
  activitypub_federation: false,
  sysml2_omg_api: false,
  digital_thread_explorer: false,
  heavy_vscode_ide: false,
  experimental_viewers: false,
  bot_accounts: false,
  sparql_rdf_endpoints: false,
  mcp_gateway_sse: false,
};

export function FeatureFlagProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const [flags, setFlags] = useState<FeatureFlags>(DEFAULT_FRONTEND_FLAGS);
  const [isLoading, setIsLoading] = useState(true);

  const refreshFlags = useCallback(async () => {
    try {
      const res = await api.get("/flags");
      if (res.data && typeof res.data === "object") {
        setFlags((prev) => ({ ...prev, ...res.data }));
      }
    } catch {
      // In case of network error, fallback to defaults
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshFlags();
  }, [token, refreshFlags]);

  const isEnabled = useCallback(
    (key: string): boolean => {
      // 1. Check URL search param override (e.g., ?ff_cae_cloud_solver=1 or ?ff_cae_cloud_solver=true)
      if (typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        const urlOverride = params.get(`ff_${key}`);
        if (urlOverride !== null) {
          return urlOverride === "1" || urlOverride.toLowerCase() === "true";
        }

        // 2. Check local storage developer override (e.g., ff_cae_cloud_solver)
        const storageOverride = localStorage.getItem(`ff_${key}`);
        if (storageOverride !== null) {
          return storageOverride === "1" || storageOverride.toLowerCase() === "true";
        }
      }

      // 3. Fall back to evaluated flags or default
      return flags[key] ?? DEFAULT_FRONTEND_FLAGS[key] ?? false;
    },
    [flags],
  );

  return (
    <FeatureFlagContext.Provider value={{ flags, isLoading, refreshFlags, isEnabled }}>
      {children}
    </FeatureFlagContext.Provider>
  );
}

export function useFeatureFlag(key: string): boolean {
  const ctx = useContext(FeatureFlagContext);
  if (!ctx) {
    return DEFAULT_FRONTEND_FLAGS[key] ?? false;
  }
  return ctx.isEnabled(key);
}

export function useFeatureFlags(): FeatureFlagContextType {
  const ctx = useContext(FeatureFlagContext);
  if (!ctx) {
    return {
      flags: DEFAULT_FRONTEND_FLAGS,
      isLoading: false,
      refreshFlags: async () => {},
      isEnabled: (key: string) => DEFAULT_FRONTEND_FLAGS[key] ?? false,
    };
  }
  return ctx;
}

export function FeatureGate({
  flag,
  fallback = null,
  children,
}: {
  flag: string;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  const enabled = useFeatureFlag(flag);
  return enabled ? <>{children}</> : <>{fallback}</>;
}
