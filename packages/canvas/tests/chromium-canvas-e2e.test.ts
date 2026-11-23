// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import test, { describe } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PKG_ROOT = path.resolve(__dirname, "..");

/**
 * Real Headless Chromium (Playwright) Interactive E2E Suite for the Unified Canvas Engine.
 *
 * Verifies real browser mouse interactions, SVG DOM chrome, automatic high-scale
 * Canvas2D rendering, Modelon Impact-style CanvasPlot widget painting, and
 * single-context embedded 3D portal scheduling with zero AntV X6 dependency.
 */
describe("Real Chromium (Playwright) Unified Canvas Interactive E2E", () => {
  test("verifies mouse drag, marquee, rotated resize/rotate, port wiring, orthogonal segments, 2.5k-node Canvas2D auto-switch, and live CanvasPlot widgets in Chromium", async (t) => {
    // Dynamically resolve playwright + esbuild so headless environments without Chromium skip cleanly
    let chromium: { launch: (opts: Record<string, unknown>) => Promise<unknown> };
    let esbuild: {
      build: (opts: Record<string, unknown>) => Promise<{ outputFiles?: { text: string }[] }>;
    };
    try {
      const pw = (await import("playwright")) as unknown as {
        chromium: { launch: (opts: Record<string, unknown>) => Promise<unknown> };
      };
      chromium = pw.chromium;
      esbuild = (await import("esbuild")) as unknown as typeof esbuild;
    } catch {
      t.skip("Playwright or esbuild unavailable in this environment");
      return;
    }

    const executablePath = fs.existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined;
    let browser: {
      newPage: (opts?: Record<string, unknown>) => Promise<unknown>;
      close: () => Promise<void>;
    } | null = null;

    try {
      browser = (await chromium.launch({
        headless: true,
        ...(executablePath ? { executablePath } : {}),
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      })) as typeof browser;
    } catch {
      t.skip("Headless Chromium binary could not be launched in this environment");
      return;
    }

    // Bundle @modelscript/canvas/engine into an in-memory browser ESM script
    const bundled = await esbuild.build({
      entryPoints: [path.join(PKG_ROOT, "src/engine/index.ts")],
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
    });
    const engineJs = bundled.outputFiles?.[0]?.text ?? "";
    assert.ok(engineJs.length > 5000, "Bundled unified canvas engine should be non-empty");

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #0b1120; }
    #canvas { width: 1000px; height: 640px; position: relative; }
  </style>
</head>
<body>
  <div id="canvas"></div>
  <script type="module">
    import { UnifiedGraph, UnifiedSelection, UnifiedTransform } from "/engine.js";

    const container = document.getElementById("canvas");
    const graph = new UnifiedGraph({
      container,
      width: 1000,
      height: 640,
      background: { color: "#0b1120" },
      renderMode: "auto",
      highScaleThreshold: 1500,
    });
    graph.use(new UnifiedSelection({ enabled: true, rubberband: true }));
    graph.use(new UnifiedTransform({ resizing: { enabled: true }, rotating: { enabled: true } }));

    const events = [];
    graph.on("node:moved", ({ node }) => events.push("moved:" + node.id));
    graph.on("edge:connected", ({ edge }) => events.push("connected:" + edge.getSourceCellId() + "->" + edge.getTargetCellId()));
    graph.on("node:resized", ({ node }) => events.push("resized:" + node.id));
    graph.on("node:rotated", ({ node }) => events.push("rotated:" + node.id));

    const motor = graph.addNode({
      id: "motor",
      x: 100,
      y: 120,
      width: 100,
      height: 60,
      attrs: {
        body: { fill: "#1e293b", stroke: "#38bdf8", strokeWidth: 2 },
        label: { text: "Motor", fill: "#f8fafc", fontSize: 12 },
      },
      ports: { items: [{ id: "out", args: { x: 100, y: 30 } }] },
    });

    const gearbox = graph.addNode({
      id: "gearbox",
      x: 360,
      y: 120,
      width: 100,
      height: 60,
      attrs: {
        body: { fill: "#1e293b", stroke: "#10b981", strokeWidth: 2 },
        label: { text: "Gearbox", fill: "#f8fafc", fontSize: 12 },
      },
      ports: { items: [{ id: "in", args: { x: 0, y: 30 } }, { id: "out", args: { x: 100, y: 30 } }] },
    });

    const housing = graph.addNode({
      id: "housing",
      x: 600,
      y: 120,
      width: 160,
      height: 120,
      attrs: {
        body: { fill: "#0f172a", stroke: "#ec4899", strokeWidth: 2 },
        label: { text: "Housing CAD", fill: "#f8fafc", fontSize: 12 },
      },
      ports: { items: [{ id: "flange_a", args: { x: 0, y: 30 } }] },
      data: {
        portal: { kind: "cad", artifactUri: "cad/housing.step", isAnimating: true },
      },
    });

    const e1 = graph.addEdge({
      id: "wire_1",
      source: { cell: "motor", port: "out" },
      target: { cell: "gearbox", port: "in" },
      vertices: [],
      labels: [{ attrs: { text: { text: "tau" } }, position: 0.5 }],
      attrs: {
        line: {
          stroke: "#38bdf8",
          strokeWidth: 2,
          targetMarker: { name: "block", width: 10, height: 8 },
        },
      },
    });
    e1.addTools(["segments", "vertices", "button-remove"]);

    graph.registerCanvasWidget({
      id: "plot_torque",
      kind: "plot",
      bounds: { x: 80, y: 340, width: 320, height: 180 },
      plot: {
        id: "plot_torque",
        title: "Torque (N.m)",
        kind: "timeseries",
        series: [{ id: "tau", label: "tau", color: "#14b8a6", x: [0, 2, 4, 6, 8, 10], y: [0, 3.2, 5.1, 4.4, 4.9, 4.7] }],
        crosshairX: 2.0,
      },
    });

    window.__TEST_API__ = {
      graph,
      events,
      motor,
      gearbox,
      housing,
      e1,
      spawnHighScale(count) {
        const g2 = new UnifiedGraph({
          container,
          width: 1000,
          height: 640,
          background: { color: "#0b1120" },
          renderMode: "auto",
          highScaleThreshold: 1500,
        });
        for (let i = 0; i < count; i++) {
          g2.addNode({
            id: "hs_" + i,
            x: (i % 50) * 60,
            y: Math.floor(i / 50) * 45,
            width: 42,
            height: 26,
          });
        }
        window.__HS_GRAPH__ = g2;
        return {
          mode: g2.getActiveRenderMode(),
          nodeCount: g2.scene.nodeCount,
        };
      },
    };
    window.__READY__ = true;
  </script>
</body>
</html>`;

    const server = http.createServer((req, res) => {
      if (req.url === "/engine.js") {
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        res.end(engineJs);
        return;
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(html);
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      const page = (await browser!.newPage({ viewport: { width: 1024, height: 700 } })) as {
        goto: (url: string) => Promise<void>;
        waitForFunction: (fn: string) => Promise<void>;
        evaluate: <R>(fn: () => R) => Promise<R>;
        mouse: {
          move: (x: number, y: number, opts?: { steps?: number }) => Promise<void>;
          down: () => Promise<void>;
          up: () => Promise<void>;
        };
        keyboard: {
          down: (key: string) => Promise<void>;
          up: (key: string) => Promise<void>;
        };
      };

      await page.goto(`http://127.0.0.1:${port}/`);
      await page.waitForFunction("window.__READY__ === true");

      // 1. Verify initial SVG chrome: markers, edge label, segment handle, remove button, and live widget canvas pixels
      const initialCheck = await page.evaluate(() => {
        const markerEnd = document
          .querySelector('[data-cell-id="wire_1"] path[data-selector="line"]')
          ?.getAttribute("marker-end");
        const labelText = document.querySelector(".x6-edge-label text")?.textContent;
        const segHandles = document.querySelectorAll(".ms-segment-handle").length;
        const removeBtns = document.querySelectorAll(".ms-edge-remove-btn").length;
        const widgetCanvas = document.querySelector(".ms-widgets-canvas") as HTMLCanvasElement | null;
        let widgetNonZeroPixels = 0;
        if (widgetCanvas) {
          const ctx = widgetCanvas.getContext("2d");
          if (ctx) {
            const data = ctx.getImageData(0, 0, widgetCanvas.width, widgetCanvas.height).data;
            for (let i = 3; i < data.length; i += 16) {
              if (data[i]! > 0) widgetNonZeroPixels++;
            }
          }
        }
        const scissor = (
          window as unknown as {
            __TEST_API__: {
              graph: {
                computeEmbedded3DScissorRects: () => unknown[];
                portal3DManager: { sharedWebGlContextCount: number };
              };
            };
          }
        ).__TEST_API__.graph;
        return {
          markerEnd,
          labelText,
          segHandles,
          removeBtns,
          widgetNonZeroPixels,
          scissorCount: scissor.computeEmbedded3DScissorRects().length,
          sharedWebGl: scissor.portal3DManager.sharedWebGlContextCount,
        };
      });

      assert.ok(initialCheck.markerEnd?.startsWith("url(#ms-marker-"), "Edge targetMarker should render");
      assert.equal(initialCheck.labelText, "tau");
      assert.ok(initialCheck.segHandles >= 1, "Segment drag handle should render");
      assert.equal(initialCheck.removeBtns, 1, "Remove edge button should render");
      assert.ok(initialCheck.widgetNonZeroPixels > 50, "Pinned Modelon Impact CanvasPlot should paint real pixels");
      assert.equal(initialCheck.scissorCount, 1);
      assert.equal(initialCheck.sharedWebGl, 1);

      // 2. Real mouse drag of `motor` node from (150, 150) -> (150, 210)
      await page.mouse.move(150, 150);
      await page.mouse.down();
      await page.mouse.move(150, 210, { steps: 6 });
      await page.mouse.up();

      const afterDrag = await page.evaluate(() => {
        const api = (
          window as unknown as {
            __TEST_API__: { motor: { getPosition: () => { x: number; y: number } }; events: string[] };
          }
        ).__TEST_API__;
        return { pos: api.motor.getPosition(), events: [...api.events] };
      });
      assert.ok(afterDrag.pos.y >= 175, `Expected motor y >= 175 after real mouse drag, got ${afterDrag.pos.y}`);
      assert.ok(afterDrag.events.includes("moved:motor"));

      // 3. Real Shift+drag marquee selecting `motor` and `gearbox`
      await page.keyboard.down("Shift");
      await page.mouse.move(40, 40);
      await page.mouse.down();
      await page.mouse.move(500, 280, { steps: 5 });
      const marqueeVisible = await page.evaluate(() => {
        const r = document.querySelector(".ms-marquee-rect") as SVGRectElement | null;
        return r ? Number(r.getAttribute("width")) : 0;
      });
      assert.ok(marqueeVisible > 300, "Marquee SVG rect should visibly track drag");
      await page.mouse.up();
      await page.keyboard.up("Shift");

      const selectionBoxCount = await page.evaluate(() => document.querySelectorAll(".x6-widget-selection-box").length);
      assert.ok(selectionBoxCount >= 2, `Expected >= 2 selection boxes after marquee, got ${selectionBoxCount}`);

      // 3b. Real mouse drag on SE resize handle + rotate handle of `motor`
      const handleCoords = await page.evaluate(() => {
        const box = document.querySelector('.x6-widget-selection-box[data-cell-id="motor"]');
        const se = box?.querySelector(".ms-handle-se")?.getBoundingClientRect();
        const rot = box?.querySelector(".ms-handle-rotate")?.getBoundingClientRect();
        return {
          se: se ? { cx: se.left + se.width / 2, cy: se.top + se.height / 2 } : null,
          rot: rot ? { cx: rot.left + rot.width / 2, cy: rot.top + rot.height / 2 } : null,
        };
      });
      assert.ok(handleCoords.se && handleCoords.rot, "Resize and rotate handles should render with valid bounds");
      await page.mouse.move(handleCoords.se.cx, handleCoords.se.cy);
      await page.mouse.down();
      await page.mouse.move(handleCoords.se.cx + 30, handleCoords.se.cy + 20, { steps: 4 });
      await page.mouse.up();

      const afterResize = await page.evaluate(() => {
        const api = (
          window as unknown as {
            __TEST_API__: { motor: { getSize: () => { width: number; height: number } }; events: string[] };
          }
        ).__TEST_API__;
        return { size: api.motor.getSize(), events: [...api.events] };
      });
      assert.ok(
        afterResize.size.width > 110,
        `Expected motor width > 110 after SE resize, got ${afterResize.size.width}`,
      );
      assert.ok(afterResize.events.includes("resized:motor"));

      const rotBox = await page.evaluate(() => {
        const rot = document
          .querySelector('.x6-widget-selection-box[data-cell-id="motor"] .ms-handle-rotate')
          ?.getBoundingClientRect();
        return rot ? { cx: rot.left + rot.width / 2, cy: rot.top + rot.height / 2 } : null;
      });
      assert.ok(rotBox);
      await page.mouse.move(rotBox.cx, rotBox.cy);
      await page.mouse.down();
      await page.mouse.move(rotBox.cx + 60, rotBox.cy + 40, { steps: 4 });
      await page.mouse.up();

      const afterRotate = await page.evaluate(() => {
        const api = (window as unknown as { __TEST_API__: { motor: { getAngle: () => number }; events: string[] } })
          .__TEST_API__;
        return { angle: api.motor.getAngle(), events: [...api.events] };
      });
      assert.ok(afterRotate.angle > 0, `Expected non-zero angle after rotate handle drag, got ${afterRotate.angle}`);
      assert.ok(afterRotate.events.includes("rotated:motor"));

      // 4. Real mouse drag on port-to-port wire: gearbox.out (460, 150) -> housing.flange_a (600, 150)
      await page.mouse.move(460, 150);
      await page.mouse.down();
      await page.mouse.move(596, 150, { steps: 6 });
      const magnetState = await page.evaluate(() => ({
        available: document.querySelectorAll(".x6-magnet-available").length,
        adsorbed: document.querySelectorAll(".x6-magnet-adsorbed").length,
      }));
      assert.ok(magnetState.adsorbed >= 1, "Target port should adsorb with .x6-magnet-adsorbed class");
      await page.mouse.up();

      const afterConnect = await page.evaluate(() => {
        const api = (window as unknown as { __TEST_API__: { graph: { getEdges: () => unknown[] }; events: string[] } })
          .__TEST_API__;
        return { edgeCount: api.graph.getEdges().length, events: [...api.events] };
      });
      assert.equal(afterConnect.edgeCount, 2);
      assert.ok(afterConnect.events.includes("connected:gearbox->housing"));

      // 5. Real orthogonal segment drag on `wire_1` preserves port anchors (zero port ripping)
      const segBox = await page.evaluate(() => {
        const el = document.querySelector(".ms-segment-handle");
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
      });
      assert.ok(segBox, "Segment handle should have valid screen bbox");
      await page.mouse.move(segBox.cx, segBox.cy);
      await page.mouse.down();
      await page.mouse.move(segBox.cx, segBox.cy + 40, { steps: 5 });
      await page.mouse.up();

      const afterSegDrag = await page.evaluate(() => {
        const e1 = (
          window as unknown as {
            __TEST_API__: {
              e1: {
                getSource: () => { port?: string };
                getTarget: () => { port?: string };
                getVertices: () => unknown[];
              };
            };
          }
        ).__TEST_API__.e1;
        return {
          srcPort: e1.getSource().port,
          tgtPort: e1.getTarget().port,
          vertexCount: e1.getVertices().length,
        };
      });
      assert.equal(afterSegDrag.srcPort, "out");
      assert.equal(afterSegDrag.tgtPort, "in");
      assert.ok(afterSegDrag.vertexCount >= 2, "Segment drag should insert orthogonal vertices");

      // 6. Real Chromium high-scale automatic Canvas2D switch at 2,000 nodes
      const highScaleCheck = await page.evaluate(async () => {
        const api = (
          window as unknown as { __TEST_API__: { spawnHighScale: (n: number) => { mode: string; nodeCount: number } } }
        ).__TEST_API__;
        const info = api.spawnHighScale(2000);
        // Wait 2 animation frames for Canvas2D RAF paint
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const canvases = document.querySelectorAll(".ms-canvas2d-layer");
        const lastCanvas = canvases[canvases.length - 1] as HTMLCanvasElement | undefined;
        let nonZeroPixels = 0;
        if (lastCanvas) {
          const ctx = lastCanvas.getContext("2d");
          if (ctx) {
            const data = ctx.getImageData(0, 0, lastCanvas.width, lastCanvas.height).data;
            for (let i = 3; i < data.length; i += 32) {
              if (data[i]! > 0) nonZeroPixels++;
            }
          }
        }
        return { ...info, nonZeroPixels };
      });
      assert.equal(highScaleCheck.mode, "canvas2d");
      assert.equal(highScaleCheck.nodeCount, 2000);
      assert.ok(highScaleCheck.nonZeroPixels > 50, "High-scale Canvas2D layer should paint real visible pixels");
    } finally {
      await browser?.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
