// SPDX-License-Identifier: AGPL-3.0-or-later

import express from "express";
import { readFileSync } from "node:fs";
import type { LibraryDatabase } from "../database.js";
import { optionalAuth } from "../middleware/auth-middleware.js";
import {
  applyIdeIsolationHeaders,
  parseWorkbenchFolderConfig,
  patchWebviewPreHtml,
  proxyGitHubApiRequest,
  readUserLanguageRegistry,
  renderWorkbenchHtml,
  renderWrapper,
  resolveIdeAssetPaths,
  resolveUserLanguageWasmPath,
  resolveWebviewPreHtmlPath,
  resolveWorkbenchOrigin,
  UserLanguageRegistryEventBus,
} from "../services/ide-workbench-service.js";
import { LocalGitVaultService } from "../services/local-git-vault.js";

export { patchWebviewPreHtml, renderWorkbenchHtml };

const NO_CACHE_MIDDLEWARE: express.RequestHandler = (_req, res, next) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
};

/**
 * Creates the Express router serving the integrated VS Code Web IDE workbench,
 * extension assets, WebLLM model weights, user language registry, and GitHub API proxy.
 */
export function ideWorkbenchRouter(database?: LibraryDatabase): express.Router {
  const router = express.Router();
  const { ideRoot, vscodeWebDir, modelscriptExtDir, githubFsExtDir, modelsDir } = resolveIdeAssetPaths();
  const gitVault = new LocalGitVaultService();
  const registryEvents = new UserLanguageRegistryEventBus();

  // COOP / COEP & CORP headers for VS Code Web SharedArrayBuffer and worker isolation
  router.use((req, res, next) => {
    applyIdeIsolationHeaders(req, res);
    next();
  });

  // Dynamically patch webview host pages so same-origin deployments (e.g. ansatz.social, modelscript.org)
  // always pass HostMessaging.signalReady() even if vscode-web was cached before the patch
  router.get(
    [
      "/vscode-static/out/vs/workbench/contrib/webview/browser/pre/index.html",
      "/vscode-static/out/vs/workbench/contrib/webview/browser/pre/index-no-csp.html",
    ],
    (req, res, next) => {
      const filePath = resolveWebviewPreHtmlPath(vscodeWebDir, req.path);
      if (!filePath) {
        next();
        return;
      }
      try {
        const raw = readFileSync(filePath, "utf-8");
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.type("text/html").send(patchWebviewPreHtml(raw));
      } catch {
        next();
      }
    },
  );

  // Static mounts for VS Code Web, ModelScript Extension, Ansatz LSP, GitHub FS, and WebLLM models
  router.use("/vscode-static", express.static(vscodeWebDir, { dotfiles: "ignore" }));
  router.use(
    ["/static/devextensions", "/lsp"],
    NO_CACHE_MIDDLEWARE,
    express.static(modelscriptExtDir, { dotfiles: "ignore" }),
  );
  router.use(
    "/static/extensions/github-fs",
    NO_CACHE_MIDDLEWARE,
    express.static(githubFsExtDir, { dotfiles: "ignore" }),
  );
  router.use(
    "/api/models",
    (req, _res, next) => {
      req.url = req.url.replace(/\/resolve\/main\//g, "/");
      next();
    },
    express.static(modelsDir),
  );

  // GitHub API CORS Proxy for github-fs virtual filesystem
  router.options("/api/github/*subpath", (_req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Accept, User-Agent, Authorization");
    res.status(204).end();
  });

  router.use("/api/github", optionalAuth, async (req, res) => {
    await proxyGitHubApiRequest(req, res, gitVault, database);
  });

  // User Language Registry API
  router.get("/api/languages/user", (_req, res) => {
    const result = readUserLanguageRegistry();
    if (result.status === "missing") {
      return res.json({ version: "1.0.0", languages: {} });
    }
    if (result.status === "ok") {
      return res.type("application/json").send(result.raw);
    }
    console.error("[IDE Workbench] Failed to read user language registry:", result.error);
    return res.status(500).json({ error: "Failed to read user language registry" });
  });

  router.get("/api/languages/user/:id/parser.wasm", (req, res) => {
    const resolved = resolveUserLanguageWasmPath(req.params.id);
    if (!resolved.ok) {
      res.status(resolved.status).type("text/plain").send(resolved.message);
      return;
    }
    res.type("application/wasm").sendFile(resolved.filePath);
  });

  router.get("/api/languages/user/events", (_req, res) => {
    registryEvents.subscribe(res);
  });

  // VS Code Web Workbench HTML endpoint
  router.get("/vscode/workbench", (req, res) => {
    const rawFolder =
      (req.query["folder"] as string) || (req.query["template"] ? `memfs:${req.query["template"]}` : "");
    const parsed = parseWorkbenchFolderConfig(rawFolder);
    if (!parsed.ok) {
      res.status(400).send(parsed.error);
      return;
    }

    const { protocol, host } = resolveWorkbenchOrigin(req);
    const { status, html } = renderWorkbenchHtml(protocol, host, parsed.folderConfig, ideRoot);
    res.status(status).type("text/html").send(html);
  });

  // Direct GitHub repository wrapper routes
  router.get("/github.com/:owner/:repo", (req, res) => {
    const { owner, repo } = req.params;
    const ref = (req.query["ref"] as string) || "main";
    res.send(renderWrapper("github", owner, repo, ref));
  });

  router.get("/github.com/:owner/:repo/tree/:ref", (req, res) => {
    const { owner, repo, ref } = req.params;
    res.send(renderWrapper("github", owner, repo, ref));
  });

  router.get("/github.com/:owner/:repo/tree/:ref/*subpath", (req, res) => {
    const { owner, repo, ref } = req.params;
    res.send(renderWrapper("github", owner, repo, ref));
  });

  // Direct GitLab repository wrapper routes
  router.get("/gitlab.com/:owner/:repo", (req, res) => {
    const { owner, repo } = req.params;
    const ref = (req.query["ref"] as string) || "main";
    res.send(renderWrapper("gitlab", owner, repo, ref));
  });

  router.get("/gitlab.com/:owner/:repo/tree/:ref", (req, res) => {
    const { owner, repo, ref } = req.params;
    res.send(renderWrapper("gitlab", owner, repo, ref));
  });

  router.get("/gitlab.com/:owner/:repo/-/tree/:ref", (req, res) => {
    const { owner, repo, ref } = req.params;
    res.send(renderWrapper("gitlab", owner, repo, ref));
  });

  router.get("/gitlab.com/:owner/:repo/-/tree/:ref/*subpath", (req, res) => {
    const { owner, repo, ref } = req.params;
    res.send(renderWrapper("gitlab", owner, repo, ref));
  });

  // Direct Ansatz Space repository wrapper routes
  router.get("/ansatz.social/:owner/:repo", (req, res) => {
    const { owner, repo } = req.params;
    const ref = (req.query["ref"] as string) || "main";
    res.send(renderWrapper("ansatz", owner, repo, ref));
  });

  router.get("/ansatz.social/:owner/:repo/tree/:ref", (req, res) => {
    const { owner, repo, ref } = req.params;
    res.send(renderWrapper("ansatz", owner, repo, ref));
  });

  router.get("/ansatz.social/:owner/:repo/tree/:ref/*subpath", (req, res) => {
    const { owner, repo, ref } = req.params;
    res.send(renderWrapper("ansatz", owner, repo, ref));
  });

  return router;
}
