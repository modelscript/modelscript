// SPDX-License-Identifier: AGPL-3.0-or-later

import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";
import { fileURLToPath } from "url";
import { LibraryDatabase } from "../database.js";

const _filename = fileURLToPath(import.meta.url);
const _dirname = path.dirname(_filename);

const database = new LibraryDatabase();

interface ThumbnailTask {
  artifactId: number;
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
      const res = await doGenerateThumbnail(task.artifactId);
      task.resolve(res);
    } catch (err) {
      console.error(`[Thumbnail Worker] Unhandled error processing artifact ${task.artifactId}:`, err);
      task.resolve(null);
    }
  }

  isProcessingQueue = false;
}

export function generateThumbnail(artifactId: number): Promise<string | null> {
  if (process.env.NODE_ENV === "test") {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    queue.push({ artifactId, resolve });
    processQueue().catch(console.error);
  });
}

async function doGenerateThumbnail(artifactId: number): Promise<string | null> {
  try {
    console.log(`[Thumbnail Worker] Launching headless browser for artifact ${artifactId}`);
    const browser = await puppeteer.launch({
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

    const webPort = process.env.WEB_PORT || 3001;
    const url = `http://localhost:${webPort}/render-artifact/${artifactId}?thumbnail=true`;

    const captureTheme = async (theme: "light" | "dark") => {
      await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
      console.log(`[Thumbnail Worker] Navigating to ${url} (Theme: ${theme})`);

      await page.evaluateOnNewDocument(() => {
        (globalThis as unknown as { __ARTIFACT_READY?: boolean }).__ARTIFACT_READY = false;
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

    await browser.close();

    database.updateArtifactThumbnail(artifactId, thumbnailUrlLight);
    console.log(`[Thumbnail Worker] Successfully updated database for artifact ${artifactId}`);

    return thumbnailUrlLight;
  } catch (err) {
    console.error(`[Thumbnail Worker] Error generating thumbnail for ${artifactId}:`, err);
    return null;
  }
}
