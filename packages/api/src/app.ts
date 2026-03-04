// SPDX-License-Identifier: AGPL-3.0-or-later

import express from "express";

import { LibraryDatabase } from "./database.js";
import { JobQueue } from "./jobs.js";
import { graphqlRouter } from "./routes/graphql.js";
import { packagesRouter } from "./routes/packages.js";
import { publishRouter } from "./routes/publish.js";
import { rdfRouter } from "./routes/rdf.js";
import { sparqlRouter } from "./routes/sparql.js";
import { LibraryStorage } from "./storage.js";

export function createApp(storage?: LibraryStorage): express.Express {
  const app = express();
  const libraryStorage = storage ?? new LibraryStorage();
  const jobQueue = new JobQueue();
  const database = new LibraryDatabase();

  app.use(express.json());

  // Mount the library routers
  app.use("/api/v1/libraries", packagesRouter(libraryStorage, jobQueue, database));
  app.use("/api/v1/libraries", publishRouter(libraryStorage, jobQueue, database));
  app.use("/api/v1/libraries", rdfRouter(database));
  app.use("/api/v1/libraries", graphqlRouter(database));
  app.use("/api/v1/libraries", sparqlRouter(database));

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  return app;
}
