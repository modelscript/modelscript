// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * npm-compatible registry proxy for GitLab Package Management.
 *
 * Forwards all NPM registry requests (install, publish, search)
 * directly to the configured GitLab CE instance.
 */

import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import type { LibraryDatabase } from "../database.js";

const GITLAB_URL = process.env.GITLAB_URL || "https://gitlab.com";
const GITLAB_TOKEN = process.env.GITLAB_TOKEN || "";

export function npmRegistryRouter(database: LibraryDatabase): Router {
  void database; // No longer needed, logic delegated to GitLab
  const router = createRouter();

  router.use(async (req: Request, res: Response) => {
    try {
      // GitLab NPM Package Registry Endpoint
      const targetUrl = `${GITLAB_URL}/api/v4/packages/npm${req.path}`;

      const headers = new Headers();

      // Forward client's Authorization header (e.g., from npm login)
      // Fallback to the configured GITLAB_TOKEN if no auth is provided
      if (req.headers.authorization) {
        headers.set("Authorization", req.headers.authorization);
      } else if (GITLAB_TOKEN) {
        headers.set("Authorization", `Bearer ${GITLAB_TOKEN}`);
      }

      if (req.headers["content-type"]) {
        headers.set("Content-Type", req.headers["content-type"] as string);
      }

      const fetchOptions: RequestInit = {
        method: req.method,
        headers,
      };

      if (req.method !== "GET" && req.method !== "HEAD") {
        // Forward body if present.
        // Express has already parsed req.body via express.json()
        if (req.body && Object.keys(req.body).length > 0) {
          fetchOptions.body = JSON.stringify(req.body);
        }
      }

      const response = await fetch(targetUrl, fetchOptions);

      // Copy status
      res.status(response.status);

      // Copy response headers
      response.headers.forEach((value, key) => {
        // Prevent duplicate chunked encoding headers from crashing Express
        if (key.toLowerCase() !== "transfer-encoding") {
          res.setHeader(key, value);
        }
      });

      // Stream the response back
      const buffer = await response.arrayBuffer();
      res.send(Buffer.from(buffer));
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
