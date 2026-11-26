// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_SRC_DIR = path.resolve(__dirname, "../src");

describe("Phase 3 Workstream 3: Organizations API, OrganizationTab & SecurityTab", () => {
  describe("api/organizations.ts URL encoding", () => {
    it("encodes slug with encodeURIComponent in getOrganizationMembers, addOrganizationMember, and removeOrganizationMember", async () => {
      const { api } = await import("../src/api/client.js");
      const { addOrganizationMember, getOrganizationMembers, removeOrganizationMember } =
        await import("../src/api/organizations.js");

      const calls: Array<{ method: string; url: string }> = [];
      const origGet = api.get;
      const origPost = api.post;
      const origDelete = api.delete;

      try {
        (api as any).get = async (url: string) => {
          calls.push({ method: "GET", url });
          return { data: { members: [] } };
        };
        (api as any).post = async (url: string) => {
          calls.push({ method: "POST", url });
          return { data: {} };
        };
        (api as any).delete = async (url: string) => {
          calls.push({ method: "DELETE", url });
          return { data: {} };
        };

        const rawSlug = "acme/propulsion?x=1#frag";
        const encodedSlug = encodeURIComponent(rawSlug);

        await getOrganizationMembers(rawSlug);
        await addOrganizationMember(rawSlug, "alice", "maintainer");
        await removeOrganizationMember(rawSlug, 42);

        assert.deepStrictEqual(calls, [
          { method: "GET", url: `/organizations/${encodedSlug}/members` },
          { method: "POST", url: `/organizations/${encodedSlug}/members` },
          { method: "DELETE", url: `/organizations/${encodedSlug}/members/42` },
        ]);
      } finally {
        api.get = origGet;
        api.post = origPost;
        api.delete = origDelete;
      }
    });

    it("has no unencoded ${slug} interpolations in api/organizations.ts", () => {
      const src = fs.readFileSync(path.join(WEB_SRC_DIR, "api/organizations.ts"), "utf-8");
      assert.ok(!src.includes("${slug}"), "api/organizations.ts must not interpolate raw ${slug}");
    });
  });

  describe("OrganizationTab.tsx RBAC, confirmation, double-submit, fetch & a11y", () => {
    const orgTabSrc = fs.readFileSync(path.join(WEB_SRC_DIR, "pages/settings/tabs/OrganizationTab.tsx"), "utf-8");

    it("syncs selectedOrg and organizations state on self-demotion and self-removal", () => {
      assert.ok(orgTabSrc.includes("useAuth"), "OrganizationTab must read current user from useAuth");
      assert.ok(
        orgTabSrc.includes("if (user?.id === userId)"),
        "OrganizationTab must check user?.id === userId for self-demotion and self-removal",
      );
      assert.ok(
        orgTabSrc.includes(
          "setSelectedOrg((prev) => (prev && prev.slug === orgSlug ? { ...prev, role: newRole } : prev))",
        ),
        "OrganizationTab must update selectedOrg.role on self-demotion",
      );
      assert.ok(
        orgTabSrc.includes("const remaining = organizations.filter((o) => o.slug !== orgSlug);") &&
          orgTabSrc.includes("setSelectedOrg(remaining[0] ?? null);"),
        "OrganizationTab must remove org and select next org or null on self-removal",
      );
    });

    it("requires inline confirmation before promoting a member to owner", () => {
      assert.ok(
        orgTabSrc.includes("const [confirmOwnerPromotion, setConfirmOwnerPromotion] = useState<{"),
        "OrganizationTab must maintain confirmOwnerPromotion state",
      );
      assert.ok(
        orgTabSrc.includes('if (nextRole === "owner" && member.role !== "owner")'),
        "OrganizationTab must intercept owner promotion from role dropdown",
      );
      assert.ok(orgTabSrc.includes("Confirm Owner"), "OrganizationTab must render an inline Confirm Owner button");
    });

    it("guards against double-submits across create, add, update role, and remove actions", () => {
      assert.ok(orgTabSrc.includes("isCreatingOrg"), "OrganizationTab must track isCreatingOrg");
      assert.ok(orgTabSrc.includes("isAddingMember"), "OrganizationTab must track isAddingMember");
      assert.ok(orgTabSrc.includes("updatingMemberUserId"), "OrganizationTab must track updatingMemberUserId");
      assert.ok(orgTabSrc.includes("removingMemberUserId"), "OrganizationTab must track removingMemberUserId");
    });

    it("uses selectedOrg?.slug with cancellation guard for member fetches and surfaces fetch errors", () => {
      assert.ok(
        orgTabSrc.includes("const selectedOrgSlug = selectedOrg?.slug;") &&
          orgTabSrc.includes("}, [selectedOrgSlug]);"),
        "OrganizationTab member fetch effect must depend on selectedOrg?.slug rather than full selectedOrg object",
      );
      assert.ok(
        !orgTabSrc.includes(".catch(() => {})") && !orgTabSrc.includes(".catch(() => setMembers([]))"),
        "OrganizationTab must not silently swallow getMyOrganizations or getOrganizationMembers errors",
      );
      assert.ok(
        orgTabSrc.includes("Failed to load organizations.") &&
          orgTabSrc.includes("Failed to load organization members."),
        "OrganizationTab must surface error feedback for failed organization and member fetches",
      );
    });

    it("applies sessionStorage try/catch, url input type, member role fallback, horizontal scroll, and aria-labels", () => {
      assert.ok(
        orgTabSrc.includes('try {\n                            sessionStorage.setItem("ms_billing_org_id"') ||
          (orgTabSrc.includes('sessionStorage.setItem("ms_billing_org_id"') && orgTabSrc.includes("} catch {")),
        "OrganizationTab must wrap sessionStorage.setItem in try/catch",
      );
      assert.ok(orgTabSrc.includes('type="url"'), 'Website input must have type="url"');
      assert.ok(
        !orgTabSrc.includes('selectedOrg.role || "owner"') &&
          !orgTabSrc.includes('(selectedOrg.role as OrgRole) || "owner"'),
        "OrganizationTab must not default missing selectedOrg.role to owner",
      );
      assert.ok(
        orgTabSrc.includes('selectedOrg.role || "member"'),
        "OrganizationTab must default missing selectedOrg.role to member",
      );
      assert.ok(
        orgTabSrc.includes('overflowX: "auto"') && !orgTabSrc.includes('overflow: "hidden"'),
        "MembersTable container must use overflowX: auto instead of overflow: hidden",
      );
      assert.ok(orgTabSrc.includes('aria-label="Go back"'), "Back button must have aria-label");
      assert.ok(orgTabSrc.includes('aria-label="Select organization"'), "Org switcher must have aria-label");
      assert.ok(
        orgTabSrc.includes("aria-label={`Remove ${member.username}`}"),
        "Remove icon button must have descriptive aria-label",
      );
    });
  });

  describe("SecurityTab.tsx dead-code removal, backup codes, keystore, and polish", () => {
    const secTabSrc = fs.readFileSync(path.join(WEB_SRC_DIR, "pages/settings/tabs/SecurityTab.tsx"), "utf-8");

    it("removes dead inline backup-code regeneration code and unused imports", () => {
      assert.ok(!secTabSrc.includes("showInlineRegenerate"), "showInlineRegenerate must be removed");
      assert.ok(
        !secTabSrc.includes("handleRegenerateBackupCodesInline"),
        "handleRegenerateBackupCodesInline must be removed",
      );
      assert.ok(!secTabSrc.includes("handleCopyBackupCodes"), "handleCopyBackupCodes must be removed");
      assert.ok(!secTabSrc.includes("handleDownloadBackupCodes"), "handleDownloadBackupCodes must be removed");
      assert.ok(!secTabSrc.includes("regenerateBackupCodes2FA"), "regenerateBackupCodes2FA import must be removed");
    });

    it("does not default undefined backup_codes_remaining to 10", () => {
      assert.ok(
        !secTabSrc.includes('typeof initialBackupCodes === "number" ? initialBackupCodes : 10'),
        "SecurityTab must not default undefined backup_codes_remaining to 10",
      );
      assert.ok(
        secTabSrc.includes('typeof initialBackupCodes === "number" ? initialBackupCodes : undefined') &&
          secTabSrc.includes('is2FAEnabled && typeof backupCodesRemaining === "number"'),
        "SecurityTab must only render backup codes remaining count when defined as a number",
      );
    });

    it("surfaces getPublicKeys fetch errors with role=alert and unmount guard", () => {
      assert.ok(
        secTabSrc.includes("Failed to load authorized device keys."),
        "SecurityTab must surface initial getPublicKeys errors",
      );
      assert.ok(secTabSrc.includes('role="alert"'), 'SecurityTab error banner must use role="alert"');
      assert.ok(
        secTabSrc.includes("let cancelled = false;") && secTabSrc.includes("cancelled = true;"),
        "SecurityTab initial fetch effect must guard against unmount",
      );
    });

    it("guards key revocation and Enter keydown while loading", () => {
      assert.ok(secTabSrc.includes("revokingKeyId"), "SecurityTab must track revokingKeyId");
      assert.ok(
        secTabSrc.includes("if (loading) return;"),
        "SecurityTab must guard Enter keydown and handleGenerateKey when loading",
      );
    });

    it("uses crypto.randomUUID with fallback and safe IndexedDB keystore persistence", () => {
      assert.ok(secTabSrc.includes("crypto.randomUUID()"), "SecurityTab must use crypto.randomUUID()");
      assert.ok(!secTabSrc.includes("`key-${Date.now()}`"), "SecurityTab must not use key-${Date.now()}");
      assert.ok(
        secTabSrc.includes("Failed to save private key to browser keystore"),
        "SecurityTab must surface clear error if IndexedDB keystore save fails",
      );
      assert.ok(
        secTabSrc.includes("await deletePrivateKey(keyIdString).catch(() => {});"),
        "SecurityTab must clean up local private key if addPublicKey fails",
      );
    });

    it("cleans up session revoke timeout, removes console.error, wires onBack, and pads SigningKeysSection", () => {
      assert.ok(
        secTabSrc.includes("sessionRevokeTimerRef") &&
          secTabSrc.includes("clearTimeout(sessionRevokeTimerRef.current)"),
        "SecurityTab must clean up setTimeout on unmount",
      );
      assert.ok(!secTabSrc.includes("console.error"), "SecurityTab must not contain stray console.error");
      assert.ok(
        secTabSrc.includes("SecurityTab: React.FC<SecurityTabProps> = ({ onBack })") &&
          secTabSrc.includes('aria-label="Go back"'),
        "SecurityTab must wire onBack to a back button with aria-label",
      );
      const signingIdx = secTabSrc.indexOf("<SigningKeysSection />");
      const boxCloseAfterSigning = secTabSrc.indexOf("</Box>", signingIdx);
      const modalIdx = secTabSrc.indexOf("<TwoFactorModal");
      assert.ok(
        signingIdx > 0 && boxCloseAfterSigning > signingIdx && boxCloseAfterSigning < modalIdx,
        "SigningKeysSection must be rendered inside the padded <Box px={3} pb={3}> container",
      );
    });
  });
});
