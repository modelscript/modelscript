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
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
      const page = await context.newPage();
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
      await page
        .waitForFunction(
          () => {
            const text = document.querySelector(".monaco-editor")?.textContent ?? "";
            return text.includes("FilterStage") || text.includes("v_out");
          },
          null,
          { timeout: 15000 },
        )
        .catch(() => {});
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

const HERO_TEST_SCAD_CODE = `
$fn = 24;
module coax_ring(x0, len, r_out, r_in) {
  translate([x0 + len / 2, 0, 0])
  rotate([0, 90, 0])
  difference() {
    cylinder(h = len, r = r_out, center = true);
    cylinder(h = len + 0.04, r = r_in, center = true);
  }
}
color([0.52, 0.56, 0.62, 1.0]) coax_ring(-2.0, 2.2, 1.48, 1.32);
color([0.82, 0.54, 0.34, 1.0]) coax_ring(0.3, 0.7, 0.64, 0.42);
`.trim();

const HERO_TEST_STEP_CODE = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('AP242 Turbofan Fan Ring'),'2;1');
FILE_NAME('FanFrame.step','2026-11-14T00:00:00',('ModelScript'),('ModelScript'),'','','');
FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF'));
ENDSEC;
DATA;
#10=APPLICATION_CONTEXT('managed model based 3d engineering');
#11=PRODUCT_CONTEXT('',#10,'mechanical');
#12=PRODUCT('FanFrame','Fan Frame Assembly','Titanium Ring',(#11));
#20=CARTESIAN_POINT('Origin',(0.0,0.0,0.0));
#21=DIRECTION('AxisX',(1.0,0.0,0.0));
#22=DIRECTION('RefY',(0.0,1.0,0.0));
#23=AXIS2_PLACEMENT_3D('MainAxis',#20,#21,#22);
#24=CARTESIAN_POINT('P0',(-1.0,-1.0,0.0));
#25=CARTESIAN_POINT('P1',(1.0,-1.0,0.0));
#26=CARTESIAN_POINT('P2',(1.0,1.0,0.0));
#27=CARTESIAN_POINT('P3',(-1.0,1.0,0.0));
#28=POLY_LOOP('FrameLoop',(#24,#25,#26,#27));
#29=FACE_OUTER_BOUND('Outer',#28,.T.);
#30=DATUM('Datum A','Primary Mounting Face',#23,'A');
#31=DATUM_SYSTEM('DRF_A',(#30));
#40=POSITION_TOLERANCE('Coax','Axis Coaxiality',0.025,#31);
ENDSEC;
END-ISO-10303-21;
`;

const CHROMIUM_WEBGL_ARGS = [
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-webgl",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
];

async function waitForLargeCanvasBox(page: import("playwright").Page, timeout = 15000) {
  const handle = await page.waitForFunction(
    () => {
      for (const c of Array.from(document.querySelectorAll("canvas"))) {
        const r = c.getBoundingClientRect();
        if (r.width > 100 && r.height > 100) {
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        }
      }
      return null;
    },
    { timeout },
  );
  return handle.jsonValue();
}

describe("@modelscript/web 3D CAD WebGL2 E2E (Morsel & Ansatz)", () => {
  it("renders OpenSCAD (.scad) and STEP (.step) 3D CAD geometry in Morsel WebGL2 CadViewer with interactive CUT X / SPLIT HUD and zero pageerrors", async (t) => {
    const indexHtml = path.join(DIST_DIR, "index.html");
    if (!fs.existsSync(indexHtml)) {
      t.skip("apps/web/dist/index.html not built; run npm run build --workspace=@modelscript/web first");
      return;
    }

    const playwright = await import("playwright");
    const { chromium } = playwright;
    if (!fs.existsSync(chromium.executablePath())) {
      t.skip(`Playwright Chromium binary not installed at ${chromium.executablePath()}`);
      return;
    }

    const handoffUrl = await buildMorselHandoffUrl(
      "http://127.0.0.1",
      [
        { fileName: "TurbofanRotor.scad", langSlug: "scad", code: HERO_TEST_SCAD_CODE },
        { fileName: "FanFrame.step", langSlug: "step", code: HERO_TEST_STEP_CODE },
      ],
      0,
    );
    const hash = handoffUrl.slice(handoffUrl.indexOf("#"));

    const { server, port } = await startSpaServer(DIST_DIR);
    let browser: import("playwright").Browser | undefined;
    try {
      browser = await chromium.launch({ headless: true, args: CHROMIUM_WEBGL_ARGS });
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
      const page = await context.newPage();
      const pageErrors: string[] = [];
      page.on("pageerror", (err) => pageErrors.push(err.stack || err.message));

      await page.route("**/api/**", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
      );

      await page.goto(`http://127.0.0.1:${port}/morsel?view=split&subview=3d${hash}`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      // Wait for CadViewer HUD ("CUT X") first so Monaco's 14px minimap canvas is not matched
      const cutXBtn = page.locator('button:has-text("CUT X")').first();
      await cutXBtn.waitFor({ state: "visible", timeout: 25000 });

      const box = await waitForLargeCanvasBox(page);
      assert.ok(
        box && box.width > 100 && box.height > 100,
        `Expected non-zero WebGL2 canvas, got ${JSON.stringify(box)}`,
      );
      assert.strictEqual(await page.locator("text=3D Viewer Error").count(), 0);

      // Toggle X-axis cutting plane and verify SPLIT/AUTO studio section HUD appears
      await cutXBtn.click();
      await page.locator('button:has-text("SPLIT")').first().waitFor({ state: "visible", timeout: 5000 });
      await page.locator('button:has-text("AUTO")').first().waitFor({ state: "visible", timeout: 5000 });

      // Switch to STEP tab and confirm 3D WebGL canvas stays healthy
      const stepTab = page.locator('[role="tab"]:has-text("FanFrame.step"), button:has-text("FanFrame.step")').first();
      await stepTab.waitFor({ state: "visible", timeout: 10000 });
      await stepTab.click();
      await page.waitForTimeout(800);
      assert.strictEqual(await page.locator("text=3D Viewer Error").count(), 0);
      await cutXBtn.waitFor({ state: "visible", timeout: 10000 });
      const stepBox = await waitForLargeCanvasBox(page);
      assert.ok(
        stepBox && stepBox.width > 100 && stepBox.height > 100,
        `Expected non-zero WebGL2 canvas after STEP switch, got ${JSON.stringify(stepBox)}`,
      );

      assert.deepStrictEqual(pageErrors, [], `Unexpected pageerror(s) in Morsel 3D WebGL2: ${pageErrors.join("; ")}`);
    } finally {
      await browser?.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("renders Ansatz PolyglotArtifactViewer (.scad) and CadStepViewer (.step + GD&T) on /render-artifact/:id in live WebGL2 with zero pageerrors", async (t) => {
    const indexHtml = path.join(DIST_DIR, "index.html");
    if (!fs.existsSync(indexHtml)) {
      t.skip("apps/web/dist/index.html not built; run npm run build --workspace=@modelscript/web first");
      return;
    }

    const playwright = await import("playwright");
    const { chromium } = playwright;
    if (!fs.existsSync(chromium.executablePath())) {
      t.skip(`Playwright Chromium binary not installed at ${chromium.executablePath()}`);
      return;
    }

    const { server, port } = await startSpaServer(DIST_DIR);
    let browser: import("playwright").Browser | undefined;
    try {
      browser = await chromium.launch({ headless: true, args: CHROMIUM_WEBGL_ARGS });
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        serviceWorkers: "block",
      });
      const page = await context.newPage();
      const pageErrors: string[] = [];
      page.on("pageerror", (err) => pageErrors.push(err.stack || err.message));

      await page.route("**/api/**", async (route) => {
        const url = route.request().url();
        if (url.includes("/social/artifact-views/101")) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              artifactView: {
                id: 101,
                view_type: "scad",
                title: "TurbofanRotor.scad",
                view_config: JSON.stringify({
                  dialect: "scad",
                  filename: "TurbofanRotor.scad",
                  code: HERO_TEST_SCAD_CODE,
                }),
              },
            }),
          });
          return;
        }
        if (url.includes("/social/artifact-views/102")) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              artifactView: {
                id: 102,
                view_type: "cad-step",
                title: "FanFrame.step",
                view_config: JSON.stringify({
                  dialect: "step",
                  filename: "FanFrame.step",
                  code: HERO_TEST_STEP_CODE,
                }),
              },
            }),
          });
          return;
        }
        await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      });

      // 1. Ansatz PolyglotArtifactViewer routing dialect === "scad" -> CadStepViewer
      await page.goto(`http://127.0.0.1:${port}/render-artifact/101?chromeless=1`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await page.locator('button:has-text("SPLIT")').first().waitFor({ state: "visible", timeout: 25000 });
      const scadBox = await waitForLargeCanvasBox(page);
      assert.ok(
        scadBox && scadBox.width > 100 && scadBox.height > 100,
        `Expected SCAD WebGL2 canvas, got ${JSON.stringify(scadBox)}`,
      );
      await page.locator('button:has-text("SPLIT")').first().click();
      await page.locator('button:has-text("AUTO")').first().waitFor({ state: "visible", timeout: 5000 });

      // 2. Ansatz CadStepViewer (.step AP242 + GD&T HUD)
      await page.goto(`http://127.0.0.1:${port}/render-artifact/102?chromeless=1`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await page.locator('button:has-text("SPLIT")').first().waitFor({ state: "visible", timeout: 25000 });
      const stepBox = await waitForLargeCanvasBox(page);
      assert.ok(
        stepBox && stepBox.width > 100 && stepBox.height > 100,
        `Expected STEP WebGL2 canvas, got ${JSON.stringify(stepBox)}`,
      );
      const gdtBtn = page.locator('button:has-text("GD&T")').first();
      await gdtBtn.waitFor({ state: "visible", timeout: 10000 });
      await gdtBtn.click();
      await page.waitForTimeout(500);

      assert.deepStrictEqual(
        pageErrors,
        [],
        `Unexpected pageerror(s) in Ansatz CadStepViewer: ${pageErrors.join("; ")}`,
      );
    } finally {
      await browser?.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("@modelscript/web Morsel Digital Thread Composition & Verification E2E", () => {
  it("renders Digital Thread SVG graph, composes links, runs Formal (SMT) + Simulation verification, and shows cross-file diagnostics", async (t) => {
    const indexHtml = path.join(DIST_DIR, "index.html");
    if (!fs.existsSync(indexHtml)) {
      t.skip("apps/web/dist/index.html not built; run npm run build --workspace=@modelscript/web first");
      return;
    }

    const playwright = await import("playwright");
    const { chromium } = playwright;
    if (!fs.existsSync(chromium.executablePath())) {
      t.skip(`Playwright Chromium binary not installed at ${chromium.executablePath()}`);
      return;
    }

    const sysmlCode = `package ThermalSystemThread {
  import ThermalPlant::*;

  part def HeatsinkAssembly {
    attribute fin_height_mm = 25.0 [mm];
    attribute max_temp_C = 85.0 [degC];
  }

  part def ThermalPlant {
    attribute T = 25.0 [degC];
  }

  requirement def <'REQ-THM-01'> MaxTempRequirement {
    subject plant : ThermalPlant;
    require constraint { ThermalPlant.T_max <= 85.0 }
  }

  verification def ThermalSimVerification {
    subject plant : ThermalPlant;
    verify requirement MaxTempRequirement;
  }
}`;

    const scadCode = `// @twin: fin_height_mm <-> ThermalSystemThread::HeatsinkAssembly.fin_height_mm
// @unit: fin_height_mm = mm
fin_height_mm = 12.0;
cube([60, 40, 4]);`;

    const modelicaCode = `model ThermalPlant
  parameter Real fin_height_mm(unit="mm") = 25.0 annotation(twin = "ThermalSystemThread::HeatsinkAssembly.fin_height_mm");
  parameter Real T_max(unit="degC") = 85.0 annotation(twin = "ThermalSystemThread::HeatsinkAssembly.max_temp_C");
  parameter Real Q_in = 40.0;
  parameter Real C_th = 120.0;
  parameter Real G_conv = 0.85;
  Real T(start = 25.0);
equation
  C_th * der(T) = Q_in - G_conv * (T - 25.0);
  annotation(implements="ThermalPlant", experiment(StartTime = 0, StopTime = 300, Interval = 1));
end ThermalPlant;`;

    const handoffUrl = await buildMorselHandoffUrl(
      "http://127.0.0.1",
      [
        { fileName: "Requirements.sysml", langSlug: "sysml2", code: sysmlCode },
        { fileName: "Enclosure.scad", langSlug: "scad", code: scadCode },
        { fileName: "ThermalPlant.mo", langSlug: "modelica", code: modelicaCode },
      ],
      0,
    );
    const hash = handoffUrl.slice(handoffUrl.indexOf("#"));

    const { server, port } = await startSpaServer(DIST_DIR);
    let browser: import("playwright").Browser | undefined;
    try {
      browser = await chromium.launch({ headless: true, args: CHROMIUM_WEBGL_ARGS });
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
      const page = await context.newPage();
      const pageErrors: string[] = [];
      page.on("pageerror", (err) => pageErrors.push(err.stack || err.message));

      await page.route("**/api/**", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
      );

      await page.goto(`http://127.0.0.1:${port}/morsel?view=split&subview=inspector${hash}`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      // Switch to Digital Thread sub-tab inside Inspector
      const threadTabBtn = page.locator('button:has-text("Digital Thread")').first();
      await threadTabBtn.waitFor({ state: "visible", timeout: 25000 });
      await threadTabBtn.click();

      // Verify SVG node-link graph renders with all 3 files
      const graphEl = page.locator('[data-testid="morsel-digital-thread-graph"]');
      await graphEl.waitFor({ state: "visible", timeout: 15000 });
      await graphEl.locator('text="Requirements.sysml"').waitFor({ state: "visible", timeout: 10000 });
      await graphEl.locator('text="Enclosure.scad"').waitFor({ state: "visible", timeout: 10000 });
      await graphEl.locator('text="ThermalPlant.mo"').waitFor({ state: "visible", timeout: 10000 });

      // Run Formal Verification (SMT) and verify UNSAT drift + Apply Fix appears
      const verifyFormalBtn = page.locator('button:has-text("Verify Formal (SMT)")').first();
      await verifyFormalBtn.click();
      await page.locator("text=/UNSAT/").first().waitFor({ state: "visible", timeout: 20000 });
      await page.locator('button:has-text("Apply Fix")').first().waitFor({ state: "visible", timeout: 15000 });

      // Open Link Artifacts composer
      const linkBtn = page.locator('button:has-text("Link Artifacts")').first();
      await linkBtn.click();
      await page.locator('text="Compose Cross-Artifact Link"').first().waitFor({ state: "visible", timeout: 5000 });

      // Run Simulation Verification
      const verifySimBtn = page.locator('button:has-text("Verify Simulation")').first();
      await verifySimBtn.click();
      const simBanner = page.locator('[data-testid="morsel-sim-status"]');
      await simBanner.waitFor({ state: "visible", timeout: 10000 });
      await page.locator('[data-testid="morsel-sim-status"]:not([data-state="running"])').waitFor({
        state: "visible",
        timeout: 45000,
      });

      assert.deepStrictEqual(pageErrors, [], `Unexpected pageerror(s): ${pageErrors.join("; ")}`);
    } finally {
      await browser?.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
