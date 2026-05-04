// SPDX-License-Identifier: AGPL-3.0-or-later

import { Router } from "express";
import { getCommits, getProject, getRepositoryFileRaw, getRepositoryTree, GitlabError } from "../util/gitlab.js";

export function gitlabRouter(): Router {
  const router = Router();

  /**
   * Get project metadata
   * Example: GET /api/v1/gitlab/projects/modelscript%2Fcore
   */
  router.get("/projects/:id", async (req, res) => {
    try {
      const project = await getProject(req.params.id);
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
   * Example: GET /api/v1/gitlab/projects/modelscript%2Fcore/repository/tree?ref=main&path=src
   */
  router.get("/projects/:id/repository/tree", async (req, res) => {
    try {
      const ref = (req.query.ref as string) || "main";
      const path = (req.query.path as string) || "";
      const tree = await getRepositoryTree(req.params.id, ref, path);
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
   * Example: GET /api/v1/gitlab/projects/modelscript%2Fcore/repository/files/README.md/raw?ref=main
   */
  router.get("/projects/:id/repository/files/:file_path/raw", async (req, res) => {
    try {
      const ref = (req.query.ref as string) || "main";
      const rawContent = await getRepositoryFileRaw(req.params.id, req.params.file_path, ref);
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
   * Example: GET /api/v1/gitlab/projects/modelscript%2Fcore/repository/commits?ref_name=main
   */
  router.get("/projects/:id/repository/commits", async (req, res) => {
    try {
      const refName = (req.query.ref_name as string) || "main";
      const commits = await getCommits(req.params.id, refName);
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
      const ref = (req.query.ref as string) || "main";
      const encodedId = encodeURIComponent(req.params.id);
      const url = `/projects/${encodedId}/pipelines?ref=${encodeURIComponent(ref)}`;

      const { gitlabRequest } = await import("../util/gitlab.js");
      const pipelines = await gitlabRequest(url);
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
      const encodedId = encodeURIComponent(req.params.id);
      const url = `/projects/${encodedId}/pipelines/${req.params.pipeline_id}/jobs`;

      const { gitlabRequest } = await import("../util/gitlab.js");
      const jobs = await gitlabRequest(url);
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
      const encodedId = encodeURIComponent(req.params.id);
      const url = `/projects/${encodedId}/issues?state=opened`;
      const { gitlabRequest } = await import("../util/gitlab.js");
      const issues = await gitlabRequest(url);
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
  router.post("/projects/:id/issues", async (req, res) => {
    try {
      const encodedId = encodeURIComponent(req.params.id);
      const url = `/projects/${encodedId}/issues`;
      const { gitlabRequest } = await import("../util/gitlab.js");
      const issue = await gitlabRequest(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body),
      });
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
      const encodedId = encodeURIComponent(req.params.id);
      const url = `/projects/${encodedId}/merge_requests?state=opened`;
      const { gitlabRequest } = await import("../util/gitlab.js");
      const mrs = await gitlabRequest(url);
      res.json(mrs);
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
