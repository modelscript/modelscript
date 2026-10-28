// SPDX-License-Identifier: AGPL-3.0-or-later

import { FmuStorage, type CosimMqttClient, type HistorianRecorder } from "@modelscript/exchange/cosim";
import bcrypt from "bcryptjs";
import express from "express";
import rateLimit from "express-rate-limit";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
import { requireFeatureFlag } from "./middleware/feature-flag-middleware.js";
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
import { instancesRouter } from "./routes/instances.js";
import { mcpRouter } from "./routes/mcp.js";
import { npmAuthRouter } from "./routes/npm-auth.js";
import { npmRegistryRouter } from "./routes/npm-registry.js";
import { oembedRouter, renderStandaloneEmbedBundle } from "./routes/oembed.js";
import { organizationsRouter } from "./routes/organizations.js";
import { packagesRouter } from "./routes/packages.js";
import { physicsRouter } from "./routes/physics.js";
import { publishRouter } from "./routes/publish.js";
import { rdfRouter } from "./routes/rdf.js";
import { reposRouter } from "./routes/repos.js";
import { scriptsRouter } from "./routes/scripts.js";
import { searchRouter } from "./routes/search.js";
import { simulateRouter } from "./routes/simulate.js";
import { socialRouter } from "./routes/social.js";
import { solutionsRouter } from "./routes/solutions.js";
import { sparqlRouter } from "./routes/sparql.js";
import { storageRouter } from "./routes/storage.js";
import { sysml2OmgRouter } from "./routes/sysml2-omg.js";
import { threadRouter } from "./routes/thread.js";
import { twinsRouter } from "./routes/twins.js";
import { usersRouter } from "./routes/users.js";
import { webhooksRouter } from "./routes/webhooks.js";
import { seedCadAssembly } from "./seed-cad-assembly.js";
import { seedCfdAnimation } from "./seed-cfd-animation.js";
import { seedDroneCfd } from "./seed-drone-cfd.js";
import { seedDroneFea } from "./seed-drone-fea.js";
import { seedScriptsAndTemplates } from "./seed-scripts.js";
import { defaultArchiveQueue } from "./services/archive-queue.js";
import { FeatureFlagService } from "./services/feature-flag-service.js";
import { FederationWorker } from "./services/federation-worker.js";
import { locationService } from "./services/location.js";
import { defaultMailer } from "./services/mailer.js";
import { SysML2OmgService } from "./services/sysml2-omg-service.js";
import { LibraryStorage } from "./storage.js";
import { SANCTIONED_COUNTRIES, SANCTIONED_REGIONS } from "./util/compliance.js";
import { seedInitialAdmin } from "./util/seed-admin.js";
import { seedExamplePackages, seedPrepackagedLibraries } from "./util/seed-examples.js";

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

  const isStartupAirgap = process.env["AIRGAP_ENFORCED"] === "true" || process.env["ENTERPRISE_APPLIANCE"] === "true";

  const federationWorker = new FederationWorker(database);
  if (!isStartupAirgap && featureFlagService.isEnabled("activitypub_federation")) {
    federationWorker.start();
  }
  app.locals["federationWorker"] = federationWorker;

  setAuthDatabase(database);

  // Initialize the extensible artifact system (FMU, Dataset, etc.)
  initializeArtifactSystem();

  // Initialize LocationService
  void locationService.init().catch((err) => {
    console.error("[LocationService] Error during init:", err);
  });

  // Seed initial admin if specified via env vars or if running in non-test mode and no admin exists
  if (
    process.env["ADMIN_INIT_USERNAME"] ||
    process.env["ADMIN_INIT_PASSWORD"] ||
    process.env["NODE_ENV"] === "production"
  ) {
    void seedInitialAdmin(database)
      .then((res) => {
        if (res.created) {
          console.log(`[AdminSeed] Bootstrapped initial admin account '${res.username}'.`);
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

  // Pre-seed bundled standard libraries (MSL, SysML v2 KerML) in airgapped production appliances
  if (isStartupAirgap && process.env["NODE_ENV"] === "production" && process.env["SEED_STDLIB_ON_BOOT"] !== "false") {
    void seedPrepackagedLibraries(libraryStorage, database, jobQueue).catch((err) => {
      console.error("[AirgapSeed] Failed to pre-seed bundled standard libraries:", err);
    });
  }

  const isNpmDev =
    process.env["SEED_POSTS"] === "true" ||
    process.env["npm_lifecycle_event"] === "dev" ||
    process.env["npm_lifecycle_event"] === "dev:api";

  if (
    (process.env["NODE_ENV"] !== "production" && process.env["NODE_ENV"] !== "test") ||
    process.env["SEED_EXAMPLES"] === "true"
  ) {
    console.log("[DevServer] Development mode detected. Running auto-seeding...");

    // Seed dev users
    const devUsers = [
      { username: "dev", email: "dev@modelscript.org", location: "Syria" },
      { username: "alice", email: "alice@modelscript.org", location: "United States" },
      { username: "bob", email: "bob@modelscript.org", location: "China" },
    ];
    for (const u of devUsers) {
      if (!database.getUserByUsername(u.username)) {
        const hash = bcrypt.hashSync("password", 10);
        const { id } = database.createUser(u.username, u.email, hash);
        database.updateProfile(id, { location: u.location });
      }
    }

    // Post seeding is strictly disabled for everything except when running npm run dev
    if (isNpmDev) {
      console.log("[DevServer] npm run dev detected: seeding example posts...");
      seedDroneFea(database);
      seedCadAssembly(database);
      seedDroneCfd(database);
      seedCfdAnimation(database).catch(console.error);
    } else {
      console.log("[DevServer] Post seeding skipped (only enabled during npm run dev).");
    }

    seedScriptsAndTemplates(database);

    // Run asynchronously in the background
    void seedExamplePackages(libraryStorage, database, jobQueue).catch((err) => {
      console.error("[DevServer] Failed to seed example packages:", err);
    });
    void seedPrepackagedLibraries(libraryStorage, database, jobQueue).catch((err) => {
      console.error("[DevServer] Failed to seed prepackaged libraries:", err);
    });

    if (process.env["NODE_ENV"] !== "production") {
      app.post("/api/v1/dev/reset", async (_req, res) => {
        console.log("[DevServer] Resetting database and re-seeding...");
        try {
          jobQueue.clear();
          database.resetDevData();
          for (const u of devUsers) {
            if (!database.getUserByUsername(u.username)) {
              const hash = bcrypt.hashSync("password", 10);
              const { id } = database.createUser(u.username, u.email, hash);
              database.updateProfile(id, { location: u.location });
            }
          }

          // Seed some dummy posts (only when running npm run dev)
          const devUser = database.getUserByUsername("dev");
          const alice = database.getUserByUsername("alice");
          if (devUser && alice && isNpmDev) {
            const devPost = database.createPost(
              devUser.id,
              "Welcome to the new ModelScript social platform! We're excited to see what you build. #welcome",
            );
            database.createPost(alice.id, "Just testing out the new federated features. Very smooth so far! 🚀");
            database.createPost(
              devUser.id,
              "Has anyone played with the new Modelica parser yet? The AST is looking really clean.",
              undefined,
              devPost.id,
            );

            const cadViewId = database.createArtifactView(
              alice.id,
              "cad_step",
              "url",
              JSON.stringify({ url: "http://localhost:3000/static-examples/drone-chassis/cad/drone.step" }),
              "Drone Chassis CAD Model",
            );

            database.createPost(
              alice.id,
              "Just finished the initial 3D design for the drone chassis! The STEP file is attached below. Let me know what you think of the rotor placement. 🚁 #cad",
              cadViewId,
            );

            // Vega-Lite trajectory plot
            const vegaSpec = {
              $schema: "https://vega.github.io/schema/vega-lite/v5.json",
              description: "Simulation Trajectory of a Pendulum",
              mark: "line",
              encoding: {
                x: { field: "time", type: "quantitative", title: "Time (s)" },
                y: { field: "angle", type: "quantitative", title: "Angle (rad)" },
              },
            };
            const vegaData = [
              { time: 0, angle: 0.5 },
              { time: 0.1, angle: 0.48 },
              { time: 0.2, angle: 0.42 },
              { time: 0.3, angle: 0.34 },
              { time: 0.4, angle: 0.24 },
              { time: 0.5, angle: 0.12 },
              { time: 0.6, angle: 0 },
              { time: 0.7, angle: -0.12 },
              { time: 0.8, angle: -0.24 },
              { time: 0.9, angle: -0.34 },
              { time: 1.0, angle: -0.42 },
            ];

            const vegaViewId = database.createArtifactView(
              devUser.id,
              "vega-plot",
              "inline",
              JSON.stringify({ spec: vegaSpec, data: vegaData }),
              "Pendulum Simulation Trajectory",
            );
            database.createPost(
              devUser.id,
              "Here is the simulation trajectory for the pendulum model over 1 second. Vega-Lite makes it so easy to visualize this! 📉",
              vegaViewId,
            );

            // Mermaid diagram
            const mermaidCode = `
graph TD
    A[Start] --> B{Is it working?}
    B -- Yes --> C[Great!]
    B -- No --> D[Debug]
    D --> B
`;
            const mermaidViewId = database.createArtifactView(
              devUser.id,
              "mermaid-diagram",
              "inline",
              JSON.stringify({ code: mermaidCode }),
              "Flowchart Diagram",
            );
            database.createPost(
              devUser.id,
              "I've also mapped out the debugging process using a Mermaid diagram. What do you think? 🧜‍♀️",
              mermaidViewId,
            );

            // PDF Document
            const pdfViewId = database.createArtifactView(
              devUser.id,
              "pdf",
              "inline",
              JSON.stringify({ url: "http://localhost:3000/static-examples/drone-chassis/docs/drone-manual.pdf" }),
              "Dummy PDF Document",
            );
            database.createPost(
              devUser.id,
              "Just reading through this interesting document. The PDF viewer embeds it perfectly! 📄",
              pdfViewId,
            );

            // CSV Table
            const csvData = `Name,Age,Role,Score\nAlice,28,Engineer,95\nBob,34,Designer,88\nCharlie,22,Intern,91`;
            const csvViewId = database.createArtifactView(
              devUser.id,
              "csv",
              "inline",
              JSON.stringify({ data: csvData }),
              "Team Statistics",
            );
            database.createPost(
              devUser.id,
              "Check out these team statistics! The CSV table viewer renders the data cleanly. 📊",
              csvViewId,
            );

            // GCode Toolpath
            const gcodeViewId = database.createArtifactView(
              alice.id,
              "gcode",
              "upload",
              JSON.stringify({
                url: "https://raw.githubusercontent.com/mrdoob/three.js/master/examples/models/gcode/benchy.gcode",
                thumbnail_url:
                  "https://images.unsplash.com/photo-1620917670359-4781498b0ed1?auto=format&fit=crop&q=80&w=600",
              }),
              "3DBenchy Toolpath",
            );
            database.createPost(
              alice.id,
              "Check out the sliced GCode for the 3DBenchy benchmark test. Ready for the machine!",
              gcodeViewId,
            );

            // Engineering Solution Post (Simulink Pre-Flight Linter)
            const solutionViewId = database.createArtifactView(
              devUser.id,
              "solution",
              "inline",
              JSON.stringify({
                author: devUser.username,
                slug: "simulink-linter",
                name: "Simulink Pre-Flight Linter",
                version: "1.0.0",
                description:
                  "Pre-flight static analyzer detecting algebraic loops, unconnected ports, and sample-time conflicts in Simulink models.",
                category: "Control Systems & Aeronautics",
                supported_formats: [".slx", ".mdl"],
                bundle_url: "https://cdn.modelscript.org/solutions/simulink-linter/index.html",
                tauri_windows_url:
                  "https://github.com/modelscript/simulink-linter/releases/download/v1.0.0/simulink-linter-x64.exe",
                tauri_linux_url:
                  "https://github.com/modelscript/simulink-linter/releases/download/v1.0.0/simulink-linter.AppImage",
                tauri_darwin_url:
                  "https://github.com/modelscript/simulink-linter/releases/download/v1.0.0/simulink-linter.dmg",
              }),
              "Simulink Pre-Flight Linter Solution",
            );
            database.createPost(
              devUser.id,
              "🚀 Just released the Simulink Pre-Flight Linter app! You can test it live in the post below or download the standalone offline Windows binary. #simulink #verification",
              solutionViewId,
            );

            // FEA Simulation
            if (isNpmDev) {
              seedDroneFea(database);
              seedCadAssembly(database);
              seedDroneCfd(database);
              await seedCfdAnimation(database);
            }
            seedScriptsAndTemplates(database);
          }

          await seedExamplePackages(libraryStorage, database, jobQueue);
          await seedPrepackagedLibraries(libraryStorage, database, jobQueue);
          res.json({ success: true });
        } catch (err) {
          console.error("[DevServer] Failed to reset dev data:", err);
          res.status(500).json({ success: false, error: String(err) });
        }
      });
    }
  }

  // ── Periodic Workers (disabled in test environment) ──
  if (process.env["NODE_ENV"] !== "test") {
    const decayWorkerInterval = setInterval(
      () => {
        try {
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

    // Automated Social Bot Mention Worker (Polls pending @bot mentions and synthesizes LLM responses)
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

  // Increased limit for npm publish payloads (base64-encoded tarballs in JSON body)
  app.use(
    express.json({
      limit: "50mb",
      verify: (req: express.Request, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  // Cookie parser middleware (HttpOnly session cookies)
  app.use((req, _res, next) => {
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

  // Rate Limiting
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: Number(process.env["RATE_LIMIT_MAX"]) || 1000, // Per-IP budget suitable for SPA + API polling
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) =>
      req.path === "/health" ||
      req.path.startsWith("/thumbnails") ||
      req.path.startsWith("/api/thumbnails") ||
      req.path.startsWith("/uploads"),
    message: { error: "Too many requests, please try again later." },
  });
  if (process.env["NODE_ENV"] === "production") {
    app.use(limiter);
  }

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
      req.path === "/static/embed.js" ||
      req.path === "/api/v1/embed.js";
    const isPublicFederationPath =
      isEmbedRoute ||
      req.path.startsWith("/.well-known/") ||
      req.path.startsWith("/nodeinfo/") ||
      req.path.startsWith("/actor") ||
      req.path.startsWith("/users/");

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
    }

    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Enterprise Edition (ee/) Air-Gap Security Headers
  app.use(createOptionalEnterpriseHeadersMiddleware());

  // Feature flags endpoint (evaluated for requesting user)
  app.get("/api/v1/flags", optionalAuth, (req, res) => {
    const reqWithUser = req as typeof req & {
      user?: Parameters<typeof featureFlagService.getAllFlagsForUser>[0];
    };
    res.json(featureFlagService.getAllFlagsForUser(reqWithUser.user));
  });

  // Auth & Community routes
  app.use("/api/v1/auth", authRouter(database));
  app.use("/api/v1/users", usersRouter(database, federationWorker));
  app.use("/api/v1/solutions", solutionsRouter(database));
  app.use("/api/v1/social", socialRouter(database, federationWorker));

  // FMU storage & open-standard FMU registry routes
  const fmuStorage = new FmuStorage();

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
        caeFeatureGuard: requireFeatureFlag(() => featureFlagService, "cae_cloud_solver"),
        billingFeatureGuard: requireFeatureFlag(() => featureFlagService, "billing_stripe_live"),
        caeRouter: caeRouter(jobQueue, database),
        cloudRouter: cloudRouter(libraryStorage, jobQueue, database),
        billingRouter: billingRouter(database),
      },
      twins: {
        optionalAuthMiddleware: optionalAuth,
        cosimFeatureGuard: requireFeatureFlag(() => featureFlagService, "cosim_mqtt"),
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
        gitRouter: gitRouter(),
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

  // Mount the library routers
  app.use("/api/v1/libraries", packagesRouter(libraryStorage, jobQueue, database));
  app.use("/api/v1/libraries", publishRouter(libraryStorage, jobQueue, database, federationWorker));
  app.use("/api/v1/libraries", rdfRouter(database));
  app.use("/api/v1/libraries", graphqlRouter(database));
  app.use("/api/v1", optionalAuth, simulateRouter(libraryStorage, jobQueue, database));
  app.use("/api/v1", optionalAuth, physicsRouter(jobQueue, database));

  app.use("/api/v1/jobs", scriptsRouter(database));

  // Artifact viewer routes (query artifact metadata, viewer configs)
  app.use("/api/v1", artifactViewerRouter(database));

  // Universal oEmbed provider route (/api/v1/oembed) & standalone intranet SDK bundle (/static/embed.js)
  app.use("/api/v1", oembedRouter(database));
  app.get("/static/embed.js", (req, res) => {
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
    const hostHeader = req.headers["x-forwarded-host"] || req.headers.host || "localhost:3000";
    const origin = `${String(protocol).split(",")[0]!.trim()}://${String(hostHeader).split(",")[0]!.trim()}`;
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(renderStandaloneEmbedBundle(origin));
  });

  app.use("/api/v1/fmus", optionalAuth, fmuRouter(fmuStorage));
  app.use("/git", gitServerRouter(database));
  app.use("/api/v1/git-server", gitServerRouter(database));
  app.use("/api/thumbnails", express.static(path.resolve(API_ROOT, "public/thumbnails")));
  app.use("/thumbnails", express.static(path.resolve(API_ROOT, "public/thumbnails")));
  app.use("/uploads", express.static(path.resolve(API_ROOT, "uploads")));

  if (process.env["NODE_ENV"] !== "production" || process.env["SEED_EXAMPLES"] === "true") {
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
    res.json({
      name: "ModelScript Cloud",
      edition: isEnterpriseEditionActive() ? "ee" : "ce",
      license: "AGPL-3.0-or-later",
      enterpriseLicense: "LicenseRef-ModelScript-Enterprise",
      termsOfService: "https://modelscript.org/terms",
      privacyPolicy: "https://modelscript.org/privacy",
      exportPolicy: "https://modelscript.org/export-compliance",
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

  // ── npm-compatible registry (mounted at /api/v1/npm) ──
  app.use("/api/v1/npm", npmAuthRouter(database));
  app.use("/api/v1/npm", npmRegistryRouter(database, libraryStorage));

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
      "/pricing",
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
      const matchesDocRoute = docsPrefixes.some((p) => req.path === p || req.path.startsWith(p + "/"));
      const isDocAsset = req.path.startsWith("/assets/") || req.path.startsWith("/vp-icons/");
      if (!matchesDocRoute && !isDocAsset) {
        next();
        return;
      }

      const relReq = req.path.replace(/^\/+/, "");
      const candidates = [
        path.resolve(resolvedDocsRoot, relReq),
        path.resolve(resolvedDocsRoot, `${relReq}.html`),
        path.resolve(resolvedDocsRoot, relReq, "index.html"),
      ];
      for (const candidate of candidates) {
        if (
          (candidate === resolvedDocsRoot || candidate.startsWith(resolvedDocsRoot + path.sep)) &&
          fs.existsSync(candidate) &&
          fs.statSync(candidate).isFile()
        ) {
          res.sendFile(candidate);
          return;
        }
      }
      next();
    });
  }

  if (staticWebDir && fs.existsSync(staticWebDir)) {
    app.use(express.static(staticWebDir));

    // Client-side SPA routing fallback for unmatched non-API routes
    app.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        next();
        return;
      }
      if (
        req.path.startsWith("/api") ||
        req.path.startsWith("/.well-known") ||
        req.path.startsWith("/git") ||
        req.path.startsWith("/thumbnails") ||
        req.path.startsWith("/uploads") ||
        req.path.startsWith("/health") ||
        req.path.startsWith("/legal") ||
        req.path.startsWith("/projects") ||
        req.path.startsWith("/nodeinfo") ||
        req.path.startsWith("/actor") ||
        req.path.startsWith("/users/") ||
        req.path.startsWith("/ide") ||
        req.path.startsWith("/docs") ||
        req.path.startsWith("/-/") ||
        req.path.includes("/-/") ||
        req.path.startsWith("/@")
      ) {
        next();
        return;
      }
      const indexPath = path.join(staticWebDir, "index.html");
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        next();
      }
    });
  }

  // ── Root npm registry fallback (for legacy npm clients using registry root) ──
  app.use("/", npmAuthRouter(database));
  app.use("/", npmRegistryRouter(database, libraryStorage));

  return app;
}
