// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router, type NextFunction, type Request, type Response } from "express";
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

export function gitRouter(): Router {
  const router = Router();
  router.use(defaultApiLimiter);

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

  /**
   * Get merge requests
   */
  router.get("/projects/:id/merge_requests", async (req, res) => {
    try {
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
