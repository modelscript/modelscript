// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * npm-compatible registry proxy for GitLab Package Management.
 *
 * Forwards all NPM registry requests (install, publish, search)
 * directly to the configured GitLab CE instance.
 */

import type { NextFunction, Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import type { LibraryDatabase } from "../database.js";
import type { LibraryStorage } from "../storage.js";

function isModelScriptAuthHeader(authHeader: string): boolean {
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (token.startsWith("ms_pat_") || token.startsWith("ms_bot_")) {
    return true;
  }
  // 3-part JWT starting with eyJ
  if (/^eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*$/.test(token)) {
    return true;
  }
  return false;
}

export function npmRegistryRouter(database: LibraryDatabase, storage?: LibraryStorage): Router {
  const router = createRouter();

  router.use(async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.baseUrl === "" && req.path.startsWith("/api/")) {
        return next();
      }

      const cleanPath = req.path.replace(/^\/api\/v1\/npm\b/, "") || "/";

      // Handle local npm registry search endpoint
      if (req.method === "GET" && cleanPath === "/-/v1/search") {
        const text = typeof req.query["text"] === "string" ? req.query["text"] : "";
        const size = Number(req.query["size"]) || 20;
        const from = Number(req.query["from"]) || 0;
        return res.json(database.searchPackages(text, size, from));
      }

      // Extract package name from path (e.g. /Modelica, /%40org%2Fpkg, or /@org/pkg)
      const segments = cleanPath.split("/").filter(Boolean);
      let decodedName: string | null = null;
      try {
        if (segments.length === 1 && segments[0] !== "-") {
          decodedName = decodeURIComponent(segments[0]!);
        } else if (
          segments.length === 2 &&
          segments[0] !== "-" &&
          segments[1] !== "-" &&
          decodeURIComponent(segments[0]!).startsWith("@")
        ) {
          decodedName = `${decodeURIComponent(segments[0]!)}/${decodeURIComponent(segments[1]!)}`;
        }
      } catch {
        decodedName = null;
      }

      if (!decodedName) {
        return res.status(404).json({ error: "Not found" });
      }

      const hostUrl = `${req.protocol}://${req.get("host")}`;
      const localPackument = database.buildPackument(decodedName, `${hostUrl}/api/v1/npm`);
      if (localPackument) {
        return res.json(localPackument);
      }

      // Fallback if package archive exists in storage while background indexing is still in progress
      const storedVersions = storage ? storage.versions(decodedName) : [];
      if (storedVersions.length > 0) {
        const pkgRecord = database.getPackage(decodedName);
        const versionsObj: Record<string, unknown> = {};
        const timeObj: Record<string, string> = {};
        for (const v of storedVersions) {
          const rel = database.getLibraryRelease(decodedName, v);
          if (rel?.published_at) timeObj[v] = rel.published_at;
          versionsObj[v] = {
            _id: `${decodedName}@${v}`,
            name: decodedName,
            version: v,
            description: pkgRecord?.description ?? undefined,
            license: pkgRecord?.license ?? undefined,
            dist: {
              shasum: rel?.content_hash?.replace(/^sha256:/, "") ?? "",
              tarball: `${hostUrl}/api/v1/libraries/${encodeURIComponent(decodedName)}/${encodeURIComponent(v)}/download`,
            },
          };
        }
        return res.json({
          _id: decodedName,
          name: decodedName,
          description: pkgRecord?.description ?? null,
          "dist-tags": { latest: storedVersions[0]! },
          versions: versionsObj,
          time: timeObj,
          readme: pkgRecord?.readme ?? "",
          license: pkgRecord?.license ?? null,
        });
      }

      // Do not proxy internal prepackaged libraries to the external registry
      if (decodedName === "SysML" || decodedName === "Modelica" || decodedName.startsWith("ModelScript")) {
        return res.status(404).json({ error: "Package not found or still processing" });
      }

      const gitlabToken = process.env["GITLAB_TOKEN"] || "";
      if (process.env["AIRGAP_ENFORCED"] === "true" || process.env["ENTERPRISE_APPLIANCE"] === "true" || !gitlabToken) {
        return res.status(404).json({ error: "Package not found" });
      }

      // GitLab NPM Package Registry Endpoint
      const gitlabUrl = process.env["GITLAB_URL"] || "https://gitlab.com";
      const targetUrl = `${gitlabUrl}/api/v4/packages/npm${cleanPath}`;

      const headers = new Headers();

      // Forward client's Authorization header only if it is not a ModelScript token
      if (req.headers.authorization && !isModelScriptAuthHeader(req.headers.authorization)) {
        headers.set("Authorization", req.headers.authorization);
      } else if (gitlabToken) {
        headers.set("Authorization", `Bearer ${gitlabToken}`);
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
    return;
  });

  return router;
}
