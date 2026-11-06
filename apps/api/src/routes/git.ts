// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router, type NextFunction, type Request, type Response } from "express";
import type { LibraryDatabase } from "../database.js";
import { optionalAuth, requireAuth } from "../middleware/auth-middleware.js";
import { defaultApiLimiter } from "../middleware/rate-limiter.js";
import { getGitProvider } from "../util/git-factory.js";
import { GitLabProvider, GitlabError, gitlabRequest } from "../util/gitlab.js";

function requireGitWriteAuth(req: Request, res: Response, next: NextFunction): void {
  if (process.env["NODE_ENV"] === "production") {
    requireAuth(req, res, next);
    return;
  }
  optionalAuth(req, res, next);
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

  function ensureLocalMergeRequestsTable(): void {
    if (!database || !database.isOpen()) return;
    database.db.exec(`
      CREATE TABLE IF NOT EXISTS git_local_merge_requests (
        id INTEGER PRIMARY KEY,
        iid INTEGER NOT NULL,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        state TEXT NOT NULL DEFAULT 'opened',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        source_branch TEXT NOT NULL,
        target_branch TEXT NOT NULL,
        web_url TEXT NOT NULL,
        sha TEXT,
        target_sha TEXT,
        commits_ahead INTEGER,
        author_name TEXT NOT NULL DEFAULT 'Anonymous',
        UNIQUE(project_id, iid)
      );
    `);
  }

  /**
   * Get merge requests
   */
  router.get("/projects/:id/merge_requests", async (req, res) => {
    try {
      const projectId = req.params.id;
      const provider = getGitProvider(projectId);
      if (provider instanceof GitLabProvider && process.env["GITLAB_TOKEN"]) {
        const mrs = await provider.getMergeRequests(projectId);
        res.json(mrs);
        return;
      }

      const providerMrs = await provider.getMergeRequests(projectId).catch(() => []);
      if (database && database.isOpen()) {
        ensureLocalMergeRequestsTable();
        const rows = database.db
          .prepare(
            `SELECT id, iid, project_id, title, description, state, created_at, updated_at,
                    source_branch, target_branch, web_url, sha, target_sha, commits_ahead, author_name
             FROM git_local_merge_requests
             WHERE project_id = ?
             ORDER BY iid DESC`,
          )
          .all(projectId) as Array<{
          id: number;
          iid: number;
          project_id: string;
          title: string;
          description: string;
          state: string;
          created_at: string;
          updated_at: string;
          source_branch: string;
          target_branch: string;
          web_url: string;
          sha: string | null;
          target_sha: string | null;
          commits_ahead: number | null;
          author_name: string;
        }>;
        if (rows.length > 0) {
          const byIid = new Map<number, unknown>();
          for (const row of rows) {
            byIid.set(row.iid, {
              id: row.id,
              iid: row.iid,
              project_id: row.project_id,
              title: row.title,
              description: row.description,
              state: row.state,
              created_at: row.created_at,
              updated_at: row.updated_at,
              source_branch: row.source_branch,
              target_branch: row.target_branch,
              web_url: row.web_url,
              ...(row.sha ? { sha: row.sha } : {}),
              ...(row.target_sha ? { target_sha: row.target_sha } : {}),
              ...(row.commits_ahead !== null ? { commits_ahead: row.commits_ahead } : {}),
              author: {
                name: row.author_name,
                avatar_url: null,
              },
            });
          }
          for (const mr of providerMrs) {
            if (!byIid.has(mr.iid)) {
              byIid.set(mr.iid, mr);
            }
          }
          res.json(Array.from(byIid.values()));
          return;
        }
      }

      res.json(providerMrs);
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
      if (provider instanceof GitLabProvider && process.env["GITLAB_TOKEN"]) {
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

      const authorName =
        (req as { user?: { username?: string | undefined } | undefined }).user?.username || "Anonymous";
      const localProvider = provider.createMergeRequest ? provider : getGitProvider(`${projectId}.git`);
      const created = localProvider.createMergeRequest
        ? await localProvider.createMergeRequest(projectId, {
            title,
            description: description || "",
            source_branch,
            target_branch,
            author_name: authorName,
          })
        : {
            id: Date.now(),
            iid: 1,
            project_id: projectId,
            title,
            description: description || "",
            state: "opened",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            source_branch,
            target_branch,
            web_url: `${projectId}/-/merge_requests/1`,
            author: { name: authorName, avatar_url: null },
          };

      if (database && database.isOpen()) {
        ensureLocalMergeRequestsTable();
        database.db
          .prepare(
            `INSERT OR REPLACE INTO git_local_merge_requests (
              id, iid, project_id, title, description, state, created_at, updated_at,
              source_branch, target_branch, web_url, sha, target_sha, commits_ahead, author_name
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            created.id,
            created.iid,
            String(created.project_id),
            created.title,
            created.description,
            created.state,
            created.created_at,
            created.updated_at,
            created.source_branch,
            created.target_branch,
            created.web_url || `${projectId}/-/merge_requests/${created.iid}`,
            created.sha ?? null,
            created.target_sha ?? null,
            created.commits_ahead ?? null,
            created.author.name,
          );
      }

      res.status(201).json(created);
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
