// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { buildMorselHandoffUrl } from "../../docs/docs/.vitepress/theme/util/polyglot-paste-detector.js";

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

describe("@modelscript/web Morsel #m= Handoff & Polyglot Digital Thread Browser E2E", () => {
  it("loads compressed #m= handoff into /morsel, mounts Monaco + Inspector, and runs Verify Digital Thread without errors", async (t) => {
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
        fileName: "PowerSupply.sysml",
        langSlug: "sysml2",
        code: `package PowerSupply {
  part def FilterStage {
    attribute v_out = 5.0 [V];
  }
}`,
      },
      {
        fileName: "FilterStage.sp",
        langSlug: "spice",
        code: `* @twin: v_out <-> PowerSupply::FilterStage.v_out
* @unit: v_out = mV
.param v_out=3300
R1 in out 1k`,
      },
    ];

    const handoffUrl = await buildMorselHandoffUrl("http://127.0.0.1", tabs, 1);
    const hash = handoffUrl.slice(handoffUrl.indexOf("#"));

    const { server, port } = await startSpaServer(DIST_DIR);
    let browser: import("playwright").Browser | undefined;
    try {
      browser = await playwright.chromium.launch({ headless: true });
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const pageErrors: string[] = [];
      page.on("pageerror", (err) => pageErrors.push(err.message));

      // Mock backend API calls gracefully so offline SPA stays deterministic
      await page.route("**/api/**", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
      );

      await page.goto(`http://127.0.0.1:${port}/morsel?view=split&subview=inspector${hash}`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      const monaco = page.locator(".monaco-editor").first();
      await monaco.waitFor({ state: "visible", timeout: 25000 });
      const editorText = await page.locator(".monaco-editor").first().innerText();
      assert.ok(
        editorText.includes("FilterStage") || editorText.includes("v_out"),
        `Expected handoff SPICE code in Morsel Monaco editor, got: ${editorText.slice(0, 200)}`,
      );

      // Verify Digital Thread button inside PolyglotDomainPanel (Inspector subview)
      const inspectorTab = page.locator("button:has-text('Inspector')").first();
      if (
        (await inspectorTab.count()) > 0 &&
        !(await page.locator("button:has-text('Verify Digital Thread')").count())
      ) {
        await inspectorTab.click({ force: true });
      }
      const verifyThreadBtn = page.locator("button:has-text('Verify Digital Thread')").first();
      await verifyThreadBtn.waitFor({ state: "visible", timeout: 20000 });
      await verifyThreadBtn.click({ force: true });
      await page.waitForTimeout(1500);

      assert.deepStrictEqual(pageErrors, [], `Unexpected pageerror(s) in Morsel: ${pageErrors.join("; ")}`);
    } finally {
      await browser?.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
