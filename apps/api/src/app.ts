// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CosimMqttClient } from "@modelscript/cosim";
import express from "express";
import rateLimit from "express-rate-limit";
import type { Pool } from "pg";

import { initializeArtifactSystem } from "./artifacts/index.js";
import { LibraryDatabase } from "./database.js";
import { JobQueue } from "./jobs.js";
import { artifactViewerRouter } from "./routes/artifact-viewer.js";
import { authRouter } from "./routes/auth.js";
import { cosimRouter, mqttParticipantsRouter } from "./routes/cosim.js";
import { fmuRouter } from "./routes/fmu.js";
import { gitlabRouter } from "./routes/gitlab.js";
import { graphqlRouter } from "./routes/graphql.js";
import { historianRouter } from "./routes/historian.js";
import { npmAuthRouter } from "./routes/npm-auth.js";
import { npmRegistryRouter } from "./routes/npm-registry.js";
import { packagesRouter } from "./routes/packages.js";
import { publishRouter } from "./routes/publish.js";
import { rdfRouter } from "./routes/rdf.js";
import { simulateRouter } from "./routes/simulate.js";
import { sparqlRouter } from "./routes/sparql.js";
import { LibraryStorage } from "./storage.js";

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

  // Initialize the extensible artifact system (FMU, Dataset, etc.)
  initializeArtifactSystem();

  // Increased limit for npm publish payloads (base64-encoded tarballs in JSON body)
  app.use(express.json({ limit: "50mb" }));

  // Rate Limiting
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200, // Limit each IP to 200 requests per `window`
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use(limiter);

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
