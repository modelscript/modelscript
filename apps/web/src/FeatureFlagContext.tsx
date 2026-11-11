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

export const FeatureFlagContext = createContext<FeatureFlagContextType | null>(null);

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
  "oscal",
  "qif",
  "automationml",
  "three-mf",
  "gproms",
  "cantera",
  "phreeqc",
  "smiles",
  "antimony",
  "bngl",
  "cellml",
  "sedml",
  "sbol",
  "genbank",
  "pdb",
  "nmtran",
  "opensim",
  "febio",
  "dicom-rt",
  "nifti",
  "topas",
  "igtl",
  "usd",
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
  git_repositories: false,
  repositories: false,
  references: false,
  scientific_references: false,
  community_social: true,
  cad_step_viewer: true,
  cae_cloud_solver: false,
  billing_stripe_live: false,
  billing: false,
  organizations: false,
  orgs: false,
  invites: false,
  user_invites: false,
  digital_twins: false,
  cosim_mqtt: false,
  timescaledb_historian: false,
  activitypub_federation: false,
  sysml2_omg_api: false,
  digital_thread_explorer: false,
  heavy_vscode_ide: true,
  experimental_viewers: false,
  package_artifacts_tab: true,
  package_version_compare: true,
  package_advanced_exports: false,
  package_quality_scorecard: false,
  bot_accounts: false,
  ai_bots: false,
  bots: false,
  sparql_rdf_endpoints: false,
  mcp_gateway_sse: false,
  composer_ai_polish: false,
  ai_polish: false,
  feeds_page: false,
  rss_feeds: false,
  spaces_hub: false,
  spaces: false,
  space_chat: false,
  chat: false,
  topic_dismissal: true,
  trending_topic_dismissal: true,
  ...DEFAULT_LANGUAGE_FLAGS,
  lang_modelscript_msx: false,
};

const FLAGS_CACHE_KEY = "modelscript:cached-feature-flags-v2";

function readCachedFlags(): FeatureFlags {
  if (typeof window === "undefined" || !window.localStorage) return DEFAULT_FRONTEND_FLAGS;
  try {
    localStorage.removeItem("modelscript:cached-feature-flags");
    const raw = localStorage.getItem(FLAGS_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return { ...DEFAULT_FRONTEND_FLAGS, ...parsed };
      }
    }
  } catch {
    // Ignore storage parse error
  }
  return DEFAULT_FRONTEND_FLAGS;
}

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
  const [flags, setFlags] = useState<FeatureFlags>(readCachedFlags);
  const [overrides, setOverrides] = useState<Record<string, boolean>>(readStorageOverrides);
  const [isLoading, setIsLoading] = useState(false);

  const refreshFlags = useCallback(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await api.get("/flags");
        if (res.data && typeof res.data === "object") {
          setFlags((prev) => ({ ...prev, ...res.data }));
          try {
            if (typeof localStorage !== "undefined") {
              localStorage.setItem(FLAGS_CACHE_KEY, JSON.stringify(res.data));
            }
          } catch {
            // Ignore storage quota error
          }
        }
        break;
      } catch (err: any) {
        if (attempt < 2 && (err?.response?.status === 502 || err?.response?.status === 503 || !err?.response)) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        // In case of network error, fallback to defaults
      } finally {
        setIsLoading(false);
      }
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
      if (key === "repositories" && "git_repositories" in overrides) {
        return overrides["git_repositories"]!;
      }
      if (key === "git_repositories" && "repositories" in overrides) {
        return overrides["repositories"]!;
      }
      if (key === "scientific_references" && "references" in overrides) {
        return overrides["references"]!;
      }
      if (key === "references" && "scientific_references" in overrides) {
        return overrides["scientific_references"]!;
      }
      if (key === "feeds_page" && "rss_feeds" in overrides) {
        return overrides["rss_feeds"]!;
      }
      if (key === "rss_feeds" && "feeds_page" in overrides) {
        return overrides["feeds_page"]!;
      }
      if (key === "topic_dismissal" && "trending_topic_dismissal" in overrides) {
        return overrides["trending_topic_dismissal"]!;
      }
      if (key === "trending_topic_dismissal" && "topic_dismissal" in overrides) {
        return overrides["topic_dismissal"]!;
      }
      if (key === "spaces" && "spaces_hub" in overrides) {
        return overrides["spaces_hub"]!;
      }
      if (key === "spaces_hub" && "spaces" in overrides) {
        return overrides["spaces"]!;
      }
      if (key === "chat" && "space_chat" in overrides) {
        return overrides["space_chat"]!;
      }
      if (key === "space_chat" && "chat" in overrides) {
        return overrides["chat"]!;
      }
      if (key === "billing" && "billing_stripe_live" in overrides) {
        return overrides["billing_stripe_live"]!;
      }
      if (key === "billing_stripe_live" && "billing" in overrides) {
        return overrides["billing"]!;
      }
      if (key === "organizations" && "orgs" in overrides) {
        return overrides["orgs"]!;
      }
      if (key === "orgs" && "organizations" in overrides) {
        return overrides["organizations"]!;
      }
      if (key === "invites" && "user_invites" in overrides) {
        return overrides["user_invites"]!;
      }
      if (key === "user_invites" && "invites" in overrides) {
        return overrides["invites"]!;
      }
      if (key === "bot_accounts" || key === "ai_bots" || key === "bots") {
        if ("bot_accounts" in overrides) return overrides["bot_accounts"]!;
        if ("ai_bots" in overrides) return overrides["ai_bots"]!;
        if ("bots" in overrides) return overrides["bots"]!;
      }

      // 3. Fall back to evaluated flags or default
      if (key === "repositories" && flags["repositories"] === undefined && flags["git_repositories"] !== undefined) {
        return flags["git_repositories"]!;
      }
      if (
        key === "git_repositories" &&
        flags["git_repositories"] === undefined &&
        flags["repositories"] !== undefined
      ) {
        return flags["repositories"]!;
      }
      if (
        key === "scientific_references" &&
        flags["scientific_references"] === undefined &&
        flags["references"] !== undefined
      ) {
        return flags["references"]!;
      }
      if (key === "references" && flags["references"] === undefined && flags["scientific_references"] !== undefined) {
        return flags["scientific_references"]!;
      }
      if (key === "feeds_page" && flags["feeds_page"] === undefined && flags["rss_feeds"] !== undefined) {
        return flags["rss_feeds"]!;
      }
      if (key === "rss_feeds" && flags["rss_feeds"] === undefined && flags["feeds_page"] !== undefined) {
        return flags["feeds_page"]!;
      }
      if (
        key === "topic_dismissal" &&
        flags["topic_dismissal"] === undefined &&
        flags["trending_topic_dismissal"] !== undefined
      ) {
        return flags["trending_topic_dismissal"]!;
      }
      if (
        key === "trending_topic_dismissal" &&
        flags["trending_topic_dismissal"] === undefined &&
        flags["topic_dismissal"] !== undefined
      ) {
        return flags["topic_dismissal"]!;
      }
      if (key === "spaces" && flags["spaces"] === undefined && flags["spaces_hub"] !== undefined) {
        return flags["spaces_hub"]!;
      }
      if (key === "spaces_hub" && flags["spaces_hub"] === undefined && flags["spaces"] !== undefined) {
        return flags["spaces"]!;
      }
      if (key === "chat" && flags["chat"] === undefined && flags["space_chat"] !== undefined) {
        return flags["space_chat"]!;
      }
      if (key === "space_chat" && flags["space_chat"] === undefined && flags["chat"] !== undefined) {
        return flags["chat"]!;
      }
      if (key === "billing" && flags["billing"] === undefined && flags["billing_stripe_live"] !== undefined) {
        return flags["billing_stripe_live"]!;
      }
      if (
        key === "billing_stripe_live" &&
        flags["billing_stripe_live"] === undefined &&
        flags["billing"] !== undefined
      ) {
        return flags["billing"]!;
      }
      if (key === "organizations" && flags["organizations"] === undefined && flags["orgs"] !== undefined) {
        return flags["orgs"]!;
      }
      if (key === "orgs" && flags["orgs"] === undefined && flags["organizations"] !== undefined) {
        return flags["organizations"]!;
      }
      if (key === "invites" && flags["invites"] === undefined && flags["user_invites"] !== undefined) {
        return flags["user_invites"]!;
      }
      if (key === "user_invites" && flags["user_invites"] === undefined && flags["invites"] !== undefined) {
        return flags["invites"]!;
      }
      if (key === "bot_accounts" || key === "ai_bots" || key === "bots") {
        if (flags["bot_accounts"] !== undefined) return flags["bot_accounts"]!;
        if (flags["ai_bots"] !== undefined) return flags["ai_bots"]!;
        if (flags["bots"] !== undefined) return flags["bots"]!;
      }
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

export function useFeatureFlag(key: string | readonly string[]): boolean {
  const ctx = useContext(FeatureFlagContext);
  if (Array.isArray(key)) {
    if (!ctx) {
      return key.some((k) => DEFAULT_FRONTEND_FLAGS[k] ?? false);
    }
    return key.some((k) => ctx.isEnabled(k));
  }
  if (!ctx) {
    return DEFAULT_FRONTEND_FLAGS[key as string] ?? false;
  }
  return ctx.isEnabled(key as string);
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
