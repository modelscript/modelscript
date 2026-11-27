// SPDX-License-Identifier: AGPL-3.0-or-later

import { createCanonicalPolyglotDemoBoard, serializeCanvasDocument, type CanvasDocument } from "@modelscript/canvas";
import react from "@vitejs/plugin-react";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { after, before, describe } from "node:test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createServer, type Alias, type Plugin, type ViteDevServer } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const WEB_ROOT = path.resolve(import.meta.dirname, "..");
const REPO_ROOT = path.resolve(WEB_ROOT, "../..");
const VIRTUAL_ENTRY_URL = "/__vr_rotunda_e2e_entry.tsx";
const VIRTUAL_ENTRY_RESOLVED = path.join(WEB_ROOT, "__vr_rotunda_e2e_entry.tsx");

const CHROMIUM_CANDIDATES = ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"] as const;
const ROTUNDA_ENV_IDS = ["atrium", "warehouse", "office", "outdoors", "dark-lab", "passthrough"] as const;

function findChromiumExecutable(): string | null {
  for (const candidate of CHROMIUM_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function buildNodeShimAliases(webRoot: string): Alias[] {
  const nodeUrlShim = path.resolve(webRoot, "src/util/node-url-shim.ts");
  const nodeShims = path.resolve(webRoot, "src/util/node-shims.ts");
  return [
    { find: /^node:url$/, replacement: nodeUrlShim },
    { find: /^url$/, replacement: nodeUrlShim },
    { find: /^node:child_process$/, replacement: nodeShims },
    { find: /^child_process$/, replacement: nodeShims },
    { find: /^node:fs\/promises$/, replacement: nodeShims },
    { find: /^fs\/promises$/, replacement: nodeShims },
    { find: /^node:fs$/, replacement: nodeShims },
    { find: /^fs$/, replacement: nodeShims },
    { find: /^node:os$/, replacement: nodeShims },
    { find: /^os$/, replacement: nodeShims },
    { find: /^node:path$/, replacement: nodeShims },
    { find: /^path$/, replacement: nodeShims },
    { find: /^node:readline\/promises$/, replacement: nodeShims },
    { find: /^readline\/promises$/, replacement: nodeShims },
    { find: /^node:readline$/, replacement: nodeShims },
    { find: /^readline$/, replacement: nodeShims },
    { find: /^node:zlib$/, replacement: nodeShims },
    { find: /^zlib$/, replacement: nodeShims },
    { find: /^node:crypto$/, replacement: nodeShims },
    { find: /^crypto$/, replacement: nodeShims },
    { find: /^node:net$/, replacement: nodeShims },
    { find: /^net$/, replacement: nodeShims },
    { find: /^node:events$/, replacement: nodeShims },
    { find: /^events$/, replacement: nodeShims },
    { find: /^node:module$/, replacement: nodeShims },
    { find: /^module$/, replacement: nodeShims },
    { find: /^node:worker_threads$/, replacement: nodeShims },
    { find: /^worker_threads$/, replacement: nodeShims },
  ];
}

function buildVirtualEntrySource(): string {
  return `
import "@modelscript/design-tokens/components.css";
import "@modelscript/design-tokens/tokens.css";
import { BaseStyles, ThemeProvider } from "@primer/react";
import React, { Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { setConsoleFunction } from "three";
import { AuthProvider } from "./src/AuthContext.tsx";
import { CapabilitiesProvider } from "./src/CapabilitiesContext.tsx";
import { ToastProvider } from "./src/components/ToastContext.tsx";
import { FeatureFlagProvider } from "./src/FeatureFlagContext.tsx";
import { InstanceBrandingProvider } from "./src/InstanceBrandingContext.tsx";
import { ModelingPreferencesProvider } from "./src/ModelingPreferencesContext.tsx";
import { ThemeContextProvider, useTheme } from "./src/theme.ts";

if (typeof setConsoleFunction === "function") {
  setConsoleFunction((type: string, message: unknown, ...params: unknown[]) => {
    if (
      type === "warn" &&
      typeof message === "string" &&
      (message.includes("Clock: This module has been deprecated") || message.includes("THREE.Clock"))
    ) {
      return;
    }
    if (type === "log") {
      console.log(message, ...params);
    } else if (type === "error") {
      console.error(message, ...params);
    } else {
      console.warn(message, ...params);
    }
  });
}

if (typeof window !== "undefined") {
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason as { name?: string; message?: string } | null | undefined;
    if (
      reason &&
      (reason.name === "Canceled" ||
        reason.message === "Canceled" ||
        reason.name === "CancellationError" ||
        (typeof reason.message === "string" && reason.message.includes("Canceled")))
    ) {
      event.preventDefault();
    }
  });
}

const SpatialCanvasPage = React.lazy(() => import("./src/pages/SpatialCanvasPage.tsx"));
const AnsatzEditorPage = React.lazy(() => import("./src/pages/AnsatzEditorPage.tsx"));
const EmbedAnsatzEditorPage = React.lazy(() => import("./src/pages/EmbedAnsatzEditorPage.tsx"));

function PreserveParamsNavigate({ to }: { to: string }): React.ReactElement {
  const location = useLocation();
  return <Navigate to={\`\${to}\${location.search}\${location.hash}\`} replace />;
}

function RouterShell(): React.ReactElement {
  const { theme } = useTheme();
  return (
    <ThemeProvider colorMode={theme === "dark" ? "night" : "day"}>
      <BaseStyles style={{ minHeight: "100vh", backgroundColor: "#0a0f1c", color: "#f8fafc" }}>
        <ToastProvider>
          <BrowserRouter>
            <Suspense
              fallback={
                <div data-testid="vr-e2e-loading" style={{ padding: 24, color: "#94a3b8" }}>
                  Loading…
                </div>
              }
            >
              <Routes>
                <Route path="/canvas" element={<SpatialCanvasPage />} />
                <Route path="/canvas/:boardId" element={<SpatialCanvasPage />} />
                <Route path="/editor" element={<AnsatzEditorPage />} />
                <Route path="/editor" element={<PreserveParamsNavigate to="/editor" />} />
                <Route path="/embed/editor" element={<EmbedAnsatzEditorPage />} />
                <Route path="*" element={<SpatialCanvasPage />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </ToastProvider>
      </BaseStyles>
    </ThemeProvider>
  );
}

function App(): React.ReactElement {
  return (
    <ThemeContextProvider>
      <InstanceBrandingProvider>
        <CapabilitiesProvider>
          <AuthProvider>
            <FeatureFlagProvider>
              <ModelingPreferencesProvider>
                <RouterShell />
              </ModelingPreferencesProvider>
            </FeatureFlagProvider>
          </AuthProvider>
        </CapabilitiesProvider>
      </InstanceBrandingProvider>
    </ThemeContextProvider>
  );
}

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
`;
}

const VIRTUAL_LANGUAGE_UI_ID = "virtual:modelscript-language-ui";
const VIRTUAL_LANGUAGE_UI_RESOLVED = `\0${VIRTUAL_LANGUAGE_UI_ID}`;

function createVirtualHarnessPlugin(): Plugin {
  const runtimeWasmPath = path.resolve(REPO_ROOT, "packages/runtime/build/release.wasm");
  const lspWorkerPath = path.resolve(REPO_ROOT, "packages/lsp/dist/browser/browserServerMain.js");
  const entrySource = buildVirtualEntrySource();

  const spaRoutes = new Set(["/", "/canvas", "/editor", "/editor", "/embed/editor"]);

  return {
    name: "vr-rotunda-e2e-virtual-harness",
    enforce: "pre",
    resolveId(id) {
      if (id === VIRTUAL_ENTRY_URL || id === VIRTUAL_ENTRY_RESOLVED) {
        return VIRTUAL_ENTRY_RESOLVED;
      }
      if (id === VIRTUAL_LANGUAGE_UI_ID || id === VIRTUAL_LANGUAGE_UI_RESOLVED) {
        return VIRTUAL_LANGUAGE_UI_RESOLVED;
      }
      return null;
    },
    load(id) {
      if (id === VIRTUAL_ENTRY_RESOLVED) {
        return entrySource;
      }
      if (id === VIRTUAL_LANGUAGE_UI_RESOLVED) {
        return `
export const LANGUAGE_PANEL_META = [];
export const ANSATZ_PANEL_LOADERS = {};
export const ARTIFACT_PANEL_LOADERS = {};
export const LANGUAGE_STENCILS = {};
export const LANGUAGE_SIMULATION_CARDS = [];
export const LANGUAGE_TOOLBAR_BUTTONS = {};
`;
      }
      return null;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const reqPath = (req.url ?? "").split("?")[0] ?? "";

        if (reqPath === "/lsp/server/dist/release.wasm" && fs.existsSync(runtimeWasmPath)) {
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/wasm");
          fs.createReadStream(runtimeWasmPath).pipe(res);
          return;
        }
        if (reqPath === "/lsp/server/dist/browserServerMain.js" && fs.existsSync(lspWorkerPath)) {
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/javascript; charset=utf-8");
          fs.createReadStream(lspWorkerPath).pipe(res);
          return;
        }
        if (reqPath === "/lsp/server/dist/languages-manifest.json") {
          const manifest = [
            { id: "modelica", extensions: [".mo"], wasm: "modelica.wasm" },
            { id: "scad", extensions: [".scad"], wasm: "scad.wasm" },
            { id: "step", extensions: [".step", ".stp"], wasm: "step.wasm" },
          ];
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify(manifest));
          return;
        }
        const staticWasmAssets: Record<string, string> = {
          "/lsp/server/dist/occt-import-js.wasm": path.resolve(
            REPO_ROOT,
            "node_modules/occt-import-js/dist/occt-import-js.wasm",
          ),
          "/lsp/server/dist/sql-wasm-browser.wasm": path.resolve(
            REPO_ROOT,
            "node_modules/sql.js/dist/sql-wasm-browser.wasm",
          ),
          "/lsp/wasm/sundials.wasm": path.resolve(REPO_ROOT, "packages/simulate/src/wasm/sundials.wasm"),
          "/wasm/sundials.wasm": path.resolve(REPO_ROOT, "packages/simulate/src/wasm/sundials.wasm"),
        };
        const mappedWasm = staticWasmAssets[reqPath];
        if (mappedWasm && fs.existsSync(mappedWasm)) {
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/wasm");
          fs.createReadStream(mappedWasm).pipe(res);
          return;
        }
        if (reqPath.startsWith("/lsp/server/dist/") && reqPath.endsWith(".wasm")) {
          const lang = reqPath.slice("/lsp/server/dist/".length, -".wasm".length);
          if (/^[a-z0-9-]+$/i.test(lang)) {
            const distWasm = path.resolve(REPO_ROOT, "languages", lang, "dist/parser.wasm");
            const rootWasm = path.resolve(REPO_ROOT, "languages", lang, "parser.wasm");
            const found = fs.existsSync(distWasm) ? distWasm : fs.existsSync(rootWasm) ? rootWasm : null;
            if (found) {
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/wasm");
              fs.createReadStream(found).pipe(res);
              return;
            }
          }
          res.statusCode = 404;
          res.end("WASM asset not found");
          return;
        }

        const isSpaRoute = spaRoutes.has(reqPath) || reqPath.startsWith("/canvas/");
        if (req.method === "GET" && isSpaRoute) {
          const rawHtml = `<!DOCTYPE html>
<html lang="en" data-theme="dark" data-color-mode="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ModelScript VR Rotunda E2E</title>
    <style>
      html, body, #root {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #0a0f1c;
        color: #f8fafc;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="${VIRTUAL_ENTRY_URL}"></script>
  </body>
</html>`;
          void server
            .transformIndexHtml(req.url ?? "/canvas", rawHtml)
            .then((html) => {
              res.statusCode = 200;
              res.setHeader("Content-Type", "text/html; charset=utf-8");
              res.end(html);
            })
            .catch((err) => {
              next(err);
            });
          return;
        }

        next();
      });
    },
  };
}

interface WebGlInspection {
  webglCanvasCount: number;
  width: number;
  height: number;
  rectWidth: number;
  rectHeight: number;
  contextType: "webgl2" | "webgl" | "none";
  contextLost: boolean;
  renderer: string;
}

interface TrackedPageSession {
  page: Page;
  pageErrors: string[];
  consoleErrors: string[];
  fatalWebGlErrors: string[];
}

function isFatalWebGlConsoleError(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("webgl") ||
    lower.includes("context lost") ||
    lower.includes("contextlost") ||
    lower.includes("gl_invalid") ||
    lower.includes("shader") ||
    lower.includes("error creating webgl") ||
    lower.includes("three.webglrenderer") ||
    lower.includes("uncaught")
  );
}

async function installWebGlContextTracker(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    interface TrackedWebGlEntry {
      contextType: "webgl2" | "webgl";
      gl: WebGLRenderingContext | WebGL2RenderingContext;
    }
    const tracked = new Map<HTMLCanvasElement, TrackedWebGlEntry>();
    (window as unknown as { __e2eWebGlContexts?: Map<HTMLCanvasElement, TrackedWebGlEntry> }).__e2eWebGlContexts =
      tracked;

    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, contextId: string, options?: unknown) {
      const ctx = origGetContext.call(this, contextId as "2d", options as CanvasRenderingContext2DSettings | undefined);
      if (ctx && (contextId === "webgl2" || contextId === "webgl" || contextId === "experimental-webgl")) {
        tracked.set(this, {
          contextType: contextId === "webgl2" ? "webgl2" : "webgl",
          gl: ctx as unknown as WebGLRenderingContext | WebGL2RenderingContext,
        });
      }
      return ctx;
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
}

async function waitForLiveWebGlCanvas(page: Page, containerSelector: string, timeout = 20_000): Promise<void> {
  await page.waitForFunction(
    (selector) => {
      const root = document.querySelector(selector);
      if (!root) return false;
      const tracked = (
        window as unknown as {
          __e2eWebGlContexts?: Map<
            HTMLCanvasElement,
            { contextType: "webgl2" | "webgl"; gl: WebGLRenderingContext | WebGL2RenderingContext }
          >;
        }
      ).__e2eWebGlContexts;
      if (!tracked) return false;
      return Array.from(root.querySelectorAll("canvas")).some((c) => {
        const entry = tracked.get(c);
        const rect = c.getBoundingClientRect();
        return Boolean(
          entry && !entry.gl.isContextLost() && c.width > 0 && c.height > 0 && rect.width > 0 && rect.height > 0,
        );
      });
    },
    containerSelector,
    { timeout },
  );
}

async function inspectWebGlCanvas(page: Page, containerSelector: string): Promise<WebGlInspection> {
  return page.evaluate((selector) => {
    const root = document.querySelector(selector);
    const tracked = (
      window as unknown as {
        __e2eWebGlContexts?: Map<
          HTMLCanvasElement,
          { contextType: "webgl2" | "webgl"; gl: WebGLRenderingContext | WebGL2RenderingContext }
        >;
      }
    ).__e2eWebGlContexts;

    if (!root || !tracked) {
      return {
        webglCanvasCount: 0,
        width: 0,
        height: 0,
        rectWidth: 0,
        rectHeight: 0,
        contextType: "none" as const,
        contextLost: true,
        renderer: "",
      };
    }

    const canvases = Array.from(root.querySelectorAll("canvas"));
    let webglCanvasCount = 0;
    let firstWidth = 0;
    let firstHeight = 0;
    let firstRectWidth = 0;
    let firstRectHeight = 0;
    let firstType: "webgl2" | "webgl" | "none" = "none";
    let firstLost = true;
    let firstRenderer = "";

    for (const canvas of canvases) {
      const entry = tracked.get(canvas);
      if (!entry) continue;

      webglCanvasCount += 1;
      if (webglCanvasCount === 1) {
        const rect = canvas.getBoundingClientRect();
        firstWidth = canvas.width;
        firstHeight = canvas.height;
        firstRectWidth = rect.width;
        firstRectHeight = rect.height;
        firstType = entry.contextType;
        firstLost = entry.gl.isContextLost();
        const rawRenderer = entry.gl.getParameter(entry.gl.RENDERER);
        firstRenderer = typeof rawRenderer === "string" ? rawRenderer : String(rawRenderer ?? "");
      }
    }

    return {
      webglCanvasCount,
      width: firstWidth,
      height: firstHeight,
      rectWidth: firstRectWidth,
      rectHeight: firstRectHeight,
      contextType: firstType,
      contextLost: firstLost,
      renderer: firstRenderer,
    };
  }, containerSelector);
}

async function setupCleanApiRoutes(page: Page): Promise<void> {
  await page.route("**/api/v1/**", async (route) => {
    const url = route.request().url();
    let payload: unknown = { ok: true };
    if (url.includes("/api/v1/diagram")) {
      payload = { nodes: [], edges: [] };
    } else if (url.includes("/api/v1/flags")) {
      payload = { flags: {} };
    } else if (url.includes("/api/v1/instance/capabilities")) {
      payload = { ok: true, capabilities: {} };
    } else if (url.includes("/api/v1/auth/me")) {
      payload = { user: null };
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  });

  await page.routeWebSocket("**/api/v1/canvas/**", (ws) => {
    ws.onMessage(() => {
      // Absorb multiplayer CRDT frames locally without requiring a backend server
    });
  });
}

async function openTrackedPage(context: BrowserContext): Promise<TrackedPageSession> {
  const page = await context.newPage();
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const fatalWebGlErrors: string[] = [];

  page.on("pageerror", (err) => {
    const stackLines = (err.stack || "").split("\n").slice(0, 3).join(" | ");
    pageErrors.push(stackLines || err.message || String(err));
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      consoleErrors.push(text);
      if (isFatalWebGlConsoleError(text)) {
        fatalWebGlErrors.push(text);
      }
    }
  });

  await setupCleanApiRoutes(page);
  return { page, pageErrors, consoleErrors, fatalWebGlErrors };
}

function assertHealthyWebGl(info: WebGlInspection, contextLabel: string): void {
  assert.ok(
    info.webglCanvasCount >= 1,
    `${contextLabel}: expected at least 1 active WebGL canvas, found ${info.webglCanvasCount}`,
  );
  assert.ok(
    info.width > 0 && info.height > 0,
    `${contextLabel}: expected non-zero WebGL backing buffer, got ${info.width}x${info.height}`,
  );
  assert.ok(
    info.rectWidth > 0 && info.rectHeight > 0,
    `${contextLabel}: expected non-zero WebGL canvas bounding box, got ${info.rectWidth}x${info.rectHeight}`,
  );
  assert.equal(info.contextLost, false, `${contextLabel}: WebGL context must not be lost`);
  assert.ok(
    info.contextType === "webgl2" || info.contextType === "webgl",
    `${contextLabel}: expected webgl/webgl2 context, got ${info.contextType}`,
  );
}

function createCustomVrHandoffBoard(): CanvasDocument {
  const base = createCanonicalPolyglotDemoBoard();
  return {
    ...base,
    id: "vr-handoff-turbopump-01",
    name: "Cryogenic Turbopump — Ω VR Handoff",
    tiles: {
      tile_turbopump_cad: {
        id: "tile_turbopump_cad",
        title: "LOX Turbopump Impeller 3D",
        archetype: "cad3d",
        languageId: "step",
        artifactUri: "propulsion/lox_impeller.step",
        bounds: { x: 80, y: 60, width: 520, height: 360 },
        zIndex: 1,
        viewState: {},
        pinnedAnchors: [{ path: "CADPort", label: "Impeller Hub", kind: "parameter", currentValue: "145 mm" }],
      },
      tile_turbopump_ctrl: {
        id: "tile_turbopump_ctrl",
        title: "Propulsion Governor Loop",
        archetype: "schematic",
        languageId: "modelica",
        artifactUri: "propulsion/governor.mo",
        bounds: { x: 660, y: 60, width: 520, height: 360 },
        zIndex: 2,
        viewState: {},
        pinnedAnchors: [
          { path: "rpm_ref", label: "RPM Setpoint", kind: "parameter", unit: "rpm", currentValue: "32000 rpm" },
        ],
      },
    },
    wires: {
      wire_handoff_01: {
        id: "wire_handoff_01",
        kind: "shared-parameter",
        origin: "user-authored",
        source: { tileId: "tile_turbopump_cad", anchorPath: "CADPort" },
        target: { tileId: "tile_turbopump_ctrl", anchorPath: "rpm_ref" },
        status: "synced",
        liveValue: "32000 rpm",
      },
    },
  };
}

describe("Engineering Rotunda VR Mode — Real Headless Chromium WebGL E2E", () => {
  let executablePath: string | null = null;
  let server: ViteDevServer | undefined;
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let baseUrl = "";

  before(async () => {
    executablePath = findChromiumExecutable();
    if (!executablePath) {
      return;
    }

    server = await createServer({
      configFile: false,
      root: WEB_ROOT,
      cacheDir: path.resolve(WEB_ROOT, "node_modules/.vite-vr-rotunda-e2e"),
      logLevel: "error",
      plugins: [createVirtualHarnessPlugin(), react(), tsconfigPaths({ root: WEB_ROOT })],
      define: {
        "process.env": {},
        "process.browser": true,
        "process.versions": {},
        __AVAILABLE_FILE_ICONS__: JSON.stringify({}),
      },
      resolve: {
        alias: buildNodeShimAliases(WEB_ROOT),
        dedupe: ["react", "react-dom", "react-router-dom", "styled-components", "@primer/react", "three"],
      },
      optimizeDeps: {
        entries: [
          "src/pages/SpatialCanvasPage.tsx",
          "src/pages/AnsatzEditorPage.tsx",
          "src/pages/EmbedAnsatzEditorPage.tsx",
        ],
        include: [
          "react",
          "react/jsx-runtime",
          "react/jsx-dev-runtime",
          "react-dom",
          "react-dom/client",
          "react-router-dom",
          "@primer/react",
          "@primer/octicons-react",
          "styled-components",
          "axios",
          "pako",
          "zustand",
          "three",
          "three-stdlib",
          "@react-three/fiber",
          "@react-three/drei",
          "@react-three/xr",
          "occt-import-js",
          "sql.js",
        ],
      },
      server: {
        host: "127.0.0.1",
        port: 0,
        strictPort: false,
        hmr: false,
        watch: null,
      },
    });

    await server.listen();
    const address = server.httpServer?.address();
    assert.ok(
      address && typeof address === "object" && "port" in address,
      "Vite dev server did not bind an ephemeral port",
    );
    baseUrl = `http://127.0.0.1:${address.port}`;

    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--enable-webgl",
        "--ignore-gpu-blocklist",
      ],
    });

    context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    await installWebGlContextTracker(context);
  });

  after(async () => {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await server?.close().catch(() => undefined);
  });

  test("Test 1 — Live Engineering Rotunda WebGL Mount & 5-Environment Switching", async (t) => {
    if (!executablePath || !context) {
      t.skip("No Chromium binary available for Playwright WebGL E2E");
      return;
    }

    const session = await openTrackedPage(context);
    const { page, pageErrors, consoleErrors, fatalWebGlErrors } = session;

    try {
      await page.goto(`${baseUrl}/canvas?mode=spatial-3d&env=dark-lab`, { waitUntil: "domcontentloaded" });

      const surface = page.locator('[data-testid="spatial-vr-surface"][data-rotunda="engineering-rotunda"]');
      await surface.waitFor({ state: "visible", timeout: 25_000 });
      assert.equal(await surface.getAttribute("data-surface-mode"), "spatial-3d");
      assert.equal(await surface.getAttribute("data-rotunda-env"), "dark-lab");

      await waitForLiveWebGlCanvas(page, '[data-testid="spatial-vr-surface"]', 20_000);

      const canvasBox = await surface.locator("canvas").first().boundingBox();
      assert.ok(
        canvasBox && canvasBox.width > 0 && canvasBox.height > 0,
        "Rotunda WebGL canvas must have non-zero box",
      );

      const initialWebGl = await inspectWebGlCanvas(page, '[data-testid="spatial-vr-surface"]');
      assertHealthyWebGl(initialWebGl, "Rotunda initial dark-lab mount");

      for (const envId of ROTUNDA_ENV_IDS) {
        const envBtn = page.locator(`[data-testid="rotunda-env-${envId}"]`);
        await envBtn.waitFor({ state: "visible", timeout: 5_000 });
        await envBtn.click();

        await page.waitForFunction(
          (expectedEnv) => {
            const el = document.querySelector('[data-testid="spatial-vr-surface"]');
            return el?.getAttribute("data-rotunda-env") === expectedEnv;
          },
          envId,
          { timeout: 5_000 },
        );
        assert.equal(
          await surface.getAttribute("data-rotunda-env"),
          envId,
          `Expected data-rotunda-env to switch to '${envId}'`,
        );

        const envWebGl = await inspectWebGlCanvas(page, '[data-testid="spatial-vr-surface"]');
        assertHealthyWebGl(envWebGl, `Environment '${envId}'`);
      }

      assert.deepEqual(pageErrors, [], `Uncaught pageerror exceptions: ${pageErrors.join("; ")}`);
      assert.deepEqual(fatalWebGlErrors, [], `Fatal WebGL console errors: ${fatalWebGlErrors.join("; ")}`);
      assert.deepEqual(consoleErrors, [], `Console errors during Test 1: ${consoleErrors.join("; ")}`);
    } catch (err) {
      const bodySnippet = await page
        .evaluate(() => document.body?.innerHTML?.slice(0, 600) ?? "<no body>")
        .catch(() => "<eval failed>");
      console.error("[vr-rotunda-e2e Test 1 diagnostics]", {
        pageErrors,
        consoleErrors,
        fatalWebGlErrors,
        bodySnippet,
      });
      throw err;
    } finally {
      await page.close().catch(() => undefined);
    }
  });

  test("Test 2 — Orbital 3D Model Carousel, Explode, CAE Overlays, Section Cut, 1:1 Scale & 45° Podium Toggle", async (t) => {
    if (!executablePath || !context) {
      t.skip("No Chromium binary available for Playwright WebGL E2E");
      return;
    }

    const session = await openTrackedPage(context);
    const { page, pageErrors, consoleErrors, fatalWebGlErrors } = session;

    try {
      await page.goto(`${baseUrl}/canvas?mode=spatial-3d&env=dark-lab`, { waitUntil: "domcontentloaded" });

      const surface = page.locator('[data-testid="spatial-vr-surface"][data-rotunda="engineering-rotunda"]');
      await surface.waitFor({ state: "visible", timeout: 25_000 });
      await waitForLiveWebGlCanvas(page, '[data-testid="spatial-vr-surface"]', 20_000);

      const initialModel = await surface.getAttribute("data-active-model");
      assert.ok(initialModel && initialModel.length > 0, "Expected initial data-active-model to be populated");

      // Next 3D model
      await page.locator('button[aria-label="Next 3D model"]').click();
      await page.waitForFunction(
        (prevModel) => {
          const el = document.querySelector('[data-testid="spatial-vr-surface"]');
          const cur = el?.getAttribute("data-active-model");
          return Boolean(cur && cur !== prevModel);
        },
        initialModel,
        { timeout: 5_000 },
      );
      const nextModel = await surface.getAttribute("data-active-model");
      assert.notEqual(nextModel, initialModel, "Next 3D model button must advance data-active-model");

      // Previous 3D model returns to original
      await page.locator('button[aria-label="Previous 3D model"]').click();
      await page.waitForFunction(
        (expectedModel) => {
          const el = document.querySelector('[data-testid="spatial-vr-surface"]');
          return el?.getAttribute("data-active-model") === expectedModel;
        },
        initialModel,
        { timeout: 5_000 },
      );
      assert.equal(
        await surface.getAttribute("data-active-model"),
        initialModel,
        "Previous 3D model button must restore original data-active-model",
      );

      // CAD Explode slider to 75
      const explodeSlider = page.locator('input[aria-label="CAD Explode Factor"]');
      await explodeSlider.waitFor({ state: "visible", timeout: 5_000 });
      await explodeSlider.fill("75");
      assert.equal(await explodeSlider.inputValue(), "75", "CAD Explode Factor slider must update to 75");

      // CAE Overlay cycle: FEA -> CFD -> Thermal -> CAD
      const dock = page.locator('[data-testid="rotunda-control-dock"]');
      await dock.waitFor({ state: "visible", timeout: 5_000 });
      for (const label of ["FEA", "CFD", "Thermal", "CAD"] as const) {
        await dock.getByRole("button", { name: label, exact: true }).click();
      }

      // Section Cut toggle
      await dock.getByRole("button", { name: "Cut", exact: true }).click();

      // Scale mode toggle: Hero -> Tabletop -> 1:1 Scale (data-scale-mode="real-scale")
      assert.equal(await surface.getAttribute("data-scale-mode"), "hero");
      await dock.locator('[data-testid="rotunda-toggle-scale-mode"]').click();
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="spatial-vr-surface"]')?.getAttribute("data-scale-mode") === "tabletop",
        undefined,
        { timeout: 5_000 },
      );
      await dock.locator('[data-testid="rotunda-toggle-scale-mode"]').click();
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="spatial-vr-surface"]')?.getAttribute("data-scale-mode") ===
          "real-scale",
        undefined,
        { timeout: 5_000 },
      );
      assert.equal(await surface.getAttribute("data-scale-mode"), "real-scale");
      await dock.getByRole("button", { name: "1:1 Scale", exact: true }).waitFor({ state: "visible", timeout: 5_000 });

      // Toggle Desk and 3D Menus
      await dock.getByRole("button", { name: "Desk", exact: true }).click();
      await dock.getByRole("button", { name: "3D Menus", exact: true }).click();

      // Verify WebGL context remains healthy after all interactive scene mutations
      const finalWebGl = await inspectWebGlCanvas(page, '[data-testid="spatial-vr-surface"]');
      assertHealthyWebGl(finalWebGl, "Post-interaction Rotunda WebGL canvas");

      assert.deepEqual(pageErrors, [], `Uncaught pageerror exceptions: ${pageErrors.join("; ")}`);
      assert.deepEqual(fatalWebGlErrors, [], `Fatal WebGL console errors: ${fatalWebGlErrors.join("; ")}`);
      assert.deepEqual(consoleErrors, [], `Console errors during Test 2: ${consoleErrors.join("; ")}`);
    } finally {
      await page.close().catch(() => undefined);
    }
  });

  test("Test 3 — VS Code for Web #vrBoard= Handoff Hydration", async (t) => {
    if (!executablePath || !context) {
      t.skip("No Chromium binary available for Playwright WebGL E2E");
      return;
    }

    const session = await openTrackedPage(context);
    const { page, pageErrors, consoleErrors, fatalWebGlErrors } = session;

    try {
      const customBoard = createCustomVrHandoffBoard();
      const boardJson = serializeCanvasDocument(customBoard);
      const encodedBoard = Buffer.from(boardJson, "utf8").toString("base64url");

      await page.goto(`${baseUrl}/canvas?mode=webxr-vr&env=outdoors#vrBoard=${encodedBoard}`, {
        waitUntil: "domcontentloaded",
      });

      const surface = page.locator('[data-testid="spatial-vr-surface"][data-rotunda="engineering-rotunda"]');
      await surface.waitFor({ state: "visible", timeout: 25_000 });
      await waitForLiveWebGlCanvas(page, '[data-testid="spatial-vr-surface"]', 20_000);

      assert.equal(
        await surface.getAttribute("data-surface-mode"),
        "webxr-vr",
        "Expected #vrBoard handoff to mount with data-surface-mode='webxr-vr'",
      );
      assert.equal(
        await surface.getAttribute("data-rotunda-env"),
        "outdoors",
        "Expected #vrBoard handoff to mount with data-rotunda-env='outdoors'",
      );
      assert.equal(
        await surface.getAttribute("data-active-model"),
        "tile-model-tile_turbopump_cad",
        "Expected custom #vrBoard CAD tile model to be active on the plinth",
      );

      const carouselText = await page.locator('[data-testid="rotunda-carousel-bar"]').innerText();
      assert.ok(
        carouselText.includes("LOX Turbopump Impeller 3D"),
        `Expected carousel pill to show custom model title, got '${carouselText}'`,
      );

      const headerText = await page.locator("header").innerText();
      assert.ok(
        headerText.includes("Cryogenic Turbopump — Ω VR Handoff"),
        `Expected header to display UTF-8 custom board title, got '${headerText}'`,
      );
      assert.ok(
        headerText.includes("VR Handoff · Local Mode"),
        `Expected header badge to indicate VR Handoff mode, got '${headerText}'`,
      );

      const webgl = await inspectWebGlCanvas(page, '[data-testid="spatial-vr-surface"]');
      assertHealthyWebGl(webgl, "VS Code #vrBoard handoff WebGL canvas");

      assert.deepEqual(pageErrors, [], `Uncaught pageerror exceptions: ${pageErrors.join("; ")}`);
      assert.deepEqual(fatalWebGlErrors, [], `Fatal WebGL console errors: ${fatalWebGlErrors.join("; ")}`);
      assert.deepEqual(consoleErrors, [], `Console errors during Test 3: ${consoleErrors.join("; ")}`);
    } finally {
      await page.close().catch(() => undefined);
    }
  });

  test("Test 4 — Ansatz Web Editor VR Rotunda Launch & Return to 2D", { timeout: 90_000 }, async (t) => {
    if (!executablePath || !context) {
      t.skip("No Chromium binary available for Playwright WebGL E2E");
      return;
    }

    const session = await openTrackedPage(context);
    const { page, pageErrors, fatalWebGlErrors } = session;

    try {
      // 4A. Full Ansatz / Editor route with SCAD 3D template — topbar VR button + 1:1 view sync
      await page.goto(`${baseUrl}/editor?template=scad-flanged-hub`, { waitUntil: "domcontentloaded" });

      const editorVrTrigger = page.locator('[data-testid="ansatz-vr-rotunda-toggle"]').first();
      await editorVrTrigger.waitFor({ state: "visible", timeout: 25_000 });
      await editorVrTrigger.click();

      const editorRotunda = page.locator('[data-testid="spatial-vr-surface"][data-rotunda="engineering-rotunda"]');
      await editorRotunda.waitFor({ state: "visible", timeout: 20_000 });
      await waitForLiveWebGlCanvas(page, '[data-testid="spatial-vr-surface"]', 20_000);

      const editorWebGl = await inspectWebGlCanvas(page, '[data-testid="spatial-vr-surface"]');
      assertHealthyWebGl(editorWebGl, "AnsatzEditorPage VR Rotunda WebGL canvas");

      const fullBleedMetrics = await page.evaluate(() => {
        const pane = document.querySelector<HTMLElement>('[data-testid="ansatz-vr-rotunda-pane"]');
        const header = document.querySelector<HTMLElement>("header");
        const dock = document.querySelector<HTMLElement>('[data-testid="rotunda-control-dock"]');
        const paneRect = pane?.getBoundingClientRect();
        const headerRect = header?.getBoundingClientRect();
        const dockRect = dock?.getBoundingClientRect();
        return {
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          paneRect: paneRect
            ? {
                x: Math.round(paneRect.x),
                y: Math.round(paneRect.y),
                width: Math.round(paneRect.width),
                height: Math.round(paneRect.height),
              }
            : null,
          paneZ: pane ? Number(getComputedStyle(pane).zIndex || 0) : 0,
          headerZ: header ? Number(getComputedStyle(header).zIndex || 0) : 0,
          headerBottom: headerRect ? Math.round(headerRect.bottom) : 0,
          dockTop: dockRect ? Math.round(dockRect.top) : 0,
        };
      });
      assert.ok(fullBleedMetrics.paneRect, "Expected ansatz-vr-rotunda-pane bounding rect");
      assert.equal(fullBleedMetrics.paneRect.x, 0, "VR Rotunda pane must start at x=0");
      assert.equal(fullBleedMetrics.paneRect.y, 0, "VR Rotunda pane must stretch behind floating topbar from y=0");
      assert.equal(
        fullBleedMetrics.paneRect.width,
        fullBleedMetrics.innerWidth,
        "VR Rotunda pane must fill 100% browser viewport width with zero scrollbar gutter",
      );
      assert.equal(
        fullBleedMetrics.paneRect.height,
        fullBleedMetrics.innerHeight,
        "VR Rotunda pane must fill 100% browser viewport height",
      );
      assert.ok(
        fullBleedMetrics.headerZ > fullBleedMetrics.paneZ,
        `Floating Ansatz navbar z-index (${fullBleedMetrics.headerZ}) must sit above VR Rotunda pane (${fullBleedMetrics.paneZ})`,
      );
      assert.ok(
        fullBleedMetrics.dockTop >= fullBleedMetrics.headerBottom,
        `VR Rotunda control dock (${fullBleedMetrics.dockTop}px) must clear floating Ansatz navbar bottom (${fullBleedMetrics.headerBottom}px)`,
      );

      const snapDir = process.env.CAPTURE_VISUAL_SCREENSHOTS_DIR;
      const maybeSnap = async (name: string) => {
        if (!snapDir) return;
        await page.waitForTimeout(1100);
        await page.screenshot({ path: path.join(snapDir, name) });
      };

      await maybeSnap("vr_stage_3d.png");

      // Verify 1:1 view switching stays inside VR mode across every available view (Diagram / Simulation / Inspector / Code / 3D)
      await page.getByRole("button", { name: "Diagram" }).first().click();
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="spatial-vr-surface"]')?.getAttribute("data-active-view") === "diagram",
        { timeout: 10_000 },
      );
      await maybeSnap("vr_stage_diagram.png");

      const simBtn = page.getByRole("button", { name: "Simulation" }).first();
      if (await simBtn.isVisible().catch(() => false)) {
        await simBtn.click();
        await page.waitForFunction(
          () =>
            document.querySelector('[data-testid="spatial-vr-surface"]')?.getAttribute("data-active-view") ===
            "simulation",
          { timeout: 10_000 },
        );
        await maybeSnap("vr_stage_simulation.png");
      }

      const inspBtn = page.getByRole("button", { name: "Inspector" }).first();
      if (await inspBtn.isVisible().catch(() => false)) {
        await inspBtn.click();
        await page.waitForFunction(
          () =>
            document.querySelector('[data-testid="spatial-vr-surface"]')?.getAttribute("data-active-view") ===
            "inspector",
          { timeout: 10_000 },
        );
        await maybeSnap("vr_stage_inspector.png");
      }

      await page.getByRole("button", { name: "Code" }).first().click();
      await page.waitForFunction(
        () => document.querySelector('[data-testid="spatial-vr-surface"]')?.getAttribute("data-active-view") === "code",
        { timeout: 10_000 },
      );
      await maybeSnap("vr_stage_code.png");

      // Verify Scroll Top / Bottom and desktop translucent Quick Edit overlay in VR Code view
      const scrollBottomBtn = page.locator('[data-testid="rotunda-code-scroll-bottom"]');
      await scrollBottomBtn.waitFor({ state: "visible", timeout: 5_000 });
      await scrollBottomBtn.click();
      await page.locator('[data-testid="rotunda-code-scroll-top"]').click();

      const quickEditBtn = page.locator('[data-testid="rotunda-quick-edit-code"]');
      await quickEditBtn.waitFor({ state: "visible", timeout: 5_000 });
      await quickEditBtn.click();
      const quickEditOverlay = page.locator('[data-testid="vr-quick-edit-overlay"]');
      await quickEditOverlay.waitFor({ state: "visible", timeout: 5_000 });
      await maybeSnap("vr_stage_code_quick_edit.png");

      // First Escape closes Quick Edit while keeping VR Mode active
      await page.keyboard.press("Escape");
      await quickEditOverlay.waitFor({ state: "hidden", timeout: 5_000 });
      assert.equal(await editorRotunda.isVisible(), true, "Escape from Quick Edit must keep VR Mode open");

      // Switch back to 3D and verify orthogonal Split (||) companion code wing inside VR
      await page.getByRole("button", { name: /^3D$/ }).first().click();
      await page.waitForFunction(
        () => document.querySelector('[data-testid="spatial-vr-surface"]')?.getAttribute("data-active-view") === "3d",
        { timeout: 10_000 },
      );
      const splitBtn = page.locator('header button[aria-label^="Split view"]').first();
      if (await splitBtn.isVisible().catch(() => false)) {
        const alreadySplit = (await splitBtn.getAttribute("aria-pressed")) === "true";
        if (!alreadySplit) {
          await splitBtn.click();
        }
        await page.waitForFunction(
          () =>
            document.querySelector('[data-testid="spatial-vr-surface"]')?.getAttribute("data-split-code") === "open",
          { timeout: 10_000 },
        );
        await maybeSnap("vr_stage_3d_split_code.png");
      }

      // Second Escape (with Quick Edit closed) exits VR cleanly back to flat desktop view
      await page.keyboard.press("Escape");
      await editorRotunda.waitFor({ state: "detached", timeout: 10_000 });

      // 4B. Ansatz embedded editor floating toolbar toggle (`ansatz-vr-rotunda-toggle`)
      await page.goto(`${baseUrl}/embed/editor?lang=modelica`, { waitUntil: "domcontentloaded" });

      const ansatzToggle = page.locator('[data-testid="ansatz-vr-rotunda-toggle"]');
      await ansatzToggle.waitFor({ state: "visible", timeout: 25_000 });
      await ansatzToggle.click();

      const ansatzRotunda = page.locator('[data-testid="spatial-vr-surface"][data-rotunda="engineering-rotunda"]');
      await ansatzRotunda.waitFor({ state: "visible", timeout: 20_000 });
      await waitForLiveWebGlCanvas(page, '[data-testid="spatial-vr-surface"]', 20_000);

      const ansatzWebGl = await inspectWebGlCanvas(page, '[data-testid="spatial-vr-surface"]');
      assertHealthyWebGl(ansatzWebGl, "AnsatzVisualizerPane VR Rotunda WebGL canvas");

      await page.getByRole("button", { name: "Return to 2D Canvas" }).click();
      await ansatzRotunda.waitFor({ state: "detached", timeout: 10_000 });

      assert.deepEqual(pageErrors, [], `Uncaught pageerror exceptions in Editor VR launch: ${pageErrors.join("; ")}`);
      assert.deepEqual(
        fatalWebGlErrors,
        [],
        `Fatal WebGL console errors in Editor VR launch: ${fatalWebGlErrors.join("; ")}`,
      );
    } finally {
      await page.close().catch(() => undefined);
    }
  });

  test("Test 5 — Zero-Flicker Mouse Move Stability (STEP CadViewer & VR Rotunda)", { timeout: 90_000 }, async (t) => {
    if (!executablePath || !context) {
      t.skip("No Chromium binary available for Playwright WebGL E2E");
      return;
    }

    const session = await openTrackedPage(context);
    const { page, pageErrors, fatalWebGlErrors } = session;

    try {
      await page.addInitScript(`(() => {
        window.__E2E_HIDE_COUNT = 0;
        window.__E2E_SHADER_COMPILES = 0;
        const origSetProp = CSSStyleDeclaration.prototype.setProperty;
        CSSStyleDeclaration.prototype.setProperty = function (name, value, priority) {
          if (name === "display" && value === "none" && priority === "important") {
            window.__E2E_HIDE_COUNT++;
          }
          return origSetProp.call(this, name, value, priority);
        };
        const origGetCtx = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, attrs) {
          const ctx = origGetCtx.call(this, type, attrs);
          if (ctx && (type === "webgl2" || type === "webgl") && !ctx.__e2ePatchedCompile) {
            ctx.__e2ePatchedCompile = true;
            const origCompile = ctx.compileShader.bind(ctx);
            ctx.compileShader = function (shader) {
              window.__E2E_SHADER_COMPILES++;
              if (Array.isArray(window.__E2E_SHADER_LOGS) && window.__E2E_SHADER_LOGS.length < 4) {
                const src = String(ctx.getShaderSource(shader) || "");
                const header = src
                  .split(String.fromCharCode(10))
                  .filter((l) => l.includes("#define") || l.includes("SHADER_NAME") || l.includes("uniform"))
                  .slice(0, 10)
                  .join(" | ");
                window.__E2E_SHADER_LOGS.push(header || src.slice(0, 180));
              }
              return origCompile(shader);
            };
          }
          return ctx;
        };
      })()`);

      // 5A. STEP Aerospace Bracket in CadViewer (data: GLB asset under React.StrictMode)
      await page.goto(`${baseUrl}/editor?template=step-aerospace-bracket`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForTimeout(3000);
      const tab3d = page.getByRole("button", { name: /^3D/ }).first();
      if (await tab3d.isVisible().catch(() => false)) {
        await tab3d.click().catch(() => undefined);
      }
      await page.locator("canvas[data-engine]:not([data-shared-webgl-canvas])").first().waitFor({
        state: "visible",
        timeout: 20_000,
      });
      await page.locator('[data-testid="cad-command-island"]').first().waitFor({ state: "visible", timeout: 20_000 });
      // Wait for async GLTFLoader decode & initial STEP bracket render to appear on screen
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const probe = await page.screenshot({ clip: { x: 80, y: 120, width: 640, height: 500 } });
        if (probe.byteLength > 50_000) {
          break;
        }
        await page.waitForTimeout(200);
      }
      await page.waitForTimeout(300);

      await page.evaluate("window.__E2E_HIDE_COUNT = 0; window.__E2E_SHADER_COMPILES = 0;");
      const cadSizes: number[] = [];
      for (let i = 0; i < 8; i++) {
        await page.mouse.move(180 + (i % 4) * 140, 220 + Math.floor(i / 4) * 180);
        await page.waitForTimeout(50);
        const png = await page.screenshot({ clip: { x: 80, y: 120, width: 640, height: 500 } });
        cadSizes.push(png.byteLength);
      }
      const cadStats = (await page.evaluate(
        "({ hides: window.__E2E_HIDE_COUNT, compiles: window.__E2E_SHADER_COMPILES })",
      )) as { hides: number; compiles: number };
      assert.equal(cadStats.hides, 0, `Expected 0 Suspense hideInstance flickers in CadViewer, got ${cadStats.hides}`);
      assert.equal(
        cadStats.compiles,
        0,
        `Expected 0 shader compiles during CadViewer mouse move, got ${cadStats.compiles}`,
      );
      const minCad = Math.min(...cadSizes);
      const maxCad = Math.max(...cadSizes);
      assert.ok(
        minCad > 10_000 && minCad >= maxCad * 0.5,
        `Expected stable non-blank frames in CadViewer, got PNG byte sizes ${JSON.stringify(cadSizes)}`,
      );

      // 5B. Miro Spatial Canvas VR Rotunda (/canvas?mode=spatial-3d)
      await page.goto(`${baseUrl}/canvas?mode=spatial-3d`, { waitUntil: "domcontentloaded" });
      const surface = page.locator('[data-testid="spatial-vr-surface"][data-rotunda="engineering-rotunda"]');
      await surface.waitFor({ state: "visible", timeout: 25_000 });
      await waitForLiveWebGlCanvas(page, '[data-testid="spatial-vr-surface"]', 20_000);
      // Wait for initial async WebGL/PMREM shader warm-up to settle before measuring mouse-move stability
      {
        let lastCompiles = -1;
        let quietSince = Date.now();
        const settleDeadline = Date.now() + 5_000;
        while (Date.now() < settleDeadline) {
          const currentCompiles = (await page.evaluate("window.__E2E_SHADER_COMPILES")) as number;
          if (currentCompiles !== lastCompiles) {
            lastCompiles = currentCompiles;
            quietSince = Date.now();
          } else if (Date.now() - quietSince >= 800) {
            break;
          }
          await page.waitForTimeout(150);
        }
      }

      await page.evaluate(
        "window.__E2E_HIDE_COUNT = 0; window.__E2E_SHADER_COMPILES = 0; window.__E2E_SHADER_LOGS = [];",
      );
      const vrSizes: number[] = [];
      for (let i = 0; i < 8; i++) {
        await page.mouse.move(220 + (i % 4) * 220, 220 + Math.floor(i / 4) * 220);
        await page.waitForTimeout(50);
        const png = await page.screenshot({ clip: { x: 100, y: 120, width: 800, height: 540 } });
        vrSizes.push(png.byteLength);
      }
      const vrStats = (await page.evaluate(
        "({ hides: window.__E2E_HIDE_COUNT, compiles: window.__E2E_SHADER_COMPILES, logs: window.__E2E_SHADER_LOGS })",
      )) as { hides: number; compiles: number; logs: string[] };
      assert.equal(vrStats.hides, 0, `Expected 0 Suspense hideInstance flickers in VR Rotunda, got ${vrStats.hides}`);
      assert.equal(
        vrStats.compiles,
        0,
        `Expected 0 shader compiles during VR Rotunda mouse move, got ${vrStats.compiles} (${JSON.stringify(vrStats.logs)})`,
      );
      const minVr = Math.min(...vrSizes);
      const maxVr = Math.max(...vrSizes);
      assert.ok(
        minVr > 10_000 && minVr >= maxVr * 0.5,
        `Expected stable non-blank frames in VR Rotunda, got PNG byte sizes ${JSON.stringify(vrSizes)}`,
      );

      const appPageErrors = pageErrors.filter((e) => !e.includes("browserServerMain.js"));
      assert.deepEqual(appPageErrors, [], `Uncaught pageerror exceptions in Test 5: ${appPageErrors.join("; ")}`);
      assert.deepEqual(fatalWebGlErrors, [], `Fatal WebGL console errors in Test 5: ${fatalWebGlErrors.join("; ")}`);
    } finally {
      await page.close().catch(() => undefined);
    }
  });

  test("Test 6 — Pelagos OC-8 Robotic Octopus Showcase, Field Telemetry HUD, Operation Log Scrubber & Studio Toggles", async (t) => {
    if (!executablePath || !context) {
      t.skip("No Chromium binary available for Playwright WebGL E2E");
      return;
    }

    const session = await openTrackedPage(context);
    const { page, pageErrors, consoleErrors, fatalWebGlErrors } = session;

    try {
      await page.goto(`${baseUrl}/canvas?mode=spatial-3d&env=dark-lab`, { waitUntil: "domcontentloaded" });

      const surface = page.locator('[data-testid="spatial-vr-surface"][data-rotunda="engineering-rotunda"]');
      await surface.waitFor({ state: "visible", timeout: 25_000 });
      await waitForLiveWebGlCanvas(page, '[data-testid="spatial-vr-surface"]', 20_000);

      // Select the Pelagos OC-8 Subsea Robotic Octopus scenario preset
      const scenarioSelect = page.locator('[data-testid="rotunda-scenario-select"]');
      await scenarioSelect.waitFor({ state: "visible", timeout: 10_000 });
      await scenarioSelect.selectOption("subsea-octopus");

      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="spatial-vr-surface"]')?.getAttribute("data-active-scenario") ===
          "subsea-octopus",
        undefined,
        { timeout: 10_000 },
      );

      // Field Telemetry HUD + bottom Operation Log scrubber should auto-enable for subsea-octopus
      const telemetryHud = page.locator('[data-testid="simulator-telemetry-hud"]');
      await telemetryHud.waitFor({ state: "visible", timeout: 10_000 });
      const opLogBar = page.locator('[data-testid="hud-operation-log-bar"]');
      await opLogBar.waitFor({ state: "visible", timeout: 10_000 });
      assert.ok(
        (await telemetryHud.innerText()).toUpperCase().includes("PELAGOS OC-8"),
        "Expected Pelagos OC-8 header inside auto-enabled Field Telemetry HUD",
      );

      // Open the expandable Operator Actions drawer and seek to Arm 3 Detach + Jet Assist phases
      await page.locator('[data-testid="hud-op-log-drawer-btn"]').click();
      await page.locator('[data-testid="hud-op-log-drawer"]').waitFor({ state: "visible", timeout: 5_000 });
      await page.locator('[data-testid="hud-op-phase-detach"]').click();
      await page.waitForFunction(
        () => (document.querySelector('[data-testid="hud-op-log-active-phase"]')?.textContent ?? "").includes("ARM 3"),
        undefined,
        { timeout: 5_000 },
      );
      await page.locator('[data-testid="hud-op-phase-jet-assist"]').click();
      await page.waitForFunction(
        () => (document.querySelector('[data-testid="hud-op-log-active-phase"]')?.textContent ?? "").includes("JET"),
        undefined,
        { timeout: 5_000 },
      );

      // Toggle Ghost Shell, Labels, Turntable, and desktop-only AO pass
      await page.locator('[data-testid="rotunda-toggle-ghost"]').click();
      await page.locator('[data-testid="rotunda-toggle-labels"]').click();
      await page.locator('[data-testid="rotunda-toggle-turntable"]').click();
      await page.locator('[data-testid="rotunda-toggle-ao"]').click();
      await page.waitForTimeout(350);

      // Verify Assembly Inspector subsystem isolation works live
      const inspector = page.locator('[data-testid="assembly-inspector-panel"]');
      await inspector.waitFor({ state: "visible", timeout: 5_000 });
      await inspector.getByRole("button", { name: /^PUMP/i }).first().click();
      await page.waitForTimeout(150);
      await inspector
        .getByRole("button", { name: /^HERO$/i })
        .first()
        .click();

      // Disable AO again and verify WebGL canvas stays completely healthy with zero errors
      await page.locator('[data-testid="rotunda-toggle-ao"]').click();
      const webgl = await inspectWebGlCanvas(page, '[data-testid="spatial-vr-surface"]');
      assertHealthyWebGl(webgl, "Pelagos OC-8 Showcase WebGL canvas");

      assert.deepEqual(pageErrors, [], `Uncaught pageerror exceptions in Test 6: ${pageErrors.join("; ")}`);
      assert.deepEqual(fatalWebGlErrors, [], `Fatal WebGL console errors in Test 6: ${fatalWebGlErrors.join("; ")}`);
      assert.deepEqual(consoleErrors, [], `Console errors during Test 6: ${consoleErrors.join("; ")}`);
    } finally {
      await page.close().catch(() => undefined);
    }
  });

  test("Test 7 — 3D Volumetric Diagram Editor (Auto-Extruded 2D SVG Icons, Snap Layers, Wafer Toggle & Floating Library Panel)", async (t) => {
    if (!executablePath || !context) {
      t.skip("No Chromium binary available for Playwright WebGL E2E");
      return;
    }

    const session = await openTrackedPage(context);
    const { page, pageErrors, consoleErrors, fatalWebGlErrors } = session;

    try {
      await page.goto(`${baseUrl}/canvas?mode=spatial-3d&env=office`, { waitUntil: "domcontentloaded" });

      const surface = page.locator('[data-testid="spatial-vr-surface"][data-rotunda="engineering-rotunda"]');
      await surface.waitFor({ state: "visible", timeout: 25_000 });
      await waitForLiveWebGlCanvas(page, '[data-testid="spatial-vr-surface"]', 20_000);

      // Activate full 3D Volumetric Diagram Editor
      const toggle3D = page.locator('[data-testid="rotunda-toggle-diagram-3d"]');
      await toggle3D.waitFor({ state: "visible", timeout: 10_000 });
      await toggle3D.click();

      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="spatial-vr-surface"]')?.getAttribute("data-diagram-editor") === "open",
        undefined,
        { timeout: 10_000 },
      );

      const studioBar = page.locator('[data-testid="rotunda-diagram-studio-bar"]');
      await studioBar.waitFor({ state: "visible", timeout: 10_000 });

      // Wait for extruded 3D starter components & magnetic wires to mount and report counts
      await page.waitForFunction(
        () =>
          (document.querySelector('[data-testid="rotunda-diagram-studio-bar"]')?.textContent ?? "").includes("parts"),
        undefined,
        { timeout: 10_000 },
      );

      // Cycle snap modes (Free 3D -> Domain Layers -> 5cm Grid -> Flat 2D) & toggle Wafer / Pure 3D SVG extrusion
      const snapBtn = page.locator('[data-testid="rotunda-cycle-snap-mode"]');
      await snapBtn.click();
      await page.waitForTimeout(180);
      await page.locator('[data-testid="rotunda-diagram-autolayer"]').click();
      await page.waitForTimeout(180);
      await page.locator('[data-testid="rotunda-toggle-wafer-style"]').click();
      await page.waitForTimeout(220);
      await page.locator('[data-testid="rotunda-toggle-wafer-style"]').click();
      await page.waitForTimeout(180);

      // Summon the Floating Polished Glass Component Library Navigator & test keyboard rotunda/hierarchy flow
      const libBtn = page.locator('[data-testid="rotunda-toggle-wrist-library"]');
      await libBtn.click();
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="spatial-vr-surface"]')?.getAttribute("data-wrist-palette") === "open",
        undefined,
        { timeout: 5_000 },
      );
      await page.waitForTimeout(250);
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.press("ArrowUp");
      await page.keyboard.press("ArrowDown");
      await page.waitForTimeout(200);

      // Verify Undo works after Auto-Layer and WebGL remains 100% healthy with non-blank rendered pixels
      const undoBtn = page.locator('[data-testid="rotunda-diagram-undo"]');
      await undoBtn.click();
      await page.waitForTimeout(200);

      const webgl = await inspectWebGlCanvas(page, '[data-testid="spatial-vr-surface"]');
      assertHealthyWebGl(webgl, "3D Volumetric Diagram Editor + Floating Library WebGL canvas");

      assert.deepEqual(pageErrors, [], `Uncaught pageerror exceptions in Test 7: ${pageErrors.join("; ")}`);
      assert.deepEqual(fatalWebGlErrors, [], `Fatal WebGL console errors in Test 7: ${fatalWebGlErrors.join("; ")}`);
      assert.deepEqual(consoleErrors, [], `Console errors during Test 7: ${consoleErrors.join("; ")}`);
    } finally {
      await page.close().catch(() => undefined);
    }
  });

  test("Test 8 — 3D CAD Safe-Zone HUD Non-Overlap, Split Code Clearance & Flanged Hub Selection Layout", async (t) => {
    if (!executablePath || !context) {
      t.skip("No Chromium binary available for Playwright WebGL E2E");
      return;
    }

    const session = await openTrackedPage(context);
    const { page, pageErrors, fatalWebGlErrors } = session;

    try {
      await page.goto(`${baseUrl}/editor?template=scad-flanged-hub`, { waitUntil: "domcontentloaded" });

      // Ensure 3D view is active and Split Code Editor is open on the right
      const tab3d = page.getByRole("button", { name: /^3D$/ }).first();
      await tab3d.waitFor({ state: "visible", timeout: 25_000 });
      await tab3d.click();

      const splitBtn = page.locator('header button[aria-label^="Split view"]').first();
      await splitBtn.waitFor({ state: "visible", timeout: 10_000 });
      if ((await splitBtn.getAttribute("aria-pressed")) !== "true") {
        await splitBtn.click();
      }

      const codePane = page.locator('[data-testid="ansatz-code-editor-pane"]').first();
      await codePane.waitFor({ state: "visible", timeout: 15_000 });

      const commandIsland = page.locator('[data-testid="cad-command-island"]').first();
      await commandIsland.waitFor({ state: "visible", timeout: 25_000 });

      await page.locator("canvas[data-engine]:not([data-shared-webgl-canvas])").first().waitFor({
        state: "visible",
        timeout: 20_000,
      });
      await page.waitForTimeout(1200);

      // Open Parts drawer & select the flanged hub part so CadSelectionRibbon mounts above CadCommandIsland
      const partsToggle = page.locator('[data-testid="cad-toggle-inspector-drawer"]').first();
      await partsToggle.waitFor({ state: "visible", timeout: 10_000 });
      await partsToggle.click();

      const drawer = page.locator('[data-testid="cad-inspector-drawer"]').first();
      await drawer.waitFor({ state: "visible", timeout: 10_000 });

      const partBtn = drawer.locator('[data-testid="cad-part-select-btn"]').first();
      await partBtn.waitFor({ state: "visible", timeout: 5_000 });
      await partBtn.click();
      await page.locator('[data-testid="cad-selection-ribbon"]').first().waitFor({ state: "visible", timeout: 5_000 });

      // Verify left-sidebar COMPONENTS panel populates with procedural OpenSCAD CSG Operations Tree
      const cadTree = page.locator('[data-testid="cad-component-tree"]').first();
      await cadTree.waitFor({ state: "visible", timeout: 10_000 });
      const featureRows = cadTree.locator('[data-testid^="cad-feature-row-"]');
      assert.ok((await featureRows.count()) >= 5, "Expected >= 5 hierarchical CSG operation rows in left sidebar");

      // Toggle Hide/Suppress on the last operation (bolt-hole cylinder) and verify Reset button appears
      const suppressBtn = cadTree.locator('[data-testid="cad-feature-suppress-btn"]').last();
      await suppressBtn.click();
      const resetTreeBtn = cadTree.locator('[data-testid="cad-feature-reset-btn"]').first();
      await resetTreeBtn.waitFor({ state: "visible", timeout: 5_000 });
      await resetTreeBtn.click();
      await resetTreeBtn.waitFor({ state: "hidden", timeout: 5_000 });

      const snapDir = process.env.CAPTURE_VISUAL_SCREENSHOTS_DIR;
      if (snapDir) {
        await page.waitForTimeout(450);
        await page.screenshot({ path: path.join(snapDir, "cad_3d_flanged_hub_split_selected.png") });
      }

      // Measure bounding boxes and assert strict zero overlap against Split Code Editor, Topbar, and between 3D HUD elements
      const rects = await page.evaluate(() => {
        const selectors = [
          ["header", "header"],
          ["codePane", '[data-testid="ansatz-code-editor-pane"]'],
          ["safeArea", '[data-testid="cad-viewport-safe-area"]'],
          ["island", '[data-testid="cad-command-island"]'],
          ["ribbon", '[data-testid="cad-selection-ribbon"]'],
          ["drawer", '[data-testid="cad-inspector-drawer"]'],
        ] as const;
        const out: Record<
          string,
          { left: number; top: number; right: number; bottom: number; width: number; height: number } | null
        > = {};
        for (const [key, sel] of selectors) {
          const el = document.querySelector<HTMLElement>(sel);
          if (!el) {
            out[key] = null;
            continue;
          }
          const r = el.getBoundingClientRect();
          out[key] =
            r.width > 0 && r.height > 0
              ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
              : null;
        }
        return out;
      });

      assert.ok(rects.header, "Expected visible Ansatz navbar header");
      assert.ok(rects.codePane, "Expected visible floating Split Code Editor");
      assert.ok(rects.safeArea, "Expected visible cad-viewport-safe-area");
      assert.ok(rects.island, "Expected visible cad-command-island");
      assert.ok(rects.drawer, "Expected visible cad-inspector-drawer");

      assert.ok(
        rects.island.right <= rects.codePane.left + 2,
        `CadCommandIsland right (${Math.round(rects.island.right)}px) must not clip under Split Code Editor left (${Math.round(rects.codePane.left)}px)`,
      );
      assert.ok(
        rects.drawer.top >= rects.header.bottom - 2,
        `CadInspectorDrawer top (${Math.round(rects.drawer.top)}px) must clear topbar bottom (${Math.round(rects.header.bottom)}px)`,
      );
      assert.ok(
        rects.drawer.right <= rects.codePane.left + 2,
        `CadInspectorDrawer right (${Math.round(rects.drawer.right)}px) must not overlap Split Code Editor left (${Math.round(rects.codePane.left)}px)`,
      );

      if (rects.ribbon) {
        assert.ok(
          rects.ribbon.right <= rects.codePane.left + 2,
          `CadSelectionRibbon right (${Math.round(rects.ribbon.right)}px) must not clip under Split Code Editor left (${Math.round(rects.codePane.left)}px)`,
        );
        assert.ok(
          rects.ribbon.bottom <= rects.island.top + 2,
          `CadSelectionRibbon bottom (${Math.round(rects.ribbon.bottom)}px) must stack cleanly above CadCommandIsland top (${Math.round(rects.island.top)}px)`,
        );
        const overlapsDrawer =
          rects.ribbon.left < rects.drawer.right - 2 &&
          rects.ribbon.right > rects.drawer.left + 2 &&
          rects.ribbon.top < rects.drawer.bottom - 2 &&
          rects.ribbon.bottom > rects.drawer.top + 2;
        assert.equal(overlapsDrawer, false, "CadSelectionRibbon must not collide with CadInspectorDrawer");
      }

      // Open Section and Display upward popovers and verify neither clips under Split Code Editor
      await page.locator('[data-testid="cad-toggle-section-popover"]').first().click();
      const sectionPop = page.locator('[data-testid="cad-section-popover"]').first();
      await sectionPop.waitFor({ state: "visible", timeout: 5_000 });
      const sectionBox = await sectionPop.boundingBox();
      assert.ok(
        sectionBox && sectionBox.x + sectionBox.width <= rects.codePane.left + 2,
        "Section popover must clear Split Code Editor",
      );

      await page.locator('[data-testid="cad-toggle-display-popover"]').first().click();
      const displayPop = page.locator('[data-testid="cad-display-popover"]').first();
      await displayPop.waitFor({ state: "visible", timeout: 5_000 });
      const displayBox = await displayPop.boundingBox();
      assert.ok(
        displayBox && displayBox.x + displayBox.width <= rects.codePane.left + 2,
        "Display popover must clear Split Code Editor",
      );

      const appPageErrors = pageErrors.filter((e) => !e.includes("browserServerMain.js"));
      assert.deepEqual(appPageErrors, [], `Uncaught pageerror exceptions in Test 8: ${appPageErrors.join("; ")}`);
      assert.deepEqual(fatalWebGlErrors, [], `Fatal WebGL console errors in Test 8: ${fatalWebGlErrors.join("; ")}`);
    } finally {
      await page.close().catch(() => undefined);
    }
  });
});
