#!/usr/bin/env node
// Downloads the SysML v2 standard library zip if not already present.
// Canonical download location: scripts/SysML-v2-Release-2026-03.zip

const fs = require("fs");
const https = require("https");
const path = require("path");

const ZIP_NAME = "SysML-v2-Release-2026-03.zip";
const DEST = path.join(__dirname, ZIP_NAME);
const URL = `https://github.com/Systems-Modeling/SysML-v2-Release/archive/refs/tags/2026-03.zip`;

if (fs.existsSync(DEST)) {
  console.log(`[download-sysml2] ${ZIP_NAME} already exists, skipping download.`);
  process.exit(0);
}

console.log(`[download-sysml2] Downloading ${ZIP_NAME}...`);

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

download(URL, DEST)
  .then(() => console.log(`[download-sysml2] Downloaded to ${DEST}`))
  .catch((err) => {
    console.error(`[download-sysml2] Failed: ${err.message}`);
    try {
      fs.unlinkSync(DEST);
    } catch {
      // ignore
    }
    process.exit(1);
  });
