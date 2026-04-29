#!/usr/bin/env node
// Downloads the SysML v2 standard library zip, extracts only the
// sysml.library/ .sysml files, and repacks them into a lean zip.
// This reduces the bundled zip from ~63 MB to ~50 KB.
// Canonical download location: scripts/SysML-v2-Release-2026-03.zip

const fs = require("fs");
const https = require("https");
const path = require("path");
const { execSync } = require("child_process");

const ZIP_NAME = "SysML-v2-Release-2026-03.zip";
const DEST = path.join(__dirname, ZIP_NAME);
const URL = `https://github.com/Systems-Modeling/SysML-v2-Release/archive/refs/tags/2026-03.zip`;

if (fs.existsSync(DEST)) {
  console.log(`[download-sysml2] ${ZIP_NAME} already exists, skipping download.`);
  process.exit(0);
}

console.log(`[download-sysml2] Downloading SysML v2 release...`);

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const follow = (u) => {
      https
        .get(u, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            follow(res.headers.location);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} for ${u}`));
            return;
          }
          const file = fs.createWriteStream(dest);
          res.pipe(file);
          file.on("finish", () => file.close(resolve));
          file.on("error", reject);
        })
        .on("error", reject);
    };
    follow(url);
  });
}

const FULL_ZIP = path.join(__dirname, "_sysml2-full.zip");

download(URL, FULL_ZIP)
  .then(() => {
    console.log(`[download-sysml2] Downloaded full release, extracting sysml.library...`);

    // Create a temp directory for extraction
    const tmpDir = path.join(__dirname, "_sysml2-extract");
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
      // Extract only sysml.library/ .sysml files
      execSync(`unzip -q -o "${FULL_ZIP}" "SysML-v2-Release-2026-03/sysml.library/*.sysml" -d "${tmpDir}"`, {
        stdio: "pipe",
      });

      // Repackage into the final zip (paths relative to the extract dir)
      execSync(`cd "${tmpDir}" && zip -q -r "${DEST}" .`);

      const stats = fs.statSync(DEST);
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
      console.log(`[download-sysml2] Created ${ZIP_NAME} (${sizeMB} MB, sysml.library only)`);
    } finally {
      // Clean up
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.unlinkSync(FULL_ZIP);
    }
  })
  .catch((err) => {
    console.error(`[download-sysml2] Failed: ${err.message}`);
    try {
      fs.unlinkSync(FULL_ZIP);
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(DEST);
    } catch {
      /* ignore */
    }
    process.exit(1);
  });
