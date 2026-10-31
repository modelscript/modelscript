// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { getPublicInstanceBanner, type PublicInstanceBannerResponse } from "./api/admin";
import { setActiveBrandName } from "./util/title";

export interface InstanceBrandingState {
  instanceName: string;
  instanceBadge: string;
  instanceTagline: string;
  instanceDescription: string;
  contactEmail: string;
  brandLogoUrl: string;
  brandLogoDarkUrl: string;
  brandFaviconUrl: string;
  brandAccentColor: string;
  docsBaseUrl: string;
  showPoweredBy: boolean;
  registrationMode: "open" | "invite_only" | "domain_allowlist" | "closed";
  federationMode: "open" | "allowlist" | "disabled";
  waitlistEnabled: boolean;
  userInvitesEnabled: boolean;
  academicFastTrackEnabled: boolean;
  academicDomainPatterns: string[];
  onboardingWizardEnabled: boolean;
  maintenanceMode: boolean;
  maintenanceLevel: "off" | "scheduled" | "read_only" | "lockdown";
  maintenanceEta: string;
  maintenanceStartedAt: string;
  announcementBanner: string;
  announcementLevel: "info" | "warning" | "critical";
  needsSetup: boolean;
  setupCompleted: boolean;
  buildVersion: string;
  updateAvailable: boolean;
  dismissUpdateAvailable: () => void;
  subsystems: {
    coreApi: "operational" | "read_only" | "maintenance";
    packageRegistry: "operational" | "read_only" | "maintenance";
    cloudSolvers: "operational" | "paused";
    federationQueue: "operational" | "paused" | "disabled";
    wasmSandbox: "operational";
  };
  previewPublicMaintenance: boolean;
  setPreviewPublicMaintenance: (preview: boolean) => void;
  loaded: boolean;
  refreshBranding: () => Promise<void>;
  applyOptimisticBranding: (patch: Partial<PublicInstanceBannerResponse>) => void;
}

const DEFAULT_BRANDING: Omit<
  InstanceBrandingState,
  "refreshBranding" | "applyOptimisticBranding" | "setPreviewPublicMaintenance" | "dismissUpdateAvailable"
> = {
  instanceName: "Ansatz",
  instanceBadge: "",
  instanceTagline: "The Federated Scientific & Engineering Network",
  instanceDescription: "Federated polyglot engineering simulation, Modelica, SysML v2, and digital twin platform.",
  contactEmail: "admin@ansatz.social",
  brandLogoUrl: "",
  brandLogoDarkUrl: "",
  brandFaviconUrl: "",
  brandAccentColor: "",
  docsBaseUrl: "https://modelscript.org",
  showPoweredBy: true,
  registrationMode: "open",
  federationMode: "open",
  waitlistEnabled: false,
  userInvitesEnabled: false,
  academicFastTrackEnabled: false,
  academicDomainPatterns: ["edu", "ac.uk"],
  onboardingWizardEnabled: false,
  maintenanceMode: false,
  maintenanceLevel: "off",
  maintenanceEta: "",
  maintenanceStartedAt: "",
  announcementBanner: "",
  announcementLevel: "info",
  needsSetup: false,
  setupCompleted: true,
  buildVersion: "",
  updateAvailable: false,
  subsystems: {
    coreApi: "operational",
    packageRegistry: "operational",
    cloudSolvers: "operational",
    federationQueue: "operational",
    wasmSandbox: "operational",
  },
  previewPublicMaintenance: false,
  loaded: false,
};

const InstanceBrandingContext = createContext<InstanceBrandingState>({
  ...DEFAULT_BRANDING,
  dismissUpdateAvailable: () => {},
  setPreviewPublicMaintenance: () => {},
  refreshBranding: async () => {},
  applyOptimisticBranding: () => {},
});

export const useInstanceBranding = (): InstanceBrandingState => useContext(InstanceBrandingContext);

export function notifyInstanceBrandingUpdated(patch?: Partial<PublicInstanceBannerResponse>): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("modelscript:branding-updated", { detail: patch }));
  }
}

export const InstanceBrandingProvider: React.FC<{
  children: React.ReactNode;
  initialBranding?: Partial<typeof DEFAULT_BRANDING>;
}> = ({ children, initialBranding }) => {
  const [state, setState] = useState(() => ({
    ...DEFAULT_BRANDING,
    ...initialBranding,
  }));
  const initialBuildVersionRef = useRef<string | null>(
    initialBranding?.buildVersion?.trim() ? initialBranding.buildVersion.trim() : null,
  );

  const applyBannerPayload = useCallback((res: Partial<PublicInstanceBannerResponse>, markLoaded = true) => {
    const incomingBuildVersion =
      typeof res.buildVersion === "string" && res.buildVersion.trim() ? res.buildVersion.trim() : null;
    let versionMismatch = false;
    if (incomingBuildVersion) {
      if (!initialBuildVersionRef.current) {
        initialBuildVersionRef.current = incomingBuildVersion;
      } else if (initialBuildVersionRef.current !== incomingBuildVersion) {
        versionMismatch = true;
      }
    }

    setState((prev) => {
      const nextName = res.instanceName?.trim() || prev.instanceName || "Ansatz";
      setActiveBrandName(nextName);
      const nextMaintMode = res.maintenanceMode !== undefined ? Boolean(res.maintenanceMode) : prev.maintenanceMode;
      const nextMaintLevel =
        res.maintenanceLevel !== undefined
          ? res.maintenanceLevel
          : res.maintenanceMode !== undefined
            ? res.maintenanceMode
              ? prev.maintenanceLevel === "lockdown"
                ? "lockdown"
                : "read_only"
              : "off"
            : prev.maintenanceLevel;
      return {
        ...prev,
        instanceName: nextName,
        instanceBadge: res.instanceBadge !== undefined ? res.instanceBadge : prev.instanceBadge,
        instanceTagline:
          res.instanceTagline?.trim() || prev.instanceTagline || "The Federated Scientific & Engineering Network",
        instanceDescription: res.instanceDescription ?? prev.instanceDescription,
        contactEmail: res.contactEmail ?? prev.contactEmail,
        brandLogoUrl: res.brandLogoUrl !== undefined ? res.brandLogoUrl : prev.brandLogoUrl,
        brandLogoDarkUrl: res.brandLogoDarkUrl !== undefined ? res.brandLogoDarkUrl : prev.brandLogoDarkUrl,
        brandFaviconUrl: res.brandFaviconUrl !== undefined ? res.brandFaviconUrl : prev.brandFaviconUrl,
        brandAccentColor: res.brandAccentColor !== undefined ? res.brandAccentColor : prev.brandAccentColor,
        docsBaseUrl: res.docsBaseUrl?.trim() || prev.docsBaseUrl || "https://modelscript.org",
        showPoweredBy: res.showPoweredBy !== undefined ? Boolean(res.showPoweredBy) : prev.showPoweredBy,
        registrationMode: res.registrationMode ?? prev.registrationMode,
        federationMode: res.federationMode ?? prev.federationMode,
        waitlistEnabled: res.waitlistEnabled !== undefined ? Boolean(res.waitlistEnabled) : prev.waitlistEnabled,
        userInvitesEnabled:
          res.userInvitesEnabled !== undefined ? Boolean(res.userInvitesEnabled) : prev.userInvitesEnabled,
        academicFastTrackEnabled:
          res.academicFastTrackEnabled !== undefined
            ? Boolean(res.academicFastTrackEnabled)
            : prev.academicFastTrackEnabled,
        academicDomainPatterns: res.academicDomainPatterns ?? prev.academicDomainPatterns,
        onboardingWizardEnabled:
          res.onboardingWizardEnabled !== undefined
            ? Boolean(res.onboardingWizardEnabled)
            : prev.onboardingWizardEnabled,
        maintenanceMode: nextMaintMode,
        maintenanceLevel: nextMaintLevel,
        maintenanceEta: res.maintenanceEta !== undefined ? res.maintenanceEta : prev.maintenanceEta,
        maintenanceStartedAt:
          res.maintenanceStartedAt !== undefined ? res.maintenanceStartedAt : prev.maintenanceStartedAt,
        announcementBanner: res.announcementBanner ?? prev.announcementBanner,
        announcementLevel: res.announcementLevel ?? prev.announcementLevel,
        needsSetup: res.needsSetup !== undefined ? Boolean(res.needsSetup) : prev.needsSetup,
        setupCompleted: res.setupCompleted !== undefined ? Boolean(res.setupCompleted) : prev.setupCompleted,
        buildVersion: incomingBuildVersion ?? prev.buildVersion,
        updateAvailable: versionMismatch ? true : prev.updateAvailable,
        subsystems: res.subsystems ?? prev.subsystems,
        previewPublicMaintenance: nextMaintMode ? prev.previewPublicMaintenance : false,
        loaded: markLoaded ? true : prev.loaded,
      };
    });
  }, []);

  const refreshBranding = useCallback(async () => {
    try {
      const res = await getPublicInstanceBanner();
      applyBannerPayload(res, true);
    } catch {
      setState((prev) => ({ ...prev, loaded: true }));
    }
  }, [applyBannerPayload]);

  useEffect(() => {
    void refreshBranding();
  }, [refreshBranding]);

  useEffect(() => {
    const handleUpdated = (e: Event) => {
      const custom = e as CustomEvent<Partial<PublicInstanceBannerResponse> | undefined>;
      if (custom.detail && typeof custom.detail === "object") {
        applyBannerPayload(custom.detail, true);
      } else {
        void refreshBranding();
      }
    };
    window.addEventListener("modelscript:branding-updated", handleUpdated);
    return () => window.removeEventListener("modelscript:branding-updated", handleUpdated);
  }, [applyBannerPayload, refreshBranding]);

  // Apply custom accent color and favicon to document head / root CSS variables
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (state.brandAccentColor && /^#[0-9a-fA-F]{3,8}$/.test(state.brandAccentColor.trim())) {
      const accent = state.brandAccentColor.trim();
      root.style.setProperty("--color-accent-cyan", accent);
      root.style.setProperty("--ms-brand", accent);
      root.style.setProperty("--ms-brand-hover", `color-mix(in srgb, ${accent} 85%, white)`);
    } else {
      root.style.removeProperty("--color-accent-cyan");
      root.style.removeProperty("--ms-brand");
      root.style.removeProperty("--ms-brand-hover");
    }

    if (state.brandFaviconUrl?.trim()) {
      const links = document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]');
      links.forEach((link) => {
        link.href = state.brandFaviconUrl.trim();
      });
    }
  }, [state.brandAccentColor, state.brandFaviconUrl]);

  const setPreviewPublicMaintenance = useCallback((preview: boolean) => {
    setState((prev) => ({ ...prev, previewPublicMaintenance: preview }));
  }, []);

  const dismissUpdateAvailable = useCallback(() => {
    setState((prev) => ({ ...prev, updateAvailable: false }));
  }, []);

  const contextValue = useMemo<InstanceBrandingState>(
    () => ({
      ...state,
      dismissUpdateAvailable,
      setPreviewPublicMaintenance,
      refreshBranding,
      applyOptimisticBranding: (patch) => applyBannerPayload(patch, true),
    }),
    [state, dismissUpdateAvailable, setPreviewPublicMaintenance, refreshBranding, applyBannerPayload],
  );

  return <InstanceBrandingContext.Provider value={contextValue}>{children}</InstanceBrandingContext.Provider>;
};
