// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Express server that hosts VS Code Web with the ModelScript extension
// and a GitHub FileSystemProvider for loading GitHub repositories.

import express from "express";
import { existsSync, readFileSync } from "fs";
import { createProxyMiddleware } from "http-proxy-middleware";
import { join, resolve } from "path";

const __dirname = import.meta.dirname;
const PORT = parseInt(process.env.PORT || "3200", 10);
const HOST = process.env.HOST || "localhost";

// Paths
const VSCODE_WEB_DIR = resolve(__dirname, "..", "vscode-web");
const MODELSCRIPT_EXT_DIR = resolve(__dirname, "..", "..", "vscode");
const GITHUB_FS_EXT_DIR = resolve(__dirname, "..", "github-fs");
const VIEWS_DIR = resolve(__dirname, "views");

// ── Validate prerequisites ──

if (!existsSync(VSCODE_WEB_DIR)) {
  console.error("VS Code Web not found. Run: npm run download-vscode");
  process.exit(1);
}

// ── Read and cache the workbench template ──

function getWorkbenchTemplate(): string {
  const testWebDir = resolve(__dirname, "..", "..", "..", "node_modules", "@vscode", "test-web");

  // Prefer ESM template (VS Code >= 1.112)
  const esmPath = join(testWebDir, "views", "workbench-esm.html");
  if (existsSync(esmPath)) {
    return readFileSync(esmPath, "utf-8");
  }

  // Fallback to AMD template
  const amdPath = join(testWebDir, "views", "workbench.html");
  if (existsSync(amdPath)) {
    return readFileSync(amdPath, "utf-8");
  }

  throw new Error("No workbench template found in @vscode/test-web");
}

function escapeJSON(value: unknown): string {
  return JSON.stringify(value).replace(/"/g, "&quot;");
}

function renderWorkbench(protocol: string, host: string, folderConfig: Record<string, unknown> | null): string {
  const baseUrl = `${protocol}://${host}/vscode-static`;

  // Use UUID subdomains on localhost (Chrome resolves *.localhost automatically).
  // On production, use same-origin since wildcard DNS is not configured.
  const isLocalhost = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const webEndpoint = isLocalhost
    ? `${protocol}://{{uuid}}.${host}/vscode-static`
    : `${protocol}://${host}/vscode-static`;

  const productConfiguration: Record<string, unknown> = {
    enableTelemetry: false,
    nameShort: "ModelScript",
    nameLong: "ModelScript IDE",
    webEndpointUrlTemplate: webEndpoint,
    extensionAllowedProposedApi: ["modelscript.modelscript"],
    // Use Open VSX registry to avoid CORS errors with Microsoft's CDN
    extensionGallery: {
      serviceUrl: "https://open-vsx.org/vscode/gallery",
      itemUrl: "https://open-vsx.org/vscode/item",
      resourceUrlTemplate: "https://open-vsx.org/vscode/unpkg/{publisher}/{name}/{version}/{path}",
      controlUrl: "",
    },
  };

  if (isLocalhost) {
    productConfiguration.webviewContentExternalBaseUrlTemplate = `${protocol}://{{uuid}}.${host}/vscode-static/out/vs/workbench/contrib/webview/browser/pre/`;
  }

  const config: Record<string, unknown> = {
    additionalBuiltinExtensions: [],
    developmentOptions: {
      extensions: [
        { scheme: protocol, authority: host, path: "/static/devextensions" },
        { scheme: protocol, authority: host, path: "/static/extensions/github-fs" },
      ],
    },
    productConfiguration,
  };

  if (folderConfig) {
    config.folderUri = folderConfig;
  }

  const template = getWorkbenchTemplate();

  // main.js lives inside @vscode/test-web, not in the downloaded build
  const testWebDir = resolve(__dirname, "..", "..", "..", "node_modules", "@vscode", "test-web");
  const esmMainPath = join(testWebDir, "out", "browser", "esm", "main.js");
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
  var hash = location.hash.slice(1);
  if (!hash) return; // if no hash, trust the server's config (from ?folder=)
  
  var el = document.getElementById('vscode-workbench-web-configuration');
  if (!el) return;
  var config = JSON.parse(el.getAttribute('data-settings'));
  
  if (hash.startsWith('memfs')) {
    var template = hash.split(':')[1] || 'empty';
    document.title = 'New Project — ModelScript IDE';
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
  
  config.productConfiguration = config.productConfiguration || {};
  
  el.setAttribute('data-settings', JSON.stringify(config));
})();
</script>`;

  return html.replace("</head>", patchScript + "\n</head>");
}

// ── Create Express app ──

const app = express();

// CORS headers for VS Code Web — the extension host runs in a blob worker
// with a different origin, so we need permissive CORS.
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  next();
});

// COI headers (required for SharedArrayBuffer)
app.use((req, res, next) => {
  const coi = req.query["vscode-coi"];
  if (coi === "1") {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  } else if (coi === "2") {
    res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
  } else if (coi === "3" || coi === "") {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
  }
  next();
});

// ── Static file serving ──

// VS Code Web assets
app.use("/vscode-static", express.static(VSCODE_WEB_DIR, { dotfiles: "allow" }));

// ModelScript extension
app.use("/static/devextensions", express.static(MODELSCRIPT_EXT_DIR, { dotfiles: "allow" }));

// GitHub FS extension
app.use("/static/extensions/github-fs", express.static(GITHUB_FS_EXT_DIR, { dotfiles: "allow" }));

// WebLLM model files (self-hosted to avoid COEP issues with external CDNs)
// WebLLM constructs URLs as ${model}/resolve/main/${file} (HuggingFace pattern).
// Strip /resolve/main/ so local files resolve correctly.
const MODELS_DIR = resolve(__dirname, "..", "models");
app.use(
  "/api/models",
  (req, _res, next) => {
    req.url = req.url.replace(/\/resolve\/main\//g, "/");
    next();
  },
  express.static(MODELS_DIR),
);

// Favicon
const morselFavicon = resolve(__dirname, "..", "..", "morsel", "public", "favicon.ico");
app.get("/favicon.ico", (req, res) => {
  if (existsSync(morselFavicon)) {
    res.sendFile(morselFavicon);
  } else {
    res.status(404).end();
  }
});

// CORS preflight handler for the proxy
app.options("/api/github/*subpath", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Accept, User-Agent, Authorization");
  res.status(204).end();
});

app.use(
  "/api/github",
  createProxyMiddleware({
    target: "https://api.github.com",
    changeOrigin: true,
    pathRewrite: { "^/api/github": "" },
    on: {
      proxyReq: (proxyReq) => {
        proxyReq.setHeader("User-Agent", "ModelScript-IDE");
        // Forward GitHub token if available
        const token = process.env.GITHUB_TOKEN;
        if (token) {
          proxyReq.setHeader("Authorization", `token ${token}`);
        }
      },
    },
  }),
);

// ── VS Code workbench route ──

app.get("/vscode/workbench", (req, res) => {
  const folder = (req.query.folder as string) || "";
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

// ── Landing page ──

app.get("/", (_req, res) => {
  const landingPath = join(VIEWS_DIR, "landing.html");
  if (existsSync(landingPath)) {
    res.sendFile(landingPath);
  } else {
    res.send(`<!DOCTYPE html>
<html><head><title>ModelScript IDE</title>
<link rel="icon" href="/favicon.ico">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; background: #0d1117; color: #c9d1d9; display: flex; align-items: center; justify-content: center; height: 100vh; }
  .container { text-align: center; width: 100%; max-width: 800px; padding: 0 20px; }
  h1 { font-size: 2.5rem; margin-bottom: 0.5rem; background: linear-gradient(135deg, #58a6ff, #bc8cff); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  p { margin-bottom: 2rem; opacity: 0.7; }
  .divider { display: flex; align-items: center; gap: 16px; margin: 2rem 0; color: #484f58; font-size: 14px; }
  .divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: #30363d; }
  input { width: 100%; padding: 14px 20px; border-radius: 8px; border: 1px solid #30363d; background: #161b22; color: #c9d1d9; font-size: 16px; outline: none; }
  input:focus { border-color: #58a6ff; }
  .templates { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin-top: 1rem; }
  .tpl-card { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 16px; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 12px; transition: background-color 0.2s, transform 0.2s; text-decoration: none; color: #c9d1d9; }
  .tpl-card.dash { border-style: dashed; }
  .tpl-card:hover { background: #21262d; transform: translateY(-4px); }
  .tpl-icon { width: 80px; height: 80px; display: flex; align-items: center; justify-content: center; background: #0d1117; border-radius: 8px; color: #8b949e; }
  .tpl-name { font-size: 14px; font-weight: 500; text-align: center; }
</style>
</head><body>
<div class="container">
  <h1>ModelScript IDE</h1>
  <p>A browser-based Modelica development environment</p>
  <form onsubmit="event.preventDefault(); go();">
    <input id="url" type="text" placeholder="Enter a GitHub repository, e.g. owner/repo" autofocus />
  </form>
  <div class="divider">or start a new project</div>
  <div class="templates">
    <a href="/vscode/workbench/#memfs:empty" class="tpl-card dash">
      <div class="tpl-icon"><svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor"><path d="M11.75 4.5a.75.75 0 0 1 .75.75V11h5.75a.75.75 0 0 1 0 1.5H12.5v5.75a.75.75 0 0 1-1.5 0V12.5H5.25a.75.75 0 0 1 0-1.5H11V5.25a.75.75 0 0 1 .75-.75Z"></path></svg></div>
      <span class="tpl-name">Blank Project</span>
    </a>
    <a href="/vscode/workbench/#memfs:bouncing-ball" class="tpl-card">
      <div class="tpl-icon"><svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M 2 20 Q 7 -12 12 20 Q 16 2 20 16"></path><circle cx="20" cy="16" r="3.5" fill="#da3633" stroke="none"></circle></svg></div>
      <span class="tpl-name">Bouncing Ball</span>
    </a>
    <a href="/vscode/workbench/#memfs:rlc" class="tpl-card">
      <div class="tpl-icon"><svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h3l2-4 4 8 4-8 4 8 2-4h2"></path></svg></div>
      <span class="tpl-name">RLC Circuit</span>
    </a>
    <a href="/vscode/workbench/#memfs:script" class="tpl-card">
      <div class="tpl-icon"><svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17l6-6-6-6M12 19h8"></path></svg></div>
      <span class="tpl-name">Script</span>
    </a>
    <a href="/vscode/workbench/#memfs:notebook" class="tpl-card">
      <div class="tpl-icon"><svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor" stroke="none"><path d="M0 3.75A.75.75 0 0 1 .75 3h7.497c1.566 0 2.945.8 3.751 2.014A4.495 4.495 0 0 1 15.75 3h7.5a.75.75 0 0 1 .75.75v15.063a.752.752 0 0 1-.755.75l-7.682-.052a3 3 0 0 0-2.142.878l-.89.891a.75.75 0 0 1-1.061 0l-.902-.901a2.996 2.996 0 0 0-2.121-.879H.75a.75.75 0 0 1-.75-.75Zm12.75 15.232a4.503 4.503 0 0 1 2.823-.971l6.927.047V4.5h-6.75a3 3 0 0 0-3 3ZM11.247 7.497a3 3 0 0 0-3-2.997H1.5V18h6.947c1.018 0 2.006.346 2.803.98Z"></path></svg></div>
      <span class="tpl-name">Notebook</span>
    </a>
  </div>
</div>
<script>
  function go() {
    var url = document.getElementById('url').value.trim();
    url = url.replace(/^https?:\\/\\//, '').replace(/^github\\.com\\//, '');
    window.location.href = '/vscode/workbench/#' + url;
  }
</script>
</body></html>`);
  }
});

// ── Repository wrapper (iframe to VS Code) ──

app.get("/github.com/:owner/:repo", (req, res) => {
  const { owner, repo } = req.params;
  const ref = (req.query.ref as string) || "main";
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

function renderWrapper(provider: string, owner: string, repo: string, ref: string): string {
  const folderUri = `${provider}:///${owner}/${repo}?ref=${ref}`;
  return `<!DOCTYPE html>
<html><head>
<title>${owner}/${repo} — ModelScript IDE</title>
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
  <a href="/${provider}.com/${owner}/${repo}">${owner}<span class="sep">/</span><span class="repo">${repo}</span></a>
  <span class="sep">@</span>
  <span style="color: #8b949e; font-family: monospace; font-size: 13px;">${ref}</span>
</div>
<iframe src="/vscode/workbench?folder=${encodeURIComponent(folderUri)}"></iframe>
</body></html>`;
}

// ── Start server ──

app.listen(PORT, HOST, () => {
  console.log(`ModelScript IDE running at http://${HOST}:${PORT}`);
  console.log(`  Try: http://${HOST}:${PORT}/github.com/modelscript/modelscript`);
});
