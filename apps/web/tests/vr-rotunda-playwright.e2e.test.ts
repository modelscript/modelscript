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
const ROTUNDA_ENV_IDS = ["warehouse", "office", "outdoors", "dark-lab", "passthrough"] as const;

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
const PlaygroundPage = React.lazy(() => import("./src/pages/PlaygroundPage.tsx"));
const EmbedPlaygroundPage = React.lazy(() => import("./src/pages/EmbedPlaygroundPage.tsx"));

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
                <Route path="/editor" element={<PlaygroundPage />} />
                <Route path="/playground" element={<PreserveParamsNavigate to="/editor" />} />
                <Route path="/embed/editor" element={<EmbedPlaygroundPage />} />
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
  createRoot(rootEl).render(<App />);
}
`;
}

const VIRTUAL_LANGUAGE_UI_ID = "virtual:modelscript-language-ui";
const VIRTUAL_LANGUAGE_UI_RESOLVED = `\0${VIRTUAL_LANGUAGE_UI_ID}`;

function createVirtualHarnessPlugin(): Plugin {
  const runtimeWasmPath = path.resolve(REPO_ROOT, "packages/runtime/build/release.wasm");
  const lspWorkerPath = path.resolve(REPO_ROOT, "packages/lsp/dist/browserServerMain.js");
  const indexerWorkerPath = path.resolve(REPO_ROOT, "packages/lsp/dist/workers/indexer.worker.js");
  const entrySource = buildVirtualEntrySource();

  const spaRoutes = new Set(["/", "/canvas", "/editor", "/playground", "/embed/editor"]);

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
export const MORSEL_PANEL_LOADERS = {};
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
        if (reqPath === "/lsp/server/dist/workers/indexer.worker.js" && fs.existsSync(indexerWorkerPath)) {
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/javascript; charset=utf-8");
          fs.createReadStream(indexerWorkerPath).pipe(res);
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
    pageErrors.push(err.message || String(err));
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
          "src/pages/PlaygroundPage.tsx",
          "src/pages/EmbedPlaygroundPage.tsx",
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

      // Scale mode toggle: Tabletop -> 1:1 Scale (data-scale-mode="real-scale")
      assert.equal(await surface.getAttribute("data-scale-mode"), "tabletop");
      await dock.getByRole("button", { name: "Tabletop", exact: true }).click();
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="spatial-vr-surface"]')?.getAttribute("data-scale-mode") ===
          "real-scale",
        undefined,
        { timeout: 5_000 },
      );
      assert.equal(await surface.getAttribute("data-scale-mode"), "real-scale");
      await dock.getByRole("button", { name: "1:1 Scale", exact: true }).waitFor({ state: "visible", timeout: 5_000 });

      // Toggle 45° Desk and 3D Menus
      await dock.getByRole("button", { name: "45° Desk", exact: true }).click();
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

  test("Test 4 — Ansatz Web Editor VR Rotunda Launch & Return to 2D", async (t) => {
    if (!executablePath || !context) {
      t.skip("No Chromium binary available for Playwright WebGL E2E");
      return;
    }

    const session = await openTrackedPage(context);
    const { page, pageErrors, fatalWebGlErrors } = session;

    try {
      // 4A. Full Playground / Editor route with SCAD 3D template
      await page.goto(`${baseUrl}/playground?template=scad-flanged-hub`, { waitUntil: "domcontentloaded" });

      const editorVrTrigger = page
        .locator('[data-testid="morsel-vr-rotunda-toggle"], [data-testid="cad-viewer-open-vr-rotunda"]')
        .first();
      await editorVrTrigger.waitFor({ state: "visible", timeout: 25_000 });
      await editorVrTrigger.click();

      const editorRotunda = page.locator('[data-testid="spatial-vr-surface"][data-rotunda="engineering-rotunda"]');
      await editorRotunda.waitFor({ state: "visible", timeout: 20_000 });
      await waitForLiveWebGlCanvas(page, '[data-testid="spatial-vr-surface"]', 20_000);

      const editorWebGl = await inspectWebGlCanvas(page, '[data-testid="spatial-vr-surface"]');
      assertHealthyWebGl(editorWebGl, "PlaygroundPage VR Rotunda WebGL canvas");

      await page.getByRole("button", { name: "Return to 2D Canvas" }).click();
      await editorRotunda.waitFor({ state: "detached", timeout: 10_000 });

      // 4B. Morsel embedded editor floating toolbar toggle (`morsel-vr-rotunda-toggle`)
      await page.goto(`${baseUrl}/embed/editor?lang=modelica`, { waitUntil: "domcontentloaded" });

      const morselToggle = page.locator('[data-testid="morsel-vr-rotunda-toggle"]');
      await morselToggle.waitFor({ state: "visible", timeout: 25_000 });
      await morselToggle.click();

      const morselRotunda = page.locator('[data-testid="spatial-vr-surface"][data-rotunda="engineering-rotunda"]');
      await morselRotunda.waitFor({ state: "visible", timeout: 20_000 });
      await waitForLiveWebGlCanvas(page, '[data-testid="spatial-vr-surface"]', 20_000);

      const morselWebGl = await inspectWebGlCanvas(page, '[data-testid="spatial-vr-surface"]');
      assertHealthyWebGl(morselWebGl, "MorselVisualizerPane VR Rotunda WebGL canvas");

      await page.getByRole("button", { name: "Return to 2D Canvas" }).click();
      await morselRotunda.waitFor({ state: "detached", timeout: 10_000 });

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
});
