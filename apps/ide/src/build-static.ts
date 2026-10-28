// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Assembles a static build of the ModelScript IDE for deployment to GitHub Pages.
// The output directory (dist/static/) can be served by any static file server.

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { renderLandingPageHtml } from "./landing-page.js";

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
      ];
      const found = candidates.find(existsSync);
      if (found) {
        cpSync(found, join(serverDistDest, lang.wasm));
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
      extensionGallery: {
        serviceUrl: "https://open-vsx.org/vscode/gallery",
        itemUrl: "https://open-vsx.org/vscode/item",
        resourceUrlTemplate: "https://open-vsx.org/vscode/unpkg/{publisher}/{name}/{version}/{path}",
        controlUrl: "",
      },
    },
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
  config.configurationDefaults = config.configurationDefaults || {};
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
  if (hash.startsWith('memfs')) {
    var template = hash.split(':')[1] || 'empty';
    if (template.startsWith('artifact-')) {
      document.title = 'Artifact #' + template.slice(9) + ' — ModelScript IDE';
    } else if (template.startsWith('package-')) {
      document.title = 'Package ' + template.slice(8) + ' — ModelScript IDE';
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
  
  var endpoint = location.protocol + '//' + location.host + '/vscode-static';
  config.productConfiguration = config.productConfiguration || {};
  config.productConfiguration.webEndpointUrlTemplate = endpoint;
  
  el.setAttribute('data-settings', JSON.stringify(config));

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
})();
</script>`;

  return html.replace("</head>", patchScript + "\n</head>");
}

// Write workbench HTML
const workbenchDir = join(OUT_DIR, "vscode", "workbench");
mkdirSync(workbenchDir, { recursive: true });
writeFileSync(join(workbenchDir, "index.html"), renderStaticWorkbench());

// 5. Generate 2-level tile landing page
console.log("  Generating 2-level tile landing page...");
const landingHtml = renderLandingPageHtml();

writeFileSync(join(OUT_DIR, "index.html"), landingHtml);

// 6. SPA fallback
writeFileSync(join(OUT_DIR, "404.html"), landingHtml);

// 7. CNAME for custom domain
writeFileSync(join(OUT_DIR, "CNAME"), "ide.modelscript.org\n");

// 8. Copy favicon from web
const webFavicon = resolve(__dirname, "..", "..", "web", "public", "favicon.ico");
if (existsSync(webFavicon)) {
  cpSync(webFavicon, join(OUT_DIR, "favicon.ico"));
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
