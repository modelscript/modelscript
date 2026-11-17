// SPDX-License-Identifier: AGPL-3.0-or-later

import { computeMeshVolumeAndArea, parseStepProvenanceMeta } from "@modelscript/cad";
import { extractStepGdtOverlay, formatFeatureControlFrameText } from "@modelscript/cad/gdt-overlay";
import { compileStepFromSources } from "@modelscript/lsp/handlers/cadStepCompiler";
import { createWasmParser } from "@modelscript/modelica/parser";
import { lintQifDocument, parseQif } from "@modelscript/qif";
import { extractScadCadComponents, lintScad } from "@modelscript/scad";
import { lintStepContent } from "@modelscript/step";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as http from "node:http";
import { createRequire } from "node:module";
import * as path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { TURBINE_GDT_ITEMS, TURBINE_GDT_OVERLAY } from "../docs/.vitepress/theme/components/turbine/gdt-callouts.js";
import { TURBINE_ARTIFACTS, extractTurbineLiveParams } from "../docs/.vitepress/theme/components/turbine/models.js";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.resolve(__dirname, "../docs/.vitepress/dist");
const HERO_VUE_PATH = path.resolve(__dirname, "../docs/.vitepress/theme/components/TurbineHero.vue");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
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
      const reqUrl = decodeURIComponent((req.url ?? "/").split("?")[0]!);
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

describe("@modelscript/docs TurbineHero Live WASM LSP Studio", () => {
  it("keeps zero synchronous Monaco, Diagram, or LSP worker imports in TurbineHero.vue", () => {
    const heroSource = fs.readFileSync(HERO_VUE_PATH, "utf-8");
    const scriptMatch = heroSource.match(/<script setup lang="ts">([\s\S]*?)<\/script>/);
    assert.ok(scriptMatch, 'Expected <script setup lang="ts"> block in TurbineHero.vue');
    const scriptBody = scriptMatch[1]!;

    assert.ok(
      scriptBody.includes('defineAsyncComponent(() => import("./TurbineLspStudio.vue"))'),
      "TurbineHero.vue must lazy-load TurbineLspStudio.vue via defineAsyncComponent",
    );
    assert.ok(
      !/^\s*import\s+[^;]*from\s+["'](?:monaco-editor|\.\.\/util\/docs-lsp-client|\.\.\/util\/sandbox-monaco|\.\.\/util\/sandbox-diagram|@modelscript\/diagram)/m.test(
        scriptBody,
      ),
      "TurbineHero.vue must not statically import Monaco, Diagram, or LSP worker modules on initial load",
    );
  });

  it("extracts clamped live telemetry parameters and maintains aligned QIF/STEP GD&T callouts", () => {
    const byId = Object.fromEntries(TURBINE_ARTIFACTS.map((a) => [a.id, a.code]));
    const defaults = extractTurbineLiveParams(byId);
    assert.strictEqual(defaults.n1Rpm, 3850);
    assert.strictEqual(defaults.n2Rpm, 14200);
    assert.strictEqual(defaults.t04K, 1650);
    assert.strictEqual(defaults.cutX, 0);

    const modified = extractTurbineLiveParams({
      modelica:
        "parameter Real n1_rpm = 5120.0; parameter Real n2_rpm = 16800.0; parameter Real T_04 = 1890.0; parameter Real cut_x = 0.65;",
    });
    assert.strictEqual(modified.n1Rpm, 5120);
    assert.strictEqual(modified.n2Rpm, 16800);
    assert.strictEqual(modified.t04K, 1890);
    assert.strictEqual(modified.cutX, 0.65);

    const scadOverride = extractTurbineLiveParams(
      {
        modelica: byId.modelica!,
        scad: byId.scad!.replace("n1_rpm = 3850", "n1_rpm = 4600"),
      },
      "scad",
    );
    assert.strictEqual(scadOverride.n1Rpm, 4600);

    const clamped = extractTurbineLiveParams({
      modelica: "n1_rpm = 99999; n2_rpm = 99999; T_04 = 100; cut_x = 99;",
    });
    assert.strictEqual(clamped.n1Rpm, 12000);
    assert.strictEqual(clamped.n2Rpm, 28000);
    assert.strictEqual(clamped.t04K, 300);
    assert.strictEqual(clamped.cutX, 2.2);

    const qifCode = byId.qif!;
    const scadCode = byId.scad!;
    const stepCode = byId.step!;
    assert.ok(
      !qifCode.includes("stepEntityId="),
      "QIF MBD must bind symbolically by feature name, never hardcoded STEP entity IDs",
    );
    for (const symName of [
      "FanFrame_MountFace",
      "MainShaft_Centerline",
      "ClockingKeyway",
      "FanTipAcousticLiner",
      "HPC_Stage1_7_Shroud",
      "Combustor_AnnularLiner",
      "LPT_Stage1_MountFace",
    ]) {
      assert.ok(qifCode.includes(`"${symName}"`), `Missing symbolic feature '${symName}' in TurbofanMBD.qif`);
      assert.ok(scadCode.includes(`tag_port("${symName}"`), `Missing tag_port('${symName}') in TurbofanCSG.scad`);
    }
    assert.ok(
      scadCode.includes('@spool(part = "fan_lp_stage", spool = "n1"'),
      "Expected N1 @spool directive on fan_lp_stage",
    );
    assert.ok(
      scadCode.includes('@spool(part = "hpc_core_drum", spool = "n2"'),
      "Expected N2 @spool directive on hpc_core_drum",
    );

    assert.strictEqual(TURBINE_GDT_OVERLAY.datums.length, 3);
    assert.strictEqual(TURBINE_GDT_ITEMS.length, 5);
    for (const item of TURBINE_GDT_ITEMS) {
      assert.ok(qifCode.includes(item.qifCharacteristicId), `Missing ${item.qifCharacteristicId} in TurbofanMBD.qif`);
      assert.ok(item.fcfText.includes(item.callout.symbol));
      assert.strictEqual(item.fcfText, formatFeatureControlFrameText(item.callout));
    }

    const stepOverlay = extractStepGdtOverlay(stepCode, qifCode);
    assert.deepStrictEqual(
      stepOverlay.datums.map((d) => d.label),
      ["A", "B", "C"],
    );
    assert.ok(stepOverlay.callouts.length >= 2, "Expected extracted STEP AP242 GD&T tolerances");
    assert.strictEqual(stepOverlay.callouts[0]?.status, "PASS");
  });

  it("validates all 4 turbine digital-thread artifacts clean and triggers targeted faults", async () => {
    const byId = Object.fromEntries(TURBINE_ARTIFACTS.map((a) => [a.id, a]));

    // 1. Modelica CST parse clean
    const wasmPath = require.resolve("@modelscript/modelica/parser.wasm");
    const { facade } = await createWasmParser(wasmPath);
    const moSpec = byId.modelica!;
    const moRoot = facade.parseIncremental(moSpec.code, 0, 0, moSpec.code.length, moSpec.uri);
    assert.ok(moRoot > 0, "Expected clean Modelica CST root");
    assert.strictEqual(facade.getDiagnostics(moRoot, 0, 0, moSpec.code).length, 0);

    // 2. OpenSCAD clean vs faulted + Manifold CSG 3D mesh parity
    const scadSpec = byId.scad!;
    assert.deepStrictEqual(await lintScad(scadSpec.code), []);
    const scadComponents = await extractScadCadComponents(scadSpec.code);
    assert.ok(
      scadComponents.length >= 20,
      `Expected >=20 CSG solids for TurbofanCSG.scad, got ${scadComponents.length}`,
    );
    let minX = Infinity;
    let maxX = -Infinity;
    for (const comp of scadComponents) {
      const pm = comp.proceduralMesh;
      assert.ok(pm && pm.vertices.length > 0 && pm.indices.length > 0, `Expected non-empty mesh for ${comp.name}`);
      const tx = comp.cad?.position?.[0] ?? 0;
      for (let i = 0; i < pm.vertices.length; i += 3) {
        const wx = pm.vertices[i]! + tx;
        if (wx < minX) minX = wx;
        if (wx > maxX) maxX = wx;
      }
    }
    assert.ok(
      minX < -2.4 && maxX > 2.8,
      `Expected coaxial turbofan CSG span [-2.96, 3.2], got [${minX.toFixed(2)}, ${maxX.toFixed(2)}]`,
    );

    const faultedScad = scadSpec.injectFault(scadSpec.code);
    const scadDiags = await lintScad(faultedScad.code);
    assert.ok(scadDiags.length > 0, "Expected SCAD fault injection to produce at least one diagnostic");

    // 3. STEP AP242 clean vs T1005 faulted
    const stepSpec = byId.step!;
    assert.deepStrictEqual(lintStepContent(stepSpec.code), []);
    const faultedStep = stepSpec.injectFault(stepSpec.code);
    const stepDiags = lintStepContent(faultedStep.code);
    assert.ok(
      stepDiags.some((d) => String(d.code) === "T1005"),
      `Expected STEP T1005 diagnostic after fault injection, got ${JSON.stringify(stepDiags)}`,
    );

    // 4. QIF 3.0 GD&T clean vs M8104 faulted
    const qifSpec = byId.qif!;
    const cleanQifDoc = parseQif(qifSpec.code);
    assert.deepStrictEqual(lintQifDocument(cleanQifDoc), []);
    const faultedQif = qifSpec.injectFault(qifSpec.code);
    const faultedQifDoc = parseQif(faultedQif.code);
    const qifDiags = lintQifDocument(faultedQifDoc);
    assert.ok(
      qifDiags.some((d) => String(d.code).includes("M8104") || /MMC/i.test(d.message)),
      `Expected QIF M8104 diagnostic after fault injection, got ${JSON.stringify(qifDiags)}`,
    );
  });

  it("compiles rich SCAD + QIF to AP242 STEP with clean lints, accurate anchors/volumes, provenance metadata, and closeStudio retention", async () => {
    const byId = Object.fromEntries(TURBINE_ARTIFACTS.map((a) => [a.id, a]));
    const scadCode = byId.scad!.code;
    const qifCode = byId.qif!.code;

    // Every evaluated SCAD mesh must have positive outward winding and full axial silhouette
    const scadMeshes = await extractScadCadComponents(scadCode);
    assert.ok(scadMeshes.length >= 100, `Expected rich SCAD meshes (>=100), got ${scadMeshes.length}`);
    for (const m of scadMeshes) {
      const pm = m.proceduralMesh!;
      const stats = computeMeshVolumeAndArea({
        vertices: new Float32Array(pm.vertices),
        indices: new Uint32Array(pm.indices),
        normals: new Float32Array(pm.normals ?? []),
        faceTagIndices: new Uint32Array(0),
        tags: [],
      });
      assert.ok(stats.volume > 0, `Expected positive volume for '${m.name}', got ${stats.volume}`);
    }

    // Compile SCAD + QIF -> AP242 STEP through the canonical LSP handler
    const compiled = compileStepFromSources({
      scadText: scadCode,
      qifText: qifCode,
      assemblyName: "Turbofan2Spool",
      scadUri: "file:///sandbox/TurbofanCSG.scad",
      qifUri: "file:///sandbox/TurbofanMBD.qif",
      stepUri: "file:///sandbox/TurbofanAP242.step",
      modelicaUri: "file:///sandbox/Turbofan2Spool.mo",
    });
    assert.strictEqual(compiled.error, undefined, `Unexpected compile error: ${compiled.error}`);
    assert.deepStrictEqual(lintStepContent(compiled.stepText), [], "Compiled turbofan STEP must pass lint cleanly");

    // Verify all 7 symbolic tag_port anchors map accurately in world coordinates
    assert.strictEqual(compiled.featureAnchors.length, 7);
    const fanLiner = compiled.featureAnchors.find((a) => a.name === "FanTipAcousticLiner");
    assert.ok(fanLiner, "Expected FanTipAcousticLiner anchor");
    assert.ok(
      Math.hypot(fanLiner.anchor[1], fanLiner.anchor[2]) > 1.4,
      `FanTipAcousticLiner radial anchor should sit on fan shroud (>1.4m), got ${JSON.stringify(fanLiner.anchor)}`,
    );

    // Verify self-contained @modelscript-meta provenance round-trip & 5 GD&T callouts
    const meta = parseStepProvenanceMeta(compiled.stepText);
    assert.ok(meta, "Expected @modelscript-meta provenance embedded in compiled STEP");
    assert.strictEqual(meta.scadSource, "TurbofanCSG.scad");
    assert.strictEqual(meta.qifSource, "TurbofanMBD.qif");
    assert.strictEqual(meta.modelicaSource, "Turbofan2Spool.mo");
    const spoolParts = new Set((meta.spools ?? []).map((s) => s.part));
    for (const expected of ["spinner_nose", "fan_lp_stage", "hpc_core_drum", "lpt_nozzle_stage"]) {
      assert.ok(spoolParts.has(expected), `Expected @spool part '${expected}' in provenance metadata`);
    }

    const overlay = extractStepGdtOverlay(compiled.stepText, qifCode);
    assert.deepStrictEqual(
      overlay.datums.map((d) => d.label),
      ["A", "B", "C"],
    );
    assert.strictEqual(overlay.callouts.length, 5, "Expected all 5 QIF GD&T callouts linked in compiled STEP");

    // Verify closeStudio() retains compiled STEP geometry and live GD&T overlay
    const heroSrc = fs.readFileSync(
      path.join(path.dirname(__filename), "../docs/.vitepress/theme/components/TurbineHero.vue"),
      "utf8",
    );
    const closeMatch = /function\s+closeStudio\s*\(\)(?:\s*:\s*void)?\s*\{([\s\S]*?)\n\}/.exec(heroSrc);
    assert.ok(closeMatch?.[1], "Expected closeStudio() function in TurbineHero.vue");
    assert.ok(!/setCompiledStepScene\(\s*null/.test(closeMatch[1]), "closeStudio() must retain compiled STEP scene");
    assert.ok(!/liveGdtOverlay\.value\s*=\s*null/.test(closeMatch[1]), "closeStudio() must retain liveGdtOverlay");
  });

  it(
    "renders WebGL2 hero with zero initial LSP requests, then transitions in-place on click with working GD&T, CSG overlay, Fault QuickFix & Esc exit",
    { timeout: 300_000 },
    async (t) => {
      const indexHtml = path.join(DIST_DIR, "index.html");
      if (!fs.existsSync(indexHtml)) {
        t.skip("VitePress dist/index.html not built; run npm run build --workspace=@modelscript/docs first");
        return;
      }

      const { chromium } = await import("playwright");
      if (!fs.existsSync(chromium.executablePath())) {
        t.skip(`Playwright Chromium binary not installed at ${chromium.executablePath()}`);
        return;
      }

      const { server, port } = await startStaticServer(DIST_DIR);
      let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

      try {
        browser = await chromium.launch({
          headless: true,
          args: [
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--enable-webgl",
            "--enable-unsafe-swiftshader",
            "--ignore-gpu-blocklist",
          ],
        });
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        const page = await context.newPage();

        const pageErrors: string[] = [];
        const consoleErrors: string[] = [];
        const lspRequestsBeforeInteract: string[] = [];
        let interactedWithHero = false;

        page.on("pageerror", (err) => pageErrors.push(err.message || String(err)));
        page.on("console", (msg) => {
          if (msg.type() === "error") consoleErrors.push(msg.text());
        });
        page.on("request", (req) => {
          if (!interactedWithHero && /\/lsp\/|monaco|browserServerMain/i.test(req.url())) {
            lspRequestsBeforeInteract.push(req.url());
          }
        });

        await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle", timeout: 30000 });

        // Wait for lightweight Three.js hero first frame
        const readyCanvas = page.locator(".turbine-canvas.is-ready").first();
        await readyCanvas.waitFor({ state: "visible", timeout: 15000 });
        const canvasMetrics = await readyCanvas.evaluate((el) => {
          const c = el as HTMLCanvasElement;
          return { width: c.width, height: c.height, studioCount: document.querySelectorAll(".tls-root").length };
        });
        assert.ok(canvasMetrics.width > 0 && canvasMetrics.height > 0, "Expected live WebGL2 canvas dimensions > 0");
        assert.strictEqual(canvasMetrics.studioCount, 0, "TurbineLspStudio must not mount before user interaction");
        assert.deepStrictEqual(
          lspRequestsBeforeInteract,
          [],
          `Zero LSP/Monaco requests should occur on initial load, saw: ${lspRequestsBeforeInteract.join(", ")}`,
        );

        // Hover hero to trigger 120ms idle prefetch + reveal CTA pill, then click into in-place studio
        interactedWithHero = true;
        await page.locator(".turbine").first().hover();
        const ctaPill = page.locator(".turbine-lsp-trigger").first();
        await ctaPill.waitFor({ state: "visible", timeout: 10000 });
        await ctaPill.click();

        const studioRoot = page.locator(".tls-root").first();
        await studioRoot.waitFor({ state: "visible", timeout: 45000 });

        // Verify all 4 engineering tabs, lock badge on STEP tab, and live telemetry readout
        const tabNames = await page.locator(".tls-tab .tls-tab-name").allInnerTexts();
        assert.deepStrictEqual(
          tabNames.map((t) => t.trim()),
          ["Turbofan2Spool.mo", "TurbofanCSG.scad", "TurbofanMBD.qif", "TurbofanAP242.step"],
        );
        assert.strictEqual(await page.locator('.tls-tab:has-text("TurbofanAP242.step") .tls-tab-lock').count(), 1);
        const telemetryText = await page.locator(".tls-telemetry").first().innerText();
        assert.ok(
          telemetryText.includes("3850") && telemetryText.includes("14200"),
          `Unexpected telemetry: ${telemetryText}`,
        );

        // Wait for WASM LSP worker ready & verify clean initial status
        await page.locator('.tls-status-dot[data-state="ready"]').waitFor({ state: "attached", timeout: 30000 });
        await page.locator('.tls-prob-summary:has-text("0 Problems")').waitFor({ state: "visible", timeout: 15000 });

        // Wait for auto-compiled AP242 STEP -> OCCT B-Rep mesh handoff onto 3D viewport
        const stepBtn = page.locator('button.tls-mini-btn:has-text("STEP 3D (")').first();
        await stepBtn.waitFor({ state: "visible", timeout: 150000 });
        const stepBtnLabel = await stepBtn.innerText();
        const meshMatch = /STEP 3D \((\d+)\)/.exec(stepBtnLabel);
        assert.ok(meshMatch && Number(meshMatch[1]) > 0, `Expected >=1 compiled STEP 3D mesh, got: ${stepBtnLabel}`);

        // Toggle ASME Y14.5 GD&T overlay and click one 3D badge -> jumps to TurbofanMBD.qif
        await page.locator('button.tls-pill-btn:has-text("GD&T")').click();
        await page.locator(".turbine-gdt-layer").first().waitFor({ state: "visible", timeout: 10000 });
        assert.strictEqual(await page.locator(".turbine-gdt-datum").count(), 3);
        assert.strictEqual(await page.locator(".turbine-gdt-fcf").count(), 5);

        await page.locator(".turbine-gdt-fcf").first().click({ force: true });
        await page
          .locator('.tls-tab.is-active:has-text("TurbofanMBD.qif")')
          .waitFor({ state: "visible", timeout: 10000 });

        // Exercise compiled STEP AP242 read-only tab, Diagram view, Code (Monaco), and Split views
        await page.locator('.tls-tab:has-text("TurbofanAP242.step")').click();
        await page.locator(".tls-ro-ribbon").first().waitFor({ state: "visible", timeout: 10000 });

        await page.locator('button.tls-view-btn:has-text("Diagram")').click();
        await page.locator(".tls-diagram-wrap").first().waitFor({ state: "visible", timeout: 10000 });

        await page.locator('button.tls-view-btn:has-text("Code")').click();
        await page.locator(".tls-monaco-host .monaco-editor").first().waitFor({ state: "visible", timeout: 25000 });

        // Jump back from STEP read-only banner to editable TurbofanMBD.qif source, then Split view
        await page.locator('.tls-ro-link:has-text("TurbofanMBD.qif")').click();
        await page
          .locator('.tls-tab.is-active:has-text("TurbofanMBD.qif")')
          .waitFor({ state: "visible", timeout: 10000 });
        assert.strictEqual(await page.locator(".tls-ro-ribbon").count(), 0);

        await page.locator('button.tls-view-btn:has-text("Split")').click();
        await page.locator(".tls-stage-slot").first().waitFor({ state: "visible", timeout: 10000 });

        // Toggle compiled STEP wireframe edges on/off
        await page.locator('button.tls-mini-btn:has-text("STEP 3D (")').first().click();
        await page.locator('button.tls-mini-btn:has-text("Wire On (")').waitFor({ state: "visible", timeout: 10000 });
        await page.locator('button.tls-mini-btn:has-text("Wire On (")').first().click();
        await page.locator('button.tls-mini-btn:has-text("STEP 3D (")').waitFor({ state: "visible", timeout: 10000 });

        // Exercise Inject Fault on QIF (M8104) -> Problems drawer -> 1-click Fix -> 0 Problems
        await page.locator('button.tls-mini-btn:has-text("Inject Fault")').click();
        await page.locator(".tls-prob-item").first().waitFor({ state: "visible", timeout: 15000 });
        const probSummary = await page.locator(".tls-prob-summary").first().innerText();
        assert.ok(
          /^[1-9]\d*\s+Problem/.test(probSummary.trim()),
          `Expected >=1 problem after Inject Fault, got: ${probSummary}`,
        );
        const fixBtn = page.locator(".tls-fix-btn").first();
        await fixBtn.waitFor({ state: "visible", timeout: 10000 });
        await fixBtn.click();
        await page.locator('.tls-prob-summary:has-text("0 Problems")').waitFor({ state: "visible", timeout: 60000 });

        // Exercise Expand overlay and Escape twice (collapse -> close back to lightweight hero)
        await page.locator('button[aria-label="Expand workbench"]').click();
        await page.locator(".turbine.is-expanded").waitFor({ state: "visible", timeout: 5000 });

        await page.keyboard.press("Escape");
        await page.waitForFunction(() => !document.querySelector(".turbine.is-expanded"), { timeout: 5000 });
        assert.strictEqual(await page.locator(".tls-root").count(), 1, "First Escape collapses expanded overlay");

        await page.keyboard.press("Escape");
        await page.waitForFunction(() => document.querySelectorAll(".tls-root").length === 0, { timeout: 5000 });
        await page.locator(".turbine-canvas.is-ready").waitFor({ state: "visible", timeout: 5000 });

        assert.deepStrictEqual(pageErrors, [], `Unexpected pageerror(s): ${pageErrors.join("; ")}`);
        assert.deepStrictEqual(consoleErrors, [], `Unexpected console errors: ${consoleErrors.join("; ")}`);
      } finally {
        await browser?.close();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  );
});
