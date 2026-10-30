// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AdminMenuSidebar } from "../src/pages/admin/components/AdminMenuSidebar";
import { AdminAuditLogsTab } from "../src/pages/admin/tabs/AdminAuditLogsTab";
import { AdminDatabaseTab } from "../src/pages/admin/tabs/AdminDatabaseTab";
import { AdminDmcaTab } from "../src/pages/admin/tabs/AdminDmcaTab";
import { AdminFederationTab } from "../src/pages/admin/tabs/AdminFederationTab";
import { AdminModerationTab } from "../src/pages/admin/tabs/AdminModerationTab";
import { AdminSettingsTab } from "../src/pages/admin/tabs/AdminSettingsTab";
import { AdminSystemTab } from "../src/pages/admin/tabs/AdminSystemTab";
import { AdminUsersTab } from "../src/pages/admin/tabs/AdminUsersTab";
import { SetupWizardPage } from "../src/pages/SetupWizardPage";

describe("Admin Console & Moderation UI Components Suite", () => {
  it("renders AdminModerationTab with enriched forensic snapshots, CW action, and Appeal badge", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(AdminModerationTab, {
          reports: [
            {
              id: 101,
              reporter_id: 2,
              reporter_username: "alice",
              post_id: 500,
              target_user_id: 9,
              target_username: "remote_spammer",
              target_type: "post",
              author_username: "remote_spammer",
              author_domain: "bad-instance.social",
              post_content: "Unfiltered thermal runaway simulation output",
              reason: "Sensitive Content",
              details: "Missing CW blur",
              status: "pending",
              target_report_count: 3,
              author_prior_violations: 1,
              created_at: "2026-10-28T12:00:00Z",
            },
            {
              id: 102,
              reporter_id: 9,
              reporter_username: "remote_spammer",
              target_user_id: 9,
              target_username: "remote_spammer",
              target_type: "appeal",
              reason: "Appeal: False positive spam lock",
              details: "These were automated parameter sweep benchmarks",
              status: "pending",
              created_at: "2026-10-28T13:00:00Z",
            },
          ],
          modFilter: "pending",
          setModFilter: () => {},
          onResolveReport: async () => {},
          onBulkResolveReports: async () => {},
          onDeletePost: async () => {},
          loading: false,
        }),
      ),
    );

    assert.ok(html.includes("Unfiltered thermal runaway simulation output"));
    assert.ok(html.includes("bad-instance.social"));
    assert.ok(html.includes("3x reports"));
    assert.ok(html.includes("1 prior violation"));
    assert.ok(html.includes("Appeals"));
    assert.ok(html.includes("Packages"));
    assert.ok(html.includes("Keys: j/k navigate"));
  });

  it("renders AdminUsersTab with status filters, role badges, and graduated governance controls", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(AdminUsersTab, {
          users: [
            {
              id: 9,
              username: "remote_spammer",
              display_name: "Remote Spammer",
              email: "spammer@bad-instance.social",
              account_type: "moderator",
              status: "frozen",
              remote_domain: "bad-instance.social",
              post_count: 14,
              report_count: 2,
              credit_balance: 500,
              created_at: "2026-10-01T00:00:00Z",
            },
          ],
          statusBreakdown: { active: 10, frozen: 1, suspended: 0, admins: 1, moderators: 1, auditors: 1 },
          userSearchQuery: "",
          setUserSearchQuery: () => {},
          userStatusFilter: "all",
          setUserStatusFilter: () => {},
          userRoleFilter: "all",
          setUserRoleFilter: () => {},
          onModerateUser: async () => {},
          onAdjustUserCredits: async () => {},
          initialForensics: {
            user: {
              id: 9,
              username: "remote_spammer",
              email: "spammer@bad-instance.social",
              display_name: "Remote Spammer",
              account_type: "moderator",
              status: "frozen",
              credit_balance: 500,
              total_spent: 40,
              remote_domain: "bad-instance.social",
              email_verified: 1,
              totp_enabled: 1,
              created_at: "2026-10-01T00:00:00Z",
            },
            recentPosts: [
              {
                id: 500,
                content: "Recent forensic post snippet",
                content_warning: null,
                visibility: "public",
                created_at: "2026-10-28T00:00:00Z",
              },
            ],
            publishedPackages: [],
            recentTransactions: [],
            recentAuditLogs: [],
            reportsAgainstUser: [],
          },
          loading: false,
        }),
      ),
    );

    assert.ok(html.includes("Frozen (Read-Only)"));
    assert.ok(html.includes("remote_spammer"));
    assert.ok(html.includes("frozen"));
    assert.ok(html.includes("bad-instance.social"));
    assert.ok(html.includes("Moderators"));
    assert.ok(html.includes("Auditors"));
    assert.ok(html.includes("500"));
    assert.ok(html.includes("Credits"));
    assert.ok(html.includes("Forensics"));
    assert.ok(html.includes("User Forensic Dossier"));
    assert.ok(html.includes("Recent forensic post snippet"));
  });

  it("renders AdminFederationTab with Domain Tier policies, CSV Import/Export, Peer Tester, and S2S Delivery Queue telemetry", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(AdminFederationTab, {
          domains: [
            {
              domain: "bad-instance.social",
              tier: "silence",
              reason: "Repeated bot spam",
              updated_by: 1,
              updated_at: "2026-10-28T12:00:00Z",
            },
          ],
          onSaveDomainTier: async () => {},
          onDeleteDomainRule: async () => {},
          onExportDomains: async () => {},
          onImportDomains: async () => {},
          onTestDomain: async () => ({
            domain: "bad-instance.social",
            federationMode: "open",
            effectiveTier: "silence",
            allowedByPolicy: true,
            probeResult: null,
          }),
          queueStats: { pending: 1, processing: 0, completed: 48, failed: 2, total: 51 },
          deliveries: [
            {
              id: 701,
              activity_type: "Delete",
              activity_id: "https://modelscript.org/activities/701",
              payload: JSON.stringify({ type: "Delete", actor: "https://modelscript.org/users/admin" }),
              target_inbox: "https://bad-instance.social/inbox",
              target_domain: "bad-instance.social",
              status: "failed",
              attempts: 3,
              max_attempts: 5,
              last_error: "HTTP 502 Bad Gateway",
              next_attempt_at: "2026-10-28T14:00:00Z",
              created_at: "2026-10-28T12:00:00Z",
              updated_at: "2026-10-28T12:30:00Z",
            },
          ],
          deliveryStatusFilter: "failed",
          setDeliveryStatusFilter: () => {},
          onRetryFailedDeliveries: async () => {},
          onPurgeDeliveries: async () => {},
          loading: false,
        }),
      ),
    );

    assert.ok(html.includes("Pending S2S Deliveries"));
    assert.ok(html.includes("Dead-Letter / Failed"));
    assert.ok(html.includes("HTTP 502 Bad Gateway"));
    assert.ok(html.includes("bad-instance.social"));
    assert.ok(html.includes("Export CSV"));
    assert.ok(html.includes("Import Blocklist"));
    assert.ok(html.includes("Inspect"));
  });

  it("renders AdminAuditLogsTab with cryptographic SHA-256 hash chain verification banner and GDPR redaction control", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(AdminAuditLogsTab, {
          auditLogs: [
            {
              id: 55,
              actor_id: 1,
              actor_username: "super_admin",
              action: "moderation_report_resolved",
              resource_type: "content_report",
              resource_id: "101",
              details: JSON.stringify({ status: "resolved", actionExecuted: "mark_sensitive" }),
              ip_address: "REDACTED:a1b2c3d4e5f60123",
              prev_hash: "0000000000000000000000000000000000000000000000000000000000000000",
              entry_hash: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
              created_at: "2026-10-28T12:05:00Z",
            },
          ],
          auditActionFilter: "",
          setAuditActionFilter: () => {},
          onVerifyChain: async () => {},
          onRedactExpiredLogs: async () => {},
          chainVerification: {
            valid: true,
            totalEntries: 55,
            verifiedEntries: 55,
            headHash: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
          },
          loading: false,
        }),
      ),
    );

    assert.ok(html.includes("Verify Hash Chain"));
    assert.ok(html.includes("Redact Expired IPs (GDPR)"));
    assert.ok(html.includes("Cryptographic SHA-256 Chain Intact"));
    assert.ok(html.includes("#abcdef0123"));
  });

  it("renders AdminSettingsTab, AdminSystemTab, AdminDatabaseTab, AdminDmcaTab, and AdminMenuSidebar", () => {
    const settingsHtml = renderToStaticMarkup(
      React.createElement(AdminSettingsTab, {
        settings: {
          instanceName: "ModelScript Enterprise Appliance",
          instanceDescription: "Air-gapped MBSE & DAE Simulation Cluster",
          contactEmail: "ops@acme.corp",
          registrationMode: "invite_only",
          allowedEmailDomains: ["acme.corp"],
          federationMode: "allowlist",
          maintenanceMode: true,
          announcementBanner: "Scheduled maintenance window",
          announcementLevel: "warning",
          autoQuarantineReportThreshold: 5,
          backupRetentionCount: 14,
        },
        invites: [
          {
            id: 1,
            code: "msx-inv-1234567890ab",
            createdBy: 1,
            maxUses: 10,
            usesCount: 3,
            note: "Avionics Team",
            expiresAt: "2026-12-01T00:00:00Z",
            revoked: false,
            createdAt: "2026-10-29T00:00:00Z",
          },
        ],
        onSaveSettings: async () => {},
        onCreateInvite: async () => {},
        onRevokeInvite: async () => {},
        loading: false,
      }),
    );
    assert.ok(settingsHtml.includes("ModelScript Enterprise Appliance"));
    assert.ok(settingsHtml.includes("msx-inv-1234567890ab"));
    assert.ok(settingsHtml.includes("Avionics Team"));
    assert.ok(settingsHtml.includes("Export .env &amp; Docker Config"));
    assert.ok(settingsHtml.includes("Automated Content Filter Keywords"));
    assert.ok(settingsHtml.includes("Custom Instance Legal &amp; Compliance Policies"));
    assert.ok(settingsHtml.includes("Copy Signup Link"));

    const systemHtml = renderToStaticMarkup(
      React.createElement(AdminSystemTab, {
        systemHealth: {
          edition: "ee",
          dbSizeBytes: 4194304,
          walSizeBytes: 524288,
          backupCount: 3,
          totalBackupBytes: 12582912,
          counts: {
            users: 42,
            posts: 180,
            packages: 19,
            repositories: 12,
            jobs: 85,
            auditLogs: 410,
            quarantinedResources: 1,
          },
          jobQueue: { pending: 2, running: 1, completed: 80, failed: 2 },
          auditChainValid: true,
          schema: { currentVersion: 19, targetVersion: 19, pendingCount: 0 },
          geoIpReady: true,
          geoIpMessage: "MaxMind GeoLite2 active",
          mailerConfigured: true,
          airgapMode: false,
          preflight: {
            readyForProduction: true,
            checks: [
              {
                id: "sqlite_wal",
                label: "SQLite WAL Mode",
                status: "pass",
                detail: "SQLite journal_mode is 'wal'.",
              },
            ],
          },
        },
        loading: false,
      }),
    );
    assert.ok(systemHtml.includes("Enterprise"));
    assert.ok(systemHtml.includes("Intact"));
    assert.ok(systemHtml.includes("v19 / v19"));
    assert.ok(systemHtml.includes("3 snapshots"));
    assert.ok(systemHtml.includes("Deployment Preflight &amp; Security Readiness Checklist"));
    assert.ok(systemHtml.includes("SQLite WAL Mode"));
    assert.ok(systemHtml.includes("Send Test Email"));
    assert.ok(systemHtml.includes("Export Redacted Support Bundle"));
    assert.ok(systemHtml.includes("Inspect Prometheus /metrics"));

    const dbHtml = renderToStaticMarkup(
      React.createElement(AdminDatabaseTab, {
        dbStatus: { currentVersion: 19, targetVersion: 19, applied: [], pending: [] },
        dbVerifyResult: null,
        dbUpgradeResult: null,
        dbDryRun: false,
        setDbDryRun: () => {},
        onVerifyDb: async () => {},
        onUpgradeDb: async () => {},
        backups: [
          {
            fileName: "modelscript-backup-2026-10-29.sqlite",
            filePath: "/tmp/modelscript-backup-2026-10-29.sqlite",
            sizeBytes: 204800,
            createdAt: "2026-10-29T12:00:00Z",
            sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          },
        ],
        onCreateHotBackup: async () => {},
        onRestoreBackup: async () => {},
        onDeleteBackup: async () => {},
        onPruneBackups: async () => {},
        loading: false,
      }),
    );
    assert.ok(dbHtml.includes("modelscript-backup-2026-10-29.sqlite"));
    assert.ok(dbHtml.includes("0123456789abcdef"));
    assert.ok(dbHtml.includes("Restore"));
    assert.ok(dbHtml.includes("Download"));
    assert.ok(dbHtml.includes("Upload External .db Snapshot"));
    assert.ok(dbHtml.includes("Export Migration Bundle"));
    assert.ok(dbHtml.includes("Broadcast ActivityPub Move"));

    const dmcaHtml = renderToStaticMarkup(
      React.createElement(AdminDmcaTab, {
        dmcaNotices: [
          {
            id: 7,
            claimant_name: "AeroCorp Legal",
            claimant_email: "ip@aerocorp.example",
            copyright_owner: "AeroCorp",
            work_description: "FlightDynamics package",
            infringing_url: "https://modelscript.org/packages/@aerocorp/flight",
            status: "resolved",
            created_at: "2026-10-29T00:00:00Z",
          },
        ],
        dmcaFilter: "all",
        setDmcaFilter: () => {},
        onResolveDmca: async () => {},
        onFileCounterNotice: async () => {},
        quarantinedResources: [
          {
            id: 1,
            resource_type: "package",
            resource_id: "@aerocorp/flight",
            reason: "DMCA #7",
            dmca_notice_id: 7,
            quarantined_by: 1,
            quarantined_at: "2026-10-29T01:00:00Z",
            restored_at: null,
          },
        ],
        onRestoreQuarantinedResource: async () => {},
        loading: false,
      }),
    );
    assert.ok(dmcaHtml.includes("Record § 512(g) Counter-Notice..."));
    assert.ok(dmcaHtml.includes("Quarantined Engineering Resources"));
    assert.ok(dmcaHtml.includes("@aerocorp/flight"));

    const sidebarHtml = renderToStaticMarkup(
      React.createElement(AdminMenuSidebar, {
        activeTab: "settings",
        onSelectTab: () => {},
        overviewCounts: null,
      }),
    );
    assert.ok(sidebarHtml.includes("Instance Settings &amp; Invites"));
    assert.ok(sidebarHtml.includes("System Health &amp; Diagnostics"));
  });

  it("enforces ContentWarningBox in PostBodyContent and Appeal form in EngineeringNotificationCard", () => {
    const postBodySrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/components/post/PostBodyContent.tsx"),
      "utf-8",
    );
    assert.ok(
      postBodySrc.includes("displayPost?.is_sensitive") && postBodySrc.includes("ContentWarningBox"),
      "PostBodyContent.tsx must render ContentWarningBox when displayPost.is_sensitive is set",
    );

    const notifCardSrc = fs.readFileSync(
      path.resolve(import.meta.dirname, "../src/pages/notifications/components/EngineeringNotificationCard.tsx"),
      "utf-8",
    );
    assert.ok(
      notifCardSrc.includes("submitModerationAppeal") && notifCardSrc.includes("Submit Appeal"),
      "EngineeringNotificationCard.tsx must provide inline moderation appeal submission on security_alert notifications",
    );
  });

  it("hides RightPanel in admin mode and totals Instance Admin menu badges for the left-rail Admin tab badge", async () => {
    const { getTotalAdminBadgeCount } = await import("../src/api/admin");
    assert.equal(getTotalAdminBadgeCount(null), 0);
    assert.equal(
      getTotalAdminBadgeCount({
        pendingReports: 1,
        restrictedUsers: 2,
        failedDeliveries: 3,
        pendingDmca: 4,
        suspendedDomains: 9,
      }),
      10,
    );

    const appShellSrc = fs.readFileSync(path.resolve(import.meta.dirname, "../src/components/AppShell.tsx"), "utf-8");
    assert.ok(
      appShellSrc.includes('location.pathname.startsWith("/admin")'),
      "AppShell.tsx must include /admin in wide layout so RightPanel is hidden in admin mode",
    );

    const sidebarSrc = fs.readFileSync(path.resolve(import.meta.dirname, "../src/components/Sidebar.tsx"), "utf-8");
    assert.ok(
      sidebarSrc.includes("adminPendingCount") && sidebarSrc.includes("AdminNavBadge"),
      "Sidebar.tsx must render AdminNavBadge with adminPendingCount on the left-rail Admin tab",
    );
  });

  it("renders SetupWizardPage with 3 deployment tier presets when needsSetup is true and locked view when completed", () => {
    const baseSettings = {
      instanceName: "Ansatz",
      instanceBadge: "",
      instanceTagline: "The Federated Scientific & Engineering Network",
      instanceDescription: "Federated engineering network",
      contactEmail: "admin@ansatz.social",
      brandLogoUrl: "",
      brandLogoDarkUrl: "",
      brandFaviconUrl: "",
      brandAccentColor: "#06b6d4",
      docsBaseUrl: "https://modelscript.org",
      showPoweredBy: true,
      registrationMode: "invite_only" as const,
      allowedEmailDomains: [],
      federationMode: "open" as const,
      maintenanceMode: false,
      announcementBanner: "",
      announcementLevel: "info" as const,
      autoQuarantineReportThreshold: 3,
      backupRetentionCount: 7,
      lockedByEnv: [],
    };
    const presets = {
      tier1_federated: {
        id: "tier1_federated" as const,
        label: "Tier 1: Independent Federated Node",
        description: "Invite-only registration with open ActivityPub S2S federation.",
        registrationMode: "invite_only" as const,
        federationMode: "open" as const,
        autoQuarantineReportThreshold: 3,
        backupRetentionCount: 7,
        instanceName: "Ansatz",
        instanceBadge: "Lab",
        instanceTagline: "Federated Scientific & Engineering Node",
        showPoweredBy: true,
      },
      tier2_corporate: {
        id: "tier2_corporate" as const,
        label: "Tier 2: Ansatz Enterprise (Corporate Intranet / Air-Gapped Appliance)",
        description: "Email domain allowlist registration with outbound ActivityPub federation disabled.",
        registrationMode: "domain_allowlist" as const,
        federationMode: "disabled" as const,
        autoQuarantineReportThreshold: 5,
        backupRetentionCount: 14,
        instanceName: "Ansatz Enterprise",
        instanceBadge: "Enterprise",
        instanceTagline: "Private Multiphysics Modeling & Simulation Appliance",
        showPoweredBy: true,
      },
      tier3_flagship: {
        id: "tier3_flagship" as const,
        label: "Tier 3: Public Flagship Hub",
        description: "Open registration with anti-Sybil verification.",
        registrationMode: "open" as const,
        federationMode: "open" as const,
        autoQuarantineReportThreshold: 5,
        backupRetentionCount: 30,
        instanceName: "Ansatz",
        instanceBadge: "",
        instanceTagline: "The Federated Scientific & Engineering Network",
        showPoweredBy: true,
      },
    };

    const wizardHtml = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(SetupWizardPage, {
          initialStatus: {
            needsSetup: true,
            hasAdmin: false,
            setupCompleted: false,
            userCount: 0,
            edition: "ce",
            airgapEnforced: false,
            settings: baseSettings,
            presets,
          },
        }),
      ),
    );

    assert.ok(wizardHtml.includes("Ansatz First-Run Install Wizard"));
    assert.ok(wizardHtml.includes("Tier 1: Independent Federated Node"));
    assert.ok(wizardHtml.includes("Tier 2: Ansatz Enterprise (Corporate Intranet / Air-Gapped Appliance)"));
    assert.ok(wizardHtml.includes("Tier 3: Public Flagship Hub"));
    assert.ok(wizardHtml.includes("Upload Bundle (.json)"));

    const lockedHtml = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(SetupWizardPage, {
          initialStatus: {
            needsSetup: false,
            hasAdmin: true,
            setupCompleted: true,
            userCount: 1,
            edition: "ee",
            airgapEnforced: true,
            settings: baseSettings,
            presets,
          },
        }),
      ),
    );
    assert.ok(lockedHtml.includes("Instance Setup Already Completed"));
    assert.ok(lockedHtml.includes("Re-run Setup Wizard"));
    assert.ok(lockedHtml.includes("Ansatz"));

    const devModeBarSource = fs.readFileSync(new URL("../src/components/DevModeBar.tsx", import.meta.url), "utf-8");
    assert.ok(devModeBarSource.includes("resetInstanceSetupWizard"));
    assert.ok(devModeBarSource.includes("Setup Wizard"));
    assert.ok(devModeBarSource.includes('navigate("/setup")'));
  });

  it("renders multi-tiered Maintenance Lifecycle controls, ETA presets, MaintenanceExperienceHost, and static maintenance.html fallback", async () => {
    const { MaintenanceExperienceHost, formatRelativeCountdown, formatElapsed } =
      await import("../src/components/MaintenanceExperienceHost");
    const { InstanceBrandingProvider } = await import("../src/InstanceBrandingContext");
    const { AuthProvider } = await import("../src/AuthContext");

    const settingsHtml = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(AdminSettingsTab, {
          settings: {
            instanceName: "Ansatz",
            instanceBadge: "Lab",
            instanceTagline: "The Federated Scientific & Engineering Network",
            instanceDescription: "Federated engineering network",
            contactEmail: "admin@ansatz.social",
            registrationMode: "open",
            allowedEmailDomains: [],
            federationMode: "open",
            maintenanceMode: true,
            maintenanceLevel: "lockdown",
            maintenanceEta: "2026-10-30T03:00:00Z",
            announcementBanner: "Upgrading TimescaleDB hypertables and solver nodes.",
            announcementLevel: "critical",
            autoQuarantineReportThreshold: 5,
            backupRetentionCount: 14,
            lockedByEnv: ["maintenanceMode"],
          },
          invites: [],
          onSaveSettings: async () => {},
          onCreateInvite: async () => {},
          onRevokeInvite: async () => {},
          loading: false,
        }),
      ),
    );
    assert.ok(settingsHtml.includes("Maintenance Lifecycle, Takedown Posture &amp; System Announcement Banner"));
    assert.ok(settingsHtml.includes("Hard Lockdown (Full Status Portal + Offline WASM Sandbox)"));
    assert.ok(settingsHtml.includes("Locked by MSX_MAINTENANCE_MODE"));
    assert.ok(settingsHtml.includes("2026-10-30T03:00:00Z"));
    assert.ok(settingsHtml.includes("+15m"));
    assert.ok(settingsHtml.includes("+30m"));

    const baseNow = Date.parse("2026-10-30T02:00:00Z");
    assert.equal(formatRelativeCountdown("2026-10-30T02:15:30Z", baseNow), "15m 30s");
    assert.equal(formatElapsed("2026-10-30T01:40:00Z", baseNow), "20m elapsed");

    const hostHtml = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(
          AuthProvider,
          null,
          React.createElement(
            InstanceBrandingProvider,
            {
              initialBranding: {
                maintenanceMode: true,
                maintenanceLevel: "lockdown",
                maintenanceEta: "2026-10-30T03:00:00Z",
                announcementBanner: "Upgrading TimescaleDB hypertables and solver nodes.",
                subsystems: {
                  coreApi: "maintenance",
                  packageRegistry: "maintenance",
                  cloudSolvers: "maintenance",
                  federationQueue: "paused",
                  wasmSandbox: "operational",
                },
              },
            },
            React.createElement(MaintenanceExperienceHost),
          ),
        ),
      ),
    );
    assert.ok(hostHtml.includes("We’re upgrading Ansatz infrastructure"));
    assert.ok(hostHtml.includes("Open Offline WASM Playground"));
    assert.ok(hostHtml.includes("Subsystem Telemetry Status"));
    assert.ok(hostHtml.includes("Client-Side WASM Compiler &amp; Local DAE Solver"));

    const staticMaintHtml = fs.readFileSync(new URL("../public/maintenance.html", import.meta.url), "utf-8");
    assert.ok(staticMaintHtml.includes("Launch Offline WASM Playground"));
    assert.ok(staticMaintHtml.includes("/api/v1/instance/banner"));
  });
});
