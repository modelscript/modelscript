// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import api from "./api";
import { useAuth } from "./AuthContext";

export type FeatureFlags = Record<string, boolean>;

export interface FeatureFlagContextType {
  flags: FeatureFlags;
  overrides: Record<string, boolean>;
  isLoading: boolean;
  refreshFlags: () => Promise<void>;
  isEnabled: (key: string) => boolean;
  setFlagOverride: (key: string, enabled: boolean | null) => void;
  resetAllOverrides: () => void;
}

const FeatureFlagContext = createContext<FeatureFlagContextType | null>(null);

export const POLYGLOT_LANGUAGE_IDS = [
  "modelica",
  "modelscript",
  "sysml2",
  "step",
  "owl2",
  "scad",
  "pscad",
  "spice",
  "fea",
  "cfd",
  "ssp",
  "psse",
  "gensys",
  "simpack",
  "verilog-a",
  "c",
  "fortran",
  "plcopen",
  "autosar",
  "simulink",
  "reqif",
  "ccsds",
  "opendrive",
  "openscenario",
  "urdf",
  "adams",
  "sima",
  "olga",
  "lps",
  "epanet",
  "swmm",
  "gtsuite",
  "easy5",
  "rocets",
  "relap5",
  "energyplus",
  "aspen",
  "eclipse",
  "sbml",
  "jsbsim",
  "touchstone",
  "ibis",
  "opendss",
  "csv",
] as const;

export function getLanguageFlagKey(langId: string): string {
  const normalized = langId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
  return `lang_${normalized}`;
}

const DEFAULT_LANGUAGE_FLAGS: FeatureFlags = Object.fromEntries(
  POLYGLOT_LANGUAGE_IDS.map((id) => [getLanguageFlagKey(id), id !== "modelscript"]),
);

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
  heavy_vscode_ide: true,
  experimental_viewers: false,
  bot_accounts: false,
  sparql_rdf_endpoints: false,
  mcp_gateway_sse: false,
  ...DEFAULT_LANGUAGE_FLAGS,
  lang_modelscript_msx: false,
};

function readStorageOverrides(): Record<string, boolean> {
  const overrides: Record<string, boolean> = {};
  if (typeof window === "undefined" || !window.localStorage) return overrides;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("ff_")) {
        const flagName = key.slice(3);
        const val = localStorage.getItem(key);
        if (val !== null) {
          overrides[flagName] = val === "1" || val.toLowerCase() === "true";
        }
      }
    }
  } catch {
    // Ignore storage quota or access errors
  }
  return overrides;
}

export function FeatureFlagProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const [flags, setFlags] = useState<FeatureFlags>(DEFAULT_FRONTEND_FLAGS);
  const [overrides, setOverrides] = useState<Record<string, boolean>>(readStorageOverrides);
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

  const setFlagOverride = useCallback((key: string, enabled: boolean | null) => {
    if (typeof window !== "undefined") {
      try {
        if (enabled === null) {
          localStorage.removeItem(`ff_${key}`);
        } else {
          localStorage.setItem(`ff_${key}`, enabled ? "1" : "0");
        }
      } catch {
        // Ignore localStorage error
      }
    }
    setOverrides((prev) => {
      if (enabled === null) {
        const { [key]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [key]: enabled };
    });
  }, []);

  const resetAllOverrides = useCallback(() => {
    if (typeof window !== "undefined") {
      try {
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith("ff_")) {
            keysToRemove.push(k);
          }
        }
        for (const k of keysToRemove) {
          localStorage.removeItem(k);
        }
      } catch {
        // Ignore localStorage error
      }
    }
    setOverrides({});
  }, []);

  const isEnabled = useCallback(
    (key: string): boolean => {
      // 1. Check URL search param override (e.g., ?ff_cae_cloud_solver=1 or ?ff_cae_cloud_solver=true)
      if (typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        const urlOverride = params.get(`ff_${key}`);
        if (urlOverride !== null) {
          return urlOverride === "1" || urlOverride.toLowerCase() === "true";
        }
      }

      // 2. Check local storage / in-memory developer override (e.g., ff_cae_cloud_solver)
      if (key in overrides) {
        return overrides[key]!;
      }

      // 3. Fall back to evaluated flags or default
      return flags[key] ?? DEFAULT_FRONTEND_FLAGS[key] ?? false;
    },
    [flags, overrides],
  );

  return (
    <FeatureFlagContext.Provider
      value={{
        flags,
        overrides,
        isLoading,
        refreshFlags,
        isEnabled,
        setFlagOverride,
        resetAllOverrides,
      }}
    >
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
      overrides: {},
      isLoading: false,
      refreshFlags: async () => {},
      isEnabled: (key: string) => DEFAULT_FRONTEND_FLAGS[key] ?? false,
      setFlagOverride: () => {},
      resetAllOverrides: () => {},
    };
  }
  return ctx;
}

export function isLanguageEnabledInFlags(langId: string, isEnabledFn?: (key: string) => boolean): boolean {
  const key = getLanguageFlagKey(langId);
  const check = isEnabledFn ?? ((k: string) => DEFAULT_FRONTEND_FLAGS[k] ?? k !== "lang_modelscript");
  if (langId === "modelscript" || key === "lang_modelscript") {
    return check("lang_modelscript") || check("lang_modelscript_msx");
  }
  return check(key);
}

export function useLanguageEnabled(langId: string): boolean {
  const { isEnabled } = useFeatureFlags();
  return isLanguageEnabledInFlags(langId, isEnabled);
}

export function FeatureGate({
  flag,
  fallback = null,
  children,
}: {
  flag: string;
  fallback?: React.ReactNode | undefined;
  children: React.ReactNode;
}) {
  const enabled = useFeatureFlag(flag);
  return enabled ? <>{children}</> : <>{fallback}</>;
}
