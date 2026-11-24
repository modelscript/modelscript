// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Unified npm-compatible registry router combining npm authentication
 * (`npm login` / `npm adduser`) and npm registry endpoints (search, packument
 * metadata, tarball downloads, and upstream proxy).
 */

import { Router as createRouter, type Router } from "express";
import type { LibraryDatabase } from "../database.js";
import type { LibraryStorage } from "../storage.js";
import { npmAuthRouter } from "./npm-auth.js";
import { npmRegistryRouter } from "./npm-registry.js";

/**
 * Creates a unified Express router that mounts both `npmAuthRouter` and `npmRegistryRouter`.
 */
export function npmCompatRouter(database: LibraryDatabase, libraryStorage?: LibraryStorage): Router {
  const router = createRouter();
  router.use(npmAuthRouter(database));
  router.use(npmRegistryRouter(database, libraryStorage));
  return router;
}
