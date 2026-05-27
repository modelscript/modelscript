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
      // Extract package name from path (e.g. /Modelica or /@org/pkg)
      // Path usually looks like /pkgname
      const pkgName = req.path.split("/")[1];
      if (pkgName) {
        const decodedName = decodeURIComponent(pkgName);
        const hostUrl = `${req.protocol}://${req.get("host")}`;
        const localPackument = database.buildPackument(decodedName, `${hostUrl}/api/v1/npm`);
        if (localPackument) {
          return res.json(localPackument);
        }

        // Do not proxy internal prepackaged libraries to the external registry
        if (decodedName === "SysML" || decodedName === "Modelica" || decodedName.startsWith("ModelScript")) {
          return res.status(404).json({ error: "Package not found or still processing" });
        }
      }

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
        const lowerKey = key.toLowerCase();
        // Prevent duplicate chunked encoding headers and decompression mismatches from crashing Express
        if (lowerKey !== "transfer-encoding" && lowerKey !== "content-encoding" && lowerKey !== "content-length") {
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
