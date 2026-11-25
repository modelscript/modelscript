// SPDX-License-Identifier: AGPL-3.0-or-later

import type express from "express";
import { existsSync, readFileSync, watch, type FSWatcher } from "node:fs";
import path, { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { LibraryDatabase } from "../database.js";
import { normalizeWorkspaceTemplate } from "../util/snowflake.js";
import { initSseStream, type SseStreamHandle } from "../util/sse.js";
import type { LocalGitVaultService } from "./local-git-vault.js";

const SERVICES_DIR = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.resolve(SERVICES_DIR, "../..");
const REPO_ROOT = path.resolve(API_ROOT, "../..");
const DEFAULT_IDE_ROOT = path.resolve(REPO_ROOT, "apps/ide");

const ALLOWED_GITHUB_REPO_PATH_RE =
  /^\/repos\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/(?:git\/trees\/|contents(?:\/|$)|git\/blobs\/|commits(?:\/|$)|branches(?:\/|$)|tags(?:\/|$))/i;

const STRIPPED_PROXY_RESPONSE_HEADERS = new Set([
  "content-encoding",
  "transfer-encoding",
  "x-oauth-scopes",
  "x-accepted-oauth-scopes",
  "set-cookie",
]);

export interface IdeAssetPaths {
  ideRoot: string;
  vscodeWebDir: string;
  modelscriptExtDir: string;
  githubFsExtDir: string;
  modelsDir: string;
}

export function getIdeRoot(): string {
  return process.env["IDE_ROOT"] ? path.resolve(process.env["IDE_ROOT"]) : DEFAULT_IDE_ROOT;
}

export function resolveIdeAssetPaths(ideRoot = getIdeRoot()): IdeAssetPaths {
  return {
    ideRoot,
    vscodeWebDir: resolve(ideRoot, "vscode-web"),
    modelscriptExtDir: resolve(ideRoot, "dist", "extension"),
    githubFsExtDir: resolve(ideRoot, "github-fs"),
    modelsDir: resolve(ideRoot, "models"),
  };
}

export function getTestWebDir(ideRoot: string): string {
  const candidates = [
    resolve(REPO_ROOT, "node_modules", "@vscode", "test-web"),
    resolve(ideRoot, "node_modules", "@vscode", "test-web"),
    resolve(API_ROOT, "node_modules", "@vscode", "test-web"),
  ];
  return candidates.find(existsSync) || candidates[0]!;
}

export function getWorkbenchTemplate(testWebDir: string): string | null {
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

export function resolveWebviewPreHtmlPath(vscodeWebDir: string, requestPath: string): string | null {
  const fileName = requestPath.endsWith("index-no-csp.html") ? "index-no-csp.html" : "index.html";
  const filePath = join(vscodeWebDir, "out", "vs", "workbench", "contrib", "webview", "browser", "pre", fileName);
  return existsSync(filePath) ? filePath : null;
}

export function escapeJSON(value: unknown): string {
  return JSON.stringify(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function escapeHtml(unsafe: string): string {
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
 * Renders the VS Code Web workbench HTML document configured with the Ansatz Studio extension,
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
      html: `<!DOCTYPE html><html><head><title>Ansatz Studio Unavailable</title></head><body style="background:#0d1117;color:#c9d1d9;font-family:system-ui,sans-serif;padding:32px;"><h2>VS Code Web workbench template not found</h2><p>Run <code>npm run download-vscode --workspace=@modelscript/ide &amp;&amp; npm run build-extension --workspace=@modelscript/ide</code> to initialize the local IDE bundle.</p></body></html>`,
    };
  }

  const relativeBaseUrl = "/vscode-static";
  const webEndpoint = `${protocol}://${host}/vscode-static`;

  const isAirgap = process.env["MODELSCRIPT_AIRGAPPED"] === "true";
  const trustedOriginsEnv = (process.env["MODELSCRIPT_TRUSTED_ORIGINS"] || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const galleryConfig = isAirgap
    ? {
        serviceUrl: "",
        itemUrl: "",
        resourceUrlTemplate: "",
        controlUrl: "",
        mcpUrl: "",
      }
    : {
        serviceUrl: "https://open-vsx.org/vscode/gallery",
        itemUrl: "https://open-vsx.org/vscode/item",
        resourceUrlTemplate: "https://open-vsx.org/vscode/unpkg/{publisher}/{name}/{version}/{path}",
        controlUrl: "",
        mcpUrl: "",
      };

  const productConfiguration: Record<string, unknown> = {
    enableTelemetry: false,
    nameShort: "ModelScript",
    nameLong: "Studio",
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
      "modelscript.network.airgapped": isAirgap,
      ...(trustedOriginsEnv.length > 0 ? { "modelscript.security.trustedOrigins": trustedOriginsEnv } : {}),
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
        "*.oscal": "oscal",
        "*.oscal.json": "oscal",
        "*.oscal.xml": "oscal",
        "*.oscal.yaml": "oscal",
        "*.oscal.yml": "oscal",
        "*.dcm.json": "dicom-rt",
        "*.rtplan.json": "dicom-rt",
        "*.rtdose.json": "dicom-rt",
        "*.rtstruct.json": "dicom-rt",
        "*.igtl": "igtl",
        "*.igtl.json": "igtl",
        "*.igtl.xml": "igtl",
        "*.nii.json": "nifti",
        "*.nrrd": "nifti",
        "*.qif": "qif",
        "*.qif.xml": "qif",
        "*.qif.json": "qif",
        "*.ocpp": "ocpp",
        "*.ocpp.json": "ocpp",
        "*.oadr": "openadr",
        "*.oadr.xml": "openadr",
        "*.oadr.json": "openadr",
        "*.oadr.yaml": "openadr",
        "*.aml": "automationml",
        "*.amlx": "automationml",
        "*.osim": "opensim",
        "*.feb": "febio",
        "*.cellml": "cellml",
        "*.sedml": "sedml",
        "*.sbol": "sbol",
        "*.3mf": "three-mf",
        "*.amf": "three-mf",
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
  
  var hash = location.hash.replace(/^[#/]+/, '');
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
            localStorage.setItem('modelscript.initialAnchor', anchorParam);
          } catch (e) { /* Storage may be unavailable in sandboxed iframes */ }
        }
      }
      if (template.startsWith('artifact-') || /^\\d+$/.test(template)) {
        var artId = template.startsWith('artifact-') ? template.slice(9) : template;
        var cachedTitle = null;
        try {
          var cached = sessionStorage.getItem('modelscript.artifact_' + artId) ||
                       localStorage.getItem('modelscript.artifact_' + artId) ||
                       sessionStorage.getItem('modelscript.artifact_scratch') ||
                       localStorage.getItem('modelscript.artifact_scratch');
          if (cached) {
            var parsed = JSON.parse(cached);
            if (parsed && parsed.title) cachedTitle = parsed.title;
          }
        } catch (e) { /* Ignore unreadable or malformed cached scratch metadata */ }
        document.title = (cachedTitle || ('Workspace #' + artId)) + (anchorParam ? ' (' + anchorParam + ')' : '') + ' — Studio';
      } else if (template.startsWith('package-')) {
        document.title = 'Package ' + template.slice(8) + (anchorParam ? ' (' + anchorParam + ')' : '') + ' — Studio';
      } else {
        document.title = 'New Project — Studio';
      }
      config.folderUri = { scheme: 'memfs', authority: '', path: '/' + template };
    } else {
      var parts = hash.split('@');
      var ownerRepo = parts[0];
      var ref = parts[1] || 'main';
      var p = ownerRepo.split('/');
      var owner = p[0] || 'modelscript';
      var repo = p[1] || 'modelscript';
      document.title = owner + '/' + repo + ' — Studio';
      config.folderUri = { scheme: 'github', authority: '', path: '/' + owner + '/' + repo, query: 'ref=' + ref };
    }
  }
  
  config.productConfiguration = config.productConfiguration || {};
  config.productConfiguration.webEndpointUrlTemplate = location.origin + '/vscode-static';
  config.productConfiguration.webviewContentExternalBaseUrlTemplate = location.origin + '/vscode-static/out/vs/workbench/contrib/webview/browser/pre/';
  config.productConfiguration.chatParticipantRegistry = '';
  
  el.setAttribute('data-settings', JSON.stringify(config));

  function handleIncomingBridgeData(data) {
    if (!data || typeof data !== 'object') return;
    if (data.type === 'MODELSCRIPT_AUTH_SYNC' && data.token) {
      try {
        sessionStorage.setItem('modelscript.token', data.token);
        localStorage.setItem('modelscript.token', data.token);
        if (data.user) {
          sessionStorage.setItem('modelscript.user', JSON.stringify(data.user));
          localStorage.setItem('modelscript.user', JSON.stringify(data.user));
        }
      } catch (e) { /* Storage may be unavailable in sandboxed iframes */ }
    }
    if (data.type === 'MODELSCRIPT_MOUNT_ARTIFACT' && data.artifactId) {
      try {
        sessionStorage.setItem('modelscript.artifact_' + data.artifactId, JSON.stringify(data));
        localStorage.setItem('modelscript.artifact_' + data.artifactId, JSON.stringify(data));
        localStorage.setItem('modelscript:ide:memfs:' + data.artifactId, JSON.stringify(data));
        localStorage.setItem('modelscript:ide:memfs:artifact-' + data.artifactId, JSON.stringify(data));
        if (data.title) {
          document.title = data.title + ' — Studio';
        }
      } catch (e) { /* Storage may be unavailable in sandboxed iframes */ }
    }
  }

  function getSafeTargetOrigin() {
    try {
      if (document.referrer) {
        var refUrl = new URL(document.referrer);
        if (checkOriginAllowed(refUrl.origin)) return refUrl.origin;
      }
    } catch (e) { /* Invalid referrer URL; fall back to window origin */ }
    return window.location.origin;
  }

  function checkOriginAllowed(origin) {
    if (!origin || origin === 'null') return false;
    if (origin === window.location.origin) return true;
    try {
      var parsed = new URL(origin);
      if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]') {
        return true;
      }
      var wbElem = document.getElementById('vscode-workbench-web-configuration');
      var cfgText = wbElem ? wbElem.getAttribute('data-settings') : null;
      var cfg = cfgText ? JSON.parse(cfgText) : null;
      var defaults = (cfg && cfg.configurationDefaults) || {};
      var airgapped = Boolean(defaults['modelscript.network.airgapped']);
      var trustedList = Array.isArray(defaults['modelscript.security.trustedOrigins'])
        ? defaults['modelscript.security.trustedOrigins']
        : [];
      for (var i = 0; i < trustedList.length; i++) {
        var entry = String(trustedList[i] || '').trim().replace(/\\/+$/, '');
        if (!entry) continue;
        if (entry === origin) return true;
        if (entry.indexOf('*.') === 0 && (parsed.hostname === entry.slice(2) || parsed.hostname.endsWith('.' + entry.slice(2)))) {
          return true;
        }
        if (entry.indexOf('https://*.') === 0 && parsed.protocol === 'https:' && (parsed.hostname === entry.slice(10) || parsed.hostname.endsWith('.' + entry.slice(10)))) {
          return true;
        }
      }
      if (airgapped) return false;
      if (
        origin === 'https://ansatz.social' ||
        origin === 'https://modelscript.org' ||
        (parsed.protocol === 'https:' && (parsed.hostname.endsWith('.ansatz.social') || parsed.hostname.endsWith('.modelscript.org')))
      ) {
        return true;
      }
    } catch (e) { /* Malformed origin URL; treat as disallowed */ }
    return false;
  }

  try {
    var targetOrigin = getSafeTargetOrigin();
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'MODELSCRIPT_READY' }, targetOrigin);
    }
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: 'MODELSCRIPT_READY' }, targetOrigin);
    }
  } catch (e) { /* Cross-origin parent/opener postMessage is best-effort */ }

  if (typeof BroadcastChannel !== 'undefined') {
    try {
      var bridgeChannel = new BroadcastChannel('modelscript:host-bridge');
      bridgeChannel.addEventListener('message', function(ev) {
        handleIncomingBridgeData(ev.data);
      });
      bridgeChannel.postMessage({ type: 'MODELSCRIPT_READY' });
    } catch (e) { /* BroadcastChannel may be blocked in restricted contexts */ }
  }

  window.addEventListener('message', function(ev) {
    if (!checkOriginAllowed(ev.origin)) return;
    handleIncomingBridgeData(ev.data);
  });

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
              } catch (e2) { /* Cross-origin nested iframe access denied */ }
            }
          }
        }
      }
    } catch (err) { /* Best-effort drag forwarding to webviews */ }
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
    } catch (mErr) { /* Ignore inaccessible drag-and-drop MIME payloads */ }
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
          } catch (e2) { /* Cross-origin nested iframe access denied */ }
        }
      }
    } catch (err) { /* Best-effort dragEnd broadcast to webviews */ }
  }, true);
})();
</script>`;

  return {
    status: 200,
    html: html.replace("</head>", patchScript + "\n</head>"),
  };
}

export function renderWrapper(provider: string, owner: string, repo: string, ref: string): string {
  const folderUri = `github:///${owner}/${repo}?ref=${ref}`;
  const safeOwner = escapeHtml(owner);
  const safeRepo = escapeHtml(repo);
  const safeRef = escapeHtml(ref);
  const providerDomain = provider === "ansatz" ? "ansatz.social" : `${escapeHtml(provider)}.com`;

  return `<!DOCTYPE html>
<html><head>
<title>${safeOwner}/${safeRepo} — Studio</title>
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
  <a href="/${providerDomain}/${safeOwner}/${safeRepo}">${safeOwner}<span class="sep">/</span><span class="repo">${safeRepo}</span></a>
  <span class="sep">@</span>
  <span style="color: #8b949e; font-family: monospace; font-size: 13px;">${safeRef}</span>
</div>
<iframe src="/vscode/workbench?folder=${encodeURIComponent(folderUri)}"></iframe>
</body></html>`;
}

export function applyIdeIsolationHeaders(req: express.Request, res: express.Response): void {
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
    let currentCsp = res.getHeader("Content-Security-Policy");
    if (typeof currentCsp === "string") {
      if (!currentCsp.includes("'unsafe-eval'")) {
        currentCsp = currentCsp.replace("script-src ", "script-src 'unsafe-eval' ");
      }
      if (!currentCsp.includes("http:")) {
        currentCsp = currentCsp.replace("connect-src ", "connect-src http: ");
      }
      res.setHeader("Content-Security-Policy", currentCsp);
    }
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
}

export function parseWorkbenchFolderConfig(
  rawFolder: string,
): { ok: true; folderConfig: Record<string, unknown> | null } | { ok: false; error: string } {
  if (!rawFolder) {
    return { ok: true, folderConfig: null };
  }
  if (rawFolder.startsWith("memfs:")) {
    const rawTemplate = rawFolder.split(":")[1] || "empty";
    const normalized = normalizeWorkspaceTemplate(rawTemplate);
    const template =
      normalized.isWorkspace && normalized.workspaceId !== "scratch" ? normalized.workspaceId : rawTemplate;
    return { ok: true, folderConfig: { scheme: "memfs", authority: "", path: "/" + template } };
  }
  const match = rawFolder.match(/^(?:github|gitlab|ansatz):\/\/\/([^/]+)\/([^/?]+)(?:\?ref=(.+))?$/);
  if (!match) {
    return {
      ok: false,
      error: "Invalid folder URI. Expected: github:///owner/repo?ref=branch or memfs:template",
    };
  }
  const [, owner, repo, ref = "main"] = match;
  return {
    ok: true,
    folderConfig: {
      scheme: "github",
      authority: "",
      path: `/${owner}/${repo}`,
      query: `ref=${ref}`,
    },
  };
}

export function resolveWorkbenchOrigin(req: express.Request): { protocol: "http" | "https"; host: string } {
  const trustProxy = process.env["TRUST_PROXY"] === "true";
  const forwardedProto = trustProxy ? req.headers["x-forwarded-proto"] : undefined;
  const rawProto = forwardedProto ? String(forwardedProto).split(",")[0]!.trim() : req.protocol || "http";
  const protocol = rawProto === "https" ? "https" : "http";
  const forwardedHost = trustProxy ? req.headers["x-forwarded-host"] : undefined;
  const rawHost = forwardedHost ? String(forwardedHost).split(",")[0]!.trim() : req.get("host") || "localhost:3000";
  const host = /^[a-zA-Z0-9._:-]+$/.test(rawHost) ? rawHost : "localhost:3000";
  return { protocol, host };
}

// ── User-Language WASM Registry Helpers ────────────────────────────────────────

export function getUserLanguagesDir(): string {
  if (process.env["MODELSCRIPT_LANGUAGES_DIR"]) {
    return resolve(process.env["MODELSCRIPT_LANGUAGES_DIR"]);
  }
  const home = process.env["HOME"] || process.env["USERPROFILE"] || "";
  return join(home, ".modelscript", "languages");
}

export function readUserLanguageRegistry():
  { status: "missing" } | { status: "ok"; raw: string } | { status: "error"; error: unknown } {
  const regPath = join(getUserLanguagesDir(), "registry.json");
  if (!existsSync(regPath)) {
    return { status: "missing" };
  }
  try {
    return { status: "ok", raw: readFileSync(regPath, "utf-8") };
  } catch (error) {
    return { status: "error", error };
  }
}

export function resolveUserLanguageWasmPath(
  rawId: unknown,
): { ok: true; filePath: string } | { ok: false; status: 400 | 404; message: string } {
  if (!rawId || typeof rawId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(rawId)) {
    return { ok: false, status: 400, message: "Invalid language ID" };
  }
  const langId = path.basename(rawId);
  const baseDir = getUserLanguagesDir();
  const langDir = resolve(baseDir, langId);
  if (!langDir.startsWith(baseDir + path.sep) && langDir !== baseDir) {
    return { ok: false, status: 400, message: "Invalid language directory" };
  }
  const candidates = [
    join(langDir, "parser.wasm"),
    join(langDir, "dist", "parser.wasm"),
    join(langDir, `${langId}.wasm`),
  ];
  const found = candidates.find(existsSync);
  if (found) {
    return { ok: true, filePath: found };
  }
  return { ok: false, status: 404, message: `parser.wasm for user language '${langId}' not found` };
}

export class UserLanguageRegistryEventBus {
  private readonly clients: SseStreamHandle[] = [];
  private watcher: FSWatcher | null = null;

  subscribe(res: express.Response): void {
    if (this.clients.length >= 100) {
      res.status(429).json({ error: "Too many active language event listeners" });
      return;
    }
    const sse = initSseStream(res, {
      heartbeatMs: 15_000,
      onClose: () => {
        const idx = this.clients.indexOf(sse);
        if (idx !== -1) this.clients.splice(idx, 1);
        if (this.clients.length === 0 && this.watcher) {
          this.watcher.close();
          this.watcher = null;
        }
      },
    });
    if (sse.isClosed) {
      return;
    }
    this.clients.push(sse);

    if (!this.watcher && process.env["NODE_ENV"] !== "test") {
      const userLanguagesDir = getUserLanguagesDir();
      if (existsSync(userLanguagesDir)) {
        try {
          this.watcher = watch(userLanguagesDir, (_eventType, filename) => {
            if (filename === "registry.json") {
              const payload = `data: ${JSON.stringify({ event: "change" })}\n\n`;
              for (const client of [...this.clients]) {
                if (!client.writeRaw(payload)) {
                  client.close();
                }
              }
            }
          });
          this.watcher.unref?.();
        } catch {
          // Directory may not be watchable
        }
      }
    }
  }
}

// ── GitHub API CORS Proxy Helper ───────────────────────────────────────────────

export async function proxyGitHubApiRequest(
  req: express.Request,
  res: express.Response,
  vault: LocalGitVaultService,
  database?: LibraryDatabase,
): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
    res.status(405).json({ error: "Method not allowed on GitHub read-only proxy" });
    return;
  }

  const cleanSubpath = "/" + (req.url || "/").replace(/^\/+/, "");
  const [pathOnly] = cleanSubpath.split("?");
  const repoMatch = (pathOnly || "").match(/^\/repos\/([^/]+)\/([^/]+)\/(.+)$/i);

  const tryServeShowcaseFallback = (): boolean => {
    if (!repoMatch) return false;
    const ownerParam = decodeURIComponent(repoMatch[1] || "").trim();
    const repoParam = decodeURIComponent(repoMatch[2] || "").trim();
    const restPath = repoMatch[3] || "";
    const repoKeyLower = `${ownerParam}/${repoParam}`.toLowerCase();
    const cacheEntry = vault.getOrBuildLocalRepoTree(repoKeyLower);
    return Boolean(
      cacheEntry && vault.serveLocalOrShowcaseRepoRequest(req, res, ownerParam, repoParam, restPath, cacheEntry),
    );
  };

  try {
    // Intercept local extracted standard libraries (ModelicaStandardLibrary, SysML-v2-Release) & local git repositories
    if (repoMatch) {
      const ownerParam = decodeURIComponent(repoMatch[1] || "").trim();
      const repoParam = decodeURIComponent(repoMatch[2] || "").trim();
      const restPath = repoMatch[3] || "";
      const repoKeyLower = `${ownerParam}/${repoParam}`.toLowerCase();

      // 1. Local extracted standard libraries (fast, offline-capable, zero GitHub API rate limit usage)
      if (vault.resolveExtractedLibraryDir(repoKeyLower)) {
        const cacheEntry = vault.getOrBuildLocalRepoTree(repoKeyLower);
        if (
          cacheEntry &&
          vault.serveLocalOrShowcaseRepoRequest(req, res, ownerParam, repoParam, restPath, cacheEntry)
        ) {
          return;
        }
      }

      // 2. Local hosted bare git repositories (data/git-repos/:owner/:repo.git or modelscript/modelscript)
      const localGitDir = vault.resolveLocalGitRepoDir(ownerParam, repoParam);
      if (localGitDir) {
        if (database) {
          const access = vault.checkLocalRepoAccess(database, req.user, ownerParam, repoParam);
          if (access.isPrivateOrInternal) {
            res.setHeader("Cache-Control", "private, no-store, max-age=0");
          }
          if (!access.allowed) {
            res.status(access.status ?? 403).json({ message: access.message });
            return;
          }
        }
        try {
          if (vault.serveGitRepoApiRequest(req, res, localGitDir, ownerParam, repoParam, restPath, "main")) {
            return;
          }
        } catch {
          // Fall through to upstream or showcase fallback
        }
      }

      // 3. Non-GitHub showcase repositories (e.g. GitLab-hosted Eigen, Graphviz, Inkscape)
      if (vault.isNonGitHubShowcaseRepo(repoKeyLower)) {
        const cacheEntry = vault.getOrBuildLocalRepoTree(repoKeyLower);
        if (
          cacheEntry &&
          vault.serveLocalOrShowcaseRepoRequest(req, res, ownerParam, repoParam, restPath, cacheEntry)
        ) {
          return;
        }
      }
    }

    const upstreamUrl = new URL(cleanSubpath, "https://api.github.com");
    if (
      upstreamUrl.origin !== "https://api.github.com" ||
      cleanSubpath.includes("..") ||
      !ALLOWED_GITHUB_REPO_PATH_RE.test(upstreamUrl.pathname)
    ) {
      res.status(403).json({
        error:
          "GitHub proxy only permits read-only repository tree, contents, and blob endpoints (/repos/:owner/:repo/...)",
      });
      return;
    }

    if (process.env["MODELSCRIPT_AIRGAPPED"] === "true") {
      if (tryServeShowcaseFallback()) {
        return;
      }
      res.status(403).json({
        error: "Outbound GitHub API proxy is disabled when MODELSCRIPT_AIRGAPPED=true",
      });
      return;
    }

    const headers: Record<string, string> = {
      "User-Agent": "ModelScript-IDE",
      Accept: (req.headers["accept"] as string) || "application/vnd.github.v3+json",
    };
    const serverGithubToken = process.env["GITHUB_TOKEN"];
    const clientAuth = typeof req.headers["authorization"] === "string" ? req.headers["authorization"].trim() : "";
    const clientTokenRaw = clientAuth.replace(/^(?:Bearer|token)\s+/i, "").trim();
    // Never forward an internal Ansatz JWT (3-part base64url token starting with eyJ...) to api.github.com
    const isAnsatzJwt = clientTokenRaw.startsWith("eyJ") || clientTokenRaw.split(".").length === 3;
    const isExplicitGitHubToken =
      Boolean(clientTokenRaw) &&
      !isAnsatzJwt &&
      (/^(?:gh[pousr]_|github_pat_)/i.test(clientTokenRaw) ||
        /^token\s+/i.test(clientAuth) ||
        !clientTokenRaw.includes("."));

    if (isExplicitGitHubToken) {
      headers["Authorization"] = clientAuth;
    } else if (serverGithubToken) {
      headers["Authorization"] = `token ${serverGithubToken}`;
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
    if ((response.status === 403 || response.status === 429 || response.status === 404) && tryServeShowcaseFallback()) {
      return;
    }

    res.status(response.status);
    response.headers.forEach((val, key) => {
      if (!STRIPPED_PROXY_RESPONSE_HEADERS.has(key.toLowerCase())) {
        res.setHeader(key, val);
      }
    });

    const buffer = Buffer.from(await response.arrayBuffer());
    res.send(buffer);
  } catch {
    if (tryServeShowcaseFallback()) {
      return;
    }
    res.status(502).json({ error: "GitHub proxy failed" });
  }
}
