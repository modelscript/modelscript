import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";
import { fileURLToPath } from "url";
import { LibraryDatabase } from "../database.js";

const _filename = fileURLToPath(import.meta.url);
const _dirname = path.dirname(_filename);

const database = new LibraryDatabase();
const db = database.db;

// Global limit to prevent multiple puppeteer instances from crashing the server
let isGenerating = false;

export async function generateThumbnail(artifactId: number): Promise<string | null> {
  if (isGenerating) {
    console.log(`[Thumbnail Worker] Already running, skipping generation for ${artifactId}`);
    return null;
  }

  isGenerating = true;
  try {
    console.log(`[Thumbnail Worker] Launching headless browser for artifact ${artifactId}`);
    const browser = await puppeteer.launch({
      headless: true, // we use the old syntax because puppeteer v22+ defaults to "new" mode automatically, but "new" might be unsupported in this version
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--enable-webgl",
        "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader",
        "--window-size=800,600",
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 600, deviceScaleFactor: 2 }); // 2x for high-res

    // 2. Capture themes
    const webPort = process.env.WEB_PORT || 3001;
    const url = `http://localhost:${webPort}/render-artifact/${artifactId}?thumbnail=true`;

    const captureTheme = async (theme: "light" | "dark") => {
      await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
      console.log(`[Thumbnail Worker] Navigating to ${url} (Theme: ${theme})`);

      // Reset the artifact ready flag in case it's a reload
      await page.evaluateOnNewDocument(() => {
        (globalThis as unknown as { __ARTIFACT_READY?: boolean }).__ARTIFACT_READY = false;
      });

      await page.goto(url, { waitUntil: "domcontentloaded" });

      // 3. Wait for the WebGL scene to signal it's fully loaded
      console.log(`[Thumbnail Worker] Waiting for window.__ARTIFACT_READY`);
      await page.waitForFunction("window.__ARTIFACT_READY === true", { timeout: 45000 });

      // Wait a brief moment for the first few animation frames to render
      await new Promise((r) => setTimeout(r, 1000));

      // 4. Capture screenshot
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

    // 5. Update Database
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = db.prepare(`SELECT view_config FROM artifact_views WHERE id = ?`).get(artifactId) as any;
    if (row && row.view_config) {
      const config = JSON.parse(row.view_config);
      config.thumbnailUrl = thumbnailUrlLight; // fallback
      config.thumbnailUrlLight = thumbnailUrlLight;
      config.thumbnailUrlDark = thumbnailUrlDark;
      db.prepare(`UPDATE artifact_views SET view_config = ? WHERE id = ?`).run(JSON.stringify(config), artifactId);
      console.log(`[Thumbnail Worker] Successfully updated database for artifact ${artifactId}`);
    }

    return thumbnailUrlLight;
  } catch (err) {
    console.error(`[Thumbnail Worker] Error generating thumbnail for ${artifactId}:`, err);
    return null;
  } finally {
    isGenerating = false;
  }
}
