// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";
import { fileURLToPath } from "url";
import { LibraryDatabase } from "../database.js";

const _filename = fileURLToPath(import.meta.url);
const _dirname = path.dirname(_filename);

let _database: LibraryDatabase | null = null;
function getDatabase(): LibraryDatabase {
  if (!_database) {
    _database = new LibraryDatabase();
  }
  return _database;
}

interface ThumbnailTask {
  artifactId: number;
  anchor?: string | undefined;
  resolve: (val: string | null) => void;
}

const queue: ThumbnailTask[] = [];
let isProcessingQueue = false;

async function processQueue(): Promise<void> {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (queue.length > 0) {
    const task = queue.shift()!;
    try {
      const res = await doGenerateThumbnail(task.artifactId, task.anchor);
      task.resolve(res);
    } catch (err) {
      console.error(`[Thumbnail Worker] Unhandled error processing artifact ${task.artifactId}:`, err);
      task.resolve(null);
    }
  }

  isProcessingQueue = false;
}

const MAX_THUMBNAIL_QUEUE = 100;

export function generateThumbnail(artifactId: number, anchor?: string): Promise<string | null> {
  if (process.env["NODE_ENV"] === "test") {
    return Promise.resolve(null);
  }
  if (!Number.isSafeInteger(artifactId) || artifactId <= 0) {
    return Promise.resolve(null);
  }
  if (queue.length >= MAX_THUMBNAIL_QUEUE) {
    console.warn(`[Thumbnail Worker] Queue full (${MAX_THUMBNAIL_QUEUE}), dropping thumbnail task for ${artifactId}`);
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    queue.push({ artifactId, anchor, resolve });
    processQueue().catch(console.error);
  });
}

import {
  renderCfdAnimationIsometricSvg,
  renderStepIsometricSvg,
  renderVtuIsometricSvg,
} from "../services/artifact-preprocessor.js";
import { resolveLocalUploadBuffer } from "../util/cad-converter.js";

async function doGenerateThumbnail(artifactId: number, anchor?: string): Promise<string | null> {
  // Fast deterministic server-side 3D SVG thumbnail path for STEP, VTU, and CFD Animation artifacts
  try {
    const db = getDatabase();
    const view = db.getArtifactView(artifactId);
    if (view && view.view_config) {
      const cfg = JSON.parse(view.view_config) as Record<string, unknown>;
      const vType = (view.view_type || "").toLowerCase();
      let svgContent: string | null = null;

      if (vType === "cad-step" || vType === "step" || vType === "cad" || vType === "stp") {
        let stepText =
          typeof cfg["stepSource"] === "string"
            ? cfg["stepSource"]
            : typeof cfg["code"] === "string"
              ? cfg["code"]
              : null;
        if (!stepText && typeof cfg["url"] === "string") {
          const buf = resolveLocalUploadBuffer(cfg["url"]);
          if (buf) {
            stepText = new TextDecoder().decode(buf);
          }
        }
        if (stepText && stepText.includes("CARTESIAN_POINT")) {
          svgContent = renderStepIsometricSvg(stepText, view.title || "CAD Assembly").svg;
        }
      } else if (vType === "simulation-result" || vType === "fea-result" || vType === "cfd-result") {
        let vtuText = typeof cfg["vtuInline"] === "string" ? cfg["vtuInline"] : null;
        const vtuUrl =
          typeof cfg["vtuUrl"] === "string" ? cfg["vtuUrl"] : typeof cfg["url"] === "string" ? cfg["url"] : null;
        if (!vtuText && vtuUrl) {
          const buf = resolveLocalUploadBuffer(vtuUrl);
          if (buf) {
            vtuText = new TextDecoder().decode(buf);
          }
        }
        if (!vtuText) {
          const isCfd =
            vType === "cfd-result" ||
            (view.title || "").toLowerCase().includes("cfd") ||
            cfg["solver"] === "openfoam" ||
            cfg["solver"] === "su2";
          const exampleRel = isCfd
            ? "../../../packages/examples/drone-chassis/drone_cfd.vtu"
            : "../../../packages/examples/drone-chassis/drone_fea.vtu";
          const examplePath = path.resolve(_dirname, "../", exampleRel);
          if (fs.existsSync(examplePath)) {
            vtuText = fs.readFileSync(examplePath, "utf-8");
          }
        }
        if (vtuText && vtuText.includes("<VTKFile")) {
          const fieldUnits =
            cfg["fieldUnits"] && typeof cfg["fieldUnits"] === "object"
              ? (cfg["fieldUnits"] as Record<string, string>)
              : undefined;
          svgContent = renderVtuIsometricSvg(vtuText, view.title || "Simulation Result", fieldUnits).svg;
        }
      } else if (vType === "cfd-animation" && Array.isArray(cfg["frames"])) {
        const moldGeo =
          cfg["moldGeometry"] && typeof cfg["moldGeometry"] === "object"
            ? (cfg["moldGeometry"] as { length?: number; width?: number; height?: number })
            : undefined;
        svgContent = renderCfdAnimationIsometricSvg(
          cfg["frames"] as Parameters<typeof renderCfdAnimationIsometricSvg>[0],
          moldGeo,
        ).svg;
      }

      if (svgContent) {
        const outDir = path.join(_dirname, "../../public/thumbnails");
        if (!fs.existsSync(outDir)) {
          fs.mkdirSync(outDir, { recursive: true });
        }
        const thumbnailName = `artifact_${artifactId}_iso.svg`;
        const outPath = path.join(outDir, thumbnailName);
        fs.writeFileSync(outPath, svgContent, "utf-8");
        const thumbnailUrl = `/thumbnails/${thumbnailName}`;
        db.updateArtifactThumbnail(artifactId, thumbnailUrl, thumbnailUrl);
        console.log(`[Thumbnail Worker] Generated deterministic 3D SVG thumbnail for artifact ${artifactId}`);
        return thumbnailUrl;
      }
    }
  } catch (fastErr) {
    console.warn(`[Thumbnail Worker] Fast SVG generation skipped for ${artifactId}:`, fastErr);
  }

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    console.log(`[Thumbnail Worker] Launching headless browser for artifact ${artifactId}`);
    browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--enable-webgl",
        "--ignore-gpu-blocklist",
        "--enable-gpu",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--window-size=800,600",
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 600, deviceScaleFactor: 2 });

    const webPort = process.env["WEB_PORT"] || 3001;
    const anchorQuery = anchor ? `&anchor=${encodeURIComponent(anchor)}` : "";
    const url = `http://localhost:${webPort}/render-artifact/${artifactId}?thumbnail=true${anchorQuery}`;

    const captureTheme = async (theme: "light" | "dark") => {
      await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
      console.log(`[Thumbnail Worker] Navigating to ${url} (Theme: ${theme})`);

      await page.evaluateOnNewDocument(() => {
        (globalThis as unknown as { __ARTIFACT_READY?: boolean | undefined }).__ARTIFACT_READY = false;
      });

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });

      console.log(`[Thumbnail Worker] Waiting for window.__ARTIFACT_READY`);
      await page.waitForFunction("window.__ARTIFACT_READY === true", { timeout: 20000 });

      await new Promise((r) => setTimeout(r, 800));

      const thumbnailName = `artifact_${artifactId}_${theme}_${Date.now()}.png`;
      const outDir = path.join(_dirname, "../../public/thumbnails");
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      const outPath = path.join(outDir, thumbnailName);

      console.log(`[Thumbnail Worker] Capturing screenshot to ${outPath}`);
      await page.screenshot({ path: outPath });

      return `/thumbnails/${thumbnailName}`;
    };

    const thumbnailUrlLight = await captureTheme("light");
    const thumbnailUrlDark = await captureTheme("dark");

    getDatabase().updateArtifactThumbnail(artifactId, thumbnailUrlLight, thumbnailUrlDark);
    console.log(`[Thumbnail Worker] Successfully updated database for artifact ${artifactId}`);

    return thumbnailUrlLight;
  } catch (err) {
    console.error(`[Thumbnail Worker] Error generating thumbnail for ${artifactId}:`, err);
    return null;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
