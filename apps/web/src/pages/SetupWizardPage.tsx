// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CheckCircleIcon,
  EyeClosedIcon,
  EyeIcon,
  LockIcon,
  RocketIcon,
  ShieldCheckIcon,
  UploadIcon,
} from "@primer/octicons-react";
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  completeInstanceSetup,
  getInstanceSetupStatus,
  resetInstanceSetupWizard,
  type AdminInstanceInvite,
  type AdminInstanceSettings,
  type InstanceSetupStatus,
} from "../api/admin";
import AnsatzMark from "../components/AnsatzLogo";
import { notifyInstanceBrandingUpdated } from "../InstanceBrandingContext";

export interface SetupWizardPageProps {
  initialStatus?: InstanceSetupStatus | null;
  onLoginSuccess?: (
    token: string,
    user: { id: number; username: string; email: string; display_name?: string; account_type?: string },
  ) => void;
}

const DEFAULT_PRESETS: InstanceSetupStatus["presets"] = {
  tier0_local_dev: {
    id: "tier0_local_dev",
    label: "Tier 0: Ansatz Local (Offline Developer Sandbox)",
    description: "Standalone workstation modeling with open local signup and zero internet dependencies.",
    registrationMode: "open",
    federationMode: "disabled",
    autoQuarantineReportThreshold: 10,
    backupRetentionCount: 3,
    defaultInstanceName: "Ansatz Local",
    defaultInstanceBadge: "Local",
    defaultDocsBaseUrl: "/docs",
    defaultShowPoweredBy: false,
    waitlistEnabled: false,
    userInvitesEnabled: false,
    onboardingWizardEnabled: false,
    academicFastTrackEnabled: false,
  },
  tier1_federated: {
    id: "tier1_federated",
    label: "Tier 1: Ansatz Lab (Independent Federated Node)",
    description: "Invite-only registration with open ActivityPub federation for research labs and teams.",
    registrationMode: "invite_only",
    federationMode: "open",
    autoQuarantineReportThreshold: 3,
    backupRetentionCount: 7,
    defaultInstanceName: "Ansatz Lab",
    defaultInstanceBadge: "Lab",
    defaultDocsBaseUrl: "https://modelscript.org",
    defaultShowPoweredBy: true,
    waitlistEnabled: false,
    userInvitesEnabled: true,
    onboardingWizardEnabled: true,
    academicFastTrackEnabled: true,
  },
  tier2_corporate: {
    id: "tier2_corporate",
    label: "Tier 2: Ansatz Enterprise (Corporate Intranet / Air-Gapped Appliance)",
    description: "Email domain allowlist with outbound federation disabled for internal R&D intranets.",
    registrationMode: "domain_allowlist",
    federationMode: "disabled",
    autoQuarantineReportThreshold: 5,
    backupRetentionCount: 14,
    defaultInstanceName: "Ansatz Enterprise",
    defaultInstanceBadge: "Enterprise",
    defaultDocsBaseUrl: "/docs",
    defaultShowPoweredBy: true,
    waitlistEnabled: false,
    userInvitesEnabled: false,
    onboardingWizardEnabled: false,
    academicFastTrackEnabled: false,
  },
  tier3_flagship: {
    id: "tier3_flagship",
    label: "Tier 3: Ansatz Social (Public Community Hub)",
    description: "Open public registration with ActivityPub federation, waitlist, and peer invites.",
    registrationMode: "open",
    federationMode: "open",
    autoQuarantineReportThreshold: 5,
    backupRetentionCount: 30,
    defaultInstanceName: "Ansatz",
    defaultInstanceBadge: "",
    defaultDocsBaseUrl: "https://modelscript.org",
    defaultShowPoweredBy: true,
    waitlistEnabled: true,
    userInvitesEnabled: true,
    onboardingWizardEnabled: true,
    academicFastTrackEnabled: true,
  },
};

const TIER_SUMMARY_BADGE: Record<string, string> = {
  tier0_local_dev: "Offline · Local Only",
  tier1_federated: "Invite-Only · Federated",
  tier2_corporate: "Domain Allowlist · Private",
  tier3_flagship: "Open Signup · Federated",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  borderRadius: "8px",
  border: "1px solid var(--color-border-default)",
  backgroundColor: "var(--color-canvas-default)",
  color: "var(--color-fg-default)",
  fontSize: "13.5px",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "12px",
  fontWeight: 600,
  marginBottom: "5px",
  color: "var(--color-fg-default)",
};

export const SetupWizardPage: React.FC<SetupWizardPageProps> = ({ initialStatus = null, onLoginSuccess }) => {
  const navigate = useNavigate();

  const [status, setStatus] = useState<InstanceSetupStatus | null>(initialStatus);
  const [loading, setLoading] = useState<boolean>(!initialStatus);
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Deployment Tier & Optional Migration Bundle
  const [selectedTier, setSelectedTier] = useState<
    "tier0_local_dev" | "tier1_federated" | "tier2_corporate" | "tier3_flagship"
  >("tier1_federated");
  const [migrationBundle, setMigrationBundle] = useState<Record<string, unknown> | null>(null);
  const [migrationFileName, setMigrationFileName] = useState<string | null>(null);

  // Founding Administrator Account (essential fields only)
  const [adminUsername, setAdminUsername] = useState("admin");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Instance Identity & Core Policies
  const [instanceName, setInstanceName] = useState(initialStatus?.settings.instanceName || "Ansatz");
  const [instanceNameTouched, setInstanceNameTouched] = useState(false);
  const [instanceBadge, setInstanceBadge] = useState(initialStatus?.settings.instanceBadge ?? "");
  const [registrationMode, setRegistrationMode] = useState<"open" | "invite_only" | "domain_allowlist" | "closed">(
    initialStatus?.settings.registrationMode || "invite_only",
  );
  const [allowedDomainsInput, setAllowedDomainsInput] = useState(
    initialStatus?.settings.allowedEmailDomains?.join(", ") || "",
  );
  const [federationMode, setFederationMode] = useState<"open" | "allowlist" | "disabled">(
    (initialStatus?.settings.federationMode as "open" | "allowlist" | "disabled") || "open",
  );
  const [ingressMode, setIngressMode] = useState<"direct" | "cloudflare">("direct");
  const [tunnelToken, setTunnelToken] = useState("");

  // Completion Summary State
  const [completedResult, setCompletedResult] = useState<{
    settings: AdminInstanceSettings;
    invites: AdminInstanceInvite[];
    backupSnapshot: { fileName: string; sizeBytes: number; sha256: string; createdAt: string } | null;
    adminUsername: string;
  } | null>(null);

  const applyLoadedStatus = (res: InstanceSetupStatus) => {
    setStatus(res);
    setInstanceName(res.settings.instanceName || "Ansatz");
    setInstanceBadge(res.settings.instanceBadge ?? "");
    if (res.settings.registrationMode) {
      setRegistrationMode(res.settings.registrationMode);
    }
    if (
      res.settings.federationMode === "open" ||
      res.settings.federationMode === "allowlist" ||
      res.settings.federationMode === "disabled"
    ) {
      setFederationMode(res.settings.federationMode);
    }
    if (res.settings.ingressMode === "cloudflare" || res.settings.ingressMode === "direct") {
      setIngressMode(res.settings.ingressMode);
    }
    if (res.reopened) {
      setAdminEmail((prev) => prev || res.settings.contactEmail || "admin@ansatz.local");
      setAdminPassword((prev) => prev || "password123");
    }
    if (res.airgapEnforced) {
      setSelectedTier("tier2_corporate");
      setRegistrationMode("domain_allowlist");
      setFederationMode("disabled");
      setInstanceName(res.presets?.tier2_corporate?.defaultInstanceName || "Ansatz Enterprise");
      setInstanceBadge(res.presets?.tier2_corporate?.defaultInstanceBadge ?? "Enterprise");
    }
  };

  useEffect(() => {
    const onSetupReset = (ev: Event) => {
      const detail = (ev as CustomEvent<InstanceSetupStatus | undefined>).detail;
      setCompletedResult(null);
      setError(null);
      if (detail && detail.settings) {
        applyLoadedStatus(detail);
      } else {
        void getInstanceSetupStatus()
          .then(applyLoadedStatus)
          .catch(() => {});
      }
    };
    if (typeof window !== "undefined") {
      window.addEventListener("modelscript:setup-reset", onSetupReset);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("modelscript:setup-reset", onSetupReset);
      }
    };
  }, []);

  useEffect(() => {
    if (initialStatus) return;
    let mounted = true;
    getInstanceSetupStatus()
      .then((res) => {
        if (!mounted) return;
        applyLoadedStatus(res);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : "Failed to load setup status");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [initialStatus]);

  const handleRerunWizard = async () => {
    setError(null);
    try {
      const res = await resetInstanceSetupWizard();
      setCompletedResult(null);
      applyLoadedStatus(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to re-open setup wizard");
    }
  };

  const applyTierPreset = (tierId: "tier0_local_dev" | "tier1_federated" | "tier2_corporate" | "tier3_flagship") => {
    setSelectedTier(tierId);
    const presets = status?.presets || DEFAULT_PRESETS;
    const p = presets[tierId];
    if (p) {
      setRegistrationMode(p.registrationMode);
      setFederationMode(p.federationMode);
      if (!instanceNameTouched) {
        const name = p.defaultInstanceName ?? (p as { instanceName?: string }).instanceName;
        if (name !== undefined) setInstanceName(name);
      }
      const badge = p.defaultInstanceBadge ?? (p as { instanceBadge?: string }).instanceBadge;
      if (badge !== undefined) setInstanceBadge(badge);
    }
  };

  const handleBundleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        setMigrationBundle(parsed);
        setMigrationFileName(file.name);
        if (parsed.settings && typeof parsed.settings === "object") {
          if (parsed.settings.instanceName) {
            setInstanceName(String(parsed.settings.instanceName));
            setInstanceNameTouched(true);
          }
          if (parsed.settings.instanceBadge !== undefined) setInstanceBadge(String(parsed.settings.instanceBadge));
          if (parsed.settings.registrationMode) setRegistrationMode(parsed.settings.registrationMode);
          if (parsed.settings.federationMode) setFederationMode(parsed.settings.federationMode);
        }
        setError(null);
      } catch {
        setError("Invalid JSON migration bundle file");
      }
    };
    reader.readAsText(file);
  };

  const handleCompleteSetup = async () => {
    setError(null);
    if (!status?.hasAdmin) {
      if (!adminUsername.trim() || !/^[a-zA-Z0-9_-]{2,32}$/.test(adminUsername.trim())) {
        setError("Administrator username must be 2–32 alphanumeric characters.");
        return;
      }
      if (!adminEmail.trim() || !adminEmail.includes("@")) {
        setError("Please enter a valid administrator email address.");
        return;
      }
      if (adminPassword.length < 8) {
        setError("Administrator password must be at least 8 characters.");
        return;
      }
    }
    setSubmitting(true);
    try {
      const allowedEmailDomains = allowedDomainsInput
        .split(",")
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean);

      const trimmedTunnelToken = ingressMode === "cloudflare" && tunnelToken.trim() ? tunnelToken.trim() : undefined;
      const presets = status?.presets || DEFAULT_PRESETS;
      const activePreset = presets[selectedTier] || DEFAULT_PRESETS.tier1_federated;

      const res = await completeInstanceSetup({
        profileTier: selectedTier,
        ingressMode,
        ...(trimmedTunnelToken ? { tunnelToken: trimmedTunnelToken } : {}),
        ...(status?.hasAdmin
          ? {}
          : {
              admin: {
                username: adminUsername.trim(),
                email: adminEmail.trim(),
                password: adminPassword,
              },
            }),
        settings: {
          instanceName: instanceName.trim() || "Ansatz",
          instanceBadge: instanceBadge.trim(),
          contactEmail: adminEmail.trim() || status?.settings.contactEmail || "admin@ansatz.local",
          registrationMode,
          allowedEmailDomains,
          federationMode,
          ingressMode,
          ...(trimmedTunnelToken ? { tunnelToken: trimmedTunnelToken, cloudflareTunnelConfigured: true } : {}),
          autoQuarantineReportThreshold: activePreset.autoQuarantineReportThreshold,
          backupRetentionCount: activePreset.backupRetentionCount,
        },
        initialInvitesCount: registrationMode === "invite_only" ? 3 : 0,
        initialInviteMaxUses: 5,
        initialInviteCredits: 100,
        initialInviteRole: "user",
        createInitialBackup: true,
        migrationBundle,
      });

      notifyInstanceBrandingUpdated(res.settings);

      if (res.token && res.user) {
        try {
          if (typeof window !== "undefined" && window.localStorage) {
            window.localStorage.setItem("modelscript-auth-token", res.token);
            window.localStorage.setItem("token", res.token);
            window.localStorage.setItem("user", JSON.stringify(res.user));
          }
        } catch {
          // ignore storage errors
        }
        if (onLoginSuccess) {
          onLoginSuccess(res.token, {
            id: res.user.id,
            username: res.user.username,
            email: res.user.email,
            display_name: res.user.display_name || undefined,
            account_type: res.user.account_type,
          });
        }
      }

      setCompletedResult({
        settings: res.settings,
        invites: res.invites || [],
        backupSnapshot: res.backupSnapshot,
        adminUsername: res.user.username,
      });
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (err instanceof Error ? err.message : "Failed to complete instance setup");
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: "48px 24px", maxWidth: "720px", margin: "0 auto", textAlign: "center" }}>
        <p style={{ color: "var(--color-fg-muted)" }}>Inspecting instance initialization state...</p>
      </div>
    );
  }

  if (status && !status.needsSetup && !completedResult) {
    return (
      <div
        style={{
          padding: "40px 24px",
          maxWidth: "620px",
          margin: "48px auto",
          border: "1px solid var(--color-border-default)",
          borderRadius: "14px",
          backgroundColor: "var(--color-canvas-subtle)",
          textAlign: "center",
        }}
      >
        <ShieldCheckIcon size={36} />
        <h2 style={{ margin: "12px 0 8px", fontSize: "20px", fontWeight: 700 }}>Instance Setup Already Completed</h2>
        <p style={{ margin: "0 0 20px", fontSize: "14px", color: "var(--color-fg-muted)" }}>
          This {status.settings.instanceName || "Ansatz"} instance (<strong>{status.settings.instanceName}</strong>) is
          configured and its first-boot setup endpoint is locked.
        </p>
        <div style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => navigate("/")}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              border: "none",
              backgroundColor: "var(--color-accent-emphasis)",
              color: "#ffffff",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Open Workspace
          </button>
          <button
            type="button"
            onClick={() => navigate("/admin")}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              border: "1px solid var(--color-border-default)",
              backgroundColor: "var(--color-canvas-default)",
              color: "var(--color-fg-default)",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Instance Admin Console
          </button>
          <button
            type="button"
            onClick={() => void handleRerunWizard()}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              border: "1px solid var(--color-border-default)",
              backgroundColor: "var(--color-canvas-default)",
              color: "var(--color-fg-muted)",
              fontWeight: 600,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <RocketIcon size={14} /> Re-run Setup Wizard
          </button>
        </div>
      </div>
    );
  }

  const presets = status?.presets || DEFAULT_PRESETS;

  return (
    <div style={{ padding: "32px 20px", maxWidth: "760px", margin: "0 auto" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "12px",
          marginBottom: "20px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <AnsatzMark size={38} accentColor="#06b6d4" />
          <div>
            <h1 style={{ margin: 0, fontSize: "21px", fontWeight: 800 }}>
              {instanceName || "Ansatz"} First-Run Install Wizard
            </h1>
            <p style={{ margin: "2px 0 0", fontSize: "13px", color: "var(--color-fg-muted)" }}>
              Choose a deployment profile and create your founding administrator account.
            </p>
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <label
            style={{
              padding: "5px 10px",
              borderRadius: "6px",
              border: "1px solid var(--color-border-default)",
              backgroundColor: "var(--color-canvas-subtle)",
              fontSize: "11.5px",
              fontWeight: 600,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
            }}
            title="Restore settings from an exported JSON migration bundle"
          >
            <UploadIcon size={12} />
            <span>{migrationFileName ? `Bundle: ${migrationFileName}` : "Upload Bundle (.json)"}</span>
            <input
              type="file"
              accept=".json,application/json"
              onChange={handleBundleUpload}
              style={{ display: "none" }}
            />
          </label>
          {status?.airgapEnforced && (
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                padding: "4px 10px",
                borderRadius: "999px",
                backgroundColor: "rgba(210, 153, 34, 0.15)",
                color: "var(--color-attention-fg)",
              }}
            >
              Air-Gap Enforced
            </span>
          )}
        </div>
      </div>

      {/* Completion Screen */}
      {completedResult ? (
        <div
          style={{
            border: "1px solid var(--color-border-default)",
            borderRadius: "12px",
            padding: "24px",
            backgroundColor: "var(--color-canvas-subtle)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
            <span style={{ color: "var(--color-success-fg)", display: "flex" }}>
              <CheckCircleIcon size={22} />
            </span>
            <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}>Instance Ready — Setup Wizard Locked</h2>
          </div>
          <p style={{ margin: "0 0 18px", fontSize: "13.5px", color: "var(--color-fg-muted)" }}>
            <strong>{completedResult.settings.instanceName}</strong> is live and signed in as{" "}
            <code>@{completedResult.adminUsername}</code>.
          </p>

          {completedResult.invites.length > 0 && (
            <div style={{ marginBottom: "18px" }}>
              <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-fg-muted)", marginBottom: "6px" }}>
                Starter Invitation Codes ({completedResult.invites.length})
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {completedResult.invites.map((inv) => (
                  <code
                    key={inv.code}
                    style={{
                      padding: "5px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border-default)",
                      backgroundColor: "var(--color-canvas-default)",
                      fontSize: "12px",
                      fontWeight: 600,
                    }}
                  >
                    {inv.code}
                  </code>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => navigate("/home")}
              style={{
                padding: "9px 18px",
                borderRadius: "8px",
                border: "none",
                backgroundColor: "var(--color-accent-emphasis)",
                color: "#ffffff",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Open Engineering Workspace →
            </button>
            <button
              type="button"
              onClick={() => navigate("/admin")}
              style={{
                padding: "9px 16px",
                borderRadius: "8px",
                border: "1px solid var(--color-border-default)",
                backgroundColor: "var(--color-canvas-default)",
                color: "var(--color-fg-default)",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Launch Instance Admin Console
            </button>
          </div>
        </div>
      ) : (
        <>
          {error && (
            <div
              role="alert"
              style={{
                marginBottom: "16px",
                padding: "10px 14px",
                borderRadius: "8px",
                border: "1px solid rgba(248, 81, 73, 0.4)",
                backgroundColor: "rgba(248, 81, 73, 0.1)",
                color: "var(--color-danger-fg)",
                fontSize: "13px",
              }}
            >
              {error}
            </div>
          )}

          {/* Section 1: Compact 2x2 Deployment Profile Grid */}
          <div
            style={{
              border: "1px solid var(--color-border-default)",
              borderRadius: "12px",
              padding: "18px 20px",
              backgroundColor: "var(--color-canvas-subtle)",
              marginBottom: "16px",
            }}
          >
            <div style={{ fontSize: "14px", fontWeight: 700, marginBottom: "12px" }}>1. Deployment Profile</div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))",
                gap: "10px",
              }}
            >
              {(["tier0_local_dev", "tier1_federated", "tier2_corporate", "tier3_flagship"] as const).map((tierKey) => {
                const p = presets[tierKey];
                const isSelected = selectedTier === tierKey;
                return (
                  <button
                    key={tierKey}
                    type="button"
                    onClick={() => applyTierPreset(tierKey)}
                    style={{
                      padding: "12px 14px",
                      borderRadius: "10px",
                      border: isSelected
                        ? "2px solid var(--color-accent-emphasis)"
                        : "1px solid var(--color-border-default)",
                      backgroundColor: isSelected ? "var(--color-accent-subtle)" : "var(--color-canvas-default)",
                      color: "var(--color-fg-default)",
                      cursor: "pointer",
                      textAlign: "left",
                      display: "flex",
                      flexDirection: "column",
                      gap: "4px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: "8px",
                      }}
                    >
                      <span style={{ fontSize: "13px", fontWeight: 700 }}>{p.label}</span>
                    </div>
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 600,
                        color: "var(--color-accent-fg)",
                      }}
                    >
                      {TIER_SUMMARY_BADGE[tierKey]}
                    </span>
                    <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--color-fg-muted)", lineHeight: 1.4 }}>
                      {p.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section 2: Founding Administrator & Instance Name */}
          <div
            style={{
              border: "1px solid var(--color-border-default)",
              borderRadius: "12px",
              padding: "18px 20px",
              backgroundColor: "var(--color-canvas-subtle)",
              marginBottom: "14px",
            }}
          >
            {status?.hasAdmin ? (
              <div data-testid="setup-existing-admin-card">
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                  <span style={{ color: "var(--color-success-fg)", display: "flex" }}>
                    <ShieldCheckIcon size={18} />
                  </span>
                  <span style={{ fontSize: "14px", fontWeight: 700 }}>
                    Founding Administrator Account Already Configured
                  </span>
                </div>
                <p style={{ margin: "0 0 12px", fontSize: "12.5px", color: "var(--color-fg-muted)" }}>
                  Your existing administrator credentials will be preserved while updating your instance profile.
                </p>
                <div>
                  <label htmlFor="setup-instance-name" style={labelStyle}>
                    Instance Name
                  </label>
                  <input
                    id="setup-instance-name"
                    type="text"
                    aria-label="Instance Brand Name"
                    value={instanceName}
                    onChange={(e) => {
                      setInstanceName(e.target.value);
                      setInstanceNameTouched(true);
                    }}
                    placeholder="Ansatz"
                    style={inputStyle}
                  />
                </div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: "14px", fontWeight: 700, marginBottom: "12px" }}>
                  2. Instance Name &amp; Administrator Account
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
                  <div>
                    <label htmlFor="setup-instance-name" style={labelStyle}>
                      Instance Name
                    </label>
                    <input
                      id="setup-instance-name"
                      type="text"
                      aria-label="Instance Brand Name"
                      value={instanceName}
                      onChange={(e) => {
                        setInstanceName(e.target.value);
                        setInstanceNameTouched(true);
                      }}
                      placeholder="Ansatz"
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label htmlFor="setup-admin-username" style={labelStyle}>
                      Admin Username
                    </label>
                    <input
                      id="setup-admin-username"
                      type="text"
                      value={adminUsername}
                      onChange={(e) => setAdminUsername(e.target.value)}
                      placeholder="admin"
                      style={inputStyle}
                    />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <div>
                    <label htmlFor="setup-admin-email" style={labelStyle}>
                      Admin Email Address
                    </label>
                    <input
                      id="setup-admin-email"
                      type="email"
                      value={adminEmail}
                      onChange={(e) => setAdminEmail(e.target.value)}
                      placeholder="admin@yourdomain.org"
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label htmlFor="setup-admin-password" style={labelStyle}>
                      Admin Password (min 8 chars)
                    </label>
                    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                      <input
                        id="setup-admin-password"
                        type={showPassword ? "text" : "password"}
                        value={adminPassword}
                        onChange={(e) => setAdminPassword(e.target.value)}
                        placeholder="Minimum 8 characters"
                        style={{ ...inputStyle, paddingRight: "36px" }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((prev) => !prev)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        style={{
                          position: "absolute",
                          right: "8px",
                          background: "none",
                          border: "none",
                          color: "var(--color-fg-muted)",
                          cursor: "pointer",
                          padding: "4px",
                          display: "flex",
                        }}
                      >
                        {showPassword ? <EyeClosedIcon size={15} /> : <EyeIcon size={15} />}
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Optional Registration, Federation & Ingress Overrides */}
          <div style={{ marginBottom: "14px" }}>
            <button
              type="button"
              onClick={() => setShowAdvancedOptions((prev) => !prev)}
              style={{
                background: "none",
                border: "none",
                padding: "4px 0",
                color: "var(--color-fg-muted)",
                fontSize: "12.5px",
                fontWeight: 600,
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              {showAdvancedOptions
                ? "Hide custom registration, federation & tunnel options ▲"
                : "Customize registration, federation or Cloudflare Tunnel options ▼"}
            </button>
          </div>

          {showAdvancedOptions && (
            <div
              style={{
                border: "1px solid var(--color-border-default)",
                borderRadius: "12px",
                padding: "16px 20px",
                backgroundColor: "var(--color-canvas-subtle)",
                marginBottom: "16px",
              }}
            >
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
                <div>
                  <label htmlFor="setup-registration-mode" style={labelStyle}>
                    Registration Policy
                  </label>
                  <select
                    id="setup-registration-mode"
                    value={registrationMode}
                    onChange={(e) =>
                      setRegistrationMode(e.target.value as "open" | "invite_only" | "domain_allowlist" | "closed")
                    }
                    style={inputStyle}
                  >
                    <option value="invite_only">Invite-Only (Require Invitation Token)</option>
                    <option value="domain_allowlist">Corporate Email Domain Allowlist</option>
                    <option value="open">Open Public Registration</option>
                    <option value="closed">Closed (Admin Provisioning Only)</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="setup-federation-mode" style={labelStyle}>
                    ActivityPub Federation
                  </label>
                  <select
                    id="setup-federation-mode"
                    value={federationMode}
                    onChange={(e) => setFederationMode(e.target.value as "open" | "allowlist" | "disabled")}
                    style={inputStyle}
                  >
                    <option value="open">Open Federation</option>
                    <option value="allowlist">Trusted Peer Allowlist Only</option>
                    <option value="disabled">Disabled (Private / Air-Gapped)</option>
                  </select>
                </div>
              </div>

              {registrationMode === "domain_allowlist" && (
                <div style={{ marginBottom: "12px" }}>
                  <label htmlFor="setup-allowed-domains" style={labelStyle}>
                    Allowed Email Domains (comma-separated)
                  </label>
                  <input
                    id="setup-allowed-domains"
                    type="text"
                    value={allowedDomainsInput}
                    onChange={(e) => setAllowedDomainsInput(e.target.value)}
                    placeholder="corp.example.com, lab.university.edu"
                    style={inputStyle}
                  />
                </div>
              )}

              <div>
                <label style={labelStyle}>Network Ingress</label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  <button
                    type="button"
                    onClick={() => setIngressMode("direct")}
                    style={{
                      padding: "8px 12px",
                      borderRadius: "8px",
                      textAlign: "left",
                      cursor: "pointer",
                      border:
                        ingressMode === "direct"
                          ? "2px solid var(--color-accent-emphasis)"
                          : "1px solid var(--color-border-default)",
                      backgroundColor:
                        ingressMode === "direct" ? "var(--color-accent-subtle)" : "var(--color-canvas-default)",
                      color: "var(--color-fg-default)",
                      fontSize: "12.5px",
                      fontWeight: 600,
                    }}
                  >
                    Direct Public Ingress (Ports 80/443)
                  </button>
                  <button
                    type="button"
                    onClick={() => setIngressMode("cloudflare")}
                    style={{
                      padding: "8px 12px",
                      borderRadius: "8px",
                      textAlign: "left",
                      cursor: "pointer",
                      border:
                        ingressMode === "cloudflare"
                          ? "2px solid var(--color-accent-emphasis)"
                          : "1px solid var(--color-border-default)",
                      backgroundColor:
                        ingressMode === "cloudflare" ? "var(--color-accent-subtle)" : "var(--color-canvas-default)",
                      color: "var(--color-fg-default)",
                      fontSize: "12.5px",
                      fontWeight: 600,
                    }}
                  >
                    Cloudflare Tunnel (Zero Open Ports)
                  </button>
                </div>

                {ingressMode === "cloudflare" && (
                  <div style={{ marginTop: "10px" }}>
                    <label htmlFor="setup-tunnel-token" style={labelStyle}>
                      Cloudflare Tunnel Token (optional if set in .env)
                    </label>
                    <input
                      id="setup-tunnel-token"
                      type="password"
                      value={tunnelToken}
                      onChange={(e) => setTunnelToken(e.target.value)}
                      placeholder="eyJh..."
                      style={inputStyle}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Setup Action Footer */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: "16px",
              flexWrap: "wrap",
              gap: "12px",
            }}
          >
            <span style={{ fontSize: "12px", color: "var(--color-fg-muted)" }}>
              Branding, logos, invites, and backups can be customized anytime in Instance Admin.
            </span>
            <button
              type="button"
              disabled={submitting}
              onClick={handleCompleteSetup}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                padding: "10px 22px",
                borderRadius: "8px",
                border: "none",
                backgroundColor: "var(--color-success-emphasis)",
                color: "#ffffff",
                fontSize: "13.5px",
                fontWeight: 700,
                cursor: submitting ? "wait" : "pointer",
              }}
            >
              <LockIcon size={14} />
              {submitting ? "Initializing & Locking Setup..." : "Complete Instance Setup & Sign In"}
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default SetupWizardPage;
