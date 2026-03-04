// SPDX-License-Identifier: AGPL-3.0-or-later

import express from "express";

import { publishRouter } from "./routes/publish.js";
import { LibraryStorage } from "./storage.js";

export function createApp(storage?: LibraryStorage): express.Express {
  const app = express();
  const libraryStorage = storage ?? new LibraryStorage();

  app.use(express.json());

  // Mount the publish router
  app.use("/api/v1/libraries", publishRouter(libraryStorage));

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  return app;
}
