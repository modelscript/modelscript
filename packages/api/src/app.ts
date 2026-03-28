// SPDX-License-Identifier: AGPL-3.0-or-later

import express from "express";

import { LibraryDatabase } from "./database.js";
import { JobQueue } from "./jobs.js";
import { authRouter } from "./routes/auth.js";
import { cosimRouter, mqttParticipantsRouter } from "./routes/cosim.js";
import { graphqlRouter } from "./routes/graphql.js";
import { historianRouter } from "./routes/historian.js";
import { packagesRouter } from "./routes/packages.js";
import { publishRouter } from "./routes/publish.js";
import { rdfRouter } from "./routes/rdf.js";
import { simulateRouter } from "./routes/simulate.js";
import { sparqlRouter } from "./routes/sparql.js";
import { LibraryStorage } from "./storage.js";

export function createApp(storage?: LibraryStorage): express.Express {
  const app = express();
  const libraryStorage = storage ?? new LibraryStorage();
  const jobQueue = new JobQueue();
  const database = new LibraryDatabase();

  app.use(express.json());

  // Auth routes
  app.use("/api/v1/auth", authRouter(database));

  // Mount the library routers
  app.use("/api/v1/libraries", packagesRouter(libraryStorage, jobQueue, database));
  app.use("/api/v1/libraries", publishRouter(libraryStorage, jobQueue, database));
  app.use("/api/v1/libraries", rdfRouter(database));
  app.use("/api/v1/libraries", graphqlRouter(database));
  app.use("/api/v1/libraries", sparqlRouter(database));
  app.use("/api/v1", simulateRouter(libraryStorage, jobQueue));

  // Co-simulation routes (MQTT client injected as null until runtime wiring)
  app.use("/api/v1/cosim", cosimRouter(null));
  app.use("/api/v1/mqtt/participants", mqttParticipantsRouter(null));
  app.use("/api/v1/historian", historianRouter());

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  return app;
}
