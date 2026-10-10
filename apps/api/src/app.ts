// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CosimMqttClient } from "@modelscript/exchange/cosim";
import bcrypt from "bcryptjs";
import express from "express";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

import { initializeArtifactSystem } from "./artifacts/index.js";
import { LibraryDatabase } from "./database.js";
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
}

export function createApp(options?: AppOptions | LibraryStorage): express.Express {
  const app = express();

  // Support legacy signature: createApp(storage?)
  const opts: AppOptions = options instanceof LibraryStorage ? { storage: options } : (options ?? {});

  const libraryStorage = opts.storage ?? new LibraryStorage();
  const jobQueue = opts.jobQueue ?? new JobQueue();
  app.locals.jobQueue = jobQueue;

  const database = opts.database ?? new LibraryDatabase();
  app.locals.database = database;
  const mqttClient = opts.mqttClient ?? null;
  const dbPool = opts.dbPool ?? null;

  const featureFlagService = new FeatureFlagService(database);
  app.locals.featureFlagService = featureFlagService;

  const federationWorker = new FederationWorker(database);
  if (featureFlagService.isEnabled("activitypub_federation")) {
    federationWorker.start();
  }
  app.locals.federationWorker = federationWorker;

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
    void seedInitialAdmin(database).catch((err) => {
      console.error("[AdminSeed] Failed to bootstrap admin:", err);
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
      app.post("/api/v1/dev/reset", async (req, res) => {
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
    app.locals.decayWorkerInterval = decayWorkerInterval;

    const runRssWorker = () => {
      import("./util/rss-worker.js")
        .then(({ processRssFeeds }) => {
          void processRssFeeds(database);
        })
        .catch(console.error);
    };

    runRssWorker();
    const rssWorkerInterval = setInterval(runRssWorker, 15 * 60 * 1000);
    app.locals.rssWorkerInterval = rssWorkerInterval;

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
    app.locals.logPurgeInterval = logPurgeInterval;
  }

  // Increased limit for npm publish payloads (base64-encoded tarballs in JSON body)
  app.use(
    express.json({
      limit: "50mb",
      verify: (req, _res, buf) => {
        (req as any).rawBody = buf;
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
          cookies[key] = decodeURIComponent(val);
        }
      }
    }
    (req as any).cookies = cookies;
    next();
  });

  // Rate Limiting
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200, // Limit each IP to 200 requests per `window`
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please try again later." },
  });
  if (process.env["NODE_ENV"] === "production") {
    app.use(limiter);
  }

  // CORS & Security Defensive Headers (OWASP, SOC 2, ISO 27001, GDPR Art. 32)
  app.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.header("X-Content-Type-Options", "nosniff");
    res.header("X-Frame-Options", "SAMEORIGIN");
    res.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
    res.header("Referrer-Policy", "strict-origin-when-cross-origin");
    res.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (_req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Feature flags endpoint (evaluated for requesting user)
  app.get("/api/v1/flags", optionalAuth, (req, res) => {
    res.json(featureFlagService.getAllFlagsForUser((req as any).user));
  });

  // Auth routes
  app.use("/api/v1/auth", authRouter(database));
  app.use("/api/v1/users", usersRouter(database, federationWorker));
  app.use("/api/v1/organizations", organizationsRouter(database));
  app.use("/api/v1/social", socialRouter(database, federationWorker));
  app.use("/api/v1/repos", reposRouter(database));
  app.use("/api/v1/webhooks", webhooksRouter(database, jobQueue, libraryStorage));
  app.use("/api/v1/search", searchRouter(database));
  app.use("/api/v1/storage", storageRouter());
  app.use("/api/v1", adminRouter(database, federationWorker, featureFlagService));
  app.use("/", federationRouter(database, federationWorker));

  // Mount the library routers
  app.use("/api/v1/libraries", packagesRouter(libraryStorage, jobQueue, database));
  app.use("/api/v1/libraries", publishRouter(libraryStorage, jobQueue, database, federationWorker));
  app.use("/api/v1/libraries", rdfRouter(database));
  app.use("/api/v1/libraries", graphqlRouter(database));
  app.use(
    "/api/v1/libraries/sparql",
    optionalAuth,
    requireFeatureFlag(() => featureFlagService, "sparql_rdf_endpoints"),
    sparqlRouter(database),
  );
  app.use("/api/v1", simulateRouter(libraryStorage, jobQueue, database));
  app.use("/api/v1", physicsRouter(jobQueue, database));

  // Gated HPC / CAE Compute routes
  app.use(
    "/api/v1/cae",
    optionalAuth,
    requireFeatureFlag(() => featureFlagService, "cae_cloud_solver"),
  );
  app.use("/api/v1", caeRouter(jobQueue, database));

  app.use(
    "/api/v1/cloud",
    optionalAuth,
    requireFeatureFlag(() => featureFlagService, "cae_cloud_solver"),
  );
  app.use("/api/v1", cloudRouter(libraryStorage, jobQueue, database));

  // Gated Billing route
  app.use(
    "/api/v1/billing",
    optionalAuth,
    requireFeatureFlag(() => featureFlagService, "billing_stripe_live"),
  );
  app.use("/api/v1", billingRouter(database));

  // Gated MCP SSE gateway
  app.use(
    "/api/v1/mcp",
    optionalAuth,
    requireFeatureFlag(() => featureFlagService, "mcp_gateway_sse"),
  );
  app.use("/api/v1", mcpRouter(database));

  app.use("/api/v1/jobs", scriptsRouter(database));

  // Artifact viewer routes (query artifact metadata, viewer configs)
  app.use("/api/v1", artifactViewerRouter(database));

  // Digital Thread Hypergraph Explorer routes
  app.use(
    "/api/v1/threads",
    optionalAuth,
    requireFeatureFlag(() => featureFlagService, "digital_thread_explorer"),
    threadRouter(undefined, database),
  );

  // Co-simulation routes (with MQTT client injection)
  app.use(
    "/api/v1/cosim",
    optionalAuth,
    requireFeatureFlag(() => featureFlagService, "cosim_mqtt"),
    cosimRouter(mqttClient),
  );
  app.use(
    "/api/v1/mqtt/participants",
    optionalAuth,
    requireFeatureFlag(() => featureFlagService, "cosim_mqtt"),
    mqttParticipantsRouter(mqttClient),
  );
  app.use(
    "/api/v1/historian",
    optionalAuth,
    requireFeatureFlag(() => featureFlagService, "cosim_mqtt"),
    historianRouter(dbPool, mqttClient),
  );
  app.use(
    "/api/v1/instances",
    optionalAuth,
    requireFeatureFlag(() => featureFlagService, "digital_twins"),
    instancesRouter(database, dbPool),
  );
  app.use(
    "/api/v1/twins",
    optionalAuth,
    requireFeatureFlag(() => featureFlagService, "digital_twins"),
    twinsRouter(database),
  );
  app.use("/api/v1/fmus", fmuRouter());
  app.use("/api/v1/git", gitRouter());
  app.use("/api/v1/gitlab", gitRouter()); // Keep for backwards compatibility
  app.use("/git", gitServerRouter(database));
  app.use("/api/v1/git-server", gitServerRouter(database));
  app.use("/api/thumbnails", express.static(path.resolve(API_ROOT, "public/thumbnails")));
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
      license: "AGPL-3.0-or-later",
      termsOfService: "https://modelscript.org/terms",
      privacyPolicy: "https://modelscript.org/privacy",
      exportPolicy: "https://modelscript.org/export-compliance",
      securityPolicy: "https://modelscript.org/.well-known/security.txt",
      sourceCode: "https://github.com/modelscript/modelscript",
      agplNotice:
        "In compliance with GNU AGPLv3 Section 13, users interacting with this instance over a network may obtain the complete Corresponding Source code at the sourceCode URL above.",
    });
  };
  app.get("/legal", legalHandler);
  app.get("/api/v1/compliance/policy", legalHandler);

  // ── Compliance & Trust Readiness Probe ──
  app.get("/api/v1/compliance/readiness", (_req: express.Request, res: express.Response) => {
    const isProd = process.env["NODE_ENV"] === "production";
    const envJwt = process.env["JWT_SECRET"];
    const jwtOk = Boolean(envJwt && envJwt !== "modelscript-dev-secret");
    const turnstileOk = Boolean(process.env["TURNSTILE_SECRET_KEY"]);
    const hasAdmin = database.hasAdminUser();
    const geoIpLoaded = locationService.isReady();

    const isDegraded = isProd && (!jwtOk || !turnstileOk || !hasAdmin);

    res.status(isDegraded ? 503 : 200).json({
      timestamp: new Date().toISOString(),
      status: isDegraded ? "degraded" : "ready",
      environment: process.env["NODE_ENV"] || "development",
      checks: {
        exportControls: {
          status: "enforced",
          sanctionedCountriesCount: SANCTIONED_COUNTRIES.size,
          sanctionedRegionsCount: SANCTIONED_REGIONS.size,
          policy: "Overcompliance (24 countries + 5 occupied Ukrainian regions)",
        },
        secrets: {
          jwtSecretConfigured: Boolean(envJwt),
          jwtSecretIsSecure: jwtOk,
          turnstileConfigured: turnstileOk,
        },
        services: {
          geolocation: {
            dbLoaded: geoIpLoaded,
            fallbackPrefixesActive: true,
          },
          mailer: {
            driver: defaultMailer.getDriver(),
          },
          database: {
            connected: Boolean(database && database.isOpen()),
            hasAdminUser: hasAdmin,
          },
        },
        regulations: {
          ofacEarItar: "active",
          gdprArticle17Erasure: "active",
          gdprArticle20Portability: "active",
          rfc9116SecurityTxt: "active",
          agplv3Section13: "active",
        },
      },
    });
  });

  // Health check
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      mqtt: mqttClient ? "connected" : "unavailable",
      historian: dbPool ? "connected" : "unavailable",
    });
  });

  // ── OMG Systems Modeling REST API (SysML v2 - ptc/2024-02-03) ──
  const omgRouter = sysml2OmgRouter(new SysML2OmgService(database));
  app.use(
    "/api/v1/sysml2",
    optionalAuth,
    requireFeatureFlag(() => featureFlagService, "sysml2_omg_api"),
    omgRouter,
  );
  app.use(
    "/",
    optionalAuth,
    requireFeatureFlag(() => featureFlagService, "sysml2_omg_api"),
    omgRouter,
  ); // Root drop-in alias for external SysML v2 clients (e.g., py-sysml2)

  // ── npm-compatible registry (mounted at root for `npm --registry=` compat) ──
  app.use("/", npmAuthRouter(database));
  app.use("/", npmRegistryRouter(database));

  return app;
}
