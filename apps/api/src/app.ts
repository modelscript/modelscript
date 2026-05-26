// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CosimMqttClient } from "@modelscript/cosim";
import bcrypt from "bcryptjs";
import express from "express";
import rateLimit from "express-rate-limit";
import path from "node:path";
import type { Pool } from "pg";

import { initializeArtifactSystem } from "./artifacts/index.js";
import { LibraryDatabase } from "./database.js";
import { JobQueue } from "./jobs.js";
import { setAuthDatabase } from "./middleware/auth-middleware.js";
import { artifactViewerRouter } from "./routes/artifact-viewer.js";
import { authRouter } from "./routes/auth.js";
import { cosimRouter, mqttParticipantsRouter } from "./routes/cosim.js";
import { federationRouter } from "./routes/federation.js";
import { fmuRouter } from "./routes/fmu.js";
import { gitlabRouter } from "./routes/gitlab.js";
import { graphqlRouter } from "./routes/graphql.js";
import { historianRouter } from "./routes/historian.js";
import { npmAuthRouter } from "./routes/npm-auth.js";
import { npmRegistryRouter } from "./routes/npm-registry.js";
import { packagesRouter } from "./routes/packages.js";
import { publishRouter } from "./routes/publish.js";
import { rdfRouter } from "./routes/rdf.js";
import { reposRouter } from "./routes/repos.js";
import { searchRouter } from "./routes/search.js";
import { simulateRouter } from "./routes/simulate.js";
import { socialRouter } from "./routes/social.js";
import { sparqlRouter } from "./routes/sparql.js";
import { storageRouter } from "./routes/storage.js";
import { usersRouter } from "./routes/users.js";
import { LibraryStorage } from "./storage.js";
import { seedExamplePackages } from "./util/seed-examples.js";

/** Options for creating the Express application. */
export interface AppOptions {
  /** Optional library storage override. */
  storage?: LibraryStorage | undefined;
  /** MQTT client for co-simulation (null = no MQTT). */
  mqttClient?: CosimMqttClient | null | undefined;
  /** PostgreSQL pool for historian queries (null = stubs). */
  dbPool?: Pool | null | undefined;
}

export function createApp(options?: AppOptions | LibraryStorage): express.Express {
  const app = express();

  // Support legacy signature: createApp(storage?)
  const opts: AppOptions =
    options && "storage" in options ? (options as AppOptions) : { storage: options as LibraryStorage | undefined };

  const libraryStorage = opts.storage ?? new LibraryStorage();
  const jobQueue = new JobQueue();
  const database = new LibraryDatabase();
  const mqttClient = opts.mqttClient ?? null;
  const dbPool = opts.dbPool ?? null;

  setAuthDatabase(database);

  // Initialize the extensible artifact system (FMU, Dataset, etc.)
  initializeArtifactSystem();

  if (process.env["NODE_ENV"] !== "production" || process.env["SEED_EXAMPLES"] === "true") {
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

    // Run asynchronously in the background
    void seedExamplePackages(libraryStorage, database, jobQueue).catch((err) => {
      console.error("[DevServer] Failed to seed example packages:", err);
    });

    app.post("/api/v1/dev/reset", async (req, res) => {
      console.log("[DevServer] Resetting database and re-seeding...");
      try {
        database.resetDevData();
        for (const u of devUsers) {
          if (!database.getUserByUsername(u.username)) {
            const hash = bcrypt.hashSync("password", 10);
            const { id } = database.createUser(u.username, u.email, hash);
            database.updateProfile(id, { location: u.location });
          }
        }

        // Seed some dummy posts
        const devUser = database.getUserByUsername("dev");
        const alice = database.getUserByUsername("alice");
        if (devUser && alice) {
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
        }

        await seedExamplePackages(libraryStorage, database, jobQueue);
        res.json({ success: true });
      } catch (err) {
        console.error("[DevServer] Failed to reset dev data:", err);
        res.status(500).json({ success: false, error: String(err) });
      }
    });
  }

  // ── Trending Topics Periodic Worker ──
  // Run every 15 minutes (900,000 ms)
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

  // ── RSS Worker ──
  // Run immediately on startup, then every 15 minutes
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

  // Increased limit for npm publish payloads (base64-encoded tarballs in JSON body)
  app.use(express.json({ limit: "50mb" }));

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

  // CORS — allow all origins (VS Code webviews, Morsel, etc.)
  app.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (_req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Auth routes
  app.use("/api/v1/auth", authRouter(database));
  app.use("/api/v1/users", usersRouter(database));
  app.use("/api/v1/social", socialRouter(database));
  app.use("/api/v1/repos", reposRouter(database));
  app.use("/api/v1/search", searchRouter(database));
  app.use("/api/v1/storage", storageRouter());
  app.use("/", federationRouter(database));

  // Mount the library routers
  app.use("/api/v1/libraries", packagesRouter(libraryStorage, jobQueue, database));
  app.use("/api/v1/libraries", publishRouter(libraryStorage, jobQueue, database));
  app.use("/api/v1/libraries", rdfRouter(database));
  app.use("/api/v1/libraries", graphqlRouter(database));
  app.use("/api/v1/libraries", sparqlRouter(database));
  app.use("/api/v1", simulateRouter(libraryStorage, jobQueue));

  // Artifact viewer routes (query artifact metadata, viewer configs)
  app.use("/api/v1", artifactViewerRouter(database));

  // Co-simulation routes (with MQTT client injection)
  app.use("/api/v1/cosim", cosimRouter(mqttClient));
  app.use("/api/v1/mqtt/participants", mqttParticipantsRouter(mqttClient));
  app.use("/api/v1/historian", historianRouter(dbPool, mqttClient));
  app.use("/api/v1/fmus", fmuRouter());
  app.use("/api/v1/gitlab", gitlabRouter());

  if (process.env["NODE_ENV"] !== "production" || process.env["SEED_EXAMPLES"] === "true") {
    app.use("/static-examples", express.static(path.resolve(process.cwd(), "../../packages/examples")));
  }

  // ── npm-compatible registry (mounted at root for `npm --registry=` compat) ──
  app.use("/", npmAuthRouter(database));
  app.use("/", npmRegistryRouter(database));

  // Health check
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      mqtt: mqttClient ? "connected" : "unavailable",
      historian: dbPool ? "connected" : "unavailable",
    });
  });

  return app;
}
