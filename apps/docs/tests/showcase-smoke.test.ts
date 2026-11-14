// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.resolve(__dirname, "../docs/.vitepress/dist");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

function startStaticServer(rootDir: string): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const reqUrl = (req.url ?? "/").split("?")[0]!;
      const relPath = reqUrl === "/" ? "index.html" : reqUrl.replace(/^\/+/, "");
      let filePath = path.join(rootDir, relPath);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, "index.html");
      }
      if (!fs.existsSync(filePath) && fs.existsSync(`${filePath}.html`)) {
        filePath = `${filePath}.html`;
      }
      if (!fs.existsSync(filePath)) {
        res.statusCode = 404;
        res.end("Not Found");
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.setHeader("Content-Type", MIME_TYPES[ext] ?? "application/octet-stream");
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

describe("@modelscript/docs browser showcase smoke", () => {
  it("renders HomeWorkflowPairs and HomeSemanticCoordinator and runs worker evaluation without errors", async (t) => {
    const indexHtml = path.join(DIST_DIR, "index.html");
    if (!fs.existsSync(indexHtml)) {
      t.skip(
        "VitePress dist/index.html not built; run FEATURE_FLAG_HOME_SHOWCASE=true npm run build --workspace=@modelscript/docs first",
      );
      return;
    }

    const htmlText = fs.readFileSync(indexHtml, "utf-8");
    if (!htmlText.includes("HomeSemanticCoordinator") && !htmlText.includes("Digital Thread")) {
      t.skip("VitePress dist was built without FEATURE_FLAG_HOME_SHOWCASE=true");
      return;
    }

    const { chromium } = await import("playwright");
    if (!fs.existsSync(chromium.executablePath())) {
      t.skip(
        `Playwright Chromium binary not installed at ${chromium.executablePath()}; run npx playwright install to enable`,
      );
      return;
    }
    const { server, port } = await startStaticServer(DIST_DIR);
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      const pageErrors: string[] = [];
      page.on("pageerror", (err) => {
        pageErrors.push(err.message || String(err));
      });

      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(1000);

      const hasCoordinator = await page.locator("text=Semantic Theory Coordinator").count();
      const hasWorkflowPairs = await page.locator("text=Bidirectional TGG").count();
      assert.ok(hasCoordinator > 0 || hasWorkflowPairs > 0, "Expected showcase widgets to render on home page");

      const consoleErrors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      });

      // Click a fault preset in HomeSemanticCoordinator if present and verify UNSAT verdict renders
      const faultButton = page.locator("button:has-text('Thin CAD Flange')").first();
      if ((await faultButton.count()) > 0) {
        await faultButton.click({ force: true });
        await page.locator("text=UNSAT").first().waitFor({ state: "visible", timeout: 15000 });
        const unsatCount = await page.locator("text=UNSAT").count();
        assert.ok(
          unsatCount > 0,
          `Expected clicking 'Thin CAD Flange' fault preset to trigger UNSAT verdict (console errors: ${consoleErrors.join("; ")})`,
        );
      }

      // Exercise HomeWorkflowPairs interactive switching and conflict strategy toggle if present
      const workflowPairTab = page.locator("button:has-text('SPICE')").first();
      if ((await workflowPairTab.count()) > 0) {
        await workflowPairTab.click({ force: true });
        await page.waitForTimeout(400);
        const codeText = await page
          .locator("textarea, pre, code")
          .first()
          .innerText()
          .catch(() => "");
        assert.ok(codeText.length > 0, "Expected HomeWorkflowPairs to render code after switching pair");
      }

      const sourceWinsBtn = page.locator("button:has-text('Source Wins')").first();
      if ((await sourceWinsBtn.count()) > 0) {
        await sourceWinsBtn.click({ force: true });
        await page.waitForTimeout(300);
        const targetWinsBtn = page.locator("button:has-text('Target Wins')").first();
        if ((await targetWinsBtn.count()) > 0) {
          await targetWinsBtn.click({ force: true });
          await page.waitForTimeout(300);
        }
      }

      // Activate live Monaco editor and run worker-backed forward compilation
      const staticEditor = page.locator(".editor-body.static-semantic-view").first();
      if ((await staticEditor.count()) > 0) {
        await staticEditor.click({ force: true });
        const monacoMount = page.locator(".monaco-mount-node .monaco-editor").first();
        await monacoMount.waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
        const bridgeBtn = page.locator("button.bridge-pill").first();
        if ((await bridgeBtn.count()) > 0) {
          await bridgeBtn.click({ force: true });
          await page.waitForTimeout(400);
        }
        const editorText = await page
          .locator(".monaco-mount-node")
          .first()
          .innerText()
          .catch(() => "");
        assert.ok(editorText.length > 0, "Expected Monaco editor to render live code content");
      }

      // Exercise HomePolyglotSandbox lazy 92+ language LSP worker + digital thread QuickFix + fault injection
      const filterInput = page.locator("input[aria-label='Filter languages']").first();
      if ((await filterInput.count()) > 0) {
        await filterInput.fill("spice");
        const optionCount = await page.locator("select[aria-label='Select engineering language'] option").count();
        assert.ok(optionCount >= 1 && optionCount < 20, `Expected filtered language options, got ${optionCount}`);
        await filterInput.fill("");
      }

      const injectFaultBtn = page.locator("button:has-text('Inject Fault')").first();
      if ((await injectFaultBtn.count()) > 0) {
        await injectFaultBtn.click({ force: true });
        await page.locator(".sb-diag-item").first().waitFor({ state: "visible", timeout: 25000 });
        await page.locator(".sb-diag-item").first().click({ force: true });
      }

      const copyLinkBtn = page.locator("button:has-text('Copy Share Link')").first();
      if ((await filterInput.count()) > 0) {
        assert.ok((await copyLinkBtn.count()) > 0, "Expected Copy Share Link button in sandbox header");
      }

      const twinDemoBtn = page.locator("button:has-text('Load SysML + SPICE Twin Demo')").first();
      if ((await twinDemoBtn.count()) > 0) {
        await twinDemoBtn.click({ force: true });
        await page.locator(".sb-scope-toggle").first().waitFor({ state: "visible", timeout: 10000 });
        const fixBtn = page.locator("button:has-text('Apply Digital Thread QuickFix')").first();
        await fixBtn.waitFor({ state: "visible", timeout: 25000 });
        await fixBtn.click({ force: true });
        try {
          await page.locator(".sb-thread-box.is-sat").first().waitFor({ state: "visible", timeout: 20000 });
        } catch (err) {
          const boxText = await page
            .locator(".sb-results-pane")
            .first()
            .innerText()
            .catch(() => "<none>");
          const textareaVal = await page
            .locator(".sb-textarea")
            .first()
            .inputValue()
            .catch(() => "<none>");
          throw new Error(
            `Digital thread did not reach SAT after QuickFix. Textarea: ${JSON.stringify(textareaVal)}\nPanel text: ${boxText}\n${err}`,
          );
        }
        const monacoToggleBtn = page.locator("button.sb-monaco-toggle").first();
        if ((await monacoToggleBtn.count()) > 0) {
          await monacoToggleBtn.click({ force: true });
          await page.locator(".sb-monaco-host .monaco-editor").first().waitFor({ state: "visible", timeout: 20000 });
        }
      }

      assert.deepStrictEqual(pageErrors, [], `Unexpected pageerror(s): ${pageErrors.join("; ")}`);
    } finally {
      await browser?.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
