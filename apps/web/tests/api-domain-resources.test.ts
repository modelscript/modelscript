// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  acceptPackageTransfer,
  addPackageCollaborator,
  api,
  blockUser,
  bookmarkPost,
  bulkResolveAdminModerationReports,
  cancelPackageTransfer,
  changeAccountCredentials,
  createAdminHotBackup,
  createApiToken,
  // artifacts
  createArtifactView,
  createBot,
  createGitlabIssue,
  createPost,
  createThreadProposal,
  deleteAccount,
  deleteBot,
  getAdminAuditLogs,
  getAdminBackups,
  getAdminDbStatus,
  getAdminFeatureFlags,
  getAdminFederationDomains,
  getAdminFederationQueue,
  // admin
  getAdminModerationQueue,
  getAdminOverview,
  getAdminUsers,
  getApiTokens,
  getArtifactView,
  // bots
  getBots,
  getCloudSimulationResultCsv,
  getCloudSimulationStatus,
  // compute
  getComputeProfiles,
  getConnectedAccounts,
  getGitlabCommits,
  getGitlabFileRaw,
  getGitlabIssues,
  getGitlabPipelines,
  // vcs
  getGitlabProject,
  getGitlabTree,
  getIconUrl,
  // packages
  getLibraries,
  getLibraryDetail,
  getNotifications,
  getNotificationSettings,
  getPackageCollaborators,
  getPendingPackageTransfers,
  getPost,
  getPostReplies,
  getPublicSolutions,
  getSolution,
  getThreadAuditLogs,
  // governance
  getThreadProposals,
  getTimeline,
  getUserBillingSummary,
  getUserDataArchiveStatus,
  // social
  getUserProfile,
  getUserSolutions,
  getUserTransactions,
  // billing
  getUserWallet,
  likePost,
  moderateAdminUser,
  muteUser,
  patchAdminFeatureFlag,
  purgeAdminFederationQueue,
  removePackageCollaborator,
  reportPost,
  reportResource,
  reportUser,
  repostPost,
  requestUserDataArchiveJob,
  resolveAdminModerationReport,
  retryAdminFederationQueue,
  reviewThreadProposal,
  revokeApiToken,
  setAdminFederationDomainTier,
  setup2FA,
  submitCloudSimulation,
  submitModerationAppeal,
  topUpCredits,
  transferPackageOwnership,
  unblockUser,
  unlinkConnectedAccount,
  unmuteUser,
  // account
  updateAccount,
  updateBot,
  updateNotificationSettings,
  updateUserProfile,
  uploadArtifactThumbnail,
  verify2FA,
  verifyAdminAuditLogsChain,
} from "../src/api";

describe("Modular API Domain Resources Client Suite", () => {
  let lastRequest: {
    method: string;
    url: string;
    data?: any;
    params?: any;
  } | null = null;

  beforeEach(() => {
    lastRequest = null;
  });

  function mockApiCall(method: "get" | "post" | "put" | "delete" | "patch", fakeResponse: any) {
    (api as any)[method] = async (url: string, ...args: any[]) => {
      let data: any = undefined;
      let config: any = undefined;

      if (method === "get" || method === "delete") {
        config = args[0];
      } else {
        data = args[0];
        config = args[1];
      }

      lastRequest = {
        method,
        url,
        data,
        params: config?.params,
      };

      return { data: fakeResponse };
    };
  }

  describe("Packages Domain API", () => {
    it("getLibraries calls /libraries with correct query parameters", async () => {
      mockApiCall("get", { packages: [{ name: "Modelica", versions: ["4.0.0"] }] });
      const res = await getLibraries("electrical");

      assert.equal(lastRequest?.url, "/libraries");
      assert.deepEqual(lastRequest?.params, {
        q: "electrical",
      });
      assert.equal(res.length, 1);
      assert.equal(res[0]!.name, "Modelica");
    });

    it("getLibraryDetail fetches details by package name and version", async () => {
      mockApiCall("get", { name: "PowerSystems", version: "2.1.0" });
      const res = await getLibraryDetail("PowerSystems", "2.1.0");

      assert.equal(lastRequest?.url, "/libraries/PowerSystems/2.1.0");
      assert.equal(res.name, "PowerSystems");
    });

    it("package collaborators and transfers interact with package endpoints", async () => {
      mockApiCall("get", { package: "Modelica", collaborators: [{ username: "alice", role: "maintainer" }] });
      const collabs = await getPackageCollaborators("Modelica");
      assert.equal(lastRequest?.url, "/libraries/Modelica/collaborators");
      assert.equal(collabs.collaborators[0]!.username, "alice");

      mockApiCall("post", { success: true });
      await addPackageCollaborator("Modelica", "bob", "write");
      assert.equal(lastRequest?.url, "/libraries/Modelica/collaborators");
      assert.deepEqual(lastRequest?.data, { username: "bob", permission: "write" });

      mockApiCall("delete", { success: true });
      await removePackageCollaborator("Modelica", 123);
      assert.equal(lastRequest?.url, "/libraries/Modelica/collaborators/123");

      mockApiCall("get", { transfers: [{ id: 1, package_name: "Modelica" }] });
      const transfers = await getPendingPackageTransfers();
      assert.equal(lastRequest?.url, "/libraries/transfers/pending");
      assert.equal(transfers.length, 1);

      mockApiCall("post", { success: true });
      await transferPackageOwnership("Modelica", "new_owner");
      assert.equal(lastRequest?.url, "/libraries/Modelica/transfer-ownership");
      assert.deepEqual(lastRequest?.data, { targetUsername: "new_owner" });

      mockApiCall("post", { success: true });
      await acceptPackageTransfer(1);
      assert.equal(lastRequest?.url, "/libraries/transfers/1/accept");

      mockApiCall("post", { success: true });
      await cancelPackageTransfer(1);
      assert.equal(lastRequest?.url, "/libraries/transfers/1/cancel");
    });
  });

  describe("Account & Profile Domain API", () => {
    it("manages account updates, password change, and deletion", async () => {
      mockApiCall("put", { success: true, user: { username: "engineer_v2" } });
      const res = await updateAccount({ display_name: "Lead Engineer" });
      assert.equal(lastRequest?.url, "/auth/account");
      assert.deepEqual(lastRequest?.data, { display_name: "Lead Engineer" });
      assert.equal(res.success, true);

      mockApiCall("put", { success: true });
      await changeAccountCredentials({ oldPassword: "old", newPassword: "new" });
      assert.equal(lastRequest?.url, "/auth/password");
      assert.deepEqual(lastRequest?.data, { oldPassword: "old", newPassword: "new" });

      mockApiCall("delete", { success: true });
      await deleteAccount();
      assert.equal(lastRequest?.url, "/users/me");
    });

    it("handles data archive jobs and status", async () => {
      mockApiCall("post", {
        success: true,
        job: { id: "job_export_1", status: "queued", format: "zip", createdAt: "2026-10-26" },
      });
      const job = await requestUserDataArchiveJob("zip");
      assert.equal(lastRequest?.url, "/users/me/export");
      assert.deepEqual(lastRequest?.data, { format: "zip" });
      assert.equal(job.id, "job_export_1");

      mockApiCall("get", { job: { id: "job_export_1", status: "completed", format: "zip", createdAt: "2026-10-26" } });
      const status = await getUserDataArchiveStatus("job_export_1");
      assert.equal(lastRequest?.url, "/users/me/export/status?jobId=job_export_1");
      assert.equal(status?.status, "completed");
    });

    it("manages notification settings and connected accounts", async () => {
      mockApiCall("get", { qualityFilter: true, inAppSounds: true });
      const notifs = await getNotificationSettings();
      assert.equal(lastRequest?.url, "/auth/notifications");
      assert.equal(notifs.qualityFilter, true);

      mockApiCall("put", { success: true });
      await updateNotificationSettings({ inAppSounds: false });
      assert.equal(lastRequest?.url, "/auth/notifications");
      assert.deepEqual(lastRequest?.data, { inAppSounds: false });

      mockApiCall("get", { providers: [{ provider: "github", name: "GitHub", connected: true }] });
      const accounts = await getConnectedAccounts();
      assert.equal(lastRequest?.url, "/auth/connected-accounts");
      assert.equal(accounts.providers[0]!.provider, "github");

      mockApiCall("delete", { success: true });
      await unlinkConnectedAccount("github");
      assert.equal(lastRequest?.url, "/auth/connected-accounts/github");
    });

    it("manages 2FA and API tokens lifecycle", async () => {
      mockApiCall("post", { secret: "XYZ123", otpauthUri: "otpauth://..." });
      const setup = await setup2FA();
      assert.equal(lastRequest?.url, "/auth/2fa/setup");
      assert.equal(setup.secret, "XYZ123");

      mockApiCall("post", { success: true, message: "Verified", backupCodes: ["code1"] });
      const verify = await verify2FA("123456", "XYZ123");
      assert.equal(lastRequest?.url, "/auth/2fa/verify");
      assert.deepEqual(lastRequest?.data, { code: "123456", secret: "XYZ123" });
      assert.equal(verify.success, true);

      mockApiCall("get", { tokens: [{ id: 42, name: "CI Token" }] });
      const tokens = await getApiTokens();
      assert.equal(lastRequest?.url, "/auth/tokens");
      assert.equal(tokens[0]!.id, 42);

      mockApiCall("post", { id: 43, name: "Deploy Token", token: "tok_secret" });
      const createdToken = await createApiToken({ name: "Deploy Token", scopes: ["packages:publish"] });
      assert.equal(lastRequest?.url, "/auth/tokens");
      assert.equal(createdToken.id, 43);

      mockApiCall("delete", { success: true });
      await revokeApiToken(43);
      assert.equal(lastRequest?.url, "/auth/tokens/43");
    });
  });

  describe("Billing & Credits Domain API", () => {
    it("fetches wallet, transactions, usage summary, and top-up", async () => {
      mockApiCall("get", { creditBalance: 125.5, currency: "USD" });
      const wallet = await getUserWallet();
      assert.equal(lastRequest?.url, "/billing/wallet");
      assert.equal(wallet.creditBalance, 125.5);

      mockApiCall("post", { success: true, newBalance: 225.5, amountAdded: 100 });
      const topUp = await topUpCredits(100, "sandbox_card");
      assert.equal(lastRequest?.url, "/billing/topup");
      assert.deepEqual(lastRequest?.data, { amount: 100, paymentMethod: "sandbox_card" });
      assert.equal(topUp.newBalance, 225.5);

      mockApiCall("get", { transactions: [{ id: 1, amount: 100 }], count: 1 });
      const txs = await getUserTransactions(10, 0);
      assert.equal(lastRequest?.url, "/billing/transactions");
      assert.deepEqual(lastRequest?.params, { limit: 10, offset: 0 });
      assert.equal(txs.transactions.length, 1);

      mockApiCall("get", { creditBalance: 225.5, totalSpent: 50 });
      const summary = await getUserBillingSummary();
      assert.equal(lastRequest?.url, "/billing/usage");
      assert.equal(summary.creditBalance, 225.5);
    });
  });

  describe("Compute & Cloud Simulation Domain API", () => {
    it("manages compute profiles and simulation execution lifecycle", async () => {
      mockApiCall("get", { profiles: [{ id: "standard", name: "Standard Cluster", cpus: 8 }] });
      const profiles = await getComputeProfiles();
      assert.equal(lastRequest?.url, "/cae/profiles");
      assert.equal(profiles[0]!.cpus, 8);

      mockApiCall("post", { jobId: "job_slurm_999" });
      const submitRes = await submitCloudSimulation({
        modelName: "Modelica.Electrical.Analog.Examples.ChuaCircuit",
        numberOfIntervals: 1000,
        profile: "hpc_gpu",
      });
      assert.equal(lastRequest?.url, "/simulate");
      assert.equal(submitRes.jobId, "job_slurm_999");

      mockApiCall("get", { id: "job_slurm_999", status: "completed" });
      const statusRes = await getCloudSimulationStatus("job_slurm_999");
      assert.equal(lastRequest?.url, "/simulate/job_slurm_999");
      assert.equal(statusRes.status, "completed");

      mockApiCall("get", "time,v1,v2\n0,0,0\n1,1,2");
      const csv = await getCloudSimulationResultCsv("job_slurm_999");
      assert.equal(lastRequest?.url, "/simulate/job_slurm_999/result");
      assert.match(csv, /^time,v1,v2/);
    });
  });

  describe("Admin Domain API", () => {
    it("fetches moderation queue, audit logs, federation, and flags", async () => {
      mockApiCall("get", { reports: [{ id: 1, reason: "Spam" }], count: 1 });
      const queue = await getAdminModerationQueue("pending", 20, 0);
      assert.equal(lastRequest?.url, "/admin/moderation/queue");
      assert.deepEqual(lastRequest?.params, { status: "pending", limit: 20, offset: 0 });
      assert.equal(queue.reports.length, 1);

      mockApiCall("post", { success: true, reportId: 1, status: "resolved", actionExecuted: "none" });
      await resolveAdminModerationReport(1, { status: "resolved", resolutionNotes: "Banned account" });
      assert.equal(lastRequest?.url, "/admin/moderation/reports/1/resolve");
      assert.deepEqual(lastRequest?.data, { status: "resolved", resolutionNotes: "Banned account" });

      mockApiCall("get", { domains: [{ domain: "bad-actor.org", tier: "suspend" }], count: 1 });
      const domains = await getAdminFederationDomains();
      assert.equal(lastRequest?.url, "/admin/federation/domains");
      assert.equal(domains.domains[0]!.domain, "bad-actor.org");

      mockApiCall("post", { success: true, domain: "spam.xyz", tier: "silence" });
      await setAdminFederationDomainTier("spam.xyz", "silence", "Automated bots");
      assert.equal(lastRequest?.url, "/admin/federation/domains");
      assert.deepEqual(lastRequest?.data, { domain: "spam.xyz", tier: "silence", reason: "Automated bots" });

      mockApiCall("get", { logs: [{ id: 101, action: "tier_update" }], count: 1 });
      const logs = await getAdminAuditLogs(50, 0);
      assert.equal(lastRequest?.url, "/admin/audit-logs");
      assert.deepEqual(lastRequest?.params, { limit: 50, offset: 0, action: undefined });
      assert.equal(logs.logs[0]!.action, "tier_update");

      mockApiCall("get", { currentVersion: 5, latestVersion: 5 });
      const db = await getAdminDbStatus();
      assert.equal(lastRequest?.url, "/admin/db/status");
      assert.equal(db.currentVersion, 5);

      mockApiCall("get", { flags: [{ key: "ENABLE_WASM", currentEnabled: true }] });
      const flags = await getAdminFeatureFlags();
      assert.equal(lastRequest?.url, "/admin/flags");
      assert.equal(flags.flags[0]!.currentEnabled, true);

      mockApiCall("patch", { success: true, key: "ENABLE_WASM", isEnabled: false });
      await patchAdminFeatureFlag("ENABLE_WASM", false);
      assert.equal(lastRequest?.url, "/admin/flags/ENABLE_WASM");
      assert.deepEqual(lastRequest?.data, { isEnabled: false, allowedRoles: undefined, rolloutPercentage: undefined });

      mockApiCall("get", {
        pendingReports: 2,
        pendingDmca: 1,
        failedDeliveries: 3,
        pendingDeliveries: 0,
        restrictedUsers: 1,
      });
      const overview = await getAdminOverview();
      assert.equal(lastRequest?.url, "/admin/overview");
      assert.equal(overview.pendingReports, 2);

      mockApiCall("post", { success: true, resolvedCount: 2, status: "resolved", actionExecuted: "delete_post" });
      const bulkRes = await bulkResolveAdminModerationReports({
        reportIds: [1, 2],
        status: "resolved",
        action: "delete_post",
      });
      assert.equal(lastRequest?.url, "/admin/moderation/bulk-resolve");
      assert.equal(bulkRes.resolvedCount, 2);

      mockApiCall("get", { users: [{ id: 7, username: "alice", status: "active", role: "user" }], count: 1 });
      const users = await getAdminUsers({ q: "alice", status: "active" });
      assert.equal(lastRequest?.url, "/admin/users");
      assert.equal(users.users[0]!.username, "alice");

      mockApiCall("patch", {
        success: true,
        userId: 7,
        status: "frozen",
        role: "user",
        sessionsRevoked: true,
        purgedPostCount: 0,
      });
      const modUser = await moderateAdminUser(7, { status: "frozen", reason: "Cooling off" });
      assert.equal(lastRequest?.url, "/admin/users/7");
      assert.equal(modUser.status, "frozen");

      mockApiCall("get", {
        stats: { pending: 0, processing: 0, completed: 5, failed: 1, total: 6 },
        deliveries: [],
        count: 0,
      });
      const fedQ = await getAdminFederationQueue("failed");
      assert.equal(lastRequest?.url, "/admin/federation/queue");
      assert.equal(fedQ.stats.failed, 1);

      mockApiCall("post", { success: true, retriedCount: 1 });
      const retried = await retryAdminFederationQueue("bad-actor.org");
      assert.equal(lastRequest?.url, "/admin/federation/queue/retry");
      assert.equal(retried.retriedCount, 1);

      mockApiCall("delete", { success: true, deletedCount: 1 });
      const purged = await purgeAdminFederationQueue("failed");
      assert.equal(lastRequest?.url, "/admin/federation/queue");
      assert.equal(purged.deletedCount, 1);

      mockApiCall("get", {
        backups: [{ fileName: "backup-1.sqlite", sizeBytes: 4096, createdAt: "2026-10-28" }],
        count: 1,
      });
      const backups = await getAdminBackups();
      assert.equal(lastRequest?.url, "/admin/backups");
      assert.equal(backups.backups.length, 1);

      mockApiCall("post", {
        success: true,
        backup: {
          fileName: "backup-2.sqlite",
          filePath: "/tmp/backup-2.sqlite",
          sizeBytes: 4096,
          createdAt: "2026-10-28",
        },
      });
      const createdBackup = await createAdminHotBackup("pre-upgrade");
      assert.equal(lastRequest?.url, "/admin/backup");
      assert.equal(createdBackup.backup.fileName, "backup-2.sqlite");

      mockApiCall("get", {
        valid: true,
        totalEntries: 42,
        verifiedEntries: 42,
        headHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      });
      const chainRes = await verifyAdminAuditLogsChain();
      assert.equal(lastRequest?.url, "/admin/audit-logs/verify");
      assert.equal(chainRes.valid, true);
      assert.equal(chainRes.verifiedEntries, 42);
    });
  });

  describe("Social & Feed Domain API", () => {
    it("handles user profile inspection and updates", async () => {
      mockApiCall("get", { username: "engineer", bio: "Simulations Lead" });
      const prof = await getUserProfile("engineer");
      assert.equal(lastRequest?.url, "/users/engineer");
      assert.equal(prof.bio, "Simulations Lead");

      mockApiCall("put", { username: "engineer", bio: "Updated Bio" });
      const updated = await updateUserProfile({ bio: "Updated Bio" });
      assert.equal(lastRequest?.url, "/users/me");
      assert.deepEqual(lastRequest?.data, { bio: "Updated Bio" });
      assert.equal(updated.bio, "Updated Bio");
    });

    it("handles user moderation (blocks and mutes)", async () => {
      mockApiCall("post", { blocked: true });
      await blockUser("spammer");
      assert.equal(lastRequest?.url, "/users/spammer/block");

      mockApiCall("delete", { unblocked: true });
      await unblockUser("spammer");
      assert.equal(lastRequest?.url, "/users/spammer/block");

      mockApiCall("post", { muted: true });
      await muteUser("noisy_bot");
      assert.equal(lastRequest?.url, "/users/noisy_bot/mute");

      mockApiCall("delete", { unmuted: true });
      await unmuteUser("noisy_bot");
      assert.equal(lastRequest?.url, "/users/noisy_bot/mute");

      mockApiCall("post", { reported: true, reportId: 55 });
      await reportUser("spammer", "Spam or automated bot abuse", "Posting phishing links");
      assert.equal(lastRequest?.url, "/users/spammer/report");
      assert.deepEqual(lastRequest?.data, {
        reason: "Spam or automated bot abuse",
        details: "Posting phishing links",
      });

      mockApiCall("post", { report: { id: 56 } });
      await reportPost(42, "Malicious model / code payload", "Contains infinite loop", true);
      assert.equal(lastRequest?.url, "/social/posts/42/report");
      assert.deepEqual(lastRequest?.data, {
        reason: "Malicious model / code payload",
        details: "Contains infinite loop",
        forwardFederatedFlag: true,
      });

      mockApiCall("post", { success: true, reportId: 57, targetType: "package" });
      const resReport = await reportResource({
        targetType: "package",
        targetResourceId: "@malicious/ThermalPkg",
        reason: "Malicious model / code payload",
        details: "Unauthorized FFI",
      });
      assert.equal(lastRequest?.url, "/social/reports");
      assert.equal(resReport.reportId, 57);

      mockApiCall("post", { success: true, appealId: 58, message: "Appeal submitted" });
      const appealRes = await submitModerationAppeal({
        reason: "False positive spam classification",
        details: "Automated CI benchmark posts",
      });
      assert.equal(lastRequest?.url, "/users/me/appeals");
      assert.equal(appealRes.appealId, 58);
    });

    it("manages posts, replies, likes, reposts, and bookmarks", async () => {
      mockApiCall("get", { posts: [{ id: 1, content: "Initial post" }] });
      const timeline = await getTimeline({ sort: "recent", limit: 10 });
      assert.equal(lastRequest?.url, "/social/timeline");
      assert.deepEqual(lastRequest?.params, { sort: "recent", limit: 10 });
      assert.equal(timeline.posts[0]!.content, "Initial post");

      mockApiCall("get", { post: { id: 1, content: "Single post" } });
      const single = await getPost(1);
      assert.equal(lastRequest?.url, "/social/posts/1");
      assert.equal(single.post.content, "Single post");

      mockApiCall("post", { post: { id: 2, content: "New post" } });
      const created = await createPost({ content: "New post" });
      assert.equal(lastRequest?.url, "/social/posts");
      assert.equal(created.post.id, 2);

      mockApiCall("post", { liked: true });
      await likePost(2);
      assert.equal(lastRequest?.url, "/social/posts/2/like");

      mockApiCall("post", { reposted: true });
      await repostPost(2);
      assert.equal(lastRequest?.url, "/social/posts/2/repost");

      mockApiCall("post", { bookmarked: true });
      await bookmarkPost(2);
      assert.equal(lastRequest?.url, "/social/posts/2/bookmark");

      mockApiCall("get", { posts: [{ id: 201, content: "Great reply" }] });
      const replies = await getPostReplies(2);
      assert.equal(lastRequest?.url, "/social/posts/2/replies");
      assert.equal(replies.posts[0]!.id, 201);

      mockApiCall("get", { notifications: [] });
      await getNotifications();
      assert.equal(lastRequest?.url, "/social/notifications");
    });
  });

  describe("Artifacts & Viewers Domain API", () => {
    it("creates, retrieves, and thumbnails artifact views and solutions", async () => {
      mockApiCall("post", { id: 77, artifact_type: "cad", title: "Flange STEP" });
      const view = await createArtifactView({
        artifact_type: "cad",
        title: "Flange STEP",
        view_config: JSON.stringify({ format: "step" }),
      });
      assert.equal(lastRequest?.url, "/social/artifact-views");
      assert.equal(view.id, 77);

      mockApiCall("get", { id: 77, title: "Flange STEP" });
      const fetched = await getArtifactView(77);
      assert.equal(lastRequest?.url, "/social/artifact-views/77");
      assert.equal(fetched.title, "Flange STEP");

      mockApiCall("put", { success: true, thumbnailUrl: "/thumb.png" });
      const thumb = await uploadArtifactThumbnail(77, "data:image/png;base64,...");
      assert.equal(lastRequest?.url, "/social/artifact-views/77/thumbnail");
      assert.equal(thumb.success, true);

      mockApiCall("get", { solutions: [{ id: 1, name: "Motor Sizing" }] });
      const userSolutions = await getUserSolutions("engineer");
      assert.equal(lastRequest?.url, "/users/engineer/solutions");
      assert.equal(userSolutions.solutions.length, 1);

      mockApiCall("get", { solution: { id: 1, slug: "motor-sizing" }, release: null });
      const sol = await getSolution("engineer", "motor-sizing");
      assert.equal(lastRequest?.url, "/solutions/engineer/motor-sizing");
      assert.equal(sol.solution.slug, "motor-sizing");

      mockApiCall("get", { solutions: [{ id: 1, name: "Motor Sizing" }] });
      const solutions = await getPublicSolutions();
      assert.equal(lastRequest?.url, "/solutions");
      assert.equal(solutions.solutions[0]!.name, "Motor Sizing");

      const iconUrl = getIconUrl("Modelica", "4.0.0", "Modelica.Electrical.Analog.Basic.Resistor");
      assert.equal(
        iconUrl,
        "/api/v1/libraries/Modelica/4.0.0/classes/Modelica.Electrical.Analog.Basic.Resistor/icon.svg",
      );
    });
  });

  describe("Governance Domain API", () => {
    it("manages digital twin proposals and audit trail", async () => {
      mockApiCall("get", { proposals: [{ id: 10, title: "Update Voltage" }] });
      const proposals = await getThreadProposals({ threadId: "thread_101" });
      assert.equal(lastRequest?.url, "/threads/proposals");
      assert.deepEqual(lastRequest?.params, { threadId: "thread_101" });
      assert.equal(proposals[0]!.id, 10);

      mockApiCall("post", { proposal: { id: 11, title: "Reconcile Resistor" } });
      await createThreadProposal({
        threadId: "thread_101",
        title: "Reconcile Resistor",
        description: "Update R to 50 Ohm",
      });
      assert.equal(lastRequest?.url, "/threads/proposals");

      mockApiCall("post", { proposal: { id: 11, status: "approved" } });
      await reviewThreadProposal(11, {
        status: "approved",
        comment: "Valid verification",
      });
      assert.equal(lastRequest?.url, "/threads/proposals/11/review");
      assert.deepEqual(lastRequest?.data, { status: "approved", comment: "Valid verification" });

      mockApiCall("get", {
        auditLogs: [{ id: 1, action: "proposal_created" }],
        verification: { valid: true, totalEntries: 1 },
      });
      const logs = await getThreadAuditLogs({ threadId: "thread_101" });
      assert.equal(lastRequest?.url, "/threads/audit-log");
      assert.deepEqual(lastRequest?.params, { threadId: "thread_101" });
      assert.equal(logs.auditLogs[0]!.action, "proposal_created");
    });
  });

  describe("Version Control (VCS) Domain API", () => {
    it("interacts with GitLab VCS endpoints", async () => {
      mockApiCall("get", { id: 101, name: "Modelica", default_branch: "main" });
      const project = await getGitlabProject("modelica/Modelica");
      assert.equal(lastRequest?.url, "/gitlab/projects/modelica%2FModelica");
      assert.equal(project.default_branch, "main");

      mockApiCall("get", [{ id: "sha_tree", name: "Electrical", type: "tree" }]);
      const tree = await getGitlabTree("modelica/Modelica", "main", "Electrical");
      assert.equal(lastRequest?.url, "/gitlab/projects/modelica%2FModelica/repository/tree");
      assert.deepEqual(lastRequest?.params, { ref: "main", path: "Electrical" });
      assert.equal(tree[0]!.type, "tree");

      mockApiCall("get", "model Resistor ... end Resistor;");
      const fileRaw = await getGitlabFileRaw("modelica/Modelica", "Electrical/Resistor.mo", "main");
      assert.equal(
        lastRequest?.url,
        "/gitlab/projects/modelica%2FModelica/repository/files/Electrical%2FResistor.mo/raw",
      );
      assert.match(fileRaw, /model Resistor/);

      mockApiCall("get", [{ id: "commit_1", title: "Add Resistor" }]);
      const commits = await getGitlabCommits("modelica/Modelica", "main");
      assert.equal(lastRequest?.url, "/gitlab/projects/modelica%2FModelica/repository/commits");
      assert.equal(commits[0]!.title, "Add Resistor");

      mockApiCall("get", [{ id: 1, status: "success" }]);
      const pipelines = await getGitlabPipelines("modelica/Modelica");
      assert.equal(lastRequest?.url, "/gitlab/projects/modelica%2FModelica/pipelines");
      assert.equal(pipelines[0]!.status, "success");

      mockApiCall("get", [{ id: 21, title: "Bug in DAE solver" }]);
      const issues = await getGitlabIssues("modelica/Modelica");
      assert.equal(lastRequest?.url, "/gitlab/projects/modelica%2FModelica/issues");
      assert.equal(issues[0]!.title, "Bug in DAE solver");

      mockApiCall("post", { id: 22, title: "Feature request" });
      const createdIssue = await createGitlabIssue(
        "modelica/Modelica",
        "Feature request",
        "Add support for Modelica 4.1",
      );
      assert.equal(lastRequest?.url, "/gitlab/projects/modelica%2FModelica/issues");
      assert.deepEqual(lastRequest?.data, {
        title: "Feature request",
        description: "Add support for Modelica 4.1",
      });
      assert.equal(createdIssue.id, 22);
    });
  });

  describe("Bots & Assistant Domain API", () => {
    it("manages bot assistants", async () => {
      mockApiCall("get", { bots: [{ id: 5, username: "dae_bot", display_name: "DAE Helper" }] });
      const bots = await getBots();
      assert.equal(lastRequest?.url, "/users/me/bots");
      assert.equal(bots.length, 1);
      assert.equal(bots[0].username, "dae_bot");

      mockApiCall("post", { bot: { id: 6, username: "cfd_bot" } });
      const created = await createBot({
        username: "cfd_bot",
        display_name: "CFD Mesh Helper",
      });
      assert.equal(lastRequest?.url, "/users/me/bots");
      assert.deepEqual(lastRequest?.data, {
        username: "cfd_bot",
        display_name: "CFD Mesh Helper",
      });
      assert.equal(created.bot.id, 6);

      mockApiCall("patch", { bot: { id: 6, display_name: "OpenFOAM Specialist" } });
      const updated = await updateBot(6, { display_name: "OpenFOAM Specialist" });
      assert.equal(lastRequest?.url, "/users/me/bots/6");
      assert.deepEqual(lastRequest?.data, { display_name: "OpenFOAM Specialist" });
      assert.equal(updated.bot.display_name, "OpenFOAM Specialist");

      mockApiCall("delete", { success: true });
      const deleted = await deleteBot(6);
      assert.equal(lastRequest?.url, "/users/me/bots/6");
      assert.equal(deleted.success, true);
    });
  });
});
