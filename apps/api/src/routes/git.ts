// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router, type NextFunction, type Request, type Response } from "express";
import { simpleGit } from "simple-git";
import type { LibraryDatabase } from "../database.js";
import type { AuthenticatedRequest } from "../middleware/auth-middleware.js";
import { optionalAuth, requireAuth } from "../middleware/auth-middleware.js";
import { defaultApiLimiter } from "../middleware/rate-limiter.js";
import { ensureUserActivityRepo } from "../services/activity-git.js";
import { getGitProvider } from "../util/git-factory.js";
import { GitLabProvider, GitlabError, gitlabRequest } from "../util/gitlab.js";

function requireGitWriteAuth(req: Request, res: Response, next: NextFunction): void {
  if (process.env["NODE_ENV"] === "production") {
    requireAuth(req, res, next);
    return;
  }
  optionalAuth(req, res, next);
}

function parseActivityProjectId(rawId: string | undefined): { namespace: string } | null {
  if (!rawId) return null;
  try {
    const decoded = decodeURIComponent(rawId)
      .trim()
      .replace(/^\/+|\/+$/g, "");
    const parts = decoded.split("/");
    if (parts.length !== 2) return null;
    const [namespace, project] = parts;
    if (!namespace || !project) return null;
    const cleanProject = project.toLowerCase();
    if (cleanProject === "activity" || cleanProject === "activity.git") {
      return { namespace };
    }
  } catch {
    return null;
  }
  return null;
}

function sanitizeActivityGitRef(ref: string | undefined): string {
  const clean = (ref || "main").trim();
  // eslint-disable-next-line no-control-regex
  if (!clean || clean.startsWith("-") || clean.includes("..") || /[~^:?*[\\\x00-\x1f\x7f]/.test(clean)) {
    return "main";
  }
  return clean;
}

function sanitizeActivityGitSubpath(subpath: string | undefined): string {
  const clean = (subpath || "").trim().replace(/^\/+|\/+$/g, "");
  // eslint-disable-next-line no-control-regex
  if (clean.startsWith("-") || clean.includes("..") || /[\x00-\x1f\x7f]/.test(clean)) {
    throw new Error("Invalid repository file path");
  }
  return clean;
}

function authorizeActivityRepoUser(
  req: Request,
  res: Response,
  database: LibraryDatabase | undefined,
  namespace: string,
): { id: number; username: string; display_name?: string | null | undefined } | null {
  if (!database) {
    res.status(503).json({ error: "Database unavailable for activity repository." });
    return null;
  }
  const authReq = req as AuthenticatedRequest;
  const authUser = authReq.user;
  if (!authUser) {
    res.status(401).json({
      error: "Authentication required. Personal activity repositories require owner authentication.",
    });
    return null;
  }
  if (authUser.isBot || authUser.account_type === "bot" || authUser.accountType === "bot") {
    res.status(403).json({
      error: "Bot tokens are not permitted to access personal GDPR activity repositories.",
    });
    return null;
  }

  if (authReq.tokenScopes) {
    const hasAllowedScope =
      authReq.tokenScopes.includes("*") ||
      authReq.tokenScopes.includes("admin") ||
      authReq.tokenScopes.includes("repos:read") ||
      authReq.tokenScopes.includes("repos:write") ||
      authReq.tokenScopes.includes("account:read");
    const isPackageRestricted = Boolean(authReq.tokenPackagePattern && authReq.tokenPackagePattern !== "*");
    if (!hasAllowedScope || isPackageRestricted) {
      res.status(403).json({
        error: "Forbidden: Personal access token requires unrestricted 'repos:read' or 'account:read' scope.",
      });
      return null;
    }
  }

  const targetUser =
    namespace.toLowerCase() === "me" ? database.getUserById(authUser.id) : database.getUserByUsername(namespace);

  if (!targetUser) {
    res.status(404).json({ error: "Activity repository not found." });
    return null;
  }

  if (targetUser.id !== authUser.id) {
    res.status(403).json({
      error: "Access denied. Personal activity repositories are strictly private to the account owner.",
    });
    return null;
  }

  return {
    id: targetUser.id,
    username: targetUser.username,
    display_name: targetUser.display_name,
  };
}

async function resolveAuthorizedActivityRepo(
  req: Request,
  res: Response,
  database: LibraryDatabase | undefined,
  namespace: string,
): Promise<{
  repoPath: string;
  targetUser: { id: number; username: string; display_name?: string | null | undefined };
} | null> {
  const targetUser = authorizeActivityRepoUser(req, res, database, namespace);
  if (!targetUser || !database) return null;

  const synced = ensureUserActivityRepo(database, targetUser.id);
  return {
    repoPath: synced.repoPath,
    targetUser,
  };
}

export function gitRouter(database?: LibraryDatabase): Router {
  const router = Router();
  router.use(defaultApiLimiter);
  router.use(requireGitWriteAuth);

  /**
   * Get project metadata
   * Example: GET /api/v1/git/projects/modelscript%2Fcore
   */
  router.get("/projects/:id", async (req, res) => {
    try {
      const activityParsed = parseActivityProjectId(req.params.id);
      if (activityParsed) {
        const targetUser = authorizeActivityRepoUser(req, res, database, activityParsed.namespace);
        if (!targetUser) return;
        const fullPath = `${targetUser.username}/activity`;
        res.json({
          id: 900_000_000 + targetUser.id,
          name: "activity",
          name_with_namespace: `${targetUser.display_name || targetUser.username} / activity`,
          path: "activity",
          path_with_namespace: fullPath,
          description: "Personal Activity & GDPR Art. 20 Data Portability Git Vault (Owner-Only, Read-Only)",
          default_branch: "main",
          visibility: "private",
          web_url: "",
          star_count: 0,
          forks_count: 0,
          watchers_count: 1,
          open_issues_count: 0,
          license: "Personal Data Archive (GDPR Art. 20)",
          topics: ["gdpr-art-20", "activity-vault", "personal-archive", "read-only"],
          language: "Markdown",
          languages_breakdown: [
            { name: "JSON", pct: 55, color: "#0284c7" },
            { name: "Markdown", pct: 30, color: "#083fa1" },
            { name: "HTML", pct: 15, color: "#e34c26" },
          ],
        });
        return;
      }

      const provider = getGitProvider(req.params.id);
      const project = await provider.getProject(req.params.id);
      res.json(project);
    } catch (err: unknown) {
      if (err instanceof GitlabError) {
        res.status(err.status).json({ error: err.message });
      } else {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  });

  /**
   * Get repository tree
   * Example: GET /api/v1/git/projects/modelscript%2Fcore/repository/tree?ref=main&path=src
   */
  router.get("/projects/:id/repository/tree", async (req, res) => {
    try {
      const activityParsed = parseActivityProjectId(req.params.id);
      if (activityParsed) {
        const authRepo = await resolveAuthorizedActivityRepo(req, res, database, activityParsed.namespace);
        if (!authRepo) return;
        const safeRef = sanitizeActivityGitRef(req.query["ref"] as string | undefined);
        const safeTreePath = sanitizeActivityGitSubpath(req.query["path"] as string | undefined);
        const recursive = req.query["recursive"] === "true" || req.query["recursive"] === "1";
        const git = simpleGit(authRepo.repoPath);
        const targetSpec = safeTreePath ? `${safeRef}:${safeTreePath}` : safeRef;
        let output = "";
        try {
          output = await git.raw(recursive ? ["ls-tree", "-r", targetSpec] : ["ls-tree", targetSpec]);
        } catch {
          output = await git.raw(
            recursive
              ? ["ls-tree", "-r", safeTreePath ? `HEAD:${safeTreePath}` : "HEAD"]
              : ["ls-tree", safeTreePath ? `HEAD:${safeTreePath}` : "HEAD"],
          );
        }
        const items: {
          id: string;
          name: string;
          type: "tree" | "blob" | "commit";
          path: string;
          mode: string;
        }[] = [];
        for (const line of output.trim().split("\n")) {
          if (!line) continue;
          const match = line.match(/^(\d+)\s+(\w+)\s+([a-f0-9]+)\t(.*)$/);
          if (match) {
            const [, mode, type, id, rawEntryPath] = match;
            if (id && rawEntryPath) {
              const fullEntryPath = safeTreePath ? `${safeTreePath}/${rawEntryPath}` : rawEntryPath;
              const baseName = rawEntryPath.split("/").pop() || rawEntryPath;
              items.push({
                id,
                name: baseName,
                type: type as "tree" | "blob" | "commit",
                path: fullEntryPath,
                mode: mode as string,
              });
            }
          }
        }
        res.json(items);
        return;
      }

      const provider = getGitProvider(req.params.id);
      const ref = (req.query["ref"] as string) || "main";
      const path = (req.query["path"] as string) || "";
      const tree = await provider.getRepositoryTree(req.params.id, ref, path);
      res.json(tree);
    } catch (err: unknown) {
      if (err instanceof GitlabError) {
        res.status(err.status).json({ error: err.message });
      } else {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  });

  /**
   * Get raw file content
   * Example: GET /api/v1/git/projects/modelscript%2Fcore/repository/files/README.md/raw?ref=main
   */
  router.get("/projects/:id/repository/files/:file_path/raw", async (req, res) => {
    try {
      const activityParsed = parseActivityProjectId(req.params.id);
      if (activityParsed) {
        const authRepo = await resolveAuthorizedActivityRepo(req, res, database, activityParsed.namespace);
        if (!authRepo) return;
        const safeRef = sanitizeActivityGitRef(req.query["ref"] as string | undefined);
        const safeFilePath = sanitizeActivityGitSubpath(decodeURIComponent(req.params.file_path || ""));
        const git = simpleGit(authRepo.repoPath);
        try {
          const rawContent = await git.show([`${safeRef}:${safeFilePath}`]);
          res.type("text/plain").send(rawContent);
        } catch {
          try {
            const rawContent = await git.show([`HEAD:${safeFilePath}`]);
            res.type("text/plain").send(rawContent);
          } catch {
            res.status(404).json({ error: `File not found in activity repository: ${safeFilePath}` });
          }
        }
        return;
      }

      const provider = getGitProvider(req.params.id);
      const ref = (req.query["ref"] as string) || "main";
      const rawContent = await provider.getRepositoryFileRaw(req.params.id, req.params.file_path, ref);
      res.type("text/plain").send(rawContent);
    } catch (err: unknown) {
      if (err instanceof GitlabError) {
        res.status(err.status).json({ error: err.message });
      } else {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  });

  /**
   * Get commits
   * Example: GET /api/v1/git/projects/modelscript%2Fcore/repository/commits?ref_name=main
   */
  router.get("/projects/:id/repository/commits", async (req, res) => {
    try {
      const activityParsed = parseActivityProjectId(req.params.id);
      if (activityParsed) {
        const authRepo = await resolveAuthorizedActivityRepo(req, res, database, activityParsed.namespace);
        if (!authRepo) return;
        const safeRefName = sanitizeActivityGitRef(req.query["ref_name"] as string | undefined);
        const git = simpleGit(authRepo.repoPath);
        let log;
        try {
          log = await git.log(["-n", "100", safeRefName, "--"]);
        } catch {
          log = await git.log(["-n", "100", "HEAD", "--"]);
        }
        res.json(
          log.all.map((c) => ({
            id: c.hash,
            short_id: c.hash.substring(0, 8),
            title: c.message,
            created_at: new Date(c.date).toISOString(),
            author_name: c.author_name,
            author_email: c.author_email,
            message: c.body || c.message,
            status: "success",
          })),
        );
        return;
      }

      const provider = getGitProvider(req.params.id);
      const refName = (req.query["ref_name"] as string) || "main";
      const commits = await provider.getCommits(req.params.id, refName);
      res.json(commits);
    } catch (err: unknown) {
      if (err instanceof GitlabError) {
        res.status(err.status).json({ error: err.message });
      } else {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  });

  /**
   * Get pipelines
   */
  router.get("/projects/:id/pipelines", async (req, res) => {
    try {
      const activityParsed = parseActivityProjectId(req.params.id);
      if (activityParsed) {
        const targetUser = authorizeActivityRepoUser(req, res, database, activityParsed.namespace);
        if (!targetUser) return;
        res.json([]);
        return;
      }
      const provider = getGitProvider(req.params.id);
      const ref = (req.query["ref"] as string) || "main";
      const pipelines = await provider.getPipelines(req.params.id, ref);
      res.json(pipelines);
    } catch (err: unknown) {
      if (err instanceof GitlabError) {
        res.status(err.status).json({ error: err.message });
      } else {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  });

  /**
   * Get pipeline jobs
   */
  router.get("/projects/:id/pipelines/:pipeline_id/jobs", async (req, res) => {
    try {
      const activityParsed = parseActivityProjectId(req.params.id);
      if (activityParsed) {
        const targetUser = authorizeActivityRepoUser(req, res, database, activityParsed.namespace);
        if (!targetUser) return;
        res.json([]);
        return;
      }
      const provider = getGitProvider(req.params.id);
      const jobs = await provider.getPipelineJobs(req.params.id, req.params.pipeline_id);
      res.json(jobs);
    } catch (err: unknown) {
      if (err instanceof GitlabError) {
        res.status(err.status).json({ error: err.message });
      } else {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  });

  /**
   * Get issues
   */
  router.get("/projects/:id/issues", async (req, res) => {
    try {
      const activityParsed = parseActivityProjectId(req.params.id);
      if (activityParsed) {
        const targetUser = authorizeActivityRepoUser(req, res, database, activityParsed.namespace);
        if (!targetUser) return;
        res.json([]);
        return;
      }
      const provider = getGitProvider(req.params.id);
      const issues = await provider.getIssues(req.params.id);
      res.json(issues);
    } catch (err: unknown) {
      if (err instanceof GitlabError) {
        res.status(err.status).json({ error: err.message });
      } else {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  });

  /**
   * Create an issue
   */
  router.post("/projects/:id/issues", requireGitWriteAuth, async (req, res) => {
    try {
      const projectId = String(req.params["id"] || "");
      if (parseActivityProjectId(projectId)) {
        res.status(403).json({ error: "Personal activity repositories are read-only." });
        return;
      }
      const provider = getGitProvider(projectId);
      const issue = await provider.createIssue(projectId, req.body);
      res.json(issue);
    } catch (err: unknown) {
      if (err instanceof GitlabError) {
        res.status(err.status).json({ error: err.message });
      } else {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  });

  /**
   * Get merge requests
   */
  router.get("/projects/:id/merge_requests", async (req, res) => {
    try {
      const activityParsed = parseActivityProjectId(req.params.id);
      if (activityParsed) {
        const targetUser = authorizeActivityRepoUser(req, res, database, activityParsed.namespace);
        if (!targetUser) return;
        res.json([]);
        return;
      }
      const provider = getGitProvider(req.params.id);
      const mrs = await provider.getMergeRequests(req.params.id);
      res.json(mrs);
    } catch (err: unknown) {
      if (err instanceof GitlabError) {
        res.status(err.status).json({ error: err.message });
      } else {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  });

  /**
   * Create a merge request
   */
  router.post("/projects/:id/merge_requests", requireGitWriteAuth, async (req, res) => {
    try {
      const projectId = String(req.params["id"] || "");
      if (parseActivityProjectId(projectId)) {
        res.status(403).json({ error: "Personal activity repositories are read-only." });
        return;
      }
      const { title, description, source_branch, target_branch } = (req.body ?? {}) as {
        title?: string | undefined;
        description?: string | undefined;
        source_branch?: string | undefined;
        target_branch?: string | undefined;
      };
      if (!title || !source_branch || !target_branch) {
        res.status(400).json({ error: "title, source_branch, and target_branch are required" });
        return;
      }

      const provider = getGitProvider(projectId);
      if (provider instanceof GitLabProvider) {
        const encodedId = encodeURIComponent(projectId);
        const mr = await gitlabRequest(`/projects/${encodedId}/merge_requests`, {
          method: "POST",
          body: JSON.stringify({
            title,
            description: description || "",
            source_branch,
            target_branch,
          }),
        });
        res.status(201).json(mr);
        return;
      }

      res.status(201).json({
        id: Date.now(),
        iid: 1,
        title,
        description: description || "",
        state: "opened",
        created_at: new Date().toISOString(),
        author: {
          name: (req as { user?: { username?: string | undefined } | undefined }).user?.username || "Anonymous",
        },
        source_branch,
        target_branch,
        web_url: `${projectId}/-/merge_requests/1`,
      });
    } catch (err: unknown) {
      if (err instanceof GitlabError) {
        res.status(err.status).json({ error: err.message });
      } else {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  });

  return router;
}
