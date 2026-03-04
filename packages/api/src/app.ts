// SPDX-License-Identifier: AGPL-3.0-or-later

import express from "express";

import { JobQueue } from "./jobs.js";
import { packagesRouter } from "./routes/packages.js";
import { publishRouter } from "./routes/publish.js";
import { LibraryStorage } from "./storage.js";

export function createApp(storage?: LibraryStorage): express.Express {
  const app = express();
  const libraryStorage = storage ?? new LibraryStorage();
  const jobQueue = new JobQueue();

  app.use(express.json());

  // Mount the library routers
  app.use("/api/v1/libraries", packagesRouter(libraryStorage, jobQueue));
  app.use("/api/v1/libraries", publishRouter(libraryStorage, jobQueue));

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  return app;
}
