// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Express server that hosts VS Code Web with the ModelScript extension
// and a GitHub FileSystemProvider for loading GitHub repositories.

import express from "express";
import rateLimit from "express-rate-limit";
import { existsSync, readFileSync, watch } from "fs";
import path, { join, resolve } from "path";
import { renderLandingPageHtml } from "./landing-page.js";

const __dirname = import.meta.dirname;
const PORT = parseInt(process.env["PORT"] || "3003", 10);
const HOST = process.env["HOST"] || "0.0.0.0";

// Paths
const APP_ROOT = existsSync(resolve(__dirname, "package.json")) ? __dirname : resolve(__dirname, "..");
const VSCODE_WEB_DIR = resolve(APP_ROOT, "vscode-web");
const MODELSCRIPT_EXT_DIR = resolve(APP_ROOT, "dist", "extension");
const GITHUB_FS_EXT_DIR = resolve(APP_ROOT, "github-fs");
const VIEWS_DIR = existsSync(resolve(APP_ROOT, "src", "views"))
  ? resolve(APP_ROOT, "src", "views")
  : resolve(APP_ROOT, "views");
const TEST_WEB_DIR =
  [
    resolve(APP_ROOT, "..", "..", "node_modules", "@vscode", "test-web"),
    resolve(APP_ROOT, "node_modules", "@vscode", "test-web"),
    resolve(__dirname, "..", "..", "..", "node_modules", "@vscode", "test-web"),
  ].find(existsSync) || resolve(APP_ROOT, "..", "..", "node_modules", "@vscode", "test-web");

// ── Validate prerequisites ──

if (!existsSync(VSCODE_WEB_DIR)) {
  console.error("VS Code Web not found. Run: npm run download-vscode");
  process.exit(1);
}

if (!existsSync(MODELSCRIPT_EXT_DIR)) {
  console.error(`ModelScript extension not found at ${MODELSCRIPT_EXT_DIR}. Run: npm run build-extension`);
  process.exit(1);
}

// ── Read and cache the workbench template ──

/**
 * Loads the VS Code Web HTML workbench template (`workbench-esm.html` or fallback `workbench.html`)
 * from `@vscode/test-web`.
 */
function getWorkbenchTemplate(): string {
  // Prefer ESM template (VS Code >= 1.112)
  const esmPath = join(TEST_WEB_DIR, "views", "workbench-esm.html");
  if (existsSync(esmPath)) {
    return readFileSync(esmPath, "utf-8");
  }

  // Fallback to AMD template
  const amdPath = join(TEST_WEB_DIR, "views", "workbench.html");
  if (existsSync(amdPath)) {
    return readFileSync(amdPath, "utf-8");
  }

  throw new Error("No workbench template found in @vscode/test-web");
}

/**
 * Serializes `value` as JSON and escapes double quotes (`&quot;`) for embedding in HTML `data-settings` attributes.
 */
function escapeJSON(value: unknown): string {
  return JSON.stringify(value).replace(/"/g, "&quot;");
}

/**
 * Renders the full VS Code Web workbench HTML document configured with the ModelScript IDE extension,
 * `github-fs` virtual filesystem provider, Open VSX gallery, and hash-based workspace routing.
 */
function renderWorkbench(protocol: string, host: string, folderConfig: Record<string, unknown> | null): string {
  const baseUrl = `${protocol}://${host}/vscode-static`;
  const webEndpoint = `${protocol}://${host}/vscode-static`;

  const productConfiguration: Record<string, unknown> = {
    enableTelemetry: false,
    nameShort: "ModelScript",
    nameLong: "ModelScript IDE",
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
  };

  productConfiguration["webviewContentExternalBaseUrlTemplate"] =
    `${protocol}://${host}/vscode-static/out/vs/workbench/contrib/webview/browser/pre/`;

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

  const template = getWorkbenchTemplate();
  const esmMainPath = join(TEST_WEB_DIR, "out", "browser", "esm", "main.js");
  let mainScript: string;

  if (existsSync(esmMainPath)) {
    let mainJs = readFileSync(esmMainPath, "utf-8");
    mainJs = mainJs.replace("./workbench.api", `${baseUrl}/out/vs/workbench/workbench.web.main.internal.js`);
    mainScript = `<script src="${baseUrl}/out/nls.messages.js"></script>\n<script type="module">${mainJs}</script>`;
  } else {
    mainScript = `<script>document.body.textContent = 'Error: main.js not found at ${esmMainPath}';</script>`;
  }

  const html = template.replace(/\{\{([^}]+)\}\}/g, (_, key: string) => {
    switch (key) {
      case "WORKBENCH_WEB_CONFIGURATION":
        return escapeJSON(config);
      case "WORKBENCH_WEB_BASE_URL":
        return baseUrl;
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
        document.title = 'Artifact #' + template.slice(9) + (anchorParam ? ' (' + anchorParam + ')' : '') + ' — ModelScript IDE';
      } else if (template.startsWith('package-')) {
        document.title = 'Package ' + template.slice(8) + (anchorParam ? ' (' + anchorParam + ')' : '') + ' — ModelScript IDE';
      } else {
        document.title = 'New Project — ModelScript IDE';
      }
      config.folderUri = { scheme: 'memfs', authority: '', path: '/' + template };
    } else {
      var parts = hash.split('@');
      var ownerRepo = parts[0];
      var ref = parts[1] || 'main';
      var p = ownerRepo.split('/');
      var owner = p[0] || 'modelscript';
      var repo = p[1] || 'modelscript';
      document.title = owner + '/' + repo + ' — ModelScript IDE';
      config.folderUri = { scheme: 'github', authority: '', path: '/' + owner + '/' + repo, query: 'ref=' + ref };
    }
  }
  
  config.productConfiguration = config.productConfiguration || {};
  
  el.setAttribute('data-settings', JSON.stringify(config));

  // Notify parent window when embedded in ModelScript Hub shell
  if (window.parent && window.parent !== window) {
    try {
      window.parent.postMessage({ type: 'MODELSCRIPT_READY' }, window.location.origin);
    } catch (e) {}

    window.addEventListener('message', function(ev) {
      if (ev.origin !== window.location.origin && !ev.origin.endsWith('.modelscript.org')) return;
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
            document.title = ev.data.title + ' — ModelScript IDE';
          }
        } catch (e) {}
      }
    });
  }

  // Ensure drops over diagram webview iframes are allowed and forwarded with correct local coordinates
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

  return html.replace("</head>", patchScript + "\n</head>");
}

// ── Create Express app ──

const app = express();

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10000,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.url.startsWith("/vscode-static/") || req.url.startsWith("/static/"),
});
app.use(apiLimiter);

app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  next();
});

app.use((req, res, next) => {
  const coi = req.query["vscode-coi"];
  const isWorkerOrStatic =
    req.url.startsWith("/static/") ||
    req.url.startsWith("/vscode-static/") ||
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

app.use((req, _res, next) => {
  if (!req.url.startsWith("/vscode-static/out/vs/")) {
    console.log(`[HTTP] ${req.method} ${req.url}`);
  }
  next();
});

// ── Static file serving ──

app.use("/vscode-static", express.static(VSCODE_WEB_DIR, { dotfiles: "allow" }));

app.use(
  "/static/devextensions",
  (_req, res, next) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    next();
  },
  express.static(MODELSCRIPT_EXT_DIR, { dotfiles: "allow" }),
);

app.use("/static/extensions/github-fs", express.static(GITHUB_FS_EXT_DIR, { dotfiles: "allow" }));

const MODELS_DIR = resolve(__dirname, "..", "models");
app.use(
  "/api/models",
  (req, _res, next) => {
    req.url = req.url.replace(/\/resolve\/main\//g, "/");
    next();
  },
  express.static(MODELS_DIR),
);

const webFavicon = resolve(__dirname, "..", "..", "web", "public", "favicon.ico");
app.get("/favicon.ico", (_req, res) => {
  if (existsSync(webFavicon)) {
    res.sendFile(webFavicon);
  } else {
    res.status(404).end();
  }
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "ide" });
});

app.options("/api/github/*subpath", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Accept, User-Agent, Authorization");
  res.status(204).end();
});

app.use("/api/github", async (req, res) => {
  try {
    const upstreamUrl = new URL(req.url, "https://api.github.com");
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
  } catch (err) {
    res.status(502).json({ error: "GitHub proxy failed", details: String(err) });
  }
});

// ── User Language Registry API ──

function getUserLanguagesDir(): string {
  if (process.env["MODELSCRIPT_LANGUAGES_DIR"]) {
    return resolve(process.env["MODELSCRIPT_LANGUAGES_DIR"]);
  }
  const home = process.env["HOME"] || process.env["USERPROFILE"] || "";
  return join(home, ".modelscript", "languages");
}

app.get("/api/languages/user", (_req, res) => {
  const regPath = join(getUserLanguagesDir(), "registry.json");
  if (!existsSync(regPath)) {
    return res.json({ version: "1.0.0", languages: {} });
  }
  try {
    const raw = readFileSync(regPath, "utf-8");
    return res.type("application/json").send(raw);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

app.get("/api/languages/user/:id/parser.wasm", (req, res) => {
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

app.get("/api/languages/user/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  registryClients.push(res);

  req.on("close", () => {
    const idx = registryClients.indexOf(res);
    if (idx !== -1) registryClients.splice(idx, 1);
  });
});

const userLanguagesDir = getUserLanguagesDir();
if (existsSync(userLanguagesDir)) {
  try {
    watch(userLanguagesDir, (_eventType, filename) => {
      if (filename === "registry.json") {
        for (const client of registryClients) {
          client.write(`data: ${JSON.stringify({ event: "change" })}\n\n`);
        }
      }
    });
  } catch {
    // Directory may not exist yet
  }
}

// ── VS Code workbench route ──

app.get("/vscode/workbench", (req, res) => {
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

  const protocol = req.protocol;
  const host = req.get("host") || `${HOST}:${PORT}`;
  res.send(renderWorkbench(protocol, host, folderConfig));
});

// ── 2-Level Tile Landing Page ──

app.get("/", (_req, res) => {
  const landingPath = join(VIEWS_DIR, "landing.html");
  if (existsSync(landingPath)) {
    res.sendFile(landingPath);
  } else {
    res.send(renderLandingPageHtml());
  }
});

// ── Repository wrapper (iframe to VS Code) ──

app.get("/github.com/:owner/:repo", (req, res) => {
  const { owner, repo } = req.params;
  const ref = (req.query["ref"] as string) || "main";
  res.send(renderWrapper("github", owner, repo, ref));
});

app.get("/github.com/:owner/:repo/tree/:ref", (req, res) => {
  const { owner, repo, ref } = req.params;
  res.send(renderWrapper("github", owner, repo, ref));
});

app.get("/github.com/:owner/:repo/tree/:ref/*subpath", (req, res) => {
  const { owner, repo, ref } = req.params;
  res.send(renderWrapper("github", owner, repo, ref));
});

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderWrapper(provider: string, owner: string, repo: string, ref: string): string {
  const folderUri = `${provider}:///${owner}/${repo}?ref=${ref}`;
  const safeOwner = escapeHtml(owner);
  const safeRepo = escapeHtml(repo);
  const safeRef = escapeHtml(ref);
  const safeProvider = escapeHtml(provider);

  return `<!DOCTYPE html>
<html><head>
<title>${safeOwner}/${safeRepo} — ModelScript IDE</title>
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
  <a href="/">ModelScript</a>
  <span class="sep">/</span>
  <a href="/${safeProvider}.com/${safeOwner}/${safeRepo}">${safeOwner}<span class="sep">/</span><span class="repo">${safeRepo}</span></a>
  <span class="sep">@</span>
  <span style="color: #8b949e; font-family: monospace; font-size: 13px;">${safeRef}</span>
</div>
<iframe src="/vscode/workbench?folder=${encodeURIComponent(folderUri)}"></iframe>
</body></html>`;
}

// ── Start server ──

app.listen(PORT, HOST, () => {
  console.log(`ModelScript IDE running at http://${HOST}:${PORT}`);
  console.log(`  Try: http://${HOST}:${PORT}/github.com/modelscript/modelscript`);
});
