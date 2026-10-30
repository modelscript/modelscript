// SPDX-License-Identifier: AGPL-3.0-or-later

import express from "express";
import { existsSync, readFileSync, watch, type FSWatcher } from "node:fs";
import path, { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROUTES_DIR = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.resolve(ROUTES_DIR, "../..");
const REPO_ROOT = path.resolve(API_ROOT, "../..");
const DEFAULT_IDE_ROOT = path.resolve(REPO_ROOT, "apps/ide");

function getIdeRoot(): string {
  return process.env["IDE_ROOT"] ? path.resolve(process.env["IDE_ROOT"]) : DEFAULT_IDE_ROOT;
}

function getTestWebDir(ideRoot: string): string {
  const candidates = [
    resolve(REPO_ROOT, "node_modules", "@vscode", "test-web"),
    resolve(ideRoot, "node_modules", "@vscode", "test-web"),
    resolve(API_ROOT, "node_modules", "@vscode", "test-web"),
  ];
  return candidates.find(existsSync) || candidates[0]!;
}

function getWorkbenchTemplate(testWebDir: string): string | null {
  const esmPath = join(testWebDir, "views", "workbench-esm.html");
  if (existsSync(esmPath)) {
    return readFileSync(esmPath, "utf-8");
  }
  const amdPath = join(testWebDir, "views", "workbench.html");
  if (existsSync(amdPath)) {
    return readFileSync(amdPath, "utf-8");
  }
  return null;
}

function escapeJSON(value: unknown): string {
  return JSON.stringify(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Renders the VS Code Web workbench HTML document configured with the ModelScript IDE extension,
 * `github-fs` virtual filesystem provider, Open VSX gallery, and hash-based workspace routing.
 */
export function renderWorkbenchHtml(
  protocol: string,
  host: string,
  folderConfig: Record<string, unknown> | null,
  ideRoot = getIdeRoot(),
): { status: number; html: string } {
  const testWebDir = getTestWebDir(ideRoot);
  const template = getWorkbenchTemplate(testWebDir);
  if (!template) {
    return {
      status: 503,
      html: `<!DOCTYPE html><html><head><title>ModelScript IDE Unavailable</title></head><body style="background:#0d1117;color:#c9d1d9;font-family:system-ui,sans-serif;padding:32px;"><h2>VS Code Web workbench template not found</h2><p>Run <code>npm run download-vscode --workspace=@modelscript/ide &amp;&amp; npm run build-extension --workspace=@modelscript/ide</code> to initialize the local IDE bundle.</p></body></html>`,
    };
  }

  const relativeBaseUrl = "/vscode-static";
  const webEndpoint = `${protocol}://${host}/vscode-static`;

  const productConfiguration: Record<string, unknown> = {
    enableTelemetry: false,
    nameShort: "Ansatz",
    nameLong: "Ansatz IDE (Powered by ModelScript)",
    webEndpointUrlTemplate: webEndpoint,
    extensionAllowedProposedApi: ["modelscript.modelscript", "vscode.mermaid-markdown-features"],
    extensionEnabledApiProposals: {
      "vscode.mermaid-markdown-features": ["chatParticipantPrivate", "chatOutputRenderer"],
    },
    extensionGallery: {
      serviceUrl: "https://open-vsx.org/vscode/gallery",
      itemUrl: "https://open-vsx.org/vscode/item",
      resourceUrlTemplate: "https://open-vsx.org/vscode/unpkg/{publisher}/{name}/{version}/{path}",
      controlUrl: "",
    },
    webviewContentExternalBaseUrlTemplate: `${protocol}://${host}/vscode-static/out/vs/workbench/contrib/webview/browser/pre/`,
  };

  const extList = [
    { scheme: protocol, authority: host, path: "/static/devextensions" },
    { scheme: protocol, authority: host, path: "/static/extensions/github-fs" },
  ];

  const config: Record<string, unknown> = {
    additionalBuiltinExtensions: extList,
    productConfiguration,
    configurationDefaults: {
      "editor.codeLens": true,
      "editor.semanticHighlighting.enabled": true,
      "security.workspace.trust.enabled": false,
      "security.workspace.trust.startupPrompt": "never",
      "security.workspace.trust.banner": "never",
      "files.associations": {
        "*.cfg": "cfd",
        "*.cfgt": "cfd",
        "*.su2": "cfd",
        "*.inp": "fea",
        "*.inpt": "fea",
        "*.bdf": "fea",
        "*.swmm": "swmm",
        "*.epanet": "epanet",
        "*.jsbsim": "jsbsim",
        "*.sima": "sima",
        "*.plcopen": "plcopen",
        "*.st": "plcopen",
        "*.sbml": "sbml",
        "*.r5": "relap5",
      },
    },
  };

  if (folderConfig) {
    config["folderUri"] = folderConfig;
  }

  const esmMainPath = join(testWebDir, "out", "browser", "esm", "main.js");
  let mainScript: string;

  if (existsSync(esmMainPath)) {
    let mainJs = readFileSync(esmMainPath, "utf-8");
    mainJs = mainJs.replace("./workbench.api", `${relativeBaseUrl}/out/vs/workbench/workbench.web.main.internal.js`);
    mainScript = `<script src="${relativeBaseUrl}/out/nls.messages.js"></script>\n<script type="module">${mainJs}</script>`;
  } else {
    mainScript = `<script>document.body.textContent = 'Error: main.js not found at ${escapeHtml(esmMainPath)}';</script>`;
  }

  const html = template.replace(/\{\{([^}]+)\}\}/g, (_, key: string) => {
    switch (key) {
      case "WORKBENCH_WEB_CONFIGURATION":
        return escapeJSON(config);
      case "WORKBENCH_WEB_BASE_URL":
        return relativeBaseUrl;
      case "WORKBENCH_BUILTIN_EXTENSIONS":
        return escapeJSON([]);
      case "WORKBENCH_MAIN":
        return mainScript;
      default:
        return "undefined";
    }
  });

  const patchScript = `<script>
(function() {
  var originalWarn = console.warn;
  console.warn = function() {
    for (var i = 0; i < arguments.length; i++) {
      if (typeof arguments[i] === 'string' && (
        arguments[i].includes('ENOPRO: No file system provider found for resource') ||
        arguments[i].includes('No search provider registered for scheme: memfs') ||
        arguments[i].includes('Ignoring the error while validating workspace folder')
      )) return;
    }
    originalWarn.apply(console, arguments);
  };
  
  var el = document.getElementById('vscode-workbench-web-configuration');
  if (!el) return;
  var config = JSON.parse(el.getAttribute('data-settings'));
  
  var scheme = location.protocol.replace(':', '');
  var host = location.host;
  var extensions = [
    { scheme: scheme, authority: host, path: '/static/devextensions' },
    { scheme: scheme, authority: host, path: '/static/extensions/github-fs' }
  ];
  config.additionalBuiltinExtensions = extensions;
  delete config.developmentOptions;
  config.configurationDefaults = config.configurationDefaults || {};
  config.configurationDefaults["security.workspace.trust.enabled"] = false;
  config.configurationDefaults["security.workspace.trust.startupPrompt"] = "never";
  config.configurationDefaults["security.workspace.trust.banner"] = "never";
  config.configurationDefaults["editor.codeLens"] = true;
  config.configurationDefaults["files.associations"] = {
    "*.cfg": "cfd",
    "*.cfgt": "cfd",
    "*.su2": "cfd",
    "*.inp": "fea",
    "*.inpt": "fea",
    "*.bdf": "fea",
    "*.swmm": "swmm",
    "*.epanet": "epanet",
    "*.jsbsim": "jsbsim",
    "*.sima": "sima",
    "*.plcopen": "plcopen",
    "*.st": "plcopen",
    "*.sbml": "sbml",
    "*.r5": "relap5"
  };
  
  var builtinEl = document.getElementById('vscode-workbench-builtin-extensions');
  if (builtinEl) {
    builtinEl.setAttribute('data-settings', JSON.stringify([]));
  }
  
  var hash = location.hash.slice(1);
  if (hash) {
    if (hash.startsWith('memfs')) {
      var rawTemplate = hash.split(':')[1] || 'empty';
      var templateParts = rawTemplate.split('&');
      var template = templateParts[0];
      var anchorParam = null;
      for (var i = 1; i < templateParts.length; i++) {
        if (templateParts[i].startsWith('anchor=')) {
          anchorParam = decodeURIComponent(templateParts[i].slice(7));
          try {
            sessionStorage.setItem('modelscript.initialAnchor', anchorParam);
          } catch (e) {}
        }
      }
      if (template.startsWith('artifact-')) {
        document.title = 'Artifact #' + template.slice(9) + (anchorParam ? ' (' + anchorParam + ')' : '') + ' — Ansatz IDE (Powered by ModelScript)';
      } else if (template.startsWith('package-')) {
        document.title = 'Package ' + template.slice(8) + (anchorParam ? ' (' + anchorParam + ')' : '') + ' — Ansatz IDE (Powered by ModelScript)';
      } else {
        document.title = 'New Project — Ansatz IDE (Powered by ModelScript)';
      }
      config.folderUri = { scheme: 'memfs', authority: '', path: '/' + template };
    } else {
      var parts = hash.split('@');
      var ownerRepo = parts[0];
      var ref = parts[1] || 'main';
      var p = ownerRepo.split('/');
      var owner = p[0] || 'modelscript';
      var repo = p[1] || 'modelscript';
      document.title = owner + '/' + repo + ' — Ansatz IDE (Powered by ModelScript)';
      config.folderUri = { scheme: 'github', authority: '', path: '/' + owner + '/' + repo, query: 'ref=' + ref };
    }
  }
  
  config.productConfiguration = config.productConfiguration || {};
  config.productConfiguration.webEndpointUrlTemplate = location.origin + '/vscode-static';
  config.productConfiguration.webviewContentExternalBaseUrlTemplate = location.origin + '/vscode-static/out/vs/workbench/contrib/webview/browser/pre/';
  
  el.setAttribute('data-settings', JSON.stringify(config));

  if (window.parent && window.parent !== window) {
    try {
      window.parent.postMessage({ type: 'MODELSCRIPT_READY' }, window.location.origin);
    } catch (e) {}

    window.addEventListener('message', function(ev) {
      if (ev.origin !== window.location.origin && !ev.origin.endsWith('.ansatz.social') && !ev.origin.endsWith('.modelscript.org')) return;
      if (!ev.data || typeof ev.data !== 'object') return;
      if (ev.data.type === 'MODELSCRIPT_AUTH_SYNC' && ev.data.token) {
        try {
          sessionStorage.setItem('modelscript.token', ev.data.token);
          if (ev.data.user) {
            sessionStorage.setItem('modelscript.user', JSON.stringify(ev.data.user));
          }
        } catch (e) {}
      }
      if (ev.data.type === 'MODELSCRIPT_MOUNT_ARTIFACT' && ev.data.artifactId) {
        try {
          sessionStorage.setItem('modelscript.artifact_' + ev.data.artifactId, JSON.stringify(ev.data));
          if (ev.data.title) {
            document.title = ev.data.title + ' — Ansatz IDE (Powered by ModelScript)';
          }
        } catch (e) {}
      }
    });
  }

  function forwardToWebviews(type, clientX, clientY, extra) {
    try {
      var iframes = document.querySelectorAll('iframe');
      for (var i = 0; i < iframes.length; i++) {
        var iframe = iframes[i];
        var r = iframe.getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
          var localX = clientX - r.left;
          var localY = clientY - r.top;
          var msg = Object.assign({ type: type, clientX: localX, clientY: localY }, extra || {});
          if (iframe.contentWindow) {
            iframe.contentWindow.postMessage(msg, '*');
            try {
              var innerFrames = iframe.contentDocument ? iframe.contentDocument.querySelectorAll('iframe') : [];
              for (var j = 0; j < innerFrames.length; j++) {
                var inner = innerFrames[j];
                var innerRect = inner.getBoundingClientRect();
                var innerX = localX - innerRect.left;
                var innerY = localY - innerRect.top;
                if (inner.contentWindow) {
                  inner.contentWindow.postMessage(Object.assign({}, msg, { clientX: innerX, clientY: innerY }), '*');
                }
              }
            } catch (innerErr) {
              try {
                for (var k = 0; k < iframe.contentWindow.frames.length; k++) {
                  iframe.contentWindow.frames[k].postMessage(msg, '*');
                }
              } catch (e2) {}
            }
          }
        }
      }
    } catch (err) {}
  }

  window.addEventListener('dragover', function(e) {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
    forwardToWebviews('workbenchDragOver', e.clientX, e.clientY);
  }, true);

  window.addEventListener('drop', function(e) {
    e.preventDefault();
    var extra = {};
    try {
      if (e.dataTransfer) {
        extra.className = e.dataTransfer.getData('application/vnd.modelscript.classname');
        extra.iconSvg = e.dataTransfer.getData('application/vnd.modelscript.iconsvg');
        extra.json = e.dataTransfer.getData('application/json');
      }
    } catch (mErr) {}
    forwardToWebviews('workbenchDrop', e.clientX, e.clientY, extra);
  }, true);

  window.addEventListener('dragend', function() {
    try {
      var iframes = document.querySelectorAll('iframe');
      for (var i = 0; i < iframes.length; i++) {
        if (iframes[i].contentWindow) {
          iframes[i].contentWindow.postMessage({ type: 'dragEnd' }, '*');
          try {
            for (var k = 0; k < iframes[i].contentWindow.frames.length; k++) {
              iframes[i].contentWindow.frames[k].postMessage({ type: 'dragEnd' }, '*');
            }
          } catch (e2) {}
        }
      }
    } catch (err) {}
  }, true);
})();
</script>`;

  return {
    status: 200,
    html: html.replace("</head>", patchScript + "\n</head>"),
  };
}

function renderWrapper(provider: string, owner: string, repo: string, ref: string): string {
  const folderUri = `${provider}:///${owner}/${repo}?ref=${ref}`;
  const safeOwner = escapeHtml(owner);
  const safeRepo = escapeHtml(repo);
  const safeRef = escapeHtml(ref);
  const safeProvider = escapeHtml(provider);

  return `<!DOCTYPE html>
<html><head>
<title>${safeOwner}/${safeRepo} — Ansatz IDE (Powered by ModelScript)</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #1e1e1e; overflow: hidden; }
  .header { height: 36px; background: #0d1117; border-bottom: 1px solid #30363d; display: flex; align-items: center; padding: 0 16px; }
  .header a { color: #58a6ff; text-decoration: none; font-family: system-ui, sans-serif; font-size: 14px; }
  .header a:hover { text-decoration: underline; }
  .header .sep { color: #484f58; margin: 0 8px; }
  .header .repo { color: #c9d1d9; font-weight: 600; }
  iframe { width: 100%; height: calc(100vh - 36px); border: none; }
</style>
</head><body>
<div class="header">
  <a href="/">Ansatz</a>
  <span class="sep">/</span>
  <a href="/${safeProvider}.com/${safeOwner}/${safeRepo}">${safeOwner}<span class="sep">/</span><span class="repo">${safeRepo}</span></a>
  <span class="sep">@</span>
  <span style="color: #8b949e; font-family: monospace; font-size: 13px;">${safeRef}</span>
</div>
<iframe src="/vscode/workbench?folder=${encodeURIComponent(folderUri)}"></iframe>
</body></html>`;
}

function getUserLanguagesDir(): string {
  if (process.env["MODELSCRIPT_LANGUAGES_DIR"]) {
    return resolve(process.env["MODELSCRIPT_LANGUAGES_DIR"]);
  }
  const home = process.env["HOME"] || process.env["USERPROFILE"] || "";
  return join(home, ".modelscript", "languages");
}

/**
 * Creates the Express router serving the integrated VS Code Web IDE workbench,
 * extension assets, WebLLM model weights, user language registry, and GitHub API proxy.
 */
export function ideWorkbenchRouter(): express.Router {
  const router = express.Router();
  const ideRoot = getIdeRoot();
  const vscodeWebDir = resolve(ideRoot, "vscode-web");
  const modelscriptExtDir = resolve(ideRoot, "dist", "extension");
  const githubFsExtDir = resolve(ideRoot, "github-fs");
  const modelsDir = resolve(ideRoot, "models");

  // COOP / COEP & CORP headers for VS Code Web SharedArrayBuffer and worker isolation
  router.use((req, res, next) => {
    const coi = req.query["vscode-coi"];
    const isIdeAsset =
      req.path.startsWith("/vscode/") ||
      req.path.startsWith("/vscode-static/") ||
      req.path.startsWith("/static/devextensions") ||
      req.path.startsWith("/static/extensions/github-fs") ||
      req.path.startsWith("/api/models/");

    if (isIdeAsset) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.removeHeader("X-Frame-Options");
    }

    const isWorkerOrStatic =
      req.path.startsWith("/static/devextensions") ||
      req.path.startsWith("/static/extensions/github-fs") ||
      req.path.startsWith("/vscode-static/") ||
      req.headers["sec-fetch-dest"] === "worker" ||
      req.headers["sec-fetch-dest"] === "sharedworker";

    if (coi === "1") {
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    } else if (coi === "2") {
      res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
    } else if (coi === "3" || coi === "" || isWorkerOrStatic) {
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
    }
    next();
  });

  // Static mounts for VS Code Web, ModelScript Extension, GitHub FS, and WebLLM models
  router.use("/vscode-static", express.static(vscodeWebDir, { dotfiles: "allow" }));

  router.use(
    "/static/devextensions",
    (_req, res, next) => {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      next();
    },
    express.static(modelscriptExtDir, { dotfiles: "allow" }),
  );

  router.use("/static/extensions/github-fs", express.static(githubFsExtDir, { dotfiles: "allow" }));

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

  router.use("/api/github", async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
      res.status(405).json({ error: "Method not allowed on GitHub read-only proxy" });
      return;
    }
    try {
      const cleanSubpath = "/" + (req.url || "/").replace(/^\/+/, "");
      const upstreamUrl = new URL(cleanSubpath, "https://api.github.com");
      if (upstreamUrl.origin !== "https://api.github.com" || cleanSubpath.includes("..")) {
        res.status(400).json({ error: "Invalid GitHub API path" });
        return;
      }
      const headers: Record<string, string> = {
        "User-Agent": "ModelScript-IDE",
        Accept: (req.headers["accept"] as string) || "application/vnd.github.v3+json",
      };
      const token = process.env["GITHUB_TOKEN"];
      if (token) {
        headers["Authorization"] = `token ${token}`;
      } else if (req.headers["authorization"]) {
        headers["Authorization"] = req.headers["authorization"] as string;
      }

      const response = await fetch(upstreamUrl.toString(), {
        method: req.method,
        headers,
      });

      res.status(response.status);
      response.headers.forEach((val, key) => {
        const lower = key.toLowerCase();
        if (lower !== "content-encoding" && lower !== "transfer-encoding") {
          res.setHeader(key, val);
        }
      });

      const buffer = Buffer.from(await response.arrayBuffer());
      res.send(buffer);
    } catch {
      res.status(502).json({ error: "GitHub proxy failed" });
    }
  });

  // User Language Registry API
  router.get("/api/languages/user", (_req, res) => {
    const regPath = join(getUserLanguagesDir(), "registry.json");
    if (!existsSync(regPath)) {
      return res.json({ version: "1.0.0", languages: {} });
    }
    try {
      const raw = readFileSync(regPath, "utf-8");
      return res.type("application/json").send(raw);
    } catch {
      return res.status(500).json({ error: "Failed to read user language registry" });
    }
  });

  router.get("/api/languages/user/:id/parser.wasm", (req, res) => {
    const rawId = req.params.id;
    if (!rawId || typeof rawId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(rawId)) {
      res.status(400).type("text/plain").send("Invalid language ID");
      return;
    }
    const langId = path.basename(rawId);
    const baseDir = getUserLanguagesDir();
    const langDir = resolve(baseDir, langId);
    if (!langDir.startsWith(baseDir + path.sep) && langDir !== baseDir) {
      res.status(400).type("text/plain").send("Invalid language directory");
      return;
    }
    const candidates = [
      join(langDir, "parser.wasm"),
      join(langDir, "dist", "parser.wasm"),
      join(langDir, `${langId}.wasm`),
    ];
    const found = candidates.find(existsSync);
    if (found) {
      res.type("application/wasm").sendFile(found);
    } else {
      res.status(404).type("text/plain").send(`parser.wasm for user language '${langId}' not found`);
    }
  });

  const registryClients: express.Response[] = [];
  let registryWatcher: FSWatcher | null = null;

  router.get("/api/languages/user/events", (req, res) => {
    if (registryClients.length >= 100) {
      res.status(429).json({ error: "Too many active language event listeners" });
      return;
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    registryClients.push(res);

    if (!registryWatcher && process.env["NODE_ENV"] !== "test") {
      const userLanguagesDir = getUserLanguagesDir();
      if (existsSync(userLanguagesDir)) {
        try {
          registryWatcher = watch(userLanguagesDir, (_eventType, filename) => {
            if (filename === "registry.json") {
              for (const client of registryClients) {
                client.write(`data: ${JSON.stringify({ event: "change" })}\n\n`);
              }
            }
          });
          registryWatcher.unref?.();
        } catch {
          // Directory may not be watchable
        }
      }
    }

    req.on("close", () => {
      const idx = registryClients.indexOf(res);
      if (idx !== -1) registryClients.splice(idx, 1);
      if (registryClients.length === 0 && registryWatcher) {
        registryWatcher.close();
        registryWatcher = null;
      }
    });
  });

  // VS Code Web Workbench HTML endpoint
  router.get("/vscode/workbench", (req, res) => {
    const folder = (req.query["folder"] as string) || "";
    let folderConfig: Record<string, unknown> | null = null;

    if (folder) {
      if (folder.startsWith("memfs:")) {
        const template = folder.split(":")[1] || "empty";
        folderConfig = { scheme: "memfs", authority: "", path: "/" + template };
      } else {
        const match = folder.match(/^github:\/\/\/([^/]+)\/([^/?]+)(?:\?ref=(.+))?$/);
        if (!match) {
          res.status(400).send("Invalid folder URI. Expected: github:///owner/repo?ref=branch or memfs:template");
          return;
        }
        const [, owner, repo, ref = "main"] = match;
        folderConfig = {
          scheme: "github",
          authority: "",
          path: `/${owner}/${repo}`,
          query: `ref=${ref}`,
        };
      }
    }

    const trustProxy = process.env["TRUST_PROXY"] === "true";
    const forwardedProto = trustProxy ? req.headers["x-forwarded-proto"] : undefined;
    const rawProto = forwardedProto ? String(forwardedProto).split(",")[0]!.trim() : req.protocol || "http";
    const protocol = rawProto === "https" ? "https" : "http";
    const forwardedHost = trustProxy ? req.headers["x-forwarded-host"] : undefined;
    const rawHost = forwardedHost ? String(forwardedHost).split(",")[0]!.trim() : req.get("host") || "localhost:3000";
    const host = /^[a-zA-Z0-9._:-]+$/.test(rawHost) ? rawHost : "localhost:3000";
    const { status, html } = renderWorkbenchHtml(protocol, host, folderConfig, ideRoot);
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

  return router;
}
