// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CosimMqttClient, HistorianRecorder } from "@modelscript/exchange/cosim";
import { FmuStorage } from "@modelscript/exchange/fmu";
import express, { type Request } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

import { getStdlibsByPack, type StdlibPackId } from "@modelscript/exchange/catalog";
import { initializeArtifactSystem } from "./artifacts/index.js";
import { LibraryDatabase } from "./database.js";
import {
  createOptionalEnterpriseHeadersMiddleware,
  isEnterpriseEditionActive,
  mountEditionRoutes,
  type EnterprisePlugin,
} from "./ee-loader.js";
import { JobQueue } from "./jobs.js";
import { optionalAuth, setAuthDatabase } from "./middleware/auth-middleware.js";
import { responseCompressionMiddleware } from "./middleware/compression.js";
import { requireFeatureFlag } from "./middleware/feature-flag-middleware.js";
import { defaultApiLimiter } from "./middleware/rate-limiter.js";
import { allMigrations } from "./migrations/index.js";
import { adminRouter } from "./routes/admin.js";
import { artifactViewerRouter } from "./routes/artifact-viewer.js";
import { authRouter } from "./routes/auth.js";
import { billingRouter } from "./routes/billing.js";
import { caeRouter } from "./routes/cae.js";
import { cloudRouter } from "./routes/cloud.js";
import { cosimRouter, mqttParticipantsRouter } from "./routes/cosim.js";
import { federationRouter } from "./routes/federation.js";
import { fmuRouter } from "./routes/fmu.js";
import { gitServerRouter } from "./routes/git-server.js";
import { gitRouter } from "./routes/git.js";
import { graphqlRouter } from "./routes/graphql.js";
import { historianRouter } from "./routes/historian.js";
import { ideWorkbenchRouter } from "./routes/ide-workbench.js";
import { instancesRouter } from "./routes/instances.js";
import { markdownMirrorRouter } from "./routes/markdown-mirror.js";
import { mcpRouter } from "./routes/mcp.js";
import { npmAuthRouter } from "./routes/npm-auth.js";
import { npmRegistryRouter } from "./routes/npm-registry.js";
import { oembedRouter, renderStandaloneEmbedBundle } from "./routes/oembed.js";
import { ogRouter } from "./routes/og.js";
import { organizationsRouter } from "./routes/organizations.js";
import { packagesRouter } from "./routes/packages.js";
import { physicsRouter } from "./routes/physics.js";
import { provisioningRouter } from "./routes/provisioning.js";
import { publishRouter } from "./routes/publish.js";
import { pushRouter } from "./routes/push.js";
import { rdfRouter } from "./routes/rdf.js";
import { referencesRouter } from "./routes/references.js";
import { registryCatalogRouter } from "./routes/registry-catalog.js";
import { reposRouter } from "./routes/repos.js";
import { rfqRouter } from "./routes/rfq.js";
import { scriptsRouter } from "./routes/scripts.js";
import { searchRouter } from "./routes/search.js";
import { createPostEvidenceRouter, createSigningKeysRouter } from "./routes/signing-keys.js";
import { simulateRouter } from "./routes/simulate.js";
import { sitemapsRouter } from "./routes/sitemaps.js";
import { socialRouter } from "./routes/social.js";
import { renderSolutionBundleHtml, solutionsRouter } from "./routes/solutions.js";
import { spacesRouter } from "./routes/spaces.js";
import { sparqlRouter } from "./routes/sparql.js";
import { storageRouter } from "./routes/storage.js";
import { supplyChainRouter } from "./routes/supply-chain.js";
import { sysml2OmgRouter } from "./routes/sysml2-omg.js";
import { threadRouter } from "./routes/thread.js";
import { twinsRouter } from "./routes/twins.js";
import { usersRouter } from "./routes/users.js";
import { waitlistRouter } from "./routes/waitlist.js";
import { webhooksRouter } from "./routes/webhooks.js";
import { seedScriptsAndTemplates } from "./seed-scripts.js";
import { seedPolyglotSocialData, seedPolyglotUsers } from "./seed/index.js";
import { defaultArchiveQueue } from "./services/archive-queue.js";
import { FeatureFlagService } from "./services/feature-flag-service.js";
import { FederationWorker } from "./services/federation-worker.js";
import { locationService } from "./services/location.js";
import { defaultMailer } from "./services/mailer.js";
import { preloadOpenAlexS3Slice } from "./services/openalex.js";
import { SysML2OmgService } from "./services/sysml2-omg-service.js";
import { LibraryStorage } from "./storage.js";
import { SANCTIONED_COUNTRIES, SANCTIONED_REGIONS } from "./util/compliance.js";
import { seedInitialAdmin } from "./util/seed-admin.js";
import { seedPrepackagedLibraries } from "./util/seed-examples.js";
import { injectSeoIntoHtml, resolveSeoMetadata } from "./util/seo-injector.js";
import { isFederationDisabled, isStrictAirgapEnv, resolveTierPreset } from "./util/tier-presets.js";

/** Options for creating the Express application. */
export interface AppOptions {
  /** Optional library storage override. */
  storage?: LibraryStorage | undefined;
  /** Optional database override. */
  database?: LibraryDatabase | undefined;
  /** MQTT client for co-simulation (null = no MQTT). */
  mqttClient?: CosimMqttClient | null | undefined;
  /** Optional job queue override. */
  jobQueue?: JobQueue | undefined;
  /** PostgreSQL pool for historian queries (null = stubs). */
  dbPool?: Pool | null | undefined;
  /** Optional TimescaleDB historian recorder for co-simulation sessions. */
  historianRecorder?: HistorianRecorder | null | undefined;
  /** Optional Enterprise Edition plugin override. */
  enterprisePlugin?: EnterprisePlugin | undefined;
  /** Explicit override to control standard library background seeding on boot. */
  seedStdlibOnBoot?: boolean | undefined;
  /** Explicit override to control OpenAlex S3 first slice background preloading on boot. */
  preloadOpenAlex?: boolean | undefined;
  /** Explicit override to control background periodic workers (decay, RSS, purge, auto-backup, bot mention). */
  enableWorkers?: boolean | undefined;
}

/**
 * Creates and configures the ModelScript Cloud Express application, mounting all REST, GraphQL,
 * SPARQL, SysML v2 OMG, npm registry, ActivityPub federation, and simulation routers, along with
 * security/CORS headers, rate limiting, and background maintenance workers.
 */
export function createApp(options?: AppOptions | LibraryStorage): express.Express {
  const app = express();

  // Support legacy signature: createApp(storage?)
  const opts: AppOptions = options instanceof LibraryStorage ? { storage: options } : (options ?? {});

  const libraryStorage = opts.storage ?? LibraryStorage.fromEnv();
  const jobQueue = opts.jobQueue ?? new JobQueue();
  app.locals["jobQueue"] = jobQueue;

  const database = opts.database ?? new LibraryDatabase();
  app.locals["database"] = database;
  const mqttClient = opts.mqttClient ?? null;
  const dbPool = opts.dbPool ?? null;
  const historianRecorder = opts.historianRecorder ?? null;

  const featureFlagService = new FeatureFlagService(database);
  app.locals["featureFlagService"] = featureFlagService;

  const isStartupAirgap = isStrictAirgapEnv();
  const isTestEnv =
    process.env["NODE_ENV"] === "test" ||
    Boolean(process.env["CI"]) ||
    Boolean(process.env["TEST_TIMEOUT"]) ||
    Boolean(process.env["TEST_CONCURRENCY"]);
  const shouldEnableWorkers = opts.enableWorkers ?? (!isTestEnv && process.env["NODE_ENV"] !== "test");

  const federationWorker = new FederationWorker(database);
  const instanceSettings = database.isOpen() ? database.getInstanceSettings() : undefined;
  const isFederationActive =
    !isStartupAirgap &&
    !isFederationDisabled(instanceSettings) &&
    (instanceSettings?.federationMode === "open" || featureFlagService.isEnabled("activitypub_federation"));
  if (shouldEnableWorkers && isFederationActive) {
    federationWorker.start();
  }
  app.locals["federationWorker"] = federationWorker;
  app.locals["analyticsBuffer"] = database.analyticsBuffer;

  setAuthDatabase(database);

  // Initialize the extensible artifact system (FMU, Dataset, etc.)
  initializeArtifactSystem();

  // Initialize LocationService
  void locationService.init().catch((err) => {
    console.error("[LocationService] Error during init:", err);
  });

  // Seed initial admin if specified via env vars (ADMIN_INIT_USERNAME / ADMIN_INIT_PASSWORD / AUTO_SEED_ADMIN=true);
  // otherwise fresh deployments launch the interactive /setup First-Run Install Wizard.
  if (
    process.env["ADMIN_INIT_USERNAME"] ||
    process.env["ADMIN_INIT_PASSWORD"] ||
    process.env["AUTO_SEED_ADMIN"] === "true"
  ) {
    void seedInitialAdmin(database)
      .then((res) => {
        if (res.created) {
          console.log(
            `[AdminSeed] Bootstrapped initial admin account '${res.username}'${
              res.presetApplied ? ` with preset '${res.presetApplied}'` : ""
            }.`,
          );
          if (res.generatedPassword) {
            console.warn(
              `[AdminSeed] NOTICE: Initial admin password was auto-generated because ADMIN_INIT_PASSWORD was not set: ${res.generatedPassword}`,
            );
          }
        }
      })
      .catch((err) => {
        console.error("[AdminSeed] Failed to bootstrap admin:", err);
      });
  }

  const activePreset = resolveTierPreset(
    process.env["ANSATZ_TIER"] || process.env["DEPLOYMENT_PRESET"] || process.env["MSX_SETUP_PRESET"],
  );
  const isFlagship = activePreset?.id === "tier3_flagship";
  const isProductionPreset =
    activePreset?.id === "tier3_flagship" ||
    activePreset?.id === "tier1_federated" ||
    activePreset?.id === "tier2_corporate";
  const isProductionEnv = process.env["NODE_ENV"] === "production" || isProductionPreset;

  // Pre-seed bundled standard libraries (MSL for DigitalOcean flagship) in:
  // 1. DigitalOcean flagship deployment (isFlagship) ALWAYS — ensures flagship never has missing packages even after a database reset
  // 2. Airgapped production appliances
  // 3. Any production/staging node when SEED_STDLIB_ON_BOOT=true, when target standard libraries are missing, or when database has 0 packages
  const defaultStdlibPacks = "modelica";
  const requestedStdlibPacks = (process.env["STDLIB_PACKS"] || defaultStdlibPacks)
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const targetStdlibs = requestedStdlibPacks.flatMap((p) => getStdlibsByPack(p as StdlibPackId | "all"));
  const hasMissingStdlibs = targetStdlibs.some((lib) => {
    if (lib.tier === "tier3_ondemand") return false;
    const pkg = database.getPackage(lib.packageName);
    if (!pkg) return true;
    const ver = database.getPackageVersion(pkg.id, lib.version);
    return !ver || database.getClassCount(lib.packageName, lib.version) === 0;
  });

  const shouldSeedStdlibs =
    opts.seedStdlibOnBoot ??
    (process.env["SEED_STDLIB_ON_BOOT"] === "true" ||
      (!isTestEnv &&
        (isFlagship ||
          (isStartupAirgap && process.env["SEED_STDLIB_ON_BOOT"] !== "false") ||
          hasMissingStdlibs ||
          (isProductionEnv && database.listPackages().length === 0))));

  if (shouldSeedStdlibs) {
    void seedPrepackagedLibraries(libraryStorage, database, jobQueue).catch((err) => {
      console.error("[StdlibSeed] Failed to pre-seed bundled standard libraries:", err);
    });
  }

  // Dev auto-seeding (mock personas, sample posts, synthetic repos, example jobs) MUST NEVER run on
  // the flagship node or production tiers. It only runs in local development/sandbox environments,
  // unless explicitly requested in non-production environments (e.g. dev:flagship with ALLOW_DEV_SEEDING=true).
  const isExplicitDevOverride =
    process.env["NODE_ENV"] !== "production" &&
    (process.env["ALLOW_DEV_SEEDING"] === "true" || process.env["FORCE_DEV_SEED"] === "true");

  const allowDevSeeding =
    (!isProductionEnv && !isTestEnv && process.env["SEED_DATA"] !== "false") ||
    (isExplicitDevOverride && process.env["SEED_DATA"] !== "false");

  const isExplicitDevSeed =
    (process.env["SEED_EXAMPLES"] === "true" && !isProductionEnv && !isFlagship) ||
    (isExplicitDevOverride && process.env["SEED_EXAMPLES"] !== "false");

  // Preload OpenAlex first slice from S3 into local openalex.db in flagship dev mode
  const shouldPreloadOpenAlex =
    opts.preloadOpenAlex ??
    (process.env["SEED_OPENALEX_ON_BOOT"] === "true" ||
      process.env["PRELOAD_OPENALEX_SLICE"] === "true" ||
      (!isTestEnv &&
        process.env["SEED_OPENALEX_ON_BOOT"] !== "false" &&
        isFlagship &&
        (allowDevSeeding || isExplicitDevOverride)));

  if (shouldPreloadOpenAlex) {
    void preloadOpenAlexS3Slice(database)
      .then((res) => {
        if (res.status === "already_loaded") {
          console.log(`[OpenAlex] Local catalog already populated (${res.totalWorks} works).`);
        } else {
          console.log(
            `[OpenAlex] Preloaded first slice (${res.importedCount} works in ${res.durationMs}ms) from ${res.fromCache ? "cache" : "S3"}.`,
          );
        }
      })
      .catch((err) => {
        console.warn("[OpenAlex] Failed to preload OpenAlex slice on boot:", err instanceof Error ? err.message : err);
      });
  }

  if (allowDevSeeding || isExplicitDevSeed) {
    console.log("[DevServer] Development mode detected. Running auto-seeding...");

    seedScriptsAndTemplates(database);
    seedPolyglotUsers(database);

    // Run asynchronously in the background after the HTTP listener binds
    const devSeedPromise = (async () => {
      try {
        await seedPolyglotSocialData(database);
        if (isExplicitDevSeed) {
          if (!isTestEnv) {
            await seedPrepackagedLibraries(libraryStorage, database, jobQueue);
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("database connection is not open")) {
          console.error("[DevServer] Failed to seed dev catalog:", err);
        }
      }
    })();
    app.locals["devSeedPromise"] = devSeedPromise;
  }

  const isDevResetAllowed =
    process.env["ENABLE_DEV_RESET"] === "true" ||
    (process.env["NODE_ENV"] !== "production" &&
      (!isProductionPreset || isExplicitDevOverride || process.env["ALLOW_DEV_RESET"] === "true"));

  if (isDevResetAllowed) {
    app.post("/api/v1/dev/reset", async (_req, res) => {
      console.log("[DevServer] Resetting database and re-seeding...");
      try {
        jobQueue.clear();
        database.resetDevData();

        if (
          process.env["ADMIN_INIT_USERNAME"] ||
          process.env["ADMIN_INIT_PASSWORD"] ||
          process.env["AUTO_SEED_ADMIN"] === "true" ||
          process.env["NODE_ENV"] !== "production"
        ) {
          await seedInitialAdmin(database);
        }

        seedScriptsAndTemplates(database);
        seedPolyglotUsers(database);

        await seedPolyglotSocialData(database, { force: true });
        await seedPrepackagedLibraries(libraryStorage, database, jobQueue);
        res.json({ success: true });
      } catch (err) {
        console.error("[DevServer] Failed to reset dev data:", err);
        res.status(500).json({ success: false, error: String(err) });
      }
    });
  }

  // ── Periodic Workers (disabled in test environment) ──
  if (shouldEnableWorkers) {
    const decayWorkerInterval = setInterval(
      () => {
        try {
          if (database.getInstanceSettings().maintenanceMode) return;
          database.decayTrendingTopics();
        } catch (err) {
          console.error("Failed to decay trending topics:", err);
        }
      },
      15 * 60 * 1000,
    );
    app.locals["decayWorkerInterval"] = decayWorkerInterval;

    if (!isStartupAirgap) {
      const runRssWorker = () => {
        try {
          if (database.getInstanceSettings().maintenanceMode) return;
        } catch {
          // proceed
        }
        import("./util/rss-worker.js")
          .then(({ processRssFeeds }) => {
            void processRssFeeds(database);
          })
          .catch(console.error);
      };

      runRssWorker();
      const rssWorkerInterval = setInterval(runRssWorker, 15 * 60 * 1000);
      app.locals["rssWorkerInterval"] = rssWorkerInterval;
    }

    // Automated GDPR / Security Log Retention Worker (Daily purge of expired logs > 30 days)
    const runLogPurgeWorker = () => {
      try {
        if (database.getInstanceSettings().maintenanceMode) return;
        const { deletedCount } = database.purgeExpiredLogs(30);
        if (deletedCount > 0) {
          console.log(
            `[LogRetentionWorker] Purged ${deletedCount} expired audit/operational log records (> 30 days retention policy).`,
          );
        }
        const { removedCount } = defaultArchiveQueue.cleanupExpiredArchives();
        if (removedCount > 0) {
          console.log(`[ArchiveRetentionWorker] Cleaned up ${removedCount} expired data archive files (> 24h TTL).`);
        }
      } catch (err) {
        console.error("[LogRetentionWorker] Error executing retention log purge:", err);
      }
    };

    runLogPurgeWorker();
    const logPurgeInterval = setInterval(runLogPurgeWorker, 24 * 60 * 60 * 1000);
    app.locals["logPurgeInterval"] = logPurgeInterval;

    // Automated SQLite Hot Backup & Retention Pruning Worker (Checks hourly against autoBackupIntervalHours)
    const runAutoBackupWorker = () => {
      try {
        const settings = database.getInstanceSettings();
        const intervalHours = settings.autoBackupIntervalHours;
        if (intervalHours <= 0) return;

        const backups = database.listBackups();
        const latestBackupAt = backups[0]?.createdAt ? new Date(backups[0].createdAt).getTime() : 0;
        const elapsedHours = (Date.now() - latestBackupAt) / (1000 * 60 * 60);
        if (!latestBackupAt || elapsedHours >= intervalHours) {
          const snapshot = database.createHotBackup("scheduled");
          const pruned = database.pruneBackups(settings.backupRetentionCount);
          console.log(
            `[AutoBackupWorker] Created scheduled SQLite snapshot '${snapshot.fileName}' (${snapshot.sizeBytes} bytes, pruned ${pruned.deletedCount} older backups).`,
          );
        }
      } catch (err) {
        console.error("[AutoBackupWorker] Error executing scheduled backup:", err);
      }
    };
    const autoBackupInterval = setInterval(runAutoBackupWorker, 60 * 60 * 1000);
    app.locals["autoBackupInterval"] = autoBackupInterval;

    // Automated Social Bot Mention Worker (Polls pending @bot mentions and synthesizes LLM responses)
    if (!isStartupAirgap || process.env["ALLOW_AIRGAP_BOTS"] === "true") {
      import("./services/bot-mention-worker.js")
        .then(({ BotMentionWorker }) => {
          const botWorker = new BotMentionWorker(database);
          botWorker.start(2000);
          app.locals["botMentionWorker"] = botWorker;
        })
        .catch((err) => {
          console.error("Failed to start BotMentionWorker:", err);
        });
    }
  }

  // Reject oversized payloads before body buffering to prevent unauthenticated JSON DOS
  app.use((req, res, next) => {
    const cl = req.headers["content-length"];
    if (cl) {
      const length = parseInt(cl, 10);
      if (req.path.startsWith("/api/v1/auth") || req.path.startsWith("/auth")) {
        if (length > 256 * 1024) {
          res.status(413).json({ error: "Payload too large for authentication endpoint (max 256KB)" });
          return;
        }
      } else {
        const isExcluded =
          req.path.includes("/admin/") ||
          req.path.includes("/backups") ||
          req.path.includes("/bundle/import") ||
          req.path.startsWith("/api/v1/libraries") ||
          req.path.startsWith("/libraries") ||
          req.path.startsWith("/api/v1/storage") ||
          req.path.startsWith("/storage") ||
          req.path.startsWith("/api/v1/npm") ||
          req.path.startsWith("/npm");

        if (!isExcluded && length > 2 * 1024 * 1024) {
          res.status(413).json({ error: "Payload too large for API endpoint (max 2MB)" });
          return;
        }
      }
    }
    next();
  });

  // Increased limit for npm publish payloads (base64-encoded tarballs in JSON body)
  app.use(
    express.json({
      limit: "50mb",
      verify: (req: express.Request, _res, buf) => {
        const url = req.originalUrl || req.url || "";
        if (
          url.includes("/webhooks") ||
          req.headers["x-hub-signature-256"] !== undefined ||
          req.headers["x-gitlab-token"] !== undefined ||
          req.headers["x-gitlab-event-token"] !== undefined ||
          req.headers["x-webhook-secret"] !== undefined ||
          req.headers["stripe-signature"] !== undefined
        ) {
          req.rawBody = buf;
        }
      },
    }),
  );

  // Cookie parser middleware (HttpOnly session cookies) & per-app auth DB binding
  app.use((req, _res, next) => {
    setAuthDatabase(database);
    const cookieHeader = req.headers["cookie"];
    const cookies: Record<string, string> = {};
    if (cookieHeader) {
      for (const pair of cookieHeader.split(";")) {
        const idx = pair.indexOf("=");
        if (idx !== -1) {
          const key = pair.slice(0, idx).trim();
          const val = pair.slice(idx + 1).trim();
          try {
            cookies[key] = decodeURIComponent(val);
          } catch {
            cookies[key] = val;
          }
        }
      }
    }
    req.cookies = cookies;
    next();
  });

  if (process.env["TRUST_PROXY"] === "true" || process.env["NODE_ENV"] === "production") {
    app.set("trust proxy", 1);
  }

  // HTTP response compression (gzip / deflate for JSON, HTML, SVG, text >= 1KB)
  app.use(responseCompressionMiddleware);

  // Rate Limiting (OWASP, DoS & Brute-force defense)
  app.use(defaultApiLimiter);

  // CORS & Security Defensive Headers (OWASP, SOC 2, ISO 27001, GDPR Art. 32)
  const allowedOrigins = new Set(
    [process.env["PUBLIC_URL"], ...(process.env["CORS_ALLOWED_ORIGINS"] || "").split(",")]
      .map((o) => o?.trim())
      .filter((o): o is string => Boolean(o)),
  );
  app.use((req, res, next) => {
    const requestOrigin = req.headers.origin;
    const isEmbedRoute =
      req.path.startsWith("/embed") ||
      req.path.startsWith("/render-artifact") ||
      req.path.startsWith("/morsel") ||
      req.path.startsWith("/api/v1/oembed") ||
      req.path.startsWith("/api/v1/morsels") ||
      req.path.startsWith("/static/solutions/") ||
      req.path === "/static/embed.js" ||
      req.path === "/api/v1/embed.js";
    const federationDisabled = isFederationDisabled(database.isOpen() ? database.getInstanceSettings() : undefined);
    const isPublicFederationPath =
      isEmbedRoute ||
      (!federationDisabled &&
        (req.path.startsWith("/.well-known/") ||
          req.path.startsWith("/nodeinfo/") ||
          req.path.startsWith("/actor") ||
          req.path.startsWith("/users/")));

    if (process.env["NODE_ENV"] === "production" && allowedOrigins.size > 0 && !isPublicFederationPath) {
      if (requestOrigin && allowedOrigins.has(requestOrigin)) {
        res.header("Access-Control-Allow-Origin", requestOrigin);
        res.header("Access-Control-Allow-Credentials", "true");
        res.header("Vary", "Origin");
      } else if (!requestOrigin) {
        res.header("Access-Control-Allow-Origin", Array.from(allowedOrigins)[0]!);
      }
    } else {
      res.header("Access-Control-Allow-Origin", "*");
    }
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, Idempotency-Key");
    res.header("X-Content-Type-Options", "nosniff");
    const embedFrameAncestors = process.env["EMBED_FRAME_ANCESTORS"] || "*";
    if (!isEmbedRoute) {
      res.header("X-Frame-Options", "SAMEORIGIN");
    }
    res.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
    res.header("Referrer-Policy", "strict-origin-when-cross-origin");
    res.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

    const frameAncestorsDirective = isEmbedRoute
      ? `frame-ancestors ${embedFrameAncestors};`
      : "frame-ancestors 'self';";
    if (isEmbedRoute) {
      res.header("Content-Security-Policy", frameAncestorsDirective);
    } else if (!res.getHeader("Content-Security-Policy")) {
      const customCsp = process.env["CUSTOM_CSP"];
      if (customCsp) {
        res.header("Content-Security-Policy", customCsp);
      } else {
        res.header(
          "Content-Security-Policy",
          "default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; font-src 'self' data: https:; img-src 'self' data: blob: https:; connect-src 'self' http: https: wss: ws:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self';",
        );
      }
    }

    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Enterprise Edition (ee/) Air-Gap Security Headers
  app.use(createOptionalEnterpriseHeadersMiddleware());

  // Multi-Tiered Maintenance Mode Enforcement Middleware ('read_only' & 'lockdown')
  app.use((req, res, next) => {
    if (req.method === "OPTIONS" || req.method === "HEAD") {
      next();
      return;
    }
    // Always exempt core auth, admin control plane, health probes, legal, and public banner discovery
    if (
      req.path === "/health" ||
      req.path === "/health/ready" ||
      req.path === "/legal" ||
      req.path.startsWith("/.well-known/") ||
      req.path.startsWith("/nodeinfo/") ||
      req.path.startsWith("/api/v1/auth") ||
      req.path.startsWith("/api/v1/admin") ||
      req.path.startsWith("/api/v1/setup") ||
      req.path.startsWith("/api/v1/instance") ||
      req.path.startsWith("/api/v1/flags") ||
      req.path.startsWith("/api/v1/compliance") ||
      req.path.startsWith("/api/v1/dev/reset")
    ) {
      next();
      return;
    }

    let isMaintenance = false;
    let maintenanceLevel: "off" | "scheduled" | "read_only" | "lockdown" = "off";
    let maintenanceEta = "";
    let announcementBanner = "";
    try {
      const settings = database.getInstanceSettings();
      isMaintenance = settings.maintenanceMode;
      maintenanceLevel = settings.maintenanceLevel;
      maintenanceEta = settings.maintenanceEta;
      announcementBanner = settings.announcementBanner;
    } catch {
      isMaintenance = false;
    }

    if (req.path.startsWith("/api/v1/analytics/pageview")) {
      if (!isMaintenance || maintenanceLevel === "scheduled") {
        next();
        return;
      }
      res.status(202).json({ success: true, counted: false, ignored: "maintenance" });
      return;
    }

    if (!isMaintenance) {
      next();
      return;
    }

    const isReadRequest = req.method === "GET";
    const isApiOrGitOrNpm =
      req.path.startsWith("/api/") ||
      req.path.startsWith("/git/") ||
      req.path.startsWith("/-/") ||
      req.path.includes("/-/");

    // In 'read_only' mode, all GET requests pass through; in 'lockdown' mode, API GET requests are also blocked for non-admins
    if (isReadRequest && (maintenanceLevel !== "lockdown" || !isApiOrGitOrNpm)) {
      next();
      return;
    }

    optionalAuth(req as Request, res, () => {
      const authUser = (req as Request).user;
      if (authUser?.accountType === "admin" || authUser?.role === "admin") {
        res.setHeader("X-ModelScript-Admin-Bypass", "true");
        next();
        return;
      }

      let retryAfterSec = 300;
      if (maintenanceEta) {
        const etaMs = Date.parse(maintenanceEta);
        if (!Number.isNaN(etaMs) && etaMs > Date.now()) {
          retryAfterSec = Math.max(30, Math.min(86400, Math.ceil((etaMs - Date.now()) / 1000)));
        }
      }

      res.setHeader("Retry-After", String(retryAfterSec));
      res.setHeader("X-ModelScript-Maintenance", maintenanceLevel);
      if (maintenanceEta) {
        res.setHeader("X-ModelScript-Maintenance-ETA", maintenanceEta);
      }
      res.status(503).json({
        error:
          maintenanceLevel === "lockdown"
            ? "Instance is currently undergoing full-lockdown maintenance. Please try again shortly."
            : "Instance is currently in read-only maintenance mode. Please try again shortly.",
        maintenanceMode: true,
        maintenanceLevel,
        maintenanceEta: maintenanceEta || null,
        message: announcementBanner || null,
        retryAfterSeconds: retryAfterSec,
      });
    });
  });

  // Feature flags endpoint (evaluated for requesting user)
  app.get("/api/v1/flags", optionalAuth, (req, res) => {
    const reqWithUser = req as typeof req & {
      user?: Parameters<typeof featureFlagService.getAllFlagsForUser>[0];
    };
    res.json(featureFlagService.getAllFlagsForUser(reqWithUser.user));
  });

  // Auth & Community routes
  app.use("/api/v1/auth", authRouter(database));
  app.use("/api/v1/waitlist", waitlistRouter(database));
  const mountedUsersRouter = usersRouter(database, federationWorker);
  app.use("/api/v1/users", mountedUsersRouter);
  app.use("/api/v1/user", mountedUsersRouter);
  app.use("/api/v1/users", createSigningKeysRouter(database));
  app.use("/api/v1/posts", createPostEvidenceRouter(database));
  app.use("/api/v1/solutions", solutionsRouter(database));
  app.use("/api/v1/spaces", spacesRouter(database));
  app.use("/api/v1/spaces", rfqRouter());
  app.use("/api/v1/supply-chain", supplyChainRouter());
  app.use("/api/v1/provisioning", provisioningRouter());
  app.use("/api/v1/social", socialRouter(database, federationWorker, featureFlagService));
  const mountedReferencesRouter = referencesRouter(database);
  app.use("/api/v1/references", mountedReferencesRouter);
  app.use("/api/v1/sources", mountedReferencesRouter);
  app.use("/api/v1/citations", mountedReferencesRouter);
  app.use("/api/v1", pushRouter(database));

  // FMU storage & open-standard FMU registry routes
  const fmuStorageDir = path.resolve(database.dbDir, "fmus");
  const fmuStorage = new FmuStorage(fmuStorageDir);
  app.locals["fmuStorage"] = fmuStorage;
  app.locals["fmuStorageDir"] = fmuStorageDir;

  const sharedGitRouter = gitRouter(database);

  // ── Enterprise Edition (ee/) Subsystems (Batches A–I) ──
  const omgRouter = sysml2OmgRouter(new SysML2OmgService(database));
  mountEditionRoutes(
    {
      app,
      isFeatureFlagEnabled: (flagKey) => featureFlagService.isEnabled(flagKey),
      hasAdminUser: () => database.hasAdminUser(),
      isDatabaseOpen: () => Boolean(database && database.isOpen()),
      isGeoIpReady: () => locationService.isReady(),
      getMailerDriver: () => defaultMailer.getDriver(),
      sanctionedCountriesCount: SANCTIONED_COUNTRIES.size,
      sanctionedRegionsCount: SANCTIONED_REGIONS.size,
      auth: {
        organizationsRouter: organizationsRouter(database),
        optionalAuthMiddleware: optionalAuth,
      },
      hpcBilling: {
        optionalAuthMiddleware: optionalAuth,
        caeFeatureGuard: requireFeatureFlag(() => featureFlagService, "cae_cloud_solver", {
          exemptPaths: ["/cluster/status", "/cae/cluster/status"],
        }),
        billingFeatureGuard: requireFeatureFlag(() => featureFlagService, "billing_stripe_live"),
        caeRouter: caeRouter(jobQueue, database),
        cloudRouter: cloudRouter(libraryStorage, jobQueue, database),
        billingRouter: billingRouter(database),
      },
      twins: {
        optionalAuthMiddleware: optionalAuth,
        cosimFeatureGuard: requireFeatureFlag(() => featureFlagService, "cosim_mqtt"),
        historianFeatureGuard: requireFeatureFlag(() => featureFlagService, "timescaledb_historian"),
        twinsFeatureGuard: requireFeatureFlag(() => featureFlagService, "digital_twins"),
        historianRouter: historianRouter(dbPool, mqttClient),
        instancesRouter: instancesRouter(database, dbPool),
        twinsRouter: twinsRouter(database),
        cosimRouter: cosimRouter(mqttClient, fmuStorage, historianRecorder),
        mqttParticipantsRouter: mqttParticipantsRouter(mqttClient),
      },
      interop: {
        optionalAuthMiddleware: optionalAuth,
        mcpFeatureGuard: requireFeatureFlag(() => featureFlagService, "mcp_gateway_sse"),
        sysml2FeatureGuard: requireFeatureFlag(() => featureFlagService, "sysml2_omg_api"),
        mcpRouter: mcpRouter(database),
        sysml2OmgRouter: omgRouter,
      },
      thread: {
        optionalAuthMiddleware: optionalAuth,
        threadFeatureGuard: requireFeatureFlag(() => featureFlagService, "digital_thread_explorer"),
        threadRouter: threadRouter(undefined, database),
      },
      adminDevops: {
        optionalAuthMiddleware: optionalAuth,
        adminRouter: adminRouter(database, federationWorker, featureFlagService),
        webhooksRouter: webhooksRouter(database, jobQueue, libraryStorage),
        gitRouter: sharedGitRouter,
        sparqlFeatureGuard: requireFeatureFlag(() => featureFlagService, "sparql_rdf_endpoints"),
        sparqlRouter: sparqlRouter(database),
      },
    },
    opts.enterprisePlugin,
  );

  app.use("/api/v1/repos", reposRouter(database));
  app.use("/api/v1/search", searchRouter(database));
  app.use("/api/v1/storage", storageRouter());
  app.use("/", federationRouter(database, federationWorker));

  // Mount the library & cross-registry streaming catalog routers
  const mountedRegistryCatalogRouter = registryCatalogRouter(libraryStorage, database);
  app.use("/api/v1", mountedRegistryCatalogRouter);
  app.use("/api/v1/registry", mountedRegistryCatalogRouter);
  app.use("/registry", mountedRegistryCatalogRouter);
  app.use("/api/v1/libraries", rdfRouter(database));
  app.use("/api/v1/libraries", graphqlRouter(database));
  app.use("/api/v1/libraries", packagesRouter(libraryStorage, jobQueue, database));
  app.use("/api/v1/libraries", publishRouter(libraryStorage, jobQueue, database, federationWorker));
  app.use("/api/v1", optionalAuth, simulateRouter(libraryStorage, jobQueue, database));
  app.use("/api/v1", optionalAuth, physicsRouter(jobQueue, database));

  app.use("/api/v1/jobs", scriptsRouter(database));
  app.use("/api/v1/studies", scriptsRouter(database));

  // Artifact viewer routes (query artifact metadata, viewer configs)
  app.use("/api/v1", artifactViewerRouter(database));

  // Universal oEmbed provider route (/api/v1/oembed) & standalone intranet SDK bundle (/static/embed.js)
  app.use("/api/v1", oembedRouter(database));

  // Dynamic OpenGraph image preview generation (/api/v1/og/post/:id, /api/v1/og/package/:name, /api/v1/og/class/:name/:version/:className)
  app.use("/api/v1/og", ogRouter(database));

  // Dynamic XML Sitemaps & robots.txt (/sitemap.xml, /sitemaps/packages.xml, /sitemaps/classes.xml, /sitemaps/posts.xml, /robots.txt)
  app.use("/", sitemapsRouter(database));

  // AI Bot Markdown Mirrors & llms.txt (/posts/:id.md, /package/:name.md, /package/:name/classes/:className.md, /packages/llms.txt)
  app.use("/", markdownMirrorRouter(database));
  app.get("/static/embed.js", (req, res) => {
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
    const hostHeader = req.headers["x-forwarded-host"] || req.headers.host || "localhost:3000";
    const origin = `${String(protocol).split(",")[0]!.trim()}://${String(hostHeader).split(",")[0]!.trim()}`;
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(renderStandaloneEmbedBundle(origin));
  });
  app.get("/static/solutions/:slug/index.html", (req, res) => {
    const slug = String(req.params["slug"] || "simulink-linter");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderSolutionBundleHtml(slug));
  });
  app.get("/embed/solution/:slug", (req, res) => {
    const slug = String(req.params["slug"] || "simulink-linter");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderSolutionBundleHtml(slug));
  });

  app.use("/api/v1/fmus", optionalAuth, fmuRouter(fmuStorage));
  app.use("/git", gitServerRouter(database));
  app.use("/api/v1/git-server", gitServerRouter(database));
  app.use("/api/thumbnails", express.static(path.resolve(API_ROOT, "public/thumbnails")));
  app.use("/thumbnails", express.static(path.resolve(API_ROOT, "public/thumbnails")));
  app.use("/api/avatars", express.static(path.resolve(API_ROOT, "public/avatars")));
  app.use("/avatars", express.static(path.resolve(API_ROOT, "public/avatars")));
  app.use("/api/banners", express.static(path.resolve(API_ROOT, "public/banners")));
  app.use("/banners", express.static(path.resolve(API_ROOT, "public/banners")));
  app.use("/uploads", express.static(path.resolve(API_ROOT, "uploads")));

  if (!isProductionEnv || isExplicitDevOverride) {
    app.use("/static-examples", express.static(path.resolve(API_ROOT, "../../packages/examples")));
  }

  // ── RFC 9116 Security Disclosure (security.txt) ──
  const securityTxtHandler = (_req: express.Request, res: express.Response) => {
    res
      .type("text/plain")
      .send(
        [
          "Contact: mailto:security@modelscript.org",
          "Expires: 2027-12-31T23:59:59.000Z",
          "Encryption: https://modelscript.org/pgp-key.asc",
          "Acknowledgments: https://modelscript.org/security/hall-of-fame",
          "Preferred-Languages: en",
          "Canonical: https://modelscript.org/.well-known/security.txt",
          "Policy: https://modelscript.org/security-policy",
        ].join("\n") + "\n",
      );
  };
  app.get("/.well-known/security.txt", securityTxtHandler);
  app.get("/security.txt", securityTxtHandler);

  // ── Legal, Privacy & AGPLv3 § 13 Source Disclosure ──
  const legalHandler = (_req: express.Request, res: express.Response) => {
    const settings = database.getInstanceSettings();
    const brandName = settings.instanceName || "Ansatz";
    res.json({
      name: brandName,
      poweredBy: "ModelScript",
      edition: isEnterpriseEditionActive() ? "ee" : "ce",
      license: "AGPL-3.0-or-later",
      enterpriseLicense: "LicenseRef-ModelScript-Enterprise",
      termsOfService: "https://ansatz.social/terms",
      privacyPolicy: "https://ansatz.social/privacy",
      cookiesPolicy: "https://ansatz.social/cookies",
      exportPolicy: "https://ansatz.social/export-compliance",
      securityPolicy: "https://modelscript.org/.well-known/security.txt",
      sourceCode: "https://github.com/modelscript/modelscript",
      agplNotice:
        "In compliance with GNU AGPLv3 Section 13, users interacting with the open-core components of this instance over a network may obtain the Corresponding Source code at the sourceCode URL above. Enterprise Edition subsystems under ee/ are governed by LicenseRef-ModelScript-Enterprise.",
    });
  };
  app.get("/legal", legalHandler);
  app.get("/api/v1/compliance/policy", legalHandler);

  // Health check
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      edition: isEnterpriseEditionActive() ? "ee" : "ce",
      mqtt: mqttClient ? "connected" : "unavailable",
      historian: dbPool ? "connected" : "unavailable",
    });
  });

  // Unauthenticated readiness probe (available in both CE and EE)
  app.get("/health/ready", (_req, res) => {
    try {
      const dbOpen = database.isOpen();
      const migStatus = dbOpen
        ? database.migrationRunner.getStatus(allMigrations)
        : { currentVersion: null, pendingCount: 0, checksumMatch: false };
      const settings = dbOpen ? database.getInstanceSettings() : null;
      const isReady = dbOpen && migStatus.pendingCount === 0;
      res.status(dbOpen ? 200 : 503).json({
        status: isReady ? "ready" : dbOpen ? "degraded" : "unavailable",
        ready: isReady,
        edition: isEnterpriseEditionActive() ? "ee" : "ce",
        instanceName: settings?.instanceName || "Ansatz",
        federationMode: settings?.federationMode || "open",
        maintenanceLevel: settings?.maintenanceLevel || "off",
        database: {
          open: dbOpen,
          schemaVersion: migStatus.currentVersion,
          pendingMigrations: migStatus.pendingCount,
          checksumMatch: migStatus.checksumMatch,
        },
        mqtt: mqttClient ? "connected" : "unavailable",
        historian: dbPool ? "connected" : "unavailable",
        timestamp: new Date().toISOString(),
      });
    } catch (err: unknown) {
      res.status(503).json({
        status: "unavailable",
        ready: false,
        edition: isEnterpriseEditionActive() ? "ee" : "ce",
        error: err instanceof Error ? err.message : "Readiness check failed",
        timestamp: new Date().toISOString(),
      });
    }
  });

  // ── npm-compatible registry (mounted at /api/v1/npm) ──
  app.use("/api/v1/npm", npmAuthRouter(database));
  app.use("/api/v1/npm", npmRegistryRouter(database, libraryStorage));

  // ── Integrated VS Code Web IDE Workbench, Extensions, Models & User Languages ──
  app.use(ideWorkbenchRouter(database));

  // ── Enterprise Intranet Appliance & Unified Static Web, Docs & IDE Serving ──
  const staticWebDir =
    process.env["STATIC_WEB_DIR"] ||
    (process.env["ENTERPRISE_APPLIANCE"] === "true" ? path.resolve(API_ROOT, "../web/dist") : undefined);
  const staticIdeDir =
    process.env["STATIC_IDE_DIR"] ||
    (process.env["ENTERPRISE_APPLIANCE"] === "true" ? path.resolve(API_ROOT, "../ide/dist") : undefined);
  const staticDocsDir =
    process.env["STATIC_DOCS_DIR"] ||
    (process.env["ENTERPRISE_APPLIANCE"] === "true"
      ? path.resolve(API_ROOT, "../docs/docs/.vitepress/dist")
      : undefined);

  if (staticIdeDir && fs.existsSync(staticIdeDir)) {
    app.use("/ide", express.static(staticIdeDir));
  }

  if (staticDocsDir && fs.existsSync(staticDocsDir)) {
    const resolvedDocsRoot = path.resolve(staticDocsDir);
    app.use("/docs", express.static(resolvedDocsRoot, { extensions: ["html"] }));

    const docsPrefixes = [
      "/guide",
      "/architecture",
      "/algorithms",
      "/cli",
      "/languages",
      "/reference",
      "/industries",
      "/ansatz",
      "/pricing",
      "/trademark",
      "/llms.txt",
      "/llms-full.txt",
      "/sitemap.xml",
      "/hashmap.json",
      "/modelscript-reference-manual.pdf",
    ];

    app.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        next();
        return;
      }
      if (
        req.path === "/" &&
        (process.env["SERVE_DOCS_AT_ROOT"] === "true" || !staticWebDir || !fs.existsSync(staticWebDir))
      ) {
        const rootDocIndex = path.join(resolvedDocsRoot, "index.html");
        if (fs.existsSync(rootDocIndex)) {
          res.sendFile(rootDocIndex);
          return;
        }
      }
      const matchesDocRoute = docsPrefixes.some((p) => req.path === p || req.path.startsWith(p + "/"));
      const isDocAsset = req.path.startsWith("/assets/") || req.path.startsWith("/vp-icons/");
      if (!matchesDocRoute && !isDocAsset) {
        next();
        return;
      }

      const relReq = path
        .normalize(req.path)
        .replace(/^(\.\.[/\\])+/, "")
        .replace(/^[/\\]+/, "");
      const candidates = [
        path.resolve(resolvedDocsRoot, relReq),
        path.resolve(resolvedDocsRoot, `${relReq}.html`),
        path.resolve(resolvedDocsRoot, relReq, "index.html"),
      ];
      for (const candidate of candidates) {
        const rel = path.relative(resolvedDocsRoot, candidate);
        if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
          continue;
        }
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          res.sendFile(candidate);
          return;
        }
      }
      if (isDocAsset && (!staticWebDir || !fs.existsSync(staticWebDir))) {
        res.status(404).end();
        return;
      }
      next();
    });
  }

  // Block automated credential/dotfile/PHP scanner probes (/.env, /.git/config, /live/.env, /.env.swp, /wp-login.php)
  // on non-API/non-Git routes so they receive an immediate 404 rather than falling through to SPA index.html (200 OK).
  const blockedScannerProbePattern =
    /(?:^|\/)\.(?!well-known(?:\/|$))[^/]*|\.(?:php|asp|aspx|jsp|cgi|env|swp|swo|bak)(?:\/|$)|^\/(?:wp-admin|wp-login(?:\.php)?|wp-content|wp-includes|xmlrpc\.php|phpmyadmin|pma|adminer)(?:\/|$)/i;
  app.use((req, res, next) => {
    if (
      req.path.startsWith("/api/") ||
      req.path.startsWith("/git/") ||
      req.path.startsWith("/.well-known/") ||
      req.path.startsWith("/-/")
    ) {
      next();
      return;
    }
    let decodedPath = req.path;
    try {
      decodedPath = decodeURIComponent(req.path);
    } catch {
      res.status(400).json({ error: "Malformed request URI" });
      return;
    }
    if (blockedScannerProbePattern.test(decodedPath)) {
      res.status(404).end();
      return;
    }
    next();
  });

  if (staticWebDir && fs.existsSync(staticWebDir)) {
    app.use(express.static(staticWebDir, { dotfiles: "deny" }));

    // Client-side SPA routing fallback for unmatched non-API routes
    app.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        next();
        return;
      }
      if (
        req.path.startsWith("/assets/") ||
        req.path.startsWith("/vp-icons/") ||
        blockedScannerProbePattern.test(req.path)
      ) {
        res.status(404).end();
        return;
      }
      if (
        req.path.startsWith("/api") ||
        req.path.startsWith("/.well-known") ||
        req.path.startsWith("/git") ||
        req.path.startsWith("/thumbnails") ||
        req.path.startsWith("/avatars") ||
        req.path.startsWith("/banners") ||
        req.path.startsWith("/uploads") ||
        req.path.startsWith("/health") ||
        req.path.startsWith("/legal") ||
        req.path.startsWith("/projects") ||
        req.path.startsWith("/nodeinfo") ||
        req.path.startsWith("/actor") ||
        req.path.startsWith("/users/") ||
        req.path.startsWith("/vscode") ||
        req.path.startsWith("/static/") ||
        req.path.startsWith("/docs") ||
        req.path.startsWith("/-/") ||
        req.path.includes("/-/") ||
        (/^\/@[^/]+\/[^/]+(?:\/|$)/.test(req.path) && !/^\/@[^/]+\/(?:status|followers|following)\b/.test(req.path))
      ) {
        next();
        return;
      }
      const indexPath = path.join(staticWebDir, "index.html");
      if (fs.existsSync(indexPath)) {
        try {
          const rawHtml = fs.readFileSync(indexPath, "utf8");
          const meta = resolveSeoMetadata(req, database);
          const injectedHtml = injectSeoIntoHtml(rawHtml, meta);
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.send(injectedHtml);
        } catch {
          res.sendFile(indexPath);
        }
      } else {
        next();
      }
    });
  }

  // Dynamic SEO & OpenGraph HTML fallback for SPA routes (e.g. in test environments without staticWebDir)
  const defaultBaseHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Ansatz</title>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;

  if (!staticWebDir || !fs.existsSync(staticWebDir)) {
    app.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      if (!req.accepts("html")) return next();
      const safePath = req.path || "";
      if (
        /^\/(?:posts|p)\/\d+/.test(safePath) ||
        /^\/packages?\/(@[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+|[a-zA-Z0-9_.-]+)/.test(safePath) ||
        /^\/(?:@|u\/)[a-zA-Z0-9_.-]+/.test(safePath) ||
        safePath === "/" ||
        safePath === ""
      ) {
        try {
          const meta = resolveSeoMetadata(req, database);
          const injectedHtml = injectSeoIntoHtml(defaultBaseHtml, meta);
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.send(injectedHtml);
          return;
        } catch {
          // fall through
        }
      }
      next();
    });
  }

  // ── Root npm registry fallback (for legacy npm clients using registry root) ──
  app.use("/", npmAuthRouter(database));
  app.use("/", npmRegistryRouter(database, libraryStorage));

  return app;
}
