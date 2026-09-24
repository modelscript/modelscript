// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Assembles a static build of the ModelScript IDE for deployment to GitHub Pages.
// The output directory (dist/static/) can be served by any static file server.

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";

const __dirname = import.meta.dirname;
const APP_ROOT = existsSync(resolve(__dirname, "package.json")) ? __dirname : resolve(__dirname, "..");
const OUT_DIR = resolve(APP_ROOT, "dist", "static");
const VSCODE_WEB_DIR = resolve(APP_ROOT, "vscode-web");
const MODELSCRIPT_EXT_DIR = resolve(APP_ROOT, "dist", "extension");
const GITHUB_FS_EXT_DIR = resolve(APP_ROOT, "github-fs");

if (!existsSync(VSCODE_WEB_DIR)) {
  console.error("VS Code Web not found. Run: npm run download-vscode");
  process.exit(1);
}

if (!existsSync(MODELSCRIPT_EXT_DIR)) {
  console.error(`ModelScript extension not found at ${MODELSCRIPT_EXT_DIR}. Run: npm run build-extension`);
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
cpSync(MODELSCRIPT_EXT_DIR, extDestDir, { recursive: true });

// Ensure all discovered language WASM files from languages-manifest.json are present
const manifestPath = join(MODELSCRIPT_EXT_DIR, "server", "dist", "languages-manifest.json");
const serverDistDest = join(extDestDir, "server", "dist");
mkdirSync(serverDistDest, { recursive: true });

if (existsSync(manifestPath)) {
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    writeFileSync(join(serverDistDest, "languages-manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");

    const repoRoot = resolve(__dirname, "..", "..", "..");
    for (const lang of manifest) {
      if (!lang.wasm) continue;
      const langDir = resolve(repoRoot, "languages", lang.id);
      const candidates = [
        join(MODELSCRIPT_EXT_DIR, "server", "dist", lang.wasm),
        join(langDir, "dist", "parser.wasm"),
        join(langDir, "parser.wasm"),
        join(langDir, `tree-sitter-${lang.id}.wasm`),
      ];
      const found = candidates.find(existsSync);
      if (found) {
        cpSync(found, join(serverDistDest, lang.wasm));
        cpSync(found, join(serverDistDest, `tree-sitter-${lang.id}.wasm`));
        console.log(`  Copied ${lang.id} WASM parser (${lang.wasm}) to ${serverDistDest}`);
      } else {
        console.warn(`  Warning: WASM parser for ${lang.id} not found`);
      }
    }
  } catch (err) {
    console.warn("  Warning: could not process languages-manifest.json:", err);
  }
}

// Ensure release.wasm (compiler BLT solver) is copied
const releaseWasmSrc = [
  join(MODELSCRIPT_EXT_DIR, "server", "dist", "release.wasm"),
  resolve(__dirname, "..", "..", "..", "packages", "runtime", "build", "release.wasm"),
  resolve(__dirname, "..", "..", "..", "packages", "language", "build", "release.wasm"),
].find(existsSync);
const releaseWasmDest = join(extDestDir, "server", "dist", "release.wasm");
if (releaseWasmSrc && existsSync(releaseWasmSrc)) {
  cpSync(releaseWasmSrc, releaseWasmDest);
  console.log(`  Copied release.wasm to ${releaseWasmDest}`);
} else {
  console.warn("  Warning: release.wasm not found, BLT solver will be disabled");
}

// 3. Copy GitHub FS extension
console.log("  Copying GitHub FS extension...");
cpSync(GITHUB_FS_EXT_DIR, join(OUT_DIR, "static", "extensions", "github-fs"), {
  recursive: true,
  filter: (src) => !src.includes("node_modules") && !src.includes(".git"),
});

// 4. Generate the workbench HTML
console.log("  Generating workbench HTML...");
const TEST_WEB_DIR =
  [
    resolve(APP_ROOT, "..", "..", "node_modules", "@vscode", "test-web"),
    resolve(APP_ROOT, "node_modules", "@vscode", "test-web"),
    resolve(__dirname, "..", "..", "..", "node_modules", "@vscode", "test-web"),
  ].find(existsSync) || resolve(APP_ROOT, "..", "..", "node_modules", "@vscode", "test-web");

function getWorkbenchTemplate(): string {
  const esmPath = join(TEST_WEB_DIR, "views", "workbench-esm.html");
  if (existsSync(esmPath)) return readFileSync(esmPath, "utf-8");
  const amdPath = join(TEST_WEB_DIR, "views", "workbench.html");
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
      extensionAllowedProposedApi: ["modelscript.modelscript", "vscode.mermaid-markdown-features"],
      extensionEnabledApiProposals: {
        "vscode.mermaid-markdown-features": ["chatParticipantPrivate", "chatOutputRenderer"],
      },
      // Use Open VSX registry to avoid CORS errors with Microsoft's CDN
      extensionGallery: {
        serviceUrl: "https://open-vsx.org/vscode/gallery",
        itemUrl: "https://open-vsx.org/vscode/item",
        resourceUrlTemplate: "https://open-vsx.org/vscode/unpkg/{publisher}/{name}/{version}/{path}",
        controlUrl: "",
      },
    },
  };

  const template = getWorkbenchTemplate();

  const esmMainPath = join(TEST_WEB_DIR, "out", "browser", "esm", "main.js");
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
  var originalWarn = console.warn;
  console.warn = function() {
    if (typeof arguments[0] === 'string' && arguments[0].includes('ENOPRO: No file system provider found for resource')) return;
    originalWarn.apply(console, arguments);
  };

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
  
  // Same-origin extension host (no wildcard DNS required)
  var endpoint = location.protocol + '//' + location.host + '/vscode-static';
  config.productConfiguration = config.productConfiguration || {};
  config.productConfiguration.webEndpointUrlTemplate = endpoint;
  
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
    <a href="/vscode/workbench/#memfs:sysml2" class="tpl-card">
      <div class="tpl-icon"><svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="8" rx="1.5"/><rect x="2" y="14" width="9" height="8" rx="1.5"/><rect x="13" y="14" width="9" height="8" rx="1.5"/><line x1="7" y1="10" x2="7" y2="14"/><line x1="17" y1="10" x2="17" y2="14"/></svg></div>
      <span class="tpl-name">SysML2 Vehicle</span>
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
    <a href="/vscode/workbench/#memfs:mbse-verification" class="tpl-card">
      <div class="tpl-icon"><svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 12l2 2 4-4M5 12a7 7 0 1114 0 7 7 0 01-14 0z"/></svg></div>
      <span class="tpl-name">MBSE Verification</span>
    </a>
    <a href="/vscode/workbench/#memfs:fmi2" class="tpl-card">
      <div class="tpl-icon"><svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13"/></svg></div>
      <span class="tpl-name">FMI 2.0 Template</span>
    </a>
    <a href="/vscode/workbench/#memfs:fmi3" class="tpl-card">
      <div class="tpl-icon"><svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg></div>
      <span class="tpl-name">FMI 3.0 Template</span>
    </a>
    <a href="/vscode/workbench/#memfs:simulation-verification" class="tpl-card">
      <div class="tpl-icon"><svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 12l2 2 4-4M5 12a7 7 0 1114 0 7 7 0 01-14 0z"/></svg></div>
      <span class="tpl-name">Simulation Verification</span>
    </a>
    <a href="/vscode/workbench/#memfs:multi-fidelity-binding" class="tpl-card">
      <div class="tpl-icon"><svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg></div>
      <span class="tpl-name">Multi-Fidelity Binding</span>
    </a>
    <a href="/vscode/workbench/#memfs:data-driven-calibration" class="tpl-card">
      <div class="tpl-icon"><svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 3v18h18M7 14l4-4 4 4 6-6"/></svg></div>
      <span class="tpl-name">Data-Driven Calibration</span>
    </a>
    <a href="/vscode/workbench/#memfs:hardware-ci" class="tpl-card">
      <div class="tpl-icon"><svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div>
      <span class="tpl-name">Hardware CI</span>
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
            { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
          ],
        },
      ],
    },
    null,
    2,
  ) + "\n",
);

console.log(`Static IDE build complete: ${OUT_DIR}`);
