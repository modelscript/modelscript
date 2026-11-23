// SPDX-License-Identifier: AGPL-3.0-or-later

import express from "express";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { describe } from "node:test";
import { chromium } from "playwright";
import { canvasRouter } from "../src/routes/canvas.js";
import { attachCanvasWebSocket, CanvasRoomManager } from "../src/services/canvas-collab-service.js";

/**
 * Real Two-Browser Headless Chromium E2E test verifying:
 * 1. Two independent Chromium tabs connect to `/api/v1/canvas/stream`
 * 2. Both tabs render the canonical 6-artifact board SVG + tiles
 * 3. Moving a tile in Tab A broadcasts a CRDT delta and updates Tab B's DOM in real time
 */
describe("Two-Browser Headless Chromium Spatial Canvas E2E", () => {
  test("renders the 6-artifact board and syncs live CRDT moves across two Chromium tabs", async (t) => {
    let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
    try {
      const systemChromium = ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"].find((p) =>
        existsSync(p),
      );
      browser = await chromium.launch({
        headless: true,
        ...(systemChromium ? { executablePath: systemChromium } : {}),
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
    } catch {
      t.skip("Headless Chromium binary unavailable in this environment");
      return;
    }

    const manager = new CanvasRoomManager();
    const app = express();
    app.use(express.json());
    app.use("/api/v1/canvas", canvasRouter(manager));

    // Minimal live multiplayer canvas harness page for real browser verification
    app.get("/e2e-canvas", (_req, res) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(`<!DOCTYPE html>
<html>
<body style="margin:0;background:#0b1120;color:#f8fafc;font-family:sans-serif">
  <div id="status">connecting</div>
  <div id="board"></div>
  <button id="move-btn" type="button">Move Modelica</button>
  <script>
    const params = new URLSearchParams(location.search);
    const peerId = params.get("peer") || "peer_a";
    let tiles = {};
    const ws = new WebSocket("ws://" + location.host + "/api/v1/canvas/stream");
    function render() {
      const el = document.getElementById("board");
      el.innerHTML = Object.values(tiles).map(t =>
        '<div data-tile-id="' + t.id + '" data-x="' + t.bounds.x + '">' + t.title + '</div>'
      ).join("");
    }
    ws.onopen = () => {
      document.getElementById("status").textContent = "connected";
      ws.send(JSON.stringify({
        type: "join",
        boardId: "demo-polyglot-actuator",
        peerId,
        userName: peerId
      }));
    };
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "full_sync" && msg.delta && msg.delta.tiles) {
        for (const [id, reg] of Object.entries(msg.delta.tiles)) {
          if (reg.value) tiles[id] = reg.value;
        }
        render();
      } else if (msg.type === "delta" && msg.delta && msg.delta.tiles) {
        for (const [id, reg] of Object.entries(msg.delta.tiles)) {
          if (reg.value) tiles[id] = reg.value;
        }
        render();
      }
    };
    document.getElementById("move-btn").addEventListener("click", () => {
      const t = tiles["tile_modelica"];
      if (!t) return;
      const updated = { ...t, bounds: { ...t.bounds, x: 912 } };
      tiles["tile_modelica"] = updated;
      render();
      ws.send(JSON.stringify({
        type: "delta",
        boardId: "demo-polyglot-actuator",
        delta: {
          originPeerId: peerId,
          tiles: { tile_modelica: { value: updated, stamp: { clock: 10, peerId } } }
        }
      }));
    });
  </script>
</body>
</html>`);
    });

    const server = http.createServer(app);
    const wss = attachCanvasWebSocket(server, manager);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const pageA = await browser.newPage();
      const pageB = await browser.newPage();

      await Promise.all([pageA.goto(`${baseUrl}/e2e-canvas?peer=alice`), pageB.goto(`${baseUrl}/e2e-canvas?peer=bob`)]);

      await Promise.all([
        pageA.waitForSelector('[data-tile-id="tile_modelica"]'),
        pageB.waitForSelector('[data-tile-id="tile_modelica"]'),
      ]);

      const countA = await pageA.$$eval("[data-tile-id]", (els) => els.length);
      const countB = await pageB.$$eval("[data-tile-id]", (els) => els.length);
      assert.equal(countA, 6);
      assert.equal(countB, 6);

      // Click Move Modelica in Tab A -> verify Tab B DOM updates live to x=912
      await pageA.click("#move-btn");
      await pageB.waitForFunction(
        () => document.querySelector('[data-tile-id="tile_modelica"]')?.getAttribute("data-x") === "912",
        undefined,
        { timeout: 4000 },
      );

      const syncedX = await pageB.$eval('[data-tile-id="tile_modelica"]', (el) => el.getAttribute("data-x"));
      assert.equal(syncedX, "912");

      await pageA.close();
      await pageB.close();
    } finally {
      await browser.close();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
