// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CosimMqttClient } from "@modelscript/cosim";
import express from "express";
import type { Pool } from "pg";

import { LibraryDatabase } from "./database.js";
import { JobQueue } from "./jobs.js";
import { authRouter } from "./routes/auth.js";
import { cosimRouter, mqttParticipantsRouter } from "./routes/cosim.js";
import { fmuRouter } from "./routes/fmu.js";
import { graphqlRouter } from "./routes/graphql.js";
import { historianRouter } from "./routes/historian.js";
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

  app.use(express.json());

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

  // Co-simulation routes (with MQTT client injection)
  app.use("/api/v1/cosim", cosimRouter(mqttClient));
  app.use("/api/v1/mqtt/participants", mqttParticipantsRouter(mqttClient));
  app.use("/api/v1/historian", historianRouter(dbPool, mqttClient));
  app.use("/api/v1/fmus", fmuRouter());

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
