// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { AdminAuditLogsTab } from "../src/pages/admin/tabs/AdminAuditLogsTab";
import { AdminFederationTab } from "../src/pages/admin/tabs/AdminFederationTab";
import { AdminModerationTab } from "../src/pages/admin/tabs/AdminModerationTab";
import { AdminUsersTab } from "../src/pages/admin/tabs/AdminUsersTab";

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
              account_type: "user",
              status: "frozen",
              remote_domain: "bad-instance.social",
              post_count: 14,
              report_count: 2,
              created_at: "2026-10-01T00:00:00Z",
            },
          ],
          userSearchQuery: "",
          setUserSearchQuery: () => {},
          userStatusFilter: "all",
          setUserStatusFilter: () => {},
          userRoleFilter: "all",
          setUserRoleFilter: () => {},
          onModerateUser: async () => {},
          loading: false,
        }),
      ),
    );

    assert.ok(html.includes("Frozen (Read-Only)"));
    assert.ok(html.includes("remote_spammer"));
    assert.ok(html.includes("frozen"));
    assert.ok(html.includes("bad-instance.social"));
  });

  it("renders AdminFederationTab with Domain Tier policies and S2S Delivery Queue telemetry", () => {
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
          queueStats: { pending: 1, processing: 0, completed: 48, failed: 2, total: 51 },
          deliveries: [
            {
              id: 701,
              activity_type: "Delete",
              activity_id: "https://modelscript.org/activities/701",
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
  });

  it("renders AdminAuditLogsTab with cryptographic SHA-256 hash chain verification banner", () => {
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
              target_type: "content_report",
              target_id: "101",
              metadata: JSON.stringify({ status: "resolved", actionExecuted: "mark_sensitive" }),
              ip_address: "127.0.0.1",
              prev_hash: "0000000000000000000000000000000000000000000000000000000000000000",
              entry_hash: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
              created_at: "2026-10-28T12:05:00Z",
            },
          ],
          auditActionFilter: "",
          setAuditActionFilter: () => {},
          onRefresh: () => {},
          onVerifyChain: async () => {},
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
    assert.ok(html.includes("Cryptographic SHA-256 Chain Intact"));
    assert.ok(html.includes("#abcdef0123"));
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
});
