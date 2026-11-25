// SPDX-License-Identifier: AGPL-3.0-or-later

import type Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  attachSecondaryDbCloseHook,
  dropMultiDbAttachedViews as dropMultiDbAttachedViewsHelper,
  ensureOpenAlexDbFile,
  openOpenAlexDatabase,
  openPrimaryDatabase,
  openSecondaryDatabases,
  reconcileDatabaseSchema,
  resetDevDatabase,
  resolveDefaultDbDir,
  setupMultiDbAttached as setupMultiDbAttachedHelper,
  type ApiTokenRecord,
  type ClassMetadata,
  type ClassRow,
  type CollaboratorPermission,
  type ComponentMetadata,
  type ComponentRow,
  type CreditTransactionRow,
  type ExtendsRow,
  type HpcJobArtifactSummary,
  type JobRow,
  type JobStepRow,
  type ModifierRow,
  type OrgRole,
  type OrganizationMemberRecord,
  type OrganizationRecord,
  type PackageCollaboratorRecord,
  type RawAccountWarningRow,
  type RawContentFilterRow,
  type RegistryCatalogItem,
  type RegistryCatalogQueryOptions,
  type RegistryCatalogQueryResult,
  type RepoWebhookRecord,
  type ScriptTemplateRow,
  type SpaceChannelKind,
  type SpaceChannelRecord,
  type SpaceEcoApprovalRecord,
  type SpaceEcoProposalRecord,
  type SpaceIssueCommentRecord,
  type SpaceIssueRecord,
  type SpaceMemberRecord,
  type SpaceMessageRecord,
  type SpaceOwnerType,
  type SpacePageRecord,
  type SpaceRecord,
  type SpaceRole,
  type SpaceVisibility,
  type SpaceWorkflowRunRecord,
  type ThreadAuditLogEntry,
  type ThreadConflictRecord,
  type ThreadProposal,
  type TrendingTopicRow,
  type TwinAdaptationRow,
  type TwinProposalRow,
  type TwinRow,
  type UserBillingSummary,
  type WebhookDeliveryRecord,
} from "./database/init/index.js";
import {
  ActivityPubPostRepository,
  AdminRepository,
  ApiTokenRepository,
  BackupRepository,
  BillingRepository,
  BotOAuthRepository,
  DiscoveryFeedRepository,
  EmailConfigRepository,
  FederationRepository,
  InstanceAdminRepository,
  JobsRepository,
  LibraryRegistryRepository,
  ModerationSafetyRepository,
  PackageRepository,
  ReferralRepository,
  ScholarlyCitationRepository,
  SocialRepository,
  SpaceRepository,
  Sysml2Repository,
  TwinTemplateRepository,
  UserLifecycleRepository,
  UserRepository,
  type EmailConfigView,
} from "./database/repositories/index.js";
import { type PostHydrationBatchContext } from "./database/repositories/social-hydration.js";
import type {
  AccountKeyLogEntry,
  AccountSigningKey,
  AccountWarningRow,
  AdminUserSummaryRow,
  ArtifactViewRow,
  AuditLogRow,
  CanonicalEmailBlockRow,
  ContentFilterRow,
  ContentReportRow,
  DmcaNoticeRow,
  FederationRelayRow,
  InstanceRuleRow,
  IpBlockRow,
  LibraryReleaseRow,
  LinkedRepoRow,
  NotificationRow,
  PackageTransferRow,
  PostMetadata,
  PostPollView,
  PostRow,
  PostVisibility,
  ProfileField,
  PushSubscriptionRow,
  RemoteActorProfile,
  RemoteArtifactCacheRow,
  RemotePackageRow,
  RssFeedRow,
  SignedPostEvidence,
  SolutionReleaseRow,
  SolutionRow,
  StaffNoteRow,
  UserArchiveData,
  UserFederationInfo,
  UserReferralRow,
  UserRow,
  WaitlistSubmissionRow,
} from "./database/types.js";
import { SqliteMigrationRunner, allMigrations } from "./migrations/index.js";
import { AnalyticsBuffer, type BatchAnalyticsPayload } from "./services/analytics-buffer.js";
import type { ScholarlyWorkRecord } from "./services/openalex.js";
import { computeEcoBlastRadius } from "./services/spaces/eco-blast-radius-service.js";
import { computeEcoSimulationVerification } from "./services/spaces/eco-simulation-gate-service.js";
import { WebPushService } from "./services/web-push-service.js";
import { type WorkflowRunResult } from "./services/workflows/index.js";

export type {
  AdminUserSummaryRow,
  ApiTokenRecord,
  ArtifactViewRow,
  AuditLogRow,
  ClassMetadata,
  ClassRow,
  CollaboratorPermission,
  ComponentMetadata,
  ComponentRow,
  ContentReportRow,
  CreditTransactionRow,
  DmcaNoticeRow,
  ExtendsRow,
  HpcJobArtifactSummary,
  JobRow,
  JobStepRow,
  LibraryReleaseRow,
  LinkedRepoRow,
  ModifierRow,
  NotificationRow,
  OrgRole,
  OrganizationMemberRecord,
  OrganizationRecord,
  PackageCollaboratorRecord,
  PackageTransferRow,
  PostMetadata,
  PostRow,
  RawAccountWarningRow,
  RawContentFilterRow,
  RegistryCatalogItem,
  RegistryCatalogQueryOptions,
  RegistryCatalogQueryResult,
  RemoteActorProfile,
  RemotePackageRow,
  RepoWebhookRecord,
  RssFeedRow,
  ScriptTemplateRow,
  SolutionReleaseRow,
  SolutionRow,
  SpaceChannelKind,
  SpaceChannelRecord,
  SpaceEcoApprovalRecord,
  SpaceEcoProposalRecord,
  SpaceIssueCommentRecord,
  SpaceIssueRecord,
  SpaceMemberRecord,
  SpaceMessageRecord,
  SpaceOwnerType,
  SpacePageRecord,
  SpaceRecord,
  SpaceRole,
  SpaceVisibility,
  SpaceWorkflowRunRecord,
  ThreadAuditLogEntry,
  ThreadConflictRecord,
  ThreadProposal,
  TrendingTopicRow,
  TwinAdaptationRow,
  TwinProposalRow,
  TwinRow,
  UserArchiveData,
  UserBillingSummary,
  UserFederationInfo,
  UserRow,
  WebhookDeliveryRecord,
  WorkflowRunResult,
};

export function normalizeUtcTimestamp(ts?: string | number | Date | null): string {
  if (!ts) return new Date().toISOString();
  if (ts instanceof Date) return ts.toISOString();
  if (typeof ts === "number") return new Date(ts).toISOString();
  const trimmed = String(ts).trim();
  if (!trimmed) return new Date().toISOString();
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(trimmed)) {
    return trimmed.replace(" ", "T") + "Z";
  }
  return trimmed;
}

/**
 * SQLite-backed storage for Modelica class metadata.
 */
export class LibraryDatabase {
  readonly #db: Database.Database;
  readonly #dbPath: string;
  #openalexDb: Database.Database | null = null;
  readonly #openalexDbPath: string;
  readonly #auditDb: Database.Database | null = null;
  readonly #auditDbPath: string | null = null;
  readonly #analyticsDb: Database.Database | null = null;
  readonly #analyticsDbPath: string | null = null;
  readonly #isMultiDb: boolean = false;
  readonly #runner: SqliteMigrationRunner;
  readonly referrals: ReferralRepository;
  readonly users: UserRepository;
  readonly userLifecycle: UserLifecycleRepository;
  readonly botOAuth: BotOAuthRepository;
  readonly packages: PackageRepository;
  readonly billing: BillingRepository;
  readonly federation: FederationRepository;
  readonly activityPubPosts: ActivityPubPostRepository;
  readonly admin: AdminRepository;
  readonly sysml2: Sysml2Repository;
  readonly apiTokens: ApiTokenRepository;
  readonly spaces: SpaceRepository;
  readonly jobs: JobsRepository;
  readonly twinTemplates: TwinTemplateRepository;
  readonly moderationSafety: ModerationSafetyRepository;
  readonly social: SocialRepository;
  readonly discoveryFeed: DiscoveryFeedRepository;
  readonly libraryRegistry: LibraryRegistryRepository;
  readonly instanceAdmin: InstanceAdminRepository;
  readonly emailConfig: EmailConfigRepository;
  readonly scholarlyCitations: ScholarlyCitationRepository;
  readonly backups: BackupRepository;
  readonly analyticsBuffer: AnalyticsBuffer;
  #webPushService: WebPushService | null = null;

  invalidateLibraryDiscoveryCache(): void {
    this.libraryRegistry?.invalidateDiscoveryCache();
  }

  get webPushService(): WebPushService {
    if (!this.#webPushService) {
      this.#webPushService = new WebPushService(this);
    }
    return this.#webPushService;
  }

  constructor(dbDir?: string) {
    const dir = dbDir ?? resolveDefaultDbDir();
    const dbPath = dir.endsWith(".db") ? dir : path.join(dir, "modelscript.db");
    const parentDir = dir.endsWith(".db") ? path.dirname(dir) : dir;
    this.#dbPath = dbPath;

    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    this.#openalexDbPath = ensureOpenAlexDbFile(parentDir);

    this.#db = openPrimaryDatabase(dbPath, {
      onInvalidateAuditCache: () => this.instanceAdmin?.clearAuditChainCache(),
      onInvalidateSettingsCache: () => this.instanceAdmin?.clearInstanceSettingsCache(),
    });

    const isMultiDb = process.env["MSX_MULTI_DB"] !== "false";
    this.#isMultiDb = isMultiDb;

    if (isMultiDb) {
      const secondary = openSecondaryDatabases({
        parentDir,
        onInvalidateAuditCache: () => this.instanceAdmin?.clearAuditChainCache(),
      });
      this.#auditDb = secondary.auditDb;
      this.#auditDbPath = secondary.auditDbPath;
      this.#analyticsDb = secondary.analyticsDb;
      this.#analyticsDbPath = secondary.analyticsDbPath;

      attachSecondaryDbCloseHook(this.#db, () => ({
        auditDb: this.#auditDb,
        analyticsDb: this.#analyticsDb,
        openalexDb: this.#openalexDb,
      }));
    }

    this.#runner = new SqliteMigrationRunner(this.#db, dbPath, {
      onBeforeMigration: () => this.dropMultiDbAttachedViews(),
      onAfterMigration: () => this.setupMultiDbAttached(),
    });
    this.#runner.runPendingSync(allMigrations);
    this.#initialize();

    this.referrals = new ReferralRepository(this.#db, this);
    this.users = new UserRepository(this.#db, this);
    this.userLifecycle = new UserLifecycleRepository(this.#db, this);
    this.botOAuth = new BotOAuthRepository(this.#db, this);
    this.packages = new PackageRepository(this.#db, this);
    this.billing = new BillingRepository(this.#db, this);
    this.federation = new FederationRepository(this.#db, this);
    this.activityPubPosts = new ActivityPubPostRepository(this.#db, this);
    this.admin = new AdminRepository(this.#db, this);
    this.sysml2 = new Sysml2Repository(this.#db, this);
    this.apiTokens = new ApiTokenRepository(this.#db, this);
    this.spaces = new SpaceRepository(this.#db, this);
    this.jobs = new JobsRepository(this.#db, this);
    this.twinTemplates = new TwinTemplateRepository(this.#db, this);
    this.moderationSafety = new ModerationSafetyRepository(this.#db, this);
    this.social = new SocialRepository(this.#db, this);
    this.discoveryFeed = new DiscoveryFeedRepository(this.#db, this);
    this.libraryRegistry = new LibraryRegistryRepository(this.#db, this);
    this.instanceAdmin = new InstanceAdminRepository(this.#db, this);
    this.emailConfig = new EmailConfigRepository(this.#db, this);
    this.scholarlyCitations = new ScholarlyCitationRepository(this.#db, this);
    this.backups = new BackupRepository(this.#db, this);
    this.analyticsBuffer = new AnalyticsBuffer(this);
    this.syncMailerFromDatabase();
  }

  get db(): Database.Database {
    return this.#db;
  }

  transaction<T>(fn: () => T): T {
    return this.#db.transaction(fn)();
  }

  get dbPath(): string {
    return this.#dbPath;
  }

  #getOpenAlexDb(): Database.Database {
    if (!this.#openalexDb) {
      this.#openalexDb = openOpenAlexDatabase(this.#openalexDbPath);
    }
    return this.#openalexDb;
  }

  get openalexDb(): Database.Database {
    return this.#getOpenAlexDb();
  }

  get openalexDbPath(): string {
    return this.#openalexDbPath;
  }

  get auditDb(): Database.Database | null {
    return this.#auditDb;
  }

  get auditDbPath(): string | null {
    return this.#auditDbPath;
  }

  get analyticsDb(): Database.Database | null {
    return this.#analyticsDb;
  }

  get analyticsDbPath(): string | null {
    return this.#analyticsDbPath;
  }

  get isMultiDb(): boolean {
    return this.#isMultiDb;
  }

  get dbDir(): string {
    return path.dirname(this.#dbPath);
  }

  get migrationRunner(): SqliteMigrationRunner {
    return this.#runner;
  }

  clearUserTopicsCache(): void {
    this.userLifecycle.clearUserTopicsCache();
  }

  dropMultiDbAttachedViews(): void {
    dropMultiDbAttachedViewsHelper(this.#db, this.#isMultiDb);
  }

  resetDevData() {
    resetDevDatabase({
      db: this.#db,
      openalexDb: this.#openalexDb,
      auditDb: this.#auditDb,
      analyticsDb: this.#analyticsDb,
      runner: this.#runner,
      onBeforeReset: () => {
        this.analyticsBuffer?.clear();
        this.instanceAdmin.clearCaches();
        this.invalidateLibraryDiscoveryCache();
        this.userLifecycle.clearUserTopicsCache();
        this.dropMultiDbAttachedViews();
      },
      onAfterMigrations: () => {
        this.#initialize();
      },
    });
  }

  setupMultiDbAttached(): void {
    setupMultiDbAttachedHelper(this.#db, {
      isMultiDb: this.#isMultiDb,
      auditDbPath: this.#auditDbPath,
      analyticsDbPath: this.#analyticsDbPath,
    });
  }

  #initialize(): void {
    reconcileDatabaseSchema(this.#db, {
      isMultiDb: this.#isMultiDb,
      setupMultiDbAttached: () => this.setupMultiDbAttached(),
      setDistTag: (packageId, tag, version) => this.setDistTag(packageId, tag, version),
    });
  }

  // ── Delegated to ScholarlyCitationRepository (database/repositories/scholarly-citation.ts) ──

  /**
   * Synchronizes `post_citations` rows for a given post by extracting all citation URNs from its content.
   */
  syncPostCitations(postId: number | string, content: string | null | undefined): void {
    this.scholarlyCitations.syncPostCitations(postId, content);
  }

  /**
   * Upserts a `ScholarlyWorkRecord` into `openalex.db`'s `scholarly_works` (automatically indexed in FTS5)
   * and returns the hydrated record with `id`.
   */
  upsertScholarlyWork(work: ScholarlyWorkRecord): ScholarlyWorkRecord {
    return this.scholarlyCitations.upsertScholarlyWork(work);
  }

  // ── Delegated to UserLifecycleRepository (database/repositories/user-lifecycle.ts) ──

  getUserTopics(userId: number): { concept: string; is_active: boolean }[] {
    return this.userLifecycle.getUserTopics(userId);
  }

  updateUserTopic(userId: number, concept: string, isActive: boolean): void {
    this.userLifecycle.updateUserTopic(userId, concept, isActive);
  }

  deriveUserTopics(userId: number, force: boolean = false): void {
    this.userLifecycle.deriveUserTopics(userId, force);
  }

  getOrCreateRemoteUser(actorUrl: string, profileData?: RemoteActorProfile): { id: number } {
    return this.userLifecycle.getOrCreateRemoteUser(actorUrl, profileData);
  }

  updateRemoteActorProfile(actorUrl: string, profileData: RemoteActorProfile): boolean {
    return this.userLifecycle.updateRemoteActorProfile(actorUrl, profileData);
  }

  getInstanceKeys(): { publicKey: string; privateKey: string } {
    return this.userLifecycle.getInstanceKeys();
  }

  getInstanceEd25519Keys(): { publicKey: string; privateKey: string } {
    return this.userLifecycle.getInstanceEd25519Keys();
  }

  getInstanceVapidKeys(): { publicKey: string; privateKey: string } {
    return this.userLifecycle.getInstanceVapidKeys();
  }

  createUser(
    username: string,
    email: string,
    passwordHash: string | null,
    options?: {
      emailVerified?: boolean | undefined;
      initialCredits?: number | undefined;
      termsAcceptedAt?: string | undefined;
      registrationIp?: string | undefined;
      status?: string | undefined;
      accountType?: string | undefined;
    },
  ): {
    id: number;
    username: string;
    email: string;
    account_type?: string | undefined;
    email_verified?: number | undefined;
    credit_balance?: number | undefined;
    status?: string | undefined;
    token_version?: number | undefined;
  } {
    return this.userLifecycle.createUser(username, email, passwordHash, options);
  }

  verifyUserEmail(
    userId: number,
    bonusCredits = 50.0,
  ): { success: boolean; creditsGranted: number; user?: UserRow | undefined } {
    return this.userLifecycle.verifyUserEmail(userId, bonusCredits);
  }

  setUserEmailVerified(userId: number, verified: boolean): void {
    this.users.setUserEmailVerified(userId, verified);
  }

  freezeUserForDispute(userId: number, reason: string): { success: boolean; previousBalance: number } {
    return this.billing.freezeUserForDispute(userId, reason);
  }

  /**
   * GDPR Article 17: Right to Erasure / Account Anonymization
   * Redacts personal data, deletes session tokens and social links, and flags account as deleted.
   */
  anonymizeUser(userId: number): { success: boolean; actorUrl?: string | undefined } {
    return this.userLifecycle.anonymizeUser(userId);
  }

  /**
   * GDPR Article 20: Right to Data Portability
   * Returns a complete machine-readable bundle of all user profile, post, library, and billing data.
   */
  exportUserData(userId: number): Record<string, unknown> | null {
    return this.userLifecycle.exportUserData(userId);
  }

  // ── Delegated to BotOAuthRepository (database/repositories/bot-oauth.ts) ──

  createBot(
    ownerId: number,
    username: string,
    displayName: string,
    bio: string,
    avatarUrl: string,
    tokenHash: string,
    scopes: string = "social:read,social:write",
    systemPrompt: string = "",
    model: string = "gemini-1.5-flash",
    apiKey: string = "",
    endpointUrl: string = "",
  ): { id: number; username: string } {
    return this.botOAuth.createBot(
      ownerId,
      username,
      displayName,
      bio,
      avatarUrl,
      tokenHash,
      scopes,
      systemPrompt,
      model,
      apiKey,
      endpointUrl,
    );
  }

  getUserBots(ownerId: number): {
    id: number;
    username: string;
    display_name: string;
    avatar_url: string;
    bio: string;
    bot_scopes?: string | undefined;
    bot_system_prompt?: string | undefined;
    bot_model?: string | undefined;
    bot_api_key?: string | undefined;
    bot_endpoint_url?: string | undefined;
    bot_last_used_at?: string | undefined;
    created_at: string;
  }[] {
    return this.botOAuth.getUserBots(ownerId);
  }

  getBotById(botId: number): {
    id: number;
    owner_id: number;
    username: string;
    display_name: string;
    avatar_url: string;
    bio: string;
    bot_scopes: string;
    bot_system_prompt: string;
    bot_model: string;
    bot_api_key: string | null;
    bot_endpoint_url: string | null;
    bot_last_used_at: string | null;
  } | null {
    return this.botOAuth.getBotById(botId);
  }

  updateBotSettings(
    ownerId: number,
    botId: number,
    updates: {
      displayName?: string | undefined;
      bio?: string | undefined;
      avatarUrl?: string | undefined;
      scopes?: string | undefined;
      systemPrompt?: string | undefined;
      model?: string | undefined;
      apiKey?: string | undefined;
      endpointUrl?: string | undefined;
    },
  ): void {
    this.botOAuth.updateBotSettings(ownerId, botId, updates);
  }

  touchBotLastUsed(botId: number): void {
    this.botOAuth.touchBotLastUsed(botId);
  }

  deleteBot(ownerId: number, botId: number): void {
    this.botOAuth.deleteBot(ownerId, botId);
  }

  rotateBotToken(ownerId: number, botId: number, tokenHash: string): boolean {
    return this.botOAuth.rotateBotToken(ownerId, botId, tokenHash);
  }

  getUserByBotTokenHash(tokenHash: string): {
    id: number;
    owner_id: number;
    username: string;
    email: string;
    account_type: string;
    bot_scopes: string;
    status?: string | undefined;
  } | null {
    return this.botOAuth.getUserByBotTokenHash(tokenHash);
  }

  enqueueBotMention(botId: number, postId: number, authorId: number): number {
    return this.botOAuth.enqueueBotMention(botId, postId, authorId);
  }

  getPendingBotMentions(limit: number = 10): {
    id: number;
    bot_id: number;
    post_id: number;
    author_id: number;
    status: string;
    attempts: number;
    error: string | null;
    created_at: string;
  }[] {
    return this.botOAuth.getPendingBotMentions(limit);
  }

  updateBotMentionStatus(
    queueId: number,
    status: "processing" | "completed" | "failed",
    options?: { error?: string | undefined; responsePostId?: number | undefined },
  ): void {
    this.botOAuth.updateBotMentionStatus(queueId, status, options);
  }

  registerFederatedUser(
    username: string,
    email: string,
    provider: string,
    providerUserId: string,
    options?: {
      accountType?: string | undefined;
      displayName?: string | undefined;
      avatarUrl?: string | undefined;
      bio?: string | undefined;
      remoteDomain?: string | undefined;
      actorUrl?: string | undefined;
    },
  ): { id: number; username: string; email: string } {
    return this.botOAuth.registerFederatedUser(username, email, provider, providerUserId, options);
  }

  createOAuthUser(
    username: string,
    email: string,
    provider: string,
    providerUserId: string,
  ): { id: number; username: string; email: string } {
    return this.botOAuth.createOAuthUser(username, email, provider, providerUserId);
  }

  getOAuthAccount(
    provider: string,
    providerUserId: string,
  ):
    | {
        user_id: number;
        access_token?: string | undefined;
        refresh_token?: string | undefined;
        expires_at?: string | undefined;
      }
    | undefined {
    return this.botOAuth.getOAuthAccount(provider, providerUserId);
  }

  getOAuthAccountByUserId(
    userId: number,
    provider: string,
  ):
    | {
        provider_user_id: string;
        access_token?: string | undefined;
        refresh_token?: string | undefined;
        expires_at?: string | undefined;
      }
    | undefined {
    return this.botOAuth.getOAuthAccountByUserId(userId, provider);
  }

  getPublicOAuthAccounts(userId: number): { provider: string; provider_user_id: string }[] {
    return this.botOAuth.getPublicOAuthAccounts(userId);
  }

  updateOAuthTokens(
    userId: number,
    provider: string,
    accessToken: string,
    refreshToken?: string | null,
    expiresAt?: string | null,
  ): void {
    this.botOAuth.updateOAuthTokens(userId, provider, accessToken, refreshToken, expiresAt);
  }

  linkOAuthAccount(
    userId: number,
    provider: string,
    providerUserId: string,
    accessToken?: string | null,
    refreshToken?: string | null,
    expiresAt?: string | null,
  ): void {
    this.botOAuth.linkOAuthAccount(userId, provider, providerUserId, accessToken, refreshToken, expiresAt);
  }

  unlinkOAuthAccount(userId: number, provider: string): void {
    this.botOAuth.unlinkOAuthAccount(userId, provider);
  }

  getFederatedOAuthClient(
    domain: string,
  ): { domain: string; client_id: string; client_secret: string; registered_at: string } | undefined {
    return this.botOAuth.getFederatedOAuthClient(domain);
  }

  saveFederatedOAuthClient(domain: string, clientId: string, clientSecret: string): void {
    this.botOAuth.saveFederatedOAuthClient(domain, clientId, clientSecret);
  }

  getUserByEmail(email: string): UserRow | undefined {
    return this.users.getUserByEmail(email);
  }

  getUserByUsername(username: string): UserRow | undefined {
    return this.users.getUserByUsername(username);
  }

  getUserById(id: number): UserRow | undefined {
    return this.users.getUserById(id);
  }

  getUserByActorUrl(actorUrl: string): UserRow | undefined {
    return this.users.getUserByActorUrl(actorUrl);
  }

  setUserAccountType(userId: number, accountType: string): void {
    this.users.setUserAccountType(userId, accountType);
  }

  hasAdminUser(): boolean {
    return this.users.hasAdminUser();
  }

  isOpen(): boolean {
    return this.#db.open;
  }

  ensureUserRSAKeys(userId: number): { publicKey: string; privateKey: string } {
    return this.userLifecycle.ensureUserRSAKeys(userId);
  }

  getUserFederationInfo(userId: number): UserFederationInfo | undefined {
    return this.userLifecycle.getUserFederationInfo(userId);
  }

  getRemoteFollowersInboxes(authorId: number): {
    inbox_url: string;
    shared_inbox_url?: string | null | undefined;
    remote_domain?: string | null | undefined;
  }[] {
    return this.userLifecycle.getRemoteFollowersInboxes(authorId);
  }

  getTotalUsersCount(): number {
    return this.users.getTotalUsersCount();
  }

  getAllUsers(): {
    id: number;
    username: string;
    email: string;
    display_name?: string | undefined;
    account_type: string;
    status: string;
    created_at: string;
    branch_tip_oid?: string | null | undefined;
  }[] {
    return this.userLifecycle.getAllUsers();
  }

  getTotalPostsCount(): number {
    return this.userLifecycle.getTotalPostsCount();
  }

  setUserCreditBalance(userId: number, balance: number): void {
    this.billing.setUserCreditBalance(userId, balance);
  }

  getFullProfileByUsername(username: string): UserRow | undefined {
    return this.userLifecycle.getFullProfileByUsername(username);
  }

  updateProfile(
    userId: number,
    profile: {
      display_name?: string | undefined;
      bio?: string | undefined;
      location?: string | undefined;
      website?: string | undefined;
      avatar_url?: string | undefined;
      banner_url?: string | undefined;
      discoverable?: boolean | number | undefined;
      indexable?: boolean | number | undefined;
      locked?: boolean | number | undefined;
      also_known_as?: string | string[] | undefined;
      moved_to_actor_url?: string | null | undefined;
      profile_fields?: string | ProfileField[] | undefined;
      default_post_visibility?: PostVisibility | string | undefined;
    },
  ): void {
    this.userLifecycle.updateProfile(userId, profile);
  }

  updateAccount(
    userId: number,
    usernameOrUpdates: string | { username?: string; email?: string },
    maybeEmail?: string,
  ): void {
    this.userLifecycle.updateAccount(userId, usernameOrUpdates, maybeEmail);
  }

  recordUsernameChange(userId: number, oldUsername: string, newUsername: string): void {
    this.userLifecycle.recordUsernameChange(userId, oldUsername, newUsername);
  }

  getUsernameChanges(userId: number): {
    count: number;
    lastChangedAt: string | null;
    history: { oldUsername: string; newUsername: string; changedAt: string }[];
  } {
    return this.userLifecycle.getUsernameChanges(userId);
  }

  recordUserLocationRequest(
    userId: number,
    countryCode: string,
    regionCode?: string | null,
    thresholdN: number = 5,
  ): { changed: boolean; confirmedCountry: string | null; confirmedCountryCode: string | null } {
    return this.userLifecycle.recordUserLocationRequest(userId, countryCode, regionCode, thresholdN);
  }

  getUserAccountLocation(userId: number): {
    countryCode: string | null;
    countryName: string | null;
    regionCode: string | null;
    updatedAt: string | null;
  } | null {
    return this.userLifecycle.getUserAccountLocation(userId);
  }

  updatePassword(userId: number, passwordHash: string) {
    this.users.updatePassword(userId, passwordHash);
  }

  incrementTokenVersion(userId: number): number {
    return this.users.incrementTokenVersion(userId);
  }

  getPasswordHash(userId: number): string | undefined {
    return this.users.getPasswordHash(userId);
  }

  setPendingTotpSecret(userId: number, secret: string, expiresAt: number): void {
    this.users.setPendingTotpSecret(userId, secret, expiresAt);
  }

  getPendingTotpSecret(userId: number): string | undefined {
    return this.users.getPendingTotpSecret(userId);
  }

  deletePendingTotpSecret(userId: number): void {
    this.users.deletePendingTotpSecret(userId);
  }

  enableUser2FA(userId: number, secret: string, hashedBackupCodes: string[]): void {
    this.users.enableUser2FA(userId, secret, hashedBackupCodes);
  }

  disableUser2FA(userId: number): void {
    this.users.disableUser2FA(userId);
  }

  setUserBackupCodes(userId: number, hashedBackupCodes: string[]): void {
    this.users.setUserBackupCodes(userId, hashedBackupCodes);
  }

  getRemainingBackupCodeCount(userId: number): number {
    return this.users.getRemainingBackupCodeCount(userId);
  }

  getUser2FAState(userId: number):
    | {
        totp_enabled: number;
        totp_secret: string | null;
        backup_codes: string[];
      }
    | undefined {
    return this.users.getUser2FAState(userId);
  }

  consumeBackupCode(userId: number, codeHash: string): boolean {
    return this.users.consumeBackupCode(userId, codeHash);
  }

  getNotificationSettings(userId: number): string | undefined {
    return this.users.getNotificationSettings(userId);
  }

  updateNotificationSettings(userId: number, settings: string) {
    this.users.updateNotificationSettings(userId, settings);
  }

  followUser(followerId: number, followingId: number, state: "pending" | "accepted" = "accepted"): void {
    this.userLifecycle.followUser(followerId, followingId, state);
  }

  unfollowUser(followerId: number, followingId: number): void {
    this.userLifecycle.unfollowUser(followerId, followingId);
  }

  isFollowing(followerId: number, followingId: number): boolean {
    return this.userLifecycle.isFollowing(followerId, followingId);
  }

  hasPendingFollowRequest(followerId: number, followingId: number): boolean {
    return this.userLifecycle.hasPendingFollowRequest(followerId, followingId);
  }

  getUserFollowers(userId: number, currentUserId?: number): UserRow[] {
    return this.userLifecycle.getUserFollowers(userId, currentUserId);
  }

  getUserFollowing(userId: number, currentUserId?: number): UserRow[] {
    return this.userLifecycle.getUserFollowing(userId, currentUserId);
  }

  getBlockedUsersDetailed(userId: number): {
    id: number;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
    remote_domain: string | null;
    created_at: string;
  }[] {
    return this.userLifecycle.getBlockedUsersDetailed(userId);
  }

  getMutedUsersDetailed(userId: number): {
    id: number;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
    remote_domain: string | null;
    created_at: string;
  }[] {
    return this.userLifecycle.getMutedUsersDetailed(userId);
  }

  getUserSuggestions(
    userId?: number,
    limit: number = 3,
  ): (UserRow & {
    recommendation_reason?: string | null | undefined;
    mutual_followers_count?: number | undefined;
    shared_topics_count?: number | undefined;
  })[] {
    return this.userLifecycle.getUserSuggestions(userId, limit);
  }

  // ── Public Keys ─────────────────────────────────────────────────

  getPublicKeysForUser(userId: number): {
    id: number;
    key_id_string: string;
    public_key_pem: string;
    device_name: string | null;
    created_at: string;
    is_active: number;
  }[] {
    return this.userLifecycle.getPublicKeysForUser(userId);
  }

  addPublicKeyForUser(userId: number, keyIdString: string, publicKeyPem: string, deviceName?: string): { id: number } {
    return this.userLifecycle.addPublicKeyForUser(userId, keyIdString, publicKeyPem, deviceName);
  }

  revokePublicKey(userId: number, keyId: number): void {
    this.userLifecycle.revokePublicKey(userId, keyId);
  }
  // ── Delegated to SocialRepository (database/repositories/social.ts) ──

  createPost(
    authorId: number,
    content: string | null,
    artifactViewId?: number | string,
    replyToId?: number | string,
    quotePostId?: number | string,
    repostOfId?: number | string,
    apId?: string,
    url?: string,
    createdAt?: string,
    updatedAt?: string,
    metadata?: PostMetadata | string | null,
    replyVisibility?: string,
    isSilenced?: boolean | number,
    isSensitiveOrVisibility?: boolean | number | PostVisibility | string,
    contentWarning?: string | null,
    visibility?: PostVisibility | string,
    explicitId?: number | string,
  ): {
    id: number;
    id_str?: string;
    visibility: PostVisibility;
    autoFiltered?: boolean;
    autoFilterAction?: string;
    is_sensitive?: number;
    content_warning?: string | null;
  } {
    return this.social.createPost(
      authorId,
      content,
      artifactViewId,
      replyToId,
      quotePostId,
      repostOfId,
      apId,
      url,
      createdAt,
      updatedAt,
      metadata,
      replyVisibility,
      isSilenced,
      isSensitiveOrVisibility,
      contentWarning,
      visibility,
      explicitId,
    );
  }

  updatePostArtifactViewId(postId: number | string, artifactViewId: number | string) {
    return this.social.updatePostArtifactViewId(postId, artifactViewId);
  }

  updatePost(
    postId: number | string,
    updates: {
      content?: string | null | undefined;
      artifactViewId?: number | string | null | undefined;
      metadata?: PostMetadata | string | null | undefined;
      replyVisibility?: string | undefined;
      contentWarning?: string | null | undefined;
    },
  ): void {
    return this.social.updatePost(postId, updates);
  }

  flushAnalyticsBatch(batch: BatchAnalyticsPayload): void {
    return this.social.flushAnalyticsBatch(batch);
  }

  incrementPostView(postId: number | string, countryCode?: string, regionCode?: string) {
    return this.social.incrementPostView(postId, countryCode, regionCode);
  }

  getPostLocationStats(postId: number | string): { country: string; views: number }[] {
    return this.social.getPostLocationStats(postId);
  }

  getPostRegionStats(postId: number | string): { country: string; region: string; views: number }[] {
    return this.social.getPostRegionStats(postId);
  }

  recordPageView(params: {
    surface: "web" | "docs";
    path: string;
    isUniqueVisitor?: boolean | undefined;
    countryCode?: string | undefined;
    regionCode?: string | undefined;
    date?: string | undefined;
  }): void {
    return this.social.recordPageView(params);
  }

  getPageAnalyticsSummary(
    days = 30,
    surface?: "web" | "docs",
  ): {
    totalViews: number;
    uniqueVisitors: number;
    webViews: number;
    docsViews: number;
    postViewsTotal: number;
    packageDownloadsTotal: number;
    daily: { date: string; views: number; uniqueVisitors: number; webViews: number; docsViews: number }[];
    topPages: { surface: "web" | "docs"; path: string; views: number; uniqueVisitors: number }[];
    locationStats: { country: string; views: number }[];
    regionStats: { country: string; region: string; views: number }[];
  } {
    return this.social.getPageAnalyticsSummary(days, surface);
  }

  prunePageAnalytics(retainDays: number): {
    deletedDailyRows: number;
    deletedLocationRows: number;
    cutoffDate: string;
  } {
    return this.social.prunePageAnalytics(retainDays);
  }

  hydratePost(
    p: (Omit<PostRow, "metadata"> & { metadata?: PostMetadata | string | null | undefined }) | null | undefined,
    currentUserId?: number,
    depth: number = 0,
    preloaded?: PostHydrationBatchContext,
  ): PostRow | null {
    return this.social.hydratePost(p, currentUserId, depth, preloaded);
  }

  hydratePostsBatch(
    rows: (Omit<PostRow, "metadata"> & { metadata?: PostMetadata | string | null | undefined })[],
    currentUserId?: number,
    depth: number = 0,
  ): PostRow[] {
    return this.social.hydratePostsBatch(rows, currentUserId, depth);
  }

  getPost(id: number | string, currentUserId?: number, depth: number = 0): PostRow | null {
    return this.social.getPost(id, currentUserId, depth);
  }

  getReplies(postId: number | string, currentUserId?: number, limit: number = 50): PostRow[] {
    return this.social.getReplies(postId, currentUserId, limit);
  }

  getQuotes(postId: number | string, currentUserId?: number, limit: number = 50): PostRow[] {
    return this.social.getQuotes(postId, currentUserId, limit);
  }

  getReposts(postId: number | string, currentUserId?: number, limit: number = 50): PostRow[] {
    return this.social.getReposts(postId, currentUserId, limit);
  }

  getPostParents(postId: number | string, currentUserId?: number, depth: number = 5): PostRow[] {
    return this.social.getPostParents(postId, currentUserId, depth);
  }

  getHomeTimeline(
    userId: number,
    limit: number = 20,
    offset: number = 0,
    artifactType?: string,
    tag?: string,
  ): PostRow[] {
    return this.social.getHomeTimeline(userId, limit, offset, artifactType, tag);
  }

  getFollowingTimeline(
    userId: number,
    limit: number = 20,
    sort: string = "recent",
    offset: number = 0,
    artifactType?: string,
    tag?: string,
  ): PostRow[] {
    return this.social.getFollowingTimeline(userId, limit, sort, offset, artifactType, tag);
  }

  getExploreTimeline(
    currentUserId?: number,
    limit: number = 20,
    offset: number = 0,
    artifactType?: string,
    tag?: string,
    searchQuery?: string,
  ): PostRow[] {
    return this.social.getExploreTimeline(currentUserId, limit, offset, artifactType, tag, searchQuery);
  }

  getFederatedTimeline(
    currentUserId?: number,
    limit: number = 20,
    offset: number = 0,
    artifactType?: string,
    tag?: string,
  ): PostRow[] {
    return this.social.getFederatedTimeline(currentUserId, limit, offset, artifactType, tag);
  }

  getUserTimeline(username: string, currentUserId?: number, limit: number = 20, type?: string): PostRow[] {
    return this.social.getUserTimeline(username, currentUserId, limit, type);
  }

  blockUser(blockerId: number, blockedId: number): void {
    return this.social.blockUser(blockerId, blockedId);
  }

  unblockUser(blockerId: number, blockedId: number): void {
    return this.social.unblockUser(blockerId, blockedId);
  }

  isUserBlocked(blockerId: number, blockedId: number): boolean {
    return this.social.isUserBlocked(blockerId, blockedId);
  }

  muteUser(muterId: number, mutedId: number): void {
    return this.social.muteUser(muterId, mutedId);
  }

  unmuteUser(muterId: number, mutedId: number): void {
    return this.social.unmuteUser(muterId, mutedId);
  }

  isUserMuted(muterId: number, mutedId: number): boolean {
    return this.social.isUserMuted(muterId, mutedId);
  }

  toggleLike(userId: number, postId: number | string): boolean {
    return this.social.toggleLike(userId, postId);
  }

  likePost(userId: number, postId: number | string): boolean {
    return this.social.likePost(userId, postId);
  }

  unlikePost(userId: number, postId: number | string): boolean {
    return this.social.unlikePost(userId, postId);
  }

  toggleBookmark(userId: number, postId: number | string): boolean {
    return this.social.toggleBookmark(userId, postId);
  }

  toggleRepost(userId: number, postId: number | string): boolean {
    return this.social.toggleRepost(userId, postId);
  }

  getBookmarks(userId: number, limit: number = 20): PostRow[] {
    return this.social.getBookmarks(userId, limit);
  }

  createNotification(
    userId: number,
    actorId: number,
    type: string,
    postId?: number | string | null,
    metadata?: Record<string, unknown> | string | null,
  ): void {
    return this.social.createNotification(userId, actorId, type, postId, metadata);
  }

  async dispatchEmailDigests(frequencyFilter?: "daily" | "weekly"): Promise<{
    dispatchedUsers: number;
    totalItemsCompiled: number;
    results: { userId: number; username: string; email: string; frequency: "daily" | "weekly"; itemCount: number }[];
  }> {
    return this.social.dispatchEmailDigests(frequencyFilter);
  }

  getNotifications(userId: number, limit: number = 20, category?: string): NotificationRow[] {
    return this.social.getNotifications(userId, limit, category);
  }

  markNotificationsRead(userId: number, category?: string, ids?: number[]): void {
    return this.social.markNotificationsRead(userId, category, ids);
  }

  triageNotifications(
    userId: number,
    options: {
      ids?: number[] | undefined;
      category?: string | undefined;
      archived?: boolean | undefined;
      starred?: boolean | undefined;
      read?: boolean | undefined;
    },
  ): void {
    return this.social.triageNotifications(userId, options);
  }

  getUnreadNotificationCount(userId: number): number {
    return this.social.getUnreadNotificationCount(userId);
  }

  // ── Federation Domain Moderation ─────────────────────────────────

  getDomainTier(domain: string) {
    return this.federation.getDomainTier(domain);
  }

  setDomainTier(
    domain: string,
    tier: "allow" | "silence" | "suspend",
    reason?: string,
    options?: {
      rejectMedia?: boolean | undefined;
      rejectReports?: boolean | undefined;
      obfuscate?: boolean | undefined;
      publicComment?: string | null | undefined;
      privateComment?: string | null | undefined;
    },
  ): void {
    this.federation.setDomainTier(domain, tier, reason, options);
  }

  deleteDomainTier(domain: string): void {
    this.federation.deleteDomainTier(domain);
  }

  listFederationDomains() {
    return this.federation.listFederationDomains();
  }

  isDomainSuspended(domain: string): boolean {
    return this.federation.isDomainSuspended(domain);
  }

  isDomainSilenced(domain: string): boolean {
    return this.federation.isDomainSilenced(domain);
  }

  isDomainAllowedForFederation(domain: string): boolean {
    return this.federation.isDomainAllowedForFederation(domain);
  }

  exportFederationDomains(format: "json" | "csv" = "json"): string {
    return this.federation.exportFederationDomains(format);
  }

  importFederationDomains(
    entries: {
      domain: string;
      tier?: "allow" | "silence" | "suspend";
      reason?: string | null | undefined;
      rejectMedia?: boolean | undefined;
      rejectReports?: boolean | undefined;
      obfuscate?: boolean | undefined;
      publicComment?: string | null | undefined;
      privateComment?: string | null | undefined;
    }[],
    mode: "merge" | "replace" = "merge",
  ): { importedCount: number } {
    return this.federation.importFederationDomains(entries, mode);
  }

  // ── Federation Delivery Queue ─────────────────────────────────────

  enqueueFederationDelivery(
    activityType: string,
    activityId: string,
    payload: Record<string, unknown>,
    targetInboxUrl: string,
    targetDomain: string,
  ): { id: number; skipped?: boolean } {
    return this.federation.enqueueFederationDelivery(activityType, activityId, payload, targetInboxUrl, targetDomain);
  }

  fetchPendingFederationDeliveries(limit: number = 25) {
    return this.federation.fetchPendingFederationDeliveries(limit);
  }

  updateFederationDeliveryStatus(
    id: number,
    status: "pending" | "processing" | "completed" | "failed",
    error?: string,
    nextRetryMs?: number,
  ): void {
    this.federation.updateFederationDeliveryStatus(id, status, error, nextRetryMs);
  }

  getFederationQueueStats() {
    return this.federation.getFederationQueueStats();
  }

  listFederationDeliveries(status?: string, domain?: string, limit: number = 50) {
    return this.federation.listFederationDeliveries(status, domain, limit);
  }

  retryFailedFederationDeliveries(domain?: string): { retriedCount: number } {
    return this.federation.retryFailedFederationDeliveries(domain);
  }

  purgeFederationDeliveries(status?: string, domain?: string): { deletedCount: number } {
    return this.federation.purgeFederationDeliveries(status, domain);
  }

  getFederationDomainHealth() {
    return this.federation.getFederationDomainHealth();
  }

  circuitBreakFederationDomain(
    domain: string,
    tier: "silence" | "suspend" = "suspend",
    reason?: string,
  ): {
    domain: string;
    tier: "silence" | "suspend";
    purgedDeliveries: number;
  } {
    return this.federation.circuitBreakFederationDomain(domain, tier, reason);
  }

  // ── Delegated to ActivityPubPostRepository (database/repositories/activitypub-post.ts) ──

  getFollowState(followerId: number, followingId: number): "pending" | "accepted" | "rejected" | null {
    return this.activityPubPosts.getFollowState(followerId, followingId);
  }

  updateFollowState(followerId: number, followingId: number, state: "pending" | "accepted" | "rejected"): void {
    this.activityPubPosts.updateFollowState(followerId, followingId, state);
  }

  getUserOutboxCount(userId: number): number {
    return this.activityPubPosts.getUserOutboxCount(userId);
  }

  getUserOutboxPosts(userId: number, limit: number = 20, offset: number = 0): PostRow[] {
    return this.activityPubPosts.getUserOutboxPosts(userId, limit, offset);
  }

  getUserFollowerActors(userId: number, limit: number = 50, offset: number = 0): string[] {
    return this.activityPubPosts.getUserFollowerActors(userId, limit, offset);
  }

  getUserFollowerActorsCount(userId: number): number {
    return this.activityPubPosts.getUserFollowerActorsCount(userId);
  }

  getUserFollowingActors(userId: number, limit: number = 50, offset: number = 0): string[] {
    return this.activityPubPosts.getUserFollowingActors(userId, limit, offset);
  }

  getUserFollowingActorsCount(userId: number): number {
    return this.activityPubPosts.getUserFollowingActorsCount(userId);
  }

  getPostByApId(apId: string): PostRow | undefined {
    return this.activityPubPosts.getPostByApId(apId);
  }

  deletePostByApId(apId: string, expectedAuthorId?: number): boolean {
    return this.activityPubPosts.deletePostByApId(apId, expectedAuthorId);
  }

  updatePostContentByApId(apId: string, content: string, expectedAuthorId?: number): boolean {
    return this.activityPubPosts.updatePostContentByApId(apId, content, expectedAuthorId);
  }

  // ── Moderation & Content Reports ─────────────────────────────────

  createContentReport(
    reporterId: number,
    data: {
      postId?: number | string | undefined;
      targetUserId?: number | undefined;
      targetType?: "post" | "user" | "package" | "repo" | "appeal" | string | undefined;
      targetResourceId?: string | undefined;
      reason: string;
      details?: string | undefined;
      ruleIds?: number[] | undefined;
      category?: string | undefined;
    },
  ): { id: number; status: string; autoQuarantined?: boolean } {
    return this.admin.createContentReport(reporterId, data);
  }

  getContentReport(reportId: number): ContentReportRow | undefined {
    return this.admin.getContentReport(reportId);
  }

  getModerationQueue(
    status?: string,
    limit: number = 50,
    offset: number = 0,
    targetType?: string,
    search?: string,
  ): ContentReportRow[] {
    return this.admin.getModerationQueue(status, limit, offset, targetType, search);
  }

  getModerationQueueCount(status?: string, targetType?: string, search?: string): number {
    return this.admin.getModerationQueueCount(status, targetType, search);
  }

  resolveContentReport(
    reportId: number,
    status: "resolved" | "dismissed",
    resolutionNotes?: string,
    actionTaken?: string,
    resolveAllForTarget?: boolean,
  ): boolean {
    return this.admin.resolveContentReport(reportId, status, resolutionNotes, actionTaken, resolveAllForTarget);
  }

  silencePost(postId: number | string, silenced: boolean = true): boolean {
    return this.activityPubPosts.silencePost(postId, silenced);
  }

  markPostSensitive(postId: number | string, isSensitive: boolean = true, contentWarning?: string | null): boolean {
    return this.activityPubPosts.markPostSensitive(postId, isSensitive, contentWarning);
  }

  deletePost(postId: number | string): { success: boolean; apId?: string | undefined; authorId?: number | undefined } {
    return this.activityPubPosts.deletePost(postId);
  }

  // ── DMCA Notices & Universal Resource Quarantine ──────────────────

  createDmcaNotice(data: {
    claimantName: string;
    claimantEmail: string;
    copyrightOwner: string;
    workDescription: string;
    infringingUrl: string;
    resourceType?: string | undefined;
    resourceId?: string | undefined;
  }): { id: number } {
    return this.admin.createDmcaNotice(data);
  }

  listDmcaNotices(status?: string): DmcaNoticeRow[] {
    return this.admin.listDmcaNotices(status);
  }

  getDmcaNotice(id: number): DmcaNoticeRow | undefined {
    return this.admin.getDmcaNotice(id);
  }

  resolveDmcaNotice(id: number, actionTaken: string, status: "resolved" | "rejected" = "resolved"): boolean {
    return this.admin.resolveDmcaNotice(id, actionTaken, status);
  }

  quarantineResource(data: {
    resourceType: string;
    resourceId: string;
    reason: string;
    dmcaNoticeId?: number | null | undefined;
    quarantinedBy?: number | null | undefined;
    counterNotice?: string | null | undefined;
    restoreAfter?: string | null | undefined;
  }): { id: number; resourceType: string; resourceId: string } {
    return this.admin.quarantineResource(data);
  }

  restoreQuarantinedResource(resourceType: string, resourceId: string): boolean {
    return this.admin.restoreQuarantinedResource(resourceType, resourceId);
  }

  isResourceQuarantined(resourceType: string, resourceId: string): boolean {
    return this.admin.isResourceQuarantined(resourceType, resourceId);
  }

  listQuarantinedResources(status?: string) {
    return this.admin.listQuarantinedResources(status);
  }

  fileDmcaCounterNotice(noticeId: number, counterNoticeText: string): { success: boolean; restoreAfter: string } {
    return this.admin.fileDmcaCounterNotice(noticeId, counterNoticeText);
  }

  // ── Admin Overview & User Governance ─────────────────────────────

  getAdminPendingCounts() {
    return this.admin.getAdminPendingCounts();
  }

  listUsersForAdmin(options?: {
    query?: string | undefined;
    status?: string | undefined;
    role?: string | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
  }): {
    users: AdminUserSummaryRow[];
    total: number;
    statusBreakdown: {
      active: number;
      frozen: number;
      suspended: number;
      admins: number;
      moderators: number;
      auditors: number;
    };
  } {
    return this.instanceAdmin.listUsersForAdmin(options);
  }

  moderateUserAccount(
    userId: number,
    options: {
      status?: "active" | "frozen" | "suspended" | "pending_verification" | undefined;
      role?: "user" | "moderator" | "auditor" | "admin" | undefined;
      revokeSessions?: boolean | undefined;
      purgePosts?: boolean | undefined;
    },
  ): {
    success: boolean;
    purgedPostCount: number;
    sessionsRevoked: boolean;
  } {
    return this.instanceAdmin.moderateUserAccount(userId, options);
  }

  adjustUserCreditsForAdmin(
    userId: number,
    deltaCredits: number,
    reason: string,
  ): {
    success: boolean;
    userId: number;
    previousBalance: number;
    newBalance: number;
  } {
    return this.instanceAdmin.adjustUserCreditsForAdmin(userId, deltaCredits, reason);
  }

  logAudit(data: {
    actorId?: number | null | undefined;
    action: string;
    resourceType: string;
    resourceId?: string | null | undefined;
    ipAddress?: string | null | undefined;
    details?: Record<string, unknown> | string | undefined;
  }): void {
    return this.instanceAdmin.logAudit(data);
  }

  verifyAuditLogChain(): {
    valid: boolean;
    totalEntries: number;
    verifiedEntries: number;
    headHash: string | null;
    brokenAtId?: number | undefined;
  } {
    return this.instanceAdmin.verifyAuditLogChain();
  }

  getAuditLogs(limit: number = 50, offset: number = 0, action?: string, resourceType?: string): AuditLogRow[] {
    return this.instanceAdmin.getAuditLogs(limit, offset, action, resourceType);
  }

  purgeExpiredLogs(retentionDays: number = 30): { deletedCount: number; redactedCount: number } {
    return this.instanceAdmin.purgeExpiredLogs(retentionDays);
  }

  getAuditLogsCount(action?: string, resourceType?: string): number {
    return this.instanceAdmin.getAuditLogsCount(action, resourceType);
  }

  getInstanceSettings(): {
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
    allowedEmailDomains: string[];
    federationMode: "open" | "allowlist" | "disabled" | "mesh" | "consortium";
    maintenanceMode: boolean;
    maintenanceLevel: "off" | "scheduled" | "read_only" | "lockdown";
    maintenanceEta: string;
    maintenanceStartedAt: string;
    announcementBanner: string;
    announcementLevel: "info" | "warning" | "critical";
    autoQuarantineReportThreshold: number;
    backupRetentionCount: number;
    autoBackupIntervalHours: number;
    autoFilterKeywords: string[];
    autoFilterAction: "cw" | "silence" | "quarantine";
    customTermsMarkdown: string;
    customPrivacyMarkdown: string;
    customCookiesMarkdown: string;
    legalPolicyMode: "append" | "override";
    legalJurisdiction: string;
    legalEffectiveDate: string;
    requireAdmin2FA: boolean;
    waitlistEnabled: boolean;
    userInvitesEnabled: boolean;
    userDefaultInviteCount: number;
    academicFastTrackEnabled: boolean;
    academicDomainPatterns: string[];
    onboardingWizardEnabled: boolean;
    ingressMode: "direct" | "cloudflare";
    cloudflareTunnelConfigured: boolean;
    cloudflareTunnelTokenMasked: string;
    authorizedFetchEnabled: boolean;
    federatedTimelinePublic: boolean;
    domainBlocksPublic: boolean;
    trendingRequiresApproval: boolean;
    remoteContentRetentionDays: number;
    remoteMediaCacheRetentionDays: number;
    autoCircuitBreakThreshold: number;
    artifactCdnHost: string;
    githubClientId: string;
    githubClientSecretConfigured: boolean;
    githubClientSecretMasked: string;
    gitlabClientId: string;
    gitlabClientSecretConfigured: boolean;
    gitlabClientSecretMasked: string;
    gitlabUrl: string;
    lockedByEnv: string[];
  } {
    return this.instanceAdmin.getInstanceSettings();
  }

  getOAuthCredentials(provider: string): {
    clientId: string;
    clientSecret: string;
    baseUrl: string;
  } {
    return this.instanceAdmin.getOAuthCredentials(provider);
  }

  getMaintenanceState(): {
    mode: "off" | "scheduled" | "read_only" | "lockdown";
    active: boolean;
    eta: string;
    startedAt: string;
    banner: string;
  } {
    return this.instanceAdmin.getMaintenanceState();
  }

  updateInstanceSettings(
    patch: Record<string, unknown>,
    actorId: number | null = null,
  ): ReturnType<LibraryDatabase["getInstanceSettings"]> {
    return this.instanceAdmin.updateInstanceSettings(patch, actorId);
  }

  // ── Delegated to EmailConfigRepository (database/repositories/email-config.ts) ──

  public syncMailerFromDatabase(): void {
    this.emailConfig.syncMailerFromDatabase();
  }

  public getEmailConfig(): EmailConfigView {
    return this.emailConfig.getEmailConfig();
  }

  public updateEmailConfig(
    patch: Record<string, unknown>,
    actorId: number | null = null,
  ): ReturnType<LibraryDatabase["getEmailConfig"]> {
    return this.emailConfig.updateEmailConfig(patch, actorId);
  }

  getPreflightChecks(): {
    allPassed: boolean;
    warningCount: number;
    checks: {
      id: string;
      label: string;
      status: "ok" | "warning" | "error";
      detail: string;
    }[];
  } {
    return this.instanceAdmin.getPreflightChecks();
  }

  exportEnvConfigSnippet(): {
    envText: string;
    envSnippet: string;
    dockerComposeSnippet: string;
    generatedAt: string;
  } {
    return this.instanceAdmin.exportEnvConfigSnippet();
  }

  isSetupCompleted(): boolean {
    return this.instanceAdmin.isSetupCompleted();
  }

  isSetupForceReopened(): boolean {
    return this.instanceAdmin.isSetupForceReopened();
  }

  resetSetupWizard(actorId: number | null = null): void {
    return this.instanceAdmin.resetSetupWizard(actorId);
  }

  markSetupCompleted(actorId: number | null = null): void {
    return this.instanceAdmin.markSetupCompleted(actorId);
  }

  isInstanceInitialized(): boolean {
    return this.instanceAdmin.isInstanceInitialized();
  }

  getSetupStatus(): {
    needsSetup: boolean;
    hasAdmin: boolean;
    setupCompleted: boolean;
    reopened: boolean;
    userCount: number;
    settings: ReturnType<LibraryDatabase["getInstanceSettings"]>;
    preflight: ReturnType<LibraryDatabase["getPreflightChecks"]>;
  } {
    return this.instanceAdmin.getSetupStatus();
  }

  createInstanceInvite(options?: {
    code?: string | undefined;
    createdBy?: number | null | undefined;
    maxUses?: number | undefined;
    initialCredits?: number | undefined;
    assignedRole?: string | undefined;
    note?: string | undefined;
    expiresInDays?: number | undefined;
  }): {
    id: number;
    code: string;
    createdBy: number | null;
    maxUses: number;
    usedCount: number;
    usesCount: number;
    initialCredits: number;
    assignedRole: string;
    note: string | null;
    expiresAt: string | null;
    revoked: boolean;
    createdAt: string;
  } {
    return this.instanceAdmin.createInstanceInvite(options);
  }

  listInstanceInvites(): {
    id: number;
    code: string;
    created_by: number | null;
    createdBy: number | null;
    creator_username: string | null;
    max_uses: number;
    maxUses: number;
    used_count: number;
    usesCount: number;
    initial_credits: number;
    assigned_role: string;
    note: string | null;
    expires_at: string | null;
    expiresAt: string | null;
    revoked_at: string | null;
    revoked: boolean;
    created_at: string;
    createdAt: string;
  }[] {
    return this.instanceAdmin.listInstanceInvites();
  }

  revokeInstanceInvite(id: number): boolean {
    return this.instanceAdmin.revokeInstanceInvite(id);
  }

  // ── User Referrals, Golden Tickets & Waitlist ──────────────

  getUserOnboardingStatus(userId: number) {
    return this.referrals.getUserOnboardingStatus(userId);
  }

  completeUserOnboarding(userId: number, persona?: string): boolean {
    return this.referrals.completeUserOnboarding(userId, persona);
  }

  recordUserReferral(
    referrerId: number,
    refereeId: number,
    inviteId: number | null = null,
    rewardAmount = 50.0,
  ): UserReferralRow {
    return this.referrals.recordUserReferral(referrerId, refereeId, inviteId, rewardAmount);
  }

  getUserReferrals(referrerId: number): UserReferralRow[] {
    return this.referrals.getUserReferrals(referrerId);
  }

  getReferralByReferee(refereeId: number): UserReferralRow | undefined {
    return this.referrals.getReferralByReferee(refereeId);
  }

  grantReferralReward(refereeId: number): boolean {
    return this.referrals.grantReferralReward(refereeId);
  }

  generateUserGoldenTicket(
    userId: number,
    note?: string,
    initialCredits = 100,
  ): ReturnType<LibraryDatabase["createInstanceInvite"]> {
    return this.referrals.generateUserGoldenTicket(userId, note, initialCredits);
  }

  getUserInvites(userId: number): ReturnType<LibraryDatabase["listInstanceInvites"]> {
    return this.referrals.getUserInvites(userId);
  }

  createWaitlistSubmission(data: {
    email: string;
    full_name?: string | null;
    organization?: string | null;
    discipline?: string | null;
    portfolio_url?: string | null;
    statement?: string | null;
    ip_address?: string | null;
  }): WaitlistSubmissionRow {
    return this.referrals.createWaitlistSubmission(data);
  }

  getWaitlistSubmissions(options?: {
    status?: "pending" | "approved" | "rejected";
    limit?: number;
    offset?: number;
  }): WaitlistSubmissionRow[] {
    return this.referrals.getWaitlistSubmissions(options);
  }

  getWaitlistSubmissionById(id: number): WaitlistSubmissionRow | undefined {
    return this.referrals.getWaitlistSubmissionById(id);
  }

  getWaitlistSubmissionByEmail(email: string): WaitlistSubmissionRow | undefined {
    return this.referrals.getWaitlistSubmissionByEmail(email);
  }

  approveWaitlistSubmission(
    id: number,
    approvedBy: number | null = null,
  ): {
    success: boolean;
    submission?: WaitlistSubmissionRow | undefined;
    inviteCode?: string | undefined;
  } {
    return this.referrals.approveWaitlistSubmission(id, approvedBy);
  }

  rejectWaitlistSubmission(id: number, approvedBy: number | null = null, reason: string | null = null): boolean {
    return this.referrals.rejectWaitlistSubmission(id, approvedBy, reason);
  }

  getSystemDiagnostics(): {
    dbSizeBytes: number;
    walSizeBytes: number;
    counts: {
      users: number;
      posts: number;
      packages: number;
      repositories: number;
      jobs: number;
      auditLogs: number;
      pendingReports: number;
      quarantinedResources: number;
    };
    backups: {
      count: number;
      totalBytes: number;
      latestAt: string | null;
    };
    jobQueue: {
      pending: number;
      running: number;
      completed: number;
      failed: number;
    };
  } {
    return this.instanceAdmin.getSystemDiagnostics();
  }

  validateAndConsumeInstanceInvite(code: string): {
    valid: boolean;
    reason?: string | undefined;
    invite?:
      | {
          id: number;
          code: string;
          initialCredits: number;
          assignedRole: string;
          createdBy?: number | null | undefined;
        }
      | undefined;
  } {
    return this.instanceAdmin.validateAndConsumeInstanceInvite(code);
  }

  getUserForensicsForAdmin(userId: number): {
    user: {
      id: number;
      username: string;
      email: string | null;
      display_name: string | null;
      account_type: string;
      status: string;
      credit_balance: number;
      total_spent: number;
      remote_domain: string | null;
      email_verified: number;
      totp_enabled: number;
      created_at: string;
    };
    recentPosts: {
      id: number;
      content: string;
      content_warning: string | null;
      visibility: string;
      created_at: string;
    }[];
    publishedPackages: {
      name: string;
      description: string | null;
      created_at: string;
    }[];
    recentTransactions: {
      id: number;
      amount: number;
      balance_after: number;
      type: string;
      description: string | null;
      created_at: string;
    }[];
    recentAuditLogs: {
      id: number;
      action: string;
      resource_type: string;
      resource_id: string | null;
      ip_address: string | null;
      created_at: string;
    }[];
    reportsAgainstUser: {
      id: number;
      reason: string;
      status: string;
      target_type: string | null;
      created_at: string;
    }[];
    warnings: AccountWarningRow[];
    accountWarnings: AccountWarningRow[];
    staffNotes: StaffNoteRow[];
  } | null {
    return this.instanceAdmin.getUserForensicsForAdmin(userId);
  }

  exportInstanceBundle(): {
    formatVersion: number;
    exportedAt: string;
    snapshot: {
      fileName: string;
      sizeBytes: number;
      sha256: string;
    };
    settings: ReturnType<LibraryDatabase["getInstanceSettings"]>;
    federationDomains: ReturnType<LibraryDatabase["listFederationDomains"]>;
    quarantinedResources: ReturnType<LibraryDatabase["listQuarantinedResources"]>;
    featureFlags: ReturnType<LibraryDatabase["getFeatureFlags"]>;
    packageCount: number;
    userCount: number;
    bundleSha256: string;
  } {
    return this.instanceAdmin.exportInstanceBundle();
  }

  importInstanceBundle(
    bundle: {
      settings?: Record<string, unknown> | undefined;
      federationDomains?:
        { domain: string; tier?: "allow" | "silence" | "suspend"; reason?: string | null }[] | undefined;
      featureFlags?:
        | { flag_key: string; is_enabled: number | boolean; allowed_roles?: string; rollout_percentage?: number }[]
        | undefined;
      quarantinedResources?: { resource_type: string; resource_id: string; reason: string }[] | undefined;
    },
    actorId: number | null = null,
  ): {
    success: boolean;
    settingsUpdated: boolean;
    importedDomains: number;
    importedFlags: number;
    importedQuarantines: number;
  } {
    return this.instanceAdmin.importInstanceBundle(bundle, actorId);
  }

  recordActivityPubMigration(data: {
    sourceActorUri: string;
    targetActorUri: string;
    alsoKnownAs?: string[] | undefined;
    actorId?: number | null | undefined;
  }): {
    activityId: string;
    type: "Move";
    actor: string;
    object: string;
    target: string;
    alsoKnownAs: string[];
    queuedDeliveries: number;
  } {
    return this.instanceAdmin.recordActivityPubMigration(data);
  }
  // ── Delegated to DiscoveryFeedRepository (database/repositories/discovery-feed.ts) ──

  createRssProfile(
    url: string,
    title: string,
    description: string,
    siteUrl: string,
    avatarUrl: string,
    customUsername?: string,
  ): number {
    return this.discoveryFeed.createRssProfile(url, title, description, siteUrl, avatarUrl, customUsername);
  }

  getRssFeedByUrl(url: string): RssFeedRow | undefined {
    return this.discoveryFeed.getRssFeedByUrl(url);
  }

  getRssFeedsToPoll(): RssFeedRow[] {
    return this.discoveryFeed.getRssFeedsToPoll();
  }

  updateRssFeedPollMetadata(
    feedId: number,
    etag: string | null,
    lastModified: string | null,
    pollIntervalMins: number,
  ): void {
    return this.discoveryFeed.updateRssFeedPollMetadata(feedId, etag, lastModified, pollIntervalMins);
  }

  subscribeToRssFeed(userId: number, rssFeedId: number): void {
    return this.discoveryFeed.subscribeToRssFeed(userId, rssFeedId);
  }

  unsubscribeFromRssFeed(userId: number, rssFeedId: number): void {
    return this.discoveryFeed.unsubscribeFromRssFeed(userId, rssFeedId);
  }

  getUserRssSubscriptions(userId: number): RssFeedRow[] {
    return this.discoveryFeed.getUserRssSubscriptions(userId);
  }

  getAllRssFeeds(): RssFeedRow[] {
    return this.discoveryFeed.getAllRssFeeds();
  }

  updateRssFeedStatus(rssFeedId: number, lastFetchedAt: string, lastGuid: string | null): void {
    return this.discoveryFeed.updateRssFeedStatus(rssFeedId, lastFetchedAt, lastGuid);
  }

  getArtifactView(id: number | string): ArtifactViewRow | undefined {
    return this.discoveryFeed.getArtifactView(id);
  }

  createArtifactView(
    creatorId: number,
    type: string,
    source_type: string,
    viewConfig: string,
    title?: string | null | undefined,
    thumbnailUrl?: string | null | undefined,
    remoteOriginUrl?: string | null | undefined,
    explicitId?: number | string | null | undefined,
  ): string {
    return this.discoveryFeed.createArtifactView(
      creatorId,
      type,
      source_type,
      viewConfig,
      title,
      thumbnailUrl,
      remoteOriginUrl,
      explicitId,
    );
  }

  listArtifactViewsByCreator(
    creatorId: number,
    viewTypes: string[],
    limit = 50,
  ): Pick<ArtifactViewRow, "id" | "view_type" | "title" | "thumbnail_url" | "created_at">[] {
    return this.discoveryFeed.listArtifactViewsByCreator(creatorId, viewTypes, limit);
  }

  getAllArtifactViews(): ArtifactViewRow[] {
    return this.discoveryFeed.getAllArtifactViews();
  }

  getArtifactViewByTitle(title: string): ArtifactViewRow | undefined {
    return this.discoveryFeed.getArtifactViewByTitle(title);
  }

  updateArtifactViewConfig(id: number | string, viewConfig: string, title?: string | null | undefined): void {
    return this.discoveryFeed.updateArtifactViewConfig(id, viewConfig, title);
  }

  updateArtifactThumbnail(id: number | string, thumbnailUrl: string, thumbnailUrlDark?: string): void {
    return this.discoveryFeed.updateArtifactThumbnail(id, thumbnailUrl, thumbnailUrlDark);
  }

  updateArtifactThumbnailsByTitle(title: string, thumbnailUrl: string, thumbnailUrlDark?: string): number {
    return this.discoveryFeed.updateArtifactThumbnailsByTitle(title, thumbnailUrl, thumbnailUrlDark);
  }

  getUserArchiveData(userId: number): UserArchiveData {
    return this.discoveryFeed.getUserArchiveData(userId);
  }

  getGitSyncMapping(
    userId: number,
    path: string,
  ): { id: number; entity_type: string; entity_id: string; content_sha?: string } | undefined {
    return this.discoveryFeed.getGitSyncMapping(userId, path);
  }

  setGitSyncMapping(userId: number, path: string, entityType: string, entityId: string, contentSha?: string): void {
    return this.discoveryFeed.setGitSyncMapping(userId, path, entityType, entityId, contentSha);
  }

  deleteGitSyncMapping(userId: number, path: string): boolean {
    return this.discoveryFeed.deleteGitSyncMapping(userId, path);
  }

  registerSigningKey(key: {
    userId: number;
    publicKeyMultibase: string;
    publicKeyOpenssh: string;
    fingerprintSha256: string;
    algo?: string;
    label?: string | null;
    trustLevel?: string;
    prevKeyId?: number | null;
    rotationProof?: string | null;
  }): AccountSigningKey {
    return this.discoveryFeed.registerSigningKey(key);
  }

  getSigningKeyById(keyId: number): AccountSigningKey | null {
    return this.discoveryFeed.getSigningKeyById(keyId);
  }

  getSigningKeyByFingerprint(fingerprint: string): AccountSigningKey | null {
    return this.discoveryFeed.getSigningKeyByFingerprint(fingerprint);
  }

  getSigningKeysForUser(userId: number, includeRevoked: boolean = false): AccountSigningKey[] {
    return this.discoveryFeed.getSigningKeysForUser(userId, includeRevoked);
  }

  revokeSigningKey(keyId: number, userId: number, reason: string = "User revoked key"): boolean {
    return this.discoveryFeed.revokeSigningKey(keyId, userId, reason);
  }

  delegateSigningKey(keyId: number, userId: number, masterKeyId: number, delegationProof: string): boolean {
    return this.discoveryFeed.delegateSigningKey(keyId, userId, masterKeyId, delegationProof);
  }

  insertKeyLogEntry(entry: {
    user_id: number;
    event: string;
    payload_json: string;
    prev_hash: string;
    entry_hash: string;
  }): AccountKeyLogEntry {
    return this.discoveryFeed.insertKeyLogEntry(entry);
  }

  getKeyLogForUser(userId: number): AccountKeyLogEntry[] {
    return this.discoveryFeed.getKeyLogForUser(userId);
  }

  recordSignedPostEvidence(evidence: {
    postId: string;
    rev?: number;
    payloadJson: string;
    proofJson: string;
    keyId?: number | null;
    commitOid?: string | null;
  }): void {
    return this.discoveryFeed.recordSignedPostEvidence(evidence);
  }

  getSignedPostEvidence(postId: string, rev?: number): SignedPostEvidence | null {
    return this.discoveryFeed.getSignedPostEvidence(postId, rev);
  }

  listSignedPostEvidence(postId: string): SignedPostEvidence[] {
    return this.discoveryFeed.listSignedPostEvidence(postId);
  }

  isSigningKeyBanned(fingerprint: string): boolean {
    return this.discoveryFeed.isSigningKeyBanned(fingerprint);
  }

  banSigningKey(fingerprint: string, reason: string): void {
    return this.discoveryFeed.banSigningKey(fingerprint, reason);
  }

  setSigningPolicyStrict(userId: number, strict: boolean): void {
    return this.discoveryFeed.setSigningPolicyStrict(userId, strict);
  }

  setSigningVerified(userId: number, verified: boolean): void {
    return this.discoveryFeed.setSigningVerified(userId, verified);
  }

  updateUserBranchTip(userId: number, tipOid: string): void {
    return this.discoveryFeed.updateUserBranchTip(userId, tipOid);
  }

  recordRemotePackage(pkg: {
    name: string;
    version: string;
    actorUrl: string;
    downloadUrl: string;
    checksum: string;
    license?: string | null | undefined;
    description?: string | null | undefined;
    metadata?: string | null | undefined;
  }): { id: number } {
    return this.discoveryFeed.recordRemotePackage(pkg);
  }

  getRemotePackage(name: string, version: string): RemotePackageRow | undefined {
    return this.discoveryFeed.getRemotePackage(name, version);
  }

  getRemotePackages(limit = 50, offset = 0): RemotePackageRow[] {
    return this.discoveryFeed.getRemotePackages(limit, offset);
  }

  deleteRemotePackage(name: string, version: string, actorUrl?: string): void {
    return this.discoveryFeed.deleteRemotePackage(name, version, actorUrl);
  }

  updateTopicScore(
    concept: string,
    displayName: string,
    weight: number,
    halfLifeHours: number = 24,
    location: string | null = null,
  ): number {
    return this.discoveryFeed.updateTopicScore(concept, displayName, weight, halfLifeHours, location);
  }

  linkPostToTopic(postId: number | string, topicId: number): void {
    return this.discoveryFeed.linkPostToTopic(postId, topicId);
  }

  cleanupOrphanedTopics(topicIds?: number[]): void {
    return this.discoveryFeed.cleanupOrphanedTopics(topicIds);
  }

  boostPostTopics(postId: number | string, weight: number): void {
    return this.discoveryFeed.boostPostTopics(postId, weight);
  }

  syncPostTopics(postId: number | string): void {
    return this.discoveryFeed.syncPostTopics(postId);
  }

  decayTrendingTopics(halfLifeHours: number = 24): void {
    return this.discoveryFeed.decayTrendingTopics(halfLifeHours);
  }

  getTopTrendingTopics(
    limit: number = 10,
    halfLifeHours: number = 24,
    location: string | null = null,
  ): (TrendingTopicRow & { real_score: number; post_count: number; unique_authors?: number })[] {
    return this.discoveryFeed.getTopTrendingTopics(limit, halfLifeHours, location);
  }

  getRelatedTopics(
    concept: string,
    limit: number = 8,
  ): { concept: string; display_name: string; co_occurrence_count: number; post_count: number }[] {
    return this.discoveryFeed.getRelatedTopics(concept, limit);
  }

  getTopicPosts(
    concept: string,
    currentUserId?: number,
    limit = 20,
    offset = 0,
    artifactType?: string,
    sort: string = "recent",
  ): PostRow[] {
    return this.discoveryFeed.getTopicPosts(concept, currentUserId, limit, offset, artifactType, sort);
  }

  getLinkedRepos(userId: number): LinkedRepoRow[] {
    return this.discoveryFeed.getLinkedRepos(userId);
  }

  getUserRepos(userId: number): LinkedRepoRow[] {
    return this.discoveryFeed.getUserRepos(userId);
  }

  getPopularRepos(limit: number = 5): LinkedRepoRow[] {
    return this.discoveryFeed.getPopularRepos(limit);
  }

  linkRepo(
    userId: number,
    provider: string,
    externalId: string,
    repoFullName: string,
    defaultBranch?: string,
    description?: string,
    avatarUrl?: string,
  ): LinkedRepoRow | undefined {
    return this.discoveryFeed.linkRepo(
      userId,
      provider,
      externalId,
      repoFullName,
      defaultBranch,
      description,
      avatarUrl,
    );
  }

  unlinkRepo(userId: number, repoIdOrName: number | string): void {
    return this.discoveryFeed.unlinkRepo(userId, repoIdOrName);
  }

  updateLinkedRepo(
    userId: number,
    repoIdOrName: number | string,
    updates: {
      name?: string | undefined;
      repo_full_name?: string | undefined;
      visibility?: string | undefined;
      default_branch?: string | undefined;
      social_preview_url?: string | undefined;
      description?: string | undefined;
    },
  ): LinkedRepoRow | undefined {
    return this.discoveryFeed.updateLinkedRepo(userId, repoIdOrName, updates);
  }

  getLinkedRepoById(idOrSlug: number | string, preferredUserId?: number): LinkedRepoRow | undefined {
    return this.discoveryFeed.getLinkedRepoById(idOrSlug, preferredUserId);
  }

  createRepoWebhook(params: {
    repoId: number;
    provider: "github" | "gitlab" | "local" | "custom";
    secret: string;
    events?: string[] | undefined;
    autoPublish?: boolean | undefined;
    tagPattern?: string | undefined;
  }): RepoWebhookRecord {
    return this.discoveryFeed.createRepoWebhook(params);
  }

  getRepoWebhooks(repoId: number): RepoWebhookRecord[] {
    return this.discoveryFeed.getRepoWebhooks(repoId);
  }

  getRepoWebhookById(id: number): RepoWebhookRecord | null {
    return this.discoveryFeed.getRepoWebhookById(id);
  }

  deleteRepoWebhook(id: number, repoId?: number): boolean {
    return this.discoveryFeed.deleteRepoWebhook(id, repoId);
  }

  findWebhooksForRepo(
    provider: string,
    namespace: string,
    project: string,
  ): (RepoWebhookRecord & { namespace: string; project: string; user_id: number })[] {
    return this.discoveryFeed.findWebhooksForRepo(provider, namespace, project);
  }

  recordWebhookDelivery(params: {
    webhookId: number;
    eventType: string;
    payload: string;
    responseStatus?: number | undefined;
    errorMessage?: string | undefined;
  }): number {
    return this.discoveryFeed.recordWebhookDelivery(params);
  }

  createRepoBotReview(params: {
    repoId: number;
    botId: number;
    prNumber?: number | undefined;
    commitSha?: string | undefined;
    verdict: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
    summary: string;
    issuesJson?: string | undefined;
    postId?: number | undefined;
  }): { id: number } {
    return this.discoveryFeed.createRepoBotReview(params);
  }

  getRepoBotReviews(
    repoId: number,
    limit: number = 50,
  ): {
    id: number;
    repo_id: number;
    bot_id: number;
    bot_username: string;
    bot_display_name: string;
    pr_number: number | null;
    commit_sha: string | null;
    verdict: string;
    summary: string;
    issues_json: string | null;
    post_id: number | null;
    created_at: string;
  }[] {
    return this.discoveryFeed.getRepoBotReviews(repoId, limit);
  }

  getRepoBotReviewById(id: number):
    | {
        id: number;
        repo_id: number;
        bot_id: number;
        bot_username: string;
        bot_display_name: string;
        pr_number: number | null;
        commit_sha: string | null;
        verdict: string;
        summary: string;
        issues_json: string | null;
        post_id: number | null;
        created_at: string;
      }
    | undefined {
    return this.discoveryFeed.getRepoBotReviewById(id);
  }

  globalSearch(query: string, limitPerCategory: number = 3) {
    return this.discoveryFeed.globalSearch(query, limitPerCategory);
  }
  // ── Delegated to LibraryRegistryRepository (database/repositories/library-registry.ts) ──

  clearLibraryMetadata(libraryName: string, libraryVersion: string): void {
    return this.libraryRegistry.clearLibraryMetadata(libraryName, libraryVersion);
  }

  storeClassMetadata(libraryName: string, libraryVersion: string, cls: ClassMetadata): void {
    return this.libraryRegistry.storeClassMetadata(libraryName, libraryVersion, cls);
  }

  storeLibraryMetadata(libraryName: string, libraryVersion: string, classes: ClassMetadata[]): void {
    return this.libraryRegistry.storeLibraryMetadata(libraryName, libraryVersion, classes);
  }

  storeClassBatch(libraryName: string, libraryVersion: string, classes: ClassMetadata[]): void {
    return this.libraryRegistry.storeClassBatch(libraryName, libraryVersion, classes);
  }

  getClasses(
    libraryName: string,
    libraryVersion: string,
    opts?: { kind?: string | undefined; q?: string | undefined },
  ): Omit<ClassRow, "id">[] {
    return this.libraryRegistry.getClasses(libraryName, libraryVersion, opts);
  }

  queryRegistryCatalog(opts: RegistryCatalogQueryOptions): RegistryCatalogQueryResult {
    return this.libraryRegistry.queryRegistryCatalog(opts);
  }

  getClassIconHashes(libraryName: string, libraryVersion: string): Map<string, string> {
    return this.libraryRegistry.getClassIconHashes(libraryName, libraryVersion);
  }

  getPreviousVersionClassHashes(
    libraryName: string,
    excludeVersion?: string,
  ): {
    version: string;
    classes: Map<string, ClassMetadata & { iconHash: string | null; diagramHash: string | null }>;
  } | null {
    return this.libraryRegistry.getPreviousVersionClassHashes(libraryName, excludeVersion);
  }

  getClassCount(libraryName: string, libraryVersion: string): number {
    return this.libraryRegistry.getClassCount(libraryName, libraryVersion);
  }

  hasClass(libraryName: string, libraryVersion: string, className: string): boolean {
    return this.libraryRegistry.hasClass(libraryName, libraryVersion, className);
  }

  getClass(
    libraryName: string,
    libraryVersion: string,
    className: string,
  ): {
    classKind: string;
    description: string | null;
    documentation: string | null;
    iconHash: string | null;
    diagramHash: string | null;
    extends: string[];
    components: (Omit<ComponentRow, "id" | "class_id"> & { modifiers: Omit<ModifierRow, "id" | "component_id">[] })[];
  } | null {
    return this.libraryRegistry.getClass(libraryName, libraryVersion, className);
  }

  getAllClasses(
    libraryName: string,
    libraryVersion: string,
  ): {
    className: string;
    classKind: string;
    description: string | null;
    documentation: string | null;
    iconHash: string | null;
    diagramHash: string | null;
    extends: string[];
    components: {
      name: string;
      typeName: string;
      description: string | null;
      causality: string | null;
      variability: string | null;
      modifiers: { name: string; value: string | null }[];
    }[];
  }[] {
    return this.libraryRegistry.getAllClasses(libraryName, libraryVersion);
  }

  getLibraryTriples(libraryName: string, libraryVersion: string): { s: string; p: string; o: string }[] {
    return this.libraryRegistry.getLibraryTriples(libraryName, libraryVersion);
  }

  deleteLibrary(libraryName: string, libraryVersion: string): void {
    return this.libraryRegistry.deleteLibrary(libraryName, libraryVersion);
  }

  saveLibraryRelease(release: {
    libraryName: string;
    libraryVersion: string;
    contentHash: string;
    signature?: string | null | undefined;
    publishedBy?: number | null | undefined;
    oidcIssuer?: string | null | undefined;
    oidcSubject?: string | null | undefined;
    oidcRepository?: string | null | undefined;
    oidcWorkflowRef?: string | null | undefined;
    oidcRunId?: string | null | undefined;
  }): void {
    return this.libraryRegistry.saveLibraryRelease(release);
  }

  getOrCreateCiBotUser(info: { provider: string; repository: string; actor?: string | undefined }): UserRow {
    return this.libraryRegistry.getOrCreateCiBotUser(info);
  }

  getLibraryRelease(libraryName: string, libraryVersion: string): LibraryReleaseRow | null {
    return this.libraryRegistry.getLibraryRelease(libraryName, libraryVersion);
  }

  getLibraryReleases(libraryName: string): LibraryReleaseRow[] {
    return this.libraryRegistry.getLibraryReleases(libraryName);
  }

  deprecateLibraryRelease(libraryName: string, libraryVersion: string, reason: string | null): boolean {
    return this.libraryRegistry.deprecateLibraryRelease(libraryName, libraryVersion, reason);
  }

  yankLibraryRelease(libraryName: string, libraryVersion: string, reason: string | null): boolean {
    return this.libraryRegistry.yankLibraryRelease(libraryName, libraryVersion, reason);
  }

  unyankLibraryRelease(libraryName: string, libraryVersion: string): boolean {
    return this.libraryRegistry.unyankLibraryRelease(libraryName, libraryVersion);
  }

  canUserManagePackage(libraryName: string, userId: number): boolean {
    return this.libraryRegistry.canUserManagePackage(libraryName, userId);
  }

  canUserAdministerPackage(libraryName: string, userId: number): boolean {
    return this.libraryRegistry.canUserAdministerPackage(libraryName, userId);
  }

  createPackageTransfer(packageName: string, fromUserId: number, toUserId: number): number {
    return this.libraryRegistry.createPackageTransfer(packageName, fromUserId, toUserId);
  }

  acceptPackageTransfer(transferId: number, toUserId: number): boolean {
    return this.libraryRegistry.acceptPackageTransfer(transferId, toUserId);
  }

  cancelPackageTransfer(transferId: number, fromUserId: number): boolean {
    return this.libraryRegistry.cancelPackageTransfer(transferId, fromUserId);
  }

  getPendingTransfers(userId: number): PackageTransferRow[] {
    return this.libraryRegistry.getPendingTransfers(userId);
  }

  recordPackageDownload(libraryName: string, libraryVersion: string, dateStr?: string): void {
    return this.libraryRegistry.recordPackageDownload(libraryName, libraryVersion, dateStr);
  }

  getPackageStats(
    libraryName: string,
    days: number = 30,
  ): {
    totalDownloads: number;
    daily: { date: string; downloads: number }[];
    versionBreakdown: Record<string, number>;
  } {
    return this.libraryRegistry.getPackageStats(libraryName, days);
  }

  getReverseDependencies(targetPackageName: string): { name: string; version: string; description: string | null }[] {
    return this.libraryRegistry.getReverseDependencies(targetPackageName);
  }

  canUserPublishPackage(libraryName: string, userId: number): { allowed: boolean; reason?: string | undefined } {
    return this.libraryRegistry.canUserPublishPackage(libraryName, userId);
  }

  createOrganization(params: {
    slug: string;
    name: string;
    description?: string | null | undefined;
    avatarUrl?: string | null | undefined;
    createdBy: number;
  }): OrganizationRecord {
    return this.libraryRegistry.createOrganization(params);
  }

  getOrganizationBySlug(slug: string): OrganizationRecord | null {
    return this.libraryRegistry.getOrganizationBySlug(slug);
  }

  getOrganizationById(id: number): OrganizationRecord | null {
    return this.libraryRegistry.getOrganizationById(id);
  }

  updateOrganization(
    orgId: number,
    updates: {
      name?: string | undefined;
      display_name?: string | null | undefined;
      description?: string | null | undefined;
      website?: string | null | undefined;
      billing_email?: string | null | undefined;
      avatar_url?: string | null | undefined;
      banner_url?: string | null | undefined;
      location?: string | null | undefined;
      industry_preset?: string | null | undefined;
    },
  ): OrganizationRecord | null {
    return this.libraryRegistry.updateOrganization(orgId, updates);
  }

  getUserOrganizations(userId: number): (OrganizationRecord & { role: OrgRole })[] {
    return this.libraryRegistry.getUserOrganizations(userId);
  }

  getOrganizationMembers(orgId: number): OrganizationMemberRecord[] {
    return this.libraryRegistry.getOrganizationMembers(orgId);
  }

  getOrganizationMemberRole(orgId: number, userId: number): OrgRole | null {
    return this.libraryRegistry.getOrganizationMemberRole(orgId, userId);
  }

  getOrgMemberRole(orgId: number, userId: number): OrgRole | null {
    return this.libraryRegistry.getOrgMemberRole(orgId, userId);
  }

  addOrganizationMember(orgId: number, userId: number, role: OrgRole): void {
    return this.libraryRegistry.addOrganizationMember(orgId, userId, role);
  }

  removeOrganizationMember(orgId: number, userId: number): boolean {
    return this.libraryRegistry.removeOrganizationMember(orgId, userId);
  }

  addPackageCollaborator(libraryName: string, userId: number, permission: CollaboratorPermission): void {
    return this.libraryRegistry.addPackageCollaborator(libraryName, userId, permission);
  }

  removePackageCollaborator(libraryName: string, userId: number): boolean {
    return this.libraryRegistry.removePackageCollaborator(libraryName, userId);
  }

  getPackageCollaborators(libraryName: string): PackageCollaboratorRecord[] {
    return this.libraryRegistry.getPackageCollaborators(libraryName);
  }

  getPackageCollaboratorPermission(libraryName: string, userId: number): CollaboratorPermission | null {
    return this.libraryRegistry.getPackageCollaboratorPermission(libraryName, userId);
  }

  getOrCreatePackage(name: string): { id: number; created: boolean } {
    return this.libraryRegistry.getOrCreatePackage(name);
  }

  getPackage(name: string):
    | {
        id: number;
        name: string;
        description: string | null;
        readme: string | null;
        readme_filename: string | null;
        license: string | null;
        homepage: string | null;
        repository_type: string | null;
        repository_url: string | null;
        created_at: string;
        modified_at: string;
      }
    | undefined {
    return this.libraryRegistry.getPackage(name);
  }

  updatePackageMeta(
    packageId: number,
    meta: {
      description?: string | null | undefined;
      readme?: string | null | undefined;
      readme_filename?: string | null | undefined;
      license?: string | null | undefined;
      homepage?: string | null | undefined;
      repository_type?: string | null | undefined;
      repository_url?: string | null | undefined;
    },
  ): void {
    return this.libraryRegistry.updatePackageMeta(packageId, meta);
  }

  storePackageVersion(
    packageId: number,
    version: string,
    tarballPath: string,
    tarballShasum: string,
    tarballIntegrity: string | null,
    tarballSize: number,
    manifest: string,
    modelscriptMeta: string | null,
    publishedBy: number | null,
  ): number {
    return this.libraryRegistry.storePackageVersion(
      packageId,
      version,
      tarballPath,
      tarballShasum,
      tarballIntegrity,
      tarballSize,
      manifest,
      modelscriptMeta,
      publishedBy,
    );
  }

  updatePackageVersionManifest(versionId: number, manifest: string): void {
    return this.libraryRegistry.updatePackageVersionManifest(versionId, manifest);
  }

  getPackageVersion(
    packageId: number,
    version: string,
  ):
    | {
        id: number;
        version: string;
        tarball_path: string;
        tarball_shasum: string;
        tarball_integrity: string | null;
        tarball_size: number;
        manifest: string;
        modelscript_meta: string | null;
        published_at: string;
      }
    | undefined {
    return this.libraryRegistry.getPackageVersion(packageId, version);
  }

  getPackageVersions(packageId: number): {
    id: number;
    version: string;
    tarball_path: string;
    tarball_shasum: string;
    tarball_integrity: string | null;
    tarball_size: number;
    manifest: string;
    modelscript_meta: string | null;
    published_at: string;
  }[] {
    return this.libraryRegistry.getPackageVersions(packageId);
  }

  setDistTag(packageId: number, tag: string, version: string): void {
    return this.libraryRegistry.setDistTag(packageId, tag, version);
  }

  getDistTags(packageId: number): Record<string, string> {
    return this.libraryRegistry.getDistTags(packageId);
  }

  storeArtifact(versionId: number, type: string, artifactPath: string, metadata: string | null): number {
    return this.libraryRegistry.storeArtifact(versionId, type, artifactPath, metadata);
  }

  getArtifacts(versionId: number): { id: number; type: string; path: string; metadata: string | null }[] {
    return this.libraryRegistry.getArtifacts(versionId);
  }

  buildPackument(name: string, registryUrl: string): Record<string, unknown> | null {
    return this.libraryRegistry.buildPackument(name, registryUrl);
  }

  searchPackages(
    text: string,
    size = 20,
    from = 0,
  ): {
    objects: {
      package: {
        name: string;
        version: string;
        description: string | null;
        date: string;
      };
    }[];
    total: number;
  } {
    return this.libraryRegistry.searchPackages(text, size, from);
  }

  listPackages(query?: string): {
    name: string;
    description: string | null;
    latest_version: string | null;
    modified_at: string;
  }[] {
    return this.libraryRegistry.listPackages(query);
  }

  getLibraryDiscoverySnapshot(currentUserId?: number) {
    return this.libraryRegistry.getLibraryDiscoverySnapshot(currentUserId);
  }

  deletePackageVersion(name: string, version: string): boolean {
    return this.libraryRegistry.deletePackageVersion(name, version);
  }

  getCachedCadGeometry(url: string): string | undefined {
    return this.libraryRegistry.getCachedCadGeometry(url);
  }

  setCachedCadGeometry(url: string, geometryJson: string): void {
    return this.libraryRegistry.setCachedCadGeometry(url, geometryJson);
  }

  createJob(
    name: string,
    status: string,
    type: string,
    triggerSource: string | null = null,
    repositoryId: number | null = null,
    metadata: Record<string, unknown> | null = null,
    userId: number | null = null,
  ): number {
    return this.libraryRegistry.createJob(name, status, type, triggerSource, repositoryId, metadata, userId);
  }

  getJobByMetadataKey(
    key: string,
    value: unknown,
  ): { id: number; name: string; status: string; user_id: number | null; metadata: string | null } | undefined {
    return this.libraryRegistry.getJobByMetadataKey(key, value);
  }

  updateJobStatus(jobId: number, status: string): void {
    return this.libraryRegistry.updateJobStatus(jobId, status);
  }

  updateJobAccounting(
    jobId: number,
    accounting: {
      computeProfile?: string | undefined;
      cpuSeconds?: number | undefined;
      peakMemoryMb?: number | undefined;
      gpuSeconds?: number | undefined;
      costCredits?: number | undefined;
    },
  ): void {
    return this.libraryRegistry.updateJobAccounting(jobId, accounting);
  }

  completeJobWithBilling(
    jobId: number,
    usage: {
      computeProfile?: string | undefined;
      cpuSeconds?: number | undefined;
      peakMemoryMb?: number | undefined;
      gpuSeconds?: number | undefined;
      costCredits?: number | undefined;
    },
    userId?: number | null,
    description?: string,
    metadata?: Record<string, unknown>,
  ): void {
    return this.libraryRegistry.completeJobWithBilling(jobId, usage, userId, description, metadata);
  }

  // ── Credit Ledger & Billing ─────────────────────────────────────

  getUserBalance(userId: number): number {
    return this.billing.getUserBalance(userId);
  }

  deductUserCredits(
    userId: number,
    amount: number,
    jobId: number | null = null,
    description: string = "HPC Compute Charge",
    metadata?: Record<string, unknown>,
  ): {
    id?: number | undefined;
    success: boolean;
    user_id: number;
    job_id: number | null;
    amount: number;
    balance_after: number;
    transaction_type: string;
    type: string;
    description: string;
    metadata?: string | undefined;
    newBalance: number;
  } {
    return this.billing.deductUserCredits(userId, amount, jobId, description, metadata);
  }

  grantUserCredits(
    userId: number,
    amount: number,
    type: string = "top_up",
    description: string = "Credit Grant",
    metadata?: Record<string, unknown>,
  ): number {
    return this.billing.grantUserCredits(userId, amount, type, description, metadata);
  }

  hasProcessedStripeEvent(eventId?: string | null, paymentIntentId?: string | null): boolean {
    return this.billing.hasProcessedStripeEvent(eventId, paymentIntentId);
  }

  recordProcessedStripeEvent(
    eventId: string,
    paymentIntentId: string | null,
    userId: number | null,
    amountCredits: number,
  ): boolean {
    return this.billing.recordProcessedStripeEvent(eventId, paymentIntentId, userId, amountCredits);
  }

  saveAnsatzSnippet(
    payloadJson: string,
    dialect: string = "modelica",
    title?: string | null,
    creatorId?: number | null,
  ): string {
    const id = crypto.randomBytes(6).toString("hex");
    this.#db
      .prepare(
        `INSERT INTO ansatz_snippets (id, payload_json, dialect, title, creator_id)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, payloadJson, dialect, title ?? null, creatorId ?? null);
    return id;
  }

  getAnsatzSnippet(id: string):
    | {
        id: string;
        payload_json: string;
        dialect: string;
        title: string | null;
        creator_id: number | null;
        created_at: string;
      }
    | undefined {
    return this.#db
      .prepare(
        `SELECT id, payload_json, dialect, title, creator_id, created_at
         FROM ansatz_snippets WHERE id = ?`,
      )
      .get(id) as
      | {
          id: string;
          payload_json: string;
          dialect: string;
          title: string | null;
          creator_id: number | null;
          created_at: string;
        }
      | undefined;
  }

  holdUserCredits(
    userId: number,
    amount: number,
    jobId: number | null = null,
    description: string = "HPC Compute Escrow Hold",
    metadata?: Record<string, unknown>,
  ): {
    success: boolean;
    holdId?: number | undefined;
    heldAmount: number;
    newBalance: number;
    reason?: string | undefined;
  } {
    return this.billing.holdUserCredits(userId, amount, jobId, description, metadata);
  }

  settleUserEscrow(
    userId: number,
    jobId: number,
    actualCost: number,
    description: string = "HPC Compute Final Settlement",
    metadata?: Record<string, unknown>,
  ): { success: boolean; settledAmount: number; refundedAmount: number; newBalance: number } {
    return this.billing.settleUserEscrow(userId, jobId, actualCost, description, metadata);
  }

  releaseUserEscrow(
    userId: number,
    jobId: number,
    reason: string = "Job canceled / aborted",
  ): { success: boolean; refundedAmount: number; newBalance: number } {
    return this.billing.releaseUserEscrow(userId, jobId, reason);
  }

  releaseAllHeldEscrowsOnShutdown(): number {
    return this.billing.releaseAllHeldEscrowsOnShutdown();
  }

  getUserTransactions(userId: number, limit: number = 50, offset: number = 0): CreditTransactionRow[] {
    return this.billing.getUserTransactions(userId, limit, offset);
  }

  getUserTransactionCount(userId: number): number {
    return this.billing.getUserTransactionCount(userId);
  }

  getCreditTransactionById(txId: number): CreditTransactionRow | undefined {
    return this.billing.getCreditTransactionById(txId);
  }

  getOrgBalance(orgId: number): number {
    return this.billing.getOrgBalance(orgId);
  }

  grantOrgCredits(
    orgId: number,
    amount: number,
    actorUserId: number | null = null,
    description: string = "Organization Shared Wallet Top-Up",
    metadata?: Record<string, unknown>,
  ): number {
    return this.billing.grantOrgCredits(orgId, amount, actorUserId, description, metadata);
  }

  deductOrgCredits(
    orgId: number,
    amount: number,
    actorUserId: number | null = null,
    jobId: number | null = null,
    description: string = "Organization Compute Charge",
    metadata?: Record<string, unknown>,
  ): { success: boolean; newBalance: number; amount: number } {
    return this.billing.deductOrgCredits(orgId, amount, actorUserId, jobId, description, metadata);
  }

  holdOrgCredits(
    orgId: number,
    amount: number,
    actorUserId: number | null = null,
    jobId: number | null = null,
    description: string = "Organization HPC Escrow Hold",
    metadata?: Record<string, unknown>,
  ): {
    success: boolean;
    holdId?: number | undefined;
    heldAmount: number;
    newBalance: number;
    reason?: string | undefined;
  } {
    return this.billing.holdOrgCredits(orgId, amount, actorUserId, jobId, description, metadata);
  }

  settleOrgEscrow(
    orgId: number,
    jobId: number,
    actualCost: number,
    actorUserId: number | null = null,
    description: string = "Organization HPC Compute Final Settlement",
    metadata?: Record<string, unknown>,
  ): { success: boolean; settledAmount: number; refundedAmount: number; newBalance: number } {
    return this.billing.settleOrgEscrow(orgId, jobId, actualCost, actorUserId, description, metadata);
  }

  releaseOrgEscrow(
    orgId: number,
    jobId: number,
    reason: string = "Job canceled / aborted",
  ): { success: boolean; refundedAmount: number; newBalance: number } {
    return this.billing.releaseOrgEscrow(orgId, jobId, reason);
  }

  getOrgWalletSummary(orgId: number): {
    orgId: number;
    name: string;
    slug: string;
    balance: number;
    totalSpent: number;
    transactions: CreditTransactionRow[];
  } | null {
    return this.billing.getOrgWalletSummary(orgId);
  }

  async waitForPendingBackupReplications(): Promise<void> {
    return await this.backups.waitForPendingBackupReplications();
  }

  createHotBackup(customLabel?: string): {
    fileName: string;
    backupPath: string;
    sizeBytes: number;
    createdAt: string;
    sha256: string;
  } {
    return this.backups.createHotBackup(customLabel);
  }

  listBackups(): {
    fileName: string;
    backupPath: string;
    sizeBytes: number;
    createdAt: string;
    sha256: string;
  }[] {
    return this.backups.listBackups();
  }

  getBackupByFileName(fileName: string): {
    fileName: string;
    backupPath: string;
    sizeBytes: number;
    createdAt: string;
    sha256: string;
  } | null {
    return this.backups.getBackupByFileName(fileName);
  }

  deleteBackup(fileName: string): boolean {
    return this.backups.deleteBackup(fileName);
  }

  pruneBackups(keepCount: number = 7): { deletedCount: number; deletedFiles: string[] } {
    return this.backups.pruneBackups(keepCount);
  }

  restoreFromBackup(fileName: string): {
    success: boolean;
    restoredFrom: string;
    preRestoreBackup: string;
    tablesRestored: number;
  } {
    return this.backups.restoreFromBackup(fileName);
  }

  saveUploadedBackup(
    fileBuffer: Buffer,
    customLabel?: string,
    restoreImmediately?: boolean,
  ): {
    backup: {
      fileName: string;
      backupPath: string;
      sizeBytes: number;
      createdAt: string;
      sha256: string;
    };
    restoreResult?: ReturnType<LibraryDatabase["restoreFromBackup"]> | undefined;
  } {
    return this.backups.saveUploadedBackup(fileBuffer, customLabel, restoreImmediately);
  }

  getUserBillingSummary(userId: number): UserBillingSummary {
    return this.billing.getUserBillingSummary(userId);
  }

  // ── Delegated to JobsRepository (database/repositories/jobs.ts) ──

  getJob(jobId: number | string): JobRow | undefined {
    return this.jobs.getJob(jobId);
  }

  getUserCompletedHpcJobs(userId: number, limit = 20): HpcJobArtifactSummary[] {
    return this.jobs.getUserCompletedHpcJobs(userId, limit);
  }

  createArtifactViewFromJob(
    userId: number,
    jobId: number,
    options?: { colormap?: string | undefined; title?: string | undefined; activeField?: string | undefined },
  ): { artifactId: number | string; suggestedCaption: string; viewConfig: Record<string, unknown> } {
    return this.jobs.createArtifactViewFromJob(userId, jobId, options);
  }

  getJobs(limit = 50, offset = 0, userId?: number | null): JobRow[] {
    return this.jobs.getJobs(limit, offset, userId);
  }

  createJobStep(jobId: number, name: string, status: string): number {
    return this.jobs.createJobStep(jobId, name, status);
  }

  updateJobStepStatus(stepId: number, status: string): void {
    return this.jobs.updateJobStepStatus(stepId, status);
  }

  getJobSteps(jobId: number): JobStepRow[] {
    return this.jobs.getJobSteps(jobId);
  }
  // ── Delegated to TwinTemplateRepository (database/repositories/twin-template.ts) ──

  createScriptTemplate(
    name: string,
    slug: string,
    description: string,
    category: string,
    icon: string,
    config: Record<string, unknown>,
  ): number {
    return this.twinTemplates.createScriptTemplate(name, slug, description, category, icon, config);
  }

  getScriptTemplates(): ScriptTemplateRow[] {
    return this.twinTemplates.getScriptTemplates();
  }

  getScriptTemplate(id: number): ScriptTemplateRow | undefined {
    return this.twinTemplates.getScriptTemplate(id);
  }

  getScriptTemplateBySlugOrId(idOrSlug: number | string): ScriptTemplateRow | undefined {
    return this.twinTemplates.getScriptTemplateBySlugOrId(idOrSlug);
  }

  updateJobMetadata(jobId: number, patch: Record<string, unknown>): void {
    return this.twinTemplates.updateJobMetadata(jobId, patch);
  }

  getPackageStudyArtifacts(): {
    artifactId: number;
    packageName: string;
    packageVersion: string;
    path: string;
    metadata: Record<string, unknown>;
  }[] {
    return this.twinTemplates.getPackageStudyArtifacts();
  }

  searchIndexedModelsForStudy(opts?: { q?: string | undefined; limit?: number | undefined }): {
    libraryName: string;
    libraryVersion: string;
    className: string;
    classKind: string;
    description: string | null;
    components: {
      name: string;
      typeName: string;
      variability: string | null;
      causality: string | null;
      description: string | null;
      defaultValue: string | null;
    }[];
  }[] {
    return this.twinTemplates.searchIndexedModelsForStudy(opts);
  }

  createInstance(data: {
    serialNumber: string;
    packageId: number;
    version: string;
    commitSha?: string | null | undefined;
    variant?: string | null | undefined;
    birthData?: string | null | undefined;
  }): number {
    return this.twinTemplates.createInstance(data);
  }

  getInstanceBySerialNumber(serialNumber: string):
    | {
        id: number;
        serial_number: string;
        package_id: number;
        package_name: string;
        version: string;
        commit_sha: string | null;
        variant: string | null;
        birth_data: string | null;
        created_at: string;
      }
    | undefined {
    return this.twinTemplates.getInstanceBySerialNumber(serialNumber);
  }

  listInstancesForPackage(
    packageId: number,
    limit = 50,
  ): {
    id: number;
    serial_number: string;
    version: string;
    commit_sha: string | null;
    variant: string | null;
    created_at: string;
  }[] {
    return this.twinTemplates.listInstancesForPackage(packageId, limit);
  }

  listInstances(limit = 50): {
    id: number;
    serial_number: string;
    package_id: number;
    package_name: string;
    version: string;
    commit_sha: string | null;
    variant: string | null;
    created_at: string;
  }[] {
    return this.twinTemplates.listInstances(limit);
  }

  createTwin(data: {
    instanceId: number;
    name: string;
    modelicaClass: string;
    status?: string | undefined;
    healthScore?: number | undefined;
    config: string;
    currentParameters: string;
    currentWeights?: string | null | undefined;
  }): number {
    return this.twinTemplates.createTwin(data);
  }

  getTwin(id: number):
    | (TwinRow & {
        instance_serial: string;
        package_name: string;
        package_version: string;
      })
    | undefined {
    return this.twinTemplates.getTwin(id);
  }

  getTwinByInstanceId(instanceId: number): TwinRow | undefined {
    return this.twinTemplates.getTwinByInstanceId(instanceId);
  }

  listTwins(limit = 50): (TwinRow & {
    instance_serial: string;
    package_name: string;
    package_version: string;
  })[] {
    return this.twinTemplates.listTwins(limit);
  }

  updateTwinState(
    id: number,
    data: {
      status?: string | undefined;
      healthScore?: number | undefined;
      currentParameters?: string | undefined;
      currentWeights?: string | null | undefined;
      lastTelemetryAt?: string | undefined;
      lastAdaptedAt?: string | undefined;
    },
  ): void {
    return this.twinTemplates.updateTwinState(id, data);
  }

  createTwinAdaptation(data: {
    twinId: number;
    triggerReason: string;
    priorParameters: string;
    updatedParameters: string;
    residualBefore: number;
    residualAfter: number;
    iterations: number;
  }): number {
    return this.twinTemplates.createTwinAdaptation(data);
  }

  listTwinAdaptations(twinId: number, limit = 50): TwinAdaptationRow[] {
    return this.twinTemplates.listTwinAdaptations(twinId, limit);
  }

  createTwinProposal(data: {
    twinId: number;
    postId?: number | string | null | undefined;
    adaptationId: number;
  }): number {
    return this.twinTemplates.createTwinProposal(data);
  }

  getTwinProposal(id: number):
    | (TwinProposalRow & {
        twin_name: string;
        prior_parameters: string;
        updated_parameters: string;
      })
    | undefined {
    return this.twinTemplates.getTwinProposal(id);
  }

  listTwinProposals(
    twinId?: number,
    status?: string,
    limit = 50,
  ): (TwinProposalRow & {
    twin_name: string;
    prior_parameters: string;
    updated_parameters: string;
  })[] {
    return this.twinTemplates.listTwinProposals(twinId, status, limit);
  }

  reviewTwinProposal(id: number, status: "approved" | "rejected", reviewerId: number, notes?: string): boolean {
    return this.twinTemplates.reviewTwinProposal(id, status, reviewerId, notes);
  }
  // ── Delegated to Sysml2Repository (database/repositories/sysml2.ts) ──

  saveSysml2Project(project: {
    "@id": string;
    name: string;
    description?: string | undefined;
    created: string;
    defaultBranch: { "@id": string; name: string; headCommitId?: string | undefined };
  }): void {
    return this.sysml2.saveSysml2Project(project);
  }

  getSysml2Projects(): {
    "@id": string;
    "@type": "Project";
    name: string;
    description?: string | undefined;
    created: string;
    defaultBranch: { "@id": string; name: string; headCommitId?: string | undefined };
  }[] {
    return this.sysml2.getSysml2Projects();
  }

  deleteSysml2Project(projectId: string): void {
    return this.sysml2.deleteSysml2Project(projectId);
  }

  saveSysml2Branch(branch: {
    "@id": string;
    projectId: string;
    name: string;
    headCommitId?: string | undefined;
    created: string;
  }): void {
    return this.sysml2.saveSysml2Branch(branch);
  }

  getSysml2Branches(projectId: string): {
    "@id": string;
    "@type": "Branch";
    projectId: string;
    name: string;
    headCommitId?: string | undefined;
    created: string;
  }[] {
    return this.sysml2.getSysml2Branches(projectId);
  }

  deleteSysml2Branch(projectId: string, branchId: string): boolean {
    return this.sysml2.deleteSysml2Branch(projectId, branchId);
  }

  saveSysml2Tag(tag: {
    "@id": string;
    projectId: string;
    name: string;
    taggedCommit: { "@id": string };
    created: string;
  }): void {
    return this.sysml2.saveSysml2Tag(tag);
  }

  getSysml2Tags(projectId: string): {
    "@id": string;
    "@type": "Tag";
    projectId: string;
    name: string;
    taggedCommit: { "@id": string };
    created: string;
  }[] {
    return this.sysml2.getSysml2Tags(projectId);
  }

  saveSysml2Commit(commit: {
    "@id": string;
    projectId: string;
    description: string;
    created: string;
    previousCommit?: { "@id": string } | null | undefined;
    mergedCommit?: { "@id": string } | null | undefined;
  }): void {
    return this.sysml2.saveSysml2Commit(commit);
  }

  getSysml2Commits(projectId: string): {
    "@id": string;
    "@type": "Commit";
    projectId: string;
    description: string;
    created: string;
    previousCommit?: { "@id": string } | null | undefined;
    mergedCommit?: { "@id": string } | null | undefined;
  }[] {
    return this.sysml2.getSysml2Commits(projectId);
  }

  saveSysml2Elements(commitId: string, elements: Record<string, unknown>[]): void {
    return this.sysml2.saveSysml2Elements(commitId, elements);
  }

  getSysml2Elements(commitId: string): Record<string, unknown>[] {
    return this.sysml2.getSysml2Elements(commitId);
  }

  saveSysml2Relationships(commitId: string, relationships: Record<string, unknown>[]): void {
    return this.sysml2.saveSysml2Relationships(commitId, relationships);
  }

  getSysml2Relationships(commitId: string): Record<string, unknown>[] {
    return this.sysml2.getSysml2Relationships(commitId);
  }

  getFeatureFlags() {
    return this.sysml2.getFeatureFlags();
  }

  getFeatureFlag(key: string) {
    return this.sysml2.getFeatureFlag(key);
  }

  isFeatureFlagEnabled(key: string): boolean {
    return this.sysml2.isFeatureFlagEnabled(key);
  }

  setFeatureFlag(key: string, isEnabled: boolean, allowedRoles?: string, rolloutPercentage = 100): void {
    return this.sysml2.setFeatureFlag(key, isEnabled, allowedRoles, rolloutPercentage);
  }

  createThreadProposal(proposal: {
    threadId: string;
    title: string;
    description?: string | undefined;
    proposedBy: string;
    diffSummary: string | object;
    safetyStandard?: string | undefined;
  }): ThreadProposal {
    return this.sysml2.createThreadProposal(proposal);
  }

  getThreadProposalById(id: number): ThreadProposal | undefined {
    return this.sysml2.getThreadProposalById(id);
  }

  getThreadProposals(threadId?: string, status?: string): ThreadProposal[] {
    return this.sysml2.getThreadProposals(threadId, status);
  }

  reviewThreadProposal(
    id: number,
    status: "approved" | "rejected" | "applied",
    resolvedBy: string,
    comment?: string,
    safetyStandard?: string,
  ): ThreadProposal | undefined {
    return this.sysml2.reviewThreadProposal(id, status, resolvedBy, comment, safetyStandard);
  }

  logThreadAudit(entry: {
    threadId: string;
    proposalId?: number | null | undefined;
    action: string;
    actor: string;
    safetyStandard?: string | null | undefined;
    metadata?: string | object | undefined;
  }): ThreadAuditLogEntry {
    return this.sysml2.logThreadAudit(entry);
  }

  getThreadAuditLogs(threadId?: string): ThreadAuditLogEntry[] {
    return this.sysml2.getThreadAuditLogs(threadId);
  }

  verifyThreadAuditChain(threadId: string): { valid: boolean; totalEntries: number; brokenAtId?: number | undefined } {
    return this.sysml2.verifyThreadAuditChain(threadId);
  }

  saveThreadSnapshot(
    serializedJson: string,
    metadataMap?: Map<string, unknown> | Record<string, unknown>,
    workspaceId = "default",
  ): void {
    return this.sysml2.saveThreadSnapshot(serializedJson, metadataMap, workspaceId);
  }

  loadThreadSnapshot(workspaceId = "default"): {
    serializedJson: string;
    metadata: Record<string, unknown>;
    updatedAt: string;
  } | null {
    return this.sysml2.loadThreadSnapshot(workspaceId);
  }

  saveThreadConflict(conflict: {
    conflictId: string;
    workspaceId?: string | undefined;
    slot: number;
    sourceDomain: string;
    sourceValue: number;
    sourceUnit: string;
    targetDomain: string;
    targetValue: number;
    targetUnit: string;
    min: number;
    max: number;
    status?: "conflicted" | "resolved" | undefined;
    resolvedValue?: number | null | undefined;
  }): void {
    return this.sysml2.saveThreadConflict(conflict);
  }

  getThreadConflicts(workspaceId = "default", status?: string): ThreadConflictRecord[] {
    return this.sysml2.getThreadConflicts(workspaceId, status);
  }

  resolveThreadConflict(conflictId: string, resolvedValue: number): void {
    return this.sysml2.resolveThreadConflict(conflictId, resolvedValue);
  }
  // ── Delegated to ApiTokenRepository (database/repositories/api-token.ts) ──

  storeApiTokenRow(params: {
    userId: number;
    name: string;
    tokenPrefix: string;
    tokenHash: string;
    scopes: string[];
    packagePattern?: string | undefined;
    ipAllowlist?: string | null | undefined;
    expiresAt?: string | null | undefined;
  }): number {
    return this.apiTokens.storeApiTokenRow(params);
  }

  insertApiTokenRecord(params: {
    userId: number;
    name: string;
    tokenPrefix: string;
    tokenHash: string;
    scopes: string[];
    packagePattern?: string | undefined;
    ipAllowlist?: string | null | undefined;
    expiresAt?: string | null | undefined;
  }): number {
    return this.apiTokens.insertApiTokenRecord(params);
  }

  createApiKey(params: {
    userId: number;
    name: string;
    tokenPrefix: string;
    tokenHash: string;
    scopes: string[];
    packagePattern?: string | undefined;
    ipAllowlist?: string | null | undefined;
    expiresAt?: string | null | undefined;
  }): number {
    return this.apiTokens.createApiKey(params);
  }

  createApiToken(params: {
    userId: number;
    name: string;
    tokenPrefix: string;
    tokenHash: string;
    scopes: string[];
    packagePattern?: string | undefined;
    ipAllowlist?: string | null | undefined;
    expiresAt?: string | null | undefined;
  }): number {
    return this.apiTokens.createApiToken(params);
  }

  getApiTokenByHash(tokenHash: string): ApiTokenRecord | null {
    return this.apiTokens.getApiTokenByHash(tokenHash);
  }

  listApiTokens(userId: number): Omit<ApiTokenRecord, "token_hash">[] {
    return this.apiTokens.listApiTokens(userId);
  }

  deleteApiToken(tokenId: number, userId: number): boolean {
    return this.apiTokens.deleteApiToken(tokenId, userId);
  }

  touchApiToken(tokenId: number, ip?: string): void {
    return this.apiTokens.touchApiToken(tokenId, ip);
  }

  getUserSolutions(username: string): SolutionRow[] {
    return this.apiTokens.getUserSolutions(username);
  }

  getAllPublicSolutions(): SolutionRow[] {
    return this.apiTokens.getAllPublicSolutions();
  }

  getSolution(
    authorUsername: string,
    slug: string,
  ): {
    solution: SolutionRow;
    release: SolutionReleaseRow | null;
  } | null {
    return this.apiTokens.getSolution(authorUsername, slug);
  }

  getSolutionReleases(authorUsername: string, slug: string): SolutionReleaseRow[] {
    return this.apiTokens.getSolutionReleases(authorUsername, slug);
  }

  createOrUpdateSolution(
    userId: number,
    data: {
      slug: string;
      name: string;
      description?: string | undefined;
      category?: string | undefined;
      icon?: string | undefined;
      supported_formats?: string[] | undefined;
      repo_id?: number | undefined;
    },
  ): number {
    return this.apiTokens.createOrUpdateSolution(userId, data);
  }

  createSolutionRelease(
    solutionId: number,
    data: {
      version: string;
      changelog?: string | undefined;
      bundle_url: string;
      tauri_windows_url?: string | undefined;
      tauri_linux_url?: string | undefined;
      tauri_darwin_url?: string | undefined;
      manifest_json?: string | undefined;
    },
  ): number {
    return this.apiTokens.createSolutionRelease(solutionId, data);
  }
  // ── Delegated to ModerationSafetyRepository (database/repositories/moderation-safety.ts) ──

  recordDomainDeliverySuccess(domain: string): void {
    return this.moderationSafety.recordDomainDeliverySuccess(domain);
  }

  recordDomainDeliveryFailure(
    domain: string,
    errorMessage?: string,
  ): { consecutiveFailures: number; unavailableSince: string | null } {
    return this.moderationSafety.recordDomainDeliveryFailure(domain, errorMessage);
  }

  isDomainUnavailable(domain: string): boolean {
    return this.moderationSafety.isDomainUnavailable(domain);
  }

  static obfuscateDomainName(domain: string): string {
    return FederationRepository.obfuscateDomainName(domain);
  }

  listPublicDomainBlocks() {
    return this.moderationSafety.listPublicDomainBlocks();
  }

  listKnownPeers(): string[] {
    return this.moderationSafety.listKnownPeers();
  }

  listFederationRelays(): FederationRelayRow[] {
    return this.moderationSafety.listFederationRelays();
  }

  getFederationRelayById(id: number): FederationRelayRow | undefined {
    return this.moderationSafety.getFederationRelayById(id);
  }

  getFederationRelayByActor(actorUrl: string): FederationRelayRow | undefined {
    return this.moderationSafety.getFederationRelayByActor(actorUrl);
  }

  addFederationRelay(
    inboxUrl: string,
    actorUrl?: string,
    followActivityId?: string,
    state: "pending" | "accepted" | "rejected" | "paused" = "pending",
  ): FederationRelayRow {
    return this.moderationSafety.addFederationRelay(inboxUrl, actorUrl, followActivityId, state);
  }

  updateFederationRelayState(
    idOrActorUrl: number | string,
    state: "pending" | "accepted" | "rejected" | "paused",
    lastError?: string | null,
  ): FederationRelayRow | undefined {
    return this.moderationSafety.updateFederationRelayState(idOrActorUrl, state, lastError);
  }

  deleteFederationRelay(id: number): FederationRelayRow | undefined {
    return this.moderationSafety.deleteFederationRelay(id);
  }

  incrementRelayStats(idOrActorUrl: number | string, direction: "forwarded" | "received"): void {
    return this.moderationSafety.incrementRelayStats(idOrActorUrl, direction);
  }

  listInstanceRules(): InstanceRuleRow[] {
    return this.moderationSafety.listInstanceRules();
  }

  createInstanceRule(text: string, hint?: string | null, priority?: number): InstanceRuleRow {
    return this.moderationSafety.createInstanceRule(text, hint, priority);
  }

  updateInstanceRule(
    id: number,
    updates: { text?: string | undefined; hint?: string | null | undefined; priority?: number | undefined },
  ): InstanceRuleRow | undefined {
    return this.moderationSafety.updateInstanceRule(id, updates);
  }

  deleteInstanceRule(id: number): boolean {
    return this.moderationSafety.deleteInstanceRule(id);
  }

  createAccountWarning(params: {
    targetUserId: number;
    actorId?: number | null | undefined;
    moderatorId?: number | null | undefined;
    action?: AccountWarningRow["action"] | string | undefined;
    text: string;
    reportId?: number | null | undefined;
    ruleIds?: number[] | undefined;
    postIds?: number[] | undefined;
  }): AccountWarningRow {
    return this.moderationSafety.createAccountWarning(params);
  }

  listAccountWarnings(targetUserId?: number): AccountWarningRow[] {
    return this.moderationSafety.listAccountWarnings(targetUserId);
  }

  acknowledgeAccountWarning(warningId: number, userId: number): boolean {
    return this.moderationSafety.acknowledgeAccountWarning(warningId, userId);
  }

  createStaffNote(
    targetType: "user" | "domain" | "report",
    targetId: string,
    authorId: number,
    content: string,
  ): StaffNoteRow {
    return this.moderationSafety.createStaffNote(targetType, targetId, authorId, content);
  }

  listStaffNotes(targetType: "user" | "domain" | "report", targetId?: string): StaffNoteRow[] {
    return this.moderationSafety.listStaffNotes(targetType, targetId);
  }

  deleteStaffNote(noteId: number): boolean {
    return this.moderationSafety.deleteStaffNote(noteId);
  }

  listIpBlocks(): IpBlockRow[] {
    return this.moderationSafety.listIpBlocks();
  }

  createIpBlock(
    paramsOrCidr:
      | string
      | {
          cidr: string;
          severity?: IpBlockRow["severity"] | undefined;
          comment?: string | null | undefined;
          createdBy?: number | null | undefined;
          expiresAt?: string | null | undefined;
        },
    severityArg?: IpBlockRow["severity"],
    commentArg?: string | null,
    expiresAtArg?: string | null,
    createdByArg?: number | null,
  ): IpBlockRow {
    return this.moderationSafety.createIpBlock(paramsOrCidr, severityArg, commentArg, expiresAtArg, createdByArg);
  }

  deleteIpBlock(id: number): boolean {
    return this.moderationSafety.deleteIpBlock(id);
  }

  checkIpBlock(clientIp?: string | null): IpBlockRow | null {
    return this.moderationSafety.checkIpBlock(clientIp);
  }

  listCanonicalEmailBlocks(): CanonicalEmailBlockRow[] {
    return this.moderationSafety.listCanonicalEmailBlocks();
  }

  createCanonicalEmailBlock(
    emailOrHash: string,
    reason?: string | null,
    createdBy?: number | null,
  ): CanonicalEmailBlockRow {
    return this.moderationSafety.createCanonicalEmailBlock(emailOrHash, reason, createdBy);
  }

  deleteCanonicalEmailBlock(id: number): boolean {
    return this.moderationSafety.deleteCanonicalEmailBlock(id);
  }

  isCanonicalEmailBlocked(email: string): {
    blocked: boolean;
    reason?: string | undefined;
    block?: CanonicalEmailBlockRow | undefined;
  } {
    return this.moderationSafety.isCanonicalEmailBlocked(email);
  }

  listContentFilters(userId?: number | null): ContentFilterRow[] {
    return this.moderationSafety.listContentFilters(userId);
  }

  getContentFilter(id: number): ContentFilterRow | undefined {
    return this.moderationSafety.getContentFilter(id);
  }

  createContentFilter(params: {
    userId?: number | null | undefined;
    title: string;
    context?: ("home" | "public" | "notifications" | "thread" | "account")[] | string[] | undefined;
    filterAction?: "warn" | "hide" | "drop" | undefined;
    keywords: { keyword: string; whole_word?: boolean | undefined }[];
    expiresAt?: string | null | undefined;
  }): ContentFilterRow {
    return this.moderationSafety.createContentFilter(params);
  }

  updateContentFilter(
    id: number,
    userId: number | null,
    updates: {
      title?: string | undefined;
      context?: ("home" | "public" | "notifications" | "thread" | "account")[] | string[] | undefined;
      filterAction?: "warn" | "hide" | "drop" | undefined;
      keywords?: { keyword: string; whole_word?: boolean | undefined }[] | undefined;
      expiresAt?: string | null | undefined;
    },
  ): ContentFilterRow | undefined {
    return this.moderationSafety.updateContentFilter(id, userId, updates);
  }

  deleteContentFilter(id: number, userId?: number | null): boolean {
    return this.moderationSafety.deleteContentFilter(id, userId);
  }

  applyContentFiltersToPosts(
    posts: PostRow[],
    context: "home" | "public" | "notifications" | "thread" | "account",
    currentUserId?: number,
  ): PostRow[] {
    return this.moderationSafety.applyContentFiltersToPosts(posts, context, currentUserId);
  }

  createPostPoll(
    postId: number | string,
    options: (string | { title: string; votes_count?: number })[],
    expiresAt?: string | null,
    multiple: boolean = false,
  ): PostPollView {
    return this.moderationSafety.createPostPoll(postId, options, expiresAt, multiple);
  }

  getPostPoll(postId: number | string, currentUserId?: number): PostPollView | null {
    return this.moderationSafety.getPostPoll(postId, currentUserId);
  }

  votePostPoll(
    postId: number | string,
    choices: number[],
    voterUserId?: number | null,
    voterActorUrl?: string | null,
  ): PostPollView {
    return this.moderationSafety.votePostPoll(postId, choices, voterUserId, voterActorUrl);
  }

  getPendingFollowRequests(userId: number): {
    id: number;
    follower_id: number;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
    bio: string | null;
    actor_url: string | null;
    inbox_url: string | null;
    created_at: string;
  }[] {
    return this.moderationSafety.getPendingFollowRequests(userId);
  }

  acceptFollowRequest(followingId: number, followerId: number): boolean {
    return this.moderationSafety.acceptFollowRequest(followingId, followerId);
  }

  rejectFollowRequest(followingId: number, followerId: number): boolean {
    return this.moderationSafety.rejectFollowRequest(followingId, followerId);
  }

  rotateUserKeys(userId: number): { publicKey: string } {
    return this.moderationSafety.rotateUserKeys(userId);
  }

  setUserAliases(userId: number, alsoKnownAs: string[]): string[] {
    return this.moderationSafety.setUserAliases(userId, alsoKnownAs);
  }

  initiateLocalUserMove(
    userId: number,
    targetActorUrl: string,
  ): { movedToActorUrl: string; migratedLocalFollowers: number } {
    return this.moderationSafety.initiateLocalUserMove(userId, targetActorUrl);
  }

  executeInboundActorMove(
    sourceActorUrl: string,
    targetActorUrl: string,
    targetAlsoKnownAs: string[],
    targetProfile?: {
      username?: string | undefined;
      displayName?: string | undefined;
      inboxUrl?: string | undefined;
      sharedInboxUrl?: string | undefined;
      publicKey?: string | undefined;
    },
  ): { success: boolean; reason?: string | undefined; migratedFollowers: number } {
    return this.moderationSafety.executeInboundActorMove(
      sourceActorUrl,
      targetActorUrl,
      targetAlsoKnownAs,
      targetProfile,
    );
  }

  exportUserSocialGraph(userId: number): {
    following: string[];
    followers: string[];
    blocks: string[];
    mutes: string[];
    bookmarks: number[];
    followingCsv: string;
    blocksCsv: string;
    mutesCsv: string;
  } {
    return this.moderationSafety.exportUserSocialGraph(userId);
  }

  importUserSocialGraph(
    userId: number,
    data: {
      following?: string[] | undefined;
      blocks?: string[] | undefined;
      mutes?: string[] | undefined;
      mode?: "merge" | "replace" | "overwrite" | undefined;
    },
    modeArg: "merge" | "replace" | "overwrite" = "merge",
  ): {
    importedFollowing: number;
    importedBlocks: number;
    importedMutes: number;
  } {
    return this.moderationSafety.importUserSocialGraph(userId, data, modeArg);
  }

  getCachedRemoteArtifact(sourceUrl: string): RemoteArtifactCacheRow | undefined {
    return this.moderationSafety.getCachedRemoteArtifact(sourceUrl);
  }

  putCachedRemoteArtifact(entry: {
    sourceUrl: string;
    remoteDomain: string;
    mediaType: string;
    byteSize: number;
    sha256: string;
    data: Buffer;
    ttlDays?: number | undefined;
  }): RemoteArtifactCacheRow {
    return this.moderationSafety.putCachedRemoteArtifact(entry);
  }

  pruneRemoteMediaCache(olderThanDays?: number): { deletedFiles: number; freedBytes: number } {
    return this.moderationSafety.pruneRemoteMediaCache(olderThanDays);
  }

  pruneRemoteContent(olderThanDays?: number): { deletedPosts: number } {
    return this.moderationSafety.pruneRemoteContent(olderThanDays);
  }

  pruneRemoteAccounts(olderThanDays: number = 90): { deletedAccounts: number } {
    return this.moderationSafety.pruneRemoteAccounts(olderThanDays);
  }

  listTrendingTopicsForAdmin(reviewStatus?: string, limit: number = 50): TrendingTopicRow[] {
    return this.moderationSafety.listTrendingTopicsForAdmin(reviewStatus, limit);
  }

  reviewTrendingTopic(
    topicId: number,
    status: "pending" | "approved" | "rejected",
    reviewerId?: number | null,
  ): TrendingTopicRow | undefined {
    return this.moderationSafety.reviewTrendingTopic(topicId, status, reviewerId);
  }

  listPushSubscriptions(userId: number): PushSubscriptionRow[] {
    return this.moderationSafety.listPushSubscriptions(userId);
  }

  upsertPushSubscription(
    userId: number,
    endpoint: string,
    p256dh: string,
    auth: string,
    alerts: Record<string, boolean> = {
      mention: true,
      follow: true,
      reblog: true,
      favourite: true,
      poll: true,
    },
    policy: string = "all",
  ): PushSubscriptionRow {
    return this.moderationSafety.upsertPushSubscription(userId, endpoint, p256dh, auth, alerts, policy);
  }

  deletePushSubscription(userId: number, idOrEndpoint: number | string): boolean {
    return this.moderationSafety.deletePushSubscription(userId, idOrEndpoint);
  }
  // ── Delegated to SpaceRepository (database/repositories/space.ts) ──

  resolveNamespacePrincipal(
    rawSlug: string,
    viewerUserId?: number,
  ):
    | {
        kind: "organization";
        organization: OrganizationRecord;
        spaces: SpaceRecord[];
        members: OrganizationMemberRecord[];
        viewerRole: OrgRole | null;
      }
    | {
        kind: "user";
        user: {
          id: number;
          username: string;
          display_name: string | null;
          bio: string | null;
          avatar_url: string | null;
          banner_url: string | null;
          location: string | null;
          website: string | null;
          created_at: string;
        };
        spaces: SpaceRecord[];
      }
    | null {
    return this.spaces.resolveNamespacePrincipal(rawSlug, viewerUserId);
  }

  createSpace(params: {
    slug: string;
    name: string;
    tagline?: string | null | undefined;
    description?: string | null | undefined;
    ownerType: SpaceOwnerType;
    userId?: number | null | undefined;
    organizationId?: number | null | undefined;
    creatorUserId: number;
    domainPreset?: string | undefined;
    visibility?: SpaceVisibility | undefined;
    avatarUrl?: string | null | undefined;
    bannerUrl?: string | null | undefined;
    defaultBranch?: string | undefined;
  }): SpaceRecord {
    return this.spaces.createSpace(params);
  }

  getSpaceById(id: string): SpaceRecord | null {
    return this.spaces.getSpaceById(id);
  }

  getSpaceByNamespaceAndSlug(namespace: string, slug: string): SpaceRecord | null {
    return this.spaces.getSpaceByNamespaceAndSlug(namespace, slug);
  }

  canUserViewSpace(space: SpaceRecord, viewerUserId?: number | null, isAdmin?: boolean): boolean {
    return this.spaces.canUserViewSpace(space, viewerUserId, isAdmin);
  }

  canUserWriteSpace(space: SpaceRecord, viewerUserId?: number | null, isAdmin?: boolean): boolean {
    return this.spaces.canUserWriteSpace(space, viewerUserId, isAdmin);
  }

  canUserAdminSpace(space: SpaceRecord, viewerUserId?: number | null, isAdmin?: boolean): boolean {
    return this.spaces.canUserAdminSpace(space, viewerUserId, isAdmin);
  }

  listSpaces(opts?: {
    ownerType?: SpaceOwnerType | undefined;
    namespace?: string | undefined;
    domainPreset?: string | undefined;
    search?: string | undefined;
    viewerUserId?: number | undefined;
    limit?: number | undefined;
  }): SpaceRecord[] {
    return this.spaces.listSpaces(opts);
  }

  getUserOwnedSpaces(userId: number, viewerUserId?: number): SpaceRecord[] {
    return this.spaces.getUserOwnedSpaces(userId, viewerUserId);
  }

  getOrganizationSpaces(orgId: number, viewerUserId?: number): SpaceRecord[] {
    return this.spaces.getOrganizationSpaces(orgId, viewerUserId);
  }

  getUserJoinedSpaces(userId: number): (SpaceRecord & { member_role: SpaceRole })[] {
    return this.spaces.getUserJoinedSpaces(userId);
  }

  updateSpace(
    spaceId: string,
    updates: {
      name?: string | undefined;
      tagline?: string | null | undefined;
      description?: string | null | undefined;
      domainPreset?: string | undefined;
      visibility?: SpaceVisibility | undefined;
      avatarUrl?: string | null | undefined;
      bannerUrl?: string | null | undefined;
      defaultBranch?: string | undefined;
      enabledTabs?: string[] | undefined;
      settings?: Record<string, unknown> | undefined;
    },
  ): SpaceRecord | null {
    return this.spaces.updateSpace(spaceId, updates);
  }

  transferSpaceOwnership(
    spaceId: string,
    targetOwnerType: SpaceOwnerType,
    targetSlug: string,
    newSlug?: string,
  ): SpaceRecord {
    return this.spaces.transferSpaceOwnership(spaceId, targetOwnerType, targetSlug, newSlug);
  }

  deleteSpace(spaceId: string): boolean {
    return this.spaces.deleteSpace(spaceId);
  }

  getSpaceMembers(spaceId: string): SpaceMemberRecord[] {
    return this.spaces.getSpaceMembers(spaceId);
  }

  getSpaceMemberRole(spaceId: string, userId: number): SpaceRole | null {
    return this.spaces.getSpaceMemberRole(spaceId, userId);
  }

  upsertSpaceMember(spaceId: string, userId: number, role: SpaceRole): void {
    return this.spaces.upsertSpaceMember(spaceId, userId, role);
  }

  removeSpaceMember(spaceId: string, userId: number): boolean {
    return this.spaces.removeSpaceMember(spaceId, userId);
  }

  followSpace(spaceId: string, userId: number): void {
    return this.spaces.followSpace(spaceId, userId);
  }

  unfollowSpace(spaceId: string, userId: number): void {
    return this.spaces.unfollowSpace(spaceId, userId);
  }

  isFollowingSpace(spaceId: string, userId: number): boolean {
    return this.spaces.isFollowingSpace(spaceId, userId);
  }

  getSpacePages(spaceId: string): SpacePageRecord[] {
    return this.spaces.getSpacePages(spaceId);
  }

  getSpacePageBySlug(spaceId: string, slug: string): SpacePageRecord | null {
    return this.spaces.getSpacePageBySlug(spaceId, slug);
  }

  upsertSpacePage(params: {
    spaceId: string;
    slug: string;
    title: string;
    summary?: string | null | undefined;
    contentMarkdown: string;
    parentId?: string | null | undefined;
    orderIndex?: number | undefined;
    authorUserId: number;
  }): SpacePageRecord {
    return this.spaces.upsertSpacePage(params);
  }

  deleteSpacePage(spaceId: string, slug: string): boolean {
    return this.spaces.deleteSpacePage(spaceId, slug);
  }

  getSpaceChannels(spaceId: string, viewerUserId?: number): SpaceChannelRecord[] {
    return this.spaces.getSpaceChannels(spaceId, viewerUserId);
  }

  getSpaceChannelBySlug(spaceId: string, channelSlug: string): SpaceChannelRecord | null {
    return this.spaces.getSpaceChannelBySlug(spaceId, channelSlug);
  }

  getSpaceChannelById(channelId: string): SpaceChannelRecord | null {
    return this.spaces.getSpaceChannelById(channelId);
  }

  createSpaceChannel(params: {
    spaceId: string;
    slug: string;
    name: string;
    topic?: string | null | undefined;
    kind?: SpaceChannelKind | undefined;
    isPrivate?: boolean | undefined;
  }): SpaceChannelRecord {
    return this.spaces.createSpaceChannel(params);
  }

  getSpaceMessages(
    channelId: string,
    opts?: { limit?: number | undefined; parentMessageId?: string | null | undefined },
  ): SpaceMessageRecord[] {
    return this.spaces.getSpaceMessages(channelId, opts);
  }

  getSpaceMessageById(messageId: string): SpaceMessageRecord | null {
    return this.spaces.getSpaceMessageById(messageId);
  }

  createSpaceMessage(params: {
    channelId: string;
    spaceId: string;
    authorId?: number | null | undefined;
    senderType?: "user" | "bot" | "telemetry_hook" | "ci_runner" | undefined;
    senderName?: string | null | undefined;
    content: string;
    replyToId?: string | null | undefined;
    attachments?: unknown[] | undefined;
    embeddedArtifacts?: unknown[] | undefined;
  }): SpaceMessageRecord {
    return this.spaces.createSpaceMessage(params);
  }

  toggleSpaceMessageReaction(messageId: string, username: string, emoji: string): SpaceMessageRecord | null {
    return this.spaces.toggleSpaceMessageReaction(messageId, username, emoji);
  }

  markSpaceChannelRead(channelId: string, userId: number, lastMessageId?: string): void {
    return this.spaces.markSpaceChannelRead(channelId, userId, lastMessageId);
  }

  promoteSpaceMessage(params: {
    messageId: string;
    targetType: "doc" | "eco";
    actorUserId: number;
    title?: string | undefined;
  }): { message: SpaceMessageRecord; doc?: SpacePageRecord | undefined; eco?: SpaceEcoProposalRecord | undefined } {
    return this.spaces.promoteSpaceMessage(params);
  }

  getSpaceEcoProposals(spaceId: string): SpaceEcoProposalRecord[] {
    return this.spaces.getSpaceEcoProposals(spaceId);
  }

  createSpaceEcoProposal(params: {
    spaceId: string;
    title: string;
    description: string;
    severity?: "minor" | "standard" | "major" | "safety_critical" | undefined;
    sourceBranch?: string | undefined;
    targetBranch?: string | undefined;
    authorId: number;
    impactedModels?: string[] | undefined;
    promotedFromMsgId?: string | null | undefined;
  }): SpaceEcoProposalRecord {
    return this.spaces.createSpaceEcoProposal(params);
  }

  reviewSpaceEcoProposal(params: {
    ecoId: string;
    spaceId: string;
    userId: number;
    decision: "approved" | "changes_requested" | "rejected";
    role?: string | null | undefined;
    intent?: string | null | undefined;
    signatureHex?: string | null | undefined;
    comment?: string | null | undefined;
  }): SpaceEcoProposalRecord | null {
    return this.spaces.reviewSpaceEcoProposal(params);
  }

  getSpaceEcoDiff(
    spaceId: string,
    ecoId: string,
  ): {
    sourceBranch: string;
    targetBranch: string;
    files: {
      filename: string;
      language: string;
      oldContent: string;
      newContent: string;
      additions: number;
      deletions: number;
      status: "modified" | "added" | "deleted";
    }[];
    totalAdditions: number;
    totalDeletions: number;
  } | null {
    return this.spaces.getSpaceEcoDiff(spaceId, ecoId);
  }

  getSpaceEcoSimulation(spaceId: string, ecoId: string): ReturnType<typeof computeEcoSimulationVerification> | null {
    return this.spaces.getSpaceEcoSimulation(spaceId, ecoId);
  }

  getSpaceWorkflowRuns(spaceId: string, ecoId?: string): SpaceWorkflowRunRecord[] {
    return this.spaces.getSpaceWorkflowRuns(spaceId, ecoId);
  }

  getSpaceWorkflowRunById(id: string): SpaceWorkflowRunRecord | null {
    return this.spaces.getSpaceWorkflowRunById(id);
  }

  createSpaceWorkflowRun(params: {
    id?: string;
    spaceId: string;
    ecoId?: string | null;
    provider?: "github" | "gitlab" | "ansatz";
    workflowFile: string;
    workflowName: string;
    triggerEvent?: string;
    commitSha?: string | null;
    ref?: string | null;
    status?: "pending" | "running" | "passed" | "failed" | "cancelled";
    conclusion?: string | null;
    durationMs?: number;
    jobs?: unknown[];
    artifacts?: unknown[];
    summary?: Record<string, unknown>;
    logs?: string;
  }): SpaceWorkflowRunRecord {
    return this.spaces.createSpaceWorkflowRun(params);
  }

  updateSpaceWorkflowRun(
    id: string,
    updates: {
      status?: "pending" | "running" | "passed" | "failed" | "cancelled";
      conclusion?: string | null;
      completedAt?: string | null;
      durationMs?: number;
      jobs?: unknown[];
      artifacts?: unknown[];
      summary?: Record<string, unknown>;
      logs?: string;
    },
  ): SpaceWorkflowRunRecord | null {
    return this.spaces.updateSpaceWorkflowRun(id, updates);
  }

  findEcoByCommitOrBranch(spaceId: string, commitOrBranch: string): SpaceEcoProposalRecord | null {
    return this.spaces.findEcoByCommitOrBranch(spaceId, commitOrBranch);
  }

  runSpaceWorkflows(
    spaceId: string,
    ecoId: string,
    workflowFile?: string,
  ): {
    eco: SpaceEcoProposalRecord;
    runs: SpaceWorkflowRunRecord[];
    simulation: ReturnType<LibraryDatabase["getSpaceEcoSimulation"]>;
  } | null {
    return this.spaces.runSpaceWorkflows(spaceId, ecoId, workflowFile);
  }

  reverifySpaceEcoSimulation(
    spaceId: string,
    ecoId: string,
  ): {
    eco: SpaceEcoProposalRecord;
    simulation: ReturnType<LibraryDatabase["getSpaceEcoSimulation"]>;
  } | null {
    return this.spaces.reverifySpaceEcoSimulation(spaceId, ecoId);
  }

  getSpaceEcoBlastRadius(spaceId: string, ecoId: string): ReturnType<typeof computeEcoBlastRadius> | null {
    return this.spaces.getSpaceEcoBlastRadius(spaceId, ecoId);
  }

  getSpaceEcoBom(
    spaceId: string,
    ecoId: string,
  ): {
    sourceBranch: string;
    targetBranch: string;
    summary: {
      totalPartsDelta: number;
      massDeltaKg: number;
      costDeltaUsd: number;
      carbonDeltaKgCo2: number;
    };
    parts: {
      partNumber: string;
      name: string;
      category: string;
      changeStatus: "added" | "removed" | "modified" | "unchanged";
      baselineQuantity: number;
      targetQuantity: number;
      unitCostUsd: number;
      massKg: number;
      packageDependency?: string | undefined;
      variantOverrides?: Record<string, unknown> | undefined;
    }[];
  } | null {
    return this.spaces.getSpaceEcoBom(spaceId, ecoId);
  }

  mergeSpaceEcoProposal(params: { spaceId: string; ecoId: string; userId: number }): {
    eco: SpaceEcoProposalRecord;
    releaseTag: string;
    commitSha: string;
    aasxPackage: {
      filename: string;
      assetId: string;
      version: string;
      submodels: string[];
    };
    ddpContainer: {
      filename: string;
      standard: string;
      manifestChecksum: string;
    };
    announcementMessage?: SpaceMessageRecord | undefined;
  } {
    return this.spaces.mergeSpaceEcoProposal(params);
  }

  getSpaceIssues(spaceId: string): SpaceIssueRecord[] {
    return this.spaces.getSpaceIssues(spaceId);
  }

  getSpaceIssueById(
    spaceId: string,
    issueIdOrNum: string | number,
  ): (SpaceIssueRecord & { comments: SpaceIssueCommentRecord[] }) | null {
    return this.spaces.getSpaceIssueById(spaceId, issueIdOrNum);
  }

  createSpaceIssue(params: {
    spaceId: string;
    title: string;
    description?: string | undefined;
    severity?: "minor" | "standard" | "major" | "safety_critical" | undefined;
    authorId: number;
    impactedModels?: string[] | undefined;
    labels?: string[] | undefined;
    linkedPrNumber?: number | null | undefined;
  }): SpaceIssueRecord {
    return this.spaces.createSpaceIssue(params);
  }

  updateSpaceIssue(params: {
    spaceId: string;
    issueId: string;
    status?: "open" | "closed" | undefined;
    title?: string | undefined;
    description?: string | undefined;
    severity?: "minor" | "standard" | "major" | "safety_critical" | undefined;
    linkedPrNumber?: number | null | undefined;
  }): SpaceIssueRecord | null {
    return this.spaces.updateSpaceIssue(params);
  }

  upsertSpaceIssueFromExternal(params: {
    spaceId: string;
    externalSource: "jira" | "github" | "gitlab" | "polarion";
    externalKey: string;
    externalUrl?: string | null | undefined;
    externalUpdatedAt?: string | null | undefined;
    title: string;
    description?: string | undefined;
    status: "open" | "closed";
    severity?: "minor" | "standard" | "major" | "safety_critical" | undefined;
    authorId?: number | null | undefined;
    impactedModels?: string[] | undefined;
    labels?: string[] | undefined;
    linkedPrNumber?: number | null | undefined;
    syncStatus?: "synced" | "pending_push" | "conflict" | undefined;
  }): { issue: SpaceIssueRecord; isNew: boolean } {
    return this.spaces.upsertSpaceIssueFromExternal(params);
  }

  addSpaceIssueComment(params: { issueId: string; userId: number; content: string }): SpaceIssueCommentRecord {
    return this.spaces.addSpaceIssueComment(params);
  }

  autocompleteSpaceEntities(
    spaceId: string,
    query: string,
  ): {
    kind: "doc" | "channel" | "eco" | "member";
    id: string;
    label: string;
    reference: string;
    subtitle: string;
  }[] {
    return this.spaces.autocompleteSpaceEntities(spaceId, query);
  }

  getUserChatSidebarTree(userId: number): {
    spaces: (SpaceRecord & {
      member_role: SpaceRole;
      channels: SpaceChannelRecord[];
      total_unread: number;
      total_mentions: number;
    })[];
  } {
    return this.spaces.getUserChatSidebarTree(userId);
  }

  close(): void {
    if (this.analyticsBuffer) {
      this.analyticsBuffer.stop();
      this.analyticsBuffer.flushSync();
    }
    try {
      if (this.#openalexDb && this.#openalexDb.open) {
        this.#openalexDb.close();
      }
    } catch {
      // Best-effort OpenAlex DB close on shutdown
    }
    try {
      this.#auditDb?.close();
    } catch {
      // Best-effort audit DB close on shutdown
    }
    try {
      this.#analyticsDb?.close();
    } catch {
      // Best-effort analytics DB close on shutdown
    }
    this.#db.close();
  }
}

export type {
  AccountWarningRow,
  CanonicalEmailBlockRow,
  ContentFilterKeyword,
  ContentFilterMatch,
  ContentFilterRow,
  FederationRelayRow,
  InstanceRuleRow,
  IpBlockRow,
  PostPollOption,
  PostPollView,
  PostVisibility,
  ProfileField,
  PushSubscriptionRow,
  RemoteArtifactCacheRow,
  StaffNoteRow,
  UserReferralRow,
  WaitlistSubmissionRow,
} from "./database/types.js";
export type Database = LibraryDatabase;
