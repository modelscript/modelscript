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

function renderWorkbench(protocol: string, host: string, owner: string, repo: string, ref: string): string {
  const baseUrl = `${protocol}://${host}/vscode-static`;

  const config = {
    folderUri: {
      scheme: "github",
      authority: "",
      path: `/${owner}/${repo}`,
      query: `ref=${ref}`,
    },
    additionalBuiltinExtensions: [],
    developmentOptions: {
      extensions: [
        { scheme: protocol, authority: host, path: "/static/devextensions" },
        { scheme: protocol, authority: host, path: "/static/extensions/github-fs" },
      ],
    },
    productConfiguration: {
      enableTelemetry: false,
      nameShort: "ModelScript",
      nameLong: "ModelScript IDE",
      webEndpointUrlTemplate: `${protocol}://{{uuid}}.${host}/vscode-static`,
      webviewContentExternalBaseUrlTemplate: `${protocol}://{{uuid}}.${host}/vscode-static/out/vs/workbench/contrib/webview/browser/pre/`,
    },
  };

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

  return template.replace(/\{\{([^}]+)\}\}/g, (_, key: string) => {
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
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  } else if (coi === "3" || coi === "") {
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
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
  // Parse folder: github:///owner/repo?ref=main
  const match = folder.match(/^github:\/\/\/([^/]+)\/([^/?]+)(?:\?ref=(.+))?$/);
  if (!match) {
    res.status(400).send("Invalid folder URI. Expected: github:///owner/repo?ref=branch");
    return;
  }
  const [, owner, repo, ref = "main"] = match;
  const protocol = req.protocol;
  const host = req.get("host") || `${HOST}:${PORT}`;
  res.send(renderWorkbench(protocol, host, owner, repo, ref));
});

// ── Landing page ──

app.get("/", (_req, res) => {
  const landingPath = join(VIEWS_DIR, "landing.html");
  if (existsSync(landingPath)) {
    res.sendFile(landingPath);
  } else {
    res.send(`<!DOCTYPE html>
<html><head><title>ModelScript IDE</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; background: #0d1117; color: #c9d1d9; display: flex; align-items: center; justify-content: center; height: 100vh; }
  .container { text-align: center; max-width: 600px; }
  h1 { font-size: 2.5rem; margin-bottom: 0.5rem; background: linear-gradient(135deg, #58a6ff, #bc8cff); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
  p { margin-bottom: 2rem; opacity: 0.7; }
  input { width: 100%; padding: 14px 20px; border-radius: 8px; border: 1px solid #30363d; background: #161b22; color: #c9d1d9; font-size: 16px; outline: none; }
  input:focus { border-color: #58a6ff; }
  .examples { margin-top: 1.5rem; text-align: left; }
  .examples a { color: #58a6ff; text-decoration: none; display: block; padding: 8px 0; }
  .examples a:hover { text-decoration: underline; }
</style>
</head><body>
<div class="container">
  <h1>ModelScript IDE</h1>
  <p>Open any GitHub repository with Modelica support</p>
  <form onsubmit="event.preventDefault(); go();">
    <input id="url" type="text" placeholder="Enter a GitHub repository URL, e.g. github.com/owner/repo" autofocus />
  </form>
  <div class="examples">
    <a href="/github.com/modelscript/modelscript">modelscript/modelscript</a>
    <a href="/github.com/OpenModelica/OpenModelica">OpenModelica/OpenModelica</a>
  </div>
</div>
<script>
  function go() {
    let url = document.getElementById('url').value.trim();
    url = url.replace(/^https?:\\/\\//, '');
    if (!url.startsWith('github.com/') && !url.startsWith('gitlab.com/')) {
      url = 'github.com/' + url;
    }
    window.location.href = '/' + url;
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
