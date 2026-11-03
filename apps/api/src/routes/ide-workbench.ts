// SPDX-License-Identifier: AGPL-3.0-or-later

import express from "express";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, watch, type FSWatcher } from "node:fs";
import path, { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { LibraryDatabase } from "../database.js";
import { optionalAuth } from "../middleware/auth-middleware.js";
import { ensureUserActivityRepo } from "../services/activity-git.js";

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
 * Patches VS Code Web's `out/vs/workbench/contrib/webview/browser/pre/index.html`
 * so same-origin webview hosting (`location.origin === parentOrigin`, e.g. on
 * `ansatz.social`, `modelscript.org`, `ide.modelscript.org`, or self-hosted domains)
 * passes `HostMessaging.signalReady()` origin validation, and allows Cloudflare's
 * injected analytics beacon script in the outer webview frame CSP.
 */
export function patchWebviewPreHtml(html: string): string {
  let out = html.replace(
    "script-src 'sha256-TaWGDzV7c9rUH2q/5ygOyYUHSyHIqBMYfucPh3lnKvU=' 'self'",
    "script-src 'unsafe-inline' 'self' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com https://*.cloudflareinsights.com",
  );
  out = out.replace(
    /script-src 'sha256-[A-Za-z0-9+/=]+' 'self'/g,
    "script-src 'unsafe-inline' 'self' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com https://*.cloudflareinsights.com",
  );
  out = out.replace(
    /script-src 'unsafe-inline' 'self'(?! https:\/\/static\.cloudflareinsights\.com)/g,
    "script-src 'unsafe-inline' 'self' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com https://*.cloudflareinsights.com",
  );

  out = out.replace(
    /if \((?:hostname === "localhost" \|\| hostname === "127\.0\.0\.1" \|\| )?(?:location\.origin === parentOrigin \|\| )?hostname === parentOriginHash/g,
    'if (hostname === "localhost" || hostname === "127.0.0.1" || location.origin === parentOrigin || hostname === parentOriginHash',
  );
  return out;
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

  const galleryConfig = {
    serviceUrl: "https://open-vsx.org/vscode/gallery",
    itemUrl: "https://open-vsx.org/vscode/item",
    resourceUrlTemplate: "https://open-vsx.org/vscode/unpkg/{publisher}/{name}/{version}/{path}",
    controlUrl: "",
    mcpUrl: "",
  };

  const productConfiguration: Record<string, unknown> = {
    enableTelemetry: false,
    nameShort: "Ansatz",
    nameLong: "Ansatz IDE (Powered by ModelScript)",
    webEndpointUrlTemplate: webEndpoint,
    chatParticipantRegistry: "",
    extensionAllowedProposedApi: ["modelscript.modelscript", "vscode.mermaid-markdown-features"],
    extensionEnabledApiProposals: {
      "vscode.mermaid-markdown-features": ["chatParticipantPrivate", "chatOutputRenderer"],
      "GitHub.vscode-pull-request-github": [],
      "github.vscode-pull-request-github": [],
    },
    extensionsGallery: galleryConfig,
    extensionGallery: galleryConfig,
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
        arguments[i].includes('No search provider registered for scheme: github') ||
        arguments[i].includes('Ignoring the error while validating workspace folder') ||
        arguments[i].includes('Overwriting grammar scope name to file mapping') ||
        arguments[i].includes('extensionEnabledApiProposals') ||
        arguments[i].includes('[AgentHost:remote] No remote agent connection available') ||
        arguments[i].includes("[CloudSandboxApi] No 'github' session with scopes") ||
        arguments[i].includes('[LM] Failed to request chat control data')
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
  config.productConfiguration.chatParticipantRegistry = '';
  
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
export function ideWorkbenchRouter(database?: LibraryDatabase): express.Router {
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
      req.path.startsWith("/lsp/") ||
      req.path.startsWith("/static/extensions/github-fs") ||
      req.path.startsWith("/api/models/");

    if (isIdeAsset) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.removeHeader("X-Frame-Options");
    }

    const isWorkerOrStatic =
      req.path.startsWith("/static/devextensions") ||
      req.path.startsWith("/lsp/") ||
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

  // Dynamically patch webview host pages so same-origin deployments (e.g. ansatz.social, modelscript.org)
  // always pass HostMessaging.signalReady() even if vscode-web was cached before the patch
  router.get(
    [
      "/vscode-static/out/vs/workbench/contrib/webview/browser/pre/index.html",
      "/vscode-static/out/vs/workbench/contrib/webview/browser/pre/index-no-csp.html",
    ],
    (req, res, next) => {
      const fileName = req.path.endsWith("index-no-csp.html") ? "index-no-csp.html" : "index.html";
      const filePath = join(vscodeWebDir, "out", "vs", "workbench", "contrib", "webview", "browser", "pre", fileName);
      if (!existsSync(filePath)) {
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

  // Static mounts for VS Code Web, ModelScript Extension, Morsel LSP, GitHub FS, and WebLLM models
  router.use("/vscode-static", express.static(vscodeWebDir, { dotfiles: "ignore" }));

  router.use(
    ["/static/devextensions", "/lsp"],
    (_req, res, next) => {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      next();
    },
    express.static(modelscriptExtDir, { dotfiles: "ignore" }),
  );

  router.use(
    "/static/extensions/github-fs",
    (_req, res, next) => {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      next();
    },
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

  // Curated showcase files & local extracted standard libraries for offline / rate-limit resilience
  const SHOWCASE_REPO_FILES: Record<string, Record<string, string>> = {
    "modelica/modelicastandardlibrary": {
      "README.md": `# Modelica Standard Library 4.1.0\n\n**Modelica** is a freely available, object-oriented language for modeling of large, complex, and heterogeneous physical systems.\n\n## Package Overview\n\n- \`Modelica/Blocks/\` — Continuous & discrete input/output control blocks\n- \`Modelica/Electrical/\` — Analog, Digital, Machines, MultiPhase, PowerConverters, QuasiStationary\n- \`Modelica/Mechanics/\` — Rotational, Translational, and 3D MultiBody dynamics\n- \`Modelica/Fluid/\` & \`Modelica/Media/\` — 1D thermo-fluid flow and media property models\n- \`Modelica/Thermal/\` — HeatTransfer and FluidHeatFlow components\n- \`Modelica/Magnetic/\` — FluxTubes, FundamentalWave, and QuasiStatic magnetic models\n`,
      "Modelica/package.mo": `within ;\npackage Modelica "Modelica Standard Library - Version 4.1.0"\n  extends Modelica.Icons.Package;\n  annotation(version = "4.1.0", versionDate = "2026-04-15");\nend Modelica;\n`,
      "Modelica/Electrical/Analog/Basic/Resistor.mo": `within Modelica.Electrical.Analog.Basic;\nmodel Resistor "Ideal linear electrical resistor"\n  parameter Modelica.Units.SI.Resistance R(start = 1) "Resistance at temperature T_ref";\n  parameter Modelica.Units.SI.Temperature T_ref = 300.15 "Reference temperature";\n  parameter Modelica.Units.SI.LinearTemperatureCoefficient alpha = 0 "Temperature coefficient of resistance";\n  extends Modelica.Electrical.Analog.Interfaces.OnePort;\n  Modelica.Units.SI.Resistance R_actual "Actual resistance";\nequation\n  R_actual = R * (1 + alpha * (T_ref - 300.15));\n  v = R_actual * i;\nend Resistor;\n`,
      "Modelica/Electrical/Analog/Examples/ChuaCircuit.mo": `within Modelica.Electrical.Analog.Examples;\nmodel ChuaCircuit "Chua's circuit with nonlinear piecewise-linear resistor"\n  extends Modelica.Icons.Example;\n  Modelica.Electrical.Analog.Basic.Inductor L(L=18);\n  Modelica.Electrical.Analog.Basic.Resistor Ro(R=12.5e-3);\n  Modelica.Electrical.Analog.Basic.Conductor G(G=0.565);\n  Modelica.Electrical.Analog.Basic.Capacitor C1(C=10, v(start=4, fixed=true));\n  Modelica.Electrical.Analog.Basic.Capacitor C2(C=100, v(start=0, fixed=true));\nequation\n  connect(L.p, G.p);\n  connect(G.n, C1.p);\n  connect(C1.n, L.n);\nend ChuaCircuit;\n`,
      "Modelica/Mechanics/Rotational/Examples/CoupledClutches.mo": `within Modelica.Mechanics.Rotational.Examples;\nmodel CoupledClutches "Drive train with three coupled clutches"\n  parameter Real J1 = 1.0 "Inertia 1 (kg.m2)";\n  parameter Real J2 = 0.4 "Inertia 2 (kg.m2)";\n  Real phi1(start = 0.0, fixed = true);\n  Real w1(start = 10.0, fixed = true);\nequation\n  der(phi1) = w1;\n  J1 * der(w1) = -0.25 * w1 + sin(2.0 * time);\nend CoupledClutches;\n`,
    },
    "systems-modeling/sysml-v2-release": {
      "README.md": `# OMG SysML v2 Release Repository\n\nThis repository contains the official incremental release artifacts for **OMG Systems Modeling Language (SysML v2)** and **Kernel Modeling Language (KerML)**.\n\n## Contents\n\n- \`sysml/\` — SysML v2 textual notation standard domain libraries and training models\n- \`kerml/\` — Kernel Modeling Language normative model libraries\n- \`doc/\` — Normative specification documents\n`,
      "sysml/src/examples/VehicleExample.sysml": `package VehicleExample {\n  import ScalarValues::*;\n  part def Vehicle {\n    attribute mass : Real = 1850.0;\n    part propulsion : PropulsionSystem;\n    part chassis : ChassisAssembly;\n  }\n  part def PropulsionSystem {\n    attribute peakTorque : Real = 420.0;\n  }\n  part def ChassisAssembly;\n}\n`,
      "sysml/src/validation/SafetyRequirements.sysml": `package SafetyRequirements {\n  requirement def <'ASIL-D-01'> RedundantBrakingRequirement {\n    doc /* Braking deceleration shall exceed 8.5 m/s^2 under single hydraulic circuit fault. */\n  }\n}\n`,
      "kerml/src/KernelLibrary/ScalarValues.kerml": `standard library package ScalarValues {\n  datatype Boolean;\n  datatype String;\n  datatype Real;\n  datatype Integer;\n}\n`,
    },
    "libeigen/eigen": {
      "README.md": `# Eigen — C++ Template Library for Linear Algebra\n\nEigen is a high-performance C++ template library for linear algebra: matrices, vectors, numerical solvers, and related algorithms.\n\n## Key Subsystems\n\n- \`Eigen/Core\` — Dense matrix & array manipulation with SIMD vectorization\n- \`Eigen/SparseLU\` & \`Eigen/SparseCholesky\` — Direct solvers for sparse Jacobian systems\n- \`Eigen/Eigenvalues\` — Real/Complex Schur & generalized eigenvalue decompositions\n`,
      "Eigen/SparseLU": `// SPDX-License-Identifier: MPL-2.0\n#ifndef EIGEN_SPARSELU_MODULE_H\n#define EIGEN_SPARSELU_MODULE_H\n\nnamespace Eigen {\n  // Supernodal Sparse LU factorization for DAE Newton-Raphson Jacobians\n  template<typename MatrixType, typename OrderingType>\n  class SparseLU {\n  public:\n    void compute(const MatrixType& matrix);\n  };\n}\n#endif\n`,
      "CMakeLists.txt": `cmake_minimum_required(VERSION 3.16)\nproject(Eigen3 VERSION 3.4.1 LANGUAGES CXX)\nset(CMAKE_CXX_STANDARD 17)\n`,
    },
    "openmodelica/openmodelica": {
      "README.md": `# OpenModelica\n\n**OpenModelica** is an open-source Modelica-based modeling and simulation environment intended for industrial and academic usage.\n\n## Architecture\n\n- \`OMCompiler/Compiler/NFFrontEnd/\` — New Frontend (NF) instantiation and type checker\n- \`OMCompiler/Compiler/NBBackend/\` — New Backend BLT, Pantelides index reduction, and tearing\n- \`OMCompiler/SimulationRuntime/c/\` — DASSL, IDA, CVODE, and GBODE numerical integrators\n`,
      "OMCompiler/Compiler/NBBackend/NBMatching.mo": `encapsulated package NBMatching "Bipartite matching and Pantelides index reduction"\n  public function regularMatching\n    input Integer nEqns;\n    input Integer nVars;\n    output Integer matchCount;\n  algorithm\n    matchCount := min(nEqns, nVars);\n  end regularMatching;\nend NBMatching;\n`,
    },
    "modelica/fmi-standard": {
      "README.md": `# Functional Mock-up Interface (FMI) Standard\n\nThe **Functional Mock-up Interface (FMI)** is a free standard that defines a container and an interface to exchange dynamic simulation models using a combination of XML files, binaries, and C code.\n`,
      "headers/fmi3Functions.h": `#ifndef fmi3Functions_h\n#define fmi3Functions_h\n#include "fmi3PlatformTypes.h"\n\ntypedef fmi3Status fmi3EnterEventModeTYPE(fmi3Instance instance);\ntypedef fmi3Status fmi3DoStepTYPE(fmi3Instance instance, fmi3Float64 currentCommunicationPoint, fmi3Float64 communicationStepSize);\n#endif\n`,
    },
    "openscad/openscad": {
      "README.md": `# OpenSCAD — The Programmers Solid 3D CAD Modeller\n\nOpenSCAD is software for creating solid 3D CAD models using script-based Constructive Solid Geometry (CSG).\n`,
      "examples/ParametricGear.scad": `// Parametric involute spur gear\n$fn = 64;\nmodule spur_gear(teeth = 24, module_mm = 2.0, thickness = 8.0, bore = 10.0) {\n  pitch_r = (teeth * module_mm) / 2;\n  difference() {\n    cylinder(h = thickness, r = pitch_r + module_mm, center = true);\n    cylinder(h = thickness + 2, r = bore / 2, center = true);\n  }\n}\nspur_gear();\n`,
    },
    "su2code/su2": {
      "README.md": `# SU2: Multiphysics Simulation and Design Software\n\nSU2 is an open-source collection of C++ software tools for partial differential equation (PDE) analysis and adjoint-based aerodynamic optimization.\n`,
      "TestCases/rans/naca0012/inv_NACA0012.cfg": `SOLVER= EULER\nMATH_PROBLEM= DIRECT\nMACH_NUMBER= 0.8\nAOA= 1.25\nFREESTREAM_PRESSURE= 101325.0\nFREESTREAM_TEMPERATURE= 288.15\nREF_LENGTH= 1.0\nREF_AREA= 1.0\nNUM_METHOD_GRAD= GREEN_GAUSS\nCFL_NUMBER= 25.0\nITER= 250\nMESH_FILENAME= mesh_NACA0012_inv.su2\n`,
    },
    "graphviz/graphviz": {
      "README.md": `# Graphviz — Graph Visualization Software\n\nGraphviz is open-source graph visualization software used for structural schematic layout, orthogonal connector routing, and BLT dependency visualization.\n`,
      "examples/dae_blt_causality.dot": `digraph BLT_Causality {\n  rankdir=LR;\n  node [shape=box, style="rounded,filled", fillcolor="#0f172a", fontcolor="#f8fafc"];\n  "u(t)" -> "Block 1: i_q = K*(r - theta)";\n  "Block 1: i_q = K*(r - theta)" -> "Block 2: J*der(w) = k_t*i_q - b*w";\n  "Block 2: J*der(w) = k_t*i_q - b*w" -> "Block 3: der(theta) = w";\n}\n`,
    },
    "inkscape/inkscape": {
      "README.md": `# Inkscape — Vector Graphics & Technical Schematic Engine\n\nInkscape is a professional-grade open-source vector graphics editor supporting W3C SVG standards and engineering component iconography.\n`,
      "share/icons/modelica-inductor.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 80">\n  <path d="M 10 40 L 40 40 A 15 15 0 0 1 70 40 A 15 15 0 0 1 100 40 A 15 15 0 0 1 130 40 A 15 15 0 0 1 160 40 L 190 40" fill="none" stroke="#38bdf8" stroke-width="4"/>\n</svg>\n`,
    },
    "modelscript/modelscript": {
      "README.md": `# ModelScript — Polyglot Systems Engineering & Simulation Compiler\n\n**ModelScript** compiles Modelica 3.x, SysML v2, STEP (ISO 10303), OpenSCAD, PSCAD, GENSYS, and SIMPACK models to WebAssembly DAE arenas for real-time numerical simulation.\n`,
      "examples/rlc_circuit.mo": `model RLCCircuit "Series RLC resonant circuit"\n  parameter Real R = 10.0;\n  parameter Real L = 0.1;\n  parameter Real C = 1e-4;\n  Real i(start = 0.0, fixed = true);\n  Real v_c(start = 5.0, fixed = true);\nequation\n  der(v_c) = i / C;\n  L * der(i) = -R * i - v_c;\nend RLCCircuit;\n`,
    },
  };

  interface LocalRepoTreeCacheEntry {
    tree: Array<{
      path: string;
      mode: string;
      type: "blob" | "tree";
      sha: string;
      size?: number;
    }>;
    blobPathBySha: Map<string, string>;
    virtualContentBySha: Map<string, Buffer>;
    extractedDir: string | null;
    virtualFiles: Record<string, string>;
  }

  const localRepoTreeCache = new Map<string, LocalRepoTreeCacheEntry>();

  function resolveExtractedLibraryDir(repoKeyLower: string): string | null {
    if (repoKeyLower === "modelica/modelicastandardlibrary" || repoKeyLower === "modelica/modelica") {
      const candidates = [
        resolve(REPO_ROOT, "data/libraries/Modelica/4.1.0/extracted"),
        resolve(API_ROOT, "data/libraries/Modelica/4.1.0/extracted"),
      ];
      return candidates.find(existsSync) || null;
    }
    if (repoKeyLower === "systems-modeling/sysml-v2-release" || repoKeyLower === "systems-modeling/sysml-v2") {
      const candidates = [
        resolve(REPO_ROOT, "data/libraries/SysML/2026.3.0/extracted"),
        resolve(API_ROOT, "data/libraries/SysML/2026.3.0/extracted"),
      ];
      return candidates.find(existsSync) || null;
    }
    return null;
  }

  const SAFE_GIT_SEGMENT_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/;

  function resolveLocalGitRepoDir(owner: string, repo: string): string | null {
    const cleanOwner = owner.trim();
    const cleanRepo = repo.trim().replace(/\.git$/i, "");
    if (
      !cleanOwner ||
      !cleanRepo ||
      cleanOwner.includes("..") ||
      cleanRepo.includes("..") ||
      cleanOwner.toLowerCase() === "_activity_cache" ||
      !SAFE_GIT_SEGMENT_RE.test(cleanOwner) ||
      !SAFE_GIT_SEGMENT_RE.test(cleanRepo)
    ) {
      return null;
    }
    const baseDirs = [resolve(REPO_ROOT, "data/git-repos"), resolve(API_ROOT, "data/git-repos")];
    for (const baseDir of baseDirs) {
      const candidate = resolve(baseDir, cleanOwner, `${cleanRepo}.git`);
      if (candidate.startsWith(baseDir + path.sep) && existsSync(candidate)) {
        return candidate;
      }
    }
    if (
      process.env["NODE_ENV"] !== "production" &&
      `${cleanOwner}/${cleanRepo}`.toLowerCase() === "modelscript/modelscript" &&
      existsSync(join(REPO_ROOT, ".git"))
    ) {
      return REPO_ROOT;
    }
    return null;
  }

  function getOrBuildLocalRepoTree(repoKeyLower: string): LocalRepoTreeCacheEntry | null {
    const existing = localRepoTreeCache.get(repoKeyLower);
    if (existing) return existing;

    const extractedDir = resolveExtractedLibraryDir(repoKeyLower);
    const virtualFiles = SHOWCASE_REPO_FILES[repoKeyLower] || {};
    if (!extractedDir && Object.keys(virtualFiles).length === 0) {
      return null;
    }

    const tree: LocalRepoTreeCacheEntry["tree"] = [];
    const blobPathBySha = new Map<string, string>();
    const virtualContentBySha = new Map<string, Buffer>();
    const seenPaths = new Set<string>();

    if (extractedDir && existsSync(extractedDir)) {
      const walk = (dir: string, prefix: string): void => {
        let entries;
        try {
          entries = readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        entries.sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
          if (entry.name.startsWith(".")) continue;
          const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            const sha = crypto.createHash("sha1").update(`tree:${relPath}`).digest("hex");
            tree.push({ path: relPath, mode: "040000", type: "tree", sha });
            seenPaths.add(relPath);
            walk(fullPath, relPath);
          } else if (entry.isFile()) {
            try {
              const st = statSync(fullPath);
              const sha = crypto.createHash("sha1").update(`blob:${relPath}:${st.size}`).digest("hex");
              tree.push({ path: relPath, mode: "100644", type: "blob", sha, size: st.size });
              blobPathBySha.set(sha, fullPath);
              seenPaths.add(relPath);
            } catch {
              // ignore unreadable file
            }
          }
        }
      };
      walk(extractedDir, "");
    }

    for (const [rawPath, content] of Object.entries(virtualFiles)) {
      const cleanPath = rawPath.replace(/^\/+/, "");
      const parts = cleanPath.split("/");
      for (let i = 1; i < parts.length; i++) {
        const dirPrefix = parts.slice(0, i).join("/");
        if (!seenPaths.has(dirPrefix)) {
          const dirSha = crypto.createHash("sha1").update(`vtree:${dirPrefix}`).digest("hex");
          tree.push({ path: dirPrefix, mode: "040000", type: "tree", sha: dirSha });
          seenPaths.add(dirPrefix);
        }
      }
      if (!seenPaths.has(cleanPath)) {
        const buf = Buffer.from(content, "utf-8");
        const sha = crypto.createHash("sha1").update(`vblob:${cleanPath}`).digest("hex");
        tree.push({ path: cleanPath, mode: "100644", type: "blob", sha, size: buf.length });
        virtualContentBySha.set(sha, buf);
        seenPaths.add(cleanPath);
      }
    }

    const entry: LocalRepoTreeCacheEntry = {
      tree,
      blobPathBySha,
      virtualContentBySha,
      extractedDir,
      virtualFiles,
    };
    localRepoTreeCache.set(repoKeyLower, entry);
    return entry;
  }

  function serveGitRepoApiRequest(
    req: express.Request,
    res: express.Response,
    gitRepoPath: string,
    owner: string,
    repo: string,
    restPath: string,
    headSha = "HEAD",
  ): boolean {
    if (restPath.startsWith("git/trees/")) {
      const out = execFileSync("git", ["ls-tree", "-r", "-t", "-l", "HEAD"], {
        cwd: gitRepoPath,
        encoding: "utf-8",
      });
      const tree: Array<{
        path: string;
        mode: string;
        type: "blob" | "tree";
        sha: string;
        size?: number;
      }> = [];
      for (const line of out.split("\n")) {
        if (!line.trim()) continue;
        const tabIdx = line.indexOf("\t");
        if (tabIdx === -1) continue;
        const meta = line.slice(0, tabIdx).trim().split(/\s+/);
        const entryPath = line.slice(tabIdx + 1);
        const mode = meta[0] || "100644";
        const type = (meta[1] === "tree" ? "tree" : "blob") as "blob" | "tree";
        const sha = meta[2] || "";
        const sizeRaw = meta[3];
        const size = sizeRaw && sizeRaw !== "-" ? Number.parseInt(sizeRaw, 10) : undefined;
        tree.push({
          path: entryPath,
          mode,
          type,
          sha,
          ...(size !== undefined && !Number.isNaN(size) ? { size } : {}),
        });
      }
      res.json({
        sha: headSha,
        url: `${req.protocol}://${req.get("host") || "localhost"}/api/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${headSha}`,
        tree,
        truncated: false,
      });
      return true;
    }

    if (restPath.startsWith("contents/")) {
      const rawFilePath = decodeURIComponent(restPath.slice("contents/".length)).replace(/^\/+/, "");
      const normalizedPath = path.posix.normalize(rawFilePath);
      if (!normalizedPath || normalizedPath.startsWith("..") || normalizedPath.includes("/../")) {
        res.status(400).json({ message: "Invalid file path" });
        return true;
      }
      try {
        const buf = execFileSync("git", ["show", `HEAD:${normalizedPath}`], {
          cwd: gitRepoPath,
        });
        res.json({
          name: path.posix.basename(normalizedPath),
          path: normalizedPath,
          sha: headSha,
          size: buf.length,
          type: "file",
          encoding: "base64",
          content: buf.toString("base64"),
        });
      } catch {
        res.status(404).json({ message: `File '${normalizedPath}' not found in ${owner}/${repo}` });
      }
      return true;
    }

    if (restPath.startsWith("git/blobs/")) {
      const sha = restPath.slice("git/blobs/".length).trim();
      if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
        res.status(400).json({ message: "Invalid blob SHA" });
        return true;
      }
      try {
        const buf = execFileSync("git", ["cat-file", "blob", sha], {
          cwd: gitRepoPath,
        });
        res.json({
          sha,
          size: buf.length,
          encoding: "base64",
          content: buf.toString("base64"),
        });
      } catch {
        res.status(404).json({ message: "Blob not found" });
      }
      return true;
    }

    return false;
  }

  function serveLocalOrShowcaseRepoRequest(
    req: express.Request,
    res: express.Response,
    owner: string,
    repo: string,
    restPath: string,
    cacheEntry: LocalRepoTreeCacheEntry,
  ): boolean {
    if (restPath.startsWith("git/trees/")) {
      const rawRef = decodeURIComponent(restPath.slice("git/trees/".length)).trim() || "main";
      res.json({
        sha: rawRef,
        url: `${req.protocol}://${req.get("host") || "localhost"}/api/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(rawRef)}`,
        tree: cacheEntry.tree,
        truncated: false,
      });
      return true;
    }

    if (restPath.startsWith("contents/")) {
      const rawFilePath = decodeURIComponent(restPath.slice("contents/".length)).replace(/^\/+/, "");
      const normalizedPath = path.posix.normalize(rawFilePath);
      if (!normalizedPath || normalizedPath.startsWith("..") || normalizedPath.includes("/../")) {
        res.status(400).json({ message: "Invalid file path" });
        return true;
      }
      if (cacheEntry.extractedDir) {
        const fullPath = resolve(cacheEntry.extractedDir, normalizedPath);
        if (fullPath.startsWith(cacheEntry.extractedDir + path.sep) && existsSync(fullPath)) {
          try {
            const st = statSync(fullPath);
            if (st.isFile()) {
              const buf = readFileSync(fullPath);
              const sha = crypto.createHash("sha1").update(`blob:${normalizedPath}:${st.size}`).digest("hex");
              res.json({
                name: path.posix.basename(normalizedPath),
                path: normalizedPath,
                sha,
                size: buf.length,
                type: "file",
                encoding: "base64",
                content: buf.toString("base64"),
              });
              return true;
            }
          } catch {
            // fall through
          }
        }
      }
      const virtualContent = cacheEntry.virtualFiles[normalizedPath];
      if (virtualContent !== undefined) {
        const buf = Buffer.from(virtualContent, "utf-8");
        const sha = crypto.createHash("sha1").update(`vblob:${normalizedPath}`).digest("hex");
        res.json({
          name: path.posix.basename(normalizedPath),
          path: normalizedPath,
          sha,
          size: buf.length,
          type: "file",
          encoding: "base64",
          content: buf.toString("base64"),
        });
        return true;
      }
      res.status(404).json({ message: `File '${normalizedPath}' not found` });
      return true;
    }

    if (restPath.startsWith("git/blobs/")) {
      const sha = restPath.slice("git/blobs/".length).trim();
      const diskPath = cacheEntry.blobPathBySha.get(sha);
      if (diskPath && existsSync(diskPath)) {
        try {
          const buf = readFileSync(diskPath);
          res.json({
            sha,
            size: buf.length,
            encoding: "base64",
            content: buf.toString("base64"),
          });
          return true;
        } catch {
          // fall through
        }
      }
      const vbuf = cacheEntry.virtualContentBySha.get(sha);
      if (vbuf) {
        res.json({
          sha,
          size: vbuf.length,
          encoding: "base64",
          content: vbuf.toString("base64"),
        });
        return true;
      }
      res.status(404).json({ message: "Blob not found" });
      return true;
    }

    return false;
  }

  // GitHub API CORS Proxy for github-fs virtual filesystem
  router.options("/api/github/*subpath", (_req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Accept, User-Agent, Authorization");
    res.status(204).end();
  });

  router.use("/api/github", optionalAuth, async (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
      res.status(405).json({ error: "Method not allowed on GitHub read-only proxy" });
      return;
    }
    try {
      const cleanSubpath = "/" + (req.url || "/").replace(/^\/+/, "");
      const [pathOnly] = cleanSubpath.split("?");

      // Intercept Personal Activity Git Vault (/api/github/repos/:owner/activity/...) for VS Code Web IDE github-fs
      const activityMatch = (pathOnly || "").match(/^\/repos\/([^/]+)\/(activity(?:\.git)?)\/(.+)$/i);
      if (database && activityMatch) {
        const ownerParam = decodeURIComponent(activityMatch[1] || "").trim();
        const restPath = activityMatch[3] || "";

        res.setHeader("Cache-Control", "private, no-store, max-age=0");

        if (!req.user) {
          res.status(401).json({
            message: "Authentication required to access personal activity repository in Web IDE.",
          });
          return;
        }

        const targetUser = ownerParam.toLowerCase() === "me" ? req.user : database.getUserByUsername(ownerParam);
        if (!targetUser) {
          res.status(404).json({ message: `User '${ownerParam}' not found.` });
          return;
        }

        if (req.user.id !== targetUser.id || Boolean(req.user.isBot)) {
          res.status(403).json({
            message: "Personal activity repositories are strictly private to the account owner.",
          });
          return;
        }

        if (req.tokenScopes) {
          const hasScope =
            req.tokenScopes.includes("*") ||
            req.tokenScopes.includes("admin") ||
            req.tokenScopes.includes("repos:read") ||
            req.tokenScopes.includes("repos:write") ||
            req.tokenScopes.includes("account:read");
          const hasUnrestrictedPattern = !req.tokenPackagePattern || req.tokenPackagePattern === "*";
          if (!hasScope || !hasUnrestrictedPattern) {
            res.status(403).json({
              message:
                "Personal access token requires unrestricted 'repos:read' or 'account:read' scope to access activity.git.",
            });
            return;
          }
        }

        const sync = ensureUserActivityRepo(database, targetUser.id);
        const headSha = sync.fingerprint || "main";
        if (serveGitRepoApiRequest(req, res, sync.repoPath, targetUser.username, "activity", restPath, headSha)) {
          return;
        }
        res.status(404).json({ message: "Unsupported activity repository GitHub API endpoint" });
        return;
      }

      // Intercept local extracted standard libraries (ModelicaStandardLibrary, SysML-v2-Release) & local git repositories
      const repoMatch = (pathOnly || "").match(/^\/repos\/([^/]+)\/([^/]+)\/(.+)$/i);
      if (repoMatch) {
        const ownerParam = decodeURIComponent(repoMatch[1] || "").trim();
        const repoParam = decodeURIComponent(repoMatch[2] || "").trim();
        const restPath = repoMatch[3] || "";
        const repoKeyLower = `${ownerParam}/${repoParam}`.toLowerCase();

        // 1. Local extracted standard libraries (fast, offline-capable, zero GitHub API rate limit usage)
        if (resolveExtractedLibraryDir(repoKeyLower)) {
          const cacheEntry = getOrBuildLocalRepoTree(repoKeyLower);
          if (cacheEntry && serveLocalOrShowcaseRepoRequest(req, res, ownerParam, repoParam, restPath, cacheEntry)) {
            return;
          }
        }

        // 2. Local hosted bare git repositories (data/git-repos/:owner/:repo.git or modelscript/modelscript)
        const localGitDir = resolveLocalGitRepoDir(ownerParam, repoParam);
        if (localGitDir) {
          if (database) {
            const ownerUser = database.getUserByUsername(ownerParam);
            if (ownerUser) {
              const cleanProjLower = repoParam.replace(/\.git$/i, "").toLowerCase();
              const matchedRepo = database.getUserRepos(ownerUser.id).find((r) => {
                const rProj = (r.project || "").replace(/\.git$/i, "").toLowerCase();
                const rFull = `${r.namespace || ""}/${r.project || ""}`.replace(/\.git$/i, "").toLowerCase();
                return rProj === cleanProjLower || rFull === `${ownerParam.toLowerCase()}/${cleanProjLower}`;
              });
              const vis = (matchedRepo as { visibility?: string | undefined } | undefined)?.visibility;
              if (vis === "private" || vis === "internal") {
                res.setHeader("Cache-Control", "private, no-store, max-age=0");
                if (!req.user) {
                  res.status(401).json({ message: "Authentication required to access private repository." });
                  return;
                }
                const isAdmin =
                  req.user.account_type === "admin" || (req.user as { role?: string | undefined }).role === "admin";
                if (vis === "private" && req.user.id !== ownerUser.id && !isAdmin) {
                  res.status(403).json({ message: "Forbidden: This repository is private." });
                  return;
                }
              }
            }
          }
          try {
            if (serveGitRepoApiRequest(req, res, localGitDir, ownerParam, repoParam, restPath, "main")) {
              return;
            }
          } catch {
            // Fall through to upstream or showcase fallback
          }
        }

        // 3. Non-GitHub showcase repositories (e.g. GitLab-hosted Eigen, Graphviz, Inkscape)
        if (
          repoKeyLower === "libeigen/eigen" ||
          repoKeyLower === "graphviz/graphviz" ||
          repoKeyLower === "inkscape/inkscape"
        ) {
          const cacheEntry = getOrBuildLocalRepoTree(repoKeyLower);
          if (cacheEntry && serveLocalOrShowcaseRepoRequest(req, res, ownerParam, repoParam, restPath, cacheEntry)) {
            return;
          }
        }
      }

      const allowedGitHubRepoPathRe =
        /^\/repos\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/(?:git\/trees\/|contents(?:\/|$)|git\/blobs\/|commits(?:\/|$)|branches(?:\/|$)|tags(?:\/|$))/i;
      const upstreamUrl = new URL(cleanSubpath, "https://api.github.com");
      if (
        upstreamUrl.origin !== "https://api.github.com" ||
        cleanSubpath.includes("..") ||
        !allowedGitHubRepoPathRe.test(upstreamUrl.pathname)
      ) {
        res.status(403).json({
          error:
            "GitHub proxy only permits read-only repository tree, contents, and blob endpoints (/repos/:owner/:repo/...)",
        });
        return;
      }
      const headers: Record<string, string> = {
        "User-Agent": "ModelScript-IDE",
        Accept: (req.headers["accept"] as string) || "application/vnd.github.v3+json",
      };
      const token = process.env["GITHUB_TOKEN"];
      if (req.headers["authorization"]) {
        headers["Authorization"] = req.headers["authorization"] as string;
      } else if (token) {
        headers["Authorization"] = `token ${token}`;
      }

      let response = await fetch(upstreamUrl.toString(), {
        method: req.method,
        headers,
      });

      // Automatic main -> master fallback on upstream 404 for git/trees/main or contents/...?ref=main
      if (response.status === 404) {
        let retryUrl: string | null = null;
        if (upstreamUrl.pathname.endsWith("/git/trees/main")) {
          const alt = new URL(upstreamUrl.toString());
          alt.pathname = alt.pathname.replace(/\/git\/trees\/main$/, "/git/trees/master");
          retryUrl = alt.toString();
        } else if (upstreamUrl.searchParams.get("ref") === "main") {
          const alt = new URL(upstreamUrl.toString());
          alt.searchParams.set("ref", "master");
          retryUrl = alt.toString();
        }
        if (retryUrl) {
          const retryRes = await fetch(retryUrl, { method: req.method, headers });
          if (retryRes.ok) {
            response = retryRes;
          }
        }
      }

      // Fallback to showcase catalog if upstream is rate-limited (403/429) or unavailable for a known showcase repo
      if ((response.status === 403 || response.status === 429 || response.status === 404) && repoMatch) {
        const ownerParam = decodeURIComponent(repoMatch[1] || "").trim();
        const repoParam = decodeURIComponent(repoMatch[2] || "").trim();
        const restPath = repoMatch[3] || "";
        const repoKeyLower = `${ownerParam}/${repoParam}`.toLowerCase();
        const cacheEntry = getOrBuildLocalRepoTree(repoKeyLower);
        if (cacheEntry && serveLocalOrShowcaseRepoRequest(req, res, ownerParam, repoParam, restPath, cacheEntry)) {
          return;
        }
      }

      res.status(response.status);
      const strippedResponseHeaders = new Set([
        "content-encoding",
        "transfer-encoding",
        "x-oauth-scopes",
        "x-accepted-oauth-scopes",
        "set-cookie",
      ]);
      response.headers.forEach((val, key) => {
        const lower = key.toLowerCase();
        if (!strippedResponseHeaders.has(lower)) {
          res.setHeader(key, val);
        }
      });

      const buffer = Buffer.from(await response.arrayBuffer());
      res.send(buffer);
    } catch {
      const cleanSubpath = "/" + (req.url || "/").replace(/^\/+/, "");
      const [pathOnly] = cleanSubpath.split("?");
      const repoMatch = (pathOnly || "").match(/^\/repos\/([^/]+)\/([^/]+)\/(.+)$/i);
      if (repoMatch) {
        const ownerParam = decodeURIComponent(repoMatch[1] || "").trim();
        const repoParam = decodeURIComponent(repoMatch[2] || "").trim();
        const restPath = repoMatch[3] || "";
        const repoKeyLower = `${ownerParam}/${repoParam}`.toLowerCase();
        const cacheEntry = getOrBuildLocalRepoTree(repoKeyLower);
        if (cacheEntry && serveLocalOrShowcaseRepoRequest(req, res, ownerParam, repoParam, restPath, cacheEntry)) {
          return;
        }
      }
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
