// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Assembles a static build of the ModelScript IDE for deployment to GitHub Pages.
// The output directory (dist/static/) can be served by any static file server.

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";

const __dirname = import.meta.dirname;
const OUT_DIR = resolve(__dirname, "..", "dist", "static");
const VSCODE_WEB_DIR = resolve(__dirname, "..", "vscode-web");
const MODELSCRIPT_EXT_DIR = resolve(__dirname, "..", "..", "vscode");
const GITHUB_FS_EXT_DIR = resolve(__dirname, "..", "github-fs");

if (!existsSync(VSCODE_WEB_DIR)) {
  console.error("VS Code Web not found. Run: npm run download-vscode");
  process.exit(1);
}

console.log("Assembling static IDE build...");

// Clean and create output directory
mkdirSync(OUT_DIR, { recursive: true });

// 1. Copy VS Code Web assets
console.log("  Copying VS Code Web assets...");
cpSync(VSCODE_WEB_DIR, join(OUT_DIR, "vscode-static"), { recursive: true });

// 2. Copy ModelScript extension
console.log("  Copying ModelScript extension...");
const extDestDir = join(OUT_DIR, "static", "devextensions");
mkdirSync(extDestDir, { recursive: true });
// Copy essential root files
for (const file of ["package.json", "language-configuration.json"]) {
  const src = join(MODELSCRIPT_EXT_DIR, file);
  if (existsSync(src)) {
    cpSync(src, join(extDestDir, file));
  }
}
// Copy webpack output directories (client bundle, webview bundles, server bundle + assets)
for (const dir of ["dist", "server", "syntaxes", "images"]) {
  const src = join(MODELSCRIPT_EXT_DIR, dir);
  if (existsSync(src)) {
    cpSync(src, join(extDestDir, dir), { recursive: true });
  }
}
// Create empty package.nls.json if it doesn't exist (VS Code requests it)
if (!existsSync(join(extDestDir, "package.nls.json"))) {
  writeFileSync(join(extDestDir, "package.nls.json"), "{}");
}

// Ensure tree-sitter-modelica.wasm is explicitly present and copied
const modelicaWasmSrc = resolve(__dirname, "..", "..", "tree-sitter-modelica", "tree-sitter-modelica.wasm");
const modelicaWasmDest = join(extDestDir, "server", "dist", "tree-sitter-modelica.wasm");
if (!existsSync(modelicaWasmSrc)) {
  console.error("FATAL: tree-sitter-modelica.wasm is missing from packages/tree-sitter-modelica/");
  process.exit(1);
}
mkdirSync(join(extDestDir, "server", "dist"), { recursive: true });
cpSync(modelicaWasmSrc, modelicaWasmDest);
console.log(`  Copied tree-sitter-modelica.wasm to ${modelicaWasmDest}`);

// 3. Copy GitHub FS extension
console.log("  Copying GitHub FS extension...");
cpSync(GITHUB_FS_EXT_DIR, join(OUT_DIR, "static", "extensions", "github-fs"), {
  recursive: true,
  filter: (src) => !src.includes("node_modules") && !src.includes(".git"),
});

// 4. Generate the workbench HTML
console.log("  Generating workbench HTML...");
const testWebDir = resolve(__dirname, "..", "..", "..", "node_modules", "@vscode", "test-web");

function getWorkbenchTemplate(): string {
  const esmPath = join(testWebDir, "views", "workbench-esm.html");
  if (existsSync(esmPath)) return readFileSync(esmPath, "utf-8");
  const amdPath = join(testWebDir, "views", "workbench.html");
  if (existsSync(amdPath)) return readFileSync(amdPath, "utf-8");
  throw new Error("No workbench template found in @vscode/test-web");
}

function escapeJSON(value: unknown): string {
  return JSON.stringify(value).replace(/"/g, "&quot;");
}

function renderStaticWorkbench(): string {
  // For static deployment, use relative paths and location-based dynamic host
  const config = {
    folderUri: {
      scheme: "github",
      authority: "",
      path: "/modelscript/modelscript",
      query: "ref=main",
    },
    additionalBuiltinExtensions: [
      { scheme: "##SCHEME##", authority: "##HOST##", path: "/static/devextensions" },
      { scheme: "##SCHEME##", authority: "##HOST##", path: "/static/extensions/github-fs" },
    ],
    productConfiguration: {
      enableTelemetry: false,
      nameShort: "ModelScript",
      nameLong: "ModelScript IDE",
      extensionAllowedProposedApi: ["modelscript.modelscript"],
    },
  };

  const template = getWorkbenchTemplate();

  const esmMainPath = join(testWebDir, "out", "browser", "esm", "main.js");
  let mainScript: string;
  if (existsSync(esmMainPath)) {
    let mainJs = readFileSync(esmMainPath, "utf-8");
    mainJs = mainJs.replace("./workbench.api", "/vscode-static/out/vs/workbench/workbench.web.main.internal.js");
    mainScript = `<script src="/vscode-static/out/nls.messages.js"></script>\n<script type="module">${mainJs}</script>`;
  } else {
    mainScript = `<script>document.body.textContent = 'Error: main.js not found';</script>`;
  }

  const html = template.replace(/\{\{([^}]+)\}\}/g, (_, key: string) => {
    switch (key) {
      case "WORKBENCH_WEB_CONFIGURATION":
        return escapeJSON(config);
      case "WORKBENCH_WEB_BASE_URL":
        return "/vscode-static";
      case "WORKBENCH_BUILTIN_EXTENSIONS":
        return escapeJSON([]);
      case "WORKBENCH_MAIN":
        return mainScript;
      default:
        return "undefined";
    }
  });

  // Inject a script that dynamically patches the config based on URL parameters
  const patchScript = `<script>
(function() {
  // Parse URL hash for repo: #owner/repo, #owner/repo@ref, or #memfs
  var hash = location.hash.slice(1);
  if (!hash) hash = 'modelscript/modelscript';
  var el = document.getElementById('vscode-workbench-web-configuration');
  if (!el) return;
  var config = JSON.parse(el.getAttribute('data-settings'));
  var scheme = location.protocol.replace(':', '');
  var host = location.host;
  config.additionalBuiltinExtensions = [
    { scheme: scheme, authority: host, path: '/static/devextensions' },
    { scheme: scheme, authority: host, path: '/static/extensions/github-fs' },
  ];
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
    config.folderUri.path = '/' + owner + '/' + repo;
    config.folderUri.query = 'ref=' + ref;
  }
  
  // Use localhost subdomains for the extension host and webview iframes.
  // Chrome resolves *.localhost to 127.0.0.1, so our Express server handles them.
  // This avoids PNA blocks (public CDN origin -> private localhost fetch).
  var endpoint = location.protocol + '//{{uuid}}.' + location.host + '/vscode-static';
  config.productConfiguration = config.productConfiguration || {};
  config.productConfiguration.webEndpointUrlTemplate = endpoint;
  config.productConfiguration.webviewContentExternalBaseUrlTemplate = endpoint + '/out/vs/workbench/contrib/webview/browser/pre/';
  
  el.setAttribute('data-settings', JSON.stringify(config));
})();
</script>`;

  return html.replace("</head>", patchScript + "\n</head>");
}

// Write workbench HTML
const workbenchDir = join(OUT_DIR, "vscode", "workbench");
mkdirSync(workbenchDir, { recursive: true });
writeFileSync(join(workbenchDir, "index.html"), renderStaticWorkbench());

// 5. Generate landing page
console.log("  Generating landing page...");

const landingHtml = `<!DOCTYPE html>
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
</body></html>`;

writeFileSync(join(OUT_DIR, "index.html"), landingHtml);

// 6. SPA fallback
writeFileSync(join(OUT_DIR, "404.html"), landingHtml);

// 7. CNAME for custom domain
writeFileSync(join(OUT_DIR, "CNAME"), "ide.modelscript.org\n");

// 8. Copy favicon from morsel
const morselFavicon = resolve(__dirname, "..", "..", "morsel", "public", "favicon.ico");
if (existsSync(morselFavicon)) {
  cpSync(morselFavicon, join(OUT_DIR, "favicon.ico"));
}

// 9. Disable Jekyll processing (ensures all files like .wasm are served as-is)
writeFileSync(join(OUT_DIR, ".nojekyll"), "");

// 9. Override root .gitignore so binaries are tracked by GitHub Pages deployment
writeFileSync(join(OUT_DIR, ".gitignore"), "!*.wasm\n!*.zip\n");

// 10. serve.json for local preview (adds required CORS/PNA/COI headers)
writeFileSync(
  join(OUT_DIR, "serve.json"),
  JSON.stringify(
    {
      headers: [
        {
          source: "**/*",
          headers: [
            { key: "Access-Control-Allow-Origin", value: "*" },
            { key: "Access-Control-Allow-Private-Network", value: "true" },
            { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
            { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
            { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          ],
        },
      ],
    },
    null,
    2,
  ) + "\n",
);

console.log(`Static IDE build complete: ${OUT_DIR}`);
