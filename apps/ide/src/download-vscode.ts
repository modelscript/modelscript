// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Downloads the VS Code Web stable build and extracts it to ./vscode-web/.
// Uses the same mechanism as @vscode/test-web's download.ts.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { get } from "https";
import { dirname, join } from "path";
import { pipeline } from "stream/promises";
import { createGunzip } from "zlib";

const QUALITY = "stable";
const DEST = join(import.meta.dirname, "..", "vscode-web");

interface UpdateInfo {
  url: string;
  version: string;
}

async function fetchJSON(url: string): Promise<UpdateInfo> {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        return;
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(JSON.parse(data)));
      res.on("error", reject);
    });
  });
}

async function downloadAndExtract(url: string, dest: string): Promise<void> {
  // Dynamic import for tar-fs (CommonJS module)
  // @ts-expect-error -- tar-fs has no type declarations
  const tar = await import("tar-fs");

  return new Promise<void>((resolve, reject) => {
    get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        // Follow redirect
        const redirectUrl = res.headers.location;
        if (redirectUrl) {
          res.resume();
          downloadAndExtract(redirectUrl, dest).then(resolve, reject);
          return;
        }
      }

      const total = Number(res.headers["content-length"] || 0);
      let received = 0;
      let lastPrint = 0;

      res.on("data", (chunk) => {
        received += chunk.length;
        const now = Date.now();
        if (now - lastPrint > 500) {
          const pct = total > 0 ? ((received / total) * 100).toFixed(1) : "?";
          process.stdout.write(`\r  Downloading: ${(received / 1048576).toFixed(1)} MB (${pct}%)`);
          lastPrint = now;
        }
      });

      const gunzip = createGunzip();
      const extract = tar.extract(dest, { strip: 1 });

      extract.on("finish", () => {
        console.log(`\r  Downloaded ${(received / 1048576).toFixed(1)} MB — extracted to ${dest}`);
        resolve();
      });
      extract.on("error", reject);

      pipeline(res, gunzip, extract).catch(reject);
    });
  });
}

async function main() {
  if (existsSync(join(DEST, "version"))) {
    console.log("VS Code Web already downloaded at", DEST);
    return;
  }

  console.log(`Fetching latest VS Code Web ${QUALITY} build info...`);
  const info = await fetchJSON(`https://update.code.visualstudio.com/api/update/web-standalone/${QUALITY}/latest`);
  console.log(`  Version: ${info.version}`);
  console.log(`  URL: ${info.url}`);

  mkdirSync(DEST, { recursive: true });

  console.log("Downloading and extracting...");
  await downloadAndExtract(info.url, DEST);

  // The web-standalone build includes several extensions that are missing their JS code (dist folder).
  // If left as-is, VS Code throws "Not Found" activation errors.
  // Because VS Code's web workbench embeds extension metadata directly, patching package.json
  // does not prevent it from trying to load these missing files.
  // We fix this by creating stub entry points that export empty activate() functions.
  const extsDir = join(DEST, "extensions");
  if (existsSync(extsDir)) {
    const stub = `"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nexports.activate = function() {};\nexports.deactivate = function() {};\n`;
    const exts = readdirSync(extsDir);
    for (const ext of exts) {
      const pkgPath = join(extsDir, ext, "package.json");
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

        const createStubIfNeeded = (entryPoint: string | undefined) => {
          if (!entryPoint) return;
          let file = entryPoint;
          if (file.startsWith("./")) file = file.slice(2);
          if (!file.endsWith(".js")) file += ".js";

          const fullPath = join(extsDir, ext, file);
          if (!existsSync(fullPath)) {
            mkdirSync(dirname(fullPath), { recursive: true });
            writeFileSync(fullPath, stub);
          }
        };

        createStubIfNeeded(pkg.browser);
        createStubIfNeeded(pkg.main);
      }
    }
  }

  console.log("Done!");
}

main().catch((err) => {
  console.error("Failed to download VS Code Web:", err);
  process.exit(1);
});
