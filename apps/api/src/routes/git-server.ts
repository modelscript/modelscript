// SPDX-License-Identifier: AGPL-3.0-or-later

import bcrypt from "bcryptjs";
import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import jwt from "jsonwebtoken";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { LibraryDatabase } from "../database.js";
import { JWT_SECRET } from "../middleware/auth-middleware.js";

function pktLine(str: string): Buffer {
  const length = Buffer.byteLength(str) + 4;
  const hex = length.toString(16).padStart(4, "0");
  return Buffer.from(`${hex}${str}`);
}

const PKT_FLUSH = Buffer.from("0000");

export interface GitServerOptions {
  reposDir?: string;
}

export function gitServerRouter(database: LibraryDatabase, options?: GitServerOptions): Router {
  const router = createRouter();
  const baseDir = options?.reposDir || process.env["GIT_REPOS_DIR"] || path.join(process.cwd(), "data", "git-repos");

  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  function resolveRepoPath(namespace: string, project: string): string | null {
    if (
      !namespace ||
      !project ||
      namespace.includes("..") ||
      project.includes("..") ||
      namespace.includes("/") ||
      namespace.includes("\\")
    ) {
      return null;
    }

    const cleanNs = namespace.replace(/[^a-zA-Z0-9_.-]/g, "");
    const cleanProj = project.replace(/\.git$/, "").replace(/[^a-zA-Z0-9_.-]/g, "");
    if (!cleanNs || !cleanProj) return null;

    const resolved = path.resolve(baseDir, cleanNs, `${cleanProj}.git`);
    if (!resolved.startsWith(path.resolve(baseDir))) {
      return null;
    }
    return resolved;
  }

  function authenticate(req: Request): { user: any | null } {
    const authHeader = req.headers["authorization"];
    if (!authHeader) return { user: null };

    if (authHeader.startsWith("Basic ")) {
      try {
        const credentials = Buffer.from(authHeader.slice(6), "base64").toString("utf-8");
        const sepIndex = credentials.indexOf(":");
        if (sepIndex === -1) return { user: null };

        const username = credentials.slice(0, sepIndex);
        const password = credentials.slice(sepIndex + 1);

        const user = database.getUserByUsername(username) || database.getUserByEmail(username);
        if (!user) return { user: null };

        const passwordHash = database.getPasswordHash(user.id);
        if (passwordHash && bcrypt.compareSync(password, passwordHash)) {
          return { user };
        }

        try {
          const decoded = jwt.verify(password, JWT_SECRET) as any;
          if (decoded && decoded.id === user.id) {
            return { user };
          }
        } catch {
          // Token verify failed
        }
      } catch {
        return { user: null };
      }
    } else if (authHeader.startsWith("Bearer ")) {
      try {
        const token = authHeader.slice(7);
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        if (decoded && decoded.id) {
          const user = database.getUserById(decoded.id);
          return { user: user ?? null };
        }
      } catch {
        return { user: null };
      }
    }
    return { user: null };
  }

  function ensureBareRepo(repoPath: string): void {
    if (!fs.existsSync(repoPath)) {
      fs.mkdirSync(repoPath, { recursive: true });
      execFileSync("git", ["init", "--bare", repoPath]);
      execFileSync("git", ["-C", repoPath, "config", "http.receivepack", "true"]);
      execFileSync("git", ["-C", repoPath, "config", "uploadpack.allowFilter", "true"]);
    }
  }

  /**
   * GET /:namespace/:project/info/refs
   * Git Smart HTTP reference discovery
   */
  router.get("/:namespace/:project/info/refs", (req: Request, res: Response): void => {
    const service = req.query["service"] as string | undefined;
    if (service !== "git-upload-pack" && service !== "git-receive-pack") {
      res.status(400).send("Smart HTTP protocol required (?service=git-upload-pack or git-receive-pack)");
      return;
    }

    const namespace = String(req.params["namespace"] || "");
    const project = String(req.params["project"] || "");
    const repoPath = resolveRepoPath(namespace, project);

    if (!repoPath) {
      res.status(400).json({ error: "Invalid repository path" });
      return;
    }

    const { user } = authenticate(req);

    // Push discovery requires authentication
    if (service === "git-receive-pack") {
      if (!user) {
        res.setHeader("WWW-Authenticate", 'Basic realm="ModelScript Git"');
        res.status(401).send("Authentication required for push");
        return;
      }
      // Auto-create bare repository if pushing to user's namespace or organization
      ensureBareRepo(repoPath);
    } else {
      // Clone/fetch discovery
      if (!fs.existsSync(repoPath)) {
        res.status(404).send("Repository not found");
        return;
      }
    }

    res.setHeader("Content-Type", `application/x-${service}-advertisement`);
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    res.write(pktLine(`# service=${service}\n`));
    res.write(PKT_FLUSH);

    const gitProc = spawn("git", [service.slice(4), "--stateless-rpc", "--advertise-refs", repoPath]);

    gitProc.stdout.pipe(res);
    gitProc.stderr.on("data", (data) => {
      console.error(`[git-server error] ${data.toString()}`);
    });
  });

  /**
   * POST /:namespace/:project/git-upload-pack
   * Pack negotiation for fetch / clone
   */
  router.post("/:namespace/:project/git-upload-pack", (req: Request, res: Response): void => {
    const namespace = String(req.params["namespace"] || "");
    const project = String(req.params["project"] || "");
    const repoPath = resolveRepoPath(namespace, project);

    if (!repoPath || !fs.existsSync(repoPath)) {
      res.status(404).send("Repository not found");
      return;
    }

    res.setHeader("Content-Type", "application/x-git-upload-pack-result");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");

    const gitProc = spawn("git", ["upload-pack", "--stateless-rpc", repoPath]);

    req.pipe(gitProc.stdin);
    gitProc.stdout.pipe(res);

    gitProc.on("error", (err) => {
      console.error("[git-server] Upload-pack failed:", err);
      if (!res.headersSent) res.status(500).send("Upload-pack error");
    });
  });

  /**
   * POST /:namespace/:project/git-receive-pack
   * Pack ingestion for git push
   */
  router.post("/:namespace/:project/git-receive-pack", (req: Request, res: Response): void => {
    const namespace = String(req.params["namespace"] || "");
    const project = String(req.params["project"] || "");
    const repoPath = resolveRepoPath(namespace, project);

    if (!repoPath) {
      res.status(400).send("Invalid repository path");
      return;
    }

    const { user } = authenticate(req);
    if (!user) {
      res.setHeader("WWW-Authenticate", 'Basic realm="ModelScript Git"');
      res.status(401).send("Authentication required for push");
      return;
    }

    ensureBareRepo(repoPath);

    res.setHeader("Content-Type", "application/x-git-receive-pack-result");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");

    const gitProc = spawn("git", ["receive-pack", "--stateless-rpc", repoPath]);

    req.pipe(gitProc.stdin);
    gitProc.stdout.pipe(res);

    gitProc.on("close", (code) => {
      if (code === 0) {
        // Link repo in database if not already linked
        const cleanProj = project.replace(/\.git$/, "");
        database.linkRepo(user.id, "local", `${namespace}/${cleanProj}`, `${namespace}/${cleanProj}`, "main");
      }
    });

    gitProc.on("error", (err) => {
      console.error("[git-server] Receive-pack failed:", err);
      if (!res.headersSent) res.status(500).send("Receive-pack error");
    });
  });

  return router;
}
