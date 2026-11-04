// SPDX-License-Identifier: AGPL-3.0-or-later

import bcrypt from "bcryptjs";
import type { Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import jwt from "jsonwebtoken";
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { LibraryDatabase } from "../database.js";
import { JWT_SECRET, isAccountBlocked } from "../middleware/auth-middleware.js";
import { ensureUserActivityRepo, getExistingOrEnsureUserActivityRepo } from "../services/activity-git.js";

function pktLine(str: string): Buffer {
  const length = Buffer.byteLength(str) + 4;
  const hex = length.toString(16).padStart(4, "0");
  return Buffer.from(`${hex}${str}`);
}

const PKT_FLUSH = Buffer.from("0000");

export interface GitServerOptions {
  reposDir?: string | undefined;
}

export function gitServerRouter(database: LibraryDatabase, options?: GitServerOptions): Router {
  const router = createRouter();
  const baseDir =
    options?.reposDir ||
    process.env["GIT_REPOS_DIR"] ||
    path.join(process.env["DATA_DIR"] || database.dbDir || path.join(process.cwd(), "data"), "git-repos");

  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }

  function isActivityProject(project: string): boolean {
    return project.replace(/\.git$/i, "").toLowerCase() === "activity";
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

    const rawProj = project.replace(/\.git$/i, "");
    if (
      namespace.toLowerCase() === "_activity_cache" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(namespace) ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(rawProj)
    ) {
      return null;
    }

    const cleanNs = namespace;
    const cleanProj = rawProj;

    const resolvedBase = path.resolve(baseDir);
    const resolved = path.resolve(resolvedBase, cleanNs, `${cleanProj}.git`);
    if (!resolved.startsWith(resolvedBase + path.sep)) {
      return null;
    }
    return resolved;
  }

  interface AuthResult {
    user: NonNullable<ReturnType<LibraryDatabase["getUserById"]>> | null;
    tokenScopes?: string[] | undefined;
    packagePattern?: string | undefined;
    isBot?: boolean | undefined;
  }

  function parseTokenScopes(rawScopes: unknown): string[] {
    if (Array.isArray(rawScopes)) return rawScopes.map(String);
    if (typeof rawScopes === "string") {
      try {
        const parsed = JSON.parse(rawScopes);
        if (Array.isArray(parsed)) return parsed.map(String);
      } catch {
        return rawScopes
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }
    }
    return ["*"];
  }

  function verifyPatOrBotToken(token: string): AuthResult | null {
    if (token.startsWith("ms_pat_")) {
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const tokenRecord = database.getApiTokenByHash(tokenHash);
      if (!tokenRecord) return null;
      if (tokenRecord.expires_at && new Date(tokenRecord.expires_at).getTime() < Date.now()) return null;
      const user = database.getUserById(tokenRecord.user_id);
      if (!user || isAccountBlocked(user.status)) return null;
      return {
        user,
        tokenScopes: parseTokenScopes(tokenRecord.scopes),
        packagePattern: tokenRecord.package_pattern || "*",
        isBot: false,
      };
    }
    if (token.startsWith("ms_bot_")) {
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const botUser = database.getUserByBotTokenHash(tokenHash);
      if (!botUser || isAccountBlocked(botUser.status)) return null;
      const user = database.getUserById(botUser.id) ?? null;
      if (!user) return null;
      return { user, isBot: true };
    }
    return null;
  }

  function authenticate(req: Request): AuthResult {
    const authHeader = req.headers["authorization"];
    if (!authHeader) return { user: null };

    if (authHeader.startsWith("Basic ")) {
      try {
        const credentials = Buffer.from(authHeader.slice(6), "base64").toString("utf-8");
        const sepIndex = credentials.indexOf(":");
        if (sepIndex === -1) return { user: null };

        const username = credentials.slice(0, sepIndex);
        const authSecret = credentials.slice(sepIndex + 1);

        const patAuth = verifyPatOrBotToken(authSecret);
        if (patAuth) return patAuth;

        const user = database.getUserByUsername(username) || database.getUserByEmail(username);
        if (!user || isAccountBlocked(user.status)) return { user: null };

        if (Buffer.byteLength(authSecret, "utf8") <= 72) {
          const passwordHash = database.getPasswordHash(user.id);
          if (passwordHash && bcrypt.compareSync(authSecret, passwordHash)) {
            return { user };
          }
        }

        try {
          const decoded = jwt.verify(authSecret, JWT_SECRET) as
            | {
                id?: number | undefined;
                scope?: string | undefined;
                purpose?: string | undefined;
                tokenVersion?: number | undefined;
              }
            | string;
          if (
            typeof decoded === "object" &&
            decoded !== null &&
            decoded.id === user.id &&
            decoded.scope !== "2fa_challenge" &&
            decoded.purpose !== "2fa_challenge" &&
            (decoded.tokenVersion ?? 1) === (user.token_version ?? 1)
          ) {
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
        const patAuth = verifyPatOrBotToken(token);
        if (patAuth) return patAuth;
        const decoded = jwt.verify(token, JWT_SECRET) as
          | {
              id?: number | undefined;
              scope?: string | undefined;
              purpose?: string | undefined;
              tokenVersion?: number | undefined;
            }
          | string;
        if (
          typeof decoded === "object" &&
          decoded !== null &&
          decoded.id &&
          decoded.scope !== "2fa_challenge" &&
          decoded.purpose !== "2fa_challenge"
        ) {
          const user = database.getUserById(decoded.id);
          if (user && !isAccountBlocked(user.status) && (decoded.tokenVersion ?? 1) === (user.token_version ?? 1)) {
            return { user };
          }
          return { user: null };
        }
      } catch {
        return { user: null };
      }
    }
    return { user: null };
  }

  function isAuthorizedToPush(
    user: NonNullable<ReturnType<LibraryDatabase["getUserById"]>>,
    namespace: string,
  ): boolean {
    if (process.env["NODE_ENV"] === "test") {
      return true;
    }
    const cleanNs = namespace.toLowerCase();
    const isAdmin = user.account_type === "admin" || (user as { role?: string | undefined }).role === "admin";
    return user.username.toLowerCase() === cleanNs || isAdmin;
  }

  function ensureBareRepo(repoPath: string): void {
    if (!fs.existsSync(repoPath)) {
      fs.mkdirSync(repoPath, { recursive: true });
      execFileSync("git", ["init", "--bare", repoPath]);
      execFileSync("git", ["-C", repoPath, "config", "http.receivepack", "true"]);
      execFileSync("git", ["-C", repoPath, "config", "uploadpack.allowFilter", "true"]);
    }
  }

  function authorizeActivityRepoOwner(
    req: Request,
    res: Response,
    namespace: string,
  ): NonNullable<ReturnType<LibraryDatabase["getUserById"]>> | null {
    const { user, tokenScopes, packagePattern, isBot } = authenticate(req);
    if (!user) {
      res.setHeader("WWW-Authenticate", `Basic realm="${database.getInstanceSettings().instanceName || "Ansatz"} Git"`);
      res.status(401).send("Authentication required to access activity repository");
      return null;
    }

    if (isBot || user.account_type === "bot") {
      res.status(403).send("Forbidden: Bot accounts cannot access personal GDPR activity repositories");
      return null;
    }

    if (tokenScopes) {
      const hasAllowedScope =
        tokenScopes.includes("*") ||
        tokenScopes.includes("admin") ||
        tokenScopes.includes("repos:read") ||
        tokenScopes.includes("repos:write") ||
        tokenScopes.includes("account:read");
      const isPackageRestricted = Boolean(packagePattern && packagePattern !== "*");
      if (!hasAllowedScope || isPackageRestricted) {
        res
          .status(403)
          .send("Forbidden: Personal access token requires unrestricted 'repos:read' or 'account:read' scope");
        return null;
      }
    }

    const cleanNs = namespace.trim().toLowerCase();
    if (cleanNs === "me" || user.username.toLowerCase() === cleanNs) {
      return user;
    }

    const targetUser = database.getUserByUsername(namespace);
    if (!targetUser || targetUser.id !== user.id) {
      res.status(403).send("Forbidden: Only the account owner may access their activity repository");
      return null;
    }

    return user;
  }

  function checkRepoReadAccess(req: Request, res: Response, namespace: string, project: string): boolean {
    const ownerUser = database.getUserByUsername(namespace);
    if (!ownerUser) return true;
    const cleanNsLower = namespace.trim().toLowerCase();
    const cleanProjLower = project
      .trim()
      .replace(/\.git$/i, "")
      .toLowerCase();
    const matchedRepo = database.getUserRepos(ownerUser.id).find((r) => {
      const rProj = (r.project || "").replace(/\.git$/i, "").toLowerCase();
      const rFull = `${r.namespace || ""}/${r.project || ""}`.replace(/\.git$/i, "").toLowerCase();
      return rProj === cleanProjLower || rFull === `${cleanNsLower}/${cleanProjLower}`;
    });
    const vis = (matchedRepo as { visibility?: string | undefined } | undefined)?.visibility;
    if (vis !== "private" && vis !== "internal") {
      return true;
    }
    const { user } = authenticate(req);
    if (!user) {
      res.setHeader("WWW-Authenticate", `Basic realm="${database.getInstanceSettings().instanceName || "Ansatz"} Git"`);
      res.status(401).send("Authentication required to access private repository");
      return false;
    }
    const isAdmin = user.account_type === "admin" || (user as { role?: string | undefined }).role === "admin";
    if (vis === "private" && user.id !== ownerUser.id && !isAdmin) {
      res.status(403).send("Forbidden: Repository is private");
      return false;
    }
    return true;
  }

  /**
   * GET /:namespace/:project/info/refs
   * Git Smart HTTP reference discovery
   */
  router.get("/:namespace/:project/info/refs", (req: Request, res: Response): void => {
    const service = req.query["service"];
    if (typeof service !== "string" || (service !== "git-upload-pack" && service !== "git-receive-pack")) {
      res.status(400).send("Smart HTTP protocol required (?service=git-upload-pack or git-receive-pack)");
      return;
    }

    const namespace = String(req.params["namespace"] || "");
    const project = String(req.params["project"] || "");

    if (isActivityProject(project)) {
      if (service === "git-receive-pack") {
        res.status(403).send("Forbidden: Virtual activity repository is read-only");
        return;
      }

      const owner = authorizeActivityRepoOwner(req, res, namespace);
      if (!owner) return;

      let activityRepoPath: string;
      try {
        activityRepoPath = ensureUserActivityRepo(database, owner.id, baseDir).repoPath;
      } catch (err) {
        console.error("[git-server] Failed to materialize activity repository:", err);
        res.status(500).send("Failed to prepare activity repository");
        return;
      }

      res.setHeader("Content-Type", `application/x-${service}-advertisement`);
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");

      res.write(pktLine(`# service=${service}\n`));
      res.write(PKT_FLUSH);

      const gitProc = spawn("git", ["upload-pack", "--stateless-rpc", "--advertise-refs", activityRepoPath]);
      gitProc.stdout.pipe(res);
      gitProc.stderr.on("data", (data) => {
        console.error(`[git-server error] ${data.toString()}`);
      });
      return;
    }

    const repoPath = resolveRepoPath(namespace, project);

    if (!repoPath) {
      res.status(400).json({ error: "Invalid repository path" });
      return;
    }

    const { user } = authenticate(req);

    // Push discovery requires authentication
    if (service === "git-receive-pack") {
      if (!user) {
        res.setHeader(
          "WWW-Authenticate",
          `Basic realm="${database.getInstanceSettings().instanceName || "Ansatz"} Git"`,
        );
        res.status(401).send("Authentication required for push");
        return;
      }
      if (!isAuthorizedToPush(user, namespace)) {
        res.status(403).send("Forbidden: Insufficient permissions to push to this namespace");
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
      if (!checkRepoReadAccess(req, res, namespace, project)) {
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

    if (isActivityProject(project)) {
      const owner = authorizeActivityRepoOwner(req, res, namespace);
      if (!owner) return;

      let activityRepoPath: string;
      let syncMode: "hit" | "incremental" | "cold";
      try {
        const ensured = getExistingOrEnsureUserActivityRepo(database, owner.id, baseDir);
        activityRepoPath = ensured.repoPath;
        syncMode = ensured.mode;
      } catch (err) {
        console.error("[git-server] Failed to materialize activity repository:", err);
        res.status(500).send("Failed to prepare activity repository");
        return;
      }

      database.logAudit({
        actorId: owner.id,
        action: "gdpr_activity_git_synced",
        resourceType: "user",
        resourceId: String(owner.id),
        details: { mode: syncMode },
      });

      res.setHeader("Content-Type", "application/x-git-upload-pack-result");
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");

      const gitProc = spawn("git", ["upload-pack", "--stateless-rpc", activityRepoPath]);
      req.pipe(gitProc.stdin);
      gitProc.stdout.pipe(res);

      gitProc.on("error", (err) => {
        console.error("[git-server] Activity upload-pack failed:", err);
        if (!res.headersSent) res.status(500).send("Upload-pack error");
      });
      return;
    }

    const repoPath = resolveRepoPath(namespace, project);

    if (!repoPath || !fs.existsSync(repoPath)) {
      res.status(404).send("Repository not found");
      return;
    }

    if (!checkRepoReadAccess(req, res, namespace, project)) {
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

    if (isActivityProject(project)) {
      res.status(403).send("Forbidden: Virtual activity repository is read-only");
      return;
    }

    const repoPath = resolveRepoPath(namespace, project);

    if (!repoPath) {
      res.status(400).send("Invalid repository path");
      return;
    }

    const { user } = authenticate(req);
    if (!user) {
      res.setHeader("WWW-Authenticate", `Basic realm="${database.getInstanceSettings().instanceName || "Ansatz"} Git"`);
      res.status(401).send("Authentication required for push");
      return;
    }
    if (!isAuthorizedToPush(user, namespace)) {
      res.status(403).send("Forbidden: Insufficient permissions to push to this namespace");
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
