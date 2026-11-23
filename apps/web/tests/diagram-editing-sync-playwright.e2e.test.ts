// SPDX-License-Identifier: AGPL-3.0-or-later

import { buildPscadDiagram, cellsToDiagramData, type DiagramEditAction } from "@modelscript/diagram";
import { parsePscx, planDiagramActions } from "@modelscript/pscad";
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
const VIRTUAL_ENTRY_URL = "/__diagram_sync_e2e_entry.tsx";
const VIRTUAL_ENTRY_RESOLVED = path.join(WEB_ROOT, "__diagram_sync_e2e_entry.tsx");

const CHROMIUM_CANDIDATES = ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"] as const;

const SAMPLE_PSCAD_XML = `<project name="IEEE2800_IBR_Benchmark" version="5.0.1">
  <definitions>
    <definition name="Main">
      <schematic>
        <User classid="UserCmp" id="u1" name="master:source_3" x="126" y="180">
          <paramlist>
            <param name="Name" value="Grid230kV_Thevenin" />
            <param name="Vm" value="230.0 [kV]" />
            <param name="F0" value="60.0 [Hz]" />
          </paramlist>
        </User>
        <User classid="UserCmp" id="u2" name="master:tline" x="252" y="180">
          <paramlist>
            <param name="Name" value="Collector_Line" />
            <param name="Length" value="42.0 [km]" />
          </paramlist>
        </User>
        <User classid="UserCmp" id="u3" name="master:xfmr-3p2w" x="396" y="180">
          <paramlist>
            <param name="Name" value="GSU_Transformer" />
            <param name="Tmva" value="120.0 [MVA]" />
            <param name="Xl" value="0.08 [pu]" />
          </paramlist>
        </User>
        <Wire classid="WireOrthogonal" id="w1" x="162" y="180">
          <vertex x="0" y="0" />
          <vertex x="54" y="0" />
        </Wire>
        <Wire classid="WireOrthogonal" id="w2" x="288" y="180">
          <vertex x="0" y="0" />
          <vertex x="54" y="0" />
        </Wire>
      </schematic>
    </definition>
  </definitions>
</project>`;

function applyTextEdits(
  text: string,
  edits: {
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    newText: string;
  }[],
): string {
  const lines = text.split("\n");
  const off = (p: { line: number; character: number }) =>
    lines.slice(0, p.line).reduce((n, l) => n + l.length + 1, 0) + p.character;
  let out = text;
  for (const e of [...edits].sort((a, b) => off(b.range.start) - off(a.range.start))) {
    out = out.slice(0, off(e.range.start)) + e.newText + out.slice(off(e.range.end));
  }
  return out;
}

function findChromiumExecutable(): string | null {
  for (const candidate of CHROMIUM_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
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
import React, { useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import DiagramEditor from "@modelscript/editor/workbench/Diagram.tsx";
import type { DiagramEditorHandle } from "@modelscript/editor/workbench/Diagram.tsx";
import type { DiagramData } from "@modelscript/diagram";

function Harness(): React.ReactElement {
  const editorRef = useRef<DiagramEditorHandle | null>(null);
  const [data, setData] = useState<DiagramData>({
    className: "Loading",
    nodes: [],
    edges: [],
  });
  const actionsRef = useRef<unknown[]>([]);

  (window as unknown as Record<string, unknown>).__diagramSyncHarness = {
    setDiagramData: (next: DiagramData) => {
      setData(next);
    },
    clearActions: () => {
      actionsRef.current = [];
    },
    getActions: () => actionsRef.current,
    getHandle: () => editorRef.current,
    getDomSummary: () => {
      const nodeEls = Array.from(document.querySelectorAll(".ms-nodes-layer > g[data-cell-id]"));
      const edgeEls = Array.from(document.querySelectorAll(".ms-edges-layer > g[data-cell-id]"));
      const selBoxes = Array.from(document.querySelectorAll(".x6-widget-selection-box[data-cell-id]"));
      const parseTranslate = (tf: string | null): { x: number; y: number } => {
        if (!tf) return { x: 0, y: 0 };
        const m = /translate\\(([-0-9.eE]+)[,\\s]+([-0-9.eE]+)\\)/.exec(tf);
        return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 0, y: 0 };
      };
      const parseEndpoints = (d: string | null): { start: { x: number; y: number }; end: { x: number; y: number } } | null => {
        if (!d) return null;
        const mStart = /^M\\s*([-0-9.eE]+)[,\\s]+([-0-9.eE]+)/.exec(d);
        const allPts = Array.from(d.matchAll(/(?:M|L|Q)\\s*([-0-9.eE]+)[,\\s]+([-0-9.eE]+)/g));
        const last = allPts[allPts.length - 1];
        if (!mStart || !last) return null;
        return {
          start: { x: Number(mStart[1]), y: Number(mStart[2]) },
          end: { x: Number(last[1]), y: Number(last[2]) },
        };
      };
      return {
        nodeCount: nodeEls.length,
        edgeCount: edgeEls.length,
        nodes: nodeEls.map((el) => ({
          id: el.getAttribute("data-cell-id") ?? "",
          pos: parseTranslate(el.getAttribute("transform")),
        })),
        edges: edgeEls.map((el) => {
          const path = el.querySelector('path[data-selector="line"]');
          const d = path?.getAttribute("d") ?? null;
          return {
            id: el.getAttribute("data-cell-id") ?? "",
            d,
            endpoints: parseEndpoints(d),
          };
        }),
        selectedIds: selBoxes.map((el) => el.getAttribute("data-cell-id") ?? ""),
      };
    },
  };

  return (
    <div style={{ width: "1200px", height: "800px", position: "relative" }}>
      <DiagramEditor
        ref={editorRef}
        diagramData={data}
        diagramClassName={data.className ?? "Main"}
        theme="light"
        onAction={(action) => {
          actionsRef.current.push(action);
        }}
      />
    </div>
  );
}

const mount = document.getElementById("root")!;
createRoot(mount).render(<Harness />);
`;
}

const VIRTUAL_LANGUAGE_UI_ID = "virtual:modelscript-language-ui";
const VIRTUAL_LANGUAGE_UI_RESOLVED = `\0${VIRTUAL_LANGUAGE_UI_ID}`;

function createVirtualEntryPlugin(): Plugin {
  return {
    name: "diagram-sync-e2e-virtual-entry",
    enforce: "pre",
    resolveId(id) {
      if (id === VIRTUAL_ENTRY_URL || id === VIRTUAL_ENTRY_RESOLVED) return VIRTUAL_ENTRY_RESOLVED;
      if (id === VIRTUAL_LANGUAGE_UI_ID || id === VIRTUAL_LANGUAGE_UI_RESOLVED) return VIRTUAL_LANGUAGE_UI_RESOLVED;
      return null;
    },
    load(id) {
      if (id === VIRTUAL_ENTRY_RESOLVED) return buildVirtualEntrySource();
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
        const url = req.url?.split("?")[0];
        if (url === "/__diagram-sync-e2e.html") {
          res.statusCode = 200;
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(`<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Diagram Sync E2E</title></head>
  <body style="margin:0;padding:0;background:#ffffff;overflow:hidden;">
    <div id="root"></div>
    <script type="module" src="${VIRTUAL_ENTRY_URL}"></script>
  </body>
</html>`);
          return;
        }
        next();
      });
    },
  };
}

describe("Real Chromium Diagram Editing & Code-Sync E2E", () => {
  test("verifies PSCAD drag + XML writeback + re-render sync, Modelica 20x20 selection/wiring/upright text, and 600+ node scale", async (t) => {
    const executablePath = findChromiumExecutable();
    if (!executablePath) {
      t.skip("No Chromium binary found at /usr/bin/chromium{,-browser}");
      return;
    }

    let viteServer: ViteDevServer | null = null;
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;

    try {
      viteServer = await createServer({
        root: WEB_ROOT,
        cacheDir: path.resolve(WEB_ROOT, "node_modules/.vite-canvas-e2e"),
        configFile: false,
        logLevel: "error",
        define: {
          "process.env": {},
          "process.browser": true,
          "process.versions": {},
          __AVAILABLE_FILE_ICONS__: JSON.stringify({}),
        },
        server: { port: 0, strictPort: false, host: "127.0.0.1", hmr: false, watch: null },
        resolve: {
          alias: [...buildNodeShimAliases(WEB_ROOT), { find: "@", replacement: path.resolve(WEB_ROOT, "src") }],
          dedupe: ["react", "react-dom", "react-router-dom", "styled-components", "@primer/react"],
        },
        plugins: [createVirtualEntryPlugin(), react(), tsconfigPaths({ root: WEB_ROOT })],
      });
      await viteServer.listen();
      const address = viteServer.httpServer?.address();
      if (!address || typeof address === "string") throw new Error("Failed to bind Vite test server");
      const baseUrl = `http://127.0.0.1:${address.port}`;

      browser = await chromium.launch({
        executablePath,
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });
      context = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
      const page: Page = await context.newPage();

      const pageErrors: string[] = [];
      page.on("pageerror", (err) => {
        console.error("[E2E pageerror]", err.message);
        pageErrors.push(err.message);
      });
      page.on("console", (msg) => {
        if (msg.type() === "error") {
          console.error("[E2E console.error]", msg.text());
        }
      });

      await page.goto(`${baseUrl}/__diagram-sync-e2e.html`, { waitUntil: "networkidle" });
      if (pageErrors.length > 0) {
        throw new Error(`Browser pageErrors on load: ${pageErrors.join(" | ")}`);
      }
      await page.waitForFunction(() => Boolean((window as unknown as Record<string, unknown>).__diagramSyncHarness));

      // ── 1. PSCAD Drag -> XML Writeback -> Re-render Sync ──
      let pscadXml = SAMPLE_PSCAD_XML;
      const toPscadDiag = (xml: string) =>
        cellsToDiagramData(buildPscadDiagram(parsePscx(xml)) as never, { className: "Main" });
      const initialPscadDiag = toPscadDiag(pscadXml);
      const collectorNodeId = initialPscadDiag.nodes.find(
        (n) => (n.data as { name?: string } | undefined)?.name === "Collector_Line" || n.id.includes("u2"),
      )?.id;
      assert.ok(
        collectorNodeId,
        `Collector_Line node must exist in ${initialPscadDiag.nodes.map((n) => n.id).join(",")}`,
      );
      await page.evaluate((diag) => {
        const h = (window as unknown as { __diagramSyncHarness: { setDiagramData: (d: unknown) => void } })
          .__diagramSyncHarness;
        h.setDiagramData(diag);
      }, initialPscadDiag);

      await page.waitForSelector(`[data-cell-id="${collectorNodeId}"]`, { timeout: 10000 });
      await page.waitForTimeout(150);

      // Drag Collector_Line UP by 60px on screen
      const u2Box = await page.locator(`[data-cell-id="${collectorNodeId}"]`).boundingBox();
      assert.ok(u2Box, "Collector_Line bounding box must exist");
      const startX = u2Box.x + u2Box.width / 2;
      const startY = u2Box.y + u2Box.height / 2;

      await page.evaluate(() => {
        (
          window as unknown as { __diagramSyncHarness: { clearActions: () => void } }
        ).__diagramSyncHarness.clearActions();
      });
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 18, startY - 60, { steps: 10 });
      await page.mouse.up();

      // Wait for debounced move action (5ms debounce + render)
      await page.waitForFunction(
        () => {
          const actions = (
            window as unknown as { __diagramSyncHarness: { getActions: () => { type: string }[] } }
          ).__diagramSyncHarness.getActions();
          return actions.some((a) => a.type === "move");
        },
        undefined,
        { timeout: 5000 },
      );

      const pscadMoveActions = await page.evaluate(() => {
        return (
          window as unknown as {
            __diagramSyncHarness: {
              getActions: () => DiagramEditAction[];
            };
          }
        ).__diagramSyncHarness.getActions();
      });
      const moveAction = pscadMoveActions.find((a) => a.type === "move") as Extract<
        DiagramEditAction,
        { type: "move" }
      >;
      assert.ok(moveAction, "PSCAD drag must emit move action");
      assert.ok((moveAction.items[0]?.edges?.length ?? 0) >= 2, "Collector_Line move must include connected edges");
      for (const edge of moveAction.items[0]!.edges!) {
        for (const pt of edge.points) {
          assert.ok(pt.y > 0, `PSCAD Y-down wire point must stay positive (got y=${pt.y}), never negated!`);
        }
      }

      // Apply emitted move action to PSCAD XML and re-render from code!
      const planned = planDiagramActions(pscadXml, [moveAction]);
      assert.equal(planned.unresolved.length, 0, "PSCAD planDiagramActions must resolve all moved items");
      pscadXml = applyTextEdits(pscadXml, planned.edits);
      const syncedPscadDiag = toPscadDiag(pscadXml);

      await page.evaluate((diag) => {
        const h = (window as unknown as { __diagramSyncHarness: { setDiagramData: (d: unknown) => void } })
          .__diagramSyncHarness;
        h.setDiagramData(diag);
      }, syncedPscadDiag);
      await page.waitForTimeout(100);

      const afterSync = await page.evaluate(() => {
        return (
          window as unknown as {
            __diagramSyncHarness: {
              getDomSummary: () => {
                nodes: { id: string; pos: { x: number; y: number } }[];
                edges: {
                  id: string;
                  endpoints: { start: { x: number; y: number }; end: { x: number; y: number } } | null;
                }[];
              };
            };
          }
        ).__diagramSyncHarness.getDomSummary();
      });
      const syncedU2 = afterSync.nodes.find((n) => n.id === collectorNodeId);
      assert.ok(
        syncedU2 && syncedU2.pos.y < 170,
        `Collector_Line should reflect upward drag after XML sync (y=${syncedU2?.pos.y})`,
      );
      for (const e of afterSync.edges) {
        assert.ok(e.endpoints, `Edge ${e.id} must have valid SVG path endpoints`);
        assert.ok(
          e.endpoints.start.y > 50 && e.endpoints.end.y > 50,
          `Edge ${e.id} endpoints must remain anchored to components (srcY=${e.endpoints.start.y}, tgtY=${e.endpoints.end.y})`,
        );
      }

      // ── 2. Modelica 20x20 Node Selection, Port Wiring & Rotated Text Uprightness ──
      const makeRotatedTextNode = (id: string, x: number, y: number, angle: number, rotCounter: number) => ({
        id,
        shape: "rect",
        x,
        y,
        width: 20,
        height: 20,
        angle,
        markup: [
          {
            tagName: "svg",
            attrs: { viewBox: "-100 -100 200 200", width: 20, height: 20, style: "overflow: visible" },
            children: [
              {
                tagName: "rect",
                attrs: { x: -80, y: -40, width: 160, height: 80, fill: "#ffffff", stroke: "#0000ff" },
              },
              {
                tagName: "text",
                textContent: id,
                attrs: {
                  x: 0,
                  y: -60,
                  transform: `rotate(${rotCounter} 0 -60)`,
                  "font-size": 40,
                  "text-anchor": "middle",
                  fill: "#000000",
                },
              },
            ],
          },
        ],
        ports: {
          items: [
            { id: "p", args: { x: 0, y: 10 } },
            { id: "n", args: { x: 20, y: 10 } },
          ],
        },
        data: { name: id, className: "Resistor" },
      });

      await page.evaluate(
        (diag) => {
          const h = (
            window as unknown as {
              __diagramSyncHarness: { setDiagramData: (d: unknown) => void; clearActions: () => void };
            }
          ).__diagramSyncHarness;
          h.clearActions();
          h.setDiagramData(diag);
        },
        {
          className: "ModelicaSyncTest",
          coordinateSystem: {
            x: -100,
            y: -100,
            width: 200,
            height: 200,
            extent: [
              [-100, -100],
              [100, 100],
            ],
          },
          nodes: [
            makeRotatedTextNode("R90", -60, 0, -90, 90),
            makeRotatedTextNode("R180", 0, 0, -180, 180),
            makeRotatedTextNode("R270", 60, 0, -270, 270),
          ],
          edges: [],
        },
      );

      await page.waitForSelector('[data-cell-id="R90"]', { timeout: 10000 });
      await page.evaluate(() => {
        (
          window as unknown as {
            __diagramSyncHarness: { getHandle: () => { zoomToFit?: () => void } | null };
          }
        ).__diagramSyncHarness
          .getHandle()
          ?.zoomToFit?.();
      });
      await page.waitForTimeout(100);

      // Verify rotated <text> CTMs are upright (positive diagonal, ~0 off-diagonal)
      const textMatrices = await page.evaluate(() => {
        return ["R90", "R180", "R270"].map((id) => {
          const textEl = document.querySelector(`[data-cell-id="${id}"] text`) as SVGTextElement | null;
          const m = textEl?.getScreenCTM?.();
          return m ? { id, a: m.a, b: m.b, c: m.c, d: m.d } : { id, missing: true };
        });
      });
      for (const m of textMatrices) {
        assert.ok(!("missing" in m), `Text element missing for ${m.id}`);
        assert.ok(m.a > 0 && m.d > 0, `Expected upright text scale (a>0, d>0) for ${m.id}, got a=${m.a}, d=${m.d}`);
        assert.ok(
          Math.abs(m.b) < 1e-2 && Math.abs(m.c) < 1e-2,
          `Expected 0 net rotation for ${m.id}, got b=${m.b}, c=${m.c}`,
        );
      }

      // Click center of 20x20 R90 node body -> must select R90 (not wire!)
      const r90Box = await page.locator('[data-cell-id="R90"] rect').first().boundingBox();
      assert.ok(r90Box, "R90 bounding box must exist");
      const clickX = r90Box.x + r90Box.width / 2;
      const clickY = r90Box.y + r90Box.height / 2;
      await page.mouse.click(clickX, clickY);
      const clickDiag = await page.evaluate(
        ({ cx, cy }) => {
          const hitEl = document.elementFromPoint(cx, cy);
          const h = (
            window as unknown as {
              __diagramSyncHarness: { getDomSummary: () => { selectedIds: string[]; nodeCount: number } };
            }
          ).__diagramSyncHarness;
          return {
            summary: h.getDomSummary(),
            hitTag: hitEl?.tagName ?? null,
            hitClass: hitEl?.getAttribute?.("class") ?? null,
            hitCellId: hitEl?.closest?.("[data-cell-id]")?.getAttribute("data-cell-id") ?? null,
          };
        },
        { cx: clickX, cy: clickY },
      );
      assert.deepEqual(
        clickDiag.summary.selectedIds,
        ["R90"],
        `Clicking 20x20 R90 interior must select R90 (box=${JSON.stringify(r90Box)}, hit=${JSON.stringify(clickDiag)})`,
      );

      // Drag from R90.n port to R180.p port -> must create connected edge and emit connect action
      const portStart = await page.locator('[data-cell-id="R90"] .x6-port[port-id="n"]').boundingBox();
      const portEnd = await page.locator('[data-cell-id="R180"] .x6-port[port-id="p"]').boundingBox();
      assert.ok(portStart && portEnd, "Port bounding boxes must exist");
      await page.mouse.move(portStart.x + portStart.width / 2, portStart.y + portStart.height / 2);
      await page.mouse.down();
      await page.mouse.move(portEnd.x + portEnd.width / 2, portEnd.y + portEnd.height / 2, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(100);

      const afterConnect = await page.evaluate(() => {
        const h = (
          window as unknown as {
            __diagramSyncHarness: {
              getDomSummary: () => { edgeCount: number };
              getActions: () => { type: string }[];
            };
          }
        ).__diagramSyncHarness;
        return { summary: h.getDomSummary(), actions: h.getActions() };
      });
      assert.equal(afterConnect.summary.edgeCount, 1, "Port-to-port drag in Chromium must create 1 edge");
      assert.ok(
        afterConnect.actions.some((a) => a.type === "connect"),
        "Port-to-port drag must emit connect diagram action",
      );

      // ── 3. Scale Verification (600 Nodes + 599 Edges) ──
      const scaleNodes = Array.from({ length: 600 }, (_, i) => ({
        id: `n_${i}`,
        shape: "rect",
        x: (i % 25) * 110,
        y: Math.floor(i / 25) * 90,
        width: 70,
        height: 40,
        ports: {
          items: [
            { id: "in", args: { x: 0, y: 20 } },
            { id: "out", args: { x: 70, y: 20 } },
          ],
        },
        attrs: { body: { fill: "#ffffff", stroke: "#0f172a" }, label: { text: `N${i}` } },
        data: { name: `n_${i}` },
      }));
      const scaleEdges = Array.from({ length: 599 }, (_, i) => ({
        id: `e_${i}`,
        shape: "edge",
        source: { cell: `n_${i}`, port: "out" },
        target: { cell: `n_${i + 1}`, port: "in" },
        attrs: { line: { stroke: "#0284c7", strokeWidth: 1.5 } },
      }));

      await page.evaluate(
        (diag) => {
          (
            window as unknown as { __diagramSyncHarness: { setDiagramData: (d: unknown) => void } }
          ).__diagramSyncHarness.setDiagramData(diag);
        },
        { className: "Scale600", nodes: scaleNodes, edges: scaleEdges },
      );
      await page.waitForTimeout(200);
      const scaleSummary = await page.evaluate(() => {
        return (
          window as unknown as {
            __diagramSyncHarness: { getDomSummary: () => { nodeCount: number; edgeCount: number } };
          }
        ).__diagramSyncHarness.getDomSummary();
      });
      assert.equal(scaleSummary.nodeCount, 600);
      assert.equal(scaleSummary.edgeCount, 599);

      assert.deepEqual(pageErrors, [], `Unexpected page errors: ${pageErrors.join(" | ")}`);
    } finally {
      if (context) await context.close();
      if (browser) await browser.close();
      if (viteServer) await viteServer.close();
    }
  });
});
