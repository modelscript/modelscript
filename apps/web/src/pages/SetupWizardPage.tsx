// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CheckCircleIcon,
  DatabaseIcon,
  GlobeIcon,
  KeyIcon,
  LockIcon,
  PersonAddIcon,
  RocketIcon,
  ServerIcon,
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
  tier1_federated: {
    id: "tier1_federated",
    label: "Tier 1: Independent Federated Node",
    description:
      "Invite-only registration with open ActivityPub S2S federation. Ideal for research labs, small teams, and self-hosted federated operators.",
    registrationMode: "invite_only",
    federationMode: "open",
    autoQuarantineReportThreshold: 3,
    backupRetentionCount: 7,
    instanceName: "Ansatz",
    instanceBadge: "Lab",
    instanceTagline: "Federated Scientific & Engineering Node",
    showPoweredBy: true,
  },
  tier2_corporate: {
    id: "tier2_corporate",
    label: "Tier 2: Corporate Intranet / Air-Gapped Appliance",
    description:
      "Email domain allowlist registration with outbound ActivityPub federation disabled. Ideal for internal R&D intranets and classified SCIF/air-gapped appliances.",
    registrationMode: "domain_allowlist",
    federationMode: "disabled",
    autoQuarantineReportThreshold: 5,
    backupRetentionCount: 14,
    instanceName: "Engineering Intranet",
    instanceBadge: "Internal",
    instanceTagline: "Private R&D Modeling & Simulation Appliance",
    showPoweredBy: false,
  },
  tier3_flagship: {
    id: "tier3_flagship",
    label: "Tier 3: Public Flagship Hub",
    description:
      "Open registration with anti-Sybil verification, open ActivityPub federation, and automated report threshold quarantine. Ideal for large public hubs.",
    registrationMode: "open",
    federationMode: "open",
    autoQuarantineReportThreshold: 5,
    backupRetentionCount: 30,
    instanceName: "Ansatz",
    instanceBadge: "",
    instanceTagline: "The Federated Scientific & Engineering Network",
    showPoweredBy: true,
  },
};

export const SetupWizardPage: React.FC<SetupWizardPageProps> = ({ initialStatus = null, onLoginSuccess }) => {
  const navigate = useNavigate();

  const [status, setStatus] = useState<InstanceSetupStatus | null>(initialStatus);
  const [loading, setLoading] = useState<boolean>(!initialStatus);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1: Tier Preset & Optional Migration Bundle
  const [selectedTier, setSelectedTier] = useState<"tier1_federated" | "tier2_corporate" | "tier3_flagship">(
    "tier1_federated",
  );
  const [migrationBundle, setMigrationBundle] = useState<Record<string, unknown> | null>(null);
  const [migrationFileName, setMigrationFileName] = useState<string | null>(null);

  // Step 2: Founding Administrator Account
  const [adminUsername, setAdminUsername] = useState("admin");
  const [adminEmail, setAdminEmail] = useState("admin@ansatz.local");
  const [adminDisplayName, setAdminDisplayName] = useState("Instance Administrator");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminPasswordConfirm, setAdminPasswordConfirm] = useState("");

  // Step 3: Instance Identity, White-Label Branding, Registration & Federation Policy
  const [instanceName, setInstanceName] = useState(initialStatus?.settings.instanceName || "Ansatz");
  const [instanceBadge, setInstanceBadge] = useState(initialStatus?.settings.instanceBadge ?? "");
  const [instanceTagline, setInstanceTagline] = useState(
    initialStatus?.settings.instanceTagline || "The Federated Scientific & Engineering Network",
  );
  const [instanceDescription, setInstanceDescription] = useState(
    initialStatus?.settings.instanceDescription ||
      "Federated polyglot engineering simulation, Modelica, SysML v2, and digital twin platform.",
  );
  const [contactEmail, setContactEmail] = useState(initialStatus?.settings.contactEmail || "admin@ansatz.local");
  const [brandLogoUrl, setBrandLogoUrl] = useState(initialStatus?.settings.brandLogoUrl || "");
  const [brandLogoDarkUrl, setBrandLogoDarkUrl] = useState(initialStatus?.settings.brandLogoDarkUrl || "");
  const [brandFaviconUrl, setBrandFaviconUrl] = useState(initialStatus?.settings.brandFaviconUrl || "");
  const [brandAccentColor, setBrandAccentColor] = useState(initialStatus?.settings.brandAccentColor || "#06b6d4");
  const [docsBaseUrl, setDocsBaseUrl] = useState(initialStatus?.settings.docsBaseUrl || "https://modelscript.org");
  const [showPoweredBy, setShowPoweredBy] = useState<boolean>(initialStatus?.settings.showPoweredBy ?? true);
  const [registrationMode, setRegistrationMode] = useState<"open" | "invite_only" | "domain_allowlist" | "closed">(
    "invite_only",
  );
  const [allowedDomainsInput, setAllowedDomainsInput] = useState("");
  const [federationMode, setFederationMode] = useState<"open" | "allowlist" | "disabled">("open");
  const [autoQuarantineThreshold, setAutoQuarantineThreshold] = useState<number>(3);
  const [backupRetentionCount, setBackupRetentionCount] = useState<number>(7);

  // Step 4: Starter Invites & Baseline Backup
  const [initialInvitesCount, setInitialInvitesCount] = useState<number>(3);
  const [initialInviteMaxUses, setInitialInviteMaxUses] = useState<number>(5);
  const [initialInviteCredits, setInitialInviteCredits] = useState<number>(100);
  const [initialInviteRole, setInitialInviteRole] = useState<"user" | "moderator" | "auditor">("user");
  const [createInitialBackup, setCreateInitialBackup] = useState<boolean>(true);

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
    setInstanceTagline(res.settings.instanceTagline || "The Federated Scientific & Engineering Network");
    setInstanceDescription(res.settings.instanceDescription);
    setContactEmail(res.settings.contactEmail);
    setBrandLogoUrl(res.settings.brandLogoUrl || "");
    setBrandLogoDarkUrl(res.settings.brandLogoDarkUrl || "");
    setBrandFaviconUrl(res.settings.brandFaviconUrl || "");
    setBrandAccentColor(res.settings.brandAccentColor || "#06b6d4");
    setDocsBaseUrl(res.settings.docsBaseUrl || "https://modelscript.org");
    setShowPoweredBy(res.settings.showPoweredBy ?? true);
    if (res.reopened) {
      setAdminPassword((prev) => prev || "password123");
      setAdminPasswordConfirm((prev) => prev || "password123");
    }
    if (res.airgapEnforced) {
      setSelectedTier("tier2_corporate");
      setRegistrationMode("domain_allowlist");
      setFederationMode("disabled");
      setAutoQuarantineThreshold(5);
      setBackupRetentionCount(14);
      setInstanceName(res.presets?.tier2_corporate?.defaultInstanceName || "Engineering Intranet");
      setInstanceBadge(res.presets?.tier2_corporate?.defaultInstanceBadge ?? "Internal");
      setShowPoweredBy(false);
    }
  };

  useEffect(() => {
    const onSetupReset = (ev: Event) => {
      const detail = (ev as CustomEvent<InstanceSetupStatus | undefined>).detail;
      setCompletedResult(null);
      setError(null);
      setStep(1);
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
      setStep(1);
      applyLoadedStatus(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to re-open setup wizard");
    }
  };

  const applyTierPreset = (tierId: "tier1_federated" | "tier2_corporate" | "tier3_flagship") => {
    setSelectedTier(tierId);
    const presets = status?.presets || DEFAULT_PRESETS;
    const p = presets[tierId];
    if (p) {
      setRegistrationMode(p.registrationMode);
      setFederationMode(p.federationMode);
      setAutoQuarantineThreshold(p.autoQuarantineReportThreshold);
      setBackupRetentionCount(p.backupRetentionCount);
      if (p.instanceName !== undefined) setInstanceName(p.instanceName);
      if (p.instanceBadge !== undefined) setInstanceBadge(p.instanceBadge);
      if (p.instanceTagline !== undefined) setInstanceTagline(p.instanceTagline);
      if (p.showPoweredBy !== undefined) setShowPoweredBy(p.showPoweredBy);
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
          if (parsed.settings.instanceName) setInstanceName(String(parsed.settings.instanceName));
          if (parsed.settings.instanceBadge !== undefined) setInstanceBadge(String(parsed.settings.instanceBadge));
          if (parsed.settings.instanceTagline) setInstanceTagline(String(parsed.settings.instanceTagline));
          if (parsed.settings.instanceDescription) setInstanceDescription(String(parsed.settings.instanceDescription));
          if (parsed.settings.contactEmail) setContactEmail(String(parsed.settings.contactEmail));
          if (parsed.settings.brandLogoUrl !== undefined) setBrandLogoUrl(String(parsed.settings.brandLogoUrl));
          if (parsed.settings.brandLogoDarkUrl !== undefined)
            setBrandLogoDarkUrl(String(parsed.settings.brandLogoDarkUrl));
          if (parsed.settings.brandFaviconUrl !== undefined)
            setBrandFaviconUrl(String(parsed.settings.brandFaviconUrl));
          if (parsed.settings.brandAccentColor) setBrandAccentColor(String(parsed.settings.brandAccentColor));
          if (parsed.settings.docsBaseUrl) setDocsBaseUrl(String(parsed.settings.docsBaseUrl));
          if (typeof parsed.settings.showPoweredBy === "boolean") setShowPoweredBy(parsed.settings.showPoweredBy);
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

  const handleNextStep = () => {
    setError(null);
    if (step === 2 && !status?.hasAdmin) {
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
      if (adminPassword !== adminPasswordConfirm) {
        setError("Administrator passwords do not match.");
        return;
      }
      if (
        contactEmail === "admin@ansatz.local" ||
        contactEmail === "admin@ansatz.social" ||
        contactEmail === "admin@modelscript.local" ||
        contactEmail === "admin@modelscript.org"
      ) {
        setContactEmail(adminEmail.trim());
      }
    }
    setStep((prev) => (prev < 4 ? ((prev + 1) as 1 | 2 | 3 | 4) : prev));
  };

  const handleCompleteSetup = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const allowedEmailDomains = allowedDomainsInput
        .split(",")
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean);

      const res = await completeInstanceSetup({
        profileTier: selectedTier,
        ...(status?.hasAdmin
          ? {}
          : {
              admin: {
                username: adminUsername.trim(),
                email: adminEmail.trim(),
                password: adminPassword,
                displayName: adminDisplayName.trim() || undefined,
              },
            }),
        settings: {
          instanceName: instanceName.trim() || "Ansatz",
          instanceBadge: instanceBadge.trim(),
          instanceTagline: instanceTagline.trim(),
          instanceDescription: instanceDescription.trim(),
          contactEmail: contactEmail.trim(),
          brandLogoUrl: brandLogoUrl.trim(),
          brandLogoDarkUrl: brandLogoDarkUrl.trim(),
          brandFaviconUrl: brandFaviconUrl.trim(),
          brandAccentColor: brandAccentColor.trim() || "#06b6d4",
          docsBaseUrl: docsBaseUrl.trim() || "https://modelscript.org",
          showPoweredBy,
          registrationMode,
          allowedEmailDomains,
          federationMode,
          autoQuarantineReportThreshold: autoQuarantineThreshold,
          backupRetentionCount,
        },
        initialInvitesCount,
        initialInviteMaxUses,
        initialInviteCredits,
        initialInviteRole,
        createInitialBackup,
        migrationBundle,
      });

      notifyInstanceBrandingUpdated(res.settings);

      if (res.token && res.user) {
        try {
          if (typeof window !== "undefined" && window.localStorage) {
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
      <div style={{ padding: "48px 24px", maxWidth: "780px", margin: "0 auto", textAlign: "center" }}>
        <p style={{ color: "var(--color-fg-muted)" }}>Inspecting instance initialization state...</p>
      </div>
    );
  }

  if (status && !status.needsSetup && !completedResult) {
    return (
      <div
        style={{
          padding: "48px 24px",
          maxWidth: "680px",
          margin: "40px auto",
          border: "1px solid var(--color-border-default)",
          borderRadius: "12px",
          backgroundColor: "var(--color-canvas-subtle)",
          textAlign: "center",
        }}
      >
        <ShieldCheckIcon size={36} />
        <h2 style={{ margin: "12px 0 8px", fontSize: "20px", fontWeight: 700 }}>Instance Setup Already Completed</h2>
        <p style={{ margin: "0 0 20px", fontSize: "14px", color: "var(--color-fg-muted)" }}>
          This {status.settings.instanceName || "Ansatz"} instance (<strong>{status.settings.instanceName}</strong>) has
          already been initialized and its first-boot setup wizard is permanently locked.
        </p>
        <div style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => navigate("/admin")}
            style={{
              padding: "8px 16px",
              borderRadius: "6px",
              border: "none",
              backgroundColor: "var(--color-accent-emphasis)",
              color: "#ffffff",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Open Instance Admin Console
          </button>
          <button
            type="button"
            onClick={() => void handleRerunWizard()}
            style={{
              padding: "8px 16px",
              borderRadius: "6px",
              border: "1px solid var(--color-border-default)",
              backgroundColor: "var(--color-canvas-default)",
              color: "var(--color-fg-default)",
              fontWeight: 600,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <RocketIcon size={14} /> Re-run Setup Wizard
          </button>
          <button
            type="button"
            onClick={() => navigate("/")}
            style={{
              padding: "8px 16px",
              borderRadius: "6px",
              border: "1px solid var(--color-border-default)",
              backgroundColor: "var(--color-canvas-default)",
              color: "var(--color-fg-default)",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Return to Home
          </button>
        </div>
      </div>
    );
  }

  const presets = status?.presets || DEFAULT_PRESETS;

  return (
    <div style={{ padding: "32px 20px", maxWidth: "860px", margin: "0 auto" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "12px",
          marginBottom: "24px",
          paddingBottom: "16px",
          borderBottom: "1px solid var(--color-border-default)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div
            style={{
              width: "40px",
              height: "40px",
              borderRadius: "10px",
              backgroundColor: "var(--color-accent-subtle)",
              color: "var(--color-accent-fg)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <RocketIcon size={20} />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: "22px", fontWeight: 700 }}>
              {instanceName || "Ansatz"} First-Run Install Wizard
            </h1>
            <p style={{ margin: "2px 0 0", fontSize: "13px", color: "var(--color-fg-muted)" }}>
              Bootstrap your founding administrator, security posture, federation policy, and baseline snapshot.
            </p>
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              padding: "3px 10px",
              borderRadius: "999px",
              backgroundColor: "var(--color-accent-subtle)",
              color: "var(--color-accent-fg)",
            }}
          >
            {status?.edition === "ee" ? "Enterprise Edition (EE)" : "Community Edition (AGPLv3)"}
          </span>
          {status?.airgapEnforced && (
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                padding: "3px 10px",
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
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
            <span style={{ color: "var(--color-success-fg)", display: "flex" }}>
              <CheckCircleIcon size={24} />
            </span>
            <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}>Instance Ready — Setup Wizard Locked</h2>
          </div>
          <p style={{ margin: "0 0 16px", fontSize: "13px", color: "var(--color-fg-muted)" }}>
            <strong>{completedResult.settings.instanceName}</strong> is now live and signed in as{" "}
            <code>@{completedResult.adminUsername}</code>. The setup endpoint has been permanently locked.
          </p>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "12px",
              marginBottom: "20px",
            }}
          >
            <div
              style={{
                padding: "12px",
                borderRadius: "8px",
                border: "1px solid var(--color-border-default)",
                backgroundColor: "var(--color-canvas-default)",
              }}
            >
              <div style={{ fontSize: "11px", color: "var(--color-fg-muted)" }}>Registration Policy</div>
              <div style={{ fontSize: "14px", fontWeight: 700, marginTop: "4px" }}>
                {completedResult.settings.registrationMode}
              </div>
            </div>
            <div
              style={{
                padding: "12px",
                borderRadius: "8px",
                border: "1px solid var(--color-border-default)",
                backgroundColor: "var(--color-canvas-default)",
              }}
            >
              <div style={{ fontSize: "11px", color: "var(--color-fg-muted)" }}>ActivityPub Federation</div>
              <div style={{ fontSize: "14px", fontWeight: 700, marginTop: "4px" }}>
                {completedResult.settings.federationMode}
              </div>
            </div>
            {completedResult.backupSnapshot && (
              <div
                style={{
                  padding: "12px",
                  borderRadius: "8px",
                  border: "1px solid var(--color-border-default)",
                  backgroundColor: "var(--color-canvas-default)",
                }}
              >
                <div style={{ fontSize: "11px", color: "var(--color-fg-muted)" }}>Baseline Hot Backup</div>
                <div style={{ fontSize: "12px", fontWeight: 600, marginTop: "4px", fontFamily: "monospace" }}>
                  {completedResult.backupSnapshot.fileName}
                </div>
              </div>
            )}
          </div>

          {completedResult.invites.length > 0 && (
            <div style={{ marginBottom: "20px" }}>
              <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "8px" }}>
                Starter Invitation Codes ({completedResult.invites.length})
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {completedResult.invites.map((inv) => (
                  <code
                    key={inv.code}
                    style={{
                      padding: "6px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border-default)",
                      backgroundColor: "var(--color-canvas-default)",
                      fontSize: "12px",
                      fontWeight: 600,
                    }}
                  >
                    {inv.code} ({inv.maxUses} uses · {inv.initialCredits} cr)
                  </code>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => navigate("/admin")}
              style={{
                padding: "8px 16px",
                borderRadius: "6px",
                border: "none",
                backgroundColor: "var(--color-accent-emphasis)",
                color: "#ffffff",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Launch Instance Admin Console →
            </button>
            <button
              type="button"
              onClick={() => navigate("/")}
              style={{
                padding: "8px 16px",
                borderRadius: "6px",
                border: "1px solid var(--color-border-default)",
                backgroundColor: "var(--color-canvas-default)",
                color: "var(--color-fg-default)",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Go to Engineering Feed
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Step Progress Bar */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: "8px",
              marginBottom: "24px",
            }}
          >
            {[
              { num: 1, title: "1. Deployment Tier", icon: <ServerIcon size={14} /> },
              { num: 2, title: "2. Founding Admin", icon: <KeyIcon size={14} /> },
              { num: 3, title: "3. Instance Policy", icon: <GlobeIcon size={14} /> },
              { num: 4, title: "4. Invites & Backup", icon: <DatabaseIcon size={14} /> },
            ].map((item) => {
              const active = step === item.num;
              const done = step > item.num;
              return (
                <button
                  key={item.num}
                  type="button"
                  onClick={() => {
                    if (item.num < step) setStep(item.num as 1 | 2 | 3 | 4);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "10px 12px",
                    borderRadius: "8px",
                    border: active ? "2px solid var(--color-accent-emphasis)" : "1px solid var(--color-border-default)",
                    backgroundColor: active
                      ? "var(--color-accent-subtle)"
                      : done
                        ? "var(--color-canvas-subtle)"
                        : "var(--color-canvas-default)",
                    color: active ? "var(--color-accent-fg)" : "var(--color-fg-default)",
                    fontSize: "12px",
                    fontWeight: active ? 700 : 600,
                    cursor: item.num < step ? "pointer" : "default",
                    textAlign: "left",
                  }}
                >
                  {item.icon}
                  <span>{item.title}</span>
                </button>
              );
            })}
          </div>

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

          {/* Step 1: Deployment Tier Preset */}
          {step === 1 && (
            <div
              style={{
                border: "1px solid var(--color-border-default)",
                borderRadius: "10px",
                padding: "20px",
                backgroundColor: "var(--color-canvas-subtle)",
              }}
            >
              <h2 style={{ margin: "0 0 6px", fontSize: "16px", fontWeight: 700 }}>
                Select Your Deployment Architecture Profile
              </h2>
              <p style={{ margin: "0 0 16px", fontSize: "13px", color: "var(--color-fg-muted)" }}>
                Choose a preset tailored to your deployment scale. You can fine-tune every setting in Step 3 or anytime
                in the Instance Admin console.
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "20px" }}>
                {(["tier1_federated", "tier2_corporate", "tier3_flagship"] as const).map((tierKey) => {
                  const p = presets[tierKey];
                  const isSelected = selectedTier === tierKey;
                  return (
                    <div
                      key={tierKey}
                      onClick={() => applyTierPreset(tierKey)}
                      style={{
                        padding: "14px 16px",
                        borderRadius: "8px",
                        border: isSelected
                          ? "2px solid var(--color-accent-emphasis)"
                          : "1px solid var(--color-border-default)",
                        backgroundColor: isSelected ? "var(--color-accent-subtle)" : "var(--color-canvas-default)",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: "14px", fontWeight: 700 }}>{p.label}</span>
                        <span style={{ fontSize: "11px", fontFamily: "monospace", color: "var(--color-fg-muted)" }}>
                          signup={p.registrationMode} · fed={p.federationMode} · backups={p.backupRetentionCount}
                        </span>
                      </div>
                      <p style={{ margin: "6px 0 0", fontSize: "12px", color: "var(--color-fg-muted)" }}>
                        {p.description}
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* Optional Migration Bundle Restore */}
              <div
                style={{
                  padding: "14px",
                  borderRadius: "8px",
                  border: "1px dashed var(--color-border-default)",
                  backgroundColor: "var(--color-canvas-default)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "10px",
                }}
              >
                <div>
                  <div style={{ fontSize: "13px", fontWeight: 600, display: "flex", alignItems: "center", gap: "6px" }}>
                    <UploadIcon size={14} /> Migrating from an existing {instanceName || "Ansatz"} instance?
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--color-fg-muted)", marginTop: "2px" }}>
                    {migrationFileName
                      ? `Loaded bundle: ${migrationFileName}`
                      : "Optional: Upload a Portable Instance Migration Bundle (.json) to pre-load settings, federation rules, and feature flags."}
                  </div>
                </div>
                <label
                  style={{
                    padding: "6px 12px",
                    borderRadius: "6px",
                    border: "1px solid var(--color-border-default)",
                    backgroundColor: "var(--color-canvas-subtle)",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Upload Bundle (.json)
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={handleBundleUpload}
                    style={{ display: "none" }}
                  />
                </label>
              </div>
            </div>
          )}

          {/* Step 2: Founding Administrator Account */}
          {step === 2 && (
            <div
              style={{
                border: "1px solid var(--color-border-default)",
                borderRadius: "10px",
                padding: "20px",
                backgroundColor: "var(--color-canvas-subtle)",
              }}
            >
              <h2 style={{ margin: "0 0 6px", fontSize: "16px", fontWeight: 700 }}>
                Create Founding Administrator Account
              </h2>
              <p style={{ margin: "0 0 16px", fontSize: "13px", color: "var(--color-fg-muted)" }}>
                This account receives full <code>admin</code> privileges, 1,000 initial compute credits, and automatic
                Ed25519 + RSA-2048 ActivityPub actor keypair provisioning.
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                    Admin Username
                  </label>
                  <input
                    type="text"
                    value={adminUsername}
                    onChange={(e) => setAdminUsername(e.target.value)}
                    placeholder="admin"
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border-default)",
                      backgroundColor: "var(--color-canvas-default)",
                      color: "var(--color-fg-default)",
                      fontSize: "13px",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                    Display Name
                  </label>
                  <input
                    type="text"
                    value={adminDisplayName}
                    onChange={(e) => setAdminDisplayName(e.target.value)}
                    placeholder="Instance Administrator"
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border-default)",
                      backgroundColor: "var(--color-canvas-default)",
                      color: "var(--color-fg-default)",
                      fontSize: "13px",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                  Admin Email Address
                </label>
                <input
                  type="email"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  placeholder="admin@yourdomain.org"
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: "1px solid var(--color-border-default)",
                    backgroundColor: "var(--color-canvas-default)",
                    color: "var(--color-fg-default)",
                    fontSize: "13px",
                    boxSizing: "border-box",
                  }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                    Password (min 8 chars)
                  </label>
                  <input
                    type="password"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    placeholder="••••••••••••"
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border-default)",
                      backgroundColor: "var(--color-canvas-default)",
                      color: "var(--color-fg-default)",
                      fontSize: "13px",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                    Confirm Password
                  </label>
                  <input
                    type="password"
                    value={adminPasswordConfirm}
                    onChange={(e) => setAdminPasswordConfirm(e.target.value)}
                    placeholder="••••••••••••"
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border-default)",
                      backgroundColor: "var(--color-canvas-default)",
                      color: "var(--color-fg-default)",
                      fontSize: "13px",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Instance Identity, White-Label Branding, Registration & Federation Policy */}
          {step === 3 && (
            <div
              style={{
                border: "1px solid var(--color-border-default)",
                borderRadius: "10px",
                padding: "20px",
                backgroundColor: "var(--color-canvas-subtle)",
              }}
            >
              <h2 style={{ margin: "0 0 6px", fontSize: "16px", fontWeight: 700 }}>
                Instance Identity, White-Label Branding &amp; Federation Policy
              </h2>
              <p style={{ margin: "0 0 16px", fontSize: "13px", color: "var(--color-fg-muted)" }}>
                Customize how your instance is branded in the navigation sidebar, login screen, and NodeInfo 2.0/2.1
                discovery metadata.
              </p>

              {/* Live Brand Header Preview */}
              <div
                data-testid="setup-brand-preview"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                  padding: "10px 14px",
                  marginBottom: "16px",
                  borderRadius: "12px",
                  border: "1px solid var(--color-border-default)",
                  backgroundColor: "var(--color-canvas-default)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <AnsatzMark
                    size={36}
                    logoUrl={brandLogoUrl}
                    alt={instanceName || "Ansatz"}
                    accentColor={brandAccentColor}
                  />
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", lineHeight: 1.05 }}>
                      <span style={{ fontSize: "17.5px", fontWeight: 800, letterSpacing: "-0.035em" }}>
                        {instanceName.trim() || "Ansatz"}
                      </span>
                      <span
                        style={{
                          width: "6px",
                          height: "6px",
                          borderRadius: "999px",
                          backgroundColor: brandAccentColor || "#22d3ee",
                          display: "inline-block",
                        }}
                      />
                      {instanceBadge.trim() && (
                        <span
                          style={{
                            fontSize: "10px",
                            fontWeight: 700,
                            textTransform: "uppercase",
                            padding: "1.5px 5px",
                            borderRadius: "5px",
                            backgroundColor: "rgba(6, 182, 212, 0.14)",
                            border: `1px solid ${brandAccentColor || "#06b6d4"}`,
                            color: brandAccentColor || "#06b6d4",
                          }}
                        >
                          {instanceBadge.trim()}
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: "11.5px",
                        fontFamily: "var(--ms-font-mono, monospace)",
                        color: "var(--color-fg-muted)",
                        marginTop: "3px",
                      }}
                    >
                      ansatz.social
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  {showPoweredBy && (
                    <span style={{ fontSize: "11px", color: "var(--color-fg-muted)" }}>Powered by ModelScript</span>
                  )}
                  <span
                    style={{
                      padding: "2px 6px",
                      borderRadius: "6px",
                      fontFamily: "var(--ms-font-mono, monospace)",
                      fontSize: "11px",
                      fontWeight: 600,
                      color: "var(--color-fg-muted)",
                      border: "1px solid var(--color-border-default)",
                    }}
                  >
                    ⌘K
                  </span>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 2fr", gap: "12px", marginBottom: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                    Instance Brand Name
                  </label>
                  <input
                    type="text"
                    aria-label="Instance Name"
                    value={instanceName}
                    onChange={(e) => setInstanceName(e.target.value)}
                    placeholder="Ansatz"
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border-default)",
                      backgroundColor: "var(--color-canvas-default)",
                      color: "var(--color-fg-default)",
                      fontSize: "13px",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                    Header Badge Pill
                  </label>
                  <input
                    type="text"
                    aria-label="Header Badge Pill"
                    value={instanceBadge}
                    onChange={(e) => setInstanceBadge(e.target.value)}
                    placeholder="e.g. Lab, Internal"
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border-default)",
                      backgroundColor: "var(--color-canvas-default)",
                      color: "var(--color-fg-default)",
                      fontSize: "13px",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                    Public Contact Email
                  </label>
                  <input
                    type="email"
                    aria-label="Public Contact Email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border-default)",
                      backgroundColor: "var(--color-canvas-default)",
                      color: "var(--color-fg-default)",
                      fontSize: "13px",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                    Subtitle / Login Tagline
                  </label>
                  <input
                    type="text"
                    aria-label="Instance Tagline"
                    value={instanceTagline}
                    onChange={(e) => setInstanceTagline(e.target.value)}
                    placeholder="The Federated Scientific & Engineering Network"
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border-default)",
                      backgroundColor: "var(--color-canvas-default)",
                      color: "var(--color-fg-default)",
                      fontSize: "13px",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                    Instance Description (NodeInfo)
                  </label>
                  <input
                    type="text"
                    aria-label="Instance Description"
                    value={instanceDescription}
                    onChange={(e) => setInstanceDescription(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border-default)",
                      backgroundColor: "var(--color-canvas-default)",
                      color: "var(--color-fg-default)",
                      fontSize: "13px",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 120px", gap: "12px", marginBottom: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                    Custom Brand Logo URL (Optional)
                  </label>
                  <input
                    type="text"
                    aria-label="Custom Brand Logo URL"
                    value={brandLogoUrl}
                    onChange={(e) => setBrandLogoUrl(e.target.value)}
                    placeholder="/ansatz-logo.svg or https://..."
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border-default)",
                      backgroundColor: "var(--color-canvas-default)",
                      color: "var(--color-fg-default)",
                      fontSize: "13px",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                    Documentation Portal URL
                  </label>
                  <input
                    type="text"
                    aria-label="Documentation Portal URL"
                    value={docsBaseUrl}
                    onChange={(e) => setDocsBaseUrl(e.target.value)}
                    placeholder="https://modelscript.org"
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border-default)",
                      backgroundColor: "var(--color-canvas-default)",
                      color: "var(--color-fg-default)",
                      fontSize: "13px",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                    Accent Color
                  </label>
                  <input
                    type="text"
                    aria-label="Brand Accent Color"
                    value={brandAccentColor}
                    onChange={(e) => setBrandAccentColor(e.target.value)}
                    placeholder="#06b6d4"
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border-default)",
                      backgroundColor: "var(--color-canvas-default)",
                      color: "var(--color-fg-default)",
                      fontSize: "13px",
                      fontFamily: "monospace",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              </div>

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "12px",
                  fontWeight: 600,
                  marginBottom: "14px",
                  cursor: "pointer",
                }}
              >
                <input type="checkbox" checked={showPoweredBy} onChange={(e) => setShowPoweredBy(e.target.checked)} />
                <span>Display subtle &ldquo;Powered by ModelScript&rdquo; attribution link in sidebar footer</span>
              </label>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                    Registration Mode
                  </label>
                  <select
                    value={registrationMode}
                    onChange={(e) =>
                      setRegistrationMode(e.target.value as "open" | "invite_only" | "domain_allowlist" | "closed")
                    }
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border-default)",
                      backgroundColor: "var(--color-canvas-default)",
                      color: "var(--color-fg-default)",
                      fontSize: "13px",
                    }}
                  >
                    <option value="invite_only">Invite-Only (Require Invitation Token)</option>
                    <option value="domain_allowlist">Corporate Email Domain Allowlist</option>
                    <option value="open">Open Public Registration</option>
                    <option value="closed">Closed (Admin Provisioning Only)</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                    ActivityPub Federation Mode
                  </label>
                  <select
                    value={federationMode}
                    onChange={(e) => setFederationMode(e.target.value as "open" | "allowlist" | "disabled")}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border-default)",
                      backgroundColor: "var(--color-canvas-default)",
                      color: "var(--color-fg-default)",
                      fontSize: "13px",
                    }}
                  >
                    <option value="open">Open Federation (Blocklist Enforced)</option>
                    <option value="allowlist">Trusted Peer Allowlist Only</option>
                    <option value="disabled">Disabled (Intranet / Air-Gapped)</option>
                  </select>
                </div>
              </div>

              {registrationMode === "domain_allowlist" && (
                <div style={{ marginBottom: "12px" }}>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                    Allowed Email Domains (comma-separated)
                  </label>
                  <input
                    type="text"
                    value={allowedDomainsInput}
                    onChange={(e) => setAllowedDomainsInput(e.target.value)}
                    placeholder="corp.example.com, lab.university.edu"
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border-default)",
                      backgroundColor: "var(--color-canvas-default)",
                      color: "var(--color-fg-default)",
                      fontSize: "13px",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                    Auto-Quarantine Report Threshold
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={autoQuarantineThreshold}
                    onChange={(e) => setAutoQuarantineThreshold(Number(e.target.value))}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border-default)",
                      backgroundColor: "var(--color-canvas-default)",
                      color: "var(--color-fg-default)",
                      fontSize: "13px",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                    Hot Backup Retention Count
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={90}
                    value={backupRetentionCount}
                    onChange={(e) => setBackupRetentionCount(Number(e.target.value))}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border-default)",
                      backgroundColor: "var(--color-canvas-default)",
                      color: "var(--color-fg-default)",
                      fontSize: "13px",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Starter Invites & Baseline Backup */}
          {step === 4 && (
            <div
              style={{
                border: "1px solid var(--color-border-default)",
                borderRadius: "10px",
                padding: "20px",
                backgroundColor: "var(--color-canvas-subtle)",
              }}
            >
              <h2 style={{ margin: "0 0 6px", fontSize: "16px", fontWeight: 700 }}>
                Starter Invitation Codes & Baseline Snapshot
              </h2>
              <p style={{ margin: "0 0 16px", fontSize: "13px", color: "var(--color-fg-muted)" }}>
                Generate initial invite codes for your colleagues or moderators and record a pre-launch SQLite hot
                backup before locking the install wizard.
              </p>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                  gap: "12px",
                  marginBottom: "16px",
                }}
              >
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                    <PersonAddIcon size={12} /> Starter Invites Count
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={25}
                    value={initialInvitesCount}
                    onChange={(e) => setInitialInvitesCount(Number(e.target.value))}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border-default)",
                      backgroundColor: "var(--color-canvas-default)",
                      color: "var(--color-fg-default)",
                      fontSize: "13px",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                    Max Uses per Code
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    value={initialInviteMaxUses}
                    onChange={(e) => setInitialInviteMaxUses(Number(e.target.value))}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border-default)",
                      backgroundColor: "var(--color-canvas-default)",
                      color: "var(--color-fg-default)",
                      fontSize: "13px",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                    Initial Compute Credits
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={10000}
                    value={initialInviteCredits}
                    onChange={(e) => setInitialInviteCredits(Number(e.target.value))}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border-default)",
                      backgroundColor: "var(--color-canvas-default)",
                      color: "var(--color-fg-default)",
                      fontSize: "13px",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
                    Assigned Role
                  </label>
                  <select
                    value={initialInviteRole}
                    onChange={(e) => setInitialInviteRole(e.target.value as "user" | "moderator" | "auditor")}
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid var(--color-border-default)",
                      backgroundColor: "var(--color-canvas-default)",
                      color: "var(--color-fg-default)",
                      fontSize: "13px",
                    }}
                  >
                    <option value="user">Standard Engineer (user)</option>
                    <option value="moderator">Staff Moderator (moderator)</option>
                    <option value="auditor">Compliance Auditor (auditor)</option>
                  </select>
                </div>
              </div>

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "12px",
                  borderRadius: "8px",
                  border: "1px solid var(--color-border-default)",
                  backgroundColor: "var(--color-canvas-default)",
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={createInitialBackup}
                  onChange={(e) => setCreateInitialBackup(e.target.checked)}
                />
                <span>
                  Create an immediate <strong>first-boot-baseline</strong> hot SQLite backup with SHA-256 checksum
                </span>
              </label>
            </div>
          )}

          {/* Wizard Navigation Footer */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: "20px",
            }}
          >
            <div>
              {step > 1 && (
                <button
                  type="button"
                  onClick={() => setStep((prev) => (prev - 1) as 1 | 2 | 3 | 4)}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "6px",
                    border: "1px solid var(--color-border-default)",
                    backgroundColor: "var(--color-canvas-default)",
                    color: "var(--color-fg-default)",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  ← Previous Step
                </button>
              )}
            </div>
            <div>
              {step < 4 ? (
                <button
                  type="button"
                  onClick={handleNextStep}
                  style={{
                    padding: "8px 18px",
                    borderRadius: "6px",
                    border: "none",
                    backgroundColor: "var(--color-accent-emphasis)",
                    color: "#ffffff",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Continue to Step {step + 1} →
                </button>
              ) : (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleCompleteSetup}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "9px 20px",
                    borderRadius: "6px",
                    border: "none",
                    backgroundColor: "var(--color-success-emphasis)",
                    color: "#ffffff",
                    fontSize: "13px",
                    fontWeight: 700,
                    cursor: submitting ? "wait" : "pointer",
                  }}
                >
                  <LockIcon size={14} />
                  {submitting ? "Initializing & Locking Setup..." : "Complete Instance Setup & Sign In"}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default SetupWizardPage;
