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
for (const file of [
  "package.json",
  "language-configuration.json",
  "browserClientMain.js",
  "browserClientMain.js.map",
  "browserServerMain.js",
  "browserServerMain.js.map",
  "diagramWebview.js",
  "diagramWebview.js.map",
  "simulationWebview.js",
  "simulationWebview.js.map",
  "tree-sitter-modelica.wasm",
  "tree-sitter.wasm",
  "ModelicaStandardLibrary_v4.1.0.zip",
]) {
  const src = join(MODELSCRIPT_EXT_DIR, file);
  if (existsSync(src)) {
    cpSync(src, join(extDestDir, file));
  }
}
// Copy subdirectories
for (const dir of ["syntaxes", "images"]) {
  const src = join(MODELSCRIPT_EXT_DIR, dir);
  if (existsSync(src)) {
    cpSync(src, join(extDestDir, dir), { recursive: true });
  }
}

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
    additionalBuiltinExtensions: [],
    developmentOptions: {
      extensions: [
        { scheme: "##SCHEME##", authority: "##HOST##", path: "/static/devextensions" },
        { scheme: "##SCHEME##", authority: "##HOST##", path: "/static/extensions/github-fs" },
      ],
    },
    productConfiguration: {
      enableTelemetry: false,
      nameShort: "ModelScript",
      nameLong: "ModelScript IDE",
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
  // Parse URL hash for repo: #owner/repo or #owner/repo@ref
  var hash = location.hash.slice(1);
  if (!hash) hash = 'modelscript/modelscript';
  var parts = hash.split('@');
  var ownerRepo = parts[0];
  var ref = parts[1] || 'main';
  var p = ownerRepo.split('/');
  var owner = p[0] || 'modelscript';
  var repo = p[1] || 'modelscript';
  document.title = owner + '/' + repo + ' — ModelScript IDE';
  // Patch the workbench config in the DOM
  var el = document.getElementById('vscode-workbench-web-configuration');
  if (el) {
    var config = JSON.parse(el.getAttribute('data-settings'));
    config.folderUri.path = '/' + owner + '/' + repo;
    config.folderUri.query = 'ref=' + ref;
    var scheme = location.protocol.replace(':', '');
    var host = location.host;
    config.developmentOptions.extensions = [
      { scheme: scheme, authority: host, path: '/static/devextensions' },
      { scheme: scheme, authority: host, path: '/static/extensions/github-fs' },
    ];
    el.setAttribute('data-settings', JSON.stringify(config));
  }
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
<meta name="viewport" content="width=device-width, initial-scale=1.0">
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
    <input id="url" type="text" placeholder="Enter a GitHub repository URL, e.g. owner/repo" autofocus />
  </form>
  <div class="examples">
    <a href="/vscode/workbench/#modelscript/modelscript">modelscript/modelscript</a>
    <a href="/vscode/workbench/#OpenModelica/OpenModelica">OpenModelica/OpenModelica</a>
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

console.log(`Static IDE build complete: ${OUT_DIR}`);
