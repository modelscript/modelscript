// SPDX-License-Identifier: AGPL-3.0-or-later

import react from "@vitejs/plugin-react";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { describe } from "node:test";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createServer, type Alias, type Plugin, type ViteDevServer } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const WEB_ROOT = path.resolve(import.meta.dirname, "..");
const REPO_ROOT = path.resolve(WEB_ROOT, "../..");
const VIRTUAL_ENTRY_URL = "/__canvas_e2e_entry.tsx";
const VIRTUAL_ENTRY_RESOLVED = path.join(WEB_ROOT, "__canvas_e2e_entry.tsx");

const CHROMIUM_CANDIDATES = ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"] as const;

const CANONICAL_TILE_IDS = [
  "tile_simulink",
  "tile_modelica",
  "tile_kicad",
  "tile_step",
  "tile_reqif",
  "tile_montecarlo",
] as const;

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
import React, { Suspense, useMemo, useRef } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import SpatialCanvasPage from "./src/pages/SpatialCanvasPage.tsx";
import type { DiagramEditorHandle } from "@modelscript/editor/workbench/Diagram.tsx";

const LazyDiagramEditor = React.lazy(() => import("@modelscript/editor/workbench/Diagram.tsx"));

function DiagramHarness(): React.ReactElement {
  const editorRef = useRef<DiagramEditorHandle | null>(null);
  const diagramData = useMemo(
    () => ({
      className: "ActuatorSystem",
      coordinateSystem: {
        x: 0,
        y: 0,
        width: 900,
        height: 400,
      },
      nodes: [
        {
          id: "controller",
          shape: "rect",
          x: 60,
          y: 120,
          width: 150,
          height: 76,
          angle: 0,
          opacity: 1,
          zIndex: 2,
          markup: [
            {
              tagName: "rect",
              selector: "body",
              attrs: {
                x: 0,
                y: 0,
                width: 150,
                height: 76,
                rx: 8,
                ry: 8,
                fill: "#132038",
                stroke: "#38bdf8",
                "stroke-width": 2,
              },
            },
            {
              tagName: "text",
              selector: "label",
              attrs: {
                x: 75,
                y: 42,
                "text-anchor": "middle",
                fill: "#f8fafc",
                "font-size": 12,
                "font-weight": "600",
                "font-family": "sans-serif",
              },
              textContent: "PIDController",
            },
          ],
          ports: {
            items: [{ id: "u_out", group: "out", args: { x: 150, y: 38 } }],
            groups: { out: { position: "absolute", zIndex: 3 } },
          },
          properties: { name: "controller", className: "PIDController" },
        },
        {
          id: "plant",
          shape: "rect",
          x: 310,
          y: 120,
          width: 160,
          height: 76,
          angle: 0,
          opacity: 1,
          zIndex: 2,
          markup: [
            {
              tagName: "rect",
              selector: "body",
              attrs: {
                x: 0,
                y: 0,
                width: 160,
                height: 76,
                rx: 8,
                ry: 8,
                fill: "#132038",
                stroke: "#10b981",
                "stroke-width": 2,
              },
            },
            {
              tagName: "text",
              selector: "label",
              attrs: {
                x: 80,
                y: 42,
                "text-anchor": "middle",
                fill: "#f8fafc",
                "font-size": 12,
                "font-weight": "600",
                "font-family": "sans-serif",
              },
              textContent: "ActuatorPlant",
            },
          ],
          ports: {
            items: [{ id: "u_in", group: "in", args: { x: 0, y: 38 } }],
            groups: { in: { position: "absolute", zIndex: 3 } },
          },
          properties: { name: "plant", className: "ActuatorPlant" },
        },
        {
          id: "portal_housing",
          shape: "rect",
          x: 560,
          y: 80,
          width: 240,
          height: 170,
          angle: 0,
          opacity: 1,
          zIndex: 2,
          markup: [
            {
              tagName: "rect",
              selector: "body",
              attrs: {
                x: 0,
                y: 0,
                width: 240,
                height: 170,
                rx: 8,
                ry: 8,
                fill: "#0f172a",
                stroke: "#ec4899",
                "stroke-width": 2,
              },
            },
          ],
          ports: { items: [], groups: {} },
          portal: {
            kind: "cad",
            artifactUri: "cad/actuator_housing.step",
            animateWithSimulation: true,
          },
          properties: { name: "Housing CAD", className: "STEPAssembly" },
        },
      ],
      edges: [
        {
          id: "e_cmd",
          source: {
            cell: "controller",
            port: "u_out",
            anchor: "center",
            connectionPoint: { name: "boundary" },
          },
          target: {
            cell: "plant",
            port: "u_in",
            anchor: "center",
            connectionPoint: { name: "boundary" },
          },
          zIndex: 1,
          attrs: {
            line: {
              stroke: "#38bdf8",
              strokeWidth: 2,
              "vector-effect": "non-scaling-stroke",
              "pointer-events": "stroke",
            },
          },
        },
      ],
    }),
    [],
  );

  return (
    <div data-testid="diagram-e2e-host" style={{ width: "100vw", height: "100vh", background: "#0b1120" }}>
      <Suspense fallback={null}>
        <LazyDiagramEditor ref={editorRef} diagramData={diagramData} diagramClassName="ActuatorSystem" theme="vs-dark" />
      </Suspense>
    </div>
  );
}

function App(): React.ReactElement {
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");
  if (view === "diagram") {
    return <DiagramHarness />;
  }
  return (
    <MemoryRouter initialEntries={["/canvas"]}>
      <SpatialCanvasPage />
    </MemoryRouter>
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
  const entrySource = buildVirtualEntrySource();

  return {
    name: "canvas-fullstack-e2e-virtual-harness",
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

        if (reqPath === "/__canvas_e2e.html") {
          const rawHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ModelScript Canvas Fullstack E2E</title>
    <style>
      html, body, #root {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #0b1120;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="${VIRTUAL_ENTRY_URL}"></script>
  </body>
</html>`;
          void server
            .transformIndexHtml(req.url ?? "/__canvas_e2e.html", rawHtml)
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

        if (reqPath === "/lsp/server/dist/release.wasm" && fs.existsSync(runtimeWasmPath)) {
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/wasm");
          fs.createReadStream(runtimeWasmPath).pipe(res);
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
  contextType: "webgl2" | "webgl" | "none";
  contextLost: boolean;
  renderer: string;
}

interface Canvas2DPixelInspection {
  width: number;
  height: number;
  dataUrlLength: number;
  nonTransparentPixels: number;
  nonBackgroundPixels: number;
  distinctColors: number;
  checksum: number;
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

async function waitForLiveWebGlCanvas(page: Page, containerSelector: string, timeout = 15_000): Promise<void> {
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
        return Boolean(entry && !entry.gl.isContextLost() && c.width > 0 && c.height > 0);
      });
    },
    containerSelector,
    { timeout },
  );
}

async function inspectWebGlCanvases(page: Page, containerSelector: string): Promise<WebGlInspection> {
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
        contextType: "none" as const,
        contextLost: true,
        renderer: "",
      };
    }

    const canvases = Array.from(root.querySelectorAll("canvas"));
    let webglCanvasCount = 0;
    let firstWidth = 0;
    let firstHeight = 0;
    let firstType: "webgl2" | "webgl" | "none" = "none";
    let firstLost = true;
    let firstRenderer = "";

    for (const canvas of canvases) {
      const entry = tracked.get(canvas);
      if (!entry) continue;

      webglCanvasCount += 1;
      if (webglCanvasCount === 1) {
        firstWidth = canvas.width;
        firstHeight = canvas.height;
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
      contextType: firstType,
      contextLost: firstLost,
      renderer: firstRenderer,
    };
  }, containerSelector);
}

async function inspectCanvas2DPixels(
  page: Page,
  canvasSelector: string,
  backgroundRgb: readonly [number, number, number] = [9, 15, 29],
): Promise<Canvas2DPixelInspection> {
  return page.evaluate(
    ({ selector, bg }) => {
      const canvas = document.querySelector(selector) as HTMLCanvasElement | null;
      if (!canvas) {
        return {
          width: 0,
          height: 0,
          dataUrlLength: 0,
          nonTransparentPixels: 0,
          nonBackgroundPixels: 0,
          distinctColors: 0,
          checksum: 0,
        };
      }
      const ctx = canvas.getContext("2d");
      if (!ctx || canvas.width === 0 || canvas.height === 0) {
        return {
          width: canvas.width,
          height: canvas.height,
          dataUrlLength: 0,
          nonTransparentPixels: 0,
          nonBackgroundPixels: 0,
          distinctColors: 0,
          checksum: 0,
        };
      }

      const dataUrlLength = canvas.toDataURL("image/png").length;
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      let nonTransparentPixels = 0;
      let nonBackgroundPixels = 0;
      let checksum = 0;
      const colors = new Set<number>();

      // Stride by 2 pixels horizontally/vertically for fast deterministic verification
      for (let i = 0; i < data.length; i += 8) {
        const r = data[i] ?? 0;
        const g = data[i + 1] ?? 0;
        const b = data[i + 2] ?? 0;
        const a = data[i + 3] ?? 0;
        if (a > 0) {
          nonTransparentPixels += 1;
          const colorKey = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
          colors.add(colorKey);
          const diff = Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]);
          if (diff > 18) {
            nonBackgroundPixels += 1;
          }
          checksum = (checksum * 31 + r + g * 3 + b * 7 + a) >>> 0;
        }
      }

      return {
        width: canvas.width,
        height: canvas.height,
        dataUrlLength,
        nonTransparentPixels,
        nonBackgroundPixels,
        distinctColors: colors.size,
        checksum,
      };
    },
    { selector: canvasSelector, bg: backgroundRgb },
  );
}

async function setupCleanApiRoutes(page: Page): Promise<void> {
  await page.route("**/api/v1/**", async (route) => {
    const url = route.request().url();
    const payload = url.includes("/api/v1/diagram") ? { nodes: [], edges: [] } : { ok: true };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  });

  await page.routeWebSocket("**/api/v1/canvas/**", (ws) => {
    ws.onMessage(() => {
      // Absorb multiplayer join/delta frames locally without needing a backend server
    });
  });
}

describe("Full-Stack Real Chromium + Vite + SwiftShader WebGL Canvas E2E", () => {
  test("verifies SpatialCanvasPage (WebGL scissor host, 6 tiles, live Canvas2D schematic & plot, timeline, 3D Spatial roundtrip) and Editor Diagram in real Chromium", async (t) => {
    const executablePath = findChromiumExecutable();
    if (!executablePath) {
      t.skip("No Chromium binary found at /usr/bin/chromium, /usr/bin/chromium-browser, or /usr/bin/google-chrome");
      return;
    }

    let server: ViteDevServer | undefined;
    let browser: Browser | undefined;
    let context: BrowserContext | undefined;
    let page: Page | undefined;
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    const diagramPageErrors: string[] = [];
    const diagramConsoleErrors: string[] = [];
    const failedRequests: string[] = [];

    try {
      server = await createServer({
        configFile: false,
        root: WEB_ROOT,
        cacheDir: path.resolve(WEB_ROOT, "node_modules/.vite-canvas-e2e"),
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
          entries: ["src/pages/SpatialCanvasPage.tsx"],
          include: [
            "react",
            "react/jsx-runtime",
            "react/jsx-dev-runtime",
            "react-dom",
            "react-dom/client",
            "react-router-dom",
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
        "Vite server did not bind an ephemeral port",
      );
      const baseUrl = `http://127.0.0.1:${address.port}`;

      browser = await chromium.launch({
        executablePath,
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--use-gl=angle",
          "--use-angle=swiftshader",
          "--enable-unsafe-swiftshader",
        ],
      });

      context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      });
      await installWebGlContextTracker(context);

      // ── Part 1: Full-Stack SpatialCanvasPage E2E ──────────────────────────
      page = await context.newPage();
      page.on("pageerror", (err) => {
        pageErrors.push(err.message || String(err));
      });
      page.on("console", (msg) => {
        if (msg.type() === "error") {
          consoleErrors.push(msg.text());
        }
      });
      page.on("requestfailed", (req) => {
        failedRequests.push(`${req.url()} (${req.failure()?.errorText ?? "failed"})`);
      });

      await setupCleanApiRoutes(page);
      await page.goto(`${baseUrl}/__canvas_e2e.html`, { waitUntil: "domcontentloaded" });

      // 1. Shared single-context 3D host + live WebGL context
      const hostLocator = page.locator('[data-testid="shared-scissor-3d-host"][data-webgl-contexts="1"]');
      await hostLocator.waitFor({ state: "visible", timeout: 25_000 });
      await waitForLiveWebGlCanvas(page, '[data-testid="shared-scissor-3d-host"]', 20_000);

      const initialWebGl = await inspectWebGlCanvases(page, '[data-testid="shared-scissor-3d-host"]');
      assert.equal(initialWebGl.webglCanvasCount, 1, "SharedScissor3DHost must mount exactly 1 WebGL context");
      assert.ok(
        initialWebGl.width > 0 && initialWebGl.height > 0,
        `Expected non-zero WebGL canvas dimensions, got ${initialWebGl.width}x${initialWebGl.height}`,
      );
      assert.ok(
        initialWebGl.contextType === "webgl2" || initialWebGl.contextType === "webgl",
        "Expected active WebGL/WebGL2 context",
      );
      assert.equal(initialWebGl.contextLost, false, "WebGL context must not be lost");
      assert.ok(initialWebGl.renderer.length > 0, "WebGL RENDERER parameter should be populated under SwiftShader");

      // 2. All 6 canonical polyglot board tiles render in the DOM
      for (const tileId of CANONICAL_TILE_IDS) {
        const tileLocator = page.locator(`[data-tile-id="${tileId}"]`);
        await tileLocator.waitFor({ state: "visible", timeout: 10_000 });
      }
      const renderedTileCount = await page.locator("[data-tile-id]").count();
      assert.equal(renderedTileCount, 6, `Expected all 6 canonical polyglot tiles, found ${renderedTileCount}`);

      // Click the STEP 3D CAD tile to activate its live Scissor3DViewport on the single shared WebGL context
      await page.locator('[data-tile-id="tile_step"]').click();
      await page.locator('[data-testid="scissor-3d-viewport"][data-3d-kind="step"]').waitFor({
        state: "visible",
        timeout: 10_000,
      });
      const postStepWebGl = await inspectWebGlCanvases(page, '[data-testid="shared-scissor-3d-host"]');
      assert.equal(
        postStepWebGl.webglCanvasCount,
        1,
        "Activating a 3D CAD Scissor3DViewport must still share exactly 1 WebGL context",
      );
      assert.equal(postStepWebGl.contextLost, false);

      // 3. Live UnifiedGraph Canvas2D schematic tile renders non-empty painted pixels
      const schematicSelector = '[data-testid="live-unified-schematic-tile_modelica"]';
      await page.locator(schematicSelector).waitFor({ state: "visible", timeout: 10_000 });
      const schematicPixels = await inspectCanvas2DPixels(page, schematicSelector);
      assert.ok(
        schematicPixels.width > 0 && schematicPixels.height > 0,
        "Schematic Canvas2D dimensions must be non-zero",
      );
      assert.ok(
        schematicPixels.dataUrlLength > 200,
        `Expected painted schematic PNG > 200 bytes, got ${schematicPixels.dataUrlLength}`,
      );
      assert.ok(schematicPixels.nonTransparentPixels > 1000, "Schematic Canvas2D must contain opaque painted pixels");
      assert.ok(
        schematicPixels.nonBackgroundPixels > 200,
        "Schematic Canvas2D must draw blocks/wires/text over the backdrop",
      );
      assert.ok(
        schematicPixels.distinctColors > 4,
        `Expected multi-color schematic rendering, got ${schematicPixels.distinctColors} colors`,
      );

      // 4. Live CanvasPlot analytics tile renders non-empty waveform pixels
      const plotSelector = '[data-testid="live-canvas-plot-tile_montecarlo"]';
      await page.locator(plotSelector).waitFor({ state: "visible", timeout: 10_000 });
      const plotPixelsBefore = await inspectCanvas2DPixels(page, plotSelector, [15, 23, 42]);
      assert.ok(
        plotPixelsBefore.width > 0 && plotPixelsBefore.height > 0,
        "Analytics plot Canvas2D dimensions must be non-zero",
      );
      assert.ok(
        plotPixelsBefore.dataUrlLength > 200,
        `Expected painted plot PNG > 200 bytes, got ${plotPixelsBefore.dataUrlLength}`,
      );
      assert.ok(plotPixelsBefore.nonTransparentPixels > 1000, "Analytics plot Canvas2D must contain painted pixels");
      assert.ok(
        plotPixelsBefore.nonBackgroundPixels > 200,
        "Analytics plot Canvas2D must render axes/waveform/threshold pixels",
      );
      assert.ok(
        plotPixelsBefore.distinctColors > 4,
        `Expected multi-color waveform plot, got ${plotPixelsBefore.distinctColors} colors`,
      );

      // 5. Timeline scrubber updates readout and repaints live plot crosshair without crashing
      const timelineBar = page.locator('[data-testid="canvas-simulation-timeline"]');
      await timelineBar.waitFor({ state: "visible", timeout: 10_000 });
      const initialTimelineText = await timelineBar.innerText();
      assert.ok(
        initialTimelineText.includes("t = 0.00s"),
        `Expected initial readout 't = 0.00s', got '${initialTimelineText}'`,
      );

      const scrubber = timelineBar.locator('input[type="range"][aria-label="Simulation timeline scrubber"]');
      await scrubber.fill("4.25");
      await page.waitForFunction(
        () => {
          const el = document.querySelector('[data-testid="canvas-simulation-timeline"]');
          return Boolean(el && el.textContent && el.textContent.includes("t = 4.25s"));
        },
        { timeout: 5_000 },
      );

      const updatedTimelineText = await timelineBar.innerText();
      assert.ok(
        updatedTimelineText.includes("t = 4.25s"),
        `Expected updated readout 't = 4.25s', got '${updatedTimelineText}'`,
      );
      const plotPixelsAfter = await inspectCanvas2DPixels(page, plotSelector, [15, 23, 42]);
      assert.ok(plotPixelsAfter.nonBackgroundPixels > 200, "Analytics plot must remain painted after timeline scrub");
      assert.notEqual(
        plotPixelsAfter.checksum,
        plotPixelsBefore.checksum,
        "Analytics plot Canvas2D pixels should update when simulation time crosshair advances",
      );

      // 6. Switch surface mode: Desktop 2D -> 3D Spatial -> Return to 2D Canvas
      await page.getByRole("button", { name: "2D Surface" }).click();
      const vrSurface = page.locator('[data-testid="spatial-vr-surface"][data-surface-mode="spatial-3d"]');
      await vrSurface.waitFor({ state: "visible", timeout: 15_000 });
      await hostLocator.waitFor({ state: "detached", timeout: 10_000 });
      await waitForLiveWebGlCanvas(page, '[data-testid="spatial-vr-surface"]', 15_000);

      const spatialWebGl = await inspectWebGlCanvases(page, '[data-testid="spatial-vr-surface"]');
      assert.equal(spatialWebGl.webglCanvasCount, 1, "SpatialVrSurface must mount an active Three.js WebGL canvas");
      assert.ok(
        spatialWebGl.width > 0 && spatialWebGl.height > 0,
        "SpatialVrSurface WebGL canvas must have non-zero size",
      );
      assert.equal(spatialWebGl.contextLost, false, "SpatialVrSurface WebGL context must not be lost");

      await page.getByRole("button", { name: "Return to 2D Canvas" }).click();
      await vrSurface.waitFor({ state: "detached", timeout: 10_000 });
      await hostLocator.waitFor({ state: "visible", timeout: 15_000 });
      await waitForLiveWebGlCanvas(page, '[data-testid="shared-scissor-3d-host"]', 15_000);

      const restoredWebGl = await inspectWebGlCanvases(page, '[data-testid="shared-scissor-3d-host"]');
      assert.equal(
        restoredWebGl.webglCanvasCount,
        1,
        "Restored Desktop 2D mode must have exactly 1 shared WebGL context",
      );
      assert.equal(restoredWebGl.contextLost, false, "Restored WebGL context must remain healthy");
      assert.equal(await page.locator("[data-tile-id]").count(), 6, "All 6 canonical tiles must restore cleanly");

      assert.deepEqual(
        pageErrors,
        [],
        `Unexpected uncaught pageerror exceptions in SpatialCanvasPage: ${pageErrors.join("; ")}`,
      );
      assert.deepEqual(
        consoleErrors,
        [],
        `Unexpected console.error messages in SpatialCanvasPage: ${consoleErrors.join("; ")}`,
      );

      // ── Part 2: Full-Stack Real Editor Diagram E2E ────────────────────────
      const diagramPage = await context.newPage();
      diagramPage.on("pageerror", (err) => {
        diagramPageErrors.push(err.message || String(err));
      });
      diagramPage.on("console", (msg) => {
        if (msg.type() === "error") {
          diagramConsoleErrors.push(`[diagram] ${msg.text()}`);
        }
      });

      await setupCleanApiRoutes(diagramPage);
      await diagramPage.goto(`${baseUrl}/__canvas_e2e.html?view=diagram`, { waitUntil: "domcontentloaded" });

      const diagramHost = diagramPage.locator(
        '[data-testid="diagram-e2e-host"] [data-testid="shared-scissor-3d-host"][data-webgl-contexts="1"]',
      );
      await diagramHost.waitFor({ state: "visible", timeout: 20_000 });
      await waitForLiveWebGlCanvas(diagramPage, '[data-testid="diagram-e2e-host"]', 15_000);

      // Embedded 3D portal inside real Editor Diagram mounts on the single shared WebGL context
      await diagramPage.locator('[data-testid="diagram-embedded-portal-portal_housing"]').waitFor({
        state: "visible",
        timeout: 15_000,
      });
      await diagramPage
        .locator('[data-testid="diagram-embedded-portal-portal_housing"] [data-testid="scissor-3d-viewport"]')
        .waitFor({
          state: "visible",
          timeout: 10_000,
        });

      const diagramWebGl = await inspectWebGlCanvases(diagramPage, '[data-testid="diagram-e2e-host"]');
      assert.equal(
        diagramWebGl.webglCanvasCount,
        1,
        "Editor Diagram must maintain exactly 1 shared WebGL context with embedded 3D portal",
      );
      assert.ok(
        diagramWebGl.width > 0 && diagramWebGl.height > 0,
        "Editor Diagram WebGL canvas must have non-zero size",
      );
      assert.equal(diagramWebGl.contextLost, false, "Editor Diagram WebGL context must not be lost");

      // Dispatch real morsel:time-scrub event and verify HUD + Pin Plot interaction
      await diagramPage.evaluate(() => {
        window.dispatchEvent(
          new CustomEvent("morsel:time-scrub", {
            detail: { time: 2.5, values: { "motor.omega": 142.3, "thermal.T_max": 348.2 } },
          }),
        );
      });
      const scrubHud = diagramPage.locator('[data-testid="diagram-time-scrub-hud"]');
      await scrubHud.waitFor({ state: "visible", timeout: 5_000 });
      assert.ok((await scrubHud.innerText()).includes("t = 2.500s"), "Diagram time-scrub HUD must display t = 2.500s");
      await diagramPage.locator('[data-testid="diagram-pin-plot-btn"]').click();

      assert.deepEqual(
        diagramPageErrors,
        [],
        `Unexpected uncaught pageerror exceptions in Editor Diagram: ${diagramPageErrors.join("; ")}`,
      );
      assert.deepEqual(
        diagramConsoleErrors,
        [],
        `Unexpected console.error messages in Editor Diagram: ${diagramConsoleErrors.join("; ")}`,
      );
      await diagramPage.close();
    } catch (err) {
      if (
        pageErrors.length > 0 ||
        diagramPageErrors.length > 0 ||
        consoleErrors.length > 0 ||
        diagramConsoleErrors.length > 0 ||
        failedRequests.length > 0
      ) {
        console.error("[canvas-fullstack-e2e diagnostics]", {
          pageErrors,
          diagramPageErrors,
          consoleErrors,
          diagramConsoleErrors,
          failedRequests,
        });
      }
      throw err;
    } finally {
      await page?.close().catch(() => undefined);
      await context?.close().catch(() => undefined);
      await browser?.close().catch(() => undefined);
      await server?.close().catch(() => undefined);
    }
  });
});
