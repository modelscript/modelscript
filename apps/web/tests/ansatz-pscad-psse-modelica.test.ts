// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { buildAnsatzHandoffUrl } from "../../docs/docs/.vitepress/theme/util/polyglot-paste-detector.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.resolve(__dirname, "../dist");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".gz": "application/gzip",
};

function startSpaServer(rootDir: string): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const reqUrl = decodeURIComponent((req.url ?? "/").split("?")[0]!);
      const relPath = reqUrl === "/" ? "index.html" : reqUrl.replace(/^\/+/, "");
      let filePath = path.join(rootDir, relPath);
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(rootDir, "index.html");
      }
      const ext = path.extname(filePath).toLowerCase();
      res.setHeader("Content-Type", MIME_TYPES[ext] ?? "application/octet-stream");
      if (filePath.endsWith(".gz")) {
        res.setHeader("Content-Encoding", "gzip");
      }
      fs.createReadStream(filePath).pipe(res);
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Unexpected server address"));
        return;
      }
      resolve({ server, port: addr.port });
    });
  });
}

describe("@modelscript/web Ansatz Modelica + PSCAD + PSS/E Browser E2E", () => {
  it("loads Modelica + PSCAD + PSS/E workspace in /ansatz and runs Simulate with zero pageerrors", async (t) => {
    const indexHtml = path.join(DIST_DIR, "index.html");
    if (!fs.existsSync(indexHtml)) {
      t.skip("apps/web/dist/index.html not built; run npm run build --workspace=@modelscript/web first");
      return;
    }

    let playwright: typeof import("playwright") | null = null;
    try {
      playwright = await import("playwright");
    } catch {
      t.skip("Playwright not installed in this environment");
      return;
    }

    const tabs = [
      {
        fileName: "System.mo",
        langSlug: "modelica",
        code: `model System
  PSSEDynamics.GENROU gen1(H = 5.0);
  Real v_ref(start = 1.0);
equation
  der(v_ref) = -0.5 * (v_ref - 1.02);
  gen1.Vt_in = v_ref;
end System;`,
      },
      {
        fileName: "EmtIsland.pscx",
        langSlug: "pscad",
        code: `<project name="EmtIsland" version="5.0">
  <definitions>
    <Definition classid="UserCmpDefn" name="Main" id="1">
      <schematic id="2">
        <User classid="UserCmp" id="10" name="master:source_3" defn="master:source_3" x="0" y="0">
          <paramlist><param name="Name" value="GridSrc" /><param name="Vm" value="230.0" /></paramlist>
        </User>
      </schematic>
    </Definition>
  </definitions>
</project>`,
      },
      {
        fileName: "Grid.raw",
        langSlug: "psse",
        code: [
          "0, 100.0, 33, 0, 0, 60.0 / IEEE 2-BUS",
          "TEST CASE",
          "1, 'SLACK', 230.0, 3, 1, 1, 1, 1.02, 0.0",
          "2, 'PCC',   230.0, 1, 1, 1, 1, 1.00, -2.0",
          "0 / END OF BUS DATA",
        ].join("\n"),
      },
    ];

    const handoffUrl = await buildAnsatzHandoffUrl("http://127.0.0.1", tabs, 0);
    const hash = handoffUrl.slice(handoffUrl.indexOf("#"));

    const { server, port } = await startSpaServer(DIST_DIR);
    let browser: import("playwright").Browser | undefined;
    try {
      browser = await playwright.chromium.launch({ headless: true });
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
      const page = await context.newPage();
      const pageErrors: string[] = [];
      page.on("pageerror", (err) => pageErrors.push(err.message));

      await page.goto(`http://127.0.0.1:${port}/ansatz${hash}`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForSelector(".monaco-editor", { timeout: 20000 });

      const simBtn = page.getByRole("button", { name: /simulate/i }).first();
      if (await simBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await simBtn.click();
        await page.waitForTimeout(2000);
      }

      assert.deepEqual(pageErrors, [], `Expected zero pageerrors in Ansatz, got: ${pageErrors.join("; ")}`);
    } finally {
      await browser?.close();
      server.close();
    }
  });
});
